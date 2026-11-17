// Approving a request on the Agents page: a staff request hires its desk once, other kinds hire nothing.
// (The page used to fill the desk form after Approve as well, so pressing Save desk made a second desk.)
import test from "node:test";
import assert from "node:assert/strict";
import { hub, wait, ROOMS, DESKS } from "./helper.mjs";

const { A, fake } = await hub({ rooms: ROOMS, desks: DESKS });
const deskIds = () => A.roster().desks.map((d) => d.id);

test("approving a staff request adds exactly one desk, and the answer names it", async () => {
  await A.ensureAssistant(); // the shared assistant writes a new hire's first brief in the background
  fake("desk_job", { brief: "Write the music brief first.\nHand drafts to game-lead." });
  const before = deskIds();
  const q = A.addRequest({ room: "game", role: "Sound designer", why: "Music and effects", budgetAsk: 3, suggested: { provider: "claude", model: "claude-haiku-5-5", effort: "low" }, firstJob: "Draft the title jingle brief" }, "game-lead");
  const res = await A.decideRequest(q.id, { decision: "approved", note: "" });
  assert.equal(res.hired.error, undefined);
  assert.equal(res.hired.desk, "game-sound-designer");
  // the hub's own background brief for the new hire finishes; it must update that desk, not add another
  for (let i = 0; i < 40 && !A.roster().desks.find((d) => d.id === res.hired.desk)?.brief?.includes("music brief"); i++) await wait(50);
  const added = deskIds().filter((id) => !before.includes(id));
  assert.deepEqual(added, [res.hired.desk], "one new desk, the one the answer names");
  const d = A.roster().desks.find((x) => x.id === res.hired.desk);
  assert.deepEqual([d.room, d.role, d.status, d.capUsdMonth, d.model], ["game", "Sound designer", "active", 3, "claude-haiku-5-5"]);
  assert.match(d.brief, /music brief/);
  assert.equal(A.openJobs({ desk: d.id }).length, 1, "its first job is waiting");
});

test("approving a store idea hires nobody", async () => {
  const before = deskIds();
  const q = A.addRequest({ kind: "store", room: "game", item: { label: "Standing desk", icon: "🪑", cat: "desk", cost: 12 }, why: "backs hurt" }, "game-artist");
  const res = await A.decideRequest(q.id, { decision: "approved", note: "" });
  assert.equal(res.hired, undefined);
  assert.equal(res.stocked.label, "Standing desk");
  assert.deepEqual(deskIds(), before);
});
