// Access grants: what a worker's own session may use, set per worker.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { hub, ROOMS, DESKS, APP, app } from "./helper.mjs";

const { A } = await hub({ rooms: ROOMS, desks: DESKS });
const G = await import(app("src/pipeline/grants.js"));

test("nothing is granted by default", () => {
  const lead = A.roster().desks.find((d) => d.id === "game-lead");
  assert.deepEqual(G.grantRules(lead), { ids: [], allow: [], deny: [], notes: [] });
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

// Job 106c731059 (2026-11-19): the merge queue's grant allowed gh pr merge, but the standard deny list always won.
test("a merge grant opens exactly gh pr merge <N> --merge, nothing else", async () => {
  const { AUTO_DENIED } = await import(app("src/pipeline/agents/autonomy.js"));
  const plain = G.mergeRules(["Bash(gh pr view:*)"], AUTO_DENIED);
  assert.equal(plain.merge, false);
  assert.ok(plain.denied.includes("Bash(gh pr merge:*)"), "no merge grant: merging stays denied");
  const r = G.mergeRules(["Bash(gh pr view:*)", "Bash(gh pr merge:*)", "Bash(gh pr merge *)"], AUTO_DENIED);
  assert.equal(r.merge, true);
  assert.deepEqual(r.allow, ["Bash(gh pr view:*)", ...G.MERGE_ONLY]);
  assert.ok(!r.denied.some((x) => x.startsWith("Bash(gh pr merge:") || x === "Bash(gh pr merge *)"), "the blanket deny is lifted");
  for (const f of ["--squash", "--rebase", "--admin", "--delete-branch", "--auto", "-s", "-r", "-d"]) assert.ok(r.denied.includes(`Bash(gh pr merge * ${f})`) && r.denied.includes(`Bash(gh pr merge * ${f} *)`), f);
  for (const c of ["gh pr close", "gh api", "rm"]) assert.ok(r.denied.some((x) => x.startsWith(`Bash(${c}`)), `${c} still denied`);
});
test("a worker with a merge grant is told the exact merge command; GitHub checks no longer says it can't merge", () => {
  const cat = G.grantCatalogue();
  assert.doesNotMatch(cat.github.note, /may not merge/i);
  const fake = { allow: ["Bash(gh pr merge:*)"] };
  assert.ok(G.mergeRules(fake.allow, []).merge);
});

// the owner 2026-11-20: one worker with the widest access got most hand-offs; another project desks kept being refused git tidy-ups.
test("whoCan: same project first, then the least busy, then the narrower access; queues shown", () => {
  const desks = [
    { id: "wide", room: "x", status: "active", grants: ["code", "godot", "media", "web"] },
    { id: "narrow", room: "x", status: "active", grants: ["code"] },
    { id: "home", room: "mine", status: "active", grants: ["code"] },
    { id: "gone", room: "x", status: "retired", grants: ["code"] },
    { id: "me", room: "mine", status: "active" },
  ];
  assert.deepEqual(G.whoCan(desks, "me").map((l) => l.split(" ")[0]), ["narrow", "home", "wide"], "no options: narrower access first, then roster order");
  const order = G.whoCan(desks, "me", { room: "mine", waiting: { wide: 0, narrow: 0, home: 3 } });
  assert.deepEqual(order.map((l) => l.split(" ")[0]), ["home", "narrow", "wide"]);
  assert.match(order[0], /^home \(mine, 3 waiting\)/);
  assert.deepEqual(G.whoCan(desks, "me", { waiting: { wide: 0, narrow: 4 } }).map((l) => l.split(" ")[0]), ["home", "wide", "narrow"], "equal load: the narrower access first");
});
test("repo housekeeping: rebase, git rm, worktree remove and gh pr edit; force and base changes stay refused", () => {
  const g = G.grantCatalogue()["repo-tidy"];
  for (const r of ["Bash(git rebase *)", "Bash(git rm *)", "Bash(git worktree remove *)", "Bash(gh pr edit *)", "Bash(git merge --abort:*)"]) assert.ok(g.allow.includes(r), r);
  for (const r of ["Bash(git worktree remove * --force)", "Bash(git rebase * --exec *)", "Bash(gh pr edit * --base *)"]) assert.ok(g.deny.includes(r), r);
  assert.equal(g.allow.some((r) => /git push|git reset|branch -D|gh pr merge/.test(r)), false);
  assert.ok(g.allow.includes("Bash(git checkout --detach *)"), "checkout --detach (job 723510912a)");
  const r = G.grantRules({ grants: ["repo-tidy"] });
  assert.ok(r.deny.includes("Bash(git worktree remove --force *)"));
  assert.equal([...r.allow, ...r.deny].some((x) => /,/.test(x)), false);
});

// Job 723510912a (2026-11-20): ask 95fb39cfdb was approved but nobody got the access, because approving an ask only
// recorded the yes. An ask can now name the access and the desks; approving it turns the access on.
test("an approved access ask turns the access on for the desks it names; a declined one doesn't", async () => {
  const S = await import(app("src/pipeline/agents/assistant.js"));
  assert.throws(() => A.addRequest({ kind: "ask", room: "game", question: "Root?", grant: "root" }, "game-lead"), /Unknown access/);
  A.setDeskGrants({ id: "game-artist", grants: ["web"] });
  const q = A.addRequest({ kind: "ask", room: "game", question: "Repo housekeeping for us?", grant: "repo-tidy", desks: "game-lead,game-artist,nobody" }, "game-lead");
  assert.deepEqual(q.grant, { id: "repo-tidy", desks: ["game-lead", "game-artist"] });
  assert.match(q.needs, /Repo housekeeping/);
  assert.equal(S.decideSpends(q.id, { decision: "approved" }), true, "giving access needs the password");
  const out = await A.decideRequest(q.id, { decision: "approved" });
  assert.equal(out.granted.length, 2);
  const has = (id) => A.roster().desks.find((d) => d.id === id).grants;
  assert.deepEqual(has("game-lead"), ["repo-tidy"]);
  assert.deepEqual(has("game-artist"), ["web", "repo-tidy"], "added to what it had");
  assert.ok(G.grantRules(A.roster().desks.find((d) => d.id === "game-lead")).allow.includes("Bash(git rebase *)"));
  const own = A.addRequest({ kind: "ask", room: "game", question: "Godot?", grant: "godot" }, "game-artist");
  assert.deepEqual(own.grant.desks, ["game-artist"], "defaults to the asker");
  await A.decideRequest(own.id, { decision: "declined" });
  assert.deepEqual(has("game-artist"), ["web", "repo-tidy"]);
  A.setDeskGrants({ id: "game-lead", grants: [] });
  A.setDeskGrants({ id: "game-artist", grants: [] });
});

// the owner 2026-11-20: a yes to "Let X run '<command>'" used to reach the worker but give it nothing, so it was refused
// and asked again. Now the approved command joins that worker's own list.
test("asked commands: plain quoted commands in a permission ask; risky ones are never given by an ask", () => {
  assert.deepEqual(G.askedCommands("Allow pc-builder to run 'git rebase --abort' in .wt? 1 = yes, 2 = no"), ["git rebase --abort"]);
  assert.deepEqual(G.askedCommands("Let it run `git rm a.md` and 'rm -rf x'?"), ["git rm a.md", "rm -rf x"]);
  assert.deepEqual(G.askedCommands("Can we buy 'PixelLab' credits?"), [], "not a permission ask");
  assert.deepEqual(G.askedCommands("Let it run 'git status; rm -rf /'?"), [], "shell operators: not a plain command");
  for (const c of ["git push --force", "git push origin -f", "git reset --hard", "gh pr merge 12 --merge", "rm -rf x", "node x.js", "curl https://x", "git worktree remove a --force"]) assert.ok(G.commandRefused(c), c);
  for (const c of ["git rebase --abort", "git rm a.md", "gh pr edit", "git worktree remove .wt/old"]) assert.equal(G.commandRefused(c), null, c);
});
test("approving the ask gives exactly that command to the worker who asked; no gives nothing; taking it back works", async () => {
  const q = A.addRequest({ kind: "ask", room: "game", question: "Let game-lead run 'git rebase --abort' and 'git push --force'? 1 = yes, 2 = no" }, "game-lead");
  assert.equal(A.decideSpends(q.id, { decision: "approved" }), true, "approving it asks for the password");
  assert.equal(A.decideSpends(q.id, { decision: "declined" }), false);
  const plain = A.addRequest({ kind: "ask", room: "game", question: "Use the blue logo? 1 = yes, 2 = no" }, "game-lead");
  assert.equal(A.decideSpends(plain.id, { decision: "approved" }), false, "an ask with no command needs no password");
  const res = await A.decideRequest(q.id, { decision: "approved" });
  assert.deepEqual(res.allowedCmds.allowed, ["git rebase --abort"]);
  assert.equal(res.allowedCmds.refused[0].cmd, "git push --force");
  const lead = A.roster().desks.find((d) => d.id === "game-lead");
  const r = G.grantRules(lead);
  for (const rule of ["Bash(git rebase --abort)", "Bash(git rebase --abort:*)", "Bash(git rebase --abort *)"]) assert.ok(r.allow.includes(rule), rule);
  assert.equal(r.allow.some((x) => /push/.test(x)), false);
  assert.match(r.notes.join(" "), /git rebase --abort/);
  const no = A.addRequest({ kind: "ask", room: "game", question: "Let game-artist run 'git stash push'? 1 = yes, 2 = no" }, "game-artist");
  await A.decideRequest(no.id, { decision: "declined" });
  assert.equal(A.roster().desks.find((d) => d.id === "game-artist").allowed, undefined);
  A.saveDesk({ ...lead, role: "Lead, renamed" });
  assert.equal(A.roster().desks.find((d) => d.id === "game-lead").allowed.length, 1, "an ordinary save keeps it");
  A.removeAllowedCommand({ id: "game-lead", cmd: "git rebase --abort" });
  assert.equal(A.roster().desks.find((d) => d.id === "game-lead").allowed, undefined);
});
