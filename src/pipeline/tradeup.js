// Trade-up (the owner 2026-10-19): low-value cards he doesn't use, into better long-term or playable cards.
// The trade pile is every card not in a deck or keep list, worth at most maxEach (CA$) each but not bulk. Wants are
// cards he'd like (data/cards/wants.json, priced on Scryfall); each want shows which pile cards cover its value.
// "Ideas" asks the AI for targets that fit his collection; every idea is priced on Scryfall, never by the AI.
// Suggestions only: nothing is bought, sold or changed in the collection.
import { readJson, writeJsonAtomic, resolvePath, OWNER } from "./util.js";
import { usdCad } from "./fx.js";
import { cardStores, country } from "../hub/settings.js";
import { collection, resolveMany, priceOf } from "./collection.js";
import { askJSON, obj, arr, str, oneOf } from "./claude.js";

const FILE = () => resolvePath("data/cards/tradeup.json");
const DEFAULTS = { maxEach: 5, minEach: 0.5, keep: ["Deck", "Keep", "Commander"] };

function load() { return { settings: { ...DEFAULTS }, wants: [], ideas: null, ...readJson(FILE(), {}) }; }
function save(t) { writeJsonAtomic(FILE(), t, 1); }

const kept = (c, keep) => c.lists.some((l) => keep.some((k) => l.toLowerCase().startsWith(k.toLowerCase())));
const cents = (n) => Math.round(n * 100) / 100;

// Greedy cover: the fewest, most valuable pile cards whose total reaches the want's price.
function cover(pile, price) {
  const used = [];
  let sum = 0;
  for (const p of pile) {
    if (sum >= price) break;
    for (let q = 0; q < p.qty && sum < price; q++) (used.push(p), (sum += p.eachCad));
  }
  const by = new Map();
  for (const u of used) by.set(u.id, { ...u, use: (by.get(u.id)?.use || 0) + 1 });
  return { cards: [...by.values()].map((u) => ({ name: u.name, set: u.set, use: u.use, eachCad: u.eachCad })), total: cents(sum), enough: sum >= price };
}

export async function tradeUp() {
  const t = load();
  const col = await collection();
  const rate = col.rate || (await usdCad().catch(() => null))?.rate || 1.38;
  const { maxEach, minEach, keep } = t.settings;
  const pile = col.cards
    .filter((c) => c.each != null && !kept(c, keep))
    .map((c) => ({ id: c.id, name: c.name, set: c.set, setName: c.setName, finish: c.finish, condition: c.condition, qty: c.qty, image: c.image, eachCad: cents(c.each * rate) }))
    .filter((c) => c.eachCad >= minEach && c.eachCad <= maxEach)
    .sort((a, b) => b.eachCad - a.eachCad);
  const pileValue = cents(pile.reduce((s, c) => s + c.eachCad * c.qty, 0));
  const wants = t.wants.map((w) => {
    const priceCad = w.usd != null ? cents(w.usd * rate) : null;
    return { ...w, priceCad, cover: priceCad != null ? cover(pile, priceCad) : null };
  });
  return { settings: t.settings, rate, pile: pile.slice(0, 200), pileCount: pile.reduce((s, c) => s + c.qty, 0), pileValue, wants, ideas: t.ideas };
}

export const hasWants = () => load().wants.length > 0;

export function saveSettings(patch = {}) {
  const t = load();
  const n = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  t.settings = {
    maxEach: n(patch.maxEach, 0.5, 500, t.settings.maxEach),
    minEach: n(patch.minEach, 0, 50, t.settings.minEach),
    keep: Array.isArray(patch.keep) ? patch.keep.map((k) => String(k).trim().slice(0, 30)).filter(Boolean).slice(0, 10) : t.settings.keep,
  };
  save(t);
  return t.settings;
}

// A want by Scryfall id (from the name search) or by name; finish picks the foil price when wanted.
export async function addWant({ scryfallId, name, finish = "nonfoil" }) {
  const [p] = await resolveMany([scryfallId ? { scryfallId } : { name }]);
  if (!p) throw new Error("Couldn't find that card on Scryfall.");
  const t = load();
  const usd = priceOf({ ...p, finish });
  t.wants = [
    ...t.wants.filter((w) => !(w.scryfallId === p.scryfallId && w.finish === finish)),
    {
      scryfallId: p.scryfallId,
      name: p.name,
      set: p.set,
      setName: p.setName,
      finish,
      image: p.image,
      usd,
      pricedAt: p.pricedAt,
      scryfallUrl: p.scryfallUrl,
      addedAt: new Date().toISOString(),
    },
  ];
  save(t);
  return tradeUp();
}
// A price target in CA$ for one want (empty clears it). The daily price check alerts once when it drops to it.
export function setWantTarget(scryfallId, finish, targetCad) {
  const t = load();
  const w = t.wants.find((x) => x.scryfallId === scryfallId && (!finish || x.finish === finish));
  if (!w) throw new Error("That want is gone. Refresh the page.");
  const n = targetCad === "" || targetCad == null ? null : Number(targetCad);
  if (n != null && !(n > 0 && n < 100000)) throw new Error("Type a price in CA$, like 12.50.");
  w.targetCad = n == null ? null : cents(n);
  w.alertedAt = null;
  save(t);
  return tradeUp();
}

// Daily (from collection.js dailyPrices): fresh prices for every want, and one phone alert per want when it drops to
// its target. The alert re-arms once the price goes back above the target.
export async function checkWants() {
  const t = load();
  if (!t.wants.length) return { checked: 0, hits: [] };
  const fresh = await resolveMany(t.wants.map((w) => ({ scryfallId: w.scryfallId })));
  const rate = (await usdCad().catch(() => null))?.rate || 1.38;
  const now = load();
  const hits = [];
  for (const [k, w0] of t.wants.entries()) {
    const p = fresh[k];
    const w = now.wants.find((x) => x.scryfallId === w0.scryfallId && x.finish === w0.finish);
    if (!p || !w) continue;
    const usd = priceOf({ ...p, finish: w.finish });
    if (usd == null) continue;
    w.wasUsd = w.usd;
    w.usd = usd;
    w.pricedAt = p.pricedAt;
    const cad = cents(usd * rate);
    if (w.targetCad != null && cad <= w.targetCad && !w.alertedAt) {
      w.alertedAt = new Date().toISOString();
      hits.push({ name: w.name, set: w.set, finish: w.finish, cad, target: w.targetCad });
    } else if (w.targetCad != null && cad > w.targetCad) w.alertedAt = null;
  }
  save(now);
  if (hits.length) {
    const { sendAlert } = await import("./notify.js");
    await sendAlert({
      kind: "want_price",
      title: hits.length === 1 ? `${hits[0].name} hit your price` : `${hits.length} wanted cards hit your price`,
      message: hits.map((h) => `${h.name} (${String(h.set || "").toUpperCase()}${h.finish === "foil" ? " foil" : ""}): CA$${h.cad.toFixed(2)}, target CA$${h.target.toFixed(2)}`).join("\n"),
      tags: ["dart"],
    }).catch((err) => {
      // Not sent: re-arm so tomorrow's check tries again (code review 2026-10-22).
      console.warn(`Want alert failed: ${err.message}`);
      const again = load();
      for (const w of again.wants) if (hits.some((h) => h.name === w.name && h.set === w.set && h.finish === w.finish)) w.alertedAt = null;
      save(again);
    });
  }
  return { checked: t.wants.length, hits };
}

export async function removeWant(scryfallId, finish) {
  const t = load();
  t.wants = t.wants.filter((w) => !(w.scryfallId === scryfallId && (!finish || w.finish === finish)));
  save(t);
  return tradeUp();
}

const IDEAS = obj({
  ideas: arr(obj({ name: str, kind: oneOf("long-term", "playable"), why: str })),
  note: str,
});

// AI ideas: what to trade the pile toward. The model sees the pile, his decks and colours; prices come from Scryfall.
export async function tradeIdeas() {
  const t = load();
  const now = await tradeUp();
  const col = await collection();
  const decks = [...new Set(col.cards.flatMap((c) => c.lists).filter((l) => /^(deck|commander)/i.test(l)))];
  const colours = {};
  for (const c of col.cards) for (const k of c.colors || []) colours[k] = (colours[k] || 0) + c.qty;
  const top = col.cards.filter((c) => c.each != null).sort((a, b) => b.each - a.each).slice(0, 40).map((c) => `${c.name} (${c.set.toUpperCase()}) US$${c.each.toFixed(2)}`);
  const r = await askJSON({
    name: "trade_up_ideas",
    effort: "medium",
    system: [
      `You help ${OWNER()}, a Magic: The Gathering player and collector${country() ? ` in ${country()}` : ""}, decide what to trade their spare cards toward.`,
      `They trade at local stores (${cardStores().shop}, ${cardStores().buylist}) at roughly market value. Suggest up to 8 single cards to aim for:`,
      "long-term = staples that have held or grown in value (reprint risk low or already reprinted, broad demand); playable = cards that fit their decks or colours.",
      "Each idea: the exact card name, kind, and why in one or two plain sentences. Don't give prices; they're looked up separately.",
      "note: one sentence on the overall approach for this pile. Never suggest buying sealed product or anything speculative on rumours.",
    ].join("\n"),
    content: [{ type: "text", text: [
      `Trade pile: ${now.pileCount} cards worth CA$${now.pileValue}. Most valuable in the pile: ${now.pile.slice(0, 40).map((c) => `${c.name} CA$${c.eachCad}`).join("; ")}`,
      `Decks / lists: ${decks.join(", ") || "none tagged yet"}`,
      `Colour counts across the collection: ${JSON.stringify(colours)}`,
      `Their most valuable cards: ${top.join("; ")}`,
      `Already wanted: ${t.wants.map((w) => w.name).join(", ") || "none"}`,
    ].join("\n\n") }],
    schema: IDEAS,
  });
  const priced = await resolveMany(r.ideas.map((i) => ({ name: i.name })));
  const rate = now.rate;
  const ideas = r.ideas.map((i, k) => {
    const p = priced[k];
    const usd = p ? priceOf({ ...p, finish: "nonfoil" }) : null;
    return { ...i, name: p?.name || i.name, scryfallId: p?.scryfallId || null, set: p?.set || null, image: p?.image || null, priceCad: usd != null ? cents(usd * rate) : null, scryfallUrl: p?.scryfallUrl || null };
  });
  const t2 = load();
  t2.ideas = { at: new Date().toISOString(), note: r.note, list: ideas };
  save(t2);
  return t2.ideas;
}
