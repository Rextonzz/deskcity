// Campus 3D: the workers, rebuilt from the ground up (the owner 2026-11-13: "The guys look a bit weird, you can redo
// ground up, I just need the shirt tracking"). A proper little 3D character that turns to face where it's going:
// a glossy white head with a curved dark visor and two glowing eyes (they blink; closed and sleepy when paused), a soft
// torso in their shirt colour, arms with white hands, stubby feet that step as they walk. The shirt tracking is a badge
// printed on the chest AND the back (the same tile as before: model colour and code, effort dots, the API or subscription
// coin), so it reads from either side. Leads keep their gold antenna. Poses: walking, standing, waving, sitting, typing.
//
// One crowd draws everyone (office, city, houses): begin() each frame, add() per person, end(). Every part is one
// instanced mesh (about 12 draws for the whole crowd). Origin at the feet, facing +z before the heading turns it.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeParts } from "./buildings.js";
import { std } from "./materials.js";

const HEAD_Y = 0.69, EYE_Z = 0.229, SHOULDER = [0.205, 0.41], FOOT_X = 0.085;
// The head: a slightly squashed sphere, a short neck, small ear discs.
function headGeo() {
  const head = new THREE.SphereGeometry(0.25, 32, 22); head.scale(1, 0.86, 0.92); head.translate(0, HEAD_Y, 0);
  const neck = new THREE.CylinderGeometry(0.07, 0.08, 0.08, 16); neck.translate(0, 0.48, 0);
  const ears = [-1, 1].map((sx) => new THREE.CylinderGeometry(0.058, 0.058, 0.05, 16).rotateZ(Math.PI / 2).translate(sx * 0.248, HEAD_Y, 0));
  return mergeParts([head, neck, ...ears]);
}
// The visor: a band of the head's front, a touch proud of it (a slice of a slightly bigger sphere).
function visorGeo() {
  const g = new THREE.SphereGeometry(0.256, 32, 12, Math.PI / 2 - 0.98, 1.96, Math.PI / 2 - 0.46, 0.74);
  g.scale(1, 0.86, 0.92); g.translate(0, HEAD_Y, 0); return g;
}

// scene; shirtTex: the shirt atlas (16 x 16 tiles); tileUV(d) -> [u, v] of a worker's tile; colourOf(d) -> hex.
export function makeCrowd(scene, { max = 200, shirtTex, tileUV, colourOf, tiles = 16 }) {
  const mk = (geo, mat, n, shadow = true) => { const m = new THREE.InstancedMesh(geo, mat, n); m.count = 0; m.frustumCulled = false; m.castShadow = shadow; scene.add(m); return m; };
  const white = std({ color: 0xf6f6f3, roughness: 0.24, metalness: 0.04 });
  const parts = {
    body: mk(new RoundedBoxGeometry(0.34, 0.33, 0.26, 4, 0.12).translate(0, 0.275, 0), std({ color: 0xffffff, roughness: 0.55 }), max),
    head: mk(headGeo(), white, max),
    visor: mk(visorGeo(), std({ color: 0x10151e, roughness: 0.1, metalness: 0.35 }), max, false),
    eyes: mk(new RoundedBoxGeometry(0.05, 0.085, 0.02, 2, 0.022), new THREE.MeshBasicMaterial({ color: 0xa6f3ff, toneMapped: false }), max * 2, false),
    arms: mk(new THREE.CapsuleGeometry(0.047, 0.11, 4, 10).translate(0, -0.075, 0), std({ color: 0xffffff, roughness: 0.55 }), max * 2),
    hands: mk(new THREE.SphereGeometry(0.052, 12, 10), white, max * 2),
    feet: mk(new RoundedBoxGeometry(0.13, 0.08, 0.18, 2, 0.035).translate(0, 0.04, 0.025), std({ color: 0x2b3038, roughness: 0.6 }), max * 2),
    antenna: mk(mergeParts([new THREE.CylinderGeometry(0.014, 0.014, 0.13, 6).translate(0, 0.99, 0), new THREE.SphereGeometry(0.05, 12, 10).translate(0, 1.07, 0)]), std({ color: 0xf0c24a, roughness: 0.35, metalness: 0.3 }), max),
  };
  // the shirt badge, front and back: the shirt atlas with a per-instance tile offset (like the old chest plates)
  const off = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 2);
  const badgeGeo = new THREE.PlaneGeometry(0.2, 0.2); badgeGeo.setAttribute("aOff", off);
  const badgeMat = new THREE.MeshBasicMaterial({ map: shirtTex, transparent: true, toneMapped: false });
  badgeMat.onBeforeCompile = (sh) => { sh.vertexShader = "attribute vec2 aOff;\n" + sh.vertexShader.replace("#include <uv_vertex>", `#include <uv_vertex>\n  vMapUv = vMapUv / ${tiles.toFixed(1)} + aOff;`); };
  parts.badge = mk(badgeGeo, badgeMat, max * 2, false);

  const R = new THREE.Matrix4(), L = new THREE.Matrix4(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Color();
  const ONE = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0), XA = new THREE.Vector3(1, 0, 0);
  let n = 0, nAnt = 0;
  const ids = [], roots = [];
  const put = (mesh, i, local) => { M.multiplyMatrices(R, local); mesh.setMatrixAt(i, M); };
  const hash = (id) => { let h = 7; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return (h % 1000) / 1000; };

  const crowd = {
    parts, ids, roots,
    begin() { n = 0; nAnt = 0; ids.length = 0; roots.length = 0; },
    // d: the desk; x, y, z: their feet; heading: radians (0 faces +z); pose: { walk (phase, radians, or null),
    // type, sit, wave, s (scale) }; now: ms. Returns the root matrix (for wear) or null when full.
    add(d, x, y, z, heading, pose = {}, now = 0) {
      if (n >= max) return null;
      const s = pose.s || 1, walking = pose.walk != null, ph = pose.walk || 0, asleep = d.status === "paused";
      const bob = walking ? Math.abs(Math.sin(ph)) * 0.035 : pose.type ? Math.abs(Math.sin(now / 120)) * 0.012 : Math.sin(now / 900 + hash(d.id) * 6) * 0.006;
      R.compose(V.set(x, y + bob, z), Q.setFromAxisAngle(Y, heading), S.set(s, s, s));
      roots.push(R.clone()); ids.push(d.id);
      const col = asleep ? 0x8a8f99 : colourOf(d);
      put(parts.body, n, L.identity()); parts.body.setColorAt(n, C.set(col));
      put(parts.head, n, L.identity()); put(parts.visor, n, L.identity());
      // eyes: blink now and then; asleep they're thin closed lines a bit lower
      const blink = asleep ? 0.22 : ((now / 1000 + hash(d.id) * 5) % 4.2) < 0.12 ? 0.15 : 1;
      for (let k = 0; k < 2; k++) put(parts.eyes, n * 2 + k, L.compose(V.set((k ? 1 : -1) * 0.074, HEAD_Y + (asleep ? -0.015 : 0.01), EYE_Z), Q.identity(), S.set(1, blink, 1)));
      // arms and hands: swing when walking, reach forward to type, the right one up to wave
      for (let k = 0; k < 2; k++) {
        const side = k ? 1 : -1;
        if (pose.type) E.set(-1.15 + Math.sin(now / 85 + k * 2) * 0.12, 0, side * 0.12);
        else if (pose.wave && k === 1) E.set(0, 0, 2.55 + Math.sin(now / 110) * 0.35);
        else if (walking) E.set(Math.sin(ph) * 0.65 * side, 0, side * 0.1);
        else if (pose.sit) E.set(-0.5, 0, side * 0.12);
        else E.set(0, 0, side * 0.12);
        L.compose(V.set(side * SHOULDER[0], SHOULDER[1], 0), Q.setFromEuler(E), ONE); put(parts.arms, n * 2 + k, L);
        parts.arms.setColorAt(n * 2 + k, C.set(col).multiplyScalar(0.84));
        L.multiply(M.makeTranslation(0, -0.165, 0)); put(parts.hands, n * 2 + k, L);
      }
      // feet: stepping when walking; forward and dangling when sitting
      for (let k = 0; k < 2; k++) {
        const side = k ? 1 : -1, step = walking ? Math.sin(ph) * side : 0;
        L.compose(V.set(side * FOOT_X, pose.sit ? -0.05 : Math.max(0, step) * 0.045, pose.sit ? 0.13 : step * 0.075), Q.setFromAxisAngle(XA, pose.sit ? -0.5 : 0), ONE);
        put(parts.feet, n * 2 + k, L);
      }
      // the shirt badge on the chest and on the back
      const [u, v] = tileUV(d);
      put(parts.badge, n * 2, L.compose(V.set(0, 0.275, 0.1325), Q.identity(), ONE)); off.setXY(n * 2, u, v);
      put(parts.badge, n * 2 + 1, L.compose(V.set(0, 0.275, -0.1325), Q.setFromAxisAngle(Y, Math.PI), ONE)); off.setXY(n * 2 + 1, u, v);
      if (d.lead) put(parts.antenna, nAnt++, L.identity());
      n++;
      return roots[roots.length - 1];
    },
    end() {
      for (const [k, m] of Object.entries(parts)) {
        m.count = k === "antenna" ? nAnt : ["eyes", "arms", "hands", "feet", "badge"].includes(k) ? n * 2 : n;
        m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
      off.needsUpdate = true;
    },
    // The worker under a tap: a hit on a body or head, else the nearest within 26 px of the tap (they're small on a
    // phone). camera, ray, the pointer event and the canvas rect.
    pick(camera, ray, e, rect) {
      for (const m of [parts.body, parts.head]) m.boundingSphere = null;
      const hit = ray.intersectObjects([parts.body, parts.head], false)[0];
      if (hit && hit.instanceId != null && ids[hit.instanceId]) return ids[hit.instanceId];
      let best = null, bd = 26;
      roots.forEach((r, i) => {
        V.setFromMatrixPosition(r); V.y += 0.45; V.project(camera);
        const dd = Math.hypot((V.x + 1) / 2 * rect.width - (e.clientX - rect.left), (1 - V.y) / 2 * rect.height - (e.clientY - rect.top));
        if (dd < bd) { bd = dd; best = ids[i]; }
      });
      return best;
    },
  };
  return crowd;
}

// Smoothly turns o._hd toward the way o is moving (dx, dz per frame); keeps it when standing still.
export function steer(o, dx, dz, dt, fallback = Math.PI / 4) {
  if (o._hd === undefined) o._hd = fallback;
  if (Math.hypot(dx, dz) > 0.0008) {
    const want = Math.atan2(dx, dz);
    let da = want - o._hd; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    o._hd += da * (1 - Math.exp(-dt * 10));
  }
  return o._hd;
}
