// withPage and uploadPageCheck (src/pipeline/studio/browser.js) against a stand-in Chrome: no real browser is opened.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hub } from "./helper.mjs";

const { root } = await hub();
fs.writeFileSync(path.join(root, "pipeline.config.json"), JSON.stringify({ chromeProfileDir: "chrome-profile" }));
const log = [];
const standIn = () => ({
  setDefaultTimeout() {},
  async screenshot({ path: p, fullPage }) { log.push(["shot", path.basename(p), Boolean(fullPage)]); },
  async close() { log.push(["close"]); },
});
const { chromium } = await import("playwright");
chromium.launchPersistentContext = async () => ({ on() {}, newPage: async () => standIn() });
const { withPage, uploadPageCheck, YT_SIGNED_OUT } = await import("../../src/pipeline/studio/browser.js");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "withpage-"));
test.beforeEach(() => (log.length = 0));

test("the result passes through and the page closes only after fn has finished", async () => {
  const out = await withPage(async () => {
    await new Promise((r) => setTimeout(r, 20));
    log.push(["fn done"]);
    return { id: 7 };
  });
  assert.deepEqual(out, { id: 7 });
  assert.deepEqual(log, [["fn done"], ["close"]]);
});

test("no screenshot when fn succeeds; shot(name) saves into shotsDir with the prefix", async () => {
  await withPage(async (page, shot) => shot("details"), { shotsDir: dir, shotPrefix: "tiktok", fullPage: true });
  assert.deepEqual(log, [["shot", "tiktok-details.png", true], ["close"]]);
});

test("on error: screenshot first, then onError, then the same error is thrown, then close", async () => {
  const boom = new Error("boom");
  const order = [];
  await assert.rejects(
    withPage(async () => { throw boom; }, { shotsDir: dir, shotPrefix: "pin", onError: (e) => { order.push(["onError", e === boom, log.length]); } }),
    (e) => e === boom,
  );
  assert.deepEqual(log, [["shot", "pin-error.png", false], ["close"]]);
  assert.deepEqual(order, [["onError", true, 1]]);
});

test("shotFile is used for the error screenshot when given; no folder means no screenshot", async () => {
  await assert.rejects(withPage(async () => { throw new Error("x"); }, { shotFile: path.join(dir, "check.png") }));
  assert.deepEqual(log, [["shot", "check.png", false], ["close"]]);
  log.length = 0;
  await assert.rejects(withPage(async () => { throw new Error("x"); }));
  assert.deepEqual(log, [["close"]]);
});

test("uploadPageCheck: passes when the box is there, names the page when it is not", async () => {
  const page = (ok) => ({ locator: () => ({ first: () => ({ waitFor: ok ? async () => {} : async () => { throw new Error("timeout"); } }) }) });
  await uploadPageCheck(page(true), "Studio");
  await assert.rejects(uploadPageCheck(page(false), "TikTok Studio"), /^Error: TikTok Studio's upload page has changed: the upload box wasn't where uploads look for it\.$/);
});

test("the YouTube sign-in message keeps the words stats.js stops a pull on", () => {
  assert.match(YT_SIGNED_OUT, /signed in/);
});
