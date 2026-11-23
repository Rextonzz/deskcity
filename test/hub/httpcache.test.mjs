// Cache headers (src/httpcache.js): a year + immutable only for URLs that carry a version, revalidation for the rest,
// and 304 for unchanged polls of /api/pipeline/glance and /api/pipeline/agents.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import express from "express";
import { hub, app, APP } from "./helper.mjs";

await hub();
const H = await import(app("src/httpcache.js"));
const S = await import(app("src/security.js"));
const C = await import(app("src/compress.js"));
const PUB = `${APP}/public`;

let agents = { desks: [{ id: "a" }], pad: "y".repeat(3000) };
const web = express();
web.use(S.securityHeaders);
web.use(C.compress());
web.use(H.revalidatePolls);
web.use(express.static(PUB, { setHeaders: H.staticHeaders }));
web.get("/api/hub/settings", (req, res) => res.json({ assetV: H.assetVersions(PUB) }));
let glanceItems = [];
web.get("/api/pipeline/glance", (req, res) => res.json({ at: new Date().toISOString(), pipeline: { items: glanceItems } })); // "at" moves on every call, like the real one
web.get("/api/pipeline/agents", (req, res) => res.json(agents));
web.get("/api/agents", (req, res) => res.json(agents));
web.get("/api/pipeline/other", (req, res) => res.json({ x: 1 }));
const srv = web.listen(0, "127.0.0.1");
await new Promise((r) => srv.once("listening", r));
test.after(() => srv.close());
const get = (path, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: "127.0.0.1", port: srv.address().port, path, headers }, (res) => {
    const parts = [];
    res.on("data", (c) => parts.push(c));
    res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
  }).on("error", reject);
});

test("versioned vendor and kit.json URLs are cached for a year and immutable", async () => {
  for (const p of ["/vendor/three.module.min.js?v=r160", `/campus/3d/kit.json?v=${H.assetVersions(PUB).kit}`]) {
    const r = await get(p);
    assert.equal(r.status, 200);
    assert.equal(r.headers["cache-control"], "public, max-age=31536000, immutable", p);
    assert.ok(r.headers.etag);
  }
});

test("the same files without a version, and pages and scripts, are revalidated, never immutable", async () => {
  for (const p of ["/vendor/three.module.min.js", "/campus/3d/kit.json", "/campus.html", "/campus/boot.js", "/campus/main.js", "/theme.css", "/tailwind.css"]) {
    const r = await get(p);
    assert.equal(r.headers["cache-control"], "no-cache", p);
    assert.equal(/immutable/.test(r.headers["cache-control"]), false);
  }
  // a ?v= on a page does not make it immutable
  assert.equal((await get("/campus.html?v=1")).headers["cache-control"], "no-cache");
  assert.equal((await get("/campus/boot.js?v=1")).headers["cache-control"], "no-cache");
});

test("an unchanged revalidated file answers 304 with no body", async () => {
  const first = await get("/campus/boot.js");
  const again = await get("/campus/boot.js", { "If-None-Match": first.headers.etag });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
});

test("the version of kit.json is short, stable and follows the file", () => {
  const v = H.assetVersions(PUB);
  assert.match(v.kit, /^[0-9a-f]{8}$/);
  assert.deepEqual(H.assetVersions(PUB), v);
});

test("glance and agents polls: no-cache + weak ETag, 304 when unchanged, a full answer when changed; other routes untouched", async () => {
  for (const p of ["/api/pipeline/glance", "/api/pipeline/agents", "/api/agents"]) {
    const r = await get(p);
    assert.equal(r.status, 200);
    assert.equal(r.headers["cache-control"], "no-cache", p);
    assert.match(r.headers.etag, /^W\//);
    const same = await get(p, { "If-None-Match": r.headers.etag });
    assert.equal(same.status, 304, p);
    assert.equal(same.body.length, 0);
    assert.equal(same.headers["cache-control"], "no-cache");
  }
  // glance carries its own "at" time: it must not make every poll look changed, but a real change must
  const g1 = await get("/api/pipeline/glance");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal((await get("/api/pipeline/glance", { "If-None-Match": g1.headers.etag })).status, 304, "only the time moved");
  glanceItems = [{ id: "j1" }];
  const g2 = await get("/api/pipeline/glance", { "If-None-Match": g1.headers.etag });
  assert.equal(g2.status, 200, "an item changed");
  assert.equal(JSON.parse(g2.body).pipeline.items.length, 1);
  assert.notEqual(g2.headers.etag, g1.headers.etag);
  const first = await get("/api/pipeline/agents", { "Accept-Encoding": "gzip" });
  assert.equal(first.headers["content-encoding"], "gzip");
  assert.equal((await get("/api/pipeline/agents", { "Accept-Encoding": "gzip", "If-None-Match": first.headers.etag })).status, 304, "304 with compression on");
  agents = { ...agents, desks: [{ id: "a" }, { id: "b" }] };
  const changed = await get("/api/pipeline/agents", { "If-None-Match": first.headers.etag });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.etag, first.headers.etag);
  assert.equal(JSON.parse(changed.body).desks.length, 2);
  assert.equal((await get("/api/pipeline/other")).headers["cache-control"], undefined);
});

test("the campus page names the pinned three.js version, the README says the same, and the kit fetch carries the version", () => {
  const html = fs.readFileSync(`${PUB}/campus.html`, "utf8");
  const v = html.match(/"three": "\/vendor\/three\.module\.min\.js\?v=([^"]+)"/)?.[1];
  assert.ok(v, "the import map's three URL carries ?v=");
  assert.match(fs.readFileSync(`${PUB}/vendor/README.md`, "utf8"), new RegExp(`three\\.js ${v}\\b`), "bump ?v= in campus.html when the vendored three.js changes");
  assert.match(fs.readFileSync(`${PUB}/campus/3d/kit.js`, "utf8"), /kit\.json\$\{window\.campusAssetV/);
  assert.match(fs.readFileSync(`${APP}/server.js`, "utf8"), /assetV: assetVersions\(/);
});
