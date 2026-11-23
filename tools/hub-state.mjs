#!/usr/bin/env node
// Read-only snapshot of the hub for a session that can't sign in or read data/ by hand:
//   node tools/hub-state.mjs            what is queued, held, failed, waiting for the owner, and each desk's last 7 days
//   node tools/hub-state.mjs --json     the same as JSON
// Reads only data/agents/{jobs,requests}.jsonl, data/jobs/*/job.json and data/live/pool.json. Never opens
// data/agents/token.txt, .env or any settings file, and prints no job text beyond a short first line.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function dataDir() {
  if (process.env.HUB_DATA) return process.env.HUB_DATA;
  const here = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
  if (fs.existsSync(path.join(here, "data"))) return path.join(here, "data");
  // a worktree has no data/: the main checkout does (the parent of git's common dir)
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: here, encoding: "utf8" }).trim();
    const main = path.dirname(common);
    if (fs.existsSync(path.join(main, "data"))) return path.join(main, "data");
  } catch {}
  throw new Error("No data/ folder found. Set HUB_DATA to the hub's data folder.");
}
const D = dataDir();
const rows = (f) => { try { return fs.readFileSync(path.join(D, f), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const first = (s) => String(s || "").split("\n")[0].replace(/\s+/g, " ").slice(0, 80);
const now = Date.now(), DAY = 864e5, mins = (a, b) => (Date.parse(b) - Date.parse(a)) / 6e4;
const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : null);

// desk jobs (agents)
const J = {};
for (const r of rows("agents/jobs.jsonl")) { const j = (J[r.id] ||= { id: r.id, ev: [] }); if (r.desk) Object.assign(j, { desk: r.desk, at: r.at, text: r.text }); j.ev.push(r); }
const desks = {};
for (const j of Object.values(J)) {
  if (!j.desk || now - Date.parse(j.at) > 7 * DAY) continue;
  const st = j.ev.map((e) => e.status).filter(Boolean), last = st.at(-1) || "queued";
  const taken = j.ev.find((e) => e.status === "taken"), fin = j.ev.find((e) => e.status === "done" || e.status === "failed");
  const o = (desks[j.desk] ||= { jobs: 0, done: 0, failed: 0, open: 0, waitMin: [], runMin: [] });
  o.jobs++; if (last === "done") o.done++; else if (last === "failed") o.failed++; else if (last !== "cancelled") o.open++;
  if (taken) o.waitMin.push(mins(j.at, taken.at)); if (taken && fin) o.runMin.push(mins(taken.at, fin.at));
}
const deskTable = Object.entries(desks).map(([desk, o]) => ({ desk, jobs: o.jobs, done: o.done, failed: o.failed, open: o.open, medianWaitMin: med(o.waitMin) && Math.round(med(o.waitMin)), medianRunMin: med(o.runMin) && Math.round(med(o.runMin)) })).sort((a, b) => b.jobs - a.jobs);

// requests waiting for the owner: an id with no decision row
const R = {};
for (const r of rows("agents/requests.jsonl")) { const q = (R[r.id] ||= {}); if (r.kind === "ask" || r.role || r.about) Object.assign(q, { id: r.id, at: r.at, from: r.from, text: r.role || r.about }); if (r.decision) q.decided = r.decision; }
const waiting = Object.values(R).filter((q) => q.at && !q.decided && now - Date.parse(q.at) < 14 * DAY).map((q) => ({ id: q.id, from: q.from, ageHours: Math.round((now - Date.parse(q.at)) / 36e5), text: first(q.text) }));

// pipeline jobs by status
const jobsDir = path.join(D, "jobs"), pipeline = {}, bad = [];
try {
  for (const id of fs.readdirSync(jobsDir)) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(jobsDir, id, "job.json"), "utf8")); } catch { continue; }
    if (now - Date.parse(j.updatedAt || j.createdAt) > 2 * DAY) continue;
    const k = `${j.status}/${j.stage}`; pipeline[k] = (pipeline[k] || 0) + 1;
    if (j.status === "failed" || j.status === "held") bad.push({ id: id.slice(-9), status: j.status, stage: j.stage, why: first(j.hold?.reason || j.error?.message || j.log?.at(-1)?.message) });
  }
} catch {}

const out = { dataDir: D, at: new Date().toISOString(), waitingForOwner: waiting, desks7d: deskTable, pipeline2d: pipeline, failedOrHeld2d: bad };
if (process.argv.includes("--json")) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`Hub state ${out.at.slice(0, 16)}Z (data: ${D})\n`);
  console.log(`Waiting for the owner: ${waiting.length}`); for (const q of waiting.slice(0, 15)) console.log(`  ${q.id}  ${q.ageHours}h  ${q.from || "?"}: ${q.text}`);
  console.log(`\nDesks, last 7 days (jobs/done/failed/open, median wait and run in minutes):`);
  for (const d of deskTable.slice(0, 12)) console.log(`  ${d.desk.padEnd(36)} ${String(d.jobs).padStart(3)} ${String(d.done).padStart(3)} ${String(d.failed).padStart(2)} ${String(d.open).padStart(2)}   ${d.medianWaitMin ?? "-"} / ${d.medianRunMin ?? "-"}`);
  console.log(`\nPipeline jobs touched in 2 days: ${Object.entries(pipeline).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`);
  console.log(`Failed or held:`); for (const b of bad) console.log(`  ${b.id}  ${b.status}/${b.stage}  ${b.why}`);
}
