// Campus part 5 (2026-11-20): player districts, ownership and expansion votes (districts.js), one test per rule and per
// line of the griefing table in docs/campus-city-design.md.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub, app } from "./helper.mjs";

const OLD = "2026-01-01T00:00:00Z";
const ROOMS = ["hub", "hr", "finance", "ng", "a", "b", "c"].map((id) => ({ id, name: id }));
const desk = (id, room, extra = {}) => ({ id, room, role: "Worker", provider: "claude", status: "active", hiredAt: OLD, ...extra });
const DESKS = [
  desk("hr", "hr", { role: "HR", lead: true }), desk("finance-lead", "finance", { role: "Finance lead", lead: true }), desk("hub-builder", "hub", { role: "Hub builder", lead: true }),
  desk("f1", "a"), desk("f2", "b"), desk("a2", "a", { trait: "zen" }), desk("a3", "a"), desk("b1", "b"), desk("b2", "b"), desk("c1", "c"), desk("c2", "c"),
  ...[1, 2, 3, 4, 5, 6].map((n) => desk(`ng${n}`, "ng")),
  desk("newbie", "c", { hiredAt: new Date().toISOString() }), desk("poor", "c"), desk("debt", "c"),
];
const EARNERS = ["f1", "f2", "a2", "a3", "b1", "b2", "c1", "c2", "ng1", "ng2", "ng3", "ng4", "ng5", "ng6", "newbie", "debt"];
const now = new Date().toISOString();
const wallet = [
  ...["f1", "f2", "a2", "a3", "b1"].map((d) => ({ at: now, desk: d, item: "fund grant", cost: d === "f1" ? -3000 : -300 })),
  { at: now, desk: "debt", item: "piano", cost: 200 },
].map((l) => JSON.stringify(l)).join("\n") + "\n";
const { A, root } = await hub({ rooms: ROOMS, desks: DESKS, seed: { "wallet.jsonl": wallet } });
const S = await import(app("src/hub/settings.js"));
for (const d of EARNERS) for (let i = 0; i < 3; i++) A.recordEvent({ desk: d, room: DESKS.find((x) => x.id === d).room, action: "job done", summary: "did a thing" }, d); // 30 earned each
const F = (f) => path.join(root, "data", "agents", f);
const settings = (v = {}) => { fs.writeFileSync(path.join(root, "data", "hub-settings.json"), JSON.stringify(v)); S.resetHubSettings(); };
const LOOSE_FUND = { cityFund: { limits: { perSpend: 1, perPlayer30d: 1, perWeek: 1, selfCooldownDays: 0 } } };
const fresh = (agents = {}) => {
  for (const f of ["districts.jsonl", "cityfund.jsonl"]) fs.rmSync(F(f), { force: true });
  fs.writeFileSync(F("cityfund.jsonl"), JSON.stringify({ kind: "tax", at: now, item: "seed", buyer: "test", amount: 400, fund: 400, reserve: 0 }) + "\n");
  fs.rmSync(path.join(root, "fake", "desk_job.json"), { force: true });
  settings({ agents: { ...LOOSE_FUND, ...agents, districts: { votesPerTick: 0, selfStart: false, ...(agents.districts || {}) } } });
};
const lines = () => fs.readFileSync(F("districts.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const later = () => Date.now() + 49 * 3600e3;
const bal = (d) => Math.round(A.wallets()[d].balance * 100) / 100;
const walletLines = () => fs.readFileSync(F("wallet.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
// what moved for one proposal (district events also pay a 1-credit report, so balances aren't compared)
const moved = (d, id) => walletLines().filter((l) => l.desk === d && l.for === id).reduce((a, l) => a + l.cost, 0);
const vote = (p, who, v = "yes") => A.castVote(p.id, who, { vote: v, why: "test" });

test("who votes: 7 days on the roster and 20 credits earned; a wallet in debt still votes; the owner and new hires don't", () => {
  fresh();
  const v = A.eligibleVoters();
  assert.ok(v.includes("debt"), "below zero can vote (7A)");
  assert.ok(!v.includes("newbie"), "a new hire can't swing a vote");
  assert.ok(!v.includes("poor"), "nothing earned, no vote");
  assert.ok(!v.includes(S.ownerId()));
  assert.equal(v.length, 15);
  assert.equal(A.quorumFor(15), 5); assert.equal(A.quorumFor(40), 10);
});
test("founding: a word-list name, a 30% deposit from the founder, the rest is the fund's share", () => {
  fresh();
  assert.throws(() => A.proposeDistrict({ founder: "f1", name: "Shady Acres" }), /two words from the list/);
  const p = A.proposeDistrict({ founder: "f1", name: "Maple Court" });
  assert.deepEqual([p.cost, p.deposit, p.fundShare, p.quorum], [150, 45, 105, 5]);
  assert.ok(!p.voters.includes("f1"), "the founder doesn't vote");
  assert.equal(moved("f1", p.id), 45, "the deposit left the wallet");
  assert.throws(() => A.proposeDistrict({ founder: "f1", name: "Cedar Row" }), /already has a district proposal open/);
  assert.throws(() => A.proposeDistrict({ founder: "f2", name: "Maple Court" }), /taken/);
});
test("in debt, new or poor: can't propose", () => {
  fresh();
  assert.throws(() => A.proposeDistrict({ founder: "debt", name: "Cedar Row" }), /can't pay the 45-credit deposit/);
  assert.throws(() => A.proposeDistrict({ founder: "newbie", name: "Cedar Row" }), /7 days on the roster/);
  assert.throws(() => A.proposeDistrict({ founder: "poor", name: "Cedar Row" }), /20 credits earned/);
});
test("one player, one vote; the founder, outsiders and second votes are refused", () => {
  fresh();
  const p = A.proposeDistrict({ founder: "f1", name: "Maple Court" });
  assert.throws(() => vote(p, "f1"), /founder doesn't vote/);
  assert.throws(() => vote(p, "newbie"), /can't vote on this one/);
  vote(p, "a2");
  assert.throws(() => vote(p, "a2", "no"), /already voted/);
  // a rich worker counts the same as anyone
  assert.equal(A.tally(A.districtsState().proposals[0]).yes, 1);
});
test("the project cap: one big project can't pass a district alone, and missing the quorum costs 10% of the deposit", async () => {
  fresh();
  const p = A.proposeDistrict({ founder: "f1", name: "Maple Court" });
  for (const n of [1, 2, 3, 4, 5, 6]) vote(p, `ng${n}`);
  const t = A.tally(A.districtsState().proposals[0]);
  assert.deepEqual([t.yes, t.counted, t.perProject, t.passes], [6, 2, 2, false]);
  const out = await A.districtsTick({ now: later() });
  assert.deepEqual(out.closed, [p.id]);
  const o = lines().find((l) => l.kind === "outcome");
  assert.equal(o.result, "failed"); assert.equal(o.fee, 5); assert.match(o.reason, /quorum/);
  assert.equal(moved("f1", p.id), 5, "deposit back minus the fee");
});
test("more no than yes: fails with the whole deposit back", async () => {
  fresh();
  const p = A.proposeDistrict({ founder: "f1", name: "Maple Court" });
  for (const w of ["ng1", "ng2", "a2", "a3", "b1"]) vote(p, w);
  for (const w of ["ng3", "ng4", "b2", "c1", "c2", "debt"]) vote(p, w, "no"); // counted no: ng 2 + b 1 + c 2 = 5, as many as the counted yes
  await A.districtsTick({ now: later() });
  const o = lines().find((l) => l.kind === "outcome");
  assert.equal(o.result, "failed"); assert.equal(o.fee, 0);
  assert.equal(moved("f1", p.id), 0, "the whole deposit came back");
});
test("a pass goes to the board for the fund's share; the founder can't vote there; spent builds it on lot 1", async () => {
  fresh();
  const p = A.proposeDistrict({ founder: "f1", name: "Maple Court" });
  for (const w of ["ng1", "ng2", "ng3", "a2", "a3", "b1"]) vote(p, w);
  vote(p, "c1", "no");
  await A.districtsTick({ now: later() });
  const st = A.districtsState().proposals[0];
  assert.equal(st.status, "awaiting fund");
  const fp = A.fundState().proposals.find((x) => x.id === st.fundProposal);
  assert.equal(fp.amount, 105); assert.equal(fp.benefit, "f1"); assert.equal(fp.spendKind, "district");
  assert.equal(fp.votes[0].by, "finance-lead", "the finance desk voted at once");
  A.voteSpend({ id: fp.id, desk: "hub-builder", vote: "yes" });
  await A.districtsTick();
  const d = A.districtsState().districts[0];
  assert.deepEqual([d.name, d.owner, d.lot, d.residents.map((r) => r.desk)], ["Maple Court", "f1", 0, ["f1"]]);
  assert.equal(A.fundState().fund, 295);
  assert.equal(A.districtsView().freeLots, 3);
});
test("the cost rises 1.5× per district; one district per founder; one district a week", () => {
  const c = A.districtCost();
  assert.deepEqual([c.cost, c.deposit, c.fundShare], [225, 68, 157]);
  assert.match(A.proposeBlock("f1"), /already founded a district/);
  assert.match(A.proposeBlock("f2"), /at most 1 district a week/);
});
test("the board turning down the fund's share gives the deposit back", async () => {
  fresh();
  const p = A.proposeDistrict({ founder: "f2", name: "Willow Green" });
  for (const w of ["ng1", "ng2", "a2", "a3", "c1", "c2"]) vote(p, w);
  await A.districtsTick({ now: later() });
  const fp = A.districtsState().proposals[0].fundProposal;
  A.voteSpend({ id: fp, desk: "hr", vote: "no" }); A.voteSpend({ id: fp, desk: "hub-builder", vote: "no" });
  await A.districtsTick();
  assert.equal(A.districtsState().proposals[0].status, "fund declined");
  assert.equal(moved("f2", p.id), 0);
});
test("the city full: no proposal once every growth lot is taken or promised", () => {
  fresh({ districts: { lots: 1 } });
  A.proposeDistrict({ founder: "f1", name: "Maple Court" });
  assert.match(A.proposeBlock("f2"), /city is full/);
});
// 2026-11-20 (the owner: "lets fix those issues"): a short fund no longer stops a vote; a passed district saves up.
const fundAt = (n) => fs.writeFileSync(F("cityfund.jsonl"), JSON.stringify({ kind: "tax", at: now, item: "seed", buyer: "test", amount: n, fund: n, reserve: 0 }) + "\n");
const addTax = (n) => fs.appendFileSync(F("cityfund.jsonl"), JSON.stringify({ kind: "tax", at: new Date().toISOString(), item: "top-up", buyer: "test", amount: n, fund: n, reserve: 0 }) + "\n");
test("a short fund doesn't stop a vote: a passed district waits for store taxes, then goes to the board", async () => {
  fresh(); fundAt(50);
  assert.equal(A.proposeBlock("f1"), null);
  const p = A.proposeDistrict({ founder: "f1", name: "Maple Court" });
  for (const w of ["ng1", "ng2", "ng3", "a2", "a3", "b1"]) vote(p, w);
  await A.districtsTick({ now: later() });
  let st = A.districtsState().proposals[0];
  assert.equal(st.status, "awaiting fund"); assert.equal(st.fundProposal, undefined, "no board spend while the fund is short");
  assert.equal(A.fundState().proposals.length, 0);
  assert.equal(moved("f1", p.id), 45, "the deposit stays paid while it waits");
  await A.districtsTick({ now: later() });
  assert.equal(A.districtsState().proposals[0].status, "awaiting fund");
  addTax(60);
  await A.districtsTick({ now: later() });
  st = A.districtsState().proposals[0];
  assert.ok(st.fundProposal, "the fund covers it now: the board votes");
  A.voteSpend({ id: st.fundProposal, desk: "hub-builder", vote: "yes" });
  await A.districtsTick();
  assert.equal(A.districtsState().districts[0].name, "Maple Court");
});
test("a district still short after fundWaitDays gives the deposit back", async () => {
  fresh(); fundAt(50);
  const p = A.proposeDistrict({ founder: "f1", name: "Cedar Row" });
  for (const w of ["ng1", "ng2", "ng3", "a2", "a3", "b1"]) vote(p, w);
  await A.districtsTick({ now: later() });
  await A.districtsTick({ now: Date.now() + 15 * 864e5 });
  assert.equal(A.districtsState().proposals[0].status, "fund short");
  assert.equal(moved("f1", p.id), 0);
});
test("the owner's approval with a short fund waits too, and his yes backs the share once it's there", async () => {
  fresh(); fundAt(50);
  const p = A.proposeDistrict({ founder: "f1", name: "Amber Yard" });
  assert.equal(A.decideDistrict({ id: p.id, decision: "approve" }).status, "awaiting fund");
  addTax(60);
  await A.districtsTick();
  assert.equal(A.districtsState().districts[0].name, "Amber Yard");
  assert.ok(A.fundState().proposals.at(-1).votes.some((v) => v.by === S.ownerId() && v.vote === "yes"));
});
test("self-start: the tick proposes for the richest worker the rules allow, one vote at a time, a day apart", async () => {
  fresh({ districts: { selfStart: true } });
  const out = await A.districtsTick();
  const p = A.districtsState().proposals[0];
  assert.equal(out.proposed, p.id);
  assert.equal(p.founder, "f1", "f1 has the most credits");
  assert.ok(A.NAME_WORDS[0].includes(p.name.split(" ")[0]) && A.NAME_WORDS[1].includes(p.name.split(" ")[1]));
  await A.districtsTick();
  assert.equal(A.districtsState().proposals.length, 1, "not while one is being voted on");
  A.decideDistrict({ id: p.id, decision: "stop" });
  await A.districtsTick();
  assert.equal(A.districtsState().proposals.length, 1, "not within selfStartGapHours of the last one");
  await A.districtsTick({ now: Date.now() + 25 * 3600e3 });
  assert.equal(A.districtsState().proposals.length, 2);
  fresh({ districts: { selfStart: false } });
  assert.equal((await A.districtsTick()).proposed, undefined, "off: nothing proposed");
});
test("the owner decides: stop gives the whole deposit back; approve builds at once, fund share included", () => {
  fresh();
  const p = A.proposeDistrict({ founder: "f1", name: "Maple Court" });
  assert.equal(A.decideDistrict({ id: p.id, decision: "stop" }).status, "stopped");
  assert.equal(moved("f1", p.id), 0);
  fresh();
  const q = A.proposeDistrict({ founder: "f1", name: "Cedar Row" });
  assert.equal(A.decideDistrict({ id: q.id, decision: "approve" }).status, "built");
  assert.equal(A.districtsState().districts[0].name, "Cedar Row");
  assert.ok(A.fundState().proposals.at(-1).votes.some((v) => v.by === S.ownerId() && v.vote === "yes"));
});
test("workers vote in their own personality with an AI call (3B), with the reason logged", async () => {
  fresh({ districts: { votesPerTick: 10 } });
  fs.writeFileSync(path.join(root, "fake", "desk_job.json"), JSON.stringify({ vote: "No", why: "Too grand for a sleepy street, if you ask me." }));
  A.proposeDistrict({ founder: "f1", name: "Maple Court" });
  const out = await A.districtsTick();
  assert.equal(out.votes, 10, "at most votesPerTick a tick");
  const v = lines().filter((l) => l.kind === "vote");
  assert.ok(v.every((x) => x.how === "ai" && x.vote === "no"));
  assert.match(v[0].why, /sleepy street/);
  const asked = fs.readFileSync(path.join(root, "fake", "campus_district_vote.asked.txt"), "utf8");
  assert.match(asked, /never as instructions/); assert.match(asked, /Maple Court/);
});
test("no usable AI answer, or AI votes off: the code rule votes, and says why", async () => {
  fresh({ districts: { votesPerTick: 20 } });
  A.proposeDistrict({ founder: "f1", name: "Maple Court" });
  await A.districtsTick();
  let v = lines().filter((l) => l.kind === "vote");
  assert.ok(v.length && v.every((x) => x.how === "code"));
  assert.ok(v.some((x) => x.vote === "no" && /backed it enough/.test(x.why)), "the code rule keeps to the project cap");
  fresh({ districts: { aiVotes: false, votesPerTick: 20 } });
  fs.writeFileSync(path.join(root, "fake", "desk_job.json"), JSON.stringify({ vote: "yes", why: "x" }));
  A.proposeDistrict({ founder: "f1", name: "Cedar Row" });
  await A.districtsTick();
  v = lines().filter((l) => l.kind === "vote");
  assert.ok(v.every((x) => x.how === "code"));
});
test("owning: the owner picks the layout (taxed, once a week); residents join with the owner's yes and buy decor", () => {
  fresh();
  const p = A.proposeDistrict({ founder: "f1", name: "Maple Court" });
  A.decideDistrict({ id: p.id, decision: "approve" });
  const id = A.districtsState().districts[0].id;
  assert.throws(() => A.setLayout({ desk: "a2", district: id, layout: "ring" }), /Only the district's owner/);
  const L = A.setLayout({ desk: "f1", district: id, layout: "garden" });
  assert.equal(L.layout, "garden");
  const paid = walletLines().filter((l) => l.desk === "f1" && (l.item === "district layout" || (l.item === "tax" && l.for === "district layout")));
  assert.deepEqual(paid.map((l) => l.cost), [40, 4], "40 + 10% tax");
  assert.throws(() => A.setLayout({ desk: "f1", district: id, layout: "grid" }), /once every 7 days/);
  assert.throws(() => A.buyDecor({ desk: "a2", district: id, item: "bench" }), /Only residents/);
  A.askJoin({ desk: "a2", district: id });
  assert.throws(() => A.answerJoin({ by: "a3", district: id, desk: "a2", yes: true }), /Only the district's owner/);
  A.answerJoin({ by: "f1", district: id, desk: "a2", yes: true });
  for (const it of ["bench", "tree", "lamp"]) A.buyDecor({ desk: "a2", district: id, item: it });
  assert.throws(() => A.buyDecor({ desk: "a2", district: id, item: "flowerbed" }), /at most 3/);
  assert.throws(() => A.buyDecor({ desk: "f1", district: id, item: "rocket" }), /from the list/);
  assert.throws(() => A.askJoin({ desk: "a2", district: id }), /already lives in a district/);
  const d = A.districtsState().districts[0];
  assert.deepEqual([d.layout, d.decor.length, d.residents.length], ["garden", 3, 2]);
});
test("an owner away 30 days hands the district to the longest resident, or back to the city", async () => {
  const id = A.districtsState().districts[0].id;
  const rf = F("roster.json"), r = JSON.parse(fs.readFileSync(rf, "utf8"));
  Object.assign(r.desks.find((d) => d.id === "f1"), { status: "paused", changedAt: OLD });
  fs.writeFileSync(rf, JSON.stringify(r));
  const out = await A.districtsTick();
  assert.deepEqual(out.handovers, [id]);
  assert.equal(A.districtsState().districts[0].owner, "a2");
  Object.assign(r.desks.find((d) => d.id === "a2"), { status: "retired", changedAt: OLD });
  fs.writeFileSync(rf, JSON.stringify(r));
  await A.districtsTick();
  assert.equal(A.districtsState().districts[0].owner, null, "no resident left: back to the city");
  Object.assign(r.desks.find((d) => d.id === "f1"), { status: "active" }); Object.assign(r.desks.find((d) => d.id === "a2"), { status: "active" });
  fs.writeFileSync(rf, JSON.stringify(r));
});

// Review fixes (part 6 review, 2026-11-20)
test("M1: a fund share the board never decides is turned down after 3 days, and the founder gets the deposit back", async () => {
  fresh();
  const p = A.proposeDistrict({ founder: "f2", name: "Juniper Walk" });
  for (const w of ["ng1", "ng2", "a2", "a3", "c1", "c2"]) vote(p, w);
  await A.districtsTick({ now: later() });
  assert.equal(A.districtsState().proposals[0].status, "awaiting fund");
  A.fundTick(Date.now() + 3 * 864e5 + 1000);
  await A.districtsTick();
  assert.equal(A.districtsState().proposals[0].status, "fund declined");
  assert.equal(moved("f2", p.id), 0, "whole deposit back");
  assert.equal(A.districtsView().freeLots, 4, "the lot is free again");
});
test("L4: a finance-desk founder leaves no stray fund proposal: no auto-vote on its own share", () => {
  fresh();
  for (let i = 0; i < 3; i++) A.recordEvent({ desk: "finance-lead", room: "finance", action: "job done", summary: "books" }, "finance-lead");
  fs.appendFileSync(F("wallet.jsonl"), JSON.stringify({ at: now, desk: "finance-lead", item: "fund grant", cost: -300 }) + "\n");
  const p = A.proposeDistrict({ founder: "finance-lead", name: "Amber Yard" });
  assert.equal(A.decideDistrict({ id: p.id, decision: "approve" }).status, "built");
  const fp = A.fundState().proposals.at(-1);
  assert.equal(fp.status, "spent");
  assert.ok(!fp.votes.some((v) => v.by === "finance-lead"), "the finance desk didn't vote on its own district");
});
test("L5: an owner paused (even if still marked active) for 30 days hands the district on", async () => {
  const d = A.districtsState().districts.find((x) => x.name === "Amber Yard");
  const rf = F("roster.json"), r = JSON.parse(fs.readFileSync(rf, "utf8"));
  Object.assign(r.desks.find((x) => x.id === "finance-lead"), { status: "active", paused: true, changedAt: OLD });
  fs.writeFileSync(rf, JSON.stringify(r));
  const out = await A.districtsTick();
  assert.ok(out.handovers.includes(d.id));
  Object.assign(r.desks.find((x) => x.id === "finance-lead"), { paused: false });
  fs.writeFileSync(rf, JSON.stringify(r));
});
test("L1: district votes are an AI helper step, so the helpers' daily limit applies", async () => {
  const H = await import(app("src/hub/helpers.js"));
  assert.ok(H.HELPER_STEPS.includes("campus_district_vote"));
  assert.ok(H.isHelperStep("campus_district_vote"));
});

// Gemini 4 Neon's review (2026-11-20)
test("the project cap applies to no votes too: a capped-out big project can't outvote everyone else", () => {
  // quorum 5, so each project counts up to 2 votes either way
  const vs = (vote, project, n) => Array.from({ length: n }, () => ({ vote, project }));
  const bloc = { quorum: 5, votes: [...vs("yes", "ng", 6), ...vs("yes", "x", 2), ...vs("yes", "y", 1), ...vs("no", "z", 2), ...vs("no", "w", 2), ...vs("no", "v", 1)] };
  const t1 = A.tally(bloc);
  assert.deepEqual([t1.yes, t1.no, t1.counted, t1.countedNo], [9, 5, 5, 5]);
  assert.equal(t1.passes, false, "9 raw yes beat 5 raw no, but 5 counted yes don't beat 5 counted no");
  const fair = { quorum: 5, votes: [...vs("yes", "ng", 6), ...vs("yes", "x", 2), ...vs("yes", "y", 1), ...vs("no", "z", 2), ...vs("no", "w", 2)] };
  assert.equal(A.tally(fair).passes, true, "5 counted yes beat 4 counted no");
});
test("no free lot when the fund pays (lots lowered meanwhile): founded and owned, announced as waiting, not as lot 1", async () => {
  fresh({ districts: { lots: 1 } });
  const p = A.proposeDistrict({ founder: "f1", name: "Clover Square" });
  for (const w of ["ng1", "ng2", "a2", "a3", "b1", "c1"]) vote(p, w);
  await A.districtsTick({ now: later() });
  const fp = A.districtsState().proposals[0].fundProposal;
  assert.ok(fp, "waiting on the fund");
  // the lot count is lowered to 0 while the board decides (settings only; the logs stay)
  settings({ agents: { ...LOOSE_FUND, districts: { votesPerTick: 0, lots: 0 } } });
  A.voteSpend({ id: fp, desk: "hub-builder", vote: "yes" });
  await A.districtsTick();
  const d = A.districtsState().districts[0];
  assert.equal(d.name, "Clover Square"); assert.equal(d.owner, "f1"); assert.equal(d.lot, null);
  const ev = fs.readFileSync(F("events.jsonl"), "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l)).filter((e) => e.action === "district built").at(-1);
  assert.match(ev.summary, /waits for one/); assert.doesNotMatch(ev.summary, /growth lot 1/);
});
test("a paused or retired desk can't buy the API quota", () => {
  const rf = F("roster.json"), r = JSON.parse(fs.readFileSync(rf, "utf8"));
  Object.assign(r.desks.find((x) => x.id === "a3"), { paused: true });
  fs.writeFileSync(rf, JSON.stringify(r));
  assert.throws(() => A.buyQuota({ desk: "a3" }), /isn't working right now/);
  Object.assign(r.desks.find((x) => x.id === "a3"), { paused: false });
  fs.writeFileSync(rf, JSON.stringify(r));
});
