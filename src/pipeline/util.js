import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config as appConfig } from "../config.js";
import { writeFileAtomic, writeJsonAtomic } from "./files.js";
export * from "./files.js";
import { dayIn, partsIn } from "./fmt.js";
import { hubTz, hubName } from "../hub/settings.js";
export { ownerName as OWNER, hubFolder, hubName, agentName } from "../hub/settings.js";
export { dayIn, hourIn } from "./fmt.js";

const CONFIG_FILE = path.join(appConfig.rootDir, "pipeline.config.json");

export function loadPipelineConfig() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  // Channels as a map with no prototype (code review 2026-10-22): a channel id like "__proto__" from a request then
  // finds nothing, instead of reaching Object.prototype and changing every object in the app.
  if (cfg.channels) cfg.channels = Object.assign(Object.create(null), cfg.channels);
  return cfg;
}

export function savePipelineConfig(cfg) {
  writeFileAtomic(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n");
}

// The hub settings' time zone (place.timezone, else this computer's), for a config with no "timezone" of its own.
export const DEFAULT_TZ = hubTz();
// The pipeline's time zone. Pass a config you already loaded to save a read.
export const pipelineTz = (cfg = loadPipelineConfig()) => cfg.timezone || DEFAULT_TZ;

// Once-a-day checks: true from hour:minute on in `tz` (on `weekday`, "Sun".."Sat", when given), unless `last` (a time)
// falls on today's date in `tz`. Callers keep their own extra rules.
export function dueAt({ hour, minute = 0, weekday, last = null, tz = pipelineTz(), now = new Date() }) {
  const p = partsIn(tz, now);
  if (weekday && p.weekday !== weekday) return false;
  if (!(p.hh * 60 + p.mm >= hour * 60 + minute)) return false;
  return !last || dayIn(tz, new Date(last)) !== dayIn(tz, now);
}

// Tools and folders named in pipeline.config.json. Pass a config you already loaded to save a read.
export const ffmpegCmd = (cfg = loadPipelineConfig()) => cfg.ffmpeg || "ffmpeg";
export const ffprobeCmd = (cfg = loadPipelineConfig()) => cfg.ffprobe || "ffprobe";
export const backupHour = (cfg = loadPipelineConfig()) => cfg.backup?.hour ?? 3;
export const healthHour = (cfg = loadPipelineConfig()) => cfg.health?.hour ?? 9;
export const backupDir = (cfg = loadPipelineConfig()) => resolvePath(cfg.backup?.dir || `../${hubName()}-backups`);
export const chromeProfileDir = () => resolvePath(loadPipelineConfig().chromeProfileDir);

// One channel's settings from pipeline.config.json (undefined for an unknown id), its display name (the id when there
// is no name), and a job's label for alerts, the queue and the disk list ("a channel Ep 12" or "<channel> <source>").
export const channelCfg = (id, cfg = loadPipelineConfig()) => cfg.channels?.[id];
export const channelName = (id, cfg = loadPipelineConfig()) => cfg.channels?.[id]?.name || id;
// The tracker files the channels keep (a channel's "trackerPath" spreadsheet and "logPath" upload log), in config order:
// [{ id, key: "trackerPath" | "logPath", path }].
export const trackerFiles = (cfg = loadPipelineConfig()) =>
  Object.entries(cfg.channels || {}).flatMap(([id, c]) => ["trackerPath", "logPath"].filter((key) => c?.[key]).map((key) => ({ id, key, path: c[key] })));
export const jobLabel = (job, cfg = loadPipelineConfig()) => `${channelName(job.channel, cfg)} ${job.data?.episode ? `Ep ${job.data.episode}` : job.sourceName}`;

// A channel's rules file (its contextFile). mode "throw": an unknown channel or missing file throws; "empty": any
// error gives ""; "ifMissing": "" when the channel has no file or it isn't on disk.
export function channelRules(id, mode = "throw", cfg = loadPipelineConfig()) {
  const file = cfg.channels?.[id]?.contextFile;
  if (mode === "ifMissing") return file && fs.existsSync(resolvePath(file)) ? fs.readFileSync(resolvePath(file), "utf8") : "";
  try {
    return fs.readFileSync(resolvePath(file), "utf8");
  } catch (err) {
    if (mode === "empty") return "";
    throw err;
  }
}

// On Windows plain "python" is often the Microsoft Store shortcut, so look for the real install.
// On Linux (the home server) "python" means the app's own .venv if there is one, else python3.
export function pythonCmd() {
  const p = loadPipelineConfig().python || "python";
  if (process.platform !== "win32" && /^python3?$/.test(p)) {
    const venv = path.join(appConfig.rootDir, ".venv", "bin", "python");
    return fs.existsSync(venv) ? venv : "python3";
  }
  if (process.platform !== "win32" || !/^python(\.exe)?$/i.test(p)) return p;
  const base = path.join(process.env.LOCALAPPDATA || "", "Programs", "Python");
  try {
    const dirs = fs.readdirSync(base).filter((d) => /^Python3\d+/i.test(d)).sort((a, b) => parseInt(b.slice(6)) - parseInt(a.slice(6)));
    for (const d of dirs) {
      const exe = path.join(base, d, "python.exe");
      if (fs.existsSync(exe)) return exe;
    }
  } catch {}
  return p;
}

// Arial Bold for burned-in text. The Windows path in the config doesn't exist on Linux, so fall back to the
// Microsoft fonts package (ttf-mscorefonts-installer), then a font every Linux has.
const FONT_FALLBACKS = [
  "/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf",
  "/usr/share/fonts/truetype/msttcorefonts/arialbd.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
];
export function fontFile() {
  const p = loadPipelineConfig().fontPath;
  if (p && fs.existsSync(p)) return p;
  return FONT_FALLBACKS.find((f) => fs.existsSync(f)) || p;
}

// Standby (for moving the hub to another computer; added 2026-10-19): a copy of the app that must never post. While data/standby.json says
// standby, nothing uploads, changes visibility, pins or posts to TikTok; only TEST_ jobs run, so the new box can be
// tried beside the live PC without double posts. Turned off on the box that becomes the live one.
const STANDBY_FILE = () => path.join(appConfig.rootDir, "data", "standby.json");
export function standbyState() {
  try {
    const s = JSON.parse(fs.readFileSync(STANDBY_FILE(), "utf8"));
    return s && s.standby ? s : { standby: false };
  } catch (err) {
    // No file means not on standby. A file that exists but can't be read fails closed (code review 2026-10-22): a
    // copy that must never post shouldn't start posting because its standby flag got cut off.
    if (err.code === "ENOENT") return { standby: false };
    return { standby: true, reason: `data/standby.json couldn't be read (${String(err.message).slice(0, 80)}). Fix or delete it.` };
  }
}
export function setStandby(on, reason = "") {
  const s = on ? { standby: true, reason, at: new Date().toISOString() } : { standby: false, at: new Date().toISOString() };
  writeJsonAtomic(STANDBY_FILE(), s);
  return s;
}
export function assertLiveCopy(what) {
  const s = standbyState();
  if (s.standby) throw new Error(`This copy of the app is on standby, so it didn't ${what}.${s.reason ? ` (${s.reason})` : ""}`);
}

export function resolvePath(p) {
  return path.resolve(appConfig.rootDir, p);
}

// The channels' brand-memory files (channels.*.contextFile) that aren't on disk; the start-up check warns about them.
export function missingContextFiles(cfg = loadPipelineConfig()) {
  return Object.values(cfg.channels || {}).map((ch) => ch.contextFile).filter((f) => f && !fs.existsSync(resolvePath(f)));
}

export function run(cmd, args, { cwd, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true });
    const out = [];
    const err = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", reject);
    if (input !== undefined) child.stdin.end(input);
    child.on("close", (code) => {
      const stdout = Buffer.concat(out);
      const stderr = Buffer.concat(err).toString();
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(cmd)} exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

// Thrown by a stage when the job must wait for the owner. `review` is shown (and editable) on the dashboard.
// fields: boxes the job card shows so the owner can answer on the site ([{ key, label, type: "number" | "text" | "select" |
// "checkbox", options, value, hint }]). The answers reach the stage as job.data.answers[stage] on the next run.
export class Hold extends Error {
  constructor(reason, review, { fields = null, images = null, points = null } = {}) {
    super(reason);
    this.review = review;
    this.fields = fields;
    this.images = images; // file names in the job folder to show on the card, like the wrapper frames
    this.points = points; // [{ what, detail }]: a short list on the card, each detail behind a tap
  }
}

export const money = (n) => `${n < 0 ? "-" : "+"}$${Math.abs(n).toFixed(2)}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Random ids: 5 bytes = 10 hex characters (jobs, trades, to-do items, requests). Other lengths: pass bytes.
export const newId = (bytes = 5) => crypto.randomBytes(bytes).toString("hex");
export const isId = (s) => typeof s === "string" && /^[a-f0-9]{10}$/.test(s);

// Repeating background job. Runs fn (sync or async) inside a catch, logs a failure as `<label>: <msg>` (quiet: silent),
// and clears any earlier timer with the same label. firstMs adds one early run; unref keeps the timer from holding the app open.
const everyTimers = new Map();
export function every(label, fn, ms, { firstMs, quiet, unref } = {}) {
  const old = everyTimers.get(label);
  if (old) { clearTimeout(old.first); clearInterval(old.tick); }
  const run = async () => {
    try { await fn(); } catch (err) { if (!quiet) console.warn(`${label}: ${err.message}`); }
  };
  const first = firstMs == null ? null : setTimeout(run, firstMs);
  const tick = setInterval(run, ms);
  if (unref) tick.unref?.();
  everyTimers.set(label, { first, tick });
}
