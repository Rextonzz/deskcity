// A part whose required files are missing (the kit does not ship the Python scripts the YouTube and cards parts run) is
// "not included in this kit": no preset offers it, it is never on whatever the settings say, its timers and worker do not
// start, its routes answer so, and Admin and setup say so. HUB_FILES_ROOT points the check at a temp folder.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "./helper.mjs";

const M = await import(app("src/hub/modules.js"));
const bare = fs.mkdtempSync(path.join(os.tmpdir(), "reqbare-"));
const full = fs.mkdtempSync(path.join(os.tmpdir(), "reqfull-"));
for (const f of M.MODULES.flatMap((m) => m.requires || [])) { fs.mkdirSync(path.dirname(path.join(full, f)), { recursive: true }); fs.writeFileSync(path.join(full, f), "# stand-in\n"); }
const withRoot = (root, fn) => { const was = process.env.HUB_FILES_ROOT; process.env.HUB_FILES_ROOT = root; try { return fn(); } finally { if (was === undefined) delete process.env.HUB_FILES_ROOT; else process.env.HUB_FILES_ROOT = was; } };
const EVERYTHING = { modules: M.presetModules("everything", full) };

test("the YouTube and cards parts name the files they need", () => {
  assert.ok(M.MODULES.find((m) => m.id === "youtube").requires.length);
  assert.ok(M.MODULES.find((m) => m.id === "cards").requires.length);
});

test("with the files in place, Everything includes those parts and they run", () => withRoot(full, () => {
  assert.ok(M.presetModules("everything", full).includes("youtube") && M.presetModules("everything", full).includes("cards"));
  assert.ok(M.moduleOn("youtube", EVERYTHING) && M.timerOn("Upload worker", EVERYTHING) && M.timerOn("Deal watch", EVERYTHING));
  assert.deepEqual(M.partsState(EVERYTHING).filter((p) => p.state === "not-included"), []);
}));

test("with the files missing, Everything leaves them out, and settings that list them still don't turn them on", () => withRoot(bare, () => {
  const every = M.presetModules("everything", bare);
  assert.ok(!every.includes("youtube") && !every.includes("cards"));
  assert.ok(every.includes("reading") && every.includes("games"), "parts that need no missing file stay in the preset");
  assert.ok(every.length < M.presetModules("everything", full).length);
  const s = { modules: M.presetModules("everything", full) }; // a settings file that asks for them anyway
  assert.ok(!M.moduleOn("youtube", s) && !M.moduleOn("cards", s));
  assert.ok(M.moduleOn("reading", s));
}));

test("with the files missing, their timers and the upload worker do not start (timerOn is false)", () => withRoot(bare, () => {
  const s = { modules: M.presetModules("everything", full) };
  for (const t of ["Upload worker", "Deal watch", "Card import", "Card prices", "Arena read"]) assert.equal(M.timerOn(t, s), false, t);
  assert.equal(M.timerOn("Reading check", s), true);
}));

test("with the files missing, their pages go to the campus and their routes answer 'not included in this kit'", () => withRoot(bare, () => {
  const s = { modules: M.presetModules("everything", full) };
  assert.ok(M.offPages(s).includes("pipeline") && M.offPages(s).includes("deals"));
  const out = {};
  const res = { status(c) { out.code = c; return this; }, json(b) { out.body = b; } };
  M.gateRoute({ path: "/jobs" }, res, () => { out.next = true; }, s);
  assert.equal(out.code, 404);
  assert.match(out.body.error, /not included in this kit/);
  const out2 = {};
  M.gateRoute({ path: "/reading" }, res, () => { out2.next = true; }, s);
  assert.equal(out2.next, true);
}));

test("Admin's parts list says 'not-included' for them, and 'off' for a part that is merely switched off", () => withRoot(bare, () => {
  const parts = M.partsState({ modules: ["reading"] });
  const by = Object.fromEntries(parts.map((p) => [p.id, p.state]));
  assert.equal(by.youtube, "not-included");
  assert.equal(by.cards, "not-included");
  assert.equal(by.reading, "on");
  assert.equal(by.games, "off");
  assert.deepEqual(M.publicModules({ modules: ["reading"] }).parts, parts);
}));

test("the Admin page asks for a part's routes only when that part is on (no 404s on a hub without it)", () => {
  const src = fs.readFileSync(new URL("../../public/parts/admin.js", import.meta.url), "utf8");
  for (const route of ['api("/health")', 'api("/corrections")']) {
    const at = src.indexOf(route);
    assert.ok(at > 0, route);
    assert.match(src.slice(Math.max(0, at - 400), at), /partOn\("youtube"\)/, `${route} is behind partOn("youtube")`);
  }
});

test("an Admin page script shows the words 'not included in this kit'", () => {
  const src = fs.readFileSync(new URL("../../public/parts/admin.js", import.meta.url), "utf8");
  assert.match(src, /not included in this kit/);
});
