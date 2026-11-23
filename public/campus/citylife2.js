// Campus: City life, lane L2 (goods and records) and Weather routines (docs/campus-living-city.md, items 8 to 15).
// Same rules as lane L1 (citylife.js): every effect has its own switch in the City life menu, a lowest graphics level
// (3d/quality.js), a word as well as any colour, and costs no AI. New here: one read-only answer from the hub, GET
// /api/agents/city (src/pipeline/city.js, counts only), asked once a minute while the page is visible and City life is on.
//   8 Shipping docks   9 Cargo barge (3D)   10 Library archive   11 Pneumatic tubes   12 Construction crane (3D)
//   13 Weather balloons (3D)   14 Corporate blimp (3D)   15 Weather routines
// This file works the facts out once (cityLife2.facts(), the same object for both views) and draws the 2D parts; the 3D
// parts are in public/campus/3d/citylife2.js. Part of public/campus.html, loaded in order by campus/boot.js (after
// citylife.js, whose switches and menu it extends); the files share one global scope (classic scripts).
"use strict";
const cityLife2 = (() => {
  const cl = cityLife;
  // id, icon, name, where it shows, what it does in plain words; needs: a part of the hub it reads (modOn); tier: 3d/quality.js
  const MORE = [
    { id: "docks", icon: "📦", name: "Shipping docks", where: "2D and 3D", needs: "youtube", about: "A dock on the river bank. Crates stack up for videos waiting to post, and a truck drives off while one is going out. Needs the YouTube part." },
    { id: "barge", icon: "🚢", name: "Cargo barge", where: "3D only", about: "A barge drifts along the river while a job or batch with several steps is running, loaded by how far along it is (\"step 2 of 3\")." },
    { id: "library", icon: "📚", name: "Library archive", where: "2D and 3D", about: "A small library on the lawn. The shelves fill with the work finished this week; a lamp on the roof shows the last backup, with a warning sign and words if it failed." },
    { id: "tubes", icon: "📨", name: "Pneumatic tubes", where: "2D and 3D", about: "Tubes run to the CEO tower. A capsule goes down the tube for each thing waiting on you (a question, a hire, a held video) and they pile up by the tower until you answer." },
    { id: "crane", icon: "🏗", name: "Construction crane", where: "3D only", about: "A crane stands over a project's building while a pull request on it has a fresh review. It goes when the review is a few days old." },
    { id: "balloons", icon: "🎈", name: "Weather balloons", where: "3D only", about: "The two hot-air balloons carry banners: whether this month's spend is on track, near its cap or over it, and how many alerts have fired in the last day." },
    { id: "blimp", icon: "📰", name: "Corporate blimp", where: "3D only", about: "Now and then a blimp crosses the sky trailing the titles of the newest updates to the hub." },
    { id: "weather", icon: "☂", name: "Weather routines", where: "2D and 3D", about: "Real weather changes the day. Umbrellas on walkers in rain, fewer out in snow, and everyone stays in when it is heavy.", petAbout: "Real weather changes the day. Umbrellas on walkers in rain, fewer out in snow, everyone stays in when it is heavy, and {pet} naps indoors." },
  ];
  cl.EFFECTS.push(...MORE);
  const NEEDS_PART = Object.fromEntries(MORE.filter((e) => e.needs).map((e) => [e.id, e.needs]));
  const NEEDS_CITY = ["docks", "barge", "library", "tubes", "crane", "balloons", "blimp"]; // the effects that read the hub's answer

  // ---------- the hub's one small answer (GET /api/agents/city), once a minute while the page is visible ----------
  let city = null, cityRev = 0, lastAsk = 0, asking = false;
  const int = (v, max = 999) => (Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0);
  const word = (v, n = 90) => String(v ?? "").replace(/[\r\n\t]+/g, " ").slice(0, n);
  function sane(c) { // only what the campus uses, every number a small whole count, every word short: a wrong answer can't break a page
    if (!c || typeof c !== "object") return null;
    return {
      uploads: c.uploads ? { posting: int(c.uploads.posting), waiting: int(c.uploads.waiting) } : null,
      live: c.live ? { recording: int(c.live.recording) } : null,
      backup: c.backup && Number.isFinite(Date.parse(c.backup.at)) ? { at: word(c.backup.at, 40), ok: c.backup.ok !== false } : null,
      alerts: c.alerts ? { open: int(c.alerts.open) } : null,
      forecast: ["ok", "near", "over"].includes(c.forecast) ? c.forecast : null,
      changelog: Array.isArray(c.changelog) ? c.changelog.slice(0, 3).map((t) => word(t)).filter(Boolean) : [],
      prRooms: c.prReviews?.rooms && typeof c.prReviews.rooms === "object" ? Object.entries(c.prReviews.rooms).slice(0, 8).map(([k, n]) => [word(k, 48), int(n, 99)]) : [],
      held: c.owner ? int(c.owner.held) : 0,
      batches: Array.isArray(c.batches) ? c.batches.slice(0, 5).map((b) => ({ step: int(b.step, 99), of: int(b.of, 99) })).filter((b) => b.of > 1) : [],
    };
  }
  async function askCity(force) {
    if (asking || document.visibilityState !== "visible" || !cl.master || typeof api !== "function") return;
    if (!NEEDS_CITY.some((id) => cl.switchedOn(id))) return;
    if (!force && Date.now() - lastAsk < 55000) return;
    asking = true; lastAsk = Date.now();
    try { const c = sane(await api("/agents/city")); if (c) { city = c; cityRev++; } } catch { /* an older hub without the route (needs a restart): the effects just stay quiet */ }
    asking = false;
  }
  setInterval(askCity, 60000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && askCity());
  window.addEventListener("citylife:change", () => askCity(!city)); // a switch turned on: ask now if we never have
  setTimeout(() => askCity(true), 2500);

  // ---------- places: free ground for the library, the river bank for the docks ----------
  let avoid = [], places = null, placesKey = "";
  const inR = (hw, hd, x, z, q, m) => x + hw > q.x - m && x - hw < q.x + q.w + m && z + hd > q.y - m && z - hd < q.y + q.d + m;
  function clear(x, z, hw, hd, m = 0.8, bank = false) {
    const R = campus.river, sq = campus.square, V = campus.village;
    if (rooms.some((r) => inR(hw, hd, x, z, r, m))) return false;
    if ((campus.towers || []).some((t) => inR(hw, hd, x, z, t, m))) return false;
    if (R && z + hd > R.y - (bank ? 0.2 : 0.9) && z - hd < R.y + R.d + 0.9) return false; // (the docks stand on the bank itself)
    if (sq && Math.hypot(x - sq.x, z - sq.y) < sq.r + 0.4 + Math.max(hw, hd)) return false;
    if (V && x + hw > V.x0 - V.road - 0.6 && x - hw < V.x1 + V.road + 0.6 && z + hd > V.y0 - V.road - 0.6 && z - hd < V.y1 + V.road + 0.6) return false;
    if ((campus.roads || []).some((q) => !["plaza-row", "quad", "concourse"].includes(q.kind) && inR(hw, hd, x, z, q, 0.3))) return false;
    if (campus.clock && Math.hypot(x - campus.clock.x, z - campus.clock.y) < 2.4) return false;
    return !avoid.some((o) => (o[0] === "rect" ? x + hw > o[1] - 0.3 && x - hw < o[1] + o[3] + 0.3 && z + hd > o[2] - 0.3 && z - hd < o[2] + o[4] + 0.3 : Math.hypot(x - o[1], z - o[2]) < o[3] + Math.max(hw, hd) * 0.8));
  }
  function findPlaces() {
    const key = rooms.map((r) => `${r.id}:${r.x},${r.y}`).join("|") + avoid.length;
    if (places && placesKey === key) return places;
    placesKey = key;
    const out = { lib: null, dock: null };
    // the library (2.6 x 1.7): the lawn's left end, else the nearest free ground round the square
    const LW = 2.6, LD = 1.7, L = campus.lawn, sq = campus.square;
    if (L && L.d > 2.2) { for (const f of [0.14, 0.86, 0.3, 0.7]) { const x = L.x + L.w * f, z = L.y + L.d / 2; if (clear(x, z, LW / 2, LD / 2)) { out.lib = { x: x - LW / 2, y: z - LD / 2, w: LW, d: LD }; break; } } }
    const c0 = sq ? [sq.x, sq.y] : L ? [L.x + L.w / 2, L.y + L.d / 2] : null;
    if (!out.lib && c0) for (let rad = 5; rad <= 18 && !out.lib; rad += 1.2) for (let k = 0; k < 20; k++) { const a = (k / 20) * Math.PI * 2 + 2.3, x = c0[0] + Math.cos(a) * rad, z = c0[1] + Math.sin(a) * rad; if (clear(x, z, LW / 2, LD / 2)) { out.lib = { x: x - LW / 2, y: z - LD / 2, w: LW, d: LD }; break; } }
    // the docks (4.6 x 1.5) on the river's near bank, as close as it goes to the building that hosts the pipeline
    const R = campus.river;
    if (R) {
      const DW = 4.6, DD = 1.5, host = (window.campusBlocks?.list?.() || []).filter((b) => b.page === "pipeline").flatMap((b) => b.rooms || []).map((id) => rooms.find((r) => r.id === id)).find(Boolean);
      const want = host ? host.x + host.w / 2 : (R.x0 + R.x1) / 2, z = R.y - 0.35 - DD / 2, cands = [];
      for (let x = R.x0 + DW / 2 + 2; x <= R.x1 - DW / 2 - 2; x += 0.8) if (!(campus.bridges || []).some((b) => Math.abs(x - b.x) < b.w / 2 + DW / 2 + 1)) cands.push(x);
      cands.sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
      const x = cands.find((cx) => clear(cx, z, DW / 2, DD / 2, 0.3, true)); // (the bank is narrow: the margin to the street is small)
      if (x != null) out.dock = { x: x - DW / 2, y: z - DD / 2, w: DW, d: DD };
    }
    places = out;
    return out;
  }
  // the barge's stretch of river: the widest gap between bridges (the whole river in the quad layout)
  function bargeRun() {
    const R = campus.river; if (!R) return null;
    const pts = [R.x0 + 3, ...(campus.bridges || []).flatMap((b) => [b.x - b.w / 2 - 1.5, b.x + b.w / 2 + 1.5]), R.x1 - 3].sort((a, b) => a - b);
    let best = null;
    for (let i = 0; i + 1 < pts.length; i += 2) if (!best || pts[i + 1] - pts[i] > best[1] - best[0]) best = [pts[i], pts[i + 1]];
    return best && best[1] - best[0] >= 6 ? { x0: best[0], x1: best[1], z: R.y + R.d / 2 } : null;
  }

  // ---------- the facts, once per poll (the same object for 2D and 3D, so the 3D side only rebuilds when something changed) ----------
  let F = null;
  const pathLen = (p) => { let n = 0; for (let i = 1; i < p.length; i++) n += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return n; };
  const routes = new Map(); // a tube's path per building: worked out once (the street route is the dear part)
  function tubeRoute(r, to) {
    const k = `${r.id}:${r.x},${r.y}>${to[0].toFixed(1)},${to[1].toFixed(1)}:${window.campusNav ? 3 : 2}`;
    if (routes.has(k)) return routes.get(k);
    const from = doorOf(r, 0.45), path = [from, ...(route(from, to) || [])];
    if (path.length < 2 || Math.hypot(path.at(-1)[0] - to[0], path.at(-1)[1] - to[1]) > 0.4) path.push(to);
    const v = { path, len: pathLen(path) };
    if (routes.size > 60) routes.clear();
    routes.set(k, v);
    return v;
  }
  const ag = (iso) => (typeof ago === "function" ? ago(iso) : "");
  function facts() {
    if (typeof data === "undefined" || !data || (typeof view !== "undefined" && view) || !cl.master) return null;
    const la = data.__loadedAt, mn = Math.floor(Date.now() / 60000), rl = rooms.length;
    if (F && F.la === la && F.cr === cityRev && F.rev === cl.rev && F.rl === rl && F.mn === mn) return F;
    const on = (id) => cl.on(id) && (!NEEDS_PART[id] || modOn(NEEDS_PART[id]));
    const c = city, pl = findPlaces(), f = { docks: null, barge: null, library: null, tubes: null, crane: null, balloons: null, blimp: null };
    // 8 docks: crates for what waits, a truck while something posts (and for a while after the count drops: one went out)
    if (on("docks") && c?.uploads && pl.dock) {
      const total = c.uploads.waiting + c.uploads.posting, prev = F?.docks?.total ?? total;
      f.docks = { box: pl.dock, waiting: c.uploads.waiting, posting: c.uploads.posting, live: c.live?.recording || 0, total, sentAt: total < prev ? Date.now() : F?.docks?.sentAt || 0,
        label: c.uploads.waiting + c.uploads.posting + (c.live?.recording || 0) ? `📦 Shipping docks · ${c.uploads.posting} posting · ${c.uploads.waiting} waiting${c.live?.recording ? ` · ${c.live.recording} live recording${c.live.recording > 1 ? "s" : ""}` : ""}` : "📦 Shipping docks · nothing going out" };
    }
    // 9 barge: the biggest batch decides how full it is
    if (on("barge") && c?.batches.length) {
      const run = bargeRun(), b = [...c.batches].sort((x, y) => y.of - x.of)[0];
      if (run) f.barge = { run, step: b.step, of: b.of, frac: Math.max(0, Math.min(1, b.step / b.of)), label: `🚢 Cargo barge · step ${b.step} of ${b.of}${c.batches.length > 1 ? ` (+${c.batches.length - 1} more)` : ""}` };
    }
    // 10 library: books for the work finished this week; the lamp is the last backup
    if (on("library") && pl.lib) {
      const wk = Object.values(data.roomStats || {}).reduce((a, s) => a + (s.weekDone || 0), 0), bk = c?.backup;
      const state = !c ? "unknown" : !bk ? "none" : bk.ok ? "ok" : "failed";
      const note = state === "ok" ? `backup ok ${ag(bk.at)}` : state === "failed" ? `⚠ BACKUP FAILED ${ag(bk.at)}` : state === "none" ? "no backup yet" : "";
      f.library = { box: pl.lib, books: Math.min(24, wk), week: wk, state, label: `📚 Library archive · ${wk} finished this week${note ? " · " + note : ""}` };
    }
    // 11 tubes: a capsule a thing waiting on the owner, from the building it came from, down a tube to the CEO tower
    if (on("tubes")) {
      const tower = rooms.find((r) => r.isControl), items = typeof waitingItems === "function" ? waitingItems() : [];
      if (tower) {
        const per = new Map();
        for (const q of items) if (q.room && q.room !== tower.id) per.set(q.room, (per.get(q.room) || 0) + 1);
        const held = c?.held || 0;
        if (held) { const host = (window.campusBlocks?.list?.() || []).filter((b) => b.page === "pipeline").flatMap((b) => b.rooms || [])[0]; if (host) per.set(host, (per.get(host) || 0) + held); }
        const lat = tower.face === "e" || tower.face === "w" ? [0, 1] : [1, 0], dd = doorOf(tower, 0.45), pile = [dd[0] + lat[0] * 1.5, dd[1] + lat[1] * 1.5];
        const total = items.length + held, list = [];
        for (const [id, n] of per) { const r = rooms.find((x) => x.id === id || x.members?.some((m) => m.id === id)); if (r && !r.isHouse && !r.isHomes) list.push({ id: r.id, n: Math.min(3, n), ...tubeRoute(r, pile) }); }
        if (total > 0) f.tubes = { routes: list.slice(0, 8), pile, total, label: `📨 ${total} waiting for you` };
      }
    }
    // 12 crane: a project's building with a fresh pull request review
    if (on("crane") && c?.prRooms.length) {
      const list = [];
      for (const [id, n] of c.prRooms) { const r = rooms.find((x) => x.id === id) || rooms.find((x) => x.members?.some((m) => m.id === id)); if (r && !r.isHouse && !r.isHomes && !list.some((l) => l.id === r.id)) list.push({ id: r.id, n }); }
      if (list.length) f.crane = list.slice(0, 3).map((l) => ({ ...l, label: `🏗 ${l.n} pull request${l.n > 1 ? "s" : ""} under review` }));
    }
    // 13 balloons: spend and alerts, in words and a symbol as well as colour
    if (on("balloons") && c) f.balloons = {
      spend: c.forecast === "over" ? { text: "▲ OVER its cap", lvl: "over" } : c.forecast === "near" ? { text: "● NEAR its cap", lvl: "near" } : c.forecast === "ok" ? { text: "✓ on track", lvl: "ok" } : { text: "no forecast", lvl: "none" },
      alerts: c.alerts ? (c.alerts.open ? { text: `${c.alerts.open} alert${c.alerts.open > 1 ? "s" : ""} in 24 h`, lvl: "near" } : { text: "no alerts", lvl: "ok" }) : { text: "alerts: no data", lvl: "none" },
    };
    // 14 blimp: the newest updates
    if (on("blimp") && c?.changelog.length) f.blimp = { titles: c.changelog };
    const sig = JSON.stringify(f, (k, v) => (k === "sentAt" ? undefined : v));
    if (F && F.sig === sig) { Object.assign(F, { la, cr: cityRev, rev: cl.rev, rl, mn }); if (f.docks && F.docks) F.docks.sentAt = f.docks.sentAt; return F; }
    f.sig = sig; Object.assign(f, { la, cr: cityRev, rev: cl.rev, rl, mn });
    F = f;
    return F;
  }

  // ---------- 15 Weather routines: real weather (ambience.js: weather.live is true only once Open-Meteo has answered) ----------
  const WX = { rain: false, snow: false, heavy: false, bad: false }; // reused: asked every frame
  function wx() {
    const k = cl.on("weather") && typeof weather !== "undefined" && weather?.live ? weather.kind : "";
    WX.rain = k === "rain"; WX.snow = k === "snow"; WX.bad = WX.rain || WX.snow; WX.heavy = WX.bad && !!weather.heavy;
    return WX;
  }
  // how many of a building's idle workers walk about: two normally, one in snow, none when it is heavy
  const walkerCap = () => { const w = wx(); return w.heavy ? 0 : w.snow ? 1 : 2; };
  // The pet: indoors (in its office) while it rains or snows. Only its nap spot moves: nothing else about it.
  const petIndoors = () => wx().bad && typeof hasPet === "function" && hasPet();
  const umbrellaFor = (w) => wx().rain && !(w.sit && Math.hypot(w.tx - w.x, w.ty - w.y) <= 0.05);
  const BRELLA = ["#d94a4a", "#3f7fd8", "#e8b83a", "#46a86e", "#9a5fd0", "#f08a3c"];
  const brellaHue = (id) => { let h = 5; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % BRELLA.length; };
  function weatherNote() {
    const w = wx(); if (!w.bad) return "";
    const pet = typeof hasPet === "function" && hasPet() && typeof PET === "function" ? ` · ${PET()} naps indoors` : "";
    return w.rain ? (w.heavy ? "☂ Heavy rain: everyone stays in" : "☂ Rain: umbrellas up") + pet : (w.heavy ? "❄ Heavy snow: everyone stays in" : "❄ Snow: fewer out and about") + pet;
  }

  // ---------- 2D drawing ----------
  const tagAt = (px, py, text, fill) => {
    ctx.font = `700 ${Math.max(8, 9.5 * Math.min(1.4, cam.z))}px system-ui`; ctx.textAlign = "center";
    const tw = ctx.measureText(text).width + 10;
    ctx.fillStyle = fill; roundRect(px - tw / 2, py - 11, tw, 15, 5); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillText(text, px, py);
  };
  // a box in the isometric view: its south face, east face and top
  function cube(x, y, z, w, d, h, top, south, east) {
    poly([toScreen(x, y + d, z), toScreen(x + w, y + d, z), toScreen(x + w, y + d, z + h), toScreen(x, y + d, z + h)], south);
    poly([toScreen(x + w, y, z), toScreen(x + w, y + d, z), toScreen(x + w, y + d, z + h), toScreen(x + w, y, z + h)], east);
    poly([toScreen(x, y, z + h), toScreen(x + w, y, z + h), toScreen(x + w, y + d, z + h), toScreen(x, y + d, z + h)], top);
  }
  const along = (p, u, out = [0, 0]) => { // the point u tiles along a path (into `out`: the 3D frame loop asks every frame)
    let i = 1; while (i < p.length - 1 && u > Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])) { u -= Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); i++; }
    const a = p[i - 1], b = p[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, k = Math.max(0, Math.min(1, u / L));
    out[0] = a[0] + (b[0] - a[0]) * k; out[1] = a[1] + (b[1] - a[1]) * k;
    return out;
  };
  function draw2dTubes(t) {
    const f = facts()?.tubes; if (!f) return;
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const r of f.routes) {
      const pts = r.path.map((p) => toScreen(p[0], p[1], 0.3));
      ctx.strokeStyle = "rgba(60,70,90,0.55)"; ctx.lineWidth = Math.max(3, 5.5 * cam.z); ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      ctx.strokeStyle = "rgba(205,215,230,0.9)"; ctx.lineWidth = Math.max(1.6, 3 * cam.z); ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      for (let i = 0; i < r.n; i++) { // capsules, spaced along the tube, moving to the tower
        const [x, y] = along(r.path, ((t / 1000) * 2.2 + (i * r.len) / r.n) % r.len), [sx, sy] = toScreen(x, y, 0.3);
        ctx.fillStyle = "#ffcf5a"; ctx.strokeStyle = "#7a5a10"; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(sx, sy, 5 * cam.z + 1, 3 * cam.z + 1, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();
  }
  function drawPile2d(f, t) { // the capsules waiting by the CEO tower, and the words
    const n = Math.min(12, f.total), [px, py] = toScreen(f.pile[0], f.pile[1], 0), s = cam.z;
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(px, py, 11 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#8a6d3b"; roundRect(px - 9 * s, py - 6 * s, 18 * s, 7 * s, 2 * s); ctx.fill(); // the bin
    for (let i = 0; i < n; i++) { const cx = px - 7 * s + (i % 4) * 4.6 * s, cy = py - 8 * s - Math.floor(i / 4) * 3.4 * s; ctx.fillStyle = "#ffcf5a"; ctx.strokeStyle = "#7a5a10"; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.ellipse(cx, cy, 3.4 * s, 2.1 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    if (cam.z > 0.45) tagAt(px, py - 24 * s, f.label, "rgba(70,60,20,0.92)");
  }
  function drawLibrary2d(f, t) {
    const { x, y, w, d } = f.box, H = 1.5, s = cam.z;
    cube(x, y, 0, w, d, H, dn("#b08a62", "#4d4130"), dn("#d9c29a", "#6b5a42"), dn("#bba27a", "#554733"));
    // the front: shelves of books, filled by the work finished this week (24 places: 3 shelves of 8)
    for (let row = 0; row < 3; row++) for (let i = 0; i < 8; i++) {
      const k = row * 8 + i, bx = x + 0.2 + (i * (w - 0.4)) / 8, bz = 0.25 + row * 0.38;
      poly([toScreen(bx, y + d, bz), toScreen(bx + (w - 0.4) / 8 - 0.04, y + d, bz), toScreen(bx + (w - 0.4) / 8 - 0.04, y + d, bz + 0.3), toScreen(bx, y + d, bz + 0.3)], k < f.books ? hn((k * 47 + 10) % 360, 45, 45, 35, 28) : "rgba(0,0,0,0.28)");
    }
    // the lamp on the roof: its colour says the backup, the label says it in words, and a failed one also gets a "!" shape
    const [lx, ly] = toScreen(x + w - 0.3, y + 0.3, H + 0.25), col = f.state === "ok" ? "#4fd08a" : f.state === "failed" ? "#ff4a3d" : "#e8b83a";
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(lx, ly, 4.5 * s + 1, 0, Math.PI * 2); ctx.fill();
    if (f.state === "failed") { ctx.fillStyle = "#fff"; ctx.font = `800 ${Math.max(7, 8 * s)}px system-ui`; ctx.textAlign = "center"; ctx.fillText("!", lx, ly + 3 * s); }
    if (cam.z > 0.4) { const [px, py] = toScreen(x + w / 2, y + d, H + 0.9); tagAt(px, py, f.label, f.state === "failed" ? "rgba(160,40,40,0.92)" : "rgba(60,50,30,0.92)"); }
  }
  function drawDocks2d(f, t) {
    const { x, y, w, d } = f.box, s = cam.z;
    cube(x, y, 0, w, d, 0.12, dn("#b7ad98", "#4a463c"), dn("#a39a86", "#403c33"), dn("#8f8673", "#383530"));
    const n = Math.min(8, f.waiting + f.posting);
    for (let i = 0; i < n; i++) { // crates, two high
      const cx = x + 0.35 + (i % 4) * 0.62, cz = i < 4 ? 0.12 : 0.12 + 0.46;
      cube(cx, y + 0.3 + (i >= 4 ? 0.02 : 0), cz, 0.5, 0.5, 0.46, "#d9a85a", "#b88740", "#9a6f30");
    }
    // the truck: leaves along the bank while something posts, and once more when a count drops
    const go = f.posting > 0 || Date.now() - f.sentAt < 12000;
    if (go) {
      const u = ((t / 1000) % 12) / 12, tx = x + w - 1.5 + Math.max(0, u - 0.25) * 24, ty = y + 0.4; // waits at the dock for a quarter of the cycle, then drives off east
      if (u < 0.85) { cube(tx, ty, 0.12, 0.9, 0.6, 0.5, "#e8e4da", "#f4f1ea", "#cfcabf"); cube(tx + 0.9, ty + 0.05, 0.12, 0.4, 0.5, 0.36, "#4f86c8", "#6a9ad6", "#3d6ca6"); }
    }
    if (cam.z > 0.4) { const [px, py] = toScreen(x + w / 2, y + d, 1.2); tagAt(px, py, f.label, "rgba(60,50,30,0.92)"); }
  }
  function draw2dBrella(px, py, s, w) {
    const c = BRELLA[brellaHue(w.d.id)];
    ctx.strokeStyle = "#555"; ctx.lineWidth = Math.max(1, 1.2 * s); ctx.beginPath(); ctx.moveTo(px, py + 6 * s); ctx.lineTo(px, py - 4 * s); ctx.stroke();
    ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(px - 10 * s, py - 4 * s); ctx.quadraticCurveTo(px, py - 15 * s, px + 10 * s, py - 4 * s); ctx.quadraticCurveTo(px + 5 * s, py - 6.5 * s, px, py - 4 * s); ctx.quadraticCurveTo(px - 5 * s, py - 6.5 * s, px - 10 * s, py - 4 * s); ctx.fill();
  }
  let movers2d = null;
  // Depth-sorted pieces (motion.js frame puts them in with the walkers): the library, the docks and the tower's capsule pile
  function movers(t) {
    const f = facts();
    if (!f || (!f.library && !f.docks && !f.tubes)) return [];
    if (!movers2d) movers2d = { lib: { f: () => F?.library && drawLibrary2d(F.library, performance.now()) }, dock: { f: () => F?.docks && drawDocks2d(F.docks, performance.now()) }, pile: { f: () => F?.tubes && drawPile2d(F.tubes, performance.now()) } };
    const out = [];
    if (f.library) { const b = f.library.box; movers2d.lib.x = b.x; movers2d.lib.y = b.y; movers2d.lib.ex = b.w; movers2d.lib.ey = b.d; out.push(movers2d.lib); }
    if (f.docks) { const b = f.docks.box; movers2d.dock.x = b.x; movers2d.dock.y = b.y; movers2d.dock.ex = b.w + 6; movers2d.dock.ey = b.d; out.push(movers2d.dock); }
    if (f.tubes) { movers2d.pile.x = f.tubes.pile[0] - 0.4; movers2d.pile.y = f.tubes.pile[1] - 0.2; movers2d.pile.ex = 0.8; movers2d.pile.ey = 0.4; out.push(movers2d.pile); }
    return out;
  }
  // The weather routines' one line, in words (not only umbrellas): a small pill above the bottom bar, in both views
  let noteEl = null, noteText = null;
  function showNote() {
    const text = typeof view !== "undefined" && view ? "" : weatherNote();
    if (text === noteText) return;
    noteText = text;
    if (!noteEl) {
      noteEl = document.createElement("div"); noteEl.id = "clWx"; noteEl.setAttribute("role", "status");
      noteEl.style.cssText = "position:fixed;left:50%;bottom:112px;transform:translateX(-50%);z-index:30;max-width:calc(100vw - 24px);padding:5px 11px;border-radius:12px;background:rgba(30,50,90,.93);color:#fff;font:600 12px/1.3 system-ui,sans-serif;text-align:center;pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,.3)";
      document.body.appendChild(noteEl);
    }
    noteEl.textContent = text; noteEl.style.display = text ? "" : "none";
  }
  function draw2dTop() { showNote(); }

  return {
    facts, places: findPlaces, wx, walkerCap, petIndoors, umbrellaFor, brellaHue, weatherNote, along, movers, draw2dTubes, draw2dTop, showNote, draw2dBrella,
    ask: askCity, get city() { return city; }, get cityRev() { return cityRev; },
    // 3D: obstacles the shared places must keep clear of (the diner, trees...), then the places are worked out again
    setAvoid(list) { avoid = list || []; places = null; F = null; },
    BRELLA,
  };
})();
window.cityLife2 = cityLife2;
