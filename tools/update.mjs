#!/usr/bin/env node
// Safe update: `npm run update`. Replaces the app's code, never your data.
//   npm run update                         show what an update from git would do (changes nothing)
//   npm run update -- --yes                do it
//   npm run update -- --from-zip <file>    update from a downloaded kit zip (for a folder that is not a git checkout)
//   npm run update -- --rollback           go back to the version from before the last update
//   npm run update -- --check              ask the project's releases address for the newest version (changes nothing)
//
// Rules this keeps (they decide every detail):
//   - data/ and .env are never touched. (data/update-last.json, the note about the last update, is the one file written in data/.)
//   - A backup is taken first. If it fails, nothing else happens.
//   - Nothing goes over the network unless you ask: only a git update (it fetches) and --check do, and --check only when an update address is set.
//   - A failed update puts the old version back, so the hub still starts.
//   - Without --yes it only prints the plan (when run from a terminal it asks "yes/no" instead).
// Git/npm/node calls go through one injectable runner so the tests need no network.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { acquireDataLock } from "../src/hub/datalock.js";
import { readFormat } from "../src/hub/migrations.js";
import { checkForUpdate, compareVersions, parseVersion, readKit } from "../src/hub/updatecheck.js";
import { SECRET_ENV } from "./lib/hub-boot.mjs";

export const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_ALWAYS = (rel) => /^(data|\.git)(\/|$)/.test(rel) || /(^|\/)node_modules(\/|$)/.test(rel) || (/(^|\/)\.env(\.|$)/.test(rel) && !/\.env\.example$/.test(rel)) || /\.env$/.test(rel);
const SETTINGS = "pipeline.config.json"; // the owner's own settings file: tracked, but written by the hub and edited by owners
const KEEP_IF_PRESENT = new Set(["pipeline.config.json"]); // your settings file: a zip update never replaces yours
const today = () => new Date().toISOString().slice(0, 10);

// ---- the runner: every git, npm, node and unzip call goes through here ----
export function realRunner(cmd, args, { cwd } = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!SECRET_ENV.test(k)) env[k] = v;
  env.GIT_TERMINAL_PROMPT = "0";
  const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8", windowsHide: true, shell: process.platform === "win32" && cmd === "npm", timeout: 20 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? 1, stdout: String(r.stdout || ""), stderr: String(r.stderr || r.error?.message || "") };
}

// ---- small helpers ----
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
function writeJson(f, v) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2) + "\n");
  fs.renameSync(tmp, f);
}
const same = (a, b) => (process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));
const noteKey = (n) => `${n.at}|${n.title}`;
export const newNotes = (before, after) => { const had = new Set((before || []).map(noteKey)); return (after || []).filter((n) => !had.has(noteKey(n))); };
const notesText = (notes) => notes.length ? notes.slice(0, 10).map((n) => `  - ${n.title}${(n.changes || []).slice(0, 3).map((c) => `\n      ${String(c).slice(0, 160)}`).join("")}`).join("\n") + (notes.length > 10 ? `\n  ... and ${notes.length - 10} more (see CHANGELOG.json)` : "") : "  (no notes came with it)";
const kitVersionOf = (dir) => readJson(path.join(dir, "hub.defaults.json"), {})?.kit?.version || null;

// Is a hub running on this data folder? Same lock the hub takes, so "running" means what it means everywhere else.
export function hubRunning(dataDir) {
  if (!fs.existsSync(path.join(dataDir, "hub.lock"))) return null;
  try { acquireDataLock(dataDir, { pid: process.pid }).release(); return null; } catch (err) { return err.message; }
}

// The data format the code in `dir` understands (1 for code from before there was a format).
async function codeFormatOf(dir) {
  const f = path.join(dir, "src", "hub", "migrations.js");
  if (!fs.existsSync(f)) return 1;
  try { return (await import(`${pathToFileURL(f).href}?t=${Date.now()}`)).currentFormat(); } catch { return 1; }
}

// A backup through the app's own backup code, without loading .env. Returns { ok, dir?, error? } where dir is the dated folder.
async function defaultBackup() {
  process.env.DOTENV_CONFIG_PATH = path.join(os.tmpdir(), `no-env-${process.pid}`);
  const { runBackup } = await import(pathToFileURL(path.join(APP, "src", "pipeline", "backup.js")).href);
  const s = runBackup({ trigger: "before update" });
  if (!s.ok) return { ok: false, error: s.error || "the backup failed" };
  const latest = fs.existsSync(s.dir) ? fs.readdirSync(s.dir).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort().at(-1) : null;
  return { ok: true, dir: latest ? path.join(s.dir, latest) : s.dir };
}

// ---- a small .gitignore reader, for "copy everything except what the kit's .gitignore ignores" ----
export function parseIgnore(text) {
  const rules = [];
  for (let line of String(text || "").split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    let neg = false;
    if (line.startsWith("!")) { neg = true; line = line.slice(1); }
    const dirOnly = line.endsWith("/");
    line = line.replace(/\/+$/, "");
    const anchored = line.includes("/");
    line = line.replace(/^\//, "");
    const re = new RegExp("^" + line.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*") + "$");
    rules.push({ neg, dirOnly, anchored, re });
  }
  return (rel) => {
    const segs = rel.split("/");
    for (let i = 1; i <= segs.length; i++) {
      const cand = segs.slice(0, i).join("/"), isDir = i < segs.length;
      let ignored = false;
      for (const r of rules) {
        if (r.dirOnly && !isDir) continue;
        if (r.re.test(r.anchored ? cand : segs[i - 1])) ignored = !r.neg;
      }
      if (ignored) return true;
    }
    return false;
  };
}

function listFilesRel(root, out = [], rel = "") {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) listFilesRel(root, out, r); else if (e.isFile()) out.push(r); // links and other odd things are never copied
  }
  return out;
}

function extractZip(zip, dir, run) {
  const tries = [["tar", ["-xf", zip, "-C", dir]], ["unzip", ["-q", zip, "-d", dir]]];
  if (process.platform === "win32") tries.push(["powershell", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`]]);
  for (const [cmd, args] of tries) if (run(cmd, args, {}).status === 0 && fs.readdirSync(dir).length) return;
  throw new Error("Could not unpack the zip (tried tar, unzip and, on Windows, PowerShell). Unzip it yourself into a new folder and run: npm run update -- --from-zip <that folder>");
}

// ---- the tool ----
export async function main(argv, o = {}) {
  const appDir = o.appDir || APP;
  const out = o.out || ((s) => console.log(s));
  const run = o.runner || realRunner;
  const dataDir = path.join(appDir, "data");
  const lastFile = path.join(dataDir, "update-last.json");
  const args = [...argv];
  const has = (f) => args.includes(f);
  const zipAt = args.indexOf("--from-zip");
  const zip = zipAt >= 0 ? args[zipAt + 1] : null;
  const yes = has("--yes");
  const interactive = o.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const ask = o.ask || ((q) => new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(/^y(es)?$/i.test(a.trim())); }); }));
  const git = (...a) => { const r = run("git", a, { cwd: appDir }); return { ok: r.status === 0, out: r.stdout.trim(), raw: r.stdout, err: (r.stderr || "").trim() }; };
  // Core packages, then the add-on packages (npm run addons:install: the browser add-on holds playwright). npm ci wipes node_modules, so
  // the add-on step must follow it; a version without tools/addons-install.mjs (an old one being put back) has no add-on step.
  const npmCi = () => {
    out("Installing packages (npm ci --ignore-scripts)...");
    const r = run("npm", ["ci", "--ignore-scripts"], { cwd: appDir });
    if (r.status !== 0) { out(`npm ci failed: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" | ")}`); return false; }
    if (!fs.existsSync(path.join(appDir, "tools", "addons-install.mjs"))) return true;
    out("Installing add-on packages (npm run addons:install)...");
    const a = run(process.execPath, [path.join("tools", "addons-install.mjs")], { cwd: appDir });
    if (a.stdout.trim()) out(a.stdout.trim());
    if (a.status !== 0) { out(`Add-on packages failed: ${(a.stderr || a.stdout).trim().split("\n").slice(-3).join(" | ")}`); return false; }
    return true;
  };
  const selfCheck = async () => {
    if (o.selfCheck) return o.selfCheck(appDir);
    if (!fs.existsSync(path.join(appDir, "tools", "self-check.mjs"))) { out("Self-check skipped: this version has no tools/self-check.mjs."); return { pass: true }; }
    out("Self-check: starting the new version on a copy of your data...");
    const r = run(process.execPath, ["tools/self-check.mjs"], { cwd: appDir });
    out(r.stdout.trim().split("\n").map((l) => `  ${l}`).join("\n"));
    return { pass: r.status === 0 };
  };
  const doBackup = async () => { out("Taking a backup first..."); const b = await (o.backup || defaultBackup)(); if (!b.ok) out(`The backup failed (${b.error || "unknown reason"}). Nothing was changed. Fix the backup folder and try again.`); else out(`Backup done: ${b.dir || "(see Admin)"}`); return b; };
  const confirm = async () => {
    if (yes) return true;
    if (interactive) return ask("Go ahead? (yes/no) ");
    out("\nThis was a dry run: nothing was changed. Add --yes to do it.");
    return false;
  };
  const refuse = (msg) => { out(msg); return 1; };

  if (has("--help") || has("-h")) { out("Usage: npm run update [-- --yes | --from-zip <file> | --rollback | --check]\n  (no flag)    show what an update would do, change nothing\n  --yes        do it\n  --from-zip   update from a downloaded zip of the kit\n  --rollback   go back to the version from before the last update\n  --check      ask the releases address for the newest version (changes nothing)"); return 0; }

  // --check: the only thing here that is just a question
  if (has("--check")) {
    const kit = readKit(appDir);
    const a = await checkForUpdate({ url: kit.updatesUrl, current: kit.version, fetchFn: o.fetchFn });
    out(`${kit.name} ${kit.version || "(no version)"}: ${a.message}`);
    return a.ok ? 0 : 1;
  }

  const running = hubRunning(dataDir);
  if (running) return refuse(`Stop the hub first. ${running}\nAn update replaces the code the hub is running. Close the window that runs "npm start", then run this again.`);

  if (has("--rollback")) return rollback();
  if (zipAt >= 0) { if (!zip) return refuse("--from-zip needs the zip file (or the unpacked folder): npm run update -- --from-zip <file>"); return zipUpdate(zip); }
  return gitUpdate();

  // ---- git ----
  function changedFiles() { return git("status", "--porcelain", "--untracked-files=no").raw.split("\n").filter(Boolean).map((l) => l.slice(3).trim()); }
  // git reset --hard that puts the owner's own edited pipeline.config.json back afterwards
  function resetKeepingSettings(commit) {
    const f = path.join(appDir, SETTINGS);
    const keep = changedFiles().includes(SETTINGS) && fs.existsSync(f) ? fs.readFileSync(f) : null;
    const r = git("reset", "--hard", commit);
    if (r.ok && keep) fs.writeFileSync(f, keep);
    return r;
  }

  async function gitUpdate() {
    const top = git("rev-parse", "--show-toplevel");
    if (!top.ok || !same(top.out, appDir)) return refuse("This folder is not a git checkout, so there is nothing to pull.\nIf you downloaded a zip, update with: npm run update -- --from-zip <the new zip file>");
    const changed = changedFiles();
    const settingsEdited = changed.includes(SETTINGS); // the hub itself writes this file, so an edit there alone does not block an update
    const files = changed.filter((f) => f !== SETTINGS);
    if (files.length) {
      return refuse(`Update refused: you have changed ${files.length} file(s) that came with the app:\n${files.slice(0, 12).map((f) => `  ${f}`).join("\n")}${files.length > 12 ? `\n  ... and ${files.length - 12} more` : ""}\nAn update would have to overwrite or merge them. Copy them somewhere safe, then put the originals back (git stash, or git checkout -- <file>), and run this again. Your data and .env are not affected either way.`);
    }
    const branch = git("rev-parse", "--abbrev-ref", "HEAD");
    if (!branch.ok || branch.out === "HEAD") return refuse("Update refused: the folder is not on a branch (it is on a single commit). Switch to your branch (git switch main) and run this again.");
    const up = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}");
    if (!up.ok) return refuse(`Update refused: the branch ${branch.out} does not follow a branch on the project's server, so there is nothing to update from.`);
    const remote = up.out.split("/")[0];
    const from = git("rev-parse", "HEAD").out;
    out(`Plan (git checkout, branch ${branch.out}, from ${remote}):\n  1. take a backup of your data\n  2. fetch from ${remote} (the one network call) and fast-forward ${branch.out} to ${up.out}. Never a merge or a reset; if it cannot fast-forward it stops and says why\n  3. npm ci --ignore-scripts\n  4. self-check the new version on a copy of your data\n  5. if anything after the fetch fails, put ${from.slice(0, 7)} back and reinstall\nYour data/ and .env are not touched${settingsEdited ? `, and your edited ${SETTINGS} is left as it is` : ""}.`);
    if (!(await confirm())) return 0;

    const b = await doBackup();
    if (!b.ok) return 1;
    out(`Fetching from ${remote}...`);
    const f = git("fetch", remote);
    if (!f.ok) return refuse(`The fetch failed (${f.err.split("\n").find((l) => /fatal|error/i.test(l)) || f.err || "no answer"}). Nothing was changed.`);
    const to = git("rev-parse", "@{u}").out;
    if (to === from) { out(`Already up to date (${from.slice(0, 7)}).`); return 0; }
    if (git("merge-base", "--is-ancestor", from, to).ok === false) return refuse(`Cannot fast-forward: your copy (${from.slice(0, 7)}) has commits that ${up.out} (${to.slice(0, 7)}) does not, or the two have split. Nothing was changed. Ask for help in the project's issues; do not force it.`);

    if (settingsEdited && git("diff", "--name-only", from, to).out.split("\n").includes(SETTINGS)) return refuse(`Update refused: the new version changes ${SETTINGS}, and you have edited yours. Copy your version somewhere safe, put the original back (git checkout -- ${SETTINGS}), run this again, then re-apply your edits. Nothing was changed.`);
    const before = readJson(path.join(appDir, "CHANGELOG.json"), []);
    const rec = { mode: "git", from, to, fromVersion: kitVersionOf(appDir), branch: branch.out, at: new Date().toISOString(), backup: b.dir || null, codeFormat: await codeFormatOf(appDir) };
    writeJson(lastFile, rec);
    const restore = (why) => {
      out(`${why}\nPutting the old version (${from.slice(0, 7)}) back...`);
      const r = resetKeepingSettings(from);
      const ok = r.ok && npmCi();
      writeJson(lastFile, { ...rec, failed: why, restoredAt: new Date().toISOString() });
      out(ok ? "The old version is back and your data was not touched. Start the hub as before (npm start)." : `Could not put the old version back by itself (${r.err}). Run: git reset --hard ${from}   then   npm ci --ignore-scripts`);
      return 1;
    };
    const m = git("merge", "--ff-only", "@{u}");
    if (!m.ok) return restore(`The fast-forward failed (${m.err.split("\n")[0]}).`);
    if (!npmCi()) return restore("Installing packages failed.");
    const sc = await selfCheck();
    if (!sc.pass) return restore("The self-check of the new version failed.");
    writeJson(lastFile, { ...rec, toVersion: kitVersionOf(appDir) });
    out(`\nUpdated ${rec.fromVersion || from.slice(0, 7)} -> ${kitVersionOf(appDir) || to.slice(0, 7)}. What changed:\n${notesText(newNotes(before, readJson(path.join(appDir, "CHANGELOG.json"), [])))}\n\nStart the hub again with: npm start\nIf it does not look right: npm run update -- --rollback`);
    return 0;
  }

  // ---- zip ----
  async function zipUpdate(source) {
    if (!fs.existsSync(source)) return refuse(`Can't find ${source}.`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hub-update-"));
    const cleanup = () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} };
    try {
      if (fs.statSync(source).isDirectory()) fs.cpSync(source, tmp, { recursive: true }); else (o.extract || extractZip)(path.resolve(source), tmp, run);
      let src = tmp;
      if (!fs.existsSync(path.join(src, "package.json"))) { const subs = fs.readdirSync(src, { withFileTypes: true }).filter((e) => e.isDirectory()); if (subs.length === 1) src = path.join(src, subs[0].name); }
      const pkg = readJson(path.join(src, "package.json"));
      if (!pkg || pkg.name !== "deskcity" || !parseVersion(pkg.version)) return refuse(`Update refused: that is not a Deskcity kit (its package.json says ${pkg ? `name "${pkg.name}", version "${pkg.version}"` : "nothing readable"}). Nothing was changed.`);
      const newVersion = pkg.version, oldVersion = kitVersionOf(appDir);
      if (oldVersion && compareVersions(newVersion, oldVersion) === -1) return refuse(`Update refused: that zip is version ${newVersion}, older than the ${oldVersion} you have. To go back, use: npm run update -- --rollback`);
      const ignored = parseIgnore(fs.existsSync(path.join(src, ".gitignore")) ? fs.readFileSync(path.join(src, ".gitignore"), "utf8") : "");
      const incoming = listFilesRel(src).filter((r) => !SKIP_ALWAYS(r) && !ignored(r));
      const keep = incoming.filter((r) => KEEP_IF_PRESENT.has(r) && fs.existsSync(path.join(appDir, r)));
      const copyList = incoming.filter((r) => !keep.includes(r));
      const differs = (r) => !fs.existsSync(path.join(appDir, r)) || !fs.readFileSync(path.join(appDir, r)).equals(fs.readFileSync(path.join(src, r)));
      const todo = copyList.filter(differs);
      const replaced = todo.filter((r) => fs.existsSync(path.join(appDir, r)));
      const added = todo.filter((r) => !fs.existsSync(path.join(appDir, r)));
      let beforeDir = `${appDir}-before-update-${today()}`;
      for (let i = 2; fs.existsSync(beforeDir); i++) beforeDir = `${appDir}-before-update-${today()}-${i}`;
      out(`Plan (zip, version ${oldVersion || "?"} -> ${newVersion}):\n  1. take a backup of your data\n  2. copy the ${replaced.length} file(s) that will be replaced into ${beforeDir} (the way back)\n  3. copy ${todo.length} changed or new file(s) over this folder (${added.length} new). Left alone: data/, .env, node_modules/, anything the kit's .gitignore ignores${keep.length ? `, and your ${keep.join(", ")}` : ""}\n  4. npm ci --ignore-scripts\n  5. self-check the new version on a copy of your data; if it fails the old files are put back\nFiles the new version no longer has are left where they are, never deleted.`);
      if (!(await confirm())) return 0;

      const b = await doBackup();
      if (!b.ok) return 1;
      const before = readJson(path.join(appDir, "CHANGELOG.json"), []);
      for (const r of replaced) { fs.mkdirSync(path.dirname(path.join(beforeDir, r)), { recursive: true }); fs.copyFileSync(path.join(appDir, r), path.join(beforeDir, r)); }
      fs.mkdirSync(beforeDir, { recursive: true });
      const rec = { mode: "zip", from: oldVersion, to: newVersion, fromVersion: oldVersion, toVersion: newVersion, at: new Date().toISOString(), backup: b.dir || null, beforeDir, replaced, added, codeFormat: await codeFormatOf(appDir) };
      writeJson(lastFile, rec);
      const restore = (why) => { out(`${why}\nPutting the old files back from ${beforeDir}...`); const ok = restoreFromBefore(rec) && npmCi(); writeJson(lastFile, { ...rec, failed: why, restoredAt: new Date().toISOString() }); out(ok ? "The old version is back and your data was not touched. Start the hub as before (npm start)." : `Could not finish putting it back by itself. Copy the files in ${beforeDir} over this folder by hand, then run: npm ci --ignore-scripts`); return 1; };
      const appRoot = path.resolve(appDir), srcRoot = path.resolve(src);
      for (const r of todo) {
        try {
          const from = path.resolve(src, r), to = path.resolve(appDir, r);
          if (!from.startsWith(srcRoot + path.sep) || !to.startsWith(appRoot + path.sep)) throw new Error(`${r} points outside the folder`);
          if (fs.lstatSync(from).isSymbolicLink()) throw new Error(`${r} is a link`);
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.copyFileSync(from, to);
        } catch (err) {
          // Part of the new files may already be in place: put the old ones back rather than leave a mix.
          return restore(`Copying ${r} failed (${err.message}). Often a program has the file open.`);
        }
      }
      if (!npmCi()) return restore("Installing packages failed.");
      const sc = await selfCheck();
      if (!sc.pass) return restore("The self-check of the new version failed.");
      out(`\nUpdated ${oldVersion || "?"} -> ${newVersion}. What changed:\n${notesText(newNotes(before, readJson(path.join(appDir, "CHANGELOG.json"), [])))}\n\nThe files it replaced are kept in ${beforeDir}.\nStart the hub again with: npm start\nIf it does not look right: npm run update -- --rollback`);
      return 0;
    } catch (err) {
      return refuse(`Update stopped: ${err.message}. Nothing in your data was changed.`);
    } finally { cleanup(); }
  }

  function restoreFromBefore(rec) {
    try {
      for (const r of rec.replaced || []) { const s = path.join(rec.beforeDir, r); if (fs.existsSync(s)) { fs.mkdirSync(path.dirname(path.join(appDir, r)), { recursive: true }); fs.copyFileSync(s, path.join(appDir, r)); } }
      for (const r of rec.added || []) fs.rmSync(path.join(appDir, r), { force: true });
      return true;
    } catch (err) { out(`Putting the files back failed: ${err.message}`); return false; }
  }

  // ---- back ----
  async function rollback() {
    const rec = readJson(lastFile);
    if (!rec || !rec.mode) return refuse("Nothing to go back to: no update has been recorded here (data/update-last.json).");
    if (rec.restoredAt || rec.rolledBackAt) return refuse(`Nothing to go back to: the last update (${rec.at}) was already ${rec.rolledBackAt ? "rolled back" : "undone after it failed"}. The version you have now is the one from before it.`);
    const stored = readFormat(dataDir).format ?? 1;
    const wants = rec.codeFormat ?? 1;
    if (stored > wants) return refuse(`Cannot go back by code alone: your data is now in format ${stored}, and the version you would go back to only understands format ${wants}.\nRestore the backup taken before the update instead (Admin, "Restore from a backup"): ${rec.backup || "see the backups folder next to this one"}.\nNothing was changed.`);
    if (rec.mode === "git") {
      const top = git("rev-parse", "--show-toplevel");
      if (!top.ok || !same(top.out, appDir)) return refuse("This folder is not a git checkout any more, so the old commit can't be put back. Nothing was changed.");
      if (changedFiles().some((f) => f !== SETTINGS)) return refuse("Rollback refused: you have changed files that came with the app (see git status). Copy them somewhere safe, then run this again.");
      if (git("rev-parse", "HEAD").out !== rec.to) return refuse(`Rollback refused: the folder is no longer at the commit the update ended on (${String(rec.to).slice(0, 7)}), so something else changed it since. Nothing was changed. To go back by hand: git reset --hard ${rec.from}`);
      if (!git("cat-file", "-e", `${rec.from}^{commit}`).ok) return refuse(`The old commit ${String(rec.from).slice(0, 7)} is not in this checkout any more. Nothing was changed.`);
      out(`Plan (rollback, git): put ${rec.branch} back on ${String(rec.from).slice(0, 7)}${rec.fromVersion ? ` (version ${rec.fromVersion})` : ""}, then npm ci --ignore-scripts and a self-check. Your data/ and .env are not touched.`);
      if (!(await confirm())) return 0;
      const r = resetKeepingSettings(rec.from);
      if (!r.ok) return refuse(`Could not go back (${r.err}). Nothing else was changed.`);
    } else {
      if (!rec.beforeDir || !fs.existsSync(rec.beforeDir)) return refuse(`The folder with the old files (${rec.beforeDir || "not recorded"}) is gone, so there is nothing to copy back. Nothing was changed.`);
      out(`Plan (rollback, zip): copy the ${(rec.replaced || []).length} old file(s) in ${rec.beforeDir} back over this folder and remove the ${(rec.added || []).length} file(s) the update added. Then npm ci --ignore-scripts and a self-check. Your data/ and .env are not touched.`);
      if (!(await confirm())) return 0;
      if (!restoreFromBefore(rec)) return 1;
    }
    const ok = npmCi();
    const sc = ok ? await selfCheck() : { pass: false };
    writeJson(lastFile, { ...rec, rolledBackAt: new Date().toISOString() });
    out(ok && sc.pass ? `\nGone back to ${rec.fromVersion || String(rec.from).slice(0, 7)}. Start the hub with: npm start` : "\nThe old files are back, but the packages or the self-check did not pass. Run: npm ci --ignore-scripts   and   npm run self-check");
    return ok && sc.pass ? 0 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exit(await main(process.argv.slice(2)).catch((err) => { console.error(`Update stopped: ${err.message}`); return 1; }));
}
