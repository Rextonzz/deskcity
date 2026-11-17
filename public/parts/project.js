// Project: the page's working part as a block (see public/parts/kit.js). Mounted by public/project.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, api, bindRoot } from "/stats-lib.js";
import { scope, lifecycle } from "/parts/kit.js";

export const html = `<style>
[data-block="project"] .tile .n { font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; }
  [data-block="project"] .bars { display: flex; align-items: flex-end; gap: 4px; height: 120px; }
  [data-block="project"] .bar { flex: 1; min-width: 10px; background: var(--accent); border-radius: 4px 4px 0 0; position: relative; }
  [data-block="project"] .bar.done { background: var(--good); }
  [data-block="project"] .bar.open { background: var(--text-muted); }
  [data-block="project"] .ax { display: flex; gap: 4px; font-size: 11px; color: var(--text-muted); }
  [data-block="project"] .ax span { flex: 1; min-width: 10px; text-align: center; overflow: hidden; }
  [data-block="project"] table { width: 100%; font-size: 14px; font-variant-numeric: tabular-nums; }
  [data-block="project"] td,
  [data-block="project"] th { padding: 6px 8px 6px 0; text-align: left; vertical-align: top; }
  [data-block="project"] th { font-weight: 500; color: var(--text-muted); }
  [data-block="project"] tr + tr td { border-top: 1px solid var(--line-soft); }
  [data-block="project"] .gantt { position: relative; font-size: 12px; }
  [data-block="project"] .g-scroll { overflow-x: auto; border: 1px solid var(--line-soft); border-radius: 8px; }
  [data-block="project"] .g-row { display: flex; min-height: 26px; border-top: 1px solid var(--line-soft); }
  [data-block="project"] .g-row.ws { background: var(--surface-2); min-height: 30px; }
  [data-block="project"] .g-label { position: sticky; left: 0; z-index: 2; width: 150px; flex: none; padding: 4px 8px; background: var(--surface-1); border-right: 1px solid var(--line-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  [data-block="project"] .g-row.ws .g-label { background: var(--surface-2); font-weight: 600; cursor: pointer; }
  [data-block="project"] .g-track { position: relative; flex: none; }
  [data-block="project"] .g-bar { position: absolute; top: 8px; height: 10px; border-radius: 5px; cursor: pointer; }
  [data-block="project"] .g-bar.done { background: var(--good); }
  [data-block="project"] .g-bar.doing { background: var(--accent); }
  [data-block="project"] .g-bar.span { top: 12px; height: 6px; background: var(--line-strong); opacity: 0.6; cursor: default; }
  [data-block="project"] .g-open { position: absolute; top: 12px; height: 0; border-top: 2px dashed var(--text-muted); cursor: pointer; }
  [data-block="project"] .g-dot { position: absolute; top: 6px; width: 12px; height: 12px; margin-left: -6px; border: 2px solid var(--text-muted); border-radius: 50%; background: var(--surface-1); cursor: pointer; }
  [data-block="project"] .g-dia { position: absolute; top: 9px; width: 10px; height: 10px; margin-left: -5px; transform: rotate(45deg); background: var(--series-1); cursor: pointer; }
  [data-block="project"] .g-ms { position: absolute; top: 4px; width: 14px; height: 14px; margin-left: -7px; transform: rotate(45deg); background: var(--series-3); cursor: pointer; }
  [data-block="project"] .g-due { position: absolute; top: 4px; width: 2px; height: 18px; background: var(--bad-text); }
  [data-block="project"] .g-axis { display: flex; height: 22px; }
  [data-block="project"] .g-day { position: absolute; top: 0; bottom: 0; border-left: 1px solid var(--line-soft); padding-left: 4px; color: var(--text-muted); white-space: nowrap; }
  [data-block="project"] .g-now { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--bad-text); opacity: 0.7; z-index: 1; pointer-events: none; }
  [data-block="project"] .zchip { font-size: 12px; padding: 2px 10px; border-radius: 999px; border: 1px solid var(--line); }
  [data-block="project"] .zchip.on { background: var(--surface-3); border-color: var(--line-strong); }
  [data-block="project"] .g-legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--text-muted); }
  [data-block="project"] .g-legend span { display: inline-flex; align-items: center; gap: 4px; }
</style>
<div id="err" class="hidden text-sm text-red-700"></div>
<section id="tiles" class="grid grid-cols-2 md:grid-cols-4 gap-3"></section>

<section data-fold-phone class="card space-y-2">
  <h2 class="font-semibold">Project timeline</h2>
  <p id="gLine" class="text-sm"></p>
  <div class="g-legend">
    <span><i class="g-bar done" style="position:static;display:inline-block;width:18px"></i>Done (added to finished)</span>
    <span><i class="g-bar doing" style="position:static;display:inline-block;width:18px"></i>In progress</span>
    <span><i style="display:inline-block;width:18px;border-top:2px dashed var(--text-muted)"></i>Backlog (waiting since added)</span>
    <span><i class="g-dia" style="position:static;display:inline-block;margin:0 2px"></i>Update delivered</span>
    <span><i class="g-ms" style="position:static;display:inline-block;margin:0 2px"></i>Milestone</span>
    <span><i style="display:inline-block;width:2px;height:12px;background:var(--bad-text)"></i>Target date / now</span>
  </div>
  <div class="flex flex-wrap items-center gap-2 text-sm"><span class="sub">Zoom</span><div id="gZoom" class="flex gap-1"></div></div>
  <div id="gantt" class="gantt"></div>
  <div id="gDetail" class="text-sm"></div>
  <p class="sub">Tap a workstream to fold it, and any bar or mark for details. Set target dates on the To-do page to see planned against actual.</p>
</section>

<section class="card space-y-2">
  <h2 class="font-semibold">Built per day</h2>
  <p class="sub">Changes logged in the version history each day (each update is a dated note with one or more changes).</p>
  <div id="perDay"></div>
</section>

<section class="card space-y-2">
  <h2 class="font-semibold">To-do and scope creep</h2>
  <p id="creepLine" class="text-sm"></p>
  <div id="scope"></div>
  <div id="cats" class="overflow-x-auto"></div>
</section>

<section data-fold-phone class="card space-y-2">
  <h2 class="font-semibold">Services the hub replaces</h2>
  <p id="svcLine" class="sub"></p>
  <div id="svc" class="overflow-x-auto"></div>
</section>

<section class="card space-y-2">
  <h2 class="font-semibold">What the app has done</h2>
  <p id="runLine" class="sub"></p>
  <div id="runs" class="overflow-x-auto"></div>
</section>

<section class="card space-y-2">
  <h2 class="font-semibold">Latest updates</h2>
  <div id="latest" class="text-sm divide-y divide-slate-100"></div>
</section>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "project";
  const $ = scope(root), life = lifecycle();
  bindRoot(root, life);
  const showErr = (msg) => { const el = $("err"); el.textContent = msg; el.classList.toggle("hidden", !msg); };
  const n = (v) => Number(v || 0).toLocaleString();
  const tile = (num, label) => `<div class="card tile"><div class="n">${num}</div><div class="l">${esc(label)}</div></div>`;
  const short = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

  function bars(rows, value, label, cls = "") {
    const max = Math.max(1, ...rows.map(value));
    return `<div class="bars">${rows.map((r) => `<div class="bar ${cls}" style="height:${Math.max(3, (value(r) / max) * 100)}%" title="${esc(label(r))}"></div>`).join("")}</div><div class="ax">${rows.map((r) => `<span>${esc(short(r.day))}</span>`).join("")}</div>`;
  }

  // ---------- Gantt ----------
  let tl = null, folded = new Set(), zoom = "fit";
  try { folded = new Set(JSON.parse(localStorage.getItem("gantt-folded") || "[]")); } catch {}
  try { zoom = localStorage.getItem("gantt-zoom") || "fit"; } catch {}
  // Fit = the whole project on screen (no sideways scroll); Day and Hours spread it out to read close together updates.
  const ZOOMS = [["fit", "Whole project"], ["day", "Day"], ["hour", "Hours"]];
  const PX_PER_H = { day: 7, hour: 18 };
  function drawZoom() {
    $("gZoom").innerHTML = ZOOMS.map(([k, l]) => `<button class="zchip ${zoom === k ? "on" : ""}" data-z="${k}">${l}</button>`).join("");
    $("gZoom").querySelectorAll("[data-z]").forEach((b) => (b.onclick = () => {
      zoom = b.dataset.z;
      try { localStorage.setItem("gantt-zoom", zoom); } catch {}
      drawZoom();
      drawGantt();
    }));
  }
  const fmt = (iso) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  function drawGantt() {
    const t0 = Date.parse(tl.start), t1 = Math.max(Date.parse(tl.end), Date.now()) + 6 * 3600e3;
    const hours = (t1 - t0) / 3600e3;
    const box = $("gantt").clientWidth || 600;
    const w = zoom === "fit" ? Math.max(120, box - 152) : Math.max(box - 152, hours * PX_PER_H[zoom]);
    const narrow = w / (hours / 24) < 90; // under ~90 px a day: short day labels
    const x = (iso) => ((Date.parse(iso) - t0) / (t1 - t0)) * w;
    const marks = [];
    const mark = (html, info) => { marks.push(info); return html.split("data-m").join(`data-m="${marks.length - 1}"`); };
    let days = "";
    for (let d = new Date(t0); d.getTime() < t1; d.setDate(d.getDate() + 1)) {
      const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      if (day.getTime() < t0) continue;
      days += `<div class="g-day" style="left:${x(day.toISOString())}px">${esc(day.toLocaleDateString(undefined, narrow ? { month: "short", day: "numeric" } : { weekday: "short", month: "short", day: "numeric" }))}</div>`;
    }
    const now = `<div class="g-now" style="left:${x(tl.now)}px"></div>`;
    const row = (label, inner, cls = "", attr = "") => `<div class="g-row ${cls}" ${attr}><div class="g-label" title="${esc(label)}">${label}</div><div class="g-track" style="width:${w}px">${inner}${now}</div></div>`;
    let html = `<div class="g-row" style="border-top:0"><div class="g-label sub">Workstream</div><div class="g-track g-axis" style="width:${w}px">${days}</div></div>`;
    html += row("Milestones", tl.milestones.map((m) => mark(`<i class="g-ms" style="left:${x(m.at)}px" data-m></i>`, `<b>${esc(m.title)}</b> · ${esc(fmt(m.at))}`)).join(""));
    for (const ws of tl.workstreams) {
      const span = ws.first ? `<i class="g-bar span" style="left:${x(ws.first)}px;width:${Math.max(2, x(ws.last) - x(ws.first))}px"></i>` : "";
      const dots = ws.deliveries.map((d) => mark(`<i class="g-dia" style="left:${x(d.at)}px" data-m></i>`, `<b>${esc(d.title)}</b> · ${esc(ws.name)} · ${esc(fmt(d.at))} · ${d.changes} change${d.changes === 1 ? "" : "s"}`)).join("");
      const shut = folded.has(ws.name);
      html += row(`${shut ? "▸" : "▾"} ${esc(ws.name)} <span class="sub">${ws.pct}% · ${ws.deliveries.length} updates</span>`, span + dots, "ws", `data-ws="${esc(ws.name)}"`);
      if (shut) continue;
      for (const it of ws.items) {
        const info = `<b>${esc(it.title)}</b><br><span class="sub">${it.rank ? `#${it.rank} · ` : ""}${esc(it.status)} · added ${esc(fmt(it.at))}${it.doneAt ? ` · done ${esc(fmt(it.doneAt))}` : ""}${it.due ? ` · target ${esc(it.due)}` : ""}</span>`;
        let bar;
        if (it.status === "done" && it.doneAt) bar = mark(`<i class="g-bar done" style="left:${x(it.at)}px;width:${Math.max(6, x(it.doneAt) - x(it.at))}px" data-m></i>`, info);
        else if (it.status === "doing") bar = mark(`<i class="g-bar doing" style="left:${x(it.at)}px;width:${Math.max(6, x(tl.now) - x(it.at))}px" data-m></i>`, info);
        else bar = mark(`<i class="g-open" style="left:${x(it.at)}px;width:${Math.max(2, x(tl.now) - x(it.at))}px" data-m></i><i class="g-dot" style="left:${x(it.at)}px" data-m></i>`, info);
        const due = it.due ? `<i class="g-due" style="left:${x(`${it.due}T23:59:00`)}px"></i>` : "";
        const name = it.title.split(/[(:]/)[0].trim().slice(0, 60);
        html += row(`${it.rank ? `<span class="sub">#${it.rank}</span> ` : ""}${esc(name)}`, bar + due);
      }
    }
    $("gantt").innerHTML = `<div class="g-scroll"><div style="width:${w + 152}px">${html}</div></div>`;
    $("gantt").querySelectorAll("[data-m]").forEach((el) => (el.onclick = () => ($("gDetail").innerHTML = marks[Number(el.dataset.m)] || "")));
    $("gantt").querySelectorAll("[data-ws]").forEach((el) => (el.querySelector(".g-label").onclick = () => {
      const k = el.dataset.ws;
      folded.has(k) ? folded.delete(k) : folded.add(k);
      try { localStorage.setItem("gantt-folded", JSON.stringify([...folded])); } catch {}
      drawGantt();
    }));
    const sc = $("gantt").querySelector(".g-scroll");
    if (zoom !== "fit") sc.scrollLeft = Math.max(0, x(tl.now) - sc.clientWidth + 200);
  }

  async function load() {
    let p;
    try { p = await api("/project"); } catch (err) { showErr(err.noRoute ? "The app needs a restart to show this page." : err.message); return; }
    $("tiles").innerHTML = [
      tile(n(p.days), `days in (since ${short(p.started)})`),
      tile(n(p.changes), `changes in ${n(p.updates)} updates`),
      tile(n(p.code.lines), `lines of code in ${n(p.code.files)} files`),
      tile(`${p.todo.pctDone}%`, `of the to-do done (${p.todo.done} of ${p.todo.total - p.todo.dropped})`),
    ].join("");

    if (p.timeline) {
      tl = p.timeline;
      const all = tl.workstreams.flatMap((w) => w.items);
      const done = all.filter((i) => i.status === "done").length, doing = all.filter((i) => i.status === "doing").length;
      const deliveries = tl.workstreams.reduce((a, w) => a + w.deliveries.length, 0);
      const sc = tl.schedule;
      $("gLine").innerHTML = `Day <b>${p.days}</b>. <b>${done}</b> of ${all.length} scoped items done${doing ? `, ${doing} in progress` : ""}, ${deliveries} updates delivered across ${tl.workstreams.length} workstreams.${sc.withDue ? ` Target dates: ${sc.doneOnTime} done on time, ${sc.doneLate} late, <span class="${sc.overdue ? "text-red-700" : ""}">${sc.overdue} overdue</span>.` : ""}`;
      drawZoom();
      drawGantt();
      let rt;
      life.on(window, "resize", () => { clearTimeout(rt); rt = life.later(drawGantt, 200); });
    }

    $("perDay").innerHTML = p.byDay.length ? bars(p.byDay, (r) => r.changes, (r) => `${short(r.day)}: ${r.changes} changes in ${r.updates} updates`) + `<p class="sub mt-1">Hover or tap a bar for the count. Oct 17 and 18 were filled in later from the chat history, so they have fewer, bigger updates.</p>` : '<p class="sub">No version history yet.</p>';

    const h = p.todo.history;
    $("creepLine").innerHTML = `${p.todo.open} open, ${p.todo.done} done${p.todo.dropped ? `, ${p.todo.dropped} dropped` : ""}. <b>${p.todo.addedLater}</b> item${p.todo.addedLater === 1 ? "" : "s"} added after the first day on the list (that's the creep: ideas that came up while building).`;
    $("scope").innerHTML = h.length > 1
      ? `<div class="grid grid-cols-2 gap-4"><div><p class="sub">Items on the list</p>${bars(h, (r) => r.total, (r) => `${short(r.day)}: ${r.total} items`, "open")}</div><div><p class="sub">Done</p>${bars(h, (r) => r.done, (r) => `${short(r.day)}: ${r.done} done`, "done")}</div></div>`
      : `<p class="sub">The to-do started being counted daily today, so the scope line fills in from here.</p>`;
    $("cats").innerHTML = p.todo.byCategory.length ? `<table><tr><th>Area</th><th>Open</th><th>Done</th></tr>${p.todo.byCategory.map((c) => `<tr><td>${esc(c.category)}</td><td>${c.open}</td><td>${c.done}</td></tr>`).join("")}</table>` : "";

    $("svcLine").textContent = `${p.replaced.length} services. The ones with a usual monthly price add up to about US$${p.replacedMonthly}/month (rough prices, not checked live).`;
    $("svc").innerHTML = `<table><tr><th>Instead of</th><th>The hub does</th><th>Area</th><th>~US$/mo</th></tr>${p.replaced.map((r) => `<tr><td class="font-medium">${esc(r.service)}</td><td>${esc(r.what)}</td><td>${esc(r.area)}</td><td>${r.price ?? "–"}</td></tr>`).join("")}</table>`;

    $("runLine").textContent = p.runs.total ? `${n(p.runs.total)} logged runs since ${new Date(p.runs.since).toLocaleDateString()} (the log keeps the last 5,000).` : "Nothing logged yet.";
    $("runs").innerHTML = p.runs.top.length ? `<table><tr><th>Kind</th><th>Runs</th></tr>${p.runs.top.map(([k, c]) => `<tr><td>${esc(k)}</td><td>${n(c)}</td></tr>`).join("")}</table>` : "";

    $("latest").innerHTML = p.latest.map((e) => `<div class="py-2"><span class="sub">${esc(new Date(e.at).toLocaleString())}</span><div>${esc(e.title)}</div></div>`).join("");
  }
  load();
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
