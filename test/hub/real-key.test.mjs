// isRealKey (one "set and not a your- placeholder" check) and the provider lists that follow COMPAT.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hub } from "./helper.mjs";

await hub();
const { config, isRealKey } = await import("../../src/config.js");
const { COMPAT } = await import("../../src/pipeline/openai-compat.js");
const { providersLine } = await import("../../src/pipeline/hr.js");
const { hasGemini } = await import("../../src/pipeline/ai.js");

test("isRealKey rejects empty and placeholder keys", () => {
  assert.equal(isRealKey(undefined), false);
  assert.equal(isRealKey(""), false);
  assert.equal(isRealKey("your-key-here"), false);
  assert.equal(isRealKey("AIzaSyReal123"), true);
});

test("the start-up key warning is only for a placeholder, not a missing key", async () => {
  const { isPlaceholderKey, hasPlaceholderAnthropicKey } = await import("../../src/config.js");
  assert.equal(isPlaceholderKey(undefined), false);
  assert.equal(isPlaceholderKey(""), false);
  assert.equal(isPlaceholderKey("your-key-here"), true);
  assert.equal(isPlaceholderKey("sk-ant-real"), false);
  const was = config.anthropicApiKey;
  try {
    config.anthropicApiKey = undefined;
    assert.equal(hasPlaceholderAnthropicKey(), false);
    config.anthropicApiKey = "your-anthropic-key";
    assert.equal(hasPlaceholderAnthropicKey(), true);
  } finally {
    config.anthropicApiKey = was;
  }
});

test("HR lists Gemini only for a real key", () => {
  const was = config.geminiApiKey;
  try {
    config.geminiApiKey = "your-gemini-key";
    assert.equal(hasGemini(), false);
    assert.doesNotMatch(providersLine(), /^gemini:/m);
    config.geminiApiKey = "AIzaSyReal123";
    assert.match(providersLine(), /^gemini:/m);
  } finally {
    config.geminiApiKey = was;
  }
});

test("COMPAT keeps the provider order of the hand-typed lists it replaced", () => {
  assert.deepEqual(Object.keys(COMPAT), ["openai", "grok", "deepseek", "muse", "local"]);
});
