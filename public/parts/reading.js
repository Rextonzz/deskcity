// Watching and reading: the page's working part as a block (see public/parts/kit.js). Mounted by public/reading.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, api, bindRoot } from "/stats-lib.js";
import { safeUrl } from "/lib.js";
import { confirmBox } from "/lib.js";
import { scope, lifecycle } from "/parts/kit.js";

export const html = `<style>
[data-block="reading"] .row { display: flex; gap: 12px; align-items: flex-start; padding: 10px 0; }
  [data-block="reading"] .row + .row { border-top: 1px solid var(--line-soft); }
  [data-block="reading"] .cover { width: 46px; height: 66px; border-radius: 6px; object-fit: cover; background: var(--surface-3); flex-shrink: 0; }
  [data-block="reading"] .pill { display: inline-block; font-size: 11px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--line-strong); color: var(--text-secondary); }
  [data-block="reading"] .newb { color: var(--good-text); font-weight: 600; }
  [data-block="reading"] .btn:hover { color: var(--text-primary); background: var(--surface-2); }
  [data-block="reading"] .btn.main { background: #dc2626; border-color: #dc2626; color: #fff; }
  [data-block="reading"] .seg button { font-size: 13px; padding: 5px 12px; border: 1px solid var(--line-strong); color: var(--text-secondary); background: none; }
  [data-block="reading"] .seg button:first-child { border-radius: 8px 0 0 8px; }
  [data-block="reading"] .seg button:last-child { border-radius: 0 8px 8px 0; border-left: none; }
  [data-block="reading"] .seg button.on { background: var(--surface-3); color: var(--text-primary); font-weight: 600; }
  [data-block="reading"] input,
  [data-block="reading"] select { background: var(--surface-2); border: 1px solid var(--line-strong); color: var(--text-primary); border-radius: 8px; padding: 5px 8px; font-size: 14px; }
  [data-block="reading"] .edit { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-top: 8px; }
  [data-block="reading"] .edit label { font-size: 12px; color: var(--text-muted); display: flex; flex-direction: column; gap: 3px; }
</style>
<div class="flex items-center gap-2 flex-wrap" data-head>
  <div class="flex flex-wrap gap-2"><button id="check" class="btn">Check for new now</button><a href="/api/pipeline/export/reading" class="btn" download>⬇ Download (CSV)</a></div>
</div>
<p id="note" class="text-sm text-slate-500"></p>

<section class="card space-y-3">
  <h2 class="font-semibold">Add a title</h2>
  <div class="flex flex-wrap gap-2 items-center">
    <div class="seg flex" id="kind"><button data-k="anime" class="on">Anime</button><button data-k="manga">Manga / manhwa</button></div>
    <input id="q" class="flex-1 min-w-0" style="min-width:180px" placeholder="Search a title" />
    <button id="search" class="btn main">Search</button>
    <button id="manual" class="btn">Add by hand</button>
  </div>
  <div id="results"></div>
</section>

<section class="card space-y-1"><h2 class="font-semibold">New for you</h2><div id="new"><p class="sub">Loading…</p></div></section>
<section class="card space-y-1"><h2 class="font-semibold">Watching and reading</h2><div id="active"></div></section>
<section id="laterBox" class="card space-y-1"><h2 class="font-semibold">Planning and paused</h2><div id="later"></div></section>
<section id="pastBox" class="card space-y-1"><h2 class="font-semibold">Finished and dropped</h2><div id="past"></div></section>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "reading";
  const $ = scope(root), life = lifecycle();
  bindRoot(root, life);
  let state = { items: [], where: [], statuses: [] }, kind = "anime", openId = opts.embedded ? (opts.open || null) : new URLSearchParams(location.search).get("open"), jumpTo = openId; // ?open= from Search everything
  const unit = (i) => (i.kind === "anime" ? "Ep" : "Ch");
  const n = (v) => (v == null ? "?" : Number.isInteger(v) ? v : Number(v).toFixed(1));
  const when = (iso) => {
    const ms = Date.parse(iso) - Date.now(), d = Math.round(ms / 864e5), h = Math.round(ms / 36e5);
    return ms < 0 ? "now" : h < 24 ? `in ${Math.max(1, h)} h` : `in ${d} day${d === 1 ? "" : "s"}`;
  };
  const ago = (iso) => {
    const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5);
    return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
  };
  const STATUS_LABEL = { watching: "Watching", reading: "Reading", planning: "Planning", paused: "Paused", done: "Finished", dropped: "Dropped" };

  function row(i) {
    const where = i.link ? `<a class="pill hover:underline" href="${esc(safeUrl(i.link))}" target="_blank" rel="noopener">${esc(i.where)} ↗</a>` : `<span class="pill">${esc(i.where)}</span>`;
    const prog = `${unit(i)} ${n(i.progress)}${i.latest != null ? ` of ${n(i.latest)} out` : ""}${i.total && i.ended ? ` (ended at ${n(i.total)})` : ""}`;
    const next = i.next ? ` · ${unit(i)} ${n(i.next.n)} ${when(i.next.at)}` : "";
    const fresh = i.behind > 0 ? `<span class="newb">${n(i.behind)} new</span>${i.latestAt ? ` <span class="sub">(latest ${ago(i.latestAt)})</span>` : ""}` : "";
    const acts = ["watching", "reading"].includes(i.status) ? `<button class="btn" data-act="bump" data-id="${i.id}">+1</button>${i.behind > 0 ? `<button class="btn" data-act="caught" data-id="${i.id}">Caught up</button>` : ""}` : "";
    return `<div class="row" id="r-${i.id}">
      ${i.image ? `<img class="cover" src="${esc(i.image)}" alt="" loading="lazy" />` : `<div class="cover"></div>`}
      <div class="flex-1 min-w-0">
        <div class="font-medium">${i.url ? `<a class="hover:underline" href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener">${esc(i.title)}</a>` : esc(i.title)}</div>
        <div class="text-sm text-slate-500">${prog}${next}</div>
        <div class="text-sm mt-1 flex flex-wrap gap-2 items-center">${where}${fresh}</div>
        ${openId === i.id ? editor(i) : ""}
      </div>
      <div class="flex flex-col gap-1 items-end">${acts}<button class="btn" data-act="open" data-id="${i.id}">${openId === i.id ? "Close" : "Edit"}</button></div>
    </div>`;
  }
  function editor(i) {
    const opt = (list, cur, label = (x) => x) => list.map((x) => `<option value="${esc(x)}"${x === cur ? " selected" : ""}>${esc(label(x))}</option>`).join("");
    return `<div class="edit" data-edit="${i.id}">
      <label>${i.kind === "anime" ? "Episodes watched" : "Chapters read"}<input type="number" step="any" min="0" name="progress" value="${i.progress ?? 0}" /></label>
      <label>Status<select name="status">${opt(state.statuses, i.status, (s) => STATUS_LABEL[s] || s)}</select></label>
      <label>Where<select name="where">${opt(state.where, i.where)}</select></label>
      <label>Your link (opens where you ${i.kind === "anime" ? "watch" : "read"})<input name="link" value="${esc(i.link || "")}" placeholder="https://" /></label>
      ${i.src ? "" : `<label>Latest out (by hand)<input type="number" step="any" min="0" name="latest" value="${i.latest ?? ""}" /></label>`}
      <div class="flex gap-2 items-end"><button class="btn main" data-act="save" data-id="${i.id}">Save</button><button class="btn" data-act="remove" data-id="${i.id}">Remove</button></div>
    </div>`;
  }
  const list = (items, empty) => (items.length ? items.map(row).join("") : `<p class="sub">${empty}</p>`);

  function draw(d) {
    state = d;
    const its = d.items;
    const byNew = (a, b) => (Date.parse(b.latestAt || 0) - Date.parse(a.latestAt || 0));
    $("new").innerHTML = list(its.filter((i) => i.behind > 0).sort(byNew), "Nothing new. You're caught up on everything you're following.");
    $("active").innerHTML = list(its.filter((i) => ["watching", "reading"].includes(i.status) && !(i.behind > 0)).sort((a, b) => a.title.localeCompare(b.title)), "Nothing here yet. Search for a title above to add it.");
    // Planning and finished lists only show once they have something in them (design review finding 17).
    const later = its.filter((i) => ["planning", "paused"].includes(i.status)), past = its.filter((i) => ["done", "dropped"].includes(i.status));
    $("later").innerHTML = list(later, ""); $("laterBox").hidden = !later.length;
    $("past").innerHTML = list(past, ""); $("pastBox").hidden = !past.length;
    $("note").textContent = `${d.checkedAt ? `Last checked ${new Date(d.checkedAt).toLocaleString()}. ` : ""}New episodes come from AniList (MyAnimeList when AniList is down) and new chapters from MangaUpdates, checked once a day. Hand-added titles keep the count you type.${d.checking ? " Checking now…" : ""}`;
  }
  async function load() {
    try { draw(await api("/reading")); if (jumpTo) { const el = $(`r-${jumpTo}`); el?.closest("details")?.setAttribute("open", ""); el?.scrollIntoView({ block: "center" }); jumpTo = null; } } catch (err) { $("note").textContent = err.noRoute ? "The app needs a restart to show this page." : err.message; }
  }

  $("kind").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    kind = b.dataset.k;
    [...$("kind").children].forEach((x) => x.classList.toggle("on", x === b));
  };
  let found = [];
  async function search() {
    const q = $("q").value.trim(); if (!q) return;
    $("results").innerHTML = '<p class="sub">Searching…</p>';
    try {
      found = await api("/reading/search", { q, kind });
      $("results").innerHTML = found.length ? found.map((r, k) => `<div class="row">${r.image ? `<img class="cover" src="${esc(r.image)}" alt="" loading="lazy" />` : '<div class="cover"></div>'}<div class="flex-1 min-w-0"><div class="font-medium">${esc(r.title)}</div><div class="text-sm text-slate-500">${esc(r.format || "")}${r.latest != null ? ` · ${r.kind === "anime" ? "Ep" : "Ch"} ${n(r.latest)} out` : ""}${r.ended ? " · ended" : ""}${r.next ? ` · next ${when(r.next.at)}` : ""}</div></div><div class="flex flex-col gap-1 items-end"><button class="btn main" data-add="${k}" data-st="${r.kind === "anime" ? "watching" : "reading"}">Add</button><button class="btn" data-add="${k}" data-st="planning">Plan to</button></div></div>`).join("") : '<p class="sub">Nothing found. Try another spelling, or Add by hand.</p>';
    } catch (err) { $("results").innerHTML = `<p class="text-sm text-red-700">${esc(err.message)}</p>`; }
  }
  $("search").onclick = search;
  $("q").onkeydown = (e) => { if (e.key === "Enter") search(); };
  $("results").onclick = async (e) => {
    const b = e.target.closest("[data-add]"); if (!b) return;
    b.disabled = true;
    try { await api("/reading/add", { ...found[b.dataset.add], status: b.dataset.st }); $("results").innerHTML = '<p class="sub">Added. Set how far you are with Edit.</p>'; load(); }
    catch (err) { b.disabled = false; $("results").insertAdjacentHTML("afterbegin", `<p class="text-sm text-red-700">${esc(err.message)}</p>`); }
  };
  $("manual").onclick = async () => {
    const title = $("q").value.trim();
    if (!title) { $("q").focus(); $("results").innerHTML = '<p class="sub">Type the title in the box first, then Add by hand.</p>'; return; }
    try { const it = await api("/reading/add", { title, kind, where: kind === "manga" ? "Kindle" : "Other" }); openId = it.id; $("results").innerHTML = ""; load(); }
    catch (err) { $("results").innerHTML = `<p class="text-sm text-red-700">${esc(err.message)}</p>`; }
  };

  life.on(root, "click", async (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const id = b.dataset.id, act = b.dataset.act;
    if (act === "open") { openId = openId === id ? null : id; return draw(state); }
    b.disabled = true;
    try {
      if (act === "bump") await api(`/reading/${id}`, { bump: true });
      if (act === "caught") await api(`/reading/${id}`, { caughtUp: true });
      if (act === "save") {
        const box = $.one(`[data-edit="${id}"]`);
        const body = Object.fromEntries([...box.querySelectorAll("[name]")].map((x) => [x.name, x.value]));
        await api(`/reading/${id}`, body);
        openId = null;
      }
      if (act === "remove") {
        if (!await confirmBox({ title: "Remove this title from your list?", yes: "Remove", no: "Cancel" })) { b.disabled = false; return; }
        await api(`/reading/${id}/remove`, {});
        openId = null;
      }
      await load();
    } catch (err) { b.disabled = false; $("note").textContent = err.message; }
  });

  $("check").onclick = async () => {
    $("check").disabled = true; $("check").textContent = "Checking…";
    try { const r = await api("/reading/check", {}); await load(); $("note").textContent = `Checked ${r.checked} title(s): ${r.updated} with something new${r.failed ? `, ${r.failed} couldn't be reached` : ""}.`; }
    catch (err) { $("note").textContent = err.message; }
    $("check").disabled = false; $("check").textContent = "Check for new now";
  };
  load();
  // Not while an edit is open: coming back from another app would wipe what was typed (code review 2026-10-22).
  life.on(document, "visibilitychange", () => { if (!document.hidden && !openId) load(); });
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
