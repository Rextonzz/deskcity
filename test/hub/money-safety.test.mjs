// Money safety (adversarial review 2026-11-16, docs/handoffs/adversarial-review-2026-11-16.md): caps that hold, priced
// models only, passwords and hourly limits on every spend route. Stand-in providers only: fetch is replaced in this
// process, nothing reaches the network, the keys are fake.
process.env.TZ = "UTC"; // the server clock is not on the hub's time; the hub must still use its own zone (S4)
process.env.OPENAI_API_KEY = "test-not-real";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import express from "express";
import path from "node:path";
import { hub, app, APP, ROOMS, DESKS } from "./helper.mjs";

const desks = [
  ...DESKS,
  { id: "hub-lead", room: "hub", role: "Hub lead", lead: true, provider: "claude", model: "claude-code", status: "active" },
  { id: "oa", room: "game", role: "OpenAI writer", provider: "openai", model: "gpt-x", effort: "low", capUsdMonth: 0.01, status: "active", runner: "hub" },
  { id: "loc", room: "game", role: "Local writer", provider: "local", model: "llama-test", status: "active", runner: "hub" },
  { id: "capd", room: "game", role: "Writer", provider: "claude", model: "claude-haiku-5-5", effort: "low", capUsdMonth: 1, status: "active", runner: "hub" },
  { id: "tiny", room: "game", role: "Writer", provider: "claude", model: "claude-haiku-5-5", effort: "low", capUsdMonth: 0.001, status: "active", runner: "hub" },
  { id: "par1", room: "game", role: "Writer", provider: "claude", model: "claude-haiku-5-5", effort: "low", capUsdMonth: 5, status: "active", runner: "hub" },
  { id: "par2", room: "game", role: "Writer", provider: "claude", model: "claude-haiku-5-5", effort: "low", capUsdMonth: 5, status: "active", runner: "hub" },
  { id: "auto1", room: "game", role: "Writer", provider: "claude", model: "claude-haiku-5-5", effort: "low", capUsdMonth: 5, status: "active", runner: "hub" },
];
const { A, root, fake } = await hub({ rooms: ROOMS, desks });
process.env.OPENAI_API_KEY = "test-not-real"; // after the helper cleared the keys
const SPEND = await import(app("src/pipeline/spend.js"));
const SETTINGS = await import(app("src/hub/settings.js"));
const CLAUDE = await import(app("src/pipeline/claude.js"));
const COMPAT = await import(app("src/pipeline/openai-compat.js"));
const AI = await import(app("src/pipeline/ai.js"));

const settings = (s) => { fs.writeFileSync(`${root}/data/hub-settings.json`, JSON.stringify({ place: { timezone: "America/Chicago" }, ...s })); SETTINGS.resetHubSettings(); };
settings({});
const ANSWER = { summary: "Done.", output: "The text.", followups: [], questions_for_owner: [], handoff_to: "", handoff_task: "" };
const job = async (desk, text = "Write it.") => (await A.addJob({ desk, text }, { by: "owner" })).id;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const book = (step, costUsd) => SPEND.appendSpend({ kind: "ai call", step, provider: "claude", model: "claude-haiku-5-5", costUsd });
const deskUsd = (id) => SPEND.spendThisMonth().filter((r) => r.desk === id).reduce((t, r) => t + r.costUsd, 0);
// A stand-in OpenAI-style server: what fetch would get back. Records every request.
function openaiStandIn({ model = "gpt-x", promptTokens = 1_000_000 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), auth: opts?.headers?.authorization || null });
    const body = { model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(ANSWER) } }], usage: { prompt_tokens: promptTokens, completion_tokens: 0 } };
    return { ok: true, status: 200, json: async () => body };
  };
  return calls;
}
const blockFetch = () => { globalThis.fetch = async (u) => { throw new Error(`test tried to reach the network: ${String(u).slice(0, 80)}`); }; };
// askAs without the canned answers, so the real askWith / askOpenAI path runs against the stand-in
async function liveAsk(args) {
  const was = process.env.PIPELINE_FAKE_CLAUDE;
  delete process.env.PIPELINE_FAKE_CLAUDE;
  try { return await CLAUDE.askAs({ system: "s", content: "c", schema: { type: "object" }, effort: "low", ...args }); }
  finally { process.env.PIPELINE_FAKE_CLAUDE = was; }
}

// ---------- B1: no price, no hub run ----------
test("B1: a hub desk on an unpriced OpenAI-style model is refused before any call, naming the setting", async () => {
  let asked = 0;
  const id = await job("oa");
  await assert.rejects(() => A.runJob(id, { ask: async () => (asked++, ANSWER) }), /providers\.openai\.prices\["gpt-x"\] = \{ "in"/);
  assert.equal(asked, 0);
  assert.ok(!["taken", "done", "failed"].includes(A.jobs().find((j) => j.id === id).status), "the job waits; nothing ran");
  assert.equal(A.priceGapFor("local", "anything"), null, "local models are free by design");
  assert.equal(A.priceGapFor("claude", "claude-haiku-5-5"), null);
  assert.equal(A.priceGapFor("gemini", "gemini-flash"), null);
  assert.match(A.priceGapFor("claude", "claude-new-9"), /data\/ai\.json/);
});

test("B1: with a price in the settings the same desk runs", async () => {
  settings({ providers: { openai: { prices: { "gpt-x": { in: 1, out: 2 } } } } });
  try {
    const id = await job("oa");
    const out = await A.runJob(id, { ask: async () => ANSWER });
    assert.equal(out.status, "done");
  } finally { settings({}); }
});

test("B1: a local desk needs no price and no cap", async () => {
  const out = await A.runJob(await job("loc"), { ask: async () => ANSWER });
  assert.equal(out.status, "done");
});

test("B1: a paid call that comes back with no cost is booked at the dearest built-in rate, with one event", async () => {
  const calls = openaiStandIn({ model: "gpt-x-2026" });
  try {
    const before = SPEND.spendThisMonth().length;
    await liveAsk({ name: "desk_oa", provider: "openai", model: "gpt-x" });
    assert.equal(calls.length, 1);
    const rows = SPEND.spendThisMonth().slice(before);
    assert.equal(rows.length, 1, "the ledger row is never dropped");
    assert.equal(rows[0].desk, "oa");
    assert.equal(rows[0].costDefault, true);
    assert.equal(rows[0].costUsd, AI.defaultCost({ inputTokens: 1_000_000 }));
    assert.equal(AI.DEFAULT_PRICE_MODEL, "claude-fable-5-1");
    assert.equal(rows[0].costUsd, 10); // 1M input tokens at $10 per million
    const ev = A.readEvents().filter((e) => e.desk === "oa" && e.action === "cost unknown");
    assert.equal(ev.length, 1);
    assert.match(ev[0].summary, /^cost unknown: booked at the default rate/);
  } finally { blockFetch(); }
});

// ---------- B2: only the pet's own id is never costed ----------
test("B2: pet Lea doesn't hide hub-lead's spend; the pet's own id is still skipped", () => {
  settings({ pet: { name: "Lea", kind: "cat" } });
  try {
    SPEND.appendSpend({ kind: "agent event", desk: "hub-lead", room: "hub", costUsd: 120, billing: "api" });
    SPEND.appendSpend({ kind: "agent event", desk: "lea", room: "hub", costUsd: 7, billing: "api" });
    SPEND.appendSpend({ kind: "agent event", desk: "visitor", room: "lea", costUsd: 3, billing: "api" });
    assert.equal(deskUsd("hub-lead"), 120);
    assert.equal(deskUsd("lea"), 0);
    assert.equal(deskUsd("visitor"), 0);
  } finally { settings({}); }
});

test("B2: with no pet nothing is skipped", () => {
  settings({ pet: { name: "" } });
  try {
    assert.equal(SETTINGS.petName(), null);
    SPEND.appendSpend({ kind: "agent event", desk: "biscuit", room: "hub", costUsd: 1.5, billing: "api" });
    assert.equal(deskUsd("biscuit"), 1.5);
  } finally { settings({}); }
});

// ---------- F2: one hub run per desk at a time ----------
test("F2: $1 cap, $0.90 spent, five jobs at once on one desk at $0.50 each: exactly one runs", async () => {
  book("desk_capd", 0.9);
  let calls = 0;
  const ask = async (o) => { calls++; await wait(15); book(o.name, 0.5); return ANSWER; };
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(await job("capd", `Job ${i}`));
  const out = await Promise.allSettled(ids.map((id) => A.runJob(id, { ask })));
  assert.equal(calls, 1);
  assert.equal(out.filter((x) => x.status === "fulfilled").length, 1);
  const refused = out.filter((x) => x.status === "rejected");
  assert.equal(refused.length, 4);
  for (const r of refused) assert.match(r.reason.message, /capd has used its \$1 cap this month \(\$1\.40\)/);
  assert.equal(Math.round(deskUsd("capd") * 100) / 100, 1.4);
});

test("a desk over a tiny cap is refused, and the message keeps the digits of what it spent (not \"$0.00\")", async () => {
  book("desk_tiny", 0.0014);
  const id = await job("tiny", "Say hello.");
  await assert.rejects(() => A.runJob(id, { ask: async () => { throw new Error("must not call the AI"); } }), /tiny has used its \$0\.001 cap this month \(\$0\.0014\)/);
});

test("F2: two desks under their caps still run side by side", async () => {
  let now = 0, most = 0;
  const ask = async () => { now++; most = Math.max(most, now); await wait(20); now--; return ANSWER; };
  const [a, b] = [await job("par1"), await job("par2")];
  const out = await Promise.all([A.runJob(a, { ask }), A.runJob(b, { ask })]);
  assert.deepEqual(out.map((x) => x.status), ["done", "done"]);
  assert.equal(most, 2);
});

test("F2: two automatic starts at once: the second sees the first's count", async () => {
  process.env.HUB_AUTORUN_PER_DAY = "1";
  fake("desk_job", ANSWER);
  try {
    const before = A.autoRunsToday();
    process.env.HUB_AUTORUN_PER_DAY = String(before + 1);
    await Promise.all([
      A.autoHandOff({ from: "game-lead", to: "auto1", text: "Do part one." }),
      A.autoHandOff({ from: "game-lead", to: "auto1", text: "Do part two." }),
    ]);
    assert.equal(A.autoRunsToday(), before + 1);
    const waits = A.readEvents().filter((e) => e.desk === "auto1" && e.action === "waiting to run");
    assert.equal(waits.length, 1);
    await wait(50);
  } finally { process.env.HUB_AUTORUN_PER_DAY = "none"; }
});

test("F2/S5: two helper calls at once at the helpers' daily limit: the second sees the first's cost", async () => {
  settings({ providers: { openai: { prices: { "gpt-p": { in: 0.5, out: 0 } } } } });
  process.env.HUB_HELPERS_PER_DAY = "1";
  const calls = openaiStandIn({ model: "gpt-p", promptTokens: 1_000_000 }); // $0.50 a call
  try {
    SPEND.appendSpend({ kind: "ai call", step: "campus_chatter", provider: "claude", model: "claude-haiku-5-5", costUsd: 0.9 });
    const out = await Promise.allSettled([1, 2].map(() => liveAsk({ name: "campus_store_idea", provider: "openai", model: "gpt-p" })));
    assert.equal(calls.length, 1);
    assert.equal(out[0].status, "fulfilled");
    assert.equal(out[1].status, "rejected");
    assert.match(out[1].reason.message, /AI helpers reached today's limit of \$1/);
  } finally { process.env.HUB_HELPERS_PER_DAY = "none"; blockFetch(); settings({}); }
});

// ---------- S4: the auto-run limit counts the hub's day ----------
test("S4: auto-runs earlier this evening (hub time, Chicago) still count after UTC midnight", () => {
  const file = `${root}/data/agents/autorun.jsonl`;
  const was = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  try {
    fs.writeFileSync(file, [{ at: "2026-11-13T20:00:00.000Z", job: "a" }, { at: "2026-11-13T23:30:00.000Z", job: "b" }, { at: "2026-11-13T02:00:00.000Z", job: "old" }].map((x) => JSON.stringify(x)).join("\n") + "\n");
    // 8 pm Nov 13 in Chicago is already Nov 14 in UTC: the old UTC count said 0
    assert.equal(A.autoRunsToday(new Date("2026-11-14T02:00:00.000Z")), 2);
    // 6 am Nov 14 in Chicago: a new hub day
    assert.equal(A.autoRunsToday(new Date("2026-11-14T12:00:00.000Z")), 0);
  } finally { fs.writeFileSync(file, was); }
});

// ---------- S2: a key only goes to its own provider ----------
test("S2: an OpenAI key pointed at another host is refused before any request", async () => {
  settings({ providers: { openai: { baseUrl: "https://evil.example/v1", prices: { "gpt-x": { in: 1, out: 1 } } } } });
  const calls = openaiStandIn();
  try {
    await assert.rejects(() => COMPAT.askOpenAI({ provider: "openai", model: "gpt-x", system: "s", content: "c", schema: {} }), /OPENAI_API_KEY to evil\.example, but that key may only go to api\.openai\.com/);
    assert.equal(calls.length, 0);
    assert.equal(COMPAT.compatReady("openai"), false);
  } finally { blockFetch(); settings({}); }
});

test("S2: the rules for keys and addresses (the setup tool uses the same check)", () => {
  const P = COMPAT.providerProblem;
  assert.equal(P("openai", {}), null);
  assert.equal(P("openai", { baseUrl: "https://api.openai.com/v1" }), null);
  assert.match(P("openai", { baseUrl: "https://evil.example/v1" }), /may only go to api\.openai\.com/);
  assert.match(P("grok", { keyEnv: "ANTHROPIC_API_KEY" }), /ANTHROPIC_API_KEY to api\.x\.ai/);
  assert.match(P("deepseek", { baseUrl: "https://proxy.example/v1", keyEnv: "OPENAI_API_KEY" }), /may only go to api\.openai\.com/);
  assert.equal(P("openai", { baseUrl: "https://proxy.example/v1", keyEnv: "PROXY_KEY" }), null, "a key name of its own is fine");
  assert.equal(P("openai", { baseUrl: "https://proxy.example/v1", key: "inline" }), null, "an inline key is fine");
  assert.equal(P("local", {}), null);
  assert.equal(P("local", { baseUrl: "http://localhost:1234/v1", keyEnv: "ANTHROPIC_API_KEY" }), null, "local never sends a key");
  assert.match(fs.readFileSync(path.join(APP, "tools", "setup.mjs"), "utf8"), /providerProblem\(id, p\)/);
});

// ---------- S1: reported costs ----------
test("S1: a desk's reported cost past 3x its cap in a day is kept at $0, with one event", () => {
  // game-artist: $3 cap, so $9 a day
  for (let i = 0; i < 4; i++) A.recordEvent({ desk: "game-artist", action: "note", summary: `post ${i}`, costUsd: 2.5, billing: "api" }, "claude-code");
  const ev = A.readEvents().filter((e) => e.desk === "game-artist" && /^post \d$/.test(e.summary));
  assert.deepEqual(ev.map((e) => e.costUsd), [2.5, 2.5, 2.5, 0]);
  assert.equal(ev[3].costIgnored, true);
  A.recordEvent({ desk: "game-artist", action: "note", summary: "post 4", costUsd: 2, billing: "api" }, "claude-code");
  const notes = A.readEvents().filter((e) => e.desk === "game-artist" && e.action === "cost ignored");
  assert.equal(notes.length, 1);
  assert.match(notes[0].summary, /^reported cost ignored: over the daily ceiling/);
  A.recordEvent({ desk: "game-artist", action: "note", summary: "hub own", costUsd: 20, billing: "api" }, "hub");
  assert.equal(A.readEvents().find((e) => e.summary === "hub own").costUsd, 20, "the hub's own costs have no ceiling");
});

// ---------- routes: F3, S1 rate limits, F4 passwords ----------
const { agentsRouter, agentIngestRoutes, COST_POSTS_PER_DESK } = await import(app("src/routes/agents.js"));
const { pipelineRouter } = await import(app("src/routes/pipeline.js"));
const web = express();
web.use(express.json({ limit: "2mb" }));
agentIngestRoutes(web);
web.use("/a", agentsRouter);
web.use("/p", pipelineRouter);
const srv = web.listen(0, "127.0.0.1");
await new Promise((r) => srv.once("listening", r));
const port = srv.address().port;
test.after(() => srv.close());
const post = (path, body = {}, headers = {}) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const rq = http.request({ host: "127.0.0.1", port, path, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), Host: "localhost", ...headers } }, (res) => {
    let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => { let b = {}; try { b = JSON.parse(t || "{}"); } catch {} resolve({ status: res.statusCode, body: b }); });
  });
  rq.on("error", reject); rq.end(data);
});
const needs = (r, what) => { assert.equal(r.status, 403, `${what}: ${JSON.stringify(r.body)}`); assert.equal(r.body.needPassword, true, what); };

test("F3/F4: with a password set, every route that can spend asks for it", async () => {
  process.env.DASHBOARD_PASSWORD_HASH = "test-hash";
  try {
    const J = "demo-20261116120000-ab12";
    for (const p of ["/a/store/suggest", "/a/short", "/a/hr/run", `/p/jobs/${J}/continue`, `/p/jobs/${J}/retry`, `/p/jobs/${J}/unskip`, `/p/jobs/${J}/restart`, `/p/jobs/${J}/full-price`, "/p/batch/push",
      "/p/stats/rules/x", "/p/stats/insights/x", "/p/stats/creators/check", "/p/collection/photo", "/p/collection/photo-multi", "/p/collection/tradeup/ideas", "/p/collection/deckideas", "/p/health/run", "/p/upload/x?test=1"])
      needs(await post(p, {}), p);
    needs(await post("/p/lookup", { image: "aGk=" }), "lookup with a photo");
    needs(await post("/a/gift", { desk: "game-artist", item: "short" }), "a Short as a gift");
  } finally { delete process.env.DASHBOARD_PASSWORD_HASH; }
});

test("F3: with no password the PC passes, but each button has an hourly limit", async () => {
  for (const p of ["/a/store/suggest", "/a/short"]) {
    const res = [];
    for (let i = 0; i < 7; i++) res.push(await post(p, { desk: "game-artist" }));
    assert.notEqual(res[0].status, 403, p);
    assert.equal(res[6].status, 429, `${p}: ${JSON.stringify(res[6].body)}`);
  }
});

test("F3: store ideas and Shorts stop when the store's budget is used up", async () => {
  settings({ store: { budgetUsd: 0 } });
  try {
    await assert.rejects(() => A.suggestStoreItem("game-artist"), /store's budget for this month is used up/);
    await assert.rejects(() => A.watchShort("game-artist"), /store's budget for this month is used up/);
  } finally { settings({}); }
});

test("F3: HR checks its own cap before any model call", async () => {
  const HR = await import(app("src/pipeline/hr.js"));
  book("hr_review", 2.5); // HR's cap is $2
  assert.match(HR.hrCapStop(), /HR has used its \$2 cap this month/);
  await assert.rejects(() => HR.runHr({ trigger: "button" }), /HR has used its \$2 cap/);
});

test("S1: cost-bearing posts are limited per desk each minute", async () => {
  const key = A.ingestToken();
  const auth = { Authorization: `Bearer ${key}` };
  let last;
  for (let i = 0; i <= COST_POSTS_PER_DESK; i++) last = await post("/api/agents/ingest/event", { desk: "game-lead", action: "note", summary: `c${i}`, costUsd: 0.01, billing: "api" }, auth);
  assert.equal(last.status, 429, JSON.stringify(last.body));
  assert.match(last.body.error, /cost posts for game-lead/);
  const other = await post("/api/agents/ingest/event", { desk: "game-artist", action: "note", summary: "other desk", costUsd: 0.01, billing: "api" }, auth);
  assert.equal(other.status, 200, "another desk still posts");
  const plain = await post("/api/agents/ingest/event", { desk: "game-lead", action: "note", summary: "no cost" }, auth);
  assert.equal(plain.status, 200, "posts without a cost aren't limited by this");
});

// ---------- S8 / S9: sign-in lockout and sign out everywhere ----------
test("S8: wrong sign-ins at the PC don't lock the owner out after five; S9: Sign out everywhere needs the hub's own page", async () => {
  const SEC = await import(app("src/security.js"));
  const w = express();
  w.use(express.urlencoded({ extended: false }));
  w.use(SEC.sameOrigin);
  SEC.loginRoutes(w);
  const s = w.listen(0, "127.0.0.1");
  await new Promise((r) => s.once("listening", r));
  const p2 = s.address().port;
  const form = (path, headers = {}) => new Promise((resolve, reject) => {
    const data = "password=wrong&captcha=1&captcha_token=x";
    const rq = http.request({ host: "127.0.0.1", port: p2, path, method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(data), Host: `localhost:${p2}`, ...headers } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    rq.on("error", reject); rq.end(data);
  });
  try {
    process.env.DASHBOARD_PASSWORD_HASH = "test-hash";
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push(await form("/login"));
    assert.deepEqual(codes, [401, 401, 401, 401, 401, 401, 401], "no 429 at the PC after five");
    const fwd = [];
    for (let i = 0; i < 2; i++) fwd.push(await form("/login", { "x-forwarded-for": "203.0.113.9" }));
    assert.equal(fwd.at(-1), 429, "a forwarded visitor through loopback is still locked at five");
    delete process.env.DASHBOARD_PASSWORD_HASH;
    assert.equal(await form("/logout-all", { Origin: "null" }), 403, "Origin: null is refused");
    assert.equal(await form("/logout-all", { Origin: "https://evil.example" }), 403, "another website is refused");
    assert.equal(await form("/logout-all"), 403, "a post with no origin is refused");
    assert.equal(await form("/logout-all", { Origin: `http://localhost:${p2}` }), 303, "the hub's own page works");
  } finally { delete process.env.DASHBOARD_PASSWORD_HASH; s.close(); }
});

test("Admin health says to set a password when none is set", async () => {
  const H = await import(app("src/pipeline/health.js"));
  delete process.env.DASHBOARD_PASSWORD_HASH;
  assert.match(H.passwordCheck().detail, /Set a dashboard password to protect spending/);
  assert.equal(H.healthStatus().checks[0].name, "Dashboard password");
  process.env.DASHBOARD_PASSWORD_HASH = "test-hash";
  try { assert.equal(H.passwordCheck(), null); } finally { delete process.env.DASHBOARD_PASSWORD_HASH; }
});
