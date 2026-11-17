// WoW raid summary (to-do #9 step 1, the owner 2026-10-23): each saved character's Warcraft Logs parses, per-boss best
// and median, kills, and recent raid reports, from the Warcraft Logs V2 API for Classic (MoP Classic lives on
// classic.warcraftlogs.com). Keys: WCL_CLIENT_ID and WCL_CLIENT_SECRET in .env (the owner types them himself; a V2 client
// from warcraftlogs.com/api/clients). Read-only. Gear, item level and missing enchants or gems come from the Battle.net
// profile API (BNET_CLIENT_ID and BNET_CLIENT_SECRET, a client from develop.battle.net), Classic namespace.
// New keys get 720 points an hour; one pull of one character costs a few points.
import fs from "node:fs";
import path from "node:path";
import { resolvePath, writeJsonAtomic, readJson, agentName } from "./util.js";
import { withRun } from "./runlog.js";

const SITE = "https://classic.warcraftlogs.com";
const SETTINGS = () => resolvePath("data/wow/settings.json");
const LAST = () => resolvePath("data/wow/last.json");
const keys = () => ({ id: process.env.WCL_CLIENT_ID?.trim(), secret: process.env.WCL_CLIENT_SECRET?.trim() });
const bnetKeys = () => ({ id: process.env.BNET_CLIENT_ID?.trim(), secret: process.env.BNET_CLIENT_SECRET?.trim() });

export const REGIONS = ["us", "eu", "kr", "tw", "cn"];
// Realm name as Warcraft Logs writes it in links: lower case, spaces to dashes, no apostrophes.
const slug = (realm) => String(realm).trim().toLowerCase().replace(/['’]/g, "").replace(/\s+/g, "-");

export function wowSettings() {
  const s = readJson(SETTINGS(), {});
  return { region: REGIONS.includes(s.region) ? s.region : "us", characters: Array.isArray(s.characters) ? s.characters : [] };
}
// Saves the character list: [{ name, realm }], region us/eu/kr/tw/cn.
export function saveWowSettings({ region, characters }) {
  if (!Array.isArray(characters)) throw new Error("Send the characters as a list.");
  const list = characters
    .map((c) => ({ name: String(c?.name || "").trim(), realm: String(c?.realm || "").trim() }))
    .filter((c) => c.name && c.realm)
    .slice(0, 12);
  for (const c of list) if (!/^[\p{L}]{2,12}$/u.test(c.name)) throw new Error(`"${c.name}" doesn't look like a WoW character name (2 to 12 letters).`);
  const s = { region: REGIONS.includes(region) ? region : "us", characters: list };
  fs.mkdirSync(path.dirname(SETTINGS()), { recursive: true });
  writeJsonAtomic(SETTINGS(), s);
  return wowStats();
}

// One sign-in token per site, kept until a minute before it runs out. signIn() answers with the token's JSON.
const tokens = {};
async function cachedToken(site, defaultSeconds, signIn) {
  const t = tokens[site];
  if (t && t.until > Date.now() + 60000) return t.value;
  const j = await signIn();
  tokens[site] = { value: j.access_token, until: Date.now() + (j.expires_in || defaultSeconds) * 1000 };
  return tokens[site].value;
}
const getToken = () => cachedToken("wcl", 3600, async () => {
  const { id, secret } = keys();
  // The same Warcraft Logs account token works on the Classic site; www is the documented address.
  let res;
  for (const host of [SITE, "https://www.warcraftlogs.com"]) {
    res = await fetch(`${host}/oauth/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(20000),
    }).catch((err) => ({ ok: false, status: 0, err }));
    if (res.ok) break;
  }
  if (res.status === 401 || res.status === 400) throw new Error("Warcraft Logs turned the keys down. Check WCL_CLIENT_ID and WCL_CLIENT_SECRET in .env (a V2 client from warcraftlogs.com/api/clients).");
  if (!res.ok) throw new Error(`Warcraft Logs sign-in answered ${res.status || res.err?.message}`);
  return res.json();
});

async function gql(query, variables) {
  const res = await fetch(`${SITE}/api/v2/client`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json", "User-Agent": `${agentName()}/1.0` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 429) throw new Error("Warcraft Logs says the hourly limit is used up. Try again in an hour.");
  if (res.status === 401) {
    delete tokens.wcl;
    throw new Error("Warcraft Logs turned the keys down. Check WCL_CLIENT_ID and WCL_CLIENT_SECRET in .env.");
  }
  if (!res.ok) throw new Error(`Warcraft Logs answered ${res.status}`);
  const j = await res.json();
  if (j.errors?.length && !j.data) throw new Error(`Warcraft Logs: ${j.errors[0].message}`);
  return j.data;
}

// ---- Battle.net (gear) ----
const bnetToken = (region) => cachedToken("bnet", 86400, async () => {
  const { id, secret } = bnetKeys();
  const host = region === "cn" ? "https://oauth.battlenet.com.cn" : "https://oauth.battle.net";
  const res = await fetch(`${host}/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 401 || res.status === 400) throw new Error("Battle.net turned the keys down. Check BNET_CLIENT_ID and BNET_CLIENT_SECRET in .env (a client from develop.battle.net).");
  if (!res.ok) throw new Error(`Battle.net sign-in answered ${res.status}`);
  return res.json();
});
// MoP Classic (progression Classic) characters live in the "profile-classic" namespace; null when Battle.net has no such character.
async function bnet(region, apiPath, namespace) {
  const host = region === "cn" ? "https://gateway.battlenet.com.cn" : `https://${region}.api.blizzard.com`;
  const res = await fetch(`${host}${apiPath}?namespace=${namespace}-${region}&locale=en_US`, { headers: { Authorization: `Bearer ${await bnetToken(region)}` }, signal: AbortSignal.timeout(20000) });
  if (res.status === 404) return null;
  if (res.status === 401) {
    delete tokens.bnet;
    throw new Error("Battle.net turned the keys down. Check BNET_CLIENT_ID and BNET_CLIENT_SECRET in .env.");
  }
  if (res.status === 429) throw new Error("Battle.net says too many requests. Try again in a minute.");
  if (!res.ok) throw new Error(`Battle.net answered ${res.status}`);
  return res.json();
}
// Slots a raider normally enchants in MoP; an empty socket counts wherever it is.
const ENCHANT_SLOTS = ["SHOULDER", "BACK", "CHEST", "WRIST", "HANDS", "LEGS", "FEET", "MAIN_HAND"];
async function gear(region, realmSlug, name) {
  const base = `/profile/wow/character/${encodeURIComponent(realmSlug)}/${encodeURIComponent(name.toLowerCase())}`;
  const sum = await bnet(region, base, "profile-classic");
  if (!sum) return null;
  const eq = (await bnet(region, `${base}/equipment`, "profile-classic")) || {};
  const items = (eq.equipped_items || []).map((i) => ({
    slot: i.slot?.type || "",
    slotName: i.slot?.name || "",
    name: i.name || i.item?.name || "",
    quality: i.quality?.name || null,
    ilvl: i.level?.value ?? null,
    enchants: (i.enchantments || []).filter((e) => e.enchantment_slot?.type !== "TEMPORARY").map((e) => String(e.display_string || e.source_item?.name || "Enchanted").replace(/^Enchanted:\s*/i, "")),
    gems: (i.sockets || []).map((g) => g.item?.name || null),
  }));
  return {
    realmSlug,
    level: sum.level ?? null,
    className: sum.character_class?.name || null,
    spec: sum.active_spec?.name || null,
    race: sum.race?.name || null,
    faction: sum.faction?.name || null,
    guild: sum.guild?.name || null,
    itemLevel: sum.equipped_item_level ?? null,
    avgItemLevel: sum.average_item_level ?? null,
    items,
    missingEnchants: items.filter((i) => ENCHANT_SLOTS.includes(i.slot) && !i.enchants.length).map((i) => i.slotName),
    emptySockets: items.flatMap((i) => i.gems.filter((g) => !g).map(() => i.slotName)),
  };
}
// Realm names Battle.net knows in this region that start like the one typed.
async function bnetRealmGuesses(region, realm) {
  const want = slug(realm).replace(/-/g, "");
  try {
    const d = await bnet(region, "/data/wow/realm/index", "dynamic-classic");
    return (d?.realms || []).filter((r) => { const n = String(r.slug).replace(/-/g, ""); return n.startsWith(want.slice(0, 4)) || want.startsWith(n.slice(0, 4)); }).map((r) => (typeof r.name === "string" ? r.name : r.name?.en_US || r.slug));
  } catch {
    return [];
  }
}

const CHARACTER = `query($name: String, $server: String, $region: String) {
  characterData { character(name: $name, serverSlug: $server, serverRegion: $region) {
    id name level classID faction { name } server { name slug }
    zoneRankings
    recentReports(limit: 10) { data { code title startTime endTime zone { name } } }
  } }
  gameData { classes { id name } }
  rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }
}`;

// When a character isn't found, the realms in that region whose name starts like the one typed ("Immers" -> "Immerseus").
async function realmGuesses(region, realm) {
  const want = slug(realm).replace(/-/g, "");
  const out = [];
  try {
    for (let page = 1; page <= 4; page++) {
      const d = await gql(`query($r: String, $p: Int) { worldData { region(slug: $r) { servers(limit: 100, page: $p) { has_more_pages data { name slug } } } } }`, { r: region, p: page });
      const s = d?.worldData?.region?.servers;
      for (const x of s?.data || []) {
        const n = x.slug.replace(/-/g, "");
        if (n.startsWith(want.slice(0, 4)) || want.startsWith(n.slice(0, 4))) out.push(x.name);
      }
      if (!s?.has_more_pages) break;
    }
  } catch {
    // Only a hint; the main error still shows.
  }
  return [...new Set(out)].slice(0, 6);
}

// zoneRankings is plain JSON from Warcraft Logs: the current raid's per-boss parses for this character.
function raidSummary(z) {
  if (!z || typeof z !== "object") return null;
  const bosses = (z.rankings || []).map((r) => ({
    boss: r.encounter?.name || "Boss",
    best: r.rankPercent != null ? Math.floor(r.rankPercent) : null,
    median: r.medianPercent != null ? Math.floor(r.medianPercent) : null,
    kills: r.totalKills ?? 0,
    fastest: r.fastestKill ? Math.round(r.fastestKill / 1000) : null,
    spec: r.spec || r.bestSpec || null,
    amount: r.bestAmount != null ? Math.round(r.bestAmount) : null,
  }));
  return {
    bestAverage: z.bestPerformanceAverage != null ? Math.round(z.bestPerformanceAverage * 10) / 10 : null,
    medianAverage: z.medianPerformanceAverage != null ? Math.round(z.medianPerformanceAverage * 10) / 10 : null,
    metric: z.metric || null,
    difficulty: z.difficulty ?? null,
    size: z.size ?? null,
    zone: z.zone ?? null,
    allStars: (z.allStars || []).map((a) => ({ spec: a.spec, points: a.points != null ? Math.round(a.points) : null, rank: a.rank ?? null, regionRank: a.regionRank ?? null, rankPercent: a.rankPercent != null ? Math.floor(a.rankPercent) : null })),
    bosses,
  };
}

export async function pullWow({ trigger = "button" } = {}) {
  const { id, secret } = keys();
  if (!id || !secret) throw new Error("Add WCL_CLIENT_ID and WCL_CLIENT_SECRET to .env, then restart the app.");
  const s = wowSettings();
  if (!s.characters.length) throw new Error("Add a character first (name and realm).");
  return withRun("wow pull", { trigger, characters: s.characters.length }, async (run) => {
    const chars = [];
    let classes = {}, limit = null;
    const withGear = Boolean(bnetKeys().id && bnetKeys().secret);
    for (const c of s.characters) {
      run.step(`${c.name}-${c.realm}`);
      const d = await gql(CHARACTER, { name: c.name, server: slug(c.realm), region: s.region });
      for (const k of d?.gameData?.classes || []) classes[k.id] = k.name;
      limit = d?.rateLimitData || limit;
      const ch = d?.characterData?.character;
      // Gear is its own source: a failure there is shown on the card, not a failed pull.
      let g = null, gearError = null;
      if (withGear) {
        try {
          g = await gear(s.region, ch?.server?.slug || slug(c.realm), c.name);
          if (!g) gearError = `Battle.net has no ${c.name} on ${ch?.server?.name || c.realm}, or the character is hidden.`;
        } catch (err) {
          gearError = err.message;
          run.warn(`${c.name} gear: ${err.message}`);
        }
      }
      if (!ch && !g) {
        const guesses = [...new Set([...(await realmGuesses(s.region, c.realm)), ...(withGear ? await bnetRealmGuesses(s.region, c.realm) : [])])].slice(0, 6);
        chars.push({ name: c.name, realm: c.realm, error: `Warcraft Logs has no ${c.name} on ${c.realm} (${s.region.toUpperCase()}).${guesses.length ? ` Realms with a name like that: ${guesses.join(", ")}.` : " Check the realm's full name."}` });
        run.warn(`${c.name}-${c.realm}: not found`);
        continue;
      }
      const realmSlug = ch?.server?.slug || g?.realmSlug || slug(c.realm);
      chars.push({
        name: ch?.name || c.name,
        realm: ch?.server?.name || c.realm,
        link: `${SITE}/character/${s.region}/${realmSlug}/${encodeURIComponent((ch?.name || c.name).toLowerCase())}`,
        level: ch?.level ?? g?.level ?? null,
        className: classes[ch?.classID] || g?.className || null,
        faction: ch?.faction?.name || g?.faction || null,
        logsError: ch ? null : `Warcraft Logs has no logs for ${c.name} on ${c.realm} yet.`,
        raid: ch ? raidSummary(ch.zoneRankings) : null,
        reports: (ch?.recentReports?.data || []).map((r) => ({
          code: r.code,
          title: r.title,
          zone: r.zone?.name || null,
          start: r.startTime ? new Date(r.startTime).toISOString() : null,
          minutes: r.startTime && r.endTime ? Math.round((r.endTime - r.startTime) / 60000) : null,
          link: `${SITE}/reports/${r.code}`,
        })),
        gear: g,
        gearError,
      });
    }
    const snap = { at: new Date().toISOString(), region: s.region, characters: chars, limit };
    fs.mkdirSync(path.dirname(LAST()), { recursive: true });
    writeJsonAtomic(LAST(), snap, 1);
    return { result: wowStats(), counts: { characters: chars.length, found: chars.filter((c) => !c.error).length, pointsUsed: limit?.pointsSpentThisHour ?? null } };
  }, { once: "wow" });
}

export function wowStats() {
  const { id, secret } = keys();
  const s = wowSettings();
  const last = readJson(LAST(), null);
  return { ready: Boolean(id && secret), gearReady: Boolean(bnetKeys().id && bnetKeys().secret), settings: s, pulledAt: last?.at || null, characters: last?.characters || [], limit: last?.limit || null };
}
