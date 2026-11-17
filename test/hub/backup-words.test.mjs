// Admin's backup sentence says only true things (the owner's phone 2026-11-16: it said "No second copy is set up" on a hub
// that copies every backup through the older backup.copies list). Three cases: backup.copies only, backup.copyTo only,
// neither. Temp folders only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hub } from "./helper.mjs";

const { root } = await hub();
const made = [];
const tmp = (n) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `bkwords-${n}-`)); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const settingsFile = path.join(root, "test-settings-words.json");
process.env.HUB_TEST_SETTINGS = settingsFile;
const S = await import("../../src/hub/settings.js");
const B = await import("../../src/pipeline/backup.js");
const { backupWhere } = await import("../../public/parts/backupwords.js");
const when = (iso) => `at ${iso}`;

function setup({ copies, copyTo, primary }) {
  fs.writeFileSync(settingsFile, JSON.stringify({ backup: copyTo ? { copyTo } : {} }));
  S.resetHubSettings();
  fs.writeFileSync(path.join(root, "pipeline.config.json"), JSON.stringify({ backup: { dir: primary, hour: 0, ...(copies ? { copies } : {}) }, jobsDir: "jobs", channels: {} }));
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "todo.json"), JSON.stringify({ items: ["one"] }));
  try { fs.rmSync(path.join(root, "data", "backup.json")); } catch {}
}

test("backup.copies only: the sentence names the extra place and when it last worked", () => {
  const primary = tmp("p"), extra = tmp("x");
  setup({ copies: [extra], primary });
  let r = B.listBackups();
  assert.equal(r.extra.length, 1);
  assert.equal(r.extra[0].ran, false);
  assert.match(backupWhere(r, when), /hasn't run yet/);
  assert.doesNotMatch(backupWhere(r, when), /No second copy/);
  const st = B.runBackup();
  assert.equal(st.copies[0].ok, true);
  r = B.listBackups();
  assert.equal(r.extra[0].from, "copies");
  assert.equal(r.extra[0].ok, true);
  assert.ok(r.extra[0].lastOk);
  const words = backupWhere(r, when);
  assert.ok(words.includes(path.resolve(extra)), words);
  assert.match(words, /last worked at /);
  assert.doesNotMatch(words, /No second copy/);
});

test("an older status line (no time on the copy) counts from the backup's own time", () => {
  const primary = tmp("p"), extra = tmp("x");
  setup({ copies: [extra], primary });
  fs.writeFileSync(path.join(root, "data", "backup.json"), JSON.stringify({ at: "2026-11-16T07:00:00.000Z", ok: true, dir: primary, copies: [{ dir: path.resolve(extra), ok: true }] }));
  const r = B.listBackups();
  assert.equal(r.extra[0].lastOk, "2026-11-16T07:00:00.000Z");
  assert.match(backupWhere(r, when), /last worked at 2026-11-16T07:00:00.000Z/);
});

test("backup.copyTo only: the sentence names it and when it last worked", () => {
  const primary = tmp("p"), second = tmp("s");
  setup({ copyTo: second, primary });
  B.runBackup();
  const r = B.listBackups();
  assert.equal(r.extra.length, 1);
  assert.equal(r.extra[0].from, "copyTo");
  assert.equal(r.extra[0].ok, true);
  const words = backupWhere(r, when);
  assert.ok(words.includes(path.resolve(second)), words);
  assert.match(words, /last worked at /);
});

test("both set: both places are named", () => {
  const primary = tmp("p"), extra = tmp("x"), second = tmp("s");
  setup({ copies: [extra], copyTo: second, primary });
  B.runBackup();
  const words = backupWhere(B.listBackups(), when);
  assert.match(words, /2 places/);
  assert.ok(words.includes(path.resolve(extra)) && words.includes(path.resolve(second)), words);
});

test("neither set: only then does it say no second copy is set up", () => {
  const primary = tmp("p");
  setup({ primary });
  B.runBackup();
  const r = B.listBackups();
  assert.deepEqual(r.extra, []);
  assert.match(backupWhere(r, when), /No second copy is set up/);
});

test("an extra copy that worked and then failed keeps when it last worked", () => {
  const primary = tmp("p"), extra = tmp("x");
  setup({ copies: [extra], primary });
  const first = B.runBackup();
  const okAt = first.copies[0].lastOk;
  assert.ok(okAt);
  fs.rmSync(extra, { recursive: true, force: true });
  fs.writeFileSync(extra, "a file where the folder was"); // the copy can't go there now
  const st = B.runBackup();
  assert.equal(st.copies[0].ok, false);
  assert.equal(st.copies[0].lastOk, okAt);
  const words = backupWhere(B.listBackups(), when);
  assert.match(words, /FAILED/);
  assert.ok(words.includes(`last worked at ${okAt}`), words);
  fs.rmSync(extra, { force: true });
});

test("a failed extra copy says so, and when it last worked", () => {
  const words = backupWhere({ dir: "D:/b", keep: 14, extra: [{ dir: "G:/gone", from: "copies", ran: true, ok: false, error: "ENOENT", lastOk: "2026-11-15T07:00:00Z" }] }, when);
  assert.match(words, /FAILED \(ENOENT\)/);
  assert.match(words, /last worked at 2026-11-15T07:00:00Z/);
});
