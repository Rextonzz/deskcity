// The plan meter (the owner 2026-11-14: "can Finance control budget on token spend in Sub as well", with "a good way to
// est vs usage actual"). Two sources, used together:
//   actual:   Claude Code hands every status line script Anthropic's own meter, rate_limits.five_hour and
//             rate_limits.seven_day ({ used_percentage, resets_at }), the same numbers /usage shows.
//             tools/statusline-meter.mjs posts them here (POST /api/agents/ingest/plan-meter).
//   estimate: the hub's spend ledger (spend.js), where every Claude Code session is priced at API rates and booked to
//             its project (billing "subscription").
// The meter gives the true total for the account (it also counts claude.ai chat and sessions the hub never hears of);
// the ledger gives the split by project. Each project's share of the real weekly % is its share of this week's ledger
// use. The calibration (dollars at API prices per 1% of the week) comes from past weeks, so "estimate" is what the
// hub alone would have guessed and the gap to "actual" is use the hub can't see.
// Budgets: a project can get a share of the week (e.g. 30%); hub-started sessions (autonomy, pushed jobs) don't start
// once the project has used it, and none start once the whole week passes the hub stop line (default 90%, so the
// rest stays for the owner's own sessions). the owner's own sessions are never stopped: Finance warns instead.
import fs from "node:fs";
import { resolvePath, appendJsonl, readJsonl, readJson, writeJsonAtomic, writeFileAtomic } from "./util.js";
import { ownerName as OWNER } from "../hub/settings.js";

const METER = () => resolvePath("data/agents/plan-meter.jsonl");
const BUDGETS = () => resolvePath("data/agents/plan-budgets.json");
const WEEK = 7 * 86400e3, HOUR = 3600e3;
export const HUB_STOP_PCT = 90; // default: hub-started sessions stop once the week reaches this
const KEEP = 3000; // readings kept (about a few weeks at the post throttle)
const r1 = (n) => Math.round((n || 0) * 10) / 10;
const r2 = (n) => Math.round((n || 0) * 100) / 100;

// One window from the status line JSON: { used_percentage, resets_at (epoch seconds) } → { pct, resetsAt (ISO) }.
function windowOf(w) {
  if (!w || typeof w !== "object") return null;
  const pct = Number(w.used_percentage), at = Number(w.resets_at);
  if (!Number.isFinite(pct) || pct < 0 || pct > 1000) return null;
  if (!Number.isFinite(at) || at <= 0) return null;
  const ms = at < 1e12 ? at * 1000 : at;
  return { pct: r1(pct), resetsAt: new Date(ms).toISOString() };
}

// A reading from the status line: { rate_limits: { five_hour, seven_day } } (the raw status line JSON, or just that
// part). Saved only when it says something new: a higher %, a new window, or 10 minutes since the last one.
export function recordMeter(body = {}, now = new Date()) {
  const rl = body.rate_limits || body;
  const five = windowOf(rl.five_hour), week = windowOf(rl.seven_day);
  if (!five && !week) throw new Error("No rate_limits in that reading (five_hour or seven_day with used_percentage and resets_at).");
  const row = { at: now.toISOString(), ...(five ? { five } : {}), ...(week ? { week } : {}) };
  const last = readJsonl(METER()).slice(-1)[0];
  const same = (a, b) => (!a && !b) || (a && b && a.pct === b.pct && a.resetsAt === b.resetsAt);
  if (last && same(last.five, row.five) && same(last.week, row.week) && now - Date.parse(last.at) < 10 * 60e3) return { saved: false, ...row };
  appendJsonl(METER(), row);
  const all = readJsonl(METER());
  if (all.length > KEEP * 1.2) writeFileAtomic(METER(), all.slice(-KEEP).map((x) => JSON.stringify(x) + "\n").join(""));
  return { saved: true, ...row };
}
export const meterReadings = () => readJsonl(METER());

// Budgets: { rooms: { <room>: pct of the week }, hubStopPct }.
export function planBudgets() {
  const b = readJson(BUDGETS(), {}) || {};
  return { rooms: b.rooms && typeof b.rooms === "object" ? b.rooms : {}, hubStopPct: Number.isFinite(b.hubStopPct) ? b.hubStopPct : HUB_STOP_PCT };
}
// Set a project's share (pct 1-100, or null / "" to clear it), or the hub stop line (room "hub-stop").
export function setPlanBudget({ room, pct } = {}, roomIds = null) {
  const b = planBudgets();
  const id = String(room || "").trim();
  if (!id) throw new Error("Pick a project.");
  const clear = pct == null || pct === "";
  const n = Number(pct);
  if (!clear && (!Number.isFinite(n) || n <= 0 || n > 100)) throw new Error("A share is a percent of the week, 1 to 100.");
  if (id === "hub-stop") b.hubStopPct = clear ? HUB_STOP_PCT : r1(n);
  else {
    if (roomIds && !roomIds.includes(id)) throw new Error(`No project "${id}".`);
    if (clear) delete b.rooms[id]; else b.rooms[id] = r1(n);
  }
  fs.mkdirSync(resolvePath("data/agents"), { recursive: true });
  writeJsonAtomic(BUDGETS(), b);
  return b;
}

// Starter shares (the owner 2026-11-14: "create an est assumption for the current spot and set for now"): the first time
// the hub has no budget file, each project with plan use in the last 7 days gets a share of 1.25x its part of that
// use, rounded up to the next 5% (at least 5%, at most the stop line). Shares are ceilings, not slices, so together
// they can pass 100%; the stop line still caps the whole week. Never runs again once the file exists, so the owner's own
// changes (or clearing every share) stick.
export function seedPlanBudgets({ rows = [], roomOf = () => null, rooms = [], now = Date.now() } = {}) {
  if (fs.existsSync(BUDGETS())) return null;
  const known = new Set(rooms.map((x) => x.id)), by = {};
  let total = 0;
  for (const r of rows) {
    const t = Date.parse(r.at);
    if (r.billing !== "subscription" || !Number.isFinite(r.costUsd) || t < now - WEEK || t > now) continue;
    const room = r.room || roomOf(r.desk);
    if (!room || !known.has(room)) continue;
    by[room] = (by[room] || 0) + r.costUsd;
    total += r.costUsd;
  }
  if (!(total > 0)) return null;
  const share = Object.fromEntries(Object.entries(by).map(([id, u]) => [id, Math.min(HUB_STOP_PCT, Math.max(5, Math.ceil(((u / total) * 100 * 1.25) / 5) * 5))]));
  const b = { rooms: share, hubStopPct: HUB_STOP_PCT, seeded: { at: new Date(now).toISOString(), from: "last 7 days of logged plan use, 1.25x each project's part, rounded up to 5%" } };
  fs.mkdirSync(resolvePath("data/agents"), { recursive: true });
  writeJsonAtomic(BUDGETS(), b);
  return b;
}

// The latest reading of a window in force at `now` (its reset still ahead). Within one window the meter only goes up,
// so the highest % seen counts (two open terminals can report slightly different numbers).
function current(readings, key, now) {
  let best = null;
  for (const x of readings) {
    const w = x[key];
    if (!w || Date.parse(w.resetsAt) <= now || Date.parse(x.at) > now) continue;
    if (!best || w.resetsAt > best.resetsAt || (w.resetsAt === best.resetsAt && w.pct > best.pct)) best = { ...w, seenAt: x.at };
    else if (w.resetsAt === best.resetsAt && x.at > best.seenAt) best.seenAt = x.at;
  }
  return best;
}

// Dollars (at API prices) per 1% of the week, from finished weeks: the last reading of each week against the ledger's
// subscription use in that week. Weeks under 5% are skipped (too little to measure). Newest first, up to 4.
export function calibrations(readings, rows, now) {
  const weeks = new Map();
  for (const x of readings) {
    const w = x.week;
    if (!w || Date.parse(w.resetsAt) > now) continue;
    const prev = weeks.get(w.resetsAt);
    if (!prev || w.pct > prev.pct) weeks.set(w.resetsAt, { pct: w.pct, resetsAt: w.resetsAt });
  }
  const out = [];
  for (const w of [...weeks.values()].sort((a, b) => b.resetsAt.localeCompare(a.resetsAt))) {
    if (w.pct < 5) continue;
    const end = Date.parse(w.resetsAt), start = end - WEEK;
    const usd = rows.reduce((a, r) => { const t = Date.parse(r.at); return r.billing === "subscription" && t >= start && t < end ? a + r.costUsd : a; }, 0);
    if (usd > 0) out.push({ week: w.resetsAt, pct: w.pct, usd: r2(usd), usdPerPct: r2(usd / w.pct) });
    if (out.length >= 4) break;
  }
  return out;
}

// The plan view: the real meter, the hub's estimate, and each project's share against its budget.
// rows: spend ledger lines of the last few weeks ({ at, desk, room, costUsd, billing }); roomOf(desk) → room for rows
// without one; rooms: [{ id, name }].
export function planView({ readings = [], rows = [], budgets = { rooms: {}, hubStopPct: HUB_STOP_PCT }, rooms = [], roomOf = () => null, now = Date.now() } = {}) {
  const week = current(readings, "week", now), five = current(readings, "five", now);
  const cal = calibrations(readings, rows, now);
  const weekEnd = week ? Date.parse(week.resetsAt) : null, weekStart = weekEnd ? weekEnd - WEEK : now - WEEK;
  const elapsedH = Math.max(1, (now - weekStart) / HOUR), leftH = weekEnd ? Math.max(0, (weekEnd - now) / HOUR) : null;
  const byRoom = {};
  let usd = 0;
  for (const r of rows) {
    const t = Date.parse(r.at);
    if (r.billing !== "subscription" || !Number.isFinite(r.costUsd) || t < weekStart || t > now) continue;
    const room = r.room || roomOf(r.desk) || "unassigned";
    byRoom[room] = (byRoom[room] || 0) + r.costUsd;
    usd += r.costUsd;
  }
  const actual = week ? week.pct : null;
  // Dollars per 1%: from finished weeks when there are any. Before that (the owner 2026-11-14: "create an est assumption
  // for the current spot"), this week's own ratio so far, once the meter shows at least 2% and the ledger has use.
  // That provisional figure makes this week's estimate equal the meter by construction, so no gap is shown for it;
  // it carries the estimate into next week until a finished week replaces it.
  let usdPerPct = null, calSource = null;
  if (cal.length) { usdPerPct = r2(cal.reduce((a, c) => a + c.usdPerPct, 0) / cal.length); calSource = "finished weeks"; }
  else if (actual != null && actual >= 2 && usd > 0) { usdPerPct = r2(usd / actual); calSource = "this week so far"; }
  const estimate = usdPerPct ? r1(usd / usdPerPct) : null;
  const pace = (pct) => (pct == null || leftH == null ? null : r1(pct + (pct / elapsedH) * leftH));
  const names = Object.fromEntries(rooms.map((x) => [x.id, x.name]));
  const ids = new Set([...Object.keys(byRoom), ...Object.keys(budgets.rooms || {})]);
  const list = [...ids].map((id) => {
    const u = byRoom[id] || 0;
    // the real meter split by the ledger's mix; before the first reading, the calibrated estimate; else nothing
    const used = actual != null && usd > 0 ? r1((u / usd) * actual) : usdPerPct ? r1(u / usdPerPct) : null;
    const budget = budgets.rooms?.[id] ?? null;
    const projected = pace(used);
    return { id, name: names[id] || id, usd: r2(u), used, projected, budget,
      label: budget == null || used == null ? "no budget" : used >= budget ? "over" : (projected ?? used) > budget ? "heading over" : (projected ?? used) >= budget * 0.8 ? "near" : "ok" };
  }).sort((a, b) => (b.used ?? 0) - (a.used ?? 0) || b.usd - a.usd);
  return {
    hasMeter: !!week,
    week: week ? { pct: week.pct, resetsAt: week.resetsAt, seenAt: week.seenAt, projected: pace(week.pct) } : null,
    five: five ? { pct: five.pct, resetsAt: five.resetsAt, seenAt: five.seenAt } : null,
    usd: r2(usd), usdPerPct, calSource, estimate, actual, gap: calSource === "finished weeks" && actual != null && estimate != null ? r1(actual - estimate) : null,
    calibrations: cal, hubStopPct: budgets.hubStopPct ?? HUB_STOP_PCT, rooms: list,
  };
}

// Why a hub-started session for this project can't start now, or null. Only the real meter stops anything: with no
// reading this week there is nothing to go on, so sessions run as before.
export function planBlock(view, room) {
  if (!view?.hasMeter) return null;
  if (view.week.pct >= view.hubStopPct)
    return `The plan's weekly limit is at ${view.week.pct}%, past the hub's ${view.hubStopPct}% stop line (the rest is kept for ${OWNER()}'s own sessions). It resets ${view.week.resetsAt}.`;
  const r = view.rooms.find((x) => x.id === room);
  if (r && r.budget != null && r.used != null && r.used >= r.budget)
    return `${r.name} has used about ${r.used}% of the week, its whole ${r.budget}% share (Finance). It resets ${view.week.resetsAt}; raise the share on the Finance panel to carry on now.`;
  return null;
}

// Lines for the finance desk's jobs and the weekly note.
export function planLines(v) {
  if (!v) return [];
  if (!v.hasMeter) return [`Plan use (subscription): no meter reading this week yet; $${v.usd} at API prices logged this week${v.estimate != null ? `, about ${v.estimate}% of the week by past weeks' rate` : ""}.`];
  return [
    `Plan use (subscription), Anthropic's meter: ${v.week.pct}% of the week (resets ${v.week.resetsAt}), heading for about ${v.week.projected}%${v.five ? `; 5-hour window ${v.five.pct}%` : ""}. Hub stop line ${v.hubStopPct}%.`,
    `Hub estimate from its own logs: ${v.estimate != null ? `${v.estimate}% ($${v.usd} at $${v.usdPerPct} per 1%, from ${v.calSource}${v.calSource === "this week so far" ? ", provisional" : ""})` : `not calibrated yet ($${v.usd} logged)`}${v.gap != null ? `; gap ${v.gap} points (use the hub can't see, e.g. claude.ai chat)` : ""}.`,
    "By project (share of the week used, heading for, budget):",
    ...v.rooms.slice(0, 15).map((x) => `- ${x.name}: ${x.used ?? "?"}%, heading for ${x.projected ?? "?"}%${x.budget != null ? ` of a ${x.budget}% share (${x.label})` : ""}`),
  ];
}
