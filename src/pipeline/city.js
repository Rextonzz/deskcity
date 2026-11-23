// @ts-check
// The city view (Living City lane L2, docs/campus-living-city.md): the few facts the campus's goods-and-records effects
// need (shipping docks, cargo barge, library, pneumatic tubes, construction crane, weather balloons, blimp), as COUNTS ONLY.
// GET /api/agents/city. Read-only: it only gathers what other parts already keep; nothing here calls an AI or spends money.
// No file names, paths, titles of private things, tokens or secrets: the only words that leave are the three newest
// changelog titles (public release notes), the spend label (ok / near / over) and project ids the campus already shows.
// A source that does not exist, or whose part is switched off, answers null: it is never made up.
// Cached for 30 s, because the campus asks once a minute from every open page.
import { moduleOn } from "../hub/modules.js";
import { listJobs } from "./jobs.js";
import { openRuns } from "./runlog.js";
import { lastBackup } from "./backup.js";
import { recordingCount } from "./livewatch.js";
import { readLog } from "./alerts.js";
import { changelog } from "./versions.js";
import { prReviews } from "./agents/assistant.js";
import { requests, openJobs, forecastNow } from "./agents.js";

const CACHE_MS = 30e3;
let cache = null;

/** @template T @param {() => T} fn @returns {T | null} */
const tryOr = (fn) => { try { return fn(); } catch { return null; } };

/** Build the answer now (no cache). `settings` is the hub settings (which parts are on); tests pass their own `now`.
 * @param {{ settings?: any, now?: number }} [o] */
export function buildCity({ settings, now = Date.now() } = {}) {
  const youtube = moduleOn("youtube", settings);
  const jobs = youtube ? tryOr(() => listJobs()) : null;
  const out = {
    at: new Date(now).toISOString(),
    // uploads going out (YouTube / TikTok): null when that part is off
    uploads: jobs ? {
      posting: jobs.filter((j) => j.status === "publishing" || j.status === "posting").length + (tryOr(() => openRuns().filter((r) => r.kind === "tiktok post" || r.kind === "make public").length) || 0),
      waiting: jobs.filter((j) => j.status === "private" || (j.status === "scheduled" && Date.parse(j.data?.publishAt) > now)).length,
    } : null,
    // live streams being recorded and cut into clips right now
    live: youtube ? { recording: tryOr(() => recordingCount()) ?? 0 } : null,
    // the last backup: when, and whether it passed
    backup: tryOr(() => { const b = lastBackup(); return b && b.at ? { at: String(b.at), ok: b.ok !== false } : null; }),
    // alert rules that fired in the last 24 hours
    alerts: tryOr(() => ({ open: Object.values(readLog().last).filter((t) => now - Date.parse(String(t)) < 864e5).length })),
    // the month's spend forecast label for the whole hub
    forecast: tryOr(() => { const l = forecastNow(new Date(now))?.hub?.label; return l === "ok" || l === "near" || l === "over" ? l : null; }),
    // the three newest changelog titles
    changelog: tryOr(() => changelog().slice(0, 3).map((c) => String(c.title || "").slice(0, 90)).filter(Boolean)) || [],
    // pull-request reviews from the last 3 days (the reviewers keep no "closed" mark), and which projects they were for
    prReviews: tryOr(() => {
      const list = prReviews().filter((r) => now - Date.parse(String(r.at)) < 3 * 864e5);
      const rooms = {};
      for (const r of list) if (typeof r.room === "string" && /^[a-z0-9][a-z0-9_-]{0,47}$/.test(r.room)) rooms[r.room] = (rooms[r.room] || 0) + 1;
      return { recent: list.length, concerns: list.filter((r) => r.code?.verdict === "concerns" || r.security?.verdict === "concerns").length, rooms };
    }),
    // The hub keeps no list of projects being built (a new project is just a room), so the crane runs on PR reviews only.
    projectsBuilding: null,
    // waiting for the owner: asks, hires HR recommended, and held pipeline jobs
    owner: tryOr(() => {
      const open = requests({ open: true });
      const asks = open.filter((q) => q.kind === "ask").length, hires = open.filter((q) => q.kind === "staff" && q.status === "recommended").length;
      const held = jobs ? jobs.filter((j) => j.status === "held").length : 0;
      return { asks, hires, held, total: asks + hires + held };
    }),
    // long or many-step jobs: step and of only, newest first (at most 5)
    batches: tryOr(() => openJobs().filter((j) => j.of > 1).slice(0, 5).map((j) => ({ step: Math.max(1, Math.min(j.of, Number(j.step) || 1)), of: Math.min(99, Number(j.of)) }))) || [],
  };
  return out;
}

/** The cached answer (30 s).
 * @param {{ settings?: any, now?: number, fresh?: boolean }} [o] */
export function cityNow({ settings, now = Date.now(), fresh = false } = {}) {
  if (!fresh && cache && now - cache.t < CACHE_MS) return cache.v;
  const v = buildCity({ settings, now });
  cache = { t: now, v };
  return v;
}
export const clearCityCache = () => { cache = null; };
