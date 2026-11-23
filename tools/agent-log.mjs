#!/usr/bin/env node
// One command any process on this PC can use to report to the hub's Agents page or ask HR for staff
// (docs/agent-onboarding.md). It reads the key from data/agents/token.txt, so nothing secret goes on the command line.
//
//   node tools/agent-log.mjs event   --desk myproject-gemini --room myproject --summary "wrote faction lore" [--provider gemini] [--model gemini-3.1-pro] [--in 12000 --out 900] [--billing subscription|api] [--action note]
//   node tools/agent-log.mjs ask     --from myproject-lead --room myproject --question "OK to spend $10 on the art service this month?" [--why "..."] [--urgency high]
//   node tools/agent-log.mjs ask     --from myproject-lead --room myproject --question "OK to merge #144 (the PR's title)?" --pr 144   (approving sends "OK to merge")
//   node tools/agent-log.mjs ask     --from myproject-lead --room myproject --question "Give us Repo housekeeping?" --grant repo-tidy [--desks a,b]   (approving turns that access on for those desks; default --from)
//   node tools/agent-log.mjs inbox   --desk myproject-lead   (or --room myproject): the owner's answers, newest first
//   node tools/agent-log.mjs jobs    --desk myproject-lead   jobs the owner gave this desk that are still open
//   node tools/agent-log.mjs take    --job <id> --desk <desk>          / done --job <id> --summary "..." [--result-file out.md]  / fail --job <id> --summary "why"
//   node tools/agent-log.mjs jobs    --desk <desk> --json            one JSON line per open job, for scripts
//   node tools/agent-log.mjs handoff --desk <you> --to <desk> --text "what they should do" [--job <id>] [--result-file out.md] [--file a.json,b.md]
//        pass your work on to another desk (any project, Claude or Gemini); with --job it also marks that job done.
//        Files named in --text (or --file) go along, so a worker the hub runs, which can't open files here, gets them.
//   node tools/agent-log.mjs rate    --desk <lead> --job <id> --useful yes|no [--why "..."]
//        a lead rates its project's finished job: was it worth acting on? (a cheap, useful one earns a thrift bonus)
//   node tools/agent-log.mjs vote    --desk <you> --request <id> --vote yes|no [--why "..."]
//        board members (the project's lead) back or object to a request; a "no" sends it to the owner
//   node tools/agent-log.mjs desks   who you can hand work to
//   node tools/agent-log.mjs watch   --desk <desk> --room <room> --what "<blocker>" --check github-release --repo owner/name --match "53.17" [--alert "..."] [--every-hours 24]
//        also: --check url-contains --url https://... --text "..."   or   --check file-exists --path "C:/..."
//        the hub checks it (once a day by default), alerts the owner when it clears, tells you in your inbox, and closes it
//   node tools/agent-log.mjs borrow  --from <your lead desk> --desk <their worker> --hours 4 --why "lore check for the quest text"
//        borrow another project's worker (up to 24 h); its lead answers, and you hear back in your inbox
//   node tools/agent-log.mjs lend    --desk <your lead desk> --request <id> --decision approved|declined [--note "..."]
//        answer a loan ask for one of your workers (they show at the top of your inbox)
//   node tools/agent-log.mjs request --from myproject-lead --room myproject --role "PR reviewer" --why "6 PRs waiting" [--urgency low|normal|high] [--provider claude --model sonnet --effort low] [--budget 5] [--needs "GitHub read access"]
//
// Prints what the hub saved. Exits 1 (with the reason) if the hub is off or refused it.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { ownerName as OWNER, hubFolder as HUB_DIR } from "../src/hub/settings.js";
import { HUB_URL as HUB, hubToken } from "./hub-env.mjs";
// the hub this script belongs to (its data/ folder is never sent)
const HUB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [kind, ...rest] = process.argv.slice(2);
const opt = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith("--")) opt[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : "true";

function usage(msg) {
  if (msg) console.error(msg);
  console.error('Usage: agent-log.mjs event --desk <id> --room <room> --summary "..."  |  request --from <lead desk> --room <room> --role "..." --why "..."  |  ask --from <lead desk> --room <room> --question "..."  |  inbox --desk <lead desk>  |  jobs --desk <desk>  |  take|done|fail --job <id> [--summary "..."]');
  process.exit(1);
}

// Files a hand-off names (in --text, or --file "a.json,b.md"), sent along so a worker the hub runs, which can't open
// files on this PC, still gets them (the owner 2026-11-11: raid-logs-qa got paths it couldn't read). Small text files go
// whole; big or binary ones are named as skipped, so the hub can say so.
// This runs outside the session's Read fence (leadfence.js), so it keeps its own: only files inside the session's
// project folder (the one the hub started it in, HUB_SESSION_FOLDER; else the git checkout it runs in, or its
// folder), and never a private one (privateFile). Those are
// named as "not sent", never read (security audit 2026-11-11, finding 1).
const KEY_NAME = /^(\.env(\..*)?|.+\.env|id_.*|hosts\.ya?ml|\.git-credentials|\.?credentials(\.json)?|auth\.json|\.netrc|export_credentials\.cfg|.*keystore\.properties|local\.properties|\.npmrc|\.pypirc|(token|tokens|secret|secrets)(\..*)?|.+\.(pem|key|p12|pfx|keystore|jks|ppk|kdbx))$/i;
const HOME_PRIVATE = [".ssh", ".aws", ".config/gh", "AppData/Roaming/GitHub CLI", ".claude", ".gemini", ".codex", ".copilot", ".gnupg", ".docker", ".kube", ".azure"];
function inside(p, dir) {
  const rel = path.relative(dir, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
function privateFile(p, { hub, home } = {}) {
  if (KEY_NAME.test(path.basename(p))) return true;
  if (path.resolve(p).split(/[\\/]/).includes(".git")) return true;
  if (hub && (inside(p, path.join(hub, "data")) || inside(p, path.join(hub, ".chrome-profile")))) return true; // .chrome-profile: the signed-in Studio and TikTok sessions
  return !!home && HOME_PRIVATE.some((d) => inside(p, path.join(home, d)));
}
// The session's project: the nearest folder at or above `dir` with a .git, else `dir` itself.
function projectOf(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git"))) return d;
    if (path.dirname(d) === d) return path.resolve(dir);
  }
}
function filesIn(text, extra, { hub, home, project } = {}) {
  const seen = new Set(), out = [];
  const words = [...String(text || "").split(/[\s"'`<>()]+/), ...String(extra || "").split(",")].map((w) => w.trim().replace(/[.,;:!?]+$/, "")).filter((w) => /[\\/.]/.test(w) && w.length < 300);
  // checked on the path as named and on where it really leads (a link inside the project to ~/.ssh is still private)
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  const named = { hub, home }, actual = { hub: hub && real(hub), home: home && real(home) };
  const proj = project ? real(project) : null;
  let total = 0;
  for (const w of words) {
    if (out.length >= 8) break;
    let p, rp;
    try { p = path.resolve(w); if (seen.has(p) || !fs.statSync(p).isFile()) continue; rp = real(p); } catch { continue; }
    seen.add(p);
    if (privateFile(p, named) || privateFile(rp, named) || privateFile(rp, actual)) { out.push({ name: w, skipped: "private" }); continue; }
    if (!proj || !inside(rp, proj)) { out.push({ name: w, skipped: "outside the project folder" }); continue; }
    const size = fs.statSync(rp).size;
    if (size > 60000 || total + size > 150000) { out.push({ name: w, size, skipped: "too big to send" }); continue; }
    const buf = fs.readFileSync(rp);
    if (buf.includes(0)) { out.push({ name: w, size, skipped: "not a text file" }); continue; }
    total += size;
    out.push({ name: w, size, text: buf.toString("utf8") });
  }
  return out;
}
// One row per subcommand: need(opt) gives the usage message when a flag is missing, url is the hub
// route, body(opt, kind) is what is posted, print(out, opt) shows what the hub answered. take|done|fail share one row.
const WHERE = () => ({ hub: HUB_ROOT, home: os.homedir(), project: process.env.HUB_SESSION_FOLDER || projectOf(process.cwd()) });
// --result-file goes to the hub as well, so it keeps the same fence: never a private file (privateFile).
function readResult(file) {
  const p = path.resolve(file), w = WHERE();
  let rp = p; try { rp = fs.realpathSync.native(p); } catch {}
  if (privateFile(p, w) || privateFile(rp, w)) usage(`${file} is private (a key, a .env, sign-ins or the hub's data), so it isn't sent to the hub.`);
  // Same as files named in a hand-off text: only inside the session's own project folder.
  if (!w.project || !inside(rp, w.project)) usage(`${file} is outside the project folder, so it isn't sent to the hub. Put the result file inside the project.`);
  return fs.readFileSync(rp, "utf8");
}
const JOB_STATUS = { take: "taken", done: "done", fail: "failed" };
const jobRow = {
  url: "job", need: (o) => !o.job && "--job is required.",
  body: (o, kind) => {
    const b = { id: o.job, status: JOB_STATUS[kind], summary: o.summary, from: o.from || o.desk };
    // done --result-file <file>: hand in the full result (saved on the hub, passed on to the next desk of a chain)
    if (kind === "done" && o["result-file"]) b.result = readResult(o["result-file"]).slice(0, 20000);
    return b;
  },
  print: (out) => console.log(`Job ${out.id} is now ${out.status}.`),
};
const COMMANDS = {
  event: { url: "event", need: (o) => !o.desk && "--desk is required.",
    body: (o) => ({ source: o.source || o.desk, desk: o.desk, room: o.room, action: o.action || "note", tool: o.tool, summary: o.summary, provider: o.provider, model: o.model, effort: o.effort, inputTokens: o.in, outputTokens: o.out, costUsd: o.cost, billing: o.billing || "subscription" }),
    print: (out) => console.log(`Logged for ${out.desk}${out.costUsd ? ` ($${out.costUsd})` : ""}.`) },
  request: { url: "request", need: (o) => (!o.room || !o.role) && "--room and --role are required.",
    body: (o) => ({ from: o.from || "agent", room: o.room, role: o.role, why: o.why, needs: o.needs, urgency: o.urgency, budgetAsk: o.budget, suggested: o.model || o.provider ? { provider: o.provider, model: o.model, effort: o.effort } : null }),
    print: (out) => console.log(`Request ${out.id} filed for ${out.room}: ${out.role}. HR checks it within 3 hours.`) },
  ask: { url: "ask", need: (o) => (!o.room || !o.question) && "--room and --question are required.",
    // --grant <access id> [--desks a,b]: an access ask; approving it turns that access on for those desks (default: --from)
    body: (o) => ({ from: o.from || "agent", room: o.room, question: o.question, why: o.why, urgency: o.urgency, pr: o.pr, grant: o.grant, desks: o.desks }),
    print: (out) => console.log(`Asked ${OWNER()} (${out.id}): ${out.role}${out.pr ? ` [PR #${out.pr}]` : ""}${out.grant ? ` [approving turns on ${out.grant.id} for ${out.grant.desks.join(", ")}]` : ""}\nTheir answer will show in "agent-log.mjs inbox".`) },
  inbox: { url: "inbox", need: (o) => !o.desk && !o.room && "--desk or --room is required.",
    body: (o) => ({ desk: o.desk, room: o.room, limit: o.limit }),
    print: (out) => {
      if (!out.length) console.log("No answers yet.");
      for (const m of out) { console.log(`${m.at.slice(0, 16).replace("T", " ")}  ${m.decision.toUpperCase()}  ${m.kind === "ask" ? "ask" : m.kind || "staff"}${m.pr ? ` #${m.pr}` : ""}: ${m.about}${m.note ? `  (note: ${m.note})` : ""}  [${m.id}]`); if (m.result) console.log(`    --- result ---\n${String(m.result).split("\n").map((l) => "    " + l).join("\n")}\n    --- end ---`); }
    },
  },
  jobs: { url: "jobs", need: (o) => !o.desk && !o.room && "--desk or --room is required.",
    body: (o) => ({ desk: o.desk, room: o.room }),
    print: (out, o) => {
      // --json: one JSON object per line (id, desk, status, text, then, step, of), for scripts
      if (o.json) { for (const j of out) console.log(JSON.stringify({ id: j.id, desk: j.desk, status: j.status, text: j.text, then: j.then || [], step: j.step || null, of: j.of || null })); return; }
      if (!out.length) console.log("No open jobs.");
      for (const j of out) console.log(`[${j.id}] ${j.status.toUpperCase()}  ${j.desk}: ${j.text}`);
      if (out.length) console.log(`Finish one with: node ${HUB_DIR()}/tools/agent-log.mjs done --job <id> --summary "what you did"`);
    },
  },
  handoff: { url: "handoff", need: (o) => (!o.desk || !o.to || !o.text) && "handoff needs --desk, --to and --text.",
    body: (o) => ({ desk: o.desk, to: o.to, text: o.text, job: o.job, result: o["result-file"] ? readResult(o["result-file"]) : o.result || null, files: filesIn(o.text, o.file, WHERE()) }),
    // a handoff to another room's desk is asked of its lead instead and answers { asked, waitingOn }
    print: (out, o) => console.log(out.asked ? `Asked ${out.waitingOn} for ${out.desk} (${out.room}); request ${out.asked}.` : `Handed to ${out.desk} as job ${out.id} (step ${out.step}).`) },
  rate: { url: "rate", need: (o) => (!o.desk || !o.job || !/^(yes|no)$/.test(o.useful || "")) && "rate needs --desk, --job and --useful yes|no.",
    body: (o) => ({ desk: o.desk, job: o.job, rating: o.useful === "yes" ? "up" : "down", why: o.why }),
    // the hub keeps an earlier rating by the owner and answers it as `kept`
    print: (out) => console.log(out.kept ? `Not changed: ${out.kept} (${out.r}).` : `Rated job ${out.id}: ${out.r}.`) },
  vote: { url: "vote", need: (o) => (!o.desk || !o.request || !/^(yes|no)$/.test(o.vote || "")) && "vote needs --desk, --request and --vote yes|no.",
    body: (o) => ({ desk: o.desk, request: o.request, vote: o.vote, why: o.why }),
    print: (out) => console.log(`Voted ${out.vote} on ${out.request}.`) },
  watch: { url: "blocker", need: (o) => (!o.desk || !o.what || !o.check) && 'watch needs --desk, --what "<blocker>" and --check github-release|url-contains|file-exists.',
    body: (o) => ({ desk: o.desk, room: o.room, what: o.what, alert: o.alert, everyHours: o["every-hours"], check: { type: o.check, repo: o.repo, match: o.match, url: o.url, text: o.text, path: o.path } }),
    print: (out) => console.log(`Watching (${out.id}): ${out.what}. Checked every ${out.everyHours} h; ${OWNER()} gets an alert and you get an inbox note when it clears.`) },
  borrow: { url: "borrow", need: (o) => (!o.from || !o.desk) && "borrow needs --from (your lead desk) and --desk (the worker).",
    body: (o) => ({ from: o.from, desk: o.desk, hours: o.hours, why: o.why }),
    print: (out) => console.log(`Asked ${out.ownerLead || OWNER()} to borrow ${out.desk} for ${out.hours} h (${out.id}). The answer shows in "agent-log.mjs inbox".`) },
  lend: { url: "lend", need: (o) => (!o.desk || !o.request || !o.decision) && "lend needs --desk (your lead desk), --request and --decision approved|declined.",
    body: (o) => ({ desk: o.desk, request: o.request, decision: o.decision, note: o.note }),
    print: (out) => console.log(`Loan ${out.decision}.`) },
  desks: { url: "desks",
    body: () => ({}),
    print: (out) => { for (const d of out) console.log(`${d.id.padEnd(28)} ${d.room.padEnd(10)} ${String(d.provider || "").padEnd(8)} ${d.runner === "hub" ? "hub runs it" : d.runner === "local" ? "local app" : ""}  ${d.role || ""}`); } },
  take: jobRow,
  done: jobRow,
  fail: jobRow,
};

const cmd = Object.hasOwn(COMMANDS, kind) ? COMMANDS[kind] : usage();
const problem = cmd.need?.(opt);
if (problem) usage(problem);
const body = cmd.body(opt, kind);

try {
  const token = hubToken();
  const res = await fetch(`${HUB}/api/agents/ingest/${cmd.url}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`The hub refused it: ${out.error || res.status}`);
    process.exit(1);
  }
  cmd.print(out, opt);
} catch (err) {
  console.error(`Couldn't reach the hub: ${err.cause?.code || err.message}`);
  process.exit(1);
}
