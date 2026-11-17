// Campus 3D: the pet, the owner's cat and the campus CEO. Built ONLY from primitives (capsule body, sphere head, cone
// ears, a capsule-chain tail that sways in update(t)), toon grey. Never imported models, images or AI art; never
// shown as locked, paused, staffed or costed (another project docs/design/the pet-rules.md). No project, no pick box
// that leads to a panel: userData only says who he is.
// Draw calls: 1 merged body + 1 per tail segment (4), plus up to 5 heart sprites while he's being petted. Checked against three r160.
import * as THREE from "three";
import { mergeParts } from "./buildings.js";
import { paint, mats } from "./materials.js";

const GREY = new THREE.Color(0x9a9ea6), GREY_DARK = new THREE.Color(0x7d828b), PINK = new THREE.Color(0xe8a0a8), EYE = new THREE.Color(0x2b2f36), WHITE = new THREE.Color(0xe9e9ec);

// About 0.9 tiles long, so he reads at campus zoom. Faces +X; the group's origin is between his paws.
export function makePet() {
  const parts = [];
  const add = (geo, color, x, y, z, rx = 0, ry = 0, rz = 0) => {
    geo.rotateX(rx); geo.rotateY(ry); geo.rotateZ(rz); geo.translate(x, y, z); parts.push(paint(geo, color));
  };
  // Body: a capsule lying along X.
  add(new THREE.CapsuleGeometry(0.17, 0.36, 4, 10), GREY, 0, 0.3, 0, 0, 0, Math.PI / 2);
  // Chest patch.
  add(new THREE.SphereGeometry(0.12, 10, 8), WHITE, 0.22, 0.27, 0);
  // Legs: four short capsules.
  for (const [lx, lz] of [[0.2, 0.09], [0.2, -0.09], [-0.2, 0.09], [-0.2, -0.09]]) add(new THREE.CapsuleGeometry(0.05, 0.12, 3, 6), GREY_DARK, lx, 0.1, lz);
  // Head.
  add(new THREE.SphereGeometry(0.16, 12, 10), GREY, 0.38, 0.5, 0);
  // Ears: cones, a little pink inside.
  for (const ez of [0.08, -0.08]) {
    add(new THREE.ConeGeometry(0.06, 0.13, 4), GREY_DARK, 0.36, 0.67, ez, 0, Math.PI / 4, 0);
    add(new THREE.ConeGeometry(0.035, 0.08, 4), PINK, 0.385, 0.655, ez, 0, Math.PI / 4, 0);
  }
  // Eyes and nose.
  for (const ez of [0.06, -0.06]) add(new THREE.SphereGeometry(0.028, 6, 5), EYE, 0.52, 0.53, ez);
  add(new THREE.SphereGeometry(0.022, 6, 5), PINK, 0.545, 0.47, 0);

  const rex = new THREE.Group();
  rex.name = "pet";
  // who it is comes from the hub settings (campus/core.js PET()), read when asked: the settings may arrive after this is built
  rex.userData = { pet: true, get name() { return typeof PET === "function" ? PET() : ""; }, get title() { return (typeof HUB !== "undefined" && HUB.pet?.role) || "CEO"; } };
  const body = new THREE.Mesh(mergeParts(parts), mats.toonPainted());
  body.castShadow = true;
  rex.add(body);

  // Tail: a chain of short capsules, each segment a child of the one before, so a small sway per joint adds up
  // to a curl at the tip.
  const segGeo = new THREE.CapsuleGeometry(0.035, 0.12, 3, 6);
  segGeo.translate(0, 0.08, 0);
  const tailMat = mats.toon(0x8f939b);
  const joints = [];
  let parent = rex;
  for (let i = 0; i < 4; i++) {
    const j = new THREE.Group();
    if (i === 0) { j.position.set(-0.34, 0.36, 0); j.rotation.z = 0.9; } else j.position.y = 0.16;
    const seg = new THREE.Mesh(segGeo, tailMat);
    seg.castShadow = i < 2;
    j.add(seg);
    parent.add(j);
    joints.push(j);
    parent = j;
  }

  // Petting (the owner 2026-11-09, "pet the pet"): a tap makes him lean into it with a head bump, tail straight up (a happy
  // cat), a purr, and a few hearts floating up. All code-drawn: the hearts are a heart shape painted on a canvas.
  const hcv = document.createElement("canvas"); hcv.width = hcv.height = 64;
  const hg = hcv.getContext("2d"); hg.fillStyle = "#ff6b8a"; hg.beginPath(); hg.moveTo(32, 54);
  hg.bezierCurveTo(4, 34, 8, 8, 32, 22); hg.bezierCurveTo(56, 8, 60, 34, 32, 54); hg.fill();
  const heartMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(hcv), transparent: true, depthWrite: false });
  const hearts = Array.from({ length: 5 }, (_, i) => { const h = new THREE.Sprite(heartMat.clone()); h.visible = false; h.userData.dx = (i - 2) * 0.09; rex.add(h); return h; });
  let petAt = -99;
  rex.pet = (t) => { petAt = t; purr(); };
  rex.petting = (t) => t - petAt < 2.6;

  // t in seconds. A lazy sway, plus a slow head bob, so he looks alive while sitting about.
  rex.update = (t) => {
    const k = Math.max(0, 1 - (t - petAt) / 2.6), happy = k > 0 ? Math.sin(Math.min(1, (1 - k) * 6) * Math.PI / 2) * Math.min(1, k * 3) : 0;
    joints.forEach((j, i) => {
      j.rotation.x = Math.sin(t * (2.1 + happy * 3) - i * 0.7) * (0.18 + i * 0.08) * (1 - happy * 0.7);
      if (i > 0) j.rotation.z = (-0.25 + Math.sin(t * 1.3 - i) * 0.08) * (1 - happy) + happy * 0.04;
      else j.rotation.z = 0.9 + happy * 0.6; // tail up
    });
    body.position.y = Math.sin(t * 1.7) * 0.006 + happy * Math.abs(Math.sin(t * 9)) * 0.02;
    body.rotation.z = happy * (0.12 + Math.sin(t * 7) * 0.06); // head bump: nose up into the hand
    hearts.forEach((h, i) => {
      const a = (t - petAt) - i * 0.25;
      h.visible = a > 0 && a < 1.6;
      if (!h.visible) return;
      h.position.set(0.4 + h.userData.dx + Math.sin(a * 5 + i) * 0.04, 0.8 + a * 0.5, Math.cos(i * 2.1) * 0.12);
      h.scale.setScalar(0.14 + a * 0.04); h.material.opacity = Math.min(1, (1.6 - a) * 1.5);
    });
  };
  rex.dispose = () => { body.geometry.dispose(); segGeo.dispose(); heartMat.map.dispose(); };
  return rex;
}

// A soft purr: low noise pulsing about 25 times a second for 1.6 s, quiet. Made on the fly (no sound files).
let actx = null;
function purr() {
  try {
    actx ??= new (window.AudioContext || window.webkitAudioContext)();
    const len = actx.sampleRate * 1.6, buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { b = (b + 0.04 * (Math.random() * 2 - 1)) / 1.04; const s = i / actx.sampleRate; d[i] = b * 6 * (0.55 + 0.45 * Math.sin(s * 2 * Math.PI * 25)) * Math.min(1, s * 4, (1.6 - s) * 3); }
    const src = actx.createBufferSource(), lp = actx.createBiquadFilter(), g = actx.createGain();
    lp.type = "lowpass"; lp.frequency.value = 260; g.gain.value = 0.35;
    src.buffer = buf; src.connect(lp).connect(g).connect(actx.destination); src.start();
  } catch {}
}
