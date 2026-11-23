// @ts-check
import { startRun, logEvent } from "./runlog.js";
import { LIVE_NAME } from "./livewatch.js";
import fs from "node:fs";
import path from "node:path";
import { channelModule, withAbility } from "./channels/index.js";
import { JOB_ID, createJob, saveJob, loadJob, listJobs, logJob, jobDir, flag, snapshot, mergeSave, nextFreeSlot, recordUpload } from "./jobs.js";
import { pinComment, changeVisibility } from "./studio/studio.js";
import { exclusive } from "./studio/browser.js";
import { listShorts } from "./studio/analytics.js";
import { postTikTok } from "./studio/tiktok.js";
import { tiktokSlot, tiktokCaption, tiktokHoldFor } from "./tiktokplan.js";
import { studioLabels } from "./schedule.js";
import { alertJob, sendAlert } from "./notify.js";
import { healthTick, healthStatus, coverage } from "./health.js";
import { ownerName as OWNER } from "../hub/settings.js";
import { Hold, SkipJob, loadPipelineConfig, channelCfg, channelName, pipelineTz, dayIn, resolvePath, standbyState } from "./util.js";
import { aiContext, skipBatch } from "./context.js";
import { aiSettings } from "./ai.js";
import { recordCorrection, recordHoldOutcome } from "./corrections.js";
import { pauseState } from "./admin.js";
import { isNetworkError, netCode } from "./fetch-retry.js";

// The channel modules (channels/index.js): { channel id: its module } for every channel that has one.
export const channels = new Proxy({}, { get: (_, id) => channelModule(id) });
const VIDEO = /\.(mp4|mov|m4v|mkv|webm)$/i;
// A file named TEST_... runs every step except posting and writing to the trackers.
const TEST_NAME = /^TEST[_ -]/i;
export const TEST_SKIPS = ["audit", "upload", "trackRender", "trackUpload", "logUpload"];
const seen = new Map(); // inbox file -> last size, to wait until a copy has finished
let busy = false;

function moveFile(from, to) {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    fs.copyFileSync(from, to);
    fs.unlinkSync(from);
  }
}

// Moves a job folder. A rename, or copy then delete when it crosses volumes (EXDEV), like moveFile does for a file.
export function moveDir(from, to) {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    fs.cpSync(from, to, { recursive: true, errorOnExist: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

// The same file, whatever the slashes or (on Windows) the capital letters: C:\a\b.mp4 is c:/a/B.mp4.
export function sameFile(a, b) {
  if (!a || !b) return false;
  const norm = (p) => (process.platform === "win32" ? path.resolve(String(p)).toLowerCase() : path.resolve(String(p)));
  return norm(a) === norm(b);
}

// What a job's status is once it is on YouTube with this visibility.
export const statusForVisibility = (visibility) => ({ private: "private", schedule: "scheduled", public: "published" })[visibility] ?? "done";

let scanning = false;
export function scanInboxes() {
  if (scanning) return; // two overlapping scans could both see the same size and take a half-copied file as finished
  scanning = true;
  try {
    scanInboxesNow();
  } finally {
    scanning = false;
  }
}

function scanInboxesNow() {
  const cfg = loadPipelineConfig();
  for (const [name, ch] of Object.entries(cfg.channels)) {
    if (!ch.enabled) continue;
    const inbox = resolvePath(ch.inbox);
    fs.mkdirSync(inbox, { recursive: true });
    for (const file of fs.readdirSync(inbox)) {
      if (!VIDEO.test(file)) continue;
      const full = path.join(inbox, file);
      let job = null, moved = false;
      try {
        const { size, mtimeMs } = fs.statSync(full);
        const stable = seen.get(full) === size && Date.now() - mtimeMs > 5000;
        seen.set(full, size);
        if (!stable) continue;
        seen.delete(full);
        job = createJob({ channel: name, sourceName: file });
        const dest = path.join(jobDir(job.id), "source" + path.extname(file).toLowerCase());
        moveFile(full, dest);
        moved = true;
        job.data.source = dest;
        if (TEST_NAME.test(file)) job.data.testRun = true;
        // A piece of a live stream (livewatch.js): strong moments only, and posted as soon as the owner approves it.
        if (LIVE_NAME.test(file)) job.data.postNow = true;
        logJob(job, `Picked up ${file} from the ${ch.name} inbox${job.data.testRun ? " as a test run (won't post or touch the trackers)" : ""}`);
        saveJob(job);
      } catch (err) {
        // A file still locked by Explorer, OBS or Drive sync can't be moved yet. Take back the empty job made for it
        // (never one that already holds the video) so it isn't picked up twice, and look again next time.
        console.error(`Inbox: couldn't pick up ${file} yet: ${err.message}`);
        if (job && !moved) {
          try {
            fs.rmSync(jobDir(job.id), { recursive: true, force: true });
          } catch {}
        }
      }
    }
  }
}

// Half-price batch mode is fine when nothing is in a hurry: the channel is live, this morning's health check found a
// video already going out today, and it isn't a test run. Otherwise the job runs at normal speed.

const mod0 = (job) => channels[job.channel]?.stages[0];
// A numbered series (episode numbers kept in order): its module can renumber a job.
const numbered = (id) => typeof channels[id]?.renumber === "function";
export function batchReady(job) {
  if (skipBatch.has(job.id)) job.data.noBatch = true;
  if (!aiSettings().batch?.on || job.data.testRun || job.data.noBatch || job.data.postNow) return false;
  // A step the owner just retried or answered runs at normal speed, so he sees straight away whether it's fixed.
  if (job.data.fastStage && job.data.fastStage === (job.stage || mod0(job))) return false;
  const cfg = loadPipelineConfig();
  const ch = cfg.channels[job.channel];
  if (!ch?.live) return false;
  const h = healthStatus();
  const tz = pipelineTz(cfg);
  const today = dayIn(tz);
  // Covered = a video posted in the last 24 hours and one ready to follow it. The pipeline's own jobs count
  // straight away; otherwise this morning's health check (which also reads Studio) decides.
  const cov = coverage(job.channel);
  if (cov.posted.length && cov.next.length) return true;
  if (!h.at || dayIn(tz, new Date(h.at)) !== today) return false;
  return Boolean(h.checks?.find((c) => c.name === `${ch.name}: today's video`)?.ok);
}

// Auto clean (the owner 2026-11-20): a live-stream piece (LIVE_ name, livewatch.js) isn't needed once its clips are cut
// (each clip job has its own copy), and each is about 300 MB. Only live pieces: a channel or any other video someone
// recorded keeps its original. Returns the bytes freed.
export function dropLivePiece(job) {
  if (!LIVE_NAME.test(job.sourceName || "") || !job.data?.splitInto) return 0;
  let freed = 0;
  for (const f of ["source.mp4", "scan-audio.mp3", "scan"]) {
    const p = path.join(jobDir(job.id), f);
    try { const s = fs.statSync(p); freed += s.isDirectory() ? 0 : s.size; fs.rmSync(p, { recursive: true, force: true }); } catch {}
  }
  if (freed) logJob(job, `Auto clean: deleted the full recording (${Math.round(freed / 1e6)} MB); the clips keep their own copies`);
  return freed;
}

// Network drop (2026-11-23: a moment's Ethernet flap failed several jobs with "fetch failed"). The calls themselves
// already try again for about half a minute (fetch-retry.js); if a step still fails with a network error, the job goes
// back in line once, a minute later, instead of failing. A second network failure at the same step fails as usual
// (and clears the mark, so a manual Retry gets its own automatic one). Never for upload, posting or tracker steps
// (a retry there could post or log twice).
export const NET_RETRY_MS = 60000;
const NO_NET_RETRY = /upload|post|publish/i;
export function netRequeue(job, stage, err, now = Date.now()) {
  if (!isNetworkError(err) || NO_NET_RETRY.test(stage)) return false;
  if (job.data.netRetry?.stage === stage) {
    delete job.data.netRetry;
    return false;
  }
  job.status = "queued";
  job.error = null;
  job.data.netRetry = { stage, at: new Date(now + NET_RETRY_MS).toISOString() };
  logJob(job, `Network dropped at ${stage} (${netCode(err)}); trying this step again in ${NET_RETRY_MS / 1000} s`);
  return true;
}
// A job put back after a network drop waits its minute; other queued jobs go first meanwhile.
export const netWaiting = (j, now = Date.now()) => Date.parse(j.data?.netRetry?.at || 0) > now;

async function runJob(job) {
  // The tick's list may be minutes old by now: a button pressed meanwhile (Skip, It's in Studio) wins (stress test
  // 2026-10-23: a skipped video still uploaded, and a job marked as in Studio uploaded a second copy).
  job = loadJob(job.id);
  if (job.status !== "queued") return;
  const mod = channels[job.channel];
  let i = Math.max(0, mod.stages.indexOf(job.stage));
  job.status = "running";
  job.hold = null;
  job.error = null;
  saveJob(job);
  const log = startRun("pipeline job", { trigger: "worker", job: job.id, channel: job.channel, file: job.sourceName, fromStage: mod.stages[i], testRun: Boolean(job.data.testRun) });
  for (; i < mod.stages.length; i++) {
    const stage = mod.stages[i];
    job.stage = stage;
    job.stageStartedAt = new Date().toISOString();
    saveJob(job);
    log.step(stage);
    try {
      if (job.data.testRun && TEST_SKIPS.includes(stage)) {
        logJob(job, `Test run: skipped ${stage}`);
      } else {
        const batch = batchReady(job);
        if (batch && !job.data.batchNoted) {
          logJob(job, "Today's video is already covered, so this one's AI steps use the half-price batch mode (slower).");
          job.data.batchNoted = true;
        }
        const note = (msg) => {
          logJob(job, msg);
          job.data.batchWaiting = /waiting/.test(msg);
          saveJob(job);
        };
        await aiContext.run({ batch, note, job: job.id, video: `${channelName(job.channel)}: ${job.data.episode ? `Ep ${job.data.episode}` : job.sourceName}` }, () => mod.handlers[stage](job));
        job.data.batchWaiting = false;
      }
      // A step can send the job back to an earlier one (renumbering re-renders the video).
      if (job.data.rewindTo && mod.stages.includes(job.data.rewindTo)) {
        i = mod.stages.indexOf(job.data.rewindTo) - 1;
        delete job.data.rewindTo;
        saveJob(job);
        continue;
      }
      // A video with several packs was cut into one new job per pack; this one stops here.
      if (job.data.splitInto) {
        job.status = "split";
        job.stage = "done";
        job.stageStartedAt = null;
        if (job.data.pooled !== undefined) logJob(job, `Live piece done: ${job.data.pooled} clip(s) went to the hour's pool`);
        else logJob(job, `Cut into ${job.data.splitInto.length} videos, one per ${channels[job.channel]?.splitUnit || "clip"}`);
        dropLivePiece(job);
        log.end({ outcome: "split", jobs: job.data.splitInto.length });
        saveJob(job);
        return;
      }
    } catch (err) {
      if (err instanceof Hold) {
        job.status = "held";
        job.hold = { stage, reason: err.message, review: err.review ?? null, fields: err.fields ?? null, images: err.images ?? null, points: err.points ?? null };
        logJob(job, `Held at ${stage}: ${err.message}`);
        // Waiting on an earlier video carries on by itself, so it doesn't buzz the phone.
        if (!job.data.waitEarlier) alertJob(job, "held");
        log.end({ outcome: "held", stage, held: err.message });
      } else if (err instanceof SkipJob) {
        // a stage decided this one shouldn't go on (the Neon check on live clips); Unskip still puts it back in line
        job.status = "skipped";
        job.skipReason = err.message;
        logJob(job, `Skipped at ${stage}: ${err.message}`);
        log.end({ outcome: "skipped", stage, reason: err.message });
      } else if (netRequeue(job, stage, err)) {
        log.end({ outcome: "requeued", stage, error: err.message });
      } else {
        job.status = "failed";
        job.error = { stage, message: err.message };
        logJob(job, `Failed at ${stage}: ${err.stack || err.message}`);
        alertJob(job, "failed");
        log.end({ outcome: "failed", stage, error: err.message });
      }
      saveJob(job);
      return;
    }
    // How long each step took, so the dashboard can estimate time left on later jobs.
    job.data.stageTimes = { ...job.data.stageTimes, [stage]: Date.now() - Date.parse(job.stageStartedAt) };
    if (job.data.fastStage === stage) delete job.data.fastStage;
    if (job.data.netRetry?.stage === stage) delete job.data.netRetry;
  }
  job.stageStartedAt = null;
  job.stage = "done";
  job.status = job.data.testRun ? "tested" : { private: "private", schedule: "scheduled", public: "published" }[job.data.visibility] ?? "done";
  logJob(job, `Finished: ${job.status}`);
  queueTikTok(job);
  log.end({ outcome: job.status, videoId: job.data.videoId || null });
  saveJob(job);
  alertJob(job, "done");
}

// Pins the comment and updates tracking once a scheduled (or just-published) video is live.
async function afterLive(job) {
  job = loadJob(job.id);
  if (!(job.status === "scheduled" || (job.status === "published" && job.data.pinPending))) return;
  const mark = snapshot(job);
  const cfg = loadPipelineConfig();
  if (job.data.pinPending && !(Date.parse(job.data.pinRetryAt || 0) > Date.now())) {
    let pinOk = false;
    try {
      if (!job.data.meta_out?.pinned_comment) throw new Error("This video has no pinned comment written.");
      await pinComment({ videoId: job.data.videoId, text: job.data.meta_out.pinned_comment, channel: cfg.channels[job.channel], shotsDir: jobDir(job.id) });
      logJob(job, "Pinned the comment");
      job.data.pinned = true;
      pinOk = true;
      job.flags = job.flags.filter((f) => !f.startsWith("Pinning the comment failed"));
      logEvent("pin comment", { trigger: "worker", job: job.id, channel: job.channel, videoId: job.data.videoId });
    } catch (err) {
      flag(job, `Pinning the comment failed: ${err.message}`);
      logJob(job, `Pin failed: ${err.message}`);
      logEvent("pin comment", { trigger: "worker", job: job.id, channel: job.channel, videoId: job.data.videoId, error: err.message });
    }
    if (pinOk) {
      job.data.pinPending = false;
      delete job.data.pinTries;
      delete job.data.pinRetryAt;
    } else {
      // A slow page shouldn't cost the pin for good: three tries, 2 then 4 minutes apart; "Pin again" still works after.
      const tries = (job.data.pinTries || 0) + 1;
      if (tries >= 3) {
        job.data.pinPending = false;
        delete job.data.pinTries;
        delete job.data.pinRetryAt;
      } else {
        job.data.pinTries = tries;
        job.data.pinRetryAt = new Date(Date.now() + 2 ** tries * 6e4).toISOString();
      }
    }
  }
  if (job.status === "scheduled") {
    try {
      await channels[job.channel].afterLive(job);
      job.status = "published";
      delete job.data.afterLiveTries;
      delete job.data.afterLiveRetryAt;
    } catch (err) {
      // Try again later, waiting longer each time (2, 4, 8 ... up to 60 min), and stop after 10 tries.
      const tries = (job.data.afterLiveTries || 0) + 1;
      job.data.afterLiveTries = tries;
      job.data.afterLiveRetryAt = new Date(Date.now() + Math.min(60, 2 ** tries) * 6e4).toISOString();
      job.error = { stage: "afterLive", message: err.message };
      logJob(job, `Tracking update after going live failed (try ${tries}): ${err.message}`);
      if (tries >= 10) {
        job.data.afterLiveGaveUp = true;
        flag(job, `The tracking update after going live failed 10 times: ${err.message.split("\n")[0]}. Fix it (often the tracker open in Excel), then restart the app to try again.`);
      }
    }
  }
  mergeSave(job, mark, ["pinned", "pinPending", "pinTries", "pinRetryAt", "afterLiveTries", "afterLiveRetryAt", "afterLiveGaveUp", "packId", "tracker", "log"], ["status", "error"]);
}

// TikTok (the owner chose 2026-10-18: automatic, following Go live). A private (test mode) YouTube upload goes to
// TikTok as Only you straight away; a scheduled or public one goes to TikTok as Everyone once it's live on YouTube.
// A failure is a flag on the job, never a failed job: the YouTube side is already done.
function queueTikTok(job) {
  const tt = channelCfg(job.channel)?.tiktok;
  if (!tt?.enabled || job.data.testRun || !job.data.videoId) return;
  const privacy = job.data.visibility === "private" ? "private" : "public";
  if (job.data.tiktok?.posted?.some((p) => p.privacy === privacy)) return;
  // A post that may have gone through waits for the owner's Try again, whatever step finishes later (stress test 2026-10-23).
  if (job.data.tiktok?.mayBePosted) return;
  // A YouTube video scheduled 20 min to 10 days ahead is scheduled on TikTok for the same time, right away, so
  // several can be lined up at once (the owner 2026-10-19). If TikTok won't take the schedule, it posts once live instead.
  const at = Date.parse(job.data.publishAt || "");
  let scheduleAt = privacy === "public" && tt.schedule !== false && at > Date.now() + 1200000 && at < Date.now() + 9.5 * 864e5 ? job.data.publishAt : null;
  let slotWhy = null;
  // TikTok's own time (the owner 2026-10-19: different algorithm): its best hours from TikTok's numbers, never before
  // the YouTube post. ownTime: false keeps the YouTube time.
  if (privacy === "public" && tt.schedule !== false && tt.ownTime !== false) {
    const slot = tiktokSlot({ channel: job.channel, notBefore: Math.max(Number.isFinite(at) ? at : 0, Date.now() + 30 * 60000), jobId: job.id });
    if (slot.at > Date.now() + 1200000 && slot.at < Date.now() + 9.5 * 864e5) [scheduleAt, slotWhy] = [new Date(slot.at).toISOString(), slot.why];
  }
  job.data.tiktok = { ...job.data.tiktok, status: "waiting", privacy, tries: 0, scheduleAt, slotWhy };
}

const tiktokDue = (j) =>
  j.data.tiktok?.status === "waiting" &&
  (j.data.tiktok.privacy === "private" ||
    (j.data.tiktok.scheduleAt && Date.parse(j.data.tiktok.scheduleAt) > Date.now() + 900000) ||
    (j.data.publishAt && Date.parse(j.data.publishAt) + 120000 < Date.now())) &&
  !(j.data.tiktok.retryAt && Date.parse(j.data.tiktok.retryAt) > Date.now());

// Daily ceiling (the owner 2026-11-21, "Ok cap"): TikTok caps an account at about 15 posts in 24 hours and blocks past it, so
// a channel posts at most tiktok.dailyCap (default 12) in any 24 hours. Counts posts that went out (posted[].at) and ones
// being posted now. Pure: jobs and now are passed in.
export function tiktokDailyCount(channel, jobs, now = Date.now()) {
  let n = 0;
  for (const j of jobs) {
    if (j.channel !== channel) continue;
    const tt = j.data?.tiktok;
    if (!tt) continue;
    n += (tt.posted || []).filter((p) => p.privacy === "public" && now - Date.parse(p.at || 0) < 864e5).length;
    if (tt.status === "posting" && !(tt.posted || []).length) n++;
  }
  return n;
}
export const tiktokCapOf = (channel) => { const c = Number(channelCfg(channel)?.tiktok?.dailyCap ?? 12); return Number.isFinite(c) && c > 0 ? Math.floor(c) : 0; };

export async function runTikTok(job) {
  job = loadJob(job.id);
  if (!tiktokDue(job)) return;
  // over the daily cap: wait and look again in half an hour (a private "Only you" test post doesn't count)
  if (job.data.tiktok.privacy !== "private") {
    const cap = tiktokCapOf(job.channel);
    if (cap && tiktokDailyCount(job.channel, listJobs().filter((x) => x.id !== job.id)) >= cap) {
      job.data.tiktok = { ...job.data.tiktok, retryAt: new Date(Date.now() + 30 * 60000).toISOString(), capWhy: `daily cap of ${cap} reached` };
      logJob(job, `TikTok: the daily cap of ${cap} posts in 24 hours is reached, so this clip waits (it goes when the oldest post is over a day old).`);
      saveJob(job);
      return;
    }
  }
  // Gambling hold: a held clip goes nowhere near the uploader. the owner can release one with "Post to TikTok anyway" (retryTikTok).
  if (!job.data.tiktok.holdReleased) {
    const h = tiktokHoldFor(job);
    if (h.hold) {
      job.data.tiktok = { ...job.data.tiktok, status: "held", why: h.why, heldWords: h.words, heldAt: new Date().toISOString() };
      logJob(job, `Held back from TikTok (${h.why}). YouTube is not affected. Use "Post to TikTok anyway" to release it.`);
      logEvent("tiktok held", { trigger: "worker", job: job.id, channel: job.channel, error: null, why: h.why });
      saveJob(job);
      return;
    }
  }
  const mark = snapshot(job);
  const ch = channelCfg(job.channel);
  const tt = job.data.tiktok;
  // Marked before posting: if the app stops mid-post, the restart flags it to check instead of posting it twice
  // (stress test 2026-10-23).
  job.data.tiktok = { ...tt, status: "posting", postingAt: new Date().toISOString() };
  saveJob(job);
  const { caption, warning } = tiktokCaption(job);
  if (warning) flag(job, warning);
  const log = startRun("tiktok post", { trigger: "worker", job: job.id, channel: job.channel, privacy: tt.privacy });
  try {
    // A schedule only if it's still at least 15 min away; otherwise post now (it's live on YouTube by then).
    const scheduleAt = tt.scheduleAt && Date.parse(tt.scheduleAt) > Date.now() + 900000 ? tt.scheduleAt : null;
    const tz = pipelineTz();
    const { url } = await postTikTok({ handle: ch.tiktok.handle, file: job.data.output, caption, privacy: tt.privacy, shotsDir: jobDir(job.id), scheduleAt, tz });
    job.data.tiktok = { status: "posted", privacy: tt.privacy, url, scheduledFor: scheduleAt, posted: [...(tt.posted || []), { privacy: tt.privacy, url, scheduledFor: scheduleAt, at: new Date().toISOString() }] };
    logJob(
      job,
      `${scheduleAt ? `Scheduled on TikTok for ${new Date(scheduleAt).toLocaleString("en-CA", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Posted to TikTok"} (${tt.privacy === "private" ? "Only you" : "Everyone"})${url ? `: ${url}` : ""}${scheduleAt && tt.slotWhy ? `. ${tt.slotWhy}` : ""}`,
    );
    try {
      await channels[job.channel].afterTikTok?.(job);
    } catch (err) {
      logJob(job, `Couldn't mark TikTok posted in the log: ${err.message}`);
    }
    log.end({ url });
  } catch (err) {
    const msg = err.message.split("\n")[0];
    const tries = (tt.tries || 0) + 1;
    // Sign-in and account problems won't fix themselves: stop after the first try. Others get 3 tries, 30 min apart.
    // A schedule TikTok wouldn't take: drop it and post the usual way once the video is live on YouTube.
    if (tt.scheduleAt && /\(schedule\)/.test(msg)) {
      job.data.tiktok = { ...tt, scheduleAt: null, scheduleError: msg, status: "waiting", tries: 0 };
      logJob(job, `TikTok schedule didn't stick, so it will post when the video is live on YouTube: ${msg}`);
      log.end({ error: msg });
      mergeSave(job, mark, ["tiktok"]);
      return;
    }
    const final = tries >= 3 || err.afterPost || /signed in|different TikTok account|Only you/i.test(msg);
    if (err.afterPost) flag(job, "TikTok post went wrong after Post was pressed, so it may already be on TikTok: check TikTok before trying again.");
    job.data.tiktok = { ...tt, tries, status: final ? "failed" : "waiting", error: msg, retryAt: final ? null : new Date(Date.now() + 1800000).toISOString(), ...(err.afterPost ? { mayBePosted: true } : {}) };
    logJob(job, `TikTok post failed${final ? "" : ", will try again"}: ${err.stack || err.message}`);
    if (final) flag(job, `TikTok post failed: ${msg}`);
    log.end({ error: msg });
  }
  mergeSave(job, mark, ["tiktok"]);
  if (job.data.tiktok.status !== "waiting") alertJob(job, job.data.tiktok.status === "posted" ? "tiktok" : "tiktok failed");
}

// Catch-up, automatic once a channel is live: a video live on YouTube that never went to TikTok (made before TikTok
// posting existed, or while it was off) gets queued, one at a time. Failed ones wait for the Try again button.
function catchUpNext(jobs) {
  const cfg = loadPipelineConfig();
  const j = jobs.find((j) => {
    const ch = cfg.channels[j.channel];
    return ch?.live && ch.tiktok?.enabled && !j.data.tiktok && !j.data.testRun && j.data.videoId
      && j.data.visibility !== "private" && j.data.publishAt && Date.parse(j.data.publishAt) + 120000 < Date.now() && j.data.output && fs.existsSync(j.data.output);
  });
  if (!j) return null;
  queueTikTok(j);
  logJob(j, "TikTok catch-up: live on YouTube but not on TikTok yet");
  saveJob(j);
  return j.data.tiktok?.status === "waiting" ? j : null;
}

// "Try TikTok again" on a job card, or "Post to TikTok" on the catch-up list.
export function retryTikTok(id) {
  const job = loadJob(id);
  if (!job.data.videoId) throw new Error("This one isn't on YouTube yet.");
  if (!channelCfg(job.channel)?.tiktok?.enabled) throw new Error("TikTok is off for this channel.");
  if (!job.data.output || !fs.existsSync(job.data.output)) throw new Error("The video file for this one isn't on the PC any more.");
  const privacy = job.data.visibility === "private" ? "private" : "public";
  if (job.data.tiktok?.posted?.some((p) => p.privacy === privacy)) throw new Error("This one is already on TikTok.");
  if (job.data.tiktok?.status === "posting") throw new Error("This one is posting to TikTok right now.");
  // From a hold this is the "Post to TikTok anyway" release (password-confirmed in the route, like any TikTok retry).
  const released = job.data.tiktok?.status === "held" || job.data.tiktok?.holdReleased;
  job.data.tiktok = { ...job.data.tiktok, status: "waiting", privacy, tries: 0, retryAt: null, error: null, mayBePosted: false, ...(released ? { holdReleased: true, why: null } : {}) };
  if (released) logJob(job, "Released from the TikTok gambling hold by hand.");
  saveJob(job);
  return job;
}

// Videos made by the app that are live on YouTube but not on TikTok (postable, the file is here).
export function tiktokCatchUp() {
  const cfg = loadPipelineConfig();
  const on = Object.entries(cfg.channels).filter(([, c]) => c.enabled && c.tiktok?.enabled).map(([id]) => id);
  const jobs = listJobs().filter((j) => on.includes(j.channel) && j.data.videoId && !j.data.testRun
    && j.data.visibility !== "private" && j.data.publishAt && Date.parse(j.data.publishAt) < Date.now()
    && !j.data.tiktok?.posted?.some((p) => p.privacy === "public"));
  return {
    jobs: jobs.map((j) => ({
      id: j.id,
      channel: j.channel,
      title: j.data.meta_out?.title,
      videoId: j.data.videoId,
      liveAt: j.data.publishAt,
      status: j.data.tiktok?.status || null,
      error: j.data.tiktok?.error || null,
      hasFile: Boolean(j.data.output && fs.existsSync(j.data.output)),
    })),
  };
}

// "Make public" on a private upload: publish now or schedule into the next free slot, then the same
// tracking as a fresh upload (tracker/log row, pinned comment once live).
async function runPublish(job) {
  const log = startRun("make public", { trigger: "worker", job: job.id, channel: job.channel, when: job.data.publishWhen });
  const cfg = loadPipelineConfig();
  const ch = cfg.channels[job.channel];
  const when = job.data.publishWhen;
  try {
    let publishAt = new Date();
    const tz = pipelineTz(cfg);
    if (when === "slot") {
      publishAt = nextFreeSlot(job.channel, job.id);
    }
    const visibility = when === "slot" ? "schedule" : "public";
    await changeVisibility({ channel: ch, videoId: job.data.videoId, visibility, scheduleLabels: when === "slot" ? studioLabels(tz, publishAt) : null, shotsDir: jobDir(job.id) });
    recordUpload(job, { videoId: job.data.videoId, visibility, publishAt });
    logJob(job, `Made ${job.data.videoId} ${visibility === "schedule" ? `scheduled for ${studioLabels(tz, publishAt).pretty}` : "public"}`);
    // The video is public or scheduled now, so the job says so whatever happens next. A failed tracker update is a
    // flag to fix, not a reason to set it back to private (code review 2026-10-22).
    job.status = visibility === "schedule" ? "scheduled" : "published";
    job.error = null;
    saveJob(job);
    const mod = channels[job.channel];
    const track = mod.stages.find((s) => s === "trackUpload" || s === "logUpload");
    if (track) {
      try {
        await mod.handlers[track](job);
      } catch (err) {
        flag(job, `Made ${visibility === "schedule" ? "scheduled" : "public"}, but the tracker update failed: ${err.message.split("\n")[0]}`);
        logJob(job, `Tracker update after Make public failed: ${err.message}`);
      }
    }
    queueTikTok(job);
    saveJob(job);
    alertJob(job, "done");
    log.end({ videoId: job.data.videoId, visibility, publishAt: job.data.publishAt });
  } catch (err) {
    log.end({ videoId: job.data.videoId, error: err.message.split("\n")[0] });
    job.status = "private";
    job.error = { stage: "make public", message: err.message.split("\n")[0] };
    logJob(job, `Make public failed: ${err.stack || err.message}`);
    saveJob(job);
    alertJob(job, "failed");
  }
}

// Running a job (render, batch AI, upload) can take 10+ minutes. It has its own lock, so the quick, time-sensitive
// steps in tick() (pin after going live, make public, TikTok) don't wait behind it. Browser use is still one at a
// time (exclusive() in studio/browser.js), and jobs still run one at a time.
let jobRunning = false;
function kickJobs() {
  if (jobRunning) return;
  jobRunning = true;
  runNextJob()
    .catch((err) => console.error("Pipeline job run failed:", err))
    .finally(() => {
      jobRunning = false;
    });
}

async function runNextJob() {
  // Standby copy: only test jobs run; nothing goes to YouTube or TikTok.
  if (standbyState().standby) {
    const test = !pauseState().paused && listJobs().reverse().find((j) => j.status === "queued" && j.data.testRun && !netWaiting(j));
    if (test) await runJob(test);
    return;
  }
  // A channel video waiting for an earlier one goes back in line once that one has its number.
  const nowJobs = listJobs().reverse();
  for (const j of nowJobs.filter((j) => j.status === "held" && j.data.waitEarlier)) {
    if (channels[j.channel]?.pendingEarlier?.(j, nowJobs).length) continue;
    requeue(j, "Carrying on: the earlier videos have their numbers now", { fast: false });
  }
  const next = !pauseState().paused && listJobs().reverse().find((j) => j.status === "queued" && !netWaiting(j));
  if (next) await runJob(next);
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    // (The inboxes are read by their own timer in startWorker, so a half-copied file isn't judged by two timers.)
    const jobs = listJobs().reverse(); // oldest first
    if (standbyState().standby) {
      kickJobs();
      return;
    }
    // Skips jobs backing off after a failed update, so one stuck job can't hold up the rest (code review 2026-10-22).
    const live = jobs.find(
      (j) =>
        (j.status === "scheduled" || (j.status === "published" && j.data.pinPending)) &&
        j.data.publishAt &&
        Date.parse(j.data.publishAt) + 120000 < Date.now() &&
        !j.data.afterLiveGaveUp &&
        !(Date.parse(j.data.afterLiveRetryAt || 0) > Date.now()) &&
        !(j.status === "published" && Date.parse(j.data.pinRetryAt || 0) > Date.now()),
    );
    if (live) await afterLive(live);
    const pub = jobs.find((j) => j.status === "publishing");
    if (pub) await runPublish(pub);
    const tt = jobs.find(tiktokDue) || catchUpNext(jobs);
    if (tt) await runTikTok(tt);
    kickJobs();
  } catch (err) {
    console.error("Pipeline tick failed:", err);
  } finally {
    busy = false;
  }
}

export function startWorker() {
  const seconds = loadPipelineConfig().pollSeconds || 10;
  // A job left "running" by a crash or restart goes back in the queue at the same stage, except one stopped mid-upload
  // (code review 2026-10-22): Studio may already have the video, and uploading again would make a second copy.
  for (const j of listJobs().filter((j) => j.status === "running")) {
    if (j.stage === "upload" && !j.data.videoId && !j.data.testRun) {
      j.status = "failed";
      j.error = { stage: "upload", message: "The app stopped while this was uploading, so it may already be in YouTube Studio. Check Studio: if it's there, press It's in Studio; if not, press Retry." };
      logJob(j, "App stopped mid-upload: not uploading again by itself");
    } else j.status = "queued";
    saveJob(j);
  }
  // A TikTok post cut off by a restart may have gone through: the owner checks rather than it posting twice.
  for (const j of listJobs().filter((j) => j.data.tiktok?.status === "posting")) {
    j.data.tiktok = { ...j.data.tiktok, status: "failed", mayBePosted: true, error: "The app stopped while this was posting to TikTok, so it may already be there. Check TikTok: if it's not there, press Try TikTok again." };
    flag(j, "TikTok post cut off by a restart: check TikTok before trying again.");
    logJob(j, "App stopped mid TikTok post: not posting again by itself");
    saveJob(j);
  }
  // A restart gives stuck after-live updates a fresh set of tries.
  for (const j of listJobs().filter((j) => j.data.afterLiveTries)) {
    delete j.data.afterLiveTries;
    delete j.data.afterLiveRetryAt;
    delete j.data.afterLiveGaveUp;
    saveJob(j);
  }
  setInterval(tick, seconds * 1000);
  // The inboxes are also read on their own (the owner 2026-10-23: five phone uploads, only one showed as a job). tick()
  // only reads them between jobs, and a job in half-price batch mode can take 10+ minutes, so the rest sat unseen.
  // Now every upload becomes a queued job straight away and shows on the dashboard; they still run one at a time.
  setInterval(() => {
    try {
      scanInboxes();
    } catch (err) {
      console.error("Inbox check failed:", err.message);
    }
  }, seconds * 1000);
  tick();
  // The morning health check, checked once a minute.
  setInterval(() => {
    try {
      healthTick();
    } catch (err) {
      console.error("Daily checks failed:", err);
    }
  }, 60000);
  const standby = standbyState().standby;
  // A restart you didn't do (crash, Windows update) shows up on your phone.
  sendAlert({
    kind: "started",
    title: standby ? "Standby copy started" : "Pipeline started",
    message: standby ? "This copy is on standby: it only runs test jobs and never posts." : "The upload pipeline is running.",
    tags: ["arrow_forward"],
    priority: 2,
  }).catch(() => {});
  console.log(`Pipeline watching inboxes every ${seconds} s`);
}

// Puts a job back in line: clears its question and error, optionally moves it to a stage (null allowed), and by
// default lets the next run skip the review stop it just passed (fastStage). Logs why when given.
/** @param {any} job @param {string} why @param {{ stage?: string, fast?: boolean }} [opts] */
function requeue(job, why, { stage, fast = true } = {}) {
  if (stage !== undefined) job.stage = stage;
  if (fast) job.data.fastStage = job.stage;
  job.status = "queued";
  job.hold = null;
  job.error = null;
  if (why) logJob(job, why);
  saveJob(job);
  return job;
}

// Dashboard actions
export function continueJob(id, review, answers) {
  const job = loadJob(id);
  if (job.status !== "held") throw new Error("Job isn't waiting on you.");
  if (answers && job.hold.fields) {
    // Only the boxes the hold asked for, each checked against its type.
    const clean = {};
    for (const f of job.hold.fields) {
      const v = answers[f.key];
      if (f.type === "checkbox") clean[f.key] = Boolean(v);
      else if (v === undefined || v === null || v === "") {
        if (f.required) throw new Error(`Fill in "${f.label}".`);
      } else if (f.type === "number") {
        const n = Number(v);
        if (!Number.isFinite(n) || (f.min != null && n < f.min)) throw new Error(`"${f.label}" needs a number${f.min != null ? ` of at least ${f.min}` : ""}.`);
        clean[f.key] = n;
      } else if (f.type === "select") {
        if (!f.options.some((o) => (o.value ?? o) === v)) throw new Error(`Pick one of the choices for "${f.label}".`);
        clean[f.key] = v;
      } else clean[f.key] = String(v).trim().slice(0, f.type === "textarea" ? 2000 : 200);
    }
    recordHoldOutcome(job, Boolean(recordCorrection(job, { answers: clean, review })), { answers: clean });
    job.data.answers = { ...job.data.answers, [job.hold.stage]: { ...job.data.answers?.[job.hold.stage], ...clean } };
    logJob(job, `${OWNER()} answered at ${job.hold.stage}: ${Object.entries(clean).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    if (review !== undefined) job.data.overrides = { ...job.data.overrides, [job.hold.stage]: review };
    return requeue(job, null);
  }
  recordHoldOutcome(job, review !== undefined && Boolean(recordCorrection(job, { review })));
  job.data.overrides = { ...job.data.overrides, [job.hold.stage]: review ?? true };
  return requeue(job, `${OWNER()} continued from ${job.hold.stage}`);
}

// Runs the whole job again from the first step with fresh answers (the original file is kept).
export function restartJob(id) {
  const job = loadJob(id);
  if (job.data.splitInto?.length) throw new Error("This video was already cut into one job per pack, so starting over would make the packs twice. Start over on a pack instead.");
  if (!["failed", "held", "tested", "skipped"].includes(job.status)) throw new Error("Only a job that's waiting, failed, skipped or test-run can start over.");
  // Already on YouTube (held at the log or tracker step): starting over would upload a second copy (code review 2026-10-22).
  if (job.data.videoId && !job.data.testRun) throw new Error("This one is already on YouTube, so starting over would upload it twice. Use Retry to finish the remaining steps.");
  const source = job.data.originalSource ?? job.data.source;
  const dir = jobDir(job.id);
  for (const f of fs.readdirSync(dir)) if (f !== "job.json" && !sameFile(path.join(dir, f), source)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  // A channel job keeps its episode number to take back (2026-10-23), so starting over doesn't shuffle the rest.
  const keep = Number.isInteger(job.data.episode) ? job.data.episode : job.data.keepEpisode;
  job.data = {
    source,
    ...(job.data.testRun ? { testRun: true } : {}),
    ...(numbered(job.channel) && Number.isInteger(keep) ? { keepEpisode: keep } : {}),
    ...(numbered(job.channel) && job.data.packId ? { packId: job.data.packId } : {}),
    ...(job.data.orderKey ? { orderKey: job.data.orderKey } : {}),
    ...(job.data.splitFrom ? { splitFrom: job.data.splitFrom } : {}),
    ...(job.data.replaced ? { replaced: job.data.replaced } : {}),
    ...(job.data.draftsLeft ? { draftsLeft: job.data.draftsLeft } : {}),
  };
  job.flags = [];
  return requeue(job, `${OWNER()} started it over from the beginning`, { stage: null, fast: false });
}

// Re-make a scheduled or private a channel video with the right episode number. the owner sets the old one to
// Private in Studio first (the pipeline never deletes a YouTube video); the job re-renders from its cards and
// prices, uploads a new video, and the tracker drops the old video's row.
export function remakeJob(id) {
  const job = loadJob(id);
  if (!numbered(job.channel)) {
    const can = withAbility("renumber").map((id) => channelName(id));
    throw new Error(can.length ? `Only ${can.join(" and ")} videos can be re-made this way.` : "No channel on this hub can re-make videos this way.");
  }
  if (!["scheduled", "private", "failed", "held"].includes(job.status)) throw new Error("Only a scheduled, private, failed or waiting video can be re-made. Posted videos are final.");
  // Still "scheduled" after its time when the after-live update failed; it's public on YouTube by then (stress test 2026-10-23).
  if (job.data.publishAt && Date.parse(job.data.publishAt) < Date.now() && job.data.visibility !== "private") throw new Error("This one is already public on YouTube. Posted videos are final.");
  if (!job.data.priced) throw new Error("This one hasn't been priced yet, so there's nothing to re-make.");
  if (job.data.videoId)
    job.data.replaced = [
      ...(job.data.replaced || []),
      {
        videoId: job.data.videoId,
        publishAt: job.data.publishAt,
        episode: job.data.episode,
        tiktok: job.data.tiktok?.posted?.length ? job.data.tiktok.posted : undefined,
        at: new Date().toISOString(),
      },
    ];
  const old = job.data.episode;
  // Keeps its number if it's still free (2026-10-23), so a re-make doesn't shuffle the episodes after it.
  if (Number.isInteger(old)) job.data.keepEpisode = old;
  // The old video's TikTok post goes with it (stress test 2026-10-23: the re-made video never went to TikTok, and the
  // old one stayed booked there).
  const oldTikTok = job.data.tiktok?.posted?.length;
  for (const k of ["videoId", "visibility", "publishAt", "pinPending", "pinned", "tiktok"]) delete job.data[k];
  channels[job.channel].renumber(
    job,
    `${OWNER()} asked to re-make it${old ? ` (was Ep${old}${job.data.replaced?.length ? `, old video ${job.data.replaced.at(-1).videoId} should be set to Private or deleted in Studio${oldTikTok ? ", and its TikTok post deleted on TikTok" : ""}` : ""})` : ""}`,
  );
  if (oldTikTok) flag(job, "Re-made: delete the old video's TikTok post on TikTok (the app never deletes posts).");
  delete job.data.rewindTo;
  return requeue(job, null, { stage: "render" });
}

// "Pin again" on a live video whose pinned comment failed: the worker's live check picks it up within a minute,
// and an existing comment from the channel is pinned rather than posted twice.
export function pinAgain(id) {
  const job = loadJob(id);
  if (!job.data.videoId || !["published", "scheduled"].includes(job.status)) throw new Error("Only a video that's on YouTube can have its comment pinned.");
  if (!job.data.meta_out?.pinned_comment) throw new Error("This video has no pinned comment written.");
  job.data.pinPending = true;
  job.data.pinned = false;
  logJob(job, `${OWNER()} asked to pin the comment again`);
  saveJob(job);
  return job;
}

export function retryJob(id) {
  const job = loadJob(id);
  if (!["failed", "held"].includes(job.status)) throw new Error("Only failed or held jobs can be retried.");
  return requeue(job, `Retrying from ${job.stage}`);
}

// the owner sees a failed upload in Studio after all (Studio saved it; the app missed the confirmation): record the video
// and carry on from the step after upload (tracker/log), as if the upload had confirmed.
// With no link, the video is found on Studio's Shorts list by its exact title (not a draft, not one already used).
export async function markUploaded(id, link, publishAt) {
  let job = loadJob(id);
  if (!["failed", "queued"].includes(job.status) || job.stage !== "upload") throw new Error("Only a job stopped at its upload step can be marked as in Studio.");
  let videoId = String(link || "").match(/(?:youtu\.be\/|shorts\/|v=|video\/)([\w-]{11})/)?.[1] || (/^[\w-]{11}$/.test(String(link || "").trim()) ? String(link).trim() : null);
  if (!videoId && !link) {
    // Off the queue while Studio's list loads, so the worker can't upload it again meanwhile (stress test 2026-10-23).
    if (job.status === "queued") {
      job.status = "failed";
      job.error = { stage: "upload", message: "Looking for it in Studio (It's in Studio was pressed). If it isn't found, press Retry." };
      saveJob(job);
    }
    const cfg0 = loadPipelineConfig();
    // Old videos a Re-make replaced keep the same title, so they're left out too (stress test 2026-10-23).
    const used = new Set(listJobs().flatMap((j) => [j.data.videoId, ...(j.data.draftsLeft || []), ...(j.data.replaced || []).map((r) => r.videoId)]).filter(Boolean));
    const title = (job.data.meta_out?.title || "").trim();
    const list = await exclusive(() => listShorts({ channel: cfg0.channels[job.channel] }));
    const planned = job.data.uploadPlan?.visibility;
    const hits = list.filter((v) => v.title.trim() === title && !used.has(v.videoId) && !/draft/i.test(v.visibility || "") && !(planned && planned !== "private" && /private/i.test(v.visibility || "")));
    if (hits.length !== 1) throw new Error(hits.length ? `Found ${hits.length} videos titled "${title}" in Studio; paste the right one's link.` : `No saved (non-draft) video titled "${title}" on Studio's Shorts list.`);
    videoId = hits[0].videoId;
    job = loadJob(id);
    // Retry pressed while Studio's list loaded: the worker may be uploading it again right now (stress test 2026-10-23).
    if (!["failed", "queued"].includes(job.status) || job.stage !== "upload" || job.data.videoId) throw new Error("This job changed while Studio's list was loading (it's running or already recorded). Check its card and try again if needed.");
  }
  if (!videoId) throw new Error("Paste the video's link (or its 11-character ID).");
  const plan = job.data.uploadPlan || {};
  const at = publishAt || plan.publishAt;
  // A live channel never defaults to private: that would record a scheduled or public video wrongly (stress test 2026-10-23).
  if (!plan.visibility && !at && channelCfg(job.channel)?.live) throw new Error("This job doesn't know when it was planned to go out. Give the time Studio shows for it.");
  const visibility = plan.visibility || (at ? "schedule" : "private");
  if (visibility === "schedule" && !at) throw new Error("This job doesn't know its planned time; give it one.");
  const mod = channels[job.channel];
  const cfg = loadPipelineConfig();
  recordUpload(job, { videoId, visibility, publishAt: at });
  const upIdx = mod.stages.indexOf("upload");
  if (upIdx === -1) throw new Error(`The ${job.channel} channel has no upload step, so this can't be marked as in Studio.`);
  job.stage = mod.stages[upIdx + 1] || "done";
  // On YouTube as private stays private (so "Make public" works); a scheduled or public one waits for its after-live update.
  job.status = job.stage === "done" ? (statusForVisibility(visibility) === "private" ? "private" : "scheduled") : "queued";
  logJob(job, `Marked as in Studio by ${OWNER()}: ${videoId} (${visibility}${at ? `, ${studioLabels(pipelineTz(cfg), new Date(at)).pretty}` : ""})`);
  saveJob(job);
  return job;
}

export function publishJob(id, when) {
  const job = loadJob(id);
  if (job.status !== "private") throw new Error("Only private uploads can be made public.");
  if (!/^[\w-]{11}$/.test(job.data.videoId || "")) throw new Error("This job has no real YouTube video.");
  if (!["now", "slot"].includes(when)) throw new Error("Pick now or the next slot.");
  job.status = "publishing";
  job.data.publishWhen = when;
  logJob(job, `${OWNER()} asked to make it public (${when === "now" ? "now" : "next slot"})`);
  saveJob(job);
  return job;
}

// Clears skipped jobs off the list. Nothing is deleted: each job folder moves to data/jobs-archive.
export function clearSkipped() {
  const archive = resolvePath("data/jobs-archive");
  fs.mkdirSync(archive, { recursive: true });
  const moved = [];
  const failed = [];
  for (const j of listJobs().filter((x) => x.status === "skipped")) {
    try {
      let dest = path.join(archive, j.id);
      if (fs.existsSync(dest)) dest = `${dest}-${Date.now()}`; // never on top of an older copy
      moveDir(jobDir(j.id), dest);
      moved.push(j.id);
    } catch (err) {
      failed.push(`${j.id}: ${err.message}`); // one stuck folder doesn't stop the rest
    }
  }
  return { cleared: moved.length, archive, ...(failed.length ? { failed } : {}) };
}

// Puts a skipped job back in line from the step it stopped at, fetching it back from data/jobs-archive if
// "Clear skipped" moved it there (the owner 2026-10-19: get the remaining a channel footage processed).
export function unskipJob(id, why = `${OWNER()} asked to try it again`) {
  if (!JOB_ID.test(String(id))) throw new Error("Unknown job.");
  const archived = path.join(resolvePath("data/jobs-archive"), id);
  if (!fs.existsSync(jobDir(id)) && fs.existsSync(archived)) moveDir(archived, jobDir(id));
  const job = loadJob(id);
  if (job.status !== "skipped") throw new Error("Only skipped jobs can go back in line.");
  // A channel number freed by the skip may belong to a later video now, so it gets a fresh one at render
  // (fuzz test 2026-10-23: two videos went up as the same episode).
  if (numbered(job.channel) && Number.isInteger(job.data.episode) && !job.data.videoId && !job.data.testRun) {
    const mod = channels[job.channel];
    mod.renumber(job, "Back in line after a skip: it gets a fresh episode number at render");
    delete job.data.rewindTo;
    const st = mod.stages;
    if (st.indexOf(job.stage) > st.indexOf("render")) job.stage = "render";
  }
  return requeue(job, `Back in line from ${job.stage || "the start"}: ${why}`);
}

export function skipJob(id) {
  const job = loadJob(id);
  // A running job would overwrite the skip, and a video already on YouTube still needs its pin and tracker row (and,
  // for a channel, keeps its episode number) (code review 2026-10-22).
  if (job.status === "running") throw new Error("This job is running right now. Wait for it to stop first.");
  if (job.status === "split") throw new Error("This video was already cut into one job per pack. Skip those instead.");
  if (job.data.videoId && !job.data.testRun) throw new Error("This one is already on YouTube, so it can't be skipped. Use Retry to finish its remaining steps.");
  job.status = "skipped";
  logJob(job, `Skipped by ${OWNER()}`);
  saveJob(job);
  return job;
}
