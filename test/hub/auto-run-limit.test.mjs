// A worker's answer starts a paid worker only within the owner's daily auto-run limit (security plan 04).
import test from "node:test";
import assert from "node:assert/strict";
import { hub, ROOMS, DESKS } from "./helper.mjs";

process.env.HUB_AUTORUN_PER_DAY = "0"; // settings files are read from the real repo, so pin the limit here
const today = new Date().toISOString();
const desks = DESKS.map((d) => (d.id === "game-lead" ? { ...d, runner: "hub", capUsdMonth: 5, model: "claude-haiku-5-5" } : d)); // a priced model: the hub runs no unpriced model (money safety B1)
const { A, fake } = await hub({ rooms: ROOMS, desks, seed: { "autorun.jsonl": `${JSON.stringify({ at: today, job: "a", desk: "x" })}\n${JSON.stringify({ at: today, job: "b", desk: "x" })}\n` } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hubDesk = desks.find((d) => d.id === "game-artist");
const answer = (extra = {}) => ({ output: "ok", summary: "done", followups: [], handoff_to: "", handoff_task: "", questions_for_owner: [], assign: [], ...extra });

test("mayAutoRun: the limit, local desks, PC desks, and today's count", () => {
  const now = new Date();
  assert.equal(A.mayAutoRun(hubDesk, now, 0), false);
  assert.equal(A.mayAutoRun(hubDesk, now, null), true);
  assert.equal(A.mayAutoRun({ ...hubDesk, provider: "local" }, now, 0), true);
  assert.equal(A.mayAutoRun({ id: "pc", provider: "claude" }, now, null), false);
  assert.equal(A.autoRunsToday(now), 2);
  assert.equal(A.mayAutoRun(hubDesk, now, 2), false);
  assert.equal(A.mayAutoRun(hubDesk, now, 3), true);
});

test("with the limit at 0, a lead's assign is recorded as the lead's and waits", async () => {
  fake("desk_job", answer({ assign: [{ desk: "game-artist", task: "draw" }] }));
  const lead = await A.addJob({ desk: "game-lead", text: "Plan the art" });
  await A.runJob(lead.id);
  await wait(200);
  const made = A.jobs().find((j) => j.desk === "game-artist" && /draw/.test(j.text));
  assert.ok(made, "the assigned job exists");
  assert.equal(made.by, "game-lead");
  assert.equal(A.jobs().find((j) => j.id === made.id).status, "queued");
  assert.ok(A.deskLive("game-artist").steps.some((s) => s.action === "waiting to run"), "a 'waiting to run' event was recorded");
});

test("with the limit at 0, an automatic hand-off waits too", async () => {
  fake("desk_job", answer({ handoff_to: "game-artist", handoff_task: "x" }));
  const lead = await A.addJob({ desk: "game-lead", text: "Hand it on" });
  await A.runJob(lead.id);
  await wait(200);
  const next = A.jobs().find((j) => j.desk === "game-artist" && j.prev === lead.id);
  assert.ok(next, "the hand-off job exists");
  assert.equal(next.status, "queued");
});

test("a chain the owner set still runs, and uses none of the limit", async () => {
  fake("desk_job", answer());
  const before = A.autoRunsToday();
  const a = await A.addJob({ desk: "game-lead", text: "Step one", then: ["game-artist"] });
  await A.runJob(a.id);
  let b;
  for (let i = 0; i < 60; i++) { b = A.jobs().find((j) => j.desk === "game-artist" && j.prev === a.id); if (b?.status === "done") break; await wait(50); }
  assert.equal(b?.status, "done");
  assert.equal(A.autoRunsToday(), before);
});
