// Games (the owner 2026-11-14: "make game a generic base that can build out"; Puzzle Pirates was removed the same day).
// The base: any game you play, typed in by hand, with its platform, where you are with it (playing, backlog, paused,
// done), hours, a link, notes and a dated log. Data in data/games.json.
// Building out: a game that deserves more gets an add-on of its own (its own page and data), listed in GAME_ADDONS
// below with the games it belongs to and the hub part that owns it (src/hub/modules.js). The Games page shows each
// add-on on its games while that part is on. WoW raids and MTG Arena are the first two.
import { readJson, writeJsonAtomic, resolvePath, newId } from "./util.js";

const FILE = () => resolvePath("data/games.json");
export const STATUSES = ["playing", "backlog", "paused", "done"];
// id, name, page, the hub part that owns it, and which of your games it belongs to (matched on the game's name)
export const GAME_ADDONS = [
  { id: "wow", name: "WoW raids", page: "/wow.html", module: "wow", match: /\b(world of warcraft|warcraft|wow)\b/i, about: "Characters and raid logs (Warcraft Logs)." },
  { id: "arena", name: "MTG Arena", page: "/arena.html", module: "cards", match: /\b(mtg|magic|arena)\b/i, about: "Matches and win rates from the Arena log." },
];

function load() { return readJson(FILE(), { games: [] }); }
function save(d) { writeJsonAtomic(FILE(), d, 1); }
const clean = (s, n = 80) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const hours = (v) => (v === "" || v == null ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v) * 10) / 10 : undefined);
const link = (v) => { const s = clean(v, 300); if (!s) return ""; if (!/^https?:\/\//i.test(s)) throw new Error("A link starts with http:// or https://."); return s; };

// on: which hub parts are on (a Set of ids), so add-ons that are switched off aren't offered
export function gamesList({ on = null } = {}) {
  const addons = GAME_ADDONS.filter((a) => !on || on.has(a.module));
  const games = load().games.map((g) => ({ ...g, log: (g.log || []).slice(-30).reverse(), addons: addons.filter((a) => a.match.test(g.name)).map(({ id, name, page }) => ({ id, name, page })) }));
  return { games, statuses: STATUSES, addons: addons.map(({ id, name, page, about }) => ({ id, name, page, about })) };
}

export function addGame({ name, platform, status = "playing" } = {}, opts) {
  name = clean(name, 60);
  if (!name) throw new Error("Give the game a name.");
  if (!STATUSES.includes(status)) throw new Error("Pick playing, backlog, paused or done.");
  const d = load();
  if (d.games.some((g) => g.name.toLowerCase() === name.toLowerCase())) throw new Error("That game is already here.");
  const at = new Date().toISOString();
  d.games.push({ id: newId(4), name, platform: clean(platform, 40), status, hours: null, link: "", notes: "", log: [], addedAt: at, updatedAt: at });
  save(d);
  return gamesList(opts);
}

// Change any of: name, platform, status, hours, link, notes; "note" adds a dated line to the log. A status change is
// logged too, so the log tells the story (started, paused, finished).
export function updateGame(id, body = {}, opts) {
  const d = load();
  const g = d.games.find((x) => x.id === id);
  if (!g) throw new Error("That game is gone. Refresh the page.");
  const at = new Date().toISOString();
  if (body.name != null) { const n = clean(body.name, 60); if (!n) throw new Error("Give the game a name."); g.name = n; }
  if (body.platform != null) g.platform = clean(body.platform, 40);
  if (body.status != null && body.status !== g.status) {
    if (!STATUSES.includes(body.status)) throw new Error("Pick playing, backlog, paused or done.");
    g.log = [...(g.log || []), { at, text: `${g.status} → ${body.status}` }];
    g.status = body.status;
  }
  if (body.hours !== undefined) { const h = hours(body.hours); if (h === undefined) throw new Error("Hours is a number."); g.hours = h; }
  if (body.link != null) g.link = link(body.link);
  if (body.notes != null) g.notes = clean(body.notes, 2000);
  if (clean(body.note, 300)) g.log = [...(g.log || []), { at, text: clean(body.note, 300) }];
  g.log = (g.log || []).slice(-300);
  g.updatedAt = at;
  save(d);
  return gamesList(opts);
}

export function removeGame(id, opts) {
  const d = load();
  d.games = d.games.filter((g) => g.id !== id);
  save(d);
  return gamesList(opts);
}
