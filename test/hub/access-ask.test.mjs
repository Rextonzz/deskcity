// Ask once: a job that fails because its worker lacked access turns into one yes/no ask to the owner, never two.
import test from "node:test";
import assert from "node:assert/strict";
import { hub, ROOMS, DESKS } from "./helper.mjs";

const { A } = await hub({ rooms: ROOMS, desks: DESKS });
const BLOCKED = "No numbers yet: data/ is blocked for my session and the hub API needs a sign-in";
const accessAsks = () => A.requests().filter((r) => r.kind === "ask" && r.access);

test("accessBlocked: access failures give a short reason, ordinary ones give null", () => {
  assert.equal(A.accessBlocked(BLOCKED), "blocked for its session");
  assert.equal(A.accessBlocked("git push: Permission denied (publickey)"), "permission denied");
  assert.equal(A.accessBlocked("Access denied to the drive"), "access denied");
  assert.equal(A.accessBlocked("The API needs a sign-in"), "needs a sign-in");
  assert.equal(A.accessBlocked("Bash: rm is not allowed here"), null, "a hook refusal is not an access failure");
  assert.equal(A.accessBlocked("tests failed"), null);
  assert.equal(A.accessBlocked("No Gemini key: add GEMINI_API_KEY to the hub's .env"), null);
  assert.equal(A.accessBlocked(""), null);
  assert.equal(A.accessBlocked(null), null);
});

test("an access failure files exactly one ask, with the job id in it", async () => {
  const j = await A.addJob({ desk: "game-lead", text: "count the numbers" });
  const out = A.updateJob(j.id, { status: "failed", summary: BLOCKED }, "game-lead");
  assert.equal(out.access, "blocked for its session", "the reason is on the job's line");
  assert.equal(A.findJob(j.id).access, "blocked for its session", "and on the job record");
  const asks = accessAsks().filter((r) => r.job === j.id);
  assert.equal(asks.length, 1, "one ask");
  assert.equal(asks[0].from, "game-lead");
  assert.equal(asks[0].room, "game");
  assert.ok(asks[0].role.includes(j.id), "the question names the job");
  assert.match(asks[0].role, /Grant the access and retry\? 1\. Yes 2\. No/);
  assert.throws(() => A.updateJob(j.id, { status: "failed", summary: BLOCKED }, "game-lead"), /already failed/, "a failed job can't fail again");
  assert.equal(accessAsks().filter((r) => r.job === j.id).length, 1, "still one ask");
});

test("a second job on the same desk with the same reason doesn't file another while the first is open", async () => {
  const before = accessAsks().length;
  const j = await A.addJob({ desk: "game-lead", text: "count them again" });
  A.updateJob(j.id, { status: "failed", summary: "data/ is blocked for my session" }, "game-lead");
  assert.equal(accessAsks().length, before, "no new ask");
  assert.equal(A.findJob(j.id).access, "blocked for its session", "the job still says why");
  const k = await A.addJob({ desk: "game-lead", text: "push it" });
  A.updateJob(k.id, { status: "failed", summary: "git push: permission denied" }, "game-lead");
  assert.equal(accessAsks().length, before + 1, "a different reason is its own ask");
});

test("an ordinary failure files no ask", async () => {
  const before = A.requests().length;
  const j = await A.addJob({ desk: "game-lead", text: "draw a cat" });
  A.updateJob(j.id, { status: "failed", summary: "tests failed" }, "game-lead");
  assert.equal(A.requests().length, before);
  assert.equal(A.findJob(j.id).access, undefined);
});
