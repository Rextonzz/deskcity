// The Residences on the server (src/pipeline/agents/campus.js homesState): homes are kept in data/agents/homes.json,
// the first pass moves everyone in quietly, a level change is one "agent home" feed line, and the overview carries it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { hub, app } from "./helper.mjs";

const rooms = [{ id: "hub", name: "Hub" }, { id: "hr", name: "HR" }, { id: "game", name: "Game" }];
const desks = [
  { id: "hr", room: "hr", role: "HR", status: "active" },
  { id: "game-lead", room: "game", role: "Lead", lead: true, status: "active" },
  { id: "game-art", room: "game", role: "Artist", status: "active" },
  { id: "old-hand", room: "game", role: "Old", status: "retired" },
];
const { A, data } = await hub({ rooms, desks });
const { readRuns } = await import(app("src/pipeline/runlog.js"));
const roster = { rooms, desks };

test("first pass: everyone but HR and retired staff moves in, nothing in the feed", () => {
  const st = A.homesState(roster, { "game-lead": { earned: 40 }, "game-art": { earned: 5 } }, "2026-11-16T10:00:00Z");
  const ids = st.towers.flatMap((t) => t.floors.flatMap((f) => f.flats)).filter(Boolean).sort();
  assert.deepEqual(ids, ["game-art", "game-lead"]);
  assert.ok(fs.existsSync(data("homes.json")));
  assert.equal(readRuns({ kinds: ["agent home"] }).length, 0);
});

test("a level change moves that worker and logs one feed line in words", () => {
  const st = A.homesState(roster, { "game-lead": { earned: 40 }, "game-art": { earned: 120 } }, "2026-11-16T11:00:00Z");
  const lines = readRuns({ kinds: ["agent home"] });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].desk, "game-art");
  assert.match(lines[0].change, /^moved to Residences, Floor \d+ \(Nice\): Nice now \(was Basic\)$/);
  assert.equal(st.moved["game-art"].level, "Nice");
  // the same again: no new line
  A.homesState(roster, { "game-lead": { earned: 40 }, "game-art": { earned: 125 } });
  assert.equal(readRuns({ kinds: ["agent home"] }).length, 1);
});

test("new size rules re-lay everyone once: ONE feed line in words, no line per worker, nobody lost", () => {
  // homes.json as the old rules left it (no plan; 4 Basic flats a floor)
  const before = readRuns({ kinds: ["agent home"] }).length;
  const crew = [...desks, { id: "w1", room: "game", status: "active" }, { id: "w2", room: "game", status: "active" }, { id: "w3", room: "game", status: "active" }];
  fs.writeFileSync(data("homes.json"), JSON.stringify({ towers: [{ id: "homes", name: "Residences A", seq: 1, floors: [
    { seq: 1, level: 0, flats: ["w1", "w2", null, "w3"] }, { seq: 2, level: 1, flats: ["game-lead", null, null] }, { seq: 3, level: 2, flats: ["game-art", null] },
  ] }], moved: {} }));
  const ws = { "game-lead": { earned: 40 }, "game-art": { earned: 125 }, w1: { earned: 1 }, w2: { earned: 2 }, w3: { earned: 3 } };
  const st = A.homesState({ rooms, desks: crew }, ws, "2026-11-16T13:00:00Z");
  const all = readRuns({ kinds: ["agent home"] });
  assert.equal(all.length, before + 1, "one line for the whole re-plan");
  const line = all.find((x) => !x.desk);
  assert.equal(line.change, "The Residences were re-planned: homes are bigger; everyone keeps their level");
  assert.ok(st.plan, "the stored homes carry the rules they were laid out by");
  const ids = st.towers.flatMap((t) => t.floors.flatMap((f) => f.flats)).filter(Boolean).sort();
  assert.deepEqual(ids, ["game-art", "game-lead", "w1", "w2", "w3"]);
  // the Basic floor is packed by the new rules (five a floor), in the old order
  assert.deepEqual(st.towers[0].floors.find((f) => f.level === 0).flats, ["w1", "w2", "w3"]);
  assert.equal(st.moved.w1, undefined, "a re-plan is not a move on anyone's card");
  // the next pass: nothing new
  A.homesState({ rooms, desks: crew }, ws, "2026-11-16T14:00:00Z");
  assert.equal(readRuns({ kinds: ["agent home"] }).length, before + 1);
});

test("the overview carries the homes and the move in its feed", () => {
  const o = A.agentsOverview();
  assert.ok(o.homes && Array.isArray(o.homes.towers));
  assert.ok(o.feed.some((f) => f.kind === "agent home" && f.desk === "game-art"));
});
