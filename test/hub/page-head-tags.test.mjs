// Pages no longer carry the home-screen tags; nav.js adds them once for every page.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { APP } from "./helper.mjs";

const pub = path.join(APP, "public");
test("no page carries the manifest, icon or theme-color tags", () => {
  for (const f of fs.readdirSync(pub).filter((n) => n.endsWith(".html"))) {
    const s = fs.readFileSync(path.join(pub, f), "utf8");
    assert.ok(!/rel="manifest"|rel="apple-touch-icon"|name="theme-color"|apple-mobile-web-app-title/.test(s), f);
  }
});
test("nav.js holds the list once, manifest with credentials", () => {
  const s = fs.readFileSync(path.join(pub, "nav.js"), "utf8");
  assert.equal(s.split('rel: "manifest"').length - 1, 1);
  assert.match(s, /rel: "manifest", href: "\/manifest\.json", crossOrigin: "use-credentials"/);
  for (const k of ['name: "theme-color"', 'rel: "icon"', 'rel: "apple-touch-icon"', 'name: "apple-mobile-web-app-title"']) assert.ok(s.includes(k), k);
});
