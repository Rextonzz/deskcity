// The AI page asks which Gemini models exist: not when there is no Gemini key (nothing is sent), only when the key is in.
import test from "node:test";
import assert from "node:assert/strict";
import { hub, app } from "./helper.mjs";

await hub();
const AI = await import(app("src/pipeline/ai.js"));
const { config } = await import(app("src/config.js"));

let fetched = [];
globalThis.fetch = async (u) => {
  fetched.push(String(u));
  return new Response(JSON.stringify({ models: [{ name: "models/gemini-3-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-3-pro", supportedGenerationMethods: ["generateContent"] }] }), { status: 200 });
};

test("no Gemini key: resolving gemini-flash or gemini-pro sends nothing and says why", async () => {
  config.geminiApiKey = "";
  assert.equal(AI.hasGemini(), false);
  for (const m of ["gemini-flash", "gemini-pro"]) await assert.rejects(AI.resolveModel(m), /No Gemini key/);
  assert.equal(fetched.length, 0, "no request to the provider");
  // the Claude names never touch the network
  assert.equal((await AI.resolveModel("haiku")).provider, "claude");
  assert.equal(fetched.length, 0);
});

test("with a Gemini key the list is asked for (once, then kept for a day)", async () => {
  config.geminiApiKey = "test-not-real-gemini-key-1234567890";
  assert.equal(AI.hasGemini(), true);
  assert.equal((await AI.resolveModel("gemini-flash")).model, "gemini-3-flash");
  assert.equal((await AI.resolveModel("gemini-pro")).model, "gemini-3-pro");
  assert.equal(fetched.length, 1);
  assert.match(fetched[0], /generativelanguage\.googleapis\.com/);
});
