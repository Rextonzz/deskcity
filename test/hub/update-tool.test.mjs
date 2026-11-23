// tools/update.mjs (npm run update): git update, zip update, rollback and --check, against temp git repos made here. No network:
// the "server" is a local bare repo, npm and the self-check are stand-ins, the backup is a stand-in that records when it ran.
// After every mode data/ (except the note data/update-last.json) and .env must be byte-identical.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { app } from "./helper.mjs";

const { main, parseIgnore, newNotes } = await import(app("tools/update.mjs"));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "upd-"));
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com", GIT_TERMINAL_PROMPT: "0" };
const git = (cwd, ...a) => { const r = spawnSync("git", a, { cwd, encoding: "utf8", env: GIT_ENV }); if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`); return r.stdout.trim(); };
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const tree = (dir, skip = () => false, out = {}, rel = "") => {
  if (!fs.existsSync(path.join(dir, rel))) return out;
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (skip(r)) continue;
    if (e.isDirectory()) tree(dir, skip, out, r); else out[r] = crypto.createHash("sha1").update(fs.readFileSync(path.join(dir, r))).digest("hex");
  }
  return out;
};
// what must never change: data/ (but the update note) and .env
const guarded = (app) => ({ data: tree(path.join(app, "data"), (r) => r === "update-last.json"), env: fs.readFileSync(path.join(app, ".env"), "utf8") });

const files = (version, title, extra = {}) => ({
  "package.json": JSON.stringify({ name: "deskcity", version }),
  "hub.defaults.json": JSON.stringify({ kit: { name: "Deskcity", version, updatesUrl: "" } }),
  "CHANGELOG.json": JSON.stringify([{ at: `2026-11-1${version.slice(-1)}T00:00:00Z`, title, changes: [`${title} changed things`] }]),
  ".gitignore": ".env\n.env.*\n!.env.example\nnode_modules/\ndata/\n*.zip\n",
  "src/code.js": `// ${version}\n`,
  ...extra,
});

// origin (bare) + the app (a clone of it, with its own data and .env) + a second clone to push new versions from
function world() {
  const base = tmp();
  const origin = path.join(base, "origin.git");
  git(base, "init", "--bare", "-b", "main", origin);
  const dev = path.join(base, "dev");
  git(base, "clone", "-c", "core.autocrlf=false", origin, dev);
  git(dev, "config", "core.autocrlf", "false");
  for (const [f, t] of Object.entries(files("0.1.0", "first"))) write(dev, f, t);
  git(dev, "add", "-A"); git(dev, "commit", "-m", "v1"); git(dev, "push", "origin", "HEAD:main");
  const appDir = path.join(base, "app");
  git(base, "clone", "-c", "core.autocrlf=false", origin, appDir);
  git(appDir, "config", "core.autocrlf", "false");
  write(appDir, ".env", "SECRET=keep-me\n");
  write(appDir, "data/agents/roster.json", '{"rooms":[],"desks":[]}');
  write(appDir, "data/spend.jsonl", '{"usd":1}\n');
  const release = (version, title, extra) => {
    for (const [f, t] of Object.entries(files(version, title, extra))) write(dev, f, t);
    git(dev, "add", "-A"); git(dev, "commit", "-m", `v${version}`); git(dev, "push", "origin", "HEAD:main");
  };
  return { base, origin, dev, appDir, release, head: () => git(appDir, "rev-parse", "HEAD") };
}

// the stand-ins: real git, npm and node recorded, backup recorded, self-check chosen by the test
function kit(appDir, { selfPass = true, backupOk = true, npmOk = true, addonsOk = true, fetchFn } = {}) {
  const calls = [], lines = [];
  const runner = (cmd0, args, opts) => {
    const cmd = cmd0 === process.execPath ? "node" : cmd0; // the add-on step runs this same node binary
    if (cmd === "git") { calls.push(`git ${args[0]}`); const r = spawnSync("git", args, { cwd: opts.cwd, encoding: "utf8", env: GIT_ENV }); return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" }; }
    calls.push(`${cmd} ${args.join(" ")}`);
    return { status: (cmd === "npm" && !npmOk) || (cmd === "node" && !addonsOk) ? 1 : 0, stdout: "", stderr: "" };
  };
  const o = {
    appDir, runner, out: (s) => lines.push(s), interactive: false, fetchFn,
    backup: async () => { calls.push("BACKUP"); return backupOk ? { ok: true, dir: path.join(path.dirname(appDir), "app-backups", "2026-11-16") } : { ok: false, error: "disk full" }; },
    selfCheck: async () => { calls.push("SELFCHECK"); return { pass: selfPass }; },
  };
  return { o, calls, text: () => lines.join("\n"), lines };
}
const lastNote = (appDir) => JSON.parse(fs.readFileSync(path.join(appDir, "data", "update-last.json"), "utf8"));

test("with no --yes it only prints the plan and changes nothing", async () => {
  const w = world(); w.release("0.2.0", "second");
  const k = kit(w.appDir); const before = w.head(); const g = guarded(w.appDir);
  assert.equal(await main([], k.o), 0);
  assert.match(k.text(), /Plan \(git checkout, branch main, from origin\)/);
  assert.match(k.text(), /dry run: nothing was changed/);
  assert.equal(w.head(), before);
  assert.deepEqual(k.calls.filter((c) => !c.startsWith("git rev-parse") && !c.startsWith("git status")), []);
  assert.equal(fs.existsSync(path.join(w.appDir, "data", "update-last.json")), false);
  assert.deepEqual(guarded(w.appDir), g);
});

test("git update: backup first, then fetch and fast-forward, npm ci --ignore-scripts, self-check, from/to recorded, data and .env untouched", async () => {
  const w = world(); const from = w.head(); w.release("0.2.0", "second");
  const k = kit(w.appDir); const g = guarded(w.appDir);
  assert.equal(await main(["--yes"], k.o), 0, k.text());
  assert.equal(fs.readFileSync(path.join(w.appDir, "src/code.js"), "utf8"), "// 0.2.0\n");
  const to = w.head();
  assert.notEqual(to, from);
  const note = lastNote(w.appDir);
  assert.equal(note.from, from); assert.equal(note.to, to); assert.equal(note.mode, "git");
  assert.match(note.backup, /2026-11-16$/); assert.equal(note.fromVersion, "0.1.0"); assert.equal(note.toVersion, "0.2.0"); assert.ok(note.at);
  assert.ok(k.calls.indexOf("BACKUP") < k.calls.indexOf("git fetch"), "the backup is taken before anything is fetched");
  assert.ok(k.calls.includes("npm ci --ignore-scripts"));
  assert.ok(k.calls.indexOf("npm ci --ignore-scripts") < k.calls.indexOf("SELFCHECK"));
  assert.match(k.text(), /Updated 0\.1\.0 -> 0\.2\.0/);
  assert.match(k.text(), /- second/, "prints the new changelog entries");
  assert.match(k.text(), /npm start/);
  assert.deepEqual(guarded(w.appDir), g, "data/ and .env are byte-identical");
});

test("already up to date: says so and records nothing", async () => {
  const w = world(); const k = kit(w.appDir);
  assert.equal(await main(["--yes"], k.o), 0);
  assert.match(k.text(), /Already up to date/);
  assert.equal(fs.existsSync(path.join(w.appDir, "data", "update-last.json")), false);
});

test("local changes to tracked files: refuses, lists them, takes no backup, changes nothing (there is no --force)", async () => {
  const w = world(); w.release("0.2.0", "second");
  write(w.appDir, "src/code.js", "// my edit\n");
  const k = kit(w.appDir); const before = w.head(); const g = guarded(w.appDir);
  assert.equal(await main(["--yes", "--force"], k.o), 1);
  assert.match(k.text(), /Update refused: you have changed 1 file\(s\)/);
  assert.match(k.text(), /src\/code\.js/);
  assert.ok(!k.calls.includes("BACKUP") && !k.calls.includes("git fetch"));
  assert.equal(w.head(), before);
  assert.equal(fs.readFileSync(path.join(w.appDir, "src/code.js"), "utf8"), "// my edit\n", "the edit is still there");
  assert.deepEqual(guarded(w.appDir), g);
});

test("an edit to pipeline.config.json alone does not block an update and survives it and a rollback; an update that changes that file refuses", async () => {
  const w = world();
  write(w.dev, "pipeline.config.json", '{"channels":{}}'); git(w.dev, "add", "-A"); git(w.dev, "commit", "-m", "settings"); git(w.dev, "push", "origin", "HEAD:main");
  git(w.appDir, "pull", "--ff-only");
  write(w.appDir, "pipeline.config.json", '{"channels":{"mine":{}}}');
  w.release("0.2.0", "second");
  const from = w.head();
  const k = kit(w.appDir);
  assert.equal(await main(["--yes"], k.o), 0, k.text());
  assert.equal(fs.readFileSync(path.join(w.appDir, "pipeline.config.json"), "utf8"), '{"channels":{"mine":{}}}', "your settings are still yours");
  const k2 = kit(w.appDir);
  assert.equal(await main(["--rollback", "--yes"], k2.o), 0, k2.text());
  assert.equal(w.head(), from);
  assert.equal(fs.readFileSync(path.join(w.appDir, "pipeline.config.json"), "utf8"), '{"channels":{"mine":{}}}');
  // an incoming change to the same file is refused, nothing moves
  write(w.dev, "pipeline.config.json", '{"channels":{},"new":true}'); git(w.dev, "add", "-A"); git(w.dev, "commit", "-m", "settings 2"); git(w.dev, "push", "origin", "HEAD:main");
  const k3 = kit(w.appDir); const head = w.head();
  assert.equal(await main(["--yes"], k3.o), 1);
  assert.match(k3.text(), /changes pipeline\.config\.json, and you have edited yours/);
  assert.equal(w.head(), head);
});

test("cannot fast-forward (the copy has its own commit): refuses and changes nothing", async () => {
  const w = world(); w.release("0.2.0", "second");
  write(w.appDir, "extra.txt", "mine"); git(w.appDir, "add", "-A"); git(w.appDir, "commit", "-m", "my own commit");
  const k = kit(w.appDir); const before = w.head(); const g = guarded(w.appDir);
  assert.equal(await main(["--yes"], k.o), 1);
  assert.match(k.text(), /Cannot fast-forward/);
  assert.equal(w.head(), before);
  assert.equal(fs.existsSync(path.join(w.appDir, "data", "update-last.json")), false);
  assert.deepEqual(guarded(w.appDir), g);
});

test("a failed backup stops everything before the fetch", async () => {
  const w = world(); w.release("0.2.0", "second");
  const k = kit(w.appDir, { backupOk: false }); const before = w.head();
  assert.equal(await main(["--yes"], k.o), 1);
  assert.match(k.text(), /The backup failed \(disk full\)\. Nothing was changed/);
  assert.ok(!k.calls.includes("git fetch"));
  assert.equal(w.head(), before);
});

test("a hub running on this data folder: refuses with 'Stop the hub first'", async () => {
  const w = world(); w.release("0.2.0", "second");
  write(w.appDir, "data/hub.lock", JSON.stringify({ pid: process.ppid, startedAt: new Date().toISOString(), port: 3999 }) + "\n");
  const k = kit(w.appDir); const before = w.head();
  assert.equal(await main(["--yes"], k.o), 1);
  assert.match(k.text(), /Stop the hub first/);
  assert.ok(!k.calls.includes("BACKUP"));
  assert.equal(w.head(), before);
});

test("a failing self-check puts the old commit back, reinstalls, and says so", async () => {
  const w = world(); const from = w.head(); w.release("0.2.0", "second");
  const k = kit(w.appDir, { selfPass: false }); const g = guarded(w.appDir);
  assert.equal(await main(["--yes"], k.o), 1);
  assert.equal(w.head(), from, "back on the old commit");
  assert.equal(fs.readFileSync(path.join(w.appDir, "src/code.js"), "utf8"), "// 0.1.0\n");
  assert.equal(k.calls.filter((c) => c === "npm ci --ignore-scripts").length, 2, "reinstalled after putting it back");
  assert.match(k.text(), /self-check of the new version failed/);
  assert.match(k.text(), /The old version is back/);
  assert.match(lastNote(w.appDir).failed, /self-check/);
  assert.deepEqual(guarded(w.appDir), g);
});

test("a failing npm ci also puts the old commit back", async () => {
  const w = world(); const from = w.head(); w.release("0.2.0", "second");
  const k = kit(w.appDir, { npmOk: false });
  assert.equal(await main(["--yes"], k.o), 1);
  assert.equal(w.head(), from);
});

const INSTALLER = { "tools/addons-install.mjs": "// add-on packages\n" };
const ADDON_STEP = `node ${path.join("tools", "addons-install.mjs")}`;

test("a version with tools/addons-install.mjs: the add-on packages are installed right after npm ci, before the self-check", async () => {
  const w = world(); w.release("0.2.0", "second", INSTALLER);
  const k = kit(w.appDir);
  assert.equal(await main(["--yes"], k.o), 0);
  assert.ok(k.calls.indexOf(ADDON_STEP) > k.calls.indexOf("npm ci --ignore-scripts"), k.calls.join(" | "));
  assert.ok(k.calls.indexOf(ADDON_STEP) < k.calls.indexOf("SELFCHECK"));
});

test("a failing add-on install puts the old commit back, like a failing npm ci (the old version has no add-on step)", async () => {
  const w = world(); const from = w.head(); w.release("0.2.0", "second", INSTALLER);
  const k = kit(w.appDir, { addonsOk: false });
  assert.equal(await main(["--yes"], k.o), 1);
  assert.equal(w.head(), from);
  assert.match(k.text(), /Add-on packages failed/);
  assert.equal(k.calls.filter((c) => c === ADDON_STEP).length, 1, "the old tree has no installer, so the put-back doesn't run it");
});

test("rollback after a git update returns to the old commit, data untouched; a second rollback has nothing to do", async () => {
  const w = world(); const from = w.head(); w.release("0.2.0", "second");
  await main(["--yes"], kit(w.appDir).o);
  const g = guarded(w.appDir);
  const k = kit(w.appDir);
  assert.equal(await main(["--rollback", "--yes"], k.o), 0, k.text());
  assert.equal(w.head(), from);
  assert.match(k.text(), /Gone back to 0\.1\.0/);
  assert.ok(lastNote(w.appDir).rolledBackAt);
  assert.deepEqual(guarded(w.appDir), g);
  const again = kit(w.appDir);
  assert.equal(await main(["--rollback", "--yes"], again.o), 1);
  assert.match(again.text(), /already rolled back/);
});

test("rollback when the data format is newer than the old code: tells you to restore the backup and stops", async () => {
  const w = world(); const from = w.head(); w.release("0.2.0", "second");
  await main(["--yes"], kit(w.appDir).o);
  const to = w.head();
  write(w.appDir, "data/format.json", '{"format":2}');
  const k = kit(w.appDir); const g = guarded(w.appDir);
  assert.equal(await main(["--rollback", "--yes"], k.o), 1);
  assert.match(k.text(), /format 2.*only understands format 1/);
  assert.match(k.text(), /Restore the backup taken before the update.*2026-11-16/);
  assert.equal(w.head(), to, "the code was not moved");
  assert.notEqual(to, from);
  assert.deepEqual(guarded(w.appDir), g);
});

test("rollback with nothing recorded says so", async () => {
  const w = world(); const k = kit(w.appDir);
  assert.equal(await main(["--rollback", "--yes"], k.o), 1);
  assert.match(k.text(), /no update has been recorded/);
});

// ---- zip ----
function zipWorld() {
  const w = tmp();
  const appDir = path.join(w, "kit");
  const incoming = path.join(w, "incoming", "deskcity-0.2.0");
  for (const [f, t] of Object.entries(files("0.1.0", "first"))) write(appDir, f, t);
  write(appDir, "pipeline.config.json", '{"channels":{"mine":{}}}');
  write(appDir, ".env", "SECRET=keep-me\n");
  write(appDir, "data/agents/roster.json", '{"rooms":[],"desks":[{"id":"a"}]}');
  write(appDir, "data/spend.jsonl", '{"usd":2}\n');
  write(appDir, "node_modules/pkg/index.js", "installed");
  for (const [f, t] of Object.entries(files("0.2.0", "second", { "src/new.js": "// new in 0.2.0\n", "pipeline.config.json": '{"channels":{}}', ".env": "SECRET=from-the-zip\n", "data/agents/roster.json": "FROM THE ZIP", "node_modules/pkg/index.js": "from the zip", "big.zip": "ignored by the kit's .gitignore" }))) write(incoming, f, t);
  return { w, appDir, incoming };
}

test("zip update: copies everything except data/, .env, node_modules, ignored files and your pipeline.config.json; keeps a before-update folder", async () => {
  const z = zipWorld(); const k = kit(z.appDir); const g = guarded(z.appDir);
  const nm = tree(path.join(z.appDir, "node_modules"));
  assert.equal(await main(["--from-zip", z.incoming, "--yes"], k.o), 0, k.text());
  assert.equal(fs.readFileSync(path.join(z.appDir, "src/code.js"), "utf8"), "// 0.2.0\n");
  assert.equal(fs.readFileSync(path.join(z.appDir, "src/new.js"), "utf8"), "// new in 0.2.0\n");
  assert.equal(fs.readFileSync(path.join(z.appDir, "pipeline.config.json"), "utf8"), '{"channels":{"mine":{}}}', "your settings file stays");
  assert.ok(!fs.existsSync(path.join(z.appDir, "big.zip")), "ignored by the kit's .gitignore");
  assert.deepEqual(tree(path.join(z.appDir, "node_modules")), nm);
  assert.deepEqual(guarded(z.appDir), g, "data/ and .env are byte-identical");
  const note = lastNote(z.appDir);
  assert.equal(note.mode, "zip"); assert.equal(note.from, "0.1.0"); assert.equal(note.to, "0.2.0");
  assert.ok(fs.existsSync(note.beforeDir) && /-before-update-\d{4}-\d{2}-\d{2}$/.test(note.beforeDir));
  assert.equal(fs.readFileSync(path.join(note.beforeDir, "src/code.js"), "utf8"), "// 0.1.0\n", "the old file is kept there");
  assert.ok(!fs.existsSync(path.join(note.beforeDir, "data")) && !fs.existsSync(path.join(note.beforeDir, ".env")));
  assert.ok(k.calls.indexOf("BACKUP") < k.calls.indexOf("npm ci --ignore-scripts"));
  assert.match(k.text(), /Updated 0\.1\.0 -> 0\.2\.0/);
  assert.match(k.text(), /- second/);
});

test("zip update without --yes only prints the plan", async () => {
  const z = zipWorld(); const k = kit(z.appDir); const all = tree(z.appDir);
  assert.equal(await main(["--from-zip", z.incoming], k.o), 0);
  assert.match(k.text(), /Plan \(zip, version 0\.1\.0 -> 0\.2\.0\)/);
  assert.deepEqual(tree(z.appDir), all);
  assert.ok(!fs.existsSync(`${z.appDir}-before-update-${new Date().toISOString().slice(0, 10)}`));
});

test("zip update refuses something that is not a Deskcity kit, or an older one", async () => {
  const z = zipWorld();
  write(z.incoming, "package.json", JSON.stringify({ name: "something-else", version: "9.9.9" }));
  const k = kit(z.appDir); const all = tree(z.appDir);
  assert.equal(await main(["--from-zip", z.incoming, "--yes"], k.o), 1);
  assert.match(k.text(), /not a Deskcity kit/);
  write(z.incoming, "package.json", JSON.stringify({ name: "deskcity", version: "0.0.9" }));
  const k2 = kit(z.appDir);
  assert.equal(await main(["--from-zip", z.incoming, "--yes"], k2.o), 1);
  assert.match(k2.text(), /older than the 0\.1\.0 you have/);
  assert.deepEqual(tree(z.appDir), all);
  assert.ok(!k.calls.includes("BACKUP") && !k2.calls.includes("BACKUP"));
});

test("zip update whose self-check fails puts the old files back and removes the new ones", async () => {
  const z = zipWorld(); const k = kit(z.appDir, { selfPass: false }); const g = guarded(z.appDir);
  assert.equal(await main(["--from-zip", z.incoming, "--yes"], k.o), 1);
  assert.equal(fs.readFileSync(path.join(z.appDir, "src/code.js"), "utf8"), "// 0.1.0\n");
  assert.ok(!fs.existsSync(path.join(z.appDir, "src/new.js")));
  assert.match(k.text(), /The old version is back/);
  assert.deepEqual(guarded(z.appDir), g);
});

test("zip rollback copies the old files back and removes what the update added", async () => {
  const z = zipWorld();
  await main(["--from-zip", z.incoming, "--yes"], kit(z.appDir).o);
  const g = guarded(z.appDir); const k = kit(z.appDir);
  assert.equal(await main(["--rollback", "--yes"], k.o), 0, k.text());
  assert.equal(fs.readFileSync(path.join(z.appDir, "src/code.js"), "utf8"), "// 0.1.0\n");
  assert.ok(!fs.existsSync(path.join(z.appDir, "src/new.js")));
  assert.equal(fs.readFileSync(path.join(z.appDir, "package.json"), "utf8"), JSON.stringify({ name: "deskcity", version: "0.1.0" }));
  assert.deepEqual(guarded(z.appDir), g);
});

test("a real zip file is unpacked (skipped when this PC has no tool that can make one)", async (t) => {
  const z = zipWorld();
  const zipFile = path.join(z.w, "kit.zip");
  let made = spawnSync("tar", ["-a", "-cf", zipFile, "-C", path.join(z.w, "incoming"), "deskcity-0.2.0"], { encoding: "utf8" });
  if ((made.status !== 0 || !fs.existsSync(zipFile) || fs.statSync(zipFile).size < 100) && process.platform === "win32") {
    fs.rmSync(zipFile, { force: true });
    made = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `Compress-Archive -LiteralPath '${path.join(z.w, "incoming", "deskcity-0.2.0")}' -DestinationPath '${zipFile}'`], { encoding: "utf8" });
  }
  if (made.status !== 0 || !fs.existsSync(zipFile)) return t.skip("nothing here that writes zip files");
  const realRun = (cmd, args, opts) => { const r = spawnSync(cmd, args, { cwd: opts?.cwd, encoding: "utf8" }); return { status: r.status ?? 1, stdout: r.stdout || "", stderr: r.stderr || "" }; };
  const k = kit(z.appDir);
  const inner = k.o.runner;
  k.o.runner = (cmd, args, opts) => (["tar", "unzip", "powershell"].includes(cmd) ? realRun(cmd, args, opts) : inner(cmd, args, opts));
  assert.equal(await main(["--from-zip", zipFile, "--yes"], k.o), 0, k.text());
  assert.equal(fs.readFileSync(path.join(z.appDir, "src/new.js"), "utf8"), "// new in 0.2.0\n");
});

// ---- --check ----
test("--check with no update address makes no request at all", async () => {
  const w = world(); let asked = 0;
  const k = kit(w.appDir, { fetchFn: async () => { asked++; throw new Error("must not be called"); } });
  assert.equal(await main(["--check"], k.o), 0);
  assert.equal(asked, 0);
  assert.match(k.text(), /No update address is set/i);
  assert.deepEqual(k.calls, [], "no git, npm or backup either");
});

test("--check with an address asks once and prints 'you have X, newest is Y'; nothing on disk changes", async () => {
  const w = world();
  write(w.appDir, "data/hub-settings.json", JSON.stringify({ kit: { updatesUrl: "https://example.test/releases/latest" } }));
  const urls = [];
  const k = kit(w.appDir, { fetchFn: async (u) => { urls.push(u); return { ok: true, status: 200, text: async () => JSON.stringify({ tag_name: "v0.3.0" }) }; } });
  const g = guarded(w.appDir); const all = tree(w.appDir, (r) => r.startsWith(".git/"));
  assert.equal(await main(["--check"], k.o), 0);
  assert.deepEqual(urls, ["https://example.test/releases/latest"]);
  assert.match(k.text(), /You have 0\.1\.0, newest is 0\.3\.0/);
  assert.deepEqual(guarded(w.appDir), g);
  assert.deepEqual(tree(w.appDir, (r) => r.startsWith(".git/")), all);
});

test("small helpers: the .gitignore reader and the new-notes comparison", () => {
  const ign = parseIgnore(".env\n.env.*\n!.env.example\nnode_modules/\ndata/\n*.zip\n/top.txt\n");
  for (const r of [".env", ".env.local", "node_modules/a/b.js", "data/x.json", "a/b.zip", "top.txt"]) assert.equal(ign(r), true, r);
  for (const r of [".env.example", "src/a.js", "sub/top.txt", "datafile.js"]) assert.equal(ign(r), false, r);
  assert.deepEqual(newNotes([{ at: "1", title: "a" }], [{ at: "2", title: "b" }, { at: "1", title: "a" }]).map((n) => n.title), ["b"]);
});
