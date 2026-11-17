// How the campus start-up (public/campus/boot.js) loads its scripts: downloaded together (preload hints), run one at a
// time in the PARTS order, a part that fails to load still stops the rest. Read from the source (no browser here);
// the real page is checked in a browser in the speed PR.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { APP } from "./helper.mjs";

const src = fs.readFileSync(`${APP}/public/campus/boot.js`, "utf8");
const parts = JSON.parse(src.match(/const PARTS = (\[[^\]]*\])/)[1]);

test("every part gets a preload hint before the first one runs", () => {
  const preload = src.indexOf('l.rel = "preload"; l.as = "script"');
  const firstRun = src.indexOf("document.body.appendChild(s)");
  assert.ok(preload > 0 && preload < firstRun);
  assert.match(src, /for \(const name of PARTS\) \{\s*const l = document\.createElement\("link"\)/);
});

test("scripts still run one after another in the listed order, and a load failure still rejects", () => {
  const run = src.slice(src.indexOf("for (const name of PARTS) {\n  await") > 0 ? src.indexOf("for (const name of PARTS) {\n  await") : src.indexOf("for (const name of PARTS) {\r\n  await"));
  assert.match(run, /await new Promise\(\(resolve, reject\) =>/);
  assert.match(run, /s\.onload = resolve/);
  assert.match(run, /s\.onerror = \(\) => reject\(new Error\(`campus part \$\{name\} didn"t load`\)\)/);
  assert.equal(/async\s*=\s*(true|false)/.test(src), false, "ordering comes from awaiting each script, not from async flags");
  assert.equal(parts[0], "/parts/registry.js");
  assert.equal(parts[1], "blocks", "blocks first: its Esc handler must come before the others'");
  assert.equal(parts.at(-1), "main");
});

test("the campus polls pause while the tab is hidden, and the main poll catches up when it shows again", () => {
  const rd = (f) => fs.readFileSync(`${APP}/public/campus/${f}`, "utf8");
  assert.match(rd("main.js"), /setInterval\(\(\) => document\.visibilityState === "visible" && load\(\), 20000\)/, "interval unchanged at 20 s");
  assert.match(rd("main.js"), /addEventListener\("visibilitychange", \(\) => document\.visibilityState === "visible" && load\(\)\)/);
  assert.match(rd("neural.js"), /async function neuralPoll\(\) \{\s*const n = neural; if \(!n\) return;\s*if \(document\.visibilityState === "hidden"\) return;/);
  assert.match(rd("neural.js"), /setInterval\(neuralPoll, 5000\)/);
  assert.match(rd("brain.js"), /if \(!first && document\.visibilityState === "hidden"\) return;/);
  assert.match(rd("brain.js"), /setInterval\(\(\) => brainPoll\(false\), 2000\)/);
});
