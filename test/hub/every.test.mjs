// every(): the shared background-timer helper (src/pipeline/util.js).
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { hub } from "./helper.mjs";

hub();
const { every } = await import("../../src/pipeline/util.js");
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function setup() {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const warns = [];
  const warn = mock.method(console, "warn", (m) => warns.push(m));
  return { warns, done: () => { warn.mock.restore(); mock.timers.reset(); } };
}

test("every: firstMs run, then the interval", async () => {
  const t = setup();
  try {
    let n = 0;
    every("t-first", () => { n++; }, 1000, { firstMs: 200 });
    mock.timers.tick(199); await flush(); assert.equal(n, 0);
    mock.timers.tick(1); await flush(); assert.equal(n, 1);
    mock.timers.tick(800); await flush(); assert.equal(n, 2);
    mock.timers.tick(1000); await flush(); assert.equal(n, 3);
    every("t-first", () => {}, 1000);
  } finally { t.done(); }
});

test("every: a throwing sync fn and a rejecting async fn are logged and keep running", async () => {
  const t = setup();
  try {
    let a = 0, b = 0;
    every("sync-job", () => { a++; throw new Error("boom"); }, 100);
    every("async-job", async () => { b++; throw new Error("nope"); }, 100);
    mock.timers.tick(100); await flush();
    mock.timers.tick(100); await flush();
    assert.equal(a, 2); assert.equal(b, 2);
    assert.deepEqual(t.warns, ["sync-job: boom", "async-job: nope", "sync-job: boom", "async-job: nope"]);
    every("sync-job", () => {}, 100); every("async-job", () => {}, 100);
  } finally { t.done(); }
});

test("every: a second call with the same label cancels the first", async () => {
  const t = setup();
  try {
    let a = 0, b = 0;
    every("same", () => { a++; }, 100, { firstMs: 50 });
    every("same", () => { b++; }, 100);
    mock.timers.tick(300); await flush();
    assert.equal(a, 0); assert.equal(b, 3);
    every("same", () => {}, 100);
  } finally { t.done(); }
});

test("every: quiet stays silent", async () => {
  const t = setup();
  try {
    every("quiet-job", () => { throw new Error("x"); }, 100, { quiet: true });
    mock.timers.tick(200); await flush();
    assert.deepEqual(t.warns, []);
    every("quiet-job", () => {}, 100);
  } finally { t.done(); }
});
