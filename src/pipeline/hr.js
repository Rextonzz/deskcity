// @ts-check
// HR desk (agent dashboard step 4, docs/agent-dashboard-scope.md).
// Project leads ask for staff (agents.js requests). HR doesn't design teams: it checks each new request against the
// room's current work, the roster (no duplicate desks) and the budget, then picks the cheapest provider, model and
// effort that can do the job. It only recommends: the verdict goes on the request, in the to-do list and to the
// phone, and the owner approves or declines on the Agents page.
// It also flags desks over their monthly API cap (no AI needed for that).
// HR runs as its own AI step, "hr_review" (Haiku by default, changeable on the AI page), so its own cost is logged.
import { askJSON, obj, str, num, bool, oneOf, arr } from "./claude.js";
import { PRICES, hasGemini } from "./ai.js";
import { creditStatus } from "./credits.js";
import { todoList } from "./todo.js";
import { sendAlert, dashboardLink } from "./notify.js";
import { withRun, onceJob } from "./runlog.js";
import {
  agentsOverview,
  requests,
  hrRecommend,
  strayDesks,
  aliasStray,
  openJobs,
  updateJob,
  addRequest,
  addRoom,
  addRoomNote,
  roster,
  DISTRICTS,
  PERKS,
  scoreCandidates,
  scoreBatchContent,
  setJobScore,
  recordEvent,
  JUDGE_SCALE,
  SCORE_SCHEMA,
  askAssistant,
  ensureAssistant,
  ensureSecurityRequest,
  tellOwner,
} from "./agents.js";
import { monthKey } from "./spend.js";
import { readJson, resolvePath, writeJsonAtomic, dayIn } from "./util.js";
import { ownerName as OWNER, hubTz } from "../hub/settings.js";
import { helperMay } from "../hub/helpers.js";
import { COMPAT, compatReady, providerConfig } from "./openai-compat.js";

// Over-cap desks are flagged once per desk per month, not every 3 hours.
const STATE = () => resolvePath("data/agents/hr-state.json");
export function flaggedThisMonth(now = new Date()) {
  const s = readJson(STATE(), {}), month = monthKey(now);
  return s.month === month ? s : { month, overCap: [] };
}

// What this hub can run (Hub kit step 2): Claude always; the others when their key is in .env (local needs none).
// Model names come from the hub settings ("providers": { "openai": { "models": ["..."] } }), filled in by setup.
export function providersLine() {
  const out = ["claude: claude-haiku-5-5, claude-sonnet-5-5, claude-opus-5-5 (and claude-code / antigravity for subscription work)"];
  if (hasGemini()) out.push("gemini: gemini-flash, gemini-pro");
  for (const p of Object.keys(COMPAT)) {
    try {
      if (compatReady(p)) {
        const c = providerConfig(p);
        out.push(
          `${p}: ${(c.models || []).join(", ") || "(no models listed: ask the lead which one)"}${c.free ? " (free, runs on this PC)" : ""}${c.prices ? ` prices ${JSON.stringify(c.prices)}` : ""}`,
        );
      }
    } catch {}
  }
  return out.join("\n");
}
const SCHEMA = obj({
  verdict: oneOf("approve", "approve-cheaper", "reuse", "decline"),
  alignment: str, // one or two sentences: fits the room's current work? duplicate of a desk? fits the budget?
  provider: oneOf("claude", "gemini", ...Object.keys(COMPAT), "other"),
  model: str,
  effort: oneOf("low", "medium", "high", "none"),
  capUsdMonth: num,
  reuseDesk: str, // desk id when verdict is reuse, else ""
  trial: bool, // true when a one-week side-by-side test (AI page) should prove the cheaper pick first
  note: str, // short, for the owner
});

const SYSTEM = () => `You are HR for ${OWNER()}'s AI staff. Project leads (PLs) ask for the staff they need; you do not design teams.
Your job for each request:
1. Verify alignment. Does the role fit what that room is working on now (its open to-dos and recent activity)? Is there already a desk on the roster that does this (then verdict "reuse" with its id)? Does the budget ask fit the room's spend and the API credit left?
2. Pick the cheapest provider, model and effort that can do the job well:
   - Checklists, sorting, short summaries, tagging, simple reviews: Claude Haiku (claude-haiku-5-5) at low effort, or Gemini Flash.
   - Code review, careful writing, judgment calls: Claude Sonnet (claude-sonnet-5-5), low or medium effort.
   - Only hard multi-step reasoning or large refactors: Claude Opus (claude-opus-5-5). Say why if you pick it.
   - Live X/Twitter trends: Grok (provider "grok"), the only provider that sees X live.
   - OpenAI, Grok, DeepSeek, Muse and local models (providers "openai", "grok", "deepseek", "muse", "local") can also be run by the hub, but only the ones listed under PROVIDERS ON THIS HUB; never pick one that isn't there. Use a model name listed for it. Local models cost nothing (capUsdMonth 0) but are slower and weaker: good for simple, private or bulk work. A provider with no price listed: set a small cap and say the cost is unknown.
   - Work done inside Claude Code or Antigravity runs on ${OWNER()}'s subscriptions (model "claude-code" or "antigravity"): no extra money, but it uses their weekly limits. Prefer these for repo work when the room already uses them.
   Use the price table (USD per million tokens) to compare. Cheaper model at higher effort can beat a bigger model at low effort.
3. Verdicts: "approve" (as asked), "approve-cheaper" (yes, but on the cheaper model you picked), "reuse" (an existing desk covers it), "decline" (doesn't fit current work, duplicates, or no budget).
4. capUsdMonth: real API money per month for this desk (0 for subscription or Grok). Never more than the lead asked, and never more than the credit left.
5. trial = true when you picked a cheaper model than the lead suggested and the work matters, so a one-week side-by-side test proves it first.
Keep "alignment" and "note" short and plain. You only recommend; ${OWNER()} decides.`;

// The models HR may name, with prices, so it can compare.
function priceTable() {
  return Object.entries(PRICES)
    .filter(([m]) => /^claude-(haiku|sonnet|opus)-5-5$|^gemini-(3\.8-flash|3\.1-pro|2\.5-flash-lite)$/.test(m))
    .map(([m, p]) => `${m}: in ${p.in}, out ${p.out}`)
    .join("\n");
}

function context(req, overview, credits) {
  const room = overview.rooms.find((r) => r.id === req.room);
  const roomName = room?.name || req.room;
  const words = roomName.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const todos = todoList()
    .items.filter((t) => ["open", "doing"].includes(t.status))
    .filter((t) => words.some((w) => `${t.category} ${t.title}`.toLowerCase().includes(w)))
    .slice(0, 15)
    .map((t) => `- [${t.status}] ${t.title}`);
  const desks = overview.desks.map(
    (d) =>
      `- ${d.id} (room ${d.room}${d.lead ? ", lead" : ""}, ${d.status}): ${d.role}; ${[d.provider, d.model, d.effort].filter(Boolean).join(" ")}; this month ${d.monthEvents} events, $${d.monthUsd} API, $${d.monthSubUsd} subscription-equivalent${d.capUsdMonth != null ? `, cap $${d.capUsdMonth}` : ""}`,
  );
  const recent = overview.feed.filter((f) => f.room === req.room).slice(0, 10).map((f) => `- ${f.startedAt.slice(0, 10)} ${f.desk || ""} ${f.action || f.kind} ${f.summary || ""}`);
  // Money figures come from the finance desk's numbers (agents.js financeView): month-end projection and caps.
  const f = overview.finance, fr = f?.rooms.find((x) => x.id === req.room);
  const money = f
    ? [
        `Day ${f.day} of ${f.days}. All projects: $${f.total.api} API so far, projected $${f.total.projected} against $${f.total.cap} of caps.`,
        fr
          ? `This project: $${fr.api} API, projected $${fr.projected}${fr.cap ? ` of $${fr.cap} caps${fr.over ? " (OVER)" : ""}` : ""}.`
          : "This project: no API spend yet.",
        `Board hire budget: $${f.board.spent} of $${f.board.limit} used.`,
        ...f.warnings.slice(0, 5).map((w) => `On track to pass its cap: ${w.id} ($${w.api} of $${w.cap}, projected $${w.projected})`),
      ]
    : [];
  const credit = Object.entries(credits.providers).map(([id, c]) => `${id}: ${c.left == null ? "balance not set" : `$${c.left} left`}, about $${c.perDay}/day`);
  return `REQUEST
Room: ${roomName} (${req.room}), project ${room?.status === "paused" ? `PAUSED by ${OWNER()}: decline unless the request is the lead ${OWNER()} asked for when starting it` : "running"}
From: ${req.from}
Role: ${req.role}
Why: ${req.why || "(not given)"}
Needs: ${req.needs || "(not given)"}
Urgency: ${req.urgency}
Lead suggests: ${req.suggested ? [req.suggested.provider, req.suggested.model, req.suggested.effort].filter(Boolean).join(" ") : "(nothing)"}
Budget ask: ${req.budgetAsk == null ? "(not given)" : `$${req.budgetAsk}/month`}

ROOM'S OPEN TO-DOS
${todos.join("\n") || "(none found)"}

ROOM'S RECENT ACTIVITY
${recent.join("\n") || "(none)"}

ROSTER
${desks.join("\n")}

PROVIDERS ON THIS HUB
${providersLine()}

FINANCE (from the finance desk)
${money.join("\n") || "(not available)"}

API CREDIT
${credit.join("\n")}

PRICES (USD per million tokens)
${priceTable()}`;
}

// HR's own monthly cap (money safety F3, 2026-11-16): the "hr" desk's capUsdMonth, checked before every model call HR
// makes, the button's too. null when there's room (or no cap), else the message.
export function hrCapStop() {
  const d = agentsOverview().desks.find((x) => x.id === "hr");
  if (!d || d.capUsdMonth == null || (d.monthUsd || 0) < d.capUsdMonth) return null;
  return `HR has used its $${d.capUsdMonth} cap this month ($${(d.monthUsd || 0).toFixed(2)}), so it makes no AI calls until next month. Raise its cap on its desk card to go on.`;
}
async function hrAsk(args) {
  const stop = hrCapStop();
  if (stop) throw new Error(stop);
  return askJSON(args);
}
// Reviews every request still waiting for HR, then flags desks over cap. Costs nothing when there's nothing new.
export function runHr({ trigger = "auto" } = {}) {
  if (trigger === "button") { const stop = hrCapStop(); if (stop) return Promise.reject(new Error(stop)); }
  return onceJob("hr", () => review(trigger));
}

// Workers reporting under names that aren't on the roster (the owner 2026-11-09, "HR should catch these"). No AI: a stray
// that clearly matches one desk in its room becomes that desk's alias; anything else goes on the owner's to-do list once
// ("alias of which desk, or a new hire?").
function checkStrays() {
  const s = flaggedThisMonth();
  const seen = new Set(s.strays || []);
  const mapped = [], asked = [];
  for (const st of strayDesks()) {
    const to = aliasStray(st);
    if (to) {
      mapped.push(`${st.id} → ${to}`);
      tellOwner({
        title: `HR: ${st.id} is now an alias of ${to}`,
        detail: `${st.count} report${st.count === 1 ? "" : "s"} in ${st.room} came in as "${st.id}". They count for ${to} now. Undo by removing the alias from its desk.`,
        source: "hr",
      });
    } else if (!seen.has(st.id)) {
      asked.push(st.id);
      tellOwner({
        title: `HR: unknown worker "${st.id}" in ${st.room}`,
        detail: `${st.count} report${st.count === 1 ? "" : "s"}, latest: ${String(st.sample || "").slice(0, 160)}. Add it as an alias of the desk it belongs to, or hire it as a desk on the Agents page.`,
        source: "hr",
      });
    }
  }
  if (asked.length) writeJsonAtomic(STATE(), { ...flaggedThisMonth(), strays: [...seen, ...asked] });
  return { mapped, asked };
}

// Teams (the owner 2026-11-09, "HR files hiring requests itself"): a job for the HR desk such as "build an R&D team, two
// lanes, $10 a month each" no longer waits for a person. HR designs the seats, makes the room when the project has
// none, and files one staff request per seat with the hiring details filled in (desk name, floor, lead, the hub runs
// it, cap, first job). the owner still approves each request; approving hires the desk and queues its first job. Jobs that
// aren't about staffing are left open for the owner and asked about once.
const TEAM = obj({
  isTeam: bool, // false when the job isn't about hiring or building a team
  room: obj({ id: str, name: str, district: oneOf("Creative", "Games", "Tools", "") }), // id "" when unclear
  seats: arr(obj({ deskId: str, role: str, floor: str, lead: bool, provider: oneOf("claude", "gemini"), model: str, effort: oneOf("low", "medium", "high"), budget: num, why: str, firstJob: str })),
  relay: obj({ rooms: arr(str), message: str }), // a message or standing rule to pass on to these rooms' teams
  reply: str, // one or two sentences for the owner
});
const TEAM_SYSTEM = () => `You are HR for ${OWNER()}'s AI staff. ${OWNER()} gave you a job. If it asks you to build, staff or hire a team (or some desks), design the team; otherwise set isTeam false and leave seats empty.
If instead it asks you to tell, let know, or pass something on to one or more teams (a message, a permission, a rule), put their room ids in relay.rooms and the message in relay.message, rewritten as a clear standing note to that team in ${OWNER()}'s voice ("${OWNER()} says: ..."), keeping every condition they gave. Otherwise leave relay.rooms empty.
Rules:
- Use the room the job names when it's on the roster (its id). If the project has no room, give a short new id (lowercase, dashes) and name, and pick its district: Creative (video, art, writing), Games, or Tools (everything else).
- At most 8 seats. Exactly one seat is the lead (lead true) unless the room already has a lead. Never duplicate a desk already on the roster.
- deskId: short, lowercase, dashes, unique, e.g. "rnd-ideas-scout". floor: the work stream or lane the seat sits in (a few words, e.g. "Ideas lab"); seats in one lane share a floor.
- Model and effort: the cheapest that can do the seat. Checklists, sorting, short summaries: claude-haiku-5-5 low, or gemini-flash. Careful writing, judgment, code review: claude-sonnet-5-5 low or medium. Only hard multi-step reasoning: claude-opus-5-5. Long reading or video: gemini-pro. If ${OWNER()} names models, follow them.
- budget: USD per month for the seat. Follow ${OWNER()}'s numbers when they give them; otherwise 2 for Haiku or Flash, 5 for Sonnet or Pro, 10 for Opus.
- firstJob: a concrete first task the seat can finish in one run, in one or two sentences.
- why: one sentence on what the seat is for. reply: one or two sentences for ${OWNER()}.`;

const STORE_SCHEMA = obj({ verdict: oneOf("approve", "decline"), label: str, icon: str, cat: oneOf("desk", "home", "yard", "wear", "pets"), cost: num, note: str });
const STORE_SYSTEM = () => `You are HR for ${OWNER()}'s cozy AI office campus. A worker suggested a new item for the Campus Mart, the little shop where workers spend credits they earn (about 20 to 40 a week) on cosmetic things for their desk, home, yard, outfit, or a pet.
Approve it unless it's not family-friendly, names a real brand or person, isn't a cosmetic thing, or the Mart already sells the same thing. Tidy the label ("a ukulele"), keep one fitting emoji, pick the category, and set a fair price in credits next to similar things already sold (small trinkets 3 to 8, furniture 10 to 30, big dreams 40 to 60). note: one short line for ${OWNER()}.`;
// Job checks give each finished job its quality score, which sets its pay (agents/quality.js). Up to JOB_BATCH jobs in
// one call, at most JOB_CHECKS_DAY a day.
const JOB_CHECKS_DAY = 20, JOB_BATCH = 10;
const JOB_SYSTEM = () => `You are HR for ${OWNER()}'s AI staff, scoring finished jobs; the score sets the worker's pay. For each job, ask one strict question: would ${OWNER()} act on this result, or does it move their project forward? Reward concrete, specific, correct-looking work (a plan, findings, a draft, a decision). ${JUDGE_SCALE} Be strict: when in doubt, score lower. why: one short line. If the work looks wrong or shallow because the task was too hard for that desk's model, start why with "Model too weak:" so the desk can be moved up a tier (${OWNER()}'s rule: a cheap model that produces garbage costs more than the right one). Answer for every job id given.`;
async function planTeams(run, state) {
  const jobsForHr = openJobs({ desk: "hr" }).filter((j) => !(state.askedJobs2 || []).includes(j.id)).slice(0, 3);
  const out = [];
  for (const j of jobsForHr) {
    run.step(`team job ${j.id}`);
    try {
      const r = roster();
      const roomsList = r.rooms.map((x) => `${x.id} (${x.name}): ${r.desks.filter((d) => d.room === x.id && d.status !== "retired").map((d) => `${d.id}${d.lead ? " [lead]" : ""}`).join(", ") || "no desks"}`).join("\n");
      const a = await hrAsk({ name: "hr_review", system: TEAM_SYSTEM(), content: `Job from ${OWNER()}:\n${j.text}\n\nRooms and desks on the roster:\n${roomsList}`, schema: TEAM, effort: "low" });
      const relayRooms = (a.relay?.rooms || []).filter((id) => r.rooms.some((x) => x.id === id));
      if (!a.isTeam && relayRooms.length && a.relay.message) {
        // Pass it on (the owner 2026-11-09: "let R&D know they can ..."): a text to each room's lead, and a standing note
        // the room's hub-run desks read with every job.
        const sent = relayRooms.map((id) => addRoomNote(id, a.relay.message, "hr"));
        updateJob(j.id, { status: "done", summary: `Passed on to ${sent.map((x) => x.name).join(", ")}: ${a.relay.message}`.slice(0, 500) }, "hr");
        out.push({ job: j.id, relayed: sent.map((x) => x.id) });
        continue;
      }
      if (!a.isTeam || !a.seats?.length) {
        state.askedJobs2 = [...(state.askedJobs2 || []), j.id];
        tellOwner({
          title: `HR job needs you: ${j.text.split("\n")[0]}`.slice(0, 200),
          detail: `HR can't do this one by itself (it builds teams and passes messages on to teams). ${a.reply || ""}`.trim(),
          source: "hr",
        });
        out.push({ job: j.id, filed: 0 });
        continue;
      }
      const room = addRoom({ id: a.room.id, name: a.room.name || a.room.id, district: DISTRICTS.includes(a.room.district) ? a.room.district : undefined });
      const taken = new Set([...r.desks.map((d) => d.id), ...requests({ open: true }).map((q) => q.deskId).filter(Boolean)]);
      const hasLead = r.desks.some((d) => d.room === room.id && d.lead && d.status !== "retired");
      let leadGiven = hasLead;
      const filed = [];
      for (const s of a.seats.slice(0, 8)) {
        let id = String(s.deskId || s.role).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "desk";
        for (let n = 2; taken.has(id); n++) id = `${id.replace(/-\d+$/, "")}-${n}`;
        taken.add(id);
        const lead = !!s.lead && !leadGiven;
        if (lead) leadGiven = true;
        const req = addRequest(
          {
            room: room.id,
            role: s.role,
            why: s.why || `Part of the team ${OWNER()} asked for (HR job ${j.id}).`,
            budgetAsk: Math.max(0, Number(s.budget) || 0),
            deskId: id,
            floor: s.floor,
            lead,
            runner: "hub",
            firstJob: s.firstJob,
            suggested: { provider: s.provider, model: s.model, effort: s.effort },
          },
          "hr",
        );
        filed.push(`${id} (${s.model}, $${req.budgetAsk ?? 0}/mo${lead ? ", lead" : ""})`);
      }
      updateJob(
        j.id,
        {
          status: "done",
          summary:
            `Filed ${filed.length} hiring request${filed.length === 1 ? "" : "s"} for ${room.name}${room.existed ? "" : " (new room)"}: ${filed.join("; ")}`.slice(
              0,
              500,
            ),
          result: `${a.reply}\n\n${filed.map((f) => `- ${f}`).join("\n")}\n\nApprove each one on the Agents page; approving hires the desk and queues its first job.`,
        },
        "hr",
      );
      out.push({ job: j.id, filed: filed.length, room: room.id, newRoom: !room.existed });
    } catch (err) {
      run.warn(`team job ${j.id}: ${err.message}`);
    }
  }
  return out;
}

// The assistant's second look at HR's pick (the owner 2026-11-11).
const SECOND = obj({ agree: bool, reuseDesk: str, note: str });
const SECOND_SYSTEM = () => `HR has reviewed a staff request and made a pick. Give a second opinion. Check three things: is an idle worker already a fit (then put its desk id in reuseDesk); is there a cheaper provider or model on this hub that would do the job as well; is the monthly cap sensible for the work described. Set agree to true when HR's pick is sound, even if you'd have chosen slightly differently. When you disagree, say why in one or two plain sentences in note, for ${OWNER()}. reuseDesk is "" unless you'd reuse someone.`;

async function review(trigger) {
  try { await ensureAssistant(); } catch (err) { console.warn(`Assistant seat: ${err.message}`); }
  try { ensureSecurityRequest(); } catch (err) { console.warn(`Security reviewer request: ${err.message}`); }
  let strays = { mapped: [], asked: [] };
  try {
    strays = checkStrays();
  } catch (err) {
    console.warn(`HR stray check: ${err.message}`);
  }
  // AI helpers (Admin > AI helpers): HR's timer, a team job and a store idea only reach a model when the owner has the
  // helpers on and today's limit isn't used up. The owner's own "Run HR" button always works.
  // With the helpers off only the model parts are skipped: the over-cap flagging below still runs.
  const ai = (trigger === "button" || helperMay("hr").ok) && !hrCapStop(); // and never past HR's own cap
  // Asks (non-staff needs) go straight to the owner; HR only checks staff requests.
  let flagged = flaggedThisMonth();
  const teamJobs = ai ? openJobs({ desk: "hr" }).filter((j) => !(flagged.askedJobs2 || []).includes(j.id)) : [];
  const overview0 = agentsOverview();
  const over0 = overview0.desks.filter((d) => d.overCap && d.status === "active" && !flagged.overCap.includes(d.id));
  const checkable = ai && scoreCandidates().length > 0;
  if (!teamJobs.length && !over0.length && !checkable && !(ai && requests().some((r) => r.status === "new" && r.kind !== "ask"))) return { reviewed: 0, overCap: 0, strays };
  return withRun("hr review", { trigger }, async (run) => {
    const done = [];
    // Team jobs first, so the requests HR files are checked in this same run.
    const teams = teamJobs.length ? await planTeams(run, flagged) : [];
    if (teams.length) { writeJsonAtomic(STATE(), flagged); flagged = flaggedThisMonth(); }
    const fresh = (ai ? requests() : []).filter((r) => r.status === "new" && r.kind !== "ask" && r.kind !== "store");
    const storeIdeas = (ai ? requests() : []).filter((r) => r.status === "new" && r.kind === "store");
    const overview = agentsOverview();
    const over = overview.desks.filter((d) => d.overCap && d.status === "active" && !flagged.overCap.includes(d.id));
    const credits = creditStatus();
    for (const req of fresh.slice(0, 10)) {
      run.step(`request ${req.id}`);
      try {
        const a = await hrAsk({ name: "hr_review", system: SYSTEM(), content: context(req, overview, credits), schema: SCHEMA, effort: "low" });
        // Never above the lead's ask, nor above the API credit left for that provider (when the balance is set).
        const left = credits.providers[a.provider]?.left;
        const cap = Math.max(0, Math.min(a.capUsdMonth || 0, req.budgetAsk ?? Infinity, left ?? Infinity));
        // Second opinion from the shared assistant (a different model): does it agree, and is an idle worker a fit?
        let second = "";
        try {
          const o = await askAssistant({
            system: SECOND_SYSTEM(),
            schema: SECOND,
            content: `${context(req, overview, credits)}\n\nHR's pick: ${JSON.stringify({ verdict: a.verdict, provider: a.provider, model: a.model, effort: a.effort, capUsdMonth: cap, reuseDesk: a.reuseDesk || "", note: a.note })}`,
          });
          if (o && typeof o.answer?.agree === "boolean")
            second = o.answer.agree
              ? `Assistant (${o.desk.model}) agrees.`
              : `Assistant (${o.desk.model}) disagrees: ${String(o.answer.note || "").slice(0, 300)}${o.answer.reuseDesk ? ` It would reuse ${o.answer.reuseDesk}.` : ""}`;
        } catch (err) { run.warn(`assistant on ${req.id}: ${err.message}`); }
        const note = [a.alignment, a.note, a.trial ? "Suggest a one-week side-by-side test on the AI page first." : "", second].filter(Boolean).join(" ");
        hrRecommend(req.id, { verdict: a.verdict, provider: a.provider, model: a.model, effort: a.effort === "none" ? null : a.effort, capUsdMonth: cap, reuseDesk: a.reuseDesk || null, note });
        const pick = a.verdict === "decline" ? "decline" : a.verdict === "reuse" ? `reuse ${a.reuseDesk}` : `${a.model}${a.effort && a.effort !== "none" ? ` @${a.effort}` : ""}, cap $${cap}/mo`;
        tellOwner({ title: `HR: ${req.role} (${req.room}) — ${a.verdict}`.slice(0, 200), detail: `${pick}. ${note}`, source: "hr" });
        done.push({ id: req.id, role: req.role, verdict: a.verdict, pick });
      } catch (err) {
        run.warn(`request ${req.id}: ${err.message}`);
      }
    }
    // Store ideas from workers: HR checks fit (family-friendly, cosmetic, not a duplicate) and sets a fair price.
    for (const req of storeIdeas.slice(0, 5)) {
      run.step(`store idea ${req.id}`);
      try {
        const a = await hrAsk({
          name: "hr_review",
          system: STORE_SYSTEM(),
          content: `Idea from ${req.from}: ${req.item.icon} ${req.item.label} (${req.item.cat}, asks ${req.item.cost} credits). Why: ${req.why || "-"}\nAlready in the Mart (label, price): ${Object.values(
            PERKS,
          )
            .map((p) => `${p.label} ${p.cost}`)
            .join("; ")}`,
          schema: STORE_SCHEMA,
          effort: "low",
        });
        const verdict = a.verdict === "decline" ? "decline" : "approve";
        hrRecommend(req.id, { verdict, note: a.note, item: { label: a.label || req.item.label, icon: a.icon || req.item.icon, cat: a.cat, cost: a.cost } });
        done.push({ id: req.id, role: req.role, verdict, pick: verdict === "decline" ? "decline" : `${a.cost} credits` });
      } catch (err) {
        run.warn(`store idea ${req.id}: ${err.message}`);
      }
    }
    // Job checks (the owner 2026-11-09: "can the lead or HR evaluate the job ... we can batch them"; 2026-11-14: scores are
    // the pay standard): finished jobs with a saved result and no score yet, checked together in one call, at most
    // JOB_CHECKS_DAY a day. The score is the job's quality (0-100); the owner's or the lead's 👍 / 👎 still overrides it.
    let rated = 0;
    try {
      const st = flaggedThisMonth(), today = dayIn(hubTz()), usedToday = st.checksDay === today ? st.checks || 0 : 0;
      const todo = (ai ? scoreCandidates() : []).slice(0, Math.max(0, Math.min(JOB_BATCH, JOB_CHECKS_DAY - usedToday)));
      if (todo.length) {
        run.step(`job check x${todo.length}`);
        const a = await hrAsk({ name: "hr_review", system: JOB_SYSTEM(), content: scoreBatchContent(todo), schema: SCORE_SCHEMA, effort: "low" });
        const lines = [];
        for (const x of a.ratings || []) {
          const j = todo.find((t) => t.id === x.job);
          if (!j || !Number.isFinite(Number(x.score))) continue;
          try { const s = setJobScore(j.id, x.score, { by: "hr", why: x.why }); rated++; lines.push(`${j.desk} ${s.score}`); } catch {}
        }
        if (lines.length) recordEvent({ desk: "hr", room: "hr", action: "scored jobs", summary: `quality scores: ${lines.join(", ")}`.slice(0, 200) }, "hr");
        writeJsonAtomic(STATE(), { ...flaggedThisMonth(), checksDay: today, checks: usedToday + todo.length });
      }
    } catch (err) { run.warn(`job checks: ${err.message}`); }
    if (over.length) { const st = flaggedThisMonth(); writeJsonAtomic(STATE(), { ...st, overCap: [...(st.overCap || []), ...over.map((d) => d.id)] }); } // a fresh read, so the job-check counter written above isn't wiped
    for (const d of over) {
      const detail = `$${d.monthUsd} API this month against a $${d.capUsdMonth} cap. Pause it, raise the cap, or move it to a cheaper model.`;
      tellOwner({ title: `HR: ${d.id} is over its monthly cap`, detail, source: "hr" });
      // The to-do page is off in some presets (the kit's Standard one), so the same note also goes into Waiting for
      // you as one ask per worker: that list is on in every preset. No model is asked.
      try {
        const question = `${d.id} is over its monthly cap`;
        if (!requests({ open: true }).some((q) => q.kind === "ask" && q.from === "hr" && q.role === question)) addRequest({ kind: "ask", room: d.room, question, why: detail }, "hr");
      } catch (err) { run.warn(`cap note for ${d.id}: ${err.message}`); }
    }
    const teamLines = [
      ...teams.filter((t) => t.relayed).map((t) => `Passed on to ${t.relayed.join(", ")}`),
      ...teams
        .filter((t) => t.filed)
        .map((t) => `Team for ${t.room}${t.newRoom ? " (new room)" : ""}: ${t.filed} hiring request${t.filed === 1 ? "" : "s"} filed`),
    ];
    if (done.length || over.length || teamLines.length) {
      const lines = [...teamLines, ...done.map((x) => `${x.role}: ${x.verdict} (${x.pick})`), ...over.map((d) => `${d.id} over cap`)];
      await sendAlert({
        title: `HR: ${done.length} request${done.length === 1 ? "" : "s"} checked${over.length ? `, ${over.length} over cap` : ""}`,
        message: lines.join("\n").slice(0, 900),
        kind: "hr",
        url: dashboardLink("/agents.html"),
      }).catch((err) => run.warn(`alert: ${err.message}`));
    }
    return { result: run.end({ reviewed: done.length, overCap: over.length, teams, rated, strays }) };
  });
}
