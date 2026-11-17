// What a lead's own Claude Code session (Push, "work on your own") is kept away from. Security audit 2026-11-11,
// findings 1 and 2 (docs/security/audit-2026-11-11.md): such a session could read the hub's .env and was started with
// every hub key in its environment, and it could edit a script it is allowed to run and then run it.
//
// Two layers:
//   sessionEnv   the session starts without the hub's own settings and keys (everything named in the hub's .env, and
//                anything that looks like a key), so nothing it runs inherits them.
//   fenceRules   Claude Code deny rules: no reading the hub's .env or data, no .env files or credential folders
//                anywhere, no editing Claude Code's own settings, git hooks, or the scripts it may run without asking.
//                A deny rule wins over any allow rule, and a Read deny also blocks Edit and Write on that path.
//
// What this is not: an operating-system sandbox. Claude Code's rules cover its file tools and the file commands it
// recognises in a shell; a script the session is allowed to run can still open files itself. So the list of allowed
// commands stays short, the scripts on it can't be edited by the session, and the keys aren't in its environment.
// It guards against mistakes and against instructions smuggled into text a lead reads; it is not proof against a
// session that is determined to get out.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolvePath } from "./util.js";
import { hubSettings } from "../hub/settings.js";

// Names the hub's .env defines: its keys, password hash, cookie key and settings.
export function envFileNames(file) {
  try { return fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1]).filter(Boolean); } catch { return []; }
}
// Kept even when the hub's .env sets them: where the hub is, and how to find Claude Code.
const KEEP = new Set(["HUB_URL", "HUB_BILLING", "PORT", "TZ", "AGENTS_CLAUDE_BIN"]);
const SECRETISH = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|HASH|TOTP|CREDENTIAL|COOKIE|WEBHOOK|SESSION_KEY|AUTH)/i;
// Things with those words in their names that a session does need.
const NEEDED = /^(SSH_AUTH_SOCK|GIT_ASKPASS|GCM_|XAUTHORITY$|CLAUDE_CODE_|CLAUDE_CONFIG_DIR$)/;
export function sessionEnv(env, hubNames = []) {
  const drop = new Set(hubNames.filter((n) => !KEEP.has(n)));
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (drop.has(k)) continue;
    if (k === "ANTHROPIC_API_KEY" || k === "ANTHROPIC_AUTH_TOKEN") continue; // sessions run on the subscription, never the API key
    if (SECRETISH.test(k) && !NEEDED.test(k) && !KEEP.has(k)) continue;
    out[k] = v;
  }
  return out;
}
// Tools installed after the hub started aren't on its PATH: start-pipeline.cmd keeps the window's old PATH across
// restarts (2026-11-13: gh was installed that morning, and every session said "gh: command not found"). So the
// usual install folders that exist are added to a session's PATH, plus any in the hub settings' "toolPaths".
export function withToolPaths(env, extra = [], exists = fs.existsSync, sep = process.platform === "win32" ? ";" : ":") {
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") || "PATH";
  const have = String(env[key] || "").split(sep).filter(Boolean);
  const norm = (d) => d.replace(/[\\/]+$/, "").toLowerCase();
  const pf = [env.ProgramFiles, env["ProgramFiles(x86)"], "C:\\Program Files"].filter(Boolean);
  const dirs = [...pf.flatMap((b) => [`${b}\\GitHub CLI`, `${b}\\Git\\cmd`, `${b}\\nodejs`]), ...extra.map(String)];
  const add = [];
  for (const d of dirs) if (!have.some((h) => norm(h) === norm(d)) && !add.some((a) => norm(a) === norm(d)) && (() => { try { return exists(d); } catch { return false; } })()) add.push(d);
  return add.length ? { ...env, [key]: [...have, ...add].join(sep) } : env;
}
// The environment for anything the hub starts in another project: no hub keys (sessionEnv), usual tools on the PATH.
export const hubFreeEnv = () => withToolPaths(sessionEnv(process.env, envFileNames(resolvePath(".env"))), toolPaths());
function toolPaths() { try { const t = hubSettings().toolPaths; return Array.isArray(t) ? t.filter((x) => typeof x === "string") : []; } catch { return []; } }

// A path as Claude Code's rules want it: //c/folder on Windows, //folder elsewhere. null when the path has characters
// a rule can't carry (the rules go on the command line separated by commas).
export function rulePath(p) {
  let s = path.resolve(String(p)).replace(/\\/g, "/");
  const drive = /^([A-Za-z]):\//.exec(s);
  s = drive ? `//${drive[1].toLowerCase()}/${s.slice(3)}` : `/${s}`;
  s = s.replace(/\/+$/, "");
  return /[,()\s*?!\[\]]/.test(s) ? null : s;
}

// The deny rules for a session working in `folder`. hubDir: the hub's own folder. allowedScripts: project-relative
// scripts the session may run without asking (so it may not edit them).
export function fenceRules({ hubDir, folder, allowedScripts = [] }) {
  const rules = [], skipped = [];
  const hub = rulePath(hubDir), here = rulePath(folder);
  if (hub) {
    rules.push(`Read(${hub}/.env)`, `Read(${hub}/.env.*)`, `Read(${hub}/data/**)`);
    // a session working somewhere else has no business changing the hub; one working in the hub is its builder
    if (here !== hub && !(here || "").startsWith(`${hub}/`)) rules.push(`Edit(${hub}/**)`);
    else rules.push(`Edit(${hub}/tools/agent-log.mjs)`, `Edit(${hub}/tools/agent-hook.mjs)`, `Edit(${hub}/src/security.js)`, `Edit(${hub}/src/pipeline/leadfence.js)`);
  } else skipped.push(`the hub folder (${hubDir}) has characters a rule can't carry`);
  // keys and sign-ins anywhere on the PC
  rules.push(
    "Read(//**/.env)",
    "Read(//**/.env.*)",
    "Read(~/.ssh/**)",
    "Read(~/.aws/**)",
    "Read(~/.config/gh/**)",
    "Read(~/.git-credentials)",
    "Read(~/.claude/.credentials.json)",
    "Read(~/.codex/auth.json)",
    "Read(~/.gemini/**)",
    "Read(~/.copilot/**)",
  );
  // how Claude Code itself is set up (hooks and permissions live here), for the user and for the project
  rules.push("Edit(~/.claude/**)", "Edit(.claude/settings.json)", "Edit(.claude/settings.local.json)", "Edit(.claude/hooks/**)");
  // what git runs by itself on commit and push
  rules.push("Edit(.git/hooks/**)", "Edit(.git/config)", "Edit(.husky/**)");
  for (const sc of allowedScripts) { if (/[,()\s*?!\[\]]/.test(sc)) skipped.push(`script ${sc}`); else rules.push(`Edit(${sc.replace(/\\/g, "/")})`); }
  return { rules, skipped };
}

// One Claude Code session as a child process, started without the hub's keys (sessionEnv). The brief goes in on stdin,
// the last `tail` characters of stdout (and of stderr when `stderr`) are kept, and the child is killed after `timeoutMs`.
// onEnd(how, out) runs exactly once: "failed" (could not start, or non-zero exit), "time's up" (killed) or "finished".
// Returns the child (the caller needs its pid). A spawn that throws is the caller's to catch.
// With `log` (a file path), the session runs detached and writes stdout and stderr to that file instead of pipes into
// the hub, so it outlives a hub restart (agents/autonomy.js adoptSessions picks it up again); onEnd then gets "" and
// the caller reads the log. `kill(child)` replaces child.kill() at the time limit (a whole process tree on Windows).
// `env`: a few plain settings added to the session's environment (never keys), e.g. HUB_SESSION_FOLDER.
export function runClaudeSession({ bin, args, folder, brief, timeoutMs, tail, stderr = false, onEnd, log = null, kill = null, env = {} }) {
  let child;
  const childEnv = { ...hubFreeEnv(), ...env };
  if (log) {
    const fd = fs.openSync(log, "a");
    try { child = spawn(bin, args, { cwd: folder, windowsHide: true, env: childEnv, detached: true, stdio: ["pipe", fd, fd] }); }
    finally { try { fs.closeSync(fd); } catch {} }
  } else child = spawn(bin, args, { cwd: folder, windowsHide: true, env: childEnv });
  let out = "", ended = false, timedOut = false;
  const keep = (b) => (out = (out + String(b)).slice(-tail));
  const end = (how) => { if (ended) return; ended = true; clearTimeout(stop); onEnd(how, out); };
  const stop = setTimeout(() => { timedOut = true; try { kill ? kill(child) : child.kill(); } catch {} }, Math.max(0, timeoutMs));
  child.stdin.on("error", () => {});
  child.stdin.end(brief);
  if (!log) {
    child.stdout.on("data", keep);
    if (stderr) child.stderr.on("data", keep);
  }
  child.on("error", (err) => { if (log) { try { fs.appendFileSync(log, `\n${err.message}\n`); } catch {} } else out += `\n${err.message}`; end("failed"); });
  // with a log file there are no output pipes to wait for: the process ending is the end
  child.on(log ? "exit" : "close", (code, signal) => end(signal || timedOut ? "time's up" : code ? "failed" : "finished"));
  return child;
}
