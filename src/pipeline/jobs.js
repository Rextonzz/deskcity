// @ts-check
/** @typedef {import("../types.js").Job} Job */
import fs from "node:fs";
import path from "node:path";
import { renameRetry } from "./files.js";
import { loadPipelineConfig, resolvePath, channelCfg, pipelineTz } from "./util.js";
import { nextSlot, perDayOf } from "./schedule.js";

// A job id: channel, UTC stamp, 4 random characters (built in createJob).
export const JOB_ID = /^[a-z][a-z0-9_-]*-\d{14}-[a-z0-9]{4}$/; // channel ids may hold digits, _ and -
export const jobsDir = () => resolvePath(loadPipelineConfig().jobsDir);
export const archiveDir = () => resolvePath("data/jobs-archive");

export function jobDir(id) {
  return path.join(jobsDir(), id);
}

/** @param {{ channel: string, sourceName: string }} o @returns {Job} */
export function createJob({ channel, sourceName }) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const id = `${channel}-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
  fs.mkdirSync(jobDir(id), { recursive: true });
  const job = { id, channel, sourceName, status: "queued", stage: null, createdAt: new Date().toISOString(), updatedAt: null, hold: null, flags: [], data: {}, log: [] };
  saveJob(job);
  return job;
}

/** @param {Job} job */
export function saveJob(job) {
  job.updatedAt = new Date().toISOString();
  const file = path.join(jobDir(job.id), "job.json");
  // Its own temp name, so two saves of one job at once (the worker and a dashboard button) can't trip over each other.
  const tmp = `${file}.${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(job, null, 2));
    renameRetry(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw err;
  }
}

/** @param {string} id @returns {Job} */
export function loadJob(id) {
  return JSON.parse(fs.readFileSync(path.join(jobDir(id), "job.json"), "utf8"));
}

const badJobFiles = new Set();
/** @returns {Job[]} */
export function listJobs() {
  // The folder is worked out once per call: jobDir() re-reads pipeline.config.json each time.
  const dir = jobsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((id) => path.join(dir, id, "job.json"))
    .filter((file) => fs.existsSync(file))
    .flatMap((file) => {
      try {
        return [JSON.parse(fs.readFileSync(file, "utf8"))];
      } catch (err) {
        // One cut-off job.json must not stop every list, the worker and the dashboard.
        if (!badJobFiles.has(file)) { badJobFiles.add(file); console.warn(`Skipping ${file}: ${err.message}`); }
        return [];
      }
    })
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

// Saves only what a long step changed, onto the job as it is on disk now, so a button pressed meanwhile (Skip, It's in
// Studio) isn't undone by the worker's older copy (upload stress test 2026-10-23).
// `mark` is snapshot(job) taken before the step; `keys` are the job.data fields the step owns, `top` its top-level ones.
export const snapshot = (job) => ({ log: job.log.length, flags: [...job.flags] });
export function mergeSave(job, mark, keys, top = []) {
  const fresh = loadJob(job.id);
  for (const k of keys) {
    if (job.data[k] === undefined) delete fresh.data[k];
    else fresh.data[k] = job.data[k];
  }
  for (const k of top) fresh[k] = job[k];
  fresh.log.push(...job.log.slice(mark.log));
  fresh.flags = [...fresh.flags.filter((f) => job.flags.includes(f) || !mark.flags.includes(f)), ...job.flags.filter((f) => !fresh.flags.includes(f))];
  saveJob(fresh);
  Object.assign(job, fresh);
  return fresh;
}

// Planned publish times a new upload must not take: every other job's time (private ones have none) plus the
// planned time of any upload still in flight or stopped mid-way (Studio may have saved it). One list for the upload
// step and Make public (stress test 2026-10-23: Make public could book a stopped upload's slot).
export const bookedSlots = (channel, exceptId) =>
  listJobs().filter((j) => j.channel === channel && j.id !== exceptId).flatMap((j) => [j.data.visibility !== "private" && j.data.publishAt, !j.data.videoId && j.data.uploadPlan?.publishAt]).filter(Boolean);

// The next free upload slot for a channel, never one booked by another job (see bookedSlots).
export const nextFreeSlot = (channelId, exceptId) => {
  const ch = channelCfg(channelId);
  return nextSlot({ tz: pipelineTz(), slots: ch.slots, taken: bookedSlots(channelId, exceptId), perDay: perDayOf(channelId, ch) });
};

// Writes an upload's result on the job: video, visibility, planned time (a Date or ISO string; "now" for a public
// video with none) and whether a pinned comment is waiting (only when the channel pins and the metadata has one).
export function recordUpload(job, { videoId, visibility, publishAt }) {
  const iso = publishAt instanceof Date ? publishAt.toISOString() : publishAt;
  Object.assign(job.data, {
    videoId,
    visibility,
    publishAt: iso || (visibility === "public" ? new Date().toISOString() : null),
    pinPending: Boolean(channelCfg(job.channel)?.pinComment && visibility !== "private" && job.data.meta_out?.pinned_comment),
  });
}

// Playwright errors carry terminal colour codes ("\x1b[2m"); they show as junk on the page and the tracker
// spreadsheet refuses them (the 20fm tracking update failed every 10 s on one, 2026-10-20).
const plain = (s) => String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");

export function logJob(job, message) {
  message = plain(message);
  job.log.push({ at: new Date().toISOString(), message });
  console.log(`[${job.id}] ${message}`);
}

export function flag(job, message) {
  message = plain(message);
  if (!job.flags.includes(message)) job.flags.push(message);
}
