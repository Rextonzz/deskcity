#!/usr/bin/env node
// npm run check: `node --check` on every .js and .mjs file in the app (server.js, src/, tools/, test/, public/), so a
// typo in a file no test loads still shows up before it ships. Needs nothing installed.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", ".git", "data", "output", "inbox", ".claude", ".wt", "References", "reference"]);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (SKIP.has(e.name) ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : /\.(m?js)$/.test(e.name) ? [path.join(d, e.name)] : []));
const files = walk(ROOT);
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  if (r.status !== 0) {
    bad++;
    console.error(`${path.relative(ROOT, f)}\n${(r.stderr || "").trim()}\n`);
  }
}
console.log(`${files.length} files checked, ${bad} with errors`);
process.exit(bad ? 1 : 0);
