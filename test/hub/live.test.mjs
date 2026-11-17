// What a worker is doing: stations for the card, and the brain view's feed.
import test from "node:test";
import assert from "node:assert/strict";
import { hub, ROOMS, DESKS } from "./helper.mjs";

const { A } = await hub({ rooms: ROOMS, desks: DESKS });
const ev = (o, secsAgo, now) => ({ kind: "agent event", desk: "game-lead", startedAt: new Date(now - secsAgo * 1000).toISOString(), ...o });

test("tool names map to stations, for Claude Code and for other tools", () => {
  assert.deepEqual(["Read", "Bash", "WebFetch", "Task", "TodoWrite", "mcp__x__y"].map(A.stationOf), ["files", "shell", "web", "agents", "plan", "tools"]);
  assert.deepEqual(["apply_patch", "shell", "web_search", "update_plan", "whatever"].map(A.stationOf), ["files", "shell", "web", "plan", "other"]);
});
test("the last 10 minutes are grouped; older steps and other desks are left out", () => {
  const now = Date.now();
  const v = A.liveView([ev({ action: "tool", tool: "Edit", summary: "a.js" }, 10, now), ev({ action: "tool", tool: "Bash", failed: true }, 100, now), ev({ action: "tool", tool: "Read" }, 900, now), ev({ action: "turn done", contextTokens: 152000 }, 300, now), { ...ev({ action: "note" }, 5, now), desk: "x" }], now);
  assert.deepEqual(Object.keys(v), ["game-lead"]);
  assert.equal(v["game-lead"].stations.files.n, 1);
  assert.equal(v["game-lead"].stations.files.last, "a.js");
  assert.equal(v["game-lead"].stations.shell.failed, 1);
  assert.equal(v["game-lead"].contextTokens, 152000);
});
test("the brain view's feed returns recent steps, then only what's new", () => {
  A.recordEvent({ desk: "game-lead", room: "game", action: "tool", tool: "Edit", summary: "a.js" }, "claude-code");
  A.recordEvent({ desk: "game-lead", room: "game", action: "tool", tool: "Bash", failed: true }, "claude-code");
  const r = A.deskLive("game-lead");
  assert.deepEqual(r.steps.map((s) => [s.station, s.failed]), [["files", false], ["shell", true]]);
  assert.equal(r.reports, "steps");
  A.recordEvent({ desk: "game-lead", room: "game", action: "turn done", contextTokens: 90000 }, "claude-code");
  const r2 = A.deskLive("game-lead", r.steps[1].at);
  // events in the same millisecond as `since` are not repeated
  assert.ok(r2.steps.length <= 1);
  assert.equal(r2.contextTokens, 90000);
  assert.throws(() => A.deskLive("nobody"), /No such desk/);
  assert.equal(A.deskLive("game-artist").reports, "jobs");
});
