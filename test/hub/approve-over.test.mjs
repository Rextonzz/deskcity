// The approval line (src/hub/approval.js, src/pipeline/agents/estimate.js): a new job the hub runs on an API, or a
// session it starts on the subscription, that is estimated over the owner's line waits for his OK. Stand-in AI, no network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub, wait, ROOMS, DESKS, app } from "./helper.mjs";

delete process.env.HUB_APPROVE_API;
delete process.env.HUB_APPROVE_SUB;
import os from "node:os";
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "approve-folder-"));
const desks = [
  ...DESKS.filter((d) => d.id === "hr"),
  { id: "wk-api", room: "game", role: "Writer", provider: "claude", model: "claude-haiku-5-5", effort: "low", capUsdMonth: 5, status: "active", runner: "hub" },
  { id: "wk-local", room: "game", role: "Local", provider: "local", model: "llama", status: "active", runner: "hub" },
  { id: "wk-unpriced", room: "game", role: "Mystery", provider: "claude", model: "claude-nonesuch-9", capUsdMonth: 5, status: "active", runner: "hub" },
  { id: "wk-lead", room: "game", role: "Lead", lead: true, workFolder: folder, provider: "claude", model: "claude-code", status: "active" },
];
const { A, root } = await hub({ rooms: ROOMS, desks });
delete process.env.HUB_APPROVE_API; // the shared helper turns the line off for other tests; this one tests it
delete process.env.HUB_APPROVE_SUB;
const AP = await import(app("src/hub/approval.js"));
const S = await import(app("src/hub/settings.js"));
const AI = await import(app("src/pipeline/ai.js"));
const answer = { output: "ok", summary: "done", followups: [], handoff_to: "", handoff_task: "", questions_for_owner: [], assign: [] };
const counter = () => { const c = { n: 0, ask: async () => { c.n++; return answer; } }; return c; };
const line = (api, sub) => { process.env.HUB_APPROVE_API = String(api); process.env.HUB_APPROVE_SUB = String(sub); };
const asked = () => fs.readdirSync(path.join(root, "fake")).filter((f) => /\.asked\.txt$/.test(f));
const holds = (id) => A.jobs().find((j) => j.id === id).history.filter((h) => h.held).length;
const wakes = (id) => A.readEvents().filter((e) => e.job === id && e.action === "waiting to run").length;

test("defaults: $0.25 an API job, $5 a session; an env value or none wins", () => {
  assert.deepEqual(AP.approveLines(), { apiUsd: 0.25, subUsd: 5 });
  line("none", "none");
  assert.deepEqual(AP.approveLines(), { apiUsd: null, subUsd: null });
  line(1.5, 7);
  assert.deepEqual(AP.approveLines(), { apiUsd: 1.5, subUsd: 7 });
});

test("API estimate: real prompt in, median of the last 10 outputs, the price table", () => {
  const desk = desks.find((d) => d.id === "wk-api");
  const job = { id: "x", text: "Write a short note", desk: desk.id };
  const calls = [...Array(12)].map((_, i) => ({ step: "desk_wk-api", outputTokens: (i + 1) * 100 })); // newest first: the first 10 count, median of 100..1000 = 550
  const e = A.jobEstimate(desk, job, { calls });
  assert.equal(e.tokens.out, 550);
  assert.equal(e.priceKnown, true);
  assert.equal(e.usd, AI.costOf("claude-haiku-5-5", { inputTokens: e.tokens.in, outputTokens: 550 }));
  assert.ok(e.tokens.in > 100, "input counts the real prompt");
  assert.match(e.basis, /tokens in, about 550 out from its last 10 jobs, at claude-haiku-5-5 prices/);
  const none = A.jobEstimate(desk, job, { calls: [] });
  assert.equal(none.tokens.out, 2000);
  assert.match(none.basis, /no past jobs/);
  const other = A.jobEstimate(desk, job, { calls: [{ step: "desk_someone-else", outputTokens: 99999 }] });
  assert.equal(other.tokens.out, 2000, "another desk's calls don't count");
});

test("local model: free, never held; unknown price: counts as over", () => {
  line(0, 0);
  const local = desks.find((d) => d.id === "wk-local");
  const e = A.jobEstimate(local, { id: "l", text: "x", desk: local.id });
  assert.deepEqual([e.usd, e.priceKnown, e.local], [0, true, true]);
  assert.equal(A.apiGate(local, { id: "l", text: "x", desk: local.id }), null);
  const un = desks.find((d) => d.id === "wk-unpriced");
  const eu = A.jobEstimate(un, { id: "u", text: "x", desk: un.id });
  assert.equal(eu.priceKnown, false);
  line(1000, 1000); // a huge line: an unknown price is held anyway
  assert.equal(A.jobApproval(un, { id: "u", text: "x", desk: un.id }).over, true);
});

test("a job under the line runs unheld; the line off means no hold", async () => {
  line(100, 100);
  const c = counter();
  const j = await A.addJob({ desk: "wk-api", text: "Cheap job" });
  await A.runJob(j.id, { ask: c.ask });
  assert.equal(c.n, 1);
  assert.equal(A.jobs().find((x) => x.id === j.id).status, "done");
  line(0, 0); line("none", "none");
  const j2 = await A.addJob({ desk: "wk-api", text: "No line at all" });
  await A.runJob(j2.id, { ask: c.ask });
  assert.equal(c.n, 2);
});

test("over the line: held with no AI call, one note and one event however often it is tried; Approve runs it once", async () => {
  line(0.000001, 100);
  const c = counter();
  const j = await A.addJob({ desk: "wk-api", text: "Costly job" });
  for (let i = 0; i < 3; i++) await assert.rejects(A.runJob(j.id, { ask: c.ask }), (e) => e.held === true && /Waiting for your OK/.test(e.message));
  assert.equal(c.n, 0, "no model call");
  assert.equal(asked().length, 0);
  const held = A.jobs().find((x) => x.id === j.id);
  assert.equal(held.status, "queued");
  assert.equal(held.held.line, 0.000001);
  assert.equal(holds(j.id), 1, "one note on the job");
  assert.equal(wakes(j.id), 1, "one event");
  const r = await A.runJob(j.id, { ask: c.ask, approve: true });
  assert.equal(c.n, 1);
  assert.equal(r.status, "done");
  const done = A.jobs().find((x) => x.id === j.id);
  assert.ok(done.approvedAt && done.approvedUsd > 0, "the OK and the estimate are on the job");
  assert.equal(done.held, undefined);
});

test("a retry of an approved job isn't held again, unless the estimate grew by more than half", async () => {
  line(0.000001, 100);
  const bad = async () => { throw new Error("boom"); };
  const j = await A.addJob({ desk: "wk-api", text: "Flaky costly job" });
  await assert.rejects(A.runJob(j.id, { ask: bad, approve: true }), /boom/);
  const again = await A.retryJob(j.id);
  const nj = A.jobs().find((x) => x.id === again.job);
  assert.ok(nj.approvedAt, "the OK carries over");
  const c = counter();
  await A.runJob(nj.id, { ask: c.ask });
  assert.equal(c.n, 1, "not held again");
  const desk = desks.find((d) => d.id === "wk-api");
  const est = A.jobEstimate(desk, nj);
  assert.equal(A.jobApproval(desk, { ...nj, approvedUsd: est.usd / 1.4 }).over, false, "grew by 40%: still covered");
  assert.equal(A.jobApproval(desk, { ...nj, approvedUsd: est.usd / 2 }).over, true, "doubled: held again");
});

test("a chain step and an auto-started job over the line are held and make no call", async () => {
  line(0.000001, 100);
  const first = await A.addJob({ desk: "wk-local", text: "Step one", then: ["wk-api"] });
  await A.runJob(first.id, { ask: counter().ask });
  let next;
  for (let i = 0; i < 40 && !next; i++) { await wait(50); next = A.jobs().find((x) => x.desk === "wk-api" && x.prev === first.id); }
  assert.ok(next, "the chained job exists");
  await wait(300);
  const now = A.jobs().find((x) => x.id === next.id);
  assert.equal(now.status, "queued");
  assert.ok(now.held, "held for the owner");
  assert.equal(asked().length, 0, "the model was never called");
  assert.equal(holds(next.id), 1);
});

test("the cap, the price rule and the other limits still come first", async () => {
  line(0.000001, 100);
  const j = await A.addJob({ desk: "wk-unpriced", text: "x" });
  await assert.rejects(A.runJob(j.id, { ask: counter().ask }), (e) => !e.held && /can't run/.test(e.message));
});

test("settings: raising a line or turning it off needs the password; lowering or turning on doesn't", () => {
  delete process.env.HUB_APPROVE_API; delete process.env.HUB_APPROVE_SUB;
  const file = path.join(root, "data", "hub-settings.json");
  fs.writeFileSync(file, JSON.stringify({ agents: { approveOver: { apiUsd: 1, subUsd: 5 } } }));
  S.resetHubSettings();
  assert.deepEqual(AP.approveLines(), { apiUsd: 1, subUsd: 5 });
  assert.equal(AP.saveApproveLines({ apiUsd: 0.5 }, false).status, 200, "lower");
  let r = AP.saveApproveLines({ apiUsd: 2 }, false);
  assert.equal(r.status, 403); assert.equal(r.body.needPassword, true);
  assert.equal(AP.saveApproveLines({ subUsd: null }, false).status, 403, "off");
  assert.equal(AP.saveApproveLines({ subUsd: 9 }, false).status, 403, "raise the session line");
  assert.deepEqual(AP.approveLines(), { apiUsd: 0.5, subUsd: 5 }, "nothing changed by the refusals");
  assert.equal(AP.saveApproveLines({ apiUsd: "lots" }, true).status, 400);
  assert.equal(AP.saveApproveLines({ apiUsd: 3, subUsd: null }, true).status, 200);
  assert.deepEqual(AP.approveLines(), { apiUsd: 3, subUsd: null });
  assert.equal(AP.saveApproveLines({ subUsd: 4 }, false).status, 200, "turning a line on needs no password");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).agents.approveOver, { apiUsd: 3, subUsd: 4 });
});

test("session estimate: the desk's average, else dollars an hour times planned hours, else unknown", () => {
  const ev = (desk, action, t) => ({ desk, action, source: "autonomy", startedAt: new Date(t).toISOString() });
  const T = Date.parse("2026-11-10T09:00:00Z"), H = 3600e3;
  const events = [ev("a", "session start", T), ev("a", "session end", T + H), ev("a", "session start", T + 5 * H), ev("a", "session end", T + 7 * H), ev("b", "session start", T), ev("b", "session end", T + H)];
  const rows = [
    { desk: "a", billing: "subscription", costUsd: 2, at: new Date(T + 0.5 * H).toISOString() },
    { desk: "a", billing: "subscription", costUsd: 6, at: new Date(T + 6 * H).toISOString() },
    { desk: "a", billing: "api", costUsd: 50, at: new Date(T + 0.5 * H).toISOString() }, // API money is not a session's subscription cost
    { desk: "b", billing: "subscription", costUsd: 4, at: new Date(T + 0.5 * H).toISOString() },
  ];
  const sessions = A.hubSessions(events, rows);
  assert.equal(sessions.length, 3);
  const a = A.subEstimateFrom(sessions, "a", 2);
  assert.equal(a.usd, 4); assert.equal(a.priceKnown, true);
  assert.match(a.basis, /last 2 hub-started sessions/);
  const c = A.subEstimateFrom(sessions, "c", 2); // no history: (2+6+4) / (1+2+1) = $3 an hour, 2 hours
  assert.equal(c.usd, 6); assert.match(c.basis, /an hour/);
  const none = A.subEstimateFrom([], "a", 1);
  assert.equal(none.priceKnown, false);
});

test("a hub-started session over its line doesn't start until approved; one Waiting item however often it is tried", async () => {
  const stub = path.join(root, "claude-stub.js");
  fs.writeFileSync(stub, "process.stdin.resume(); setTimeout(() => process.exit(0), 1500);\n");
  process.env.AGENTS_CLAUDE_BIN = stub;
  line(100, 1); // no session history: unknown price, held whatever the line
  const open = () => A.requests({ open: true }).filter((r) => r.gate?.desk === "wk-lead");
  for (let i = 0; i < 3; i++) await assert.rejects(A.grantAutonomy({ desk: "wk-lead", hours: 1, by: "started by the hub after the board meeting" }), (e) => e.held === true);
  assert.equal(open().length, 1, "one item in Waiting for you");
  assert.equal(A.autonomyStatus().filter((s) => s.desk === "wk-lead").length, 0, "no session started");
  assert.match(open()[0].role, /Start a Claude Code session for wk-lead/);
  const out = await A.decideRequest(open()[0].id, { decision: "approved" });
  assert.ok(out.started?.desk === "wk-lead" && !out.started.error, JSON.stringify(out.started));
  assert.equal(A.autonomyStatus().filter((s) => s.desk === "wk-lead").length, 1, "started once approved");
  A.stopAutonomy("wk-lead");
  for (let i = 0; i < 60 && A.autonomyStatus().some((s) => s.desk === "wk-lead" && s.live); i++) await wait(100);
  await wait(300);
  // the owner's own button (approved) and the line being off start without a hold
  line(100, "none");
  const e2 = await A.grantAutonomy({ desk: "wk-lead", hours: 1, by: "started by the hub after the board meeting" });
  assert.equal(e2.desk, "wk-lead");
  A.stopAutonomy("wk-lead");
});
