#!/usr/bin/env node
// Claude Code hook -> hub agent events (agent dashboard step 2, docs/agent-dashboard-scope.md).
// Claude Code runs this on SessionStart, PostToolUse, Stop and SubagentStop with the event as JSON on stdin.
// It posts metadata only: which tool ran and on which file name, plus session and sub-agent ids; never file contents,
// commands or prompts.
// On Stop it adds up the tokens the session used since the last Stop (from the session transcript) and posts them.
// It never blocks Claude Code: everything is in try/catch, it gives up after 3 seconds and always exits 0.
//
// Which room and desk a session belongs to comes from data/agents/hook-map.json, matched on the session's folder:
//   { "D:\\another project-Project": { "room": "another project", "desk": "another project-lead" }, "C:\\the hub": { "room": "hub" } }
// A folder that isn't listed posts to room "unassigned" with desk "temp-worker" (the campus shows a temp worker), so
// nothing is lost.
import fs from "node:fs";
import path from "node:path";
import { ownerName as OWNER } from "../src/hub/settings.js";
import { readJson, writeJsonAtomic, keepLastLines } from "../src/pipeline/files.js";
import { ROOT, HUB_URL as HUB, hubToken, matchFolder } from "./hub-env.mjs";
import { editNote } from "../src/pipeline/editnote.js";

const AGENTS = path.join(ROOT, "data", "agents");
const kill = setTimeout(() => process.exit(0), 3000);

function placeOf(cwd) {
  const map = readJson(path.join(AGENTS, "hook-map.json"), {});
  const hit = matchFolder(map, cwd);
  const m = hit ? map[hit] : null;
  return { room: m?.room || "unassigned", desk: m?.desk || (m?.room ? `${m.room}-claude-code` : "temp-worker") };
}

// Tokens since the last Stop for this session (code review 2026-11-09). Each session keeps its own small state file
// with how far into the transcript it has read, written to a temp file and renamed so a crash can't half-write it,
// and saved only after the hub took the post, so a hub that's off doesn't lose a turn's tokens.
// The same assistant message can span several lines (one per content block), so the last 200 message ids are kept to
// count each once across the boundary. Only Stop counts tokens; SubagentStop posts without them so nothing doubles.
const stateFile = (sessionId) => path.join(AGENTS, "hook-state", `${String(sessionId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "unknown"}.json`);
function usageSince(transcript, sessionId) {
  const file = stateFile(sessionId);
  let state = { offset: 0, ids: [] };
  if (fs.existsSync(file)) {
    state = readJson(file, null);
    if (!state) return null; // unreadable state: skip this turn rather than count the whole transcript again
  }
  let buf;
  try {
    buf = fs.readFileSync(transcript);
  } catch {
    return null;
  }
  if (state.offset > buf.length) state = { offset: 0, ids: [] }; // transcript was replaced
  // Only whole lines: stop at the last newline so a line still being written is read next time.
  const endAt = buf.lastIndexOf(10) + 1;
  if (endAt <= state.offset) return null;
  const seen = new Set(state.ids);
  const sum = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let model = null;
  let fresh = 0;
  let context = null; // how full the session's context is: what the newest reply was sent (input + cached input)
  for (const line of buf.subarray(state.offset, endAt).toString("utf8").split("\n")) {
    if (!line.includes('"usage"')) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = d.message;
    const u = msg?.usage;
    if (!u || !msg.id || seen.has(msg.id)) continue;
    seen.add(msg.id);
    fresh++;
    model = msg.model || model;
    context = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    sum.inputTokens += u.input_tokens || 0;
    sum.outputTokens += u.output_tokens || 0;
    sum.cacheReadTokens += u.cache_read_input_tokens || 0;
    sum.cacheWriteTokens += u.cache_creation_input_tokens || 0;
  }
  const next = { offset: endAt, ids: [...seen].slice(-200), at: new Date().toISOString() };
  const save = () => writeJsonAtomic(file, next, 0);
  return { usage: fresh ? { ...sum, model, messages: fresh, context } : null, save };
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const ev = JSON.parse(input || "{}");
  const token = hubToken();
  const { room, desk } = placeOf(ev.cwd || process.cwd());
  // Ids only, for the campus Neural view (docs/handoffs/neural-view.md): which session a step came from, and which
  // sub-agent when the hook fires inside one (Claude Code adds agent_id and agent_type there). Never content.
  const ids = { ...(ev.session_id ? { session: String(ev.session_id).slice(0, 64) } : {}), ...(ev.agent_id ? { agent: String(ev.agent_id).slice(0, 64), agentType: String(ev.agent_type || "").slice(0, 40) || undefined } : {}) };
  const base = { source: "claude-code", room, desk, provider: "claude", billing: process.env.HUB_BILLING || "subscription", ...ids };
  let body = null;
  let afterOk = null;

  if (ev.hook_event_name === "SessionStart") {
    body = { ...base, action: "session start", summary: `Claude Code session in ${path.basename(ev.cwd || "")}`, ...(room === "unassigned" && ev.cwd ? { folder: String(ev.cwd).slice(0, 300) } : {}) };
  } else if (ev.hook_event_name === "PostToolUse") {
    const t = ev.tool_input || {};
    const file = t.file_path || t.notebook_path || t.path || null;
    // File name only, never the path's full contents or a shell command.
    // Did it fail? Only a yes or no, never the error text. (For the live view on the campus: a failed step shows red.)
    const res = ev.tool_response, failed = Boolean(res && typeof res === "object" && (res.is_error === true || res.isError === true || res.interrupted === true || (typeof res.error === "string" && res.error)));
    // For an edit, a short note on what it did (line counts, section names it added or removed): never the text.
    let note = null; try { note = failed ? null : editNote(ev.tool_name, t, file || ""); } catch {}
    body = { ...base, action: "tool", tool: ev.tool_name || null, summary: file ? path.basename(file) : null, ...(note ? { note } : {}), ...(failed ? { failed: true } : {}) };
  } else if (ev.hook_event_name === "Stop") {
    const r = usageSince(ev.transcript_path, ev.session_id || "unknown");
    const u = r?.usage;
    afterOk = r?.save || null;
    body = { ...base, action: "turn done", ...(u ? { model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: u.cacheReadTokens, cacheWriteTokens: u.cacheWriteTokens, summary: `${u.messages} model replies`, ...(u.context ? { contextTokens: u.context } : {}) } : {}) };
  } else if (ev.hook_event_name === "SubagentStop") {
    body = { ...base, action: "subagent done" };
  }
  if (!body) return;
  // A new session hears about the jobs the owner gave its desk: Claude Code adds a SessionStart hook's output to the
  // session's context. Best effort: a slow or missing hub just means no job list this time.
  // (Fetched alongside the event post, so the hook stays inside its 3 seconds.)
  const jobsTold = ev.hook_event_name === "SessionStart" ? Promise.all([tellJobs(token, desk).catch(() => {}), tellStandup(token, desk).catch(() => {}), tellResults(token, desk).catch(() => {})]) : null;
  const res = await fetch(`${HUB}/api/agents/ingest/event`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(2500) });
  if (!res.ok) throw new Error(`hub answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  await jobsTold;
  afterOk?.();
  // Last successful post, so it's easy to see the hook is alive.
  fs.writeFileSync(path.join(AGENTS, "hook-last-ok.txt"), `${new Date().toISOString()} ${ev.hook_event_name}\n`);
}

// A lead's new session hears the other projects' updates from the latest lead stand-up.
async function tellStandup(token, desk) {
  const res = await fetch(`${HUB}/api/agents/ingest/standup`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ desk }), signal: AbortSignal.timeout(1200) });
  if (!res.ok) return;
  const s = await res.json();
  if (!s?.lines?.length) return;
  process.stdout.write([`${OWNER()}'s hub, lead stand-up (${s.slot}, ${new Date(s.at).toLocaleString()}): what the other projects are doing.`, ...s.lines.map((l) => `- ${l}`), ""].join("\n"));
}

// Work this desk handed to others that has come back in the last day (their results are in its inbox).
async function tellResults(token, desk) {
  const res = await fetch(`${HUB}/api/agents/ingest/inbox`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ desk, limit: 30 }), signal: AbortSignal.timeout(1200) });
  if (!res.ok) return;
  const list = (await res.json()).filter((m) => m.kind === "result" && m.to === desk && Date.now() - Date.parse(m.at) < 864e5).slice(0, 5);
  if (!list.length) return;
  const tool = path.join(ROOT, "tools", "agent-log.mjs").replace(/\\/g, "/");
  process.stdout.write([`${OWNER()}'s hub: ${list.length} result${list.length === 1 ? "" : "s"} came back from work you handed on:`, ...list.map((m) => `- ${m.about}${m.note ? `: ${m.note}` : ""}`), `Read them in full: node ${tool} inbox --desk ${desk}`, ""].join("\n"));
}

async function tellJobs(token, desk) {
  const res = await fetch(`${HUB}/api/agents/ingest/jobs`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ desk }), signal: AbortSignal.timeout(1200) });
  if (!res.ok) return;
  const list = await res.json();
  if (!Array.isArray(list) || !list.length) return;
  const tool = path.join(ROOT, "tools", "agent-log.mjs").replace(/\\/g, "/");
  process.stdout.write(
    [
      `${OWNER()}'s hub: ${list.length} open job${list.length === 1 ? "" : "s"} for your desk (${desk}), given from the Agents page or the campus:`,
      ...list.map((j) => `- [${j.id}] ${j.text}`),
      `When you start one: node ${tool} take --job <id> --desk ${desk}`,
      `When it's finished: node ${tool} done --job <id> --desk ${desk} --summary "<one line: what you did>"  (or "fail" with why)`,
      `If another desk should do the next step: node ${tool} handoff --desk ${desk} --job <id> --to <desk> --text "<what they should do>" [--result-file <your result.md>]  (list desks: node ${tool} desks)`,
      `Check these against what ${OWNER()} asks in this session; their words in the session come first.`,
      "",
    ].join("\n"),
  );
}

// Errors never reach Claude Code, but they're kept in data/agents/hook-errors.log (last 50) so a silent failure can be found.
function noteError(err) {
  try {
    const f = path.join(AGENTS, "hook-errors.log");
    fs.mkdirSync(AGENTS, { recursive: true });
    fs.appendFileSync(f, `${new Date().toISOString()} ${String(err?.cause?.code || err?.code || "")} ${String(err?.message || err).slice(0, 300)}\n`);
    keepLastLines(f, 50);
  } catch {}
}

main().catch(noteError).finally(() => {
  clearTimeout(kill);
  process.exit(0);
});
