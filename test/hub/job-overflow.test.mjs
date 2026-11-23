// Overflow: a new job for a busy desk goes to a named helper desk when the setting says so (off until set).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub, app } from "./helper.mjs";

const ROOMS = [{ id: "hub", name: "Hub" }, { id: "hr", name: "HR" }];
const desk = (id, extra = {}) => ({ id, room: "hub", role: id, lead: false, provider: "claude", model: "claude-code", status: "active", ...extra });
const DESKS = [{ id: "hr", room: "hr", role: "HR", lead: true, provider: "claude", model: "claude-code", status: "active" }, desk("builder", { lead: true }), desk("helper"), desk("retired-helper", { status: "retired" })];
const { A, root } = await hub({ rooms: ROOMS, desks: DESKS });
const S = await import(app("src/hub/settings.js"));
const setRules = (rules) => { fs.writeFileSync(path.join(root, "data", "hub-settings.json"), JSON.stringify({ agents: { overflow: rules } })); S.resetHubSettings(); };
const open = (n, d) => Array.from({ length: n }, (_, i) => ({ desk: d, id: `j${i}` }));
const D = DESKS.map((d) => ({ ...d }));

test("overflowTarget: only past the limit, only for matching text, only to an active desk", () => {
  const rule = { from: "builder", to: "helper", when: 2, match: "campus|3d" };
  assert.equal(A.overflowTarget("builder", "fix the campus map", open(2, "builder"), [rule], D), "builder", "at the limit stays");
  assert.equal(A.overflowTarget("builder", "fix the campus map", open(3, "builder"), [rule], D), "helper", "over the limit moves");
  assert.equal(A.overflowTarget("builder", "change the upload step", open(3, "builder"), [rule], D), "builder", "text that doesn't match stays");
  assert.equal(A.overflowTarget("builder", "CAMPUS", open(3, "builder"), [rule], D), "helper", "match ignores case");
  assert.equal(A.overflowTarget("builder", "x", open(3, "builder"), [{ from: "builder", to: "retired-helper" }], D), "builder", "a retired target is ignored");
  assert.equal(A.overflowTarget("builder", "x", open(3, "builder"), [{ from: "builder", to: "builder" }], D), "builder", "never to itself");
  assert.equal(A.overflowTarget("builder", "x", open(3, "builder"), [{ from: "builder", to: "helper", match: "(" }], D), "builder", "a broken regex never moves a job");
  assert.equal(A.overflowTarget("builder", "x", open(3, "builder"), undefined, D), "builder", "no rules: nothing moves");
  assert.equal(A.overflowTarget("builder", "x", open(1, "builder"), [{ from: "builder", to: "helper" }], D), "builder", "default limit is 2");
});

test("addJob: off without the setting, then the fourth open job spills to the helper", async () => {
  setRules(undefined);
  for (let i = 0; i < 4; i++) await A.addJob({ desk: "builder", text: `campus job ${i}` });
  assert.equal(A.openJobs({ desk: "builder" }).length, 4, "no setting: all stay");
  assert.equal(A.openJobs({ desk: "helper" }).length, 0);
  for (const j of A.openJobs({ desk: "builder" })) A.updateJob(j.id, { status: "cancelled", summary: "reset" }, "builder");
  setRules([{ from: "builder", to: "helper", when: 2, match: "campus" }]);
  for (let i = 0; i < 4; i++) await A.addJob({ desk: "builder", text: `campus job ${i}` });
  assert.equal(A.openJobs({ desk: "builder" }).length, 3, "three stay with the builder (more than 2 open sends the next one on)");
  const spilled = A.openJobs({ desk: "helper" });
  assert.equal(spilled.length, 1, "the fourth goes to the helper");
  assert.equal(spilled[0].overflowFrom, "builder", "and says where it came from");
  assert.ok(A.readEvents().some((e) => e.action === "job overflowed" && e.desk === "helper"), "with an event");
  await A.addJob({ desk: "builder", text: "pipeline job" });
  assert.equal(A.openJobs({ desk: "builder" }).length, 4, "text that doesn't match stays");
});
