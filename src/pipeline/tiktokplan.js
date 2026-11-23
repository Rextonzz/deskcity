// TikTok as its own platform (the owner 2026-10-19: "those have different algorithms we need to understand").
// YouTube's title, time and lessons were being reused for TikTok. This keeps TikTok's numbers apart: what time of day,
// caption length and hashtag count did best on TikTok itself, a slot picker that books TikTok at its own best hours
// (never before the YouTube post).
import { pipelineTz, dayIn, hourIn, channelCfg } from "./util.js";
import { listJobs } from "./jobs.js";
import { tiktokStats } from "./stats.js";
import { backlogState } from "./tiktokbacklog.js";
import { chOfLayout } from "../hub/settings.js";

// 3-hour bands inside the posting hours (9:00-22:00 local).
export const BANDS = [[9, 12], [12, 15], [15, 18], [18, 21], [21, 22]];
const bandOf = (h) => BANDS.findIndex(([a, b]) => h >= a && h < b);
const bandName = (i) => `${BANDS[i][0]}:00-${BANDS[i][1]}:00`;
// Before there's data: TikTok's usual evening and lunchtime peaks for a North American audience. Only a starting point.
const PRIOR = [0.6, 0.8, 0.7, 1, 0.7];
const SETTLE = 2 * 864e5; // TikTok views come in fast; posts 2+ days old count
const idOf = (url) => String(url || "").match(/\/video\/(\d+)/)?.[1];

// Every TikTok post of the channel with its numbers and, where the app posted it, the exact time it went out.
export function tiktokPosts(channel) {
  const posts = Object.values(tiktokStats().channels?.[channel]?.posts || {});
  const when = {};
  for (const j of listJobs()) if (j.channel === channel) for (const p of j.data.tiktok?.posted || []) if (idOf(p.url)) when[idOf(p.url)] = p.scheduledFor || p.at;
  try {
    for (const i of Object.values(backlogState().items || {})) if (idOf(i.url)) when[idOf(i.url)] = i.scheduledFor || i.at;
  } catch {}
  return posts.filter((p) => p.views != null).map((p) => {
    const at = when[p.postId] || null;
    const caption = String(p.caption || "");
    return { ...p, at, caption, tags: (caption.match(/#\w+/g) || []).length, words: caption.replace(/#\w+/g, "").trim().split(/\s+/).filter(Boolean).length };
  });
}
const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
function groups(rows, key, min = 2) {
  const g = {};
  for (const r of rows) {
    const k = key(r);
    if (k != null) (g[k] ??= []).push(r.views);
  }
  return Object.entries(g).filter(([, v]) => v.length >= min).map(([k, v]) => ({ k, n: v.length, a: avg(v) }));
}

// How each posting band has done on TikTok: average views relative to the channel's typical TikTok post.
export function bandScores(channel) {
  const rows = tiktokPosts(channel).filter((p) => p.at && Date.now() - Date.parse(p.at) > SETTLE);
  const typical = median(rows.map((r) => r.views)) || 1;
  const tz = pipelineTz();
  const out = BANDS.map((_, i) => {
    const v = rows.filter((r) => bandOf(hourIn(tz, Date.parse(r.at))) === i).map((r) => r.views);
    // Blend toward the prior until a band has 4+ posts, so one lucky post doesn't own a time slot.
    const seen = v.length ? avg(v) / typical : null;
    const w = Math.min(1, v.length / 4);
    return { band: bandName(i), posts: v.length, score: seen == null ? PRIOR[i] : PRIOR[i] * (1 - w) + seen * w };
  });
  return { timed: rows.length, typical, bands: out };
}

// Plain-language notes for the prompts. "" until there are 5 settled posts.
export function tiktokNotes(channel) {
  const rows = tiktokPosts(channel).filter((p) => !p.date || !/^\d{4}-/.test(p.date) || Date.now() - Date.parse(p.date) > SETTLE);
  if (rows.length < 5) return "";
  const sorted = [...rows].sort((a, b) => b.views - a.views);
  const line = (p) => `- "${p.caption.slice(0, 120)}" (${p.views.toLocaleString()} views${p.likes != null ? `, ${p.likes.toLocaleString()} likes` : ""}${p.shares != null ? `, ${p.shares} shares` : ""})`;
  const out = [
    `TikTok on its own (${rows.length} posts, typical ${median(rows.map((r) => r.views)).toLocaleString()} views). TikTok ranks on its own signals (watch-through and rewatches, shares, saves, comments, and the caption's words for TikTok search), so judge TikTok by these numbers, not YouTube's.`,
  ];
  out.push("Best TikTok captions:", ...sorted.slice(0, 3).map(line), "Weakest TikTok captions:", ...sorted.slice(-3).reverse().map(line));
  const len = groups(rows, (r) => (r.words < 6 ? "under 6 words" : r.words < 12 ? "6-11 words" : "12+ words"));
  if (len.length > 1) out.push(`Average TikTok views by caption length: ${len.map((g) => `${g.k} ${g.a.toLocaleString()} (${g.n})`).join(", ")}.`);
  const tags = groups(rows, (r) => (r.tags === 0 ? "no hashtags" : r.tags <= 3 ? "1-3 hashtags" : r.tags <= 5 ? "4-5 hashtags" : "6+ hashtags"));
  if (tags.length > 1) out.push(`Average TikTok views by hashtag count: ${tags.map((g) => `${g.k} ${g.a.toLocaleString()} (${g.n})`).join(", ")}.`);
  const b = bandScores(channel);
  if (b.timed >= 5) out.push(`Average TikTok views by time posted (${pipelineTz()}): ${b.bands.filter((x) => x.posts).map((x) => `${x.band} ${x.posts} posts, ${Math.round(x.score * 100)}% of typical`).join("; ")}.`);
  const shareRate = rows.filter((r) => r.shares != null && r.views >= 200);
  if (shareRate.length >= 5) {
    const s = [...shareRate].sort((a, b) => b.shares / b.views - a.shares / a.views);
    out.push(`Most shared per view: ${s.slice(0, 3).map((p) => `"${p.caption.slice(0, 60)}" ${((p.shares / p.views) * 1000).toFixed(1)} per 1,000`).join("; ")}.`);
  }
  return out.join("\n");
}

// What a TikTok caption should do, unless the channel rules say otherwise.
export const TIKTOK_BASICS = `TikTok captions are for TikTok, not YouTube: put the words people would search on TikTok first (creator name, game, the moment), keep it short and conversational, ask or tease something viewers want to comment on, end with 3-5 hashtags mixing broad and niche (creator, game, community), never #shorts, "subscribe" or YouTube wording.`;

// Every TikTok time already booked or posted for the channel (app jobs + backlog), so slots keep a gap.
function takenTimes(channel, exceptJob) {
  const t = [];
  for (const j of listJobs()) {
    if (j.channel !== channel) continue;
    // A re-made video's old post stays up until the owner deletes it, so the new one keeps its distance (its own job too).
    for (const r of j.data.replaced || []) for (const p of r?.tiktok || []) t.push(Date.parse(p.scheduledFor || p.at));
    if (j.id === exceptJob) continue;
    const tt = j.data.tiktok;
    if (tt?.scheduleAt) t.push(Date.parse(tt.scheduleAt));
    for (const p of tt?.posted || []) t.push(Date.parse(p.scheduledFor || p.at));
  }
  try {
    for (const p of backlogState().posts || []) if (p.channel === channel) t.push(Date.parse(p.at));
  } catch {}
  return t.filter(Number.isFinite);
}

// TikTok's own slot for a new post: from notBefore (the YouTube time, or now) up to 36 h on, 9:00-22:00 local,
// 2 h from any other TikTok post, picking the band TikTok's numbers like best minus a little for waiting.
// One post in four tries a random open band instead, so every time of day keeps getting tested.
export function tiktokSlot({ channel, notBefore, jobId = null, gapHours = 2, rand = Math.random }) {
  const taken = takenTimes(channel, jobId);
  const { bands } = bandScores(channel);
  const start = Math.ceil(notBefore / 9e5) * 9e5;
  const tz = pipelineTz();
  const firstIn = {}; // band key (day + band) -> earliest open slot
  for (let t = start; t < start + 36 * 36e5; t += 9e5) {
    const b = bandOf(hourIn(tz, t));
    if (b < 0 || taken.some((x) => Math.abs(x - t) < gapHours * 36e5)) continue;
    const k = `${dayIn(tz, t)} ${b}`;
    if (!(k in firstIn)) firstIn[k] = { t, b };
  }
  const opts = Object.values(firstIn);
  if (!opts.length) return { at: start, why: "No open TikTok slot in the next 36 hours, so it goes with the YouTube time." };
  if (rand() < 0.25) {
    const o = opts[Math.floor(rand() * opts.length)];
    return { at: o.t, why: `Testing a different time of day (${bandName(o.b)}) so TikTok's best hours keep being measured.` };
  }
  const best = opts.map((o) => ({ ...o, v: bands[o.b].score - ((o.t - start) / 36e5) * 0.015 })).sort((a, b) => b.v - a.v)[0];
  return { at: best.t, why: `${bandName(best.b)} is TikTok's strongest open time right now (${bands[best.b].posts ? `${bands[best.b].posts} posts measured` : "starting estimate, no posts measured yet"}).` };
}

// The credit line on a clip channel's TikTok caption (the owner said yes 2026-11-16): "Clip from <creator>'s stream", after
// the caption text and before the hashtags. Added by code, never by the model. TikTok's caption limit is 2200.
export const TIKTOK_CAPTION_LIMIT = 2200;

// The channel's alwaysTags (pipeline.config.json, e.g. ["mygame", "mygametag"]) as the first hashtags of a caption's closing
// run (the owner 2026-11-21: every YouTube and TikTok clip from the lives carries the game's tag; the AI-written TikTok caption didn't
// get the setting). TikTok lets a post carry at most 5 hashtags (maxTags; tiktok.maxHashtags, 0 = no cap): past the
// fifth they are ignored, so the always-tags go first, then the caption's own tags until the cap, never the other way.
// Hashtags inside the text count toward the cap. The text is trimmed to make room if the caption is over the length limit.
const TRAILING_TAGS = /((?:\s+#[\p{L}\p{N}_]+)+)\s*$/u;
export function withAlwaysTags(caption, always, { limit = TIKTOK_CAPTION_LIMIT, maxTags = 5 } = {}) {
  const text = String(caption ?? "").trim();
  const want = [...new Set((Array.isArray(always) ? always : []).map((x) => String(x).trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "")).filter(Boolean))];
  const m = text.match(TRAILING_TAGS);
  const body = m ? text.slice(0, m.index).trimEnd() : text;
  const own = m ? m[1].trim().split(/\s+/) : [];
  const lower = (t) => t.slice(1).toLowerCase();
  const tags = [...want.map((w) => own.find((t) => lower(t) === w) || `#${w}`), ...own.filter((t) => !want.includes(lower(t)))];
  const inBody = (body.match(/#[\p{L}\p{N}_]+/gu) || []).length;
  const kept = maxTags > 0 ? tags.slice(0, Math.max(want.length, maxTags - inBody)) : tags;
  if (!kept.length) return text;
  const joined = kept.join(" "), sep = m && /^\s*\n/.test(m[0]) ? "\n" : " ";
  const room = limit - joined.length - sep.length;
  return `${body.length > room ? body.slice(0, Math.max(0, room)).trimEnd() : body}${sep}${joined}`.trim();
}
const TAG = /^#[\p{L}\p{N}_]+$/u;
export function withCredit(caption, creator, { limit = TIKTOK_CAPTION_LIMIT } = {}) {
  const text0 = String(caption ?? "").trim();
  const name = String(creator ?? "").replace(/\s+/g, " ").trim();
  if (!name || /^(unknown|\?|n\/a|none)$/i.test(name) || /clip from/i.test(text0)) return text0;
  const credit = `Clip from ${name}${/s$/i.test(name) ? "'" : "'s"} stream`;
  const words = text0.split(/\s+/).filter(Boolean);
  const tags = [];
  while (words.length && TAG.test(words[words.length - 1])) tags.unshift(words.pop());
  const build = () => [words.join(" "), credit, tags.join(" ")].filter(Boolean).join("\n");
  // Over the limit: hashtags go from the end, one at a time; the credit line stays.
  while (build().length > limit && tags.length) tags.pop();
  return build();
}

// The caption the uploader receives for a job: the channel's own caption (or title and tags), the credit line for the
// clips layout unless the channel's tiktok.credit is false, cut to the limit. { caption, warning } where warning is set
// when a credit was wanted but no creator is known. The one place a caption is finalised, so every post goes through it.
export function tiktokCaption(job, cfg) {
  const m = job.data.meta_out || {};
  const tags = (m.description?.match(/#\w+/g) || []).filter((t) => t.toLowerCase() !== "#shorts");
  let caption = (m.tiktok_caption || [m.title?.replace(/#shorts/gi, "").trim(), ...tags].filter(Boolean).join(" ")).slice(0, TIKTOK_CAPTION_LIMIT);
  let warning = null;
  const wants = chOfLayout("clips").id === job.channel && channelCfg(job.channel, cfg)?.tiktok?.credit !== false;
  if (wants) {
    // The same name the YouTube title leads with: the speaker the review settled on (the owner's typed answer wins there).
    const creator = job.data.review?.speaker?.name;
    const out = withCredit(caption, creator);
    if (out === caption.trim() && !/clip from/i.test(caption)) warning = "No creator for the TikTok credit line, so the caption went out without it.";
    caption = out;
  }
  const tcfg = channelCfg(job.channel, cfg);
  caption = withAlwaysTags(caption, tcfg?.alwaysTags, { maxTags: Number(tcfg?.tiktok?.maxHashtags ?? 5) });
  return { caption, warning };
}

// Gambling hold: TikTok removed or made ineligible clips about roulette, a betting app and slots, so gambling-themed
// clips are held back from TikTok (YouTube is not affected). One list, with the reason and
// date here. `weak` words are ordinary words too ("time slot", "all in", "odds", "stake"): they only count together with
// another gambling word (a strong one, or two different weak ones). Channels add words with tiktok.holdWords.
export const GAMBLING_WORDS = [
  { w: "gambling", re: /\bgambl(?:e|es|ed|ing|er|ers)\b/i },
  { w: "gamba", re: /\bgamba\b/i },
  { w: "casino", re: /\bcasinos?\b/i },
  { w: "slot machine", re: /\bslot machines?\b/i },
  { w: "roulette", re: /\broulette\b/i },
  { w: "blackjack", re: /\bblackjack\b/i },
  { w: "poker", re: /\bpoker\b/i },
  { w: "baccarat", re: /\bbaccarat\b/i },
  { w: "craps", re: /\bcraps\b/i },
  { w: "bet", re: /\b(?:bet|bets|betting|bettors?)\b/i },
  { w: "sportsbook", re: /sportsbook|sportsbetting|\bsports betting\b/i },
  { w: "parlay", re: /\bparlays?\b/i },
  { w: "wager", re: /\bwager(?:s|ed|ing)?\b/i },
  { w: "jackpot", re: /\bjackpots?\b/i },
  { w: "max win", re: /\bmax wins?\b/i },
  { w: "everything on black/red", re: /\beverything on (?:black|red)\b/i },
  { w: "stake.com", re: /\bstake\.com\b/i },
  { w: "fanduel", re: /\bfanduel\b/i },
  { w: "draftkings", re: /\bdraftkings\b/i },
  { w: "bet365", re: /\bbet365\b/i },
  { w: "prizepicks", re: /\bprizepicks\b/i },
  { w: "lootbox", re: /\bloot ?box(?:es)?\b/i },
  { w: "case opening", re: /\bcase openings?\b/i },
  { w: "slot", re: /\bslots?\b/i, weak: true },
  { w: "all in", re: /\ball in\b/i, weak: true },
  { w: "odds", re: /\bodds\b/i, weak: true },
  { w: "stake", re: /\bstake\b/i, weak: true },
];
// "bet" as an ordinary verb is not gambling: "bet you couldn't", "you bet", "I bet".
const BET_VERB = /\b(?:bet (?:you|he|she|they|it|we)|you bet|i bet)\b/gi;
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// texts: every text the pipeline has for the clip. -> { hold, why, words }
export function tiktokHold(texts, { extraWords = [] } = {}) {
  const t = (Array.isArray(texts) ? texts : [texts]).filter(Boolean).join("\n").replace(BET_VERB, " ");
  const list = [...GAMBLING_WORDS, ...extraWords.filter((w) => String(w ?? "").trim()).map((w) => ({ w: String(w).trim(), re: new RegExp(`(?<![\\p{L}\\p{N}])${escRe(String(w).trim())}(?![\\p{L}\\p{N}])`, "iu") }))];
  const found = list.filter((x) => x.re.test(t));
  const hold = found.some((x) => !x.weak) || found.length >= 2;
  const words = hold ? found.map((x) => x.w) : [];
  return { hold, why: hold ? `gambling topic: ${words.join(", ")}` : "", words };
}

// Whether a job's clip is held back from TikTok: the clips layout only, off with tiktok.hold false on the channel.
export function tiktokHoldFor(job, cfg) {
  const none = { hold: false, why: "", words: [] };
  const tk = channelCfg(job.channel, cfg)?.tiktok || {};
  if (chOfLayout("clips").id !== job.channel || tk.hold === false) return none;
  const m = job.data.meta_out || {};
  const transcript = (job.data.review?.transcript || []).map((l) => l?.text);
  return tiktokHold([m.title, ...(m.backups || []), m.tiktok_caption, m.description, ...(m.tags || []), ...transcript], { extraWords: Array.isArray(tk.holdWords) ? tk.holdWords : [] });
}
