// The staff life cycle (bench, Retirement apartments) is gone: desks it left marked come back at start-up, and HR's
// "reuse" verdict gives the named desk the first job instead of hiring someone new.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { hub, wait, ROOMS, DESKS } from "./helper.mjs";

const worker = { lead: false, provider: "claude", model: "claude-haiku-5-5", runner: "hub" };
const marked = [
  { ...worker, id: "on-bench", room: "game", role: "Sound designer", status: "active", capUsdMonth: 0, capBeforeBench: 3, life: "bench", lifeAt: "2026-11-24T00:00:00.000Z" },
  { ...worker, id: "in-flat", room: "game", role: "Tester", status: "retired", capUsdMonth: 0, capBeforeBench: 2, life: "apartment", lifeAt: "2026-12-30T00:00:00.000Z" },
  { ...worker, id: "by-hand", room: "game", role: "Old helper", status: "retired", capUsdMonth: 1 },
];
const { A, fake, data } = await hub({ rooms: ROOMS, desks: [...DESKS, ...marked] });
const desk = (id) => A.roster().desks.find((d) => d.id === id);

test("start-up sends benched and retired desks back at their old cap, and only those", () => {
  const t0 = new Date().toISOString();
  assert.deepEqual(A.restoreStaff(), ["on-bench", "in-flat"]);
  assert.deepEqual([desk("on-bench").status, desk("on-bench").capUsdMonth], ["active", 3]);
  assert.deepEqual([desk("in-flat").status, desk("in-flat").capUsdMonth], ["active", 2]);
  for (const id of ["on-bench", "in-flat"]) for (const k of ["life", "lifeAt", "capBeforeBench"]) assert.equal(k in desk(id), false, `${id} still has ${k}`);
  assert.deepEqual([desk("by-hand").status, desk("by-hand").capUsdMonth], ["retired", 1]); // retired by hand: left alone
  assert.equal(desk("game-artist").capUsdMonth, 3);
  const last = A.lastWorkAt();
  assert.ok(last["on-bench"] >= t0 && last["in-flat"] >= t0, "each restore is logged as back to work");
});
test("a second start-up changes nothing", () => {
  const before = fs.readFileSync(data("roster.json"), "utf8");
  assert.deepEqual(A.restoreStaff(), []);
  assert.equal(fs.readFileSync(data("roster.json"), "utf8"), before);
});
test("HR's reuse verdict gives the existing desk the first job and hires nobody", async () => {
  const q = A.addRequest({ room: "game", role: "Sound designer", why: "music", budgetAsk: 2, firstJob: "Make a menu jingle." }, "game-lead");
  A.hrRecommend(q.id, { verdict: "reuse", reuseDesk: "on-bench", note: "Already on staff." });
  const n = A.roster().desks.length;
  const done = await A.decideRequest(q.id, { decision: "approved" });
  assert.deepEqual([done.hired.desk, done.hired.reused], ["on-bench", true]);
  assert.equal(A.roster().desks.length, n, "no new desk");
  const jobs = A.openJobs({ desk: "on-bench" });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].text, "Make a menu jingle.");
});
test("a desk retired by hand isn't reused: the request hires as before", async () => {
  fake("desk_job", { brief: "Do the first job." });
  const q = A.addRequest({ room: "game", role: "Old helper", why: "again", budgetAsk: 1, suggested: { provider: "claude", model: "claude-haiku-5-5" } }, "game-lead");
  A.hrRecommend(q.id, { verdict: "reuse", reuseDesk: "by-hand", note: "Retired, though." });
  const n = A.roster().desks.length;
  const done = await A.decideRequest(q.id, { decision: "approved" });
  assert.notEqual(done.hired.desk, "by-hand");
  assert.equal(done.hired.reused, undefined);
  assert.equal(A.roster().desks.length, n + 1);
  await wait(300); // the new hire's first brief is written in the background
  assert.equal(desk("by-hand").status, "retired");
});
