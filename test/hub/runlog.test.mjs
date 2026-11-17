import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub, APP } from "./helper.mjs";

const { root } = await hub();
fs.copyFileSync(path.join(APP, "pipeline.config.json"), path.join(root, "pipeline.config.json"));
const { withRun, onceState, readRuns, openRuns } = await import("../../src/pipeline/runlog.js");
const { busyWith } = await import("../../src/pipeline/restart.js");

test("withRun ends the run with its counts and gives back the result", async () => {
  const r = await withRun("t-ok", {}, async () => ({ result: 7, counts: { n: 3 } }));
  assert.equal(r, 7);
  const row = readRuns({ kinds: ["t-ok"] })[0];
  assert.equal(row.ok, true);
  assert.equal(row.n, 3);
});

test("withRun ends the run with the error and rethrows", async () => {
  await assert.rejects(withRun("t-bad", {}, async () => { throw new Error("boom"); }), /boom/);
  const row = readRuns({ kinds: ["t-bad"] })[0];
  assert.equal(row.ok, false);
  assert.equal(row.error, "boom");
});

test("a job that ends its own run is not ended twice", async () => {
  const r = await withRun("t-self", {}, async (log) => ({ result: log.end({ k: 1 }) }));
  assert.equal(r.k, 1);
  assert.equal(readRuns({ kinds: ["t-self"] }).length, 1);
});

test("once: a second call while running joins; the key clears afterwards", async () => {
  let release, calls = 0;
  const gate = new Promise((r) => (release = r));
  const job = () => withRun("t-once", {}, async () => (calls++, await gate, { result: "done" }), { once: "k1" });
  const a = job();
  const b = job();
  assert.equal(a, b);
  assert.equal(onceState("k1").running, true);
  assert.equal(busyWith().includes("t-once"), true);
  release();
  assert.equal(await a, "done");
  assert.equal(calls, 1);
  assert.equal(onceState("k1").running, false);
  const c = job();
  assert.notEqual(c, a);
  await c;
});

test("once keeps the error for the polled state", async () => {
  await assert.rejects(withRun("t-once-bad", {}, async () => { throw new Error("first line\nsecond"); }, { once: "k2" }));
  assert.deepEqual({ running: onceState("k2").running, error: onceState("k2").error }, { running: false, error: "first line" });
  assert.deepEqual(onceState("nope"), { running: false });
});

test("busyWith lists an open run, leaving out the kinds it already names", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const a = withRun("backup", {}, () => gate);
  const b = withRun("quick pull", {}, () => gate);
  assert.ok(busyWith().includes("backup"));
  assert.ok(!busyWith().some((l) => /quick pull/i.test(l)));
  release();
  await Promise.all([a, b]);
  assert.equal(openRuns().length, 0);
  assert.ok(!busyWith().includes("backup"));
});
