// Neural view, the web (2026-11-14). the owner: "make sure it makes webs to trace between and show inter agent connections".
// Every worker that handed work to, reported back to or left a note for another, on a ring grouped by project, with a
// line for each pair. Tap a worker to light up its links; tap a second to trace the shortest path between them, hop by
// hop, with each hand-off's job one tap from its tree. What a line is shows in its style, not just its colour:
// solid = work handed on (arrow toward who got it), dashed = results back, dotted = notes, thin and faint = chat.
// Data: /api/agents/web?days=7[&social=1] (buildWeb in src/pipeline/trace.js), asked every 15 seconds.
// Classic script, same global scope as the other campus parts (uses neural, neuralOpen, neuralMode, esc, data, nameOf, PROVIDER).
const WEB_KIND = { handoff: "➜ handed on", result: "↩ result back", note: "✉ note" };

async function webPoll() {
  const n = neural; if (!n) return;
  if (n.web && Date.now() - n.webAt < 14000) return; // the 5-second timer is the tree's; the web needs less
  try {
    const days = document.getElementById("neuralDays")?.value || 7, social = document.getElementById("neuralSocial")?.checked ? "&social=1" : "";
    const r = await fetch(`/api/agents/web?days=${days}${social}`).then((x) => (x.ok ? x.json() : x.json().catch(() => ({})).then((b) => Promise.reject(new Error(x.status === 401 ? "Sign in again." : b.error || "The hub didn't answer.")))));
    if (neural !== n || n.mode !== "web") return;
    n.web = r; n.webAt = Date.now(); n.fail = 0;
    const ids = new Set(r.nodes.map((x) => x.id));
    if (n.a && !ids.has(n.a)) { n.missing = n.a; n.a = null; } else n.missing = null;
    if (n.b && !ids.has(n.b)) n.b = null;
    n.path = n.a && n.b ? webPath(n.a, n.b) : null;
    webState(); webFeed();
  } catch (err) {
    if (neural !== n) return;
    if (++n.fail >= 2 || !n.web) document.getElementById("neuralState").textContent = `Not updating: ${err.message}`;
  }
}
const webName = (id) => { if (id === OWNER_ID()) return "You"; const d = (data?.desks || []).find((x) => x.id === id); return d && typeof nameOf === "function" ? nameOf(d) : id; };
const webEdge = (p, q) => neural.web.edges.find((e) => (e.a === p && e.b === q) || (e.a === q && e.b === p));
// Shortest path by hops (breadth-first), over the links shown.
function webPath(from, to) {
  const adj = new Map();
  for (const e of neural.web.edges) { (adj.get(e.a) || adj.set(e.a, []).get(e.a)).push(e.b); (adj.get(e.b) || adj.set(e.b, []).get(e.b)).push(e.a); }
  const prev = new Map([[from, null]]), q = [from];
  while (q.length) { const x = q.shift(); if (x === to) break; for (const y of adj.get(x) || []) if (!prev.has(y)) { prev.set(y, x); q.push(y); } }
  if (!prev.has(to)) return [];
  const out = []; for (let x = to; x != null; x = prev.get(x)) out.unshift(x);
  return out;
}
function webState() {
  const n = neural, w = n?.web; if (!w) return;
  const work = w.edges.reduce((s, e) => s + e.work, 0), res = w.edges.reduce((s, e) => s + e.results, 0);
  const rooms = new Set(w.nodes.map((x) => x.room).filter(Boolean)).size;
  const head = `${w.nodes.length} workers in ${rooms} projects, ${w.edges.length} links over the last ${w.days === 1 ? "day" : `${w.days} days`}: ${work} hand-offs, ${res} results back`;
  const how = n.a && n.b ? "" : n.a ? " Tap another worker to trace the path between them." : " Tap a worker to see its links.";
  const miss = n.missing ? ` ${webName(n.missing)} has no links in this window.` : "";
  document.getElementById("neuralState").textContent = `${head}.${miss}${how} Lines: solid = work handed on (arrow to who got it), dashed = results back, dotted = notes${w.social ? ", faint = chat" : ""}.`;
}

// ---------- layout: a ring, grouped by project, with a small gap between projects ----------
function webLayout(w, h) {
  const nodes = neural.web.nodes, small = w < 520;
  const gaps = nodes.reduce((s, x, i) => s + (i && x.room !== nodes[i - 1].room ? 1 : 0), 0) + 1;
  const slots = nodes.length + gaps * 0.8, R = Math.max(70, Math.min(w / 2, h / 2) - (small ? 26 : 60)), sx = w > h ? Math.min(1.35, w / h) : 1;
  let k = 0.4;
  return nodes.map((x, i) => {
    if (i && x.room !== nodes[i - 1].room) k += 0.8;
    const a = -Math.PI / 2 + (k / slots) * Math.PI * 2; k++;
    return { node: x, a, x: w / 2 + Math.cos(a) * R * sx, y: h / 2 + Math.sin(a) * R };
  });
}
function webDraw(t) {
  const n = neural, c = document.getElementById("neuralC"); if (!n || !c) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  if (!n.web) return;
  const pos = (n.wpos = webLayout(w, h)), at = new Map(pos.map((p) => [p.node.id, p])), cx = w / 2, cy = h / 2, small = w < 520;
  const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const onPath = new Set(), pathEdge = new Set();
  (n.path || []).forEach((id, i, arr) => { onPath.add(id); if (i) pathEdge.add([arr[i - 1], id].sort().join("|")); });
  const near = new Set(n.a ? n.web.edges.filter((e) => e.a === n.a || e.b === n.a).flatMap((e) => [e.a, e.b]) : []);
  const ctrl = (p, q) => [cx + ((p.x + q.x) / 2 - cx) * 0.35, cy + ((p.y + q.y) / 2 - cy) * 0.35];
  // core glow, like the other views
  const grad = g.createRadialGradient(cx, cy, 2, cx, cy, Math.min(w, h) * 0.22); grad.addColorStop(0, "rgba(140,170,255,0.18)"); grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad; g.beginPath(); g.arc(cx, cy, Math.min(w, h) * 0.22, 0, Math.PI * 2); g.fill();
  // links: faint first, then the lit ones on top
  const edges = [...n.web.edges].sort((e1, e2) => webLit(e1, n, pathEdge) - webLit(e2, n, pathEdge));
  for (const e of edges) {
    const p = at.get(e.a), q = at.get(e.b); if (!p || !q) continue;
    const lit = webLit(e, n, pathEdge), [mx, my] = ctrl(p, q);
    const style = e.work ? [] : e.results ? [6, 4] : e.notes ? [1.5, 4] : [];
    g.setLineDash(style);
    g.lineWidth = (e.work ? 1.2 + Math.min(3.5, Math.log2(1 + e.work) * 1.2) : e.results || e.notes ? 1.4 : 0.7) + (lit === 3 ? 2 : 0);
    const alpha = lit === 3 ? 0.95 : lit === 2 ? 0.8 : n.a ? 0.07 : e.work ? 0.42 : e.results || e.notes ? 0.32 : 0.14;
    g.strokeStyle = lit === 3 ? `rgba(255,255,255,${alpha})` : e.work ? `rgba(240,200,120,${alpha})` : e.results ? `rgba(125,220,138,${alpha})` : e.notes ? `rgba(156,199,255,${alpha})` : `rgba(200,200,220,${alpha})`;
    g.beginPath(); g.moveTo(p.x, p.y); g.quadraticCurveTo(mx, my, q.x, q.y); g.stroke();
    g.setLineDash([]);
    // arrows toward who got the work, on lit links (both ways when it went both ways)
    if (lit >= 2 && e.work) { if (e.gave[e.a]) webArrow(g, p, q, mx, my, g.strokeStyle); if (e.gave[e.b]) webArrow(g, q, p, mx, my, g.strokeStyle); }
  }
  // a pulse runs along the traced path, hop by hop
  if (n.path?.length > 1 && !calm) {
    const hop = 1100, k = Math.floor(t / hop) % (n.path.length - 1), f = (t % hop) / hop;
    const p = at.get(n.path[k]), q = at.get(n.path[k + 1]);
    if (p && q) { const [mx, my] = ctrl(p, q), u = 1 - f, x = u * u * p.x + 2 * u * f * mx + f * f * q.x, y = u * u * p.y + 2 * u * f * my + f * f * q.y; g.fillStyle = "rgba(255,255,255,0.95)"; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); g.fillStyle = "rgba(255,255,255,0.25)"; g.beginPath(); g.arc(x, y, 10, 0, Math.PI * 2); g.fill(); }
  }
  // workers: provider colour, leads a little bigger; picked ones ringed (A solid, B dashed)
  g.textBaseline = "middle";
  for (const p of pos) {
    const x = p.node, isA = x.id === n.a, isB = x.id === n.b, r = isA || isB ? 8.5 : x.lead ? 6.5 : 5;
    const dim = n.a && !isA && !near.has(x.id) && !onPath.has(x.id);
    g.globalAlpha = dim ? 0.3 : 1;
    g.fillStyle = x.id === OWNER_ID() ? "#ffffff" : PROVIDER?.[x.provider] || "#8fd18b";
    g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
    if (isA || isB || onPath.has(x.id)) { g.setLineDash(isB ? [3, 2] : []); g.strokeStyle = "#ffffff"; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, r + 3.5, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
    // names: all of them on a wide screen; on a phone only the picked, their links and the path
    if (!small || isA || isB || onPath.has(x.id) || (n.a && near.has(x.id)) || (!n.a && x.lead)) {
      const out = Math.cos(p.a) >= 0, lx = p.x + Math.cos(p.a) * (r + 6), ly = p.y + Math.sin(p.a) * (r + 6);
      g.textAlign = Math.abs(Math.cos(p.a)) < 0.25 ? "center" : out ? "left" : "right";
      g.font = `${isA || isB ? 700 : 500} ${small ? 10 : 11}px system-ui`; g.fillStyle = "#dfe6f2";
      const txt = webName(x.id).slice(0, small ? 12 : 18), tw = g.measureText(txt).width;
      const clampX = g.textAlign === "left" ? Math.min(lx, w - tw - 2) : g.textAlign === "right" ? Math.max(lx, tw + 2) : Math.max(tw / 2 + 2, Math.min(w - tw / 2 - 2, lx));
      g.fillText(txt, clampX, Math.max(7, Math.min(h - 7, ly + (Math.abs(Math.cos(p.a)) < 0.25 ? Math.sign(Math.sin(p.a)) * 6 : 0))));
    }
    g.globalAlpha = 1;
  }
  // project names around the ring on a wide screen
  if (!small) {
    g.font = "600 10px system-ui"; g.fillStyle = "rgba(170,180,200,0.55)"; g.textAlign = "center";
    const R2 = Math.min(w / 2, h / 2) - 14, sx = w > h ? Math.min(1.35, w / h) : 1, groups = new Map();
    for (const p of pos) (groups.get(p.node.room) || groups.set(p.node.room, []).get(p.node.room)).push(p.a);
    for (const [room, as] of groups) { if (!room || as.length < 2) continue; const a = (as[0] + as[as.length - 1]) / 2; g.fillText(room, cx + Math.cos(a) * R2 * sx, cy + Math.sin(a) * R2); }
  }
}
// 3 = on the traced path, 2 = touches the picked worker, 0 = the rest
function webLit(e, n, pathEdge) { return pathEdge.has([e.a, e.b].sort().join("|")) ? 3 : n.a && (e.a === n.a || e.b === n.a) ? 2 : 0; }
function webArrow(g, from, to, mx, my, col) {
  // the curve's direction where it reaches `to`
  const a = Math.atan2(to.y - my, to.x - mx), r = 11;
  g.fillStyle = col; g.beginPath();
  g.moveTo(to.x - Math.cos(a) * r, to.y - Math.sin(a) * r);
  g.lineTo(to.x - Math.cos(a - 0.45) * (r + 8), to.y - Math.sin(a - 0.45) * (r + 8));
  g.lineTo(to.x - Math.cos(a + 0.45) * (r + 8), to.y - Math.sin(a + 0.45) * (r + 8));
  g.fill();
}
function webHit(px, py) {
  let best = null, bd = Infinity;
  for (const p of neural?.wpos || []) { const d = Math.hypot(p.x - px, p.y - py); if (d <= 18 && d < bd) { best = p; bd = d; } }
  return best;
}
function webTap(px, py) { if (neural?.wpos) webPick(webHit(px, py)?.node.id || null); }
// Pick a worker: the first is A (its links light up), the next is B (the path from A to B is traced).
// Tapping A again, or empty space, steps back.
function webPick(id) {
  const n = neural; if (!n?.web) return;
  if (!id) { if (n.b) n.b = null; else n.a = null; }
  else if (!n.a) n.a = id;
  else if (id === n.a) { n.a = n.b; n.b = null; }
  else n.b = id === n.b ? null : id;
  n.path = n.a && n.b ? webPath(n.a, n.b) : null;
  n.missing = null;
  webState(); webFeed();
}
// ---------- the list under the web ----------
function webFeed() {
  const n = neural, el = document.getElementById("neuralFeed"); if (!n?.web || !el) return;
  neuralCrumbs();
  const when = (iso) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  const who = (id) => { const d = (data?.desks || []).find((x) => x.id === id); return `<b>${esc(webName(id))}</b>${d ? ` <span class="sub">${esc(id)}${d.room ? ` · ${esc(d.room)}` : ""}</span>` : ""}`; };
  const counts = (e, from) => {
    const to = e.a === from ? e.b : e.a, bits = [];
    if (e.gave[from]) bits.push(`➜ ${e.gave[from]} handed on`);
    if (e.gave[to]) bits.push(`⬅ ${e.gave[to]} got`);
    if (e.results) bits.push(`↩ ${e.results} result${e.results === 1 ? "" : "s"}`);
    if (e.notes) bits.push(`✉ ${e.notes} note${e.notes === 1 ? "" : "s"}`);
    if (e.social) bits.push(`💬 ${e.social} chat`);
    return bits.join(" · ");
  };
  const items = (e) => e.items.map((i) => `<div class="brain-row${i.kind === "handoff" ? " mark" : ""}"><span class="brain-time">${when(i.at)}</span><span>${esc(webName(i.from))} ${esc(WEB_KIND[i.kind] || i.kind)} to ${esc(webName(i.to))}${i.text ? ` · ${esc(i.text)}` : ""}${i.status ? ` · ${esc((NEURAL_STATUS[i.status] || i.status))}` : ""}${i.job ? ` <button class="pill neural-mini" data-neural="${esc(i.kind === "handoff" ? i.to : i.from)}" data-neural-job="${esc(i.job)}" data-neural-mode="tree">🌳 Tree</button>` : ""}</span></div>`).join("") + (e.more ? `<div class="sub" style="padding:4px 0">${e.more} older not shown</div>` : "");
  let html = "";
  if (n.a && n.b) {
    const p = n.path || [];
    if (p.length < 2) html = `<div class="neural-head">${who(n.a)} and ${who(n.b)}<div class="sub">Not connected in this window: no chain of hand-offs, results or notes links them. Try a longer window${n.web.social ? "" : " or tick “chat too”"}.</div></div>`;
    else {
      html = `<div class="neural-head"><b>Path: ${p.map((id) => esc(webName(id))).join(" → ")}</b><div class="sub">${p.length - 1} hop${p.length === 2 ? "" : "s"}. Each hop below, with what passed between them.</div></div>`;
      for (let i = 1; i < p.length; i++) { const e = webEdge(p[i - 1], p[i]); html += `<div class="neural-hop"><div>${who(p[i - 1])} ↔ ${who(p[i])}</div><div class="sub">${counts(e, p[i - 1])}</div></div>${items(e)}`; }
    }
  } else if (n.a) {
    const x = n.web.nodes.find((y) => y.id === n.a), mine = n.web.edges.filter((e) => e.a === n.a || e.b === n.a).sort((e1, e2) => e2.total - e1.total || String(e2.last).localeCompare(String(e1.last)));
    html = `<div class="neural-head">${who(n.a)}<div class="sub">${mine.length} link${mine.length === 1 ? "" : "s"} · handed on ${x?.gave || 0} · got ${x?.got || 0}</div>${window.campusBlocks?.buttonsFor(window.campusBlocks.roomOfDesk(n.a)) || ""}${window.campusProps?.htmlFor(window.campusBlocks?.roomOfDesk(n.a)) || ""}${n.a !== OWNER_ID() ? `<button class="pill" data-dive="${esc(n.a)}" style="margin-top:6px" title="Zoom into this worker's job tree (or double-tap them, or pinch out)">⤵ Dive into ${esc(webName(n.a))}'s work</button>` : ""}</div>`
      + mine.map((e) => { const o = e.a === n.a ? e.b : e.a; return `<div class="brain-row neural-link" data-web-pick="${esc(o)}" role="button" tabindex="0"><span>${who(o)}<br><span class="sub">${counts(e, n.a)}${e.last ? ` · last ${when(e.last)}` : ""}</span></span></div>`; }).join("");
  } else {
    const top = [...n.web.edges].sort((e1, e2) => e2.work - e1.work || e2.total - e1.total).slice(0, 15);
    html = `<div class="neural-head"><b>Busiest links</b><div class="sub">Tap a worker on the web, or a link here, to trace it.</div></div>`
      + top.map((e) => `<div class="brain-row neural-link" data-web-pick="${esc(e.a)}" data-web-then="${esc(e.b)}" role="button" tabindex="0"><span>${who(e.a)} ↔ ${who(e.b)}<br><span class="sub">${counts(e, e.a)}</span></span></div>`).join("");
  }
  el.innerHTML = html || `<div class="sub" style="padding:10px 0">No links in this window.</div>`;
}
// rows in the list pick workers too
document.addEventListener("click", (e) => {
  const row = e.target.closest?.("[data-web-pick]"); if (!row || !neural || neural.mode !== "web" || e.target.closest("button")) return;
  if (row.dataset.webThen) { neural.a = row.dataset.webPick; neural.b = null; webPick(row.dataset.webThen); } else webPick(row.dataset.webPick);
});
document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.closest?.("[data-web-pick]")) { e.preventDefault(); e.target.click(); } });
