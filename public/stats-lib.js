// Shared helpers for the channel stats pages: formatting, grouping, small SVG charts and sortable tables.
// Colors come from theme.css custom properties. Labels are inserted with textContent, never as HTML.

import { $ as docById, esc, api, confirmBox } from "./lib.js";
import { channels as CHANNELS } from "./hubinfo.js";

// A block (public/parts/<page>.js) calls bindRoot(root, life) once: from then on the helpers below look up their elements
// inside that block only and put their timers and listeners on its lifecycle, so closing the block stops them. A plain
// page that never binds keeps the old page-wide lookups.
let ROOT = null, LIFE = null;
export function bindRoot(root, life) {
  ROOT = root; LIFE = life;
  life.add(() => { if (ROOT === root) { ROOT = null; LIFE = null; } });
}
export const $ = (id) => (ROOT ? ROOT.querySelector(`#${CSS.escape(id)}`) || document.createElement("div") : docById(id));
export const showErr = (msg) => { const el = $("err"); el.textContent = msg; el.classList.toggle("hidden", !msg); };
export { esc, api };
export const usd = (n) => (n == null || isNaN(n) ? "" : `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`);
export const usd0 = (n) => (n == null || isNaN(n) ? "" : `${n < 0 ? "-" : ""}$${Math.abs(n) >= 100 ? Math.round(Math.abs(n)).toLocaleString() : Math.abs(n).toFixed(Math.abs(n) >= 10 ? 0 : 2)}`);
export const signed = (n) => (n == null || isNaN(n) ? "" : `${n < 0 ? "-" : "+"}$${Math.abs(n).toFixed(2)}`);
export const int = (n) => (n == null || isNaN(n) ? "" : Math.round(n).toLocaleString());
export const compact = (n) => (n == null || isNaN(n) ? "" : Math.abs(n) >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : `${Math.round(n)}`);
export const pct = (n, d = 0) => (n == null || isNaN(n) ? "" : `${(n * 100).toFixed(d)}%`);
export const sum = (a, f = (x) => x) => a.reduce((s, x) => s + (f(x) || 0), 0);
export const avg = (a, f = (x) => x) => {
  const v = a.map(f).filter((x) => x != null && !isNaN(x));
  return v.length ? sum(v) / v.length : null;
};
export const median = (a) => {
  const v = a.filter((x) => x != null).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
export const groupBy = (a, key) => {
  const m = new Map();
  for (const x of a) {
    const k = key(x);
    if (k == null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
};
// Pearson correlation of points { x, y }: null with fewer than 3 points or no spread.
export const corr = (pts) => {
  if (pts.length < 3) return null;
  const mx = avg(pts, (p) => p.x), my = avg(pts, (p) => p.y);
  const num = sum(pts, (p) => (p.x - mx) * (p.y - my)), den = Math.sqrt(sum(pts, (p) => (p.x - mx) ** 2) * sum(pts, (p) => (p.y - my) ** 2));
  return den ? num / den : null;
};
export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const dayOf = (iso) => (iso ? new Date(iso + "T12:00:00").getDay() : null);

// Tooltip: one floating box shared by every chart. rows = [{ value, label, color }].
let tipEl;
function tip() {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.style.cssText = "position:fixed;z-index:50;pointer-events:none;background:#262624;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.35;max-width:260px;display:none;box-shadow:0 4px 16px rgba(0,0,0,.5)";
    document.body.appendChild(tipEl);
  }
  return tipEl;
}
export function showTip(e, title, rows) {
  const t = tip();
  t.replaceChildren();
  const h = document.createElement("div");
  h.style.cssText = "color:var(--text-muted);margin-bottom:4px";
  h.textContent = title;
  t.appendChild(h);
  for (const r of rows) {
    const line = document.createElement("div");
    line.style.cssText = "display:flex;align-items:center;gap:6px";
    if (r.color) {
      const k = document.createElement("span");
      k.style.cssText = `display:inline-block;width:10px;height:2px;border-radius:1px;background:${r.color}`;
      line.appendChild(k);
    }
    const v = document.createElement("strong");
    v.style.cssText = "color:var(--text-primary);font-weight:600";
    v.textContent = r.value;
    line.appendChild(v);
    if (r.label) {
      const l = document.createElement("span");
      l.style.color = "var(--text-secondary)";
      l.textContent = r.label;
      line.appendChild(l);
    }
    t.appendChild(line);
  }
  t.style.display = "block";
  const box = t.getBoundingClientRect();
  const x = e.clientX + 14 + box.width > innerWidth ? e.clientX - box.width - 14 : e.clientX + 14;
  const y = Math.min(innerHeight - box.height - 8, Math.max(8, e.clientY - box.height / 2));
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${y}px`;
}
export const hideTip = () => tip() && (tipEl.style.display = "none");

const NS = "http://www.w3.org/2000/svg";
function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}
function text(parent, x, y, s, attrs = {}) {
  const t = el("text", { x, y, fill: "var(--text-muted)", "font-size": 11, ...attrs }, parent);
  t.textContent = s;
  return t;
}
// Bar with a 4px rounded data end and a square baseline end.
function barPath(x, y, w, h, end) {
  const r = Math.min(4, Math.abs(end === "right" || end === "left" ? w : h) / 2, Math.abs(end === "right" || end === "left" ? h : w) / 2);
  if (end === "top") return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  if (end === "bottom") return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
  if (end === "right") return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  return `M${x + w},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w}Z`;
}
function niceTicks(min, max, n = 4) {
  if (min === max) max = min + 1;
  const raw = (max - min) / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
  return out;
}
const empty = (box, msg) => (box.innerHTML = `<div class="text-sm text-slate-500 py-6">${esc(msg)}</div>`);

// Horizontal bars. rows = [{ label, value, valueText, tip: [rows], sub }]. diverging: negatives go left in --neg.
export function hbars(box, rows, { fmt = int, diverging = false, color = "var(--series-1)", emptyText = "Not enough data yet." } = {}) {
  rows = rows.filter((r) => r.value != null && !isNaN(r.value));
  if (!rows.length) return empty(box, emptyText);
  const W = box.clientWidth || 600;
  // On a phone, long labels go on their own line above the bar instead of being cut short (design review 2026-10-21).
  const sideW = Math.min(170, Math.max(90, W * 0.3));
  const above = !diverging && W < 520 && rows.some((r) => r.label.length > Math.floor((sideW - 12) / 7.4));
  const rowH = above ? 42 : 30, bar = Math.min(18, 30 - 8);
  const labelW = above ? 0 : sideW, valW = Math.max(56, Math.min(96, 7 * Math.max(...rows.map((r) => String(r.valueText ?? fmt(r.value)).length)) + 10));
  const maxChars = above ? Math.floor((W - 8) / 6.8) : Math.floor((labelW - 12) / 7.4);
  const H = rows.length * rowH + 4;
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  const min = diverging ? Math.min(0, ...rows.map((r) => r.value)) : 0, max = Math.max(0, ...rows.map((r) => r.value));
  const x0 = labelW + valW * (min < 0 ? 1 : 0), x1 = W - valW;
  const sx = (v) => x0 + ((v - min) / (max - min || 1)) * (x1 - x0);
  const zero = sx(0);
  rows.forEach((r, i) => {
    const y = i * rowH + 2, cy = above ? y + 28 : y + rowH / 2;
    const g = el("g", { tabindex: 0, style: "cursor:default;outline:none" }, svg);
    el("rect", { x: 0, y, width: W, height: rowH, fill: "transparent" }, g);
    const lab = text(g, above ? 0 : labelW - 8, above ? y + 12 : cy + 4, r.label.length > maxChars ? r.label.slice(0, maxChars - 1) + "…" : r.label, { "text-anchor": above ? "start" : "end", fill: "var(--text-secondary)", "font-size": 12 });
    lab.appendChild(Object.assign(document.createElementNS(NS, "title"), { textContent: r.label }));
    const a = sx(r.value), w = Math.max(2, Math.abs(a - zero)), neg = r.value < 0;
    const fill = diverging ? (neg ? "var(--neg)" : "var(--pos)") : r.color || color;
    const mark = el("path", { d: barPath(neg ? zero - w : zero, cy - bar / 2, w, bar, neg ? "left" : "right"), fill }, g);
    text(g, neg ? zero - w - 6 : zero + w + 6, cy + 4, r.valueText ?? fmt(r.value), { "text-anchor": neg ? "end" : "start", fill: "var(--text-primary)", "font-size": 12, style: "font-variant-numeric:tabular-nums" });
    const on = (e) => {
      mark.setAttribute("opacity", 0.8);
      showTip(e, r.label, r.tip || [{ value: r.valueText ?? fmt(r.value) }]);
    };
    g.addEventListener("pointermove", on);
    g.addEventListener("focus", (e) => on({ clientX: box.getBoundingClientRect().left + a, clientY: box.getBoundingClientRect().top + cy }));
    const off = () => (mark.setAttribute("opacity", 1), hideTip());
    g.addEventListener("pointerleave", off);
    g.addEventListener("blur", off);
  });
  if (diverging && min < 0) el("line", { x1: zero, x2: zero, y1: 0, y2: H, stroke: "var(--axis)" }, svg);
  box.replaceChildren(svg);
}

// Columns over ordered categories, with an optional line in the same unit.
// cols = [{ label, value, tip: [rows] }]; line = { values: [], color, name }.
export function columns(box, cols, { fmt = compact, diverging = false, color = "var(--series-1)", line = null, height = 220, emptyText = "Not enough data yet.", labelEvery } = {}) {
  if (!cols.length) return empty(box, emptyText);
  const W = box.clientWidth || 600, H = height, pad = { l: 46, r: 10, t: 12, b: 26 };
  const vals = cols.map((c) => c.value ?? 0).concat(line ? line.values.filter((v) => v != null) : []);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const sy = (v) => pad.t + ((hi - v) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const step = (W - pad.l - pad.r) / cols.length, bw = Math.max(2, Math.min(24, step - 2));
  const cx = (i) => pad.l + step * i + step / 2;
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  for (const t of ticks) {
    el("line", { x1: pad.l, x2: W - pad.r, y1: sy(t), y2: sy(t), stroke: t === 0 ? "var(--axis)" : "var(--grid)" }, svg);
    text(svg, pad.l - 6, sy(t) + 4, fmt(t), { "text-anchor": "end", style: "font-variant-numeric:tabular-nums" });
  }
  const every = labelEvery || Math.max(1, Math.ceil(cols.length / Math.floor((W - pad.l) / 34)));
  const marks = cols.map((c, i) => {
    const v = c.value ?? 0, top = sy(Math.max(v, 0)), h = Math.max(v === 0 ? 0 : 2, Math.abs(sy(v) - sy(0)));
    const fill = diverging ? (v < 0 ? "var(--neg)" : "var(--pos)") : c.color || color;
    if (i % every === 0) text(svg, cx(i), H - 8, c.label, { "text-anchor": "middle" });
    return el("path", { d: barPath(cx(i) - bw / 2, v < 0 ? sy(0) : top, bw, h, v < 0 ? "bottom" : "top"), fill }, svg);
  });
  if (line) {
    const pts = line.values.map((v, i) => (v == null ? null : [cx(i), sy(v)]));
    el("path", { d: pts.filter(Boolean).map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(""), fill: "none", stroke: line.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    const last = pts.filter(Boolean).at(-1);
    if (last) el("circle", { cx: last[0], cy: last[1], r: 4, fill: line.color, stroke: "var(--surface-1)", "stroke-width": 2 }, svg);
  }
  const hair = el("line", { y1: pad.t, y2: H - pad.b, stroke: "var(--text-muted)", "stroke-width": 1, opacity: 0 }, svg);
  cols.forEach((c, i) => {
    const hit = el("rect", { x: pad.l + step * i, y: 0, width: step, height: H, fill: "transparent", tabindex: 0, style: "outline:none" }, svg);
    const on = (e) => {
      marks[i].setAttribute("opacity", 0.8);
      if (line) hair.setAttribute("x1", cx(i)), hair.setAttribute("x2", cx(i)), hair.setAttribute("opacity", 0.5);
      showTip(e, c.title || c.label, c.tip || [{ value: fmt(c.value) }]);
    };
    hit.addEventListener("pointermove", on);
    hit.addEventListener("focus", () => on({ clientX: box.getBoundingClientRect().left + cx(i), clientY: box.getBoundingClientRect().top + H / 2 }));
    const off = () => (marks[i].setAttribute("opacity", 1), hair.setAttribute("opacity", 0), hideTip());
    hit.addEventListener("pointerleave", off);
    hit.addEventListener("blur", off);
  });
  box.replaceChildren(svg);
}

// Scatter. pts = [{ x, y, title, tip }]. Each point gets a 24px hit area.
export function scatter(box, pts, { xfmt = int, yfmt = int, xLabel = "", yLabel = "", color = "var(--series-1)", height = 240, emptyText = "Not enough data yet." } = {}) {
  pts = pts.filter((p) => p.x != null && p.y != null && !isNaN(p.x) && !isNaN(p.y));
  if (pts.length < 3) return empty(box, emptyText);
  const W = box.clientWidth || 600, H = height, pad = { l: 50, r: 14, t: 12, b: 40 };
  const xt = niceTicks(Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x)));
  const yt = niceTicks(Math.min(0, ...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y)));
  const sx = (v) => pad.l + ((v - xt[0]) / (xt.at(-1) - xt[0] || 1)) * (W - pad.l - pad.r);
  const sy = (v) => pad.t + ((yt.at(-1) - v) / (yt.at(-1) - yt[0] || 1)) * (H - pad.t - pad.b);
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  for (const t of yt) {
    el("line", { x1: pad.l, x2: W - pad.r, y1: sy(t), y2: sy(t), stroke: t === 0 ? "var(--axis)" : "var(--grid)" }, svg);
    text(svg, pad.l - 6, sy(t) + 4, yfmt(t), { "text-anchor": "end", style: "font-variant-numeric:tabular-nums" });
  }
  for (const t of xt) {
    el("line", { x1: sx(t), x2: sx(t), y1: pad.t, y2: H - pad.b, stroke: t === 0 ? "var(--axis)" : "var(--grid)" }, svg);
    text(svg, sx(t), H - pad.b + 16, xfmt(t), { "text-anchor": "middle" });
  }
  if (xLabel) text(svg, (pad.l + W - pad.r) / 2, H - 4, xLabel, { "text-anchor": "middle", fill: "var(--text-secondary)" });
  if (yLabel) text(svg, 12, pad.t + (H - pad.t - pad.b) / 2, yLabel, { "text-anchor": "middle", fill: "var(--text-secondary)", transform: `rotate(-90 12 ${pad.t + (H - pad.t - pad.b) / 2})` });
  for (const p of pts) {
    const g = el("g", { tabindex: 0, style: "outline:none" }, svg);
    const dot = el("circle", { cx: sx(p.x), cy: sy(p.y), r: 4.5, fill: p.color || color, stroke: "var(--surface-1)", "stroke-width": 2 }, g);
    el("circle", { cx: sx(p.x), cy: sy(p.y), r: 12, fill: "transparent" }, g);
    const on = (e) => (dot.setAttribute("r", 6), showTip(e, p.title, p.tip || [{ value: `${xfmt(p.x)}, ${yfmt(p.y)}` }]));
    g.addEventListener("pointermove", on);
    g.addEventListener("focus", () => on({ clientX: box.getBoundingClientRect().left + sx(p.x), clientY: box.getBoundingClientRect().top + sy(p.y) }));
    const off = () => (dot.setAttribute("r", 4.5), hideTip());
    g.addEventListener("pointerleave", off);
    g.addEventListener("blur", off);
  }
  box.replaceChildren(svg);
}

// Sortable table. cols = [{ key, label, fmt, right, cls(row) }]; rows are plain objects.
export function table(box, cols, rows, { sortKey, desc = true, limit } = {}) {
  let key = sortKey, down = desc;
  const draw = () => {
    const sorted = key ? [...rows].sort((a, b) => {
      const x = a[key], y = b[key];
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * (down ? -1 : 1);
    }) : rows;
    const shown = limit ? sorted.slice(0, limit) : sorted;
    box.innerHTML = `<table class="w-full text-sm whitespace-nowrap"><thead class="text-left text-slate-500 border-b border-slate-200"><tr>${cols.map((c) => `<th class="p-2 font-medium ${c.right ? "text-right" : ""}"><button data-k="${esc(c.key)}" class="hover:text-slate-900">${esc(c.label)}${key === c.key ? (down ? " ↓" : " ↑") : ""}</button></th>`).join("")}</tr></thead><tbody style="font-variant-numeric:tabular-nums">${shown.map((r) => `<tr class="border-b border-slate-100 last:border-0">${cols.map((c) => `<td class="p-2 ${c.right ? "text-right" : ""} ${c.cls ? c.cls(r) : ""}">${c.html ? c.html(r) : esc(c.fmt ? c.fmt(r[c.key], r) : r[c.key])}</td>`).join("")}</tr>`).join("") || `<tr><td class="p-2 text-slate-500" colspan="${cols.length}">Nothing here yet.</td></tr>`}</tbody></table>`;
    box.querySelectorAll("th button").forEach((b) => (b.onclick = () => {
      if (key === b.dataset.k) down = !down;
      else (key = b.dataset.k), (down = true);
      draw();
    }));
  };
  draw();
}

export const tile = (label, value, sub = "", cls = "") => `<div class="bg-white rounded-xl border border-slate-200 p-3"><div class="text-xs text-slate-500">${esc(label)}</div><div class="text-xl font-semibold mt-0.5 ${cls}">${value}</div>${sub ? `<div class="text-xs text-slate-500 mt-0.5 truncate">${sub}</div>` : ""}</div>`;
export const tone = (n) => (n == null ? "" : n < 0 ? "text-rose-600" : "text-emerald-600");

// Redraw charts when the window size changes (phone rotation, resizing).
export function onResize(fn) {
  let t;
  let w = innerWidth;
  const on = () => {
    if (innerWidth === w) return;
    w = innerWidth;
    clearTimeout(t);
    t = LIFE ? LIFE.later(fn, 150) : setTimeout(fn, 150);
  };
  if (LIFE) LIFE.on(window, "resize", on); else addEventListener("resize", on);
}

// "What should I do next?" card: shows the last saved answer and asks Claude for a fresh one.
// Optional thumbs up / down on a suggestion; the next Ask Claude and rules review learn from them.
let votes = {};
const thumbs = (area, item) => {
  const v = votes[`${area}|${item}`]?.vote;
  const b = (vote, icon, label) => `<button type="button" data-vote="${vote}" data-area="${area}" data-item="${esc(item)}" aria-label="${label}" class="px-1.5 rounded border text-xs ${v === vote ? "border-slate-500 bg-slate-200" : "border-transparent opacity-60 hover:opacity-100"}">${icon}</button>`;
  return `<span class="inline-flex gap-1 ml-1 align-middle">${b("up", "👍", "Useful")}${b("down", "👎", "Not useful")}</span>`;
};
async function loadVotes(channel) {
  votes = await api(`/stats/ratings/${channel}`).catch(() => ({}));
}
function wireVotes(box, channel) {
  box.querySelectorAll("[data-vote]").forEach((btn) => (btn.onclick = async () => {
    const key = `${btn.dataset.area}|${btn.dataset.item}`;
    const vote = votes[key]?.vote === btn.dataset.vote ? "clear" : btn.dataset.vote;
    try {
      await api("/stats/rate", { channel, area: btn.dataset.area, item: btn.dataset.item, vote });
      if (vote === "clear") delete votes[key];
      else votes[key] = { vote };
      btn.parentElement.querySelectorAll("[data-vote]").forEach((x) => {
        const on = votes[key]?.vote === x.dataset.vote;
        x.classList.toggle("bg-slate-200", on), x.classList.toggle("border-slate-500", on), x.classList.toggle("border-transparent", !on), x.classList.toggle("opacity-60", !on);
      });
    } catch (err) {
      await confirmBox({ title: "", text: err.message, no: null });
    }
  }));
}

// Ask Claude and the rules check run in the background on the PC. The page shows a running one (even after leaving
// and coming back), checks every few seconds, and draws the result when it's done.
function follow({ path, box, btn, waitId, label, typicalKey, typicalMs, render, failText }) {
  let timer = null;
  const watch = (task) => {
    btn.disabled = true;
    const offset = Date.now() - Date.parse(task.since || new Date().toISOString());
    box.innerHTML = `<div class="text-sm text-slate-500" id="${waitId}"></div><div class="text-xs text-slate-500 mt-1">Runs on the PC, so you can leave this page. It'll be here when you come back.</div><div class="text-xs text-amber-700" id="${waitId}-lost"></div>`;
    const stop = window.timing.ticker($(waitId), (ms) => `${label} ${window.timing.progressText({ elapsedMs: ms + offset, typicalMs: window.timing.typical(typicalKey) || typicalMs })}`);
    clearInterval(timer);
    timer = (LIFE ? LIFE.every.bind(LIFE) : setInterval)(async () => {
      const d = await api(path).catch((err) => (($(`${waitId}-lost`).textContent = err.message), null));
      if (d) $(`${waitId}-lost`).textContent = "";
      if (!d || d.task?.running) return;
      clearInterval(timer);
      stop();
      btn.disabled = false;
      if (d.task?.error) box.innerHTML = `<div class="text-sm text-red-700">${failText}: ${esc(d.task.error)}</div>`;
      else {
        window.timing.remember(typicalKey, Date.now() - Date.parse(task.since || new Date().toISOString()));
        render(d);
      }
    }, 4000);
  };
  const show = (d) => (d?.task?.running ? watch(d.task) : render(d));
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const r = await api(path, {}, { password: true, why: "This calls a paid AI model, so it needs your dashboard password." });
      watch(r.task || { since: new Date().toISOString() });
    } catch (err) {
      btn.disabled = false;
      box.innerHTML = `<div class="text-sm text-red-700">${failText}: ${esc(err.message)}</div>`;
    }
  };
  return show;
}

export function insights(channel) {
  const box = $("insights"), btn = $("insightsBtn"), when = $("insightsWhen");
  const render = (d) => {
    if (!d?.suggestions?.length) {
      box.innerHTML = '<div class="text-sm text-slate-500">Ask Claude to read these numbers and suggest what to try next.</div>';
      return;
    }
    when.textContent = d.at ? `Last asked ${new Date(d.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "";
    box.innerHTML = `${d.headline ? `<p class="text-sm mb-3">${esc(d.headline)}</p>` : ""}<ol class="space-y-3">${d.suggestions.map((s, i) => `<li class="flex gap-3"><span class="shrink-0 w-6 h-6 rounded-full bg-slate-100 text-xs flex items-center justify-center text-slate-600">${i + 1}</span><div><div class="font-medium text-sm">${esc(s.title)}${thumbs("insights", s.title)}</div><div class="text-sm text-slate-600">${esc(s.detail)}</div>${s.evidence ? `<div class="text-xs text-slate-500 mt-0.5">Based on: ${esc(s.evidence)}</div>` : ""}</div></li>`).join("")}</ol><p class="text-xs text-slate-500 mt-3">👍 / 👎 is optional. The next suggestions and the rules check learn from it.</p>`;
    wireVotes(box, channel);
  };
  const show = follow({ path: `/stats/insights/${channel}`, box, btn, waitId: "insightsWait", label: "Claude is reading your numbers…", typicalKey: "insights", typicalMs: 60000, render, failText: "Couldn't get suggestions" });
  loadVotes(channel).then(() => api(`/stats/insights/${channel}`)).then(show).catch(() => render(null));
}

// "Rules check" card: when the channel's rules were last checked against the numbers, and what the check found.
export function rulesReview(channel) {
  const box = $("rules"), btn = $("rulesBtn"), status = $("rulesStatus");
  const VERDICT = { helped: "text-emerald-700", hurt: "text-red-700", "no clear effect": "text-slate-500", "too early": "text-slate-500" };
  const list = (title, items, row) => (items?.length ? `<h4 class="text-sm font-medium mt-4 mb-1">${esc(title)}</h4><ul class="space-y-2">${items.map((x) => `<li class="text-sm">${row(x)}</li>`).join("")}</ul>` : "");
  const render = (d) => {
    const s = d?.status, r = d?.review;
    status.textContent = s ? (s.lastAt ? `Last checked ${s.days === 0 ? "today" : `${s.days} day${s.days === 1 ? "" : "s"} ago`}. ${s.videosSince} new video${s.videosSince === 1 ? "" : "s"} and ${s.changesSince} rule change${s.changesSince === 1 ? "" : "s"} since.${s.due ? " Due for another check." : ""}` : "Not checked yet. It runs on its own every 14 days or 10 new videos.") : "";
    if (!r) {
      box.innerHTML = '<div class="text-sm text-slate-500">Claude compares your channel rules, and every change you have made to them, with how the videos did. It only suggests edits. Your rules file never changes unless you change it.</div>';
      return;
    }
    box.innerHTML = `<p class="text-sm">${esc(r.summary)}</p>` +
      list("Worth questioning", r.question, (x) => `<div class="font-medium">${esc(x.rule)}${thumbs("rules", x.rule)}</div><div class="text-slate-600">${esc(x.why)}</div><div class="text-xs text-slate-500">Based on: ${esc(x.evidence)}</div>`) +
      list("Suggested edits to try", r.proposals, (x) => `<div class="font-medium">${esc(x.edit)}${thumbs("rules", x.edit)}</div><div class="text-slate-600">${esc(x.why)}</div>`) +
      list("Past rule changes", r.changes, (x) => `<div><span class="text-slate-500">${esc(x.date)}</span> ${esc(x.change)} <span class="font-medium ${VERDICT[x.verdict] || ""}">${esc(x.verdict)}</span></div><div class="text-xs text-slate-500">${esc(x.evidence)}</div>`) +
      list("Backed by the numbers", r.keep, (x) => `<div>${esc(x.rule)}</div><div class="text-xs text-slate-500">${esc(x.evidence)}</div>`) +
      list("TikTok on its own", r.tiktok, (x) => `<div class="font-medium">${esc(x.finding)}${thumbs("rules", x.finding)}</div><div class="text-slate-600">${esc(x.suggestion)}</div><div class="text-xs text-slate-500">Based on: ${esc(x.evidence)}</div>`) +
      list("Stops the app could settle itself", r.self_checks, (x) => `<div class="font-medium">${esc(x.stop)} <span class="text-slate-500 font-normal">(${esc(x.times)}x)</span>${thumbs("rules", x.stop)}</div><div class="text-slate-600">${esc(x.check)}</div><div class="text-xs text-slate-500">You decided it from: ${esc(x.signal)}</div>`) +
      list("Lessons the other channel's review will test", r.shared, (x) => `<div>${esc(x.lesson)}${thumbs("rules", x.lesson)}</div><div class="text-xs text-slate-500">${esc(x.evidence)}</div>`);
    wireVotes(box, channel);
  };
  const show = follow({ path: `/stats/rules/${channel}`, box, btn, waitId: "rulesWait", label: "Claude is checking your rules against every video…", typicalKey: "rules", typicalMs: 120000, render, failText: "Couldn't check the rules" });
  loadVotes(channel).then(() => api(`/stats/rules/${channel}`)).then(show).catch(() => render(null));
}

// Reach (to-do #18): impressions, click rate and viewed vs swiped away, from pulls that opened Studio's Reach tab.
// rows: [{ title, views, ctr, impressions, viewedVsSwiped, subsPer1k }]. Draws tiles, click rate vs views, and the
// best and worst click rates into box; an empty box explains how to get the numbers.
export function reachSection(box, rows) {
  const have = rows.filter((r) => r.ctr != null || r.impressions != null || r.viewedVsSwiped != null);
  if (!have.length) {
    box.innerHTML = '<p class="text-sm text-slate-500">No reach numbers yet. On the Stats page, run an Advanced pull with "Reach page" ticked; it opens each video\'s Reach tab.</p>';
    return;
  }
  const ctr = have.filter((r) => r.ctr != null), vs = have.filter((r) => r.viewedVsSwiped != null), sub = rows.filter((r) => r.subsPer1k != null);
  const imp = sum(have, (r) => r.impressions);
  const pts = ctr.filter((r) => r.views != null).map((r) => ({ x: r.ctr * 100, y: r.views, title: r.title, tip: [{ value: pct(r.ctr, 1), label: "click rate" }, { value: int(r.views), label: "views" }, ...(r.impressions != null ? [{ value: int(r.impressions), label: "impressions" }] : [])] }));
  const link = corr(pts);
  const sorted = [...ctr].sort((a, b) => b.ctr - a.ctr);
  const li = (r) => `<li class="flex gap-2"><span class="flex-1 min-w-0 truncate">${esc(r.title)}</span><span class="whitespace-nowrap">${pct(r.ctr, 1)}</span></li>`;
  box.innerHTML = `<div class="grid grid-cols-2 md:grid-cols-4 gap-3">${[
    tile("Impressions", compact(imp), `${have.length} video${have.length === 1 ? "" : "s"} with reach numbers`),
    tile("Click rate", ctr.length ? pct(avg(ctr, (r) => r.ctr), 1) : "–", ctr.length ? `typical ${pct(median(ctr.map((r) => r.ctr)), 1)}` : "not shown for these"),
    tile("Viewed vs swiped away", vs.length ? pct(avg(vs, (r) => r.viewedVsSwiped)) : "–", vs.length ? "share who kept watching" : "Shorts only"),
    tile("Subs per 1,000 views", sub.length ? avg(sub, (r) => r.subsPer1k).toFixed(1) : "–", sub.length ? `${sub.length} video${sub.length === 1 ? "" : "s"}` : ""),
  ].join("")}</div>
  <h4 class="font-medium mt-4">Click rate vs views</h4><div class="reachChart"></div>
  <p class="text-sm text-slate-500">${link == null ? "" : Math.abs(link) < 0.2 ? "No clear link between click rate and views so far." : `A ${link > 0 ? "higher" : "lower"} click rate tends to go with more views (a ${Math.abs(link) < 0.5 ? "weak" : "fairly strong"} link, ${pts.length} videos).`}</p>
  ${sorted.length >= 10 ? `<div class="grid md:grid-cols-2 gap-4 mt-3"><div><h4 class="font-medium">Best click rates ↑</h4><ul class="text-sm space-y-1 mt-1">${sorted.slice(0, 5).map(li).join("")}</ul></div><div><h4 class="font-medium">Lowest click rates ↓</h4><ul class="text-sm space-y-1 mt-1">${sorted.slice(-5).reverse().map(li).join("")}</ul></div></div>` : sorted.length >= 2 ? `<h4 class="font-medium mt-3">Click rates, best first</h4><ul class="text-sm space-y-1 mt-1">${sorted.map(li).join("")}</ul>` : ""}`;
  scatter(box.querySelector(".reachChart"), pts, { xfmt: (v) => `${v.toFixed(1)}%`, yfmt: compact, xLabel: "Click rate", yLabel: "Views", emptyText: "Needs at least 3 videos with a click rate." });
}

// Comment highlights (to-do #18): from comment text saved by stats pulls. vids: [{ videoId, title }] in scope;
// comments: the /stats/comments map. Most liked comments, questions viewers ask, and the most talked-about videos.
export function commentSection(box, vids, comments) {
  const rows = vids.flatMap((v) => (comments[v.videoId]?.items || []).map((c) => ({ ...c, title: v.title })));
  if (!rows.length) {
    box.innerHTML = '<p class="text-sm text-slate-500">No comment text yet. A stats pull reads comments on videos whose comment count changed.</p>';
    return;
  }
  // the hub's own channels (by id or name), so a comment from the channel itself isn't counted as a fan's
  const own = new RegExp(`^@?(${CHANNELS.flatMap((c) => [c.id, c.name]).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, " ?")).join("|") || "$^"})`, "i");
  const fans = rows.filter((c) => !own.test(String(c.author || "").trim()));
  const liked = [...fans].sort((a, b) => b.likes - a.likes).slice(0, 8);
  const asks = fans.filter((c) => /\?\s*$|\?\s/.test(c.text)).sort((a, b) => b.likes - a.likes).slice(0, 8);
  const talk = vids.map((v) => ({ title: v.title, n: comments[v.videoId]?.count || 0 })).filter((v) => v.n).sort((a, b) => b.n - a.n).slice(0, 5);
  const item = (c) => `<li class="py-1"><div>${esc(c.text)}</div><div class="text-xs text-slate-500">${c.likes ? `${int(c.likes)} like${c.likes === 1 ? "" : "s"} · ` : ""}${esc(c.title)}</div></li>`;
  box.innerHTML = `<div class="grid md:grid-cols-2 gap-5">
    <div><h4 class="font-medium">Most liked comments</h4><ul class="text-sm mt-1">${liked.map(item).join("")}</ul></div>
    <div><h4 class="font-medium">Questions viewers ask</h4>${asks.length ? `<ul class="text-sm mt-1">${asks.map(item).join("")}</ul>` : '<p class="text-sm text-slate-500 mt-1">No questions in the comments read so far.</p>'}
      <h4 class="font-medium mt-4">Most talked about</h4><ul class="text-sm space-y-1 mt-1">${talk.map((v) => `<li class="flex gap-2"><span class="flex-1 min-w-0 truncate">${esc(v.title)}</span><span class="whitespace-nowrap">${int(v.n)} comment${v.n === 1 ? "" : "s"}</span></li>`).join("")}</ul></div>
  </div><p class="text-xs text-slate-500 mt-3">From ${int(rows.length)} comments on ${int(vids.filter((v) => comments[v.videoId]).length)} videos. Your own replies are left out.</p>`;
}


// Fills the four cards the clip and pack pages share (empty <section> elements with ids insightsCard, rulesCard,
// reachCard, commentCard) with their headings and the ids insights(), rulesReview(), reachSection() and commentSection() draw into.
// Call it once, first thing in the page's script.
export function statsCards() {
  const head = (h, id, btn) => `<div class="flex items-start gap-3 flex-wrap"><div class="flex-1 min-w-0"><h2 class="font-semibold">${h}</h2><p id="${id}" class="text-xs text-slate-500"></p></div>${btn}</div>`;
  $("insightsCard").innerHTML = head("What should I do next?", "insightsWhen", '<button id="insightsBtn" class="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">Ask Claude</button>') + '<div id="insights" class="mt-3"></div>';
  $("rulesCard").innerHTML = head("Rules check", "rulesStatus", '<button id="rulesBtn" class="border border-slate-300 hover:border-slate-400 text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">Review rules now</button>') + '<div id="rules" class="mt-3"></div>';
  $("reachCard").innerHTML = '<h3 class="font-medium mb-2">Reach: impressions and click rate</h3><div id="reachBox"></div>';
  $("commentCard").innerHTML = '<h3 class="font-medium mb-2">What viewers say</h3><div id="commentBox"><p class="text-sm text-slate-500">Loading comments…</p></div>';
}

// The "Show" chips (buttons with data-range): marks the clicked one pressed and calls onPick(its data-range value).
export function rangeChips(onPick) {
  const chips = ROOT ? ROOT.querySelectorAll("[data-range]") : document.querySelectorAll("[data-range]");
  chips.forEach((b) => (b.onclick = () => {
    chips.forEach((x) => x.setAttribute("aria-pressed", x === b));
    onPick(b.dataset.range);
  }));
}

// Loads /stats for a page: set(rows, reach) gets d[need] and the reach numbers, then render() draws; the comments
// arrive after the first draw (setComments(c), then render() again). A missing d[need] or a failed load shows the red banner.
export async function loadStats({ need, missing, set, setComments, render }) {
  try {
    const d = await api("/stats");
    if (!d[need]) throw new Error(missing);
    set(d[need], d.reach || {});
    api("/stats/comments").then((c) => (setComments(c), render())).catch(() => {});
    render();
    onResize(render);
  } catch (err) {
    showErr("Couldn't load stats: " + err.message);
  }
}
