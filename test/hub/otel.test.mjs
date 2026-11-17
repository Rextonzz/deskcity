// OpenTelemetry ingest: OTLP/JSON spans -> hub events (src/pipeline/otel.js) and the route's key check and size caps.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import express from "express";
import { hub, app, ROOMS, DESKS } from "./helper.mjs";

const realFetch = globalThis.fetch; // the helper blocks fetch; the test talks to its own local server
const { A, data } = await hub({ rooms: ROOMS, desks: [...DESKS, { id: "game-gemini", room: "game", role: "x", provider: "gemini", model: "gemini-3-pro", status: "active", aliases: ["my-agent-app"] }] });
const { spansToEvents, MAX_SPANS } = await import(app("src/pipeline/otel.js"));
const { agentIngestRoutes } = await import(app("src/routes/agents.js"));
const desks = A.roster().desks;

const kv = (k, v) => ({ key: k, value: typeof v === "number" ? { intValue: String(v) } : typeof v === "boolean" ? { boolValue: v } : { stringValue: String(v) } });
const span = (attrs, extra = {}) => ({ traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7", name: "SECRET span name", attributes: Object.entries(attrs).map(([k, v]) => kv(k, v)), ...extra });
const req = (spans, resAttrs = {}) => ({ resourceSpans: [{ resource: { attributes: Object.entries(resAttrs).map(([k, v]) => kv(k, v)) }, scopeSpans: [{ spans }] }] });

test("LLM span with usage becomes a 'turn done' with tokens, model and session", () => {
  const r = spansToEvents(req([span({ "gen_ai.operation.name": "chat", "gen_ai.system": "anthropic", "gen_ai.request.model": "claude-a", "gen_ai.response.model": "claude-b", "gen_ai.usage.input_tokens": 1200, "gen_ai.usage.output_tokens": 340, "gen_ai.usage.cache_read.input_tokens": 50 })], { "service.name": "game-lead" }), desks);
  assert.equal(r.events.length, 1);
  assert.deepEqual(r.events[0], { desk: "game-lead", room: "game", source: "otel", provider: "claude", model: "claude-b", session: "4bf92f3577b34da6a3ce929d0e0e4736", action: "turn done", inputTokens: 1200, outputTokens: 340, cacheReadTokens: 50, summary: "chat claude-b" });
});

test("tool span becomes action 'tool'; old attribute names work; ERROR status sets failed", () => {
  const r = spansToEvents(req([
    span({ "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "read_file" }),
    span({ "gen_ai.tool.name": "grep" }, { status: { code: 2, message: "boom: secret text" } }),
    span({ "gen_ai.system": "google", "gen_ai.usage.prompt_tokens": 10, "gen_ai.usage.completion_tokens": 5 }, { status: { code: "STATUS_CODE_ERROR" } }),
  ]), desks);
  assert.deepEqual(r.events.map((e) => [e.action, e.tool, e.failed === true]), [["tool", "read_file", false], ["tool", "grep", true], ["turn done", undefined, true]]);
  assert.equal(r.events[2].provider, "gemini");
  assert.equal(r.events[2].inputTokens, 10);
});

test("desk and room: alias, explicit hub.desk / hub.room, unknown service", () => {
  const llm = { "gen_ai.operation.name": "chat", "gen_ai.usage.input_tokens": 1 };
  const d = (resAttrs, attrs = {}) => spansToEvents(req([span({ ...llm, ...attrs })], resAttrs), desks).events[0];
  assert.deepEqual([d({ "service.name": "my-agent-app" }).desk, d({ "service.name": "my-agent-app" }).room], ["game-gemini", "game"]);
  assert.deepEqual([d({ "service.name": "who-knows" }).desk, d({ "service.name": "who-knows" }).room], ["temp-worker", "unassigned"]);
  assert.deepEqual([d({ "service.name": "who-knows", "hub.desk": "game-artist" }).desk, d({ "service.name": "who-knows", "hub.desk": "game-artist" }).room], ["game-artist", "game"]);
  const e = d({ "service.name": "x", "hub.room": "hub" }, { "hub.desk": "game-lead" });
  assert.deepEqual([e.desk, e.room], ["game-lead", "hub"]);
  assert.deepEqual([d({}).desk, d({}).room], ["temp-worker", "unassigned"]);
});

test("spans with no GenAI attributes are skipped, and content never reaches the event", () => {
  const r = spansToEvents(req([
    span({ "http.method": "GET" }),
    span({ "gen_ai.operation.name": "chat", "gen_ai.usage.output_tokens": 3, "gen_ai.input.messages": "TOPSECRET prompt", "gen_ai.output.messages": "TOPSECRET reply", "gen_ai.tool.call.arguments": "TOPSECRET", "gen_ai.system_instructions": "TOPSECRET" }),
  ]), desks);
  assert.equal(r.skipped, 1);
  assert.equal(r.events.length, 1);
  assert.ok(!JSON.stringify(r.events).includes("TOPSECRET"));
  assert.ok(!JSON.stringify(r.events).includes("SECRET span name"));
});

test("at most MAX_SPANS spans per request", () => {
  const spans = Array.from({ length: MAX_SPANS + 25 }, () => span({ "gen_ai.operation.name": "chat", "gen_ai.usage.input_tokens": 1 }));
  const r = spansToEvents(req(spans), desks);
  assert.equal(r.events.length, MAX_SPANS);
  assert.equal(r.rejected, 25);
});

// ---- the route, on a local server ----
const server = express();
server.use(express.json({ limit: "2mb" }));
agentIngestRoutes(server);
const httpd = http.createServer(server);
await new Promise((r) => httpd.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${httpd.address().port}/api/agents/ingest/otel/v1/traces`;
const key = A.ingestToken();
const stored = () => (fs.existsSync(data("events.jsonl")) ? fs.readFileSync(data("events.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) : []);
const post = (body, { auth = `Bearer ${key}`, type = "application/json", raw } = {}) => realFetch(base, { method: "POST", headers: { "Content-Type": type, ...(auth ? { Authorization: auth } : {}) }, body: raw ?? JSON.stringify(body) });
test.after(() => httpd.close());

test("route: a wrong or missing key is refused and nothing is recorded", async () => {
  const body = req([span({ "gen_ai.operation.name": "chat", "gen_ai.usage.input_tokens": 77 })], { "service.name": "game-lead" });
  assert.equal((await post(body, { auth: null })).status, 401);
  assert.equal((await post(body, { auth: "Bearer nope" })).status, 401);
  assert.ok(!stored().some((e) => e.inputTokens === 77));
});

test("route: spans are stored as agent events; caps and content type are enforced", async () => {
  const ok = await post(req([span({ "gen_ai.operation.name": "chat", "gen_ai.usage.input_tokens": 4242, "gen_ai.usage.output_tokens": 7, "gen_ai.input.messages": "TOPSECRET" })], { "service.name": "game-lead" }));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), {});
  const live = A.deskLive("game-lead");
  assert.ok(live.steps.some((s) => s.action === "turn done"));
  const e = stored().filter((x) => x.source === "otel" && x.inputTokens === 4242).pop();
  assert.ok(e, "event saved");
  assert.ok(!JSON.stringify(e).includes("TOPSECRET"));

  const many = await post(req(Array.from({ length: MAX_SPANS + 5 }, () => span({ "gen_ai.tool.name": "t" }))));
  assert.equal(many.status, 200);
  assert.equal((await many.json()).partialSuccess.rejectedSpans, 5);

  const big = await realFetch(base, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ pad: "x".repeat(1100 * 1024) }) });
  assert.equal(big.status, 413);
  assert.equal((await post(null, { type: "application/x-protobuf", raw: "\u0001\u0002" })).status, 415);
});
