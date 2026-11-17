// Campus 3D: shared low-poly materials and the project palette. Checked against three r160 (public/vendor).
// Static geometry is painted with vertex colours (paint()) and merged, so a whole building body draws with ONE
// shared material and one draw call.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// Same hash as hueOf() in public/campus/core.js, so a project keeps its colour in 2D and 3D.
export function hueOf(id) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }

// A project colour: hue in degrees (0-360), saturation and lightness 0-1.
export function hsl(hue, s = 0.45, l = 0.62) { return new THREE.Color().setHSL(((hue % 360) + 360) % 360 / 360, s, l); }

// The palette for one project hue: walls, slab bands, roof, accent.
export function palette(hue) {
  return {
    wall: hsl(hue, 0.52, 0.64),
    band: hsl(hue, 0.30, 0.86),
    trim: hsl(hue, 0.35, 0.42),
    roof: new THREE.Color(0xd9cdb4),
    accent: hsl(hue + 25, 0.55, 0.55),
  };
}

export const COLORS = {
  grass: new THREE.Color(0x8fbf78),
  grassDark: new THREE.Color(0x7fae6a),
  road: new THREE.Color(0x8a8f99),
  roadLine: new THREE.Color(0xe8e2cf),
  kerb: new THREE.Color(0xc9c2b0),
  leaf: new THREE.Color(0x4f9a52),
  leafDark: new THREE.Color(0x3f8445),
  trunk: new THREE.Color(0x7a5232),
  roofGarden: new THREE.Color(0x6fae5c),
  metal: new THREE.Color(0x4a5260),
};

// Bake a flat colour into a geometry's vertex colours (adds a "color" attribute), so it can be merged with others.
export function paint(geometry, color) {
  const c = color instanceof THREE.Color ? color : new THREE.Color(color);
  const n = geometry.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geometry.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geometry;
}

// Shared materials, made once. Polish pass (2026-11-09): everything lit uses MeshStandardMaterial so the soft
// room-light environment (scene.environment, set in main3d.js) fills shadows and rounds the look; matte (roughness
// 0.9, no metal) keeps the cozy low-poly feel. setEnv(k) dims the environment light with the night.
const cache = new Map();
function once(key, make) { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); }
const lit = new Set();
let envK = 0.3;
export function std(opts = {}) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...opts });
  m.userData.envBase = opts.envMapIntensity ?? 1; m.envMapIntensity = m.userData.envBase * envK;
  lit.add(m); return m;
}
// Environment light strength for every lit material (about 0.55 by day, lower at night).
export function setEnv(k) { envK = k; for (const m of lit) m.envMapIntensity = m.userData.envBase * k; }

export const mats = {
  // Everything static and merged: vertex-coloured, lit, smooth (rounded edges catch the light).
  painted: () => once("painted", () => std({ vertexColors: true })),
  // Windows: unlit, white base so the per-instance colour is the final colour.
  glass: () => once("glass", () => new THREE.MeshBasicMaterial({ color: 0xffffff })),
  solid: (hex) => once("solid:" + hex, () => std({ color: hex })),
  // Instanced people: per-instance colour on a soft satin finish.
  people: (hex = 0xffffff) => once("people:" + hex, () => std({ color: hex, roughness: 0.6 })),
  // Toon grey with a 3-step ramp, for the pet.
  toon: (hex) => once("toon:" + hex, () => new THREE.MeshToonMaterial({ color: hex, gradientMap: toonRamp() })),
  toonPainted: () => once("toonPainted", () => new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() })),
  // Invisible pick boxes never draw (visible = false), but the raycaster still hits them.
  pick: () => once("pick", () => new THREE.MeshBasicMaterial({ visible: false })),
  // Soft contact shadows (baked ambient occlusion on the ground): dark, see-through, never writes depth.
  contact: () => once("contact", () => new THREE.MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false, opacity: 1, toneMapped: false })),
};

// A canvas and its sRGB texture: draw on g, set tex.needsUpdate after a repaint.
export function canvasTexture(w, h = w) {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  return { cv, g: cv.getContext("2d"), tex };
}

// A box with softly rounded edges (polish pass): the radius is capped to a third of the thinnest side, so slabs stay crisp.
export function box(w, h, d, x, y, z, color, round = 0.07) {
  const r = Math.min(round, Math.min(w, h, d) / 3);
  const g = r > 0.01 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, color);
}

// A blurred rounded-rectangle shadow on a canvas: dark in the middle, fading out at the edges. Stretched under each
// building (and as a round blob under each person) it reads as ambient occlusion where things meet the ground.
export function contactTexture() {
  return once("contactTex", () => {
    const size = 128, { g, tex } = canvasTexture(size);
    g.filter = "blur(14px)"; g.fillStyle = "rgba(20,24,34,0.55)";
    g.beginPath(); g.roundRect(26, 26, size - 52, size - 52, 18); g.fill();
    return tex;
  });
}
export function blobTexture() { return once("blobTex", () => radialTexture("rgba(20,24,34,0.5)", "rgba(20,24,34,0)", 64)); }

// Baked ambient occlusion in the vertex colours: darkens a merged geometry near the ground (y below `reach`), by up
// to `amount`. Cheap and done once per build, so it costs nothing per frame.
export function bakeGroundAO(geometry, { reach = 1.2, amount = 0.3 } = {}) {
  const pos = geometry.attributes.position, c = geometry.attributes.color;
  if (!c) return geometry;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getY(i) / reach)), k = 1 - amount * (1 - t * t * (3 - 2 * t));
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  c.needsUpdate = true;
  return geometry;
}

function toonRamp() {
  return once("toonRamp", () => {
    const t = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]), 3, 1);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  });
}

// A soft round gradient on a canvas (glows and light pools). inner/outer are CSS colours.
export function radialTexture(inner = "rgba(255,220,150,1)", outer = "rgba(255,200,120,0)", size = 64) {
  const { g, tex } = canvasTexture(size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner); grad.addColorStop(1, outer);
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  return tex;
}
