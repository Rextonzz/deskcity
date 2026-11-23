// Deskcity 0.2.0: the agents API lives at /api/agents (canonical); /api/pipeline/agents stays one release as a deprecated
// alias (Deprecation header). Both sit behind the part gate; the token-guarded hook posts at /api/agents/ingest/* are unchanged.
// Same mounting as server.js, on a throwaway express app and port.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express from "express";
import { hub, app } from "./helper.mjs";

const { A } = await hub();
const S = await import(app("src/hub/settings.js"));
const M = await import(app("src/hub/modules.js"));
const R = await import(app("src/routes/agents.js"));
const H = await import(app("src/httpcache.js"));

const web = express();
web.use(express.json());
R.agentIngestRoutes(web);
web.use(H.revalidatePolls);
web.use("/api/pipeline", M.moduleGate);
const gateAgents = (req, res, next) => M.gateRoute({ path: "/agents" + req.path }, res, next);
web.use("/api/agents", gateAgents, R.agentsRouter);
web.use("/api/pipeline/agents", (req, res, next) => {
  res.setHeader("Deprecation", "true");
  res.setHeader("Link", '</api/agents>; rel="successor-version"');
  next();
}, R.agentsRouter);
const srv = web.listen(0, "127.0.0.1");
await new Promise((r) => srv.once("listening", r));
test.after(() => srv.close());
const send = (method, path, headers = {}, body) => new Promise((resolve, reject) => {
  const data = body === undefined ? null : JSON.stringify(body);
  const rq = http.request({ host: "127.0.0.1", port: srv.address().port, path, method, headers: { ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
    let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => { let b = null; try { b = JSON.parse(t); } catch {} resolve({ status: res.statusCode, headers: res.headers, body: b }); });
  });
  rq.on("error", reject); rq.end(data || undefined);
});

test("GET /api/agents answers like /api/pipeline/agents, with no-cache revalidation on both", async () => {
  const a = await send("GET", "/api/agents"), b = await send("GET", "/api/pipeline/agents");
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.deepEqual(Object.keys(a.body).sort(), Object.keys(b.body).sort());
  assert.equal(a.headers["cache-control"], "no-cache");
  assert.equal(b.headers["cache-control"], "no-cache");
  assert.ok(a.headers.etag);
});

test("the old prefix carries Deprecation and Link headers, the new one does not", async () => {
  const old = await send("GET", "/api/pipeline/agents/roster"), canon = await send("GET", "/api/agents/roster");
  assert.equal(old.status, 200); assert.equal(canon.status, 200);
  assert.equal(old.headers.deprecation, "true");
  assert.match(old.headers.link, /<\/api\/agents>; rel="successor-version"/);
  assert.equal(canon.headers.deprecation, undefined);
  assert.equal(canon.headers.link, undefined);
  assert.equal((await send("GET", "/api/pipeline/agents")).headers.deprecation, "true");
});

test("with the Neural view off, trace and web answer 404 switched off on both prefixes; the rest keeps working", async () => {
  const on = [...M.modulesOn()].filter((id) => id !== "neural");
  fs.writeFileSync(path.join(S.settingsRoot(), "data", "hub-settings.json"), JSON.stringify({ modules: on }));
  S.resetHubSettings();
  assert.equal(M.moduleOn("neural"), false);
  for (const p of ["/api/agents/trace", "/api/agents/web", "/api/pipeline/agents/trace", "/api/pipeline/agents/web"]) {
    const r = await send("GET", p);
    assert.equal(r.status, 404, p);
    assert.match(r.body.error, /switched off/, p);
    assert.equal(r.body.module, "neural", p);
  }
  assert.equal((await send("GET", "/api/agents")).status, 200);
  assert.equal((await send("GET", "/api/agents/roster")).status, 200);
});

test("/api/agents/ingest/event still needs the agent token", async () => {
  const body = { desk: "x", source: "claude-code", type: "note", text: "hello" };
  const no = await send("POST", "/api/agents/ingest/event", {}, body);
  assert.equal(no.status, 401);
  const bad = await send("POST", "/api/agents/ingest/event", { Authorization: "Bearer nope" }, body);
  assert.equal(bad.status, 401);
  const ok = await send("POST", "/api/agents/ingest/event", { Authorization: `Bearer ${A.ingestToken()}` }, body);
  assert.notEqual(ok.status, 401);
  assert.ok(ok.status < 500, JSON.stringify(ok.body));
});
