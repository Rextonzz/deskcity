// Team templates (src/pipeline/teams.js): a project created with a team gets one HR staff request per crew role,
// each the owner's to approve; nothing is hired straight away.
import test from "node:test";
import assert from "node:assert/strict";
import { hub, app, ROOMS, DESKS } from "./helper.mjs";

const { A } = await hub({ rooms: ROOMS, desks: DESKS });
const T = await import(app("src/pipeline/teams.js"));
const M = await import(app("src/hub/modules.js"));

test("the game development team: a small crew and a full studio, every role described", () => {
  const g = T.TEAMS.gamedev;
  assert.deepEqual(g.sizes.small.roles, ["builder", "qa"]);
  assert.deepEqual(g.sizes.full.roles, ["builder", "designer", "reviewer", "qa", "release"]);
  for (const r of Object.values(g.roles)) assert.ok(r.role && r.why && r.needs);
  assert.ok(M.MODULES.find((m) => m.id === g.module), "its part exists");
  const q = T.crewRequests({ team: "gamedev", size: "full", room: "space-game", name: "Space game" });
  assert.deepEqual(q.map((x) => x.deskId), ["space-game-builder", "space-game-designer", "space-game-reviewer", "space-game-qa", "space-game-release"]);
  assert.ok(q.every((x) => x.kind === "staff" && x.lead === false && x.room === "space-game"));
  assert.equal(T.crewRequests({ team: "gamedev", size: "nonsense", room: "x", name: "X" }).length, 2, "an unknown size is the smallest");
  assert.throws(() => T.crewRequests({ team: "nope", room: "x", name: "X" }), /no team/);
});
test("teams are only offered while their part is on", () => {
  assert.deepEqual(T.teamsOffered(new Set(["core"])), []);
  const on = T.teamsOffered(new Set(["core", "gamedev"]));
  assert.equal(on[0].id, "gamedev");
  assert.deepEqual(on[0].sizes.map((s) => s.id), ["small", "full"]);
  assert.ok(on[0].sizes[1].roles.includes("Game designer"));
});
test("creating a project with a team files a staff request per crew role and hires nobody", async () => {
  const before = A.roster().desks.length;
  const r = await A.createProject({ name: "Space game", about: "A small space shooter", district: "Games", lead: "none", team: "gamedev", size: "small" });
  assert.match(r.done.join(" "), /game development team: Builder, QA and balance/);
  const asked = A.requests().filter((q) => q.room === "space-game");
  assert.deepEqual(asked.map((q) => q.deskId).sort(), ["space-game-builder", "space-game-qa"]);
  assert.equal(A.roster().desks.length, before, "nobody is hired until the owner approves");
  await assert.rejects(() => A.createProject({ name: "Other game", lead: "none", team: "nope" }), /no team/);
  assert.ok(!A.roster().rooms.some((x) => x.id === "other-game"), "a bad team leaves nothing half-built");
});
test("parts are bucketed: team templates, and spin-outs that name what they extend and where they came from", () => {
  for (const m of M.MODULES.filter((x) => !x.always)) assert.ok(M.GROUPS.includes(m.group), `${m.id}: ${m.group}`);
  const wow = M.MODULES.find((m) => m.id === "wow");
  assert.equal(wow.group, "Spin-outs");
  assert.equal(wow.extends, "games");
  assert.ok(wow.spunOutOf);
  for (const m of M.MODULES.filter((x) => x.extends)) assert.ok(M.MODULES.some((b) => b.id === m.extends), `${m.id} extends a real part`);
});
