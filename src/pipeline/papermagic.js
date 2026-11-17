// Paper Magic match tracking (the owner's idea 2026-10-20): every paper match typed in by hand (your deck, the
// opponent's deck, the result, notes), so the local meta and later deck sims have real data, not guesses.
// Kept in data/cards/paper-matches.json. Deck suggestions come from your own past matches and the collection's
// "Deck: ..." lists.
import { readJson, writeJsonAtomic, resolvePath, newId } from "./util.js";
import { hubSettings } from "../hub/settings.js";
import { collectionCards } from "./collection.js";

const FILE = () => resolvePath("data/cards/paper-matches.json");
export const FORMATS = ["Commander", "Standard", "Pioneer", "Modern", "Pauper", "Legacy", "Draft", "Sealed", "Other"];
// Where paper games are played: the hub settings' "cards.places" (this owner's list is in hub.owner.json).
export const PLACES = Array.isArray(hubSettings().cards?.places) ? hubSettings().cards.places : ["Local store", "Home", "Other"];
const COLORS = "WUBRG";

function load() { return readJson(FILE(), { matches: [] }); }
function save(d) { writeJsonAtomic(FILE(), d, 1); }

const clean = (s, n = 80) => String(s ?? "").trim().slice(0, n);
const int = (v) => Math.max(0, Math.min(9, Math.round(+v || 0)));
// W, L or D from the game score; Commander pods (no game score) use the result picked.
const resultOf = (m) => (m.won > m.lost ? "W" : m.lost > m.won ? "L" : m.won || m.lost || m.drawn ? "D" : m.result || "D");

function tidy(body, old = {}) {
  const m = {
    ...old,
    date: /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : old.date || new Date().toISOString().slice(0, 10),
    format: FORMATS.includes(body.format) ? body.format : old.format || "Other",
    place: clean(body.place ?? old.place, 60),
    event: clean(body.event ?? old.event, 60),
    myDeck: clean(body.myDeck ?? old.myDeck),
    opponent: clean(body.opponent ?? old.opponent, 60),
    oppDeck: clean(body.oppDeck ?? old.oppDeck),
    oppColors: [...new Set(String(body.oppColors ?? old.oppColors ?? "").toUpperCase().split("").filter((c) => COLORS.includes(c)))].join(""),
    won: int(body.won ?? old.won),
    lost: int(body.lost ?? old.lost),
    drawn: int(body.drawn ?? old.drawn),
    result: ["W", "L", "D"].includes(body.result) ? body.result : old.result || null,
    podSize: body.podSize != null ? Math.max(2, Math.min(8, Math.round(+body.podSize) || 4)) : old.podSize ?? null,
    onPlay: body.onPlay === true || body.onPlay === false ? body.onPlay : old.onPlay ?? null,
    notes: clean(body.notes ?? old.notes, 1000),
  };
  if (!m.myDeck) throw new Error("Type the deck you played.");
  m.result = resultOf(m);
  return m;
}

export function addMatch(body = {}) {
  const d = load();
  const m = { id: newId(), at: new Date().toISOString(), ...tidy(body) };
  d.matches.push(m);
  save(d);
  return m;
}
export function editMatch(id, body = {}) {
  const d = load();
  const i = d.matches.findIndex((m) => m.id === id);
  if (i < 0) throw new Error("That match is gone. Refresh the page.");
  d.matches[i] = tidy(body, d.matches[i]);
  save(d);
  return d.matches[i];
}
export function deleteMatch(id) {
  const d = load();
  d.matches = d.matches.filter((m) => m.id !== id);
  save(d);
  return { ok: true };
}

// Win rates grouped by a key. Draws count as half a win, the usual way.
function groupRate(list, key) {
  const g = new Map();
  for (const m of list) {
    const k = key(m) || "Unknown";
    const r = g.get(k) || { k, n: 0, w: 0, l: 0, d: 0 };
    r.n++;
    r[m.result === "W" ? "w" : m.result === "L" ? "l" : "d"]++;
    g.set(k, r);
  }
  return [...g.values()].map((r) => ({ ...r, rate: r.n ? (r.w + r.d / 2) / r.n : null })).sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));
}

export function matchStats() {
  const { matches } = load();
  const list = [...matches].sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));
  const all = groupRate(list, () => "All")[0] || { n: 0, w: 0, l: 0, d: 0, rate: null };
  const decks = new Set(list.map((m) => m.myDeck));
  let fromCollection = [];
  try {
    fromCollection = [...new Set(collectionCards().flatMap((c) => c.lists || []).filter((l) => /^deck:/i.test(l)).map((l) => l.replace(/^deck:\s*/i, "")))];
  } catch {}
  return {
    matches: list,
    total: all,
    last10: groupRate(list.slice(0, 10), () => "Last 10")[0] || null,
    byDeck: groupRate(list, (m) => m.myDeck),
    byOpp: groupRate(list, (m) => m.oppDeck),
    byFormat: groupRate(list, (m) => m.format),
    byPlace: groupRate(list, (m) => m.place),
    playDraw: groupRate(list.filter((m) => m.onPlay != null), (m) => (m.onPlay ? "On the play" : "On the draw")),
    suggest: {
      myDecks: [...new Set([...decks, ...fromCollection])].sort(),
      oppDecks: [...new Set(list.map((m) => m.oppDeck).filter(Boolean))].sort(),
      opponents: [...new Set(list.map((m) => m.opponent).filter(Boolean))].sort(),
      events: [...new Set(list.map((m) => m.event).filter(Boolean))].sort(),
    },
    formats: FORMATS,
    places: PLACES,
  };
}
