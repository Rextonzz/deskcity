// Feedback logs still get one JSON line per entry in a fresh folder (they use appendJsonl, C6).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { hub } from "./helper.mjs";

hub();
const { resolvePath } = await import("../../src/pipeline/util.js");
const { rate } = await import("../../src/pipeline/ratings.js");
const { recordHoldOutcome } = await import("../../src/pipeline/corrections.js");
const lines = (rel) => fs.readFileSync(resolvePath(rel), "utf8").split("\n");

test("rate() appends one line and makes the folder", () => {
  const e = rate({ channel: "c", area: "rules", item: "x", vote: "up" });
  const l = lines("data/feedback/ratings.jsonl");
  assert.equal(l.at(-1), "");
  assert.deepEqual(JSON.parse(l.at(-2)), e);
});

test("recordHoldOutcome appends one line with the fields it had", () => {
  recordHoldOutcome({ id: "j1", channel: "c", stage: "s", hold: { reason: "why" } }, true, { answers: { a: "b" } });
  const row = JSON.parse(lines("data/feedback/holds.jsonl")[0]);
  assert.equal(row.job, "j1");
  assert.equal(row.changed, true);
  assert.deepEqual(row.answers, { a: "b" });
});
