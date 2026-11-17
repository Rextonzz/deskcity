// The hub's own to-do and idea inbox (the owner 2026-10-19): ideas he throws in land as "Unsorted" to sort later, and
// Ask Claude suggestions and rules-review edits that need something built in the app are added by themselves so
// they don't get missed. Kept in data/todo.json.
import { readJson, writeJsonAtomic, resolvePath, newId } from "./util.js";

const FILE = () => resolvePath("data/todo.json");
export const STATUSES = ["open", "doing", "done", "dropped"];
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function load() { return readJson(FILE(), { items: [] }, { strict: true }); }
function save(d) { writeJsonAtomic(FILE(), d, 1); }

export function todoList() {
  const d = load();
  const cats = [...new Set(d.items.map((i) => i.category).filter(Boolean))].sort((a, b) => (a === "Unsorted" ? -1 : b === "Unsorted" ? 1 : a.localeCompare(b)));
  return { items: d.items, categories: cats, counts: Object.fromEntries(STATUSES.map((s) => [s, d.items.filter((i) => i.status === s).length])) };
}

// Adds one item unless an open one with the same title is already there. Returns the item (new or existing).
export function addTodo({ title, detail = "", source = "idea", category = "Unsorted", link = null, channel = null } = {}) {
  const t = String(title || "").trim().slice(0, 200);
  if (!t) throw new Error("Type the idea first.");
  const d = load();
  const same = d.items.find((i) => norm(i.title) === norm(t) && i.status !== "dropped");
  if (same) return { ...same, existed: true };
  const item = {
    id: newId(),
    at: new Date().toISOString(),
    title: t,
    detail: String(detail || "").slice(0, 2000),
    source: String(source).slice(0, 60),
    category: String(category || "Unsorted").slice(0, 40),
    status: "open",
    link: link ? String(link).slice(0, 300) : null,
    channel,
  };
  d.items.unshift(item);
  save(d);
  return item;
}

export function updateTodo(id, patch = {}) {
  const d = load();
  const it = d.items.find((i) => i.id === id);
  if (!it) throw new Error("That item isn't there any more.");
  if (patch.status && STATUSES.includes(patch.status)) {
    it.status = patch.status;
    it.doneAt = patch.status === "done" ? it.doneAt || new Date().toISOString() : undefined;
  }
  if (patch.category != null) it.category = String(patch.category).trim().slice(0, 40) || "Unsorted";
  if (patch.title != null && String(patch.title).trim()) it.title = String(patch.title).trim().slice(0, 200);
  if (patch.detail != null) it.detail = String(patch.detail).slice(0, 2000);
  // Target date for the project timeline (planned vs actual); "" clears it.
  if (patch.due != null) it.due = /^\d{4}-\d{2}-\d{2}$/.test(String(patch.due)) ? String(patch.due) : undefined;
  save(d);
  return it;
}

// From an Ask Claude run or a rules review: every item the AI marked as needing an app change goes in.
export function addBuildItems(items, { source, channel, link }) {
  const added = [];
  for (const i of items || []) {
    if (!i?.needs_build || !String(i.build || "").trim()) continue;
    const r = addTodo({ title: i.build, detail: i.detail || i.why || "", source, category: "Unsorted", link, channel });
    if (!r.existed) added.push(r.title);
  }
  return added;
}
