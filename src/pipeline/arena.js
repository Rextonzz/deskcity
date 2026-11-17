// MTG Arena tracking (to-do #10): games, decks and win rates from Arena's own log on the PC (Player.log, with
// Detailed Logs on; Arena keeps the previous session as Player-prev.log and starts a new log at every launch).
// Untapped.gg has no public API, so we read the same log it does. Read-only. Every match found is kept in
// data/arena/matches.json by match id, so history builds up even though Arena rewrites its log each launch.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJson, writeJsonAtomic, resolvePath, loadPipelineConfig } from "./util.js";

const FILE = () => resolvePath("data/arena/matches.json");
const logDir = () => loadPipelineConfig().arena?.logDir || path.join(os.homedir(), "AppData", "LocalLow", "Wizards Of The Coast", "MTGA");

function load() { return readJson(FILE(), { matches: {}, events: {}, lastRead: null }); }
function save(d) { writeJsonAtomic(FILE(), d, 1); }

// "?=?Loc/Decks/Precon/Precon_EPPFDN_BW" -> "Precon EPPFDN BW"; player-named decks pass through.
export const deckName = (s) => String(s || "").replace(/^\?=\?Loc\/Decks\/(Precon\/)?/, "").replace(/_/g, " ").trim() || "Unknown deck";
// "QuickDraft_HOB_20260915" -> "Quick Draft HOB"; "Ladder" -> "Ranked"; "Play" -> "Play".
export const eventLabel = (e) => {
  const s = String(e || "");
  if (/^Ladder$/i.test(s)) return "Ranked (Standard)";
  if (/^Traditional_Ladder$/i.test(s)) return "Ranked Bo3 (Standard)";
  if (/^Historic_Ladder$/i.test(s)) return "Ranked (Historic)";
  return s.replace(/_\d{8}$/, "").replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2") || "Unknown";
};

const jsonFrom = (line) => {
  const i = line.indexOf("{");
  if (i < 0) return null;
  try {
    return JSON.parse(line.slice(i));
  } catch {
    return null;
  }
};

// Reads one log's text. Returns matches (by id) and what each event's course looked like (deck, wins, losses).
export function parseLog(text) {
  let me = null;
  const courses = {}, matches = [];
  for (const line of text.split("\n")) {
    if (line.includes("authenticateResponse")) {
      const j = jsonFrom(line);
      if (j?.authenticateResponse?.clientId) me = j.authenticateResponse.clientId;
      continue;
    }
    if (line.includes('"Courses"') || line.includes('"CourseDeckSummary"')) {
      const j = jsonFrom(line);
      for (const c of j?.Courses || (j?.CourseDeckSummary ? [j] : [])) {
        if (!c.InternalEventName) continue;
        courses[c.InternalEventName] = { deck: deckName(c.CourseDeckSummary?.Name), deckId: c.CourseDeckSummary?.DeckId || null, wins: c.CurrentWins ?? null, losses: c.CurrentLosses ?? null };
      }
      continue;
    }
    if (!line.includes("MatchGameRoomStateType_MatchCompleted")) continue;
    const j = jsonFrom(line);
    const room = j?.matchGameRoomStateChangedEvent?.gameRoomInfo;
    const res = room?.finalMatchResult;
    if (!res?.matchId) continue;
    const players = room.gameRoomConfig?.reservedPlayers || [];
    const self = players.find((p) => p.userId === me) || null;
    const opp = players.find((p) => p !== self) || null;
    const games = (res.resultList || []).filter((r) => r.scope === "MatchScope_Game");
    const match = (res.resultList || []).find((r) => r.scope === "MatchScope_Match");
    const at = Number(j.timestamp) > 1e12 && Number(j.timestamp) < 1e13 ? new Date(Number(j.timestamp)).toISOString() : null;
    matches.push({
      id: res.matchId, at, event: self?.eventId || opp?.eventId || null, opponent: opp?.playerName || null,
      won: self && match ? match.winningTeamId === self.teamId : null,
      games: games.length, gamesWon: self ? games.filter((g) => g.winningTeamId === self.teamId).length : null,
      reason: (match?.reason || "").replace(/^ResultReason_/, ""),
    });
  }
  for (const m of matches) {
    const c = courses[m.event];
    if (c) Object.assign(m, { deck: c.deck, deckId: c.deckId });
  }
  return { me, matches, courses };
}

// Reads both logs and merges anything new into the saved history. Runs at start and once a day (the owner 2026-10-19: daily at
// most, plus the Read log now button). Arena keeps only the last two sessions; skipped when neither log changed.
export function ingestArena({ force = false } = {}) {
  const dir = logDir();
  const d = load();
  let found = 0, added = 0;
  const files = ["Player-prev.log", "Player.log"].map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));
  if (!files.length) return { ok: false, error: `No Arena log at ${dir}. Is Arena installed on this PC with Detailed Logs on?`, total: Object.keys(d.matches).length };
  const stamp = files.map((f) => { const st = fs.statSync(f); return `${path.basename(f)}:${st.size}:${Math.round(st.mtimeMs)}`; }).join("|");
  if (!force && stamp === d.logStamp) return { ok: true, unchanged: true, found: 0, added: 0, total: Object.keys(d.matches).length };
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    const r = parseLog(text);
    if (!/DETAILED LOGS: ENABLED/.test(text)) d.detailedOff = true;
    else delete d.detailedOff;
    for (const m of r.matches) {
      found++;
      if (!d.matches[m.id]) added++;
      d.matches[m.id] = { ...d.matches[m.id], ...m };
    }
    for (const [k, c] of Object.entries(r.courses)) {
      // The first record seen is the baseline: games added to it later that aren't in this PC's log were played
      // somewhere else (phone, another computer).
      const prev = d.events[k];
      const base = prev?.base || { at: new Date().toISOString(), wins: c.wins || 0, losses: c.losses || 0 };
      d.events[k] = { ...c, base, seenAt: new Date().toISOString() };
    }
  }
  d.lastRead = new Date().toISOString();
  d.logStamp = stamp;
  save(d);
  return { ok: true, found, added, total: Object.keys(d.matches).length };
}

const rate = (w, n) => (n ? Math.round((w / n) * 100) : null);
function group(list, keyOf) {
  const by = {};
  for (const m of list) {
    const k = keyOf(m) || "Unknown";
    by[k] = by[k] || { name: k, played: 0, won: 0, last: null };
    by[k].played++;
    if (m.won) by[k].won++;
    if (!by[k].last || (m.at && m.at > by[k].last)) by[k].last = m.at;
  }
  return Object.values(by).map((g) => ({ ...g, rate: rate(g.won, g.played) })).sort((a, b) => b.played - a.played);
}

// Games added to Arena's record for an event since the baseline, minus the ones this PC's log saw.
function elsewhere(key, c, all) {
  if (!c.base) return 0;
  const grew = (c.wins || 0) + (c.losses || 0) - c.base.wins - c.base.losses;
  const seen = all.filter((m) => m.event === key && m.at && m.at > c.base.at).length;
  return Math.max(0, grew - seen);
}

export function arenaStats() {
  const d = load();
  const all = Object.values(d.matches).filter((m) => m.won != null).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const won = all.filter((m) => m.won).length;
  const days = {};
  for (const m of all) {
    const k = String(m.at || "").slice(0, 10);
    if (!k) continue;
    days[k] = days[k] || { day: k, played: 0, won: 0 };
    days[k].played++;
    if (m.won) days[k].won++;
  }
  // Arena's own win/loss records for every event seen: these include games from before tracking and from the phone.
  const rec = Object.values(d.events).reduce((t, c) => ({ wins: t.wins + (c.wins || 0), losses: t.losses + (c.losses || 0) }), { wins: 0, losses: 0 });
  return {
    records: {
      played: rec.wins + rec.losses,
      won: rec.wins,
      rate: rate(rec.wins, rec.wins + rec.losses),
      events: Object.keys(d.events).length,
    },
    lastRead: d.lastRead,
    detailedOff: Boolean(d.detailedOff),
    logDir: logDir(),
    played: all.length,
    won,
    rate: rate(won, all.length),
    byDeck: group(all, (m) => m.deck),
    byEvent: group(all, (m) => eventLabel(m.event)),
    recent: all.slice(0, 25).map((m) => ({ ...m, eventLabel: eventLabel(m.event) })),
    byDay: Object.values(days)
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(-60),
    elsewhere: Object.entries(d.events).reduce((t, [k, c]) => t + elsewhere(k, c, all), 0),
    events: Object.entries(d.events)
      .map(([k, c]) => ({ event: eventLabel(k), ...c, wins: c.wins || 0, losses: c.losses || 0, elsewhere: elsewhere(k, c, all) }))
      .filter((e) => e.wins + e.losses > 0)
      .map((e) => ({ ...e, rate: rate(e.wins, e.wins + e.losses) }))
      .sort((a, b) => b.wins + b.losses - (a.wins + a.losses))
      .slice(0, 15),
  };
}
