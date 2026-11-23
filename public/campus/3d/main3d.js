// The 3D campus (phase 1 blockout, 2026-11-09): the same campus model as the 2D view (rooms, walkers, the pet, night),
// drawn with three.js. Loaded by boot.js when the 3D switch is on (?r=3d or the 2D/3D pill). The classic campus
// scripts still build the model, run the walkers and own every panel; this file only draws and turns taps into
// panel(id). Inside a building (setView) the page falls back to the 2D floor view until phase 4 (interiors).
// Plan: docs/design/campus-3d/brief.md. Toolkit: public/campus/3d/*.js (three r160, vendored).
import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { makeLights } from "./lights.js";
import { makeWeather } from "./weather.js";
import { themeFor, sideColor, addProps } from "./themes.js";
import { makeBuilding, makeTower, makeHouse, makeResidence, mergeParts, kitPieces } from "./buildings.js";
import { itemLook, itemsAt } from "./items.js";
import { makeRiver, makeGreen, makeUnderground } from "./river.js";
import { makePost } from "./post.js";
import { makeLife } from "./life.js";
import { makeCityLife3L2 } from "./citylife2.js"; // City life lane L2 (goods and records): docks, barge, library, tubes, crane, balloon banners, blimp, umbrellas
import { makeCityLife3 } from "./citylife.js"; // City life (Living City L1): power lines, cones, bridge vans, late lamps, sunbeam, diner
import { makeLamps } from "./lamps.js";
import { makePet } from "./pet.js";
import { seasonNow, crownColour, makeSeasonal } from "./seasons.js";
import { makeQuality, isPhone } from "./quality.js";
import { makeCrowd, steer } from "./crowd.js";
import { NavGrid, settle } from "./nav.js";
import { makeWorld } from "./world.js";
import { loadKit, hasKit, kitGeo, kitParts, kitSolid, kitSize } from "./kit.js";
await loadKit(); // the Blender prop kit (kit.json); without it the old code-drawn shapes stay
import { paint, COLORS, mats, setEnv, blobTexture, std, canvasTexture, box } from "./materials.js";

const stage = document.getElementById("stage"), canvas2d = document.getElementById("c");
const wrap = document.createElement("div");
// Its own stacking context, so the 3D signs stay under the HUD and the side panel.
Object.assign(wrap.style, { position: "absolute", inset: "0", touchAction: "none", zIndex: "0", isolation: "isolate" });
stage.insertBefore(wrap, canvas2d.nextSibling);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Polish pass: ACES filmic tone mapping was tried and washed the pastel palette out (pale grass on phones), so colours
// stay untone-mapped and the softness comes from the room environment light below instead.
renderer.toneMapping = THREE.NoToneMapping;
// Visual rehaul (2026-11-13, towers.app look): filmic tone mapping is back, with the palette re-tuned for it (richer base
// colours, warm low sun), so bright walls roll off softly instead of clipping.
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
wrap.appendChild(renderer.domElement);
renderer.domElement.style.display = "block";
const labels = new CSS2DRenderer();
Object.assign(labels.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
wrap.appendChild(labels.domElement);

const scene = new THREE.Scene();
const rig = makeLights(scene, renderer, { phone: isPhone() });
// Soft room light: a blurred studio environment (three's RoomEnvironment, baked once into a PMREM) lights every
// surface from all sides, so shadowed walls stay readable and colours look like soft daylight, not flat paint.
{ const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(renderer), 0.04).texture; pm.dispose(); }
const quality = makeQuality(renderer, (t) => { rig.setShadows(t.shadows); window.cityLife?.setTier(t.effects); }); // (the graphics level also decides which City life effects run)
const post = makePost(renderer); // the ✨ heavier-PC look (post.js), off unless chosen
const sky = makeWeather(scene), skyCol = new THREE.Color();
let weatherShown = "";
const PROVIDER3 = { claude: 0xe08a5a, gemini: 0x6ea8ff, grok: 0xc9ccd4, mixed: 0xb48cff, other: 0x8fd18b };

// ---------- the city, rebuilt from the model whenever it changes ----------
let city = null, picks = [], buildings = [], lamps = null, signKey = "", river = null, green = null, life = null, world = null, cityLife3 = null, cityLife3b = null;
function bounds() {
  const xs = rooms.flatMap((r) => [r.x, r.x + r.w]), zs = rooms.flatMap((r) => [r.y, r.y + r.d]);
  // the quad layout: its ring road and the river behind the homes are part of the ground too
  if (!view && campus.plan === "quad" && campus.ring) { xs.push(campus.ring.x0, campus.ring.x1); zs.push(campus.ring.y0, campus.ring.y1); }
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}
function storeys(r) {
  if (r.isHouse) return 1;
  // a Residences tower (city.js): a storey a floor, but always under the CEO tower, which stands tallest
  if (r.isHomes) { const ceo = rooms.find((o) => o.isControl); return Math.max(2, Math.min(r.floors?.length || 1, (ceo ? storeys(ceo) : 7) - 1)); }
  // the CEO tower stands tallest, at the head of Main street: at least 3 storeys over the tallest office (city planner pass)
  if (r.isControl) return Math.max(6, r.floors?.length || 1, 3 + Math.max(0, ...rooms.filter((o) => !o.isHouse && !o.isHomes && !o.isControl && o.floors?.length).map((o) => o.floors.length)));
  if (r.floors?.length && !r.isLeisure) return r.floors.length;
  return Math.max(1, Math.round((r.h || 1.5) / 1.5));
}
function sign(parent, text, x, y, z, cls = "") {
  const el = document.createElement("div");
  el.className = `sign3d ${cls}`; el.textContent = text;
  el.dataset.p = cls === "small" ? 0 : cls === "district" ? 1 : 2; // label priority for declutter()
  const s = new CSS2DObject(el); s.position.set(x, y, z); parent.add(s);
  return s;
}
function clearCity() {
  if (!city) return;
  city.traverse((o) => { if (o.isCSS2DObject) o.element.remove(); });
  for (const b of buildings) b.dispose?.();
  lamps?.dispose?.();
  city.traverse((o) => { if (o.geometry && !o.parent?.dispose) o.geometry.dispose?.(); });
  scene.remove(city);
  river?.dispose(); green?.dispose(); life?.dispose(); world?.dispose(); cityLife3?.dispose(); cityLife3b?.dispose(); river = green = life = world = cityLife3 = cityLife3b = null;
  city = null; picks = []; buildings = []; lamps = null; seasonal = null; winBatch = null; villageBody = null;
}
// Instanced kit props (visual rehaul 2026-11-13): list of { m: Matrix4, c?: Color } -> a group with one instanced mesh
// per part of the prop. "tint" parts take each instance's colour (tree crowns, planter shrubs); "glow" parts are unlit.
const kitMat = std({ vertexColors: true, flatShading: true }), kitGlow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
function kitInstances(name, list) {
  const g = new THREE.Group(); g.name = "kit:" + name;
  if (!list.length || !hasKit(name)) return g;
  for (const part of kitParts(name)) {
    const im = new THREE.InstancedMesh(kitGeo(name, part), part === "glow" ? kitGlow : kitMat, list.length);
    list.forEach((it, i) => { im.setMatrixAt(i, it.m); if (part.startsWith("tint")) im.setColorAt(i, it.c || col.set(0x6fae5c)); });
    im.castShadow = part !== "glow"; im.receiveShadow = true; im.name = part; g.add(im);
  }
  g.dispose = () => { for (const m of g.children) m.dispose(); }; // the geometry is the kit's, shared
  return g;
}
const kitM = (x, y, z, ry = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));
// A single kit prop as one mesh (all its solid parts merged), scaled so its widest side is `wide` (or its height `tall`).
function kitOne(name, { wide, tall, x = 0, y = 0, z = 0, ry = 0 } = {}) {
  if (!hasKit(name)) return null;
  const bb = kitSize(name), w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z), h = bb.max.y - bb.min.y;
  const s = wide ? wide / w : tall ? tall / h : 1;
  const m = new THREE.Mesh(kitSolid(name), kitMat); m.scale.setScalar(s); m.position.set(x, y, z); m.rotation.y = ry;
  m.castShadow = m.receiveShadow = true; m.userData.kitScale = s; m.userData.kitH = h * s; m.userData.kitW = w * s;
  return m;
}
// Environment filler (the owner 2026-11-09): little parks in the empty plots (trees, a bench, flower beds), a ring of
// planters and benches round the square, and woods around the edge of the map. Instanced: 4 draws in all.
function makeFiller(b, pad) {
  const g = new THREE.Group(); g.name = "filler";
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const trees = [], benches = [], beds = [];
  const roomAt = (x, z, m = 0.6) => rooms.some((r) => x > r.x - m && x < r.x + r.w + m && z > r.y - m && z < r.y + r.d + m);
  const inRect = (x, z, q, m) => x > q.x - m && x < q.x + q.w + m && z > q.y - m && z < q.y + q.d + m, R = campus.river, V = campus.village;
  const onStreet = (x, z) => campus.roads.some((q) => inRect(x, z, q, 0.4)) || (R && z > R.y - 0.8 && z < R.y + R.d + 0.8) || (V && x > V.x0 - V.road - V.plot - 0.4 && x < V.x1 + V.road + V.plot + 0.4 && z > V.y0 - V.road - V.plot - 0.4 && z < V.y1 + V.road + V.plot + 0.4);
  const sq = campus.square, inSquare = (x, z, m = 0) => sq && Math.hypot(x - sq.x, z - sq.y) < sq.r + m;
  // empty plots become little parks
  const used = new Set(rooms.filter((r) => r.gx != null).map((r) => `${r.gx},${r.gy}`));
  const paved = [], hedges = [];
  (campus.colX || []).forEach((cx, i) => (campus.rowY || []).forEach((cz, j) => {
    if (used.has(`${i},${j}`)) return;
    const w = campus.colW[i], d = campus.rowD[j];
    if (!hasKit("tree_round")) { for (let k = 0; k < 4; k++) trees.push([cx + 0.8 + rnd() * (w - 1.6), cz + 0.8 + rnd() * (d - 1.6), 0.8 + rnd() * 0.5]); benches.push([cx + w / 2, cz + d - 0.7, 0]); beds.push([cx + w / 2, cz + d / 2, 1.2]); return; }
    // City planner pass (2026-11-13): a lot that fronts Main street (columns 1 and 2) is a paved pocket square, four
    // trees in a grid round a planter, two benches facing the street; an outer lot is a hedged garden, six trees.
    if (i === 1 || i === 2) {
      paved.push([cx + 0.4, cz + 0.4, w - 0.8, d - 0.8]);
      for (const [fx, fz] of [[1.0, 1.0], [w - 1.0, 1.0], [1.0, d - 1.0], [w - 1.0, d - 1.0]]) trees.push([cx + fx, cz + fz, 0.75]);
      beds.push([cx + w / 2, cz + d / 2, 1.1]);
      const sx = i === 1 ? cx + w - 0.7 : cx + 0.7; benches.push([sx, cz + d / 2 - 0.6, Math.PI / 2], [sx, cz + d / 2 + 0.6, Math.PI / 2]);
    } else {
      const gapSide = i === 0 ? "e" : "w";
      for (let t = 0.45; t < w - 0.3; t += 0.9) for (const z of [cz + 0.3, cz + d - 0.3]) hedges.push([cx + t, z]);
      for (let t = 0.45; t < d - 0.3; t += 0.9) for (const [x, side] of [[cx + 0.3, "w"], [cx + w - 0.3, "e"]]) if (side !== gapSide || Math.abs(t - d / 2) > 0.7) hedges.push([x, cz + t]);
      for (let a = 0; a < 3; a++) for (let c = 0; c < 2; c++) trees.push([cx + w * (0.25 + a * 0.25), cz + d * (0.33 + c * 0.34), 0.7 + rnd() * 0.25]);
    }
  }));
  // plan B+C: the plaza row is a promenade; trees in planters line both edges, clear of main street and the square
  for (const q of (campus.roads || []).filter((r) => r.kind === "plaza-row")) for (let x = q.x + 2; x < q.x + q.w - 1; x += 3.2) for (const z of [q.y + 1.1, q.y + q.d - 1.1]) {
    const mainSt = campus.roads.find((r) => r.kind === "main"); if (mainSt && x > mainSt.x - 0.5 && x < mainSt.x + mainSt.w + 0.5) continue; if (inSquare(x, z, 1.2) || roomAt(x, z, 0.4)) continue;
    trees.push([x, z, 0.75]); beds.push([x, z, 0.9]);
  }
  // the village green: little groves in its corners and benches facing the bandstand
  const VG = campus.village;
  if (VG) for (const [fx, fz] of [[0.08, 0.15], [0.92, 0.15], [0.08, 0.85], [0.92, 0.85], [0.3, 0.12], [0.7, 0.88]]) {
    const cx = VG.x0 + (VG.x1 - VG.x0) * fx, cz = VG.y0 + (VG.y1 - VG.y0) * fz;
    for (let k = 0; k < 3; k++) trees.push([cx + (rnd() - 0.5) * 1.6, cz + (rnd() - 0.5) * 1.2, 0.8 + rnd() * 0.4]);
    benches.push([cx + 1.4, cz, Math.PI / 2]);
  }
  // City planner pass: Main street is a boulevard, trees on both pavements, continuous between the crossings
  const mainSt = campus.roads.find((r) => r.kind === "main"), cross = campus.roads.filter((r) => r.kind === "street" && r.w > r.d);
  if (mainSt && sq && hasKit("tree_round")) for (let z = sq.y + sq.r + 1; z < mainSt.y + mainSt.d - 1; z += isPhone() ? 3.0 : 2.2) {
    if (cross.some((h) => z > h.y - 1.2 && z < h.y + h.d + 1.2)) continue;
    for (const x of [mainSt.x + 0.45, mainSt.x + mainSt.w - 0.45]) trees.push([x, z, 0.6, "tree_round"]);
  }
  // a ring of planters and four benches round the square
  if (sq) for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + Math.PI / 8, r = sq.r - 0.55; (k % 2 ? benches : beds).push([sq.x + Math.cos(a) * r, sq.y + Math.sin(a) * r, k % 2 ? -a + Math.PI / 2 : 0.45]); }
  // woods round the edge, outside the streets
  for (let k = 0; k < (hasKit("tree_round") ? (isPhone() ? 150 : 260) : 90); k++) { // more woods with the kit's lighter trees
    const x = b.x0 - pad + rnd() * (b.x1 - b.x0 + pad * 2), z = b.z0 - pad + rnd() * (b.z1 - b.z0 + pad * 2);
    // a belt 0.5 to 5.5 tiles outside the ring streets (city planner pass), plus the home side round the village
    const ox = Math.max(-STREET - 0.5 - x, x - (campus.w + STREET + 0.5)), oz = -STREET - 0.5 - z;
    const belt = (ox > 0 && ox < 5 && z < campus.home.y) || (oz > 0 && oz < 5 && x > -STREET - 6 && x < campus.w + STREET + 6);
    const edge = belt || z > b.z1 + 0.5 || (z > campus.home.y && (x < (campus.village?.x0 ?? 0) - 8 || x > (campus.village?.x1 ?? 0) + 8));
    if (edge && !roomAt(x, z, 1.2) && !onStreet(x, z) && !inSquare(x, z, 1)) trees.push([x, z, 0.9 + rnd() * 0.7]);
  }
  if (hasKit("tree_round")) {
    // Visual rehaul 2026-11-13: four kinds of tree from the Blender kit (round, round 2, pine, birch), the season's
    // colours on their crowns, pines more often in the woods; kit benches, and planters with little shrubs.
    const SPECIES = ["tree_round", "tree_round2", "tree_pine", "tree_birch"], by = Object.fromEntries(SPECIES.map((k) => [k, []]));
    const pineTint = new THREE.Color(0x3f7a4c), birchTint = new THREE.Color(0x9cc56a);
    trees.forEach(([x, z, sc, fixed]) => {
      const r = rnd(), sp = fixed ? fixed : sc > 1.1 ? (r < 0.45 ? "tree_pine" : r < 0.8 ? "tree_round" : "tree_round2") : r < 0.42 ? "tree_round" : r < 0.66 ? "tree_round2" : r < 0.84 ? "tree_birch" : "tree_pine";
      const c = crownColour(col, SEASON, rnd).clone();
      if (sp === "tree_pine" && SEASON !== "winter") c.lerp(pineTint, 0.65);
      if (sp === "tree_birch" && SEASON === "summer") c.lerp(birchTint, 0.4);
      const s2 = sc * (1.05 + rnd() * 0.25);
      by[sp].push({ m: kitM(x, 0, z, rnd() * 6.28, s2, s2 * (0.92 + rnd() * 0.22), s2), c });
    });
    for (const sp of SPECIES) g.add(kitInstances(sp, by[sp]));
    g.add(kitInstances("bench", benches.map(([x, z, ry]) => ({ m: kitM(x, 0, z, ry) }))));
    g.add(kitInstances("planter", beds.map(([x, z, sc], i) => ({ m: kitM(x, 0, z, i, 0.75 * sc), c: col.setHSL([0.95, 0.12, 0.83, 0.33][i % 4], 0.55, 0.55).clone() }))));
    // flowers and rocks scattered on the lawns, bushes against the plinths of the offices
    const fl = [], rk = [], bu = [];
    for (let k = 0; k < 140; k++) { const x = b.x0 - pad + rnd() * (b.x1 - b.x0 + pad * 2), z = b.z0 - pad + rnd() * (b.z1 - b.z0 + pad * 2); if (roomAt(x, z, 0.5) || onStreet(x, z) || inSquare(x, z, 1)) continue; (k % 3 ? fl : rk).push({ m: kitM(x, 0, z, rnd() * 6.28, 0.8 + rnd() * 0.6), c: col.setHSL([0.95, 0.12, 0.83, 0.6, 0.0][k % 5], 0.7, 0.66).clone() }); }
    for (const r of rooms) { if (r.isHouse || r.isUnderground || r.tower) continue; for (let x = r.x + 0.4; x < r.x + r.w - 0.3; x += 0.9) if (Math.abs(x - (r.x + r.w / 2)) > 0.9) bu.push({ m: kitM(x, 0, r.y + r.d + 0.35, rnd() * 6, 0.65 + rnd() * 0.3), c: col.setHSL(0.3, 0.42, 0.36 + rnd() * 0.08).clone() }); }
    for (const [hx, hz] of hedges) bu.push({ m: kitM(hx, 0, hz, rnd() * 6, 0.75), c: col.setHSL(0.3, 0.42, 0.34 + rnd() * 0.06).clone() });
    g.add(kitInstances("flowers", fl), kitInstances("rocks", rk), kitInstances("bush", bu));
    g.userData.paved = paved;
    // obstacles for pathing (nav.js): trunks and crowns, benches, planters, bushes and hedges, rocks
    g.userData.obs = [...trees.map(([x, z, sc]) => [x, z, 0.32 * sc]), ...benches.map(([x, z]) => [x, z, 0.5]), ...beds.map(([x, z, sc]) => [x, z, 0.38 * sc]), ...hedges.map(([x, z]) => [x, z, 0.3]), ...bu.map((it) => { const e = it.m.elements; return [e[12], e[14], 0.26]; }), ...rk.map((it) => { const e = it.m.elements; return [e[12], e[14], 0.22]; })];
    g.dispose = () => { for (const k of g.children) k.dispose?.(); };
    return g;
  }
  // trees: trunk + crown, two instanced meshes with a little colour variation
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.11, 0.6, 7).translate(0, 0.3, 0), mats.solid(0x7a5232), trees.length);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 1).translate(0, 1.05, 0), std({ color: 0xffffff }), trees.length);
  trees.forEach(([x, z, sc], i) => {
    m4.compose(v4.set(x, 0, z), q4.identity(), new THREE.Vector3(sc, sc * (0.9 + rnd() * 0.3), sc)); trunk.setMatrixAt(i, m4); crown.setMatrixAt(i, m4);
    crown.setColorAt(i, crownColour(col, SEASON, rnd)); // seasons.js: autumn colours, snowy tops in winter
  });
  trunk.castShadow = crown.castShadow = true; crown.receiveShadow = true;
  // benches and flower beds
  const bench = new THREE.InstancedMesh(new RoundedBoxGeometry(0.9, 0.18, 0.32, 2, 0.04).translate(0, 0.32, 0), mats.solid(0x9a6b45), Math.max(1, benches.length));
  benches.forEach(([x, z, ry], i) => { m4.compose(v4.set(x, 0, z), q4.setFromAxisAngle(yAxis, ry), one); bench.setMatrixAt(i, m4); }); bench.count = benches.length; bench.castShadow = true;
  const bed = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.46, 0.3, 14).translate(0, 0.15, 0), std({ color: 0xffffff }), Math.max(1, beds.length));
  beds.forEach(([x, z, sc], i) => { m4.compose(v4.set(x, 0, z), q4.identity(), new THREE.Vector3(sc, 1, sc)); bed.setMatrixAt(i, m4); bed.setColorAt(i, col.setHSL([0.95, 0.12, 0.83, 0.58][i % 4], 0.6, 0.62)); }); bed.count = beds.length;
  g.add(trunk, crown, bench, bed);
  g.dispose = () => { for (const m of [trunk, crown, bench, bed]) { m.geometry.dispose(); m.dispose(); } };
  return g;
}
// Speed pass (the owner's list, 2026-11-09): every building used to cost two draws (its body and its windows), and the
// village has a house per worker. Now every building's windows share one instanced mesh, and the houses' bodies are
// merged into one. Each building keeps its own group (pick boxes, signs, setWindows/setNight), and its window colours
// are copied into its slice of the shared mesh whenever they change. About 145 draws down to about 60.
let winBatch = null, villageBody = null; // winBatch: one shared instanced mesh per window shape (house panes, office light strips)
const _bm = new THREE.Matrix4(), _bc = new THREE.Color(), _zero = new THREE.Matrix4().makeScale(0, 0, 0);
function batchCity() {
  city.updateMatrixWorld(true);
  const live = buildings.filter((b) => !b.userData.riseAt && b.children.some((o) => o.name === "windows"));
  winBatch = new Map();
  for (const bld of live) { const w = bld.children.find((o) => o.name === "windows"), k = w.geometry.uuid; if (!winBatch.has(k)) winBatch.set(k, { w, n: 0 }); winBatch.get(k).n += w.count; }
  for (const [k, e] of winBatch) { const m = new THREE.InstancedMesh(e.w.geometry, e.w.material, e.n); m.name = "windows-batch"; m.setColorAt(0, _bc.set(0)); m.frustumCulled = false; e.mesh = m; e.at = 0; city.add(m); }
  for (const bld of live) {
    const w = bld.children.find((o) => o.name === "windows"), e = winBatch.get(w.geometry.uuid), mesh = e.mesh;
    const from = e.at, n = w.count;
    bld.userData.win = { from, n, mats: [], mesh };
    for (let i = 0; i < n; i++) { w.getMatrixAt(i, _bm); _bm.premultiply(bld.matrixWorld); bld.userData.win.mats.push(_bm.clone()); mesh.setMatrixAt(e.at++, _bm); }
    bld.remove(w); // still painted by its own setWindows/setNight; we copy the colours across
    const copy = () => { for (let i = 0; i < n; i++) { w.getColorAt(i, _bc); mesh.setColorAt(from + i, _bc); } mesh.instanceColor.needsUpdate = true; };
    const sw = bld.setWindows, sn = bld.setNight;
    bld.setWindows = (fn) => { sw(fn); copy(); };
    bld.setNight = (v) => { sn(v); copy(); };
    copy();
  }
  // the village: every house body in one mesh (houses fade together under a filter, so one mesh is enough)
  const houses = buildings.filter((b) => b.userData.room?.isHouse);
  if (houses.length > 1) {
    const geos = [];
    for (const h of houses) { const body = h.children.find((o) => o.name === "body"); if (!body) continue; geos.push(body.geometry.clone().applyMatrix4(h.matrixWorld)); h.remove(body); body.geometry.dispose(); }
    villageBody = new THREE.Mesh(mergeParts(geos), mats.painted()); villageBody.name = "village"; villageBody.castShadow = villageBody.receiveShadow = true;
    city.add(villageBody);
  }
}
// A building faded out by the filter hides its windows in the shared mesh (they'd float in front of the faded walls).
function batchShow(bld, show) {
  const w = bld.userData.win;
  if (!w?.mesh) return;
  for (let i = 0; i < w.n; i++) w.mesh.setMatrixAt(w.from + i, show ? w.mats[i] : _zero);
  w.mesh.instanceMatrix.needsUpdate = true;
}
// Code-drawn taco truck: cream body, red awning, a window, four wheels, a 🌮 sign board and a bulb string.
function makeTacoTruck(x, z) {
  const g = new THREE.Group(); g.name = "tacotruck";
  const kt = kitOne("lm_foodtruck", { wide: 2.4 });
  if (kt) { kt.rotation.y = Math.PI / 2; g.add(kt); const { g: c, tex } = canvasTexture(128, 48); c.fillStyle = "#c94f4f"; c.fillRect(0, 0, 128, 48); c.fillStyle = "#fff"; c.font = "bold 26px system-ui"; c.textAlign = "center"; c.fillText("🌮 TACOS", 64, 33);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.4), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })); board.position.set(0, kt.userData.kitH + 0.3, 0.3); g.add(board);
    g.position.set(x, 0, z); g.rotation.y = Math.PI / 4; return g; }
  const blkM = (w, h, d, px, py, pz, c) => { const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.05), mats.solid(c)); m.position.set(px, py, pz); m.castShadow = true; g.add(m); return m; };
  blkM(2.0, 0.95, 0.95, 0, 0.62, 0, 0xf2ead8);           // body
  blkM(0.55, 0.7, 0.9, 1.2, 0.5, 0, 0xe0a43c);           // cab
  blkM(2.1, 0.08, 0.35, 0, 1.12, 0.62, 0xc94f4f);        // awning
  blkM(1.1, 0.42, 0.04, -0.05, 0.75, 0.48, 0x2b3a4a);    // serving window
  for (const [wx, wz] of [[-0.6, 0.45], [0.6, 0.45], [-0.6, -0.45], [0.6, -0.45]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 12), mats.solid(0x1b1f27)); w.rotation.x = Math.PI / 2; w.position.set(wx, 0.17, wz); g.add(w); }
  const { g: c, tex } = canvasTexture(128, 48);
  c.fillStyle = "#c94f4f"; c.fillRect(0, 0, 128, 48); c.fillStyle = "#fff"; c.font = "bold 26px system-ui"; c.textAlign = "center"; c.fillText("🌮 TACOS", 64, 33);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.4), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })); board.position.set(0, 1.38, 0.3); g.add(board);
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffd98a, toneMapped: false }), 9);
  for (let i = 0; i < 9; i++) bulbs.setMatrixAt(i, new THREE.Matrix4().makeTranslation(-1.0 + i * 0.25, 1.22 - Math.sin((i / 8) * Math.PI) * 0.1, 0.78));
  g.add(bulbs);
  g.position.set(x, 0, z); g.rotation.y = Math.PI / 4; // along the edge of the square
  return g;
}
let fountain = null, clock = null, seasonal = null, balloons = [];
const SEASON = seasonNow();
// The clock tower on the square (the owner's backlog): a slim stone tower with a clock face on each side showing the real
// time (repainted once a minute); tap it for what runs on a schedule (clockPanel in panels.js).
function makeClockTower(x, z) {
  const group = new THREE.Group(); group.name = "clocktower";
  const stone = mats.solid(0xd8ccb0), roof = mats.solid(0x8a6a4a);
  const add = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; group.add(m); return m; };
  add(new RoundedBoxGeometry(0.8, 0.3, 0.8, 2, 0.05), stone, 0.15);
  add(new RoundedBoxGeometry(0.62, 3.0, 0.62, 2, 0.06), stone, 1.8);
  add(new RoundedBoxGeometry(0.78, 0.18, 0.78, 2, 0.05), roof, 3.38);
  add(new THREE.ConeGeometry(0.5, 0.7, 4).rotateY(Math.PI / 4), roof, 3.82);
  const { g, tex } = canvasTexture(128);
  const faceMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
  for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(new THREE.CircleGeometry(0.26, 24), faceMat); const a = (k * Math.PI) / 2; f.position.set(x + Math.sin(a) * 0.315, 2.9, z + Math.cos(a) * 0.315); f.rotation.y = a; group.add(f); }
  let painted = "";
  const paint = (lit) => {
    const d = new Date(), key = `${d.getHours()}:${d.getMinutes()}:${lit}`; if (key === painted) return; painted = key;
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = lit ? "#ffe9b0" : "#f6f1e4"; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#3a3328"; g.lineWidth = 5; g.stroke();
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.beginPath(); g.moveTo(64 + Math.sin(a) * 48, 64 - Math.cos(a) * 48); g.lineTo(64 + Math.sin(a) * 54, 64 - Math.cos(a) * 54); g.stroke(); }
    const hA = ((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2, mA = (d.getMinutes() / 60) * Math.PI * 2;
    g.lineCap = "round"; g.lineWidth = 7; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.sin(hA) * 28, 64 - Math.cos(hA) * 28); g.stroke();
    g.lineWidth = 4; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.sin(mA) * 44, 64 - Math.cos(mA) * 44); g.stroke();
    tex.needsUpdate = true;
  };
  const pick = new THREE.Mesh(new THREE.BoxGeometry(1, 4.2, 1), mats.pick());
  pick.position.set(x, 2.1, z); pick.name = "pick"; pick.userData.room = "clocktower"; group.add(pick);
  return { group, pick, update() { paint((typeof night === "number" ? night : 0) > 0.3); } };
}
function makeFountain(q) {
  const group = new THREE.Group(); group.name = "fountain";
  const stone = mats.solid(0xe2d8c4), water = new THREE.MeshStandardMaterial({ color: 0x5fb4e8, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 });
  const add = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.set(q.x, y, q.y); m.castShadow = m.receiveShadow = true; group.add(m); return m; };
  // Visual rehaul 2026-11-13: the stonework is a tiered fountain from the prop kit (kit "lm_fountain"); the water stays
  // code-drawn so it can still show the budget. Without the kit, the old cylinders.
  const tri = kitOne("lm_fountain", { wide: 5.6, x: q.x, y: 0.04, z: q.y });
  let pool, top;
  if (tri) {
    group.add(tri); const H = tri.userData.kitH;
    pool = add(new THREE.CylinderGeometry(1.95, 1.95, 0.06, 40), water, 0.04 + H * 0.17);
    top = add(new THREE.CylinderGeometry(1.1, 1.1, 0.05, 32), water, 0.04 + H * 0.5);
  } else {
    add(new THREE.CylinderGeometry(2.6, 2.8, 0.55, 40), stone, 0.28);          // the outer basin
    pool = add(new THREE.CylinderGeometry(2.35, 2.35, 0.08, 40), water, 0.5);
    add(new THREE.CylinderGeometry(0.35, 0.5, 1.4, 16), stone, 1.1);           // the column
    add(new THREE.CylinderGeometry(1.2, 0.9, 0.25, 32), stone, 1.85);          // the upper bowl
    top = add(new THREE.CylinderGeometry(1.05, 1.05, 0.06, 32), water, 1.98);
    add(new THREE.SphereGeometry(0.28, 16, 12), stone, 2.25);
  }
  // jets: a ring of soft water arcs, scaled by how healthy the budget is
  const jet = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.07, 6, 32, Math.PI * 2), water);
  jet.rotation.x = Math.PI / 2; jet.position.set(q.x, 1.2, q.y); jet.visible = false; // replaced by droplets
  const spout = add(new THREE.ConeGeometry(0.16, 0.7, 12, 1, true), water, 2.65);
  // Water (the owner 2026-11-09: "is it doing any water?"): droplets arc from the top bowl down into the basin, in rings.
  const N = 220, dropPos = new Float32Array(N * 3), drops = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(dropPos, 3)),
    new THREE.PointsMaterial({ color: 0xcfeeff, size: 4, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false }));
  drops.frustumCulled = false; group.add(drops);
  const ripple = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.75, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe8f7ff, transparent: true, opacity: 0.5, depthWrite: false }));
  ripple.position.set(q.x, 0.56, q.y); group.add(ripple);
  const pick = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 3.4, 12), mats.pick());
  pick.position.set(q.x, 1.7, q.y); pick.name = "pick"; pick.userData.fountain = true; group.add(pick);
  return { group, pick, update(t) {
    const use = typeof budgetUse === "function" ? budgetUse() : 0, flow = use >= 1 ? 0 : use > 0.9 ? 0.3 : use > 0.6 ? 0.65 : 1;
    spout.visible = flow > 0; top.visible = flow > 0;
    spout.scale.set(1, 0.6 + flow * (0.8 + Math.sin(t / 300) * 0.08), 1);

    pool.material.opacity = flow ? 0.85 : 0.4;
    drops.visible = ripple.visible = flow > 0;
    for (let i = 0; i < N; i++) {
      const ring = i % 2, a = (i / N) * Math.PI * 2 * 7 + ring * 0.2, p = (t / (ring ? 1300 : 1000) + (i * 0.618) % 1) % 1;
      const r0 = ring ? 0.95 : 0.15, r1 = ring ? 1.9 : 1.0, y0 = ring ? 1.95 : 2.75, H = ring ? 0.35 : 0.9;
      const r = r0 + (r1 - r0) * p * flow, y = y0 + 4 * H * flow * p * (1 - p) - p * (y0 - (ring ? 0.58 : 2.0));
      dropPos[i * 3] = q.x + Math.cos(a) * r; dropPos[i * 3 + 1] = y; dropPos[i * 3 + 2] = q.y + Math.sin(a) * r;
    }
    drops.geometry.attributes.position.needsUpdate = true;
    const k = (t / 1600) % 1; ripple.scale.setScalar(0.75 + k * 0.4); ripple.material.opacity = 0.5 * (1 - k) * (flow > 0 ? 1 : 0);
  } };
}
// What a worker bought shows outside their house (the owner 2026-11-10: "they aren't decorating the side of their house
// with their stuff"). Campus Mart yard things and pets stand in the front yard as little picture signs (their emoji);
// gnomes, the barbecue and the hot tub are small models beside the house. Textures are kept per emoji across rebuilds.
const emojiTex = new Map();
function emojiTexture(ch) {
  if (emojiTex.has(ch)) return emojiTex.get(ch);
  const { g, tex: t } = canvasTexture(64);
  g.font = "48px system-ui, 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji'"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(ch, 32, 36);
  emojiTex.set(ch, t); return t;
}
const emojiMats = new Map();
const emojiMat = (ch) => { if (!emojiMats.has(ch)) emojiMats.set(ch, new THREE.SpriteMaterial({ map: emojiTexture(ch), transparent: true, depthWrite: false })); return emojiMats.get(ch); };
function yardStuff() {
  // Visual rehaul (2026-11-13): yard things and pets are their kit models (items.js), at village scale, beside the
  // path; anything without a model yet (a new store idea) is a little sign post with its emoji over it.
  const parts = [], glows = [], F = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] }, YS = 0.32;
  const put = (g, x, y, z) => { g.translate(x, y, z); return g; };
  for (const r of rooms) {
    if (!r.isHouse || !r.desk) continue;
    const own = shownOwned(r.desk.id); if (!own.length) continue;
    const [fx, fz] = F[r.face || "s"], sx = -fz, sz = fx; // front and sideways directions
    const cx = r.x + r.w / 2, cz = r.y + r.d / 2, half = (fx ? r.w : r.d) / 2, wide = (fx ? r.d : r.w) / 2;
    const at = (front, side) => [cx + fx * front + sx * side, cz + fz * front + sz * side], face = Math.atan2(fx, fz);
    const yard = [...itemsAt(r.desk.id, "yard").filter((k) => k !== "fence"), ...itemsAt(r.desk.id, "pets")].slice(0, 6);
    yard.forEach((k, i) => {
      const look = itemLook(k), side = (i % 2 ? 1 : -1) * (0.36 + Math.floor(i / 2) * 0.3), [x, z] = at(half + 0.32, side);
      let drawn = false;
      if (look.prop && hasKit("tree_round")) { const pc = kitPieces(look.prop, x, 0, z, face, YS * (look.place === "pets" ? 1.2 : 1)); parts.push(...pc.solid); glows.push(...pc.glow); drawn = true; }
      else if (k === "gnome") { parts.push(paint(put(new THREE.CylinderGeometry(0.05, 0.06, 0.12, 8), x, 0.06, z), new THREE.Color(0x4a7bd0)), paint(put(new THREE.SphereGeometry(0.045, 8, 6), x, 0.15, z), new THREE.Color(0xf1d2b6)), paint(put(new THREE.ConeGeometry(0.055, 0.14, 8), x, 0.25, z), new THREE.Color(0xe05d5d))); drawn = true; }
      if (look.stand || !drawn) { const sp = new THREE.Sprite(emojiMat(look.icon)); sp.scale.set(0.3, 0.3, 1); sp.position.set(x, drawn ? 0.42 : 0.2, z); sp.name = "yard-item"; city.add(sp); }
    });
    void wide;
  }
  // the old models need UVs to merge with kit pieces
  for (const g of parts) if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  for (const g of parts) if (g.index) { const n = g.toNonIndexed(); parts[parts.indexOf(g)] = n; }
  if (parts.length) { const m = new THREE.Mesh(mergeParts(parts), mats.painted()); m.castShadow = true; m.name = "yard-stuff"; city.add(m); }
  if (glows.length) { const m = new THREE.Mesh(mergeParts(glows), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })); m.name = "yard-glow"; city.add(m); }
}
// A worker's things at work, from the belongings rule (city.js ownAt): kept-from-home things first, then priciest.
function deskThings(id) {
  if (typeof ownAt !== "function") return itemsAt(id, "desk").filter((k) => k !== "chair");
  const P = data.perks || {};
  return ownAt(id, "desk").filter((k) => k !== "chair" && P[k]).sort((a, b) => (P[a].cat === "desk") - (P[b].cat === "desk") || (P[b].cost || 0) - (P[a].cost || 0));
}
// Merge a list of plain parts and kit pieces into the city (plain parts get UVs and lose their index to merge).
function addMerged(parts, glows, name, parent = city) {
  for (const g of parts) if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  for (let i = 0; i < parts.length; i++) if (parts[i].index) parts[i] = parts[i].toNonIndexed();
  if (parts.length) { const m = new THREE.Mesh(mergeParts(parts), mats.painted()); m.castShadow = m.receiveShadow = true; m.name = name; parent.add(m); }
  if (glows.length) { const m = new THREE.Mesh(mergeParts(glows), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })); m.name = name + "-glow"; parent.add(m); }
}
// The community garden in 3D (city.js cityGarden lays it out; belongings.js says what goes on each plot): a gravel lot
// inside a low hedge with its gate on the lane side and a word sign, a grass plot per owner with a name tag, and their
// big outdoor things as the same kit models the houses used (koi pond, treehouse, hot tub, barbecue, flower bed,
// mailbox at the plot's edge), a picket fence round a plot whose owner bought one. Nothing taller than a tree.
function makeGarden3d(r) {
  if (r.garden === "shared") return makeSharedGarden3d(r); // the gardens lane (below)
  if (r.garden === "break") return makeBreakGarden3d(r);
  const g = new THREE.Group(), parts = [], glows = [], C = (h) => new THREE.Color(h), S = 0.42;
  const hedge = C(0x5a9448), gravel = C(0xd9cfb8), grass = C(0x78b45e), soil = C(0x7a5a3c), fenceC = C(0xf4efe4), wood = C(0x8b6a4a);
  const { w, d } = r, gate = 0.7, gz = r.gateY - r.y;
  parts.push(box(w, 0.04, d, w / 2, 0.02, d / 2, gravel, 0));
  // the hedge: three sides whole, the lane side with the gate gap
  for (const [hw, hd, hx, hz] of [[w + 0.24, 0.14, w / 2, -0.07], [w + 0.24, 0.14, w / 2, d + 0.07], [0.14, d, -0.07, d / 2], [0.14, (d - gate) / 2, w + 0.07, (d - gate) / 4], [0.14, (d - gate) / 2, w + 0.07, d - (d - gate) / 4]]) parts.push(box(hw, 0.24, hd, hx, 0.12, hz, hedge, 0.04));
  const kit = (k, x, z, s = S, ry = 0) => { const look = itemLook(k); if (look.prop && hasKit(look.prop)) { const pc = kitPieces(look.prop, x, 0.04, z, ry, s); parts.push(...pc.solid); glows.push(...pc.glow); } if (look.stand || !look.prop) { const sp = new THREE.Sprite(emojiMat(look.icon)); sp.scale.set(0.3, 0.3, 1); sp.position.set(x, 0.45, z); g.add(sp); } };
  for (const f of r.free) parts.push(box(f.w, 0.03, f.d, f.x - r.x + f.w / 2, 0.05, f.y - r.y + f.d / 2, soil, 0));
  for (const p of r.plots) {
    const px = p.x - r.x, pz = p.y - r.y, life = data.wallets?.[p.id]?.living || [];
    parts.push(box(p.w, 0.05, p.d, px + p.w / 2, 0.05, pz + p.d / 2, grass, 0));
    const spots = [[0.28, 0.3], [0.72, 0.3], [0.28, 0.68], [0.72, 0.68]];
    let s = 0;
    for (const k of p.garden) {
      if (k === "fence") { const e = 0.05; for (const [x0, z0, x1, z1] of [[e, e, p.w - e, e], [e, p.d - e, p.w - e, p.d - e], [e, e, e, p.d - e], [p.w - e, e, p.w - e, p.d - e]]) { const len = Math.hypot(x1 - x0, z1 - z0), along = x1 !== x0; parts.push(box(along ? len : 0.03, 0.03, along ? 0.03 : len, px + (x0 + x1) / 2, 0.16, pz + (z0 + z1) / 2, fenceC, 0)); for (let t = 0; t <= 1.001; t += 0.2) parts.push(box(0.035, 0.22, 0.035, px + x0 + (x1 - x0) * t, 0.11, pz + z0 + (z1 - z0) * t, fenceC, 0)); } continue; }
      if (k === "mailbox") { kit(k, px + p.w - 0.15, pz + p.d - 0.1, S * 0.9); continue; }
      const [fx, fz] = spots[s++ % spots.length], v = life.find((x) => x.item === k), sz = v ? [0.8, 1, 1.2][(v.size || 1) - 1] : 1;
      if (k === "garden") parts.push(box(0.5, 0.05, 0.36, px + p.w * fx, 0.08, pz + p.d * fz, soil, 0));
      kit(k, px + p.w * fx, pz + p.d * fz, S * sz * (k === "treehouse" ? 1.1 : 1), v?.need === "wilting" ? 0.5 : 0);
    }
    // the name tag on a stake at the plot's front (words, never colour alone)
    parts.push(box(0.03, 0.2, 0.03, px + p.w / 2, 0.12, pz + p.d - 0.06, wood, 0));
    sign(g, p.name, px + p.w / 2, 0.42, pz + p.d - 0.06, "small");
  }
  // the gate posts and the word sign: a board on two posts by the gate
  for (const dz of [-gate / 2, gate / 2]) parts.push(box(0.06, 0.4, 0.06, w + 0.07, 0.2, gz + dz, wood, 0));
  parts.push(box(0.05, 0.5, 0.05, w + 0.35, 0.25, gz + gate / 2 + 0.25, wood, 0), box(0.05, 0.5, 0.05, w + 0.35, 0.25, gz + gate / 2 + 0.85, wood, 0), box(0.04, 0.22, 0.7, w + 0.37, 0.48, gz + gate / 2 + 0.55, C(0xe9dcc0), 0.01));
  sign(g, "Community garden", w + 0.4, 0.95, gz + gate / 2 + 0.55);
  addMerged(parts, glows, "garden", g);
  // a tap anywhere on the lot opens the garden's panel
  const pick = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.8, d + 0.3), new THREE.MeshBasicMaterial({ visible: false }));
  pick.position.set(w / 2 + 0.15, 0.4, d / 2); pick.name = "pick"; pick.userData.project = r.id; g.add(pick);
  g.name = "garden"; g.userData = { project: r.id, name: r.name, w, d, h: 0.9 };
  return g;
}
// The gardens lane (2026-11-16): the community garden's shared part and the break garden by the work wings, in 3D.
// Where things stand comes from city.js gardenLayout(r) (the same list the 2D view draws); everything is code-drawn
// boxes merged into one mesh per garden, plus the kit's own trees, benches and flowers where the kit is there. Their
// string lights go into one city-wide mesh (gardenLights) that applyNight shows after dark; their lamps join the city's.
let gardenLights = null, gardenLightParts = [];
function gardenHedge3d(parts, r, gate, color) {
  const { w, d } = r, G = 0.8, T = 0.14, H = 0.26;
  const at = gate.side === "n" || gate.side === "s" ? gate.at - r.x : gate.at - r.y;
  for (const side of ["n", "s", "w", "e"]) {
    const horiz = side === "n" || side === "s", len = horiz ? w + 0.28 : d, fixed = side === "n" ? -0.07 : side === "s" ? d + 0.07 : side === "w" ? -0.07 : w + 0.07;
    const segs = gate.side === side ? [[horiz ? -0.14 : 0, at - G / 2], [at + G / 2, horiz ? w + 0.14 : d]] : [[horiz ? -0.14 : 0, horiz ? -0.14 + len : d]];
    for (const [a, b] of segs) {
      if (b - a < 0.05) continue;
      const mid = (a + b) / 2;
      parts.push(horiz ? box(b - a, H, T, mid, H / 2, fixed, color, 0.05) : box(T, H, b - a, fixed, H / 2, mid, color, 0.05));
      navObs.push(horiz ? ["rect", r.x + a, r.y + fixed - 0.1, b - a, 0.2] : ["rect", r.x + fixed - 0.1, r.y + a, 0.2, b - a]);
    }
  }
}
function gardenBench3d(parts, glows, b, ox, oz) {
  const len = b.len || 0.8, x = b.x - ox, z = b.y - oz, wood = new THREE.Color(0x9a6f48), iron = new THREE.Color(0x4a4f57);
  if (!b.table && hasKit("bench")) { const pc = kitPieces("bench", x, 0, z, b.hd === 0 ? Math.PI : 0, 0.82); parts.push(...pc.solid); glows.push(...pc.glow); return; }
  parts.push(box(len, 0.05, 0.26, x, 0.24, z, wood, 0.02));
  for (const sx of [-1, 1]) parts.push(box(0.05, 0.22, 0.2, x + sx * (len / 2 - 0.08), 0.11, z, iron, 0));
  if (!b.table) parts.push(box(len, 0.2, 0.05, x, 0.4, z + (b.hd === 0 ? -0.13 : 0.13), wood, 0.02));
}
function gardenTree3d(parts, glows, x, z, s = 0.8) {
  if (hasKit("tree_round")) { const pc = kitPieces("tree_round", x, 0, z, (x * 7 + z * 3) % 6.28, s, crownColour(new THREE.Color(), SEASON, () => 0.5)); parts.push(...pc.solid); glows.push(...pc.glow); return; }
  parts.push(box(0.12, 0.7, 0.12, x, 0.35, z, new THREE.Color(0x7a5232), 0), box(0.8 * s, 0.8 * s, 0.8 * s, x, 0.7 + 0.4 * s, z, new THREE.Color(0x5f9e52), 0.25));
}
function gardenBed3d(parts, glows, x, z, rad) {
  const g = new THREE.CylinderGeometry(rad, rad * 1.05, 0.1, 14); g.translate(x, 0.06, z); parts.push(paint(g, new THREE.Color(0x7a5a3c)));
  if (hasKit("flowers")) { const pc = kitPieces("flowers", x, 0.08, z, 0, rad * 2.1); parts.push(...pc.solid); glows.push(...pc.glow); return; }
  ["#e05d8a", "#f0b45a", "#f4ecdc", "#b48cff"].forEach((c, i) => { const a = (i / 4) * Math.PI * 2; parts.push(box(0.09, 0.09, 0.09, x + Math.cos(a) * rad * 0.5, 0.16, z + Math.sin(a) * rad * 0.5, new THREE.Color(c), 0.03)); });
}
function gardenSign3d(g, parts, text, sx, sz, ox, oz) {
  const wood = new THREE.Color(0x8b6a4a), x = sx - ox, z = sz - oz;
  parts.push(box(0.05, 0.5, 0.05, x - 0.3, 0.25, z, wood, 0), box(0.05, 0.5, 0.05, x + 0.3, 0.25, z, wood, 0), box(0.7, 0.22, 0.04, x, 0.48, z, new THREE.Color(0xe9dcc0), 0.01));
  sign(g, text, x, 0.95, z);
}
// a little string of bulbs from a to b (world tiles) at height y, sagging in the middle: into the night-only mesh
function gardenString3d(a, b, y, n = 8) {
  for (let i = 1; i < n; i++) { const k = i / n, g = new THREE.SphereGeometry(0.035, 6, 4); g.translate(a[0] + (b[0] - a[0]) * k, y - Math.sin(k * Math.PI) * 0.09, a[1] + (b[1] - a[1]) * k); gardenLightParts.push(paint(g, new THREE.Color(0xffe2a0))); }
}
function gardenPick(g, r) {
  const pick = new THREE.Mesh(new THREE.BoxGeometry(r.w + 0.3, 0.8, r.d + 0.3), new THREE.MeshBasicMaterial({ visible: false }));
  pick.position.set(r.w / 2, 0.4, r.d / 2); pick.name = "pick"; pick.userData.project = r.id; g.add(pick);
  g.name = r.id; g.userData = { project: r.id, name: r.name, w: r.w, d: r.d, h: 0.9, lamps: [gardenLayout(r).lamp, gardenLayout(r).lamp2].filter(Boolean).map(([x, z]) => ({ x, z, ry: Math.PI * 0.75 })) };
}
function makeSharedGarden3d(r) {
  const g = new THREE.Group(), parts = [], glows = [], C = (h) => new THREE.Color(h), L = gardenLayout(r), ox = r.x, oz = r.y, { w, d } = r;
  parts.push(box(w, 0.04, d, w / 2, 0.02, d / 2, C(0x8fc477), 0));
  gardenHedge3d(parts, r, L.gate, C(0x5a9448));
  for (const p of L.paths) parts.push(box(p.w, 0.03, p.d, p.x - ox + p.w / 2, 0.05, p.y - oz + p.d / 2, C(0xd9cfb8), 0));
  // the shared vegetable patch: three rows, a crop per job finished this week (up to 8; city.js sharedCrops), sprouts on the rest
  const P = L.patch, crops = sharedCrops(), soilDark = C(0x5f4530);
  parts.push(box(P.w, 0.08, P.d, P.x - ox + P.w / 2, 0.06, P.y - oz + P.d / 2, C(0x7a5a3c), 0.02));
  for (let i = 0; i < 3; i++) parts.push(box(P.w - 0.2, 0.03, 0.1, P.x - ox + P.w / 2, 0.11, P.y - oz + (P.d * (i + 0.5)) / 3, soilDark, 0));
  for (let k = 0; k < 12; k++) {
    const i = Math.floor(k / 4), j = k % 4, cx = P.x - ox + (P.w * (j + 0.5)) / 4, cz = P.y - oz + (P.d * (i + 0.5)) / 3;
    parts.push(k < crops ? box(0.2, 0.15, 0.2, cx, 0.19, cz, C(0x4f9a48), 0.07) : box(0.07, 0.07, 0.07, cx, 0.15, cz, C(0x9ccc72), 0.02));
  }
  // the pergola over the north bench (posts, two beams, five slats) with string lights
  const G = L.pergola, gx0 = G.x - ox, gz0 = G.y - oz, wood = C(0x8b6a4a);
  for (const [px, pz] of [[gx0, gz0], [gx0 + G.w, gz0], [gx0, gz0 + G.d], [gx0 + G.w, gz0 + G.d]]) parts.push(box(0.08, 1.12, 0.08, px, 0.56, pz, wood, 0.02));
  for (const pz of [gz0, gz0 + G.d]) parts.push(box(G.w + 0.24, 0.07, 0.08, gx0 + G.w / 2, 1.12, pz, wood, 0.01));
  for (let k = 0; k <= 4; k++) parts.push(box(0.06, 0.05, G.d + 0.24, gx0 + (G.w * k) / 4, 1.18, gz0 + G.d / 2, wood, 0.01));
  gardenString3d([G.x, G.y], [G.x + G.w, G.y], 1.08); gardenString3d([G.x, G.y + G.d], [G.x + G.w, G.y + G.d], 1.08); gardenString3d([G.x, G.y], [G.x + G.w, G.y + G.d], 1.1, 10);
  for (const b of L.benches) gardenBench3d(parts, glows, b, ox, oz);
  // the tap and the watering can
  parts.push(box(0.07, 0.5, 0.07, L.tap[0] - ox, 0.25, L.tap[1] - oz, C(0x9aa3ad), 0), box(0.05, 0.05, 0.14, L.tap[0] - ox, 0.46, L.tap[1] - oz + 0.06, C(0x9aa3ad), 0));
  parts.push(box(0.16, 0.16, 0.12, L.can[0] - ox, 0.12, L.can[1] - oz, C(0x5f8fb0), 0.04), box(0.04, 0.04, 0.16, L.can[0] - ox + 0.1, 0.18, L.can[1] - oz, C(0x5f8fb0), 0));
  for (const b of L.beds) gardenBed3d(parts, glows, b[0] - ox, b[1] - oz, b[2]);
  for (const t of L.trees) { gardenTree3d(parts, glows, t[0] - ox, t[1] - oz, 0.7); navObs.push(["circle", t[0], t[1], 0.3]); }
  gardenSign3d(g, parts, "Shared garden", L.sign[0], L.sign[1], ox, oz);
  addMerged(parts, glows, "garden-shared", g);
  gardenPick(g, r);
  return g;
}
function makeBreakGarden3d(r) {
  const g = new THREE.Group(), parts = [], glows = [], C = (h) => new THREE.Color(h), L = gardenLayout(r), ox = r.x, oz = r.y, { w, d } = r;
  parts.push(box(w, 0.04, d, w / 2, 0.02, d / 2, C(0x8fc477), 0));
  gardenHedge3d(parts, r, L.gate, C(0x5a9448));
  for (const p of L.paths) parts.push(box(p.w, 0.03, p.d, p.x - ox + p.w / 2, 0.05, p.y - oz + p.d / 2, C(0xd9cfb8), 0));
  // the pond: still water, a ring of stones and lily pads (no jets, no basin: it is not the budget fountain)
  const P = L.pond, px = P.x - ox, pz = P.y - oz;
  { const rim = new THREE.CylinderGeometry(P.r + 0.14, P.r + 0.16, 0.08, 24); rim.translate(px, 0.05, pz); parts.push(paint(rim, C(0xb9b1a0)));
    const water = new THREE.CylinderGeometry(P.r, P.r, 0.04, 24); water.translate(px, 0.08, pz); parts.push(paint(water, C(0x5fa6cc)));
    for (const [du, dv] of [[-0.35, -0.2], [0.25, 0.2], [0.05, -0.45]]) { const pad = new THREE.CylinderGeometry(0.1, 0.1, 0.015, 10); pad.translate(px + du * P.r, 0.105, pz + dv * P.r); parts.push(paint(pad, C(0x4f9a48))); }
    navObs.push(["circle", P.x, P.y, P.r + 0.15]); }
  // the picnic table and its two benches
  const T = L.table, tx = T.x - ox, tz = T.y - oz, wood = C(0xb58a5e);
  parts.push(box(T.w, 0.05, T.d, tx, 0.44, tz, wood, 0.02));
  for (const sx of [-1, 1]) parts.push(box(0.06, 0.42, T.d * 0.8, tx + sx * (T.w / 2 - 0.12), 0.21, tz, C(0x86603e), 0));
  navObs.push(["rect", T.x - T.w / 2, T.y - T.d / 2, T.w, T.d]);
  for (const b of L.benches) gardenBench3d(parts, glows, b, ox, oz);
  for (const b of L.beds) gardenBed3d(parts, glows, b[0] - ox, b[1] - oz, b[2]);
  for (const t of L.trees) { gardenTree3d(parts, glows, t[0] - ox, t[1] - oz, 0.75); navObs.push(["circle", t[0], t[1], 0.3]); }
  // string lights over the picnic table, between two of its corners' posts
  for (const sx of [-1, 1]) parts.push(box(0.05, 1.1, 0.05, tx + sx * (T.w / 2 + 0.15), 0.55, tz - 0.65, C(0x8b6a4a), 0));
  gardenString3d([T.x - T.w / 2 - 0.15, T.y - 0.65], [T.x + T.w / 2 + 0.15, T.y - 0.65], 1.06, 7);
  gardenSign3d(g, parts, "Break garden", L.sign[0], L.sign[1], ox, oz);
  addMerged(parts, glows, "break-garden", g);
  gardenPick(g, r);
  return g;
}
// Balcony things on the Residences towers, seen from outside (belongings.js "balcony": a barbecue, gnomes, a lawn
// flamingo, a flower garden as planters), small kit models on each flat's balcony. balconySpots keeps where each
// owner would stand on their balcony, so placeSitters can show them out there now and then when they're home.
let balconySpots = [];
function balconyStuff() {
  balconySpots = [];
  if (typeof ownAt !== "function") return;
  const parts = [], glows = [], BD = [0, 0.42, 0.5, 0.7];
  // a flat's front (makeResidence: the bays step in, the penthouse stands back behind its terrace), from its unturned x
  const insetAt = (bld, x) => (bld.userData.bays || []).find((b) => x >= b.x0 - 1e-6 && x <= b.x1 + 1e-6)?.inset || 0;
  for (const bld of buildings) {
    const r = bld.userData.room; if (!r?.isHomes) continue;
    const RH = bld.userData.storeyH, L = bld.userData.lobby;
    for (const f of r.floors) {
      if (f.level < 1) continue;
      const k = Math.max(1, f.perFloor || f.flats.length), cw = r.w / k, bd = BD[f.level], y = L + (f.storey - 1) * RH + 0.08;
      const flip = !!bld.userData.flipped; // the quad's long block: balconies on its north side (turned 180 degrees)
      f.flats.forEach((id, j) => {
        if (!id) return;
        const pent = f.level === 3, ins = insetAt(bld, cw * (j + 0.5)), out = pent ? -(bld.userData.pentSet || 0.6) / 2 : bd * 0.5; // a penthouse's things stand on its terrace
        const cx = flip ? r.x + r.w - cw * (j + 0.5) : r.x + cw * (j + 0.5), z = flip ? r.y + ins - out : r.y + r.d - ins + out, keys = ownAt(id, "balcony");
        keys.forEach((key, i) => {
          const look = itemLook(key), x = cx - cw * 0.3 + (cw * 0.6 * (i + 0.5)) / Math.max(1, keys.length);
          if (look.prop && hasKit(look.prop)) { const pc = kitPieces(look.prop, x, y, z, 0, 0.26); parts.push(...pc.solid); glows.push(...pc.glow); }
          if (look.stand || !look.prop) { const sp = new THREE.Sprite(emojiMat(look.icon)); sp.scale.set(0.22, 0.22, 1); sp.position.set(x, y + 0.2, z); sp.name = "balcony-item"; city.add(sp); }
        });
        balconySpots.push({ id, x: flip ? cx - cw * 0.28 : cx + cw * 0.28, y: y - 0.02, z: flip ? r.y + ins - out * 1.2 : r.y + r.d - ins + out * 1.2 });
      });
    }
  }
  addMerged(parts, glows, "balcony-stuff");
}
// The Underground (plan B+C): a project that was paused last time and is running now rises out of the ground.
let prevUnder = null;
const hashSeed = (id) => { let h = 7; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 97; };
// The glass office style by district (visual rehaul 2026-11-13): Creative brick, Games graphite with neon, Tools pale
// stone, and sandstone with bronze for the owner's own (the CEO tower), HR and the rest.
const styleOf = (r) => (hasKit("tree_round") ? ({ Creative: "brick", Games: "graphite", Tools: "stone" }[r.district] || "sand") : null);
// Workers at their desks right now, seen through the glass: a small seated fella per worker, in their shirt colour.
const SIT_MAX = 200;
const sitBodies = new THREE.InstancedMesh(new RoundedBoxGeometry(0.2, 0.2, 0.16, 2, 0.06).translate(0, 0.32, 0), mats.people(), SIT_MAX);
const sitHeads = new THREE.InstancedMesh(new RoundedBoxGeometry(0.28, 0.25, 0.25, 3, 0.11).translate(0, 0.55, 0), std({ color: 0xf7f7f4, roughness: 0.26, metalness: 0.04 }), SIT_MAX);
sitBodies.count = sitHeads.count = 0; sitBodies.frustumCulled = sitHeads.frustumCulled = false; sitBodies.castShadow = sitHeads.castShadow = true; scene.add(sitBodies, sitHeads);
function placeSitters() {
  let n = 0;
  if (!view) for (const bld of buildings) {
    const seats = bld.userData.seats, r = bld.userData.room; if (!seats) continue;
    const floorsOf = r.members ? r.members.map((m) => ({ desks: m.desks || [] })) : r.floors || [];
    seats.forEach((list, k) => {
      const here = (floorsOf[k]?.desks || []).filter((d) => typeof whereIs !== "function" || whereIs(d) === "work");
      here.slice(0, list.length).forEach((d, i) => {
        if (n >= SIT_MAX) return;
        const se = list[i]; m4.compose(v4.set(bld.position.x + se.x, se.y * bld.scale.y, bld.position.z + se.z), q4.setFromAxisAngle(yAxis, Math.PI + bld.rotation.y), one);
        sitBodies.setMatrixAt(n, m4); sitHeads.setMatrixAt(n, m4); sitBodies.setColorAt(n, col.set(PROVIDER3[d.provider] || PROVIDER3.other)); n++;
      });
    });
  }
  // Residents out on their balcony now and then when they're home (city.js onBalconyNow: about one minute in three)
  if (!view && typeof onBalconyNow === "function") for (const s of balconySpots) {
    const d = typeof deskById === "function" && deskById(s.id);
    if (n >= SIT_MAX || !d || whereIs(d) !== "home" || !onBalconyNow(s.id)) continue;
    m4.compose(v4.set(s.x, s.y, s.z), q4.setFromAxisAngle(yAxis, 0), one);
    sitBodies.setMatrixAt(n, m4); sitHeads.setMatrixAt(n, m4); sitBodies.setColorAt(n, col.set(PROVIDER3[d.provider] || PROVIDER3.other)); n++;
  }
  // Residents in the shared garden in the evening (the gardens lane; city.js sharedSittersNow: home, not out walking,
  // not on their balcony this minute), on its benches or at the vegetable patch
  const sg = !view && typeof gardenRoomById === "function" && gardenRoomById("garden-shared");
  if (sg) for (const { d, seat } of sharedSittersNow(sg)) {
    if (n >= SIT_MAX) break;
    m4.compose(v4.set(seat[0], seat[3] === "patch" ? -0.12 : 0.04, seat[1]), q4.setFromAxisAngle(yAxis, seat[2] + Math.PI), one);
    sitBodies.setMatrixAt(n, m4); sitHeads.setMatrixAt(n, m4); sitBodies.setColorAt(n, col.set(PROVIDER3[d.provider] || PROVIDER3.other)); n++;
  }
  sitBodies.count = sitHeads.count = n; sitBodies.instanceMatrix.needsUpdate = sitHeads.instanceMatrix.needsUpdate = true; if (sitBodies.instanceColor) sitBodies.instanceColor.needsUpdate = true;
}
// Puts a building on the city at its tile and registers its pick boxes (pickId null: each pick keeps its own project).
function placeBuilding(bld, x, y, room, pickId, track = true) {
  bld.position.set(x, 0, y); bld.userData.room = room; city.add(bld); if (track) buildings.push(bld);
  bld.traverse((o) => { if (o.name === "pick") { o.userData.room = pickId ?? o.userData.project; picks.push(o); } });
}
let navObs = [];
// The quad layout's covered walks (2026-11-16, plan B): the concourse round the quad, along the north range and on down
// to the Residences, under a light roof on slim posts; the skybridges between a wing's rows. Two draws in all (posts,
// fascias and bridges merged into one mesh; the roof glass in another), and a word sign on each kind of walk.
const CONC_H = 1.45;
function makeQuadWalks() {
  const solid = [], glass = [], post = new THREE.Color(0xf1ece0), fascia = new THREE.Color(0xd9cfb6), bridge = new THREE.Color(0xe6dfcc);
  for (const c of campus.concourse || []) {
    const along = c.w >= c.d, len = along ? c.w : c.d, cx = c.x + c.w / 2, cz = c.y + c.d / 2;
    for (let t = 0.35; t <= len - 0.3; t += 2.2) for (const e of [0.12, (along ? c.d : c.w) - 0.12]) {
      const [x, z] = along ? [c.x + t, c.y + e] : [c.x + e, c.y + t];
      solid.push(box(0.09, CONC_H, 0.09, x, CONC_H / 2, z, post, 0)); navObs.push(["circle", x, z, 0.12]);
    }
    solid.push(box(c.w + 0.1, 0.1, 0.1, cx, CONC_H, along ? c.y + 0.05 : cz, fascia, 0), box(c.w + 0.1, 0.1, 0.1, cx, CONC_H, along ? c.y + c.d - 0.05 : cz, fascia, 0));
    if (!along) solid.push(box(0.1, 0.1, c.d, c.x + 0.05, CONC_H, cz, fascia, 0), box(0.1, 0.1, c.d, c.x + c.w - 0.05, CONC_H, cz, fascia, 0));
    glass.push(new THREE.BoxGeometry(c.w + 0.12, 0.05, c.d + 0.12).translate(cx, CONC_H + 0.08, cz));
  }
  for (const b of campus.skybridges || []) solid.push(box(b.w + 0.2, 0.55, b.d, b.x + b.w / 2, 2.1, b.y + b.d / 2, bridge, 0.03), box(b.w + 0.2, 0.06, b.d + 0.1, b.x + b.w / 2, 2.4, b.y + b.d / 2, fascia, 0));
  if (solid.length) { const m = new THREE.Mesh(mergeParts(solid), mats.painted()); m.castShadow = true; m.receiveShadow = true; m.name = "concourse-posts"; city.add(m); }
  if (glass.length) { const m = new THREE.Mesh(mergeParts(glass), new THREE.MeshStandardMaterial({ color: 0xdfeaf0, roughness: 0.2, metalness: 0.05, transparent: true, opacity: 0.45, depthWrite: false })); m.name = "concourse-roof"; m.receiveShadow = true; city.add(m); }
  // words on the walks (never colour alone): the concourse, the walk to the homes, and each skybridge
  const at = (x, z, y, text) => { const a = new THREE.Object3D(); a.position.set(x, y, z); city.add(a); sign(a, text, 0, 0, 0, "small"); };
  const n = (campus.concourse || []).find((c) => c.part === "north"), wk = (campus.concourse || []).find((c) => c.part === "garden walk");
  if (n) at(n.x + n.w / 2, n.y + n.d / 2, CONC_H + 0.5, "Covered concourse");
  if (wk) at(wk.x + wk.w / 2, wk.y + wk.d / 2, CONC_H + 0.5, "Covered walk · Residences");
  for (const b of campus.skybridges || []) at(b.x + b.w / 2, b.y + b.d / 2, 2.9, "Skybridge");
  const L = campus.lawn; if (L && L.d > 1.5) at(L.x + L.w / 2, L.y + L.d / 2, 0.4, "The quad");
  if (campus.ring) { const rg = campus.ring; at((rg.x0 + rg.x1) / 2, rg.y1 - rg.street / 2, 0.4, "Ring road · tram loop"); }
  if (campus.river) at((campus.river.x0 + campus.river.x1) / 2, campus.river.y + campus.river.d / 2, 0.4, "River");
}
function buildCity() {
  clearCity(); navObs = []; gardenLightParts = []; gardenLights = null;
  const rising = new Set(prevUnder ? [...prevUnder].filter((id) => rooms.some((r) => r.id === id && !r.paused)) : []);
  prevUnder = new Set((campus.underground || []).map((r) => r.id));
  city = new THREE.Group(); city.name = "city"; scene.add(city);
  const b = bounds(), pad = 8;
  // Ground and streets: one merged mesh; the streets are the rectangles in campus.roads, the same as the 2D view.
  const parts = [];
  const flat = (w, d, x, z, y, color) => { const g = new THREE.BoxGeometry(w, 0.04, d); g.translate(x, y - 0.02, z); parts.push(paint(g, color)); };
  flat(b.x1 - b.x0 + pad * 2, b.z1 - b.z0 + pad * 2, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, 0, COLORS.grass);
  // Plan B+C: every street is a rectangle from layoutBC/cityHouses. Asphalt with pale kerbs on the work side, a
  // paved promenade across the plaza row, a wide main street with a dashed centre line and planted median,
  // gravel lanes in the village and a stone path along the river.
  // The quad layout (2026-11-16) adds the ring road (asphalt, the tram loop), the quad (paving) and the concourse (pale
  // stone under its roof, buildCity's concourse roof).
  const T = { street: [COLORS.kerb, COLORS.road], ring: [COLORS.kerb, COLORS.road], main: [new THREE.Color(0xd8d0bc), new THREE.Color(0x7d828c)], "plaza-row": [new THREE.Color(0xcfc4a8), new THREE.Color(0xd9cfb6)], quad: [new THREE.Color(0xcfc4a8), new THREE.Color(0xddd3bb)], concourse: [new THREE.Color(0xb9ad8e), new THREE.Color(0xeee6d2)], lane: [new THREE.Color(0xb7a98c), new THREE.Color(0xcbbd9c)], path: [new THREE.Color(0xb3a891), new THREE.Color(0xc9bfa8)] };
  const order = { lane: 0, path: 0, street: 1, ring: 1, main: 2, quad: 2, "plaza-row": 3, concourse: 3 };
  for (const q of [...campus.roads].sort((a, c) => order[a.kind] - order[c.kind])) {
    const [kerb, top] = T[q.kind] || T.street, y = 0.02 + order[q.kind] * 0.004, cx = q.x + q.w / 2, cz = q.y + q.d / 2;
    flat(q.w + 0.3, q.d + 0.3, cx, cz, y, kerb); flat(Math.max(0.2, q.w - (q.kind === "lane" ? 0.2 : 0.5)), Math.max(0.2, q.d - (q.kind === "lane" ? 0.2 : 0.5)), cx, cz, y + 0.02, top);
    if (q.kind === "main") {
      // pavements both sides, a planted median with a line of little trees' beds, and dashes either side of it
      for (const sx of [-1, 1]) flat(0.9, q.d, cx + sx * (q.w / 2 - 0.45), cz, y + 0.025, new THREE.Color(0xd9d2c2));
      flat(0.7, q.d - 1, cx, cz, y + 0.03, new THREE.Color(0x86b86e));
      for (let z = q.y + 1; z < q.y + q.d - 0.6; z += 1.4) for (const sx of [-1, 1]) flat(0.08, 0.6, cx + sx * 1.1, z, y + 0.03, COLORS.roadLine);
    }
    if (q.kind === "plaza-row" || q.kind === "quad") for (let x = q.x + 0.6; x < q.x + q.w; x += 1.2) flat(0.04, q.d - 0.6, x, cz, y + 0.026, new THREE.Color(0xc7bb9f)); // paving joints
    if (q.kind === "ring") { const along = q.w > q.d; for (let t = 0.8; t < (along ? q.w : q.d) - 0.6; t += 1.4) along ? flat(0.6, 0.08, q.x + t, cz, y + 0.03, COLORS.roadLine) : flat(0.08, 0.6, cx, q.y + t, y + 0.03, COLORS.roadLine); } // the dashed centre line
  }
  // the quad's lawn, in the middle of its paving
  if (campus.lawn && campus.lawn.d > 0.5) { const L = campus.lawn; flat(L.w, L.d, L.x + L.w / 2, L.y + L.d / 2, 0.05, new THREE.Color(0x9fcb86)); }
  // zebra crossings on Main street at every cross street, and a few at the side streets' crossings too
  const mainSt = campus.roads.find((q) => q.kind === "main");
  if (mainSt) for (const h of campus.roads.filter((q) => q.kind === "street" && q.w > q.d && q.y > mainSt.y && q.y < mainSt.y + mainSt.d)) {
    for (const zc of [h.y - 0.6, h.y + h.d + 0.6]) for (let x = mainSt.x + 0.7; x < mainSt.x + mainSt.w - 0.5; x += 0.55) if (Math.abs(x + 0.14 - (mainSt.x + mainSt.w / 2)) > 0.5) flat(0.28, 0.9, x + 0.14, zc, 0.06, new THREE.Color(0xf1ece0));
  }
  // grass that isn't one flat colour: soft darker and lighter patches, off the streets
  { let sd = 3; const rr = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
    const onRoad = (x, z) => campus.roads.some((q) => x > q.x - 0.6 && x < q.x + q.w + 0.6 && z > q.y - 0.6 && z < q.y + q.d + 0.6) || (campus.river && z > campus.river.y - 0.8 && z < campus.river.y + campus.river.d + 0.8);
    for (let k = 0; k < 160; k++) { const x = b.x0 - pad + rr() * (b.x1 - b.x0 + pad * 2), z = b.z0 - pad + rr() * (b.z1 - b.z0 + pad * 2); if (onRoad(x, z)) continue; const g = new THREE.CircleGeometry(0.6 + rr() * 1.4, 9); g.rotateX(-Math.PI / 2); g.scale(1, 1, 0.6 + rr() * 0.6); g.translate(x, 0.008, z); parts.push(paint(g, rr() < 0.5 ? COLORS.grassDark : new THREE.Color(0x9fcb86))); } }
  // Districts: a tinted block under each district, with a name sign at its outer corner.
  const DCOL = { Creative: new THREE.Color(0xe7b48f), Games: new THREE.Color(0x9fbfe8), Tools: new THREE.Color(0xa9d6a0) };
  for (const dst of campus.districts || []) {
    const dc = DCOL[dst.name] || COLORS.grass;
    flat(dst.x1 - dst.x0, dst.y1 - dst.y0, (dst.x0 + dst.x1) / 2, (dst.y0 + dst.y1) / 2, 0.03, COLORS.grass.clone().lerp(dc, 0.35)); // the whole neighbourhood, softly
    if (dst.pad) flat(dst.pad.x1 - dst.pad.x0, dst.pad.y1 - dst.pad.y0, (dst.pad.x0 + dst.pad.x1) / 2, (dst.pad.y0 + dst.pad.y1) / 2, 0.035, dc); // round its buildings
    // the district's name at its outer corner, away from the busy square and the building signs
    const sq = campus.square || { x: 0, y: 0 }, ox = Math.abs(dst.x0 - sq.x) > Math.abs(dst.x1 - sq.x) ? dst.x0 : dst.x1, oz = Math.abs(dst.y0 - sq.y) > Math.abs(dst.y1 - sq.y) ? dst.y0 : dst.y1;
    const anchor = new THREE.Object3D(); city.add(anchor);
    // a quad wing: its name half way along its east side, the side the home camera sees (the west wing's concourse,
    // the east wing's outer side), clear of the building signs above the roofs (a district on two rows is named on both)
    if (dst.label) anchor.position.set(dst.x1 + 0.9, 0.3, (dst.y0 + dst.y1) / 2); else anchor.position.set(ox, 0.3, oz);
    sign(anchor, dst.label || `${dst.name} district`, 0, 0, 0, "district");
  }
  // The central square: a paved round plaza with the big budget fountain as the centrepiece. Tap it for
  // the budget panel (fountainPanel in panels.js). The water drops as any budget cap gets close (budgetUse()).
  if (campus.square) {
    const q = campus.square, ring = (r, h, y, color, seg = 40) => { const g = new THREE.CylinderGeometry(r, r, h, seg); g.translate(q.x, y + h / 2, q.y); parts.push(paint(g, color)); };
    ring(q.r, 0.06, 0.04, new THREE.Color(0xd8ccb0)); ring(q.r - 0.35, 0.03, 0.1, new THREE.Color(0xcbbd9e));
    fountain = makeFountain(q);
    city.add(fountain.group); picks.push(fountain.pick);
    clock = makeClockTower(campus.clock?.x ?? q.x + q.r * 0.62, campus.clock?.y ?? q.y - q.r * 0.62); // off the main axis (city planner pass)
    city.add(clock.group); picks.push(clock.pick);
  }
  { const ceo = rooms.find((r) => r.isControl); world = makeWorld(b, { capH: ceo ? storeys(ceo) * 1.5 + 1.1 : 12 }); city.add(world.group); } // the scenery stays below the CEO tower
  const ground = new THREE.Mesh(mergeParts(parts), mats.painted());
  ground.receiveShadow = true; ground.name = "ground"; city.add(ground);
  const filler = makeFiller(b, pad); city.add(filler);
  { const pv = (filler.userData.paved || []).map(([x, z, w, d]) => paint(new THREE.BoxGeometry(w, 0.03, d).translate(x + w / 2, 0.05, z + d / 2), new THREE.Color(0xd9cfb6)));
    if (pv.length) { const m = new THREE.Mesh(mergeParts(pv), mats.painted()); m.receiveShadow = true; m.name = "pocket-squares"; city.add(m); } }
  // the next free lot in each district (campus.nextLots): a low fence and a little sign (city planner pass)
  for (const L of campus.nextLots || []) {
    const parts = [], post = new THREE.Color(0xf1ece0);
    for (let t = 0; t <= 1.001; t += 0.125) for (const [x, z] of [[L.x + 0.3 + (L.w - 0.6) * t, L.y + 0.3], [L.x + 0.3 + (L.w - 0.6) * t, L.y + L.d - 0.3], [L.x + 0.3, L.y + 0.3 + (L.d - 0.6) * t], [L.x + L.w - 0.3, L.y + 0.3 + (L.d - 0.6) * t]]) parts.push(box(0.05, 0.22, 0.05, x, 0.11, z, post, 0));
    const fm = new THREE.Mesh(mergeParts(parts), mats.painted()); fm.name = "next-lot"; city.add(fm);
    const a = new THREE.Object3D(); a.position.set(L.x + L.w / 2, 0.6, L.y + L.d / 2); city.add(a); sign(a, `Next ${L.district} project`, 0, 0, 0, "small");
  }
  if (campus.river) { river = makeRiver(campus); city.add(river.group); }
  if (campus.plan === "quad") makeQuadWalks();
  if (campus.village) {
    green = makeGreen(campus.village, { bandstand: !hasKit("lm_bandstand") }); city.add(green.group);
    const v = campus.village, bs = kitOne("lm_bandstand", { wide: 3.1, x: (v.x0 + v.x1) / 2, z: (v.y0 + v.y1) / 2, ry: Math.PI / 8 }); if (bs) city.add(bs);
    navObs.push(["circle", (v.x0 + v.x1) / 2, (v.y0 + v.y1) / 2, 1.6]);
  }
  // Visual rehaul 2026-11-13: parked cars along the work-side streets (the generated car), and hot-air balloons drifting
  // high over the campus (just for the view).
  if (hasKit("lm_car")) {
    const cars = []; let cs = 17; const cr = () => ((cs = (cs * 1664525 + 1013904223) >>> 0) / 4294967296);
    const busy = (x, z) => rooms.some((r) => !r.isHouse && x > r.x - 0.4 && x < r.x + r.w + 0.4 && z > r.y - 0.4 && z < r.y + r.d + 0.4);
    // Pathing pass (2026-11-13): parked only along the kerb of plain streets, never on Main street (its edges are
    // pavement), the plaza, the square, a junction, a bridge or near a crossing.
    const inR = (x, z, q, m) => x > q.x - m && x < q.x + q.w + m && z > q.y - m && z < q.y + q.d + m;
    const noPark = (x, z, q) => campus.roads.some((o) => o !== q && inR(x, z, o, 0.9)) || (campus.square && Math.hypot(x - campus.square.x, z - campus.square.y) < campus.square.r + 1.2) || (campus.bridges || []).some((br) => Math.abs(x - br.x) < br.w / 2 + 1.2 && campus.river && z > campus.river.y - 3 && z < campus.river.y + campus.river.d + 3);
    for (const q of campus.roads.filter((r) => r.kind === "street" || r.kind === "ring")) { // (the quad's ring road too)
      const along = q.w > q.d, len = along ? q.w : q.d;
      for (let t = 1.6; t < len - 1.6; t += 1.9) {
        if (cr() < 0.45) continue;
        const crossing = campus.roads.some((o) => o !== q && (o.kind === "street" || o.kind === "main") && (along ? Math.abs(q.x + t - (o.x + o.w / 2)) < o.w / 2 + 1 && o.d > o.w : Math.abs(q.y + t - (o.y + o.d / 2)) < o.d / 2 + 1 && o.w > o.d));
        if (crossing) continue;
        const side = cr() < 0.5 ? 0.42 : (along ? q.d : q.w) - 0.42, x = along ? q.x + t : q.x + side, z = along ? q.y + side : q.y + t;
        if (busy(x, z) || noPark(x, z, q)) continue;
        cars.push({ m: kitM(x, 0.02, z, along ? 0 : Math.PI / 2, 1) }); navObs.push(["rect", x - (along ? 0.62 : 0.32), z - (along ? 0.32 : 0.62), along ? 1.24 : 0.64, along ? 0.64 : 1.24]);
      }
    }
    const bb = kitSize("lm_car"), sc = 1.15 / (bb.max.x - bb.min.x);
    for (const c of cars) c.m.multiply(new THREE.Matrix4().makeScale(sc, sc, sc));
    city.add(kitInstances("lm_car", cars.slice(0, isPhone() ? 24 : 60))); // fewer on phones (1,200 triangles each)
  }
  balloons = [];
  for (let k = 0; k < 2; k++) { const bl = kitOne("lm_balloon", { tall: 3.4 }); if (!bl) break; bl.castShadow = false; bl.userData.home = [b.x0 + (b.x1 - b.x0) * (k ? 0.75 : 0.2), 15 + k * 4, b.z0 + (b.z1 - b.z0) * (k ? 0.25 : 0.55)]; bl.userData.ph = k * 2.1; city.add(bl); balloons.push(bl); }
  life = makeLife(campus); city.add(life.group);
  // Buildings: one per room, at the same tiles as the 2D campus (model x → X, model y → Z).
  const lampSpots = [];
  // District towers: small projects stacked one floor each in one tower; a tap on a floor opens that
  // project (makeTower gives each storey its own pick box).
  const towerRooms = new Map();
  for (const r of rooms) if (r.tower) (towerRooms.get(r.tower.id) || towerRooms.set(r.tower.id, []).get(r.tower.id)).push(r);
  for (const [id, list] of towerRooms) {
    const t = list[0].tower;
    const bld = makeTower(list.map((r) => ({ project: r.id, name: r.name, hue: r.hue ?? 200, desks: r.desks?.length || 0 })), { w: t.w, d: t.d, id, style: styleOf(list[0]) });
    placeBuilding(bld, t.x, t.y, { id, name: t.name, isTowerGroup: true, members: list, floors: list.map((r) => ({ busy: r.busy })), x: t.x, y: t.y, w: t.w, d: t.d }, null);
    bld.userData.sign = sign(bld, `${t.name} · ${list.length} projects`, t.w / 2, bld.userData.h + 1.1, t.d / 2);
    list.forEach((r, k) => sign(bld, r.name, t.w + 0.2, k * 1.5 + 0.8, t.d / 2, "small"));
    lampSpots.push({ x: t.x + t.w + 0.6, z: t.y + t.d + 0.6, ry: Math.PI * 0.75 });
  }
  for (const r of rooms) {
    if (r.tower) continue;
    if (r.isGarden) { const gg = makeGarden3d(r); placeBuilding(gg, r.x, r.y, r, r.id, false); for (const l of gg.userData.lamps || []) lampSpots.push(l); continue; } // the community garden, its shared part, the break garden (low: no building)
    if (r.isUnderground) {
      const bld = makeUnderground(r); placeBuilding(bld, r.x, r.y, r, r.id, false);
      sign(bld, `Underground${r.sleepers?.length ? ` · ${r.sleepers.length} paused` : ""}`, r.w / 2, 2.1, r.d / 2, "small");
      continue;
    }
    const hue = r.hue ?? 30;
    // a Residences tower is homes, not an office (city.js; Residences lane 2026-11-16), and always under the CEO tower
    const ceoRoom = r.isHomes && rooms.find((o) => o.isControl);
    const bld = r.isHouse ? makeHouse({ w: r.w, d: r.d, face: r.face || "s", size: r.size || 0, hue, id: r.id, seed: hashSeed(r.id) }) : r.isHomes ? makeResidence(r.floors.map((f) => ({ level: f.level, span: f.span, perFloor: f.perFloor, flats: f.flats })), { w: r.w, d: r.d, id: r.id, name: r.name, maxH: ceoRoom ? storeys(ceoRoom) * 1.5 - 0.8 : Infinity, face: r.face === "n" ? "n" : "s" }) : makeBuilding({ w: r.w, d: r.d, floors: storeys(r), hue, name: r.name, id: r.id, face: r.face || "s", style: styleOf(r), desks: (r.floors || []).map((f) => f.desks?.length || 0), setback: !!r.isControl, shop: !!r.isStore });
    if (rising.has(r.id)) { bld.userData.riseAt = performance.now(); bld.scale.y = 0.02; }
    // The quad's long Residences block faces north (face "n"): its balconies and lobby look over the garden and the quad.
    // makeResidence builds it already turned (2026-11-16: turning its children afterwards left batchCity's windows on
    // the back wall, since the batch copies each window with the building's matrix only).
    // The CEO tower's gold crown: it's the tallest thing on the campus.
    if (r.isControl) { const top = bld.userData.h, cr = new THREE.Mesh(new RoundedBoxGeometry(r.w * 0.62, 0.9, r.d * 0.62, 2, 0.08), mats.solid(0xe0aa3e)); cr.position.set(r.w / 2, top + 0.6, r.d / 2); cr.castShadow = true; bld.add(cr); bld.userData.h = top + 1.1; }
    placeBuilding(bld, r.x, r.y, r, r.id);
    if (!r.isHouse) bld.userData.sign = sign(bld, r.isControl ? "CEO tower (yours)" : r.name, r.w / 2, bld.userData.h + 1.1, r.d / 2, r.isHouse ? "small" : "");
    if (!r.isHouse) lampSpots.push({ x: r.x + r.w + 0.6, z: r.y + r.d + 0.6, ry: Math.PI * 0.75 });
    // each level's word beside its floors (never colour alone): Basic, Comfy, Nice, Penthouse
    if (r.isHomes) { let last = -1; for (const f of r.floors) { if (f.level !== last) sign(bld, f.levelName, bld.userData.flipped ? -0.25 : r.w + 0.25, bld.userData.lobby + (f.storey - 1) * bld.userData.storeyH + bld.userData.storeyH * 0.5, bld.userData.flipped ? r.d * 0.15 : r.d * 0.85, "small"); last = f.level; } }
    // the word on the entrance canopy, and a lamp each side of the door (lit at night with the city's lamps)
    if (r.isHomes) {
      const fl = !!bld.userData.flipped, dz = fl ? -0.84 : r.d + 0.84, wz = fl ? r.y - 0.62 : r.y + r.d + 0.62, dx = bld.userData.door ?? r.w / 2;
      sign(bld, "Residences", fl ? r.w - dx : dx, 1.02, dz, "small");
      for (const sx of r.w < 7 ? [1] : [-1, 1]) lampSpots.push({ x: r.x + (fl ? r.w - dx : dx) + sx * 1.22, z: wz, ry: fl ? Math.PI : 0 });
    }
  }
  // the quad layout: lamps along the concourse's quad side
  for (const c of (campus.concourse || []).filter((c) => c.part === "west" || c.part === "east")) for (let z = c.y + 2.2; z < c.y + c.d - 1; z += 4.5) lampSpots.push({ x: c.part === "west" ? c.x + c.w + 0.25 : c.x - 0.25, z, ry: c.part === "west" ? 0 : Math.PI });
  // Baked contact shadows: one soft dark pad under every building, all merged into a single draw.
  const pads = [...rooms.filter((r) => !r.tower && !r.isGarden), ...(campus.towers || [])].map((r) => { const m = 1.3, g = new THREE.PlaneGeometry(r.w + m * 2, r.d + m * 2); g.rotateX(-Math.PI / 2); g.translate(r.x + r.w / 2, 0.05, r.y + r.d / 2); return g; });
  if (pads.length) { const contact = new THREE.Mesh(mergeParts(pads), mats.contact()); contact.name = "contact"; contact.renderOrder = 1; city.add(contact); }
  const main = campus.roads.find((q) => q.kind === "main");
  if (main) for (let z = main.y + 2.5; z < main.y + main.d - 1; z += 4.5) { lampSpots.push({ x: main.x + 0.25, z, ry: 0 }); lampSpots.push({ x: main.x + main.w - 0.25, z: z + 2.2, ry: Math.PI }); }
  for (const br of campus.bridges || []) for (const sx of [-1, 1]) lampSpots.push({ x: br.x + sx * (br.w / 2 - 0.15), z: (campus.river?.y ?? 0) + (campus.river?.d ?? 0) / 2, ry: sx < 0 ? 0 : Math.PI });
  const v = campus.village; if (v) for (const [x, z] of [[v.x0 - v.road / 2, v.y0 - v.road / 2], [v.x1 + v.road / 2, v.y0 - v.road / 2], [v.x0 - v.road / 2, v.y1 + v.road / 2], [v.x1 + v.road / 2, v.y1 + v.road / 2], [(v.x0 + v.x1) / 2, v.y0 - 0.2], [(v.x0 + v.x1) / 2, v.y1 + 0.2]]) lampSpots.push({ x, z, ry: Math.PI / 4 });
  lamps = makeLamps(lampSpots);
  // the gardens' string lights: one mesh for all of them, shown after dark (applyNight)
  if (gardenLightParts.length) { gardenLights = new THREE.Mesh(mergeParts(gardenLightParts), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })); gardenLights.name = "garden-lights"; gardenLights.visible = false; city.add(gardenLights); }
  for (const l of lampSpots) navObs.push(["circle", l.x, l.z, 0.2]);
  yardStuff(); balconyStuff();
  city.add(lamps.group);
  // Friday's taco truck on the square (people.js truckSpot; the 2D view has one too), with a string of bulbs.
  const ts = typeof isFriday === "function" && isFriday() && typeof truckSpot === "function" && truckSpot();
  if (ts) { city.add(makeTacoTruck(ts[0], ts[1])); navObs.push(["circle", ts[0], ts[1], 1.3]); }
  // Seasons (seasons.js): snow on the roofs in winter, pumpkins by the doors in October, string lights in December.
  const foot = buildings.map((bld) => { const r = bld.userData.room, w = bld.userData.w ?? r.w, d = bld.userData.d ?? r.d; return { x: bld.position.x, z: bld.position.z, w, d, h: (bld.userData.h - (r?.isControl ? 1.1 : 0)) * bld.scale.y }; });
  seasonal = makeSeasonal({ buildings: foot, doors: foot.map((f) => ({ x: f.x + f.w / 2, z: f.z + f.d })), square: campus.square }, SEASON);
  city.add(seasonal.group);
  // City life (citylife.js): the diner takes a spot on the square (people walk round it), the rest reads the poll's facts.
  cityLife3 = makeCityLife3({ campus, buildings, sign, avoid: [...navObs, ...(filler.userData.obs || []).map(([x, z, r]) => ["circle", x, z, r])] });
  city.add(cityLife3.group); { const fp = cityLife3.footprint(); if (fp) navObs.push(fp); }
  cityLife3.refresh();
  // City life lane L2 (citylife2.js): the library takes ground on the lawn (people walk round it), the rest reads the hub's few counts
  cityLife3b = makeCityLife3L2({ campus, buildings, sign, balloons, avoid: [...navObs, ...(filler.userData.obs || []).map(([x, z, r]) => ["circle", x, z, r])] });
  city.add(cityLife3b.group); for (const fp of cityLife3b.footprints()) navObs.push(fp);
  cityLife3b.refresh();
  batchCity();
  litWindows(); placeSitters();
  buildCityNav(b, pad, filler.userData.obs || []);
  rig.fit(new THREE.Vector3((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2), Math.max(b.x1 - b.x0, b.z1 - b.z0) / 2 + 16);
  applyNight(true); // a fresh city (new lamps, maybe just back from inside a building) always gets the right light
}
// The city's walkable grid (pathing pass, 2026-11-13; nav.js). Streets, pavements, the plaza, paths and bridges cost 1;
// the village green 2; other lawns 6 (allowed, but people keep to the paths); the river and everything solid is blocked.
function buildCityNav(b, pad, fillerObs) {
  const nav = new NavGrid(b.x0 - pad, b.z0 - pad, b.x1 + pad, b.z1 + pad, 0.35, 6);
  const V = campus.village; if (V) nav.rect(V.x0, V.y0, V.x1 - V.x0, V.y1 - V.y0, 2);
  for (const q of campus.roads) nav.rect(q.x, q.y, q.w, q.d, 1);
  if (campus.square) nav.circle(campus.square.x, campus.square.y, campus.square.r, 1);
  const R = campus.river; if (R) { nav.rect(R.x0, R.y - 0.3, R.x1 - R.x0, R.d + 0.6, 0); for (const br of campus.bridges || []) nav.rect(br.x - br.w / 2 + 0.25, R.y - 1.2, br.w - 0.5, R.d + 2.4, 1); }
  for (const r of rooms) if (!r.isUnderground && !r.walkIn) nav.rect(r.x, r.y, r.w, r.d, 0, r.isHouse ? 0.12 : 0.2); // buildings (with their plinth)
  for (const r of rooms) if (r.walkIn) nav.rect(r.x + 0.1, r.y + 0.1, r.w - 0.2, r.d - 0.2, 1); // the break garden: walk in (its hedge, pond, table and trees are in navObs)
  for (const t of campus.towers || []) nav.rect(t.x, t.y, t.w, t.d, 0, 0.2);
  const ug = rooms.find((r) => r.isUnderground); if (ug) nav.rect(ug.x, ug.y, ug.w, ug.d, 0, 0.1);
  if (campus.square) nav.circle(campus.square.x, campus.square.y, 2.9, 0); // the fountain
  if (campus.clock) nav.circle(campus.clock.x, campus.clock.y, 0.55, 0); else if (campus.square) nav.circle(campus.square.x + campus.square.r * 0.62, campus.square.y - campus.square.r * 0.62, 0.55, 0);
  const main = campus.roads.find((q) => q.kind === "main"); if (main) { nav.rect(main.x + main.w - 0.95, main.y + 0.95, 0.75, 1.35, 0); nav.rect(main.x + main.w / 2 - 0.35, main.y + 0.5, 0.7, main.d - 1, 0); } // the bus stop; the planted median
  for (const [x, z, r] of fillerObs) nav.circle(x, z, r, 0);
  for (const o of navObs) if (o[0] === "circle") nav.circle(o[1], o[2], o[3], 0); else nav.rect(o[1], o[2], o[3], o[4], 0);
  // the doors: a clear landing in front of every door so people can reach it
  for (const r of rooms) if (!r.isUnderground && typeof doorOf === "function") { const [dx, dz] = doorOf(r, 0.45); nav.circle(dx, dz, 0.35, 1); }
  window.campusNav = nav;
}
// Lit windows: a floor where someone worked in the last 15 minutes glows; houses glow when their owner is home.
function litWindows() {
  const h = (s) => { let v = 7; for (const c of s) v = (v * 31 + c.charCodeAt(0)) >>> 0; return v; };
  for (const bld of buildings) {
    const r = bld.userData.room;
    const home = r.isHouse && r.desk && typeof whereIs === "function" && whereIs(r.desk) === "home";
    // City life (citylife.js): a building over its monthly cap browns out; after hours a busy building keeps steady lit windows and a quiet one goes dark
    const lf = window.cityLife, office = !r.isHouse && !r.isHomes, brown = office && lf?.on("grid") && lf.level(r) === "over";
    const late = office && lf?.on("night") && typeof afterHours === "function" && afterHours() && night > 0.5, anyBusy = late && (r.floors || []).some((f) => f.busy);
    bld.setWindows((sl) => {
      // a Residences flat is lit when its owner is home; the lobby is always lit
      if (r.isHomes) { if (sl.lobby) return 1; const dk = sl.res && typeof deskById === "function" && deskById(sl.res); return dk && whereIs(dk) === "home" ? (sl.side === "south" ? 1 : 0.7) : 0; }
      const busy = r.isHouse ? home : !!r.floors?.[sl.floor]?.busy;
      if (late && !anyBusy) return 0;
      let v = busy ? (late ? 1 : h(r.id + sl.side + sl.index + sl.floor) % 5 ? 1 : 0.3) : late ? 0 : h(sl.side + sl.index + sl.floor + r.id) % 11 === 0 ? 0.5 : 0;
      if (brown) v *= 0.3;
      return v;
    });
  }
}
let nightShown = -1, nightWhere = "";
function applyNight(force = false) {
  const n = typeof night === "number" ? night : 0;
  // Redraw when the night changes OR you go in or out of a building (the owner's "I spy" 2026-11-09: back outside after a
  // visit, the city kept the indoor "lights on" level and looked like day under a night sky).
  const where = inside ? "in" : "out";
  if (!force && Math.abs(n - nightShown) < 0.01 && where === nightWhere && (buildings.length || inside)) return;
  nightShown = n; nightWhere = where;
  // Inside a building the lights are on: rooms stay readable at night (glow pieces and screens still pop).
  const lit = inside ? Math.min(n, 0.3) : n;
  inside?.traverse((o) => { if (o.name === "deskLamps") o.material.color.setScalar(n > 0.3 ? 1.25 : 0.55); }); // lamps on after dark
  rig.setNight(lit); lamps?.setNight(n); world?.setNight(n); setEnv(0.3 - 0.25 * lit);
  if (gardenLights) gardenLights.visible = n > 0.35; // the gardens' string lights come on after dark
  for (const b of buildings) b.setNight(n);
  // foggy days: the fog closes in (on top of the day/night fog)
  if ((typeof weather !== "undefined" && weather?.kind) === "fog") { scene.fog.near = 38; scene.fog.far = 95; scene.fog.color.lerp(new THREE.Color(0xc8d2dc), 0.5 * (1 - n)); }
  stage.style.background = "#" + rig.sky.getHexString();
  dirty = true;
}

// ---------- inside a building (phase 4, step 1): every floor as a cut-away storey ----------
// The same office plan as the 2D floor view (plan(), deskPos(), leadPos() in core.js): service strip (lift, restrooms,
// kitchenette), corridor, open plan with desk rows, a glass meeting room, a phone booth and the lead's glass office at
// the front. Floors are spread apart so each storey shows; only the back and left walls stand (cut-away).
// Each area's theme (style C, per team) comes in step 3; this is the shared plan.
const WALL_H = 2.2;
let inside = null, insideKey = "", floorGroups = [], rideK = -1, insideAll = null;
// Far enough apart that each storey's whole floor shows above the one below it in the iso view.
// Floors stack like the building they are, each hovering a little above the one below (the owner 2026-11-09: "a slight
// hover above the other would be best"); ride a floor (scroll, or the floor buttons) to open it up.
const storeyGap = () => WALL_H + 0.9;
const floorY = (f) => f.k * storeyGap(f);
// The end of every floor: a pick box (taps open that floor's panel), its sign, and one solid mesh (plus glow) so floors
// can be shown and hidden as you ride.
// A floor's walkable grid (pathing pass, 2026-11-13): every wall, desk, cabinet, sofa, plant... that stands at body
// height (from 0.2 to 0.6 above the floor) blocks; rugs, mats and toys don't, nor chairs (workers sit on them).
// glassList: the glass walls (meeting room, the lead's office, the booth), which block too.
function buildFloorNav(f, y, solid, glassList = []) {
  const nav = new NavGrid(f.x, f.y, f.x + f.w, f.y + f.d, 0.2, 1), bb = new THREE.Box3();
  for (const g of [...solid, ...glassList]) {
    if (g.userData?.noNav) continue;
    g.computeBoundingBox(); bb.copy(g.boundingBox);
    if (bb.max.y < y + 0.2 || bb.min.y > y + 0.6) continue;
    if (bb.max.x - bb.min.x > f.w * 0.9 && bb.max.z - bb.min.z > f.d * 0.9) continue; // the slab or a floor
    nav.rect(bb.min.x, bb.min.z, bb.max.x - bb.min.x, bb.max.z - bb.min.z, 0);
  }
  (window.floorNav ||= {})[f.id] = nav;
}
function finishFloor(fg, f, y, k, label, solid, glow) {
  buildFloorNav(f, y, solid, f._glass || []);
  const pick = new THREE.Mesh(new THREE.BoxGeometry(f.w, WALL_H, f.d), new THREE.MeshBasicMaterial({ visible: false }));
  pick.position.set(f.x + f.w / 2, y + WALL_H / 2, f.y + f.d / 2); pick.name = "pick"; pick.userData.room = f.id; pick.userData.k = k; fg.add(pick); picks.push(pick);
  const anchor = new THREE.Object3D(); anchor.position.set(f.x + f.w + 0.4, y + 0.4, f.y + f.d); fg.add(anchor);
  sign(anchor, label, 0, 0, 0);
  const body = new THREE.Mesh(mergeParts(solid), mats.painted()); body.castShadow = body.receiveShadow = true; fg.add(body);
  if (glow.length) fg.add(new THREE.Mesh(mergeParts(glow), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })));
}
// Doors (the owner 2026-11-13: "some of the rooms in offices you can't get in, they have no door"): every glass room gets a
// real doorway, a gap in the glass with door posts, a header, and the glass door standing open against the wall.
function glassWallWithDoor(blk, glass, along, a0, a1, at, y, h, door0, door1, ext) {
  const post = 0x2e333b, D = door1 - door0;
  if (along === "x") {
    if (door0 > a0) blk(door0 - a0, h, 0.05, a0, y, at, 0xcfe8f5, glass);
    if (a1 > door1) blk(a1 - door1, h, 0.05, door1, y, at, 0xcfe8f5, glass);
    blk(0.06, h, 0.08, door0 - 0.03, y, at - 0.015, post); blk(0.06, h, 0.08, door1 - 0.03, y, at - 0.015, post); blk(D + 0.06, 0.07, 0.08, door0 - 0.03, y + h - 0.07, at - 0.015, post);
    blk(0.04, h * 0.92, D * 0.9, door1 - 0.02, y, at + (ext > 0 ? 0.05 : -D * 0.9), 0xcfe8f5, glass); // the door, open
  } else {
    if (door0 > a0) blk(0.05, h, door0 - a0, at, y, a0, 0xcfe8f5, glass);
    if (a1 > door1) blk(0.05, h, a1 - door1, at, y, door1, 0xcfe8f5, glass);
    blk(0.08, h, 0.06, at - 0.015, y, door0 - 0.03, post); blk(0.08, h, 0.06, at - 0.015, y, door1 - 0.03, post); blk(0.08, 0.07, D + 0.06, at - 0.015, y + h - 0.07, door0 - 0.03, post);
    blk(D * 0.9, h * 0.92, 0.04, at + (ext > 0 ? 0.05 : -D * 0.9), y, door1 - 0.02, 0xcfe8f5, glass);
  }
}
function buildInterior() {
  clearCity(); clearInterior();
  inside = new THREE.Group(); inside.name = "inside"; scene.add(inside);
  let solid = [], glass = [], glow = [];
  const C = (h) => new THREE.Color(h);
  const blk = (w, h, d, x, y, z, color, list = solid) => { list.push(box(w, h, d, x + w / 2, y + h / 2, z + d / 2, C(color), 0.05)); };
  // Visual rehaul, second pass (2026-11-13): kit furniture (tools/campus-assets/build_interior.py) and Mart items.
  // kp() merges a kit prop into this floor; false when the kit doesn't have it (the caller draws the old blocks).
  let sprites = null;
  const kp = (name, x, y, z, ry = 0, s = 1, tint) => { if (!hasKit(name)) return false; const pc = kitPieces(name, x, y, z, ry, s, tint); if (/chair/.test(name)) for (const g of pc.solid) g.userData.noNav = true; solid.push(...pc.solid); glow.push(...pc.glow); return true; };
  const item = (key, x, y, z, ry = 0, s = 1) => { // a Mart item, or its stand-in with the emoji over it
    const look = itemLook(key);
    if (look.prop) kp(look.prop, x, y, z, ry, s, C(0x6fae5c));
    if (look.stand) { const sp = new THREE.Sprite(emojiMat(look.icon)); sp.scale.set(0.3, 0.3, 1); sp.position.set(x, y + (look.prop ? 0.38 : 0.18) * s, z); sp.name = "item-emoji"; sprites.push(sp); }
  };
  const planks = (x, y, z, w, d, col) => { const base = C(col), alt = base.clone().multiplyScalar(0.93), hi = base.clone().lerp(C(0xffffff), 0.06); let i = 0; for (let zz = z; zz < z + d - 0.01; zz += 0.3, i++) solid.push(box(w, 0.02, Math.min(0.29, z + d - zz), x + w / 2, y + 0.01, zz + Math.min(0.29, z + d - zz) / 2, i % 3 === 0 ? alt : i % 3 === 1 ? base : hi, 0)); };
  floorGroups = [];
  for (const f of rooms) {
    solid = []; glass = []; glow = []; sprites = [];
    const fg = new THREE.Group(); fg.userData.k = f.k; inside.add(fg); floorGroups.push(fg);
    if (f.house && f.level != null) { buildResHome(f, fg, solid, glow, kp); for (const sp of sprites) fg.add(sp); continue; } // a Residences home (the inside lane)
    if (f.house) { buildHouseRoom(f, fg, blk, solid, glass, glow); continue; }
    if (f.resFloor) { buildResFloor(f, fg, blk, kp, glow, solid); finishFloor(fg, f, floorY(f), f.k, f.name, solid, glow); continue; } // a floor of homes in a Residences tower
    if (f.pet && hasKit("rx_bed")) { buildPetRoom(f, fg, blk, kp, planks); finishFloor(fg, f, floorY(f), f.k, `${f.k + 1}F · ${f.floorName}`, solid, glow); for (const sp of sprites) fg.add(sp); continue; }
    const y = floorY(f), x0 = f.x, z0 = f.y, pl = plan(f), th = themeFor(f);
    // slab, the team's floor finish and walls (style C, themes.js), the accent band along the top
    blk(f.w, 0.2, f.d, x0, y - 0.2, z0, 0x8a8f99);
    if (hasKit("in_desk")) planks(x0 + CORE_W, y, z0, f.w - CORE_W, f.d, th.floor); else blk(f.w - CORE_W, 0.02, f.d, x0 + CORE_W, y, z0, th.floor);
    blk(f.w, WALL_H, 0.12, x0, y, z0, th.wall); blk(0.12, WALL_H, f.d, x0, y, z0, th.wall2);
    blk(f.w, 0.12, 0.16, x0, y + WALL_H, z0, th.accent);
    // the team's signature pieces on the back wall, over the open plan
    const W = f.w - CORE_W - 0.3;
    addProps(th, (kind, w, h, d, px, py, pz, color) => blk(w, h, d, x0 + CORE_W + 0.15 + px, y + py, z0 + 0.12 + pz, color, kind === "glow" ? glow : kind === "glass" ? glass : solid), W);
    // a rug under each side's block of desks (a channel red, a channel teal …), or a neon grid on another project's floor
    if (f.groups) f.groups.forEach((g, gi) => { if (!g.staff.length) return; const [l, r] = sideSpan(f, g === f.groups[gi] ? gi : gi); blk(r - l + 0.5, 0.015, pl.front - z0 - 1.2, l - 0.25, y + 0.02, z0 + 0.8, sideColor(g.name, gi)); });
    if (th.grid) for (let gx = x0 + CORE_W + 1; gx < x0 + f.w - 0.3; gx += 1.2) blk(0.03, 0.01, f.d - FRONT - 0.4, gx, y + 0.025, z0 + 0.2, th.grid, glow);
    // service strip: lift, restrooms, kitchenette
    if (hasKit("in_desk")) {
      // the owner 2026-11-13: "fix the 2 huge blocks in each office". The lift is steel doors set in the back wall (with a
      // frame, a floor indicator and a call button) and a mat in front; the restrooms are a small room with
      // half-height walls you can see over, a doorway on the corridor, two cubicles and a basin, and a sign.
      blk(1.56, 1.86, 0.06, x0 + 0.17, y, z0 + 0.12, 0x7f868f);                                    // lift frame
      blk(0.66, 1.66, 0.04, x0 + 0.24, y, z0 + 0.17, 0xc9ced4); blk(0.66, 1.66, 0.04, x0 + 0.92, y, z0 + 0.17, 0xc0c6cd); // the two doors
      blk(0.02, 1.66, 0.05, x0 + 0.9, y, z0 + 0.17, 0x6a7078);                                     // the gap between them
      blk(0.42, 0.12, 0.03, x0 + 0.74, y + 1.7, z0 + 0.19, 0xffb04a, glow); // floor indicator
      blk(0.07, 0.12, 0.03, x0 + 1.62, y + 0.95, z0 + 0.19, 0x9fe0ff, glow);                       // call button
      blk(1.5, 0.012, 0.85, x0 + 0.2, y + 0.022, z0 + 0.35, 0x3a3f48);                              // the lift mat
      const wc = pl.wc, IH = 1.05, wcC = 0xe9eef2;
      blk(SERV - 0.2, IH, 0.08, x0 + 0.12, y, wc.y, wcC); blk(SERV - 0.2, IH, 0.08, x0 + 0.12, y, wc.y + wc.d - 0.08, wcC); // its walls
      blk(0.08, IH, 0.42, x0 + SERV - 0.16, y, wc.y, wcC); blk(0.08, IH, 0.42, x0 + SERV - 0.16, y, wc.y + wc.d - 0.42, wcC); // doorway on the corridor
      blk(SERV - 0.3, 0.012, wc.d - 0.2, x0 + 0.15, y + 0.022, wc.y + 0.1, 0xd7e3ea);              // tiles
      blk(0.05, IH * 0.85, wc.d * 0.42, x0 + 0.72, y, wc.y + 0.08, 0x9bb4c8);                       // cubicle partition
      for (const cz of [wc.y + 0.32, wc.y + wc.d * 0.32 + 0.22]) { blk(0.32, 0.36, 0.26, x0 + 0.2, y, cz - 0.13, 0xffffff); blk(0.1, 0.3, 0.3, x0 + 0.14, y + 0.3, cz - 0.15, 0xf2f2f2); }
      blk(0.32, 0.08, 0.5, x0 + 0.15, y + 0.72, wc.y + wc.d - 0.62, 0xf2f2f2); blk(0.03, 0.42, 0.42, x0 + 0.13, y + 0.95, wc.y + wc.d - 0.58, 0xbfe6ff, glow); // basin and mirror
      { const sp = new THREE.Sprite(emojiMat("🚻")); sp.scale.set(0.34, 0.34, 1); sp.position.set(x0 + SERV - 0.1, y + IH + 0.32, wc.y + wc.d / 2); sprites.push(sp); }
    } else {
      blk(SERV - 0.1, 2.0, 2.0, x0 + 0.05, y, z0 + 0.05, 0x9aa3ad);
      blk(SERV - 0.1, 1.6, pl.wc.d - 0.1, x0 + 0.05, y, pl.wc.y + 0.05, 0xb9c1ca);
    }
    if (!kp("in_kitchen", x0 + 0.42, y, pl.kitchen.y + pl.kitchen.d / 2, Math.PI / 2, Math.min(1, (pl.kitchen.d - 0.2) / 1.85))) {
      blk(0.6, 0.85, pl.kitchen.d - 0.2, x0 + 0.1, y, pl.kitchen.y + 0.1, 0xd9c7a8); blk(0.6, 0.04, pl.kitchen.d - 0.2, x0 + 0.1, y + 0.85, pl.kitchen.y + 0.1, 0xf4f1ea);
      blk(0.22, 0.32, 0.22, x0 + 0.3, y + 0.89, pl.kitchen.y + 0.4, 0x5e4632); // coffee machine
    }
    blk(0.55, 0.04, 0.55, x0 + 1.05, y + 0.72, pl.kitchen.y + 0.9, 0x9b6b43); blk(0.06, 0.72, 0.06, x0 + 1.3, y, pl.kitchen.y + 1.15, 0x333333);
    // desks: the lead's in the glass office, the rest in rows from the back wall
    const lampsHere = [];
    const desk = (p, lead, d) => {
      if (hasKit("in_desk")) { // the kit desk (monitor to the back), a chair (a gold one if they bought it), their desk items
        kp("in_desk", p.x, y, p.y - 0.25, Math.PI); kp(d && itemsAt(d.id, "desk").includes("chair") && hasKit("it_chair") ? "it_chair" : "in_chair", p.x, y, p.y + 0.12, Math.PI, 0.95);
        blk(0.06, 0.3, 0.06, p.x + 0.42, y + 0.7, p.y - 0.5, 0x333333); blk(0.16, 0.07, 0.16, p.x + 0.37, y + 0.98, p.y - 0.55, 0xffd58a, lampsHere);
        // what they keep at work (belongings.js "desk"): home things and pets of someone with no flat first (smaller,
        // so a fish tank fits on a desk), then their desk things, priciest first; up to five
        if (d) deskThings(d.id).slice(0, 5).forEach((k, i) => item(k, p.x + [-0.4, -0.22, 0.24, 0.02, 0.44][i], y + 0.71, p.y - [0.12, 0.42, 0.14, 0.02, 0.1][i], Math.PI + i, data.perks?.[k]?.cat === "desk" ? 1 : 0.45));
        return;
      }
      blk(0.08, 0.3, 0.08, p.x + 0.32, y + 0.76, p.y - 0.5, 0x333333); blk(0.18, 0.08, 0.18, p.x + 0.27, y + 1.02, p.y - 0.55, 0xffd58a, lampsHere); blk(1.0, 0.06, 0.6, p.x - 0.5, y + 0.7, p.y - 0.55, lead ? 0x6b4a32 : th.desk); blk(0.05, 0.7, 0.05, p.x - 0.45, y, p.y - 0.5, 0x333333); blk(0.05, 0.7, 0.05, p.x + 0.4, y, p.y - 0.5, 0x333333); blk(0.42, 0.28, 0.04, p.x - 0.21, y + 0.76, p.y - 0.52, 0x1b1f27); };
    f.staff.forEach((d, k) => desk(deskPos(f, k), false, d));
    if (f.lead) desk(leadPos(f), true, f.lead);
    // cubicle screens behind each row of desks
    for (const { first: a, last: b } of deskRows(f)) blk(b.x - a.x + 1.4, 0.55, 0.06, a.x - 0.7, y, a.y - 0.75, th.screen);
    // meeting room (glass, table, chairs) and the lead's office (glass, gold rug)
    const m = pl.meeting, o = pl.office;
    blk(m.w, WALL_H * 0.85, 0.05, m.x, y, m.y, 0xcfe8f5, glass); blk(0.05, WALL_H * 0.85, m.d, m.x + m.w, y, m.y, 0xcfe8f5, glass);
    glassWallWithDoor(blk, glass, "z", m.y, m.y + m.d, m.x, y, WALL_H * 0.85, m.y + 0.35, m.y + 1.25, -1); // its door on the corridor
    const tp = tablePos(f); if (tp && kp("in_table", tp.x, y, tp.y, 0, 0.9)) kp("in_whiteboard", m.x + m.w / 2, y, m.y + 0.12, 0, 0.85); else if (tp) { blk(1.4, 0.06, 0.8, tp.x - 0.7, y + 0.68, tp.y - 0.4, 0x5e4632); blk(0.1, 0.68, 0.1, tp.x - 0.05, y, tp.y - 0.05, 0x333333); }
    blk(0.05, WALL_H * 0.85, o.d, o.x, y, o.y, 0xcfe8f5, glass);
    glassWallWithDoor(blk, glass, "x", o.x, o.x + o.w, o.y, y, WALL_H * 0.85, o.x + 0.8, o.x + 1.7, -1); // its door, facing the open plan (it opens outward, clear of the desk)
    blk(o.w - 0.3, 0.015, o.d - 0.3, o.x + 0.15, y, o.y + 0.15, 0xc9a24a);
    if (o.w > 2.4) { kp("in_sofa", o.x + 0.42, y, o.y + o.d * 0.62, Math.PI / 2, 0.62); kp("in_floorlamp", o.x + 0.3, y, o.y + 0.3); } // along the side wall, clear of the door
    if (pl.booth && hasKit("in_desk")) { // a glass phone booth: a dark frame, glass all round, a roof light, a stool and a shelf
      const bx = pl.booth.x, bz = pl.booth.y, BW = 0.8, BH = 1.9;
      for (const [px, pz] of [[0, 0], [BW, 0], [0, BW], [BW, BW]]) blk(0.05, BH, 0.05, bx + px - 0.025, y, bz + pz - 0.025, 0x2e333b);
      blk(BW + 0.06, 0.08, BW + 0.06, bx - 0.03, y + BH, bz - 0.03, 0x2e333b); blk(BW - 0.1, 0.02, BW - 0.1, bx + 0.05, y + BH - 0.02, bz + 0.05, 0xfff2c8, glow);
      blk(BW, BH * 0.95, 0.03, bx, y, bz, 0xcfe8f5, glass); blk(0.03, BH * 0.95, BW, bx, y, bz, 0xcfe8f5, glass); blk(0.03, BH * 0.95, BW, bx + BW, y, bz, 0xcfe8f5, glass);
      blk(0.03, BH * 0.9, BW * 0.85, bx + BW, y, bz + BW + 0.02, 0xcfe8f5, glass); // its door, standing open (the front is the way in)
      blk(BW - 0.1, 0.04, 0.22, bx + 0.05, y + 0.95, bz + 0.05, th.desk); blk(0.26, 0.05, 0.26, bx + 0.27, y + 0.48, bz + 0.38, th.accent); blk(0.05, 0.46, 0.05, bx + 0.37, y, bz + 0.48, 0x333333);
      blk(BW - 0.04, 0.012, BW - 0.04, bx + 0.02, y + 0.022, bz + 0.02, 0x3a3f48);
    } else if (pl.booth) { blk(0.8, 1.9, 0.8, pl.booth.x, y, pl.booth.y, 0x7d8b99); blk(0.6, 1.4, 0.04, pl.booth.x + 0.1, y + 0.25, pl.booth.y + 0.8, 0xcfe8f5, glass); }
    // the board room: a long table down the open plan, chairs both sides, the head seat (by the window) for the pet
    if (f.board) {
      const tx = x0 + CORE_W + 0.9, tz = z0 + f.d / 2 - 0.55, tl = Math.min(4.6, f.w - CORE_W - 2.2);
      blk(tl, 0.08, 1.1, tx, y + 0.7, tz, 0x4a3426); blk(0.12, 0.7, 0.12, tx + 0.4, y, tz + 0.5, 0x2b2b2b); blk(0.12, 0.7, 0.12, tx + tl - 0.5, y, tz + 0.5, 0x2b2b2b);
      for (let k = 0; k < Math.floor(tl / 0.8); k++) for (const side of [-0.55, 1.2]) blk(0.42, 0.45, 0.42, tx + 0.3 + k * 0.8, y, tz + side, 0x6e5a8c);
      blk(0.55, 0.9, 0.5, tx + tl + 0.15, y, tz + 0.3, 0xd8b45a); // the CEO's chair at the head
    }
    // plants in the corners
    for (const [px, pz] of [[x0 + f.w - 0.5, z0 + 0.5], [x0 + CORE_W + 0.4, f.y + f.d - 0.5]]) if (!kp("in_plant", px, y, pz, px, 1.1, C(0x5f9a4c))) { blk(0.3, 0.3, 0.3, px - 0.15, y, pz - 0.15, 0xb5683c); blk(0.42, 0.42, 0.42, px - 0.21, y + 0.3, pz - 0.21, 0x5fae5a); }
    // The lounge wing (back right, plan().lounge): a rug in the team's accent, a sofa and a coffee table, beanbags, a
    // bookshelf, a water cooler, an arcade cabinet (this campus has too much funding), a floor lamp and plants, behind a
    // low glass screen. Idle workers wander here (motion.js) the same as to the meeting table.
    const L = pl.lounge;
    if (L && hasKit("in_sofa")) {
      blk(L.w - 0.5, 0.015, L.d - 0.6, L.x + 0.25, y + 0.025, L.y + 0.3, th.accent);
      glassWallWithDoor(blk, glass, "z", L.y + 0.2, L.y + L.d - 0.2, L.x, y, WALL_H * 0.45, L.y + L.d * 0.4, L.y + L.d * 0.4 + 0.95, 1);
      kp("in_shelf", L.x + L.w * 0.3, y, L.y + 0.32, Math.PI, 0.9, C(0x5f9a4c));
      kp("in_sofa", L.x + L.w * 0.42, y, L.y + L.d * 0.45, Math.PI, 0.72); // narrower, so there's a walkway past it on the right
      blk(0.7, 0.05, 0.45, L.x + L.w * 0.42 - 0.35, y + 0.35, L.y + L.d * 0.45 + 0.6, 0x8b6a4a); blk(0.06, 0.35, 0.06, L.x + L.w * 0.42 - 0.03, y, L.y + L.d * 0.45 + 0.8, 0x333333);
      if (!kp("it_beanbag", L.x + L.w * 0.25, y, L.y + L.d * 0.8, 0.4, 0.85)) blk(0.5, 0.35, 0.5, L.x + L.w * 0.2, y, L.y + L.d * 0.75, 0xd98b5f);
      kp("it_beanbag", L.x + L.w * 0.62, y, L.y + L.d * 0.85, -0.5, 0.85);
      kp("it_arcade", L.x + L.w - 0.4, y, L.y + L.d * 0.75, -Math.PI / 2, 0.9);
      kp("in_cooler", L.x + L.w - 0.35, y, L.y + 0.35, Math.PI, 1);
      kp("in_floorlamp", L.x + 0.35, y, L.y + L.d - 0.4, 0, 1);
      kp("in_plant", L.x + L.w - 0.4, y, L.y + L.d * 0.4, 1, 1, C(0x5f9a4c));
    }
    f._glass = glass;
    finishFloor(fg, f, y, f.k, rooms.length > 1 ? `${f.k + 1}F · ${f.floorName}` : f.name, solid, glow);
    for (const sp of sprites) fg.add(sp);
    // desk lamps: lit (unlit-bright) at night, plain shades by day (applyNight swaps them)
    if (lampsHere.length) { const lm = new THREE.Mesh(mergeParts(lampsHere), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })); lm.name = "deskLamps"; fg.add(lm); }
    if (glass.length) fg.add(new THREE.Mesh(mergeParts(glass), new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.35, roughness: 0.1, depthWrite: false })));
  }
  rideK = -1;
  const all = rooms.reduce((a, f) => ({ x0: Math.min(a.x0, f.x), x1: Math.max(a.x1, f.x + f.w), z0: Math.min(a.z0, f.y), z1: Math.max(a.z1, f.y + f.d), y1: Math.max(a.y1, floorY(f) + WALL_H) }), { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9, y1: 0 });
  rig.fit(new THREE.Vector3((all.x0 + all.x1) / 2, all.y1 / 2, (all.z0 + all.z1) / 2), Math.max(all.x1 - all.x0, all.z1 - all.z0, all.y1) / 2 + 4);
  applyNight(true);
  return all;
}
// Inside a worker's house (the owner 2026-11-09): a cosy room with what they've bought at the Campus Mart (bed, couch,
// TV, bookshelf, arcade, rug; a plain bed and a table come with it), a window lit like the outside ones, and them on
// the couch when they're home.
function buildHouseRoom(f, fg, blk, solid, glass, glow) {
  // Visual rehaul, third pass (the owner 2026-11-13: "room layout, amount of rooms", "make sure evening is covered"): a
  // house is three rooms now, a bedroom at the back left, a kitchen at the back right and the living room across the
  // front, split by half-height walls with doorways. Their Mart things go in the room they belong to, pets on the
  // floor. In the evening (and after hours) they're home on the couch, the lamps and TV are on, and anyone really
  // visiting them right now (a walker heading to this house) is there too.
  const d = f.desk, own = shownOwned(d.id), has = (k) => own.includes(k) || (f.level != null && (RES_KIT[f.level] || []).includes(k)); // a Residences home comes furnished for its level
  const y = 0, x0 = f.x, z0 = f.y, W = f.w, D = f.d, H = WALL_H, hue = f.hue || 30, n = typeof night === "number" ? night : 0;
  const tone = (l) => new THREE.Color().setHSL(hue / 360, 0.3, l).getHex();
  const kp = (name, x, yy, z, ry = 0, s = 1, tint) => { if (!hasKit(name)) return false; const pc = kitPieces(name, x, yy, z, ry, s, tint || new THREE.Color(0x6fae5c)); solid.push(...pc.solid); glow.push(...pc.glow); return true; };
  const home = typeof whereIs === "function" && whereIs(d) === "home";
  const lampsOn = home && n > 0.25;
  blk(W, 0.2, D, x0, y - 0.2, z0, 0x8a8f99);
  // floors: planks in the bedroom and living room, tiles in the kitchen
  const bw = W * 0.46, bd = D * 0.52; // the back rooms' size
  { const base = new THREE.Color(0xc79a6a); for (let z = z0, i = 0; z < z0 + D - 0.01; z += 0.28, i++) solid.push(box(W, 0.02, Math.min(0.27, z0 + D - z), x0 + W / 2, y + 0.01, z + Math.min(0.27, z0 + D - z) / 2, base.clone().multiplyScalar(i % 2 ? 0.94 : 1.02), 0)); }
  for (let tx = x0 + bw; tx < x0 + W - 0.01; tx += 0.4) for (let tz = z0; tz < z0 + bd - 0.01; tz += 0.4) solid.push(box(0.38, 0.025, 0.38, tx + 0.2, y + 0.015, tz + 0.2, new THREE.Color(((tx + tz) * 2.5 | 0) % 2 ? 0xe9e4da : 0xd6d0c4), 0));
  // outer walls (back and left stand; the cut-away front and right are open) with a skirting board
  blk(W, H, 0.12, x0, y, z0, tone(0.82)); blk(0.12, H, D, x0, y, z0, tone(0.74));
  blk(W, 0.1, 0.14, x0, y, z0, 0xf4efe4); blk(0.14, 0.1, D, x0, y, z0, 0xf4efe4);
  // inner walls, half height so the rooms read from above: bedroom | kitchen, back rooms | living room, with doorways
  const IH = 1.0, wallC = tone(0.88);
  blk(0.1, IH, bd - 0.9, x0 + bw, y, z0 + 0.12, wallC);                       // bedroom-kitchen wall, doorway at its front end
  blk(bw - 0.95, IH, 0.1, x0 + 0.12, y, z0 + bd, wallC);                      // bedroom's front wall, doorway on its right
  blk(W - bw - 1.0, IH, 0.1, x0 + bw + 1.0, y, z0 + bd, wallC);               // kitchen's front wall, doorway on its left
  for (const [x, z, w, dd] of [[x0 + bw, z0 + 0.12, 0.1, bd - 0.9], [x0 + 0.12, z0 + bd, bw - 0.95, 0.1], [x0 + bw + 1.0, z0 + bd, W - bw - 1.0, 0.1]]) blk(w + 0.02, 0.04, dd + 0.02, x - 0.01, y + IH, z - 0.01, 0xf4efe4); // wall caps
  // windows: the bedroom's and the kitchen's on the back wall, the living room's on the left; warm when they're home at night
  const winC = home && n > 0.25 ? 0xffd68c : n > 0.5 ? 0x28303c : 0x96c8ff;
  for (const [wx, ww] of [[x0 + bw * 0.25, bw * 0.5], [x0 + bw + (W - bw) * 0.55, (W - bw) * 0.35]]) { blk(ww, 0.8, 0.04, wx, y + 1.0, z0 + 0.13, winC, glow); blk(ww + 0.1, 0.06, 0.08, wx - 0.05, y + 0.96, z0 + 0.14, 0xf4efe4); blk(ww + 0.1, 0.06, 0.08, wx - 0.05, y + 1.8, z0 + 0.14, 0xf4efe4); }
  blk(0.04, 0.8, D * 0.3, x0 + 0.13, y + 1.0, z0 + bd + (D - bd) * 0.3, winC, glow);

  // the bedroom: their bed (the comfy one if they bought it), a nightstand with a lamp, a rug
  if (has("rug")) blk(bw * 0.7, 0.015, bd * 0.5, x0 + bw * 0.15, y + 0.03, z0 + bd * 0.4, 0xc94f6d);
  if (!(has("bed") && kp("it_bed", x0 + bw * 0.42, y, z0 + 0.95, Math.PI))) {
    blk(1.3, 0.35, 1.5, x0 + bw * 0.42 - 0.65, y, z0 + 0.15, 0x8a8070); blk(1.26, 0.1, 1.46, x0 + bw * 0.42 - 0.63, y + 0.35, z0 + 0.17, 0xcfc6b4); blk(0.5, 0.1, 0.3, x0 + bw * 0.42 - 0.25, y + 0.45, z0 + 0.22, 0xffffff);
  }
  blk(0.36, 0.42, 0.36, x0 + bw * 0.42 + 0.8, y, z0 + 0.18, 0x8b6a4a); blk(0.12, 0.22, 0.12, x0 + bw * 0.42 + 0.92, y + 0.42, z0 + 0.3, lampsOn ? 0xffd58a : 0xf3ead6, lampsOn ? glow : solid);
  // the kitchen: counters along the back wall, a fridge, a little table for two
  kp("in_kitchen", x0 + bw + (W - bw) * 0.45, y, z0 + 0.42, Math.PI, Math.min(0.8, (W - bw - 0.9) / 1.85));
  kp("in_fridge", x0 + W - 0.45, y, z0 + 0.45, Math.PI, 0.85);
  blk(0.7, 0.04, 0.7, x0 + bw + (W - bw) * 0.45 - 0.35, y + 0.68, z0 + bd * 0.62, 0xb48a62); blk(0.08, 0.68, 0.08, x0 + bw + (W - bw) * 0.45 - 0.04, y, z0 + bd * 0.62 + 0.31, 0x5a4632);
  // the living room: their things round the walls, the couch facing the TV, a floor lamp, a plant
  const LZ = z0 + bd + 0.1, LD = D - bd - 0.1; // living room depth
  const lspots = [[0.08, 0.35, Math.PI / 2], [0.08, 0.75, Math.PI / 2], [0.92, 0.25, -Math.PI / 2], [0.92, 0.7, -Math.PI / 2], [0.45, 0.9, 0], [0.7, 0.9, 0]];
  const homeItems = itemsAt(d.id, "home").filter((k) => !["bed", "rug", "couch", "tv"].includes(k));
  // the TV on the left wall, the couch facing it
  const tvx = x0 + 0.4, tvz = LZ + LD * 0.5, cx = x0 + W * 0.42, cz = tvz;
  if (has("tv")) { if (!kp("it_tv", tvx, y, tvz, Math.PI / 2)) { blk(0.3, 0.5, 1.0, x0 + 0.15, y, tvz - 0.5, 0x2c3440); blk(0.04, 0.6, 0.9, x0 + 0.46, y + 0.55, tvz - 0.45, 0x9cc7ff, glow); } }
  if (has("couch")) { if (!kp("it_couch", cx, y, cz, -Math.PI / 2)) { blk(0.7, 0.4, 1.5, cx - 0.35, y, cz - 0.75, 0xb48cff); blk(0.2, 0.75, 1.5, cx + 0.2, y, cz - 0.75, 0x9a74e0); } }
  else blk(0.6, 0.42, 0.6, cx - 0.3, y, cz - 0.3, 0x8b6a4a); // a plain armchair-ish seat that came with the house
  let si = 0;
  for (const k of homeItems) {
    const look = itemLook(k), [fx, fz, ry] = lspots[si++ % lspots.length], x = x0 + W * fx, z = LZ + LD * fz;
    const yy = k === "discoball" ? y + H - 0.05 : y; // the disco ball hangs from the ceiling
    const drawn = look.prop && kp(look.prop, k === "discoball" ? x0 + W * 0.42 : x, yy, k === "discoball" ? LZ + LD * 0.45 : z, ry, 1);
    if (look.stand || !drawn) { const sp = new THREE.Sprite(emojiMat(look.icon)); sp.scale.set(0.42, 0.42, 1); sp.position.set(x, y + (drawn ? 0.75 : 0.3), z); fg.add(sp); }
  }
  kp("in_floorlamp", x0 + W * 0.62, y, LZ + 0.35, 0, 1);
  if (lampsOn) blk(0.22, 0.05, 0.22, x0 + W * 0.62 - 0.11, y + 1.42, LZ + 0.24, 0xffe2a0, glow);
  if (!kp("in_plant", x0 + W - 0.4, y, z0 + D - 0.4, 0, 1)) { blk(0.3, 0.3, 0.3, x0 + W - 0.5, y, z0 + D - 0.5, 0xb5683c); blk(0.42, 0.42, 0.42, x0 + W - 0.56, y + 0.3, z0 + D - 0.56, 0x5fae5a); }
  // their pets, on the living-room floor
  itemsAt(d.id, "pets").forEach((k, i) => {
    const look = itemLook(k), x = x0 + W * (0.6 + i * 0.1), z = LZ + LD * 0.62;
    const drawn = look.prop && kp(look.prop, x, y, z, -0.8 - i, 1);
    if (look.stand || !drawn) { const sp = new THREE.Sprite(emojiMat(look.icon)); sp.scale.set(0.36, 0.36, 1); sp.position.set(x, y + (drawn ? 0.5 : 0.25), z); fg.add(sp); }
  });
  // who's in: them (when they're home) and anyone visiting them right now; drawn as the same little fellas as at work
  f._people = [];
  if (home) f._people.push({ d, x: cx - 0.05, y: y + 0.3, z: cz, hd: has("tv") ? -Math.PI / 2 : Math.PI / 4, sit: true }); // on the couch (or their seat), facing the TV if they have one
  const guests = typeof walkers !== "undefined" ? [...walkers.values()].filter((w) => w.visiting === d.id).map((w) => w.d) : [];
  guests.slice(0, 3).forEach((g, i) => f._people.push({ d: g, x: x0 + W * (0.55 + i * 0.12), y, z: LZ + LD * 0.35, hd: -Math.PI / 2 - 0.4 + i * 0.4 }));
  finishFloor(fg, f, y, 0, f.name, solid, glow);
}
// ---- Inside the Residences, 3D (2026-11-16, the residences-inside lane; the 2D twin is resRoom2D in city.js; plan
// docs/handoffs/residences-inside-plan.md). The same building inside as outside: each flat in the bay you see it in from
// outside (campusHomes.facade().bayOfFlat), that bay's colour on its accent wall and in its floor, the level's window
// and balcony seen from inside; every flat (to let too) comes with the level's basics (campusHomes.BASICS: a bed, a
// table and chairs, a kitchen, a bathroom, a wardrobe, a lamp, a radiator or a fireplace) as part of the room, never as
// belongings; what the owner bought comes from the belongings rule (shownOwned / ownAt) as before. Flat boxes (no
// rounding) and all merged into the floor's one mesh, so a floor still costs one or two draw calls.
const resHex = (s) => parseInt(String(s).slice(1), 16);
let builtPeople = new Map(); // room id -> who is drawn in it (kept across data refreshes that don't rebuild the inside)
// Inside the Residences the flats are built for who is home and whether it is dark (lamps, warm floors, people), so a
// change in either rebuilds them; elsewhere this adds nothing to the inside's key.
function resHomeKey() {
  const f0 = rooms[0]; if (!f0 || !(f0.resFloor || (f0.house && f0.level != null)) || typeof whereIs !== "function") return "";
  const ids = rooms.flatMap((f) => (f.flats ? f.flats : [f.desk?.id])).filter(Boolean);
  return `|${ids.map((id) => { const d = deskById(id); return d && whereIs(d) === "home" ? 1 : 0; }).join("")}|${(typeof night === "number" ? night : 0) > 0.25 ? "n" : "d"}`;
}
// o: { a, z0, W, D, y, lv, id, dk, bay, curtain, full, PH, G, solid, glow, kp, fg, people }
//   a..a+W across; z0 = its corridor wall (the front door); z0+D = its window. Returns { seat, bal }.
function resRoom3D(o) {
  const { a, z0, W, D, y, lv, id, dk, bay, solid, glow, kp, fg } = o, full = !!o.full, PH = o.PH || 1.1, Z1 = z0 + D, n = typeof night === "number" ? night : 0;
  const home = !!dk && typeof whereIs === "function" && whereIs(dk) === "home", lit = home && n > 0.25;
  const own = dk ? shownOwned(id) : [], has = (k) => own.includes(k) || (RES_KIT[lv] || []).includes(k);
  const b = (w, h, d, x, yy, z, c, list = solid) => { if (w > 0.005 && h > 0.005 && d > 0.005) list.push(box(w, h, d, x + w / 2, yy + h / 2, z + d / 2, new THREE.Color(c), 0)); };
  const mix = (p, q, k) => resHex(resMix(p, q, k)), wall = resHex(bay.wall), acc = resHex(bay.accent);
  const wood = 0x9a7550, woodD = 0x7d5c3e, white = 0xf6f2ea, trim = 0xfbf6ec, cur = resHex(o.curtain || "#f3e7c9"), green = 0x5fae5a;
  // the floor: warm boards with the bay's colour in them (glowing warm when they're home at night)
  const floorC = mix(["#d4ad80", "#cda070", "#c09468", "#c9a882"][lv], bay.wall, 0.28);
  b(W, 0.02, D, a, y, z0, lit ? mix(resMix(["#d4ad80", "#cda070", "#c09468", "#c9a882"][lv], bay.wall, 0.28), "#ffd690", 0.35) : floorC, lit ? glow : solid);
  // the corridor wall with the front door (and a mat outside it), the partition on the left in the bay's colour
  const doorX = a + W * (lv === 3 ? 0.5 : 0.4), doorW = Math.min(0.75, W * 0.22), dH = Math.min(PH * 0.95, 1.95);
  b(W, PH, 0.08, a, y, z0 - 0.08, mix("#f4ecdc", bay.wall, 0.35));
  b(doorW + 0.08, dH + 0.05, 0.03, doorX - 0.04, y, z0, trim); b(doorW, dH, 0.04, doorX, y, z0 + 0.01, wood);
  b(0.05, 0.05, 0.04, doorX + doorW * 0.82, y + dH * 0.5, z0 + 0.05, 0xd9b45a);
  b(doorW - 0.06, 0.012, 0.32, doorX + 0.03, y, z0 - 0.45, mix("#8a6a48", bay.accent, 0.35));
  b(0.08, PH, D, a - 0.04, y, z0, wall);
  // the bathroom: a tiled corner behind its own walls and door (a shower; a bath from Nice up; a real room upstairs-size in the penthouse)
  const bW = Math.min(lv >= 2 ? 1.7 : 1.3, W * (lv === 3 ? 0.17 : 0.42)), bD = Math.min(lv >= 2 ? 1.7 : 1.35, D * 0.3), bH = Math.min(PH * 0.85, 1.8);
  b(bW, 0.025, bD, a, y, z0, 0xe4eef0);
  b(0.62, 0.06, 0.62, a + 0.06, y, z0 + 0.06, 0xcfe6f0); b(0.05, Math.min(1.7, bH), 0.05, a + 0.08, y, z0 + 0.08, 0xb9c0c6);
  if (lv >= 2) { b(Math.min(1.0, bW - 0.75), 0.45, 0.6, a + 0.72, y, z0 + 0.06, white); b(Math.min(1.0, bW - 0.75) - 0.1, 0.02, 0.5, a + 0.77, y + 0.44, z0 + 0.11, 0xbfe0ee); }
  b(0.34, 0.36, 0.42, a + bW - 0.45, y, z0 + (lv >= 2 ? 0.75 : 0.1), white); // the toilet
  b(0.06, bH, bD, a + bW - 0.03, y, z0, 0xeef3f3); b(bW - 0.6, bH, 0.06, a, y, z0 + bD - 0.03, 0xeef3f3);
  b(0.52, bH * 0.92, 0.04, a + bW - 0.58, y, z0 + bD - 0.02, wood); // its door
  // a wardrobe on the left wall (in the penthouse it is in the dressing room on the gallery)
  const wdZ = z0 + bD + 0.12, wdD = [0.75, 0.95, 1.2, 1.2][lv];
  if (lv < 3) { b(0.55, Math.min(1.6, PH * 1.35), wdD, a + 0.05, y, wdZ, wood); b(0.01, Math.min(1.5, PH * 1.3), 0.02, a + 0.6, y + 0.04, wdZ + wdD / 2, woodD); }
  // the kitchen along the corridor wall right of the door: counter, sink, hob, fridge; cupboards over it (full view);
  // an island with stools from Nice up
  const kx0 = doorX + doorW + 0.2, kL = Math.max(1.0, Math.min(a + W - 0.25 - kx0, [1.6, 2.0, 2.6, 3.6][lv])), top = mix(["#e9e3d8", "#e2dccf", "#d8d2c8", "#cfc9c0"][lv], "#ffffff", 0), front = lv >= 2 ? mix("#f6f2ea", bay.accent, 0.35) : white;
  b(kL - 0.65, 0.82, 0.55, kx0, y, z0 + 0.02, front); b(kL - 0.65, 0.04, 0.58, kx0, y + 0.82, z0 + 0.01, top);
  b(0.38, 0.015, 0.3, kx0 + 0.1, y + 0.86, z0 + 0.12, 0xb9c0c6); b(0.42, 0.015, 0.36, kx0 + kL - 1.15, y + 0.86, z0 + 0.1, 0x3a3f48);
  if (!kp("in_fridge", kx0 + kL - 0.33, y, z0 + 0.32, 0, lv >= 1 ? 0.85 : 0.6)) b(0.58, lv >= 1 ? 1.6 : 0.9, 0.55, kx0 + kL - 0.62, y, z0 + 0.02, white);
  if (lv >= 1 && full) b(kL - 0.65, 0.55, 0.32, kx0, y + 1.4, z0 + 0.02, front);
  if (lv >= 2) { const iw = Math.min(1.8, kL - 0.5); b(iw, 0.88, 0.6, kx0 + 0.1, y, z0 + 1.15, front); b(iw + 0.06, 0.04, 0.66, kx0 + 0.07, y + 0.88, z0 + 1.12, top); for (let q = 0; q < (lv === 3 ? 3 : 2); q++) { const sx = kx0 + 0.25 + (q * (iw - 0.5)) / Math.max(1, lv === 3 ? 2 : 1); b(0.3, 0.6, 0.3, sx, y, z0 + 1.85, woodD); } }
  // where they sleep: single (Basic), double (Comfy), a double in its own room behind a half wall (Nice), a big bed on
  // the gallery (Penthouse). A bought comfy bed is the bed (never two): the kit bed instead of the plain one.
  const comfy = has("bed"), bedW = [0.95, 1.4, 1.5, 1.7][lv], bedL = [1.9, 2.0, 2.0, 2.1][lv];
  const bed = (x, yy, z) => {
    if (comfy && kp("it_bed", x + bedW / 2, yy, z + bedL / 2, Math.PI, bedW / 1.4)) return;
    b(bedW, 0.3, bedL, x, yy, z, woodD); b(bedW - 0.06, 0.16, bedL - 0.06, x + 0.03, yy + 0.3, z + 0.03, white);
    b(bedW - 0.04, 0.04, bedL * 0.55, x + 0.02, yy + 0.46, z + bedL * 0.42, comfy ? 0x6ea8ff : cur); b(bedW - 0.3, 0.1, 0.3, x + 0.15, yy + 0.46, z + 0.1, 0xffffff);
    b(bedW, 0.75, 0.06, x, yy, z - 0.06, woodD); // headboard
  };
  let bedRight = a + 0.2, bedZ = 0;
  // a bedroom behind a half wall: Nice, and Comfy now it has a one-bedroom's width (the sizes lane, 2026-11-16)
  const bedroom = lv === 2 || (lv === 1 && W >= 3.8);
  if (lv < 3) {
    bedZ = bedroom ? z0 + bD + 0.25 : Math.min(Z1 - bedL - 0.5, wdZ + wdD + 0.25);
    const bx0 = bedroom ? a + 0.7 : a + 0.08;
    bed(bx0, y, bedZ); bedRight = bx0 + bedW;
    if (bedroom) b(Math.min(W * 0.45, 2.6), Math.min(PH, 1.0), 0.08, a, y, bedZ + bedL + 0.35, mix("#f4ecdc", bay.wall, 0.35)); // the bedroom's half wall
    b(0.45, 0.012, 0.8, bedRight + 0.06, y, bedZ + 0.4, mix("#e8d6b8", bay.accent, 0.25)); // a bedside mat
    b(0.02, 0.5, Math.min(0.9, bedL * 0.45), a + 0.005, y + Math.min(PH * 0.55, 1.2), bedZ + bedL * 0.3, trim); b(0.02, 0.4, Math.min(0.8, bedL * 0.4), a + 0.01, y + Math.min(PH * 0.55, 1.2) + 0.05, bedZ + bedL * 0.32, mix(bay.accent, "#f3e7c9", 0.35)); // a picture over the bed
  }
  // the floor lamp, lit at night when they're home
  const lampX = lv === 3 ? a + W * 0.36 : bedRight + 0.3, lampZ = lv === 3 ? Z1 - 1.6 : bedZ + 0.2;
  if (!kp("in_floorlamp", lampX, y, lampZ, 0, 1)) { b(0.04, 1.4, 0.04, lampX - 0.02, y, lampZ - 0.02, 0x4a4a4a); b(0.3, 0.22, 0.3, lampX - 0.15, y + 1.3, lampZ - 0.15, 0xf3e2c0); }
  if (lit) b(0.34, 0.26, 0.34, lampX - 0.17, y + 1.22, lampZ - 0.17, 0xffe2a0, glow);
  // the table and chairs (two; four from Nice up; six in the penthouse), by the kitchen
  const seats = [2, 2, 4, 6][lv], tW = [0.7, 0.8, 1.2, 1.8][lv], tX = lv === 3 ? a + W * 0.62 : a + W - tW - 0.45, tZ = lv === 0 ? Z1 - 1.35 : z0 + bD + (lv >= 2 ? 1.25 : 0.55);
  b(tW, 0.05, 0.7, tX, y + 0.72, tZ, wood); b(0.08, 0.72, 0.08, tX + tW / 2 - 0.04, y, tZ + 0.31, woodD);
  for (let s = 0; s < seats; s++) { const side = s % 2, n2 = Math.ceil(seats / 2), cx = tX + ((Math.floor(s / 2) + 0.5) * tW) / n2 - 0.17; b(0.34, 0.45, 0.34, cx, y, side ? tZ + 0.78 : tZ - 0.42, mix("#8b6a4a", bay.accent, 0.3)); b(0.34, 0.4, 0.05, cx, y + 0.45, side ? tZ + 1.07 : tZ - 0.42, mix("#8b6a4a", bay.accent, 0.3)); }
  // warmth: a radiator under the window (a fireplace in the penthouse)
  const winW = Math.min(W - 0.4, W * [0.5, 0.56, 0.84, 0.94][lv]), wx0 = a + (W - winW) / 2, wx1 = wx0 + winW;
  if (lv === 3) { b(0.45, 1.0, 1.2, a + 0.02, y, Z1 - 2.6, 0xc9bfae); b(0.05, 0.4, 0.7, a + 0.47, y + 0.15, Z1 - 2.35, n > 0.3 || lit ? 0xff9a50 : 0x2c2a28, n > 0.3 || lit ? glow : solid); }
  else b(Math.min(1.1, winW * 0.5), 0.45, 0.1, a + (W - Math.min(1.1, winW * 0.5)) / 2, y + 0.1, Z1 - 0.2, white);
  // the level's extras (FURNISHED): a rug, a sofa, a TV, shelves; else a small woven mat; and a plant in the corner
  const sw = Math.min(1.9, W * 0.4), sx = Math.max(a + W * 0.5 - sw / 2, bedRight + 0.35), sz = Z1 - 1.45;
  if (has("rug")) b(Math.min(2.2, W * 0.42), 0.012, 1.5, sx - 0.15, y, sz - 1.0, mix(lv >= 2 ? "#7d5ba6" : "#c94f6d", bay.accent, 0.25));
  else b(Math.min(1.1, W * 0.35), 0.012, 0.8, a + W * 0.45, y, Z1 - 1.5, mix("#d8b48a", bay.accent, 0.3));
  let seat = null;
  if (has("couch")) { if (!kp("it_couch", sx + sw / 2, y, sz + 0.3, 0, Math.min(1, sw / 1.9))) { b(sw, 0.42, 0.7, sx, y, sz, mix("#9a7fd0", bay.accent, 0.45)); b(sw, 0.5, 0.18, sx, y + 0.42, sz + 0.52, mix("#9a7fd0", bay.accent, 0.4)); } seat = [sx + sw / 2, y + 0.3, sz + 0.3, Math.PI]; }
  if (has("tv") && !kp("it_tv", sx + sw / 2, y, sz - 1.25, 0, 0.9)) b(1.0, 0.6, 0.06, sx + sw / 2 - 0.5, y + 0.5, sz - 1.25, 0x2c3440);
  if (has("bookshelf")) { if (lv === 3) b(0.35, 1.6, 0.9, a + 0.02, y, Z1 - 3.7, wood); else kp("in_shelf", a + Math.min(W * 0.45, 2.6) - 0.6, y, bedZ + bedL + 0.6, 0, 0.8, new THREE.Color(0x5f9a4c)) || b(0.9, 1.3, 0.3, a + Math.min(W * 0.45, 2.6) - 1.0, y, bedZ + bedL + 0.45, wood); }
  if (!kp("in_plant", a + W - 0.4, y, Z1 - 0.45, 0, 0.9)) { b(0.3, 0.3, 0.3, a + W - 0.55, y, Z1 - 0.6, 0xb5683c); b(0.42, 0.42, 0.42, a + W - 0.61, y + 0.3, Z1 - 0.66, green); }
  // the penthouse: a stair up to the gallery over the back of the room, the big bed and a dressing room up there
  if (lv === 3) {
    const G = o.G || 1.3, gx0 = a + bW + 0.85, gw = Math.max(2.4, doorX - 0.3 - gx0), gd = Math.min(D * 0.45, 2.4);
    for (let s = 0; s < 7; s++) b(0.7, (G * (s + 1)) / 7, 0.26, a + bW + 0.08, y, z0 + gd + 1.6 - s * 0.26, 0xd8cfbd);
    b(gw, 0.08, gd, gx0, y + G, z0, floorC); b(gw, 0.05, 0.05, gx0, y + G + 0.95, z0 + gd - 0.05, 0x5a4a38); for (let q = 0; q <= 4; q++) b(0.04, 0.95, 0.04, gx0 + (q * (gw - 0.04)) / 4, y + G, z0 + gd - 0.05, 0x5a4a38);
    b(0.6, 1.5, 1.0, gx0 + 0.1, y + G + 0.08, z0 + 0.1, wood); // the dressing room's wardrobe
    bed(gx0 + 0.85, y + G + 0.08, z0 + 0.15);
    if (lit) b(0.2, 0.06, 0.2, gx0 + gw - 0.4, y + G + 1.4, z0 + 0.3, 0xffe2a0, glow);
  }
  // the front, seen from inside: a sill, the window frame (a balcony door from Comfy up, a glass wall in the penthouse),
  // curtains (drawn on a flat to let, as outside)
  const WT = lv === 3 ? Math.max(2.2, (o.G || 1.3) + 1.2) : 1.9, door = lv >= 1;
  if (!door) b(W, 0.5, 0.1, a, y, Z1 - 0.1, mix(bay.wall, "#ffffff", 0.1)); else { b(wx0 - a, 0.5, 0.1, a, y, Z1 - 0.1, mix(bay.wall, "#ffffff", 0.1)); b(a + W - wx1, 0.5, 0.1, wx1, y, Z1 - 0.1, mix(bay.wall, "#ffffff", 0.1)); }
  for (const px of [wx0 - 0.05, wx1]) b(0.05, WT, 0.06, px, y, Z1 - 0.06, trim);
  b(winW + 0.1, 0.06, 0.06, wx0 - 0.05, y + WT, Z1 - 0.06, trim);
  if (lv === 3) for (let q = wx0 + 1.6; q < wx1 - 0.4; q += 1.6) b(0.04, WT, 0.05, q, y, Z1 - 0.05, trim);
  const cW = Math.min(0.32, winW * 0.16);
  b(cW, WT - 0.1, 0.05, wx0, y + 0.05, Z1 - 0.14, cur); b(cW, WT - 0.1, 0.05, wx1 - cW, y + 0.05, Z1 - 0.14, cur);
  if (!dk && lv < 3) b(winW * 0.6, (WT - 0.1) * 0.9, 0.05, wx0 + winW * 0.2, y + 0.15, Z1 - 0.14, cur);
  // outside the window: Basic's open shutters and flower box; Comfy's solid painted balcony; Nice's glass balcony with
  // a timber rail, planters and the striped awning; the penthouse's terrace with a pergola
  let bal = null;
  if (lv === 0) {
    const sh = mix(bay.accent, "#f4ecdc", 0.3); b(0.32, WT - 0.7, 0.04, wx0 - 0.36, y + 0.55, Z1 + 0.02, sh); b(0.32, WT - 0.7, 0.04, wx1 + 0.04, y + 0.55, Z1 + 0.02, sh);
    b(winW, 0.16, 0.2, wx0, y + 0.42, Z1, wood); const FL = [0xe86f8a, 0xf2c14e, 0xf4f0f0, 0xd9534f, 0xb48ad6]; for (let q = 0; q < Math.max(3, Math.round(winW / 0.18)); q++) b(0.08, 0.08, 0.08, wx0 + 0.06 + q * 0.18, y + 0.58, Z1 + 0.06, FL[q % FL.length]);
  } else {
    const bw = lv === 3 ? W - 0.3 : W * (lv === 1 ? 0.66 : 0.9), bd = [0, 0.9, 1.1, 1.6][lv], b0 = a + (W - bw) / 2;
    b(bw, 0.06, bd, b0, y, Z1, lv === 3 ? 0xc8a57e : 0xece6da);
    if (lv === 1) { b(bw, 0.55, 0.05, b0, y, Z1 + bd - 0.05, acc); b(0.05, 0.55, bd, b0, y, Z1, acc); b(0.05, 0.55, bd, b0 + bw - 0.05, y, Z1, acc); b(bw * 0.4, 0.14, 0.14, b0 + bw * 0.3, y + 0.55, Z1 + bd - 0.12, green); }
    else {
      b(bw, 0.05, 0.06, b0, y + 0.55, Z1 + bd - 0.06, wood); for (let q = 0; q <= 4; q++) b(0.03, 0.55, 0.03, b0 + (q * (bw - 0.03)) / 4, y, Z1 + bd - 0.05, 0x9aa8b0);
      for (const px of [b0 + 0.08, b0 + bw - 0.42]) { b(0.34, 0.3, 0.34, px, y + 0.06, Z1 + 0.08, 0xb5683c); b(0.38, 0.3, 0.38, px - 0.02, y + 0.36, Z1 + 0.06, green); }
      if (lv === 2) { const m = Math.max(4, Math.round(bw / 0.3)); for (let q = 0; q < m; q++) b(bw / m, 0.04, Math.min(0.55, bd * 0.5), b0 + (q * bw) / m, y + WT + 0.1, Z1, q % 2 ? trim : acc); }
      else { const pz = Math.min(WT, 2.2); for (const px of [b0 + 0.3, b0 + bw - 0.36]) b(0.07, pz, 0.07, px, y, Z1 + bd - 0.12, wood); b(bw - 0.6, 0.08, 0.08, b0 + 0.3, y + pz, Z1 + bd - 0.13, wood); for (let q = b0 + 0.3; q <= b0 + bw - 0.3; q += 1.1) b(0.05, 0.05, bd, q, y + pz + 0.06, Z1, 0xb08a60); }
    }
    bal = { cx: a + W / 2, z: Z1 + bd * 0.5, bw: bw * 0.8, bd };
  }
  return { seat, bal, home, tZ, tX, tW };
}
// The ground floor (3D): the lobby behind the entrance, the lift and stairs where they are on every floor, mailboxes, a
// bench, and what everyone shares (campusHomes.SHARED): the laundry room, bike storage, the common room.
function buildResLobby(f, fg, kp, glow, solid) {
  const y = floorY(f), x0 = f.x, z0 = f.y, W = f.w, D = f.d, cx = x0 + W / 2, n = typeof night === "number" ? night : 0;
  const b = (w, h, d, x, yy, z, c, list = solid) => { if (w > 0.005 && h > 0.005 && d > 0.005) list.push(box(w, h, d, x + w / 2, yy + h / 2, z + d / 2, new THREE.Color(c), 0)); };
  const F = resInFacade(f.tower), accS = F ? F.bayAt(F.door).accent : "#3d6585", acc = resHex(accS), lw = Math.min(W * 0.3, 4.2), rw = Math.min(W * 0.3, 4.2), r0 = x0 + W - rw;
  b(W, 0.2, D, x0, y - 0.2, z0, 0x8a8f99);
  b(W, 0.02, D, x0, y, z0, 0xe6d6bc); b(rw, 0.025, D, r0, y, z0, 0xc99a68); b(lw, 0.025, D * 0.55, x0, y, z0, 0xe4eef0);
  b(W, WALL_H, 0.12, x0, y, z0, 0xf2e9d8); b(0.12, WALL_H, D, x0, y, z0, 0xa8644c);
  // the core: the lift (steel doors, the floor lamp over it) and the stairs, mid-back, as on every floor
  b(1.2, 2.0, 0.06, cx - 1.5, y, z0 + 0.12, 0x9aa3ad); b(0.5, 1.85, 0.04, cx - 1.45, y, z0 + 0.18, 0xc9ced4); b(0.5, 1.85, 0.04, cx - 0.9, y, z0 + 0.18, 0xc0c6cd); b(0.3, 0.1, 0.03, cx - 1.05, y + 1.92, z0 + 0.19, 0xffb04a, glow);
  for (let s = 0; s < 7; s++) b(0.24, 0.17 * (s + 1), 0.9, cx + 0.25 + s * 0.24, y, z0 + 0.15, 0xd9cbb2);
  // mailboxes on the back wall, a bench each side of the door, a rug, plants
  b(1.4, 0.9, 0.2, cx - 3.2, y + 0.4, z0 + 0.12, 0x8a8f78); for (let i = 1; i < 5; i++) b(0.015, 0.9, 0.02, cx - 3.2 + i * 0.28, y + 0.4, z0 + 0.32, 0xf0ecdc); b(1.4, 0.015, 0.02, cx - 3.2, y + 0.7, z0 + 0.32, 0xf0ecdc); b(1.4, 0.015, 0.02, cx - 3.2, y + 1.0, z0 + 0.32, 0xf0ecdc);
  b(2.4, 0.012, 1.8, cx - 1.2, y, z0 + D - 2.2, resHex(resMix("#a8584a", accS, 0.25)));
  for (const s of [-1, 1]) { b(1.2, 0.45, 0.45, cx + s * 1.9 - 0.6, y, z0 + D - 1.6, 0x9a7550); b(1.2, 0.45, 0.08, cx + s * 1.9 - 0.6, y + 0.45, z0 + D - 1.2, 0x7d5c3e); kp("in_plant", cx + s * 2.9, y, z0 + D - 0.6, 0, 1.1, new THREE.Color(0x5f9a4c)); }
  // the laundry room: half walls with a doorway, washers along the back wall, a folding table
  b(0.08, 1.1, D * 0.55 - 1.0, x0 + lw - 0.04, y, z0, 0xeef3f3); b(lw - 1.0, 1.1, 0.08, x0, y, z0 + D * 0.55 - 0.04, 0xeef3f3);
  for (let i = 0; i < Math.max(2, Math.floor((lw - 0.5) / 0.75)); i++) { const wx = x0 + 0.3 + i * 0.75; b(0.65, 0.85, 0.6, wx, y, z0 + 0.15, 0xf6f2ea); b(0.4, 0.4, 0.02, wx + 0.12, y + 0.25, z0 + 0.75, 0x5a6a78); }
  b(Math.min(1.6, lw - 0.9), 0.05, 0.6, x0 + 0.3, y + 0.8, z0 + 1.2, 0x9a7550); b(0.06, 0.8, 0.06, x0 + 0.4, y, z0 + 1.45, 0x7d5c3e);
  // bike storage: a rack and the bikes (two wheels and a frame each)
  b(lw - 0.6, 0.35, 0.06, x0 + 0.3, y, z0 + D - 0.45, 0x7d8794);
  for (let i = 0; i < Math.max(2, Math.floor((lw - 0.6) / 0.6)); i++) { const bx = x0 + 0.5 + i * 0.6; b(0.04, 0.6, 0.6, bx, y, z0 + D - 1.25, 0x2c3440); b(0.04, 0.6, 0.6, bx, y, z0 + D - 0.55 - 0.05, 0x2c3440); b(0.05, 0.06, 0.8, bx, y + 0.55, z0 + D - 1.15, [0xc94f4f, 0x3d6585, 0x5fae5a][i % 3]); }
  // the common room: a sofa and armchairs round a low table, shelves, a table for games, a lamp, a plant
  b(0.08, 1.1, D - 1.4, r0 - 0.04, y, z0, 0xf4ecdc);
  if (!kp("in_sofa", r0 + rw / 2, y, z0 + 0.7, Math.PI, 0.85)) b(Math.min(1.8, rw - 1.2), 0.5, 0.8, r0 + 0.6, y, z0 + 0.3, 0xc9785a);
  b(Math.min(1.1, rw - 1.6), 0.4, 0.6, r0 + rw / 2 - 0.55, y, z0 + 1.45, 0x9a7550);
  for (const ax of [r0 + 0.35, r0 + rw - 0.85]) b(0.55, 0.5, 0.55, ax, y, z0 + 1.4, 0xd9a441);
  kp("in_shelf", x0 + W - 0.25, y, z0 + 1.4, -Math.PI / 2, 0.9, new THREE.Color(0x5f9a4c));
  b(Math.min(1.6, rw - 1.2), 0.05, 0.9, r0 + 0.6, y + 0.72, z0 + D - 2.1, 0x9a7550); b(0.08, 0.72, 0.08, r0 + 1.2, y, z0 + D - 1.7, 0x7d5c3e);
  kp("in_floorlamp", r0 + 0.3, y, z0 + 2.4, 0, 1); if (n > 0.25) { b(0.24, 0.06, 0.24, r0 + 0.18, y + 1.42, z0 + 2.28, 0xffe2a0, glow); b(0.24, 0.06, 0.24, cx - 0.12, y + 2.1, z0 + D * 0.5, 0xffe2a0, glow); }
  // the front: brick piers and windows, the glass doors mid-front, the canopy over them
  b(cx - 0.9 - x0, 0.5, 0.12, x0, y, z0 + D - 0.12, 0xa8644c); b(x0 + W - cx - 0.9, 0.5, 0.12, cx + 0.9, y, z0 + D - 0.12, 0xa8644c);
  for (const q of [cx - 0.9, cx - 0.03, cx + 0.85]) b(0.06, 2.0, 0.08, q, y, z0 + D - 0.08, 0x5a4a38); b(1.86, 0.08, 0.08, cx - 0.93, y + 2.0, z0 + D - 0.08, 0x5a4a38);
  b(2.6, 0.08, 1.2, cx - 1.3, y + 2.25, z0 + D, acc); for (const s of [-1, 1]) b(0.06, 2.25, 0.06, cx + s * 1.2 - 0.03, y, z0 + D + 1.1, 0x5a4a38);
  b(1.4, 0.012, 0.6, cx - 0.7, y, z0 + D - 0.75, 0x5a4a3a);
  for (const [t, x, z] of [["Mailboxes", cx - 2.5, z0 + 0.3], ["Laundry", x0 + lw / 2, z0 + 1.6], ["Bikes", x0 + lw / 2, z0 + D - 1.0], ["Common room", r0 + rw / 2, z0 + 2.2], ["Residences", cx, z0 + D + 0.6]]) { const tag = new THREE.Object3D(); tag.position.set(x, y + (t === "Residences" ? 2.5 : 1.5), z); fg.add(tag); sign(tag, t, 0, 0, 0, "small"); }
}
// A floor of homes inside a Residences tower: a carpeted corridor along the back with the lift and the stairs in the
// middle (over the entrance, the same place on every floor), lights along it and a plant at each end, then the flats in
// the outside's order. The owner is on their sofa (or at their table) when home, on the balcony now and then. Tap a
// flat for its home.
const RES_KIT = [[], ["rug", "couch"], ["rug", "couch", "tv", "bookshelf"], ["rug", "couch", "tv", "bookshelf", "bed"]];
function buildResFloor(f, fg, blk, kp, glow, solid) {
  if (f.lobby) return buildResLobby(f, fg, kp, glow, solid);
  const y = floorY(f), x0 = f.x, z0 = f.y, W = f.w, D = f.d, CD = 1.3, lv = f.level, k = Math.max(1, f.perFloor), cw = W / k, n = typeof night === "number" ? night : 0, cx = x0 + W / 2;
  const b = (w, h, d, x, yy, z, c, list = solid) => { if (w > 0.005 && h > 0.005 && d > 0.005) list.push(box(w, h, d, x + w / 2, yy + h / 2, z + d / 2, new THREE.Color(c), 0)); };
  const F = resInFacade(f.tower), bay0 = F ? F.bayOfFlat(0, k) : { wall: "#e6c88e", accent: "#3d6585" }, WH = lv === 3 ? WALL_H + 1.4 : WALL_H;
  b(W, 0.2, D, x0, y - 0.2, z0, 0x8a8f99);
  // the corridor: carpet with a border, the outer walls (cream inside, the end wall in the first bay's plaster), lights
  b(W, 0.02, CD, x0, y, z0, 0xe9dfcc); b(W - 0.3, 0.012, CD - 0.55, x0 + 0.15, y + 0.02, z0 + 0.22, 0xa8584a); b(W - 0.5, 0.012, CD - 0.75, x0 + 0.25, y + 0.03, z0 + 0.32, 0xb9685a);
  b(W, WH, 0.12, x0, y, z0, 0xf2e9d8); b(0.12, WH, D, x0, y, z0, resHex(resShade(bay0.wall, 0.92)));
  for (let q = x0 + 1.4; q < x0 + W - 0.6; q += 2.6) b(0.3, 0.16, 0.08, q - 0.15, y + 1.7, z0 + 0.12, n > 0.3 ? 0xffe2a0 : 0xe8d9b8, n > 0.3 ? glow : solid);
  // the core: lift and stairs mid-corridor
  b(1.2, 2.0, 0.06, cx - 1.5, y, z0 + 0.12, 0x9aa3ad); b(0.5, 1.85, 0.04, cx - 1.45, y, z0 + 0.18, 0xc9ced4); b(0.5, 1.85, 0.04, cx - 0.9, y, z0 + 0.18, 0xc0c6cd); b(0.3, 0.1, 0.03, cx - 1.05, y + 1.92, z0 + 0.19, 0xffb04a, glow);
  for (let s = 0; s < 7; s++) b(0.24, 0.17 * (s + 1), 0.85, cx + 0.25 + s * 0.24, y, z0 + 0.14, 0xd9cbb2);
  for (const px of [x0 + 0.45, x0 + W - 0.45]) if (!kp("in_plant", px, y, z0 + 0.45, px, 1.0, new THREE.Color(0x5f9a4c))) { b(0.3, 0.3, 0.3, px - 0.15, y, z0 + 0.3, 0xb5683c); b(0.42, 0.42, 0.42, px - 0.21, y + 0.3, z0 + 0.24, 0x5fae5a); }
  f._people = [];
  for (let j = 0; j < k; j++) {
    const id = f.flats[j] || null, dk = id && typeof deskById === "function" && deskById(id), a = x0 + j * cw, Z0 = z0 + CD, FD = D - CD;
    const bay = F ? F.bayOfFlat(j, k) : bay0, R = resRoom3D({ a, z0: Z0, W: cw, D: FD, y, lv, id, dk, bay, curtain: F ? F.curtain(f.storey, j) : "#f3e7c9", PH: 1.1, G: 1.3, solid, glow, kp, fg });
    if (!dk) { // to let: ready to move into; a word sign on it, a tap opens the floor
      const pick = new THREE.Mesh(new THREE.BoxGeometry(cw, WALL_H + 0.3, FD), new THREE.MeshBasicMaterial({ visible: false })); pick.position.set(a + cw / 2, y + (WALL_H + 0.3) / 2, Z0 + FD / 2); pick.name = "pick"; pick.userData.room = f.id; pick.userData.k = f.k; fg.add(pick); picks.push(pick);
      const tag = new THREE.Object3D(); tag.position.set(a + cw / 2, y + 0.2, z0 + D + 0.5); fg.add(tag); sign(tag, "To let · ready to move in", 0, 0, 0, "small").element.classList.add("tolet");
      continue;
    }
    // what they bought for home and their pets (belongings.js "flat") on free floor; balcony things on the balcony
    if (typeof ownAt === "function") {
      const put = (key, x, yy, z, s, ry = 0) => { const look = itemLook(key), drawn = !!look.prop && kp(look.prop, x, yy, z, ry, s); if (look.stand || !drawn) { const sp = new THREE.Sprite(emojiMat(look.icon)); sp.scale.set(0.36, 0.36, 1); sp.position.set(x, yy + (drawn ? 0.6 : 0.3), z); fg.add(sp); } };
      const spots = [[0.62, 0.48], [0.82, 0.3], [0.45, 0.7], [0.88, 0.62], [0.6, 0.86], [0.3, 0.55], [0.5, 0.36]];
      ownAt(id, "flat").filter((key) => !["rug", "bed", "bookshelf", "couch", "tv"].includes(key)).forEach((key, i) => {
        const [fx, fz] = spots[i % spots.length], pet = data.perks?.[key]?.cat === "pets";
        if (key === "discoball") return put(key, a + cw * 0.5, y + WALL_H - 0.05, Z0 + FD * 0.5, 0.8);
        put(key, a + cw * fx, y, Z0 + FD * fz, pet ? 0.9 : Math.min(0.85, cw / 3.2), -Math.PI / 2 + i);
      });
      if (R.bal) { const keys = ownAt(id, "balcony"); keys.forEach((key, i) => put(key, R.bal.cx - R.bal.bw / 2 + (R.bal.bw * (i + 0.5)) / keys.length, y + 0.06, R.bal.z, 0.55)); }
    }
    if (R.home) { const onBal = R.bal && typeof onBalconyNow === "function" && onBalconyNow(id); f._people.push(onBal ? { d: dk, x: R.bal.cx + R.bal.bw * 0.3, y: y + 0.06, z: R.bal.z, hd: 0 } : R.seat ? { d: dk, x: R.seat[0], y: R.seat[1], z: R.seat[2], hd: R.seat[3], sit: true } : { d: dk, x: a + cw * 0.55, y, z: Z0 + FD * 0.62, hd: Math.PI / 4 }); }
    const pick = new THREE.Mesh(new THREE.BoxGeometry(cw, WALL_H + 0.3, FD + 0.6), new THREE.MeshBasicMaterial({ visible: false })); pick.position.set(a + cw / 2, y + (WALL_H + 0.3) / 2, Z0 + (FD + 0.6) / 2); pick.name = "pick"; pick.userData.room = `house:${id}`; pick.userData.k = f.k; fg.add(pick); picks.push(pick);
    const tag = new THREE.Object3D(); tag.position.set(a + cw / 2, y + 0.2, z0 + D + (lv >= 1 ? 1.3 : 0.5)); fg.add(tag); sign(tag, `${nameOf(dk)} · ${R.home ? "home" : { work: "at work", away: "away", nowhere: "moving in", meeting: "in a meeting" }[whereIs(dk)] || "out"}`, 0, 0, 0, "small");
  }
}
// A Residences home on its own (the single-home view): the same room at the level's size, the corridor and its front
// door behind it, the window and balcony in front; the penthouse is two storeys, a gallery bedroom up a stair.
function buildResHome(f, fg, solid, glow, kpRaw) {
  const d = f.desk, hm = typeof homeOf === "function" && homeOf(d.id), lv = Math.max(0, f.level | 0), x0 = f.x, z0 = f.y, W = f.w, D = f.d, CD = 1.0, y = 0;
  const b = (w, h, dd, x, yy, z, c, list = solid) => list.push(box(w, h, dd, x + w / 2, yy + h / 2, z + dd / 2, new THREE.Color(c), 0));
  const L = RES || resLayout(), tw = L.towers.find((t) => t.id === hm?.tower), fl = tw?.floors.find((q) => q.flats.includes(d.id));
  const F = tw ? resInFacade(tw.id) : null, k = Math.max(1, fl?.perFloor || 1), j = Math.max(0, fl ? fl.flats.indexOf(d.id) : 0), bay = F ? F.bayOfFlat(j, k) : { wall: "#e6c88e", accent: "#3d6585" };
  const H = lv === 3 ? WALL_H * 2 : WALL_H;
  b(W, 0.2, D + 2, x0, y - 0.2, z0, 0x8a8f99);
  b(W, 0.02, CD, x0, y, z0, 0xe9dfcc); b(W - 0.3, 0.012, CD - 0.4, x0 + 0.15, y + 0.02, z0 + 0.15, 0xa8584a);
  b(W, H, 0.12, x0, y, z0, 0xf2e9d8); b(0.12, H, D, x0, y, z0, resHex(resShade(bay.wall, 0.9)));
  const R = resRoom3D({ a: x0, z0: z0 + CD, W, D: D - CD, y, lv, id: d.id, dk: d, bay, curtain: F ? F.curtain(fl?.storey || 1, j) : "#f3e7c9", full: true, PH: WALL_H, G: WALL_H, solid, glow, kp: kpRaw, fg });
  const put = (key, x, yy, z, s, ry = 0) => { const look = itemLook(key), drawn = !!look.prop && kpRaw(look.prop, x, yy, z, ry, s); if (look.stand || !drawn) { const sp = new THREE.Sprite(emojiMat(look.icon)); sp.scale.set(0.42, 0.42, 1); sp.position.set(x, yy + (drawn ? 0.75 : 0.3), z); fg.add(sp); } };
  const Z0 = z0 + CD, FD = D - CD, spots = [[0.62, 0.5], [0.8, 0.32], [0.45, 0.72], [0.88, 0.66], [0.6, 0.88], [0.3, 0.6], [0.52, 0.38], [0.72, 0.62], [0.38, 0.86], [0.92, 0.48], [0.25, 0.8], [0.66, 0.74]];
  ownAt(d.id, "flat").filter((key) => !["rug", "bed", "bookshelf", "couch", "tv"].includes(key)).forEach((key, i) => {
    const [fx, fz] = spots[i % spots.length], pet = data.perks?.[key]?.cat === "pets";
    if (key === "discoball") return put(key, x0 + W * 0.55, y + WALL_H - 0.05, Z0 + FD * 0.5, 1);
    put(key, x0 + W * fx, y, Z0 + FD * fz, pet ? 1 : 0.9, -Math.PI / 2 + i);
  });
  if (R.bal) { const keys = ownAt(d.id, "balcony"); keys.forEach((key, i) => put(key, R.bal.cx - R.bal.bw / 2 + (R.bal.bw * (i + 0.5)) / keys.length, y + 0.06, R.bal.z, 0.8)); }
  f._people = [];
  if (R.home) { const onBal = R.bal && typeof onBalconyNow === "function" && onBalconyNow(d.id); f._people.push(onBal ? { d, x: R.bal.cx + R.bal.bw * 0.3, y: y + 0.06, z: R.bal.z, hd: 0 } : R.seat ? { d, x: R.seat[0], y: R.seat[1], z: R.seat[2], hd: R.seat[3], sit: true } : { d, x: x0 + W * 0.55, y, z: Z0 + FD * 0.6, hd: Math.PI / 4 }); }
  const guests = typeof walkers !== "undefined" ? [...walkers.values()].filter((w) => w.visiting === d.id).map((w) => w.d) : [];
  guests.slice(0, 3).forEach((g, i) => f._people.push({ d: g, x: x0 + W * (0.5 + i * 0.12), y, z: Z0 + FD * 0.55, hd: -Math.PI / 2 - 0.4 + i * 0.4 }));
  // the name plate on their door, in words
  const tag = new THREE.Object3D(); tag.position.set(x0 + W * (lv === 3 ? 0.5 : 0.4) + 0.3, y + 2.2, z0 + CD); fg.add(tag); sign(tag, nameOf(d), 0, 0, 0, "small");
  finishFloor(fg, f, y, 0, f.name, solid, glow);
}
// the pet's penthouse (the owner 2026-11-13: "MAKE SURE the pet HAS THE GOODEST BOY ROOM"). Everything here is built from
// code (the campus-assets build script for the pet's room), never AI-made, and it's his things only: he himself is the pet.js, untouched.
// From the lore the owner shared (another project docs/design/the pet-lore.md): his feather wand, the yellow ball, his treat tube
// (no brand), the water bowl, and the food bowl kept full and evenly spread. A sunny window seat, his big plush bed on a
// round rug (where he naps: rexInside puts him there), a tall cat tree, a box castle, a fish tank to watch, cat grass,
// fairy lights, and his name on a brass plaque: Dr. Sir the pet, The CEO.
function buildPetRoom(f, fg, blk, kp, planks) {
  const y = floorY(f), x0 = f.x, z0 = f.y, W = f.w, D = f.d, H = WALL_H, C = (h) => new THREE.Color(h), n = typeof night === "number" ? night : 0;
  const glowList = [], gl = (w, h, d, x, yy, z, c) => glowList.push(box(w, h, d, x + w / 2, yy + h / 2, z + d / 2, C(c), 0));
  blk(W, 0.2, D, x0, y - 0.2, z0, 0x8a8f99);
  planks(x0, y, z0, W, D, 0xd2a26e);
  // walls: warm cream with a wainscot and a picture rail; a long window over the window seat
  blk(W, H, 0.12, x0, y, z0, 0xf3e6d0); blk(0.12, H, D, x0, y, z0, 0xeedcc0);
  blk(W, 0.7, 0.14, x0, y, z0, 0xe2cba8); blk(0.14, 0.7, D, x0, y, z0, 0xddc39c);
  blk(W, 0.05, 0.16, x0, y + 1.75, z0, 0xc9a26a); blk(0.16, 0.05, D, x0, y + 1.75, z0, 0xc9a26a);
  const wx = x0 + W * 0.18, ww = W * 0.5;
  gl(ww, 0.95, 0.03, wx, y + 0.78, z0 + 0.13, n > 0.5 ? 0x3a4e72 : 0xbfe3f8);
  for (let k = 1; k < 4; k++) blk(0.05, 0.95, 0.05, wx + (ww * k) / 4, y + 0.78, z0 + 0.14, 0xf8f2e6);
  blk(ww + 0.1, 0.06, 0.08, wx - 0.05, y + 0.75, z0 + 0.14, 0xf8f2e6); blk(ww + 0.1, 0.06, 0.08, wx - 0.05, y + 1.73, z0 + 0.14, 0xf8f2e6);
  // fairy lights along the picture rail
  let fi = 0;
  for (let x = x0 + 0.3; x < x0 + W - 0.2; x += 0.32, fi++) gl(0.06, 0.06, 0.06, x, y + 1.62 + Math.sin(x * 3) * 0.04, z0 + 0.18, [0xffe2a0, 0xffb8c8, 0xbfe6ff][fi % 3]);
  // the window seat under the window, cat grass along it
  kp("rx_windowseat", wx + ww / 2, y, z0 + 0.45, Math.PI, 1);
  for (let k = 0; k < 3; k++) kp("rx_catgrass", wx + ww + 0.3 + k * 0.32, y, z0 + 0.32, k, 1, C(0x7cc25e));
  // a patch of sunlight on the floor below the window, by day
  if (n < 0.5) { const sun = new THREE.Mesh(new THREE.PlaneGeometry(ww * 0.9, 1.6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: radialTextureWarm(), transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false })); sun.position.set(wx + ww / 2 + 0.3, y + 0.03, z0 + 1.5); sun.renderOrder = 2; fg.add(sun); }
  // the round rug and his big plush bed on it
  const bx = x0 + W * 0.42, bz = z0 + D * 0.5;
  { const rug = new THREE.CylinderGeometry(1.25, 1.25, 0.02, 40); rug.translate(bx, y + 0.03, bz); const rm = new THREE.Mesh(paint(rug, C(0xf1e3cf)), mats.painted()); rm.receiveShadow = true; fg.add(rm);
    const rim = new THREE.TorusGeometry(1.22, 0.03, 6, 48).rotateX(Math.PI / 2); rim.translate(bx, y + 0.045, bz); fg.add(new THREE.Mesh(paint(rim, C(0xc7a3c9)), mats.painted())); }
  kp("rx_bed", bx, y + 0.02, bz, 0, 1.25);
  f._rexBed = [bx, y + 0.14, bz];
  // toys round the bed: the feather wand, the yellow ball, two mice
  kp("rx_feather", bx + 0.9, y + 0.02, bz + 0.55, -0.6, 1); kp("rx_ball", bx - 0.95, y + 0.02, bz + 0.6); kp("rx_mouse", bx + 0.2, y + 0.02, bz + 1.0, 1.2); kp("rx_mouse", bx - 0.6, y + 0.02, bz - 0.85, 2.6);
  // the cat tree in the back right corner, a scratcher beside it
  kp("rx_cattree", x0 + W - 0.85, y, z0 + 0.8, -0.3, 0.85); kp("rx_scratcher", x0 + W - 1.9, y, z0 + 0.5, 0, 1);
  // the food station on the left wall; the treat tube on its own shelf above it
  const fx = x0 + 0.45, fz = z0 + D * 0.42;
  kp("rx_bowls", fx, y + 0.02, fz, Math.PI / 2, 1.1);
  blk(0.3, 0.05, 0.6, x0 + 0.12, y + 0.95, fz - 0.3, 0xb07e52); kp("rx_tube", x0 + 0.28, y + 1.0, fz, Math.PI / 2, 0.9);
  const [plaqueA, plaqueB] = petPlaques(); // the two brass plaques: settings' pet.plaques, else made from its name and role
  fg.add(plaque(plaqueA[0], plaqueA[1], x0 + 0.15, y + 1.4, fz, Math.PI / 2, 0.9));
  fg.add(plaque(plaqueB[0], plaqueB[1], wx + ww / 2, y + 1.95, z0 + 0.15, 0, 1.3));
  // the fish tank to watch, on a low cabinet by the left wall (the Mart's aquarium if the kit has it)
  blk(0.5, 0.45, 1.1, x0 + 0.12, y, z0 + D * 0.68, 0xb07e52);
  if (!kp("it_aquarium", x0 + 0.4, y + 0.45, z0 + D * 0.68 + 0.55, Math.PI / 2, 1)) gl(0.4, 0.45, 0.9, x0 + 0.17, y + 0.45, z0 + D * 0.68 + 0.1, 0x7ac6e8);
  // the cardboard box castle at the front, plants in the corners, a soft floor lamp
  kp("rx_box", x0 + W * 0.72, y, z0 + D - 0.9, -0.4, 1.1);
  // a second little bed right in the sunbeam, a crinkle tunnel, his toy basket
  kp("rx_bed", wx + ww / 2 + 0.6, y + 0.02, z0 + 1.55, 0.3, 0.7);
  { const tun = new THREE.CylinderGeometry(0.28, 0.28, 1.3, 18, 1, true); tun.rotateZ(Math.PI / 2); tun.rotateY(0.5); tun.translate(x0 + W * 0.66, y + 0.29, z0 + D * 0.62); const tm = new THREE.Mesh(paint(tun, C(0x8a6fc0)), new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.5 })); tm.castShadow = true; fg.add(tm); }
  blk(0.5, 0.28, 0.4, x0 + W * 0.3, y, z0 + D - 0.75, 0xc8a06a); kp("rx_ball", x0 + W * 0.3 + 0.12, y + 0.24, z0 + D - 0.6); kp("rx_mouse", x0 + W * 0.3 + 0.32, y + 0.27, z0 + D - 0.55, 0.4); kp("rx_ball", x0 + W * 0.3 + 0.3, y + 0.24, z0 + D - 0.45);
  kp("in_plant", x0 + 0.45, y, z0 + D - 0.45, 0, 1.1, C(0x5f9a4c)); kp("in_plant", x0 + W - 0.45, y, z0 + D - 0.45, 1, 1.0, C(0x6aa858));
  kp("in_floorlamp", x0 + W * 0.18, y, z0 + D * 0.72, 0, 1);
  fg.add(new THREE.Mesh(mergeParts(glowList), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })));
}
let warmTex = null;
function radialTextureWarm() { if (!warmTex) { const { g, tex } = canvasTexture(128); const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, "rgba(255,226,160,0.9)"); gr.addColorStop(1, "rgba(255,226,160,0)"); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); warmTex = tex; } return warmTex; }
// A brass name plaque on a wall: two lines of text on a canvas.
function plaque(line1, line2, x, y, z, ry, s = 1) {
  const { g, tex } = canvasTexture(512, 160);
  const gr = g.createLinearGradient(0, 0, 0, 160); gr.addColorStop(0, "#e9c46a"); gr.addColorStop(1, "#b8862e");
  g.fillStyle = gr; g.beginPath(); g.roundRect(4, 4, 504, 152, 22); g.fill(); g.strokeStyle = "#7a5518"; g.lineWidth = 6; g.stroke();
  g.fillStyle = "#3b2708"; g.textAlign = "center"; g.font = "600 64px Georgia, serif"; g.fillText(line1, 256, 80); g.font = "500 30px Georgia, serif"; g.fillText(line2, 256, 128);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9 * s, 0.28 * s), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  m.position.set(x, y, z); m.rotation.y = ry; return m;
}
function clearInterior() {
  window.floorNav = {};
  if (!inside) return;
  inside.traverse((o) => { if (o.isCSS2DObject) o.element.remove(); if (o.geometry) o.geometry.dispose(); });
  scene.remove(inside); inside = null; picks = [];
}
// Looks at c (its height becomes aimY) from the home direction, pans limited to all's bounds plus pad; distFor() is how far.
function aimAt(c, all, pad, distFor) {
  aimY = c.y;
  lo = new THREE.Vector3(all.x0 - pad, aimY, all.z0 - pad); hi = new THREE.Vector3(all.x1 + pad, aimY, all.z1 + pad);
  controls.target.copy(c);
  camera.position.copy(c).addScaledVector((wrap.clientWidth || innerWidth) < 700 ? PHONE_DIR : HOME_DIR, distFor()); // phones look down a little more: less foreground
  camera.lookAt(c);
}
// Inside the Residences on a phone (the owner's phone, 2026-11-16: the long block was a sliver running off the screen):
// frame one bay of it (city.js resBayView, stepped with "◀ Bay 2 of 3 ▶" in the floor strip) instead of all of it;
// and only the ridden floor's name tags show, so they don't pile up.
function resBayBox(all) {
  const B = typeof resBayView === "function" && rooms[0]?.resFloor ? resBayView() : null; if (!B) return all;
  const f = rooms[0], x0 = f.x + B.f0 * f.w - 0.4, x1 = f.x + B.f1 * f.w + 0.4;
  return { ...all, x0, x1 };
}
function resTags() {
  if (!rooms[0]?.resFloor) return;
  const narrow = (wrap.clientWidth || innerWidth) < 700;
  for (const g of floorGroups) g.traverse((o) => { if (o.isCSS2DObject && o.element?.classList.contains("small")) o.visible = g.visible && (!narrow && !o.element.classList.contains("tolet") ? true : rideK >= 0 && g.userData.k === rideK); });
}
function frameInterior(all) {
  all = resBayBox(all); resTags();
  const s = Math.max(all.x1 - all.x0, all.z1 - all.z0) + 1;
  const narrow = (wrap.clientWidth || innerWidth) < 700;
  aimAt(new THREE.Vector3((all.x0 + all.x1) / 2, all.y1 / 2, (all.z0 + all.z1) / 2), all, 3, () => THREE.MathUtils.clamp(narrow ? distFit(s * 0.8, all.y1 * 0.7 + s * 0.6) : distFit(s * 1.5, all.y1 * 0.9 + s * 0.8), 10, 120)); // a single room gets air round it
}
// Pathing inside: nobody stands in a desk, a wall or each other (people sitting at their own desk are left be).
function settleBots() {
  const byRoom = new Map();
  for (const b of bots.values()) { if (!b.room || Math.hypot(b.x - b.desk.x, b.y - b.desk.y) < 0.2) continue; (byRoom.get(b.room.id) || byRoom.set(b.room.id, []).get(b.room.id)).push(b); }
  for (const [id, list] of byRoom) settle(window.floorNav?.[id], list, 0.34);
}
// Workers at their desks inside: the crowd's characters (crowd.js) following the 2D model's bots (step() moves them).
const MAXB = 80;
function drawBots(t) {
  if (!view) return;
  const list = [...bots.values()].filter((b) => b.room && (rideK < 0 || b.room.k <= rideK) && !(typeof whereIs === "function" && ["home", "meeting", "queue", "coffee"].includes(whereIs(b.d)))).slice(0, MAXB);
  list.forEach((b) => {
    const px = b._vx ?? b.x, pz = b._vy ?? b.y;
    ease(b, b.x, b.y, peopleDt);
    const atDesk = Math.hypot(b.x - b.desk.x, b.y - b.desk.y) < 0.2, typing = b.active && atDesk, seated = atDesk && hasKit("in_desk");
    const walk = Math.hypot(b.tx - b.x, b.ty - b.y) > 0.05;
    // at the desk they face the monitor (the desk's back, -z) and sit on the chair; otherwise the way they walk
    const hd = atDesk ? (b._hd = Math.PI) : steer(b, b._vx - px, b._vy - pz, peopleDt);
    const y = floorY(b.room) + 0.02 + (seated ? 0.3 : 0);
    blobAt(b._vx, floorY(b.room) + 0.02, b._vy + 0.15);
    const root = crowd.add(b.d, b._vx, y, b._vy + 0.15, hd, { walk: walk ? t / 110 + hashId(b.d.id) * 6 : null, type: typing, sit: seated, s: 1.08 }, t);
    if (root) wearOn(b.d, root);
  });
  // at home (houses): them on the couch and anyone visiting, facing into the room
  for (const f of rooms) for (const p of f._people || builtPeople.get(f.id) || []) { // (a data refresh makes new room objects; the people stay with the build)
    if (rideK >= 0 && f.k > rideK) continue; // (a floor above the one you're riding to is hidden: so are its people)
    blobAt(p.x, p.y + 0.02, p.z);
    const root = crowd.add(p.d, p.x, p.y + 0.02, p.z, p.hd ?? Math.PI / 4, { sit: !!p.sit, wave: ((t / 1000 + hashId(p.d.id) * 11) % 16) < 1.4, s: 1.08 }, t);
    if (root) wearOn(p.d, root);
  }
}

// ---------- the people: walkers as little instanced robots, plus the pet ----------
const MAXW = 64;
const m4 = new THREE.Matrix4(), col = new THREE.Color();
// Eased motion (polish pass): each robot is drawn at a smoothed position that chases the model's, so starts and
// stops ease in and out, and it leans a little into its walk. A soft blob under each one keeps it grounded at night.
const blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.8, 0.8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, toneMapped: false }), MAXW + MAXB);
blobs.count = 0; blobs.renderOrder = 2; blobs.frustumCulled = false; scene.add(blobs);
const q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), v4 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
function ease(o, x, y, dt) {
  if (o._vx === undefined || Math.hypot(o._vx - x, o._vy - y) > 6) { o._vx = x; o._vy = y; o._lx = 0; o._lz = 0; }
  const k = 1 - Math.exp(-dt * 12), px = o._vx, py = o._vy;
  o._vx += (x - o._vx) * k; o._vy += (y - o._vy) * k;
  const sp = dt > 0 ? 1 / dt : 0, j = 1 - Math.exp(-dt * 8);
  o._lx += (THREE.MathUtils.clamp((o._vy - py) * sp * 0.08, -0.18, 0.18) - o._lx) * j;
  o._lz += (THREE.MathUtils.clamp(-(o._vx - px) * sp * 0.08, -0.18, 0.18) - o._lz) * j;
}
let nBlob = 0;
// blobAt, wearOn and the smoke use their own matrix (m5).
const m5 = new THREE.Matrix4();
function blobAt(x, y, z) { if (nBlob >= MAXW + MAXB) return; m5.makeTranslation(x, y + 0.06, z); blobs.setMatrixAt(nBlob++, m5); }
let peopleDt = 1 / 60;
// Shirts (the owner 2026-11-09: "clean, and match the shirts, with their info"): the same shirt as the 2D view, the
// provider's colour with the model code on the chest (O5.5, G2.5 …), effort dots and a gold $ pocket if it spent
// API money this month. One texture atlas of 64px tiles, one tile per worker; each chest plate picks its tile with a
// per-instance offset, so all the plates are one draw. A dark visor makes the heads read as faces.
const SH_N = 16, SH_PX = 64, { g: shCtx, tex: shTex } = canvasTexture(SH_N * SH_PX); shTex.anisotropy = 4;
const shIdx = new Map();
function shirtTile(d) {
  const code = typeof modelCode === "function" ? modelCode(d) : "?", eff = (typeof EFFORT !== "undefined" && EFFORT[String(d.effort || "").toLowerCase()]) || 0, bill = typeof billingOf === "function" ? billingOf(d) : ((d.monthUsd || 0) > 0 ? "api" : "sub");
  const key = `${code}|${eff}|${bill}|${d.provider}|${d.status}`, had = shIdx.get(d.id);
  if (had?.key === key) return had.i;
  const i = had ? had.i : shIdx.size % (SH_N * SH_N), x = (i % SH_N) * SH_PX, y = Math.floor(i / SH_N) * SH_PX;
  const g = shCtx; g.clearRect(x, y, SH_PX, SH_PX);
  g.fillStyle = "#" + col.set(d.status === "paused" ? 0x777777 : PROVIDER3[d.provider] || PROVIDER3.other).getHexString();
  g.beginPath(); g.roundRect(x + 2, y + 2, SH_PX - 4, SH_PX - 4, 12); g.fill();
  g.fillStyle = "rgba(255,255,255,0.95)"; g.font = `900 ${code.length > 3 ? 17 : 22}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(code, x + SH_PX / 2, y + 32); // the badge on the chest and back (crowd.js)
  for (let k = 0; k < 5; k++) { g.fillStyle = k < eff ? "#ffd166" : "rgba(0,0,0,0.28)"; g.beginPath(); g.arc(x + SH_PX / 2 + (k - 2) * 9, y + 54, 3, 0, Math.PI * 2); g.fill(); }
  { const b = (typeof BILLING !== "undefined" && BILLING[bill]) || { coin: "#ffd166", ink: "#5a4200", mark: "$" }; g.fillStyle = b.coin; g.beginPath(); g.arc(x + SH_PX - 11, y + 22, 7, 0, Math.PI * 2); g.fill(); g.fillStyle = b.ink; g.font = "900 10px system-ui"; g.fillText(b.mark, x + SH_PX - 11, y + 22.5); }
  shIdx.set(d.id, { i, key }); shTex.needsUpdate = true;
  return i;
}
const MAXP = MAXW + MAXB;
const crowd = makeCrowd(scene, {
  max: MAXP, shirtTex: shTex, tiles: SH_N,
  tileUV: (d) => { const i = shirtTile(d); return [(i % SH_N) / SH_N, 1 - (Math.floor(i / SH_N) + 1) / SH_N]; },
  colourOf: (d) => PROVIDER3[d.provider] || PROVIDER3.other,
});
const hashId = (id) => { let h = 7; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return (h % 1000) / 1000; };
const yAxis = new THREE.Vector3(0, 1, 0);
// Wear from the Campus Mart (visual rehaul 2026-11-13): their priciest hat, headphones or shades on their head, as an
// instanced kit model per item ("it_<key>", built to sit on a fella's head). Wear without a model yet (a new store
// idea) floats its emoji over their head from a small pool of sprites.
const wearMeshes = new Map(), wearMemo = new Map(), wearPool = [];
let nWearSprite = 0;
function wearOf(d) { if (!wearMemo.has(d.id)) wearMemo.set(d.id, itemsAt(d.id, "wear")[0] || null); return wearMemo.get(d.id); }
const WEAR_FIT = new THREE.Matrix4().compose(new THREE.Vector3(0, 0.1, 0.02), new THREE.Quaternion(), new THREE.Vector3(1.06, 1.06, 1.06));
function wearOn(d, root) {
  const k = wearOf(d); if (!k) return;
  const look = itemLook(k);
  if (look.prop && !look.stand) {
    let w = wearMeshes.get(look.prop);
    if (!w) { w = new THREE.InstancedMesh(kitSolid(look.prop), kitMat, MAXP); w.count = 0; w.frustumCulled = false; w.castShadow = true; scene.add(w); w.userData.n = 0; wearMeshes.set(look.prop, w); }
    if (w.userData.n < MAXP) { m5.multiplyMatrices(root, WEAR_FIT); w.setMatrixAt(w.userData.n++, m5); }
    return;
  }
  let sp = wearPool[nWearSprite];
  if (!sp) { sp = new THREE.Sprite(emojiMat(look.icon)); sp.scale.set(0.28, 0.28, 1); scene.add(sp); wearPool.push(sp); }
  sp.material = emojiMat(look.icon); sp.visible = true; v4.setFromMatrixPosition(root); sp.position.set(v4.x, v4.y + 1.12, v4.z); nWearSprite++;
}
function wearFrameStart() { for (const w of wearMeshes.values()) w.userData.n = 0; nWearSprite = 0; }
function wearFrameEnd() { for (const w of wearMeshes.values()) { w.count = w.userData.n; w.instanceMatrix.needsUpdate = true; } for (let i = nWearSprite; i < wearPool.length; i++) wearPool[i].visible = false; }
// Plan B+C: walking over a bridge lifts you onto its deck (a gentle ramp at each end).
function deckAt(x, z) {
  const R = campus.river; if (!R) return 0;
  const br = campus.bridges?.find((b) => Math.abs(x - b.x) < b.w / 2); if (!br) return 0;
  const z0 = R.y - 0.85, z1 = R.y + R.d + 0.85; if (z < z0 || z > z1) return 0;
  return 0.38 * Math.min(1, (z - z0) / 0.8, (z1 - z) / 0.8);
}
// Chimney smoke (plan B+C houses): on evenings, a slow column of soft puffs from the chimney of every house whose
// owner is home. One instanced mesh for the whole village.
const SMOKE_PER = 5, SMOKE_MAX = 60 * SMOKE_PER;
const smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.09, 1), new THREE.MeshLambertMaterial({ color: 0xd9d6cf, transparent: true, opacity: 0.55, depthWrite: false }), SMOKE_MAX);
smoke.count = 0; smoke.frustumCulled = false; smoke.name = "smoke"; scene.add(smoke);
const sv = new THREE.Vector3(), ss = new THREE.Vector3();
function drawSmoke(t, night) {
  let n = 0;
  if (night > 0.3 && !view) for (const b of buildings) {
    const r = b.userData.room, c = b.userData.chimney;
    if (!c || !r?.isHouse || !r.desk || typeof whereIs !== "function" || whereIs(r.desk) !== "home") continue;
    const seed = (b.position.x * 7.3 + b.position.z * 3.1) % 10;
    for (let k = 0; k < SMOKE_PER && n < SMOKE_MAX; k++) {
      const life = ((t / 1000) * 0.22 + k / SMOKE_PER + seed) % 1;
      sv.set(b.position.x + c.x + Math.sin(life * 5 + seed) * 0.08 + life * 0.25, c.y + life * 1.1, b.position.z + c.z);
      ss.setScalar(0.6 + life * 1.6);
      smoke.setMatrixAt(n++, m5.compose(sv, q4.identity(), ss));
    }
  }
  smoke.count = n; smoke.instanceMatrix.needsUpdate = true;
}
function drawPeople(t) {
  const list = [...walkers.values()].slice(0, MAXW);
  list.forEach((w) => {
    const px = w._vx ?? w.x, pz = w._vy ?? w.y;
    const st = w.sit && Math.hypot(w.tx - w.x, w.ty - w.y) <= 0.05; // sitting in the break garden (the gardens lane)
    ease(w, st ? w.sit[0] : w.x, st ? w.sit[1] : w.y, peopleDt);
    const moving = !st && Math.hypot(w.tx - w.x, w.ty - w.y) > 0.05, deck = deckAt(w._vx, w._vy);
    const hd = st ? w.sit[2] : steer(w, w._vx - px, w._vy - pz, peopleDt);
    blobAt(w._vx, deck, w._vy);
    const root = crowd.add(w.d, w._vx, deck + (st ? 0.2 : 0), w._vy, hd, { walk: moving ? t / 110 + hashId(w.d.id) * 6 : null, sit: st, wave: !moving && !st && ((t / 1000 + hashId(w.d.id) * 11) % 14) < 1.6 }, t);
    if (root) wearOn(w.d, root);
  });
}
const rexMesh = makePet();
rexMesh.scale.setScalar(1.4);
scene.add(rexMesh);
let rexLast = null;
// Inside the CEO tower the pet is at home in his penthouse (when that floor shows), curled by his window seat.
function rexInside(t) {
  // during a board meeting he's at the head of the board-room table; otherwise curled up in his penthouse
  const f = view === "control" && ((typeof meetingLive === "function" && meetingLive() && rooms.find((r) => r.board)) || rooms.find((r) => r.pet));
  if (!f || (rideK >= 0 && f.k > rideK)) { rexMesh.visible = false; return; }
  rexMesh.visible = true;
  if (f.board) { const tl = Math.min(4.6, f.w - CORE_W - 2.2); rexMesh.position.set(f.x + CORE_W + 0.9 + tl + 0.4, floorY(f) + 0.5, f.y + f.d / 2 - 0.25); rexMesh.rotation.y = Math.PI; }
  else if (f._rexBed) rexMesh.position.set(f._rexBed[0], f._rexBed[1], f._rexBed[2]); // napping in his big bed
  else rexMesh.position.set(f.x + CORE_W + 1.6, floorY(f) + 0.02, f.y + 1.3);
  if (!f.board) rexMesh.rotation.y = 0.6;
  rexMesh.scale.setScalar(1.4 * (1 + Math.sin(t / 900) * 0.015)); // breathing
  rexMesh.update?.(t / 1000);
}
// Pet him (tap, or the panel's button): he stops for a moment to enjoy it; the count is just for fun, per browser.
function petRex() {
  rexMesh.pet(performance.now() / 1000);
  if (typeof rex === "object") rex.pause = performance.now() + 2600;
  try { localStorage.setItem("campus.pets", String(Number(localStorage.getItem("campus.pets") || 0) + 1)); } catch {}
}
window.strokePet = petRex;
// For the Mart panel (city.js): "own" when an item has its own 3D model, "stand" when it shows as a stand-in, null when it
// has no place in the world (treats).
window.campusItemLook = (k) => { const l = itemLook(k); return l.place ? (l.stand ? "stand" : "own") : null; };
function drawRex(t) {
  if (rex.x == null) { rexMesh.visible = false; return; }
  rexMesh.visible = true;
  if (rexLast) { const dx = rex.x - rexLast[0], dz = rex.y - rexLast[1]; if (Math.hypot(dx, dz) > 0.002) rexMesh.rotation.y = Math.atan2(-dz, dx); }
  rexLast = [rex.x, rex.y];
  rexMesh.position.set(rex.x, 0.04, rex.y);
  rexMesh.update?.(t / 1000);
}

// ---------- camera (visual rehaul 2026-11-13, after towers.app's city): a low perspective camera you can turn ----------
// Left drag pans, right drag (or two fingers) turns and tilts, the wheel or a pinch zooms toward the pointer. "Zoom" is
// the camera's distance from the point it looks at; glides move that point and that distance together.
const FOV = 30, TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 1400);
const HOME_DIR = new THREE.Vector3().setFromSphericalCoords(1, 1.2, Math.PI / 4); // about 21°
const PHONE_DIR = new THREE.Vector3().setFromSphericalCoords(1, 1.0, Math.PI / 4); // about 33° on a phone above the ground, from the south-east
const controls = new MapControls(camera, renderer.domElement);
Object.assign(controls, { enableRotate: true, screenSpacePanning: false, enableDamping: true, dampingFactor: 0.1, zoomToCursor: true, minDistance: 3.5, maxDistance: 240, minPolarAngle: 0.22, maxPolarAngle: 1.28, rotateSpeed: 0.6 });
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
let lo = new THREE.Vector3(-20, 0, -20), hi = new THREE.Vector3(60, 0, 60), aimY = 0; // aimY: the height the view centres on (mid-stack inside a building)
controls.addEventListener("change", () => {
  const before = controls.target.clone();
  controls.target.clamp(lo, hi); controls.target.y = aimY;
  camera.position.add(controls.target.clone().sub(before));
  dirty = true;
});
const camDist = () => camera.position.distanceTo(controls.target);
// The distance at which a w (across) by h (up the screen) area fills the view.
function distFit(w, h) { const aspect = (wrap.clientWidth || innerWidth) / (wrap.clientHeight || innerHeight); return Math.max(h / 2 / TAN, w / 2 / (TAN * aspect)); }
function frameCity() {
  // Pan anywhere in the whole city, but open on the offices (not the houses), filling the screen.
  const narrowF = (wrap.clientWidth || innerWidth) < 700;
  const all = bounds(), core = rooms.filter((r) => !r.isHouse && !(narrowF && (r.isLeisure || r.isUnderground))), b = core.length ? { x0: Math.min(...core.map((r) => r.x)), x1: Math.max(...core.map((r) => r.x + r.w)), z0: Math.min(...core.map((r) => r.y)), z1: Math.max(...core.map((r) => r.y + r.d)) } : all;
  const s = Math.max(b.x1 - b.x0, b.z1 - b.z0) + 2;
  const narrow = (wrap.clientWidth || innerWidth) < 700; // a phone: fill the screen with the campus (the sides may crop)
  // a phone opens a little toward the square (the CEO tower and the plaza), a touch closer (city planner pass)
  const cz = narrow && campus.square ? THREE.MathUtils.lerp((b.z0 + b.z1) / 2, campus.square.y, 0.25) : (b.z0 + b.z1) / 2;
  aimAt(new THREE.Vector3((b.x0 + b.x1) / 2, 0, cz), all, 10, () => THREE.MathUtils.clamp(narrow ? distFit(s * 0.9, s * 0.95) : distFit(s * 1.45, s * 0.7), 25, 220));
}
function resize3d() {
  const w = wrap.clientWidth || innerWidth, h = wrap.clientHeight || innerHeight;
  if (w === resize3d.w && h === resize3d.h) return; // same size: resizing would only wipe the picture (flicker while a panel is dragged)
  resize3d.w = w; resize3d.h = h;
  renderer.setSize(w, h); labels.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  dirty = true;
  try { post.render(scene, camera, !!view, typeof night === "number" ? night : 0); labels.render(scene, camera); } catch {} // draw at once: no blank frame
}
addEventListener("resize", resize3d);
// Phones: the details panel covers the bottom 62% of the screen, so while it's open the picture shifts up and the
// floor you're looking at stays in the space above it.
const panelEl = document.getElementById("panel");
function panelOffset() {
  const w = wrap.clientWidth || innerWidth, h = wrap.clientHeight || innerHeight;
  const open = panelEl?.classList.contains("open");
  if (innerWidth < 700 && open) camera.setViewOffset(w, h, 0, Math.min(h * 0.45, (panelEl.offsetHeight || h * 0.62) * 0.48), w, h); // keeps the view centred above the panel, however tall you've dragged it
  else if (open && view) camera.setViewOffset(w, h, Math.min(w * 0.3, (panelEl.offsetWidth || 380) / 2), 0, w, h); // desktop, inside: the room shifts left of the side panel
  else camera.clearViewOffset();
  camera.updateProjectionMatrix(); dirty = true;
}
if (panelEl) new MutationObserver(panelOffset).observe(panelEl, { attributes: true, attributeFilter: ["class"] });
addEventListener("resize", panelOffset);

// ---------- getting around (part 2, ideas from towers.app): ride the floors, turn 90°, zoom, home ----------
// Inside a building the scroll wheel rides the floors (one notch, one floor; pinch still zooms); a floor shows with
// the ones below it, and the camera glides to it. rideK -1 shows every floor.
let glide = null;
// Glides the look-at point to target and the camera's distance to dist, keeping the direction it looks from.
function glideTo(target, dist, ms = 450) {
  const from = { t: controls.target.clone(), p: camera.position.clone(), z: camDist() }, dir = from.p.clone().sub(from.t).normalize();
  glide = { t0: performance.now(), ms, from, to: { t: target.clone(), z: dist }, dir };
}
function stepGlide(now) {
  if (!glide) return;
  const k = Math.min(1, (now - glide.t0) / glide.ms), e = 1 - Math.pow(1 - k, 3);
  controls.target.lerpVectors(glide.from.t, glide.to.t, e);
  camera.position.copy(controls.target).addScaledVector(glide.dir, glide.from.z + (glide.to.z - glide.from.z) * e);
  if (k >= 1) glide = null;
}
function ride(k) {
  if (!view || !floorGroups.length) return;
  rideK = k < 0 || k >= floorGroups.length ? -1 : k;
  for (const g of floorGroups) { g.visible = rideK < 0 || g.userData.k <= rideK; g.traverse((o) => { if (o.isCSS2DObject) o.visible = g.visible; }); /* the label renderer only checks a label's own visibility */ }
  if (rideK < 0) { frameInterior(insideAll); window.dispatchEvent(new CustomEvent("campus:ride", { detail: { k: -1 } })); return; }
  const f = rooms.find((x) => x.k === rideK); if (!f) return;
  aimY = floorY(f) + 1;
  lo.y = hi.y = aimY;
  resTags();
  const bx = resBayBox({ x0: f.x, x1: f.x + f.w, z0: f.y, z1: f.y + f.d }); // (a phone in the Residences: one bay)
  const s = Math.max(bx.x1 - bx.x0, f.d) + 1;
  const narrow = (wrap.clientWidth || innerWidth) < 700; // a phone: the floor fills the screen, the sides may crop
  glideTo(new THREE.Vector3((bx.x0 + bx.x1) / 2, aimY, f.y + f.d / 2), THREE.MathUtils.clamp(narrow ? distFit(s * 0.72, s * 0.7) : distFit(s * 1.25, s * 0.85), 6, 90));
  window.dispatchEvent(new CustomEvent("campus:ride", { detail: { k: rideK } }));
}
let wheelAcc = 0;
wrap.addEventListener("wheel", (e) => {
  if (!view || !floorGroups.length || e.ctrlKey) return; // ctrl+wheel (and pinch) still zooms
  e.preventDefault(); e.stopPropagation();
  wheelAcc += e.deltaY;
  if (Math.abs(wheelAcc) < 60) return;
  const top = floorGroups.length - 1, cur = rideK < 0 ? top : rideK;
  ride(Math.max(0, Math.min(top, cur + (wheelAcc < 0 ? 1 : -1)))); wheelAcc = 0;
}, { capture: true, passive: false });
function turn(dir) {
  // rotate the view 90° around the point you're looking at (a snap, glided)
  const off = camera.position.clone().sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), (dir * Math.PI) / 2);
  glide = { t0: performance.now(), ms: 450, from: { t: controls.target.clone(), p: camera.position.clone(), z: camera.zoom }, to: { t: controls.target.clone(), z: camera.zoom }, off: null, turn: { from: camera.position.clone().sub(controls.target), to: off } };
}
const _stepGlide = stepGlide;
// eslint-disable-next-line no-func-assign -- deliberate: wraps the glide step defined above
stepGlide = (now) => {
  if (glide?.turn) {
    const k = Math.min(1, (now - glide.t0) / glide.ms), e = 1 - Math.pow(1 - k, 3);
    const a0 = Math.atan2(glide.turn.from.x, glide.turn.from.z), a1 = Math.atan2(glide.turn.to.x, glide.turn.to.z);
    let da = a1 - a0; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
    const r = Math.hypot(glide.turn.from.x, glide.turn.from.z), a = a0 + da * e;
    camera.position.set(controls.target.x + Math.sin(a) * r, controls.target.y + glide.turn.from.y, controls.target.z + Math.cos(a) * r);
    camera.lookAt(controls.target);
    if (k >= 1) glide = null;
    return;
  }
  _stepGlide(now);
};
window.campus3d = {
  fancy(v) { if (v !== undefined) { post.set(v); if (v) { quality.reset(); } dirty = true; } return post.on; },
  zoom: (f) => { glideTo(controls.target.clone(), THREE.MathUtils.clamp(camDist() / f, controls.minDistance, controls.maxDistance), 250); },
  turn,
  home: () => { if (view) ride(-1); else frameCity(); },
  ride,
  floor: () => rideK,
  // Search snap (the owner 2026-11-15): fly to a building (or, inside one, ride to a floor) with the same glide the buttons
  // use; `calm` jumps instead. Returns false when nothing in the scene matches.
  focus(id, { calm = false, floor = null, floorOf = null } = {}) {
    if (view && floorGroups.length) {
      const f = rooms.find((x) => x.id === (floor || id)) || (floorOf && rooms.find((x) => x.desks?.some((d) => d.id === floorOf)));
      if (f) { ride(f.k); if (calm) { const g = glide; if (g) g.ms = 1; } return true; }
      if (rooms.some((x) => x.project?.id === id || x.id === id)) { ride(-1); return true; }
      return false;
    }
    const box = focusBox(id); if (!box) return false;
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3()), s = Math.max(sz.x, sz.z, sz.y * 0.8) + 3;
    const narrow = (wrap.clientWidth || innerWidth) < 700;
    const dist = THREE.MathUtils.clamp(narrow ? distFit(s * 2.1, s * 2.1) : distFit(s * 2.4, s * 1.9), 14, 110);
    // A side panel (desktop) hides the right of the screen: slide the aim point right so the building lands in the free part
    // (a phone sheet and the inside of a building are already handled by panelOffset).
    if (!narrow && panelEl?.classList.contains("open")) { const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0); c.addScaledVector(right, (panelEl.offsetWidth || 380) * TAN * dist / (wrap.clientHeight || innerHeight)); }
    glideTo(c, dist, calm ? 1 : 650);
    // the gardens lane: in the quad the community garden (its plots and its shared part) lies just north of the long
    // Residences block, which hides it from the usual south-east view, and the break garden lies just north of a wing,
    // so a garden in the quad is looked at from the north instead (over the ring road and the quad: nothing in the way)
    if (glide && campus?.plan === "quad" && ["garden", "garden-shared", "break-garden"].includes(id)) { const e = glide.dir.y; glide.dir = new THREE.Vector3(0, e, -Math.sqrt(Math.max(0, 1 - e * e))); }
    return true;
  },
  // Where the thing is on the canvas right now, in px from its top-left (the view offset for an open panel is included).
  screenOf(id) {
    const box = focusBox(id); if (!box) return null;
    const v = box.getCenter(new THREE.Vector3()).project(camera), w = wrap.clientWidth || innerWidth, h = wrap.clientHeight || innerHeight;
    return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h, w, h, behind: v.z > 1 };
  },
};
// The box around a building's tap targets (a project inside a district tower uses the tower's).
function focusBox(id) {
  const tw = typeof cityTowers !== "undefined" && cityTowers.find((t) => t.members?.includes(id)), ids = new Set([id, tw?.id].filter(Boolean)), box = new THREE.Box3();
  for (const o of picks) if (ids.has(o.userData.room) || ids.has(o.userData.project)) box.expandByObject(o);
  if (box.isEmpty()) for (const b of buildings) if (ids.has(b.userData.room)) box.expandByObject(b);
  return box.isEmpty() ? null : box;
}

// ---------- taps: under 6 px of movement is a tap; a building opens its panel, a walker opens theirs ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
// The instance of an instanced mesh drawn nearest the tap, within 26 px (null when none).
const pm = new THREE.Matrix4(), pv = new THREE.Vector3();
function nearest(mesh, e, rect) {
  let best = null, bd = 26;
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, pm); pv.setFromMatrixPosition(pm); pv.y += 0.35; pv.project(camera);
    const d = Math.hypot((pv.x + 1) / 2 * rect.width - (e.clientX - rect.left), (1 - pv.y) / 2 * rect.height - (e.clientY - rect.top));
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
let down = null;
renderer.domElement.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  // Staff (the owner 2026-11-09: tapping someone at their desk should open their card). three keeps an instanced mesh's
  // hit sphere from the first test, so it's dropped first (people move, and each building is elsewhere); and a near
  // miss within about 26 px of someone still counts, since the little fellas are small on a phone.
  const who = crowd.pick(camera, ray, e, rect);
  if (who) { const dd = bots.get(who)?.d || walkers.get(who)?.d || data.desks.find((x) => x.id === who); if (dd) return workerPanel(dd); }
  if (rexMesh.visible && ray.intersectObject(rexMesh, true)[0]) { petRex(); return panel("pet"); }
  const hit = ray.intersectObjects(picks.filter((o) => o.parent?.visible !== false), false)[0];
  if (hit?.object.userData.fountain) return fountainPanel();
  if (hit) { const id = hit.object.userData.room || hit.object.userData.project; if (!view && typeof tap === "function") tap(id); else panel(id); }
  else closePanel();
});

// ---------- the loop: the classic scripts' walkers and the pet move here while 3D is on ----------
let dirty = true, last = performance.now(), shown3d = false;
function show3d(on) {
  shown3d = on;
  wrap.style.display = on ? "" : "none";
  canvas2d.style.visibility = on ? "hidden" : "visible";
  window.campus3dActive = on;
  window.dispatchEvent(new CustomEvent("campus:ride", { detail: { k: rideK } })); // refresh the camera buttons and floor list
}
function onBuilt() {
  wearMemo.clear(); // what they own may have changed
  if (view) {
    // Inside a building: its floors in 3D (phase 4). Rebuilt when the floors or their desks change.
    const key = view + "|" + rooms.map((f) => `${f.id}:${f.w}x${f.d}:${f.desks.map((d) => d.id).join(",")}`).join("|") + resHomeKey(); // (Residences: who is home, and dusk, rebuild the flats: their lamps and people follow)
    if (key !== insideKey) {
      insideKey = key; signKey = ""; insideAll = buildInterior(); builtPeople = new Map(rooms.map((f) => [f.id, f._people || []])); frameInterior(insideAll);
      // on a phone, start zoomed on the ground floor (the lead's) instead of the whole stack, small
      if (innerWidth < 700 && rooms.length > 1) ride(0);
    }
    placeSitters(); // nobody sits in the city while we're inside
    if (!shown3d) show3d(true);
    dirty = true; return;
  }
  if (insideKey) { insideKey = ""; clearInterior(); city = null; }
  const key = rooms.map((r) => `${r.id}:${r.x.toFixed(1)},${r.y.toFixed(1)},${r.w},${storeys(r)},${r.name}`).join("|");
  const first = !city;
  if (key !== signKey) { signKey = key; buildCity(); if (first) frameCity(); }
  else { litWindows(); placeSitters(); }
  window.dispatchEvent(new CustomEvent("campus:filter")); // re-apply the control layer's filter and beacons to the new city
  if (!shown3d) show3d(true);
  panelOffset();
  dirty = true;
}
addEventListener("campus:built", onBuilt);
addEventListener("citylife:change", () => { if (city && !view) { litWindows(); dirty = true; } }); // a City life switch or graphics level changed
// The control layer's filter and 🚨 beacons (control.js): fade buildings outside the filter, flag ones waiting on the owner.
addEventListener("campus:filter", () => {
  if (view || !buildings.length) return;
  for (const bld of buildings) {
    const r = bld.userData.room, show = typeof shownByFilter !== "function" || (r.members ? r.members.some((m) => shownByFilter(m)) : shownByFilter(r));
    bld.traverse((o) => {
      if (!o.isMesh || o.name === "pick") return;
      if (!o.userData.ownMat) { o.userData.base = { t: o.material.transparent, o: o.material.opacity, d: o.material.depthWrite }; o.material = o.material.clone(); o.userData.ownMat = true; }
      const base = o.userData.base; // the glass stays see-through when shown
      o.material.transparent = show ? base.t : true; o.material.opacity = show ? base.o : 0.18 * base.o; o.material.depthWrite = show ? base.d : false;
    });
    batchShow(bld, show);
    if (r.isHouse && villageBody) { if (!villageBody.userData.ownMat) { villageBody.material = villageBody.material.clone(); villageBody.userData.ownMat = true; } villageBody.material.transparent = !show; villageBody.material.opacity = show ? 1 : 0.18; villageBody.material.depthWrite = show; }
    const s = bld.userData.sign?.element;
    if (s) { const base = r.isControl ? "CEO tower (yours)" : r.name; s.textContent = base + (ctlWaitRooms?.has(r.id) ? " 🚨" : ""); s.style.opacity = show ? "" : "0.3"; }
  }
  dirty = true;
});
// Label tidying (the owner 2026-11-09 screenshot: names piled on each other): every 12 frames, show labels by priority
// (anything waiting on the owner 🚨 first, then buildings and the CEO tower, then districts, then floor names) and hide
// any that would overlap one already shown. Floor names (class "small") only show when zoomed in.
let declutterTick = 0;
function declutter() {
  const items = [...labels.domElement.querySelectorAll(".sign3d")].filter((e) => e.style.display !== "none").map((e) => ({ e, p: Number(e.dataset.p ?? 2) + (/🚨|yours/.test(e.textContent) ? 2 : 0), r: e.getBoundingClientRect() }));
  items.sort((a, b) => b.p - a.p);
  const kept = [], pad = 3, zoomedIn = camDist() < 30 || !!view;
  for (const it of items) {
    if (it.e.classList.contains("small") && !zoomedIn) { it.e.style.visibility = "hidden"; continue; }
    const r = it.r, hit = r.width > 0 && kept.some((k) => !(r.right + pad < k.left || r.left - pad > k.right || r.bottom + pad < k.top || r.top - pad > k.bottom));
    it.e.style.visibility = hit ? "hidden" : "";
    if (!hit && r.width > 0) kept.push(r);
  }
}
function loop(now) {
  requestAnimationFrame(loop);
  if (!shown3d) return;
  // Phone, under a sheet (2026-11-16, the Mart blanking while scrolling): a hub page sheet covers the whole screen, so
  // the city rests; a details panel leaves a strip above it, so the city draws about 10 times a second, not 60+. The
  // GPU then has room to draw the scrolling list, and the battery lasts longer. Desktop is unchanged.
  if (innerWidth < 700 && (document.body.classList.contains("bs-open") || (panelEl?.classList.contains("open") && now - (loop.drawn || 0) < 100))) return;
  loop.drawn = now;
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  quality.frame(now);
  peopleDt = dt || 1 / 60; nBlob = 0; crowd.begin(); wearFrameStart();
  stepGlide(now);
  step(dt);
  if (view) { think(dt, now); settleBots(); drawBots(now); rexInside(now); }
  else { stepWalkers(dt, now); settle(window.campusNav, [...walkers.values()]); stepRex(dt, now); drawPeople(now); cityLife3?.drawPatrons(crowd, now); cityLife3b?.drawUmbrellas(crowd); drawRex(now); drawBots(now); }
  if (fountain && city?.visible !== false) fountain.update(now);
  river?.update(now, typeof night === "number" ? night : 0);
  for (const b of buildings) if (b.userData.riseAt) { const k = Math.min(1, (now - b.userData.riseAt) / 2600), e = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2); b.scale.y = Math.max(0.02, k >= 1 ? 1 : e); if (k >= 1) delete b.userData.riseAt; }
  green?.update?.(typeof night === "number" ? night : 0);
  if (life && !view) life.update(now, typeof night === "number" ? night : 0, [...walkers.values()].map((w) => [w._vx ?? w.x, w._vy ?? w.y]));
  if (!view) drawSmoke(now, typeof night === "number" ? night : 0);
  if (cityLife3 && !view) cityLife3.update(now, typeof night === "number" ? night : 0, dt);
  clock?.update();
  for (const bl of balloons) { const [hx, hy, hz] = bl.userData.home, t = now / 1000 + bl.userData.ph; bl.position.set(hx + Math.sin(t * 0.05) * 9, hy + Math.sin(t * 0.4) * 0.4, hz + Math.cos(t * 0.04) * 6); bl.rotation.y = t * 0.05; }
  if (cityLife3b && !view) cityLife3b.update(now, typeof night === "number" ? night : 0, dt); // (after the balloons move: their banners follow them)
  if (!view) seasonal?.update(now, typeof night === "number" ? night : 0);
  blobs.count = nBlob; blobs.instanceMatrix.needsUpdate = true;
  crowd.end(); wearFrameEnd();
  const wk = (typeof weather !== "undefined" && weather?.kind) || "clear";
  applyNight(wk !== weatherShown); weatherShown = wk;
  sky.update(dt, now, controls.target, rig.skyAt(typeof night === "number" ? night : 0, skyCol), !!view); // no rain indoors
  controls.update();
  lamps?.update(camera, renderer.getPixelRatio());
  post.render(scene, camera, !!view, typeof night === "number" ? night : 0);
  labels.render(scene, camera);
  if (++declutterTick % 12 === 0) declutter();
  dirty = false;
}
resize3d();
quality.apply();
if (typeof data !== "undefined" && data) onBuilt();
requestAnimationFrame(loop);
// look(x, y, z, zoom): y is the height the view centres on, so a balloon or blimp can be looked at (render checks)
window.__campus3d = { scene, renderer, camera, calls: () => renderer.info.render.calls, look: (x, y, z, zm) => { aimY = y; glideTo(new THREE.Vector3(x, y, z), zm, 1); }, dinerAt: () => cityLife3?.spot() ?? null, dinerPatrons: () => cityLife3?.patronCount() ?? -1, l2: () => cityLife3b }; // look(): for screenshot checks
