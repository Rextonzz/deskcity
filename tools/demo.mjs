#!/usr/bin/env node
// Demo mode: a sample hub with made-up data, so anyone can click around the 2D, 3D, Neural and Pages views with no keys,
// no sign-in and no AI calls.   npm run demo   then open http://localhost:3960
//
// What it does:
//   1. Makes a fresh demo folder (default ./demo-data, never ./data) and fills it with a generic team: rooms, workers,
//      30 days of steps and spend, jobs in every state, hand-off chains, scores, requests waiting on the owner, alert
//      rules, store items, pets and plants, and two weeks of feed lines. Every name is made up; the owner is "Sam".
//   2. Starts the real hub (server.js) on that folder through the one switch the tests use (HUB_TEST_ROOT) plus HUB_DEMO=1.
//      It listens on this PC only, needs no password, starts no timers and sends nothing anywhere: the keys are taken
//      out of the environment, every outbound connection that is not to this PC is refused, and the Run and Push buttons
//      answer "Demo data: nothing runs here".
//   3. Keeps the campus lively: a few small steps are added every few seconds, so workers keep walking and the feed moves.
//
// Safety: the seeder writes only inside its own folder. It refuses a folder that is, holds or sits in the real data
// folder, and refuses any folder with files it did not make (it marks its own with .hub-demo-folder).
//
// Options: --port 3960   --dir ./demo-data   --seed-only (write the folder, do not start)   --no-live (no new steps)
//          --live-seed N (the live steps come in the same order every run; tools/trailer/capture.mjs uses it)
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MARKER = ".hub-demo-folder";
const MARKER_TEXT = "Made by tools/demo.mjs. Everything in this folder is sample data and is rebuilt on every run.\n";
// What the server writes into its data root while it runs: these are the only top-level names a reseed may clear.
const OWN = new Set(["data", "docs", ".env", "demo-settings.json", "pipeline.config.json", "no-env", MARKER]); // .env: the hub makes its sign-in cookie key there
export const DEMO_PORT = 3960;
const DAY = 864e5;
const same = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
const inside = (child, parent) => { const r = path.relative(parent, child); return r === "" || (!r.startsWith("..") && !path.isAbsolute(r)); };

// ---------- safety: is this folder one the seeder may write to? ----------
// Throws a plain-English Error when not. appDir is the hub's own folder (tests pass a stand-in).
export function checkTarget(target, { appDir = APP } = {}) {
  const t = path.resolve(String(target || ""));
  const realData = path.join(appDir, "data");
  const home = os.homedir();
  if (!String(target || "").trim()) throw new Error("Demo mode needs a folder to write in.");
  if (path.parse(t).root === t) throw new Error("Demo mode won't write in a drive's top folder.");
  if (same(t, realData) || inside(t, realData) || inside(realData, t)) throw new Error(`Demo mode never touches the real data folder (${realData}). Pick another folder.`);
  if (same(t, appDir) || inside(appDir, t)) throw new Error("Demo mode needs a folder of its own, not the hub's folder or one that holds it.");
  if (same(t, home) || inside(home, t)) throw new Error("Demo mode needs a folder of its own, not your home folder or one that holds it.");
  if (fs.existsSync(t)) {
    if (!fs.statSync(t).isDirectory()) throw new Error(`${t} is a file, not a folder.`);
    const names = fs.readdirSync(t);
    if (names.length) {
      if (!names.includes(MARKER)) throw new Error(`${t} has files the demo didn't make. Pick an empty or new folder.`);
      const stray = names.filter((n) => !OWN.has(n));
      if (stray.length) throw new Error(`${t} has files the demo didn't make (${stray.slice(0, 3).join(", ")}). Pick an empty or new folder.`);
    }
  }
  return t;
}

// ---------- small tools ----------
function rng(seed) {
  let a = seed >>> 0;
  const f = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { f, int: (a2, b2) => a2 + Math.floor(f() * (b2 - a2 + 1)), pick: (xs) => xs[Math.floor(f() * xs.length)], chance: (p) => f() < p, hex: (n = 5) => Array.from({ length: n * 2 }, () => "0123456789abcdef"[Math.floor(f() * 16)]).join("") };
}
const PRICE = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5], "gemini-3.1-pro": [2, 12], "gemini-2.5-flash": [0.3, 2.5], "mini-chat": [0.4, 1.6], "local-llm": [0, 0] };
// The kit's own name (hub.defaults.json kit.name), so the demo says whatever the kit is called, never a hard-coded one.
export const kitName = (appDir = APP) => { try { return JSON.parse(fs.readFileSync(path.join(appDir, "hub.defaults.json"), "utf8")).kit?.name || "Hub"; } catch { return "Hub"; } };
// Words no demo room, project or worker may carry: the demo is filmed for the trailer, so no platform, product or
// place name may reach the screen through it (trailer D1, 2026-11-16). AI provider names stay where the hub shows
// them as facts (a worker's provider and model).
export const BANNED_NAMES = ["youtube", "tiktok", "instagram", "twitch", "discord", "facebook", "twitter", "reddit", "spotify", "steam", "velcro", "google sheets"];
const cost = (model, i, o) => { const [pi, po] = PRICE[model] || [1, 5]; return Math.round(((i * pi + o * po) / 1e6) * 1e5) / 1e5; };

// ---------- the team ----------
const ROOMS = [
  { id: "hub", name: "Hub", district: "Tools", about: "The hub itself: settings, helpers and housekeeping." },
  { id: "hr", name: "HR" },
  { id: "website", name: "Website", district: "Creative", about: "The public website: pages, copy and links." },
  { id: "studio", name: "Clip studio", district: "Creative", about: "Short explainer clips: scripts, captions and the posting queue." },
  { id: "mobile", name: "Mobile app", district: "Games", about: "A small puzzle app for phones." },
  { id: "research", name: "Research", district: "Tools", about: "Market and background research for every project." },
  { id: "support", name: "Support", district: "Tools", about: "Answers customers and keeps the help pages honest." },
  { id: "newsletter", name: "Newsletter", district: "Creative", status: "paused", about: "A monthly email. Paused until spring." },
];
// rate: busy weekday sessions (Claude Code leads) or runs (hub-run workers). ratio: how much of its monthly cap the month is
// heading for (0.93 = near the cap, below 0.8 = comfortable). spentShare: what is already spent, as a share of the cap (over 1 = over it).
const D = (id, room, role, o) => ({ id, room, role, lead: false, effort: null, capUsdMonth: null, status: "active", runner: null, ...o });
const DESKS = [
  D("hub-lead", "hub", "Project lead: builds and runs this hub", { lead: true, provider: "claude", model: "claude-code", bill: "subscription", rate: 1.3, floor: "Leadership", brief: "Claude Code session in the hub folder. Reports through the hook." }),
  D("hr", "hr", "HR: checks hiring requests against the budget and picks models", { lead: true, provider: "claude", model: "claude-haiku-5-5", effort: "low", capUsdMonth: 2, runner: "hub", bill: "api", rate: 0.5, ratio: 0.78, brief: "Recommends; the owner approves." }),
  D("finance", "hr", "Finance buddy: tracks spend and warns before caps", { provider: "claude", model: "claude-haiku-5-5", effort: "low", capUsdMonth: 0.5, runner: "hub", bill: "api", rate: 0.4, ratio: 0.42, brief: "Writes a short weekly money note." }),
  D("website-lead", "website", "Project lead", { lead: true, provider: "claude", model: "claude-code", bill: "subscription", rate: 1.8, floor: "Leadership" }),
  D("web-copywriter", "website", "Copywriter: page and product copy", { provider: "claude", model: "claude-sonnet-5-5", effort: "medium", capUsdMonth: 20, runner: "hub", bill: "api", rate: 2.2, ratio: 0.84, floor: "Content", brief: "Plain, friendly copy. Short sentences. No hype." }),
  D("web-designer", "website", "Layout and style reviewer", { provider: "gemini", model: "gemini-3.1-pro", effort: "medium", capUsdMonth: 12, runner: "hub", bill: "api", rate: 1.2, ratio: 0.55, floor: "Review", brief: "Checks pages against the style guide and phone widths." }),
  D("web-checker", "website", "Link and accessibility checker", { provider: "openai", model: "mini-chat", effort: "low", capUsdMonth: 6, runner: "hub", bill: "api", rate: 1.3, ratio: 0.42, floor: "Review", brief: "Finds broken links and pages a screen reader would trip on." }),
  D("studio-lead", "studio", "Project lead", { lead: true, provider: "claude", model: "claude-code", bill: "subscription", rate: 1.4, floor: "Leadership" }),
  D("clip-scripter", "studio", "Scriptwriter for short clips", { provider: "claude", model: "claude-haiku-5-5", effort: "low", capUsdMonth: 8, runner: "hub", bill: "api", rate: 1.6, ratio: 0.6, floor: "Scripts", brief: "45-second scripts: a hook, a few steps, a closing line." }),
  D("clip-captioner", "studio", "Caption writer (runs on a local model)", { provider: "local", model: "local-llm", runner: "hub", bill: "api", rate: 2.0, ratio: 0, floor: "Scripts", brief: "Short caption lines under 42 characters." }),
  D("mobile-lead", "mobile", "Project lead", { lead: true, provider: "claude", model: "claude-code", bill: "subscription", rate: 2.0, floor: "Leadership" }),
  D("app-builder", "mobile", "App builder", { provider: "claude", model: "claude-sonnet-5-5", effort: "medium", capUsdMonth: 30, runner: "hub", bill: "api", rate: 2.6, ratio: 1.1, spentShare: 1.12, floor: "Build", brief: "Small, tested changes to the puzzle app." }),
  D("level-designer", "mobile", "Puzzle level designer", { name: "Pebble", provider: "gemini", model: "gemini-2.5-flash", effort: "low", capUsdMonth: 6, runner: "hub", status: "paused", bill: "api", rate: 1.0, ratio: 0.5, floor: "Build", brief: "Drafts puzzle levels with difficulty notes." }),
  // The Research room works across three providers (trailer v6: cross-model work): its lead on Gemini, the scout on Claude,
  // the fact checker on a local model. A job given to a desk with "then" plays out step by step (startPlay below).
  D("research-lead", "research", "Research lead", { lead: true, provider: "gemini", model: "gemini-3.1-pro", effort: "medium", capUsdMonth: 25, runner: "hub", bill: "api", rate: 1.0, ratio: 0.88, brief: "Turns findings into a one-page recommendation." }),
  D("market-scout", "research", "Market scout", { provider: "claude", model: "claude-sonnet-5-5", effort: "medium", capUsdMonth: 10, runner: "hub", bill: "api", rate: 1.6, ratio: 0.48, brief: "Finds prices, features and reviews of similar apps." }),
  D("fact-checker", "research", "Fact checker (runs locally)", { provider: "local", model: "local-llm", runner: "hub", bill: "api", rate: 0.8, ratio: 0, brief: "Checks every figure against its source and says which ones it could not confirm." }),
  D("paper-summarizer", "research", "Reading summarizer", { provider: "gemini", model: "gemini-2.5-flash", effort: "low", capUsdMonth: 5, runner: "hub", bill: "api", rate: 1.2, ratio: 0.3, brief: "Short summaries of articles and studies." }),
  D("support-lead", "support", "Project lead", { lead: true, provider: "claude", model: "claude-code", bill: "subscription", rate: 1.5, floor: "Leadership" }),
  D("reply-drafter", "support", "Reply drafter", { provider: "claude", model: "claude-haiku-5-5", effort: "low", capUsdMonth: 6, runner: "hub", bill: "api", rate: 2.4, ratio: 0.7, brief: "Drafts replies in a kind, short style. Refunds go to a human." }),
  D("newsletter-writer", "newsletter", "Newsletter writer", { provider: "claude", model: "claude-haiku-5-5", effort: "low", capUsdMonth: 4, runner: "hub", status: "paused", pausedWithRoom: true, bill: "api", rate: 0.6, ratio: 0.2, brief: "A friendly monthly roundup." }),
];

// What workers do, per room: files they touch and what a finished reply says.
const WORK = {
  hub: { files: ["settings.json", "README.md", "roster.md", "dashboard.css", "alerts.json"], says: ["Tidied the settings guide", "Wrote down what each switch does", "Fixed a typo in the alerts text", "Checked the weekly backup ran", "Moved old notes into the archive"] },
  website: { files: ["pricing.html", "index.html", "faq.html", "styles.css", "nav.js", "contact.html", "launch.md"], says: ["Rewrote the pricing page headings", "Fixed the phone menu on small screens", "Added alt text to eleven images", "Moved the FAQ below the plans table", "Cleaned up unused styles", "Drafted the launch post", "Shortened three long paragraphs"] },
  studio: { files: ["script-14.md", "captions-14.srt", "queue.json", "hook-ideas.md", "outro.txt"], says: ["Wrote a hook for the paper crane clip", "Trimmed the script to 45 seconds", "Fixed two caption timings", "Listed seven ideas for next week", "Added a closing line to every script"] },
  mobile: { files: ["LevelLoader.js", "board.js", "score.js", "menu.css", "settings.js", "pack-2.json"], says: ["Fixed the score reset after a pause", "Added a settings screen", "Made the hint button easier to tap", "Sped up level loading", "Wrote a test for the board rules", "Tidied the menu spacing"] },
  research: { files: ["pricing-table.md", "sources.md", "survey-draft.md", "notes.md", "summary.md"], says: ["Collected yearly prices for three apps", "Summarised two articles on subscriptions", "Drafted eight survey questions", "Checked a figure against its source", "Wrote the one-page recommendation"] },
  support: { files: ["macros.md", "faq-answers.md", "triage-rules.md", "weekly-report.md", "replies.md"], says: ["Rewrote the password reset macro", "Drafted twelve replies", "Added a triage rule for payment failures", "Wrote the weekly report", "Marked three refund tickets for a human"] },
  newsletter: { files: ["issue-3.md", "subscribers.md"], says: ["Outlined the next issue", "Wrote the intro paragraph"] },
  hr: { files: ["requests.md"], says: ["Checked a hiring request against the budget", "Scored the week's finished jobs", "Compared two models for a new role"] },
};
const TOOLS = ["Read", "Read", "Read", "Edit", "Edit", "Write", "Bash", "Grep", "Glob", "WebSearch"];
const NOTES = ["+12 −3 lines", "+4 −1 lines", "changed 2 lines", "+8 −0 lines, added section \"Steps\"", "+20 −6 lines", "wrote 34 lines, 3 sections", "+2 −2 lines", "+9 −4 lines, added section \"FAQ\""];

// ---------- the seeder ----------
// Writes the whole demo folder and returns counts. Everything is relative to `now`, so a run always looks current.
export function seedDemo({ target, now = new Date(), seed = 20261116, appDir = APP } = {}) {
  const root = checkTarget(target, { appDir });
  // reseed: clear only what an earlier run made (the check above allowed only those names)
  if (fs.existsSync(root)) for (const n of fs.readdirSync(root)) fs.rmSync(path.join(root, n), { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const written = new Set();
  const put = (rel, text) => {
    const p = path.resolve(root, rel);
    if (!inside(p, root) || same(p, root)) throw new Error(`Demo seeder refused to write outside its folder: ${rel}`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
    written.add(path.relative(root, p).replace(/\\/g, "/"));
  };
  const json = (rel, v) => put(rel, JSON.stringify(v, null, 2) + "\n");
  const jsonl = (rel, rows) => put(rel, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  const A = "data/agents";
  const R = rng(seed);
  const NOW = now.getTime();
  const iso = (ms) => new Date(ms).toISOString();
  const today0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const at = (ago, hour = 9, minute = 0, second = 0) => Math.min(NOW - 1000, today0 - ago * DAY + hour * 3600e3 + minute * 60e3 + second * 1e3);
  const raw = (a2, hour, minute, second) => today0 - a2 * DAY + hour * 3600e3 + minute * 60e3 + second * 1e3;
  const ago = (min) => NOW - min * 60e3;
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const monthDone = (NOW - monthStart) / (Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - monthStart);
  const owner = "sam";
  const desks = DESKS.map((d) => ({ ...d }));
  const byId = Object.fromEntries(desks.map((d) => [d.id, d]));
  const roomOf = (id) => byId[id]?.room;

  put(MARKER, MARKER_TEXT);
  put("no-env", "# An empty settings file for the demo: the hub's own .env is never read here.\n");

  // --- settings and the one generic channel (the Clip studio's queue reads it) ---
  // No video-platform module: its menu links and room would put platform names on screen (trailer D1, 2026-11-16).
  json("demo-settings.json", {
    owner: { id: owner, name: "Sam" }, place: { name: "", lat: null, lon: null, timezone: "UTC" }, pet: null, addons: [], display: "2d",
    modules: ["campus3d", "neural", "campuslife", "board", "quality"], agents: { autoRun: { perDay: 6 } }, network: { listen: "local" },
    districts: {}, services: [], reviews: [], store: { budgetUsd: 20 }, kit: { name: kitName(appDir), version: "demo" },
  });
  json("pipeline.config.json", {
    timezone: "UTC", jobsDir: "./data/jobs", pollSeconds: 10,
    channels: { clips: { enabled: true, name: "Daily clips", short: "DC", layout: "clips", live: false, postingMode: "schedule", slots: { weekday: ["12:00"], weekend: ["10:00"] } } },
  });

  // --- roster ---
  const hired = (d, i) => iso(today0 - (60 - i * 2) * DAY);
  json(`${A}/roster.json`, {
    rooms: ROOMS.map((r) => ({ ...r, status: r.status || "active", changedAt: iso(today0 - 40 * DAY) })),
    desks: desks.map((d, i) => {
      const { bill, rate, ratio, spentShare, ...rest } = d;
      return { ...rest, hiredAt: hired(d, i), changedAt: iso(today0 - 20 * DAY) };
    }),
  });

  // ---------- events ----------
  const events = [], calls = []; // calls: the hub's own AI calls (the run log's "ai call" rows), which the AI and spend page and the caps read
  const deskOfStep = (step) => (String(step).startsWith("hr_review") ? "hr" : String(step).startsWith("desk_") ? String(step).slice(5) : "hub-pipeline");
  const sessionOf = {};
  const E = (ms, d, o) => {
    const e = { kind: "agent event", startedAt: iso(ms), trigger: "agent", source: d.bill === "subscription" ? "claude-code" : "hub", desk: d.id, room: d.room, ...o };
    events.push(e);
    return e;
  };
  const sub = (d) => d.bill === "subscription";
  // a Claude Code lead's session: start, a few replies each with tool steps, end. open: leave it without an end.
  function leadSession(d, ms, { turns = R.int(2, 5), open = false } = {}) {
    const w = WORK[d.room] || WORK.hub, sid = R.hex(8);
    let t = ms;
    const base = { provider: "claude", billing: "subscription", model: "claude-opus-5-5", session: sid };
    E(t, d, { ...base, action: "session start", summary: `Claude Code session in ${d.room}-site` });
    for (let k = 0; k < turns; k++) {
      const steps = R.int(3, 9);
      let tokensIn = 0;
      for (let s = 0; s < steps; s++) {
        t += R.int(5, 40) * 1e3;
        if (t > NOW) return;
        const tool = R.pick(TOOLS), file = R.pick(w.files);
        const sa = tool === "Task" ? R.hex(4) : null;
        E(t, d, { ...base, action: "tool", tool, summary: tool === "WebSearch" || tool === "Bash" || tool === "Grep" || tool === "Glob" ? null : file,
          ...(tool === "Edit" && R.chance(0.6) ? { note: R.pick(NOTES) } : {}), ...(R.chance(0.04) ? { failed: true } : {}), ...(sa ? { agent: sa, agentType: "Explore" } : {}) });
        tokensIn += R.int(2000, 7000);
      }
      if (R.chance(0.25)) { t += 8e3; if (t + 21e3 > NOW) return; /* its "subagent done" 20 s later must not be in the future (it sat on top of the live feed) */ E(t, d, { ...base, action: "tool", tool: "Task", summary: null, agent: R.hex(4), agentType: "Explore" }); E(t + 20e3, d, { ...base, action: "subagent done", agent: events.at(-1).agent, agentType: "Explore" }); t += 21e3; }
      t += R.int(10, 50) * 1e3;
      if (t > NOW) return;
      const o = R.int(900, 3600);
      E(t, d, { ...base, action: "turn done", summary: `${R.int(2, 7)} model replies`, inputTokens: tokensIn, outputTokens: o, cacheReadTokens: tokensIn * 4, costUsd: cost("claude-opus-5-5", tokensIn, o), contextTokens: R.int(30000, 120000) });
      t += R.int(40, 240) * 1e3;
    }
    if (!open && t <= NOW) E(t, d, { ...base, action: "session end", summary: events.find((x) => x.session === sid && x.action === "session start").summary });
    sessionOf[d.id] = sid;
  }
  // a hub-run worker's run: one line with real-looking tokens and cost
  function workerRun(d, ms, summary) {
    const w = WORK[d.room] || WORK.hub;
    const i = R.int(3000, 14000), o = R.int(500, 3200);
    if (ms > NOW) return;
    E(ms, d, { action: "worker run", summary: summary || R.pick(w.says), provider: d.provider, model: d.model, effort: d.effort || undefined, billing: "api" });
    calls.push({ kind: "ai call", startedAt: iso(ms - R.int(3, 20) * 1000), trigger: "app", step: `desk_${d.id}`, provider: d.provider, model: d.model, effort: d.effort || undefined, inputTokens: i, outputTokens: o, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: d.provider === "local" ? 0 : cost(d.model, i, o), aiMs: R.int(2500, 24000) });
  }
  const dow = (ago2) => new Date(today0 - ago2 * DAY).getUTCDay();
  const SPIKES = { 19: ["mobile", 2.6], 6: ["research", 2.4] }; // launch crunch on the Mobile app; a research push last week
  for (let a = 30; a >= 0; a--) {
    const weekend = [0, 6].includes(dow(a));
    for (const d of desks) {
      if (d.status === "retired") continue;
      if (d.id === "level-designer" && a < 4) continue; // paused four days ago
      if (d.room === "newsletter" && a < 9) continue; // paused with its room nine days ago
      const spike = SPIKES[a]?.[0] === d.room ? SPIKES[a][1] : 1;
      const f = (weekend ? 0.18 : 1) * spike;
      if (sub(d)) {
        const n = Math.round(d.rate * f * R.int(7, 13) / 10 + (R.chance(d.rate * f * 0.3) ? 1 : 0));
        for (let k = 0; k < n; k++) { const ms = raw(a, R.int(8, 17), R.int(0, 59), R.int(0, 59)); if (ms < NOW - 25 * 60e3) leadSession(d, ms); }
      } else {
        const n = Math.round(d.rate * f * R.int(6, 14) / 10 + (R.chance(0.35 * f) ? 1 : 0));
        for (let k = 0; k < n; k++) { const ms = raw(a, R.int(8, 18), R.int(0, 59), R.int(0, 59)); if (ms < NOW - 25 * 60e3) workerRun(d, ms); }
      }
    }
  }
  // HR and the board: housekeeping lines
  for (const a of [1, 4, 8, 12, 15, 22, 26]) {
    const ms = at(a, 14, R.int(0, 50));
    E(ms, byId.hr, { action: "scored jobs", summary: R.pick(["Scored the week's finished jobs", "Scored 9 finished jobs, 2 below 60", "Scored 6 jobs; all above 70"]), provider: "claude", model: "claude-haiku-5-5", billing: "api" });
    calls.push({ kind: "ai call", startedAt: iso(ms - 8000), trigger: "app", step: "hr_review_jobs", provider: "claude", model: "claude-haiku-5-5", effort: "low", inputTokens: 5200, outputTokens: 480, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: cost("claude-haiku-5-5", 5200, 480), aiMs: 6100 });
  }
  // a few from the owner's side
  for (const a of [2, 5, 9, 14, 21]) E(at(a, 10, R.int(0, 50)), byId["hub-lead"], { action: `note from Sam`, summary: R.pick(["Keep replies short this week", "Please hold new hires until the budget meeting", "Good work on the pricing page", "Ask me before spending over the cap", "The launch is on Friday"]), source: "manual" });

  // ---------- jobs ----------
  const jobLines = [], outputs = {}, texts = [], scores = {}, ratings = {}, jobEvents = [];
  const jobs = [];
  const J = (o) => { const j = { id: R.hex(5), ...o }; jobs.push(j); return j; };
  const oneLine = (s) => String(s).replace(/\s+/g, " ").trim();
  const body = (desk, task, bullets, follow = []) => `# ${desk}: ${task.slice(0, 110)}\n\n${bullets.map((b) => `- ${b}`).join("\n")}\n${follow.length ? `\n## Follow-ups\n${follow.map((f) => `- ${f}`).join("\n")}\n` : ""}`;
  // done: a finished job. step/chain fields make hand-off chains. by: who gave it.
  function done(o) {
    const j = J({ ...o, status: "done" });
    const created = at(o.ago, o.hour ?? 10, o.min ?? 0);
    const took = created + R.int(1, 4) * 60e3, ended = took + (o.mins ?? R.int(4, 40)) * 60e3;
    j.created = Math.min(created, NOW - 5 * 60e3); j.took = Math.min(took, NOW - 4 * 60e3); j.ended = Math.min(ended, NOW - 3 * 60e3);
    return j;
  }
  const chainKeys = (j, prev, step, of, task, auto) => Object.assign(j, { chain: prev ? prev.chain || prev.id : j.id, step, of, prev: prev?.id, prevDesk: prev?.desk, task, auto });
  const LONG = (s) => s;
  // ---- chain A (Website, 6 days ago): copy -> layout -> checks
  const W1 = done({ ago: 6, hour: 10, desk: "web-copywriter", by: owner, text: "Rewrite the pricing page copy in a friendlier voice and add a section 'FAQ' with the five most common questions.", then: ["web-designer", "web-checker"], step: 1, of: 3,
    summary: "Rewrote the pricing page copy, added a section 'FAQ'", mins: 30, bullets: ["Plain-language headings for all three plans", "FAQ covers refunds, switching plans, team seats, invoices and data export", "Cut the page from 640 to 410 words"], follow: ["The 'Team' plan name may confuse people; worth testing 'Groups'."], score: [91, "Clear, friendly and complete; the FAQ answers match the help pages."], rate: "up" });
  W1.chain = W1.id;
  const W2 = done({ ago: 6, hour: 11, min: 20, desk: "web-designer", by: "chain", text: "Step 2 of 3 of a hand-off chain: review the new pricing copy against the layout.", summary: "Checked the new copy against the layout; shortened two headings so they fit on one line and moved the FAQ under the plans table", bullets: ["Two headings wrapped on phones; shortened both", "FAQ now sits under the plans table, where people look next", "Spacing between plan cards is even at 360 px wide"], score: [84, "Useful fixes, but only checked two screen widths."] });
  chainKeys(W2, W1, 2, 3, W1.text);
  const W3 = done({ ago: 6, hour: 12, min: 5, desk: "web-checker", by: "chain", text: "Step 3 of 3 of a hand-off chain: check links and reading order on the pricing page.", summary: "Checked 14 links and the reading order; fixed 2 broken links, no accessibility errors left", bullets: ["14 links checked: 12 fine, 2 pointed to a removed help page (both fixed)", "Reading order matches the visual order", "All images have text descriptions"], score: [88, "Thorough and short."] });
  chainKeys(W3, W2, 3, 3, W1.text);
  // ---- chain B (Research, 3 days ago)
  const R1 = done({ ago: 3, hour: 9, min: 30, desk: "market-scout", by: owner, text: "Find how three similar apps price their yearly plans, and what the free trial offers.", then: ["paper-summarizer", "research-lead"], step: 1, of: 3, mins: 30,
    summary: "Found pricing for 3 apps: monthly, yearly and trial length in one table", bullets: ["App A: $4.99 monthly, $29.99 yearly, 7-day trial", "App B: $3.99 monthly, $24.99 yearly, no trial", "App C: $5.49 monthly, $34.99 yearly, 14-day trial", "Yearly is 40 to 50 percent cheaper than twelve months of monthly in all three"], score: [87, "Accurate table, sources listed."] });
  R1.chain = R1.id;
  const R2 = done({ ago: 3, hour: 10, min: 40, desk: "paper-summarizer", by: "chain", text: "Step 2 of 3 of a hand-off chain: summarise the two articles on subscription pricing.", summary: "Summarised both articles in six lines each, with the one number worth quoting", bullets: ["Article 1: annual plans keep more customers; the drop-off after month three is steep for monthly plans", "Article 2: a short free trial beats a long one", "Number worth quoting: yearly subscribers stay about twice as long"], score: [80, "Good summaries; the quoted number needs its source."] });
  chainKeys(R2, R1, 2, 3, R1.text);
  const R3 = done({ ago: 3, hour: 11, min: 50, desk: "research-lead", by: "chain", text: "Step 3 of 3 of a hand-off chain: write the one-page recommendation.", summary: "Recommended a yearly plan at two months free; listed the three risks", bullets: ["Offer a yearly plan priced at ten months", "Keep a 7-day trial", "Risks: refunds, a price drop by a rival, confusion between plans"], follow: ["Test the wording on five users before launch."], score: [92, "Clear recommendation with honest risks."], rate: "up" });
  chainKeys(R3, R2, 3, 3, R1.text);
  // ---- chain X (Research, yesterday): one job across three providers, with a refusal passed on (trailer v6).
  // Gemini (the lead) splits it, Claude (the scout) declines once and the hub passes that step to Gemini, a local model
  // checks the figures; each step's call is in the run log and the spend ledger below (xCalls), the refusal in refusals.
  const XQ1 = done({ ago: 1, hour: 10, desk: "research-lead", by: owner, text: "Compare the yearly plans of three rival puzzle apps and tell me which price to copy.", then: ["market-scout", "fact-checker"], step: 1, of: 3, mins: 6,
    summary: "Split the question: the market scout collects the prices, the fact checker checks every figure", bullets: ["Three apps to compare: the two biggest rivals and the newest one", "Collect monthly and yearly price and trial length for each", "Check every figure against its source before we copy anything"], score: [84, "A clear plan with the right next steps."] });
  XQ1.chain = XQ1.id;
  const XQ2 = done({ ago: 1, hour: 10, min: 12, desk: "market-scout", by: "chain", text: "Step 2 of 3 of a hand-off chain: collect the prices.", mins: 9,
    summary: "Collected monthly and yearly prices and trial lengths for three apps in one table (answered by gemini after 1 refusal)", bullets: ["App A: $4.99 monthly, $29.99 yearly, 7-day trial", "App B: $3.99 monthly, $24.99 yearly, no trial", "App C: $5.49 monthly, $34.99 yearly, 14-day trial"], score: [86, "Complete table with sources."] });
  chainKeys(XQ2, XQ1, 2, 3, XQ1.text);
  const XQ3 = done({ ago: 1, hour: 10, min: 30, desk: "fact-checker", by: "chain", text: "Step 3 of 3 of a hand-off chain: check the figures.", mins: 7,
    summary: "Checked 9 figures against their sources; corrected one yearly price, the rest match", bullets: ["8 of 9 figures match their sources", "App C's yearly price is $34.99, not $35.99 (fixed)", "Recommendation stands: copy the yearly plan at about ten months' price"], score: [88, "Careful and short."] });
  chainKeys(XQ3, XQ2, 3, 3, XQ1.text);
  // ---- chain C (Mobile): levels -> loader (the loader step is still running)
  const M1 = done({ ago: 4, hour: 15, desk: "level-designer", by: "mobile-lead", text: "Draft 12 new puzzle levels with difficulty notes, then hand them to the app builder.", then: ["app-builder"], step: 1, of: 2, mins: 30,
    summary: "Drafted 12 levels (4 easy, 5 medium, 3 hard) with a note on each", bullets: ["Levels 31 to 42, each with a one-line difficulty note", "Hard levels need the new 'swap' move", "No two levels share the same first move"], score: [89, "Well balanced and easy to import."], rate: "up" });
  M1.chain = M1.id;
  // ---- chain D (Support): an automatic hand-off for a refund
  const S4 = done({ ago: 16, hour: 13, mins: 10, desk: "reply-drafter", by: owner, text: "Draft a reply to a customer who was charged twice.", summary: "Handed on to support-lead: a double charge needs a human to approve the refund", bullets: ["Drafted a kind reply that says we are checking the charge", "Refunds are a human's call, so this goes to the lead"], score: [75, "Right call to hand it on."] });
  S4.chain = S4.id;
  const S4b = done({ ago: 16, hour: 13, min: 30, desk: "support-lead", by: "chain", text: "Step 2 of a chain, handed to you by reply-drafter (automatic hand-off): approve and send the double-charge reply.", summary: "Approved the refund and sent the reply", bullets: ["Refund approved for the second charge", "Reply sent, ticket closed"], score: [86, "Quick and complete."] });
  chainKeys(S4b, S4, 2, 2, S4.text, true);
  // ---- chain E (Clip studio): script -> captions
  const V1 = done({ ago: 2, hour: 9, min: 15, desk: "clip-scripter", by: "studio-lead", text: "Write a 45-second script about folding a paper crane, then hand it to the caption writer.", then: ["clip-captioner"], step: 1, of: 2, mins: 25,
    summary: "Wrote a 45-second script with a hook, six steps and a closing line", bullets: ["Hook: 'One sheet, six folds, one bird.'", "Six steps, each under ten words", "Closing line asks viewers to share their crane"], score: [90, "Tight and fun to read aloud."], rate: "up" });
  V1.chain = V1.id;
  const V2 = done({ ago: 2, hour: 9, min: 50, desk: "clip-captioner", by: "chain", text: "Step 2 of 2 of a hand-off chain: caption the paper crane script.", summary: "Made captions: 14 lines, each under 42 characters", bullets: ["14 caption lines, timed to the script", "Longest line is 39 characters"], score: [81, "Correct and readable."] });
  chainKeys(V2, V1, 2, 2, V1.text);
  // ---- more links for the Neural web (last week): an email chain, an automatic hand-off, and a recommendation put to use in another project
  const X1 = done({ ago: 2, hour: 14, mins: 25, desk: "web-copywriter", by: "website-lead", text: "Write the spring launch email, then hand it to the layout reviewer.", then: ["web-designer"], step: 1, of: 2,
    summary: "Wrote the launch email: a subject line, three short paragraphs and one button", bullets: ["Subject line under 50 characters", "Three paragraphs, one idea each", "One clear button: 'See the new plans'"], score: [83, "Warm and short."] });
  X1.chain = X1.id;
  const X2 = done({ ago: 2, hour: 15, min: 40, desk: "web-designer", by: "chain", text: "Step 2 of 2 of a hand-off chain: check the launch email layout.", summary: "Checked the email in three mail apps; the button was too small in one, now fixed", bullets: ["Button enlarged for small screens", "Images have text descriptions"], score: [78, "Good catch on the button."] });
  chainKeys(X2, X1, 2, 2, X1.text);
  const X3 = done({ ago: 4, hour: 10, mins: 8, desk: "reply-drafter", by: "support-lead", text: "Draft a reply to a customer asking about a delayed order.", summary: "Handed on to support-lead: the order is lost in the post and needs a refund or a resend", bullets: ["Drafted an apology and two options", "Needs the lead's decision on refund or resend"], score: [80, "Right call to hand it on."] });
  X3.chain = X3.id;
  const X4 = done({ ago: 4, hour: 10, min: 30, desk: "support-lead", by: "chain", text: "Step 2 of a chain, handed to you by reply-drafter (automatic hand-off): decide refund or resend.", summary: "Chose a resend with tracking and sent the reply", bullets: ["Resend with tracking", "Reply sent"], score: [85, "Quick and kind."] });
  chainKeys(X4, X3, 2, 2, X3.text, true);
  const X5 = done({ ago: 2, hour: 9, min: 10, desk: "mobile-lead", by: "chain", text: "Step 4 of a chain, lent from Research: use the pricing recommendation to update the plans screen copy.", summary: "Updated the plans screen to show the yearly plan first, with 'two months free'", bullets: ["Yearly plan shown first", "'Two months free' badge added", "Trial length shown under the price"], score: [86, "Used the recommendation well."] });
  chainKeys(X5, R3, 4, 4, R1.text);
  // ---- single jobs
  const S = (ago2, hour, desk, by, text, summary, bullets, score, extra = {}) => done({ ago: ago2, hour, desk, by, text, summary, bullets, score, ...extra });
  S(13, 11, "web-copywriter", owner, "Write three headline options for the spring sale banner.", "Wrote three headline options and a short subline for each", ["'Spring clean your inbox'", "'Fresh pages for a fresh season'", "'Three weeks to tidy up'"], [62, "The options are close to each other; little variety."]);
  S(9, 14, "website-lead", owner, "Plan the checklist for next week's site release.", "Wrote a 12-step release checklist with owners", ["12 steps from final copy check to the post-release link scan", "Each step has an owner and a time"], [79, "Practical; one step is missing a time."]);
  S(20, 10, "web-designer", "website-lead", "Review the contact page layout on phones.", "Found 4 spacing problems on small screens and wrote the fixes", ["Form labels touch the input on 360 px screens", "The map is wider than the screen", "Submit button too close to the footer", "Two links too small to tap"], [74, "Clear list; no suggested spacing values."]);
  S(17, 15, "web-checker", "website-lead", "Check every link on the blog index.", "Checked 58 links; 3 were broken and are listed with the page they are on", ["58 links checked, 3 broken", "Each broken link is listed with its page and a suggested replacement"], [93, "Exactly what was asked."], { rate: "up" });
  S(24, 11, "web-copywriter", owner, "Draft the About page.", "Drafted the About page in three short sections", ["Who we are, what we make, how to reach us", "Generic in places; no real details yet"], [55, "Too generic; reads like any company."], { rate: "down", why: "Too generic: add real details." });
  S(11, 13, "clip-scripter", "studio-lead", "Script ideas for a week of quick kitchen tips.", "Listed 7 ideas, each with a one-line hook", ["Seven ideas, one per day", "Each hook is under 12 words"], [86, "Good variety."]);
  S(15, 10, "studio-lead", owner, "Pick the posting times for next week.", "Booked noon on weekdays and 10:00 on weekends", ["Weekday slot 12:00, weekend slot 10:00", "No two clips within three hours"], [70, "Sensible; no reason given for the times."]);
  S(22, 14, "clip-captioner", "studio-lead", "Caption batch 9.", "Captioned 6 clips; two had background noise so the text is marked 'check'", ["Six clips captioned", "Clips 3 and 5 have noisy audio; captions marked 'check'"], [52, "Two clips are probably wrong; should have skipped them."], { rate: "down", why: "Noisy clips should be skipped, not captioned." });
  S(2, 16, "app-builder", "mobile-lead", "Fix the score counter that resets after a pause.", "Found the reset in the pause handler and fixed it; added a small test", ["The pause handler re-created the score object", "Fixed to keep the old one; one test added"], [95, "Root cause found and fixed with a test."], { ago: 14, rate: "up" });
  S(8, 11, "app-builder", "mobile-lead", "Add a settings screen with sound and hint toggles.", "Built the settings screen; toggles are saved between sessions", ["Two toggles and a reset button", "Saved in local storage, tested on a slow phone"], [82, "Works; the reset button has no confirm step."]);
  S(18, 9, "mobile-lead", owner, "Write the release notes for version 1.4.", "Wrote release notes: five changes, one known issue", ["Five changes in plain words", "One known issue: the hint button is slow on old phones"], [77, "Clear; could be shorter."]);
  S(25, 13, "level-designer", "mobile-lead", "Balance levels 20 to 30.", "Made levels 24 and 27 easier and cut two repeated patterns", ["Levels 24 and 27 were too hard for their position", "Two patterns repeated; replaced"], [68, "Fine, but the change list is thin."]);
  S(19, 12, "app-builder", "mobile-lead", "Ship the daily puzzle feature.", "Daily puzzle shipped behind a switch; needs one more check on slow phones", ["Daily puzzle available behind a switch", "Needs a speed check on slow phones before it is turned on"], [85, "Good, and honest about what is left."]);
  S(12, 10, "market-scout", "research-lead", "List ten blogs that review puzzle apps.", "Listed 10 blogs with audience size and the contact page", ["Ten blogs listed", "Audience sizes are rough guesses"], [58, "Audience sizes have no source."], { rate: "down" });
  S(21, 14, "research-lead", owner, "Plan a small survey for new users.", "Wrote 8 survey questions and a plan for reaching 100 people", ["Eight questions, none leading", "Plan: in-app prompt after day three"], [83, "Solid plan."]);
  S(7, 15, "paper-summarizer", "research-lead", "Summarise the accessibility guidelines for colour contrast.", "Summarised the rules into a one-page checklist", ["Text needs a 4.5 to 1 contrast ratio; large text 3 to 1", "Do not rely on colour alone"], [76, "Accurate and short."]);
  S(1, 14, "reply-drafter", "support-lead", "Draft replies for the 12 oldest open tickets.", "Drafted 12 replies; 3 are marked 'needs a human' for refunds", ["Twelve replies in a kind, short style", "Three refund tickets are flagged for the lead"], [88, "Good tone and good judgement."], { rate: "up", rateBy: "support-lead" });
  S(5, 16, "support-lead", owner, "Write the weekly support report.", "Wrote the weekly report: 143 tickets, median reply 3 h 10 min", ["143 tickets, 96 percent answered within a day", "Top topic: password resets"], [84, "Clear numbers."]);
  S(10, 11, "reply-drafter", "support-lead", "Rewrite the 'password reset' macro.", "Rewrote the macro in 4 short steps with a link to the help page", ["Four steps, each one line", "Link to the help page added"], [90, "Short and clear."]);
  S(23, 15, "support-lead", owner, "Update the triage rules for urgent tickets.", "Added three rules: outage words, payment failure, account locked", ["Three new urgent rules", "Each rule has an example ticket"], [73, "Good rules; examples are short."]);
  S(2, 11, "hub-lead", owner, "Tidy the hub settings and write down what each switch does.", "Wrote a one-page settings guide", ["Each switch described in one line", "Three switches renamed for clarity"], [81, "Useful."]);
  S(5, 10, "hr", owner, "Review the open hiring requests.", "Reviewed 2 requests: one approve, one approve with a cheaper model", ["Request 1: approve", "Request 2: approve with a cheaper model and a smaller cap"], [85, "Sensible, with reasons."]);
  const money = S(1, 9, "finance", "board", "Weekly money note for last week.", "Weekly money note: spending is on track except the Mobile app, which is over its monthly cap", ["Spending is on track for most workers", "The Mobile app's builder is over its monthly cap and has asked for more", "The copywriter and the research lead are close to theirs", "Plan use (subscriptions) is steady"], [82, "Short and true to the numbers."], { hour: 8 });
  const done2 = jobs.filter((j) => j.status === "done");
  // ---- open jobs
  const open = (o) => { const j = J(o); j.created = o.created; return j; };
  // The app builder is over its monthly cap, so its next step waits in the queue: the hub refuses to start a job past a cap
  // (src/pipeline/agents.js runJobNow). Trailer review v4: a running job on the over-cap worker read as "the cap doesn't
  // work", and the campus card showed the chain's first task while the Agents page showed this one (now both say this).
  const T1 = open({ desk: "app-builder", by: "chain", status: "queued", created: ago(36), text: "Step 2 of 2 of a hand-off chain: build the new level loader that reads packs from files." });
  chainKeys(T1, M1, 2, 2, T1.text);
  open({ desk: "market-scout", by: "research-lead", status: "taken", created: ago(14), took: ago(6), text: "Compare the free tiers of five survey tools.", summary: "The hub is running it", lastBy: "hub" });
  open({ desk: "clip-captioner", by: "studio-lead", status: "taken", created: ago(9), took: ago(3), text: "Caption batch 14.", summary: "The hub is running it", lastBy: "hub" });
  open({ desk: "website-lead", by: owner, status: "taken", created: ago(80), took: ago(70), text: "Prepare the spring launch page.", summary: "Working on it", lastBy: "website-lead" });
  open({ desk: "web-copywriter", by: "website-lead", status: "queued", created: ago(40), text: "Draft three headline options for the spring launch." });
  open({ desk: "reply-drafter", by: "support-lead", status: "queued", created: ago(55), text: "Draft replies for today's new tickets." });
  open({ desk: "paper-summarizer", by: "research-lead", status: "queued", created: ago(120), text: "Summarise the new study on puzzle game retention." });
  open({ desk: "clip-scripter", by: "studio-lead", status: "queued", created: ago(30), text: "Script: five tips for a tidy desk." });
  open({ desk: "research-lead", by: owner, status: "queued", created: ago(95), text: "Review the survey draft and cut it to eight questions." });
  const held1 = open({ desk: "market-scout", by: "research-lead", status: "queued", created: ago(70), text: "Run the weekly price check on rival apps.", held: "chain step" });
  const held2 = open({ desk: "web-checker", by: "website-lead", status: "queued", created: ago(100), text: "Re-check all links after the release.", held: "chain step" });
  const f1 = open({ desk: "clip-scripter", by: "studio-lead", status: "failed", created: ago(60 * 5), took: ago(60 * 5 - 2), ended: ago(60 * 5 - 3), text: "Write a script that makes fun of a rival brand by name.", summary: "The provider refused this request because it breaks their content rules. Reword the brief and try again.", lastBy: "hub" });
  const f2 = open({ desk: "paper-summarizer", by: "research-lead", status: "failed", created: ago(60 * 26), took: ago(60 * 26 - 2), ended: ago(60 * 26 - 7), text: "Summarise the 90-page industry report.", summary: "Stopped after 300 seconds waiting for the model. Try a shorter section.", lastBy: "hub" });

  // jobs.jsonl: creation line, then updates, ordered by time
  for (const j of jobs) {
    const created = j.created, line = { id: j.id, at: iso(created), desk: j.desk, room: roomOf(j.desk), text: j.text, by: j.by, ...(j.then ? { then: j.then } : {}), ...(j.chain && j.chain !== j.id ? { chain: j.chain, step: j.step, of: j.of, prev: j.prev, prevDesk: j.prevDesk, task: j.task, ...(j.auto ? { auto: true } : {}) } : j.then ? { chain: j.id, step: 1, of: j.then.length + 1 } : {}) };
    jobLines.push(line);
    if (j.status === "done") {
      jobLines.push({ id: j.id, at: iso(j.took), status: "taken", by: byId[j.desk].runner === "hub" ? "hub" : j.desk, summary: byId[j.desk].runner === "hub" ? "The hub is running it" : "Working on it" });
      const file = `${A}/outputs/${j.id}.md`;
      put(file, body(j.desk, j.text, j.bullets, j.follow));
      jobLines.push({ id: j.id, at: iso(j.ended), status: "done", by: byId[j.desk].runner === "hub" ? "hub" : j.desk, summary: j.summary, output: file });
      scores[j.id] = { score: j.score[0], by: "hr", at: iso(j.ended + 3600e3 * 6), why: j.score[1], model: "claude-haiku-5-5" };
      if (j.rate) ratings[j.id] = { r: j.rate, by: j.rateBy || owner, at: iso(j.ended + 3600e3 * 9), ...(j.why ? { why: j.why } : {}) };
      jobEvents.push([j.created, j.desk, { action: line.chain && j.by === "chain" ? "job handed over" : "job given", summary: oneLine(line.chain && j.by === "chain" ? `from ${j.prevDesk} (step ${j.step} of ${j.of}): ${j.task}` : `${j.by === owner ? "Sam" : j.by}: ${j.text}`).slice(0, 200), source: j.by === owner ? `${owner}-job` : j.by === "chain" ? "chain" : "manual" }]);
      jobEvents.push([j.ended, j.desk, { action: "job done", summary: j.summary, job: j.id, ...(byId[j.desk].runner === "hub" ? { provider: byId[j.desk].provider, billing: "api" } : { provider: "claude", billing: "subscription" }) }]);
      if (j.prevDesk) {
        texts.push({ at: iso(j.created), from: j.prevDesk, to: j.desk, kind: "handoff", text: oneLine(j.task || j.text).slice(0, 200), job: j.id });
        texts.push({ at: iso(j.ended), from: j.desk, to: j.prevDesk, kind: "done", text: j.summary.slice(0, 200), job: j.id });
      }
    } else if (j.status === "taken") {
      jobLines.push({ id: j.id, at: iso(j.took), status: "taken", by: j.lastBy === "hub" ? "hub" : j.lastBy, summary: j.summary });
      jobEvents.push([j.created, j.desk, { action: j.by === "chain" ? "job handed over" : "job given", summary: oneLine(j.by === "chain" ? `from ${j.prevDesk} (step ${j.step} of ${j.of}): ${j.task}` : `${j.by === owner ? "Sam" : j.by}: ${j.text}`).slice(0, 200) }]);
      if (j.prevDesk) texts.push({ at: iso(j.created), from: j.prevDesk, to: j.desk, kind: "handoff", text: oneLine(j.task).slice(0, 200), job: j.id });
    } else if (j.status === "queued") {
      jobEvents.push([j.created, j.desk, j.prevDesk ? { action: "job handed over", summary: oneLine(`from ${j.prevDesk} (step ${j.step} of ${j.of}): ${j.task}`).slice(0, 200) } : { action: "job given", summary: oneLine(`${j.by === owner ? "Sam" : j.by}: ${j.text}`).slice(0, 200) }]);
      if (j.prevDesk) texts.push({ at: iso(j.created), from: j.prevDesk, to: j.desk, kind: "handoff", text: oneLine(j.task).slice(0, 200), job: j.id });
      if (j.held) jobEvents.push([j.created + 60e3, j.desk, { action: "waiting to run", summary: `${j.held}: over today's auto-run limit; waiting for Run now`, job: j.id, source: "hub" }]);
    } else if (j.status === "failed") {
      jobLines.push({ id: j.id, at: iso(j.took), status: "taken", by: "hub", summary: "The hub is running it" });
      jobLines.push({ id: j.id, at: iso(j.ended), status: "failed", by: "hub", summary: j.summary });
      jobEvents.push([j.created, j.desk, { action: "job given", summary: oneLine(`${j.by}: ${j.text}`).slice(0, 200) }]);
      jobEvents.push([j.ended, j.desk, { action: "job failed", summary: j.summary, job: j.id }]);
    }
  }
  jobLines.sort((a, b) => a.at.localeCompare(b.at) || (a.text ? -1 : 1));
  jsonl(`${A}/jobs.jsonl`, jobLines);
  json(`${A}/scores.json`, scores);
  json(`${A}/ratings.json`, ratings);
  for (const [ms, desk, o] of jobEvents) { const d = byId[desk]; E(Math.min(ms, NOW - 1000), d, { provider: d.provider, ...o }); }
  // chain X's calls and its refusal, in the shapes the hub writes them (agents.js runJobNow): the lead's call on Gemini,
  // the scout's step declined by Claude and answered by Gemini, the fact checker on the local model (costs nothing)
  const X_REASON = "I'd rather not compare named companies' prices without sources I can check.";
  const xCall = (j, provider, model, i, o) => calls.push({ kind: "ai call", startedAt: iso(j.ended - 60e3), trigger: "app", step: `desk_${j.desk}`, provider, model, effort: "medium", inputTokens: i, outputTokens: o, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: cost(model, i, o), aiMs: 21000, xChain: true });
  xCall(XQ1, "gemini", "gemini-3.1-pro", 6200, 900);
  xCall(XQ2, "gemini", "gemini-3.1-pro", 9800, 1600);
  xCall(XQ3, "local", "local-llm", 7400, 700);
  E(XQ2.took + 40e3, byId["market-scout"], { action: "provider refused", summary: `claude (claude-sonnet-5-5) declined: ${X_REASON}`, job: XQ2.id });
  E(XQ2.took + 41e3, byId["market-scout"], { action: "passed on", summary: "claude declined; trying gemini", job: XQ2.id });
  const refusals = [{ at: iso(XQ2.took + 40e3), job: XQ2.id, desk: "market-scout", room: "research", provider: "claude", model: "claude-sonnet-5-5", reason: X_REASON, serious: false }];

  // the live moment: steps in the last few minutes, so workers are busy and the feed has fresh lines when it opens
  for (const id of ["hub-lead", "website-lead", "studio-lead", "mobile-lead", "support-lead"]) leadSession(byId[id], NOW - R.int(240, 480) * 1e3, { turns: 2, open: true });
  // (not the app builder: it is over its cap, so the hub runs nothing for it)
  for (const [id, mins] of [["web-designer", 7], ["market-scout", 5], ["clip-captioner", 4], ["web-copywriter", 11], ["reply-drafter", 9]]) workerRun(byId[id], ago(mins));

  // cost targets: scale this month's API spend per worker so a few sit near their cap, one is over and the rest are comfortable
  for (const d of desks) {
    if (sub(d) || d.provider === "local" || d.capUsdMonth == null) continue;
    const mine = calls.filter((c) => !c.xChain && deskOfStep(c.step) === d.id && Number.isFinite(c.costUsd) && Date.parse(c.startedAt) >= monthStart); // chain X's calls keep their own priced tokens
    const sum = mine.reduce((a, c) => a + c.costUsd, 0);
    if (!(sum > 0)) continue;
    const k = (d.capUsdMonth * (d.spentShare ?? Math.max(0.12, monthDone) * d.ratio)) / sum;
    for (const c of mine) { c.costUsd = Math.round(c.costUsd * k * 1e6) / 1e6; c.inputTokens = Math.round(c.inputTokens * k); c.outputTokens = Math.round(c.outputTokens * k); }
  }
  events.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  jsonl(`${A}/events.jsonl`, events);
  calls.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  // each row as the run log writes it (runlog.js end()): with its end, duration and ok, so the AI call log reads them
  // as finished calls (without ok it listed every one as failed)
  jsonl("data/logs/runs.jsonl", calls.map(({ xChain, ...c }) => ({ ...c, endedAt: iso(Date.parse(c.startedAt) + c.aiMs), ms: c.aiMs, ok: true, error: null })));
  jsonl(`${A}/refusals.jsonl`, refusals);
  // the spend ledger: the hub's AI calls (booked to the worker they ran for) and the Claude Code sessions' own use
  const spend = [
    ...calls.filter((c) => Number.isFinite(c.costUsd)).map((c) => ({ at: c.startedAt, desk: deskOfStep(c.step), room: null, model: c.model, provider: c.provider, costUsd: c.costUsd, kind: "ai call" })),
    ...events.filter((e) => Number.isFinite(e.costUsd)).map((e) => ({ at: e.startedAt, desk: e.desk, room: e.room || null, model: e.model || null, provider: e.provider || null, costUsd: e.costUsd, kind: e.kind, ...(e.billing ? { billing: e.billing } : {}) })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  jsonl("data/spend.jsonl", spend);
  json("data/credits.json", { providers: { claude: { balance: 150, at: iso(today0 - 31 * DAY) }, gemini: { balance: 40, at: iso(today0 - 31 * DAY) } }, warnBelow: 2 });

  // ---------- requests ----------
  const reqLines = [];
  const rq = (o) => { const id = R.hex(5); reqLines.push({ id, at: iso(o.at), kind: "staff", urgency: "normal", ...o, at: iso(o.at) }); return id; };
  const hrLine = (id, atMs, o) => reqLines.push({ id, at: iso(atMs), by: "hr", ...o });
  const ownerLine = (id, atMs, decision, note, by = owner) => reqLines.push({ id, at: iso(atMs), by, decision, note: note || null });
  // waiting on Sam: a hire, a loan, two spends and a store idea
  const hire = rq({ at: ago(7 * 60), room: "website", from: "website-lead", role: "Accessibility reviewer", why: "Two contrast problems got through this month. A cheap second pair of eyes before each release would catch them.", needs: "Reads a page's text and flags contrast and missing labels.", suggested: { provider: "gemini", model: "gemini-2.5-flash", effort: "low" }, budgetAsk: 5, deskId: "web-access", runner: "hub" });
  hrLine(hire, ago(6.5 * 60), { verdict: "approve-cheaper", provider: "gemini", model: "gemini-2.5-flash", effort: "low", capUsdMonth: 4, note: "A small model is plenty for checklists; a $4 cap covers about 400 page checks." });
  rq({ at: ago(6 * 60), kind: "borrow", room: "mobile", from: "mobile-lead", role: "Borrow market-scout for 4 h", why: "We need a quick look at how rival apps describe their daily puzzle.", desk: "market-scout", ownerRoom: "research", ownerLead: "research-lead", hours: 4 });
  rq({ at: ago(3 * 60), kind: "ask", room: "mobile", from: "app-builder", role: "Raise my monthly cap from $30 to $45?", why: "The level loader ran long and I am past my cap. Without more room I cannot finish the loader this month.", urgency: "high" });
  rq({ at: ago(95), kind: "ask", room: "research", from: "research-lead", role: "OK to pay $120 for a one-year licence to a market data portal?", why: "It has the yearly pricing history the recommendation needs; the free sources are out of date.", budgetAsk: 120 });
  const cactus = rq({ at: ago(50 * 60), kind: "store", room: "support", from: "reply-drafter", role: "Store idea: 🌵 a tiny cactus (desk, 9 credits)", why: "Something green for the support corner. It forgives a missed watering.", item: { label: "a tiny cactus", icon: "🌵", cat: "desk", cost: 9 } });
  hrLine(cactus, ago(49 * 60), { verdict: "approve", item: { label: "a tiny cactus", icon: "🌵", cat: "desk", cost: 9 }, note: "Fair price, family friendly." });
  // decided, for the history
  const h2 = rq({ at: at(20, 9), room: "website", from: "website-lead", role: "Link and accessibility checker", why: "Broken links keep slipping into releases.", needs: "Checks every link and flags pages a screen reader would trip on.", suggested: { provider: "openai", model: "mini-chat", effort: "low" }, budgetAsk: 6, deskId: "web-checker", runner: "hub" });
  hrLine(h2, at(20, 10), { verdict: "approve", provider: "openai", model: "mini-chat", effort: "low", capUsdMonth: 6, note: "Cheap and fast; fits a $6 cap." });
  ownerLine(h2, at(20, 12), "approved", "Go ahead.");
  const l2 = rq({ at: at(9, 9), kind: "borrow", room: "website", from: "website-lead", role: "Borrow paper-summarizer for 2 h", why: "Need the accessibility guidelines boiled down for the new checker.", desk: "paper-summarizer", ownerRoom: "research", ownerLead: "research-lead", hours: 2 });
  ownerLine(l2, at(9, 10), "approved", null, "research-lead");
  reqLines.push({ id: l2, at: iso(at(9, 12)), by: "home", returned: true });
  const a3 = rq({ at: at(12, 11), kind: "ask", room: "website", from: "website-lead", role: "Buy a stock photo pack for $29?", why: "The blog needs six clean photos and ours are out of date." });
  ownerLine(a3, at(12, 14), "approved", "OK, keep the receipt.");
  const a4 = rq({ at: at(17, 10), kind: "ask", room: "mobile", from: "mobile-lead", role: "Run the biggest model on everything for a week?", why: "To see if scores improve." });
  ownerLine(a4, at(17, 13), "declined", "Too costly; try it on one worker first.");
  const s5 = rq({ at: at(18, 9), kind: "store", room: "website", from: "web-designer", role: "Store idea: 🌿 a desk fern (desk, 12 credits)", why: "Something living on the desk.", item: { label: "a desk fern", icon: "🌿", cat: "desk", cost: 12 } });
  hrLine(s5, at(18, 10), { verdict: "approve", item: { label: "a desk fern", icon: "🌿", cat: "desk", cost: 12 }, note: "Fair." });
  ownerLine(s5, at(18, 12), "approved", null);
  reqLines.sort((a, b) => a.at.localeCompare(b.at));
  jsonl(`${A}/requests.jsonl`, reqLines);

  // ---------- texts (hand-offs above, plus two weeks of chat) ----------
  const CHAT = [
    ["web-designer", "web-copywriter", "Your new headings fit on one line now. Nice."], ["web-copywriter", "web-designer", "Thanks! I counted the letters this time."],
    ["clip-scripter", "clip-captioner", "Script 14 is ready. Please be kind to the long sentences."], ["clip-captioner", "clip-scripter", "I broke them into two lines. Looks good."],
    ["app-builder", "level-designer", "Level 36 loads in half the time now."], ["level-designer", "app-builder", "Great. I will make the next pack bigger."],
    ["market-scout", "research-lead", "Found a fourth app with a yearly plan. Adding it."], ["research-lead", "market-scout", "Please note where each price came from."],
    ["reply-drafter", "support-lead", "Three refund tickets are waiting for you."], ["support-lead", "reply-drafter", "On it. Thanks for sorting them."],
    ["web-checker", "website-lead", "Two broken links on the blog. Fixed and listed."], ["website-lead", "web-checker", "Thank you. Please re-check after the release."],
    ["finance", "app-builder", "Heads up: you are over your monthly cap."], ["app-builder", "finance", "I know. I have asked Sam for more room."],
    ["hr", "website-lead", "Your request for a reviewer looks good. Waiting for Sam."], ["paper-summarizer", "research-lead", "Two articles done. One has a number worth quoting."],
    ["mobile-lead", "app-builder", "Great work on the score fix."], ["studio-lead", "clip-scripter", "Keep the hooks under twelve words."],
    ["hub-lead", "hr", "Can you score the week's jobs before Friday?"], ["hr", "hub-lead", "Already done. Two were below 60."],
  ];
  CHAT.forEach(([f, t, text], i) => texts.push({ at: iso(at(14 - Math.floor(i * 0.7), R.int(9, 17), R.int(0, 59))), from: f, to: t, kind: "chat", text }));
  [["website-lead", "mobile-lead", "Could we share the icon set for the launch page?"], ["mobile-lead", "website-lead", "Yes. I will drop it in the shared folder."], ["research-lead", "mobile-lead", "The pricing recommendation is ready for your plans screen."],
    ["studio-lead", "website-lead", "The paper crane clip is ready to embed on the blog."], ["support-lead", "website-lead", "Customers keep asking about team seats. Can the FAQ cover it?"], ["hub-lead", "research-lead", "The weekly backup finished. All good."],
    ["finance", "research-lead", "You are close to your cap; the portal licence would push past it."], ["hr", "support-lead", "The cactus request is with Sam."]]
    .forEach(([f, t, text], i) => texts.push({ at: iso(at(5 - Math.floor(i / 2), R.int(9, 16), R.int(0, 59))), from: f, to: t, kind: "note", text }));
  texts.sort((a, b) => a.at.localeCompare(b.at));
  jsonl(`${A}/texts.jsonl`, texts);

  // ---------- stand-ups: two a day on weekdays for the last week ----------
  const meetings = [];
  let since = iso(today0 - 9 * DAY);
  for (let a = 7; a >= 0; a--) for (const [slot, h] of [["morning", 9], ["afternoon", 15]]) {
    const ms = at(a, h, 0);
    if (ms > NOW - 3600e3 || [0, 6].includes(dow(a))) continue;
    const projects = ROOMS.filter((r) => !["hr", "newsletter"].includes(r.id)).map((r) => {
      const lead = desks.find((d) => d.room === r.id && d.lead);
      const mine = events.filter((e) => e.room === r.id && e.startedAt > since && e.startedAt <= iso(ms));
      const api = calls.filter((c) => roomOf(deskOfStep(c.step)) === r.id && c.startedAt > since && c.startedAt <= iso(ms)).reduce((x, c) => x + (c.costUsd || 0), 0), subs = mine.filter((e) => e.billing === "subscription").reduce((x, e) => x + (e.costUsd || 0), 0);
      const latest = [...mine].reverse().find((e) => e.summary && e.action !== "turn done");
      return { room: r.id, name: r.name, lead: lead?.id || null, leadProvider: lead?.provider || null, reports: mine.length, sessions: mine.filter((e) => e.action === "session start").length,
        jobsDone: jobLines.filter((l) => l.status === "done" && roomOf(jobs.find((j) => j.id === l.id)?.desk) === r.id && l.at > since && l.at <= iso(ms)).length, jobsOpen: r.id === "mobile" ? 2 : 1, waiting: r.id === "mobile" ? 2 : 0,
        api: Math.round(api * 100) / 100, sub: Math.round(subs * 100) / 100, latest: latest ? `${latest.desk}: ${latest.summary}`.slice(0, 160) : null, blocked: r.id === "mobile" ? ["2 waiting on Sam", "a desk is over its cap"] : [] };
    });
    meetings.push({ id: R.hex(5), at: iso(ms), slot, day: iso(ms).slice(0, 10), trigger: "schedule", since, projects, board: { decided: [], budget: { total: 134.5, limit: 20.18, spent: 0 }, waitingOnOwner: 3 }, chair: "Sam" });
    since = iso(ms);
  }
  jsonl(`${A}/meetings.jsonl`, meetings);

  // ---------- alert rules and one fired alert ----------
  const rule = (o) => ({ id: R.hex(5), cooldownHours: 6, enabled: true, createdAt: iso(today0 - 12 * DAY), ...o });
  const rCap = rule({ type: "desk_cap_pct", name: "Mobile builder at 100% of its cap", desk: "app-builder", pct: 100 });
  const builderSpent = calls.filter((c) => deskOfStep(c.step) === "app-builder" && Date.parse(c.startedAt) >= monthStart).reduce((a, c) => a + c.costUsd, 0);
  const rules = [rCap, rule({ type: "day_spend", name: "Research lead over $3 in a day", desk: "research-lead", usd: 3 }), rule({ type: "desk_projected", name: "Copywriter heading over its cap", desk: "web-copywriter" }), rule({ type: "job_failed_twice", name: "Two failures in a row" }), rule({ type: "month_projected", name: "Month heading past the budget" })];
  json(`${A}/alert-rules.json`, { rules });
  json(`${A}/alert-log.json`, { last: { [rCap.id]: iso(ago(4 * 60)) }, log: [{ at: iso(ago(4 * 60)), rule: rCap.id, type: "desk_cap_pct", title: rCap.name, text: `app-builder has spent $${builderSpent.toFixed(2)} this month, ${Math.round((builderSpent / 30) * 100)}% of its $30.00 cap` }] });
  events.push({ kind: "agent event", startedAt: iso(ago(4 * 60)), trigger: "agent", source: "alerts", desk: "hub", room: "hub", action: "alert fired", summary: `${rCap.name}: app-builder has used its monthly cap` });
  events.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  jsonl(`${A}/events.jsonl`, events);

  // ---------- store, pets, plants, wallets, personalities ----------
  json(`${A}/store-items.json`, {
    deskfern: { label: "a desk fern", icon: "🌿", cat: "desk", cost: 12, likes: ["zen"], by: "web-designer", at: iso(at(18, 12)) },
    readingnook: { label: "a reading nook", icon: "📚", cat: "home", cost: 24, likes: ["meticulous"], by: "paper-summarizer", at: iso(at(24, 12)) },
  });
  const buy = (desk, item, costCr, ms, deliver = true) => ({ at: iso(ms), desk, item, cost: costCr, ...(deliver ? { deliverAt: iso(ms + 15 * 60e3) } : {}) });
  const wallet = [
    buy("web-designer", "deskfern", 12, at(17, 9)), buy("web-copywriter", "plant", 12, at(21, 10)), buy("web-copywriter", "mug", 3, at(12, 11)), buy("support-lead", "bonsai", 16, at(15, 9)),
    buy("reply-drafter", "goldfish", 7, at(13, 14)), buy("market-scout", "hamster", 12, at(11, 15)), buy("app-builder", "headphones", 15, at(10, 10)), buy("clip-scripter", "rug", 6, at(20, 16)),
    buy("research-lead", "lamp", 10, at(23, 10)), buy("website-lead", "chair", 25, at(8, 12)), buy("studio-lead", "lavalamp", 12, at(7, 13)), buy("paper-summarizer", "readingnook", 24, at(6, 9)),
    buy("mobile-lead", "plant", 12, at(9, 9)), buy("clip-captioner", "duck", 4, at(5, 12)), buy("hub-lead", "monitor2", 35, at(4, 14)),
  ].sort((a, b) => a.at.localeCompare(b.at));
  jsonl(`${A}/wallet.jsonl`, wallet);
  const care = [{ kind: "start", at: iso(today0 - 26 * DAY) }];
  for (let a = 16; a >= 0; a--) {
    for (const [desk, item] of [["web-designer", "deskfern"], ["web-copywriter", "plant"], ["support-lead", "bonsai"], ["mobile-lead", "plant"]]) if (!(item === "plant" && desk === "mobile-lead" && a < 2) && R.chance(0.8)) care.push({ at: iso(at(a, 17, R.int(0, 40))), desk, item, kind: "water", by: desk });
    for (const [desk, item] of [["reply-drafter", "goldfish"], ["market-scout", "hamster"]]) if (a < 12 && !(item === "goldfish" && a < 1) && R.chance(0.85)) care.push({ at: iso(at(a, 18, R.int(0, 40))), desk, item, kind: "feed", by: desk });
  }
  care.sort((a, b) => a.at.localeCompare(b.at));
  jsonl(`${A}/care.jsonl`, care);
  json(`${A}/selves.json`, {
    "web-copywriter": { about: "A careful wordsmith who counts letters before breakfast. Likes short sentences and hates exclamation marks.", into: ["headlines", "plain words", "tea"], friends: [{ desk: "web-designer", note: "keeps a running bet on line breaks" }], quirks: ["rereads every heading twice"], updatedAt: iso(ago(60 * 20)), history: [{ at: iso(today0 - 6 * DAY), changed: "first written" }, { at: iso(ago(60 * 20)), changed: "got into tea after the pricing page" }], from: "meticulous" },
    "app-builder": { about: "A quick builder who tests everything twice. A little embarrassed about being over budget.", into: ["tiny tests", "loading speed"], friends: [{ desk: "level-designer", note: "trades levels for bug reports" }], quirks: ["names bugs after weather"], updatedAt: iso(ago(60 * 8)), history: [{ at: iso(today0 - 5 * DAY), changed: "first written" }], from: "scrappy" },
    "research-lead": { about: "Calm and curious. Asks for the source before the answer.", into: ["pricing history", "surveys"], friends: [{ desk: "market-scout", note: "always asks where a number came from" }], quirks: ["keeps a list of questions nobody asked"], updatedAt: iso(ago(60 * 30)), history: [{ at: iso(today0 - 9 * DAY), changed: "first written" }], from: "zen" },
    "reply-drafter": { about: "Warm and fast. Remembers every customer's name and signs off with a small joke.", into: ["kind wording", "cacti"], friends: [{ desk: "support-lead", note: "shares the refund pile" }], quirks: ["wants a cactus"], updatedAt: iso(ago(60 * 12)), history: [{ at: iso(today0 - 3 * DAY), changed: "asked the store for a cactus" }], from: "chatty" },
    "clip-scripter": { about: "A dramatic hook writer who keeps every script under forty-five seconds.", into: ["hooks", "paper birds"], friends: [{ desk: "clip-captioner", note: "argues about line breaks" }], quirks: ["reads scripts out loud to the plants"], updatedAt: iso(ago(60 * 40)), history: [{ at: iso(today0 - 7 * DAY), changed: "first written" }], from: "dramatic" },
  });
  jsonl(`${A}/life.jsonl`, [{ at: iso(ago(60 * 20)), desk: "web-copywriter", kind: "work", text: "finished a job: Rewrote the pricing page copy" }, { at: iso(ago(60 * 12)), desk: "reply-drafter", kind: "chat", text: "texted support-lead: Three refund tickets are waiting for you." }]);

  // small state files the pages look for
  put(`${A}/token.txt`, crypto.randomBytes(24).toString("hex") + "\n");
  put(`${A}/hook-last-ok.txt`, `${iso(ago(3))} PostToolUse\n`);

  // ---------- the Clip studio's queue board: one generic channel, jobs in every state ----------
  const slot = (daysAhead, hh) => iso(today0 + daysAhead * DAY + hh * 3600e3);
  const nextNoon = (n) => slot(NOW > today0 + 12 * 3600e3 ? n + 1 : n, 12);
  const pjob = (name, title, status, extra = {}) => {
    const id = `clips-${new Date(NOW - R.int(2, 40) * 3600e3).toISOString().replace(/[-:T]/g, "").slice(0, 14)}-${R.hex(2)}`;
    const created = iso(NOW - R.int(2, 40) * 3600e3);
    json(`data/jobs/${id}/job.json`, { id, channel: "clips", sourceName: name, status, stage: extra.stage || null, createdAt: created, updatedAt: created, hold: extra.hold || null, flags: [], data: { title, meta_out: { title }, ...(extra.publishAt ? { publishAt: extra.publishAt } : {}) }, log: [], ...(extra.error ? { error: extra.error } : {}) });
  };
  pjob("tidy-desk-tips.mp4", "Five tips for a tidy desk", "held", { stage: "review", hold: { reason: "The title is over 60 characters. Pick a shorter one, then it goes on." , fields: [{ key: "title", label: "Title" }] } });
  pjob("paper-crane.mp4", "How to fold a paper crane in 45 seconds", "private", { stage: "upload" });
  pjob("kitchen-tip-7.mp4", "Kitchen tip: slice an onion without tears", "failed", { stage: "captions", error: { message: "The caption step ran out of time. Retry it, or start over." } });
  pjob("kitchen-tip-8.mp4", "Kitchen tip: keep herbs fresh for a week", "running", { stage: "captions" });
  pjob("plant-care.mp4", "Plant care in one minute", "publishing", { stage: "upload", publishAt: iso(NOW + 25 * 60e3) });
  pjob("pack-light.mp4", "Pack a carry-on in ten minutes", "queued");
  pjob("budget-lunch.mp4", "A lunch under five dollars", "queued");
  pjob("paper-boat.mp4", "A paper boat that really floats", "scheduled", { stage: "done", publishAt: nextNoon(0) });
  pjob("shelf-fix.mp4", "Fix a wobbly shelf", "scheduled", { stage: "done", publishAt: nextNoon(1) });
  pjob("quick-stretch.mp4", "A two-minute desk stretch", "scheduled", { stage: "done", publishAt: nextNoon(2) });

  return { root, files: written.size, desks: desks.length, rooms: ROOMS.length, events: events.length, jobs: jobs.length + 10, requests: reqLines.filter((l) => l.role).length, spendRows: spend.length, aiCalls: calls.length, scores: Object.keys(scores).length, ratings: Object.keys(ratings).length };
}

// ---------- start the hub on the demo folder ----------
// Only this PC may be reached: any connection to another address is refused, so a stray feature can't send anything out.
function blockOutbound() {
  const ok = (h) => !h || ["localhost", "127.0.0.1", "::1", "0.0.0.0", "::"].includes(String(h).replace(/^\[|\]$/g, ""));
  const real = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const a = args[0];
    const host = a && typeof a === "object" ? (a.path ? null : a.host) : typeof a === "number" ? (typeof args[1] === "string" ? args[1] : null) : null;
    if (!ok(host)) { process.nextTick(() => this.destroy(new Error(`Demo mode sends nothing out (blocked: ${host}).`))); return this; }
    return real.apply(this, args);
  };
}

export async function startDemo({ dir, port = DEMO_PORT, live = true, play = true } = {}) {
  const info = seedDemo({ target: dir });
  const root = info.root;
  // the keys and the dashboard password never reach the demo, whatever this PC's .env says
  for (const k of Object.keys(process.env)) if (/(_KEY|_TOKEN|_SECRET|PASSWORD|TOTP|NTFY|DASHBOARD_)/i.test(k) && !/^HUB_/.test(k)) delete process.env[k];
  Object.assign(process.env, {
    HUB_DEMO: "1", HUB_TEST_ROOT: root, HUB_TEST_SETTINGS: path.join(root, "demo-settings.json"), DOTENV_CONFIG_PATH: path.join(root, "no-env"), PORT: String(port),
    HUB_LISTEN: "local", PIPELINE_DISABLED: "1", AGENTS_CHATTER: "off", AGENTS_SELVES: "off", AGENTS_LOCAL_RUNNER: "off", HUB_AUTORUN_PER_DAY: "6",
  });
  blockOutbound();
  await import(pathToFileURL(path.join(APP, "server.js")).href);
  if (live) startLive();
  if (play) startPlay(root);
  console.log(`\nDemo hub: http://localhost:${port}   (sample data, nothing leaves this computer; Ctrl+C to stop)\nThe sample folder is ${root} and is rebuilt on every run.\n`);
  return info;
}

// Plays a hand-off chain you give in the demo (trailer v6: cross-model work). Nothing runs in demo mode, so a job given
// with "then" (the campus's Give a job, "Then hand it to") would only wait in the queue. Here the demo plays each step
// the way a hub run writes it (src/pipeline/agents.js runJobNow), through the hub's own functions: the step is taken,
// its call goes into the run log and the spend ledger priced by the hub's price list (logAiCall, costOf), and
// updateJob(done) saves the result and hands the job on through the hub's own handOn, which queues the next step. The
// first Claude step after the first one is declined once by Claude and passed on to Gemini, written as the hub writes a
// refusal pass-off (refusals.jsonl, "provider refused", "passed on", "answered by gemini after 1 refusal"). Every result
// says it is sample text. --no-play turns it off. HUB_DEMO_PLAY_MS sets the time per step (default 4000).
const PLAY_TOKENS = { "research-lead": [6200, 900], "market-scout": [9800, 1600], "fact-checker": [7400, 700] };
const PLAY_SAYS = {
  "research-lead": ["Split the question: the market scout collects the prices, the fact checker checks every figure", ["Three apps to compare: the two biggest rivals and the newest one", "Collect monthly and yearly price and trial length for each", "Check every figure against its source before we copy anything"]],
  "market-scout": ["Collected monthly and yearly prices and trial lengths for three apps in one table", ["App A: $4.99 monthly, $29.99 yearly, 7-day trial", "App B: $3.99 monthly, $24.99 yearly, no trial", "App C: $5.49 monthly, $34.99 yearly, 14-day trial"]],
  "fact-checker": ["Checked 9 figures against their sources; corrected one yearly price, the rest match", ["8 of 9 figures match their sources", "App C's yearly price is $34.99, not $35.99 (fixed)", "Recommendation: a yearly plan at about ten months' price"]],
};
async function startPlay(root) {
  const A = await import(pathToFileURL(path.join(APP, "src", "pipeline", "agents.js")).href);
  const { logAiCall } = await import(pathToFileURL(path.join(APP, "src", "pipeline", "claude.js")).href);
  const { costOf } = await import(pathToFileURL(path.join(APP, "src", "pipeline", "ai.js")).href);
  const pace = Number(process.env.HUB_DEMO_PLAY_MS) || 4000;
  const since = Date.now(), chains = new Set(), playing = new Set();
  let refused = false;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const play = async (j) => {
    const d = DESKS.find((x) => x.id === j.desk);
    if (!d || d.runner !== "hub") return;
    await wait(pace * 0.35);
    A.updateJob(j.id, { status: "taken", summary: "The hub is running it" }, "hub");
    await wait(pace * 0.65);
    let provider = d.provider, model = d.model, note = "";
    if (!refused && d.provider === "claude" && (j.step || 1) > 1) {
      refused = true;
      const reason = "I'd rather not compare named companies' prices without sources I can check.";
      // the declined call is a failed row in the run log, as the hub writes it (claude.js: an error row, no cost)
      logAiCall({ trigger: "app", step: `desk_${d.id}`, provider: "claude", model: d.model, effort: d.effort || "medium" }, { error: `Claude declined the desk_${d.id} step.` });
      fs.appendFileSync(path.join(root, "data", "agents", "refusals.jsonl"), JSON.stringify({ at: new Date().toISOString(), job: j.id, desk: d.id, room: d.room, provider: "claude", model: d.model, reason, serious: false }) + "\n");
      A.recordEvent({ desk: d.id, room: d.room, action: "provider refused", summary: `claude (${d.model}) declined: ${reason}`, job: j.id }, "hub");
      await wait(pace * 0.3);
      A.recordEvent({ desk: d.id, room: d.room, action: "passed on", summary: "claude declined; trying gemini", job: j.id }, "hub");
      await wait(pace * 0.5);
      provider = "gemini"; model = "gemini-3.1-pro"; note = " (answered by gemini after 1 refusal)";
    }
    const [i, o] = PLAY_TOKENS[d.id] || [5000, 800];
    logAiCall({ trigger: "app", step: `desk_${d.id}`, provider, model, effort: d.effort || "medium" }, { inputTokens: i, outputTokens: o, costUsd: provider === "local" ? 0 : costOf(model, { inputTokens: i, outputTokens: o }) });
    const [summary, bullets] = PLAY_SAYS[d.id] || [`Did step ${j.step || 1}: ${String(j.task || j.text).split("\n")[0].slice(0, 100)}`, ["Sample result"]];
    A.updateJob(j.id, { status: "done", summary: summary + note, result: `${bullets.map((b) => `- ${b}`).join("\n")}\n\n_Demo data: sample text. The demo plays this step; no AI was called._` }, "hub");
  };
  const tick = () => {
    try {
      for (const j of A.jobs()) {
        if (j.status !== "queued" || playing.has(j.id)) continue;
        const mine = j.chain && chains.has(j.chain);
        const fresh = !j.chain || j.chain === j.id ? j.then?.length && j.by !== "chain" && Date.parse(j.at) >= since : false;
        if (!mine && !fresh) continue;
        if (fresh) chains.add(j.chain || j.id);
        playing.add(j.id);
        play(j).catch((err) => console.warn(`Demo play ${j.id}: ${err.message}`));
      }
    } catch (err) { console.warn(`Demo play: ${err.message}`); }
    setTimeout(tick, 700).unref();
  };
  setTimeout(tick, 700).unref();
}

// A few small steps every few seconds, so workers keep walking and the feed keeps moving.
async function startLive() {
  const A = await import(pathToFileURL(path.join(APP, "src", "pipeline", "agents.js")).href);
  // --live-seed N (the trailer capture uses it): the same steps in the same order on every run
  const R = rng(Number(process.env.HUB_DEMO_LIVE_SEED) || (Date.now() & 0xffff));
  // one small step from each active worker in turn, so every one of them stays in the newest lines of the feed (the campus
  // reads the last 50 to tell who is working) and none looks stuck
  // (a worker past its cap is left out: the hub would refuse to run it, so it must not look busy)
  const crew = DESKS.filter((d) => d.status === "active" && (d.bill === "subscription" || d.runner === "hub") && !(d.spentShare > 1));
  const sessions = {};
  let turn = 0;
  const step = () => {
    try {
      const d = crew[turn++ % crew.length], w = WORK[d.room] || WORK.hub;
      if (d.bill === "subscription") {
        const sid = (sessions[d.id] ??= R.hex(8)), tool = R.pick(TOOLS), base = { desk: d.id, room: d.room, provider: "claude", billing: "subscription", session: sid, model: "claude-opus-5-5" };
        if (R.chance(0.15)) A.recordEvent({ ...base, action: "turn done", summary: `${R.int(2, 6)} model replies`, inputTokens: R.int(8000, 30000), outputTokens: R.int(800, 3000) }, "claude-code");
        else A.recordEvent({ ...base, action: "tool", tool, summary: ["WebSearch", "Bash", "Grep", "Glob"].includes(tool) ? null : R.pick(w.files), ...(tool === "Edit" ? { note: R.pick(NOTES) } : {}) }, "claude-code");
      } else A.recordEvent({ desk: d.id, room: d.room, action: "worker run", summary: R.pick(w.says), provider: d.provider, model: d.model, billing: "api" }, "hub");
    } catch (err) { console.warn(`Demo step: ${err.message}`); }
    setTimeout(step, R.int(1, 3) * 1000).unref();
  };
  setTimeout(step, 3000).unref();
}

// ---------- command line ----------
const here = import.meta.url === pathToFileURL(process.argv[1] || "").href;
if (here) {
  const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : dflt; };
  const dir = path.resolve(arg("dir", "demo-data"));
  const port = Number(arg("port", DEMO_PORT)) || DEMO_PORT;
  if (arg("live-seed")) process.env.HUB_DEMO_LIVE_SEED = String(Number(arg("live-seed")) || 1);
  try {
    if (process.argv.includes("--seed-only")) {
      const i = seedDemo({ target: dir });
      console.log(`Wrote the sample hub to ${i.root}: ${i.rooms} projects, ${i.desks} workers, ${i.events} steps, ${i.jobs} jobs, ${i.requests} requests.`);
    } else await startDemo({ dir, port, live: !process.argv.includes("--no-live"), play: !process.argv.includes("--no-play") });
  } catch (err) {
    console.error(`Demo mode: ${err.message}`);
    process.exit(1);
  }
}
