// Content-Security-Policy on every response, and the escaping helpers (security plan 05).
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express from "express";
import { hub, app, APP } from "./helper.mjs";

await hub();
const S = await import(app("src/security.js"));
const M = await import(app("src/hub/modules.js"));
const { esc, safeUrl } = await import(app("public/lib.js"));

const web = express();
web.use(S.securityHeaders);
web.get(/.*/, (req, res) => res.send("ok"));
const srv = web.listen(0, "127.0.0.1");
await new Promise((r) => srv.once("listening", r));
test.after(() => srv.close());
const csp = (p) => new Promise((resolve, reject) => {
  http.get({ host: "127.0.0.1", port: srv.address().port, path: p }, (res) => { res.resume(); res.on("end", () => resolve(res.headers["content-security-policy"])); }).on("error", reject);
});
const hash = (text) => `'sha256-${crypto.createHash("sha256").update(text.replace(/\r\n?/g, "\n")).digest("base64")}'`; // browsers hash after CRLF -> LF
const read = (f) => fs.readFileSync(path.join(APP, "public", f), "utf8");

test("every response carries a policy that refuses framing, plugins, other hosts' scripts", async () => {
  const h = await csp("/api/anything");
  assert.match(h, /default-src 'self'/);
  assert.match(h, /frame-ancestors 'none'/);
  assert.match(h, /object-src 'none'/);
  assert.match(h, /base-uri 'none'/);
  assert.match(h, /script-src 'self'/);
  assert.equal(/script-src[^;]*'unsafe-inline'/.test(h), false, "no inline scripts allowed by default");
  assert.equal(/script-src[^;]*https?:/.test(h), false, "no outside script hosts");
});

test("the campus page's import map is allowed by its hash, and editing it would change the hash", async () => {
  const html = read("campus.html");
  const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(m, "campus.html has an import map");
  assert.ok((await csp("/campus.html")).includes(hash(m[1])));
  assert.equal((await csp("/api/x")).includes(hash(m[1])), false, "only that page gets it");
});

test("each page's own inline start-up script is allowed, and only that page's", async () => {
  const admin = read("admin.html").match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const agents = read("agents.html").match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const h = await csp("/admin.html");
  assert.ok(h.includes(hash(admin)));
  assert.equal(h.includes(hash(agents)), false);
});

// A hub with a campus pet keeps a local, untracked "doll" page for it under the pet's own folder; it gets no policy. Skipped
// where there is no pet (the kit).
const petFolder = (await import(app("src/hub/settings.js"))).petName()?.toLowerCase();
test("the untracked local doll page gets no policy", { skip: !petFolder }, async () => {
  assert.equal(await csp(`/${petFolder}/doll.html`), undefined);
});

test("the front door has no inline script", () => {
  const html = M.frontDoorHtml({ display: "3d" });
  assert.equal(/<script>[^<]/.test(html), false);
  assert.ok(html.includes('src="/front.js"'));
});

test("esc covers quotes; safeUrl lets only http(s) and this hub's own paths through", () => {
  assert.equal(esc("'"), "&#39;");
  assert.equal(esc(`<a href="x">&`), "&lt;a href=&quot;x&quot;&gt;&amp;");
  assert.equal(safeUrl("javascript:alert(1)"), "#");
  assert.equal(safeUrl("data:text/html,x"), "#");
  assert.equal(safeUrl("https://x.y/z"), "https://x.y/z");
  assert.equal(safeUrl("/agents.html"), "/agents.html");
  assert.equal(safeUrl("//evil.com"), "#");
  assert.equal(safeUrl(undefined), "#");
});
