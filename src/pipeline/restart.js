// Remote restart from the dashboard. The app just exits; start-pipeline.cmd (and the auto-start, which runs it)
// starts it again 10 seconds later. Started any other way (plain npm start), nothing would bring it back, so the
// button is only offered when start-pipeline.cmd set YTW_SUPERVISED.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { listJobs } from "./jobs.js";
import { pullState } from "./stats.js";
import { scanState } from "./dealwatch.js";
import { healthStatus } from "./health.js";
import { logEvent, openRuns } from "./runlog.js";
import { kindName } from "./queue.js";
import { partsWith } from "../hub/extras.js";
import { resolvePath, writeJsonAtomic, readJson, listFiles } from "./util.js";
import { hubSettings } from "../hub/settings.js";
import { currentFormat } from "../hub/migrations.js";

const startedAt = new Date().toISOString();
const NOTE = () => resolvePath("data/restart.json");

export const supervised = () => process.env.YTW_SUPERVISED === "1";
// The start script this app folder ships, if any (the kit does not ship one: it starts with npm start).
export const starterFile = () => ["start-pipeline.cmd", "start-pipeline.sh"].find((f) => fs.existsSync(resolvePath(f))) || null;

// Runs the lines above already name (or that the Queue page leaves out), so they aren't listed twice.
const NAMED = new Set(["pipeline job", "quick pull", "full pull", "advanced pull", "deal scan", "health check", "app action"]);
// What a restart would cut off: those, every other open run in the run log (worded as the Queue page words it), and whatever a private part is running.
export function busyWith() {
  const out = [];
  for (const j of listJobs().filter((j) => j.status === "running")) out.push(`a video job (${j.sourceName}, ${j.stage})`);
  if (pullState.running) out.push(`a stats pull (${pullState.done} of ${pullState.total || "?"} done)`);
  if (scanState.running) out.push("a deal watch scan");
  if (healthStatus().running) out.push("a health check");
  for (const r of openRuns()) if (!NAMED.has(r.kind)) out.push(kindName(r.kind).toLowerCase());
  for (const p of partsWith("busy")) { const b = p.busy(); if (b) out.push(b); }
  return out;
}

// The version this app runs: the kit's name and version (hub.defaults.json "kit"), the data format it understands, and, on a git
// checkout, the commit (asked once). A copy that has hub.owner.json is its owner's own hub, not a plain kit.
let commit;
const gitCommit = () => {
  if (commit !== undefined) return commit;
  commit = null;
  try {
    if (fs.existsSync(resolvePath(".git"))) {
      const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: resolvePath("."), encoding: "utf8", timeout: 3000, windowsHide: true });
      if (r.status === 0) commit = String(r.stdout).trim() || null;
    }
  } catch {}
  return commit;
};
export const kitInfo = () => { const k = hubSettings().kit || {}; return { name: k.name || "Deskcity", version: k.version || null, format: currentFormat(), commit: gitCommit(), ownersCopy: fs.existsSync(resolvePath("hub.owner.json")), updatesUrl: k.updatesUrl ? String(k.updatesUrl) : "" }; };

export function appInfo() {
  const last = readJson(NOTE(), null);
  return { kit: kitInfo(), startedAt, uptimeMs: Date.now() - Date.parse(startedAt), supervised: supervised(), starter: starterFile(), busy: busyWith(), lastRestart: last, node: process.version, pid: process.pid, codeChanged: codeChangedSince() };
}
// Server code (server.js, src/) saved after this app started: a restart is needed to load it.
function codeChangedSince() {
  const t0 = Date.parse(startedAt);
  const newer = [];
  const isNewer = (p) => { try { return fs.statSync(p).mtimeMs > t0 + 2000; } catch { return false; } };
  const rel = (p) => path.relative(resolvePath("."), p).replace(/\\/g, "/");
  if (isNewer(resolvePath("server.js"))) newer.push("server.js");
  for (const p of listFiles(resolvePath("src"), { match: /\.(js|mjs)$/ })) if (isNewer(p)) newer.push(rel(p));
  return newer.slice(0, 20);
}

// force: restart even though something is running (it's lost and has to be started again).
export function restartApp({ force = false } = {}) {
  if (!supervised()) return { ok: false, message: starterFile() ? `The app wasn't started with ${starterFile()}, so nothing would start it again. Start it that way once (or use the auto-start) and the button works from then on.` : "Nothing would start the app again after it stops. Close it and start it again with npm start." };
  const busy = busyWith();
  if (busy.length && !force) return { ok: false, busy, message: `It's in the middle of ${busy.join(", ")}. Restarting now would stop that.` };
  const pulled = pullMain();
  writeJsonAtomic(NOTE(), { at: new Date().toISOString(), cut: busy, pulled }, 2);
  logEvent("restart", { busy, forced: force && busy.length > 0, pulled });
  setTimeout(() => process.exit(0), 800);
  return { ok: true, pulled, message: `${pulled.note} Restarting. The page comes back in about 20 seconds.` };
}

// the owner 2026-11-13: "can't you usually merge without screen control?" Merging happens on GitHub; getting it onto this
// PC took a pull in GitHub Desktop. So a restart first fast-forwards the hub folder to GitHub's main, when it's on main.
// Fast-forward only: local changes and other branches are never touched, and anything odd just skips the pull.
export function pullMain(run = (args) => spawnSync("git", args, { cwd: resolvePath("."), encoding: "utf8", timeout: 30000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })) {
  const git = (...a) => { const r = run(a); return { ok: r.status === 0, out: String(r.stdout || "").trim(), err: String(r.stderr || r.error?.message || "").trim() }; };
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (!branch.ok) return { done: false, note: "Not pulled: this folder isn't a git checkout." };
  if (branch.out !== "main") return { done: false, note: `Not pulled: the hub folder is on ${branch.out}, not main.` };
  const before = git("rev-parse", "--short", "HEAD").out;
  const pull = git("pull", "--ff-only", "origin", "main");
  if (!pull.ok) {
    // name the files in the way (2026-11-13: the note stopped at "would be overwritten by merge:")
    const files = pull.err.split("\n").filter((l) => /^\s+\S/.test(l)).map((l) => l.trim()).slice(0, 8);
    const why = /local changes .* overwritten/i.test(pull.err) ? `uncommitted changes in ${files.join(", ") || "the hub folder"} (another session's work?) are in the way; commit them or open their PR, then Restart again` : (pull.err.split("\n").find((l) => /error|fatal/i.test(l)) || pull.err).slice(0, 200) || "git pull failed";
    return { done: false, note: `Not pulled: ${why}.`, files, before };
  }
  const after = git("rev-parse", "--short", "HEAD").out;
  return { done: true, before, after, note: before === after ? `Already up to date (${after}).` : `Pulled ${before} → ${after}.` };
}
