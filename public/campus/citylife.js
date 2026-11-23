// Campus: City life (Living City, lane L1: docs/campus-living-city.md). Small touches that show what the hub is doing,
// worked out from data the campus already has (the 20 s /agents poll; the glance only when a prop already fetched it).
// No server change, no polling of its own, nothing per frame except moving what is already drawn.
//   0 the City life menu: a master switch and one switch per effect, kept per device (localStorage, like the 3D heavier look)
//   1 Power grid      2 Roadwork cones     3 Bridge traffic (3D, public/campus/3d/citylife.js)   4 Late-night shift
//   5 Morning commute 6 the pet's sunbeams  7 Breakroom diner (3D)
// This file is shared: it works out the facts once (cityLife.world()) for both views, draws the 2D parts, and the 3D
// module reads the same facts. Part of public/campus.html, loaded in order by campus/boot.js; the files share one
// global scope (classic scripts), so a name defined in one is visible in the others.
"use strict";
const cityLife = (() => {
  const KEY = "campus.citylife";
  // id, icon, name, where it shows, what it does in plain words
  const EFFECTS = [
    { id: "grid", icon: "⚡", name: "Power grid", where: "2D and 3D", about: "Power lines join the buildings. Steady gold = fine. A slow amber pulse = a worker is close to its monthly cap. A fast flicker with a dimmed building (\"low power\") = a worker is over its cap." },
    { id: "cones", icon: "🚧", name: "Roadwork cones", where: "2D and 3D", about: "Cones and a striped barrier by a building's door while something there is stuck: an open blocker, a worker over its cap, or a stuck video. They go when it clears." },
    { id: "vans", icon: "🚐", name: "Bridge traffic", where: "3D only", about: "For ten minutes after one worker hands a job to another, a little van crosses a river bridge, labelled with the AI that receives it (Claude, Gemini...)." },
    { id: "night", icon: "🌙", name: "Late-night shift", where: "2D and 3D", about: "After 6 pm a building where someone is still working keeps its windows lit, with a desk lamp and a pool of light at the door. Quiet buildings go dark." },
    { id: "commute", icon: "🚌", name: "Morning commute", where: "2D and 3D", about: "From 7:30 to 8:00 the day's workers walk in from the bus stop and their homes." },
    { id: "sun", icon: "☀", name: "Sunbeams", where: "2D and 3D", about: "On clear days a soft patch of sunlight follows the pet around. Only shown when the hub has a pet." }, // the pet's own name is put in when the menu is drawn
    { id: "diner", icon: "🍔", name: "Breakroom diner", where: "3D only", about: "A small diner on the square. Workers with nothing on their desk sit at its counter by day." },
  ];
  const ids = EFFECTS.map((e) => e.id);
  let st = { master: true, off: {} };
  try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s && typeof s === "object") st = { master: s.master !== false, off: s.off && typeof s.off === "object" ? s.off : {} }; } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
  let tierSet = null; // 3D: the effects the graphics level allows (quality.js); null = 2D, no limit
  let rev = 0;        // bumps whenever a switch or the graphics level changes
  const changed = () => { rev++; W = null; window.dispatchEvent(new CustomEvent("citylife:change")); };
  const switchedOn = (id) => st.master && !st.off[id];
  const tierOk = (id) => !tierSet || tierSet.has(id);
  const on = (id) => switchedOn(id) && tierOk(id);

  // ---------- the facts, once per poll (and once a minute, for the clock) ----------
  let W = null;
  const plain = (r) => r && !r.isHouse && !r.isHomes && !r.isGarden && !r.isUnderground && !r.isLeisure && !r.isStore;
  const levelOf = (u) => (u >= 1 ? "over" : u >= 0.8 ? "near" : "ok");
  function world() {
    if (typeof data === "undefined" || !data) return null;
    if (typeof view !== "undefined" && view) return null; // inside a building: the city effects rest
    const la = data.__loadedAt, mn = Math.floor(Date.now() / 60000), rl = rooms.length;
    if (W && W.la === la && W.mn === mn && W.rl === rl) return W; // (no string made here: the 2D view asks every frame)
    const use = new Map(), cones = new Map(), shift = new Map(), hand = [], idle = [];
    for (const k of data.desks || []) {
      if (k.status === "retired" || k.status === "planned" || !k.room) continue;
      let u = k.capUsdMonth > 0 ? (k.monthUsd || 0) / k.capUsdMonth : 0;
      if (k.overCap) u = Math.max(u, 1);
      if (u > (use.get(k.room) || 0)) use.set(k.room, u);
    }
    const addCone = (room, why) => { const c = cones.get(room) || { n: 0, why: [] }; c.n++; if (!c.why.includes(why)) c.why.push(why); cones.set(room, c); };
    for (const b of data.blockers || []) if (b.status === "open" && b.room) addCone(b.room, "blocked");
    for (const k of data.desks || []) if (k.overCap && k.status === "active") addCone(k.room, "over its budget cap");
    const gl = window.campusProps?.glance?.(); // only when a prop already fetched it: never a poll of ours
    const stuck = (gl?.pipeline?.items || []).filter((x) => x.state === "stuck").length;
    if (stuck) for (const b of (window.campusBlocks?.list?.() || []).filter((b) => b.page === "pipeline")) for (const room of b.rooms || []) addCone(room, "a video is stuck");
    if (afterHours()) for (const r of rooms) if (plain(r) && r.busy) shift.set(r.id, { n: (r.desks || []).filter((d) => typeof atWork === "function" && atWork(d)).length || 1, floor: Math.max(0, (r.floors || []).findIndex((f) => f.busy)) });
    for (const j of data.jobs || []) {
      if (!j.prevDesk) continue;
      const age = Date.now() - Date.parse(j.at);
      if (!(age >= 0 && age < 10 * 60000)) continue;
      const to = (data.desks || []).find((x) => x.id === j.desk);
      hand.push({ id: j.id, at: Date.parse(j.at), to: j.desk, toName: to ? nameOf(to) : j.desk, provider: to?.provider || "other", step: j.step, of: j.of });
    }
    hand.sort((a, b) => b.at - a.at);
    // the workers with nothing on their desk who aren't out walking: they sit in the diner (3D)
    if (on("diner") && !afterHours()) for (const r of rooms) { if (!r.desks || !plain(r) || r.isControl) continue; for (const d of r.desks) if (typeof walkers !== "undefined" && whereIs(d) === "out" && !walkers.has(d.id)) idle.push(d.id); }
    // the same facts as a moment ago: keep the same object, so the 3D side only rebuilds when something really changed
    const sig = [[...use].map(([k, v]) => k + levelOf(v)), [...cones].map(([k, v]) => k + v.n + v.why[0]), [...shift].map(([k, v]) => k + v.n + v.floor), hand.map((h) => h.id), idle].map((a) => a.sort().join()).join("|") + afterHours();
    if (W && W.sig === sig) { W.la = la; W.mn = mn; W.rl = rl; return W; }
    W = { la, mn, rl, sig, use, cones, shift, hand: hand.slice(0, 5), idle: idle.slice(0, 6), idleN: idle.length };
    return W;
  }
  // "ok" | "near" | "over" for a room, or a tower group (its members' worst)
  function level(r) {
    const w = world(); if (!w || !r) return "ok";
    if (r.members) return r.members.reduce((a, m) => { const l = levelOf(w.use.get(m.id) || 0); return l === "over" || (l === "near" && a !== "over") ? l : a; }, "ok");
    return levelOf(w.use.get(r.id) || 0);
  }
  const roomIdsOf = (r) => (r.members ? r.members.map((m) => m.id) : [r.id]);

  // ---------- power lines: poles at each building's front corner, joined by a tree out of the CEO tower ----------
  let lay = null;
  function layout() {
    const list = rooms.filter((r) => plain(r) && !r.tower);
    if (lay && lay.src === rooms && lay.len === rooms.length) return lay; // (rooms is made again on every poll)
    const sig = list.map((r) => `${r.id}:${r.x},${r.y}`).join("|");
    if (lay?.sig === sig) { lay.src = rooms; lay.len = rooms.length; return lay; }
    const nodes = list.map((r) => ({ room: r, ids: [r.id], px: r.x - 0.32, py: r.y + r.d + 0.32 }));
    const links = [];
    const root = Math.max(0, nodes.findIndex((n) => n.room.isControl)), inTree = new Set([root]);
    while (nodes.length && inTree.size < nodes.length) {
      let best = null;
      for (const i of inTree) for (let j = 0; j < nodes.length; j++) if (!inTree.has(j)) { const dd = Math.hypot(nodes[i].px - nodes[j].px, nodes[i].py - nodes[j].py); if (!best || dd < best[2]) best = [i, j, dd]; }
      inTree.add(best[1]); links.push([best[0], best[1]]);
    }
    lay = { sig, nodes, links, src: rooms, len: rooms.length };
    return lay;
  }
  const worse = (a, b) => (a === "over" || b === "over" ? "over" : a === "near" || b === "near" ? "near" : "ok");

  // ---------- the morning commute ----------
  const commuteWindow = () => { const n = new Date(), m = n.getHours() * 60 + n.getMinutes(); return m >= 450 && m < 480; };
  const arrived = new Set();
  const dayKey = () => new Date().toDateString();
  function busStop() {
    const main = (campus?.roads || []).find((q) => q.kind === "main");
    if (main) return [main.x + main.w - 0.95, main.y + 1.6];
    const sq = typeof squareAt === "function" && squareAt();
    return sq ? [sq[0] + 1.6, sq[1] + 1.4] : null;
  }
  // Who should be walking in right now (not walkers yet): up to two a building, half from the bus stop, half from their own house.
  function commuters() {
    if (!on("commute") || view || !commuteWindow() || !data) return [];
    const out = [], day = dayKey(), stop = busStop();
    for (const r of rooms) {
      if (!r.desks || !plain(r) || r.isControl) continue;
      let n = 0;
      for (const d of r.desks) {
        if (n >= 2 || d.status !== "active" || arrived.has(`${day}|${d.id}`) || walkers.has(d.id) || whereIs(d) !== "home") continue;
        const h = typeof homeOf === "function" && homeOf(d.id), from = h ? doorOf(h, 0.5) : stop;
        if (!from) continue;
        out.push({ d, room: r, from }); n++;
      }
    }
    return out.slice(0, 24);
  }
  // One step of a commuter (a walker with .commute). True when they have arrived (the caller lets them in).
  function stepCommuter(w, dt) {
    const dist = Math.hypot(w.tx - w.x, w.ty - w.y);
    if (dist > 0.05 && !stalled(w, dist, dt)) { const k = Math.min(1, (0.9 * dt) / dist); w.x += (w.tx - w.x) * k; w.y += (w.ty - w.y) * k; return false; }
    if (w.path?.length) { [w.tx, w.ty] = w.path.shift(); return false; }
    arrived.add(`${dayKey()}|${w.d.id}`);
    return true;
  }

  const SUN = { on: false, k: 0, f: 0.5 }; // reused: the 3D frame loop asks every frame
  // ---------- the pet's sunbeams: clear weather, daytime, a pet set, the pet out where the sky can reach him ----------
  function sun() {
    const off = SUN; off.on = false; off.k = 0;
    if (!on("sun") || view || typeof hasPet !== "function" || !hasPet() || rex.x == null) return off;
    if ((weather?.kind || "clear") !== "clear" || night > 0.2) return off;
    if (rex.spot === "office" || rex.spot === "meeting") return off; // indoors: the patch only shows where the sun can reach him
    const { rise, set } = sunTimes(), now = Date.now();
    if (now < rise || now > set) return off;
    const f = (now - rise) / (set - rise);
    off.on = true; off.k = Math.sin(Math.PI * f); off.f = f;
    return off;
  }

  // ---------- 2D drawing (called from motion.js frame) ----------
  const RED = "rgba(255,96,84,", AMB = "rgba(255,170,40,", GOLD = "rgba(255,208,120,";
  function draw2dGround(t) {
    const s = sun(); if (!s.on) return;
    const [px, py] = toScreen(rex.x, rex.y, 0), R = 50 * cam.z * (1 + 0.04 * Math.sin(t / 1800));
    ctx.save(); ctx.translate(px, py); ctx.scale(1, 0.5);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    g.addColorStop(0, `rgba(255,214,90,${0.6 * s.k})`); g.addColorStop(0.7, `rgba(255,220,110,${0.25 * s.k})`); g.addColorStop(1, "rgba(255,220,110,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  function draw2dWires(t) {
    if (!on("grid") || view) return;
    const w = world(); if (!w) return;
    const L = layout(); if (L.links.length < 1) return;
    const lv = L.nodes.map((n) => level(n.room)), H = 1.3;
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = dn("rgba(90,70,50,0.8)", "rgba(40,34,30,0.9)"); ctx.lineWidth = Math.max(1.2, 1.8 * cam.z);
    const used = new Set(); L.links.forEach(([a, b]) => { used.add(a); used.add(b); });
    for (const i of used) { const n = L.nodes[i], [x0, y0] = toScreen(n.px, n.py, 0), [x1, y1] = toScreen(n.px, n.py, H); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
    const flick = Math.sin(t / 60) + Math.sin(t / 23) > 0.2; // fast and ragged: not a colour, a motion
    for (const [a, b] of L.links) {
      const A = L.nodes[a], B = L.nodes[b], state = worse(lv[a], lv[b]);
      const [x0, y0] = toScreen(A.px, A.py, H), [x1, y1] = toScreen(B.px, B.py, H), sag = 5 * cam.z;
      let col, dash = [];
      if (state === "over") { col = `${RED}${flick ? 0.95 : 0.12})`; dash = [5 * cam.z, 4 * cam.z]; }
      else if (state === "near") col = `${AMB}${0.45 + 0.5 * (0.5 + 0.5 * Math.sin(t / 500))})`;
      else col = `${GOLD}${0.5 + 0.3 * night})`;
      ctx.setLineDash(dash);
      if (night > 0.3) { ctx.strokeStyle = col; ctx.lineWidth = Math.max(3, 5 * cam.z); ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + sag, x1, y1); ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.2, 1.7 * cam.z);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + sag, x1, y1); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.restore();
  }
  function tag(px, py, text, fill) {
    ctx.font = `700 ${Math.max(8, 9.5 * Math.min(1.4, cam.z))}px system-ui`; ctx.textAlign = "center";
    const tw = ctx.measureText(text).width + 10;
    ctx.fillStyle = fill; roundRect(px - tw / 2, py - 11, tw, 15, 5); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillText(text, px, py);
  }
  function drawCone2d(px, py, s) {
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(px, py, 5 * s, 2 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f08a1c"; ctx.beginPath(); ctx.moveTo(px - 4 * s, py); ctx.lineTo(px + 4 * s, py); ctx.lineTo(px + 1 * s, py - 12 * s); ctx.lineTo(px - 1 * s, py - 12 * s); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillRect(px - 2.6 * s, py - 7 * s, 5.2 * s, 2.2 * s);
  }
  function draw2dBuilding(r, t) {
    if (view || !plain(r) || r.tower) return;
    const w = world(); if (!w) return;
    const { x, y, w: bw, d, h: top } = r, near = cam.z > 0.55;
    const lvl = on("grid") ? level(r) : "ok";
    if (lvl === "over") {
      poly([toScreen(x, y + d), toScreen(x + bw, y + d), toScreen(x + bw, y + d, top), toScreen(x, y + d, top)], "rgba(6,10,22,0.45)");
      poly([toScreen(x + bw, y), toScreen(x + bw, y + d), toScreen(x + bw, y + d, top), toScreen(x + bw, y, top)], "rgba(6,10,22,0.45)");
      if (near) { const [px, py] = toScreen(x + bw / 2, y + d, 1.4); tag(px, py, "⚡ low power", "rgba(160,40,40,0.92)"); }
    } else if (lvl === "near" && cam.z > 0.8) { const [px, py] = toScreen(x + bw / 2, y + d, 1.4); tag(px, py, "⚡ near its cap", "rgba(170,110,10,0.92)"); }
    if (on("night") && afterHours() && night > 0.4) {
      const sh = w.shift.get(r.id);
      if (!sh) poly([toScreen(x, y + d), toScreen(x + bw, y + d), toScreen(x + bw, y + d, top), toScreen(x, y + d, top)], `rgba(4,8,18,${0.3 * night})`); // quiet: dark
      else {
        const [lx, ly] = toScreen(x + bw * 0.3, y + d + 0.02, sh.floor * FLOOR_H + 0.7), [dx, dy] = toScreen(x + bw / 2, y + d + 0.5, 0), s = cam.z;
        let g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 14 * s); g.addColorStop(0, "rgba(255,214,130,0.85)"); g.addColorStop(1, "rgba(255,214,130,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(lx, ly, 14 * s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffe6a8"; ctx.fillRect(lx - 2 * s, ly - 3 * s, 4 * s, 5 * s); // the desk lamp
        ctx.save(); ctx.translate(dx, dy); ctx.scale(1, 0.5); g = ctx.createRadialGradient(0, 0, 0, 0, 0, 30 * s); g.addColorStop(0, "rgba(255,214,130,0.5)"); g.addColorStop(1, "rgba(255,214,130,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 30 * s, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        if (near) { const [px, py] = toScreen(x + bw / 2, y + d, 2.7); tag(px, py, `🌙 ${sh.n} working after hours`, "rgba(40,50,90,0.9)"); }
      }
    }
    const c = on("cones") && w.cones.get(r.id);
    if (c) {
      const [dx, dy] = doorOf(r, 0.45), s = cam.z * 1.1, n = Math.min(3, c.n), [ux, uy] = r.face === "e" || r.face === "w" ? [0, 1] : [1, 0]; // along the building's front
      for (let i = 0; i < n; i++) { const [px, py] = toScreen(dx - ux * (0.85 + i * 0.38), dy - uy * (0.85 + i * 0.38)); drawCone2d(px, py, s); }
      const [bx, by] = toScreen(dx + ux * 1.1, dy + uy * 1.1), [bx2, by2] = toScreen(dx + ux * 1.8, dy + uy * 1.8); // the barrier: two legs and a striped bar
      ctx.strokeStyle = "#555"; ctx.lineWidth = Math.max(1, 1.4 * s); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by - 8 * s); ctx.moveTo(bx2, by2); ctx.lineTo(bx2, by2 - 8 * s); ctx.stroke();
      const seg = 5; for (let i = 0; i < seg; i++) { const a = i / seg, b = (i + 1) / seg; ctx.strokeStyle = i % 2 ? "#fff" : "#d93a30"; ctx.lineWidth = Math.max(2, 3.2 * s); ctx.beginPath(); ctx.moveTo(bx + (bx2 - bx) * a, by + (by2 - by) * a - 7 * s); ctx.lineTo(bx + (bx2 - bx) * b, by + (by2 - by) * b - 7 * s); ctx.stroke(); }
      if (cam.z > 0.7) { const [px, py] = toScreen(dx + 0.4, dy + 0.1, 0.5); tag(px, py + 14 * cam.z, `🚧 ${c.why[0]}`, "rgba(150,80,10,0.92)"); }
    }
  }

  // ---------- the City life menu ----------
  function panelHtml() {
    const three = !!window.campus3dActive, pet = typeof hasPet === "function" && hasPet();
    const petName = pet && typeof PET === "function" ? esc(PET()) : "";
    const rows = EFFECTS.map((e) => {
      if (e.id === "sun" && petName) e = { ...e, name: `${petName}'s sunbeams`, about: e.about.replace("the pet", petName) };
      if (e.petAbout && petName) e = { ...e, about: e.petAbout.replace(/\{pet\}/g, petName) }; // (the weather routines: the pet naps indoors)
      const note = e.where === "3D only" && !three ? "Shows in the 3D view." : e.id === "sun" && !pet ? "Needs a pet in the hub settings." : e.needs && typeof modOn === "function" && !modOn(e.needs) ? `Needs the ${e.needs === "youtube" ? "YouTube" : e.needs} part, which is switched off.` : three && !tierOk(e.id) ? "Paused: this device's graphics level is too low for it." : "";
      return `<label class="row" style="align-items:flex-start;gap:8px;cursor:pointer"><input type="checkbox" data-cl="${e.id}" ${st.off[e.id] ? "" : "checked"} ${st.master ? "" : "disabled"} style="margin-top:4px;width:18px;height:18px"><span style="flex:1"><b>${e.icon} ${e.name}</b> <span class="sub">${e.where}</span><div class="sub">${e.about}</div>${note ? `<div class="sub" style="color:#c98a1a">${note}</div>` : ""}</span></label>`;
    }).join("");
    return `<div class="sub mt-1">Little touches that show what the hub is doing, from information the campus already has. They cost no AI. The goods-and-records ones (docks to blimp) ask the hub for a few counts once a minute while this page is open. Kept on this device only.</div>
      <label class="row" style="align-items:center;gap:8px;cursor:pointer"><input type="checkbox" data-cl="master" ${st.master ? "checked" : ""} style="width:18px;height:18px"><b>City life on</b><span class="sub">the master switch</span></label>
      <h3 class="mt-4 font-semibold text-sm">Each effect</h3>${rows}`;
  }
  function openPanel() {
    const p = showPanel("citylife", "🏙 City life", panelHtml());
    p.querySelectorAll("[data-cl]").forEach((c) => (c.onchange = () => {
      if (c.dataset.cl === "master") st.master = c.checked; else if (c.checked) delete st.off[c.dataset.cl]; else st.off[c.dataset.cl] = true;
      save(); changed(); openPanel();
    }));
  }
  const btn = document.createElement("button");
  btn.className = "pill"; btn.id = "hCity"; btn.textContent = "🏙 City life";
  btn.title = "Switch the little city effects on or off: power lines, cones, bridge traffic, late shifts, the commute, sunbeams, the diner, shipping docks, the barge, the library, pneumatic tubes, the crane, balloons, the blimp and weather routines";
  btn.onclick = () => openPanel();
  document.getElementById("hWx")?.insertAdjacentElement("afterend", btn);

  return {
    EFFECTS, ids, on, switchedOn, tierOk, world, level, roomIdsOf, layout, worse, commuters, stepCommuter, sun, openPanel, commuteWindow,
    get rev() { return rev; }, get master() { return st.master; },
    // 3D: the effects this graphics level allows (quality.js TIERS[].effects)
    setTier(list) { const next = list ? new Set(list) : null; if (next && tierSet && next.size === tierSet.size && [...next].every((x) => tierSet.has(x))) return; tierSet = next; changed(); },
    draw2dGround, draw2dWires, draw2dBuilding,
  };
})();
window.cityLife = cityLife;
