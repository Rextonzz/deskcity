// Who each a channel clip is of. Pull stats used to guess the creator from a title's first word, which gave entries
// like "She" or "POV" for Shorts that were on the channel but not in the log. Now a creator is only filled in when it's
// on the approved roster (from a log row, a roster name in the title, or a frame check); anything else is "unverified".
// The frame check looks at YouTube's own still frames of the Short with the identification markers from the
// a channel reference file (images only, per its rules). High-confidence answers are used; the rest wait for the owner.
import { ownerId, chOfLayout } from "../hub/settings.js";
import { askJSON, obj, arr, str, oneOf } from "./claude.js";
import { channelRules, resolvePath, writeJsonAtomic, readJson } from "./util.js";
import { startRun } from "./runlog.js";

const FILE = () => resolvePath("data/stats/creators.json");

// The approved roster (References/session_context_1.md, 3.1), with the short names used in titles and the log.
// data/stats/creators.json "roster" adds to it.
const ROSTER = {
  Squeex: [],
  Ludwig: ["luddy"],
  Fuslie: [],
  Valkyrae: ["rae"],
  Foolish: [],
  T10Nat: [],
  Atrioc: ["big a"],
  DougDoug: [],
  Northernlion: ["nl"],
  Sodapoppin: ["soda"],
  Chiblee: [],
  KKatamina: ["miyoung"],
  xQc: [],
  FrostPrime: [],
  WardrobeWinter: ["wardrobe"],
  "Joe Bartolozzi": ["joe bart", "joe"],
  "Michael Reeves": ["reeves"],
  ImperialHal: [],
  Jynxzi: [],
  OhnePixel: [],
  Tyler1: [],
  Falco: [],
  Slime: [],
  Calvin: [],
  Joshman: [],
  FSLR: [],
  "The Yard": [],
};
// Short aliases only count as the first word of a title ("Rae" is too common elsewhere).
const FIRST_ONLY = new Set(["rae", "nl", "soda", "joe", "big a", "luddy"]);

export const creatorData = () => readJson(FILE(), { roster: {}, verified: {} });
function saveCreatorData(d) {
  writeJsonAtomic(FILE(), d, 2);
}
export function roster() {
  return { ...ROSTER, ...creatorData().roster };
}
const norm = (s) => String(s ?? "").toLowerCase().replace(/[’']s\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// A roster name for any spelling ("Joe" -> "Joe Bartolozzi", "northernlion" -> "Northernlion"), or null.
export function canonical(name) {
  const n = norm(name);
  if (!n) return null;
  for (const [k, aliases] of Object.entries(roster())) if (norm(k) === n || aliases.some((a) => norm(a) === n)) return k;
  return null;
}

// Roster creator named in a title: titles open with the creator ("[Creator] + POWER word"), so the earliest full name
// wins, and short aliases only count at the very start.
export function fromTitle(title) {
  const t = ` ${norm(title)} `;
  let best = null;
  for (const [k, aliases] of Object.entries(roster()))
    for (const a of [k, ...aliases]) {
      const w = norm(a);
      if (!w) continue;
      const at = t.indexOf(` ${w} `);
      if (at < 0 || (FIRST_ONLY.has(a.toLowerCase()) && at !== 0)) continue;
      if (!best || at < best.at) best = { at, name: k };
    }
  return best?.name || null;
}

// Fills in creator / creatorSource on every clip: "log" (roster name in the log), "title", "frames", "owner", or
// "unverified" with creator "".
export function resolveCreators(clips) {
  const v = creatorData().verified;
  for (const c of clips) {
    const saved = v[c.videoId];
    const fromLog = canonical(c.creator);
    if (saved?.creator && (saved.by === ownerId() || saved.confidence === "high"))
      Object.assign(c, { creator: saved.creator, creatorSource: saved.by === ownerId() ? ownerId() : "frames" });
    else if (fromLog) Object.assign(c, { creator: fromLog, creatorSource: "log" });
    else if (fromTitle(c.title)) Object.assign(c, { creator: fromTitle(c.title), creatorSource: "title" });
    else
      Object.assign(c, {
        creatorLogged: c.creator || "",
        creator: "",
        creatorSource: "unverified",
        creatorSuggestion:
          saved?.creator && saved.creator !== "unknown"
            ? { name: saved.creator, confidence: saved.confidence, reasoning: saved.reasoning }
            : saved
              ? { name: "unknown", reasoning: saved.reasoning }
              : null,
      });
  }
  return clips;
}

// The identification sections of the reference file, so the check follows the same rules as the pipeline.
function markers() {
  const text = channelRules(chOfLayout("clips").id, "ifMissing");
  const section = (h) => {
    const i = text.indexOf(h);
    if (i < 0) return "";
    const j = text.slice(i + h.length).search(/\n#{2,3} /);
    return text.slice(i, j < 0 ? undefined : i + h.length + j);
  };
  return [section("### 1.8 Identification markers"), section("### 3.1 Approved roster")].filter(Boolean).join("\n\n");
}

// YouTube's automatic stills at about 25%, 50% and 75% of the video, plus the cover image.
async function stills(videoId) {
  const out = [];
  for (const n of ["hq1", "hq2", "hq3", "hqdefault"]) {
    try {
      const res = await fetch(`https://i.ytimg.com/vi/${videoId}/${n}.jpg`, { signal: AbortSignal.timeout(15000) });
      if (res.ok) out.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: Buffer.from(await res.arrayBuffer()).toString("base64") } });
    } catch {}
  }
  return out;
}

export const checkState = { running: false, done: 0, total: 0, startedAt: null, result: null, error: null };

// Frame-checks up to `limit` unverified clips (oldest unchecked first). Clips already checked are skipped.
export function startCreatorCheck(clips, { limit = 40 } = {}) {
  if (checkState.running) return checkState;
  const d = creatorData();
  const todo = resolveCreators(clips.map((c) => ({ ...c }))).filter((c) => c.creatorSource === "unverified" && c.videoId && !d.verified[c.videoId]).slice(0, limit);
  Object.assign(checkState, { running: true, done: 0, total: todo.length, startedAt: new Date().toISOString(), result: null, error: null });
  const log = startRun("creator check", { clips: todo.length });
  (async () => {
    const rules = markers();
    const names = Object.keys(roster());
    const counts = { high: 0, medium: 0, low: 0, unknown: 0, noImages: 0 };
    for (const c of todo) {
      const imgs = await stills(c.videoId);
      if (!imgs.length) {
        counts.noImages++;
        log.warn(`${c.videoId}: no still frames from YouTube`);
        checkState.done++;
        continue;
      }
      try {
        const r = await askJSON({
          name: "creator_check",
          effort: "medium",
          system: `You identify which streamer a ${chOfLayout("clips").name || "clip channel"} Short is a clip of, from still frames only. Never use on-screen text, captions, titles, usernames or overlays: the channel's rules say identify from images only.
Answer with a name from this approved roster, or "unknown" if no roster creator is clearly shown: ${names.join(", ")}.
"creator" is the streamer whose stream it is (the main webcam). confidence "high" only when the markers below clearly match in at least one frame; "medium" when they fit but a deciding marker isn't visible; "low" for a guess.

${rules}`,
          content: [...imgs, { type: "text", text: "These are YouTube's automatic stills from one Short (about 25%, 50% and 75% in) and its cover image." }],
          schema: obj({ creator: str, confidence: oneOf("high", "medium", "low"), on_screen: arr(str), reasoning: str }),
        });
        const name = canonical(r.creator) || "unknown";
        const conf = name === "unknown" ? "low" : r.confidence;
        counts[name === "unknown" ? "unknown" : conf]++;
        const cur = creatorData();
        cur.verified[c.videoId] = { creator: name, confidence: conf, reasoning: r.reasoning, onScreen: r.on_screen, by: "frames", at: new Date().toISOString(), title: c.title };
        saveCreatorData(cur);
      } catch (err) {
        log.warn(`${c.videoId}: ${err.message.split("\n")[0]}`);
      }
      checkState.done++;
    }
    checkState.result = counts;
    // Puts the high-confidence answers into the log rows Pull stats added.
    const { fixLogCreators } = await import("./stats.js");
    counts.logRowsFixed = (await fixLogCreators().catch((err) => (log.warn(`Log update: ${err.message}`), {}))).creators || 0;
    log.end(counts);
  })()
    .catch((err) => {
      checkState.error = err.message;
      log.end({ error: err.message });
    })
    .finally(() => (checkState.running = false));
  return checkState;
}

// the owner's own answer for a clip ("unknown" to mark it as not a roster creator).
export function confirmCreator(videoId, name) {
  const d = creatorData();
  const c = name === "unknown" ? "unknown" : canonical(name);
  if (!c) throw new Error("Not on the roster");
  d.verified[videoId] = { ...d.verified[videoId], creator: c, by: ownerId(), at: new Date().toISOString() };
  saveCreatorData(d);
  return d.verified[videoId];
}

// Creators to write into the upload log: only rows Pull stats added (its note says so) get changed, so the owner's
// own entries are never overwritten.
export function logFixes(clips) {
  const out = {};
  for (const c of resolveCreators(clips.map((x) => ({ ...x })))) if (c.videoId) out[c.videoId] = c.creatorSource === "unverified" ? "" : c.creator;
  return out;
}

// A roster creator named anywhere in free text, allowing small typos ("Lugwig says the greece line" -> "Ludwig").
export function guessCreator(text) {
  const exact = canonical(text);
  if (exact) return exact;
  const words = norm(text).split(" ").filter(Boolean);
  const dist = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  let best = null;
  for (const [k, aliases] of Object.entries(roster())) {
    for (const name of [k, ...aliases].map(norm)) {
      const parts = name.split(" ").length;
      for (let i = 0; i + parts <= words.length; i++) {
        const span = words.slice(i, i + parts).join(" ");
        const d = dist(span, name);
        const allowed = name.length >= 8 ? 2 : name.length >= 5 ? 1 : 0;
        if (d <= allowed && (!best || d < best.d)) best = { k, d };
      }
    }
  }
  return best?.k || null;
}
