// The pages use the hub's own box (lib.js confirmBox) instead of the browser's confirm(), alert() and prompt().
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { APP } from "./helper.mjs";

const pub = path.join(APP, "public");
const files = [];
for (const dir of [pub, path.join(pub, "campus")])
  for (const f of fs.readdirSync(dir)) if (/\.(html|js)$/.test(f)) files.push(path.join(dir, f));
const call = /(?<![\w.$])(confirm|alert|prompt)\(/;

test("no page calls the native confirm(), alert() or prompt()", () => {
  const hits = [];
  for (const f of files) {
    fs.readFileSync(f, "utf8").split(/\r?\n/).forEach((line, i) => { // CRLF on Windows: a "\r" left on a line kept its "// ..." comment from being stripped
      const code = line.replace(/\/\/.*$/, "").replace(/<!--.*?-->/g, "");
      if (call.test(code)) hits.push(`${path.relative(pub, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});
