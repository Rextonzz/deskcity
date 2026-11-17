// Campus 3D: street lamps with no point lights (brief section 4). Four draw calls for any number of lamps:
// instanced posts, instanced emissive-looking bulbs (unlit), one Points object for the additive glows, and
// instanced ground light-pool discs. setNight(n) fades the glow in. Checked against three r160.
// The glows are Points rather than one Sprite per lamp (one draw call for all of them). With an orthographic
// camera PointsMaterial sizes are in pixels, so call update(camera, pixelRatio) after zooming.
import * as THREE from "three";
import { mergeParts } from "./buildings.js";
import { paint, COLORS, radialTexture } from "./materials.js";

const POST_H = 2.1;
const BULB_DAY = new THREE.Color(0xe9e4d6), BULB_NIGHT = new THREE.Color(0xfff0c2);

// positions: [{ x, z, ry? }] in tiles (ry turns the arm, radians). Returns { group, setNight, update, dispose }.
export function makeLamps(positions) {
  const n = positions.length;
  const group = new THREE.Group();
  group.name = "lamps";

  // The post: a pole, a little base and an arm reaching out over the street (+X before rotation).
  const pole = new THREE.CylinderGeometry(0.045, 0.06, POST_H, 6); pole.translate(0, POST_H / 2, 0);
  const base = new THREE.CylinderGeometry(0.11, 0.13, 0.16, 6); base.translate(0, 0.08, 0);
  const arm = new THREE.BoxGeometry(0.42, 0.05, 0.05); arm.translate(0.19, POST_H - 0.04, 0);
  const shade = new THREE.ConeGeometry(0.13, 0.12, 6, 1, true); shade.translate(0.38, POST_H - 0.07, 0);
  const postGeo = mergeParts([pole, base, arm, shade].map((g) => paint(g, COLORS.metal)));
  const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), n);
  posts.castShadow = true;

  const bulbGeo = new THREE.SphereGeometry(0.075, 8, 6);
  const bulbMat = new THREE.MeshBasicMaterial({ color: BULB_DAY.clone() });
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, n);

  const poolGeo = new THREE.CircleGeometry(1.25, 20); poolGeo.rotateX(-Math.PI / 2);
  const poolMat = new THREE.MeshBasicMaterial({ map: radialTexture("rgba(255,214,140,0.85)", "rgba(255,200,120,0)"), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, n);
  pools.renderOrder = 1;

  const glowPos = new Float32Array(n * 3);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  positions.forEach((pos, i) => {
    const ry = pos.ry || 0;
    q.setFromEuler(e.set(0, ry, 0));
    posts.setMatrixAt(i, m.compose(p.set(pos.x, 0, pos.z), q, one));
    // The bulb hangs under the shade at the end of the arm.
    const bx = pos.x + Math.cos(ry) * 0.38, bz = pos.z - Math.sin(ry) * 0.38;
    bulbs.setMatrixAt(i, m.makeTranslation(bx, POST_H - 0.14, bz));
    pools.setMatrixAt(i, m.makeTranslation(bx, 0.02, bz));
    glowPos.set([bx, POST_H - 0.14, bz], i * 3);
  });
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute("position", new THREE.BufferAttribute(glowPos, 3));
  const glowMat = new THREE.PointsMaterial({ map: radialTexture("rgba(255,226,160,0.95)", "rgba(255,190,110,0)"), size: 40, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const glows = new THREE.Points(glowGeo, glowMat);
  glows.renderOrder = 2;

  group.add(posts, bulbs, pools, glows);
  let night = 0, glowWorld = 1.1; // glow diameter in tiles
  return {
    group,
    setNight(v) {
      night = Math.min(1, Math.max(0, v));
      bulbMat.color.copy(BULB_DAY).lerp(BULB_NIGHT, night);
      // Lamps come on at dusk, not at the first hint of evening.
      const on = Math.min(1, Math.max(0, (night - 0.25) / 0.5));
      poolMat.opacity = on * 0.75;
      glowMat.opacity = on;
      pools.visible = glows.visible = on > 0.01;
    },
    // Keep the pixel-sized glow the same size in the world as the orthographic camera zooms.
    update(camera, pixelRatio = 1) {
      // a perspective camera shrinks the glows with distance by itself: size in world units
      if (!camera.isOrthographicCamera) { const s = glowWorld / Math.tan((camera.fov * Math.PI) / 360); if (!glowMat.sizeAttenuation || glowMat.size !== s) { glowMat.sizeAttenuation = true; glowMat.size = s; glowMat.needsUpdate = true; } return; }
      const worldPerPx = (camera.top - camera.bottom) / camera.zoom / (camera.userData.viewHeight || 800);
      glowMat.size = (glowWorld / worldPerPx) * pixelRatio;
    },
    dispose() { for (const o of [posts, bulbs, pools]) { o.geometry.dispose(); o.dispose(); } glowGeo.dispose(); glowMat.map.dispose(); poolMat.map.dispose(); },
  };
}
