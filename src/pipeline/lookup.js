// Single-card price check for the dashboard: read a card from a photo, then price it on TCGplayer (USD),
// the local shop and the buy-list shop (both CAD). Store lookups run in the pipeline's Chrome, from a page on each store's
// own site, like the TCGplayer pricing does.
import { newPage } from "./studio/browser.js";
import { resolvePath, writeJsonAtomic } from "./util.js";
import { lookupTcg } from "./tcgplayer.js";
import { askJSON, obj, arr, str, num, oneOf, bool } from "./claude.js";
import { usdCad } from "./fx.js";
import { townsPattern, cardStores } from "../hub/settings.js";

export async function readCardPhoto(base64, mediaType = "image/jpeg") {
  return askJSON({
    name: "card_lookup_read",
    effort: "medium",
    system: `You read Magic: The Gathering cards from phone photos so they can be priced.
Give the exact English card name (front face only for double-faced cards), the set name and set code, the collector number from the bottom line, foil (★ on the bottom line = foil, • = nonfoil, "unknown" if unreadable), and the treatment.
Never guess a collector number: leave it empty if you can't read it. If there's no Magic card in the photo, set is_card to false.`,
    content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      { type: "text", text: "Read this card." },
    ],
    schema: obj({
      is_card: bool,
      name: str,
      set_name: str,
      set_code: str,
      collector_number: str,
      foil: oneOf("foil", "nonfoil", "unknown"),
      treatment: oneOf("regular", "borderless", "showcase", "extended art", "etched foil", "other"),
      confidence: oneOf("high", "medium", "low"),
    }),
  });
}

// Many cards in one photo (a binder page, a trade pile laid out on a table). Each card comes back with where it sits,
// so the review list can be read in the same order as the photo. Same rules as one card: never guess a number.
export async function readCardsPhoto(base64, mediaType = "image/jpeg") {
  const r = await askJSON({
    name: "card_photo_multi",
    effort: "medium",
    system: `You read every Magic: The Gathering card in a phone photo (cards laid out on a table, a binder page, a hand of cards) so they can be added to a collection or valued for a trade.
For each card you can see, give the exact English card name (front face only for double-faced cards), the set name and set code, the collector number from the bottom line, foil (★ on the bottom line = foil, • = nonfoil, "unknown" if unreadable), the treatment, and where it is (row and column counted from the top left, 1-based).
Count each physical card once. If two copies of the same card are visible, list both. Never guess a collector number: leave it empty if you can't read it. Skip anything that isn't a Magic card (tokens are fine, list them). If a card is too covered or blurry to name, list it with name "" and confidence low so the person knows one was missed.`,
    content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      { type: "text", text: "Read every card in this photo." },
    ],
    schema: obj({
      cards: arr(
        obj({
          name: str,
          set_name: str,
          set_code: str,
          collector_number: str,
          foil: oneOf("foil", "nonfoil", "unknown"),
          treatment: oneOf("regular", "borderless", "showcase", "extended art", "etched foil", "other"),
          row: num,
          column: num,
          confidence: oneOf("high", "medium", "low"),
        }),
      ),
      unreadable: num,
    }),
  });
  const cards = (r.cards || []).sort((a, b) => (a.row - b.row) || (a.column - b.column));
  return { cards: cards.filter((c) => c.name), unreadable: (r.unreadable || 0) + cards.filter((c) => !c.name).length };
}

const norm = (s) => String(s ?? "").toLowerCase().split(" // ")[0].replace(/\s+[-(\[].*$/, "").replace(/[^a-z0-9]/g, "");

// a local store runs Crystal Commerce: search Magic singles in stock, then read each product page's stock rows,
// e.g. "the owner's town: NM, English, 2 In stock CAD$ 5.51". Rows with "In Stock" (capital S) belong to related products.
async function shopStock(page, card, base) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  return page.evaluate(async ({ name, want, towns }) => {
    const norm = (s) => String(s ?? "").toLowerCase().split(" // ")[0].replace(/\s+[-(\[].*$/, "").replace(/[^a-z0-9]/g, "");
    const q = new URLSearchParams({ utf8: "✓", "search[fuzzy_search]": name, "search[in_stock]": "1", "search[category_ids_with_descendants][]": "8", per_page: "50", commit: "Search" });
    const html = await (await fetch("/advanced_search?" + q)).text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const products = [...doc.querySelectorAll("li.product")].map((li) => ({
      name: li.querySelector("h4.name")?.textContent.trim(),
      set: li.querySelector(".category")?.textContent.trim(),
      url: li.querySelector("a")?.getAttribute("href"),
    })).filter((p) => p.url && norm(p.name) === want).slice(0, 8);
    const out = [];
    for (const p of products) {
      const page = new DOMParser().parseFromString(await (await fetch(p.url)).text(), "text/html");
      for (const row of page.querySelectorAll(".variant-row")) {
        const t = row.textContent.replace(/\s+/g, " ").trim();
        const m = t.match(new RegExp(`^(${towns}): ([^,]+), (\\w+),? (\\d+) In stock CAD\\$ ?([\\d,]+\\.\\d\\d)`));
        if (m) out.push({ name: p.name, set: p.set, store: m[1], condition: m[2], language: m[3], qty: Number(m[4]), price: Number(m[5].replace(/,/g, "")), foil: /foil/i.test(`${p.name} ${p.set}`), url: new URL(p.url, location.origin).href });
      }
    }
    return { rows: out, searched: products.length };
  }, { name: String(card.name).split(" // ")[0], want: norm(card.name), towns: townsPattern() });
}

// a local store runs on Shopify: product search, then each product's .js record for variant prices (in cents)
// and availability. Variant titles carry condition, language and finish, e.g. "NM / English / Foil".
async function buylistStock(page, card, base) {
  await settle(page, base);
  return evaluateRetry(page, async ({ name, want }) => {
    const norm = (s) => String(s ?? "").toLowerCase().split(" // ")[0].replace(/\s+[-(\[].*$/, "").replace(/[^a-z0-9]/g, "");
    const q = new URLSearchParams({ q: name, "resources[type]": "product", "resources[limit]": "10" });
    const res = await fetch("/search/suggest.json?" + q);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    if (!res.ok || !json)
      return {
        error: `search on ${location.host} answered ${res.status}${json ? "" : " with a web page, not data"}`,
        debug: {
          url: location.href,
          title: document.title,
          status: res.status,
          body: text.slice(0, 1500),
          page: document.body?.innerText.slice(0, 1500),
        },
      };
    const found = json.resources?.results?.products || [];
    const products = found.filter((p) => norm(p.title) === want).slice(0, 6);
    const out = [];
    for (const p of products) {
      const r = await fetch(`/products/${p.handle}.js`);
      if (!r.ok) continue;
      const prod = await r.json();
      for (const v of prod.variants || []) {
        if (!v.available) continue;
        out.push({ name: prod.title, set: prod.vendor || prod.type || "", variant: v.title, price: v.price / 100, foil: /foil/i.test(`${v.title} ${prod.title}`), url: new URL(`/products/${p.handle}?variant=${v.id}`, location.origin).href });
      }
    }
    return { rows: out, searched: products.length, found: found.length };
  }, { name: String(card.name).split(" // ")[0], want: norm(card.name) });
}

// Waits out redirects and "checking your browser" pages after opening a store's site.
async function settle(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
}

// Runs code in the page, again on the page it ends up on if the site navigates away mid-run.
async function evaluateRetry(page, fn, arg) {
  for (let i = 0; ; i++) {
    try {
      return await page.evaluate(fn, arg);
    } catch (err) {
      if (i >= 2 || !/context was destroyed|navigation/i.test(err.message)) throw err;
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    }
  }
}

// What the store's page looked like when a lookup failed, for tuning (data/lookup-debug).
function saveDebug(store, info) {
  try {
    writeJsonAtomic(resolvePath(`data/lookup-debug/${store}.json`), { at: new Date().toISOString(), ...info });
  } catch {}
}

async function onPage(fn, card, base, notSetUp, open) {
  if (!base) return { error: notSetUp }; // no web address in the settings: nothing is opened
  const page = await open();
  try {
    const out = await fn(page, card, base);
    if (out?.debug) saveDebug(fn.name, out.debug);
    delete out?.debug;
    return out;
  } catch (err) {
    saveDebug(fn.name, { url: page.url(), title: await page.title().catch(() => ""), error: err.message, page: await page.evaluate(() => document.body?.innerText.slice(0, 1500)).catch(() => "") });
    return { error: err.message.split("\n")[0] };
  } finally {
    await page.close();
  }
}

const bySet = (rows, setName) => {
  const s = norm(setName);
  return [...rows].sort((a, b) => (norm(b.set).includes(s) - norm(a.set).includes(s)) || a.price - b.price);
};

// card: {name, setName, number, foil, treatment}
// The two stores' stock for a card ({ shop, buylist }). A store with no web address in the settings answers "not set up"
// and nothing is opened for it. open: how a page is made (a test passes a stand-in).
export async function storeStock(card, { stores = cardStores(), open = newPage } = {}) {
  const [shop, buylist] = await Promise.all([
    onPage(shopStock, card, stores.shopUrl, `${stores.shop} is not set up: add its web address to the settings (cards.stores.shopUrl).`, open),
    onPage(buylistStock, card, stores.buylistUrl, `${stores.buylist} is not set up: add its web address to the settings (cards.stores.buylistUrl).`, open),
  ]);
  if (shop.rows) shop.rows = bySet(shop.rows, card.setName);
  if (buylist.rows) buylist.rows = bySet(buylist.rows, card.setName);
  return { shop, buylist };
}

export async function lookupCard(card) {
  const [tcg, stock] = await Promise.all([
    lookupTcg(card).catch((err) => ({ error: err.message.split("\n")[0] })),
    storeStock(card),
  ]);
  return { tcg, ...stock, fx: await usdCad() };
}
