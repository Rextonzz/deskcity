// Sessions in a folder no project claims report as a temp worker, and HR doesn't chase them as strays.
import test from "node:test";
import assert from "node:assert/strict";
import { hub, ROOMS, DESKS } from "./helper.mjs";

const { A } = await hub({ rooms: ROOMS, desks: DESKS });

test("temp workers aren't strays; an unknown name in a real room still is", () => {
  A.recordEvent({ desk: "temp-worker", room: "unassigned", action: "tool", tool: "Read", summary: "a.jpg" }, "claude-code");
  A.recordEvent({ desk: "game-helper-x", room: "game", action: "tool", tool: "Read" }, "claude-code");
  const ids = A.strayDesks().map((s) => s.id);
  assert.equal(ids.includes("temp-worker"), false);
  assert.ok(ids.includes("game-helper-x"));
});
test("work for another project is marked with forRoom, and only when it is another project", () => {
  A.recordEvent({ desk: "game-lead", room: "game", action: "job done", summary: "PR #1 in x/y", forRoom: "other" }, "hub");
  A.recordEvent({ desk: "game-lead", room: "game", action: "job done", summary: "own work", forRoom: "game" }, "hub");
  const feed = A.agentsOverview().feed.filter((f) => f.desk === "game-lead" && f.action === "job done");
  assert.equal(feed.find((f) => f.summary === "PR #1 in x/y").forRoom, "other");
  assert.equal("forRoom" in feed.find((f) => f.summary === "own work"), false);
});
