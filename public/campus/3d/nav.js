// Campus 3D: pathing (the owner 2026-11-13: "force pathing for people and cars to make sure they don't phase or move where
// they shouldn't"). A walkable grid (cells of `res` tiles) with A* routes. In the city it's built from the real streets,
// pavements, paths, plaza and bridges (cheap), lawns (allowed, dearer, so people keep to the paths), the river (never,
// except on a bridge), and every building and placed thing (blocked: trees, lamps, benches, planters, the fountain, the
// clock, parked cars, the bus stop, the bandstand...). Inside, each floor gets its own grid from the walls and furniture
// actually placed there. people.js and motion.js ask window.campusNav / window.floorNav for routes when they exist.
export class NavGrid {
  constructor(x0, z0, x1, z1, res = 0.35, base = 1) {
    this.res = res; this.x0 = x0; this.z0 = z0;
    this.nx = Math.max(1, Math.ceil((x1 - x0) / res)); this.nz = Math.max(1, Math.ceil((z1 - z0) / res));
    this.cost = new Float32Array(this.nx * this.nz).fill(base); // 0 = blocked
  }
  ix(x) { return Math.floor((x - this.x0) / this.res); }
  iz(z) { return Math.floor((z - this.z0) / this.res); }
  idx(i, j) { return i < 0 || j < 0 || i >= this.nx || j >= this.nz ? -1 : j * this.nx + i; }
  at(x, z) { const k = this.idx(this.ix(x), this.iz(z)); return k < 0 ? 0 : this.cost[k]; }
  blocked(x, z) { return this.at(x, z) === 0; }
  // fill a rectangle (x, z, w, d) with a cost, grown by m; mode "set" overwrites, "min" only lowers unblocked cells
  rect(x, z, w, d, c, m = 0, mode = "set") {
    const i0 = this.ix(x - m), i1 = this.ix(x + w + m), j0 = this.iz(z - m), j1 = this.iz(z + d + m);
    for (let j = Math.max(0, j0); j <= Math.min(this.nz - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++) {
      const k = j * this.nx + i;
      if (mode === "min") { if (this.cost[k] !== 0) this.cost[k] = Math.min(this.cost[k], c); } else this.cost[k] = c;
    }
  }
  circle(x, z, r, c = 0) {
    const i0 = this.ix(x - r), i1 = this.ix(x + r), j0 = this.iz(z - r), j1 = this.iz(z + r);
    for (let j = Math.max(0, j0); j <= Math.min(this.nz - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++) {
      const cx = this.x0 + (i + 0.5) * this.res, cz = this.z0 + (j + 0.5) * this.res;
      if ((cx - x) ** 2 + (cz - z) ** 2 <= (r + this.res * 0.5) ** 2) this.cost[j * this.nx + i] = c;
    }
  }
  // The nearest walkable point to (x, z), searching outward ring by ring (null if none within `max` tiles).
  nearestFree(x, z, max = 4) {
    const ci = this.ix(x), cj = this.iz(z), R = Math.ceil(max / this.res);
    const k0 = this.idx(ci, cj); if (k0 >= 0 && this.cost[k0] > 0) return [x, z];
    for (let r = 1; r <= R; r++) {
      let best = null, bd = Infinity;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const k = this.idx(ci + di, cj + dj); if (k < 0 || this.cost[k] === 0) continue;
        const px = this.x0 + (ci + di + 0.5) * this.res, pz = this.z0 + (cj + dj + 0.5) * this.res, d = (px - x) ** 2 + (pz - z) ** 2;
        if (d < bd) { bd = d; best = [px, pz]; }
      }
      if (best) return best;
    }
    return null;
  }
  // A* from a to b (points in tiles), 8-way, no corner cutting. Returns waypoints (smoothed by line of sight) or null.
  path(a, b, maxNodes = 60000) {
    const s = this.nearestFree(a[0], a[1]), t = this.nearestFree(b[0], b[1]); if (!s || !t) return null;
    const si = this.idx(this.ix(s[0]), this.iz(s[1])), ti = this.idx(this.ix(t[0]), this.iz(t[1]));
    if (si < 0 || ti < 0) return null;
    if (si === ti) return [t];
    const nx = this.nx, g = new Float32Array(this.cost.length).fill(Infinity), from = new Int32Array(this.cost.length).fill(-1), closed = new Uint8Array(this.cost.length);
    const tx = ti % nx, tz = (ti / nx) | 0, h = (k) => { const dx = Math.abs((k % nx) - tx), dz = Math.abs(((k / nx) | 0) - tz); return (Math.max(dx, dz) + 0.414 * Math.min(dx, dz)); };
    const heap = [], push = (k, f) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    g[si] = 0; push(si, h(si));
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let n = 0, found = false;
    while (heap.length && n++ < maxNodes) {
      const [, k] = pop(); if (closed[k]) continue; closed[k] = 1;
      if (k === ti) { found = true; break; }
      const i = k % nx, j = (k / nx) | 0;
      for (const [di, dj, w] of D) {
        const kk = this.idx(i + di, j + dj); if (kk < 0 || this.cost[kk] === 0 || closed[kk]) continue;
        if (di && dj && (this.cost[this.idx(i + di, j)] === 0 || this.cost[this.idx(i, j + dj)] === 0)) continue; // no corner cutting
        const ng = g[k] + w * (this.cost[k] + this.cost[kk]) / 2;
        if (ng < g[kk]) { g[kk] = ng; from[kk] = k; push(kk, ng + h(kk)); }
      }
    }
    if (!found) return null;
    const cells = []; for (let k = ti; k !== -1; k = from[k]) cells.push(k);
    cells.reverse();
    const pts = cells.map((k) => [this.x0 + ((k % nx) + 0.5) * this.res, this.z0 + (((k / nx) | 0) + 0.5) * this.res]);
    // smooth: keep a point only when the straight line past it would cross a blocked or dearer cell
    const out = [pts[0]];
    let anchor = 0;
    for (let i = 2; i < pts.length; i++) if (!this.clear(pts[anchor], pts[i], this.cost[cells[anchor]])) { out.push(pts[i - 1]); anchor = i - 1; }
    out.push(pts[pts.length - 1]);
    out[out.length - 1] = t;
    return out.slice(1).length ? out.slice(1) : [t];
  }
  // true when the segment a-b crosses no blocked cell and none dearer than `c` (so smoothing never cuts across a lawn).
  clear(a, b, c = 1) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L / (this.res * 0.5));
    for (let i = 0; i <= n; i++) { const v = this.at(a[0] + (b[0] - a[0]) * (i / n), a[1] + (b[1] - a[1]) * (i / n)); if (v === 0 || v > Math.max(c, 1) + 0.01) return false; }
    return true;
  }
}
// Pushes everyone out of blocked cells and a little apart from each other. list: objects with x, y (tiles).
export function settle(nav, list, gap = 0.36) {
  for (const p of list) {
    if (nav && nav.blocked(p.x, p.y)) { const f = nav.nearestFree(p.x, p.y, 3); if (f) { p.x = f[0]; p.y = f[1]; } }
  }
  for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
    const A = list[a], B = list[b], dx = B.x - A.x, dz = B.y - A.y, d = Math.hypot(dx, dz);
    if (d > 0.0001 && d < gap) {
      const k = (gap - d) / 2 / d;
      const ax = A.x - dx * k, az = A.y - dz * k, bx = B.x + dx * k, bz = B.y + dz * k;
      if (!nav || !nav.blocked(ax, az)) { A.x = ax; A.y = az; }
      if (!nav || !nav.blocked(bx, bz)) { B.x = bx; B.y = bz; }
    }
  }
}
