// Campus final check (2026-11-20): the city fund vote route (POST /api/agents/ingest/fund-vote, routes/agents.js).
// A project lead may vote on a fund spend by post; the owner and the board desks (HR, finance) may not.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express from "express";
import { hub, app } from "./helper.mjs";

const ROOMS = [{ id: "hub", name: "Hub" }, { id: "hr", name: "HR" }, { id: "finance", name: "Finance" }, { id: "game", name: "Game" }];
const DESKS = [
  { id: "hr", room: "hr", role: "HR", lead: true, provider: "claude", model: "claude-haiku-5-5", status: "active", runner: "hub" },
  { id: "finance-lead", room: "finance", role: "Finance lead", lead: true, provider: "claude", status: "active" },
  { id: "hub-builder", room: "hub", role: "Hub builder", lead: true, provider: "claude", status: "active" },
  { id: "game-lead", room: "game", role: "Project lead", lead: true, provider: "claude", status: "active" },
];
// the fund starts with 100 credits (a tax line), so a small spend passes the "fund covers it" check
const seed = { "cityfund.jsonl": JSON.stringify({ kind: "tax", at: new Date().toISOString(), item: "seed", buyer: "a1", amount: 100, fund: 100, reserve: 0, reason: "test seed" }) + "\n" };
const { A, root } = await hub({ rooms: ROOMS, desks: DESKS, seed });
const S = await import(app("src/hub/settings.js"));
const { agentIngestRoutes } = await import(app("src/routes/agents.js"));
const LEDGER = path.join(root, "data", "agents", "cityfund.jsonl");
const lines = () => fs.readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const votes = () => lines().filter((l) => l.kind === "vote");

const web = express();
web.use(express.json({ limit: "2mb" }));
agentIngestRoutes(web);
const srv = web.listen(0, "127.0.0.1");
await new Promise((r) => srv.once("listening", r));
test.after(() => srv.close());
const key = A.ingestToken();
const post = (route, body) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body);
  const rq = http.request({ host: "127.0.0.1", port: srv.address().port, path: `/api/agents/ingest/${route}`, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), Authorization: `Bearer ${key}` } }, (res) => {
    let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => { let b = {}; try { b = JSON.parse(t || "{}"); } catch {} resolve({ status: res.statusCode, body: b }); });
  });
  rq.on("error", reject); rq.end(data);
});

// the owner proposes a small spend (the owner is outside the limits); its board is HR, finance and the hub lead
const owner = S.ownerId();
const proposal = A.proposeSpend({ by: owner, amount: 5, reason: "fix the fountain", room: "hub" }).proposal;
// proposeSpend logs the finance desk's own yes at once (cityfund.js), so the vote count starts at 1, not 0
const base = votes().length;

test("the owner's id posted as a desk is refused, and no vote is logged", async () => {
  const r = await post("fund-vote", { id: proposal.id, desk: owner, vote: "yes" });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.error, /votes from the dashboard/);
  assert.equal(votes().length, base);
});

test("HR and the finance desk can't vote on a fund spend by post", async () => {
  for (const desk of ["hr", "finance-lead"]) {
    const r = await post("fund-vote", { id: proposal.id, desk, vote: "yes" });
    assert.equal(r.status, 400, `${desk}: ${JSON.stringify(r.body)}`);
    assert.match(r.body.error, /votes inside the hub/, desk);
  }
  assert.equal(votes().length, base);
});

test("a desk that is not on this board is refused", async () => {
  const r = await post("fund-vote", { id: proposal.id, desk: "game-lead", vote: "yes" });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.error, /isn't on the board/);
  assert.equal(votes().length, base);
});

test("a board desk (the hub lead) can vote by post, and the vote is logged as its own", async () => {
  const r = await post("fund-vote", { id: proposal.id, desk: "hub-builder", vote: "yes", why: "it needs fixing" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.proposal.id, proposal.id);
  const v = votes();
  assert.equal(v.length, base + 1);
  const mine = v.find((x) => x.by === "hub-builder");
  assert.equal(mine.vote, "yes");
  assert.notEqual(mine.owner, true, "a posted vote is never the owner's");
  assert.equal(r.body.status, "spent", "two yes votes of three (finance and the hub lead) spend it");
});

test("the same desk can't vote twice on one proposal", async () => {
  const r = await post("fund-vote", { id: proposal.id, desk: "hub-builder", vote: "no" });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.error, /already (voted|spent)/);
  assert.equal(votes().length, base + 1);
});
