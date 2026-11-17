// WoW raids: the page's working part as a block (see public/parts/kit.js). Mounted by public/wow.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, api, bindRoot } from "/stats-lib.js";
import { scope, lifecycle } from "/parts/kit.js";

export const html = `<style>
[data-block="wow"] .btn.main { background: #dc2626; border-color: #dc2626; color: #fff; font-size: 14px; padding: 7px 16px; }
  [data-block="wow"] .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
  [data-block="wow"] .tile .v { font-size: 22px; font-weight: 600; }
  [data-block="wow"] .row { display: flex; gap: 10px; align-items: center; padding: 6px 0; font-size: 14px; }
  [data-block="wow"] .row + .row { border-top: 1px solid var(--line-soft); }
  [data-block="wow"] .bar { height: 6px; border-radius: 3px; background: var(--good); }
  [data-block="wow"] .track { height: 6px; border-radius: 3px; background: var(--surface-3); margin-top: 4px; }
  [data-block="wow"] .sub { font-size: 13px; color: var(--text-muted); }
  [data-block="wow"] .err { font-size: 14px; color: var(--bad-text); }
  [data-block="wow"] .num { width: 44px; text-align: right; font-variant-numeric: tabular-nums; }
  [data-block="wow"] code { font-size: 13px; background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }
  [data-block="wow"] input,
  [data-block="wow"] select { font-size: 14px; padding: 5px 8px; border-radius: 8px; border: 1px solid var(--line-strong); background: var(--surface-2); color: var(--text-primary); min-width: 0; }
  [data-block="wow"] .chars { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: center; }
</style>
<div class="flex items-center gap-2 flex-wrap" data-head>
  <button id="pull" class="btn main" hidden>Pull from Warcraft Logs</button>
</div>
<p id="note" class="text-sm text-slate-500">Loading…</p>
<div id="out" class="space-y-5"></div>
<section class="card space-y-3">
  <h2 class="font-semibold">Characters</h2>
  <p class="sub">Name and realm as they show in game. Region is where the realm is.</p>
  <label class="sub">Region <select id="region"><option value="us">NA (US)</option><option value="eu">EU</option><option value="kr">KR</option><option value="tw">TW</option><option value="cn">CN</option></select></label>
  <div class="chars" id="chars"></div>
  <div class="flex gap-2 flex-wrap"><button id="add" class="btn">Add a character</button><button id="save" class="btn">Save characters</button></div>
  <p id="saveMsg" class="sub"></p>
</section>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "wow";
  const $ = scope(root), life = lifecycle();
  bindRoot(root, life);
  let rows = [];
  const dur = (s) => (s == null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
  const pct = (v) => (v == null ? "–" : String(v));

  function drawChars() {
    $("chars").innerHTML = rows.map((c, i) => `<input data-i="${i}" data-k="name" placeholder="Name" value="${esc(c.name)}" /><input data-i="${i}" data-k="realm" placeholder="Realm" value="${esc(c.realm)}" /><button class="btn" data-del="${i}" aria-label="Remove ${esc(c.name || "character")}">Remove</button>`).join("") || '<p class="sub" style="grid-column:1/-1">No characters yet.</p>';
    $("chars").querySelectorAll("input").forEach((el) => (el.oninput = () => (rows[el.dataset.i][el.dataset.k] = el.value)));
    $("chars").querySelectorAll("[data-del]").forEach((el) => (el.onclick = () => { rows.splice(Number(el.dataset.del), 1); drawChars(); }));
  }

  function raidCard(c) {
    if (c.error) return `<section class="card space-y-1"><h2 class="font-semibold">${esc(c.name)} · ${esc(c.realm)}</h2><p class="err">✗ ${esc(c.error)}</p></section>`;
    const r = c.raid;
    const head = `<h2 class="font-semibold"><a class="hover:underline" href="${esc(c.link)}" target="_blank" rel="noopener">${esc(c.name)}</a> · ${esc(c.realm)}</h2><p class="sub">${[c.level ? `Level ${c.level}` : "", c.className, c.faction].filter(Boolean).map(esc).join(" · ")}</p>`;
    const tiles = r ? `<div class="tiles">${[
      ["Best parse average", pct(r.bestAverage), r.metric ? r.metric.toUpperCase() : ""],
      ["Median parse average", pct(r.medianAverage), "across your kills"],
      ["Bosses logged", String(r.bosses.filter((b) => b.kills).length), `of ${r.bosses.length}`],
      ["Kills logged", String(r.bosses.reduce((t, b) => t + b.kills, 0)), "this raid tier"],
      ...r.allStars.slice(0, 2).map((a) => ["All Stars", a.points != null ? a.points.toLocaleString() : "–", `${a.spec || ""}${a.regionRank ? ` · #${a.regionRank.toLocaleString()} in region` : ""}`]),
    ].map(([l, v, s]) => `<div class="tile"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div><div class="l">${esc(s)}</div></div>`).join("")}</div>` : '<p class="sub">No ranked kills in the current raid yet.</p>';
    const bosses = r?.bosses?.length ? `<h3 class="font-semibold mt-3">Bosses</h3><p class="sub">Best and median parse (0 to 100, higher is better). The bar shows your best.</p>${r.bosses.map((b) => `<div class="row"><div class="flex-1 min-w-0">${esc(b.boss)}${b.spec ? ` <span class="sub">${esc(b.spec)}</span>` : ""}<div class="track"><div class="bar" style="width:${Math.max(2, b.best ?? 0)}%"></div></div></div><span class="num" title="Best parse">${pct(b.best)}</span><span class="num sub" title="Median parse">${pct(b.median)}</span><span class="sub" style="width:70px;text-align:right">${b.kills} kill${b.kills === 1 ? "" : "s"}</span><span class="sub" style="width:48px;text-align:right" title="Fastest kill">${dur(b.fastest)}</span></div>`).join("")}` : "";
    const reports = c.reports.length ? `<h3 class="font-semibold mt-3">Recent raids</h3>${c.reports.map((x) => `<div class="row"><span class="flex-1 min-w-0"><a class="hover:underline" href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.title || x.zone || x.code)}</a>${x.zone && x.title !== x.zone ? ` <span class="sub">${esc(x.zone)}</span>` : ""}</span><span class="sub">${x.start ? new Date(x.start).toLocaleDateString() : ""}${x.minutes ? ` · ${x.minutes} min` : ""}</span></div>`).join("")}` : '<p class="sub mt-3">No recent reports with this character.</p>';
    return `<section class="card space-y-2">${head}${gearPart(c)}${c.logsError ? `<p class="sub">${esc(c.logsError)}</p>` : `${tiles}${bosses}${reports}`}</section>`;
  }

  function gearPart(c) {
    if (c.gearError) return `<p class="err">✗ Gear: ${esc(c.gearError)}</p>`;
    const g = c.gear;
    if (!g) return "";
    const fixes = g.missingEnchants.length + g.emptySockets.length;
    const tiles = `<div class="tiles">${[
      ["Item level", g.itemLevel != null ? String(g.itemLevel) : "–", g.avgItemLevel != null ? `${g.avgItemLevel} average incl. bags` : "equipped"],
      ["Missing enchants", String(g.missingEnchants.length), g.missingEnchants.length ? "see list" : "all done"],
      ["Empty gem sockets", String(g.emptySockets.length), g.emptySockets.length ? "see list" : "all filled"],
      ...(g.spec ? [["Spec", g.spec, g.guild ? `<${g.guild}>` : ""]] : []),
    ].map(([l, v, s]) => `<div class="tile"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div><div class="l">${esc(s)}</div></div>`).join("")}</div>`;
    const todo = fixes ? `<p class="err">✗ To fix: ${[...g.missingEnchants.map((x) => `enchant ${x}`), ...g.emptySockets.map((x) => `gem in ${x}`)].map(esc).join(", ")}</p>` : '<p class="sub">✓ Every enchant and gem is in.</p>';
    const list = g.items.length ? `<details><summary class="sub" style="cursor:pointer">Every slot (${g.items.length})</summary>${g.items.map((i) => {
      const miss = g.missingEnchants.includes(i.slotName), empty = i.gems.filter((x) => !x).length;
      return `<div class="row"><span class="sub" style="width:84px">${esc(i.slotName)}</span><span class="flex-1 min-w-0">${esc(i.name)}<div class="sub">${[...i.enchants.map((e) => `✓ ${e}`), ...i.gems.filter(Boolean).map((x) => `◆ ${x}`), miss ? "✗ no enchant" : "", empty ? `✗ ${empty} empty socket${empty > 1 ? "s" : ""}` : ""].filter(Boolean).map(esc).join(" · ")}</div></span><span class="num" title="Item level">${i.ilvl ?? ""}</span></div>`;
    }).join("")}</details>` : "";
    return `<h3 class="font-semibold mt-3">Gear</h3>${tiles}${todo}${list}<h3 class="font-semibold mt-3">Raids</h3>`;
  }

  function draw(d) {
    rows = d.settings.characters.map((c) => ({ ...c }));
    $("region").value = d.settings.region;
    drawChars();
    $("pull").hidden = !d.ready || !rows.length;
    if (!d.ready) {
      $("note").innerHTML = `To turn this on, add <code>WCL_CLIENT_ID=</code> and <code>WCL_CLIENT_SECRET=</code> to <code>.env</code> on the PC (a V2 client from warcraftlogs.com/api/clients), then restart the app.`;
    } else if (!rows.length) $("note").textContent = "Add a character below, save, then press Pull from Warcraft Logs.";
    else if (!d.pulledAt) $("note").textContent = "Press Pull from Warcraft Logs to read your parses (a few seconds per character).";
    else $("note").textContent = `Last pulled ${new Date(d.pulledAt).toLocaleString()}.${d.limit ? ` Warcraft Logs points used this hour: ${Math.round(d.limit.pointsSpentThisHour)} of ${d.limit.limitPerHour}.` : ""}`;
    $("out").innerHTML = d.characters.map(raidCard).join("");
  }
  async function load() {
    try { draw(await api("/wow")); } catch (err) { $("note").textContent = err.noRoute ? "The app needs a restart to show this page." : err.message; }
  }
  $("add").onclick = () => { rows.push({ name: "", realm: rows.at(-1)?.realm || "" }); drawChars(); };
  $("save").onclick = async () => {
    $("saveMsg").textContent = "Saving…";
    try { draw(await api("/wow/characters", { region: $("region").value, characters: rows })); $("saveMsg").textContent = "Saved."; } catch (err) { $("saveMsg").textContent = err.message; }
  };
  $("pull").onclick = async () => {
    $("pull").disabled = true; $("pull").textContent = "Pulling…";
    try { draw(await api("/wow/pull", {})); } catch (err) { $("note").textContent = err.message; }
    $("pull").disabled = false; $("pull").textContent = "Pull from Warcraft Logs";
  };
  load();
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
