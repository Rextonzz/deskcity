// Campus 3D: quality tiers. Caps the pixel ratio (2 on desktop, 1.5 on phones) and watches frame times; if frames
// stay slow it steps down one tier (lower pixel ratio, then no shadows) and remembers the tier for this device
// (localStorage, in try/catch). Brief section 3.
const KEY = "campus3d.tier";
export const isPhone = () => matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) < 700;

// Tiers, best first. dpr is a cap on devicePixelRatio.
const TIERS = [
  { name: "high", dpr: 2, shadows: true },
  { name: "medium", dpr: 1.5, shadows: true },
  { name: "low", dpr: 1.25, shadows: false },
  { name: "lowest", dpr: 1, shadows: false },
];

// renderer; onChange(tier) is called with the new tier (turn shadows off there). opts.slowMs: average frame time
// that counts as slow (22 ms per the brief); opts.window: frames averaged.
export function makeQuality(renderer, onChange = () => {}, { slowMs = 22, window = 90 } = {}) {
  const phone = isPhone();
  let tier = phone ? 1 : 0;
  try { const saved = Number(localStorage.getItem(KEY)); if (Number.isInteger(saved) && saved >= tier && saved < TIERS.length) tier = saved; } catch {}
  const apply = () => {
    const t = TIERS[tier];
    renderer.setPixelRatio(Math.min(window_dpr(), t.dpr));
    onChange(t);
  };
  const window_dpr = () => (typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
  let sum = 0, count = 0, last = 0, grace = 60;
  const q = {
    get tier() { return TIERS[tier]; },
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
          try { localStorage.setItem(KEY, String(tier)); } catch {}
          apply();
          grace = 60;
        }
      }
    },
    // Forget the remembered tier (for a "reset graphics" button later).
    reset() { try { localStorage.removeItem(KEY); } catch {} tier = phone ? 1 : 0; apply(); },
  };
  return q;
}
