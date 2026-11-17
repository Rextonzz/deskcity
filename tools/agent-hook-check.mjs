#!/usr/bin/env node
// One command to check the Claude Code hook end to end (docs/agent-onboarding.md):
//   node tools/agent-hook-check.mjs            check only, changes nothing
//   node tools/agent-hook-check.mjs --fix      also adds any missing hook lines to ~/.claude/settings.json
//                                                               (keeps a backup next to it first)
//   ... --folder D:\projects\my-game                   which folder to test the room mapping for
// Steps: 1 hooks in Claude Code settings, 2 key file, 3 hub answers with that key, 4 folder -> room and desk,
// 5 runs the real hook once with a test SessionStart and checks it reported.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, HUB_URL as HUB, hubToken, matchFolder } from "./hub-env.mjs";

const AGENTS = path.join(ROOT, "data", "agents");
const HOOK = path.join(ROOT, "tools", "agent-hook.mjs");
const args = process.argv.slice(2);
const FIX = args.includes("--fix");
const folderArg = args.indexOf("--folder");
const FOLDER = folderArg >= 0 && args[folderArg + 1] ? args[folderArg + 1] : ROOT;
const COMMAND = `node "${HOOK.replace(/\\/g, "/")}"`;
const EVENTS = ["SessionStart", "PostToolUse", "Stop", "SubagentStop"];

let bad = 0;
const ok = (msg) => console.log(`  OK    ${msg}`);
const no = (msg, fix) => {
  bad++;
  console.log(`  FAIL  ${msg}${fix ? `\n        -> ${fix}` : ""}`);
};

// 1. Hooks in Claude Code's user settings (project settings are listed too, since a hook there also counts).
console.log("1. Claude Code hook settings");
const userSettings = path.join(os.homedir(), ".claude", "settings.json");
const places = [userSettings, path.join(FOLDER, ".claude", "settings.json"), path.join(FOLDER, ".claude", "settings.local.json")];
const has = Object.fromEntries(EVENTS.map((e) => [e, null]));
let userJson = null;
for (const f of places) {
  if (!fs.existsSync(f)) continue;
  let j;
  try {
    j = JSON.parse(fs.readFileSync(f, "utf8"));
  } catch (err) {
    no(`${f} isn't valid JSON (${err.message})`, "fix the file by hand; Claude Code ignores all of it while it's broken");
    continue;
  }
  if (f === userSettings) userJson = j;
  for (const e of EVENTS)
    for (const group of j.hooks?.[e] || []) for (const h of group.hooks || []) if (String(h.command || "").includes("agent-hook.mjs")) has[e] ||= f;
}
if (!fs.existsSync(userSettings)) console.log(`        (no ${userSettings} yet)`);
const missing = EVENTS.filter((e) => !has[e]);
for (const e of EVENTS) if (has[e]) ok(`${e} hook found in ${has[e]}`);
if (missing.length && FIX) {
  const j = userJson || {};
  if (fs.existsSync(userSettings)) {
    const backup = `${userSettings}.before-hub-${new Date().toISOString().slice(0, 10)}.bak`;
    fs.copyFileSync(userSettings, backup);
    console.log(`        backup: ${backup}`);
  }
  j.hooks ||= {};
  for (const e of missing) (j.hooks[e] ||= []).push({ ...(e === "PostToolUse" ? { matcher: "*" } : {}), hooks: [{ type: "command", command: COMMAND, timeout: 5 }] });
  fs.mkdirSync(path.dirname(userSettings), { recursive: true });
  fs.writeFileSync(userSettings, JSON.stringify(j, null, 2) + "\n");
  ok(`added ${missing.join(", ")} to ${userSettings}. Start a NEW Claude Code session (or open /hooks) so it loads them.`);
} else if (missing.length) {
  no(`missing: ${missing.join(", ")}`, `run this again with --fix, or add to ${userSettings} under "hooks", e.g.\n          "${missing[0]}": [{ ${missing[0] === "PostToolUse" ? '"matcher": "*", ' : ""}"hooks": [{ "type": "command", "command": ${JSON.stringify(COMMAND)} }] }]`);
}

// 2. Key file.
console.log("2. Agent key");
let token = "";
try {
  token = hubToken();
  token ? ok("data/agents/token.txt is there") : no("data/agents/token.txt is empty", "restart the hub; it makes a new key at start");
} catch {
  no("data/agents/token.txt is missing", "restart the hub; it makes the key at start");
}

// 3. Hub answers, and takes the key. Reading an inbox changes nothing.
console.log(`3. Hub at ${HUB}`);
try {
  const res = await fetch(`${HUB}/api/agents/ingest/inbox`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ desk: "hub-builder", limit: 1 }), signal: AbortSignal.timeout(5000) });
  if (res.ok) ok("the hub answered and accepted the key");
  else if (res.status === 401) no("the hub refused the key", "restart the hub so it reads data/agents/token.txt again");
  else if (res.status === 404) no("the hub doesn't know the agent routes yet", "restart the hub from Admin so it loads the new code");
  else no(`the hub answered ${res.status}`);
} catch (err) {
  no(`couldn't reach the hub (${err.cause?.code || err.message})`, "start the hub, then run this again");
}

// 4. Which room the folder lands in (same rule as the hook: longest matching folder wins).
console.log(`4. Room for ${FOLDER}`);
try {
  const map = JSON.parse(fs.readFileSync(path.join(AGENTS, "hook-map.json"), "utf8"));
  const hit = matchFolder(map, FOLDER);
  hit ? ok(`room ${map[hit].room}, desk ${map[hit].desk || `${map[hit].room}-claude-code`} (from "${hit}")`) : no("this folder isn't in data/agents/hook-map.json, so its sessions go to room \"unassigned\"", "add the folder to hook-map.json");
} catch (err) {
  no(`data/agents/hook-map.json can't be read (${err.message})`);
}

// 5. Run the real hook once, the way Claude Code would.
console.log("5. Test run of the hook");
const lastOk = path.join(AGENTS, "hook-last-ok.txt");
const errLog = path.join(AGENTS, "hook-errors.log");
const before = fs.existsSync(lastOk) ? fs.statSync(lastOk).mtimeMs : 0;
const errBefore = fs.existsSync(errLog) ? fs.readFileSync(errLog, "utf8").split("\n").filter(Boolean).length : 0;
const run = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: "SessionStart", cwd: FOLDER }), timeout: 6000 });
const after = fs.existsSync(lastOk) ? fs.statSync(lastOk).mtimeMs : 0;
if (after > before) ok(`the hook reported (exit ${run.status}). It shows on the Agents page as "Claude Code session in ${path.basename(FOLDER)}".`);
else {
  const errs = fs.existsSync(errLog) ? fs.readFileSync(errLog, "utf8").split("\n").filter(Boolean) : [];
  no(`the hook didn't report${errs.length > errBefore ? `: ${errs.at(-1)}` : ""}`, "see data/agents/hook-errors.log");
}

console.log(bad ? `\n${bad} problem${bad === 1 ? "" : "s"} found.` : "\nAll good. New Claude Code sessions will show on the Agents page.");
process.exit(bad ? 1 : 0);
