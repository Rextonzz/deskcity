// the owner 2026-11-20 ("OK web"): the desks the hub runs search the web themselves, so research steps stop queueing on the
// three PC desks that could. Gemini skips Google Search when the reply must match a JSON schema, so a search call goes
// without the schema and the JSON is read from its text (or made by a second call). Stand-in Google: no network.
import test from "node:test";
import assert from "node:assert/strict";
import { hub, app } from "./helper.mjs";

const { A } = await hub();
const { askGemini } = await import(app("src/pipeline/ai.js"));
const { config } = await import(app("src/config.js"));
config.geminiApiKey = "test-key";

const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
// Answers each request in turn; records what was sent.
function fakeGoogle(replies) {
  const sent = [], real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    const r = replies.shift();
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: r.text }] }, finishReason: "STOP", ...(r.queries ? { groundingMetadata: { webSearchQueries: r.queries } } : {}) }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }) };
  };
  return { sent, done: () => (globalThis.fetch = real) };
}

test("a search call goes without the schema, with Google Search, and its JSON comes from the text", async () => {
  const g = fakeGoogle([{ text: '```json\n{"answer":"53.17-r1"}\n```', queries: ["dfhack latest release", "dfhack 53.17"] }]);
  try {
    const r = await askGemini({ model: "gemini-flash", system: "s", content: "q", schema, search: 5 });
    assert.deepEqual(r.answer, { answer: "53.17-r1" });
    assert.equal(r.searches, 2);
    assert.equal(g.sent.length, 1);
    assert.deepEqual(g.sent[0].tools, [{ googleSearch: {} }]);
    assert.equal(g.sent[0].generationConfig.responseJsonSchema, undefined, "no schema, or Gemini skips the search");
    assert.match(g.sent[0].systemInstruction.parts[0].text, /JSON schema/);
  } finally { g.done(); }
});
test("text that isn't JSON gets one more call, with the schema and without search; tokens add up", async () => {
  const g = fakeGoogle([{ text: "DFHack 53.17-r1 is the latest (github.com/DFHack/dfhack).", queries: ["dfhack"] }, { text: '{"answer":"53.17-r1"}' }]);
  try {
    const r = await askGemini({ model: "gemini-flash", system: "s", content: "q", schema, search: 5 });
    assert.deepEqual(r.answer, { answer: "53.17-r1" });
    assert.equal(r.searches, 1);
    assert.equal(g.sent[1].tools, undefined);
    assert.deepEqual(g.sent[1].generationConfig.responseJsonSchema, schema);
    assert.match(g.sent[1].contents[0].parts[0].text, /latest/);
    assert.equal(r.usage.inputTokens, 20);
  } finally { g.done(); }
});
test("without search: the schema as before and no tools", async () => {
  const g = fakeGoogle([{ text: '{"answer":"x"}' }]);
  try {
    const r = await askGemini({ model: "gemini-flash", system: "s", content: "q", schema });
    assert.deepEqual(r.answer, { answer: "x" });
    assert.equal(g.sent[0].tools, undefined);
    assert.deepEqual(g.sent[0].generationConfig.responseJsonSchema, schema);
  } finally { g.done(); }
});
test("which desks search: hub-run Claude and Gemini desks, 5 a job by default; off, per desk, local and OpenAI-style: none", () => {
  assert.equal(A.deskSearches({ provider: "gemini" }, {}), 5);
  assert.equal(A.deskSearches({ provider: "claude" }, { perJob: 3 }), 3);
  assert.equal(A.deskSearches({ provider: "claude" }, { perJob: 99 }), 20, "capped");
  assert.equal(A.deskSearches({ provider: "gemini" }, { on: false }), 0);
  assert.equal(A.deskSearches({ provider: "gemini", webSearch: false }, {}), 0);
  assert.equal(A.deskSearches({ provider: "local" }, {}), 0);
  assert.equal(A.deskSearches({ provider: "openai" }, {}), 0);
});
