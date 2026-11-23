#!/usr/bin/env node
// Restore test: proves a backup can bring a hub back.
//   node tools/restore-test.mjs <backup folder> [--port 3997] [--keep]
//
// A backup is one dated folder (YYYY-MM-DD) in the backups folder: trackers/, References/, data/, jobs/ and
// pipeline.config.json (src/pipeline/backup.js). This tool
//   1. unpacks that folder into a NEW temp folder laid out as a hub data root (the backup itself is only read),
//   2. starts the real server from this checkout against it (HUB_TEST_ROOT), with the pipeline, the local runner, the chatter,
//      the selves and the helpers all off, and every *_API_KEY / *_TOKEN / password removed from the child's environment,
//      and the settings' second backup copy and the config's extra copies switched off so nothing is written outside the temp folder,
//   3. waits for it to answer and checks: the roster loads with the same number of desks and rooms the backup holds, the
//      spend ledger, jobs and events files parse, /api/agents answers with those desks, the campus page returns
//      200 and its data calls work,
//   4. stops the server by its pid, confirms the port is free, deletes the temp folder (unless --keep),
//   5. prints what was checked, what a real restore still needs from you, and PASS or FAIL. Exit code 0 only on PASS.
// It never uses port 3000 (the live hub) and never reads a .env or a token file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { portFree, sleep, bootHub } from "./lib/hub-boot.mjs";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRET_NAME = /(token|secret|password|apikey|api-key|credential)s?(\.|$)|^\.env/i;
const SECRET_TEXT = /\b(AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,}|xai-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.isFile()) out.push(p);
  }
  return out;
}
// One JSON object per line; a blank line is fine. Returns { lines } or { error }.
function parseJsonl(file) {
  const text = fs.readFileSync(file, "utf8");
  let n = 0;
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try { JSON.parse(line); n++; } catch { return { error: `line ${i + 1} is not valid JSON` }; }
  }
  return { lines: n };
}
// Lay the backup out as a hub data root. Only this backup folder is read; everything is written inside root.
function unpack(backup, root) {
  const note = [];
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs", "projects"), { recursive: true });
  fs.writeFileSync(path.join(root, "no-env"), "# empty on purpose: the restore test never reads a .env\n");
  if (fs.existsSync(path.join(backup, "data"))) fs.cpSync(path.join(backup, "data"), path.join(root, "data"), { recursive: true });
  if (fs.existsSync(path.join(backup, "References"))) fs.cpSync(path.join(backup, "References"), path.join(root, "References"), { recursive: true });
  // The settings file of this PC: what it says about folders and copies must not point outside the temp folder.
  const cfg = readJson(path.join(backup, "pipeline.config.json")) || { channels: {} };
  cfg.jobsDir = "data/jobs";
  cfg.backup = { dir: "backups", hour: 3 }; // no extra copies, no other drive
  fs.writeFileSync(path.join(root, "pipeline.config.json"), JSON.stringify(cfg, null, 2));
  let jobs = 0;
  const jd = path.join(backup, "jobs");
  if (fs.existsSync(jd)) for (const f of fs.readdirSync(jd)) {
    if (!/^[\w-]+\.json$/.test(f)) continue;
    const dir = path.join(root, "data", "jobs", f.replace(/\.json$/, ""));
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(jd, f), path.join(dir, "job.json"));
    jobs++;
  }
  note.push(`${jobs} job record(s) put back`);
  fs.writeFileSync(path.join(root, "restore-test-settings.json"), JSON.stringify({ backup: { copyTo: "" }, network: { listen: "local" } }));
  return { jobs, note };
}

export async function restoreTest({ backup, port = 3997, keep = false, log = () => {} } = {}) {
  const checks = [];
  const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`); return ok; };
  const result = { pass: false, checks, leftOut: [], root: null };
  if (!backup || !fs.existsSync(backup) || !fs.statSync(backup).isDirectory()) { check("backup folder found", false, String(backup || "(none given)")); return result; }
  if (port === 3000) { check("port is not the live hub's", false, "3000 is the live hub"); return result; }
  backup = path.resolve(backup);
  const files = walk(backup);
  check("backup has data", fs.existsSync(path.join(backup, "data")), `${files.length} file(s)`);

  // No secrets inside a backup (names and key-shaped text; only file names are ever printed).
  const bad = [];
  for (const f of files) {
    const rel = path.relative(backup, f).split(path.sep).join("/");
    if (SECRET_NAME.test(path.basename(f))) { bad.push(rel); continue; }
    if (/\.(json|jsonl|md|txt|csv)$/i.test(f) && fs.statSync(f).size < 20 * 1024 * 1024 && SECRET_TEXT.test(fs.readFileSync(f, "utf8"))) bad.push(rel);
  }
  check("no secrets in the backup", !bad.length, bad.length ? `look at: ${bad.slice(0, 10).join(", ")}` : "none by name, none key-shaped");

  const recorded = readJson(path.join(backup, "data", "agents", "roster.json"));
  check("backup holds a roster", recorded && Array.isArray(recorded.desks) && Array.isArray(recorded.rooms), recorded ? `${recorded.desks?.length} desks, ${recorded.rooms?.length} rooms` : "data/agents/roster.json missing or unreadable");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-restore-test-"));
  result.root = root;
  let hubProc = null;
  try {
    const u = unpack(backup, root);
    check("unpacked into a new temp folder", true, `${path.basename(root)}; ${u.note.join("; ")}`);

    // Files that must parse once restored.
    const parseOne = (rel, { optional = true } = {}) => {
      const f = path.join(root, rel);
      if (!fs.existsSync(f)) return check(`${rel} parses`, optional, optional ? "not in this backup (nothing recorded yet)" : "missing");
      const r = parseJsonl(f);
      return check(`${rel} parses`, !r.error, r.error || `${r.lines} line(s)`);
    };
    parseOne("data/spend.jsonl");
    parseOne("data/agents/events.jsonl");
    parseOne("data/agents/jobs.jsonl");
    const jobDirs = fs.existsSync(path.join(root, "data", "jobs")) ? fs.readdirSync(path.join(root, "data", "jobs")) : [];
    const badJobs = jobDirs.filter((d) => !readJson(path.join(root, "data", "jobs", d, "job.json")));
    check("job records parse", !badJobs.length, badJobs.length ? `unreadable: ${badJobs.slice(0, 5).join(", ")}` : `${jobDirs.length} job(s)`);

    if (!(await portFree(port))) { check(`port ${port} is free to start`, false, "something is already using it"); return result; }
    hubProc = bootHub({ appDir: APP, root, port, settingsFile: path.join(root, "restore-test-settings.json"), noEnv: path.join(root, "no-env") });
    const get = hubProc.get;
    const up = await hubProc.waitUp();
    const exited = hubProc.exited(), serverLog = hubProc.output();
    check("the hub started on the restored data", up, up ? `answers on port ${port}` : `no answer${exited !== null ? ` (it exited with code ${exited})` : " in 60 s"}; last output: ${serverLog.trim().split("\n").slice(-3).join(" | ").slice(0, 300)}`);
    if (up) {
      const ros = await get("/api/agents/roster").catch((e) => ({ status: 0, text: e.message }));
      const rd = ros.json?.desks, rr = ros.json?.rooms;
      check("roster loads with the same desks and rooms as the backup", recorded && ros.status === 200 && rd?.length === recorded.desks.length && rr?.length === recorded.rooms.length, `backup ${recorded?.desks?.length} desks / ${recorded?.rooms?.length} rooms; restored hub ${rd?.length} / ${rr?.length}`);
      const ov = await get("/api/agents").catch((e) => ({ status: 0, text: e.message }));
      const ids = new Set((recorded?.desks || []).map((d) => d.id));
      const ovDesks = ov.json?.desks;
      const unknown = Array.isArray(ovDesks) ? ovDesks.filter((d) => !ids.has(d.id)).length : -1;
      check("/api/agents answers with those desks", ov.status === 200 && Array.isArray(ovDesks) && unknown === 0 && (ids.size === 0 || ovDesks.length > 0), `status ${ov.status}; ${Array.isArray(ovDesks) ? `${ovDesks.length} desks, ${unknown} not in the backup` : "no desks list"}`);
      const page = await get("/campus.html").catch((e) => ({ status: 0, text: e.message }));
      check("campus page returns 200", page.status === 200 && /<html|<!doctype/i.test(page.text), `status ${page.status}, ${page.text.length} bytes`);
      const hs = await get("/api/hub/settings").catch((e) => ({ status: 0 }));
      check("campus data calls work (/api/hub/settings and /api/agents)", hs.status === 200 && ov.status === 200 && Array.isArray(ov.json?.rooms), `settings ${hs.status}, agents ${ov.status}`);
      const tail = hubProc.output().toLowerCase();
      check("no crash in the hub's own output", !/unhandledrejection|uncaught|cannot find module/.test(tail), "");
    }
  } catch (err) {
    check("restore test ran", false, err.message);
  } finally {
    let free = hubProc ? await hubProc.stop() : await portFree(port);
    check("server stopped and the port is free again", free, `port ${port}`);
    if (keep) log(`kept: ${root}`);
    else try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); check("temp folder deleted", !fs.existsSync(root), ""); } catch (err) { check("temp folder deleted", false, err.message); }
  }
  try {
    const bm = await import(pathToFileURL(path.join(APP, "src", "pipeline", "backup.js")).href);
    result.leftOut = bm.LEFT_OUT;
  } catch { result.leftOut = []; }
  result.pass = checks.every((c) => c.ok);
  return result;
}

export function formatReport(r, backup) {
  const out = [`Restore test of ${backup}`, ""];
  out.push("Checked:");
  for (const c of r.checks) out.push(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
  out.push("", "Not in a backup, by design (you re-enter or re-make these after a real restore):");
  for (const [what, why] of r.leftOut) out.push(`  - ${what}: ${why}`);
  out.push("", r.pass ? "PASS: this backup brings a hub back." : "FAIL: see the FAIL lines above.");
  return out.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const keep = args.includes("--keep");
  const pi = args.indexOf("--port");
  const port = pi >= 0 ? Number(args[pi + 1]) : 3997;
  const backup = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--port");
  if (!backup || !Number.isInteger(port)) {
    console.error("Usage: node tools/restore-test.mjs <backup folder> [--port 3997] [--keep]");
    process.exit(2);
  }
  const r = await restoreTest({ backup, port, keep });
  console.log("\n" + formatReport(r, backup));
  if (keep && r.root) console.log(`\nKept for inspection: ${r.root}`);
  process.exit(r.pass ? 0 : 1);
}
