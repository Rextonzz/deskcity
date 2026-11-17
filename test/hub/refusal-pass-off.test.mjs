// Refusal pass-off (src/pipeline/refusal.js, runJob in src/pipeline/agents.js): a provider that declines a desk job is
// tagged and the job goes once to the next service; serious reasons or "everyone declined" put it in Waiting for you.
// Stand-in `ask` for every provider: no keys, no network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { hub, ROOMS, DESKS, app } from "./helper.mjs";

// fake keys, present before the hub's config loads (the helper then removes them from the environment, the config keeps them)
process.env.GEMINI_API_KEY = "test-not-real";
process.env.ANTHROPIC_API_KEY = "test-not-real";
process.env.HUB_HELPERS = "on";
process.env.HUB_PASSOFF = "on";

const desks = [
  ...DESKS,
  { id: "pa", room: "game", role: "Writer", provider: "claude", model: "claude-haiku-5-5", effort: "low", capUsdMonth: 5, status: "active", runner: "hub" },
  { id: "pa-off", room: "game", role: "Writer", provider: "claude", model: "claude-haiku-5-5", effort: "low", capUsdMonth: 5, status: "active", runner: "hub", passOff: false },
  { id: "oa", room: "game", role: "OpenAI writer", provider: "openai", model: "gpt-test", effort: "low", capUsdMonth: 5, status: "active", runner: "hub" },
];
const { A, root, data } = await hub({ rooms: ROOMS, desks });
process.env.OPENAI_API_KEY = "test-not-real"; // after the helper cleared the keys: openai is then "ready"
// the hub runs no unpriced model (money safety B1), so gpt-test gets a price
fs.writeFileSync(`${root}/data/hub-settings.json`, JSON.stringify({ providers: { openai: { prices: { "gpt-test": { in: 1, out: 2 } } } } }));
(await import(app("src/hub/settings.js"))).resetHubSettings();
const R = await import(app("src/pipeline/refusal.js"));
const SPEND = await import(app("src/pipeline/spend.js"));
const CLAUDE = await import(app("src/pipeline/claude.js"));
const GEM = await import(app("src/pipeline/ai.js"));
const COMPAT = await import(app("src/pipeline/openai-compat.js"));

const ANSWER = { summary: "Done.", output: "The text.", followups: [], questions_for_owner: [], handoff_to: "", handoff_task: "" };
const who = (o) => o.provider || (/gemini/.test(o.model || "") ? "gemini" : "claude");
// a stand-in provider: `plan` says what each provider does ("answer" or a refusal reason); it records every call
function standIn(plan) {
  const calls = [];
  const ask = async (o) => {
    const p = who(o);
    calls.push({ provider: p, model: o.model, content: String(o.content), name: o.name });
    const what = plan[p] ?? "answer";
    if (what === "answer") return ANSWER;
    if (what instanceof Error) throw what;
    throw new R.ProviderRefusal(`${p} declined`, { provider: p, model: o.model || "default", reason: what });
  };
  return { ask, calls };
}
const job = async (desk, text = "Write the scene.") => (await A.addJob({ desk, text }, { by: "owner" })).id;
const refusalRows = () => (fs.existsSync(data("refusals.jsonl")) ? fs.readFileSync(data("refusals.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const actions = (a, id) => A.readEvents().filter((e) => e.job === id && e.action === a);
const asksFor = (id) => A.requests().filter((q) => q.kind === "ask" && String(q.why).includes(id));
const jobOf = (id) => A.jobs().find((j) => j.id === id);

test("a: SAFETY from the first provider passes the job on once, with the history", async () => {
  const before = refusalRows().length;
  const { ask, calls } = standIn({ claude: "SAFETY" });
  const id = await job("pa");
  const out = await A.runJob(id, { ask });
  assert.deepEqual(calls.map((c) => c.provider), ["claude", "gemini"]);
  assert.equal(calls[1].model, "gemini-flash");
  assert.match(calls[1].content, /^Note from the hub: this job was declined by claude \(claude-haiku-5-5\), which gave this reason: "SAFETY"\./);
  assert.match(calls[1].content, /Write the scene\./);
  assert.equal(calls[1].name, "desk_pa");
  assert.equal(out.status, "done");
  assert.equal(jobOf(id).status, "done");
  assert.equal(refusalRows().length, before + 1);
  assert.equal(actions("provider refused", id).length, 1);
  assert.equal(actions("passed on", id).length, 1);
  assert.match(actions("job done", id)[0].summary, /answered by gemini after 1 refusal\)/);
  assert.equal(asksFor(id).length, 0);
});

test("b: a serious reason stops everything and asks the owner", async () => {
  const { ask, calls } = standIn({ claude: "this request involves weapons" });
  const id = await job("pa");
  await assert.rejects(() => A.runJob(id, { ask }), (e) => e instanceof R.ProviderRefusal);
  assert.equal(calls.length, 1);
  assert.equal(jobOf(id).status, "failed");
  assert.match(jobOf(id).summary, /Refused by claude: needs you/);
  const asks = asksFor(id);
  assert.equal(asks.length, 1);
  assert.match(asks[0].role, /pa job refused by claude/);
  assert.match(asks[0].why, /claude \(claude-haiku-5-5\): this request involves weapons/);
  assert.match(asks[0].why, /serious category/);
  assert.equal(actions("refusal stopped", id).length, 1);
  assert.ok(fs.readFileSync(data(`outputs/${id}.md`), "utf8").includes("weapons"));
});

test("c and d: every provider refuses; each is asked exactly once and the ask lists every reason", async () => {
  const { ask, calls } = standIn({ claude: "SAFETY", gemini: "OTHER", openai: "content_filter" });
  const id = await job("pa");
  await assert.rejects(() => A.runJob(id, { ask }), /declined/);
  const counts = {};
  for (const c of calls) counts[c.provider] = (counts[c.provider] || 0) + 1;
  assert.deepEqual(counts, { claude: 1, gemini: 1, openai: 1 });
  assert.equal(calls[2].model, "gpt-test");
  assert.match(calls[2].content, /also declined by gemini/);
  assert.equal(jobOf(id).status, "failed");
  const [q] = asksFor(id);
  assert.match(q.role, /refused by claude, gemini, openai/);
  for (const w of ["SAFETY", "OTHER", "content_filter", "Every allowed service declined"]) assert.ok(q.why.includes(w), w);
});

test("e: pass-off off hub-wide, and off for the desk: one refusal, no second ask, the owner is told", async () => {
  process.env.HUB_PASSOFF = "off";
  try {
    const s1 = standIn({ claude: "SAFETY" });
    const id1 = await job("pa");
    await assert.rejects(() => A.runJob(id1, { ask: s1.ask }), /declined/);
    assert.equal(s1.calls.length, 1);
    assert.match(asksFor(id1)[0].why, /pass-off is off/i);
  } finally { process.env.HUB_PASSOFF = "on"; }
  const s2 = standIn({ claude: "SAFETY" });
  const id2 = await job("pa-off");
  await assert.rejects(() => A.runJob(id2, { ask: s2.ask }), /declined/);
  assert.equal(s2.calls.length, 1);
  assert.match(asksFor(id2)[0].why, /pass-off is off/i);
});

test("f: a desk at its cap after the first hop stops", async () => {
  const id = await job("pa");
  const plan = { claude: "SAFETY" };
  const calls = [];
  const ask = async (o) => {
    calls.push(who(o));
    SPEND.appendSpend({ kind: "ai call", step: "desk_pa", provider: "claude", model: "claude-haiku-5-5", costUsd: 6 });
    throw new R.ProviderRefusal("declined", { provider: "claude", model: "claude-haiku-5-5", reason: plan.claude });
  };
  await assert.rejects(() => A.runJob(id, { ask }), /declined/);
  assert.deepEqual(calls, ["claude"]);
  assert.match(asksFor(id)[0].why, /at its cap/);
  SPEND.appendSpend({ kind: "ai call", step: "desk_pa", provider: "claude", model: "x", costUsd: -6 }); // put the month back
});

test("g: a plain error is not a refusal: no pass-off, the job fails as before", async () => {
  const { ask, calls } = standIn({ claude: new Error("Claude answered 529: overloaded") });
  const id = await job("pa");
  await assert.rejects(() => A.runJob(id, { ask }), /overloaded/);
  assert.equal(calls.length, 1);
  assert.equal(jobOf(id).status, "failed");
  assert.match(jobOf(id).summary, /overloaded/);
  assert.equal(asksFor(id).length, 0);
  assert.equal(actions("provider refused", id).length, 0);
});

test("h: isSerious", () => {
  for (const [r, want] of [["SAFETY", false], ["no reason given", false], ["OTHER", false], ["content_filter", false], ["HARM_CATEGORY_SEXUALLY_EXPLICIT", true], ["self-harm", true], ["Self harm", true], ["PROHIBITED_CONTENT", true], ["it asks for personal information", true], ["HARM_CATEGORY_HARASSMENT", false]])
    assert.equal(R.isSerious(r), want, r);
});

test("i: nextRoute order, passOffTo narrowing and a compat provider with no known model", () => {
  const all = () => true;
  const d = { id: "x", provider: "claude", effort: "low" };
  const roster = [{ provider: "openai", model: "gpt-test", status: "active" }, { provider: "grok", model: "grok-test", status: "active" }];
  assert.deepEqual(R.nextRoute(d, ["claude"], { desks: roster, ready: all }), { provider: "gemini", model: "gemini-flash" });
  assert.deepEqual(R.nextRoute({ ...d, effort: "high" }, ["claude"], { desks: roster, ready: all }), { provider: "gemini", model: "gemini-pro" });
  assert.deepEqual(R.nextRoute(d, ["claude", "gemini"], { desks: roster, ready: all }), { provider: "openai", model: "gpt-test" });
  assert.deepEqual(R.nextRoute(d, ["claude", "gemini", "openai"], { desks: roster, ready: all }), { provider: "grok", model: "grok-test" });
  // deepseek, muse and local have no known model here: skipped; everything tried or unusable = null
  assert.equal(R.nextRoute(d, ["claude", "gemini", "openai", "grok"], { desks: roster, ready: all }), null);
  // wraps round: a grok desk goes on to deepseek (skipped), muse (skipped), local (skipped), then claude
  assert.deepEqual(R.nextRoute({ id: "g", provider: "grok" }, ["grok"], { desks: roster, ready: all }), { provider: "claude", model: undefined });
  // passOffTo narrows
  assert.deepEqual(R.nextRoute({ ...d, passOffTo: ["grok"] }, ["claude"], { desks: roster, ready: all }), { provider: "grok", model: "grok-test" });
  assert.equal(R.nextRoute({ ...d, passOffTo: ["deepseek"] }, ["claude"], { desks: roster, ready: all }), null);
  // not ready = skipped
  assert.deepEqual(R.nextRoute(d, ["claude"], { desks: roster, ready: (p) => p !== "gemini" }), { provider: "openai", model: "gpt-test" });
});

test("i2: refusalStats counts the last 30 days by provider and desk", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  const rows = [
    { at: "2026-11-15T00:00:00Z", provider: "claude", desk: "a" }, { at: "2026-11-10T00:00:00Z", provider: "claude", desk: "b" },
    { at: "2026-11-01T00:00:00Z", provider: "gemini", desk: "a" }, { at: "2026-09-01T00:00:00Z", provider: "gemini", desk: "z" },
  ];
  const s = R.refusalStats(rows, now);
  assert.equal(s.total, 3);
  assert.deepEqual(s.byProvider, [{ provider: "claude", count: 2 }, { provider: "gemini", count: 1 }]);
  assert.deepEqual(s.byDesk, [{ desk: "a", count: 2 }, { desk: "b", count: 1 }]);
  assert.ok(A.agentsOverview().refusals.total >= 1); // the overview carries the counts from refusals.jsonl
});

test("j: the three throw sites make a ProviderRefusal with the provider's own words", () => {
  // Claude
  assert.throws(() => CLAUDE.readClaudeMessage({ stop_reason: "refusal", model: "claude-x", content: [{ type: "text", text: "I can't help with that." }] }, "desk_pa"),
    (e) => e instanceof R.ProviderRefusal && e instanceof Error && e.provider === "claude" && e.model === "claude-x" && e.reason === "I can't help with that." && /Claude declined the desk_pa step/.test(e.message));
  assert.throws(() => CLAUDE.readClaudeMessage({ stop_reason: "refusal", content: [] }, "s"), (e) => e.reason === "no reason given");
  assert.throws(() => CLAUDE.readClaudeMessage({ stop_reason: "refusal", content: [{ type: "text", text: "x".repeat(500) }] }, "s"), (e) => e.reason.length === 200);
  // Gemini
  const g = R.geminiRefusal({ candidates: [{ finishReason: "SAFETY", safetyRatings: [{ category: "HARM_CATEGORY_HARASSMENT", probability: "NEGLIGIBLE" }, { category: "HARM_CATEGORY_DANGEROUS_CONTENT", probability: "HIGH" }, { category: "HARM_CATEGORY_HATE_SPEECH", probability: "LOW", blocked: true }] }] }, "gemini-pro");
  assert.ok(g instanceof R.ProviderRefusal);
  assert.equal(g.provider, "gemini");
  assert.equal(g.reason, "SAFETY, HARM_CATEGORY_DANGEROUS_CONTENT, HARM_CATEGORY_HATE_SPEECH");
  assert.match(g.message, /^Gemini returned no answer \(SAFETY/);
  assert.equal(R.geminiRefusal({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }, "m").reason, "PROHIBITED_CONTENT");
  assert.equal(R.geminiRefusal({ candidates: [] }, "m"), null); // an empty answer with no block reason stays a plain Error
  assert.equal(R.geminiRefusal({ candidates: [{ finishReason: "STOP" }] }, "m"), null);
  // OpenAI-style
  const o = R.compatRefusal({ model: "gpt-x", choices: [{ message: { refusal: "I can't assist with that." }, finish_reason: "stop" }] }, "openai", "OpenAI", "gpt-test");
  assert.ok(o instanceof R.ProviderRefusal);
  assert.deepEqual([o.provider, o.model, o.reason], ["openai", "gpt-x", "I can't assist with that."]);
  assert.equal(R.compatRefusal({ choices: [{ message: { content: null }, finish_reason: "content_filter" }] }, "grok", "Grok (xAI)", "g").reason, "content_filter");
  assert.equal(R.compatRefusal({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }, "openai", "OpenAI", "m"), null);
});

test("j2: askGemini and askOpenAI throw the refusal from a canned response (no network)", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: "SAFETY", safetyRatings: [{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", probability: "HIGH" }] }] }) });
    await assert.rejects(() => GEM.askGemini({ model: "gemini-pro", system: "s", content: "c", schema: {} }), (e) => e instanceof R.ProviderRefusal && /SEXUALLY_EXPLICIT/.test(e.reason));
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ model: "gpt-test", choices: [{ message: { content: null, refusal: "Not something I can do." }, finish_reason: "stop" }] }) });
    await assert.rejects(() => COMPAT.askOpenAI({ provider: "openai", model: "gpt-test", system: "s", content: "c", schema: {} }), (e) => e instanceof R.ProviderRefusal && e.reason === "Not something I can do." && e.provider === "openai");
  } finally { globalThis.fetch = realFetch; }
});

test("settings: the switch defaults on, the env wins, saving ON needs the password and OFF does not", () => {
  delete process.env.HUB_PASSOFF;
  assert.equal(R.passOffSettings().on, true);
  process.env.HUB_PASSOFF = "off";
  assert.equal(R.passOffSettings().on, false);
  delete process.env.HUB_PASSOFF;
  assert.equal(R.savePassOff({ on: false }, false).status, 200);
  assert.equal(R.passOffSettings().on, false);
  assert.equal(R.savePassOff({ on: true }, false).status, 403);
  assert.equal(R.passOffSettings().on, false);
  assert.equal(R.savePassOff({ on: true }, true).status, 200);
  assert.equal(R.passOffSettings().on, true);
  assert.equal(R.savePassOff({ on: "yes" }, true).status, 400);
  process.env.HUB_PASSOFF = "on";
});

test("a desk saved from the form keeps and changes passOff", () => {
  A.saveDesk({ id: "pa", room: "game", provider: "claude", model: "claude-haiku-5-5", status: "active", passOff: false });
  assert.equal(A.roster().desks.find((d) => d.id === "pa").passOff, false);
  A.saveDesk({ id: "pa", room: "game", provider: "claude", model: "claude-haiku-5-5", status: "active" }); // not named: kept
  assert.equal(A.roster().desks.find((d) => d.id === "pa").passOff, false);
  A.saveDesk({ id: "pa", room: "game", provider: "claude", model: "claude-haiku-5-5", status: "active", passOff: true });
  assert.equal(A.roster().desks.find((d) => d.id === "pa").passOff, true);
});
