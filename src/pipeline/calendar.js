// Posting calendar (to-do #16, the owner 2026-10-19): every YouTube and TikTok post in one month view, what went out and
// what's booked, for both channels. Read-only: it gathers what the trackers, jobs and TikTok backlog already know.
// Past posts come from the upload log / Pack Tracker (with views); the app's own jobs add exact times and bookings.
import { loadPipelineConfig, channelName, pipelineTz, dayIn } from "./util.js";
import { listJobs } from "./jobs.js";
import { exportStats } from "./stats.js";
import { backlogState } from "./tiktokbacklog.js";
import { chOfLayout } from "../hub/settings.js";

const timeIn = (tz, d) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
const titleOf = (j) => j.data.meta_out?.title || j.data.title || j.sourceName || j.id;

// One post. `at` is an ISO time when known; log rows without a time only carry a day.
function entry(tz, { at, day, time, platform, channel, title, views = null, videoId = null, url = null, now }) {
  const t = at ? Date.parse(at) : NaN;
  const d = Number.isFinite(t) ? new Date(t) : null;
  return {
    day: d ? dayIn(tz, d) : day,
    time: d ? timeIn(tz, d) : time || null,
    at: d ? d.toISOString() : null,
    platform, channel, title: String(title || "").slice(0, 140), views, videoId,
    url: url || (platform === "youtube" && videoId ? `https://youtube.com/shorts/${videoId}` : null),
    booked: d ? t > now : false,
  };
}

export async function postingCalendar() {
  const cfg = loadPipelineConfig();
  const tz = pipelineTz(cfg);
  const now = Date.now();
  const out = new Map(); // key -> entry; later sources with better times replace earlier ones
  const put = (key, e) => e.day && out.set(key, e);

  // 1. Trackers: everything that went out, with views.
  const data = await exportStats().catch(() => ({}));
  for (const c of data.clips || []) {
    if (!c.videoId && !c.title) continue;
    const m = String(c.scheduledFor || "").match(/(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/);
    put(`yt:${c.videoId || c.title}`, entry(tz, { day: m ? m[1] : c.date, time: m ? `${m[2].padStart(2, "0")}:${m[3]}` : null, platform: "youtube", channel: chOfLayout("clips").id, title: c.title, views: c.views ?? null, videoId: c.videoId, now }));
  }
  for (const p of data.packs || [])
    for (const v of p.videos || []) {
      if (!v.uploadDate) continue;
      const tt = /tiktok/i.test(v.platform || "");
      put(
        `${tt ? "tt" : "yt"}:${v.videoId || `${p.pid}-${v.platform}`}`,
        entry(tz, {
          day: v.uploadDate,
          platform: tt ? "tiktok" : "youtube",
          channel: chOfLayout("packs").id,
          title: `${p.pid}${p.episode != null ? ` Ep ${p.episode}` : ""}`,
          views: v.views ?? null,
          videoId: tt ? null : v.videoId,
          now,
        }),
      );
    }

  // 2. The app's own jobs: exact times, and what's booked ahead.
  for (const j of listJobs()) {
    if (j.data.testRun || !["scheduled", "published"].includes(j.status) || !j.data.videoId) continue;
    const key = `yt:${j.data.videoId}`;
    const prev = out.get(key);
    const at = j.data.publishAt || j.updatedAt || j.createdAt;
    put(key, { ...entry(tz, { at, platform: "youtube", channel: j.channel, title: titleOf(j), videoId: j.data.videoId, now }), views: prev?.views ?? null, job: j.id });
    const tt = j.data.tiktok;
    if (tt?.status === "posted")
      put(
        `tt:job:${j.id}`,
        entry(tz, { at: tt.scheduledFor || tt.at, platform: "tiktok", channel: j.channel, title: titleOf(j), url: tt.url, now }),
      );
    else if (tt?.status === "waiting")
      put(`tt:job:${j.id}`, {
        ...entry(tz, {
          at: tt.scheduleAt || (j.data.publishAt ? new Date(Date.parse(j.data.publishAt) + 120000).toISOString() : null),
          platform: "tiktok",
          channel: j.channel,
          title: titleOf(j),
          now,
        }),
        booked: true,
        planned: true,
      });
  }

  // 3. TikTok backlog (old videos re-posted), booked or posted.
  for (const p of backlogState().posts || []) put(`tt:bl:${p.channel}:${p.videoId}`, { ...entry(tz, { at: p.at, platform: "tiktok", channel: p.channel, title: p.title || p.videoId, now }), backlog: true });

  const posts = [...out.values()].sort((a, b) => `${a.day} ${a.time || "99"}`.localeCompare(`${b.day} ${b.time || "99"}`));
  // Days in the next two weeks with nothing booked on YouTube, per live channel (so gaps are easy to spot).
  for (const p of posts) p.channelName = channelName(p.channel, cfg);
  const gaps = [];
  for (let i = 0; i < 14; i++) {
    const d = dayIn(tz, new Date(now + i * 864e5));
    for (const id of Object.keys(cfg.channels || {})) {
      if (!cfg.channels?.[id]?.live) continue;
      if (!posts.some((p) => p.day === d && p.channel === id && p.platform === "youtube")) gaps.push({ day: d, channel: id, channelName: channelName(id, cfg) });
    }
  }
  return { tz, today: dayIn(tz, new Date(now)), posts, gaps };
}
