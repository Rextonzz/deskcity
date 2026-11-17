// One hub per data folder (src/hub/datalock.js): a lock file with the pid and start time; a second hub refuses to start
// while the first is running, takes over a lock whose process is gone, and the lock goes on a clean release.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { app } from "./helper.mjs";

const { acquireDataLock, pidAlive } = await import(app("src/hub/datalock.js"));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "hublock-"));

test("the first hub writes data/hub.lock with its pid, start time and port; a clean release removes it", () => {
  const dir = tmp();
  const lock = acquireDataLock(dir, { pid: process.pid, port: 3995, now: () => "2026-11-16T10:00:00.000Z" });
  const held = JSON.parse(fs.readFileSync(path.join(dir, "hub.lock"), "utf8"));
  assert.deepEqual(held, { pid: process.pid, startedAt: "2026-11-16T10:00:00.000Z", port: 3995 });
  lock.release();
  assert.equal(fs.existsSync(path.join(dir, "hub.lock")), false);
});

test("a second hub on the same folder refuses while the first process is alive, with a clear message", () => {
  const dir = tmp();
  const first = acquireDataLock(dir, { pid: 111111, port: 3000, alive: () => true });
  assert.throws(() => acquireDataLock(dir, { pid: 222222, port: 3001, alive: (p) => p === 111111 }), (err) => {
    assert.match(err.message, /Another hub is already using this data folder/);
    assert.match(err.message, /process 111111, port 3000/);
    assert.match(err.message, /hub\.lock/);
    return true;
  });
  assert.equal(JSON.parse(fs.readFileSync(first.file, "utf8")).pid, 111111, "the first hub's lock is untouched");
});

test("a lock whose process is dead is taken over; a lock of this same process is not a clash; a broken file is replaced", () => {
  const dir = tmp();
  acquireDataLock(dir, { pid: 111111, alive: () => true });
  const second = acquireDataLock(dir, { pid: 222222, port: 3001, alive: () => false });
  assert.equal(JSON.parse(fs.readFileSync(second.file, "utf8")).pid, 222222);
  assert.doesNotThrow(() => acquireDataLock(dir, { pid: 222222, alive: () => true }));
  fs.writeFileSync(path.join(dir, "hub.lock"), "not json");
  assert.doesNotThrow(() => acquireDataLock(dir, { pid: 333333, alive: () => true }));
  // a hub never removes a lock that another hub took over
  const mine = acquireDataLock(tmp(), { pid: 444444 });
  fs.writeFileSync(mine.file, JSON.stringify({ pid: 555555 }));
  mine.release();
  assert.equal(fs.existsSync(mine.file), true);
});

test("pidAlive: this process is alive; a process that has ended is not", async () => {
  assert.equal(pidAlive(process.pid), true);
  assert.equal(pidAlive(0), false);
  assert.equal(pidAlive(NaN), false);
  const child = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
  await new Promise((r) => child.on("exit", r));
  assert.equal(pidAlive(child.pid), false);
});

test("a lock whose process id is in use but which has not been touched for two minutes is stale: the hub takes it over", () => {
  // after a reboot or a killed hub, the old process id is often handed to another program
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hublock-stale-"));
  const first = acquireDataLock(dir, { pid: 222222, port: 3000, alive: () => true });
  const old = new Date(Date.now() - 5 * 60000);
  fs.utimesSync(first.file, old, old);
  const second = acquireDataLock(dir, { pid: 333333, port: 3000, alive: () => true });
  assert.equal(JSON.parse(fs.readFileSync(second.file, "utf8")).pid, 333333);
  second.release(); first.release();
  fs.rmSync(dir, { recursive: true, force: true });
});
