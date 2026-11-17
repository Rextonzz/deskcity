// public/lib.js watchJob(): the one start-and-poll loop the scan, pull and creator-check buttons share.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { hub, APP, app } from "./helper.mjs";

await hub();
const { watchJob } = await import(app("public/lib.js"));

// Lets the fake clock run one round and the awaited poll settle.
const round = async (ms) => {
  mock.timers.tick(ms);
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

test("polls every everyMs, shows each answer and runs done once when running turns false", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const answers = [{ running: true, n: 1 }, { running: true, n: 2 }, { running: false, n: 3 }];
    const shown = [], finished = [];
    const watch = watchJob({ poll: async () => answers.shift(), render: (s) => shown.push(s.n), done: (s) => finished.push(s.n), everyMs: 3000 });
    watch();
    watch(); // already watching: no second loop
    await round(2999);
    assert.deepEqual(shown, []);
    await round(1);
    await round(3000);
    await round(3000);
    await round(30000); // nothing more after it finished
    assert.deepEqual(shown, [1, 2, 3]);
    assert.deepEqual(finished, [3]);
    assert.equal(answers.length, 0);
  } finally {
    mock.timers.reset();
  }
});

test("a failed poll is skipped and tried again next round; a later watch() after the end starts a new loop", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const calls = [];
    let step = 0;
    const watch = watchJob({
      poll: async () => {
        calls.push(++step);
        if (step === 1) throw new Error("dropped");
        if (step === 2) return null;
        return { running: false };
      },
      done: () => calls.push("done"),
      everyMs: 1000,
    });
    watch();
    await round(1000);
    await round(1000);
    await round(1000);
    assert.deepEqual(calls, [1, 2, 3, "done"]);
    watch();
    await round(1000);
    assert.deepEqual(calls, [1, 2, 3, "done", 4, "done"]);
  } finally {
    mock.timers.reset();
  }
});

test("lost(err) is called when a poll throws and lost(null) when it answers again; polling goes on and done still runs", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const calls = [];
    let step = 0;
    const watch = watchJob({
      poll: async () => {
        step++;
        if (step === 1) throw new Error("dropped");
        return step === 2 ? { running: true } : { running: false };
      },
      lost: (err) => calls.push(err ? err.message : null),
      done: () => calls.push("done"),
      everyMs: 1000,
    });
    watch();
    await round(1000);
    assert.deepEqual(calls, ["dropped"]);
    await round(1000);
    assert.deepEqual(calls, ["dropped", null]);
    await round(1000);
    assert.deepEqual(calls, ["dropped", null, "done"]);
  } finally {
    mock.timers.reset();
  }
});

test("a watch with no lost behaves as before when a poll throws", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let step = 0;
    const finished = [];
    watchJob({ poll: async () => { if (++step === 1) throw new Error("x"); return { running: false }; }, done: () => finished.push(1), everyMs: 500 })();
    await round(500);
    await round(500);
    assert.deepEqual(finished, [1]);
  } finally {
    mock.timers.reset();
  }
});
