// What an edit did, in a few words (src/pipeline/editnote.js): counts and section names only, never the text.
import test from "node:test";
import assert from "node:assert/strict";
import { hub, app, ROOMS, DESKS } from "./helper.mjs";

const { A } = await hub({ rooms: ROOMS, desks: DESKS });
const { editNote } = await import(app("src/pipeline/editnote.js"));

test("an edit: plus and minus lines, or 'changed' when it swaps one for one", () => {
  assert.equal(editNote("Edit", { old_string: "a\nb\nc", new_string: "a" }, "x.js"), "+1 −3 lines");
  assert.equal(editNote("Edit", { old_string: "a\nb", new_string: "c\nd" }, "x.js"), "changed 2 lines");
  assert.equal(editNote("Edit", { old_string: "x", new_string: "y" }, "x.js"), "changed 1 line");
});
test("rows for table-like files", () => {
  assert.equal(editNote("Edit", { old_string: "1,2\n3,4\n5,6", new_string: "" }, "data.csv"), "+0 −3 rows");
});
test("sections: markdown headings added or removed, named and clipped", () => {
  const n = editNote("Edit", { old_string: "## Old part\ntext", new_string: "## Install\nsteps\nmore\n## Use\nhow" }, "README.md");
  assert.equal(n, '+5 −2 lines, added section "Install", added section "Use", removed section "Old part"');
  const long = editNote("Edit", { old_string: "", new_string: `# ${"x".repeat(80)}` }, "a.md");
  assert.ok(long.length <= 120 && long.includes("…"));
});
test("MultiEdit adds up; Write counts the file; other tools have no note", () => {
  assert.equal(editNote("MultiEdit", { edits: [{ old_string: "a", new_string: "b\nc" }, { old_string: "d\ne", new_string: "" }] }, "x.js"), "+2 −3 lines");
  assert.equal(editNote("Write", { content: "# Title\nline\n## Part\n" }, "notes.md"), "wrote 3 lines, 2 sections");
  assert.equal(editNote("Read", { file_path: "x" }), null);
  assert.equal(editNote("Bash", { command: "rm -rf /" }), null);
  assert.equal(editNote("Edit", { old_string: "", new_string: "" }, "x"), null);
});
test("the hub keeps the note on tool steps only, clipped; never anything else from the edit", () => {
  const row = A.recordEvent({ desk: "game-lead", room: "game", action: "tool", tool: "Edit", summary: "README.md", note: "+12 −3 lines, added section \"Install\"", new_string: "secret text" }, "claude-code");
  assert.equal(row.note, '+12 −3 lines, added section "Install"');
  assert.equal(row.new_string, undefined);
  assert.equal(A.recordEvent({ desk: "game-lead", room: "game", action: "note", note: "x" }, "claude-code").note, undefined);
  assert.equal(A.deskLive("game-lead").steps.find((s) => s.tool === "Edit").note, '+12 −3 lines, added section "Install"');
});
