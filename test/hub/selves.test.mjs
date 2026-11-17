// Workers' personalities grow from what they do (2026-11-12, the owner: "develop their personality more as they chat,
// interact, surf and watch").
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { hub, ROOMS, DESKS } from "./helper.mjs";

const { A, fake, data } = await hub({ rooms: ROOMS, desks: DESKS });
const life = () => fs.readFileSync(data("life.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("Shorts, web time, finished jobs and chats go into the life record", () => {
  A.recordEvent({ desk: "game-artist", room: "game", action: "watched a Short", summary: '"Tide pool tour" (tide pools): loved the anemones' });
  A.recordEvent({ desk: "game-artist", room: "game", action: "surfed the web", summary: "sea glass: frosted by the waves" });
  A.recordEvent({ desk: "game-artist", room: "game", action: "tool", tool: "Read" });
  A.sendText({ from: "game-artist", to: "game-lead", kind: "chat", text: "third espresso?" });
  const l = life();
  assert.deepEqual(l.map((x) => [x.desk, x.kind]), [["game-artist", "short"], ["game-artist", "web"], ["game-artist", "chat"], ["game-lead", "chat"]]);
  assert.match(l[3].text, /game-artist texted: third espresso/);
});
test("a worker is due a rewrite after 10 new things, and not before", async () => {
  assert.equal(A.dueSelves().some((x) => x.d.id === "game-artist"), true, "never written: due after one thing");
  fs.writeFileSync(data("selves.json"), JSON.stringify({ "game-artist": { about: "x", updatedAt: new Date().toISOString(), history: [] } }));
  assert.equal(A.dueSelves().some((x) => x.d.id === "game-artist"), false);
  await new Promise((r) => setTimeout(r, 5));
  for (let i = 0; i < 10; i++) A.noteLife("game-artist", "chat", `chat ${i}`);
  assert.equal(A.dueSelves().some((x) => x.d.id === "game-artist"), true);
});
test("the rewrite keeps a history, only names real coworkers as friends, and feeds other prompts", async () => {
  fake("desk_job", { about: "A tide-pool-obsessed pixel artist who teases the lead about espresso.", into: ["tide pools", "sea glass"], friends: [{ desk: "game-lead", note: "espresso jokes" }, { desk: "nobody-real", note: "?" }], quirks: ["hums while shading"], changed: "picked up a love of tide pools" });
  const done = await A.growSelves();
  assert.ok(done.includes("game-artist"));
  const me = A.selves()["game-artist"];
  assert.match(me.about, /tide-pool/);
  assert.deepEqual(me.friends.map((f) => f.desk), ["game-lead"]);
  assert.equal(me.history.at(-1).changed, "picked up a love of tide pools");
  assert.match(A.selfLine("game-artist"), /into lately: tide pools, sea glass/);
  assert.match(A.selfLine("hr"), /^personality: /);
  assert.ok(A.agentsOverview().selves["game-artist"].into.includes("tide pools"));
  assert.ok(A.storeSpend().items.life, "counted on the store's budget");
});
test("no rewrites once the store's budget is used up", async () => {
  for (let i = 0; i < 10; i++) A.noteLife("game-artist", "chat", `more ${i}`);
  assert.deepEqual(await A.growSelves({ budgetOpen: false }), []);
});
