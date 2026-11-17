// AI deck ideas (the owner picked it 2026-10-21): Commander or 60-card decks built mostly from cards he owns.
// 60-card decks can be for a real format (Standard, Pioneer, Modern, Pauper; the owner asked 2026-10-22 which one it
// meant): then only cards Scryfall lists as legal there go to the AI, and missing cards and upgrades are checked too.
// The AI sees the collection's card names (with type and colour identity) and suggests decks; every card it lists is
// then checked against the collection here, so "you own it" is never the AI's word. Anything short goes on the
// missing list, and missing cards and upgrades are priced on Scryfall, never by the AI. Suggestions only: nothing
// is bought or changed in the collection. Data in data/cards/deckideas.json (last 10 asks).
import { readJson, writeJsonAtomic, resolvePath, newId, OWNER } from "./util.js";
import { country } from "../hub/settings.js";
import { usdCad } from "./fx.js";
import { collectionCards, resolveMany, priceOf } from "./collection.js";
import { askJSON, obj, arr, str, num, oneOf } from "./claude.js";

const FILE = () => resolvePath("data/cards/deckideas.json");
export const FORMATS = ["Commander", "Standard", "Pioneer", "Modern", "Pauper", "Casual 60-card", "Either"];
// Scryfall's name for each real format; Commander uses colour identity and singleton instead of this check.
const LEGAL = { Commander: "commander", Standard: "standard", Pioneer: "pioneer", Modern: "modern", Pauper: "pauper" };
const DECK_FORMATS = FORMATS.filter((f) => f !== "Either");
const BASICS = /^(snow-covered )?(plains|island|swamp|mountain|forest|wastes)$/i;

function load() { return { runs: [], ...readJson(FILE(), {}) }; }
function save(d) { writeJsonAtomic(FILE(), d, 1); }

const cents = (n) => Math.round(n * 100) / 100;
// One spelling per name: no accents, lower case, and the front face of split or double-faced cards.
const key = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(" // ")[0].replace(/\s+/g, " ").trim();

const DECKS = obj({
  decks: arr(obj({
    name: str,
    format: oneOf(...DECK_FORMATS),
    commander: str,
    colours: str,
    plan: str,
    cards: arr(obj({ name: str, qty: num })),
    basics: arr(obj({ name: str, qty: num })),
    upgrades: arr(obj({ name: str, why: str })),
  })),
  note: str,
});

export function deckIdeasList() {
  return { runs: load().runs, formats: FORMATS };
}

export function deleteDeckIdea(id) {
  const d = load();
  d.runs = d.runs.filter((r) => r.id !== id);
  save(d);
  return deckIdeasList();
}

// ask: { format: one of FORMATS, colours: "WUBRG" subset or "", hint: free text }.
export async function makeDeckIdeas({ format = "Either", colours = "", hint = "" } = {}) {
  if (format === "60-card") format = "Casual 60-card";
  format = FORMATS.includes(format) ? format : "Either";
  const legalIn = format === "Commander" ? null : LEGAL[format] || null;
  colours = [...new Set(String(colours).toUpperCase().replace(/[^WUBRG]/g, ""))].join("");
  hint = String(hint || "").trim().slice(0, 200);
  const cards = collectionCards();
  if (!cards.length) throw new Error("The collection is empty. Import your cards first.");
  const rate = (await usdCad().catch(() => null))?.rate || 1.38;

  // What he owns, by name: total copies, type, colour identity, and any deck lists those copies are already in.
  const owned = new Map();
  for (const c of cards) {
    if (BASICS.test(c.name)) continue;
    const k = key(c.name);
    const o = owned.get(k) || { name: c.name, qty: 0, type: c.typeLine || "", colors: c.colors || [], usd: null, decks: new Set(), legal: null, id: c.scryfallId };
    if (!o.legal && Array.isArray(c.legal)) o.legal = c.legal;
    o.qty += c.qty;
    const p = priceOf(c);
    if (p != null && (o.usd == null || p < o.usd)) o.usd = p;
    for (const l of c.lists || []) if (/^(deck|commander)/i.test(l)) o.decks.add(l);
    owned.set(k, o);
  }
  // Cards saved before legality was kept get it from Scryfall now (the daily price refresh stores it from then on).
  if (legalIn) {
    const need = [...owned.values()].filter((o) => !o.legal && o.id);
    if (need.length) {
      const got = await resolveMany(need.map((o) => ({ scryfallId: o.id })));
      need.forEach((o, i) => { if (got[i]) o.legal = got[i].legal; });
    }
  }
  const fits = (o) => (!colours || o.colors.every((x) => colours.includes(x))) && (!legalIn || (o.legal || []).includes(legalIn));
  const pool = [...owned.values()].filter(fits).slice(0, 2500);
  const why = [legalIn ? `are legal in ${format}` : "", colours ? `fit ${colours}` : ""].filter(Boolean).join(" and ");
  if (pool.length < 40) throw new Error(`Only ${pool.length} of your cards ${why || "can be used"}. ${colours ? "Pick more colours or none, or another format." : "Try another format."}`);

  const r = await askJSON({
    name: "deck_ideas",
    effort: "medium",
    system: [
      `You help ${OWNER()}, a Magic: The Gathering player${country() ? ` in ${country()}` : ""}, find decks they can build from cards they already own.`,
      "Suggest 3 different decks. Commander decks are 100 cards including the commander, singleton (one of each name except basic lands).",
      "Standard, Pioneer, Modern and Pauper decks: 60 cards, at most 4 copies of a name, every card legal in that format (their list is already cut to legal cards). Casual 60-card decks follow the same size and copy rules with no format list.",
      "Upgrades for a Standard, Pioneer, Modern or Pauper deck must be legal in that format too.",
      "cards: only cards from their list, with how many copies the deck uses (never more than they own). Include the commander in cards.",
      "basics: basic lands to add (they have plenty), so cards + basics add up to the deck size.",
      "commander: the commander's exact name, or empty for a 60-card deck. colours: the colour letters, like WB.",
      "plan: two or three plain sentences on how the deck wins and why these cards work together.",
      "upgrades: up to 8 cards they don't own that would improve the deck most, each with one plain sentence why. Prefer reasonably priced cards. Don't give prices; they're looked up separately.",
      "Use exact card names as written in their list. Pick decks that use their strongest cards and have a clear plan. note: one sentence on what the collection is best at.",
    ].join("\n"),
    content: [{ type: "text", text: [
      `Format: ${format === "Either" ? "any mix of Commander and casual 60-card" : format}.`,
      colours ? `Colours: only ${colours} (colour identity inside ${colours}).` : "Colours: any.",
      hint ? `What they asked for: ${hint}` : "",
      `Their cards (name | type | colour identity | copies), ${pool.length} names, basic lands left out:`,
      pool.map((o) => `${o.name} | ${o.type} | ${o.colors.join("") || "C"} | ${o.qty}`).join("\n"),
    ].filter(Boolean).join("\n\n") }],
    schema: DECKS,
  });

  // Check each deck against the collection: what's really owned, what's short, and what finishing it costs.
  const decks = r.decks.slice(0, 5).map((d) => {
    const have = [], missing = [], basics = [];
    for (const c of d.cards) {
      const qty = Math.max(1, Math.round(c.qty || 1));
      if (BASICS.test(c.name.trim())) { basics.push({ name: c.name.trim(), qty }); continue; }
      const o = owned.get(key(c.name));
      const got = Math.min(qty, o?.qty || 0);
      if (got) have.push({ name: o.name, qty: got, type: o.type, usd: o.usd, decks: [...o.decks] });
      if (got < qty) missing.push({ name: o?.name || c.name, qty: qty - got, ownedSome: got > 0 });
    }
    for (const b of d.basics || []) if (b.qty > 0) basics.push({ name: b.name, qty: Math.round(b.qty) });
    return { ...d, have, missing, basics, upgrades: (d.upgrades || []).slice(0, 8) };
  });

  // Price missing cards and upgrades together (cheapest printing Scryfall knows by name).
  const names = [...new Set(decks.flatMap((d) => [...d.missing, ...d.upgrades].map((x) => x.name)))];
  const found = names.length ? await resolveMany(names.map((name) => ({ name }))) : [];
  const priced = new Map(names.map((n, i) => [key(n), found[i]]));
  const price = (x) => {
    const p = priced.get(key(x.name));
    const usd = p ? priceOf({ ...p, finish: "nonfoil" }) : null;
    return { ...x, name: p?.name || x.name, real: !!p, legal: p?.legal || null, priceCad: usd != null ? cents(usd * rate) : null, image: p?.image || null, scryfallUrl: p?.scryfallUrl || null };
  };
  // A real format's deck: say which missing cards aren't legal there, and drop upgrades that aren't.
  const notLegal = (d, x) => !!LEGAL[d.format] && d.format !== "Commander" && x.legal && !x.legal.includes(LEGAL[d.format]);
  const out = decks.map((d) => {
    const missing = d.missing.map(price).map((x) => ({ ...x, notLegal: notLegal(d, x) }));
    const size = d.format === "Commander" ? 100 : 60;
    const count = d.have.reduce((t, c) => t + c.qty, 0) + missing.reduce((t, c) => t + c.qty, 0) + d.basics.reduce((t, c) => t + c.qty, 0);
    return {
      name: d.name, format: d.format, commander: d.commander, colours: d.colours, plan: d.plan,
      size, count,
      owned: d.have.reduce((t, c) => t + c.qty, 0) + d.basics.reduce((t, c) => t + c.qty, 0),
      ownedValueCad: cents(d.have.reduce((t, c) => t + (c.usd || 0) * c.qty, 0) * rate),
      toFinishCad: cents(missing.reduce((t, c) => t + (c.priceCad || 0) * c.qty, 0)),
      unpriced: missing.filter((c) => c.priceCad == null).reduce((t, c) => t + c.qty, 0),
      have: d.have.map(({ usd, ...c }) => ({ ...c, eachCad: usd != null ? cents(usd * rate) : null })),
      missing, basics: d.basics,
      upgrades: d.upgrades.map(price).filter((x) => !notLegal(d, x)),
    };
  });

  const run = { id: newId(4), at: new Date().toISOString(), ask: { format, colours, hint }, pool: pool.length, note: r.note, decks: out };
  const all = load();
  all.runs = [run, ...all.runs].slice(0, 10);
  save(all);
  return run;
}
