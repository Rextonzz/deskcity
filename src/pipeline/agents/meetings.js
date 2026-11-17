// Part of the agents module (src/pipeline/agents.js), split out by topic 2026-11-11: The board meeting (lead stand-up) and the week: each lead's budget and the work that starts after the meeting.
// Shared state and helpers come from agents.js, which also re-exports everything here, so callers import from there.
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJsonAtomic, newId } from "../util.js";
import { logEvent } from "../runlog.js";
import { ownerName as OWNER, hubSettings, hubTz } from "../../hub/settings.js";
import { helperMay } from "../../hub/helpers.js";
import { dayIn, hourIn, partsIn } from "../fmt.js";
import { zonedDate } from "../schedule.js";
import { DIR, LOG_TOOL, ROSTER, addJob, agentsOverview, appendJsonl, autoKids, boardBudget, boardView, clip, deskFolder, grantAutonomy, jobs, monthSpend, readEvents, readJsonl, recordEvent, requests, roomStatus, roster, runJob, shortOfWeek, slug, claudeLimit } from "../agents.js";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Whoever chairs the board meeting: the pet when there is one, else the owner.
const chairName = () => hubSettings().pet?.name || OWNER();

// ---------- lead stand-up (twice a day, in the CEO tower board room) ----------
// the owner, 2026-11-09: a forced team-lead meeting for project updates, in a neutral meeting room. 9:00 on Mon, Wed and Fri (STANDUP_TIMES,
// STANDUP_DAYS), in the hub's time zone the hub writes each running project's update from real data since the last stand-up: reports
// and sessions, jobs done and still open, what's waiting on the owner, spend, the latest thing done, and anything blocked.
// No AI, so it costs nothing. Minutes go to data/agents/meetings.jsonl and a Markdown copy per meeting; the campus
// shows the leads gathering in the CEO tower; and a lead's next Claude Code session on this PC hears the other
// projects' updates.
const MEETINGS = () => path.join(DIR(), "meetings.jsonl");
// The board meeting (the owner 2026-11-09: "change the lead meeting to a board meeting 3 times a week ... in the CEO tower
// with the pet at the helm"): Monday, Wednesday and Friday at 9:00. It was a lead stand-up twice a day.
export const STANDUP_TIMES = [[9, 0]], STANDUP_DAYS = [1, 3, 5];
export function meetings(limit = 10) {
  return readJsonl(MEETINGS()).slice(-limit).reverse();
}
export function holdStandup({ trigger = "schedule" } = {}) {
  const r = roster();
  const last = meetings(1)[0];
  const since = last?.at || new Date(Date.now() - 12 * 3600e3).toISOString();
  const ev = readEvents().filter((e) => e.startedAt > since);
  const js = jobs();
  const reqs = requests().filter((q) => !q.decision);
  const overCap = agentsOverview().desks.filter((d) => d.overCap).map((d) => d.id);
  const projects = [];
  for (const room of r.rooms) {
    if (room.id === "hr" || roomStatus(room, r.desks) !== "active") continue;
    const desks = r.desks.filter((d) => d.room === room.id && d.status !== "retired");
    const lead = desks.find((d) => d.lead) || null;
    const mine = ev.filter((e) => e.room === room.id);
    const done = js.filter((j) => j.room === room.id && j.status === "done" && (j.updatedAt || j.at) > since).length;
    const open = js.filter((j) => j.room === room.id && (j.status === "queued" || j.status === "taken")).length;
    const waiting = reqs.filter((q) => q.room === room.id).length;
    const api = mine.filter((e) => e.billing === "api").reduce((a, e) => a + (e.costUsd || 0), 0);
    const sub = mine.filter((e) => e.billing !== "api").reduce((a, e) => a + (e.costUsd || 0), 0);
    const latest = [...mine].reverse().find((e) => e.summary && e.action !== "turn done");
    const blocked = [waiting ? `${waiting} waiting on ${OWNER()}` : "", lead ? "" : "no lead", overCap.some((id) => desks.some((d) => d.id === id)) ? "a desk is over its cap" : ""].filter(Boolean);
    projects.push({
      room: room.id, name: room.name, lead: lead?.id || null, leadProvider: lead?.provider || null,
      reports: mine.length, sessions: mine.filter((e) => e.action === "session start").length, jobsDone: done, jobsOpen: open, waiting,
      api: Math.round(api * 100) / 100, sub: Math.round(sub * 100) / 100,
      latest: latest ? `${latest.desk}: ${latest.summary}`.slice(0, 160) : null,
      blocked,
    });
  }
  const now = new Date();
  const slot = hourIn(hubTz(), now) < 12 ? "morning" : "afternoon";
  const sow = shortOfWeek();
  // The board's part: what it decided since last time, its hiring budget, and what's waiting on the owner.
  const all = requests(), bb = boardBudget(r);
  const board = { decided: all.filter((q) => q.decision?.by === "board" && q.decision.at > since).map((q) => q.role).slice(0, 12), budget: bb, waitingOnOwner: all.filter((q) => !q.decision && !boardView(q, r, bb)?.ok && q.kind !== "borrow").length };
  const m = {
    id: newId(),
    at: now.toISOString(),
    slot,
    day: dayIn(hubTz(), now),
    trigger,
    since,
    projects,
    board,
    chair: chairName(),
    ...(sow
      ? {
          shortOfWeek: {
            title: sow.title,
            url: sow.url,
            desk: sow.desk,
            stars: sow.stars,
            shares: sow.shares,
            watchers: sow.watchers.length,
          },
        }
      : {}),
  };
  appendJsonl(MEETINGS(), m);
  // a readable copy
  const md = [
    `# Board meeting, ${m.day} (chaired by ${chairName()}, CEO tower)`,
    "",
    `Since ${new Date(since).toLocaleString(undefined, { timeZone: hubTz() })}.`,
    "",
    `Board decisions: ${board.decided.length ? board.decided.join("; ") : "none"}. Hiring budget $${bb.spent} of $${bb.limit}. Waiting on ${OWNER()}: ${board.waitingOnOwner}.`,
    "",
    ...(sow ? [`🏆 Short of the week: "${sow.title}" (${sow.url}), found by ${sow.desk}, ${sow.stars}★, shared ${sow.shares}×`, ""] : []),
    ...projects.map(
      (p) =>
        `## ${p.name}${p.lead ? ` (lead: ${p.lead})` : " (no lead)"}\n- ${p.reports} reports, ${p.sessions} sessions, ${p.jobsDone} jobs done, ${p.jobsOpen} open, ${p.waiting} waiting on ${OWNER()}\n- Spend: $${p.api} API, $${p.sub} subscription\n${p.latest ? `- Latest: ${p.latest}\n` : ""}${p.blocked.length ? `- Blocked: ${p.blocked.join(", ")}\n` : ""}`,
    ),
  ].join("\n");
  fs.mkdirSync(path.join(DIR(), "meetings"), { recursive: true });
  fs.writeFileSync(path.join(DIR(), "meetings", `${m.day}-${slot}.md`), md);
  logEvent("agent standup", { trigger, projects: projects.length });
  return m;
}
// One line per project, for a lead's Claude Code session (their own project first is left out: they know it).
export function standupFor(desk) {
  const r = roster();
  const d = r.desks.find((x) => x.id === desk);
  if (!d?.lead) return null;
  const m = meetings(1)[0];
  if (!m) return null;
  const others = m.projects.filter((p) => p.room !== d.room);
  return {
    at: m.at,
    slot: m.slot,
    lines: others.map(
      (p) =>
        `${p.name}: ${p.reports} reports, ${p.jobsDone} jobs done, ${p.jobsOpen} open${p.waiting ? `, ${p.waiting} waiting on ${OWNER()}` : ""}${p.latest ? `. Latest: ${p.latest}` : ""}${p.blocked.length ? ` [${p.blocked.join(", ")}]` : ""}`,
    ),
  };
}
function nextStandup(now = new Date()) {
  const tz = hubTz(), p = partsIn(tz, now);
  for (let add = 0; add <= 7; add++) for (const [h, mi] of STANDUP_TIMES) {
    const c = new Date(Date.UTC(p.y, p.m - 1, p.d + add)), t = zonedDate(tz, c.getUTCFullYear(), c.getUTCMonth() + 1, c.getUTCDate(), h, mi);
    if (t > now && STANDUP_DAYS.includes(c.getUTCDay())) return t.toISOString();
  }
  return null;
}
function checkStandup(now = new Date()) {
  const tz = hubTz(), p = partsIn(tz, now), day = dayIn(tz, now);
  if (!STANDUP_DAYS.includes(WD.indexOf(p.weekday))) return;
  for (const [h, mi] of STANDUP_TIMES) {
    const t = zonedDate(tz, p.y, p.m, p.d, h, mi);
    const slot = h < 12 ? "morning" : "afternoon";
    if (now >= t && now - t < 10 * 60000 && !meetings(4).some((m) => m.day === day && m.slot === slot)) {
      try {
        holdStandup({ trigger: "schedule" });
        afterMeeting({ trigger: "board meeting" });
      } catch (err) {
        console.warn(`Board meeting: ${err.message}`);
      }
    }
  }
  try { weekTick(); } catch (err) { console.warn(`Week: ${err.message}`); }
}

// ---------- the week: each lead's budget, and work that starts after the board meeting ----------
// the owner 2026-11-11: "each lead can budget its week and each active workflow should try and start work after the board
// meeting if they have budget", and "after the 9am meeting all leads should then try and work on their own, do at
// least 1hr". Self-sufficient from him, but working with the relevant other agents.
//   A lead's week has two budgets: hours of its own Claude Code time (sessions run on the subscription, so the limit
//   is time, not dollars; 3 a week unless the project says otherwise) and the dollars its hub-run team can still
//   spend this month, spread over the weeks left.
//   After each scheduled board meeting every active project with a lead and budget starts by itself: a Claude Code
//   lead gets a work-on-your-own session (at least an hour while it has the hours), a hub-run lead gets a job to move
//   its project on with its team. A lead whose home is a chat can't be started by the hub and is listed as skipped.
//   The first session of a week writes the week's plan (logged as a "week plan" event); later ones work to it.
// Hub settings: "afterMeeting": false turns it off; { "minutes": 60, "weekHours": 3, "atOnce": 3, "skip": ["room"] }.
// One project is switched off with its "Starts after the board meeting" switch (room.autoWork = false).
const WEEK = () => path.join(DIR(), "week.json");
const weekCfg = () => { const c = hubSettings().afterMeeting; return c === false ? { on: false, skip: [] } : { on: true, minutes: 60, weekHours: 3, atOnce: 3, skip: [], ...(c && typeof c === "object" ? c : {}) }; };
const mondayOf = (t = new Date()) => {
  const tz = hubTz(), p = partsIn(tz, t), c = new Date(Date.UTC(p.y, p.m - 1, p.d - (WD.indexOf(p.weekday) + 6) % 7));
  return zonedDate(tz, c.getUTCFullYear(), c.getUTCMonth() + 1, c.getUTCDate(), 0, 0);
};
function weekState() {
  let s = readJson(WEEK(), {});
  const wk = dayIn(hubTz(), mondayOf());
  if (s.weekOf !== wk) s = { weekOf: wk, rooms: {}, queue: [] };
  s.rooms ||= {}; s.queue ||= [];
  return s;
}
const saveWeek = (s) => writeJsonAtomic(WEEK(), s);
// How a lead can be started: "session" (Claude Code in its folder), "hub" (the hub runs it), or "chat" (it can't).
const leadKind = (d) => (d.runner === "hub" && d.capUsdMonth != null ? "hub" : d.runner !== "hub" && d.runner !== "local" && deskFolder(d.id) ? "session" : "chat");
// Every active project's week: budget, what's used, the plan, and whether it starts after the meeting.
export function weekStatus() {
  const r = roster(), cfg = weekCfg(), st = weekState(), now = new Date(), p = partsIn(hubTz(), now), monday = mondayOf(now).toISOString();
  const spend = Object.fromEntries(Object.entries(monthSpend()).map(([id, x]) => [id, x.usd]));
  const daysLeft = new Date(Date.UTC(p.y, p.m, 0)).getUTCDate() - p.d + 1, weeksLeft = Math.max(1, Math.ceil(daysLeft / 7));
  const today = (WD.indexOf(p.weekday) + 6) % 7, left = STANDUP_DAYS.filter((d) => (d + 6) % 7 >= today).length || 1;
  const plans = {};
  for (const e of readEvents()) if (e.action === "week plan" && e.startedAt >= monday && e.summary) plans[e.room] = { text: e.summary, at: e.startedAt, by: e.desk };
  const out = [];
  for (const room of r.rooms) {
    if (room.id === "hr" || roomStatus(room, r.desks) !== "active") continue;
    const head = r.desks.find((d) => d.room === room.id && d.lead && d.status === "active");
    if (!head) continue;
    // A lead whose home is a chat can't be started, so a Claude Code worker of the same project with a folder on this
    // PC stands in for it (the owner 2026-11-11, another project: "a major project that should keep moving"). room.weekDesk picks one.
    const standIn = leadKind(head) === "chat" ? r.desks.find((d) => d.room === room.id && d.id !== head.id && d.status === "active" && (room.weekDesk ? d.id === room.weekDesk : /claude-code/i.test(d.model || "")) && leadKind(d) === "session") : null;
    const lead = standIn || head;
    const kind = leadKind(lead), mine = st.rooms[room.id] || {}, runs = mine.runs || [];
    const hours = kind === "session" ? Number(room.weekHours ?? cfg.weekHours) || 0 : 0, usedMin = runs.reduce((a, x) => a + (x.minutes || 0), 0), leftMin = Math.max(0, Math.round(hours * 60 - usedMin));
    const team = r.desks.filter((d) => d.room === room.id && d.status === "active" && d.runner === "hub" && d.capUsdMonth != null);
    const usd = Math.round((team.reduce((a, d) => a + Math.max(0, d.capUsdMonth - (spend[d.id] || 0)), 0) / weeksLeft) * 100) / 100;
    const leadUsd = kind === "hub" ? Math.max(0, lead.capUsdMonth - (spend[lead.id] || 0)) : 0;
    const share = Math.min(leftMin, Math.max(Number(cfg.minutes) || 60, Math.round(leftMin / left)));
    const skip = !cfg.on
      ? "starting after the meeting is switched off"
      : room.autoWork === false
        ? "switched off for this project"
        : (cfg.skip || []).includes(room.id)
          ? "left out in the hub settings"
          : kind === "chat"
            ? "its lead works in a chat the hub can't start"
            : kind === "session" && leftMin < 20
              ? "this week's hours are used"
              : kind === "hub" && leadUsd <= 0
                ? "the lead's budget for the month is used"
                : null;
    out.push({
      room: room.id,
      name: room.name,
      lead: lead.id,
      kind,
      on: room.autoWork !== false,
      hours,
      usedMin,
      leftMin,
      minutes: kind === "session" ? share : 0,
      usd,
      plan: plans[room.id] || null,
      last: runs[runs.length - 1] || null,
      skip,
      ...(standIn ? { standsInFor: head.id } : {}),
      ...(mine.error ? { error: mine.error } : {}),
    });
  }
  return { weekOf: st.weekOf, on: cfg.on, queued: st.queue.map((q) => q.room), rooms: out };
}
// Queue today's work for every project that can start; the timer starts them (weekTick).
export function afterMeeting({ trigger = "board meeting", rooms } = {}) {
  const w = weekStatus(), st = weekState(), day = dayIn(hubTz());
  const started = [], skipped = [];
  for (const x of w.rooms) {
    if (rooms && !rooms.includes(x.room)) continue;
    if (x.skip) { skipped.push({ room: x.room, why: x.skip }); continue; }
    if (st.queue.some((q) => q.room === x.room) || (x.kind === "session" && autoKids.has(x.lead))) { skipped.push({ room: x.room, why: "already started or working" }); continue; }
    st.queue.push({ room: x.room, desk: x.lead, kind: x.kind, minutes: x.minutes, day, trigger });
    started.push(x.room);
  }
  saveWeek(st);
  recordEvent(
    {
      desk: "hr",
      room: "hr",
      action: "week start",
      summary: clip(
        `After the ${trigger}: ${started.length ? `starting ${started.join(", ")}` : "nothing to start"}${skipped.length ? `; not starting ${skipped.map((k) => `${k.room} (${k.why})`).join(", ")}` : ""}`,
        400,
      ),
    },
    "week",
  );
  try { weekTick(); } catch (err) { console.warn(`Week: ${err.message}`); }
  return { started, skipped };
}
function weekNote(x, d, firstOfWeek) {
  const tool = LOG_TOOL(), days = STANDUP_DAYS.map((n) => WD[n]).join(", ");
  const budget =
    x.kind === "session"
      ? `This week you have ${x.hours} hours of your own working time (${Math.round(x.usedMin)} minutes used so far), started for you after each board meeting (${days})${x.usd ? `, and your hub-run team has about $${x.usd.toFixed(2)} to spend this week` : ""}.`
      : `Your team has about $${x.usd.toFixed(2)} to spend this week, you included.`;
  const plan = x.plan
    ? `Your plan for this week: "${x.plan.text}". Work to it. If it has turned out wrong, change it and log the new one the same way.`
    : firstOfWeek || !x.plan
      ? `You have no plan for this week yet. Spend no more than 10 minutes on one first: 3 to 5 outcomes for the week, which teammate does which part, and how you split your hours and the team's money across the sessions.${x.kind === "session" ? ` Save it as docs/WEEK.md in this folder, and log it in one or two sentences: node ${tool} event --desk ${d.id} --room ${d.room} --action "week plan" --summary "<the plan>"` : ' Put it first in your answer, under the heading "Week plan", and make your one-line summary the plan in a sentence.'}`
      : "";
  return [
    `The board meeting has just ended and this is your working time, started by the hub. Nobody asked for anything in particular: you decide what moves the project on most.`,
    x.standsInFor
      ? `You are standing in for the project's lead (${x.standsInFor}), whose home is a chat the hub can't start. For this session act as the lead, inside the project's own rules (its CLAUDE.md comes first). Leave a note for ${x.standsInFor} of what you decided and did: node ${tool} handoff --desk ${d.id} --to ${x.standsInFor} --text "<what you did and what needs their call>"`
      : "",
    budget,
    plan,
    `Be self-sufficient. Decide for yourself and write down why; ${OWNER()} is not available. Only put a question to them for something only they can give (money, a key or account, a decision outside the project's scope), and keep working on something else while it waits.`,
    `Work with the people it concerns: your team for what each is good at, the shared assistant for errands, and another project's lead when your work touches theirs${x.kind === "session" ? ` (node ${tool} desks lists everyone). Hand a step over with handoff, and read what has come back to you first: node ${tool} inbox --desk ${d.id}` : ""}. Don't do alone what a teammate is there for, and don't hand off what is quicker to do yourself.`,
    x.kind === "session" ? "Before you finish, update docs/WEEK.md: what is done, what is next." : "",
  ]
    .filter(Boolean)
    .join("\n");
}
// Start what is queued: hub-run leads straight away, Claude Code leads a few at a time (one new one a minute).
let weekBusy = false;
export function weekTick() {
  const st = weekState(), day = dayIn(hubTz()), cfg = weekCfg();
  if (!st.queue.length || weekBusy) return;
  const now = Date.now(), limited = claudeLimit(now);
  // yesterday's leftovers are dropped; a start held for the Claude limit keeps until 12 hours after its reset
  st.queue = st.queue.filter((q) => (q.notBefore ? now - Date.parse(q.notBefore) < 12 * 3600e3 : q.day === day));
  const r = roster();
  const note = (q, how, extra = {}) => { const m = (st.rooms[q.room] ||= {}); (m.runs ||= []).push({ at: new Date().toISOString(), desk: q.desk, how, ...extra }); delete m.error; };
  const w = weekStatus();
  let sessionStarted = false, aiOk;
  for (const q of [...st.queue]) {
    const d = r.desks.find((x) => x.id === q.desk), x = w.rooms.find((y) => y.room === q.room);
    const drop = () => { st.queue = st.queue.filter((y) => y !== q); };
    if (!d || !x) { drop(); continue; }
    const first = !(st.rooms[q.room]?.runs || []).length;
    // Work that starts by itself after a board meeting is an AI helper; the owner's "start the week" button is not.
    if (q.trigger !== "button" && !(aiOk ??= helperMay("week").ok)) continue;
    if (q.kind === "hub") {
      drop(); note(q, "job");
      (async () => {
        try {
          const j = await addJob({ desk: d.id, text: clip(`Work on your own after the board meeting.\n${weekNote(x, d, first)}`, 1900) });
          const res = await runJob(j.id);
          if (!x.plan && res?.summary) recordEvent({ desk: d.id, room: d.room, action: "week plan", summary: clip(res.summary, 400), provider: d.provider }, "week");
        } catch (err) { const s2 = weekState(); (s2.rooms[q.room] ||= {}).error = clip(err.message, 200); saveWeek(s2); }
      })();
      continue;
    }
    if (q.notBefore && Date.parse(q.notBefore) > now) continue; // waiting for the Claude limit to reset
    if (limited || sessionStarted || autoKids.size >= (Number(cfg.atOnce) || 3) || autoKids.has(d.id)) continue; // waits for a free slot
    drop(); sessionStarted = true; weekBusy = true;
    const minutes = Math.max(20, q.minutes || 60);
    note(q, "session", { minutes });
    grantAutonomy({ desk: d.id, hours: minutes / 60, note: weekNote(x, d, first), by: "started by the hub after the board meeting" })
      .catch((err) => { const s2 = weekState(), m = (s2.rooms[q.room] ||= {}); m.error = clip(err.message, 200); m.runs = (m.runs || []).slice(0, -1); saveWeek(s2); })
      .finally(() => { weekBusy = false; });
  }
  saveWeek(st);
}
// A session started after the board meeting hit Claude's usage limit: its hours go back, and it starts again after the
// reset (agents/autonomy.js closeSession). Returns true when it was queued again.
export function requeueAfterLimit(deskId, until) {
  const st = weekState(), room = Object.keys(st.rooms).find((k) => (st.rooms[k].runs || []).some((x) => x.desk === deskId && x.how === "session"));
  if (!room) return false;
  const runs = st.rooms[room].runs, last = [...runs].reverse().find((x) => x.desk === deskId && x.how === "session");
  const minutes = last.minutes;
  last.minutes = 0; last.limited = true;
  if (!st.queue.some((q) => q.desk === deskId)) st.queue.push({ room, desk: deskId, kind: "session", minutes, day: dayIn(hubTz(), Date.parse(until)), notBefore: until, trigger: "the Claude limit reset" });
  saveWeek(st);
  return true;
}
// One project's switch: does it start by itself after the board meeting? Also its own weekly hours.
export function setRoomWeek({ id, on, hours } = {}) {
  const r = roster(), room = r.rooms.find((x) => x.id === slug(id));
  if (!room) throw new Error("Unknown project.");
  if (on != null) { if (on) delete room.autoWork; else room.autoWork = false; }
  if (hours != null) { const h = Number(hours); if (!(h >= 0 && h <= 40)) throw new Error("Hours a week must be between 0 and 40."); room.weekHours = h; }
  writeJsonAtomic(ROSTER(), r);
  logEvent("agent roster", { trigger: "button", room: room.id, change: `after-meeting work ${room.autoWork === false ? "off" : "on"}${room.weekHours != null ? `, ${room.weekHours} h a week` : ""}` });
  return weekStatus();
}

export { checkStandup, nextStandup };
