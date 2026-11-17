// The Project page (the owner 2026-10-19): how much is built, how far in, how the to-do has grown (scope creep), and which
// paid services the hub now does for him. Everything is read from what the app already keeps: CHANGELOG.json (every
// change, dated), the to-do (todo.js), data/todo-history.jsonl (one snapshot a day, so the creep line has history),
// the code itself (files and lines) and the run log (what the app has done).
import { resolvePath, readJsonl, appendJsonl, listFiles, countLines } from "./util.js";
import { changelog } from "./versions.js";
import { readRuns } from "./runlog.js";
import { todoList } from "./todo.js";
import { chOfLayout, cardStores } from "../hub/settings.js";

const HISTORY = () => resolvePath("data/todo-history.jsonl");
const STARTED = "2026-10-17";
const day = (iso) => String(iso || "").slice(0, 10);

// Paid apps and services the hub covers now. "price" is the usual paid tier in USD a month, as a rough guide
// (checked from memory 2026-10-19, not live); null where it's a one-off or free tool that we still built past.
// The channel and store names come from the settings (pipeline.config.json, hub.owner.json "cards.stores").
const names = () => ({ clips: chOfLayout("clips").name || "The clip channel", packs: chOfLayout("packs").name || "The pack channel", ...cardStores() });
export const replaced = () => {
  const n = names();
  return [
  { service: "vidIQ / TubeBuddy", what: "Stats pages, Ask Claude suggestions, rules review that learns from your numbers", area: "YouTube", price: 17 },
  { service: "Buffer / Later / Metricool", what: "Scheduling every YouTube and TikTok post, with pinned comments", area: "YouTube", price: 15 },
  { service: "Opus Clip / Vizard", what: `${n.clips}: finds the clips in long recordings and cuts them with the setup kept`, area: "YouTube", price: 15 },
  { service: "Submagic / CapCut captions", what: "Own captions (Whisper or Gemini word times, swears starred)", area: "YouTube", price: 14 },
  { service: `A video editor for ${n.packs}`, what: `${n.packs} pipeline: finds the pack, reads and prices every card, renders the Short`, area: "YouTube", price: null },
  { service: "Manual tracker updates", what: "Pack Tracker and upload log filled in by themselves", area: "YouTube", price: null },
  { service: "ManaBox / Delver Lens / Moxfield", what: "Collection: photo scan (many cards per photo), CSV import, lists, value in CAD", area: "Cards", price: 5 },
  { service: "TCGplayer app price check", what: `Price a card from a photo, TCGplayer plus ${n.shop} and ${n.buylist} in CAD`, area: "Cards", price: null },
  { service: "Trade calculators", what: "Trades: both sides valued your way, collection updated on confirm", area: "Cards", price: null },
  { service: `Your ${n.shop.replace(/^the /, "")} DMG scheduled task`, what: "Deal watch", area: "Cards", price: null },
  { service: "UptimeRobot / a status page", what: "Daily health check with phone alerts (ntfy)", area: "System", price: 7 },
  { service: "Trello / Notion for the to-do", what: "To-do and ideas page that fills itself from suggestions", area: "System", price: 10 },
  ];
};

// Files and lines of the app's own code (not node_modules, data or output). A file that can't be read is skipped.
function codeSize() {
  const paths = ["src", "public", "python", "linux"].flatMap((r) => listFiles(resolvePath(r), { match: /\.(js|mjs|html|css|py|sh|cmd)$/ }));
  const main = countLines(paths, (p) => p.split(".").pop());
  const extra = countLines(["server.js", "start-pipeline.cmd", "start-pipeline.sh"].map((f) => resolvePath(f)));
  return { files: main.files + extra.files, lines: main.lines + extra.lines, by: main.by };
}

// One to-do snapshot a day (called when the to-do changes, when this page opens, and at app start).
export function snapshotTodo() {
  const t = todoList();
  const today = day(new Date().toISOString());
  const last = readJsonl(HISTORY()).at(-1) ?? null;
  const snap = { day: today, total: t.items.length, open: t.counts.open + t.counts.doing, done: t.counts.done, dropped: t.counts.dropped };
  if (last?.day === today && last.total === snap.total && last.open === snap.open && last.done === snap.done) return snap;
  // Same day: the newer snapshot replaces the older one when the history is read (last one per day wins).
  appendJsonl(HISTORY(), snap);
  return snap;
}

// Days before the first snapshot are rebuilt from each item's added and done dates (back-fill).
function rebuilt(items, beforeDay) {
  const days = [...new Set(items.map((i) => day(i.at)).concat(items.map((i) => day(i.doneAt)).filter(Boolean)))].filter((d) => d && d < beforeDay).sort();
  return days.map((d) => {
    const on = items.filter((i) => day(i.at) <= d);
    const done = on.filter((i) => i.doneAt && day(i.doneAt) <= d).length;
    return { day: d, total: on.length, done, open: on.length - done, dropped: 0, rebuilt: true };
  });
}

function todoHistory(items = []) {
  const real = snapshots();
  return [...rebuilt(items, real[0]?.day || "9999"), ...real];
}
function snapshots() {
  const by = {};
  for (const s of readJsonl(HISTORY())) by[s.day] = s;
  return Object.values(by).sort((a, b) => a.day.localeCompare(b.day));
}

// Project timeline (the owner 2026-10-19: "almost a project timeline", Gantt style like a launch plan). Workstreams are
// the to-do's areas; each delivered update in CHANGELOG.json is placed on the workstream its words point to.
// Words for a regex alternation, each followed by "|" (none when there are no words, so no empty alternative that matches everywhere).
const rx = (words) => words.filter(Boolean).map((w) => w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).map((w) => `${w}|`).join("");
const AREAS = () => {
  const st = cardStores();
  return [
  ["Cards", new RegExp(`\\b(cards?|collection|trades?|flip|deal watch|scryfall|${rx([st.shop, st.buylist, st.buylistShort])}tcgplayer|trade-up|mtgjson|buylist)\\b`, "gi")],
  ["Gaming", /\b(arena|wow|warcraft|games?|riftbound|gaming|raid)\b/gi],
  ["AI", /\b(ai|models?|gemini|claude|batch|spend|credit|prompts?|rules review|ask claude|side-by-side|shadow)\b/gi],
  ["YouTube and TikTok", new RegExp(`\\b(youtube|tiktok|${rx([chOfLayout("packs").name, chOfLayout("clips").name])}studio|uploads?|captions?|schedul\\w*|stats|pull|shorts?|episode|pinned)\\b`, "gi")],
  ["Home server", /\b(home server|linux|ubuntu|standby|mini pc|jellyfin)\b/gi],
  ["Hub", /\b(health check|backups?|security|sign[- ]in|password|menu|home page|queue|calendar|to-do|project page|admin|restart|alerts?|ntfy|version history|freez\w*|crash\w*)\b/gi],
  ];
};
export function areaOf(e) {
  const text = `${e.title} ${e.title} ${e.title} ${(e.changes || []).join(" ")}`;
  let best = "Hub", score = 0;
  for (const [name, re] of AREAS()) {
    const n = (text.match(re) || []).length;
    if (n > score) [best, score] = [name, n];
  }
  return best;
}
// Launch-style milestones that aren't a to-do item (dates from the project's own history).
const milestones = () => [
  { at: "2026-10-17T19:44:00Z", title: "Project start" },
  { at: "2026-10-18T00:00:00Z", title: "First upload" },
  ...(chOfLayout("packs").name ? [{ at: "2026-10-18T12:02:00Z", title: `${chOfLayout("packs").name} live` }] : []),
  ...(chOfLayout("clips").name ? [{ at: "2026-10-19T12:00:00Z", title: `${chOfLayout("clips").name} live` }] : []),
];
function timeline(items, log) {
  const now = new Date().toISOString();
  const by = {};
  const ws = (name) => (by[name] = by[name] || { name, items: [], deliveries: [] });
  for (const i of items) if (i.status !== "dropped") ws(i.category || "Unsorted").items.push({ id: i.id, title: i.title, status: i.status, at: i.at, doneAt: i.doneAt || null, due: i.due || null, rank: i.rank ?? null });
  for (const e of log) if (e.at) ws(areaOf(e)).deliveries.push({ at: e.at, title: e.title, changes: (e.changes || []).length });
  const list = Object.values(by).map((w) => {
    const times = [...w.items.flatMap((i) => [i.at, i.doneAt]), ...w.deliveries.map((d) => d.at)].filter(Boolean).sort();
    const open = w.items.filter((i) => i.status === "open" || i.status === "doing").length;
    const done = w.items.filter((i) => i.status === "done").length;
    w.items.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || String(a.at).localeCompare(String(b.at)));
    w.deliveries.sort((a, b) => a.at.localeCompare(b.at));
    return { ...w, first: times[0] || null, last: open ? now : times[times.length - 1] || null, open, done, pct: open + done ? Math.round((done / (open + done)) * 100) : 0 };
  }).sort((a, b) => b.deliveries.length - a.deliveries.length);
  const dues = items.map((i) => i.due).filter(Boolean).map((d) => `${d}T23:59:00Z`);
  const withDue = items.filter((i) => i.due && i.status === "done" && i.doneAt);
  const late = withDue.filter((i) => i.doneAt.slice(0, 10) > i.due).length;
  const overdue = items.filter((i) => i.due && (i.status === "open" || i.status === "doing") && i.due < now.slice(0, 10)).length;
  return {
    start: `${STARTED}T00:00:00Z`, now, end: [now, ...dues].sort().pop(),
    workstreams: list, milestones: milestones(),
    schedule: { withDue: items.filter((i) => i.due).length, doneOnTime: withDue.length - late, doneLate: late, overdue },
  };
}

export function projectStats() {
  const snap = snapshotTodo();
  const log = changelog();
  const t = todoList();
  const byDay = {};
  for (const e of log) {
    const d = day(e.at);
    byDay[d] = byDay[d] || { day: d, updates: 0, changes: 0 };
    byDay[d].updates++;
    byDay[d].changes += (e.changes || []).length;
  }
  const days = Math.max(1, Math.ceil((Date.now() - Date.parse(STARTED)) / 864e5));
  // Ideas added after the first day are the creep: the list grows as we build.
  const firstDay = t.items.map((i) => day(i.at)).sort()[0];
  const addedLater = t.items.filter((i) => day(i.at) > firstDay).length;
  const runs = readRuns({ limit: 5000 });
  const runKinds = {};
  for (const r of runs) runKinds[r.kind] = (runKinds[r.kind] || 0) + 1;
  const open = t.items.filter((i) => i.status === "open" || i.status === "doing");
  const done = t.items.filter((i) => i.status === "done");
  return {
    started: STARTED,
    days,
    updates: log.length,
    changes: log.reduce((a, e) => a + (e.changes || []).length, 0),
    byDay: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)),
    latest: log.slice().sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8).map((e) => ({ at: e.at, title: e.title })),
    code: codeSize(),
    todo: {
      total: t.items.length, open: open.length, done: done.length, dropped: t.counts.dropped,
      pctDone: t.items.length - t.counts.dropped ? Math.round((done.length / (t.items.length - t.counts.dropped)) * 100) : 0,
      addedLater, history: todoHistory(t.items), today: snap,
      byCategory: t.categories.map((c) => ({ category: c, open: open.filter((i) => i.category === c).length, done: done.filter((i) => i.category === c).length })),
    },
    runs: { total: runs.length, since: runs.length ? runs[runs.length - 1].startedAt : null, top: Object.entries(runKinds).sort((a, b) => b[1] - a[1]).slice(0, 8) },
    timeline: timeline(t.items, log),
    replaced: replaced(),
    replacedMonthly: replaced().reduce((a, r) => a + (r.price || 0), 0),
  };
}
