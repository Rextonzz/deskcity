// "Free up space" (data plan 02): one list of everything that could be freed, grouped by rule, with exact paths and
// sizes. freeUpSpace() only lists. runFreeUp() acts on the groups the owner ticked (the route needs the password), and
// groups that remove footage or renders also need confirmOk. Original videos (keepOriginals), final renders in output/
// (removeOutput) and the comment page dumps (removeDebug) are each their own setting and stay off by default: while off,
// the group is shown but cannot be selected.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { jobsDir, archiveDir } from "./jobs.js";
import { planCleanup, runCleanup, planArchive, archiveSkipped, cleanupSettings } from "./cleanup.js";
import { resolvePath, listFiles, readJson, writeFileAtomic } from "./util.js";
import { logEvent } from "./runlog.js";

const DAY = 864e5;
const VIDEO = /\.(mp4|mov|mkv|webm)$/i;
const sum = (xs) => xs.reduce((s, x) => s + x.bytes, 0);
const sizeOf = (p) => { try { const st = fs.lstatSync(p); return st.isSymbolicLink() ? 0 : st.size; } catch { return 0; } };
const norm = (p) => path.resolve(p).toLowerCase();

function referencedOutputs() {
  const set = new Set();
  for (const base of [jobsDir(), archiveDir()]) {
    let names = [];
    try { names = fs.readdirSync(base); } catch {}
    for (const n of names) {
      const j = readJson(path.join(base, n, "job.json"), null);
      if (j?.data?.output) set.add(norm(j.data.output));
    }
  }
  return set;
}

// Nothing here writes. now: for tests.
export function freeUpSpace({ now = Date.now() } = {}) {
  const settings = cleanupSettings();
  const plan = planCleanup({ now, settings });
  const grace = settings.graceDays * DAY;
  const groups = [];
  const add = (g) => groups.push({ selectable: true, note: null, ...g, bytes: sum(g.items) });

  add({ key: "jobs-working", title: "Working files of finished videos (job record and thumbnail stay)", needsOk: false,
    items: plan.items.filter((i) => i.bytes > 0).map((i) => ({ id: i.id, path: path.dirname(i.remove[0]?.path || ""), bytes: i.bytes, why: `rule ${i.rule}: ${i.label}`, selectedByDefault: true })) });
  add({ key: "jobs-archive-move", title: "Archive skipped jobs (the folder moves to data/jobs-archive; finished jobs never move)", needsOk: false,
    items: planArchive({ now, settings }).map((a) => ({ id: a.id, path: a.path, bytes: a.bytes, why: `skipped ${a.ageDays} days ago`, selectedByDefault: true })) });
  add({ key: "jobs-originals", title: "Original source videos of live jobs and of skipped jobs archived over " + settings.archiveDays + " days (the only copy)", needsOk: true,
    selectable: !settings.keepOriginals, note: settings.keepOriginals ? "keepOriginals is on: originals are kept. Turn it off in settings to allow this." : null,
    items: settings.keepOriginals ? [] : plan.items.flatMap((i) => i.originals.map((o) => ({ id: i.id, path: o.path, bytes: o.bytes, why: `original of ${i.label}`, selectedByDefault: false }))) });
  add({ key: "output-live", title: "Final renders in output/ of live videos (posted to TikTok where there is one)", needsOk: true,
    selectable: settings.removeOutput, note: settings.removeOutput ? null : "Turn on cleanup.removeOutput in settings to allow this.",
    items: settings.removeOutput ? plan.items.filter((i) => i.output?.ok).map((i) => ({ id: i.id, path: i.output.path, bytes: i.output.bytes, why: `render of ${i.label}`, selectedByDefault: false })) : [] });

  const outRoot = resolvePath("output");
  const refs = referencedOutputs();
  add({ key: "output-orphans", title: "Videos in output/ that no job points to", needsOk: true,
    selectable: settings.removeOutput, note: settings.removeOutput ? null : "Turn on cleanup.removeOutput in settings to allow this.",
    items: !settings.removeOutput ? [] : listFiles(outRoot, { match: VIDEO })
      .filter((p) => !refs.has(norm(p)) && now - fs.statSync(p).mtimeMs >= grace)
      .map((p) => ({ path: p, bytes: sizeOf(p), why: "no job uses this render", selectedByDefault: false })) });

  const dbg = resolvePath("data/stats/debug");
  add({ key: "stats-debug", title: `Comment page dumps older than 7 days (${settings.debugAction === "delete" ? "deleted" : "gzipped"})`, needsOk: false,
    selectable: settings.removeDebug, note: settings.removeDebug ? null : "Turn on cleanup.removeDebug in settings to allow this.",
    items: !settings.removeDebug ? [] : listFiles(dbg, { match: /-comments\.html$/ })
      .filter((p) => now - fs.statSync(p).mtimeMs >= 7 * DAY)
      .map((p) => ({ path: p, bytes: sizeOf(p), why: settings.debugAction, selectedByDefault: true })) });

  const old = resolvePath("data/logs/console.log.old");
  add({ key: "logs-rotated", title: "Rotated console log (gzipped)", needsOk: false,
    items: fs.existsSync(old) ? [{ path: old, bytes: sizeOf(old), why: "gzip to console.log.old.gz", selectedByDefault: true }] : [] });

  return {
    at: new Date(now).toISOString(), settings, groups,
    totalBytes: sum(groups), safeBytes: sum(groups.filter((g) => !g.needsOk)),
  };
}

const inside = (p, root) => { const r = path.resolve(root) + path.sep; return path.resolve(p).startsWith(r); };
const plainFile = (p) => { try { const st = fs.lstatSync(p); return st.isFile() && !st.isSymbolicLink(); } catch { return false; } };

// Act on the ticked groups. groups: keys; ids: narrows the job groups to those job ids; confirmOk: needed for needsOk groups.
export function runFreeUp({ groups, ids = null, confirmOk = false, now = Date.now() } = {}) {
  if (!Array.isArray(groups) || !groups.length) throw new Error("Tick at least one group");
  const fresh = freeUpSpace({ now });
  const settings = fresh.settings;
  const out = { freedBytes: 0, files: 0, byGroup: {} };
  const take = (g, n, b) => { out.byGroup[g.key] = { files: n, bytes: b }; out.files += n; out.freedBytes += b; };
  const sel = fresh.groups.filter((g) => groups.includes(g.key) && g.selectable && g.items.length && (!g.needsOk || confirmOk === true));
  const want = (g) => (ids ? g.items.filter((i) => !i.id || ids.includes(i.id)) : g.items);
  const has = (k) => sel.some((g) => g.key === k);

  if (has("jobs-working") || has("jobs-originals") || has("output-live")) {
    const jobIds = [...new Set(sel.filter((g) => ["jobs-working", "jobs-originals", "output-live"].includes(g.key)).flatMap((g) => want(g).map((i) => i.id)))];
    const r = runCleanup({ ids: jobIds, working: has("jobs-working"), originals: has("jobs-originals"), output: has("output-live"), now, trigger: "button" });
    for (const k of ["jobs-working", "jobs-originals", "output-live"]) if (has(k)) take(sel.find((g) => g.key === k), want(sel.find((g) => g.key === k)).length, sum(want(sel.find((g) => g.key === k))));
    out.skippedJobs = r.skipped;
  }
  const arch = sel.find((g) => g.key === "jobs-archive-move");
  if (arch) {
    const r = archiveSkipped({ now, settings, ids: want(arch).map((i) => i.id) });
    take(arch, r.moved.length, 0);
  }
  const orphans = sel.find((g) => g.key === "output-orphans");
  if (orphans) {
    let n = 0, b = 0;
    for (const i of want(orphans)) {
      if (!inside(i.path, resolvePath("output")) || !plainFile(i.path)) continue;
      fs.rmSync(i.path); n++; b += i.bytes;
    }
    take(orphans, n, b);
  }
  for (const key of ["stats-debug", "logs-rotated"]) {
    const g = sel.find((x) => x.key === key);
    if (!g) continue;
    const root = key === "stats-debug" ? resolvePath("data/stats/debug") : resolvePath("data/logs");
    let n = 0, b = 0;
    for (const i of want(g)) {
      if (!inside(i.path, root) || !plainFile(i.path)) continue;
      if (key === "logs-rotated" || settings.debugAction !== "delete") {
        writeFileAtomic(i.path + ".gz", zlib.gzipSync(fs.readFileSync(i.path)));
        b += Math.max(0, i.bytes - sizeOf(i.path + ".gz"));
      } else b += i.bytes;
      fs.rmSync(i.path); n++;
    }
    take(g, n, b);
  }
  logEvent("free up space", { trigger: "button", groups: Object.keys(out.byGroup).join(","), files: out.files, freedMB: Math.round(out.freedBytes / 1048576) });
  return out;
}
