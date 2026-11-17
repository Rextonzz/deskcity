// newId() and isId() (src/pipeline/util.js) and JOB_ID (src/pipeline/jobs.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { hub } from "./helper.mjs";

hub();
const { newId, isId } = await import("../../src/pipeline/util.js");
const { JOB_ID } = await import("../../src/pipeline/jobs.js");

test("newId: 2n hex characters, default 10", () => {
  assert.match(newId(), /^[a-f0-9]{10}$/);
  assert.equal(newId(4).length, 8);
  assert.equal(newId(6).length, 12);
});

test("isId: ten lower-case hex characters only", () => {
  assert.equal(isId(newId()), true);
  for (const bad of ["abcdef012", "abcdef01234", "ABCDEF0123", "abcdef012g", "", null, undefined, 1234567890, ["abcdef0123"]]) assert.equal(isId(bad), false, String(bad));
});

test("JOB_ID matches the id shape createJob builds and rejects others", () => {
  assert.match("youtube-20261113120000-a1b2", JOB_ID);
  assert.match("tiktok-20261113120000-9z0q", JOB_ID);
  assert.equal(JOB_ID.test("../etc"), false);
  assert.equal(JOB_ID.test(newId()), false);
});
