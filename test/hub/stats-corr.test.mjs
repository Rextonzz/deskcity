// public/stats-lib.js corr(): the correlation both stats pages use for their "tends to go with" sentences.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { hub, APP, app } from "./helper.mjs";

await hub();
const { corr } = await import(app("public/stats-lib.js"));
const pts = (ys) => ys.map((y, i) => ({ x: i, y }));

test("corr is 1 for a perfect rise and -1 for a perfect fall", () => {
  assert.ok(Math.abs(corr(pts([1, 2, 3, 4])) - 1) < 1e-9);
  assert.ok(Math.abs(corr(pts([4, 3, 2, 1])) + 1) < 1e-9);
});

test("corr is near 0 when there is no link", () => {
  assert.ok(Math.abs(corr(pts([1, 3, 3, 1]))) < 1e-9);
});

test("corr is null with fewer than 3 points or no spread", () => {
  assert.equal(corr(pts([1, 2])), null);
  assert.equal(corr([]), null);
  assert.equal(corr(pts([5, 5, 5, 5])), null);
  assert.equal(corr([{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }]), null);
});
