// Stats for the dashboard: reads the trackers, and pulls each posted video's numbers from Studio into them.
// Pulls only run when the owner presses "Pull stats" (his rule: stats pulls stay manual).
import { startRun } from "./runlog.js";
import { chOfLayout } from "../hub/settings.js";
import { resolveCreators, logFixes, fromTitle } from "./creators.js";
import fs from "node:fs";
import path from "node:path";
import { run, resolvePath, loadPipelineConfig, pipelineTz, pythonCmd, readJson, writeJsonAtomic, readJsonl, appendJsonl, OWNER } from "./util.js";
import { exclusive } from "./studio/browser.js";
import { readVideoStats, switchTo, listShorts, readComments, STAT_TABS } from "./studio/analytics.js";
import { newPage } from "./studio/browser.js";
import { studioLabels } from "./schedule.js";
import { listTikTokPosts } from "./studio/tiktok.js";
import { listJobs } from "./jobs.js";

// The channels with the pack layout and the clip layout (pipeline.config.json), the two trackers a pull knows how to read.
const packsId = () => chOfLayout("packs").id, clipsId = () => chOfLayout("clips").id;
const statsDir = () => resolvePath("data/stats");
const trackerArgs = () => {
  const ch = loadPipelineConfig().channels;
  return [ch[packsId()]?.trackerPath || "", resolvePath(ch[clipsId()]?.logPath || "")];
};
const stats = async (...args) => JSON.parse((await run(pythonCmd(), [resolvePath("python/stats.py"), ...args])).stdout.toString());

// Every video's full numbers from the latest pull it was read in (views, likes, comments, shares, subs, stayed,
// avgPct), by video ID. The trackers keep what their columns hold; this keeps everything, for learning. Rows carry
// a platform so TikTok numbers can sit beside YouTube's later.
const VIDEOS = () => path.join(statsDir(), "videos.json");
export const videoStats = () => readJson(VIDEOS(), {});
function saveVideoStats(found, asOf) {
  const all = videoStats();
  for (const [id, s] of Object.entries(found)) if (id !== "_extras" && s && typeof s === "object") all[id] = { ...all[id], ...s, platform: "youtube", asOf };
  writeJsonAtomic(VIDEOS(), all, 1);
  // Every video's view count at this pull, one line per pull, so later pulls can say how many views came in since.
  const v = Object.fromEntries(Object.entries(all).filter(([, s]) => s.platform === "youtube" && s.views != null).map(([id, s]) => [id, s.views]));
  if (Object.keys(v).length) appendJsonl(VIEWS_HISTORY(), { at: new Date().toISOString(), v });
}

const VIEWS_HISTORY = () => path.join(statsDir(), "views-history.jsonl");
// Views gained per video since the pull closest to `days` ago (at or before it). null until a pull that old exists.
export function viewsGained(days = 7) {
  const rows = readJsonl(VIEWS_HISTORY());
  if (!rows.length) return null;
  const cut = Date.now() - days * 864e5;
  const base = [...rows].reverse().find((r) => Date.parse(r.at) <= cut);
  if (!base) return { since: null, firstAt: rows[0].at };
  const last = rows.at(-1);
  const byId = {};
  for (const [id, n] of Object.entries(last.v)) byId[id] = n - (base.v[id] || 0);
  return { since: base.at, until: last.at, byId };
}

// Comment text per video (to-do #18 part 3): { videoId: { count, asOf, items: [{ text, author, likes, reply }] } }.
// Read only for videos whose comment count changed since the last read, so repeat pulls stay short.
const COMMENTS = () => path.join(statsDir(), "comments.json");
export const commentStats = () => readJson(COMMENTS(), {});
// Videos with comments not read yet at their current count (from the Content list, else the last saved numbers).
function commentsDue(videos, found) {
  const have = commentStats(), vs = videoStats();
  return videos.filter((v) => {
    const n = found[v.videoId]?.comments ?? vs[v.videoId]?.comments;
    return n > 0 && have[v.videoId]?.count !== n;
  });
}

// TikTok numbers per post (data/stats/tiktok.json), each matched to the YouTube video it came from: by the TikTok
// link the app saved when it posted (jobs, backlog), else by caption words against the upload log's titles.
const TIKTOK = () => path.join(statsDir(), "tiktok.json");
export const tiktokStats = () => readJson(TIKTOK(), { channels: {} });
// The last pull's numbers the trackers don't keep (to-do #18, the owner 2026-10-19): subscribers gained, engaged share,
// average % watched, watch hours, top traffic sources, and the matched TikTok post's views, likes, shares and saves.
// One function so Ask Claude, the rules review and the title prompts all see the same fields. Empty fields are left
// out so prompts stay small.
export function statsExtras() {
  const vs = videoStats();
  const cm = commentStats();
  const tt = {};
  for (const ch of Object.values(tiktokStats().channels || {})) for (const p of Object.values(ch.posts || {})) if (p.youtubeId) tt[p.youtubeId] = p;
  const r2 = (x) => (x == null ? undefined : Math.round(x * 100) / 100);
  return (videoId) => {
    const v = vs[videoId] || {};
    const t = tt[videoId];
    const top = v.traffic && typeof v.traffic === "object" ? Object.entries(v.traffic).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, x]) => `${k} ${Math.round(x * 100)}%`).join(", ") : undefined;
    const out = {
      stayed: v.stayed ?? undefined, avgViewed: v.avgPct ?? undefined, subs: v.subs ?? undefined, comments: v.comments ?? undefined,
      engagedShare: v.engagedViews && v.views ? r2(v.engagedViews / v.views) : undefined, watchHours: v.watchHours ?? undefined, traffic: top || undefined,
      subsPer1k: v.subs != null && v.views ? r2((v.subs / v.views) * 1000) : undefined,
      impressions: v.impressions ?? undefined, ctr: v.ctr ?? undefined, viewedVsSwiped: v.viewedVsSwiped ?? undefined,
      returningViewers: v.returningViewers ?? undefined, newViewers: v.newViewers ?? undefined,
      // Up to 5 top-level comments, most liked first, short enough to keep prompts small.
      commentText: cm[videoId]?.items?.length ? cm[videoId].items.filter((c) => !c.reply).sort((a, b) => b.likes - a.likes).slice(0, 5).map((c) => c.text.slice(0, 160)) : undefined,
      tiktokNumbers: t ? { views: t.views, likes: t.likes, shares: t.shares, saves: t.saves, comments: t.comments } : undefined,
    };
    return Object.fromEntries(Object.entries(out).filter(([, x]) => x !== undefined && x !== null));
  };
}
const words = (t) => new Set(String(t || "").toLowerCase().replace(/#\w+/g, " ").match(/[a-z0-9']{3,}/g) || []);
function saveTikTok(key, posts, data) {
  const byPost = {};
  const idOf = (url) => String(url || "").match(/\/video\/(\d+)/)?.[1];
  for (const j of listJobs()) for (const p of j.data.tiktok?.posted || []) if (idOf(p.url) && j.data.videoId) byPost[idOf(p.url)] = j.data.videoId;
  try {
    const b = JSON.parse(fs.readFileSync(resolvePath("data/tiktok/backlog.json"), "utf8"));
    for (const [vid, i] of Object.entries(b.items || {})) if (idOf(i.url)) byPost[idOf(i.url)] = vid;
  } catch {}
  const clips = (data.clips || []).filter((c) => c.videoId);
  const guess = (caption) => {
    const w = words(caption);
    let best = null;
    for (const c of clips) {
      const t = words(`${c.title} ${c.creator || ""}`);
      const hit = [...t].filter((x) => w.has(x)).length / Math.max(1, Math.min(t.size, w.size));
      if (hit >= 0.6 && (!best || hit > best.hit)) best = { hit, id: c.videoId };
    }
    return best?.id || null;
  };
  const all = tiktokStats();
  const asOf = new Date().toISOString();
  const prev = all.channels[key]?.posts || {};
  const out = {};
  for (const p of posts) {
    const yt = byPost[p.postId] || prev[p.postId]?.youtubeId || guess(p.caption);
    out[p.postId] = {
      ...prev[p.postId],
      ...Object.fromEntries(Object.entries(p).filter(([, v]) => v != null)),
      youtubeId: yt || null,
      matchedBy: byPost[p.postId] ? "link" : prev[p.postId]?.youtubeId ? prev[p.postId].matchedBy : yt ? "caption" : null,
      asOf,
    };
  }
  all.channels[key] = { asOf, posts: { ...prev, ...out } };
  writeJsonAtomic(TIKTOK(), all, 1);
  // Beside YouTube's numbers too, for learning (videos.json, platform "tiktok").
  const v = videoStats();
  for (const p of Object.values(out)) v[`tt:${p.postId}`] = { platform: "tiktok", youtubeId: p.youtubeId, views: p.views, likes: p.likes, comments: p.comments, shares: p.shares, saves: p.saves, asOf: asOf.slice(0, 10) };
  writeJsonAtomic(VIDEOS(), v, 1);
  return Object.keys(out).length;
}

// TikTok views by YouTube video (posts of the same clip added up), for the upload log's TikTok columns.
function tiktokByYoutube(key) {
  const out = {};
  for (const p of Object.values(tiktokStats().channels?.[key]?.posts || {})) {
    if (!p.youtubeId || p.views == null) continue;
    const o = (out[p.youtubeId] ??= { views: 0, asOf: String(p.asOf || "").slice(0, 10) || null });
    o.views += p.views;
  }
  return out;
}

// "Pull TikTok stats" on the TikTok stats page: only TikTok Studio's post list (about a minute), then the upload log.
let ttPull = { running: false };
export const tiktokPullState = () => ttPull;
export function pullTikTokStats({ trigger = "button" } = {}) {
  if (ttPull.running) return ttPull;
  if (pullState.running) return { running: false, error: "A stats pull is running; it reads TikTok too." };
  const on = Object.entries(loadPipelineConfig().channels).filter(([, c]) => c.tiktok?.enabled);
  if (!on.length) return { running: false, error: "No channel has TikTok turned on." };
  ttPull = { running: true, startedAt: new Date().toISOString() };
  const log = startRun("tiktok stats", { trigger });
  exclusive(async () => {
    const data = await stats("export", ...trackerArgs());
    const debugDir = path.join(statsDir(), "debug");
    fs.mkdirSync(debugDir, { recursive: true });
    const posts = {};
    for (const [key, c] of on) {
      log.step(`Reading ${c.name} TikTok posts`);
      posts[key] = saveTikTok(key, await listTikTokPosts({ handle: c.tiktok.handle, debugDir }), data);
    }
    log.step("Writing the upload log");
    const tt = tiktokByYoutube(clipsId());
    let logRows = 0;
    if (Object.keys(tt).length) {
      const f = path.join(statsDir(), "tiktok-log.json");
      fs.writeFileSync(f, JSON.stringify({ _tiktok: tt }));
      logRows = (await stats("write", ...trackerArgs(), f)).tiktok || 0;
    }
    return { posts, logRows };
  })
    .then((r) => ((ttPull = { running: false, finishedAt: new Date().toISOString(), result: r }), log.end(r)))
    .catch((err) => {
      const error = err.message.replace(/^.*?exited \d+: /s, "").split("\n")[0];
      ttPull = { running: false, finishedAt: new Date().toISOString(), error };
      log.end({ error });
    });
  return ttPull;
}

const EXTRA = () => path.join(statsDir(), "extra-clips.json");
const readExtra = () => readJson(EXTRA(), []);

// Tracker data, plus a channel Shorts found on the channel that aren't in the upload log.
export const exportStats = async () => {
  const data = await stats("export", ...trackerArgs());
  if (data.clips) {
    const inLog = new Set(data.clips.map((c) => c.videoId));
    data.clips.push(...readExtra().filter((c) => !inLog.has(c.videoId)));
    resolveCreators(data.clips);
  }
  return data;
};

// Puts verified creators (or a blank, never a guess) on the log rows Pull stats added.
export async function fixLogCreators() {
  const data = await stats("export", ...trackerArgs());
  const file = path.join(statsDir(), "creator-fixes.json");
  fs.mkdirSync(statsDir(), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(logFixes(data.clips || [])));
  return stats("creators", ...trackerArgs(), file);
}

// When each video went public, from its watch page ("datePublished"), in the upload log's own format
// ("Mon Oct 19, 4:00 PM", the owner's town time).
export async function postTimes(ids) {
  const out = {};
  const tz = pipelineTz();
  for (const id of ids.slice(0, 200)) {
    try {
      const html = await (await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en" }, signal: AbortSignal.timeout(15000) })).text();
      const iso = html.match(/itemprop="datePublished" content="([^"]+)"/)?.[1] || html.match(/"publishDate":"([^"]+)"/)?.[1];
      if (iso && /T\d{2}:\d{2}/.test(iso)) out[id] = studioLabels(tz, new Date(iso)).pretty;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return out;
}

export const pullState = { running: false, done: 0, total: 0, current: null, startedAt: null, finishedAt: null, error: null, result: null, missing: [] };

const lastPull = () => readJson(path.join(statsDir(), "last-pull.json"), null);

// typicalMs: how long the last pull of the same kind took, for the time-left estimate before any video is done.
const typicalPull = (quick) => readJson(path.join(statsDir(), `pull-time-${quick ? "quick" : "full"}.json`), null)?.ms ?? null;
export const pullStatus = () => ({
  ...pullState,
  typicalMs: pullState.running ? (pullState.kind === "advanced" ? (pullState.estimateMs ?? null) : typicalPull(pullState.quick)) : null,
  typical: { full: typicalPull(false), quick: typicalPull(true) },
  last: pullState.running ? null : lastPull(),
});

// Videos worth pulling: every posted video in the Performance sheet and a channel log.
function videoList(data) {
  const cfg = loadPipelineConfig().channels;
  const list = [];
  for (const p of data.packs || [])
    for (const v of p.videos)
      if (v.videoId && /youtube/i.test(v.platform || "YouTube"))
        list.push({
          videoId: v.videoId,
          channel: cfg[packsId()],
          key: packsId(),
          label: `${p.pid} Ep ${p.episode ?? "?"}`,
          date: v.uploadDate || "",
          missing: v.views == null || v.stayed == null,
        });
  for (const c of data.clips || []) if (c.videoId) list.push({ videoId: c.videoId, channel: cfg[clipsId()], key: clipsId(), label: c.title, date: c.date || "", missing: c.views == null });
  return list;
}

// What a pull reads. Quick and Full are presets; the Advanced pull sends its own plan.
//   channels: whose videos. videos: "all", "recent" (posted in the last `days` days) or "missing" (no numbers yet).
//   list: read each channel's Content list (views, comments and length for every Short in one page; also finds
//         a channel Shorts missing from the log). tabs: analytics pages opened per video
//         (tab-overview: views, subscribers, stayed to watch, traffic; tab-engagement: engaged views, watch time, average %
//         viewed; tab-content: in Studio's new layout the Reach tab, impressions, click rate, viewed vs swiped away).
// The channels the stats pull, insights and rules review know how to read (each one's tracker has its own shape).
export const statsChannels = () => [packsId(), clipsId()].filter(Boolean);
const BOTH = statsChannels; // (a function: the channel list is read from the config each time)
export const presets = () => ({
  quick: { channels: BOTH(), videos: "all", days: 30, list: true, tabs: [], comments: false },
  full: { channels: BOTH(), videos: "all", days: 30, list: true, tabs: STAT_TABS, comments: true },
});
function cleanPlan(p = {}) {
  return {
    channels: BOTH().filter((c) => (Array.isArray(p.channels) ? p.channels : BOTH()).includes(c)),
    videos: ["all", "recent", "missing"].includes(p.videos) ? p.videos : "all",
    days: Math.min(3650, Math.max(1, Number(p.days) || 30)),
    list: p.list !== false,
    tabs: STAT_TABS.filter((t) => (Array.isArray(p.tabs) ? p.tabs : []).includes(t)),
    comments: p.comments === true,
  };
}
const planKind = (plan) => (JSON.stringify(plan) === JSON.stringify(presets().quick) ? "quick" : JSON.stringify(plan) === JSON.stringify(presets().full) ? "full" : "advanced");

// How long each part of a pull takes on this PC, learned from past pulls, for the Advanced pull's estimate.
// Starting values come from the first real full pull (2026-10-18): the overview page loads in about 4 s, while the
// engagement and content pages never showed their numbers for Shorts and each waited out the full 20 s.
const RATES = () => path.join(statsDir(), "pull-rates.json");
const DEFAULT_RATES = { list: 45000, switch: 8000, comments: 8000, tabs: { "tab-overview": 5000, "tab-engagement": 21000, "tab-content": 21000 }, emptyShare: { "tab-engagement": 1, "tab-content": 1 } };
export function pullRates() {
  const r = readJson(RATES(), null) ?? {};
  return { ...DEFAULT_RATES, ...r, tabs: { ...DEFAULT_RATES.tabs, ...r.tabs }, emptyShare: { ...DEFAULT_RATES.emptyShare, ...r.emptyShare } };
}
const median = (a) => {
  const x = [...a].sort((m, n) => m - n);
  return x.length ? x[Math.floor(x.length / 2)] : null;
};
function learnRates({ listMs, switchMs, timings, commentMs = [] }) {
  const r = pullRates();
  const blend = (old, now) => (now == null ? old : Math.round(old == null ? now : old * 0.5 + now * 0.5));
  r.list = blend(r.list, median(listMs));
  r.comments = blend(r.comments, median(commentMs));
  r.switch = blend(r.switch, median(switchMs));
  for (const tab of STAT_TABS) {
    const t = timings.filter((x) => x.tab === tab);
    if (!t.length) continue;
    r.tabs[tab] = blend(r.tabs[tab], median(t.map((x) => x.ms)));
    r.emptyShare[tab] = Math.round((t.filter((x) => !x.fields.length).length / t.length) * 100) / 100;
  }
  r.updated = new Date().toISOString();
  writeJsonAtomic(RATES(), r, 2);
}

// Same sum the Advanced pull panel shows: Content lists + pages per video + one account switch per channel + ~15 s
// for reading and writing the trackers.
export function estimatePull({ listCount, perVideo, channelsWithVideos, tabs, commentVideos = 0 }, r = pullRates()) {
  return Math.round(15000 + listCount * r.list + perVideo * tabs.reduce((t, tab) => t + (r.tabs[tab] || 0), 0) + (perVideo || commentVideos ? channelsWithVideos * r.switch : 0) + commentVideos * r.comments);
}

// Everything the Advanced pull panel needs to estimate a plan as the owner changes it.
export async function pullPlanInfo() {
  const data = await stats("export", ...trackerArgs());
  const extras = readExtra();
  const due = new Set(commentsDue(videoList(data), {}).map((v) => v.videoId));
  const videos = videoList(data).map((v) => ({ ch: v.key, date: v.date, missing: v.missing, comments: due.has(v.videoId) }));
  return { videos, extraClips: extras.length, rates: pullRates(), presets: presets() };
}

export function stopPull() {
  if (pullState.running) pullState.stopRequested = true;
  return pullStatus();
}

export function startPull({ quick = false, plan: wanted, trigger = "button" } = {}) {
  if (pullState.running) return pullStatus();
  const plan = cleanPlan(wanted || (quick ? presets().quick : presets().full));
  const kind = planKind(plan);
  quick = kind === "quick";
  const log = startRun(`${kind} pull`, { trigger, plan });
  const counts = { listed: {} };
  const learned = { listMs: [], switchMs: [], timings: [], commentMs: [] };
  Object.assign(pullState, { running: true, quick, kind, plan, done: 0, total: 0, current: null, startedAt: new Date().toISOString(), finishedAt: null, error: null, result: null, missing: [], stopRequested: false, stopped: false, estimateMs: null });
  exclusive(async () => {
    const debugDir = path.join(statsDir(), "debug");
    fs.mkdirSync(debugDir, { recursive: true });
    log.step("Reading the trackers");
    const data = await stats("export", ...trackerArgs());
    const all = videoList(data);
    const known = new Set(all.map((v) => v.videoId));
    const channels = loadPipelineConfig().channels;
    const listed = {};
    // The Content list gives views for every Short at once. a channel is always listed when its videos are
    // in the plan, to find Shorts missing from the log.
    const listKeys = plan.list ? plan.channels : plan.channels.filter((c) => c === clipsId() && plan.tabs.length);
    for (const key of listKeys) {
      const ch = channels[key];
      if (!ch?.channelId) continue;
      fs.rmSync(path.join(debugDir, `shorts-${ch.channelId}.txt`), { force: true });
      pullState.current = `Listing ${ch.name} Shorts`;
      log.step(pullState.current);
      const t = Date.now();
      try {
        listed[key] = await listShorts({ channel: ch, debugDir });
        counts.listed[key] = listed[key].length;
        learned.listMs.push(Date.now() - t);
      } catch (err) {
        if (/signed in/.test(err.message) || !plan.tabs.length) throw err;
        log.warn(`Listing ${ch.name} Shorts failed: ${err.message}`);
      }
    }
    // Add every a channel Short Studio lists that the upload log doesn't have.
    // Only Public Shorts, and never one the app made or let go (drafts left, replaced by Re-make): a private test or a
    // draft would otherwise be added here as "Published" (code review 2026-10-22).
    const appMade = new Set(listJobs().flatMap((j) => [j.data.videoId, ...(j.data.draftsLeft || []), ...(j.data.replaced || []).map((r) => r?.videoId || r)]).filter(Boolean));
    const extras = (listed[clipsId()] || []).filter((s) => !known.has(s.videoId) && s.visibility === "Public" && !appMade.has(s.videoId));
    for (const e of extras) all.push({ videoId: e.videoId, channel: channels[clipsId()], key: clipsId(), label: e.title, date: e.date || "", missing: true, extra: e });
    const since = new Date(Date.now() - plan.days * 864e5).toISOString().slice(0, 10);
    const inPlan = all.filter((v) => plan.channels.includes(v.key) && (plan.videos === "all" || (plan.videos === "recent" ? !v.date || v.date >= since : v.missing)));
    const found = {};
    counts.found = found;
    // Numbers from the Content list, for every listed video in the plan.
    const byId = Object.fromEntries(Object.values(listed).flat().map((r) => [r.videoId, r]));
    if (plan.list) for (const v of inPlan) if (byId[v.videoId]?.views != null) found[v.videoId] = { views: byId[v.videoId].views, comments: byId[v.videoId].comments, length: byId[v.videoId].length };
    const perVideo = plan.tabs.length ? inPlan : [];
    pullState.estimateMs = estimatePull({ listCount: listKeys.length, perVideo: perVideo.length, channelsWithVideos: new Set(perVideo.map((v) => v.key)).size, tabs: plan.tabs, commentVideos: plan.comments ? commentsDue(inPlan, found).length : 0 });
    pullState.total = plan.tabs.length ? perVideo.length : inPlan.length;
    Object.assign(counts, { videos: inPlan.length, notInLog: extras.length });
    if (!plan.tabs.length) {
      for (const v of inPlan) if (!found[v.videoId]) pullState.missing.push(v.label);
      pullState.done = inPlan.length;
    } else log.step(`Reading each video's analytics (${plan.tabs.map((t) => t.replace("tab-", "")).join(", ")})`);
    let onChannel = null;
    for (const v of perVideo) {
      if (pullState.stopRequested) {
        pullState.stopped = true;
        log.warn(`Stopped by ${OWNER()} after ${pullState.done} of ${perVideo.length} videos; saved what was read.`);
        break;
      }
      pullState.current = v.label;
      // Videos are grouped by channel; switch Chrome to that channel's account once at the start of each group.
      if (onChannel !== v.channel.channelId) {
        const t = Date.now();
        const page = await newPage();
        await switchTo(page, v.channel).catch((err) => log.warn(`Switching to ${v.channel.name} failed: ${err.message}`));
        await page.close();
        learned.switchMs.push(Date.now() - t);
        onChannel = v.channel.channelId;
      }
      try {
        const s = await readVideoStats({ videoId: v.videoId, channel: v.channel, debugDir, tabs: plan.tabs, timings: learned.timings });
        if (v.extra?.length && s.length == null) s.length = v.extra.length;
        if (Object.keys(s).length) found[v.videoId] = { ...found[v.videoId], ...s };
        else if (!found[v.videoId]) pullState.missing.push(v.label);
      } catch (err) {
        // A sign-in problem, or the first three videos all failing (Chrome didn't start), stops the pull.
        if (/signed in/.test(err.message) || (pullState.done === 2 && pullState.missing.length === 2)) throw err;
        log.warn(`${v.label}: ${err.message.split("\n")[0]}`);
        if (!found[v.videoId]) pullState.missing.push(v.label);
      }
      pullState.done++;
    }
    // Comment text, only for videos whose comment count changed since the last read.
    if (plan.comments && !pullState.stopped) {
      const due = commentsDue(inPlan, found).sort((a, b) => a.key.localeCompare(b.key));
      if (due.length) {
        log.step(`Reading comments on ${due.length} video${due.length > 1 ? "s" : ""}`);
        const saved = commentStats();
        let read = 0, ch = onChannel;
        for (const v of due) {
          if (pullState.stopRequested) break;
          pullState.current = `Comments: ${v.label}`;
          if (ch !== v.channel.channelId) {
            const page = await newPage();
            await switchTo(page, v.channel).catch((err) => log.warn(`Switching to ${v.channel.name} failed: ${err.message}`));
            await page.close();
            ch = v.channel.channelId;
          }
          const t = Date.now();
          try {
            const items = await readComments({ videoId: v.videoId, channel: v.channel, debugDir });
            learned.commentMs.push(Date.now() - t);
            if (items.length) {
              saved[v.videoId] = { count: found[v.videoId]?.comments ?? videoStats()[v.videoId]?.comments ?? items.length, asOf: new Date().toISOString().slice(0, 10), items };
              read++;
            } else log.warn(`${v.label}: no comments showed on its Studio comments page (page saved to data/stats/debug).`);
          } catch (err) {
            if (/signed in/.test(err.message)) throw err;
            log.warn(`${v.label} comments: ${err.message.split("\n")[0]}`);
          }
        }
        writeJsonAtomic(COMMENTS(), saved, 1);
        counts.comments = read;
      }
    }
    // Also kept here, so they still show on the Stats page if the log couldn't be written.
    const asOf = new Date().toISOString().slice(0, 10);
    const old = Object.fromEntries(readExtra().map((c) => [c.videoId, c]));
    for (const v of all.filter((x) => x.extra))
      old[v.videoId] = {
        videoId: v.videoId,
        title: v.extra.title,
        date: v.extra.date,
        creator: "",
        views: found[v.videoId]?.views ?? old[v.videoId]?.views ?? null,
        viewsAsOf: found[v.videoId] ? asOf : old[v.videoId]?.viewsAsOf || "",
        notInLog: true,
      };
    writeJsonAtomic(EXTRA(), Object.values(old), 2);
    const file = path.join(statsDir(), "pulled.json");
    // the owner's call (2026-10-18): Shorts missing from the upload log get added to it.
    const _extras = all.filter((x) => x.extra).map((v) => ({ videoId: v.videoId, title: v.extra.title, date: v.extra.date, length: v.extra.length ?? null, views: found[v.videoId]?.views ?? null, creator: fromTitle(v.extra.title) || "" }));
    fs.writeFileSync(file, JSON.stringify({ ...found, _extras }, null, 2));
    try {
      saveVideoStats(found, asOf);
    } catch (err) {
      log.warn(`Couldn't keep the full numbers: ${err.message}`);
    }
    // TikTok: every post's numbers from TikTok Studio, matched to its YouTube video, for the TikTok stats page.
    const ttOn = Object.entries(channels).filter(([k, c]) => plan.channels.includes(k) && c.tiktok?.enabled);
    if (plan.list && ttOn.length) {
      for (const [key, ch] of ttOn) {
        log.step(`Reading ${ch.name} TikTok posts`);
        pullState.current = `${ch.name} on TikTok`;
        try {
          const posts = await listTikTokPosts({ handle: ch.tiktok.handle, debugDir });
          counts.tiktok = { ...counts.tiktok, [key]: saveTikTok(key, posts, data) };
        } catch (err) {
          log.warn(`TikTok posts for ${ch.name}: ${err.message.split("\n")[0]}`);
        }
      }
    }
    // Post times for already-posted clips with an empty "Scheduled for" (from before the pipeline, or added by a pull):
    // YouTube's public watch page carries the exact publish time, no sign-in needed.
    if (plan.channels.includes(clipsId())) {
      const noTime = (data.clips || []).filter((c) => c.videoId && !c.scheduledFor).map((c) => c.videoId);
      if (noTime.length) {
        log.step(`Looking up post times for ${noTime.length} clip${noTime.length > 1 ? "s" : ""}`);
        const times = await postTimes(noTime);
        if (Object.keys(times).length) {
          const tf = path.join(statsDir(), "times.json");
          fs.writeFileSync(tf, JSON.stringify(times));
          counts.timesFilled = (await stats("times", ...trackerArgs(), tf).catch((err) => (log.warn(`Post times: ${err.message}`), {}))).times || 0;
        }
      }
    }
    log.step("Writing the trackers");
    const ttViews = tiktokByYoutube(clipsId());
    if (Object.keys(ttViews).length) fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), _tiktok: ttViews }, null, 2));
    pullState.result = { ...(await stats("write", ...trackerArgs(), file)), notInLog: extras.length };
    // Also clears first-word guesses that older pulls wrote.
    pullState.result.creatorsFixed = (await fixLogCreators().catch((err) => (log.warn(`Creator fix: ${err.message}`), {}))).creators || 0;
  })
    .catch((err) => (pullState.error = err.message.replace(/^.*?exited \d+: /s, "").trim()))
    .finally(() => {
      Object.assign(pullState, { running: false, current: null, finishedAt: new Date().toISOString() });
      writeJsonAtomic(path.join(statsDir(), "last-pull.json"), { ...pullState }, 2);
      if (!pullState.error && !pullState.stopped && kind !== "advanced") writeJsonAtomic(path.join(statsDir(), `pull-time-${kind}.json`), { ms: Date.parse(pullState.finishedAt) - Date.parse(pullState.startedAt) }, 0);
      try {
        learnRates(learned);
      } catch (err) {
        console.warn(`Couldn't save pull timings: ${err.message}`);
      }
      // Per page: how long it took and whether it had any numbers, for spotting a page that never loads.
      const tabStats = Object.fromEntries(
        STAT_TABS.map((t) => [t, learned.timings.filter((x) => x.tab === t)])
          .filter(([, a]) => a.length)
          .map(([t, a]) => [
            t,
            { opened: a.length, typicalMs: median(a.map((x) => x.ms)), empty: a.filter((x) => !x.fields.length).length },
          ]),
      );
      const { found, ...rest } = counts;
      log.end({
        error: pullState.error,
        ...rest,
        read: found ? Object.keys(found).length : 0,
        missing: pullState.missing.length,
        missingVideos: pullState.missing.slice(0, 40),
        stopped: pullState.stopped || undefined,
        pages: tabStats,
        result: pullState.result,
      });
    });
  return pullStatus();
}
