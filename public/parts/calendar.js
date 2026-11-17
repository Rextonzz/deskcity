// Posting calendar: the page's working part as a block (see public/parts/kit.js). Mounted by public/calendar.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, api, compact, bindRoot } from "/stats-lib.js";
import { scope, lifecycle } from "/parts/kit.js";
import { channels as CHANNELS } from "/hubinfo.js";

export const html = `<style>
[data-block="calendar"] .grid7 { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
  [data-block="calendar"] .dow { font-size: 11px; color: var(--text-muted); text-align: center; padding-bottom: 2px; }
  [data-block="calendar"] .cell { min-height: 64px; border: 1px solid var(--line-soft); border-radius: 8px; padding: 4px; text-align: left; background: var(--surface-1); font-size: 12px; min-width: 0; }
  [data-block="calendar"] .cell.other { opacity: 0.35; }
  [data-block="calendar"] .cell.today { border-color: var(--accent); }
  [data-block="calendar"] .cell.sel { background: var(--surface-2); border-color: var(--line-strong); }
  [data-block="calendar"] .cell.gap { border-style: dashed; border-color: var(--bad-text); }
  [data-block="calendar"] .cell.gap-later { border-style: dashed; border-color: var(--line-strong); }
  [data-block="calendar"] .cell .d { font-weight: 600; font-variant-numeric: tabular-nums; }
  [data-block="calendar"] .pill { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; font-variant-numeric: tabular-nums; margin-right: 4px; color: var(--text-secondary); }
  [data-block="calendar"] .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }
  [data-block="calendar"] .yt { background: var(--series-1); }
  [data-block="calendar"] .tt { background: var(--series-2); border-radius: 1px; }
  [data-block="calendar"] .chip { font-size: 13px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); }
  [data-block="calendar"] .chip.on { background: var(--text-primary); color: var(--page); border-color: var(--text-primary); }
  [data-block="calendar"] .row { display: flex; gap: 8px; align-items: baseline; padding: 6px 0; }
  [data-block="calendar"] .row + .row { border-top: 1px solid var(--line-soft); }
  [data-block="calendar"] .row .t { font-variant-numeric: tabular-nums; width: 44px; flex: none; color: var(--text-secondary); font-size: 13px; }
  [data-block="calendar"] .row .what { flex: 1; min-width: 0; font-size: 14px; }
  [data-block="calendar"] .row .v { font-variant-numeric: tabular-nums; font-size: 13px; color: var(--text-secondary); flex: none; }
  [data-block="calendar"] .warn { color: var(--bad-text); }
</style>
<p id="note" class="text-sm text-slate-500"></p>
<div class="flex flex-wrap items-center gap-2">
  <button id="prev" class="chip" aria-label="Previous month">‹</button>
  <div id="month" class="font-semibold min-w-[120px] text-center"></div>
  <button id="next" class="chip" aria-label="Next month">›</button>
  <button id="todayBtn" class="chip">Today</button>
  <span class="flex-1"></span>
  <div id="chips" class="flex flex-wrap gap-2"></div>
</div>
<div class="flex flex-wrap gap-4 sub">
  <span class="pill"><span class="dot yt"></span>YouTube</span>
  <span class="pill"><span class="dot tt"></span>TikTok</span>
  <span class="pill"><span class="dot" style="border:1px dashed var(--bad-text)"></span>Nothing booked on YouTube today or tomorrow</span>
</div>
<section class="card"><div id="grid"><p class="text-sm text-slate-500">Loading…</p></div></section>
<section class="card space-y-1"><h2 id="dayTitle" class="font-semibold"></h2><div id="day"></div></section>
<section class="card space-y-1"><h2 class="font-semibold">Next 14 days</h2><div id="ahead"></div></section>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "calendar";
  const $ = scope(root), life = lifecycle();
  bindRoot(root, life);
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  let data = null, view = null, sel = null, chan = "all";
  try { chan = localStorage.getItem("cal-chan") || "all"; } catch {}

  const dayKey = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const shown = () => data.posts.filter((p) => chan === "all" || p.channel === chan);
  const gapsOn = (day) => data.gaps.filter((g) => g.day === day && (chan === "all" || g.channel === chan));
  // Red only where it needs acting on now: today and tomorrow (design review 2026-10-21).
  const soon = (day) => (Date.parse(`${day}T12:00:00`) - Date.parse(`${data.today}T12:00:00`)) / 864e5 < 2;
  const short = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const pretty = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  function rowHtml(p) {
    const state = p.booked ? (p.planned ? "planned" : "booked") : "";
    const name = esc(p.title || "(no title)");
    return `<div class="row"><span class="t">${esc(p.time || "")}</span><span class="dot ${p.platform === "tiktok" ? "tt" : "yt"}" style="align-self:center"></span>
      <span class="what">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" class="underline decoration-dotted">${name}</a>` : name}
      <span class="sub"> · ${esc(p.channelName)}${p.platform === "tiktok" ? " TikTok" : ""}${p.backlog ? " · backlog" : ""}${state ? ` · ${state}` : ""}</span></span>
      <span class="v">${p.views != null ? `${compact(p.views)} views` : ""}</span></div>`;
  }

  function drawGrid() {
    const [y, m] = view;
    $("month").textContent = new Date(y, m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const first = new Date(y, m, 1);
    const lead = (first.getDay() + 6) % 7; // Monday first
    const days = new Date(y, m + 1, 0).getDate();
    const by = {};
    for (const p of shown()) (by[p.day] = by[p.day] || []).push(p);
    let html = `<div class="grid7">${DOW.map((d) => `<div class="dow">${d}</div>`).join("")}`;
    const cells = Math.ceil((lead + days) / 7) * 7;
    for (let i = 0; i < cells; i++) {
      const dt = new Date(y, m, i - lead + 1);
      const k = dayKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
      const list = by[k] || [];
      const yt = list.filter((p) => p.platform === "youtube").length, tt = list.length - yt;
      const cls = ["cell", dt.getMonth() !== m ? "other" : "", k === data.today ? "today" : "", k === sel ? "sel" : "", gapsOn(k).length ? (soon(k) ? "gap" : "gap-later") : ""].join(" ");
      html += `<button class="${cls}" data-day="${k}"><div class="d">${dt.getDate()}</div>${yt ? `<span class="pill"><span class="dot yt"></span>${yt}</span>` : ""}${tt ? `<span class="pill"><span class="dot tt"></span>${tt}</span>` : ""}</button>`;
    }
    $("grid").innerHTML = html + "</div>";
    $("grid").querySelectorAll("[data-day]").forEach((b) => (b.onclick = () => { sel = b.dataset.day; drawGrid(); drawDay(); }));
  }

  function drawDay() {
    $("dayTitle").textContent = pretty(sel);
    const list = shown().filter((p) => p.day === sel);
    const gaps = gapsOn(sel).map((g) => `<p class="text-sm ${soon(sel) ? "warn" : "sub"}">Nothing booked on YouTube for ${esc(g.channelName)}.</p>`).join("");
    $("day").innerHTML = gaps + (list.length ? list.map(rowHtml).join("") : gaps ? "" : '<p class="sub">Nothing posted or booked this day.</p>');
  }

  function drawAhead() {
    const out = [], empty = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(`${data.today}T12:00:00`); d.setDate(d.getDate() + i);
      const k = dayKey(d.getFullYear(), d.getMonth(), d.getDate());
      const list = shown().filter((p) => p.day === k);
      const gaps = gapsOn(k);
      if (!list.length && !gaps.length) continue;
      // Later days with nothing at all fold into one line at the end.
      if (i >= 2 && !list.length) { empty.push(k); continue; }
      const note = gaps.map((g) => `<p class="text-sm ${i < 2 ? "warn" : "sub"}">Nothing booked on YouTube for ${esc(g.channelName)}.</p>`).join("");
      out.push(`<div class="pt-2"><div class="sub font-semibold">${esc(i === 0 ? "Today" : i === 1 ? "Tomorrow" : pretty(k))}</div>${note}${list.map(rowHtml).join("")}</div>`);
    }
    if (empty.length) out.push(`<p class="pt-3 text-sm sub">Nothing booked yet on ${empty.length} later day${empty.length === 1 ? "" : "s"}: ${empty.map(short).join(", ")}.</p>`);
    $("ahead").innerHTML = out.join("") || '<p class="sub">Nothing booked yet.</p>';
  }

  function drawChips() {
    const opts = [["all", CHANNELS.length === 2 ? "Both" : "All"], ...[...CHANNELS].sort((a, b) => a.name.localeCompare(b.name)).map((c) => [c.id, c.name])];
    $("chips").innerHTML = opts.map(([k, l]) => `<button class="chip ${chan === k ? "on" : ""}" data-chan="${k}">${l}</button>`).join("");
    $("chips").querySelectorAll("[data-chan]").forEach((b) => (b.onclick = () => {
      chan = b.dataset.chan;
      try { localStorage.setItem("cal-chan", chan); } catch {}
      drawAll();
    }));
  }
  const drawAll = () => { drawChips(); drawGrid(); drawDay(); drawAhead(); };
  const goMonth = (d) => { view = [view[0], view[1] + d]; if (view[1] < 0) view = [view[0] - 1, 11]; if (view[1] > 11) view = [view[0] + 1, 0]; drawGrid(); };
  $("prev").onclick = () => goMonth(-1);
  $("next").onclick = () => goMonth(1);
  $("todayBtn").onclick = () => { const [y, m] = data.today.split("-").map(Number); view = [y, m - 1]; sel = data.today; drawGrid(); drawDay(); };

  try {
    data = await api("/calendar");
    const [y, m] = data.today.split("-").map(Number);
    view = [y, m - 1];
    sel = data.today;
    $("note").textContent = `Times are ${data.tz}. Past posts come from the upload log and Pack Tracker (views as of the last stats pull); booked ones from the app's own uploads and the TikTok backlog.`;
    drawAll();
  } catch (err) {
    $("note").textContent = err.message;
  }
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
