// @ts-check
// Live clipping (the owner 2026-11-19: clip and post from a creator's live stream as soon as it starts).
// A channel's pipeline.config.json "liveWatch" lists creators' YouTube /live pages. Every few minutes the app asks
// yt-dlp whether one is live; when it is, ffmpeg records the stream in 30 s chunks under data/live/<stamp>/, and every
// `pieceMinutes` the newest stretch (plus `overlapSeconds` from the last piece, so a moment on the join isn't lost) is
// joined into one mp4 and dropped in the channel's inbox as "LIVE_<name> live <time>.mp4". The worker marks those jobs
// postNow: "find the clips" keeps only strong moments (minScore, maxPerPiece) and, once the owner approves the audit,
// the upload goes public at once, at most `perHour` an hour (extras are scheduled for the next free spot).
// Needs yt-dlp on the PC (winget install yt-dlp.yt-dlp). If yt-dlp is missing the status says so; nothing else breaks.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadPipelineConfig, savePipelineConfig, resolvePath, ffmpegCmd, run, standbyState } from "./util.js";
import { writeJsonAtomic } from "./files.js";
import { cutPiece as cutClip } from "./media.js";
import { listJobs, createJob, saveJob, logJob, jobDir } from "./jobs.js";
import { logEvent } from "./runlog.js";

export const LIVE_NAME = /^LIVE[_ -]/i;
// A live piece whose scan is over: nothing to do on it, and one every few minutes per streamer. The Pipeline page and the run
// log leave these out (its clips, and a piece that failed or is still being scanned, still show).
export const isScannedLivePiece = (job) => LIVE_NAME.test(job?.sourceName || "") && !job?.data?.splitFrom && job?.status === "split";
export const isLivePieceRun = (run) => run?.kind === "pipeline job" && LIVE_NAME.test(String(run.file || "")) && !run.error && run.ok !== false;
// bestPerHour: live clips found in an hour wait in a pool and only the best this many go on to review (the owner 2026-11-19:
// "group them and only send 2 every hour, best of the best").
// lazyCut (default off): true keeps only a found clip's time range and cuts the winners when the hour closes. Off, because Auto
// clean deletes a piece's full recording once the piece is done, which lost every clip on 2026-11-21.
// scanSkipAt (the owner 2026-11-21, "1-5"): a streamer who already has this many clips waiting in the pool isn't scanned again this
// hour (0 = always scan). silentSkip: a piece that is at least this share silence (0.95) isn't scanned at all (0 = off).
// poolBy (the owner 2026-11-21, "1 clip per streamer an hour"): "creator" (default) keeps one pool per streamer, so
// bestPerHour is per streamer; "channel" is one shared pool for the whole channel.
// repeatPenalty (the owner 2026-11-21, "2 an hour weighted on total ranking, avoid reposting 1 streamer"): when picking the
// best of a pool, each clip already picked from that streamer this hour, and that streamer having the last live clip
// posted, takes this much off its score (so only a clearly better clip repeats a streamer). 0 = by score alone.
// neonCheck / neonModel (the owner 2026-11-20): each live clip's finished edit is watched by Gemini (Neon) before it posts,
// and one with no hook, long silence or a cut-off ending is skipped (a channel.js checkEdit). autoApproveHours: how long
// the auto-approve switch stays on (setAutoApprove).
// scanFallback (2026-11-23, cost): false = when Gemini can't scan a live piece, the piece is skipped instead of going to
// Claude (Opus, frames only, about 4x the price). true = the old behaviour.
const DEFAULTS = { scanFallback: false, lazyCut: false, scanSkipAt: 3, silentSkip: 0.95, on: true, creators: [], pieceMinutes: 8, overlapSeconds: 30, checkMinutes: 2, minScore: 8, maxPerPiece: 2, perHour: 3, bestPerHour: 2, poolBy: "creator", repeatPenalty: 0.75, poolMinutes: 60, maxHeight: 1080, neonCheck: true, neonModel: "gemini-4-neon", maxSilenceSeconds: 4, autoApproveHours: 8 };
const CHUNK_SEC = 30;

// The channels that have a liveWatch block, with defaults filled in.
export function liveSettings(cfg = loadPipelineConfig()) {
  return Object.entries(cfg.channels || {})
    .filter(([, ch]) => ch.enabled && ch.liveWatch)
    .map(([id, ch]) => ({ channel: id, inbox: ch.inbox, ...DEFAULTS, ...ch.liveWatch }));
}
export const liveSettingsFor = (channel, cfg) => liveSettings(cfg).find((s) => s.channel === channel) || { ...DEFAULTS, channel };

// ---- yt-dlp -------------------------------------------------------------------------------------------------------

// yt-dlp from config ("ytdlp"), PATH, or winget's Links folder (the app's PATH is fixed at start, so a fresh winget
// install is found there before the next restart).
let ytdlpFound = null;
export async function ytdlpCmd(cfg = loadPipelineConfig()) {
  if (ytdlpFound) return ytdlpFound;
  const tries = [cfg.ytdlp, "yt-dlp"];
  if (process.platform === "win32" && process.env.LOCALAPPDATA) tries.push(path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "yt-dlp.exe"));
  for (const c of tries.filter(Boolean)) {
    try {
      await run(c, ["--version"]);
      return (ytdlpFound = c);
    } catch {}
  }
  return null;
}

// Is this /live page live right now? { live, id, title, url (video or combined HLS playlist), audioUrl (separate audio
// playlist, or null) } or { live: false, why }.
// YouTube live (2026-11) offers only separate video and audio HLS tracks, no combined one, so plain "best" finds
// nothing ("Requested format is not available"). Ask for video+audio first; a combined stream is the fallback.
export const liveFormat = (h) => `bv*[height<=${h}][protocol*=m3u8]+ba[protocol*=m3u8]/b[height<=${h}][protocol*=m3u8]/bv*[height<=${h}]+ba/b[height<=${h}]/bv*+ba/b`;
/** @param {string} pageUrl @param {{ maxHeight?: number, exec?: Function, cmd?: string }} [opts] */
export async function checkLive(pageUrl, { maxHeight = 1080, exec = run, cmd } = {}) {
  cmd = cmd || (await ytdlpCmd());
  if (!cmd) return { live: false, why: "yt-dlp isn't installed (winget install yt-dlp.yt-dlp)" };
  try {
    const { stdout } = await exec(cmd, ["--no-warnings", "--no-playlist", "-f", liveFormat(maxHeight), "--print", "%(is_live)s\t%(id)s\t%(title)s", "--print", "urls", pageUrl]);
    const lines = String(stdout).trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const [isLive, id, title] = (lines[0] || "").split("\t");
    if (isLive !== "True") return { live: false, why: "not live" };
    return { live: true, id, title, url: lines[1], audioUrl: lines[2] || null };
  } catch (err) {
    // yt-dlp exits non-zero with "is not currently live" / "will begin in ..." when the channel isn't streaming.
    const msg = String(err.message);
    if (/not currently live|will begin|premieres|not live|no video formats|Upcoming/i.test(msg)) return { live: false, why: "not live" };
    return { live: false, why: msg.split("\n").find((l) => /ERROR/.test(l))?.slice(0, 200) || msg.slice(-200) };
  }
}

// ---- recording ----------------------------------------------------------------------------------------------------

// ffmpeg's segment list (csv): "chunk00000.ts,0.000000,30.030000", one line per finished chunk.
export function readChunks(dir) {
  let text = "";
  try { text = fs.readFileSync(path.join(dir, "chunks.csv"), "utf8"); } catch { return []; }
  return text.split(/\r?\n/).filter(Boolean).map((l) => {
    const [file, start, end] = l.split(",");
    return { file, start: Number(start), end: Number(end) };
  }).filter((c) => c.file && Number.isFinite(c.end));
}

// Which finished chunks make the next piece. `from` is where the last piece ended (seconds into the recording).
// Returns null until there's a full piece (or, when `final`, at least a minute) to cut.
export function nextPiece(chunks, from, { pieceSec, overlapSec, final = false }) {
  if (!chunks.length) return null;
  const last = chunks.at(-1).end;
  if (last - from < (final ? 60 : pieceSec)) return null;
  const start = Math.max(0, from - overlapSec);
  const use = chunks.filter((c) => c.end > start + 0.5);
  return use.length ? { chunks: use, start: use[0].start, end: last } : null;
}

const two = (n) => String(n).padStart(2, "0");
const stampOf = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}${two(d.getMinutes())}`;
const safeName = (s) => String(s).replace(/[^\w .-]+/g, "").trim().slice(0, 40) || "stream";

// One recording at a time per creator: { creator, channel, dir, proc, startedAt, cutTo, pieces, video }.
const recs = new Map();
const lastCheck = new Map(); // creator name -> { at, live, why }

// One cut at a time. The 15-second tick and a recording that just ended (finish) can both want to cut; finish also deletes
// the recording's folder afterwards, which must not happen under a cut that is still running.
let cutChain = Promise.resolve();
export function withCutLock(fn) {
  const run = cutChain.then(fn, fn);
  cutChain = run.then(() => {}, () => {});
  return run;
}

// A rename that waits out a file Explorer, a sync client or an antivirus scan has open for a moment (Windows
// EBUSY/EPERM/EACCES), and copes with another drive (EXDEV).
export function moveFileSafe(from, to) {
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      if (err.code === "EXDEV") {
        fs.copyFileSync(from, to);
        fs.unlinkSync(from);
        return;
      }
      if (!["EBUSY", "EPERM", "EACCES"].includes(err.code) || i >= 3) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}

// Joins the piece's chunks (MPEG-TS joins byte for byte) into an mp4 next to them, then moves it into the inbox in one
// rename, so the worker never sees a half-written file.
async function cutPiece(rec, piece, set) {
  const tmp = path.join(rec.dir, `piece-${rec.pieces + 1}.mp4`);
  const input = "concat:" + piece.chunks.map((c) => path.join(rec.dir, c.file)).join("|");
  await run(ffmpegCmd(), ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", tmp]);
  const inbox = resolvePath(set.inbox);
  fs.mkdirSync(inbox, { recursive: true });
  const name = `LIVE_${safeName(rec.creator)} live ${stampOf(rec.startedAt)} part ${rec.pieces + 1}.mp4`;
  moveFileSafe(tmp, path.join(inbox, name));
  rememberPiece(name, { stream: path.basename(rec.dir), start: piece.start, end: piece.end });
  rec.pieces++;
  rec.cutTo = piece.end;
  // Chunks the next piece won't need (it starts overlapSeconds before this one's end).
  for (const c of piece.chunks) if (c.end < piece.end - set.overlapSeconds - CHUNK_SEC) fs.rmSync(path.join(rec.dir, c.file), { force: true });
  logEvent("live piece", { trigger: "auto", channel: rec.channel, creator: rec.creator, file: name, seconds: Math.round(piece.end - piece.start), video: rec.video });
  return name;
}

// Windows doesn't end a child process with its parent: a hub restart mid-stream left the recording ffmpeg running on
// its own (writing chunks no one cuts, while the next check started a second recording). On any exit through process.exit
// (the restart in restart.js, a crash in server.js) the running recordings are stopped first. A hard kill (Task
// Manager, closing the window) still can't be caught; sweepLiveDirs cleans that folder once its ffmpeg stops writing.
let exitHooked = false;
export function stopAllRecordings() {
  let n = 0;
  for (const rec of recs.values()) {
    if (rec.ended) continue;
    try { rec.proc.kill(); n++; } catch {}
  }
  return n;
}
function stopOnExit() {
  if (exitHooked) return;
  exitHooked = true;
  process.on("exit", stopAllRecordings);
}

function startRecording(creator, set, live) {
  const startedAt = new Date();
  const dir = resolvePath(path.join("data", "live", `${startedAt.toISOString().replace(/[-:]/g, "").slice(0, 15)}-${safeName(creator.name).replace(/ /g, "_")}`));
  fs.mkdirSync(dir, { recursive: true });
  const reconnect = ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "15"];
  const args = [
    "-hide_banner", "-loglevel", "error", "-y",
    ...reconnect, "-i", live.url,
    ...(live.audioUrl ? [...reconnect, "-i", live.audioUrl] : []),
    "-map", "0:v:0?", "-map", live.audioUrl ? "1:a:0?" : "0:a:0?", "-c", "copy",
    "-f", "segment", "-segment_time", String(CHUNK_SEC), "-segment_format", "mpegts",
    "-segment_list", "chunks.csv", "-segment_list_type", "csv", "chunk%05d.ts",
  ];
  const proc = spawn(ffmpegCmd(), args, { cwd: dir, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  const rec = { creator: creator.name, channel: set.channel, dir, proc, startedAt, cutTo: 0, pieces: 0, video: live.id, title: live.title, err: "" };
  proc.stderr.on("data", (d) => { rec.err = (rec.err + d).slice(-1500); });
  proc.on("error", (e) => { rec.err = String(e.message); });
  proc.on("close", (code) => {
    rec.ended = new Date();
    rec.code = code;
    finish(rec, set).catch((e) => console.warn(`Live clipping: last piece of ${rec.creator} failed: ${e.message}`));
  });
  recs.set(creator.name, rec);
  stopOnExit();
  logEvent("live start", { trigger: "auto", channel: set.channel, creator: creator.name, video: live.id, title: live.title });
  console.log(`Live clipping: recording ${creator.name} (${live.title})`);
  return rec;
}

// The stream ended (or its address expired, about every 6 h): the rest becomes a last piece if it's a minute or more.
// The next check starts a new recording if the creator is still live.
async function finish(rec, set) {
  try {
    await withCutLock(async () => {
      const piece = nextPiece(readChunks(rec.dir), rec.cutTo, { pieceSec: set.pieceMinutes * 60, overlapSec: set.overlapSeconds, final: true });
      if (piece) await cutPiece(rec, piece, set);
    });
  } finally {
    logEvent("live end", { trigger: "auto", channel: rec.channel, creator: rec.creator, pieces: rec.pieces, code: rec.code ?? null, error: rec.code ? rec.err.slice(-300) : null });
    if (recs.get(rec.creator) === rec) recs.delete(rec.creator);
    fs.rmSync(rec.dir, { recursive: true, force: true });
  }
}

// Every 15 s: cut finished pieces from running recordings. Every checkMinutes: look for creators who went live.
let cutting = false;
// Auto clean (the owner 2026-11-20): recording folders left behind when the hub restarted mid-stream (finish() never ran)
// are deleted once nothing has written to them for `idleMin` minutes. Only data/live/<stamp>-<name> folders that no
// running recording owns.
export function sweepLiveDirs({ now = Date.now(), idleMin = 15 } = {}) {
  const root = resolvePath(path.join("data", "live")), mine = new Set([...recs.values()].map((r) => path.resolve(r.dir)));
  const gone = [];
  let names = [];
  try { names = fs.readdirSync(root); } catch { return gone; }
  for (const n of names.filter((x) => /^\d{8}T\d{6}-/.test(x))) {
    const dir = path.join(root, n);
    if (mine.has(path.resolve(dir))) continue;
    let last = 0;
    try { last = Math.max(fs.statSync(dir).mtimeMs, ...fs.readdirSync(dir).map((f) => fs.statSync(path.join(dir, f)).mtimeMs)); } catch { continue; }
    if (now - last < idleMin * 60000) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    gone.push(n);
  }
  if (gone.length) logEvent("live clean", { trigger: "auto", folders: gone });
  return gone;
}

export async function liveTick({ now = Date.now() } = {}) {
  if (cutting) return;
  cutting = true;
  try {
    try { sweepLiveDirs({ now }); } catch (err) { console.warn(`Live clipping clean-up: ${err.message}`); }
    for (const set of liveSettings()) {
      for (const rec of recs.values()) {
        if (rec.channel !== set.channel || rec.ended) continue;
        await withCutLock(async () => {
          if (rec.ended) return; // finish() has taken over this recording
          const piece = nextPiece(readChunks(rec.dir), rec.cutTo, { pieceSec: set.pieceMinutes * 60, overlapSec: set.overlapSeconds });
          if (piece) await cutPiece(rec, piece, set);
        });
      }
      if (!set.on || standbyState().standby) continue;
      for (const creator of set.creators) {
        if (recs.has(creator.name)) continue;
        const last = lastCheck.get(creator.name);
        if (last && now - last.at < set.checkMinutes * 60000) continue;
        const live = await checkLive(creator.url, { maxHeight: set.maxHeight });
        lastCheck.set(creator.name, { at: now, live: live.live, why: live.why || null });
        if (live.live && live.url) startRecording(creator, set, live);
      }
    }
    for (const key of Object.keys(readPool())) {
      const { channel, creator } = poolKeyParts(key);
      const recording = [...recs.values()].some((r) => r.channel === channel && (!creator || r.creator === creator) && !r.ended);
      await releasePool(key, { now, recording });
    }
  } finally {
    cutting = false;
  }
}

export function stopRecording(name) {
  const rec = recs.get(name);
  if (!rec) return false;
  rec.proc.kill();
  return true;
}

// How many streams are being recorded right now (a count only: the city view, GET /api/agents/city).
export const recordingCount = () => [...recs.values()].filter((r) => !r.ended).length;

export async function liveStatus() {
  const sets = liveSettings();
  return {
    ytdlp: Boolean(await ytdlpCmd()),
    channels: sets.map((s) => ({
      channel: s.channel, on: s.on, pieceMinutes: s.pieceMinutes, minScore: s.minScore, maxPerPiece: s.maxPerPiece, perHour: s.perHour, bestPerHour: s.bestPerHour,
      pool: (() => {
        const p = readPool()[s.channel];
        return p ? { since: p.since, clips: p.items.length, sendsAt: new Date(Date.parse(p.since) + s.poolMinutes * 60000).toISOString() } : null;
      })(),
      neonCheck: s.neonCheck, neonModel: s.neonModel, autoApproveUntil: autoApproveUntil(s.channel)?.toISOString() || null, autoApproveHours: s.autoApproveHours,
      creators: s.creators.map((c) => {
        const rec = recs.get(c.name), chk = lastCheck.get(c.name);
        return {
          name: c.name, url: c.url,
          recording: rec ? { since: rec.startedAt.toISOString(), title: rec.title, pieces: rec.pieces, minutes: Math.round((readChunks(rec.dir).at(-1)?.end || 0) / 60) } : null,
          checked: chk ? { at: new Date(chk.at).toISOString(), live: chk.live, why: chk.why } : null,
        };
      }),
    })),
  };
}

// The on/off switch on the Pipeline page. Off also stops any recording (the part already recorded becomes a last piece).
export function setLiveOn(channel, on) {
  const cfg = loadPipelineConfig();
  const ch = cfg.channels?.[channel];
  if (!ch?.liveWatch) throw new Error(`${channel} has no liveWatch settings`);
  ch.liveWatch.on = Boolean(on);
  savePipelineConfig(cfg);
  if (!on) for (const rec of recs.values()) if (rec.channel === channel) rec.proc.kill();
  lastCheck.clear();
  return liveStatus();
}

// Auto-approve (the owner 2026-11-20): for autoApproveHours, live clips that passed the Neon check skip the owner's review
// (audit.js). Turning it on needs the dashboard password (the route); it ends by itself. hours 0 turns it off.
export function autoApproveUntil(channel, now = Date.now(), cfg = loadPipelineConfig()) {
  const lw = cfg.channels?.[channel]?.liveWatch, until = Date.parse(lw?.autoApproveUntil || "");
  return lw && lw.on !== false && Number.isFinite(until) && until > now ? new Date(until) : null;
}
export function setAutoApprove(channel, hours) {
  const cfg = loadPipelineConfig(), ch = cfg.channels?.[channel];
  if (!ch?.liveWatch) throw new Error(`${channel} has no liveWatch settings`);
  const h = Number(hours ?? liveSettingsFor(channel, cfg).autoApproveHours);
  if (!Number.isFinite(h) || h < 0 || h > 24) throw new Error("Hours must be 0 to 24.");
  if (h > 0 && liveSettingsFor(channel, cfg).neonCheck === false) throw new Error("Auto-approve needs the Neon check on.");
  if (h === 0) delete ch.liveWatch.autoApproveUntil;
  else ch.liveWatch.autoApproveUntil = new Date(Date.now() + h * 3600e3).toISOString();
  savePipelineConfig(cfg);
  logEvent("live auto-approve", { trigger: "button", channel, until: ch.liveWatch.autoApproveUntil || null });
  return { channel, autoApproveUntil: ch.liveWatch.autoApproveUntil || null };
}

// ---- posting pace -------------------------------------------------------------------------------------------------

// When a live clip should go up: null = public now; a Date = scheduled, because `perHour` live clips already went
// (or are booked) in the hour around now. Times are other postNow jobs' publishAt on the same channel.
export function livePostTime(channel, exceptId, { perHour = 3, now = new Date(), jobs = listJobs() } = {}) {
  const taken = jobs
    .filter((j) => j.channel === channel && j.id !== exceptId && j.data?.postNow && j.data.publishAt && j.data.videoId)
    .map((j) => Date.parse(j.data.publishAt))
    .filter((t) => t > now.getTime() - 3600e3)
    .sort((a, b) => a - b);
  const fits = (t) => taken.filter((x) => x > t - 3600e3 && x < t + 3600e3).length < perHour && !taken.some((x) => Math.abs(x - t) < 10 * 60000);
  if (fits(now.getTime())) return null;
  // Next quarter hour that fits, up to a day out.
  const q = 15 * 60000;
  for (let t = Math.ceil((now.getTime() + 20 * 60000) / q) * q, n = 0; n < 96; t += q, n++) if (fits(t)) return new Date(t);
  return null;
}


// ---- best of the hour ---------------------------------------------------------------------------------------------

// Where each live piece sat in its stream, so clips found in two pieces' shared overlap count as one moment.
const piecesFile = () => resolvePath(path.join("data", "live", "pieces.json"));
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); writeJsonAtomic(f, v, 1); }; // temp file then rename: pool.json and pieces.json sit in a synced folder
function rememberPiece(name, info) {
  const all = readJson(piecesFile(), {});
  all[name] = info;
  const names = Object.keys(all);
  for (const n of names.slice(0, Math.max(0, names.length - 300))) delete all[n];
  writeJson(piecesFile(), all);
}
export const pieceInfo = (name) => readJson(piecesFile(), {})[name] || null;

// The pool: { "<channel>" or "<channel>:test": { since, items: [{ file, score, hook, why, from, fromName, start, end,
// stream, at: absolute stream seconds, foundAt, testRun }] } }. Clips are already cut; they sit in data/live/pool/.
const poolFile = () => resolvePath(path.join("data", "live", "pool.json"));
export const poolDir = () => resolvePath(path.join("data", "live", "pool"));
export const readPool = () => readJson(poolFile(), {});
const writePool = (p) => writeJson(poolFile(), p);

// A pool's key: "<channel>", or "<channel>|<creator>" when pools are per streamer; ":test" after for test runs.
export const poolKey = (channel, creator, testRun = false) => channel + (creator && liveSettingsFor(channel).poolBy !== "channel" ? `|${creator}` : "") + (testRun ? ":test" : "");
export function poolKeyParts(key) {
  const k = String(key).replace(/:test$/, ""), i = k.indexOf("|");
  return i < 0 ? { channel: k, creator: null } : { channel: k.slice(0, i), creator: k.slice(i + 1) };
}
// The streamer in a live piece's name ("LIVE_SomeStreamer live 2026-11-20 2058 part 2.mp4" -> "SomeStreamer").
export const creatorOfPiece = (name) => String(name || "").match(/^LIVE[_ -](.+?) live \d{4}-/i)?.[1] || null;

export function addToPool(channel, items, { testRun = false, now = Date.now(), creator = null } = {}) {
  if (!items.length) return;
  const key = poolKey(channel, creator, testRun);
  const pool = readPool();
  const p = (pool[key] ||= { since: new Date(now).toISOString(), items: [] });
  p.items.push(...items.map((it) => ({ ...it, testRun, foundAt: new Date(now).toISOString() })));
  writePool(pool);
}

// Best first (score, then earliest), at most n, never two of the same moment (same stream, more than half shared).
// penalty: taken off a clip's score for each clip already picked from its streamer, and once more if its streamer is in
// `recent` (who had the last live clip posted). With no penalty it is plain best-by-score, as before.
export function pickBest(items, n, { penalty = 0, recent = [] } = {}) {
  const kept = [];
  const who = (m) => creatorOfPiece(m.fromName);
  const sameMoment = (k, m) => k.stream && k.stream === m.stream && Number.isFinite(k.at) && Number.isFinite(m.at) &&
    Math.min(k.at + (k.end - k.start), m.at + (m.end - m.start)) - Math.max(k.at, m.at) > 0.5 * Math.min(k.end - k.start, m.end - m.start);
  const order = (a, b) => Date.parse(a.foundAt) - Date.parse(b.foundAt) || a.start - b.start;
  let left = items.filter(Boolean);
  while (kept.length < n && left.length) {
    const weight = (m) => m.score - penalty * (kept.filter((k) => who(k) && who(k) === who(m)).length + (who(m) && recent.includes(who(m)) ? 1 : 0));
    const m = [...left].sort((a, b) => weight(b) - weight(a) || b.score - a.score || order(a, b))[0];
    left = left.filter((x) => x !== m);
    if (!kept.some((k) => sameMoment(k, m))) kept.push(m);
  }
  return kept;
}
// The streamer of the newest live clip that went on from a pool (to spread the next picks), or null.
function lastPostedCreator(channel, jobs) {
  const live = jobs.filter((j) => j.channel === channel && j.data?.splitFrom && LIVE_NAME.test(j.sourceName || "")).sort((a, b) => String(b.createdAt || b.at || "").localeCompare(String(a.createdAt || a.at || "")));
  return live.length ? creatorOfPiece(live[0].sourceName) : null;
}

// Sends the pool on when its hour is up, or sooner once the stream has ended and every piece has been scanned.
// The best `bestPerHour` become normal clip jobs (review, edit, audit, upload); the rest are deleted.
export async function releasePool(key, { now = Date.now(), recording = false, jobs = listJobs(), force = false } = {}) {
  const pool = readPool();
  const p = pool[key];
  // a bare channel (the Send-now button) sends every streamer's pool of that channel
  if (!p && !String(key).includes("|")) {
    const keys = Object.keys(pool).filter((k) => poolKeyParts(k).channel === key && k.includes("|") && !k.endsWith(":test"));
    if (!keys.length) return null;
    const all = [];
    for (const k of keys) { const r = await releasePool(k, { now, recording, jobs, force }); if (r) all.push(r); }
    return { found: all.reduce((a, r) => a + r.found, 0), sent: all.flatMap((r) => r.sent) };
  }
  if (!p) return null;
  const { channel, creator } = poolKeyParts(key);
  const set = liveSettingsFor(channel);
  if (!p.items.length) { delete pool[key]; writePool(pool); return null; }
  const hourUp = now - Date.parse(p.since) >= set.poolMinutes * 60000;
  const piecesLeft = jobs.some((j) => j.channel === channel && LIVE_NAME.test(j.sourceName || "") && (!creator || creatorOfPiece(j.sourceName) === creator) && !j.data?.splitFrom && ["queued", "running"].includes(j.status));
  const lastFound = Math.max(...p.items.map((i) => Date.parse(i.foundAt)));
  const streamDone = !recording && !piecesLeft && now - lastFound >= 2 * 60000;
  if (!force && !hourUp && !streamDone) return null;
  const last = set.repeatPenalty ? lastPostedCreator(channel, jobs.length ? jobs : listJobs()) : null;
  const best = pickBest(p.items, set.bestPerHour, { penalty: set.repeatPenalty, recent: last ? [last] : [] });
  const ids = [];
  for (const [i, m] of best.entries()) {
    // an item made by the lazy pool holds only its time range (m.src, start, end): it is cut here; an older one is a file
    if (!fs.existsSync(m.src || m.file)) { logEvent("live pool item lost", { trigger: "auto", channel, file: m.src || m.file }); continue; }
    const base = String(m.fromName || "LIVE clip").replace(/\.[^.]+$/, "");
    const child = createJob({ channel, sourceName: `${base} best ${i + 1} of ${best.length}.mp4` });
    const dest = path.join(jobDir(child.id), "source.mp4");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (m.src) {
      try { await withCutLock(() => cutClip(m.src, m.start, m.end, dest)); }
      catch (err) { logJob(child, `Couldn't cut this clip from ${m.fromName}: ${String(err.message).split(/\r?\n/)[0].slice(0, 200)}`); child.status = "skipped"; saveJob(child); continue; }
    } else moveFileSafe(m.file, dest);
    child.data.source = dest;
    child.data.postNow = true;
    if (m.testRun) child.data.testRun = true;
    child.data.splitFrom = { job: m.from, file: m.fromName, clip: i + 1, of: best.length, start: m.start, end: m.end, hook: m.hook, score: m.score };
    logJob(child, `Best of the hour (${m.score}/10, picked ${i + 1} of ${best.length} from ${p.items.length} live clip(s)), cut from ${m.fromName} at ${m.start.toFixed(1)}-${m.end.toFixed(1)} s: ${m.hook}`);
    saveJob(child);
    ids.push(child.id);
  }
  for (const m of p.items) if (!best.includes(m)) fs.rmSync(m.file, { force: true });
  delete pool[key];
  writePool(pool);
  logEvent("live best of hour", { trigger: "auto", channel, ...(creator ? { creator } : {}), found: p.items.length, sent: ids.length, scores: best.map((b) => b.score), why: hourUp ? "hour up" : force ? "button" : "stream ended" });
  return { found: p.items.length, sent: ids };
}
