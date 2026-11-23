// Installs the packages of the add-ons that are switched on: `npm run addons:install` (Deskcity 0.2.0).
//   npm run addons:install              for each addons/<id>/ with a package.json that is switched on, run npm ci there
//   npm run addons:install -- --dry-run print the plan and run nothing
// An add-on is switched on in the hub settings (addonFolders.on). The "browser" add-on (playwright) is also installed while a
// part that needs it is on: the YouTube and TikTok part or the trading cards part (its deal watch). It uses the add-on's
// package-lock.json (npm ci --ignore-scripts --omit=dev), or npm install when there is none. The core node_modules is never touched.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { addonsRoot, addonSettings, discover } from "../src/addons/loader.js";
import { hubSettings } from "../src/hub/settings.js";
import { moduleOn } from "../src/hub/modules.js";

// add-on id -> the parts that need it
const NEEDED_BY = { browser: [["youtube", "the YouTube and TikTok part"], ["cards", "the trading cards part (deal watch)"]] };

// The plan: [{ id, dir, install: true|false, why }] for every add-on folder that has a package.json.
export function plan() {
  const root = addonsRoot(), on = addonSettings().on, s = hubSettings();
  const out = [];
  for (const a of discover().addons) {
    if (!fs.existsSync(path.join(root, a.id, "package.json"))) continue;
    const need = (NEEDED_BY[a.id] || []).find(([part]) => moduleOn(part, s));
    const why = on.includes(a.id) ? "switched on" : need ? `needed by ${need[1]}` : null;
    out.push({ id: a.id, dir: path.join(root, a.id), install: !!why, why: why || "switched off" });
  }
  return out;
}

function install(dir) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/(_KEY|_TOKEN|_SECRET|PASSWORD)/i.test(k)) env[k] = v;
  const args = fs.existsSync(path.join(dir, "package-lock.json")) ? ["ci", "--ignore-scripts", "--omit=dev"] : ["install", "--ignore-scripts", "--omit=dev"];
  const r = spawnSync("npm", args, { cwd: dir, env, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 20 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  return { args, ok: r.status === 0, err: String(r.stderr || r.stdout || r.error?.message || "").trim().split("\n").slice(-3).join(" | ") };
}

export function main(argv = process.argv.slice(2), log = console.log) {
  const dry = argv.includes("--dry-run");
  const steps = plan();
  if (!steps.length) { log("Add-on packages: no add-on has packages to install."); return 0; }
  log(dry ? "Add-on packages (dry run, nothing will be run):" : "Add-on packages:");
  for (const st of steps) log(st.install ? `  install ${st.id}: ${st.why}` : `  skip ${st.id}: ${st.why}`);
  if (dry) { log("Dry run: nothing was run."); return 0; }
  let failed = 0;
  for (const st of steps.filter((x) => x.install)) {
    log(`Installing ${st.id} (npm ${fs.existsSync(path.join(st.dir, "package-lock.json")) ? "ci" : "install"} --ignore-scripts --omit=dev)...`);
    const r = install(st.dir);
    if (r.ok) log(`  ${st.id}: done.`); else { failed++; log(`  ${st.id}: FAILED (${r.err}).`); }
  }
  if (failed) { log(`${failed} add-on(s) did not install. Fix the cause above (often no internet) and run: npm run addons:install`); return 1; }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
