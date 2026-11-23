// What the hub may start by itself (the owner 2026-11-20: "loosen the approval limits for pushing jobs and allow auto push",
// option 1), set on the Admin page:
//   agents.autoRun.perDay   paid jobs a worker's own output starts in a day (agents.js mayAutoRun); null = no limit
//   agents.autoPush         { on, atOnce, perDay }: queued jobs for workers on this PC get their Claude Code session
//                           started by the hub, like tapping Push (agents/autonomy.js autoPushTick); at most atOnce
//                           sessions running and perDay started a day. Off by default.
// Loosening anything (a higher number, no limit, turning auto-push on) needs the dashboard password when one is set; a
// tighter setting doesn't (the approval line's rule, approval.js). The monthly caps, plan shares, Claude's usage limit
// and the approval line still apply to everything started here.
import fs from "node:fs";
import path from "node:path";
import { hubSettings, isDemo, resetHubSettings, settingsRoot } from "./settings.js";

export const AUTOPUSH_DEFAULTS = { on: false, atOnce: 1, perDay: 6 };
const count = (v, d, max) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= max ? Math.floor(n) : d; };

export function runLimits(s = hubSettings()) {
  const ar = s.agents?.autoRun, ap = s.agents?.autoPush || {};
  const perDay = ar && "perDay" in ar ? (ar.perDay === null ? null : count(ar.perDay, 0, 1000)) : 0;
  return {
    autoRunPerDay: perDay,
    autoPush: { on: ap.on === true, atOnce: Math.max(1, count(ap.atOnce, AUTOPUSH_DEFAULTS.atOnce, 5)), perDay: count(ap.perDay, AUTOPUSH_DEFAULTS.perDay, 100) },
  };
}
export const runLimitsStatus = () => ({ ...runLimits(), demo: isDemo() });

// Save from Admin. body: { autoRunPerDay?, autoPush?: { on?, atOnce?, perDay? } }. confirmed = password confirmed.
export function saveRunLimits(body = {}, confirmed = false) {
  if (isDemo()) return { status: 403, body: { error: "This is a demo: nothing runs here." } };
  const cur = runLimits(), next = { autoRunPerDay: cur.autoRunPerDay, autoPush: { ...cur.autoPush } };
  const bad = (msg) => ({ status: 400, body: { error: msg } });
  if ("autoRunPerDay" in body) {
    const v = body.autoRunPerDay;
    if (v === null || v === "") next.autoRunPerDay = null;
    else if (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 1000) next.autoRunPerDay = Number(v);
    else return bad("Auto-runs a day must be a whole number from 0 to 1000, or empty for no limit.");
  }
  const ap = body.autoPush || {};
  if ("on" in ap) next.autoPush.on = ap.on === true;
  if ("atOnce" in ap) { const n = Number(ap.atOnce); if (!Number.isInteger(n) || n < 1 || n > 5) return bad("Sessions at once must be 1 to 5."); next.autoPush.atOnce = n; }
  if ("perDay" in ap) { const n = Number(ap.perDay); if (!Number.isInteger(n) || n < 0 || n > 100) return bad("Auto-pushes a day must be 0 to 100."); next.autoPush.perDay = n; }
  const more = (a, b) => (b === null && a !== null) || (a !== null && b !== null && b > a);
  const loosens = more(cur.autoRunPerDay, next.autoRunPerDay) || (!cur.autoPush.on && next.autoPush.on) || next.autoPush.atOnce > cur.autoPush.atOnce || next.autoPush.perDay > cur.autoPush.perDay;
  if (loosens && !confirmed) return { status: 403, body: { error: "Enter your password to do this.", needPassword: true } };
  const file = path.join(settingsRoot(), "data", "hub-settings.json");
  let s = {};
  try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  s.agents = { ...(s.agents || {}), autoRun: { ...(s.agents?.autoRun || {}), perDay: next.autoRunPerDay }, autoPush: next.autoPush };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
  resetHubSettings();
  return { status: 200, body: runLimitsStatus() };
}
