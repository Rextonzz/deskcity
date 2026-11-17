// Version history for Admin. Two halves, so it shows both what changed and that the change really reached the PC:
// - CHANGELOG.json (in the app folder, sent with each update): a dated note per update, newest first.
// - On every start the app fingerprints its own code files and, when any changed since the last start, logs which
//   ones (data/versions/starts.jsonl). Files that changed with no changelog note since the last start show up as
//   "changed without a note", so nothing slips in unlogged.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolvePath, readJson, writeJsonAtomic, readJsonl, appendJsonl, listFiles } from "./util.js";
import { logEvent } from "./runlog.js";
import { hubSettings } from "../hub/settings.js";

const DIRS = ["src", "public", "python"];
const FILES = ["server.js", "package.json", "start-pipeline.cmd", "install-autostart.cmd", "start-pipeline.sh", "linux/setup.sh"];
const STORE = () => resolvePath("data/versions");

const CODE_FILE = /\.(js|mjs|cjs|html|css|py|json|txt|cmd)$/i;

function fingerprint() {
  const files = DIRS.flatMap((d) => listFiles(resolvePath(d), { match: CODE_FILE }));
  for (const f of FILES) if (fs.existsSync(resolvePath(f))) files.push(resolvePath(f));
  const root = resolvePath(".");
  return Object.fromEntries(files.map((f) => [path.relative(root, f).replace(/\\/g, "/"), crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex").slice(0, 12)]));
}

export const changelog = () => readJson(resolvePath("CHANGELOG.json"), []);

// Called once when the app starts.
export function recordStart() {
  try {
    const now = fingerprint();
    const prevFile = path.join(STORE(), "files.json");
    const prev = readJson(prevFile, null);
    const notes = changelog();
    const entry = { at: new Date().toISOString(), note: notes[0]?.title || null, noteAt: notes[0]?.at || null, notes: notes.length, files: Object.keys(now).length };
    if (prev) {
      entry.changed = Object.keys(now).filter((f) => prev[f] && prev[f] !== now[f]);
      entry.added = Object.keys(now).filter((f) => !prev[f]);
      entry.removed = Object.keys(prev).filter((f) => !now[f]);
    } else entry.first = true;
    const touched = (entry.changed?.length || 0) + (entry.added?.length || 0) + (entry.removed?.length || 0);
    const starts = readStarts();
    const last = starts.at(-1);
    // Code changed, but no changelog note added since the last start. Counted by notes, not dates, so a note whose
    // time was corrected later (2026-10-19) doesn't read as missing.
    if (touched && notes[0] && last && (last.notes != null ? notes.length <= last.notes : last.noteAt && notes[0].at <= last.noteAt)) entry.unnoted = true;
    if (touched && !notes.length) entry.unnoted = true;
    if (touched || entry.first) {
      appendJsonl(path.join(STORE(), "starts.jsonl"), entry);
      logEvent("app update", { trigger: "app", note: entry.note, changed: touched, unnoted: entry.unnoted || undefined });
    }
    writeJsonAtomic(prevFile, now, 0);
    trackWhatsNew();
    return entry;
  } catch (err) {
    console.warn(`Couldn't record the version: ${err.message}`);
    return null;
  }
}

// "What's new" for Admin (Updates card): the notes this hub has not run before. On each start the app records which version
// (the kit version plus the newest note) it runs. When that differs from the last start, the old record is kept as "previous"
// and the notes that were not in it are the ones to show. No outside request: it only compares notes already on this PC.
const SEEN = () => path.join(STORE(), "whatsnew.json");
const noteKey = (n) => `${n.at}|${n.title}`;
export const kitVersion = () => hubSettings().kit?.version || null;
function trackWhatsNew() {
  const notes = changelog();
  const here = { version: kitVersion(), top: notes[0] ? noteKey(notes[0]) : null, keys: notes.slice(0, 400).map(noteKey), at: new Date().toISOString() };
  const seen = readJson(SEEN(), null);
  if (!seen?.current) return writeJsonAtomic(SEEN(), { current: here, previous: null }, 2);
  if (seen.current.version === here.version && seen.current.top === here.top) return;
  writeJsonAtomic(SEEN(), { current: here, previous: seen.current }, 2);
}
// The newest notes that were not there at the last start on a different version, newest first (at most 20).
export function whatsNew() {
  const seen = readJson(SEEN(), null);
  if (!seen?.previous) return { since: null, from: null, notes: [] };
  const had = new Set(seen.previous.keys || []);
  return { since: seen.current.at, from: seen.previous.version, notes: changelog().filter((n) => !had.has(noteKey(n))).slice(0, 20) };
}

function readStarts() {
  return readJsonl(path.join(STORE(), "starts.jsonl"));
}

// For Admin: the changelog, each note marked with when it first ran on this PC, plus updates that came with no note.
export function versionHistory() {
  const starts = readStarts();
  const notes = changelog().map((n) => ({ ...n, ranAt: starts.find((s) => s.noteAt === n.at)?.at || null }));
  return {
    running: notes[0] || null,
    notes,
    updates: starts.slice(-30).reverse(),
    unnoted: starts.filter((s) => s.unnoted).slice(-10).reverse(),
    whatsNew: whatsNew(),
    lastUpdate: readJson(resolvePath("data/update-last.json"), null),
  };
}
