// Campus 3D: the one light rig. setNight(n) blends day look A (cozy daylight, soft sun shadows, pale sky) into
// night look B (navy sky, dim blue moon, fog). Only the sun casts shadows, and the shadow map is frozen
// (renderer.shadowMap.autoUpdate = false): call refresh() after a rebuild or when the light moves.
// Brief: docs/design/campus-3d/brief.md section 4. Checked against three r160.
import * as THREE from "three";

// Visual rehaul 2026-11-13 (towers.app look, perspective camera): a warm low sun, haze that thickens toward the horizon
// (the fog is the haze colour, so the town and the sea melt into the sky), and a cooler sky fill.
const DAY = {
  sky: new THREE.Color(0xc9dcea), fog: new THREE.Color(0xdfe6e8), fogNear: 110, fogFar: 520,
  hemiSky: new THREE.Color(0xc4dcf2), hemiGround: new THREE.Color(0xc2ad8a), hemi: 0.9,
  sun: new THREE.Color(0xffdcae), sunI: 2.9,
};
const NIGHT = {
  sky: new THREE.Color(0x0e1830), fog: new THREE.Color(0x101a2e), fogNear: 90, fogFar: 330,
  hemiSky: new THREE.Color(0x3a4f80), hemiGround: new THREE.Color(0x141a26), hemi: 0.3,
  sun: new THREE.Color(0x6d84b8), sunI: 0.45,
};

// scene, renderer; opts: { phone } picks the shadow map size (1024 phone, 2048 desktop).
export function makeLights(scene, renderer, { phone = false } = {}) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemi);
  scene.add(hemi);

  // The sun by day, the moon by night: one directional light that changes colour.
  const sun = new THREE.DirectionalLight(DAY.sun, DAY.sunI);
  sun.castShadow = true;
  const size = phone ? 1024 : 2048;
  sun.shadow.mapSize.set(size, size);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  const skyCol = DAY.sky.clone();
  scene.background = skyCol.clone();
  scene.fog = new THREE.Fog(DAY.fog.clone(), DAY.fogNear, DAY.fogFar);

  const rig = {
    hemi, sun, night: 0, shadowsAllowed: true, sky: skyCol,
    // Fit the sun and its shadow camera tightly around the campus: centre (Vector3) and radius in tiles.
    fit(center, radius) {
      rig.center = center.clone(); rig.radius = radius;
      sun.target.position.copy(center);
      sun.position.copy(center).add(new THREE.Vector3(-radius * 0.55, radius * 0.95, radius * 0.75)); // from the south-west, low: long soft shadows toward the camera's left
      const cam = sun.shadow.camera;
      cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
      cam.near = 0.5; cam.far = radius * 5;
      cam.updateProjectionMatrix();
      sun.target.updateMatrixWorld();
      rig.refresh();
    },
    // Blend day (0) to night (1).
    setNight(n) {
      n = Math.min(1, Math.max(0, n));
      rig.night = n;
      const L = (a, b) => a + (b - a) * n;
      skyCol.copy(DAY.sky).lerp(NIGHT.sky, n);
      if (scene.background?.isColor) scene.background.copy(skyCol); // weather.js paints a sky texture from rig.sky
      scene.fog.color.copy(DAY.fog).lerp(NIGHT.fog, n);
      scene.fog.near = L(DAY.fogNear, NIGHT.fogNear); scene.fog.far = L(DAY.fogFar, NIGHT.fogFar);
      hemi.color.copy(DAY.hemiSky).lerp(NIGHT.hemiSky, n);
      hemi.groundColor.copy(DAY.hemiGround).lerp(NIGHT.hemiGround, n);
      hemi.intensity = L(DAY.hemi, NIGHT.hemi);
      sun.color.copy(DAY.sun).lerp(NIGHT.sun, n);
      sun.intensity = L(DAY.sunI, NIGHT.sunI);
      // Shadows only by day (the brief turns them off past 0.7).
      const want = rig.shadowsAllowed && n <= 0.7;
      if (sun.castShadow !== want) { sun.castShadow = want; rig.refresh(); }
    },
    // quality.js calls this to turn shadows off on slow devices.
    setShadows(on) { rig.shadowsAllowed = on; rig.setNight(rig.night); if (!on) sun.castShadow = false; rig.refresh(); },
    // The sky's colour for a night value (the sky follows the real night even when the lights are kept on inside).
    skyAt(n, out = new THREE.Color()) { return out.copy(DAY.sky).lerp(NIGHT.sky, Math.min(1, Math.max(0, n))); },
    // Re-render the frozen shadow map once, on the next frame.
    // (r160's shadow pass returns before clearing needsUpdate when no light casts shadows, so only ask then.)
    refresh() { renderer.shadowMap.needsUpdate = sun.castShadow; },
  };
  return rig;
}
