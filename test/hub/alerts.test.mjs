// Alert rules and the spend forecast (src/pipeline/alerts.js, forecast.js; routes under /api/pipeline/agents).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express from "express";
import { hub, app, ROOMS, DESKS } from "./helper.mjs";

const realFetch = globalThis.fetch; // the helper blocks fetch; the route test talks to its own local server
const { A, root } = await hub({ rooms: ROOMS, desks: DESKS });
const AL = await import(app("src/pipeline/alerts.js"));
const F = await import(app("src/pipeline/forecast.js"));
const rulesFile = path.join(root, "data", "agents", "alert-rules.json");
const logFile = path.join(root, "data", "agents", "alert-log.json");
const reset = () => { for (const f of [rulesFile, logFile]) fs.rmSync(f, { force: true }); };

const DAY = 86400e3, HOUR = 3600e3;
const MS = Date.UTC(2026, 10, 1), ME = Date.UTC(2026, 11, 1); // November 2026: 30 days
const NOW = MS + 10 * DAY; // 10 days in
const at = (ms) => new Date(ms).toISOString();
const row = (ms, desk, costUsd, billing) => ({ at: at(ms), desk, costUsd, ...(billing ? { billing } : {}) });

// ---------- forecast ----------
test("forecast: simple is spent / days elapsed x days; trend uses the last 7 days' rate", () => {
  const rows = [row(MS + 1 * DAY, "a", 3), row(NOW - 2 * DAY, "a", 7), row(NOW - HOUR, "b", 1)];
  const f = F.forecast({ rows, now: NOW, monthStart: MS, monthEnd: ME, caps: { a: 20, c: 5 }, budget: 25 });
  assert.equal(f.days, 30);
  assert.equal(f.day, 11);
  const a = f.desks.find((d) => d.id === "a");
  assert.equal(a.spent, 10);
  assert.equal(a.projected, 30); // 10 / 10 days x 30
  // last 7 days: $7 over 7 days = $1/day x 20 days left = $20, plus $10 so far
  assert.equal(a.projectedTrend, 30);
  assert.equal(a.label, "over"); // 30 > cap 20
  assert.equal(f.desks.find((d) => d.id === "c").label, "ok", "a capped desk with no spend still shows");
  assert.equal(f.desks.find((d) => d.id === "b").label, "no cap");
  assert.equal(f.hub.spent, 11);
  assert.equal(f.hub.projected, 33);
  assert.equal(f.hub.label, "over");
});

test("forecast: trend differs from simple after a burst, and labels near / ok / over", () => {
  const burst = [row(NOW - 1 * DAY, "x", 10)];
  const f = F.forecast({ rows: burst, now: NOW, monthStart: MS, monthEnd: ME, caps: { x: 100 } });
  const x = f.desks[0];
  assert.equal(x.projected, 30);
  assert.equal(x.projectedTrend, 38.57);
  assert.equal(F.labelOf(100, 10, 85), "near");
  assert.equal(F.labelOf(100, 10, 79), "ok");
  assert.equal(F.labelOf(100, 10, 100), "near", "exactly at the cap is not over");
  assert.equal(F.labelOf(100, 120, 90), "over", "already spent past the cap");
  assert.equal(F.labelOf(null, 5, 50), "no cap");
  assert.equal(F.labelOf(0, 0, 0), "ok");
  assert.equal(F.labelOf(0, 1, 1), "over");
});

test("forecast: API and subscription stay apart; early in the month the window is the days there are", () => {
  const now = MS + 2 * DAY;
  const rows = [row(MS + DAY, "a", 4), row(MS + DAY, "a", 6, "subscription")];
  const f = F.forecast({ rows, now, monthStart: MS, monthEnd: ME, caps: { a: 50 } });
  const a = f.desks[0];
  assert.equal(a.spent, 4);
  assert.equal(a.subSpent, 6);
  assert.equal(a.projected, 60);
  assert.equal(a.subProjected, 90);
  assert.equal(a.projectedTrend, 60, "all of it falls inside the 2-day window");
  assert.equal(f.hub.label, "no cap");
  // no rows at all, and rows from outside the month, never produce NaN
  const none = F.forecast({ rows: [row(MS - DAY, "a", 9), { at: "junk", desk: "a", costUsd: 1 }], now, monthStart: MS, monthEnd: ME });
  assert.deepEqual(none.desks, []);
  assert.equal(none.hub.projected, 0);
});

test("forecastNow reads the ledger and the roster (aliases, caps, the hub's budget from the caps)", () => {
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  const now = new Date("2026-11-15T12:00:00Z");
  const lines = [
    { at: "2026-11-02T12:00:00Z", desk: "game-artist", costUsd: 1.5, kind: "agent event" },
    { at: "2026-11-14T12:00:00Z", desk: "game-artist", costUsd: 0.5, kind: "agent event", billing: "subscription" },
    { at: "2026-11-10T12:00:00Z", desk: "hr", costUsd: 0.2, kind: "ai call" },
  ];
  fs.writeFileSync(path.join(root, "data", "spend.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const f = A.forecastNow(now);
  assert.equal(f.month, "2026-11");
  assert.equal(f.budget, 5); // hr 2 + game-artist 3
  const art = f.desks.find((d) => d.id === "game-artist");
  assert.equal(art.cap, 3);
  assert.equal(art.spent, 1.5);
  assert.equal(art.subSpent, 0.5);
  assert.ok(f.desks.find((d) => d.id === "hr"));
  assert.equal(f.hub.cap, 5);
  assert.equal(f.hub.spent, 1.7);
});

// ---------- validation ----------
test("rule validation is strict", () => {
  const ids = ["hr", "game-artist"];
  const ok = AL.cleanRule({ type: "hour_spend", usd: "2" }, { deskIds: ids });
  assert.deepEqual(ok, { type: "hour_spend", usd: 2, cooldownHours: 6, enabled: true });
  assert.equal(AL.cleanRule({ type: "day_spend", usd: 1.5, desk: "HR" }, { deskIds: ids }).desk, "hr");
  const bad = (b, re) => assert.throws(() => AL.cleanRule(b, { deskIds: ids }), re, JSON.stringify(b));
  bad(null, /object/);
  bad([], /object/);
  bad({ type: "nope" }, /Pick a rule type/);
  bad({ usd: 2 }, /Pick a rule type/);
  bad({ type: "hour_spend" }, /dollars/);
  bad({ type: "hour_spend", usd: 0 }, /Dollars/);
  bad({ type: "hour_spend", usd: -3 }, /Dollars/);
  bad({ type: "hour_spend", usd: "abc" }, /Dollars/);
  bad({ type: "hour_spend", usd: 1e9 }, /Dollars/);
  bad({ type: "hour_spend", usd: 2, extra: 1 }, /Unknown field/);
  bad({ type: "hour_spend", usd: 2, hours: 3 }, /doesn't go with/);
  bad({ type: "hour_spend", usd: 2, desk: "ghost" }, /isn't a desk/);
  bad({ type: "hour_spend", usd: 2, desk: "a b!" }, /letters, numbers/);
  bad({ type: "day_spend", usd: 2 }, /which worker/);
  bad({ type: "idle_open_job" }, /hours/);
  bad({ type: "idle_open_job", hours: 0 }, /Hours/);
  bad({ type: "job_failed_twice", usd: 2 }, /doesn't go with/);
  bad({ type: "hour_spend", usd: 2, cooldownHours: 0 }, /Cooldown/);
  bad({ type: "hour_spend", usd: 2, enabled: "yes" }, /true or false/);
  bad({ type: "hour_spend", usd: 2, id: "x" }, /id isn't valid/);
  assert.equal(AL.cleanRule({ type: "month_projected" }).usd, undefined, "the budget is optional");
  assert.equal(AL.cleanRule({ type: "job_failed_twice", name: "  a\u0000b " }).name, "a b");
});

test("rules save, update, remove and cap at 50", () => {
  reset();
  const a = AL.saveRule({ type: "job_failed_twice" });
  assert.match(a.id, /^[a-f0-9]{10}$/);
  const b = AL.saveRule({ id: a.id, type: "job_failed_twice", desk: "hr", cooldownHours: 2 });
  assert.equal(b.createdAt, a.createdAt);
  assert.equal(AL.readRules().length, 1);
  assert.equal(AL.readRules()[0].desk, "hr");
  assert.throws(() => AL.saveRule({ id: "0123456789", type: "job_failed_twice" }), /No such rule/);
  assert.throws(() => AL.removeRule("0123456789"), /No such rule/);
  AL.removeRule(a.id);
  assert.deepEqual(AL.readRules(), []);
  for (let i = 0; i < AL.MAX_RULES; i++) AL.saveRule({ type: "job_failed_twice" });
  assert.throws(() => AL.saveRule({ type: "job_failed_twice" }), /already/);
  reset();
});

// ---------- rule types ----------
const job = (id, desk, status, ms, o = {}) => ({ id, desk, status, at: at(ms), updatedAt: at(ms), text: `job ${id}`, history: [], ...o });
const fire = async (rule, ctx) => {
  reset();
  AL.saveRule(rule);
  const sent = [], events = [];
  const out = await AL.checkAlerts({ now: NOW, rows: [], jobs: [], events: [], ...ctx }, { notify: async (m) => { sent.push(m); }, record: (e) => events.push(e) });
  return { out, sent, events };
};

test("hour_spend fires only past the limit, in the last hour, API only unless asked", async () => {
  const rows = [row(NOW - 10 * 60e3, "a", 1.5), row(NOW - 20 * 60e3, "a", 1), row(NOW - 2 * HOUR, "b", 9), row(NOW - 5 * 60e3, "c", 5, "subscription")];
  let r = await fire({ type: "hour_spend", usd: 2 }, { rows });
  assert.equal(r.out.length, 1);
  assert.match(r.sent[0].message, /a spent \$2\.50 in the last hour/);
  assert.doesNotMatch(r.sent[0].message, /\bb\b|\bc\b/, "an older hour and plan use don't count");
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].action, "alert fired");
  r = await fire({ type: "hour_spend", usd: 2, includeSubscription: true }, { rows });
  assert.match(r.sent[0].message, /c spent \$5\.00/);
  r = await fire({ type: "hour_spend", usd: 2.5 }, { rows });
  assert.equal(r.sent.length, 0, "exactly at the limit does not fire");
  r = await fire({ type: "hour_spend", usd: 1, desk: "b" }, { rows });
  assert.equal(r.sent.length, 0, "b's spend was two hours ago");
});

test("day_spend counts since the day started, for the named worker", async () => {
  const dayStart = NOW - 5 * HOUR;
  const rows = [row(NOW - 4 * HOUR, "hr", 1.5), row(NOW - 1 * HOUR, "hr", 1), row(NOW - 6 * HOUR, "hr", 50), row(NOW - HOUR, "game-artist", 9)];
  let r = await fire({ type: "day_spend", usd: 2, desk: "hr" }, { rows, dayStart });
  assert.equal(r.out.length, 1);
  assert.match(r.sent[0].message, /hr spent \$2\.50 today/);
  r = await fire({ type: "day_spend", usd: 3, desk: "hr" }, { rows, dayStart });
  assert.equal(r.out.length, 0);
  assert.ok(AL.dayStartMs(NOW) <= NOW && NOW - AL.dayStartMs(NOW) < 25 * HOUR);
});

test("job_failed_twice needs the two newest finished jobs to both be failed", async () => {
  const bad = [job("1", "hr", "failed", NOW - 3 * HOUR), job("2", "hr", "failed", NOW - 2 * HOUR, { summary: "ran out" })];
  let r = await fire({ type: "job_failed_twice" }, { jobs: bad });
  assert.equal(r.out.length, 1);
  assert.match(r.sent[0].message, /hr: two jobs failed in a row \(latest: ran out\)/);
  const recovered = [...bad, job("3", "hr", "done", NOW - HOUR)];
  r = await fire({ type: "job_failed_twice" }, { jobs: recovered });
  assert.equal(r.out.length, 0, "a success after them ends it");
  const split = [job("1", "hr", "failed", NOW - 3 * HOUR), job("2", "hr", "done", NOW - 2 * HOUR), job("3", "hr", "failed", NOW - HOUR)];
  r = await fire({ type: "job_failed_twice" }, { jobs: split });
  assert.equal(r.out.length, 0, "not in a row");
  r = await fire({ type: "job_failed_twice", desk: "game-artist" }, { jobs: bad });
  assert.equal(r.out.length, 0, "another desk's failures are not this rule's");
  r = await fire({ type: "job_failed_twice" }, { jobs: [job("1", "hr", "failed", NOW - HOUR), job("q", "hr", "queued", NOW)] });
  assert.equal(r.out.length, 0, "one failure is not two");
});

test("idle_open_job fires for an open job with no steps for N hours", async () => {
  const open = [job("1", "hr", "taken", NOW - 5 * HOUR)];
  let r = await fire({ type: "idle_open_job", hours: 3 }, { jobs: open, events: [{ desk: "hr", startedAt: at(NOW - 4 * HOUR) }] });
  assert.equal(r.out.length, 1);
  assert.match(r.sent[0].message, /hr has an open job and no steps for 4 h/);
  r = await fire({ type: "idle_open_job", hours: 3 }, { jobs: open, events: [{ desk: "hr", startedAt: at(NOW - HOUR) }] });
  assert.equal(r.out.length, 0, "a recent step means it's working");
  r = await fire({ type: "idle_open_job", hours: 3 }, { jobs: [job("1", "hr", "done", NOW - 9 * HOUR)], events: [] });
  assert.equal(r.out.length, 0, "no open job, nothing to chase");
  r = await fire({ type: "idle_open_job", hours: 3, desk: "game-artist" }, { jobs: open, events: [] });
  assert.equal(r.out.length, 0);
});

test("month_projected fires when the projection passes the budget or the rule's own number", async () => {
  const forecast = F.forecast({ rows: [row(NOW - DAY, "a", 20)], now: NOW, monthStart: MS, monthEnd: ME, caps: { a: 100 }, budget: 50 });
  let r = await fire({ type: "month_projected" }, { forecast, budget: 50 });
  assert.equal(r.out.length, 1);
  assert.match(r.sent[0].message, /heading for \$/);
  r = await fire({ type: "month_projected" }, { forecast, budget: 5000 });
  assert.equal(r.out.length, 0);
  r = await fire({ type: "month_projected", usd: 10 }, { forecast, budget: 5000 });
  assert.equal(r.out.length, 1, "the rule's own number beats the budget");
  r = await fire({ type: "month_projected" }, { forecast, budget: null });
  assert.equal(r.out.length, 0, "no budget and no number: nothing to compare with");
});

// ---------- cooldown, disabled, log ----------
test("a rule fires once, then waits out its cooldown; disabled rules never fire; the log keeps the last 50", async () => {
  reset();
  const rule = AL.saveRule({ type: "hour_spend", usd: 1, cooldownHours: 2 });
  const off = AL.saveRule({ type: "hour_spend", usd: 1, enabled: false });
  const rows = [row(NOW - 60e3, "a", 5)], sent = [];
  const go = (now) => AL.checkAlerts({ now, rows: [row(now - 60e3, "a", 5)], jobs: [], events: [] }, { notify: async (m) => sent.push(m), record() {} });
  assert.equal((await go(NOW)).length, 1);
  assert.equal((await go(NOW + 60 * 60e3)).length, 0, "an hour later: still cooling down");
  assert.equal((await go(NOW + 119 * 60e3)).length, 0);
  assert.equal((await go(NOW + 121 * 60e3)).length, 1, "past the cooldown it can fire again");
  assert.equal(sent.length, 2);
  const view = AL.alertsView();
  assert.equal(view.firings.length, 2);
  assert.equal(view.rules.find((r) => r.id === rule.id).lastFiredAt, at(NOW + 121 * 60e3));
  assert.equal(view.rules.find((r) => r.id === off.id).lastFiredAt, null);
  assert.match(view.rules[0].text, /Any worker spends more than \$1 in an hour/);
  // the default cooldown is 6 h
  reset();
  AL.saveRule({ type: "hour_spend", usd: 1 });
  sent.length = 0;
  await go(NOW);
  assert.equal((await go(NOW + 5 * HOUR)).length, 0);
  assert.equal((await go(NOW + 6 * HOUR + 1000)).length, 1);
  // log trimmed
  const lg = JSON.parse(fs.readFileSync(logFile, "utf8"));
  lg.log = Array.from({ length: 60 }, (_, i) => ({ at: at(NOW), rule: "x", text: String(i) }));
  fs.writeFileSync(logFile, JSON.stringify(lg));
  await go(NOW + 20 * HOUR);
  assert.equal(JSON.parse(fs.readFileSync(logFile, "utf8")).log.length, AL.MAX_LOG);
  AL.removeRule(AL.readRules()[0].id);
  reset();
});

test("a failing phone alert still counts as fired (no repeat every tick), and one rule's error doesn't stop the rest", async () => {
  reset();
  AL.saveRule({ type: "hour_spend", usd: 1 });
  const ctx = { now: NOW, rows: [row(NOW - 1000, "a", 5)], jobs: [], events: [] };
  const bad = { notify: async () => { throw new Error("ntfy down"); }, record() {} };
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal((await AL.checkAlerts(ctx, bad)).length, 1);
    assert.equal((await AL.checkAlerts(ctx, bad)).length, 0);
  } finally { console.warn = warn; }
  reset();
});

test("runAlertCheck builds its data from the hub and sends through the notify it is given", async () => {
  reset();
  AL.saveRule({ type: "hour_spend", usd: 0.5 });
  const now = new Date("2026-11-15T12:00:00Z");
  fs.writeFileSync(path.join(root, "data", "spend.jsonl"), JSON.stringify({ at: "2026-11-15T11:50:00Z", desk: "game-artist", costUsd: 1, kind: "agent event" }) + "\n");
  const { resetSpendSeed } = await import(app("src/pipeline/spend.js"));
  resetSpendSeed();
  const sent = [];
  const out = await A.runAlertCheck({ now, notify: async (m) => sent.push(m) });
  assert.equal(out.length, 1);
  assert.match(sent[0].title, /^Alert: Any worker spends more than \$0\.5 in an hour/);
  assert.ok(A.readEvents().some((e) => e.action === "alert fired"));
  reset();
});

// ---------- routes ----------
test("routes: GET /alerts, POST /alerts (validated), remove, GET /forecast", async () => {
  reset();
  const { agentsRouter } = await import(app("src/routes/agents.js"));
  const server = express();
  server.use(express.json());
  server.use("/api/pipeline/agents", agentsRouter);
  const srv = http.createServer(server);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}/api/pipeline/agents`;
  const call = async (p, body) => {
    const res = await realFetch(base + p, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    let r = await call("/alerts");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.rules, []);
    assert.ok(r.body.types.hour_spend);
    r = await call("/alerts", { type: "hour_spend", usd: -1 });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /Dollars/);
    r = await call("/alerts", { type: "day_spend", usd: 2, desk: "ghost" });
    assert.equal(r.status, 400);
    r = await call("/alerts", { type: "day_spend", usd: 2, desk: "hr" });
    assert.equal(r.status, 200);
    const id = r.body.id;
    r = await call("/alerts");
    assert.equal(r.body.rules.length, 1);
    assert.match(r.body.rules[0].text, /hr spends more than \$2 today/);
    r = await call("/forecast");
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.desks));
    assert.ok(r.body.hub);
    r = await call(`/alerts/${id}/remove`, {});
    assert.equal(r.status, 200);
    r = await call(`/alerts/${id}/remove`, {});
    assert.equal(r.status, 400);
  } finally {
    await new Promise((r) => srv.close(r));
  }
  reset();
});
