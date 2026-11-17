// Add a project from the campus: each kind of lead, what it refuses, and that nothing existing is replaced.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hub, ROOMS, DESKS } from "./helper.mjs";

const { A, root, data } = await hub({ rooms: ROOMS, desks: DESKS });
const base = fs.mkdtempSync(path.join(os.tmpdir(), "hubproj-"));
const F = path.join(base, "Recipe App");

test("bad input is refused before anything is made", async () => {
  await assert.rejects(A.createProject({}), /name/);
  await assert.rejects(A.createProject({ name: "Bad", lead: "code", folder: path.join(root, "x") }), /inside the hub/);
  await assert.rejects(A.createProject({ name: "Bad2", lead: "code", folder: "relative/path" }), /full path/);
  assert.equal(A.roster().rooms.some((r) => /^bad/.test(r.id)), false);
});
test("a Claude Code project: folder, rules file, folder map, lead and first job", async () => {
  const r = await A.createProject({ name: "Recipe App", about: "A recipe box.", district: "Tools", lead: "code", folder: F, firstJob: "Write the design." });
  assert.equal(r.lead, "recipe-app-lead");
  assert.match(fs.readFileSync(path.join(F, "CLAUDE.md"), "utf8"), /recipe-app-lead[\s\S]*HUB RULE/);
  assert.match(fs.readFileSync(path.join(F, "CLAUDE.md"), "utf8"), /Follow .*'s working rules \(finish the task/);
  assert.doesNotMatch(fs.readFileSync(path.join(F, "CLAUDE.md"), "utf8"), /working-rules\.md|agent-onboarding\.md/); // only docs that ship are cited
  assert.doesNotMatch(fs.readFileSync(path.join(F, "CLAUDE.md"), "utf8"), /5 minutes/);
  const d = A.roster().desks.find((x) => x.id === "recipe-app-lead");
  assert.deepEqual([d.room, d.lead, d.model, d.workFolder], ["recipe-app", true, "claude-code", F]);
  assert.deepEqual(JSON.parse(fs.readFileSync(data("hook-map.json"), "utf8"))[F], { room: "recipe-app", desk: "recipe-app-lead" });
  assert.equal(A.openJobs({ desk: "recipe-app-lead" }).length, 1);
  assert.ok(fs.existsSync(path.join(root, "docs/projects/recipe-app.md")));
});
test("the same name or the same folder can't be used twice", async () => {
  await assert.rejects(A.createProject({ name: "Recipe App", lead: "none" }), /already a project/);
  await assert.rejects(A.createProject({ name: "Other", lead: "code", folder: F }), /already belongs/);
});
test("a hub-run lead goes to HR as a request", async () => {
  const r = await A.createProject({ name: "Trip planner", lead: "hub", firstJob: "Plan a weekend." });
  const q = A.requests().find((x) => x.id === r.request);
  assert.deepEqual([q.role, q.room, q.lead, q.runner, q.firstJob], ["Project lead", "trip-planner", true, "hub", "Plan a weekend."]);
});
test("an existing rules file is kept and only gets the hub section", async () => {
  const old = path.join(base, "Old");
  fs.mkdirSync(old); fs.writeFileSync(path.join(old, "CLAUDE.md"), "# Mine\nkeep me\n");
  await A.createProject({ name: "Old one", lead: "code", folder: old });
  const md = fs.readFileSync(path.join(old, "CLAUDE.md"), "utf8");
  assert.ok(md.startsWith("# Mine\nkeep me\n"));
  assert.match(md, /agent-log\.mjs/);
});
