// Part of the agents module (src/pipeline/agents.js): the approval line's free cost estimate and its two gates.
// See src/hub/approval.js for the setting. Nothing here calls an AI.
//   jobEstimate(desk, job)      what one job on a desk the hub runs on an API will cost, before it is sent.
//   sessionEstimate(desk, {hours})  what a Claude Code session the hub starts on the subscription will cost, priced as if
//                               it were on the API (the way the plan meter and the spend ledger already count it).
//   apiGate(desk, job)          the one check every hub-run job passes (runJob calls it before the paid call): null to
//                               go ahead, or a hold (the job stays queued, with a note; it shows in Waiting for you).
//   sessionGate(desk, ...)      the same for a session the hub starts by itself (grantAutonomy calls it).
// Sessions the hub does not start (the owner's own Claude Code windows) are never held: the hub can't stop them.
import { costOf, aiSettings, CLAUDE as CLAUDE_ALIAS } from "../ai.js";
import { readRuns } from "../runlog.js";
import { spendSince } from "../spend.js";
import { priceOf } from "../openai-compat.js";
import { config } from "../../config.js";
import { approveLines } from "../../hub/approval.js";
import { ownerId } from "../../hub/settings.js";
import { DIR, addRequest, appendJsonl, clip, deskAsk, deskRoute, readEvents, recordEvent, requests } from "../agents.js";
import path from "node:path";

const tokens = (chars) => Math.ceil(chars / 4); // a rough rule: about 4 characters to a token
const n0 = (n) => Math.round(n).toLocaleString("en-US");
const usdText = (v) => `$${v < 0.01 && v > 0 ? v.toFixed(4) : v < 1 ? v.toFixed(3).replace(/0$/, "") : v.toFixed(2)}`;
export const money = usdText;
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// The name a price is looked up under: gemini-pro / gemini-flash are picked at call time, so price them as the current
// Pro / Flash; a Claude short name goes to its full name; no name means the hub's default model.
function priceName(m) {
  if (!m) return config.model;
  if (CLAUDE_ALIAS[m]) return CLAUDE_ALIAS[m];
  if (m === "gemini-pro") return "gemini-3.1-pro";
  if (m === "gemini-flash") return "gemini-3.8-flash";
  return m;
}

// ---------- API: one job on a desk the hub runs ----------
// Input: the real prompt the desk call sends (its system text, the job with any attached text, and the project pages),
// at about 4 characters a token. Output: the median of the output tokens of the desk's last 10 calls in the AI call log;
// with none yet, 2000 (the hub sets no output limit on these calls, so there is no smaller maximum to use).
export function jobEstimate(desk, job, { calls = null } = {}) {
  if (desk.provider === "local") return { usd: 0, basis: "It runs on a local model on this PC, so it costs nothing.", priceKnown: true, local: true };
  const a = deskAsk(desk, job);
  const inTok = tokens(a.system.length + a.content.length + a.docs.length);
  const past = (calls || readRuns({ kinds: ["ai call"], limit: 3000 })).filter((x) => x.step === `desk_${desk.id}` && Number.isFinite(x.outputTokens)).slice(0, 10);
  const outTok = past.length ? Math.round(median(past.map((x) => x.outputTokens))) : 2000;
  const route = deskRoute(desk), u = { inputTokens: inTok, outputTokens: outTok };
  let model, usd;
  if (route.compat) { model = route.m; usd = priceOf(desk.provider, route.m, u, aiSettings().prices); }
  else { model = priceName(route.model || desk.model); usd = costOf(model, u); }
  const priceKnown = usd !== null && usd !== undefined;
  if (!priceKnown) usd = costOf("claude-opus-5-5", u); // no price on file: shown at the dearest Claude rate, and held
  const where = past.length ? `from its last ${past.length} job${past.length === 1 ? "" : "s"}` : "(no past jobs to go on, so a guess)";
  const basis = `about ${n0(inTok)} tokens in, about ${n0(outTok)} out ${where}, ${priceKnown ? `at ${model} prices` : `but ${model} has no price on file, so it counts as over the line`}.`;
  return { usd: Math.round(usd * 1e6) / 1e6, basis, priceKnown, tokens: { in: inTok, out: outTok }, model };
}

// ---------- subscription: one session the hub starts ----------
// The hub's own sessions are the ones with a "session start" event from the hub's autonomy code; each one's cost is the
// subscription lines the spend ledger booked to its desk between its start and its "session end" (at API prices).
export function hubSessions(events, rows) {
  const out = [];
  for (const s of events) {
    if (s.action !== "session start" || s.source !== "autonomy") continue;
    const start = Date.parse(s.startedAt);
    const end = events.find((e) => e.desk === s.desk && e.action === "session end" && Date.parse(e.startedAt) > start);
    if (!end) continue; // still running, or never reported an end
    const stop = Date.parse(end.startedAt);
    const usd = rows.reduce((t, r) => (r.billing === "subscription" && r.desk === s.desk && Date.parse(r.at) >= start && Date.parse(r.at) <= stop ? t + (Number(r.costUsd) || 0) : t), 0);
    out.push({ desk: s.desk, at: start, hours: Math.max(0.05, (stop - start) / 3600e3), usd });
  }
  return out.sort((a, b) => b.at - a.at);
}
// Pure: the estimate from the sessions the hub has run. The desk's average per session over its last 10 (ignoring ones
// that booked no cost, which mean the hook reported none); else the hub's dollars per hour times the planned hours; else
// nothing to go on (priceKnown false, held).
export function subEstimateFrom(sessions, deskId, hours = 1) {
  const mine = sessions.filter((s) => s.desk === deskId && s.usd > 0).slice(0, 10);
  if (mine.length) {
    const usd = mine.reduce((t, s) => t + s.usd, 0) / mine.length;
    return { usd: Math.round(usd * 100) / 100, basis: `${usdText(usd)} a session on average over ${deskId}'s last ${mine.length} hub-started session${mine.length === 1 ? "" : "s"}, counted at API prices.`, priceKnown: true };
  }
  const all = sessions.filter((s) => s.usd > 0);
  const h = all.reduce((t, s) => t + s.hours, 0);
  if (all.length && h > 0) {
    const perHour = all.reduce((t, s) => t + s.usd, 0) / h, usd = perHour * hours;
    return { usd: Math.round(usd * 100) / 100, basis: `${deskId} has no sessions on record yet, so about ${usdText(perHour)} an hour (the average over ${all.length} hub-started session${all.length === 1 ? "" : "s"}) for ${Math.round(hours * 10) / 10} planned hour${hours === 1 ? "" : "s"}, counted at API prices.`, priceKnown: true };
  }
  return { usd: 0, basis: "The hub has no cost record of any session it started, so it can't say what this one will cost.", priceKnown: false };
}
export function sessionEstimate(desk, { hours = 1, now = new Date() } = {}) {
  const rows = spendSince(now.getTime() - 60 * 86400e3, now).map((r) => (desk.aliases?.includes(r.desk) ? { ...r, desk: desk.id } : r));
  return subEstimateFrom(hubSessions(readEvents(), rows), desk.id, hours);
}

// ---------- the gates ----------
const over = (est, line) => line !== null && (!est.priceKnown || est.usd > line);
const JOBS = () => path.join(DIR(), "jobs.jsonl");
// What to say about a job or session that is over the line.
const whyText = (est, line) => (est.priceKnown ? `about ${usdText(est.usd)}, over your ${usdText(line)} line` : `no price known, so it counts as over your ${usdText(line)} line`);
// The estimate and the line for a job, for the Run now confirm box (no AI call, nothing recorded).
export function jobApproval(desk, job) {
  const line = approveLines().apiUsd, est = jobEstimate(desk, job);
  const approvedUsd = Number.isFinite(job.approvedUsd) ? job.approvedUsd : null;
  const covered = approvedUsd !== null && est.priceKnown && est.usd <= approvedUsd * 1.5;
  return { ...est, line, over: !est.local && over(est, line) && !covered, kind: "api" };
}
// The same for a session, for the confirm box.
export function sessionApprovalFor(desk, hours) {
  const line = approveLines().subUsd, est = sessionEstimate(desk, { hours });
  return { ...est, line, over: over(est, line), kind: "sub" };
}
// The one gate for a job the hub is about to send to an AI. { held: true, ... } or null (go ahead). `approve` is the
// owner's own action (Run now, Push, an approved Waiting for you item): it records the OK on the job and goes ahead.
// A job already approved is not held again unless its estimate grew by more than half since then.
export function apiGate(desk, job, { approve = false } = {}) {
  const line = approveLines().apiUsd;
  if (line === null || desk.provider === "local") return null;
  const a = jobApproval(desk, job);
  if (!a.over) return null;
  const at = new Date().toISOString();
  if (approve) {
    appendJsonl(JOBS(), { id: job.id, at, by: ownerId(), approvedAt: at, approvedUsd: a.usd, held: null });
    recordEvent({ desk: desk.id, room: desk.room, action: "approved to run", summary: clip(`you OK'd it: ${whyText(a, line)}`, 200), job: job.id }, ownerId());
    return null;
  }
  // One note and one event per job, however many times something tries to start it.
  if (!job.held) {
    appendJsonl(JOBS(), { id: job.id, at, by: "hub", held: { at, usd: a.usd, line, basis: a.basis, priceKnown: a.priceKnown } });
    recordEvent({ desk: desk.id, room: desk.room, action: "waiting to run", summary: clip(`waiting for your OK: ${whyText(a, line)}`, 200), job: job.id }, "hub");
  }
  return { held: true, usd: a.usd, line, basis: a.basis, message: `Waiting for your OK: ${whyText(a, line)}. Press Run now (Waiting for you) to approve it, or cancel the job.` };
}
export function heldError(h) {
  const err = new Error(h.message);
  err.held = true;
  return err;
}

// A session the hub starts by itself. `approve` = the owner's own action (the button, an approved Waiting for you item).
// A held session becomes one ask in Waiting for you (kind "ask", with `gate` saying what to start when it is approved).
export function sessionGate(desk, { hours, args, approve = false }) {
  const line = approveLines().subUsd;
  if (line === null || approve) return null;
  const est = sessionEstimate(desk, { hours });
  if (!over(est, line)) return null;
  const dup = requests({ open: true }).find((r) => r.gate?.kind === "session" && r.gate.desk === desk.id);
  if (!dup)
    addRequest({
      kind: "ask", room: desk.room,
      question: `Start a Claude Code session for ${desk.id}? ${whyText(est, line)}`,
      why: `${est.basis} It runs on your subscription, counted at API prices. Approve to start it now; reject to skip it.`,
      gate: { kind: "session", desk: desk.id, usd: est.usd, line, args },
    }, "hub");
  return { held: true, usd: est.usd, line, basis: est.basis, message: `Waiting for your OK: ${whyText(est, line)}. It's in Waiting for you; approve it there to start the session.` };
}
