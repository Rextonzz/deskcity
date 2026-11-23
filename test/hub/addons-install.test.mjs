// tools/addons-install.mjs --dry-run (npm run addons:install): which add-on folders it would install, against a throwaway
// folder with fake add-ons. A dry run runs nothing, so npm is never started and no node_modules is made.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { APP } from "./helper.mjs";

// The kit leaves out the files some parts need (python/), so those parts can't be on there; test only the ones this copy has.
const { MODULES, notIncluded } = await import(pathToFileURL(path.join(APP, "src", "hub", "modules.js")).href);
const included = (id) => !notIncluded(MODULES.find((m) => m.id === id));

const TOOL = path.join(APP, "tools", "addons-install.mjs");

// A throwaway hub folder: fake add-ons (alpha: on, beta: off, gamma: on but nothing to install, browser: off) and the settings.
function world(settings) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "addons-install-"));
  for (const id of ["alpha", "beta", "gamma", "browser"]) {
    const dir = path.join(root, "addons", id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "addon.json"), JSON.stringify({ id, name: id, hubApi: 1, entry: "index.js" }));
    fs.writeFileSync(path.join(dir, "index.js"), "export default {};\n");
    if (id !== "gamma") fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: `fake-${id}`, private: true, dependencies: {} }));
  }
  const file = path.join(root, "settings.json");
  fs.writeFileSync(file, JSON.stringify(settings));
  return { root, file };
}
const dry = ({ root, file }) => {
  const env = { ...process.env, HUB_TEST_ROOT: root, HUB_TEST_SETTINGS: file };
  for (const k of Object.keys(env)) if (/(_KEY|_TOKEN|_SECRET|PASSWORD)/i.test(k)) delete env[k];
  return execFileSync(process.execPath, [TOOL, "--dry-run"], { env, encoding: "utf8" });
};
const lines = (out, word) => out.split("\n").filter((l) => l.trim().startsWith(`${word} `)).map((l) => l.trim().split(":")[0]);
const noModules = (root) => ["alpha", "beta", "gamma", "browser"].every((id) => !fs.existsSync(path.join(root, "addons", id, "node_modules")));

test("on add-ons are planned; off ones are skipped; an add-on with no package.json is not listed; nothing runs", () => {
  const w = world({ modules: [], addonFolders: { on: ["alpha", "gamma"] } });
  const out = dry(w);
  assert.deepEqual(lines(out, "install"), ["install alpha"]);
  assert.deepEqual(lines(out, "skip"), ["skip beta", "skip browser"]);
  assert.ok(!/gamma/.test(out), "gamma has no package.json");
  assert.match(out, /Dry run: nothing was run/);
  assert.ok(noModules(w.root));
});

test("browser is planned while the YouTube part is on, or the cards part, even when the add-on itself is off", { skip: !["youtube", "cards"].some(included) && "neither part is in this copy (the kit)" }, () => {
  for (const part of ["youtube", "cards"].filter(included)) {
    const w = world({ modules: [part], addonFolders: { on: ["alpha"] } });
    const out = dry(w);
    assert.deepEqual(lines(out, "install"), ["install alpha", "install browser"], part);
    assert.deepEqual(lines(out, "skip"), ["skip beta"], part);
    assert.match(out, /browser: needed by/);
    assert.ok(noModules(w.root));
  }
});

test("browser is skipped when no part that needs it is on and it is not switched on", () => {
  const w = world({ modules: ["games", "todo"], addonFolders: { on: [] } });
  const out = dry(w);
  assert.deepEqual(lines(out, "install"), []);
  assert.deepEqual(lines(out, "skip"), ["skip alpha", "skip beta", "skip browser"]);
});

test("a switched-on browser add-on is planned on its own", () => {
  const w = world({ modules: [], addonFolders: { on: ["browser"] } });
  assert.deepEqual(lines(dry(w), "install"), ["install browser"]);
});
