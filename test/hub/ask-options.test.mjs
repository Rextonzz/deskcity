// the owner 2026-11-20: a question with numbered or lettered choices gets one button per choice on the Waiting card
// (askOptions in public/campus/control.js, a browser script: the function is read out of the file and run here).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { APP } from "./helper.mjs";

const src = fs.readFileSync(`${APP}/public/campus/control.js`, "utf8");
const askOptions = new Function(`${src.slice(src.indexOf("function askOptions"), src.indexOf("async function decideMany"))}; return askOptions;`)();
const keys = (o) => o.options.map((x) => [x.key, x.label, x.pick, x.no]);

test("1 = yes (my pick, reply 1), 2 = no: two buttons, the pick starred, no sent as a no", () => {
  const o = askOptions("Let pc-builder run 'git rebase --abort'? 1 = yes (my pick, reply 1), 2 = no (reply 2)");
  assert.equal(o.stem, "Let pc-builder run 'git rebase --abort'");
  assert.deepEqual(keys(o), [["1", "yes", true, false], ["2", "no", false, true]]);
});
test("lettered and dotted lists, a recommended choice, and the last one stops at its sentence", () => {
  assert.deepEqual(keys(askOptions("Which engine? A) Godot 4.5 B) Godot 4.4 LTS (recommended) C) hold until Monday")),
    [["A", "Godot 4.5", false, false], ["B", "Godot 4.4 LTS", true, false], ["C", "hold until Monday", false, true]]);
  assert.deepEqual(keys(askOptions("Pick: 1. ship today 2. wait for QA 3. skip this release. Also the build is 40 MB.")).map((x) => x[1]), ["ship today", "wait for QA", "skip this release"]);
});
test("no choices, one choice, or numbers that aren't a list: the plain Approve and Reject", () => {
  assert.equal(askOptions("Ship v1.2 now? Release notes ready."), null);
  assert.equal(askOptions("Use option 1 = the old build?"), null);
  assert.equal(askOptions("Version 2.1 is out. Merge PR #12?"), null);
  assert.equal(askOptions(""), null);
});
