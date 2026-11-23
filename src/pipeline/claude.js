import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { logEvent } from "./runlog.js";
import { appendSpend, noteCostUnknown } from "./spend.js";
import { currentAi, skipBatch } from "./context.js";
import { correctionNotes } from "./corrections.js";
import { checkCredit } from "./credits.js";
import { aiSettings, stepKey, resolveModel, askGemini, hasGemini, shadowCandidates, agreement, saveTest, costOf, defaultCost } from "./ai.js";
import { askOpenAI, isCompat } from "./openai-compat.js";
import { claudeRefusal } from "./refusal.js";
import { fetchRetry } from "./fetch-retry.js";
import { isDemo, DEMO_MESSAGE } from "../hub/settings.js";
import { assertPipelineBudget } from "../hub/pipelinecap.js";

// fetchRetry rides out a short network drop (2 s, 6 s, 18 s) before the SDK's own retries (which wait under 10 s in all).
const client = new Anthropic({ apiKey: config.anthropicApiKey, fetch: (url, init) => fetchRetry(url, init) });

// The channel rules (same for every step) are cached on their own for an hour, so each step reads them from the
// cache instead of writing its own copy; the step's task comes after, uncached. the owner 2026-10-23: cache hit rate
// was 9% because every step's task was in the same cached block as the rules.
const TASK_MARK = "\n\n---\n\n## Your task in this step\n";
// The system prompt for one step: the channel rules, then TASK_MARK, then the task (systemBlocks cuts it there).
export const stepSystem = (rules, task) => `${rules}${TASK_MARK}${task}`;
let hourCache = true; // turned off for the rest of the run if the API ever refuses the hour-long cache
function systemBlocks(system) {
  const cut = system.indexOf(TASK_MARK);
  if (cut <= 0) return [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  return [{ type: "text", text: system.slice(0, cut), cache_control: { type: "ephemeral", ...(hourCache ? { ttl: "1h" } : {}) } }, { type: "text", text: system.slice(cut) }];
}

// Test mode (PIPELINE_FAKE_CLAUDE = a folder of <name>.json answers): { answer } from the fixture, or null when not in
// test mode. A missing fixture throws `missingMsg`, or the plain file error when there is none.
function fakeAnswer(file, missingMsg) {
  const dir = process.env.PIPELINE_FAKE_CLAUDE;
  if (!dir) return null;
  const full = path.join(dir, `${file}.json`);
  if (missingMsg && !fs.existsSync(full)) throw new Error(missingMsg);
  return { answer: JSON.parse(fs.readFileSync(full, "utf8")) };
}

// The text and token counts of a finished Claude message; throws when it was declined, cut off or empty.
export function readClaudeMessage(message, name) {
  if (message.stop_reason === "refusal") throw claudeRefusal(message, name);
  if (message.stop_reason === "max_tokens") throw new Error(`Claude's ${name} answer was cut off.`);
  const text = message.content.filter((b) => b.type === "text").at(-1)?.text;
  if (!text) throw new Error(`Claude returned no text for ${name}.`);
  const u = message.usage || {};
  return {
    text,
    usage: {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens || 0,
      cacheWriteTokens: u.cache_creation_input_tokens || 0,
      cacheWrite1hTokens: u.cache_creation?.ephemeral_1h_input_tokens || 0,
    },
  };
}

// One row in the run log for an AI call (the success row carries tokens and cost in `extra`, the error row `error`).
export function logAiCall({ trigger, step, provider, model, effort }, extra) {
  appendSpend({ kind: "ai call", step, provider, model, costUsd: extra?.costUsd, costDefault: extra?.costDefault, batch: extra?.batch }); // the spend ledger (caps, finance, HUD); costUsd is already the batch price
  logEvent("ai call", { trigger, job: currentAi().job, video: currentAi().video, step, provider, model, effort, ...extra });
}

// One Claude call. The main model gets the server-side fallback; test models (Haiku especially) may not take
// every option, so a 400 about them retries without.
// search: up to that many server-side web searches (about 1¢ each); a call with search never goes by batch.
async function askClaude({ name, model, system, content, schema, effort, main, batch, quiet, search = 0 }) {
  const started = Date.now();
  if (search) batch = false;
  const base = { model, max_tokens: 64000, system: systemBlocks(system), messages: [{ role: "user", content }], ...(search ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: search }] } : {}) };
  const full = { ...base, thinking: { type: "adaptive" }, output_config: { effort, format: { type: "json_schema", schema } }, ...(main ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}) };
  let message;
  try {
    // Batch mode: same request at half price, answered when Anthropic gets to it (usually minutes, at most a day).
    if (batch) message = await viaBatch(name, { ...base, thinking: full.thinking, output_config: full.output_config }, quiet).catch((err) => (err.skipBatch ? null : Promise.reject(err)));
    if (!message) (batch = false), (message = await client.beta.messages.stream(full).finalMessage());
  } catch (err) {
    if ((err.status === 400 || /batch request errored/.test(err.message)) && hourCache && /ttl|cache_control/i.test(err.message)) {
      hourCache = false;
      console.warn(`${name}: the hour-long prompt cache was refused (${err.message.split("\n")[0]}), using the 5-minute one`);
      return askClaude({ name, model, system, content, schema, effort, main, batch, quiet, search });
    }
    if (main || err.status !== 400 || !/effort|thinking|fallback/i.test(err.message)) throw err;
    message = await client.beta.messages.stream({ ...base, output_config: { format: { type: "json_schema", schema } } }).finalMessage();
  }
  const { text, usage } = readClaudeMessage(message, name);
  return {
    batch: Boolean(batch),
    answer: JSON.parse(text),
    usage,
    ms: Date.now() - started,
    model: message.model || model,
    searches: message.usage?.server_tool_use?.web_search_requests || 0,
  };
}

// The cost to book for a finished call. No price on file (null) for a paid provider: the dearest built-in rate, with
// one "cost unknown" event, so a cap can still trip and the ledger row is never dropped (money safety B1).
export function bookedCost(r, route, step) {
  const base = r.costUsd !== undefined ? r.costUsd : costOf(r.model, r.usage);
  if (Number.isFinite(base)) return { costUsd: r.batch && r.costUsd === undefined ? Number((base / 2).toFixed(4)) : base };
  const costUsd = defaultCost(r.usage);
  noteCostUnknown({ step, provider: route.provider, model: r.model || route.model, costUsd });
  return { costUsd, costDefault: true };
}

// AI helpers' calls go one at a time while the helpers have a daily $ limit, and each checks the limit again just
// before it goes out, so two helpers started together can't both pass on yesterday's total (money safety F2/S5).
let helperTurn = Promise.resolve();
async function inHelperTurn(name, fn) {
  const H = await import("../hub/helpers.js");
  if (!H.isHelperStep(name) || typeof H.helperSettings().perDayUsd !== "number") return fn();
  const run = helperTurn.then(() => {
    const s = H.helperSettings();
    if (s.on && typeof s.perDayUsd === "number" && H.helperSpendToday() >= s.perDayUsd) throw new Error(`AI helpers reached today's limit of $${s.perDayUsd} (Admin > AI helpers).`);
    return fn();
  });
  helperTurn = run.then(() => {}, () => {});
  return run;
}

async function askWith(route, args) {
  if (isDemo()) throw new Error(DEMO_MESSAGE); // demo mode: no AI call is ever made (tools/demo.mjs)
  assertPipelineBudget(args.name); // the one place every provider call passes: the pipeline's monthly cap (pipeline.capUsdMonth)
  return inHelperTurn(args.name, () => askWithNow(route, args));
}
async function askWithNow(route, args) {
  try {
    // OpenAI, Grok, DeepSeek and local models share one OpenAI-style worker (openai-compat.js, Hub kit step 2)
    const r = isCompat(route.provider)
      ? await askOpenAI({ ...args, provider: route.provider, model: route.model, prices: aiSettings().prices })
      : route.provider === "gemini"
        ? await askGemini({ ...args, model: route.model, batch: Boolean(args.geminiBatch) }) // Gemini batch: hub-run desk jobs only (askAs)
        : await askClaude({ ...args, model: route.model });
    // Every AI call in the run log (model, tokens, time), to see what each step really costs.
    const booked = bookedCost(r, route, args.name);
    if (r.searches) booked.costUsd = Number(((booked.costUsd || 0) + r.searches * (route.provider === "gemini" ? 0.035 : 0.01)).toFixed(4));
    logAiCall({ trigger: args.main ? "app" : "test", step: args.name, provider: route.provider, model: r.model, effort: args.effort }, {
      ...r.usage,
      ...(r.batch ? { batch: true } : {}),
      ...booked,
      ...(r.searches ? { searches: r.searches } : {}),
      aiMs: r.ms,
    });
    checkCredit(route.provider);
    return { ...r, provider: route.provider };
  } catch (err) {
    logAiCall({ trigger: args.main ? "app" : "test", step: args.name, provider: route.provider, model: route.model, effort: args.effort }, { error: err.message.split("\n")[0] });
    throw err;
  }
}

// Sends one request as a Message Batch and waits for it. The job card says it's waiting; if the batch fails or runs
// past a day, the error goes up like any other.
async function viaBatch(name, params, quiet) {
  const { note: n, job } = currentAi();
  const note = quiet ? null : n;
  const created = await client.beta.messages.batches.create({ requests: [{ custom_id: name.replace(/[^\w-]/g, "_").slice(0, 64), params }] });
  note?.(`${name}: sent in half-price batch mode, waiting for the answer`);
  const until = Date.now() + 24 * 3600 * 1000;
  let b = created;
  const skipped = () => !quiet && job && skipBatch.has(job);
  while (b.processing_status !== "ended") {
    if (Date.now() > until) throw new Error(`The ${name} batch didn't finish within a day.`);
    if (skipped()) {
      await client.beta.messages.batches.cancel(created.id).catch(() => {});
      note?.(`${name}: you asked for it now, so the batch was cancelled and it's asked at full price`);
      throw Object.assign(new Error("Batch skipped"), { skipBatch: true });
    }
    for (let i = 0; i < 10 && !skipped(); i++) await new Promise((r) => setTimeout(r, 2000));
    // Always waits on something each time round: a test answer (quiet) for a job you pushed used to spin here
    // without ever waiting, which froze the whole app.
    if (!skipped()) b = await client.beta.messages.batches.retrieve(created.id);
  }
  for await (const r of await client.beta.messages.batches.results(created.id)) {
    if (r.result.type === "succeeded") {
      note?.(`${name}: batch answer back after ${Math.round((Date.parse(b.ended_at) - Date.parse(created.created_at)) / 1000)} s`);
      return r.result.message;
    }
    throw new Error(`The ${name} batch request ${r.result.type}: ${r.result.error?.error?.message || r.result.error?.message || "no detail"}`);
  }
  throw new Error(`The ${name} batch came back empty.`);
}

// The side-by-side test: same question to each candidate model, after the real answer. Never used by the pipeline.
async function runShadow(step, args, main) {
  const shadow = [];
  for (const cand of shadowCandidates(step)) {
    try {
      // "opus@low" = the same or another Claude model at a different effort level, to see if a cheaper setting is enough.
      const [name, effort = args.effort] = cand.split("@");
      const route = await resolveModel(name);
      if (route.model === main.model && effort === args.effort) continue;
      // Test answers aren't waited on, so they always go at the half batch price.
      const r = await askWith(route, { ...args, effort, main: false, batch: route.provider === "claude", quiet: true });
      shadow.push({ name: cand, provider: route.provider, model: r.model, ms: r.ms, usage: r.usage, agreement: agreement(main.answer, r.answer), answer: r.answer });
    } catch (err) {
      shadow.push({ name: cand, model: cand, error: err.message.split("\n")[0] });
    }
  }
  if (shadow.length) saveTest(step, { at: new Date().toISOString(), name: args.name, main: { provider: main.provider, model: main.model, ms: main.ms, usage: main.usage, answer: main.answer }, shadow });
}

// Asks for JSON matching `schema`. `name` labels the call in logs and picks the fixture in fake mode.
// Which model answers comes from data/ai.json (see ai.js); by default it's config.model for every step.
export async function askJSON({ name, system, content, schema, effort = "medium" }) {
  assertPipelineBudget(name); // before the stand-in answer too, so a test sees the same stop
  // the owner's past corrections for this step (corrections.js), so it doesn't repeat a mistake he already fixed.
  if (typeof system === "string") system += correctionNotes(name);
  const fake = fakeAnswer(name);
  if (fake) {
    // tests: what was asked is kept beside the canned answer (as askAs does)
    try { fs.writeFileSync(path.join(process.env.PIPELINE_FAKE_CLAUDE, `${name}.asked.txt`), `${typeof system === "string" ? system : JSON.stringify(system)}\n=====\n${typeof content === "string" ? content : JSON.stringify(content)}`); } catch {}
    return fake.answer;
  }
  const step = stepKey(name);
  const settings = aiSettings();
  const args = { name, system, content, schema, effort, main: true, batch: Boolean(currentAi().batch) };
  const route = await resolveModel(settings.steps[step]?.model).catch(() => ({ provider: "claude", model: config.model }));
  let r;
  try {
    r = await askWith(route, args);
  } catch (err) {
    if (err.pipelineBudget) throw err; // the monthly budget is the same for the other provider: no fallback call
    // The other provider steps in rather than failing the job.
    const other = !settings.fallback ? null : route.provider === "gemini" ? { provider: "claude", model: config.model } : hasGemini() ? await resolveModel("gemini-pro").catch(() => null) : null;
    if (!other) throw err;
    console.warn(`${name}: ${route.model} failed (${err.message.split("\n")[0]}), trying ${other.model}`);
    r = await askWith(other, args);
  }
  runShadow(step, args, r).catch((err) => console.warn(`AI test for ${name} failed: ${err.message}`));
  return r.answer;
}

// Asks one named model (a desk's own model, for jobs the hub runs on a desk's behalf). Logged like any other call,
// with the step name "desk_<id>" so its cost lands on that desk.
// batch: a job that can wait goes at the half batch price (Claude Message Batches or the Gemini Batch API; not with search).
export async function askAs({ name, model, provider, system, content, schema, effort = "medium", search = 0, batch = false }) {
  const fake = fakeAnswer("desk_job");
  if (fake) {
    // tests: what was asked is kept beside the canned answer
    try { fs.writeFileSync(path.join(process.env.PIPELINE_FAKE_CLAUDE, `${name}.asked.txt`), `${typeof system === "string" ? system : JSON.stringify(system)}\n=====\n${typeof content === "string" ? content : JSON.stringify(content)}`); } catch {}
    return fake.answer;
  }
  const route = isCompat(provider) ? { provider, model } : await resolveModel(model);
  // web search on Claude and Gemini only (the OpenAI-style providers don't take it here)
  const s = isCompat(route.provider) ? 0 : search, b = Boolean(batch) && !s && !isCompat(route.provider);
  const r = await askWith(route, { name, system, content, schema, effort, main: true, batch: b, geminiBatch: b, search: s });
  return r.answer;
}

// Gemini only, for questions Claude can't take (audio). Logged like any other AI call. Throws if no Gemini key.
// model: a Gemini name ("gemini-flash" unless a caller picks one, like the Neon check's "gemini-4-neon").
export async function askGeminiJSON({ name, system, content, schema, model = "gemini-flash", effort = "medium" }) {
  assertPipelineBudget(name);
  const fake = fakeAnswer(name, "No Gemini in fake mode");
  if (fake) return fake.answer;
  if (!hasGemini()) throw new Error("No Gemini key in .env");
  if (typeof system === "string") system += correctionNotes(name);
  if (!String(model).startsWith("gemini-")) throw new Error(`askGeminiJSON takes a Gemini model, not "${model}".`);
  const r = await askWith(await resolveModel(model), { name, system, content, schema, effort, main: true });
  return r.answer;
}

// Shorthand for strict object schemas: every listed property is required.
export const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
export const arr = (items) => ({ type: "array", items });
export const str = { type: "string" };
export const num = { type: "number" };
export const bool = { type: "boolean" };
export const oneOf = (...values) => ({ type: "string", enum: values });

// Asks Claude with web search turned on (Anthropic's server-side search, about 1¢ per search on top of tokens), for
// facts that aren't in the reference files, like a pack's MSRP. Answers JSON matching `schema`.
export async function askWithSearch({ name, system, text, schema, maxSearches = 5 }) {
  if (isDemo()) throw new Error(DEMO_MESSAGE);
  assertPipelineBudget(name); // this call goes straight to Anthropic (it doesn't pass askWith)
  const fake = fakeAnswer(name, "No web search in fake mode");
  if (fake) return fake.answer;
  const started = Date.now();
  const model = config.model;
  try {
    const message = await client.beta.messages
      .stream({
        model,
        max_tokens: 16000,
        system,
        messages: [{ role: "user", content: text }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches }],
        thinking: { type: "adaptive" },
        output_config: { effort: "medium", format: { type: "json_schema", schema } },
      })
      .finalMessage();
    const { text, usage } = readClaudeMessage(message, name);
    const searches = message.usage?.server_tool_use?.web_search_requests || 0;
    logAiCall({ trigger: "app", step: name, provider: "claude", model: message.model || model }, {
      ...usage,
      searches,
      costUsd: Number(((costOf(message.model || model, usage) ?? defaultCost(usage)) + searches * 0.01).toFixed(4)),
      aiMs: Date.now() - started,
    });
    return JSON.parse(text);
  } catch (err) {
    logAiCall({ trigger: "app", step: name, provider: "claude", model }, { error: err.message.split("\n")[0] });
    throw err;
  }
}
