// The data format (src/hub/migrations.js): a fresh folder is stamped, missing steps run in order after a backup, a failed
// backup stops everything, and data from a newer version makes the app refuse to start. Fake step lists, temp folders only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "./helper.mjs";

const { ensureDataFormat, readFormat, currentFormat, MIGRATIONS } = await import(app("src/hub/migrations.js"));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "migr-"));
const stored = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "format.json"), "utf8")).format;

test("the app's own list is empty today and the format is 1", () => {
  assert.deepEqual(MIGRATIONS, []);
  assert.equal(currentFormat(), 1);
});

test("a fresh folder is stamped with the current format and nothing is migrated or backed up", () => {
  const dir = path.join(tmp(), "data");
  const calls = [];
  const r = ensureDataFormat(dir, { migrations: [{ to: 2, name: "x", run: () => calls.push("run") }], backup: () => (calls.push("backup"), { ok: true }) });
  assert.equal(stored(dir), 2);
  assert.deepEqual(calls, []);
  assert.equal(r.stamped, true);
});

test("a folder that only holds the lock and logs counts as fresh; one with data and no format file is format 1", () => {
  const a = tmp();
  fs.writeFileSync(path.join(a, "hub.lock"), "{}");
  fs.mkdirSync(path.join(a, "logs"));
  assert.equal(readFormat(a).fresh, true);
  const b = tmp();
  fs.writeFileSync(path.join(b, "spend.jsonl"), "");
  const calls = [];
  ensureDataFormat(b, { migrations: [{ to: 2, name: "two", run: () => calls.push("two") }], backup: () => ({ ok: true }) });
  assert.deepEqual(calls, ["two"], "old data without a format file is format 1, so step 2 runs");
  assert.equal(stored(b), 2);
});

test("the same format changes nothing", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "format.json"), '{"format":1}');
  const r = ensureDataFormat(dir, { backup: () => assert.fail("no backup when nothing is to be done") });
  assert.deepEqual(r.ran, []);
  assert.equal(stored(dir), 1);
});

test("missing steps run in order, the backup comes first, and the number is written after each step", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "format.json"), '{"format":1}');
  const calls = [];
  const migrations = [
    { to: 3, name: "three", run: () => { calls.push(`three (file says ${stored(dir)})`); } },
    { to: 2, name: "two", run: () => { calls.push(`two (file says ${stored(dir)})`); } },
    { to: 1, name: "never", run: () => calls.push("one") },
  ];
  const r = ensureDataFormat(dir, { migrations, backup: () => (calls.push("backup"), { ok: true, dir: "B" }) });
  assert.deepEqual(calls, ["backup", "two (file says 1)", "three (file says 2)"]);
  assert.equal(stored(dir), 3);
  assert.deepEqual(r.ran, [2, 3]);
});

test("a failed backup stops before any step runs and says so", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "format.json"), '{"format":1}');
  let ran = false;
  assert.throws(() => ensureDataFormat(dir, { migrations: [{ to: 2, name: "two", run: () => (ran = true) }], backup: () => ({ ok: false, error: "disk full" }) }), /backup taken first failed \(disk full\)\. Nothing was changed/);
  assert.equal(ran, false);
  assert.equal(stored(dir), 1);
  assert.throws(() => ensureDataFormat(dir, { migrations: [{ to: 2, name: "two", run: () => {} }], backup: () => { throw new Error("no folder"); } }), /no folder/);
});

test("a step that fails stops the rest, keeps the last good number and points at the backup", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "format.json"), '{"format":1}');
  const migrations = [{ to: 2, name: "two", run: () => {} }, { to: 3, name: "three", run: () => { throw new Error("boom"); } }, { to: 4, name: "four", run: () => assert.fail("not reached") }];
  assert.throws(() => ensureDataFormat(dir, { migrations, backup: () => ({ ok: true, dir: "C:/b" }) }), /failed at "three" \(format 3\): boom.*stays at format 2.*C:\/b/);
  assert.equal(stored(dir), 2);
});

test("data from a newer version: refuses, naming both numbers and the way out, and changes nothing", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "format.json"), '{"format":5}');
  assert.throws(() => ensureDataFormat(dir, { migrations: [{ to: 2, name: "two", run: () => {} }], backup: () => assert.fail("no backup") }), (err) => {
    assert.match(err.message, /format 5/);
    assert.match(err.message, /understands format 2/);
    assert.match(err.message, /Update to the newer version again, or restore the backup/);
    return true;
  });
  assert.equal(stored(dir), 5);
});

test("an unreadable format file stops the app instead of guessing", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "format.json"), "not json");
  assert.throws(() => ensureDataFormat(dir, {}), /Can't read .*format\.json/);
});
