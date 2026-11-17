#!/usr/bin/env node
// Self-check: does this copy of the app start and answer, on a COPY of your data? `npm run update` runs it after an update;
// you can run it any time (`npm run self-check`), also while your own hub is running.
//   node tools/self-check.mjs [--port N] [--keep]
//
// It never touches your real data/ or .env and never uses port 3000. It
//   1. copies data/ into a new temp folder (leaving out the lock file, logs, videos and anything over 20 MB),
//   2. starts the real server from this folder against that copy on a spare port, with every key, token and password
//      removed from its environment and the pipeline, local runner, chatter, selves and helpers switched off,
//   3. checks it answers, the roster loads and the campus page returns 200,
//   4. stops it by its process id, confirms the port is free and deletes the copy.
// Exit code 0 only when every check passed. If the copied data is from a newer version of the app, the server refuses to
// start (src/hub/migrations.js) and this says so.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { portFree, sparePort, bootHub } from "./lib/hub-boot.mjs";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_NAMES = new Set(["hub.lock", "logs", "node_modules", ".chrome-profile"]);
const MEDIA = /\.(mp4|mov|m4v|mkv|webm|wav|mp3|m4a|flac|ogg|png|jpe?g|gif|webp|psd|zip|7z|glb|fbx|blend)$/i;
const BIG = 20 * 1024 * 1024;

// The shared part of "a copy of data/": into `to`, skipping what is big or not needed to start.
export function copyDataForCheck(from, to, depth = 0) {
  let n = 0;
  if (!fs.existsSync(from) || depth > 8) return n;
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP_NAMES.has(e.name)) continue;
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) n += copyDataForCheck(a, b, depth + 1);
    else if (e.isFile() && !MEDIA.test(e.name) && !/\.tmp$/i.test(e.name) && fs.statSync(a).size <= BIG) { fs.copyFileSync(a, b); n++; }
  }
  return n;
}

export async function selfCheck({ appDir = APP, dataDir = path.join(appDir, "data"), port, keep = false, log = () => {} } = {}) {
  const checks = [];
  const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`); return ok; };
  const result = { pass: false, checks, root: null };
  port = port || await sparePort();
  if (port === 3000) { check("port is not the live hub's", false, "3000 is the live hub"); return result; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-self-check-"));
  result.root = root;
  let hub = null;
  try {
    const files = copyDataForCheck(dataDir, path.join(root, "data"));
    fs.mkdirSync(path.join(root, "data", "agents"), { recursive: true });
    fs.mkdirSync(path.join(root, "docs", "projects"), { recursive: true });
    fs.writeFileSync(path.join(root, "no-env"), "# empty on purpose: the self-check never reads a .env\n");
    let cfg = { channels: {} };
    try { cfg = JSON.parse(fs.readFileSync(path.join(appDir, "pipeline.config.json"), "utf8")); } catch {}
    cfg.jobsDir = "data/jobs";
    cfg.backup = { dir: "backups", hour: 3 }; // nothing written outside the temp folder
    fs.writeFileSync(path.join(root, "pipeline.config.json"), JSON.stringify(cfg, null, 2));
    fs.writeFileSync(path.join(root, "self-check-settings.json"), JSON.stringify({ backup: { copyTo: "" }, network: { listen: "local" } }));
    check("copied your data to a temp folder", true, `${files} file(s); the original is not touched`);
    if (!(await portFree(port))) { check(`port ${port} is free to start`, false, "something is already using it"); return result; }
    hub = bootHub({ appDir, root, port, settingsFile: path.join(root, "self-check-settings.json"), noEnv: path.join(root, "no-env") });
    const up = await hub.waitUp();
    const out = hub.output().trim().split("\n").slice(-3).join(" | ").slice(0, 400);
    check("the hub starts and answers on the copy", up, up ? `port ${port}` : `no answer${hub.exited() !== null ? ` (it exited with code ${hub.exited()})` : " in 60 s"}; last output: ${out}`);
    if (up) {
      const ros = await hub.get("/api/pipeline/agents/roster").catch((e) => ({ status: 0, text: e.message }));
      check("the roster loads", ros.status === 200 && Array.isArray(ros.json?.desks) && Array.isArray(ros.json?.rooms), `status ${ros.status}${Array.isArray(ros.json?.desks) ? `, ${ros.json.desks.length} desks, ${ros.json.rooms.length} rooms` : ""}`);
      const page = await hub.get("/campus.html").catch((e) => ({ status: 0, text: e.message }));
      check("the campus page returns 200", page.status === 200 && /<html|<!doctype/i.test(page.text), `status ${page.status}, ${page.text.length} bytes`);
      check("no crash in the hub's own output", !/unhandledrejection|uncaught|cannot find module/i.test(hub.output()), "");
    }
  } catch (err) {
    check("self-check ran", false, err.message);
  } finally {
    const free = hub ? await hub.stop() : true;
    check("server stopped and the port is free again", free, `port ${port}`);
    if (keep) log(`kept: ${root}`);
    else try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); check("temp copy deleted", !fs.existsSync(root), ""); } catch (err) { check("temp copy deleted", false, err.message); }
  }
  result.pass = checks.every((c) => c.ok);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const pi = args.indexOf("--port");
  const r = await selfCheck({ port: pi >= 0 ? Number(args[pi + 1]) : undefined, keep: args.includes("--keep"), log: (l) => console.log(l) });
  console.log(r.pass ? "\nPASS: this copy of the app starts and answers on a copy of your data." : "\nFAIL: see the FAIL lines above. Your real data was not touched.");
  process.exit(r.pass ? 0 : 1);
}
