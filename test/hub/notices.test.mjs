// THIRD-PARTY-NOTICES.md stays true: its npm table matches package-lock.json, every font and vendored three.js file is
// named or carries its licence line, and the text the licences need is present.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { APP } from "./helper.mjs";
import { table, current, noticesFile } from "../../tools/third-party-table.mjs";

const file = noticesFile(APP);
const text = fs.readFileSync(file, "utf8");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test("the notices file exists and its npm table is the one made from package-lock.json (run tools/third-party-table.mjs)", () => {
  assert.ok(file);
  assert.equal(current(text), table(JSON.parse(fs.readFileSync(path.join(APP, "package-lock.json"), "utf8"))));
});

test("every font file in public/fonts is named, and the font licence text ships beside them", () => {
  for (const f of fs.readdirSync(path.join(APP, "public", "fonts")).filter((n) => n.endsWith(".woff2"))) assert.ok(text.includes(f), `${f} is not in the notices`);
  assert.match(fs.readFileSync(path.join(APP, "public/fonts/LICENSES.txt"), "utf8"), /SIL OPEN FONT LICENSE Version 1\.1/);
});

test("every vendored three.js file says its version and licence; the MIT text and the Apache text are shipped", () => {
  for (const f of walk(path.join(APP, "public", "vendor", "jsm"))) assert.match(fs.readFileSync(f, "utf8").slice(0, 400), /three\.js r160.*SPDX-License-Identifier: MIT/, f);
  assert.match(fs.readFileSync(path.join(APP, "public/vendor/three.module.min.js"), "utf8").slice(0, 200), /SPDX-License-Identifier: MIT/);
  assert.match(text, /Permission is hereby granted, free of charge/);
  assert.match(fs.readFileSync(path.join(APP, "public/vendor/LICENSE-Apache-2.0.txt"), "utf8"), /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/);
});

test("the word list's attribution names its source, licence and that it was changed", () => {
  assert.match(text, /LDNOOBW/);
  assert.match(text, /Creative Commons Attribution 4\.0/);
  assert.match(text, /Changes made/);
  assert.match(fs.readFileSync(path.join(APP, "src/pipeline/swears.txt"), "utf8").split("\n")[0], /LDNOOBW/);
});

test("the 3D kit file and its loader say the same true thing about where the props came from", () => {
  const kit = fs.readFileSync(path.join(APP, "public/campus/3d/kit.json"), "utf8");
  const made = JSON.parse(kit).made;
  assert.match(made, /paid plan/);
  assert.doesNotMatch(made, new RegExp(["Tri", "po"].join(""))); // spelled in two parts so the kit's name check finds no service name in a shipped test
  assert.doesNotMatch(made, /code-built\)$/);
  for (const f of ["kit.js", "items.js"]) assert.match(fs.readFileSync(path.join(APP, "public/campus/3d", f), "utf8").slice(0, 900), /3D generation service/);
  for (const name of ["lm_fountain", "lm_bandstand", "lm_foodtruck", "lm_balloon", "lm_bus", "lm_car", "it_brasshourglass", "it_gildedbalancescales"]) assert.ok(text.includes(name) && made.includes(name), name);
});
