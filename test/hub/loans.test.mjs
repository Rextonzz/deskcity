// Lending workers between projects: the lending project's lead is always the one asked and on the approval board.
// (Guilds and their heads were removed in clean-up F15; an old roster that still holds them must be ignored.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { hub } from "./helper.mjs";

const ROOMS = [{ id: "hub", name: "Hub" }, { id: "hr", name: "HR" }, { id: "game", name: "Game", status: "active" }, { id: "art", name: "Art", status: "active" }];
const desk = (id, room, role, extra = {}) => ({ id, room, role, lead: false, provider: "claude", model: "claude-haiku-5-5", status: "active", ...extra });
const DESKS = [
  desk("hr", "hr", "HR", { lead: true }),
  desk("game-lead", "game", "Project lead", { lead: true }),
  desk("game-artist", "game", "Pixel artist"),
  desk("art-lead", "art", "Project lead", { lead: true }),
  desk("art-designer", "art", "Designer", { guild: "design" }),
  desk("art-painter", "art", "Painter"),
];

const { A, data } = await hub({ rooms: ROOMS, desks: DESKS });
// an old roster that still has a guild with a head (the head sits in another project)
fs.writeFileSync(data("roster.json"), JSON.stringify({ rooms: ROOMS, desks: DESKS, guilds: { design: { head: "game-artist" } } }));

test("a borrow ask goes to the lending project's lead, even if the old roster names a guild head", () => {
  const req = A.askLoan({ desk: "art-designer", hours: 2, why: "maps" }, "game-lead");
  assert.equal(req.ownerLead, "art-lead");
  assert.equal(req.ownerRoom, "art");
  assert.equal(A.inbox({ desk: "art-lead" }).filter((m) => m.kind === "loan ask").length, 1, "the ask waits in art-lead's inbox");
  assert.equal(A.texts().filter((t) => t.to === "art-lead" && /borrow art-designer/.test(t.text)).length, 1);
  assert.equal(A.texts().filter((t) => t.to === "game-artist").length, 0, "the old guild head hears nothing");
});

test("the lending lead can answer, and the loan runs", () => {
  const req = A.requests({ open: true }).find((q) => q.kind === "borrow" && q.desk === "art-designer");
  assert.throws(() => A.answerLoan({ desk: "game-artist", request: req.id, decision: "approved" }), /Only art-lead can answer/);
  A.answerLoan({ desk: "art-lead", request: req.id, decision: "approved", note: "ok" });
  const loan = A.activeLoans().find((l) => l.desk === "art-designer");
  assert.equal(loan.lentBy, "art-lead");
  assert.equal(loan.toRoom, "game");
});

test("the board for a loan or a hire is HR and the project's lead", () => {
  const r = A.roster();
  assert.deepEqual(A.boardMembers({ kind: "borrow", room: "game", ownerRoom: "art", desk: "art-designer" }, r), ["hr", "art-lead"]);
  assert.deepEqual(A.boardMembers({ kind: "staff", room: "game", role: "Designer for the maps" }, r), ["hr", "game-lead"]);
});

test("a hand-off into another project asks that project's lead", async () => {
  const out = await A.autoHandOff({ from: "game-lead", to: "art-designer", text: "Draw the title screen" });
  assert.equal(out.waitingOn, "art-lead");
  assert.equal(A.requests({ open: true }).find((q) => q.id === out.asked).ownerLead, "art-lead");
});

test("askLoan and a cross-room hand-off file a borrow request with the same fields", async () => {
  const strip = ({ id, at, ...rest }) => (assert.ok(id && at), rest);
  const loan = strip(A.askLoan({ desk: "art-painter", hours: 3, why: "icons" }, "game-lead"));
  assert.deepEqual(loan, { kind: "borrow", room: "game", from: "game-lead", role: "Borrow art-painter for 3 h", why: "icons", desk: "art-painter", ownerRoom: "art", ownerLead: "art-lead", hours: 3, urgency: "normal" });
  assert.throws(() => A.askLoan({ desk: "art-lead" }, "game-lead"), /Leads can't be lent/);
  const out = await A.autoHandOff({ from: "game-lead", to: "art-designer", text: "Draw the logo" });
  const { status, hr, decision, history, ...fields } = strip(A.requests().find((q) => q.id === out.asked));
  assert.deepEqual(fields, { kind: "borrow", room: "game", from: "game-lead", role: "Hand-off to art-designer (art)", why: "Draw the logo", desk: "art-designer", ownerRoom: "art", ownerLead: "art-lead", hours: 2, urgency: "normal", handoff: { from: "game-lead", job: null, to: "art-designer", text: "Draw the logo", result: null } });
});

test("findJob rejects a bad id and an unknown id, and finds a real one", async () => {
  assert.throws(() => A.findJob("../x"), /Unknown job\./);
  assert.throws(() => A.findJob("0123456789abcdef"), /Unknown job\./);
  const job = await A.addJob({ desk: "game-artist", text: "Draw a tree" });
  assert.equal(A.findJob(job.id).text, "Draw a tree");
  assert.throws(() => A.updateJob("nope", { status: "done" }), /Unknown job\./);
  await assert.rejects(() => A.runJob("nope"), /Unknown job\./);
  assert.throws(() => A.dismissJob("nope"), /Unknown job\./);
});

test("the page data has no guilds", () => {
  const ov = A.agentsOverview();
  assert.equal("guilds" in ov, false);
  assert.ok(ov.desks.every((d) => !("guildId" in d)));
});
