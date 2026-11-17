// Monthly roll of the hub's growing logs (data plan 04). The current month of each log stays a plain file; older months
// move into <name>-YYYY-MM.jsonl.gz (or .log.gz) beside it, with <name>-index.json saying what each month holds. Lines
// that a trim cuts out of a live file (events 20,000, runs 5,000, spend older than 13 months) are rolled into their
// month instead of being thrown away. Readers still see only the live file unless they ask (readJsonl archives: true,
// readJsonlRange). Months are calendar months in the hub's time zone.
// Imports no hub module that imports this one (agents.js, runlog.js and spend.js call in here), so import cycles are safe.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { resolvePath, writeFileAtomic, writeJsonAtomic, readJson, pipelineTz, dueAt, backupHour } from "./util.js";
import { partsIn } from "./fmt.js";
import { hubTz } from "../hub/settings.js";

// The logs that are rolled. Add a file here only when it passes about 1 MB.
export const ROLL_FILES = () => [
  { file: resolvePath("data/agents/events.jsonl"), field: "startedAt", kind: "jsonl" },
  { file: resolvePath("data/logs/runs.jsonl"), field: "startedAt", kind: "jsonl" },
  { file: resolvePath("data/spend.jsonl"), field: "at", kind: "jsonl" },
  { file: resolvePath("data/logs/crash.log"), field: null, kind: "text" },
];
const STATE = () => resolvePath("data/roll.json");
const FRESH_MS = 60000; // a file written to in the last minute is left for the next pass

// "YYYY-MM" of a date value in the hub's time zone, or null if it isn't a date.
export function monthOf(value, tz = hubTz()) {
  if (value == null || value === "") return null;
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return null;
  const p = partsIn(tz, t);
  return `${p.y}-${String(p.m).padStart(2, "0")}`;
}

const nameParts = (file, kind) => {
  const ext = kind === "text" ? path.extname(file) : ".jsonl";
  return { dir: path.dirname(file), base: path.basename(file, ext), ext };
};
const archiveName = (file, kind, month) => {
  const { dir, base } = nameParts(file, kind);
  return path.join(dir, `${base}-${month}.${kind === "text" ? "log" : "jsonl"}.gz`);
};
const indexPath = (file, kind) => { const { dir, base } = nameParts(file, kind); return path.join(dir, `${base}-index.json`); };

// A whole file as text; .gz is gunzipped (a damaged one gives what could be read). A missing file is "".
function textOf(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (err) { if (err.code === "ENOENT") return { text: "", buf: Buffer.alloc(0) }; throw err; }
  if (!file.endsWith(".gz")) return { text: buf.toString("utf8"), buf };
  let text = "";
  try { text = zlib.gunzipSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString("utf8"); } catch {}
  return { text, buf };
}
const linesOf = (text) => text.split("\n").filter((l) => l.trim());

// Date value of one line, for the index: the field of a JSON row, or the leading timestamp of a text line.
function dateOfLine(line, field, kind) {
  if (kind === "text") return /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?/.test(line) ? line.slice(0, 24) : /^\d{4}-\d{2}/.test(line) ? line.slice(0, 10) : null;
  try { const r = JSON.parse(line); const d = r?.[field] ?? r?.startedAt ?? r?.at; return d == null ? null : String(d); } catch { return null; }
}
// The month a line belongs to, or null when it can't be told (such a line stays in the live file).
const monthOfLine = (line, field, kind) => {
  if (kind === "text") return /^\d{4}-\d{2}/.test(line) ? line.slice(0, 7) : null;
  return monthOf(dateOfLine(line, field, kind));
};

// Add lines to a month file as one more gzip member (a month rolled twice still reads as one stream), skip lines the
// month file already holds (so a crash between "month written" and "live rewritten" can't double a month), and update
// the index. Returns the number of lines actually added.
function appendToMonth(file, month, lines, { field, kind }) {
  const arch = archiveName(file, kind, month);
  const { text, buf } = textOf(arch);
  const have = new Set(linesOf(text));
  const fresh = lines.filter((l) => !have.has(l));
  if (!fresh.length) return 0;
  const add = fresh.join("\n") + "\n";
  const gz = zlib.gzipSync(Buffer.from(add));
  const merged = Buffer.concat([buf, gz]);
  writeFileAtomic(arch, merged);
  const dates = fresh.map((l) => dateOfLine(l, field, kind)).filter(Boolean).sort();
  const ip = indexPath(file, kind);
  const idx = readJson(ip, null);
  const months = Array.isArray(idx?.months) ? idx.months.filter((m) => m.month !== month) : [];
  const old = Array.isArray(idx?.months) ? idx.months.find((m) => m.month === month) : null;
  months.push({
    month, file: path.basename(arch),
    lines: (old?.lines || 0) + fresh.length,
    bytes: (old?.bytes || 0) + Buffer.byteLength(add),
    gzBytes: merged.length,
    first: [old?.first, dates[0]].filter(Boolean).sort()[0] || null,
    last: [old?.last, dates.at(-1)].filter(Boolean).sort().at(-1) || null,
  });
  months.sort((a, b) => a.month.localeCompare(b.month));
  const { base, ext } = nameParts(file, kind);
  writeJsonAtomic(ip, { file: base + ext, months });
  return fresh.length;
}
function rewriteLive(file, lines) {
  writeFileAtomic(file, lines.length ? lines.join("\n") + "\n" : "");
}
function rollGroups(file, groups, opts) {
  const months = {};
  for (const [month, ls] of Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))) months[month] = appendToMonth(file, month, ls, opts);
  return months;
}

// Roll every line from a month before the current one. Writes nothing when there is nothing to roll.
export function rollFile(file, { field = "at", now = new Date(), kind = "jsonl" } = {}) {
  const { text } = textOf(file);
  const bytesBefore = Buffer.byteLength(text);
  const lines = linesOf(text);
  const cur = monthOf(now);
  const keep = [], groups = {};
  for (const l of lines) {
    const m = monthOfLine(l, field, kind);
    if (m && m < cur) (groups[m] ||= []).push(l);
    else keep.push(l);
  }
  const res = { file, months: {}, kept: keep.length, bytesBefore, bytesAfter: bytesBefore };
  if (!Object.keys(groups).length) return res;
  res.months = rollGroups(file, groups, { field, kind }); // month files first, then the live file
  rewriteLive(file, keep);
  res.bytesAfter = fs.statSync(file).size;
  return res;
}

// The replacement for keepLastLines: more than keepLast lines, the older ones go to their month files (current-month
// lines included, they are being cut out of the live file) and the live file keeps the last keepLast.
export function rollOverflow(file, keepLast, { field = "at", kind = "jsonl" } = {}) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (err) { if (err.code === "ENOENT") return null; throw err; }
  const lines = linesOf(text);
  if (lines.length <= keepLast) return null;
  const cut = lines.slice(0, lines.length - keepLast);
  rollCut(file, cut, { field, kind });
  rewriteLive(file, lines.slice(lines.length - keepLast));
  return { file, rolled: cut.length, kept: keepLast };
}
// Lines with no usable date join the month of the line before them (or after, or this month): nothing is dropped.
function rollCut(file, cut, { field, kind }) {
  const ms = cut.map((l) => monthOfLine(l, field, kind));
  const fallback = ms.find(Boolean) || monthOf(new Date());
  let prev = null;
  const groups = {};
  cut.forEach((l, i) => { const m = ms[i] || prev || fallback; prev = m; (groups[m] ||= []).push(l); });
  rollGroups(file, groups, { field, kind });
}
// For a log that is trimmed by rows (spend): oldRows go to their month files, then the live file is rewritten with keepRows.
export function rollOverflowRows(file, oldRows, keepRows, { field = "at" } = {}) {
  const cut = oldRows.map((r) => JSON.stringify(r));
  if (cut.length) rollCut(file, cut, { field, kind: "jsonl" });
  rewriteLive(file, keepRows.map((r) => JSON.stringify(r)));
}

// Everything on the list, plus the old console log. A file touched in the last minute is skipped.
export function rollAll({ now = new Date() } = {}) {
  const files = [];
  let freed = 0;
  for (const { file, field, kind } of ROLL_FILES()) {
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    if (!st.isFile() || now.getTime() - st.mtimeMs < FRESH_MS) continue;
    const r = rollFile(file, { field, now, kind });
    freed += Math.max(0, r.bytesBefore - r.bytesAfter);
    if (Object.keys(r.months).length) files.push({ file: path.basename(file), months: r.months });
  }
  // console.log.old is rewritten by server.js on each rotation, so the .gz always holds the previous one
  const old = resolvePath("data/logs/console.log.old");
  try {
    const st = fs.statSync(old);
    if (now.getTime() - st.mtimeMs > 864e5) {
      writeFileAtomic(old + ".gz", zlib.gzipSync(fs.readFileSync(old)));
      fs.rmSync(old, { force: true });
      freed += st.size;
      files.push({ file: "console.log.old", months: { gz: 1 } });
    }
  } catch (err) { if (err.code !== "ENOENT") throw err; }
  return { files, freedKB: Math.round(freed / 1024) };
}

// Called every minute (when server.js wires it): once a night, an hour after the backup. A failed night is retried
// after an hour. roll: a stand-in for tests.
export function rollTick({ now = new Date(), roll = rollAll } = {}) {
  const last = readJson(STATE(), null);
  if (last && !last.ok && now.getTime() - Date.parse(last.at) < 3600000) return null;
  if (!dueAt({ tz: pipelineTz(), hour: (backupHour() + 1) % 24, last: last?.ok ? last.at : null, now })) return null;
  let status;
  try {
    const r = roll({ now });
    status = { at: now.toISOString(), ok: true, results: r.files, freedKB: r.freedKB };
  } catch (err) {
    status = { at: now.toISOString(), ok: false, error: err.message };
  }
  writeJsonAtomic(STATE(), status);
  import("./runlog.js").then((m) => m.logEvent("log roll", { trigger: "nightly", files: status.results?.length ?? 0, freedKB: status.freedKB ?? 0, error: status.error })).catch(() => {});
  return status;
}

// What the admin page can show: last run, and per log the live size and the months rolled.
export function rollStatus() {
  const st = readJson(STATE(), null);
  return {
    at: st?.at || null, ok: st?.ok ?? null, error: st?.error || null,
    files: ROLL_FILES().map(({ file, kind }) => {
      let liveBytes = 0;
      try { liveBytes = fs.statSync(file).size; } catch {}
      const idx = readJson(indexPath(file, kind), null);
      const months = Array.isArray(idx?.months) ? idx.months : [];
      return { file: path.basename(file), liveBytes, months: months.map((m) => m.month), archiveBytes: months.reduce((s, m) => s + (m.gzBytes || 0), 0) };
    }),
  };
}

