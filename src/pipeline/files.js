// @ts-check
// Shared file readers and writers. Imports only node: modules, so the Claude Code hook (tools/agent-hook.mjs) can use
// it without loading .env or config. Every helper is an `export function` declaration so import cycles are safe.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// Read a JSON file. A missing or unreadable file gives the fallback. strict: only a missing file gives the fallback;
// any other error (a corrupt file, a permission problem) is thrown.
export function readJson(file, fallback, { strict = false } = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (strict && err.code !== "ENOENT") throw err;
    return fallback;
  }
}

// Write to a temp file, then rename over the real one (code review 2026-10-22): a crash mid-write leaves the old file
// whole instead of an empty or cut-off one. Unique temp name so two writers never share it.
// Windows briefly locks a file while Defender or the indexer scans it, so a rename over it fails with EPERM/EBUSY/EACCES for
// a moment (2026-11-22: a live piece failed at intake with "A file is locked"). Retry a few times, a short pause apart.
export function renameRetry(from, to, tries = 6) {
  for (let i = 0; ; i++) {
    try { return fs.renameSync(from, to); } catch (err) {
      if (i >= tries - 1 || !["EPERM", "EBUSY", "EACCES"].includes(err?.code)) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * (i + 1));
    }
  }
}
export function writeFileAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmp, text);
  try {
    renameRetry(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}
export function writeJsonAtomic(file, data, indent = 2) {
  writeFileAtomic(file, JSON.stringify(data, null, indent));
}

// The hub's .jsonl files: one JSON value per line, appended to, never edited. A bad line is skipped (one torn write
// doesn't lose the rest); a missing file reads as empty. strict: any error other than a missing file is thrown.
// Three modes: (1) a plain .jsonl path reads that live file only (the default, as every existing caller expects);
// (2) a path ending in .gz is gunzipped first (a cut-off .gz gives the rows before the damage; strict throws instead);
// (3) archives: true reads the rolled months (<base>-YYYY-MM.jsonl.gz beside the file, oldest first) before the live rows.
function readText(file, { strict }) {
  const buf = fs.readFileSync(file);
  if (!file.endsWith(".gz")) return buf.toString("utf8");
  // finishFlush keeps what could be read from a cut-off file; concatenated gzip members read as one stream
  return zlib.gunzipSync(buf, { finishFlush: strict ? zlib.constants.Z_FINISH : zlib.constants.Z_SYNC_FLUSH }).toString("utf8");
}
function parseRows(text) {
  const out = [];
  for (const l of text.split("\n")) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch {} }
  return out;
}
function rowsOf(file, strict) {
  let text;
  try { text = readText(file, { strict }); } catch (err) {
    if (err.code === "ENOENT") return [];
    if (strict) throw err;
    return [];
  }
  return parseRows(text);
}
export function readJsonl(file, { strict = false, archives = false } = {}) {
  const out = [];
  if (archives && !file.endsWith(".gz")) for (const a of jsonlArchives(file)) out.push(...rowsOf(a, strict));
  out.push(...rowsOf(file, strict));
  return out;
}
// The rolled-up months beside a live .jsonl: full paths of <base>-YYYY-MM.jsonl.gz, oldest month first.
export function jsonlArchives(file) {
  const dir = path.dirname(file), base = path.basename(file).replace(/\.jsonl$/, "");
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter((n) => n.startsWith(base) && /^-\d{4}-\d{2}\.jsonl\.gz$/.test(n.slice(base.length)))
    .sort((a, b) => a.slice(base.length).localeCompare(b.slice(base.length)))
    .map((n) => path.join(dir, n));
}
// Rows whose date (row[field], else startedAt, else at) is within [fromIso, toIso]. Reads only the archived months that
// can overlap the window (an index file <base>-index.json with first/last per month is used when present).
export function readJsonlRange(file, fromIso, toIso = null, { field = "at", strict = false } = {}) {
  const dir = path.dirname(file), base = path.basename(file).replace(/\.jsonl$/, "");
  let index = null;
  try { index = JSON.parse(fs.readFileSync(path.join(dir, base + "-index.json"), "utf8")); } catch {}
  const out = [];
  for (const a of jsonlArchives(file)) {
    const month = path.basename(a).slice(base.length + 1, base.length + 8);
    const ent = Array.isArray(index?.months) ? index.months.find((m) => m.month === month) : null;
    let lo = ent?.first, hi = ent?.last;
    if (!lo || !hi) {
      const [y, m] = month.split("-").map(Number);
      // month names are in the hub timezone, so allow a day of slack either side
      lo = new Date(Date.UTC(y, m - 1, 1) - 864e5).toISOString();
      hi = new Date(Date.UTC(y, m, 1) + 864e5).toISOString();
    }
    if (String(hi) < fromIso || (toIso && String(lo) > toIso)) continue;
    out.push(...rowsOf(a, strict));
  }
  out.push(...rowsOf(file, strict));
  return out.filter((r) => {
    const d = r?.[field] ?? r?.startedAt ?? r?.at;
    if (d == null) return false;
    const x = String(d);
    return x >= fromIso && (!toIso || x <= toIso);
  });
}
// Append one line per value; makes the folder first. No values writes nothing.
export function appendJsonl(file, ...values) {
  if (!values.length) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, values.map((v) => JSON.stringify(v) + "\n").join(""));
}
// readJsonl for a file that's asked for often: rows are parsed once per change of the file (keyed on mtime:size, one
// slot per path). A missing file is []; a read error throws and caches nothing, so the next call retries. The rows
// are shared between callers, so treat them as read-only.
const jsonlCache = new Map();
export function readJsonlCached(file) {
  let st;
  try { st = fs.statSync(file); } catch { return []; }
  const key = `${st.mtimeMs}:${st.size}`;
  let hit = jsonlCache.get(file);
  if (!hit || hit.key !== key) {
    hit = { key, rows: readJsonl(file, { strict: true }) };
    jsonlCache.set(file, hit);
  }
  return hit.rows;
}
// Cut a line-based file (a log) down to its last n lines, atomically. Does nothing if it is already short enough.
export function keepLastLines(file, n) {
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  if (lines.length > n) writeFileAtomic(file, lines.slice(-n).join("\n") + "\n");
}

// Every file under dir (full paths, folders walked in listing order). match: a RegExp tested on the file name; skip: a
// Set of folder names not to enter. A folder that is missing or can't be read is skipped, not thrown.
/** @param {string} dir @param {{ match?: RegExp, skip?: Set<string> }} [opts] @param {string[]} [out] @returns {string[]} */
export function listFiles(dir, { match, skip } = {}, out = []) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!skip?.has(e.name)) listFiles(p, { match, skip }, out); }
    else if (!match || match.test(e.name)) out.push(p);
  }
  return out;
}
// Count the lines of each file in paths (a file that can't be read is skipped). labelOf(path) names the group the
// lines are added to in `by`; no label counts the file without a group. Returns { files, lines, by }.
/** @param {string[]} paths @param {(path: string) => string | null} [labelOf] */
export function countLines(paths, labelOf = () => null) {
  const by = {};
  let files = 0, lines = 0;
  for (const p of paths) {
    let n;
    try { n = fs.readFileSync(p, "utf8").split("\n").length; } catch { continue; }
    const label = labelOf(p);
    if (label) by[label] = (by[label] || 0) + n;
    files++;
    lines += n;
  }
  return { files, lines, by };
}
