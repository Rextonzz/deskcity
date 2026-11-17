// Campus: motion, the little map, and input (drag, zoom, tap). Part of public/campus.html, loaded in order by campus/boot.js;
// the files share one global scope (classic scripts), so a name defined in one is visible in the others.
"use strict";
// ---------- motion ----------
// Where a spot is on a floor: the kitchen and the meeting room are reached through their doors off the corridor.
function zoneDoor(room, p) {
  if (!view) return null;
  const pl = plan(room);
  if (p[0] < room.x + SERV && p[1] >= pl.kitchen.y && p[1] <= pl.front) return pl.kitchen.door;
  if (p[0] >= pl.meeting.x && p[0] <= pl.meeting.x + pl.meeting.w && p[1] >= pl.front) return pl.meeting.door;
  return null;
}
// A route from where the bot is to a spot: via its door and along the corridor when either end is behind a door.
function routeTo(b, to) {
  // Pathing pass (2026-11-13): in 3D each floor has a walkable grid built from its real furniture (3d/nav.js), so the
  // route goes round desks and through doorways. The door-and-corridor route below is the 2D fallback.
  const nav = view && window.floorNav?.[b.room?.id];
  if (nav) { const p = nav.path([b.x, b.y], to); if (p?.length) { if (Math.hypot(p.at(-1)[0] - to[0], p.at(-1)[1] - to[1]) < 0.6) p[p.length - 1] = to; b.path = p; [b.tx, b.ty] = p[0]; return; } }
  const room = b.room, from = [b.x, b.y], df = zoneDoor(room, from), dt = zoneDoor(room, to), path = [];
  if ((df || dt) && df !== dt) {
    const cx = view ? plan(room).corrX : to[0];
    path.push(df || [cx, Math.min(from[1], room.y + room.d - FRONT - 0.3)]);
    if (dt) path.push([cx, dt[1]], dt); else path.push([cx, to[1]]);
  }
  path.push(to);
  b.path = path;
  [b.tx, b.ty] = path[0];
}
function step(dt) {
  for (const b of bots.values()) {
    if (!b.room) continue;
    if (b.active || b.d.status === "paused" || b.room.paused) {
      // back to the desk (through the doors if the bot is in another room)
      if (!b.goingHome) { routeTo(b, [b.desk.x, b.desk.y]); b.goingHome = true; }
    } else if ((b.wait -= dt) <= 0) {
      b.goingHome = false;
      // idle: back to the desk, a meeting, a coffee, or a stroll round the open plan
      const roll = Math.random(), pl = view ? plan(b.room) : null;
      const tp = tablePos(b.room);
      let to;
      if (roll < 0.3) to = [b.desk.x, b.desk.y];
      else if (roll < 0.5 && tp) to = [tp.x + (Math.random() - 0.5) * 1.4, tp.y + (Math.random() < 0.5 ? -0.75 : 0.75)];
      else if (roll < 0.62 && pl) to = [pl.kitchen.coffee[0] + 0.4 + Math.random() * 0.4, pl.kitchen.coffee[1] + Math.random() * 0.8];
      // Life inside (the owner 2026-11-09): a quiet call in the phone booth, or a visit to the lead's office when the lead
      // has handed out a job, as well as coffee, the meeting table and strolls.
      else if (roll < 0.7 && pl?.booth) to = [pl.booth.x + 0.4, pl.booth.y + 0.4];
      else if (roll < 0.8 && pl && b.room.lead && b.room.lead !== b.d && (jobsByDesk[b.d.id] || []).length) { const lp = leadPos(b.room); to = [lp.x - 0.6, lp.y + 0.3]; }
      else if (roll < 0.9 && pl?.lounge) to = [pl.lounge.x + 0.6 + Math.random() * (pl.lounge.w - 1.2), pl.lounge.y + pl.lounge.d * (0.55 + Math.random() * 0.3)]; // a break in the lounge wing (2026-11-13)
      else to = [b.room.x + (b.room.coreW || 0) + (b.room.w - (b.room.coreW || 0)) / 2 + (Math.random() - 0.5) * 2, b.room.y + 1.0 + Math.random() * Math.max(0.5, b.room.d - FRONT - 1.4)];
      if (b.d.lead && Math.random() < 0.6) to = [b.desk.x, b.desk.y]; // leads mostly stay in their office
      routeTo(b, to);
      b.wait = 3 + Math.random() * 6;
    }
    const dx = b.tx - b.x, dy = b.ty - b.y, dist = Math.hypot(dx, dy);
    const speed = 0.9 * dt;
    if (dist > 0.01 && !(typeof stalled === "function" && stalled(b, dist, dt))) { const k = Math.min(1, speed / dist); b.x += dx * k; b.y += dy * k; }
    else if (b.path?.length > 1) { b.path.shift(); [b.tx, b.ty] = b.path[0]; }
  }
}

let last = performance.now(), tallest = null;
function frame(t) {
  // The 3D view draws the campus while it's on (and moves the walkers itself); the 2D canvas then rests.
  if (window.campus3dActive) { last = t; requestAnimationFrame(frame); return; }
  const dt = Math.min(0.1, (t - last) / 1000); last = t;
  step(dt);
  if (view) think(dt, t);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  drawStars(t);
  drawGround();
  if (view) {
    // Floors bottom to top, each lifted by its height; then the front columns; then every floor's sign.
    for (const f of rooms) { ZOFF = f.z; drawRoom(f, t); }
    ZOFF = 0; drawFrame(true);
    stepRider(t); drawRider(t);
    signRects = [];
    for (const f of rooms) { ZOFF = f.z; drawSign(f); }
    ZOFF = 0;
  } else {
    const sorted = [...rooms].sort((a, b) => a.x + a.y - (b.x + b.y));
    tallest = rooms.filter((r) => !r.isControl && !r.isLeisure && !r.isStore && !r.isHouse && !r.isHomes && !r.isGarden).sort((a, b) => b.h - a.h || b.desks.length - a.desks.length)[0];
    shuttleU += dt * (inbox.length ? 0.022 : 0.012);
    const [sx, sy] = shuttlePos();
    drawFountain(t); drawClockTower(t);
    stepWalkers(dt, t);
    stepRex(dt, t);
    // Movers (the shuttle and the walkers) are drawn just before the first building they're behind: fully
    // beyond its back edge or its left edge.
    const tr = isFriday() && truckSpot();
    const movers = [...couriers().map((c) => ({ x: c.x, y: c.y, ex: 0.2, ey: 0.2, f: () => drawCourier(c, t) })), ...(tr ? [{ x: tr[0], y: tr[1], ex: 1.0, ey: 0.5, f: () => drawFoodTruck(t) }] : []), ...vans().map((v) => ({ x: v.x, y: v.y, ex: 0.5, ey: 0.3, f: () => drawVan(v, t) })), { x: sx, y: sy, ex: 0.6, ey: 0.3, f: drawShuttle }, ...[...walkers.values()].map((w) => ({ x: w.x, y: w.y, ex: 0.2, ey: 0.2, f: () => drawWalker(w, t) })), ...(rex.x != null ? [{ x: rex.x, y: rex.y, ex: 0.3, ey: 0.3, f: () => drawPet(t) }] : [])];
    const pending = new Set(movers);
    for (const r of sorted) {
      for (const m of pending) if (m.y + m.ey <= r.y || m.x + m.ex <= r.x) { m.f(); pending.delete(m); }
      // the filter chips fade buildings outside the chosen district or project
      const faded = typeof shownByFilter === "function" && campusFilter && !shownByFilter(r);
      if (faded) { ctx.save(); ctx.globalAlpha = 0.22; }
      drawBuilding(r, t);
      if (faded) ctx.restore();
    }
    for (const m of pending) m.f();
    for (const r of sorted) if (!r.isControl && !r.isLeisure && !r.isStore && !r.isHouse && !r.isHomes && !r.isGarden && celebrating(r)) drawConfetti(r, t);
    signRects = [];
    sorted.forEach(drawSign);
    for (const [bx, by, txt] of courierBubbles) thoughtBubble(bx, by, txt, true);
    courierBubbles = [];
  }
  drawWeather(dt, t);
  if (!view) drawMiniMap();
  requestAnimationFrame(frame);
}

// ---------- the little map (the owner, 2026-11-09) ----------
// Bottom-right corner on the campus: every building as a coloured block, the part you're looking at as a frame.
// Tap a spot on it to jump there; tap a building on it to jump there and open it.
let mini = null;
const MINI_COL = (r) => r.isHouse || r.isHomes || r.isGarden ? dn("rgba(120,108,84,0.55)", "rgba(233,228,216,0.5)") : r.isControl ? dn("#5c9be0", "#9cc7ff") : r.isStore ? "#e05d8a" : r.isLeisure ? dn("#e8a23a", "#f0b45a") : hn(r.hue || 200, 52, 60, 45, 55);
function drawMiniMap() {
  if (!rooms.length) return;
  const pts = rooms.flatMap((r) => [iso(r.x, r.y), iso(r.x + r.w, r.y), iso(r.x, r.y + r.d), iso(r.x + r.w, r.y + r.d)]);
  const minA = Math.min(...pts.map((p) => p[0])), maxA = Math.max(...pts.map((p) => p[0])), minB = Math.min(...pts.map((p) => p[1])), maxB = Math.max(...pts.map((p) => p[1]));
  const bw = Math.min(150, W * 0.36), bh = Math.min(110, H * 0.18), pad = 8;
  const k = Math.min((bw - pad * 2) / (maxA - minA || 1), (bh - pad * 2) / (maxB - minB || 1));
  const x0 = W - bw - 10, y0 = H - bh - 10;
  const m = (a, b) => [x0 + pad + (a - minA) * k, y0 + pad + (b - minB) * k];
  mini = { x0, y0, bw, bh, k, minA, minB, pad };
  ctx.save();
  ctx.fillStyle = dn("rgba(255,255,255,0.8)", "rgba(15,18,24,0.78)"); roundRect(x0, y0, bw, bh, 8); ctx.fill();
  ctx.strokeStyle = dn("rgba(60,70,60,0.35)", "rgba(233,228,216,0.25)"); ctx.lineWidth = 1; roundRect(x0, y0, bw, bh, 8); ctx.stroke();
  for (const r of rooms) {
    const c = [iso(r.x, r.y), iso(r.x + r.w, r.y), iso(r.x + r.w, r.y + r.d), iso(r.x, r.y + r.d)].map(([a, b]) => m(a, b));
    ctx.beginPath(); c.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.closePath();
    ctx.fillStyle = MINI_COL(r); ctx.globalAlpha = openRoom === r.id ? 1 : 0.85; ctx.fill(); ctx.globalAlpha = 1;
    if (r.busy && !r.isControl) { const [cx, cy] = m(...iso(r.x + r.w / 2, r.y + r.d / 2)); ctx.fillStyle = dn("#2f9e4a", "#7ddc8a"); ctx.beginPath(); ctx.arc(cx, cy, 2.2, 0, Math.PI * 2); ctx.fill(); }
  }
  // what's on screen now
  const [va, vb] = [cam.x - W / 2 / cam.z, cam.y - H / 2 / cam.z], [vx, vy] = m(va, vb);
  ctx.strokeStyle = dn("#d98a00", "#ffd166"); ctx.lineWidth = 1.5; ctx.strokeRect(Math.max(x0, vx), Math.max(y0, vy), Math.min(bw, (W / cam.z) * k), Math.min(bh, (H / cam.z) * k));
  ctx.restore();
}
// A tap inside the little map: jump there (and open the building under it). True when the tap was on the map.
function miniTap(sx, sy) {
  if (view || !mini || sx < mini.x0 || sy < mini.y0 || sx > mini.x0 + mini.bw || sy > mini.y0 + mini.bh) return false;
  const a = (sx - mini.x0 - mini.pad) / mini.k + mini.minA, b = (sy - mini.y0 - mini.pad) / mini.k + mini.minB;
  cam.x = a; cam.y = b; if (cam.z < 0.7) cam.z = 0.7;
  const [wx, wy] = [b / TH + a / TW, b / TH - a / TW];
  const hit = rooms.find((r) => wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.d);
  if (hit) tap(hit.id);
  return true;
}

// ---------- input: drag, zoom, tap ----------
let hover = null, openRoom = null, drag = null;
const pointers = new Map();
function roomAt(sx, sy) {
  // Top floor first, so a tap goes to the storey you can see.
  for (const r of [...rooms].reverse()) {
    const zs = view ? [r.z] : [0, ...(r.h ? [r.h / 2, r.h] : [])]; // a building can be tapped on its walls or roof
    for (const z of zs) { const [wx, wy] = toWorld(sx, sy, z); if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.d) return r.id; }
  }
  return null;
}
cv.addEventListener("pointerdown", (e) => {
  cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
  drag = { x: e.offsetX, y: e.offsetY, cx: cam.x, cy: cam.y, moved: false, z: cam.z, d: pinchDist() };
  cv.classList.add("dragging");
});
cv.addEventListener("pointermove", (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
  if (drag && pointers.size === 2 && drag.d) { cam.z = clampZ(drag.z * (pinchDist() / drag.d)); drag.moved = true; return; }
  if (drag) {
    const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    cam.x = drag.cx - dx / cam.z; cam.y = drag.cy - dy / cam.z;
  } else hover = roomAt(e.offsetX, e.offsetY);
});
const up = (e) => {
  pointers.delete(e.pointerId);
  if (drag && !drag.moved && pointers.size === 0 && miniTap(e.offsetX, e.offsetY)) { drag = null; cv.classList.remove("dragging"); return; }
  if (drag && !drag.moved && pointers.size === 0) {
    const wk = !view && [...walkers.values()].find((w) => w.screen && Math.hypot(e.offsetX - w.screen[0], e.offsetY - w.screen[1]) < Math.max(14, w.screen[2]));
    // Inside a building, tapping someone at their desk opens their own card (the owner 2026-11-09), not the floor's.
    const now = performance.now();
    const bt = view && !wk && [...bots.values()].filter((b) => b.screen && now - (b.drawnAt || 0) < 500).map((b) => [b, Math.hypot(e.offsetX - b.screen[0], e.offsetY - b.screen[1])]).filter(([b, dd]) => dd < b.screen[2]).sort((a, b) => a[1] - b[1])[0]?.[0];
    if (wk) workerPanel(wk.d);
    else if (bt) workerPanel(bt.d);
    else if (!view && rex.screen && Math.hypot(e.offsetX - rex.screen[0], e.offsetY - rex.screen[1] - 6) < 18) rexPanel();
    else if (!view && clockAt && (() => { const [cx, cy] = toScreen(clockAt[0], clockAt[1], 2); return Math.hypot(e.offsetX - cx, e.offsetY - cy) < 40 * cam.z; })()) clockPanel();
    else if (!view && fountainAt && (() => { const [fx, fy] = toScreen(fountainAt[0], fountainAt[1], 0); return Math.hypot(e.offsetX - fx, (e.offsetY - fy + 20 * cam.z) * 1.6) < 80 * cam.z; })()) fountainPanel();
    else if (isResView(view) && resFlatAt(e.offsetX, e.offsetY)) openHome(resFlatAt(e.offsetX, e.offsetY)); // inside a Residences tower: a tap on a flat opens that home
    else { const id = roomAt(e.offsetX, e.offsetY); id ? tap(id) : closePanel(); }
  }
  if (!pointers.size) { drag = null; cv.classList.remove("dragging"); }
};
cv.addEventListener("pointerup", up);
cv.addEventListener("pointercancel", up);
cv.addEventListener("wheel", (e) => { e.preventDefault(); cam.z = clampZ(cam.z * (e.deltaY < 0 ? 1.1 : 0.9)); }, { passive: false });
function pinchDist() { const p = [...pointers.values()]; return p.length === 2 ? Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) : 0; }
const clampZ = (z) => Math.max(0.3, Math.min(2.2, z));
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") openRoom ? closePanel() : view && setView(null);
  if (e.key === "0") fit();
});

// Tapping a running project's building goes inside it; a paused one (or a floor inside) opens its panel.
function tap(id) {
  if (id === "control") { if (!view) setView("control"); return controlPanel(); } // go inside your tower
  if (id === "control::pet") return rexPanel();
  if (id === "garden") return gardenPanel(); // the community garden: its plots, in words (city.js)
  if (isResView(id)) { if (view !== id) setView(id); return homesPanel(id); } // a Residences tower: go inside, floor by floor (city.js)
  if (String(id).startsWith("house:")) {
    const hr = homeOf(id); // homes live in the Residences now (city.js)
    // in 3D a house opens up inside (2D lifts the roof where it stands)
    if (window.campus3dActive && !view && hr) { setView(id); return housePanel(hr); }
    if (hr) return housePanel(hr);
    if (view === id) return; // already inside
  }
  const p = projects.find((x) => x.id === id);
  // a project in a district tower: go inside the whole tower (all its floors), with that project's panel open
  const tw = !view && cityTowers.find((t) => t.members.includes(id));
  if (tw && p && !p.paused) { setView(tw.id); panel(id); return; }
  if (!view && p && !p.paused) { setView(id); panel(id); return; }
  panel(id);
}
function setView(id, quiet) {
  view = id; fitted = false; openRoom = null; ZOFF = 0;
  document.getElementById("panel").classList.remove("open");
  try { history.replaceState(null, "", id ? `#${encodeURIComponent(id)}` : location.pathname); } catch {}
  document.getElementById("hBack").style.display = id ? "" : "none";
  if (!quiet) { build(); fit(); hud(); }
}
