// Trades (the owner 2026-10-19): the cards going out and the cards coming in, by photo (many cards per photo), by name,
// or picked from the collection. Each side is valued at Scryfall's TCGplayer price (USD, shown in CAD at the Bank of
// Canada rate) plus the buy list store's retail/buylist where the reprice sheet has the card, so it's easy to see if the
// trade is fair. Confirm takes the out cards off the collection and adds the in cards (list "Traded in");
// Undo puts it all back. Kept in data/cards/trades.json. Read-only toward stores: nothing here buys or sells.
import { readJson, writeJsonAtomic, resolvePath, newId } from "./util.js";
import { usdCad } from "./fx.js";
import { cardStores } from "../hub/settings.js";
import { resolveMany, priceOf, addCards, takeCards, putBack, removeAdded, collectionCards } from "./collection.js";

const FILE = () => resolvePath("data/cards/trades.json");
const SIDES = ["out", "in"];
const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];
const FINISHES = ["nonfoil", "foil", "etched"];

function load() { return readJson(FILE(), { trades: [] }); }
function save(d) { writeJsonAtomic(FILE(), d, 1); }
const round = (n) => Math.round(n * 100) / 100;
const side = (s) => {
  if (!SIDES.includes(s)) throw new Error("Pick cards out or cards in.");
  return s;
};
function find(d, id) {
  const t = d.trades.find((x) => x.id === id);
  if (!t) throw new Error("That trade isn't there any more.");
  return t;
}
const draft = (t) => {
  if (t.status !== "draft") throw new Error("That trade is done. Undo it first to change it.");
  return t;
};

// How each side is priced (the owner 2026-10-19: "I'd like to choose how it prices"). source: tcg (TCGplayer via Scryfall,
// in CAD), <key>_retail or <key>_buylist (the buy list store's reprice sheet; cards it doesn't have fall back to TCGplayer and
// are marked), percent of that price (e.g. 80 = trading at 80%). A typed price on one card beats all of it.
// (the buy list shop is named in the settings, "cards.stores")
// The ids a trade saves are "<the buy list's short name>_retail" and "..._buylist" (settings' cards.stores.buylistShort; "buy_list_retail" on a new hub).
const priceSources = () => { const s = cardStores(); return { tcg: "TCGplayer", [`${s.buylistKey}_retail`]: `${s.buylist} retail`, [`${s.buylistKey}_buylist`]: `${s.buylist} buylist` }; };
// read through the settings each time, so a changed setting shows without a restart
export const PRICE_SOURCES = new Proxy({}, {
  get: (_, k) => priceSources()[k],
  has: (_, k) => k in priceSources(),
  ownKeys: () => Reflect.ownKeys(priceSources()),
  getOwnPropertyDescriptor: (_, k) => { const d = Object.getOwnPropertyDescriptor(priceSources(), k); return d && { ...d, configurable: true }; },
});
const cleanPricing = (p = {}) => ({ source: PRICE_SOURCES[p.source] ? p.source : "tcg", percent: Math.max(10, Math.min(200, Math.round(Number(p.percent) || 100))) });
function pricingOf(t) {
  const p = t.pricing || {};
  return { out: cleanPricing(p.out), in: cleanPricing(p.in) };
}

// A trade with every card valued, owned counts for the out side, and both totals.
async function view(t, cards = collectionCards()) {
  const fx = await usdCad().catch(() => null);
  const cad = (usd) => (fx && usd != null ? round(usd * fx.rate) : null);
  const sideView = (items, s) => {
    const pr = pricingOf(t)[s];
    const rows = items.map((it) => {
      const each = priceOf(it);
      // The buy list store's prices come from the reprice sheet, stored on the collection copy (in cards too, when you own one).
      const own = cards.find((c) => c.id === it.collectionId) || cards.find((c) => c.scryfallId === it.scryfallId && c.finish === it.finish);
      const bl = own?.store?.facetoface || null;
      const key = cardStores().buylistKey;
      const base = { tcg: cad(each), [`${key}_retail`]: bl?.retail ?? null, [`${key}_buylist`]: bl?.buylist ?? null };
      let used = base[pr.source], basis = pr.source;
      if (used == null && pr.source !== "tcg") (used = base.tcg), (basis = "tcg");
      let eachCad = used != null ? round((used * pr.percent) / 100) : null;
      if (it.manualCad != null) (eachCad = it.manualCad), (basis = "manual");
      return {
        ...it,
        each,
        eachCad,
        basis,
        totalCad: eachCad != null ? round(eachCad * it.qty) : null,
        totalUsd: each != null ? round(each * it.qty) : null,
        owned: s === "out" ? own?.qty || 0 : undefined,
        collectionId: s === "out" ? own?.id || it.collectionId || null : undefined,
        buylistPrice: bl ? { retail: bl.retail, buylist: bl.buylist } : null,
        tcgCad: base.tcg,
      };
    });
    const usd = round(rows.reduce((a, r) => a + (r.totalUsd || 0), 0));
    const cadTotal = round(rows.reduce((a, r) => a + (r.totalCad || 0), 0));
    return {
      rows,
      usd,
      cad: fx || rows.every((r) => r.basis === "manual" || r.basis.startsWith(cardStores().buylistKey)) ? cadTotal : null,
      cards: rows.reduce((a, r) => a + r.qty, 0),
      unpriced: rows.filter((r) => r.eachCad == null).length,
      fellBack: pr.source === "tcg" ? 0 : rows.filter((r) => r.basis === "tcg").length,
      pricing: pr,
    };
  };
  const out = sideView(t.out, "out"), inn = sideView(t.in, "in");
  const cashCad = Number(t.cash?.cad) || 0;
  // From the owner's side: value in (cards + cash received) minus value out (cards + cash paid).
  const cashIn = t.cash?.way === "in" ? cashCad : 0, cashOut = t.cash?.way === "out" ? cashCad : 0;
  const net = inn.cad != null && out.cad != null ? round(inn.cad + cashIn - out.cad - cashOut) : null;
  const bigger = Math.max(out.cad || 0, inn.cad || 0) || 1;
  const verdict =
    net == null
      ? "No exchange rate yet"
      : Math.abs(net) <= Math.max(2, bigger * 0.1)
        ? "Fair (within 10%)"
        : net > 0
          ? `You come out ahead by about CA$${Math.abs(net).toFixed(2)}`
          : `You give up about CA$${Math.abs(net).toFixed(2)} more than you get`;
  const missing = out.rows.filter((r) => r.owned < r.qty).map((r) => `${r.name} (have ${r.owned}, trade gives ${r.qty})`);
  return { ...t, pricing: pricingOf(t), out, in: inn, net, verdict, rate: fx?.rate || null, missing };
}

export async function listTrades() {
  const d = load();
  const cards = collectionCards();
  const trades = [];
  for (const t of d.trades.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50)) trades.push(await view(t, cards));
  return { trades };
}

export async function newTrade({ partner = "", note = "" } = {}) {
  const d = load();
  const t = { id: newId(), createdAt: new Date().toISOString(), status: "draft", partner: String(partner).slice(0, 80), note: String(note).slice(0, 500), cash: { cad: 0, way: "none" }, out: [], in: [] };
  d.trades.push(t);
  save(d);
  return view(t);
}

export async function editTrade(id, patch = {}) {
  const d = load();
  const t = draft(find(d, id));
  if (patch.partner != null) t.partner = String(patch.partner).slice(0, 80);
  if (patch.note != null) t.note = String(patch.note).slice(0, 500);
  if (patch.pricing) {
    const cur = pricingOf(t);
    t.pricing = { out: cleanPricing({ ...cur.out, ...(patch.pricing.out || patch.pricing.both || {}) }), in: cleanPricing({ ...cur.in, ...(patch.pricing.in || patch.pricing.both || {}) }) };
  }
  if (patch.cash) {
    const c = Number(patch.cash.cad);
    t.cash = { cad: Number.isFinite(c) && c > 0 ? round(Math.min(c, 100000)) : 0, way: ["in", "out"].includes(patch.cash.way) ? patch.cash.way : "none" };
  }
  save(d);
  return view(t);
}

// wanted: [{ name, set, number, finish|foil, condition, qty }] from a photo read or the name search.
export async function addItems(id, s, wanted, { source = "manual" } = {}) {
  side(s);
  if (!Array.isArray(wanted) || !wanted.length) throw new Error("No cards to add.");
  const found = await resolveMany(wanted.slice(0, 120));
  const d = load();
  const t = draft(find(d, id));
  const cards = collectionCards();
  const res = { added: 0, notFound: [], guessed: [] };
  wanted.slice(0, 120).forEach((w, i) => {
    const p = found[i];
    if (!p) return res.notFound.push(w.name || `${w.set} #${w.number}`);
    if (p.guessed) res.guessed.push(`${w.name} -> ${p.name} (${p.set.toUpperCase()} #${p.number})`);
    const f = String(w.finish ?? w.foil ?? "").toLowerCase();
    let finish = /etched/.test(f) ? "etched" : /^(foil|yes|true)$/.test(f) ? "foil" : "nonfoil";
    if (p.finishes?.length && !p.finishes.includes(finish)) finish = p.finishes[0];
    const qty = Math.max(1, Math.min(99, Math.round(Number(w.qty) || 1)));
    const condition = CONDITIONS.includes(w.condition) ? w.condition : "NM";
    // Out side: tie it to the copy in the collection (same printing + finish, else same name).
    const own = s === "out" ? cards.find((c) => c.scryfallId === p.scryfallId && c.finish === finish) || cards.find((c) => c.name === p.name) : null;
    const item = {
      key: newId(),
      scryfallId: own?.scryfallId || p.scryfallId,
      name: p.name,
      set: own?.set || p.set,
      setName: own?.setName || p.setName,
      number: own?.number || p.number,
      finishes: p.finishes,
      finish: own?.finish || finish,
      condition: own?.condition || condition,
      qty,
      image: own?.image || p.image,
      prices: own?.prices || p.prices,
      source,
      ...(s === "out" ? { collectionId: own?.id || null } : {}),
    };
    const same = t[s].find((x) => x.scryfallId === item.scryfallId && x.finish === item.finish && x.condition === item.condition);
    if (same) same.qty += qty;
    else t[s].push(item);
    res.added += qty;
  });
  save(d);
  return { ...res, trade: await view(t) };
}

// Out side, straight from the collection list.
export async function addFromCollection(id, cardId, qty = 1) {
  const c = collectionCards().find((x) => x.id === cardId);
  if (!c) throw new Error("That card isn't in the collection.");
  const d = load();
  const t = draft(find(d, id));
  const q = Math.max(1, Math.min(c.qty, Math.round(Number(qty) || 1)));
  const same = t.out.find((x) => x.collectionId === c.id);
  if (same) same.qty = Math.min(c.qty, same.qty + q);
  else
    t.out.push({
      key: newId(),
      scryfallId: c.scryfallId,
      name: c.name,
      set: c.set,
      setName: c.setName,
      number: c.number,
      finishes: c.finishes,
      finish: c.finish,
      condition: c.condition,
      qty: q,
      image: c.image,
      prices: c.prices,
      source: "collection",
      collectionId: c.id,
    });
  save(d);
  return view(t);
}

export async function editItem(id, s, key, patch = {}) {
  side(s);
  const d = load();
  const t = draft(find(d, id));
  const it = t[s].find((x) => x.key === key);
  if (!it) throw new Error("That card isn't in the trade.");
  if (patch.qty != null) {
    const q = Math.round(Number(patch.qty));
    if (!Number.isFinite(q) || q < 0 || q > 99) throw new Error("Quantity must be 0 to 99.");
    if (q === 0) t[s] = t[s].filter((x) => x.key !== key);
    else it.qty = q;
  }
  if (patch.manualCad !== undefined) {
    const m = patch.manualCad === "" || patch.manualCad == null ? null : Number(patch.manualCad);
    if (m != null && (!Number.isFinite(m) || m < 0 || m > 100000)) throw new Error("Type a price in CA$, or clear it.");
    it.manualCad = m == null ? null : round(m);
  }
  if (patch.condition && CONDITIONS.includes(patch.condition)) it.condition = patch.condition;
  if (patch.finish && FINISHES.includes(patch.finish) && (!it.finishes?.length || it.finishes.includes(patch.finish))) it.finish = patch.finish;
  save(d);
  return view(t);
}

// Out cards leave the collection, in cards join it (list "Traded in"). All or nothing: if any out card is short,
// nothing changes. What was changed is saved on the trade so Undo can reverse it exactly.
// One confirm at a time per trade (code review 2026-10-22): a third tap while the first was still pricing used to
// apply the trade twice, and Undo only reversed one of them.
const confirming = new Set();
export async function confirmTrade(id) {
  if (confirming.has(id)) throw new Error("That trade is already being confirmed. Give it a moment.");
  confirming.add(id);
  try {
    return await confirmOnce(id);
  } finally {
    confirming.delete(id);
  }
}
async function confirmOnce(id) {
  const t = draft(find(load(), id));
  if (!t.out.length && !t.in.length) throw new Error("The trade has no cards yet.");
  const v = await view(t);
  const unowned = v.out.rows.filter((r) => !r.collectionId);
  if (unowned.length) throw new Error(`Not in your collection: ${unowned.map((r) => r.name).join(", ")}. Add them first or remove them from the trade.`);
  const taken = takeCards(v.out.rows.map((r) => ({ id: r.collectionId, qty: r.qty, name: r.name })));
  let added;
  try {
    added = t.in.length ? await addCards(t.in.map((it) => ({ scryfallId: it.scryfallId, finish: it.finish, condition: it.condition, qty: it.qty, lists: ["Traded in"] })), { source: "trade" }) : { ids: [] };
  } catch (err) {
    putBack(taken);
    throw err;
  }
  // Re-read before saving, so an edit to another trade made during the lookups isn't lost.
  const d = load();
  const now = find(d, id);
  now.status = "done";
  now.doneAt = new Date().toISOString();
  now.applied = { taken, added: added.ids.map(({ id: cid, qty }) => ({ id: cid, qty })) };
  now.valueAtTrade = { outCad: v.out.cad, inCad: v.in.cad, outUsd: v.out.usd, inUsd: v.in.usd, rate: v.rate, net: v.net, pricing: v.pricing };
  save(d);
  return view(now);
}

export async function undoTrade(id) {
  const d = load();
  const t = find(d, id);
  if (t.status !== "done" || !t.applied) throw new Error("Only a done trade can be undone.");
  removeAdded(t.applied.added || []);
  putBack(t.applied.taken || []);
  t.status = "draft";
  delete t.applied;
  delete t.doneAt;
  save(d);
  return view(t);
}

export function deleteTrade(id) {
  const d = load();
  draft(find(d, id));
  d.trades = d.trades.filter((x) => x.id !== id);
  save(d);
  return { ok: true };
}
