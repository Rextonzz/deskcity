// The dashboard password on every route that can spend, run a command, write GitHub or redirect alerts (security plan 03).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { hub, app, ROOMS, DESKS } from "./helper.mjs";

const { A } = await hub({
  rooms: ROOMS,
  desks: DESKS,
});
const { agentsRouter } = await import(app("src/routes/agents.js"));
const { pipelineRouter } = await import(app("src/routes/pipeline.js"));
const web = express();
web.use(express.json());
web.use("/a", agentsRouter);
web.use("/p", pipelineRouter);
const srv = web.listen(0, "127.0.0.1");
await new Promise((r) => srv.once("listening", r));
const port = srv.address().port;
test.after(() => srv.close());
// (the helper blocks fetch so tests never reach the network; this is a local request with node:http)
const post = (path, body = {}, headers = {}) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const rq = http.request({ host: "127.0.0.1", port, path, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), Host: "localhost", ...headers } }, (res) => {
    let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => { let b = {}; try { b = JSON.parse(t || "{}"); } catch {} resolve({ status: res.statusCode, body: b }); });
  });
  rq.on("error", reject); rq.end(data);
});
const needs = (r) => { assert.equal(r.status, 403, JSON.stringify(r.body)); assert.equal(r.body.needPassword, true); };

test("with a password set, spending and GitHub routes ask for it", async () => {
  process.env.DASHBOARD_PASSWORD_HASH = "test-hash";
  try {
    const ok = await post("/a/job", { desk: "game-lead", text: "x" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    needs(await post("/a/job", { desk: "game-lead", text: "x", then: ["game-artist"] }));
    needs(await post("/a/job", { desk: "hr", text: "x" }));

    const hire = A.addRequest({ room: "game", role: "Coder", runner: "hub", budgetAsk: 5 }, "game-lead");
    needs(await post(`/a/request/${hire.id}/decide`, { decision: "approved" }));
    const declined = await post(`/a/request/${hire.id}/decide`, { decision: "declined" });
    assert.equal(declined.status, 200, JSON.stringify(declined.body));
    const ask = A.addRequest({ kind: "ask", room: "game", question: "OK?" }, "game-lead");
    const answered = await post(`/a/request/${ask.id}/decide`, { decision: "approved" });
    assert.equal(answered.status, 200, JSON.stringify(answered.body));

    needs(await post("/a/local-run"));
    needs(await post("/a/hookmap", {}));
    needs(await post("/a/quality/apply", {}));
    needs(await post("/a/quality/rollback", {}));
    needs(await post("/a/desk/folder", {}));

    needs(await post("/p/ai/settings", { shadowOn: true }));
    const shadowOff = await post("/p/ai/settings", { shadowOn: false });
    assert.equal(shadowOff.status, 200, JSON.stringify(shadowOff.body));
    needs(await post("/p/notify", { dashboardUrl: "http://evil.example:3000" }));
  } finally { delete process.env.DASHBOARD_PASSWORD_HASH; }
});

test("HR's run button is capped at 6 an hour", async () => {
  let last;
  for (let i = 0; i < 7; i++) last = await post("/a/hr/run");
  assert.equal(last.status, 400);
  assert.match(JSON.stringify(last.body), /6 times/);
});

test("with no password set, this PC still gets through", async () => {
  delete process.env.DASHBOARD_PASSWORD_HASH;
  const r = await post("/a/job", { desk: "game-lead", text: "y", then: ["game-artist"] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const forwarded = await post("/a/job", { desk: "game-lead", text: "z", then: ["game-artist"] }, { "X-Forwarded-For": "8.8.8.8" });
  assert.equal(forwarded.status, 403);
});
