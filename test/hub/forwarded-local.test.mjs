// "This PC" means a loopback connection that names the hub by a loopback name and carries no forwarding header
// (security plan 06): a forwarder on the PC (Tailscale Serve/Funnel, a tunnel) must not look like the owner.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { hub, app } from "./helper.mjs";

await hub();
const S = await import(app("src/security.js"));
const req = (remoteAddress, headers) => ({ socket: { remoteAddress }, headers });

test("loopback with a loopback host name is this PC", () => {
  assert.equal(S.isLocal(req("127.0.0.1", { host: "localhost:3000" })), true);
  assert.equal(S.isLocal(req("::1", { host: "[::1]:3000" })), true);
  assert.equal(S.isLocal(req("::ffff:127.0.0.1", { host: "127.0.0.1:3000" })), true);
});

test("a forwarder on the PC is not this PC", () => {
  assert.equal(S.isLocal(req("127.0.0.1", { host: "pc.tailnet.ts.net" })), false);
  assert.equal(S.isLocal(req("127.0.0.1", { host: "localhost:3000", "x-forwarded-for": "1.2.3.4" })), false);
  assert.equal(S.isLocal(req("127.0.0.1", { host: "localhost:3000", "tailscale-funnel-request": "?1" })), false);
  assert.equal(S.isLocal(req("127.0.0.1", { host: "localhost:3000", forwarded: "for=1.2.3.4" })), false);
  assert.equal(S.isLocal(req("127.0.0.1", { host: "localhost:3000", "cf-connecting-ip": "1.2.3.4" })), false);
});

test("another machine, or no host header, is not this PC", () => {
  assert.equal(S.isLocal(req("192.168.1.5", { host: "localhost" })), false);
  assert.equal(S.isLocal(req("127.0.0.1", {})), false);
});

test("with no password set, a forwarded request must sign in", async () => {
  delete process.env.DASHBOARD_PASSWORD_HASH;
  const web = express();
  web.use(S.requireLogin);
  web.get("/api/x", (rq, rs) => rs.json({ ok: true }));
  const srv = web.listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  const port = srv.address().port;
  const get = (headers) => new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: "/api/x", headers }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); }).on("error", reject);
  });
  try {
    assert.equal(await get({ Host: "localhost" }), 200);
    assert.equal(await get({ Host: "localhost", "X-Forwarded-For": "8.8.8.8" }), 401);
  } finally { srv.close(); }
});
