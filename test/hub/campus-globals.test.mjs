// public/campus/*.js share one global scope with boot.js, which puts esc, api, ago,
// ageText, money and spend on window. A top-level declaration with one of those
// names would replace the window version when the file loads.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub, APP } from "./helper.mjs";

await hub();
const BAD = ["esc", "api", "ago", "ageText", "money", "spend", "confirmBox"];
const re = new RegExp(`^(?:async\\s+)?(?:const|let|var|function\\*?)\\s+(${BAD.join("|")})\\b`, "gm");

test("no campus file declares a top-level name boot.js puts on window", () => {
  const dir = path.join(APP, "public/campus");
  const hits = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of src.matchAll(re)) hits.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(hits, []);
});
