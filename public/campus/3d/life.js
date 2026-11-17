// Campus 3D: city life for plan B+C (backlog "City life, no tokens", the owner said yes to all, 2026-11-09). All code,
// no AI. Each part is small and instanced:
//   - the Main street bus: a little bus runs down Main street and back up, all day, on its way to and from the river.
//     It's busiest at rush hour (8-9:30 and 17-18:30), and it waits at the plaza stop at night.
//   - pigeons on the plaza: they peck round the fountain and flap up when someone walks through, then settle again.
import * as THREE from "three";
import { mergeParts } from "./buildings.js";
import { paint, mats, box } from "./materials.js";
import { hasKit, kitSolid, kitSize } from "./kit.js";

const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);

export function makeLife(campus) {
  const group = new THREE.Group(); group.name = "life";
  const main = (campus.roads || []).find((r) => r.kind === "main"), sq = campus.square;
  // the quad layout (2026-11-16): no Main street; the same bus runs as the tram round the ring road, clockwise
  const ring = !main && campus.ring ? (() => { const g = campus.ring, s = g.street / 2 + 0.45; return { x0: g.x0 + s, z0: g.y0 + s, x1: g.x1 - s, z1: g.y1 - s }; })() : null;
  const parts = [];

  // ---- the bus: built along +X, turned to drive along Main street (Z)
  const busParts = [
    box(1.5, 0.5, 0.62, 0, 0.42, 0, new THREE.Color(0x2f9c8f), 0.1), box(1.52, 0.18, 0.64, 0, 0.56, 0, new THREE.Color(0xd8f0ec), 0.04),
    box(1.46, 0.06, 0.6, 0, 0.7, 0, new THREE.Color(0xf2d16b), 0.03), box(0.1, 0.14, 0.5, 0.74, 0.5, 0, new THREE.Color(0xd8f0ec), 0.03),
  ];
  for (const x of [-0.48, 0.48]) for (const z of [-0.3, 0.3]) { const w = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12); w.rotateX(Math.PI / 2); w.translate(x, 0.13, z); busParts.push(paint(w, new THREE.Color(0x24272d))); }
  // Visual rehaul 2026-11-13: the generated bus from the prop kit when it's loaded (built along X like the old one)
  const kb = hasKit("lm_bus") && kitSolid("lm_bus");
  if (kb) { const bb = kitSize("lm_bus"), k = 1.7 / (bb.max.x - bb.min.x); kb.scale(k, k, k); busParts.forEach((g) => g.dispose()); busParts.length = 0; }
  const bus = new THREE.Mesh(kb || mergeParts(busParts), kb ? new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7 }) : mats.painted()); bus.castShadow = true; bus.name = "bus"; bus.visible = !!main || !!ring;
  group.add(bus);
  const headlight = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), new THREE.MeshBasicMaterial({ color: 0xfff1c0, toneMapped: false })); headlight.position.set(0.78, 0.36, 0); bus.add(headlight);
  // a bus stop shelter at the plaza end of Main street
  if (main) {
    const sx = main.x + main.w - 0.55, sz = main.y + 1.6;
    parts.push(box(0.06, 0.8, 0.06, sx - 0.25, 0.4, sz - 0.5, new THREE.Color(0x30343b), 0), box(0.06, 0.8, 0.06, sx + 0.25, 0.4, sz - 0.5, new THREE.Color(0x30343b), 0));
    parts.push(box(0.7, 0.05, 1.2, sx, 0.82, sz, new THREE.Color(0x2f9c8f), 0.02), box(0.5, 0.06, 0.9, sx + 0.1, 0.3, sz, new THREE.Color(0x9a6b45), 0.02));
    parts.push(box(0.04, 0.5, 0.25, sx - 0.32, 0.55, sz + 0.4, new THREE.Color(0xf2d16b), 0.02));
  }

  // ---- pigeons: a little grey body, a darker head; instanced
  const N_PIG = 9;
  const pigGeo = mergeParts([box(0.14, 0.08, 0.08, 0, 0.06, 0, new THREE.Color(0x9ea4ad), 0.03), box(0.06, 0.06, 0.06, 0.08, 0.11, 0, new THREE.Color(0x6e7884), 0.02), box(0.03, 0.015, 0.02, 0.12, 0.1, 0, new THREE.Color(0xe0a050), 0)]);
  const pigeons = new THREE.InstancedMesh(pigGeo, mats.painted(), N_PIG); pigeons.name = "pigeons"; group.add(pigeons);
  let seed = 5; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pig = Array.from({ length: N_PIG }, (_, i) => { const a = rnd() * Math.PI * 2, r = (sq?.r || 3) * (0.45 + rnd() * 0.4); return { hx: (sq?.x || 0) + Math.cos(a) * r, hz: (sq?.y || 0) + Math.sin(a) * r, x: 0, z: 0, y: 0, fly: 0, ry: rnd() * Math.PI * 2, ph: rnd() * 10 }; });
  pig.forEach((p) => { p.x = p.hx; p.z = p.hz; });

  // ---- birds at dawn and dusk: a small flock in a loose V crossing the sky, wings flapping
  const N_BIRD = 7, birdGeo = new THREE.BufferGeometry();
  birdGeo.setAttribute("position", new THREE.Float32BufferAttribute([-0.32, 0.12, 0.06, 0, 0, -0.1, 0, 0, 0.14, 0, 0, -0.1, 0.32, 0.12, 0.06, 0, 0, 0.14], 3)); birdGeo.computeVertexNormals();
  const birds = new THREE.InstancedMesh(birdGeo, new THREE.MeshBasicMaterial({ color: 0x2a2f38, side: THREE.DoubleSide }), N_BIRD); birds.name = "birds"; birds.frustumCulled = false; group.add(birds);
  const bx0 = -20, bx1 = (campus.w || 40) + 30, bz = (campus.d || 40) * 0.45;
  const still = parts.length ? new THREE.Mesh(mergeParts(parts), mats.painted()) : null;
  if (still) { still.castShadow = true; still.name = "life-still"; group.add(still); }

  const rush = (h) => (h >= 8 && h < 9.5) || (h >= 17 && h < 18.5);
  let busU = 0, lastT = 0;
  return {
    group,
    update(t, night = 0, walkers = []) {
      const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0; lastT = t;
      const now = new Date(), h = now.getHours() + now.getMinutes() / 60;
      // bus: down the east lane to the river, a U-turn, back up the west lane; parked at the stop at night
      if (main) {
        const len = main.d - 2.2, lap = len * 2 + 2;
        if (night > 0.85) busU = 0; else busU = (busU + dt * (rush(h) ? 1.6 : 0.9)) % lap;
        let x, z, ry;
        if (busU < len) { x = main.x + main.w - 1.2; z = main.y + 1.6 + busU; ry = -Math.PI / 2; }
        else if (busU < len + 1) { const a = (busU - len) * Math.PI; x = main.x + main.w / 2 + Math.cos(a) * (main.w / 2 - 1.2); z = main.y + 1.6 + len + Math.sin(a) * 0.6; ry = -Math.PI / 2 - a; }
        else if (busU < len * 2 + 1) { x = main.x + 1.2; z = main.y + 1.6 + len - (busU - len - 1); ry = Math.PI / 2; }
        else { const a = (busU - len * 2 - 1) * Math.PI; x = main.x + main.w / 2 - Math.cos(a) * (main.w / 2 - 1.2); z = main.y + 1.6 - Math.sin(a) * 0.6; ry = Math.PI / 2 - a; }
        bus.position.set(x, 0.02, z); bus.rotation.y = ry; headlight.visible = night > 0.25;
      } else if (ring) {
        // the tram: round and round the ring road (it stops for the night like the bus)
        const L1 = ring.x1 - ring.x0, L2 = ring.z1 - ring.z0, per = 2 * (L1 + L2);
        if (night <= 0.85) busU = (busU + dt * (rush(h) ? 2.4 : 1.4)) % per;
        let u = busU, x, z, ry;
        if (u < L1) { x = ring.x0 + u; z = ring.z0; ry = 0; }
        else if ((u -= L1) < L2) { x = ring.x1; z = ring.z0 + u; ry = -Math.PI / 2; }
        else if ((u -= L2) < L1) { x = ring.x1 - u; z = ring.z1; ry = Math.PI; }
        else { u -= L1; x = ring.x0; z = ring.z1 - u; ry = Math.PI / 2; }
        bus.position.set(x, 0.02, z); bus.rotation.y = ry; headlight.visible = night > 0.25;
      }
      // pigeons: peck at home; anyone within a metre makes them flap up and away; they come back down
      pig.forEach((p, i) => {
        const near = walkers.some((w) => Math.hypot(w[0] - p.x, w[1] - p.z) < 1.0);
        if (near && p.fly <= 0) p.fly = 2.5 + (i % 3) * 0.4;
        if (p.fly > 0) { p.fly -= dt; const up = Math.sin(Math.min(1, p.fly / 2.5) * Math.PI); p.y = up * 1.4; p.x += Math.cos(p.ry) * dt * 1.2; p.z += Math.sin(p.ry) * dt * 1.2; }
        else { p.y = 0; p.x += (p.hx - p.x) * dt * 0.5; p.z += (p.hz - p.z) * dt * 0.5; if (Math.random() < dt * 0.3) p.ry += (Math.random() - 0.5) * 2; }
        const peck = p.fly > 0 ? 0 : Math.max(0, Math.sin(t / 180 + p.ph)) * 0.35;
        q.setFromAxisAngle(Y, -p.ry); const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -peck);
        pigeons.setMatrixAt(i, m.compose(v.set(p.x, p.y + 0.02, p.z), q.multiply(tilt), s.setScalar(night > 0.8 ? 0 : 1))); // they roost at night
      });
      pigeons.instanceMatrix.needsUpdate = true;
      // birds: dawn 6:00-8:00 and dusk 17:00-19:30, one crossing every 40 s
      const dawn = (h >= 6 && h < 8) || (h >= 17 && h < 19.5);
      if (dawn) {
        const u = ((t / 1000) % 40) / 40, cx = bx0 + (bx1 - bx0) * u;
        for (let k = 0; k < N_BIRD; k++) {
          const row = Math.ceil(k / 2), side = k % 2 ? 1 : -1, flap = 0.4 + Math.abs(Math.sin(t / 140 + k)) * 0.9;
          v.set(cx - row * 0.9, 7 + Math.sin(t / 900 + k) * 0.15, bz + side * row * 0.7 + Math.sin(u * 6) * 2);
          q.setFromAxisAngle(Y, Math.PI / 2); s.set(1, flap, 1);
          birds.setMatrixAt(k, m.compose(v, q, s));
        }
        birds.count = N_BIRD; birds.instanceMatrix.needsUpdate = true; s.set(1, 1, 1);
      } else birds.count = 0;
    },
    dispose() { bus.geometry.dispose(); pigGeo.dispose(); birdGeo.dispose(); still?.geometry.dispose(); },
  };
}
