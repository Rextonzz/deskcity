// The data format. data/format.json holds one whole number: the shape of the files in data/ that this copy of the app
// understands. An update that changes the shape of saved data adds a step to MIGRATIONS (below); the app then brings the
// data up to date on its first start, after taking a backup. Today there are no steps: the format is 1.
//
// - No data/format.json on a folder that already has data: it is format 1 (the shape before this file existed).
// - No data/format.json on an empty folder: a fresh install, stamped with the current format, nothing to migrate.
// - Stored number lower than the app's: backup first ("before update"; if the backup fails, stop and migrate nothing),
//   then each missing step in order, writing the new number after each one that finishes.
// - Stored number higher than the app's (the owner went back to an older version): refuse to start. The old code would
//   misread newer data. The message names both numbers and the way out.
import fs from "node:fs";
import path from "node:path";

export const BASE_FORMAT = 1;
// Ordered list of { to: <number>, name: "plain words", run(dataDir) }. Each step moves data from `to - 1` to `to`.
export const MIGRATIONS = [];

export const currentFormat = (migrations = MIGRATIONS) => Math.max(BASE_FORMAT, ...migrations.map((m) => m.to));
const FILE = (dataDir) => path.join(dataDir, "format.json");

function writeFormat(dataDir, n) {
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = `${FILE(dataDir)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ format: n }, null, 2) + "\n");
  fs.renameSync(tmp, FILE(dataDir));
}

// What the folder says: { format } or { format: null, fresh } when there is no file, { error } when it can't be read.
export function readFormat(dataDir) {
  let text;
  try { text = fs.readFileSync(FILE(dataDir), "utf8"); } catch (err) {
    if (err.code !== "ENOENT") return { format: null, error: err.message };
    const others = fs.existsSync(dataDir) ? fs.readdirSync(dataDir).filter((n) => !["hub.lock", "logs"].includes(n)) : [];
    return { format: null, fresh: !others.length };
  }
  try {
    const n = JSON.parse(text)?.format;
    if (Number.isInteger(n) && n >= 1) return { format: n };
  } catch {}
  return { format: null, error: "it is not { \"format\": <whole number> }" };
}

// Called once at start-up (server.js), before anything else reads data/. Throws an Error with a plain message when the app
// must not start. `backup` is () => { ok, error?, dir? } (runBackup in the app); `log` receives progress lines.
export function ensureDataFormat(dataDir, { migrations = MIGRATIONS, backup, log = () => {} } = {}) {
  const want = currentFormat(migrations);
  const found = readFormat(dataDir);
  if (found.error) throw new Error(`Can't read ${FILE(dataDir)} (${found.error}). It says which data format this folder is in. Restore it from a backup, or delete it only if you are sure the data is from this version.`);
  if (found.format === null && found.fresh) { writeFormat(dataDir, want); return { from: null, to: want, ran: [], stamped: true }; }
  const stored = found.format ?? BASE_FORMAT;
  if (stored > want) {
    throw new Error(`This data folder is in format ${stored}, but this version of the app only understands format ${want}. It was last used by a newer version, and an older one could misread or damage it. Update to the newer version again, or restore the backup taken before that update (Admin, "Restore from a backup", or copy it back by hand).`);
  }
  if (found.format === null) writeFormat(dataDir, stored);
  if (stored === want) return { from: stored, to: want, ran: [] };

  const steps = migrations.filter((m) => m.to > stored).sort((a, b) => a.to - b.to);
  log(`Data format ${stored}, this version needs ${want}: backing up first.`);
  let b;
  try { b = backup?.(); } catch (err) { b = { ok: false, error: err.message }; }
  if (!b?.ok) throw new Error(`The data needs updating (format ${stored} to ${want}), but the backup taken first failed${b?.error ? ` (${b.error})` : ""}. Nothing was changed. Fix the backup folder (is the drive there and has it room?) and start again.`);
  const ran = [];
  for (const m of steps) {
    log(`Updating your data: ${m.name} (to format ${m.to}).`);
    try { m.run(dataDir); } catch (err) {
      throw new Error(`Updating your data failed at "${m.name}" (format ${m.to}): ${err.message}. The data stays at format ${ran.length ? ran.at(-1) : stored}. A backup was taken first${b.dir ? ` in ${b.dir}` : ""}; restore it with Admin "Restore from a backup" if anything looks wrong.`);
    }
    writeFormat(dataDir, m.to);
    ran.push(m.to);
  }
  writeFormat(dataDir, want);
  return { from: stored, to: want, ran, backup: b };
}
