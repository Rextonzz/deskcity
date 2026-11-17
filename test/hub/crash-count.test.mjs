// Health's "App crashes" counts only real crashes (the owner's phone 2026-11-16: "12 in the last 24 hours" were second
// starts refused while the hub was already running). Restarts and refused second starts are named for what they are.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hub } from "./helper.mjs";

await hub();
const { readCrashLog, crashWords } = await import("../../src/pipeline/health.js");
const T = (m) => `2026-11-16T10:${String(m).padStart(2, "0")}:00.000Z`;

test("a deliberate stop-and-start is a restart, not a crash", () => {
  const log = [
    `${T(1)} pid 100 started: port 3000`,
    `${T(2)} pid 100 exit code 0: `, // the Restart button
    `${T(3)} pid 101 started: port 3000`,
    // pid 101 stopped from outside (window closed, process ended): it writes nothing
    `${T(5)} pid 102 started: port 3000`,
  ].join("\n");
  const c = readCrashLog(log);
  assert.equal(c.crashes.length, 0);
  assert.equal(c.restarts, 3);
  assert.match(crashWords(c), /^None in the last 24 hours \(3 restarts\)/);
});

test("a refused second start is not a crash (new and older wording)", () => {
  const log = [
    `${T(1)} pid 200 refused second start: Error: listen EADDRINUSE: address already in use :::3000`,
    `    at Server.setupListenHandle [as _listen2] (node:net:2390:16)`,
    `${T(1)} pid 200 exit code 1: `,
    `${T(2)} pid 201 could not start: Error: listen EADDRINUSE: address already in use :::3000`,
    `${T(2)} pid 201 exit code 1: `,
    `${T(3)} pid 202 refused second start: Another hub is already using this data folder (process 9, port 3000)`,
  ].join("\n");
  const c = readCrashLog(log);
  assert.equal(c.crashes.length, 0);
  assert.equal(c.refused.length, 3);
  const w = crashWords(c);
  assert.match(w, /3 second starts refused because the hub was already running/);
  assert.match(w, /close it/);
  assert.doesNotMatch(w, /EADDRINUSE|started twice/);
});

test("real crashes count: an uncaught error, a failed start, an unexplained non-zero exit", () => {
  const log = [
    `${T(1)} pid 300 crash: ReferenceError: Cannot access 'finish' before initialization`,
    `${T(1)} pid 300 exit code 1: `,
    `${T(2)} pid 301 could not start: Error: listen EACCES: permission denied`,
    `${T(2)} pid 301 exit code 1: `,
    `${T(3)} pid 302 started: port 3000`,
    `${T(4)} pid 302 exit code 3: `,
    `${T(5)} pid 303 unhandled rejection (kept running): Error: socket hang up`,
  ].join("\n");
  const c = readCrashLog(log);
  assert.equal(c.crashes.length, 3);
  assert.equal(c.kept.length, 1, "an error it survived is not a crash");
  const w = crashWords(c);
  assert.match(w, /^3 in the last 24 hours\. Latest: .*pid 302 stopped unexpectedly \(exit code 3\)/);
  assert.match(w, /1 error it caught and kept running through/);
});

test("only lines after `since` count", () => {
  const log = [`${T(1)} pid 400 crash: old`, `${T(9)} pid 401 started: port 3000`].join("\n");
  const c = readCrashLog(log, T(5));
  assert.equal(c.crashes.length, 0);
  assert.equal(c.restarts, 1);
});
