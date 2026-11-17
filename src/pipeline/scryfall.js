// Card-read check against Scryfall (free, no key): every a channel card read is looked up by set + collector
// number, so a misread name or number is caught or fixed without another AI call. Lookups are cached for 30 days
// in data/scryfall-cache.json: the card list only changes when a set comes out, so there's no daily download.
import fs from "node:fs";
import { resolvePath, writeJsonAtomic, sleep, hubName } from "./util.js";

const FILE = () => resolvePath("data/scryfall-cache.json");
const DAYS = 30;
let cache = null;
const load = () => (cache ??= (() => { try { return JSON.parse(fs.readFileSync(FILE(), "utf8")); } catch { return {}; } })());
const save = () => { try { writeJsonAtomic(FILE(), cache, 0); } catch {} };
const norm = (s) => String(s ?? "").toLowerCase().split(" // ")[0].replace(/[^a-z0-9]/g, "");
let last = 0;

// One Scryfall API call, the one client every Scryfall caller shares (one rate gap for all of them): 120 ms apart as
// Scryfall asks, 550 ms for the 75-card POST lookups. Returns the JSON, or null for "not found". With `retries`, a
// 429 or 5xx waits (Retry-After, else 2 s, 4 s, 8 s...) and tries again instead of failing a 2,000-card import.
export async function scryfallApi(url, { body, retries = 0, timeout = 15000 } = {}) {
  for (let tryNo = 0; ; tryNo++) {
    const wait = last + (body ? 550 : 120) - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { "User-Agent": `${hubName()}/1.0`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
    if (res.status === 404) return null;
    if ((res.status === 429 || res.status >= 500) && tryNo < retries) {
      await sleep((Number(res.headers.get("retry-after")) || 2 ** (tryNo + 1)) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`Scryfall answered ${res.status}`);
    return res.json();
  }
}

// One cached Scryfall look-up (no retries: a card read must fail fast on an outage).
async function get(url) {
  const c = load();
  const hit = c[url];
  // ver 3 keeps each printing's look (border, frame, finishes) and picture; older cached searches are fetched again.
  if (hit && Date.now() - hit.at < DAYS * 864e5 && (hit.ver === 3 || !hit.v?.data)) return hit.v;
  const j = await scryfallApi(url);
  if (!j) return (c[url] = { at: Date.now(), v: null }), save(), null;
  const v = {
    name: j.name,
    set: j.set,
    set_name: j.set_name,
    collector_number: j.collector_number,
    rarity: j.rarity,
    total: j.total_cards,
    data: j.data?.map((d) => ({
      name: d.name,
      set: d.set,
      collector_number: d.collector_number,
      rarity: d.rarity,
      border: d.border_color,
      frame: d.frame_effects || [],
      full_art: !!d.full_art,
      finishes: d.finishes || [],
      promo: !!d.promo,
      img: d.image_uris?.normal || d.card_faces?.[0]?.image_uris?.normal || null,
    })),
  };
  c[url] = { at: Date.now(), v, ver: 3 };
  save();
  return v;
}

// Checks one card read. Returns { status, name?, collector_number?, note }:
// "ok" = name and number agree; "fixed" = corrected from Scryfall (flag it); "mismatch" = can't settle it (hold);
// "unknown" = no set code or Scryfall unreachable (leave the read as it was).
export async function checkCard(card) {
  let conflict = null;
  const set = String(card.set_code || "").toLowerCase().trim();
  const num = String(card.collector_number || "").replace(/^0+(?=\d)/, "").trim();
  if (!set) return { status: "unknown", note: "no set code read" };
  try {
    if (num) {
      const byNum = await get(`https://api.scryfall.com/cards/${encodeURIComponent(set)}/${encodeURIComponent(num)}`);
      if (byNum && norm(byNum.name) === norm(card.name)) return { status: "ok", name: byNum.name, collector_number: byNum.collector_number, note: "matches Scryfall" };
      if (byNum && card.confidence !== "high") {
        // A name read whole is harder to get wrong than a tiny number: FP006 (2026-10-20) read "Bladed Ambassador"
        // with the number #286, the number won, and the video was labelled Sinew Dancer (the render check caught
        // it). So the number only wins when the name read isn't a real card in this set.
        const real = /^unknown\b/i.test(card.name) ? null : await get(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(card.name)}&set=${encodeURIComponent(set)}`);
        if (!real) return { status: "fixed", name: byNum.name, collector_number: byNum.collector_number, note: `#${num} in ${set.toUpperCase()} is ${byNum.name} on Scryfall (read as "${card.name}")` };
        conflict = `the number read (#${num}) is ${byNum.name}, but "${real.name}" is a real ${set.toUpperCase()} card, so the name was kept`;
      }
    }
    // Number missing or disagreeing: find the name's printings in this set.
    const named = /^unknown\b/i.test(card.name) ? null : await get(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(card.name)}&set=${encodeURIComponent(set)}`);
    if (!named) {
      // Name unreadable: look the words read off the text box up in the set's rules text.
      const found = await byText(set, card);
      if (found?.length === 1)
        return {
          status: "fixed",
          name: found[0].name,
          collector_number: found[0].collector_number,
          note: `${found[0].name} (#${found[0].collector_number}) is the only ${set.toUpperCase()} card with that text (Scryfall, from the words read: "${found.words}")`,
        };
      if (found?.length > 1)
        return {
          status: "mismatch",
          choices: choicesOf(found.slice(0, 8)),
          note: `the words read ("${found.words}") fit ${found.length} ${set.toUpperCase()} cards: ${[...new Set(found.map((p) => p.name))].slice(0, 5).join(", ")}`,
        };
      return { status: "mismatch", note: `no card like "${card.name}" in ${set.toUpperCase()} on Scryfall` };
    }
    const prints = await get(`https://api.scryfall.com/cards/search?unique=prints&q=${encodeURIComponent(`!"${named.name}" set:${set}`)}`);
    // With a number that pointed at another card, never let it count as "the number read" below.
    const withConflict = (r) => (conflict ? { ...r, status: r.status === "ok" ? "fixed" : r.status, note: `${conflict}; ${r.note}` } : r);
    const list = prints?.data || [];
    if (num && !conflict && list.some((p) => p.collector_number === num))
      return {
        status: named.name === card.name ? "ok" : "fixed",
        name: named.name,
        collector_number: num,
        note: named.name === card.name ? "matches Scryfall" : `name corrected to ${named.name} (Scryfall)`,
      };
    if (list.length === 1) return withConflict({ status: "fixed", name: named.name, collector_number: list[0].collector_number, note: `${named.name} has one printing in ${set.toUpperCase()}: #${list[0].collector_number} (Scryfall)` });
    // No number: the card's look (borderless, showcase, extended art...) and foil often leave one printing.
    const look = byLook(list, card);
    if (look.length === 1)
      return withConflict({
        status: "fixed",
        name: named.name,
        collector_number: look[0].collector_number,
        note: `${named.name} is #${look[0].collector_number} in ${set.toUpperCase()}: the only ${card.treatment || "regular"}${card.foil === "nonfoil" ? " nonfoil" : ""} printing (Scryfall)`,
      });
    const shown = look.length > 1 ? look : list;
    return withConflict({
      status: "mismatch",
      name: named.name,
      choices: choicesOf(shown),
      note: `${named.name} has ${list.length} printings in ${set.toUpperCase()} (${list.map((p) => "#" + p.collector_number).join(", ")})${look.length > 1 && look.length < list.length ? `; ${look.length} look ${card.treatment}: ${shown.map((p) => "#" + p.collector_number).join(", ")}` : ""}; the number read (${num || "none"}) doesn't settle which`,
    });
  } catch (err) {
    return { status: "unknown", note: `Scryfall check didn't run: ${err.message}` };
  }
}

// Printings that match how the card looks: the treatment read off the card, and foil-only printings dropped for a
// nonfoil read. Promos are left out unless nothing else is left.
function byLook(list, card) {
  const t = card.treatment;
  const is = {
    borderless: (p) => p.border === "borderless",
    showcase: (p) => p.frame?.includes("showcase"),
    "extended art": (p) => p.frame?.includes("extendedart"),
    "etched foil": (p) => p.finishes?.includes("etched"),
    regular: (p) => p.border !== "borderless" && !p.full_art && !(p.frame || []).some((f) => ["showcase", "extendedart", "etched"].includes(f)),
  }[t];
  if (!is || !list.some((p) => p.border)) return [];
  let out = list.filter(is);
  if (card.foil === "nonfoil") out = out.filter((p) => !p.finishes?.length || p.finishes.includes("nonfoil"));
  if (card.foil === "foil") out = out.filter((p) => !p.finishes?.length || p.finishes.some((f) => f !== "nonfoil"));
  const plain = out.filter((p) => !p.promo);
  return plain.length ? plain : out;
}

// A card whose name couldn't be read, found by the words read off its text box (the read's "text", or what's in
// brackets in an "Unknown (...)" name). Reminder text in brackets and quoted flavour text are dropped (flavour isn't
// searchable). Tries each rules sentence as an exact phrase first, then the longest few words, with the card type
// from the type line when there is one.
async function byText(set, card) {
  let raw = String(card.text || card.name.match(/\(([^)]+)\)/)?.[1] || "");
  if (/not (visible|readable|shown)|face down/i.test(raw)) return null;
  // "Artifact Creature — Human Robot Villain. When this..." -> types, then the rules text.
  let types = [];
  const tl = raw.match(/^\s*((?:legendary |basic |snow )*(?:artifact|creature|enchantment|instant|sorcery|land|planeswalker|battle|kindred)[^.]*?)\.\s+/i);
  if (tl) {
    types = tl[1].replace(/—/g, " ").split(/\s+/).filter((w) => w.length > 2).slice(0, 4);
    raw = raw.slice(tl[0].length);
  }
  const rules = raw.replace(/\([^)]*\)/g, ". ").replace(/"[^"]*"|“[^”]*”/g, ". ").replace(/\{[^}]*\}/g, " ");
  const tq = types.map((t) => `t:${t.toLowerCase()}`).join(" ");
  const tries = [];
  for (const sentence of rules.split(/[.!?]\s+|\.$/).map((x) => x.trim().replace(/"/g, "")).filter((x) => x.length >= 12).slice(0, 3)) tries.push({ q: `o:"${sentence.toLowerCase()}"`, words: sentence });
  const words = [...new Set(rules.toLowerCase().replace(/[^a-z0-9/+\- ]/g, " ").split(/\s+/))]
    .filter((w) => w.length >= 4 && !/^(unknown|card|creature|spell|instant|sorcery|target|until|turn|with|this|that|your|from|each|when|whenever|flavor|text|black|blue|white|green|red|face|visible|readable|shown|bottom|right|left|pile)$/.test(w))
    .sort((a, b) => b.length - a.length);
  if (words.length >= 2) {
    tries.push({ q: words.slice(0, 3).map((w) => `o:${/[/+]/.test(w) ? `"${w}"` : w}`).join(" "), words: words.slice(0, 3).join(" ") });
    tries.push({ q: words.slice(0, 2).map((w) => `o:${/[/+]/.test(w) ? `"${w}"` : w}`).join(" "), words: words.slice(0, 2).join(" ") });
  }
  if (!tries.length) return null;
  for (const t of tries) {
    const res = await get(`https://api.scryfall.com/cards/search?unique=cards&q=${encodeURIComponent(`set:${set} ${tq} ${t.q}`.replace(/\s+/g, " "))}`);
    const list = [...(res?.data || [])];
    if (!list.length) continue;
    list.words = t.words.slice(0, 80);
    return list;
  }
  return [];
}

// What a printing looks like, in a few words for a hold box or the picture comparison.
export function lookOf(p) {
  const f = p.frame || [];
  const look = p.border === "borderless" ? "borderless" : f.includes("showcase") ? "showcase" : f.includes("extendedart") ? "extended art" : f.includes("etched") ? "etched" : p.full_art ? "full art" : "regular";
  return `${look}${p.promo ? " promo" : ""}`;
}
// The printings still in the running, for the picture comparison and the owner's pick list.
const choicesOf = (list) => list.map((p) => ({ name: p.name, n: p.collector_number, look: lookOf(p), finishes: p.finishes || [], img: p.img || null }));
