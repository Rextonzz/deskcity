// Admin's backup sentence (public/parts/admin.js), in its own file so a test can check it says only true things
// (test/hub/backup-words.test.mjs). r is /api/pipeline/backup/list (src/pipeline/backup.js listBackups): dir, keep,
// and extra = every extra place a backup is copied to (the older backup.copies list in pipeline.config.json and the
// settings' backup.copyTo), each with how the last backup went there. when(iso) turns a time into words.
export function backupWhere(r, when) {
  const keep = r.keep || 14;
  const head = `Backups are kept in ${r.dir || "the backups folder"}, the newest ${keep}. `;
  const extra = Array.isArray(r.extra) ? r.extra : [];
  if (!extra.length) return head + "No second copy is set up (set backup.copyTo in the settings file to copy each backup to another drive or a cloud folder).";
  const one = (c) => {
    if (!c.ran) return `${c.dir} (it hasn't run yet; the next backup does it)`;
    if (c.ok) return `${c.dir}, last worked ${c.lastOk ? when(c.lastOk) : "with the last backup"}`;
    return `${c.dir}: the last copy FAILED (${c.error || "unknown error"}).${c.lastOk ? ` It last worked ${when(c.lastOk)}.` : " It has never worked."} The backup on this PC is fine`;
  };
  const lead = extra.length === 1 ? "Each backup is also copied to " : `Each backup is also copied to ${extra.length} places: `;
  return head + lead + extra.map(one).join("; ") + `. The newest ${keep} are kept there too.`;
}
