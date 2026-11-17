// Readers that use readJson(file, default) (clean-up C3): with no file they give their old default.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub } from "./helper.mjs";

const { root } = await hub();
const { pullRates, videoStats, tiktokStats } = await import("../../src/pipeline/stats.js");
const { lastBackup } = await import("../../src/pipeline/backup.js");
const { pauseState } = await import("../../src/pipeline/admin.js");
const { errorsClearedAt } = await import("../../src/pipeline/health.js");
const { creatorData } = await import("../../src/pipeline/creators.js");

test("pullRates with no file gives the defaults, as a fresh copy", () => {
  const a = pullRates();
  assert.equal(a.list, 45000);
  assert.equal(a.tabs["tab-overview"], 5000);
  a.list = 1;
  a.tabs["tab-overview"] = 1;
  const b = pullRates();
  assert.equal(b.list, 45000);
  assert.equal(b.tabs["tab-overview"], 5000);
});

test("pullRates merges a saved file over the defaults, and a null file gives the defaults", () => {
  const f = path.join(root, "data", "stats", "pull-rates.json");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ list: 7, tabs: { "tab-content": 9 } }));
  const r = pullRates();
  assert.equal(r.list, 7);
  assert.equal(r.tabs["tab-content"], 9);
  assert.equal(r.tabs["tab-overview"], 5000);
  fs.writeFileSync(f, "null");
  assert.equal(pullRates().list, 45000);
});

test("readers with no file give their default", () => {
  assert.equal(lastBackup(), null);
  assert.deepEqual(pauseState(), { paused: false });
  assert.equal(errorsClearedAt(), null);
  assert.deepEqual(videoStats(), {});
  assert.deepEqual(tiktokStats(), { channels: {} });
  assert.deepEqual(creatorData(), { roster: {}, verified: {} });
});
