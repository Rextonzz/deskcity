// The Sunday summary: still built and saved without the (removed) Ready to test line.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub } from "./helper.mjs";

test("the Sunday summary is built and saved, with no Ready to test line", async () => {
  const { root } = await hub();
  // Phone alerts off in the throwaway folder, so the summary is saved without trying to send anything.
  const { saveNotifySettings } = await import("../../src/pipeline/notify.js");
  saveNotifySettings({ topic: "ytw-test", enabled: false });
  const { sendDigest } = await import("../../src/pipeline/digest.js");
  const { lines } = await sendDigest({ trigger: "test" });
  assert.ok(!lines.some((l) => /ready to test/i.test(l)), lines.join("\n"));
  const saved = JSON.parse(fs.readFileSync(path.join(root, "data", "digest.json"), "utf8"));
  assert.deepEqual(saved.lines, lines);
});
