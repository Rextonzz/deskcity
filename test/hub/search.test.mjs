// Search everything: the Riftbound deck builder is gone, so neither its page nor a saved deck file shows up.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub } from "./helper.mjs";

const { root } = await hub();
fs.mkdirSync(path.join(root, "data", "riftbound"), { recursive: true });
fs.writeFileSync(path.join(root, "data", "riftbound", "decks.json"), JSON.stringify({ decks: [{ id: "d1", name: "Ember Rush", notes: "" }] }));
const { searchAll } = await import("../../src/pipeline/search.js");

test("a saved Riftbound deck file is no longer searched, and the page is not offered", async () => {
  assert.equal((await searchAll("ember")).total, 0);
  assert.equal((await searchAll("riftbound")).total, 0);
});
test("the other pages are still found", async () => {
  const r = await searchAll("arena");
  assert.deepEqual(r.groups.find((g) => g.name === "Pages").items.map((i) => i.href), ["/arena.html"]);
});
