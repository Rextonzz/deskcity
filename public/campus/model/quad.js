// The quad layout (Option B, "Quad and wings", the owner picked it 2026-11-16; docs/design/campus-layout/review.md). Pure
// rules, no DOM. Works as a classic <script> (sets globalThis.campusQuad, loaded by campus/boot.js before core.js runs
// its layout) and when imported by Node (test/campus/quad.test.mjs).
//
// One connected campus round a central quad, north up (model x east, y south):
//   - the north range: the CEO tower in the middle, Leisure joined to its west wall, the Campus Mart to its east wall;
//   - the quad: a paved square with the fountain near its top, the clock tower east of it, the Underground stairs west;
//   - a covered concourse (a roofed walk) all round the quad; every building's door opens onto it;
//   - the wings: each district's buildings stood wall to wall down the quad's west or east side (a seam of 0.3 between
//     them), doors facing the quad; districts in order of desks, each to the side with fewer buildings so far; six
//     buildings a row, then a back row behind the front one, joined to it by short skybridges;
//   - the south end: the community garden behind the quad's south walk, then ONE long Residences block whose front
//     (balconies, lobby) faces the garden and the quad; the concourse runs on down both sides of the garden to the
//     block, and a covered walk crosses the garden to the lobby door;
//   - the ring road round it all (the tram and the vans), and the river behind the homes as scenery (no bridges).
// Every project keeps its own building (and its tap target): wings are made by placing buildings side by side.
(function () {
  const DEF = {
    CW: 1.6,        // concourse width
    SEAM: 0.3,      // between buildings in a wing (wall to wall)
    QUAD_W: 17,     // the quad's least size (inside the concourse)
    QUAD_L: 14,
    PER_ROW: 6,     // buildings a row on one side
    BACK_GAP: 1.4,  // between a wing's rows (bridged)
    WALK: 1.6,      // the covered walk across the garden
    GARDEN_D: 5,    // the garden strip's least depth
    RING: 1.4,      // between the outermost thing and the ring road
    STREET: 3,      // ring road width
    RIVER: 3.6, RIVER_GAP: 2.5,
    SQ_R: 5,        // the fountain square's radius (as plan B+C)
    BG_W: 7, BG_MAXW: 9, BG_D: 5, // the break garden (the gardens lane): least and most width, depth
  };
  const r2 = (v) => Math.round(v * 1000) / 1000;
  const box = (x, y, w, d) => ({ x: r2(x), y: r2(y), w: r2(w), d: r2(d) });

  // input: {
  //   wings: [{ name, lots: [{ id, w, d, floors, desks }] }]   // a district's buildings and tower slots, in its order
  //   ceo: { id, w, d }, west: [{ id, w, d }], east: [{ id, w, d }]   // the north range (Leisure west, Mart east)
  //   garden: { w, d } | null, homes: { w, d } | null, ug: { w, d } | null
  // }
  function plan(input, opts = {}) {
    const O = { ...DEF, ...opts }, CW = O.CW;
    const wings = (input.wings || []).filter((w) => w.lots && w.lots.length);
    const deskSum = (w) => w.lots.reduce((a, l) => a + (l.desks || 0), 0);
    // districts in order of desks (then buildings, then name); each to the side with fewer buildings so far (west on a tie)
    const order = [...wings].sort((a, b) => deskSum(b) - deskSum(a) || b.lots.length - a.lots.length || String(a.name).localeCompare(String(b.name)));
    // Districts stay on their side (input.prevSides: { name: "W" | "E" } from the last layout) while the sides stay
    // within 3 buildings of each other, so a desk more or less never swaps the wings round.
    const pick = (keep) => {
      const n = { W: 0, E: 0 }, side = {};
      for (const w of order) { const p = keep && keep[w.name]; const s = p === "W" || p === "E" ? p : n.W <= n.E ? "W" : "E"; side[w.name] = s; n[s] += w.lots.length; }
      return { side, n };
    };
    let chosen = pick(input.prevSides);
    if (input.prevSides && Math.abs(chosen.n.W - chosen.n.E) > 3) chosen = pick(null);
    const sides = { W: [], E: [] };
    for (const w of order) for (const l of w.lots) sides[chosen.side[w.name]].push({ ...l, district: w.name });
    // rows of PER_ROW, front first
    const rowsOf = (list) => { const out = []; for (let i = 0; i < list.length; i += O.PER_ROW) out.push(list.slice(i, i + O.PER_ROW)); return out; };
    const rows = { W: rowsOf(sides.W), E: rowsOf(sides.E) };
    const rowLen = (row) => row.reduce((a, l) => a + l.d, 0) + O.SEAM * Math.max(0, row.length - 1);
    const rowDepth = (row) => Math.max(0, ...row.map((l) => l.w));
    // the quad: long enough for the longest row, wide enough for the north range and the garden's two halves
    const north = [...(input.west || []), ...(input.ceo ? [input.ceo] : []), ...(input.east || [])];
    const rangeW = north.reduce((a, l) => a + l.w, 0);
    const garden = input.garden || null, homes = input.homes || null;
    // (and, on the side with the shorter last row, room for one empty lot: the next project's place)
    const open = ["W", "E"].map((s) => rows[s].at(-1)).filter((r) => r && r.length < O.PER_ROW).map((r) => rowLen(r) + O.SEAM + 5.5);
    const L = Math.max(O.QUAD_L, ...[...rows.W, ...rows.E].map(rowLen), open.length ? Math.min(...open) : 0);
    const QW = Math.max(O.QUAD_W, rangeW - 2 * CW, garden ? 2 * (garden.w + 1.2) + O.WALK : 0);
    // frame: the quad's top-left is (0, 0); everything is shifted at the end so the complex starts at (0, 0)
    const qx0 = 0, qy0 = 0, qx1 = QW, qy1 = L, mid = QW / 2;
    const place = {}, lots = [];
    const put = (l, x, y, face, extra = {}) => { place[l.id] = { x: r2(x), y: r2(y), face, ...extra }; lots.push({ id: l.id, x, y, w: l.w, d: l.d, kind: extra.kind || "lot", district: l.district || null }); };
    // the north range: the CEO tower centred on the quad, its neighbours flush either side, all standing on the north walk
    const NRd = Math.max(0, ...north.map((l) => l.d));
    const ny = qy0 - CW;
    if (input.ceo) {
      const c = input.ceo, cx = mid - c.w / 2;
      put(c, cx, ny - c.d, "s", { kind: "ceo" });
      let x = cx; for (const l of [...(input.west || [])].reverse()) { x -= l.w; put(l, x, ny - l.d, "s", { kind: "civic" }); }
      x = cx + c.w; for (const l of input.east || []) { put(l, x, ny - l.d, "s", { kind: "civic" }); x += l.w; }
    }
    // the wings
    const wingBoxes = [], skybridges = [], rowsOut = [];
    for (const s of ["W", "E"]) {
      let edge = s === "W" ? qx0 - CW : qx1 + CW; // the row's quad-side wall
      rows[s].forEach((row, ri) => {
        let y = qy0;
        const depth = rowDepth(row);
        row.forEach((l, i) => {
          const x = s === "W" ? edge - l.w : edge;
          put(l, x, y, s === "W" ? "e" : "w", { side: s, row: ri, index: i });
          y += l.d + O.SEAM;
        });
        rowsOut.push({ side: s, row: ri, x0: s === "W" ? edge - depth : edge, x1: s === "W" ? edge : edge + depth, y0: qy0, y1: qy0 + rowLen(row), ids: row.map((l) => l.id) });
        // a back row: each of its buildings bridged to the front-row building beside it
        if (ri > 0) {
          const prev = rows[s][ri - 1];
          row.forEach((l, i) => {
            const a = place[l.id], other = prev[Math.min(i, prev.length - 1)], b = place[other.id];
            const y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + l.d, b.y + other.d), cy = y1 > y0 ? (y0 + y1) / 2 : a.y + l.d / 2;
            const gx0 = s === "W" ? a.x + l.w : b.x + other.w, gx1 = s === "W" ? b.x : a.x;
            skybridges.push({ ...box(gx0, cy - 0.5, gx1 - gx0, 1), between: [l.id, other.id] });
          });
        }
        edge = s === "W" ? edge - depth - O.BACK_GAP : edge + depth + O.BACK_GAP;
      });
      // one wing record per district per side and row (its sign); the same district on two rows gets two signs
      for (const ro of rowsOut.filter((r) => r.side === s)) {
        const byD = new Map();
        for (const id of ro.ids) { const lot = lots.find((x) => x.id === id); if (!byD.has(lot.district)) byD.set(lot.district, []); byD.get(lot.district).push(lot); }
        for (const [name, ls] of byD) wingBoxes.push({ name, side: s, row: ro.row, x0: r2(Math.min(...ls.map((l) => l.x))), y0: r2(Math.min(...ls.map((l) => l.y))), x1: r2(Math.max(...ls.map((l) => l.x + l.w))), y1: r2(Math.max(...ls.map((l) => l.y + l.d))), ids: ls.map((l) => l.id) });
      }
    }
    // the quad's furniture: the fountain square near the top (room for the line at the CEO tower's door), the clock
    // tower east of it, the Underground stairs west
    const R = O.SQ_R, square = { x: mid, y: qy0 + 2.4 + R, r: R };
    const clock = { x: mid + R + 1.6, y: square.y };
    const ugS = input.ug || { w: 2.2, d: 1.6 }, ug = box(qx0 + 0.7, square.y - ugS.d / 2, ugS.w, ugS.d);
    const lawn = box(qx0 + 1.2, square.y + R + 1.2, QW - 2.4, Math.max(0, qy1 - (square.y + R + 1.2) - 1.0));
    // the south end: the garden strip, then the long block
    const gy0 = qy1 + CW, GD = Math.max(O.GARDEN_D, garden ? garden.d + 1.2 : 0);
    const walk = box(mid - O.WALK / 2, gy0, O.WALK, GD);
    const gardenLot = garden ? box(mid - O.WALK / 2 - 0.6 - garden.w, gy0 + (GD - garden.d) / 2, garden.w, garden.d) : null;
    const gardenZone = box(qx0, gy0, QW, GD);
    // The shared garden (2026-11-16, the gardens lane): the community garden's part that belongs to everyone, across the
    // covered walk from the plots: the whole east half of the garden strip, 0.6 in from the walk and the east arm. The
    // plots never shrink for it (the quad is already at least two plot-lots and the walk wide), and it grows with them:
    // more plots make the quad wider and the strip deeper, so the shared half is never squeezed out (6.5 x 3.8 at least).
    const shared = garden && homes ? box(mid + O.WALK / 2 + 0.6, gy0 + 0.6, (QW - O.WALK) / 2 - 1.2, GD - 1.2) : null;
    const hy = gy0 + GD, hw = homes ? Math.max(homes.w, QW + 2 * CW) : 0;
    const homesBox = homes ? box(mid - hw / 2, hy, hw, homes.d) : null;
    // The break garden (the gardens lane): a small garden by the work wings where workers on a break sit, in the corner
    // between the north range and the front of a wing, its gate on the north concourse. Both views look from the south-
    // east, so the wing building just south of the corner hides part of it: the corner beside the lower of the two first
    // buildings (the west on a tie: seen over the open quad), when it has room for BG_W; else the other when that has
    // room; else the bigger. BG_W to BG_MAXW wide (to the wing's outer wall when that is wider), BG_D deep.
    const nr = lots.filter((l) => l.kind !== "lot");
    let breakGarden = null;
    if (nr.length && input.breakGarden !== false) {
      const rx0 = Math.min(...nr.map((l) => l.x)), rx1 = Math.max(...nr.map((l) => l.x + l.w));
      const frontDepth = (s) => (rows[s].length ? rowDepth(rows[s][0]) : 0);
      const room = { E: qx1 + CW + frontDepth("E") - (rx1 + 0.4), W: rx0 - 0.4 - (qx0 - CW - frontDepth("W")) }; // the corner's width out to the wing's outer wall
      const tall = (s) => rows[s][0]?.[0]?.floors || 0, first = tall("E") < tall("W") ? "E" : "W", other = first === "W" ? "E" : "W";
      const fits = (s) => room[s] >= O.BG_W - 1e-9, side = fits(first) ? first : fits(other) ? other : room.W >= room.E ? "W" : "E", bw = Math.min(O.BG_MAXW, Math.max(O.BG_W, room[side]));
      const bx = side === "E" ? rx1 + 0.4 : rx0 - 0.4 - bw, by = qy0 - CW - O.BG_D;
      breakGarden = { ...box(bx, by, bw, O.BG_D), side, gateX: r2(side === "E" ? bx + 1.1 : bx + bw - 1.1) };
    }
    // the concourse: round the quad, along the north range, on down both sides of the garden, and across it (and on to
    // the break garden's gate when the north range is as wide as the quad)
    const xs = Object.values(place).map((p) => p.x);
    let nx0 = Math.min(qx0 - CW, ...nr.map((l) => l.x)), nx1 = Math.max(qx1 + CW, ...nr.map((l) => l.x + l.w));
    if (breakGarden) { nx0 = Math.min(nx0, breakGarden.gateX - 0.9); nx1 = Math.max(nx1, breakGarden.gateX + 0.9); }
    const concourse = [
      { ...box(nx0, qy0 - CW, nx1 - nx0, CW), part: "north" },
      { ...box(qx0 - CW, qy1, QW + 2 * CW, CW), part: "south" },
      { ...box(qx0 - CW, qy0, CW, L), part: "west" },
      { ...box(qx1, qy0, CW, L), part: "east" },
      ...(homes ? [{ ...box(qx0 - CW, gy0, CW, GD), part: "west arm" }, { ...box(qx1, gy0, CW, GD), part: "east arm" }, { ...walk, part: "garden walk" }] : []),
    ].map((c) => ({ ...c, kind: "concourse" }));
    // the complex's bounds, then the ring road and the river
    const things = [...lots, ...concourse, ...skybridges, ...(homesBox ? [homesBox] : []), ...(gardenLot ? [gardenLot] : []), ...(shared ? [shared] : []), ...(breakGarden ? [breakGarden] : [])];
    let bx0 = Math.min(...things.map((t) => t.x)), by0 = Math.min(...things.map((t) => t.y)), bx1 = Math.max(...things.map((t) => t.x + t.w)), by1 = Math.max(...things.map((t) => t.y + t.d));
    void xs;
    // shift so the complex starts at (0, 0)
    const dx = -bx0, dy = -by0, sh = (b) => (b ? { ...b, x: r2(b.x + dx), y: r2(b.y + dy) } : b);
    for (const id in place) { place[id].x = r2(place[id].x + dx); place[id].y = r2(place[id].y + dy); }
    const W = r2(bx1 - bx0), D = r2(by1 - by0);
    const ring = { x0: r2(-O.RING - O.STREET), y0: r2(-O.RING - O.STREET), x1: r2(W + O.RING + O.STREET), y1: r2(D + O.RING + O.STREET), street: O.STREET };
    const S = O.STREET, rw = ring.x1 - ring.x0;
    const roads = [
      { ...box(ring.x0, ring.y0, rw, S), kind: "ring" }, { ...box(ring.x0, ring.y1 - S, rw, S), kind: "ring" },
      { ...box(ring.x0, ring.y0 + S, S, ring.y1 - ring.y0 - 2 * S), kind: "ring" }, { ...box(ring.x1 - S, ring.y0 + S, S, ring.y1 - ring.y0 - 2 * S), kind: "ring" },
    ];
    const river = { x0: r2(ring.x0 - 7), x1: r2(ring.x1 + 7), y: r2(ring.y1 + O.RIVER_GAP), d: O.RIVER };
    const quad = { x0: r2(qx0 + dx), y0: r2(qy0 + dy), x1: r2(qx1 + dx), y1: r2(qy1 + dy) };
    // the next free lot: at the end of each side's last row when it still fits beside the quad
    const nextLots = [];
    for (const s of ["W", "E"]) {
      const rs = rows[s]; if (!rs.length) continue;
      const last = rs[rs.length - 1], ri = rs.length - 1, ro = rowsOut.find((r) => r.side === s && r.row === ri);
      const NW = 5.5, y = qy0 + rowLen(last) + O.SEAM;
      if (last.length < O.PER_ROW && y + NW <= qy1 + 1e-9) {
        const x = s === "W" ? ro.x1 - NW : ro.x0;
        nextLots.push({ district: last[last.length - 1].district, side: s, ...box(x + dx, y + dy, NW, NW) });
      }
    }
    return {
      plan: "quad", w: W, d: D, place, quad, quadW: r2(QW), quadL: r2(L), sides: chosen.side,
      concourse: concourse.map(sh), skybridges: skybridges.map((b) => ({ ...sh(b), between: b.between })),
      wings: wingBoxes.map((b) => ({ ...b, x0: r2(b.x0 + dx), x1: r2(b.x1 + dx), y0: r2(b.y0 + dy), y1: r2(b.y1 + dy) })),
      rows: rowsOut.map((r) => ({ ...r, x0: r2(r.x0 + dx), x1: r2(r.x1 + dx), y0: r2(r.y0 + dy), y1: r2(r.y1 + dy) })),
      square: { x: r2(square.x + dx), y: r2(square.y + dy), r: R }, clock: { x: r2(clock.x + dx), y: r2(clock.y + dy) },
      underground: sh(ug), lawn: sh(lawn), garden: gardenLot ? { ...sh(gardenLot), gateY: r2(gardenLot.y + dy + gardenLot.d / 2) } : null, gardenZone: sh(gardenZone),
      homes: sh(homesBox), walk: sh(walk), ring, roads, river, nextLots, northDepth: NRd,
      shared: shared ? { ...sh(shared), gateY: r2(shared.y + dy + shared.d / 2) } : null,
      breakGarden: breakGarden ? { ...sh(breakGarden), gateX: r2(breakGarden.gateX + dx), side: breakGarden.side } : null,
    };
  }

  // ---- the Streets layout's two gardens (the gardens lane, 2026-11-16) ----
  // The break garden takes the civic row's east corner lot (column 3, row 0: beside the Campus Mart, across the side
  // street from Games). That lot is always free (row 0 holds only HR, the Mart and the CEO tower) and was a nameless
  // little park; now it has a name, benches and people. c: layoutBC's campus (colX, rowY, colW, rowD).
  function streetsBreakLot(c) {
    if (!c?.colX?.length || !c.rowY?.length) return null;
    const x = c.colX[3], y = c.rowY[0], w = c.colW[3], d = c.rowD[0];
    return { ...box(x + 0.3, y + 0.3, w - 0.6, d - 0.6), gx: 3, gy: 0, side: "E", gateX: r2(x + w / 2) };
  }
  // The shared garden beside the plots (city.js cityGarden places the plots west of the village loop): directly south of
  // the plots, its east edge in line with theirs, its gate in the middle of its east side, and a gravel path from the
  // gate to the loop: straight across to the west lane, or (when the gate is south of the loop) across and then up to
  // the loop's south lane. It does not move the plots; it grows wider with them (at least 5.4 x 4.2).
  // g: the plots lot { x, y, w, d }; v: the village { x0, y0, y1, road }.
  function streetsSharedLot(g, v) {
    if (!g || !v) return null;
    const w = Math.max(5.4, g.w), d = 4.2, x = g.x + g.w - w, y = g.y + g.d + 0.8, laneX = v.x0 - v.road, gateY = r2(y + d / 2);
    const paths = [box(x + w, gateY - 0.35, laneX - (x + w), 0.7)];
    const southLane = v.y1 + v.road; // the loop's south lane: y1 .. y1 + road, from laneX east
    if (gateY - 0.35 >= southLane) paths.push(box(laneX - 0.7, southLane - 0.3, 0.7, gateY - 0.35 - (southLane - 0.3)));
    return { ...box(x, y, w, d), gateY, paths };
  }

  // Rectangles that must not overlap (touching walls is fine): every lot, the garden, the Residences, the quad's
  // furniture, the next lots, and the river. Used by the tests; handy for a console check too.
  function solids(p, extraLots = []) {
    const out = [];
    for (const [id, pl] of Object.entries(p.place)) { const l = extraLots.find((x) => x.id === id); if (l) out.push({ id, x: pl.x, y: pl.y, w: l.w, d: l.d }); }
    if (p.garden) out.push({ id: "garden", ...p.garden });
    if (p.shared) out.push({ id: "shared-garden", ...p.shared });
    if (p.breakGarden) out.push({ id: "break-garden", ...p.breakGarden });
    if (p.homes) out.push({ id: "homes", ...p.homes });
    out.push({ id: "underground", ...p.underground });
    out.push({ id: "fountain", x: p.square.x - p.square.r, y: p.square.y - p.square.r, w: p.square.r * 2, d: p.square.r * 2 });
    out.push({ id: "clock", x: p.clock.x - 0.45, y: p.clock.y - 0.45, w: 0.9, d: 0.9 });
    for (const n of p.nextLots) out.push({ id: `next-${n.side}`, x: n.x, y: n.y, w: n.w, d: n.d });
    out.push({ id: "river", x: p.river.x0, y: p.river.y, w: p.river.x1 - p.river.x0, d: p.river.d });
    for (const c of p.concourse) out.push({ id: `concourse:${c.part}`, x: c.x, y: c.y, w: c.w, d: c.d, walk: true });
    return out;
  }
  const overlaps = (a, b, eps = 1e-6) => a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.d - eps && b.y < a.y + a.d - eps;
  const touches = (a, b, eps = 0.05) => a.x <= b.x + b.w + eps && b.x <= a.x + a.w + eps && a.y <= b.y + b.d + eps && b.y <= a.y + a.d + eps;

  const api = { plan, solids, overlaps, touches, DEF, streetsBreakLot, streetsSharedLot };
  if (typeof globalThis !== "undefined") globalThis.campusQuad = api;
})();
