// Blocker watches only read public pages and paths inside the project's own folders (security plan 02).
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { hub, app, ROOMS, DESKS } from "./helper.mjs";

const proj = path.join(os.tmpdir(), "proj");
const { A } = await hub({ rooms: ROOMS, desks: DESKS, seed: { "hook-map.json": { [proj]: { room: "game" } } } });
const N = await import(app("src/pipeline/netguard.js"));
const add = (extra) => A.addBlocker({ desk: "game-artist", what: "waiting", ...extra });
const url = (u) => add({ type: "url-contains", url: u, text: "x" });

test("url-contains refuses this PC, private networks and other protocols", () => {
  for (const u of ["http://127.0.0.1:3000/", "http://localhost/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://0x7f000001/", "http://10.1.2.3/", "http://printer.local/", "ftp://example.com/"]) {
    assert.throws(() => url(u), undefined, u);
  }
});

test("url-contains accepts a public page (no fetch happens at add)", () => {
  const w = url("https://example.com/release-notes");
  assert.equal(w.check.url, "https://example.com/release-notes");
});

test("file-exists: no network paths, no relative paths, only inside the project's folders", () => {
  const f = (p) => add({ type: "file-exists", path: p });
  assert.throws(() => f("\\\\evil\\share\\x"), /Network paths/);
  assert.throws(() => f("//evil/share/x"), /Network paths/);
  // an absolute path outside the project (what counts as absolute depends on the system the tests run on)
  assert.throws(() => f(process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/hosts"), /inside this project/);
  assert.throws(() => f("notes\\x.txt"), /full path/);
  assert.throws(() => f(path.join(proj, "..", "elsewhere", "x.txt")), /inside this project/);
  assert.equal(f(path.join(proj, "out", "done.txt")).check.path, path.resolve(proj, "out", "done.txt"));
});

test("runCheck: a name that resolves to a private address is refused at fetch time", async () => {
  const lookup = async () => [{ address: "10.0.0.5", family: 4 }];
  await assert.rejects(A.runCheck({ type: "url-contains", url: "https://sneaky.example.com/", text: "x" }, { lookup, fetchImpl: async () => { throw new Error("must not fetch"); } }), /private network/);
});

test("runCheck: redirects aren't followed, big pages stop, matching text clears", async () => {
  const lookup = async () => [{ address: "93.184.215.14", family: 4 }];
  const c = { type: "url-contains", url: "https://example.com/", text: "version 2" };
  const moved = await A.runCheck(c, { lookup, fetchImpl: async (u, o) => { assert.equal(o.redirect, "manual"); return new Response("", { status: 302, headers: { location: "http://127.0.0.1/" } }); } });
  assert.equal(moved.cleared, false); assert.match(moved.note, /redirect/);
  const big = await A.runCheck(c, { lookup, fetchImpl: async () => new Response("x".repeat(3e6)) });
  assert.equal(big.cleared, false); assert.match(big.note, /too big/);
  const hit = await A.runCheck(c, { lookup, fetchImpl: async () => new Response("Version 2 is out") });
  assert.equal(hit.cleared, true);
});

test("runCheck: an old watch on a network path isn't probed", async () => {
  const out = await A.runCheck({ type: "file-exists", path: "\\\\evil\\share\\x" });
  assert.equal(out.cleared, false); assert.match(out.note, /network paths/);
});

test("the 11th open watch for one desk is refused", () => {
  const n = A.blockerWatches({ open: true }).filter((w) => w.desk === "game-artist").length;
  for (let i = n; i < 10; i++) url(`https://example.com/p${i}`);
  assert.throws(() => url("https://example.com/p-last"), /already has 10 open watches/);
});

test("isPublicIp", () => {
  assert.equal(N.isPublicIp("8.8.8.8"), true);
  assert.equal(N.isPublicIp("2606:4700::1111"), true);
  for (const ip of ["100.64.1.1", "::ffff:127.0.0.1", "fd7a:115c:a1e0::1", "::1", "169.254.169.254", "not-an-ip"]) assert.equal(N.isPublicIp(ip), false, ip);
});
