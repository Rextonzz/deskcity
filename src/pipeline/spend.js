// The spend ledger (clean-up I7, the owner 2026-11-13): data/spend.jsonl, one line per AI call or agent event that
// has a cost: { at, desk, room, model, provider, costUsd, kind } (plus billing when an event says "subscription").
// Worker caps, the finance numbers and the HUD / fountain / CEO tower read this month's total from here, so they no
// longer scan the run log (which keeps only its newest 5000 lines) or the 20000-line events file. No prompts, no keys.
// The month starts at midnight on the 1st in the hub's time zone, like the other daily resets.
import fs from "node:fs";
import { resolvePath, appendJsonl, readJsonl, readJsonlCached, writeFileAtomic } from "./util.js";
import { readRuns } from "./runlog.js";
import { rollOverflowRows } from "./roll.js";
import { partsIn } from "./fmt.js";
import { hubTz, petName } from "../hub/settings.js";

const FILE = () => resolvePath("data/spend.jsonl");
export const SPEND_MONTHS = 13;
const TRIM_EVERY = 200;

// The first moment of the month `monthsBack` months before the one `now` is in, at midnight in `tz`, as an ISO string.
export function monthStartIso(now = new Date(), tz = hubTz(), monthsBack = 0) {
  const p = partsIn(tz, now);
  const first = Date.UTC(p.y, p.m - 1 - monthsBack, 1);
  let t = first;
  for (let i = 0; i < 2; i++) { // twice, so a month whose 1st sits past a clock change still lands on midnight
    const q = partsIn(tz, new Date(t));
    t -= Date.UTC(q.y, q.m - 1, q.d, q.hh, q.mm) - first;
  }
  return new Date(t).toISOString();
}

// "2026-11": the month `now` is in, by the hub's wall clock (the same month spendThisMonth reads).
export function monthKey(now = new Date(), tz = hubTz()) {
  const p = partsIn(tz, now);
  return `${p.y}-${String(p.m).padStart(2, "0")}`;
}

// Which desk a hub AI call is booked to: HR's review on HR, a hub-run desk job ("desk_<id>") on that desk, the rest
// of the pipeline on "hub-pipeline".
export const deskOfCall = (step) => {
  const s = String(step || "");
  return s.startsWith("hr_review") ? "hr" : s.startsWith("desk_") ? s.slice(5) : "hub-pipeline";
};

// Agent events live in agents.js, which imports this file: it hands over its own reader so old events can seed the ledger.
let legacyEvents = () => [];
export const setLegacyEvents = (fn) => { legacyEvents = fn; };

const rowOf = (x) => ({
  at: x.startedAt || x.at,
  desk: x.kind === "ai call" ? deskOfCall(x.step) : x.desk || "unassigned",
  room: x.kind === "ai call" ? null : x.room || null,
  model: x.model || null,
  provider: x.provider || null,
  costUsd: x.costUsd,
  kind: x.kind,
  ...(x.kind === "ai call" && x.step ? { step: x.step } : {}),
  ...(x.billing ? { billing: x.billing } : {}),
  ...(x.posted ? { posted: true } : {}), // a cost a session reported itself (agent key), not one the hub measured
  ...(x.costDefault ? { costDefault: true } : {}), // no price on file: booked at the default rate
});

// A paid call came back with no cost the hub could work out; agents.js records the event (it imports this file).
let costUnknown = () => {};
export const setCostUnknownHook = (fn) => { costUnknown = fn; };
export const noteCostUnknown = (info) => { try { costUnknown(info); } catch (err) { console.warn(`Cost unknown note: ${err.message}`); } };
// the pet (the cat) is never costed: nothing booked to him lands in the ledger.
// The campus pet is never costed: rows that name it are left out.
// Only the pet's own id counts (its name in lower case, as agents/selves.js uses it), as a desk or a room: never a
// part of another id (money safety B2, 2026-11-16: a pet "Lea" used to hide desk "hub-lead"'s spend).
const isPet = (r) => {
  const p = String(petName() || "").trim().toLowerCase();
  return Boolean(p) && (String(r.desk || "").toLowerCase() === p || String(r.room || "").toLowerCase() === p);
};

let seeded = false;
// First use with no ledger yet: build it once from the AI-call rows the run log still holds and the agent events of
// this and last month, so the totals don't drop to zero on the day this starts.
function ensureSeeded(now = new Date()) {
  if (seeded) return;
  seeded = true;
  if (fs.existsSync(FILE())) return;
  const since = Date.parse(monthStartIso(now, hubTz(), 1));
  const rows = [...readRuns({ kinds: ["ai call"], limit: 100000 }), ...legacyEvents()]
    .filter((x) => Number.isFinite(x.costUsd) && Date.parse(x.startedAt) >= since)
    .map(rowOf)
    .filter((r) => !isPet(r))
    .sort((a, b) => a.at.localeCompare(b.at));
  writeFileAtomic(FILE(), rows.map((r) => JSON.stringify(r) + "\n").join(""));
}

let writes = 0;
// Add one costed call or event (a run-log "ai call" row or an agent event). No cost, no line. Call it before the row
// goes into the run log or the events file, so a first-use seed never counts it twice.
export function appendSpend(x) {
  try {
    if (!Number.isFinite(x?.costUsd)) return;
    const row = rowOf({ ...x, startedAt: x.startedAt || new Date().toISOString() });
    if (isPet(row)) return;
    ensureSeeded();
    appendJsonl(FILE(), row);
    if (++writes % TRIM_EVERY === 0) trimSpend();
  } catch (err) {
    console.warn(`Spend ledger: couldn't write: ${err.message}`);
  }
}

// Drop lines older than the last 13 months (this month and the 12 before it).
export function trimSpend(now = new Date()) {
  const cut = Date.parse(monthStartIso(now, hubTz(), SPEND_MONTHS - 1));
  const rows = readJsonl(FILE());
  const keep = rows.filter((r) => Date.parse(r.at) >= cut);
  // the older rows roll into spend-YYYY-MM.jsonl.gz instead of being dropped
  if (keep.length < rows.length) rollOverflowRows(FILE(), rows.filter((r) => !(Date.parse(r.at) >= cut)), keep, { field: "at" });
}

// The ledger lines of the month `now` is in (hub time), oldest first.
export function spendThisMonth(now = new Date()) {
  ensureSeeded(now);
  const since = Date.parse(monthStartIso(now)), until = Date.parse(monthStartIso(now, hubTz(), -1));
  return readJsonlCached(FILE()).filter((r) => Number.isFinite(r.costUsd) && Date.parse(r.at) >= since && Date.parse(r.at) < until);
}

// The ledger lines from `sinceMs` up to now, oldest first (the plan meter reads the last few weeks, across months).
export function spendSince(sinceMs, now = new Date()) {
  ensureSeeded(now);
  return readJsonlCached(FILE()).filter((r) => Number.isFinite(r.costUsd) && Date.parse(r.at) >= sinceMs);
}

export const resetSpendSeed = () => { seeded = false; writes = 0; };
