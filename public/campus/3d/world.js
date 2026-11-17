// Campus 3D: the world around the campus (visual rehaul 2026-11-13, after towers.app's city). The campus used to float
// on a square of grass in an empty sky; now it sits in a coastal town: a sea that runs to the horizon behind the CEO
// tower, a beach, and an outskirts city of low-rise blocks and a few towers that fades into the haze. Nothing out
// here is tappable or real: it's scenery, so it's cheap (4 draws) and built once per city build.
// facadeMaterial() is shared with the campus's own buildings: windows are drawn by the shader from the world position
// (no textures, no UVs), and lit windows come on at night from a hash, so any box becomes an office block.
import * as THREE from "three";
import { std } from "./materials.js";

// ---------- the procedural facade: walls with window grids, worked out per pixel ----------
// uNight 0..1 lights a share of the windows warm; uFloorH is a storey's height; per-instance colour tints the wall.
const facadeUniforms = { uNight: { value: 0 }, uFloorH: { value: 1.5 }, uBay: { value: 0.9 } };
export function setFacadeNight(n) { facadeUniforms.uNight.value = n; }
export function facadeMaterial(opts = {}) {
  const m = std({ color: 0xffffff, roughness: 0.82, ...opts });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, facadeUniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n  vec4 wp4 = vec4(transformed, 1.0);\n  #ifdef USE_INSTANCING\n  wp4 = instanceMatrix * wp4;\n  #endif\n  wp4 = modelMatrix * wp4; vWPos = wp4.xyz;\n  vec3 wn = objectNormal;\n  #ifdef USE_INSTANCING\n  wn = mat3(instanceMatrix) * wn;\n  #endif\n  vWNorm = normalize(mat3(modelMatrix) * wn);");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm; uniform float uNight; uniform float uFloorH; uniform float uBay;\nfloat hash21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }")
      .replace("#include <color_fragment>", `#include <color_fragment>
  float side = 1.0 - step(0.7, abs(vWNorm.y));                 // walls only, not roofs
  float along = abs(vWNorm.x) > 0.5 ? vWPos.z : vWPos.x;
  vec2 cell = vec2(along / uBay, (vWPos.y - 0.35) / uFloorH);
  vec2 f = fract(cell);
  float win = side * step(0.18, f.x) * step(f.x, 0.82) * step(0.22, f.y) * step(f.y, 0.8) * step(0.6, vWPos.y);
  vec2 id = floor(cell) + floor(vWPos.xz * 0.37);
  float litW = step(0.55, hash21(id)) * uNight;
  vec3 glassDay = mix(vec3(0.36, 0.47, 0.58), vec3(0.62, 0.74, 0.84), smoothstep(0.2, 0.8, f.y));
  vec3 glass = mix(glassDay, vec3(0.08, 0.1, 0.15), uNight);
  diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * 0.92);
  vWin = win; vLit = litW;`)
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n  totalEmissiveRadiance += vWin * vLit * vec3(1.0, 0.72, 0.38) * 1.15;")
      .replace("void main() {", "float vWin = 0.0; float vLit = 0.0;\nvoid main() {");
  };
  m.customProgramCacheKey = () => "facade";
  return m;
}

// ---------- the world ----------
// b: the campus bounds { x0, x1, z0, z1 } (tiles). Returns { group, setNight(n), dispose() }.
let seed = 5;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
export function makeWorld(b, { capH = 12 } = {}) {
  seed = 5;
  const group = new THREE.Group(); group.name = "world";
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  // The coast runs behind the campus (north and west of it, the way the camera looks by default) and the town spreads
  // east and south. Land: a big slab under everything with a soft beach edge.
  const coastN = b.z0 - 26, coastW = b.x0 - 34, landE = b.x1 + 150, landS = b.z1 + 150;
  const parts = [];
  const land = new THREE.Mesh(new THREE.PlaneGeometry(landE - coastW, landS - coastN).rotateX(-Math.PI / 2).translate((landE + coastW) / 2, -0.04, (landS + coastN) / 2), std({ color: 0xb9b6a6, roughness: 1 }));
  land.receiveShadow = true; group.add(land);
  const beachMat = std({ color: 0xe8d9b4, roughness: 1 });
  const beachN = new THREE.Mesh(new THREE.BoxGeometry(landE - coastW + 6, 0.3, 6).translate((landE + coastW) / 2, -0.18, coastN - 2), beachMat);
  const beachW = new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, landS - coastN + 6).translate(coastW - 2, -0.18, (landS + coastN) / 2), beachMat);
  group.add(beachN, beachW);
  // the sea: a huge plane just under the beach, glossy so the sun glints on it
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2).translate(cx, -0.32, cz), std({ color: 0x3f7fa6, roughness: 0.18, metalness: 0.15, envMapIntensity: 1.6 }));
  sea.name = "sea"; group.add(sea);
  const seaDay = new THREE.Color(0x3f7fa6), seaNight = new THREE.Color(0x0c1a2c);

  // The outskirts: city blocks on a grid all round the campus (outside its streets and woods), lower and sparser
  // further out, with a few towers near the campus edge so the skyline steps up toward it.
  const keep = { x0: b.x0 - 9, x1: b.x1 + 9, z0: b.z0 - 9, z1: b.z1 + 9 }; // a tree belt, then town (city planner pass)
  const blocks = [];
  const BLK = 7.5;
  for (let x = coastW + 4; x < landE - 4; x += BLK) for (let z = coastN + 4; z < landS - 4; z += BLK) {
    const bx = x + BLK / 2, bz = z + BLK / 2;
    if (bx > keep.x0 && bx < keep.x1 && bz > keep.z0 && bz < keep.z1) continue;
    const front = bx > keep.x1 && bz > keep.z1; // the corner nearest the default camera
    const dEdge = Math.max(keep.x0 - bx, bx - keep.x1, keep.z0 - bz, bz - keep.z1, 0);
    const far = Math.min(1, dEdge / 110);
    // each block: 1-4 buildings round its edge
    const n = 1 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) {
      if (rnd() < far * 0.35) continue;
      if (front && dEdge < 25 && rnd() < 0.4) continue; // keep the camera's foreground low and open
      const w = 2 + rnd() * 2.6, d = 2 + rnd() * 2.6;
      const ox = (k % 2 ? 1 : -1) * (BLK / 2 - 0.9 - w / 2) * (0.6 + rnd() * 0.4), oz = (k < 2 ? 1 : -1) * (BLK / 2 - 0.9 - d / 2) * (0.6 + rnd() * 0.4);
      // Low-rise close to the campus; towers only behind it (north and west, where the default view looks), so they
      // make a skyline and never stand between the camera and the campus.
      const behind = bz < keep.z0 - 4 || bx < keep.x0 - 4, nearFront = !behind && dEdge < 40;
      let h = 1.5 * (1 + Math.floor(rnd() * (nearFront ? 2 : 3)));
      if (behind && dEdge > 14 && rnd() < 0.32) h = Math.min(1.5 * (6 + Math.floor(rnd() * 9)), capH * (dEdge > 80 ? 1.0 : 0.8)); // a skyline, always below the CEO tower
      else if (!nearFront && rnd() < 0.08) h = Math.min(1.5 * (4 + Math.floor(rnd() * 5)), capH * 0.6);
      if (front && dEdge < 25) h = 1.5;
      blocks.push({ x: bx + ox, z: bz + oz, w, d, h, pitched: (front && dEdge < 25) || (h <= 4.5 && rnd() < 0.55) });
    }
  }
  const WALLS = [0xe9dfcb, 0xe2d2b4, 0xd9c7a8, 0xf0e8d8, 0xcdbfa6, 0xe6d6c0, 0xd6cab8, 0xbfc7cc];
  const ROOFS = [0xb6593b, 0xa04e35, 0xc4704a, 0x8f4a36];
  const mbox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const walls = new THREE.InstancedMesh(mbox, facadeMaterial(), blocks.length);
  const flat = blocks.filter((q) => !q.pitched), pit = blocks.filter((q) => q.pitched);
  const caps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), std({ color: 0xffffff }), Math.max(1, flat.length));
  const roofs = new THREE.InstancedMesh(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0), std({ color: 0xffffff, flatShading: true }), Math.max(1, pit.length));
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), C = new THREE.Color();
  blocks.forEach((q, i) => {
    walls.setMatrixAt(i, M.compose(P.set(q.x, 0, q.z), Q.identity(), S.set(q.w, q.h, q.d)));
    walls.setColorAt(i, C.set(WALLS[Math.floor(rnd() * WALLS.length)]));
  });
  flat.forEach((q, i) => { caps.setMatrixAt(i, M.compose(P.set(q.x, q.h, q.z), Q.identity(), S.set(q.w + 0.12, 0.14, q.d + 0.12))); caps.setColorAt(i, C.set(q.h > 9 ? 0xcfc8bb : 0xd8cfbe)); });
  pit.forEach((q, i) => { roofs.setMatrixAt(i, M.compose(P.set(q.x, q.h, q.z), Q.identity(), S.set(q.w + 0.3, 0.9 + rnd() * 0.5, q.d + 0.3))); roofs.setColorAt(i, C.set(ROOFS[Math.floor(rnd() * ROOFS.length)])); });
  caps.count = flat.length; roofs.count = pit.length;
  for (const m of [walls, caps, roofs]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }

  // Streets in the outskirts: a pale grid on the land (one merged mesh of thin strips)
  const strips = [];
  for (let x = coastW + 4; x <= landE - 4; x += BLK) strips.push(new THREE.PlaneGeometry(1.1, landS - coastN - 8).rotateX(-Math.PI / 2).translate(x, -0.03, (landS + coastN) / 2));
  for (let z = coastN + 4; z <= landS - 4; z += BLK) strips.push(new THREE.PlaneGeometry(landE - coastW - 8, 1.1).rotateX(-Math.PI / 2).translate((landE + coastW) / 2, -0.028, z));
  const roadGeo = mergeFlat(strips);
  const roads = new THREE.Mesh(roadGeo, std({ color: 0x8d9097, roughness: 1 })); roads.receiveShadow = true; group.add(roads);
  // A few sailing boats and a lighthouse on the point, for the horizon.
  const boatMat = std({ color: 0xf4f1ea });
  for (let i = 0; i < 7; i++) {
    const bx = coastW - 20 - rnd() * 140, bz = coastN - 30 - rnd() * 160;
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 0.5).translate(0, 0.0, 0), boatMat); hull.position.set(bx, -0.2, bz);
    const sail = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.6, 3).translate(0, 0.95, 0), boatMat); sail.position.set(bx, -0.2, bz);
    group.add(hull, sail);
  }
  const lh = new THREE.Group();
  lh.add(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.8, 6, 12).translate(0, 3, 0), std({ color: 0xf2efe8 })));
  for (let k = 0; k < 3; k++) lh.add(new THREE.Mesh(new THREE.CylinderGeometry(0.62 - k * 0.04, 0.66 - k * 0.04, 0.6, 12).translate(0, 1.2 + k * 1.6, 0), std({ color: 0xc8463b })));
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.7, 10).translate(0, 6.4, 0), new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));
  lh.add(lamp, new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.6, 10).translate(0, 7.05, 0), std({ color: 0x2f3a46 })));
  lh.position.set(coastW - 1, 0, coastN - 1); lh.traverse((o) => { if (o.isMesh) o.castShadow = true; }); group.add(lh);

  return {
    group,
    setNight(n) {
      setFacadeNight(n);
      sea.material.color.copy(seaDay).lerp(seaNight, n);
      land.material.color.setHex(0xb9b6a6).lerp(new THREE.Color(0x2a2f38), n * 0.8);
      lamp.material.color.setHex(n > 0.3 ? 0xffe9a0 : 0xf4efe0);
    },
    dispose() { group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); }); },
  };
}
function mergeFlat(geos) {
  const n = geos.reduce((a, g) => a + g.index.count, 0), pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    const p = g.attributes.position, q = g.attributes.normal, idx = g.index;
    for (let i = 0; i < idx.count; i++) { const k = idx.getX(i); pos.set([p.getX(k), p.getY(k), p.getZ(k)], o * 3); nor.set([q.getX(k), q.getY(k), q.getZ(k)], o * 3); o++; }
    g.dispose();
  }
  return new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3)).setAttribute("normal", new THREE.BufferAttribute(nor, 3));
}
