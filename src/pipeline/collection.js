// Card collection (the owner's own ManaBox / Delver Lens): cards added by photo, by name, or by importing a ManaBox or
// Delver Lens CSV export. Every card is matched to its exact Scryfall printing, so prices (Scryfall's daily TCGplayer
// USD and Cardmarket EUR, free, no key) and images come with it; values show in CAD at the Bank of Canada rate.
// Lists ("Binder", "Trade", "Deck: <your deck's name>"...) are free-form tags. Kept in data/cards/collection.json; each price
// refresh adds a total to data/cards/value-history.jsonl for the value-over-time chart (and later the trade-up tool).
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJsonAtomic, resolvePath, readJsonl, appendJsonl, newId } from "./util.js";
import { usdCad } from "./fx.js";
import { scryfallApi } from "./scryfall.js";

const FILE = () => resolvePath("data/cards/collection.json");
const HISTORY = () => resolvePath("data/cards/value-history.jsonl");
const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];
const FINISHES = ["nonfoil", "foil", "etched"];

function load() { return readJson(FILE(), { cards: [], lists: ["Binder", "Trade"] }); }
function save(c) { writeJsonAtomic(FILE(), c, 1); }

// Scryfall calls here retry a 429 or 5xx (up to 6 times) so a 2,000-card import survives a busy minute.
const scryfall = (url, body) => scryfallApi(url, { body, retries: 6, timeout: 20000 });

// The fields we keep from a Scryfall card.
function printing(j) {
  const img = j.image_uris || j.card_faces?.[0]?.image_uris || {};
  return {
    scryfallId: j.id,
    name: j.name,
    set: j.set,
    setName: j.set_name,
    number: j.collector_number,
    rarity: j.rarity,
    finishes: j.finishes || [],
    image: img.small || img.normal || null,
    imageLarge: img.normal || img.large || null,
    typeLine: j.type_line || j.card_faces?.[0]?.type_line || "",
    colors: j.color_identity || [],
    // Formats the card can be played in today (Scryfall keeps these current, so Standard rotation is followed).
    legal: Object.keys(j.legalities || {}).filter((f) => j.legalities[f] === "legal" || j.legalities[f] === "restricted"),
    prices: { usd: num(j.prices?.usd), usdFoil: num(j.prices?.usd_foil), usdEtched: num(j.prices?.usd_etched), eur: num(j.prices?.eur), eurFoil: num(j.prices?.eur_foil) },
    pricedAt: new Date().toISOString(),
    scryfallUrl: j.scryfall_uri,
  };
}
const num = (v) => (v == null || v === "" ? null : Number(v));
export const priceOf = (c) => (c.finish === "foil" ? c.prices?.usdFoil ?? c.prices?.usd : c.finish === "etched" ? c.prices?.usdEtched ?? c.prices?.usdFoil : c.prices?.usd ?? c.prices?.usdFoil) ?? null;

// Looks up to 75 cards at a time. Each wanted item: { scryfallId } | { set, number } | { name, set } | { name }.
export async function resolveMany(items) {
  const out = new Array(items.length).fill(null);
  const ident = (w) =>
    w.scryfallId
      ? { id: w.scryfallId }
      : w.set && w.number
        ? { set: w.set.toLowerCase(), collector_number: String(w.number).replace(/^0+(?=\d)/, "") }
        : w.name && w.set
          ? { name: w.name, set: w.set.toLowerCase() }
          : w.name
            ? { name: w.name }
            : null;
  for (let i = 0; i < items.length; i += 75) {
    const chunk = items.slice(i, i + 75).map((w, k) => ({ k: i + k, id: ident(w) })).filter((x) => x.id);
    if (!chunk.length) continue;
    const r = await scryfall("https://api.scryfall.com/cards/collection", { identifiers: chunk.map((x) => x.id) });
    const found = r?.data || [];
    // Each answer is matched to what was asked by id, set + number, or name (code review 2026-10-22). Matching by
    // position shifted every later card in the batch whenever Scryfall answered a repeated card only once.
    const low = (v) => String(v || "").toLowerCase();
    const front = (n) => low(n).split(" // ")[0];
    const match = (id) =>
      found.find((c) =>
        id.id
          ? c.id === id.id
          : id.collector_number
            ? low(c.set) === id.set && low(c.collector_number) === low(id.collector_number)
            : (front(c.name) === front(id.name) || low(c.name) === low(id.name)) && (!id.set || low(c.set) === id.set),
      );
    for (const x of chunk) {
      const c = match(x.id);
      out[x.k] = c ? printing(c) : null;
    }
  }
  // Second try by name alone for anything a set/number pair didn't find (typos in a CSV's set code, promo numbers).
  for (let k = 0; k < items.length; k++) {
    if (out[k] || !items[k].name) continue;
    const j = await scryfall(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(items[k].name)}${items[k].set ? `&set=${encodeURIComponent(items[k].set.toLowerCase())}` : ""}`).catch(() => null)
      || (items[k].set ? await scryfall(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(items[k].name)}`).catch(() => null) : null);
    if (j) out[k] = { ...printing(j), guessed: true };
  }
  return out;
}

const cleanCond = (c) => {
  const s = String(c || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (/^(NM|NEARMINT|M|MINT)/.test(s)) return "NM";
  if (/^(LP|LIGHTLYPLAYED|EX|EXCELLENT|SP|SLIGHTLYPLAYED|GOOD)/.test(s)) return "LP";
  if (/^(MP|MODERATELYPLAYED|PLAYED|PL)/.test(s)) return "MP";
  if (/^(HP|HEAVILYPLAYED|POOR)/.test(s)) return "HP";
  if (/^(DMG|DAMAGED|D)/.test(s)) return "DMG";
  return "NM";
};
// Apps write language as "en", "English" or "EN"; one spelling so the same card merges.
const LANGS = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ja: "Japanese",
  jp: "Japanese",
  ko: "Korean",
  ru: "Russian",
  zhs: "Chinese Simplified",
  zht: "Chinese Traditional",
  zh: "Chinese Simplified",
  ph: "Phyrexian",
};
const cleanLang = (l) => {
  const s = String(l || "").trim();
  if (!s) return "English";
  return LANGS[s.toLowerCase()] || s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().slice(0, 19);
};
const cleanFinish = (f, finishes = []) => {
  const s = String(f ?? "").toLowerCase();
  const v = /etched/.test(s) ? "etched" : /^(foil|yes|true|1)$/.test(s) || /\bfoil\b/.test(s) ? "foil" : "nonfoil";
  return finishes.length && !finishes.includes(v) ? finishes[0] : v;
};

// Adds cards. wanted: [{ name?, set?, number?, scryfallId?, qty?, finish|foil?, condition?, language?, paid?, lists? }].
// Same printing + finish + condition + language adds to the quantity. Returns { added, merged, notFound }.
export async function addCards(wanted, { source = "manual" } = {}) {
  if (!Array.isArray(wanted) || !wanted.length) throw new Error("Nothing to add.");
  if (wanted.length > 5000) throw new Error("That's more than 5,000 rows; split the file.");
  const found = await resolveMany(wanted);
  const col = load();
  const res = { added: 0, merged: 0, notFound: [], guessed: [], ids: [] };
  wanted.forEach((w, i) => {
    const p = found[i];
    if (!p) return res.notFound.push(w.name || `${w.set} #${w.number}`);
    if (p.guessed) res.guessed.push(`${w.name} -> ${p.name} (${p.set.toUpperCase()} #${p.number})`);
    const card = {
      ...p,
      finish: cleanFinish(w.finish ?? w.foil, p.finishes),
      condition: cleanCond(w.condition),
      language: cleanLang(w.language),
      qty: Math.max(1, Math.min(999, Math.round(Number(w.qty) || 1))),
      paid: w.paid != null && w.paid !== "" && Number.isFinite(Number(w.paid)) ? Number(w.paid) : null,
      lists: Array.isArray(w.lists) ? w.lists.map(String).filter(Boolean).slice(0, 10) : [],
    };
    delete card.guessed;
    const same = col.cards.find((c) => c.scryfallId === card.scryfallId && c.finish === card.finish && c.condition === card.condition && c.language === card.language);
    if (same) {
      same.qty += card.qty;
      for (const l of card.lists) if (!same.lists.includes(l)) same.lists.push(l);
      res.merged++;
      res.ids.push({ id: same.id, qty: card.qty, index: i });
    } else {
      const id = newId(6);
      col.cards.push({ id, ...card, addedAt: new Date().toISOString(), source });
      res.added++;
      res.ids.push({ id, qty: card.qty, index: i });
    }
    for (const l of card.lists) if (!col.lists.includes(l)) col.lists.push(l);
  });
  save(col);
  return res;
}

// CSV import: ManaBox, Delver Lens, Moxfield, Deckbox and most other apps, matched by column name.
export async function importCsv(text, { lists = [] } = {}) {
  const rows = parseCsv(String(text || ""));
  if (rows.length < 2) throw new Error("That file has no card rows.");
  const head = rows[0].map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const at = {
    name: col("name", "cardname", "card"),
    set: col("setcode", "editioncode", "set", "edition", "expansioncode"),
    number: col("collectornumber", "collectorsnumber", "cardnumber", "number", "no"),
    qty: col("quantity", "quantityx", "qty", "count", "amount"),
    finish: col("foil", "finish", "printing", "isfoil"),
    condition: col("condition", "cond"),
    language: col("language", "lang"),
    scryfallId: col("scryfallid", "scryfalluuid"),
    // Not plain "Price": in most exports (e.g. this one's "$554.74") that's today's market price, not what was paid.
    paid: col("purchaseprice", "pricebought", "boughtfor", "paid"),
  };
  if (at.name < 0 && at.scryfallId < 0) throw new Error("Couldn't find a Name column. Export from ManaBox or Delver Lens as CSV and try again.");
  const wanted = rows.slice(1).filter((r) => r.some((x) => x.trim())).map((r) => {
    const g = (k) => (at[k] >= 0 ? String(r[at[k]] ?? "").trim() : "");
    // A set column holding a full set name ("Bloomburrow") isn't a code; leave it out and match by name.
    const set = g("set").replace(/^\((.*)\)$/, "$1"); // "(3ED)" -> "3ED"
    return {
      name: g("name"),
      set: /^[a-z0-9]{2,6}$/i.test(set) ? set : "",
      number: g("number"),
      qty: g("qty").replace(/x$/i, "") || 1,
      finish: g("finish"),
      condition: g("condition"),
      language: g("language") || "English",
      scryfallId: /^[0-9a-f-]{36}$/i.test(g("scryfallId")) ? g("scryfallId") : "",
      paid: g("paid").replace(/[^0-9.]/g, ""),
      lists,
    };
  });
  return { rows: wanted.length, ...(await addCards(wanted, { source: "csv" })) };
}

function parseCsv(text) {
  const out = [];
  let row = [], cell = "", q = false;
  const first = text.split("\n")[0], count = (re) => (first.match(re) || []).length;
  const sep = count(/\t/g) > Math.max(count(/,/g), count(/;/g)) ? "\t" : count(/;/g) > count(/,/g) ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell), out.push(row), (row = []), (cell = "");
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell), out.push(row);
  return out;
}

export function updateCard(id, patch = {}) {
  const col = load();
  const c = col.cards.find((x) => x.id === id);
  if (!c) throw new Error("That card isn't in the collection.");
  if (patch.qty != null) {
    const q = Math.round(Number(patch.qty));
    if (!Number.isFinite(q) || q < 0 || q > 999) throw new Error("Quantity must be 0 to 999.");
    if (q === 0) col.cards = col.cards.filter((x) => x.id !== id);
    else c.qty = q;
  }
  if (patch.condition && CONDITIONS.includes(patch.condition)) c.condition = patch.condition;
  if (patch.finish && FINISHES.includes(patch.finish)) c.finish = patch.finish;
  if (Array.isArray(patch.lists)) {
    c.lists = patch.lists.map((l) => String(l).trim().slice(0, 40)).filter(Boolean).slice(0, 10);
    for (const l of c.lists) if (!col.lists.includes(l)) col.lists.push(l);
  }
  if (patch.paid !== undefined) c.paid = patch.paid === "" || patch.paid == null ? null : Number(patch.paid);
  save(col);
  return { ok: true };
}

// Deck list from pasted names (the owner 2026-10-23, his Commander deck read from a video): puts the owned copies of
// each card into one list ("Commander: Atraxa"), so Deck ideas and Worth selling know they're in use. Lines like
// "1 Command Tower", "Command Tower" or "4x Counterspell (2X2) 117" all work. A list is set per collection row, so a row
// of 4 copies joins with all 4. Saving again replaces the list: rows no longer named in it leave it.
const deckKey = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export function deckList({ list, text, save: keep = false } = {}) {
  list = String(list || "").trim().slice(0, 40);
  if (!/^(deck|commander)/i.test(list)) throw new Error('Start the list name with "Deck" or "Commander", like "Commander: Atraxa".');
  const want = new Map();
  for (let line of String(text || "").split(/\r?\n/).slice(0, 400)) {
    line = line.replace(/[⚠*]|\(.*?\)\s*[\w-]*\s*$/g, "").trim();
    if (!line || /^(#|\/\/)/.test(line) || /^(deck|sideboard|commander|lands?|spells|creatures|maybeboard)\s*(\(\d+\))?:?$/i.test(line)) continue;
    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    const qty = m ? Math.min(99, Number(m[1])) : 1, name = (m ? m[2] : line).trim();
    const k = deckKey(name.split(" // ")[0]);
    const w = want.get(k) || { name, qty: 0 };
    w.qty += qty;
    want.set(k, w);
  }
  if (!want.size) throw new Error("Paste the deck list first, one card per line.");
  const col = load();
  // Any face of a two-sided card counts (Delver of Secrets // Insectile Aberration).
  const faces = (c) => [c.name, ...String(c.name).split(" // ")].map(deckKey);
  const inOther = (c) => (c.lists || []).some((l) => l !== list && /^(deck|commander)/i.test(l));
  const picked = new Set(), found = [], missing = [], shared = [];
  for (const [k, w] of want) {
    const rows = col.cards.filter((c) => faces(c).includes(k))
      .sort((a, b) => ((b.lists || []).includes(list) - (a.lists || []).includes(list)) || (inOther(a) - inOther(b)));
    let got = 0;
    for (const r of rows) {
      if (got >= w.qty) break;
      picked.add(r.id);
      got += r.qty;
      if (inOther(r)) shared.push({ name: r.name, lists: r.lists.filter((l) => l !== list && /^(deck|commander)/i.test(l)) });
    }
    if (got) found.push({ name: rows[0].name, qty: w.qty, have: Math.min(got, w.qty) });
    if (got < w.qty) missing.push({ name: rows[0]?.name || w.name, qty: w.qty - got, ownedSome: got > 0 });
  }
  if (keep) {
    for (const c of col.cards) {
      const has = (c.lists || []).includes(list);
      if (picked.has(c.id) && !has) c.lists = [...(c.lists || []), list].slice(0, 10);
      if (!picked.has(c.id) && has) c.lists = c.lists.filter((l) => l !== list);
    }
    if (!col.lists.includes(list)) col.lists.push(list);
    save(col);
  }
  const count = (xs) => xs.reduce((t, x) => t + x.qty, 0);
  return { list, saved: keep, cards: count([...want.values()]), owned: found.reduce((t, x) => t + x.have, 0), found, missing, shared };
}

// For trades: take cards out of the collection ([{ id, qty }]), all or nothing, returning what was taken so it can
// be put back (undo). takeCards throws before changing anything if a card is missing or there aren't enough copies.
export function takeCards(items) {
  const col = load();
  // Two rows can point at the same copy, so check the total asked for each card (code review 2026-10-22).
  const want = {};
  for (const it of items) want[it.id] = (want[it.id] || 0) + it.qty;
  for (const it of items) {
    const c = col.cards.find((x) => x.id === it.id);
    if (!c) throw new Error(`${it.name || "A card"} isn't in the collection any more.`);
    if (c.qty < want[it.id]) throw new Error(`You have ${c.qty} ${c.name}, the trade gives ${want[it.id]}.`);
  }
  const taken = [];
  for (const it of items) {
    const c = col.cards.find((x) => x.id === it.id);
    c.qty -= it.qty;
    taken.push({ qty: it.qty, card: { ...c, qty: it.qty } });
    if (c.qty <= 0) col.cards = col.cards.filter((x) => x.id !== it.id);
  }
  save(col);
  return taken;
}
export function putBack(taken) {
  const col = load();
  for (const t of taken) {
    const c = col.cards.find((x) => x.id === t.card.id);
    if (c) c.qty += t.qty;
    else col.cards.push({ ...t.card, qty: t.qty });
  }
  save(col);
}
// Removes copies added by a trade ([{ id, qty }]); copies already gone are skipped. Returns how many were removed.
export function removeAdded(items) {
  const col = load();
  let n = 0;
  for (const it of items) {
    const c = col.cards.find((x) => x.id === it.id);
    if (!c) continue;
    const q = Math.min(c.qty, it.qty);
    c.qty -= q;
    n += q;
    if (c.qty <= 0) col.cards = col.cards.filter((x) => x.id !== it.id);
  }
  save(col);
  return n;
}
export const collectionCards = () => load().cards;

// Fresh prices for every card (Scryfall updates them once a day), and a dated total for the history chart.
export async function refreshPrices() {
  const ids = [...new Set(load().cards.map((c) => c.scryfallId))];
  const fresh = await resolveMany(ids.map((scryfallId) => ({ scryfallId })));
  const by = Object.fromEntries(fresh.filter(Boolean).map((p) => [p.scryfallId, p]));
  // Re-read after the lookups (they take a while) so cards added meanwhile aren't lost.
  const col = load();
  const day = new Date().toISOString().slice(0, 10);
  const moves = [];
  for (const c of col.cards) {
    if (by[c.scryfallId]) Object.assign(c, { prices: by[c.scryfallId].prices, pricedAt: by[c.scryfallId].pricedAt, image: by[c.scryfallId].image || c.image, legal: by[c.scryfallId].legal });
    // One USD price per card per day, last 21 days, for "biggest movers this week" on the Collection page.
    const each = priceOf(c);
    if (each != null) {
      // A big move since the last refresh: a card worth US$2+ that moved 25%+ and US$2+ across the copies owned.
      const prev = (c.priceLog || []).filter((x) => x.d < day).at(-1);
      // c.movedDay: this card's move was already sent today, so a second refresh the same day doesn't repeat it.
      if (prev && prev.p >= 2 && Math.abs(each - prev.p) / prev.p >= 0.25 && Math.abs(each - prev.p) * c.qty >= 2 && c.movedDay !== day) {
        c.movedDay = day;
        moves.push({ name: c.name, set: c.set, qty: c.qty, from: prev.p, to: each, since: prev.d, change: Math.round((each - prev.p) * c.qty * 100) / 100 });
      }
      c.priceLog = [...(c.priceLog || []).filter((x) => x.d !== day), { d: day, p: each }].slice(-21);
    }
  }
  col.refreshedAt = new Date().toISOString();
  save(col);
  moves.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const s = await summary();
  appendJsonl(HISTORY(), { at: new Date().toISOString(), usd: s.valueUsd, cad: s.valueCad, cards: s.cards, unique: s.unique });
  if (moves.length) await alertMoves(moves, s.rate).catch((err) => console.warn(`Card price alert failed: ${err.message}`));
  return { updated: Object.keys(by).length, moves: moves.slice(0, 20), ...s };
}

async function alertMoves(moves, rate) {
  const { sendAlert } = await import("./notify.js");
  const m = (usd) => (rate ? `CA$${(usd * rate).toFixed(2)}` : `US$${usd.toFixed(2)}`);
  const up = moves.filter((x) => x.change > 0).length, down = moves.length - up;
  await sendAlert({
    kind: "card_moves",
    title: `Cards: ${[up && `${up} up`, down && `${down} down`].filter(Boolean).join(", ")}`,
    message: moves.slice(0, 6).map((x) => `${x.change > 0 ? "▲" : "▼"} ${x.name}${x.qty > 1 ? ` ×${x.qty}` : ""}: ${m(x.from)} → ${m(x.to)}`).join("\n") + (moves.length > 6 ? `\nand ${moves.length - 6} more` : ""),
    tags: ["moneybag"],
  });
}

// Once a day from the start-up timer: fresh prices (Scryfall is free and updates daily), so movers and alerts
// keep up without pressing Refresh. Skipped when prices were refreshed in the last 20 hours or there are no cards.
export async function dailyPrices() {
  const col = load();
  if (!col.cards.length && !(await import("./tradeup.js").then((m) => m.hasWants()).catch(() => false))) return null;
  if (col.refreshedAt && Date.now() - Date.parse(col.refreshedAt) < 20 * 3600e3) return null;
  const { withRun } = await import("./runlog.js");
  return withRun("collection prices", { trigger: "auto" }, async (run) => {
    const r = await refreshPrices();
    // Wanted cards too (tradeup.js), for their price targets.
    const w = await import("./tradeup.js").then((m) => m.checkWants()).catch((err) => (run.warn(`Wants: ${err.message}`), null));
    return { result: r, counts: { updated: r.updated, valueCad: r.valueCad, moves: r.moves.length, wants: w?.checked ?? null, wantHits: w?.hits.length ?? null } };
  }, { once: "prices" });
}

async function summary(col = load()) {
  const fx = await usdCad().catch(() => null);
  const valueUsd = col.cards.reduce((t, c) => t + (priceOf(c) || 0) * c.qty, 0);
  const blCards = col.cards.filter((c) => c.store?.facetoface?.retail != null);
  const sum = (k) => Math.round(blCards.reduce((t, c) => t + (c.store.facetoface[k] || 0) * c.qty, 0) * 100) / 100;
  return { cards: col.cards.reduce((t, c) => t + c.qty, 0), unique: col.cards.length, valueUsd: Math.round(valueUsd * 100) / 100, valueCad: fx ? Math.round(valueUsd * fx.rate * 100) / 100 : null, rate: fx?.rate || null,
    buylistStore: blCards.length ? { cards: blCards.reduce((t, c) => t + c.qty, 0), retail: sum("retail"), buylist: sum("buylist"), at: blCards.map((c) => c.store.facetoface.at).sort()[0] } : null };
}

export async function collection() {
  const col = load();
  const history = readJsonl(HISTORY()).slice(-365);
  const s = await summary(col);
  return { ...s, lists: col.lists, cards: col.cards.map(({ priceLog, ...c }) => ({ ...c, each: priceOf(c) })), history, movers: movers(col.cards), pricedAt: col.cards.map((c) => c.pricedAt).sort()[0] || null };
}

// Biggest movers: each card's price now against its price about a week ago (the oldest day kept within the last 8
// days, so it works from the second refresh on), times how many you own. Top 5 up and top 5 down, in USD.
function movers(cards) {
  const since = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
  const rows = cards.map((c) => {
    const log = (c.priceLog || []).filter((x) => x.d >= since);
    if (log.length < 2) return null;
    const from = log[0], to = log[log.length - 1];
    return { id: c.id, name: c.name, set: c.set, qty: c.qty, from: from.p, to: to.p, fromDay: from.d, change: Math.round((to.p - from.p) * c.qty * 100) / 100 };
  }).filter((r) => r && r.change !== 0);
  return { up: rows.filter((r) => r.change > 0).sort((a, b) => b.change - a.change).slice(0, 5), down: rows.filter((r) => r.change < 0).sort((a, b) => a.change - b.change).slice(0, 5), tracked: cards.filter((c) => (c.priceLog || []).length).length };
}

// Name search for the add box: Scryfall autocomplete, then a name's printings to pick from.
export async function searchNames(q) {
  if (String(q || "").trim().length < 2) return [];
  return (await scryfall(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(q)}`))?.data?.slice(0, 12) || [];
}
export async function printingsOf(name) {
  const r = await scryfall(`https://api.scryfall.com/cards/search?unique=prints&order=released&q=${encodeURIComponent(`!"${name}"`)}`);
  return (r?.data || []).slice(0, 60).map(printing);
}

// Store prices from a reprice sheet (e.g. "Collection - Reprice 20.xlsx": a store's NM retail and buylist
// in CA$ for cards worth $20+), saved as { kind: "store-prices", store, at, rows: [{ name, setName, foil,
// exportUsd, match, retail, buylist, check }] }. Matched to collection cards by name + set + foil (closest TCG price
// when several), else by name + foil when that's unambiguous. Kept on the card as c.store[store].
export function importStorePrices(file) {
  const col = load();
  const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const matched = [], missing = [];
  for (const r of file.rows || []) {
    const sameName = col.cards.filter((c) => norm(c.name) === norm(r.name) && (c.finish !== "nonfoil") === !!r.foil);
    let hits = sameName.filter((c) => norm(c.setName) === norm(r.setName));
    if (!hits.length && sameName.length === 1) hits = sameName;
    if (!hits.length) {
      missing.push(`${r.name} (${r.setName}${r.foil ? ", foil" : ""})`);
      continue;
    }
    const c = hits.sort((a, b) => Math.abs((priceOf(a) || 0) - (r.exportUsd || 0)) - Math.abs((priceOf(b) || 0) - (r.exportUsd || 0)))[0];
    c.store = { ...(c.store || {}), [file.store]: { retail: r.retail ?? null, buylist: r.buylist ?? null, match: r.match || "", check: r.check || null, at: file.at } };
    matched.push(c.id);
  }
  save(col);
  return { store: file.store, rows: (file.rows || []).length, matched: matched.length, missing };
}

// Drop-in import: any .csv/.txt/.tsv export put in data/cards/import/ is imported at start-up and moved to
// import/done/, so a file sent in chat can be added without the Import button. A .json store-price file too.
export async function importFolder() {
  const dir = resolvePath("data/cards/import");
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /\.(csv|txt|tsv|json)$/i.test(f));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    if (/\.json$/i.test(f)) {
      const r = importStorePrices(JSON.parse(text));
      fs.mkdirSync(path.join(dir, "done"), { recursive: true });
      fs.renameSync(path.join(dir, f), path.join(dir, "done", f));
      out.push({ file: f, rows: r.rows, matched: r.matched, notFound: r.missing.length, missing: r.missing.slice(0, 20) });
      continue;
    }
    const r = await importCsv(text);
    fs.mkdirSync(path.join(dir, "done"), { recursive: true });
    fs.renameSync(path.join(dir, f), path.join(dir, "done", f));
    out.push({ file: f, rows: r.rows, added: r.added, merged: r.merged, notFound: r.notFound.length });
  }
  return out;
}
