// "What's working" notes from the trackers, added to the prompts that write titles and descriptions, so each new
// upload learns from how earlier ones did. Never blocks a job: any problem just means no notes this time.
import { exportStats } from "./stats.js";
import { lastInsights } from "./insights.js";
import { listJobs } from "./jobs.js";
import { videoStats, tiktokStats } from "./stats.js";
import { chOfLayout } from "../hub/settings.js";
const isLayout = (ch, layout) => !!ch && ch === chOfLayout(layout).id; // is this channel the one with that page layout

const cache = {};
const SETTLE_DAYS = 3; // views on newer uploads are still climbing, so they don't count yet
const settled = (date) => date && Date.now() - Date.parse(`${date}T12:00:00`) > SETTLE_DAYS * 864e5;
const avg = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null);
const pct = (x) => (x == null ? null : Math.round(x * 100));
// The full numbers from the last stats pull (stayed to watch, likes, comments...), by video ID. A channel upload
// log only keeps views, so this is where its retention and engagement live.
const withStats = (rows) => {
  const all = videoStats();
  return rows.map((r) => ({ ...all[r.videoId], ...r, stayed: r.stayed ?? all[r.videoId]?.stayed ?? null, comments: r.comments ?? all[r.videoId]?.comments ?? null, likes: r.likes ?? all[r.videoId]?.likes ?? null }));
};
function groupPct(rows, key, min = 2) {
  const m = new Map();
  for (const r of rows) {
    const k = key(r);
    if (k && r.stayed != null) m.set(k, [...(m.get(k) || []), r.stayed]);
  }
  return [...m].filter(([, v]) => v.length >= min).map(([k, v]) => ({ k, n: v.length, a: pct(v.reduce((s, x) => s + x, 0) / v.length) }));
}
// Pinned comments (from the pipeline's own jobs) next to how many comments each video got, so the next pinned
// question leans toward the kind that got people talking.
function pinnedNotes(channel, stats) {
  const rows = listJobs()
    .filter((j) => j.channel === channel && j.data.videoId && j.data.meta_out?.pinned_comment)
    .map((j) => ({ text: j.data.meta_out.pinned_comment, comments: stats[j.data.videoId]?.comments, views: stats[j.data.videoId]?.views }))
    .filter((r) => r.comments != null && r.views > 0);
  if (rows.length < 4) return "";
  rows.sort((a, b) => b.comments / b.views - a.comments / a.views);
  const line = (r) => `- "${r.text}" (${r.comments} comments on ${r.views.toLocaleString()} views)`;
  return `\nPinned comments that got the most replies per view:\n${rows.slice(0, 3).map(line).join("\n")}\nAnd the fewest:\n${rows.slice(-2).map(line).join("\n")}`;
}
const clean = (t) => String(t || "").replace(/\s*#shorts?\b/gi, "").trim();

function groupAvg(rows, key, min = 2) {
  const m = new Map();
  for (const r of rows) {
    const k = key(r);
    if (k) m.set(k, [...(m.get(k) || []), r.views]);
  }
  return [...m].filter(([, v]) => v.length >= min).map(([k, v]) => ({ k, n: v.length, a: avg(v) })).sort((x, y) => y.a - x.a);
}

// Where views come from (Studio's "Top traffic sources", read since 2026-10-19): the average share per source, and
// how the best quarter of videos differ from the rest, e.g. more from YouTube search means titles that match searches.
function trafficNote(rows) {
  const t = rows.filter((r) => r.traffic && typeof r.traffic === "object");
  if (t.length < 5) return "";
  const share = (list) => {
    const sum = {};
    for (const r of list) for (const [k, v] of Object.entries(r.traffic)) sum[k] = (sum[k] || 0) + v;
    return Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, Math.round((v / list.length) * 100)]));
  };
  const all = share(t);
  const sorted = [...t].sort((a, b) => b.views - a.views);
  const top = share(sorted.slice(0, Math.max(2, Math.floor(t.length / 4)))), rest = share(sorted.slice(Math.max(2, Math.floor(t.length / 4))));
  const names = Object.keys(all).sort((a, b) => all[b] - all[a]).slice(0, 5);
  return `Where views come from (${t.length} videos): ${names.map((k) => `${k} ${all[k]}%`).join(", ")}. Best quarter vs the rest: ${names.map((k) => `${k} ${top[k] || 0}% vs ${rest[k] || 0}%`).join(", ")}.`;
}

// TikTok beside YouTube (the owner 2026-10-19: learn from both platforms). Only posts up 3+ days, matched to their clip.
function tiktokNote(rows) {
  const byYt = Object.fromEntries(rows.map((r) => [r.videoId, r]));
  const posts = Object.values(tiktokStats().channels?.[chOfLayout("clips").id]?.posts || {}).filter((p) => p.youtubeId && byYt[p.youtubeId] && p.views != null && /^\d{4}-/.test(p.date || "") && Date.now() - Date.parse(p.date) > SETTLE_DAYS * 864e5);
  if (posts.length < 5) return "";
  const rel = posts.map((p) => ({ ...byYt[p.youtubeId], tt: p.views, r: p.views / Math.max(1, byYt[p.youtubeId].views) })).sort((a, b) => b.r - a.r);
  const med = [...rel].sort((a, b) => a.r - b.r)[Math.floor(rel.length / 2)].r;
  const line = (c) => `- "${c.title}" (${c.creator}, TikTok ${c.tt.toLocaleString()} vs YouTube ${c.views.toLocaleString()})`;
  const out = [
    `TikTok: ${posts.length} clips posted there too; typical TikTok views ${avg(rel.map((c) => c.tt)).toLocaleString()}, about ${med.toFixed(2)}x their YouTube views (median). TikTok is a different audience: test these against YouTube's numbers, never copy them.`,
    "Did best on TikTok compared with YouTube:",
    ...rel.slice(0, 3).map(line),
    "Did worst on TikTok compared with YouTube:",
    ...rel.slice(-3).reverse().map(line),
  ];
  const creators = groupAvg(rel.filter((c) => c.creator).map((c) => ({ ...c, views: c.tt })), (c) => c.creator);
  if (creators.length > 1) out.push(`Average TikTok views by creator (2+ clips): ${creators.map((g) => `${g.k} ${g.a.toLocaleString()} (${g.n})`).join(", ")}.`);
  return out.join("\n");
}

// Which videos brought in subscribers (per 1,000 views), from the last pull: the hook a viewer subscribes after.
function subsNote(rows, label) {
  const all = videoStats();
  const t = rows.map((r) => ({ ...r, subs: all[r.videoId]?.subs ?? r.subs })).filter((r) => r.subs != null && r.views >= 200);
  if (t.length < 5) return "";
  const per = (r) => (r.subs / r.views) * 1000;
  const sorted = [...t].sort((a, b) => per(b) - per(a));
  const typical = per(sorted[Math.floor(sorted.length / 2)]);
  return `Subscribers per 1,000 views (${t.length} videos): typical ${typical.toFixed(1)}. Best for subscribers: ${sorted.slice(0, 3).map((r) => `"${clean(label(r))}" ${per(r).toFixed(1)}`).join("; ")}.`;
}

function clipNotes(clips) {
  const rows = withStats(clips.filter((c) => c.views > 0 && settled(c.date))).map((c) => ({ ...c, title: clean(c.title), creator: c.creator || "" }));
  if (rows.length < 5) return "";
  const byViews = [...rows].sort((a, b) => b.views - a.views);
  const line = (c) => `- "${c.title}" (${c.creator}, ${c.views.toLocaleString()} views${c.length ? `, ${c.length}s` : ""}${c.stayed != null ? `, ${pct(c.stayed)}% stayed` : ""})`;
  const out = [`Typical clip: ${avg(rows.map((c) => c.views)).toLocaleString()} views across ${rows.length} clips.`, "Best titles so far:", ...byViews.slice(0, 5).map(line), "Weakest titles so far:", ...byViews.slice(-5).reverse().map(line)];
  const creators = groupAvg(rows.filter((c) => c.creator), (c) => c.creator); // unverified creators left out
  if (creators.length > 1) out.push(`Average views by creator (2+ clips): ${creators.map((g) => `${g.k} ${g.a.toLocaleString()} (${g.n})`).join(", ")}.`);
  const lens = groupAvg(rows.filter((c) => c.length), (c) => (c.length < 20 ? "under 20s" : c.length < 35 ? "20-35s" : c.length < 50 ? "35-50s" : "50s+"));
  if (lens.length > 1) out.push(`Average views by length: ${lens.map((g) => `${g.k} ${g.a.toLocaleString()} (${g.n})`).join(", ")}.`);
  const kept = groupPct(rows, (c) => c.creator);
  if (kept.length > 1) out.push(`Share of viewers who stayed to watch, by creator: ${kept.map((g) => `${g.k} ${g.a}% (${g.n})`).join(", ")}.`);
  const traffic = trafficNote(rows);
  if (traffic) out.push(traffic);
  const tt = tiktokNote(rows);
  if (tt) out.push(tt);
  const subs = subsNote(rows, (r) => r.title);
  if (subs) out.push(subs);
  return out.join("\n");
}

function packNotes(packs) {
  const titles = Object.fromEntries(listJobs().filter((j) => isLayout(j.channel, "packs") && j.data.videoId && j.data.meta_out?.title).map((j) => [j.data.videoId, j.data.meta_out.title]));
  const rows = packs.flatMap((p) => p.videos.filter((v) => v.views > 0 && settled(v.uploadDate)).map((v) => ({ ...v, set: p.set, product: p.product, ep: p.episode, value: p.value, net: p.net, title: titles[v.videoId] })));
  if (rows.length < 5) return "";
  const out = [`Typical episode: ${avg(rows.map((r) => r.views)).toLocaleString()} views across ${rows.length} videos.`];
  const titled = rows.filter((r) => r.title).sort((a, b) => b.views - a.views);
  if (titled.length >= 4) {
    const line = (r) => `- "${clean(r.title)}" (Ep ${r.ep}, ${r.views.toLocaleString()} views${r.stayed != null ? `, ${Math.round(r.stayed * 100)}% stayed` : ""})`;
    out.push("Best titles so far:", ...titled.slice(0, 3).map(line), "Weakest titles so far:", ...titled.slice(-3).reverse().map(line));
  }
  const sets = groupAvg(rows, (r) => r.set, 1);
  if (sets.length > 1) out.push(`Average views by set: ${sets.map((g) => `${g.k} ${g.a.toLocaleString()} (${g.n})`).join(", ")}.`);
  const products = groupAvg(rows, (r) => r.product, 1);
  if (products.length > 1) out.push(`Average views by product: ${products.map((g) => `${g.k} ${g.a.toLocaleString()} (${g.n})`).join(", ")}.`);
  // Does a big pull get more views? Card value and profit vs views (to-do #18).
  const byNet = groupAvg(rows.filter((r) => r.net != null), (r) => (r.net >= 0 ? "made money" : "lost money"), 2);
  if (byNet.length > 1) out.push(`Average views when the pack ${byNet.map((g) => `${g.k} ${g.a.toLocaleString()} (${g.n})`).join(", ")}.`);
  const byValue = groupAvg(rows.filter((r) => r.value != null), (r) => (r.value < 5 ? "cards under $5" : r.value < 15 ? "$5-15" : r.value < 40 ? "$15-40" : "$40+"), 2);
  if (byValue.length > 1) out.push(`Average views by total card value: ${byValue.map((g) => `${g.k} ${g.a.toLocaleString()} (${g.n})`).join(", ")}.`);
  const subs = subsNote(rows, (r) => r.title || `Ep ${r.ep} ${r.set}`);
  if (subs) out.push(subs);
  return out.join("\n");
}

// Every video's numbers by ID: the trackers first, then the last pull's full numbers on top of anything missing.
function statsById(data) {
  const out = { ...videoStats() };
  for (const c of data.clips || []) if (c.videoId) out[c.videoId] = { ...out[c.videoId], views: c.views ?? out[c.videoId]?.views };
  for (const p of data.packs || []) for (const v of p.videos || []) if (v.videoId) out[v.videoId] = { ...out[v.videoId], ...Object.fromEntries(Object.entries(v).filter(([, x]) => x != null)) };
  return out;
}

// Returns a prompt section, or "" when there's not enough data yet.
export async function learnings(channel) {
  const hit = cache[channel];
  if (hit && Date.now() - hit.at < 10 * 60000) return hit.text;
  let text = "";
  try {
    const data = await exportStats();
    const notes = (isLayout(channel, "packs") ? packNotes(data.packs || []) : clipNotes(data.clips || [])) + pinnedNotes(channel, statsById(data));
    const tips = lastInsights(channel)?.suggestions?.map((s) => `- ${s.title}: ${s.detail}`) || [];
    if (notes || tips.length)
      text = `\n\nWhat's working on this channel so far (from the trackers; use it to pick hooks and wording, but the channel rules above always win, and small samples are only hints):\n${notes}${tips.length ? `\nLatest suggestions from the stats page:\n${tips.join("\n")}` : ""}`;
  } catch (err) {
    console.warn(`Couldn't build channel learnings: ${err.message}`);
  }
  cache[channel] = { at: Date.now(), text };
  return text;
}

// For the step that picks where a clip starts and ends: how views have gone by clip length and creator, so the cut
// leans toward what has worked. Same rules as above: never blocks, rules win, small samples are hints.
export async function cutLearnings(channel) {
  const key = `cut:${channel}`;
  const hit = cache[key];
  if (hit && Date.now() - hit.at < 10 * 60000) return hit.text;
  let text = "";
  try {
    const data = await exportStats();
    if (isLayout(channel, "clips")) {
      const rows = withStats((data.clips || []).filter((c) => c.views > 0 && c.length && settled(c.date)));
      if (rows.length >= 5) {
        const bucket = (c) => (c.length < 15 ? "under 15s" : c.length < 20 ? "15-20s" : c.length < 25 ? "20-25s" : c.length < 35 ? "25-35s" : "35s+");
        const lens = groupAvg(rows, bucket);
        const kept = groupPct(rows, bucket);
        const top = [...rows].sort((a, b) => b.views - a.views).slice(0, 5);
        text = `\n\nHow clip length has done on this channel (from the upload log, ${rows.length} clips; a hint for choosing hook_start and natural_end, never a reason to cut a sentence off or break a rule):\nAverage views by length: ${lens.map((g) => `${g.k} ${g.a.toLocaleString()} (${g.n})`).join(", ")}.${kept.length > 1 ? `\nShare who stayed to watch, by length: ${kept.map((g) => `${g.k} ${g.a}% (${g.n})`).join(", ")}.` : ""}\nTop clips: ${top.map((c) => `"${clean(c.title)}" ${c.length}s ${c.views.toLocaleString()} views${c.stayed != null ? ` ${pct(c.stayed)}% stayed` : ""}`).join("; ")}.`;
      }
    }
  } catch (err) {
    console.warn(`Couldn't build cut learnings: ${err.message}`);
  }
  cache[key] = { at: Date.now(), text };
  return text;
}

// For the step that picks moments out of a long recording: which kinds of moments did best and worst, so it scores
// new ones the way viewers did. Hints only; the rules win.
export async function findLearnings(channel) {
  const key = `find:${channel}`;
  const hit = cache[key];
  if (hit && Date.now() - hit.at < 10 * 60000) return hit.text;
  let text = "";
  try {
    const data = await exportStats();
    const rows = withStats((data.clips || []).filter((c) => c.views > 0 && settled(c.date)));
    if (isLayout(channel, "clips") && rows.length >= 8) {
      const by = [...rows].sort((a, b) => b.views - a.views);
      const line = (c) => `"${clean(c.title)}" (${c.creator || "?"}, ${c.views.toLocaleString()} views${c.stayed != null ? `, ${pct(c.stayed)}% stayed` : ""})`;
      const creators = groupAvg(rows.filter((c) => c.creator), (c) => c.creator);
      text = `\n\nHow past clips did on this channel (${rows.length} clips; use it to score moments the way viewers have, never to break a rule):\nBest: ${by.slice(0, 6).map(line).join("; ")}.\nWeakest: ${by.slice(-4).map(line).join("; ")}.${creators.length > 1 ? `\nAverage views by creator: ${creators.map((g) => `${g.k} ${g.a.toLocaleString()} (${g.n})`).join(", ")}.` : ""}`;
    }
  } catch (err) {
    console.warn(`Couldn't build clip-finding learnings: ${err.message}`);
  }
  cache[key] = { at: Date.now(), text };
  return text;
}

// Average views by the day (and, where the log has it, the time) a video went out. Shown with the posting schedule
// on Admin and given to the rules review, so the schedule can follow the numbers.
export async function postingStats(channel) {
  const data = await exportStats();
  const dayName = (d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${d}T12:00:00`).getDay()];
  let rows = [];
  if (isLayout(channel, "clips")) {
    rows = (data.clips || []).filter((c) => c.views > 0 && settled(c.date)).map((c) => {
      const t = String(c.scheduledFor || "").match(/(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/);
      // The app writes Studio's own label ("Mon Oct 19, 4:00 PM"), so read that too (code review 2026-10-22).
      const p = !t && String(c.scheduledFor || "").match(/(\d{1,2}):(\d{2})\s*([AP])M/i);
      const h24 = p ? (Number(p[1]) % 12) + (/p/i.test(p[3]) ? 12 : 0) : null;
      return { views: c.views, day: dayName(t ? t[1] : c.date), hour: t ? `${t[2].padStart(2, "0")}:${t[3]}` : p ? `${String(h24).padStart(2, "0")}:${p[2]}` : null };
    });
  } else {
    rows = (data.packs || []).flatMap((p) => p.videos.filter((v) => v.views > 0 && settled(v.uploadDate)).map((v) => ({ views: v.views, day: dayName(v.uploadDate), hour: null })));
  }
  return {
    videos: rows.length,
    byDay: groupAvg(rows, (r) => r.day, 1).map((g) => ({ day: g.k, videos: g.n, avgViews: g.a })),
    byTime: groupAvg(rows.filter((r) => r.hour), (r) => r.hour, 1).map((g) => ({ time: g.k, videos: g.n, avgViews: g.a })),
  };
}
