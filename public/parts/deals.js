// Deal watch: the page's working part as a block (see public/parts/kit.js). Mounted by public/deals.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, table, tile, api, bindRoot } from "/stats-lib.js";
import { safeUrl } from "/lib.js";
import { watchJob, money } from "/lib.js";
import { scope, lifecycle, needScripts } from "/parts/kit.js";
import { stores as STORES } from "/hubinfo.js";
const DECK = STORES.deck ? `${STORES.deck} deck` : "Your deck";

export const html = `<style>
[data-block="deals"] .chip { font-size: 13px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line-strong); color: var(--text-secondary); }
  [data-block="deals"] .tag { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: var(--surface-3); color: var(--text-secondary); white-space: nowrap; }
  [data-block="deals"] .tag-new { background: rgba(250, 178, 25, 0.18); color: #fbbf24; }
  [data-block="deals"] .thumb { width: 40px; border-radius: 3px; }
</style>
<section class="card flex items-start gap-3 flex-wrap">
  <div class="basis-full sm:basis-0 flex-1 min-w-0">
    <div class="font-semibold">${esc(STORES.shop)} scan</div>
    <div id="scanText" class="text-sm text-slate-500">Loading…</div>
    <div id="scanBarWrap" class="hidden h-2 rounded bg-slate-100 overflow-hidden mt-2"><div id="scanBar" class="h-full bg-red-600 w-0"></div></div>
    <div id="listsText" class="text-xs text-slate-500 mt-2"></div>
    <label class="flex items-center gap-2 text-sm text-slate-600 mt-2"><input id="daily" type="checkbox" /> <span id="dailyLabel">Run every morning and send my phone the deals</span></label>
  </div>
  <div class="flex gap-2">
    <a id="csvBtn" href="/api/pipeline/cards/watch/csv" class="hidden border border-slate-300 hover:border-slate-400 text-sm font-medium px-4 py-2 rounded-lg">CSV</a>
    <button id="scanBtn" class="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">Scan now</button>
  </div>
</section>

<div id="err" class="hidden bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-sm"></div>
<section id="tiles" class="grid grid-cols-2 md:grid-cols-4 gap-3"></section>

<section class="card">
  <h2 class="font-semibold">Deals</h2>
  <p class="text-sm text-slate-500 mb-2" id="dealsNote"></p>
  <div id="deals" class="overflow-x-auto"></div>
</section>

<section class="card scan-only">
  <h2 class="font-semibold">Still to buy</h2>
  <p class="text-sm text-slate-500 mb-2">Any condition, from the "Proxies to buy" tab.</p>
  <div id="needed" class="text-sm"></div>
</section>

<section class="card scan-only">
  <h2 class="font-semibold">Upgrade picks</h2>
  <p class="text-sm text-slate-500 mb-2">Your marked picks from the "Upgrade options" tab, with what ${esc(STORES.shop)} has of that card in stock. A copy counts as the same printing when the set and finish match. ${esc(STORES.shop)} rarely shows collector numbers, so check the listing before you buy.</p>
  <div id="wish" class="space-y-3"></div>
</section>

<section class="card scan-only">
  <h2 class="font-semibold">Damaged lands</h2>
  <p class="text-sm text-slate-500 mb-2">Every non-basic land in Dmg condition.</p>
  <div id="lands" class="overflow-x-auto"></div>
</section>

<section class="card scan-only">
  <div class="flex items-center gap-2 flex-wrap mb-2">
    <h2 class="font-semibold flex-1">Every damaged card</h2>
    <input id="q" placeholder="Search" class="rounded-lg border px-3 py-1.5 text-sm w-40" />
    <button class="chip" data-f="all" aria-pressed="true">All</button>
    <button class="chip" data-f="new" aria-pressed="false">New</button>
    ${STORES.towns.map((t) => `<button class="chip" data-f="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join("\n    ")}
  </div>
  <div id="all" class="overflow-x-auto"></div>
</section>
<details id="runlogBox" class="bg-white rounded-xl border border-slate-200 p-4">
  <summary class="font-semibold cursor-pointer">Scan log</summary>
  <p class="mt-2 text-sm text-slate-500">Every scan: start and end, listings and cards read, where NM prices came from, deals found, step times, and any pages that couldn't be read.</p>
  <div id="runlog" class="mt-2"></div>
</details>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "deals";
  const $ = scope(root), life = lifecycle();
  bindRoot(root, life);
  const showErr = (msg) => { const el = $("err"); el.textContent = msg; el.classList.toggle("hidden", !msg); };
  await needScripts(["/timing.js","/runlog.js"]);
  const cad = (n) => money(n);
  const off = (n) => (n == null ? "" : `${Math.round(n * 100)}%`);
  const KIND = { A: "Big card", B: DECK, C: "Still to buy", D: "Land", E: "Upgrade pick" };
  const cardLink = (r) => `<a class="hover:underline" target="_blank" rel="noopener" href="${esc(safeUrl(r.url))}">${esc(r.name)}</a>${r.isNew ? ' <span class="tag tag-new">NEW</span>' : ""}`;
  let data = null, filter = "all", scanMs = null;

  function render() {
    const last = data.last;
    const lists = data.lists;
    $("listsText").textContent = lists ? (lists.source ? `Lists from ${lists.source}: ${lists.deck} deck cards, ${lists.wishlist.length} upgrade picks, still to buy: ${lists.needed.map((n) => n.name).join(", ") || "nothing"}.` : (lists.deck || lists.wishlist.length || lists.needed.length ? "Couldn't find your deck spreadsheet, so the lists saved in the settings are used." : "No deck set up yet. Add one in the settings to see your deck's cards, upgrade picks and cards still to buy here.")) : "";
    $("daily").checked = data.config.enabled;
    $("dailyLabel").textContent = `Run every morning at ${data.config.hour}:${String(data.config.minute).padStart(2, "0")} and send my phone the deals`;
    // Before the first scan, only the Deals card shows, with what fills it (design review finding 17).
    $.all(".scan-only").forEach((x) => x.classList.toggle("hidden", !last?.items));
    if (!last?.items) {
      $("tiles").innerHTML = "";
      $("deals").innerHTML = '<p class="text-sm text-slate-500">No scan yet. Press Scan now (it takes several minutes in the pipeline\'s Chrome). Deals, cards still to buy, upgrade picks, damaged lands and the full damaged list show up here after it.</p>';
      return;
    }
    $("csvBtn").classList.remove("hidden");
    const items = last.items;
    const best = [...items].filter((i) => i.off != null && i.nm >= 5).sort((a, b) => b.off - a.off)[0];
    $("tiles").innerHTML = [
      tile("Damaged cards in stock", items.length, `${last.products} listings`),
      tile("Deals", last.deals.length, last.deals.length ? Object.entries(last.deals.reduce((m, d) => ((m[d.kind] = (m[d.kind] || 0) + 1), m), {})).map(([k, n]) => `${n} ${KIND[k].toLowerCase()}`).join(", ") : "nothing flagged"),
      tile("New since the last scan", items.filter((i) => i.isNew).length),
      tile("Biggest discount ($5+ NM)", best ? off(best.off) : "", best ? `${esc(best.name)} ${cad(best.price)} vs ${cad(best.nm)}` : ""),
    ].join("");

    const order = { A: 0, B: 1, C: 2, E: 3 };
    const deals = [...last.deals].sort((a, b) => order[a.kind] - order[b.kind] || (b.isNew - a.isNew) || (b.nm || b.target || 0) - (a.nm || a.target || 0));
    $("dealsNote").textContent = `Big card means a Dmg copy of something worth $${data.config.bigCardNm}+ in NM. ${DECK} means any Dmg copy of a card in your deck. Upgrade pick means at or under your ${STORES.buylist} target, or Dmg/MP at least 25% under it.`;
    table($("deals"), [
      { key: "kind", label: "Why", html: (r) => `<span class="tag">${esc(KIND[r.kind])}</span>` },
      { key: "name", label: "Card", html: cardLink },
      { key: "price", label: "Price", right: true, fmt: cad },
      { key: "nm", label: "NM or target", right: true, html: (r) => (r.nm != null ? `${cad(r.nm)} <span class="text-slate-500 text-xs">${esc(r.nmSource === `${STORES.buylistShort} NM` ? STORES.buylistShort : STORES.shopShort)}</span>` : r.target != null ? `${cad(r.target)} <span class="text-slate-500 text-xs">target</span>` : "") },
      { key: "off", label: "Off", right: true, fmt: off },
      { key: "store", label: "Store" },
      { key: "condition", label: "Cond", fmt: (v) => v || "Dmg" },
      { key: "set", label: "Set" },
    ], deals);
    if (!deals.length) $("deals").innerHTML = '<p class="text-sm text-slate-500">No deals in this scan.</p>';

    $("needed").innerHTML = (last.needed || []).map((n) => `<div class="mb-3"><div class="font-medium">${esc(n.name)}</div>${n.printings?.length ? `<div class="text-xs text-slate-500">${esc(STORES.buylist)}: ${n.printings.map((p) => `${esc(p.printing)} ${cad(p.buylist ?? p.f2f)}`).join(" · ")}</div>` : ""}${n.copies.length ? `<ul class="mt-1">${n.copies.map((c) => `<li>${cardLink(c)} <span class="text-slate-500">${esc(c.set)} · ${esc(c.store)} · ${esc(c.condition)} · ${c.qty} left</span> <b>${cad(c.price)}</b></li>`).join("")}</ul>` : `<div class="text-slate-500">Not in stock at ${esc(STORES.shop)}.</div>`}</div>`).join("") || '<p class="text-slate-500">Nothing on the list.</p>';

    $("wish").innerHTML = (last.wishlist || []).map((w) => {
      const same = w.copies.filter((c) => c.printing), other = w.copies.filter((c) => !c.printing);
      return `<div class="flex gap-3 text-sm">${w.image ? `<img class="thumb shrink-0" src="${esc(w.image)}" alt="" loading="lazy" />` : ""}<div class="min-w-0">
        <div><b class="font-medium">${esc(w.name)}</b> <span class="text-slate-500">${esc(w.setName || w.setCode || "")}${w.number ? " #" + esc(w.number) : ""}${w.foil ? ", foil" : ""}${w.treatment ? `, ${esc(w.treatment)}` : ""}</span> · target ${cad(w.target)}</div>
        ${same.length ? same.map((c) => `<div>${c.deal ? '<span class="tag tag-new">DEAL</span> ' : ""}<a class="hover:underline" target="_blank" rel="noopener" href="${esc(safeUrl(c.url))}">${esc(c.name)}</a> <span class="text-slate-500">${esc(c.store)} · ${esc(c.condition)}</span> <b>${cad(c.price)}</b>${c.numberSeen ? "" : ' <span class="text-xs text-slate-500">check the number</span>'}</div>`).join("") : '<div class="text-slate-500">That printing isn\'t in stock.</div>'}
        ${other.length ? `<div class="text-xs text-slate-500">Other printings in stock: ${other.slice(0, 6).map((c) => `${esc(c.set)} ${esc(c.condition)} ${cad(c.price)}`).join(" · ")}${other.length > 6 ? "…" : ""}</div>` : ""}
      </div></div>`;
    }).join("") || '<p class="text-sm text-slate-500">No picks marked.</p>';

    table($("lands"), [
      { key: "name", label: "Land", html: cardLink },
      { key: "price", label: "Dmg", right: true, fmt: cad },
      { key: "nm", label: "NM", right: true, fmt: cad },
      { key: "off", label: "Off", right: true, fmt: off },
      { key: "store", label: "Store" },
      { key: "set", label: "Set" },
    ], items.filter((i) => i.land), { sortKey: "nm" });
    if (!items.some((i) => i.land)) $("lands").innerHTML = '<p class="text-sm text-slate-500">No damaged non-basic lands in stock.</p>';
    renderAll();
  }

  function renderAll() {
    const q = $("q").value.trim().toLowerCase();
    const rows = data.last.items.filter((i) => (filter === "all" || (filter === "new" ? i.isNew : i.store === filter)) && (!q || `${i.name} ${i.set}`.toLowerCase().includes(q)));
    table($("all"), [
      { key: "name", label: "Card", html: cardLink },
      { key: "price", label: "Dmg", right: true, fmt: cad },
      { key: "nm", label: "NM", right: true, html: (r) => (r.nm != null ? `${cad(r.nm)} <span class="text-slate-500 text-xs">${esc(r.nmSource === `${STORES.buylistShort} NM` ? STORES.buylistShort : STORES.shopShort)}</span>` : '<span class="text-slate-500 text-xs">none found</span>') },
      { key: "off", label: "Off", right: true, fmt: off },
      { key: "store", label: "Store" },
      { key: "qty", label: "Qty", right: true },
      { key: "set", label: "Set" },
    ], rows, { sortKey: "price" });
  }

  function renderScan(s) {
    $("scanBtn").disabled = s.running;
    if (s.typicalMs) scanMs = s.typicalMs;
    $("scanBtn").textContent = `Scan now${scanMs ? ` · ${timing.est(scanMs)}` : ""}`;
    $("scanBarWrap").classList.toggle("hidden", !s.running);
    if (s.running) {
      const elapsedMs = Date.now() - Date.parse(s.startedAt);
      const stepShare = s.total ? s.done / s.total : 0;
      $("scanText").textContent = `${s.phase}${s.total ? `: ${s.done} of ${s.total}` : s.done ? `: ${s.done} found` : ""}. ${timing.progressText({ elapsedMs, typicalMs: s.typicalMs })}.`;
      $("scanBar").style.width = s.typicalMs ? `${Math.min(98, (elapsedMs / s.typicalMs) * 100)}%` : `${Math.max(5, stepShare * 100)}%`;
      return;
    }
    const l = s.last;
    if (!l) return ($("scanText").textContent = "Not scanned yet.");
    const when = new Date(l.error && !l.at ? Date.now() : l.at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    $("scanText").textContent = l.error ? `The last scan failed: ${l.error}${l.at ? ` The results below are from ${when}.` : ""}` : `Last scan ${when}, took ${timing.dur(l.ms)}: ${l.items} damaged cards, ${l.deals} deal${l.deals === 1 ? "" : "s"}${l.newDeals ? `, ${l.newDeals} new` : ""}.`;
  }

  async function load() {
    try {
      data = await api("/cards/watch");
      $("err").classList.add("hidden");
      renderScan(data.status);
      render();
      if (data.status.running) watchScan();
    } catch (err) {
      showErr("Couldn't load the deal watch: " + err.message);
    }
  }
  const watchScan = watchJob({ life, poll: () => api("/cards/watch/status"), render: renderScan, lost: (err) => showErr(err ? err.message : ""), done: () => (load(), scanLog.reload()) });
  $("scanBtn").onclick = async () => {
    try {
      if (!(await timing.confirmLong({ ms: scanMs, what: "The scan", untimedLong: true, note: "The first scan sets the time estimate for next time." }))) return;
      renderScan(await api("/cards/watch/scan", {}));
      watchScan();
    } catch (err) {
      $("scanText").textContent = "Couldn't start: " + err.message;
    }
  };
  $("daily").onchange = () => api("/cards/watch/config", { enabled: $("daily").checked }).catch(() => ($("daily").checked = !$("daily").checked));
  $("q").oninput = () => data?.last?.items && renderAll();
  $.all("[data-f]").forEach((b) => (b.onclick = () => {
    filter = b.dataset.f;
    $.all("[data-f]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    if (data?.last?.items) renderAll();
  }));
  const scanLog = runLog.mount($("runlog"), { kinds: ["deal scan"] });
  load();
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
