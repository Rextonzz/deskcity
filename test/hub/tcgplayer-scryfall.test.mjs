// priceCards and lookupTcg (src/pipeline/tcgplayer.js) against a stand-in tcgplayer.com tab, and the one Scryfall
// client (scryfallApi in scryfall.js) against a stubbed fetch: no real browser, no network.
import nodeTest from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub } from "./helper.mjs";
import { loadPlaywright } from "../../src/addons/playwright.js";

const { root } = await hub();
fs.writeFileSync(path.join(root, "pipeline.config.json"), JSON.stringify({ chromeProfileDir: "chrome-profile" }));
// Products the stand-in search knows (searched by name, or "name set"), and each product's listing prices by printing.
let products = [];
let prices = {};
const searches = [];
const standIn = () => ({
  setDefaultTimeout() {},
  async goto() {},
  async close() {},
  async evaluate(fn, args) {
    if (typeof fn === "string") return;
    globalThis.window = {
      __tcgSearch: async (q) => (searches.push(q), products.filter((p) => q.toLowerCase().includes(p.n.split(" (")[0].toLowerCase()))),
      __tcgListings: async (id, printing) => {
        const p = [...(prices[`${id}:${printing}`] || [])].sort((a, b) => a - b);
        return { low: p[0] ?? null, third: p[2] ?? null, last: p.at(-1) ?? null, count: p.length };
      },
    };
    return fn(args);
  },
});
// Skipped (not failed) when the browser add-on is not installed and core has no playwright either.
let chromium = null;
try { ({ chromium } = await loadPlaywright()); } catch {}
const skip = chromium ? false : "playwright is not installed (npm run addons:install)";
const test = Object.assign((name, fn) => nodeTest(name, { skip }, fn), { beforeEach: nodeTest.beforeEach.bind(nodeTest) });
if (chromium) chromium.launchPersistentContext = async () => ({ on() {}, newPage: async () => standIn() });
const { priceCards, lookupTcg } = await import("../../src/pipeline/tcgplayer.js");
const { scryfallApi } = await import("../../src/pipeline/scryfall.js");
const prod = (id, n, s, num) => ({ id, n, s, num });
test.beforeEach(() => { searches.length = 0; products = []; prices = {}; });

test("priceCards: a collector number picks the one product; the price is the 3rd cheapest", async () => {
  products = [prod(1, "Bolt", "Alpha", "10"), prod(2, "Bolt", "Beta", "11")];
  prices = { "1:Normal": [5, 1, 3, 2, 9] };
  const [r] = await priceCards([{ name: "Bolt", number: "10", setName: "Alpha", foil: "nonfoil" }]);
  assert.equal(r.price, 3);
  assert.equal(r.productId, 1);
  assert.equal(r.priceNote, null);
  assert.deepEqual(searches, ["Bolt"]);
});

test("priceCards: fewer than 3 listings use the dearest and say so; none is an error", async () => {
  products = [prod(1, "Bolt", "Alpha", "10"), prod(3, "Elf", "Alpha", "12")];
  prices = { "1:Normal": [4, 2] };
  const out = await priceCards([{ name: "Bolt", number: "10", setName: "Alpha", foil: "nonfoil" }, { name: "Elf", number: "12", setName: "Alpha", foil: "nonfoil" }]);
  assert.equal(out[0].price, 4);
  assert.equal(out[0].priceNote, "only 2 NM listings");
  assert.equal(out[1].error, "no Near Mint English Normal listings");
});

test("priceCards: no number matches by name and set", async () => {
  products = [prod(1, "Bolt", "Alpha", "10")];
  prices = { "1:Normal": [2, 3, 4] };
  const [r] = await priceCards([{ name: "Bolt", setName: "Alpha", foil: "nonfoil" }]);
  assert.equal(r.price, 4);
  assert.match(r.priceNote, /matched by name, collector # not read/);
  assert.deepEqual(searches, ["Bolt"]);
});

test("priceCards: a basic land with no number uses the cheapest printing of the set", async () => {
  products = [prod(1, "Forest", "Alpha", "1"), prod(2, "Forest", "Alpha", "2")];
  prices = { "1:Normal": [5, 6, 7], "2:Normal": [1, 2, 3] };
  const [r] = await priceCards([{ name: "Forest", setName: "Alpha", foil: "nonfoil" }]);
  assert.equal(r.price, 3);
  assert.equal(r.productId, 2);
  assert.match(r.priceNote, /cheapest of 2 Alpha Forest printings/);
  assert.deepEqual(searches, ["Forest", "Forest Alpha"]);
});

test("priceCards: foil unknown prices the cheaper printing and flags the guess", async () => {
  products = [prod(1, "Bolt", "Alpha", "10")];
  prices = { "1:Normal": [8, 9, 10], "1:Foil": [3, 4, 5] };
  const [r] = await priceCards([{ name: "Bolt", number: "10", setName: "Alpha", foil: "unknown" }]);
  assert.equal(r.price, 5);
  assert.equal(r.priceNote, "foil unreadable - priced the cheaper printing (guess)");
});

test("priceCards: a pasted TCGplayer link prices that product without searching; a Scryfall 5xx is reported", async () => {
  prices = { "77:Normal": [1, 2, 3] };
  const [r] = await priceCards([{ name: "Bolt", number: "https://www.tcgplayer.com/product/77/x", setName: "Alpha", foil: "nonfoil" }]);
  assert.equal(r.price, 3);
  assert.equal(r.productId, 77);
  assert.match(r.priceNote, /from your TCGplayer link/);
  assert.equal(searches.length, 0);
  globalThis.fetch = async () => new Response("", { status: 503 });
  const [e] = await priceCards([{ name: "Bolt", number: "one 339", setName: "Alpha", foil: "nonfoil" }]);
  assert.equal(e.error, "couldn't read that link (Scryfall answered 503)");
});

test("lookupTcg: low, 3rd and count per printing; the set-name search only with a set name", async () => {
  products = [prod(1, "Bolt", "Alpha", "10"), prod(2, "Bolt", "Beta", "11")];
  prices = { "1:Normal": [4, 1, 2, 3], "1:Foil": [9] };
  const out = await lookupTcg({ name: "Bolt", number: "10", foil: "unknown" });
  assert.deepEqual(out.printings, { nonfoil: { low: 1, third: 3, count: 4 }, foil: { low: 9, third: null, count: 1 } });
  assert.equal(out.product, "Bolt");
  assert.deepEqual(searches, ["Bolt"]);
  searches.length = 0;
  const two = await lookupTcg({ name: "Bolt", foil: "nonfoil" });
  assert.match(two.note, /2 printings match/);
  assert.deepEqual(searches, ["Bolt"]);
  searches.length = 0;
  await lookupTcg({ name: "Bolt", setName: "Gamma", foil: "nonfoil" });
  assert.deepEqual(searches, ["Bolt", "Bolt Gamma"]);
  assert.equal((await lookupTcg({ name: "Nothing", foil: "foil" })).error, "No TCGplayer product with that name.");
});

nodeTest("scryfallApi: a 429 is retried when retries are on; a 500 fails fast without them; a 404 is null", async () => {
  const seen = [];
  const answers = [];
  globalThis.fetch = async (u, o) => {
    seen.push([String(u), o.method]);
    const a = answers.shift();
    return a.status === 200 ? Response.json(a.json) : new Response("", { status: a.status, headers: { "retry-after": "0.01" } });
  };
  answers.push({ status: 429 }, { status: 200, json: { ok: 1 } });
  assert.deepEqual(await scryfallApi("https://api.scryfall.com/a", { retries: 6 }), { ok: 1 });
  assert.equal(seen.length, 2);
  seen.length = 0;
  answers.push({ status: 500 });
  await assert.rejects(scryfallApi("https://api.scryfall.com/b"), /Scryfall answered 500/);
  assert.equal(seen.length, 1);
  answers.push({ status: 500 }, { status: 200, json: { ok: 2 } });
  assert.deepEqual(await scryfallApi("https://api.scryfall.com/c", { body: { x: 1 }, retries: 2 }), { ok: 2 });
  assert.equal(seen.at(-1)[1], "POST");
  answers.push({ status: 404 });
  assert.equal(await scryfallApi("https://api.scryfall.com/d"), null);
});
