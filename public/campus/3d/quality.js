// Campus 3D: quality tiers. Caps the pixel ratio (2 on desktop, 1.5 on phones) and watches frame times; if frames
// stay slow it steps down one tier (lower pixel ratio, then no shadows) and remembers the tier for this device
// (localStorage, in try/catch). Brief section 3. The saved tier is kept with the graphics chip's name: a different
// chip (a new card, or Chrome's graphics acceleration turned back on after drawing in software) starts fresh.
const KEY = "campus3d.tier";
export const isPhone = () => matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) < 700;

// Tiers, best first. dpr is a cap on devicePixelRatio.
// effects: the City life effects (public/campus/citylife.js) each level still runs. The auto step-down on a slow PC
// drops the heavier ones first: bridge traffic and the diner at "low", the power lines, sunbeam and commute at "lowest".
// Lane L2: the barge, crane and blimp stop at "low"; the docks, library, tubes and balloons at "lowest"; the weather routines
// run at every level (they only make the city quieter; the umbrellas are one draw).
const TIERS = [
  { name: "high", dpr: 2, shadows: true, effects: ["grid", "cones", "vans", "night", "commute", "sun", "diner", "docks", "barge", "library", "tubes", "crane", "balloons", "blimp", "weather"] },
  { name: "medium", dpr: 1.5, shadows: true, effects: ["grid", "cones", "vans", "night", "commute", "sun", "diner", "docks", "barge", "library", "tubes", "crane", "balloons", "blimp", "weather"] },
  { name: "low", dpr: 1.25, shadows: false, effects: ["grid", "cones", "night", "commute", "sun", "docks", "library", "tubes", "balloons", "weather"] },
  { name: "lowest", dpr: 1, shadows: false, effects: ["cones", "night", "weather"] },
];

// renderer; onChange(tier) is called with the new tier (turn shadows off there). opts.slowMs: average frame time
// that counts as slow (22 ms per the brief); opts.window: frames averaged.
export function makeQuality(renderer, onChange = () => {}, { slowMs = 22, window = 90 } = {}) {
  const phone = isPhone();
  let tier = phone ? 1 : 0;
  let gpu = "";
  try { const gl = renderer.getContext(), ext = gl.getExtension("WEBGL_debug_renderer_info"); gpu = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || ""); } catch {}
  const save = () => { try { localStorage.setItem(KEY, String(tier)); localStorage.setItem(KEY + ".gpu", gpu); } catch {} };
  try {
    const saved = Number(localStorage.getItem(KEY)), on = localStorage.getItem(KEY + ".gpu");
    if (on === gpu && Number.isInteger(saved) && saved >= tier && saved < TIERS.length) tier = saved;
  } catch {}
  const apply = () => {
    const t = TIERS[tier];
    renderer.setPixelRatio(Math.min(window_dpr(), t.dpr));
    onChange(t);
  };
  const window_dpr = () => (typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
  let sum = 0, count = 0, last = 0, grace = 60;
  const q = {
    get tier() { return TIERS[tier]; },
    gpu, // the graphics chip's name ("Microsoft Basic Render Driver" or "SwiftShader" = drawing in software)
    apply,
    // Call once per rendered frame with performance.now(). Ignores hidden-tab gaps and the first frames.
    frame(now) {
      const dt = last ? now - last : 0; last = now;
      if (grace > 0) { grace--; return; }
      if (dt <= 0 || dt > 250) return;
      sum += dt; count++;
      if (count >= window) {
        const avg = sum / count; sum = 0; count = 0;
        if (avg > slowMs && tier < TIERS.length - 1) {
          tier++;
          save();
          apply();
          grace = 60;
        }
      }
    },
    // Forget the remembered tier (for a "reset graphics" button later).
    reset() { try { localStorage.removeItem(KEY); localStorage.removeItem(KEY + ".gpu"); } catch {} tier = phone ? 1 : 0; apply(); },
  };
  return q;
}
