// @ts-check
// Part of the agents module (src/pipeline/agents.js), added 2026-11-23: the campus casino. Workers play the owner's own
// slot game with campus credits (play money only: the same credits they earn and spend at the Mart, never real money),
// and every spin is logged so the owner gets data on how the game plays.
//
// The game's maths comes from its math SDK run (runtime data, not in git), in the folder `agents.casino.dataDir`:
//   lookUpTable_base_0.csv         id,weight,payout        (payout in hundredths of the bet: 40 = 0.40x)
//   lookUpTableSegmented_base.csv  id,criteria,basegameWins,freegameWins   (multiples of the bet)
// Base game only for now: only rounds with freegameWins == 0 are drawn (by weight), and they pay basegameWins. Each spin
// keeps its outcome id, so it can be replayed in the game later. With the files missing the casino is closed.
//
// Code only, no AI calls. With the Campus shop timer (every 20 minutes), now and then an idle active worker with spare
// credits plays a short session in its own style (from its id: cautious, chaser or steady). The session's bankroll is a
// small slice of its credits (capped), so a worker can never go below zero. The pet never plays.
// Log: data/agents/casino.jsonl (a "spin" line per spin, a "session" line at the end). The session's net result is one
// wallet line ("casino", a positive cost for a loss, a negative one for a win). No store tax on casino losses: the tax is
// for Mart buys, and a loss here isn't a purchase (docs/projects/hub/campus.md).
import fs from "node:fs";
import path from "node:path";
import { hubSettings, hubTz, isDemo, ownerId, petName } from "../../hub/settings.js";
import { logEvent } from "../runlog.js";
import { dayIn, jobsDisabled, newId, resolvePath } from "../util.js";
import { wallets } from "./campus.js";
import { DIR, appendJsonl, jobs, openJob, readJsonl, roster } from "../agents.js";

export const CASINO_DEFAULTS = {
  on: false,
  name: "Casino",
  dataDir: "data/casino/slots",
  maxStakePerSession: 20, // credits a worker brings to one session, at most
  stakeShare: 0.1, // ... and at most this share of its balance
  minBalance: 20, // a worker with less stays away
  maxSessionsPerDay: 2, // per worker
  gapMinutes: 90, // between one worker's sessions
  chance: 0.25, // each tick, the chance an eligible worker goes
  perTick: 2, // sessions at most per tick
  betLevels: [0.1, 0.2, 0.5, 1, 2],
};
/** @type {Record<string, { label: string, about: string, spins: number, betShare: number, lossStop?: number, winStop?: number }>} */
export const CASINO_STYLES = {
  cautious: { label: "cautious", about: "small flat bets; leaves when down 30% or up 50% of the session money", spins: 150, lossStop: 0.3, winStop: 0.5, betShare: 1 / 100 },
  chaser: { label: "chaser", about: "raises the bet after each loss, back to the start after a win; plays until the session money is gone or 40 spins", spins: 40, betShare: 1 / 40 },
  steady: { label: "steady", about: "one flat bet for a fixed 50 spins", spins: 50, betShare: 1 / 50 },
};
export const HARD_MAX_SPINS = 200;
const FILES = { table: "lookUpTable_base_0.csv", segmented: "lookUpTableSegmented_base.csv" };
const LOG = () => path.join(DIR(), "casino.jsonl");
const WALLET = () => path.join(DIR(), "wallet.jsonl");
const r2 = (/** @type {number} */ n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (/** @type {any} */ v, /** @type {number} */ d, min = 0, max = Infinity) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : d; };

/** Settings with defaults (hub.defaults.json agents.casino; the owner's files override). */
export function casinoSettings(s = hubSettings()) {
  const c = s.agents?.casino || {}, D = CASINO_DEFAULTS;
  const levels = Array.isArray(c.betLevels) ? c.betLevels.map(Number).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b) : [];
  return {
    on: c.on === true,
    name: String(c.name || D.name).slice(0, 60),
    dataDir: String(c.dataDir || D.dataDir),
    maxStakePerSession: num(c.maxStakePerSession, D.maxStakePerSession, 0),
    stakeShare: num(c.stakeShare, D.stakeShare, 0, 1),
    minBalance: num(c.minBalance, D.minBalance, 0),
    maxSessionsPerDay: Math.floor(num(c.maxSessionsPerDay, D.maxSessionsPerDay, 0)),
    gapMinutes: num(c.gapMinutes, D.gapMinutes, 0),
    chance: num(c.chance, D.chance, 0, 1),
    perTick: Math.floor(num(c.perTick, D.perTick, 0)),
    betLevels: levels.length ? levels : D.betLevels,
  };
}

// ---------- the table ----------
/** @typedef {{ id: number, weight: number, pay: number, criteria: string }} Outcome */
/** @typedef {{ open: boolean, dir: string, why?: string, outcomes?: Outcome[], cum?: number[], total?: number, rows?: number, rtp?: number, hitRate?: number, maxPay?: number }} Table */
let cache = /** @type {{ key: string, table: Table } | null} */ (null);
const rowsOf = (/** @type {string} */ text) => text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^\d/.test(l)).map((l) => l.split(","));

/** Read both CSVs (cached until either file changes) and keep the base-only rounds. */
export function loadTable(dir = resolvePath(casinoSettings().dataDir)) {
  const files = [FILES.table, FILES.segmented].map((f) => path.join(dir, f));
  let stats;
  try { stats = files.map((f) => fs.statSync(f)); } catch { return /** @type {Table} */ ({ open: false, dir, why: `the game's tables aren't in ${dir} (${FILES.table} and ${FILES.segmented})` }); }
  const key = `${dir}|${stats.map((s) => `${s.mtimeMs}:${s.size}`).join("|")}`;
  if (cache?.key === key) return cache.table;
  /** @type {Table} */
  let table;
  try {
    /** @type {Map<number, number>} */
    const weights = new Map();
    for (const [id, w] of rowsOf(fs.readFileSync(files[0], "utf8"))) weights.set(Number(id), Number(w));
    const outcomes = [];
    let rows = 0;
    for (const [id, criteria, base, free] of rowsOf(fs.readFileSync(files[1], "utf8"))) {
      rows++;
      const fg = Number(free), pay = Number(base), w = weights.has(Number(id)) ? Number(weights.get(Number(id))) : 1;
      if (fg !== 0 || !Number.isFinite(pay) || !(w > 0)) continue; // base game only: no free-spin rounds
      outcomes.push({ id: Number(id), weight: w, pay, criteria: String(criteria || "") });
    }
    if (!outcomes.length) throw new Error("no base-game rounds in the tables");
    const cum = [];
    let total = 0, paid = 0, hit = 0, maxPay = 0;
    for (const o of outcomes) { total += o.weight; cum.push(total); paid += o.weight * o.pay; if (o.pay > 0) hit += o.weight; maxPay = Math.max(maxPay, o.pay); }
    table = { open: true, dir, outcomes, cum, total, rows, rtp: paid / total, hitRate: hit / total, maxPay };
  } catch (err) {
    table = { open: false, dir, why: `the game's tables couldn't be read: ${/** @type {Error} */ (err).message}` };
  }
  cache = { key, table };
  return table;
}

/** A seedable random number generator (mulberry32), for tests; the hub uses Math.random. */
export function seededRng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** One weighted draw from the base-only rounds. */
export function drawOutcome(/** @type {any} */ table, rng = Math.random) {
  const x = rng() * table.total;
  let lo = 0, hi = table.cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (table.cum[mid] > x) hi = mid; else lo = mid + 1; }
  return table.outcomes[lo];
}

// ---------- play ----------
/** A worker's play style, the same every time (from its id). */
export function styleOf(/** @type {string} */ id) {
  let h = 2166136261;
  for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return /** @type {keyof typeof CASINO_STYLES} */ (Object.keys(CASINO_STYLES)[(h >>> 0) % 3]);
}
// The biggest bet level at or under `target` (the smallest level when none is).
const levelFor = (/** @type {number[]} */ levels, /** @type {number} */ target) => [...levels].reverse().find((l) => l <= target + 1e-9) ?? levels[0];
const fits = (/** @type {number[]} */ levels, /** @type {number} */ money) => [...levels].reverse().find((l) => l <= money + 1e-9) ?? null;

/**
 * Play one session (no files touched). bankroll: the credits brought; the bet never passes what is left of it, so the
 * worker loses at most the bankroll.
 * @param {{ style: string, bankroll: number, table: any, rng?: () => number, levels?: number[] }} o
 */
export function playSession({ style, bankroll, table, rng = Math.random, levels = CASINO_DEFAULTS.betLevels }) {
  const st = CASINO_STYLES[/** @type {keyof typeof CASINO_STYLES} */ (style)] || CASINO_STYLES.steady;
  const base = levelFor(levels, bankroll * st.betShare);
  const spins = [];
  let left = r2(bankroll), bet = base, stop = "", lostLast = false;
  for (;;) {
    const net = r2(left - bankroll);
    if (style === "cautious" && st.lossStop != null && net <= -bankroll * st.lossStop) { stop = "loss limit"; break; }
    if (style === "cautious" && st.winStop != null && net >= bankroll * st.winStop) { stop = "win goal"; break; }
    if (spins.length >= Math.min(st.spins, HARD_MAX_SPINS)) { stop = style === "steady" ? "planned spins done" : "spin limit"; break; }
    if (style === "chaser") bet = lostLast ? levels[Math.min(levels.indexOf(bet) + 1, levels.length - 1)] : base;
    const can = fits(levels, left);
    if (can == null) { stop = "out of session money"; break; }
    if (bet > can) bet = can;
    const o = drawOutcome(table, rng), win = r2(bet * o.pay);
    left = r2(left - bet + win);
    lostLast = win < bet;
    spins.push({ bet, outcome: o.id, mult: o.pay, win, left });
  }
  return { spins, net: r2(left - bankroll), stop, baseBet: base };
}

const isPet = (/** @type {string} */ id) => { const p = String(petName() || "").trim().toLowerCase(); return id === "pet" || (!!p && id.toLowerCase() === p); };
/** The casino log, oldest first. */
export const casinoLog = () => readJsonl(LOG());

/**
 * One worker plays a session now: spins and the session line to casino.jsonl, the net to its wallet.
 * @param {{ id: string, room?: string }} desk
 * @param {{ rng?: () => number, now?: number, table?: any, balance?: number, set?: ReturnType<typeof casinoSettings> }} [o]
 */
export function playFor(desk, { rng = Math.random, now = Date.now(), table, balance, set = casinoSettings() } = {}) {
  if (isPet(desk.id) || desk.id === ownerId()) throw new Error("The pet and the owner don't play.");
  const t = table || loadTable(resolvePath(set.dataDir));
  if (!t.open) throw new Error(`The casino is closed: ${t.why}.`);
  const start = r2(balance ?? wallets(now)[desk.id]?.balance ?? 0);
  const bankroll = r2(Math.min(set.maxStakePerSession, start * set.stakeShare, start));
  if (!(bankroll >= set.betLevels[0])) throw new Error(`${desk.id} hasn't enough credits to play.`);
  const style = styleOf(desk.id), session = newId(), at = new Date(now).toISOString();
  const run = playSession({ style, bankroll, table: t, rng, levels: set.betLevels });
  const lines = run.spins.map((s, i) => ({ kind: "spin", at, desk: desk.id, session, n: i + 1, style, mode: "base", bet: s.bet, outcome: s.outcome, mult: s.mult, win: s.win, balance: r2(start - bankroll + s.left) }));
  const staked = r2(run.spins.reduce((a, s) => a + s.bet, 0)), won = r2(run.spins.reduce((a, s) => a + s.win, 0));
  const summary = { kind: "session", at, desk: desk.id, room: desk.room || null, session, style, mode: "base", bankroll, baseBet: run.baseBet, spins: run.spins.length, staked, won, net: run.net, stop: run.stop, balanceBefore: start, balanceAfter: r2(start + run.net) };
  appendJsonl(LOG(), ...lines, summary);
  if (run.net !== 0) appendJsonl(WALLET(), { at, desk: desk.id, item: "casino", for: session, cost: r2(-run.net) });
  return summary;
}

/**
 * With the Campus shop timer: a few idle workers with spare credits may play a session. Off unless agents.casino.on,
 * and never in demo mode or with the jobs switched off.
 * @param {{ rng?: () => number, now?: number }} [o]
 */
export function casinoTick({ rng = Math.random, now = Date.now() } = {}) {
  const set = casinoSettings();
  if (!set.on || isDemo() || jobsDisabled() || set.perTick < 1) return [];
  const table = loadTable(resolvePath(set.dataDir));
  if (!table.open) return [];
  const ws = wallets(now), busy = new Set(jobs().filter(openJob).map((j) => j.desk)), log = casinoLog().filter((l) => l.kind === "session");
  const tz = hubTz(), today = dayIn(tz, new Date(now)), played = [];
  for (const d of roster().desks.filter((x) => x.status === "active")) {
    if (played.length >= set.perTick) break;
    if (isPet(d.id) || d.id === ownerId() || busy.has(d.id)) continue;
    const bal = ws[d.id]?.balance ?? 0;
    if (bal < set.minBalance) continue;
    const mine = log.filter((l) => l.desk === d.id);
    if (mine.filter((l) => dayIn(tz, new Date(l.at)) === today).length >= set.maxSessionsPerDay) continue;
    const lastAt = mine.length ? Date.parse(mine[mine.length - 1].at) : 0;
    if (now - lastAt < set.gapMinutes * 60000) continue;
    if (rng() >= set.chance) continue;
    try { played.push(playFor(d, { rng, now, table, balance: bal, set })); } catch (err) { console.warn(`Casino: ${/** @type {Error} */ (err).message}`); }
  }
  if (played.length) logEvent("campus casino", { sessions: played.length, net: r2(played.reduce((a, s) => a + s.net, 0)) });
  return played;
}

// ---------- stats ----------
/** For the panel and GET /agents/casino: measured against the table's own base-only numbers. */
export function casinoView({ last = 20 } = {}) {
  const set = casinoSettings(), table = loadTable(resolvePath(set.dataDir)), lines = casinoLog();
  const spins = lines.filter((l) => l.kind === "spin"), sessions = lines.filter((l) => l.kind === "session");
  let bet = 0, won = 0, hits = 0, streak = 0, longest = 0, biggest = null;
  /** @type {Record<string, { sessions: number, spins: number, bet: number, won: number, net: number, rtp: number | null }>} */
  const styles = {};
  for (const k of Object.keys(CASINO_STYLES)) styles[k] = { sessions: 0, spins: 0, bet: 0, won: 0, net: 0, rtp: null };
  for (const s of spins) {
    bet += s.bet || 0; won += s.win || 0;
    if (s.win > 0) hits++;
    streak = s.win < s.bet ? streak + 1 : 0;
    longest = Math.max(longest, streak);
    if (!biggest || s.win > biggest.win) biggest = { win: s.win, mult: s.mult, bet: s.bet, desk: s.desk, outcome: s.outcome, at: s.at };
    const y = styles[s.style];
    if (y) { y.spins++; y.bet += s.bet || 0; y.won += s.win || 0; }
  }
  const stops = /** @type {Record<string, number>} */ ({});
  for (const s of sessions) {
    stops[s.stop] = (stops[s.stop] || 0) + 1;
    const y = styles[s.style];
    if (y) { y.sessions++; y.net += s.net || 0; }
  }
  for (const y of Object.values(styles)) { y.bet = r2(y.bet); y.won = r2(y.won); y.net = r2(y.net); y.rtp = y.bet > 0 ? Math.round((y.won / y.bet) * 10000) / 10000 : null; }
  return {
    name: set.name,
    on: set.on,
    open: table.open,
    why: table.open ? null : table.why,
    note: "Play credits only (never real money). Base game only: free-spin rounds are left out while the bonus maths is rebalanced.",
    table: table.open ? { rows: table.rows, baseRounds: table.outcomes.length, rtp: Math.round(table.rtp * 10000) / 10000, hitRate: Math.round(table.hitRate * 10000) / 10000, maxPay: table.maxPay } : null,
    settings: { maxStakePerSession: set.maxStakePerSession, stakeShare: set.stakeShare, minBalance: set.minBalance, maxSessionsPerDay: set.maxSessionsPerDay, betLevels: set.betLevels },
    spins: spins.length,
    staked: r2(bet),
    won: r2(won),
    rtp: bet > 0 ? Math.round((won / bet) * 10000) / 10000 : null,
    hitRate: spins.length ? Math.round((hits / spins.length) * 10000) / 10000 : null,
    biggestWin: biggest,
    longestLosingStreak: longest,
    sessions: sessions.length,
    avgSpins: sessions.length ? Math.round((sessions.reduce((a, s) => a + (s.spins || 0), 0) / sessions.length) * 10) / 10 : null,
    stops,
    styles: Object.fromEntries(Object.entries(styles).map(([k, v]) => [k, { ...v, about: CASINO_STYLES[/** @type {keyof typeof CASINO_STYLES} */ (k)].about }])),
    last: sessions.slice(-last).reverse(),
  };
}
