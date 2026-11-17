// public/runlog.js (the run log panel): how long a run took. An AI call row is written after the call, so its ms is 0
// and the call's own time is aiMs; the panel shows that, with one decimal under 10 s (trailer v7 review: "0s" per call).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { hub, app } from "./helper.mjs";

await hub();
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL(app("public/timing.js")), "utf8"), ctx);
ctx.timing = ctx.window.timing;
vm.runInContext(fs.readFileSync(new URL(app("public/runlog.js")), "utf8"), ctx);
const { took, dur } = ctx.window.runLog;

test("an AI call shows its own time (aiMs), not the row's 0", () => {
  assert.equal(took({ kind: "ai call", ms: 0, aiMs: 2473 }), 2473);
  assert.equal(dur(took({ kind: "ai call", ms: 0, aiMs: 2473 })), "2.5s");
  assert.equal(took({ kind: "deal scan", ms: 61000, aiMs: 500 }), 61000); // a run's own time wins when it has one
  assert.equal(took({ kind: "ai call", ms: 0 }), 0); // nothing better known
});

test("durations: one decimal under 10 s, the usual text above", () => {
  assert.equal(dur(300), "0.3s");
  assert.equal(dur(4178), "4.2s");
  assert.equal(dur(0), "0.0s");
  assert.equal(dur(12000), "12s");
  assert.equal(dur(125000), "2:05");
  assert.equal(dur(null), "");
});
