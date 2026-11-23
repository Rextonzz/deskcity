// Fixes from the 2026-11 review of studio/, leadfence.js and agents.js: HR's cheaper pick is the one hired, a free local
// desk's job can run by itself, and sessions can't read the signed-in Chrome profile or the Windows GitHub token.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub, wait, ROOMS, DESKS, app } from "./helper.mjs";

const { A, fake } = await hub({ rooms: ROOMS, desks: DESKS });
const L = await import(app("src/pipeline/leadfence.js"));

test("approve-cheaper hires HR's model and cap, not the lead's first ask", async () => {
  fake("desk_job", { brief: "First job." });
  const q = A.addRequest({ room: "game", role: "Writer", why: "lore", budgetAsk: 10, suggested: { provider: "claude", model: "claude-opus-5-5", effort: "high" } }, "game-lead");
  const req = { ...A.requests().find((x) => x.id === q.id), hr: { verdict: "approve-cheaper", provider: "claude", model: "claude-haiku-5-5", effort: "low", capUsdMonth: 2 } };
  const h = await A.hireFromRequest(req);
  await wait(200);
  const d = A.roster().desks.find((x) => x.id === h.desk);
  assert.equal(d.model, "claude-haiku-5-5");
  assert.equal(d.effort, "low");
  assert.equal(d.capUsdMonth, 2);
});

test("a plain approve still hires what the lead asked for", async () => {
  fake("desk_job", { brief: "First job." });
  const q = A.addRequest({ room: "game", role: "Tester two", why: "bugs", budgetAsk: 5, suggested: { provider: "claude", model: "claude-sonnet-5-5", effort: "low" } }, "game-lead");
  const req = { ...A.requests().find((x) => x.id === q.id), hr: { verdict: "approve", provider: "claude", model: "claude-sonnet-5-5", effort: "low", capUsdMonth: 5 } };
  const h = await A.hireFromRequest(req);
  await wait(200);
  const d = A.roster().desks.find((x) => x.id === h.desk);
  assert.equal(d.model, "claude-sonnet-5-5");
  assert.equal(d.capUsdMonth, 5);
});

test("sessions can't read the signed-in Chrome profile or the Windows GitHub CLI token", () => {
  const hubDir = path.resolve("/x/hub"), H = L.rulePath(hubDir);
  const rules = L.fenceRules({ hubDir, folder: path.resolve("/x/game") }).rules;
  assert.ok(rules.includes(`Read(${H}/.chrome-profile/**)`));
  assert.ok(rules.includes("Read(~/AppData/Roaming/GitHub CLI/**)"));
  assert.equal(rules.some((r) => /,/.test(r)), false);
});

test("the studio code refuses to guess: no default to Public, no pin with nothing to match", () => {
  const studio = fs.readFileSync(path.resolve("src/pipeline/studio/studio.js"), "utf8");
  assert.match(studio, /Unknown visibility/);
  assert.match(studio, /no plain words to find it by/);
  const tiktok = fs.readFileSync(path.resolve("src/pipeline/studio/tiktok.js"), "utf8");
  assert.match(tiktok, /let confirmed = false/);
  assert.match(tiktok, /didn't confirm the post/);
});
