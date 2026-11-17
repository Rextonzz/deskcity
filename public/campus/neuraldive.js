// Neural view: diving in and out (2026-11-14). the owner: "id like to be able to easy dive in and out".
// One stack of levels: Campus › 🕸 Web › a worker's job tree › a job › a session › a reply › a station (or sub-agent).
// In:  double-tap a node (or a worker on the web), pinch out, scroll up, Enter, or "⤵ Dive in" in the list.
//      The node zooms up to fill the view and becomes the centre.
// Out: pinch in, scroll down, Esc, "⤴ Out", or tap any step in the trail above the map. Out of the web = back to the
//      campus, zooming down to where the view was opened from.
// The zoom is a crossfade of two pictures: what was on screen, and the new level growing out of (or shrinking into)
// the node you went through. Reduced motion: no zoom, just the switch.
// Classic script, same global scope as the other campus parts (uses neural, neuralFind, neuralSubroot, neuralHit,
// neuralTap, neuralFeed, neuralMode, neuralWho, neuralClose, webHit, webTap, webPick, webName, esc, BRAIN_ST, NEURAL_ICON).
const DIVE_MS = 460;
const diveCalm = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// ---------- what can be dived into, and where a node sits ----------
function neuralCanDive(x) {
  const n = neural; if (!n || !x) return false;
  if (typeof x === "string") return n.mode === "web" ? x !== OWNER_ID() : neuralCanDive(neuralFind(n.tree.root, x));
  return x.children?.length > 0 && x.kind !== "step" && x.kind !== "more" && x.id !== neuralSubroot().id;
}
function neuralParentOf(id) {
  let hit = null;
  const walk = (x, parent) => { if (hit) return; if (x.id === id) { hit = parent || null; return; } x.children.forEach((c) => walk(c, x)); };
  walk(neural.tree.root, null);
  return hit;
}
// root to `id`, both included
function neuralChain(id) {
  const out = [];
  const walk = (x, trail) => { if (out.length) return; const t = [...trail, x]; if (x.id === id) { out.push(...t); return; } x.children.forEach((c) => walk(c, t)); };
  walk(neural.tree.root, []);
  return out;
}
function neuralCrumbLabel(x) {
  if (x.kind === "job") return `📌 ${x.desk === neural.desk ? "" : `${x.desk}: `}${x.label || "job"}`.slice(0, 40);
  if (x.kind === "station") { const s = BRAIN_ST.find((b) => b[0] === x.station); return s ? `${s[1]} ${s[2]}` : x.station; }
  return `${NEURAL_ICON[x.kind] || ""} ${x.label}`.trim();
}

// ---------- the trail above the map ----------
function neuralCrumbs() {
  const n = neural, el = document.getElementById("neuralCrumbs"); if (!n || !el) return;
  const items = [{ key: "campus", label: "🏙 Campus" }, { key: "web", label: "🕸 Web" }];
  if (n.mode === "tree" && n.tree) {
    items.push({ key: "tree", label: `${typeof webName === "function" ? webName(n.desk) : n.desk}'s work` });
    if (n.sub) neuralChain(n.sub).slice(1).forEach((x) => items.push({ key: `node:${x.id}`, label: neuralCrumbLabel(x) }));
  }
  const last = items.length - 1;
  el.innerHTML = `<button class="pill" data-crumb="out" title="Out one level (Esc, pinch in, scroll down)">⤴ Out</button>`
    + items.map((it, i) => `${i ? '<span class="sep">›</span>' : ""}${i === last ? `<span class="here" aria-current="location">${esc(it.label)}</span>` : `<button class="pill" data-crumb="${esc(it.key)}">${esc(it.label)}</button>`}`).join("");
  el.scrollLeft = el.scrollWidth;
}

// ---------- in and out ----------
// `target`: a node id in the tree, or a worker id on the web. `at`: the point on the canvas it grows from.
function neuralIn(target, at) {
  const n = neural; if (!n || !target) return; // a new dive cuts any zoom still playing short
  if (n.mode === "web") {
    if (target === OWNER_ID()) return;
    const p = at || n.wpos.find((q) => q.node.id === target);
    diveSnap("in", p);
    n.a = target; n.b = null; n.path = null;
    n.desk = target; n.job = null; n.tree = null; n.open.clear(); n.sel = null; n.first = true; n.seen.clear();
    neuralWho(target); neuralMode("tree", true);
    return;
  }
  const x = neuralFind(n.tree.root, target);
  if (!neuralCanDive(x)) return;
  const p = at || n.pos.find((q) => q.node.id === target);
  diveSnap("in", p);
  n.sub = x.id; n.sel = x.id; n.open.add(x.id);
  // open one level more inside, so there's something to see straight away
  if (x.children.length <= 12) x.children.forEach((c) => { if (c.children.length && c.kind !== "station") n.open.add(c.id); });
  neuralFeed();
}
function neuralOut() {
  const n = neural; if (!n) return;
  if (n.mode === "tree" && n.tree && n.sub) {
    const from = n.sub, parent = neuralParentOf(from);
    diveSnap("out", null, from);
    n.sub = parent && parent.id !== n.tree.root.id ? parent.id : null;
    n.sel = from;
    neuralFeed();
    return;
  }
  if (n.mode === "tree") {
    diveSnap("out", null, `web:${n.desk}`);
    n.a = n.desk; n.b = null; n.path = null;
    neuralMode("web", true);
    return;
  }
  neuralClose(); // out of the web: back to the campus (the overlay zooms down to where it was opened)
}
function neuralJump(key) {
  const n = neural; if (!n) return;
  if (key === "out") return neuralOut();
  if (key === "campus") return neuralClose();
  if (key === "web") { if (n.mode === "web") return; n.sub = null; return neuralOut(); }
  if (key === "tree") { if (!n.sub) return; diveSnap("out", null, n.sub); n.sel = neuralChain(n.sub)[1]?.id || n.sel; n.sub = null; return neuralFeed(); }
  if (key.startsWith("node:")) {
    const id = key.slice(5); if (id === n.sub) return;
    diveSnap("out", null, n.sub); // a crumb is always somewhere above where you are
    n.sel = n.sub; n.sub = id; neuralFeed();
  }
}

// ---------- the zoom: crossfade the old picture into the new one ----------
function diveSnap(dir, at, focusId = null) {
  const n = neural, c = document.getElementById("neuralC"); if (!n || !c || diveCalm()) return;
  const snap = document.createElement("canvas"); snap.width = c.width; snap.height = c.height;
  snap.getContext("2d").drawImage(c, 0, 0);
  n.anim = { dir, t0: performance.now(), snap, px: at?.x ?? c.clientWidth / 2, py: at?.y ?? c.clientHeight / 2, focusId };
}
function neuralDiveFrame() {
  const n = neural, a = n?.anim, c = document.getElementById("neuralC"); if (!a || !c) return;
  const f = Math.min(1, (performance.now() - a.t0) / DIVE_MS), e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
  if (f >= 1) { n.anim = null; return; }
  const dpr = c.width / Math.max(1, c.clientWidth), w = c.clientWidth, h = c.clientHeight;
  const live = (n.live ||= document.createElement("canvas"));
  if (live.width !== c.width || live.height !== c.height) { live.width = c.width; live.height = c.height; }
  const lg = live.getContext("2d"); lg.setTransform(1, 0, 0, 1, 0, 0); lg.clearRect(0, 0, live.width, live.height); lg.drawImage(c, 0, 0);
  const g = c.getContext("2d"); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
  // draw an image (CSS-pixel sized) so that point (ax, ay) of it lands at (bx, by), scaled by s
  const put = (img, s, ax, ay, bx, by, alpha) => { g.globalAlpha = Math.max(0, Math.min(1, alpha)); g.setTransform(dpr * s, 0, 0, dpr * s, dpr * (bx - ax * s), dpr * (by - ay * s)); g.drawImage(img, 0, 0, w, h); };
  if (a.dir === "in") {
    // the old level blows up around the node you went into; the new one grows out of it to fill the view
    put(a.snap, 1 + 2.4 * e, a.px, a.py, a.px, a.py, 1 - e * 1.5);
    put(live, 0.25 + 0.75 * e, w / 2, h / 2, a.px + (w / 2 - a.px) * e, a.py + (h / 2 - a.py) * e, e * 1.3);
  } else {
    // the level you leave shrinks back into its node in the parent level, which settles from big to normal
    const fp = a.focusId?.startsWith("web:") ? n.wpos?.find((q) => q.node.id === a.focusId.slice(4)) : n.pos?.find((q) => q.node.id === a.focusId);
    const qx = fp?.x ?? w / 2, qy = fp?.y ?? h / 2;
    put(live, 1 + 2.4 * (1 - e), qx, qy, qx, qy, e * 1.3);
    put(a.snap, 1 - 0.75 * e, w / 2, h / 2, w / 2 + (qx - w / 2) * e, h / 2 + (qy - h / 2) * e, 1 - e * 1.5);
  }
  g.globalAlpha = 1; g.setTransform(1, 0, 0, 1, 0, 0);
}

// ---------- input on the map: tap, double-tap, pinch, wheel ----------
function neuralDiveAttach(c) {
  const at = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const hit = (p) => (neural?.mode === "web" ? webHit(p.x, p.y) : neuralHit(p.x, p.y));
  // a single tap waits a moment to see whether it's a double-tap
  let pending = null, lastTap = null;
  c.addEventListener("click", (e) => {
    const n = neural; if (!n) return;
    const p = at(e), now = performance.now();
    if (lastTap && now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 28) {
      clearTimeout(pending); pending = null; lastTap = null;
      const h = hit(p); if (h) neuralIn(h.node.id, h);
      return;
    }
    lastTap = { ...p, t: now };
    clearTimeout(pending);
    pending = setTimeout(() => { pending = null; if (!neural) return; (neural.mode === "web" ? webTap : neuralTap)(p.x, p.y); }, 260);
  });
  // wheel / trackpad: up = in (at the pointer, else what's picked), down = out
  let acc = 0, quietUntil = 0;
  c.addEventListener("wheel", (e) => {
    if (!neural) return;
    e.preventDefault();
    const now = performance.now(); if (now < quietUntil) { acc = 0; return; }
    acc += e.deltaY * (e.deltaMode === 1 ? 30 : 1);
    if (Math.abs(acc) < 70) return;
    quietUntil = now + 600;
    if (acc < 0) { const h = hit(at(e)); const id = h?.node.id || (neural.mode === "web" ? neural.a : neural.sel); neuralIn(id, h || null); }
    else neuralOut();
    acc = 0;
  }, { passive: false });
  // pinch: fingers apart = in (at the middle of them), together = out; once per pinch
  let pinch = null;
  c.addEventListener("touchstart", (e) => { if (e.touches.length === 2) { const [a, b] = e.touches; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), done: false }; } }, { passive: true });
  c.addEventListener("touchmove", (e) => {
    if (!pinch || pinch.done || e.touches.length !== 2 || !neural) return;
    e.preventDefault();
    const [a, b] = e.touches, d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), k = d / Math.max(1, pinch.d);
    if (k > 1.35) { pinch.done = true; const p = at({ clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 }); const h = hit(p); neuralIn(h?.node.id || (neural.mode === "web" ? neural.a : neural.sel), h || p); }
    else if (k < 0.72) { pinch.done = true; neuralOut(); }
  }, { passive: false });
  c.addEventListener("touchend", (e) => { if (e.touches.length < 2) pinch = null; }, { passive: true });
}
// buttons in the trail and the lists
document.addEventListener("click", (e) => {
  const crumb = e.target.closest?.("[data-crumb]");
  if (crumb && neural) { e.preventDefault(); neuralJump(crumb.dataset.crumb); return; }
  const dive = e.target.closest?.("[data-dive]");
  if (dive && neural) { e.preventDefault(); neuralIn(dive.dataset.dive); }
});
