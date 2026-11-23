// The 3D campus's saved quality tier is kept with the graphics chip it was measured on (2026-11-20: Chrome on the owner's
// PC drew in software at 7 fps and saved "lowest"; with graphics acceleration back on it must start fresh).
import test from "node:test";
import assert from "node:assert/strict";
import { app } from "./helper.mjs";

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.matchMedia = () => ({ matches: false });
globalThis.screen = { width: 1920, height: 1080 };
globalThis.devicePixelRatio = 1;
const { makeQuality } = await import(app("public/campus/3d/quality.js"));
const renderer = (gpu) => ({ ratio: 0, setPixelRatio(r) { this.ratio = r; }, getContext: () => ({ getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 1 }), getParameter: () => gpu, RENDERER: 2 }) });
const slow = (q) => { let t = 0; for (let i = 0; i < 160; i++) q.frame((t += 40)); };

test("a slow device steps down and remembers it, for the same chip only", () => {
  store.clear();
  const sw = makeQuality(renderer("Microsoft Basic Render Driver"));
  assert.equal(sw.tier.name, "high");
  slow(sw);
  assert.equal(sw.tier.name, "medium");
  assert.equal(makeQuality(renderer("Microsoft Basic Render Driver")).tier.name, "medium", "same chip: remembered");
  assert.equal(makeQuality(renderer("NVIDIA GeForce RTX 4060 Ti")).tier.name, "high", "another chip: starts fresh");
});
test("a tier saved before chips were recorded is ignored; reset forgets both", () => {
  store.clear(); store.set("campus3d.tier", "3");
  const q = makeQuality(renderer("ANGLE (NVIDIA)"));
  assert.equal(q.tier.name, "high");
  slow(q); q.reset();
  assert.equal(store.has("campus3d.tier") || store.has("campus3d.tier.gpu"), false);
});
