// Price a card: the page's working part as a block (see public/parts/kit.js). Mounted by public/cards.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, safeUrl, api, shrinkPhoto, money, watchJob } from "/lib.js";
import { scope, lifecycle, needScripts } from "/parts/kit.js";
import { stores as STORES } from "/hubinfo.js";

export const html = `<section class="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
  <h2 class="font-semibold">Card price check</h2>
  <div class="flex gap-2 flex-wrap">
    <label class="flex-1 min-w-[10rem] text-center cursor-pointer bg-slate-800 hover:bg-slate-900 text-white font-medium px-4 py-2.5 rounded-lg">
      Snap a card…
      <input id="lkPhoto" type="file" accept="image/*" capture="environment" class="hidden" />
    </label>
  </div>
  <form id="lkForm" class="grid grid-cols-2 sm:grid-cols-[2fr_2fr_1fr_1fr_auto] gap-2 text-sm">
    <input id="lkName" placeholder="Card name" class="col-span-2 sm:col-span-1 rounded-lg border border-slate-300 px-3 py-2" />
    <input id="lkSet" placeholder="Set (optional)" class="col-span-2 sm:col-span-1 rounded-lg border border-slate-300 px-3 py-2" />
    <input id="lkNum" placeholder="Number" class="rounded-lg border border-slate-300 px-3 py-2" />
    <select id="lkFoil" class="rounded-lg border border-slate-300 px-2 py-2"><option value="unknown">Foil?</option><option value="nonfoil">Non-foil</option><option value="foil">Foil</option></select>
    <button class="col-span-2 sm:col-span-1 rounded-lg border border-slate-300 px-4 py-2 font-medium">Look up</button>
  </form>
  <div id="lkOut" class="text-sm"></div>
</section>

<a href="/collection.html" class="block bg-white rounded-xl border border-slate-200 p-4 text-sm hover:bg-slate-50">
  <h2 class="font-semibold">Your collection</h2>
  <p class="mt-1 text-slate-500">The cards you own, their value and your lists. Open it ›</p>
</a>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "cards";
  const $ = scope(root), life = lifecycle();
  await needScripts(["/timing.js"]);
  const cad = (n) => money(n, "CA$");
  const usd2 = (n) => money(n, "US$", "–");
  function priceBlock(title, body) {
    return `<div class="rounded-lg border border-slate-200 p-3"><div class="font-medium mb-1">${title}</div>${body}</div>`;
  }
  function storeRows(r, cols) {
    if (r.error) return `<p class="text-red-700">Couldn't check: ${esc(r.error)}</p>`;
    if (!r.rows?.length) return `<p class="text-slate-500">${r.searched === 0 && r.found ? "No exact name match on their site." : r.searched === 0 ? "Not found." : "None in stock."}</p>`;
    return `<table class="w-full"><tbody>${r.rows.slice(0, 8).map((x) => `<tr class="border-t border-slate-100 first:border-0"><td class="py-1 pr-2">${cols(x)}</td><td class="py-1 text-right whitespace-nowrap"><a class="text-red-700 hover:underline" target="_blank" rel="noopener" href="${esc(safeUrl(x.url))}">${cad(x.price)}</a></td></tr>`).join("")}</tbody></table>${r.rows.length > 8 ? `<p class="text-xs text-slate-500 mt-1">+${r.rows.length - 8} more</p>` : ""}`;
  }
  function renderLookup(d) {
    const t = d.prices.tcg;
    const fxc = (n) => (d.prices.fx && n != null ? `<span class="block text-xs text-slate-500">≈ CA$${(n * d.prices.fx.rate).toFixed(2)}</span>` : "");
    const tcg = t.error ? `<p class="text-red-700">${esc(t.error)}</p>` : `<p class="text-slate-500 mb-1"><a class="hover:underline" target="_blank" rel="noopener" href="${esc(safeUrl(t.url))}">${esc(t.product)}</a> · ${esc(t.set)}${t.number ? " #" + esc(t.number) : ""}</p>${t.note ? `<p class="text-amber-700 text-xs mb-1">${esc(t.note)}</p>` : ""}
      <table class="w-full"><tbody>${Object.entries(t.printings || {}).map(([k, v]) => `<tr><td class="py-0.5">${k === "foil" ? "Foil" : "Non-foil"}</td><td class="text-right">low <b>${usd2(v.low)}</b>${fxc(v.low)}</td><td class="text-right text-slate-500">3rd ${usd2(v.third)}${fxc(v.third)}</td></tr>`).join("")}</tbody></table><p class="text-xs text-slate-500 mt-1">Near Mint English listings${d.prices.fx ? ` · CA$ at the Bank of Canada rate ${d.prices.fx.rate.toFixed(4)} (${esc(d.prices.fx.date)})${d.prices.fx.stale ? ", last saved" : ""}` : ""}</p>`;
    const ch = storeRows(d.prices.shop, (x) => `${esc(x.store)} · ${esc(x.condition)}${x.foil ? " · foil" : ""}${x.language !== "English" ? " · " + esc(x.language) : ""} <span class="text-slate-500">${esc(x.set)} · ${x.qty} left</span>`);
    const bl = storeRows(d.prices.buylist, (x) => `${esc(x.variant)} <span class="text-slate-500">${esc(x.name)}</span>`);
    const r = d.read;
    $("lkOut").innerHTML = `${r ? `<p class="mb-2 ${r.confidence === "high" ? "text-slate-600" : "text-amber-700"}">Read as <b>${esc(r.name)}</b>, ${esc(r.set_name)}${r.collector_number ? " #" + esc(r.collector_number) : ""}${r.foil === "foil" ? ", foil" : r.foil === "unknown" ? ", foil unclear" : ""}${r.confidence !== "high" ? ". Not sure: fix the boxes above and press Look up." : "."}</p>` : ""}
      <div class="grid gap-2 sm:grid-cols-3">${priceBlock("TCGplayer", tcg)}${priceBlock(STORES.shop, ch)}${priceBlock(STORES.buylist, bl)}</div>`;
  }
  function showLookup(d) {
    if (d.error) return ($("lkOut").innerHTML = `<p class="text-red-700">${esc(d.error)}</p>`);
    $("lkName").value = d.card.name;
    $("lkSet").value = d.card.setName;
    $("lkNum").value = d.card.number;
    $("lkFoil").value = d.card.foil;
    renderLookup(d);
  }
  // A lookup keeps running on the PC if this page is left: coming back shows it running, or its result.
  async function resumeLookup() {
    const l = await api("/lookup/last").catch(() => null);
    if (!l) return;
    if (l.running) {
      $("lkOut").innerHTML = `<p class="text-slate-500" id="lkWait"></p><p class="text-amber-700" id="lkLost"></p>`;
      const offset = Date.now() - Date.parse(l.since);
      const stop = timing.ticker($("lkWait"), (ms) => `${l.photo ? "Reading the card and checking 3 stores" : "Checking 3 stores"}… ${timing.progressText({ elapsedMs: ms + offset, typicalMs: timing.typical(l.photo ? "lookup-photo" : "lookup") })}`);
      watchJob({ life,
        poll: () => api("/lookup/last"),
        lost: (err) => ($("lkLost").textContent = err ? err.message : ""),
        done: (n) => {
          stop();
          if (n.result) showLookup(n.result);
          else $("lkOut").innerHTML = `<p class="text-red-700">${esc(n.error || "Lookup failed")}</p>`;
        },
      })();
    } else if (l.result && Date.now() - Date.parse(l.at) < 30 * 60000 && !$("lkOut").textContent.trim()) showLookup(l.result);
  }
  resumeLookup();
  async function runLookup(body) {
    $("lkOut").innerHTML = `<p class="text-slate-500" id="lkWait"></p>`;
    const key = body.image ? "lookup-photo" : "lookup";
    const started = Date.now();
    const stop = timing.ticker($("lkWait"), (ms) => `${body.image ? "Reading the card and checking 3 stores" : "Checking 3 stores"}… ${timing.progressText({ elapsedMs: ms, typicalMs: timing.typical(key) })}`);
    try {
      const d = await api("/lookup", body, { password: true, why: "This calls a paid AI model, so it needs your dashboard password." });
      stop();
      if (!d.error) timing.remember(key, Date.now() - started);
      showLookup(d);
    } catch (err) {
      stop();
      $("lkOut").innerHTML = `<p class="text-red-700">${esc(err.noRoute ? "the app needs a restart to load the card price check" : err.message)}</p>`;
    }
  }
  $("lkPhoto").onchange = async () => {
    const file = $("lkPhoto").files[0];
    $("lkPhoto").value = "";
    if (!file) return;
    try {
      runLookup({ image: await shrinkPhoto(file) });
    } catch (err) {
      $("lkOut").innerHTML = `<p class="text-red-700">${esc(err.message)}</p>`;
    }
  };
  $("lkForm").onsubmit = (e) => {
    e.preventDefault();
    runLookup({ name: $("lkName").value, setName: $("lkSet").value, number: $("lkNum").value, foil: $("lkFoil").value });
  };
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
