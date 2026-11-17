// tools/bump-kit-version.mjs on a temp copy of the three files that hold the kit version.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP, app } from "./helper.mjs";

const { bumpKitVersion, SEMVER } = await import(app("tools", "bump-kit-version.mjs"));
const FILES = ["hub.defaults.json", "package.json", "package-lock.json"];
function copy() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "bump-"));
  for (const f of FILES) fs.copyFileSync(path.join(APP, f), path.join(d, f));
  return d;
}
const j = (d, f) => JSON.parse(fs.readFileSync(path.join(d, f), "utf8"));
const dropVersions = (o) => JSON.stringify(o, (k, v) => (k === "version" && typeof v === "string" && /^\d+\.\d+\.\d+(-|$)/.test(v) ? undefined : v));

test("a good version lands in every place and changes nothing else", () => {
  const d = copy();
  const before = Object.fromEntries(FILES.map((f) => [f, JSON.parse(fs.readFileSync(path.join(d, f), "utf8"))]));
  bumpKitVersion("1.2.3-rc.1", d);
  assert.equal(j(d, "hub.defaults.json").kit.version, "1.2.3-rc.1");
  assert.equal(j(d, "package.json").version, "1.2.3-rc.1");
  assert.equal(j(d, "package-lock.json").version, "1.2.3-rc.1");
  assert.equal(j(d, "package-lock.json").packages[""].version, "1.2.3-rc.1");
  assert.equal(dropVersions(j(d, "hub.defaults.json")).length > 0, true);
  for (const f of ["package.json", "package-lock.json"]) assert.equal(dropVersions(j(d, f)), dropVersions(before[f]), `${f}: only the version fields changed`);
  assert.equal(dropVersions({ ...j(d, "hub.defaults.json"), kit: null }), dropVersions({ ...before["hub.defaults.json"], kit: null }));
});

test("a non-semver value is refused and nothing is written", () => {
  const d = copy();
  const before = fs.readFileSync(path.join(d, "package.json"), "utf8");
  for (const bad of ["1.2", "v1.2.3", "01.2.3", "1.2.3.4", "latest", "", "1.2.3; rm -rf"]) assert.throws(() => bumpKitVersion(bad, d), /not a version/, bad);
  assert.equal(fs.readFileSync(path.join(d, "package.json"), "utf8"), before);
  assert.ok(SEMVER.test("0.1.0") && SEMVER.test("10.20.30"));
});

test("--dry changes nothing", () => {
  const d = copy();
  const was = j(d, "package.json").version;
  const r = bumpKitVersion("9.9.9", d, { dry: true });
  assert.equal(r.length, 3);
  assert.equal(j(d, "package.json").version, was);
});
