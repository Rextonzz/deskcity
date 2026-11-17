// Part of the agents module (src/pipeline/agents.js): quality checks (the owner 2026-11-14, "good to go on 5": evals, and
// "the new pay standard determiner"). Four pieces:
//   1. A judge score per finished job, 0-100 plus a one-line why. HR's batched job check (hr.js) gives it, from the job's
//      task and its saved result (data/agents/outputs), so there's no extra AI call per job. The owner's 👍 / 👎 is an
//      override: 👍 = at least 80, 👎 = at most 20. A lead's thumb counts the same way unless the owner rated it.
//      Pay for a finished job slides with that score (payFor), 4 to 16 credits around the old flat 10.
//   2. Sample sets: each desk's best-scored past jobs (score 60+, with a saved result, up to SAMPLE_MAX) are its taste test.
//   3. Quality check runs: re-run N samples on a candidate model or brief, the same judge compares old and new, and the
//      run reports average scores, cost per job and a plain verdict. Spends real API money: a cap per run, the cost
//      shown first (estimateRun), and the dashboard password on the route.
//   4. Brief versions: every change to a desk's brief, model, provider or effort is kept (saveDesk calls noteVersion),
//      with who, when and the average score of the jobs that followed; compare, roll back.
// Stored in data/agents: scores.json, brief-versions.jsonl, quality/runs.json and quality/<run>/<job>.md (new results).
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJsonAtomic, readJsonl, appendJsonl, newId, isId, resolvePath } from "../util.js";
import { readRuns } from "../runlog.js";
import { costOf, aiSettings, hasGemini } from "../ai.js";
import { config } from "../../config.js";
import { askAs, askJSON, obj, str, num, arr } from "../claude.js";
import { isCompat, compatReady, providerConfig } from "../openai-compat.js";
import { ownerName as OWNER, ownerId } from "../../hub/settings.js";
import { DIR, clip, slug, jobs, roster, saveDesk, deskAsk, deskRoute, recordEvent } from "../agents.js";
import { jobRatings } from "./campus.js";

// ---------- 1. scores and pay ----------
export const PAY_SCALE = { min: 4, max: 16, unscored: 10 };
// 0 -> 4, 50 -> 10 (the old flat rate), 78 -> 13, 100 -> 16. No score yet -> 10, so nothing changes until a job is judged.
export const payFor = (score) => (score == null ? PAY_SCALE.unscored : Math.round(PAY_SCALE.min + ((PAY_SCALE.max - PAY_SCALE.min) * Math.max(0, Math.min(100, score))) / 100));
const SCORES = () => path.join(DIR(), "scores.json");
export function jobScores() {
  return readJson(SCORES(), {}) || {};
}
export function setJobScore(id, score, { by = "hr", why = null, model = null } = {}) {
  if (!isId(id)) throw new Error("Unknown job.");
  const s = Number(score);
  if (!Number.isFinite(s)) throw new Error("A score is a number from 0 to 100.");
  const all = jobScores();
  all[id] = { score: Math.round(Math.max(0, Math.min(100, s))), by: slug(by) || "hr", at: new Date().toISOString(), ...(why ? { why: clip(why, 200) } : {}), ...(model ? { model: clip(model, 60) } : {}) };
  writeJsonAtomic(SCORES(), all);
  return { id, ...all[id] };
}
// The score that counts for pay and samples, and where it came from:
//   owner thumb (👍 >= 80, 👎 <= 20) > a lead's thumb (same) > the judge's score > an old HR thumb from before scores.
export function scoreOf(id, rates = jobRatings(), scores = jobScores()) {
  const r = rates[id], s = scores[id];
  const thumb = (x) => (x.r === "up" ? Math.max(s?.score ?? 80, 80) : Math.min(s?.score ?? 20, 20));
  if (r && r.by !== "hr" && (r.r === "up" || r.r === "down")) return { score: thumb(r), from: r.by === ownerId() ? "owner" : "lead", why: r.why || s?.why || null, judged: s?.score ?? null };
  if (s) return { score: s.score, from: "judge", why: s.why || null, judged: s.score };
  if (r && (r.r === "up" || r.r === "down")) return { score: r.r === "up" ? 80 : 20, from: "old thumb", why: r.why || null, judged: null };
  return { score: null, from: null, why: null, judged: null };
}
// Which job a "job done" event was: the event's own job id (since 2026-11-14), else the closest finished job of that
// desk within two minutes (older events). Each job is matched once.
export function eventJobMatcher(all = jobs()) {
  const done = {};
  for (const j of all) if (j.status === "done") (done[j.desk] ??= []).push(j);
  const used = new Set();
  return (e) => {
    if (e.job && isId(e.job)) { used.add(e.job); return e.job; }
    const t = Date.parse(e.startedAt);
    let best = null, gap = 120e3;
    for (const j of done[e.desk] || []) {
      if (used.has(j.id)) continue;
      const g = Math.abs(Date.parse(j.updatedAt) - t);
      if (g <= gap) { best = j; gap = g; }
    }
    if (best) used.add(best.id);
    return best?.id || null;
  };
}
// Jobs HR should score next: finished with a saved result, not scored yet, done 10 minutes to 3 days ago.
export function scoreCandidates(now = Date.now()) {
  const scores = jobScores();
  return jobs().filter((j) => {
    if (j.status !== "done" || !j.output || scores[j.id]) return false;
    const age = now - Date.parse(j.updatedAt);
    if (!(age > 10 * 60e3 && age < 3 * 864e5)) return false;
    try { return fs.statSync(outPath(j.output)).size >= 200; } catch { return false; }
  });
}
const outPath = (rel) => resolvePath(rel);
function readOutput(j, n = 1800) {
  try { return fs.readFileSync(outPath(j.output), "utf8").slice(0, n); } catch { return ""; }
}
// HR's job check (hr.js): one call for a batch, a score and a why for each. Kept here so the judge's wording lives with
// the rest of the quality checks.
export const JUDGE_SCALE = `Score 0-100: 90+ = ${OWNER()} could use it as is; 70-89 = good, small fixes; 50-69 = usable with real work; 30-49 = shallow or partly wrong; under 30 = filler, generic advice, restating the task, or "I can't do this".`;
export const SCORE_SCHEMA = obj({ ratings: arr(obj({ job: str, score: num, why: str })) });
export function scoreBatchContent(list) {
  return list.map((j) => `### job ${j.id} (${j.desk})\nTask: ${String(j.text).slice(0, 400)}\nResult:\n${readOutput(j)}`).join("\n\n");
}
// Per desk: its average score over the last 30 days (or its last 20 scored jobs if none that recent), the pay that
// average earns per job, and how many jobs are in its taste-test set.
export function deskQuality(all = jobs(), rates = jobRatings(), scores = jobScores(), now = Date.now()) {
  const by = {};
  for (const j of all) {
    if (j.status !== "done") continue;
    const s = scoreOf(j.id, rates, scores);
    if (s.score == null) continue;
    (by[j.desk] ??= []).push({ j, s });
  }
  const out = {};
  for (const [desk, list] of Object.entries(by)) {
    list.sort((a, b) => String(b.j.updatedAt).localeCompare(String(a.j.updatedAt)));
    const recent = list.filter((x) => now - Date.parse(x.j.updatedAt) < 30 * 864e5);
    const use = recent.length ? recent : list.slice(0, 20);
    const avg = Math.round(use.reduce((a, x) => a + x.s.score, 0) / use.length);
    out[desk] = { score: avg, n: use.length, pay: payFor(avg), samples: sampleSet(desk, { all, rates, scores }).length };
  }
  return out;
}
// For the Agents page and the campus: per desk, and the score of each recent job.
export function qualitySummary() {
  const all = jobs(), rates = jobRatings(), scores = jobScores();
  const recent = all.filter((j) => j.status === "done" && Date.now() - Date.parse(j.updatedAt) < 14 * 864e5);
  const jobsOut = {};
  for (const j of recent) { const s = scoreOf(j.id, rates, scores); if (s.score != null) jobsOut[j.id] = { score: s.score, from: s.from, why: s.why, pay: payFor(s.score) }; }
  return { scale: PAY_SCALE, desks: deskQuality(all, rates, scores), jobs: jobsOut };
}

// ---------- 2. sample sets ----------
export const SAMPLE_MAX = 20, SAMPLE_FLOOR = 60;
export function sampleSet(desk, { all = jobs(), rates = jobRatings(), scores = jobScores() } = {}) {
  return all
    .filter((j) => j.desk === desk && j.status === "done" && j.output && readOutput(j, 10).length)
    .map((j) => ({ job: j, ...scoreOf(j.id, rates, scores) }))
    .filter((x) => x.score != null && x.score >= SAMPLE_FLOOR)
    .sort((a, b) => b.score - a.score || String(b.job.updatedAt).localeCompare(String(a.job.updatedAt)))
    .slice(0, SAMPLE_MAX);
}

// ---------- 3. quality check runs ----------
export const QUALITY = { capUsd: 1, maxSamples: 10, defaultSamples: 5 };
const QDIR = () => path.join(DIR(), "quality");
const RUNS = () => path.join(QDIR(), "runs.json");
const RUNS_KEEP = 60;
let active = null; // the run going now (one at a time, so its cost can be read from the AI call log)
function readRunsFile() {
  const list = readJson(RUNS(), []) || [];
  // a run cut short by a hub restart
  for (const r of list) if (r.status === "running" && r.id !== active) { r.status = "stopped"; r.error = "The hub restarted while it ran."; }
  return list;
}
function saveRun(run) {
  fs.mkdirSync(QDIR(), { recursive: true });
  const list = readRunsFile().filter((r) => r.id !== run.id);
  writeJsonAtomic(RUNS(), [run, ...list].slice(0, RUNS_KEEP));
}
export function qualityRuns({ desk = null } = {}) {
  return readRunsFile().filter((r) => !desk || r.desk === desk);
}
const CLAUDE_ALIAS = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" };
// The name to look a price up under (gemini-pro / -flash are picked at call time; price them as current Pro / Flash).
function priceName(m) {
  if (!m) return config.model;
  if (CLAUDE_ALIAS[m]) return CLAUDE_ALIAS[m];
  if (m === "gemini-pro") return "gemini-3.1-pro";
  if (m === "gemini-flash") return "gemini-3.8-flash";
  return m;
}
const tokens = (chars) => Math.ceil(chars / 4);
// A desk as the candidate would be: model, brief and effort swapped in; the provider follows the model's name.
function candidateDesk(desk, c = {}) {
  const model = clip(c.model, 60) || desk.model;
  let provider = desk.provider;
  if (c.provider && c.provider !== desk.provider) provider = slug(c.provider);
  else if (model !== desk.model) provider = /^(claude-|haiku$|sonnet$|opus$)/.test(model) ? "claude" : /gemini|argon/i.test(model) ? "gemini" : provider;
  const effort = ["low", "medium", "high"].includes(c.effort) ? c.effort : desk.effort;
  const brief = c.brief == null ? desk.brief : clip(c.brief, 1000);
  return { ...desk, model, provider, effort, brief };
}
// What one past job cost on the desk's own model: its AI calls between taken and done (like the thrift bonus).
function jobCost(j, calls) {
  const doneAt = Date.parse(j.updatedAt), takenAt = Date.parse((j.history || []).find((h) => h.status === "taken")?.at || j.at);
  const c = calls.filter((x) => x.step === `desk_${j.desk}` && Date.parse(x.startedAt) >= takenAt - 5000 && Date.parse(x.startedAt) <= doneAt + 5000);
  return c.length ? c.reduce((a, x) => a + (x.costUsd || 0), 0) : null;
}
function planRun(body = {}) {
  const desk = roster().desks.find((d) => d.id === slug(body.desk));
  if (!desk) throw new Error("No such desk.");
  const cand = candidateDesk(desk, body);
  const n = Math.max(1, Math.min(QUALITY.maxSamples, Math.round(Number(body.n) || QUALITY.defaultSamples)));
  const samples = sampleSet(desk.id).slice(0, n);
  if (!samples.length) throw new Error(`${desk.id} has no scored jobs with a saved result yet (score ${SAMPLE_FLOOR}+), so there's nothing to taste-test.`);
  const route = deskRoute(cand);
  const callName = cand.provider === "local" || isCompat(cand.provider) ? cand.model : priceName(route.model || cand.model);
  const judgeModel = priceName(aiSettings().steps?.hr_review?.model);
  let est = 0, priceKnown = true;
  const price = (model, u) => {
    const c = costOf(model, u);
    if (c != null) return c;
    if (cand.provider === "local") return 0;
    priceKnown = false;
    return costOf("claude-opus-5-5", u); // no price on file: count it as the dearest Claude, to be safe
  };
  for (const s of samples) {
    const a = deskAsk(cand, s.job);
    est += price(callName, { inputTokens: tokens(a.system.length + a.content.length + a.docs.length), outputTokens: Math.max(800, tokens(readOutput(s.job, 20000).length) + 200) });
  }
  est += price(judgeModel, { inputTokens: 600 + samples.length * tokens(400 + 2 * 1800 + 200), outputTokens: 80 * samples.length });
  return { desk, cand, n: samples.length, samples, model: callName, judgeModel, estimateUsd: Number(est.toFixed(4)), priceKnown, capUsd: QUALITY.capUsd };
}
// The cost before anything runs (free: no AI call).
export function estimateRun(body = {}) {
  const p = planRun(body);
  return {
    desk: p.desk.id,
    n: p.n,
    asked: Math.round(Number(body.n) || QUALITY.defaultSamples),
    candidate: { model: p.cand.model, provider: p.cand.provider, effort: p.cand.effort, briefChanged: p.cand.brief !== p.desk.brief },
    pricedAs: p.model,
    judge: p.judgeModel,
    estimateUsd: p.estimateUsd,
    priceKnown: p.priceKnown,
    capUsd: p.capUsd,
    overCap: p.estimateUsd > p.capUsd,
    samples: p.samples.map((s) => ({ job: s.job.id, score: s.score, task: clip(String(s.job.text).split("\n")[0], 100) })),
  };
}
const fraction = (c) => {
  const words = [[1 / 2, "half"], [1 / 3, "a third of"], [1 / 4, "a quarter of"], [1 / 5, "a fifth of"], [1 / 10, "a tenth of"]];
  for (const [v, w] of words) if (Math.abs(c - v) / v < 0.08) return `${w} the cost`;
  if (c < 0.97) return `${Math.max(1, Math.round(c * 100))}% of the cost`;
  if (c <= 1.03) return "the same cost";
  return `${c < 10 ? c.toFixed(1) : Math.round(c)}× the cost`;
};
export function verdictOf({ oldAvg, newAvg, oldCost, newCost }) {
  const q = oldAvg > 0 ? Math.round((newAvg / oldAvg) * 100) : null;
  const c = oldCost > 0 && newCost != null ? newCost / oldCost : null;
  const line = `${q == null ? `New average ${newAvg}` : `${q}% of the quality`}${c == null ? "" : ` at ${fraction(c)}`}`;
  const advice =
    q == null ? "Not enough to compare."
      : q >= 100 && (c == null || c <= 1.03) ? "Better or equal and no dearer: worth switching."
        : q >= 90 && c != null && c < 0.97 ? "Nearly as good and cheaper: worth switching."
          : q >= 100 ? "Better, but dearer: your call."
            : q < 80 ? "Clearly worse: keep the current setup."
              : "A bit worse: keep the current setup unless the saving matters.";
  return { quality: q, costRatio: c == null ? null : Number(c.toFixed(3)), line, advice };
}
const JUDGE_SYSTEM = `You are HR for ${OWNER()}'s AI staff, comparing two answers to the same job: A and B, in random order. Judge each on its own merits for that task: would ${OWNER()} act on it, is it concrete, specific and correct-looking? ${JUDGE_SCALE} Give a score for A and for B, and why in one short line (what makes one better, or "about the same"). Answer for every job id given.`;
const JUDGE_SCHEMA = obj({ pairs: arr(obj({ job: str, a: num, b: num, why: str })) });
// Starts a run in the background and returns it at once (status "running"); the page asks for it again to see it end.
// body.okUsd: the cost the owner saw and agreed to; a run whose estimate went up past it doesn't start.
export function startRun(body = {}, by = ownerId()) {
  if (active) throw new Error("A quality check is already running. Wait for it to finish.");
  const p = planRun(body);
  if (p.estimateUsd > p.capUsd) throw new Error(`That would cost about $${p.estimateUsd.toFixed(2)}, over the $${p.capUsd.toFixed(2)} cap for one quality check. Use fewer samples.`);
  const ok = Number(body.okUsd);
  if (!Number.isFinite(ok) || p.estimateUsd > ok * 1.1 + 0.001) throw new Error(`The cost is now about $${p.estimateUsd.toFixed(2)}. Check the cost again before running.`);
  const { m, compat, gem } = deskRoute(p.cand);
  if (compat && !compatReady(p.cand.provider)) throw new Error(`The hub has no ${providerConfig(p.cand.provider).label} key.`);
  if (gem && !hasGemini()) throw new Error("The hub has no Gemini key (GEMINI_API_KEY in .env).");
  const run = {
    id: newId(),
    desk: p.desk.id,
    by: slug(by) || ownerId(),
    at: new Date().toISOString(),
    status: "running",
    n: p.n,
    current: { model: p.desk.model, provider: p.desk.provider, effort: p.desk.effort, brief: p.desk.brief },
    candidate: { model: p.cand.model, provider: p.cand.provider, effort: p.cand.effort, brief: p.cand.brief },
    estimateUsd: p.estimateUsd,
    capUsd: p.capUsd,
    done: 0,
    results: [],
  };
  active = run.id;
  saveRun(run);
  const finished = execute(run, p).catch((err) => {
    run.status = "failed";
    run.error = clip(err.message, 300);
    saveRun(run);
  }).finally(() => { active = null; });
  // tests wait on it; the route doesn't
  Object.defineProperty(run, "finished", { value: finished, enumerable: false });
  return run;
}
async function execute(run, p) {
  const { m, compat, model } = deskRoute(p.cand);
  const calls0 = readRuns({ kinds: ["ai call"], limit: 5000 });
  const dir = path.join(QDIR(), run.id);
  fs.mkdirSync(dir, { recursive: true });
  const outs = [];
  for (const s of p.samples) {
    const a = deskAsk(p.cand, s.job);
    const ans = await askAs({ name: `quality_${p.desk.id}`, model, provider: compat ? p.cand.provider : undefined, effort: p.cand.effort || "medium", system: a.system, content: `${a.content}${a.docs}`, schema: obj({ summary: str, output: str }) });
    const text = String(ans?.output || "");
    fs.writeFileSync(path.join(dir, `${s.job.id}.md`), `# ${p.desk.id} on ${p.cand.model} (quality check ${run.id})\n\n${text}\n`);
    outs.push({ s, text });
    run.done = outs.length;
    // stop if what it really spent is already past the cap
    const spent = spentSince(run.at, `quality_${p.desk.id}`);
    if (spent > p.capUsd) throw new Error(`Stopped after ${outs.length} of ${p.n}: it had spent $${spent.toFixed(2)}, past the $${p.capUsd.toFixed(2)} cap.`);
    saveRun(run);
  }
  // one judge call for all of them, old and new in random order so the position doesn't decide
  const flip = outs.map(() => Math.random() < 0.5);
  const content = outs.map(({ s, text }, i) => {
    const old = readOutput(s.job), neu = text.slice(0, 1800);
    const [A, B] = flip[i] ? [neu, old] : [old, neu];
    return `### job ${s.job.id}\nTask: ${String(s.job.text).slice(0, 400)}\n\nAnswer A:\n${A}\n\nAnswer B:\n${B}`;
  }).join("\n\n");
  const judgeAt = new Date().toISOString();
  const j = await askJSON({ name: "hr_review", system: JUDGE_SYSTEM, content, schema: JUDGE_SCHEMA, effort: "low" });
  const calls = readRuns({ kinds: ["ai call"], limit: 5000 });
  run.results = outs.map(({ s }, i) => {
    const x = (j?.pairs || []).find((y) => y.job === s.job.id);
    const clamp = (v) => (Number.isFinite(Number(v)) ? Math.round(Math.max(0, Math.min(100, Number(v)))) : null);
    const oldS = x ? clamp(flip[i] ? x.b : x.a) : null, newS = x ? clamp(flip[i] ? x.a : x.b) : null;
    return { job: s.job.id, task: clip(String(s.job.text).split("\n")[0], 120), was: s.score, old: oldS, new: newS, why: clip(x?.why, 200), oldCostUsd: jobCost(s.job, calls0) };
  });
  const judged = run.results.filter((r) => r.old != null && r.new != null);
  if (!judged.length) throw new Error("The judge didn't score any of the answers.");
  const avg = (k) => Math.round(judged.reduce((a, r) => a + r[k], 0) / judged.length);
  const newSpent = spentSince(run.at, `quality_${p.desk.id}`, calls);
  const judgeSpent = spentSince(judgeAt, "hr_review", calls);
  const oldCosts = run.results.map((r) => r.oldCostUsd).filter((c) => c != null);
  run.oldAvg = avg("old");
  run.newAvg = avg("new");
  run.costPerJobUsd = Number((newSpent / outs.length).toFixed(4));
  run.oldCostPerJobUsd = oldCosts.length ? Number((oldCosts.reduce((a, c) => a + c, 0) / oldCosts.length).toFixed(4)) : null;
  run.spentUsd = Number((newSpent + judgeSpent).toFixed(4));
  run.verdict = verdictOf({ oldAvg: run.oldAvg, newAvg: run.newAvg, oldCost: run.oldCostPerJobUsd, newCost: newSpent > 0 ? run.costPerJobUsd : null });
  run.status = "done";
  run.endedAt = new Date().toISOString();
  saveRun(run);
  recordEvent({ desk: "hr", room: "hr", action: "quality check", summary: `${p.desk.id} on ${p.cand.model}${p.cand.brief !== p.desk.brief ? " (new brief)" : ""}: ${run.verdict.line}` }, "hr");
  return run;
}
function spentSince(at, step, calls = readRuns({ kinds: ["ai call"], limit: 5000 })) {
  const t = Date.parse(at);
  return calls.filter((c) => c.step === step && Date.parse(c.startedAt) >= t - 1000).reduce((a, c) => a + (c.costUsd || 0), 0);
}
// Use a finished run's setup on the desk (saved as a new brief version).
export function applyRun(id, by = ownerId()) {
  const run = readRunsFile().find((r) => r.id === id);
  if (!run || run.status !== "done") throw new Error("That quality check hasn't finished.");
  const d = roster().desks.find((x) => x.id === run.desk);
  if (!d) throw new Error("That desk is no longer on the roster.");
  return saveDesk({ ...d, ...run.candidate, versionNote: `from quality check ${run.id}: ${run.verdict?.line || ""}`.slice(0, 200) }, by);
}

// ---------- 4. brief versions ----------
const VERSIONS = () => path.join(DIR(), "brief-versions.jsonl");
const VKEYS = ["brief", "model", "provider", "effort"];
const pick = (d) => Object.fromEntries(VKEYS.map((k) => [k, d?.[k] ?? null]));
export function noteVersion(old, desk, { by = ownerId(), why = null } = {}) {
  const now = new Date().toISOString();
  if (old && VKEYS.every((k) => (old[k] ?? null) === (desk[k] ?? null))) return null;
  const mine = readJsonl(VERSIONS()).filter((v) => v.desk === desk.id);
  // the first change to a desk from before versions were kept: keep what it was, too
  if (old && !mine.length) appendJsonl(VERSIONS(), { desk: desk.id, at: old.hiredAt || "2000-01-01T00:00:00.000Z", by: "before versions", ...pick(old), why: "as it was before versions were kept" });
  const v = { desk: desk.id, at: now, by: slug(by) || ownerId(), ...pick(desk), ...(why ? { why } : !old ? { why: "new desk" } : {}) };
  appendJsonl(VERSIONS(), v);
  return v;
}
// A desk's versions, newest first, each with the average score of its jobs finished while it was in use.
export function briefVersions(desk) {
  const id = slug(desk);
  const list = readJsonl(VERSIONS()).filter((v) => v.desk === id).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const rates = jobRatings(), scores = jobScores();
  const done = jobs().filter((j) => j.desk === id && j.status === "done");
  return list
    .map((v, i) => {
      const from = Date.parse(v.at), to = i + 1 < list.length ? Date.parse(list[i + 1].at) : Infinity;
      const ss = done.filter((j) => { const t = Date.parse(j.updatedAt); return t >= from && t < to; }).map((j) => scoreOf(j.id, rates, scores).score).filter((s) => s != null);
      return { ...v, current: i === list.length - 1, jobs: ss.length, scoreAfter: ss.length ? Math.round(ss.reduce((a, s) => a + s, 0) / ss.length) : null };
    })
    .reverse();
}
export function rollBack({ desk, at } = {}, by = ownerId()) {
  const v = briefVersions(desk).find((x) => x.at === at);
  if (!v) throw new Error("No such version.");
  if (v.current) throw new Error("That's the version in use now.");
  const d = roster().desks.find((x) => x.id === v.desk);
  if (!d) throw new Error("That desk is no longer on the roster.");
  return saveDesk({ ...d, ...pick(v), versionNote: `rolled back to the version from ${v.at.slice(0, 16).replace("T", " ")}` }, by);
}

// ---------- the page ----------
export function qualityView() {
  const r = roster(), q = deskQuality();
  const desks = r.desks
    .filter((d) => d.status !== "retired")
    .map((d) => ({ id: d.id, room: d.room, model: d.model, provider: d.provider, effort: d.effort, brief: d.brief, runner: d.runner || null, ...(q[d.id] || { score: null, n: 0, pay: PAY_SCALE.unscored, samples: 0 }), versions: briefVersions(d.id).length }))
    .sort((a, b) => (b.n || 0) - (a.n || 0) || a.id.localeCompare(b.id));
  return { scale: PAY_SCALE, limits: { ...QUALITY, sampleMax: SAMPLE_MAX, sampleFloor: SAMPLE_FLOOR }, running: active, desks, runs: qualityRuns().slice(0, 30) };
}
