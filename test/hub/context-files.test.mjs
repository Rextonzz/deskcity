// The start-up "missing reference files" check: it follows each channel's contextFile in pipeline.config.json.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub } from "./helper.mjs";

const { root } = await hub();
const { missingContextFiles } = await import("../../src/pipeline/util.js");
fs.mkdirSync(path.join(root, "References"));
fs.writeFileSync(path.join(root, "References", "here.md"), "rules");

test("a context file that is missing is listed; one that exists is not", () => {
  const cfg = { channels: { a: { contextFile: "./References/here.md" }, b: { contextFile: "./References/gone.md" } } };
  assert.deepEqual(missingContextFiles(cfg), ["./References/gone.md"]);
});
test("a channel with no contextFile, or no channels at all (a kit install), warns about nothing", () => {
  assert.deepEqual(missingContextFiles({ channels: { a: {} } }), []);
  assert.deepEqual(missingContextFiles({ channels: {} }), []);
  assert.deepEqual(missingContextFiles({}), []);
});
test("with no argument it reads this hub's pipeline.config.json", () => {
  fs.writeFileSync(path.join(root, "pipeline.config.json"), JSON.stringify({ channels: { a: { contextFile: "./References/here.md" }, b: { contextFile: "./References/gone.md" } } }));
  assert.deepEqual(missingContextFiles(), ["./References/gone.md"]);
});
