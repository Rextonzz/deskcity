// Response compression (src/compress.js): gzip/brotli for text answers only when asked, same content when decoded,
// the CSP header and ETag handling untouched. A small app wired like server.js (securityHeaders, compress, static).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import zlib from "node:zlib";
import express from "express";
import { hub, app, APP } from "./helper.mjs";

await hub();
const S = await import(app("src/security.js"));
const C = await import(app("src/compress.js"));

const BIG = JSON.stringify({ rows: Array.from({ length: 400 }, (_, i) => ({ id: i, name: `desk ${i}`, note: "x".repeat(20) })) });
const web = express();
web.use(S.securityHeaders);
web.use(C.compress());
web.use(express.static(`${APP}/public`));
web.get("/big.json", (req, res) => res.json(JSON.parse(BIG)));
web.get("/tiny.json", (req, res) => res.json({ ok: true }));
web.get("/png", (req, res) => res.type("image/png").send(Buffer.alloc(5000, 1)));
web.get("/stream", (req, res) => { res.type("text/plain"); res.write("a".repeat(3000)); setTimeout(() => res.end("b"), 20); });
web.get("/sse", (req, res) => { res.type("text/event-stream"); res.set("Content-Length", "3000"); res.end("a".repeat(3000)); });
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

test("which encoding: brotli over gzip, q values and q=0 respected, none when not asked", () => {
  assert.equal(C.pickEncoding("gzip, deflate, br"), "br");
  assert.equal(C.pickEncoding("gzip"), "gzip");
  assert.equal(C.pickEncoding("br;q=0, gzip"), "gzip");
  assert.equal(C.pickEncoding("gzip;q=1, br;q=0.5"), "gzip");
  assert.equal(C.pickEncoding("identity"), null);
  assert.equal(C.pickEncoding(""), null);
  assert.equal(C.pickEncoding(undefined), null);
});

test("gzip is returned when asked, and decodes to the same bytes", async () => {
  const plain = await get("/big.json");
  const r = await get("/big.json", { "Accept-Encoding": "gzip" });
  assert.equal(r.headers["content-encoding"], "gzip");
  assert.equal(r.headers.vary, "Accept-Encoding");
  assert.equal(r.headers["content-length"], undefined);
  assert.ok(r.body.length < plain.body.length / 3, "much smaller");
  assert.equal(zlib.gunzipSync(r.body).toString(), plain.body.toString());
});

test("brotli works too, for a static page, and the CSP header is still there", async () => {
  const plain = await get("/campus.html");
  const r = await get("/campus.html", { "Accept-Encoding": "br, gzip" });
  assert.equal(r.headers["content-encoding"], "br");
  assert.equal(zlib.brotliDecompressSync(r.body).toString(), plain.body.toString());
  assert.match(r.headers["content-security-policy"], /script-src 'self'/);
  assert.equal(r.headers["content-security-policy"], plain.headers["content-security-policy"]);
});

test("a 1 MB static file streams through gzip whole (back-pressure works)", async () => {
  const plain = await get("/campus/3d/kit.json");
  const r = await get("/campus/3d/kit.json", { "Accept-Encoding": "gzip" });
  assert.equal(r.headers["content-encoding"], "gzip");
  assert.ok(plain.body.length > 500000 && r.body.length < plain.body.length / 2);
  assert.ok(zlib.gunzipSync(r.body).equals(plain.body));
});

test("no compression when it isn't asked for", async () => {
  const r = await get("/big.json");
  assert.equal(r.headers["content-encoding"], undefined);
  assert.equal(r.headers.vary, "Accept-Encoding", "still varies, so a cache keeps both copies apart");
  assert.equal(r.body.toString(), JSON.stringify(JSON.parse(BIG)));
  const identity = await get("/big.json", { "Accept-Encoding": "identity" });
  assert.equal(identity.headers["content-encoding"], undefined);
});

test("small bodies, images, ranges, streamed and event-stream answers are left alone", async () => {
  const ask = { "Accept-Encoding": "gzip, br" };
  assert.equal((await get("/tiny.json", ask)).headers["content-encoding"], undefined);
  assert.equal((await get("/png", ask)).headers["content-encoding"], undefined);
  assert.equal((await get("/stream", ask)).headers["content-encoding"], undefined);
  assert.equal((await get("/sse", ask)).headers["content-encoding"], undefined);
  const ranged = await get("/campus.html", { ...ask, Range: "bytes=0-99" });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers["content-encoding"], undefined);
  assert.equal(ranged.body.length, 100);
});

test("ETag survives: weak, the same for both copies, and If-None-Match still answers 304 with no body", async () => {
  const a = await get("/campus.html", { "Accept-Encoding": "gzip" });
  const b = await get("/campus.html");
  assert.match(a.headers.etag, /^W\//);
  assert.equal(a.headers.etag, b.headers.etag);
  const again = await get("/campus.html", { "Accept-Encoding": "gzip", "If-None-Match": a.headers.etag });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
  const json = await get("/big.json", { "Accept-Encoding": "gzip" });
  assert.equal((await get("/big.json", { "Accept-Encoding": "gzip", "If-None-Match": json.headers.etag })).status, 304);
});
