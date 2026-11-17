// Which AI answers each step, and the side-by-side test of cheaper models (plans/ai-cost-plan.md).
// Settings live in data/ai.json; anything missing falls back to DEFAULTS, which keep every step on today's model.
// The test ("shadow") sends the same question to the candidate models after the real answer is back and saves
// all the answers for comparison. Shadow answers are never used by the pipeline.
import fs from "node:fs";
import path from "node:path";
import { config, isRealKey } from "../config.js";
import { geminiRefusal } from "./refusal.js";
import { resolvePath, writeJsonAtomic, readJson, readJsonl, appendJsonl, loadPipelineConfig } from "./util.js";

// A step's name can end in its channel's id ("plan-<channel>"); the totals by step leave that out.
let channelEnd;
const dropChannel = (s) => {
  if (channelEnd === undefined) {
    let ids = [];
    try { ids = Object.keys(loadPipelineConfig().channels || {}); } catch {}
    channelEnd = ids.length ? new RegExp(`-(${ids.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`) : null;
  }
  return channelEnd ? s.replace(channelEnd, "") : s;
};

const FILE = () => resolvePath("data/ai.json");
const TESTS = () => resolvePath("data/ai-tests");

// Candidates per step: "haiku" / "sonnet" / "opus" (Claude) or "gemini-flash" / "gemini-pro" (newest matching Gemini model).
// Add "@low" / "@high" to test an effort level, e.g. "gemini-flash@low" (Gemini thinks less, so it is cheaper and faster).
// A Claude candidate can name an effort level too: "opus@low", "sonnet@medium" (the step's own effort otherwise).
export const DEFAULTS = {
  // step -> { model: "sonnet" | "claude-..." | "gemini-flash" | "gemini-..." }; a step not listed uses today's model.
  // creator_check is new (2026-10-18) and reads still frames against fixed markers, so it starts on Sonnet.
  steps: { hr_review: { model: "haiku" }, creator_check: { model: "sonnet" } },
  // hr_review (2026-11-09) is the HR desk checking staff requests (hr.js): short structured answers, so Haiku.
  // Half-price batch mode for video jobs, only while the channel is covered (posted in 24h + one ready) (see worker.js batchReady).
  batch: { on: true },
  shadow: {
    on: true,
    days: 7, // stops by itself this many days after the first test answer
    startedAt: null,
    steps: {
      fp_locate: ["sonnet", "gemini-flash"],
      fp_read: ["sonnet", "gemini-flash"],
      fp_check_render: ["haiku", "gemini-flash"],
      fp_package: ["sonnet", "gemini-flash"],
      cz_review: ["sonnet", "gemini-flash"],
      cz_check_edit: ["haiku", "gemini-flash", "gemini-flash@low"],
      cz_package: ["sonnet", "gemini-flash"],
      card_lookup_read: ["haiku", "gemini-flash", "gemini-flash@low"],
      card_photo_multi: ["sonnet", "gemini-flash"],
    },
  },
  fallback: true, // if the step's own model fails, try the other provider before failing the job
};

// USD per million tokens, from Anthropic's and Google's pricing pages on 2026-10-18. data/ai.json "prices" overrides any
// of these (same shape) when prices change. First matching prefix wins, so longer names go first.
// Gemini Flash and 4 Argon prices double on Jan 1 / Dec 1 2026-27 (Google's note); update then.
export const PRICES = {
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125, over100k: { in: 0.5, out: 2.5, cacheRead: 0.05, cacheWrite: 0.625 } },
  "claude-opus-5": { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-fable-5-1": { in: 10, out: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  "gemini-4-argon": { in: 2, out: 10, cacheRead: 0.1 },
  "gemini-3.1-pro": { in: 2, out: 12, cacheRead: 0.2 },
  "gemini-2.5-pro": { in: 1.25, out: 10, cacheRead: 0.31 },
  "gemini-2.5-flash-lite": { in: 0.1, out: 0.4, cacheRead: 0.025 },
  "gemini-2.5-flash": { in: 0.3, out: 2.5, cacheRead: 0.075 },
  "gemini-3.8-flash": { in: 0.75, out: 3.75, cacheRead: 0.075 },
  "gemini-3.7-flash": { in: 0.75, out: 3.75, cacheRead: 0.075 },
  "gemini-3.6-flash": { in: 0.75, out: 3.75, cacheRead: 0.075 },
  "gemini-": { in: 0.75, out: 3.75, cacheRead: 0.075 }, // any other Gemini: priced like current Flash
};
// The dearest built-in price (money safety, 2026-11-16): a paid call whose cost can't be worked out (a model with no
// price on file) is booked at this rate, so a desk's cap can still trip. Never used for local models (free).
export const DEFAULT_PRICE_MODEL = Object.entries(PRICES).sort((a, b) => b[1].in + b[1].out - (a[1].in + a[1].out))[0][0];
export const defaultCost = (u = {}) => costOf(DEFAULT_PRICE_MODEL, u, PRICES);
// Cost in USD of one call's usage, or null if the model has no price.
export function costOf(model, u = {}, table = { ...PRICES, ...aiSettings().prices }) {
  const key = Object.keys(table)
    .sort((a, b) => b.length - a.length)
    .find((k) => String(model).startsWith(k));
  if (!key) return null;
  let p = table[key];
  const prompt = (u.inputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0);
  if (p.over100k && prompt > 100000) p = p.over100k;
  const cost =
    ((u.inputTokens || 0) * p.in +
      (u.outputTokens || 0) * p.out +
      (u.cacheReadTokens || 0) * (p.cacheRead ?? p.in) +
      (u.cacheWriteTokens || 0) * (p.cacheWrite ?? p.in) +
      (u.cacheWrite1hTokens || 0) * p.in * 0.75) /
    1e6; // an hour-long cache write is 2x, not 1.25x
  return Math.round(cost * 1e6) / 1e6;
}

// Spend from the run log's "ai call" entries: today, 7 days, this month, by step and model, real work vs the test.
export function spendSummary(calls) {
  const day = (iso) => iso.slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const add = (m, k, c) => {
    const r = (m[k] ??= { calls: 0, usd: 0 });
    r.calls++;
    r.usd += c.costUsd || 0;
  };
  const out = { today: { calls: 0, usd: 0 }, week: { calls: 0, usd: 0 }, month: { calls: 0, usd: 0 }, byStep: {}, byModel: {}, byDay: {}, byVideo: {}, test: { calls: 0, usd: 0 }, unpriced: 0, since: calls.at(-1)?.startedAt || null };
  for (const c of calls) {
    if (c.costUsd == null) out.unpriced++;
    const d = day(c.startedAt);
    if (d === today) add(out, "today", c);
    if (d >= weekAgo) add(out, "week", c);
    if (d.startsWith(month)) add(out, "month", c);
    if (c.trigger === "test") add(out, "test", c);
    add(out.byStep, dropChannel(String(c.step || "").replace(/_\d+$/, "")).replace(/-/g, "_"), c);
    add(out.byModel, c.model || "?", c);
    add(out.byDay, d, c);
    if (c.job) add(out.byVideo, c.job, c), (out.byVideo[c.job].label = c.video || out.byVideo[c.job].label || c.job);
  }
  return out;
}

export function aiSettings() {
  const saved = readJson(FILE(), {});
  return {
    ...DEFAULTS,
    ...saved,
    prices: { ...saved.prices },
    steps: { ...DEFAULTS.steps, ...saved.steps },
    batch: { ...DEFAULTS.batch, ...saved.batch },
    shadow: { ...DEFAULTS.shadow, ...saved.shadow, steps: { ...DEFAULTS.shadow.steps, ...saved.shadow?.steps } },
  };
}
export function saveAiSettings(patch) {
  const cur = aiSettings();
  const next = { ...cur, ...patch, batch: { ...cur.batch, ...patch.batch }, shadow: { ...cur.shadow, ...patch.shadow } };
  writeJsonAtomic(FILE(), next);
  return next;
}

// "fp_read_3" -> "fp_read", "insights-a channel" -> "insights", "rules-review-a channel" -> "rules_review".
export const stepKey = (name) => dropChannel(name.replace(/_\d+$/, "")).replace(/-/g, "_");

export const CLAUDE = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" };

// Gemini model names change often, so pick the newest one the key can use instead of hard-coding it.
let geminiList = null;
async function geminiModels() {
  if (geminiList && Date.now() - geminiList.at < 864e5) return geminiList.names;
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { headers: { "x-goog-api-key": config.geminiApiKey }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Gemini model list answered ${res.status}`);
  const names = ((await res.json()).models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => m.name.replace(/^models\//, ""));
  geminiList = { at: Date.now(), names };
  return names;
}
const version = (n) => (n.match(/(\d+(?:\.\d+)?)/) || [0, 0])[1] * 1;
// Google keeps some old models in the list after retiring them for new keys (gemini-2.5-pro answered 404 "no longer
// available to new users" on all 35 Pro side-by-side tests up to 2026-10-20). A model that answers that way is
// remembered in data/gemini-retired.json and skipped; with no stable Pro left, the newest preview is used.
const RETIRED = () => resolvePath("data/gemini-retired.json");
const retiredGemini = () => readJson(RETIRED(), {});
function retireGemini(model, why) {
  const r = retiredGemini();
  r[model] = { at: new Date().toISOString(), why: String(why).slice(0, 200) };
  writeJsonAtomic(RETIRED(), r, 1);
  console.warn(`Gemini model ${model} is retired for this key; using the next newest from now on.`);
}
async function newestGemini(kind) {
  if (!hasGemini()) throw new Error("No Gemini key in .env"); // no key: no model-list request (the AI page asks for the names of both Gemini models each time it opens)
  const retired = retiredGemini();
  const all = (await geminiModels()).filter((n) => n.startsWith("gemini-") && n.includes(kind) && !retired[n] && !/lite|image|tts|live|audio|embedding|thinking|exp|\d{3,}$/.test(n));
  const stable = all.filter((n) => !/preview/.test(n));
  const names = stable.length ? stable : all;
  if (!names.length) throw new Error(`No Gemini ${kind} model available to this key`);
  return names.sort((a, b) => version(b) - version(a) || a.length - b.length)[0];
}

// Turns a short name into { provider, model }.
export async function resolveModel(name) {
  if (!name) return { provider: "claude", model: config.model };
  if (CLAUDE[name]) return { provider: "claude", model: CLAUDE[name] };
  if (name.startsWith("claude-")) return { provider: "claude", model: name };
  if (name === "gemini-flash" || name === "gemini-pro") return { provider: "gemini", model: await newestGemini(name.slice(7)) };
  if (name.startsWith("gemini-")) return { provider: "gemini", model: name };
  throw new Error(`Unknown model "${name}"`);
}
export const hasGemini = () => isRealKey(config.geminiApiKey);

// Same question to Gemini: Claude-style content blocks (text, base64 images) become Gemini parts, and the answer
// has to match the same JSON schema.
// Effort levels map to Gemini thinking (to-do #14): Gemini 3+ takes thinkingLevel, 2.5 takes a token budget.
// "medium" (the app's default) leaves Gemini on its own default; a model that refuses the setting is asked again without it.
export function geminiThinking(model, effort) {
  if (!effort || effort === "medium") return null;
  const level = effort === "low" || effort === "minimal" ? effort : "high";
  if (version(model) >= 3) return { thinkingLevel: level };
  if (/2\.5/.test(model)) return { thinkingBudget: level === "minimal" ? (/flash/.test(model) ? 0 : 128) : level === "low" ? 1024 : 24576 };
  return null;
}

export async function askGemini({ model, system, content, schema, effort }, retry = false) {
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : content;
  // { type: "youtube", url } lets Gemini watch a public YouTube video itself (Gemini reads YouTube links natively).
  const parts = blocks.map((b) => (b.type === "image" || b.type === "audio" ? { inlineData: { mimeType: b.source.media_type, data: b.source.data } } : b.type === "youtube" ? { fileData: { fileUri: b.url } } : { text: b.text }));
  const started = Date.now();
  const call = (thinkingConfig) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": config.geminiApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: schema,
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
      }),
      signal: AbortSignal.timeout(10 * 60000),
    });
  const thinking = geminiThinking(model, effort);
  let res = await call(thinking);
  let j = await res.json().catch(() => ({}));
  if (thinking && res.status === 400 && /think/i.test(j.error?.message || "")) {
    res = await call(null);
    j = await res.json().catch(() => ({}));
  }
  if (res.status === 404 && /no longer available|is not found|not supported/i.test(j.error?.message || "") && !retry) {
    retireGemini(model, j.error.message);
    const kind = /pro/.test(model) ? "pro" : /flash/.test(model) ? "flash" : null;
    const next = kind && (await newestGemini(kind).catch(() => null));
    if (next && next !== model) return askGemini({ model: next, system, content, schema, effort }, true);
  }
  if (!res.ok) throw new Error(`Gemini answered ${res.status}: ${j.error?.message || ""}`.trim());
  const cand = j.candidates?.[0];
  const refused = geminiRefusal(j, model);
  if (refused) throw refused;
  if (!cand || cand.finishReason === "SAFETY") throw new Error(`Gemini returned no answer (${cand?.finishReason || j.promptFeedback?.blockReason || "empty"})`);
  const text = (cand.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join("");
  const u = j.usageMetadata || {};
  return {
    answer: JSON.parse(text),
    usage: {
      inputTokens: u.promptTokenCount,
      outputTokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
      cacheReadTokens: u.cachedContentTokenCount || 0,
    },
    ms: Date.now() - started,
    model: j.modelVersion || model,
  };
}

// How closely two answers match: share of leaf values (text compared loosely, numbers within 2%) that agree.
function leaves(v, at = "", out = {}) {
  if (Array.isArray(v)) v.forEach((x, i) => leaves(x, `${at}[${i}]`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) leaves(x, at ? `${at}.${k}` : k, out);
  else out[at] = v;
  return out;
}
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function agreement(a, b) {
  const A = leaves(a), B = leaves(b);
  const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])];
  if (!keys.length) return 1;
  let same = 0;
  for (const k of keys) {
    const x = A[k], y = B[k];
    if (typeof x === "number" && typeof y === "number") same += Math.abs(x - y) <= Math.max(0.02 * Math.abs(x), 0.01) ? 1 : 0;
    else same += norm(x) === norm(y) ? 1 : 0;
  }
  return Math.round((same / keys.length) * 1000) / 1000;
}

export function shadowCandidates(step) {
  const s = aiSettings().shadow;
  if (!s.on || process.env.PIPELINE_FAKE_CLAUDE) return [];
  if (s.startedAt && Date.now() - Date.parse(s.startedAt) > s.days * 864e5) return [];
  return (s.steps[step] || []).filter((m) => !m.startsWith("gemini") || hasGemini());
}

export function saveTest(step, entry) {
  const s = aiSettings();
  if (!s.shadow.startedAt) saveAiSettings({ shadow: { startedAt: new Date().toISOString() } });
  appendJsonl(path.join(TESTS(), `${step}.jsonl`), entry);
}

// Results per step and candidate, for the AI page.
export function testResults() {
  const out = {};
  if (!fs.existsSync(TESTS())) return out;
  for (const f of fs.readdirSync(TESTS()).filter((x) => x.endsWith(".jsonl"))) {
    const step = f.replace(/\.jsonl$/, "");
    const rows = readJsonl(path.join(TESTS(), f)).filter(Boolean);
    const cands = {};
    for (const r of rows)
      for (const c of r.shadow || []) {
        // "gemini-flash@low" gets its own row next to plain "gemini-flash" (same model, less thinking).
        const k = String(c.name || "").includes("@") && !c.error ? `${c.model}@${c.name.split("@")[1]}` : c.model;
        (cands[k] ??= { model: k, provider: c.provider, runs: 0, failed: 0, agree: [], ms: [], inTok: [], outTok: [] }).runs++;
        if (c.error) cands[k].failed++;
        else {
          cands[k].agree.push(c.agreement);
          cands[k].ms.push(c.ms);
          cands[k].inTok.push(c.usage?.inputTokens || 0);
          cands[k].outTok.push(c.usage?.outputTokens || 0);
        }
      }
    const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
    const main = rows.map((r) => r.main).filter(Boolean);
    out[step] = {
      runs: rows.length,
      main: {
        model: main.at(-1)?.model,
        ms: med(main.map((m) => m.ms)),
        inTok: med(main.map((m) => m.usage?.inputTokens || 0)),
        outTok: med(main.map((m) => m.usage?.outputTokens || 0)),
      },
      candidates: Object.values(cands).map((c) => ({
        model: c.model,
        provider: c.provider,
        runs: c.runs,
        failed: c.failed,
        agreement: c.agree.length ? Math.round((c.agree.reduce((a, b) => a + b, 0) / c.agree.length) * 1000) / 1000 : null,
        fullMatch: c.agree.filter((x) => x === 1).length,
        ms: med(c.ms),
        inTok: med(c.inTok),
        outTok: med(c.outTok),
      })),
      latest: rows.slice(-3).reverse(),
    };
  }
  return out;
}
