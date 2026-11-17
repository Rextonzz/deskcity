// The monthly roll (data plan 04): old months move to .jsonl.gz beside the live log, nothing is lost, readers keep working.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { hub, app } from "./helper.mjs";

const { A, root } = await hub();
fs.writeFileSync(path.join(root, "pipeline.config.json"), JSON.stringify({ backup: { hour: 0 }, channels: {} }));
const R = await import(app("src/pipeline/roll.js"));
const F = await import(app("src/pipeline/files.js"));
const NOW = new Date("2026-11-16T12:00:00Z");
const d = path.join(root, "data", "rolltest");
fs.mkdirSync(d, { recursive: true });
let n = 0;
const fresh = (name = "x") => path.join(d, `${name}${++n}.jsonl`);
const row = (at, extra = {}) => JSON.stringify({ at, ...extra });
const write = (f, lines) => fs.writeFileSync(f, lines.join("\n") + (lines.length ? "\n" : ""));
const gunz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString("utf8").split("\n").filter(Boolean);
const liveLines = (f) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean);
const age = (f, ms) => { const t = new Date(NOW.getTime() - ms); fs.utimesSync(f, t, t); }; // mtime ms before NOW (the clock these tests roll at)

test("rollFile moves October lines to events-2026-10.jsonl.gz and writes the index", () => {
  const f = path.join(d, "events.jsonl");
  const oct = [row("2026-10-03T10:00:00Z", { n: 1 }), row("2026-10-20T10:00:00Z", { n: 2 })];
  const nov = [row("2026-11-02T10:00:00Z", { n: 3 })];
  write(f, [...oct, ...nov]);
  const r = R.rollFile(f, { field: "at", now: NOW });
  assert.deepEqual(r.months, { "2026-10": 2 });
  assert.deepEqual(gunz(path.join(d, "events-2026-10.jsonl.gz")), oct);
  assert.deepEqual(liveLines(f), nov);
  const idx = JSON.parse(fs.readFileSync(path.join(d, "events-index.json"), "utf8"));
  assert.equal(idx.file, "events.jsonl");
  assert.equal(idx.months.length, 1);
  assert.deepEqual({ ...idx.months[0], gzBytes: 0, bytes: 0 }, { month: "2026-10", file: "events-2026-10.jsonl.gz", lines: 2, bytes: 0, gzBytes: 0, first: "2026-10-03T10:00:00Z", last: "2026-10-20T10:00:00Z" });
  assert.ok(idx.months[0].gzBytes > 0 && idx.months[0].bytes > 0);
});

test("a second roll appends a member; rolling the same lines twice counts them once", () => {
  const f = path.join(d, "ev2.jsonl");
  const a = row("2026-10-03T10:00:00Z", { n: 1 }), b = row("2026-10-25T10:00:00Z", { n: 2 });
  write(f, [a, row("2026-11-05T10:00:00Z")]);
  R.rollFile(f, { now: NOW });
  write(f, [b, a, row("2026-11-05T10:00:00Z")]); // a is already in October (a crash replay)
  R.rollFile(f, { now: NOW });
  assert.deepEqual(gunz(path.join(d, "ev2-2026-10.jsonl.gz")), [a, b]);
  const idx = JSON.parse(fs.readFileSync(path.join(d, "ev2-index.json"), "utf8"));
  assert.equal(idx.months[0].lines, 2);
  assert.deepEqual(F.readJsonl(f, { archives: true }).map((r) => r.n ?? null), [1, 2, null]);
});

test("a live line without a date stays in the live file", () => {
  const f = fresh("nodate");
  write(f, [row("2026-10-03T10:00:00Z"), '{"torn":', JSON.stringify({ no: "date" }), row("2026-11-05T10:00:00Z")]);
  R.rollFile(f, { now: NOW });
  assert.deepEqual(liveLines(f), ['{"torn":', JSON.stringify({ no: "date" }), row("2026-11-05T10:00:00Z")]);
});

test("rollOverflow keeps the last n lines and every cut line is in its month file", () => {
  const f = path.join(d, "over.jsonl");
  const lines = [];
  for (let i = 0; i < 10; i++) lines.push(row(i < 4 ? `2026-09-0${i + 1}T10:00:00Z` : i < 7 ? `2026-10-0${i}T10:00:00Z` : `2026-11-0${i - 6}T10:00:00Z`, { i }));
  write(f, lines);
  assert.equal(R.rollOverflow(f, 10), null, "not over: nothing happens");
  const r = R.rollOverflow(f, 3);
  assert.equal(r.rolled, 7);
  assert.deepEqual(liveLines(f), lines.slice(7));
  const sep = gunz(path.join(d, "over-2026-09.jsonl.gz")), oct = gunz(path.join(d, "over-2026-10.jsonl.gz"));
  assert.equal(sep.length + oct.length + liveLines(f).length, 10);
  assert.deepEqual([...sep, ...oct], lines.slice(0, 7));
});

test("rollOverflow puts an undated cut line with its neighbour instead of dropping it", () => {
  const f = path.join(d, "undated.jsonl");
  const lines = [row("2026-10-02T10:00:00Z"), "garbage line", row("2026-10-03T10:00:00Z"), row("2026-11-03T10:00:00Z")];
  write(f, lines);
  R.rollOverflow(f, 1);
  assert.deepEqual(gunz(path.join(d, "undated-2026-10.jsonl.gz")), lines.slice(0, 3));
});

test("rollOverflowRows (spend): old rows go to month files, newer stay, totals are kept", () => {
  const f = path.join(d, "spendx.jsonl");
  const old = [{ at: "2025-08-02T10:00:00Z", costUsd: 1 }, { at: "2025-09-02T10:00:00Z", costUsd: 2 }];
  const keep = [{ at: "2026-11-02T10:00:00Z", costUsd: 4 }];
  write(f, [...old, ...keep].map((r) => JSON.stringify(r)));
  R.rollOverflowRows(f, old, keep, { field: "at" });
  assert.deepEqual(F.readJsonl(f), keep);
  const all = F.readJsonl(f, { archives: true });
  assert.equal(all.reduce((s, r) => s + r.costUsd, 0), 7);
  assert.equal(F.jsonlArchives(f).length, 2);
});

test("trimSpend rolls rows older than 13 months instead of dropping them", async () => {
  const S = await import(app("src/pipeline/spend.js"));
  const f = path.join(root, "data", "spend.jsonl");
  const now = new Date();
  const oldAt = new Date(Date.UTC(now.getUTCFullYear() - 2, 0, 15, 12)).toISOString();
  write(f, [JSON.stringify({ at: oldAt, costUsd: 5, desk: "x", room: "hub" }), JSON.stringify({ at: now.toISOString(), costUsd: 1, desk: "x", room: "hub" })]);
  S.trimSpend(now);
  assert.equal(F.readJsonl(f).length, 1);
  assert.equal(F.readJsonl(f, { archives: true }).length, 2);
});

test("rollAll skips a file touched under 60 seconds ago and does nothing without a data folder", () => {
  const f = path.join(root, "data", "logs", "runs.jsonl");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  write(f, [row("2026-10-03T10:00:00Z", { startedAt: "2026-10-03T10:00:00Z" })]);
  age(f, 10000);
  assert.deepEqual(R.rollAll({ now: NOW }).files, [], "fresh file skipped");
  assert.equal(liveLines(f).length, 1);
  age(f, 120000);
  const r = R.rollAll({ now: NOW });
  assert.equal(r.files.length, 1);
  assert.equal(liveLines(f).length, 0);
  assert.ok(fs.existsSync(path.join(root, "data", "logs", "runs-2026-10.jsonl.gz")));
});

test("rollTick runs once a day and stores data/roll.json; a failure is retried after an hour", () => {
  const state = path.join(root, "data", "roll.json");
  fs.rmSync(state, { force: true });
  let calls = 0, boom = true;
  const roll = () => { calls++; if (boom) throw new Error("disk full"); return { files: [], freedKB: 0 }; };
  const t0 = new Date("2026-11-16T12:00:00Z");
  const s1 = R.rollTick({ now: t0, roll });
  assert.equal(s1.ok, false);
  assert.equal(calls, 1);
  assert.equal(R.rollTick({ now: new Date(t0.getTime() + 30 * 60000), roll }), null, "not before an hour");
  assert.equal(calls, 1);
  boom = false;
  const s2 = R.rollTick({ now: new Date(t0.getTime() + 61 * 60000), roll });
  assert.equal(s2.ok, true);
  assert.equal(calls, 2);
  assert.equal(R.rollTick({ now: new Date(t0.getTime() + 2 * 3600000), roll }), null, "once a day");
  assert.equal(JSON.parse(fs.readFileSync(state, "utf8")).ok, true);
  assert.equal(R.rollStatus().ok, true);
});

test("readEventsSince reaches archived months; readEvents() stays live-only", () => {
  const ev = path.join(root, "data", "agents", "events.jsonl");
  const arch = path.join(root, "data", "agents", "events-2026-10.jsonl.gz");
  fs.writeFileSync(arch, zlib.gzipSync(JSON.stringify({ startedAt: "2026-10-05T10:00:00Z", desk: "a", kind: "old" }) + "\n"));
  write(ev, [JSON.stringify({ startedAt: "2026-11-05T10:00:00Z", desk: "a", kind: "new" })]);
  const since = A.readEventsSince("2026-10-01T00:00:00Z");
  assert.deepEqual(since.map((e) => e.kind), ["old", "new"]);
  assert.deepEqual(A.readEventsSince("2026-11-01T00:00:00Z").map((e) => e.kind), ["new"]);
  fs.rmSync(arch);
});

test("a text log (crash.log): October lines go to crash-2026-10.log.gz", () => {
  const f = path.join(root, "data", "logs", "crash.log");
  const oct = ["2026-10-04T08:00:00.000Z boom one", "2026-10-09T08:00:00.000Z boom two"];
  fs.writeFileSync(f, [...oct, "2026-11-10T08:00:00.000Z boom three", "no timestamp here"].join("\n") + "\n");
  age(f, 120000);
  R.rollAll({ now: NOW });
  assert.deepEqual(gunz(path.join(root, "data", "logs", "crash-2026-10.log.gz")), oct);
  assert.deepEqual(liveLines(f), ["2026-11-10T08:00:00.000Z boom three", "no timestamp here"]);
  const idx = JSON.parse(fs.readFileSync(path.join(root, "data", "logs", "crash-index.json"), "utf8"));
  assert.equal(idx.months[0].lines, 2);
});

test("console.log.old older than a day becomes console.log.old.gz", () => {
  const old = path.join(root, "data", "logs", "console.log.old");
  fs.writeFileSync(old, "previous console output\n".repeat(50));
  age(old, 2 * 864e5);
  R.rollAll({ now: NOW });
  assert.ok(!fs.existsSync(old));
  assert.equal(zlib.gunzipSync(fs.readFileSync(old + ".gz")).toString().split("\n").filter(Boolean).length, 50);
});

test("appending after a roll still works and the next roll in the same month does nothing", () => {
  const f = fresh("after");
  write(f, [row("2026-10-03T10:00:00Z"), row("2026-11-03T10:00:00Z")]);
  R.rollFile(f, { now: NOW });
  F.appendJsonl(f, { at: "2026-11-10T10:00:00Z" });
  assert.equal(liveLines(f).length, 2);
  const before = fs.readdirSync(d).length;
  const r = R.rollFile(f, { now: NOW });
  assert.deepEqual(r.months, {});
  assert.equal(r.bytesBefore, r.bytesAfter);
  assert.equal(fs.readdirSync(d).length, before);
});

test("20,000 events: rollOverflow to 5,000 leaves 5,000 live and a cached read is quick", () => {
  const f = path.join(d, "big.jsonl");
  const lines = [];
  for (let i = 0; i < 20000; i++) lines.push(JSON.stringify({ startedAt: new Date(Date.UTC(2026, 9, 1) + i * 120000).toISOString(), desk: "d" + (i % 7), kind: "tool", tool: "Read", pad: "x".repeat(60) }));
  write(f, lines);
  R.rollOverflow(f, 5000, { field: "startedAt" });
  assert.equal(liveLines(f).length, 5000);
  const t = performance.now();
  const rows = F.readJsonlCached(f);
  assert.equal(rows.length, 5000);
  assert.ok(performance.now() - t < 500, "parses fast");
  const all = F.readJsonl(f, { archives: true });
  assert.equal(all.length, 20000);
});
