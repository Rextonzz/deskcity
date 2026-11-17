#!/usr/bin/env node
// Sets the kit's version in every place it lives, and nowhere else.
//   node tools/bump-kit-version.mjs <version> [--root <folder>] [--dry]
//
// The places (found with a search for the current version, 2026-11-16):
//   hub.defaults.json    "kit": { "version": ... }      what the hub tells its pages
//   package.json         "version"                      the exported package takes this as it is
//   package-lock.json    "version" and packages[""].version
// Refuses anything that is not a semantic version (1.2.3, or 1.2.3-rc.1). It changes nothing unless all three files can be
// updated and still parse. It does not commit and does not tag: the checklist (docs/release-checklist.md) says when.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

// Replace the first n `"version": "..."` values (in file order), keeping the rest of the text exactly as it is.
function setVersions(text, version, n, from = 0) {
  let i = 0;
  return text.replace(/("version"\s*:\s*")[^"]*(")/g, (m, a, b, off) => (off >= from && i++ < n ? `${a}${version}${b}` : m));
}

export function bumpKitVersion(version, root = APP, { dry = false } = {}) {
  if (!SEMVER.test(String(version || ""))) throw new Error(`"${version}" is not a version like 1.2.3 (or 1.2.3-rc.1).`);
  const file = (f) => path.join(root, f);
  const read = (f) => { try { return fs.readFileSync(file(f), "utf8"); } catch { throw new Error(`${f} is not in ${root}.`); } };
  const next = {};
  // hub.defaults.json: only the version inside the "kit" block
  const defs = read("hub.defaults.json");
  const kit = defs.match(/"kit"\s*:\s*\{[^}]*\}/);
  if (!kit || !/"version"/.test(kit[0])) throw new Error('hub.defaults.json has no "kit" block with a "version".');
  next["hub.defaults.json"] = defs.replace(kit[0], setVersions(kit[0], version, 1));
  next["package.json"] = setVersions(read("package.json"), version, 1);
  // package-lock.json: the first "version" is the package's own, the next one is packages[""]
  const lockText = read("package-lock.json");
  next["package-lock.json"] = setVersions(lockText, version, 2);
  // check every result before writing anything
  const was = {};
  for (const [f, t] of Object.entries(next)) {
    let j;
    try { j = JSON.parse(t); } catch { throw new Error(`${f} would not parse after the change; nothing was written.`); }
    was[f] = JSON.parse(read(f));
    const got = f === "hub.defaults.json" ? [j.kit?.version] : f === "package.json" ? [j.version] : [j.version, j.packages?.[""]?.version];
    if (!got.every((v) => v === version)) throw new Error(`${f}: the version was not found where expected; nothing was written.`);
  }
  const changed = [];
  for (const [f, t] of Object.entries(next)) {
    const old = f === "hub.defaults.json" ? was[f].kit.version : was[f].version;
    changed.push({ file: f, from: old, to: version });
    if (!dry) fs.writeFileSync(file(f), t);
  }
  return changed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const ri = args.indexOf("--root");
  const root = ri >= 0 ? path.resolve(args[ri + 1]) : APP;
  const version = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--root");
  if (!version) { console.error("Usage: node tools/bump-kit-version.mjs <version> [--root <folder>] [--dry]"); process.exit(2); }
  try {
    const dry = args.includes("--dry");
    for (const c of bumpKitVersion(version, root, { dry })) console.log(`${dry ? "would set" : "set"} ${c.file}: ${c.from} -> ${c.to}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
