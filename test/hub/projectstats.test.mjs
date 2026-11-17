// The Project page's numbers: every figure the page reads is there, with no building-cost figure.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { hub, APP, app } from "./helper.mjs";

await hub();
const { projectStats } = await import(app("src/pipeline/project.js"));

test("projectStats gives the page its numbers and no building-cost figure", () => {
  const s = projectStats();
  for (const k of ["started", "days", "updates", "changes", "byDay", "latest", "code", "todo", "runs", "timeline", "replaced", "replacedMonthly"]) assert.ok(k in s, `missing ${k}`);
  assert.ok(!("cost" in s));
  assert.equal(s.todo.total, 0);
});
