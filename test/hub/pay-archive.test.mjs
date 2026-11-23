// Campus pay counts archived events (2026-11-20): roll.js moves old events into events-YYYY-MM.jsonl.gz, and pay read
// only the live file, so earnings shrank every time old events rolled and most wallets went below zero.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { hub, ROOMS, DESKS } from "./helper.mjs";

const { A, root } = await hub({ rooms: ROOMS, desks: DESKS });
const dir = path.join(root, "data", "agents");
const ev = (at, action = "job done") => ({ kind: "agent event", startedAt: at, trigger: "agent", source: "game-artist", desk: "game-artist", room: "game", action, summary: "did a thing" });

test("pay includes the archived months, and a second roll doesn't take any away", () => {
  const old = [ev("2026-10-02T10:00:00.000Z"), ev("2026-10-03T10:00:00.000Z"), ev("2026-10-04T10:00:00.000Z")];
  const live = [ev("2026-11-05T10:00:00.000Z")];
  fs.writeFileSync(path.join(dir, "events-2026-10.jsonl.gz"), zlib.gzipSync(old.map((e) => JSON.stringify(e)).join("\n") + "\n"));
  fs.writeFileSync(path.join(dir, "events-index.json"), JSON.stringify({ file: "events.jsonl", months: [{ month: "2026-10", file: "events-2026-10.jsonl.gz", lines: 3, first: old[0].startedAt, last: old[2].startedAt }] }));
  fs.writeFileSync(path.join(dir, "events.jsonl"), live.map((e) => JSON.stringify(e)).join("\n") + "\n");
  assert.equal(A.readEventsAll().filter((e) => e.desk === "game-artist").length, 4);
  assert.equal(A.wallets()["game-artist"].earned, 40, "3 archived + 1 live job, 10 each");
  // the live event rolls into November's archive: still 40
  fs.writeFileSync(path.join(dir, "events-2026-11.jsonl.gz"), zlib.gzipSync(JSON.stringify(live[0]) + "\n"));
  fs.writeFileSync(path.join(dir, "events-index.json"), JSON.stringify({ file: "events.jsonl", months: [
    { month: "2026-10", file: "events-2026-10.jsonl.gz", lines: 3, first: old[0].startedAt, last: old[2].startedAt },
    { month: "2026-11", file: "events-2026-11.jsonl.gz", lines: 1, first: live[0].startedAt, last: live[0].startedAt },
  ] }));
  fs.writeFileSync(path.join(dir, "events.jsonl"), JSON.stringify(ev("2026-11-06T10:00:00.000Z")) + "\n");
  assert.equal(A.wallets()["game-artist"].earned, 50, "nothing lost in the roll, plus the new job");
});
test("no archive at all: just the live file", () => {
  fs.rmSync(path.join(dir, "events-index.json"));
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl.gz"))) fs.rmSync(path.join(dir, f));
  assert.equal(A.readEventsAll().length, A.readEventsSince("1970-01-01T00:00:00Z").length);
});
