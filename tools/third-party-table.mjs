#!/usr/bin/env node
// The npm table in THIRD-PARTY-NOTICES.md (name, version, licence of every package in package-lock.json).
//   node tools/third-party-table.mjs          rewrite the table between the markers, in docs/kit/THIRD-PARTY-NOTICES.md
//                                              (or ./THIRD-PARTY-NOTICES.md in a kit)
//   node tools/third-party-table.mjs --check  exit 1 if the file's table is out of date (npm test runs the same check)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const START = "<!-- npm-table:start (made by tools/third-party-table.mjs from package-lock.json; do not edit by hand) -->";
export const END = "<!-- npm-table:end -->";
export function table(lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"))) {
  const rows = Object.entries(lock.packages || {}).filter(([k]) => k).map(([k, v]) => ({ name: k.replace(/^.*node_modules\//, ""), version: v.version, licence: v.license || "see the package", dev: Boolean(v.dev) }));
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return ["| Package | Version | Licence | Used |", "|---|---|---|---|", ...rows.map((r) => `| ${r.name} | ${r.version} | ${r.licence} | ${r.dev ? "development only" : "runtime"} |`)].join("\n");
}
export const noticesFile = (root = ROOT) => [path.join(root, "THIRD-PARTY-NOTICES.md"), path.join(root, "docs", "kit", "THIRD-PARTY-NOTICES.md")].find((f) => fs.existsSync(f));
export function current(text) {
  const a = text.indexOf(START), b = text.indexOf(END);
  return a >= 0 && b > a ? text.slice(a + START.length, b).replace(/\r\n/g, "\n").trim() : null;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const f = noticesFile();
  const text = fs.readFileSync(f, "utf8");
  const fresh = table();
  if (process.argv.includes("--check")) process.exit(current(text) === fresh ? 0 : (console.error(`${f}: the npm table is out of date: run node tools/third-party-table.mjs`), 1));
  const a = text.indexOf(START), b = text.indexOf(END);
  if (a < 0 || b < a) throw new Error("markers missing");
  fs.writeFileSync(f, text.slice(0, a + START.length) + "\n" + fresh + "\n" + text.slice(b));
  console.log(`Wrote the table (${fresh.split("\n").length - 2} packages) to ${f}`);
}
