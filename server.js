import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { isatty } from "node:tty";
import express from "express";
import { config, hasPlaceholderAnthropicKey } from "./src/config.js";
import { pipelineRouter } from "./src/routes/pipeline.js";
import { agentIngestRoutes, agentsRouter } from "./src/routes/agents.js";
import { startWorker } from "./src/pipeline/worker.js";
import { every, missingContextFiles } from "./src/pipeline/util.js";
import { recordStart } from "./src/pipeline/versions.js";
import { upgradePasswordStorage } from "./src/passwords.js";
import { publicSettings, ownerName, ownersHub } from "./src/hub/settings.js";
import { PARTS } from "./src/hub/extras.js";
import { moduleGate, pageGate, publicModules, timerOn, frontDoorHtml } from "./src/hub/modules.js";
import { listenHost, listenMode, networksSetting } from "./src/hub/listen.js";
import { acquireDataLock } from "./src/hub/datalock.js";
import { ensureDataFormat } from "./src/hub/migrations.js";
import { compress } from "./src/compress.js";
import { staticHeaders, assetVersions, revalidatePolls } from "./src/httpcache.js";
import { networkGuard, securityHeaders, sameOrigin, requireLogin, loginRoutes, confirmPasswordRoutes, warnIfNoPassword } from "./src/security.js";

// Crash log and heartbeat (data/logs), so a stop or a freeze can be told apart and its cause read later.
const LOGS = path.join(config.rootDir || process.cwd(), "data", "logs");
fs.mkdirSync(LOGS, { recursive: true });
// One hub per data folder: a second one on the same data/ would write the same files and run the same timers (src/hub/datalock.js).
try {
  const lock = acquireDataLock(path.join(config.rootDir || process.cwd(), "data"), { port: config.port });
  process.on("exit", lock.release);
} catch (err) {
  try { fs.appendFileSync(path.join(LOGS, "crash.log"), `${new Date().toISOString()} pid ${process.pid} refused second start: ${err.message}\n`); } catch {}
  console.error(err.message);
  process.exit(1);
}
// The data format (src/hub/migrations.js): brings data/ up to this version (backup first) or refuses to start on data from a newer one.
try {
  const { runBackup } = await import("./src/pipeline/backup.js");
  ensureDataFormat(path.join(config.rootDir || process.cwd(), "data"), { backup: () => runBackup({ trigger: "before update" }), log: (m) => console.log(m) });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const crash = (kind, err) => {
  try {
    fs.appendFileSync(path.join(LOGS, "crash.log"), `${new Date().toISOString()} pid ${process.pid} ${kind}: ${err?.stack || err}\n`);
  } catch {}
};
// Everything the black window shows also goes to data/logs/console.log (kept under about 5 MB), readable remotely.
const CONSOLE = path.join(LOGS, "console.log");
// A circular or BigInt value can't be turned into JSON; a log line must never throw (code review 2026-10-22).
const safeJson = (a) => {
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
};
try {
  if (fs.statSync(CONSOLE).size > 5e6) fs.renameSync(CONSOLE, CONSOLE + ".old");
} catch {}
for (const level of ["log", "warn", "error"]) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    // File first: if the window ever blocks the write below, console.log still shows the line it stopped on.
    const line = args.map((a) => (a instanceof Error ? a.stack : typeof a === "string" ? a : safeJson(a))).join(" ");
    fs.appendFile(CONSOLE, `${new Date().toISOString()} ${level === "log" ? "" : level.toUpperCase() + " "}${line}\n`, () => {});
    orig(...args);
  };
}
// Windows pauses a program whose console window has text selected (QuickEdit), so one stray click in the black
// window froze the whole app at its next log line (2026-10-23 11:41, five phone uploads waiting). Turn QuickEdit off
// for this window. The console's input mode is shared, so a short PowerShell child can change it.
if (process.platform === "win32" && isatty(0)) {
  const ps = [
    '$s=\'[DllImport("kernel32.dll")]public static extern IntPtr GetStdHandle(int h);[DllImport("kernel32.dll")]public static extern bool GetConsoleMode(IntPtr h,out uint m);[DllImport("kernel32.dll")]public static extern bool SetConsoleMode(IntPtr h,uint m);\'',
    "$k=Add-Type -MemberDefinition $s -Name QuickEdit -Namespace YtHub -PassThru",
    "$h=$k::GetStdHandle(-10);[uint32]$m=0;if($k::GetConsoleMode($h,[ref]$m)){[void]$k::SetConsoleMode($h,($m -band (-bnot 0x40)) -bor 0x80)}",
  ].join(";");
  try {
    // Encoded, so Windows' command-line quoting can't mangle the quotes inside it.
    spawn("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(ps, "utf16le").toString("base64")], { stdio: ["inherit", "ignore", "ignore"], windowsHide: true }).on("error", () => {});
  } catch {}
}
process.on("exit", (code) => crash(`exit code ${code}`, ""));
process.on("unhandledRejection", (err) => (crash("unhandled rejection (kept running)", err), console.error("Unhandled rejection:", err)));
process.on("uncaughtException", (err) => (crash("crash", err), console.error(err), process.exit(1)));
setInterval(() => {
  try {
    fs.writeFileSync(path.join(LOGS, "heartbeat.json"), JSON.stringify({ at: new Date().toISOString(), pid: process.pid, mb: Math.round(process.memoryUsage().rss / 1048576) }));
  } catch {}
}, 60000).unref();

// Which code is running, and whether it changed since the last start (Admin, Version history).
recordStart();

// Swaps a plain password in .env for its hash before anything can read it.
await upgradePasswordStorage();

const app = express();
app.disable("x-powered-by");
// First: only this PC, Tailscale and the home network get any answer at all.
app.use(networkGuard);
app.use(securityHeaders);
app.use(compress()); // text answers as brotli/gzip when asked (src/compress.js); the CSP header above is left as it is
app.use(sameOrigin);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
// Agent dashboard: hooks and agents post events with the key in data/agents/token.txt, no sign-in (routes/agents.js).
agentIngestRoutes(app);
loginRoutes(app);
// Everything below needs a signed-in session (or a request from this PC while no password is set).
app.use(requireLogin);
confirmPasswordRoutes(app);
// The old script tool page is retired (the owner, 2026-10-19): its address goes to Home.
// The front door (2026-11-09: the campus; 2026-11-14: or the plain pages, the "pages" display). A tiny page that goes to
// this device's pick from the View picker (campus.display in the browser), else the hub's setting: the pages go to
// Home when the Classic pages part is on, else the Agents page; anything else goes to the campus.
app.get(["/", "/index.html"], (req, res) => res.type("html").send(frontDoorHtml()));
app.use(pageGate); // a switched-off part's pages go to the campus (src/hub/modules.js)
app.use(revalidatePolls); // the glance and agents polls: no-cache + ETag, so an unchanged answer is a 304 (src/httpcache.js)
app.use(express.static(config.publicDir, { setHeaders: staticHeaders })); // ?v= files cached for a year, the rest revalidated
app.get("/api/hub/settings", async (req, res) => res.json({ ...publicSettings(), ...publicModules(), assetV: assetVersions(config.publicDir), teams: (await import("./src/pipeline/teams.js")).teamsOffered(new Set(publicModules().modules)) })); // owner, town, pet, display, which parts are on, team templates
app.use("/api/pipeline", moduleGate); // a switched-off part's routes answer "switched off"
app.use("/api/pipeline/agents", agentsRouter);
app.use("/api/pipeline", pipelineRouter);
// Last stop for errors nothing else caught (code review 2026-10-22): a short JSON message instead of Express's
// default page, which showed a stack trace with the PC's file paths.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.warn(`${req.method} ${req.path} failed: ${err.message}`);
  res.status(status).json({ error: status >= 500 ? "Something went wrong on the PC. The console log has the details." : err.message });
});

const host = listenHost();
const server = app.listen(config.port, host, async () => {
  crash("started", `port ${config.port}`); // so Health counts restarts (src/pipeline/health.js readCrashLog)
  console.log(`${ownersHub()} running at http://localhost:${config.port}`);
  if (host === "127.0.0.1" && listenMode() === "all") console.warn("Warning: network.listen is \"all\" but no dashboard password is set, so the hub listens on this PC only. Run npm run set-password, then restart.");
  else if (host === "127.0.0.1") console.log("Only this PC can open it. To use it from your phone: set network.listen to \"all\" (docs/kit/SETUP.md).");
  else console.log(`Listening on the network for: ${networksSetting()}`);
  console.log(`Home: http://localhost:${config.port}/home.html`);
  console.log(`Model: ${config.model}`);
  // Demo mode (tools/demo.mjs): the sample data is shown as it is. No worker, no timers, nothing that calls out.
  if (process.env.HUB_DEMO === "1") return console.log("Demo mode: sample data only. No timers run and nothing is sent anywhere.");
  warnIfNoPassword();
  if (hasPlaceholderAnthropicKey()) console.warn("Warning: ANTHROPIC_API_KEY in .env is still a placeholder.");
  // Trouble checking the reference files only warns (code review 2026-10-22): it used to end this callback early,
  // so the worker and every timer below silently never started.
  try {
    const missing = missingContextFiles();
    if (missing.length) console.warn(`Warning: missing reference files: ${missing.join(", ")}`);
  } catch (err) {
    console.warn(`Warning: reference files couldn't be read: ${err.message}`);
  }
  try {
    // The YouTube upload worker belongs to the YouTube part (src/hub/modules.js): on only when that part is.
    if (process.env.PIPELINE_DISABLED !== "1" && timerOn("Upload worker")) startWorker();
  } catch (err) {
    console.error(`The pipeline worker didn't start: ${err.message}`);
  }
  // The nightly backup on every hub, the deal watch with the cards add-on: both used to run only inside the YouTube worker.
  if (process.env.PIPELINE_DISABLED !== "1") {
    every("Nightly backup failed", () => import("./src/pipeline/backup.js").then((m) => m.backupTick()), 60000);
    if (timerOn("Deal watch")) every("Deal watch failed", () => import("./src/pipeline/dealwatch.js").then((m) => m.dealWatchTick()), 60000);
  }
  // Card exports dropped in data/cards/import/ (collection.js importFolder).
  // A failed import (Scryfall busy) tries again every 10 min, up to 6 times; the file stays in import/ until it works.
  const importCards = (tryNo = 1) =>
    import("./src/pipeline/collection.js")
      .then((m) => m.importFolder())
      .then(
        (r) =>
          r.length &&
          import("./src/pipeline/runlog.js").then((l) => r.forEach((x) => l.logEvent("collection import", { trigger: "auto", ...x }))),
      )
      .catch((err) => {
        console.warn(`Collection import failed (try ${tryNo}): ${err.message}`);
        if (tryNo < 6) setTimeout(() => importCards(tryNo + 1), 600000);
      });
  if (timerOn("Card import")) setTimeout(importCards, 20000);
  // Agent dashboard: starts the agent timers (agents.js).
  import("./src/pipeline/agents.js").then((m) => m.startWatchers()).catch((err) => console.warn(`Agent watcher failed: ${err.message}`));
  // This owner's private parts (src/private/, never in the kit) start their own timers (src/hub/extras.js).
  for (const p of PARTS) try { p.start?.({ every, timerOn }); } catch (err) { console.warn(`${p.module?.name || p.file}: ${err.message}`); }
  // HR desk: checks new staff requests and over-cap desks every 3 hours (hr.js); no AI call when nothing is waiting.
  every("HR check failed", () => import("./src/pipeline/hr.js").then((m) => m.runHr()), 3 * 3600e3, { firstMs: 180000 });
  // One to-do snapshot a day for the Project page's scope line (project.js).
  if (timerOn("To-do snapshot")) every("To-do snapshot failed", () => import("./src/pipeline/project.js").then((m) => m.snapshotTodo()), 6 * 3600e3, { firstMs: 40000 });
  // MTG Arena: read its log for new matches at start and once a day (skipped when the log hasn't changed); Read log now on the page reads it any time.
  if (timerOn("Arena read")) every("Arena read failed", () => import("./src/pipeline/arena.js").then((m) => m.ingestArena()), 24 * 3600e3, { firstMs: 50000 });
  // Collection prices once a day (collection.js): keeps "biggest movers" current and sends the big-move alert.
  if (timerOn("Card prices")) every("Card prices failed", () => import("./src/pipeline/collection.js").then((m) => m.dailyPrices()), 6 * 3600e3, { firstMs: 100000 });
  // Sunday summary (digest.js): checked hourly, sent once on Sunday from 6 pm.
  every("Sunday summary failed", () => import("./src/pipeline/digest.js").then((m) => m.digestDue()), 3600e3, { firstMs: 130000 });
  // Anime and manga: new episodes and chapters, once a day at most (reading.js); "Check now" on the page any time.
  if (timerOn("Reading check")) every("Reading check failed", () => import("./src/pipeline/reading.js").then((m) => m.dailyCheck()), 6 * 3600e3, { firstMs: 70000 });
});
server.on("error", (err) => {
  crash(err.code === "EADDRINUSE" ? "refused second start" : "could not start", err); // a busy port is not a crash of the running hub
  console.error(err.code === "EADDRINUSE" ? `Port ${config.port} is already in use: the app is probably already running in another window.` : err);
  process.exit(1);
});
