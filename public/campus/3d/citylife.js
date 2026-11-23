// Campus 3D: City life (Living City lane L1, docs/campus-living-city.md). The 3D half of public/campus/citylife.js,
// which works out the facts (power levels, cones, hand-offs, late shifts, sun) once per poll and keeps the switches.
// Here: power poles and glowing lines (1), roadwork cones and a barrier (2), vans over the river bridges (3), the
// late-night lamps and light pools (4), the pet's sunbeam (6) and the breakroom diner (7). The morning commute (5) is
// plain walkers (people.js), so it needs nothing here.
// Cheap by design: everything is built on a poll (refresh), never per frame; per frame only moves what is built (vans),
// changes two or three shared material colours (the power flicker) and eases one decal. Instanced meshes and merged
// geometry, no textures, no allocation in update(). Each effect has its own switch and a lowest graphics level
// (quality.js TIERS[].effects); the City life menu and the tier both go through cityLife.on(id).
import * as THREE from "three";
import { mergeParts } from "./buildings.js";
import { paint, mats, box } from "./materials.js";

const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), d3 = new THREE.Vector3();
const PROVIDER = { claude: ["Claude", 0xe08a5a], gemini: ["Gemini", 0x6ea8ff], grok: ["Grok", 0xc9ccd4], mixed: ["Mixed AI", 0xb48cff], other: ["Other AI", 0x8fd18b] };
const C = (hex) => new THREE.Color(hex);
const unlit = (hex, extra = {}) => new THREE.MeshBasicMaterial({ color: hex, toneMapped: false, ...extra });

// opts: { campus, buildings (the placed buildings, userData.room), sign(parent, text, x, y, z, cls), avoid (circles [x,z,r] and rects to keep clear) }
export function makeCityLife3({ campus, buildings, sign, avoid = [] }) {
  const cl = window.cityLife;
  const group = new THREE.Group(); group.name = "citylife";
  const signs = []; // every label this module made (replaced on each refresh)
  const dropSigns = (list) => { for (const s of list) { s.removeFromParent(); s.element.remove(); } list.length = 0; };
  const label = (list, text, x, y, z) => list.push(sign(group, text, x, y, z, "small"));
  const doorOf3 = (r) => doorOf(r, 0.45); // people.js
  const lat = (r) => (r.face === "e" || r.face === "w" ? [0, 1] : [1, 0]); // along the front of a building

  // ---------- 1. Power grid ----------
  const grid = new THREE.Group(); grid.name = "grid"; group.add(grid);
  const gridSigns = [];
  const H = 1.25, WIRE_MAX = 3 * 40;
  const wireGeo = new THREE.BoxGeometry(1, 0.035, 0.035);
  const wireMat = { ok: unlit(0xffd278), near: unlit(0xffa21a), over: unlit(0xff5a4a) };
  const wires = Object.fromEntries(Object.entries(wireMat).map(([k, m]) => { const im = new THREE.InstancedMesh(wireGeo, m, WIRE_MAX); im.count = 0; im.frustumCulled = false; im.name = "wires-" + k; grid.add(im); return [k, im]; }));
  let poles = null;
  function buildGrid() {
    poles?.geometry.dispose(); poles?.removeFromParent(); poles = null; dropSigns(gridSigns);
    for (const im of Object.values(wires)) { im.count = 0; im.visible = false; }
    if (!cl.on("grid")) return;
    const L = cl.layout(), lv = L.nodes.map((n) => cl.level(n.room)), parts = [], used = new Set();
    const n = { ok: 0, near: 0, over: 0 };
    for (const [a, b] of L.links.slice(0, 40)) {
      used.add(a); used.add(b);
      const A = L.nodes[a], B = L.nodes[b], state = cl.worse(lv[a], lv[b]), sag = 0.22;
      for (let k = 0; k < 3; k++) {
        const t0 = k / 3, t1 = (k + 1) / 3, p = (t) => [A.px + (B.px - A.px) * t, H - sag * 4 * t * (1 - t), A.py + (B.py - A.py) * t];
        const [x0, y0, z0] = p(t0), [x1, y1, z1] = p(t1);
        d3.set(x1 - x0, y1 - y0, z1 - z0); const len = d3.length();
        q4.setFromUnitVectors(X, d3.normalize());
        wires[state].setMatrixAt(n[state]++, m4.compose(v3.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), q4, s3.set(len, 1, 1)));
      }
    }
    for (const k of Object.keys(wires)) { wires[k].count = n[k]; wires[k].visible = n[k] > 0; wires[k].instanceMatrix.needsUpdate = true; }
    for (const i of used) { const nd = L.nodes[i]; parts.push(box(0.07, H, 0.07, nd.px, H / 2, nd.py, C(0x6b5a48), 0), box(0.4, 0.05, 0.05, nd.px, H - 0.04, nd.py, C(0x6b5a48), 0)); }
    if (parts.length) { poles = new THREE.Mesh(mergeParts(parts), mats.painted()); poles.name = "poles"; grid.add(poles); }
    // a word as well as the flicker, so it never rests on colour alone
    L.nodes.forEach((nd, i) => { if (lv[i] === "ok") return; label(gridSigns, lv[i] === "over" ? "⚡ low power: over its cap" : "⚡ near its cap", nd.room.x + nd.room.w / 2, nd.room.h ? Math.min(nd.room.h, 2.4) : 1.8, nd.room.y + nd.room.d + 0.3); });
  }

  // ---------- 2. Roadwork cones ----------
  const cones = new THREE.Group(); cones.name = "cones"; group.add(cones);
  const coneSigns = [];
  const coneGeo = mergeParts([
    box(0.26, 0.025, 0.26, 0, 0.0125, 0, C(0x2f2f33), 0),
    paint(new THREE.ConeGeometry(0.1, 0.36, 10).translate(0, 0.205, 0), C(0xf08a1c)),
    paint(new THREE.CylinderGeometry(0.066, 0.078, 0.07, 10).translate(0, 0.15, 0), C(0xf4f1ea)),
  ]);
  const barParts = [box(0.04, 0.4, 0.04, -0.46, 0.2, 0, C(0x4a4d55), 0), box(0.04, 0.4, 0.04, 0.46, 0.2, 0, C(0x4a4d55), 0)];
  for (let i = 0; i < 5; i++) barParts.push(box(0.18, 0.12, 0.05, -0.36 + i * 0.18, 0.36, 0, C(i % 2 ? 0xf4f1ea : 0xd93a30), 0));
  const barGeo = mergeParts(barParts);
  const coneMesh = new THREE.InstancedMesh(coneGeo, mats.painted(), 120), barMesh = new THREE.InstancedMesh(barGeo, mats.painted(), 40);
  for (const im of [coneMesh, barMesh]) { im.count = 0; im.frustumCulled = false; cones.add(im); }
  function buildCones() {
    dropSigns(coneSigns); coneMesh.count = barMesh.count = 0; coneMesh.visible = barMesh.visible = false;
    if (!cl.on("cones")) return;
    const w = cl.world(); if (!w) return;
    let nc = 0, nb = 0;
    for (const bld of buildings) {
      const r = bld.userData.room; if (!r || r.isHouse || r.isHomes) continue;
      const ids = cl.roomIdsOf(r), list = ids.map((id) => w.cones.get(id)).filter(Boolean);
      if (!list.length || nb >= 40) continue;
      const n = Math.min(3, list.reduce((a, c) => a + c.n, 0)), why = list.flatMap((c) => c.why)[0];
      const [dx, dz] = doorOf3(r), [ux, uz] = lat(r), ry = ux ? 0 : Math.PI / 2;
      for (let i = 0; i < n && nc < 120; i++) coneMesh.setMatrixAt(nc++, m4.compose(v3.set(dx - ux * (0.85 + i * 0.38), 0.03, dz - uz * (0.85 + i * 0.38)), q4.identity(), s3.setScalar(1.25)));
      barMesh.setMatrixAt(nb++, m4.compose(v3.set(dx + ux * 1.5, 0.03, dz + uz * 1.5), q4.setFromAxisAngle(Y, ry), s3.setScalar(1.2)));
      label(coneSigns, `🚧 ${why}`, dx + ux * 0.2, 0.9, dz + uz * 0.2 + 0.3);
    }
    coneMesh.count = nc; barMesh.count = nb; coneMesh.visible = barMesh.visible = nc > 0; coneMesh.instanceMatrix.needsUpdate = barMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- 3. Bridge traffic ----------
  const traffic = new THREE.Group(); traffic.name = "traffic"; group.add(traffic);
  const R = campus.river, bridges = campus.bridges || [], VMAX = 5;
  // The quad layout has no river bridges (its river runs behind the homes): there the vans drive the ring road the other way round from the tram.
  const rg = !bridges.length && campus.ring ? (() => { const g = campus.ring, i = Math.max(0.3, g.street / 2 - 0.45); return { x0: g.x0 + i, z0: g.y0 + i, x1: g.x1 - i, z1: g.y1 - i }; })() : null;
  const vanGeo = mergeParts([
    box(0.86, 0.36, 0.46, 0, 0.3, 0, C(0xffffff), 0.06), box(0.4, 0.26, 0.44, 0.22, 0.58, 0, C(0xfaf7ee), 0.05),
    box(0.04, 0.16, 0.36, 0.43, 0.6, 0, C(0x2b3646), 0), box(0.5, 0.05, 0.5, -0.12, 0.5, 0, C(0xc9c3b4), 0.02),
    ...[-0.28, 0.3].flatMap((x) => [-0.24, 0.24].map((z) => paint(new THREE.CylinderGeometry(0.1, 0.1, 0.07, 10).rotateX(Math.PI / 2).translate(x, 0.1, z), C(0x24272d)))),
  ]);
  const vanMesh = new THREE.InstancedMesh(vanGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), VMAX);
  vanMesh.count = 0; vanMesh.frustumCulled = false; vanMesh.name = "vans"; traffic.add(vanMesh);
  const vans = []; // { bridge, phase, anchor, sign }
  const trafficSigns = [];
  function buildVans() {
    dropSigns(trafficSigns); vans.length = 0; vanMesh.count = 0; vanMesh.visible = false;
    if (!cl.on("vans") || (!bridges.length && !rg)) return;
    const w = cl.world(); if (!w) return;
    w.hand.slice(0, VMAX).forEach((h, i) => {
      const [name, hex] = PROVIDER[h.provider] || (h.provider && h.provider !== "other" ? [h.provider.charAt(0).toUpperCase() + h.provider.slice(1), PROVIDER.other[1]] : PROVIDER.other); // the label names it even when the colour is shared
      vanMesh.setColorAt(i, C(hex));
      let seed = 0; for (const ch of String(h.id)) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
      const s = sign(group, `${name} · hand-off to ${h.toName}${h.of ? ` (step ${h.step}/${h.of})` : ""}`, 0, 1.0, 0, "small");
      trafficSigns.push(s);
      vans.push({ b: bridges.length ? bridges[seed % bridges.length] : null, phase: bridges.length ? (seed % 17) * 1.3 : (seed % 97) * 0.9, sign: s });
    });
    if (vanMesh.instanceColor) vanMesh.instanceColor.needsUpdate = true;
    vanMesh.count = vans.length; vanMesh.visible = vans.length > 0;
  }
  function moveVans(t) {
    if (!vans.length) return;
    if (rg) { // round the ring road, anticlockwise
      const L1 = rg.x1 - rg.x0, L2 = rg.z1 - rg.z0, per = 2 * (L1 + L2);
      for (let i = 0; i < vans.length; i++) {
        const v = vans[i]; let u = (t / 1000 * 1.3 + v.phase) % per, x, z, ry;
        if (u < L2) { x = rg.x0; z = rg.z0 + u; ry = -Math.PI / 2; }
        else if ((u -= L2) < L1) { x = rg.x0 + u; z = rg.z1; ry = 0; }
        else if ((u -= L1) < L2) { x = rg.x1; z = rg.z1 - u; ry = Math.PI / 2; }
        else { u -= L2; x = rg.x1 - u; z = rg.z0; ry = Math.PI; }
        vanMesh.setMatrixAt(i, m4.compose(v3.set(x, 0.07, z), q4.setFromAxisAngle(Y, ry), s3.set(1, 1, 1)));
        v.sign.position.set(x, 1.0, z);
      }
      vanMesh.instanceMatrix.needsUpdate = true;
      return;
    }
    const z0 = R.y - 1.3, z1 = R.y + R.d + 1.3, len = z1 - z0, sp = 1.1;
    for (let i = 0; i < vans.length; i++) {
      const v = vans[i], u = (t / 1000 * sp + v.phase) % (2 * len), fwd = u < len, z = fwd ? z0 + u : z1 - (u - len);
      const x = v.b.x + (fwd ? 1 : -1) * Math.min(v.b.w / 2 - 0.35, 0.22 * v.b.w);
      vanMesh.setMatrixAt(i, m4.compose(v3.set(x, 0.07, z), q4.setFromAxisAngle(Y, fwd ? -Math.PI / 2 : Math.PI / 2), s3.set(1, 1, 1)));
      v.sign.position.set(x, 1.0, z);
    }
    vanMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- 4. Late-night shift: a lamp in the working floor's window and a pool of light at the door ----------
  const shift = new THREE.Group(); shift.name = "shift"; group.add(shift);
  const shiftSigns = [];
  const lampGeo = mergeParts([
    paint(new THREE.CylinderGeometry(0.02, 0.03, 0.12, 6).translate(0, 0.06, 0), C(0xfff0c8)),
    paint(new THREE.ConeGeometry(0.1, 0.1, 8).translate(0, 0.16, 0), C(0xffe39a)),
  ]);
  const lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const poolMat = unlit(0xffc870, { transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false });
  const lampMesh = new THREE.InstancedMesh(lampGeo, lampMat, 40), poolMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), poolMat, 80);
  for (const im of [lampMesh, poolMesh]) { im.count = 0; im.frustumCulled = false; shift.add(im); }
  poolMesh.renderOrder = 3;
  function buildShift() {
    dropSigns(shiftSigns); lampMesh.count = poolMesh.count = 0; lampMesh.visible = poolMesh.visible = false;
    if (!cl.on("night")) return;
    const w = cl.world(); if (!w || !w.shift.size) return;
    let nl = 0, np = 0;
    for (const bld of buildings) {
      const r = bld.userData.room, sh = r && w.shift.get(r.id); if (!sh || nl >= 40) continue;
      lampMesh.setMatrixAt(nl++, m4.compose(v3.set(r.x + r.w * 0.28, 0.5 + sh.floor * 1.5, r.y + r.d + 0.05), q4.identity(), s3.setScalar(1.3)));
      const [dx, dz] = doorOf3(r);
      poolMesh.setMatrixAt(np++, m4.compose(v3.set(dx, 0.075, dz), q4.identity(), s3.set(1.1, 1, 0.8)));
      poolMesh.setMatrixAt(np++, m4.compose(v3.set(dx, 0.08, dz), q4.identity(), s3.set(0.6, 1, 0.45)));
      label(shiftSigns, `🌙 ${sh.n} working after hours`, dx, 1.6 + sh.floor * 0.3, dz + 0.2);
    }
    lampMesh.count = nl; poolMesh.count = np; lampMesh.visible = poolMesh.visible = nl > 0; lampMesh.instanceMatrix.needsUpdate = poolMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- 6. the pet's sunbeam: a warm soft patch under him, only on clear days, by day, outdoors ----------
  const beam = new THREE.Group(); beam.name = "sunbeam"; beam.visible = false; group.add(beam);
  const beamMat = unlit(0xffd95e, { transparent: true, opacity: 0.16, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, vertexColors: true });
  // three soft discs, one inside the next, merged into ONE draw (where they overlap the patch is warmer in the middle)
  const beamDisc = mergeParts([1.9, 1.35, 0.8].map((r) => paint(new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2).scale(r, 1, r * 0.62), C(0xffffff))));
  { const m = new THREE.Mesh(beamDisc, beamMat); m.renderOrder = 2; m.frustumCulled = false; beam.add(m); }
  let bx = 0, bz = 0, bk = 0;

  // ---------- 7. Breakroom diner: counter, stools, a striped awning; the idle ones sit at it by day ----------
  const diner = new THREE.Group(); diner.name = "diner"; group.add(diner);
  const dinerSigns = [];
  let spot = null, patrons = [];
  const SEATS = 6, HW = 1.9, HD = 1.5;
  function pickSpot() {
    const sq = campus.square, c0 = campus.lawn && campus.lawn.d > 2.5 ? [campus.lawn.x + campus.lawn.w / 2, campus.lawn.y + campus.lawn.d / 2] : sq ? [sq.x, sq.y] : null;
    if (!c0) return null;
    const rooms_ = typeof rooms !== "undefined" ? rooms : [], V = campus.village, inR = (x, z, q, m) => x + HW > q.x - m && x - HW < q.x + q.w + m && z + HD > q.y - m && z - HD < q.y + q.d + m;
    const ok = (x, z) => {
      if (rooms_.some((r) => inR(x, z, r, 0.8))) return false;
      if ((campus.towers || []).some((t) => inR(x, z, t, 0.8))) return false;
      if (R && z + HD > R.y - 0.9 && z - HD < R.y + R.d + 0.9) return false;
      if (sq && Math.hypot(x - sq.x, z - sq.y) < 3.6 + Math.max(HW, HD)) return false;
      if (V && x + HW > V.x0 - V.road - 0.6 && x - HW < V.x1 + V.road + 0.6 && z + HD > V.y0 - V.road - 0.6 && z - HD < V.y1 + V.road + 0.6) return false;
      if (campus.roads.some((q) => !["plaza-row", "quad", "concourse"].includes(q.kind) && inR(x, z, q, 0.3))) return false;
      if (campus.clock && Math.hypot(x - campus.clock.x, z - campus.clock.y) < 2.4) return false;
      return !avoid.some((o) => (o[0] === "rect" ? x + HW > o[1] - 0.3 && x - HW < o[1] + o[3] + 0.3 && z + HD > o[2] - 0.3 && z - HD < o[2] + o[4] + 0.3 : Math.hypot(x - o[1], z - o[2]) < o[3] + Math.max(HW, HD) * 0.8));
    };
    if (campus.lawn && ok(c0[0], c0[1])) return c0;
    for (let rad = 4; rad <= 16; rad += 1.1) for (let k = 0; k < 18; k++) { const a = (k / 18) * Math.PI * 2 + 0.5, x = c0[0] + Math.cos(a) * rad, z = c0[1] + Math.sin(a) * rad; if (ok(x, z)) return [x, z]; }
    return null;
  }
  function buildDiner(at) {
    spot = at; const [cx, cz] = at, parts = [], cream = C(0xece0c4), brick = C(0xb9663f), wood = C(0x8a5a38), stripeA = C(0xd93a30), stripeB = C(0xf6f1e4);
    parts.push(box(HW * 2, 0.06, HD * 2, cx, 0.03, cz, C(0xd7cdb4), 0), box(HW * 2, 1.5, 0.1, cx, 0.78, cz - HD + 0.2, cream, 0.02), box(0.1, 1.5, 1.6, cx - HW + 0.1, 0.78, cz - 0.2, cream, 0.02), box(0.1, 1.5, 1.6, cx + HW - 0.1, 0.78, cz - 0.2, cream, 0.02));
    parts.push(box(HW * 2 + 0.2, 0.09, HD * 1.55, cx, 1.56, cz - 0.15, brick, 0.03));
    for (let i = 0; i < 8; i++) parts.push(box((HW * 2 + 0.2) / 8, 0.16, 0.5, cx - HW - 0.1 + ((HW * 2 + 0.2) / 8) * (i + 0.5), 1.46, cz + HD * 0.62 + 0.25, i % 2 ? stripeB : stripeA, 0.02)); // the awning
    for (const sx of [-1, 1]) parts.push(box(0.07, 1.5, 0.07, cx + sx * (HW - 0.08), 0.78, cz + HD * 0.62 + 0.4, C(0x4a4d55), 0));
    parts.push(box(HW * 1.5, 0.5, 0.36, cx, 0.31, cz + 0.12, wood, 0.03), box(HW * 1.5 + 0.1, 0.05, 0.42, cx, 0.58, cz + 0.12, C(0xe9e4d6), 0.02));
    parts.push(box(HW * 0.9, 0.4, 0.06, cx, 1.0, cz - HD + 0.3, C(0x2b3646), 0)); // the menu board on the back wall
    for (let i = 0; i < SEATS; i++) { const sx = cx + (i - (SEATS - 1) / 2) * 0.46; parts.push(paint(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 6).translate(sx, 0.17, cz + 0.72), C(0x4a4d55)), paint(new THREE.CylinderGeometry(0.12, 0.12, 0.07, 10).translate(sx, 0.31, cz + 0.72), stripeA)); }
    const m = new THREE.Mesh(mergeParts(parts), mats.painted()); m.name = "diner"; m.castShadow = true; m.receiveShadow = true; diner.add(m);
  }
  const SEAT_Z = 0.72;
  function buildPatrons() {
    dropSigns(dinerSigns); patrons = [];
    if (!spot) return;
    const open = !afterHours(), want = cl.on("diner");
    diner.visible = want;
    if (!want) return;
    const w = cl.world();
    patrons = open && w ? w.idle.slice(0, SEATS) : []; // desk ids (the figures are looked up as they are drawn)
    label(dinerSigns, `🍔 Breakroom diner · ${open ? (patrons.length ? `${patrons.length}${w.idleN > SEATS ? ` of ${w.idleN}` : ""} on a break` : "empty") : "closed for the night"}`, spot[0], 2.15, spot[1] + 0.1);
  }

  // ---------- the public bits ----------
  function visible() {
    grid.visible = cl.on("grid"); cones.visible = cl.on("cones"); traffic.visible = cl.on("vans"); shift.visible = cl.on("night"); diner.visible = cl.on("diner") && !!spot;
  }
  const refresh = () => { buildGrid(); buildCones(); buildVans(); buildShift(); buildPatrons(); visible(); };
  const first = pickSpot(); if (first) buildDiner(first);
  let pollRev = -1, pollW = null, lastCheck = -9999, lastSun = -9999, sunOn = false, sunK = 0, sunF = 0.5;
  return {
    group, spot: () => spot, patronCount: () => patrons.length,
    // The area the diner takes (a nav obstacle, so people walk round it)
    footprint: () => (spot ? ["rect", spot[0] - HW - 0.2, spot[1] - HD - 0.2, HW * 2 + 0.4, HD * 2 + 0.4] : null),
    refresh,
    // each frame (cheap): the poll's changes, the power flicker, vans, the lamps' glow, the sunbeam
    update(t, night, dt) {
      if (t - lastCheck > 1000 || cl.rev !== pollRev) { // once a second: did a poll, a switch or the graphics level change anything?
        lastCheck = t; const w = cl.world();
        if (cl.rev !== pollRev || w !== pollW) { pollRev = cl.rev; pollW = w; refresh(); }
      }
      if (grid.visible) {
        wireMat.ok.color.setHex(0xffd278).multiplyScalar(0.7 + 0.6 * night);
        wireMat.near.color.setHex(0xffa21a).multiplyScalar(0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t / 500)));
        wireMat.over.color.setHex(0xff5a4a).multiplyScalar(Math.sin(t / 60) + Math.sin(t / 23) > 0.2 ? 1.15 : 0.1);
      }
      if (traffic.visible) moveVans(t);
      shift.visible = cl.on("night") && night > 0.3; // the lamps come on with the dark
      if (shift.visible) poolMat.opacity = 0.34 * Math.min(1, (night - 0.3) / 0.4);
      if (t - lastSun > 500) { lastSun = t; const q = cl.sun(); sunOn = q.on; sunK = q.k; sunF = q.f; } // (twice a second is plenty for the sun)
      bk += ((sunOn ? sunK : 0) - bk) * Math.min(1, dt * 1.5);
      if (bk > 0.02 && typeof rex !== "undefined" && rex.x != null) {
        if (!beam.visible) { bx = rex.x; bz = rex.y; }
        bx += (rex.x - bx) * Math.min(1, dt * 2); bz += (rex.y - bz) * Math.min(1, dt * 2);
        beam.visible = true; beam.position.set(bx + (0.5 - sunF) * 0.6, 0.085, bz); beamMat.opacity = 0.2 * bk;
        const br = 1 + 0.04 * Math.sin(t / 1800); beam.scale.set(br, 1, br);
      } else beam.visible = false;
    },
    // between crowd.begin() and crowd.end(): the idle ones on the diner's stools
    drawPatrons(crowd, t) {
      if (!spot || !diner.visible || !patrons.length || (typeof view !== "undefined" && view)) return;
      patrons.forEach((id, i) => { const d = deskById(id); if (d) crowd.add(d, spot[0] + (i - (SEATS - 1) / 2) * 0.46, 0.3, spot[1] + SEAT_Z, Math.PI, { sit: true }, t); });
    },
    dispose() { for (const l of [signs, gridSigns, coneSigns, trafficSigns, shiftSigns, dinerSigns]) dropSigns(l); wireGeo.dispose(); coneGeo.dispose(); barGeo.dispose(); vanGeo.dispose(); lampGeo.dispose(); beamDisc.dispose(); poles?.geometry.dispose(); diner.traverse((o) => o.geometry?.dispose?.()); },
  };
}
