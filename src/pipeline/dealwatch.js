// Damaged-card deal watch: every damaged Magic single in stock at the local shop's towns, compared with its
// Near Mint price (the shop's own, or the buy-list shop's when the shop has none), plus the owner's deck cards,
// still-needed cards and nicer-art upgrade wishlist. Runs daily in the pipeline's Chrome and from the Deal watch page.
// Read-only: it never adds to a cart or buys anything. All prices CAD.
import { startRun } from "./runlog.js";
import { cell } from "./exports.js";
import { scryfallApi } from "./scryfall.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { newPage } from "./studio/browser.js";
import { sendAlert, dashboardLink } from "./notify.js";
import { dueAt, resolvePath, run, pythonCmd, readJson, writeJsonAtomic, sleep } from "./util.js";
import { cardStores, townsPattern, storeUrl, dealWatchSettings } from "../hub/settings.js";

const DIR = () => resolvePath("data/cards");
const CONFIG = () => path.join(DIR(), "watch.json");
const LATEST = () => path.join(DIR(), "dmg-latest.json");
const HISTORY = () => path.join(DIR(), "dmg-history");

// The deck, upgrade picks and still-to-buy cards come from the deck spreadsheet (petDeckPath) when it's there. The lists
// in the settings ("cards.dealWatch": see dealWatchSettings) are only the fallback; a new hub has none, and the page says
// "No deck set up yet".
const HOME = os.homedir().replace(/\\/g, "/"); // this PC's user folder, forward slashes
// (the towns and the shop's name come from the settings, "cards.stores": see watchConfig)
const DEFAULTS = { petDeckPath: "", bigCardNm: 50, hour: 8, minute: 45, enabled: false /* the page has a switch for every morning */, petDeck: [], needed: [], wishlist: [] };
// "{home}" and "{shop}" in a settings path; a blank path stays blank
const expand = (p) => String(p || "").replace(/\{home\}/g, HOME).replace(/\{shop\}/g, cardStores().shop);

export const watchConfig = () => {
  const w = dealWatchSettings();
  return { ...DEFAULTS, petDeckPath: expand(w.petDeckPath), petDeck: w.petDeck, needed: w.needed, wishlist: w.wishlist, stores: [...cardStores().towns], csvPath: expand(w.csvPath), ...readJson(CONFIG(), {}) };
};
export function saveWatchConfig(patch) {
  const allowed = ["bigCardNm", "petDeck", "needed", "wishlist", "csvPath", "petDeckPath", "enabled"];
  const cur = readJson(CONFIG(), {});
  for (const k of allowed) if (k in patch) cur[k] = patch[k];
  writeJsonAtomic(CONFIG(), cur);
  return watchConfig();
}
export const lastScan = () => readJson(LATEST(), null);

const norm = (s) => String(s ?? "").toLowerCase().split(" // ")[0].replace(/\s*[(\[].*$/, "").replace(/[^a-z0-9]/g, "");
const SET_ALIASES = { "3rdedition": "revisededition", revised: "revisededition", "4thedition": "fourthedition", "5thedition": "fifthedition" };
const setKey = (s) => {
  const k = String(s ?? "").toLowerCase().replace(/^magic( the gathering)?\s*[-:]?\s*/, "").replace(/[^a-z0-9]/g, "");
  return SET_ALIASES[k] || k;
};
const sameSet = (a, b) => {
  const x = setKey(a), y = setKey(b);
  return Boolean(x && y && (x === y || x.includes(y) || y.includes(x)));
};
const isFoil = (s) => /\bfoil\b/i.test(String(s)) && !/non-?foil/i.test(String(s));
export const parseWish = (line) => {
  const [name, set, number, finish, target] = String(line).split("|").map((s) => s.trim());
  return name ? { name, setName: set || "", number: number || "", foil: /^foil/i.test(finish || ""), target: Number(target) || null } : null;
};

// Set codes (SLD, ELD...) to the full names stores use, from Scryfall's set list, cached for a month.
// KNOWN covers the codes in the owner's sheet in case Scryfall can't be reached.
const KNOWN = {
  ELD: "Throne of Eldraine",
  SLD: "Secret Lair Drop",
  AFR: "Adventures in the Forgotten Realms",
  SPG: "Special Guests",
  SS3: "Signature Spellbook: Chandra",
  PW23: "Wizards Play Network 2023",
  FDN: "Foundations",
  LTC: "Tales of Middle-earth Commander",
  NEO: "Kamigawa: Neon Dynasty",
  SLC: "Secret Lair 30th Anniversary Countdown Kit",
  ZNR: "Zendikar Rising",
  CMR: "Commander Legends",
  "2X2": "Double Masters 2022",
  CMM: "Commander Masters",
  DOM: "Dominaria",
  BRR: "The Brothers' War Retro Artifacts",
  PIP: "Fallout",
};
async function setNames() {
  return { ...KNOWN, ...(await scryfallSets()) };
}
async function scryfallSets() {
  const file = path.join(DIR(), "scryfall-sets.json");
  const cached = readJson(file, null);
  if (cached && Date.now() - cached.at < 30 * 864e5) return cached.names;
  try {
    const j = await scryfallApi("https://api.scryfall.com/sets");
    const names = Object.fromEntries(j.data.map((x) => [x.code.toUpperCase(), x.name]));
    writeJsonAtomic(file, { at: Date.now(), names }, 0);
    return names;
  } catch {
    return cached?.names || {};
  }
}

// { source, petDeck: [names], deck: [cards], wishlist: [{ name, setName, setCode, number, foil, target, image }], needed: [{ name, printings }] }
export async function watchLists(cfg = watchConfig()) {
  const sheet = cfg.petDeckPath && fs.existsSync(cfg.petDeckPath) ? cfg.petDeckPath : null;
  if (sheet) {
    try {
      const d = JSON.parse((await run(pythonCmd(), [resolvePath("python/petdeck.py"), sheet])).stdout.toString());
      const names = await setNames();
      return {
        source: path.basename(sheet),
        petDeck: [...new Set(d.deck.map((c) => c.name))],
        deck: d.deck,
        wishlist: d.wishlist.map((w) => ({ ...w, setName: names[w.setCode.toUpperCase()] || w.setCode })),
        needed: d.needed,
      };
    } catch (err) {
      (scanState.running ? scanLog.warn : console.warn)(`Deal watch: couldn't read ${sheet}: ${err.message}`);
    }
  }
  return { source: null, petDeck: cfg.petDeck, deck: [], wishlist: cfg.wishlist.map(parseWish).filter(Boolean), needed: cfg.needed.map((name) => ({ name, printings: [] })) };
}

// Card+set+store keys from the last CSV the old scheduled task wrote, so the first scan here can still mark NEW.
function csvKeys(file) {
  try {
    const rows = fs.readFileSync(file, "utf8").split(/\r?\n/).slice(1).filter(Boolean);
    return new Set(rows.map((line) => {
      const cells = [];
      let cur = "", q = false;
      for (const ch of line) {
        if (ch === '"') q = !q;
        else if (ch === "," && !q) cells.push(cur), (cur = "");
        else cur += ch;
      }
      cells.push(cur);
      return `${cells[1]}|${cells[2]}|${cells[3]}|Dmg`;
    }));
  } catch {
    return null;
  }
}

export const scanState = { running: false, phase: null, done: 0, total: 0, startedAt: null, error: null };
export const scanStatus = () => ({ ...scanState, typicalMs: readJson(path.join(DIR(), "scan-time.json"), {}).ms || null, last: scanState.running ? null : summary(lastScan()) });
const summary = (s) => s && { at: s.at, error: s.error, items: s.items?.length ?? 0, deals: s.deals?.length ?? 0, newDeals: s.deals?.filter((d) => d.isNew).length ?? 0, ms: s.ms };

// Reads one a local store product page: its own stock rows (condition, language, qty, price), NM price, card type.
// "In Stock" with a capital S marks related products further down the page, which are skipped.
async function readProduct(page, url) {
  return page.evaluate(async ({ url, towns }) => {
    const html = await (await fetch(url)).text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const rows = [];
    for (const row of doc.querySelectorAll(".variant-row")) {
      const t = row.textContent.replace(/\s+/g, " ").trim();
      if (/In Stock/.test(t)) continue;
      const m = t.match(new RegExp(`^(${towns}): (NM|LP|MP|HP|Dmg),? (\\w+),? (?:(\\d+) In stock)?.*?CAD\\$ ?([\\d,]+\\.\\d\\d)`));
      if (m) rows.push({ store: m[1], condition: m[2], language: m[3], qty: Number(m[4] || 0), price: Number(m[5].replace(/,/g, "")) });
    }
    const type = html.match(/<div class="card-type">\s*<strong>Card Type:<\/strong>\s*<a[^>]*>([^<]*)<\/a>/)?.[1]?.trim() || "";
    return { rows, type };
  }, { url, towns: townsPattern() });
}

// One page of search results: [{ name, set, url }].
async function readListing(page, query) {
  return page.evaluate(async (query) => {
    const html = await (await fetch(query)).text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    return [...doc.querySelectorAll("li.product")].map((li) => ({
      name: li.querySelector("h4.name")?.textContent.trim() || "",
      set: li.querySelector(".category")?.textContent.trim() || "",
      url: new URL(li.querySelector("a")?.getAttribute("href") || "", location.origin).href,
    }));
  }, query);
}

function dmgQuery(stores, n) {
  const q = new URLSearchParams({
    utf8: "✓",
    "search[fuzzy_search]": "",
    "search[in_stock]": "1",
    "search[category_ids_with_descendants][]": "8",
    "search[sort]": "sell_price",
    "search[direction]": "descend",
    per_page: "100",
    commit: "Search",
    page: String(n),
  });
  for (const s of stores) q.append("search[variants_with_identifier][14][]", `${s}: Dmg`);
  return "/advanced_search?" + q;
}

// a local store NM price for one card, matched on name (in the title, since alt arts lead with a flavour name),
// foil, and set. Single scanned copies ("ID 12345") are skipped.
async function buylistNm(page, card) {
  return page.evaluate(async ({ name, foil, set }) => {
    const n = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const want = n(name.split(" // ")[0]);
    const hits = [];
    for (let p = 1; p <= 3; p++) {
      const r = await fetch(`/apps/prod-indexer/search/pageSize/96/page/${p}/keyword/${encodeURIComponent(encodeURIComponent(name.split(" // ")[0]))}/withFacets/false`);
      if (!r.ok) break;
      const j = await r.json();
      const list = j.hits?.hits || [];
      hits.push(...list.map((h) => h._source));
      if (list.length < 96) break;
    }
    return hits
      .filter((h) => n(h.title).includes(want) && !/ ID \d+/.test(h.title || "") && (h.MTG_Foil_Option === "Foil") === foil)
      .map((h) => ({ title: h.title, set: h.MTG_Set_Name, price: (h.variants || []).find((v) => (v.selectedOptions || []).some((o) => o.value === "NM"))?.price, handle: h.handle }))
      .filter((h) => h.price != null)
      .map((h) => ({ ...h, price: Number(h.price), setGuess: set }));
  }, card);
}

// The store pages the scan opens, built from the store addresses in the settings (cards.stores.shopUrl, buylistUrl).
export const shopSearchUrl = () => storeUrl(cardStores().shopUrl, "advanced_search");
export const buylistProductUrl = (handle) => storeUrl(cardStores().buylistUrl, `products/${handle}`);
// Where an NM price came from, as a scan row says it: "<store short name> NM" (the shop's own is "<shop name> NM").
export const buylistNmSource = () => `${cardStores().buylistShort} NM`;
// Can a scan run? It needs the shop's web address; an empty one means the deal watch isn't set up (nothing is opened).
export const scanSetUp = () => {
  const s = cardStores();
  return s.shopUrl ? { ok: true } : { ok: false, message: `The deal watch isn't set up: add ${s.shop}'s web address to the settings (cards.stores.shopUrl).` };
};

let scanLog = null;
const setPhase = (name) => ((scanState.phase = name), scanLog?.step(name));

async function runScan() {
  const ready = scanSetUp();
  if (!ready.ok) throw new Error(ready.message);
  const cfg = watchConfig();
  const started = Date.now();
  const lists = await watchLists(cfg);
  const prev = lastScan()?.items ? lastScan() : null;
  const prevKeys = prev ? new Set(prev.items.map((i) => i.key)) : csvKeys(cfg.csvPath);
  const compare = Boolean(prevKeys);
  const page = await newPage();
  const bl = cardStores().buylistUrl ? await newPage() : null; // no buy list address in the settings: that step is skipped
  try {
    await page.goto(shopSearchUrl(), { waitUntil: "domcontentloaded" });

    // 1. Every product with a Dmg copy in stock.
    setPhase("Listing damaged cards");
    const products = [];
    for (let n = 1; n <= 40; n++) {
      const list = await readListing(page, dmgQuery(cfg.stores, n));
      products.push(...list);
      scanState.done = products.length;
      if (list.length < 100) break;
      await sleep(150);
    }
    if (!products.length) throw new Error(`${cardStores().shop}'s search returned nothing. The site may be down or have changed.`);

    // 2. Each product page: the Dmg copies and the NM price.
    setPhase("Reading each card's page");
    scanState.total = products.length;
    scanState.done = 0;
    const items = [];
    for (const p of products) {
      try {
        const { rows, type } = await readProduct(page, p.url);
        const nm = rows.filter((r) => r.condition === "NM").map((r) => r.price);
        for (const r of rows.filter((r) => r.condition === "Dmg" && r.qty > 0 && cfg.stores.includes(r.store))) {
          items.push({
            name: p.name,
            set: p.set,
            url: p.url,
            type,
            foil: isFoil(`${p.name} ${p.set}`),
            store: r.store,
            language: r.language,
            qty: r.qty,
            price: r.price,
            nm: nm.length ? Math.max(...nm) : null,
            nmSource: nm.length ? `${cardStores().shop} NM` : null,
          });
        }
      } catch (err) {
        scanLog?.warn(`couldn't read ${p.url}: ${err.message}`);
      }
      scanState.done++;
      await sleep(120);
    }

    // 3. a local store NM for anything a local store has no NM price for (basic lands skipped).
    const noNm = bl ? items.filter((i) => i.nm == null && !/basic land/i.test(i.type)) : [];
    if (noNm.length) {
      setPhase(`Checking ${cardStores().buylist} NM prices`);
      scanState.total = noNm.length;
      scanState.done = 0;
      await bl.goto(cardStores().buylistUrl, { waitUntil: "domcontentloaded" });
      await bl.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      const cache = new Map();
      for (const i of noNm) {
        const key = `${norm(i.name)}|${i.foil}|${setKey(i.set)}`;
        if (!cache.has(key)) {
          const hits = await buylistNm(bl, { name: i.name.replace(/\s*[(\[].*$/, ""), foil: i.foil, set: i.set }).catch((err) => (scanLog?.warn(`${cardStores().buylist} lookup for ${i.name} failed: ${err.message}`), []));
          cache.set(key, hits.filter((h) => sameSet(h.set, i.set)).sort((a, b) => a.price - b.price)[0] || null);
          await sleep(120);
        }
        const hit = cache.get(key);
        if (hit) Object.assign(i, { nm: hit.price, nmSource: buylistNmSource(), nmUrl: hit.handle ? buylistProductUrl(hit.handle) : null });
        scanState.done++;
      }
    }

    // 4. Still-needed cards and the upgrade wishlist, any condition.
    const wish = lists.wishlist;
    const names = [...new Set([...lists.needed.map((n) => n.name), ...wish.map((w) => w.name)])];
    setPhase("Checking still-needed and wishlist cards");
    scanState.total = names.length;
    scanState.done = 0;
    const inStock = {};
    for (const name of names) {
      const out = [];
      try {
        const list = (await readListing(page, `/products/search?q=${encodeURIComponent(name)}`)).filter((p) => norm(p.name) === norm(name));
        for (const p of list.slice(0, 12)) {
          const { rows } = await readProduct(page, p.url);
          for (const r of rows.filter((r) => r.qty > 0)) out.push({ name: p.name, set: p.set, url: p.url, foil: isFoil(`${p.name} ${p.set}`), ...r });
          await sleep(120);
        }
      } catch (err) {
        scanLog?.warn(`search for ${name} failed: ${err.message}`);
      }
      inStock[name] = out;
      scanState.done++;
    }

    // Deals.
    const pet = new Set(lists.petDeck.map(norm));
    for (const i of items) {
      i.key = `${i.name}|${i.set}|${i.store}|Dmg`;
      i.isNew = compare && !prevKeys.has(i.key);
      i.off = i.nm ? 1 - i.price / i.nm : null;
      i.land = /land/i.test(i.type) && !/basic/i.test(i.type);
      i.kinds = [];
      if (i.nm != null && i.nm >= cfg.bigCardNm) i.kinds.push("A");
      if (pet.has(norm(i.name))) i.kinds.push("B");
      if (i.land) i.kinds.push("D");
    }
    const deals = [];
    for (const i of items.filter((i) => i.kinds.some((k) => k === "A" || k === "B"))) deals.push({ kind: i.kinds.includes("A") ? "A" : "B", ...i });
    const needed = lists.needed.map((n) => ({ ...n, copies: inStock[n.name] || [] }));
    for (const n of needed) for (const c of n.copies) deals.push({ kind: "C", ...c, isNew: Boolean(prev) && !(prev.needed || []).some((x) => x.copies?.some((y) => y.url === c.url && y.store === c.store && y.condition === c.condition)) });
    const wishOut = wish.map((w) => {
      const copies = (inStock[w.name] || []).map((c) => {
        // a local store rarely shows collector numbers, so a same-set, same-finish copy counts; numberSeen says if it was confirmed.
        const printing = sameSet(c.set, w.setName) && c.foil === w.foil;
        const numberSeen = Boolean(w.number) && new RegExp(`(^|[^0-9])0*${w.number}([^0-9]|$)`).test(`${c.name} ${c.set}`);
        const deal = printing && w.target != null && (c.price <= w.target || (["Dmg", "MP"].includes(c.condition) && c.price <= w.target * 0.75));
        return { ...c, printing, numberSeen, deal };
      });
      return { ...w, copies };
    });
    for (const w of wishOut) for (const c of w.copies.filter((c) => c.deal)) deals.push({ kind: "E", ...c, target: w.target, wantedNumber: w.number, numberSeen: c.numberSeen });

    const result = { at: new Date().toISOString(), ms: Date.now() - started, source: lists.source, items, deals, needed, wishlist: wishOut, products: products.length };
    writeJsonAtomic(LATEST(), result);
    writeJsonAtomic(path.join(HISTORY(), `${result.at.slice(0, 10)}.json`), result, 0);
    for (const old of fs.readdirSync(HISTORY()).sort().slice(0, -60)) fs.rmSync(path.join(HISTORY(), old), { force: true });
    writeJsonAtomic(path.join(DIR(), "scan-time.json"), { ms: result.ms }, 0);
    writeCsv(result, cfg);
    return result;
  } finally {
    await page.close().catch(() => {});
    await bl?.close().catch(() => {});
  }
}

export function toCsv(result) {
  // Same columns as the CSV the old scheduled task kept.
  const head = ["date", "card", "set", "store", "condition", "qty", "nm_price_cad", "nm_basis", "dmg_price_cad", "pct_off", "deal_type", "new", "link"];
  const lines = [head.join(",")];
  for (const i of result.items)
    lines.push(
      [
        result.at.slice(0, 10),
        i.name,
        i.set,
        i.store,
        "Dmg",
        i.qty,
        i.nm,
        i.nmSource,
        i.price,
        i.off == null ? "" : Math.round(i.off * 100),
        i.kinds.join(" "),
        i.isNew ? "NEW" : "",
        i.url,
      ]
        .map(cell)
        .join(","),
    );
  return lines.join("\n");
}
// Keeps the owner's existing CSV up to date too, when its folder exists on this PC.
function writeCsv(result, cfg) {
  fs.writeFileSync(path.join(DIR(), "dmg-latest.csv"), toCsv(result));
  try {
    if (cfg.csvPath && fs.existsSync(path.dirname(cfg.csvPath))) fs.writeFileSync(cfg.csvPath, toCsv(result));
  } catch (err) {
    scanLog?.warn(`couldn't write ${cfg.csvPath}: ${err.message}`);
  }
}

export function startScan({ alert = true } = {}) {
  if (scanState.running) return scanStatus();
  scanLog = startRun("deal scan", { trigger: alert ? "daily" : "button" });
  Object.assign(scanState, { running: true, phase: "Starting", done: 0, total: 0, startedAt: new Date().toISOString(), error: null });
  runScan()
    .then(async (r) => {
      const kinds = {};
      for (const d of r.deals) kinds[d.kind] = (kinds[d.kind] || 0) + 1;
      scanLog.end({
        source: r.source,
        products: r.products,
        items: r.items.length,
        nmFromCH: r.items.filter((i) => i.nmSource === `${cardStores().shop} NM`).length,
        nmFromBuylist: r.items.filter((i) => i.nmSource === buylistNmSource()).length,
        noNm: r.items.filter((i) => i.nm == null).length,
        newItems: r.items.filter((i) => i.isNew).length,
        deals: r.deals.length,
        dealsByKind: kinds,
        newDeals: r.deals.filter((d) => d.isNew).length,
        wishlistInStock: r.wishlist.filter((w) => w.copies.length).length,
      });
      if (!alert) return;
      const top = r.deals.slice(0, 6).map((d) => `${d.isNew ? "NEW " : ""}${d.kind} ${d.name} (${d.store}, ${d.condition || "Dmg"}) $${d.price}${d.nm ? ` vs NM $${d.nm}` : d.target ? ` vs target $${d.target}` : ""}`);
      await sendAlert({
        kind: r.deals.length ? "deals" : "deals_none",
        title: r.deals.length
          ? `Deal watch: ${r.deals.length} deal${r.deals.length > 1 ? "s" : ""}${r.deals.some((d) => d.isNew) ? `, ${r.deals.filter((d) => d.isNew).length} new` : ""}`
          : "Deal watch: no deals today",
        message: top.join("\n") || `${r.items.length} damaged cards in stock, none flagged.`,
        tags: ["moneybag"],
        priority: r.deals.some((d) => d.isNew) ? 4 : 2,
        url: dashboardLink("/deals.html"),
      }).catch(() => {});
    })
    .catch((err) => {
      scanState.error = err.message.split("\n")[0];
      scanLog.end({ error: scanState.error });
      writeJsonAtomic(LATEST(), { ...(lastScan() || {}), error: scanState.error, errorAt: new Date().toISOString() });
      if (alert) sendAlert({ kind: "deals_failed", title: "Deal watch failed", message: scanState.error, tags: ["warning"], priority: 3, url: dashboardLink("/deals.html") }).catch(() => {});
    })
    .finally(() => Object.assign(scanState, { running: false, phase: null }));
  return scanStatus();
}

// Called every minute by server.js: once a day at the configured time (default 8:45 am, the pipeline's timezone).
export function dealWatchTick() {
  const cfg = watchConfig();
  if (cfg.enabled === false || !scanSetUp().ok) return; // not set up: no daily scan, no daily "failed" alert
  const last = lastScan();
  // A failed first-ever scan has errorAt but no at; counting either stops a retry every minute (code review 2026-10-22).
  const lastTry = [last?.at, last?.errorAt].filter(Boolean).sort().at(-1);
  if (dueAt({ hour: cfg.hour, minute: cfg.minute, last: lastTry }) && !scanState.running) startScan();
}
