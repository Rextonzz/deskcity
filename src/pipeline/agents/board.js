// Part of the agents module (src/pipeline/agents.js), split out by topic 2026-11-11: The approval board and the finance buddy.
// Shared state and helpers come from agents.js, which also re-exports everything here, so callers import from there.
import path from "node:path";
import { readJson, writeJsonAtomic, dayIn } from "../util.js";
import { ownerName as OWNER, ownerId, hubTz } from "../../hub/settings.js";
import { monthKey, monthStartIso } from "../spend.js";
import { planLines } from "../planmeter.js";
import { DECISIONS, DIR, OUTBOX, REQUESTS, TEAM_DIRECT, activeLoans, addJob, loanNote, addRequest, agentsOverview, appendJsonl, autoHandOff, clip, decideRequest, findOpen, planNow, readJsonl, recordEvent, requests, roster, sendText, slug, teamOf, tellOwner } from "../agents.js";

// ---------- the approval board ----------
// the owner 2026-11-09: an approval board with HR and the project lead; anything that needs additional review lands in his
// queue. No AI: HR's existing check is its vote; the project's lead has BOARD.windowMin to object (agent-log.mjs vote,
// free on the PC); with no objection and within the limits the owner set, the board approves.
// Anything else stays in the owner's queue, and he can decide first at any time. Never: GitHub or another project merge asks.
export const BOARD = { loanHours: 4, storeCredits: 30, hireCap: 1, budgetShare: 0.15, windowMin: 60 };
const BOARD_LOG = () => path.join(DIR(), "board.jsonl");
function boardHires(month = new Date().toISOString().slice(0, 7)) {
  return readJsonl(BOARD_LOG()).filter((x) => String(x.at).startsWith(month));
}
const boardHireCap = (q) => Math.min(q.hr?.capUsdMonth ?? Infinity, q.budgetAsk ?? Infinity);
export function boardBudget(r = roster()) {
  const total = r.desks.filter((d) => d.status === "active" && d.capUsdMonth != null).reduce((a, d) => a + d.capUsdMonth, 0);
  const spent = boardHires().reduce((a, x) => a + (x.cap || 0), 0);
  return { total: Math.round(total * 100) / 100, limit: Math.round(total * BOARD.budgetShare * 100) / 100, spent: Math.round(spent * 100) / 100 };
}
// Who sits on the board for a request: HR, the finance desk and the project's lead (the lending project's for a loan).
export function boardMembers(q, r = roster()) {
  const room = q.kind === "borrow" ? q.ownerRoom : q.room;
  const lead = r.desks.find((d) => d.room === room && d.lead && d.status !== "retired")?.id || null;
  return [...new Set(["hr", financeDesk(r)?.id, lead].filter(Boolean))];
}
// Can the board take it, and if not, why it stays with the owner. at: when the objection window closes.
export function boardView(q, r = roster(), budget = boardBudget(r)) {
  if (q.decision || !["borrow", "store", "staff"].includes(q.kind) || q.pr) return null;
  const no = (q.votes || []).filter((v) => v.vote === "no");
  const at = new Date(Date.parse(q.at) + BOARD.windowMin * 60000).toISOString();
  let why = null;
  if (no.length) why = `${no.map((v) => v.by).join(", ")} objected${no[0].why ? `: ${no[0].why}` : ""}`;
  else if (q.kind === "borrow" && q.hours > BOARD.loanHours) why = `longer than ${BOARD.loanHours} h`;
  else if (q.kind === "store" && !q.hr) why = "waiting for HR's check";
  else if (q.kind === "store" && q.hr.verdict !== "approve") why = "HR said no";
  else if (q.kind === "store" && (q.hr.item?.cost ?? q.item?.cost) > BOARD.storeCredits) why = `over ${BOARD.storeCredits} credits`;
  else if (q.kind === "staff" && !q.hr) why = "waiting for HR's check";
  else if (q.kind === "staff" && !["approve", "approve-cheaper"].includes(q.hr.verdict)) why = `HR said ${q.hr.verdict}`;
  else if (q.kind === "staff" && !(boardHireCap(q) <= BOARD.hireCap)) why = `cap over $${BOARD.hireCap}/month`;
  else if (q.kind === "staff" && budget.spent + boardHireCap(q) > budget.limit) why = `board budget used ($${budget.spent} of $${budget.limit} this month)`;
  return { members: boardMembers(q, r), at, ok: !why, why };
}
export function voteRequest({ request, desk, vote, why } = {}) {
  const q = findOpen(request), who = slug(desk);
  if (!["yes", "no"].includes(vote)) throw new Error("Vote yes or no.");
  if (!boardMembers(q).includes(who)) throw new Error(`${who} isn't on the board for this one (${boardMembers(q).join(", ")}).`);
  appendJsonl(REQUESTS(), { id: q.id, at: new Date().toISOString(), by: who, vote, ...(why ? { why: clip(why, 300) } : {}) });
  recordEvent({ desk: who, room: q.room, action: vote === "no" ? "board objection" : "board vote", summary: `${vote === "no" ? "✋ objects to" : "👍 backs"} ${q.role}${why ? `: ${why}` : ""}`.slice(0, 200) }, who);
  return { request: q.id, by: who, vote };
}
// Every 10 minutes: approve what the board can, once its window has closed. Also nudges HR towards a lane lead when a
// lead's team grows past TEAM_DIRECT (once per project).
export async function boardCheck(now = Date.now()) {
  const r = roster(), budget = boardBudget(r), done = [], fd = financeDesk(r);
  let fin = null;
  for (const q of requests({ open: true })) {
    // The finance desk (the owner 2026-11-09: it "joins the board" and takes over HR's money checks) votes once, in code.
    if (fd && q.kind === "staff" && q.hr && !q.decision && !(q.votes || []).some((v) => v.by === fd.id)) {
      fin = fin || (() => { const ov = agentsOverview(); return financeView(r, ov.desks, ov.unassignedMonth); })();
      const cap = boardHireCap(q), room = fin.rooms.find((x) => x.id === q.room);
      const why = !Number.isFinite(cap) ? null
        : budget.spent + cap > budget.limit && cap <= BOARD.hireCap ? `board budget: $${budget.spent} + $${cap} is over $${budget.limit} this month`
        : room?.over ? `${room.name} is already projected at $${room.projected}, over its $${room.cap} of caps`
        : null;
      try {
        voteRequest({
          request: q.id,
          desk: fd.id,
          vote: why ? "no" : "yes",
          why: why || `fits: board budget $${budget.spent} of $${budget.limit}${room ? `, ${room.name} projected $${room.projected}` : ""}`,
        });
        q.votes = [...(q.votes || []), { by: fd.id, vote: why ? "no" : "yes", why }];
      } catch {}
    }
    const b = boardView(q, r, budget);
    if (!b?.ok || now < Date.parse(b.at)) continue;
    try {
      await decideRequest(q.id, { decision: "approved", note: `Approved by the board (${b.members.join(", ")}): within ${OWNER()}'s limits, no objections.` }, "board");
      if (q.kind === "staff") budget.spent += boardHireCap(q);
      if (q.kind === "borrow") {
        const home = r.desks.find((d) => d.room === q.ownerRoom && d.lead);
        if (home)
          sendText({
            from: "hr",
            to: home.id,
            kind: "note",
            text: `The board lent your ${q.desk} to ${q.room} for ${q.hours} h. Need them? Give them a job or tap Recall and they come straight back.`,
          });
      }
      recordEvent({ desk: "hr", room: "hr", action: "board approved", summary: q.role.slice(0, 200) }, "board");
      done.push(q.id);
    } catch (err) { console.warn(`Board ${q.id}: ${err.message}`); }
  }
  try {
    const st = readJson(path.join(DIR(), "board-state.json"), { nudged: [] });
    for (const lead of r.desks.filter((d) => d.lead && d.status === "active")) {
      if (st.nudged.includes(lead.room) || teamOf(lead).length <= TEAM_DIRECT) continue;
      st.nudged.push(lead.room);
      tellOwner({
        title: `HR: ${lead.room} has ${teamOf(lead).length} people under one lead`,
        detail: `Over ${TEAM_DIRECT} reports, briefs get split. Consider a lane lead: set someone as lead of a lane (org chart, "reports to") and move part of the team under them.`,
        source: "hr",
      });
    }
    writeJsonAtomic(path.join(DIR(), "board-state.json"), st);
  } catch {}
  return done;
}

// ---------- finance buddy (the owner 2026-11-09: "hr needs a finance buddy so we can track and project") ----------
// Plain code, no AI: month-to-date spend per project and per desk, a straight-line month-end projection, the day a
// capped desk would hit its cap, and what's left of the board budget. financeCheck() runs with the board timer and,
// once a day, texts a project's lead (and HR) when a desk is on track to pass its cap. On Mondays it gives the finance
// desk (HR's finance worker, hired through HR) one job: the weekly money note, with these numbers attached.
const FIN_STATE = () => path.join(DIR(), "finance-state.json");
const FIN_MIN_SHARE = 0.25; // warn only once a desk has used a quarter of its cap, so day-one noise doesn't text anyone
const r2 = (n) => Math.round((n || 0) * 100) / 100;
export function financeView(r = roster(), desks = null, unassigned = {}, now = new Date()) {
  desks = desks || agentsOverview().desks;
  // the month runs in the hub's time zone, like monthUsd (spend.js), so the two never disagree near month end
  const start = Date.parse(monthStartIso(now)), days = Math.round((Date.parse(monthStartIso(now, hubTz(), -1)) - start) / 86400e3);
  const elapsed = Math.max(1, (now - start) / 86400e3), k = days / elapsed;
  const hitDay = (spent, cap) => (spent > 0 && cap ? Math.min(days + 1, Math.ceil(cap / (spent / elapsed))) : null);
  const live = desks.filter((d) => d.status !== "retired");
  const deskRows = live.filter((d) => d.capUsdMonth != null || (d.monthUsd || 0) > 0).map((d) => {
    const proj = r2((d.monthUsd || 0) * k), hit = d.capUsdMonth ? hitDay(d.monthUsd || 0, d.capUsdMonth) : null;
    return { id: d.id, room: d.room, api: r2(d.monthUsd), sub: r2(d.monthSubUsd), cap: d.capUsdMonth ?? null, projected: proj, hitDay: hit != null && hit <= days ? hit : null,
      warn: !!(d.capUsdMonth && proj > d.capUsdMonth && (d.monthUsd || 0) >= d.capUsdMonth * FIN_MIN_SHARE) };
  });
  const rooms = r.rooms.map((x) => {
    const ds = live.filter((d) => d.room === x.id), api = ds.reduce((a, d) => a + (d.monthUsd || 0), 0), sub = ds.reduce((a, d) => a + (d.monthSubUsd || 0), 0);
    const cap = ds.filter((d) => d.status === "active" && d.capUsdMonth != null).reduce((a, d) => a + d.capUsdMonth, 0);
    return { id: x.id, name: x.name, api: r2(api), sub: r2(sub), cap: r2(cap), projected: r2(api * k), over: cap > 0 && api * k > cap };
  }).filter((x) => x.api || x.sub || x.cap);
  const other = Object.values(unassigned || {}).reduce((a, s) => a + (s.usd || 0), 0);
  const api = rooms.reduce((a, x) => a + x.api, 0) + other, sub = rooms.reduce((a, x) => a + x.sub, 0);
  const cap = live.filter((d) => d.status === "active" && d.capUsdMonth != null).reduce((a, d) => a + d.capUsdMonth, 0);
  return { month: monthKey(now), day: Math.floor(elapsed) + 1, days,
    total: { api: r2(api), sub: r2(sub), cap: r2(cap), projected: r2(api * k), other: r2(other) },
    rooms: rooms.sort((a, b) => b.projected - a.projected), desks: deskRows.sort((a, b) => b.projected - a.projected), warnings: deskRows.filter((d) => d.warn),
    board: boardBudget(r) };
}
// HR's finance worker, or the lead of a Finance project (2026-11-13: finance-lead sits in its own "finance" room and was
// never found, so it got no numbers and said "I have no actual spend data").
const financeDesk = (r = roster()) => r.desks.find((d) => (d.room === "hr" || d.room === "finance") && d.status === "active" && /financ/i.test(`${d.id} ${d.role}`));
// The money numbers as lines of text, for the weekly note and for every job the hub runs for the finance desk.
export function financeLines(f) {
  return [
    `Month ${f.month}, day ${f.day} of ${f.days}. Total: $${f.total.api} API so far, projected $${f.total.projected} against $${f.total.cap} of monthly caps; subscription use worth $${f.total.sub} at API prices (already paid by the plans); $${f.total.other} from workers outside any project.`,
    `Board budget: $${f.board.spent} of $${f.board.limit} used.`,
    "By project (API so far, projected for the month, caps, subscription use):",
    ...f.rooms.map((x) => `- ${x.name}: $${x.api}, projected $${x.projected}${x.cap ? ` of $${x.cap} caps` : ""}${x.over ? " (OVER)" : ""}, $${x.sub} sub`),
    "By worker:",
    ...f.desks.slice(0, 25).map((d) => `- ${d.id} (${d.room}): $${d.api} API${d.cap != null ? ` of $${d.cap} cap` : ""}, projected $${d.projected}${d.hitDay ? `, hits its cap about day ${d.hitDay}` : ""}${d.warn ? " (on track to pass its cap)" : ""}`),
  ];
}
// Attached to every job the hub runs for the finance desk.
export function financeContext(desk) {
  const r = roster();
  if (!desk || financeDesk(r)?.id !== desk.id) return "";
  const ov = agentsOverview(), f = financeView(r, ov.desks, ov.unassignedMonth);
  let plan = [];
  try { plan = planLines(planNow()); } catch {}
  return `Live spend numbers from the hub (data/spend.jsonl, summed per worker for this month; use these, don't invent splits):\n${[...financeLines(f), ...plan].join("\n")}`;
}
export function financeCheck(now = new Date()) {
  const r = roster(), ov = agentsOverview(), f = financeView(r, ov.desks, ov.unassignedMonth);
  const st = readJson(FIN_STATE(), {});
  const today = dayIn(hubTz(), now), out = { warned: [], note: null };
  const from = financeDesk(r)?.id || "hr";
  if (st.day !== today) {
    // plan warnings ("plan:<week reset>:<room>:<label>") are kept until that week resets
    st.day = today; st.warned = (st.warned || []).filter((w) => w.startsWith(f.month) || (w.startsWith("plan:") && Date.parse(w.split(":").slice(1, -2).join(":")) > now.getTime()));
    for (const w of f.warnings) {
      const key = `${f.month}:${w.id}`; if (st.warned.includes(key)) continue;
      const lead = r.desks.find((d) => d.room === w.room && d.lead && d.status !== "retired");
      const line = `Heads-up: ${w.id} has used $${w.api} of its $${w.cap} cap and is on track for about $${w.projected} this month${w.hitDay ? ` (cap reached around day ${w.hitDay})` : ""}.`;
      if (lead) sendText({ from, to: lead.id, kind: "finance", text: line });
      if (from !== "hr") sendText({ from, to: "hr", kind: "finance", text: line });
      st.warned.push(key); out.warned.push(w.id);
    }
    // Plan budgets (planmeter.js): a project that has used, or is heading past, its share of the plan's week. Its
    // lead and HR hear once per week and label; hub-started sessions already stop at the share (autonomy.js), so this
    // is the warning for the lead's own sessions, which nothing stops.
    try {
      const pv = planNow(now);
      if (pv.hasMeter) for (const x of pv.rooms.filter((x) => x.label === "over" || x.label === "heading over")) {
        const key = `plan:${pv.week.resetsAt}:${x.id}:${x.label}`; if (st.warned.includes(key)) continue;
        const lead = r.desks.find((d) => d.room === x.id && d.lead && d.status !== "retired");
        const line = x.label === "over"
          ? `Heads-up: ${x.name} has used about ${x.used}% of the plan's week, its whole ${x.budget}% share. Hub-started sessions for it are paused until the reset; keep your own sessions short.`
          : `Heads-up: ${x.name} is at about ${x.used}% of the plan's week and heading for ${x.projected}%, past its ${x.budget}% share. Slow down or ask ${OWNER()} for a bigger share.`;
        if (lead) sendText({ from, to: lead.id, kind: "finance", text: line });
        if (from !== "hr") sendText({ from, to: "hr", kind: "finance", text: line });
        st.warned.push(key); out.warned.push(`${x.id} (plan)`);
      }
    } catch (err) { console.warn(`Finance plan check: ${err.message}`); }
    // a whole project heading over its caps is the owner's call: an ask in his queue, once a month per project
    for (const x of f.rooms.filter((x) => x.over && x.api >= x.cap * FIN_MIN_SHARE)) {
      const key = `${f.month}:room:${x.id}`; if (st.warned.includes(key)) continue;
      try {
        addRequest(
          {
            kind: "ask",
            room: x.id,
            question: `${x.name} is heading for about $${x.projected} of API this month, over its $${x.cap} of caps. Raise the caps?`,
            why: `Finance: $${x.api} spent by day ${f.day} of ${f.days}. Say no and the caps hold (desks pause when they reach them).`,
          },
          from,
        );
      } catch {}
      st.warned.push(key); out.asked = [...(out.asked || []), x.id];
    }
  }
  // The weekly note: Mondays from 8 a.m., once a week, only when HR has a finance desk.
  const fd = financeDesk(r), week = `${today}`;
  if (fd && now.getDay() === 1 && now.getHours() >= 8 && st.noteDay !== week) {
    st.noteDay = week;
    const lines = [`Weekly money note for ${OWNER()}. Use only the numbers the hub attaches; say where the money went, where it's heading, and anything to act on, in under 150 words.`];
    addJob({ desk: fd.id, text: lines.join("\n") }).then((j) => { out.note = j?.id || null; }).catch((err) => console.warn(`Finance note: ${err.message}`));
  }
  try { writeJsonAtomic(FIN_STATE(), st, 0); } catch {}
  return out;
}

// The lending lead's answer (the owner can answer too, through decideRequest, or end a loan early with returnLoan).
export function answerLoan({ desk, request, decision, note } = {}) {
  const q = findOpen(request);
  if (q.kind !== "borrow") throw new Error("That isn't a loan ask.");
  if (slug(desk) !== q.ownerLead) throw new Error(`Only ${q.ownerLead || `${OWNER()}`} can answer this one.`);
  if (!DECISIONS.includes(decision)) throw new Error("Decision must be approved or declined.");
  const line = { id: q.id, at: new Date().toISOString(), by: q.ownerLead, decision, note: clip(note, 500) };
  appendJsonl(REQUESTS(), line);
  recordEvent(
    {
      desk: q.ownerLead,
      room: q.ownerRoom,
      action: decision === "approved" ? "lent a worker" : "loan declined",
      summary: decision === "approved" ? loanNote(q) : `${q.desk} stays home (${q.from} asked)`,
    },
    q.ownerLead,
  );
  if (decision === "approved" && q.handoff) autoHandOff({ ...q.handoff, job: null, approved: true }).catch((err) => console.warn(`Approved hand-off ${q.id}: ${err.message}`));
  sendText({ from: q.ownerLead, to: q.from, kind: "note", text: decision === "approved" ? `Sure, ${q.desk} is yours for ${q.hours} h.` : `Sorry, I need ${q.desk} here right now.${line.note ? ` ${line.note}` : ""}` });
  appendJsonl(OUTBOX(), { id: q.id, at: line.at, to: q.from, room: q.room, kind: "loan", about: q.role, decision, note: line.note || null });
  return line;
}
export function returnLoan({ request, by = ownerId() } = {}) {
  const l = activeLoans().find((x) => x.id === request);
  if (!l) throw new Error("No active loan by that id.");
  appendJsonl(REQUESTS(), { id: l.id, at: new Date().toISOString(), by: slug(by) || ownerId(), returned: true });
  recordEvent({ desk: l.desk, room: l.fromRoom, action: "back from loan", summary: `back from ${l.toRoom} (${by === "hub" ? "its job is done" : `sent back by ${slug(by) || ownerId()}`}): ${String(l.why || "").slice(0, 200)}` }, "hub");
  return { ...l, returned: true };
}

export { BOARD_LOG, boardHireCap, r2 };
