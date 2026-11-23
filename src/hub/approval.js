// The approval line (the owner 2026-11-17: "an approval need on any new job over cost, API or sub"): a NEW job the hub is
// about to run whose estimated cost is over a set line waits for the owner's OK instead of starting.
//   agents.approveOver = { apiUsd, subUsd }  (US$)
//     apiUsd  per job the hub runs on an API (a desk the hub runs)
//     subUsd  per session the hub itself starts on the Claude subscription (priced as if on the API, like the plan meter)
//   null or a missing field turns that half off. hub.defaults.json: $0.25 and $3; hub.owner.json or data/hub-settings.json
//   (written from Admin) win. Lowering a line or turning it on needs nothing; RAISING one or turning it OFF needs the
//   dashboard password when one is set (the same rule as the AI helpers' daily limit).
//   Tests: HUB_APPROVE_API / HUB_APPROVE_SUB = <number> | none win over the settings files.
// This is an extra gate. It never replaces or loosens the monthly caps, the priced-models rule, the auto-run and hourly
// limits or the helpers' limit. It only covers what the hub starts: the owner's own Claude Code windows can't be held.
import fs from "node:fs";
import path from "node:path";
import { hubSettings, isDemo, resetHubSettings, settingsRoot } from "./settings.js";

// null (off) for a missing, null, empty or "none" value or anything that isn't a non-negative number.
const clean = (v) => (v === null || v === undefined || v === "" || v === "none" || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v));

export function approveLines() {
  const a = hubSettings().agents?.approveOver || {};
  let apiUsd = clean(a.apiUsd), subUsd = clean(a.subUsd);
  const ea = process.env.HUB_APPROVE_API, es = process.env.HUB_APPROVE_SUB;
  if (ea !== undefined) apiUsd = clean(ea);
  if (es !== undefined) subUsd = clean(es);
  return { apiUsd, subUsd };
}

export const approveStatus = () => ({ ...approveLines(), demo: isDemo() });

// Save from Admin. `confirmed` = the dashboard password was confirmed for this request. Returns { status, body }.
export function saveApproveLines(body = {}, confirmed = false) {
  if (isDemo()) return { status: 403, body: { error: "This is a demo: nothing runs here." } };
  const cur = approveLines(), next = { ...cur };
  for (const k of ["apiUsd", "subUsd"]) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v === null || v === "") next[k] = null;
    else if (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100000) next[k] = Math.round(Number(v) * 100) / 100;
    else return { status: 400, body: { error: "A line must be a number of dollars, or empty to turn it off." } };
  }
  // Raising a line, or turning one off, lets the hub spend more without asking.
  const raises = (a, b) => (b === null && a !== null) || (a !== null && b !== null && b > a);
  if ((raises(cur.apiUsd, next.apiUsd) || raises(cur.subUsd, next.subUsd)) && !confirmed) return { status: 403, body: { error: "Enter your password to do this.", needPassword: true } };
  const file = path.join(settingsRoot(), "data", "hub-settings.json");
  let s = {};
  try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  s.agents = { ...(s.agents || {}), approveOver: { apiUsd: next.apiUsd, subUsd: next.subUsd } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
  resetHubSettings();
  return { status: 200, body: approveStatus() };
}
