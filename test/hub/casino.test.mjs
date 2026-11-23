// The campus casino (src/pipeline/agents/casino.js, 2026-11-23): workers play the owner's slot game with play credits.
// A tiny fixture table stands in for the game's maths; nothing here reads the real data folder.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub, app, APP } from "./helper.mjs";

const ROOMS = [{ id: "hub", name: "Hub" }, { id: "hr", name: "HR" }, { id: "game", name: "Game" }];
const DESKS = [
  { id: "hr", room: "hr", role: "HR", lead: true, provider: "claude", status: "active" },
  { id: "rich", room: "game", role: "Worker", provider: "claude", status: "active" },
  { id: "busy", room: "game", role: "Worker", provider: "claude", status: "active" },
  { id: "poor", room: "game", role: "Worker", provider: "claude", status: "active" },
  { id: "gone", room: "game", role: "Worker", provider: "claude", status: "paused" },
  { id: "pet", room: "hub", role: "Pet", provider: "claude", status: "active" },
];
const now = new Date().toISOString();
const grant = (desk, n) => JSON.stringify({ at: now, desk, item: "fund grant", cost: -n });
const wallet = [grant("rich", 200), grant("busy", 200), grant("poor", 5), grant("gone", 200), grant("pet", 500)].join("\n") + "\n";
const jobsSeed = JSON.stringify({ id: "j1", desk: "busy", text: "a job", at: now }) + "\n";
const { A, root, data } = await hub({ rooms: ROOMS, desks: DESKS, seed: { "wallet.jsonl": wallet, "jobs.jsonl": jobsSeed } });
const S = await import(app("src/hub/settings.js"));
const settings = (v) => { fs.writeFileSync(path.join(root, "data", "hub-settings.json"), JSON.stringify(v)); S.resetHubSettings(); };
const LOG = data("casino.jsonl");
const lines = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

// Fixture: ids 0-5. Ids 2 and 5 have free-spin wins, so base-only play must never draw them.
const DIR = path.join(root, "data", "casino", "fixture");
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(path.join(DIR, "lookUpTable_base_0.csv"), "0,1,0\n1,1,50\n2,5,1000\n3,2,200\n4,1,0\n5,5,500\n");
fs.writeFileSync(path.join(DIR, "lookUpTableSegmented_base.csv"), "0,0,0.0,0.0\n1,basegame,0.5,0.0\n2,freegame,2.0,8.0\n3,basegame,2.0,0.0\n4,0,0.0,0.0\n5,freegame,0.0,5.0\n");
const ON = { agents: { casino: { on: true, dataDir: "data/casino/fixture", chance: 1, perTick: 10, gapMinutes: 0, maxSessionsPerDay: 2 } } };

test("off by default: the kit ships it off and a tick plays nothing", () => {
  settings({});
  const defaults = JSON.parse(fs.readFileSync(path.join(APP, "hub.defaults.json"), "utf8"));
  assert.equal(defaults.agents.casino.on, false);
  assert.equal(A.casinoSettings().on, false);
  assert.deepEqual(A.casinoTick({ rng: A.seededRng(1) }), []);
  assert.equal(lines().length, 0);
});

test("missing files: the casino is closed, with a reason, and nothing crashes", () => {
  settings({ agents: { casino: { on: true, dataDir: "data/casino/nowhere", chance: 1 } } });
  const t = A.loadTable(path.join(root, "data", "casino", "nowhere"));
  assert.equal(t.open, false);
  assert.match(t.why, /aren't in/);
  assert.deepEqual(A.casinoTick({ rng: A.seededRng(1) }), []);
  const v = A.casinoView();
  assert.equal(v.open, false);
  assert.match(v.why, /lookUpTable_base_0\.csv/);
  assert.throws(() => A.playFor({ id: "rich" }), /closed/);
});

test("base only: free-spin rounds are left out; weights and the table's return come from the files", () => {
  const t = A.loadTable(DIR);
  assert.equal(t.open, true);
  assert.equal(t.rows, 6);
  assert.deepEqual(t.outcomes.map((o) => o.id), [0, 1, 3, 4]);
  assert.equal(t.total, 5); // weights 1 + 1 + 2 + 1
  assert.ok(Math.abs(t.rtp - (0.5 + 2 * 2) / 5) < 1e-9); // 0.9
  assert.ok(Math.abs(t.hitRate - 3 / 5) < 1e-9);
});

test("weighted draws with a seeded generator: repeatable, by weight, never a free-spin round", () => {
  const t = A.loadTable(DIR);
  const a = Array.from({ length: 50 }, ((r) => () => A.drawOutcome(t, r).id)(A.seededRng(42)));
  const b = Array.from({ length: 50 }, ((r) => () => A.drawOutcome(t, r).id)(A.seededRng(42)));
  assert.deepEqual(a, b, "the same seed gives the same spins");
  const counts = {}, rng = A.seededRng(7);
  for (let i = 0; i < 20000; i++) { const id = A.drawOutcome(t, rng).id; counts[id] = (counts[id] || 0) + 1; }
  assert.ok(!counts[2] && !counts[5], "no free-spin round is drawn");
  assert.ok(Math.abs(counts[3] / 20000 - 0.4) < 0.02, `id 3 has weight 2 of 5 (got ${counts[3]})`);
  assert.ok(Math.abs(counts[0] / 20000 - 0.2) < 0.02);
  // fixed draws at the edges of the cumulative weights
  assert.equal(A.drawOutcome(t, () => 0).id, 0);
  assert.equal(A.drawOutcome(t, () => 0.999999).id, 4);
  assert.equal(A.drawOutcome(t, () => 0.5).id, 3);
});

test("styles come from the id and stop for their own reasons", () => {
  assert.equal(A.styleOf("rich"), A.styleOf("rich"));
  const styles = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "rich", "poor"].map(A.styleOf));
  assert.equal(styles.size, 3, "all three styles turn up");
  const lose = { total: 1, cum: [1], outcomes: [{ id: 9, weight: 1, pay: 0 }] };
  const win = { total: 1, cum: [1], outcomes: [{ id: 8, weight: 1, pay: 3 }] };
  const levels = [0.1, 0.2, 0.5, 1, 2];
  // cautious: leaves when down 30% or up 50% of the session money
  const c1 = A.playSession({ style: "cautious", bankroll: 10, table: lose, levels });
  assert.equal(c1.stop, "loss limit"); assert.ok(c1.net <= -3 && c1.net > -3.2, String(c1.net));
  const c2 = A.playSession({ style: "cautious", bankroll: 10, table: win, levels });
  assert.equal(c2.stop, "win goal"); assert.ok(c2.net >= 5);
  // chaser: raises after each loss, until the session money is gone
  const ch = A.playSession({ style: "chaser", bankroll: 10, table: lose, levels });
  assert.equal(ch.stop, "out of session money");
  assert.ok(ch.spins[1].bet > ch.spins[0].bet, "the bet goes up after a loss");
  assert.ok(ch.net >= -10, "never more than the bankroll");
  const ch2 = A.playSession({ style: "chaser", bankroll: 10, table: win, levels });
  assert.equal(ch2.stop, "spin limit"); assert.equal(ch2.spins.length, 40);
  assert.ok(ch2.spins.every((s) => s.bet === ch2.baseBet), "a win puts the bet back to the start");
  // steady: one flat bet, a fixed 50 spins
  const st = A.playSession({ style: "steady", bankroll: 10, table: A.loadTable(DIR), rng: A.seededRng(3), levels });
  assert.equal(st.stop, "planned spins done"); assert.equal(st.spins.length, 50);
  assert.ok(st.spins.every((s) => s.bet === st.baseBet));
  const st2 = A.playSession({ style: "steady", bankroll: 1, table: lose, levels });
  assert.equal(st2.stop, "out of session money");
});

test("a session never takes a worker below zero, whatever its style", () => {
  const lose = { open: true, total: 1, cum: [1], outcomes: [{ id: 9, weight: 1, pay: 0 }] };
  for (const id of ["a", "b", "c", "d", "e", "f"]) {
    for (const balance of [0.1, 0.35, 3, 20, 500]) {
      let s;
      try { s = A.playFor({ id }, { table: lose, balance, set: { ...A.casinoSettings(), stakeShare: 1, maxStakePerSession: 1000 } }); }
      catch (err) { assert.match(err.message, /enough credits/); continue; }
      assert.ok(s.balanceAfter >= 0, `${id} at ${balance} ended at ${s.balanceAfter}`);
      assert.ok(s.net >= -s.bankroll);
    }
  }
  fs.rmSync(LOG, { force: true });
  // and the wallet: rich's real balance moves by exactly the session's net
  settings(ON);
  const before = A.wallets()["rich"].balance;
  const s = A.playFor({ id: "rich", room: "game" }, { rng: A.seededRng(5) });
  assert.ok(s.bankroll <= 20 && s.bankroll <= before * 0.1 + 1e-9, "a small, capped slice of the credits");
  assert.equal(Math.round((A.wallets()["rich"].balance - before) * 100) / 100, s.net);
  assert.equal(s.balanceAfter, Math.round((before + s.net) * 100) / 100);
});

test("every spin is logged with its outcome id, then one session line; the pet and the owner never play", () => {
  fs.rmSync(LOG, { force: true });
  settings(ON);
  const played = A.casinoTick({ rng: A.seededRng(11) });
  const who = played.map((p) => p.desk).sort();
  assert.deepEqual(who, ["rich"], "busy has an open job, poor and hr have too little, gone is paused, the pet never plays");
  const all = lines();
  for (const p of played) {
    const spins = all.filter((l) => l.kind === "spin" && l.session === p.session);
    assert.equal(spins.length, p.spins);
    for (const s of spins) {
      assert.equal(s.mode, "base"); assert.equal(s.desk, p.desk); assert.equal(s.style, A.styleOf(p.desk));
      assert.ok([0, 1, 3, 4].includes(s.outcome), "a base-game outcome id");
      assert.equal(s.win, Math.round(s.bet * s.mult * 100) / 100);
      for (const k of ["at", "bet", "mult", "balance"]) assert.ok(k in s, k);
    }
    const sess = all.filter((l) => l.kind === "session" && l.session === p.session);
    assert.equal(sess.length, 1);
    assert.ok(sess[0].stop);
    assert.equal(all.findLastIndex((l) => l.session === p.session), all.indexOf(sess[0]), "the session line comes last");
  }
  assert.throws(() => A.playFor({ id: "pet" }), /don't play/);
  assert.throws(() => A.playFor({ id: S.ownerId() }), /don't play/);
});

test("limits: sessions a day per worker, and nothing in demo mode or with the jobs switched off", () => {
  fs.rmSync(LOG, { force: true });
  settings(ON);
  for (let i = 0; i < 4; i++) A.casinoTick({ rng: A.seededRng(20 + i) });
  const sessions = lines().filter((l) => l.kind === "session");
  assert.equal(sessions.filter((l) => l.desk === "rich").length, 2, "maxSessionsPerDay");
  fs.rmSync(LOG, { force: true });
  process.env.DESKCITY_JOBS_DISABLED = "1";
  assert.deepEqual(A.casinoTick({ rng: A.seededRng(1) }), []);
  delete process.env.DESKCITY_JOBS_DISABLED;
  process.env.HUB_DEMO = "1";
  assert.deepEqual(A.casinoTick({ rng: A.seededRng(1) }), []);
  delete process.env.HUB_DEMO;
  S.resetHubSettings();
});

test("the view: measured return against the table's, styles, stop reasons, last sessions", () => {
  fs.rmSync(LOG, { force: true });
  settings(ON);
  for (let i = 0; i < 6; i++) A.playFor({ id: ["a", "b", "c"][i % 3] }, { rng: A.seededRng(100 + i), balance: 100 });
  const v = A.casinoView();
  const all = lines(), spins = all.filter((l) => l.kind === "spin");
  assert.equal(v.open, true); assert.equal(v.on, true);
  assert.equal(v.table.rtp, 0.9); assert.equal(v.table.baseRounds, 4);
  assert.equal(v.spins, spins.length);
  const bet = spins.reduce((a, s) => a + s.bet, 0), won = spins.reduce((a, s) => a + s.win, 0);
  assert.equal(v.rtp, Math.round((won / bet) * 10000) / 10000);
  assert.equal(v.hitRate, Math.round((spins.filter((s) => s.win > 0).length / spins.length) * 10000) / 10000);
  assert.equal(v.biggestWin.win, Math.max(...spins.map((s) => s.win)));
  assert.ok(v.longestLosingStreak >= 1);
  assert.equal(v.sessions, 6);
  assert.equal(Object.values(v.stops).reduce((a, n) => a + n, 0), 6);
  assert.equal(Object.values(v.styles).reduce((a, s) => a + s.sessions, 0), 6);
  assert.equal(v.last.length, 6);
  assert.match(v.note, /Play credits only/);
  assert.ok(Date.parse(v.last[0].at) >= Date.parse(v.last.at(-1).at), "newest first");
});

test("the route answers the view", async () => {
  const { agentsRouter } = await import(app("src/routes/agents.js"));
  const layer = agentsRouter.stack.find((l) => l.route?.path === "/casino" && l.route.methods.get);
  assert.ok(layer, "GET /casino is mounted on the agents router");
});
