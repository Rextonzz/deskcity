// Daily health check: is YouTube still signed in, does Studio's upload page still look the way uploads expect,
// is there disk space, is anything stuck or waiting. Sends one phone alert either way, so a missing morning
// alert also means something is wrong (the PC is off or the app isn't running).
import fs from "node:fs";
import path from "node:path";
import { listJobs } from "./jobs.js";
import { sendAlert, dashboardLink } from "./notify.js";
import { studioCheck } from "./studio/studio.js";
import { tiktokCheck } from "./studio/tiktok.js";
import { exclusive } from "./studio/browser.js";
import { listShorts } from "./studio/analytics.js";
import { trackerFiles, loadPipelineConfig, channelName, pipelineTz, dayIn, dueAt, ffmpegCmd, healthHour, resolvePath, run, pythonCmd, writeJsonAtomic, readJson } from "./util.js";
import { lastBackup } from "./backup.js";
import { fromModule } from "./channels/known.js";
import { config, isRealKey } from "../config.js";
import { snapshotRules, rulesStatus, reviewRules } from "./rules.js";
import { creditStatus } from "./credits.js";
import { readRuns, startRun, onceJob, onceState } from "./runlog.js";
import { versionHistory } from "./versions.js";

const FILE = () => resolvePath("data/health/last.json");

// Typical length = median of the last 7 checks. One check that sat 40 min waiting behind a stats pull
// (2026-10-19 14:24) made the next estimate say "about 39 min left" when checks take about a minute.
function typicalMs() {
  const ms = readRuns({ limit: 3000 }).filter((r) => r.kind === "health check" && r.ms > 0).slice(0, 7).map((r) => r.ms).sort((a, b) => a - b);
  return ms.length ? ms[Math.floor(ms.length / 2)] : null;
}

// "Clear errors" on Admin: errors before this time stop counting (the run log itself is kept).
const CLEARED = () => resolvePath("data/health/errors-cleared.json");
export const errorsClearedAt = () => readJson(CLEARED(), {})?.at || null;
export function clearErrors() {
  const at = new Date().toISOString();
  writeJsonAtomic(CLEARED(), { at }, 2);
  // Update the saved result so the card goes green now instead of at the next check.
  try {
    const h = JSON.parse(fs.readFileSync(FILE(), "utf8"));
    const c = (h.checks || []).find((x) => x.name === "Errors in the last 24 hours");
    if (c && !c.ok) {
      c.ok = true;
      c.detail = `Cleared ${new Date(at).toLocaleString("en-CA", { timeZone: pipelineTz() })}. Was: ${c.detail}`;
      h.ok = (h.checks || []).every((x) => x.ok);
      writeJsonAtomic(FILE(), h);
    }
  } catch {}
  return { at };
}

export function healthStatus() {
  let typical = null;
  try {
    typical = typicalMs();
  } catch {}
  const h = readJson(FILE(), null);
  const { running, since: runningSince } = onceState("health");
  const live = passwordCheck();
  if (live) return h ? { ...h, ok: false, checks: [live, ...(h.checks || [])], typicalMs: typical, errorsClearedAt: errorsClearedAt(), running, runningSince } : { checks: [live], ok: false, typicalMs: typical, running, runningSince };
  return h ? { ...h, typicalMs: typical, errorsClearedAt: errorsClearedAt(), running, runningSince } : { typicalMs: typical, running, runningSince };
}
// Shown live on Admin (money safety F3/F4): with no dashboard password, anything on this PC may spend without asking.
export function passwordCheck() {
  if (process.env.DASHBOARD_PASSWORD_HASH) return null;
  return { name: "Dashboard password", ok: false, detail: "Not set. Set a dashboard password to protect spending (npm run set-password): until then anything on this PC can start paid AI work without being asked. Caps and hourly limits still apply." };
}

const gb = (n) => `${(n / 1024 ** 3).toFixed(0)} GB`;

// Says whether a key is in .env and the service accepts it, without ever showing the key.
async function keyCheck(name, key, request, required) {
  if (!isRealKey(key)) return { name, ok: !required, detail: required ? "Missing from .env" : "Not in .env yet (only needed once Gemini steps are switched on)" };
  try {
    const res = await request(key);
    if (res.status === 401 || res.status === 403 || res.status === 400) return { name, ok: false, detail: `In .env, but the service turned it down (${res.status}). It may be mistyped or revoked.` };
    if (!res.ok) return { name, ok: true, detail: `In .env; the service answered ${res.status}, so it couldn't be confirmed right now` };
    const j = await res.json().catch(() => ({}));
    const n = (j.models || j.data || []).length;
    return { name, ok: true, detail: `In .env and working${n ? `, ${n} models available` : ""}` };
  } catch (err) {
    return { name, ok: true, detail: `In .env; couldn't reach the service to confirm (${err.message.split("\n")[0]})` };
  }
}

async function runChecks() {
  const cfg = loadPipelineConfig();
  const dir = path.dirname(FILE());
  fs.mkdirSync(dir, { recursive: true });
  const checks = [];
  const add = (name, ok, detail, image) => checks.push({ name, ok, detail, ...(image ? { image } : {}) });

  for (const [id, ch] of Object.entries(cfg.channels)) {
    if (!ch.enabled) continue;
    const shot = path.join(dir, `studio-${id}.png`);
    fs.rmSync(shot, { force: true });
    try {
      await studioCheck({ channel: ch, shot });
      add(`${ch.name}: YouTube Studio`, true, "Signed in, upload page as expected");
    } catch (err) {
      const msg = /net::ERR_/.test(err.message) ? "Couldn't reach YouTube. Is the PC online?" : err.message.split("\n")[0];
      add(`${ch.name}: YouTube Studio`, false, msg, fs.existsSync(shot) ? `studio-${id}.png` : null);
    }
    if (ch.tiktok?.enabled) {
      const tshot = path.join(dir, `tiktok-${id}.png`);
      fs.rmSync(tshot, { force: true });
      try {
        await tiktokCheck({ handle: ch.tiktok.handle, shot: tshot });
        add(`${ch.name}: TikTok Studio`, true, "Signed in, upload page as expected");
      } catch (err) {
        const msg = /net::ERR_/.test(err.message) ? "Couldn't reach TikTok. Is the PC online?" : err.message.split("\n")[0];
        add(`${ch.name}: TikTok Studio`, false, msg, fs.existsSync(tshot) ? `tiktok-${id}.png` : null);
      }
    }
  }

  for (const [id, ch] of Object.entries(cfg.channels)) if (ch.enabled) checks.push(await todaysVideo(id, ch, cfg));

  // AI keys: Claude runs every AI step; Gemini is for the planned whole-video steps. Lists models only (no prompt, no cost).
  checks.push(await keyCheck("Claude API key", config.anthropicApiKey, (k) => fetch("https://api.anthropic.com/v1/models", { headers: { "x-api-key": k, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(15000) }), true));
  checks.push(await keyCheck("Gemini API key", config.geminiApiKey, (k) => fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { headers: { "x-goog-api-key": k }, signal: AbortSignal.timeout(15000) }), false));

  try {
    const { bavail, bsize } = fs.statfsSync(resolvePath("."));
    const free = bavail * bsize;
    add("Disk space", free > 20 * 1024 ** 3, `${gb(free)} free`);
  } catch (err) {
    add("Disk space", false, err.message);
  }

  for (const [label, cmd, args] of [["ffmpeg", ffmpegCmd(cfg), ["-version"]], ["Python", pythonCmd(), ["--version"]]]) {
    try {
      await run(cmd, args);
      add(label, true, "Works");
    } catch (err) {
      add(label, false, `Couldn't run it: ${err.message.split("\n")[0]}`);
    }
  }

  const trackers = trackerFiles(cfg).map((t) => [`${channelName(t.id, cfg)} ${t.key === "logPath" ? "upload log" : "tracker"}`, t.path]);
  for (const [label, p] of trackers) if (p) add(label, fs.existsSync(resolvePath(p)), fs.existsSync(resolvePath(p)) ? "Found" : `Missing: ${p}`);

  const jobs = listJobs();
  const held = jobs.filter((j) => j.status === "held").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const stuck = jobs.filter((j) => j.status === "running" && Date.now() - Date.parse(j.updatedAt) > 2 * 3600000).length;
  add("Jobs", !failed && !stuck, [held && `${held} waiting on you`, failed && `${failed} failed`, stuck && `${stuck} stuck for 2+ hours`].filter(Boolean).join(", ") || "Nothing waiting");

  // Rules review: a quick status line each morning; the Claude review itself only runs when it's due.
  let changed = {};
  try {
    changed = snapshotRules();
  } catch (err) {
    console.warn(`Rules snapshot failed: ${err.message}`);
  }
  for (const [id, ch] of Object.entries(cfg.channels)) {
    if (!ch.enabled) continue;
    try {
      const s = await rulesStatus(id);
      checks.push({
        name: `${ch.name}: rules review`,
        ok: true,
        rulesDue: s.due ? id : undefined,
        detail: [
          s.lastAt
            ? `Last reviewed ${s.days === 0 ? "today" : `${s.days} day${s.days === 1 ? "" : "s"} ago`}, ${s.videosSince} new video${s.videosSince === 1 ? "" : "s"} since`
            : "Not reviewed yet",
          changed[id] ? "rules file changed since the last check" : "",
          s.due ? "review running now" : "",
        ]
          .filter(Boolean)
          .join(", "),
      });
    } catch (err) {
      checks.push({ name: `${ch.name}: rules review`, ok: true, detail: `Couldn't check: ${err.message}` });
    }
  }

  // AI credit left (the owner types the console balance on AI and spend; the app subtracts what it spends).
  try {
    const cs = creditStatus();
    for (const c of Object.values(cs.providers)) {
      if (c.left == null) continue;
      add(`${c.label} credit`, !c.low, `About $${c.left.toFixed(2)} left${c.daysLeft != null ? `, roughly ${c.daysLeft} days at this week's pace` : ""}${c.low ? `. Under $${cs.warnBelow}: top up, then type the new balance on AI and spend` : ""}`);
    }
  } catch (err) {
    add("AI credit", true, `Couldn't check: ${err.message}`);
  }

  // Anything that failed in the last 24 hours (uploads, pulls, posts, AI calls...), from the run log.
  const cleared = errorsClearedAt();
  const dayAgo = [new Date(Date.now() - 864e5).toISOString(), cleared || ""].sort().pop();
  const recent = readRuns({ limit: 3000 }).filter((r) => r.startedAt > dayAgo && r.kind !== "app action" && r.kind !== "alert");
  const bad = recent.filter((r) => r.ok === false);
  const byKind = {};
  for (const r of bad) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  add(
    "Errors in the last 24 hours",
    bad.length === 0,
    bad.length
      ? `${Object.entries(byKind)
          .map(([k, n]) => `${n} ${k}`)
          .join(", ")}. Latest: ${String(bad[0].error || "")
          .split("\n")[0]
          .slice(0, 160)}`
      : `None in ${recent.length} runs${cleared && cleared === dayAgo ? " since you cleared them" : ""}`,
  );

  // Something that has failed every time lately (the pinned comment failed 5 of 5 over two days before anyone
  // noticed, and every Gemini Pro test 35 of 35). Last 14 days, 3 or more tries, none worked; AI calls are split
  // by step and model. Stays on the list until one works, even after Clear errors.
  const streaks = keepsFailing(readRuns({ limit: 5000 }));
  add("Keeps failing", streaks.length === 0, streaks.length ? streaks.map((x) => `${x.what}: ${x.tries} tries, none worked since ${x.since.slice(0, 10)} (${x.error})`).join("; ") : "Nothing has failed every time in the last two weeks");

  // Crashes and unplanned stops (data/logs/crash.log), last 24 hours: only real crashes count (readCrashLog below).
  try {
    const c = readCrashLog(fs.readFileSync(resolvePath("data/logs/crash.log"), "utf8"), dayAgo);
    add("App crashes", c.crashes.length === 0, crashWords(c));
  } catch {
    add("App crashes", true, "No crash log yet");
  }

  // Code that changed without a note in the version history.
  try {
    const h = versionHistory();
    const un = h.unnoted.filter((u) => Date.parse(u.at) > Date.now() - 7 * 864e5);
    add(
      "Version history",
      un.length === 0,
      un.length
        ? `Code changed without a note on ${un.length} start${un.length === 1 ? "" : "s"} this week: ${[...(un[0].changed || []), ...(un[0].added || [])].slice(0, 5).join(", ")}`
        : `Running: ${h.running?.title || "unknown"}`,
    );
  } catch (err) {
    add("Version history", true, `Couldn't check: ${err.message}`);
  }

  // Trackers open in Excel block writing (Excel leaves a ~$ lock file next to the workbook).
  for (const [label, p] of trackers) {
    if (!p) continue;
    const full = resolvePath(p);
    const lock = path.join(path.dirname(full), `~$${path.basename(full)}`);
    if (fs.existsSync(lock)) add(`${label} open in Excel`, false, "It's open in Excel, so uploads can't write to it. Close it when you're done.");
  }

  // Last stats pull (pulls stay manual; this is only a reminder).
  try {
    const last = JSON.parse(fs.readFileSync(resolvePath("data/stats/last-pull.json"), "utf8"));
    const days = Math.floor((Date.now() - Date.parse(last.finishedAt)) / 864e5);
    add(
      "Stats pull",
      !last.error && days <= 7,
      last.error
        ? `Last pull failed: ${String(last.error).split("\n")[0].slice(0, 160)}`
        : `Last pull ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}${days > 7 ? ". Press Pull stats so the learning has fresh numbers" : ""}`,
    );
  } catch {
    add("Stats pull", true, "No pull yet");
  }

  // Free local captions: is faster-whisper installed (else Gemini does them, at a small cost).
  if (Object.entries(cfg.channels || {}).some(([id, c]) => c.enabled && c.ownCaptions !== false && fromModule(c.module || id, "usesCaptions"))) {
    try {
      await run(pythonCmd(), ["-c", "import faster_whisper"]);
      add("Whisper (free captions)", true, "Installed");
    } catch {
      add("Whisper (free captions)", true, "Not installed, so Gemini writes the captions. Run: pip install faster-whisper");
    }
  }

  const b = lastBackup();
  add(
    "Backup",
    Boolean(b?.ok) && Date.now() - Date.parse(b.at) < 36 * 3600000,
    b
      ? b.ok
        ? `Last one ${new Date(b.at).toLocaleString("en-CA", { timeZone: pipelineTz(cfg), dateStyle: "medium", timeStyle: "short" })}, to ${b.dir}`
        : `Failed: ${b.error}`
      : "None yet",
  );
  return checks;
}

// Groups runs by what they did; a group whose last 3+ runs in 14 days all failed is a streak.
// What data/logs/crash.log (server.js) says happened since `since` (an ISO time). Each line is "<time> pid <n> <kind>: <detail>"
// (stack lines under it are skipped). Only a real crash counts as one: the process died unexpectedly, which the code
// can tell because it wrote "crash" (an uncaught error ended it), "could not start" for a reason other than another hub
// already running, or an "exit code" other than 0 with no other line from that process explaining it. Not crashes:
// "exit code 0" (a clean stop: the Restart button or a deliberate stop) and "started" (each start, from 2026-11-16)
// count as restarts; a start refused because a hub was already running ("refused second start", or the older
// "could not start: ... EADDRINUSE" / "Another hub is already using this data folder") is a refused second start; an
// "unhandled rejection (kept running)" is an error the app survived. A hub killed from outside (closing its window,
// stopping its process) writes no stop line at all, so it is never counted as a crash; its next start is a restart.
export function readCrashLog(text, since = "") {
  const lines = String(text || "").split("\n").map((l) => l.match(/^(\d{4}-\d\d-\d\dT[\d:.]+Z) pid (\d+) ([^:]+):\s?(.*)$/)).filter((m) => m && m[1] > since)
    .map((m) => ({ at: m[1], pid: m[2], kind: m[3].trim(), detail: m[4].trim(), line: m[0] }));
  const out = { crashes: [], refused: [], kept: [], restarts: 0 };
  const explained = new Set(), restarted = new Set();
  const dup = (l) => /EADDRINUSE|Another hub is already using/.test(l.detail);
  for (const l of lines) {
    if (l.kind === "crash" || (l.kind === "could not start" && !dup(l))) { out.crashes.push(l); explained.add(l.pid); }
    else if (l.kind.startsWith("refused second start") || (l.kind === "could not start" && dup(l))) { out.refused.push(l); explained.add(l.pid); }
    else if (l.kind.startsWith("unhandled rejection")) out.kept.push(l);
    else if (l.kind === "started" || l.kind === "exit code 0") restarted.add(l.pid);
  }
  for (const l of lines) if (/^exit code (?!0$)/.test(l.kind) && !explained.has(l.pid)) { out.crashes.push({ ...l, unexpected: true }); explained.add(l.pid); }
  out.crashes.sort((a, b) => a.at.localeCompare(b.at));
  out.restarts = restarted.size;
  return out;
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// The Health line for readCrashLog's answer.
export function crashWords(c) {
  const also = [c.restarts ? plural(c.restarts, "restart") : "", c.refused.length ? `${plural(c.refused.length, "second start")} refused because the hub was already running` : "", c.kept.length ? `${plural(c.kept.length, "error")} it caught and kept running through` : ""].filter(Boolean);
  const hint = c.refused.length >= 3 ? " Something keeps trying to start a second hub (an extra start window?): close it." : "";
  if (!c.crashes.length) return `None in the last 24 hours${also.length ? ` (${also.join(", ")})` : ""}.${hint}`;
  const last = c.crashes.at(-1);
  const what = last.unexpected ? `${last.at} pid ${last.pid} stopped unexpectedly (${last.kind})` : `${last.at} pid ${last.pid} ${last.kind}: ${last.detail}`;
  return `${c.crashes.length} in the last 24 hours. Latest: ${what.slice(0, 200)}${also.length ? `. Not crashes: ${also.join(", ")}` : ""}.${hint}`;
}

export function keepsFailing(runs) {
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const groups = {};
  for (const r of runs) {
    if (r.startedAt < since || ["app action", "alert"].includes(r.kind) || r.ok == null) continue;
    const key = r.kind === "ai call" ? `AI ${r.step?.replace(/_\d+$/, "")} on ${r.model}${r.trigger === "test" ? " (side-by-side test)" : ""}` : r.kind;
    (groups[key] ||= []).push(r);
  }
  const out = [];
  for (const [what, list] of Object.entries(groups)) {
    list.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    let n = 0;
    for (let i = list.length - 1; i >= 0 && list[i].ok === false; i--) n++;
    // Nothing has tried it for 3 days (a retired model, a feature switched off): not a live problem.
    const stale = Date.now() - Date.parse(list.at(-1).startedAt) > 3 * 864e5;
    if (n >= 3 && n === list.length && !stale) out.push({ what, tries: n, since: list[0].startedAt, error: String(list.at(-1).error || "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").split("\n")[0].slice(0, 120) });
  }
  return out.sort((a, b) => b.tries - a.tries);
}

const timeIn = (tz, d) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);

// Is something going out today? Counts Shorts Studio lists as scheduled for (or published) today, which also catches
// uploads made outside the pipeline, plus pipeline jobs scheduled for today. Test-mode channels are only reported.
async function todaysVideo(id, ch, cfg) {
  const tz = pipelineTz(cfg);
  const now = new Date();
  const today = dayIn(tz, now);
  const name = `${ch.name}: today's video`;
  const ids = new Set(), times = [];
  // Green means covered: a video went public in the last 24 hours and another is ready to follow it
  // (scheduled for later, or finished and waiting private).
  const posted = new Set(), next = new Set();
  const yesterday = dayIn(tz, new Date(now - 864e5));
  let studioOk = true;
  if (ch.channelId) {
    try {
      for (const v of await exclusive(() => listShorts({ channel: ch }))) {
        const d = v.date && dayIn(tz, new Date(`${v.date} 12:00`));
        if (/Public/.test(v.visibility || "") && (d === today || d === yesterday)) posted.add(v.videoId);
        if (/Scheduled/.test(v.visibility || "") && d && d >= today) next.add(v.videoId);
        if (!/Scheduled|Public/.test(v.visibility || "") || d !== today) continue;
        ids.add(v.videoId);
      }
    } catch {
      studioOk = false;
    }
  }
  const jobs = listJobs().filter((j) => j.channel === id);
  const cov = coverage(id, jobs);
  cov.posted.forEach((v) => posted.add(v));
  cov.next.forEach((v) => next.add(v));
  for (const j of jobs) {
    const at = j.data?.publishAt && new Date(j.data.publishAt);
    if (!at || !["scheduled", "published"].includes(j.status) || dayIn(tz, at) !== today) continue;
    if (j.data.videoId) ids.add(j.data.videoId);
    times.push(timeIn(tz, at));
  }
  const waiting = jobs.filter((j) => ["held", "queued", "running"].includes(j.status)).length;
  const weekend = [0, 6].includes(new Date(`${today}T12:00:00`).getDay());
  const slots = (weekend ? ch.slots?.weekend : ch.slots?.weekday)?.length || 0;
  const parts = [
    posted.size ? "Posted in the last 24 hours" : "Nothing posted in the last 24 hours",
    next.size ? `${next.size} ready to follow` : "nothing ready to follow",
    ids.size
      ? `${ids.size} going out today${times.length ? ` (${[...new Set(times)].join(", ")})` : ""}${slots > ids.size ? `, ${slots - ids.size} of ${slots} slots still open` : ""}`
      : "Nothing scheduled for today",
  ];
  if (waiting) parts.push(`${waiting} in the pipeline`);
  if (!studioOk) parts.push("couldn't read Studio's list, so only pipeline jobs were counted");
  if (!ch.live) return { name, ok: true, detail: `Test mode, nothing goes public. ${parts.join(", ")}` };
  // A video going out later today also counts as covered: before 2026-10-19 a morning check went red while
  // a channel' noon video was already scheduled, just because yesterday had no post.
  return { name, ok: (posted.size > 0 || ids.size > 0) && next.size > 0, detail: parts.join(", ") };
}

// From the pipeline's own jobs: videos that went public in the last 24 hours, and videos ready to follow
// (scheduled for later, or finished private and waiting for Go).
export function coverage(channelId, jobs = listJobs()) {
  const now = Date.now();
  const posted = [], next = [];
  for (const j of jobs.filter((x) => x.channel === channelId)) {
    const at = j.data?.publishAt ? Date.parse(j.data.publishAt) : j.status === "published" ? Date.parse(j.updatedAt || j.createdAt) : NaN;
    const key = j.data?.videoId || j.id;
    if (["scheduled", "published"].includes(j.status) && at <= now && at > now - 864e5) posted.push(key);
    else if ((j.status === "scheduled" && at > now) || j.status === "private") next.push(key);
  }
  return { posted, next };
}

// Runs the checks (one at a time), saves the result and sends the phone alert.
export function startHealthCheck({ alert = true, trigger = "daily" } = {}) {
  return onceJob("health", async () => {
    const log = startRun("health check", { trigger });
    const at = new Date().toISOString();
    let checks;
    try {
      checks = await runChecks();
    } catch (err) {
      checks = [{ name: "Health check", ok: false, detail: err.message }];
    }
    const problems = checks.filter((c) => !c.ok);
    const result = { at, ok: !problems.length, checks, durationMs: Date.now() - Date.parse(at) };
    writeJsonAtomic(FILE(), result);
    log.end({ checks: checks.length, problems: problems.map((c) => `${c.name}: ${c.detail}`.slice(0, 300)) });
    if (alert) {
      const msg = problems.length
        ? { title: `Pipeline: ${problems.length} problem${problems.length > 1 ? "s" : ""}`, message: problems.map((c) => `${c.name}: ${c.detail}`).join("\n"), tags: ["warning"], priority: 4 }
        : { title: "Pipeline: all good", message: checks.filter((c) => /Studio|today|Disk|Jobs/.test(c.name)).map((c) => `${c.name}: ${c.detail}`).join("\n"), tags: ["white_check_mark"], priority: 2 };
      await sendAlert({ ...msg, kind: problems.length ? "health_problem" : "health_ok", url: dashboardHome() }).catch((err) => console.warn(`Health alert failed: ${err.message}`));
    }
    // Due rules reviews run after the alert, so a slow Claude answer never holds up the morning check.
    for (const id of checks.map((c) => c.rulesDue).filter(Boolean)) {
      const name = channelName(id);
      reviewRules(id, { trigger })
        .then((r) =>
          sendAlert({
            kind: "rules",
            title: `${name}: rules review ready`,
            message: `${r.summary}
${r.question.length} rule${r.question.length === 1 ? "" : "s"} to question, ${r.proposals.length} suggested edit${r.proposals.length === 1 ? "" : "s"}.`,
            tags: ["memo"],
            priority: 3,
            url: dashboardHome()?.replace(/home\.html$/, `stats-${id}.html`),
          }),
        )
        .catch((err) => console.warn(`Rules review for ${id} failed: ${err.message}`));
    }
    return result;
  });
}

function dashboardHome() {
  return dashboardLink("/home.html", readJson(resolvePath("data/notify.json"), {}) || {});
}

// Called every minute by the worker: once a day at health.hour (default 9 am, the pipeline's timezone).
export function healthTick() {
  const cfg = loadPipelineConfig();
  if (dueAt({ tz: pipelineTz(cfg), hour: healthHour(cfg), last: healthStatus().at })) startHealthCheck();
}
