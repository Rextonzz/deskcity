// claude.js helpers: the test-mode answers, reading a Claude message, and the run-log row for an AI call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hub } from "./helper.mjs";

const { fake } = await hub();
const { askJSON, askAs, askGeminiJSON, askWithSearch, readClaudeMessage, logAiCall } = await import("../../src/pipeline/claude.js");
const { readRuns } = await import("../../src/pipeline/runlog.js");

test("the four readers return the fake answer", async () => {
  fake("step_a", { x: 1 });
  fake("desk_job", { desk: true });
  assert.deepEqual(await askJSON({ name: "step_a", system: "s" }), { x: 1 });
  assert.deepEqual(await askAs({ name: "step_a", model: "m", provider: "claude", system: "s" }), { desk: true });
  assert.deepEqual(await askGeminiJSON({ name: "step_a" }), { x: 1 });
  assert.deepEqual(await askWithSearch({ name: "step_a" }), { x: 1 });
});

test("a missing fake file gives each reader its own error", async () => {
  await assert.rejects(askJSON({ name: "nope", system: "s" }), { code: "ENOENT" });
  await assert.rejects(askGeminiJSON({ name: "nope" }), /No Gemini in fake mode/);
  await assert.rejects(askWithSearch({ name: "nope" }), /No web search in fake mode/);
});

test("readClaudeMessage reads text and usage, and throws on refusal, cut-off or no text", () => {
  const ok = readClaudeMessage({ stop_reason: "end_turn", content: [{ type: "text", text: "a" }, { type: "thinking" }, { type: "text", text: "{}" }], usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4, cache_creation: { ephemeral_1h_input_tokens: 5 } } }, "s");
  assert.deepEqual(ok, { text: "{}", usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, cacheWrite1hTokens: 5 } });
  assert.equal(readClaudeMessage({ content: [{ type: "text", text: "{}" }] }, "s").usage.cacheWrite1hTokens, 0);
  assert.throws(() => readClaudeMessage({ stop_reason: "refusal", content: [] }, "s"), /declined the s step/);
  assert.throws(() => readClaudeMessage({ stop_reason: "max_tokens", content: [] }, "s"), /answer was cut off/);
  assert.throws(() => readClaudeMessage({ content: [{ type: "thinking" }] }, "s"), /no text for s/);
});

test("logAiCall writes an 'ai call' row", () => {
  logAiCall({ trigger: "app", step: "st", provider: "claude", model: "m", effort: "low" }, { inputTokens: 7, costUsd: 0.5 });
  const row = readRuns({ kinds: ["ai call"], limit: 1 })[0];
  assert.equal(row.step, "st");
  assert.equal(row.trigger, "app");
  assert.equal(row.provider, "claude");
  assert.equal(row.model, "m");
  assert.equal(row.effort, "low");
  assert.equal(row.inputTokens, 7);
  assert.equal(row.costUsd, 0.5);
});

test("compat-provider prices: local is free, unknown models are null, provider prices rank under data/ai.json", async () => {
  const { priceOf } = await import("../../src/pipeline/openai-compat.js");
  assert.equal(priceOf("local", "anything", { inputTokens: 1e6 }), 0);
  assert.equal(priceOf("openai", "no-such-model", { inputTokens: 5 }), null);
  assert.equal(priceOf("muse", "muse-spark-1", { inputTokens: 1e6, outputTokens: 1e6 }), 5.5);
  assert.equal(priceOf("muse", "muse-spark-1", { inputTokens: 1e6 }, { "muse-spark": { in: 2, out: 3 } }), 2);
  assert.equal(priceOf("openai", "gpt-x", { inputTokens: 1 }, { "gpt-": { in: 0.5, out: 1 } }), 0.000001);
});
