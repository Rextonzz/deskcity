// Shared file helpers (src/pipeline/files.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { hub } from "./helper.mjs";

hub();
const { readJson, readJsonl, appendJsonl, writeJsonAtomic, readJsonlCached, keepLastLines, listFiles, countLines } = await import("../../src/pipeline/files.js");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "files-test-"));

test("readJson: missing and corrupt give the fallback; strict throws on corrupt only", () => {
  const f = path.join(dir, "a.json");
  assert.deepEqual(readJson(f, { x: 1 }), { x: 1 });
  assert.deepEqual(readJson(f, null, { strict: true }), null);
  fs.writeFileSync(f, "{ not json");
  assert.deepEqual(readJson(f, []), []);
  assert.throws(() => readJson(f, [], { strict: true }));
  fs.writeFileSync(f, '{"ok":true}');
  assert.deepEqual(readJson(f, null), { ok: true });
});

test("readJsonl skips a torn line; a missing file is empty", () => {
  const f = path.join(dir, "b.jsonl");
  assert.deepEqual(readJsonl(f), []);
  fs.writeFileSync(f, '{"a":1}\n{"b":\n\n{"c":3}\n');
  assert.deepEqual(readJsonl(f), [{ a: 1 }, { c: 3 }]);
  assert.deepEqual(readJsonl(path.join(dir, "none.jsonl"), { strict: true }), []);
});

test("appendJsonl: variadic, makes a nested folder, no values writes nothing", () => {
  const f = path.join(dir, "deep", "er", "c.jsonl");
  appendJsonl(f);
  assert.equal(fs.existsSync(f), false);
  appendJsonl(f, { a: 1 });
  appendJsonl(f, { b: 2 }, { c: 3 });
  assert.deepEqual(readJsonl(f), [{ a: 1 }, { b: 2 }, { c: 3 }]);
});

test("writeJsonAtomic leaves no .tmp file", () => {
  const f = path.join(dir, "w", "d.json");
  writeJsonAtomic(f, { n: 1 });
  assert.deepEqual(readJson(f, null), { n: 1 });
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ["d.json"]);
});

test("files.js imports only node: modules", () => {
  const src = fs.readFileSync(fileURLToPath(new URL("../../src/pipeline/files.js", import.meta.url)), "utf8");
  const specs = [...src.matchAll(/^\s*import\s[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
  assert.ok(specs.length > 0);
  for (const s of specs) assert.ok(s.startsWith("node:"), s);
});

test("readJsonlCached: same rows while unchanged, new rows after an append, one slot per file", () => {
  const a = path.join(dir, "c1.jsonl"), b = path.join(dir, "c2.jsonl");
  assert.deepEqual(readJsonlCached(a), []);
  appendJsonl(a, { n: 1 });
  appendJsonl(b, { other: 1 }, { other: 2 });
  const r1 = readJsonlCached(a);
  assert.deepEqual(r1, [{ n: 1 }]);
  assert.deepEqual(readJsonlCached(b), [{ other: 1 }, { other: 2 }]);
  assert.equal(readJsonlCached(a), r1, "same array while the file is unchanged, even after reading another file");
  appendJsonl(a, { n: 2 });
  assert.deepEqual(readJsonlCached(a), [{ n: 1 }, { n: 2 }]);
});

test("readJsonlCached: a read error caches nothing and the next read retries", () => {
  const f = path.join(dir, "c3.jsonl");
  fs.mkdirSync(f); // a folder: stat works, reading throws EISDIR
  assert.throws(() => readJsonlCached(f));
  fs.rmdirSync(f);
  appendJsonl(f, { ok: 1 });
  assert.deepEqual(readJsonlCached(f), [{ ok: 1 }]);
});

test("keepLastLines keeps the last N lines and leaves no temp file", () => {
  const f = path.join(dir, "k.log");
  fs.writeFileSync(f, "1\n2\n3\n4\n5\n");
  keepLastLines(f, 10);
  assert.equal(fs.readFileSync(f, "utf8"), "1\n2\n3\n4\n5\n");
  keepLastLines(f, 2);
  assert.equal(fs.readFileSync(f, "utf8"), "4\n5\n");
  assert.deepEqual(fs.readdirSync(dir).filter((x) => x.endsWith(".tmp")), []);
});

test("listFiles: match, skip, nested folders, a missing folder", () => {
  const root = path.join(dir, "tree");
  fs.mkdirSync(path.join(root, "a", "b"), { recursive: true });
  fs.mkdirSync(path.join(root, "skipme"));
  for (const f of ["x.js", "y.txt", "a/z.js", "a/b/w.JS", "skipme/q.js"]) fs.writeFileSync(path.join(root, f), "one\ntwo\n");
  const rel = (l) => l.map((p) => path.relative(root, p).split(path.sep).join("/")).sort();
  assert.deepEqual(rel(listFiles(root)), ["a/b/w.JS", "a/z.js", "skipme/q.js", "x.js", "y.txt"]);
  assert.deepEqual(rel(listFiles(root, { match: /\.js$/i, skip: new Set(["skipme"]) })), ["a/b/w.JS", "a/z.js", "x.js"]);
  assert.deepEqual(listFiles(path.join(root, "nope")), []);
});

test("countLines: counts lines, groups by label, skips unreadable files", () => {
  const root = path.join(dir, "count");
  fs.mkdirSync(path.join(root, "sub"), { recursive: true });
  fs.writeFileSync(path.join(root, "a.js"), "1\n2\n3");
  fs.writeFileSync(path.join(root, "b.py"), "1\n");
  const paths = [path.join(root, "a.js"), path.join(root, "b.py"), path.join(root, "missing.js"), path.join(root, "sub")];
  assert.deepEqual(countLines(paths, (p) => p.split(".").pop()), { files: 2, lines: 5, by: { js: 3, py: 2 } });
  assert.deepEqual(countLines(paths.slice(0, 1)), { files: 1, lines: 3, by: {} });
  assert.deepEqual(countLines([]), { files: 0, lines: 0, by: {} });
});
