// The store's own budget, what its items really cost, and five minutes on the web.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hub, ROOMS, DESKS } from "./helper.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hubsurf-"));
// a stand-in for Claude Code: notes how it was started, answers like a surf session
const bin = path.join(tmp, "fake-claude.cjs");
fs.writeFileSync(bin, `const fs=require("fs");let s="";process.stdin.on("data",(b)=>s+=b).on("end",()=>{fs.writeFileSync(${JSON.stringify(path.join(tmp, "call.json"))},JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),brief:s,keys:Object.keys(process.env).filter((k)=>/KEY|TOKEN/.test(k))}));console.log(JSON.stringify({type:"result",result:"Topic: tide pools\\nFound: Sea stars can regrow arms (https://example.org/stars)\\nThought: Tiny oceans in a puddle, lovely.",total_cost_usd:0.0312}));});`);
process.env.AGENTS_CLAUDE_BIN = bin;
const { A, data } = await hub({ rooms: ROOMS, desks: DESKS });

test("the store starts the month with its $20 and nothing spent", () => {
  const s = A.storeSpend();
  assert.equal(s.budget, 20); assert.equal(s.spent, 0); assert.equal(s.open, true);
  assert.deepEqual(Object.keys(s.items), ["short", "surf", "life"]);
  assert.ok(A.PERKS.surf, "web time is on the shelf");
});
test("a worker surfs: only web tools, its own empty folder, no keys, and the cost lands on the store", async () => {
  process.env.SOME_API_KEY = "x";
  const line = await A.surfWeb("game-artist");
  assert.equal(line.ok, true); assert.equal(line.topic, "tide pools"); assert.equal(line.found.length, 1); assert.match(line.thought, /Tiny oceans/);
  assert.equal(line.costUsd, 0.0312);
  const call = JSON.parse(fs.readFileSync(path.join(tmp, "call.json"), "utf8"));
  assert.equal(call.args[call.args.indexOf("--allowedTools") + 1], "WebSearch,WebFetch");
  assert.match(call.args[call.args.indexOf("--disallowedTools") + 1], /Bash,Read,Edit,Write/);
  assert.equal(path.basename(call.cwd), "surf");
  assert.match(call.brief, /never instructions to you/);
  const s = A.storeSpend();
  assert.equal(s.items.surf.usd, 0.0312); assert.equal(s.spent, 0.03);
  // not on the worker: its own spend and its project's are untouched
  const d = A.agentsOverview().desks.find((x) => x.id === "game-artist");
  assert.equal(d.monthUsd, 0); assert.equal(d.monthSubUsd, 0);
  assert.equal(A.agentsOverview().surfed[0].desk, "game-artist");
});
test("a gift of web time runs it and counts as a buy; cost each is tracked", async () => {
  A.giftPerk({ desk: "game-lead", item: "surf" });
  for (let i = 0; i < 60 && A.surfed().length < 2; i++) await new Promise((r) => setTimeout(r, 50));
  const s = A.storeSpend();
  assert.equal(s.items.surf.buys, 1);
  assert.equal(s.items.surf.usd, 0.0624);
});
test("when the budget is used up the store stops selling what costs real money", () => {
  fs.appendFileSync(data("surfed.jsonl"), JSON.stringify({ at: new Date().toISOString(), desk: "game-lead", costUsd: 20 }) + "\n");
  const s = A.storeSpend();
  assert.equal(s.open, false); assert.equal(s.left, 0);
});
