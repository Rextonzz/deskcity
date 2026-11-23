// Agent dashboard routes (src/pipeline/agents.js, docs/agent-dashboard-scope.md).
// agentIngestRoutes: for hooks and agents on this PC, Tailscale or the home network. They have no sign-in, so they
// send the key in data/agents/token.txt as "Authorization: Bearer <key>". Mounted before the login check.
// agentsRouter: the page's own calls, behind the normal sign-in.
import { Router } from "express";
import {
  setRoomWeek,
  afterMeeting,
  weekStatus,
  setDeskGrants,
  removeAllowedCommand,
  createProject,
  deskLive,
  jobTrace,
  agentWeb,
  agentsOverview,
  addRequest,
  recordEvent,
  decideRequest,
  decideSpends,
  jobSpends,
  findJob,
  importHubLog,
  inbox,
  roster,
  saveDesk,
  deskChangeSpends,
  setDeskCap,
  setDeskStatus,
  deskResumeSpends,
  setRoom,
  tokenMatches,
  ingestToken,
  addJob,
  updateJob,
  openJobs,
  runJob,
  jobOutput,
  mapFolder,
  holdStandup,
  standupFor,
  autoHandOff,
  runLocalJobs,
  meetings,
  grantAutonomy,
  plannedHours,
  jobApproval,
  sessionApprovalFor,
  stopAutonomy,
  giftPerk,
  askLoan,
  answerLoan,
  returnLoan,
  addBlocker,
  closeBlocker,
  checkBlockers,
  realignDesk,
  setRoomDistrict,
  askAboutRequest,
  setDeskChat,
  watchShort,
  suggestStoreItem,
  rateJob,
  voteRequest,
  boardMembers,
  slug,
  trustedSources,
  retryJob,
  dismissJob,
  pushJob,
  setDeskFolder,
  addOwnerItem,
  SOURCES,
  PERKS,
  forecastNow,
  planNow,
  savePlanMeter,
  savePlanBudget,
  qualityView,
  briefVersions,
  sampleSet,
  qualityRuns,
  estimateRun,
  startRun,
  applyRun,
  rollBack,
  fundView,
  proposeSpend,
  voteSpend,
  buyQuota,
  districtsView,
  proposeDistrict,
  decideDistrict,
  casinoView,
} from "../pipeline/agents.js";
import { alertsView, removeRule, saveRule } from "../pipeline/alerts.js";
import { spansToEvents, MAX_SPANS, MAX_BODY_BYTES } from "../pipeline/otel.js";
import { logSecurity, requirePasswordConfirmed } from "../security.js";
import { safe } from "./handle.js";
import { servicesStatus } from "../pipeline/services.js";
import { ownerName as OWNER, ownerId } from "../hub/settings.js";
import { PARTS } from "../hub/extras.js";
import { cityNow } from "../pipeline/city.js";

// Ask for the dashboard password only when test(req) says the call would spend, run a command or write GitHub.
const pw = (test) => (req, res, next) => (test(req) ? requirePasswordConfirmed(req, res, next) : next());

// Posts carrying a cost: per desk and for the key in all, a minute (S1). Exported for the tests.
export const COST_POSTS_PER_DESK = 30, COST_POSTS_PER_KEY = 120;
// Button presses that call an AI (F3): at most this many an hour per route, with or without a dashboard password.
const hourHits = new Map();
const perHour = (key, max) => (req, res, next) => {
  const now = Date.now(), list = (hourHits.get(key) || []).filter((t) => now - t < 3600e3);
  if (list.length >= max) { logSecurity(req, `rate cap hit: ${key}`); return res.status(429).json({ error: `That's the limit of ${max} ${key} an hour. Try again later.` }); }
  list.push(now); hourHits.set(key, list); next();
};
// At most 600 posts a minute from agents, so a hook stuck in a loop can't fill the run log.
let windowStart = Date.now();
let count = 0;
function underLimit() {
  if (Date.now() - windowStart > 60000) {
    windowStart = Date.now();
    count = 0;
  }
  return ++count <= 600;
}

export function agentIngestRoutes(app) {
  ingestToken(); // make the key at start, so hooks can read it before the first post
  const guard = (req, res, next) => {
    if (!tokenMatches(req.headers.authorization)) {
      logSecurity(req, "agent post with a wrong or missing key");
      return res.status(401).json({ error: "Wrong or missing agent key." });
    }
    if (!underLimit()) return res.status(429).json({ error: "Too many agent posts this minute." });
    next();
  };
  // Per-route caps (security plan 07): one looping hook can't use up the whole 600 a minute. Events keep only the
  // global limit, because hooks post often.
  const perMin = new Map();
  // Keys can come from a request (a desk name), so drop the ones with nothing in the last minute.
  const prunePerMin = () => {
    if (perMin.size < 200) return;
    const now = Date.now();
    for (const [k, list] of perMin) if (!list.some((t) => now - t < 60000)) perMin.delete(k);
  };
  const cap = (key, max) => (req, res, next) => {
    prunePerMin();
    const now = Date.now(), list = (perMin.get(key) || []).filter((t) => now - t < 60000);
    if (list.length >= max) return res.status(429).json({ error: `Too many ${key} posts this minute.` });
    list.push(now); perMin.set(key, list); next();
  };
  // A smaller body than the 2 MB the parser allows, for routes that only carry a few lines.
  // A chunked post has no Content-Length, so the parsed body is measured too.
  const size = (max) => (req, res, next) => {
    const declared = Number(req.headers["content-length"] || 0);
    const actual = req.headers["content-length"] === undefined && req.body && typeof req.body === "object" ? Buffer.byteLength(JSON.stringify(req.body)) : 0;
    return Math.max(declared, actual) > max ? res.status(413).json({ error: `Send under ${Math.round(max / 1024)} KB per post.` }) : next();
  };
  const small = size(64 * 1024);
  // source: who posted it, e.g. "claude-code", "gemini", "hr". Kept short. A post can't name one of the hub's own
  // sources, which are the ones whose costs aren't clipped (recordEvent).
  // Posts that carry a cost (money safety S1, 2026-11-16): at most 30 a minute for one desk and 120 a minute for the
  // agent key in all, so a leaked key can't pour in made-up spend (recordEvent also has a daily ceiling per desk).
  const costPosts = (req, res, next) => {
    const b = req.body || {};
    if (b.costUsd == null && !b.inputTokens && !b.outputTokens) return next();
    prunePerMin();
    const now = Date.now(), desk = String(b.desk || "unassigned").toLowerCase().slice(0, 64);
    for (const [key, max, what] of [[`cost:desk:${desk}`, COST_POSTS_PER_DESK, `cost posts for ${desk}`], ["cost:key", COST_POSTS_PER_KEY, "cost posts"]]) {
      const list = (perMin.get(key) || []).filter((t) => now - t < 60000);
      if (list.length >= max) { logSecurity(req, `rate cap hit: ${what}`); return res.status(429).json({ error: `Too many ${what} this minute.` }); }
      perMin.set(key, list);
    }
    for (const key of [`cost:desk:${desk}`, "cost:key"]) perMin.get(key).push(now);
    next();
  };
  app.post("/api/agents/ingest/event", small, guard, costPosts, safe((req) => recordEvent(req.body || {}, trustedSources().includes(req.body?.source) ? "agent" : req.body?.source || "agent")));
  // An agent can't file a request as the owner.
  // Cleaned the same way addRequest cleans it before the check, so the owner's id plus a hidden character can't slip through.
  const sender = (b) => {
    const name = String(b?.from || b?.source || "agent").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2060\ufeff]/g, "").trim();
    return name.toLowerCase() === ownerId().toLowerCase() || !name ? "agent" : name;
  };
  app.post("/api/agents/ingest/request", small, guard, cap("request", 10), safe((req) => addRequest(req.body || {}, sender(req.body))));
  // Any other need a lead wants the owner to decide (skips HR).
  app.post("/api/agents/ingest/ask", small, guard, cap("ask", 10), safe((req) => addRequest({ ...(req.body || {}), kind: "ask" }, sender(req.body))));
  // A lead reads its answers. POST so the key stays out of URLs and logs.
  app.post("/api/agents/ingest/inbox", small, guard, safe((req) => inbox({ desk: req.body?.desk, room: req.body?.room, limit: req.body?.limit })));
  // Jobs the owner gave a desk: list the open ones, and take / finish / fail one (agent-log.mjs jobs | take | done | fail).
  app.post("/api/agents/ingest/jobs", small, guard, safe((req) => openJobs({ desk: req.body?.desk, room: req.body?.room })));
  // The latest lead stand-up, for a lead's new session (null for desks that aren't leads).
  app.post("/api/agents/ingest/standup", small, guard, safe((req) => standupFor(String(req.body?.desk || ""))));
  // A session on the PC (Claude Code, Antigravity, a script) hands its work on to another desk.
  app.post("/api/agents/ingest/desks", small, guard, safe(() => roster().desks.filter((d) => d.status === "active").map(({ id, room, provider, runner, role }) => ({ id, room, provider, runner: runner || null, role: String(role || "").slice(0, 80) }))));
  // Lending workers between projects: a lead asks, the lending lead answers.
  app.post("/api/agents/ingest/borrow", small, guard, cap("borrow", 5), safe((req) => askLoan(req.body || {}, sender(req.body))));
  app.post("/api/agents/ingest/lend", small, guard, cap("lend", 20), safe((req) => answerLoan({ desk: req.body?.desk, request: req.body?.request, decision: req.body?.decision, note: req.body?.note })));
  // Blocker watches: a lead registers what's blocking it and what would clear it.
  // A project lead rates one of its project's finished jobs (agent-log.mjs rate).
  app.post("/api/agents/ingest/rate", small, guard, cap("rate", 30), safe((req) => rateJob(req.body?.job, req.body?.rating, { by: req.body?.desk || sender(req.body), why: req.body?.why })));
  // A board member (the project's lead) backs or objects to a request the board could approve.
  app.post("/api/agents/ingest/vote", small, guard, cap("vote", 20), safe((req) => {
    // HR and the finance desk vote inside the hub (board.js), never by post: still trusts which lead posts (per-desk keys would fix that).
    const desk = req.body?.desk || sender(req.body);
    if (boardMembers({ room: "" }).includes(slug(desk))) throw new Error("That desk votes inside the hub, not by post.");
    return voteRequest({ request: req.body?.request, desk, vote: req.body?.vote, why: req.body?.why });
  }));
  // A project lead votes on spending from the city fund (cityfund.js); the finance desk votes inside the hub.
  app.post("/api/agents/ingest/fund-vote", small, guard, cap("fund-vote", 20), safe((req) => {
    const desk = req.body?.desk || sender(req.body);
    // never as the owner (review H1): the owner votes on the dashboard; HR and finance vote inside the hub
    if (slug(desk) === slug(ownerId())) throw new Error("The owner votes from the dashboard, not by post.");
    if (boardMembers({ room: "" }).includes(slug(desk))) throw new Error("That desk votes inside the hub, not by post.");
    return voteSpend({ id: req.body?.id, desk, vote: req.body?.vote, why: req.body?.why });
  }));
  // No agents' post route for player districts yet (review M2, 2026-11-20): it would trust the desk name in the body,
  // so a session with the shared key could spend another worker's credits. Add one with per-desk keys.
  app.post("/api/agents/ingest/blocker", small, guard, cap("blocker", 5), safe((req) => addBlocker(req.body || {})));
  app.post("/api/agents/ingest/handoff", guard, cap("handoff", 20), safe((req) => autoHandOff({ from: req.body?.desk, job: req.body?.job, to: req.body?.to, text: req.body?.text, result: req.body?.result, files: Array.isArray(req.body?.files) ? req.body.files : [] })));
  // The plan meter: the status line script (tools/statusline-meter.mjs) sends Claude Code's rate_limits here.
  app.post("/api/agents/ingest/plan-meter", small, guard, cap("plan-meter", 30), safe((req) => savePlanMeter(req.body || {})));
  app.post("/api/agents/ingest/job", guard, cap("job", 60), safe((req) => updateJob(req.body?.id, { status: req.body?.status, summary: req.body?.summary, result: req.body?.result }, sender(req.body))));
  // Read-only routes for the MCP server (tools/hub-mcp.mjs): one job's tree, and a desk's recent steps.
  app.post("/api/agents/ingest/trace", small, guard, safe((req) => jobTrace({ job: req.body?.job || null, desk: req.body?.desk || null })));
  app.post("/api/agents/ingest/live", small, guard, safe((req) => deskLive(req.body?.desk, typeof req.body?.since === "string" ? req.body.since : null)));
  // OpenTelemetry in (src/pipeline/otel.js): OTLP/HTTP JSON traces, GenAI semantic conventions. Metadata only.
  app.post("/api/agents/ingest/otel/v1/traces", guard, (req, res) => {
    if (Number(req.headers["content-length"] || 0) > MAX_BODY_BYTES) return res.status(413).json({ error: `Send under ${MAX_BODY_BYTES / 1024} KB per request.` });
    if (!/json/i.test(String(req.headers["content-type"] || "")) || !req.body || typeof req.body !== "object") return res.status(415).json({ error: "Send OTLP/HTTP JSON (Content-Type: application/json); protobuf isn't supported." });
    try {
      const { events, rejected } = spansToEvents(req.body, roster().desks);
      for (const ev of events) recordEvent(ev, "otel");
      // OTLP's way of saying "some were refused": partialSuccess, still HTTP 200
      res.json(rejected ? { partialSuccess: { rejectedSpans: rejected, errorMessage: `Only the first ${MAX_SPANS} spans of a request are used.` } } : {});
    } catch (err) {
      res.status(400).json({ error: String(err.message).split("\n")[0] });
    }
  });
}

export const agentsRouter = Router();
agentsRouter.get("/", safe(() => agentsOverview()));
agentsRouter.get("/roster", safe(() => roster()));
// The city view (Living City L2, src/pipeline/city.js): counts only, read-only, cached 30 s; the campus asks once a minute while it is on screen.
agentsRouter.get("/city", safe(() => cityNow()));
// This owner's private parts (src/private/, never in the kit) add their own routes here.
for (const p of PARTS) p.agentRoutes?.(agentsRouter, { safe, requirePasswordConfirmed });
// One worker's recent steps for the brain view (asked every couple of seconds while it's open).
agentsRouter.get("/desk/:id/live", safe((req) => deskLive(req.params.id, typeof req.query.since === "string" ? req.query.since : null)));
// The Neural view's tree: ?job=<id>, or ?desk=<id> for that desk's current or latest job.
agentsRouter.get("/trace", safe((req) => jobTrace({ job: typeof req.query.job === "string" ? req.query.job : null, desk: typeof req.query.desk === "string" ? req.query.desk : null })));
// The Neural view's web: who handed work to, reported back to or left notes for whom. ?days=1..30, &social=1 adds chat.
agentsRouter.get("/web", safe((req) => agentWeb({ days: req.query.days, social: req.query.social === "1" })));
// Saving a desk needs the dashboard password only when it lets the desk spend more (deskChangeSpends): a higher or
// removed cap, or a switch to being run by the hub on the API.
agentsRouter.post("/desk", (req, res, next) => (deskChangeSpends(req.body || {}) ? requirePasswordConfirmed(req, res, next) : next()), safe((req) => saveDesk(req.body || {})));
// Just the cap (the campus meter wall): the same password rule, judged on the cap alone.
agentsRouter.post("/desk/status", (req, res, next) => (deskResumeSpends(req.body || {}) ? requirePasswordConfirmed(req, res, next) : next()), safe((req) => setDeskStatus(req.body || {})));
agentsRouter.post("/desk/cap", (req, res, next) => (deskChangeSpends({ id: req.body?.id, capUsdMonth: req.body?.capUsdMonth }) ? requirePasswordConfirmed(req, res, next) : next()), safe((req) => setDeskCap(req.body || {})));
// Realign reports from the org chart: project, who it reports to, lead or not.
agentsRouter.post("/desk/realign", safe((req) => realignDesk(req.body || {})));
agentsRouter.post("/desk/folder", requirePasswordConfirmed, safe((req) => setDeskFolder(req.body || {})));
// What a worker's own session may use (running its code, Godot, ...). Password: it widens what runs on this PC.
agentsRouter.post("/desk/grants", requirePasswordConfirmed, safe((req) => setDeskGrants(req.body || {})));
// Take back a single command a worker was given by an approved ask (allowAskedCommands). Password, like grants.
agentsRouter.post("/desk/allowed/remove", requirePasswordConfirmed, safe((req) => removeAllowedCommand(req.body || {})));
agentsRouter.post("/desk/chat", safe((req) => setDeskChat(req.body || {})));
// A Short for a worker right now (testing, or a treat from the owner without spending its credits).
// A worker suggests a new Campus Mart item now (normally it happens now and then by itself); HR checks it next run.
// (money safety F3: it calls an AI, so password, 6 an hour, and the store's budget; see suggestStoreItem)
agentsRouter.post("/store/suggest", requirePasswordConfirmed, perHour("store ideas", 6), safe((req) => suggestStoreItem(req.body?.desk)));
// the owner adds an item to the Mart himself. A lasting thing is play money: no password. An outing (an experience from
// the allow-list) can spend the store's real budget, so it takes the dashboard password.
agentsRouter.post("/store/item", (req, res, next) => (/^(outings|experience)$/.test(String(req.body?.cat || "")) ? requirePasswordConfirmed(req, res, next) : next()), safe((req) => addOwnerItem(req.body || {})));
// The experiences allow-list, for the Mart's add-an-item form.
agentsRouter.get("/store/sources", safe(() => Object.entries(SOURCES).map(([id, s]) => ({ id, name: s.name, host: s.host }))));
agentsRouter.post("/short", requirePasswordConfirmed, perHour("Shorts", 6), safe((req) => watchShort(req.body?.desk)));
// Add a project from the campus: its room, and for a project in a folder on this PC, the folder, its CLAUDE.md, the
// folder map and a Claude Code lead. Password: it makes files on this PC and can start a worker.
agentsRouter.post("/project", requirePasswordConfirmed, safe((req) => createProject(req.body || {})));
// Start or pause a project room.
agentsRouter.post("/room", safe((req) => setRoom(req.body || {})));
agentsRouter.post("/request", safe((req) => addRequest({ ...(req.body || {}), kind: "staff" }, ownerId())));
// the owner approves or declines (HR only recommends, from inside the hub in step 4).
// A merge ask (one that names a PR) sends to GitHub, so it needs the dashboard password like another project page.
agentsRouter.post("/request/:id/ask", safe((req) => askAboutRequest(req.params.id, req.body || {})));
agentsRouter.post("/request/:id/decide", pw((req) => decideSpends(req.params.id, req.body || {})), safe((req) => decideRequest(req.params.id, req.body || {})));
// Run HR now instead of waiting for its next check (hr.js). Costs nothing when no request is waiting.
const hrRuns = []; // at most 6 button runs an hour (security plan 03)
agentsRouter.post("/hr/run", requirePasswordConfirmed, safe(async () => {
  const now = Date.now();
  while (hrRuns.length && now - hrRuns[0] > 3600e3) hrRuns.shift();
  if (hrRuns.length >= 6) throw new Error("HR already ran 6 times this hour. It runs by itself every 3 hours.");
  hrRuns.push(now);
  return (await import("../pipeline/hr.js")).runHr({ trigger: "button" });
}));
// Paste a batch of "Hub log:" lines from chats that can't reach the hub.
agentsRouter.post("/hublog", safe((req) => importHubLog(req.body?.text, req.body?.room)));
// Jobs. Giving a job to a desk whose room is linked to an outside inbox (src/hub/extras.js) also writes there, and
// running a job on a desk spends API money, so both need the dashboard password.
// (security plan 03: also a chain step on a hub-run paid desk, which starts by itself, and a job for HR.)
agentsRouter.post("/job", pw((req) => jobSpends(req.body || {})), safe((req) => addJob(req.body || {})));
agentsRouter.post("/job/:id/cancel", safe((req) => updateJob(req.params.id, { status: "cancelled", summary: req.body?.note || `Cancelled by ${OWNER()}` }, ownerId())));
// Run now is the owner's own OK for a job over the approval line (the confirm box showed him the estimate).
agentsRouter.post("/job/:id/run", requirePasswordConfirmed, safe((req) => runJob(req.params.id, { approve: true })));
// Push one queued job: Run now for a hub-run desk, a Claude Code session in its project folder, or (chat-based desks)
// the job text and chat link to paste it. Spends API or subscription time, so it takes the dashboard password.
agentsRouter.post("/job/:id/push", requirePasswordConfirmed, safe((req) => pushJob(req.params.id)));
// The error flow: retry a failed job (optionally on another desk), or dismiss it.
agentsRouter.post("/job/:id/retry", pw((req) => { try { return jobSpends({ desk: req.body?.desk || findJob(req.params.id).desk }); } catch { return false; } }), safe((req) => retryJob(req.params.id, { desk: req.body?.desk })));
agentsRouter.post("/job/:id/dismiss", safe((req) => dismissJob(req.params.id)));
agentsRouter.get("/job/:id/output", safe((req) => jobOutput(req.params.id)));
// Quality checks (agents/quality.js): each desk's score, pay, taste-test set, brief versions and quality check runs.
// The Quality checks part (hub/modules.js) owns these routes. A run re-runs past jobs on a candidate model or brief, so
// it spends API money: the dashboard password, a cap per run, and the cost the owner saw (okUsd) must still hold.
agentsRouter.get("/quality", safe(() => qualityView()));
agentsRouter.get("/quality/desk/:id", safe((req) => ({
  versions: briefVersions(req.params.id),
  samples: sampleSet(String(req.params.id)).map((s) => ({ job: s.job.id, score: s.score, from: s.from, task: String(s.job.text).split("\n")[0].slice(0, 120), at: s.job.updatedAt })),
  runs: qualityRuns({ desk: String(req.params.id) }),
})));
agentsRouter.post("/quality/estimate", safe((req) => estimateRun(req.body || {})));
agentsRouter.post("/quality/run", requirePasswordConfirmed, safe((req) => startRun(req.body || {}, ownerId())));
agentsRouter.post("/quality/apply", requirePasswordConfirmed, safe((req) => applyRun(String(req.body?.run || ""), ownerId())));
agentsRouter.post("/quality/rollback", requirePasswordConfirmed, safe((req) => rollBack(req.body || {}, ownerId())));
// Old and new result of one job in a run, side by side.
agentsRouter.get("/quality/run/:id/:job", safe(async (req) => {
  const run = qualityRuns().find((r) => r.id === req.params.id);
  if (!run || !run.results?.some((x) => x.job === req.params.job) && !run.done) throw new Error("No such quality check.");
  const fs = await import("node:fs"), path = await import("node:path"), { resolvePath } = await import("../pipeline/util.js");
  const id = String(req.params.job).replace(/[^a-zA-Z0-9_-]/g, "");
  let neu = "";
  try { neu = fs.readFileSync(path.join(resolvePath("data/agents/quality"), String(run.id).replace(/[^a-zA-Z0-9_-]/g, ""), `${id}.md`), "utf8"); } catch {}
  let old = "";
  try { old = jobOutput(id).text; } catch {}
  return { old, new: neu };
}));
// the owner's 👍 / 👎 on a finished job: a 👍 on a cheap, real result pays the thrift bonus; 👎 cancels it.
agentsRouter.post("/job/:id/rate", safe((req) => rateJob(req.params.id, req.body?.rating, { by: ownerId() })));
// Hold the lead stand-up now instead of waiting for 9:00 or 15:00.
// Paid services every project uses, with live balances where a key allows (cached 30 minutes; ?fresh=1 re-checks).
agentsRouter.get("/services", safe((req) => servicesStatus({ fresh: req.query.fresh === "1" })));
// Run the Gemini workers' queued hub jobs now instead of waiting for the 15-minute check.
agentsRouter.post("/local-run", requirePasswordConfirmed, safe(() => runLocalJobs({ trigger: "button" })));
// From the stand-up: give the same job to every lead at the table (or the ones ticked), e.g. "review and update your
// project's documentation". Password, since another project job also goes to its GitHub inbox.
agentsRouter.post("/standup/assign", requirePasswordConfirmed, safe(async (req) => {
  {
    const text = String(req.body?.text || "").trim();
    if (!text) throw new Error("Say what every lead should do.");
    const m = meetings(1)[0];
    if (!m) throw new Error("No stand-up yet. Hold one first.");
    const pickRooms = Array.isArray(req.body?.rooms) && req.body.rooms.length ? new Set(req.body.rooms.map(String)) : null;
    const leads = m.projects.filter((p) => p.lead && (!pickRooms || pickRooms.has(p.room)));
    const given = [], failed = [];
    for (const p of leads) {
      try {
        const j = await addJob({ desk: p.lead, text: `From the lead stand-up (${m.day} ${m.slot}): ${text}` });
        given.push({ room: p.room, desk: p.lead, id: j.id });
      } catch (err) {
        failed.push({ room: p.room, desk: p.lead, error: String(err.message).slice(0, 160) });
      }
    }
    return { given, failed };
  }
}));
// Alert rules the owner sets (phone alert when one fires) and the month-end spend forecast. No password: they spend nothing.
agentsRouter.get("/alerts", safe(() => ({ ...alertsView(), desks: roster().desks.filter((d) => d.status !== "retired").map((d) => d.id).sort() })));
agentsRouter.post("/alerts", safe((req) => saveRule(req.body, { deskIds: roster().desks.map((d) => d.id) })));
agentsRouter.post("/alerts/:id/remove", safe((req) => removeRule(req.params.id)));
agentsRouter.get("/forecast", safe(() => forecastNow()));
// The plan meter and Finance's plan budgets (planmeter.js): GET the view; POST { room, pct } sets a project's share of
// the week (room "hub-stop" sets the line where hub-started sessions stop).
agentsRouter.get("/plan", safe(() => planNow()));
agentsRouter.post("/plan/budget", safe((req) => savePlanBudget(req.body || {})));
// Let a PC lead work on its own for a while (starts a headless Claude Code session in its folder). Password: it runs
// commands on this PC.
// The owner pressing the button with his password is his OK over the approval line; the confirm box showed him the estimate.
agentsRouter.post("/autonomy", requirePasswordConfirmed, safe((req) => grantAutonomy({ ...(req.body || {}), approved: true })));
// What a job or a session would cost against the approval line (free, no AI call), for the confirm boxes.
agentsRouter.get("/job/:id/estimate", safe((req) => { const j = findJob(req.params.id), d = roster().desks.find((x) => x.id === j.desk); if (!d) throw new Error("That desk is no longer on the roster."); return d.runner === "hub" ? jobApproval(d, j) : sessionApprovalFor(d, 1); }));
agentsRouter.get("/session-estimate", safe((req) => { const d = roster().desks.find((x) => x.id === String(req.query.desk || "")); if (!d) throw new Error("Pick a desk on the roster."); return sessionApprovalFor(d, plannedHours({ hours: Number(req.query.hours), untilMorning: req.query.untilMorning === "1" })); }));
// The week: start today's after-meeting work by hand, and a project's own switch and weekly hours (agents.js, "the week").
agentsRouter.get("/week", safe(() => weekStatus()));
agentsRouter.post("/week/start", requirePasswordConfirmed, safe((req) => afterMeeting({ trigger: "button", rooms: Array.isArray(req.body?.rooms) ? req.body.rooms.map(String) : undefined })));
agentsRouter.post("/week/room", requirePasswordConfirmed, safe((req) => setRoomWeek(req.body || {})));
agentsRouter.post("/autonomy/stop", safe((req) => stopAutonomy(req.body?.desk)));
// A gift from the Campus Mart (play money only).
// A gift that calls an AI (a Short, a web surf, an experience) spends real money: password and 6 an hour (F3/F4).
const giftSpends = (b) => ["short", "surf"].includes(String(b?.item || "")) || Boolean(PERKS[String(b?.item || "")]?.experience);
agentsRouter.post("/gift", pw((req) => giftSpends(req.body)), (req, res, next) => (giftSpends(req.body) ? perHour("paid gifts", 6)(req, res, next) : next()), safe((req) => giftPerk(req.body || {})));
// The city fund (cityfund.js): the store tax, the board's spends, the API quota pool. Play money: no password, and no
// path here spends real money (the quota is an allowance; spending it would go through the password-gated paths).
agentsRouter.get("/cityfund", safe(() => fundView()));
agentsRouter.post("/cityfund/propose", perHour("fund proposals", 10), safe((req) => proposeSpend({ ...(req.body || {}), by: ownerId() })));
// the owner's own vote: only here, behind the dashboard login (review H1)
agentsRouter.post("/cityfund/vote", perHour("fund votes", 30), safe((req) => voteSpend({ id: req.body?.id, vote: req.body?.vote, why: req.body?.why }, { owner: true })));
// Player districts (districts.js, campus part 5): play money; the owner proposes for a worker, approves or stops.
agentsRouter.get("/districts", safe(() => districtsView()));
agentsRouter.post("/districts/propose", perHour("district proposals", 10), safe((req) => proposeDistrict({ founder: req.body?.founder, name: req.body?.name })));
agentsRouter.post("/districts/decide", safe((req) => decideDistrict({ id: req.body?.id, decision: req.body?.decision })));
agentsRouter.post("/cityfund/quota", perHour("API quota buys", 20), safe((req) => buyQuota({ desk: req.body?.desk })));
// The campus casino (casino.js): workers' slot sessions with play credits; read only. On and off is a setting (agents.casino.on).
agentsRouter.get("/casino", safe(() => casinoView()));
// Move a project to another district (or into the owner's CEO tower: "Home").
agentsRouter.post("/room/district", safe((req) => setRoomDistrict(req.body || {})));
// Blocker watches from the campus and the Agents page: close one, or check now.
agentsRouter.post("/blocker/close", safe((req) => closeBlocker({ id: req.body?.id, by: ownerId() })));
let lastForcedCheck = 0; // a forced check at most once a minute (security plan 02)
agentsRouter.post("/blocker/check", safe((req) => {
  if (Date.now() - lastForcedCheck < 60000) throw new Error("Checked less than a minute ago. Try again shortly.");
  lastForcedCheck = Date.now();
  return checkBlockers({ force: true, id: req.body?.id || null });
}));
// the owner ends a loan early.
agentsRouter.post("/loan/return", safe((req) => returnLoan({ request: req.body?.request })));
agentsRouter.post("/standup", safe(() => holdStandup({ trigger: "button" })));
// "Which project is this?": put a folder the hook doesn't know into data/agents/hook-map.json.
agentsRouter.post("/hookmap", requirePasswordConfirmed, safe((req) => mapFolder(req.body || {})));
// The manual log box: Grok, phone chats, claude.ai sessions.
agentsRouter.post("/event", safe((req) => recordEvent(req.body || {}, "manual")));
