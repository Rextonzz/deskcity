// A short note on what an edit did, for the feed (the owner 2026-11-14: "can the feed give a snippet note on what, i.e.
// deleted 12 rows, added x section"). The Claude Code hook (tools/agent-hook.mjs) passes an Edit / MultiEdit / Write
// tool's input here and sends only the note: line (or row) counts, and the names of markdown sections it added or
// removed, clipped short. Never the text itself. Pure: no files, no network.
const ROWS = /\.(csv|tsv|jsonl|ndjson)$/i;
const lines = (s) => (typeof s === "string" && s.length ? s.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").length : 0);
const headings = (s) => (typeof s === "string" ? [...s.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)].map((m) => m[1].trim()) : []);
const name = (h) => `"${h.length > 40 ? `${h.slice(0, 39)}…` : h}"`;

export function editNote(tool, input = {}, file = "") {
  const unit = ROWS.test(String(file || input.file_path || "")) ? "row" : "line";
  let added = 0, removed = 0, before = [], after = [];
  if (tool === "Edit") {
    added = lines(input.new_string); removed = lines(input.old_string);
    before = headings(input.old_string); after = headings(input.new_string);
  } else if (tool === "MultiEdit" && Array.isArray(input.edits)) {
    for (const e of input.edits.slice(0, 100)) { added += lines(e?.new_string); removed += lines(e?.old_string); before.push(...headings(e?.old_string)); after.push(...headings(e?.new_string)); }
  } else if (tool === "Write") {
    added = lines(input.content);
    after = headings(input.content);
    if (!added) return null;
    const sec = after.length ? `, ${after.length} section${after.length === 1 ? "" : "s"}` : "";
    return `wrote ${added} ${unit}${added === 1 ? "" : "s"}${sec}`.slice(0, 120);
  } else return null;
  if (!added && !removed) return null;
  // an edit that swaps lines one for one reads as "changed N"; otherwise the plus and minus
  const counts = added === removed ? `changed ${added} ${unit}${added === 1 ? "" : "s"}` : `+${added} −${removed} ${unit}s`;
  const gone = before.filter((h) => !after.includes(h)), fresh = after.filter((h) => !before.includes(h));
  const secs = [...fresh.slice(0, 2).map((h) => `added section ${name(h)}`), ...gone.slice(0, 2).map((h) => `removed section ${name(h)}`)];
  return [counts, ...secs].join(", ").slice(0, 120);
}
