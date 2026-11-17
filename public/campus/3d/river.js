// Campus 3D: the river side of city plan B+C (the owner 2026-11-09, "Main street by the river"). The river with moving
// water and stone banks, three arched bridges (the side streets and main street carry on across), the village green
// with its bandstand, and the Underground's lit stair entrance on the plaza. Everything static is painted and merged
// (one draw for the banks and bridges, one for the green); the water is one plane whose ripples scroll in the shader.
// Coordinates follow core.js: model (x, y) is three.js (X, Z).
import * as THREE from "three";
import { mergeParts } from "./buildings.js";
import { paint, mats, std, box, canvasTexture } from "./materials.js";

const STONE = new THREE.Color(0xb9ae98), STONE_DARK = new THREE.Color(0x8f8573), DECK = new THREE.Color(0xa38463), RAIL = new THREE.Color(0xe9e2d2);

// A soft ripple normal map drawn once on a canvas (sums of sines, so it tiles).
function rippleTexture() {
  const N = 128, cv = document.createElement("canvas"); cv.width = cv.height = N;
  const g = cv.getContext("2d"), img = g.createImageData(N, N), h = (x, y) => Math.sin((x / N) * Math.PI * 4 + Math.sin((y / N) * Math.PI * 2) * 1.5) + Math.sin((y / N) * Math.PI * 6 + (x / N) * Math.PI * 2) * 0.6 + Math.sin(((x + y) / N) * Math.PI * 8) * 0.25;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1), k = (y * N + x) * 4;
    img.data[k] = 128 + dx * 40; img.data[k + 1] = 128 + dy * 40; img.data[k + 2] = 255; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export function makeRiver(campus) {
  const R = campus.river, group = new THREE.Group(); group.name = "river";
  if (!R) return { group, update() {}, dispose() {} };
  const len = R.x1 - R.x0, cx = (R.x0 + R.x1) / 2, cz = R.y + R.d / 2;
  // riverbed (sunk a little) and the water on top
  const parts = [];
  parts.push(box(len, 0.02, R.d, cx, 0.012, cz, new THREE.Color(0x2f5f70), 0)); // dark bed under the clear water
  // stone banks: a low wall each side, with a darker coping
  for (const z of [R.y - 0.12, R.y + R.d + 0.12]) { parts.push(box(len, 0.16, 0.26, cx, 0.08, z, STONE, 0.02)); parts.push(box(len, 0.05, 0.32, cx, 0.18, z, STONE_DARK, 0.01)); }
  // bridges: an arched stone body under a plank deck, with railings and posts; main street's is wider, with planters
  for (const b of campus.bridges || []) {
    const w = b.w, z0 = R.y - 0.5, dz = R.d + 1, mid = R.y + R.d / 2, main = w > 4;
    parts.push(box(w, 0.16, dz, b.x, 0.3, mid, main ? new THREE.Color(0xcdbf9f) : DECK, 0.02));
    // the arch: a stone face on each side, a rectangle with a half-round hole, so the water shows through
    const span = R.d + 0.6, rise = 0.5, face = new THREE.Shape([new THREE.Vector2(-span / 2 - 0.3, 0), new THREE.Vector2(span / 2 + 0.3, 0), new THREE.Vector2(span / 2 + 0.3, 0.42), new THREE.Vector2(-span / 2 - 0.3, 0.42)]);
    const hole = new THREE.Path(); hole.moveTo(-span / 2, 0); hole.absellipse(0, 0, span / 2, rise * 0.62, Math.PI, 0, true); hole.lineTo(-span / 2, 0); face.holes.push(hole);
    for (const sx of [-1, 1]) { const fg = new THREE.ExtrudeGeometry(face, { depth: 0.14, bevelEnabled: false }); fg.rotateY(Math.PI / 2); fg.translate(b.x + sx * (w / 2 - 0.07) - 0.07, 0.0, mid); parts.push(paint(fg, STONE)); }
    for (const zr of [z0 - 0.35, z0 + dz + 0.35]) { const ramp = new THREE.BoxGeometry(w, 0.06, 0.9); ramp.rotateX(zr < mid ? 0.32 : -0.32); ramp.translate(b.x, 0.2, zr); parts.push(paint(ramp, main ? new THREE.Color(0xcdbf9f) : DECK)); }
    for (const sx of [-1, 1]) {
      const x = b.x + sx * (w / 2 - 0.07);
      parts.push(box(0.08, 0.06, dz, x, 0.7, mid, RAIL, 0.01));
      for (let k = 0; k <= 6; k++) parts.push(box(0.09, 0.42, 0.09, x, 0.56, z0 + (dz * k) / 6, main ? STONE : RAIL, 0.02));
      if (main) for (const zz of [z0 + 0.2, z0 + dz - 0.2]) { parts.push(box(0.4, 0.3, 0.4, b.x + sx * (w / 2 - 0.35), 0.53, zz, STONE_DARK, 0.04)); const bush = new THREE.IcosahedronGeometry(0.24, 0); bush.translate(b.x + sx * (w / 2 - 0.35), 0.82, zz); parts.push(paint(bush, new THREE.Color(0x4f9a52))); }
    }
  }
  // reeds along the banks
  let seed = 11; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < 70; k++) {
    const x = R.x0 + rnd() * len; if ((campus.bridges || []).some((b) => Math.abs(x - b.x) < b.w / 2 + 0.6)) continue;
    const z = rnd() < 0.5 ? R.y + 0.15 + rnd() * 0.2 : R.y + R.d - 0.15 - rnd() * 0.2;
    const reed = new THREE.ConeGeometry(0.05, 0.4 + rnd() * 0.3, 4); reed.translate(x, 0.25, z); parts.push(paint(reed, new THREE.Color().setHSL(0.24 + rnd() * 0.05, 0.45, 0.38)));
  }
  const solid = new THREE.Mesh(mergeParts(parts), mats.painted()); solid.castShadow = solid.receiveShadow = true; solid.name = "river-stone"; group.add(solid);
  const ripple = rippleTexture(); ripple.repeat.set(len / 6, R.d / 6);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(len, R.d).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x3d86a8, roughness: 0.18, metalness: 0.1, normalMap: ripple, normalScale: new THREE.Vector2(0.7, 0.7), transparent: true, opacity: 0.94, envMapIntensity: 1.2 }));
  water.position.set(cx, 0.06, cz); water.receiveShadow = true; water.name = "water"; group.add(water);
  // a little rowboat drifting downstream with a lantern, and a family of ducks paddling against the flow
  const boatParts = [box(0.9, 0.16, 0.4, 0, 0.08, 0, new THREE.Color(0x9a6b45), 0.06), box(0.7, 0.04, 0.28, 0, 0.17, 0, new THREE.Color(0xc89d6e), 0), box(0.04, 0.4, 0.04, 0.32, 0.36, 0, new THREE.Color(0x3a3a3a), 0)];
  const boat = new THREE.Mesh(mergeParts(boatParts), mats.painted()); boat.castShadow = true; boat.name = "boat"; group.add(boat);
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd38a, toneMapped: false })); lantern.position.set(0.32, 0.58, 0); boat.add(lantern);
  const duckGeo = mergeParts([box(0.18, 0.1, 0.12, 0, 0.05, 0, new THREE.Color(0xf4f0e6), 0.04), box(0.08, 0.09, 0.08, 0.08, 0.13, 0, new THREE.Color(0x3f7a4a), 0.03), box(0.05, 0.02, 0.04, 0.13, 0.12, 0, new THREE.Color(0xe8a33a), 0)]);
  const ducks = new THREE.InstancedMesh(duckGeo, mats.painted(), 4); ducks.name = "ducks"; group.add(ducks);
  const dm = new THREE.Matrix4(), dq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), dv = new THREE.Vector3(), ds = new THREE.Vector3(1, 1, 1);
  const day = new THREE.Color(0x3d86a8), dusk = new THREE.Color(0x1d3550);
  return {
    group,
    update(now, night = 0) {
      ripple.offset.set((now / 1000) * 0.035, Math.sin(now / 4000) * 0.02); // the river flows east
      water.material.color.copy(day).lerp(dusk, night);
      const u = ((now / 1000) * 0.25) % len, bx = R.x0 + u;
      boat.position.set(bx, 0.07 + Math.sin(now / 600) * 0.025, R.y + R.d * 0.38); boat.rotation.z = Math.sin(now / 800) * 0.04;
      lantern.visible = night > 0.3;
      const dx = R.x1 - ((now / 1000) * 0.12) % len;
      for (let k = 0; k < 4; k++) { dv.set(dx + k * (k ? 0.32 : 0), 0.06 + Math.sin(now / 300 + k) * 0.01, R.y + R.d * 0.68 + (k % 2) * 0.12); ds.setScalar(k ? 0.7 : 1); ducks.setMatrixAt(k, dm.compose(dv, dq, ds)); }
      ducks.instanceMatrix.needsUpdate = true;
    },
    dispose() { boat.geometry.dispose(); duckGeo.dispose(); solid.geometry.dispose(); water.geometry.dispose(); water.material.dispose(); ripple.dispose(); },
  };
}

// The village green inside the loop: a lawn with a gravel path round it, a bandstand in the middle and flower beds.
export function makeGreen(v, { bandstand = true } = {}) {
  const group = new THREE.Group(); group.name = "green";
  if (!v) return { group, dispose() {} };
  const parts = [], cx = (v.x0 + v.x1) / 2, cz = (v.y0 + v.y1) / 2, w = v.x1 - v.x0, d = v.y1 - v.y0;
  parts.push(box(w, 0.04, d, cx, 0.02, cz, new THREE.Color(0x9ccc7f), 0));
  parts.push(box(w - 1.4, 0.045, 0.5, cx, 0.03, cz, new THREE.Color(0xddd2b6), 0), box(0.5, 0.045, d - 1.4, cx, 0.03, cz, new THREE.Color(0xddd2b6), 0));
  // bandstand: an octagonal platform, eight posts and a pointed roof
  // (main3d.js puts the generated bandstand here instead when the prop kit is loaded: bandstand false)
  if (bandstand) {
    const plat = new THREE.CylinderGeometry(1.25, 1.35, 0.22, 8); plat.translate(cx, 0.11, cz); parts.push(paint(plat, new THREE.Color(0xe8e0cc)));
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; parts.push(box(0.08, 1.0, 0.08, cx + Math.cos(a) * 1.1, 0.72, cz + Math.sin(a) * 1.1, new THREE.Color(0xf6f1e6), 0)); }
    const roof = new THREE.ConeGeometry(1.5, 0.75, 8); roof.translate(cx, 1.6, cz); parts.push(paint(roof, new THREE.Color(0x3f6b8f)));
    const tip = new THREE.SphereGeometry(0.09, 8, 6); tip.translate(cx, 2.02, cz); parts.push(paint(tip, new THREE.Color(0xe0aa3e)));
  }
  // flower beds in the four lawns
  const beds = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  beds.forEach(([sx, sz], i) => {
    const bx = cx + sx * w * 0.28, bz = cz + sz * d * 0.28;
    const g = new THREE.CylinderGeometry(0.55, 0.6, 0.18, 14); g.translate(bx, 0.09, bz); parts.push(paint(g, new THREE.Color(0x7a5a3e)));
    for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2, f = new THREE.IcosahedronGeometry(0.11, 0); f.translate(bx + Math.cos(a) * 0.32, 0.24, bz + Math.sin(a) * 0.32); parts.push(paint(f, new THREE.Color().setHSL([0.95, 0.12, 0.83, 0.58][i], 0.7, 0.62))); }
  });
  const mesh = new THREE.Mesh(mergeParts(parts), mats.painted()); mesh.castShadow = mesh.receiveShadow = true; mesh.name = "green"; group.add(mesh);
  // string lights round the bandstand's eaves, lit in the evening
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffe2a0, toneMapped: false }), 24);
  const bm = new THREE.Matrix4();
  for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; bm.makeTranslation(cx + Math.cos(a) * 1.45, (bandstand ? 1.2 : 1.75) - Math.abs(Math.sin(a * 4)) * 0.06, cz + Math.sin(a) * 1.45); bulbs.setMatrixAt(k, bm); }
  group.add(bulbs);
  return { group, center: [cx, cz], update(night = 0) { bulbs.visible = night > 0.2; }, dispose() { mesh.geometry.dispose(); bulbs.geometry.dispose(); bulbs.material.dispose(); } };
}

// The Underground entrance: stairs going down under a glass-and-iron canopy, with a lit "U" roundel on a post.
export function makeUnderground(r) {
  const group = new THREE.Group(); group.name = "underground";
  const parts = [], w = r.w, d = r.d;
  parts.push(box(w + 0.3, 0.06, d + 0.3, w / 2, 0.03, d / 2, new THREE.Color(0x6f747c), 0.02)); // granite surround
  parts.push(box(w - 0.3, 0.05, d - 0.2, w / 2, 0.035, d / 2, new THREE.Color(0x15181d), 0)); // the dark stairwell
  for (let k = 0; k < 5; k++) parts.push(box(w - 0.4, 0.03, 0.18, w / 2, 0.06 - k * 0.0, 0.25 + k * 0.24, new THREE.Color().setHSL(0.6, 0.05, 0.32 - k * 0.05), 0));
  for (const x of [0.12, w - 0.12]) parts.push(box(0.06, 0.32, d - 0.1, x, 0.19, d / 2, new THREE.Color(0x2f5a3c), 0.02)); // iron railings
  // the canopy: four thin posts and a curved glass roof (drawn as a shallow green box)
  for (const [x, z] of [[0.1, 0.1], [w - 0.1, 0.1], [0.1, d - 0.1], [w - 0.1, d - 0.1]]) parts.push(box(0.05, 0.9, 0.05, x, 0.45, z, new THREE.Color(0x2f5a3c), 0));
  parts.push(box(w + 0.1, 0.06, d + 0.1, w / 2, 0.93, d / 2, new THREE.Color(0x2f5a3c), 0.02));
  // the roundel post
  parts.push(box(0.07, 1.4, 0.07, w + 0.35, 0.7, 0.2, new THREE.Color(0x30343b), 0));
  const body = new THREE.Mesh(mergeParts(parts), mats.painted()); body.castShadow = true; body.name = "body"; group.add(body);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, d), new THREE.MeshStandardMaterial({ color: 0x9fd6c0, transparent: true, opacity: 0.45, roughness: 0.1 }));
  glass.position.set(w / 2, 0.9, d / 2); group.add(glass);
  const { g, tex } = canvasTexture(64);
  g.fillStyle = "#f0c24a"; g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill(); g.fillStyle = "#1f2a3a"; g.beginPath(); g.arc(32, 32, 21, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#f0c24a"; g.font = "900 26px system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("U", 32, 34);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.28, 24), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }));
  disc.position.set(w + 0.35, 1.5, 0.2); group.add(disc);
  const pick = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 1.6, d + 0.4), mats.pick()); pick.position.set(w / 2 + 0.2, 0.8, d / 2); pick.name = "pick"; pick.userData = { project: "underground", name: "Underground" }; group.add(pick);
  group.userData = { project: "underground", w, d, h: 1.6 };
  group.disc = disc;
  group.dispose = () => { body.geometry.dispose(); glass.geometry.dispose(); glass.material.dispose(); tex.dispose(); disc.geometry.dispose(); pick.geometry.dispose(); };
  return group;
}
