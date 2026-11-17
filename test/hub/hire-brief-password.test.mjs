// Approving an unpaid hire still runs one AI call, the assistant's first brief. With a dashboard password set, the
// decide route asks for it when that approval would call a model; with the AI helpers off no model is called at all.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express from "express";
import { hub, wait, app, ROOMS, DESKS } from "./helper.mjs";

process.env.HUB_HELPERS = "off";
process.env.HUB_HELPERS_PER_DAY = "none";
const assistant = { id: "assistant", room: "hr", role: "Assistant: small errands", provider: "claude", model: "claude-haiku-5-5", effort: "low", capUsdMonth: 5, status: "active", runner: "hub" };
const { A, root, fake } = await hub({ rooms: ROOMS, desks: [...DESKS, assistant] });
const { agentsRouter } = await import(app("src/routes/agents.js"));
const web = express();
web.use(express.json());
web.use("/a", agentsRouter);
const srv = web.listen(0, "127.0.0.1");
await new Promise((r) => srv.once("listening", r));
test.after(() => srv.close());
const post = (p, body = {}) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const rq = http.request({ host: "127.0.0.1", port: srv.address().port, path: p, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), Host: "localhost" } }, (res) => {
    let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => { let b = {}; try { b = JSON.parse(t || "{}"); } catch {} resolve({ status: res.statusCode, body: b }); });
  });
  rq.on("error", reject); rq.end(data);
});
const asked = () => fs.readdirSync(path.join(root, "fake")).filter((f) => f.endsWith(".asked.txt"));
const unpaid = (role) => A.addRequest({ room: "game", role, why: "plain reason it was hired", suggested: { provider: "other" } }, "game-lead");

test("AI helpers off, password set: an unpaid hire is approved without the password, no model is called, the plain brief stays", async () => {
  process.env.DASHBOARD_PASSWORD_HASH = "test-hash";
  try {
    fake("desk_job", { brief: "MODEL BRIEF" });
    const q = unpaid("Tester one");
    const r = await post(`/a/request/${q.id}/decide`, { decision: "approved" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await wait(300);
    assert.equal(asked().length, 0, "no model call was made");
    const d = A.roster().desks.find((x) => x.id === r.body.hired.desk);
    assert.equal(d.brief, "plain reason it was hired");
  } finally { delete process.env.DASHBOARD_PASSWORD_HASH; }
});

test("AI helpers on, password set: approving the same hire asks for the password first, and the brief is written once given", async () => {
  process.env.HUB_HELPERS = "on";
  process.env.DASHBOARD_PASSWORD_HASH = "test-hash";
  try {
    const q = unpaid("Tester two");
    const r = await post(`/a/request/${q.id}/decide`, { decision: "approved" });
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.needPassword, true);
    assert.equal(asked().length, 0, "nothing was called before the password");
    assert.ok(A.requests().find((x) => x.id === q.id).decision == null, "still open");
    const declined = await post(`/a/request/${q.id}/decide`, { decision: "declined" });
    assert.equal(declined.status, 200, "declining never needs it");
  } finally { delete process.env.DASHBOARD_PASSWORD_HASH; }
  // no password set on this hub: this PC gets through and the model writes the brief
  fake("desk_job", { brief: "MODEL BRIEF" });
  const q2 = unpaid("Tester three");
  const ok = await post(`/a/request/${q2.id}/decide`, { decision: "approved" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  await wait(400);
  assert.equal(A.roster().desks.find((x) => x.id === ok.body.hired.desk).brief, "MODEL BRIEF");
});
