// C8b: the card-price and deal-watch files are written temp-then-rename (writeJsonAtomic), folders made on demand.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub, APP, app } from "./helper.mjs";

const { root } = await hub();
const D = await import(app("src/pipeline/dealwatch.js"));
const { usdCad } = await import(app("src/pipeline/fx.js"));
const tmps = () => fs.readdirSync(path.join(root, "data"), { recursive: true }).filter((f) => String(f).endsWith(".tmp"));

test("saveWatchConfig writes the config (folder made on demand) and watchConfig reads it back", () => {
  const cfg = D.saveWatchConfig({ bigCardNm: 7, wishlist: "a\nb" });
  assert.equal(cfg.bigCardNm, 7);
  assert.equal(D.watchConfig().wishlist, "a\nb");
  D.saveWatchConfig({ petDeck: "x" });
  assert.equal(D.watchConfig().bigCardNm, 7, "a second save keeps earlier fields");
  assert.deepEqual(tmps(), []);
});

test("usdCad saves its cache and serves it from the file next time", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { json: async () => ({ observations: [{ d: "2026-11-13", FXUSDCAD: { v: "1.4" } }] }) }; };
  const a = await usdCad();
  assert.equal(a.rate, 1.4);
  const b = await usdCad();
  assert.equal(b.rate, 1.4);
  assert.equal(calls, 1);
  assert.deepEqual(tmps(), []);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "data", "fx.json"), "utf8")).source, "Bank of Canada");
});
