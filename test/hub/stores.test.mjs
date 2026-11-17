// The card and game stores and the to-do list keep their data with the shared readJson / writeJsonAtomic (C2):
// a missing file reads as the default, a save lands as indent-1 JSON, and a corrupt to-do file is never replaced.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub } from "./helper.mjs";

const { root } = await hub();
const file = (f) => path.join(root, "data", f);
const P = (m) => import(`../../src/pipeline/${m}.js`);
const [pp, pm, rd, tu, tr, di, ar, todo] = await Promise.all(["games", "papermagic", "reading", "tradeup", "trades", "deckideas", "arena", "todo"].map(P));

// name, data file, read (before and after), write, what the file should then contain
const stores = [
  ["games", "games.json", () => pp.gamesList().games, () => pp.addGame({ name: "Hades", platform: "PC" }), (d) => d.games.length === 1 && d.games[0].status === "playing"],
  ["papermagic", "cards/paper-matches.json", () => pm.matchStats(), () => pm.addMatch({ myDeck: "Mono Red", won: 2, lost: 1 }), (d) => d.matches.length === 1],
  ["reading", "reading.json", () => rd.readingList().items, () => rd.addItem({ title: "Some Title" }), (d) => d.items.length === 1 && d.checkedAt === null],
  ["tradeup", "cards/tradeup.json", () => tu.hasWants(), () => tu.saveSettings({ maxEach: 7 }), (d) => d.settings.maxEach === 7 && Array.isArray(d.wants)],
  ["trades", "cards/trades.json", () => tr.listTrades(), () => tr.newTrade({ partner: "Sam" }), (d) => d.trades.length === 1],
  ["todo", "todo.json", () => todo.todoList().items, () => todo.addTodo({ title: "Try this" }), (d) => d.items.length === 1],
];

for (const [name, rel, read, write, check] of stores) {
  test(`${name}: a missing file reads as the default, then save and load round-trip as indent-1 JSON`, async () => {
    const f = file(rel);
    assert.equal(fs.existsSync(f), false);
    await read();
    assert.equal(fs.existsSync(f), false, "reading never creates the file");
    await write();
    const text = fs.readFileSync(f, "utf8");
    const d = JSON.parse(text);
    assert.equal(text, JSON.stringify(d, null, 1));
    assert.ok(check(d));
    assert.deepEqual(fs.readdirSync(path.dirname(f)).filter((n) => n.endsWith(".tmp")), []);
    await read();
  });
}

test("deckideas and arena: a missing file reads as the default; deckideas keeps runs on a file without them", () => {
  assert.deepEqual(di.deckIdeasList().runs, []);
  fs.mkdirSync(file("cards"), { recursive: true });
  fs.writeFileSync(file("cards/deckideas.json"), "{}");
  assert.deepEqual(di.deckIdeasList().runs, []);
  fs.writeFileSync(file("cards/deckideas.json"), "{ corrupt");
  assert.deepEqual(di.deleteDeckIdea("x").runs, []);
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(file("cards/deckideas.json"), "utf8"))), '{"runs":[]}');
  fs.writeFileSync(path.join(root, "pipeline.config.json"), "{}");
  assert.ok(ar.arenaStats());
});

test("todo: a corrupt file raises an error and stays on disk; the seed file is not read", () => {
  const f = file("todo.json");
  fs.writeFileSync(f, "{ not json");
  fs.writeFileSync(file("todo-seed.json"), JSON.stringify({ items: [{ title: "seeded" }] }));
  assert.throws(() => todo.todoList());
  assert.throws(() => todo.addTodo({ title: "another" }));
  assert.equal(fs.readFileSync(f, "utf8"), "{ not json");
  fs.rmSync(f);
  assert.deepEqual(todo.todoList().items, []);
  assert.equal(fs.existsSync(f), false);
});
