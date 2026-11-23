// Campus 3D: City life, lane L2 (goods and records) and Weather routines (docs/campus-living-city.md, items 8 to 15).
// The 3D half of public/campus/citylife2.js, which asks the hub for a few counts (GET /api/agents/city), works the facts out
// once and keeps the switches. Here: the shipping docks (8), the cargo barge (9), the library (10), the pneumatic tubes (11),
// the construction crane (12), banners on the two weather balloons (13), the corporate blimp (14) and umbrellas in rain (15).
// Same rules as lane L1 (3d/citylife.js): built on a poll (refresh), never per frame; per frame only moves what is built,
// instanced or merged meshes, no downloaded files, nothing allocated in update(). Every label says it in words as well as colour.
import * as THREE from "three";
import { mergeParts } from "./buildings.js";
import { paint, mats, box } from "./materials.js";

const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), c3 = new THREE.Color();
const C = (hex) => new THREE.Color(hex);
const unlit = (hex, extra = {}) => new THREE.MeshBasicMaterial({ color: hex, toneMapped: false, ...extra });
const LVL = { ok: ["#1f6b47", "#e8fff1"], near: ["#8a5a08", "#fff4d6"], over: ["#9c2a22", "#ffe9e6"], none: ["#454b57", "#eef0f4"], news: ["#22406e", "#eaf2ff"] };

// A banner as a sprite (always faces the camera): a rounded plate with words, redrawn only when the words change.
function makeBanner(w = 4.6, h = 0.9) {
  const cv = document.createElement("canvas"); cv.width = 512; cv.height = Math.round(512 * h / w);
  const g = cv.getContext("2d"), tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false }));
  sp.scale.set(w, h, 1); sp.renderOrder = 5; sp.frustumCulled = false;
  let last = "";
  sp.userData.set = (text, lvl) => {
    const k = `${lvl}|${text}`; if (k === last) return; last = k;
    const [bg, fg] = LVL[lvl] || LVL.none, W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H); g.fillStyle = bg; g.strokeStyle = fg; g.lineWidth = 6;
    g.beginPath(); g.roundRect(5, 5, W - 10, H - 10, 22); g.fill(); g.stroke();
    let size = 54; g.font = `800 ${size}px system-ui, sans-serif`; while (g.measureText(text).width > W - 44 && size > 22) { size -= 3; g.font = `800 ${size}px system-ui, sans-serif`; }
    g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, W / 2, H / 2 + 3);
    tex.needsUpdate = true;
  };
  sp.userData.dispose = () => { tex.dispose(); sp.material.dispose(); };
  return sp;
}

// opts: { campus, buildings (the placed buildings, userData.room), sign(parent, text, x, y, z, cls), avoid (circles and rects to keep clear),
//         balloons (the two hot-air balloons, may be empty) }
export function makeCityLife3L2({ campus, buildings, sign, avoid = [], balloons = [] }) {
  const cl = window.cityLife, cl2 = window.cityLife2;
  const group = new THREE.Group(); group.name = "citylife2";
  const signs = [];
  const drop = (list) => { for (const s of list) { s.removeFromParent(); s.element.remove(); } list.length = 0; };
  const label = (list, text, x, y, z) => list.push(sign(group, text, x, y, z, "small"));
  cl2.setAvoid(avoid);
  const R = campus.river;

  // ---------- 8. Shipping docks: a pier on the river bank, crates, and a truck that drives off east ----------
  const docks = new THREE.Group(); docks.name = "docks"; group.add(docks);
  const dockSigns = [];
  const crateGeo = mergeParts([box(0.5, 0.42, 0.5, 0, 0.21, 0, C(0xd9a85a), 0.04), box(0.52, 0.06, 0.1, 0, 0.3, 0, C(0x9a6f30), 0.01), box(0.52, 0.06, 0.1, 0, 0.12, 0, C(0x9a6f30), 0.01)]);
  const crates = new THREE.InstancedMesh(crateGeo, mats.painted(), 8); crates.count = 0; crates.frustumCulled = false; crates.castShadow = true; docks.add(crates);
  const truckGeo = mergeParts([
    box(1.1, 0.55, 0.62, 0, 0.45, 0, C(0xf2efe6), 0.05), box(0.42, 0.4, 0.58, 0.78, 0.38, 0, C(0x4f86c8), 0.05), box(0.04, 0.2, 0.46, 1.0, 0.46, 0, C(0x1d2733), 0),
    ...[-0.35, 0.65].flatMap((x) => [-0.3, 0.3].map((z) => paint(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 10).rotateX(Math.PI / 2).translate(x, 0.12, z), C(0x24272d)))),
  ]);
  const truck = new THREE.Mesh(truckGeo, mats.painted()); truck.castShadow = true; truck.visible = false; docks.add(truck);
  let pier = null, dockBox = null, dockGo = false, dockSent = 0, dockPosting = 0;
  function buildDocks(f) {
    pier?.geometry.dispose(); pier?.removeFromParent(); pier = null; drop(dockSigns); crates.count = 0; truck.visible = false; dockBox = null;
    docks.visible = !!f;
    if (!f) return;
    const b = f.box; dockBox = b; dockGo = f.posting > 0; dockPosting = f.posting; dockSent = f.sentAt;
    const cx = b.x + b.w / 2, cz = b.y + b.d / 2, parts = [box(b.w, 0.14, b.d, cx, 0.07, cz, C(0xb7ad98), 0.02), box(b.w, 0.05, 0.1, cx, 0.16, b.y + b.d - 0.04, C(0x8f8673), 0)];
    for (const sx of [0.12, 0.88]) parts.push(box(0.12, 0.3, 0.12, b.x + b.w * sx, 0.28, b.y + b.d - 0.12, C(0x3d3d44), 0.02)); // bollards
    parts.push(box(1.1, 0.8, 0.8, b.x + b.w - 0.7, 0.54, b.y + 0.55, C(0x8a6f55), 0.03), box(1.2, 0.08, 0.9, b.x + b.w - 0.7, 0.98, b.y + 0.55, C(0x6a4a3a), 0.02)); // a little shed
    pier = new THREE.Mesh(mergeParts(parts), mats.painted()); pier.receiveShadow = true; pier.name = "pier"; docks.add(pier);
    const n = Math.min(8, f.waiting + f.posting);
    for (let i = 0; i < n; i++) crates.setMatrixAt(i, m4.compose(v3.set(b.x + 0.55 + (i % 4) * 0.62, 0.14 + (i >= 4 ? 0.42 : 0), b.y + 0.5), q4.identity(), s3.setScalar(1)));
    crates.count = n; crates.instanceMatrix.needsUpdate = true;
    label(dockSigns, f.label, cx, 1.7, cz);
  }
  function moveTruck(t) {
    if (!dockBox) return;
    const go = dockGo || Date.now() - dockSent < 12000;
    truck.visible = go;
    if (!go) return;
    const u = ((t / 1000) % 12) / 12, run = Math.max(0, Math.min(R ? R.x1 - 2 - dockBox.x - dockBox.w : 12, 12));
    truck.position.set(dockBox.x + dockBox.w - 1.2 + Math.max(0, u - 0.25) / 0.75 * (run + 1.2), 0.14, dockBox.y + dockBox.d - 0.5);
    truck.visible = u < 0.92;
  }

  // ---------- 9. Cargo barge: drifts along the river, its deck loaded by how far the batch is ----------
  const barge = new THREE.Group(); barge.name = "barge"; barge.visible = false; group.add(barge);
  const hullGeo = mergeParts([
    box(3.0, 0.34, 0.95, 0, 0.17, 0, C(0x4a5568), 0.05), box(0.5, 0.34, 0.85, 1.7, 0.17, 0, C(0x4a5568), 0.12), box(3.1, 0.06, 1.0, 0, 0.36, 0, C(0x9aa3ad), 0.01),
    box(0.7, 0.55, 0.7, -1.0, 0.68, 0, C(0xe6dfcf), 0.04), box(0.76, 0.06, 0.76, -1.0, 0.98, 0, C(0xb94a3a), 0.02), box(0.1, 0.4, 0.1, -1.0, 1.15, 0.15, C(0x3d3d44), 0.02),
  ]);
  const bargeHull = new THREE.Mesh(hullGeo, mats.painted()); bargeHull.castShadow = true; barge.add(bargeHull);
  const cargo = new THREE.InstancedMesh(crateGeo, mats.painted(), 8); cargo.count = 0; cargo.frustumCulled = false; cargo.castShadow = true; barge.add(cargo);
  let bargeRun = null, bargeSign = null; const bargeSigns = [];
  function buildBarge(f) {
    drop(bargeSigns); bargeRun = null; bargeSign = null; barge.visible = !!f && !!R;
    if (!f || !R) return;
    bargeRun = f.run;
    const n = Math.round(f.frac * 8);
    for (let i = 0; i < n; i++) cargo.setMatrixAt(i, m4.compose(v3.set(0.0 + (i % 4) * 0.62 - 0.4, 0.4 + (i >= 4 ? 0.42 : 0), 0), q4.identity(), s3.setScalar(0.92)));
    cargo.count = n; cargo.instanceMatrix.needsUpdate = true;
    bargeSign = sign(group, f.label, 0, 1.7, 0, "small"); bargeSigns.push(bargeSign);
  }
  function moveBarge(t) {
    if (!bargeRun) return;
    const len = bargeRun.x1 - bargeRun.x0, u = ((t / 1000) * 0.32) % (2 * len), fwd = u < len, x = bargeRun.x0 + (fwd ? u : 2 * len - u);
    barge.position.set(x, 0.05 + Math.sin(t / 900) * 0.02, bargeRun.z + Math.sin(t / 2600) * 0.15);
    barge.rotation.set(0, fwd ? 0 : Math.PI, Math.sin(t / 1300) * 0.015);
    bargeSign?.position.set(x, 1.8, bargeRun.z);
  }

  // ---------- 10. Library archive: shelves of books (this week's finished work) and a lamp on the roof (the last backup) ----------
  const lib = new THREE.Group(); lib.name = "library"; group.add(lib);
  const libSigns = [];
  const bookGeo = new THREE.BoxGeometry(0.06, 0.26, 0.2);
  const books = new THREE.InstancedMesh(bookGeo, new THREE.MeshStandardMaterial({ roughness: 0.7 }), 24); books.count = 0; books.frustumCulled = false; lib.add(books);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xe8b83a, toneMapped: false });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), lampMat); lamp.visible = false; lib.add(lamp);
  let libBody = null, libState = "unknown";
  function buildLibrary(f) {
    libBody?.geometry.dispose(); libBody?.removeFromParent(); libBody = null; drop(libSigns); books.count = 0; lamp.visible = false; lib.visible = !!f;
    if (!f) return;
    const b = f.box, cx = b.x + b.w / 2, cz = b.y + b.d / 2, H = 1.5, wood = C(0x8a5a38), cream = C(0xe3d6b8);
    const parts = [box(b.w + 0.2, 0.08, b.d + 0.2, cx, 0.04, cz, C(0xd7cdb4), 0), box(b.w, H, b.d - 0.1, cx, 0.08 + H / 2, cz - 0.05, cream, 0.03), box(b.w + 0.3, 0.1, b.d + 0.3, cx, 0.08 + H + 0.05, cz, C(0x6a4a3a), 0.02)];
    parts.push(box(b.w - 0.2, 1.1, 0.06, cx, 0.7, b.y + b.d - 0.04, wood, 0.01)); // the shelves' back panel, on the front
    for (let r = 0; r < 4; r++) parts.push(box(b.w - 0.2, 0.04, 0.24, cx, 0.2 + r * 0.38, b.y + b.d + 0.04, wood, 0));
    for (const sx of [-1, 1]) parts.push(box(0.05, 1.1, 0.24, cx + sx * (b.w / 2 - 0.1), 0.7, b.y + b.d + 0.04, wood, 0));
    libBody = new THREE.Mesh(mergeParts(parts), mats.painted()); libBody.castShadow = libBody.receiveShadow = true; lib.add(libBody);
    for (let i = 0; i < f.books; i++) { // 3 shelves of 8, filled left to right
      const row = Math.floor(i / 8), col = i % 8, x = b.x + 0.28 + col * ((b.w - 0.56) / 7), y = 0.35 + row * 0.38 + 0.13;
      books.setMatrixAt(i, m4.compose(v3.set(x, y, b.y + b.d + 0.06), q4.identity(), s3.set(1, 0.8 + ((i * 7) % 5) * 0.07, 1))); books.setColorAt(i, c3.setHSL(((i * 47 + 10) % 360) / 360, 0.5, 0.4));
    }
    books.count = f.books; books.instanceMatrix.needsUpdate = true; if (books.instanceColor) books.instanceColor.needsUpdate = true;
    lamp.position.set(b.x + b.w - 0.3, 0.08 + H + 0.38, b.y + 0.3); lamp.visible = true; libState = f.state;
    lampMat.color.setHex(f.state === "ok" ? 0x4fd08a : f.state === "failed" ? 0xff4a3d : 0xe8b83a);
    label(libSigns, f.label, cx, 2.35, b.y + b.d + 0.1);
  }

  // ---------- 11. Pneumatic tubes: a pipe along the street route from each building with something waiting, to a bin by the CEO tower ----------
  const tubes = new THREE.Group(); tubes.name = "tubes"; group.add(tubes);
  const tubeSigns = [];
  const CAPS = 8 * 3 + 12;
  const capGeo = new THREE.CapsuleGeometry(0.075, 0.2, 4, 8).rotateZ(Math.PI / 2);
  const caps = new THREE.InstancedMesh(capGeo, unlit(0xffcf5a), CAPS); caps.count = 0; caps.frustumCulled = false; tubes.add(caps);
  let pipes = null, tubeRoutes = [], tubePile = null;
  const TH = 0.42, pt = [0, 0], pt2 = [0, 0];
  function buildTubes(f) {
    pipes?.geometry.dispose(); pipes?.removeFromParent(); pipes = null; drop(tubeSigns); caps.count = 0; tubeRoutes = []; tubePile = null; tubes.visible = !!f;
    if (!f) return;
    const parts = [], shell = C(0xcdd6e4);
    for (const r of f.routes) {
      const p = r.path;
      for (let i = 1; i < p.length; i++) {
        const dx = p[i][0] - p[i - 1][0], dz = p[i][1] - p[i - 1][1], len = Math.hypot(dx, dz); if (len < 0.05) continue;
        const g = new THREE.CylinderGeometry(0.055, 0.055, len, 8).rotateZ(Math.PI / 2); // along x
        g.applyMatrix4(m4.compose(v3.set((p[i][0] + p[i - 1][0]) / 2, TH, (p[i][1] + p[i - 1][1]) / 2), q4.setFromAxisAngle(Y, -Math.atan2(dz, dx)), s3.setScalar(1)));
        parts.push(paint(g, shell));
        parts.push(paint(new THREE.SphereGeometry(0.07, 8, 6).translate(p[i][0], TH, p[i][1]), shell));
        for (let k = 0.6; k < len; k += 3) parts.push(box(0.05, TH, 0.05, p[i - 1][0] + (dx / len) * k, TH / 2, p[i - 1][1] + (dz / len) * k, C(0x6a7384), 0)); // posts
      }
    }
    // the bin by the tower: a box with an open top, the waiting capsules lying in it
    const [px, pz] = f.pile; parts.push(box(1.0, 0.22, 0.6, px, 0.11, pz, C(0x8a6d3b), 0.03), box(1.04, 0.04, 0.64, px, 0.24, pz, C(0x5a4528), 0.01));
    pipes = new THREE.Mesh(mergeParts(parts), mats.painted()); pipes.castShadow = true; tubes.add(pipes);
    tubeRoutes = f.routes; tubePile = f.pile;
    let n = 0; const pile = Math.min(12, f.total);
    for (let i = 0; i < pile; i++) caps.setMatrixAt(n++, m4.compose(v3.set(px - 0.34 + (i % 4) * 0.23, 0.3 + Math.floor(i / 4) * 0.13, pz + ((i * 5) % 3 - 1) * 0.12), q4.setFromAxisAngle(Y, (i % 3) * 0.4), s3.setScalar(0.9)));
    caps.userData.fixed = n; caps.count = n; caps.instanceMatrix.needsUpdate = true;
    label(tubeSigns, f.label, px, 1.0, pz + 0.1);
  }
  function moveTubes(t) {
    if (!tubePile) return;
    let n = caps.userData.fixed;
    for (const r of tubeRoutes) for (let i = 0; i < r.n && n < CAPS; i++) {
      const u = ((t / 1000) * 2.2 + (i * r.len) / r.n) % r.len;
      cl2.along(r.path, u, pt); cl2.along(r.path, Math.min(r.len, u + 0.1), pt2);
      caps.setMatrixAt(n++, m4.compose(v3.set(pt[0], TH, pt[1]), q4.setFromAxisAngle(Y, -Math.atan2(pt2[1] - pt[1], pt2[0] - pt[0] || 0.001)), s3.setScalar(1)));
    }
    caps.count = n; caps.instanceMatrix.needsUpdate = true;
  }

  // ---------- 12. Construction crane: a mast beside a building with a fresh pull request review, the jib swinging over it ----------
  const cranes = new THREE.Group(); cranes.name = "cranes"; group.add(cranes);
  const craneSigns = [], craneList = [];
  const mastGeo = (h) => mergeParts([box(0.4, 0.14, 0.4, 0, 0.07, 0, C(0x6b6f78), 0.02), ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(0.05, h, 0.05, sx * 0.1, h / 2, sz * 0.1, C(0xf0b429), 0))), ...Array.from({ length: Math.floor(h / 0.5) }, (_, i) => box(0.24, 0.035, 0.035, 0, 0.3 + i * 0.5, 0.1, C(0xf0b429), 0)), box(0.3, 0.2, 0.3, 0, h + 0.1, 0, C(0xf0b429), 0.02)]);
  const jibGeo = (L) => mergeParts([box(L, 0.1, 0.1, L / 2 - 0.9, 0, 0, C(0xf0b429), 0.01), box(0.6, 0.3, 0.3, -1.0, -0.12, 0, C(0x555a63), 0.03), box(0.05, 0.5, 0.05, L - 1.2, -0.28, 0, C(0x3d3d44), 0), box(0.28, 0.22, 0.28, L - 1.2, -0.62, 0, C(0xd9534f), 0.03), box(0.06, 0.4, 0.06, -0.2, 0.25, 0, C(0xf0b429), 0)]);
  function buildCranes(f) {
    for (const c of craneList) { c.group.removeFromParent(); c.group.traverse((o) => o.geometry?.dispose?.()); }
    craneList.length = 0; drop(craneSigns); cranes.visible = !!f;
    if (!f) return;
    for (const it of f) {
      const bld = buildings.find((b) => b.userData.room?.id === it.id || b.userData.room?.members?.some((m) => m.id === it.id)); if (!bld) continue;
      const r = bld.userData.room, w = bld.userData.w ?? r.w, d = bld.userData.d ?? r.d, H = Math.max(1.5, bld.userData.h ?? 2) * bld.scale.y + 1.5, L = w + 2.4;
      const g = new THREE.Group(); g.position.set(bld.position.x + w + 0.45, 0, bld.position.z + d * 0.3);
      const mast = new THREE.Mesh(mastGeo(H), mats.painted()); mast.castShadow = true; g.add(mast);
      const jib = new THREE.Group(); jib.position.set(0, H + 0.3, 0); const jm = new THREE.Mesh(jibGeo(L), mats.painted()); jm.rotation.y = Math.PI; jib.add(jm); g.add(jib); // (it points back over the building)
      cranes.add(g); craneList.push({ group: g, jib, ph: craneList.length * 1.7 });
      craneSigns.push(sign(group, it.label, g.position.x, H + 1.0, g.position.z, "small"));
    }
  }
  function moveCranes(t) { for (const c of craneList) c.jib.rotation.y = Math.sin(t / 4200 + c.ph) * 0.45; }

  // ---------- 13. Weather balloons: a banner under each of the two hot-air balloons ----------
  const ban = balloons.slice(0, 2).map(() => { const b = makeBanner(4.2, 0.85); b.visible = false; group.add(b); return b; });
  let balloonOn = false;
  function buildBalloons(f) {
    balloonOn = !!f && ban.length > 0;
    ban.forEach((b, i) => { b.visible = balloonOn; if (!f) return; const q = i === 0 ? f.spend : f.alerts; b.userData.set(`${i === 0 ? "Spend" : "Alerts"}: ${q.text}`, q.lvl); });
  }
  function moveBalloons() {
    if (!balloonOn) return;
    balloons.slice(0, 2).forEach((bl, i) => { ban[i].position.set(bl.position.x, bl.position.y - 2.9, bl.position.z); });
  }

  // ---------- 14. Corporate blimp: crosses the sky now and then, trailing the newest update titles ----------
  const blimp = new THREE.Group(); blimp.name = "blimp"; blimp.visible = false; group.add(blimp);
  { const body = new THREE.SphereGeometry(1, 20, 12).scale(3.0, 0.95, 0.95), parts = [paint(body, C(0xf2f0ea))];
    for (const [sy, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) parts.push(box(0.9, sz ? 0.05 : 0.9, sz ? 0.9 : 0.05, -2.7, sy * 0.55, sz * 0.55, C(0x3b5b9a), 0.01));
    parts.push(box(1.1, 0.3, 0.45, 0.2, -1.0, 0, C(0x4a5568), 0.05), box(2.4, 0.12, 0.96, 0.4, 0.0, 0, C(0xd94a3a), 0.02));
    const m = new THREE.Mesh(mergeParts(parts), mats.painted()); m.castShadow = false; blimp.add(m); }
  const blimpBanner = makeBanner(7.2, 0.9); blimpBanner.visible = false; group.add(blimpBanner);
  let blimpTitles = [], blimpPass = -1, blimpForce = null;
  const PERIOD = 110, FLY = 46;
  function buildBlimp(f) { blimpTitles = f?.titles || []; blimpPass = -1; if (!f) { blimp.visible = false; blimpBanner.visible = false; } }
  function moveBlimp(t) {
    if (!blimpTitles.length) return;
    const cyc = (t / 1000) % PERIOD, k = blimpForce ?? (cyc < FLY ? cyc / FLY : -1), pass = Math.floor(t / 1000 / PERIOD);
    blimp.visible = blimpBanner.visible = k >= 0;
    if (k < 0) return;
    if (pass !== blimpPass) { blimpPass = pass; blimpBanner.userData.set(`NEWS: ${blimpTitles[pass % blimpTitles.length]}`.slice(0, 64), "news"); }
    const x0 = -16, x1 = campus.w + 16, x = x0 + (x1 - x0) * k, z = campus.d * 0.35 + Math.sin(k * 3) * 2, y = 24 + Math.sin(t / 1500) * 0.25;
    blimp.position.set(x, y, z); blimp.rotation.y = 0;
    blimpBanner.position.set(x - 7.0, y - 0.2, z);
  }

  // ---------- 15. Weather routines: umbrellas on the walkers in rain, and the one line saying so ----------
  const BR = cl2.BRELLA.map(C);
  const brellaGeo = mergeParts([paint(new THREE.SphereGeometry(0.46, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1).translate(0, 1.18, 0), C(0xffffff)), paint(new THREE.CylinderGeometry(0.014, 0.014, 0.5, 5).translate(0, 0.93, 0), C(0x3d3d44))]);
  const brellas = new THREE.InstancedMesh(brellaGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }), 40); brellas.count = 0; brellas.frustumCulled = false; brellas.visible = false; group.add(brellas);
  // ---------- the public bits ----------
  const parts = [["docks", buildDocks, "docks"], ["barge", buildBarge, "barge"], ["library", buildLibrary, "library"], ["tubes", buildTubes, "tubes"], ["crane", buildCranes, "crane"], ["balloons", buildBalloons, "balloons"], ["blimp", buildBlimp, "blimp"]];
  let seen = null;
  const refresh = () => { const f = cl2.facts(); seen = f; for (const [k, build] of parts) build(f?.[k] ?? null); };
  let rev = -1, last = -9999, lastF = null;
  return {
    group, refresh,
    // the ground the library and the docks take, so people walk round them (a nav obstacle, like the diner)
    footprints() { const p = cl2.places(), out = []; if (p.lib && cl.switchedOn("library")) out.push(["rect", p.lib.x - 0.2, p.lib.y - 0.2, p.lib.w + 0.4, p.lib.d + 0.4]); return out; },
    // each frame (cheap): did a poll or a switch change the facts; then move what is built
    update(t, night, dt) {
      if (t - last > 1000 || cl.rev !== rev) {
        last = t; rev = cl.rev;
        const f = cl2.facts();
        if (f !== lastF) { lastF = f; refresh(); }
        cl2.showNote(); // (the weather routines' one line, a pill above the bottom bar: citylife2.js)
      }
      moveTruck(t); moveBarge(t); moveTubes(t); moveCranes(t); moveBalloons(); moveBlimp(t);
      if (libState === "failed" && lamp.visible) lampMat.color.setHex(Math.sin(t / 220) > 0 ? 0xff4a3d : 0x6a1410); // a failed backup blinks (a motion cue as well as the words)
    },
    // after the walkers are drawn: an umbrella over each walker in the rain
    drawUmbrellas(crowd) {
      if (!cl2.wx().rain) { brellas.visible = false; return; }
      let n = 0;
      for (let i = 0; i < crowd.ids.length && n < 40; i++) {
        const w = walkers.get(crowd.ids[i]); if (!w || !cl2.umbrellaFor(w)) continue;
        brellas.setMatrixAt(n, crowd.roots[i]); brellas.setColorAt(n, BR[cl2.brellaHue(w.d.id)]); n++;
      }
      brellas.count = n; brellas.visible = n > 0; brellas.instanceMatrix.needsUpdate = true; if (brellas.instanceColor) brellas.instanceColor.needsUpdate = true;
    },
    // for the render check: put the blimp mid-sky (0..1), or null to let it keep its own times
    blimpAt(k) { blimpForce = k; },
    where: () => ({ dock: dockBox && [dockBox.x + dockBox.w / 2, 0, dockBox.y + dockBox.d / 2], crane: craneList[0] && [craneList[0].group.position.x, 0, craneList[0].group.position.z], balloon0: balloons[0] && [balloons[0].position.x, balloons[0].position.y, balloons[0].position.z], barge: [barge.position.x, 0, barge.position.z], blimp: [blimp.position.x, blimp.position.y, blimp.position.z] }), // (the render check looks at these)
    state: () => ({ docks: !!dockBox, barge: !!bargeRun, library: lib.visible && !!libBody, tubes: !!tubePile, cranes: craneList.length, balloons: balloonOn, blimp: blimpTitles.length, umbrellas: brellas.count, seen: !!seen }),
    dispose() {
      for (const l of [signs, dockSigns, bargeSigns, libSigns, tubeSigns, craneSigns]) drop(l);
      for (const g of [crateGeo, truckGeo, hullGeo, bookGeo, capGeo, brellaGeo]) g.dispose();
      for (const b of [...ban, blimpBanner]) b.userData.dispose();
      for (const o of [pier, libBody, pipes]) o?.geometry.dispose();
      for (const c of craneList) c.group.traverse((o) => o.geometry?.dispose?.());
      blimp.traverse((o) => o.geometry?.dispose?.());
    },
  };
}
