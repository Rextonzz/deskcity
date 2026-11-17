// The second backup copy (backup.copyTo) and keeping the newest N (backup.keep): temp folders only.
// A backup is a dated folder (YYYY-MM-DD); only folders with that name are ever pruned, in either place.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hub } from "./helper.mjs";

const { root } = await hub();
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `bkcopy-${n}-`));
const settingsFile = path.join(root, "test-settings.json");
process.env.HUB_TEST_SETTINGS = settingsFile;
const S = await import("../../src/hub/settings.js");
const B = await import("../../src/pipeline/backup.js");

function setup({ copyTo, keep, primary }) {
  fs.writeFileSync(settingsFile, JSON.stringify({ backup: { ...(copyTo !== undefined ? { copyTo } : {}), ...(keep ? { keep } : {}) } }));
  S.resetHubSettings();
  fs.writeFileSync(path.join(root, "pipeline.config.json"), JSON.stringify({ backup: { dir: primary, hour: 0 }, jobsDir: "jobs", channels: {} }));
  fs.writeFileSync(path.join(root, "data", "todo.json"), JSON.stringify({ items: ["one"] }));
}
const names = (d) => fs.readdirSync(d).sort();
const old = (dir, days) => days.forEach((d) => { fs.mkdirSync(path.join(dir, d), { recursive: true }); fs.writeFileSync(path.join(dir, d, "x.txt"), d); });

test("a backup is copied to copyTo, and the status says so", () => {
  const primary = tmp("p1"), second = tmp("s1");
  setup({ copyTo: second, primary });
  const st = B.runBackup({ trigger: "button" });
  assert.equal(st.ok, true);
  assert.equal(st.copyTo.ok, true);
  assert.equal(path.resolve(st.copyTo.dir), path.resolve(second));
  const day = names(primary).find((n) => B.BACKUP_NAME.test(n));
  assert.ok(day);
  assert.deepEqual(names(second), [day]);
  assert.ok(fs.existsSync(path.join(second, day, "data", "todo.json")), "the files arrived");
  assert.ok(st.copyTo.lastOk);
});

test("copyTo unset: no copy and no copyTo line", () => {
  const primary = tmp("p2");
  setup({ primary });
  const st = B.runBackup();
  assert.equal(st.ok, true);
  assert.equal(st.copyTo, undefined);
  assert.equal(B.copyTarget(), null);
});

test("keep: the newest N dated folders stay in both places, other things are never touched", () => {
  const primary = tmp("p3"), second = tmp("s3");
  setup({ copyTo: second, keep: 3, primary });
  const days = ["2020-01-01", "2020-01-02", "2020-01-03", "2020-01-04", "2020-01-05"];
  old(primary, days);
  old(second, days);
  // things that do not match the backup name stay, in both places
  for (const d of [primary, second]) {
    fs.writeFileSync(path.join(d, "notes.txt"), "mine");
    fs.mkdirSync(path.join(d, "before-restore-2020-01-01T00-00-00"));
    fs.mkdirSync(path.join(d, "photos"));
    fs.writeFileSync(path.join(d, "2020-01-01.zip"), "z");
  }
  const st = B.runBackup();
  assert.equal(st.ok, true);
  const today = names(primary).filter((n) => B.BACKUP_NAME.test(n));
  assert.equal(today.length, 3, "primary keeps 3");
  assert.deepEqual(names(second).filter((n) => B.BACKUP_NAME.test(n)), today, "second keeps the same newest 3");
  assert.ok(!today.includes("2020-01-01") && !today.includes("2020-01-02") && !today.includes("2020-01-03"));
  for (const d of [primary, second]) for (const keepName of ["notes.txt", "before-restore-2020-01-01T00-00-00", "photos", "2020-01-01.zip"]) assert.ok(fs.existsSync(path.join(d, keepName)), `${keepName} untouched in ${d}`);
});

test("keep defaults to 14", () => {
  const primary = tmp("p4");
  setup({ primary });
  assert.equal(B.keepCount(), 14);
  const days = Array.from({ length: 16 }, (_, i) => `2019-03-${String(i + 1).padStart(2, "0")}`);
  old(primary, days);
  B.runBackup();
  assert.equal(names(primary).filter((n) => B.BACKUP_NAME.test(n)).length, 14);
});

test("a missing target records a failure, the backup still succeeds, and the alert is once a day", () => {
  const primary = tmp("p5");
  const gone = path.join(tmp("g5"), "no-such-parent", "nightly"); // neither it nor its parent exists
  setup({ copyTo: gone, primary });
  const st = B.runBackup();
  assert.equal(st.ok, true, "the backup itself is fine");
  assert.equal(st.copyTo.ok, false);
  assert.match(st.copyTo.error, /isn't there/);
  assert.ok(fs.existsSync(path.join(primary, names(primary).find((n) => B.BACKUP_NAME.test(n)))), "the primary copy is there");
  const day = st.copyTo.alertedOn;
  assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
  const again = B.runBackup();
  assert.equal(again.copyTo.alertedOn, day, "same day, same single alert mark");
  assert.equal(B.backupSummary().copy.ok, false);
});

test("a target whose parent exists gets the one folder made", () => {
  const primary = tmp("p6"), parent = tmp("g6");
  const target = path.join(parent, "nightly");
  setup({ copyTo: target, primary });
  const st = B.runBackup();
  assert.equal(st.copyTo.ok, true);
  assert.equal(names(target).length, 1);
});

test("pruneBackups does nothing when the listing fails", () => {
  const r = B.pruneBackups(path.join(os.tmpdir(), "bkcopy-does-not-exist-" + Date.now()), 1);
  assert.deepEqual(r.removed, []);
  assert.ok(r.error);
});

test("a test hub never copies outside the temp folder", () => {
  const primary = tmp("p7");
  setup({ copyTo: "G:/Some Real Drive/nightly", primary });
  assert.equal(B.copyTarget(), null);
});
