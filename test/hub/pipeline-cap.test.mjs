// The optional monthly cap on the pipeline's own AI spend (settings' pipeline.capUsdMonth, src/hub/pipelinecap.js).
// Stand-in AI answers only; nothing reaches a provider or the network.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { hub, app, ROOMS, DESKS } from "./helper.mjs";

const { fake } = await hub({ rooms: ROOMS, desks: DESKS });
const CAP = await import(app("src/hub/pipelinecap.js"));
const CLAUDE = await import(app("src/pipeline/claude.js"));
const SPEND = await import(app("src/pipeline/spend.js"));
const UTIL = await import(app("src/pipeline/util.js"));
const { pipelineRouter } = await import(app("src/routes/pipeline.js"));

const web = express();
web.use(express.json());
web.use("/p", pipelineRouter);
const srv = web.listen(0, "127.0.0.1");
await new Promise((r) => srv.once("listening", r));
test.after(() => srv.close());
const call = (method, path, body = {}) => new Promise((resolve, reject) => {
  const data = method === "GET" ? "" : JSON.stringify(body);
  const rq = http.request({ host: "127.0.0.1", port: srv.address().port, path, method, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), Host: "localhost" } }, (res) => {
    let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => { let b = {}; try { b = JSON.parse(t || "{}"); } catch {} resolve({ status: res.statusCode, body: b }); });
  });
  rq.on("error", reject); rq.end(data);
});
const book = (step, costUsd) => SPEND.appendSpend({ kind: "ai call", step, provider: "claude", model: "claude-haiku-5-5", costUsd, startedAt: new Date().toISOString() });
const ask = (name) => CLAUDE.askJSON({ name, system: "s", content: "c", schema: CLAUDE.obj({ ok: CLAUDE.bool }) });

test("no cap by default: the pipeline's calls are never stopped", async () => {
  assert.equal(CAP.pipelineCapUsd(), null);
  book("lookup", 50);
  fake("lookup", { ok: true });
  assert.deepEqual(await ask("lookup"), { ok: true });
  assert.equal(CAP.pipelineCapStatus().used, false);
});

test("setting a cap lower than none needs no password; the pipeline stops as a Hold once the month's spend reaches it", async () => {
  assert.equal(CAP.savePipelineCap({ capUsdMonth: 100 }, false).status, 200, "none -> a number is a limit, not a raise");
  assert.equal(CAP.pipelineCapUsd(), 100);
  assert.ok(CAP.pipelineSpendMonth() >= 50);
  assert.deepEqual(await ask("lookup"), { ok: true }, "$50 of $100: still runs");
  book("lookup", 60); // $110 of $100
  await assert.rejects(ask("lookup"), (err) => {
    assert.ok(err instanceof UTIL.Hold, "a Hold: the worker shows the job as held, not failed");
    assert.equal(err.pipelineBudget, true);
    assert.match(err.message, /pipeline AI budget for this month is used up/i);
    return true;
  });
  assert.equal(CAP.pipelineCapStatus().used, true);
});

test("HR's reviews and hub-run desk jobs have their own caps and are not stopped by the pipeline's", async () => {
  fake("hr_review", { ok: true });
  assert.deepEqual(await ask("hr_review"), { ok: true });
  assert.equal(SPEND.deskOfCall("hr_review"), "hr");
  assert.doesNotThrow(() => CAP.assertPipelineBudget("desk_game-lead"));
  assert.throws(() => CAP.assertPipelineBudget("campus_chatter"), /used up/, "the other hub-wide calls are the pipeline's too");
});

test("raising the cap, or removing it, needs the password; lowering it does not", async () => {
  assert.equal(CAP.savePipelineCap({ capUsdMonth: 500 }, false).status, 403);
  assert.equal(CAP.savePipelineCap({ capUsdMonth: null }, false).status, 403);
  assert.equal(CAP.pipelineCapUsd(), 100, "refused: unchanged");
  assert.equal(CAP.savePipelineCap({ capUsdMonth: 80 }, false).status, 200);
  assert.equal(CAP.savePipelineCap({ capUsdMonth: "abc" }, true).status, 400);
  assert.equal(CAP.savePipelineCap({ capUsdMonth: 500 }, true).status, 200);
  assert.deepEqual(await ask("lookup"), { ok: true }, "$110 of $500: running again");
  assert.equal(CAP.savePipelineCap({ capUsdMonth: null }, true).status, 200);
  assert.equal(CAP.pipelineCapUsd(), null);
});

test("the Admin route: a raise with a password set asks for it, a lower one does not", async () => {
  process.env.DASHBOARD_PASSWORD_HASH = "test-hash";
  try {
    assert.equal((await call("POST", "/p/admin/pipeline-cap", { capUsdMonth: 200 })).status, 200, "none -> a number");
    const raise = await call("POST", "/p/admin/pipeline-cap", { capUsdMonth: 300 });
    assert.equal(raise.status, 403);
    assert.equal(raise.body.needPassword, true);
    assert.equal((await call("POST", "/p/admin/pipeline-cap", { capUsdMonth: 150 })).status, 200);
    const g = await call("GET", "/p/admin/pipeline-cap");
    assert.equal(g.body.capUsdMonth, 150);
    assert.equal(typeof g.body.spentMonth, "number");
  } finally { delete process.env.DASHBOARD_PASSWORD_HASH; }
});
