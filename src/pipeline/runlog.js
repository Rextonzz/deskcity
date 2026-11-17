// Run log: one line per stats pull, deal scan, health check, backup, rules review and pipeline job run,
// with start and end time, what it did (counts), how long each step took, warnings and the error if it failed.
// For debugging and as data points. data/logs/runs.jsonl, newest last, trimmed to the last 5000 entries.
import { resolvePath, appendJsonl, readJsonlCached } from "./util.js";
import { rollOverflow } from "./roll.js";

const FILE = () => resolvePath("data/logs/runs.jsonl");
const KEEP = 5000;
const MAX_WARNINGS = 50;

// trigger: "button" (the owner pressed it), "daily" / "nightly" (on a timer) or "worker".
// Runs that have started and not ended yet, for the Queue page's "Running now".
const OPEN = new Map();
let openId = 0;
export const openRuns = () => [...OPEN.values()].map((r) => ({ kind: r.kind, trigger: r.trigger, startedAt: r.startedAt, step: r.steps.at(-1)?.name || null, channel: r.channel || null, videoId: r.videoId || null, job: r.job || r.jobId || null }));

export function startRun(kind, { trigger = "button", ...info } = {}) {
  const run = { kind, trigger, startedAt: new Date().toISOString(), ...info, steps: [], warnings: [], warningCount: 0 };
  const myId = ++openId;
  OPEN.set(myId, run);
  // A run nobody ends (a crash mid-way) drops off "Running now" after 6 hours.
  const stale = setTimeout(() => OPEN.delete(myId), 6 * 36e5);
  stale.unref?.();
  let stepAt = Date.now();
  return {
    run,
    // Starts a named step; the previous step's time is recorded.
    step(name) {
      const last = run.steps.at(-1);
      if (last) last.ms = Date.now() - stepAt;
      stepAt = Date.now();
      run.steps.push({ name, ms: null });
    },
    warn(msg) {
      console.warn(`${kind}: ${msg}`);
      run.warningCount++;
      if (run.warnings.length < MAX_WARNINGS) run.warnings.push(String(msg).slice(0, 300));
    },
    end({ error = null, ...counts } = {}) {
      OPEN.delete(myId);
      clearTimeout(stale);
      const last = run.steps.at(-1);
      if (last && last.ms == null) last.ms = Date.now() - stepAt;
      const endedAt = new Date().toISOString();
      const entry = { ...run, endedAt, ms: Date.parse(endedAt) - Date.parse(run.startedAt), ok: !error, error: error ? String(error).slice(0, 500) : null, ...counts };
      if (!entry.steps.length) delete entry.steps;
      try {
        appendJsonl(FILE(), entry);
        trim();
      } catch (err) {
        console.warn(`Run log: couldn't write: ${err.message}`);
      }
      return entry;
    },
  };
}

// A job that must not run twice at once: a second call while it runs gets the running one's promise.
const ONCE = new Map();
export function onceJob(key, start) {
  const prev = ONCE.get(key);
  if (prev?.running) return prev.promise;
  const task = { running: true, since: new Date().toISOString(), error: null };
  ONCE.set(key, task);
  task.promise = (async () => start())().catch((err) => {
    task.error = String(err.message).split("\n")[0];
    throw err;
  }).finally(() => (task.running = false));
  return task.promise;
}
// A job as one call: starts the run, hands fn the run handle, ends the run with the counts fn returns and gives back its result.
// fn returns { result, counts }, or ends the run itself (log.end) and returns { result }. A throw ends the run with the error and rethrows.
// once: a key for onceJob.
export function withRun(kind, info, fn, { once } = {}) {
  if (once) return onceJob(once, () => withRun(kind, info, fn));
  const log = startRun(kind, info);
  let ended = false;
  const handle = { ...log, end: (...a) => ((ended = true), log.end(...a)) };
  return (async () => {
    try {
      const out = (await fn(handle)) || {};
      if (!ended) log.end(out.counts);
      return out.result;
    } catch (err) {
      if (!ended) log.end({ error: err.message });
      throw err;
    }
  })();
}
// What a page polls for a once key: { running, since, error } (error stays after the job ends, until the next one starts).
export const onceState = (key) => {
  const { running, since, error } = ONCE.get(key) || { running: false };
  return since ? { running, since, error } : { running };
};

let writes = 0;
function trim() {
  if (++writes % 50) return;
  rollOverflow(FILE(), KEEP, { field: "startedAt" }); // older lines roll into their month file
}

// Something that happens at once (a button press, an alert sent): logged as a run with no duration.
export const logEvent = (kind, info = {}) => startRun(kind, { trigger: info.trigger || "button", ...info }).end({ error: info.error ?? null });

// Newest first. kinds: list of kinds to include (all if empty).
// Parsed once per change of the file: one page open asks for the AI calls several times (costs, credits, dev cost).
// The rows are shared between callers, so treat them as read-only.
const allRuns = () => readJsonlCached(FILE());

export function readRuns({ kinds = [], limit = 100 } = {}) {
  const rows = allRuns();
  const out = [];
  for (let i = rows.length - 1; i >= 0 && out.length < limit; i--) if (!kinds.length || kinds.includes(rows[i].kind)) out.push(rows[i]);
  return out;
}
