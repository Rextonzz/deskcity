import fs from "node:fs";
import { withPage } from "./studio/browser.js";
import { scryfallApi } from "./scryfall.js";

// Same lookups as References/scripts/tcgplayer_pricing.js. They only work from a tcgplayer.com tab.
const IN_PAGE = `
window.__tcgSearch = async q => {
  const r = await fetch('https://mp-search-api.tcgplayer.com/v1/search/request?q=' + encodeURIComponent(q) + '&isList=false', {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({algorithm: 'sales_dismax', from: 0, size: 50,
      filters: {term: {productLineName: ['magic']}, range: {}, match: {}},
      listingSearch: {context: {cart: {}}, filters: {term: {sellerStatus: 'Live', channelId: 0}, range: {quantity: {gte: 1}}, exclude: {channelExclusion: 0}}},
      context: {cart: {}, shippingCountry: 'US'}, settings: {useFuzzySearch: true, didYouMean: {}}, sort: {}})
  });
  const j = await r.json();
  return j.results[0].results.map(x => ({id: x.productId, n: x.productName, s: x.setName, num: x.customAttributes?.number ?? null}));
};
window.__tcgListings = async (id, printing) => {
  const r = await fetch('https://mp-search-api.tcgplayer.com/v1/product/' + id + '/listings', {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({filters: {term: {sellerStatus: 'Live', channelId: 0, language: ['English'], condition: ['Near Mint'], printing: [printing]},
      range: {quantity: {gte: 1}}, exclude: {channelExclusion: 0}},
      from: 0, size: 50, sort: {field: 'price', order: 'asc'}, context: {shippingCountry: 'US', cart: {}}, aggregations: ['listingType']})
  });
  const j = await r.json();
  const p = j.results[0].results.map(x => x.price).sort((a, b) => a - b);
  return {low: p[0] ?? null, third: p[2] ?? null, last: p.at(-1) ?? null, count: p.length};
};`;

const normNum = (n) => String(n ?? "").toLowerCase().replace(/^[a-z]+-?/, "").replace(/^0+/, "");
const normSet = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const frontName = (n) => String(n ?? "").split(" // ")[0].replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase();
const BASIC = /^(snow-covered )?(plains|island|swamp|mountain|forest|wastes)$/i;
const VARIANT = { borderless: /borderless/i, showcase: /showcase/i, "extended art": /extended art/i, "etched foil": /etched/i };

// Prefer the pack's own set exactly ("Wilds of Eldraine" over "Promo Pack: Wilds of Eldraine"), else any set naming it.
function inPackSet(hits, setName) {
  const exact = hits.filter((h) => normSet(h.s) === normSet(setName));
  return exact.length ? exact : hits.filter((h) => normSet(h.s).includes(normSet(setName)) || normSet(setName).includes(normSet(h.s)));
}

function pick(hits, card) {
  const wantNum = normNum(card.number);
  if (wantNum) {
    let match = hits.filter((h) => normNum(h.num) === wantNum);
    if (match.length > 1) {
      const bySet = inPackSet(match, card.setName);
      if (bySet.length) match = bySet;
    }
    if (match.length > 1) {
      const byName = match.filter((h) => frontName(h.n) === frontName(card.name));
      if (byName.length) match = byName;
    }
    return match;
  }
  // No collector number read: same name in the pack's set, in the right treatment (plain name for regular cards).
  const named = inPackSet(hits.filter((h) => frontName(h.n) === frontName(card.name)), card.setName);
  const word = VARIANT[card.treatment];
  return word ? named.filter((h) => word.test(h.n)) : named.filter((h) => !/\(/.test(h.n));
}

const search = (page, q) => page.evaluate(([q]) => window.__tcgSearch(q), [q]);
// A card's price: the 3rd-cheapest listing, or the dearest when there are fewer than 3.
const listings = (page, id, printing) => page.evaluate(([id, p]) => window.__tcgListings(id, p), [id, printing]).then((l) => ({ ...l, price: l.third ?? l.last }));

// The TCGplayer products for a card: its link's product, else a name search, then (when that leaves no single
// product, and the card has a set name if `needSet`) a second search with the set name, the hits merged.
async function findProduct(page, card, link, needSet) {
  const name = String(card.name).split(" // ")[0];
  let hits = link ? [] : await search(page, name);
  let match = link ? [link] : pick(hits, card);
  if (match.length !== 1 && !link && (!needSet || card.setName)) {
    // Common names (basic lands) bury the right printing, so search again with the set name.
    const more = await search(page, `${name} ${card.setName}`);
    hits = [...hits, ...more.filter((m) => !hits.some((h) => h.id === m.id))];
    match = pick(hits, card);
  }
  return { hits, match };
}

// The collector-number box also takes a link: a TCGplayer product page prices that exact product, and a Scryfall
// card page (or "ONE 339", set code then number) is looked up on Scryfall's free API, which names the TCGplayer product.
export async function resolveLink(text, card = {}) {
  const s = String(text ?? "").trim();
  const tcg = s.match(/tcgplayer\.com\/product\/(\d+)/i);
  if (tcg) return { id: Number(tcg[1]), n: card.name, s: card.setName, num: null, via: "TCGplayer link" };
  const sf = s.match(/scryfall\.com\/card\/([a-z0-9]+)\/([^/?#\s]+)/i) || s.match(/^([a-z0-9]{3,5})\s*[\s#/-]\s*(\d+[a-z★]?)$/i);
  if (!sf) return null;
  const c = await scryfallApi(`https://api.scryfall.com/cards/${encodeURIComponent(sf[1].toLowerCase())}/${encodeURIComponent(decodeURIComponent(sf[2]))}`);
  if (!c) return { error: `Scryfall has no card ${sf[1].toUpperCase()} #${sf[2]}` };
  const id = card.treatment === "etched foil" && c.tcgplayer_etched_id ? c.tcgplayer_etched_id : c.tcgplayer_id;
  if (!id) return { error: `Scryfall's ${c.set_name} #${c.collector_number} has no TCGplayer product` };
  return { id, n: c.name, s: c.set_name, num: c.collector_number, via: "Scryfall link" };
}

// cards: [{name, number, setName, foil}] -> [{...card, productId, productName, productSet, price, priceNote, error}]
export async function priceCards(cards) {
  if (process.env.PIPELINE_FAKE_PRICES) {
    // Test hook: {"Card Name": 1.23} instead of live TCGplayer lookups.
    const prices = JSON.parse(fs.readFileSync(process.env.PIPELINE_FAKE_PRICES, "utf8"));
    return cards.map((c) => (c.name in prices ? { ...c, price: prices[c.name], priceNote: null } : { ...c, error: "no fake price" }));
  }
  return withPage(async (page) => {
    await page.goto("https://www.tcgplayer.com/", { waitUntil: "domcontentloaded" });
    await page.evaluate(IN_PAGE);
    const results = [];
    for (const card of cards) {
      const name = String(card.name).split(" // ")[0];
      const link = await resolveLink(card.number, card).catch((err) => ({ error: `couldn't read that link (${err.message})` }));
      if (link?.error) {
        results.push({ ...card, error: link.error });
        continue;
      }
      let { hits, match } = await findProduct(page, card, link, false);
      const label = card.number ? `#${card.number}` : "that name and treatment";
      // Basic lands: the set has several printings and the number is rarely readable, so price each of the set's
      // printings of that land and use the cheapest (a guess, flagged like the unreadable-foil rule).
      if (match.length !== 1 && BASIC.test(name.trim())) {
        const pool = (match.length ? match : inPackSet(hits.filter((h) => frontName(h.n) === frontName(name)), card.setName)).slice(0, 8);
        const printing = card.foil === "foil" ? "Foil" : "Normal";
        let best = null;
        for (const h of pool) {
          const { price } = await listings(page, h.id, printing);
          if (price !== null && (!best || price < best.price)) best = { h, price };
        }
        if (best) {
          results.push({
            ...card,
            productId: best.h.id,
            productName: best.h.n,
            productSet: best.h.s,
            collector_number: card.collector_number || best.h.num || "",
            price: best.price,
            priceNote: `basic land, collector # not read: priced the cheapest of ${pool.length} ${best.h.s} ${name} printing${pool.length > 1 ? "s" : ""} (${best.h.n}, guess)`,
            error: undefined,
            candidates: undefined,
          });
          continue;
        }
      }
      if (match.length !== 1) {
        results.push({ ...card, error: match.length ? `several TCGplayer products match ${label}` : `no TCGplayer product matches ${label}`, candidates: inPackSet(hits, card.setName).slice(0, 8) });
        continue;
      }
      const product = match[0];
      const printing = card.foil === "foil" ? "Foil" : "Normal";
      let { price, count } = await listings(page, product.id, printing);
      let priceNote = count < 3 ? `only ${count} NM listings` : null;
      if (card.foil === "unknown") {
        // Rule: unreadable foil stamp -> price the cheaper printing and say it's a guess.
        const foil = await listings(page, product.id, "Foil");
        if (foil.price !== null && (price === null || foil.price < price)) price = foil.price;
        priceNote = "foil unreadable - priced the cheaper printing (guess)";
      }
      if (price === null) {
        results.push({ ...card, error: `no Near Mint English ${printing} listings`, productId: product.id });
        continue;
      }
      if (!card.number) priceNote = [priceNote, `matched by name, collector # not read (${product.s} #${product.num})`].filter(Boolean).join("; ");
      if (link) priceNote = [priceNote, `from your ${link.via}${product.num ? ` (${product.s} #${product.num})` : ""}`].filter(Boolean).join("; ");
      results.push({
        ...card,
        productId: product.id,
        productName: product.n,
        productSet: product.s,
        collector_number: link ? product.num || "" : card.collector_number || product.num || "",
        number: link ? product.num || card.number : card.number,
        price,
        priceNote,
        error: undefined,
        candidates: undefined,
      });
    }
    return results;
  });
}

// One card for the dashboard lookup: the cheapest and 3rd-cheapest Near Mint English listing, in USD.
// card: {name, setName, number, foil: "foil" | "nonfoil" | "unknown", treatment}
export async function lookupTcg(card) {
  return withPage(async (page) => {
    await page.goto("https://www.tcgplayer.com/", { waitUntil: "domcontentloaded" });
    await page.evaluate(IN_PAGE);
    const link = await resolveLink(card.number, card);
    if (link?.error) return { error: link.error };
    let { hits, match } = await findProduct(page, card, link, true);
    if (!match.length) match = hits.filter((h) => frontName(h.n) === frontName(card.name)).slice(0, 1);
    if (!match.length) return { error: "No TCGplayer product with that name." };
    const product = match[0];
    const out = { product: product.n, set: product.s, number: product.num, url: `https://www.tcgplayer.com/product/${product.id}`, note: match.length > 1 ? `${match.length} printings match; showing ${product.s}` : null };
    const want = card.foil === "foil" ? ["Foil"] : card.foil === "nonfoil" ? ["Normal"] : ["Normal", "Foil"];
    out.printings = {};
    for (const p of want) {
      const { low, third, count } = await page.evaluate(([id, pr]) => window.__tcgListings(id, pr), [product.id, p]);
      out.printings[p === "Foil" ? "foil" : "nonfoil"] = { low, third, count };
    }
    return out;
  });
}
