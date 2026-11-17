// Deck ideas: the page's working part as a block (see public/parts/kit.js). Mounted by public/deckideas.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, api, bindRoot } from "/stats-lib.js";
import { when, money as fmtMoney, confirmBox } from "/lib.js";
import { scope, lifecycle } from "/parts/kit.js";

export const html = `<style>
[data-block="deckideas"] .btn.main { background: #dc2626; border-color: #dc2626; color: #fff; font-size: 14px; padding: 6px 14px; }
  [data-block="deckideas"] .btn:disabled { opacity: .5; }
  [data-block="deckideas"] input,
  [data-block="deckideas"] select { background: var(--surface-2); border: 1px solid var(--line-strong); color: var(--text-primary); border-radius: 8px; padding: 5px 8px; font-size: 14px; }
  [data-block="deckideas"] .sub { font-size: 13px; color: var(--text-muted); }
  [data-block="deckideas"] .pip { width: 30px; height: 30px; border-radius: 50%; border: 2px solid var(--line-strong); font-weight: 700; font-size: 13px; color: var(--text-secondary); background: none; }
  [data-block="deckideas"] .pip.on { border-color: var(--text-primary); color: var(--text-primary); background: var(--surface-3); }
  [data-block="deckideas"] .pip.on::after { content: " ✓"; font-size: 10px; }
  [data-block="deckideas"] .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
  [data-block="deckideas"] .tile { background: var(--surface-2); border-radius: 8px; padding: 6px 10px; }
  [data-block="deckideas"] .tile .v { font-size: 18px; font-weight: 600; }
  [data-block="deckideas"] .ln { display: flex; gap: 8px; font-size: 14px; padding: 2px 0; }
  [data-block="deckideas"] .ln .n { flex: 1; min-width: 0; }
  [data-block="deckideas"] .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
  [data-block="deckideas"] .grp { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); margin: 8px 0 2px; }
  [data-block="deckideas"] details > summary { cursor: pointer; font-size: 14px; color: var(--text-secondary); }
</style>
<section class="card space-y-3">
  <h2 class="font-semibold">Ask for ideas</h2>
  <div class="flex flex-wrap gap-3 items-center">
    <label class="sub">Format <select id="format"></select></label>
    <span class="sub">Colours</span>
    <span id="pips" class="flex gap-1"></span>
    <span class="sub" id="pipNote">any</span>
  </div>
  <input id="hint" maxlength="200" class="w-full" placeholder="Optional: a theme or commander, like &quot;graveyard&quot; or &quot;use Atraxa&quot;" />
  <div class="flex flex-wrap gap-2 items-center">
    <button id="go" class="btn main">Get 3 deck ideas · ~2 min</button>
    <span id="msg" class="sub">Uses a few cents of AI each time.</span>
  </div>
</section>
<div id="runs" class="space-y-5"><p class="sub">Loading…</p></div>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "deckideas";
  const $ = scope(root), life = lifecycle();
  bindRoot(root, life);
  const COLOURS = ["W", "U", "B", "R", "G"];
  const NAMES = { W: "white", U: "blue", B: "black", R: "red", G: "green" };
  let picked = new Set(), data = null, timer = null;
  const money = (n) => fmtMoney(n, "CA$", "no price");

  function pips() {
    $("pips").innerHTML = COLOURS.map((c) => `<button class="pip${picked.has(c) ? " on" : ""}" data-c="${c}" title="${NAMES[c]}" aria-pressed="${picked.has(c)}">${c}</button>`).join("");
    $("pipNote").textContent = picked.size ? [...picked].map((c) => NAMES[c]).join(", ") + " only" : "any";
    $.all("[data-c]").forEach((b) => (b.onclick = () => (picked.has(b.dataset.c) ? picked.delete(b.dataset.c) : picked.add(b.dataset.c), pips())));
  }

  const asText = (d) => [
    ...(d.commander ? [`1 ${d.commander}`, ""] : []),
    ...d.have.filter((c) => c.name !== d.commander).map((c) => `${c.qty} ${c.name}`),
    ...d.missing.filter((c) => c.name !== d.commander).map((c) => `${c.qty} ${c.name}`),
    ...d.basics.map((c) => `${c.qty} ${c.name}`),
  ].join("\n");

  // The phone reaches the hub over plain http, where navigator.clipboard doesn't exist (code review 2026-10-22).
  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    const t = document.createElement("textarea");
    t.value = text;
    t.setAttribute("readonly", "");
    t.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.append(t);
    t.select();
    const ok = document.execCommand("copy");
    t.remove();
    if (!ok) throw new Error("copy failed");
  }
  function deckCard(run, d, k) {
    const short = d.missing.reduce((t, c) => t + c.qty, 0);
    const sizeNote = d.count === d.size ? `${d.size} cards` : `${d.count} cards listed (a ${d.format} deck is ${d.size})`;
    const line = (c, right) => `<div class="ln"><span class="n">${c.scryfallUrl ? `<a class="hover:underline" href="${esc(c.scryfallUrl)}" target="_blank" rel="noopener">` : ""}${c.qty > 1 ? `${c.qty}× ` : ""}${esc(c.name)}${c.scryfallUrl ? "</a>" : ""}${c.decks?.length ? ` <span class="sub">also in ${esc(c.decks.join(", "))}</span>` : ""}</span>${right}</div>`;
    return `<section class="card space-y-3">
      <div class="flex flex-wrap gap-2 items-start">
        <div class="flex-1 min-w-0"><h3 class="font-semibold">${esc(d.name)}</h3><div class="sub">${esc(d.format)}${d.commander ? ` · ${esc(d.commander)}` : ""}${d.colours ? ` · ${esc(d.colours)}` : ""} · ${esc(sizeNote)}</div></div>
        <button class="btn" data-copy="${run.id}:${k}">Copy list</button>
      </div>
      <p class="text-sm">${esc(d.plan)}</p>
      <div class="tiles">
        <div class="tile"><div class="l">You own</div><div class="v">${d.owned} of ${d.count}</div><div class="l">${short ? `${short} short` : "ready to build ✓"}</div></div>
        <div class="tile"><div class="l">To finish</div><div class="v">${money(d.toFinishCad)}</div><div class="l">${!short ? "nothing to buy" : d.unpriced ? `plus ${d.unpriced} card${d.unpriced === 1 ? "" : "s"} with no price` : "for the missing cards"}</div></div>
        <div class="tile"><div class="l">Your cards in it</div><div class="v">${money(d.ownedValueCad)}</div><div class="l">market value</div></div>
      </div>
      <div class="cols">
        <div>
          <div class="grp">Missing (${short})</div>
          ${d.missing.length ? d.missing.map((c) => line(c, `<span class="whitespace-nowrap">${c.priceCad != null ? money(c.priceCad * c.qty) : c.real ? "no price" : "not found on Scryfall"}${c.notLegal ? ` · ⚠ not legal in ${esc(d.format)}` : ""}</span>`)).join("") : '<p class="sub">Nothing. You own every card.</p>'}
          <div class="grp">Upgrades to think about</div>
          ${d.upgrades.length ? d.upgrades.map((c) => `<div class="py-1"><div class="ln"><span class="n">${c.scryfallUrl ? `<a class="hover:underline" href="${esc(c.scryfallUrl)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)}</span><span class="whitespace-nowrap">${money(c.priceCad)}</span></div><div class="sub">${esc(c.why)}</div></div>`).join("") : '<p class="sub">None suggested.</p>'}
        </div>
        <div>
          <details${d.have.length < 30 ? " open" : ""}><summary>Cards you own in it (${d.have.reduce((t, c) => t + c.qty, 0)})</summary>
            ${d.have.map((c) => line(c, `<span class="sub whitespace-nowrap">${c.eachCad != null ? money(c.eachCad) : ""}</span>`)).join("")}
          </details>
          <div class="grp">Basic lands</div>
          <p class="text-sm">${d.basics.length ? d.basics.map((b) => `${b.qty} ${esc(b.name)}`).join(", ") : "None"}</p>
        </div>
      </div>
    </section>`;
  }

  function draw() {
    const t = data.task || {};
    $("go").disabled = !!t.running;
    $("go").textContent = t.running ? "Claude is building decks…" : "Get 3 deck ideas · ~2 min";
    if (t.error && !t.running) $("msg").textContent = `That didn't work: ${t.error}`;
    if (!data.runs.length) {
      $("runs").innerHTML = t.running ? '<p class="sub">Working on it. This page updates by itself.</p>' : '<p class="sub">No ideas yet. Pick a format and press the button.</p>';
      return;
    }
    $("runs").innerHTML = (t.running ? '<p class="sub">Working on new ideas. This page updates by itself.</p>' : "") + data.runs.map((run, i) => {
      const ask = [run.ask.format, run.ask.colours ? `colours ${run.ask.colours}` : "", run.ask.hint ? `"${run.ask.hint}"` : ""].filter(Boolean).join(" · ");
      const body = `<p class="sub">${esc(run.note)} Built from ${run.pool.toLocaleString()} of your cards.</p>${run.decks.map((d, k) => deckCard(run, d, k)).join("")}`;
      return `<div class="space-y-3"><div class="flex flex-wrap gap-2 items-center"><h2 class="font-semibold flex-1">${when(run.at)} <span class="sub">${esc(ask)}</span></h2><button class="btn" data-del="${run.id}">Remove</button></div>${i === 0 ? body : `<details><summary>Show ${run.decks.length} deck${run.decks.length === 1 ? "" : "s"}</summary><div class="space-y-3 mt-2">${body}</div></details>`}</div>`;
    }).join("");
    $.all("[data-copy]").forEach((b) => (b.onclick = async () => {
      const [id, k] = b.dataset.copy.split(":");
      const d = data.runs.find((r) => r.id === id).decks[k];
      try { await copyText(asText(d)); b.textContent = "Copied ✓"; } catch { b.textContent = "Couldn't copy"; }
      life.later(() => (b.textContent = "Copy list"), 2000);
    }));
    $.all("[data-del]").forEach((b) => (b.onclick = async () => {
      if (!await confirmBox({ title: "Remove these deck ideas?", yes: "Remove", no: "Cancel" })) return;
      data = { ...(await api(`/collection/deckideas/${b.dataset.del}/delete`, {})), task: data.task };
      draw();
    }));
  }

  async function load() {
    try { data = await api("/collection/deckideas"); } catch (err) { $("runs").innerHTML = `<p class="sub">${esc(err.noRoute ? "The app needs a restart to show this page." : err.message)}</p>`; return; }
    if (!$("format").options.length) $("format").innerHTML = data.formats.map((f) => `<option>${esc(f)}</option>`).join("");
    draw();
    clearTimeout(timer);
    if (data.task?.running) timer = life.later(load, 4000);
  }

  $("go").onclick = async () => {
    $("msg").textContent = "Uses a few cents of AI each time.";
    try {
      await api("/collection/deckideas", { format: $("format").value, colours: [...picked].join(""), hint: $("hint").value }, { password: true, why: "This calls a paid AI model, so it needs your dashboard password." });
      load();
    } catch (err) { $("msg").textContent = err.message; }
  };
  pips();
  load();
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
