// State files written with writeJsonAtomic (C8a): the folder is made, the content parses, no .tmp file is left.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub } from "./helper.mjs";

const { root } = await hub();
const { clearErrors, errorsClearedAt } = await import("../../src/pipeline/health.js");
const { confirmCreator, creatorData } = await import("../../src/pipeline/creators.js");
const { recordStart } = await import("../../src/pipeline/versions.js");

const found = (dir, end) => fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(end));

test("clearErrors writes the cleared-at note whole", () => {
  const { at } = clearErrors();
  assert.equal(errorsClearedAt(), at);
});

test("confirmCreator saves the verified creator and reads it back", () => {
  confirmCreator("vid1", "unknown");
  assert.equal(creatorData().verified.vid1.creator, "unknown");
});

test("recordStart saves the file fingerprint and the start line in a fresh folder", () => {
  const entry = recordStart();
  assert.equal(entry.first, true);
  const [f] = found(path.join(root, "data"), "files.json");
  assert.equal(typeof JSON.parse(fs.readFileSync(path.join(root, "data", f), "utf8")), "object");
  assert.equal(found(path.join(root, "data"), "starts.jsonl").length, 1);
});

test("no temp file is left behind", () => {
  assert.deepEqual(found(path.join(root, "data"), ".tmp"), []);
});
