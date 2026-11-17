// Admin tools: pause the pipeline, disk cleanup, pack MSRPs, downloads and tool versions.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { jobsDir } from "./jobs.js";
import { planCleanup, runCleanup } from "./cleanup.js";
import { perDayOf } from "./schedule.js";
import { fromModule } from "./channels/known.js";
import { trackerFiles, loadPipelineConfig, savePipelineConfig, jobLabel, channelName, ffmpegCmd, resolvePath, pythonCmd, writeJsonAtomic, readJson, readJsonl, appendJsonl } from "./util.js";
import { startRun, logEvent } from "./runlog.js";

const run = promisify(execFile);
const PAUSE = () => resolvePath("data/pause.json");

// Pause: no new job starts until it's turned off. A job already running finishes its current run; scheduled
// videos still go public on time and pinned comments still go up.
export const pauseState = () => readJson(PAUSE(), { paused: false });
export function setPaused(paused) {
  const s = { paused: Boolean(paused), at: new Date().toISOString() };
  writeJsonAtomic(PAUSE(), s, 0);
  logEvent("pause", { trigger: "button", paused: s.paused });
  return s;
}

// Disk space and clean-up. The rules live in cleanup.js (list first: planCleanup() lists, runCleanup() removes only the
// jobs the owner confirmed from that list). diskInfo() keeps its old shape for the page and adds the full plan.
function sizeOf(p) {
  const st = fs.lstatSync(p);
  return st.isDirectory() ? fs.readdirSync(p).reduce((s, f) => s + sizeOf(path.join(p, f)), 0) : st.size;
}
export async function diskInfo() {
  const plan = planCleanup();
  const jobs = plan.items.filter((i) => i.bytes > 0).map((i) => ({ id: i.id, label: i.label, bytes: i.bytes }));
  const jobsFolder = jobsDir();
  const all = fs.existsSync(jobsFolder) ? sizeOf(jobsFolder) : 0;
  let free = null, total = null;
  try {
    const st = await fs.promises.statfs(jobsFolder);
    free = st.bavail * st.bsize;
    total = st.blocks * st.bsize;
  } catch {}
  return { jobsBytes: all, free, total, cleanable: jobs, cleanableBytes: jobs.reduce((s, j) => s + j.bytes, 0), plan };
}
export const cleanupDisk = (opts = {}) => runCleanup(opts);

// Pack MSRPs, the "Set|Booster" table in pipeline.config.json (the channel that keeps an "msrp" table).
const msrpChannel = (cfg) => Object.keys(cfg.channels || {}).find((id) => cfg.channels[id]?.msrp);
export function msrpTable() {
  const cfg = loadPipelineConfig();
  const fp = cfg.channels[msrpChannel(cfg)] || {};
  const assumed = new Set(fp.msrpAssumptions || []);
  return Object.entries(fp.msrp || {}).map(([key, price]) => ({ set: key.split("|")[0], product: key.split("|")[1] || "", price, assumed: assumed.has(key) }));
}
export function saveMsrpTable(rows) {
  if (!Array.isArray(rows) || rows.length > 500) throw new Error("Bad table.");
  const msrp = {}, assumed = [];
  for (const r of rows) {
    const set = String(r.set || "").trim().slice(0, 120), product = String(r.product || "").trim().slice(0, 60), price = Number(r.price);
    if (!set && !product) continue;
    if (!set || !product || /\|/.test(set + product)) throw new Error("Each row needs a set and a booster type.");
    if (!Number.isFinite(price) || price <= 0 || price > 10000) throw new Error(`${set} ${product}: the price needs to be a number above 0.`);
    msrp[`${set}|${product}`] = Math.round(price * 100) / 100;
    if (r.assumed) assumed.push(`${set}|${product}`);
  }
  const cfg = loadPipelineConfig();
  const id = msrpChannel(cfg);
  if (!id) throw new Error("No channel here keeps a pack price table.");
  cfg.channels[id].msrp = msrp;
  cfg.channels[id].msrpAssumptions = assumed;
  savePipelineConfig(cfg);
  logEvent("msrp edit", { trigger: "button", rows: Object.keys(msrp).length });
  return msrpTable();
}

// Files you can download from Admin (read-only copies).
export function downloadables() {
  const cfg = loadPipelineConfig();
  const list = [
    ...trackerFiles(cfg).map((t) => t.key === "logPath"
      ? [`${t.id}-log`, `${channelName(t.id, cfg)} Upload Log`, t.path]
      : [`${t.id}-tracker`, `${channelName(t.id, cfg)} ${fromModule(cfg.channels[t.id]?.module || t.id, "trackerName") || "tracker"}`, t.path]),
    ["run-log", "Run log (every run, one line each)", "data/logs/runs.jsonl"],
    ["corrections", "Your corrections to the pipeline", "data/feedback/corrections.jsonl"],
    ...Object.keys(cfg.channels || {}).filter((id) => fromModule(cfg.channels[id]?.module || id, "renderFeedback")).map((id) => [`${id}-feedback`, `${channelName(id, cfg)} render feedback`, `data/feedback/${id}.jsonl`]),
    ["security-log", "Security log", "data/security.log"],
  ];
  return list.map(([key, label, p]) => {
    const file = p && resolvePath(p);
    const ok = file && fs.existsSync(file);
    return { key, label, file: ok ? file : null, name: file ? path.basename(file) : null, bytes: ok ? fs.statSync(file).size : null };
  });
}

// Tool versions, and whether Node and Python are still supported (endoflife.date, free, no sign-in).
let eolCache = { at: 0, data: {} };
async function support(product, version) {
  if (Date.now() - eolCache.at > 864e5) eolCache = { at: Date.now(), data: {} };
  try {
    eolCache.data[product] ??= await (await fetch(`https://endoflife.date/api/${product}.json`, { signal: AbortSignal.timeout(10000) })).json();
    const cycles = eolCache.data[product];
    const parts = version.split(".");
    const c = cycles.find((x) => x.cycle === parts[0]) || cycles.find((x) => x.cycle === `${parts[0]}.${parts[1]}`);
    if (!c) return null;
    const eol = typeof c.eol === "string" ? c.eol : null;
    return { latest: c.latest, eol, supported: c.eol === false || (eol && Date.parse(eol) > Date.now()), newestCycle: cycles[0]?.cycle };
  } catch {
    return null;
  }
}
const first = async (cmd, args) => {
  try {
    const { stdout, stderr } = await run(cmd, args, { timeout: 10000, windowsHide: true });
    return (stdout || stderr).split("\n")[0].trim();
  } catch {
    return null;
  }
};
export async function versions() {
  const cfg = loadPipelineConfig();
  const pkg = JSON.parse(fs.readFileSync(resolvePath("package.json"), "utf8"));
  const node = process.version.replace(/^v/, "");
  const pyLine = await first(pythonCmd(), ["--version"]);
  const py = pyLine?.match(/(\d+\.\d+\.\d+)/)?.[1] || null;
  const ff = await first(ffmpegCmd(cfg), ["-version"]);
  const git = await first("git", ["-C", resolvePath("."), "log", "-1", "--format=%h %cs"]);
  return {
    app: { version: pkg.version, commit: git },
    node: { version: node, ...(await support("nodejs", node)) },
    python: py ? { version: py, ...(await support("python", py)) } : { version: null },
    ffmpeg: { version: ff?.match(/ffmpeg version (\S+)/)?.[1] || ff },
    playwright: { version: pkg.dependencies?.playwright || null },
  };
}

// Posting schedule per channel: times for weekdays and weekends, and the most videos a day. Each change is logged
// with the owner's reason (data/feedback/schedule.jsonl) so the rules review can judge it against the numbers.
const SCHED_LOG = () => resolvePath("data/feedback/schedule.jsonl");
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export function scheduleTable() {
  const cfg = loadPipelineConfig();
  return Object.entries(cfg.channels).map(([id, c]) => ({
    id,
    name: channelName(id, cfg),
    weekday: c.slots?.weekday || [],
    weekend: c.slots?.weekend || [],
    perDay: perDayOf(id, c),
    live: Boolean(c.live),
  }));
}
export function saveSchedule(rows, note) {
  if (!Array.isArray(rows)) throw new Error("Bad schedule.");
  const cfg = loadPipelineConfig();
  const changes = [];
  for (const r of rows) {
    const c = cfg.channels[r.id];
    if (!c) continue;
    const list = (v) => [...new Set(String(Array.isArray(v) ? v.join(",") : v || "").split(/[,\s]+/).filter(Boolean))].sort();
    const weekday = list(r.weekday), weekend = list(r.weekend);
    for (const t of [...weekday, ...weekend]) if (!TIME.test(t)) throw new Error(`${channelName(r.id, cfg)}: "${t}" isn't a time like 12:00 or 18:30.`);
    if (!weekday.length || !weekend.length) throw new Error(`${channelName(r.id, cfg)}: give at least one weekday and one weekend time.`);
    const perDay = r.perDay === "" || r.perDay == null ? null : Math.round(Number(r.perDay));
    if (perDay != null && !(perDay >= 1 && perDay <= 10)) throw new Error(`${channelName(r.id, cfg)}: videos a day needs to be 1 to 10, or blank for no limit.`);
    const before = { weekday: c.slots?.weekday || [], weekend: c.slots?.weekend || [], perDay: c.perDay ?? null };
    const after = { weekday, weekend, perDay };
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    c.slots = { weekday, weekend };
    c.perDay = perDay;
    changes.push({ channel: r.id, before, after });
  }
  if (!changes.length) return { rows: scheduleTable(), changed: 0 };
  savePipelineConfig(cfg);
  const at = new Date().toISOString();
  const why = String(note || "").trim().slice(0, 1000);
  appendJsonl(SCHED_LOG(), ...changes.map((ch) => ({ at, ...ch, why })));
  logEvent("schedule edit", { trigger: "button", channels: changes.map((c) => c.channel).join(", ") });
  return { rows: scheduleTable(), changed: changes.length };
}
export function scheduleNotes(channel, days = 180) {
  try {
    const since = Date.now() - days * 864e5;
    return readJsonl(SCHED_LOG())
      .filter((r) => r.channel === channel && Date.parse(r.at) > since)
      .map((r) => ({ at: r.at.slice(0, 10), before: r.before, after: r.after, why: r.why }));
  } catch {
    return [];
  }
}
