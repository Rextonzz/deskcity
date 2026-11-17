// readJsonl reads .jsonl.gz and optional monthly archives; the default stays live-file-only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { hub, APP, app } from "./helper.mjs";

const { root } = await hub();
const F = await import(app("src/pipeline/files.js"));
const dir = path.join(root, "data", "gz");
fs.mkdirSync(dir, { recursive: true });
const j = (...rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const gz = (text) => zlib.gzipSync(Buffer.from(text));
const put = (name, data) => { const f = path.join(dir, name); fs.writeFileSync(f, data); return f; };

test("readJsonl reads a gzipped file", () => {
  const f = put("a.jsonl.gz", gz(j({ n: 1 }, { n: 2 })));
  assert.deepEqual(F.readJsonl(f).map((r) => r.n), [1, 2]);
});

test("a two-member gzip file reads as one stream", () => {
  const f = put("b.jsonl.gz", Buffer.concat([gz(j({ n: 1 })), gz(j({ n: 2 }))]));
  assert.deepEqual(F.readJsonl(f).map((r) => r.n), [1, 2]);
});

test("a truncated .gz gives the rows before the damage; strict throws", () => {
  const rows = Array.from({ length: 2000 }, (_, i) => ({ n: i, pad: Math.random().toString(36) }));
  const full = gz(j(...rows));
  const f = put("c.jsonl.gz", full.subarray(0, full.length - 10));
  let got;
  assert.doesNotThrow(() => { got = F.readJsonl(f); });
  assert.ok(got.length > 0 && got.length <= rows.length);
  assert.throws(() => F.readJsonl(f, { strict: true }));
});

test("a missing .gz is [] even when strict", () => {
  const f = path.join(dir, "nope.jsonl.gz");
  assert.deepEqual(F.readJsonl(f), []);
  assert.deepEqual(F.readJsonl(f, { strict: true }), []);
});

test("readJsonl on the live file ignores archives unless asked", () => {
  const live = put("events.jsonl", j({ at: "2026-11-02T00:00:00Z", n: 3 }));
  put("events-2026-10.jsonl.gz", gz(j({ at: "2026-10-02T00:00:00Z", n: 1 }, { at: "2026-10-03T00:00:00Z", n: 2 })));
  assert.deepEqual(F.readJsonl(live).map((r) => r.n), [3]);
  assert.deepEqual(F.readJsonl(live, { archives: true }).map((r) => r.n), [1, 2, 3]);
});

test("jsonlArchives ignores other names and sorts months ascending", () => {
  const live = path.join(dir, "ev2.jsonl");
  put("ev2-2026-11.jsonl.gz", gz(""));
  put("ev2-2026-09.jsonl.gz", gz(""));
  put("ev2-old.jsonl.gz", gz(""));
  put("other-2026-10.jsonl.gz", gz(""));
  assert.deepEqual(F.jsonlArchives(live).map((p) => path.basename(p)), ["ev2-2026-09.jsonl.gz", "ev2-2026-11.jsonl.gz"]);
  assert.deepEqual(F.jsonlArchives(path.join(root, "no-such-dir", "x.jsonl")), []);
});

test("readJsonlRange opens only the months that can overlap", () => {
  const live = put("r.jsonl", j({ at: "2026-11-05T00:00:00Z", n: 3 }));
  put("r-2026-10.jsonl.gz", gz(j({ at: "2026-10-20T00:00:00Z", n: 1 }, { at: "2026-10-30T00:00:00Z", n: 2 })));
  put("r-2026-08.jsonl.gz", Buffer.from("not gzip at all")); // would throw under strict if opened
  const inLive = F.readJsonlRange(live, "2026-11-01T00:00:00Z", null, { strict: true });
  assert.deepEqual(inLive.map((r) => r.n), [3]);
  const span = F.readJsonlRange(live, "2026-10-25T00:00:00Z", "2026-11-30T00:00:00Z", { strict: true });
  assert.deepEqual(span.map((r) => r.n), [2, 3]);
});

test("readJsonlRange uses the index and a custom field; rows without a date are dropped", () => {
  const live = put("s.jsonl", j({ startedAt: "2026-11-05T00:00:00Z", n: 3 }, { n: 4 }));
  put("s-2026-10.jsonl.gz", gz(j({ startedAt: "2026-10-31T00:00:00Z", n: 1 })));
  put("s-index.json", JSON.stringify({ months: [{ month: "2026-10", first: "2026-10-31T00:00:00Z", last: "2026-10-31T00:00:00Z" }] }));
  assert.deepEqual(F.readJsonlRange(live, "2026-10-01T00:00:00Z", null, { field: "startedAt" }).map((r) => r.n), [1, 3]);
  assert.deepEqual(F.readJsonlRange(live, "2026-10-01T00:00:00Z", "2026-10-15T00:00:00Z", { field: "startedAt" }), []);
});

test("a torn line in the live file and in a .gz are both skipped", () => {
  const live = put("t.jsonl", '{"n":2}\n{"n":\n{"n":3}\n');
  put("t-2026-10.jsonl.gz", gz('{"n":1}\n{"bad\n'));
  assert.deepEqual(F.readJsonl(live, { archives: true }).map((r) => r.n), [1, 2, 3]);
});

test("readJsonlCached stays live-only", () => {
  const live = put("u.jsonl", j({ n: 2 }));
  put("u-2026-10.jsonl.gz", gz(j({ n: 1 })));
  assert.deepEqual(F.readJsonlCached(live).map((r) => r.n), [2]);
});

test("the agent hook and files.js still load on their own", () => {
  const a = spawnSync(process.execPath, ["--check", "tools/agent-hook.mjs"], { cwd: APP });
  assert.equal(a.status, 0, String(a.stderr));
  const b = spawnSync(process.execPath, ["-e", "import('./src/pipeline/files.js').then(()=>process.exit(0),()=>process.exit(1))"], { cwd: APP });
  assert.equal(b.status, 0, String(b.stderr));
  assert.ok(!/^import .* from "(?!node:)/m.test(fs.readFileSync(path.join(APP, "src/pipeline/files.js"), "utf8")));
});
