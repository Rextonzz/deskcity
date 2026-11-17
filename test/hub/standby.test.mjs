// The Admin standby switch (setStandby) writes data/standby.json whole and standbyState reads it back.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub } from "./helper.mjs";

const { root } = await hub();
const { setStandby, standbyState } = await import("../../src/pipeline/util.js");

const tmps = () => fs.readdirSync(path.join(root, "data"), { recursive: true }).map(String).filter((f) => f.endsWith(".tmp"));

test("setStandby(true) turns standby on with its reason", () => {
  setStandby(true, "x");
  const s = standbyState();
  assert.equal(s.standby, true);
  assert.equal(s.reason, "x");
  assert.deepEqual(tmps(), []);
});

test("setStandby(false) turns it off and leaves no .tmp", () => {
  setStandby(false);
  assert.equal(standbyState().standby, false);
  assert.deepEqual(tmps(), []);
});
