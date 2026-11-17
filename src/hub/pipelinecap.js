// An optional monthly cap on the pipeline's own AI spend (settings' pipeline.capUsdMonth). The pipeline's model calls are
// booked to the desk "hub-pipeline" (spend.js deskOfCall), which has no row on the roster and so no desk cap of its own.
// null (the default) = no cap. With a number set, a pipeline call made after this month's spend reached it stops with a
// Hold, so the job shows as held (not failed) and carries on when the owner continues it or the month turns.
//   Raising the cap (a bigger number, or none) needs the dashboard password; lowering it or setting 0 does not
//   (the same rule as the AI helpers' daily limit, helpers.js).
//   Which calls count: every call booked to "hub-pipeline" (all the hub's model calls except HR's reviews and the
//   hub-run desks' jobs, which have their own caps).
import fs from "node:fs";
import path from "node:path";
import { hubSettings, isDemo, resetHubSettings, settingsRoot } from "./settings.js";
import { spendThisMonth, deskOfCall } from "../pipeline/spend.js";
import { Hold } from "../pipeline/util.js";

export const PIPELINE_DESK = "hub-pipeline";

const clean = (v) => (v === null || v === undefined || v === "" || v === "none" ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);

export const pipelineCapUsd = () => clean(hubSettings().pipeline?.capUsdMonth);

// What the pipeline has spent this month on the hub's own meter (a subscription-billed call costs no dollars).
export function pipelineSpendMonth(now = new Date()) {
  const rows = spendThisMonth(now).filter((r) => r.desk === PIPELINE_DESK && r.billing !== "subscription");
  return Math.round(rows.reduce((t, r) => t + (Number(r.costUsd) || 0), 0) * 1e6) / 1e6;
}

export function pipelineCapStatus(now = new Date()) {
  const capUsdMonth = pipelineCapUsd();
  const spentMonth = pipelineSpendMonth(now);
  return { capUsdMonth, spentMonth, used: capUsdMonth !== null && spentMonth >= capUsdMonth, demo: isDemo() };
}

// Called before a model call for the step `name`. Throws a Hold when the step is the pipeline's and the cap is used up.
export function assertPipelineBudget(name, now = new Date()) {
  if (deskOfCall(name) !== PIPELINE_DESK) return;
  const cap = pipelineCapUsd();
  if (cap === null) return;
  const spent = pipelineSpendMonth(now);
  if (spent < cap) return;
  const err = new Hold(`The pipeline AI budget for this month is used up ($${spent.toFixed(2)} of $${cap.toFixed(2)}). Raise it in Admin (Pipeline AI budget), or continue this job next month.`);
  err.pipelineBudget = true;
  throw err;
}

// Save from Admin. `confirmed` = the dashboard password was confirmed for this request. Returns { status, body }.
export function savePipelineCap(body = {}, confirmed = false) {
  if (isDemo()) return { status: 403, body: { error: "This is a demo: nothing runs here." } };
  const cur = pipelineCapUsd();
  let next = cur;
  if ("capUsdMonth" in body) {
    const v = body.capUsdMonth;
    if (v === null || v === "") next = null;
    else if (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1000000) next = Math.round(Number(v) * 100) / 100;
    else return { status: 400, body: { error: "The monthly budget must be a number of dollars, or empty for none." } };
  }
  const raises = (next === null && cur !== null) || (next !== null && cur !== null && next > cur);
  if (raises && !confirmed) return { status: 403, body: { error: "Enter your password to do this.", needPassword: true } };
  const file = path.join(settingsRoot(), "data", "hub-settings.json");
  let s = {};
  try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  s.pipeline = { ...(s.pipeline || {}), capUsdMonth: next };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
  resetHubSettings();
  return { status: 200, body: pipelineCapStatus() };
}
