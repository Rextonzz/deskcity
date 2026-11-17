// To-do and ideas: the page's working part as a block (see public/parts/kit.js). Mounted by public/todo.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, api, bindRoot } from "/stats-lib.js";
import { safeUrl } from "/lib.js";
import { today } from "/lib.js";
import { scope, lifecycle } from "/parts/kit.js";

export const html = `<style>
[data-block="todo"] .chip { font-size: 13px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line-strong); color: var(--text-secondary); white-space: nowrap; }
  [data-block="todo"] input,
  [data-block="todo"] select,
  [data-block="todo"] textarea { background: var(--surface-1); border: 1px solid var(--line-strong); border-radius: 8px; padding: 6px 10px; color: var(--text-primary); min-width: 0; }
</style>
<div class="flex items-center gap-2 flex-wrap" data-head>
  <a href="/api/pipeline/export/todo" class="px-3 py-1.5 rounded-lg border border-slate-300 text-sm" download>⬇ Download (CSV)</a>
</div>
<section class="card space-y-2">
  <div class="flex gap-2">
    <input id="idea" placeholder="An idea, a fix, anything" class="flex-1" maxlength="200" />
    <button id="add" class="px-4 py-2 rounded-lg bg-red-600 text-white font-medium">Add</button>
  </div>
  <div id="msg" class="text-sm"></div>
</section>

<section class="card space-y-3">
  <div id="statusChips" class="flex gap-2 flex-wrap"></div>
  <div id="catChips" class="flex gap-2 flex-wrap"></div>
  <datalist id="cats"></datalist>
  <div id="list" class="divide-y divide-slate-100"><p class="text-sm text-slate-500 py-2">Loading…</p></div>
</section>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "todo";
  const $ = scope(root), life = lifecycle();
  bindRoot(root, life);
  let data = { items: [], categories: [], counts: {} }, status = "open", cat = "";
  const STATUS = { open: "Open", doing: "Doing", done: "Done", dropped: "Dropped" };

  async function load() {
    try { data = await api("/todo"); } catch (err) { $("list").innerHTML = `<p class="text-red-700 text-sm">${esc(err.noRoute ? "The app needs a restart to show this page." : err.message)}</p>`; return; }
    draw();
  }
  function draw() {
    $("statusChips").innerHTML = Object.entries(STATUS).map(([k, l]) => `<button class="chip" data-st="${k}" aria-pressed="${status === k}">${l} ${data.counts[k] || 0}</button>`).join("");
    const inStatus = data.items.filter((i) => i.status === status);
    $("catChips").innerHTML = [["", "All"], ...data.categories.map((c) => [c, c])].map(([k, l]) => `<button class="chip" data-cat="${esc(k)}" aria-pressed="${cat === k}">${esc(l)} ${k ? inStatus.filter((i) => i.category === k).length : inStatus.length}</button>`).join("");
    $("cats").innerHTML = data.categories.map((c) => `<option value="${esc(c)}"></option>`).join("");
    const items = inStatus.filter((i) => !cat || i.category === cat);
    $("list").innerHTML = items.length ? items.map((i) => `<div class="py-3 space-y-1">
      <div class="font-medium">${esc(i.title)}</div>
      ${i.detail ? `<div class="text-sm text-slate-600">${esc(i.detail)}</div>` : ""}
      <div class="sub">${esc(i.source || "")} · ${esc(new Date(i.at).toLocaleDateString())}${i.link ? ` · <a href="${esc(safeUrl(i.link))}" class="hover:underline">open</a>` : ""}</div>
      <div class="flex gap-2 flex-wrap items-center text-sm">
        <input data-cat-of="${esc(i.id)}" list="cats" value="${esc(i.category || "")}" placeholder="Category" class="w-40 text-sm" />
        <select data-st-of="${esc(i.id)}" class="text-sm">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${i.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <label class="sub flex items-center gap-1">Target <input type="date" data-due-of="${esc(i.id)}" value="${esc(i.due || "")}" class="text-sm" /></label>
        ${i.due && i.status !== "done" && i.due < today() ? '<span class="text-red-700 text-xs">overdue</span>' : ""}
      </div></div>`).join("") : '<p class="py-2 text-sm text-slate-500">Nothing here.</p>';
    $.all("[data-st]").forEach((b) => (b.onclick = () => { status = b.dataset.st; cat = ""; draw(); }));
    $.all("[data-cat]").forEach((b) => (b.onclick = () => { cat = b.dataset.cat; draw(); }));
    $.all("[data-cat-of]").forEach((el) => (el.onchange = () => save(el.dataset.catOf, { category: el.value })));
    $.all("[data-st-of]").forEach((el) => (el.onchange = () => save(el.dataset.stOf, { status: el.value })));
    $.all("[data-due-of]").forEach((el) => (el.onchange = () => save(el.dataset.dueOf, { due: el.value })));
  }
  async function save(id, patch) {
    try { await api(`/todo/${id}`, patch); await load(); } catch (err) { $("msg").innerHTML = `<span class="text-red-700">${esc(err.message)}</span>`; }
  }
  $("add").onclick = async () => {
    const title = $("idea").value.trim();
    if (!title) return;
    try {
      const r = await api("/todo", { title });
      $("idea").value = "";
      $("msg").innerHTML = r.existed ? '<span class="text-amber-700">That one is already on the list.</span>' : '<span class="text-emerald-600">Added to Unsorted.</span>';
      status = "open";
      await load();
    } catch (err) { $("msg").innerHTML = `<span class="text-red-700">${esc(err.message)}</span>`; }
  };
  $("idea").onkeydown = (e) => { if (e.key === "Enter") $("add").onclick(); };
  load();
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
