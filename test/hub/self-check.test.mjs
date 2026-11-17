// tools/self-check.mjs: starts the real server on a COPY of a data folder with the keys stripped, checks it, and cleans up.
// Temp folders only; the original data folder is never changed.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { app, APP } from "./helper.mjs";

const { selfCheck } = await import(app("tools/self-check.mjs"));
const tree = (dir, out = {}, rel = "") => {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) tree(dir, out, r); else out[r] = crypto.createHash("sha1").update(fs.readFileSync(path.join(dir, r))).digest("hex");
  }
  return out;
};
const seed = (format) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "selfcheck-data-"));
  fs.mkdirSync(path.join(d, "agents"), { recursive: true });
  fs.writeFileSync(path.join(d, "agents", "roster.json"), JSON.stringify({ rooms: [{ id: "hub", name: "Hub" }], desks: [{ id: "hub-builder", room: "hub", role: "Builder", lead: true, provider: "claude", model: "claude-code", status: "active" }] }));
  fs.writeFileSync(path.join(d, "spend.jsonl"), '{"at":"2026-11-01T00:00:00Z","usd":0.01}\n');
  fs.writeFileSync(path.join(d, "clip.mp4"), "not really a video");
  fs.writeFileSync(path.join(d, "hub.lock"), JSON.stringify({ pid: 1, startedAt: "x", port: 3000 }));
  if (format) fs.writeFileSync(path.join(d, "format.json"), JSON.stringify({ format }));
  return d;
};

test("passes on a copy of the data, leaves the original byte-identical, stops the server and deletes the copy", async () => {
  const data = seed(1);
  const before = tree(data);
  const lines = [];
  const r = await selfCheck({ appDir: APP, dataDir: data, log: (l) => lines.push(l) });
  assert.equal(r.pass, true, lines.join("\n"));
  assert.deepEqual(tree(data), before, "the data folder is untouched");
  assert.ok(!fs.existsSync(r.root), "the temp copy is gone");
  assert.ok(lines.some((l) => /the roster loads.*1 desks, 1 rooms/.test(l)));
  assert.ok(lines.some((l) => /campus page returns 200/.test(l)));
  assert.ok(lines.some((l) => /server stopped and the port is free/.test(l)));
});

test("fails, saying why, when the data is from a newer version", async () => {
  const data = seed(99);
  const lines = [];
  const r = await selfCheck({ appDir: APP, dataDir: data, log: (l) => lines.push(l) });
  assert.equal(r.pass, false);
  assert.match(lines.join("\n"), /format 99.*only understands format 1/);
  assert.ok(!fs.existsSync(r.root));
});

test("the command line prints PASS and exits 0, and no key from the environment reaches the hub it starts", () => {
  const empty = spawnSync(process.execPath, [path.join(APP, "tools", "self-check.mjs")], { encoding: "utf8", timeout: 120000, env: { ...process.env, SOME_FAKE_API_KEY: "must-not-reach-the-hub" } });
  assert.equal(empty.status, 0, empty.stdout + empty.stderr);
  assert.match(empty.stdout, /PASS/);
  assert.ok(!/must-not-reach/.test(empty.stdout + empty.stderr));
});
