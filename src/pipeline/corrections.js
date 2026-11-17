// Learning from the owner's corrections. Every time he answers a hold box, edits the AI's answer, or writes render
// feedback, it's saved here (data/feedback/corrections.jsonl). The AI step that made the mistake then gets his most
// recent corrections in its prompt, so it learns as the pipeline runs; the rules review sees them too, and Admin
// shows them grouped by step (the audit).
import { resolvePath, readJsonl, appendJsonl, OWNER } from "./util.js";
import { chOfLayout } from "../hub/settings.js";

const FILE = () => resolvePath("data/feedback/corrections.jsonl");
// Which job stage each AI step's mistakes show up at.
// Which hold or feedback stages teach which AI step. Audit edits (the owner fixing the title or text before upload) teach
// the package step; a channel card fixes also teach the card price check's photo reader (same job: read a card).
const STEP_STAGES = {
  fp_locate: ["locate"],
  fp_wrapper: ["locate"],
  fp_msrp_search: ["locate", "render"],
  fp_read: ["readCards", "price"],
  fp_pick_printing: ["readCards"],
  fp_check_render: ["checkRender", "render"],
  fp_package: ["package", "audit"],
  cz_find_clips: ["intake", "findClips"],
  cz_review: ["review", "plan"],
  cz_voice: ["review"],
  creator_check: ["review"],
  cz_captions: ["edit", "checkEdit", "captions"],
  cz_check_edit: ["checkEdit"],
  cz_package: ["package", "audit"],
  card_lookup_read: ["cardRead", "readCards"],
  card_photo_multi: ["cardRead", "readCards"],
};
// Which channels' corrections a step learns from.
// (the pack channel and the clip channel are the ones with those page layouts in pipeline.config.json)
const STEP_CHANNELS = () => ({ card_lookup_read: ["cards", chOfLayout("packs").id], card_photo_multi: ["cards", chOfLayout("packs").id] });
const channelsOf = (step) => (STEP_CHANNELS()[step] || [chOfLayout(step.startsWith("fp_") ? "packs" : "clips").id]).filter(Boolean);
const stepOf = (name) => (/^fp_read_\d+$/.test(name) ? "fp_read" : name);
const short = (v, n = 160) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

export function readCorrections({ days = 365 } = {}) {
  try {
    const since = Date.now() - days * 864e5;
    return readJsonl(FILE()).filter((c) => Date.parse(c.at) > since);
  } catch {
    return [];
  }
}

// What changed between the AI's answer and the owner's edited one, top-level fields only.
function diff(before, after) {
  if (!before || typeof before !== "object" || !after || typeof after !== "object") return [];
  return Object.keys({ ...before, ...after })
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => `${k}: was ${short(before[k], 120)}, now ${short(after[k], 120)}`);
}

// job: the held job; answers: the cleaned box values; review: the owner's edited JSON (or undefined).
// stage/problem: for feedback sent from the job card at any time (not answering a hold), which part it's about.
export function recordCorrection(job, { answers, review, feedback, action, stage, problem } = {}) {
  const hold = job.hold || {};
  const changes = [];
  for (const [k, v] of Object.entries(answers || {})) {
    const f = hold.fields?.find((x) => x.key === k);
    if (v === "" || v == null || (f && String(f.value ?? "") === String(v) && f.type !== "textarea")) continue; // left as suggested
    if (f?.type === "checkbox" && !v) continue;
    changes.push(`${f?.label || k}: ${short(v)}`);
  }
  if (review !== undefined) changes.push(...diff(hold.review, review));
  if (feedback) changes.push(`feedback: ${short(feedback, 400)}`);
  if (!changes.length) return null;
  const entry = {
    at: new Date().toISOString(),
    channel: job.channel,
    job: job.id,
    video: job.data?.episode ? `Ep ${job.data.episode}` : job.sourceName,
    stage: stage || hold.stage || job.stage,
    problem: short(problem ?? hold.reason ?? "", 300),
    changes,
    ...(action ? { action } : {}),
  };
  appendJsonl(FILE(), entry);
  return entry;
}

// Every time a hold is answered: did the owner change anything, or wave it through as suggested? A hold he nearly always
// waves through is costing him a tap for nothing (its bar may be too strict); one he nearly always fixes is doing its
// job. Kept in data/feedback/holds.jsonl, summed for the rules review and Admin.
const HOLDS = () => resolvePath("data/feedback/holds.jsonl");
// Also keeps why it stopped and what the owner answered, so the rules review can spot stops that keep coming back and
// say what would let the app decide them itself (the owner 2026-10-20: "keep driving critical thinking like this").
export function recordHoldOutcome(job, changed, { answers } = {}) {
  try {
    const short = (v) => String(v ?? "").slice(0, 80);
    const ans = answers ? Object.fromEntries(Object.entries(answers).filter(([, v]) => v !== "" && v != null).slice(0, 12).map(([k, v]) => [k, short(v)])) : undefined;
    appendJsonl(HOLDS(), {
      at: new Date().toISOString(),
      channel: job.channel,
      job: job.id,
      stage: job.hold?.stage || job.stage,
      changed: Boolean(changed),
      why: String(job.hold?.reason || job.hold?.message || "").slice(0, 400),
      ...(ans && Object.keys(ans).length ? { answers: ans } : {}),
    });
  } catch (err) {
    console.warn(`Couldn't log the hold outcome: ${err.message}`);
  }
}

// Per stage over the last `days`: how many holds, how many the owner changed something on, how many he passed as is.
export function holdStats(channel, { days = 60 } = {}) {
  let rows = [];
  try {
    const since = Date.now() - days * 864e5;
    rows = readJsonl(HOLDS()).filter((r) => (!channel || r.channel === channel) && Date.parse(r.at) > since);
  } catch {}
  const by = {};
  for (const r of rows) {
    const g = (by[r.stage] ??= { stage: r.stage, holds: 0, changed: 0, passed: 0 });
    g.holds++;
    g[r.changed ? "changed" : "passed"]++;
  }
  return Object.values(by).sort((a, b) => b.holds - a.holds);
}

// The latest holds with why each stopped and what the owner answered (newest first), for the rules review.
export function holdCases(channel, { days = 60, limit = 25 } = {}) {
  try {
    const since = Date.now() - days * 864e5;
    return readJsonl(HOLDS())
      .filter((r) => r.channel === channel && Date.parse(r.at) > since && r.why)
      .slice(-limit).reverse().map((r) => ({ date: r.at.slice(0, 10), stage: r.stage, why: r.why, changed: r.changed, ...(r.answers ? { answered: r.answers } : {}) }));
  } catch {
    return [];
  }
}

// Prompt section for one AI step: its stage's latest corrections (newest first), or "".
export function correctionNotes(name, { limit = 12 } = {}) {
  const stages = STEP_STAGES[stepOf(name)];
  if (!stages) return "";
  const chans = channelsOf(stepOf(name));
  const rows = readCorrections({ days: 120 }).filter((c) => stages.includes(c.stage) && chans.includes(c.channel)).slice(-limit).reverse();
  if (!rows.length) return "";
  return `\n\n---\n\n## ${OWNER()}'s corrections on earlier videos\nThis step got these wrong before and ${OWNER()} fixed them. Learn the pattern so the same mistake doesn't happen again. They are about earlier videos, not facts about this one.\n${rows.map((c) => `- ${c.at.slice(0, 10)} ${c.video}: problem "${c.problem}". ${OWNER()}: ${c.changes.join("; ")}`).join("\n")}`;
}

// For Admin: counts per stage, most recent first.
export function correctionSummary() {
  const rows = readCorrections({ days: 90 });
  const by = {};
  for (const c of rows) {
    const k = `${c.channel}|${c.stage}`;
    (by[k] ??= { channel: c.channel, stage: c.stage, count: 0, last30: 0, latest: [] }).count++;
    if (Date.parse(c.at) > Date.now() - 30 * 864e5) by[k].last30++;
    by[k].latest.unshift(c);
  }
  for (const g of Object.values(by)) g.latest = g.latest.slice(0, 5);
  return { total: rows.length, groups: Object.values(by).sort((a, b) => b.count - a.count) };
}
