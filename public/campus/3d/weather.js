// Campus 3D: weather and the sky, the same set-up as the 2D campus (ambience.js): the real the owner's town weather from
// Open-Meteo (the global `weather.kind`: clear, cloudy, fog, rain, snow) and the clock's `night` (0 day .. 1 night,
// dawn and dusk fading over two hours). the owner 2026-11-09: "add weather/day/night same set up as 2d for atmosphere".
// - Sky: a screen-space gradient painted on a canvas (scene.background), warm at dawn and dusk, with twinkling stars
//   at night. Repainted only when the light changes (about once a minute) or for the twinkle at night (4 fps).
// - Rain: falling streaks; snow: drifting flakes. Both live in a box that follows the camera's target, so the view
//   always has weather in it without filling the whole map. One draw each.
// - Clouds: soft shadows drifting over the ground when it's cloudy, raining or snowing. Fog: thicker scene fog.
// Checked against three r160.
import * as THREE from "three";
import { radialTexture, canvasTexture } from "./materials.js";

const BOX = { x: 90, y: 26, z: 90 };
const DEEP = new THREE.Color(0x6f9fd0), HAZE = new THREE.Color(0xe4e9ea);

export function makeWeather(scene) {
  // ---- sky ----
  const { g, tex: sky } = canvasTexture(256);
  const stars = Array.from({ length: 90 }, () => [Math.random(), Math.random() * 0.6, Math.random() * 1.1 + 0.4, Math.random() * 6]);
  const top = new THREE.Color(), bottom = new THREE.Color(), warm = new THREE.Color(0xf2a36b), grey = new THREE.Color(0x9aa6b4);
  let lastKey = "";
  function paintSky(base, night, kind, t) {
    // dusk: strongest at night 0.5, the lower sky glows orange
    const dusk = Math.max(0, 1 - Math.abs(night - 0.5) * 2.2) * (kind === "clear" || kind === "cloudy" ? 1 : 0.4);
    // a deeper blue overhead fading to the pale haze at the horizon (the fog's colour), by day; navy at night
    top.copy(base).lerp(DEEP, 0.6 * (1 - night)).multiplyScalar(0.85 + 0.15 * (1 - night));
    bottom.copy(base).lerp(HAZE, 0.75 * (1 - night)).lerp(warm, dusk * 0.75);
    if (kind !== "clear") { top.lerp(grey, 0.35 * (1 - night)); bottom.lerp(grey, 0.3 * (1 - night)); }
    const tw = night > 0.25 ? Math.floor(t / 250) : 0, key = `${top.getHexString()}${bottom.getHexString()}${tw}`;
    if (key === lastKey) return;
    lastKey = key;
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, `#${top.getHexString()}`); gr.addColorStop(0.55, `#${top.clone().lerp(bottom, 0.6).getHexString()}`); gr.addColorStop(1, `#${bottom.getHexString()}`);
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    if (night > 0.25 && (kind === "clear" || kind === "cloudy")) for (const [fx, fy, r, ph] of stars) {
      g.fillStyle = `rgba(255,248,230,${(0.35 + 0.35 * Math.sin(t / 900 + ph)) * night * (kind === "cloudy" ? 0.4 : 1)})`;
      g.beginPath(); g.arc(fx * 256, fy * 256, r * 0.7, 0, Math.PI * 2); g.fill();
    }
    sky.needsUpdate = true;
  }
  scene.background = sky;

  // ---- rain ----
  const NR = 1800, rainPos = new Float32Array(NR * 6), rainSeed = new Float32Array(NR * 3);
  for (let i = 0; i < NR; i++) { rainSeed[i * 3] = Math.random(); rainSeed[i * 3 + 1] = Math.random(); rainSeed[i * 3 + 2] = Math.random(); }
  const rain = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(rainPos, 3)),
    new THREE.LineBasicMaterial({ color: 0x5f7fa8, transparent: true, opacity: 0.6, depthWrite: false }));
  const rainDay = new THREE.Color(0x5f7fa8), rainNight = new THREE.Color(0xc4dcf5);
  rain.frustumCulled = false; rain.visible = false; scene.add(rain);
  // ---- snow ----
  const NS = 1100, snowPos = new Float32Array(NS * 3), snowSeed = new Float32Array(NS * 4);
  for (let i = 0; i < NS; i++) for (let k = 0; k < 4; k++) snowSeed[i * 4 + k] = Math.random();
  // Soft round flakes (a square point looked like confetti; the owner 2026-11-11: "the weather in 3D is f'd"). Two layers
  // share the positions: every flake small, every third one drawn again bigger, so they read as near and far.
  const flake = radialTexture("rgba(255,255,255,1)", "rgba(255,255,255,0)");
  const snowGeo = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(snowPos, 3));
  const snow = new THREE.Group();
  const small = new THREE.Points(snowGeo, new THREE.PointsMaterial({ map: flake, color: 0xffffff, size: 4, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false }));
  const bigGeo = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(snowPos, 3)); bigGeo.setDrawRange(0, Math.floor(NS / 3));
  const big = new THREE.Points(bigGeo, new THREE.PointsMaterial({ map: flake, color: 0xffffff, size: 8, sizeAttenuation: false, transparent: true, opacity: 0.75, depthWrite: false }));
  small.frustumCulled = big.frustumCulled = false; snow.add(small, big);
  snow.visible = false; scene.add(snow);
  // ---- clouds ----
  // Clouds are shown as soft shadows drifting over the ground. The first version floated white puffs between the
  // camera and the city, which from this high angle just smeared white blobs across the buildings.
  const clouds = new THREE.Group(); clouds.visible = false; scene.add(clouds);
  const shadeMat = new THREE.MeshBasicMaterial({ map: radialTexture("rgba(18,28,48,0.55)", "rgba(18,28,48,0)"), transparent: true, opacity: 0.5, depthWrite: false, depthTest: false, toneMapped: false }); // no depth test: a cloud's shadow falls on roofs and walls too, and it can never fight with the ground
  const shadeGeo = new THREE.PlaneGeometry(1, 1); shadeGeo.rotateX(-Math.PI / 2);
  for (let c = 0; c < 6; c++) {
    const cl = new THREE.Mesh(shadeGeo, shadeMat);
    cl.scale.set(16 + Math.random() * 12, 1, 11 + Math.random() * 8); cl.rotation.y = Math.random() * Math.PI; cl.renderOrder = 4;
    cl.userData = { ox: Math.random() * BOX.x - BOX.x / 2, oz: Math.random() * BOX.z - BOX.z / 2, v: 0.5 + Math.random() * 0.5 };
    clouds.add(cl);
  }

  return {
    sky, clouds,
    // dt seconds, now ms, center: Vector3 the camera looks at, base: THREE.Color of the sky from lights.js; indoors
    // (inside a building) keeps the sky but no rain, snow or clouds.
    update(dt, now, center, base, indoors = false) {
      const kind = (typeof weather !== "undefined" && weather?.kind) || "clear";
      const n = typeof night === "number" ? night : 0;
      paintSky(base, n, kind, now);
      const t = now / 1000;
      rain.visible = !indoors && kind === "rain"; snow.visible = !indoors && kind === "snow";
      clouds.visible = !indoors && (kind === "cloudy" || kind === "rain" || kind === "snow");
      if (rain.visible) {
        rain.material.color.copy(rainDay).lerp(rainNight, n);
        for (let i = 0; i < NR; i++) {
          const fall = ((rainSeed[i * 3 + 2] + t * 1.1) % 1);
          const x = center.x + (rainSeed[i * 3] - 0.5) * BOX.x, z = center.z + (rainSeed[i * 3 + 1] - 0.5) * BOX.z, y = BOX.y * (1 - fall);
          rainPos.set([x, y, z, x - 0.2, y - 1.5, z - 0.1], i * 6);
        }
        rain.geometry.attributes.position.needsUpdate = true;
      }
      if (snow.visible) {
        for (let i = 0; i < NS; i++) {
          const fall = ((snowSeed[i * 4 + 2] + t * 0.08 * (0.6 + snowSeed[i * 4 + 3])) % 1), sway = Math.sin(t * 0.8 + snowSeed[i * 4 + 3] * 6) * 0.6;
          snowPos[i * 3] = center.x + (snowSeed[i * 4] - 0.5) * BOX.x + sway; snowPos[i * 3 + 1] = BOX.y * (1 - fall); snowPos[i * 3 + 2] = center.z + (snowSeed[i * 4 + 1] - 0.5) * BOX.z;
        }
        snowGeo.attributes.position.needsUpdate = true; bigGeo.attributes.position.needsUpdate = true;
      }
      if (clouds.visible) {
        shadeMat.opacity = (kind === "cloudy" ? 0.4 : 0.55) * (1 - n * 0.7); // lighter by night, when there's little light to block
        for (const cl of clouds.children) {
          const u = cl.userData, x = ((u.ox + t * u.v + BOX.x / 2) % BOX.x + BOX.x) % BOX.x - BOX.x / 2;
          cl.position.set(center.x + x, 0.09, center.z + u.oz);
        }
      }
      void dt;
    },
  };
}
