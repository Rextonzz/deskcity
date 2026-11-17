// Safety net: every server module still loads. `node --check` only reads one file, so it can't see a module that
// imports a name some other change removed; importing them all can. Runs under a throwaway data folder (no network).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hub, APP } from "./helper.mjs";

await hub();

// The command-line set-up scripts run when imported (prompts, writes to .env), so they are left out.
const SKIP = new Set(["signin.js", "twofa.js", "setpassword.js"]);
const modules = fs.readdirSync(path.join(APP, "src"), { recursive: true }).filter((f) => f.endsWith(".js") && !SKIP.has(f)).sort();

test("every module in src/ imports cleanly", async () => {
  // Only proves the recursive walk worked (it reached subfolders such as src/pipeline); a low floor, so deleting modules never trips it.
  assert.ok(modules.some((f) => /[\\/]/.test(f)) && modules.length >= 30, `walk of src/ looks wrong: ${modules.length} modules, subfolders ${modules.some((f) => /[\\/]/.test(f)) ? "found" : "missing"}`);
  const failed = [];
  for (const f of modules) {
    try { await import(pathToFileURL(path.join(APP, "src", f)).href); } catch (err) { failed.push(`src/${f}: ${String(err.message).split("\n")[0]}`); }
  }
  assert.deepEqual(failed, [], `${failed.length} of ${modules.length} modules fail to import`);
});
