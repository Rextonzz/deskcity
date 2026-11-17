// The nightly backup and the deal watch start from server.js, not from the YouTube worker.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub, APP } from "./helper.mjs";

const { root } = await hub();
const read = (f) => fs.readFileSync(path.join(APP, f), "utf8");

test("worker.js no longer runs the backup or the deal watch", () => {
  const w = read("src/pipeline/worker.js");
  assert.ok(!/backupTick|dealWatchTick/.test(w));
  assert.ok(/healthTick\(\)/.test(w));
});

test("server.js runs the backup for every hub and the deal watch only with the cards part on", () => {
  const lines = read("server.js").split("\n");
  const backupLine = lines.find((l) => l.includes("m.backupTick()"));
  const dealLine = lines.find((l) => l.includes("m.dealWatchTick()"));
  assert.ok(backupLine && dealLine);
  assert.ok(!/timerOn\(|includes\(/.test(backupLine), "the backup has no part condition");
  assert.ok(!/youtube|Upload worker/.test(backupLine + dealLine), "neither waits for the YouTube part");
  assert.match(dealLine, /timerOn\("Deal watch"\)/); // the Deal watch timer belongs to the cards part (src/hub/modules.js)
});

test("backupTick with a fresh data folder and a past backup hour runs once", async () => {
  fs.writeFileSync(path.join(root, "pipeline.config.json"), JSON.stringify({ backup: { hour: 0 }, channels: {} }));
  const { backupTick, lastBackup } = await import("../../src/pipeline/backup.js");
  assert.equal(lastBackup(), null);
  backupTick();
  const first = lastBackup();
  assert.ok(first?.at, "a backup was recorded");
  backupTick();
  assert.equal(lastBackup().at, first.at, "a second tick the same day does nothing");
});
