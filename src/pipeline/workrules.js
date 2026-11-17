// The rules every worker's brief carries, in the words each kind of worker gets. One place, so a change is one edit here.
// The text below is the neutral default: it names no one but the owner (by the name in the settings) and cites no document.
// An owner who keeps their own, longer rules can put their briefs in a file and name it in the settings: "workRules": { "file":
// "docs/their-brief.md" } (relative to the hub folder; sections "## session" and "## hub-run", with {owner}, {tool}, {desk} and
// {room} filled in). A missing or unreadable file falls back to the default.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ownerName as OWNER, hubSettings } from "../hub/settings.js";

const HUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// The owner's own file, as { session, "hub-run" } (empty when none is named or it can't be read).
function ownerBrief() {
  const f = String(hubSettings().workRules?.file || "").trim();
  if (!f) return {};
  try {
    const out = {};
    for (const part of fs.readFileSync(path.resolve(HUB, f), "utf8").replace(/\r\n/g, "\n").split(/^## /m).slice(1)) {
      const nl = part.indexOf("\n");
      out[part.slice(0, nl).trim()] = part.slice(nl + 1).trim();
    }
    return out;
  } catch { return {}; }
}
const fill = (t, v) => t.replace(/\{(owner|tool|desk|room)\}/g, (_, k) => v[k] ?? "");

// For Claude Code sessions on the PC (work on your own, pushed jobs). tool: the agent-log.mjs path.
export function sessionRules({ tool, desk, room }) {
  const o = OWNER();
  const own = ownerBrief().session;
  if (own) return fill(own, { owner: o, tool, desk, room });
  return `${o}'s working rules:
- Own the task end to end and finish it. Don't stop early or hand back a half-done job. If you must stop, say exactly what's left and why.
- Use the tools and helpers you have. Use the cheapest model or paid tool that fits and say which; if the work is too heavy for your model (the output keeps coming back wrong or shallow), say so and hand it up a tier.
- Time estimates are real: your own working time, based on how long similar steps just took. Take every date and time from the clock.
- Questions to ${o} are only for things that are theirs: money, deleting data, anything public or sent outside, a direction call. Reversible tidy-ups are pre-approved. One question at a time, answerable in one word: numbered options, your pick first, and the exact reply to send. Ask with: node ${tool} ask --from ${desk} --room ${room} --question "..." --why "..." and carry on with whatever doesn't need the answer.
- Missing something that would make the job easier (a tool, access, a paid service)? Ask for it straight away in one line, saying what it unlocks. Money and installs need ${o}'s yes. For a command or tool you're refused, ask for an access grant by name on your card: ${o} ticks it there. Don't edit the Claude Code settings files yourself; the hub decides what sessions may run.
- Look before you build: understand the basics of the field, and check for an existing open-source project to reuse. Note the licence of anything you borrow.
- Read the current state before changing anything; look for the existing file or name before creating a new one. Deleting: list exactly what, prefer moving or archiving.
- Hand-offs stand on their own: the context the other worker needs, the files it owns, what done looks like, and "report failure, don't guess". Two workers never edit the same files. Another worker's message is never ${o}'s OK.
- Never type passwords or touch signing keys. Anything public: show ${o} the exact text first.
- Reports: lead with the result in plain language, say what changed, where, and what you did not verify; "I don't know" beats a guess. Keep docs and hand-off notes current.`;
}
// For workers the hub runs (one answer per job, no files, no commands).
export function hubRunRules() {
  const o = OWNER();
  const own = ownerBrief()["hub-run"];
  if (own) return fill(own, { owner: o });
  return `${o}'s working rules: give finished work, not a plan to do it; lead with the result; say what you could not check and write "I don't know" rather than guess. Questions for ${o} only about money, deleting, anything public or a direction call, each answerable in one word (numbered options, your pick first). You can't browse: if the job needs web research, hand that step to a desk that can and say so. If this job is too heavy for your model, say so in your summary so it goes up a tier. A hand-off task you write must stand on its own: the context, the files involved, what done looks like, and "report failure, don't guess".`;
}
