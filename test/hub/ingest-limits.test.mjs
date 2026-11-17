// Agent posts: per-route caps, smaller bodies, hub-only votes, clipped costs, and the key staying off plain http (security plan 07).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { pathToFileURL } from "node:url";
import path from "node:path";
import express from "express";
import { hub, app, APP, ROOMS, DESKS } from "./helper.mjs";

// game-artist gets a $10 cap here so these posts stay under the daily ceiling on reported cost (3x the cap, money safety S1)
const { A } = await hub({ rooms: ROOMS, desks: DESKS.map((d) => (d.id === "game-artist" ? { ...d, capUsdMonth: 10 } : d)) });
const { agentIngestRoutes } = await import(app("src/routes/agents.js"));
const web = express();
web.use(express.json({ limit: "2mb" }));
agentIngestRoutes(web);
const srv = web.listen(0, "127.0.0.1");
await new Promise((r) => srv.once("listening", r));
test.after(() => srv.close());
const key = A.ingestToken();
const post = (route, body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const rq = http.request({ host: "127.0.0.1", port: srv.address().port, path: `/api/agents/ingest/${route}`, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), Authorization: `Bearer ${key}` } }, (res) => {
    let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => { let b = {}; try { b = JSON.parse(t || "{}"); } catch {} resolve({ status: res.statusCode, body: b }); });
  });
  rq.on("error", reject); rq.end(data);
});

test("the 11th request post in a minute is refused", async () => {
  let last;
  for (let i = 0; i < 11; i++) last = await post("request", { room: "game", role: `Helper ${i}`, why: "x" }).catch((e) => ({ status: 0, body: { error: String(e) } }));
  assert.equal(last.status, 429, JSON.stringify(last.body));
});

test("an event over 64 KB is refused", async () => {
  const r = await post("event", { desk: "game-artist", action: "note", summary: "x".repeat(70 * 1024) });
  assert.equal(r.status, 413);
});

test("a vote can't be cast as HR or the finance desk", async () => {
  const r = await post("vote", { request: "0123456789", desk: "hr", vote: "yes" });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.error, /votes inside the hub/);
});

test("a posted cost counts, but at most $5 a post; the hub's own sources aren't clipped", async () => {
  const big = await post("event", { desk: "game-artist", action: "note", summary: "big", costUsd: 500, billing: "api" });
  assert.equal(big.status, 200, JSON.stringify(big.body));
  const small = await post("event", { desk: "game-artist", action: "note", summary: "small", costUsd: 0.4, billing: "api" });
  assert.equal(small.status, 200);
  const spoof = await post("event", { desk: "game-artist", action: "note", summary: "spoof", costUsd: 400, billing: "api", source: "hub" });
  assert.equal(spoof.status, 200);
  const ev = (s) => A.readEvents().find((e) => e.summary === s);
  assert.equal(ev("big").costUsd, 5); assert.equal(ev("big").costClipped, true);
  assert.equal(ev("small").costUsd, 0.4); assert.equal(ev("small").costClipped, undefined);
  assert.equal(ev("spoof").costUsd, 5, "a post can't claim the hub's own source");
  A.recordEvent({ desk: "game-artist", action: "note", summary: "own", costUsd: 40, billing: "api" }, "hub");
  assert.equal(ev("own").costUsd, 40);
});

test("hub-env refuses plain http to another machine, and allows this PC and Tailscale", () => {
  const url = pathToFileURL(path.join(APP, "tools", "hub-env.mjs")).href;
  const run = (HUB_URL) => spawnSync(process.execPath, ["-e", `import(${JSON.stringify(url)})`], { env: { ...process.env, HUB_URL }, encoding: "utf8" });
  const bad = run("http://192.168.1.9:3000");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Refusing to send the hub key over plain http to 192\.168\.1\.9/);
  for (const ok of ["http://localhost:3000", "http://127.0.0.1:3000", "http://100.101.102.103:3000", "http://pc.tailnet.ts.net:3000", "https://hub.example.com"]) assert.equal(run(ok).status, 0, ok);
  assert.equal(run("http://100.200.1.1:3000").status, 1, "100.200 is outside Tailscale's range");
});
