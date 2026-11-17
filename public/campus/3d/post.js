// Campus 3D: the "heavier PC" look (the owner 2026-11-09: "we can have a heavier pc option"). Off by default; the ✨
// button by the camera buttons turns it on and the choice is kept for this browser. One extra full-screen pass,
// written here (three r160's EffectComposer isn't vendored): the scene renders into a multisampled float target,
// then a single shader adds
//   - tilt-shift: the top and bottom of the picture blur a little, so the city reads as a miniature model,
//   - a soft glow round bright things (lit windows, lamps, the fountain, the Underground sign),
//   - a gentle warm grade and vignette.
// About 2-3 ms a frame on a desktop GPU. Phones never get it by default.
import * as THREE from "three";

const KEY = "campus3d.heavy";
const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = /* glsl */ `
uniform sampler2D tScene; uniform vec2 px; uniform float tilt; uniform float glow; uniform float focus; uniform float thr;
varying vec2 vUv;
const int N = 12;
const vec2 DISK[12] = vec2[12](vec2(-0.326,-0.406), vec2(-0.840,-0.074), vec2(-0.696,0.457), vec2(-0.203,0.621), vec2(0.962,-0.195), vec2(0.473,-0.480), vec2(0.519,0.767), vec2(0.185,-0.893), vec2(0.507,0.064), vec2(0.896,0.412), vec2(-0.322,-0.933), vec2(-0.792,-0.598));
void main() {
  vec4 base = texture2D(tScene, vUv);
  // tilt-shift: blur grows away from a band a little below the middle of the screen
  float d = abs(vUv.y - focus), r = smoothstep(0.16, 0.55, d) * tilt;
  vec3 col = base.rgb;
  if (r > 0.05) { vec3 acc = base.rgb; for (int i = 0; i < N; i++) acc += texture2D(tScene, vUv + DISK[i] * px * r).rgb; col = acc / float(N + 1); }
  // glow: a wide, sparse gather of what's brighter than the daylight walls
  vec3 g = vec3(0.0);
  for (int i = 0; i < N; i++) { vec3 s = texture2D(tScene, vUv + DISK[i] * px * 9.0).rgb; g += max(s - vec3(thr), 0.0); }
  for (int i = 0; i < N; i++) { vec3 s = texture2D(tScene, vUv + DISK[i].yx * px * 18.0).rgb; g += max(s - vec3(thr), 0.0) * 0.6; }
  col += g / float(N) * glow;
  // grade: a touch warmer and richer, then a soft vignette
  col = mix(col, col * vec3(1.03, 1.0, 0.97), 0.5);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722)); col = mix(vec3(l), col, 1.03);
  vec2 q = vUv - 0.5; col *= 1.0 - dot(q, q) * 0.38;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export function makePost(renderer) {
  let on = false;
  try { on = localStorage.getItem(KEY) === "1"; } catch {}
  const size = new THREE.Vector2();
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { tScene: { value: target.texture }, px: { value: new THREE.Vector2() }, tilt: { value: 2.4 }, glow: { value: 1.1 }, focus: { value: 0.46 }, thr: { value: 0.9 } } });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fit = () => {
    renderer.getDrawingBufferSize(size);
    if (target.width !== size.x || target.height !== size.y) target.setSize(size.x, size.y);
    mat.uniforms.px.value.set(1 / size.x, 1 / size.y);
  };
  return {
    get on() { return on; },
    set(v) { on = !!v; try { localStorage.setItem(KEY, on ? "1" : "0"); } catch {} },
    // inside a building the miniature blur would hide the desks, so it's lighter there
    render(sceneIn, camera, inside = false, night = 0) {
      if (!on) { renderer.render(sceneIn, camera); return; }
      fit();
      mat.uniforms.tilt.value = inside ? 0.8 : 2.4;
      // glow is for the evening: by day only the brightest highlights bloom, at night windows and lamps do
      mat.uniforms.glow.value = 0.25 + 1.1 * night; mat.uniforms.thr.value = 0.95 - 0.4 * night;
      renderer.setRenderTarget(target); renderer.render(sceneIn, camera);
      renderer.setRenderTarget(null); renderer.render(scene, cam);
    },
    dispose() { target.dispose(); mat.dispose(); quad.geometry.dispose(); },
  };
}
