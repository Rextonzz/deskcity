// Fixes from the 2026-11 review of modules.js, netguard.js, openai-compat.js and collection.js.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub, app } from "./helper.mjs";

const { root } = await hub();
const M = await import(app("src/hub/modules.js"));
const N = await import(app("src/pipeline/netguard.js"));
const O = await import(app("src/pipeline/openai-compat.js"));
const C = await import(app("src/pipeline/collection.js"));

const res = () => ({ code: 200, body: null, to: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; }, redirect(u) { this.to = u; } });

test("a switched-off part stays off however its address is capitalised", () => {
  const off = { modules: ["neural"] };
  let r = res(), passed = false;
  M.gateRoute({ path: "/Collection/Top" }, r, () => { passed = true; }, off);
  assert.equal(r.code, 404);
  assert.equal(passed, false);
  r = res();
  M.gatePage({ path: "/Deals.html" }, r, () => {}, off);
  assert.equal(r.to, "/campus.html");
  r = res();
  M.gatePage({ path: "/DEALS.HTML" }, r, () => {}, off);
  assert.equal(r.to, "/campus.html");
});

test("6to4 and Teredo addresses are checked, not trusted", () => {
  assert.equal(N.isPublicIp("2002:7f00:1::"), false, "6to4 of 127.0.0.1");
  assert.equal(N.isPublicIp("2002:c0a8:101::"), false, "6to4 of 192.168.1.1");
  assert.equal(N.isPublicIp("2002:0808:0808::"), true, "6to4 of 8.8.8.8");
  assert.equal(N.isPublicIp("2001:0:4136:e378:8000:63bf:3fff:fdd2"), false, "Teredo");
  assert.equal(N.isPublicIp("2606:4700:4700::1111"), true);
});

test("a built-in key is never sent over plain http", () => {
  assert.equal(O.providerProblem("openai", { baseUrl: "https://api.openai.com/v1" }), null);
  assert.match(O.providerProblem("openai", { baseUrl: "http://api.openai.com/v1" }) || "", /plain http/);
});

test("Paid must be a real number, 0 or more", async () => {
  // a card already in the collection (adding one needs Scryfall, which the tests never reach)
  fs.mkdirSync(path.join(root, "data", "cards"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "cards", "collection.json"), JSON.stringify({ cards: [{ id: "c1", name: "Test Card", qty: 1, paid: null }], lists: ["Binder"] }));
  const card = { id: "c1" };
  assert.throws(() => C.updateCard(card.id, { paid: -3 }), /Paid must be/);
  assert.throws(() => C.updateCard(card.id, { paid: "abc" }), /Paid must be/);
  assert.ok(C.updateCard(card.id, { paid: "2.50" }));
});

test("one bad import file is set aside and does not stop the next", async () => {
  const dir = path.join(root, "data", "cards", "import");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "a-bad.json"), "{not json");
  fs.writeFileSync(path.join(dir, "b-bad.json"), "[also not");
  const out = await C.importFolder();
  assert.equal(out.length, 2, "both were looked at");
  assert.ok(out.every((r) => r.error), JSON.stringify(out));
  assert.equal(fs.existsSync(path.join(dir, "a-bad.json")), false, "moved out of the way, so it isn't retried every 10 minutes");
  assert.ok(fs.existsSync(path.join(dir, "failed", "a-bad.json")));
  assert.ok(fs.existsSync(path.join(dir, "failed", "a-bad.json.error.txt")));
});
