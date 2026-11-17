// Access grants: what a worker's own session may use, set per worker.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { hub, ROOMS, DESKS, APP, app } from "./helper.mjs";

const { A } = await hub({ rooms: ROOMS, desks: DESKS });
const G = await import(app("src/pipeline/grants.js"));

test("nothing is granted by default", () => {
  const lead = A.roster().desks.find((d) => d.id === "game-lead");
  assert.deepEqual(G.grantRules(lead), { ids: [], allow: [], notes: [] });
});
test("the catalogue offers code, Godot and web, and the pages get labels without the rules", () => {
  const ids = A.agentsOverview().grants.map((g) => g.id);
  for (const id of ["code", "godot", "web"]) assert.ok(ids.includes(id), id);
  assert.equal(A.agentsOverview().grants.some((g) => "allow" in g), false);
});
test("Blender, media and Android tools can be granted too", () => {
  const cat = G.grantCatalogue();
  for (const [id, rule] of [["blender", "Bash(blender *)"], ["media", "Bash(ffmpeg *)"], ["media", "Bash(magick *)"], ["android", "Bash(adb *)"]]) assert.ok(cat[id].allow.includes(rule), rule);
  assert.equal(Object.values(cat).flatMap((g) => g.allow).some((x) => /,/.test(x)), false);
});
test("running code includes the project's own scripts, with settings in front", () => {
  const allow = G.grantCatalogue().code.allow;
  for (const rule of ["Bash(bash *)", "Bash(tools/*)", "Bash(scripts/*)", "Bash(./*)", "Bash(*=* tools/*)", "Bash(*=* bash *)"]) assert.ok(allow.includes(rule), rule);
  assert.match(G.grantCatalogue().code.note, /cd into it/);
});
test("downloads covers curl and wget, and says installs still need a yes", () => {
  const g = G.grantCatalogue().downloads;
  for (const rule of ["Bash(curl *)", "Bash(curl:*)", "Bash(wget *)"]) assert.ok(g.allow.includes(rule), rule);
  assert.match(g.note, /Installing or running a new program still needs/);
});
test("granting adds the rules and tells the worker; unknown access is refused", () => {
  assert.throws(() => A.setDeskGrants({ id: "game-lead", grants: ["root"] }), /Unknown access/);
  assert.throws(() => A.setDeskGrants({ id: "nobody", grants: ["code"] }), /No such desk/);
  A.setDeskGrants({ id: "game-lead", grants: ["code", "godot"] });
  const lead = A.roster().desks.find((d) => d.id === "game-lead");
  const r = G.grantRules(lead);
  assert.deepEqual(r.ids, ["code", "godot"]);
  for (const rule of ["Bash(node *)", "Bash(python *)", "Bash(npx *)", "Bash(godot *)", "mcp__godot__*"]) assert.ok(r.allow.includes(rule), rule);
  assert.equal(r.allow.some((x) => /,/.test(x)), false, "rules are joined with commas, so none may contain one");
  assert.equal(r.allow.includes("WebSearch"), false);
  assert.equal(r.notes.length, 2);
});
test("other workers are told who has access, so a step they can't do gets handed on", () => {
  const desks = A.roster().desks;
  assert.deepEqual(G.whoCan(desks, "game-lead"), []);
  const line = G.whoCan(desks, "game-artist").find((l) => l.startsWith("game-lead "));
  assert.match(line, /Run its own code, Godot/);
});
test("editing the worker elsewhere keeps its access; taking it away works", () => {
  A.saveDesk({ ...A.roster().desks.find((d) => d.id === "game-lead"), role: "Project lead, renamed" });
  assert.deepEqual(A.roster().desks.find((d) => d.id === "game-lead").grants, ["code", "godot"]);
  A.setDeskGrants({ id: "game-lead", grants: [] });
  assert.equal(A.roster().desks.find((d) => d.id === "game-lead").grants, undefined);
});
test("a worker can't be given access through the ordinary save", () => {
  A.saveDesk({ ...A.roster().desks.find((d) => d.id === "game-artist"), grants: ["code"] });
  assert.equal(A.roster().desks.find((d) => d.id === "game-artist").grants, undefined);
});
