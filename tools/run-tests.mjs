#!/usr/bin/env node
// npm test: runs every test/**/*.test.mjs with node --test. The file list is made here because the glob form of
// `node --test "test/**/*.test.mjs"` needs Node 21 or newer, and the hub supports Node 20.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.test\.mjs$/.test(e.name) ? [path.join(d, e.name)] : []));
const files = walk(path.join(ROOT, "test")).sort().map((f) => path.relative(ROOT, f));
const r = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files], { cwd: ROOT, stdio: "inherit" });
process.exit(r.status ?? 1);
