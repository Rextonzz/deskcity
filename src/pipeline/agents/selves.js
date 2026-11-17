// Part of the agents module (src/pipeline/agents.js), added 2026-11-12: workers' personalities grow from what they do.
// the owner 2026-11-11: "I'd like them to develop their personality more as they chat, interact, surf and watch."
//
// Every chat, Short, web session, buy and finished job adds a line to that worker's life record (data/agents/life.jsonl).
// Once a worker has 10 new lines, or a day has passed with at least one, a cheap model rewrites its self
// (data/agents/selves.json): who they are, what they're into lately, friends and running jokes, quirks. It changes a
// little at a time from the old self, starting from the worker's original trait. The self then feeds what they pick to
// watch and look up, how they text, and their thought bubbles; it shows on their card with a short change history.
// Cost: about a tenth of a cent per update on Gemini Flash (Haiku without a Gemini key), charged to the store's budget
// as "campus life" (storeSpend). When the store's budget is used up, selves stop changing until next month.
import fs from "node:fs";
import path from "node:path";
import { petName, ownerId } from "../../hub/settings.js";
import { writeJsonAtomic } from "../util.js";
import { hasGemini } from "../ai.js";
import { helperMay } from "../../hub/helpers.js";
import { askAs, obj, str, arr } from "../claude.js";
import { DIR, appendJsonl, clip, readJsonl, roster, slug, traitOf } from "../agents.js";

const LIFE = () => path.join(DIR(), "life.jsonl");
const SELVES = () => path.join(DIR(), "selves.json");
const EVERY = 10, DAY = 864e5, PER_TICK = 3;
export const SELF_STEP = "campus_self";

// One thing that happened to a worker. kind: chat, short, web, buy, work.
export function noteLife(desk, kind, text) {
  const id = slug(desk);
  if (!id || id === ownerId() || id === petName()?.toLowerCase() || !text) return; // the pet is never staffed or costed: no self for it
  try { appendJsonl(LIFE(), { at: new Date().toISOString(), desk: id, kind, text: clip(String(text).replace(/\s+/g, " "), 200) }); } catch {}
}
export function selves() {
  try { return JSON.parse(fs.readFileSync(SELVES(), "utf8")) || {}; } catch { return {}; }
}
// The words other prompts use for a worker's personality: their grown self, or the starting trait.
export function selfLine(id) {
  const s = selves()[id];
  if (!s?.about) return `personality: ${traitOf(id)}`;
  return `who they are: ${String(s.about).replace(/[.\s]+$/, "")}${s.into?.length ? `; into lately: ${s.into.join(", ")}` : ""}${s.quirks?.length ? `; quirks: ${s.quirks.join(", ")}` : ""}`;
}
// For the campus: the short version of every self.
export function selvesForPage() {
  const out = {};
  for (const [id, s] of Object.entries(selves())) out[id] = { about: s.about, into: s.into || [], quirks: s.quirks || [], friends: s.friends || [], history: (s.history || []).slice(-3), updatedAt: s.updatedAt };
  return out;
}
// Who is due a rewrite, most overdue first.
export function dueSelves(now = Date.now()) {
  const all = selves(), life = readJsonl(LIFE()), desks = roster().desks.filter((d) => d.status === "active");
  return desks.map((d) => {
    const since = all[d.id]?.updatedAt || "";
    const fresh = life.filter((l) => l.desk === d.id && l.at > since);
    const age = since ? now - Date.parse(since) : Infinity;
    return { d, fresh, due: fresh.length >= EVERY || (fresh.length >= 1 && age >= DAY) };
  }).filter((x) => x.due).sort((a, b) => b.fresh.length - a.fresh.length);
}
let growing = false;
// Rewrite up to PER_TICK selves. budgetOpen: the store's budget still has money (storeSpend().open).
export async function growSelves({ budgetOpen = true } = {}) {
  if (growing || !budgetOpen) return [];
  if (!helperMay("selves").ok) return []; // AI helpers off or at today's limit (Admin > AI helpers)
  growing = true;
  try {
    const due = dueSelves().slice(0, PER_TICK);
    if (!due.length) return [];
    const model = hasGemini() ? "gemini-flash" : "claude-haiku-5-5";
    const r = roster(), rooms = Object.fromEntries(r.rooms.map((x) => [x.id, x.name])), ids = new Set(r.desks.map((d) => d.id));
    const done = [];
    for (const { d, fresh } of due) {
      const all = selves(), old = all[d.id] || null;
      const a = await askAs({
        name: SELF_STEP, model, effort: "low",
        system: "You keep the self-description of an AI coworker on a cozy office campus up to date. They grow from what happens to them: chats with coworkers, Shorts they watch, things they look up on the web, what they buy, work they finish. Change them a little at a time: keep what still fits, add what the new experiences clearly show, drop what no longer fits. Never invent events that aren't listed. Write in plain words, warm and specific. about: 2 or 3 sentences in the third person. into: up to 5 short topics they're into lately. friends: up to 5 coworkers they're close to (by desk id, only ids that appear in the experiences) with a few words on why, like a running joke. quirks: up to 4 short habits. changed: one short line on what changed this time.",
        content: `Coworker: ${d.id}, ${d.role || "staff"} in ${rooms[d.room] || d.room}. Starting trait: ${traitOf(d.id)}.\nCurrent self: ${old ? JSON.stringify({ about: old.about, into: old.into, friends: old.friends, quirks: old.quirks }) : "none yet: start from the trait and the experiences."}\nNew experiences, oldest first:\n${fresh.slice(-40).map((l) => `- [${l.kind}] ${l.text}`).join("\n")}`,
        schema: obj({ about: str, into: arr(str), friends: arr(obj({ desk: str, note: str })), quirks: arr(str), changed: str }),
      }).catch((err) => { console.warn(`Campus self for ${d.id}: ${err.message}`); return null; });
      if (!a?.about) continue;
      const now = new Date().toISOString();
      const self = {
        about: clip(a.about, 400),
        into: (a.into || []).map((x) => clip(x, 40)).filter(Boolean).slice(0, 5),
        friends: (a.friends || []).filter((f) => f && ids.has(slug(f.desk)) && slug(f.desk) !== d.id).map((f) => ({ desk: slug(f.desk), note: clip(f.note, 80) })).slice(0, 5),
        quirks: (a.quirks || []).map((x) => clip(x, 60)).filter(Boolean).slice(0, 4),
        updatedAt: now,
        history: [...(old?.history || []), { at: now, changed: clip(a.changed, 160) || "first written" }].slice(-10),
        from: traitOf(d.id),
      };
      const cur = selves(); cur[d.id] = self; writeJsonAtomic(SELVES(), cur);
      done.push(d.id);
    }
    return done;
  } finally { growing = false; }
}
