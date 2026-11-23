// Campus pieces 1 and 4 (2026-11-19): the store tax and the board's city fund, and the API quota item (cityfund.js).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub, app } from "./helper.mjs";

const ROOMS = [{ id: "hub", name: "Hub" }, { id: "hr", name: "HR" }, { id: "finance", name: "Finance" }, { id: "game", name: "Game" }];
const DESKS = [
  { id: "hr", room: "hr", role: "HR", lead: true, provider: "claude", status: "active" },
  { id: "finance-lead", room: "finance", role: "Finance lead", lead: true, provider: "claude", status: "active" },
  { id: "hub-builder", room: "hub", role: "Hub builder", lead: true, provider: "claude", status: "active" },
  { id: "game-lead", room: "game", role: "Project lead", lead: true, provider: "claude", status: "active" },
  { id: "a1", room: "game", role: "Worker", provider: "claude", status: "active", capUsdMonth: 3 },
  { id: "a2", room: "game", role: "Worker", provider: "claude", status: "active", capUsdMonth: 3 },
  { id: "a3", room: "game", role: "Worker", provider: "claude", status: "active", capUsdMonth: 3 },
  { id: "a4", room: "game", role: "Worker", provider: "claude", status: "active", capUsdMonth: 3 },
  { id: "free", room: "game", role: "Free-tier worker", provider: "grok", status: "active", capUsdMonth: 0 },
  { id: "broke", room: "game", role: "Worker", provider: "claude", status: "active" },
];
// starting credits: a grant line each (a negative cost), so balances don't depend on the events log
const now = new Date().toISOString();
const wallet = ["a1", "a2", "a3", "a4", "free", "hub-builder"].map((desk) => JSON.stringify({ at: now, desk, item: "fund grant", cost: -100 })).join("\n") + "\n";
const { A, root } = await hub({ rooms: ROOMS, desks: DESKS, seed: { "wallet.jsonl": wallet } });
const S = await import(app("src/hub/settings.js"));
const LEDGER = path.join(root, "data", "agents", "cityfund.jsonl");
const settings = (v) => { fs.writeFileSync(path.join(root, "data", "hub-settings.json"), JSON.stringify(v)); S.resetHubSettings(); };
const reset = () => fs.rmSync(LEDGER, { force: true });
const LOOSE = { agents: { cityFund: { limits: { perSpend: 1, perPlayer30d: 1, perWeek: 1, selfCooldownDays: 0 } } } };
const lines = () => (fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

test("tax math: 10% by default, two decimals, nothing on free things", () => {
  settings({});
  assert.equal(A.fundSettings().taxRate, 0.1);
  assert.equal(A.taxOn(20), 2);
  assert.equal(A.taxOn(3), 0.3);
  assert.equal(A.taxOn(7, 0.15), 1.05);
  assert.equal(A.withTax(3), 3.3);
  assert.equal(A.taxOn(0), 0);
  assert.equal(A.taxOn(-5), 0, "a refund line is never taxed");
  assert.equal(A.taxPurchase({ buyer: "a1", item: "mug", price: 0 }), null, "a gift (price 0) adds no tax");
});
test("the rate is a setting", () => {
  settings({ agents: { cityFund: { taxRate: 0.25 } } });
  assert.equal(A.taxOn(8), 2);
  settings({ agents: { cityFund: { taxRate: 7 } } });
  assert.equal(A.fundSettings().taxRate, 0.1, "a rate outside 0-1 falls back to the default");
  settings({});
});
test("a tax is logged with item, buyer, amount and reason, and the wallet line charges the buyer", () => {
  reset(); settings({});
  const before = A.wallets()["a1"].balance;
  const w = A.taxPurchase({ buyer: "a1", item: "mug", price: 3 });
  assert.deepEqual({ desk: w.desk, item: w.item, for: w.for, cost: w.cost }, { desk: "a1", item: "tax", for: "mug", cost: 0.3 });
  fs.appendFileSync(path.join(root, "data", "agents", "wallet.jsonl"), JSON.stringify(w) + "\n");
  assert.equal(Math.round((before - A.wallets()["a1"].balance) * 100) / 100, 0.3);
  assert.equal(A.wallets()["a1"].tax, 0.3);
  assert.ok(!A.wallets()["a1"].recent.some((r) => r.item === "tax"), "tax lines stay out of the recent buys");
  const [l] = lines();
  assert.equal(l.kind, "tax"); assert.equal(l.item, "mug"); assert.equal(l.buyer, "a1"); assert.equal(l.amount, 0.3); assert.equal(l.reason, "store purchase");
  assert.equal(l.fund, 0.3); assert.equal(l.reserve, 0);
  assert.equal(A.fundState().fund, 0.3);
});
test("the fund cap: tax over it goes to the reserve, split exactly at the line", () => {
  assert.deepEqual(A.splitTax(5, 498, 500), { fund: 2, reserve: 3 });
  assert.deepEqual(A.splitTax(5, 500, 500), { fund: 0, reserve: 5 });
  assert.deepEqual(A.splitTax(5, 0, 500), { fund: 5, reserve: 0 });
  reset(); settings({ agents: { cityFund: { cap: 3 } } });
  A.taxPurchase({ buyer: "a1", item: "piano", price: 20 }); // 2 -> fund
  A.taxPurchase({ buyer: "a2", item: "piano", price: 20 }); // 2 -> 1 fund, 1 reserve
  A.taxPurchase({ buyer: "a3", item: "piano", price: 20 }); // 2 -> reserve
  const st = A.fundState();
  assert.equal(st.fund, 3); assert.equal(st.reserve, 3); assert.equal(st.taxed, 6);
  assert.deepEqual(lines().map((l) => [l.fund, l.reserve]), [[2, 0], [1, 1], [0, 2]]);
  settings({});
});
test("a refund gives the tax back, out of the reserve first", () => {
  reset(); settings({ agents: { cityFund: { cap: 1 } } });
  A.taxPurchase({ buyer: "a1", item: "crown", price: 30 }); // 3: 1 fund, 2 reserve
  const back = A.refundTax({ buyer: "a1", item: "crown", price: 30 });
  assert.equal(back.cost, -3);
  const st = A.fundState();
  assert.equal(st.fund, 0); assert.equal(st.reserve, 0); assert.equal(st.taxed, 0);
  settings({});
});

test("the board: only members propose, the finance desk votes at once, a majority spends and it's logged", () => {
  reset(); settings(LOOSE); // the spend limits have their own tests below
  for (let i = 0; i < 5; i++) A.taxPurchase({ buyer: "a1", item: "piano", price: 100 }); // fund 50
  assert.deepEqual(A.fundBoard("hub"), ["hr", "finance-lead", "hub-builder"]);
  assert.throws(() => A.proposeSpend({ by: "a2", amount: 5, reason: "x" }), /isn't on the board/);
  assert.throws(() => A.proposeSpend({ by: S.ownerId(), amount: 500, reason: "too much" }), /more than that/);
  assert.throws(() => A.proposeSpend({ by: S.ownerId(), amount: 5, reason: " " }), /reason/);
  const r = A.proposeSpend({ by: S.ownerId(), amount: 20, reason: "fix the fountain", item: "fountain" });
  assert.equal(r.status, "open"); assert.equal(r.yes, 1); assert.equal(r.need, 2);
  assert.equal(A.fundState().fund, 50, "nothing leaves before a majority");
  const id = r.proposal.id;
  assert.throws(() => A.voteSpend({ id, desk: "game-lead", vote: "yes" }), /isn't on the board/);
  assert.throws(() => A.voteSpend({ id, desk: "finance-lead", vote: "yes" }), /already voted/);
  const done = A.voteSpend({ id, desk: "hub-builder", vote: "yes", why: "it leaks" });
  assert.equal(done.status, "spent");
  assert.equal(A.fundState().fund, 30); assert.equal(A.fundState().spent, 20);
  const spend = lines().find((l) => l.kind === "spend");
  assert.equal(spend.item, "fountain"); assert.equal(spend.buyer, "city"); assert.equal(spend.amount, 20); assert.equal(spend.reason, "fix the fountain");
  assert.deepEqual(spend.votes.map((v) => v.by), ["finance-lead", "hub-builder"]);
  assert.throws(() => A.voteSpend({ id, desk: "hr", vote: "yes" }), /already spent/);
});
test("a grant to a worker lands in its wallet; a no majority rejects and spends nothing", () => {
  const before = A.wallets()["a4"].balance, fund = A.fundState().fund;
  const p = A.proposeSpend({ by: S.ownerId(), amount: 10, reason: "best helper this week", payee: "a4" });
  A.voteSpend({ id: p.proposal.id, desk: "hr", vote: "yes" });
  assert.equal(A.wallets()["a4"].balance, before + 10);
  assert.equal(A.fundState().fund, fund - 10);
  assert.equal(lines().filter((l) => l.kind === "spend").at(-1).buyer, "a4");
  const q = A.proposeSpend({ by: "hub-builder", amount: 5, reason: "a statue" });
  A.voteSpend({ id: q.proposal.id, desk: "hub-builder", vote: "no" });
  const out = A.voteSpend({ id: q.proposal.id, desk: "hr", vote: "no" });
  assert.equal(out.status, "rejected");
  assert.equal(A.fundState().fund, fund - 10, "a rejected proposal spends nothing");
});
test("the fund only moves through the log: taxes in, voted spends out", () => {
  const st = A.fundState(), L = lines();
  const inn = L.filter((l) => l.kind === "tax" || l.kind === "tax refund").reduce((a, l) => a + l.fund, 0);
  const out = L.filter((l) => l.kind === "spend").reduce((a, l) => a + l.amount, 0);
  assert.equal(Math.round((inn - out) * 100) / 100, st.fund);
  for (const s of L.filter((l) => l.kind === "spend")) assert.ok(L.some((p) => p.kind === "proposal" && p.id === s.id), "every spend has a proposal");
});

test("the owner decides a proposal on his own: yes spends at once, no rejects at once", () => {
  reset(); settings(LOOSE);
  for (let i = 0; i < 3; i++) A.taxPurchase({ buyer: "a1", item: "piano", price: 100 }); // fund 30
  const owner = S.ownerId();
  const p = A.proposeSpend({ by: "hub-builder", amount: 12, reason: "new benches" });
  assert.equal(p.status, "open");
  const yes = A.voteSpend({ id: p.proposal.id, vote: "yes" }, { owner: true });
  assert.equal(yes.status, "spent");
  assert.equal(A.fundState().fund, 18);
  assert.ok(lines().some((l) => l.kind === "vote" && l.by === owner && l.owner === true), "the owner's vote is logged as his");
  const q = A.proposeSpend({ by: owner, amount: 5, reason: "fireworks" });
  A.voteSpend({ id: q.proposal.id, desk: "hub-builder", vote: "yes" }); // finance + lead: that's already a majority
  assert.equal(A.fundState().fund, 13);
  const r = A.proposeSpend({ by: "hub-builder", amount: 5, reason: "a second fountain" }); // finance yes: 1 of 2 needed
  const no = A.voteSpend({ id: r.proposal.id, vote: "no" }, { owner: true });
  assert.equal(no.status, "rejected");
  assert.equal(A.fundState().fund, 13, "the owner's no spends nothing");
  assert.throws(() => A.voteSpend({ id: r.proposal.id, desk: "hr", vote: "yes" }), /already rejected/);
});

// Spend limits (part 5 design, answer 6A): no one player takes over the fund.
const fundOf = (n) => { for (let i = 0; i < n; i++) A.taxPurchase({ buyer: "a1", item: "piano", price: 100 }); }; // 10 credits each
test("limit: one spend is at most 25% of the fund (the owner is outside the limits)", () => {
  reset(); settings({}); fundOf(10); // fund 100
  assert.throws(() => A.proposeSpend({ by: "hub-builder", amount: 26, reason: "too big" }), /at most 25% of the fund/);
  assert.equal(A.proposeSpend({ by: "hub-builder", amount: 25, reason: "just fits" }).status, "open");
  assert.equal(A.proposeSpend({ by: S.ownerId(), amount: 60, reason: "the owner's call" }).status, "open");
  assert.equal(lines().filter((l) => l.kind === "proposal").length, 2, "a refused proposal writes nothing");
});
test("limit: one open proposal per player", () => {
  assert.throws(() => A.proposeSpend({ by: "hub-builder", amount: 5, reason: "another" }), /already has an open proposal/);
});
test("limit: at most 40% of the fund leaves in 7 days", () => {
  reset(); settings({ agents: { cityFund: { limits: { perSpend: 1, perPlayer30d: 1, perWeek: 0.4 } } } }); fundOf(10); // 100
  const a = A.proposeSpend({ by: "hub-builder", amount: 30, reason: "lamps" });
  A.voteSpend({ id: a.proposal.id, desk: "hr", vote: "yes" }); // spent: fund 70, 30 out this week
  assert.throws(() => A.proposeSpend({ by: "hub-builder", amount: 11, reason: "more lamps" }), /40% of the fund can leave in 7 days/);
  assert.equal(A.proposeSpend({ by: "hub-builder", amount: 10, reason: "a few more lamps" }).status, "open", "30 + 10 = 40% of the 100 at the start of the week");
});
test("limit: one player gets at most 10% of the fund in 30 days, and can't vote on its own grant", () => {
  reset(); settings({ agents: { cityFund: { limits: { perSpend: 1, perPlayer30d: 0.1, perWeek: 1 } } } }); fundOf(10); // 100
  const a = A.proposeSpend({ by: S.ownerId(), amount: 50, reason: "seed money" }); // the owner can still give a big grant
  assert.equal(a.status, "open");
  const g = A.proposeSpend({ by: "finance-lead", amount: 8, reason: "tidy desk award", payee: "hub-builder" });
  assert.throws(() => A.voteSpend({ id: g.proposal.id, desk: "hub-builder", vote: "yes" }), /gains from this one/);
  A.voteSpend({ id: g.proposal.id, desk: "hr", vote: "yes" }); // spent: 8 to hub-builder
  assert.throws(() => A.proposeSpend({ by: "hr", amount: 3, reason: "again", payee: "hub-builder" }), /at most 10% of the fund in 30 days/);
});
test("limit: a player can't propose for itself again within 7 days", () => {
  reset(); settings({ agents: { cityFund: { limits: { perSpend: 1, perPlayer30d: 1, perWeek: 1, selfCooldownDays: 7 } } } }); fundOf(10);
  const a = A.proposeSpend({ by: "hub-builder", amount: 5, reason: "my chair", payee: "hub-builder" });
  A.voteSpend({ id: a.proposal.id, vote: "no" }, { owner: true });
  assert.throws(() => A.proposeSpend({ by: "hub-builder", amount: 5, reason: "my chair again", payee: "hub-builder" }), /for itself less than 7 days ago/);
  assert.equal(A.proposeSpend({ by: "hub-builder", amount: 5, reason: "a bench for everyone" }).status, "open", "a spend for the city is fine");
});
test("district founding is outside the per-player limits but still needs the fund to cover it and the board's vote", () => {
  reset(); settings({}); fundOf(20); // 200
  assert.throws(() => A.proposeSpend({ by: "hub-builder", amount: 105, reason: "district" }), /25% of the fund/);
  const d = A.proposeSpend({ amount: 105, reason: "found Maple Court", kind: "district", benefit: "a2", item: "district" }, { system: true });
  assert.equal(d.status, "open"); assert.equal(d.proposal.by, "city"); assert.equal(d.proposal.benefit, "a2");
  assert.throws(() => A.proposeSpend({ amount: 500, reason: "too much", kind: "district" }, { system: true }), /The fund has/);
  const out = A.voteSpend({ id: d.proposal.id, desk: "hub-builder", vote: "yes" });
  assert.equal(out.status, "spent"); assert.equal(out.amount, 105);
  assert.equal(lines().find((l) => l.kind === "spend").spendKind, "district");
});
test("vote replies always carry the amount; the view says the quota is in dollars", () => {
  reset(); settings(LOOSE); fundOf(5);
  const p = A.proposeSpend({ by: "hub-builder", amount: 7, reason: "flowers" });
  assert.equal(p.amount, 7, "still open");
  assert.equal(A.voteSpend({ id: p.proposal.id, desk: "hr", vote: "no" }).amount, 7);
  const v = A.fundView();
  assert.equal(v.quota.unit, "usd"); assert.equal(v.limits.perSpend, 1);
});

// Review fixes (part 6 review, 2026-11-20)
test("H1: naming the owner as the voter is refused; the owner votes only with the owner flag", () => {
  reset(); settings(LOOSE); fundOf(10);
  const p = A.proposeSpend({ by: "hub-builder", amount: 10, reason: "lamps" });
  assert.throws(() => A.voteSpend({ id: p.proposal.id, desk: S.ownerId(), vote: "yes" }), /votes from the dashboard/);
  assert.equal(A.fundState().proposals.find((x) => x.id === p.proposal.id).status, "open", "nothing decided");
  assert.equal(A.voteSpend({ id: p.proposal.id, vote: "yes" }, { owner: true }).status, "spent");
});
test("M1: a proposal nobody decides is turned down after 3 days", () => {
  reset(); settings(LOOSE); fundOf(10);
  const p = A.proposeSpend({ by: "hub-builder", amount: 10, reason: "a gazebo" }); // finance yes, 1 of 2
  assert.deepEqual(A.fundTick(Date.now() + 2 * 864e5), [], "still within 3 days");
  assert.deepEqual(A.fundTick(Date.now() + 3 * 864e5 + 1000), [p.proposal.id]);
  const st = A.fundState();
  assert.equal(st.proposals[0].status, "rejected"); assert.equal(st.fund, 100, "nothing spent");
  assert.ok(lines().some((l) => l.kind === "rejected" && l.expired));
});
test("L2: a refund gives back the tax actually paid (not today's rate) and never takes the fund below zero", () => {
  reset(); settings(LOOSE);
  const t = A.taxPurchase({ buyer: "a1", item: "crown", price: 30 }); // 3 at 10%
  settings({ agents: { cityFund: { taxRate: 0.5, limits: LOOSE.agents.cityFund.limits } } });
  const back = A.refundTax({ buyer: "a1", item: "crown", price: 30, paid: t.cost });
  assert.equal(back.cost, -3, "the 3 paid, not 15 at the new rate");
  assert.equal(A.fundState().fund, 0);
  settings(LOOSE);
  A.taxPurchase({ buyer: "a1", item: "crown", price: 30 }); // fund 3
  const p = A.proposeSpend({ by: S.ownerId(), amount: 3, reason: "spend it all" });
  A.voteSpend({ id: p.proposal.id, vote: "yes" }, { owner: true }); // fund 0
  const r = A.refundTax({ buyer: "a1", item: "crown", price: 30, paid: 3 });
  assert.equal(r.cost, -3, "the buyer still gets it back");
  assert.equal(A.fundState().fund, 0, "the fund doesn't go below zero");
  assert.equal(lines().at(-1).uncovered, 3);
});
test("L4: the finance desk doesn't auto-vote on a spend it gains from", () => {
  reset(); settings(LOOSE); fundOf(10);
  const p = A.proposeSpend({ by: "hub-builder", amount: 5, reason: "finance award", payee: "finance-lead" });
  assert.equal(p.status, "open"); assert.equal(p.yes, 0, "no auto-vote from the payee");
  assert.throws(() => A.voteSpend({ id: p.proposal.id, desk: "finance-lead", vote: "yes" }), /gains from this one/);
});
