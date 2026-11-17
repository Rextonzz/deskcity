// Collection: the page's working part as a block (see public/parts/kit.js). Mounted by public/collection.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, api, shrinkPhoto, day, money as fmtMoney, confirmBox } from "/lib.js";
import { columns, onResize, bindRoot } from "/stats-lib.js";
import { scope, lifecycle } from "/parts/kit.js";
import { stores as STORES } from "/hubinfo.js";

export const html = `<style>
[data-block="collection"] .chip { font-size: 13px; padding: 5px 11px; border-radius: 999px; border: 1px solid var(--line-strong); color: var(--text-secondary); white-space: nowrap; }
  [data-block="collection"] .thumb { width: 52px; height: 72px; object-fit: cover; border-radius: 4px; background: var(--surface-2, #222); flex-shrink: 0; }
  [data-block="collection"] .pick { width: 100%; aspect-ratio: 488 / 680; object-fit: cover; border-radius: 6px; background: var(--surface-2, #222); }
  [data-block="collection"] input,
  [data-block="collection"] select,
  [data-block="collection"] textarea { background: var(--surface-1); border: 1px solid var(--line-strong); border-radius: 8px; padding: 6px 10px; color: var(--text-primary); min-width: 0; }
</style>
<div id="err" class="hidden bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-sm"></div>

<section class="grid grid-cols-2 md:grid-cols-5 gap-3" id="tiles"></section>

<section class="card space-y-3" id="yourCards">
  <div class="flex items-center gap-2"><h2 class="font-semibold flex-1">Your cards</h2><a href="/api/pipeline/export/cards" class="px-3 py-1.5 rounded-lg border border-slate-300 text-sm" download>⬇ Download (CSV)</a></div>
  <div class="flex gap-2 flex-wrap items-center">
    <input id="filter" type="search" placeholder="Search your cards" class="flex-1 min-w-[10rem]" />
    <select id="sort">
      <option value="value">Most valuable</option>
      <option value="name">Name</option>
      <option value="set">Set</option>
      <option value="added">Newest</option>
    </select>
  </div>
  <div id="listChips" class="flex gap-2 flex-wrap"></div>
  <div id="cards" class="divide-y divide-slate-100"></div>
  <div id="more"></div>
</section>

<section class="card space-y-3">
  <div class="flex items-center gap-2 flex-wrap">
    <h2 class="font-semibold flex-1">Add cards</h2>
    <label class="text-sm text-slate-500">Condition <select id="addCond"><option>NM</option><option>LP</option><option>MP</option><option>HP</option><option>DMG</option></select></label>
    <label class="text-sm text-slate-500">List <select id="addList"><option value="">None</option></select></label>
  </div>
  <div class="flex gap-2 flex-wrap">
    <label class="flex-1 min-w-[9rem] text-center cursor-pointer bg-slate-800 hover:bg-slate-900 text-white font-medium px-4 py-2.5 rounded-lg">Snap a card
      <input id="photo" type="file" accept="image/*" capture="environment" multiple class="hidden" />
    </label>
    <label class="flex-1 min-w-[9rem] text-center cursor-pointer border border-slate-300 font-medium px-4 py-2.5 rounded-lg">Snap many cards
      <input id="photoMulti" type="file" accept="image/*" capture="environment" class="hidden" />
    </label>
    <label class="flex-1 min-w-[9rem] text-center cursor-pointer border border-slate-300 font-medium px-4 py-2.5 rounded-lg">Import a CSV
      <input id="csv" type="file" accept=".csv,text/csv" class="hidden" />
    </label>
  </div>
  <p class="text-xs text-slate-500">Snap a card: one card per photo; pick several at once and they're read one after another. Snap many cards: lay them out face up with the names showing, one photo, then tick the ones to add (each photo is a small AI cost). CSV: export from ManaBox, Delver Lens, Moxfield or Deckbox.</p>
  <div class="relative">
    <input id="q" type="search" placeholder="Or type a card name" class="w-full" autocomplete="off" />
    <div id="sugg" class="hidden absolute z-10 left-0 right-0 mt-1 rounded-lg border border-slate-300 bg-white shadow max-h-72 overflow-auto text-sm"></div>
  </div>
  <div id="prints" class="hidden"></div>
  <div id="addMsg" class="text-sm"></div>
  <div id="multiReview"></div>
</section>

<section class="card space-y-3" id="tradesCard">
  <div class="flex items-center gap-2 flex-wrap">
    <h2 class="font-semibold flex-1">Trades</h2>
    <button id="newTrade" class="text-sm px-3 py-1.5 rounded-lg bg-slate-800 text-white">New trade</button>
  </div>
  <p class="text-xs text-slate-500">Add the cards going out and coming in (one photo of each pile, by name, or from your collection). Pick how each side is priced (TCGplayer, ${esc(STORES.buylist)} retail or buylist, and a percent such as 80%), or type your own price on any card. Confirm takes the out cards off your collection and adds the in cards to the list "Traded in"; Undo puts it back.</p>
  <div id="trades" class="space-y-4"></div>
  <div id="tradesMsg" class="text-sm"></div>
</section>

<section class="card" id="histCard">
  <h3 class="font-medium">Value over time (CAD)</h3>
  <p class="text-sm text-slate-500 mb-2">A point each time prices are refreshed.</p>
  <div id="histChart"></div>
</section>

<section class="card" id="moversCard">
  <h3 class="font-medium">Biggest movers this week</h3>
  <p id="moversNote" class="text-sm text-slate-500 mb-2"></p>
  <div id="movers" class="grid sm:grid-cols-2 gap-4"></div>
</section>

<section class="card" id="sellCard">
  <h3 class="font-medium">Worth selling</h3>
  <p class="text-sm text-slate-500 mb-2">Cards worth more than the trade-up limit (CA$<span id="sellMin">5</span> each) that aren't in a deck or keep list, plus copies beyond 4 of any card. Market price: stores buy for less, so check a buylist first. Suggestions only.</p>
  <div id="sell"></div>
</section>

<section class="card space-y-3" id="deckCard">
  <h3 class="font-medium">Deck lists</h3>
  <p class="text-sm text-slate-500">Paste a deck list, one card per line ("1 Command Tower" or just "Command Tower"). Your copies of each card go into the list, so Deck ideas and Worth selling leave them alone. Saving the same list again replaces it.</p>
  <input id="deckName" class="w-full" maxlength="40" placeholder="Commander: Atraxa" />
  <textarea id="deckText" class="w-full" rows="6" placeholder="1 Llanowar Elves&#10;1 Command Tower&#10;16 Mountain"></textarea>
  <div class="flex flex-wrap gap-2 items-center">
    <button id="deckCheck" class="text-sm px-3 py-1.5 rounded-lg border border-slate-300">Check</button>
    <button id="deckSave" class="text-sm px-3 py-1.5 rounded-lg bg-slate-800 text-white disabled:opacity-50">Save list</button>
    <span id="deckMsg" class="text-sm text-slate-500"></span>
  </div>
  <div id="deckOut" class="text-sm"></div>
</section>

<section class="card space-y-3" id="tradeCard">
  <div class="flex items-center gap-2 flex-wrap">
    <h3 class="font-medium flex-1">Trade-up</h3>
    <button id="ideasBtn" class="text-sm px-3 py-1.5 rounded-lg bg-slate-800 text-white disabled:opacity-50">Ideas from Claude · ~1 min</button>
  </div>
  <p class="text-sm text-slate-500">Cards you don't use, turned into better ones. The trade pile is every card not in a list starting with <span id="keepNames"></span>, worth between CA$<input id="minEach" inputmode="decimal" class="w-16" /> and CA$<input id="maxEach" inputmode="decimal" class="w-16" /> each. <button id="tradeSave" class="text-red-700 hover:underline">Save</button></p>
  <div id="pileSum" class="text-sm"></div>
  <details><summary class="text-sm cursor-pointer text-slate-500">Cards in the trade pile</summary><div id="pileRows" class="divide-y divide-slate-100 mt-2 text-sm"></div></details>
  <div class="relative">
    <input id="wantQ" type="search" placeholder="Add a card you want" class="w-full" autocomplete="off" />
    <div id="wantSugg" class="hidden absolute z-10 left-0 right-0 mt-1 rounded-lg border border-slate-300 bg-white shadow max-h-72 overflow-auto text-sm"></div>
  </div>
  <div id="wants" class="divide-y divide-slate-100 text-sm"></div>
  <div id="ideas" class="text-sm"></div>
  <div id="tradeMsg" class="text-sm"></div>
</section>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "collection";
  const $ = scope(root), life = lifecycle();
  bindRoot(root, life);
  const showErr = (msg) => { const el = $("err"); el.textContent = msg; el.classList.toggle("hidden", !msg); };
  let data = { cards: [], lists: [] }, list = "", shown = 60, open = null;
  const rate = () => data.rate || null;
  const cad = (usd) => (usd == null ? "" : rate() ? fmtMoney(usd * rate(), "CA$") : fmtMoney(usd, "US$"));

  async function load() {
    try {
      data = await api("/collection");
      showErr("");
    } catch (err) {
      showErr(err.message);
    }
    render();
  }

  function render() {
    const priced = day(data.pricedAt);
    $("tiles").innerHTML = [
      ["Cards", (data.cards || []).reduce((t, c) => t + c.qty, 0).toLocaleString(), `${(data.cards || []).length.toLocaleString()} different`],
      ["Value", data.valueCad != null ? `CA$${Math.round(data.valueCad).toLocaleString()}` : `US$${Math.round(data.valueUsd || 0).toLocaleString()}`, data.rate ? `US$${Math.round(data.valueUsd || 0).toLocaleString()} at ${data.rate.toFixed(4)}` : ""],
      ...(data.buylistStore ? [[STORES.buylist, `CA$${Math.round(data.buylistStore.retail).toLocaleString()}`, `Buys for CA$${Math.round(data.buylistStore.buylist).toLocaleString()} · ${data.buylistStore.cards} cards $20+ · ${esc(day(data.buylistStore.at + "T12:00:00"))}`]] : []),
      ["Most valuable", (() => { const t = [...(data.cards || [])].sort((a, b) => (b.each || 0) - (a.each || 0))[0]; return t ? esc(t.name) : "—"; })(), (() => { const t = [...(data.cards || [])].sort((a, b) => (b.each || 0) - (a.each || 0))[0]; return t ? cad(t.each) : ""; })()],
    ].map(([l, v, sub]) => `<div class="bg-white rounded-xl border border-slate-200 p-3"><div class="text-xs text-slate-500">${l}</div><div class="text-xl font-semibold mt-0.5 truncate">${v}</div><div class="text-xs text-slate-500 mt-0.5 truncate">${sub}</div></div>`).join("")
      + `<div class="bg-white rounded-xl border border-slate-200 p-3"><div class="text-xs text-slate-500">Prices</div><div class="text-sm mt-1">${priced ? `Oldest from ${esc(priced)}` : "None yet"}</div><button id="refresh" class="mt-1 text-xs px-2.5 py-1 rounded-lg border border-slate-300">Refresh prices</button></div>`;
    $("refresh").onclick = refresh;

    $("addList").innerHTML = `<option value="">None</option>${data.lists.map((l) => `<option ${l === $("addList").value ? "selected" : ""}>${esc(l)}</option>`).join("")}<option value="__new">New list…</option>`;
    $("listChips").innerHTML = [["", "All"], ...data.lists.map((l) => [l, l])].map(([v, t]) => `<button class="chip" data-list="${esc(v)}" aria-pressed="${list === v}">${esc(t)}</button>`).join("");
    $.all("[data-list]").forEach((b) => (b.onclick = () => ((list = b.dataset.list), (shown = 60), render())));

    const h = data.history || [];
    $("histCard").classList.toggle("hidden", h.length < 2);
    if (h.length >= 2) columns($("histChart"), h.map((x) => ({ label: day(x.at), value: x.cad ?? x.usd })), { fmt: (v) => `$${Math.round(v).toLocaleString()}`, height: 180 });

    drawSell();

    // Biggest movers (design review finding 20): change in what your copies are worth since about a week ago.
    const mv = data.movers;
    const mvList = (rows, word) => rows.length ? `<ul class="text-sm space-y-1">${rows.map((r) => `<li class="flex gap-2"><span class="flex-1 min-w-0 truncate">${esc(r.name)} <span class="text-slate-500">${esc(String(r.set || "").toUpperCase())}${r.qty > 1 ? ` · ${r.qty}×` : ""}</span></span><span class="whitespace-nowrap">${r.change > 0 ? "↑" : "↓"} ${cad(Math.abs(r.change))}</span></li>`).join("")}</ul>` : `<p class="text-sm text-slate-500">Nothing ${word} yet.</p>`;
    if (!mv || (!mv.up.length && !mv.down.length)) {
      $("moversNote").textContent = !mv ? "Restart the app to start tracking movers." : "Each price refresh now saves every card's price for the day. Movers show from the second day of refreshes on.";
      $("movers").innerHTML = "";
    } else {
      $("moversNote").textContent = "What your copies gained or lost since about a week ago (the oldest refresh in the last 8 days).";
      $("movers").innerHTML = `<div><div class="text-xs text-slate-500 mb-1">Up</div>${mvList(mv.up, "up")}</div><div><div class="text-xs text-slate-500 mb-1">Down</div>${mvList(mv.down, "down")}</div>`;
    }

    const f = $("filter").value.trim().toLowerCase();
    let rows = (data.cards || []).filter((c) => (!list || c.lists.includes(list)) && (!f || `${c.name} ${c.setName} ${c.set} ${c.typeLine}`.toLowerCase().includes(f)));
    const sort = $("sort").value;
    rows.sort(sort === "name" ? (a, b) => a.name.localeCompare(b.name) : sort === "set" ? (a, b) => a.setName.localeCompare(b.setName) || a.number.localeCompare(b.number, undefined, { numeric: true }) : sort === "added" ? (a, b) => b.addedAt.localeCompare(a.addedAt) : (a, b) => (b.each || 0) * b.qty - (a.each || 0) * a.qty);
    $("cards").innerHTML = rows.slice(0, shown).map(row).join("") || `<p class="text-sm text-slate-500 py-4">${data.cards.length ? "No cards match." : "No cards yet. Snap one, search a name, or import a CSV from ManaBox or Delver Lens."}</p>`;
    $("more").innerHTML = rows.length > shown ? `<button id="moreBtn" class="mt-2 text-sm px-3 py-1.5 rounded-lg border border-slate-300">Show more (${rows.length - shown} left)</button>` : "";
    if ($("moreBtn")) $("moreBtn").onclick = () => ((shown += 120), render());
    wire();
  }

  const row = (c) => `<div class="py-2" data-id="${c.id}">
    <div class="flex gap-3 items-center">
      ${c.image ? `<img class="thumb" loading="lazy" src="${esc(c.image)}" alt="" onerror="this.outerHTML='<div class=&quot;thumb&quot;></div>'" />` : `<div class="thumb"></div>`}
      <button class="flex-1 min-w-0 text-left" data-open="${c.id}">
        <div class="font-medium line-clamp-2">${c.qty > 1 ? `${c.qty}× ` : ""}${esc(c.name)}</div>
        <div class="text-xs text-slate-500 truncate">${esc(c.setName)} · #${esc(c.number)} · ${esc(c.condition)}${c.finish !== "nonfoil" ? ` · ${esc(c.finish)}` : ""}${c.language !== "English" ? ` · ${esc(c.language)}` : ""}${c.lists.length ? ` · ${c.lists.map(esc).join(", ")}` : ""}</div>
      </button>
      <div class="text-right text-sm shrink-0" style="font-variant-numeric:tabular-nums">
        <div>${c.each != null ? cad(c.each * c.qty) : '<span class="text-slate-500">no price</span>'}</div>
        <div class="text-xs text-slate-500">${c.qty > 1 && c.each != null ? `${cad(c.each)} each` : ""}</div>
        ${c.store?.facetoface?.retail != null ? `<div class="text-xs text-slate-500" title="${esc(c.store.facetoface.match || "")}">${esc(STORES.buylistShort)} CA$${c.store.facetoface.retail.toFixed(2)}${c.store.facetoface.buylist != null ? ` · buys CA$${c.store.facetoface.buylist.toFixed(2)}` : ""}${c.store.facetoface.check ? " ⚠" : ""}</div>` : ""}
      </div>
    </div>
    ${open === c.id ? `<div class="mt-2 ml-[64px] flex gap-2 flex-wrap items-center text-sm">
      <div class="flex items-center gap-1">
        <button data-q="-1" class="w-9 h-9 rounded border border-slate-300" aria-label="One fewer">−</button>
        <span class="w-7 text-center">${c.qty}</span>
        <button data-q="1" class="w-9 h-9 rounded border border-slate-300" aria-label="One more">+</button>
      </div>
      <select data-f="condition">${["NM", "LP", "MP", "HP", "DMG"].map((x) => `<option ${x === c.condition ? "selected" : ""}>${x}</option>`).join("")}</select>
      <select data-f="finish">${(c.finishes?.length ? c.finishes : ["nonfoil", "foil"]).map((x) => `<option ${x === c.finish ? "selected" : ""}>${x}</option>`).join("")}</select>
      <input data-f="lists" value="${esc(c.lists.join(", "))}" placeholder="Lists, comma separated" class="flex-1 min-w-[10rem]" />
      <input data-f="paid" value="${c.paid ?? ""}" placeholder="Paid (CA$)" inputmode="decimal" class="w-28" />
      <button data-save class="px-3 py-1.5 rounded-lg bg-slate-800 text-white">Save</button>
      ${c.scryfallUrl ? `<a class="text-red-700 hover:underline" target="_blank" rel="noopener" href="${esc(c.scryfallUrl)}">Scryfall</a>` : ""}
    </div>` : ""}
  </div>`;

  function wire() {
    $.all("[data-open]").forEach((b) => (b.onclick = () => ((open = open === b.dataset.open ? null : b.dataset.open), render())));
    $.all("[data-q]").forEach((b) => (b.onclick = async () => {
      const id = b.closest("[data-id]").dataset.id;
      const c = data.cards.find((x) => x.id === id);
      const q = c.qty + Number(b.dataset.q);
      if (q === 0 && !await confirmBox({ title: `Remove ${c.name} from the collection?`, yes: "Remove", no: "Cancel" })) return;
      try { await api("/collection/update", { id, qty: q }); await load(); } catch (err) { showErr(err.message); }
    }));
    $.all("[data-save]").forEach((b) => (b.onclick = async () => {
      const box = b.closest("[data-id]");
      const v = (f) => box.querySelector(`[data-f="${f}"]`).value;
      try {
        await api("/collection/update", { id: box.dataset.id, condition: v("condition"), finish: v("finish"), lists: v("lists").split(",").map((s) => s.trim()).filter(Boolean), paid: v("paid").replace(/[^0-9.]/g, "") });
        open = null;
        await load();
      } catch (err) { showErr(err.message); }
    }));
  }

  async function chosenList() {
    if ($("addList").value !== "__new") return $("addList").value;
    const name = (await confirmBox({ title: "New list name", input: "", yes: "OK", no: "Cancel" }) || "").trim();
    return name;
  }
  const say = (html) => ($("addMsg").innerHTML = html);
  const result = (r) => [r.added || r.merged ? `<span class="text-emerald-600">Added ${r.added + r.merged} ${r.added + r.merged === 1 ? "card" : "cards"}${r.merged ? ` (${r.merged} were already there, so their count went up)` : ""}.</span>` : "", r.notFound?.length ? `<span class="block text-red-700">Not found on Scryfall: ${r.notFound.slice(0, 15).map(esc).join(", ")}${r.notFound.length > 15 ? ` and ${r.notFound.length - 15} more` : ""}</span>` : "", r.guessed?.length ? `<span class="block text-amber-700">Matched by name, check these: ${r.guessed.slice(0, 10).map(esc).join("; ")}</span>` : ""].join("");

  $("photo").onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    const lst = await chosenList();
    const lines = [];
    for (let i = 0; i < files.length; i++) {
      say(`${lines.join("")}<span class="block text-slate-500">Reading photo ${i + 1} of ${files.length}…</span>`);
      try {
        const r = await api("/collection/photo", { image: await shrinkPhoto(files[i]), condition: $("addCond").value, list: lst }, { password: true, why: "This calls a paid AI model, so it needs your dashboard password." });
        lines.push(`<span class="block">${r.added + r.merged ? "✓" : "✗"} ${esc(r.read?.name || "")} ${r.read?.set_code ? `(${esc(r.read.set_code.toUpperCase())} #${esc(r.read.collector_number || "?")}${r.read.foil === "foil" ? ", foil" : ""})` : ""}${r.notFound?.length ? ' <span class="text-red-700">not found on Scryfall; search it by name instead</span>' : ""}</span>`);
      } catch (err) {
        lines.push(`<span class="block text-red-700">✗ Photo ${i + 1}: ${esc(err.message)}</span>`);
      }
    }
    say(lines.join(""));
    load();
  };

  $("csv").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const lst = await chosenList();
    say('<span class="text-slate-500">Matching every row on Scryfall…</span>');
    try {
      const r = await api("/collection/import", { csv: await file.text(), list: lst });
      say(`${r.rows} rows read. ${result(r)}`);
      load();
    } catch (err) { say(`<span class="text-red-700">${esc(err.message)}</span>`); }
  };

  // A name box with a dropdown of card names that match what's typed (250 ms after the last key); clicking one calls onPick(name).
  function suggestNames(input, box, onPick) {
    let timer;
    input.oninput = () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) return box.classList.add("hidden");
      timer = life.later(async () => {
        const names = await api(`/collection/search?q=${encodeURIComponent(q)}`).catch(() => []);
        box.innerHTML = names.map((n) => `<button class="block w-full text-left px-3 py-2 hover:bg-slate-100" data-name="${esc(n)}">${esc(n)}</button>`).join("");
        box.classList.toggle("hidden", !names.length);
      }, 250);
    };
    box.onclick = (e) => {
      const b = e.target.closest("[data-name]");
      if (b) onPick(b.dataset.name);
    };
  }
  suggestNames($("q"), $("sugg"), (name) => pickName(name));

  async function pickName(name) {
    $("sugg").classList.add("hidden");
    $("q").value = name;
    $("prints").classList.remove("hidden");
    $("prints").innerHTML = '<p class="text-sm text-slate-500">Loading printings…</p>';
    const list = await api(`/collection/printings?name=${encodeURIComponent(name)}`).catch((err) => (showErr(err.message), []));
    $("prints").innerHTML = `<p class="text-sm text-slate-500 mb-2">Pick the printing you have (${list.length}). Newest first.</p><div class="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-2">${list.map((p) => `<div class="text-xs"><img class="pick" loading="lazy" src="${esc(p.image || "")}" alt="" /><div class="mt-1 truncate">${esc(p.setName)}</div><div class="text-slate-500">#${esc(p.number)} · ${p.prices.usd != null ? cad(p.prices.usd) : p.prices.usdFoil != null ? `${cad(p.prices.usdFoil)} foil` : "no price"}</div><div class="mt-1 flex gap-1 flex-wrap">${(p.finishes.length ? p.finishes : ["nonfoil"]).map((f) => `<button class="px-2 py-0.5 rounded border border-slate-300" data-add="${esc(p.scryfallId)}" data-fin="${esc(f)}">+ ${f === "nonfoil" ? "regular" : esc(f)}</button>`).join("")}</div></div>`).join("")}</div>`;
    $.all("[data-add]").forEach((b) => (b.onclick = async () => {
      try {
        b.disabled = true;
        const r = await api("/collection/add", { cards: [{ scryfallId: b.dataset.add, finish: b.dataset.fin, condition: $("addCond").value, lists: $("addList").value && $("addList").value !== "__new" ? [$("addList").value] : [] }] });
        say(result(r));
        b.textContent = "✓ added";
        load();
      } catch (err) { showErr(err.message); b.disabled = false; }
    }));
  }

  async function refresh() {
    const b = $("refresh");
    b.disabled = true;
    b.textContent = "Refreshing…";
    try { await api("/collection/refresh", {}); } catch (err) { showErr(err.message); }
    load();
  }

  $("filter").oninput = () => ((shown = 60), render());
  // Opened from Search everything: start with that search typed in.
  { const q0 = opts.embedded ? opts.q : new URLSearchParams(location.search).get("q"); if (q0) $("filter").value = q0; }
  $("sort").onchange = render;
  $("addList").onchange = async () => {
    if ($("addList").value === "__new") {
      const n = await chosenList();
      if (n) { data.lists = [...new Set([...data.lists, n])]; render(); $("addList").value = n; } else $("addList").value = "";
    }
  };

  // Worth selling: market value above the trade-up limit and not kept, or spare copies past 4 (basics left out).
  let tradeSettings = null;
  function drawSell() {
    if (!data.cards.length) return ($("sell").innerHTML = '<p class="text-sm text-slate-500">No cards yet.</p>');
    const keep = tradeSettings?.keep || ["Deck", "Keep", "Commander"], min = tradeSettings?.maxEach ?? 5;
    $("sellMin").textContent = min;
    const kept = (c) => (c.lists || []).some((l) => keep.some((k) => l.toLowerCase().startsWith(k.toLowerCase())));
    const basic = /^(snow-covered )?(plains|island|swamp|mountain|forest|wastes)$/i;
    const r = rate() || 1, rows = [];
    const byName = {};
    for (const c of data.cards) if (!basic.test(c.name)) (byName[c.name] ||= []).push(c);
    for (const [name, cs] of Object.entries(byName)) {
      // Copies in a deck or keep list are never suggested. Free copies over the limit go; then, if there are still more
      // than 4 copies in all, the other free copies past the 4th (dearest first).
      const free = cs.filter((c) => !kept(c) && c.each != null).sort((a, b) => b.each - a.each);
      const high = free.filter((c) => c.each * r > min).reduce((t, c) => t + c.qty, 0);
      let spare = Math.max(0, cs.reduce((t, c) => t + c.qty, 0) - 4 - high);
      for (const c of free) {
        const each = c.each * r;
        const over = each > min ? c.qty : 0;
        const extra = Math.min(c.qty - over, spare);
        spare -= extra;
        if (over + extra > 0 && each >= 0.5) rows.push({ c, n: over + extra, each, why: over ? "not in a deck" : "spare copies" });
      }
    }
    rows.sort((a, b) => b.n * b.each - a.n * a.each);
    const sum = rows.reduce((t, x) => t + x.n * x.each, 0);
    $("sell").innerHTML = rows.length ? `<p class="text-sm mb-2"><b>${rows.reduce((t, x) => t + x.n, 0)} cards</b> worth about <b>CA$${sum.toFixed(2)}</b> at market price.</p><ul class="text-sm space-y-1">${rows.slice(0, 25).map((x) => `<li class="flex gap-2"><span class="flex-1 min-w-0 truncate">${x.n > 1 ? `${x.n}× ` : ""}${esc(x.c.name)} <span class="text-slate-500">${esc(String(x.c.set || "").toUpperCase())}${x.c.finish !== "nonfoil" ? ` ${esc(x.c.finish)}` : ""} · ${x.why}</span></span><span class="whitespace-nowrap">CA$${(x.each * x.n).toFixed(2)}</span></li>`).join("")}</ul>${rows.length > 25 ? `<p class="text-sm text-slate-500 mt-1">and ${rows.length - 25} more.</p>` : ""}` : '<p class="text-sm text-slate-500">Nothing stands out: every card over the limit is in a deck or keep list.</p>';
  }

  // Trade-up (tradeup.js): suggestions only.
  let tradePoll = null;
  const money = (n) => fmtMoney(n, "CA$", "?");
  async function loadTrade() {
    let t;
    try { t = await api("/collection/tradeup"); } catch (err) { $("tradeMsg").textContent = err.message; return; }
    $("keepNames").textContent = t.settings.keep.map((k) => `"${k}"`).join(", ");
    tradeSettings = t.settings;
    drawSell();
    if (document.activeElement !== $("minEach")) $("minEach").value = t.settings.minEach;
    if (document.activeElement !== $("maxEach")) $("maxEach").value = t.settings.maxEach;
    $("pileSum").innerHTML = `Trade pile: <b>${t.pileCount.toLocaleString()} cards</b> worth about <b>${money(t.pileValue)}</b> at market price. Stores usually give less than market in trade, so treat this as the top end.`;
    $("pileRows").innerHTML = t.pile.slice(0, 120).map((c) => `<div class="py-1 flex gap-2"><span class="flex-1 truncate">${c.qty > 1 ? `${c.qty}× ` : ""}${esc(c.name)} <span class="text-slate-500">${esc(c.set.toUpperCase())}${c.finish !== "nonfoil" ? ` ${c.finish}` : ""}</span></span><span>${money(c.eachCad)}</span></div>`).join("") || '<div class="py-1 text-slate-500">Nothing in the pile with these limits.</div>';
    $("wants").innerHTML = t.wants.map((w) => `<div class="py-2"><div class="flex gap-2 items-center"><span class="flex-1 font-medium truncate">${esc(w.name)} <span class="text-xs text-slate-500">${esc((w.set || "").toUpperCase())}${w.finish === "foil" ? " foil" : ""}</span></span><span>${money(w.priceCad)}${w.targetCad != null && w.priceCad != null && w.priceCad <= w.targetCad ? " ✓ at target" : ""}</span><button data-unwant="${esc(w.scryfallId)}" data-fin="${esc(w.finish)}" class="text-xs text-red-700">Remove</button></div>
      <div class="flex gap-2 items-center mt-1 text-xs text-slate-500"><label>Alert me at CA$ <input type="number" min="0" step="0.5" inputmode="decimal" value="${w.targetCad ?? ""}" data-target="${esc(w.scryfallId)}" data-tfin="${esc(w.finish)}" class="w-20 rounded border border-slate-300 px-1 py-0.5" placeholder="price" /></label>${w.wasUsd != null && w.usd != null && w.wasUsd !== w.usd ? `<span>${w.usd < w.wasUsd ? "↓" : "↑"} since the last check</span>` : ""}</div>
      ${w.cover ? `<div class="text-xs text-slate-500 mt-0.5">${w.cover.enough ? `Covered by ${w.cover.cards.reduce((s, c) => s + c.use, 0)} pile cards (${money(w.cover.total)}): ` : `The whole pile only reaches ${money(w.cover.total)}: `}${w.cover.cards.slice(0, 12).map((c) => `${c.use > 1 ? `${c.use}× ` : ""}${esc(c.name)}`).join(", ")}${w.cover.cards.length > 12 ? "…" : ""}</div>` : ""}</div>`).join("") || '<div class="py-1 text-slate-500">No wants yet. Search a card above, or use an idea below.</div>';
    const i = t.ideas;
    $("ideasBtn").disabled = t.task?.running;
    $("ideas").innerHTML = t.task?.running ? "Claude is thinking…" : t.task?.error ? `<span class="text-red-700">Ideas failed: ${esc(t.task.error)}</span>` : i ? `<div class="font-medium mt-2">Ideas (${day(i.at)})</div><p class="text-slate-500">${esc(i.note)}</p>${i.list.map((x) => `<div class="py-2 flex gap-2 items-start border-t border-slate-100"><div class="flex-1"><div class="font-medium">${esc(x.name)} <span class="text-xs text-slate-500">${esc(x.kind)}</span></div><div class="text-xs text-slate-500">${esc(x.why)}</div></div><div class="text-right shrink-0">${money(x.priceCad)}<br>${x.scryfallId ? `<button data-wantid="${esc(x.scryfallId)}" class="text-xs text-red-700">Want it</button>` : ""}</div></div>`).join("")}` : "";
    clearTimeout(tradePoll);
    if (t.task?.running) tradePoll = life.later(loadTrade, 4000);
  }
  $("tradeSave").onclick = async () => {
    try { await api("/collection/tradeup/settings", { minEach: $("minEach").value, maxEach: $("maxEach").value }); $("tradeMsg").textContent = "Saved."; } catch (err) { $("tradeMsg").textContent = err.message; }
    loadTrade();
  };
  $("ideasBtn").onclick = async () => {
    try { await api("/collection/tradeup/ideas", {}, { password: true, why: "This calls a paid AI model, so it needs your dashboard password." }); } catch (err) { $("tradeMsg").textContent = err.message; }
    loadTrade();
  };
  $("tradeCard").addEventListener("click", async (e) => {
    const un = e.target.closest("[data-unwant]"), want = e.target.closest("[data-wantid]");
    try {
      if (un) await api("/collection/tradeup/unwant", { scryfallId: un.dataset.unwant, finish: un.dataset.fin });
      if (want) { want.disabled = true; await api("/collection/tradeup/want", { scryfallId: want.dataset.wantid }); }
    } catch (err) { $("tradeMsg").textContent = err.message; }
    if (un || want) loadTrade();
  });
  // Price target: saved when the box loses focus or Enter is pressed.
  $("wants").addEventListener("change", async (e) => {
    const i = e.target.closest("[data-target]");
    if (!i) return;
    try { await api("/collection/tradeup/target", { scryfallId: i.dataset.target, finish: i.dataset.tfin, targetCad: i.value.trim() }); loadTrade(); } catch (err) { await confirmBox({ title: "", text: err.message, no: null }); }
  });
  suggestNames($("wantQ"), $("wantSugg"), async (name) => {
    $("wantSugg").classList.add("hidden");
    $("wantQ").value = "";
    try { await api("/collection/tradeup/want", { name }); } catch (err) { $("tradeMsg").textContent = err.message; }
    loadTrade();
  });
  loadTrade();
  load();
  onResize(render);

  // ---------- Many cards in one photo (review, then add) ----------
  // Shows what was read with a tick box per card; onAdd(cards) gets the ticked ones as add-ready items.
  function reviewList(box, r, { label, onAdd }) {
    const rows = r.cards.map((c, i) => {
      const m = c.match;
      return `<label class="py-2 flex gap-3 items-center"><input type="checkbox" data-rv="${i}" ${m ? "checked" : "disabled"} />${m?.image ? `<img src="${esc(m.image)}" class="thumb" alt="" loading="lazy" />` : '<span class="thumb"></span>'}<span class="flex-1 min-w-0"><span class="block font-medium">${esc(m?.name || c.read.name)}</span><span class="block text-xs text-slate-500">${m ? `${esc(m.setName || m.set.toUpperCase())} #${esc(m.number)}${m.finish === "foil" ? " · foil" : ""}${m.guessed ? ' · <span class="text-amber-700">matched by name, check the printing</span>' : ""}${c.read.confidence !== "high" ? ' · <span class="text-amber-700">not sure of this read</span>' : ""}` : '<span class="text-red-700">not found on Scryfall; add it by name</span>'}</span></span><span class="text-sm shrink-0">${m ? cad(m.each) : ""}</span></label>`;
    }).join("");
    box.innerHTML = `<div class="mt-2 rounded-lg border border-slate-200 p-3"><p class="text-sm">Read ${r.cards.length} card${r.cards.length === 1 ? "" : "s"}${r.unreadable ? `, <span class="text-amber-700">${r.unreadable} I couldn't name</span>` : ""}. Untick any that are wrong.</p><div class="divide-y divide-slate-100">${rows}</div><div class="mt-2 flex gap-2"><button data-rvadd class="text-sm px-3 py-1.5 rounded-lg bg-red-600 text-white">${esc(label)}</button><button data-rvcancel class="text-sm px-3 py-1.5 rounded-lg border border-slate-300">Cancel</button></div></div>`;
    box.querySelector("[data-rvcancel]").onclick = () => (box.innerHTML = "");
    box.querySelector("[data-rvadd]").onclick = async (e) => {
      const picked = [...box.querySelectorAll("[data-rv]:checked")].map((x) => r.cards[x.dataset.rv].match).filter(Boolean).map((m) => ({ scryfallId: m.scryfallId, name: m.name, finish: m.finish }));
      if (!picked.length) return;
      e.target.disabled = true;
      e.target.textContent = "Adding…";
      try { await onAdd(picked); box.innerHTML = ""; } catch (err) { e.target.disabled = false; e.target.textContent = err.message; }
    };
  }
  async function readMany(file, msgEl) {
    const stop = (() => { const t0 = Date.now(); const h = life.every(() => (msgEl.innerHTML = `<span class="text-slate-500">Reading every card in the photo… ${Math.round((Date.now() - t0) / 1000)} s (usually under a minute)</span>`), 1000); return () => clearInterval(h); })();
    try { return await api("/collection/photo-multi", { image: await shrinkPhoto(file, 2000) }, { password: true, why: "This calls a paid AI model, so it needs your dashboard password." }); } finally { stop(); msgEl.innerHTML = ""; }
  }
  $("photoMulti").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const lst = await chosenList();
    try {
      const r = await readMany(file, $("addMsg"));
      reviewList($("multiReview"), r, { label: "Add ticked cards", onAdd: async (cards) => {
        const res = await api("/collection/add", { cards: cards.map((c) => ({ ...c, condition: $("addCond").value, lists: lst ? [lst] : [] })) });
        say(result(res));
        load();
      } });
    } catch (err) { say(`<span class="text-red-700">${esc(err.message)}</span>`); }
  };

  // ---------- Trades ----------
  let trades = [], openTrade = null;
  const tmoney = money;
  const SOURCES = { tcg: "TCGplayer", [`${STORES.buylistKey}_retail`]: `${STORES.buylist} retail`, [`${STORES.buylistKey}_buylist`]: `${STORES.buylist} buylist` };
  const BASIS = { tcg: "TCGplayer", [`${STORES.buylistKey}_retail`]: `${STORES.buylistShort} retail`, [`${STORES.buylistKey}_buylist`]: `${STORES.buylistShort} buylist`, manual: "your price" };
  async function loadTrades() {
    try { trades = (await api("/collection/trades")).trades; } catch (err) { $("tradesMsg").textContent = err.noRoute ? "The app needs a restart to load trades." : err.message; return; }
    if (!openTrade && trades[0]?.status === "draft") openTrade = trades[0].id;
    drawTrades();
  }
  function sideHtml(t, s) {
    const v = t[s];
    const done = t.status === "done";
    const rows = v.rows.map((r) => `<div class="py-2 flex gap-2 items-center">${r.image ? `<img src="${esc(r.image)}" class="thumb" alt="" loading="lazy" />` : '<span class="thumb"></span>'}<div class="flex-1 min-w-0"><div class="font-medium truncate">${esc(r.name)}</div><div class="text-xs text-slate-500">${esc((r.set || "").toUpperCase())} #${esc(r.number || "?")}${r.finish !== "nonfoil" ? ` · ${esc(r.finish)}` : ""} · ${esc(r.condition)}${s === "out" && !done ? (r.collectionId ? ` · you have ${r.owned}` : ' · <span class="text-red-700">not in your collection</span>') : ""}${r.buylistPrice ? ` · ${esc(STORES.buylistShort)} buys CA$${Number(r.buylistPrice.buylist).toFixed(2)}` : ""}</div></div><div class="text-right shrink-0 space-y-1"><div class="text-sm">${r.totalCad != null ? tmoney(r.totalCad) : "no price"}</div><div class="text-xs ${r.basis === "manual" ? "text-amber-700" : "text-slate-500"}">${BASIS[r.basis] || ""}${r.basis === "tcg" && v.pricing.source !== "tcg" ? ` (no ${esc(STORES.buylistShort)} price)` : ""}</div>${done ? `<div class="text-xs text-slate-500">×${r.qty}</div>` : `<div class="flex gap-1 justify-end"><input type="number" min="0" step="0.01" value="${r.manualCad ?? ""}" placeholder="${r.eachCad != null ? r.eachCad.toFixed(2) : "CA$"}" data-tp="${esc(r.key)}" data-ts="${s}" class="w-20 text-right text-sm" aria-label="Your price each, CA$" title="Your price each (CA$); clear it to go back" /><input type="number" min="0" max="99" value="${r.qty}" data-tq="${esc(r.key)}" data-ts="${s}" class="w-14 text-right text-sm" aria-label="Quantity" /></div>`}</div></div>`).join("") || '<p class="py-2 text-sm text-slate-500">No cards yet.</p>';
    const tools = done ? "" : `<div class="flex gap-2 flex-wrap mt-2"><label class="text-sm cursor-pointer px-3 py-1.5 rounded-lg border border-slate-300">Snap this pile<input type="file" accept="image/*" capture="environment" class="hidden" data-tsnap="${s}" /></label><input data-tname="${s}" list="tradeNames" placeholder="${s === "out" ? "Card from your collection" : "Card name"}" class="flex-1 min-w-[10rem] text-sm" /><button data-tadd="${s}" class="text-sm px-3 py-1.5 rounded-lg border border-slate-300">Add</button></div><div data-trv="${s}"></div>`;
    const pick = `<div class="flex gap-2 items-center text-sm mt-1">Priced at <select data-tsrc="${s}" ${done ? "disabled" : ""}>${Object.entries(SOURCES).map(([k, l]) => `<option value="${k}" ${v.pricing.source === k ? "selected" : ""}>${l}</option>`).join("")}</select><input data-tpct="${s}" type="number" min="10" max="200" value="${v.pricing.percent}" class="w-16 text-right" ${done ? "disabled" : ""} aria-label="Percent of that price" />%</div>`;
    return `<div class="min-w-0"><div class="flex items-baseline gap-2"><h3 class="font-medium flex-1">${s === "out" ? "Going out" : "Coming in"} <span class="text-sm text-slate-500">(${v.cards})</span></h3><b>${tmoney(v.cad)}</b></div>${pick}${v.unpriced ? `<p class="text-xs text-amber-700">${v.unpriced} with no price</p>` : ""}${v.fellBack ? `<p class="text-xs text-amber-700">${v.fellBack} not on the ${esc(STORES.buylist)} sheet, so TCGplayer is used for ${v.fellBack === 1 ? "it" : "them"}</p>` : ""}<div class="divide-y divide-slate-100">${rows}</div>${tools}</div>`;
  }
  function drawTrades() {
    const names = [...new Set((data.cards || []).map((c) => c.name))].sort();
    $("trades").innerHTML = `<datalist id="tradeNames">${names.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>` + (trades.length ? trades.map((t) => {
      const isOpen = openTrade === t.id;
      const head = `${t.partner ? esc(t.partner) : "Trade"} · ${new Date(t.createdAt).toLocaleDateString()} · ${t.status === "done" ? `<span class="text-emerald-600">done</span>` : '<span class="text-amber-700">draft</span>'} · out ${tmoney(t.out.cad)} / in ${tmoney(t.in.cad)}`;
      if (!isOpen) return `<button data-topen="${esc(t.id)}" class="block w-full text-left text-sm py-2 border-t border-slate-100">${head}</button>`;
      const done = t.status === "done";
      return `<div class="rounded-lg border border-slate-200 p-3 space-y-3" data-tid="${esc(t.id)}">
        <div class="flex gap-2 flex-wrap items-center"><input data-tpartner value="${esc(t.partner || "")}" placeholder="Who with (optional)" class="flex-1 min-w-[10rem] text-sm" ${done ? "disabled" : ""} /><button data-tclose class="text-sm text-slate-500">Close</button></div>
        <div class="grid md:grid-cols-2 gap-4">${sideHtml(t, "out")}${sideHtml(t, "in")}</div>
        <div class="flex gap-2 flex-wrap items-center text-sm">Cash <select data-tway ${done ? "disabled" : ""}><option value="none" ${t.cash?.way === "none" ? "selected" : ""}>none</option><option value="in" ${t.cash?.way === "in" ? "selected" : ""}>you get</option><option value="out" ${t.cash?.way === "out" ? "selected" : ""}>you pay</option></select><input data-tcash type="number" min="0" step="0.01" value="${t.cash?.cad || ""}" placeholder="CA$" class="w-24 text-right" ${done ? "disabled" : ""} /></div>
        <p class="font-medium ${t.net != null && t.net < -Math.max(2, Math.max(t.out.cad || 0, t.in.cad || 0) * 0.1) ? "text-red-700" : t.net != null && t.net > 0 ? "text-emerald-600" : ""}">${esc(t.verdict)}</p>
        ${!done && t.missing.length ? `<p class="text-sm text-red-700">Short: ${t.missing.map(esc).join("; ")}</p>` : ""}
        ${done && t.valueAtTrade ? `<p class="text-xs text-slate-500">At the time: out ${tmoney(t.valueAtTrade.outCad)}, in ${tmoney(t.valueAtTrade.inCad)}. Done ${new Date(t.doneAt).toLocaleString()}.</p>` : ""}
        <div class="flex gap-2 flex-wrap">${done ? `<button data-tundo class="text-sm px-3 py-1.5 rounded-lg border border-slate-300">Undo trade</button>` : `<button data-tconfirm class="text-sm px-3 py-1.5 rounded-lg bg-red-600 text-white">Confirm trade</button><button data-tdelete class="text-sm px-3 py-1.5 rounded-lg border border-slate-300">Delete draft</button>`}<span data-tmsg class="text-sm self-center"></span></div>
      </div>`;
    }).join("") : '<p class="text-sm text-slate-500">No trades yet.</p>');
    wireTrades();
  }
  const tcall = async (id, what, body = {}) => {
    const r = await api(`/collection/trades/${id}/${what}`, body);
    const t = r.trade || r;
    if (t?.id) trades = trades.map((x) => (x.id === t.id ? t : x));
    return r;
  };
  function wireTrades() {
    $.all("[data-topen]").forEach((b) => (b.onclick = () => { openTrade = b.dataset.topen; drawTrades(); }));
    const box = $.one("[data-tid]");
    if (!box) return;
    const id = box.dataset.tid;
    const msg = (m, bad) => (box.querySelector("[data-tmsg]").innerHTML = `<span class="${bad ? "text-red-700" : "text-slate-600"}">${esc(m)}</span>`);
    const run = async (fn) => { try { await fn(); drawTrades(); } catch (err) { msg(err.message, true); } };
    box.querySelector("[data-tclose]").onclick = () => { openTrade = null; drawTrades(); };
    const p = box.querySelector("[data-tpartner]");
    if (p) p.onchange = () => run(() => tcall(id, "edit", { partner: p.value }));
    const way = box.querySelector("[data-tway]"), cash = box.querySelector("[data-tcash]");
    if (way) way.onchange = cash.onchange = () => run(() => tcall(id, "edit", { cash: { way: way.value, cad: cash.value } }));
    box.querySelectorAll("[data-tp]").forEach((i) => (i.onchange = () => run(() => tcall(id, "item", { side: i.dataset.ts, key: i.dataset.tp, manualCad: i.value }))));
    box.querySelectorAll("[data-tsrc], [data-tpct]").forEach((el) => (el.onchange = () => {
      const sd = el.dataset.tsrc || el.dataset.tpct;
      run(() => tcall(id, "edit", { pricing: { [sd]: { source: box.querySelector(`[data-tsrc="${sd}"]`).value, percent: box.querySelector(`[data-tpct="${sd}"]`).value } } }));
    }));
    box.querySelectorAll("[data-tq]").forEach((i) => (i.onchange = () => run(() => tcall(id, "item", { side: i.dataset.ts, key: i.dataset.tq, qty: i.value }))));
    box.querySelectorAll("[data-tadd]").forEach((b) => (b.onclick = () => run(async () => {
      const s = b.dataset.tadd, name = box.querySelector(`[data-tname="${s}"]`).value.trim();
      if (!name) return;
      const own = s === "out" ? (data.cards || []).filter((c) => c.name.toLowerCase() === name.toLowerCase()).sort((a, b2) => (b2.each || 0) - (a.each || 0))[0] : null;
      if (own) await tcall(id, "pick", { cardId: own.id, qty: 1 });
      else {
        const r = await tcall(id, "add", { side: s, cards: [{ name }] });
        if (r.notFound?.length) throw new Error(`Not found on Scryfall: ${r.notFound.join(", ")}`);
      }
    })));
    box.querySelectorAll("[data-tsnap]").forEach((inp) => (inp.onchange = async (e) => {
      const s = inp.dataset.tsnap, file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      const rv = box.querySelector(`[data-trv="${s}"]`);
      try {
        const r = await readMany(file, rv);
        reviewList(rv, r, { label: `Add to ${s === "out" ? "going out" : "coming in"}`, onAdd: async (cards) => { await tcall(id, "add", { side: s, cards, source: "photo" }); drawTrades(); } });
      } catch (err) { msg(err.message, true); }
    }));
    const c = box.querySelector("[data-tconfirm]");
    if (c) c.onclick = () => run(async () => {
      if (c.dataset.sure !== "1") { c.dataset.sure = "1"; c.textContent = "Tap again to confirm"; throw new Error("This updates your collection."); }
      c.disabled = true;
      c.textContent = "Confirming…";
      try { await tcall(id, "confirm"); } finally { c.disabled = false; }
      load();
    });
    const u = box.querySelector("[data-tundo]");
    if (u) u.onclick = () => run(async () => { await tcall(id, "undo"); load(); });
    const d = box.querySelector("[data-tdelete]");
    if (d) d.onclick = () => run(async () => {
      if (d.dataset.sure !== "1") { d.dataset.sure = "1"; d.textContent = "Tap again to delete"; throw new Error("Deletes this draft."); }
      await api(`/collection/trades/${id}/delete`, {});
      trades = trades.filter((x) => x.id !== id);
      openTrade = null;
    });
  }
  $("newTrade").onclick = async () => {
    try { const t = await api("/collection/trades", {}); trades.unshift(t); openTrade = t.id; drawTrades(); } catch (err) { $("tradesMsg").textContent = err.message; }
  };
  loadTrades();

  // Deck lists (2026-10-23): pasted names -> one list on the owned copies. Check first, then Save.
  async function deckRun(save) {
    $("deckMsg").textContent = save ? "Saving…" : "Checking…";
    $("deckSave").disabled = true;
    let r;
    try { r = await api("/collection/decklist", { list: $("deckName").value, text: $("deckText").value, save }); }
    catch (err) { $("deckMsg").textContent = err.noRoute ? "The app needs a restart for deck lists." : err.message; $("deckSave").disabled = false; return; }
    $("deckSave").disabled = false;
    $("deckMsg").textContent = `${r.saved ? "Saved. " : ""}You own ${r.owned} of the ${r.cards} cards.`;
    const miss = r.missing.length ? `<p class="mt-1"><b>Not in your collection (${r.missing.reduce((t, x) => t + x.qty, 0)}):</b> ${r.missing.map((x) => esc(`${x.qty} ${x.name}${x.ownedSome ? " (you have fewer)" : ""}`)).join(", ")}</p>` : '<p class="mt-1">You own every card.</p>';
    const shared = r.shared.length ? `<p class="mt-1 text-slate-500">Also in another deck: ${r.shared.map((x) => esc(`${x.name} (${x.lists.join(", ")})`)).join(", ")}</p>` : "";
    $("deckOut").innerHTML = miss + shared;
    if (r.saved) load();
  }
  $("deckCheck").onclick = () => deckRun(false);
  $("deckSave").onclick = () => deckRun(true);
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
