// Games (src/pipeline/games.js): the generic base any game fits, and add-ons that build out on it.
import test from "node:test";
import assert from "node:assert/strict";
import { hub, app } from "./helper.mjs";

await hub();
const G = await import(app("src/pipeline/games.js"));
const M = await import(app("src/hub/modules.js"));

test("add any game; names are unique; status must be one of four", () => {
  const r = G.addGame({ name: "Hades", platform: "PC" });
  assert.equal(r.games.length, 1);
  assert.equal(r.games[0].status, "playing");
  assert.throws(() => G.addGame({ name: "hades" }), /already here/);
  assert.throws(() => G.addGame({ name: "" }), /name/);
  assert.throws(() => G.addGame({ name: "Celeste", status: "maybe" }), /playing, backlog/);
  assert.deepEqual(G.STATUSES, ["playing", "backlog", "paused", "done"]);
});
test("updates: hours, link, notes; a status change and a note go into the log, newest first", () => {
  const id = G.gamesList().games.find((g) => g.name === "Hades").id;
  const r = G.updateGame(id, { hours: "12.5", link: "https://example.com/hades", notes: "Heat 8 next", status: "done", note: "Beat the final boss" });
  const g = r.games.find((x) => x.id === id);
  assert.equal(g.hours, 12.5);
  assert.equal(g.status, "done");
  assert.deepEqual(g.log.map((l) => l.text), ["Beat the final boss", "playing → done"]);
  assert.throws(() => G.updateGame(id, { link: "javascript:alert(1)" }), /http/);
  assert.throws(() => G.updateGame(id, { hours: "lots" }), /number/);
  assert.equal(G.updateGame(id, { hours: "" }).games.find((x) => x.id === id).hours, null);
  assert.throws(() => G.updateGame("nope", {}), /gone/);
});
test("add-ons attach to the games they fit, and only while their part is on", () => {
  G.addGame({ name: "World of Warcraft", platform: "PC" });
  G.addGame({ name: "MTG Arena", platform: "PC" });
  const all = G.gamesList().games;
  assert.deepEqual(all.find((g) => g.name === "World of Warcraft").addons.map((a) => a.id), ["wow"]);
  assert.deepEqual(all.find((g) => g.name === "MTG Arena").addons.map((a) => a.id), ["arena"]);
  assert.deepEqual(all.find((g) => g.name === "Hades").addons, []);
  const noWow = G.gamesList({ on: new Set(["core", "games", "cards"]) });
  assert.deepEqual(noWow.addons.map((a) => a.id), ["arena"]);
  assert.deepEqual(noWow.games.find((g) => g.name === "World of Warcraft").addons, []);
  // every add-on names a real hub part and a page that part owns
  for (const a of G.GAME_ADDONS) {
    const part = M.MODULES.find((m) => m.id === a.module);
    assert.ok(part, a.id);
    assert.ok((part.pages || []).includes(a.page.replace(/^\/|\.html$/g, "")), `${a.id}: ${a.page} belongs to ${a.module}`);
  }
});
test("remove", () => {
  const id = G.gamesList().games.find((g) => g.name === "Hades").id;
  assert.ok(!G.removeGame(id).games.some((g) => g.id === id));
});
test("Games is a part; Puzzle Pirates is gone; old hobby settings get Games", () => {
  assert.ok(M.MODULES.some((m) => m.id === "games"));
  assert.ok(!M.MODULES.some((m) => m.id === "pirates"));
  assert.ok(M.modulesOn({ addons: ["hobbies"] }).has("games"));
  assert.ok(!M.PRESETS.standard.modules.includes("games"), "Standard is the AI hub with the campus only");
  assert.ok(M.PRESETS.everything.modules.includes("games"));
});
