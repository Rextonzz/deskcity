// Games: the page's working part as a block (see public/parts/kit.js). Mounted by public/games.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, api, bindRoot } from "/stats-lib.js";
import { confirmBox } from "/lib.js";
import { scope, lifecycle } from "/parts/kit.js";

export const html = `<style>
[data-block="games"] .btn.main { background: #2563eb; border-color: #2563eb; color: #fff; font-size: 14px; padding: 6px 14px; }
  [data-block="games"] input,
  [data-block="games"] select,
  [data-block="games"] textarea { background: var(--surface-2); border: 1px solid var(--line-strong); color: var(--text-primary); border-radius: 8px; padding: 5px 8px; font-size: 14px; }
  [data-block="games"] textarea { width: 100%; min-height: 60px; }
  [data-block="games"] .sub { font-size: 13px; color: var(--text-muted); }
  [data-block="games"] .grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 14px; }
  [data-block="games"] .field { display: grid; grid-template-columns: 70px 1fr; gap: 6px; align-items: center; font-size: 14px; margin: 4px 0; }
  [data-block="games"] .field input,
  [data-block="games"] .field select { width: 100%; min-width: 0; }
  [data-block="games"] .log li { font-size: 13px; padding: 2px 0; }
  [data-block="games"] .grp { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); margin: 18px 0 6px; }
  [data-block="games"] .addon { display: inline-block; margin: 6px 6px 0 0; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--line-strong); font-size: 13px; }
</style>
<section class="card space-y-2">
  <h2 class="font-semibold">Add a game</h2>
  <div class="flex flex-wrap gap-2 items-center">
    <input id="name" placeholder="Game" maxlength="60" class="flex-1" style="min-width:150px" />
    <input id="platform" placeholder="Platform (PC, Switch…)" maxlength="40" style="width:170px" />
    <select id="status"></select>
    <button id="add" class="btn main">Add</button>
    <span id="msg" class="sub"></span>
  </div>
  <p class="sub" id="addonsLine"></p>
</section>
<div id="games"><p class="sub">Loading…</p></div>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "games";
  const $ = scope(root), life = lifecycle();
  bindRoot(root, life);
  const LABEL = { playing: "▶ Playing", backlog: "☰ Backlog", paused: "⏸ Paused", done: "✓ Done" };
  let data = null;
  const day = (iso) => new Date(iso).toLocaleDateString();

  async function load(d) {
    try { data = d || (await api("/games")); } catch (err) { $("games").innerHTML = `<p class="sub">${esc(err.noRoute ? "The app needs a restart to show this page." : err.message)}</p>`; return; }
    if (!$("status").options.length) $("status").innerHTML = data.statuses.map((s) => `<option value="${s}">${esc(LABEL[s])}</option>`).join("");
    $("addonsLine").innerHTML = data.addons.length ? `Add-ons on this hub: ${data.addons.map((a) => `<a class="addon" href="${esc(a.page)}">${esc(a.name)}</a>`).join("")} They show on the games they belong to.` : "";
    if (!data.games.length) return ($("games").innerHTML = '<p class="sub">No games yet. Add one above.</p>');
    $("games").innerHTML = data.statuses.map((s) => {
      const list = data.games.filter((g) => g.status === s);
      if (!list.length) return "";
      return `<div class="grp">${esc(LABEL[s])} · ${list.length}</div><div class="grid3">${list.map(card).join("")}</div>`;
    }).join("");
    for (const b of $.all("[data-save]")) b.onclick = () => save(b.dataset.save);
    for (const b of $.all("[data-del]")) b.onclick = async () => {
      const g = data.games.find((x) => x.id === b.dataset.del);
      if (!(await confirmBox(`Remove ${g.name} and its log?`))) return;
      load(await api(`/games/${g.id}/remove`, {}));
    };
  }
  function card(g) {
    const id = g.id;
    return `<section class="card">
      <div class="flex justify-between gap-2"><h3 class="font-semibold">${esc(g.name)}</h3><span class="sub">${esc(g.platform || "")}</span></div>
      <div class="field"><span class="sub">Status</span><select id="s-${id}">${data.statuses.map((s) => `<option value="${s}"${s === g.status ? " selected" : ""}>${esc(LABEL[s])}</option>`).join("")}</select></div>
      <div class="field"><span class="sub">Hours</span><input id="h-${id}" inputmode="decimal" value="${g.hours ?? ""}" /></div>
      <div class="field"><span class="sub">Link</span><input id="l-${id}" placeholder="https://…" value="${esc(g.link || "")}" /></div>
      <textarea id="n-${id}" placeholder="Notes: builds, goals, where you left off">${esc(g.notes || "")}</textarea>
      <input id="note-${id}" placeholder="Add to the log (today)" style="width:100%;margin-top:6px" maxlength="300" />
      <div class="flex flex-wrap gap-2 items-center mt-2"><button class="btn" data-save="${id}">Save</button><button class="btn" data-del="${id}">Remove</button>${g.link ? `<a class="sub" href="${esc(g.link)}" target="_blank" rel="noopener">open link ↗</a>` : ""}<span id="m-${id}" class="sub"></span></div>
      ${g.addons.length ? `<div>${g.addons.map((a) => `<a class="addon" href="${esc(a.page)}">${esc(a.name)} →</a>`).join("")}</div>` : ""}
      ${g.log.length ? `<ul class="log mt-2">${g.log.slice(0, 6).map((l) => `<li><span class="sub">${day(l.at)}</span> ${esc(l.text)}</li>`).join("")}</ul>` : ""}
    </section>`;
  }
  async function save(id) {
    const body = { status: $(`s-${id}`).value, hours: $(`h-${id}`).value, link: $(`l-${id}`).value, notes: $(`n-${id}`).value, note: $(`note-${id}`).value };
    try { await load(await api(`/games/${id}`, body)); } catch (err) { $(`m-${id}`).textContent = err.message; }
  }
  $("add").onclick = async () => {
    try { await load(await api("/games", { name: $("name").value, platform: $("platform").value, status: $("status").value })); $("name").value = ""; $("platform").value = ""; $("msg").textContent = "Added."; }
    catch (err) { $("msg").textContent = err.message; }
  };
  load();
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
