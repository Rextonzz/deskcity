// The glance level of the page blocks (step 2 of the owner's plan; he OK'd the mock-ups 2026-11-14): one small answer for
// every prop on the campus, so the queue board (YouTube building) and the meter wall (Control Center) don't each poll
// their pages' own routes. Read-only. GET /api/pipeline/glance; the campus asks while a prop is on screen.
// The props' actions don't come through here: they call the same routes the pages use (public/parts/<page>.js ACTIONS).
import { loadPipelineConfig, channelName, pipelineTz } from "./util.js";
import { listJobs } from "./jobs.js";
import { moduleOn } from "../hub/modules.js";

const titleOf = (j) => String(j.data?.meta_out?.title || j.data?.title || j.sourceName || j.id);
const firstLine = (s) => (s ? String(s).split("\n")[0].slice(0, 120) : null);
// A job's state on the board, in the order the board lists them: what needs the owner first, then what's moving, then
// what's booked by time. Jobs that are done, skipped or already live aren't on it.
// "private": uploaded as private, waiting for the owner to make it public now or at the next slot.
const STATE = { held: "you", private: "private", failed: "stuck", publishing: "up", posting: "up", running: "making", queued: "wait", scheduled: "set" };
const RANK = { you: 0, private: 1, stuck: 2, up: 3, making: 4, wait: 5, set: 6 };

// The queue board. jobs: listJobs() (or a test's own); chName(id) -> the channel's name; tz for the times in the line.
export function pipelineGlance(jobs, { now = Date.now(), chName = (id) => id, tz = "UTC", limit = 8 } = {}) {
  const items = [];
  for (const j of jobs || []) {
    const state = STATE[j.status];
    if (!state) continue;
    const at = j.data?.publishAt || null;
    if (state === "set" && !(Date.parse(at) > now)) continue; // already went live
    items.push({
      id: j.id, channel: j.channel, channelName: chName(j.channel), title: titleOf(j).slice(0, 90), state,
      at: state === "set" || state === "up" ? at : null, step: j.stage || null,
      why: state === "you" ? firstLine(j.hold?.reason) : state === "stuck" ? firstLine(j.error?.message) : null,
      // a held job needs answers typed on its card (boxes or the title and description review)
      needsCard: state === "you" ? Boolean(j.hold?.fields?.length || j.hold?.review) : false,
    });
  }
  items.sort((a, b) => RANK[a.state] - RANK[b.state] || (Date.parse(a.at) || Infinity) - (Date.parse(b.at) || Infinity));
  const n = (s) => items.filter((x) => x.state === s).length;
  const next = items.filter((x) => x.state === "set").sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
  const time = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  const bits = [];
  if (n("set")) bits.push(`${n("set")} booked · next ${time(next.at)} ${next.channelName}`);
  if (n("you")) bits.push(`${n("you")} waiting on you`);
  if (n("private")) bits.push(`${n("private")} private, ready to post`);
  if (n("stuck")) bits.push(`${n("stuck")} stuck`);
  if (n("making") + n("up")) bits.push(`${n("making") + n("up")} on the go`);
  if (n("wait")) bits.push(`${n("wait")} in line`);
  return { line: bits.join(" · ") || "Nothing in the queue", items: items.slice(0, limit), more: Math.max(0, items.length - limit), counts: { you: n("you"), private: n("private"), stuck: n("stuck") } };
}

// The meter wall, from the month's spend forecast (forecastNow()): the whole hub, then the workers with a cap or any
// spend, the ones closest to (or past) their caps first.
// Finance's notes (2026-11-14): plan (subscription) use is its own small figure, never added into the spend; the
// biggest API spender this month (not paused) gets a Pause button; the latest weekly money note shows on the wall.
// paused: ids of paused desks. note: latestMoneyNote() or null.
export function aiGlance(f, { limit = 8, paused = [], note = null } = {}) {
  if (!f?.hub) return { line: "No spend figures yet", hub: null, desks: [], note };
  const h = f.hub, usd0 = (v) => `$${Math.round(v || 0)}`, ahead = Math.max(h.projected || 0, h.projectedTrend || 0);
  const word = { over: "▲ over", near: "● near", ok: "✓ ok" }[h.label] || "no caps set";
  const line = h.cap != null
    ? `API ${usd0(h.spent)} of ${usd0(h.cap)} this month · heading for ${usd0(h.projected)} (last 7 days' pace: ${usd0(h.projectedTrend)}) · ${word}`
    : `API ${usd0(h.spent)} this month · heading for ${usd0(ahead)} · no caps set`;
  const share = (d) => (d.cap ? Math.max(d.projected, d.projectedTrend) / d.cap : 0);
  const desks = (f.desks || []).filter((d) => d.id !== "unassigned" && (d.cap != null || d.spent > 0))
    .sort((a, b) => share(b) - share(a) || b.spent - a.spent).slice(0, limit)
    .map((d) => ({ id: d.id, spent: d.spent, projected: d.projected, projectedTrend: d.projectedTrend, cap: d.cap, label: d.label, paused: paused.includes(d.id) || undefined }));
  const top = (f.desks || []).filter((d) => d.id !== "unassigned" && d.spent > 0 && !paused.includes(d.id)).sort((a, b) => b.spent - a.spent)[0];
  return {
    line, hub: { spent: h.spent, projected: h.projected, projectedTrend: h.projectedTrend, cap: h.cap, label: h.label }, desks, day: f.day, days: f.days,
    plan: h.subSpent > 0 ? { spent: h.subSpent, projected: Math.max(h.subProjected || 0, h.subProjectedTrend || 0) } : null,
    top: top ? { id: top.id, spent: top.spent } : null,
    note,
  };
}

// Everything the campus's props show, for the parts that are on. forecast: forecastNow (passed in by the route, so
// this file doesn't import the whole agents module).
export function glanceNow({ forecast, settings, paused, note } = {}) {
  const out = { at: new Date().toISOString(), pipeline: null, ai: null };
  if (moduleOn("youtube", settings)) {
    try {
      const cfg = loadPipelineConfig();
      out.pipeline = pipelineGlance(listJobs(), { chName: (id) => channelName(id, cfg), tz: pipelineTz(cfg) });
    } catch (err) { out.pipeline = { error: err.message, line: "Couldn't read the jobs", items: [] }; }
  }
  let extra = {};
  try { extra = { paused: paused?.() || [], note: note?.() || null }; } catch {}
  try { out.ai = aiGlance(forecast?.(), extra); } catch (err) { out.ai = { error: err.message, line: "Couldn't read the spend", desks: [] }; }
  return out;
}
