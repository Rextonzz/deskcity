// Shared route helpers (src/routes/handle.js) and the deal watch CSV that now uses exports.js's cell().
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub } from "./helper.mjs";

const { root } = await hub();
const { safe, firstLine, sendIfThere, sendCsv, photoCap } = await import("../../src/routes/handle.js");
const { toCsv } = await import("../../src/pipeline/dealwatch.js");

const fakeRes = () => {
  const r = { code: 200, body: undefined, headers: {}, ended: false, sent: null };
  r.status = (c) => ((r.code = c), r);
  r.json = (b) => ((r.body = b), r);
  r.end = () => ((r.ended = true), r);
  r.setHeader = (k, v) => (r.headers[k] = v);
  r.send = (b) => ((r.sent = b), r);
  r.sendFile = (f) => ((r.file = f), r);
  return r;
};

test("photoCap answers 413 for an oversized photo and passes a short or missing one on", () => {
  const cap = photoCap(10);
  const big = fakeRes();
  let called = 0;
  cap({ body: { image: "x".repeat(11) } }, big, () => called++);
  assert.equal(big.code, 413);
  assert.deepEqual(big.body, { error: "Photo too large" });
  assert.equal(called, 0);
  cap({ body: { image: "x".repeat(10) } }, fakeRes(), () => called++);
  cap({ body: {} }, fakeRes(), () => called++);
  cap({}, fakeRes(), () => called++);
  assert.equal(called, 3);
});
test("safe answers the result, and 400 with the message by default", async () => {
  const ok = fakeRes();
  await safe(async (req) => ({ got: req.x }))({ x: 1 }, ok);
  assert.deepEqual(ok.body, { got: 1 });
  const bad = fakeRes();
  await safe(() => { throw new Error("nope\nmore"); })({}, bad);
  assert.equal(bad.code, 400);
  assert.deepEqual(bad.body, { error: "nope\nmore" });
});
test("safe takes its own status and wording, and ignores err.status", async () => {
  const boom = () => { throw Object.assign(new Error("a\nb"), { status: 403 }); };
  const first = fakeRes();
  await safe(boom, { status: 500, message: firstLine })({}, first);
  assert.deepEqual([first.code, first.body], [500, { error: "a" }]);
  const stripped = fakeRes();
  await safe(() => { throw new Error("x exited 1: real reason "); }, { status: 500, message: (e) => e.message.replace(/^.*?exited \d+: /s, "").trim() })({}, stripped);
  assert.deepEqual(stripped.body, { error: "real reason" });
  const gw = fakeRes();
  await safe(boom, { status: 502 })({}, gw);
  assert.deepEqual([gw.code, gw.body], [502, { error: "a\nb" }]);
});
test("sendIfThere answers 404 or sends an absolute path (also for a relative one)", () => {
  const miss = fakeRes();
  sendIfThere(miss, path.join(root, "nothing.bin"));
  assert.equal(miss.code, 404);
  assert.ok(miss.ended);
  const f = path.join(root, "there.txt");
  fs.writeFileSync(f, "x");
  const hit = fakeRes();
  sendIfThere(hit, f);
  assert.equal(hit.file, f);
  const rel = fakeRes();
  sendIfThere(rel, path.relative(process.cwd(), f));
  assert.ok(path.isAbsolute(rel.file));
  assert.equal(rel.file, f);
});
test("sendCsv sets the download headers", () => {
  const r = fakeRes();
  sendCsv(r, "a b.csv", "x,y");
  assert.equal(r.headers["Content-Type"], "text/csv; charset=utf-8");
  assert.equal(r.headers["Content-Disposition"], 'attachment; filename="a b.csv"');
  assert.equal(r.sent, "x,y");
});
test("the deal watch CSV keeps formulas as text and quotes commas", () => {
  const csv = toCsv({ at: "2026-11-13T00:00:00Z", items: [{ name: '=SUM(1)', set: 'He said "hi", ok', store: "S", qty: 1, nm: 5, nmSource: "x", price: 2, off: 0.4, kinds: ["a", "b"], isNew: true, url: "u" }] });
  assert.equal(csv.split("\n")[1], `2026-11-13,'=SUM(1),"He said ""hi"", ok",S,Dmg,1,5,x,2,40,a b,NEW,u`);
});
