// Campus: drawing the offices, desks and bots, plus the board meeting. Part of public/campus.html, loaded in order by campus/boot.js;
// the files share one global scope (classic scripts), so a name defined in one is visible in the others.
"use strict";
// ---------- drawing ----------
function poly(pts, fill, stroke) {
  ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}
// An iso box from (x,y) with size (w,d) and height h, in tiles.
function box(x, y, w, d, h, top, left, right, z = 0) {
  const p = (a, b, c) => toScreen(a, b, c);
  poly([p(x, y + d, z), p(x + w, y + d, z), p(x + w, y + d, z + h), p(x, y + d, z + h)], left);
  poly([p(x + w, y, z), p(x + w, y + d, z), p(x + w, y + d, z + h), p(x + w, y, z + h)], right);
  poly([p(x, y, z + h), p(x + w, y, z + h), p(x + w, y + d, z + h), p(x, y + d, z + h)], top);
}
const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
// Day/night colour blending (2D look refresh): dn(dayColour, nightColour) lerps by the global `night` (0 day .. 1 night).
// Colours are "#rgb"/"#rrggbb" or "rgba(r,g,b,a)". The night value is always what the 2D view looked like before.
const _cc = new Map();
function _parseColour(c) {
  let v = _cc.get(c); if (v) return v;
  if (c[0] === "#") { let h = c.slice(1); if (h.length === 3) h = h.replace(/./g, "$&$&"); v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1]; }
  else { const m = c.match(/[\d.]+/g).map(Number); v = [m[0], m[1], m[2], m[3] ?? 1]; }
  _cc.set(c, v); return v;
}
function dn(day, nite) {
  const a = _parseColour(day), b = _parseColour(nite), n = night, m = (i) => a[i] + (b[i] - a[i]) * n;
  return `rgba(${Math.round(m(0))},${Math.round(m(1))},${Math.round(m(2))},${+m(3).toFixed(3)})`;
}
// hsl blended day->night: hn(hue, satDay, litDay, satNight, litNight, alpha)
const hn = (h, sd, ld, sn, ln, a = 1) => hsl(h, Math.round(sd + (sn - sd) * night), Math.round(ld + (ln - ld) * night), a);
// Text with a soft white halo by day (readable on the light ground); plain at night. Uses the current font and align.
function haloText(s, x, y, fill) {
  if (night < 0.9) { ctx.save(); ctx.lineJoin = "round"; ctx.lineWidth = 3 * (1 - night); ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.strokeText(s, x, y); ctx.restore(); }
  ctx.fillStyle = fill; ctx.fillText(s, x, y);
}

function drawGround() {
  if (!rooms.length) return;
  if (view) return drawFrame(false);
  if (campus.plan === "quad") drawGroundQuad();
  else if (campus.roads) drawGroundBC();
}
// A word on the ground (never colour alone): halo by day, plain at night.
function groundWord(text, x, y, size, fill) {
  if (cam.z <= 0.3) return;
  const [lx, ly] = toScreen(x, y, 0);
  ctx.font = `700 ${Math.max(9, size * cam.z)}px system-ui`; ctx.textAlign = "center";
  haloText(text, lx, ly, fill);
}
// The quad layout on the 2D map (2026-11-16, plan B): grass, the ring road (the tram loop), the river behind the homes,
// the paved quad with its lawn, the covered concourse (a paved walk with a double edge, posts and a roof line) round
// the quad, along the north range and on down to the Residences, the wings' names, skybridges, and trees.
function drawGroundQuad() {
  const R = campus.river, Q = campus.quad, rg = campus.ring;
  const x0 = Math.min(rg.x0, R.x0 + 7) - 3, x1 = Math.max(rg.x1, R.x1 - 7) + 3, y0 = rg.y0 - 3, y1 = R.y + R.d + 3;
  rect(x0, y0, x1 - x0, y1 - y0, dn("#8fbf78", "#263027")); // grass
  const C = { ring: [dn("#c9c2b0", "#3a4352"), dn("#8a8f99", "#2f3744")], quad: [dn("#cfc4a8", "#4f4a42"), dn("#e3dac4", "#4a463f")], concourse: [dn("#b9ad8e", "#3e3a33"), dn("#efe7d4", "#5a564c")] };
  const order = { ring: 0, quad: 1, concourse: 2 };
  for (const q of [...campus.roads].filter((r) => C[r.kind]).sort((a, b) => order[a.kind] - order[b.kind])) {
    const [edge, top] = C[q.kind];
    rect(q.x - 0.12, q.y - 0.12, q.w + 0.24, q.d + 0.24, edge); rect(q.x + 0.12, q.y + 0.12, Math.max(0.1, q.w - 0.24), Math.max(0.1, q.d - 0.24), top);
  }
  // the ring road's centre line (dashes) and the tram's rails
  for (const q of campus.roads.filter((r) => r.kind === "ring")) { const along = q.w > q.d; for (const off of [-0.35, 0.35]) along ? rect(q.x, q.y + q.d / 2 + off - 0.03, q.w, 0.06, dn("rgba(90,90,96,0.6)", "rgba(200,200,210,0.35)")) : rect(q.x + q.w / 2 + off - 0.03, q.y, 0.06, q.d, dn("rgba(90,90,96,0.6)", "rgba(200,200,210,0.35)")); }
  // the quad's lawn in the middle
  const Lw = campus.lawn; if (Lw && Lw.d > 0.5) rect(Lw.x, Lw.y, Lw.w, Lw.d, dn("#9cc982", "#2e4a33"));
  // wings: a soft block under each district's buildings, and its name on the side the 2D camera sees (the west wing's concourse, the east wing's outer side)
  for (const dst of campus.districts || []) {
    rect(dst.x0, dst.y0, dst.x1 - dst.x0, dst.y1 - dst.y0, dn("rgba(0,0,0,0.05)", "rgba(255,255,255,0.05)"));
    groundWord(`${dst.name.toUpperCase()} WING`, dst.side === "W" ? dst.x1 + 0.9 : dst.x1 + 1.1, (dst.y0 + dst.y1) / 2, 12, dn("#4a4232", "#e2dccb")); // (the sides the 2D camera sees)
  }
  // the concourse: posts along both edges and the roof's edge line, so it reads as a covered walk
  for (const c of campus.concourse || []) {
    const along = c.w >= c.d, len = along ? c.w : c.d, edges = along ? [[c.y + 0.12], [c.y + c.d - 0.12]] : [[c.x + 0.12], [c.x + c.w - 0.12]];
    for (const [e] of edges) {
      const p = (t) => (along ? [c.x + t, e] : [e, c.y + t]);
      const [ax, ay] = toScreen(...p(0), 1.05), [bx, by] = toScreen(...p(len), 1.05);
      ctx.strokeStyle = dn("rgba(120,104,80,0.75)", "rgba(220,206,180,0.5)"); ctx.lineWidth = Math.max(1, 1.6 * cam.z); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      if (cam.z > 0.45) for (let t = 0.4; t < len - 0.2; t += 2.2) { const [qx, qy] = toScreen(...p(t), 0), [rx, ry] = toScreen(...p(t), 1.05); ctx.lineWidth = Math.max(1, 1.2 * cam.z); ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(rx, ry); ctx.stroke(); }
    }
  }
  // skybridges between a wing's rows (30-odd projects): a short raised walk with its word
  for (const b of campus.skybridges || []) { box(b.x, b.y, b.w, b.d, 0.35, dn("#e6dfcc", "#5a564c"), dn("#c9bfa6", "#4a463f"), dn("#d6cdb6", "#524e46"), 1.4); if (cam.z > 0.7) groundWord("skybridge", b.x + b.w / 2, b.y + b.d + 0.5, 9, dn("#4a4232", "#e2dccb")); }
  // the river behind the homes (scenery: no bridges), with glints drifting east
  rect(R.x0, R.y - 0.25, R.x1 - R.x0, R.d + 0.5, dn("#c9c2b0", "#6d6656"));
  rect(R.x0, R.y, R.x1 - R.x0, R.d, dn("#9fcbe4", "#1f4f66"));
  { const now = performance.now() / 1000; ctx.save(); ctx.strokeStyle = dn("rgba(255,255,255,0.6)", "rgba(170,220,240,0.35)"); ctx.lineWidth = Math.max(1, 1.4 * cam.z);
    for (let k = 0; k < 28; k++) { const span = R.x1 - R.x0, x = R.x0 + ((k * 7.3 + now * 0.6) % span), y = R.y + 0.5 + ((k * 1.7) % (R.d - 1)); const [a, b] = toScreen(x, y), [c, d] = toScreen(Math.min(R.x1, x + 0.9), y); ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); }
    ctx.restore(); }
  // the words: the quad, the walks, the ring road, the river
  const mid = (Q.x0 + Q.x1) / 2, north = campus.concourse.find((c) => c.part === "north");
  if (Lw && Lw.d > 1.5) groundWord("THE QUAD", Lw.x + Lw.w / 2, Lw.y + Lw.d / 2, 13, dn("#2f5a2a", "#b7d39c"));
  if (north) groundWord("covered concourse", mid, north.y + north.d / 2 + 0.2, 10, dn("#5a4a30", "#e9e0cc"));
  if (campus.walk && campus.homesBox) groundWord("covered walk", campus.walk.x + campus.walk.w / 2 + 2.4, campus.walk.y + campus.walk.d / 2, 9, dn("#5a4a30", "#e9e0cc"));
  groundWord("RING ROAD · TRAM LOOP", (rg.x0 + rg.x1) / 2, rg.y1 - rg.street / 2 + 0.2, 10, dn("#3a3e48", "#d8dce6"));
  groundWord("RIVER", (R.x0 + R.x1) / 2, R.y + R.d / 2 + 0.2, 11, dn("#1f4f66", "#bfe6f4"));
  // lamps along the concourse's quad side; trees east of the garden walk and round the outside
  for (const c of (campus.concourse || []).filter((c) => ["west", "east"].includes(c.part))) for (let y = c.y + 1.5; y < c.y + c.d - 0.5; y += 4) lamp(c.part === "west" ? c.x + c.w + 0.15 : c.x - 0.15, y);
  const Z = campus.gardenZone, W = campus.walk;
  if (Z && W && !campus.sharedBox) for (let x = W.x + W.w + 1.2; x < Z.x + Z.w - 0.6; x += 2.2) for (const y of [Z.y + 1.2, Z.y + Z.d - 1.0]) tree(x, y);
  fountainAt = [campus.square.x, campus.square.y];
  // the fountain's paved round
  const q = campus.square, pts = [];
  for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; pts.push(toScreen(q.x + Math.cos(a) * q.r, q.y + Math.sin(a) * q.r)); }
  poly(pts, dn("#d9cfb6", "#5a554b"), dn("rgba(160,150,125,0.5)", "rgba(255,255,255,0.1)"));
}
// Plan B+C on the 2D map: the work side's streets, main street with its median, the plaza, the river with moving
// glints and three bridges, the village loop round its green, and the riverside path. Same rectangles as the 3D view.
function rect(x, y, w, d, fill, stroke) { poly([toScreen(x, y), toScreen(x + w, y), toScreen(x + w, y + d), toScreen(x, y + d)], fill, stroke); }
function drawGroundBC() {
  const R = campus.river, V = campus.village, xs = rooms.flatMap((r) => [r.x, r.x + r.w]), ys = rooms.flatMap((r) => [r.y, r.y + r.d]);
  const x0 = Math.min(-STREET, ...xs) - 3, x1 = Math.max(campus.w + STREET, ...xs) + 3, y0 = -STREET - 2, y1 = Math.max(...ys) + 3;
  rect(x0, y0, x1 - x0, y1 - y0, dn("#8fbf78", "#263027")); // grass
  const C = {
    street: [dn("#c9c2b0", "#3a4352"), dn("#8a8f99", "#2f3744")], main: [dn("#c9c2b0", "#4a5262"), dn("#8a8f99", "#363e4c")], "plaza-row": [dn("#c9c2b0", "#4f4a42"), dn("#d9cfb6", "#46423b")],
    lane: [dn("#b9ad8e", "#4b4638"), dn("#d4c8a6", "#57513f")], path: [dn("#c2b898", "#4a463c"), dn("#d9cfb6", "#544f43")],
  };
  const order = { lane: 0, path: 0, street: 1, main: 2, "plaza-row": 3 };
  for (const q of [...campus.roads].sort((a, b) => order[a.kind] - order[b.kind])) {
    const [edge, top] = C[q.kind] || C.street;
    rect(q.x - 0.12, q.y - 0.12, q.w + 0.24, q.d + 0.24, edge); rect(q.x + 0.15, q.y + 0.15, Math.max(0.1, q.w - 0.3), Math.max(0.1, q.d - 0.3), top);
    if (q.kind === "main") { rect(q.x + q.w / 2 - 0.35, q.y + 0.5, 0.7, q.d - 1, dn("#7fae6a", "#2f4a35")); }
  }
  for (const dst of campus.districts || []) {
    const DCOL = { Creative: dn("rgba(224,138,90,0.13)", "rgba(224,138,90,0.10)"), Games: dn("rgba(90,140,230,0.12)", "rgba(110,168,255,0.10)"), Tools: dn("rgba(90,170,90,0.12)", "rgba(143,209,139,0.10)") };
    const DTXT = { Creative: dn("#a8481f", "#e8a37c"), Games: dn("#2b58b0", "#8fb8ff"), Tools: dn("#2f7a35", "#9fd89b") };
    rect(dst.x0, dst.y0, dst.x1 - dst.x0, dst.y1 - dst.y0, DCOL[dst.name] || dn("rgba(0,0,0,0.04)", "rgba(255,255,255,0.06)"));
    if (cam.z > 0.3) { const [lx, ly] = toScreen((dst.x0 + dst.x1) / 2, dst.y1 + 0.6, 0); ctx.font = `700 ${Math.max(9, 12 * cam.z)}px system-ui`; ctx.textAlign = "center"; const dl = `${dst.name.toUpperCase()} DISTRICT`; ctx.lineJoin = "round"; ctx.lineWidth = 3 * (1 - night); ctx.strokeStyle = "rgba(255,255,255,0.75)"; if (night < 0.9) ctx.strokeText(dl, lx, ly); ctx.fillStyle = DTXT[dst.name] || dn("#5a5444", "#cfc9bb"); ctx.fillText(dl, lx, ly); }
  }
  const q = campus.square, pts = [];
  for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; pts.push(toScreen(q.x + Math.cos(a) * q.r, q.y + Math.sin(a) * q.r)); }
  poly(pts, dn("#d9cfb6", "#5a554b"), dn("rgba(160,150,125,0.5)", "rgba(255,255,255,0.1)"));
  // the river: banks, water, and glints drifting east
  if (R) {
    rect(R.x0, R.y - 0.25, R.x1 - R.x0, R.d + 0.5, dn("#c9c2b0", "#6d6656"));
    rect(R.x0, R.y, R.x1 - R.x0, R.d, dn("#9fcbe4", "#1f4f66"));
    const now = performance.now() / 1000;
    ctx.save(); ctx.strokeStyle = dn("rgba(255,255,255,0.6)", "rgba(170,220,240,0.35)"); ctx.lineWidth = Math.max(1, 1.4 * cam.z);
    for (let k = 0; k < 28; k++) { const span = R.x1 - R.x0, x = R.x0 + ((k * 7.3 + now * 0.6) % span), y = R.y + 0.5 + ((k * 1.7) % (R.d - 1)); const [a, b] = toScreen(x, y), [c, d] = toScreen(Math.min(R.x1, x + 0.9), y); ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); }
    ctx.restore();
    for (const b of campus.bridges || []) { rect(b.x - b.w / 2, b.y, b.w, b.d, b.w > 4 ? dn("#cfc6b0", "#8c8270") : dn("#bfa27a", "#7a6248"), dn("rgba(120,110,90,0.35)", "rgba(255,255,255,0.18)")); for (const sx of [0, 1]) rect(b.x - b.w / 2 + sx * (b.w - 0.15), b.y, 0.15, b.d, dn("#f1ece0", "#d9d2c2")); }
  }
  if (V) { rect(V.x0, V.y0, V.x1 - V.x0, V.y1 - V.y0, dn("#7fae6a", "#3a5a32")); rect(V.x0 + 0.7, (V.y0 + V.y1) / 2 - 0.25, V.x1 - V.x0 - 1.4, 0.5, dn("#d9cfb6", "#6a6250")); rect((V.x0 + V.x1) / 2 - 0.25, V.y0 + 0.7, 0.5, V.y1 - V.y0 - 1.4, dn("#d9cfb6", "#6a6250"));
    const [gx, gy] = toScreen((V.x0 + V.x1) / 2, (V.y0 + V.y1) / 2); ctx.fillStyle = dn("#9fcbe4", "#3f6b8f"); ctx.beginPath(); ctx.ellipse(gx, gy, 18 * cam.z, 9 * cam.z, 0, 0, Math.PI * 2); ctx.fill();
    if (cam.z > 0.3) { ctx.font = `700 ${Math.max(9, 11 * cam.z)}px system-ui`; ctx.textAlign = "center"; ctx.lineJoin = "round"; ctx.lineWidth = 3 * (1 - night); ctx.strokeStyle = "rgba(255,255,255,0.7)"; if (night < 0.9) ctx.strokeText("VILLAGE GREEN", gx, gy + 24 * cam.z); ctx.fillStyle = dn("#2f5a2a", "#b7d39c"); ctx.fillText("VILLAGE GREEN", gx, gy + 24 * cam.z); } }
  // lamps along main street and at the bridges; trees in the empty plots
  const main = campus.roads.find((r) => r.kind === "main");
  if (main) for (let y = main.y + 2.5; y < main.y + main.d - 1; y += 4.5) { lamp(main.x + 0.2, y); lamp(main.x + main.w - 0.2, y + 2.2); }
  fountainAt = [q.x, q.y];
  const used = new Set(rooms.filter((r) => r.gx != null).map((r) => `${r.gx},${r.gy}`));
  campus.colX.forEach((cx, i) => campus.rowY.forEach((cy, j) => {
    if (used.has(`${i},${j}`) || (j === 0 && (i === 1 || i === 2))) return;
    const w = campus.colW[i], d = campus.rowD[j];
    for (const [fx, fy] of [[0.3, 0.3], [0.7, 0.35], [0.45, 0.7], [0.8, 0.75]]) tree(cx + w * fx, cy + d * fy);
  }));
}
// A district tower in 2D (the owner 2026-11-09): one building, a storey per member project in that project's colour, with
// window rows that glow where someone's working.
function drawTower2d(T, t) {
  const n = T.members.length, H = FLOOR_H;
  for (let k = 0; k < n; k++) {
    const m = T.members[k], h = m.hue ?? 200, z = k * H, lit = m.busy;
    box(T.x, T.y, T.w, T.d, H - 0.12, hn(h, 52, 64, 40, 58), hn(h, 46, 52, 38, 42), hn(h, 48, 58, 38, 50), z);
    box(T.x - 0.05, T.y - 0.05, T.w + 0.1, T.d + 0.1, 0.12, hn(h, 30, 86, 25, 82), hn(h, 26, 72, 20, 66), hn(h, 28, 80, 20, 74), z + H - 0.12);
    for (let i = 0; i < 4; i++) { const wx = T.x + 0.5 + i * ((T.w - 1) / 4); poly([toScreen(wx, T.y + T.d, z + 0.35), toScreen(wx + 0.6, T.y + T.d, z + 0.35), toScreen(wx + 0.6, T.y + T.d, z + 1.0), toScreen(wx, T.y + T.d, z + 1.0)], lit ? "rgba(255,214,140,0.85)" : dn("rgba(70,100,140,0.5)", "rgba(30,40,55,0.55)")); }
    for (let i = 0; i < 4; i++) { const wy = T.y + 0.5 + i * ((T.d - 1) / 4); poly([toScreen(T.x + T.w, wy, z + 0.35), toScreen(T.x + T.w, wy + 0.6, z + 0.35), toScreen(T.x + T.w, wy + 0.6, z + 1.0), toScreen(T.x + T.w, wy, z + 1.0)], lit ? "rgba(255,214,140,0.8)" : dn("rgba(60,90,130,0.5)", "rgba(30,40,55,0.5)")); }
  }
  box(T.x + T.w * 0.3, T.y + T.d * 0.3, T.w * 0.4, T.d * 0.4, 0.4, dn("#e6dfcc", "#cfc7b4"), dn("#bdb5a0", "#a59e8e"), dn("#cfc7b2", "#b8b0a0"), n * H);
}
// The Underground entrance (2D): a dark stairwell under a green canopy, with the yellow U roundel.
function drawUnderground(r) {
  const { x, y, w, d } = r;
  rect(x - 0.15, y - 0.15, w + 0.3, d + 0.3, "#5d6168"); rect(x + 0.15, y + 0.1, w - 0.3, d - 0.2, "#111418");
  for (let k = 0; k < 4; k++) rect(x + 0.2, y + 0.25 + k * 0.3, w - 0.4, 0.12, `hsl(210,6%,${30 - k * 5}%)`);
  box(x, y, w, d, 0.6, "rgba(47,90,60,0.55)", "rgba(47,90,60,0.35)", "rgba(47,90,60,0.45)", 0);
  const [sx, sy] = toScreen(x + w + 0.3, y + 0.2, 1.1), s = Math.max(5, 7 * cam.z);
  ctx.fillStyle = "#f0c24a"; ctx.beginPath(); ctx.arc(sx, sy, s, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#1f2a3a"; ctx.beginPath(); ctx.arc(sx, sy, s * 0.7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#f0c24a"; ctx.font = `900 ${s}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("U", sx, sy + 0.5); ctx.textBaseline = "alphabetic";
  if (cam.z > 0.45) { const [lx, ly] = toScreen(x + w / 2, y + d, 0); ctx.font = `600 ${Math.max(9, 10 * cam.z)}px system-ui`; ctx.fillStyle = "#e9d9a8"; ctx.fillText(`Underground${r.sleepers?.length ? ` · ${r.sleepers.length} paused` : ""}`, lx, ly + 14); }
}
let fountainAt = null, clockAt = null;
// The clock tower (the square's north-east edge): a slim tower with a lit clock face; tap it for the schedules.
function drawClockTower(t) {
  if (!campus.square) { clockAt = null; return; }
  const q = campus.square; clockAt = campus.clock ? [campus.clock.x, campus.clock.y] : [q.x + q.r * 0.62, q.y - q.r * 0.62]; // east of the fountain, off the main axis (city planner pass)
  const [x, y] = clockAt;
  box(x - 0.35, y - 0.35, 0.7, 0.7, 2.6, "#d8ccb0", "#b9ad92", "#a39880");
  box(x - 0.42, y - 0.42, 0.84, 0.84, 0.25, "#8a6a4a", "#6b4a32", "#5c3f2a", 2.6);
  const [fx, fy] = toScreen(x + 0.36, y + 0.05, 2.1), r = 7 * cam.z;
  ctx.fillStyle = night > 0.3 ? "#ffe9b0" : "#f6f1e4"; ctx.beginPath(); ctx.arc(fx, fy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#3a3328"; ctx.lineWidth = Math.max(1, cam.z); const d = new Date(), hA = ((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2, mA = d.getMinutes() / 60 * Math.PI * 2;
  ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx + Math.sin(hA) * r * 0.5, fy - Math.cos(hA) * r * 0.5); ctx.moveTo(fx, fy); ctx.lineTo(fx + Math.sin(mA) * r * 0.8, fy - Math.cos(mA) * r * 0.8); ctx.stroke();
}
// The campus shuttle: loops the outer road; busier (and wearing a badge) when requests are waiting.
let shuttleU = 0;
function shuttlePos() {
  const rg = campus.ring, s = rg ? rg.street / 2 : 0; // the quad layout: the tram loop on the ring road
  const x0 = rg ? rg.x0 + s : -STREET / 2, y0 = rg ? rg.y0 + s : -STREET / 2, x1 = rg ? rg.x1 - s : campus.w + STREET / 2, y1 = rg ? rg.y1 - s : campus.d + STREET / 2;
  const per = 2 * (x1 - x0 + y1 - y0); let u = (shuttleU % 1) * per;
  const L1 = x1 - x0, L2 = y1 - y0;
  if (u < L1) return [x0 + u, y0]; u -= L1;
  if (u < L2) return [x1, y0 + u]; u -= L2;
  if (u < L1) return [x1 - u, y1]; u -= L1;
  return [x0, y1 - u];
}
function drawShuttle() {
  const [x, y] = shuttlePos();
  box(x - 0.6, y - 0.3, 1.2, 0.6, 0.55, "#f2c94c", "#d9a92e", "#c49625");
  for (let i = 0; i < 3; i++) poly([toScreen(x - 0.5 + i * 0.36, y + 0.3, 0.28), toScreen(x - 0.25 + i * 0.36, y + 0.3, 0.28), toScreen(x - 0.25 + i * 0.36, y + 0.3, 0.48), toScreen(x - 0.5 + i * 0.36, y + 0.3, 0.48)], night > 0.4 ? "#ffe2a8" : "#2b3a4a");
  if (inbox.length) { const [bx, by] = toScreen(x, y, 0.9); badge(bx, by, String(inbox.length), "#d9534f"); }
}
// The helipad on the tallest building; the helicopter takes off while an Opus or Fable desk is working.
function drawHelipad(r, t) {
  const [cx, cy] = toScreen(r.x + r.w / 2, r.y + r.d / 2 + 0.3, r.h), s = cam.z;
  ctx.strokeStyle = "rgba(255,255,255,0.75)"; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.ellipse(cx, cy, 22 * s, 11 * s, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.font = `bold ${12 * s}px system-ui`; ctx.textAlign = "center"; ctx.fillText("H", cx, cy + 4 * s);
  const flying = r.desks.some((d) => /opus|fable/i.test(d.model || "") && r.lastByDesk[d.id] && Date.now() - Date.parse(r.lastByDesk[d.id].startedAt) < ACTIVE_MS);
  const hy = cy - (flying ? 34 + Math.sin(t / 400) * 4 : 6) * s;
  ctx.fillStyle = "#2f3a48"; roundRect(cx - 12 * s, hy - 7 * s, 24 * s, 12 * s, 6 * s); ctx.fill();
  ctx.fillRect(cx + 10 * s, hy - 3 * s, 14 * s, 3 * s);
  ctx.fillStyle = "#9fd0ff"; roundRect(cx - 9 * s, hy - 5 * s, 8 * s, 6 * s, 3 * s); ctx.fill();
  const spin = flying ? t / 40 : 0.4;
  ctx.strokeStyle = "rgba(200,210,220,0.8)"; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.moveTo(cx - Math.cos(spin) * 20 * s, hy - 9 * s - Math.sin(spin) * 3 * s); ctx.lineTo(cx + Math.cos(spin) * 20 * s, hy - 9 * s + Math.sin(spin) * 3 * s); ctx.stroke();
}
// The plaza fountain: full jets while the budget is healthy, a trickle near a cap, dry once one is blown.
function drawFountain(t) {
  if (!fountainAt) return;
  const [x, y] = fountainAt, use = budgetUse(), s = cam.z * 2.6; // the square's centrepiece
  const [cx, cy] = toScreen(x, y, 0);
  ctx.fillStyle = "#4a5563"; ctx.beginPath(); ctx.ellipse(cx, cy, 34 * s, 17 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = use >= 1 ? "#3b3f45" : "#3f7fae"; ctx.beginPath(); ctx.ellipse(cx, cy - 1 * s, 28 * s, 13 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#5b6676"; ctx.fillRect(cx - 3 * s, cy - 14 * s, 6 * s, 13 * s);
  if (use >= 1) return;
  const flow = use > 0.9 ? 0.25 : use > 0.6 ? 0.6 : 1;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + t / 2000, ph = ((t / 900 + i / 9) % 1);
    const r = 20 * s * flow * ph, hgt = Math.sin(ph * Math.PI) * 26 * s * flow;
    ctx.fillStyle = `rgba(170,215,255,${0.75 - ph * 0.5})`; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy - 14 * s - hgt + Math.sin(a) * r * 0.5, 2.2 * s, 0, Math.PI * 2); ctx.fill();
  }
}
function lamp(x, y) {
  const [bx, by] = toScreen(x, y, 0), [tx, ty] = toScreen(x, y, 1.6);
  ctx.strokeStyle = dn("#7d8794", "#55606e"); ctx.lineWidth = Math.max(1, 2 * cam.z); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
  const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, (18 + 14 * night) * cam.z);
  g.addColorStop(0, `rgba(255,214,140,${0.12 + 0.43 * night})`); g.addColorStop(1, "rgba(255,214,140,0)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(tx, ty, (18 + 14 * night) * cam.z, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffe2a8"; ctx.beginPath(); ctx.arc(tx, ty, 2.6 * cam.z, 0, Math.PI * 2); ctx.fill();
}
// Winter (Dec to mid-March, or ?season=winter / december): the pines get snowy tips, like the 3D view's seasons.js.
const SNOWY = (() => { const f = new URLSearchParams(location.search).get("season"); if (f) return f === "winter" || f === "december"; const d = new Date(), m = d.getMonth(); return m === 11 || m <= 1 || (m === 2 && d.getDate() < 15); })();
function tree(x, y) {
  const [bx, by] = toScreen(x, y, 0);
  const s = cam.z;
  ctx.fillStyle = dn("rgba(40,70,40,0.25)", "rgba(0,0,0,0.3)"); ctx.beginPath(); ctx.ellipse(bx, by, 9 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#5b4330"; ctx.fillRect(bx - 1.5 * s, by - 10 * s, 3 * s, 10 * s);
  ctx.fillStyle = dn("#4f9a58", "#2f6b4a"); ctx.beginPath(); ctx.moveTo(bx, by - 30 * s); ctx.lineTo(bx + 9 * s, by - 9 * s); ctx.lineTo(bx - 9 * s, by - 9 * s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = dn("#6dbb6a", "#3d8a5e"); ctx.beginPath(); ctx.moveTo(bx, by - 36 * s); ctx.lineTo(bx + 6.5 * s, by - 20 * s); ctx.lineTo(bx - 6.5 * s, by - 20 * s); ctx.closePath(); ctx.fill();
  if (SNOWY) { ctx.fillStyle = "#eef3f8"; ctx.beginPath(); ctx.moveTo(bx, by - 36 * s); ctx.lineTo(bx + 3.4 * s, by - 28 * s); ctx.lineTo(bx, by - 29.5 * s); ctx.lineTo(bx - 3.4 * s, by - 28 * s); ctx.closePath(); ctx.fill(); }
}

function drawRoom(r, t) {
  if (r.resFloor) return drawResFloor(r, t); // a floor of flats in a Residences tower (city.js)
  const h = r.hue, sel = openRoom === r.id, hov = hover === r.id;
  // floor
  const lit = r.busy ? 30 : 22, litD = r.busy ? 74 : 68; // litD: the daytime floor lightness
  const FL = (s, dl, a = 1) => hn(h, s, litD + dl, s, lit + dl, a);
  poly([toScreen(r.x, r.y), toScreen(r.x + r.w, r.y), toScreen(r.x + r.w, r.y + r.d), toScreen(r.x, r.y + r.d)], FL(28, hov ? 4 : 0), sel ? "#f3d9a4" : hn(h, 28, 52, 28, 40, 0.6));
  // a runner rug down the middle aisle, and a gold rug under the lead's desk
  if (view) {
    const pl = plan(r);
    // the corridor (a lighter runner front to back), the service strip's tiled floor, and the meeting room's rug
    poly([toScreen(r.x + SERV, r.y), toScreen(pl.M, r.y), toScreen(pl.M, r.y + r.d), toScreen(r.x + SERV, r.y + r.d)], FL(22, 9 * (1 - 0.6 * (1 - night)), 0.85));
    poly([toScreen(r.x, r.y), toScreen(r.x + SERV, r.y), toScreen(r.x + SERV, r.y + r.d), toScreen(r.x, r.y + r.d)], FL(8, 4 - 8 * (1 - night), 0.7));
    poly([toScreen(pl.meeting.x + 0.3, pl.meeting.y + 0.4), toScreen(pl.meeting.x + pl.meeting.w - 0.3, pl.meeting.y + 0.4), toScreen(pl.meeting.x + pl.meeting.w - 0.3, pl.meeting.y + pl.meeting.d - 0.3), toScreen(pl.meeting.x + 0.3, pl.meeting.y + pl.meeting.d - 0.3)], hn((h + 180) % 360, 30, litD - 8, 25, lit + 6, 0.55));
  } else {
    const aisleX = r.x + r.w / 2 - 0.5;
    for (let y = r.y + 1; y < r.y + r.d - 0.6; y += 0.9) poly([toScreen(aisleX, y), toScreen(aisleX + 1, y), toScreen(aisleX + 1, y + 0.8), toScreen(aisleX, y + 0.8)], hn(h, 35, litD - 8, 35, lit + 5, 0.55));
  }
  if (r.lead) { const lp = leadPos(r); poly([toScreen(lp.x - 1, lp.y - 0.8), toScreen(lp.x + 1, lp.y - 0.8), toScreen(lp.x + 1, lp.y + 0.9), toScreen(lp.x - 1, lp.y + 0.9)], dn("rgba(214,160,60,0.5)", "rgba(214,176,92,0.55)")); }
  // the floor slab's edge, so each storey reads as a solid floor of the building, with its number on it
  if (view) {
    const sl = 0.45;
    poly([toScreen(r.x, r.y + r.d, -sl), toScreen(r.x + r.w, r.y + r.d, -sl), toScreen(r.x + r.w, r.y + r.d), toScreen(r.x, r.y + r.d)], hn(h, 14, 58, 14, 15));
    poly([toScreen(r.x + r.w, r.y, -sl), toScreen(r.x + r.w, r.y + r.d, -sl), toScreen(r.x + r.w, r.y + r.d), toScreen(r.x + r.w, r.y)], hn(h, 14, 48, 14, 11));
    const [fx, fy] = toScreen(r.x + 1.3, r.y + r.d, -0.22);
    ctx.fillStyle = dn("rgba(30,36,48,0.9)", "rgba(240,236,226,0.9)"); ctx.font = `800 ${Math.max(9, 12 * cam.z)}px system-ui`; ctx.textAlign = "center"; ctx.fillText(`${r.k + 1}F`, fx, fy + 4 * cam.z);
  }
  // door gap in the front edge
  const [dx1, dy1] = toScreen(r.x + r.w / 2 - 0.6, r.y + r.d), [dx2, dy2] = toScreen(r.x + r.w / 2 + 0.6, r.y + r.d);
  ctx.strokeStyle = "#f3d9a4"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(dx1, dy1); ctx.lineTo(dx2, dy2); ctx.stroke();
  // back walls (low, so desks show). Inside a building they're the building's glass curtain wall instead.
  const wallH = view ? 2.0 : 1.1;
  if (view) {
    // carpet tiles
    ctx.save(); ctx.strokeStyle = hn(h, 20, litD - 8, 20, lit + 7, 0.35); ctx.lineWidth = 1;
    for (let gx = 1; gx < r.w; gx++) { const [a, b] = toScreen(r.x + gx, r.y), [c, e] = toScreen(r.x + gx, r.y + r.d); ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, e); ctx.stroke(); }
    for (let gy = 1; gy < r.d; gy++) { const [a, b] = toScreen(r.x, r.y + gy), [c, e] = toScreen(r.x + r.w, r.y + gy); ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, e); ctx.stroke(); }
    ctx.restore();
    curtainWall(r, wallH, t);
  } else {
    poly([toScreen(r.x, r.y), toScreen(r.x + r.w, r.y), toScreen(r.x + r.w, r.y, wallH), toScreen(r.x, r.y, wallH)], hn(h, 25, litD + 14, 25, lit + 12));
    poly([toScreen(r.x, r.y), toScreen(r.x, r.y + r.d), toScreen(r.x, r.y + r.d, wallH), toScreen(r.x, r.y, wallH)], hn(h, 25, litD + 8, 25, lit + 6));
  }
  // window glow on the back wall when someone is working, spread evenly along it
  const nWin = Math.max(2, Math.floor((r.w - 1) / 1.9));
  if (r.busy && !view) for (let i = 0; i < nWin; i++) {
    const x = r.x + (r.w - nWin * 1.9 + 0.8) / 2 + i * 1.9;
    poly([toScreen(x, r.y, 0.45), toScreen(x + 1.1, r.y, 0.45), toScreen(x + 1.1, r.y, 0.95), toScreen(x, r.y, 0.95)], `rgba(255,214,140,${0.55 + 0.15 * Math.sin(t / 700 + i)})`);
  }
  // HR: a filing cabinet and an inbox tray with one envelope per waiting request
  if (r.isHr) {
    box(r.x + r.w - 1.2, r.y + 0.3, 0.9, 0.7, 1.3, "#7c8794", "#5b6470", "#4b535d");
    const trayX = view ? r.x + CORE_W + 2.4 : r.x + 1.2, trayY = view ? r.y + 1.0 : r.y + r.d - 2.0;
    const [ix, iy] = toScreen(trayX + 0.4, trayY + 0.3, 0.55);
    box(trayX, trayY, 0.8, 0.6, 0.5, "#9a7b56", "#7a5f40", "#6a5236");
    // the kombucha tap (over-funded HR), and the gong that rings for a decision in the last 10 minutes
    box(r.x + r.w - 2.7, r.y + 0.25, 1.1, 0.5, 0.7, "#d8d2c4", "#b9b2a3", "#a39c8e");
    for (let k = 0; k < 3; k++) { const [jx, jy] = toScreen(r.x + r.w - 2.5 + k * 0.33, r.y + 0.5, 0.7); ctx.fillStyle = ["#e0a43c", "#c9643c", "#8fbf5a"][k]; roundRect(jx - 4 * cam.z, jy - 12 * cam.z, 8 * cam.z, 11 * cam.z, 2 * cam.z); ctx.fill(); }

    for (let k = 0; k < Math.min(inbox.length, 6); k++) { ctx.fillStyle = k % 2 ? "#f2ead8" : "#e6dcc4"; ctx.fillRect(ix - 9 * cam.z, iy - (4 + k * 3) * cam.z, 18 * cam.z, 3 * cam.z); }
    if (inbox.length) { const bob = Math.sin(t / 300) * 3; badge(ix, iy - (28 + bob) * cam.z, String(inbox.length), "#d9534f"); }
  }
  // desks and the bots at them, back to front (plus the meeting table and the glass corner office)
  const items = [];
  r.desks.forEach((d) => { const b = bots.get(d.id); if (b) items.push({ k: b.desk.x + b.desk.y, f: () => drawDesk(b, t) }, { k: b.x + b.y + 0.6, f: () => drawBot(b, t) }); });
  const tp = view && tablePos(r);
  if (tp) items.push({ k: tp.x + tp.y, f: () => drawTable(tp) });
  if (view) {
    items.push({ k: r.x + 0.75 + r.y + 1.05, f: () => elevatorCore(r, t) });
    // cubicle dividers behind each row of staff desks
    for (const { first, last } of deskRows(r)) {
      items.push({ k: first.x + first.y - 1.0, f: () => box(first.x - 0.85, first.y - 0.72, last.x - first.x + 1.7, 0.08, 0.55, hsl(h, 18, 52), hsl(h, 18, 42), hsl(h, 18, 36)) });
    }
    // each side (channel) gets a tinted carpet and its name on the back wall
    if (r.groups) r.groups.forEach((g, gi) => {
      const [l, rt] = sideSpan(r, gi), hue = g.name === "Shared" ? h : hueOf(g.name), y0 = r.y + 0.3, y1 = r.y + r.d - FRONT - 0.2;
      items.unshift({ k: -1e9, f: () => poly([toScreen(l - 0.2, y0), toScreen(rt + 0.2, y0), toScreen(rt + 0.2, y1), toScreen(l - 0.2, y1)], g.name === "Shared" ? dn("rgba(255,255,255,0.18)", "rgba(255,255,255,0.05)") : hn(hue, 55, 52, 55, 55, 0.2), hn(hue, 55, 45, 55, 65, 0.4)) });
      items.push({ k: 1e9, f: () => { if (cam.z < 0.35) return; const [sx, sy] = toScreen(l + 0.1, y1 - 0.15, 0.05); ctx.font = `700 ${Math.max(8, 11 * cam.z)}px system-ui`; ctx.textAlign = "left"; ctx.fillStyle = g.name === "Shared" ? dn("rgba(40,46,60,0.8)", "rgba(233,228,216,0.75)") : hn(hue, 70, 30, 70, 72); ctx.fillText(g.name, sx, sy); } });
    });
    if (r.isHr) items.push({ k: r.x + r.w - 0.8 + r.y + 2.4, f: () => drawGong(r.x + r.w - 0.8, r.y + 2.4, t) });
    officeRooms(r, items, t);
    // each project's own decor, against the back wall right of centre
    const pid = r.project?.id, tx = r.x + r.w - 2.6, ty = r.y + 0.25;
    if (r.isHr) items.push({ k: r.x + CORE_W + (r.w - CORE_W) / 2 + r.y + 2.6, f: () => ballPit(r.x + CORE_W + (r.w - CORE_W) / 2 - 0.4, r.y + 2.2, t) });
    else if (THEME[pid]) items.push({ k: tx + ty + 0.5, f: () => THEME[pid](tx, ty, r, t) });
    items.push({ k: r.x + CORE_W + 0.2 + r.y + 1.3, f: () => box(r.x + CORE_W + 0.2, r.y + 0.12, 1.3, 0.32, 1.0, "#7a5a3e", "#5f4530", "#523b29") || books(r.x + CORE_W + 0.2, r.y + 0.12) });
  }
  items.sort((a, b) => a.k - b.k).forEach((i) => i.f());
  if (view) ceilingLights(r, t);
  // sign + battery
  const [sx, sy] = toScreen(r.x + r.w / 2, r.y + r.d / 2, 0);
  // The sign hangs over the office's own door (front edge, middle), with its battery beside it, so every
  // label sits on its own office instead of on a shared corner between plots.
  // (drawn in drawSign after every office, so a neighbour never covers a sign)
  if (!r.desks.length) { ctx.fillStyle = "rgba(233,228,216,0.35)"; ctx.font = `${Math.max(10, 12 * cam.z)}px system-ui`; ctx.textAlign = "center"; ctx.fillText("empty — hire through HR", sx, sy); }
}

// HR's gong: rings (with ripples) for ten minutes after you approve or decline a request.
const recentDecision = () => (data?.requests || []).some((q) => q.decision && Date.now() - Date.parse(q.decision.at) < 10 * 60000);
function drawGong(x, y, t) {
  const s = cam.z, [gx, gy] = toScreen(x, y, 0);
  ctx.strokeStyle = "#6b4e36"; ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.moveTo(gx - 13 * s, gy); ctx.lineTo(gx - 13 * s, gy - 34 * s); ctx.lineTo(gx + 13 * s, gy - 34 * s); ctx.lineTo(gx + 13 * s, gy); ctx.stroke();
  const ring = recentDecision(), wob = ring ? Math.sin(t / 60) * 1.5 : 0;
  ctx.fillStyle = "#d9a441"; ctx.beginPath(); ctx.arc(gx + wob, gy - 19 * s, 9 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#f0c868"; ctx.beginPath(); ctx.arc(gx + wob - 2 * s, gy - 21 * s, 3.5 * s, 0, Math.PI * 2); ctx.fill();
  if (ring) for (let i = 0; i < 3; i++) { const ph = (t / 1200 + i / 3) % 1; ctx.strokeStyle = `rgba(240,200,104,${0.6 * (1 - ph)})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(gx, gy - 19 * s, (10 + ph * 22) * s, 0, Math.PI * 2); ctx.stroke(); }
}
// Project decor styles (inside the buildings).
function screenGlow(x, y, z0, z1, w, col) { poly([toScreen(x, y, z0), toScreen(x + w, y, z0), toScreen(x + w, y, z1), toScreen(x, y, z1)], col); }
const THEME = {
  youtube(x, y, r, t) { // green screen and a ring light
    poly([toScreen(x - 0.2, y - 0.2, 0.15), toScreen(x + 1.4, y - 0.2, 0.15), toScreen(x + 1.4, y - 0.2, 1.35), toScreen(x - 0.2, y - 0.2, 1.35)], "#2fa84f");
    const [lx, ly] = toScreen(x + 1.6, y + 0.6, 0), [hx, hy] = toScreen(x + 1.6, y + 0.6, 1.2), s = cam.z;
    ctx.strokeStyle = "#555"; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.strokeStyle = "rgba(255,250,235,0.95)"; ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.ellipse(hx, hy - 6 * s, 9 * s, 11 * s, 0, 0, Math.PI * 2); ctx.stroke();
  },
  cards(x, y, r, t) { // a card shop display case
    box(x, y, 1.6, 0.6, 0.75, "rgba(190,220,255,0.35)", "#6b4e36", "#5a412c");
    const cols = ["#e05d5d", "#5a8fd1", "#e0b04f", "#6fbf73", "#b48cff"];
    for (let i = 0; i < 5; i++) { const [cx, cy] = toScreen(x + 0.2 + i * 0.28, y + 0.3, 0.76); ctx.fillStyle = cols[i]; ctx.fillRect(cx - 3 * cam.z, cy - 5 * cam.z, 6 * cam.z, 8 * cam.z); }
  },
  hub(x, y, r, t) { serverRack(x, y, t); serverRack(x + 0.7, y, t + 500); },
  homeserver(x, y, r, t) { serverRack(x, y, t); serverRack(x + 0.7, y, t + 700); },
  gaming(x, y, r, t) { // a TV and a couch
    box(x, y, 1.4, 0.3, 0.45, "#3a2f28", "#2e251f", "#271f1a");
    box(x + 0.15, y + 0.05, 1.1, 0.1, 0.7, "#111", "#111", "#111", 0.45);
    screenGlow(x + 0.2, y + 0.16, 0.5, 1.1, 1.0, `rgba(110,168,255,${0.6 + 0.3 * Math.sin(t / 300)})`);
    box(x + 0.1, y + 1.4, 1.3, 0.55, 0.4, "#5a6fa0", "#475a85", "#3d4e74");
  },
  mascot(x, y, r, t) { // a giant mascot costume head on a stand
    box(x + 0.5, y + 0.3, 0.3, 0.3, 0.6, "#555", "#444", "#3a3a3a");
    const [hx, hy] = toScreen(x + 0.65, y + 0.45, 0.6), s = cam.z;
    ctx.fillStyle = "#f2c94c"; ctx.beginPath(); ctx.arc(hx, hy - 14 * s, 14 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(hx - 5 * s, hy - 17 * s, 4 * s, 0, Math.PI * 2); ctx.arc(hx + 5 * s, hy - 17 * s, 4 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#1b1f27"; ctx.beginPath(); ctx.arc(hx - 5 * s, hy - 17 * s, 2 * s, 0, Math.PI * 2); ctx.arc(hx + 5 * s, hy - 17 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#c94f4f"; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.arc(hx, hy - 10 * s, 6 * s, 0.2, Math.PI - 0.2); ctx.stroke();
  },
};
function serverRack(x, y, t) {
  box(x, y, 0.55, 0.5, 1.4, "#2a2f36", "#22272d", "#1c2025");
  for (let i = 0; i < 5; i++) { const on = Math.sin(t / 200 + i * 1.7 + x) > 0; screenGlow(x + 0.1, y + 0.5, 0.2 + i * 0.24, 0.27 + i * 0.24, 0.12, on ? "#7ddc8a" : "#2c4a35"); screenGlow(x + 0.3, y + 0.5, 0.2 + i * 0.24, 0.27 + i * 0.24, 0.12, on ? "#3c5a44" : "#6ea8ff"); }
}
// HR's ball pit: one ball for every staff request approved this month (a few to start with).
function ballPit(x, y, t) {
  const month = new Date().toISOString().slice(0, 7);
  const approved = (data?.requests || []).filter((q) => q.decision?.decision === "approved" && q.kind !== "ask" && String(q.decision.at).startsWith(month)).length;
  box(x, y, 1.4, 1.0, 0.35, "#6ea8ff", "#4f86d6", "#3f72bd");
  const cols = ["#e05d5d", "#f0b45a", "#7ddc8a", "#b48cff", "#f2ead8"], n = Math.min(40, 6 + approved * 4), s = cam.z;
  for (let i = 0; i < n; i++) { const bx = x + 0.15 + ((i * 37) % 11) / 10 * 1.1, by = y + 0.15 + ((i * 53) % 7) / 7 * 0.7; const [px, py] = toScreen(bx, by, 0.35); ctx.fillStyle = cols[i % 5]; ctx.beginPath(); ctx.arc(px, py - 2 * s, 3.2 * s, 0, Math.PI * 2); ctx.fill(); }
}
// Office decor.
function plant(x, y) {
  box(x - 0.2, y - 0.2, 0.4, 0.4, 0.35, "#b86b4b", "#94553b", "#7f4832");
  const [px, py] = toScreen(x, y, 0.35), s = cam.z;
  ctx.fillStyle = "#3d8a5e"; ctx.beginPath(); ctx.arc(px, py - 9 * s, 9 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#4fae6e"; ctx.beginPath(); ctx.arc(px - 4 * s, py - 14 * s, 6 * s, 0, Math.PI * 2); ctx.arc(px + 5 * s, py - 12 * s, 5 * s, 0, Math.PI * 2); ctx.fill();
}
function books(x, y) {
  const cols = ["#c94f4f", "#e0b04f", "#5a8fd1", "#6fbf73", "#b48cff", "#e08a5a"];
  for (let shelf = 0; shelf < 2; shelf++) for (let i = 0; i < 6; i++) poly([toScreen(x + 0.1 + i * 0.19, y + 0.33, 0.12 + shelf * 0.45), toScreen(x + 0.25 + i * 0.19, y + 0.33, 0.12 + shelf * 0.45), toScreen(x + 0.25 + i * 0.19, y + 0.33, 0.45 + shelf * 0.45), toScreen(x + 0.1 + i * 0.19, y + 0.33, 0.45 + shelf * 0.45)], cols[(i + shelf * 2) % 6]);
}
// Inside a building: the glass curtain wall along the two back sides, floor to ceiling, with mullions; you see the
// sky through it (night-aware), and the panes glow warm while someone on the floor is working.
function curtainWall(r, wh, t) {
  const sky = dn("rgba(190,222,245,0.9)", "rgba(30,44,66,0.92)"), frame = hn(r.hue, 10, 62, 10, 30);
  poly([toScreen(r.x, r.y), toScreen(r.x + r.w, r.y), toScreen(r.x + r.w, r.y, wh), toScreen(r.x, r.y, wh)], frame);
  poly([toScreen(r.x, r.y), toScreen(r.x, r.y + r.d), toScreen(r.x, r.y + r.d, wh), toScreen(r.x, r.y, wh)], hn(r.hue, 10, 54, 10, 25));
  const pane = (pts, i) => poly(pts, r.busy ? `rgba(255,214,140,${0.45 + 0.15 * Math.sin(t / 900 + i)})` : sky);
  const step = 0.9;
  for (let i = 0, x = r.x + 0.08; x + step - 0.1 <= r.x + r.w; x += step, i++) {
    pane([toScreen(x, r.y + 0.01, 0.15), toScreen(x + step - 0.12, r.y + 0.01, 0.15), toScreen(x + step - 0.12, r.y + 0.01, wh - 0.12), toScreen(x, r.y + 0.01, wh - 0.12)], i);
  }
  for (let i = 0, y = r.y + 0.08; y + step - 0.1 <= r.y + r.d; y += step, i++) {
    pane([toScreen(r.x + 0.01, y, 0.15), toScreen(r.x + 0.01, y + step - 0.12, 0.15), toScreen(r.x + 0.01, y + step - 0.12, wh - 0.12), toScreen(r.x + 0.01, y, wh - 0.12)], i + 7);
  }
  // a transom line across both walls
  ctx.strokeStyle = frame; ctx.lineWidth = Math.max(1, 2 * cam.z);
  for (const [a, b] of [[[r.x, r.y], [r.x + r.w, r.y]], [[r.x, r.y], [r.x, r.y + r.d]]]) { const [x1, y1] = toScreen(a[0], a[1], 1.25), [x2, y2] = toScreen(b[0], b[1], 1.25); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
}
// The elevator core on the left: steel doors facing the floor, and a lit display with the floor number.
function elevatorCore(r, t) {
  const x = r.x + 0.1, y = r.y + 0.25, w = 1.3, d = 1.6, hgt = 2.0;
  box(x, y, w, d, hgt, hsl(r.hue, 8, 46), hsl(r.hue, 8, 38), hsl(r.hue, 8, 32));
  const fx = x + w + 0.005;
  for (const [y1, y2] of [[y + 0.3, y + 0.82], [y + 0.88, y + 1.4]]) poly([toScreen(fx, y1, 0), toScreen(fx, y2, 0), toScreen(fx, y2, 1.35), toScreen(fx, y1, 1.35)], "#a9b2bc", "#7c8691");
  poly([toScreen(fx, y + 0.55, 1.5), toScreen(fx, y + 1.15, 1.5), toScreen(fx, y + 1.15, 1.75), toScreen(fx, y + 0.55, 1.75)], "#141820");
  const [dx, dy] = toScreen(fx, y + 0.85, 1.62);
  ctx.fillStyle = "#ffb347"; ctx.font = `700 ${Math.max(7, 9 * cam.z)}px system-ui`; ctx.textAlign = "center"; ctx.fillText(`${r.k + 1}`, dx, dy + 3 * cam.z);
  // a little up/down arrow that blinks now and then, as if the lift is on its way
  if (Math.sin(t / 1300 + r.k) > 0.6) { const [ax, ay] = toScreen(fx, y + 0.35, 1.62); ctx.fillStyle = "#7ddc8a"; ctx.fillText(Math.sin(t / 4000 + r.k) > 0 ? "▲" : "▼", ax, ay + 3 * cam.z); }
}
// Ceiling light panels hanging over each row of desks, lit when anyone on the floor is at work.
function ceilingLights(r, t) {
  const rows = Math.max(1, Math.ceil(r.staff.length / r.cols));
  const on = r.working > 0 || r.busy;
  for (let row = 0; row < rows; row++) {
    const p0 = deskPos(r, row * r.cols), cx = r.x + (r.coreW || 0) + (r.w - (r.coreW || 0)) / 2, z = 2.25;
    const [hx1, hy1] = toScreen(cx - 1.2, p0.y, z + 0.4), [hx2, hy2] = toScreen(cx - 1.2, p0.y, z), [hx3, hy3] = toScreen(cx + 1.2, p0.y, z + 0.4), [hx4, hy4] = toScreen(cx + 1.2, p0.y, z);
    ctx.strokeStyle = "rgba(200,200,200,0.35)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx1, hy1); ctx.lineTo(hx2, hy2); ctx.moveTo(hx3, hy3); ctx.lineTo(hx4, hy4); ctx.stroke();
    poly([toScreen(cx - 1.5, p0.y - 0.25, z), toScreen(cx + 1.5, p0.y - 0.25, z), toScreen(cx + 1.5, p0.y + 0.25, z), toScreen(cx - 1.5, p0.y + 0.25, z)], on ? `rgba(255,246,220,${0.8 + 0.1 * Math.sin(t / 1500 + row)})` : "rgba(120,125,135,0.6)");
  }
}
// The rooms of a floor: walls (low, so you can see in; glass where an office would have glass) with doorways,
// and what's in each room. Everything goes into the floor's depth-sorted item list.
function officeRooms(r, items, t) {
  const pl = plan(r), h = r.hue, wallH = 0.95;
  const solid = [hsl(h, 10, 70), hsl(h, 10, 60)], glass = ["rgba(170,215,255,0.16)", "rgba(200,230,255,0.5)"];
  // a wall along x (constant y) or along y (constant x), drawn as a thin slab
  const wallX = (x1, x2, y, kind) => items.push({ k: (x1 + x2) / 2 + y + 0.05, f: () => poly([toScreen(x1, y), toScreen(x2, y), toScreen(x2, y, wallH), toScreen(x1, y, wallH)], kind[0], kind[1]) });
  const wallY = (y1, y2, x, kind) => items.push({ k: x + (y1 + y2) / 2 + 0.05, f: () => poly([toScreen(x, y1), toScreen(x, y2), toScreen(x, y2, wallH), toScreen(x, y1, wallH)], kind[0], kind[1]) });
  const X0 = r.x, S = r.x + SERV, front = pl.front;
  // service strip: elevator lobby (open to the corridor) | restrooms | kitchenette | reception (open)
  wallX(X0, S, pl.wc.y, solid);
  wallY(pl.wc.y, pl.wc.y + 0.45, S, solid); wallY(pl.wc.y + 1.05, pl.wc.y + pl.wc.d, S, solid); // restroom door
  wallX(X0, S, pl.kitchen.y, solid);
  wallY(pl.kitchen.y, pl.kitchen.y + 0.35, S, solid); wallY(pl.kitchen.y + 1.1, front, S, solid); // kitchen door
  wallX(X0, S, front, solid);
  // restrooms: two doors with little signs, and a sink
  items.push({ k: X0 + 0.5 + pl.wc.y + 0.4, f: () => { box(X0 + 0.15, pl.wc.y + 0.2, 0.55, 0.4, 0.45, "#e9eef2", "#c9d1d8", "#b5bec6"); const [sx, sy] = toScreen(S - 0.01, pl.wc.y + 0.75, 0.75); ctx.fillStyle = "#6ea8ff"; ctx.font = `700 ${Math.max(7, 9 * cam.z)}px system-ui`; ctx.textAlign = "center"; ctx.fillText("WC", sx, sy); } });
  // kitchenette: counter along the outer wall, a fridge, the coffee machine (steams when the floor is busy), a café table
  const kz = pl.kitchen;
  items.push({ k: X0 + 0.35 + kz.y + 0.8, f: () => { box(X0 + 0.08, kz.y + 0.2, 0.55, Math.max(0.8, kz.d - 1.3), 0.5, "#d8cdb8", "#b7ab95", "#a19681"); box(X0 + 0.15, kz.y + 0.35, 0.35, 0.3, 0.3, "#3a3f47", "#2c3037", "#24282e", 0.5); if (r.busy || r.working) { const [cx, cy] = toScreen(X0 + 0.32, kz.y + 0.5, 0.85); for (let i = 0; i < 3; i++) { const ph = (t / 1400 + i / 3) % 1; ctx.fillStyle = `rgba(240,240,240,${0.45 * (1 - ph)})`; ctx.beginPath(); ctx.arc(cx + Math.sin(ph * 6 + i) * 2 * cam.z, cy - ph * 16 * cam.z, (1.5 + ph * 3) * cam.z, 0, Math.PI * 2); ctx.fill(); } } } });
  if (kz.d > 1.6) items.push({ k: X0 + 0.4 + kz.y + kz.d - 0.6, f: () => box(X0 + 0.1, kz.y + kz.d - 0.95, 0.6, 0.6, 1.35, "#e9eef2", "#c9d1d8", "#b5bec6") });
  items.push({ k: X0 + 1.4 + kz.y + kz.d / 2, f: () => { box(X0 + 1.15, kz.y + kz.d / 2 - 0.25, 0.5, 0.5, 0.45, "#8b6a4a", "#6d523a", "#5e4632"); } });
  // reception desk facing the corridor, and a plant
  items.push({ k: X0 + 1.0 + front + 1.2, f: () => { box(X0 + 0.9, front + 0.6, 0.55, 1.3, 0.55, hsl(h, 20, 40), hsl(h, 20, 32), hsl(h, 20, 28)); box(X0 + 0.95, front + 0.65, 0.45, 1.2, 0.06, "#e8dcc4", "#c9bca2", "#b5a88e", 0.55); } });
  items.push({ k: X0 + 0.4 + front + 2.2, f: () => plant(X0 + 0.4, front + 2.2) });
  // meeting room (glass), door on the corridor side
  const m = pl.meeting;
  wallX(m.x, m.x + m.w, m.y, glass);
  wallY(m.y, m.y + m.d, m.x + m.w, glass);
  wallY(m.y + 1.25, m.y + m.d, m.x, glass);
  // phone booth between the meeting room and the lead's office
  if (pl.booth) items.push({ k: pl.booth.x + pl.booth.y + 0.7, f: () => { box(pl.booth.x, pl.booth.y, 0.65, 0.65, 1.55, "rgba(170,215,255,0.22)", "rgba(140,190,240,0.3)", "rgba(120,170,220,0.3)"); box(pl.booth.x + 0.15, pl.booth.y + 0.15, 0.35, 0.3, 0.45, "#5a6fa0", "#475a85", "#3d4e74"); } });
  // the lounge wing at the back right (2026-11-13): a rug, a sofa, a coffee table, a beanbag and an arcade cabinet
  const L = pl.lounge;
  if (L) items.push({ k: L.x + L.y + 0.5, f: () => {
    box(L.x + 0.3, L.y + 0.4, L.w - 0.6, L.d - 0.8, 0.02, hsl(h, 45, 62, 0.55), hsl(h, 40, 52, 0.55), hsl(h, 40, 48, 0.55));
    box(L.x + 0.5, L.y + 0.5, L.w - 1.0, 0.55, 0.42, "#6f86a8", "#5d7392", "#536884");
    box(L.x + L.w / 2 - 0.4, L.y + 1.4, 0.8, 0.45, 0.32, "#a87b52", "#8b6a4a", "#7a5c40");
    box(L.x + 0.45, L.y + L.d - 1.2, 0.55, 0.55, 0.32, "#d98b5f", "#c27a52", "#b06d48");
    box(L.x + L.w - 0.8, L.y + L.d - 1.4, 0.5, 0.45, 1.2, "#3a3f5a", "#2e3248", "#282b3e");
  } });
  // the floor lead's private office: glass walls, door in the wall facing the open plan
  const o = pl.office;
  wallX(o.x, o.x + 0.9, o.y, glass); wallX(o.x + 1.6, o.x + o.w, o.y, glass);
  wallY(o.y, o.y + o.d, o.x, glass);
  items.push({ k: o.x + o.w - 0.4 + o.y + 0.5, f: () => plant(o.x + o.w - 0.4, o.y + 0.45) });
  // a plant at the back right of the open plan
  items.push({ k: r.x + r.w + r.y - 0.4, f: () => plant(r.x + r.w - 0.5, r.y + 0.45) });
}
// Meeting table with four chairs.
function drawTable(tp) {
  for (const [cx, cy] of [[-0.95, 0], [0.95, 0], [0, -0.75], [0, 0.75]]) box(tp.x + cx - 0.2, tp.y + cy - 0.2, 0.4, 0.4, 0.3, "#55606e", "#434c58", "#3a424c");
  box(tp.x - 0.7, tp.y - 0.45, 1.4, 0.9, 0.42, "#c9b38d", "#a08a66", "#8d7858");
}
// A point on the slide from floor k down to floor k-1 (u = 0 at the top, 1 at the bottom), in screen space.
function slidePoint(k, u) {
  const f0 = rooms[0], zt = rooms[k].z, zb = rooms[k - 1].z;
  return toScreen(f0.x + f0.w + 0.5 + Math.sin(u * Math.PI) * 0.6, f0.y + f0.d - 1.0 - u * (f0.d - 2.0), zt + 0.2 - u * (zt - zb));
}
// Slide riders: now and then an idle bot on an upper floor takes the slide down a floor ("wheee!"), then is back
// at its desk (the lift brought it up again). It doesn't happen while the bot has work.
let rider = null, nextRide = 0;
function stepRider(t) {
  if (!view || rooms.length < 2) { rider = null; return; }
  if (rider && t > rider.start + 2600) { rider.b.riding = false; rider = null; nextRide = t + 9000 + Math.random() * 12000; }
  if (rider || t < nextRide) return;
  const idle = [...bots.values()].filter((b) => b.room?.k > 0 && !b.active && b.d.status === "active" && !b.riding);
  if (!idle.length) { nextRide = t + 5000; return; }
  const b = pick(idle);
  b.riding = true;
  rider = { b, k: b.room.k, start: t };
}
function drawRider(t) {
  if (!rider) return;
  const u = Math.min(1, (t - rider.start) / 2400), e = u * u * (3 - 2 * u);
  const [px, py] = slidePoint(rider.k, e), s = cam.z * 1.2;
  ctx.fillStyle = PROVIDER[rider.b.d.provider] || PROVIDER.other; roundRect(px - 5 * s, py - 14 * s, 10 * s, 10 * s, 3 * s); ctx.fill();
  ctx.fillStyle = "#f4ecdc"; roundRect(px - 6 * s, py - 24 * s, 12 * s, 10 * s, 4 * s); ctx.fill();
  ctx.fillStyle = "#1b1f27"; ctx.fillRect(px - 3.5 * s, py - 21 * s, 2 * s, 2.5 * s); ctx.fillRect(px + 1.5 * s, py - 21 * s, 2 * s, 2.5 * s);
  if (u < 0.8 && cam.z > 0.35) thoughtBubble(px, py - 30 * s, "wheee!", true);
}

// Inside a building: the plaza at ground level and four corner columns running up the stack (back ones first,
// front ones after the floors so they frame the cutaway).
function drawFrame(front) {
  const f0 = rooms[0], top = (campus.top || 0) + 1.3, m = 0.25;
  if (!front) {
    const pad = 1.4;
    poly([toScreen(f0.x - pad, f0.y - pad, -0.36), toScreen(f0.x + f0.w + pad, f0.y - pad, -0.36), toScreen(f0.x + f0.w + pad, f0.y + f0.d + pad, -0.36), toScreen(f0.x - pad, f0.y + f0.d + pad, -0.36)], dn("#d9cfb6", "#26303c"), dn("#c9c2b0", "#3a4656"));
  }
  // (no column at the nearest corner: it would cut through every floor's corner office)
  const cols = front ? [[f0.x, f0.y + f0.d], [f0.x + f0.w, f0.y]] : [[f0.x, f0.y]];
  for (const [x, y] of cols) box(x - m / 2, y - m / 2, m, m, top + 0.36, dn("#a9b2bf", "#4a5563"), dn("#8c96a4", "#3b4450"), dn("#7d8896", "#323a45"), -0.36);
  // the slide: a yellow tube down the right side, outside the glass, from every floor to the one below
  if (front && !f0.resFloor) for (let k = 1; k < rooms.length; k++) { // (homes have stairs, not a slide)
    const pts = [];
    for (let i = 0; i <= 16; i++) pts.push(slidePoint(k, i / 16));
    for (const [wdt, col] of [[7, "#b77f22"], [4.5, "#f0b45a"], [1.5, "#ffe0a0"]]) { ctx.strokeStyle = col; ctx.lineWidth = wdt * cam.z; ctx.lineCap = "round"; ctx.beginPath(); pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); ctx.stroke(); }
  }
}
// A project's building on the campus: one storey per floor, windows lit where someone is working.
function drawBuilding(r, t) {
  if (r.isControl) return drawControl(r, t);
  if (r.isStore) return drawStore(r, t);
  if (r.isHomes) return drawHomes(r, t);
  if (r.isGarden) return drawGarden(r, t);
  if (r.isHouse) return drawHouse(r, t);
  if (r.isUnderground) return drawUnderground(r);
  if (r.tower && !view) return r.tower.k === 0 ? drawTower2d(r.tower, t) : undefined; // one stacked tower, drawn once
  const h = r.hue, sel = openRoom === r.id, hov = hover === r.id;
  const { x, y, w, d } = r, top = r.h;
  // plaza and shadow
  poly([toScreen(x - 0.7, y - 0.7), toScreen(x + w + 0.7, y - 0.7), toScreen(x + w + 0.7, y + d + 0.7), toScreen(x - 0.7, y + d + 0.7)], dn("rgba(217,207,182,0.85)", "rgba(0,0,0,0.22)"), sel ? "#f3d9a4" : null);
  // walls: front (y+d) and side (x+w)
  const front = hn(h, 52, hov ? 68 : 64, 24, hov ? 30 : 26), side = hn(h, 44, hov ? 58 : 54, 22, hov ? 22 : 19), roof = hn(h, 30, hov ? 90 : 86, 20, hov ? 38 : 34);
  poly([toScreen(x, y + d), toScreen(x + w, y + d), toScreen(x + w, y + d, top), toScreen(x, y + d, top)], front);
  poly([toScreen(x + w, y), toScreen(x + w, y + d), toScreen(x + w, y + d, top), toScreen(x + w, y, top)], side);
  // one band of windows per floor; a busy floor glows, a staffed one is softly lit, an empty one is dark glass
  r.floors.forEach((f, k) => {
    const z0 = k * FLOOR_H + 0.4, z1 = z0 + 0.75;
    const glow = f.busy ? `rgba(255,214,140,${0.75 + 0.2 * Math.sin(t / 500 + k)})` : f.working ? dn("rgba(255,236,190,0.75)", "rgba(255,226,170,0.32)") : dn("rgba(70,105,150,0.5)", "rgba(120,150,190,0.22)");
    const nF = Math.max(2, Math.floor(w / 1.15)), nS = Math.max(2, Math.floor(d / 1.15));
    for (let i = 0; i < nF; i++) { const a = x + 0.35 + i * ((w - 0.7) / nF), b = a + (w - 0.7) / nF - 0.3; poly([toScreen(a, y + d, z0), toScreen(b, y + d, z0), toScreen(b, y + d, z1), toScreen(a, y + d, z1)], glow); }
    for (let i = 0; i < nS; i++) { const a = y + 0.35 + i * ((d - 0.7) / nS), b = a + (d - 0.7) / nS - 0.3; poly([toScreen(x + w, a, z0), toScreen(x + w, b, z0), toScreen(x + w, b, z1), toScreen(x + w, a, z1)], glow); }
    if (k) { ctx.strokeStyle = dn("rgba(255,255,255,0.45)", "rgba(0,0,0,0.25)"); ctx.lineWidth = 1; const [a1, b1] = toScreen(x, y + d, k * FLOOR_H), [a2, b2] = toScreen(x + w, y + d, k * FLOOR_H), [a3, b3] = toScreen(x + w, y, k * FLOOR_H); ctx.beginPath(); ctx.moveTo(a1, b1); ctx.lineTo(a2, b2); ctx.lineTo(a3, b3); ctx.stroke(); }
  });
  // front door (lobby) with a warm light
  const dw = 0.55, cx = x + w / 2;
  poly([toScreen(cx - dw, y + d, 0), toScreen(cx + dw, y + d, 0), toScreen(cx + dw, y + d, 0.9), toScreen(cx - dw, y + d, 0.9)], r.busy ? "#e9c27a" : dn("#6b5a44", "#3a3328"), dn("#fff3d6", "#f3d9a4"));
  // roof with a parapet, a rooftop unit, and HR's inbox count
  poly([toScreen(x, y, top), toScreen(x + w, y, top), toScreen(x + w, y + d, top), toScreen(x, y + d, top)], roof, hn(h, 24, 74, 20, 48, 0.8));
  box(x + w - 1.6, y + 0.6, 1.0, 0.8, 0.45, dn("#aab4c0", "#7c8794"), dn("#8892a0", "#5b6470"), dn("#98a2b0", "#4b535d"), top);
  if (r.isHr && inbox.length) { const [ix, iy] = toScreen(x + w / 2, y + d / 2, top + 0.6); badge(ix, iy - Math.sin(t / 300) * 3, String(inbox.length), "#d9534f"); }
  if (r.isHr && recentDecision()) { const [gx, gy] = toScreen(x + w / 2, y + d / 2, top); for (let i = 0; i < 3; i++) { const ph = (t / 1200 + i / 3) % 1; ctx.strokeStyle = `rgba(240,200,104,${0.6 * (1 - ph)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(gx, gy, (10 + ph * 40) * cam.z, (5 + ph * 20) * cam.z, 0, 0, Math.PI * 2); ctx.stroke(); } }
  if (r === tallest) drawHelipad(r, t);
  // rooftop garden: one plant per thing finished this week (up to 12), in planters along the roof
  const done = Math.min(12, statsOf(r.id).weekDone);
  for (let i = 0; i < 6; i++) {
    const px = x + 0.55 + (i % 3) * 0.75, py = y + 0.6 + Math.floor(i / 3) * (d - 1.6);
    box(px, py, 0.55, 0.4, 0.22, "#6b4e36", "#5a412c", "#4c3726", top);
    for (let j = 0; j < 2; j++) if (i * 2 + j < done) { const [qx, qy] = toScreen(px + 0.15 + j * 0.25, py + 0.2, top + 0.22); const g = 6 * cam.z; ctx.fillStyle = j ? "#4fae6e" : "#3d8a5e"; ctx.beginPath(); ctx.arc(qx, qy - g, g, 0, Math.PI * 2); ctx.fill(); }
  }
  // neon letters on the roof edge, brighter at night
  if (cam.z > 0.4) {
    const [nx, ny] = toScreen(x + w / 2, y + d, top + 0.55);
    ctx.save(); ctx.font = `700 ${Math.max(10, 13 * cam.z)}px system-ui`; ctx.textAlign = "center";
    ctx.shadowColor = night > 0.5 ? hsl(h, 90, 60) : "rgba(255,255,255,0.95)"; ctx.shadowBlur = night > 0.5 ? 6 + 12 * night : 5;
    ctx.fillStyle = hn(h, 70, 24, 85, 80, 0.97); ctx.fillText(r.name.toUpperCase(), nx, ny);
    ctx.restore();
  }
  drawCart(r, t);
}
// Where a building's espresso cart stands: by its door; in the quad's wings (doors facing the quad, neighbours wall to
// wall) out on the concourse in front of the door.
function cartAt(r) {
  if (campus.plan === "quad" && r.face === "e") return [r.x + r.w + 0.55, r.y + r.d / 2 + 1.25];
  if (campus.plan === "quad" && r.face === "w") return [r.x - 0.55, r.y + r.d / 2 + 1.25];
  return [r.x + r.w / 2 + 1.25, r.y + r.d + 0.55];
}
// The espresso cart by each lobby: a barista bot, and steam that builds with how much the project ran today.
function drawCart(r, t) {
  const [cx, cy] = cartAt(r);
  const st = statsOf(r.id);
  box(cx - 0.45, cy - 0.3, 0.9, 0.6, 0.55, "#8b5a3c", "#6e4630", "#5d3b28");
  // striped awning
  for (let i = 0; i < 4; i++) poly([toScreen(cx - 0.5 + i * 0.25, cy - 0.35, 1.05), toScreen(cx - 0.25 + i * 0.25, cy - 0.35, 1.05), toScreen(cx - 0.25 + i * 0.25, cy + 0.35, 0.9), toScreen(cx - 0.5 + i * 0.25, cy + 0.35, 0.9)], i % 2 ? "#f2ead8" : "#c94f4f");
  // barista (small bot head behind the counter)
  const [bx, by] = toScreen(cx - 0.1, cy - 0.45, 0.62), s = cam.z;
  ctx.fillStyle = "#f4ecdc"; roundRect(bx - 5 * s, by - 9 * s, 10 * s, 8 * s, 3 * s); ctx.fill();
  ctx.fillStyle = "#1b1f27"; ctx.fillRect(bx - 3 * s, by - 6.5 * s, 1.6 * s, 2 * s); ctx.fillRect(bx + 1.4 * s, by - 6.5 * s, 1.6 * s, 2 * s);
  // steam: one puff when quiet, up to 6 on a busy day
  const puffs = st.todayEvents ? Math.min(6, 1 + Math.floor(st.todayEvents / 8) + Math.floor(st.todayTokens / 200000)) : 0;
  const [sx, sy] = toScreen(cx + 0.2, cy, 0.62);
  for (let i = 0; i < puffs; i++) { const ph = (t / 1600 + i / puffs) % 1; ctx.fillStyle = `rgba(240,240,240,${0.5 * (1 - ph)})`; ctx.beginPath(); ctx.arc(sx + Math.sin(ph * 6 + i) * 3 * s, sy - ph * 26 * s, (2 + ph * 4) * s, 0, Math.PI * 2); ctx.fill(); }
}

// The control center: dark glass, a wall of screens (one status light per project), the owner's empty chair.
function drawControl(r, t) {
  const { x, y, w, d, h } = r, sel = openRoom === r.id, hov = hover === r.id, s = cam.z;
  poly([toScreen(x - 0.8, y - 0.8), toScreen(x + w + 0.8, y - 0.8), toScreen(x + w + 0.8, y + d + 0.8), toScreen(x - 0.8, y + d + 0.8)], "rgba(0,0,0,0.25)", sel ? "#f3d9a4" : null);
  // floor, the screen wall at the back, the chair
  poly([toScreen(x, y), toScreen(x + w, y), toScreen(x + w, y + d), toScreen(x, y + d)], hov ? "#1f2a38" : "#1a2330");
  poly([toScreen(x, y), toScreen(x + w, y), toScreen(x + w, y, h), toScreen(x, y, h)], "#121922");
  const ps = projects.filter((p) => !p.isHr);
  ps.forEach((p, i) => {
    const col = i % 4, row = Math.floor(i / 4), sx = x + 0.3 + col * 1.15, z0 = 0.5 + row * 0.75;
    const c = p.paused ? "rgba(120,120,120,0.5)" : p.busy ? `rgba(125,220,138,${0.75 + 0.2 * Math.sin(t / 400 + i)})` : p.link?.linked ? "rgba(110,168,255,0.7)" : "rgba(240,180,90,0.7)";
    poly([toScreen(sx, y + 0.02, z0), toScreen(sx + 0.95, y + 0.02, z0), toScreen(sx + 0.95, y + 0.02, z0 + 0.6), toScreen(sx, y + 0.02, z0 + 0.6)], c);
  });
  // the big centre screen: requests waiting for the owner
  const [mx, my] = toScreen(x + w / 2, y + 0.05, h - 0.35);
  ctx.fillStyle = inbox.length ? "#e05d5d" : "#7ddc8a"; ctx.font = `700 ${Math.max(10, 12 * s)}px system-ui`; ctx.textAlign = "center";
  ctx.fillText(inbox.length ? `${inbox.length} waiting for you` : "all clear", mx, my);
  // desk and the empty chair (it's yours)
  box(x + w / 2 - 0.8, y + d / 2 - 0.35, 1.6, 0.7, 0.45, "#2e3946", "#232c37", "#1d252e");
  box(x + w / 2 - 0.25, y + d / 2 + 0.55, 0.5, 0.5, 0.35, "#c94f4f", "#a33f3f", "#8c3636");
  box(x + w / 2 - 0.25, y + d / 2 + 0.95, 0.5, 0.1, 0.8, "#c94f4f", "#a33f3f", "#8c3636");
  // The dev corner (the owner's offer, 2026-11-09): hub-builder's desk by the front glass, its screen lit while it
  // works, with a small bot. the owner's own chair stays in the middle.
  const hubP = projects.find((p) => p.id === "hub"), dev = hubP?.desks.find((d2) => d2.id === "hub-builder");
  if (dev) {
    const last = hubP.lastByDesk[dev.id], on = last && Date.now() - Date.parse(last.startedAt) < ACTIVE_MS;
    const dx = x + 1.1, dy = y + d - 1.2;
    box(dx - 0.45, dy - 0.3, 0.9, 0.55, 0.42, "#8b6a4a", "#6d523a", "#5e4632");
    box(dx - 0.15, dy - 0.28, 0.4, 0.08, 0.32, on ? `rgba(140,220,255,${0.75 + 0.25 * Math.sin(t / 180)})` : "#2c3440", "#1d232c", "#161b22", 0.42);
    const [bx, by] = toScreen(dx, dy + 0.55, 0), ss = cam.z * 1.2, bob = on ? Math.abs(Math.sin(t / 120)) * 2 : 0;
    ctx.fillStyle = PROVIDER.claude; roundRect(bx - 6 * ss, by - (20 + bob) * ss, 12 * ss, 14 * ss, 4 * ss); ctx.fill();
    ctx.fillStyle = "#f4ecdc"; roundRect(bx - 7 * ss, by - (32 + bob) * ss, 14 * ss, 11 * ss, 4 * ss); ctx.fill();
    ctx.fillStyle = "#1b1f27"; ctx.fillRect(bx - 4 * ss, by - (28 + bob) * ss, 2.2 * ss, 2.6 * ss); ctx.fillRect(bx + 1.8 * ss, by - (28 + bob) * ss, 2.2 * ss, 2.6 * ss);
    if (cam.z > 0.6) { ctx.fillStyle = "rgba(233,228,216,0.75)"; ctx.font = `600 ${10 * cam.z}px system-ui`; ctx.textAlign = "center"; ctx.fillText("DEV", bx, by + 10 * cam.z); }
  }
  // glass walls (front and side), tinted, so the inside shows
  const glass = "rgba(140,190,240,0.13)", edge = "rgba(170,210,255,0.4)";
  poly([toScreen(x, y + d), toScreen(x + w, y + d), toScreen(x + w, y + d, h), toScreen(x, y + d, h)], glass, edge);
  poly([toScreen(x + w, y), toScreen(x + w, y + d), toScreen(x + w, y + d, h), toScreen(x + w, y, h)], glass, edge);
  poly([toScreen(x, y, h), toScreen(x + w, y, h), toScreen(x + w, y + d, h), toScreen(x, y + d, h)], "rgba(30,40,55,0.55)", edge);
  // a beacon on the roof that pulses while something waits for you
  const [bx, by] = toScreen(x + w / 2, y + d / 2, h + 0.4);
  ctx.fillStyle = inbox.length ? `rgba(255,120,110,${0.6 + 0.4 * Math.sin(t / 250)})` : "rgba(140,200,255,0.8)"; ctx.beginPath(); ctx.arc(bx, by, 4 * s, 0, Math.PI * 2); ctx.fill();
}

// ---------- the board meeting ----------
const meetingLive = () => { const m = data?.standup?.last; return !!m && Date.now() - Date.parse(m.at) < 20 * 60000; };
