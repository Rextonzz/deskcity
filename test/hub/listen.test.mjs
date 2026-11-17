// Where the hub listens (security plan 01): this PC only unless network.listen is "all" and a password is set.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { hub, app } from "./helper.mjs";

await hub();
const L = await import(app("src/hub/listen.js"));

test("listenMode: local by default, env or settings can say all, junk falls back to local", () => {
  assert.equal(L.listenMode({}, {}), "local");
  assert.equal(L.listenMode({ HUB_LISTEN: "all" }, {}), "all");
  assert.equal(L.listenMode({}, { network: { listen: "all" } }), "all");
  assert.equal(L.listenMode({ HUB_LISTEN: "bogus" }, {}), "local");
});

test("listenHost: wide only with a password", () => {
  assert.equal(L.listenHost({}, { network: { listen: "all" } }), "127.0.0.1");
  assert.equal(L.listenHost({ DASHBOARD_PASSWORD_HASH: "x" }, { network: { listen: "all" } }), undefined);
  assert.equal(L.listenHost({ DASHBOARD_PASSWORD_HASH: "x" }, {}), "127.0.0.1");
});

test("networksSetting: env beats settings beats default (LAN is off by default)", () => {
  assert.equal(L.networksSetting({}, {}), "local,tailscale");
  assert.equal(L.networksSetting({}, { network: { networks: "local,lan" } }), "local,lan");
  assert.equal(L.networksSetting({ DASHBOARD_NETWORKS: "local" }, { network: { networks: "local,lan" } }), "local");
});

test("a default listen binds 127.0.0.1 only", async () => {
  const srv = express().listen(0, L.listenHost({}, {}));
  await new Promise((r) => srv.once("listening", r));
  assert.equal(srv.address().address, "127.0.0.1");
  await new Promise((r) => srv.close(r));
});
