// Campus 3D: buildings and stacked towers. Coordinates follow the brief: one tile is one unit, model (x, y, z)
// is three.js (X = x, Z = y, Y = z), and a storey is FLOOR_H = 1.5 like public/campus/core.js. A building's
// group origin is its min corner (the same corner as a room's x, y in core.js layout()), so place it with
// group.position.set(room.x, 0, room.y).
// Draw calls per building: 1 for the merged body (walls, slab bands, roof, roof garden) and 1 for the windows
// (one InstancedMesh with a colour per instance). Checked against three r160.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { paint, palette, hsl, COLORS, mats, bakeGroundAO, box, std } from "./materials.js";
import { hasKit, kitGeo, kitParts } from "./kit.js";

export const FLOOR_H = 1.5;
const BAND = 0.16;            // slab band at the top of each storey
const WIN_W = 0.52, WIN_H = 0.72, WIN_STEP = 1.05;

const DAY_GLASS = new THREE.Color(0x5d7a96);
const DAY_GLASS_LIT = new THREE.Color(0x9cc4e4);
const NIGHT_GLASS = new THREE.Color(0x18202e);
const WARM = new THREE.Color(0xffc970);
const tmp = new THREE.Color();

// The roof: a parapet slab, a little garden bed with bushes, and a rooftop unit. y0 = top of the walls.
function roofParts(w, d, y0, pal, seed = 0) {
  const parts = [
    box(w + 0.14, 0.14, d + 0.14, w / 2, y0 + 0.07, d / 2, pal.roof),
    box(w * 0.42, 0.12, d * 0.36, w * 0.32, y0 + 0.2, d * 0.3, COLORS.roofGarden),
  ];
  for (let i = 0; i < 3; i++) {
    const b = new THREE.IcosahedronGeometry(0.17 + 0.05 * ((i + seed) % 2), 0);
    b.translate(w * (0.18 + i * 0.12), y0 + 0.4, d * (0.22 + ((i + seed) % 2) * 0.14));
    parts.push(paint(b, i % 2 ? COLORS.leaf : COLORS.leafDark));
  }
  parts.push(box(0.7, 0.42, 0.55, w * 0.72, y0 + 0.35, d * 0.7, new THREE.Color(0xb8b4ab)));
  parts.push(box(0.12, 0.9, 0.12, w * 0.82, y0 + 0.6, d * 0.28, COLORS.metal));
  return parts;
}

// Window slots for one storey: positions around all four walls (so snap-rotation later still shows them).
function windowSlots(w, d, floor) {
  const slots = [];
  const y = floor * FLOOR_H + (FLOOR_H - BAND) / 2 + 0.02;
  const along = (len) => { const n = Math.max(1, Math.floor((len - 0.6) / WIN_STEP)); const pad = (len - (n - 1) * WIN_STEP) / 2; return Array.from({ length: n }, (_, i) => pad + i * WIN_STEP); };
  const o = 0.03;
  for (const [side, len] of [["south", w], ["north", w], ["east", d], ["west", d]]) {
    along(len).forEach((t, index) => {
      let x, z, ry = 0;
      if (side === "south") { x = t; z = d + o; }
      else if (side === "north") { x = t; z = -o; }
      else if (side === "east") { x = w + o; z = t; ry = Math.PI / 2; }
      else { x = -o; z = t; ry = Math.PI / 2; }
      slots.push({ floor, side, index, x, y, z, ry });
    });
  }
  return slots;
}

// Window shapes are shared, so main3d.js can batch every building's windows of one shape into one draw.
const PANE_GEO = new THREE.BoxGeometry(WIN_W, WIN_H, 0.05);
// One InstancedMesh for every window of a building; returns { mesh, slots, setWindows, setNight }.
// look: the colours (day, day lit, night, night lit); the glass offices use ceiling light strips (STRIP).
function makeWindows(slots, geo = PANE_GEO, look = null) {
  const DG = look?.day || DAY_GLASS, DL = look?.dayLit || DAY_GLASS_LIT, NG = look?.night || NIGHT_GLASS, W = look?.warm || WARM;
  const mesh = new THREE.InstancedMesh(geo, mats.glass(), slots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  slots.forEach((sl, i) => {
    q.setFromEuler(e.set(0, sl.ry, 0)); p.set(sl.x, sl.y, sl.z); s.set(sl.sx || 1, sl.sy || 1, 1); // houses use smaller panes
    mesh.setMatrixAt(i, m.compose(p, q, s));
    mesh.setColorAt(i, DG);
  });
  const lit = new Float32Array(slots.length);
  let night = 0;
  const paintAll = () => {
    slots.forEach((sl, i) => {
      // Day: dark glass, a little brighter where someone's in. Night: dark, or warm where it's lit.
      tmp.copy(DG).lerp(DL, lit[i] * 0.5).lerp(NG, night).lerp(W, lit[i] * night);
      mesh.setColorAt(i, tmp);
    });
    mesh.instanceColor.needsUpdate = true;
  };
  return {
    mesh, slots,
    // fn(slot) -> 0..1 how lit that window is ({ floor, side, index }). Busy floors light up warm at night.
    setWindows(fn) { slots.forEach((sl, i) => { lit[i] = Math.min(1, Math.max(0, Number(fn(sl)) || 0)); }); paintAll(); },
    setNight(n) { night = n; paintAll(); },
  };
}

// mergeGeometries needs all parts indexed or none (polyhedra are non-indexed), so flatten them all.
export function mergeParts(parts) {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat);
  for (const g of new Set([...parts, ...flat])) g.dispose();
  return merged;
}

function finish(group, bodyParts, slots, pickBoxes, extra = {}) {
  const body = new THREE.Mesh(bakeGroundAO(mergeParts(bodyParts)), mats.painted());
  body.castShadow = body.receiveShadow = true;
  body.name = "body";
  group.add(body);
  const more = [];
  if (extra.glass?.length) { const m = new THREE.Mesh(mergeParts(extra.glass), glassMat()); m.name = "glass"; m.renderOrder = 2; group.add(m); more.push(m); }
  if (extra.neon?.length) { const m = new THREE.Mesh(mergeParts(extra.neon), neonMat()); m.name = "neon"; group.add(m); more.push(m); }
  const win = makeWindows(slots, extra.winGeo, extra.winLook);
  win.mesh.name = "windows";
  group.add(win.mesh);
  for (const pb of pickBoxes) group.add(pb);
  group.setWindows = win.setWindows;
  group.setNight = win.setNight;
  group.windowSlots = slots;
  group.dispose = () => { body.geometry.dispose(); win.mesh.dispose(); for (const m of more) m.geometry.dispose(); for (const pb of pickBoxes) pb.geometry.dispose(); }; // window shapes are shared
  return group;
}

function pickBox(w, h, d, x, y, z, userData) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.pick());
  m.position.set(x, y, z);
  m.userData = userData;
  m.name = "pick";
  return m;
}

const hashStr = (id) => { let h = 7; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
// Facade details (overnight polish, 2026-11-09): an entrance canopy on two posts with a step, a striped awning band
// along the ground floor's front, corner pilasters and a cornice under the roof, so offices read as buildings, not boxes.
function facadeParts(w, d, floors, pal, seed) {
  const parts = [], top = floors * FLOOR_H, stripe = seed % 2 ? pal.accent : pal.trim;
  parts.push(box(1.3, 0.08, 0.7, w / 2, 1.12, d + 0.35, pal.trim, 0.03));
  for (const x of [w / 2 - 0.58, w / 2 + 0.58]) parts.push(box(0.07, 1.08, 0.07, x, 0.56, d + 0.66, pal.band, 0.02));
  parts.push(box(1.1, 0.06, 0.4, w / 2, 0.03, d + 0.2, new THREE.Color(0xcfc7b4), 0.02));
  // awning: alternating stripes across the front, either side of the canopy
  const n = Math.max(2, Math.floor((w - 1.6) / 0.5));
  for (let i = 0; i < n; i++) { const x = 0.25 + i * ((w - 0.5) / n) + (w - 0.5) / n / 2; if (Math.abs(x - w / 2) < 0.75) continue; const g = new THREE.BoxGeometry((w - 0.5) / n, 0.05, 0.36); g.rotateX(0.35); g.translate(x, 1.3, d + 0.16); parts.push(paint(g, i % 2 ? stripe : new THREE.Color(0xf3eee2))); }
  for (const [x, z] of [[0, 0], [w, 0], [0, d], [w, d]]) parts.push(box(0.16, top, 0.16, x, top / 2, z, pal.band, 0.03));
  parts.push(box(w + 0.24, 0.12, d + 0.24, w / 2, top - 0.06, d / 2, pal.band, 0.03));
  return parts;
}
// Roof variety: by the building's id, a water tower on legs, a row of solar panels, or a satellite dish.
function roofTop(w, d, y0, seed) {
  const parts = [], kind = seed % 3, metal = new THREE.Color(0x6d737c);
  if (kind === 0) {
    const x = w * 0.28, z = d * 0.72;
    for (const [dx, dz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) parts.push(box(0.05, 0.6, 0.05, x + dx, y0 + 0.44, z + dz, metal, 0));
    const tank = new THREE.CylinderGeometry(0.42, 0.42, 0.6, 14); tank.translate(x, y0 + 1.04, z); parts.push(paint(tank, new THREE.Color(0x9b6a4a)));
    const cap = new THREE.ConeGeometry(0.46, 0.3, 14); cap.translate(x, y0 + 1.49, z); parts.push(paint(cap, new THREE.Color(0x6e4c38)));
  } else if (kind === 1) {
    for (let i = 0; i < 3; i++) { const g = new THREE.BoxGeometry(0.7, 0.04, 0.45); g.rotateX(-0.45); g.translate(w * 0.25 + i * 0.78 - 0.2, y0 + 0.36, d * 0.72); parts.push(paint(g, new THREE.Color(0x26344a))); parts.push(box(0.05, 0.22, 0.05, w * 0.25 + i * 0.78 - 0.2, y0 + 0.22, d * 0.72 + 0.12, metal, 0)); }
  } else {
    const dish = new THREE.SphereGeometry(0.32, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.6); dish.rotateX(Math.PI * 0.7); dish.translate(w * 0.3, y0 + 0.55, d * 0.7); parts.push(paint(dish, new THREE.Color(0xe8e6e0)));
    parts.push(box(0.06, 0.4, 0.06, w * 0.3, y0 + 0.3, d * 0.7, metal, 0));
  }
  return parts;
}
// ---------- glass offices (visual rehaul 2026-11-13, after towers.app) ----------
// Every storey is a stone slab, a ring of thin mullions and full-height glass, and you can see the floor through it:
// the lift core in the project's colour at the back, rows of desks with screens (one per real desk on that floor, at
// least three), plants in the corners, and ceiling light strips that glow warm at night when someone on that floor is
// working (they're the "windows" slots, so litWindows() and the batching in main3d.js still work). userData.seats[floor]
// says where main3d.js sits the workers who are at their desks right now.
const STRIP = new THREE.BoxGeometry(0.8, 0.03, 0.5);
const STRIP_LOOK = { day: new THREE.Color(0xf6f3ea), dayLit: new THREE.Color(0xfffaf0), night: new THREE.Color(0x232a36), warm: new THREE.Color(0xffd08a) };
const shared = new Map();
function glassMat() { if (!shared.has("glass")) shared.set("glass", std({ vertexColors: true, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0, envMapIntensity: 0.9, depthWrite: false })); return shared.get("glass"); }
function neonMat() { if (!shared.has("neon")) shared.set("neon", new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })); return shared.get("neon"); }
// Styles by district: slab, slab edge, mullions, inside floor, glass tint.
export const STYLES = {
  stone: { slab: 0xe9e3d6, edge: 0xd6cdbb, mull: 0x3a3f47, floor: 0xd8c3a0, glass: 0x9cc3dc },
  brick: { slab: 0xb4654a, edge: 0x9a523b, mull: 0x2a2a2d, floor: 0xc79b6c, glass: 0xa9c6d6 },
  graphite: { slab: 0x535a66, edge: 0x3f4550, mull: 0x1f232a, floor: 0x9aa0ae, glass: 0x8fb4d6, neon: true },
  sand: { slab: 0xe6d3aa, edge: 0xcdb586, mull: 0x7a5a32, floor: 0xd8b98c, glass: 0xb5cfe0 },
};
// Kit pieces to merge into a body: every part except glow; tint parts painted `tint`.
function kitPart(name, x, y, z, ry = 0, s = 1, tint = COLORS.leaf) {
  if (!hasKit(name)) return [];
  const M = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(s, s, s));
  return kitParts(name).filter((k) => k !== "glow").map((k) => {
    const g = kitGeo(name, k).clone().applyMatrix4(M);
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); // merges with the boxes (which have UVs)
    if (k.startsWith("tint")) { const c = g.attributes.color; for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * tint.r, c.getY(i) * tint.g, c.getZ(i) * tint.b); }
    return g;
  });
}
// A kit prop split for merging: { solid: [geometries], glow: [geometries] } (tint parts painted `tint`). For interiors.
export function kitPieces(name, x, y, z, ry = 0, s = 1, tint = COLORS.leaf) {
  const out = { solid: [], glow: [] };
  if (!hasKit(name)) return out;
  const M = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(s, s, s));
  for (const k of kitParts(name)) {
    const g = kitGeo(name, k).clone().applyMatrix4(M);
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (k.startsWith("tint")) { const c = g.attributes.color; for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * tint.r, c.getY(i) * tint.g, c.getZ(i) * tint.b); }
    (k === "glow" ? out.glow : out.solid).push(g);
  }
  return out;
}
// The storeys of a glass office from y=0. floorsSpec [{ hue, desks }]; inset(f) steps a storey in (setbacks).
// Returns { parts, glass, neon, slots, seats, top, roofInset }.
function glassStoreys(w, d, floorsSpec, st, inset = () => 0) {
  const parts = [], glass = [], neon = [], slots = [], seats = [];
  const S = 0.16, H = FLOOR_H, glassC = new THREE.Color(st.glass), mullC = new THREE.Color(st.mull), slabC = new THREE.Color(st.slab), edgeC = new THREE.Color(st.edge), floorC = new THREE.Color(st.floor);
  const dark = new THREE.Color(0x1c2028), deskC = new THREE.Color(0xe8e4dc), chairC = new THREE.Color(0x3a3f4a), screen = new THREE.Color(0x2b3446), doors = new THREE.Color(0xb8bec6);
  floorsSpec.forEach((fl, f) => {
    const i0 = inset(f), x0 = i0, z0 = i0, W = w - i0 * 2, D = d - i0 * 2, y0 = f * H, pal = palette(fl.hue ?? 30);
    // the slab (its edge colour on the ground floor) and the floor finish
    parts.push(box(W + 0.12, S, D + 0.12, x0 + W / 2, y0 + S / 2, z0 + D / 2, f === 0 ? edgeC : slabC, 0.03));
    parts.push(box(W - 0.1, 0.02, D - 0.1, x0 + W / 2, y0 + S + 0.01, z0 + D / 2, floorC, 0));
    // the core at the back in the project's colour (it reads through the glass from far off), with lift doors
    const cw = Math.min(W * 0.34, 2.2), cd = Math.min(D * 0.26, 1.4);
    parts.push(box(cw, H - S, cd, x0 + W / 2, y0 + S + (H - S) / 2, z0 + 0.12 + cd / 2, pal.wall, 0.02));
    parts.push(box(0.5, 0.95, 0.02, x0 + W / 2, y0 + S + 0.48, z0 + 0.12 + cd + 0.01, doors, 0));
    // the Campus Mart: shelves of goods round the walls and a till counter, instead of desks
    if (fl.shop) {
      const goods = [0xe0604f, 0xf2c14e, 0x5fa8d3, 0x8fc15b, 0xc77dff, 0xf28c5a];
      for (const [sx, sz, sw, sd] of [[x0 + 0.3, z0 + D * 0.55, 0.36, D * 0.7], [x0 + W - 0.3, z0 + D * 0.55, 0.36, D * 0.7]]) {
        parts.push(box(sw, 1.0, sd, sx, y0 + S + 0.5, sz, deskC, 0.02));
        for (let r = 0; r < 3; r++) for (let k = 0; k < Math.floor(sd / 0.22); k++) parts.push(box(0.16, 0.16, 0.16, sx, y0 + S + 0.2 + r * 0.32, sz - sd / 2 + 0.12 + k * 0.22, new THREE.Color(goods[(r * 7 + k) % goods.length]), 0.02));
      }
      parts.push(box(1.2, 0.5, 0.5, x0 + W / 2, y0 + S + 0.25, z0 + D * 0.62, new THREE.Color(0xd8b48a), 0.03), box(0.3, 0.2, 0.2, x0 + W / 2 + 0.3, y0 + S + 0.6, z0 + D * 0.62, dark, 0.02));
      seats.push([]);
    } else {
    // desks in rows toward the front glass: one per desk on the floor (at least three), as many as fit
    const want = Math.max(3, fl.desks || 0), cols = Math.max(1, Math.floor((W - 0.8) / 0.85)), rowsZ = [D * 0.56, D * 0.8].filter((z) => z < D - 0.45), seatList = [];
    let placed = 0;
    for (const rz of rowsZ) for (let c = 0; c < cols && placed < want; c++, placed++) {
      const x = x0 + 0.4 + (c + 0.5) * ((W - 0.8) / cols), z = z0 + rz, yy = y0 + S;
      parts.push(box(0.62, 0.04, 0.34, x, yy + 0.44, z, deskC, 0.01));
      parts.push(box(0.04, 0.42, 0.3, x - 0.28, yy + 0.22, z, deskC, 0), box(0.04, 0.42, 0.3, x + 0.28, yy + 0.22, z, deskC, 0));
      parts.push(box(0.3, 0.19, 0.025, x, yy + 0.58, z - 0.08, dark, 0.005), box(0.27, 0.16, 0.01, x, yy + 0.58, z - 0.065, screen, 0));
      parts.push(box(0.26, 0.05, 0.24, x, yy + 0.28, z + 0.3, chairC, 0.02), box(0.26, 0.28, 0.05, x, yy + 0.44, z + 0.42, chairC, 0.02));
      seatList.push({ x, y: yy + 0.06, z: z + 0.24 });
    }
    seats.push(seatList);
    }
    parts.push(...kitPart("bush", x0 + 0.38, y0 + S, z0 + D - 0.38, f, 0.62, new THREE.Color(0x5f9a4c)), ...kitPart("bush", x0 + W - 0.38, y0 + S, z0 + 0.4, f + 1, 0.55, new THREE.Color(0x4f8a44)));
    // mullions round all four sides, the glass between the slabs, and the ceiling light strips just inside
    const sides = [["south", W, (t) => [x0 + t, z0 + D], 0], ["north", W, (t) => [x0 + t, z0], 0], ["east", D, (t) => [x0 + W, z0 + t], 1], ["west", D, (t) => [x0, z0 + t], 1]];
    for (const [side, len, at, rot] of sides) {
      const n = Math.max(2, Math.round(len / 0.95));
      for (let k = 0; k <= n; k++) { const [mx, mz] = at((k / n) * len); parts.push(box(0.06, H - S, 0.06, mx, y0 + S + (H - S) / 2, mz, mullC, 0)); }
      const [gx, gz] = at(len / 2);
      glass.push(box(rot ? 0.02 : len, H - S - 0.02, rot ? len : 0.02, gx, y0 + S + (H - S) / 2, gz, glassC, 0));
      for (let k = 0; k < n; k++) {
        const [lx, lz] = at(((k + 0.5) / n) * len), inX = side === "east" ? -0.4 : side === "west" ? 0.4 : 0, inZ = side === "south" ? -0.4 : side === "north" ? 0.4 : 0;
        slots.push({ floor: f, side, index: k, x: lx + inX, y: y0 + H - 0.03, z: lz + inZ, ry: rot ? Math.PI / 2 : 0 });
      }
    }
    // Games: a neon line in the project's colour along the slab edges facing the street
    if (st.neon) for (const [nw, nd, nx, nz] of [[W + 0.14, 0.03, x0 + W / 2, z0 + D + 0.065], [0.03, D + 0.14, x0 + W + 0.065, z0 + D / 2]]) neon.push(box(nw, 0.04, nd, nx, y0 + S - 0.03, nz, hsl(fl.hue ?? 30, 0.85, 0.6), 0));
  });
  // the roof slab and its parapet
  const top = floorsSpec.length * H, iT = inset(floorsSpec.length - 1), WT = w - iT * 2, DT = d - iT * 2;
  parts.push(box(WT + 0.12, 0.18, DT + 0.12, w / 2, top + 0.09, d / 2, slabC, 0.03));
  for (const [pw, pd, px, pz] of [[WT + 0.12, 0.08, w / 2, iT - 0.02], [WT + 0.12, 0.08, w / 2, d - iT + 0.02], [0.08, DT + 0.12, iT - 0.02, d / 2], [0.08, DT + 0.12, w - iT + 0.02, d / 2]]) parts.push(box(pw, 0.22, pd, px, top + 0.29, pz, edgeC, 0.01));
  return { parts, glass, neon, slots, seats, top: top + 0.18, roofInset: iT };
}
// Roof gear from the kit, varied by the building's id: AC units and a vent always, then a water tower, solar panels or
// an antenna, and a roof garden on wide roofs.
function roofKit(w, d, y, seed, inset = 0) {
  const out = [], X = (t) => inset + t * (w - inset * 2), Z = (t) => inset + t * (d - inset * 2);
  out.push(...kitPart("ac_unit", X(0.72), y, Z(0.3)), ...kitPart("vent", X(0.86), y, Z(0.6)), ...kitPart("ac_unit", X(0.56), y, Z(0.3)));
  const k = seed % 3;
  if (k === 0) out.push(...kitPart("water_tower", X(0.3), y, Z(0.35)));
  else if (k === 1) out.push(...kitPart("solar", X(0.38), y, Z(0.7)));
  else out.push(...kitPart("antenna", X(0.25), y, Z(0.3), 0, 1.2));
  if (w - inset * 2 > 4.2) out.push(...kitPart("roof_garden", X(0.36), y, Z(0.76), 0, 1, COLORS.leaf));
  return out;
}
// The front entrance (built facing +z): a canopy in the project's colours over a step.
function entrance(w, d, pal) {
  return [box(1.5, 0.08, 0.7, w / 2, 1.05, d + 0.35, pal.accent, 0.02), box(1.6, 0.04, 0.8, w / 2, 1.1, d + 0.35, pal.trim, 0.02), box(1.2, 0.04, 0.5, w / 2, 0.02, d + 0.25, new THREE.Color(0xcfc7b4), 0.01)];
}
const turnAbout = (w, d, turn) => new THREE.Matrix4().makeTranslation(w / 2, 0, d / 2).multiply(new THREE.Matrix4().makeRotationY(turn)).multiply(new THREE.Matrix4().makeTranslation(-w / 2, 0, -d / 2));
// The glass office. desks: desks per floor. setback: the top storeys step in (the CEO tower).
function makeGlassBuilding({ w, d, floors, hue, name, id, face, style, desks, setback, shop }) {
  const st = STYLES[style] || STYLES.stone, pal = palette(hue), seed = hashStr(id);
  const inset = (f) => (setback && floors > 3 ? (f >= floors - 2 ? 0.9 : f >= floors - 4 ? 0.45 : 0) : 0);
  const gs = glassStoreys(w, d, Array.from({ length: floors }, (_, f) => ({ hue, desks: desks[f] || 0, shop })), st, inset);
  const parts = [box(w + 0.5, 0.06, d + 0.5, w / 2, 0.03, d / 2, new THREE.Color(0xd6cfbf), 0.02), ...gs.parts, ...entrance(w, d, pal)];
  // a shop's striped awning all along its front
  if (shop) { const n = Math.max(4, Math.round(w / 0.4)); for (let i = 0; i < n; i++) { const g = new THREE.BoxGeometry(w / n, 0.05, 0.6); g.rotateX(0.35); g.translate((i + 0.5) * (w / n), 1.25, d + 0.28); parts.push(paint(g, i % 2 ? pal.accent : new THREE.Color(0xf6f1e6))); } }
  // the CEO tower: a gold spire with a beacon on top of its crown (main3d.js adds the crown)
  if (id === "control") { parts.push(box(0.16, 1.6, 0.16, w / 2, gs.top + 1.0 + 0.8, d / 2, new THREE.Color(0xd9a640), 0.03)); const c = new THREE.ConeGeometry(0.14, 0.5, 8); c.translate(w / 2, gs.top + 2.85, d / 2); parts.push(paint(c, new THREE.Color(0xe8be5a))); gs.neon.push(box(0.14, 0.14, 0.14, w / 2, gs.top + 3.15, d / 2, new THREE.Color(0xff5a4a), 0.04)); }
  if (id !== "control") parts.push(...roofKit(w, d, gs.top, seed, gs.roofInset));
  const { slots, seats, glass, neon } = gs;
  const turn = w === d ? ({ s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 }[face] || 0) : 0;
  if (turn) {
    const M = turnAbout(w, d, turn), v = new THREE.Vector3();
    for (const g of [...parts, ...glass, ...neon]) g.applyMatrix4(M);
    for (const sl of slots) { v.set(sl.x, sl.y, sl.z).applyMatrix4(M); sl.x = v.x; sl.z = v.z; sl.ry += turn; }
    for (const fl of seats) for (const se of fl) { v.set(se.x, se.y, se.z).applyMatrix4(M); se.x = v.x; se.z = v.z; }
  }
  const g = new THREE.Group();
  g.name = "building:" + id;
  g.userData = { project: id, name, w, d, h: gs.top, seats, glassOffice: true };
  return finish(g, parts, slots, [pickBox(w, gs.top + 0.6, d, w / 2, (gs.top + 0.6) / 2, d / 2, { project: id, name })], { glass, neon, winGeo: STRIP, winLook: STRIP_LOOK });
}

// A project's building: w x d tiles, `floors` storeys, coloured by `hue`. Returns a Group with
// setWindows(fn), setNight(n), dispose(), and a pick box whose userData is { project: id }.
// style (stone, brick, graphite, sand) makes it a glass office (the 2026-11-13 look); without it, the older block.
export function makeBuilding({ w = 5.5, d = 5.5, floors = 1, hue = 30, name = "", id = name, face = "s", style = null, desks = [], setback = false, shop = false } = {}) {
  if (style) return makeGlassBuilding({ w, d, floors, hue, name, id, face, style, desks, setback, shop });
  const pal = palette(hue);
  const parts = [];
  // A low plinth so the building sits on the grass.
  parts.push(box(w + 0.3, 0.08, d + 0.3, w / 2, 0.04, d / 2, new THREE.Color(0xcfc7b4)));
  let slots = [];
  for (let f = 0; f < floors; f++) {
    const y0 = f * FLOOR_H;
    parts.push(box(w, FLOOR_H - BAND, d, w / 2, y0 + (FLOOR_H - BAND) / 2, d / 2, pal.wall));
    parts.push(box(w + 0.1, BAND, d + 0.1, w / 2, y0 + FLOOR_H - BAND / 2, d / 2, pal.band));
    slots = slots.concat(windowSlots(w, d, f));
  }
  // A door on the south side of the ground floor.
  parts.push(box(0.8, 1.0, 0.06, w / 2, 0.5, d + 0.03, pal.trim));
  parts.push(...facadeParts(w, d, floors, pal, hashStr(id)));
  parts.push(...roofParts(w, d, floors * FLOOR_H, pal, floors));
  if (id !== "control") parts.push(...roofTop(w, d, floors * FLOOR_H, hashStr(id))); // the CEO tower wears its gold crown instead
  // plan B+C: square buildings turn their entrance to the street they stand on
  const turn = w === d ? ({ s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 }[face] || 0) : 0;
  if (turn) {
    const M = new THREE.Matrix4().makeTranslation(w / 2, 0, d / 2).multiply(new THREE.Matrix4().makeRotationY(turn)).multiply(new THREE.Matrix4().makeTranslation(-w / 2, 0, -d / 2));
    for (const g of parts) g.applyMatrix4(M);
    const v = new THREE.Vector3();
    for (const sl of slots) { v.set(sl.x, sl.y, sl.z).applyMatrix4(M); sl.x = v.x; sl.z = v.z; sl.ry += turn; }
  }
  const g = new THREE.Group();
  g.name = "building:" + id;
  g.userData = { project: id, name, w, d, h: floors * FLOOR_H };
  return finish(g, parts, slots, [pickBox(w, floors * FLOOR_H + 0.6, d, w / 2, (floors * FLOOR_H + 0.6) / 2, d / 2, { project: id, name })]);
}

// A stacked tower for small projects: floorsSpec = [{ project, name, hue }], ground floor first. Each storey
// gets its own hue band and its own pick box (userData { project, name, floor }), so a tap opens the right panel.
// Footprint 5.5 x 5.5 (brief section 6).
export function makeTower(floorsSpec = [], { w = 5.5, d = 5.5, id = "tower", style = null } = {}) {
  if (style) { // a glass tower, each storey's core in its tenant's colour
    const st = STYLES[style] || STYLES.stone, gs = glassStoreys(w, d, floorsSpec.map((f) => ({ hue: f.hue ?? 200, desks: f.desks || 0 })), st);
    const parts = [box(w + 0.5, 0.06, d + 0.5, w / 2, 0.03, d / 2, new THREE.Color(0xd6cfbf), 0.02), ...gs.parts, ...entrance(w, d, palette(floorsSpec[0]?.hue ?? 200)), ...roofKit(w, d, gs.top, hashStr(id))];
    const picks = floorsSpec.map((fl, f) => pickBox(w, FLOOR_H, d, w / 2, f * FLOOR_H + FLOOR_H / 2, d / 2, { project: fl.project, name: fl.name, floor: f, tower: id }));
    const g = new THREE.Group(); g.name = "tower:" + id;
    g.userData = { tower: id, isTower: true, w, d, h: gs.top, floors: floorsSpec.map((f) => f.project), seats: gs.seats, glassOffice: true };
    return finish(g, parts, gs.slots, picks, { glass: gs.glass, neon: gs.neon, winGeo: STRIP, winLook: STRIP_LOOK });
  }
  const parts = [box(w + 0.3, 0.08, d + 0.3, w / 2, 0.04, d / 2, new THREE.Color(0xcfc7b4))];
  let slots = [];
  const picks = [];
  floorsSpec.forEach((fl, f) => {
    const pal = palette(fl.hue ?? 200);
    const y0 = f * FLOOR_H;
    parts.push(box(w, FLOOR_H - BAND, d, w / 2, y0 + (FLOOR_H - BAND) / 2, d / 2, pal.wall));
    // The band under each storey is the tenant's accent, so the stack reads as separate projects.
    parts.push(box(w + 0.12, BAND, d + 0.12, w / 2, y0 + FLOOR_H - BAND / 2, d / 2, pal.band));
    parts.push(box(w + 0.02, 0.1, d + 0.02, w / 2, y0 + 0.05, d / 2, hsl(fl.hue ?? 200, 0.5, 0.45)));
    slots = slots.concat(windowSlots(w, d, f));
    picks.push(pickBox(w, FLOOR_H, d, w / 2, y0 + FLOOR_H / 2, d / 2, { project: fl.project, name: fl.name, floor: f, tower: id }));
  });
  const floors = floorsSpec.length;
  parts.push(box(0.8, 1.0, 0.06, w / 2, 0.5, d + 0.03, new THREE.Color(0x4a4f5a)));
  parts.push(...roofParts(w, d, floors * FLOOR_H, palette(floorsSpec[0]?.hue ?? 200), 1));
  const g = new THREE.Group();
  g.name = "tower:" + id;
  g.userData = { tower: id, isTower: true, w, d, h: floors * FLOOR_H, floors: floorsSpec.map((f) => f.project) };
  return finish(g, parts, slots, picks);
}

// A Residences building (the owner 2026-11-16: "look like homes from outside, not offices"; then "less prison-like"): a
// warm brick ground storey with wide lobby windows, then the homes in bays (campusHomes.facade(): one bay per 5.5-tile
// unit of the quad's long block, one for a tower), each bay its own warm plaster, the middle bays stepping in a little,
// a pale ledge at each floor and a pilaster between bays. Every flat has a framed window with a sill and curtains (a
// few colours, by flat), and its level shows from outside: Basic, shutters and a flower box; Comfy, a balcony with a
// solid painted front (no bars); Nice, a wide glass balcony with a timber rail, planters and a striped awning; the
// Penthouse, a glass storey set back behind a terrace with a pergola. A flat to let has its curtains drawn. Each bay
// has its own top (a low gable with a chimney, a roof garden, or a timber water tank), all inside the old 0.5 roof
// allowance. The entrance, mid-front where people.js doorOf puts the door: glass double doors in a frame, a canopy on
// posts (main3d.js puts the word "Residences" on it), steps, benches, mailboxes, a bike rack on the long block; a
// hedge with small trees and flower beds along the front. No desks anywhere.
// floorsSpec, ground floor first: [{ level 0-3, span 1|2, perFloor, flats: [deskId|null] }]. Window slots carry `res`
// (who lives behind them) so main3d.js lights a flat when its owner is home. face "n" builds it turned to the north
// (the quad's block faces the garden), like makeHouse, so nothing has to be turned afterwards.
// A home storey is RES_STOREY high (offices are 1.5), and maxH keeps the whole building under the CEO tower.
export const RES_STOREY = 1.05;
const RES_PENT_SET = 0.6; // how far the penthouse storey stands back from its bay's front (its terrace)
export function makeResidence(floorsSpec = [], { w = 3.6, d = 3.8, id = "homes", name = "Residences", maxH = Infinity, face = "s" } = {}) {
  const storeys = floorsSpec.reduce((a, f) => a + (f.span || 1), 0) || 1, LOBBY = 0.9, ROOF = 0.5;
  const RH = Math.min(RES_STOREY, (maxH - LOBBY - ROOF) / storeys); // squeezed only if it would reach the CEO tower
  const C = (h) => new THREE.Color(h);
  const F = globalThis.campusHomes?.facade ? globalThis.campusHomes.facade({ w, floors: floorsSpec, id }) : { bays: [{ i: 0, x0: 0, x1: w, wall: "#e6c88e", accent: "#3d6585", roof: "tank", inset: 0 }], door: w / 2, curtain: () => "#f3e7c9", bayAt: () => null };
  const bayAt = F.bayAt || ((x) => F.bays.find((b) => x >= b.x0 && x <= b.x1) || F.bays[0]);
  const trim = C(0xf6f0e2), ledge = C(0xf1eadb), brick = C(0xa8644c), brickDark = C(0x8f5240), paving = C(0xd8cfbd), wood = C(0x8b6a4a), woodDark = C(0x6d523a);
  const glassRail = C(0xa9c8d8), doorGlass = C(0x6f8597), metal = C(0x4f5560), leaf = COLORS.leaf, leafDark = COLORS.leafDark, pot = C(0xb5683c), roofTile = C(0xa4553e), soil = C(0x6b4f3a);
  const FLOWERS = [C(0xe86f8a), C(0xf2c14e), C(0xf4f0f0), C(0xd9534f), C(0xb48ad6)];
  const parts = [], slots = [];
  const ico = (r, x, y, z, c) => { const g = new THREE.IcosahedronGeometry(r, 0); g.translate(x, y, z); parts.push(paint(g, c)); };
  const flowers = (x0, x1, y, z, n, k0) => { for (let q = 0; q < n; q++) ico(0.05, x0 + ((q + 0.5) * (x1 - x0)) / n, y, z, FLOWERS[(k0 + q) % FLOWERS.length]); };
  // ---- the ground: paving round it, the brick ground storey (full depth: the bays above step back from it)
  parts.push(box(w + 0.4, 0.06, d + 0.4, w / 2, 0.03, d / 2, paving, 0.02));
  parts.push(box(w, LOBBY, d, w / 2, LOBBY / 2, d / 2, brick, 0.02));
  parts.push(box(w + 0.1, 0.07, d + 0.1, w / 2, LOBBY - 0.01, d / 2, trim, 0)); // the cornice over it
  parts.push(box(w + 0.02, 0.1, d + 0.02, w / 2, 0.05, d / 2, brickDark, 0)); // a darker plinth course
  const door = F.door, sideOf = (x) => Math.abs(x - door);
  // wide lobby windows along the front (lit at night: the hall lights), clear of the door
  const lobbyX = w < 7 ? [w * 0.17, w * 0.83] : Array.from({ length: Math.floor((w - 1.2) / 1.7) }, (_, i) => 0.85 + i * 1.7).filter((x) => sideOf(x) > 1.5 && x < w - 0.6);
  lobbyX.forEach((x, i) => {
    slots.push({ floor: -1, side: "south", index: i, x, y: 0.48, z: d + 0.03, ry: 0, sx: 0.9 / WIN_W, sy: 0.5 / WIN_H, lobby: true });
    parts.push(box(1.0, 0.05, 0.08, x, 0.2, d + 0.04, trim, 0), box(1.0, 0.04, 0.06, x, 0.75, d + 0.03, trim, 0), box(0.04, 0.55, 0.06, x - 0.48, 0.48, d + 0.03, trim, 0), box(0.04, 0.55, 0.06, x + 0.48, 0.48, d + 0.03, trim, 0));
  });
  // ---- the entrance: glass double doors in a frame, a transom, a canopy on two posts, steps, lamps (main3d.js)
  parts.push(box(1.1, 0.66, 0.04, door, 0.37, d + 0.02, doorGlass, 0));
  parts.push(box(0.04, 0.66, 0.06, door, 0.37, d + 0.04, woodDark, 0)); // where the two doors meet
  parts.push(box(1.26, 0.07, 0.08, door, 0.73, d + 0.04, trim, 0), box(0.07, 0.72, 0.08, door - 0.6, 0.38, d + 0.04, trim, 0), box(0.07, 0.72, 0.08, door + 0.6, 0.38, d + 0.04, trim, 0));
  for (const s of [-0.12, 0.12]) parts.push(box(0.02, 0.18, 0.03, door + s, 0.38, d + 0.06, C(0xd9b25a), 0)); // door handles
  const doorBay = bayAt(door) || F.bays[0];
  parts.push(box(2.0, 0.07, 0.8, door, 0.86, d + 0.4, C(doorBay.accent), 0.02)); // the canopy
  parts.push(box(2.04, 0.13, 0.04, door, 0.83, d + 0.8, trim, 0)); // its fascia, where the word goes
  for (const x of [door - 0.9, door + 0.9]) parts.push(box(0.05, 0.82, 0.05, x, 0.41, d + 0.75, woodDark, 0));
  parts.push(box(1.5, 0.05, 0.36, door, 0.025, d + 0.2, paving.clone().multiplyScalar(0.94), 0), box(1.3, 0.05, 0.2, door, 0.065, d + 0.12, paving, 0)); // steps
  // the mailboxes beside the door, a bench each side, a bike rack on the long block
  parts.push(box(0.46, 0.34, 0.07, door + 0.92, 0.42, d + 0.04, metal, 0));
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) parts.push(box(0.12, 0.12, 0.02, door + 0.92 - 0.15 + c * 0.15, 0.35 + r * 0.15, d + 0.085, C(0x8a929c), 0));
  for (const sx of [-1, 1]) {
    const bx = door + sx * (w < 7 ? 1.55 : 1.75);
    if (bx < 0.4 || bx > w - 0.4) continue;
    parts.push(box(0.62, 0.05, 0.2, bx, 0.22, d + 0.32, wood, 0), box(0.62, 0.18, 0.04, bx, 0.36, d + 0.22, wood, 0));
    for (const lx of [-0.26, 0.26]) parts.push(box(0.04, 0.2, 0.18, bx + lx, 0.1, d + 0.32, woodDark, 0));
  }
  if (w >= 7) for (let q = 0; q < 3; q++) { const x = door - 2.55 + q * 0.22; parts.push(box(0.03, 0.26, 0.03, x, 0.13, d + 0.25, metal, 0), box(0.03, 0.26, 0.03, x, 0.13, d + 0.45, metal, 0), box(0.03, 0.03, 0.23, x, 0.26, d + 0.35, metal, 0)); }
  // ---- planting along the front: hedge runs with a small round tree now and then, flower beds by the door
  const runs = w < 7 ? [] : [[0.2, door - 2.85], [door + 2.2, w - 0.2]];
  runs.forEach(([a, b], ri) => {
    for (let x = a; x < b - 0.3; x += 2.4) {
      const e = Math.min(b, x + 1.7);
      parts.push(box(e - x, 0.24, 0.26, (x + e) / 2, 0.15, d + 0.34, leafDark, 0.05));
      if (e + 0.5 < b) { parts.push(box(0.07, 0.4, 0.07, e + 0.35, 0.22, d + 0.36, woodDark, 0)); ico(0.3, e + 0.35, 0.62, d + 0.36, (ri + Math.round(x)) % 2 ? leaf : leafDark); }
    }
  });
  for (const sx of [-1, 1]) {
    const fx = w < 7 ? (sx < 0 ? 0.35 : w - 0.35) : door + sx * 1.25;
    parts.push(box(0.42, 0.12, 0.3, fx, 0.08, d + 0.3, soil, 0)); flowers(fx - 0.16, fx + 0.16, 0.18, d + 0.3, 3, sx < 0 ? 0 : 2);
  }
  // ---- the homes, bay by bay and floor by floor
  const topLv = floorsSpec.length ? floorsSpec[floorsSpec.length - 1].level | 0 : 0;
  const topDepth = (b) => d - b.inset - (topLv === 3 ? RES_PENT_SET : 0);
  F.bays.forEach((b, bi) => {
    const bw = b.x1 - b.x0, cx = (b.x0 + b.x1) / 2, wall = C(b.wall);
    let s = 0;
    floorsSpec.forEach((fl) => {
      const lv = fl.level | 0, span = fl.span || 1, y0 = LOBBY + s * RH, H = span * RH, dd = d - b.inset - (lv === 3 ? RES_PENT_SET : 0);
      parts.push(box(bw, H - 0.05, dd, cx, y0 + (H - 0.05) / 2, dd / 2, lv === 3 ? wall.clone().lerp(trim, 0.45) : wall, 0.01)); // the penthouse: the bay's tone, paler
      parts.push(box(bw + 0.04, 0.05, dd + 0.06, cx, y0 + H - 0.025, dd / 2, ledge, 0)); // the ledge on top of the floor
      if (lv === 3) { // the penthouse terrace: a deck with a glass rail at the bay's front
        parts.push(box(bw, 0.04, RES_PENT_SET, cx, y0 + 0.02, d - b.inset - RES_PENT_SET / 2, C(0xb8936a), 0));
        parts.push(box(bw, 0.3, 0.03, cx, y0 + 0.19, d - b.inset - 0.02, glassRail, 0), box(bw, 0.03, 0.05, cx, y0 + 0.35, d - b.inset - 0.02, wood, 0));
      }
      s += span;
    });
    // a pilaster between this bay and the next, and the corner ones at the ends
    if (bi < F.bays.length - 1) { const z = d - Math.min(b.inset, F.bays[bi + 1].inset); parts.push(box(0.16, storeys * RH, 0.12, b.x1, LOBBY + (storeys * RH) / 2, z - 0.04, trim, 0)); }
    // the bay's own top: a parapet, then a low gable with a chimney, a roof garden, or a timber water tank (<= ROOF)
    const top = LOBBY + storeys * RH, td = topDepth(b);
    parts.push(box(bw + 0.06, 0.12, td + 0.06, cx, top + 0.06, td / 2, ledge, 0.01));
    if (b.roof === "gable") {
      const rh = 0.42, eave = 0.1, sh = new THREE.Shape([new THREE.Vector2(-td / 2 - eave, 0), new THREE.Vector2(td / 2 + eave, 0), new THREE.Vector2(0, rh)]);
      const roof = new THREE.ExtrudeGeometry(sh, { depth: bw + 0.08, bevelEnabled: false }); roof.rotateY(Math.PI / 2); roof.translate(b.x0 - 0.04, top + 0.08, td / 2); parts.push(paint(roof, roofTile));
      parts.push(box(0.16, 0.36, 0.16, b.x0 + bw * 0.72, top + 0.26, td * 0.3, C(0x8e5a48), 0), box(0.2, 0.04, 0.2, b.x0 + bw * 0.72, top + 0.46, td * 0.3, C(0x6e6a64), 0));
    } else if (b.roof === "garden") {
      parts.push(box(bw * 0.62, 0.1, td * 0.5, cx, top + 0.17, td * 0.45, COLORS.roofGarden, 0));
      for (let q = 0; q < 3; q++) ico(0.13 + 0.03 * (q % 2), cx - bw * 0.22 + q * bw * 0.22, top + 0.32, td * (0.36 + 0.1 * (q % 2)), q % 2 ? leaf : leafDark);
      parts.push(box(0.5, 0.04, 0.16, cx, top + 0.3, td * 0.8, wood, 0)); // a bench up there
    } else {
      const tx = b.x0 + bw * 0.7, tz = td * 0.35;
      for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) parts.push(box(0.04, 0.12, 0.04, tx + lx, top + 0.18, tz + lz, woodDark, 0));
      const tank = new THREE.CylinderGeometry(0.3, 0.3, 0.26, 10); tank.translate(tx, top + 0.37, tz); parts.push(paint(tank, wood));
      const cap = new THREE.ConeGeometry(0.33, 0.1, 10); cap.translate(tx, top + 0.55, tz); parts.push(paint(cap, woodDark));
      parts.push(box(0.26, 0.2, 0.26, b.x0 + bw * 0.25, top + 0.2, td * 0.4, C(0x8e5a48), 0));
    }
  });
  // corner trims up the two ends
  for (const [x, b] of [[0, F.bays[0]], [w, F.bays[F.bays.length - 1]]]) parts.push(box(0.12, storeys * RH, 0.12, x, LOBBY + (storeys * RH) / 2, d - b.inset - 0.04, trim, 0));
  // ---- each flat: a framed window with curtains, and its level's look
  let s = 0;
  floorsSpec.forEach((fl) => {
    const lv = fl.level | 0, span = fl.span || 1, y0 = LOBBY + s * RH, H = span * RH, k = Math.max(1, fl.perFloor || fl.flats?.length || 1), cw = w / k;
    for (let j = 0; j < k; j++) {
      const res = fl.flats?.[j] || null, cx = cw * (j + 0.5), b = bayAt(cx) || F.bays[0], acc = C(b.accent), fz = d - b.inset - (lv === 3 ? RES_PENT_SET : 0);
      const [ww, wh] = [[0.36, 0.48], [0.46, 0.56], [0.66, 0.6], [0.86, 0.86]][lv] || [0.36, 0.48];
      const pw = Math.min(cw * ww, lv === 3 ? 3.4 : 1.6), ph = lv === 3 ? H - 0.3 : RH * wh, py = lv === 3 ? y0 + 0.1 + ph / 2 : y0 + RH * 0.26 + ph / 2;
      const cur = C(F.curtain(fl.storey || s + 1, j));
      if (res || lv === 3) slots.push({ floor: s, level: lv, side: "south", index: j, x: cx, y: py, z: fz + 0.03, ry: 0, sx: pw / WIN_W, sy: ph / WIN_H, res });
      if (!res && lv === 3) parts.push(box(pw, ph * 0.34, 0.02, cx, py + ph * 0.33, fz + 0.07, C(0xefe6d2), 0)); // a penthouse to let: glass, its blinds half down
      else if (!res) parts.push(box(pw, ph, 0.04, cx, py, fz + 0.02, C(0xefe6d2), 0), box(0.02, ph, 0.05, cx, py, fz + 0.03, C(0xd8ccb2), 0)); // to let: curtains drawn
      // the frame, the sill, the curtains either side
      parts.push(box(pw + 0.1, 0.05, 0.06, cx, py + ph / 2 + 0.02, fz + 0.03, trim, 0), box(0.05, ph, 0.06, cx - pw / 2 - 0.02, py, fz + 0.03, trim, 0), box(0.05, ph, 0.06, cx + pw / 2 + 0.02, py, fz + 0.03, trim, 0));
      parts.push(box(pw + 0.16, 0.04, 0.12, cx, py - ph / 2 - 0.02, fz + 0.05, trim, 0));
      if (res) for (const sx of [-1, 1]) parts.push(box(pw * 0.17, ph * 0.94, 0.02, cx + sx * (pw / 2 - pw * 0.085), py + ph * 0.01, fz + 0.07, cur, 0));
      if (lv === 3) { for (let q = 1; q < Math.round(pw / 0.6); q++) parts.push(box(0.03, ph, 0.05, cx - pw / 2 + (q * pw) / Math.round(pw / 0.6), py, fz + 0.06, woodDark, 0)); if (span > 1) parts.push(box(pw, 0.04, 0.06, cx, y0 + RH, fz + 0.06, woodDark, 0)); }
      if (lv === 0) {
        // Basic: painted shutters folded back, a flower box under the sill
        for (const sx of [-1, 1]) { parts.push(box(pw * 0.46, ph, 0.03, cx + sx * (pw / 2 + 0.04 + pw * 0.23), py, fz + 0.02, acc, 0)); parts.push(box(pw * 0.36, 0.015, 0.035, cx + sx * (pw / 2 + 0.04 + pw * 0.23), py + ph * 0.2, fz + 0.03, trim, 0), box(pw * 0.36, 0.015, 0.035, cx + sx * (pw / 2 + 0.04 + pw * 0.23), py - ph * 0.2, fz + 0.03, trim, 0)); }
        parts.push(box(pw + 0.06, 0.09, 0.13, cx, py - ph / 2 - 0.09, fz + 0.08, wood, 0));
        parts.push(box(pw, 0.04, 0.1, cx, py - ph / 2 - 0.03, fz + 0.08, leaf, 0)); flowers(cx - pw / 2 + 0.05, cx + pw / 2 - 0.05, py - ph / 2 + 0.0, fz + 0.09, Math.max(3, Math.round(pw / 0.14)), j + s);
      } else if (lv === 1 || lv === 2) {
        // Comfy: a balcony with a solid painted front; Nice: a wide glass one with a timber rail, planters and an awning
        const bw = Math.min(cw * (lv === 1 ? 0.64 : 0.88), 3), bd = lv === 1 ? 0.42 : 0.5, by = y0 + 0.02;
        parts.push(box(bw, 0.07, bd, cx, by + 0.035, fz + bd / 2, ledge, 0.01));
        const front = lv === 1 ? acc : glassRail;
        parts.push(box(bw, 0.3, 0.04, cx, by + 0.22, fz + bd - 0.02, front, 0));
        for (const sx of [-1, 1]) parts.push(box(0.04, 0.3, bd, cx + sx * (bw / 2 - 0.02), by + 0.22, fz + bd / 2, front, 0));
        parts.push(box(bw + 0.02, 0.04, 0.07, cx, by + 0.39, fz + bd - 0.02, lv === 1 ? trim : wood, 0));
        if (lv === 1) { parts.push(box(bw * 0.4, 0.08, 0.08, cx, by + 0.45, fz + bd - 0.02, wood, 0)); flowers(cx - bw * 0.18, cx + bw * 0.18, by + 0.52, fz + bd - 0.02, 3, j + 1); } // a rail planter
        else {
          for (const px of [cx - bw / 2 + 0.15, cx + bw / 2 - 0.15]) { parts.push(box(0.2, 0.18, 0.2, px, by + 0.15, fz + 0.16, pot, 0.02)); ico(0.15, px, by + 0.34, fz + 0.16, leaf); }
          const n = Math.max(4, Math.round(pw / 0.22));
          for (let q = 0; q < n; q++) { const g = new THREE.BoxGeometry(pw / n, 0.035, 0.36); g.rotateX(0.38); g.translate(cx - pw / 2 + (q + 0.5) * (pw / n), py + ph / 2 + 0.12, fz + 0.17); parts.push(paint(g, q % 2 ? trim : acc)); }
        }
      } else if (lv === 3 && res) {
        // the penthouse terrace: a pergola over loungers, pots at the ends
        const tz = d - b.inset - RES_PENT_SET / 2, pw2 = Math.min(cw * 0.8, 3);
        for (const px of [cx - pw2 / 2, cx + pw2 / 2]) parts.push(box(0.06, 0.82, 0.06, px, y0 + 0.43, tz + 0.2, wood, 0));
        parts.push(box(pw2 + 0.1, 0.05, 0.06, cx, y0 + 0.86, tz + 0.2, wood, 0));
        for (let q = 0; q < 6; q++) parts.push(box(0.04, 0.04, RES_PENT_SET + 0.05, cx - pw2 / 2 + (q * pw2) / 5, y0 + 0.9, tz, woodDark, 0));
        parts.push(box(0.5, 0.06, 0.24, cx - pw2 / 4, y0 + 0.13, tz, wood, 0.01), box(0.5, 0.06, 0.24, cx + pw2 / 4, y0 + 0.13, tz, wood, 0.01));
        for (const px of [cx - pw2 / 2 - 0.25, cx + pw2 / 2 + 0.25]) { parts.push(box(0.22, 0.2, 0.22, px, y0 + 0.12, tz, pot, 0.02)); ico(0.17, px, y0 + 0.34, tz, leafDark); }
      }
    }
    // two windows a storey on each side and the back, framed, lit when anyone on the floor is home
    const eb = F.bays[F.bays.length - 1], wb = F.bays[0];
    for (let q = 0; q < span; q++) {
      const yy = y0 + q * RH + RH * 0.5, any = (fl.flats || []).find(Boolean) || null;
      for (const [side, len] of [["east", d - eb.inset - (lv === 3 ? RES_PENT_SET : 0)], ["west", d - wb.inset - (lv === 3 ? RES_PENT_SET : 0)], ["north", w]]) [0.3, 0.7].forEach((t, i) => {
        const at = len * t, [x, z, ry] = side === "east" ? [w + 0.03, at, Math.PI / 2] : side === "west" ? [-0.03, at, Math.PI / 2] : [at, -0.03, 0];
        slots.push({ floor: s + q, level: lv, side, index: i, x, y: yy, z, ry, sx: 0.62, sy: lv === 3 ? 0.9 : 0.55, res: (fl.flats || [])[i % Math.max(1, (fl.flats || []).length)] || any });
        const sy = yy - (lv === 3 ? 0.9 : 0.55) * WIN_H / 2 - 0.02;
        parts.push(side === "north" ? box(0.42, 0.04, 0.1, x, sy, -0.04, trim, 0) : box(0.1, 0.04, 0.42, side === "east" ? w + 0.04 : -0.04, sy, z, trim, 0));
      });
    }
    s += span;
  });
  // turned to face the north (the quad's block): about the footprint's centre, like makeHouse
  const turn = face === "n" ? Math.PI : 0;
  if (turn) {
    const M = turnAbout(w, d, turn), v = new THREE.Vector3();
    for (const g of parts) g.applyMatrix4(M);
    for (const sl of slots) { v.set(sl.x, sl.y, sl.z).applyMatrix4(M); sl.x = v.x; sl.z = v.z; sl.ry += turn; }
  }
  const top = LOBBY + storeys * RH, g = new THREE.Group();
  g.name = "residence:" + id;
  // bays and insets (unturned: x from the left as you face the front) for main3d.js's balcony things and the canopy word
  g.userData = { project: id, name, w, d, h: top + 0.62, isResidence: true, storeyH: RH, lobby: LOBBY, flipped: !!turn, bays: F.bays.map((b) => ({ x0: b.x0, x1: b.x1, inset: b.inset })), pentSet: RES_PENT_SET, door };
  return finish(g, parts, slots, [pickBox(w, top + 0.6, d, w / 2, (top + 0.6) / 2, d / 2, { project: id, name })]);
}

// A proper house (city plan B+C, the owner 2026-11-09: "the houses in 3d don't look housey"): walls, a pitched gable roof
// with eaves, a chimney, a front porch with posts and a little roof, a door with a step, small windows with shutters,
// and a picket fence round the front yard. `face` is the side the door looks at ("n", "e", "s", "w"); w and d are the
// footprint as placed (already turned). Size 0-2 (cottage, house, villa) adds height and a dormer. One body mesh and
// one windows mesh, like every building, so the village batching (main3d.js batchCity) still merges them.
const ROOF_TONES = [0xa4553e, 0x6d4b3b, 0x5b6573, 0x7a3f3a, 0x4f5d4a];
export function makeHouse({ w = 1.4, d = 1.2, face = "s", size = 0, hue = 30, id = "house", seed = 0 } = {}) {
  const side = face === "e" || face === "w";
  const bw = side ? d : w, bd = side ? w : d; // built facing south (+z), then turned
  const wallH = 0.62 + size * 0.14, roofH = 0.42 + bw * 0.16, eave = 0.12;
  const pal = palette(hue), wall = hsl(hue, 0.28, 0.8), trim = new THREE.Color(0xf4efe4), roofC = new THREE.Color(ROOF_TONES[(seed + size) % ROOF_TONES.length]);
  const parts = [];
  // yard: a pale path to the door and a picket fence across the front, with a gap for the gate
  parts.push(box(0.26, 0.02, 0.5, bw / 2, 0.012, bd + 0.25, new THREE.Color(0xd9cfb8), 0));
  const fz = bd + 0.48;
  for (let x = -0.08; x <= bw + 0.08; x += 0.14) if (Math.abs(x - bw / 2) > 0.2) parts.push(box(0.035, 0.2, 0.035, x, 0.1, fz, trim, 0));
  parts.push(box(bw / 2 - 0.12, 0.03, 0.03, (bw / 2 - 0.2) / 2 - 0.04, 0.15, fz, trim, 0), box(bw / 2 - 0.12, 0.03, 0.03, bw - (bw / 2 - 0.2) / 2 + 0.04, 0.15, fz, trim, 0));
  // foundation and walls
  parts.push(box(bw + 0.06, 0.08, bd + 0.06, bw / 2, 0.04, bd / 2, new THREE.Color(0x9d968a), 0.02));
  parts.push(box(bw, wallH, bd, bw / 2, 0.08 + wallH / 2, bd / 2, wall, 0.03));
  // corner trim
  for (const [x, z] of [[0, 0], [bw, 0], [0, bd], [bw, bd]]) parts.push(box(0.06, wallH, 0.06, x, 0.08 + wallH / 2, z, trim, 0));
  // gable roof: a triangle extruded along the depth, with eaves front and back and a ridge cap
  const y0 = 0.08 + wallH, sh = new THREE.Shape([new THREE.Vector2(-bw / 2 - eave, 0), new THREE.Vector2(bw / 2 + eave, 0), new THREE.Vector2(0, roofH)]);
  const roof = new THREE.ExtrudeGeometry(sh, { depth: bd + eave * 2, bevelEnabled: false });
  roof.translate(bw / 2, y0 - 0.02, -eave); parts.push(paint(roof, roofC));
  // the gable ends in wall colour so the roof reads as a lid, not a block
  const gable = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-bw / 2 + 0.02, 0), new THREE.Vector2(bw / 2 - 0.02, 0), new THREE.Vector2(0, roofH - 0.06)]));
  const g1 = gable.clone(); g1.translate(bw / 2, y0, bd + 0.005); parts.push(paint(g1, wall));
  const g2 = gable.clone(); g2.rotateY(Math.PI); g2.translate(bw / 2, y0, -0.005); parts.push(paint(g2, wall)); gable.dispose();
  parts.push(box(0.07, 0.06, bd + eave * 2 + 0.04, bw / 2, y0 + roofH - 0.01, bd / 2, roofC.clone().multiplyScalar(0.8), 0));
  // chimney (smoke is added by main3d.js at night)
  parts.push(box(0.16, roofH + 0.18, 0.16, bw * 0.74, y0 + (roofH + 0.18) / 2 + 0.05, bd * 0.3, new THREE.Color(0x8e5a48), 0.02));
  parts.push(box(0.2, 0.05, 0.2, bw * 0.74, y0 + roofH + 0.25, bd * 0.3, new THREE.Color(0x6e6a64), 0.01));
  // a dormer on the bigger houses
  if (size >= 1) { parts.push(box(0.34, 0.24, 0.3, bw * 0.3, y0 + roofH * 0.38, bd - 0.1, wall, 0.02)); const dr = new THREE.ConeGeometry(0.26, 0.18, 4, 1); dr.rotateY(Math.PI / 4); dr.translate(bw * 0.3, y0 + roofH * 0.38 + 0.21, bd - 0.1); parts.push(paint(dr, roofC)); }
  // porch: a deck, two posts and a little roof over the door, plus a step
  const pw = Math.min(bw * 0.62, 0.8);
  parts.push(box(pw, 0.06, 0.3, bw / 2, 0.11, bd + 0.15, new THREE.Color(0xb48a62), 0.01));
  parts.push(box(0.3, 0.04, 0.1, bw / 2, 0.05, bd + 0.34, new THREE.Color(0x9d968a), 0));
  for (const x of [bw / 2 - pw / 2 + 0.04, bw / 2 + pw / 2 - 0.04]) parts.push(box(0.04, 0.42, 0.04, x, 0.14 + 0.21, bd + 0.27, trim, 0));
  parts.push(box(pw + 0.12, 0.05, 0.4, bw / 2, 0.6, bd + 0.16, roofC, 0.01));
  // door
  parts.push(box(0.22, 0.38, 0.03, bw / 2, 0.08 + 0.19 + 0.04, bd + 0.015, pal.trim, 0.01));
  parts.push(box(0.03, 0.03, 0.02, bw / 2 + 0.07, 0.3, bd + 0.035, new THREE.Color(0xe0b04a), 0));
  // windows: two at the front beside the door (with shutters), one each side, two at the back
  const wy = 0.08 + wallH * 0.55, slots = [], o = 0.02, P = { sx: 0.42, sy: 0.38 };
  const fx = [bw * 0.2, bw * 0.8].filter((x) => Math.abs(x - bw / 2) > 0.3);
  fx.forEach((x, i) => { slots.push({ floor: 0, side: "south", index: i, x, y: wy, z: bd + o, ry: 0, ...P }); for (const sx of [-0.15, 0.15]) parts.push(box(0.06, 0.3, 0.02, x + sx, wy, bd + 0.02, pal.trim, 0)); });
  slots.push({ floor: 0, side: "east", index: 0, x: bw + o, y: wy, z: bd / 2, ry: Math.PI / 2, ...P }, { floor: 0, side: "west", index: 0, x: -o, y: wy, z: bd / 2, ry: Math.PI / 2, ...P });
  [bw * 0.3, bw * 0.7].forEach((x, i) => slots.push({ floor: 0, side: "north", index: i, x, y: wy, z: -o, ry: 0, ...P }));
  // turn to face the street: rotate about the footprint's centre, then put the min corner back at the origin
  const turn = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 }[face] || 0;
  if (turn) {
    const M = new THREE.Matrix4().makeTranslation(w / 2, 0, d / 2).multiply(new THREE.Matrix4().makeRotationY(turn)).multiply(new THREE.Matrix4().makeTranslation(-bw / 2, 0, -bd / 2));
    for (const g of parts) g.applyMatrix4(M);
    const v = new THREE.Vector3();
    for (const sl of slots) { v.set(sl.x, sl.y, sl.z).applyMatrix4(M); sl.x = v.x; sl.z = v.z; sl.ry += turn; }
  }
  // where the chimney top is (main3d.js puffs smoke from it on evenings when the owner is home)
  const ch = new THREE.Vector3(bw * 0.74, y0 + roofH + 0.3, bd * 0.3);
  if (turn) ch.applyMatrix4(new THREE.Matrix4().makeTranslation(w / 2, 0, d / 2).multiply(new THREE.Matrix4().makeRotationY(turn)).multiply(new THREE.Matrix4().makeTranslation(-bw / 2, 0, -bd / 2)));
  const g = new THREE.Group();
  g.name = "house:" + id;
  g.userData = { project: id, name: id, w, d, h: y0 + roofH, isHouseModel: true, chimney: ch };
  return finish(g, parts, slots, [pickBox(w + 0.2, y0 + roofH, d + 0.2, w / 2, (y0 + roofH) / 2, d / 2, { project: id, name: id })]);
}
