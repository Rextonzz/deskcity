// The finance desk gets the hub's live spend numbers with every job, whether it sits in HR or in its own Finance room.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { hub, ROOMS, DESKS, APP, app } from "./helper.mjs";

const fin = { id: "finance-lead", room: "finance", role: "Finance lead", lead: true, provider: "claude", model: "claude-sonnet-5-5", effort: "low", capUsdMonth: 5, status: "active", runner: "hub" };
await hub({ rooms: [...ROOMS, { id: "finance", name: "Finance" }], desks: [...DESKS, fin] });
const B = await import(app("src/pipeline/agents/board.js"));

test("a Finance-room lead is the finance desk and its jobs carry the numbers", () => {
  const text = B.financeContext(fin);
  assert.match(text, /Live spend numbers from the hub/);
  assert.match(text, /of \$\d+(\.\d+)? of monthly caps|monthly caps/);
  assert.match(text, /By worker:/);
  assert.equal(B.financeContext(DESKS[2]), "", "other desks get nothing");
});
