// Agent dashboard, step 1 (docs/agent-dashboard-scope.md, 2026-11-09).
// Keeps the roster of AI "desks", the staffing requests project leads file for HR, and agent events.
//   data/agents/roster.json    rooms and desks. Only the owner changes it (from the page); HR only recommends.
//   data/agents/requests.jsonl one line per request, newest last; a review adds a later line with the same id.
//   data/agents/token.txt      key that hooks and agents on this PC send to post events without a sign-in.
// Agent events go in the run log as kind "agent event", next to the hub's own "ai call" lines, so spend reads one file.
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { rollOverflow } from "./roll.js";
import { resolvePath, writeJsonAtomic, readJsonl, readJsonlRange, appendJsonl, readJsonlCached, keepLastLines, every, newId, isId, dayIn, hourIn } from "./util.js";
import { logEvent, readRuns } from "./runlog.js";
import { appendSpend, deskOfCall, monthKey, monthStartIso, setCostUnknownHook, setLegacyEvents, spendSince, spendThisMonth } from "./spend.js";
import { planBudgets, planView, meterReadings, recordMeter, seedPlanBudgets, setPlanBudget } from "./planmeter.js";
import { checkAlerts, dayStartMs } from "./alerts.js";
import { forecast } from "./forecast.js";
import { costOf, hasGemini, CLAUDE as CLAUDE_ALIAS } from "./ai.js";
import { askAs, obj, str, arr } from "./claude.js";
import { COMPAT, isCompat, compatReady, compatPriceGap, providerConfig } from "./openai-compat.js";
import { config } from "../config.js";
import { ProviderRefusal, isSerious, nextRoute, passOffSettings, refusalStats } from "./refusal.js";
import { addTodo } from "./todo.js";
import { creditStatus } from "./credits.js";
import { sendAlert, dashboardLink } from "./notify.js";
import { ownerName as OWNER, ownerId, hubFolder as HUB_DIR, hubTz, hubSettings, petLine, isDemo, DEMO_MESSAGE } from "../hub/settings.js";
import { helperMay, helperWhy } from "../hub/helpers.js";
import { grantList, whoCan } from "./grants.js";
import { assistantBrief, prReviewTick, prReviews, reviewPr } from "./agents/assistant.js";
import { LOCAL_MS, autonomyStatus, localRunnerStatus, runLocalJobs, adoptSessions } from "./agents/autonomy.js";
import { BOARD, BOARD_LOG, boardBudget, boardCheck, boardHireCap, boardView, financeCheck, financeView, returnLoan } from "./agents/board.js";
import { PERKS, STORE_CATS, addStoreItem, choreTick, homesState, jobRatings, registerStoreItems, shop, shortOfWeek, storeSpend, suggestStoreItem, surfed, wallets, watched } from "./agents/campus.js";
import { roomLink as inboxLink, toRoomInbox, partsWith } from "../hub/extras.js";
import { RELAY_MS, hookMap, mapFolder, pullCloudRelay, relayStatus, setDeskFolder, unmappedFolders } from "./agents/intake.js";
import { hubRunRules } from "./workrules.js";
import { PRIVATE_NETWORK_MESSAGE, blockedHostName, checkPublicUrl, isPublicIp } from "./netguard.js";
import { STANDUP_DAYS, STANDUP_TIMES, checkStandup, meetings, nextStandup, weekStatus } from "./agents/meetings.js";
export * from "./agents/assistant.js";
export * from "./agents/board.js";
export * from "./agents/campus.js";
export * from "./agents/selves.js";
import { noteLife, growSelves, selfLine, selvesForPage } from "./agents/selves.js";
import { buildTrace, buildWeb, feedGroups, jobWindows, jobOf } from "./trace.js";
import { timerOn, moduleOn } from "../hub/modules.js";
import { TEAMS, crewRequests } from "./teams.js";
export * from "./agents/autonomy.js";
export * from "./agents/meetings.js";
export * from "./agents/intake.js";
export * from "./agents/quality.js";
import { noteVersion, qualitySummary } from "./agents/quality.js";

const DIR = () => resolvePath("data/agents");
const ROSTER = () => path.join(DIR(), "roster.json");
const REQUESTS = () => path.join(DIR(), "requests.jsonl");
const TOKEN = () => path.join(DIR(), "token.txt");
// Agent events get their own file (code review 2026-11-09): the run log keeps only its newest 5000 lines, and a busy
// Claude Code day would push the hub's own AI calls and job runs out of it, breaking credits, costs and caps.
const EVENTS = () => path.join(DIR(), "events.jsonl");
const EVENTS_KEEP = 20000;
let eventWrites = 0;
// The newest events, kept in memory for the brain view (deskLive), which asks every couple of seconds while it's
// open: reading the whole events file that often would be wasteful. Seeded from the file the first time it's needed.
const RING_MAX = 600;
let ring = null;
function appendEvent(entry) {
  appendJsonl(EVENTS(), entry);
  if (ring) { ring.push(entry); if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX); }
  if (++eventWrites % 200) return;
  rollOverflow(EVENTS(), EVENTS_KEEP, { field: "startedAt" }); // older lines roll into their month file, none are thrown away
}
function withAliases(rows) {
  // Desk aliases: a desk's "aliases" in the roster (other names a session reports under, e.g. another project-pc for
  // another project-pc-builder) count as that desk, for old and new events alike.
  const alias = deskAliases();
  if (!alias.size) return rows;
  return rows.map((e) => (e.desk && alias.has(e.desk) ? { ...e, desk: alias.get(e.desk), reportedAs: e.desk } : e));
}
function readEvents() {
  return withAliases(readJsonlCached(EVENTS()));
}
// Events from iso on, including the months rolled into .jsonl.gz files (readEvents() is the live file only).
export function readEventsSince(iso) {
  return withAliases(readJsonlRange(EVENTS(), iso, null, { field: "startedAt" }));
}
function deskAliases() {
  const m = new Map();
  try {
    for (const d of roster().desks) for (const a of d.aliases || []) if (a && a !== d.id) m.set(String(a), d.id);
  } catch {}
  return m;
}

// A fresh hub (Hub kit, 2026-11-10): just the Hub itself and HR. The setup guide (docs/kit/SETUP.md) then adds the
// owner's projects as rooms, each with a lead, through HR. An existing roster.json is never touched by these.
export const DEFAULT_ROOMS = [
  { id: "hub", name: "Hub", status: "active", district: "Tools" },
  { id: "hr", name: "HR", status: "active" },
];
// The starting staff: the owner's main Claude Code session (reports through the hook), HR on a small model, and the
// finance buddy. Everything else arrives through a lead's request, HR's check and the owner's yes (or the board's).
const DEFAULT_DESKS = [
  {
    id: "hub-lead", room: "hub", role: "Project lead: builds and runs the hub itself", lead: true,
    provider: "claude", model: "claude-code", effort: null, capUsdMonth: null, status: "active",
    brief: "The owner's Claude Code session in the hub folder. Reports automatically through the hook.",
  },
  {
    id: "hr", room: "hr", role: "HR: checks lead requests against goals, roster and budget; picks provider, model and effort", lead: true,
    provider: "claude", model: "claude-haiku-5-5", effort: "low", capUsdMonth: 2, status: "active", runner: "hub",
    brief: `Recommends; ${OWNER()} (or the board, within its limits) approves.`,
  },
  {
    id: "finance", room: "hr", role: "Finance buddy: tracks spend, projects month end, warns before caps, sits on the board", lead: false,
    provider: "claude", model: "claude-haiku-5-5", effort: "low", capUsdMonth: 0.5, status: "active", runner: "hub",
    brief: "Writes a short weekly money note from the hub's numbers.",
  },
];

// Hub kit step 2: OpenAI, DeepSeek and local models join; grok desks can now be run by the hub too (openai-compat.js).
const PROVIDERS = ["claude", "gemini", ...Object.keys(COMPAT), "mixed", "other"];
const DESK_STATUSES = ["planned", "active", "paused", "retired"];
const URGENCY = ["low", "normal", "high"];
// HR recommends one of these; the owner then decides approved or declined. Only the owner's decision closes a request.
const VERDICTS = ["approve", "approve-cheaper", "reuse", "decline"];
const DECISIONS = ["approved", "declined"];

const clip = (v, n = 200) => (v == null ? null : String(v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n) || null);
const slug = (v) => clip(v, 40)?.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || null;
const num = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Number(v)));

// The command line a session or worker uses to report to the hub (forward slashes, so it reads the same everywhere).
const LOG_TOOL = () => resolvePath("tools/agent-log.mjs").replace(/\\/g, "/");
// The first moment of this calendar month (midnight on the 1st in the hub's time zone), as an ISO string: monthly caps
// and the store's budget count from it.
const monthStart = () => monthStartIso();

// What each desk has used this month, from the spend ledger (spend.js: every costed hub AI call and agent event).
// usd: real API spend, what the caps are checked against. subUsd: subscription use priced as if it were on the API.
// events: the ledger's hub AI calls plus every agent event this month, costed or not. The HR desk's AI step counts on
// its desk, hub-run desk jobs ("desk_<id>") on theirs, the rest of the hub's calls on the pipeline.
setLegacyEvents(() => readEvents());
// A paid call with no price on file is booked at the default rate (claude.js bookedCost); say so on its desk.
setCostUnknownHook(({ step, provider, model, costUsd }) => {
  const desk = deskOfCall(step);
  recordEvent({ desk, room: roster().desks.find((d) => d.id === desk)?.room, action: "cost unknown", summary: clip(`cost unknown: booked at the default rate ($${Number(costUsd || 0).toFixed(4)} for ${provider || "?"} ${model || ""})`, 200), provider, model }, "hub");
});
function monthSpend(now = new Date()) {
  const spend = {}, since = monthStartIso(now);
  const of = (desk) => (spend[desk] ??= { events: 0, usd: 0, subUsd: 0 });
  const alias = deskAliases(); // a desk's other names count as that desk, as in readEvents
  for (const x of spendThisMonth(now)) {
    const s = of(alias.get(x.desk) || x.desk || "unassigned");
    if (x.kind === "ai call") s.events++;
    if (x.billing === "subscription") s.subUsd += x.costUsd;
    else s.usd += x.costUsd;
  }
  for (const x of readEvents()) if (x.startedAt >= since) of(x.desk || "unassigned").events++;
  for (const s of Object.values(spend)) { s.usd = Math.round(s.usd * 10000) / 10000; s.subUsd = Math.round(s.subUsd * 10000) / 10000; }
  return spend;
}

// ---------- roster ----------
export function roster() {
  try {
    const r = JSON.parse(fs.readFileSync(ROSTER(), "utf8"));
    // Keep every other key in the file: dropping them would wipe them on the next roster save.
    return { ...r, rooms: Array.isArray(r.rooms) ? r.rooms : DEFAULT_ROOMS, desks: Array.isArray(r.desks) ? r.desks : [] };
  } catch (err) {
    if (err.code !== "ENOENT") throw new Error(`Agent roster can't be read: ${err.message}`);
    const fresh = { rooms: DEFAULT_ROOMS, desks: DEFAULT_DESKS.map((d) => ({ ...d, hiredAt: new Date().toISOString() })) };
    writeJsonAtomic(ROSTER(), fresh);
    return fresh;
  }
}

// Start or pause a project room (the owner, 2026-11-09). A room with no status yet counts as running when it has an
// active desk and paused when it has none. Pausing a room pauses its active desks; starting it puts them back and,
// when the room has no lead, files a "Project lead" request so HR staffs it.
export function roomStatus(r, desks) {
  if (r.id === "hr") return "active"; // HR's office is never paused
  if (r.status === "active" || r.status === "paused") return r.status;
  return desks.some((d) => d.room === r.id && d.status === "active") ? "active" : "paused";
}
// Districts (the owner 2026-11-09, layout A): each project sits in a themed district; "Home" projects are the owner's own and
// live in his CEO tower with the Control Center and the pet. A room's own `district` wins; these are the defaults.
export const DISTRICTS = ["Creative", "Games", "Tools", "Home"];
// A room's district when it hasn't picked one: the hub settings' "districts" ({ room id: district }), a private part's,
// else Tools.
let districtDefault = null;
const DISTRICT_DEFAULT = () => (districtDefault ??= { hub: "Tools", hr: "Tools", ...Object.assign({}, ...partsWith("districts").map((p) => p.districts)), ...(hubSettings().districts || {}) });
export const districtOf = (room) => (DISTRICTS.includes(room?.district) ? room.district : DISTRICT_DEFAULT()[room?.id] || "Tools");
export function setRoomDistrict({ id, district } = {}) {
  const r = roster(), room = r.rooms.find((x) => x.id === slug(id));
  if (!room) throw new Error("Unknown room.");
  if (!DISTRICTS.includes(district)) throw new Error(`District must be one of: ${DISTRICTS.join(", ")}.`);
  if (room.id === "hr" && district === "Home") throw new Error("HR stays on the campus.");
  room.district = district; room.changedAt = new Date().toISOString();
  writeJsonAtomic(ROSTER(), r);
  logEvent("agent roster", { trigger: "button", room: room.id, change: `district ${district}` });
  return { ...room };
}
// A new project room, made by HR when it builds a team for a project that has no room yet (the owner 2026-11-09, "HR
// files hiring requests itself"). Does nothing when the room exists. Returns the room.
export function addRoom({ id, name, district } = {}) {
  const r = roster(), rid = slug(id || name);
  if (!rid) throw new Error("Name the room.");
  const have = r.rooms.find((x) => x.id === rid);
  if (have) return { ...have, existed: true };
  const room = { id: rid, name: clip(name || rid, 60), ...(DISTRICTS.includes(district) && district !== "Home" ? { district } : {}), status: "active", changedAt: new Date().toISOString() };
  r.rooms.push(room);
  writeJsonAtomic(ROSTER(), r);
  logEvent("agent roster", { trigger: "hr", room: rid, change: "room added (HR)" });
  return { ...room };
}
// ---------- add a project from the campus (the owner 2026-11-11) ----------
// "We need an in-campus way to add projects." One form makes everything a project needs to be linked into the hub:
// its room (a building on the campus), a lead, and for a project built in a folder on this PC, the folder itself
// with a CLAUDE.md (project basics and the hub rule), the folder map entry and a project page in docs/projects/.
// Lead kinds:
//   "code"  Claude Code on this PC in the project's folder (the owner's subscription; no API cost, so no HR check)
//   "hub"   a worker the hub runs: filed with HR as a "Project lead" request, HR picks the model, the owner approves
//   "none"  just the building; staff can come later
// It never overwrites: an existing folder, CLAUDE.md or project page is kept (a CLAUDE.md without a hub section gets
// one added at the end).
const projectClaudeMd = ({ name, about, room, lead }) => {
  const tool = LOG_TOOL(), hub = HUB_DIR();
  return `# ${name}: rules for Claude sessions

${about || `${OWNER()}'s project "${name}".`}

Sessions here are desk \`${lead}\` (the project lead) in room \`${room}\` of ${OWNER()}'s hub.

## Start here
- \`docs/STATUS.md\`: what exists, what's untested, what's next. Keep it current; create it in your first session.
- \`docs/DESIGN.md\`: what this project is and how it works, on one page. Create it before building.

## Working rules
- Scope first: build the smallest thing that works, then add.
- If there is no git repo here yet, save your work in this folder and say what you changed in your report. Don't create a repo yourself: ask ${OWNER()}.
- Spending anything needs ${OWNER()}'s yes first. Mark anything you haven't run as UNTESTED in STATUS.md.
- Follow ${OWNER()}'s working rules (finish the task; real time estimates up front; questions only for money, deleting, public or direction calls, answerable in one word; hand-offs stand on their own).
${hubSection({ name, room, lead, tool, hub })}`;
};
const hubSection = ({ name, room, lead, tool, hub }) => `
## ${OWNER()}'s hub (Agents page)
Standing rule from ${OWNER()}: every project links into the hub, and every handoff carries that rule.
Guide: \`${hub}/docs/kit/REPORTING.md\`.
- Claude Code sessions in this folder report automatically through the hook. Nothing to do.
- Your waiting jobs: \`node ${tool} jobs --desk ${lead}\`
- Finish a job: \`node ${tool} done --job <id> --summary "..." --result-file <file>\`
- Hand work on (\`node ${tool} desks\` lists everyone; small errands go to \`assistant\`):
  \`node ${tool} handoff --desk ${lead} --to <desk> --text "<what they should do>"\`
  At most 4 automatic hand-offs per chain, never straight back to whoever handed it to you.
- Need a standing helper? Ask HR instead of starting one yourself:
  \`node ${tool} request --from ${lead} --room ${room} --role "<role>" --why "<what's piling up>" --provider claude --model haiku --effort low --budget <USD/month>\`
- A yes or no from ${OWNER()} (spending, a repo, a build plan outside this scope):
  \`node ${tool} ask --from ${lead} --room ${room} --question "..." --why "..."\`
  Answers: \`node ${tool} inbox --desk ${lead}\`.
- Every job, thread or prompt handed to another session or tool ends with this footer:
  \`\`\`
  HUB RULE: this work belongs to ${name} in ${OWNER()}'s hub (${hub}, room ${room}).
  Log what you do (PC: tools/agent-log.mjs event; otherwise a "Hub log:" line in your report).
  Need a new standing helper? Ask the lead, who asks HR. If you hand this on, include this footer.
  \`\`\`
`;
export async function createProject(body = {}) {
  const name = clip(String(body.name || "").replace(/\s+/g, " ").trim(), 60);
  if (!name) throw new Error("Give the project a name.");
  const id = slug(name).slice(0, 40);
  if (!id) throw new Error("That name has no letters or numbers in it.");
  const r0 = roster();
  if (r0.rooms.some((x) => x.id === id)) throw new Error(`There's already a project called "${r0.rooms.find((x) => x.id === id).name}". Pick another name.`);
  const about = clip(String(body.about || "").trim(), 600);
  const kind = ["code", "hub", "none"].includes(body.lead) ? body.lead : "none";
  const district = DISTRICTS.includes(body.district) && body.district !== "Home" ? body.district : "Tools";
  const leadId = `${id}-lead`.slice(0, 48);
  // a team template (src/pipeline/teams.js): checked before anything is made
  const team = body.team ? String(body.team) : null;
  if (team && !TEAMS[team]) throw new Error(`There's no team called "${team}".`);
  if (team && !moduleOn(TEAMS[team].module)) throw new Error(`The ${TEAMS[team].name} part is switched off on this hub.`);
  // check the folder before anything is made, so a bad path leaves nothing half-built
  let folder = null, madeFolder = false;
  if (kind === "code") {
    folder = clip(String(body.folder || "").trim(), 300).replace(/[\\/]+$/, "");
    if (!folder || !/^([a-zA-Z]:[\\/]|\/)/.test(folder + path.sep) || /[\r\n"<>|?*]/.test(folder.slice(2))) throw new Error("Give the folder as a full path, like D:\\MyProject.");
    if (/^([a-zA-Z]:|)$/.test(folder)) throw new Error("Pick a folder, not a whole drive.");
    const f = path.resolve(folder).toLowerCase(), hub = path.resolve(resolvePath(".")).toLowerCase();
    if (f === hub || f.startsWith(hub + path.sep)) throw new Error("That's inside the hub's own folder. Give the project a folder of its own.");
    const taken = Object.entries(hookMap()).find(([k]) => path.resolve(k).toLowerCase() === f);
    if (taken) throw new Error(`That folder already belongs to ${taken[1].room}.`);
    if (fs.existsSync(folder) && !fs.statSync(folder).isDirectory()) throw new Error("That path is a file, not a folder.");
  }
  const done = [];
  addRoom({ id, name, district });
  if (about) { const r = roster(), room = r.rooms.find((x) => x.id === id); room.about = about; writeJsonAtomic(ROSTER(), r); }
  done.push(`${name} is on the campus (${district})`);
  let job = null, request = null;
  if (kind === "code") {
    if (!fs.existsSync(folder)) { fs.mkdirSync(folder, { recursive: true }); madeFolder = true; done.push(`made the folder ${folder}`); }
    const md = path.join(folder, "CLAUDE.md"), tool = LOG_TOOL();
    if (!fs.existsSync(md)) { fs.writeFileSync(md, projectClaudeMd({ name, about, room: id, lead: leadId })); done.push("wrote its CLAUDE.md (project basics and the hub rule)"); }
    else if (!/agent-log\.mjs|hub rule/i.test(fs.readFileSync(md, "utf8"))) { fs.appendFileSync(md, `\n${hubSection({ name, room: id, lead: leadId, tool, hub: HUB_DIR() })}`); done.push("added the hub section to its CLAUDE.md"); }
    saveDesk({ id: leadId, room: id, role: "Project lead", lead: true, provider: "claude", model: "claude-code", effort: null, capUsdMonth: null, status: "active", brief: about || `Leads ${name} from ${folder}.` });
    setDeskFolder({ id: leadId, folder });
    mapFolder({ folder, room: id, desk: leadId });
    recordEvent({ desk: "hr", room: id, action: "hired", summary: `${leadId} leads ${name} as Claude Code in ${folder} (subscription)` }, "hr");
    done.push(`${leadId} leads it as Claude Code in that folder (your subscription)`);
    if (body.firstJob) { job = await addJob({ desk: leadId, text: clip(String(body.firstJob), 2000) }); done.push("its first job is queued: press Push on the campus to start it"); }
  } else if (kind === "hub") {
    request = addRequest(
      {
        kind: "staff",
        room: id,
        deskId: leadId,
        lead: true,
        runner: "hub",
        role: "Project lead",
        why: about || `Lead for the new project "${name}".`,
        needs: "Plans the work, hands steps to staff, reports to the owner.",
        ...(body.firstJob ? { firstJob: clip(String(body.firstJob), 2000) } : {}),
        urgency: "normal",
      },
      ownerId(),
    );
    done.push("asked HR for a lead the hub runs: HR picks the model, then it's yours to approve");
  }
  // the crew: one staff request per role, for HR to staff and the owner to approve
  const crew = team ? crewRequests({ team, size: body.size, room: id, name }).map((q) => addRequest(q, ownerId())) : [];
  if (crew.length) done.push(`asked HR for the ${TEAMS[team].name.toLowerCase()}: ${crew.map((q) => q.role).join(", ")}; each hire is yours to approve`);
  // one page per project in the hub's docs
  try {
    const page = resolvePath(`docs/projects/${id}.md`);
    if (!fs.existsSync(page) && fs.existsSync(path.dirname(page))) {
      fs.writeFileSync(
        page,
        `# ${name}\n\nRoom \`${id}\` in ${OWNER()}'s hub. Added from the campus on ${new Date().toISOString().slice(0, 10)}.\n\n## What it is\n${about || "(not written yet)"}\n\n## Where it lives\n${folder ? `\`${folder}\` on the hub's PC, mapped to desk \`${leadId}\`.` : "No folder yet."}\n\n## Status\n- New.${kind === "code" ? ` Lead: ${leadId} (Claude Code, subscription).` : kind === "hub" ? " Lead: asked for through HR." : " No lead yet."}\n\n## Open items\n- ${kind === "none" ? "Give it a lead." : "First job."}\n\n## Hub rule\nEvery project links into the hub: its own room, sessions and scripts reporting through the Claude Code hook or tools/agent-log.mjs, staff asked for through HR. Every handoff to another AI, session or tool carries this rule (docs/agent-onboarding.md).\n`,
      );
      done.push("added its page to the hub's project docs");
    }
  } catch (err) { console.warn(`Project page for ${id}: ${err.message}`); }
  logEvent("agent roster", { trigger: "button", room: id, change: `project added from the campus (${kind})${madeFolder ? ", folder made" : ""}` });
  return { room: id, name, lead: kind === "code" ? leadId : null, folder, job: job?.id || null, request: request?.id || null, done };
}
// A standing note for a project's team (the owner through HR, 2026-11-09): kept on the room (the last 10), read by its
// hub-run desks with every job, and texted to the room's lead now.
export function addRoomNote(roomId, text, from = "hr") {
  const r = roster(), room = r.rooms.find((x) => x.id === slug(roomId));
  if (!room) throw new Error("Unknown room.");
  const note = { at: new Date().toISOString(), from: clip(from, 40), text: clip(text, 600) };
  room.notes = [...(room.notes || []), note].slice(-10);
  writeJsonAtomic(ROSTER(), r);
  const lead = r.desks.find((d) => d.room === room.id && d.lead && d.status !== "retired");
  if (lead) sendText({ from, to: lead.id, kind: "note", text: note.text });
  recordEvent({ desk: lead?.id || from, room: room.id, action: `note from ${OWNER()}`, summary: note.text.slice(0, 200) }, from);
  return { id: room.id, name: room.name, lead: lead?.id || null };
}
export function setRoom(body = {}) {
  const r = roster();
  const id = slug(body.id);
  const room = r.rooms.find((x) => x.id === id);
  if (!room) throw new Error("Unknown room.");
  if (id === "hr") throw new Error("HR's office can't be paused; set the hr desk to paused instead.");
  const status = body.status === "active" ? "active" : body.status === "paused" ? "paused" : null;
  if (!status) throw new Error("Status must be active or paused.");
  room.status = status;
  room.changedAt = new Date().toISOString();
  let changed = 0;
  for (const d of r.desks) {
    if (d.room !== id) continue;
    if (status === "paused" && d.status === "active") (d.status = "paused"), (d.pausedWithRoom = true), changed++;
    if (status === "active" && d.status === "paused" && d.pausedWithRoom) (d.status = "active"), delete d.pausedWithRoom, changed++;
  }
  writeJsonAtomic(ROSTER(), r);
  logEvent("agent roster", { trigger: "button", room: id, change: status === "active" ? "room started" : "room paused", desks: changed });
  let request = null;
  const hasLead = r.desks.some((d) => d.room === id && d.lead && d.status !== "retired");
  const asked = requests({ open: true }).some((q) => q.room === id && /lead/i.test(q.role));
  if (status === "active" && !hasLead && !asked)
    request = addRequest(
      {
        room: id,
        role: "Project lead",
        why: clip(body.why, 1000) || `${OWNER()} started the ${room.name} project; it needs a lead to plan the work and ask for staff.`,
        urgency: "normal",
      },
      ownerId(),
    );
  return { room: { ...room }, desksChanged: changed, request };
}

// Add or change one desk (the owner, from the page). Unknown fields are dropped.
// Workers reporting under a name that isn't on the roster (and isn't an alias): HR's stray check.
export function strayDesks() {
  const ids = new Set(roster().desks.map((d) => d.id));
  const out = new Map();
  for (const e of readEvents()) {
    if (e.kind !== "agent event" || !e.desk || ids.has(e.desk) || e.desk === "unassigned" || e.room === "unassigned") continue; // temp workers aren't strays
    const s = out.get(e.desk) || { id: e.desk, room: e.room, count: 0, lastAt: null, sample: null };
    s.count++;
    s.lastAt = e.startedAt;
    s.sample = e.summary || e.action || s.sample;
    out.set(e.desk, s);
  }
  return [...out.values()];
}
// A stray that clearly belongs to one desk in its room (one name starts with the other, e.g. another project-pc and
// another project-pc-builder) becomes that desk's alias. Returns the desk id, or null when it isn't clear.
export function aliasStray(stray) {
  const r = roster();
  const s = stray.id;
  const near = r.desks.filter((d) => d.room === stray.room && d.status !== "retired" && (d.id.startsWith(`${s}-`) || s.startsWith(`${d.id}-`)));
  if (near.length !== 1) return null;
  const d = near[0];
  d.aliases = [...new Set([...(d.aliases || []), s])].sort();
  d.changedAt = new Date().toISOString();
  writeJsonAtomic(ROSTER(), r);
  logEvent("agent roster", { trigger: "hr", desk: d.id, room: d.room, change: `alias ${s} added (HR)` });
  return d.id;
}

// Would saving this desk let it spend more real money? (Found 2026-11-14: a desk's cap could be raised without the
// dashboard password.) True when its cap goes up or is removed, when it's switched to a hub-run desk (the hub runs its
// jobs on the API), or when a new hub-run desk is made. Lowering a cap, or any other edit, needs no password.
export function deskChangeSpends(body = {}) {
  const old = roster().desks.find((d) => d.id === slug(body.id));
  const cap = num(body.capUsdMonth);
  const runner = body.runner === undefined ? old?.runner || null : ["hub", "local"].includes(body.runner) ? body.runner : null;
  if (!old) return runner === "hub" || (cap != null && cap > 0);
  if (runner === "hub" && old.runner !== "hub") return true;
  if (old.capUsdMonth != null && (cap == null || cap > old.capUsdMonth)) return true;
  return false;
}
export function saveDesk(body = {}, by = ownerId()) {
  const r = roster();
  const id = slug(body.id || body.role);
  if (!id) throw new Error("A desk needs a name.");
  const room = slug(body.room);
  if (!r.rooms.some((x) => x.id === room)) throw new Error("Pick a room that exists.");
  const provider = PROVIDERS.includes(body.provider) ? body.provider : "other";
  const status = DESK_STATUSES.includes(body.status) ? body.status : "planned";
  const old = r.desks.find((d) => d.id === id);
  const desk = {
    id,
    room,
    role: clip(body.role, 200) || old?.role || id,
    lead: Boolean(body.lead),
    provider,
    model: clip(body.model, 60),
    effort: clip(body.effort, 20),
    capUsdMonth: num(body.capUsdMonth),
    status,
    brief: clip(body.brief, 1000),
    // Floor: the work stream inside the project's building on the campus (e.g. "Leadership", "Gemini workers").
    // Blank puts the desk on the project's main floor.
    floor: body.floor === undefined ? old?.floor || null : clip(body.floor, 40) || null,
    // The side of the office the desk sits on, e.g. which YouTube channel it works for (the owner 2026-11-09).
    // Floors stay split by kind of work; sides split each floor. Blank = the shared middle.
    side: body.side === undefined ? old?.side || null : clip(body.side, 40) || null,
    // runner "hub": the hub itself can run this desk's jobs on the API (Run button). Off unless the owner turns it on.
    // runner "local": a desk that runs in an app on this PC (Antigravity, Claude Code) and picks up its own jobs and
    // hand-offs with agent-log.mjs; "app" says which.
    runner: body.runner === undefined ? old?.runner || null : ["hub", "local"].includes(body.runner) ? body.runner : null,
    app: body.app === undefined ? old?.app || null : clip(body.app, 40),
    // Refusal pass-off (refusal.js): false = a job this desk's provider declines is not passed to another service. Missing = on.
    passOff: body.passOff === undefined ? old?.passOff : body.passOff !== false,
    // Who this desk reports to (the owner 2026-11-09, "so we can realign reports"). Blank = its project's lead.
    reportsTo: body.reportsTo === undefined ? old?.reportsTo || null : slug(body.reportsTo) || null,
    hiredAt: old?.hiredAt || new Date().toISOString(),
    changedAt: new Date().toISOString(),
  };
  // Keep fields this form doesn't edit (e.g. mappedBy), so saving a desk never drops them.
  r.desks = [...r.desks.filter((d) => d.id !== id), { ...(old || {}), ...desk }];
  writeJsonAtomic(ROSTER(), r);
  // brief versions (quality checks): every change to the brief, model, provider or effort is kept, so it can be compared
  // with the scores that followed and rolled back
  try { noteVersion(old, desk, { by, why: clip(body.versionNote, 200) }); } catch (err) { console.warn(`Brief version for ${id}: ${err.message}`); }
  logEvent("agent roster", { trigger: "button", desk: id, room, change: old ? "edited" : "added", status });
  return desk;
}

// Only a desk's monthly cap (the meter wall on the campus, page blocks step 2). saveDesk replaces the whole desk from
// the form, and the campus doesn't have every field (brief, effort, floor), so this changes the cap and nothing else.
// The route asks for the dashboard password when the cap goes up or is removed (deskChangeSpends), as saveDesk's does.
export function setDeskCap(body = {}) {
  const r = roster(), d = r.desks.find((x) => x.id === slug(body.id));
  if (!d) throw new Error("No such desk.");
  const raw = body.capUsdMonth, cap = num(raw);
  if (raw !== "" && raw != null && (cap == null || Number(raw) < 0)) throw new Error("A cap is a number of dollars, 0 or more.");
  if (cap != null && cap > 100000) throw new Error("That cap is more than $100,000 a month. Check the number.");
  const was = d.capUsdMonth ?? null;
  d.capUsdMonth = cap == null ? null : Math.round(cap * 100) / 100;
  d.changedAt = new Date().toISOString();
  writeJsonAtomic(ROSTER(), r);
  logEvent("agent roster", { trigger: "button", desk: d.id, room: d.room, change: "cap", from: was, to: d.capUsdMonth });
  return { id: d.id, capUsdMonth: d.capUsdMonth, was };
}

// Pause or start one worker (Finance's idea for the meter wall, 2026-11-14: "pause the biggest spender"). Only the
// status changes. A paused desk's jobs aren't run by the hub (runJob). Starting a hub-run desk again lets it spend, so
// the route asks for the dashboard password then (deskResumeSpends).
export function setDeskStatus(body = {}) {
  const r = roster(), d = r.desks.find((x) => x.id === slug(body.id));
  if (!d) throw new Error("No such desk.");
  if (d.status === "retired") throw new Error(`${d.id} is retired.`);
  const status = body.status === "paused" ? "paused" : body.status === "active" ? "active" : null;
  if (!status) throw new Error("Status must be paused or active.");
  const was = d.status;
  if (was === status) return { id: d.id, status, was };
  d.status = status;
  delete d.pausedWithRoom;
  d.changedAt = new Date().toISOString();
  writeJsonAtomic(ROSTER(), r);
  logEvent("agent roster", { trigger: "button", desk: d.id, room: d.room, change: status === "paused" ? "desk paused" : "desk started", from: was });
  recordEvent({ desk: "hub", room: d.room, action: status === "paused" ? "paused a worker" : "started a worker", summary: `${d.id} ${status === "paused" ? "paused" : "started again"} from the meter wall` }, ownerId());
  return { id: d.id, status, was };
}
export function deskResumeSpends(body = {}) {
  const d = roster().desks.find((x) => x.id === slug(body.id));
  return Boolean(d && body.status === "active" && d.status !== "active" && d.runner === "hub");
}

// The latest weekly money note from the finance desk (board.js asks for it on Mondays), for the meter wall.
export function latestMoneyNote() {
  const j = jobs().filter((x) => String(x.text || "").startsWith("Weekly money note") && x.status === "done").sort((a, b) => String(b.updatedAt || b.at).localeCompare(String(a.updatedAt || a.at)))[0];
  if (!j) return null;
  let text = j.output || j.summary || "";
  try { text = jobOutput(j.id).text || text; } catch {}
  return { id: j.id, desk: j.desk, at: j.updatedAt || j.at, text: String(text).trim().slice(0, 900) };
}

// A link to the chat or session where a desk actually works (the owner 2026-11-09: "link me the correct chats"), shown
// on its campus card. Only http(s) links; blank clears it.
export function setDeskChat(body = {}) {
  const r = roster(), d = r.desks.find((x) => x.id === slug(body.id));
  if (!d) throw new Error("No such desk.");
  const url = String(body.url || "").trim();
  if (url && !/^https?:\/\/[^\s]{4,300}$/.test(url)) throw new Error("Paste a full link that starts with https://");
  d.chatUrl = url || null; d.changedAt = new Date().toISOString();
  writeJsonAtomic(ROSTER(), r);
  logEvent("agent roster", { trigger: "button", desk: d.id, room: d.room, change: url ? "chat link set" : "chat link cleared" });
  return { id: d.id, chatUrl: d.chatUrl };
}

// ---------- blocker watches ----------
// the owner 2026-11-09: any lead registers a blocker and what would clear it; the hub checks on a schedule (default once
// a day), and when it clears it alerts the owner (phone + to-do, in that lead's room) and tells the lead, then the watch
// closes itself. Check types: github-release (a release of owner/repo whose name, tag or notes match), url-contains
// (a page has some text), file-exists (a path on this PC). Stored as lines in data/agents/blockers.jsonl.
const BLOCKERS = () => path.join(DIR(), "blockers.jsonl");
const CHECK_TYPES = ["github-release", "url-contains", "file-exists"];
// Fold an append-only log into one object per id: the first line with an id makes it (start returns the object, or a
// falsy value to skip a stray line), later lines with that id go to update(object, line). Returns them oldest first.
function foldById(lines, start, update) {
  const byId = new Map();
  for (const l of lines) {
    const cur = byId.get(l.id);
    if (!cur) { const first = start(l); if (first) byId.set(l.id, first); }
    else update(cur, l);
  }
  return [...byId.values()];
}
export function blockerWatches({ open = false } = {}) {
  const list = foldById(readJsonl(BLOCKERS()), (l) => l.what && { ...l, status: "open", lastCheck: null, checks: 0 }, (cur, l) => {
    if (l.checked) Object.assign(cur, { lastCheck: { at: l.at, cleared: !!l.cleared, note: l.note || null }, checks: cur.checks + 1 });
    if (l.closed) Object.assign(cur, { status: l.reason === "cleared" ? "cleared" : "closed", closedAt: l.at, closedBy: l.by || null, reason: l.reason || null });
  }).reverse();
  return open ? list.filter((w) => w.status === "open") : list;
}
function cleanCheck(c = {}, { room = null, desk = null } = {}) {
  const type = String(c.type || "");
  if (!CHECK_TYPES.includes(type)) throw new Error(`Check type must be one of: ${CHECK_TYPES.join(", ")}.`);
  if (type === "github-release") {
    const repo = String(c.repo || "").trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("github-release needs --repo owner/name.");
    const match = clip(c.match, 200);
    if (!match) throw new Error("github-release needs --match (text or a regex the release name, tag or notes must contain).");
    try { new RegExp(match, "i"); } catch { throw new Error("--match isn't a valid pattern."); }
    return { type, repo, match };
  }
  if (type === "url-contains") {
    const url = String(c.url || "");
    if (!/^https?:\/\//.test(url)) throw new Error("url-contains needs --url starting with http(s)://.");
    let host;
    try { host = new URL(url).hostname.replace(/^\[|\]$/g, ""); } catch { throw new Error("url-contains needs a valid link."); }
    // (no DNS here, so adding stays instant; runCheck looks the name up again every time it fetches)
    if (net.isIP(host) ? !isPublicIp(host) : blockedHostName(host)) throw new Error(PRIVATE_NETWORK_MESSAGE);
    const text = clip(c.text || c.match, 200);
    if (!text) throw new Error("url-contains needs --text.");
    return { type, url: url.slice(0, 500), text };
  }
  const p = clip(c.path, 400);
  if (!p) throw new Error("file-exists needs --path.");
  if (p.startsWith("\\\\") || p.startsWith("//")) throw new Error("Network paths can't be checked.");
  if (!path.isAbsolute(p)) throw new Error("file-exists needs a full path (C:\\...).");
  const allowed = [...Object.entries(hookMap()).filter(([, v]) => v?.room === room).map(([k]) => k), desk?.workFolder].filter(Boolean);
  const inside = (dir) => { const rel = path.relative(path.resolve(dir), path.resolve(p)); return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel); };
  if (!allowed.some(inside)) throw new Error("file-exists can only check paths inside this project's folders.");
  return { type, path: path.resolve(p) };
}
export function addBlocker(body = {}) {
  const r = roster(), desk = r.desks.find((d) => d.id === slug(body.desk));
  if (!desk) throw new Error("Unknown desk.");
  const room = slug(body.room) || desk.room;
  if (!r.rooms.some((x) => x.id === room)) throw new Error("Unknown room.");
  const what = clip(body.what, 300);
  if (!what) throw new Error("Say what the blocker is (--what).");
  const check = cleanCheck(body.check || body, { room, desk });
  // Limits (security plan 02): a looping session can't pile up watches.
  const open = blockerWatches({ open: true });
  if (open.filter((w) => w.desk === desk.id).length >= 10) throw new Error(`${desk.id} already has 10 open watches; close one first.`);
  if (open.length >= 50) throw new Error("There are already 50 open watches; close one first.");
  const everyHours = Math.max(1, Math.min(24 * 7, Number(body.everyHours) || 24));
  const w = { id: newId(), at: new Date().toISOString(), desk: desk.id, room, what, check, alert: clip(body.alert, 300) || `Cleared: ${what}`, everyHours };
  appendJsonl(BLOCKERS(), w);
  recordEvent({ desk: desk.id, room, action: "blocker watch", summary: `watching: ${what}` }, desk.id);
  return w;
}
export function closeBlocker({ id, by = ownerId(), reason = "closed" } = {}) {
  const w = blockerWatches({ open: true }).find((x) => x.id === String(id));
  if (!w) throw new Error("No open watch by that id.");
  appendJsonl(BLOCKERS(), { id: w.id, at: new Date().toISOString(), closed: true, by: clip(by, 60), reason });
  return { ...w, status: reason === "cleared" ? "cleared" : "closed" };
}
const CHECK_MAX_BYTES = 2 * 1024 * 1024;
export async function runCheck(c, { fetchImpl = globalThis.fetch, lookup } = {}) {
  if (c.type === "file-exists") {
    if (/^[\\/]{2}/.test(c.path)) return { cleared: false, note: "network paths aren't checked" }; // watches saved before plan 02
    return { cleared: fs.existsSync(c.path), note: fs.existsSync(c.path) ? "file is there" : "not there yet" };
  }
  if (c.type === "url-contains") {
    await checkPublicUrl(c.url, lookup ? { lookup } : {}); // public addresses only, looked up again on every fetch
    const res = await fetchImpl(c.url, { headers: { "User-Agent": `${ownerId()}-hub-blocker-watch` }, redirect: "manual", signal: AbortSignal.timeout(20000) });
    if (res.status >= 300 && res.status < 400) return { cleared: false, note: "the page moved (redirects aren't followed); set the watch on the new address" };
    if (!res.ok) return { cleared: false, note: `page answered ${res.status}` };
    let text = "";
    if (res.body?.getReader) {
      const reader = res.body.getReader(), dec = new TextDecoder();
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > CHECK_MAX_BYTES) { try { await reader.cancel(); } catch {} return { cleared: false, note: "page too big to check" }; }
        text += dec.decode(value, { stream: true });
      }
    } else {
      text = String(await res.text());
      if (Buffer.byteLength(text) > CHECK_MAX_BYTES) return { cleared: false, note: "page too big to check" };
    }
    return { cleared: text.toLowerCase().includes(c.text.toLowerCase()), note: "checked the page" };
  }
  const res = await fetch(`https://api.github.com/repos/${c.repo}/releases?per_page=15`, { headers: { Accept: "application/vnd.github+json", "User-Agent": `${ownerId()}-hub-blocker-watch` }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) return { cleared: false, note: `GitHub answered ${res.status}` };
  const rel = await res.json(), re = new RegExp(c.match, "i");
  const hit = (Array.isArray(rel) ? rel : []).find((x) => !x.draft && re.test(`${x.name || ""}\n${x.tag_name || ""}\n${x.body || ""}`));
  return { cleared: !!hit, note: hit ? `release ${hit.tag_name || hit.name}` : `no release matches yet (latest ${rel?.[0]?.tag_name || "none"})`, url: hit?.html_url };
}
export async function checkBlockers({ force = false, id = null, deps = {} } = {}) {
  const now = Date.now(), done = [];
  for (const w of blockerWatches({ open: true })) {
    if (id && w.id !== id) continue;
    const last = w.lastCheck ? Date.parse(w.lastCheck.at) : 0;
    if (!force && now - last < w.everyHours * 3600e3) continue;
    let out;
    try { out = await runCheck(w.check, deps); } catch (err) { out = { cleared: false, note: `check failed: ${clip(err.message, 120)}` }; }
    appendJsonl(BLOCKERS(), { id: w.id, at: new Date().toISOString(), checked: true, cleared: out.cleared, note: out.note });
    if (out.cleared) {
      const room = roster().rooms.find((x) => x.id === w.room);
      tellOwner({ title: w.alert.slice(0, 200), detail: `${room?.name || w.room}: ${w.what} (${out.note}). Watch set by ${w.desk}.`, source: "blocker watch", category: room?.name || "Agents", link: out.url || "/agents.html", quiet: true,
        alert: { title: `Unblocked: ${room?.name || w.room}`, message: `${w.alert}\n${out.note}`.slice(0, 900), url: out.url } });
      recordEvent({ desk: w.desk, room: w.room, action: "blocker cleared", summary: `${w.what}: ${out.note}` }, "hub");
      appendJsonl(OUTBOX(), { id: w.id, at: new Date().toISOString(), to: w.desk, room: w.room, kind: "blocker", about: w.what, decision: "cleared", note: w.alert });
      closeBlocker({ id: w.id, by: "hub", reason: "cleared" });
    }
    done.push({ id: w.id, ...out });
  }
  return done;
}

// ---------- reporting structure (the org chart) ----------
// the owner owns everything; the pet (CEO, code-drawn, never staffed) chairs; each project's lead reports to the owner through
// the stand-up; every other desk reports to its project's lead unless reportsTo says otherwise (any active desk, no loops).
// realignDesk changes only the reporting fields: the project (room), who it reports to, and whether it leads its project.
// A project has one lead: making a desk lead turns the old lead into staff reporting to the new one.
function reportLoop(desks, id, to) {
  const seen = new Set([id]);
  for (let cur = to; cur; cur = desks.find((d) => d.id === cur)?.reportsTo || null) { if (seen.has(cur)) return true; seen.add(cur); }
  return false;
}
export function realignDesk(body = {}) {
  const r = roster(), d = r.desks.find((x) => x.id === slug(body.id));
  if (!d) throw new Error("No desk by that name.");
  const before = { room: d.room, reportsTo: d.reportsTo || null, lead: !!d.lead };
  if (body.room !== undefined) {
    const room = slug(body.room);
    if (!r.rooms.some((x) => x.id === room)) throw new Error("Pick a project that exists.");
    if (room !== d.room) { d.room = room; d.floor = null; d.side = null; if (body.lead === undefined) d.lead = false; if (body.reportsTo === undefined) d.reportsTo = null; }
  }
  if (body.reportsTo !== undefined) {
    const to = slug(body.reportsTo) || null;
    if (to && !r.desks.some((x) => x.id === to && x.status !== "retired")) throw new Error("They can only report to a desk on the roster.");
    if (to === d.id) throw new Error("A desk can't report to itself.");
    if (to && reportLoop(r.desks, d.id, to)) throw new Error("That would make a reporting loop.");
    d.reportsTo = to;
  }
  if (body.lead !== undefined) {
    d.lead = Boolean(body.lead);
    if (d.lead) { d.reportsTo = null; for (const o of r.desks) if (o !== d && o.room === d.room && o.lead) { o.lead = false; o.reportsTo = d.id; o.changedAt = new Date().toISOString(); } }
  }
  d.changedAt = new Date().toISOString();
  writeJsonAtomic(ROSTER(), r);
  const what = [
    d.room !== before.room && `moved to ${d.room}`,
    (d.reportsTo || null) !== before.reportsTo && `reports to ${d.reportsTo || "its lead"}`,
    d.lead !== before.lead && (d.lead ? "now leads it" : "no longer lead"),
  ]
    .filter(Boolean)
    .join(", ");
  logEvent("agent roster", { trigger: "button", desk: d.id, room: d.room, change: what || "no change" });
  if (what) recordEvent({ desk: d.id, room: d.room, action: "realigned", summary: what }, ownerId());
  return d;
}

// ---------- requests (project leads -> HR -> the owner) ----------
// Latest state of each request: the first line is the request, later lines with the same id are reviews.
// status: "new" (waiting for HR), "recommended" (HR has answered, waiting for the owner), "approved" or "declined".
export function requests({ open = false } = {}) {
  const list = foldById(
    readJsonl(REQUESTS(), { strict: true }),
    // kind "staff" (default) goes through HR; kind "ask" is any other need a lead raises and goes straight to the owner.
    (line) => line.role && { kind: "staff", ...line, status: line.kind === "ask" ? "asked" : line.kind === "borrow" ? "asked" : "new", hr: null, decision: null, history: [] },
    (cur, line) => {
      cur.history.push({ at: line.at, by: line.by, verdict: line.verdict || line.decision, note: line.note || null });
      if (line.by === "hr")
        cur.hr = {
          at: line.at,
          verdict: line.verdict,
          provider: line.provider || null,
          model: line.model || null,
          effort: line.effort || null,
          capUsdMonth: line.capUsdMonth ?? null,
          reuseDesk: line.reuseDesk || null,
          note: line.note || null,
          ...(line.item ? { item: line.item } : {}),
        };
      // A loan is decided by the lending lead (or the owner); other requests by the owner.
      if (line.by === ownerId() || (cur.kind === "borrow" && line.by === cur.ownerLead && line.decision)) cur.decision = { at: line.at, decision: line.decision, note: line.note || null, by: line.by };
      if (line.review) cur.review = line.review; // the code reviewer's read of a merge ask's PR
      if (line.securityReview) cur.securityReview = line.securityReview; // and the security reviewer's
      if (line.returned) cur.returnedAt = line.at;
      if (line.vote) (cur.votes ||= []).push({ by: line.by, vote: line.vote, why: line.why || null, at: line.at });
      if (line.by === "board" && line.decision) cur.decision = { at: line.at, decision: line.decision, note: line.note || null, by: "board" };
      cur.status = cur.decision ? cur.decision.decision : cur.hr ? "recommended" : cur.kind === "ask" || cur.kind === "borrow" ? "asked" : "new";
    },
  ).reverse();
  return open ? list.filter((r) => !r.decision) : list;
}

// One thing for the owner: a to-do (link defaults to the Agents page) and, with `alert`, a phone alert (fire and forget).
// A failing to-do throws unless `quiet`.
export function tellOwner({ title, detail, source, category = "Agents", link = "/agents.html", alert, quiet = false }) {
  try {
    addTodo({ title, detail, source, category, link });
  } catch (err) {
    if (!quiet) throw err;
  }
  if (alert) sendAlert({ kind: "hr", ...alert }).catch(() => {});
}

export function addRequest(body = {}, from = ownerId()) {
  const r = roster();
  const room = slug(body.room);
  if (!r.rooms.some((x) => x.id === room)) throw new Error("Unknown room.");
  const kind = body.kind === "ask" ? "ask" : body.kind === "store" ? "store" : "staff";
  // For an ask, the question goes in "role" so every list shows it the same way; a store idea's item goes there too.
  const item =
    kind === "store" && body.item && typeof body.item === "object"
      ? {
          label: clip(String(body.item.label || "").replace(/^(a|an)\s+/i, ""), 60),
          icon: clip(body.item.icon, 8) || "🎁",
          cat: STORE_CATS.includes(body.item.cat) ? body.item.cat : "desk",
          cost: Math.max(1, Math.min(80, Math.round(Number(body.item.cost) || 10))),
        }
      : null;
  if (kind === "store" && !item?.label) throw new Error("Say what the store should sell.");
  const role = clip(kind === "ask" ? body.question || body.role : kind === "store" ? `Store idea: ${item.icon} ${item.label} (${item.cat}, ${item.cost} credits)` : body.role, 200);
  if (!role) throw new Error(kind === "ask" ? `Say what you need ${OWNER()} to decide.` : "Say what role is needed.");
  const suggested =
    body.suggested && typeof body.suggested === "object"
      ? {
          provider: PROVIDERS.includes(body.suggested.provider) ? body.suggested.provider : null,
          model: clip(body.suggested.model, 60),
          effort: clip(body.suggested.effort, 20),
        }
      : null;
  const req = {
    id: newId(),
    at: new Date().toISOString(),
    kind,
    room,
    from: clip(from, 60),
    role,
    why: clip(body.why, 1000),
    needs: clip(body.needs, 500),
    urgency: URGENCY.includes(body.urgency) ? body.urgency : "normal",
    suggested,
    budgetAsk: num(body.budgetAsk),
    ...(item ? { item } : {}),
  };
  // Hiring details HR can fill in so approving the request hires the desk straight away (the owner 2026-11-09: "in future
  // this needs to work through HR"): the desk's name, floor (work stream), whether it leads, how it runs, and its
  // first job.
  if (kind === "staff") {
    if (body.deskId) req.deskId = slug(body.deskId);
    if (body.floor) req.floor = clip(body.floor, 40);
    if (body.lead) req.lead = true;
    if (["hub", "local"].includes(body.runner)) req.runner = body.runner;
    if (body.firstJob) req.firstJob = clip(body.firstJob, 2000);
  }
  // An ask can name a pull request ("OK to merge #144?"). Approving it sends an OK to merge, declining sends a hold.
  const pr = Number(body.pr);
  if (kind === "ask" && Number.isInteger(pr) && pr > 0 && pr < 1e7) req.pr = pr;
  appendJsonl(REQUESTS(), req);
  logEvent("agent request", { trigger: from === ownerId() ? "button" : "agent", request: req.id, kind, room, from: req.from, role: req.role.slice(0, 80) });
  if (req.pr) reviewPr(req).catch((err) => console.warn(`PR review for #${req.pr}: ${err.message}`)); // in the background
  // An ask skips HR: it goes on the owner's to-do list and to his phone now.
  if (kind === "ask" && from !== ownerId()) {
    tellOwner({ title: `${req.from} asks: ${req.role}`.slice(0, 200), detail: [req.why, "Approve or decline on the Agents page."].filter(Boolean).join(" "), source: "lead ask", quiet: true,
      alert: { title: `${req.from} needs a yes or no`, message: `${req.role}${req.why ? `\n${req.why}` : ""}`.slice(0, 900), url: dashboardLink("/agents.html") } });
  }
  return req;
}

// HR's recommendation (step 4): checks the lead's request against goals, roster and budget, and picks the
// provider, model and effort. A recommendation never changes the roster. Never edits the original line.
export function hrRecommend(id, body = {}) {
  const req = findOpen(id);
  const verdict = VERDICTS.includes(body.verdict) ? body.verdict : null;
  if (!verdict) throw new Error(`Verdict must be one of: ${VERDICTS.join(", ")}.`);
  const line = {
    id,
    at: new Date().toISOString(),
    by: "hr",
    verdict,
    provider: PROVIDERS.includes(body.provider) ? body.provider : null,
    model: clip(body.model, 60),
    effort: clip(body.effort, 20),
    capUsdMonth: num(body.capUsdMonth),
    reuseDesk: verdict === "reuse" ? slug(body.reuseDesk) : null,
    note: clip(body.note, 1000),
    ...(req.kind === "store" && body.item
      ? {
          item: {
            label: clip(body.item.label, 60) || req.item.label,
            icon: clip(body.item.icon, 8) || req.item.icon,
            cat: STORE_CATS.includes(body.item.cat) ? body.item.cat : req.item.cat,
            cost: Math.max(1, Math.min(80, Math.round(Number(body.item.cost) || req.item.cost))),
          },
        }
      : {}),
  };
  appendJsonl(REQUESTS(), line);
  logEvent("agent request", { trigger: "auto", request: id, room: req.room, verdict, by: "hr", model: line.model });
  return line;
}

// the owner's yes or no. Approving a staff request hires its desk (see below).
export async function decideRequest(id, body = {}, by = ownerId()) {
  const req = findOpen(id);
  const decision = DECISIONS.includes(body.decision) ? body.decision : null;
  if (!decision) throw new Error("Decision must be approved or declined.");
  const line = { id, at: new Date().toISOString(), by: by === "board" ? "board" : ownerId(), decision, note: clip(body.note, 1000) };
  // A merge ask from a room linked to an outside inbox (src/hub/extras.js) goes there first, as "OK to merge" or "Hold".
  // If that fails nothing is recorded, so the ask stays open to try again.
  let prSent = null;
  const link = inboxLink(req.room);
  if (req.pr && link?.prDecision) prSent = await link.prDecision(req, decision, line.note);
  appendJsonl(REQUESTS(), line);
  logEvent("agent request", { trigger: "button", request: id, decision, by: ownerId(), ...(req.pr ? { pr: req.pr } : {}) });
  // An approved staff request hires the desk now: HR's suggested provider, model and effort, the budget asked as its
  // monthly cap, and its first job if HR gave one. (Before 2026-11-09 someone had to add the desk by hand.)
  let hired = null;
  // HR's "reuse" verdict names a desk already on the roster: it gets the first job, and nobody new is hired.
  const reuse = req.hr?.verdict === "reuse" && req.hr.reuseDesk && roster().desks.find((d) => d.id === req.hr.reuseDesk && d.status !== "retired");
  if (decision === "approved" && req.kind === "staff" && reuse) {
    try {
      hired = { desk: reuse.id, reused: true };
      if (req.firstJob) await addJob({ desk: reuse.id, text: req.firstJob });
    } catch (err) {
      hired = { error: err.message };
    }
  } else if (decision === "approved" && req.kind === "staff") {
    try {
      hired = await hireFromRequest(by === "board" ? { ...req, budgetAsk: boardHireCap(req) } : req);
    } catch (err) {
      hired = { error: err.message };
    }
  }
  if (by === "board" && hired?.desk) { appendJsonl(BOARD_LOG(), { at: line.at, request: id, desk: hired.desk, cap: boardHireCap(req) }); }
  // A trace in the lending room (the owner 2026-11-14: "we can still lend, just a link or note for trace is needed").
  if (decision === "approved" && req.kind === "borrow") recordEvent({ desk: req.desk, room: req.ownerRoom, action: "lent a worker", summary: loanNote(req) }, by === "board" ? "board" : ownerId());
  let handed = null;
  if (decision === "approved" && req.handoff) { try { handed = await autoHandOff({ ...req.handoff, job: null, approved: true }); } catch (err) { handed = { error: err.message }; } }
  let stocked = null;
  if (decision === "approved" && req.kind === "store") { try { stocked = addStoreItem(req); } catch (err) { stocked = { error: err.message }; } }
  const delivered = await tellLead(req, line, prSent);
  return { ...line, delivered, ...(hired ? { hired } : {}), ...(stocked ? { stocked } : {}), ...(handed ? { handed: handed.id || handed } : {}) };
}

export async function hireFromRequest(req) {
  const r = roster();
  const base = req.deskId || slug(`${req.room}-${req.role}`).slice(0, 40);
  let id = base, n = 2;
  while (r.desks.some((d) => d.id === id)) id = `${base}-${n++}`;
  const s = req.suggested || {};
  const desk = saveDesk({ id, room: req.room, role: req.role, lead: !!req.lead, provider: s.provider || "other", model: s.model || null, effort: s.effort || null,
    capUsdMonth: req.budgetAsk ?? null, status: "active", brief: req.why || null, floor: req.floor || null,
    // API-only providers have no app of their own to work in, so the hub runs them (Hub kit step 2)
    runner: req.runner || (isCompat(s.provider) && !/free|chat|app/i.test(s.model || "") ? "hub" : undefined), versionNote: "hired" }, "hr");
  recordEvent({ desk: "hr", room: "hr", action: "hired", summary: `${id} joined ${req.room}${req.floor ? ` (${req.floor})` : ""} as ${req.role}${req.budgetAsk != null ? `, cap $${req.budgetAsk}/month` : ""}` }, "hr");
  let job = null;
  if (req.firstJob) job = await addJob({ desk: id, text: req.firstJob });
  assistantBrief(desk.id, req).catch((err) => console.warn(`Assistant brief for ${desk.id}: ${err.message}`)); // in the background
  return { desk: desk.id, job: job?.id || null };
}

// ---------- answers back to the lead ----------
// Every decision goes in data/agents/outbox.jsonl, which leads on the PC read with "agent-log.mjs inbox".
// A room linked to an outside inbox (a private part, src/hub/extras.js: a lead that runs in the cloud) gets its answers
// there too.
const OUTBOX = () => path.join(DIR(), "outbox.jsonl");
async function tellLead(req, line, prSent = null) {
  const msg = { id: req.id, at: line.at, to: req.from, room: req.room, kind: req.kind || "staff", about: req.role, decision: line.decision, note: line.note || null, ...(req.pr ? { pr: req.pr } : {}) };
  const via = ["hub inbox"];
  const link = inboxLink(req.room);
  if (prSent) via.push(`${link?.label || "outside inbox"} (${prSent})`);
  else if (link && req.from !== ownerId()) {
    const what = req.kind === "ask" ? req.role : `Staff request: ${req.role}`;
    const err = await toRoomInbox(req.room, {
      kind: "answer",
      ask: `[hub ${req.id}] ${what}`.slice(0, 300),
      choice: line.decision === "approved" ? "ok" : "hold",
      text: line.note || (line.decision === "approved" ? "Approved on the Agents page." : "Declined on the Agents page."),
    });
    if (err === null) via.push(link.label);
    else if (err !== "off") msg.githubError = err;
  }
  msg.via = via;
  appendJsonl(OUTBOX(), msg);
  return { via, ...(msg.githubError ? { githubError: msg.githubError } : {}) };
}

// ---------- jobs (the owner -> a desk) ----------
// the owner hands a desk a job from the campus or the Agents page. data/agents/jobs.jsonl is append-only: a line with
// "text" creates a job, later lines with the same id change its status (taken, done, cancelled) or add the result.
// Claude Code sessions see their desk's open jobs when they start (agent-hook.mjs prints them into the session);
// any agent on the PC can list, take and finish them with agent-log.mjs; another project jobs also go to the lead's GitHub
// inbox so cloud sessions see them; desks marked runner "hub" can be run by the hub itself (runJob).
const JOBS = () => path.join(DIR(), "jobs.jsonl");
// Texts between workers (the owner 2026-11-09, "talk/text each other"): written when one desk hands work to another and
// when it comes back done, so the campus can show each worker's phone. The campus words them in each sender's voice.
const TEXTS = () => path.join(DIR(), "texts.jsonl");
export function sendText({ from, to, kind = "note", text = "", job = null }) {
  if (!from || !to || from === to) return null;
  const t = { at: new Date().toISOString(), from: slug(from), to: slug(to), kind, text: String(text).replace(/\s+/g, " ").slice(0, 240), ...(job ? { job } : {}) };
  try { appendJsonl(TEXTS(), t); } catch {}
  if (["chat", "short"].includes(kind) && t.to !== ownerId() && t.from !== ownerId()) { noteLife(t.from, "chat", `texted ${t.to}: ${t.text}`); noteLife(t.to, "chat", `${t.from} texted: ${t.text}`); }
  // the owner 2026-11-09: "questions back that go to me should go into my queue". A text addressed to the owner also lands
  // in Waiting for you as an ask (once per open question), so it isn't lost in the texts.
  if (t.to === ownerId() && t.from !== ownerId()) {
    try {
      const r = roster(), room = r.desks.find((d) => d.id === t.from)?.room || (r.rooms.some((x) => x.id === t.from) ? t.from : "hub");
      if (!requests({ open: true }).some((q) => q.kind === "ask" && q.from === t.from && q.role === clip(t.text, 200))) addRequest({ kind: "ask", room, question: t.text, why: `${t.from} sent you this (${t.kind}).` }, t.from);
    } catch {}
  }
  return t;
}
// Free-form texts (the owner 2026-11-09, "and go"): every 20 minutes between 8 a.m. and 11 p.m., two workers swap a
// short text pair written by Gemini Flash in their own personalities, about what they're really doing. Pairs who
// handed work to each other lately come first, then workmates, then anyone. Capped at CHATTER_MAX a month (Flash
// costs a fraction of a cent each, so the cap keeps it well under $2); off with AGENTS_CHATTER=off.
const CHATTER_MAX = 800;
// The same traits the campus gives each desk (public/campus/people.js: TRAITS and traitOf), so the voices match.
const TRAIT_NAMES = ["caffeinated", "meticulous", "chatty", "night owl", "zen", "dramatic", "scrappy", "perfectionist"];
const traitOf = (id) => TRAIT_NAMES[[...String(id)].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 7) % TRAIT_NAMES.length];
export async function chatter({ force = false } = {}) {
  if (!helperMay("chatter").ok) return null; // AI helpers off or at today's limit (Admin > AI helpers)
  const hour = hourIn(hubTz());
  if (!force && (hour < 8 || hour >= 23)) return null;
  if (!hasGemini()) return null;
  const month = new Date().toISOString().slice(0, 7), all = texts(5000);
  if (all.filter((m) => m.kind === "chat" && m.at.startsWith(month)).length >= CHATTER_MAX * 2) return null;
  const desks = roster().desks.filter((d) => d.status === "active");
  if (desks.length < 2) return null;
  const pickOne = (xs) => xs[Math.floor(Math.random() * xs.length)];
  const recent = all.filter((m) => m.kind !== "chat" && Date.now() - Date.parse(m.at) < 2 * 86400e3 && desks.some((d) => d.id === m.from) && desks.some((d) => d.id === m.to));
  let a, b;
  const roll = Math.random();
  if (recent.length && roll < 0.5) { const m = pickOne(recent); a = desks.find((d) => d.id === m.from); b = desks.find((d) => d.id === m.to); }
  else if (roll < 0.8) { a = pickOne(desks); b = pickOne(desks.filter((d) => d.room === a.room && d.id !== a.id)) || pickOne(desks.filter((d) => d.id !== a.id)); }
  else { a = pickOne(desks); b = pickOne(desks.filter((d) => d.id !== a.id)); }
  if (!a || !b) return null;
  if (Math.random() < 0.12) {
    const today = dayIn(hubTz()), reqs = requests();
    if (!reqs.some((q) => q.kind === "store" && Date.now() - Date.parse(q.at) < 864e5 && dayIn(hubTz(), Date.parse(q.at)) === today) && reqs.filter((q) => q.kind === "store" && !q.decision).length < 3)
      suggestStoreItem(a, { auto: true }).catch((err) => console.warn(`Store idea: ${err.message}`));
  }
  const ev = readEvents().slice(-400).reverse();
  const doing = (d) => ev.filter((e) => e.desk === d.id && e.summary).slice(0, 3).map((e) => `${e.action}: ${e.summary}`).join(" | ") || "nothing logged lately";
  const rooms = Object.fromEntries(roster().rooms.map((r) => [r.id, r.name]));
  const between = all.filter((m) => (m.from === a.id && m.to === b.id) || (m.from === b.id && m.to === a.id)).slice(-4).map((m) => `${m.from} → ${m.to} (${m.kind}): ${m.text}`).join("\n");
  const who = (d) => `${d.id}: ${d.role || "staff"} in ${rooms[d.room] || d.room}; ${selfLine(d.id)}; lately: ${doing(d)}`;
  const r = await askAs({
    name: "campus_chatter",
    model: "gemini-flash",
    effort: "low",
    system:
      "You write texts between two AI coworkers on a cozy office campus. Keep it warm, playful and short (each under 90 characters), in each one's personality, about their real recent work when there is any. No made-up facts about results, no secrets, no money talk, nothing mean." + petLine(" {name} the {kind} is the {role}; they adore {them}."),
    content: `First texter:\n${who(a)}\nReplier:\n${who(b)}${between ? `\nTheir recent texts:\n${between}` : ""}\nWrite one text from the first, then the reply.`,
    schema: obj({ text: str, reply: str }),
  });
  const t1 = sendText({ from: a.id, to: b.id, kind: "chat", text: r.text });
  const t2 = sendText({ from: b.id, to: a.id, kind: "chat", text: r.reply });
  return [t1, t2];
}
export function texts(limit = 150) {
  return readJsonl(TEXTS()).slice(-limit);
}
const JOB_STATUSES = ["queued", "taken", "done", "cancelled", "failed"];
export function jobs() {
  return foldById(readJsonl(JOBS()), (x) => x.text && { ...x, status: "queued", history: [] }, (j, x) => {
    j.history.push(x);
    if (x.status) j.status = x.status;
    if (x.summary) j.summary = x.summary;
    if (x.output) j.output = x.output;
    if (x.by) j.lastBy = x.by;
    if (x.ack) j.ack = x.at; // the owner dismissed a failed job (error flow)
    if (x.retriedAs) j.retriedAs = x.retriedAs;
    j.updatedAt = x.at;
  }).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
const openJob = (j) => j.status === "queued" || j.status === "taken";
// Hand-offs (the owner 2026-11-09, "get them to work with each other, Claude to Gemini"): a job can name up to three more
// desks in "then". When a step finishes, its result becomes the next desk's job (with the original task on top), and
// a desk the hub runs starts on it straight away (within its cap). Any desk works, any provider, across buildings.
const MAX_THEN = 3;
// Would giving this job start real spending or a GitHub write without anyone pressing Run? (security plan 03)
// A chain step on a hub-run paid desk starts by itself when the step before it is done; a desk whose room is linked to
// an outside inbox (another project) gets the job written to its GitHub inbox; a job for HR starts an HR run.
export function jobSpends(body = {}) {
  const r = roster(), find = (id) => r.desks.find((d) => d.id === slug(id));
  const first = find(body.desk), then = (Array.isArray(body.then) ? body.then : []).map(find).filter(Boolean);
  const paidHub = (d) => d?.runner === "hub" && d.provider !== "local";
  return [first, ...then].some((d) => d && inboxLink(d.room)) || then.some(paidHub) || first?.id === "hr";
}
export async function addJob(body = {}, { chained = null, by = null } = {}) {
  const r = roster();
  const desk = r.desks.find((d) => d.id === slug(body.desk));
  if (!desk) throw new Error("Pick a desk on the roster.");
  // Line breaks kept (a hand-off carries the last desk's Markdown); other control characters dropped.
  const text = body.text == null ? null : String(body.text).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim().slice(0, chained ? 9000 : 2000) || null;
  if (!text) throw new Error("Say what the job is.");
  const then = (Array.isArray(body.then) ? body.then : []).map(slug).filter(Boolean).slice(0, MAX_THEN);
  for (const t of then) if (!r.desks.some((d) => d.id === t && d.status !== "retired")) throw new Error(`${t} isn't a desk on the roster.`);
  const job = { id: newId(), at: new Date().toISOString(), desk: desk.id, room: desk.room, text, by: chained ? "chain" : clip(by, 60) || ownerId(),
    ...(then.length ? { then } : {}),
    ...(chained ? { chain: chained.chain, step: chained.step, of: chained.of, prev: chained.prev, prevDesk: chained.prevDesk, task: chained.task, ...(chained.auto ? { auto: true } : {}) } : then.length ? { step: 1, of: then.length + 1 } : {}) };
  if (!chained && then.length) job.chain = job.id;
  appendJsonl(JOBS(), job);
  if (chained?.prevDesk) sendText({ from: chained.prevDesk, to: desk.id, kind: "handoff", text: chained.task, job: job.id });
  logEvent("agent job", { trigger: "button", job: job.id, desk: desk.id, room: desk.room });
  // On loan, and this job comes from home (the owner or their own project, not the borrowing team): the loan ends now.
  const loan = activeLoans().find((l) => l.desk === desk.id);
  const fromBorrower = chained?.prevDesk && r.desks.find((d) => d.id === chained.prevDesk)?.room === loan?.toRoom;
  if (loan && !fromBorrower) { try { returnLoan({ request: loan.id, by: "home" }); sendText({ from: desk.id, to: loan.by, kind: "note", text: `My project needs me back (new job), so I'm heading home. Thanks for having me!` }); } catch {} }
  // A job for HR ("build a team for X") is planned straight away: HR files the hiring requests itself.
  if (desk.id === "hr" && !chained) import("./hr.js").then((m) => m.runHr({ trigger: "job" })).catch((err) => console.warn(`HR team job: ${err.message}`));
  recordEvent(
    {
      desk: desk.id,
      room: desk.room,
      action: chained ? "job handed over" : "job given",
      summary: chained
        ? `from ${chained.prevDesk} (step ${chained.step} of ${chained.of}): ${chained.task}`.slice(0, 200)
        : `${by || OWNER()}: ${text}`.slice(0, 200),
      provider: desk.provider,
    },
    chained ? "chain" : `${ownerId()}-job`,
  );
  const via = ["hub inbox"];
  let githubError = null;
  if (inboxLink(desk.room) && !chained) {
    const err = await toRoomInbox(desk.room, { kind: "idea", text: `[hub job ${job.id} for ${desk.id}] ${text}`.slice(0, 1000) });
    if (err === null) via.push(inboxLink(desk.room).label);
    else if (err !== "off") githubError = err;
  }
  return { ...job, status: "queued", via, ...(githubError ? { githubError } : {}) };
}
export function findJob(id) {
  const j = isId(id) && jobs().find((x) => x.id === id);
  if (!j) throw new Error("Unknown job.");
  return j;
}
export function updateJob(id, body = {}, by = "agent") {
  const j = findJob(id);
  const status = JOB_STATUSES.includes(body.status) ? body.status : null;
  if (!status) throw new Error(`Status must be one of: ${JOB_STATUSES.join(", ")}.`);
  if (!openJob(j)) throw new Error(`That job is already ${j.status}.`);
  const line = { id, at: new Date().toISOString(), status, by: clip(by, 60), summary: clip(body.summary, 500) };
  // A desk working outside the hub (Antigravity, Claude Code) can hand in its full result with "done"; it's saved like a
  // hub run's output, shown with "Read the result", and goes on to the next desk of a hand-off chain.
  if (status === "done" && body.result != null && String(body.result).trim()) {
    fs.mkdirSync(OUTPUTS(), { recursive: true });
    fs.writeFileSync(path.join(OUTPUTS(), `${id}.md`), `# ${j.desk}: ${String(j.task || j.text).split("\n")[0].slice(0, 120)}\n\n${String(body.result).slice(0, 20000)}\n`);
    line.output = `data/agents/outputs/${id}.md`;
  }
  appendJsonl(JOBS(), line);
  if (status === "done" || status === "failed") recordEvent({ desk: j.desk, room: j.room, action: status === "done" ? "job done" : "job failed", summary: line.summary || j.text.slice(0, 120), job: id }, by);
  if (status === "failed") {
    const lead = roster().desks.find((d) => d.room === j.room && d.lead && d.id !== j.desk);
    if (lead)
      sendText({
        from: j.desk,
        to: lead.id,
        kind: "note",
        text: `My job failed: ${String(j.text).split("\n")[0].slice(0, 80)}. ${line.summary || ""}`.trim(),
      });
  }
  if (status === "done" && j.prevDesk) { sendText({ from: j.desk, to: j.prevDesk, kind: "done", text: line.summary || "", job: id }); tellHander(j, line.summary, id); }
  if (status === "done") handOn({ ...j, ...line }).catch((err) => console.warn(`Hand-off after ${id}: ${err.message}`));
  if (status === "done" || status === "failed") endHandOffLoan(j.desk);
  return { ...j, ...line };
}
// A finished job that another desk handed over goes back to that desk as a note in its inbox, with the result itself
// (the owner 2026-11-11, after a worker's finished work sat on the job while its lead wasn't told). A note, not a new job,
// so nothing can bounce. The result text travels in the note because a lead's own session can't read the hub's data
// folder (leadfence.js). Hub-run desks have no inbox to read; for them the campus texts are enough.
function tellHander(j, summary, id) {
  if (!j?.prevDesk || j.prevDesk === j.desk) return;
  let result = null;
  try { result = fs.readFileSync(path.join(OUTPUTS(), `${id}.md`), "utf8").slice(0, 6000); } catch {}
  try {
    appendJsonl(OUTBOX(), {
      id,
      at: new Date().toISOString(),
      to: j.prevDesk,
      room: roster().desks.find((d) => d.id === j.prevDesk)?.room || j.room,
      kind: "result",
      about: `${j.desk} finished: ${clip(String(j.task || j.text).split("\n")[0], 120)}`,
      decision: "done",
      note: clip(summary, 500) || null,
      ...(result ? { result } : {}),
    });
  } catch (err) { console.warn(`Result back to ${j.prevDesk}: ${err.message}`); }
}
// The error flow (the owner 2026-11-09: "we have going, waiting and asking; we don't have an error flow"). A failed job
// shows under Problems on the campus with its reason until the owner retries it (same desk or another), or dismisses it.
// The project's lead hears about failures (updateJob).
export async function retryJob(id, { desk = null } = {}) {
  const j = findJob(id);
  if (j.status !== "failed") throw new Error("Only a failed job can be retried.");
  const to = slug(desk) || j.desk;
  const nj = await addJob({ desk: to, text: j.text });
  appendJsonl(JOBS(), { id, at: new Date().toISOString(), by: ownerId(), retriedAs: nj.id, ack: true });
  recordEvent({ desk: to, room: nj.room, action: "job retried", summary: `${to === j.desk ? "retry" : `given to ${to} after ${j.desk} failed`}: ${String(j.text).split("\n")[0]}`.slice(0, 200) }, ownerId());
  return { from: id, job: nj.id, desk: to };
}
export function dismissJob(id) {
  const j = findJob(id);
  appendJsonl(JOBS(), { id, at: new Date().toISOString(), by: ownerId(), ack: true });
  return { id, dismissed: true };
}
// Automatic hand-offs (the owner 2026-11-09, "can they pass off automatically"): a desk passes its work on by itself,
// from a hub run (the "handoff" in its answer) or a session on the PC (agent-log.mjs handoff). Guardrails: at most
// AUTO_MAX automatic hand-offs per chain and CHAIN_MAX steps in all; never to itself or straight back to the desk that
// just handed it over (no ping-pong); only to active desks; never on top of a chain the owner set (that goes on as set);
// caps still apply when the hub runs the next desk. Each one shows on the campus and in the job's history.
const AUTO_MAX = 4, CHAIN_MAX = 8;
// ---------- the owner's auto-run limit (security plan 04) ----------
// A paid run started by a worker's own output counts here; past the owner's daily number the job waits in
// "Waiting for you" (Run now). Local-model desks cost nothing and don't count. perDay null = no limit.
const AUTORUN = () => path.join(DIR(), "autorun.jsonl");
// "Today" is the hub's day (midnight in its time zone), like the helpers' limit; it used to be the UTC day (S4).
export function autoRunsToday(now = new Date()) {
  const start = dayStartMs(now.getTime()), end = dayStartMs(start + 30 * 3600e3); // the next midnight
  return readJsonl(AUTORUN()).filter((x) => { const t = Date.parse(x.at); return t >= start && t < end; }).length;
}
// lim: the owner's daily number (null = no limit; missing = 0, the safe default). HUB_AUTORUN_PER_DAY in the
// environment wins ("none" = no limit), so tests never depend on this PC's settings files.
const autoRunLimit = () => {
  const e = process.env.HUB_AUTORUN_PER_DAY;
  if (e !== undefined) return e === "none" ? null : Number(e) || 0;
  return hubSettings().agents?.autoRun?.perDay;
};
export function mayAutoRun(desk, now = new Date(), lim = autoRunLimit()) {
  if (!desk || desk.runner !== "hub") return false;
  if (!helperMay("autorun", now).ok) return false; // AI helpers off or at today's limit: nothing starts by itself, local desks too
  if (desk.provider === "local") return true;
  if (lim === null) return true;
  return autoRunsToday(now) < (Number(lim) || 0);
}
// Runs the job when the limit allows and returns runJob's promise (errors already caught); returns null when it waits.
function autoRun(jobId, desk, origin) {
  const gap = desk?.runner === "hub" ? deskPriceGap(desk) : null;
  if (gap) {
    recordEvent({ desk: desk.id, room: desk.room, action: "waiting to run", summary: clip(`${origin}: no price set for its model; waiting`, 200), job: jobId }, "hub");
    return null;
  }
  if (!mayAutoRun(desk)) {
    const helpers = helperMay("autorun");
    recordEvent({ desk: desk.id, room: desk.room, action: "waiting to run", summary: clip(helpers.ok ? `${origin}: over today's auto-run limit; waiting for Run now` : `${origin}: ${helperWhy(helpers)}; waiting for Run now`, 200), job: jobId }, "hub");
    return null;
  }
  if (desk.provider !== "local") appendJsonl(AUTORUN(), { at: new Date().toISOString(), job: jobId, desk: desk.id, origin });
  return runJob(jobId).catch((err) => console.warn(`${origin} run ${jobId}: ${err.message}`));
}
// The files a hand-off named (agent-log.mjs sends them). A worker the hub runs can't open files on the PC, so it gets
// their text in the job; a worker on the PC just gets the list. Files too big to send are named, with what to do.
function attached(files, target) {
  const list = (Array.isArray(files) ? files : []).filter((f) => f && typeof f.name === "string").slice(0, 8);
  if (!list.length) return { line: "", text: "" };
  if (target.runner !== "hub") return { line: `\nFiles it names (on this PC): ${list.map((f) => f.name).join(", ")}`, text: "" };
  let room = 120000;
  const parts = list.map((f) => {
    if (f.skipped || typeof f.text !== "string") return `--- ${f.name}: not sent (${f.skipped || "no text"}). You can't open files on the PC; if you need it, say so in your answer so a worker who can read it does that part.`;
    const t = f.text.slice(0, room); room -= t.length;
    return `--- ${f.name}${t.length < f.text.length ? " (cut short)" : ""}\n${t}`;
  });
  return { line: `\nFiles sent with this hand-off: ${list.map((f) => f.name).join(", ")} (their text comes with the job).`, text: `Files sent with this hand-off (you can't open files on the PC, so their text is here):\n${parts.join("\n")}` };
}
const JOB_FILES = (id) => path.join(DIR(), "outputs", `${id}-files.md`);
function jobFiles(id) { try { return fs.readFileSync(JOB_FILES(id), "utf8"); } catch { return ""; } }
export async function autoHandOff({ from, job: jobId, to, text, result = null, approved = false, files = [] } = {}) {
  const r = roster();
  const fromDesk = r.desks.find((d) => d.id === slug(from));
  if (!fromDesk) throw new Error("Say which desk is handing it on (--desk).");
  const target = r.desks.find((d) => d.id === slug(to));
  if (!target || target.status !== "active") throw new Error(`${slug(to) || "That desk"} isn't an active desk on the roster.`);
  if (target.id === fromDesk.id) throw new Error("A desk can't hand work to itself.");
  const task = String(text || "").trim();
  if (!task) throw new Error("Say what the next desk should do.");
  const all = jobs();
  const j = jobId ? all.find((x) => x.id === jobId) : null;
  if (jobId && !j) throw new Error("Unknown job.");
  if (j && j.desk !== fromDesk.id) throw new Error(`Job ${j.id} belongs to ${j.desk}, not ${fromDesk.id}.`);
  if (j?.then?.length) throw new Error(`${OWNER()} set where this job goes next (${j.then.join(" → ")}); it goes on by itself when it's done.`);
  if (j && target.id === j.prevDesk)
    throw new Error(
      `${target.id} gave you this job, so it can't go straight back as a new job (that's how two desks end up passing one job back and forth). The job ends with you: your result goes to ${target.id} as a note. If something is still needed, say so in your result or ask ${OWNER()}.`,
    );
  const chain = j?.chain || j?.id || null;
  const inChain = chain ? all.filter((x) => x.chain === chain || x.id === chain) : [];
  if (inChain.filter((x) => x.auto).length >= AUTO_MAX) throw new Error(`This chain already has ${AUTO_MAX} automatic hand-offs. Finish it, or ask ${OWNER()} to set the next step.`);
  if (inChain.length >= CHAIN_MAX) throw new Error(`This chain is ${CHAIN_MAX} steps long already. Finish it and report back.`);
  // Into another project (the owner 2026-11-09: R&D's chain landed on another project builder without anyone saying yes): it
  // becomes a loan ask instead. The board (or that project's lead, or the owner) approves it, and only then the job lands.
  if (!approved && target.room !== fromDesk.room) {
    const req = fileLoan({
      from: fromDesk,
      desk: target,
      hours: 2,
      role: `Hand-off to ${target.id} (${target.room})`,
      why: clip(task, 500),
      handoff: { from: fromDesk.id, job: jobId || null, to: target.id, text: task.slice(0, 2000), result: result ? String(result).slice(0, 6000) : null },
    });
    const owner = req.ownerLead;
    if (j && openJob(j)) { appendJsonl(JOBS(), { id: j.id, at: req.at, status: "done", by: clip(fromDesk.id, 60), summary: clip(`Asked to hand on to ${target.id} (${target.room}); waiting for their OK`, 500) }); }
    recordEvent({ desk: fromDesk.id, room: fromDesk.room, action: "hand-off asked", summary: `wants ${target.id} (${target.room}) for: ${task}`.slice(0, 200) }, fromDesk.id);
    if (owner) sendText({ from: fromDesk.id, to: owner, kind: "note", text: `Could ${target.id} take a step of my work? ${task}`.slice(0, 240) });
    return { asked: req.id, desk: target.id, room: target.room, waitingOn: owner || ownerId() };
  }
  // The job being passed on is finished by this hand-off (unless it already is).
  if (j && openJob(j)) {
    const line = { id: j.id, at: new Date().toISOString(), status: "done", by: clip(fromDesk.id, 60), summary: clip(`Handed on to ${target.id}: ${task}`, 500) };
    appendJsonl(JOBS(), line);
    recordEvent({ desk: fromDesk.id, room: fromDesk.room, action: "job done", summary: line.summary, job: j.id }, fromDesk.id);
  }
  const step = (j?.step || 1) + 1;
  const original = j?.task || (j ? j.text.split("\n")[0] : null);
  const att = attached(files, target);
  const body = [`Step ${step} of a chain, handed to you by ${fromDesk.id} (automatic hand-off).`, original ? `The original task: ${original}` : "", `What ${fromDesk.id} wants from you: ${task}`,
    result ? `\nTheir result so far:\n${String(result).slice(0, 7000)}` : "", att.line, "", "When you're done, report back (done), or hand it on if someone else should finish it."].filter((x) => x !== null).join("\n");
  const next = await addJob({ desk: target.id, text: body }, { chained: { chain: chain || newId(), step, of: step, prev: j?.id || null, prevDesk: fromDesk.id, task: (original || task).slice(0, 300), auto: true } });
  if (att.text) { fs.mkdirSync(path.dirname(JOB_FILES(next.id)), { recursive: true }); fs.writeFileSync(JOB_FILES(next.id), att.text); }
  if (target.runner === "hub") autoRun(next.id, target, "auto hand-off");
  return next;
}
// The next step of a chain: the next desk gets the original task, what the last desk did, and its result.
async function handOn(j, outputText = null) {
  if (!j.then?.length) return null;
  const [nextDesk, ...rest] = j.then;
  const task = j.task || j.text;
  let result = outputText;
  if (result == null && j.output) {
    try {
      if (/^data\/agents\/outputs\/[a-f0-9]{10}\.md$/.test(j.output)) result = fs.readFileSync(resolvePath(j.output), "utf8");
    } catch {}
  }
  const step = (j.step || 1) + 1, of = j.of || step + rest.length;
  const text = [`Step ${step} of ${of} of a hand-off chain from ${OWNER()}.`, `The task: ${task}`, "", `${j.desk} did step ${step - 1}. Their summary: ${j.summary || "(none)"}`,
    result ? `\nTheir result:\n${String(result).slice(0, 7000)}` : "", "", rest.length ? `When you're done, your result goes on to ${rest.join(", then ")}.` : `Yours is the last step: your result goes back to ${OWNER()}.`].join("\n");
  const next = await addJob({ desk: nextDesk, text, then: rest }, { chained: { chain: j.chain || j.id, step, of, prev: j.id, prevDesk: j.desk, task: task.slice(0, 300) } });
  // A desk the hub runs starts on it now; the rest see it at their next session (or via agent-log.mjs jobs).
  const d = roster().desks.find((x) => x.id === nextDesk);
  if (d?.runner === "hub") runJob(next.id).catch((err) => console.warn(`Hand-off run ${next.id}: ${err.message}`));
  return next;
}
// What a desk (or a whole room) still has to do.
export function openJobs({ desk, room } = {}) {
  return jobs().filter((j) => openJob(j) && (!desk || j.desk === desk) && (!room || j.room === room)).reverse();
}

// The hub runs a job itself, for desks marked runner "hub": the desk's model and effort, its role and brief as the
// instructions, the job as the request. It refuses without a cap, or when the desk's API spend has reached it.
// The answer is saved in data/agents/outputs/<job>.md and on the job; the cost is logged as an AI call on the desk.
// Which model a hub-run desk's call goes to (pure; callers handle missing keys, caps and status). One rule everywhere
// (the owner 2026-11-13): Claude names as they are; compat providers on their own model name; Gemini desks (including the
// "Argon" names on the roster) by the model name: a numbered Gemini model as named, a name that says pro gets Pro, one
// that says flash or lite gets Flash, and only when the name doesn't say ("argon" or blank) does effort decide (low
// effort Flash, else Pro). A call that asks for the stronger model (strong) always gets Pro.
export function deskRoute(desk, { strong = false } = {}) {
  const m = String(desk.model || ""), compat = isCompat(desk.provider);
  const gem = !compat && (desk.provider === "gemini" || /gemini|argon/i.test(m));
  const flash = "gemini-flash", pro = "gemini-pro";
  const pick = strong ? pro
    : /^gemini-\d/.test(m) && !/argon/i.test(m) ? m
    : /pro/i.test(m) ? pro
    : /flash|lite/i.test(m) ? flash
    : desk.effort === "low" ? flash : pro;
  const model = compat ? m : gem ? pick : /^(claude-|haiku$|sonnet$|opus$)/.test(m) ? m : undefined;
  return { m, compat, gem, model };
}
const OUTPUTS = () => path.join(DIR(), "outputs");
const REFUSALS = () => path.join(DIR(), "refusals.jsonl");
const refusalRows = () => { try { return readJsonl(REFUSALS()); } catch { return []; } };
// A paid model the hub can't price can't be run by it (money safety B1, 2026-11-16): its calls would book $0 and the
// desk's cap would never trip. null when priced (or local, which is free), else what to add.
export function priceGapFor(provider, model) {
  if (provider === "local") return null;
  if (isCompat(provider)) return compatPriceGap(provider, model);
  const m = !model ? config.model : CLAUDE_ALIAS[model] || model; // gemini-flash / gemini-pro are priced as Gemini
  if (costOf(m, {}) !== null) return null;
  return `No price is set for model "${m}", so the hub can't count what it spends and its cap would never trip. Add "prices": { "${m}": { "in": <US$ per million input tokens>, "out": <US$ per million output tokens> } } to data/ai.json, then run it again.`;
}
export const deskPriceGap = (desk) => (desk.provider === "local" ? null : priceGapFor(deskRoute(desk).compat ? desk.provider : deskRoute(desk).gem ? "gemini" : "claude", deskRoute(desk).model));
// One hub run per desk at a time (money safety F2, 2026-11-16): a second job for the same desk waits until the first
// has finished and its cost is on the ledger, then checks the cap itself. Different desks still run side by side.
const deskTurns = new Map();
function inDeskTurn(deskId, fn) {
  const key = String(deskId || "");
  const run = (deskTurns.get(key) || Promise.resolve()).then(fn);
  const settled = run.then(() => {}, () => {});
  deskTurns.set(key, settled);
  settled.then(() => { if (deskTurns.get(key) === settled) deskTurns.delete(key); });
  return run;
}
export async function runJob(id, opts = {}) {
  if (isDemo()) throw new Error(DEMO_MESSAGE); // demo mode: the sample hub runs nothing (tools/demo.mjs)
  return inDeskTurn(findJob(id)?.desk, () => runJobNow(id, opts));
}
async function runJobNow(id, { ask = askAs } = {}) {
  const j = findJob(id);
  if (!openJob(j)) throw new Error(`That job is already ${j.status}.`);
  const desk = roster().desks.find((d) => d.id === j.desk);
  if (!desk) throw new Error("That desk is no longer on the roster.");
  if (desk.status === "paused") throw new Error(`${desk.id} is paused. Start it again from its card or the meter wall first.`);
  if (desk.runner !== "hub") throw new Error(`The hub doesn't run ${desk.id}. Turn on "The hub runs this desk" on its desk card first.`);
  // local models cost nothing, so they need no cap (Hub kit step 2)
  if (desk.capUsdMonth == null && desk.provider !== "local") throw new Error(`${desk.id} needs a monthly cap before the hub runs it.`);
  const spent = monthSpend()[desk.id]?.usd || 0;
  if (desk.provider !== "local" && spent >= desk.capUsdMonth) throw new Error(`${desk.id} has used its $${desk.capUsdMonth} cap this month ($${spent.toFixed(2)}).`);
  const gap = deskPriceGap(desk);
  if (gap) throw new Error(`The hub can't run ${desk.id}. ${gap}`);
  if (isCompat(desk.provider) && providerConfig(desk.provider).refused) throw new Error(`The hub can't run ${desk.id}. ${providerConfig(desk.provider).refused}`);
  updateJob(id, { status: "taken", summary: "The hub is running it" }, "hub");
  // The desk's model as the hub can call it: Claude names as they are; Gemini desks (including the "Argon" names on
  // the roster) on the newest Gemini Pro or Flash the hub's key can use; anything else on the hub's default model.
  const { m, compat, gem, model } = deskRoute(desk);
  if (compat && !compatReady(desk.provider)) {
    const c = providerConfig(desk.provider);
    updateJob(id, { status: "failed", summary: `No ${c.label} key: add ${c.keyEnv} to the hub's .env` }, "hub");
    throw new Error(`The hub has no ${c.label} key. Add ${c.keyEnv} to its .env and restart it.`);
  }
  if (gem && !hasGemini()) {
    updateJob(id, { status: "failed", summary: "No Gemini key: add GEMINI_API_KEY to the hub's .env" }, "hub");
    throw new Error("The hub has no Gemini key. Add GEMINI_API_KEY to its .env (free tier is fine) and restart it.");
  }
  // the finance desk gets the live spend numbers with every job (agents/board.js)
  const money = await import("./agents/board.js").then((b) => b.financeContext(desk)).catch(() => "");
  const asked = deskAsk(desk, j), system = asked.system;
  try {
    // A lead (or a lane lead people report to) can give its own team jobs in the same answer (the owner 2026-11-09: the R&D
    // lead could only reach one desk by hand-off). Up to TEAM_ASSIGN_MAX, only its own team; theirs run next.
    const team = teamOf(desk);
    const sysText =
      team.length
        ? `${system}\nYou lead a team: ${team.map((d) => `${d.id} (${String(d.role || "").slice(0, 60)})`).join("; ")}. To give them work, put up to ${TEAM_DIRECT} jobs (more only if truly needed; the board approves extras) in assign (one desk each, only these desks, a clear self-contained task); leave it empty if they don't need any.`
        : system;
    const content = `${asked.content}${money ? `\n\n${money}` : ""}${asked.docs}`;
    const schema = obj({
      summary: str,
      output: str,
      followups: arr(str),
      questions_for_owner: arr(str),
      handoff_to: str,
      handoff_task: str,
      ...(team.length ? { assign: arr(obj({ desk: str, task: str })) } : {}),
    });
    // Refusal pass-off (src/pipeline/refusal.js): a provider that declines (its own filter, not an error) is tagged and the
    // job goes once to the next service that hasn't tried it; serious reasons, "every service declined", the switches
    // and the cap stop it and put the job in Waiting for you. Any other error behaves as before.
    const own = compat ? desk.provider : gem ? "gemini" : "claude";
    const tried = new Set([own]), history = [];
    let route = { provider: compat ? desk.provider : undefined, model, label: own };
    let sendContent = content;
    let a;
    for (;;) {
      try {
        a = await ask({ name: `desk_${desk.id}`, model: route.model, provider: route.provider, effort: desk.effort || "medium", system: sysText, content: sendContent, schema });
        break;
      } catch (err) {
        if (!(err instanceof ProviderRefusal)) throw err;
        const hop = { provider: err.provider || route.label, model: err.model || route.model || "default model", reason: err.reason };
        const serious = isSerious(hop.reason);
        history.push(hop);
        tried.add(route.label);
        tried.add(hop.provider);
        try { appendJsonl(REFUSALS(), { at: new Date().toISOString(), job: id, desk: desk.id, room: desk.room, provider: hop.provider, model: hop.model, reason: hop.reason, serious }); } catch (e) { console.warn(`Refusal log: ${e.message}`); }
        recordEvent({ desk: desk.id, room: desk.room, action: "provider refused", summary: `${hop.provider} (${hop.model}) declined: ${hop.reason}`, job: id }, "hub");
        let stop = null, next = null;
        if (serious) stop = "the reason names a serious category, so it was not passed on";
        else if (!passOffSettings().on || desk.passOff === false) stop = "pass-off is off";
        else if (desk.provider !== "local" && (monthSpend()[desk.id]?.usd || 0) >= desk.capUsdMonth) stop = "the desk is at its cap";
        else if (!(next = nextRoute(desk, tried, { desks: roster().desks }))) stop = "every allowed service declined";
        else if (priceGapFor(next.provider, next.model)) stop = `the next service (${next.provider}) has no price set, so the hub can't run it`;
        if (stop) {
          const names = history.map((h) => h.provider).join(", ");
          const lines = history.map((h) => `- ${h.provider} (${h.model}): ${h.reason}`);
          updateJob(id, { status: "failed", summary: `Refused by ${names}: needs you` }, "hub");
          fs.mkdirSync(OUTPUTS(), { recursive: true });
          fs.writeFileSync(path.join(OUTPUTS(), `${id}.md`), `# ${desk.id}: ${j.text.split("\n")[0].slice(0, 120)}\n\nThis job was declined, so it did not run.\n\n${lines.join("\n")}\n\nWhy it stopped: ${stop}.\n`);
          appendJsonl(JOBS(), { id, at: new Date().toISOString(), by: "hub", output: `data/agents/outputs/${id}.md` });
          try {
            addRequest({ kind: "ask", room: desk.room, question: `${desk.id} job refused by ${names}: "${clip(j.text.split("\n")[0], 80)}"`, why: `${history.map((h) => `${h.provider} (${h.model}): ${h.reason}`).join("; ")}. ${stop[0].toUpperCase()}${stop.slice(1)}. You can change the brief, run it on a named provider, or drop it. Job ${id}.` }, desk.id);
          } catch (e) { console.warn(`Refusal ask for ${desk.id}: ${e.message}`); }
          recordEvent({ desk: desk.id, room: desk.room, action: "refusal stopped", summary: `refused by ${names}; ${stop}`, job: id }, "hub");
          err.jobHandled = true;
          throw err;
        }
        recordEvent({ desk: desk.id, room: desk.room, action: "passed on", summary: `${hop.provider} declined; trying ${next.provider}`, job: id }, "hub");
        const note = history.map((h, i) => (i === 0 ? `this job was declined by ${h.provider} (${h.model}), which gave this reason: "${h.reason}".` : `It was also declined by ${h.provider} (${h.model}): "${h.reason}".`)).join(" ");
        sendContent = `Note from the hub: ${note} Do the job only if it is fine under your own rules; if it is not, decline too.\n\n${content}`;
        route = { provider: isCompat(next.provider) ? next.provider : undefined, model: next.model, label: next.provider };
      }
    }
    const refusedNote = history.length ? ` (answered by ${route.label} after ${history.length} refusal${history.length === 1 ? "" : "s"})` : "";
    fs.mkdirSync(OUTPUTS(), { recursive: true });
    const file = path.join(OUTPUTS(), `${id}.md`);
    fs.writeFileSync(file, `# ${desk.id}: ${j.text.split("\n")[0].slice(0, 120)}\n\n${a.output}\n${a.followups?.length ? `\n## Follow-ups\n${a.followups.map((f) => `- ${f}`).join("\n")}\n` : ""}`);
    const line = { id, at: new Date().toISOString(), status: "done", by: "hub", summary: clip(a.summary, 500), output: `data/agents/outputs/${id}.md` };
    appendJsonl(JOBS(), line);
    recordEvent({ desk: desk.id, room: desk.room, action: "job done", summary: line.summary + refusedNote, provider: desk.provider, billing: "api", job: id }, "hub");
    tellHander(j, line.summary, id);
    endHandOffLoan(desk.id);
    // the owner 2026-11-09 (a raid-recap result "blocked on input" sat in the job output): what a worker needs from the owner
    // goes into Waiting for you as one ask, with the job and its output linked.
    const qs = (a.questions_for_owner || []).map((x) => clip(String(x), 300)).filter(Boolean).slice(0, 5);
    if (qs.length)
      try {
        addRequest(
          {
            kind: "ask",
            room: desk.room,
            question: qs.length === 1 ? qs[0] : `${desk.id} needs ${qs.length} things to finish "${clip(j.text.split("\n")[0], 80)}"`,
            why: `${qs.length > 1 ? qs.map((x, i) => `${i + 1}. ${x}`).join(" ") + " " : ""}From job ${id}; the output is in data/agents/outputs/${id}.md. Answer here and the reply goes back to ${desk.id}.`,
          },
          desk.id,
        );
      } catch (err) {
        console.warn(`Questions from ${desk.id}: ${err.message}`);
      }
    let next = await handOn({ ...j, ...line }, a.output).catch((err) => (console.warn(`Hand-off after ${id}: ${err.message}`), null));
    if (!next && a.handoff_to && a.handoff_task) {
      // The job is already done above, so this only adds the next step.
      next = await autoHandOff({ from: desk.id, job: id, to: a.handoff_to, text: a.handoff_task, result: a.output }).catch((err) => {
        recordEvent({ desk: desk.id, room: desk.room, action: "hand-off refused", summary: clip(err.message, 200) }, "hub");
        return null;
      });
    }
    const assigned = [];
    const spendOf = assignSpend();
    for (const x of (a.assign || []).slice(0, TEAM_ASSIGN_MAX)) {
      const to = team.find((d) => d.id === slug(x.desk));
      if (!to || !x.task || assigned.some((y) => y.desk === to.id)) continue;
      // past TEAM_DIRECT, the board approves an extra brief only when that desk has a fifth of its cap left
      if (assigned.length >= TEAM_DIRECT && !(to.capUsdMonth == null || (spendOf[to.id] || 0) < to.capUsdMonth * 0.8)) { recordEvent({ desk: "hr", room: desk.room, action: "board held", summary: `brief for ${to.id} held: near its monthly cap` }, "board"); continue; }
      try {
        const nj = await addJob({ desk: to.id, text: `From ${desk.id} (your lead): ${x.task}` }, { by: desk.id });
        assigned.push({ desk: to.id, job: nj.id, hub: to.runner === "hub" && to.capUsdMonth != null });
      } catch (err) {
        console.warn(`Assign ${to.id}: ${err.message}`);
      }
    }
    if (assigned.length) {
      sendText({ from: desk.id, to: desk.id, kind: "note", text: `Gave ${assigned.map((x) => x.desk).join(", ")} their jobs.` });
      // the hub runs its own desks' new jobs one after another, within their caps
      (async () => { for (const x of assigned.filter((y) => y.hub)) { const d = roster().desks.find((z) => z.id === x.desk); const p = autoRun(x.job, d, `assigned by ${desk.id}`); if (p) await p; } })();
    }
    return { ...j, ...line, followups: a.followups || [], ...(next ? { handedTo: next.desk } : {}), ...(assigned.length ? { assigned: assigned.map((x) => x.desk) } : {}) };
  } catch (err) {
    if (!err.jobHandled) updateJob(id, { status: "failed", summary: String(err.message).slice(0, 300) }, "hub");
    throw err;
  }
}
// What a hub-run desk is asked for a job: its system prompt, the job, and the project pages (runJob adds the finance
// numbers and a lead's team line). Quality checks (agents/quality.js) re-run past jobs through this same prompt with a
// candidate model or brief in `desk`, so the comparison is like for like.
export function deskAsk(desk, j) {
  const room = roster().rooms.find((x) => x.id === desk.room);
  const system = [
    `You are "${desk.id}", a staff member in ${OWNER()}'s ${room?.name || desk.room} project, working from their hub.`,
    desk.role ? `Your role: ${desk.role}` : "",
    desk.brief ? `Your brief: ${desk.brief}` : "",
    room?.notes?.length
      ? `Standing notes from ${OWNER()} for this project (follow them):\n${room.notes.map((n) => `- ${n.text}`).join("\n")}`
      : "",
    `${OWNER()} has given you a job. You can't browse, run code or change files, but their project pages come with the job (after the ---), so use them instead of saying you can't see them. Answer with your best finished work as Markdown, a one-line summary, and any follow-ups they should know about. If the job needs something you don't have, say exactly what in the follow-ups.`,
    (() => {
      const can = whoCan(roster().desks, desk.id);
      return can.length
        ? `Workers who can run things on the PC (hand a step that needs it to one of them, and say in your summary that you did): ${can.join("; ")}`
        : "";
    })(),
    hubRunRules(),
    // Automatic hand-off: only when another desk is clearly better placed for the next step.
    `If you're blocked on something only ${OWNER()} can give (files, logs, access, a decision), put each thing you need as a short question in questions_for_owner (it goes straight to their queue); otherwise leave it empty.`,
    j.then?.length
      ? `Your result goes on to ${j.then.join(", then ")} automatically, so leave handoff_to empty.`
      : `If another desk should do the next step (for example: research done, now build; or built, now check), put its id in handoff_to and what it should do in handoff_task; otherwise leave both empty. Don't hand it back to ${j.prevDesk || "the desk that gave it to you"}. Desks: ${r_desks(desk.id)}`,
  ]
    .filter(Boolean)
    .join("\n");
  const content = `${j.chain ? "Job (part of a hand-off chain)" : `Job from ${OWNER()}`}:\n${j.text}${jobFiles(j.id) ? `\n\n${jobFiles(j.id)}` : ""}`;
  const docs = `\n\n---\n${OWNER()}'s project pages, for context (current as of this job; you can't open other files):\n${deskDocs(desk, j.text)}`;
  return { system, content, docs };
}
// The project pages a hub-run desk reads with its job (the owner 2026-11-09, "this is a common theme": desks kept saying
// they couldn't open docs/projects). Always the project list and its own room's page; every project page for the
// cross-project rooms (R&D, HR, Hub); and any project the job names. About 30k characters at most.
function deskDocs(desk, text) {
  const dir = resolvePath("docs/projects"), read = (f) => { try { return fs.readFileSync(path.join(dir, f), "utf8").trim(); } catch { return ""; } };
  let pages = [];
  try { pages = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md"); } catch { return ""; }
  const rooms = roster().rooms, low = String(text || "").toLowerCase();
  const named = (f) => { const id = f.slice(0, -3), r = rooms.find((x) => x.id === id); return low.includes(id) || (r?.name && low.includes(r.name.toLowerCase())); };
  const wide = ["rnd", "hr", "hub"].includes(desk.room);
  const pick = [`${desk.room}.md`, ...pages.filter((f) => f !== `${desk.room}.md` && (wide || named(f)))].filter((f) => pages.includes(f));
  let out = `## docs/projects/README.md\n${read("README.md")}\n`;
  for (const f of pick) { const t = read(f); if (!t) continue; if (out.length + t.length > 30000) { out += `\n(${f} and others left out for length)\n`; break; } out += `\n## docs/projects/${f}\n${t}\n`; }
  return out.slice(0, 31000);
}
const assignSpend = () => Object.fromEntries(agentsOverview().desks.map((d) => [d.id, d.monthUsd || 0]));
// A desk's own team: everyone in its project (for a lead) plus anyone who reports to it, active, not itself.
const TEAM_DIRECT = 8, TEAM_ASSIGN_MAX = 12; // over TEAM_DIRECT the board approves each extra one (cap room left)
function teamOf(desk) {
  const ds = roster().desks.filter((d) => d.status === "active" && d.id !== desk.id);
  return ds.filter((d) => d.reportsTo === desk.id || (desk.lead && d.room === desk.room && !d.lead && (!d.reportsTo || d.reportsTo === desk.id || !ds.some((x) => x.id === d.reportsTo))));
}
// The desks a hub-run desk may hand work to, one short line each.
function r_desks(self) {
  return roster().desks.filter((d) => d.status === "active" && d.id !== self).map((d) => `${d.id} (${d.room}, ${d.provider || "?"}${d.role ? `: ${String(d.role).slice(0, 60)}` : ""})`).join("; ");
}
export function jobOutput(id) {
  if (!isId(id)) throw new Error("Unknown job.");
  try {
    return { id, text: fs.readFileSync(path.join(OUTPUTS(), `${id}.md`), "utf8") };
  } catch {
    throw new Error("No saved output for that job.");
  }
}

// A lead's answers: everything decided on its requests (or for its room), newest first.
export function inbox({ desk, room, limit = 20 } = {}) {
  const lines = readJsonl(OUTBOX());
  const d = slug(desk), r = slug(room);
  // Loan asks waiting for this lead's answer come first.
  const asks = requests({ open: true })
    .filter((q) => q.kind === "borrow" && ((d && q.ownerLead === d) || (r && q.ownerRoom === r)))
    .map((q) => ({
      id: q.id,
      at: q.at,
      to: q.ownerLead,
      room: q.ownerRoom,
      kind: "loan ask",
      about: `${q.from} (${q.room}) wants to borrow ${q.desk} for ${q.hours} h: ${q.why || q.role}`,
      decision: "waiting for you",
      note: `answer: agent-log.mjs lend --desk ${q.ownerLead} --request ${q.id} --decision approved|declined`,
    }));
  return [...asks, ...lines.filter((m) => (d && m.to === d) || (r && m.room === r)).reverse()].slice(0, Math.min(100, Number(limit) || 20));
}

function findOpen(id) {
  if (!isId(id)) throw new Error("Unknown request.");
  const req = requests().find((r) => r.id === id);
  if (!req) throw new Error("Unknown request.");
  if (req.decision) throw new Error(`Already ${req.decision.decision}.`);
  return req;
}

// ---------- lending workers (the owner 2026-11-09: "ask leads to borrow workers if they don't need them, and the lead
// approves") ----------
// A lead asks to borrow a desk from another project for up to a day. The lending project's lead answers from its own
// inbox; after 3 hours the ask shows in the owner's inbox too (that reminder is client side: public/campus/core.js:202 and
// public/agents.html:184, nothing to build here). While the loan runs, the worker sits at a visitor desk in the borrowing
// project's building and takes its jobs. One loan per worker at a time; a worker with open jobs from its own project
// can't be lent. Credits it earns stay its own.
const LOAN_MAX_HOURS = 24;
export function activeLoans(now = Date.now()) {
  return requests().filter((q) => q.kind === "borrow" && q.decision?.decision === "approved" && !q.returnedAt && now < Date.parse(q.decision.at) + q.hours * 3600e3)
    .map((q) => ({ id: q.id, desk: q.desk, fromRoom: q.ownerRoom, toRoom: q.room, by: q.from, lentBy: q.decision.by, until: new Date(Date.parse(q.decision.at) + q.hours * 3600e3).toISOString(), why: q.why || q.role, ...(q.handoff ? { handoff: true } : {}) }));
}
// One line saying who has the worker and why, for the lending room's Recent list.
export function loanNote(q) { return clip(`${q.desk} to ${q.room} for ${q.hours} h (asked by ${q.from}): ${q.why || q.role}`, 300); }
// The page's loans, each with the job it was lent for (the borrower's first job for that desk since the loan began), so
// the home room can link to the work.
export function loansWithJobs() {
  const all = jobs();
  return activeLoans().map((l) => {
    const start = requests().find((q) => q.id === l.id)?.decision?.at || "";
    const j = all.find((x) => x.desk === l.desk && x.at >= start);
    return j ? { ...l, job: { id: j.id, status: j.status, summary: j.summary || null, output: j.output || null } } : l;
  });
}
// A hand-off loan is for one step of work (the owner 2026-11-14: Finance's room showed "No desks yet" for hours after its
// lead had already answered the hub's questions): once the lent desk has no open jobs left, it goes home. Loans asked for
// with askLoan keep their hours, since the borrower may give more than one job.
function endHandOffLoan(deskId) {
  const loan = activeLoans().find((l) => l.desk === deskId && l.handoff);
  if (!loan || openJobs({ desk: deskId }).length) return null;
  try { return returnLoan({ request: loan.id, by: "hub" }); } catch { return null; }
}
// File a borrow request: desk `from` wants worker `desk` for `hours`; the lead of that worker's project is asked.
function fileLoan({ from, desk, hours, role, why, handoff }) {
  const ownerLead = roster().desks.find((d) => d.room === desk.room && d.lead && d.status !== "retired" && d.id !== desk.id)?.id || null;
  const req = { id: newId(), at: new Date().toISOString(), kind: "borrow", room: from.room, from: from.id, role, why, desk: desk.id, ownerRoom: desk.room, ownerLead, hours, urgency: "normal", ...(handoff ? { handoff } : {}) };
  appendJsonl(REQUESTS(), req);
  return req;
}
export function askLoan(body = {}, from = "agent") {
  const r = roster(), lead = r.desks.find((d) => d.id === slug(from));
  if (!lead?.lead) throw new Error("Only a project lead can ask to borrow a worker.");
  const desk = r.desks.find((d) => d.id === slug(body.desk) && d.status === "active");
  if (!desk) throw new Error("No active desk by that name (agent-log.mjs desks lists them).");
  if (desk.room === lead.room) throw new Error(`${desk.id} is already on your team.`);
  if (desk.lead) throw new Error("Leads can't be lent; ask for one of their workers.");
  if (activeLoans().some((l) => l.desk === desk.id) || requests({ open: true }).some((q) => q.kind === "borrow" && q.desk === desk.id)) throw new Error(`${desk.id} is already on loan or asked for.`);
  if (openJobs({ desk: desk.id }).some((j) => j.room === desk.room)) throw new Error(`${desk.id} is busy with its own project's jobs right now.`);
  const hours = Math.max(1, Math.min(LOAN_MAX_HOURS, Math.round(Number(body.hours) || 4)));
  const req = fileLoan({ from: lead, desk, hours, role: `Borrow ${desk.id} for ${hours} h`, why: clip(body.why, 500) });
  recordEvent({ desk: lead.id, room: lead.room, action: "loan asked", summary: `asked ${req.ownerLead || `${OWNER()}`} to borrow ${desk.id} for ${hours} h` }, lead.id);
  sendText({ from: lead.id, to: req.ownerLead || desk.id, kind: "note", text: `Could I borrow ${desk.id} for ${hours} h? ${req.why || ""}`.trim() });
  return req;
}
// ---------- last real work, and the end of the staff life cycle ----------
// The overview shows when each desk last did real work: any event except chores, Shorts, votes and the like. No date is
// older than WORK_FLOOR.
const QUIET = new Set(["chore", "watched a Short", "rated a job", "scored jobs", "quality check", `note from ${OWNER()}`, "board vote", "board objection", "back from loan"]);
const WORK_FLOOR = "2026-11-10T00:00:00Z";
export function lastWorkAt(r = roster()) {
  const out = {};
  for (const e of readEvents()) if (e.kind === "agent event" && e.desk && !QUIET.has(e.action) && (!out[e.desk] || e.startedAt > out[e.desk])) out[e.desk] = e.startedAt;
  for (const d of r.desks) for (const t of [d.hiredAt, WORK_FLOOR]) if (t && (!out[d.id] || t > out[d.id])) out[d.id] = t;
  return out;
}
// The bench and the Retirement apartments are gone (2026-11-12). Run once at start-up: a desk they left marked (life
// "bench" or "apartment", cap at $0, status retired) goes back to its old cap and to active. With none marked it does nothing.
export function restoreStaff() {
  const r = roster(), back = r.desks.filter((d) => d.life); // life, lifeAt and capBeforeBench were always set and cleared together
  for (const d of back) {
    if (d.capBeforeBench != null) d.capUsdMonth = d.capBeforeBench;
    if (d.life === "apartment") d.status = "active";
    delete d.life; delete d.lifeAt; delete d.capBeforeBench;
    d.changedAt = new Date().toISOString();
  }
  if (!back.length) return [];
  writeJsonAtomic(ROSTER(), r);
  for (const d of back) recordEvent({ desk: d.id, room: d.room, action: "back to work", summary: "the bench and the Retirement apartments are gone: back at its old cap" }, "hr");
  return back.map((d) => d.id);
}

// ---------- events ----------
// Live view (2026-11-11, an idea from the lot-map plugin, written for the hub): what a working session is doing right
// now, as stations. Built from the tool steps the Claude Code hook already posts (tool name and file name only), over
// the last LIVE_MS. Each station: how many steps, when the last one was, how many failed. Plus how full the session's
// context was at its last reply. Nothing new is collected except "failed" (yes/no) and that context size.
const LIVE_MS = 10 * 60000;
const STATION = { Read: "files", Edit: "files", Write: "files", MultiEdit: "files", NotebookEdit: "files", Glob: "files", Grep: "files", LS: "files",
  Bash: "shell", BashOutput: "shell", KillShell: "shell", WebFetch: "web", WebSearch: "web", Task: "agents", Agent: "agents", TodoWrite: "plan", ExitPlanMode: "plan" };
// Other tools name theirs differently: matched by what the name says.
export const stationOf = (tool) => {
  const t = String(tool || "");
  return (
    STATION[t] ||
    (/^mcp__/.test(t)
      ? "tools"
      : /shell|exec|bash|powershell|terminal|command/i.test(t)
        ? "shell"
        : /patch|edit|write|read|view|file|grep|glob|search_files|str_replace/i.test(t)
          ? "files"
          : /web|fetch|browse|search/i.test(t)
            ? "web"
            : /plan|todo/i.test(t)
              ? "plan"
              : /agent|task/i.test(t)
                ? "agents"
                : "other")
  );
};
export function liveView(rows, now = Date.now()) {
  const out = {};
  for (const x of rows) {
    if (x.kind !== "agent event" || !x.desk) continue;
    const at = Date.parse(x.startedAt), age = now - at;
    if (!(age >= 0)) continue;
    if (x.action === "turn done" && x.contextTokens && age < 6 * 3600e3) { const l = (out[x.desk] ??= { stations: {} }); if (!l.contextAt || at > l.contextAt) { l.contextAt = at; l.contextTokens = x.contextTokens; l.model = x.model || null; } }
    if (age > LIVE_MS) continue;
    const l = (out[x.desk] ??= { stations: {} });
    if (x.action === "subagent done") { const s = (l.stations.agents ??= { n: 0, failed: 0, at: 0 }); s.n++; s.at = Math.max(s.at, at); }
    if (x.action !== "tool") continue;
    const s = (l.stations[stationOf(x.tool)] ??= { n: 0, failed: 0, at: 0 });
    s.n++; if (x.failed) s.failed++;
    if (at >= s.at) { s.at = at; s.last = x.summary || x.tool || null; }
    if (!l.at || at > l.at) { l.at = at; l.tool = x.tool; }
  }
  for (const [id, l] of Object.entries(out)) {
    if (!Object.keys(l.stations).length && !l.contextTokens) { delete out[id]; continue; }
    for (const s of Object.values(l.stations)) s.at = new Date(s.at).toISOString();
    if (l.at) l.at = new Date(l.at).toISOString();
    if (l.contextAt) l.contextAt = new Date(l.contextAt).toISOString();
  }
  return out;
}
// Brain view (the owner 2026-11-11: "a zoom in mode like we're going in their brain ... if it gave a text feed as well to
// track"): one worker's recent steps, newest last, for the live map and its text feed. `since` (an ISO time) returns
// only newer steps, so the page can ask every couple of seconds. Same metadata as everywhere else: tool and file
// names, summaries the hub already keeps; never prompts or command text.
export function deskLive(deskId, since = null) {
  const id = slug(deskId), r = roster(), d = r.desks.find((x) => x.id === id);
  if (!d) throw new Error("No such desk.");
  if (!ring) ring = readEvents().slice(-RING_MAX);
  // The worker's latest work-on-your-own or pushed session (the owner 2026-11-11: Pesto's view said "no steps" an hour after
  // his session, with no sign it had been cut off). With no "since", the feed starts at that session if it's newer
  // than a day, so its steps show however long ago it ran.
  const sess = autonomyStatus().find((a) => a.desk === id) || null;
  const sessFrom = sess && Date.now() - Date.parse(sess.startedAt) < 864e5 ? Date.parse(sess.startedAt) - 1000 : null;
  const from = since && !Number.isNaN(Date.parse(since)) ? Date.parse(since) : Math.min(Date.now() - 30 * 60000, sessFrom ?? Infinity);
  // the in-memory ring keeps the newest events; an older session is read from the events file
  const pool = ring.length && Date.parse(ring[0].startedAt) > from ? readEvents() : ring;
  const W = jobWindows(jobs().filter((j) => j.desk === id));
  const steps = pool.filter((x) => x.kind === "agent event" && x.desk === id && Date.parse(x.startedAt) > from).slice(-120).map((x) => ({
    job: jobOf(W, id, Date.parse(x.startedAt)), ...(x.agent ? { agent: x.agent, agentType: x.agentType || null } : {}), ...(x.note ? { note: x.note } : {}),
    at: x.startedAt, action: x.action, tool: x.tool || null, summary: x.summary || null, failed: x.failed === true,
    station: x.action === "tool" ? stationOf(x.tool) : x.action === "subagent done" ? "agents" : /job|hand-?off|review|report/.test(String(x.action)) ? "jobs" : x.action === "turn done" ? "core" : x.action === "session start" ? "core" : "other",
    ...(x.contextTokens ? { contextTokens: x.contextTokens } : {}), ...(x.model ? { model: x.model } : {}),
  }));
  const ctx = [...ring].reverse().find((x) => x.desk === id && x.contextTokens);
  const job = jobs().filter((j) => j.desk === id && ["taken", "queued"].includes(j.status)).sort((a, b) => String(b.updatedAt || b.at).localeCompare(String(a.updatedAt || a.at)))[0];
  return { desk: id, room: d.room, provider: d.provider, model: d.model, runner: d.runner || null, now: new Date().toISOString(), steps,
    contextTokens: ctx?.contextTokens || null, contextAt: ctx?.startedAt || null,
    job: job ? { id: job.id, status: job.status, text: clip(String(job.text).split("\n")[0], 160) } : null,
    session: sess ? { status: sess.status, live: sess.live, startedAt: sess.startedAt, endedAt: sess.endedAt || null, until: sess.until, last: sess.last || null } : null,
    reports: d.provider === "claude" && /claude-code|opus|sonnet|fable|haiku|thread/i.test(String(d.model || "")) && d.runner !== "hub" ? "steps" : d.runner === "hub" ? "jobs" : "pasted" };
}
// Neural view (the owner 2026-11-14, docs/handoffs/neural-view.md): the tree of work for a job (its chain of hand-offs and
// retries, and under each job its desk's sessions, replies, tool calls and sub-agents). With only a desk, follows that
// desk's current or latest job, or shows its sessions of the last 12 hours.
export function jobTrace({ job = null, desk = null } = {}) {
  const d = desk ? slug(desk) : null;
  if (!job && !d) throw new Error("Say which job or desk.");
  if (d && !roster().desks.some((x) => x.id === d)) throw new Error("No such desk.");
  return buildTrace({ jobs: jobs(), events: readEvents(), job: job ? String(job).slice(0, 40) : null, desk: d, stationOf });
}
// Neural view's web (the owner 2026-11-14: "webs to trace between and show inter agent connections"): every desk-to-desk
// link in the last `days` (1 to 30): work handed on, results back, notes; campus chat too with social.
export function agentWeb({ days = 7, social = false } = {}) {
  const d = Math.min(30, Math.max(1, Math.round(Number(days)) || 7));
  return buildWeb({ jobs: jobs(), texts: readJsonl(TEXTS()), desks: roster().desks, days: d, social: Boolean(social) });
}
const idOf = (v) => (v == null ? null : String(v).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || null);
// What an agent did. Metadata only: no prompts, file contents or keys. Long text is cut to 200 characters.
export const trustedSources = () => ["hub", "board", ownerId(), `${ownerId()}-job`, "chain", "week", "manual"];
const POSTED_COST_MAX = 5;
const POSTED_DAY_CAPS = 3; // a desk's reported cost in one hub day: at most this many times its monthly cap
const ceilingNoted = new Map(); // desk -> the day start it was last noted for
function notePostedCeiling(desk) {
  const start = dayStartMs();
  if (ceilingNoted.get(desk.id) === start) return;
  ceilingNoted.set(desk.id, start);
  if (readEvents().slice(-400).some((e) => e.action === "cost ignored" && e.desk === desk.id && Date.parse(e.startedAt) >= start)) return;
  recordEvent({ desk: desk.id, room: desk.room, action: "cost ignored", summary: `reported cost ignored: over the daily ceiling ($${POSTED_DAY_CAPS * desk.capUsdMonth} a day, ${POSTED_DAY_CAPS}x its monthly cap)` }, "hub");
}
export function recordEvent(body = {}, source = "manual") {
  const desk = slug(body.desk);
  const r = roster();
  const known = r.desks.find((d) => d.id === desk);
  const usage = {
    inputTokens: num(body.inputTokens),
    outputTokens: num(body.outputTokens),
    cacheReadTokens: num(body.cacheReadTokens),
    cacheWriteTokens: num(body.cacheWriteTokens),
  };
  const model = clip(body.model, 60) || known?.model || null;
  let costUsd = num(body.costUsd);
  if (costUsd == null && model && (usage.inputTokens || usage.outputTokens)) costUsd = costOf(model, usage);
  // A cost a session posts counts against the caps (honest hooks report real spend), but one post can add at most $5,
  // so a made-up number can't push a desk over its cap in one go (security plan 07). The hub's own sources aren't clipped.
  const costClipped = costUsd != null && costUsd > POSTED_COST_MAX && !trustedSources().includes(source);
  if (costClipped) costUsd = POSTED_COST_MAX;
  // A daily ceiling on what sessions report for one desk (money safety S1, 2026-11-16): at most 3x the desk's monthly
  // cap in a hub day. Past it the event is kept with cost 0, and one event a day says so. Subscription use doesn't
  // count toward caps, so it has no ceiling; nor does a desk with no cap.
  const posted = costUsd != null && costUsd > 0 && !trustedSources().includes(source);
  const billingOf = ["api", "subscription"].includes(body.billing) ? body.billing : null;
  let costIgnored = false;
  if (posted && billingOf !== "subscription" && known?.capUsdMonth != null) {
    const ceiling = POSTED_DAY_CAPS * known.capUsdMonth;
    const today = spendSince(dayStartMs()).filter((x) => x.posted && x.desk === known.id && x.billing !== "subscription").reduce((t, x) => t + (Number(x.costUsd) || 0), 0);
    if (today + costUsd > ceiling) {
      costIgnored = true;
      costUsd = 0;
      notePostedCeiling(known);
    }
  }
  const entry = {
    trigger: "agent",
    source: clip(source, 30),
    desk: desk || "unassigned",
    room: slug(body.room) || known?.room || null,
    action: clip(body.action, 40) || "note",
    tool: clip(body.tool, 60),
    summary: clip(body.summary, 200),
    provider: PROVIDERS.includes(body.provider) ? body.provider : known?.provider || null,
    model,
    effort: clip(body.effort, 20),
    // "api" is real money; "subscription" (Claude Code on Max, Gemini on Pro) is what it would have cost on the API.
    billing: ["api", "subscription"].includes(body.billing) ? body.billing : null,
    ...Object.fromEntries(Object.entries(usage).filter(([, v]) => v != null)),
    ...(costUsd != null ? { costUsd } : {}),
    ...(costClipped ? { costClipped: true } : {}),
    ...(posted ? { posted: true } : {}),
    ...(costIgnored ? { costIgnored: true } : {}),
    // Only sent for sessions in a folder that isn't in hook-map.json yet, so it can be mapped to a project.
    ...(body.folder && (slug(body.room) || "unassigned") === "unassigned" ? { folder: clip(body.folder, 300) } : {}),
    // for the live view (liveView): a tool step that failed, and how full the session's context was at its last reply
    ...(body.failed === true ? { failed: true } : {}),
    ...(num(body.contextTokens) > 0 ? { contextTokens: Math.round(num(body.contextTokens)) } : {}),
    // work done for another project without a loan (the owner 2026-11-13: the hub's security reviewer on another project PRs)
    ...(slug(body.forRoom) && slug(body.forRoom) !== (slug(body.room) || known?.room) ? { forRoom: slug(body.forRoom) } : {}),
    // for the Neural view (trace.js): which session and which sub-agent a step came from. Ids only, never content.
    ...(idOf(body.session) ? { session: idOf(body.session) } : {}),
    // what an edit did, in a few words (tools/agent-hook.mjs via editnote.js): counts and section names, never the text
    ...(body.action === "tool" && clip(body.note, 120) ? { note: clip(body.note, 120) } : {}),
    ...(idOf(body.agent) ? { agent: idOf(body.agent) } : {}),
    // which job a "job done" was (quality checks: pay follows that job's score)
    ...(isId(body.job) ? { job: body.job } : {}),
    ...(body.agent && clip(body.agentType, 40) ? { agentType: clip(body.agentType, 40) } : {}),
  };
  const now = new Date().toISOString();
  const row = { kind: "agent event", startedAt: now, ...entry };
  appendSpend(row);
  appendEvent(row);
  // what happened to them, for their growing personality (agents/selves.js)
  const LIFE_KIND = { "watched a Short": "short", "surfed the web": "web", "job done": "work" };
  if (LIFE_KIND[entry.action] && entry.summary) noteLife(entry.desk, LIFE_KIND[entry.action], entry.action === "job done" ? `finished a job: ${entry.summary}` : entry.summary);
  return row;
}

// ---------- pasted "Hub log:" lines ----------
// Chats that can't reach the hub (claude.ai, Cowork in the cloud, phone, Grok, Gemini web) end with a line like
//   Hub log: hub-builder (Opus 5.5) built the campus layout
// the owner pastes a batch on the Agents page. Each line becomes an event on that desk (its room from the roster, or the
// room picked on the page). The model in brackets is kept; the rest is the summary. Lines without "Hub log:" are skipped.
export function importHubLog(text = "", fallbackRoom = null) {
  const r = roster();
  const out = [];
  const skipped = [];
  for (const raw of String(text).split(/\r?\n/).slice(0, 200)) {
    const m = /hub log:\s*(.+)$/i.exec(raw.trim());
    if (!m) continue;
    let rest = m[1].trim();
    const desk = slug(rest.split(/\s+/)[0]);
    rest = rest.slice(rest.split(/\s+/)[0].length).trim();
    let model = null;
    const mm = /^\(([^)]{1,60})\)\s*/.exec(rest);
    if (mm) {
      model = mm[1].trim();
      rest = rest.slice(mm[0].length);
    }
    const known = r.desks.find((d) => d.id === desk);
    const room = known?.room || slug(fallbackRoom);
    if (!desk || !rest || !room) {
      skipped.push(raw.trim().slice(0, 80));
      continue;
    }
    const provider = known?.provider || (/gemini|argon/i.test(model || "") ? "gemini" : /grok/i.test(model || "") ? "grok" : /claude|opus|sonnet|haiku|fable/i.test(model || "") ? "claude" : null);
    out.push(recordEvent({ desk, room, provider, model, action: "hub log", summary: rest, billing: "subscription" }, "pasted"));
  }
  return { logged: out.length, skipped, events: out };
}

// The API credit the hub tracks (credits.js: balance typed in on the AI page, minus logged spend). Agent events billed
// "api" aren't in that sum, so they're taken off here too.
function creditLeft() {
  try {
    const c = creditStatus().providers;
    const since = c.claude?.set?.at;
    const agentApi = since ? readEvents().filter((e) => e.billing === "api" && (e.provider || "claude") === "claude" && e.startedAt > since).reduce((a, e) => a + (e.costUsd || 0), 0) : 0;
    return {
      claude: c.claude?.set ? { left: Math.round((c.claude.left - agentApi) * 100) / 100, balance: c.claude.set.balance, setAt: since, perDay: c.claude.perDay } : null,
      gemini: c.gemini?.set ? { left: c.gemini.left, balance: c.gemini.set.balance, setAt: c.gemini.set.at, perDay: c.gemini.perDay } : null,
    };
  } catch {
    return null;
  }
}

// ---------- the week, for the Sunday summary (digest.js) ----------
export function weekSummary() {
  const cut = new Date(Date.now() - 7 * 864e5).toISOString();
  const ev = readEvents().filter((e) => e.startedAt > cut);
  const byRoom = {};
  let api = 0, sub = 0;
  for (const e of ev) {
    byRoom[e.room || "unassigned"] = (byRoom[e.room || "unassigned"] || 0) + 1;
    if (e.billing === "api") api += e.costUsd || 0;
    else sub += e.costUsd || 0;
  }
  const r = roster();
  const name = (id) => r.rooms.find((x) => x.id === id)?.name || id;
  const top = Object.entries(byRoom).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => `${name(id)} ${n}`);
  const all = requests();
  const waiting = all.filter((q) => !q.decision);
  const decided = all.filter((q) => q.decision && q.decision.at > cut).length;
  const lines = [];
  if (ev.length) lines.push(`Agents: ${ev.length} events (busiest: ${top.join(", ")})${api ? `; US$${api.toFixed(2)} API` : ""}${sub ? `; US$${sub.toFixed(2)} of subscription use` : ""}`);
  if (waiting.length) lines.push(`Waiting on you: ${waiting.length} (${waiting.filter((q) => q.kind === "ask").length} asks, ${waiting.filter((q) => q.kind !== "ask").length} staff requests)`);
  if (decided) lines.push(`You answered ${decided} request${decided === 1 ? "" : "s"} this week`);
  const over = agentsOverview().desks.filter((d) => d.overCap);
  if (over.length) lines.push(`Over cap: ${over.map((d) => d.id).join(", ")}`);
  return lines;
}

// ---------- page data ----------
export function agentsOverview() {
  const r = roster();
  // the wallets, worked out once for the page and the Residences; the homes first, so a move made now is in this feed
  const ws = wallets(), homes = homesState(r, ws); // the Residences: who lives where, and the last move each (agents/campus.js)
  const spend = monthSpend();
  const lastWork = lastWorkAt(r), live = liveView(readEvents());
  const desks = r.desks.map((d) => {
    const s = spend[d.id] || { events: 0, usd: 0, subUsd: 0 };
    // monthUsd: real API spend (what the cap is checked against). monthSubUsd: subscription use priced as if on the API.
    return { ...d, lastWorkAt: lastWork[d.id] || null, ...(live[d.id] ? { live: live[d.id] } : {}), monthEvents: s.events, monthUsd: s.usd, monthSubUsd: s.subUsd, overCap: d.capUsdMonth != null && s.usd > d.capUsdMonth };
  });
  return {
    rooms: r.rooms.map((x) => ({ ...x, district: districtOf(x), status: roomStatus(x, r.desks), link: roomLink(x.id, r.desks) })),
    districts: DISTRICTS,
    desks,
    unassignedMonth: Object.fromEntries(Object.entries(spend).filter(([k]) => !r.desks.some((d) => d.id === k))),
    feed: [...readEvents().slice(-50), ...readRuns({ kinds: ["agent request", "agent roster", "agent home"], limit: 50 })].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, 50),
    // the same feed in blocks, one per worker per job, for the campus's Full feed (trace.js feedGroups)
    jobFeed: feedGroups(readEvents().slice(-600), jobs(), { stationOf }),
    requests: (() => { const r2 = roster(), bb = boardBudget(r2); return requests().slice(0, 50).map((q) => { const b = boardView(q, r2, bb); return b ? { ...q, board: b } : q; }); })(),
    board: { ...BOARD, ...boardBudget() },
    finance: { ...financeView(r, desks, Object.fromEntries(Object.entries(spend).filter(([k]) => !r.desks.some((d) => d.id === k)))), plan: (() => { try { return planNow(); } catch (err) { console.warn(`Plan meter: ${err.message}`); return null; } })() },
    texts: texts(),
    loans: loansWithJobs(),
    blockers: blockerWatches().filter((w) => w.status === "open" || Date.now() - Date.parse(w.closedAt || w.at) < 3 * 86400e3).slice(0, 50),
    credit: creditLeft(),
    tokenReady: fs.existsSync(TOKEN()),
    hook: hookHealth(),
    roomStats: roomStats(),
    relay: relayStatus,
    unmapped: unmappedFolders(),
    localRunner: localRunnerStatus(),
    autonomy: autonomyStatus(),
    week: weekStatus(),
    prReviews: prReviews(),
    refusals: refusalStats(refusalRows()),
    grants: grantList().map((g) => ({ ...g, users: r.desks.filter((d) => d.status !== "retired" && (d.grants || []).includes(g.id)).map((d) => d.id) })),
    wallets: ws,
    homes,
    perks: PERKS,
    watched: watched(60),
    surfed: surfed(30),
    selves: selvesForPage(),
    store: storeSpend(),
    ratings: jobRatings(),
    quality: qualitySummary(),
    shortOfWeek: shortOfWeek(),
    standup: { last: meetings(1)[0] || null, next: nextStandup(), times: STANDUP_TIMES.map(([h, m]) => `${h}:${String(m).padStart(2, "0")}`), days: STANDUP_DAYS.map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]) },
    jobs: jobs().filter((j) => openJob(j) || Date.now() - Date.parse(j.updatedAt || j.at) < 7 * 864e5).slice(0, 60).map(({ history, ...j }) => ({ ...j, text: String(j.text || "").slice(0, 600) })),
  };
}

// Per room, for the campus perks: today's activity and tokens (the espresso bar's steam) and work finished in the
// last 7 days (the rooftop garden). "Finished" = a turn done, a worker run, a hand-logged note, or a decided request.
export function roomStats() {
  const day = new Date(Date.now() - 864e5).toISOString(), week = new Date(Date.now() - 7 * 864e5).toISOString();
  const out = {};
  const at = (room) => (out[room || "unassigned"] ??= { todayEvents: 0, todayTokens: 0, weekDone: 0 });
  for (const e of readEvents()) {
    if (e.startedAt < week) continue;
    const s = at(e.room);
    if (e.startedAt >= day) {
      s.todayEvents++;
      s.todayTokens += (e.inputTokens || 0) + (e.outputTokens || 0);
    }
    if (["turn done", "worker run", "note"].includes(e.action)) s.weekDone++;
  }
  for (const q of requests()) if (q.decision && q.decision.at >= week) at(q.room).weekDone++;
  return out;
}

// Standing rule (the owner, 2026-11-09): every project links into the hub. A room counts as linked when it has a lead
// desk and something reported from it in the last 14 days. "folder" says whether a Claude Code folder (hook-map.json)
// points at it, which is how reports start arriving without anyone typing them.
export function roomLink(roomId, desks) {
  const lead = desks.some((d) => d.room === roomId && d.lead && d.status !== "retired");
  let lastReportAt = null;
  for (const e of readEvents()) if (e.room === roomId && (!lastReportAt || e.startedAt > lastReportAt)) lastReportAt = e.startedAt;
  const folder = Object.values(hookMap()).some((m) => m?.room === roomId);
  const fresh = !!lastReportAt && Date.now() - Date.parse(lastReportAt) < 14 * 864e5;
  return { lead, lastReportAt, folder, linked: lead && fresh };
}

// Is the Claude Code hook (tools/agent-hook.mjs) alive? It writes hook-last-ok.txt after each good post and
// hook-errors.log (last 50) when something fails. Only times and the error text go to the page, never the key.
export function hookHealth() {
  const read = (f) => {
    try {
      return fs.readFileSync(path.join(DIR(), f), "utf8");
    } catch {
      return "";
    }
  };
  const [lastOkAt = null, lastOkEvent = null] = read("hook-last-ok.txt").trim().split(/\s+/);
  const errs = read("hook-errors.log").split("\n").filter(Boolean);
  const last = errs.at(-1) || "";
  const lastErrAt = last.split(" ")[0] || null;
  // Errors in the last day, and whether the newest error came after the newest good post (still broken).
  const dayAgo = new Date(Date.now() - 864e5).toISOString();
  return {
    lastOkAt: lastOkAt || null,
    lastOkEvent,
    errorsToday: errs.filter((l) => l.slice(0, 24) >= dayAgo).length,
    lastErrAt,
    lastError: last.slice(25, 225) || null,
    failing: !!lastErrAt && (!lastOkAt || lastErrAt > lastOkAt),
  };
}

// ---------- key for agents on this PC ----------
// Made on first use. Hooks read it from the file; it is never sent to the page.
export function ingestToken() {
  try {
    const t = fs.readFileSync(TOKEN(), "utf8").trim();
    if (t.length >= 32) return t;
  } catch {}
  fs.mkdirSync(DIR(), { recursive: true });
  const t = crypto.randomBytes(24).toString("hex");
  fs.writeFileSync(TOKEN(), t + "\n", { mode: 0o600 });
  return t;
}

export function tokenMatches(header) {
  const m = /^Bearer\s+(\S+)$/i.exec(String(header || ""));
  if (!m) return false;
  const want = Buffer.from(ingestToken());
  const got = Buffer.from(m[1]);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// ---------- alert rules and the spend forecast (alerts.js, forecast.js) ----------
// Month-end projections per desk and for the hub, from the spend ledger; caps from the roster, the hub's budget from the
// board's total of caps (agents/board.js boardBudget).
// The plan meter (planmeter.js): Anthropic's weekly and 5-hour meter from the status line, the hub's estimate from its
// own spend ledger, and each project's share of the week against its Finance budget. Five weeks of ledger, so the
// calibration has finished weeks to learn from.
export function planNow(now = new Date()) {
  const r = roster(), alias = deskAliases(), roomOfDesk = new Map(r.desks.map((d) => [d.id, d.room]));
  const rows = spendSince(now.getTime() - 35 * 86400e3, now).map((x) => ({ ...x, desk: alias.get(x.desk) || x.desk }));
  seedPlanBudgets({ rows, roomOf: (d) => roomOfDesk.get(d) || null, rooms: r.rooms, now: now.getTime() });
  return planView({ readings: meterReadings(), rows, budgets: planBudgets(), rooms: r.rooms, roomOf: (d) => roomOfDesk.get(d) || null, now: now.getTime() });
}
export const savePlanMeter = (body) => recordMeter(body);
export const savePlanBudget = (body) => setPlanBudget(body || {}, roster().rooms.map((x) => x.id));
export function forecastNow(now = new Date()) {
  const r = roster(), alias = deskAliases();
  const rows = spendThisMonth(now).map((x) => ({ ...x, desk: alias.get(x.desk) || x.desk }));
  const caps = Object.fromEntries(r.desks.filter((d) => d.status !== "retired" && d.capUsdMonth != null).map((d) => [d.id, d.capUsdMonth]));
  const total = boardBudget(r).total, budget = total > 0 ? total : null;
  const start = Date.parse(monthStartIso(now)), end = Date.parse(monthStartIso(now, hubTz(), -1));
  return { month: monthKey(now), budget, ...forecast({ rows, now: now.getTime(), monthStart: start, monthEnd: end, caps, budget }) };
}
// Check every alert rule once (the 5-minute timer; tests call it with their own `now` and notify).
export async function runAlertCheck({ now = new Date(), notify } = {}) {
  const alias = deskAliases(), f = forecastNow(now);
  const rows = spendThisMonth(now).map((x) => ({ ...x, desk: alias.get(x.desk) || x.desk }));
  return checkAlerts(
    { now: now.getTime(), dayStart: dayStartMs(now.getTime()), monthStart: Date.parse(monthStartIso(now)), rows, jobs: jobs(), events: readEvents(), forecast: f, budget: f.budget },
    {
      notify: notify || ((m) => sendAlert({ kind: "alert_rule", title: m.title, message: m.message, tags: ["warning"], priority: 4, url: dashboardLink("/ai.html") })),
      record: (e) => recordEvent({ desk: "hub", room: "hub", ...e }, "alerts"),
    },
  );
}

export function startWatchers() {
  // Work-on-your-own sessions that outlived a hub restart are watched again (agents/autonomy.js).
  try { const back = adoptSessions(); if (back.length) console.log(`Sessions picked up after the restart: ${back.join(", ")}`); } catch (err) { console.warn(`Sessions: ${err.message}`); }
  try { const back = restoreStaff(); if (back.length) console.log(`Back from the bench or the Retirement apartments: ${back.join(", ")}`); } catch (err) { console.warn(`Staff restore: ${err.message}`); }
  // The cloud relay: first pull shortly after start, then every 5 minutes.
  if (partsWith("relay").length) every("Cloud relay", pullCloudRelay, RELAY_MS, { firstMs: 30000, quiet: true });
  // Campus credits: workers go shopping every 20 minutes (each at most once an hour).
  // Parts that are switched off don't start their timers (src/hub/modules.js).
  if (timerOn("Campus shop")) every("Campus shop", shop, 20 * 60000);
  // Workers a script runs on this PC (a private part's local runner): their queued hub jobs every 15 minutes (first look
  // after 2 minutes).
  if (process.env.AGENTS_LOCAL_RUNNER !== "off" && partsWith("localRunner").length && timerOn("Local runner")) every("Local runner", runLocalJobs, LOCAL_MS, { firstMs: 120000 });
  // Worker chatter: a short Gemini Flash text exchange every 20 minutes in waking hours (first after 5 minutes).
  if (process.env.AGENTS_CHATTER !== "off" && timerOn("Campus chatter")) every("Campus chatter", chatter, 20 * 60000, { firstMs: 5 * 60000 });
  // Growing personalities (agents/selves.js): every 30 minutes, up to 3 workers whose life has moved on. Charged to the
  // store's budget; off with AGENTS_SELVES=off.
  if (process.env.AGENTS_SELVES !== "off" && timerOn("Campus selves")) every("Campus selves", () => growSelves({ budgetOpen: storeSpend().open }), 30 * 60000);
  // The approval board: every 10 minutes (no AI).
  if (timerOn("PR reviews")) every("PR reviews", prReviewTick, 10 * 60000, { unref: true });
  if (timerOn("Board")) every("Board", async () => {
    await boardCheck().catch((err) => console.warn(`Board: ${err.message}`));
    try {
      financeCheck();
    } catch (err) {
      console.warn(`Finance: ${err.message}`);
    }
  }, 10 * 60000);
  // Campus chores: every 30 minutes (no AI).
  if (timerOn("Chores")) every("Chores", choreTick, 30 * 60000);
  // Blocker watches: due ones checked every hour (first look after 3 minutes); each watch has its own interval.
  every("Blocker watches", checkBlockers, 3600e3, { firstMs: 3 * 60000 });
  // Alert rules the owner set (alerts.js): checked every 5 minutes, each rule at most once per cooldown.
  every("Alert rules", () => runAlertCheck(), 5 * 60000, { firstMs: 90000, unref: true });
  // The lead stand-up: checked every minute, held once per slot.
  every("Stand-up", checkStandup, 60000);
}

// Shared with the topic files in ./agents/.
export { DECISIONS, DIR, LOG_TOOL, OUTBOX, REQUESTS, ROSTER, TEAM_DIRECT, appendJsonl, clip, findOpen, monthSpend, monthStart, num, openJob, readEvents, readJsonl, slug, teamOf, traitOf };
// Workers' own Mart items load from data/agents/store-items.json now that DIR above exists (see registerStoreItems).
registerStoreItems();
