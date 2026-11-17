import fs from "node:fs";
import path from "node:path";
import { pipeline, Transform } from "node:stream";
import { Router } from "express";
import { safe, firstLine, sendIfThere, sendCsv, photoCap } from "./handle.js";
import { config } from "../config.js";
import { JOB_ID, listJobs, loadJob, jobDir, logJob, saveJob } from "../pipeline/jobs.js";
import {
  continueJob,
  retryJob,
  pinAgain,
  unskipJob,
  remakeJob,
  restartJob,
  skipJob,
  publishJob,
  retryTikTok,
  tiktokCatchUp,
  batchReady,
  clearSkipped,
  markUploaded,
  TEST_SKIPS,
} from "../pipeline/worker.js";
import { loadPipelineConfig, savePipelineConfig, channelCfg, jobLabel, resolvePath, standbyState, setStandby, isId, OWNER } from "../pipeline/util.js";
import { statsChannels, exportStats, startPull, pullStatus, stopPull, pullPlanInfo, fixLogCreators, tiktokStats, pullTikTokStats, tiktokPullState, videoStats, statsExtras, commentStats, viewsGained } from "../pipeline/stats.js";
import { roster, checkState, startCreatorCheck, confirmCreator } from "../pipeline/creators.js";
import { notifySettings, saveNotifySettings, sendAlert, ALERT_KINDS, LEVELS, alertLevel, securityWhenOff } from "../pipeline/notify.js";
import { readCardPhoto, readCardsPhoto, lookupCard } from "../pipeline/lookup.js";
import { todoList, addTodo, updateTodo } from "../pipeline/todo.js";
import { projectStats, snapshotTodo } from "../pipeline/project.js";
import { PARTS } from "../hub/extras.js";
import { cardStores } from "../hub/settings.js";
import { channelModule, channelIds, withAbility } from "../pipeline/channels/index.js";
import { listTrades, newTrade, editTrade, addItems, addFromCollection, editItem, confirmTrade, undoTrade, deleteTrade } from "../pipeline/trades.js";
import { collection, addCards, importCsv, updateCard, deckList, refreshPrices, searchNames, printingsOf, resolveMany, priceOf } from "../pipeline/collection.js";
import { tradeUp, saveSettings as saveTradeSettings, addWant, removeWant, tradeIdeas, setWantTarget } from "../pipeline/tradeup.js";
import { deckIdeasList, makeDeckIdeas, deleteDeckIdea } from "../pipeline/deckideas.js";
import { healthStatus, startHealthCheck, clearErrors } from "../pipeline/health.js";
import { runBackup, lastBackup, listBackups, restoreBackup } from "../pipeline/backup.js";
import { askInsights, lastInsights } from "../pipeline/insights.js";
import { postingStats } from "../pipeline/learnings.js";
import { reviewRules, lastReview, rulesStatus } from "../pipeline/rules.js";
import { startRun, withRun, onceState, readRuns, logEvent } from "../pipeline/runlog.js";
import { skipBatch } from "../pipeline/context.js";
import { planCleanup } from "../pipeline/cleanup.js";
import { freeUpSpace, runFreeUp } from "../pipeline/freespace.js";
import { pauseState, setPaused, diskInfo, cleanupDisk, msrpTable, saveMsrpTable, downloadables, versions, scheduleTable, saveSchedule } from "../pipeline/admin.js";
import { versionHistory } from "../pipeline/versions.js";
import { queueView } from "../pipeline/queue.js";
import { glanceNow } from "../pipeline/glance.js";
import { forecastNow, latestMoneyNote, roster as agentRoster } from "../pipeline/agents.js";
import { correctionSummary, recordCorrection, holdStats } from "../pipeline/corrections.js";
import { rate, ratings } from "../pipeline/ratings.js";
import { creditStatus, setCredit } from "../pipeline/credits.js";
import { appInfo, restartApp, kitInfo } from "../pipeline/restart.js";
import { checkForUpdate } from "../hub/updatecheck.js";
import { aiSettings, saveAiSettings, resolveModel, hasGemini, testResults, spendSummary } from "../pipeline/ai.js";
import { startScan, scanStatus, lastScan, watchConfig, saveWatchConfig, watchLists, toCsv } from "../pipeline/dealwatch.js";
import { helperStatus, saveHelperSettings } from "../hub/helpers.js";
import { pipelineCapStatus, savePipelineCap } from "../hub/pipelinecap.js";
import { passOffStatus, savePassOff } from "../pipeline/refusal.js";
import { passwordConfirmed, requirePasswordConfirmed, logSecurity, recentSecurityLog, deviceList, forgetDevice } from "../security.js";

export const pipelineRouter = Router();

// Every button press (any POST here) goes in the run log: what, the result code, how long it took to answer.
// Only these body fields are kept, so photos, passwords and review text never land in the log.
const LOGGED_FIELDS = ["force", "quick", "enabled", "when", "alert", "live", "bigCardNm", "test", "plan"];
pipelineRouter.use((req, res, next) => {
  if (req.method !== "POST") return next();
  const started = Date.now();
  res.on("finish", () => {
    const body = Object.fromEntries(LOGGED_FIELDS.filter((k) => req.body?.[k] !== undefined).map((k) => [k, req.body[k]]));
    logEvent("app action", { action: req.path, status: res.statusCode, answeredMs: Date.now() - started, ...(Object.keys(body).length ? { body } : {}), error: res.statusCode >= 400 ? `answered ${res.statusCode}` : null });
  });
  next();
});

// Caps per hour, so a session in the wrong hands can't run up the Claude bill or fill the disk.
const hits = new Map();
const perHour = (key, max) => (req, res, next) => {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < 3600000);
  if (list.length >= max) {
    logSecurity(req, `rate cap hit: ${key}`);
    return res.status(429).json({ error: `That's the limit of ${max} an hour. Try again later.` });
  }
  list.push(now);
  hits.set(key, list);
  next();
};

// Job ids come from the URL, so only allow the pipeline's own id format (no slashes or dots).
// ":id" is always a pipeline job id (checked here); other lists use ":item" for their own ids.
pipelineRouter.param("id", (req, res, next, id) => (JOB_ID.test(id) ? next() : res.status(404).json({ error: "Unknown job" })));

// Time left on a running job: typical time for each step still to go, from earlier jobs on the same channel.
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
function stepTimes(jobs) {
  const out = {};
  for (const j of jobs) for (const [k, ms] of Object.entries(j.data.stageTimes || {})) ((out[j.channel] ??= {})[k] ??= []).push(ms);
  for (const ch of Object.values(out)) for (const k of Object.keys(ch)) ch[k] = median(ch[k]);
  return out;
}
function progress(j, times) {
  const stages = channelModule(j.channel)?.stages;
  if (!stages || !j.stage || j.status === "done") return null;
  const i = stages.indexOf(j.stage);
  const typical = times[j.channel] || {};
  const stageMs = j.stageStartedAt ? Date.now() - Date.parse(j.stageStartedAt) : null;
  let left = 0, known = true;
  for (const s of stages.slice(Math.max(0, i))) {
    if (j.data.testRun && TEST_SKIPS.includes(s)) continue;
    if (s === "audit" || s === "review") continue; // these wait for the owner, not the PC
    if (typical[s] == null) {
      known = false;
      continue;
    }
    left += s === j.stage && j.status === "running" ? Math.max(0, typical[s] - (stageMs || 0)) : typical[s];
  }
  // For a stopped job, leftMs is how long a retry from this step usually takes.
  return { step: i + 1, steps: stages.length, stageMs: j.status === "running" ? stageMs : null, leftMs: known ? left : null };
}

export const summary = (j, times = {}) => ({
  id: j.id,
  channel: j.channel,
  sourceName: j.sourceName,
  status: j.status,
  stage: j.stage,
  createdAt: j.createdAt,
  updatedAt: j.updatedAt,
  hold: j.hold,
  error: j.error,
  flags: j.flags,
  batchWaiting: Boolean(j.data.batchWaiting) && j.status === "running",
  episode: j.data.episode,
  net: j.data.net,
  title: j.data.meta_out?.title,
  description: j.data.meta_out?.description,
  tags: j.data.meta_out?.tags,
  pinnedComment: j.data.meta_out?.pinned_comment,
  tiktok: j.data.meta_out?.tiktok_caption,
  tiktokPost: j.data.tiktok
    ? {
        status: j.data.tiktok.status,
        privacy: j.data.tiktok.privacy,
        url: j.data.tiktok.url,
        error: j.data.tiktok.error,
        why: j.data.tiktok.why,
        retryAt: j.data.tiktok.retryAt,
      }
    : null,
  videoId: j.data.videoId,
  visibility: j.data.visibility,
  publishAt: j.data.publishAt,
  pinPending: Boolean(j.data.pinPending),
  pinned: Boolean(j.data.pinned),
  hasOutput: Boolean(j.data.output),
  cards: (j.data.priced || j.data.cards)?.map((c) => ({
    index: c.index,
    name: c.name,
    price: c.price,
    foil: c.foil,
    number: c.collector_number || c.number,
    unsure: Boolean(c.confidence && c.confidence !== "high"),
  })),
  log: j.log.slice(-6),
  progress: progress(j, times),
  testRun: Boolean(j.data.testRun),
  // Screenshots Studio showed when an upload or pin failed.
  shots: [
    ...(["failed", "held"].includes(j.status) || j.error ? ["studio-error.png", "pin-error.png", "visibility-error.png"] : []),
    ...(j.data.tiktok?.status === "failed" ? ["tiktok-error.png"] : []),
  ].filter((f) => fs.existsSync(path.join(jobDir(j.id), f))),
});

pipelineRouter.get("/jobs", (req, res) => {
  const jobs = listJobs();
  const times = stepTimes(jobs);
  // Where each queued job is in line, and what the PC is busy with (one job at a time).
  const running = jobs.find((j) => j.status === "running" || j.status === "publishing");
  const line = jobs.filter((j) => j.status === "queued").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const busy = running && { label: jobLabel(running), batch: Boolean(running.data.batchWaiting), id: running.id };
  res.json(jobs.slice(0, 100).map((j) => ({ ...summary(j, times), ...(j.status === "queued" ? { queue: { ahead: line.indexOf(j), busy, batch: batchReady(j) } } : {}) })));
});
pipelineRouter.get("/jobs/:id", (req, res) => res.json(loadJob(req.params.id)));

const action = (fn) => safe(async (req) => summary(await fn(req)));
// Approving a held video on a live channel can post it, so that needs the password too.
pipelineRouter.post("/jobs/:id/continue", requirePasswordConfirmed, action((req) => continueJob(req.params.id, req.body?.review, req.body?.answers)));
// Optional thumbs up / down on Ask Claude suggestions and rules-review items; the next run learns from them.
pipelineRouter.get("/stats/ratings/:channel", (req, res) => res.json(ratings(req.params.channel)));
pipelineRouter.post("/stats/rate", safe((req) => {
  if (!channelCfg(req.body?.channel)) throw new Error("Unknown channel.");
  return rate(req.body);
}));
// Feedback on any job, any time (the owner: every output needs a way to feed back). Saved as a correction for the step it's
// about, so that step's AI sees it on later videos and the rules review gets it too.
pipelineRouter.post("/jobs/:id/feedback", action((req) => {
  const job = loadJob(req.params.id);
  const text = String(req.body?.text ?? "").trim().slice(0, 2000);
  if (!text) throw new Error("Write the feedback first.");
  const known = channelModule(job.channel)?.stages || [];
  const stage = known.includes(req.body?.stage) ? req.body.stage : "other";
  recordCorrection(job, { feedback: text, stage, action: "feedback", problem: `${OWNER()}'s feedback on the ${job.status === "done" ? "finished video" : "job"}` });
  logJob(job, `${OWNER()}'s feedback (${stage}): ${text.slice(0, 300)}`);
  saveJob(job);
  return job;
}));
pipelineRouter.post("/jobs/:id/retry", requirePasswordConfirmed, action((req) => retryJob(req.params.id)));
pipelineRouter.post("/jobs/:id/pin", requirePasswordConfirmed, action((req) => pinAgain(req.params.id)));
pipelineRouter.post("/jobs/:id/unskip", requirePasswordConfirmed, action((req) => unskipJob(req.params.id)));
pipelineRouter.post("/jobs/:id/remake", requirePasswordConfirmed, action((req) => remakeJob(req.params.id)));
pipelineRouter.post("/jobs/:id/restart", requirePasswordConfirmed, action((req) => restartJob(req.params.id)));
// Stops waiting on the half-price batch for this job: the current call is asked again at full price, and so are its later steps.
// Push batch: every job waiting on or lined up for the half-price batch runs now at full price.
// Admin tools (admin.js). Each answers JSON; errors come back as {error}.
pipelineRouter.get("/admin/pause", safe(() => pauseState()));
pipelineRouter.post("/admin/pause", safe((req) => setPaused(req.body?.paused)));
// Standby: this copy never posts (for moving the hub to another computer). Both ways need the password: turning it off makes this copy post.
pipelineRouter.get("/admin/standby", safe(() => standbyState()));
pipelineRouter.post("/admin/standby", requirePasswordConfirmed, safe((req) => {
  const on = req.body?.standby === true;
  logSecurity(req, on ? "standby on" : "standby off (this copy posts again)");
  return setStandby(on, on ? String(req.body?.reason || "Turned on from Admin").slice(0, 200) : "");
}));
// AI helpers (src/hub/helpers.js): the one switch and the daily $ limit. ON or a higher limit needs the password; OFF or a lower one doesn't.
pipelineRouter.get("/admin/helpers", safe(() => helperStatus()));
pipelineRouter.post("/admin/helpers", (req, res) => {
  const r = saveHelperSettings(req.body || {}, passwordConfirmed(req));
  if (r.status === 200) logSecurity(req, `AI helpers ${r.body.on ? "on" : "off"}, limit ${r.body.perDayUsd === null ? "none" : `$${r.body.perDayUsd} a day`}`);
  res.status(r.status).json(r.body);
});
// Pipeline AI budget (src/hub/pipelinecap.js): an optional monthly cap on the pipeline's own AI spend. A higher cap or none needs the password; a lower one doesn't.
pipelineRouter.get("/admin/pipeline-cap", safe(() => pipelineCapStatus()));
pipelineRouter.post("/admin/pipeline-cap", (req, res) => {
  const r = savePipelineCap(req.body || {}, passwordConfirmed(req));
  if (r.status === 200) logSecurity(req, `Pipeline AI budget ${r.body.capUsdMonth === null ? "none" : `$${r.body.capUsdMonth} a month`}`);
  res.status(r.status).json(r.body);
});
// Refusal pass-off (src/pipeline/refusal.js): the hub-wide switch. ON needs the password; OFF doesn't.
pipelineRouter.get("/admin/passoff", safe(() => passOffStatus()));
pipelineRouter.post("/admin/passoff", (req, res) => {
  const r = savePassOff(req.body || {}, passwordConfirmed(req));
  if (r.status === 200) logSecurity(req, `Refusal pass-off ${r.body.on ? "on" : "off"}`);
  res.status(r.status).json(r.body);
});
pipelineRouter.get("/admin/devices", safe((req) => deviceList(req)));
pipelineRouter.post("/admin/devices/forget", safe((req) => (forgetDevice(req, String(req.body?.id || "")), deviceList(req))));
pipelineRouter.get("/admin/rolls", safe(async () => (await import("../pipeline/roll.js")).rollStatus()));
pipelineRouter.get("/admin/disk", safe(() => diskInfo()));
pipelineRouter.get("/admin/disk/plan", safe(() => planCleanup()));
// Free up space: GET lists everything that could be freed (read-only); POST removes only the groups ticked, with the password.
pipelineRouter.get("/admin/free", safe(() => freeUpSpace()));
pipelineRouter.post("/admin/free", requirePasswordConfirmed, safe((req) => {
  const { groups, ids, confirmOk } = req.body || {};
  if (!Array.isArray(groups) || !groups.length || groups.some((g) => typeof g !== "string")) throw new Error("Tick at least one group");
  if (ids != null && (!Array.isArray(ids) || ids.length > 500 || ids.some((i) => typeof i !== "string"))) throw new Error("ids must be a list of up to 500 job ids");
  return runFreeUp({ groups, ids: ids || null, confirmOk: confirmOk === true });
}));
// The confirm step: removes exactly the jobs in ids (the list the owner saw), nothing else. Originals and the final
// render go only when asked for here AND allowed by the clean-up settings.
pipelineRouter.post("/admin/disk/cleanup", requirePasswordConfirmed, safe((req) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some((i) => typeof i !== "string")) throw Object.assign(new Error("Send the ids of the jobs from the clean-up list (up to 500)"), { status: 400 });
  return cleanupDisk({ ids, originals: req.body?.originals === true, output: req.body?.output === true });
}));
pipelineRouter.get("/admin/credits", safe(() => creditStatus()));
pipelineRouter.post("/admin/credits", safe((req) => setCredit(req.body || {})));
pipelineRouter.get("/admin/schedule", safe(() => scheduleTable()));
pipelineRouter.get("/admin/posting-stats", safe(async () => Object.fromEntries(await Promise.all(channelIds().map(async (id) => [id, await postingStats(id).catch(() => null)])))));
pipelineRouter.post("/admin/schedule", safe((req) => saveSchedule(req.body?.rows, req.body?.why)));
// The episode-number check of a numbered series (the first channel whose module has one).
pipelineRouter.get("/admin/episode-check", safe(() => { const id = withAbility("continuityAudit")[0]; return id ? channelModule(id).continuityAudit() : null; }));
pipelineRouter.get("/admin/msrp", safe(() => msrpTable()));
// Footage left, for a channel whose module plans it (youtube-settings.html). The page still calls the old path,
const footage = (id) => { const m = channelModule(id); if (!m?.footagePlan) throw new Error("That channel doesn't plan footage."); return m.footagePlan(); };
pipelineRouter.get("/channels/:channel/footage", safe((req) => footage(req.params.channel)));
pipelineRouter.post("/admin/msrp", safe((req) => saveMsrpTable(req.body?.rows)));
pipelineRouter.get("/admin/downloads", safe(() => downloadables().map(({ file, ...d }) => ({ ...d, ready: Boolean(file) }))));
pipelineRouter.get("/admin/download/:key", (req, res) => {
  const d = downloadables().find((x) => x.key === req.params.key);
  if (!d?.file) return res.status(404).json({ error: "That file isn't there." });
  res.download(d.file, d.name);
});
pipelineRouter.get("/admin/versions", safe(() => versions()));
pipelineRouter.get("/admin/history", safe(() => versionHistory()));
// "Check for an update" button: the one outside request an update ever makes, and only when pressed (never on page load). Same answer as `npm run update -- --check`; kept for an hour; no request at all when no update address is set.
let updateAnswer = null;
pipelineRouter.get("/admin/update-check", safe(async () => {
  const k = kitInfo();
  if (updateAnswer && updateAnswer.url === k.updatesUrl && updateAnswer.current === k.version && Date.now() - updateAnswer.at < 3600000) return { ...updateAnswer.answer, cached: true, checkedAt: new Date(updateAnswer.at).toISOString() };
  const answer = await checkForUpdate({ url: k.updatesUrl, current: k.version });
  if (answer.asked && answer.ok) updateAnswer = { at: Date.now(), url: k.updatesUrl, current: k.version, answer };
  return { ...answer, cached: false, checkedAt: new Date().toISOString() };
}));
pipelineRouter.get("/corrections", safe(() => ({ ...correctionSummary(), holds: channelIds().flatMap((ch) => holdStats(ch).map((h) => ({ channel: ch, ...h }))) })));
pipelineRouter.post("/jobs/clear-skipped", safe(() => clearSkipped()));
pipelineRouter.post("/batch/push", requirePasswordConfirmed, (req, res) => {
  const ids = listJobs().filter((j) => (j.status === "running" && j.data?.batchWaiting) || (j.status === "queued" && j.data && batchReady(j))).map((j) => j.id);
  ids.forEach((id) => skipBatch.add(id));
  logEvent("batch push", { jobs: ids.length });
  res.json({ pushed: ids.length });
});
pipelineRouter.post("/jobs/:id/full-price", requirePasswordConfirmed, action((req) => (skipBatch.add(req.params.id), loadJob(req.params.id))));
// Making a private upload public posts it, so it needs the password like going live does.
pipelineRouter.post("/jobs/:id/in-studio", requirePasswordConfirmed, action((req) => markUploaded(req.params.id, req.body?.link, req.body?.publishAt)));
pipelineRouter.post("/jobs/:id/publish", requirePasswordConfirmed, (req, res, next) => {
  logSecurity(req, `make public: ${req.params.id} (${req.body?.when})`);
  next();
}, action((req) => publishJob(req.params.id, req.body?.when)));
// A TikTok retry can post publicly (when the YouTube video is live), so it needs the password too.
pipelineRouter.post("/jobs/:id/tiktok", requirePasswordConfirmed, (req, res, next) => {
  logSecurity(req, `tiktok retry: ${req.params.id}`);
  next();
}, action((req) => retryTikTok(req.params.id)));
pipelineRouter.get("/tiktok/catchup", safe(() => tiktokCatchUp()));
pipelineRouter.post("/jobs/:id/skip", action((req) => skipJob(req.params.id)));

pipelineRouter.get("/jobs/:id/video", (req, res) => {
  const job = loadJob(req.params.id);
  sendIfThere(res, job.data.output || "");
});

pipelineRouter.get("/jobs/:id/files/:name", (req, res) => {
  const file = path.join(jobDir(req.params.id), path.basename(req.params.name));
  sendIfThere(res, file);
});

// Card frames the reader used (cards/c3a.jpg, c3b.jpg), for checking cards from the phone.
pipelineRouter.get("/jobs/:id/cards/:name", (req, res) => {
  if (!/^c\d{1,3}[ab]\.jpg$/.test(req.params.name)) return res.status(404).end();
  sendIfThere(res, path.join(jobDir(req.params.id), "cards", req.params.name));
});

pipelineRouter.get("/channels", (req, res) => {
  const { channels } = loadPipelineConfig();
  res.json(Object.fromEntries(Object.entries(channels).map(([k, c]) => [k, { name: c.name, enabled: c.enabled, live: c.live, postingMode: c.postingMode, slots: c.slots }])));
});

// Going live is the owner's explicit choice, made from the dashboard, and needs the password. Back to test mode doesn't.
pipelineRouter.post("/channels/:channel/live", (req, res) => {
  const cfg = loadPipelineConfig();
  const ch = cfg.channels[req.params.channel];
  if (!ch) return res.status(404).json({ error: "Unknown channel" });
  const live = req.body?.live === true;
  if (live && !passwordConfirmed(req)) return res.status(403).json({ error: "Enter your password to do this.", needPassword: true });
  ch.live = live;
  savePipelineConfig(cfg);
  logSecurity(req, `${req.params.channel} ${live ? "went live" : "back to test mode"}`);
  res.json({ live: ch.live });
});

// Stats page: tracker data plus the state of the latest "Pull stats" run.
pipelineRouter.get("/stats", safe(async () => {
  // Reach numbers (impressions, click rate, viewed vs swiped away) per video, from pulls that opened the Reach tab.
  const ex = statsExtras();
  const reach = {};
  for (const id of Object.keys(videoStats())) {
    const e = ex(id);
    if (e.ctr != null || e.impressions != null || e.viewedVsSwiped != null) reach[id] = { impressions: e.impressions, ctr: e.ctr, viewedVsSwiped: e.viewedVsSwiped, subsPer1k: e.subsPer1k };
  }
  return { ...(await exportStats()), reach, gained7: viewsGained(7), pull: pullStatus() };
}, { status: 500, message: (err) => err.message.replace(/^.*?exited \d+: /s, "").trim() }));
pipelineRouter.get("/stats/pull", (req, res) => res.json(pullStatus()));
// Comment text per video (top-level comments, most liked first, 20 a video) for the comment highlights on the stats pages.
pipelineRouter.get("/export/:list", async (req, res) => {
  try {
    const { exportCsv } = await import("../pipeline/exports.js");
    const f = exportCsv(req.params.list);
    logEvent("app action", { trigger: "button", action: "download csv", list: req.params.list });
    sendCsv(res, f.name, f.body);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
pipelineRouter.get("/search", safe((req) => import("../pipeline/search.js").then((m) => m.searchAll(req.query.q))));
pipelineRouter.post("/digest/send", perHour("digest", 4), safe(() => import("../pipeline/digest.js").then((m) => m.sendDigest({ trigger: "button" }))));
pipelineRouter.get(
  "/stats/comments",
  safe(() =>
    Object.fromEntries(
      Object.entries(commentStats()).map(([id, c]) => [
        id,
        {
          count: c.count,
          asOf: c.asOf,
          items: (c.items || [])
            .filter((x) => !x.reply)
            .sort((a, b) => (b.likes || 0) - (a.likes || 0))
            .slice(0, 20)
            .map((x) => ({ text: String(x.text || "").slice(0, 300), author: x.author, likes: x.likes || 0 })),
        },
      ]),
    ),
  ),
);
// TikTok posts with their numbers, each beside the YouTube clip it came from.
pipelineRouter.get("/stats/tiktok", safe(async () => {
  const t = tiktokStats();
  const clips = Object.fromEntries(((await exportStats().catch(() => ({}))).clips || []).filter((c) => c.videoId).map((c) => [c.videoId, c]));
  return Object.fromEntries(
    Object.entries(t.channels || {}).map(([ch, d]) => [
      ch,
      {
        asOf: d.asOf,
        posts: Object.values(d.posts || {}).map((p) => ({
          ...p,
          youtube:
            p.youtubeId && clips[p.youtubeId]
              ? {
                  title: clips[p.youtubeId].title,
                  views: clips[p.youtubeId].views,
                  creator: clips[p.youtubeId].creator,
                  date: clips[p.youtubeId].date,
                }
              : null,
        })),
      },
    ]),
  );
}));
pipelineRouter.get("/stats/tiktok/pull", (req, res) => res.json(tiktokPullState()));
pipelineRouter.post("/stats/tiktok/pull", (req, res) => res.json(pullTikTokStats()));
pipelineRouter.post("/stats/pull", (req, res) => res.json(startPull({ quick: req.body?.quick === true, plan: req.body?.plan && typeof req.body.plan === "object" ? req.body.plan : undefined })));
pipelineRouter.post("/stats/pull/stop", (req, res) => res.json(stopPull()));
pipelineRouter.get("/stats/pull/plan", safe(() => pullPlanInfo(), { status: 500, message: firstLine }));
// Ask Claude and the rules check take minutes, so they run in the background: leaving the page doesn't stop them,
// and the page picks the run back up (still running, or its result) when the owner comes back.
// The job is a withRun with the same once key; a second press joins it. The page polls { running, since, error }.
const bgState = onceState;
const bgStart = (key, job) => (job.catch(() => {}), onceState(key));

pipelineRouter.get("/stats/insights/:channel", (req, res) => {
  if (!statsChannels().includes(req.params.channel)) return res.status(400).json({ error: "Unknown channel." });
  res.json({ ...(lastInsights(req.params.channel) || {}), task: bgState(`insights:${req.params.channel}`) });
});
pipelineRouter.get("/stats/rules/:channel", async (req, res) => {
  if (!statsChannels().includes(req.params.channel)) return res.status(400).json({ error: "Unknown channel." });
  res.json({ review: lastReview(req.params.channel), status: await rulesStatus(req.params.channel).catch(() => null), task: bgState(`rules:${req.params.channel}`) });
});
pipelineRouter.post("/stats/rules/:channel", requirePasswordConfirmed, perHour("rules reviews", 4), (req, res) => {
  const ch = req.params.channel;
  if (!statsChannels().includes(ch)) return res.status(400).json({ error: "Unknown channel." });
  res.json({ task: bgStart(`rules:${ch}`, reviewRules(ch)) });
});
pipelineRouter.post("/stats/insights/:channel", requirePasswordConfirmed, perHour("stats suggestions", 10), (req, res) => {
  const ch = req.params.channel;
  if (!statsChannels().includes(ch)) return res.status(400).json({ error: "Unknown channel." });
  res.json({
    task: bgStart(`insights:${ch}`, withRun("ask claude", { channel: ch }, async () => ({ counts: { suggestions: (await askInsights(ch))?.suggestions?.length ?? null } }), { once: `insights:${ch}` })),
  });
});

// a channel creators: roster names only; the rest get a frame check or the owner's answer.
pipelineRouter.get("/stats/creators", safe(async () => {
  const clips = (await exportStats()).clips || [];
  const by = {};
  for (const c of clips) by[c.creatorSource] = (by[c.creatorSource] || 0) + 1;
  const unverified = clips.filter((c) => c.creatorSource === "unverified" && c.videoId).map((c) => ({ videoId: c.videoId, title: c.title, date: c.date, views: c.views, logged: c.creatorLogged, suggestion: c.creatorSuggestion }));
  return { counts: by, unverified, roster: Object.keys(roster()), check: checkState, toCheck: unverified.filter((u) => !u.suggestion).length };
}, { status: 500, message: firstLine }));
pipelineRouter.post("/stats/creators/check", requirePasswordConfirmed, perHour("creator checks", 6), safe(async (req) => startCreatorCheck((await exportStats()).clips || [], { limit: Math.min(100, Math.max(1, Number(req.body?.limit) || 40)) }), { status: 500, message: firstLine }));
pipelineRouter.post("/stats/creators/confirm", safe(async (req) => {
  if (!/^[\w-]{6,20}$/.test(String(req.body?.videoId || ""))) throw new Error("Bad video ID");
  const saved = confirmCreator(req.body.videoId, String(req.body.name || ""));
  const fixed = await fixLogCreators().catch((err) => ({ error: firstLine(err) }));
  return { saved, log: fixed };
}));

// Remote restart (start-pipeline.cmd brings it back). Needs the password, like going live.
pipelineRouter.get("/app", (req, res) => res.json(appInfo()));
pipelineRouter.post("/app/restart", requirePasswordConfirmed, (req, res) => {
  logSecurity(req, `restart${req.body?.force ? " (forced)" : ""}`);
  const r = restartApp({ force: req.body?.force === true });
  res.status(r.ok ? 200 : 409).json(r);
});

// AI models per step and the side-by-side test (plans/ai-cost-plan.md).
const AI_MODELS = ["", "haiku", "sonnet", "opus", "gemini-flash", "gemini-pro"];
pipelineRouter.get("/ai", async (req, res) => {
  const s = aiSettings();
  const names = {};
  for (const m of AI_MODELS.filter(Boolean)) names[m] = await resolveModel(m).then((r) => r.model).catch((err) => `unavailable: ${err.message}`);
  res.json({ settings: s, models: AI_MODELS, resolved: names, defaultModel: config.model, gemini: hasGemini(), results: testResults(), spend: spendSummary(readRuns({ kinds: ["ai call"], limit: 20000 })) });
});
pipelineRouter.post("/ai/settings", (req, res) => {
  const b = req.body || {};
  // A change that can cost more (shadow on, batch off, a step's model) needs the password (security plan 03).
  const dearer = b.shadowOn === true || b.batchOn === false || (b.step && b.model !== undefined);
  if (dearer && !passwordConfirmed(req)) return res.status(403).json({ error: "Enter your password to do this.", needPassword: true });
  const patch = {};
  if (typeof b.batchOn === "boolean") patch.batch = { on: b.batchOn };
  if (typeof b.shadowOn === "boolean") patch.shadow = { on: b.shadowOn, ...(b.shadowOn && b.restart ? { startedAt: null } : {}) };
  if (b.step && /^[a-z_]+$/.test(b.step) && AI_MODELS.includes(b.model ?? "")) {
    const steps = { ...aiSettings().steps };
    if (b.model) steps[b.step] = { model: b.model };
    else delete steps[b.step];
    patch.steps = steps;
  }
  res.json(saveAiSettings(patch));
});

// Run log: start/end, counts, step times, warnings and errors for every pull, scan, check, backup and job.
const RUN_KINDS = [
  "creator check",
  "restart",
  "app action",
  "ai call",
  "alert",
  "make public",
  "pin comment",
  "quick pull",
  "full pull",
  "advanced pull",
  "deal scan",
  "health check",
  "backup",
  "restore",
  "disk cleanup",
  "log roll",
  "free up space",
  "pause",
  "msrp edit",
  "rules review",
  "pipeline job",
  "card lookup",
  "ask claude",
  "collection import",
  "collection photo",
  "collection prices",
  "tiktok post",
  "app update",
  "trade-up ideas",
  "trade",
  "reading check",
  "deck ideas",
  "wow pull",
];
pipelineRouter.get("/runs", (req, res) => {
  const kinds = String(req.query.kind || "").split(",").filter((k) => RUN_KINDS.includes(k));
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  res.json({ kinds: RUN_KINDS, runs: readRuns({ kinds, limit }) });
});

// a local store DMG deal watch (Cards area).
pipelineRouter.get("/cards/watch", async (req, res) => {
  const cfg = watchConfig();
  const lists = await watchLists(cfg).catch(() => null);
  res.json({
    status: scanStatus(),
    last: lastScan(),
    config: { bigCardNm: cfg.bigCardNm, enabled: cfg.enabled !== false, hour: cfg.hour, minute: cfg.minute, stores: cfg.stores },
    lists: lists && { source: lists.source, deck: lists.petDeck.length, wishlist: lists.wishlist, needed: lists.needed },
  });
});
pipelineRouter.get("/cards/watch/status", (req, res) => res.json(scanStatus()));
// MTG Arena tracking (arena.js), read from Arena's own log.
// Posting calendar (calendar.js): every YouTube and TikTok post, out and booked.
pipelineRouter.get("/calendar", safe(() => import("../pipeline/calendar.js").then((m) => m.postingCalendar())));
// Anime and manga tracker (reading.js): AniList and MangaUpdates, read-only.
const reading = () => import("../pipeline/reading.js");
pipelineRouter.get("/reading", safe(() => reading().then((m) => m.readingList())));
pipelineRouter.post("/reading/search", safe((req) => reading().then((m) => m.searchTitles(req.body?.q, req.body?.kind))));
pipelineRouter.post("/reading/add", safe((req) => reading().then((m) => m.addTitle(req.body || {}))));
pipelineRouter.post("/reading/check", perHour("reading checks", 6), safe(() => reading().then((m) => m.checkAll({ trigger: "button" }))));
pipelineRouter.post("/reading/:item/remove", safe((req) => reading().then((m) => m.removeItem(req.params.item))));
pipelineRouter.post("/reading/:item", safe((req) => reading().then((m) => m.updateItem(req.params.item, req.body || {}))));

// Paper Magic matches (papermagic.js): typed in by hand, kept on the PC.
const paper = () => import("../pipeline/papermagic.js");
pipelineRouter.get("/paper-matches", safe(() => paper().then((m) => m.matchStats())));
pipelineRouter.post("/paper-matches", safe((req) => paper().then((m) => m.addMatch(req.body || {}))));
pipelineRouter.post("/paper-matches/:item/delete", safe((req) => paper().then((m) => m.deleteMatch(req.params.item))));
pipelineRouter.post("/paper-matches/:item", safe((req) => paper().then((m) => m.editMatch(req.params.item, req.body || {}))));

// WoW raid summary (wow.js): Warcraft Logs V2 for Classic, read-only, keys in .env.
const wow = () => import("../pipeline/wow.js");
pipelineRouter.get("/wow", safe(() => wow().then((m) => m.wowStats())));
pipelineRouter.post("/wow/characters", safe((req) => wow().then((m) => m.saveWowSettings(req.body || {}))));
pipelineRouter.post("/wow/pull", perHour("wow pulls", 10), safe(() => wow().then((m) => m.pullWow({ trigger: "button" }))));

// Games (games.js): any game you play, typed in by hand, with add-ons for games that have more (WoW, MTG Arena).
// Add-ons whose part is switched off aren't offered (src/hub/modules.js).
const games = () => Promise.all([import("../pipeline/games.js"), import("../hub/modules.js")]).then(([g, m]) => ({ g, opts: { on: m.modulesOn() } }));
pipelineRouter.get("/games", safe(() => games().then(({ g, opts }) => g.gamesList(opts))));
pipelineRouter.post("/games", safe((req) => games().then(({ g, opts }) => g.addGame(req.body || {}, opts))));
pipelineRouter.post("/games/:item/remove", safe((req) => games().then(({ g, opts }) => g.removeGame(req.params.item, opts))));
pipelineRouter.post("/games/:item", safe((req) => games().then(({ g, opts }) => g.updateGame(req.params.item, req.body || {}, opts))));

pipelineRouter.get("/arena", safe(() => import("../pipeline/arena.js").then((m) => m.arenaStats())));
pipelineRouter.post("/arena/read", safe(() => import("../pipeline/arena.js").then((m) => ({ ...m.ingestArena({ force: true }), ...m.arenaStats() }))));
pipelineRouter.post("/cards/watch/scan", perHour("deal watch scans", 4), (req, res) => res.json(startScan({ alert: false })));
pipelineRouter.post("/cards/watch/config", (req, res) => {
  const patch = {};
  if (Number.isFinite(req.body?.bigCardNm) && req.body.bigCardNm > 0 && req.body.bigCardNm < 100000) patch.bigCardNm = req.body.bigCardNm;
  if (typeof req.body?.enabled === "boolean") patch.enabled = req.body.enabled;
  res.json(saveWatchConfig(patch));
});
pipelineRouter.get("/cards/watch/csv", (req, res) => {
  const last = lastScan();
  if (!last?.items) return res.status(404).json({ error: "No scan yet." });
  sendCsv(res, `${cardStores().shop} DMG watch ${last.at.slice(0, 10)}.csv`, toCsv(last));
});

// Single-card price check. Send a photo (base64 JPEG, resized in the browser) and/or the card details to use.
// The latest card lookup, kept so the page can pick it up again (still running, or its result) after the owner leaves it.
let lastLookup = { running: false };
pipelineRouter.get("/lookup/last", (req, res) => res.json(lastLookup));
pipelineRouter.post("/lookup", photoCap(1.5 * 1024 * 1024), (req, res, next) => (req.body?.image ? requirePasswordConfirmed(req, res, next) : next()), perHour("card lookups", 40), async (req, res, next) => {
  // The last photo read, so a re-check with fixed boxes can be compared against it.
  const prevRead = lastLookup.result?.read ? { read: lastLookup.result.read, at: lastLookup.at } : lastLookup.prevRead;
  lastLookup = { running: true, since: new Date().toISOString(), photo: Boolean(req.body?.image), prevRead };
  const send = res.json.bind(res);
  res.json = (body) => ((lastLookup = { running: false, at: new Date().toISOString(), ...(res.statusCode >= 400 ? { error: body?.error || "Lookup failed" } : { result: body }), prevRead: body?.read ? null : prevRead }), send(body));
  next();
}, async (req, res) => {
  const log = startRun("card lookup");
  try {
    const b = req.body || {};
    let read = null;
    if (b.image) log.step("Reading the photo");
    if (typeof b.image === "string" && b.image) {
      read = await readCardPhoto(b.image.replace(/^data:image\/\w+;base64,/, ""));
      if (!read.is_card) return log.end({ error: "No card in the photo" }), res.json({ read, error: "I couldn't find a Magic card in that photo. Try again closer, with the name in view." });
    }
    const card = {
      name: String(b.name || read?.name || "").trim(),
      setName: String(b.setName ?? read?.set_name ?? "").trim(),
      number: String(b.number ?? read?.collector_number ?? "").trim(),
      foil: ["foil", "nonfoil", "unknown"].includes(b.foil) ? b.foil : read?.foil || "unknown",
      treatment: read?.treatment || "regular",
    };
    if (!card.name) return res.status(400).json({ error: "Add a photo or type a card name." });
    // the owner re-running a photo read with fixed boxes teaches the photo reader (corrections.js, stage cardRead).
    const prev = !read && lastLookup.prevRead;
    if (prev && Date.now() - Date.parse(prev.at) < 30 * 60000) {
      const was = { name: prev.read.name, set: prev.read.set_name, number: prev.read.collector_number, foil: prev.read.foil };
      const now = { name: card.name, set: card.setName, number: card.number, foil: card.foil };
      const answers = Object.fromEntries(Object.entries(now).filter(([k, v]) => v && String(v).toLowerCase() !== String(was[k] ?? "").toLowerCase()).map(([k, v]) => [k, `${v} (read as ${was[k] || "blank"})`]));
      if (Object.keys(answers).length) recordCorrection({ id: "card-lookup", channel: "cards", sourceName: "card photo", hold: { stage: "cardRead", reason: "Card price check photo read" } }, { answers });
    }
    log.step("Checking stores");
    const prices = await lookupCard(card);
    // Which stores answered, for spotting a store whose page changed.
    const stores = Object.fromEntries(Object.entries(prices || {}).filter(([k, v]) => k !== "fx" && v && typeof v === "object").map(([k, v]) => [k, v.error ? `error: ${String(v.error).slice(0, 120)}` : "ok"]));
    log.end({ card: card.name, set: card.setName, fromPhoto: Boolean(read), stores });
    res.json({ read, card, prices });
  } catch (err) {
    log.end({ error: err.message.split("\n")[0] });
    res.status(500).json({ error: err.message.split("\n")[0] });
  }
});

// Card collection (collection.html). Local data plus free Scryfall lookups.
pipelineRouter.get("/collection", safe(() => collection()));
pipelineRouter.get("/collection/search", safe((req) => searchNames(String(req.query.q || "").slice(0, 80))));
pipelineRouter.get("/collection/printings", safe((req) => printingsOf(String(req.query.name || "").slice(0, 150))));
pipelineRouter.post("/collection/add", safe((req) => addCards((req.body?.cards || []).slice(0, 200), { source: "manual" })));
pipelineRouter.post("/collection/import", safe((req) => {
  const csv = String(req.body?.csv || "");
  if (csv.length > 1.8 * 1024 * 1024) throw new Error("That file is too big; split it.");
  return withRun("collection import", { trigger: "button" }, async () => {
    const r = await importCsv(csv, { lists: req.body?.list ? [String(req.body.list).slice(0, 40)] : [] });
    return { result: r, counts: { rows: r.rows, added: r.added, merged: r.merged, notFound: r.notFound.length } };
  });
}));
pipelineRouter.post("/collection/photo", photoCap(1.5 * 1024 * 1024), requirePasswordConfirmed, perHour("card lookups", 40), safe(async (req) => {
  const img = String(req.body?.image || "");
  if (!img) throw new Error("No photo.");
  return withRun("collection photo", { trigger: "button" }, async () => {
    const read = await readCardPhoto(img.replace(/^data:image\/\w+;base64,/, ""));
    if (!read.is_card) throw new Error("I couldn't find a Magic card in that photo. Try again closer, with the name in view.");
    const r = await addCards(
      [
        {
          name: read.name,
          set: read.set_code,
          number: read.collector_number,
          finish: read.foil === "foil" ? "foil" : "nonfoil",
          condition: req.body?.condition || "NM",
          lists: req.body?.list ? [String(req.body.list)] : [],
        },
      ],
      { source: "photo" },
    );
    return { result: { read, ...r }, counts: { card: read.name, set: read.set_code, added: r.added + r.merged } };
  });
}));
// Many cards in one photo: read them, match each on Scryfall, and send the list back for the owner to tick before
// anything is added (to the collection, or to one side of a trade).
pipelineRouter.post("/collection/photo-multi", photoCap(1.9 * 1024 * 1024), requirePasswordConfirmed, perHour("card lookups", 40), safe(async (req) => {
  const img = String(req.body?.image || "");
  if (!img) throw new Error("No photo.");
  return withRun("collection photo", { trigger: "button", multi: true }, async () => {
    const read = await readCardsPhoto(img.replace(/^data:image\/\w+;base64,/, ""));
    if (!read.cards.length)
      throw new Error(
        read.unreadable
          ? `I could see ${read.unreadable} card${read.unreadable === 1 ? "" : "s"} but couldn't read any names. Try closer, with the names in view.`
          : "I couldn't find any Magic cards in that photo.",
      );
    const found = await resolveMany(read.cards.map((c) => ({ name: c.name, set: c.set_code, number: c.collector_number })));
    const cards = read.cards.map((c, i) => {
      const p = found[i];
      const finish = c.foil === "foil" ? (p?.finishes?.includes("foil") ? "foil" : p?.finishes?.[0] || "foil") : p?.finishes?.includes("nonfoil") || !p?.finishes?.length ? "nonfoil" : p.finishes[0];
      return { read: c, match: p ? { scryfallId: p.scryfallId, name: p.name, set: p.set, setName: p.setName, number: p.number, image: p.image, finishes: p.finishes, finish, each: priceOf({ ...p, finish }), guessed: Boolean(p.guessed) } : null };
    });
    return { result: { cards, unreadable: read.unreadable }, counts: { cards: cards.length, matched: cards.filter((c) => c.match).length, unreadable: read.unreadable } };
  });
}));

// Trades (trades.js): cards out and in, valued, applied to the collection on Confirm (Undo reverses it).
const tradeLog = (what, fn) => (req) => withRun("trade", { trigger: "button", action: what }, async () => {
  const r = await fn(req);
  return { result: r, counts: { trade: req.params.tid || r?.id || null } };
});
const tradeId = (req) => {
  const id = String(req.params.tid || "");
  if (!isId(id)) throw new Error("Unknown trade.");
  return id;
};
// Hub to-do and idea inbox (todo.js).
pipelineRouter.get("/todo", safe(() => todoList()));
pipelineRouter.get("/project", safe(() => projectStats()));
// This owner's private parts (src/private/, never in the kit) add their own routes here.
for (const p of PARTS) p.routes?.(pipelineRouter, { safe, requirePasswordConfirmed });
const snapAfter = (r) => {
  try {
    snapshotTodo();
  } catch {}
  return r;
};
pipelineRouter.post("/todo", safe((req) => snapAfter(addTodo({ title: req.body?.title, detail: req.body?.detail, category: req.body?.category || "Unsorted", source: "idea" }))));
pipelineRouter.post("/todo/:todoId", safe((req) => {
  if (!isId(req.params.todoId)) throw new Error("Unknown item.");
  return snapAfter(updateTodo(req.params.todoId, req.body || {}));
}));
pipelineRouter.get("/collection/trades", safe(() => listTrades()));
pipelineRouter.post("/collection/trades", safe(tradeLog("new", (req) => newTrade(req.body || {}))));
pipelineRouter.post("/collection/trades/:tid/edit", safe((req) => editTrade(tradeId(req), req.body || {})));
pipelineRouter.post("/collection/trades/:tid/add", safe((req) => addItems(tradeId(req), String(req.body?.side || ""), (req.body?.cards || []).slice(0, 120), { source: String(req.body?.source || "manual").slice(0, 20) })));
pipelineRouter.post("/collection/trades/:tid/pick", safe((req) => addFromCollection(tradeId(req), String(req.body?.cardId || ""), req.body?.qty)));
pipelineRouter.post("/collection/trades/:tid/item", safe((req) => editItem(tradeId(req), String(req.body?.side || ""), String(req.body?.key || ""), req.body || {})));
pipelineRouter.post("/collection/trades/:tid/confirm", safe(tradeLog("confirm", (req) => confirmTrade(tradeId(req)))));
pipelineRouter.post("/collection/trades/:tid/undo", safe(tradeLog("undo", (req) => undoTrade(tradeId(req)))));
pipelineRouter.post("/collection/trades/:tid/delete", safe((req) => deleteTrade(tradeId(req))));
pipelineRouter.post("/collection/update", safe((req) => updateCard(String(req.body?.id || ""), req.body || {})));
pipelineRouter.post("/collection/decklist", safe((req) => deckList({ list: req.body?.list, text: req.body?.text, save: req.body?.save === true })));
pipelineRouter.post("/collection/refresh", safe(() => {
  return withRun("collection prices", { trigger: "button" }, async () => {
    const r = await refreshPrices();
    return { result: r, counts: { updated: r.updated, valueCad: r.valueCad } };
  }, { once: "prices" });
}));

// Trade-up (tradeup.js): suggestions only, nothing is bought or sold.
pipelineRouter.get("/collection/tradeup", safe(async () => ({ ...(await tradeUp()), task: bgState("tradeideas") })));
pipelineRouter.post("/collection/tradeup/settings", safe((req) => saveTradeSettings(req.body || {})));
pipelineRouter.post("/collection/tradeup/want", safe((req) => addWant({ scryfallId: req.body?.scryfallId, name: req.body?.name ? String(req.body.name).slice(0, 150) : undefined, finish: req.body?.finish === "foil" ? "foil" : "nonfoil" })));
pipelineRouter.post("/collection/tradeup/target", safe((req) => setWantTarget(String(req.body?.scryfallId || ""), req.body?.finish, req.body?.targetCad)));
pipelineRouter.post("/collection/tradeup/unwant", safe((req) => removeWant(String(req.body?.scryfallId || ""), req.body?.finish)));
pipelineRouter.post("/collection/tradeup/ideas", requirePasswordConfirmed, perHour("trade-up ideas", 6), (req, res) => {
  res.json({ task: bgStart("tradeideas", withRun("trade-up ideas", { trigger: "button" }, async () => ({ counts: { ideas: (await tradeIdeas()).list.length } }), { once: "tradeideas" })) });
});

// AI deck ideas (deckideas.js): decks from owned cards; ownership is checked here and prices come from Scryfall.
pipelineRouter.get("/collection/deckideas", safe(() => ({ ...deckIdeasList(), task: bgState("deckideas") })));
pipelineRouter.post("/collection/deckideas", requirePasswordConfirmed, perHour("deck ideas", 6), (req, res) => {
  const ask = { format: String(req.body?.format || "Either"), colours: String(req.body?.colours || ""), hint: String(req.body?.hint || "") };
  res.json({ task: bgStart("deckideas", withRun("deck ideas", { trigger: "button", ...ask }, async () => {
    const r = await makeDeckIdeas(ask);
    return { counts: { decks: r.decks.length, pool: r.pool } };
  }, { once: "deckideas" })) });
});
pipelineRouter.post("/collection/deckideas/:item/delete", safe((req) => deleteDeckIdea(String(req.params.item))));

// Health check and backups (also run on their own each day).
// What the pipeline is doing right now, for the Health cards on Home and Admin.
function jobsNow() {
  const jobs = listJobs();
  return {
    running: jobs.filter((j) => ["running", "publishing"].includes(j.status)).map((j) => ({ id: j.id, label: jobLabel(j), stage: j.stage, since: j.stageStartedAt, batch: Boolean(j.data?.batchWaiting) })),
    queued: jobs.filter((j) => j.status === "queued").length,
    held: jobs.filter((j) => j.status === "held").length,
    paused: pauseState().paused,
  };
}
pipelineRouter.get("/queue", safe(() => queueView(), { status: 500 }));
// The campus props' one call (page blocks, step 2): the queue board and the meter wall. Read-only.
pipelineRouter.get("/glance", safe(() => glanceNow({
  forecast: () => forecastNow(),
  paused: () => agentRoster().desks.filter((d) => d.status === "paused").map((d) => d.id),
  note: () => latestMoneyNote(),
})));
pipelineRouter.get("/health", (req, res) => res.json({ ...healthStatus(), backup: lastBackup(), jobs: jobsNow() }));
pipelineRouter.post("/health/clear-errors", (req, res) => res.json(clearErrors()));
pipelineRouter.post("/health/run", requirePasswordConfirmed, (req, res) => {
  startHealthCheck({ alert: req.body?.alert !== false, trigger: "button" });
  res.json({ running: true });
});
pipelineRouter.get("/health/image/:name", (req, res) => {
  if (!/^(studio|tiktok)-[a-z]+\.png$/.test(req.params.name)) return res.status(404).end();
  sendIfThere(res, resolvePath(`data/health/${req.params.name}`));
});
pipelineRouter.post("/backup/run", (req, res) => res.json(runBackup()));
// Restore overwrites trackers and settings, so it needs the password; the current files are kept first.
pipelineRouter.get("/backup/list", (req, res) => res.json(listBackups()));
pipelineRouter.post("/backup/restore", requirePasswordConfirmed, safe((req) => {
  const picks = req.body?.files === "all" ? "all" : Array.isArray(req.body?.files) ? req.body.files.map(String) : [];
  const r = restoreBackup(String(req.body?.name || ""), picks);
  logSecurity(req, `Restored ${r.restored.length} file(s) from backup ${req.body.name}`);
  return r;
}));

pipelineRouter.get("/security", (req, res) => res.json(recentSecurityLog()));

// Phone alerts (ntfy).
const alertInfo = (s) => ({ ...s, securityWhenOff: securityWhenOff(), kinds: Object.entries(ALERT_KINDS).map(([k, v]) => ({ kind: k, label: v.label, level: alertLevel(k, s), default: v.level, noOff: Boolean(v.noOff) })) });
pipelineRouter.get("/notify", (req, res) => res.json(alertInfo(notifySettings())));
pipelineRouter.post("/notify", (req, res) => {
  const s = notifySettings();
  const b = req.body || {};
  // The link in every phone alert: changing it needs the password (security plan 03), or it could point at a look-alike site.
  if (typeof b.dashboardUrl === "string" && b.dashboardUrl.trim() !== (s.dashboardUrl || "") && !passwordConfirmed(req)) return res.status(403).json({ error: "Enter your password to do this.", needPassword: true });
  if (typeof b.enabled === "boolean") s.enabled = b.enabled;
  for (const k of ["held", "failed", "done"]) if (typeof b.events?.[k] === "boolean") s.events[k] = b.events[k];
  if (b.levels && typeof b.levels === "object") {
    s.levels = { ...s.levels };
    for (const [k, v] of Object.entries(b.levels)) if (ALERT_KINDS[k] && v in LEVELS && !(v === "off" && ALERT_KINDS[k].noOff)) s.levels[k] = v;
    s.events = { ...s.events, held: true, failed: true, done: true }; // levels replace the old ticks
  }
  if (typeof b.dashboardUrl === "string") {
    const url = b.dashboardUrl.trim();
    if (url && !/^https?:\/\/[^\s/]+(:\d+)?\/?$/.test(url)) return res.status(400).json({ error: "Use just the address, like http://my-pc:3000" });
    s.dashboardUrl = url;
  }
  saveNotifySettings(s);
  res.json(alertInfo(s));
});
pipelineRouter.post("/notify/test", safe(async () => {
  await sendAlert({ title: "Test alert", message: "Phone alerts from your upload pipeline are working.", tags: ["tada"] });
  return { ok: true };
}, { status: 502 }));

const MAX_UPLOAD = 4 * 1024 ** 3;

// Upload from the phone: the video body streams into the channel's inbox as .part, so the worker only sees it once complete.
// ?test=1 saves it as TEST_<name>: a test run that never posts, so it needs no password on a live channel.
const isTest = (req) => req.query.test === "1";
pipelineRouter.post("/upload/:channel", perHour("video uploads", 10), requirePasswordConfirmed, (req, res) => {
  const ch = channelCfg(req.params.channel);
  if (!ch) return res.status(404).json({ error: "Unknown channel" });
  const name = (isTest(req) ? "TEST_" : "") + path.basename(String(req.query.name || "")).replace(/[^\w.\- ]/g, "_").replace(/^TEST[_ -]/i, "");
  if (!/\.(mp4|mov|m4v|mkv|webm)$/i.test(name)) return res.status(400).json({ error: "Send a video file (mp4, mov, m4v, mkv or webm)." });
  if (Number(req.headers["content-length"]) > MAX_UPLOAD) return res.status(413).json({ error: "That file is over 4 GB." });
  const inbox = resolvePath(ch.inbox);
  fs.mkdirSync(inbox, { recursive: true });
  const dest = path.join(inbox, fs.existsSync(path.join(inbox, name)) ? `${Date.now()}_${name}` : name);
  // Own .part name per upload, so two uploads of the same file at once can't write into each other (code review 2026-10-22).
  const part = `${dest}.${Math.random().toString(36).slice(2, 8)}.part`;
  // The 4 GB cap also counts the bytes as they arrive: a phone can send without a Content-Length.
  let bytes = 0;
  const count = new Transform({
    transform(chunk, enc, done) {
      bytes += chunk.length;
      done(bytes > MAX_UPLOAD ? Object.assign(new Error("That file is over 4 GB."), { status: 413 }) : null, chunk);
    },
  });
  pipeline(req, count, fs.createWriteStream(part), async (err) => {
    if (err) {
      fs.rmSync(part, { force: true });
      if (!res.headersSent) res.status(err.status || 500).json({ error: err.message });
      return;
    }
    // Antivirus or a sync app can hold a freshly written file for a moment on Windows. Retry the rename instead of
    // letting the error end the whole app.
    for (let k = 0; ; k++) {
      try {
        if (fs.existsSync(dest)) throw Object.assign(new Error("A file with that name just arrived. Try again."), { code: "EEXIST" });
        fs.renameSync(part, dest);
        return res.json({ saved: path.basename(dest) });
      } catch (e) {
        if (k >= 4 || e.code === "EEXIST") {
          fs.rmSync(part, { force: true });
          return res.status(500).json({ error: `Couldn't save the file: ${e.message}` });
        }
        await new Promise((r) => setTimeout(r, 1000 * (k + 1)));
      }
    }
  });
});
