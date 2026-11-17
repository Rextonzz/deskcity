// The hub's parts (the owner 2026-11-14: "make sure each part of our project can be an option so people can choose how
// lightweight it is"). One entry per part: what it is, what it needs, and what it owns (pages, server routes under
// /api/pipeline, timers), so one switch turns all of it off. The hub settings' "modules" list says what's on; the
// setup guide (docs/kit/SETUP.md) offers the presets below. Core is always on.
//   pages   public/<name>.html                      blocked (sent to the campus) and hidden from the menu when off
//   routes  /api/pipeline/<prefix>                   answer 404 "switched off" when off
//   timers  names used in server.js / startWatchers  don't start when off (moduleOn checks at start-up)
//   needs   programs, keys (.env names), ai          shown in setup so people see the weight before picking
//   requires files (relative to the hub folder) that must exist for the part to work, e.g. a Python script the kit does not
//            ship. A part with one missing is "not included in this kit": no preset offers it, it is never on (its pages,
//            routes and timers behave as if switched off) and Admin and setup say so. HUB_FILES_ROOT points the check at
//            another folder (tests).
//   private true: this owner's own part; never in the kit (tools/export-kit.mjs) and never in a preset
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hubSettings } from "./settings.js";
import { PARTS } from "./extras.js";

// Per-channel stats pages (public/stats-<channel id>.html), found from the files, so a hub lists the ones it has (the kit has none
// of its own: a channel there gets its stats from the shared Stats page). stats-tiktok is one page for all channels.
const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public");
const channelStatsPages = () => { if (process.env.HUB_DEMO === "1") return []; try { return fs.readdirSync(PUBLIC).map((f) => /^(stats-.+)\.html$/.exec(f)?.[1]).filter((p) => p && p !== "stats-tiktok").sort(); } catch { return []; } };

const HUB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const filesRoot = () => (process.env.HUB_FILES_ROOT ? path.resolve(process.env.HUB_FILES_ROOT) : HUB_ROOT);
// The files a part needs that are not there (empty when it has none to check or all are present).
export const missingFiles = (m, root = filesRoot()) => (m?.requires || []).filter((f) => !fs.existsSync(path.join(root, f)));
export const notIncluded = (m, root) => missingFiles(m, root).length > 0;

export const MODULES = [
  { id: "core", name: "Core", always: true, about: "Sign-in, settings, the Agents page, jobs and events, the Claude Code hook, HR, the 2D campus, backups, alerts.",
    routes: ["/admin", "/notify", "/backup", "/security", "/app", "/ai", "/digest", "/runs", "/export", "/agents", "/glance"],
    pages: ["campus", "agents", "admin", "ai", "login"], needs: { keys: ["ANTHROPIC_API_KEY"] } },
  // ---- how it looks ----
  { id: "campus3d", name: "3D campus", group: "Look", about: "The campus as a 3D city. Needs a computer or phone that can run 3D; the 2D city is always there.", pages: ["campus3d-lab"], needs: { size: "about 3 MB of 3D files" } },
  { id: "neural", name: "Neural view", group: "Look", about: "The web of workers and how they hand work on, and each job as a tree you can dive into.", routes: ["/agents/trace", "/agents/web"] },
  { id: "pet", name: "Campus pet", group: "Look", about: "A code-drawn pet that lives on the campus (needs a pet in settings)." },
  // ---- running the team ----
  { id: "board", name: "Board and finance buddy", group: "Team", about: "Approves small hires within budget and keeps an eye on spending.", timers: ["Board"] },
  { id: "prreviews", name: "Pull-request reviews", group: "Team", about: "A worker reviews new pull requests on your GitHub repos.", timers: ["PR reviews"], needs: { keys: ["a GitHub token per repo"] } },
  { id: "campuslife", name: "Campus life", group: "Team", about: "Credits, the Campus Mart, chores, worker chatter and growing personalities. Chatter and personalities use a little AI.",
    timers: ["Campus shop", "Campus chatter", "Campus selves", "Chores"], needs: { ai: "a few cents a day (Gemini Flash)" } },
  { id: "quality", name: "Quality checks", group: "Team", about: "Taste tests for workers: re-run a desk's best past jobs on a cheaper model or a new brief and see how it compares, plus every brief change kept with the scores that followed. Only spends AI money when you run a check (capped, password). Job scores and score-based pay are part of HR and always on.",
    routes: ["/agents/quality"], needs: { ai: "only when you run a check: up to $1 each" } },
  { id: "overview", name: "Classic pages", group: "Team", about: "Home, Search everything and the Project page: one place across all your parts.",
    pages: ["home", "search", "project"], routes: ["/search", "/project"], timers: ["To-do snapshot"] },
  // ---- bigger add-ons ----
  { id: "youtube", name: "YouTube and TikTok pipeline", group: "Add-ons", about: "Makes, schedules and uploads Shorts, with stats. The heaviest part. The author's own tool, not supported: it reaches sites through their unofficial pages, which can change or break.",
    pages: ["pipeline", "stats", ...channelStatsPages(), "stats-tiktok", "youtube-settings", "queue", "calendar"],
    routes: ["/jobs", "/stats", "/channels", "/upload", "/tiktok", "/queue", "/calendar", "/batch", "/corrections", "/health", "/admin/schedule", "/admin/posting-stats", "/admin/episode-check", "/admin/downloads", "/admin/download"],
    timers: ["Upload worker"], requires: ["python/stats.py"], needs: { programs: ["ffmpeg", "Python", "Chrome"], keys: ["GEMINI_API_KEY", "ELEVENLABS_API_KEY"] } },
  { id: "cards", name: "Trading cards", group: "Add-ons", about: "Your card collection, prices, deal watch, paper matches, deck ideas and MTG Arena. The author's own tool, not supported: it reaches sites through their unofficial pages, which can change or break.",
    pages: ["collection", "cards", "deals", "matches", "deckideas", "arena"],
    routes: ["/collection", "/cards", "/lookup", "/arena", "/paper-matches", "/admin/msrp"],
    timers: ["Deal watch", "Card import", "Card prices", "Arena read"], requires: ["python/petdeck.py"], needs: { programs: ["Chrome (deal watch)"] } },
  { id: "reading", name: "Watching and reading", group: "Hobbies", about: "Anime and manga you follow, with new episodes and chapters.", pages: ["reading"], routes: ["/reading"], timers: ["Reading check"] },
  { id: "games", name: "Games", group: "Hobbies", about: "Every game you play, any platform: status, hours, notes and a log. Games with more to track get add-ons (src/pipeline/games.js).", pages: ["games"], routes: ["/games"] },
  // ---- team templates: a project type that comes with a standard crew (src/pipeline/teams.js) ----
  { id: "gamedev", name: "Game development team", group: "Team templates", about: "Adds a Team choice when you create a project: a crew to build, design, review, test and ship a game. HR staffs it; you approve each hire." },
  // ---- spin-outs: tools a project built that became parts of their own, on the base they extend ----
  { id: "wow", name: "WoW raids", group: "Spin-outs", extends: "games", spunOutOf: "the WoW raid lead project", about: "A Games add-on: World of Warcraft characters and raid logs. The author's own tool, not supported: it reaches sites through their unofficial pages, which can change or break.", pages: ["wow"], routes: ["/wow"], needs: { keys: ["WCL_CLIENT_ID", "BNET_CLIENT_ID"] } },
  { id: "todo", name: "To-do and ideas", group: "Hobbies", about: "A simple to-do and ideas list.", pages: ["todo"], routes: ["/todo"] },
  // ---- this owner's own, never in the kit: each file in src/private/ adds its part (src/hub/extras.js) ----
  ...PARTS.filter((p) => p.module?.id).map((p) => ({ group: "Private", private: true, ...p.module })),
];
const BY_ID = new Map(MODULES.map((m) => [m.id, m]));
export const PRESETS = {
  light: { name: "Light", about: "The core and the 2D campus. Runs on almost anything.", modules: [] },
  // Standard is the AI hub with the campus only: no pet, no hobbies. Those are one switch each (Everything has them).
  standard: { name: "Standard", about: "Adds the 3D campus, the Neural view, campus life and the board.", modules: ["campus3d", "neural", "campuslife", "board"] },
  everything: { name: "Everything", about: "Every part this copy includes (you can still turn any off later).", modules: MODULES.filter((m) => !m.always && !m.private && !notIncluded(m)).map((m) => m.id) },
};
// The parts a preset turns on, leaving out any whose files are missing (root: where to look; tests pass their own).
export const presetModules = (id, root) => (id === "everything" ? MODULES.filter((m) => !m.always && !m.private && !notIncluded(m, root)).map((m) => m.id) : PRESETS[id]?.modules || []);
// Groups, in the order setup shows them. Spin-outs carry "extends" (the base part they build on) and "spunOutOf".
export const GROUPS = ["Look", "Team", "Team templates", "Add-ons", "Hobbies", "Spin-outs", "Private"];
// Settings from before modules: the old add-on names, and every part that wasn't an add-on stays on, so an existing hub
// keeps exactly what it had.
const LEGACY = { "youtube-pipeline": ["youtube", "overview"], cards: ["cards"], hobbies: ["reading", "games", "wow", "todo"], ...Object.assign({}, ...PARTS.map((p) => p.legacy || {})) };
const WAS_ADDON = new Set(Object.values(LEGACY).flat());

export function modulesOn(s = hubSettings()) {
  const on = new Set(["core"]);
  if (Array.isArray(s.modules)) for (const id of s.modules) { if (BY_ID.has(id)) on.add(id); }
  else {
    for (const m of MODULES) if (!m.always && !m.private && !WAS_ADDON.has(m.id)) on.add(m.id);
    for (const a of s.addons || []) for (const id of LEGACY[a] || []) on.add(id);
    for (const p of PARTS) p.legacyOn?.(s, on);
  }
  for (const m of MODULES) if (on.has(m.id) && notIncluded(m)) on.delete(m.id); // its files are not in this copy: it can't run, whatever the settings say
  return on;
}
export const moduleOn = (id, s) => id === "core" || modulesOn(s).has(id);
// Which module a timer, page or route belongs to (core when none claims it).
export const timerOn = (name, s) => { const m = MODULES.find((x) => x.timers?.includes(name)); return !m || moduleOn(m.id, s); };
export function offPages(s) {
  const on = modulesOn(s);
  const off = MODULES.filter((m) => !on.has(m.id)).flatMap((m) => m.pages || []);
  if (process.env.HUB_DEMO !== "1") return off;
  // Demo mode (tools/demo.mjs): a page that no switched-on part owns (a page this checkout has of its own) is off too,
  // so the sample hub shows only the parts it seeds data for.
  const owned = new Set(MODULES.filter((m) => on.has(m.id)).flatMap((m) => m.pages || []));
  try { return [...new Set([...off, ...fs.readdirSync(PUBLIC).filter((f) => f.endsWith(".html")).map((f) => f.slice(0, -5)).filter((p) => !owned.has(p))])]; } catch { return off; }
}
export function routeModule(p) {
  let best = null, len = -1;
  for (const m of MODULES) for (const r of m.routes || []) if ((p === r || p.startsWith(`${r}/`)) && r.length > len) { best = m; len = r.length; }
  return best;
}
// Express middleware for /api/pipeline: a switched-off part's routes answer 404 with a plain reason.
// (Three parameters exactly: Express takes a four-parameter function for an error handler and skips it. The tests call
// gateRoute / gatePage with settings of their own.)
export const moduleGate = (req, res, next) => gateRoute(req, res, next);
export function gateRoute(req, res, next, s) {
  const m = routeModule(req.path);
  if (!m || moduleOn(m.id, s)) return next();
  res.status(404).json({ error: notIncluded(m) ? `${m.name} is not included in this kit.` : `${m.name} is switched off on this hub.`, module: m.id });
}
// For the pages: a switched-off part's pages go to the campus instead.
export const pageGate = (req, res, next) => gatePage(req, res, next);
export function gatePage(req, res, next, s) {
  const name = /^\/([a-z0-9-]+)\.html$/i.exec(req.path)?.[1];
  if (name && offPages(s).includes(name)) return res.redirect("/campus.html");
  next();
}
// The front door, "/" (server.js): a tiny page that goes to this device's pick from the campus's View picker
// (campus.display in the browser), else the hub's display setting. "pages" goes to Home when the Classic pages part is
// on, else the Agents page; anything else goes to the campus.
export function frontDoorHtml(s = hubSettings()) {
  const pagesHome = offPages(s).includes("home") ? "/agents.html" : "/home.html";
  const display = ["2d", "3d", "neural", "pages"].includes(s.display) ? s.display : "3d";
  // The script is a file (public/front.js), so the Content-Security-Policy can refuse inline scripts (security plan 05).
  const attr = (v) => JSON.stringify(v).slice(1, -1);
  return `<!doctype html><meta charset="utf-8"><title>Hub</title><meta name="hub-display" content="${attr(display)}"><meta name="hub-pages" content="${attr(pagesHome)}"><script src="/front.js"></script><a href="/campus.html">Open the hub</a>`;
}
// What the pages need to know.
// The small line under the sign-in page's title: the owner's own words when settings give them ("loginSubtitle"), else the
// names of the add-on and hobby parts that are on, else a neutral line.
export function loginSubtitle(s = hubSettings()) {
  if (typeof s.loginSubtitle === "string" && s.loginSubtitle.trim()) return s.loginSubtitle.trim();
  const on = partsState(s).filter((p) => p.state === "on" && ["Add-ons", "Hobbies"].includes(p.group)).map((p) => p.name);
  return on.length ? on.slice(0, 4).join(" · ") : "Your AI team: workers, jobs and costs";
}
// parts: every part a person can switch (not core, not private) with its state: "on", "off" or "not-included" (Admin lists them).
export const publicModules = (s) => ({ modules: [...modulesOn(s)], offPages: offPages(s), parts: partsState(s) });
export function partsState(s) {
  const on = modulesOn(s);
  return MODULES.filter((m) => !m.always && !m.private).map((m) => ({ id: m.id, name: m.name, group: m.group || "", state: notIncluded(m) ? "not-included" : on.has(m.id) ? "on" : "off" }));
}
