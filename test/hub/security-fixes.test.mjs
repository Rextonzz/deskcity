// Fixes from the 2026-11 security review of src/security.js: open redirect, odd cookies, captcha memory, Host parsing,
// CSRF without an Origin header.
import test from "node:test";
import assert from "node:assert/strict";
import { hub, app } from "./helper.mjs";

await hub();
const S = await import(app("src/security.js"));

test("sign-in redirect stays on this hub", () => {
  assert.equal(S.safeNext("/pipeline.html?x=1"), "/pipeline.html?x=1");
  for (const bad of ["//evil.com", "/\\evil.com", "/\\\\evil.com", "http://evil.com", "evil.com", "/ok\r\nSet-Cookie: a=b", undefined, ["/x"]]) {
    assert.equal(S.safeNext(bad), "/campus.html", String(bad));
  }
});

test("Host header parsing", () => {
  assert.equal(S.hostOf("[::1]:3000"), "::1");
  assert.equal(S.hostOf("[::1]"), "::1");
  assert.equal(S.hostOf("LOCALHOST:3000"), "localhost");
  assert.equal(S.hostOf("pc.tailnet.ts.net"), "pc.tailnet.ts.net");
  assert.equal(S.hostOf("[127.0.0.1]evil.com"), "");
  const forged = { socket: { remoteAddress: "127.0.0.1" }, headers: { host: "[127.0.0.1]evil.com" } };
  assert.equal(S.isLocal(forged), false);
});

test("a cookie with broken % codes is not signed in, and does not throw", () => {
  assert.equal(S.readCookie({ headers: { cookie: "ytw_session=%ZZ" } }), null);
  assert.equal(S.readCookie({ headers: { cookie: "ytw_session=abc%20def" } }), "abc def");
  assert.equal(S.readCookie({ headers: {} }), null);
});

test("a device cookie with multi-byte characters does not throw", () => {
  const req = { headers: { cookie: `ytw_device=abc.${"é".repeat(43)}` } };
  assert.equal(S.knownDevice(req, "Mozilla/5.0"), null);
  assert.equal(S.knownDevice({ headers: { cookie: "ytw_device=abc.short" } }, "x"), null);
});

test("captcha: a made-up token is refused, a real one works once", () => {
  assert.equal(S.checkCaptcha("99999999999.deadbeef", "12345"), false);
  assert.equal(S.checkCaptcha(`${Math.floor(Date.now() / 1000) + 60}.deadbeef`, "12345"), false);
  const c = S.newCaptcha();
  assert.equal(S.checkCaptcha(c.token, "wrong"), false);
  assert.equal(S.checkCaptcha(c.token, c.answer), true);
  assert.equal(S.checkCaptcha(c.token, c.answer), false, "second use");
});

function run(headers, method = "POST") {
  let status = 200, nexted = false;
  const res = { status(c) { status = c; return this; }, json() { return this; } };
  S.sameOrigin({ method, headers, path: "/api/x" }, res, () => { nexted = true; });
  return nexted ? 200 : status;
}

test("sameOrigin: cross-site and wrong Referer are blocked, plain scripts pass", () => {
  const host = "localhost:3000";
  assert.equal(run({ host }), 200, "script with no Origin or Referer");
  assert.equal(run({ host, origin: `http://${host}` }), 200);
  assert.equal(run({ host, origin: "http://evil.com" }), 403);
  assert.equal(run({ host, "sec-fetch-site": "cross-site" }), 403);
  assert.equal(run({ host, referer: "http://evil.com/page" }), 403);
  assert.equal(run({ host, referer: `http://${host}/page` }), 200);
  assert.equal(run({ host, "sec-fetch-site": "cross-site" }, "GET"), 200, "reads are not blocked");
});
