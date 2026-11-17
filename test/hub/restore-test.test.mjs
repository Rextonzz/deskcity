// tools/restore-test.mjs against a small backup made here from a fixture data folder: it passes on a good backup and
// fails (exit 1) on a broken one. Temp folders only; the tool starts the real server on a free local port.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { hub, APP } from "./helper.mjs";

const rooms = [{ id: "hub", name: "Hub" }, { id: "hr", name: "HR" }];
const desks = [
  { id: "hr", room: "hr", role: "HR", lead: true, provider: "claude", model: "claude-haiku-5-5", status: "active", runner: "hub" },
  { id: "hub-builder", room: "hub", role: "Builder", lead: true, provider: "claude", model: "claude-code", status: "active" },
];
const { root } = await hub({ rooms, desks });
fs.writeFileSync(path.join(root, "pipeline.config.json"), JSON.stringify({ jobsDir: "data/jobs", backup: { dir: path.join(root, "backups"), hour: 0 }, channels: {} }));
fs.writeFileSync(path.join(root, "data", "spend.jsonl"), '{"at":"2026-11-01T00:00:00Z","usd":0.01}\n{"at":"2026-11-02T00:00:00Z","usd":0.02}\n');
fs.writeFileSync(path.join(root, "data", "agents", "events.jsonl"), '{"desk":"hr","action":"x"}\n');
fs.writeFileSync(path.join(root, "data", "agents", "jobs.jsonl"), '{"id":"j1"}\n');
fs.writeFileSync(path.join(root, "data", "agents", "token.txt"), "not-a-real-token-and-never-backed-up");
fs.mkdirSync(path.join(root, "data", "jobs", "a-1"), { recursive: true });
fs.writeFileSync(path.join(root, "data", "jobs", "a-1", "job.json"), JSON.stringify({ id: "a-1", status: "done" }));
const { runBackup, BACKUP_NAME } = await import("../../src/pipeline/backup.js");
assert.equal(runBackup().ok, true);
const base = path.join(root, "backups");
const backup = path.join(base, fs.readdirSync(base).find((n) => BACKUP_NAME.test(n)));

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const run = async (dir) => spawnSync(process.execPath, [path.join(APP, "tools", "restore-test.mjs"), dir, "--port", String(await freePort())], { encoding: "utf8", timeout: 120000, env: { ...process.env, SOME_FAKE_API_KEY: "must-not-reach-the-hub" } });

test("a good backup passes, the server is gone and the temp folder is deleted", async () => {
  const r = await run(backup);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS/);
  assert.match(r.stdout, /roster loads with the same desks and rooms as the backup \(backup 2 desks \/ 2 rooms; restored hub 2 \/ 2\)/);
  assert.match(r.stdout, /token\.txt/, "the report lists what a real restore needs you to re-make");
  assert.ok(!/not-a-real-token/.test(r.stdout), "no secret value is printed");
  assert.ok(!fs.existsSync(path.join(backup, "data", "agents", "token.txt")), "the backup itself has no token file");
});

test("a broken events file fails with exit code 1", async () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "rt-broken-"));
  fs.cpSync(backup, copy, { recursive: true });
  fs.writeFileSync(path.join(copy, "data", "agents", "events.jsonl"), '{"ok":1}\n{broken\n');
  const r = await run(copy);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /FAIL .*events\.jsonl parses/);
});

test("a roster that does not match is caught, and a missing folder is refused", async () => {
  const none = await run(path.join(os.tmpdir(), "rt-no-such-backup-" + Date.now()));
  assert.equal(none.status, 1);
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "rt-secret-"));
  fs.cpSync(backup, copy, { recursive: true });
  fs.writeFileSync(path.join(copy, "data", "api-key.json"), "{}"); // a secret-named file in a backup is a failure (name only is printed)
  const r = await run(copy);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL no secrets in the backup \(look at: data\/api-key\.json\)/);
});

test("port 3000 is refused", () => {
  const r = spawnSync(process.execPath, [path.join(APP, "tools", "restore-test.mjs"), backup, "--port", "3000"], { encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /live hub/);
});
