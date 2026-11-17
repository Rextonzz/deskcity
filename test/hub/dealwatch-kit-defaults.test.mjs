// The deal watch's card lists live in the owner's settings ("cards.dealWatch"), not in the code. A hub with only the
// kit's defaults (demo mode reads nothing but hub.defaults.json) has empty lists and blank paths, and watchLists() gives
// the page nothing to list, so it says "No deck set up yet". (The owner's own values are tested in dealwatch-owner.test.mjs,
// which the kit leaves out.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { app } from "./helper.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dwkit-"));
const run = (code, env = {}) => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], {
  env: { ...process.env, HUB_TEST_ROOT: root, HUB_DEMO: "1", ...env }, encoding: "utf8",
}));
const CODE = `
  const D = await import(${JSON.stringify(app("src/pipeline/dealwatch.js"))});
  const lists = await D.watchLists();
  console.log(JSON.stringify({ cfg: D.watchConfig(), lists }));
`;

test("kit defaults: no deck, no wish list, no still-to-buy cards, no spreadsheet or CSV path", () => {
  const { cfg, lists } = run(CODE);
  assert.deepEqual([cfg.petDeck, cfg.needed, cfg.wishlist], [[], [], []]);
  assert.equal(cfg.petDeckPath, "");
  assert.equal(cfg.csvPath, "");
  assert.equal(lists.source, null);
  assert.deepEqual([lists.petDeck, lists.deck, lists.wishlist, lists.needed], [[], [], [], []]);
});

test("kit defaults: nothing about a home folder or a spreadsheet is in the config", () => {
  const { cfg } = run(CODE);
  assert.doesNotMatch(JSON.stringify(cfg), new RegExp(os.homedir().replace(/\\/g, "/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(JSON.stringify(cfg), /\.xlsx|Videos/i);
});

test("settings can fill the lists, and {home} and {shop} in a path are filled in", () => {
  const f = path.join(root, "s.json");
  fs.writeFileSync(f, JSON.stringify({ cards: { stores: { shop: "Corner Shop" }, dealWatch: { petDeck: ["Alpha Card"], needed: ["Beta Card"], wishlist: ["Gamma Card | Some Set | 1 | foil | 2.50"], petDeckPath: "{home}/deck.xlsx", csvPath: "{home}/{shop} watch.csv" } } }));
  const { cfg, lists } = run(CODE, { HUB_DEMO: "", HUB_TEST_SETTINGS: f });
  assert.deepEqual(cfg.petDeck, ["Alpha Card"]);
  assert.deepEqual(cfg.needed, ["Beta Card"]);
  assert.equal(cfg.petDeckPath, os.homedir().replace(/\\/g, "/") + "/deck.xlsx");
  assert.equal(cfg.csvPath, os.homedir().replace(/\\/g, "/") + "/Corner Shop watch.csv");
  assert.equal(lists.wishlist.length, 1);
});
