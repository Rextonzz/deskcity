// Campus 3D: seasons by the real date (the owner 2026-11-09, "seasons"). the owner's town's year, roughly:
// - winter (Dec to mid-March): snow caps on every roof, snowy treetops;
// - spring (mid-March to May): pale new leaves and a few pink blossom trees;
// - summer: the usual greens;
// - autumn (mid-September to November): orange, red and gold trees;
// - October also gets pumpkins by every front door and round the square; December gets string lights along the
//   roof edges (they glow, and twinkle after dark).
// Testing: ?season=winter|spring|summer|autumn|october|december in the address bar overrides the date.
// Draw calls: at most 3 (snow caps merged, pumpkins instanced, lights instanced). Checked against three r160.
import * as THREE from "three";
import { mergeParts } from "./buildings.js";
import { paint, mats } from "./materials.js";

export function seasonNow(d = new Date()) {
  const forced = new URLSearchParams(location.search).get("season");
  const m = d.getMonth(), day = d.getDate();
  const base = m === 11 || m <= 1 || (m === 2 && day < 15) ? "winter" : m <= 4 ? "spring" : m <= 7 || (m === 8 && day < 20) ? "summer" : "autumn";
  const s = { name: base, pumpkins: m === 9, lights: m === 11 };
  if (forced === "october") Object.assign(s, { name: "autumn", pumpkins: true, lights: false });
  else if (forced === "december") Object.assign(s, { name: "winter", pumpkins: false, lights: true });
  else if (["winter", "spring", "summer", "autumn"].includes(forced)) Object.assign(s, { name: forced, pumpkins: false, lights: false });
  return s;
}

// A tree crown's colour for the season. rnd: the caller's seeded random, so the city looks the same every rebuild.
export function crownColour(col, season, rnd) {
  const r = rnd();
  if (season.name === "autumn") return col.setHSL([0.07, 0.02, 0.11, 0.05][Math.floor(r * 4)] + rnd() * 0.02, 0.62 + rnd() * 0.2, 0.42 + rnd() * 0.1);
  if (season.name === "winter") return r < 0.7 ? col.setHSL(0.58, 0.12, 0.86 + rnd() * 0.08) : col.setHSL(0.36, 0.3, 0.26 + rnd() * 0.06); // snowy, a few dark firs
  if (season.name === "spring") return r < 0.18 ? col.setHSL(0.93, 0.55, 0.8) : col.setHSL(0.25 + rnd() * 0.05, 0.5, 0.5 + rnd() * 0.08);
  return col.setHSL(0.27 + r * 0.08, 0.42 + rnd() * 0.15, 0.36 + rnd() * 0.1);
}

// buildings: [{ x, z, w, d, h }] footprints and heights; doors: [{ x, z }] front-door spots; square: { x, y, r } or null.
export function makeSeasonal({ buildings = [], doors = [], square = null }, season = seasonNow()) {
  const group = new THREE.Group(); group.name = "season";
  const disposers = [];
  let lightMesh = null, lightCols = [];
  if (season.name === "winter" && buildings.length) {
    // a soft rounded white cap a little proud of each roof
    const parts = buildings.map((b) => { const g = new THREE.BoxGeometry(b.w + 0.2, 0.16, b.d + 0.2); g.translate(b.x + b.w / 2, b.h + 0.1, b.z + b.d / 2); return paint(g, new THREE.Color(0xf4f7fb)); });
    const caps = new THREE.Mesh(mergeParts(parts), mats.painted()); caps.receiveShadow = true; caps.name = "snow";
    group.add(caps); disposers.push(() => caps.geometry.dispose());
  }
  if (season.pumpkins) {
    const spots = [];
    for (const d of doors) spots.push([d.x - 0.6, d.z + 0.35, 1], [d.x + 0.6, d.z + 0.4, 0.8]);
    if (square) for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; spots.push([square.x + Math.cos(a) * (square.r + 0.3), square.y + Math.sin(a) * (square.r + 0.3), 0.7 + (k % 3) * 0.15]); }
    const geo = new THREE.SphereGeometry(0.28, 10, 8).scale(1, 0.72, 1).translate(0, 0.2, 0);
    const pmat = mats.solid(0xe8822a).clone(); if (pmat.emissive) pmat.emissive.set(0x7a3300); // a jack-o'-lantern glow, readable at night
    const pm = new THREE.InstancedMesh(geo, pmat, Math.max(1, spots.length));
    const m = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    spots.forEach(([x, z, sc], i) => pm.setMatrixAt(i, m.compose(v.set(x, 0, z), q, s.setScalar(sc))));
    pm.count = spots.length; pm.castShadow = true; pm.name = "pumpkins";
    group.add(pm); disposers.push(() => { geo.dispose(); pm.dispose(); });
  }
  if (season.lights && buildings.length) {
    const spots = [];
    for (const b of buildings) {
      const y = b.h + 0.17, e = 0.1, X0 = b.x - e, X1 = b.x + b.w + e, Z0 = b.z - e, Z1 = b.z + b.d + e, per = (len) => Math.max(2, Math.round(len / 0.45));
      for (const [x0, z0, x1, z1] of [[X0, Z1, X1, Z1], [X1, Z0, X1, Z1], [X0, Z0, X1, Z0], [X0, Z0, X0, Z1]]) {
        const n = per(Math.hypot(x1 - x0, z1 - z0));
        for (let i = 0; i <= n; i++) spots.push([x0 + ((x1 - x0) * i) / n, y - Math.sin((i / n) * Math.PI * 3) ** 2 * 0.12, z0 + ((z1 - z0) * i) / n]);
      }
    }
    const geo = new THREE.SphereGeometry(0.055, 6, 4);
    lightMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false }), spots.length);
    const m = new THREE.Matrix4(), PAL = [0xff4d4d, 0x4dff88, 0xffd84d, 0x4dc3ff, 0xff8de1].map((c) => new THREE.Color(c));
    spots.forEach(([x, y, z], i) => { lightMesh.setMatrixAt(i, m.makeTranslation(x, y, z)); lightMesh.setColorAt(i, PAL[i % PAL.length]); });
    lightCols = spots.map((_, i) => PAL[i % PAL.length]);
    lightMesh.name = "lights"; group.add(lightMesh); disposers.push(() => { geo.dispose(); lightMesh.dispose(); });
  }
  const tmp = new THREE.Color();
  let lastTw = -1;
  return {
    group, season,
    // twinkle after dark (4 steps a second); dimmer in daylight
    update(now, night) {
      if (!lightMesh) return;
      const tw = Math.floor(now / 250);
      if (tw === lastTw) return;
      lastTw = tw;
      for (let i = 0; i < lightCols.length; i++) {
        const on = night > 0.3 ? ((i * 7 + tw) % 5 !== 0 ? 1 : 0.25) : 0.55;
        lightMesh.setColorAt(i, tmp.copy(lightCols[i]).multiplyScalar(on));
      }
      lightMesh.instanceColor.needsUpdate = true;
    },
    dispose() { disposers.forEach((f) => f()); },
  };
}
