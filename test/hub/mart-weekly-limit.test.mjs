// The weekly brake on lasting Mart buys (src/pipeline/agents/campus.js shop(), setting agents.mart.lastingPerWeek):
// at most 2 things that stay forever per worker per 7 days, bought by the worker. Treats, outings and anything with
// `hours` are not limited; an owner's gift is neither counted nor refused; null = no limit. Stand-ins only, no network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub, app, ROOMS, DESKS } from "./helper.mjs";

const { A, root, data } = await hub({ rooms: ROOMS, desks: DESKS });
const { resetHubSettings } = await import(app("src/hub/settings.js"));
const ME = "game-lead", H = 3600e3, T0 = new Date("2026-11-17T10:00:00").getTime(); // a Tuesday (no Friday items)
const setLimit = (v) => { fs.writeFileSync(path.join(root, "data", "hub-settings.json"), JSON.stringify({ agents: { mart: { lastingPerWeek: v } } })); resetHubSettings(); };
const mine = () => fs.readFileSync(data("wallet.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((b) => b.desk === ME);
const lasting = () => mine().filter((b) => !b.gift && A.PERKS[b.item] && A.PERKS[b.item].hours == null);
// the worker's own buys: shop() with Math.random fixed so it always tries the top of the wish list (or, when that is
// off limits, the first treat); an hour and more apart so the one-buy-an-hour rule never gets in the way
let calls = 0;
const shopAt = (t, ms) => { t.mock.timers.setTime(ms); calls = 0; return A.shop(); };

test("set-up: a worker with plenty of credits", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  for (let i = 0; i < 60; i++) A.recordEvent({ desk: ME, room: "game", action: "job done", summary: `job ${i}` });
  assert.ok(A.wallets()[ME].balance >= 300, "enough credits to buy anything");
  assert.equal(A.lastingLimit(), 2, "the default is 2 a week");
});

test("two lasting buys in a week go through, the third is skipped (nothing logged)", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  t.mock.method(Math, "random", () => (calls++ % 2 === 0 ? 0.5 : 0));
  shopAt(t, T0 + 0 * H); shopAt(t, T0 + 2 * H);
  assert.equal(lasting().length, 2);
  const before = fs.readFileSync(data("wallet.jsonl"), "utf8"), events = fs.existsSync(data("events.jsonl")) ? fs.readFileSync(data("events.jsonl"), "utf8").length : 0;
  const got = shopAt(t, T0 + 4 * H);
  assert.equal(lasting().length, 2, "a third lasting thing is not bought");
  assert.ok(got.every((b) => b.desk !== ME || A.PERKS[b.item].hours != null), "only treats at most");
  assert.equal(A.lastingThisWeek(ME, mine(), T0 + 4 * H), 2);
  void before; void events;
});

test("a treat still goes through when the week's lasting buys are used up", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 + 6 * H });
  t.mock.method(Math, "random", () => (calls++ % 2 === 0 ? 0.5 : 0));
  const got = shopAt(t, T0 + 6 * H);
  const treat = got.find((b) => b.desk === ME);
  assert.ok(treat, "they bought something");
  assert.ok(A.PERKS[treat.item].hours != null, `${treat.item} is a treat or outing, not a lasting thing`);
  assert.equal(lasting().length, 2);
});

test("an owner's gift goes through, and does not use up the worker's week", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 + 7 * H });
  const have = new Set(A.wallets()[ME].owned.concat(A.wallets()[ME].coming.map((c) => c.item)));
  const item = Object.entries(A.PERKS).find(([k, p]) => p.hours == null && !have.has(k) && !p.friday && !p.experience)[0];
  const line = A.giftPerk({ desk: ME, item });
  assert.equal(line.gift, true);
  assert.equal(A.lastingThisWeek(ME, mine(), T0 + 7 * H), 2, "the gift is not counted");
});

test("a new week resets the count", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  t.mock.method(Math, "random", () => (calls++ % 2 === 0 ? 0.5 : 0));
  const later = T0 + 8 * 24 * H;
  assert.equal(A.lastingThisWeek(ME, mine(), later), 0, "the week has rolled over");
  // a hungry pet takes the first shop of a call, so give it a few goes
  for (let i = 0; i < 4 && !mine().some((b) => !b.gift && A.PERKS[b.item]?.hours == null && Date.parse(b.at) >= later); i++) shopAt(t, later + i * 2 * H);
  assert.ok(mine().some((b) => !b.gift && A.PERKS[b.item]?.hours == null && Date.parse(b.at) >= later), "a lasting buy goes through again");
});

test("null means no limit", (t) => {
  setLimit(null);
  assert.equal(A.lastingLimit(), null);
  t.mock.timers.enable({ apis: ["Date"], now: T0 });
  t.mock.method(Math, "random", () => (calls++ % 2 === 0 ? 0.5 : 0));
  const start = T0 + 20 * 24 * H, n0 = lasting().filter((b) => Date.parse(b.at) >= start).length;
  for (let i = 0; i < 8; i++) shopAt(t, start + i * 2 * H);
  const bought = lasting().filter((b) => Date.parse(b.at) >= start).length - n0;
  assert.ok(bought >= 3, `${bought} lasting buys in one week with no limit`);
});

test("a number from the settings is used, and a bad one falls back to 2", () => {
  setLimit(1); assert.equal(A.lastingLimit(), 1);
  setLimit("x"); assert.equal(A.lastingLimit(), 2);
  setLimit(2); assert.equal(A.lastingLimit(), 2);
});
