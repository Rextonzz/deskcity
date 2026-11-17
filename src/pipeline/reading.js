// Anime and manga tracker (to-do #19): what the owner is watching and reading, where, how far he is, and what's new.
// Anime comes from AniList (free, no key: episodes out and when the next one airs, which covers Crunchyroll shows).
// Manga, manhwa and webtoons come from MangaUpdates (free, no key: latest chapter across every release group, so
// Asura Scans, Demon Scans and Webtoon series are covered without reading those sites). Kindle volumes and anything
// neither knows can be added by hand. Read-only: nothing here signs in anywhere. List kept in data/reading.json.
import { readJson, writeJsonAtomic, resolvePath, sleep, newId, agentName } from "./util.js";
import { startRun, onceJob, onceState } from "./runlog.js";

const FILE = () => resolvePath("data/reading.json");
export const WHERE = ["Crunchyroll", "Asura Scans", "Demon Scans", "Webtoon", "Kindle", "Other"];
export const STATUSES = ["watching", "reading", "planning", "paused", "done", "dropped"];
const ANILIST = "https://graphql.anilist.co";
const MU = "https://api.mangaupdates.com/v1";
// Jikan (MyAnimeList, free, no key) steps in for anime when AniList is down or turns requests away.
const JIKAN = "https://api.jikan.moe/v4";

function load() { return readJson(FILE(), { items: [], checkedAt: null }); }
function save(d) { writeJsonAtomic(FILE(), d, 1); }

async function getJSON(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": `${agentName()}/1.0 (personal tracker)`, ...opts.headers }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) {
    // AniList says why in its answer (for example "temporarily disabled"), so keep that instead of just the number.
    const why = await res.json().then((j) => j?.errors?.[0]?.message || j?.message || j?.error || "", () => "");
    throw new Error(`${new URL(url).host} answered ${res.status}${why ? `: ${String(why).slice(0, 160)}` : ""}`);
  }
  return res.json();
}
const anilist = (query, variables) => getJSON(ANILIST, { method: "POST", body: JSON.stringify({ query, variables }) }).then((j) => {
  if (j.errors?.length) throw new Error(`AniList: ${j.errors[0].message}`);
  return j.data;
});

const ANI_FIELDS = "id idMal title { romaji english } format status episodes chapters coverImage { medium } siteUrl nextAiringEpisode { episode airingAt }";
// What's out now: for an airing show, the episode before the next one; otherwise the full count.
const aniLatest = (m) => (m.nextAiringEpisode ? m.nextAiringEpisode.episode - 1 : m.episodes ?? m.chapters ?? null);
const fromAni = (m, kind) => ({
  kind,
  src: "anilist",
  srcId: m.id,
  malId: m.idMal || null,
  title: m.title?.english || m.title?.romaji || "Untitled",
  image: m.coverImage?.medium || null,
  url: m.siteUrl || null,
  format: m.format || null,
  ended: /FINISHED|CANCELLED/.test(m.status || ""),
  total: kind === "anime" ? m.episodes ?? null : m.chapters ?? null,
  latest: aniLatest(m),
  next: m.nextAiringEpisode ? { n: m.nextAiringEpisode.episode, at: new Date(m.nextAiringEpisode.airingAt * 1000).toISOString() } : null,
});

// Jikan: search and show details carry the total, not how many have aired, so an airing show counts its
// episode list (100 per page, last page only).
const fromMal = (a) => ({
  kind: "anime",
  src: "mal",
  srcId: a.mal_id,
  malId: a.mal_id,
  title: a.title_english || a.title || "Untitled",
  image: a.images?.jpg?.small_image_url || a.images?.jpg?.image_url || null,
  url: a.url || null,
  format: a.type || null,
  ended: /finished/i.test(a.status || ""),
  total: a.episodes ?? null,
  latest: /finished/i.test(a.status || "") ? a.episodes ?? null : null,
  next: null,
});
async function malAired(id) {
  const first = await getJSON(`${JIKAN}/anime/${id}/episodes`);
  const last = first.pagination?.last_visible_page || 1;
  const page = last > 1 ? (await sleep(500), await getJSON(`${JIKAN}/anime/${id}/episodes?page=${last}`)) : first;
  const now = Date.now();
  const aired = (page.data || []).filter((e) => !e.aired || Date.parse(e.aired) <= now).length;
  return (last - 1) * 100 + aired || null;
}
async function malFresh(id) {
  const a = (await getJSON(`${JIKAN}/anime/${id}`)).data;
  const f = fromMal(a);
  if (!f.ended && /airing/i.test(a.status || "")) {
    await sleep(500);
    f.latest = await malAired(id).catch(() => null);
  }
  return f;
}

// MangaUpdates gives chapters as numbers or text ("152", "152.5"); keep the number.
const chNum = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const fromMu = (r) => ({
  kind: "manga",
  src: "mu",
  srcId: r.series_id,
  title: String(r.title || "Untitled").replace(/<[^>]+>/g, ""),
  image: r.image?.url?.thumb || r.image?.url?.original || null,
  url: r.url || null,
  format: r.type || null,
  ended: r.completed === true,
  total: null,
  latest: chNum(r.latest_chapter),
  next: null,
});

export async function searchTitles(q, kind = "anime") {
  q = String(q || "").trim().slice(0, 100);
  if (!q) throw new Error("Type a title to search for.");
  if (kind === "anime") {
    try {
      const d = await anilist(`query($q:String){Page(perPage:8){media(search:$q,type:ANIME,sort:SEARCH_MATCH){${ANI_FIELDS}}}}`, { q });
      return d.Page.media.map((m) => fromAni(m, "anime"));
    } catch (err) {
      console.warn(`AniList search failed, trying MyAnimeList: ${err.message}`);
      const j = await getJSON(`${JIKAN}/anime?q=${encodeURIComponent(q)}&limit=8&sfw=true`).catch((e2) => {
        throw new Error(`Both anime sites failed. ${err.message}. ${e2.message}`);
      });
      return (j.data || []).map(fromMal);
    }
  }
  // Manga: MangaUpdates first (it tracks ongoing chapters), AniList if it's down.
  try {
    const j = await getJSON(`${MU}/series/search`, { method: "POST", body: JSON.stringify({ search: q, perpage: 8 }) });
    // hit_title is the name (often an English alias) the search matched on.
    const found = (j.results || []).map((x) => ({ ...fromMu(x.record || x), hitTitle: x.hit_title ? String(x.hit_title).replace(/<[^>]+>/g, "") : null }));
    if (found.length) return found;
  } catch (err) {
    console.warn(`MangaUpdates search failed, trying AniList: ${err.message}`);
  }
  const d = await anilist(`query($q:String){Page(perPage:8){media(search:$q,type:MANGA,sort:SEARCH_MATCH){${ANI_FIELDS}}}}`, { q });
  return d.Page.media.map((m) => fromAni(m, "manga"));
}

const clean = (v, n = 300) => (v == null ? null : String(v).slice(0, n));
const numOrNull = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

// MangaUpdates' search doesn't always carry the latest chapter, so a new manga gets its numbers straight away.
export async function addTitle(b = {}) {
  const item = addItem(b);
  if (item.src !== "mu" && !(item.src === "mal" && !item.ended)) return item;
  try {
    const fresh = item.src === "mal" ? await malFresh(item.srcId) : fromMu(await getJSON(`${MU}/series/${item.srcId}`));
    const d = load();
    const cur = d.items.find((i) => i.id === item.id);
    if (cur) {
      apply(cur, fresh);
      save(d);
    }
    return cur || item;
  } catch (err) {
    console.warn(`Lookup for ${item.title} failed: ${err.message}`);
    return item;
  }
}

export function addItem(b = {}) {
  const d = load();
  const kind = b.kind === "manga" ? "manga" : "anime";
  if (b.src && d.items.some((i) => i.src === b.src && String(i.srcId) === String(b.srcId))) throw new Error("That one is already on your list.");
  const title = clean(b.title, 200)?.trim();
  if (!title) throw new Error("A title is needed.");
  const item = {
    id: newId(),
    kind,
    src: ["anilist", "mu", "mal"].includes(b.src) ? b.src : null,
    srcId: b.src ? b.srcId : null,
    malId: Number.isInteger(Number(b.malId)) && Number(b.malId) > 0 ? Number(b.malId) : null,
    title,
    image: clean(b.image, 500),
    url: clean(b.url, 500),
    format: clean(b.format, 40),
    where: WHERE.includes(b.where) ? b.where : kind === "anime" ? "Crunchyroll" : "Other",
    link: /^https?:\/\//i.test(b.link || "") ? clean(b.link, 500) : null,
    status: STATUSES.includes(b.status) ? b.status : kind === "anime" ? "watching" : "reading",
    progress: numOrNull(b.progress) ?? 0,
    latest: numOrNull(b.latest),
    latestAt: b.latest != null ? new Date().toISOString() : null,
    total: numOrNull(b.total),
    ended: !!b.ended,
    next: b.next || null,
    addedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  d.items.push(item);
  save(d);
  return item;
}

export function updateItem(id, b = {}) {
  const d = load();
  const item = d.items.find((i) => i.id === id);
  if (!item) throw new Error("Not on the list any more.");
  if (b.progress !== undefined) item.progress = Math.max(0, numOrNull(b.progress) ?? 0);
  if (b.bump) item.progress = (item.progress || 0) + 1;
  if (b.caughtUp && item.latest != null) item.progress = item.latest;
  if (STATUSES.includes(b.status)) item.status = b.status;
  if (WHERE.includes(b.where)) item.where = b.where;
  if (b.link !== undefined) item.link = /^https?:\/\//i.test(b.link || "") ? clean(b.link, 500) : null;
  // Hand-added titles (no source) keep their latest chapter or episode by hand.
  if (!item.src && b.latest !== undefined) {
    const n = numOrNull(b.latest);
    if (n !== item.latest) item.latestAt = new Date().toISOString();
    item.latest = n;
  }
  if (!item.src && b.title) item.title = clean(b.title, 200).trim() || item.title;
  // Finishing a show you've caught up on that has ended moves it to done.
  if (item.ended && item.total && item.progress >= item.total && ["watching", "reading"].includes(item.status)) item.status = "done";
  item.updatedAt = new Date().toISOString();
  save(d);
  return item;
}

export function removeItem(id) {
  const d = load();
  const before = d.items.length;
  d.items = d.items.filter((i) => i.id !== id);
  if (d.items.length === before) throw new Error("Not on the list any more.");
  save(d);
  return { removed: id };
}

const ACTIVE = ["watching", "reading"];
const isNew = (i) => ACTIVE.includes(i.status) && i.latest != null && i.latest > (i.progress || 0);

export function readingList() {
  const d = load();
  const items = d.items.map((i) => ({ ...i, behind: isNew(i) ? Math.round((i.latest - (i.progress || 0)) * 10) / 10 : 0 }));
  return { items, checkedAt: d.checkedAt, newCount: items.filter((i) => i.behind > 0).length, where: WHERE, statuses: STATUSES, checking: onceState("reading").running };
}

// Fresh numbers for every tracked title that has a source (finished and dropped ones are skipped).
export function checkAll({ trigger = "button" } = {}) {
  return onceJob("reading", async () => {
    const run = startRun("reading check", { trigger });
    const d = load();
    const live = d.items.filter((i) => i.src && !["done", "dropped"].includes(i.status));
    let updated = 0, failed = 0;
    try {
      const ani = live.filter((i) => i.src === "anilist");
      if (ani.length) {
        run.step(`AniList: ${ani.length} title(s)`);
        try {
          const data = await anilist(`query($ids:[Int]){Page(perPage:50){media(id_in:$ids){${ANI_FIELDS}}}}`, { ids: ani.map((i) => Number(i.srcId)) });
          for (const m of data.Page.media) for (const i of ani.filter((x) => Number(x.srcId) === m.id)) updated += apply(i, fromAni(m, i.kind));
        } catch (err) {
          run.warn(`AniList: ${err.message}`);
          // AniList down: anime it knows the MyAnimeList number for are checked there instead.
          for (const i of ani) {
            if (i.kind !== "anime" || !i.malId) { failed++; continue; }
            try {
              const f = await malFresh(i.malId);
              updated += apply(i, { ...f, image: null });
            } catch (e2) {
              failed++;
              run.warn(`${i.title}: ${e2.message}`);
            }
            await sleep(1000);
          }
        }
      }
      const mal = live.filter((i) => i.src === "mal");
      if (mal.length) run.step(`MyAnimeList: ${mal.length} title(s)`);
      for (const i of mal) {
        try {
          updated += apply(i, await malFresh(i.srcId));
        } catch (err) {
          failed++;
          run.warn(`${i.title}: ${err.message}`);
        }
        await sleep(1000);
      }
      const mu = live.filter((i) => i.src === "mu");
      if (mu.length) run.step(`MangaUpdates: ${mu.length} title(s)`);
      for (const i of mu) {
        try {
          updated += apply(i, fromMu(await getJSON(`${MU}/series/${i.srcId}`)));
        } catch (err) {
          failed++;
          run.warn(`${i.title}: ${err.message}`);
        }
        await sleep(700);
      }
      // Re-read before saving so a progress tap made during the check isn't lost.
      const now = load();
      for (const i of live) {
        const cur = now.items.find((x) => x.id === i.id);
        if (cur) Object.assign(cur, { latest: i.latest, latestAt: i.latestAt, next: i.next, total: i.total, ended: i.ended, malId: i.malId || cur.malId || null, image: cur.image || i.image });
      }
      now.checkedAt = new Date().toISOString();
      save(now);
      const newCount = now.items.filter(isNew).length;
      run.end({ checked: live.length, updated, failed, newCount, error: failed && failed === live.length ? "Every lookup failed" : null });
      return { checked: live.length, updated, failed, newCount };
    } catch (err) {
      run.end({ checked: live.length, updated, failed, error: err.message });
      throw err;
    }
  });
}

function apply(item, fresh) {
  const was = item.latest;
  if (fresh.latest != null && fresh.latest !== was) {
    item.latest = fresh.latest;
    item.latestAt = new Date().toISOString();
  }
  item.next = fresh.next;
  if (fresh.total != null) item.total = fresh.total;
  item.ended = fresh.ended;
  if (!item.image && fresh.image) item.image = fresh.image;
  if (fresh.malId) item.malId = fresh.malId;
  return item.latest !== was ? 1 : 0;
}

// Once a day at most, from the app's start-up timer.
export async function dailyCheck() {
  const d = load();
  if (!d.items.some((i) => i.src)) return null;
  if (d.checkedAt && Date.now() - Date.parse(d.checkedAt) < 20 * 3600e3) return null;
  return checkAll({ trigger: "auto" });
}
