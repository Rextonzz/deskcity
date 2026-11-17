// A restart first fast-forwards the hub folder to GitHub's main (no GitHub Desktop needed).
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { APP, app } from "./helper.mjs";

const R = await import(app("src/pipeline/restart.js"));
const fake = (answers) => { const calls = []; return { calls, run: (a) => { calls.push(a.join(" ")); const k = Object.keys(answers).find((x) => a.join(" ").startsWith(x)); return answers[k] ?? { status: 0, stdout: "" }; } }; };

test("on main it pulls fast-forward only and says what moved", () => {
  let n = 0;
  const f = fake({ "rev-parse --abbrev-ref": { status: 0, stdout: "main\n" }, "pull": { status: 0 } });
  const run = (a) => (a.join(" ") === "rev-parse --short HEAD" ? { status: 0, stdout: n++ ? "bbb" : "aaa" } : f.run(a));
  const out = R.pullMain(run);
  assert.equal(out.done, true);
  assert.equal(out.note, "Pulled aaa → bbb.");
  assert.ok(f.calls.includes("pull --ff-only origin main"));
});
test("on another branch, or when the pull fails, it leaves the folder alone", () => {
  const off = fake({ "rev-parse --abbrev-ref": { status: 0, stdout: "feature\n" } });
  assert.match(R.pullMain(off.run).note, /on feature, not main/);
  assert.equal(off.calls.some((c) => c.startsWith("pull")), false);
  const bad = fake({ "rev-parse --abbrev-ref": { status: 0, stdout: "main" }, "pull": { status: 1, stderr: "hint: x\nfatal: Not possible to fast-forward, aborting." } });
  const out = R.pullMain(bad.run);
  assert.equal(out.done, false);
  assert.match(out.note, /fatal: Not possible to fast-forward/);
});

test("when local changes block the pull, the note names the files", () => {
  const f = fake({ "rev-parse --abbrev-ref": { status: 0, stdout: "main" }, "pull": { status: 1, stderr: "error: Your local changes to the following files would be overwritten by merge:\n\tCHANGELOG.json\nPlease commit your changes or stash them before you merge.\nAborting" } });
  const out = R.pullMain(f.run);
  assert.equal(out.done, false);
  assert.match(out.note, /uncommitted changes in CHANGELOG.json/);
});

test("the app info names a start script only when the folder has one (a fresh kit has none: npm start)", async () => {
  const fs = await import("node:fs");
  const { resolvePath } = await import(app("src/pipeline/util.js"));
  const has = ["start-pipeline.cmd", "start-pipeline.sh"].find((f) => fs.existsSync(resolvePath(f))) || null;
  assert.equal(R.appInfo().starter, has);
  assert.equal(R.starterFile(), has);
  if (!R.supervised()) assert.match(R.restartApp().message, has ? new RegExp(has.replace(".", "\.")) : /npm start/);
});
