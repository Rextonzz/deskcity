// Alert rules the owner sets (competitor survey, 2026-11-14): "tell me if any worker spends more than $2 in an hour",
// "if a job fails twice in a row", and so on. Rules live in data/agents/alert-rules.json; a checker (agents.js
// startWatchers, every 5 minutes) reads the hub's own data, and when a rule fires it sends ONE phone alert and records
// an event. The same rule never fires again inside its cooldown (default 6 h). data/agents/alert-log.json keeps the
// per-rule last-fired times and the last 50 firings. Nothing here calls an AI or spends money.
//   checkAlerts(ctx) is pure apart from those two files and the notify / record callbacks ctx carries (so tests can
//   stand in for the phone). agents.js builds ctx from the ledger, jobs, events and roster.
import path from "node:path";
import { readJson, writeJsonAtomic } from "./files.js";
import { newId, resolvePath } from "./util.js";
import { partsIn } from "./fmt.js";
import { hubTz } from "../hub/settings.js";

const FILE = () => path.join(resolvePath("data/agents"), "alert-rules.json");
const LOG = () => path.join(resolvePath("data/agents"), "alert-log.json");
export const MAX_RULES = 50;
export const MAX_LOG = 50;
export const DEFAULT_COOLDOWN_H = 6;
const HOUR = 3600e3;

// Each rule type: what it is called, which fields it takes (required / optional).
export const RULE_TYPES = {
  hour_spend: { label: "A worker spends more than $X in an hour", need: ["usd"], may: ["desk", "includeSubscription"] },
  day_spend: { label: "A worker spends more than $X today", need: ["usd", "desk"], may: ["includeSubscription"] },
  job_failed_twice: { label: "A job fails twice in a row", need: [], may: ["desk"] },
  idle_open_job: { label: "A worker has an open job but no steps for X hours", need: ["hours"], may: ["desk"] },
  month_projected: { label: "The month's projected spend passes the budget", need: [], may: ["usd"] },
  // from the meter wall (page blocks, step 2): one worker's month heading past its own cap
  desk_projected: { label: "A worker's month is heading over its cap", need: ["desk"], may: [] },
  // Finance's idea for the meter wall (2026-11-14): a heads-up at 25, 50 or 75% of a worker's cap. Fires once a month.
  desk_cap_pct: { label: "A worker has spent X% of its monthly cap", need: ["desk", "pct"], may: [] },
};
const KEYS = new Set(["id", "type", "name", "desk", "usd", "hours", "cooldownHours", "enabled", "includeSubscription", "pct"]);

const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u001f\u007f-\u009f​-‏⁠﻿]/g, " ").trim().slice(0, n);

// Plain-English line for a rule ("Any worker spends more than $2 in an hour").
export function describe(r) {
  const who = r.desk || "any worker", sub = r.includeSubscription ? " (plan use counted)" : "";
  switch (r.type) {
    case "hour_spend": return `${r.desk ? r.desk : "Any worker"} spends more than $${r.usd} in an hour${sub}`;
    case "day_spend": return `${r.desk} spends more than $${r.usd} today${sub}`;
    case "job_failed_twice": return `${r.desk ? `${r.desk}'s` : "A worker's"} jobs fail twice in a row`;
    case "idle_open_job": return `${r.desk ? r.desk : "A worker"} has an open job and no steps for ${r.hours} h`;
    case "desk_projected": return `${r.desk}'s month is heading over its cap`;
    case "desk_cap_pct": return `${r.desk} has spent ${r.pct}% of its monthly cap`;
    case "month_projected": return r.usd != null ? `The month's projected spend passes $${r.usd}` : "The month's projected spend passes the budget (the hub's caps)";
    default: return `${who}: ${r.type}`;
  }
}

// Check a rule from the owner's form or API call. Throws a plain-English Error on anything odd; returns the clean rule.
// deskIds: the roster's desk ids (null skips the desk check).
export function cleanRule(body, { deskIds = null } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Send the rule as an object.");
  for (const k of Object.keys(body)) if (!KEYS.has(k)) throw new Error(`Unknown field "${clean(k, 30)}".`);
  const spec = RULE_TYPES[body.type];
  if (!spec) throw new Error(`Pick a rule type: ${Object.keys(RULE_TYPES).join(", ")}.`);
  const allowed = new Set([...spec.need, ...spec.may, "id", "type", "name", "cooldownHours", "enabled"]);
  for (const k of Object.keys(body)) if (body[k] != null && body[k] !== "" && !allowed.has(k)) throw new Error(`"${k}" doesn't go with the "${body.type}" rule.`);
  const rule = { type: body.type };
  const num = (k, lo, hi, what) => {
    const v = typeof body[k] === "string" && body[k].trim() !== "" ? Number(body[k]) : body[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`${what} must be a number from ${lo} to ${hi}.`);
    return v;
  };
  const has = (k) => body[k] != null && body[k] !== "";
  if (has("id")) { if (!/^[a-f0-9]{10}$/.test(String(body.id))) throw new Error("That rule id isn't valid."); rule.id = String(body.id); }
  if (has("name")) rule.name = clean(body.name, 80);
  if (has("desk")) {
    const d = String(body.desk).trim().toLowerCase();
    if (!/^[a-z0-9-]{1,60}$/.test(d)) throw new Error("A desk name uses letters, numbers and dashes only.");
    if (deskIds && !deskIds.includes(d)) throw new Error(`${d} isn't a desk on the roster.`);
    rule.desk = d;
  }
  if (spec.need.includes("desk") && !rule.desk) throw new Error("Pick which worker this is for.");
  if (spec.need.includes("usd") || has("usd")) {
    if (!has("usd") && spec.need.includes("usd")) throw new Error("Say how many dollars.");
    if (has("usd")) rule.usd = Math.round(num("usd", 0.01, 100000, "Dollars") * 100) / 100;
  }
  if (spec.need.includes("hours") || has("hours")) {
    if (!has("hours")) throw new Error("Say how many hours.");
    rule.hours = Math.round(num("hours", 0.5, 720, "Hours") * 10) / 10;
  }
  if (spec.need.includes("pct")) {
    if (!has("pct")) throw new Error("Say what percent of the cap.");
    rule.pct = Math.round(num("pct", 1, 100, "Percent"));
  }
  if (has("includeSubscription")) {
    if (typeof body.includeSubscription !== "boolean") throw new Error("includeSubscription is true or false.");
    if (body.includeSubscription) rule.includeSubscription = true;
  }
  rule.cooldownHours = has("cooldownHours") ? Math.round(num("cooldownHours", 0.1, 720, "Cooldown hours") * 10) / 10 : DEFAULT_COOLDOWN_H;
  if (body.enabled != null && typeof body.enabled !== "boolean") throw new Error("enabled is true or false.");
  rule.enabled = body.enabled !== false;
  return rule;
}

// ---------- the rules file and the log ----------
export function readRules() {
  const j = readJson(FILE(), { rules: [] });
  return Array.isArray(j.rules) ? j.rules : [];
}
// Add a rule, or replace the one with the same id. Returns the saved rule.
export function saveRule(body, opts = {}) {
  const rule = cleanRule(body, opts), rules = readRules();
  if (rule.id) {
    const i = rules.findIndex((r) => r.id === rule.id);
    if (i < 0) throw new Error("No such rule.");
    rules[i] = { ...rule, createdAt: rules[i].createdAt };
    rule.createdAt = rules[i].createdAt;
  } else {
    if (rules.length >= MAX_RULES) throw new Error(`That's ${MAX_RULES} rules already. Remove one first.`);
    rule.id = newId();
    rule.createdAt = new Date().toISOString();
    rules.push(rule);
  }
  writeJsonAtomic(FILE(), { rules });
  return rule;
}
export function removeRule(id) {
  const rules = readRules(), left = rules.filter((r) => r.id !== id);
  if (left.length === rules.length) throw new Error("No such rule.");
  writeJsonAtomic(FILE(), { rules: left });
  const log = readLog();
  if (log.last[id]) { delete log.last[id]; writeJsonAtomic(LOG(), log); }
  return { removed: id };
}
export function readLog() {
  const j = readJson(LOG(), {});
  return { last: j.last && typeof j.last === "object" ? j.last : {}, log: Array.isArray(j.log) ? j.log : [] };
}
// Rules (each with when it last fired) and the recent firings, newest first.
export function alertsView() {
  const log = readLog();
  return { types: RULE_TYPES, defaultCooldownHours: DEFAULT_COOLDOWN_H, rules: readRules().map((r) => ({ ...r, text: describe(r), lastFiredAt: log.last[r.id] || null })), firings: log.log.slice().reverse() };
}

// ---------- the checks ----------
// Midnight today in the hub's time zone, as ms.
export function dayStartMs(now = Date.now(), tz = hubTz()) {
  const p = partsIn(tz, new Date(now)), first = Date.UTC(p.y, p.m - 1, p.d);
  let t = first;
  for (let i = 0; i < 2; i++) { const q = partsIn(tz, new Date(t)); t -= Date.UTC(q.y, q.m - 1, q.d, q.hh, q.mm) - first; }
  return t;
}
const usd = (n) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
const billed = (rule) => (x) => rule.includeSubscription || x.billing !== "subscription";

// What a rule says right now: [] when it isn't firing, else lines saying who and why.
// ctx: { now (ms), dayStart (ms), rows (spend ledger lines), jobs (agents.js jobs()), events (agent events),
//        forecast (forecast() result), budget (the hub's month budget or null) }
export function evaluate(rule, ctx) {
  const { now } = ctx, rows = ctx.rows || [];
  const sumBy = (since, keep) => {
    const m = {};
    for (const x of rows) {
      const t = Date.parse(x.at);
      if (t >= since && t <= now && Number.isFinite(x.costUsd) && keep(x) && (!rule.desk || x.desk === rule.desk)) m[x.desk || "unassigned"] = (m[x.desk || "unassigned"] || 0) + x.costUsd;
    }
    return m;
  };
  const over = (m, when) => Object.entries(m).filter(([, v]) => v > rule.usd).map(([d, v]) => `${d} spent ${usd(v)} ${when} (limit ${usd(rule.usd)})`);
  switch (rule.type) {
    case "hour_spend": return over(sumBy(now - HOUR, billed(rule)), "in the last hour");
    case "day_spend": return over(sumBy(ctx.dayStart ?? dayStartMs(now), billed(rule)), "today");
    case "job_failed_twice": {
      const by = {};
      for (const j of ctx.jobs || []) if ((j.status === "done" || j.status === "failed") && (!rule.desk || j.desk === rule.desk)) (by[j.desk] ??= []).push(j);
      const out = [];
      for (const [d, list] of Object.entries(by)) {
        list.sort((a, b) => String(b.updatedAt || b.at).localeCompare(String(a.updatedAt || a.at)));
        if (list.length >= 2 && list[0].status === "failed" && list[1].status === "failed") out.push(`${d}: two jobs failed in a row (latest: ${String(list[0].summary || list[0].text || "").split("\n")[0].slice(0, 80)})`);
      }
      return out;
    }
    case "idle_open_job": {
      const last = {};
      for (const e of ctx.events || []) { const t = Date.parse(e.startedAt || e.at); if (e.desk && Number.isFinite(t) && t <= now && !(t < last[e.desk])) last[e.desk] = t; }
      const since = {}; // the latest sign of life per desk with an open job: its newest event, or the job's own newest update
      for (const j of ctx.jobs || []) {
        if ((j.status !== "queued" && j.status !== "taken") || (rule.desk && j.desk !== rule.desk)) continue;
        const t = Math.max(Date.parse(j.updatedAt || j.at) || 0, last[j.desk] || 0);
        since[j.desk] = Math.max(since[j.desk] || 0, t);
      }
      return Object.entries(since).filter(([, t]) => now - t >= rule.hours * HOUR).map(([d, t]) => `${d} has an open job and no steps for ${Math.floor((now - t) / HOUR)} h (limit ${rule.hours} h)`);
    }
    case "desk_projected": {
      const d = (ctx.forecast?.desks || []).find((x) => x.id === rule.desk);
      if (!d || d.cap == null) return [];
      const p = Math.max(d.projected, d.projectedTrend);
      return p > d.cap ? [`${d.id} is heading for ${usd(p)} this month against its ${usd(d.cap)} cap (${usd(d.spent)} so far)`] : [];
    }
    case "desk_cap_pct": {
      const d = (ctx.forecast?.desks || []).find((x) => x.id === rule.desk);
      if (!d || !(d.cap > 0) || d.spent < (d.cap * rule.pct) / 100) return [];
      return [`${d.id} has spent ${usd(d.spent)} this month, ${Math.round((d.spent / d.cap) * 100)}% of its ${usd(d.cap)} cap`];
    }
    case "month_projected": {
      const limit = rule.usd ?? ctx.budget;
      if (limit == null || !ctx.forecast) return [];
      const p = Math.max(ctx.forecast.hub.projected, ctx.forecast.hub.projectedTrend);
      return p > limit ? [`The month is heading for ${usd(p)} against ${usd(limit)} (${usd(ctx.forecast.hub.spent)} so far)`] : [];
    }
    default: return [];
  }
}

// Run every enabled rule once. A rule that fires and is out of its cooldown sends ONE phone alert (notify({title,
// message}) -> promise) and records one event (record({action, summary})), then goes in the log. Returns the firings.
export async function checkAlerts(ctx, { notify, record } = {}) {
  const now = ctx.now ?? Date.now(), log = readLog(), fired = [];
  for (const rule of readRules()) {
    if (rule.enabled === false) continue;
    let hits;
    try { hits = evaluate(rule, { ...ctx, now }); } catch (err) { console.warn(`Alert rule ${rule.id}: ${err.message}`); continue; }
    if (!hits.length) continue;
    const last = Date.parse(log.last[rule.id]);
    // a share-of-cap heads-up is once a month: it stays crossed until the month turns over
    if (rule.type === "desk_cap_pct" && Number.isFinite(last) && ctx.monthStart != null && last >= ctx.monthStart) continue;
    if (Number.isFinite(last) && now - last < (rule.cooldownHours ?? DEFAULT_COOLDOWN_H) * HOUR) continue;
    const title = rule.name || describe(rule), text = hits.slice(0, 5).join("\n") + (hits.length > 5 ? `\n+${hits.length - 5} more` : "");
    log.last[rule.id] = new Date(now).toISOString();
    log.log.push({ at: log.last[rule.id], rule: rule.id, type: rule.type, title: title.slice(0, 120), text: text.slice(0, 600) });
    log.log = log.log.slice(-MAX_LOG);
    writeJsonAtomic(LOG(), log); // before sending, so a crash in the phone call can't make it fire again next tick
    fired.push({ rule: rule.id, title, text });
    try { await notify?.({ title: `Alert: ${title}`.slice(0, 120), message: text }); } catch (err) { console.warn(`Alert ${rule.id}: phone alert failed: ${err.message}`); }
    try { record?.({ action: "alert fired", summary: `${title}: ${hits[0]}`.slice(0, 200) }); } catch {}
  }
  return fired;
}
