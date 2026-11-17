// Nightly backup of what can't be rebuilt: the trackers, the channel reference files, settings, and every job's
// record (not the videos). One dated folder per night in backup.dir, keeping the last backup.keep (default 14).
// Point backup.dir at a OneDrive or Google Drive folder and the copies leave the PC too. backup.copies is a list of
// extra folders (another drive, Google Drive's "My Drive") that each get the same dated folder after it's made.
import { startRun } from "./runlog.js";
import { jobsDir } from "./jobs.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hubSettings } from "../hub/settings.js";
import { trackerFiles, loadPipelineConfig, pipelineTz, dayIn, dueAt, backupDir, backupHour, resolvePath, readJson, writeJsonAtomic, listFiles } from "./util.js";

const STATUS = () => resolvePath("data/backup.json");
// A nightly backup is a folder named for its day. Only folders with this name are ever pruned, here or in the second place.
export const BACKUP_NAME = /^\d{4}-\d{2}-\d{2}$/;
// What a backup leaves out on purpose (secrets and working state): a real restore means you re-enter or re-make these.
export const LEFT_OUT = [
  [".env", "API keys and the dashboard password: type them in again (the setup guide does it)"],
  ["data/agents/token.txt", "the agents token: a new one is made on first start; sessions and tools that used the old one need the new one"],
  ["data/security.json", "sign-in keys and trusted devices: sign in again and re-trust each device"],
  ["data/auth.json", "saved sign-in state: sign in again"],
  ["data/agents/hook-state.json", "session hook state: rebuilt as sessions report in"],
  ["data/scryfall-cache.json, data/restart.json, data/cards.json", "caches and working files: rebuilt by themselves"],
  ["data/jobs-archive, logs, health, debug, chrome-profile, tmp, cache", "working folders and logs: not needed to run"],
  ["videos and large media", "not backed up; only job records are"],
];

export const lastBackup = () => readJson(STATUS(), null);

function copy(from, to, list) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  list.push(path.basename(from));
}

// Everything typed in by hand or learned over time (code review 2026-10-22: the backup used to leave out the card
// collection, trades, to-do, reading list, decks, matches and the AI's feedback). Text data only, from data/, with
// working files, caches, logs and screenshots left out. security.json (sign-in keys) stays out on purpose.
const DATA_SKIP_DIRS = new Set(["jobs", "jobs-archive", "logs", "health", "debug", "chrome", "chrome-profile", "tmp", "cache"]);
const DATA_SKIP_FILES = new Set(["security.json", "scryfall-cache.json", "restart.json", "cards.json", "token.txt", "hook-state.json", "auth.json"]);
// Secrets never leave the PC (the backup also goes to Google Drive): no tokens, keys or auth state.
const SECRET_FILE = /(token|secret|password|apikey|api-key|credential)s?(\.|$)|^\.env/i;
function copyData(fromDir, toDir, list, depth = 0) {
  if (!fs.existsSync(fromDir) || depth > 4) return;
  for (const e of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const from = path.join(fromDir, e.name);
    if (e.isDirectory()) {
      if (!DATA_SKIP_DIRS.has(e.name.toLowerCase())) copyData(from, path.join(toDir, e.name), list, depth + 1);
    } else if (e.isFile() && /\.(json|jsonl|csv|md|txt|done)$/i.test(e.name) && !DATA_SKIP_FILES.has(e.name) && !SECRET_FILE.test(e.name) && !/\.tmp$/i.test(e.name)) {
      if (fs.statSync(from).size <= 50 * 1024 * 1024) copy(from, path.join(toDir, e.name), list);
    }
  }
}

// The second place (the owner 2026-11-16: "a second copy somewhere else, keep 14"): settings' backup.copyTo (a folder, none by
// default) and backup.keep (default 14), set in hub.owner.json / data/hub-settings.json, never typed in the page.
// A test or check hub (HUB_TEST_ROOT) only copies to a folder under the temp folder, so a test run on a PC whose owner
// file names a real drive never writes there (HUB_BACKUP_COPY_ANY=1 lifts it, for the one deliberate real-drive check).
export function copyTarget() {
  const raw = String(hubSettings().backup?.copyTo || "").trim();
  if (!raw) return null;
  const dir = path.resolve(raw);
  if (process.env.HUB_TEST_ROOT && process.env.HUB_BACKUP_COPY_ANY !== "1") {
    const rel = path.relative(os.tmpdir(), dir);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  }
  return dir;
}
export function keepCount(cfg = loadPipelineConfig()) {
  const n = Number(cfg.backup?.keep ?? hubSettings().backup?.keep ?? 14);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 14;
}

// Keep the newest `keep` dated backup folders in dir. Touches nothing that is not a dated folder; does nothing at all when
// the listing fails. Never throws.
export function pruneBackups(dir, keep) {
  let names;
  try {
    names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && BACKUP_NAME.test(e.name)).map((e) => e.name).sort();
  } catch (err) {
    return { removed: [], error: err.message.split("\n")[0] };
  }
  const removed = [], failed = [];
  for (const old of names.slice(0, Math.max(0, names.length - keep))) {
    try { fs.rmSync(path.join(dir, old), { recursive: true, force: true }); removed.push(old); } catch (err) { failed.push(`${old}: ${err.message.split("\n")[0]}`); }
  }
  return { removed, ...(failed.length ? { error: failed.join("; ") } : {}) };
}

// Copy today's backup folder to the second place. The folder must exist, or its parent must (then one level is made): a
// drive that is not mounted fails here, in words, and the backup itself still counts as done.
function copyToSecond(dest, day, root, keep) {
  try {
    if (!fs.existsSync(root)) {
      if (!fs.existsSync(path.dirname(root))) throw new Error("the folder isn't there and neither is the one it sits in (is the drive connected?)");
      fs.mkdirSync(root);
    }
    fs.cpSync(dest, path.join(root, day), { recursive: true });
    const pr = pruneBackups(root, keep);
    return { dir: root, ok: true, ...(pr.error ? { pruneError: pr.error } : {}) };
  } catch (err) {
    return { dir: root, ok: false, error: err.message.split("\n")[0] };
  }
}

// One alert a day at most when the second copy fails (it never fails the backup). Returns the day alerted.
function alertCopyFailed(copyTo, prev, day) {
  if (prev?.copyTo?.alertedOn === day) return day;
  import("./notify.js").then((n) => n.sendAlert({ title: "Backup copy failed", message: `Tonight's backup is safe on this PC, but the second copy to ${copyTo.dir} failed: ${copyTo.error}`, tags: ["warning"], kind: "health_problem" })).catch((err) => console.warn(`Backup alert failed: ${err.message}`));
  return day;
}

// For the Admin card: where the copies go and when each extra place last worked. Two ways to name an extra place:
// the older pipeline.config.json backup.copies list and settings' backup.copyTo; `extra` lists every one that is set,
// with how the last backup went there (an older status line without a time counts from the backup's own time).
export function backupSummary() {
  const last = lastBackup();
  const cfg = loadPipelineConfig();
  const copyToDir = copyTarget();
  const base = path.resolve(backupDir(cfg)).toLowerCase();
  const seen = new Set([base]);
  const extra = [];
  for (const raw of cfg.backup?.copies || []) {
    const dir = resolvePath(raw);
    if (seen.has(dir.toLowerCase())) continue;
    seen.add(dir.toLowerCase());
    const st = (last?.copies || []).find((c) => c.dir === dir);
    extra.push({ dir, from: "copies", ran: !!st, ok: st ? st.ok : null, error: st?.error || null, lastOk: st ? st.lastOk || (st.ok ? st.at || last.at : null) : null });
  }
  if (copyToDir && !seen.has(copyToDir.toLowerCase())) {
    const st = last?.copyTo || null;
    extra.push({ dir: copyToDir, from: "copyTo", ran: !!st, ok: st ? st.ok : null, error: st?.error || null, lastOk: st?.lastOk || null, keep: st?.keep || null });
  }
  return { dir: backupDir(cfg), keep: keepCount(cfg), copyToDir, extra, last, copy: last?.copyTo || null };
}

export function runBackup({ trigger = "button" } = {}) {
  const log = startRun("backup", { trigger });
  const cfg = loadPipelineConfig();
  const base = backupDir(cfg);
  const tz = pipelineTz(cfg);
  const day = dayIn(tz);
  const dest = path.join(base, day);
  const files = [];
  try {
    fs.mkdirSync(dest, { recursive: true });
    for (const t of trackerFiles(cfg)) copy(resolvePath(t.path), path.join(dest, "trackers", path.basename(t.path)), files);
    const refs = resolvePath("References");
    if (fs.existsSync(refs)) for (const f of fs.readdirSync(refs)) if (/\.md$/i.test(f)) copy(path.join(refs, f), path.join(dest, "References", f), files);
    copy(resolvePath("pipeline.config.json"), path.join(dest, "pipeline.config.json"), files);
    copyData(resolvePath("data"), path.join(dest, "data"), files);
    copy(resolvePath("data/security.log"), path.join(dest, "data", "security.log"), files);
    const jobs = jobsDir();
    let jobCount = 0;
    if (fs.existsSync(jobs)) for (const id of fs.readdirSync(jobs)) {
      const j = path.join(jobs, id, "job.json");
      if (fs.existsSync(j)) {
        fs.mkdirSync(path.join(dest, "jobs"), { recursive: true });
        fs.copyFileSync(j, path.join(dest, "jobs", `${id}.json`));
        jobCount++;
      }
    }
    const keep = keepCount(cfg);
    pruneBackups(base, keep); // a listing problem leaves every folder alone and does not fail the backup
    // Extra copies (the owner 2026-10-19: other drives or Google Drive). A missing drive doesn't fail the main backup.
    const copies = [];
    const prevCopies = lastBackup()?.copies || [];
    const seen = new Set([path.resolve(base).toLowerCase()]);
    for (const extra of cfg.backup?.copies || []) {
      const root = resolvePath(extra);
      if (seen.has(root.toLowerCase())) continue;
      seen.add(root.toLowerCase());
      try {
        fs.cpSync(dest, path.join(root, day), { recursive: true });
        pruneBackups(root, keep);
        const at = new Date().toISOString();
        copies.push({ dir: root, ok: true, at, lastOk: at });
      } catch (err) {
        const before = prevCopies.find((c) => c.dir === root); // when it last worked, carried over (an older line: the backup's time)
        copies.push({ dir: root, ok: false, error: err.message.split("\n")[0], at: new Date().toISOString(), lastOk: before?.lastOk || (before?.ok ? lastBackup()?.at : null) || null });
      }
    }
    // The second place from the settings (backup.copyTo), with its own line in the status.
    let copyTo = null;
    const second = copyTarget();
    if (second && !seen.has(second.toLowerCase())) {
      const prev = lastBackup();
      const r = copyToSecond(dest, day, second, keep);
      const now = new Date().toISOString();
      copyTo = { ...r, at: now, keep, lastOk: r.ok ? now : prev?.copyTo?.lastOk || null, alertedOn: prev?.copyTo?.alertedOn || null };
      if (!r.ok) copyTo.alertedOn = alertCopyFailed(copyTo, prev, day);
    }
    const status = { at: new Date().toISOString(), ok: true, dir: base, files: files.length, jobs: jobCount, ...(copies.length ? { copies } : {}), ...(copyTo ? { copyTo } : {}) };
    writeJsonAtomic(STATUS(), status);
    log.end({ dir: base, files: files.length, jobs: jobCount });
    return status;
  } catch (err) {
    // A tracker open in Excel can still be copied; this is for a missing or full backup drive.
    const status = { at: new Date().toISOString(), ok: false, dir: base, error: err.message };
    writeJsonAtomic(STATUS(), status);
    log.end({ error: err.message, dir: base });
    return status;
  }
}

// Called every minute by server.js: once a night at backup.hour (default 3 am).
export function backupTick() {
  const cfg = loadPipelineConfig();
  const last = lastBackup();
  if (last && !last.ok && Date.now() - Date.parse(last.at) < 3600000) return; // failed: try again in an hour
  if (dueAt({ tz: pipelineTz(cfg), hour: backupHour(cfg), last: last?.ok ? last.at : null })) runBackup({ trigger: "nightly" });
}

// Restore. A backup folder holds trackers/, References/, data/, jobs/ and pipeline.config.json; each maps back to
// where it lives on the PC. Before anything is overwritten, the current file is copied into a
// "before-restore-<time>" folder next to the backups, so a restore can itself be undone from the same list.
const KEEP_UNDO = 5;
function livePath(rel, cfg) {
  const [top, ...rest] = rel.split("/");
  const name = rest.join("/");
  if (rel === "pipeline.config.json") return resolvePath("pipeline.config.json");
  if (top === "References" && rest.length === 1) return resolvePath(path.join("References", name));
  // Any backed-up data file can be put back, except the security log (a record, not settings).
  if (top === "data" && name && !name.split("/").includes("..") && name !== "security.log" && !DATA_SKIP_FILES.has(path.basename(name))) return resolvePath(`data/${name}`);
  if (top === "trackers" && rest.length === 1) {
    for (const { path: p } of trackerFiles(cfg)) if (path.basename(p) === name) return resolvePath(p);
    return null;
  }
  if (top === "jobs" && /^[\w-]+\.json$/.test(name)) {
    const dir = path.join(jobsDir(), name.replace(/\.json$/, ""));
    return fs.existsSync(dir) ? path.join(dir, "job.json") : null; // only jobs still on the PC
  }
  return null;
}
function walk(dir) {
  return listFiles(dir).map((p) => {
    const st = fs.statSync(p);
    return { rel: path.relative(dir, p).split(path.sep).join("/"), size: st.size, at: st.mtime.toISOString() };
  });
}

const summaryParts = () => { const { keep, copyToDir, extra, last, copy } = backupSummary(); return { keep, copyToDir, extra, last, copy }; };

export function listBackups() {
  const cfg = loadPipelineConfig();
  const base = backupDir(cfg);
  if (!fs.existsSync(base)) return { dir: base, backups: [], ...summaryParts() };
  const backups = fs
    .readdirSync(base)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$|^before-restore-[\dT-]+$/.test(d))
    // Nightly backups first (newest at the top), then the "before restore" copies, newest first.
    .sort((x, y) => (x.startsWith("b") === y.startsWith("b") ? y.localeCompare(x) : x.startsWith("b") ? 1 : -1))
    .map((name) => {
      const files = walk(path.join(base, name)).map((f) => ({ ...f, restorable: Boolean(livePath(f.rel, cfg)) }));
      return { name, undo: name.startsWith("before-restore-"), files };
    });
  return { dir: base, backups, ...summaryParts() };
}

export function restoreBackup(name, picks) {
  const cfg = loadPipelineConfig();
  const base = backupDir(cfg);
  const found = listBackups().backups.find((b) => b.name === name);
  if (!found) throw new Error("That backup isn't there any more.");
  const want = picks === "all" ? found.files.filter((f) => f.restorable) : found.files.filter((f) => f.restorable && picks.includes(f.rel));
  if (!want.length) throw new Error("Pick at least one file to restore.");
  const log = startRun("restore", { trigger: "button", backup: name, files: want.length });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const undo = path.join(base, `before-restore-${stamp}`);
  const done = [], failed = [];
  for (const f of want) {
    const to = livePath(f.rel, cfg);
    try {
      if (fs.existsSync(to)) {
        fs.mkdirSync(path.dirname(path.join(undo, f.rel)), { recursive: true });
        fs.copyFileSync(to, path.join(undo, f.rel));
      }
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(base, name, f.rel), to);
      done.push(f.rel);
    } catch (err) {
      // Usually a tracker open in Excel.
      failed.push(`${f.rel}: ${err.code === "EBUSY" || err.code === "EPERM" ? "in use (close it in Excel and try again)" : err.message}`);
      log.warn(`${f.rel}: ${err.message}`);
    }
  }
  const undos = fs.readdirSync(base).filter((d) => d.startsWith("before-restore-")).sort();
  for (const old of undos.slice(0, Math.max(0, undos.length - KEEP_UNDO))) fs.rmSync(path.join(base, old), { recursive: true, force: true });
  log.end({ restored: done.length, failed: failed.length, problems: failed, undo: done.length ? path.basename(undo) : null });
  return { restored: done, failed, undo: done.length ? path.basename(undo) : null };
}
