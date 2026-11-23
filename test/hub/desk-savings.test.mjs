// R&D outcome 1 (2026-11-23): cheaper hub-run desks. Both switches (data/ai.json deskSavings.cache / .batch) are off by
// default; on, the standing block is cached and can-wait jobs go by batch at half price, booked as such in the ledger.
// Stand-in Google: no network.
import test from "node:test";
import assert from "node:assert/strict";
import { hub, app } from "./helper.mjs";

const { A } = await hub();
const ai = await import(app("src/pipeline/ai.js"));
const { bookedCost } = await import(app("src/pipeline/claude.js"));
const { config } = await import(app("src/config.js"));
config.geminiApiKey = "test-key";
process.env.GEMINI_BATCH_POLL_MS = "1";

const rnd = { id: "rnd-scout", room: "rnd", role: "idea scout", provider: "gemini" };
const assistant = { id: "assistant", room: "hub", role: "the shared assistant", provider: "gemini" };

test("off by default: no job waits for a batch and the desk prompt is as before", () => {
  assert.deepEqual(ai.aiSettings().deskSavings, { cache: false, batch: false });
  assert.equal(A.canWaitJob(rnd, { text: "weekly scan" }), false);
  const asked = A.deskAsk({ ...rnd, id: "hub-builder", room: "hub" }, { id: "0000000000", text: "x" });
  assert.equal(asked.cached, undefined);
  assert.doesNotMatch(asked.system, /Your task in this step/);
});

test("batch on: R&D and research wait; chats, PR reviews and the owner's Run now stay live", () => {
  ai.saveAiSettings({ deskSavings: { batch: true } });
  try {
    assert.equal(A.canWaitJob(rnd, { text: "weekly scan of tools" }), true);
    assert.equal(A.canWaitJob({ id: "finance-lead", room: "finance", role: "Finance" }, { text: "weekly money note" }), true);
    assert.equal(A.canWaitJob(assistant, { text: "weekly scan" }), false, "the assistant is a chat");
    assert.equal(A.canWaitJob({ id: "security-reviewer", room: "hub", role: "reviews PRs" }, { text: "x" }), false);
    assert.equal(A.canWaitJob(rnd, { text: "review PR #301 before the merge" }), false, "a PR is waited on");
    assert.equal(A.canWaitJob(rnd, { text: "weekly scan" }, { approve: true }), false, "Run now means now");
    assert.equal(A.canWaitJob({ ...assistant, batch: true }, { text: "x" }), true, "a desk card can opt in");
    assert.equal(A.canWaitJob({ ...rnd, batch: false }, { text: "x" }), false, "or out");
  } finally { ai.saveAiSettings({ deskSavings: { batch: false } }); }
});

test("cache on: the standing block comes first, then the task mark, then the per-job lines", () => {
  ai.saveAiSettings({ deskSavings: { cache: true } });
  try {
    const desk = { id: "hub-builder", room: "hub", role: "builds the hub", provider: "claude" };
    const a = A.deskAsk(desk, { id: "0000000001", text: "first job" });
    const b = A.deskAsk(desk, { id: "0000000002", text: "another job", prevDesk: "assistant" });
    assert.equal(a.cached, true);
    const [standA] = a.system.split("\n\n---\n\n## Your task in this step\n");
    const [standB] = b.system.split("\n\n---\n\n## Your task in this step\n");
    assert.match(a.system, /Your task in this step/);
    assert.equal(standA, standB, "the cached block is the same from job to job");
    assert.match(standA, /^You are "hub-builder"/);
    assert.match(standA, /project pages/);
  } finally { ai.saveAiSettings({ deskSavings: { cache: false } }); }
});

test("a Gemini batch call: sent to batchGenerateContent, read like a live answer, cached tokens counted once, half price booked", async () => {
  const real = globalThis.fetch, urls = [];
  globalThis.fetch = async (url, init) => {
    urls.push(String(url));
    if (/:batchGenerateContent$/.test(url)) {
      const req = JSON.parse(init.body).batch.inputConfig.requests.requests[0].request;
      assert.deepEqual(req.generationConfig.responseJsonSchema, { type: "object" });
      return { ok: true, status: 200, json: async () => ({ name: "batches/abc", metadata: { state: "BATCH_STATE_PENDING" } }) };
    }
    return { ok: true, status: 200, json: async () => ({ name: "batches/abc", done: true, metadata: { state: "BATCH_STATE_SUCCEEDED" }, response: { inlinedResponses: { inlinedResponses: [{ metadata: { key: "1" }, response: { candidates: [{ content: { parts: [{ text: '{"answer":"ok"}' }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10000, cachedContentTokenCount: 4000, candidatesTokenCount: 1000 } } }] } } }) };
  };
  try {
    const r = await ai.askGemini({ model: "gemini-3.8-flash", system: "s", content: "q", schema: { type: "object" }, batch: true });
    assert.deepEqual(r.answer, { answer: "ok" });
    assert.equal(r.batch, true);
    assert.equal(r.usage.inputTokens, 6000, "promptTokenCount includes the cached 4000");
    assert.equal(r.usage.cacheReadTokens, 4000);
    assert.match(urls[0], /gemini-3\.8-flash:batchGenerateContent$/);
    assert.match(urls[1], /batches\/abc$/);
    const full = ai.costOf(r.model, r.usage);
    assert.equal(bookedCost(r, { provider: "gemini", model: r.model }, "desk_x").costUsd, Number((full / 2).toFixed(4)));
  } finally { globalThis.fetch = real; }
});

test("a failed Gemini batch request comes back as an error, not an empty answer", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => /:batchGenerateContent$/.test(url)
    ? { ok: true, status: 200, json: async () => ({ name: "batches/x" }) }
    : { ok: true, status: 200, json: async () => ({ done: true, metadata: { state: "BATCH_STATE_SUCCEEDED" }, response: { inlinedResponses: { inlinedResponses: [{ error: { code: 400, message: "bad request" } }] } } }) };
  try {
    await assert.rejects(ai.askGemini({ model: "gemini-3.8-flash", system: "s", content: "q", schema: { type: "object" }, batch: true }), /Gemini answered 400: bad request/);
  } finally { globalThis.fetch = real; }
});
