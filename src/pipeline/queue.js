// The Queue page (the owner 2026-10-19: "a queue so I know what is running and when"): one list of what the app is doing
// right now, what's waiting, and what's coming up with its time, plus the last few things that finished.
// Read-only: it only gathers what the other parts already know.
import { loadPipelineConfig, channelName, pipelineTz, backupHour, healthHour, standbyState } from "./util.js";
import { listJobs } from "./jobs.js";
import { openRuns, readRuns } from "./runlog.js";
import { pauseState } from "./admin.js";
import { watchConfig } from "./dealwatch.js";

const titleOf = (j) => j.data.meta_out?.title || j.data.title || j.sourceName || j.id;
const KIND = {
  "pipeline job": "Making a video",
  "tiktok post": "Posting to TikTok",
  "make public": "Going live on YouTube",
  "quick pull": "Quick stats pull",
  "advanced pull": "Advanced stats pull",
  "full pull": "Full stats pull",
  "health check": "Health check",
  backup: "Backup",
  "deal scan": "Deal watch scan",
  "rules review": "Rules review",
  "trade-up ideas": "Trade-up ideas",
};
export const kindName = (k) => KIND[k] || k.replace(/^./, (c) => c.toUpperCase());

// Next time the local clock reads hour:minute (today if still ahead, else tomorrow).
function nextAt(tz, hour, minute = 0) {
  const now = Date.now();
  for (let t = Math.ceil(now / 6e4) * 6e4; t < now + 2 * 864e5; t += 6e4) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    if (Number(p.hour) === hour && Number(p.minute) === minute) return new Date(t).toISOString();
  }
  return null;
}

export function queueView() {
  const cfg = loadPipelineConfig();
  const tz = pipelineTz(cfg);
  const chName = (id) => (id ? channelName(id, cfg) : "");
  const jobs = listJobs();
  const now = Date.now();

  const running = openRuns()
    .filter((r) => r.kind !== "app action")
    .map((r) => {
      const j = r.job ? jobs.find((x) => x.id === r.job) : null;
      return { what: kindName(r.kind), detail: j ? `${titleOf(j)}${j.stage ? ` · ${j.stage}` : ""}` : r.step || "", channel: chName(r.channel), since: r.startedAt, trigger: r.trigger };
    });

  // Waiting: pipeline jobs in line, and ones parked on the owner.
  const waiting = [];
  for (const j of [...jobs].reverse()) {
    if (j.status === "queued") waiting.push({ what: "Waiting to be made", detail: titleOf(j), channel: chName(j.channel), id: j.id });
    else if (j.status === "held") waiting.push({ what: "Needs you", detail: `${titleOf(j)}${j.hold?.reason ? ` · ${j.hold.reason}` : ""}`, channel: chName(j.channel), id: j.id, you: true });
    else if (j.status === "publishing") waiting.push({ what: "Going public next", detail: titleOf(j), channel: chName(j.channel), id: j.id });
    else if (j.status === "failed") waiting.push({ what: "Failed, needs a look", detail: `${titleOf(j)}${j.error?.message ? ` · ${j.error.message}` : ""}`, channel: chName(j.channel), id: j.id, you: true });
  }
  const paused = pauseState();

  // Coming up, with times.
  const upcoming = [];
  for (const j of jobs) {
    const pub = Date.parse(j.data.publishAt || "");
    if (j.status === "scheduled" && pub > now) upcoming.push({ at: j.data.publishAt, what: "Goes live on YouTube", detail: titleOf(j), channel: chName(j.channel) });
    const tt = j.data.tiktok;
    const ttAt = Date.parse(tt?.scheduledFor || "");
    if (tt?.status === "posted" && ttAt > now)
      upcoming.push({ at: tt.scheduledFor, what: "Goes live on TikTok", detail: titleOf(j), channel: chName(j.channel) });
    else if (tt?.status === "waiting")
      upcoming.push({
        at: tt.scheduleAt || (pub ? new Date(pub + 120000).toISOString() : null),
        what: tt.scheduleAt ? "Gets booked on TikTok" : "Posts to TikTok after YouTube",
        detail: titleOf(j),
        channel: chName(j.channel),
      });
  }
  upcoming.push({ at: nextAt(tz, backupHour(cfg)), what: "Nightly backup", detail: "", daily: true });
  upcoming.push({ at: nextAt(tz, healthHour(cfg)), what: "Morning health check", detail: "Then the rules review, when it's due", daily: true });
  const w = watchConfig();
  if (w.enabled !== false && w.hour != null) upcoming.push({ at: nextAt(tz, w.hour, w.minute || 0), what: "Deal watch scan", detail: "", daily: true });
  upcoming.sort((x, y) => (Date.parse(x.at) || Infinity) - (Date.parse(y.at) || Infinity));

  const recent = readRuns({ limit: 40 })
    .filter((r) => r.kind !== "app action" && r.ms > 0)
    .slice(0, 15)
    .map((r) => ({
      what: kindName(r.kind),
      ok: r.ok,
      error: r.error ? String(r.error).split("\n")[0].slice(0, 160) : null,
      at: r.endedAt,
      ms: r.ms,
      channel: chName(r.channel),
      detail: r.job ? titleOf(jobs.find((j) => j.id === r.job) || { data: {}, id: r.job }) : r.videoId || "",
    }));

  const standby = standbyState();
  return { now: new Date().toISOString(), tz, paused: paused.paused ? paused : null, standby: standby.standby ? standby : null, running, waiting, upcoming: upcoming.filter((u) => u.at).slice(0, 60), recent };
}
