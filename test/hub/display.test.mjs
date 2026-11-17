// The display base: what the campus opens on, chosen in setup (src/hub/settings.js, tools/setup.mjs, docs/kit/SETUP.md).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { app, APP } from "./helper.mjs";

const S = await import(app("src/hub/settings.js"));

test("display is 2d, 3d or neural; anything else falls back to 3d", () => {
  assert.deepEqual(S.DISPLAYS, ["2d", "3d", "neural", "pages"]);
  assert.deepEqual(["2d", "3D", "Neural", "Pages", "", null, "4d"].map(S.displayOf), ["2d", "3d", "neural", "pages", "3d", "3d", "3d"]);
});
test("the pages get the display base, and the kit's default is 3d", () => {
  assert.ok(S.DISPLAYS.includes(S.publicSettings().display));
  assert.equal(JSON.parse(fs.readFileSync(`${APP}/hub.defaults.json`, "utf8")).display, "3d");
});
test("setup knows the same three, and the example answers use one of them", () => {
  const setup = fs.readFileSync(`${APP}/tools/setup.mjs`, "utf8");
  assert.match(setup, /const DISPLAYS = \["2d", "3d", "neural", "pages"\]/);
  assert.ok(S.DISPLAYS.includes(JSON.parse(fs.readFileSync(`${APP}/docs/kit/setup-answers.example.json`, "utf8")).display));
});
test("the front door: Pages opens Home (or the Agents page without the Classic pages part); anything else, the campus", async () => {
  const M = await import(app("src/hub/modules.js"));
  // The page is a stub naming the display and the pages home in meta tags; public/front.js does the going (security plan 05).
  const run = (html, saved) => {
    let to = null;
    const localStorage = { getItem: () => saved }, location = { replace: (u) => { to = u; } };
    const document = { querySelector: (q) => { const m = html.match(new RegExp(`<meta name="${q.match(/name="([^"]+)"/)[1]}" content="([^"]*)"`)); return m ? { getAttribute: () => m[1] } : null; } };
    new Function("localStorage", "location", "document", fs.readFileSync(`${APP}/public/front.js`, "utf8"))(localStorage, location, document);
    return to;
  };
  assert.equal(run(M.frontDoorHtml({ display: "pages", modules: ["overview"] }), null), "/home.html");
  assert.equal(run(M.frontDoorHtml({ display: "pages", modules: [] }), null), "/agents.html");
  assert.equal(run(M.frontDoorHtml({ display: "3d", modules: [] }), null), "/campus.html");
  assert.equal(run(M.frontDoorHtml({ display: "3d", modules: [] }), "pages"), "/agents.html", "this device's pick wins");
  assert.equal(run(M.frontDoorHtml({ display: "pages", modules: [] }), "2d"), "/campus.html");
});
test("behind Neural the city is 2D (no three.js, no kit.json) unless 3D is this device's saved pick; View: 3D loads it on demand", () => {
  const boot = fs.readFileSync(`${APP}/public/campus/boot.js`, "utf8");
  const line = boot.match(/^let mode = (display === "neural" \?[^;]*);/m)?.[1];
  assert.ok(line, "boot.js decides the city's renderer in one line");
  const modeFor = (display, saved) => new Function("display", "ls", "RKEY", `return ${line}`)(display, { get: () => saved }, "campus.renderer");
  assert.equal(modeFor("neural", null), "2d", "no saved renderer: 2D behind Neural");
  assert.equal(modeFor("neural", "2d"), "2d");
  assert.equal(modeFor("neural", "3d"), "3d", "3D is this device's pick");
  assert.equal(modeFor("3d", null), "3d", "the 3D view itself is unchanged");
  assert.equal(modeFor("2d", "3d"), "2d");
  // the 3D engine is only ever imported when the city is 3D, and the picker reloads into 3D on demand
  assert.match(boot, /if \(mode === "3d" && webgl\) \{\s*try \{ await import\("\/campus\/3d\/main3d\.js"\)/);
  assert.match(boot, /if \(v !== mode\) location\.href = `\$\{location\.pathname\}\?view=\$\{v\}`/);
});

test("a ?view=neural or ?view=pages link applies to that visit only; 2d and 3d links still save (the View picker reloads with them)", () => {
  const boot = fs.readFileSync(`${APP}/public/campus/boot.js`, "utf8");
  assert.match(boot, /const qView = VIEWS\.includes\(qv\) \? qv : null;/);
  assert.match(boot, /if \(qView === "2d" \|\| qView === "3d"\) \{ ls\.set\(DKEY, qView\); ls\.set\(RKEY, qView\); \}/);
  assert.match(boot, /let display = \[qView, ls\.get\(DKEY\)/);
  assert.ok(!/if \(VIEWS\.includes\(qv\)\) \{ ls\.set\(DKEY, qv\)/.test(boot), "the old line that saved every ?view= is gone");
});
