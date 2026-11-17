// The plan meter (src/pipeline/planmeter.js): Anthropic's weekly meter from the status line, the hub's estimate from
// its spend ledger, project shares against Finance's plan budgets, and the stop on hub-started sessions.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { hub, DESKS, ROOMS, app } from "./helper.mjs";

const { A, data } = await hub({ rooms: ROOMS, desks: DESKS });
const P = await import(app("src/pipeline/planmeter.js"));

const H = 3600e3, DAY = 24 * H;
const NOW = Date.parse("2026-11-14T12:00:00Z");
const RESET = Date.parse("2026-11-18T12:00:00Z"); // this week ends in 4 days, so 3 days are gone
const win = (pct, at) => ({ used_percentage: pct, resets_at: at / 1000 });
const sub = (at, room, usd, desk = `${room}-claude-code`) => ({ at: new Date(at).toISOString(), desk, room, costUsd: usd, billing: "subscription" });

test("recordMeter saves a reading, skips a repeat, and refuses one without rate_limits", () => {
  const t = new Date(NOW);
  const a = P.recordMeter({ rate_limits: { five_hour: win(20, NOW + 2 * H), seven_day: win(30, RESET) } }, t);
  assert.equal(a.saved, true);
  assert.equal(a.week.pct, 30);
  assert.equal(a.week.resetsAt, new Date(RESET).toISOString());
  assert.equal(P.recordMeter({ rate_limits: { five_hour: win(20, NOW + 2 * H), seven_day: win(30, RESET) } }, new Date(NOW + 60e3)).saved, false);
  assert.equal(P.recordMeter({ rate_limits: { seven_day: win(31, RESET) } }, new Date(NOW + 120e3)).saved, true);
  assert.throws(() => P.recordMeter({ model: {} }), /No rate_limits/);
  assert.throws(() => P.recordMeter({ rate_limits: { seven_day: { used_percentage: "lots", resets_at: 1 } } }), /No rate_limits/);
  assert.equal(P.meterReadings().length, 2);
});

test("planView splits the real meter by the ledger's mix and calibrates the estimate from finished weeks", () => {
  const lastReset = RESET - 7 * DAY;
  const readings = [
    { at: new Date(lastReset - H).toISOString(), week: { pct: 50, resetsAt: new Date(lastReset).toISOString() } }, // last week: 50%
    { at: new Date(NOW - H).toISOString(), week: { pct: 38, resetsAt: new Date(RESET).toISOString() }, five: { pct: 10, resetsAt: new Date(NOW + H).toISOString() } },
    { at: new Date(NOW - 2 * H).toISOString(), week: { pct: 40, resetsAt: new Date(RESET).toISOString() } }, // another terminal saw more: highest wins
  ];
  const rows = [
    sub(lastReset - 2 * DAY, "game", 100), // last week: $100 for 50% → $2 per 1%
    sub(NOW - DAY, "game", 45),
    sub(NOW - 2 * DAY, "hub", 15),
    { at: new Date(NOW - DAY).toISOString(), desk: "game-artist", costUsd: 5 }, // API money: not plan use
  ];
  const v = P.planView({ readings, rows, budgets: { rooms: { game: 25 }, hubStopPct: 90 }, rooms: ROOMS, now: NOW });
  assert.equal(v.hasMeter, true);
  assert.equal(v.week.pct, 40);
  assert.equal(v.five.pct, 10);
  assert.equal(v.usd, 60);
  assert.equal(v.usdPerPct, 2);
  assert.equal(v.estimate, 30); // $60 / $2 per 1%
  assert.equal(v.gap, 10); // 10 points the hub didn't see
  const game = v.rooms.find((x) => x.id === "game"), hubRoom = v.rooms.find((x) => x.id === "hub");
  assert.equal(game.used, 30); // 45/60 of the real 40%
  assert.equal(hubRoom.used, 10);
  assert.equal(game.label, "over"); // 30% used of a 25% share
  assert.equal(v.week.projected, 93.3); // 40% in 3 days, 4 days left
  assert.match(P.planBlock(v, "game"), /Game has used about 30% of the week, its whole 25% share/);
  assert.equal(P.planBlock(v, "hub"), null);
  assert.ok(P.planLines(v).some((l) => /Anthropic's meter: 40% of the week/.test(l)));
});

test("with no finished week, this week's own ratio is the provisional figure (no gap shown)", () => {
  const readings = [{ at: new Date(NOW - H).toISOString(), week: { pct: 20, resetsAt: new Date(RESET).toISOString() } }];
  const rows = [sub(NOW - DAY, "game", 30), sub(NOW - DAY, "hub", 10)];
  const v = P.planView({ readings, rows, budgets: { rooms: {}, hubStopPct: 90 }, rooms: ROOMS, now: NOW });
  assert.equal(v.calSource, "this week so far");
  assert.equal(v.usdPerPct, 2); // $40 for 20%
  assert.equal(v.estimate, 20);
  assert.equal(v.gap, null);
  assert.ok(P.planLines(v).some((l) => /from this week so far, provisional/.test(l)));
  // under 2% it's too little to go on
  const tiny = P.planView({ readings: [{ ...readings[0], week: { ...readings[0].week, pct: 1 } }], rows, now: NOW });
  assert.equal(tiny.usdPerPct, null);
});

test("past the hub stop line nothing hub-started runs; with no meter nothing is stopped", () => {
  const readings = [{ at: new Date(NOW - H).toISOString(), week: { pct: 92, resetsAt: new Date(RESET).toISOString() } }];
  const v = P.planView({ readings, rows: [], budgets: { rooms: {}, hubStopPct: 90 }, rooms: ROOMS, now: NOW });
  assert.match(P.planBlock(v, "game"), /past the hub's 90% stop line/);
  const none = P.planView({ readings: [], rows: [sub(NOW - H, "game", 5)], budgets: { rooms: { game: 1 }, hubStopPct: 90 }, rooms: ROOMS, now: NOW });
  assert.equal(none.hasMeter, false);
  assert.equal(P.planBlock(none, "game"), null);
  // a reading whose week has already reset doesn't count
  const old = P.planView({ readings: [{ at: new Date(NOW - 9 * DAY).toISOString(), week: { pct: 99, resetsAt: new Date(NOW - DAY).toISOString() } }], rows: [], now: NOW });
  assert.equal(old.hasMeter, false);
});

test("starter shares: seeded once from the last 7 days' split, then never again", () => {
  assert.equal(fs.existsSync(data("plan-budgets.json")), false);
  const rows = [sub(NOW - DAY, "game", 60), sub(NOW - DAY, "hub", 38), sub(NOW - DAY, "hr", 2), sub(NOW - 9 * DAY, "hr", 500), sub(NOW - DAY, "gone", 50)];
  const b = P.seedPlanBudgets({ rows, rooms: ROOMS, now: NOW });
  // game 60% → 75, hub 38% → 47.5 → 50, hr 2% → 5 (the minimum); last week's $500 and the unknown room don't count
  assert.deepEqual(b.rooms, { game: 75, hub: 50, hr: 5 });
  assert.equal(P.planBudgets().rooms.game, 75);
  assert.equal(P.seedPlanBudgets({ rows: [sub(NOW - H, "game", 1)], rooms: ROOMS, now: NOW }), null);
  fs.rmSync(data("plan-budgets.json"));
  assert.equal(P.seedPlanBudgets({ rows: [], rooms: ROOMS, now: NOW }), null); // nothing to go on: no file
  assert.equal(fs.existsSync(data("plan-budgets.json")), false);
});

test("setPlanBudget checks the share and the project; the stop line has its own key", () => {
  const ids = ROOMS.map((x) => x.id);
  assert.equal(P.setPlanBudget({ room: "game", pct: 30 }, ids).rooms.game, 30);
  assert.throws(() => P.setPlanBudget({ room: "game", pct: 0 }, ids), /1 to 100/);
  assert.throws(() => P.setPlanBudget({ room: "nope", pct: 5 }, ids), /No project/);
  assert.equal(P.setPlanBudget({ room: "hub-stop", pct: 80 }, ids).hubStopPct, 80);
  assert.equal(P.setPlanBudget({ room: "game", pct: "" }, ids).rooms.game, undefined);
  assert.equal(P.planBudgets().hubStopPct, 80);
});

test("a lead's work-on-your-own session doesn't start once its project's share is used up", async () => {
  fs.rmSync(data("plan-meter.jsonl"), { force: true });
  const reset = Date.now() + 2 * DAY;
  A.savePlanMeter({ rate_limits: { seven_day: win(50, reset) } });
  fs.appendFileSync(data("../spend.jsonl"), JSON.stringify(sub(Date.now() - H, "game", 20, "game-lead")) + "\n");
  A.savePlanBudget({ room: "hub-stop", pct: "" });
  A.savePlanBudget({ room: "game", pct: 20 });
  const v = A.planNow();
  assert.equal(v.rooms.find((x) => x.id === "game").used, 50);
  await assert.rejects(A.grantAutonomy({ desk: "game-lead", hours: 1 }), /Game has used about 50% of the week/);
  A.savePlanBudget({ room: "game", pct: 80 });
  // with room in its share it gets past the plan check (and stops later, on the missing project folder)
  await assert.rejects(A.grantAutonomy({ desk: "game-lead", hours: 1 }), /no project folder/);
});
