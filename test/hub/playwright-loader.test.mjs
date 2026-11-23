// src/addons/playwright.js: playwright comes from addons/browser/node_modules first (a stand-in package here), and a
// missing playwright gives the plain "npm run addons:install" message. No real browser, no install.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP } from "./helper.mjs";
import { pathToFileURL } from "node:url";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pwloader-"));
const pkg = path.join(root, "addons", "browser", "node_modules", "playwright");
fs.mkdirSync(pkg, { recursive: true });
fs.writeFileSync(path.join(root, "addons", "browser", "package.json"), JSON.stringify({ name: "x", private: true }));
fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "playwright", version: "9.9.9", main: "index.js", exports: { ".": "./index.js", "./package.json": "./package.json" } }));
fs.writeFileSync(path.join(pkg, "index.js"), "module.exports = { chromium: { standIn: true } };\n");
process.env.HUB_TEST_ROOT = root;
const { loadPlaywright, playwrightVersion } = await import(pathToFileURL(path.join(APP, "src", "addons", "playwright.js")).href);

test("the browser add-on's playwright is the one that loads, and its version is reported", async () => {
  const pw = await loadPlaywright();
  assert.deepEqual(pw.chromium, { standIn: true });
  assert.equal(await loadPlaywright(), pw, "cached");
  assert.equal(playwrightVersion(), "9.9.9");
});

test("with playwright hidden (tests only) it says how to install it, and no version is reported", async () => {
  process.env.HUB_TEST_NO_PLAYWRIGHT = "1";
  try {
    await assert.rejects(loadPlaywright(), /Browser automation isn't installed\. Run: npm run addons:install/);
    assert.equal(playwrightVersion(), null);
  } finally { delete process.env.HUB_TEST_NO_PLAYWRIGHT; }
});
