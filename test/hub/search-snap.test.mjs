// Campus search snap (the owner 2026-11-15: "when a search result is selected, the view should snap to it"). Source-level
// checks: the pick handler calls the snap, the snap covers 2D, 3D (the existing camera API) and Neural, reduced motion
// jumps instead of gliding, the "Found: <name>" label is there (a word, not just a colour), and the new top-level names
// don't clash with another campus file (they share one global scope).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { APP } from "./helper.mjs";

const read = (f) => fs.readFileSync(`${APP}/${f}`, "utf8");
const control = read("public/campus/control.js"), main3d = read("public/campus/3d/main3d.js"), html = read("public/campus.html");
const fn = (src, name) => { const i = src.indexOf(`function ${name}(`); assert.ok(i >= 0, `${name} exists`); const j = src.indexOf("\nfunction ", i + 10); return src.slice(i, j < 0 ? undefined : j); };

test("picking a search result calls the snap, after closing the box and dropping the keyboard", () => {
  const find = fn(control, "renderFind");
  assert.match(find, /ctlSnapPick\(h\)/);
  assert.match(find, /s\.blur\(\)/, "the phone keyboard closes so the target is not under it");
  const pick = fn(control, "ctlSnapPick");
  assert.match(pick, /h\.go\(\)/, "the panel still opens as before");
  assert.match(pick, /Found: \$\{h\.label\}/, "the toast names what was found");
});

test("the snap handles 2D, 3D and Neural", () => {
  const pick = fn(control, "ctlSnapPick");
  assert.match(pick, /ctlSnap3d/); assert.match(pick, /ctlSnap2d/); assert.match(pick, /ctlSnapNeural/);
  assert.match(fn(control, "ctlSnap3d"), /campus3d|\bc\.focus\(/, "3D uses window.campus3d, not a second camera");
  assert.match(main3d, /focus\(id, \{ calm/, "campus3d.focus exists");
  assert.match(main3d, /glideTo\(c, dist/, "and reuses the glide the camera buttons use");
  assert.match(fn(control, "ctlSnapNeural"), /webPick|n\.a = id/, "Neural picks the worker");
});

test("2D centres the target in what the open panel leaves free, using the panel's size", () => {
  const f = fn(control, "ctlSnap2d");
  assert.match(f, /offsetWidth/); assert.match(f, /offsetHeight/);
  assert.match(f, /cam\.x/); assert.match(f, /cam\.z/);
});

test("reduced motion jumps instead of animating, and the ring stays still", () => {
  assert.match(control, /prefers-reduced-motion: reduce/);
  assert.match(fn(control, "ctlSnap2d"), /if \(calm\) put\(1\)/);
  assert.match(main3d, /calm \? 1 : 650/);
  assert.match(html, /\.ctl-ring\.calm \{ animation: none/);
});

test("the highlight is a dashed outline for about two seconds, and results scroll on a small screen", () => {
  assert.match(html, /\.ctl-ring \{[^}]*border: 3px dashed/);
  assert.match(fn(control, "ctlPulse"), /< 2000/);
  assert.match(html, /\.ctl-find \{ max-height/);
});

test("results include buildings, floors, workers and jobs", () => {
  const find = fn(control, "renderFind");
  for (const w of ["Building", "Floor", "Worker", "Job"]) assert.ok(find.includes(w), w);
});

test("the new top-level names are used in no other campus file", () => {
  const mine = ["ctlSnapAnim", "ctlRing", "ctlCalm", "ctlSnapPick", "ctlSnapNeural", "ctlSnap3d", "ctlSnap2d", "ctlPulse"];
  // a `let a = 0, b = null;` line counts for every name on it
  const decl = (n) => new RegExp(`^(?:(?:async\\s+)?(?:const|let|var|function)\\s+${n}\\b|let [^;\\n]*, ${n} = )`, "gm");
  for (const f of fs.readdirSync(`${APP}/public/campus`).filter((n) => n.endsWith(".js"))) {
    const src = read(`public/campus/${f}`);
    for (const n of mine) { const c = (src.match(decl(n)) || []).length; assert.equal(c, f === "control.js" ? 1 : 0, `${f}: ${n}`); }
  }
});

test("a queued job in the Working panel can be removed, not only pushed (the owner 2026-11-16)", () => {
  const src = fs.readFileSync(`${APP}/public/campus/control.js`, "utf8");
  assert.match(src, /data-push="\$\{esc\(x\.j\.id\)\}"[^`]*Push<\/button> <button class="ctl-btn" data-jobremove="\$\{esc\(x\.j\.id\)\}"/);
  assert.match(src, /for \(const b of g\.querySelectorAll\("\[data-jobremove\]"\)\)/);
  assert.match(src, /confirmBox\(\{ title: "Remove this job from the queue\?"/);
  assert.match(src, /\/agents\/job\/\$\{b\.dataset\.jobremove\}\/cancel/);
  assert.ok(/x\.j\?\.status === "queued" \?/.test(src), "the button only shows for a job that has not started");
});
