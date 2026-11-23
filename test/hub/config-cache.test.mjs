// loadPipelineConfig keeps the file's text between calls, but sees an edit, and never shares one object between callers.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub } from "./helper.mjs";

const { root } = await hub();
const file = path.join(root, "pipeline.config.json");
fs.writeFileSync(file, JSON.stringify({ pollSeconds: 5, channels: { a: { name: "A" } } }));
const { loadPipelineConfig, savePipelineConfig } = await import("../../src/pipeline/util.js");

test("a second call gives the same values, as a separate object", () => {
  const one = loadPipelineConfig();
  one.pollSeconds = 99;
  one.channels.a.name = "changed";
  const two = loadPipelineConfig();
  assert.equal(two.pollSeconds, 5);
  assert.equal(two.channels.a.name, "A");
  assert.equal(Object.getPrototypeOf(two.channels), null, "channels still has no prototype");
});

test("an edit to the file is seen on the next call", () => {
  loadPipelineConfig();
  fs.writeFileSync(file, JSON.stringify({ pollSeconds: 7, channels: {} }));
  assert.equal(loadPipelineConfig().pollSeconds, 7);
  fs.writeFileSync(file, JSON.stringify({ pollSeconds: 8, channels: {} })); // same size, a moment later
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);
  assert.equal(loadPipelineConfig().pollSeconds, 8);
});

test("saving is seen at once", () => {
  const c = loadPipelineConfig();
  c.pollSeconds = 11;
  savePipelineConfig(c);
  assert.equal(loadPipelineConfig().pollSeconds, 11);
});
