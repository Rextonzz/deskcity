// AI helpers (off until the owner switches them on in Admin). A helper is anything of the hub's own that calls an AI
// provider without the owner pressing a button for that one call: HR, the shared assistant, worker chatter and store
// ideas, growing personalities, and a worker starting a job by itself. With the switch off none of them reaches a
// provider, even when keys are present. A job the owner runs himself is not a helper.
//   Settings: agents.helpers = { on, perDayUsd }  (hub.defaults.json: off, $1 a day; hub.owner.json can say otherwise;
//   data/hub-settings.json, written from Admin, wins over both). perDayUsd null = no daily limit.
//   Tests: HUB_HELPERS=on|off and HUB_HELPERS_PER_DAY=<number>|none win over the settings files.
import fs from "node:fs";
import path from "node:path";
import { hubSettings, isDemo, resetHubSettings, settingsRoot } from "./settings.js";
import { spendSince } from "../pipeline/spend.js";
import { dayStartMs } from "../pipeline/alerts.js";
import { recordEvent, readEvents } from "../pipeline/agents.js";

// The step names (the `name:` of askJSON / askAs) that helper calls book to in the spend ledger.
//   hr_review         src/pipeline/hr.js (team jobs, requests, store ideas, job scores) and the judge in agents/quality.js
//   campus_chatter    src/pipeline/agents.js (chatter)
//   campus_store_idea src/pipeline/agents/campus.js (suggestStoreItem)
//   campus_self       src/pipeline/agents/selves.js (growSelves; SELF_STEP)
//   desk_assistant    src/pipeline/agents/assistant.js (askDeskModel for the shared assistant: second opinions, PR code
//                     reviews, first briefs). The security reviewer's desk_<id> step is not listed (its id is the owner's).
//   campus_short_topic, campus_short_reaction   src/pipeline/agents/campus.js (watchShort, from the shop timer)
//   campus_experience src/pipeline/agents/experiences.js (runExperience, from the shop timer)
export const HELPER_STEPS = ["hr_review", "campus_chatter", "campus_store_idea", "campus_self", "desk_assistant", "campus_short_topic", "campus_short_reaction", "campus_experience"];

const DEFAULT_PER_DAY = 1;
const cleanLimit = (v) => (v === null || v === "none" ? null : v !== "" && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : DEFAULT_PER_DAY);

export function helperSettings() {
  if (isDemo()) return { on: false, perDayUsd: DEFAULT_PER_DAY };
  const h = hubSettings().agents?.helpers || {};
  let on = h.on === true;
  let perDayUsd = "perDayUsd" in h ? cleanLimit(h.perDayUsd) : DEFAULT_PER_DAY;
  const e = process.env.HUB_HELPERS;
  if (e === "on" || e === "off") on = e === "on";
  const l = process.env.HUB_HELPERS_PER_DAY;
  if (l !== undefined) perDayUsd = cleanLimit(l);
  return { on, perDayUsd };
}

// A step name can carry a suffix ("hr_review_1", "plan-<channel>"), so a listed name also matches its suffixed forms.
export const isHelperStep = (step) => HELPER_STEPS.some((s) => step === s || String(step || "").startsWith(`${s}_`) || String(step || "").startsWith(`${s}-`));

// What the helpers spent today (the hub's day), in dollars, from the spend ledger.
export function helperSpendToday(now = new Date()) {
  const rows = spendSince(dayStartMs(now.getTime()), now).filter((r) => isHelperStep(r.step));
  return Math.round(rows.reduce((t, r) => t + (Number(r.costUsd) || 0), 0) * 1e6) / 1e6;
}

let pausedDay = null;
// One "helpers paused" event a day, however many helpers run into the limit (and across restarts).
function notePaused(now, perDayUsd) {
  const start = dayStartMs(now.getTime());
  if (pausedDay === start) return;
  pausedDay = start;
  try {
    if (readEvents().slice(-400).some((e) => e.action === "helpers paused" && Date.parse(e.at) >= start)) return;
    recordEvent({ desk: "hub", room: "hub", action: "helpers paused", summary: `AI helpers reached today's limit of $${perDayUsd}` }, "hub");
  } catch {}
}

// May this kind of helper run now? { ok: true } or { ok: false, why: "off" | "limit" }.
export function helperMay(kind, now = new Date()) {
  const s = helperSettings();
  if (!s.on) return { ok: false, why: "off" };
  if (typeof s.perDayUsd === "number" && helperSpendToday(now) >= s.perDayUsd) {
    notePaused(now, s.perDayUsd);
    return { ok: false, why: "limit" };
  }
  return { ok: true };
}
export const helperWhy = (m) => (m.why === "limit" ? "AI helpers reached today's limit (Admin > AI helpers)" : "AI helpers are off (Admin > AI helpers)");

// Admin card: the switch, the limit and today's spend.
export function helperStatus(now = new Date()) {
  const s = helperSettings();
  return { on: s.on, perDayUsd: s.perDayUsd, spentToday: helperSpendToday(now), demo: isDemo() };
}

// Save from Admin. `confirmed` = the dashboard password was confirmed for this request. Turning ON or raising the limit
// (a bigger number, or no limit) needs it; turning OFF or lowering the limit does not. Returns { status, body }.
export function saveHelperSettings(body = {}, confirmed = false) {
  if (isDemo()) return { status: 403, body: { error: "This is a demo: nothing runs here." } };
  const cur = helperSettings();
  const on = typeof body.on === "boolean" ? body.on : cur.on;
  let perDayUsd = cur.perDayUsd;
  if ("perDayUsd" in body) {
    const v = body.perDayUsd;
    if (v === null || v === "") perDayUsd = null;
    else if (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100000) perDayUsd = Math.round(Number(v) * 100) / 100;
    else return { status: 400, body: { error: "The daily limit must be a number of dollars, or empty for no limit." } };
  }
  const raisesLimit = (perDayUsd === null && cur.perDayUsd !== null) || (perDayUsd !== null && cur.perDayUsd !== null && perDayUsd > cur.perDayUsd);
  if (((on && !cur.on) || raisesLimit) && !confirmed) return { status: 403, body: { error: "Enter your password to do this.", needPassword: true } };
  const file = path.join(settingsRoot(), "data", "hub-settings.json");
  let s = {};
  try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  s.agents = { ...(s.agents || {}), helpers: { on, perDayUsd } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
  resetHubSettings();
  return { status: 200, body: helperStatus() };
}
