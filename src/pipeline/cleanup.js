// Job clean-up, LIST FIRST (data plan 01). Once a video is live and a grace period has passed, a job's working files
// (frame sheets, renders inside the job folder, turned or cropped copies) can go; the record (job.json) and the final
// thumbnail (*_thumb.jpg) always stay. planCleanup() only lists what would go, with sizes, and never writes. runCleanup()
// removes exactly the jobs the owner confirmed from a fresh plan, re-checking every path at delete time.
//
// The original source video is the owner's choice (setting keepOriginals, default false, for a hub whose owner keeps
// master copies): while it is false, the original of a live job past the grace (and of a skipped job in the archive past
// archiveDays) is listed in its own group and removed only when the confirm step says originals: true. A job that is
// not live (failed, unfinished, held, private) never has its original listed. Final renders in output/ (removeOutput)
// stay a separate opt-in, off by default. Nothing runs on a timer unless the owner turns auto on.
import fs from "node:fs";
import path from "node:path";
import { jobsDir, archiveDir, jobDir } from "./jobs.js";
import { loadPipelineConfig, readJson, writeJsonAtomic, resolvePath, jobLabel, channelCfg, pipelineTz, dueAt, backupHour } from "./util.js";
import { hubSettings } from "../hub/settings.js";
import { startRun } from "./runlog.js";

const DAY = 864e5;
const DEFAULTS = { auto: false, graceDays: 7, archiveDays: 30, keepOriginals: false, removeOutput: false, removeDebug: false, debugAction: "gzip" };
const STATE = () => resolvePath("data/cleanup.json");
const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

// defaults < hub settings (hub.defaults.json, hub.owner.json, data/hub-settings.json) < pipeline.config.json "cleanup"
export function cleanupSettings() {
  const s = { ...DEFAULTS, ...(hubSettings().cleanup || {}), ...(loadPipelineConfig().cleanup || {}) };
  return {
    auto: s.auto === true,
    graceDays: clamp(s.graceDays, 1, 365, 7),
    archiveDays: clamp(s.archiveDays, 7, 3650, 30),
    keepOriginals: s.keepOriginals === true, // default false: originals of live jobs are listed (own group) and need the confirm step
    removeOutput: s.removeOutput === true, // final renders in output/ (live jobs and orphans): its own opt-in, off by default
    removeDebug: s.removeDebug === true, // data/stats/debug comment page dumps: its own opt-in, off by default
    debugAction: s.debugAction === "delete" ? "delete" : "gzip",
  };
}

function sizeOf(p) {
  let st;
  try { st = fs.lstatSync(p); } catch { return 0; }
  if (st.isSymbolicLink()) return 0;
  return st.isDirectory() ? fs.readdirSync(p).reduce((s, f) => s + sizeOf(path.join(p, f)), 0) : st.size;
}
function allJobs() {
  const out = [];
  for (const [root, base] of [["jobs", jobsDir()], ["jobs-archive", archiveDir()]]) {
    let names;
    try { names = fs.readdirSync(base); } catch { continue; }
    for (const n of names) {
      const dir = path.join(base, n);
      const job = readJson(path.join(dir, "job.json"), null);
      if (job && job.id) out.push({ job, root, dir });
    }
  }
  return out;
}
const names = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };
// The original source video, found by name inside the job folder (an archived job keeps a stale absolute path).
function originalOf(job, dir) {
  const files = names(dir);
  const want = path.basename(String(job.data?.originalSource ?? job.data?.source ?? ""));
  if (want && files.includes(want)) return want;
  return files.find((f) => /^source\.(mp4|mov|mkv|webm)$/i.test(f)) || null;
}
// Any file named *_thumb.jpg is kept, by name, whatever data.thumbnail says.
function thumbsOf(job, dir) {
  const files = names(dir);
  const out = new Set(files.filter((f) => /_thumb\.jpe?g$/i.test(f)));
  const t = job.data?.thumbnail ? path.basename(String(job.data.thumbnail)) : null;
  if (t && files.includes(t)) out.add(t);
  return out;
}
const ageMs = (job, now) => now - Math.max(Date.parse(job.updatedAt) || 0, Date.parse(job.createdAt) || 0);
const realVideo = (j) => /^[\w-]{11}$/.test(j.data?.videoId || "");

// "live" | "split-done" | "dead" | null, and when it is the grace that is holding it back, the date it becomes eligible.
function liveState(job, now, settings, byId) {
  const grace = settings.graceDays * DAY;
  const isTest = Boolean(job.data?.testRun);
  const publishAt = Date.parse(job.data?.publishAt) || 0;
  const since = Math.max(Date.parse(job.updatedAt) || 0, publishAt);
  const aged = now - since >= grace;
  const eligibleOn = new Date(since + grace).toISOString();
  const live = (job.status === "published" || (job.status === "scheduled" && publishAt && publishAt <= now)) && realVideo(job) && !job.data?.pinPending;
  if (live && !isTest) return aged ? { state: "live" } : { state: null, eligibleOn, why: "live, waiting out the grace" };
  if (job.status === "split" && !isTest) {
    const kids = Array.isArray(job.data?.splitInto) ? job.data.splitInto : [];
    if (!kids.length) return { state: null };
    const done = kids.every((id) => {
      const k = byId.get(id);
      if (!k) return false;
      return k.job.status === "skipped" || liveState(k.job, now, settings, byId).state === "live";
    });
    if (!done) return { state: null };
    return aged ? { state: "split-done" } : { state: null, eligibleOn, why: "split, waiting out the grace" };
  }
  if (job.status === "skipped") {
    const a = ageMs(job, now) >= grace;
    return a ? { state: "dead" } : { state: null, eligibleOn: new Date(Math.max(Date.parse(job.updatedAt) || 0, Date.parse(job.createdAt) || 0) + grace).toISOString(), why: "skipped, waiting out the grace" };
  }
  return { state: null };
}

// What would be removed. Writes nothing.
export function planCleanup({ now = Date.now(), settings = cleanupSettings() } = {}) {
  const jobs = allJobs();
  const byId = new Map(jobs.map((j) => [j.job.id, j]));
  const items = [], waiting = [];
  for (const { job, root, dir } of jobs) {
    const ls = liveState(job, now, settings, byId);
    if (!ls.state) { if (ls.eligibleOn) waiting.push({ id: job.id, why: ls.why, eligibleOn: ls.eligibleOn }); continue; }
    const rule = ls.state === "live" ? "A" : ls.state === "split-done" ? "A2" : "A3";
    const orig = originalOf(job, dir);
    // the original and any source*.mp4 in the folder form the originals group, never the default list
    const srcs = names(dir).filter((f) => f === orig || /^source.*.(mp4|mov|mkv|webm)$/i.test(f));
    const keep = new Set(["job.json", ...thumbsOf(job, dir), ...srcs]);
    const remove = names(dir).filter((f) => !keep.has(f)).map((f) => ({ path: path.join(dir, f), bytes: sizeOf(path.join(dir, f)) }));
    // originals: live jobs past the grace, and skipped archive jobs past the archive age. Never any other job.
    const originalOk = !settings.keepOriginals && srcs.length && (ls.state === "live" || (ls.state === "dead" && root === "jobs-archive" && ageMs(job, now) >= settings.archiveDays * DAY));
    const originals = originalOk ? srcs.map((f) => ({ path: path.join(dir, f), bytes: sizeOf(path.join(dir, f)) })) : [];
    let output = null;
    if (ls.state === "live" && job.data?.output && fs.existsSync(job.data.output)) {
      const ok = job.data.tiktok?.status === "posted" || !channelCfg(job.channel)?.tiktok;
      output = { path: job.data.output, bytes: sizeOf(job.data.output), ok };
    }
    if (!remove.length && !originals.length && !output) continue;
    const bytes = remove.reduce((s, r) => s + r.bytes, 0);
    let label = job.id;
    try { label = jobLabel(job); } catch {}
    items.push({ id: job.id, root, rule, label, remove, bytes, originals, originalsBytes: originals.reduce((s, r) => s + r.bytes, 0), output });
  }
  items.sort((a, b) => b.bytes - a.bytes);
  return {
    at: new Date(now).toISOString(), settings, items, waiting,
    totals: {
      count: items.length,
      bytes: items.reduce((s, i) => s + i.bytes, 0),
      originalsBytes: items.reduce((s, i) => s + i.originalsBytes, 0),
      outputBytes: items.reduce((s, i) => s + (i.output ? i.output.bytes : 0), 0),
    },
  };
}

// Remove what the owner confirmed. ids: the job ids from the list they saw (required; all: true is for the nightly timer
// only). Ids that are not in a fresh plan are skipped. originals / output must be asked for and allowed by the settings.
export function runCleanup({ ids, all = false, working = true, originals = false, output = false, now = Date.now(), trigger = "button" } = {}) {
  if (!all && !Array.isArray(ids)) throw new Error("Clean-up needs the list of job ids that were shown");
  const settings = cleanupSettings();
  const plan = planCleanup({ now, settings });
  const want = all ? null : new Set(ids);
  const skipped = want ? ids.filter((id) => !plan.items.some((i) => i.id === id)) : [];
  const log = startRun("disk cleanup", { trigger });
  let files = 0, bytes = 0, jobs = 0, originalsGone = 0;
  try {
    for (const item of plan.items) {
      if (want && !want.has(item.id)) continue;
      const found = allJobs().find((j) => j.job.id === item.id && j.root === item.root);
      if (!found || ["running", "publishing"].includes(found.job.status)) { skipped.push(item.id); continue; }
      const { dir } = found;
      const doomed = working ? [...item.remove] : [];
      if (originals === true && !settings.keepOriginals) doomed.push(...item.originals);
      if (output === true && settings.removeOutput && item.output?.ok) doomed.push(item.output);
      let itemFiles = 0, itemBytes = 0, origDone = false;
      for (const r of doomed) {
        const isOutput = item.output && r.path === item.output.path;
        const base = path.resolve(dir) + path.sep;
        const p = path.resolve(r.path);
        if (!isOutput && !p.startsWith(base)) continue; // never outside the job's own folder
        let st;
        try { st = fs.lstatSync(p); } catch { continue; }
        if (st.isSymbolicLink()) continue;
        if (isOutput && !st.isFile()) continue;
        fs.rmSync(p, { recursive: true, force: true });
        itemFiles++; itemBytes += r.bytes;
        if (item.originals.some((o) => o.path === r.path)) origDone = true;
      }
      if (!itemFiles) continue;
      const fresh = readJson(path.join(dir, "job.json"), null);
      if (fresh) {
        fresh.data = { ...(fresh.data || {}), cleaned: { at: new Date().toISOString(), files: itemFiles, bytes: itemBytes, originals: origDone } };
        (fresh.log ||= []).push({ at: new Date().toISOString(), message: `Clean-up removed ${itemFiles} file(s) (${(itemBytes / 1048576).toFixed(1)} MB); the record and thumbnail are kept${origDone ? "; the original video was removed too" : ""}` });
        writeJsonAtomic(path.join(dir, "job.json"), fresh); // updatedAt is left alone so later passes keep their age
      }
      jobs++; files += itemFiles; bytes += itemBytes; if (origDone) originalsGone++;
    }
    log.end({ files, freedMB: Math.round(bytes / 1048576), jobs, originals: originalsGone });
  } catch (err) {
    log.end({ error: err.message, files });
    throw err;
  }
  return { jobs, files, bytes, originals: originalsGone, skipped };
}

// Every minute (once server.js wires it). Does nothing unless the owner turned auto on; then once a night an hour
// after the backup, retried after an hour if the last run failed. Removes originals only while keepOriginals is false.
export function cleanupTick({ now = new Date() } = {}) {
  const s = cleanupSettings();
  if (!s.auto) return null;
  const last = readJson(STATE(), null);
  if (last && !last.ok && now.getTime() - Date.parse(last.at) < 3600000) return null;
  if (!dueAt({ tz: pipelineTz(), hour: (backupHour() + 1) % 24, last: last?.ok ? last.at : null, now })) return null;
  let status;
  try {
    archiveSkipped({ now: now.getTime(), settings: s }); // skipped jobs only: finished jobs stay in data/jobs (episode numbering reads them)
    const r = runCleanup({ all: true, originals: !s.keepOriginals, output: s.removeOutput, now: now.getTime(), trigger: "nightly" });
    status = { at: now.toISOString(), ok: true, jobs: r.jobs, files: r.files, bytes: r.bytes };
  } catch (err) {
    status = { at: now.toISOString(), ok: false, error: err.message };
  }
  writeJsonAtomic(STATE(), status);
  return status;
}

// Skipped jobs that have waited out the grace move to data/jobs-archive, as "Clear skipped" does (the folder is renamed,
// job.json comes along). Finished (published or scheduled) jobs are never moved: a channel numbering reads them.
export function planArchive({ now = Date.now(), settings = cleanupSettings() } = {}) {
  const out = [];
  let list;
  try { list = fs.readdirSync(jobsDir()); } catch { return out; }
  for (const n of list) {
    const dir = path.join(jobsDir(), n);
    const job = readJson(path.join(dir, "job.json"), null);
    if (!job || job.status !== "skipped" || job.id !== n) continue;
    const age = now - (Date.parse(job.updatedAt) || 0);
    if (!(age >= settings.graceDays * DAY)) continue;
    out.push({ id: job.id, path: dir, bytes: sizeOf(dir), ageDays: Math.floor(age / DAY) });
  }
  return out;
}
export function archiveSkipped({ now = Date.now(), settings = cleanupSettings(), ids = null } = {}) {
  const moved = [];
  for (const it of planArchive({ now, settings })) {
    if (ids && !ids.includes(it.id)) continue;
    const to = path.join(archiveDir(), it.id);
    if (fs.existsSync(to)) continue;
    fs.mkdirSync(archiveDir(), { recursive: true });
    fs.renameSync(jobDir(it.id), to);
    moved.push(it.id);
  }
  return { moved };
}
