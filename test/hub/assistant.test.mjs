// The shared assistant: created once, gives HR a second opinion, writes a new hire's first brief.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { hub, wait, ROOMS, DESKS, APP, app } from "./helper.mjs";
import path from "node:path";

const { A, fake, data } = await hub({ rooms: ROOMS, desks: DESKS });
const H = await import(app("src/pipeline/hr.js"));

test("the assistant seat is made once and not again", async () => {
  const d = await A.ensureAssistant();
  assert.equal(d.id, "assistant");
  const seat = A.assistantDesk();
  assert.deepEqual([seat.room, seat.runner, seat.capUsdMonth, seat.status], ["hr", "hub", 5, "active"]);
  assert.equal(await A.ensureAssistant(), null);
});
test("a retired assistant isn't recreated", async () => {
  const r = A.roster(); r.desks.find((d) => d.id === "assistant").status = "retired";
  fs.writeFileSync(data("roster.json"), JSON.stringify(r));
  assert.equal(await A.ensureAssistant(), null);
  assert.equal(A.assistantDesk(), undefined);
  r.desks.find((d) => d.id === "assistant").status = "active"; fs.writeFileSync(data("roster.json"), JSON.stringify(r));
});
test("HR's note carries the assistant's second opinion", async () => {
  fake("hr_review", { verdict: "approve", alignment: "Fits.", provider: "claude", model: "claude-haiku-5-5", effort: "low", capUsdMonth: 3, reuseDesk: "", trial: false, note: "Fine." });
  fake("desk_job", { agree: false, reuseDesk: "game-artist", note: "Someone already does this." });
  const q = A.addRequest({ room: "game", role: "Sound designer", why: "music", budgetAsk: 3 }, "game-lead");
  await H.runHr({ trigger: "test" });
  const got = A.requests().find((x) => x.id === q.id);
  assert.equal(got.hr.verdict, "approve");
  assert.match(got.hr.note, /Assistant \(.+\) disagrees: Someone already does this\. It would reuse game-artist\./);
});
test("a new hire gets a first brief from the assistant", async () => {
  fake("desk_job", { brief: "Do the first job.\nHand results to game-lead." });
  const q = A.addRequest({ room: "game", role: "Tester", why: "bugs pile up", budgetAsk: 2, suggested: { provider: "claude", model: "claude-haiku-5-5" } }, "game-lead");
  const h = await A.hireFromRequest(A.requests().find((x) => x.id === q.id));
  await wait(300);
  const d = A.roster().desks.find((x) => x.id === h.desk);
  assert.match(d.brief, /Do the first job/);
  assert.equal(d.capUsdMonth, 2);
});
