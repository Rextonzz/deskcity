// Part of the agents module (src/pipeline/agents.js), split out by topic 2026-11-11: Autonomy (a PC lead works on its own for a while) and the local runner for another project's Gemini workers.
// Shared state and helpers come from agents.js, which also re-exports everything here, so callers import from there.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { readJson, resolvePath, writeJsonAtomic, every, dayIn } from "../util.js";
import { logEvent } from "../runlog.js";
import { partsWith } from "../../hub/extras.js";
import { helperMay } from "../../hub/helpers.js";
import { ownerName as OWNER, hubFolder as HUB_DIR, hubTz, isDemo, DEMO_MESSAGE } from "../../hub/settings.js";
import { runClaudeSession, fenceRules, hubFreeEnv } from "../leadfence.js";
import { grantRules, whoCan, mergeRules } from "../grants.js";
import { sessionRules } from "../workrules.js";
import { requeueAfterLimit } from "./meetings.js";
import { DIR, LOG_TOOL, addJob, appendJsonl, readJsonl, clip, findJob, hookMap, jobs, openJob, openJobs, planNow, recordEvent, roster, runJob, slug, updateJob } from "../agents.js";
import { planBlock } from "../planmeter.js";
import { sessionGate, heldError } from "./estimate.js";
import { runLimits } from "../../hub/runlimits.js";

// Finance's plan budget (planmeter.js): why a hub-started session for this project can't start now, or null.
function planStop(room) {
  try { return planBlock(planNow(), room); } catch { return null; }
}

// What a local runner's scripts read (its part's "env" list); kept even when the hub's .env sets them (sessionEnv drops
// every name in it).
const RUNNER_ENV = (runner) => Object.fromEntries((runner?.env || []).filter((k) => process.env[k] != null).map((k) => [k, process.env[k]]));

// ---------- autonomy: a PC lead works on its own for a while ----------
// the owner, 2026-11-09: "select a team lead and tell them they can work autonomous for X time with a button". For a lead
// whose project folder is mapped in hook-map.json, the hub starts a headless Claude Code session there (claude -p) with
// a brief, and stops it when the time is up. It runs on the owner's Claude subscription, and the Claude Code hook reports it
// like any session. Allowed without asking (the owner's pick, "edits + safe commands"): read and edit files, git status,
// diff, log, branch, add, commit, push, fetch, pull, gh pr create/view, the project's test scripts and agent-log.mjs.
// Making a branch or a worktree to work on (git switch, checkout -b, worktree add/list, and cd into it) added with
// the owner's OK 2026-11-09, after Tango's docs run couldn't branch. Still never merging, force pushes or worktree remove.
// Never: force pushes, hard resets, deleting branches. The project's own CLAUDE.md rules still apply.
const AUTONOMY = () => path.join(DIR(), "autonomy.json");
export const AUTO_ALLOWED = [
  "Read", "Edit", "Write", "MultiEdit", "Glob", "Grep", "LS", "TodoWrite",
  "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git branch:*)", "Bash(git switch:*)", "Bash(git checkout -b:*)", "Bash(git worktree add:*)", "Bash(git worktree list:*)", "Bash(cd:*)",
  "Bash(git add:*)", "Bash(git commit:*)", "Bash(git push:*)", "Bash(git fetch:*)", "Bash(git pull:*)",
  "Bash(gh pr create:*)", "Bash(gh pr view:*)", "Bash(gh pr list:*)",
  "Bash(tools/run_gut.sh:*)", "Bash(tools/run_smoke.sh:*)", "Bash(python3 tools/check_changelog.py:*)",
  `Bash(node ${HUB_DIR()}/tools/agent-log.mjs:*)`, "Bash(node --check:*)", "Bash(date:*)",
];
// Project scripts a session may run without asking; it may not edit them (leadfence.js).
const AUTO_SCRIPTS = ["tools/run_gut.sh", "tools/run_smoke.sh", "tools/check_changelog.py"];
// Deny rules win over allow rules: "never merge" (CLAUDE.md, another project merge rules) is stated here, not only by
// leaving merge out of the GitHub checks grant.
export const AUTO_DENIED = ["Bash(git push --force:*)", "Bash(git push -f:*)", "Bash(git push --force-with-lease:*)", "Bash(git reset --hard:*)", "Bash(git branch -D:*)", "Bash(git push origin --delete:*)", "Bash(rm:*)",
  ...["gh pr merge", "gh pr close", "gh api", "gh repo delete", "gh run delete", "gh workflow run", "gh release delete"].flatMap((c) => [`Bash(${c}:*)`, `Bash(${c} *)`])];
// Open jobs per desk, for whoCan's order.
const openJobCounts = () => openJobs().reduce((m, j) => ((m[j.desk] = (m[j.desk] || 0) + 1), m), {});
const autoKids = new Map();
// How to start Claude Code without a shell: AGENTS_CLAUDE_BIN (an .exe, or a cli.js run with Node), else the native
// installer's claude.exe, else the npm package's cli.js, else "claude" on the PATH (Linux/macOS).
function claudeCommand() {
  const set = process.env.AGENTS_CLAUDE_BIN;
  if (set) return /\.(c?js|mjs)$/i.test(set) ? [process.execPath, [set]] : [set, []];
  if (process.platform !== "win32") return ["claude", []];
  const home = process.env.USERPROFILE || "", appdata = process.env.APPDATA || "";
  const exe = path.join(home, ".local", "bin", "claude.exe");
  if (fs.existsSync(exe)) return [exe, []];
  const cli = path.join(appdata, "npm", "node_modules", "@anthropic-ai", "claude-code", "cli.js");
  if (fs.existsSync(cli)) return [process.execPath, [cli]];
  return [null, []];
}
const autonomyState = () => readJson(AUTONOMY(), {});
function saveAutonomy(s) { writeJsonAtomic(AUTONOMY(), s); }
// A mapped folder, or its sub-folder that has a CLAUDE.md; null when it has neither.
function claudeFolder(f) {
  if (fs.existsSync(path.join(f, "CLAUDE.md"))) return f;
  try { for (const sub of fs.readdirSync(f, { withFileTypes: true })) if (sub.isDirectory() && fs.existsSync(path.join(f, sub.name, "CLAUDE.md"))) return path.join(f, sub.name); } catch {}
  return null;
}
// The folder a desk works in: mapped to it in hook-map.json, preferring one with a CLAUDE.md (or a sub-folder that has one).
function deskFolder(deskId) {
  // a desk's own work folder wins (the owner 2026-11-09: Scout works in C:\the hub, which is mapped to the hub)
  const own = roster().desks.find((d) => d.id === deskId)?.workFolder;
  if (own && fs.existsSync(own)) return own;
  const mine = Object.entries(hookMap()).filter(([, v]) => v?.desk === deskId).map(([k]) => k);
  for (const f of mine) { const c = claudeFolder(f); if (c) return c; }
  return mine.find((f) => fs.existsSync(f)) || null;
}
export function autonomyStatus() {
  const s = autonomyState(), now = Date.now();
  return Object.values(s).map((a) => ({ ...a, live: a.status === "running" && autoKids.has(a.desk) && Date.parse(a.until) > now })).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, 12);
}
// How long a grant is planned for, in hours (until 8 a.m. for "untilMorning"; else 0.25 to 12).
export function plannedHours({ hours, untilMorning } = {}) {
  if (untilMorning) { const t = new Date(); t.setDate(t.getDate() + (t.getHours() >= 8 ? 1 : 0)); t.setHours(8, 0, 0, 0); return (t - Date.now()) / 3600e3; }
  return Math.max(0.25, Math.min(12, Number(hours) || 1));
}
// `approved`: the owner's own action (the button with his password, or an approved Waiting for you item). A session the
// hub starts by itself (after a board meeting) over the approval line waits for his OK (agents/estimate.js sessionGate).
// Follow-up rounds of an approved grant carry on under that same OK.
export async function grantAutonomy({ desk: deskId, hours, untilMorning, note, by, approved = false } = {}) {
  const d = roster().desks.find((x) => x.id === slug(deskId));
  if (!d) throw new Error("Pick a desk on the roster.");
  const lim = claudeLimit();
  if (lim) throw new Error(`Claude's usage limit is reached until ${new Date(lim).toLocaleTimeString("en-CA", { timeZone: hubTz(), hour: "numeric", minute: "2-digit" })}; sessions start again after that.`);
  if (autoKids.has(d.id)) throw new Error(`${d.id} is already working on its own. Stop it first to change the time.`);
  { const stop = planStop(d.room); if (stop) throw new Error(stop); }
  const folder = deskFolder(d.id);
  if (!folder) throw new Error(`${d.id} has no project folder mapped on this PC (Agents page → "Which project is this?"), so the hub can't start it.`);
  { const held = sessionGate(d, { hours: plannedHours({ hours, untilMorning }), args: { hours, untilMorning, note, by }, approve: approved }); if (held) throw heldError(held); }
  let until;
  if (untilMorning) { const t = new Date(); t.setDate(t.getDate() + (t.getHours() >= 8 ? 1 : 0)); t.setHours(8, 0, 0, 0); until = t; }
  else { const h = Math.max(0.25, Math.min(12, Number(hours) || 1)); until = new Date(Date.now() + h * 3600e3); }
  const untilText = until.toLocaleString("en-CA", { weekday: "short", hour: "numeric", minute: "2-digit" });
  const tool = LOG_TOOL();
  // The lead's own staff, so it knows who it can hand work to (the owner 2026-11-09).
  const team = roster().desks.filter((x) => x.room === d.room && x.id !== d.id && x.status !== "paused")
    .map((x) => `${x.id} (${[x.role, x.provider, x.model].filter(Boolean).join(", ")})`).join("; ");
  // the owner 2026-11-11: "they are just stopping if they had no other direction, I need them to try and work
  // independently"; and "leads on their own can build within the time and budget as long as it's their project
  // scope; if not, they can submit a build plan I can approve". So the brief says an empty queue isn't a reason to stop and gives a ladder of places to find work,
  // and the hub starts a follow-up session when one ends early (below).
  const rules = [
    "1. Read this folder's CLAUDE.md and follow it (branches and PRs, never push to main, never force-push, never merge your own PR, open PRs as drafts).",
    `2. Find your own work. Nobody will hand you a list, and an empty job queue is NOT a reason to stop. Go down this list and take the first thing that's real:`,
    `   a. Jobs waiting for you: node ${tool} jobs --desk ${d.id}`,
    '   b. The project\'s own plan: its status, backlog, board or to-do docs ("next steps", "open items", anything marked untested or not done).',
    "   c. Your unfinished work: open branches and draft PRs (gh pr list), review comments, failing checks.",
    "   d. Loose ends in the code: TODO and FIXME notes, things the docs say exist but don't, missing checks for recent changes.",
    "   e. Quality: re-read what was merged recently and look for bugs; run the project's tests or checks and fix what fails.",
    "   f. Docs that no longer match the code (status pages, change logs, set-up steps).",
    `   g. Build: you may build new things on your own when they're inside your project's scope (what its CLAUDE.md, plan and docs say the project is) and fit the time left and your budget. If it's outside that scope, or you're not sure it's in, don't build it: write a short build plan (what, why, steps, time and cost) in the project's docs on a branch, and submit it for ${OWNER()} to approve: node ${tool} ask --from ${d.id} --room ${d.room} --question "Approve build plan: <name>?" --why "<one line, and where the plan is>". Then carry on with something that is in scope.`,
    "3. Prefer finishing things over starting many, and keep each piece small enough to finish and put in a draft PR. Keep spending to what your project allows.",
    `3b. When a piece is done, check the clock (run: date) and start the next one from the list. Keep going until 15 minutes before ${untilText}. Finishing one task, or finding the queue empty, is not the end of the session. Only stop early if you have gone through the whole list and written down, item by item, why nothing on it can be done.`,
    `4. Use your team; you're the lead, so don't do it all yourself. Hand a step to a teammate with: node ${tool} handoff --desk ${d.id} --to <desk> --text "..."  (research and fact checks suit the Gemini desks; node ${tool} desks lists everyone, other rooms too). Your team: ${team || "nobody yet"}.`,
    `4a. Small errands (a look-up, a summary of a doc or PR, a draft, a fact check) go to the shared assistant, not on your own time: node ${tool} handoff --desk ${d.id} --to assistant --text "..."  (the hub runs it and the answer comes back on the job). Skip this if "assistant" isn't in the desks list.`,
    `4b. Missing something you need (a helper, a tool, access, budget)? Contact HR instead of going without or setting it up yourself: node ${tool} request --from ${d.id} --room ${d.room} --role "<what you need>" --why "<what it's blocking>" --provider claude --model haiku --effort low --budget <USD/month>. For a yes or no from ${OWNER()}: node ${tool} ask --from ${d.id} --room ${d.room} --question "..." --why "...". Then carry on with something else while you wait; a blocked item is never a reason to stop the session.`,
    `5. Stop starting new work 15 minutes before ${untilText}. Finish with a short report as your final message: what you did, PRs and branches, what's next, anything blocked. Also log it: node ${tool} event --desk ${d.id} --room ${d.room} --action "autonomy report" --summary "<one line>"`,
    `HUB RULE: this work belongs to ${d.room} in ${OWNER()}'s hub (${HUB_DIR()}). Log what you do. If you hand this on, include this rule.`,
  ].join("\n");
  const brief = `${OWNER()} has given you, ${d.id} (${d.role || "project lead"}), time to work on your own until ${untilText}. Nobody is watching this session, so don't ask questions: decide, note your reasoning, and move on.\n${rules}${note ? `\n\n${note}` : ""}`;
  // No clock time in the job's own text (2026-11-13): a retried job is a copy, and "until Fri 12:02 p.m." stayed on the
  // campus card at 7 p.m. The session's brief and the card's status line carry the real end time.
  const span = untilMorning ? "until 8 a.m." : (() => { const h = (until - Date.now()) / 3600e3; return h <= 1.05 ? "for an hour" : `for ${Math.round(h * 2) / 2} hours`; })();
  const job = await addJob({ desk: d.id, text: `Work on your own ${span} (${by || `autonomy session started by ${OWNER()}`}).` });
  // A session that ends on its own with time to spare gets a follow-up session: it's told what the last one reported
  // and to pick the next thing. Up to 8 rounds; none if under 20 minutes are left, or a round ended inside 2 minutes
  // twice in a row (nothing it can do, or something is broken: don't spin).
  let rounds = 1, quick = 0;
  const again = (report, ranMs) => {
    quick = ranMs < 2 * 60000 ? quick + 1 : 0;
    // Claude's usage limit is on (this session or another desk hit it): no round now, it would hit the limit at once
    if (claudeLimit()) return false;
    // Finance's plan budget: the project's share of the week (or the hub's stop line) is used up
    { const stop = planStop(d.room); if (stop) { recordEvent({ desk: d.id, room: d.room, action: "autonomy report", summary: clip(`Stopped early: ${stop}`, 300), provider: d.provider }, "autonomy"); return false; } }
    if (rounds >= 8 || quick >= 2 || until - Date.now() < 20 * 60000) return false;
    rounds++;
    const next = `${OWNER()} gave you, ${d.id} (${d.role || "project lead"}), time to work on your own until ${untilText}, and there is still time left. Your last session in this folder ended early with this report:\n\n${clip(report, 3000) || "(no report)"}\n\nThis is round ${rounds}. Don't repeat that work and don't stop because one task is done: pick the next thing from the list in step 2 and carry on. Nobody is watching, so don't ask questions: decide, note your reasoning, and move on.\n${rules}${note ? `\n\n${note}` : ""}`;
    try { startClaudeSession({ d, folder, brief: next, job, until, untilText, label: `On its own until ${untilText} (round ${rounds})`, again, by }); return true; } catch { return false; }
  };
  return startClaudeSession({ d, folder, brief, job, until, untilText, label: `On its own until ${untilText}`, again, by });
}
// Start headless Claude Code for a desk in a project folder (autonomy, or a single pushed job): the owner's subscription,
// the safe tool list, stopped at `until`; the job closes with the session's last lines as its result.
function startClaudeSession({ d, folder, brief, job, until, untilText, label, again, by = null }) {
  const began = Date.now();
  const [bin, pre] = claudeCommand();
  if (!bin) throw new Error("Claude Code wasn't found on this PC. Set AGENTS_CLAUDE_BIN in .env to claude.exe (or the claude-code cli.js).");
  // The brief goes in on stdin, so no shell quoting is involved.
  // Kept away from the hub's keys and from the files that would let it run anything (leadfence.js; audit 2026-11-11).
  const fence = fenceRules({ hubDir: resolvePath("."), folder, allowedScripts: AUTO_SCRIPTS });
  if (fence.skipped.length) console.warn(`Lead session for ${d.id}: some protections couldn't be applied: ${fence.skipped.join("; ")}`);
  // What this worker has been given on top of the standard list (grants.js): running its own code, Godot, and so on.
  const given = grantRules(d);
  if (given.notes.length)
    brief = `${brief}\n\nAccess ${OWNER()} has given you for this project:\n${given.notes.map((n) => `- ${n}`).join("\n")}\nAnything else you need that gets refused: ask ${OWNER()} for it by name (the exact command or tool) instead of working around it.`;
  // A step it can't do goes to a worker who can, on the record, instead of being dropped or worked around.
  {
    const can = whoCan(roster().desks, d.id, { room: d.room, waiting: openJobCounts() }), tool = LOG_TOOL();
    brief = `${brief}\n\nWhen a step needs a command or tool you don't have (it gets refused, or it isn't on your list): don't work around it and don't quietly skip it. Hand that step to a worker who has it: node ${tool} handoff --desk ${d.id} --to <desk> --text "<the step, and where the files are>". ${can.length ? `Workers with extra access right now:\n${can.map((l) => `- ${l}`).join("\n")}` : "Nobody else has extra access right now."}\nIf none of them fits, ask ${OWNER()} for it by name: node ${tool} ask --from ${d.id} --room ${d.room} --question "..." --why "...". Either way, say in your report what you couldn't do, who you passed it to, and what is still waiting.`;
  }
  // Who can't open files, and where times come from (the owner 2026-11-11: raid-logs-qa got paths it couldn't read;
  // Pesto wrote "last updated 19:20" at 19:04).
  {
    const hubRun = roster().desks.filter((x) => x.runner === "hub" && x.status === "active" && x.id !== d.id).map((x) => x.id);
    brief = `${brief}\n\n${sessionRules({ tool: LOG_TOOL(), desk: d.id, room: d.room })}\n\nWorkers the hub runs${hubRun.length ? ` (${hubRun.join(", ")})` : ""} can't open files on this PC. When you hand one of them work, name the files in the hand-off text: small text files are sent along with it; big ones (over 60 KB, like raw logs) are not, so give those steps to a worker on the PC or cut the file down first.\nTake every date and time from the clock (run: date). Never estimate or guess a time in a file, a report or a status line.`;
  }
  // A merge grant opens exactly "gh pr merge <N> --merge"; every other merge form stays denied (grants.js mergeRules).
  const rules = mergeRules(given.allow, [...AUTO_DENIED, ...given.deny]);
  const args = [...pre, "-p", "--permission-mode", "acceptEdits", "--allowedTools", [...AUTO_ALLOWED, ...rules.allow].join(","), "--disallowedTools", [...rules.denied, ...fence.rules].join(","), "--output-format", "text"];
  // Sessions run on the owner's Claude subscription (2026-11-09), never the API budget, and start without the hub's own
  // keys and settings (runClaudeSession, leadfence.js).
  // Survives a hub restart (the owner 2026-11-11: Pesto's session died with the 19:05 restart after two minutes). The
  // session runs detached and writes to its own log file instead of pipes into the hub, so the hub exiting doesn't cut
  // it off; when the hub comes back, adoptSessions() picks it up again by its process id and log.
  fs.mkdirSync(SESSIONS(), { recursive: true });
  const log = path.join(SESSIONS(), `${d.id}-${Date.now()}.log`);
  // Declared before the session starts, and called a tick later: a session that ends at once (it could not start)
  // used to reach finish before it existed and crash the hub (2026-11-16 13:36 UTC).
  const finish = (how) => {
    autoKids.delete(d.id);
    const report = logTail(log);
    // ended on its own with time left: carry on in a follow-up session (the job stays open). Not when it stopped on
    // Claude's usage limit, or the hub-wide pause is on: closeSession pauses it instead.
    if (how === "finished" && again && !limitReset(report) && !claudeLimit() && again(report, Date.now() - began)) {
      recordEvent({ desk: d.id, room: d.room, action: "autonomy report", summary: clip(`Round done, carrying on: ${report.split("\n").slice(-1)[0] || ""}`, 300), provider: d.provider }, "autonomy");
      return;
    }
    closeSession(d.id, how, report);
  };
  const child = runClaudeSession({ bin, args, folder, brief, env: { HUB_SESSION_FOLDER: folder }, timeoutMs: until - Date.now(), log, kill: (c) => killTree(c.pid, () => c.kill()), onEnd: (how) => setImmediate(() => finish(how)) });
  const entry = { desk: d.id, room: d.room, folder, until: until.toISOString(), startedAt: new Date().toISOString(), status: "running", jobId: job.id, pid: child.pid, log, ...(by ? { by } : {}) };
  const s = autonomyState(); s[d.id] = entry; saveAutonomy(s);
  autoKids.set(d.id, { kill: () => killTree(child.pid, () => child.kill()) });
  updateJob(job.id, { status: "taken", summary: `Working on it in ${folder}` }, "hub");
  recordEvent({ desk: d.id, room: d.room, action: "session start", summary: label, provider: d.provider }, "autonomy");
  logEvent("agent autonomy", { desk: d.id, room: d.room, until: entry.until });
  return entry;
}
const SESSIONS = () => path.join(DIR(), "sessions");
// The last lines a session wrote: its report.
function logTail(file, lines = 40) {
  if (!file) return "";
  try {
    const st = fs.statSync(file), len = Math.min(st.size, 20000), buf = Buffer.alloc(len), fd = fs.openSync(file, "r");
    try { fs.readSync(fd, buf, 0, len, st.size - len); } finally { fs.closeSync(fd); }
    return buf.toString("utf8").trim().split(/\r?\n/).filter(Boolean).slice(-lines).join("\n");
  } catch { return ""; }
}
// Claude Code's message when the subscription's usage window is used up, e.g. "You've hit your 5-hour limit · resets
// 10am (America/the owner's town)", or the older "Claude AI usage limit reached|1763049600" (when it resets, in epoch seconds).
// Only those lines count, and only as one of the last two lines (where Claude Code prints it as it stops): a report
// that mentions a limit ("when the limit reached zero the loop hung") is not a limit. Returns when it resets (the
// epoch time, or the local time given, tomorrow if that time has passed), an hour from now when no time is given, or
// null when the text isn't the limit.
const LIMIT_LINE = /^\W{0,4}(?:(?:you'?ve|you’ve|you have) hit your\b.{0,40}\blimit\b|claude(?: ai)? usage limit reached\b)/i;
export function limitReset(text, now = new Date()) {
  const last = String(text || "").trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-2);
  const line = last.find((l) => l.length <= 200 && LIMIT_LINE.test(l));
  if (!line) return null;
  const epoch = /usage limit reached\s*\|\s*(\d{9,13})\b/i.exec(line);
  if (epoch) {
    const n = Number(epoch[1]), at = n < 1e12 ? n * 1000 : n;
    return new Date(Math.max(at, now.getTime()) + 60000).toISOString(); // a minute's grace
  }
  const m = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(line);
  if (!m) return new Date(now.getTime() + 3600e3).toISOString();
  let h = Number(m[1]) % 12;
  if ((m[3] || "").toLowerCase() === "pm") h += 12;
  if (!m[3] && Number(m[1]) >= 13) h = Number(m[1]);
  const r = new Date(now); r.setHours(h, Number(m[2] || 0), 0, 0);
  if (r <= now) r.setDate(r.getDate() + 1);
  return new Date(r.getTime() + 60000).toISOString(); // a minute's grace
}
// The hub-wide pause: no new Claude Code session starts before the limit resets.
const LIMIT = () => path.join(DIR(), "claude-limit.json");
export function claudeLimit(now = Date.now()) {
  try { const l = JSON.parse(fs.readFileSync(LIMIT(), "utf8")); return Date.parse(l.until) > now ? l.until : null; } catch { return null; }
}
function setClaudeLimit(until, desk) {
  try { fs.mkdirSync(DIR(), { recursive: true }); fs.writeFileSync(LIMIT(), JSON.stringify({ until, desk, at: new Date().toISOString() })); } catch {}
}
// A session is over: record how it ended and close its job with its report.
function closeSession(deskId, how, report) {
  const st = autonomyState(), entry = st[deskId];
  if (!entry || entry.status !== "running") return;
  // Claude's usage limit (the owner's subscription) stopped it: not a failure of the work. Wait for the reset and start
  // it again (2026-11-13: every lead started after the 9:00 board meeting failed with "hit your 5-hour limit").
  const reset = limitReset(report);
  if (reset) {
    setClaudeLimit(reset, deskId);
    const at = new Date(reset).toLocaleTimeString("en-CA", { timeZone: hubTz(), hour: "numeric", minute: "2-digit" });
    st[deskId] = { ...entry, status: "waiting for the limit", endedAt: new Date().toISOString(), last: `Claude's usage limit was reached; it resets at ${at}.` };
    saveAutonomy(st);
    recordEvent({ desk: deskId, room: entry.room, action: "session end", summary: `Paused: Claude's usage limit, resets ${at}` }, "autonomy");
    const again = /board meeting/.test(entry.by || "") ? requeueAfterLimit(deskId, reset) : false;
    try {
      const cur = jobs().find((x) => x.id === entry.jobId);
      if (cur && openJob(cur)) updateJob(entry.jobId, { status: "cancelled", summary: `Paused: Claude's usage limit was reached (resets ${at}). ${again ? "The hub starts it again after the reset; its hours weren't used." : "Push it again after the reset."}` }, "hub");
    } catch {}
    return;
  }
  const note = how === "cut off" ? "Cut off: the session stopped while the hub was restarting." : null;
  st[deskId] = { ...entry, status: how, endedAt: new Date().toISOString(), last: clip(note || report.split("\n").slice(-1)[0] || how, 300) };
  saveAutonomy(st);
  recordEvent({ desk: deskId, room: entry.room, action: "session end", summary: clip(how === "cut off" ? note : `Session ${how}`, 200) }, "autonomy");
  try {
    const cur = jobs().find((x) => x.id === entry.jobId);
    if (cur && openJob(cur))
      updateJob(entry.jobId, {
        status: how === "finished" || how === "time's up" ? "done" : "failed",
        summary: clip(how === "cut off" ? `${note} Last lines: ${report.split("\n").slice(-1)[0] || "(none)"}` : report.split("\n").slice(-1)[0] || `Session ${how}`, 400),
        result: report ? `## Session (${how})\n\n${report}` : undefined,
      }, "hub");
  } catch {}
}
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (err) { return err.code === "EPERM"; } };
// When a process started and what it runs: { start (ms), cmd }, either may be null; null when it can't be read.
function procInfo(pid) {
  const id = Number(pid);
  if (!Number.isInteger(id) || id <= 0) return null;
  try {
    if (process.platform === "linux") {
      const stat = fs.readFileSync(`/proc/${id}/stat`, "utf8");
      const ticks = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]); // field 22: start, in 1/100 s after boot
      const btime = Number(/^btime (\d+)/m.exec(fs.readFileSync("/proc/stat", "utf8"))?.[1]);
      let cmd = null; try { cmd = fs.readFileSync(`/proc/${id}/cmdline`, "utf8").replace(/\0/g, " ").trim(); } catch {}
      return { start: Number.isFinite(ticks) && btime ? btime * 1000 + ticks * 10 : null, cmd };
    }
    if (process.platform === "win32") {
      const ps = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${id}"; if ($p) { [pscustomobject]@{ start = $p.CreationDate.ToUniversalTime().ToString('o'); cmd = $p.CommandLine } | ConvertTo-Json -Compress }`;
      const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, encoding: "utf8", timeout: 15000 });
      const o = JSON.parse(String(r.stdout || "").trim() || "null");
      return o ? { start: Date.parse(o.start) || null, cmd: o.cmd || null } : null;
    }
    const r = spawnSync("ps", ["-o", "lstart=", "-o", "command=", "-p", String(id)], { encoding: "utf8", timeout: 10000 });
    const m = /^\s*(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/.exec(String(r.stdout || "").trim());
    return m ? { start: Date.parse(m[1]) || null, cmd: m[2] } : null;
  } catch { return null; }
}
// Is the process with this pid still the session the hub started? After a reboot or a crash the pid can belong to
// something else by now, and stopping it at the session's time would kill that (taskkill /T, its whole tree). So it
// must have started no later than the session did, and run Claude Code; if neither can be checked, it isn't adopted.
function sameSession(e) {
  const info = procInfo(e.pid);
  if (!info || (info.start == null && !info.cmd)) return false;
  const began = Date.parse(e.startedAt);
  if (info.start != null && Number.isFinite(began) && info.start > began + 2000) return false;
  if (info.cmd) {
    const [bin, pre] = claudeCommand();
    const names = [bin, ...pre].filter(Boolean).map((x) => path.basename(x).toLowerCase()).filter((x) => !/^node(\.exe)?$/.test(x));
    const cmd = info.cmd.toLowerCase();
    if (!cmd.includes("claude") && !names.some((n) => cmd.includes(n))) return false;
  }
  return true;
}
// Stop a session and whatever it started (Windows: taskkill /T, so tools it ran don't linger).
function killTree(pid, fallback) {
  if (process.platform === "win32" && pid) { const r = spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }); if (r.status === 0) return; }
  try { fallback ? fallback() : process.kill(pid); } catch {}
}
// After a hub restart: sessions still running are watched again (stopped at their time, closed when they end);
// sessions that ended while the hub was down are closed with their log; ones with no process and no log were cut off.
// A follow-up round can't start for a picked-up session (the hub lost its plan when it restarted).
export function adoptSessions() {
  const st = autonomyState(), watching = [];
  for (const e of Object.values(st)) {
    if (e.status !== "running" || autoKids.has(e.desk)) continue;
    if (alive(e.pid) && e.log && sameSession(e)) {
      autoKids.set(e.desk, { pid: e.pid, adopted: true, kill: () => killTree(e.pid) });
      watching.push(e.desk);
      recordEvent({ desk: e.desk, room: e.room, action: "note", summary: "The hub restarted; this session kept going and is watched again." }, "autonomy");
    } else {
      // gone, or its pid now belongs to another process (after a reboot): a report in its log means it finished
      const report = logTail(e.log);
      closeSession(e.desk, report ? "finished" : "cut off", report);
    }
  }
  every("Session watch", () => {
    const now = Date.now(), cur = autonomyState();
    for (const [id, k] of autoKids) {
      if (!k.adopted) continue;
      const e = cur[id];
      if (!e || e.status !== "running") { autoKids.delete(id); continue; }
      if (!alive(k.pid)) { autoKids.delete(id); closeSession(id, Date.parse(e.until) <= now ? "time's up" : "finished", logTail(e.log)); }
      // time's up: stop it, unless the pid has gone to another process since (then the session already ended)
      else if (Date.parse(e.until) <= now) { if (sameSession(e)) k.kill(); else { autoKids.delete(id); closeSession(id, "time's up", logTail(e.log)); } }
    }
  }, Number(process.env.AGENTS_ADOPT_MS) || 20000, { unref: true });
  return watching;
}
// Push one queued job (the owner 2026-11-09: "I have 3 jobs waiting, how can I push them in the campus"): the hub runs it
// for a hub-run desk; for a desk whose project has a folder on this PC, a Claude Code session does just that job (up to
// an hour); for a chat-based desk, the campus gets the job text and chat link to paste it in.
export async function pushJob(id) {
  if (isDemo()) throw new Error(DEMO_MESSAGE); // demo mode: nothing runs (tools/demo.mjs)
  const j = findJob(id);
  if (j.status !== "queued") throw new Error(`That job is already ${j.status}.`);
  const d = roster().desks.find((x) => x.id === j.desk);
  if (!d) throw new Error("That desk is no longer on the roster.");
  if (d.runner === "hub") return { how: "ran", ...(await runJob(id, { approve: true })) }; // Push is the owner's own action
  const folder = deskFolder(d.id) || roomFolder(d.room);
  if (!folder) return { how: "chat", chatUrl: d.chatUrl || null, text: j.text, desk: d.id };
  if (autoKids.has(d.id)) throw new Error(`${d.id} is already in a session. It picks this job up there, or wait for it to finish.`);
  const tool = LOG_TOOL();
  const until = new Date(Date.now() + 3600e3), untilText = until.toLocaleString("en-CA", { hour: "numeric", minute: "2-digit" });
  const brief = [
    `You are ${d.id} (${d.role || "staff"}) in ${OWNER()}'s ${d.room} project. ${OWNER()} pushed one job to you; do just this job, then stop. Nobody is watching, so don't ask questions: decide and note your reasoning.`,
    "Read this folder's CLAUDE.md first and follow it (branches and PRs, never push to main, never force-push, never merge, PRs as drafts).",
    `The job (id ${j.id}):\n${String(j.text)}`, // addJob already bounds a job's text (a hand-off by CHAIN_JOB_MAX); never cut it again here
    // the owner 2026-11-11: "any reason night agent isn't requesting resources?" The one-job brief never said it could.
    `You're not on your own. Hand a step to a teammate or the shared assistant when that's quicker than doing it yourself (node ${tool} desks lists everyone; node ${tool} handoff --desk ${d.id} --to <desk> --text "..."); what they finish comes back to you: node ${tool} inbox --desk ${d.id}. If the job needs something you don't have, ask for it instead of working around it or quietly leaving it out: a standing helper (an artist, a tester) through HR: node ${tool} request --from ${d.id} --room ${d.room} --role "<role>" --why "<what it's blocking>" --provider claude --model haiku --effort low --budget <USD/month>; a tool, an install, access, money or a command you were refused, from ${OWNER()}: node ${tool} ask --from ${d.id} --room ${d.room} --question "..." --why "<the exact thing you need and what it would let you do>". Then carry on with what you can do.`,
    `When it's done: node ${tool} done --job ${j.id} --summary "<one line>" --result-file <a file with your result>. If someone else should do the next step: node ${tool} handoff --desk ${d.id} --job ${j.id} --to <desk> --text "...". Stop by ${untilText}.`,
    `HUB RULE: this work belongs to ${d.room} in ${OWNER()}'s hub (${HUB_DIR()}). Log what you do. If you hand this on, include this rule.`,
  ].join("\n\n");
  const lim = claudeLimit();
  if (lim) throw new Error(`Claude's usage limit is reached until ${new Date(lim).toLocaleTimeString("en-CA", { timeZone: hubTz(), hour: "numeric", minute: "2-digit" })}; push it again after that.`);
  { const stop = planStop(d.room); if (stop) throw new Error(stop); }
  return { how: "session", ...startClaudeSession({ d, folder, brief, job: j, until, untilText, label: `Pushed by ${OWNER()}: ${String(j.text).split("\n")[0].slice(0, 120)}` }) };
}
// ---------- auto-push (the owner 2026-11-20, option 1) ----------
// When agents.autoPush is on (Admin, password to turn on; hub/runlimits.js), the Board timer starts queued jobs for
// workers on this PC as if Push were tapped: oldest first, at most atOnce hub-started sessions running and perDay
// auto-pushes in the hub's day. It skips a job whenever Push would refuse (Claude's usage limit, the project over its
// plan share, the worker already in a session, no folder) and, unlike Push (the owner's own OK), a session estimated
// over the approval line, which waits in Waiting for you instead. Hub-run desks aren't here: they auto-run (agents.js).
const AUTOPUSH_LOG = () => path.join(DIR(), "autopush.jsonl");
export function autoPushesToday(now = new Date()) {
  const today = dayIn(hubTz(), now);
  return readJsonl(AUTOPUSH_LOG()).filter((x) => dayIn(hubTz(), new Date(x.at)) === today).length;
}
export async function autoPushTick(now = new Date(), { push = pushJob } = {}) {
  const set = runLimits().autoPush, out = [];
  if (!set.on || isDemo() || claudeLimit()) return out;
  let room = set.atOnce - Object.values(autonomyState()).filter((a) => a.status === "running").length;
  let left = set.perDay - autoPushesToday(now);
  if (room <= 0 || left <= 0) return out;
  const r = roster();
  const queued = jobs().filter((j) => j.status === "queued").sort((a, b) => String(a.at).localeCompare(String(b.at)));
  for (const j of queued) {
    if (room <= 0 || left <= 0) break;
    const d = r.desks.find((x) => x.id === j.desk);
    if (!d || d.status !== "active" || d.paused || d.runner === "hub" || d.provider === "local") continue;
    if (!(deskFolder(d.id) || roomFolder(d.room)) || autoKids.has(d.id) || planStop(d.room)) continue;
    if (sessionGate(d, { hours: 1, args: { hours: 1, note: `auto-push of job ${j.id}`, by: "auto-push" } })) continue; // over the line: waits for the owner
    try {
      const res = await push(j.id);
      if (res?.how !== "session") continue;
      appendJsonl(AUTOPUSH_LOG(), { at: now.toISOString(), job: j.id, desk: d.id });
      recordEvent({ desk: d.id, room: d.room, action: "auto-pushed", summary: clip(`started a session for job ${j.id} by itself (auto-push): ${String(j.text).split("\n")[0]}`, 200), job: j.id }, "hub");
      out.push(j.id); room--; left--;
    } catch (err) { console.warn(`Auto-push ${j.id}: ${err.message}`); }
  }
  return out;
}
function roomFolder(room) {
  for (const [f, v] of Object.entries(hookMap())) if (v?.room === room && fs.existsSync(f)) return claudeFolder(f) || f;
  return null;
}
export function stopAutonomy(deskId) {
  const c = autoKids.get(slug(deskId));
  if (!c) throw new Error("That desk isn't working on its own right now.");
  c.kill();
  return { ok: true };
}

// ---------- local runner: workers a script runs on this PC ----------
// A private part (src/hub/extras.js) can bring a local runner: { prefix, dir(), script, missing(script) }. Every 15
// minutes, if a desk whose id starts with the prefix is set to "Runs in an app on this PC" and has a queued job, the hub
// runs the script (Git Bash) in dir() with the waiting workers' names (the desk ids after the prefix); the script runs
// each job and hands the reply back as the job's result. One run at a time, 40 minute limit. AGENTS_LOCAL_RUNNER=off
// turns it off; AGENTS_BASH points at bash if Git isn't in the usual place.
const LOCAL_MS = 15 * 60000;
let localChild = null;
let localState = { running: false, lastCheckAt: null, lastRunAt: null, result: null, error: null };
function bashPath() {
  if (process.env.AGENTS_BASH) return process.env.AGENTS_BASH;
  if (process.platform !== "win32") return "bash";
  for (const p of ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"]) if (fs.existsSync(p)) return p;
  return null;
}
export const localRunnerStatus = () => ({ ...localState, every: "15 min", on: process.env.AGENTS_LOCAL_RUNNER !== "off" });
export function runLocalJobs({ trigger = "schedule" } = {}) {
  if (localState.running) return localRunnerStatus();
  // The timer starting a script that calls a model is an AI helper; the owner's "run now" button is not.
  if (trigger === "schedule" && !helperMay("local runner").ok) return localRunnerStatus();
  const now = new Date().toISOString();
  const runner = partsWith("localRunner")[0]?.localRunner;
  localState = { ...localState, lastCheckAt: now };
  if (!runner) return { ...localRunnerStatus(), result: localState.result || "No local runner on this hub" };
  const pre = runner.prefix;
  const workers = roster().desks.filter((d) => d.runner === "local" && d.status === "active" && d.id.startsWith(pre) && /^[a-z]+$/.test(d.id.slice(pre.length))).map((d) => d.id.slice(pre.length));
  const waiting = [...new Set(openJobs().filter((j) => j.status === "queued" && j.desk.startsWith(pre) && workers.includes(j.desk.slice(pre.length))).map((j) => j.desk.slice(pre.length)))];
  if (!waiting.length) return { ...localRunnerStatus(), result: localState.result || "No Gemini jobs waiting" };
  const script = path.join(runner.dir(), ...runner.script.split("/"));
  const bash = bashPath();
  if (!fs.existsSync(script)) { localState.error = runner.missing ? runner.missing(script) : `${script} isn't on this PC.`; return localRunnerStatus(); }
  if (!bash) { localState.error = "Git Bash wasn't found. Install Git for Windows or set AGENTS_BASH in .env."; return localRunnerStatus(); }
  localState = { ...localState, running: true, lastRunAt: now, error: null, result: `Running ${waiting.join(", ")}` };
  logEvent("agent local run", { trigger, workers: waiting.join(",") });
  let out = "";
  // Forward slashes: Git Bash takes D:/x/y.sh, and the script finds run_worker.sh next to itself with dirname.
  localChild = spawn(bash, [script.replace(/\\/g, "/"), ...waiting], { cwd: runner.dir(), windowsHide: true, env: { ...hubFreeEnv(), ...RUNNER_ENV(runner) } });
  const kill = setTimeout(() => localChild?.kill(), 40 * 60000);
  const add = (d) => (out = (out + String(d)).slice(-4000));
  localChild.stdout.on("data", add);
  localChild.stderr.on("data", add);
  localChild.on("error", (err) => { clearTimeout(kill); localState = { ...localState, running: false, error: String(err.message).slice(0, 200) }; localChild = null; });
  localChild.on("close", (code) => {
    clearTimeout(kill);
    const last = out.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" · ");
    localState = { ...localState, running: false, result: clip(last || `finished (exit ${code})`, 300), error: code ? `exit ${code}` : null };
    localChild = null;
  });
  return localRunnerStatus();
}

export { LOCAL_MS, autoKids, claudeCommand, deskFolder };
