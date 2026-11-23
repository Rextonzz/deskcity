// After the board meeting a Claude Code lead is started for at least an hour, with the week's brief.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hub, wait } from "./helper.mjs";

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hubproj-"));
// a stand-in for Claude Code: writes the brief it was given to a file and ends
const bin = path.join(folder, "fake-claude.cjs");
fs.writeFileSync(bin, `let s="";process.stdin.on("data",(b)=>s+=b).on("end",()=>{require("fs").writeFileSync(${JSON.stringify(path.join(folder, "brief.txt"))},s);console.log("Did the work. Next: more.");});`);
process.env.AGENTS_CLAUDE_BIN = bin;
const { A, data } = await hub({
  rooms: [{ id: "hr", name: "HR" }, { id: "game", name: "Game", status: "active" }],
  desks: [{ id: "game-lead", room: "game", role: "Project lead", lead: true, provider: "claude", model: "claude-code", status: "active", workFolder: folder },
    { id: "game-artist", room: "game", role: "Pixel artist", provider: "claude", model: "claude-haiku-5-5", capUsdMonth: 3, status: "active", runner: "hub" }],
});

test("the lead's session starts with an hour, the week's budget and the plan step", async () => {
  const r = A.afterMeeting({ trigger: "test" });
  assert.deepEqual(r.started, ["game"]);
  const f = path.join(folder, "brief.txt");
  for (let i = 0; i < 100 && !(fs.existsSync(f) && fs.statSync(f).size > 0); i++) await wait(50); // exists can come before the write ends
  const brief = fs.readFileSync(f, "utf8");
  assert.match(brief, /The board meeting has just ended/);
  assert.match(brief, /3 hours of your own working time/);
  assert.match(brief, /You have no plan for this week yet/);
  assert.match(brief, /Be self-sufficient/);
  assert.match(brief, /working rules/);
  assert.match(brief, /answerable in one word/);
  assert.match(brief, /report failure, don't guess/);
  assert.doesNotMatch(brief, /every 15 minutes/);
  assert.match(brief, /game-artist/);
  const st = JSON.parse(fs.readFileSync(data("week.json"), "utf8"));
  assert.equal(st.rooms.game.runs[0].how, "session");
  assert.ok(st.rooms.game.runs[0].minutes >= 60);
  assert.equal(A.weekStatus().rooms[0].leftMin, 180 - st.rooms.game.runs[0].minutes);
  A.agentsOverview().autonomy.forEach((a) => { try { A.stopAutonomy(a.desk); } catch {} });
});
