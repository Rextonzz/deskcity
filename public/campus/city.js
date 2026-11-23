// Campus: the little city, houses and the campus store. Part of public/campus.html, loaded in order by campus/boot.js;
// the files share one global scope (classic scripts), so a name defined in one is visible in the others.
"use strict";
// ---------- the little city ----------
// Every worker has a house on their project's street, in the village across the river (plan B+C). Real data only:
// - size grows with the campus credits they've earned (cottage < 30, house < 100, villa with a garden after that)
// - windows light up when they're home: after hours (18:00-08:00) and not working; dark while they're at the office
// - paused workers are away (shutters down, a little suitcase); planned hires are still being built (scaffolding)
// - what they bought shows outside: a gold chair = porch chair, a trophy = flag on the roof, plants = garden pots
// Tap a house for its owner.
const LOT = 2.5;
// The Residences lane (2026-11-16): homes that look like homes (balconies, small windows, a lobby awning, lit flats at
// night, no desks), luxury levels by credits earned with a word for each (Basic, Comfy, Nice, Penthouse: the owner is
// partly colourblind, so never colour alone), a two-floor penthouse, floors you can go inside like an office tower, and
// moves. Who lives where comes from the server (data.homes, kept in data/agents/homes.json) run through the same rules
// file the server uses (public/campus/model/homes.js, campusHomes); with no server copy the campus works it out itself.
let HOMES = new Map(), RES = null; // RES: the model's answer { towers, homes, state }
const homeOf = (id) => { const k = String(id || "").replace(/^house:/, ""); return HOMES.get(k) || (RES?.homes?.[k] ? cityHomeRecord(k) : null); }; // (inside a tower HOMES is empty: the record is made from RES)
const homesList = () => [...HOMES.values()];
const MAX_FLOORS = 7, RES_FLOOR_H = 0.32; // 2D: 0.6 + 7 x 0.32 = 2.84, under the CEO tower's 3.2 (a penthouse counts as two)
const isResView = (id) => /^homes(-\d+)?$/.test(String(id || ""));
const resLevel = (i) => campusHomes.LEVELS[Math.max(0, Math.min(campusHomes.LEVELS.length - 1, i | 0))];
// Everyone on the roster lives here except retired staff and HR (they work in the CEO tower): the server's rule too.
function resLayout() {
  const ws = data.wallets || {};
  const residents = data.desks.filter((d) => d.status !== "retired" && d.room !== "hr" && data.rooms.some((x) => x.id === d.room)).map((d) => ({ id: d.id, earned: ws[d.id]?.earned || 0 }));
  RES = campusHomes.assign(residents, data.homes || null, { now: data.homes ? "" : new Date().toISOString() });
  // The quad layout (2026-11-16): the same homes in ONE long block (homes.js block(): more flats a floor, nobody moves).
  // (cityPlan: what the last city layout built; "bc" when the quad fell back to the streets: then the towers, as there)
  if ((cityPlan || layoutChoice()) === "quad") RES = campusHomes.block(RES, { wide: 3 });
  return RES;
}
// The long block's footprint for the quad's plan (core.js layoutQuad): a 5.5-tile bay of front for every `wide` step
// (22 tiles at the real roster), 5.5 deep (the sizes lane, 2026-11-16: was 4.4 deep; five Basics a bay now, each the
// same floor area as before). Both from the one size table (homes.js BAY_W, DEPTH). Null when nobody lives here yet.
function resBlockSize() {
  const t = resLayout().towers[0];
  return t ? { w: campusHomes.BAY_W * (t.wide || 3), d: campusHomes.DEPTH.quad } : null;
}
// The garden lot's size for the quad's plan (the same sums as cityGarden). Null when the garden isn't on.
function gardenNeed() {
  const g = cityGarden(0, 0, 0);
  return g ? { w: g.w, d: g.d } : null;
}
// The last move, in words, for a worker's panel: "🏠 Moved to Residences B, Floor 4 (Nice) 2 h ago: Nice now (was Comfy)".
function moveLine(id) {
  const m = (data.homes?.moved || {})[id];
  return m?.to ? `<div class="sub">🏠 Moved to ${esc(m.to)} (${esc(m.level)}) ${esc(ago(m.at))}: ${esc(m.reason || "")}</div>` : "";
}
// The quad layout (2026-11-16): ONE long Residences block across the south end (core.js layoutQuad gave it its place,
// campus.homesBox), its front with the balconies and the lobby facing the garden and the quad; the community garden
// west of the covered walk that crosses to the lobby door. Leisure stays where the layout put it (the north range).
function cityHousesQuad() {
  const L = resLayout(), B = campus.homesBox, out = [];
  HOMES = new Map();
  if (B) L.towers.forEach((tw) => {
    const storeys = Math.max(1, tw.storeys), isIn = (id) => { const d = id && deskById(id); return !!d && whereIs(d) === "home"; };
    out.push({ id: tw.id, isHomes: true, block: true, name: tw.name, x: B.x, y: B.y, w: B.w, d: B.d, h: 0.6 + storeys * RES_FLOOR_H, hue: 38, face: "n", desks: [], lastByDesk: {}, storeys,
      floors: tw.floors.map((f) => ({ ...f, penthouse: f.levelKey === "penthouse", busy: f.flats.some(isIn) })) });
    tw.floors.forEach((f) => f.flats.forEach((id, k) => {
      const d = id && deskById(id); if (!d) return;
      const p = f.levelKey === "penthouse", cw = B.w / Math.max(1, f.perFloor);
      HOMES.set(id, {
        id: `house:${id}`, isHouse: true, inTower: true, tower: tw.id, towerName: tw.name, desk: d, street: projects.find((x) => x.id === d.room)?.name || d.room,
        level: f.level, levelKey: f.levelKey, levelName: f.levelName, size: Math.min(2, f.level), penthouse: p, floor: f.storey, span: f.span, floorName: f.name, flat: k + 1,
        name: `${nameOf(d)}'s ${p ? "penthouse" : "flat"}`, x: B.x + cw * (k + 0.5), y: B.y, w: 0, d: 0, h: 0, face: "n", hue: hueOf(d.room),
      });
    }));
  });
  const G = campus.gardenBox;
  if (G) { const garden = cityGarden(G.x + G.w + 0.7, G.y, G.d); if (garden) out.push(garden); }
  // the gardens lane: the community garden's shared half east of the covered walk, the break garden by the wings
  if (campus.sharedBox && out.some((r) => r.id === "garden")) out.push(sharedGardenRoom(campus.sharedBox, "w"));
  if (campus.breakBox) out.push(breakGardenRoom(campus.breakBox));
  return out;
}
function cityHouses() {
  if (campus.plan === "quad") return cityHousesQuad();
  const H = campus.home, ROAD = 1.9, PLOT = 2.2;
  const L = resLayout(), T = Math.max(1, L.towers.length);
  // a small square with the loop road round it, the towers side by side in the middle
  const mainBridge = (campus.bridges || []).reduce((a, b) => (b.w > (a?.w || 0) ? b : a), null);
  const laneHalf = (b) => (b === mainBridge ? 1.5 : 0.8); // the bridge lanes: the main bridge's is the high street
  // Footprint (the owner 2026-11-16, "the towers' floor print may grow"): 5.5 x 4.0 (was 4.4 x 4.0, and 3.6 x 3.8 before
  // that): one bay of the size table (homes.js BAY_W, DEPTH), five Basics a floor, each as wide as before. Height is unchanged.
  const TW = campusHomes.BAY_W, TD = campusHomes.DEPTH.tower, GAP = 1.2, GW = Math.max(10, T * (TW + GAP) + GAP), GD = 7.5;
  const gx0 = H.cx - GW / 2, gy0 = H.y + PLOT + ROAD + 0.6, gx1 = gx0 + GW, gy1 = gy0 + GD;
  const ty = gy0 + (GD - TD) / 2, row = T * TW + (T - 1) * GAP;
  const out = [];
  HOMES = new Map();
  L.towers.forEach((tw, t) => {
    const tx = H.cx - row / 2 + t * (TW + GAP), storeys = Math.max(1, tw.storeys);
    const isIn = (id) => { const d = id && deskById(id); return !!d && whereIs(d) === "home"; };
    const tower = {
      id: tw.id, isHomes: true, name: tw.name, x: tx, y: ty, w: TW, d: TD, h: 0.6 + storeys * RES_FLOOR_H, hue: 38, face: "s", desks: [], lastByDesk: {}, storeys,
      floors: tw.floors.map((f) => ({ ...f, penthouse: f.levelKey === "penthouse", busy: f.flats.some(isIn) })),
    };
    tw.floors.forEach((f) => f.flats.forEach((id, k) => {
      const d = id && deskById(id); if (!d) return;
      const p = f.levelKey === "penthouse";
      HOMES.set(id, {
        id: `house:${id}`, isHouse: true, inTower: true, tower: tw.id, towerName: tw.name, desk: d, street: projects.find((x) => x.id === d.room)?.name || d.room,
        level: f.level, levelKey: f.levelKey, levelName: f.levelName, size: Math.min(2, f.level), penthouse: p, floor: f.storey, span: f.span, floorName: f.name, flat: k + 1,
        name: `${nameOf(d)}'s ${p ? "penthouse" : "flat"}`, x: tx + TW / 2, y: ty + TD, w: 0, d: 0, h: 0, face: "s", hue: hueOf(d.room),
      });
    }));
    out.push(tower);
  });
  campus.village = { x0: gx0, y0: gy0, x1: gx1, y1: gy1, road: ROAD, plot: PLOT, slots: 0 };
  // the village's own streets: the loop, and a lane from each bridge down to it
  campus.roads.push({ x: gx0 - ROAD, y: gy0 - ROAD, w: GW + ROAD * 2, d: ROAD, kind: "lane" }, { x: gx0 - ROAD, y: gy1, w: GW + ROAD * 2, d: ROAD, kind: "lane" },
    { x: gx0 - ROAD, y: gy0, w: ROAD, d: GD, kind: "lane" }, { x: gx1, y: gy0, w: ROAD, d: GD, kind: "lane" },
    { x: H.x0 - STREET, y: H.y - 0.2, w: H.x1 - H.x0 + STREET * 2, d: 1.2, kind: "path" });
  for (const b of campus.bridges) { const y0 = H.y + 0.9; if (b.x > gx0 - ROAD && b.x < gx1 + ROAD) campus.roads.push({ x: b.x - laneHalf(b), y: y0, w: laneHalf(b) * 2, d: gy0 - ROAD - y0, kind: "lane" }); }
  // The community garden (the owner 2026-11-16: "a community garden for those with no outside area"), west of the
  // square, across the lane from the towers, with a path from the lane to its gate. Plots in rows of up to four, so it
  // is never deeper than the square; low things only (nothing taller than a tree).
  const garden = cityGarden(gx0 - ROAD, gy0, GD);
  if (garden) { out.push(garden); campus.roads.push({ x: garden.x + garden.w, y: garden.gateY - 0.35, w: gx0 - ROAD - (garden.x + garden.w), d: 0.7, kind: "path" }); }
  // the gardens lane: the shared garden south of the plots (a path from its gate to the loop), and the break garden in
  // the civic row's east lot by the Mart (model/quad.js streetsSharedLot, streetsBreakLot)
  const sh = garden && L.towers.length ? campusQuad.streetsSharedLot(garden, { x0: gx0, y0: gy0, y1: gy1, road: ROAD }) : null;
  if (sh) { out.push(sharedGardenRoom(sh, "e")); for (const q of sh.paths) campus.roads.push({ ...q, kind: "path" }); }
  const bk = campusQuad.streetsBreakLot(campus);
  if (bk) out.push(breakGardenRoom(bk));
  // Leisure on the home side, east, by the river.
  const le = rooms.find((r) => r.isLeisure);
  if (le) { le.x = gx1 + ROAD + PLOT + 2.2; le.y = H.y + 1.6; }
  // the river runs the whole width of the map (the 3D ground is the rooms' bounds plus 8 each side)
  const all = [...rooms, ...out], minX = Math.min(...all.map((r) => r.x)), maxX = Math.max(...all.map((r) => r.x + r.w));
  campus.river.x0 = minX - 8; campus.river.x1 = maxX + 8;
  return out;
}
// Inside a Residences tower (the owner 2026-11-16: "show their floors stacked like the office towers do"): one floor per
// level, the flats side by side on it, ground floor first. A penthouse is one floor object that spans two storeys.
function resFloors(id) {
  const L = RES || resLayout(), tw = L.towers.find((t) => t.id === id);
  if (!tw) return [];
  // the ground floor first: the lobby and what everyone shares (the inside lane, 2026-11-16)
  const lobby = { id: `${tw.id}::lobby`, k: 0, lobby: true, groups: null, resFloor: true, tower: tw.id, towerName: tw.name, level: -1, levelKey: "lobby", levelName: "Lobby", span: 1, storey: 0, flats: [], perFloor: 0,
    floorName: "Ground floor · Lobby", name: "G · Lobby", project: { id: tw.id, name: tw.name, district: "Home", floors: [], hue: 38 }, desks: [], lead: null, staff: [], hue: 20, isHr: false, link: null, feed: [], lastByDesk: {}, busy: false, home: 0, working: 0, fresh: false, spend: 0, sub: 0, cap: null };
  return [lobby, ...tw.floors.map((f, k0) => {
    const k = k0 + 1;
    const lv = resLevel(f.level), desks = f.flats.map((x) => x && deskById(x)).filter(Boolean);
    const isIn = (d) => whereIs(d) === "home";
    return { id: `${tw.id}::${k0}`, k, groups: null, resFloor: true, tower: tw.id, towerName: tw.name, level: f.level, levelKey: f.levelKey, levelName: lv.name, span: f.span, storey: f.storey, flats: f.flats.slice(), perFloor: f.perFloor,
      floorName: `${f.name} · ${lv.name}`, name: `${f.span > 1 ? `${f.storey}-${f.storey + 1}F` : `${f.storey}F`} · ${lv.name}`, project: { id: tw.id, name: tw.name, district: "Home", floors: [], hue: 38 },
      desks, lead: null, staff: [], hue: [36, 28, 20, 44][f.level] ?? 36, isHr: false, link: null, feed: [], lastByDesk: {}, busy: desks.some(isIn), home: desks.filter(isIn).length, working: 0, fresh: false, spend: 0, sub: 0, cap: null };
  })];
}
// Floors inside a Residences tower: the same size each, a flat per slot across the front, a corridor with the lift and
// the stairs along the back. Higher floors sit higher (a penthouse leaves room for its upper storey).
function layoutResFloors() {
  // every floor is the building's bays wide (one for a tower, `wide` for the long block), a bay five Basic rooms
  // (homes.js ROOM_W): so a flat is drawn at its size in the one table (Basic 3.2, Comfy 5.33, Nice and Penthouse 8
  // tiles across), the same on every floor, in the bay it sits in outside (was a fixed 2.6 a slot of 4 a bay)
  const LV = campusHomes.LEVELS, units = Math.max(1, ...rooms.filter((f) => f.perFloor).map((f) => Math.round(f.perFloor / LV[Math.max(0, f.level | 0)].perFloor) || 1));
  const w = units * campusHomes.roomW(0) * LV[0].perFloor, d = 6.2, zStep = (Math.min(w, 10.5) + d) / 2 + 2.4;
  let z = 0;
  for (const f of rooms) { Object.assign(f, { x: 0, y: 0, w, d, cols: 1, coreW: 0, lounge: 0, z }); z += zStep * (f.span > 1 ? 1.45 : 1); }
  const last = rooms[rooms.length - 1];
  campus = { w, d, colX: [0], rowY: [0], colW: [w], rowD: [d], top: last ? last.z + (last.span > 1 ? 1.8 : 0) : 0 };
}
// The Underground (plan B+C): paused projects wait below the plaza instead of taking a lot. Tap one to open it
// (its panel has Start); started, it rises back up into its district's next free lot.
function undergroundPanel() {
  const list = campus.underground || [];
  const p = showPanel("underground", "🚇 The Underground", `
    <div class="sub mt-1">Paused projects wait down here, lights low, so they don't take space in the city. Open one and press Start: its building rises back into its district's next free lot.</div>
    <h3 class="mt-4 font-semibold text-sm">Waiting below (${list.length})</h3>
    ${list.length ? list.map((r) => `<div class="row"><div><b>${esc(r.name)}</b> <span class="sub">${esc(r.district || "Tools")} · ${r.desks.length} ${r.desks.length === 1 ? "worker" : "workers"}${r.feed?.[0] ? ` · last seen ${esc(ago(r.feed[0].startedAt))}` : ""}</span></div><div><button class="pill" data-ug="${esc(r.id)}">Open</button></div></div>`).join("") : '<div class="sub">Nothing paused. Every project is up in the city.</div>'}`);
  p.querySelectorAll("[data-ug]").forEach((b) => (b.onclick = () => panel(b.dataset.ug)));
}
const atWork = (d) => { const last = projects.find((p) => p.id === d.room)?.lastByDesk?.[d.id]; return !!last && Date.now() - Date.parse(last.startedAt) < ACTIVE_MS; };
const afterHours = () => { const h = new Date().getHours(); return h >= 18 || h < 8; };
// One place per worker at a time (the owner 2026-11-09: "people shouldn't be in 2 locations at once"), in this order:
// at the lead stand-up (leads, while it's on), at their desk (worked in the last 15 min), at home (after hours),
// otherwise out and about. Planned desks aren't anywhere yet; paused ones are away.
function whereIs(d) {
  if (d.status === "planned") return "nowhere";
  if (d.status === "paused") return "away";
  if (d.lead && typeof meetingLive === "function" && meetingLive() && (data?.standup?.last?.projects || []).some((p) => p.lead === d.id)) return "meeting";
  if (atWork(d)) return "work";
  // Visible queues (the owner 2026-11-09, idea from the HackerNoon 3D office: "the coffee queue is the GPU queue"):
  // waiting on the owner's answer = in line at his CEO tower door; blocked or over the budget cap = at the coffee cart.
  const q = queueOf(d);
  if (q) return q.kind;
  if (afterHours()) return "home";
  return "out";
}
// Who's queuing where, worked out from the data (so every screen agrees): the line at the CEO tower is everyone with a
// request waiting on the owner, longest wait first; the coffee line in each building is its blocked or capped desks.
let queueCache = { at: 0, mine: [], coffee: {} };
function queues() {
  if (queueCache.at === data?.__loadedAt && queueCache.at) return queueCache;
  const mine = [], seen = new Set();
  const items = typeof waitingItems === "function" ? waitingItems() : [];
  for (const q of items) { const id = q.from; if (!id || id === OWNER_ID() || seen.has(id) || !data.desks.some((x) => x.id === id)) continue; seen.add(id); mine.push({ id, since: q.at, about: q.role }); }
  const coffee = {};
  const blocked = new Set((data.blockers || []).filter((w) => w.status === "open").map((w) => w.desk));
  for (const d of data.desks) {
    if (seen.has(d.id) || d.status !== "active") continue;
    const why = d.overCap ? "over my budget cap" : blocked.has(d.id) ? "blocked: " + ((data.blockers || []).find((w) => w.desk === d.id && w.status === "open")?.what || "waiting") : null;
    if (why) (coffee[d.room] ||= []).push({ id: d.id, why });
  }
  queueCache = { at: data?.__loadedAt || 0, mine, coffee };
  return queueCache;
}
function queueOf(d) {
  const q = queues(), i = q.mine.findIndex((x) => x.id === d.id);
  if (i >= 0) return { kind: "queue", spot: "owner", i, since: q.mine[i].since, about: q.mine[i].about };
  const c = q.coffee[d.room]?.findIndex((x) => x.id === d.id);
  if (c >= 0) return { kind: "coffee", spot: d.room, i: c, why: q.coffee[d.room][c].why };
  return null;
}
// Where in the line someone stands (campus tiles): at the CEO tower door, then back along the path; or by the cart.
function queuePos(q) {
  if (q.spot === "owner") { const r = rooms.find((x) => x.isControl); if (!r) return null; return [r.x + r.w / 2 + 0.2 + (q.i % 2) * 0.15, r.y + r.d + 1.0 + q.i * 0.65]; }
  const r = rooms.find((x) => x.id === q.spot); if (!r) return null;
  // the quad's wings face the quad (east or west): the cart stands out on the concourse in front of the door
  if (campus.plan === "quad" && r.face === "e") return [r.x + r.w + 1.0, r.y + r.d / 2 + 1.25 + q.i * 0.55];
  if (campus.plan === "quad" && r.face === "w") return [r.x - 1.0, r.y + r.d / 2 + 1.25 + q.i * 0.55];
  return [r.x + r.w / 2 + 1.25 + q.i * 0.55, r.y + r.d + 1.9];
}
// The Residences outside (2D): homes, not offices, and not a slab (the owner 2026-11-16, "less prison-like"). The same bays
// as the 3D view (campusHomes.facade(): one per unit of the long block, one per tower), each its own warm plaster, the
// middle ones stepping in, over a brick ground storey with wide lobby windows. Every flat has a framed window with a
// sill and curtains, and its level shows: Basic, shutters and a flower box; Comfy, a balcony with a solid painted front;
// Nice, a wide glass balcony with planters under a striped awning; the Penthouse, a glass storey set back behind a
// terrace with a pergola. A flat's window is lit when its owner is home; one to let has its curtains drawn. Each bay has
// its own top (a low gable with a chimney, a roof garden or a water tank; never more than 0.28 over the old roof). The
// door mid-front: glass doors, a canopy with the word "Residences" (when close enough to read), steps, a lamp, benches,
// mailboxes, a bike rack on the long block; a hedge, small trees and flower beds along the front. Each level's word sits
// beside its floors. An open flat is drawn cut away in its place.
const RES_COMES = campusBelongings.FURNISHED; // what each level comes furnished with (the list the display limits skip, model/belongings.js)
const RES_PENT_2D = 0.45; // how far the penthouse storey stands back (its terrace), in tiles
const _resFacadeMemo = new WeakMap();
const resFacadeOf = (r) => { let F = _resFacadeMemo.get(r); if (!F) { F = campusHomes.facade({ w: r.w, floors: r.floors, id: r.id }); _resFacadeMemo.set(r, F); } return F; };
// a "#rrggbb" colour times k (k < 1 darker), as "#rrggbb"
const resShade = (hex, k) => "#" + [1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k))).toString(16).padStart(2, "0")).join("");
function drawHomes(r, t) {
  const open = String(openRoom || "").startsWith("house:") ? homeOf(openRoom) : null;
  if (open && open.tower === r.id) return drawResHome2D(open, r, t); // their flat, cut away at its place in the building (the inside lane)
  // (the sizes lane) a Nice or Penthouse home is wider than a streets tower: while it is open, a neighbouring tower it
  // would reach into is not drawn, so the home reads whole
  if (open && open.inTower && open.tower !== r.id) { const tr = rooms.find((x) => x.id === open.tower && x.isHomes); if (tr) { const R = resHomeRect(open, tr); if (r.x < R.x + R.w + 0.3 && R.x - 0.3 < r.x + r.w) return; } }
  const { x, y, w, d, h } = r, hov = hover === r.id, n = Math.max(1, r.storeys || r.floors.length), fh = (h - 0.45) / n, Z0 = 0.4, F = resFacadeOf(r), near = cam.z > 0.6;
  const lit = hov ? 1.05 : 1, door = x + F.door, small = w < 7;
  const glass = dn("rgba(98,132,170,0.85)", "rgba(34,42,56,0.94)"), warm = (k) => `rgba(255,212,138,${0.88 + 0.1 * Math.sin(t / 1300 + k)})`;
  const trim = dn("#f6f0e2", "#6e695f"), wood = dn("#8b6a4a", "#4a3a2c"), leafC = dn("#4f9a52", "#2f5e38"), leafD = dn("#3f8445", "#264c2e"), drawn = dn("#efe6d2", "#5c574e");
  const slab = [dn("#f1eadb", "#5c5a54"), dn("#d9d0bf", "#4a4844"), dn("#c8bfad", "#3e3c38")];
  const FLW = ["#e86f8a", "#f2c14e", "#f4f0f0", "#d9534f", "#b48ad6"];
  const fr = (a, b, yf, z0, z1, fill) => poly([toScreen(a, yf, z0), toScreen(b, yf, z0), toScreen(b, yf, z1), toScreen(a, yf, z1)], fill);
  const dot = (px, py, pz, rad, fill) => { const [sx, sy] = toScreen(px, py, pz); ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(sx, sy, Math.max(0.8, rad * cam.z), 0, Math.PI * 2); ctx.fill(); };
  const line = (pts, stroke, wdt = 1) => { ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, wdt * cam.z); ctx.beginPath(); pts.forEach(([a, b, c], i) => { const [sx, sy] = toScreen(a, b, c); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }); ctx.stroke(); };
  const flowers = (a, b, py, pz, k0) => { if (!near) return; const m = Math.max(2, Math.round((b - a) / 0.09)); for (let q = 0; q < m; q++) dot(a + ((q + 0.5) * (b - a)) / m, py, pz, Math.min(0.9, 2.6 / cam.z), FLW[(k0 + q) % FLW.length]); };
  const roundTree = (tx, ty, s = 1) => { const [bx, by] = toScreen(tx, ty, 0); ctx.fillStyle = dn("rgba(40,70,40,0.22)", "rgba(0,0,0,0.28)"); ctx.beginPath(); ctx.ellipse(bx, by, 7 * cam.z * s, 3 * cam.z * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#5b4330"; ctx.fillRect(bx - 1.2 * cam.z, by - 9 * cam.z * s, 2.4 * cam.z, 9 * cam.z * s); ctx.fillStyle = leafD; ctx.beginPath(); ctx.arc(bx, by - 13 * cam.z * s, 7 * cam.z * s, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = leafC; ctx.beginPath(); ctx.arc(bx - 1.5 * cam.z * s, by - 15 * cam.z * s, 5 * cam.z * s, 0, Math.PI * 2); ctx.fill(); };
  // the ground round it: grass, the paving at the door
  poly([toScreen(x - 0.35, y - 0.35), toScreen(x + w + 0.35, y - 0.35), toScreen(x + w + 0.35, y + d + 0.7), toScreen(x - 0.35, y + d + 0.7)], dn("rgba(111,170,96,0.45)", "rgba(60,96,62,0.35)"), hov ? "#f3d9a4" : null);
  poly([toScreen(door - 0.55, y + d), toScreen(door + 0.55, y + d), toScreen(door + 0.55, y + d + 0.7), toScreen(door - 0.55, y + d + 0.7)], dn("#d9cfb8", "#6b6658"));
  // the brick ground storey (full depth: the bays above step back from it), its cornice and wide lobby windows
  box(x, y, w, d, Z0, dn("#cfc6b4", "#4c4842"), dn(resShade("#a8644c", lit), "#4a3028"), dn(resShade("#8f5240", lit), "#3c271f"));
  fr(x, x + w, y + d, Z0 - 0.02, Z0 + 0.005, trim);
  const lobbyX = small ? [w * 0.17, w * 0.83] : Array.from({ length: Math.floor((w - 1.2) / 1.7) }, (_, i) => 0.85 + i * 1.7).filter((q) => Math.abs(q - F.door) > 1.5 && q < w - 0.6);
  for (const q of lobbyX) { fr(x + q - 0.32, x + q + 0.32, y + d, 0.08, 0.32, trim); fr(x + q - 0.29, x + q + 0.29, y + d, 0.1, 0.3, night > 0.3 ? "rgba(255,220,150,0.92)" : glass); }
  // the bays, left to right (nearer ones draw later), each with its floors and flats
  const topLv = r.floors.length ? r.floors[r.floors.length - 1].level : 0, zPent = topLv === 3 ? Z0 + (r.floors[r.floors.length - 1].storey - 1) * fh : h;
  const balc = [];
  F.bays.forEach((b, bi) => {
    const bx = x + b.x0, bw = b.x1 - b.x0, dd = d - b.inset, wall = b.wall;
    box(bx, y, bw, dd, zPent - Z0, dn("#e9e3d6", "#4e4b45"), dn(resShade(wall, 0.97 * lit), resShade(wall, 0.36)), dn(resShade(wall, 0.84 * lit), resShade(wall, 0.3)), Z0);
    if (zPent < h) {
      // the penthouse storey stands back behind its terrace: a deck and a glass rail at the bay's front
      box(bx, y, bw, dd, 0.02, dn("#c8a57e", "#5a4a3a"), slab[1], slab[2], zPent);
      box(bx, y, bw, dd - RES_PENT_2D, h - zPent, dn("#e9e3d6", "#4e4b45"), dn(resShade(wall, 1.07 * lit), resShade(wall, 0.4)), dn(resShade(wall, 0.92 * lit), resShade(wall, 0.33)), zPent);
    }
    // a ledge at each floor, a pilaster at the joint with the next bay
    r.floors.forEach((f) => { if (f.storey > 1) { const zA = Z0 + (f.storey - 1) * fh, yf = y + dd - (f.level === 3 ? RES_PENT_2D : 0); fr(bx, bx + bw, yf, zA - 0.022, zA + 0.008, dn("rgba(255,250,240,0.9)", "rgba(120,112,98,0.6)")); } });
    if (bi < F.bays.length - 1) fr(b.x1 + x - 0.05, b.x1 + x + 0.05, y + d - Math.min(b.inset, F.bays[bi + 1].inset), Z0, zPent, trim);
    // the flats in this bay
    r.floors.forEach((f, i) => {
      const zA = Z0 + (f.storey - 1) * fh, zB = zA + f.span * fh, k = Math.max(1, f.perFloor || f.flats.length), cw = w / k, lv = f.level, yf = y + dd - (lv === 3 ? RES_PENT_2D : 0);
      for (let j = 0; j < k; j++) {
        const lx = cw * (j + 0.5); if (lx < b.x0 || lx > b.x1) continue;
        const id = f.flats[j], dk = id && deskById(id), home = !!dk && whereIs(dk) === "home", cx = x + lx, acc = dn(b.accent, resShade(b.accent, 0.45));
        const [ww, wh] = [[0.36, 0.5], [0.46, 0.56], [0.66, 0.58], [0.86, 0.84]][lv] || [0.36, 0.5];
        const pw = Math.min(cw * ww, lv === 3 ? 3.4 : 1.6), a = cx - pw / 2, e = cx + pw / 2, z0 = lv === 3 ? zA + fh * 0.1 : zA + fh * 0.24, z1 = lv === 3 ? zB - fh * 0.14 : z0 + fh * wh;
        if (lv === 0) for (const s of [-1, 1]) { const sa = s < 0 ? a - pw * 0.48 : e + 0.02, sb = s < 0 ? a - 0.02 : e + pw * 0.48; fr(sa, sb, yf, z0, z1, acc); if (near) for (const zz of [0.3, 0.7]) fr(sa + 0.01, sb - 0.01, yf, z0 + (z1 - z0) * zz - 0.006, z0 + (z1 - z0) * zz + 0.006, trim); }
        fr(a - 0.04, e + 0.04, yf, z0 - 0.02, z1 + 0.025, trim); // the frame
        fr(a, e, yf, z0, z1, !id ? (lv === 3 ? glass : drawn) : home ? warm(i * 3 + j) : glass);
        if (!id && lv === 3) fr(a, e, yf, z1 - (z1 - z0) * 0.34, z1, drawn); // a penthouse to let: blinds half down
        if (!id && lv !== 3 && near) fr(cx - 0.008, cx + 0.008, yf, z0, z1, dn("#d8ccb2", "#4a463f")); // to let: curtains drawn
        if (id && near) { const cc = dn(F.curtain(f.storey, j), resShade(F.curtain(f.storey, j), 0.45)), cwid = pw * 0.17; fr(a, a + cwid, yf, z0, z1, cc); fr(e - cwid, e, yf, z0, z1, cc); }
        if (lv === 3 && near) { const m = Math.max(2, Math.round(pw / 0.6)); for (let q = 1; q < m; q++) fr(a + (q * pw) / m - 0.008, a + (q * pw) / m + 0.008, yf, z0, z1, dn("#6d523a", "#2a2018")); if (f.span > 1) fr(a, e, yf, zA + fh - 0.01, zA + fh + 0.01, dn("#6d523a", "#2a2018")); }
        if (lv === 0) { fr(a - 0.06, e + 0.06, yf + 0.06, z0 - 0.06, z0 - 0.005, wood); flowers(a, e, yf + 0.06, z0, i + j); } // the flower box
        else fr(a - 0.06, e + 0.06, yf, z0 - 0.03, z0 - 0.005, trim); // the sill
        if (lv === 2) { // a striped awning over a Nice window
          const m = Math.max(4, Math.round(pw / 0.14));
          for (let q = 0; q < m; q++) { const qa = a + (q * pw) / m, qb = qa + pw / m; poly([toScreen(qa, yf, z1 + 0.03), toScreen(qb, yf, z1 + 0.03), toScreen(qb, yf + 0.13, z1 - 0.025), toScreen(qa, yf + 0.13, z1 - 0.025)], q % 2 ? trim : acc); }
        }
        // the balconies and the terrace, drawn after the bay's walls (so the next floor up doesn't hide them)
        if (lv === 1 || lv === 2) balc.push(() => {
          const bw2 = cw * (lv === 1 ? 0.64 : 0.88), bd = lv === 1 ? 0.24 : 0.3, bz = zA + 0.02;
          box(cx - bw2 / 2, yf, bw2, bd, 0.035, ...slab, bz);
          if (id && cam.z > 0.55) drawBalconyThings(id, cx, yf + bd * 0.5, bz + 0.035, bw2, t, 0.9); // their outdoor things (belongings.js), and them now and then
          if (lv === 1) { fr(cx - bw2 / 2, cx + bw2 / 2, yf + bd, bz + 0.035, bz + 0.13, acc); poly([toScreen(cx + bw2 / 2, yf, bz + 0.035), toScreen(cx + bw2 / 2, yf + bd, bz + 0.035), toScreen(cx + bw2 / 2, yf + bd, bz + 0.13), toScreen(cx + bw2 / 2, yf, bz + 0.13)], dn(resShade(b.accent, 0.8), resShade(b.accent, 0.38))); line([[cx - bw2 / 2, yf + bd, bz + 0.135], [cx + bw2 / 2, yf + bd, bz + 0.135]], trim, 1.4); if (near) { fr(cx - bw2 * 0.2, cx + bw2 * 0.2, yf + bd + 0.01, bz + 0.13, bz + 0.17, wood); flowers(cx - bw2 * 0.18, cx + bw2 * 0.18, yf + bd + 0.01, bz + 0.18, j + 1); } }
          else { fr(cx - bw2 / 2, cx + bw2 / 2, yf + bd, bz + 0.035, bz + 0.13, dn("rgba(150,190,210,0.45)", "rgba(150,170,190,0.25)")); line([[cx - bw2 / 2, yf + bd, bz + 0.135], [cx + bw2 / 2, yf + bd, bz + 0.135]], wood, 1.4); for (const px of [cx - bw2 / 2 + 0.06, cx + bw2 / 2 - 0.16]) box(px, yf + 0.04, 0.1, 0.1, 0.09, "#5fae5a", "#4c9448", "#3f7e3c", bz + 0.035); }
        });
        if (lv === 3) balc.push(() => {
          const ty = y + dd - RES_PENT_2D, pw2 = cw * 0.8, zt = zA + 0.02;
          if (id && cam.z > 0.55) drawBalconyThings(id, cx, ty + RES_PENT_2D * 0.5, zt, pw2, t, 0.9);
          if (id) { // a pergola over the terrace
            for (const px of [cx - pw2 / 2, cx + pw2 / 2]) line([[px, ty + RES_PENT_2D - 0.05, zt], [px, ty + RES_PENT_2D - 0.05, zt + fh * 0.85]], wood, 1.6);
            line([[cx - pw2 / 2, ty + RES_PENT_2D - 0.05, zt + fh * 0.85], [cx + pw2 / 2, ty + RES_PENT_2D - 0.05, zt + fh * 0.85]], wood, 1.6);
            if (near) for (let q = 0; q <= 5; q++) { const px = cx - pw2 / 2 + (q * pw2) / 5; line([[px, ty + 0.02, zt + fh * 0.88], [px, ty + RES_PENT_2D - 0.03, zt + fh * 0.88]], dn("#6d523a", "#2a2018"), 1); }
            for (const px of [cx - pw2 / 2 - 0.2, cx + pw2 / 2 + 0.1]) box(px, ty + 0.1, 0.12, 0.12, 0.12, "#5fae5a", "#4c9448", "#3f7e3c", zt);
          }
          fr(bx, bx + bw, y + dd, zt, zt + 0.1, dn("rgba(150,190,210,0.45)", "rgba(150,170,190,0.25)")); line([[bx, y + dd, zt + 0.105], [bx + bw, y + dd, zt + 0.105]], wood, 1.3);
        });
      }
    });
    balc.splice(0).forEach((fn) => fn());
    // the bay's own top: a low gable with a chimney, a roof garden, or a water tank (all within 0.28 of the old roof)
    const td = topLv === 3 ? dd - RES_PENT_2D : dd;
    if (b.roof === "gable") {
      // a tiled roof with a low ridge: the slopes run up from the front and back eaves to a flat top (a mansard), so it
      // reads as a roof from above without a great sheet of tiles; the end wall shows its outline; a chimney
      const rh = 0.24, run = Math.min(0.6, td / 3), tile = dn("#b5603f", "#4c2c22"), tileD = dn("#954c33", "#3e241c"), e2 = 0.05;
      const P = (a, b, c) => toScreen(a, b, c), xa = bx - e2, xb = bx + bw + e2;
      poly([P(xa, y - e2, h), P(xb, y - e2, h), P(xb, y + run, h + rh), P(xa, y + run, h + rh)], tileD);
      poly([P(xa, y + run, h + rh), P(xb, y + run, h + rh), P(xb, y + td - run, h + rh), P(xa, y + td - run, h + rh)], dn("#d8cdbd", "#4a453e"));
      poly([P(xa, y + td + e2, h), P(xb, y + td + e2, h), P(xb, y + td - run, h + rh), P(xa, y + td - run, h + rh)], tile);
      if (near) for (let q = 1; q < Math.round(bw / 0.35); q++) { const qx = bx + (q * bw) / Math.round(bw / 0.35); line([[qx, y + td + e2, h], [qx, y + td - run, h + rh]], tileD, 0.8); }
      poly([P(bx + bw, y, h), P(bx + bw, y + td, h), P(bx + bw, y + td - run, h + rh), P(bx + bw, y + run, h + rh)], dn(resShade(wall, 0.84), resShade(wall, 0.3)));
      box(bx + bw * 0.7, y + td * 0.3, 0.14, 0.14, 0.27, "#9a6450", "#8e5a48", "#7a4c3c", h);
    } else if (b.roof === "garden") {
      box(bx + 0.06, y + 0.06, bw - 0.12, td - 0.12, 0.04, dn("#ece6da", "#55534e"), slab[1], slab[2], h); // the parapet
      box(bx + bw * 0.2, y + td * 0.25, bw * 0.6, td * 0.45, 0.05, dn("#6fae5c", "#355a36"), dn("#7a5a40", "#3c2e22"), dn("#6b4f3a", "#33271d"), h + 0.04);
      for (let q = 0; q < 3; q++) box(bx + bw * (0.28 + q * 0.18), y + td * (0.35 + 0.08 * (q % 2)), 0.16, 0.16, 0.12, "#5fae5a", "#4c9448", "#3f7e3c", h + 0.09);
    } else {
      box(bx + 0.06, y + 0.06, bw - 0.12, td - 0.12, 0.04, dn("#ece6da", "#55534e"), slab[1], slab[2], h);
      const tx = bx + bw * 0.62, tz = y + td * 0.25;
      box(tx, tz, 0.4, 0.4, 0.06, wood, dn("#6d523a", "#3a2c20"), dn("#5e4632", "#33271d"), h + 0.04);
      box(tx + 0.03, tz + 0.03, 0.34, 0.34, 0.16, dn("#a07d58", "#4e3c2a"), wood, dn("#6d523a", "#3a2c20"), h + 0.1);
      box(bx + bw * 0.22, y + td * 0.35, 0.22, 0.22, 0.14, "#9a6450", "#8e5a48", "#7a4c3c", h + 0.04);
    }
  });
  // two windows a storey down the side (the last bay's end wall), framed, lit when anyone on that floor is home
  const eb = F.bays[F.bays.length - 1];
  r.floors.forEach((f, i) => {
    const zA = Z0 + (f.storey - 1) * fh, lv = f.level, sd = d - eb.inset - (lv === 3 ? RES_PENT_2D : 0);
    for (let s = 0; s < f.span; s++) for (const fy of [0.2, 0.62]) { const z0 = zA + s * fh + fh * 0.25, z1 = z0 + fh * (lv === 3 ? 0.6 : 0.42), q = (a, b, c, e, fill) => poly([toScreen(x + w, y + sd * a, c), toScreen(x + w, y + sd * b, c), toScreen(x + w, y + sd * b, e), toScreen(x + w, y + sd * a, e)], fill); q(fy - 0.015, fy + 0.175, z0 - 0.02, z1 + 0.02, trim); q(fy, fy + 0.16, z0, z1, f.busy ? warm(i + s) : glass); }
  });
  // each level's word beside its floors (never colour alone)
  let lastLv = -1;
  r.floors.forEach((f) => {
    const zA = Z0 + (f.storey - 1) * fh, lv = f.level;
    if (lv !== lastLv && cam.z > 0.95) { const [lx, ly] = toScreen(x + w + 0.12, y + (d - eb.inset) * 0.92, zA + fh * 0.45); ctx.font = `700 ${Math.round(Math.min(12, Math.max(9, 8 * cam.z)))}px system-ui`; ctx.textAlign = "left"; haloText(resLevel(lv).name, lx, ly, dn("rgba(60,48,30,0.92)", "rgba(240,230,210,0.9)")); }
    lastLv = lv;
  });
  // the entrance: glass double doors in a frame, mailboxes, a canopy on posts with the word, steps
  fr(door - 0.34, door + 0.34, y + d, 0, 0.33, trim);
  fr(door - 0.3, door + 0.3, y + d, 0.02, 0.3, night > 0.3 ? "rgba(255,220,150,0.95)" : dn("#7d8fa3", "#3a3328"));
  fr(door - 0.008, door + 0.008, y + d, 0.02, 0.3, dn("#5a4a38", "#2a241c"));
  fr(door + 0.42, door + 0.66, y + d, 0.13, 0.3, dn("#4f5560", "#2c3036"));
  box(door - 0.42, y + d, 0.84, 0.14, 0.02, slab[0], slab[1], slab[2], 0); box(door - 0.36, y + d, 0.72, 0.08, 0.04, slab[0], slab[1], slab[2], 0);
  const acc0 = (F.bayAt(F.door) || F.bays[0]).accent;
  for (const px of [door - 0.5, door + 0.5]) line([[px, y + d + 0.42, 0], [px, y + d + 0.42, 0.36]], dn("#6d523a", "#2a2018"), 1.4);
  box(door - 0.56, y + d, 1.12, 0.46, 0.035, dn(resShade(acc0, 1.15), resShade(acc0, 0.5)), dn(acc0, resShade(acc0, 0.4)), dn(resShade(acc0, 0.8), resShade(acc0, 0.35)), 0.36);
  if (cam.z > 0.9) { const [tx, ty] = toScreen(door, y + d + 0.46, 0.33); ctx.font = `700 ${Math.round(Math.max(7, Math.min(13, 5.2 * cam.z)))}px system-ui`; ctx.textAlign = "center"; haloText("Residences", tx, ty + 3 * cam.z, dn("rgba(60,40,24,0.95)", "rgba(250,240,220,0.95)")); }
  // planting along the front: hedges, small round trees, flower beds by the door; benches; a bike rack; a lamp
  const hy = y + d + 0.18;
  const runs = small ? [] : [[x + 0.2, door - 2.6], [door + 2.0, x + w - 0.2]];
  for (const [a0, b0] of runs) for (let a = a0; a < b0 - 0.3; a += 2.4) { const e = Math.min(b0, a + 1.7); box(a, hy, e - a, 0.2, 0.14, leafC, leafD, dn("#336b3a", "#1f3d26"), 0); if (e + 0.5 < b0) roundTree(e + 0.35, hy + 0.12, 0.8); }
  for (const s of [-1, 1]) { const fx = small ? (s < 0 ? x + 0.2 : x + w - 0.6) : door + s * 1.25 - 0.2; box(fx, hy, 0.4, 0.22, 0.05, dn("#7a5a40", "#3c2e22"), dn("#6b4f3a", "#33271d"), dn("#5e4632", "#2c2219"), 0); flowers(fx + 0.04, fx + 0.36, hy + 0.11, 0.07, s < 0 ? 0 : 2); }
  for (const s of [-1, 1]) { const bx = door + s * (small ? 1.55 : 1.75); if (bx < x + 0.4 || bx > x + w - 0.4) continue; box(bx - 0.28, hy + 0.12, 0.56, 0.14, 0.09, wood, dn("#6d523a", "#3a2c20"), dn("#5e4632", "#33271d"), 0); }
  if (!small && near) for (let q = 0; q < 3; q++) { const px = door - 2.5 + q * 0.2; line([[px, hy + 0.05, 0], [px, hy + 0.05, 0.13], [px, hy + 0.3, 0.13], [px, hy + 0.3, 0]], dn("#4f5560", "#8a929c"), 1.2); }
  lamp(door + 1.0, y + d + 0.6);
  if (!small) lamp(door - 1.0, y + d + 0.6);
}
// Tap a Residences tower: inside it (the floors view) with this list. Who lives on which floor, top down, with each
// level's word; tap a name to open their home.
function homesPanel(id = "homes") {
  const L = RES || resLayout(), tw = L.towers.find((x) => x.id === id) || L.towers[0]; if (!tw) return;
  const others = L.towers.filter((x) => x !== tw), credits = (k) => data.wallets?.[k]?.earned || 0, LV = campusHomes.LEVELS;
  const homesN = tw.floors.reduce((a, f) => a + f.flats.filter(Boolean).length, 0), toLet = tw.floors.reduce((a, f) => a + f.flats.filter((x) => !x).length + Math.max(0, f.perFloor - f.flats.length), 0);
  const inNow = tw.floors.flatMap((f) => f.flats).filter((k) => { const d = k && deskById(k); return d && whereIs(d) === "home"; }).length;
  const p = showPanel(tw.id, `🏘️ ${esc(tw.name)}`, `
    <div class="sub mt-1">${tw.storeys} floor${tw.storeys === 1 ? "" : "s"} · ${homesN} home${homesN === 1 ? "" : "s"}${toLet ? ` · ${toLet} to let` : ""} · ${inNow} home now${others.length ? ` · one of ${others.length + 1} towers (none taller than your CEO tower)` : ""}</div>
    ${[...tw.floors].reverse().map((f) => { const empty = f.flats.filter((x) => !x).length + Math.max(0, f.perFloor - f.flats.length), lab = f.span > 1 ? `${f.storey}-${f.storey + 1}F` : `${f.storey}F`;
      // a plain list (the owner's phone, 2026-11-16: the chips scattered with gaps): a heading per floor in words, one row per home, the empty flats in one line
      return `<div class="mt-3" style="font-weight:600">${esc(lab)} · ${esc(f.levelName)}</div>${f.flats.filter(Boolean).map((k) => { const d = deskById(k); if (!d) return ""; const st = whereIs(d), n = shownIn(k).storedCount || 0;
        return `<button data-home="${esc(k)}" style="display:flex;width:100%;gap:8px;align-items:baseline;text-align:left;padding:5px 2px;border-bottom:1px solid rgba(127,127,127,0.18);background:none;color:inherit;cursor:pointer"><span style="flex:1 1 auto">${st === "home" ? "💡 " : ""}<b style="color:inherit">${esc(nameOf(d))}</b> <span class="sub">${esc(f.levelName)} · ${credits(k)} earned</span></span><span class="sub" style="white-space:nowrap">${esc(st === "home" ? "home" : { work: "at work", away: "away", nowhere: "moving in", meeting: "in a meeting" }[st] || "out")}${n ? ` · +${n} in storage` : ""}</span></button>`; }).join("")}${empty ? `<div class="sub" style="padding:5px 2px">${empty} to let</div>` : ""}`; }).join("")}
    <div class="sub mt-3">Everyone gets: ${esc(campusHomes.SHARED.join(", "))}. Every home comes with a bed, a table and chairs, a kitchen, a bathroom, storage, lights and heating.</div>
    <details class="sub mt-1"><summary>The four kinds of home</summary>${LV.map((l, i) => { const h = campusHomes.HOMETYPES[i]; return `<b style="color:inherit">${esc(l.name)}</b>: ${esc(h.type)}, ${esc(h.area)}${i ? `, ${String(Math.round(l.area * 10) / 10)} times a studio's floor` : ""} (${esc(h.rooms)}; ${esc(h.outside)})`; }).join(" · ")}.</details>
    <div class="sub mt-1">Homes go by credits earned: ${LV.map((l, i) => `<b style="color:inherit">${esc(l.name)}</b> ${i === 0 ? "to start" : i === LV.length - 1 ? `from ${l.min}, the top tenth, two floors` : `from ${l.min}`}`).join(" · ")}. When a level changes they move, and the feed says so.</div>
    ${others.length ? `<div class="flex flex-wrap gap-2 mt-3">${others.map((o) => `<button class="pill" data-tower="${esc(o.id)}">${esc(o.name)}</button>`).join("")}</div>` : ""}`);
  p.querySelectorAll("[data-home]").forEach((b) => (b.onclick = () => openHome(b.dataset.home)));
  p.querySelectorAll("[data-tower]").forEach((b) => (b.onclick = () => { setView(b.dataset.tower); homesPanel(b.dataset.tower); }));
}
// One floor inside a tower: its flats, who's home, what's to let.
function resFloorPanel(id) {
  if (/::lobby$/.test(String(id))) return homesPanel(String(id).split("::")[0]); // the lobby: the building's panel
  const f = rooms.find((x) => x.id === id) || resFloors(String(id).split("::")[0]).find((x) => x.id === id); if (!f) return;
  const lv = resLevel(f.level);
  const p = showPanel(f.id, `🏘️ ${esc(f.towerName)} <span class="sub">· ${esc(f.span > 1 ? `Floors ${f.storey}-${f.storey + 1}` : `Floor ${f.storey}`)} · ${esc(lv.name)}</span>`, `
    <div class="sub mt-1">${esc(lv.name)}: ${esc(f.span > 1 ? `${f.perFloor > 1 ? `${f.perFloor} two-floor penthouses side by side, each` : "a two-floor penthouse"} with a roof terrace` : `${f.perFloor} ${lv.plural} a floor`)}. Tap a home to look inside.</div>
    ${Array.from({ length: f.perFloor }, (_, j) => f.flats[j]).map((k, j) => { const d = k && deskById(k); return `<div class="row">${d ? `<button class="pill" data-home="${esc(k)}">${esc(nameOf(d))}</button> <span class="sub">${esc(titleOf(d))} · ${data.wallets?.[k]?.earned || 0} earned · ${esc({ home: "home now", work: "at work", out: "out", away: "away (paused)", nowhere: "moving in soon (planned)", meeting: "at the board meeting", queue: "waiting on you", coffee: "at the coffee cart" }[whereIs(d)] || "out")}</span>${moveLine(k)}` : `<span class="sub">Flat ${j + 1}: to let</span>`}</div>`; }).join("")}`);
  p.querySelectorAll("[data-home]").forEach((b) => (b.onclick = () => openHome(b.dataset.home)));
}
// Open someone's home: the room view in 3D, cut away in the tower in 2D (or its floor, when you're inside the tower).
function openHome(id) {
  const hr = homeOf(id) || (resLayout(), cityHomeRecord(id)); if (!hr) return;
  if (window.campus3dActive) setView(hr.id);
  else if (view && !isResView(view)) setView(null);
  housePanel(hr);
}
// A home record while inside a tower (HOMES is filled on the campus view): the same fields cityHouses gives.
function cityHomeRecord(id) {
  const h = RES?.homes?.[id], d = deskById(id); if (!h || !d) return null;
  const p = h.levelKey === "penthouse";
  return { id: `house:${id}`, isHouse: true, inTower: true, tower: h.tower, towerName: h.towerName, desk: d, street: projects.find((x) => x.id === d.room)?.name || d.room, level: h.level, levelKey: h.levelKey, levelName: h.levelName, size: Math.min(2, h.level), penthouse: p, floor: h.storey, span: h.span, floorName: h.floorName, flat: h.flat, name: `${nameOf(d)}'s ${p ? "penthouse" : "flat"}`, x: 0, y: 0, w: 0, d: 0, h: 0, face: "s", hue: hueOf(d.room) };
}
// ---- Inside the Residences, 2D (2026-11-16, the residences-inside lane; plan docs/handoffs/residences-inside-plan.md).
// the owner: "the drill-in of the apartment is still the old look vs the new layout"; "the inside also looked like a
// prison on some levels"; "each person should at least get basic needs covered in their place". The inside is the same
// building as the outside: each flat sits in the bay you see it in from outside (campusHomes.facade().bayOfFlat), takes
// that bay's colour on its accent wall and in its floor boards, and has the level's window and balcony seen from inside.
// Every flat (a flat to let too) comes with the level's basics (campusHomes.BASICS: a bed, a table and chairs, a
// kitchen, a bathroom, a wardrobe, a lamp, a radiator) as part of the room, never as belongings; what the owner bought
// still comes from the belongings rule (shownOwned / ownAt). The 3D twin is resRoom3D in 3d/main3d.js.
const resMix = (a, b, k) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - k) + parseInt(b.slice(i, i + 2), 16) * k).toString(16).padStart(2, "0")).join("");
const resNt = (hex, k = 0.45) => dn(hex, resShade(hex, k)); // a colour by day, the same darker at night
const _resInMemo = new WeakMap();
// the outside's bays for a tower id (the same facade() call drawHomes makes from the same floors, so they agree)
function resInFacade(towerId) {
  const tw = (RES || resLayout()).towers.find((t) => t.id === towerId); if (!tw) return null;
  let F = _resInMemo.get(tw); if (!F) { F = campusHomes.facade({ w: 1, floors: tw.floors, id: tw.id }); _resInMemo.set(tw, F); }
  return F;
}
// a little person (the same figure as before), standing or sitting at a ground point
function resPerson2D(dk, px, py, s) {
  ctx.fillStyle = PROVIDER[dk.provider] || PROVIDER.other; roundRect(px - 5 * s, py - 16 * s, 10 * s, 11 * s, 3 * s); ctx.fill();
  ctx.fillStyle = "#f4ecdc"; roundRect(px - 6 * s, py - 26 * s, 12 * s, 10 * s, 4 * s); ctx.fill();
  ctx.fillStyle = "#1b1f27"; ctx.fillRect(px - 3.5 * s, py - 23 * s, 2 * s, 2.2 * s); ctx.fillRect(px + 1.5 * s, py - 23 * s, 2 * s, 2.2 * s);
}
// One flat, cut away from the front. o: { a, y0, cw, FD, lv, id, dk, bay, curtain, t, full, ph, z }
//   a..a+cw across; y0 = its corridor wall (the front door), y0+FD = its window; z = the floor's height (0).
// Returns where its owner sits, for the caller to draw them and their name.
function resRoom2D(o) {
  const { a, y0, cw, FD, lv, id, dk, bay, t } = o, full = !!o.full, PH = o.ph || 0.6, z = o.z || 0, Y1 = y0 + FD;
  const near = cam.z > (full ? 0.35 : 0.8), home = !!dk && whereIs(dk) === "home", lit = home && night > 0.3, toLet = !dk;
  const own = dk ? shownOwned(id) : [], has = (k) => own.includes(k) || (RES_COMES[lv] || []).includes(k);
  const P = (x, y, h = 0) => toScreen(x, y, z + h);
  const quad = (x0, ya, x1, yb, h, fill) => poly([P(x0, ya, h), P(x1, ya, h), P(x1, yb, h), P(x0, yb, h)], fill);
  const faceX = (x, ya, yb, h0, h1, fill) => poly([P(x, ya, h0), P(x, yb, h0), P(x, yb, h1), P(x, ya, h1)], fill); // seen from +x
  const faceY = (y, xa, xb, h0, h1, fill) => poly([P(xa, y, h0), P(xb, y, h0), P(xb, y, h1), P(xa, y, h1)], fill); // seen from +y
  const bx = (x, y, w, d, h, top, front, side, h0 = 0) => box(x, y, w, d, h, top, front, side, z + h0);
  const line = (pts, stroke, wdt = 1) => { ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, wdt * cam.z); ctx.beginPath(); pts.forEach(([p, q, h], i) => { const [sx, sy] = P(p, q, h); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }); ctx.stroke(); };
  const glowAt = (px, py, h, r, a) => { const [sx, sy] = P(px, py, h), R = r * cam.z, g = ctx.createRadialGradient(sx, sy, 0, sx, sy, R); g.addColorStop(0, `rgba(255,214,140,${a})`); g.addColorStop(1, "rgba(255,214,140,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, R, 0, Math.PI * 2); ctx.fill(); };
  const wood = resNt("#9a7550"), woodF = resNt("#7d5c3e"), woodS = resNt("#6a4d34"), white = resNt("#f6f2ea"), whiteF = resNt("#e6dfd2"), whiteS = resNt("#d3cbbd");
  const trim = resNt("#fbf6ec"), wallIn = resNt(resMix("#f4ecdc", bay.wall, 0.35)), accentW = resNt(bay.wall), accent = resNt(bay.accent), steel = resNt("#b9c0c6");
  const cur = o.curtain || "#f3e7c9", curC = resNt(cur), curD = resNt(resShade(cur, 0.86)), green = resNt("#5fae5a"), greenD = resNt("#4c9448");
  // the floor: warm boards with the bay's colour in them; daylight through the window by day
  quad(a, y0, a + cw, Y1, 0, resNt(resMix(["#d4ad80", "#cda070", "#c09468", "#c9a882"][lv], bay.wall, 0.28)));
  if (near) { ctx.strokeStyle = dn("rgba(110,74,40,0.14)", "rgba(0,0,0,0.2)"); ctx.lineWidth = 1; for (let q = a + 0.32; q < a + cw - 0.1; q += 0.32) { const [p1x, p1y] = P(q, y0), [p2x, p2y] = P(q, Y1); ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke(); } }
  const winW = Math.min(cw - 0.3, cw * [0.5, 0.56, 0.84, 0.94][lv]), wx0 = a + (cw - winW) / 2, wx1 = wx0 + winW;
  if (night < 0.55) quad(wx0, Y1 - Math.min(1.6, FD * 0.38), wx1, Y1, 0.003, `rgba(255,247,220,${(0.3 * (1 - night / 0.55)).toFixed(3)})`);
  if (lit) quad(a, y0, a + cw, Y1, 0.003, "rgba(255,206,130,0.16)"); // their lights are on: the whole room is warm
  // walls: the corridor wall (its front door) and the partition on the left, its inside the bay's colour (an accent
  // wall, so you can tell which bay you are in); low, with a light cap, no dark edges
  const doorX = a + cw * (lv === 3 ? 0.5 : 0.4), doorW = Math.min(0.42, cw * 0.18), dH = Math.min(PH * 0.92, full ? 0.95 : 0.5);
  bx(a, y0 - 0.06, cw, 0.06, PH, trim, wallIn, null);
  faceY(y0 + 0.001, doorX - 0.03, doorX + doorW + 0.03, 0, dH + 0.03, trim); faceY(y0 + 0.002, doorX, doorX + doorW, 0, dH, wood); // the front door, from inside
  if (near) { const [kx, ky] = P(doorX + doorW * 0.82, y0 + 0.003, dH * 0.5); ctx.fillStyle = resNt("#d9b45a"); ctx.beginPath(); ctx.arc(kx, ky, Math.max(1, 1.2 * cam.z), 0, Math.PI * 2); ctx.fill(); }
  quad(doorX + 0.02, y0 - 0.3, doorX + doorW - 0.02, y0 - 0.08, 0.004, resNt(resMix("#8a6a48", bay.accent, 0.35))); // the mat outside it, in the corridor
  bx(a - 0.03, y0, 0.06, FD, PH, trim, trim, accentW);
  // the bathroom: a tiled corner behind its own walls and door (shower; a bath from Nice up)
  const FX = campusHomes.FIXTURES[lv], bW = Math.min(FX.bath[0], cw * (lv === 3 ? 0.2 : 0.36)), bD = Math.min(FX.bath[1], FD * 0.27), bH = PH * 0.72;
  quad(a + 0.03, y0, a + bW, y0 + bD, 0.003, resNt("#e4eef0"));
  if (near) for (let q = 0.18; q < bD; q += 0.18) line([[a + 0.04, y0 + q, 0.004], [a + bW, y0 + q, 0.004]], dn("rgba(150,170,175,0.4)", "rgba(0,0,0,0.25)"), 0.6);
  bx(a + 0.08, y0 + 0.06, 0.34, 0.34, 0.03, resNt("#cfe6f0"), white, whiteS); // the shower tray
  if (lv >= 2) bx(a + 0.48, y0 + 0.06, Math.min(0.7, bW - 0.55), 0.34, 0.16, resNt("#bfe0ee"), white, whiteS); // a bath
  else bx(a + bW - 0.3, y0 + 0.08, 0.18, 0.22, 0.12, white, whiteF, whiteS); // the toilet
  bx(a + bW - 0.03, y0, 0.06, bD, bH, trim, trim, resNt("#eef3f3"));
  bx(a, y0 + bD - 0.03, bW - 0.32, 0.06, bH, trim, resNt("#eef3f3"), null);
  faceY(y0 + bD + 0.03, a + bW - 0.3, a + bW - 0.04, 0, bH * 0.95, wood); // its door
  // a wardrobe along the left wall (a bigger one, or a dressing room upstairs, higher up)
  const wdY = y0 + bD + 0.12, wdD = FX.wardrobe;
  if (lv < 3) { bx(a + 0.05, wdY, 0.28, wdD, PH * 0.95, wood, woodF, woodF); if (near) faceX(a + 0.331, wdY + wdD / 2 - 0.005, wdY + wdD / 2 + 0.005, 0.03, PH * 0.9, woodS); }
  // the kitchen along the corridor wall, right of the front door: a counter with a sink and a hob, a fridge at the end,
  // cupboards over it from Comfy up, an island with stools from Nice up
  const kx0 = doorX + doorW + 0.14, kL = Math.max(0.8, Math.min(a + cw - 0.2 - kx0, FX.kitchen)), top = resNt(["#e9e3d8", "#e2dccf", "#d8d2c8", "#cfc9c0"][lv]), front = resNt(lv >= 2 ? resMix("#f6f2ea", bay.accent, 0.35) : "#f6f2ea");
  if (lv >= 1 && near) faceY(y0 + 0.001, kx0, kx0 + kL - 0.36, 0.44, PH * 0.92, resNt("#fbf6ec")); // wall cupboards
  bx(kx0, y0 + 0.04, kL - 0.36, 0.32, 0.32, top, front, front);
  quad(kx0 + 0.08, y0 + 0.09, kx0 + 0.3, y0 + 0.3, 0.325, steel); // the sink
  quad(kx0 + kL - 0.78, y0 + 0.08, kx0 + kL - 0.46, y0 + 0.32, 0.325, resNt("#3a3f48")); // the hob
  if (near) for (const q of [0.7, 0.55]) { const [hx, hy] = P(kx0 + kL - q + 0.06, y0 + 0.2, 0.33); ctx.strokeStyle = dn("rgba(200,200,200,0.7)", "rgba(120,120,120,0.6)"); ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(hx, hy, 2.4 * cam.z, 1.3 * cam.z, 0, 0, Math.PI * 2); ctx.stroke(); }
  bx(kx0 + kL - 0.32, y0 + 0.04, 0.3, 0.3, lv >= 1 ? 0.7 : 0.5, white, whiteF, whiteS); // the fridge
  if (lv >= 2) { const iw = Math.min(1.5, kL - 0.4); bx(kx0 + 0.1, y0 + 0.75, iw, 0.36, 0.3, top, front, front); for (let q = 0; q < (lv === 3 ? 3 : 2); q++) bx(kx0 + 0.2 + (q * (iw - 0.3)) / Math.max(1, lv === 3 ? 2 : 1), y0 + 1.2, 0.16, 0.16, 0.2, woodF, wood, woodS); }
  // where they sleep: a single bed (Basic), a double (Comfy), a double in its own room behind a half wall (Nice);
  // the penthouse's is upstairs on the gallery. A bought comfy bed is the bed (never two): fuller, a blue cover.
  const comfy = has("bed"), [bedW, bedD] = FX.bed;
  const bed = (x, y, h0) => { bx(x, y, bedW, bedD, 0.1, woodF, wood, woodS, h0); bx(x + 0.03, y + 0.03, bedW - 0.06, bedD - 0.06, 0.06, white, whiteF, whiteS, h0 + 0.1); bx(x + 0.04, y + bedD * 0.38, bedW - 0.08, bedD * 0.58, 0.02, comfy ? resNt("#6ea8ff") : curC, comfy ? resNt("#5a8ad8") : curD, comfy ? resNt("#5a8ad8") : curD, h0 + 0.16); bx(x + 0.08, y + 0.07, bedW - 0.16, 0.18, 0.04, white, whiteF, whiteS, h0 + 0.16); faceY(y - 0.001, x, x + bedW, h0, h0 + 0.32, woodF); };
  let bedAt = null;
  // a bedroom behind a half wall: Nice, and Comfy now it has a one-bedroom's width (the sizes lane, 2026-11-16)
  const bedroom = lv === 2 || (lv === 1 && cw >= 3.8);
  if (lv < 3) {
    const by = bedroom ? y0 + bD + 0.15 : Math.min(Y1 - bedD - 1.0, wdY + wdD + 0.18), bxx = bedroom ? a + 0.4 : a + 0.08;
    if (bedroom) { const ry = by + bedD + 0.35; bx(a, ry - 0.03, Math.min(cw * 0.45, 2.0) - 0.45, 0.06, PH * 0.8, trim, wallIn, null); } // the bedroom's half wall, its doorway on the right
    bed(bxx, by, 0); bedAt = [bxx, by];
    quad(bxx + bedW + 0.04, by + 0.25, bxx + bedW + 0.34, by + bedD * 0.8, 0.004, resNt(resMix("#e8d6b8", bay.accent, 0.25))); // a bedside mat
    // a picture over the bed, on the accent wall
    faceX(a + 0.032, by + 0.15, by + bedD - 0.15, PH * 0.45, PH * 0.9, trim); faceX(a + 0.034, by + 0.2, by + bedD - 0.2, PH * 0.5, PH * 0.85, resNt(resMix(bay.accent, "#f3e7c9", 0.35)));
  }
  // the floor lamp by the bed (or the sofa), lit at night when they're home
  const lampX = lv === 3 ? a + cw * 0.36 : (bedAt ? bedAt[0] + bedW + 0.18 : a + 0.5), lampY = lv === 3 ? Y1 - 1.2 : (bedAt ? bedAt[1] + 0.12 : y0 + FD * 0.5);
  if (lit) { const [gx, gy] = P(lampX, lampY, 0.004); ctx.fillStyle = "rgba(255,210,140,0.18)"; ctx.beginPath(); ctx.ellipse(gx, gy, 34 * cam.z, 16 * cam.z, 0, 0, Math.PI * 2); ctx.fill(); }
  line([[lampX, lampY, 0], [lampX, lampY, 0.52]], resNt("#4a4a4a"), 1);
  bx(lampX - 0.08, lampY - 0.08, 0.16, 0.16, 0.12, lit ? "#ffe6a8" : resNt("#f3e2c0"), lit ? "#ffd88a" : resNt("#e8d2a8"), lit ? "#f2c878" : resNt("#d8c098"), 0.5);
  if (lit) glowAt(lampX, lampY, 0.56, 22, 0.55);
  // the table and chairs (two, four from Nice up, six in the penthouse) by the window
  const seats = FX.seats, tW = FX.table, tX = lv === 3 ? a + cw * 0.62 : a + cw - tW - 0.55, tY = lv >= 2 ? y0 + FD * 0.58 : Y1 - 0.95;
  bx(tX, tY, tW, 0.45, 0.24, wood, woodF, woodS);
  for (let s = 0; s < seats; s++) { const side = s % 2, col = Math.floor(s / 2), n2 = Math.ceil(seats / 2), cx = tX + ((col + 0.5) * tW) / n2 - 0.07; bx(cx, side ? tY + 0.5 : tY - 0.2, 0.14, 0.14, 0.14, resNt(resMix("#8b6a4a", bay.accent, 0.3)), woodF, woodS); }
  // the radiator under the window (a fireplace in the penthouse)
  const radW = Math.min(0.9, winW * 0.5), radX = a + (cw - radW) / 2;
  if (lv === 3) { bx(a + 0.08, Y1 - 1.9, 0.3, 0.7, 0.42, resNt("#c9bfae"), resNt("#b8ae9c"), resNt("#a69c8a")); faceX(a + 0.381, Y1 - 1.75, Y1 - 1.35, 0.06, 0.26, lit || night > 0.3 ? "rgba(255,150,70,0.9)" : resNt("#2c2a28")); }
  else { bx(radX, Y1 - 0.16, radW, 0.07, 0.16, white, whiteF, whiteS); if (near) for (let q = radX + 0.06; q < radX + radW - 0.02; q += 0.08) faceY(Y1 - 0.089, q, q + 0.012, 0.02, 0.14, whiteS); }
  // the level's extras (FURNISHED) and a plant: a rug, a sofa, a TV, shelves
  if (has("rug")) quad(a + cw * 0.3, Y1 - 2.35, a + cw * 0.3 + Math.min(1.6, cw * 0.38), Y1 - 1.05, 0.005, resNt(resMix(lv >= 2 ? "#7d5ba6" : "#c94f6d", bay.accent, 0.25)));
  else quad(a + cw * 0.36, Y1 - 1.25, a + cw * 0.36 + Math.min(0.8, cw * 0.3), Y1 - 0.5, 0.005, resNt(resMix("#d8b48a", bay.accent, 0.3))); // a small woven mat every flat has
  let seat = null;
  if (has("couch")) { const sw = Math.min(1.25, cw * 0.38), sx = a + cw * 0.32, sy = Y1 - 1.5, sc = resMix("#9a7fd0", bay.accent, 0.45); bx(sx, sy, sw, 0.36, 0.14, resNt(sc), resNt(resShade(sc, 0.9)), resNt(resShade(sc, 0.8))); bx(sx, sy + 0.26, sw, 0.1, 0.28, resNt(resShade(sc, 0.95)), resNt(resShade(sc, 0.85)), resNt(resShade(sc, 0.75))); seat = [sx + sw / 2, sy + 0.18, 0.14]; }
  if (has("tv")) bx(a + cw * 0.32 + 0.2, Y1 - 2.55, Math.min(0.8, cw * 0.25), 0.06, 0.4, resNt("#2c3440"), lit ? `hsl(${(t / 30) % 360},55%,62%)` : resNt("#1d232c"), resNt("#161b22"), 0.12);
  if (has("bookshelf")) { const sx = lv === 3 ? a + 0.1 : a + Math.min(cw * 0.45, 2.0) - 0.75; bx(sx, lv === 3 ? Y1 - 2.7 : y0 + bD + 0.1, lv === 3 ? 0.2 : 0.6, lv === 3 ? 0.6 : 0.18, PH * 0.9, wood, woodF, woodS); }
  bx(a + cw - 0.32, Y1 - 0.32, 0.16, 0.16, 0.14, resNt("#b5683c"), resNt("#a45a32"), resNt("#8e4e2c")); bx(a + cw - 0.34, Y1 - 0.34, 0.2, 0.2, 0.18, green, greenD, greenD, 0.14); // a plant in the corner
  // the penthouse: a stair up to the gallery over the back of the room, the big bed and a dressing room up there
  if (lv === 3) {
    const G = o.gallery || 1.25, gx0 = a + bW + 0.75, gw = Math.max(1.9, doorX - 0.25 - gx0), gd = FD * 0.42;
    for (let s = 0; s < 6; s++) bx(a + bW + 0.12, y0 + gd + 0.9 - s * 0.16, 0.55, 0.16, (G * (s + 1)) / 6, resNt("#d8cfbd"), resNt("#c4bba8"), resNt("#b2a994"));
    bx(gx0, y0, gw, gd, 0.06, resNt(resMix("#d4ad80", bay.wall, 0.28)), trim, trim, G);
    bx(gx0 + 0.15, y0 + 0.12, 0.6, 0.6, PH * 0.9, wood, woodF, woodF, G + 0.06); // the dressing room's wardrobe
    bed(gx0 + 0.95, y0 + 0.12, G + 0.06); bedAt = [gx0 + 0.95, y0 + 0.12];
    line([[gx0, y0 + gd, G + 0.42], [gx0 + gw, y0 + gd, G + 0.42]], resNt("#5a4a38"), 1.2);
    poly([P(gx0, y0 + gd, G + 0.06), P(gx0 + gw, y0 + gd, G + 0.06), P(gx0 + gw, y0 + gd, G + 0.42), P(gx0, y0 + gd, G + 0.42)], dn("rgba(170,210,235,0.25)", "rgba(120,150,180,0.18)")); // its glass rail
    if (lit) glowAt(gx0 + gw * 0.7, y0 + 0.3, G + 0.6, 18, 0.4);
  }
  // the front: a low sill, the window (a balcony door from Comfy up, a glass wall in the penthouse), curtains
  const WT = lv === 3 ? Math.max(PH * 1.6, (o.gallery || 1.25) + 0.5) : full ? PH * 0.95 : PH * 1.05, door = lv >= 1 && lv < 3, gz0 = door ? 0 : 0.16;
  if (!door && lv < 3) bx(a, Y1 - 0.05, cw, 0.08, 0.16, trim, resNt(resShade(bay.wall, 0.96)), null);
  else { bx(a, Y1 - 0.05, wx0 - a, 0.08, 0.16, trim, resNt(resShade(bay.wall, 0.96)), null); bx(wx1, Y1 - 0.05, a + cw - wx1, 0.08, 0.16, trim, resNt(resShade(bay.wall, 0.96)), null); }
  const glassC = lit ? "rgba(255,214,140,0.22)" : night > 0.5 ? "rgba(24,30,44,0.28)" : "rgba(175,212,240,0.16)";
  faceY(Y1 + 0.03, wx0, wx1, gz0, WT, glassC);
  line([[wx0, Y1 + 0.03, gz0], [wx0, Y1 + 0.03, WT], [wx1, Y1 + 0.03, WT], [wx1, Y1 + 0.03, gz0]], trim, 1.3);
  if (lv === 3 && near) for (let q = wx0 + 1.6; q < wx1 - 0.4; q += 1.6) line([[q, Y1 + 0.03, gz0], [q, Y1 + 0.03, WT]], trim, 0.8);
  const cW = Math.min(0.22, winW * 0.16);
  bx(wx0 - 0.02, Y1 - 0.06, cW, 0.04, WT - gz0, curC, curC, curD, gz0); bx(wx1 - cW + 0.02, Y1 - 0.06, cW, 0.04, WT - gz0, curC, curC, curD, gz0);
  if (toLet && lv < 3) bx((wx0 + wx1) / 2 - winW * 0.3, Y1 - 0.06, winW * 0.6, 0.04, (WT - gz0) * 0.9, curC, curC, curD, gz0 + (WT - gz0) * 0.1); // to let: curtains drawn, as outside
  // outside the window, as you see it from inside: Basic's shutters and flower box; Comfy's solid painted balcony;
  // Nice's glass balcony with planters under the striped awning; the penthouse's terrace and pergola
  let bal = null;
  if (lv === 0) {
    const shut = resNt(resMix(bay.accent, "#f4ecdc", 0.3)); for (const sd of [-1, 1]) { const sa = sd < 0 ? wx0 - Math.min(0.3, winW * 0.3) : wx1 + 0.02, sb = sd < 0 ? wx0 - 0.02 : wx1 + Math.min(0.3, winW * 0.3); faceY(Y1 + 0.05, sa, sb, gz0 + 0.04, WT - 0.04, shut); }
    bx(wx0, Y1 + 0.05, winW, 0.12, 0.08, resNt("#6a8f45"), wood, woodS, 0.1);
    if (near) { const FL = ["#e86f8a", "#f2c14e", "#f4f0f0", "#d9534f", "#b48ad6"], m = Math.max(3, Math.round(winW / 0.1)); for (let q = 0; q < m; q++) { const [fx, fy] = P(wx0 + ((q + 0.5) * winW) / m, Y1 + 0.11, 0.2); ctx.fillStyle = FL[q % FL.length]; ctx.beginPath(); ctx.arc(fx, fy, Math.max(0.9, 1.6 * cam.z), 0, Math.PI * 2); ctx.fill(); } }
  } else {
    const bw = lv === 3 ? cw - 0.2 : cw * (lv === 1 ? 0.66 : 0.9), bd = [0, 0.55, 0.7, 1.0][lv], b0 = a + (cw - bw) / 2;
    bx(b0, Y1 + 0.03, bw, bd, 0.04, resNt(lv === 3 ? "#c8a57e" : "#ece6da"), resNt("#d6cdbb"), resNt("#c4bba8"));
    if (lv === 1) { faceY(Y1 + 0.03 + bd, b0, b0 + bw, 0.04, 0.3, accent); faceX(b0 + bw, Y1 + 0.03, Y1 + 0.03 + bd, 0.04, 0.3, resNt(resShade(bay.accent, 0.8))); line([[b0, Y1 + 0.03 + bd, 0.31], [b0 + bw, Y1 + 0.03 + bd, 0.31]], trim, 1.3); bx(b0 + bw * 0.3, Y1 + bd - 0.06, bw * 0.4, 0.08, 0.06, green, wood, woodS, 0.31); }
    else {
      faceY(Y1 + 0.03 + bd, b0, b0 + bw, 0.04, 0.32, dn("rgba(160,200,220,0.35)", "rgba(140,170,190,0.2)")); line([[b0, Y1 + 0.03 + bd, 0.33], [b0 + bw, Y1 + 0.03 + bd, 0.33]], wood, 1.4);
      for (const px of [b0 + 0.06, b0 + bw - 0.26]) bx(px, Y1 + 0.1, 0.2, 0.2, 0.16, green, greenD, greenD, 0.04);
      if (lv === 2) { // the awning over the balcony and its shade on the floor
        quad(b0, Y1 + 0.03, b0 + bw, Y1 + 0.03 + bd * 0.8, 0.045, "rgba(40,30,20,0.1)");
        const m = Math.max(4, Math.round(bw / 0.22)); for (let q = 0; q < m; q++) { const qa = b0 + (q * bw) / m, qb = qa + bw / m; poly([P(qa, Y1 + 0.03, WT + 0.06), P(qb, Y1 + 0.03, WT + 0.06), P(qb, Y1 + 0.03 + bd * 0.75, WT - 0.1), P(qa, Y1 + 0.03 + bd * 0.75, WT - 0.1)], q % 2 ? trim : accent); }
      } else { // the pergola over the terrace
        const pz = Math.min(WT, 1.3); for (const px of [b0 + 0.3, b0 + bw - 0.3]) line([[px, Y1 + bd - 0.05, 0.04], [px, Y1 + bd - 0.05, pz]], wood, 1.6);
        line([[b0 + 0.3, Y1 + bd - 0.05, pz], [b0 + bw - 0.3, Y1 + bd - 0.05, pz]], wood, 1.6);
        if (near) for (let q = b0 + 0.3; q <= b0 + bw - 0.29; q += 1.1) line([[q, Y1 + 0.06, pz + 0.02], [q, Y1 + bd - 0.05, pz + 0.02]], resNt("#b08a60"), 1);
      }
    }
    bal = { cx: a + cw / 2, y: Y1 + 0.03 + bd * 0.5, bw: bw * 0.8 };
  }
  return { seat, bedAt, bal, home, own };
}
// Inside a tower (2D): one floor. A carpeted corridor along the back with the lift and the stairs in the middle (above
// the front door, the same place on every floor; lights along it, a plant at each end), then the flats side by side in
// the outside's order. Names and "home"/"to let" in words.
function drawResFloor(f, t) {
  if (f.lobby) return drawResLobby(f, t);
  const { x, y, w, d } = f, lv = f.level, CD = 1.3, k = Math.max(1, f.perFloor), cw = w / k, sel = openRoom === f.id, F = resInFacade(f.tower);
  const WH = lv === 3 ? 2.4 : 1.4, near = cam.z > 0.8;
  const bay0 = F ? F.bayOfFlat(0, k) : { wall: "#e6c88e", accent: "#3d6585" };
  // the slab's edge (the floor's name is on its sign)
  const sl = 0.45;
  poly([toScreen(x, y + d, -sl), toScreen(x + w, y + d, -sl), toScreen(x + w, y + d), toScreen(x, y + d)], dn("#e2d6bf", "#2c2a26"));
  poly([toScreen(x + w, y, -sl), toScreen(x + w, y + d, -sl), toScreen(x + w, y + d), toScreen(x + w, y)], dn("#cdbfa6", "#24221f"));
  poly([toScreen(x, y), toScreen(x + w, y), toScreen(x + w, y + d), toScreen(x, y + d)], dn("#e8dcc6", "#3e3a34"), sel ? "#f3d9a4" : null);
  // the corridor: a carpet runner with a border, the outer walls (cream inside; the end wall in the first bay's plaster)
  poly([toScreen(x, y), toScreen(x + w, y), toScreen(x + w, y + CD), toScreen(x, y + CD)], dn("#e9dfcc", "#6a5e4e"));
  poly([toScreen(x + 0.15, y + 0.25), toScreen(x + w - 0.15, y + 0.25), toScreen(x + w - 0.15, y + CD - 0.35), toScreen(x + 0.15, y + CD - 0.35)], dn("#a8584a", "#4a2a26"));
  poly([toScreen(x + 0.25, y + 0.33), toScreen(x + w - 0.25, y + 0.33), toScreen(x + w - 0.25, y + CD - 0.43), toScreen(x + 0.25, y + CD - 0.43)], dn("#b9685a", "#55302a"));
  poly([toScreen(x, y), toScreen(x + w, y), toScreen(x + w, y, WH), toScreen(x, y, WH)], dn("#f2e9d8", "#57514a"));
  poly([toScreen(x, y), toScreen(x, y + d), toScreen(x, y + d, WH), toScreen(x, y, WH)], resNt(resShade(bay0.wall, 0.92)));
  // wall lights along the corridor, lit at night (it is always lit for whoever comes home)
  for (let q = x + 1.4; q < x + w - 0.6; q += 2.6) { const [lx, ly] = toScreen(q, y + 0.02, 0.95); if (night > 0.3) { const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 26 * cam.z); g.addColorStop(0, `rgba(255,220,150,${0.5 * night})`); g.addColorStop(1, "rgba(255,220,150,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(lx, ly, 26 * cam.z, 0, Math.PI * 2); ctx.fill(); } ctx.fillStyle = night > 0.3 ? "#ffe6a8" : dn("#e8d9b8", "#8a7f6c"); ctx.beginPath(); ctx.ellipse(lx, ly, 3.2 * cam.z, 2 * cam.z, 0, 0, Math.PI * 2); ctx.fill(); }
  // the core: the lift and the stairs mid-corridor (over the entrance), the same on every floor
  const cx = x + w / 2;
  poly([toScreen(cx - 1.45, y + 0.02), toScreen(cx - 0.35, y + 0.02), toScreen(cx - 0.35, y + 0.02, 1.15), toScreen(cx - 1.45, y + 0.02, 1.15)], dn("#9aa3ad", "#4a5058"));
  poly([toScreen(cx - 1.35, y + 0.025), toScreen(cx - 0.45, y + 0.025), toScreen(cx - 0.45, y + 0.025, 1.0), toScreen(cx - 1.35, y + 0.025, 1.0)], dn("#c9ced4", "#5f666e"));
  poly([toScreen(cx - 0.905, y + 0.03), toScreen(cx - 0.895, y + 0.03), toScreen(cx - 0.895, y + 0.03, 1.0), toScreen(cx - 0.905, y + 0.03, 1.0)], dn("#6a7078", "#2a2e34"));
  if (cam.z > 0.55) { const [lx, ly] = toScreen(cx - 0.9, y + 0.02, 1.25); ctx.fillStyle = dn("#2c3440", "#e8dcc4"); ctx.font = `700 ${Math.max(8, 9 * cam.z)}px system-ui`; ctx.textAlign = "center"; ctx.fillText("LIFT", lx, ly); }
  for (let s = 0; s < 6; s++) box(cx + 0.25 + s * 0.2, y + 0.1, 0.2, 0.75, 0.11 * (s + 1), dn("#d9cbb2", "#5a5650"), dn("#c8b99e", "#4a4744"), dn("#b5a68b", "#3e3b38"));
  for (const px of [x + 0.25, x + w - 0.55]) { box(px, y + 0.12, 0.26, 0.26, 0.22, dn("#b5683c", "#5a3a28"), dn("#a45a32", "#4a3020"), dn("#8e4e2c", "#40281c")); box(px - 0.04, y + 0.08, 0.34, 0.34, 0.32, dn("#5fae5a", "#2f5e38"), dn("#4c9448", "#264c2e"), dn("#3f7e3c", "#203f26"), 0.22); }
  // the flats, left to right as outside
  for (let j = 0; j < k; j++) {
    const id = f.flats[j] || null, dk = id && deskById(id), a = x + j * cw, Y0 = y + CD, FD = d - CD;
    const bay = F ? F.bayOfFlat(j, k) : bay0, curtain = F ? F.curtain(f.storey, j) : "#f3e7c9";
    const R = resRoom2D({ a, y0: Y0, cw, FD, lv, id, dk, bay, curtain, t, ph: 0.6, gallery: 1.25 });
    if (dk && openRoom === `house:${id}`) poly([toScreen(a + 0.06, Y0 + 0.05), toScreen(a + cw - 0.06, Y0 + 0.05), toScreen(a + cw - 0.06, y + d), toScreen(a + 0.06, y + d)], "rgba(243,217,164,0.14)", "#f3d9a4"); // the open home
    if (!dk) { if (cam.z > 0.9) { const [tx, ty] = toScreen(a + cw / 2, Y0 + FD * 0.45, 0.1); ctx.font = `700 ${Math.max(9, 10 * cam.z)}px system-ui`; ctx.textAlign = "center"; haloText("To let · ready to move in", tx, ty, dn("#5a4a30", "#e9e0cc")); } continue; }
    // their balcony things out on the balcony, and them: on the balcony now and then (as outside), else on their sofa
    const onBal = R.home && R.bal && onBalconyNow(id);
    if (R.bal) drawBalconyThings(id, R.bal.cx, R.bal.y, 0.05, R.bal.bw, t, 1.6, onBal);
    // the rest of what they bought for home and their pets (belongings.js "flat"), on free floor round the room; a
    // pet's state in words underneath when you're close (never colour alone)
    {
      const spots = [[0.55, 0.5], [0.72, 0.36], [0.42, 0.68], [0.82, 0.62], [0.6, 0.78], [0.3, 0.5], [0.5, 0.36]], drawnAlready = ["rug", "bed", "bookshelf", "couch", "tv"];
      const life = data.wallets?.[id]?.living || [];
      ownAt(id, "flat").filter((kk) => !drawnAlready.includes(kk)).forEach((kk, i) => {
        const [fx, fy] = spots[i % spots.length], v = life.find((q) => q.item === kk), [ix, iy] = toScreen(a + cw * fx, Y0 + FD * fy, 0.05);
        emoji(ix, iy, Math.min(18, 12 * cam.z) * (v ? [0.8, 1, 1.2][(v.size || 1) - 1] : 1), data.perks[kk]?.icon || "🎁");
        if (v && cam.z > 1.3) { ctx.font = "600 9px system-ui"; ctx.textAlign = "center"; haloText(v.kind === "pet" ? `Lv ${v.level} · ${v.need}` : v.word, ix, iy + 10, dn("#3b2a10", "#f3d9a4")); }
      });
    }
    if (R.home && !onBal) { const [px, py] = R.seat ? toScreen(R.seat[0], R.seat[1], R.seat[2]) : toScreen(a + cw * 0.5, Y0 + FD * 0.62, 0); resPerson2D(dk, px, py, cam.z * 1.1); }
    if (cam.z > 0.4) { const [nx, ny] = toScreen(a + cw / 2, y + d + (lv >= 1 ? 1.0 : 0.35), 0); ctx.font = `600 ${Math.max(9, 10 * cam.z)}px system-ui`; ctx.textAlign = "center"; haloText(`${nameOf(dk)} · ${R.home ? "home" : { work: "at work", away: "away", nowhere: "moving in", meeting: "in a meeting" }[whereIs(dk)] || "out"}`, nx, ny + 10, dn("rgba(50,44,32,0.92)", "rgba(240,232,214,0.9)")); }
  }
}
// The ground floor (2D): the lobby behind the entrance. The glass doors under the canopy mid-front, mailboxes and a bench,
// the lift and the stairs in the same place as on every floor, and what everyone shares whatever their level
// (campusHomes.SHARED): the laundry room and bike storage on one side, the common room on the other.
function drawResLobby(f, t) {
  const { x, y, w, d } = f, sel = openRoom === f.id, near = cam.z > 0.7, cx = x + w / 2, F = resInFacade(f.tower), acc = F ? F.bayAt(F.door).accent : "#3d6585";
  const P = (a, b, c = 0) => toScreen(a, b, c), quad = (x0, y0, x1, y1, h, fill) => poly([P(x0, y0, h), P(x1, y0, h), P(x1, y1, h), P(x0, y1, h)], fill);
  const word = (s, a, b, h) => { if (cam.z < 0.45) return; const [lx, ly] = P(a, b, h); ctx.font = `700 ${Math.max(9, 10 * cam.z)}px system-ui`; ctx.textAlign = "center"; haloText(s, lx, ly, dn("rgba(60,46,30,0.95)", "rgba(244,234,214,0.95)")); };
  const wood = resNt("#9a7550"), woodF = resNt("#7d5c3e"), woodS = resNt("#6a4d34"), white = resNt("#f6f2ea"), whiteF = resNt("#e6dfd2"), whiteS = resNt("#d3cbbd"), trim = resNt("#fbf6ec");
  const sl = 0.45, WH = 1.4, PH = 0.6, lw = Math.min(w * 0.3, 4.2), rw = Math.min(w * 0.3, 4.2);
  poly([P(x, y + d, -sl), P(x + w, y + d, -sl), P(x + w, y + d), P(x, y + d)], dn("#c79a82", "#3a2a24"));
  poly([P(x + w, y, -sl), P(x + w, y + d, -sl), P(x + w, y + d), P(x + w, y)], dn("#b0806a", "#33241f"));
  // floors: warm stone in the hall, boards in the common room, pale tiles in the laundry
  quad(x, y, x + w, y + d, 0, dn("#e6d6bc", "#76664f")); if (sel) poly([P(x, y), P(x + w, y), P(x + w, y + d), P(x, y + d)], null, "#f3d9a4");
  if (near) { ctx.strokeStyle = dn("rgba(150,120,90,0.18)", "rgba(0,0,0,0.2)"); ctx.lineWidth = 1; for (let q = x + 0.6; q < x + w; q += 0.6) { const [a1, b1] = P(q, y), [a2, b2] = P(q, y + d); ctx.beginPath(); ctx.moveTo(a1, b1); ctx.lineTo(a2, b2); ctx.stroke(); } }
  quad(x + w - rw, y, x + w, y + d, 0.003, dn("#c99a68", "#4a3a2a"));
  quad(x, y, x + lw, y + d * 0.55, 0.003, dn("#e4eef0", "#3c4446"));
  // the walls: cream inside the back, brick at the end (the outside's ground storey)
  poly([P(x, y), P(x + w, y), P(x + w, y, WH), P(x, y, WH)], dn("#f2e9d8", "#57514a"));
  poly([P(x, y), P(x, y + d), P(x, y + d, WH), P(x, y, WH)], dn("#a8644c", "#4a3028"));
  // the core, as on every floor: lift and stairs mid-back
  poly([P(cx - 1.45, y + 0.02), P(cx - 0.35, y + 0.02), P(cx - 0.35, y + 0.02, 1.15), P(cx - 1.45, y + 0.02, 1.15)], dn("#9aa3ad", "#4a5058"));
  poly([P(cx - 1.35, y + 0.025), P(cx - 0.45, y + 0.025), P(cx - 0.45, y + 0.025, 1.0), P(cx - 1.35, y + 0.025, 1.0)], dn("#c9ced4", "#5f666e"));
  if (cam.z > 0.55) { const [lx, ly] = P(cx - 0.9, y + 0.02, 1.25); ctx.fillStyle = dn("#2c3440", "#e8dcc4"); ctx.font = `700 ${Math.max(8, 9 * cam.z)}px system-ui`; ctx.textAlign = "center"; ctx.fillText("LIFT", lx, ly); }
  for (let s = 0; s < 6; s++) box(cx + 0.25 + s * 0.2, y + 0.1, 0.2, 0.75, 0.11 * (s + 1), dn("#d9cbb2", "#5a5650"), dn("#c8b99e", "#4a4744"), dn("#b5a68b", "#3e3b38"));
  // the mailboxes on the back wall, beside the lift
  const mx0 = cx - 3.0, mx1 = cx - 1.7;
  poly([P(mx0, y + 0.02, 0.3), P(mx1, y + 0.02, 0.3), P(mx1, y + 0.02, 0.95), P(mx0, y + 0.02, 0.95)], dn("#8a8f78", "#3e4238"));
  if (near) { ctx.strokeStyle = dn("rgba(240,236,220,0.8)", "rgba(160,160,150,0.6)"); ctx.lineWidth = 1; for (let i = 1; i < 5; i++) { const q = mx0 + ((mx1 - mx0) * i) / 5, [a1, b1] = P(q, y + 0.025, 0.3), [a2, b2] = P(q, y + 0.025, 0.95); ctx.beginPath(); ctx.moveTo(a1, b1); ctx.lineTo(a2, b2); ctx.stroke(); } for (const h of [0.52, 0.74]) { const [a1, b1] = P(mx0, y + 0.025, h), [a2, b2] = P(mx1, y + 0.025, h); ctx.beginPath(); ctx.moveTo(a1, b1); ctx.lineTo(a2, b2); ctx.stroke(); } }
  word("Mailboxes", (mx0 + mx1) / 2, y + 0.1, 1.15);
  // the hall: a rug, a bench each side of the door, plants, lit at night
  quad(cx - 1.0, y + d - 2.0, cx + 1.0, y + d - 0.4, 0.005, resNt(resMix("#a8584a", acc, 0.25)));
  for (const s of [-1, 1]) { const bxx = cx + s * 1.6 - 0.45; box(bxx, y + d - 1.3, 0.9, 0.3, 0.18, wood, woodF, woodS); box(bxx, y + d - 1.06, 0.9, 0.06, 0.36, wood, woodF, woodS); box(cx + s * 2.4 - 0.15, y + d - 0.6, 0.3, 0.3, 0.2, dn("#b5683c", "#5a3a28"), dn("#a45a32", "#4a3020"), dn("#8e4e2c", "#40281c")); box(cx + s * 2.4 - 0.2, y + d - 0.65, 0.4, 0.4, 0.34, dn("#5fae5a", "#2f5e38"), dn("#4c9448", "#264c2e"), dn("#3f7e3c", "#203f26"), 0.2); }
  if (night > 0.3) for (const q of [cx - 1.6, cx + 1.6]) { const [lx, ly] = P(q, y + d * 0.5, 1.2), g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 40 * cam.z); g.addColorStop(0, `rgba(255,220,150,${0.45 * night})`); g.addColorStop(1, "rgba(255,220,150,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(lx, ly, 40 * cam.z, 0, Math.PI * 2); ctx.fill(); }
  word("Lobby", cx, y + d * 0.5, 0.2);
  // the laundry room (back left): washers along the back wall, a folding table; its walls low, with a doorway
  box(x + lw - 0.03, y, 0.06, d * 0.55 - 0.9, PH, trim, trim, dn("#eef3f3", "#4a5050")); box(x, y + d * 0.55 - 0.03, lw - 0.9, 0.06, PH, trim, dn("#eef3f3", "#4a5050"), null);
  for (let i = 0; i < Math.max(2, Math.floor((lw - 0.5) / 0.6)); i++) { const wx = x + 0.3 + i * 0.6; box(wx, y + 0.1, 0.5, 0.5, 0.5, white, whiteF, whiteS); const [dx, dy] = P(wx + 0.25, y + 0.6, 0.27); ctx.fillStyle = dn("#5a6a78", "#2a3038"); ctx.beginPath(); ctx.ellipse(dx, dy, 4.5 * cam.z, 4 * cam.z, 0, 0, Math.PI * 2); ctx.fill(); }
  box(x + 0.3, y + 1.0, Math.min(1.4, lw - 0.8), 0.45, 0.3, wood, woodF, woodS);
  word("Laundry", x + lw / 2, y + d * 0.3, 0.9);
  // bike storage (front left): a rack and the bikes
  box(x + 0.3, y + d - 0.5, lw - 0.6, 0.06, 0.14, dn("#7d8794", "#4a5058"), dn("#6a7480", "#3a4048"), dn("#5a6470", "#30363c"));
  for (let i = 0; i < Math.max(2, Math.floor((lw - 0.6) / 0.55)); i++) { const [bxs, bys] = P(x + 0.55 + i * 0.55, y + d - 0.75, 0.05); emoji(bxs, bys, Math.max(9, 15 * cam.z), "🚲"); }
  word("Bikes", x + lw / 2, y + d - 1.4, 0.6);
  // the common room (right): a sofa and armchairs round a low table, shelves, a big table for games, a plant
  const r0 = x + w - rw;
  box(r0 - 0.03, y, 0.06, d - 1.3, PH, trim, trim, dn("#f4ecdc", "#55504a"));
  box(r0 + 0.5, y + 0.35, Math.min(1.6, rw - 1.2), 0.4, 0.16, resNt("#c9785a"), resNt("#b0664a"), resNt("#985840")); box(r0 + 0.5, y + 0.3, Math.min(1.6, rw - 1.2), 0.12, 0.34, resNt("#b86a4e"), resNt("#a05a40"), resNt("#8a4c36"));
  box(r0 + 0.7, y + 1.05, Math.min(1.1, rw - 1.6), 0.5, 0.16, wood, woodF, woodS);
  for (const ax of [r0 + 0.2, r0 + Math.min(2.2, rw - 0.6)]) box(ax, y + 1.05, 0.38, 0.38, 0.2, resNt("#d9a441"), resNt("#c08f34"), resNt("#a87c2c"));
  box(x + w - 0.3, y + 0.3, 0.2, Math.min(1.6, d - 2), 0.8, wood, woodF, woodS);
  box(r0 + 0.6, y + d - 1.7, Math.min(1.4, rw - 1.2), 0.7, 0.24, wood, woodF, woodS);
  if (night > 0.3) { const [lx, ly] = P(r0 + rw / 2, y + 1.2, 0.9), g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 38 * cam.z); g.addColorStop(0, `rgba(255,214,140,${0.4 * night})`); g.addColorStop(1, "rgba(255,214,140,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(lx, ly, 38 * cam.z, 0, Math.PI * 2); ctx.fill(); }
  word("Common room", r0 + rw / 2, y + d * 0.5, 0.7);
  // the front: brick piers, the glass doors mid-front under the canopy, the word on it
  for (const [a0, a1] of [[x, cx - 0.8], [cx + 0.8, x + w]]) { box(a0, y + d - 0.06, a1 - a0, 0.08, 0.18, dn("#c58468", "#4a3028"), dn("#a8644c", "#4a3028"), null); poly([P(a0, y + d + 0.02, 0.18), P(a1, y + d + 0.02, 0.18), P(a1, y + d + 0.02, 0.9), P(a0, y + d + 0.02, 0.9)], night > 0.3 ? "rgba(255,220,150,0.18)" : "rgba(175,212,240,0.16)"); }
  poly([P(cx - 0.8, y + d + 0.02), P(cx + 0.8, y + d + 0.02), P(cx + 0.8, y + d + 0.02, 1.05), P(cx - 0.8, y + d + 0.02, 1.05)], night > 0.3 ? "rgba(255,220,150,0.3)" : "rgba(160,200,230,0.25)");
  const fr = resNt("#5a4a38"); for (const q of [cx - 0.8, cx, cx + 0.8]) poly([P(q - 0.02, y + d + 0.03), P(q + 0.02, y + d + 0.03), P(q + 0.02, y + d + 0.03, 1.05), P(q - 0.02, y + d + 0.03, 1.05)], fr);
  box(cx - 1.1, y + d, 2.2, 0.8, 0.05, resNt(resShade(acc, 1.15)), resNt(acc), resNt(resShade(acc, 0.8)), 1.1);
  quad(cx - 0.6, y + d - 0.5, cx + 0.6, y + d - 0.05, 0.006, resNt("#5a4a3a"));
  word("Residences", cx, y + d + 0.85, 1.2);
}
// Phones (the owner's phone, 2026-11-16: inside the long block a floor was a sliver running off both sides of the screen):
// on a narrow screen the floors view frames one bay of the building (the outside's bays) and the floor list gets
// "◀ Bay 2 of 3 ▶" to step along it. resBay: the bay chosen (null: the one with the front door); resK2D: the floor the
// 2D view is on (null: all floors).
let resBay = null, resBayTower = null, resK2D = null;
function resBayView() {
  if (!isResView(view) || innerWidth >= 700) return null;
  if (resBayTower !== view) { resBayTower = view; resBay = null; resK2D = null; }
  const F = resInFacade(view); if (!F || F.units < 2) return null;
  const i = resBay == null ? Math.min(F.units - 1, Math.floor(F.units / 2)) : Math.max(0, Math.min(F.units - 1, resBay)), b = F.bays[i];
  return { i, n: F.units, f0: b.x0, f1: b.x1 };
}
// 2D: frame floor k (or all floors, k null) to the screen, one bay of it on a phone
function resFocus2D(k) {
  const fl = k == null ? rooms : rooms.filter((x) => x.k === k); if (!fl.length) return;
  resK2D = k == null ? null : k;
  const B = resBayView(), pts = [];
  for (const f of fl) { const x0 = f.x + (B ? B.f0 : 0) * f.w - 0.3, x1 = f.x + (B ? B.f1 : 1) * f.w + 0.3; for (const [a, b, h] of [[x0, f.y, 1.6], [x1, f.y, 1.6], [x0, f.y + f.d + 1.2, 0], [x1, f.y + f.d + 1.2, 0]]) pts.push(iso(a, b, (f.z || 0) + h)); }
  const A = pts.map((p) => p[0]), Bv = pts.map((p) => p[1]), minA = Math.min(...A), maxA = Math.max(...A), minB = Math.min(...Bv), maxB = Math.max(...Bv);
  cam.x = (minA + maxA) / 2;
  cam.z = Math.max(0.35, Math.min(2.4, (W - 24) / (maxA - minA), (H * (innerWidth < 700 ? 0.6 : 0.9)) / (maxB - minB)));
  cam.y = (minB + maxB) / 2 + (innerWidth < 700 ? (H * 0.14) / cam.z : 0); // a phone: above the bottom sheet
  fitted = true;
}
// Open someone's home in 2D: their flat cut away where it is in the building (along the front, at its own place), at
// the level's size, the corridor and their front door behind it. The size comes from the one table (homes.js roomW):
// a Basic 3.2 tiles across (ROOM_W), Comfy 5.3, Nice and Penthouse 8 (the penthouse two storeys), the building's depth; was
// 3 / 3.8 / 5 / 8, cut to the tower's width. A home wider than its tower stands out past it, centred on it.
function resHomeRect(hr, r) {
  const lv = hr.level | 0, Wd = campusHomes.roomW(lv, campusHomes.ROOM_W), D = r.d - 0.1;
  const cx = Wd > r.w - 0.3 ? r.x + r.w / 2 : Math.max(r.x + Wd / 2 + 0.15, Math.min(r.x + r.w - Wd / 2 - 0.15, hr.x || r.x + r.w / 2));
  return { x: cx - Wd / 2, y: r.y + 0.05, w: Wd, d: D };
}
function drawResHome2D(hr, r, t) {
  const R0 = resHomeRect(hr, r), { x, y, w, d } = R0, lv = hr.level | 0, CD = 0.8, id = hr.desk.id, dk = hr.desk;
  const F = resFacadeOf(r), floor = r.floors.find((f) => f.flats.includes(id)), k = Math.max(1, floor?.perFloor || 1), j = Math.max(0, floor ? floor.flats.indexOf(id) : 0);
  const bay = F.bayOfFlat(j, k), curtain = F.curtain(floor?.storey || 1, j), WH = lv === 3 ? 2.2 : 1.15, G = 1.05;
  poly([toScreen(x - 0.25, y - 0.2), toScreen(x + w + 0.25, y - 0.2), toScreen(x + w + 0.25, y + d + 1.2), toScreen(x - 0.25, y + d + 1.2)], dn("rgba(190,180,150,0.4)", "rgba(120,140,110,0.22)"), dn("#d9a441", "#f3d9a4"));
  // the corridor behind it (carpet, the outer wall with a light), the back and end walls
  poly([toScreen(x, y), toScreen(x + w, y), toScreen(x + w, y + CD), toScreen(x, y + CD)], dn("#e9dfcc", "#6a5e4e"));
  poly([toScreen(x, y + 0.18), toScreen(x + w, y + 0.18), toScreen(x + w, y + CD - 0.32), toScreen(x, y + CD - 0.32)], dn("#a8584a", "#4a2a26"));
  poly([toScreen(x, y), toScreen(x + w, y), toScreen(x + w, y, WH), toScreen(x, y, WH)], dn("#f2e9d8", "#57514a"));
  poly([toScreen(x, y), toScreen(x, y + d), toScreen(x, y + d, WH), toScreen(x, y, WH)], resNt(resShade(bay.wall, 0.9)));
  const R = resRoom2D({ a: x, y0: y + CD, cw: w, FD: d - CD, lv, id, dk, bay, curtain, t, full: true, ph: 1.0, gallery: G });
  const onBal = R.home && R.bal && onBalconyNow(id);
  if (R.bal) drawBalconyThings(id, R.bal.cx, R.bal.y, 0.05, R.bal.bw, t, 2.0, onBal);
  // what they bought for home and their pets (belongings.js "flat"), round the free floor; a pet's or plant's state in words
  const life = data.wallets?.[id]?.living || [], sz = (v) => (v ? [0.75, 1, 1.3][(v.size || 1) - 1] : 1);
  const spots = [[0.55, 0.52], [0.74, 0.4], [0.42, 0.7], [0.84, 0.66], [0.62, 0.84], [0.3, 0.55], [0.5, 0.38], [0.7, 0.6], [0.38, 0.86], [0.88, 0.5], [0.22, 0.78], [0.6, 0.66]];
  ownAt(id, "flat").filter((kk) => !["rug", "bed", "bookshelf", "couch", "tv"].includes(kk)).forEach((kk, i) => {
    const v = life.find((q) => q.item === kk), [fx, fy] = spots[i % spots.length];
    if (kk === "discoball") { const [ix, iy] = toScreen(x + w * 0.55, y + CD + (d - CD) * 0.5, 0.85); emoji(ix, iy, 18 * cam.z, data.perks[kk]?.icon || "🪩"); return; }
    const [ix, iy] = toScreen(x + w * fx, y + CD + (d - CD) * fy, 0.04);
    ctx.save(); ctx.translate(ix, iy); if (v?.need === "wilting") ctx.rotate(0.6); emoji(0, 0, 17 * cam.z * sz(v), data.perks[kk]?.icon || "🎁"); ctx.restore();
    if (v && cam.z > 1.1) { ctx.font = "600 9px system-ui"; ctx.textAlign = "center"; haloText(v.kind === "pet" ? `Lv ${v.level} · ${v.need}` : `${v.stage || v.word}${v.need && v.need !== "watered" && v.kind !== "pet" ? ` · ${v.need}` : ""}`, ix, iy + 10, dn("#3b2a10", "#f3d9a4")); }
  });
  if (R.home && !onBal) {
    const [px, py] = R.seat ? toScreen(R.seat[0], R.seat[1], R.seat[2]) : toScreen(x + w * 0.5, y + CD + (d - CD) * 0.62, 0), s = cam.z * 1.1;
    resPerson2D(dk, px, py, s);
    if (cam.z > 0.6) { const own = R.own; thoughtBubble(px, py - 30 * s, own.includes("tv") || (RES_COMES[lv] || []).includes("tv") ? "📺 one more episode" : own.includes("arcade") ? "🕹️ new high score" : "home sweet home", true); }
  }
  // the name plate on their door (words), and the home's name under it
  if (cam.z > 0.7) { const [px, py] = toScreen(x + Math.max(w * 0.4, Math.min(1.15, w * 0.4)) + 0.18, y + CD, 1.12); ctx.font = "600 9px system-ui"; ctx.textAlign = "center"; haloText(nameOf(dk), px, py, dn("#3b2a10", "#f3d9a4")); }
  const [nx, ny] = toScreen(x + w / 2, y + d + (lv >= 1 ? 1.05 : 0.4), 0); ctx.font = "700 10px system-ui"; ctx.textAlign = "center"; haloText(`${hr.name} · ${hr.levelName}`, nx, ny + 10, dn("#5a4210", "#f3d9a4"));
}
// Which home a tap inside a tower lands on (top floor first, like roomAt), or null.
function resFlatAt(sx, sy) {
  for (const f of [...rooms].reverse()) {
    if (!f.resFloor || f.lobby) continue;
    const [wx, wy] = toWorld(sx, sy, f.z);
    if (wx < f.x || wx > f.x + f.w || wy < f.y + 1.3 || wy > f.y + f.d + 0.6) continue;
    return f.flats[Math.floor((wx - f.x) / (f.w / Math.max(1, f.perFloor)))] || null;
  }
  return null;
}
function drawHouse(r, t) {
  const { x, y, w, d, h, desk } = r, hov = hover === r.id, sel = openRoom === r.id;
  const planned = desk.status === "planned", away = desk.status === "paused", home = whereIs(desk) === "home";
  const own = shownOwned(desk.id);
  // Open house: lift the roof and show the rooms inside (the sim-town view).
  if (openRoom === r.id && !planned) return drawHouseInside(r, t, own, home, away);
  ctx.save(); if (planned) ctx.globalAlpha = 0.45;
  // lot and (for villas) a garden
  poly([toScreen(x - 0.25, y - 0.25), toScreen(x + w + 0.25, y - 0.25), toScreen(x + w + 0.25, y + d + 0.4), toScreen(x - 0.25, y + d + 0.4)], r.size === 2 ? dn("rgba(111,176,96,0.55)", "rgba(95,170,90,0.45)") : dn("rgba(190,180,150,0.45)", "rgba(120,140,110,0.25)"), sel ? "#f3d9a4" : null);
  const hu = r.hue || 30, wall = hn(hu, 52, hov ? 70 : 64, hov ? 40 : 30, hov ? 78 : 72), wallL = hn(hu, 46, 52, 28, 62), wallR = hn(hu, 48, 58, 26, 55);
  box(x, y, w, d, h, wall, wallL, wallR);
  // pitched roof: ridge along x
  const rh = h + 0.45, roof = hn(hu + 180, 38, planned ? 70 : 56, 35, planned ? 60 : 38), roofD = hn(hu + 180, 38, 46, 35, 30);
  poly([toScreen(x, y + d, h), toScreen(x + w, y + d, h), toScreen(x + w, y + d / 2, rh), toScreen(x, y + d / 2, rh)], roof);
  poly([toScreen(x, y, h), toScreen(x + w, y, h), toScreen(x + w, y + d / 2, rh), toScreen(x, y + d / 2, rh)], roofD);
  poly([toScreen(x + w, y, h), toScreen(x + w, y + d, h), toScreen(x + w, y + d / 2, rh)], wallR);
  // windows on the front: lit when they're home after hours
  const glow = home ? `rgba(255,214,140,${0.85 + 0.1 * Math.sin(t / 1300 + x)})` : away ? dn("#8a93a3", "#5b5f69") : dn("rgba(70,100,140,0.65)", "rgba(40,48,60,0.85)");
  for (const fx of [0.22, 0.62]) poly([toScreen(x + w * fx, y + d, h * 0.35), toScreen(x + w * fx + w * 0.18, y + d, h * 0.35), toScreen(x + w * fx + w * 0.18, y + d, h * 0.7), toScreen(x + w * fx, y + d, h * 0.7)], glow);
  poly([toScreen(x + w * 0.44, y + d, 0), toScreen(x + w * 0.56, y + d, 0), toScreen(x + w * 0.56, y + d, h * 0.55), toScreen(x + w * 0.44, y + d, h * 0.55)], "#6d523a");
  if (own.includes("chair")) box(x + w * 0.75, y + d + 0.1, 0.18, 0.18, 0.18, "#ffd166", "#e0b040", "#c99a30");
  own.filter((o) => o === "plant").forEach((_, i) => box(x - 0.15 + i * 0.22, y + d + 0.12, 0.14, 0.14, 0.14, "#5fbf6a", "#4aa055", "#3f8a49"));
  if (own.includes("trophy")) { const [fx, fy] = toScreen(x + w * 0.5, y + d / 2, rh); ctx.strokeStyle = "#cfc6b4"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - 14 * cam.z); ctx.stroke(); ctx.fillStyle = "#ffd166"; ctx.fillRect(fx, fy - 14 * cam.z, 8 * cam.z, 5 * cam.z); }
  houseYard(r, t, own, home);
  if (away && cam.z > 0.5) { const [sx, sy] = toScreen(x + w + 0.2, y + d + 0.2, 0.2); ctx.fillStyle = "#8a6a48"; roundRect(sx - 4 * cam.z, sy - 6 * cam.z, 8 * cam.z, 6 * cam.z, 1.5 * cam.z); ctx.fill(); }
  if (planned) { ctx.strokeStyle = "#f0b45a"; ctx.lineWidth = 1; for (const [a, b] of [[x, y + d], [x + w, y + d], [x + w, y]]) { const [p1x, p1y] = toScreen(a, b, 0), [p2x, p2y] = toScreen(a, b, rh); ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke(); } }
  ctx.restore();
  // street name at the first house of each street
  if (r.streetStart && cam.z > 0.4) { const [lx, ly] = toScreen(x - 0.4, y + d + 0.7, 0); ctx.font = `600 ${Math.max(9, 10 * cam.z)}px system-ui`; ctx.textAlign = "left"; haloText(`${r.street} St.`, lx, ly, dn("rgba(60,56,44,0.9)", "rgba(233,228,216,0.8)")); }
  if (cam.z > 0.75) { const [nx, ny] = toScreen(x + w / 2, y + d + 0.35, 0); ctx.font = "600 9px system-ui"; ctx.textAlign = "center"; haloText(nameOf(desk), nx, ny + 9, dn("rgba(60,56,44,0.88)", "rgba(233,228,216,0.75)")); }
}
// The yard: things they bought for outside (fence, gnomes, barbecue, hot tub).
function houseYard(r, t, own, home) {
  const n = (k) => own.filter((o) => o === k).length;
  // Plan B+C houses face the loop road on any side: lay the yard out as if the front were south, then turn it.
  let { x, y, w, d } = r;
  if (r.face && r.face !== "s") {
    const yard = own.filter((k) => data.perks?.[k]?.mart && ["yard", "pets"].includes(data.perks[k].cat)), [fx, fy] = r.face === "e" ? [1, 0] : [0, 1] /* this view only shows south and east sides, so north and west houses use the south side yard */, cx = x + w / 2, cy = y + d / 2, half = (fx ? w : d) / 2;
    yard.forEach((k, i) => { const side = (i % 2 ? 1 : -1) * (0.3 + Math.floor(i / 2) * 0.28), [ix, iy] = toScreen(cx + fx * (half + 0.3) - fy * side, cy + fy * (half + 0.3) + fx * side, 0); emoji(ix, iy, 10 * cam.z, data.perks[k].icon); });
    for (let i = 0; i < n("gnome"); i++) { const gx = cx + fx * (half + 0.15) - fy * (0.5 + i * 0.25), gy = cy + fy * (half + 0.15) + fx * (0.5 + i * 0.25); box(gx, gy, 0.08, 0.08, 0.1, "#4a7bd0", "#3e68b0", "#345a98"); box(gx + 0.01, gy + 0.01, 0.06, 0.06, 0.09, "#e05d5d", "#c94f4f", "#b04444", 0.1); }
    return;
  }
  // Campus Mart yard things along the front of the lot, and pets by the door when nobody's out walking them
  const yard = own.filter((k) => data.perks?.[k]?.mart && (data.perks[k].cat === "yard" || data.perks[k].cat === "pets"));
  // a growing garden (items with a life) is bigger as it grows and leans over when wilting
  const life = (k) => (data.wallets?.[r.desk?.id]?.living || []).find((v) => v.item === k);
  yard.forEach((k, i) => { const v = life(k), [ix, iy] = toScreen(x + 0.15 + i * 0.32, y + d + 0.28, 0), s = v ? [0.75, 1, 1.3][(v.size || 1) - 1] : 1; ctx.save(); ctx.translate(ix, iy); if (v?.need === "wilting") ctx.rotate(0.6); emoji(0, 0, 10 * cam.z * s, data.perks[k].icon); ctx.restore(); });
  if (own.includes("fence")) { ctx.strokeStyle = "rgba(244,236,220,0.9)"; ctx.lineWidth = Math.max(1, 1.4 * cam.z); for (const [a, b, c, e] of [[x - 0.2, y + d + 0.35, x + w + 0.2, y + d + 0.35], [x + w + 0.2, y - 0.2, x + w + 0.2, y + d + 0.35]]) { const [p1x, p1y] = toScreen(a, b, 0.12), [p2x, p2y] = toScreen(c, e, 0.12); ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke(); for (let i = 0; i <= 6; i++) { const [qx, qy] = toScreen(a + ((c - a) * i) / 6, b + ((e - b) * i) / 6, 0); const [tx2, ty2] = toScreen(a + ((c - a) * i) / 6, b + ((e - b) * i) / 6, 0.2); ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(tx2, ty2); ctx.stroke(); } } }
  for (let i = 0; i < n("gnome"); i++) { box(x + 0.1 + i * 0.25, y + d + 0.15, 0.08, 0.08, 0.1, "#4a7bd0", "#3e68b0", "#345a98"); box(x + 0.11 + i * 0.25, y + d + 0.16, 0.06, 0.06, 0.09, "#e05d5d", "#c94f4f", "#b04444", 0.1); }
  if (own.includes("bbq")) { box(x + w + 0.05, y + d * 0.2, 0.18, 0.18, 0.2, "#2c3440", "#1d232c", "#161b22"); if (home) for (let i = 0; i < 3; i++) { const ph = ((t / 1600) + i / 3) % 1, [sx, sy] = toScreen(x + w + 0.14, y + d * 0.2 + 0.09, 0.25 + ph * 0.6); ctx.fillStyle = `rgba(220,220,220,${0.4 * (1 - ph)})`; ctx.beginPath(); ctx.arc(sx, sy, (2 + ph * 4) * cam.z, 0, Math.PI * 2); ctx.fill(); } }
  if (own.includes("hottub")) { box(x - 0.55, y + d * 0.1, 0.45, 0.45, 0.14, `rgba(110,200,255,${0.8 + 0.1 * Math.sin(t / 500)})`, "#8a6a48", "#6d523a"); if (home) { const [sx, sy] = toScreen(x - 0.33, y + d * 0.1 + 0.22, 0.3 + 0.1 * Math.sin(t / 700)); ctx.fillStyle = "rgba(240,240,240,0.35)"; ctx.beginPath(); ctx.arc(sx, sy, 4 * cam.z, 0, Math.PI * 2); ctx.fill(); } }
}
// Inside a house: floor, two back walls, and the furniture they've bought (a plain bed and a table come with it).
function drawHouseInside(r, t, own, home, away) {
  const { x, y, w, d, h, desk } = r, has = (k) => own.includes(k) || (r.inTower && (RES_COMES[r.level] || []).includes(k)); // a flat comes furnished for its level
  poly([toScreen(x - 0.25, y - 0.25), toScreen(x + w + 0.25, y - 0.25), toScreen(x + w + 0.25, y + d + 0.4), toScreen(x - 0.25, y + d + 0.4)], r.size === 2 ? dn("rgba(111,176,96,0.55)", "rgba(95,170,90,0.45)") : dn("rgba(190,180,150,0.45)", "rgba(120,140,110,0.25)"), dn("#d9a441", "#f3d9a4"));
  poly([toScreen(x, y), toScreen(x + w, y), toScreen(x + w, y + d), toScreen(x, y + d)], dn("#c99a6a", "#b98a5c"));
  const wall = hn(r.hue || 30, 42, 80, 30, 72), wall2 = hn(r.hue || 30, 36, 70, 26, 62);
  poly([toScreen(x, y), toScreen(x + w, y), toScreen(x + w, y, h), toScreen(x, y, h)], wall);
  poly([toScreen(x, y), toScreen(x, y + d), toScreen(x, y + d, h), toScreen(x, y, h)], wall2);
  if (!r.inTower) houseYard(r, t, own.filter((k) => data.perks?.[k]?.cat !== "pets"), home); // the yard stays around the opened house (pets are shown inside); a flat has none
  // a window on the back wall, lit like the outside ones
  poly([toScreen(x + w * 0.55, y, h * 0.4), toScreen(x + w * 0.8, y, h * 0.4), toScreen(x + w * 0.8, y, h * 0.75), toScreen(x + w * 0.55, y, h * 0.75)], home ? "rgba(255,214,140,0.9)" : afterHours() ? "rgba(40,48,60,0.9)" : dn("rgba(150,200,255,0.9)", "rgba(150,200,255,0.8)"));
  if (has("rug")) poly([toScreen(x + w * 0.3, y + d * 0.35, 0.01), toScreen(x + w * 0.75, y + d * 0.35, 0.01), toScreen(x + w * 0.75, y + d * 0.8, 0.01), toScreen(x + w * 0.3, y + d * 0.8, 0.01)], "#c94f6d");
  // bed: back-left; comfy if bought
  box(x + 0.05, y + 0.05, w * 0.32, d * 0.5, 0.12, has("bed") ? "#f2ead8" : "#cfc6b4", has("bed") ? "#6ea8ff" : "#8a8070", has("bed") ? "#5a8ad8" : "#776e60");
  if (has("bed")) box(x + 0.07, y + 0.07, w * 0.12, d * 0.18, 0.05, "#ffffff", "#e8e0d0", "#d8d0c0", 0.12);
  if (has("bookshelf")) box(x + 0.02, y + d * 0.62, 0.12, d * 0.3, h * 0.75, "#8b6a4a", "#6d523a", "#5e4632");
  if (has("tv")) { box(x + w * 0.5, y + 0.02, w * 0.3, 0.05, 0.08, "#2c3440", "#1d232c", "#161b22"); poly([toScreen(x + w * 0.5, y + 0.07, 0.12), toScreen(x + w * 0.8, y + 0.07, 0.12), toScreen(x + w * 0.8, y + 0.07, h * 0.45), toScreen(x + w * 0.5, y + 0.07, h * 0.45)], home ? `hsl(${(t / 30) % 360},60%,60%)` : "#1b1f27"); }
  if (has("couch")) box(x + w * 0.5, y + d * 0.55, w * 0.38, d * 0.22, 0.14, "#b48cff", "#9a74e0", "#8562c8");
  if (has("arcade")) { box(x + w - 0.22, y + 0.05, 0.18, 0.16, h * 0.7, "#2c3440", "#1d232c", "#161b22"); poly([toScreen(x + w - 0.22, y + 0.21, h * 0.4), toScreen(x + w - 0.04, y + 0.21, h * 0.4), toScreen(x + w - 0.04, y + 0.21, h * 0.6), toScreen(x + w - 0.22, y + 0.21, h * 0.6)], `rgba(125,220,138,${0.7 + 0.3 * Math.sin(t / 200)})`); }
  // a little table, always
  box(x + w * 0.38, y + d * 0.45, 0.16, 0.16, 0.14, "#8b6a4a", "#6d523a", "#5e4632");
  // Campus Mart things, drawn after the furniture so nothing hides them (the owner 2026-11-11: the list said a beanbag,
  // a disco ball and pets were at home, but the room showed none): home things on free floor spots, pets by the door,
  // the disco ball hanging from the ceiling.
  {
    const uniq = (c) => [...new Set(own.filter((k) => data.perks?.[k]?.mart && data.perks[k].cat === c && data.perks[k].icon))];
    const spots = [[0.56, 0.3], [0.86, 0.34], [0.2, 0.72], [0.86, 0.62], [0.7, 0.48], [0.56, 0.62]], petSpots = [[0.3, 0.92], [0.5, 0.86], [0.72, 0.9], [0.9, 0.86], [0.12, 0.9]];
    let i = 0;
    for (const k of uniq("home")) {
      if (k === "discoball") { const [ix, iy] = toScreen(x + w * 0.6, y + d * 0.5, h * 0.85), [cx, cy] = toScreen(x + w * 0.6, y + d * 0.5, h * 1.05); ctx.strokeStyle = "rgba(240,240,240,0.7)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ix, iy - 10 * cam.z); ctx.stroke(); emoji(ix, iy, 20 * cam.z, data.perks[k].icon); continue; }
      const [fx, fy] = spots[i++ % spots.length], [ix, iy] = toScreen(x + w * fx, y + d * fy, 0.05); emoji(ix, iy, 20 * cam.z, data.perks[k].icon);
    }
    // Items with a life (2026-11-14): a pet grows with its level and a plant with its stage; a wilting plant leans
    // over. Each says its state in words underneath (never colour alone).
    const life = data.wallets?.[desk.id]?.living || [], lifeOf = (k) => life.find((v) => v.item === k), sz = (v) => (v ? [0.75, 1, 1.3][(v.size || 1) - 1] : 1);
    const lifeTag = (v, ix, iy) => { if (!v || cam.z < 1.2) return; ctx.font = "600 9px system-ui"; ctx.textAlign = "center"; haloText(v.kind === "pet" ? `Lv ${v.level} · ${v.need}` : `${v.stage}${v.need === "watered" ? "" : ` · ${v.need}`}`, ix, iy + 10, dn("#3b2a10", "#f3d9a4")); };
    uniq("pets").forEach((k, j) => { const v = lifeOf(k), [fx, fy] = petSpots[j % petSpots.length], hop = home && v?.need !== "very hungry" ? Math.abs(Math.sin(t / 500 + j * 1.7)) * 0.04 : 0, [ix, iy] = toScreen(x + w * fx, y + d * fy, 0.03 + hop); emoji(ix, iy, 17 * cam.z * sz(v), data.perks[k].icon); lifeTag(v, ix, iy); });
    // plants on the window sill
    life.filter((v) => v.kind === "plant" && data.perks?.[v.item]?.cat !== "yard").forEach((v, j) => {
      const [ix, iy] = toScreen(x + w * (0.58 + j * 0.07), y + 0.04, h * 0.4);
      ctx.save(); ctx.translate(ix, iy); if (v.need === "wilting") ctx.rotate(0.6); emoji(0, 0, 14 * cam.z * sz(v), v.icon); ctx.restore();
      if (v.need === "thirsty") emoji(ix + 7 * cam.z, iy - 14 * cam.z * sz(v), 8 * cam.z, "💧");
      if (j === 0 || cam.z > 2.2) lifeTag(v, ix, iy + j * 9);
    });
  }
  // them, if they're home (on the couch if they have one)
  if (home) {
    const [px, py] = toScreen(has("couch") ? x + w * 0.62 : x + w * 0.45, has("couch") ? y + d * 0.62 : y + d * 0.7, has("couch") ? 0.14 : 0), s = cam.z * 1.1;
    ctx.fillStyle = PROVIDER[desk.provider] || PROVIDER.other; roundRect(px - 5 * s, py - 16 * s, 10 * s, 11 * s, 3 * s); ctx.fill();
    ctx.fillStyle = "#f4ecdc"; roundRect(px - 6 * s, py - 26 * s, 12 * s, 10 * s, 4 * s); ctx.fill();
    ctx.fillStyle = "#1b1f27"; ctx.fillRect(px - 3.5 * s, py - 23 * s, 2 * s, 2.2 * s); ctx.fillRect(px + 1.5 * s, py - 23 * s, 2 * s, 2.2 * s);
    if (cam.z > 0.6) thoughtBubble(px, py - 30 * s, has("tv") ? "📺 one more episode" : has("arcade") ? "🕹️ new high score" : has("bookshelf") ? "📚 reading up" : "home sweet home", true);
  }
  if (!r.inTower) houseYard(r, t, own, home);
  const [nx, ny] = toScreen(x + w / 2, y + d + 0.35, 0); ctx.font = "700 10px system-ui"; ctx.textAlign = "center"; haloText(r.name, nx, ny + 10, dn("#5a4210", "#f3d9a4"));
}
// Items with a life and their last outing, for the worker and house panels: state in words, not colour.
function livingLine(w) {
  const l = w?.living || [];
  return l.length ? `<div class="sub">🌱 Living things: ${l.map((v) => `${v.icon} ${esc(v.label.replace(/^(a|an|the) /, ""))}: ${esc(v.word)}`).join(" · ")}</div>` : "";
}
function outingLine(e, who) {
  if (!e?.title) return "";
  return `<div class="sub">${esc(e.icon || "🎟️")} ${who ? `<b style="color:inherit">${esc(who)}</b> ` : "Last outing: "}${esc(e.verb || "went out")}: ${e.link ? `<a href="${esc(safeUrl(e.link))}" target="_blank" rel="noopener" style="text-decoration:underline">${esc(e.title)}</a>` : esc(e.title)}${e.reaction ? ` · "${esc(e.reaction)}"` : ""}${e.at ? ` · ${esc(ago(e.at))}` : ""}</div>`;
}
// A worker you tapped outside: who they are, what they're up to, and where to find them.
function workerPanel(d) {
  const w = data.wallets?.[d.id], home = projects.find((x) => x.id === d.room), house = homeOf(d.id), wk = walkers.get(d.id);
  const p = showPanel(`worker:${d.id}`, `${esc(nameOf(d))} <span class="sub">${esc(titleOf(d))}</span>`, `
    <div class="sub mt-1">${esc(home?.name || d.room)} · ${esc(d.id)} · ${esc(traitOf(d.id))}${wk?.thought ? ` · thinking "${esc(wk.thought.text)}"` : " · out for a walk"}</div>
    <div class="row"><div class="sub">${esc(d.role || "")}</div><div class="sub">👕 ${esc(modelCode(d))}${d.effort ? ` · ${esc(d.effort)}` : ""}${d.provider ? ` · ${esc(d.provider)}` : ""}</div>${(() => { const w = (data.watched || []).find((x) => x.desk === d.id && x.found); return w ? `<div class="sub">📺 Last watched <a href="${esc(safeUrl(w.url))}" target="_blank" rel="noopener" style="text-decoration:underline">${esc(w.title)}</a> · "${esc(w.reaction)}"</div>` : ""; })()}${(() => { const w = (data.surfed || []).find((x) => x.desk === d.id && x.ok); return w ? `<div class="sub">🌐 Last looked up: ${esc(w.topic || "something")} (${ago(w.at)})${w.thought ? ` · "${esc(w.thought)}"` : ""}</div>` : ""; })()}${outingLine(w?.lastExperience)}${livingLine(w)}${house ? `<div class="sub">🏘️ Lives in ${esc(house.towerName)}, ${esc(house.floorName)} · ${esc(house.levelName)}</div>` : ""}${moveLine(d.id)}${gardenLine(d.id)}${(() => { const me = data.selves?.[d.id]; if (!me?.about) return `<div class="sub">🌱 Still finding themselves: their personality grows from chats, Shorts, web time and work.</div>`; const fr = (me.friends || []).map((f) => { const x = data.desks.find((y) => y.id === f.desk); return `${esc(x ? nameOf(x) : f.desk)}${f.note ? ` (${esc(f.note)})` : ""}`; }); return `<div class="row" style="margin-top:6px"><div><b>🌱 Who they are</b></div><div class="sub">${esc(me.about)}</div>${me.into?.length ? `<div class="sub">Into lately: ${esc(me.into.join(", "))}</div>` : ""}${me.quirks?.length ? `<div class="sub">Quirks: ${esc(me.quirks.join("; "))}</div>` : ""}${fr.length ? `<div class="sub">Friends: ${fr.join("; ")}</div>` : ""}${(me.history || []).length ? `<div class="sub" style="margin-top:3px">How they've changed: ${me.history.slice().reverse().map((h) => `${esc(new Date(h.at).toLocaleDateString([], { month: "short", day: "numeric" }))}: ${esc(h.changed)}`).join(" · ")}</div>` : ""}</div>`; })()}${w ? `<div class="sub">💰 ${w.balance} credits · ${w.week} this week</div>` : ""}${(() => { const qd = data.quality?.desks?.[d.id]; return qd ? `<div class="sub">⭐ quality ${qd.score} · pay ${qd.pay}/job (${qd.n} scored job${qd.n === 1 ? "" : "s"})</div>` : ""; })()}</div>
    <div class="flex flex-wrap gap-2 mt-3"><button class="pill" id="pWWork">Their desk</button>${house ? '<button class="pill" id="pWHome">Their home</button>' : ""}<button class="pill" data-give="${esc(d.id)}">Give a job</button></div>
    ${w ? `<div class="row sub">💭 Wish list: ${esc((w.wish || []).slice(0, 4).map((k) => `${data.perks[k]?.icon || ""} ${data.perks[k]?.label || k}`).join(", ") || "nothing right now")}${w.coming?.length ? `<br>🚚 On the van: ${esc(w.coming.map((c) => c.label).join(", "))}` : ""}</div>` : ""}
    ${(() => { const h = helpingFor(d); return h ? `<div class="row sub">🔍 Helping ${esc(h.name)} ${esc(ago(h.at))}: ${esc(String(h.summary || "").slice(0, 120))}</div>` : ""; })()}
    ${(() => { const l = (data.loans || []).find((x) => x.desk === d.id); if (!l) return ""; const nm = (id) => projects.find((p) => p.id === id)?.name || id; return `<div class="row sub">🤝 On loan from ${esc(nm(l.fromRoom))} to ${esc(nm(l.toRoom))} until ${esc(new Date(l.until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))} (${esc(l.why || "")}) <button class="pill" id="pWBack" style="margin-left:6px">Send back now</button></div>`; })()}
    <h3 class="mt-4 font-semibold text-sm">📱 Phone</h3>
    ${textsWith(d.id).slice(-8).reverse().map((m) => { const out = m.from === d.id, other = deskById(out ? m.to : m.from); return `<div class="row"><div class="sub">${out ? "to" : "from"} <b style="color:inherit">${esc(other ? nameOf(other) : out ? m.to : m.from)}</b> · ${esc(ago(m.at))}</div><div style="margin-top:2px;padding:6px 9px;border-radius:12px;max-width:92%;${out ? "margin-left:auto;background:#2f6fdb;color:#fff" : "background:rgba(127,127,127,0.18)"}">${esc(textWords(m))}</div></div>`; }).join("") || '<div class="sub">No texts yet. They text each other when they pass work along or finish it.</div>'}`);
  wireGardenLine(p);
  document.getElementById("pWWork").onclick = () => { closePanel(); setView(d.room); };
  const hb = document.getElementById("pWHome"); if (hb) hb.onclick = () => openHome(d.id);
  const bk = document.getElementById("pWBack"); if (bk) bk.onclick = async () => { try { await api("/agents/loan/return", { request: data.loans.find((x) => x.desk === d.id).id }); toast(`${nameOf(d)} is heading home`); await load(); } catch (err) { toast(err.message, 6000); } };
  wireJobs(p, d.room);
}
function housePanel(r) {
  // fly to the house and lift its roof
  // (shifted so the house sits in the top part of the screen, above the panel)
  const tw0 = r.inTower ? rooms.find((x) => x.id === r.tower) : null, at = tw0 ? resHomeRect(r, tw0) : r; // a flat opens at its place in its building
  if (!view && openRoom !== r.id) { const [a, b] = iso(at.x + at.w / 2, at.y + at.d / 2); cam.z = Math.max(cam.z, 1.8); cam.x = a; cam.y = b + (H * 0.22) / cam.z; }
  const d = r.desk, w = data.wallets?.[d.id];
  const state = { nowhere: "being built (a planned hire)", away: "away (paused)", meeting: "at the board meeting (CEO tower)", work: "at the office, working", home: "home for the evening", out: "around campus", queue: "in line at your door, waiting for your answer", coffee: "at the coffee cart (blocked or over the cap)" }[whereIs(d)];
  const p = showPanel(r.id, esc(r.name), `
    <div class="sub mt-1">${r.inTower ? `${esc(r.towerName)}, ${esc(r.floorName)} · ${esc(r.levelName)} (${esc(resLevel(r.level).home)})` : `${esc(r.street)} St. · ${["a cottage", "a house", "a villa with a garden"][r.size]}`} · ${esc(state)}</div>
    <div class="row"><b>${esc(nameOf(d))}</b> <span class="sub">${esc(titleOf(d))} · ${esc(d.id)}</span><div class="sub">${esc(d.role || "")}</div><div class="sub">👕 ${esc(modelCode(d))}${d.effort ? ` · ${esc(d.effort)}` : ""} · ${esc(traitOf(d.id))}</div></div>
    ${w ? `<div class="row sub">💰 ${w.balance} credits · ${w.earned} earned in all${w.owned.length ? ` · has ${esc([...new Set(w.owned)].map((o) => data.perks?.[o]?.label || o).join(", "))}` : ""}</div>${livingLine(w)}` : ""}${moveLine(d.id)}${gardenLine(d.id)}
    ${(() => { const homeItems = Object.entries(data.perks || {}).filter(([, x]) => x.home); const got = homeItems.filter(([k]) => (w?.owned || []).includes(k)); const want = homeItems.filter(([k]) => !(w?.owned || []).includes(k)).sort((a, b) => a[1].cost - b[1].cost)[0];
      const hi = r.inTower ? campusHomes.homeInfo(r.level) : null;
      return `<h3 class="mt-4 font-semibold text-sm">At home</h3>${hi ? `<div class="sub">${esc(hi.name)}: ${esc(hi.type)}, ${esc(hi.rooms)}; ${esc(hi.outside)}.</div><div class="sub">Comes with: ${esc(campusHomes.comesWith(r.level).join(", "))}${RES_COMES[r.level]?.length ? `; and for the level: ${esc(RES_COMES[r.level].map((k) => (data.perks?.[k]?.label || k).replace(/^(a|an|the) /, "")).join(", "))}` : ""}.</div>` : ""}<div class="sub">${got.length ? `Bought: ${got.map(([, x]) => esc(x.label)).join(", ")}` : hi ? "Nothing bought for home yet." : "Just the basics: a plain bed and a table."}</div>${want ? `<div class="sub">Saving up for ${esc(want[1].label)} (${want[1].cost} credits)${w ? `: has ${w.balance}` : ""}.</div>` : ""}`; })()}
    <div class="sub mt-2">${r.inTower ? `Homes go by credits earned: ${campusHomes.LEVELS.map((l, i) => `${l.name}${i ? ` from ${l.min}` : ""}`).join(", ")} (the top tenth, two floors). When their level changes they move, and the feed says so.` : "The house grows with what they've earned: a cottage, a house from 30 credits, a villa with a garden from 100."} Lights on means they're home; they buy furniture and things for home at the Campus Mart.</div>
    ${r.inTower && window.campus3dActive && view !== r.id ? `<button class="pill mt-3" id="pLookIn">Look inside</button>` : ""}
    <button class="pill mt-3" id="pGoTower">${r.inTower ? `Back to ${esc(r.towerName)}` : ""}</button>
    <button class="pill mt-3" id="pGoWork">Visit them at work</button>`);
  wireGardenLine(p);
  document.getElementById("pGoWork").onclick = () => { closePanel(); setView(d.room); };
  const li = document.getElementById("pLookIn"); if (li) li.onclick = () => { setView(r.id); housePanel(r); };
  const gt = document.getElementById("pGoTower"); if (gt) { if (!r.inTower) gt.remove(); else gt.onclick = () => { if (view !== r.tower) setView(r.tower); homesPanel(r.tower); }; }
}

// ---------- belongings and the community garden ----------
// Where each thing a worker owns is shown comes from one rule (public/campus/model/belongings.js, campusBelongings):
// flat, balcony, garden, desk or worn. The drawings below ask it, so the rule and the picture can't drift apart.
const levelOfDesk = (id) => { const h = (RES || resLayout()).homes?.[id]; return h ? h.level : null; }; // null: no flat (the HR desks)
// What shows and what is "in storage" (the display limits, campusBelongings.shownAt): the worker owns it all, but each
// place draws only so much (a flat 4 to 12 by level, a balcony 3, a garden plot 4, a desk 5), pets and plants first,
// then the newest. Remembered per wallet so the draw loops don't recompute it every frame.
const SHOWN_PLACES = ["flat", "balcony", "garden", "desk", "worn"];
const _shownMemo = new WeakMap();
function shownIn(id) {
  const w = data.wallets?.[id], lv = levelOfDesk(id);
  if (!w || typeof campusBelongings === "undefined") return { shown: {}, stored: {}, ownedShown: w?.owned || [], storedCount: 0 };
  const m = _shownMemo.get(w);
  if (m && m.owned === w.owned && m.living === w.living && m.perks === data.perks && m.lv === lv) return m.res;
  const res = { shown: {}, stored: {}, storedCount: 0 }, left = [...(w.owned || [])];
  for (const pl of SHOWN_PLACES) {
    const r = campusBelongings.shownAt(pl, lv, w.owned || [], data.perks || {}, w.living || []);
    res.shown[pl] = r.shown; res.stored[pl] = r.stored; res.storedCount += r.stored.length;
    for (const k of r.stored) { const i = left.indexOf(k); if (i >= 0) left.splice(i, 1); }
  }
  res.ownedShown = left; // what they own minus what is in storage (used-up things included): the drawing code's "owned"
  _shownMemo.set(w, { owned: w.owned, living: w.living, perks: data.perks, lv, res });
  return res;
}
const shownOwned = (id) => shownIn(id).ownedShown;
const ownAt = (id, place) => [...new Set(shownIn(id).shown[place] || [])];
// "+N in storage" for a worker, in words, with the stored things named (places: which of flat, balcony, garden, desk)
function storedWords(keys) { const c = new Map(); for (const k of keys) c.set(k, (c.get(k) || 0) + 1); return [...c].map(([k, n]) => `${data.perks?.[k]?.icon ? data.perks[k].icon + " " : ""}${(data.perks?.[k]?.label || k).replace(/^(a|an|the) /, "")}${n > 1 ? ` x${n}` : ""}`).join(", "); }
function storageLine(id, places = ["flat", "balcony", "garden", "desk"]) {
  const st = shownIn(id).stored, where = { flat: "in the flat", balcony: "on the balcony", garden: "in the garden", desk: "at the desk" };
  const parts = places.filter((pl) => (st[pl] || []).length).map((pl) => `${where[pl]}: ${storedWords(st[pl])}`), n = places.reduce((a, pl) => a + (st[pl] || []).length, 0);
  return n ? `<details class="sub" title="${esc(parts.join("; "))}"><summary>📦 +${n} in storage</summary>${esc(parts.join("; "))}</details>` : "";
}
const storageNote = (keys) => (keys?.length ? `<div class="sub" title="${esc(storedWords(keys))}">📦 +${keys.length} in storage: ${esc(storedWords(keys))}</div>` : "");
const itemWords = (keys, id) => keys.map((k) => { const p = data.perks?.[k], v = (data.wallets?.[id]?.living || []).find((x) => x.item === k); return `${p?.icon ? p.icon + " " : ""}${(p?.label || k).replace(/^(a|an|the) /, "")}${v ? ` (${v.word})` : ""}`; }).join(", ");
// "On their balcony: ..." and "In the community garden: ..." for a home or worker panel (words, not colour)
function gardenLine(id) {
  const g = ownAt(id, "garden"), b = ownAt(id, "balcony");
  return `${b.length ? `<div class="sub">🌿 On their balcony: ${esc(itemWords(b, id))}</div>` : ""}${g.length ? `<div class="sub">🌻 In the community garden: ${esc(itemWords(g, id))} <button class="pill" data-garden="1" style="margin-left:4px">Their plot</button></div>` : ""}${storageLine(id, ["flat", "balcony", "garden"])}`;
}
function wireGardenLine(p) { p.querySelectorAll("[data-garden]").forEach((b) => (b.onclick = () => openGarden())); }
// The garden lot west of the Residences square (cityHouses places it): a plot per person with something in the garden.
function cityGarden(laneX, gy0, GD) {
  if (!data.perks || typeof campusBelongings === "undefined") return null;
  const people = data.desks.filter((d) => d.status !== "retired" && data.rooms.some((x) => x.id === d.room)).map((d) => ({ id: d.id, name: nameOf(d), level: levelOfDesk(d.id), owned: data.wallets?.[d.id]?.owned || [], living: data.wallets?.[d.id]?.living || [] }));
  const { plots, balconyOnly } = campusBelongings.gardenPlots(people, data.perks);
  const { rows, cols } = campusBelongings.gardenGrid(plots.length);
  const P = 1.3, Q = 0.3, w = cols * P + (cols + 1) * Q, d = rows * P + (rows + 1) * Q, x = laneX - 0.7 - w, y = gy0 + (GD - d) / 2;
  plots.forEach((p, i) => Object.assign(p, { x: x + Q + (i % cols) * (P + Q), y: y + Q + Math.floor(i / cols) * (P + Q), w: P, d: P }));
  const free = Array.from({ length: rows * cols - plots.length }, (_, j) => { const i = plots.length + j; return { x: x + Q + (i % cols) * (P + Q), y: y + Q + Math.floor(i / cols) * (P + Q), w: P, d: P }; });
  return { id: "garden", isGarden: true, name: "Community garden", x, y, w, d, h: 0.25, hue: 110, face: "e", desks: [], floors: [], feed: [], lastByDesk: {}, spend: 0, sub: 0, cap: null, district: "Home", plots, free, balconyOnly, rows, cols, gateY: y + d / 2 };
}
// One plot's things (2D), laid out like a small front yard: the big things in its four corners, the fence round it,
// the mailbox at its front edge. Reuses the house-yard drawings (houseYard).
function drawPlotThings(p, t) {
  const { x, y, w, d } = p, own = p.garden, dk = deskById(p.id), home = !!dk && whereIs(dk) === "home";
  const life = (k) => (data.wallets?.[p.id]?.living || []).find((v) => v.item === k);
  const spots = [[0.28, 0.3], [0.72, 0.3], [0.28, 0.68], [0.72, 0.68]];
  let s = 0;
  for (const k of own) {
    if (k === "fence") { ctx.strokeStyle = "rgba(244,236,220,0.95)"; ctx.lineWidth = Math.max(1, 1.3 * cam.z); const c = [[x + 0.04, y + 0.04], [x + w - 0.04, y + 0.04], [x + w - 0.04, y + d - 0.04], [x + 0.04, y + d - 0.04], [x + 0.04, y + 0.04]]; ctx.beginPath(); c.forEach(([a, b], i) => { const [sx, sy] = toScreen(a, b, 0.14); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }); ctx.stroke(); for (const [a, b] of c.slice(0, 4)) { const [p1x, p1y] = toScreen(a, b, 0), [p2x, p2y] = toScreen(a, b, 0.2); ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke(); } continue; }
    if (k === "mailbox") { const [mx, my] = toScreen(x + w - 0.12, y + d - 0.02, 0.25); box(x + w - 0.14, y + d - 0.06, 0.04, 0.04, 0.22, "#8b6a4a", "#6d523a", "#5e4632"); emoji(mx, my, 10 * cam.z, data.perks[k].icon); continue; }
    const [fx, fy] = spots[s++ % spots.length], cx = x + w * fx, cy = y + d * fy;
    if (k === "gnome") { box(cx, cy, 0.08, 0.08, 0.1, "#4a7bd0", "#3e68b0", "#345a98"); box(cx + 0.01, cy + 0.01, 0.06, 0.06, 0.09, "#e05d5d", "#c94f4f", "#b04444", 0.1); continue; }
    if (k === "bbq") { box(cx - 0.09, cy - 0.09, 0.18, 0.18, 0.2, "#2c3440", "#1d232c", "#161b22"); if (home) for (let i = 0; i < 3; i++) { const ph = ((t / 1600) + i / 3) % 1, [sx, sy] = toScreen(cx, cy, 0.25 + ph * 0.6); ctx.fillStyle = `rgba(220,220,220,${0.4 * (1 - ph)})`; ctx.beginPath(); ctx.arc(sx, sy, (2 + ph * 4) * cam.z, 0, Math.PI * 2); ctx.fill(); } continue; }
    if (k === "hottub") { box(cx - 0.22, cy - 0.22, 0.45, 0.45, 0.14, `rgba(110,200,255,${0.8 + 0.1 * Math.sin(t / 500)})`, "#8a6a48", "#6d523a"); continue; }
    if (k === "koipond") poly([toScreen(cx - 0.26, cy - 0.2, 0.01), toScreen(cx + 0.26, cy - 0.2, 0.01), toScreen(cx + 0.26, cy + 0.2, 0.01), toScreen(cx - 0.26, cy + 0.2, 0.01)], `rgba(90,170,220,${0.8 + 0.1 * Math.sin(t / 700)})`, "rgba(120,110,96,0.8)");
    if (k === "garden") poly([toScreen(cx - 0.25, cy - 0.18, 0.01), toScreen(cx + 0.25, cy - 0.18, 0.01), toScreen(cx + 0.25, cy + 0.18, 0.01), toScreen(cx - 0.25, cy + 0.18, 0.01)], "#7a5a3c"); // the bed's soil
    // anything else (and the pond's koi, the bed's flowers): its picture, sized by its life and leaning when wilting
    const v = life(k), sz = v ? [0.75, 1, 1.3][(v.size || 1) - 1] : 1, [ix, iy] = toScreen(cx, cy, 0.02);
    ctx.save(); ctx.translate(ix, iy); if (v?.need === "wilting") ctx.rotate(0.6); emoji(0, 0, (k === "treehouse" ? 17 : 12) * cam.z * sz, data.perks[k]?.icon || "🎁"); ctx.restore();
    if (v && cam.z > 1.4) { ctx.font = "600 9px system-ui"; ctx.textAlign = "center"; haloText(v.word, ix, iy + 10, dn("#3b2a10", "#f3d9a4")); }
  }
}
function drawGarden(r, t) {
  if (r.garden === "shared") return drawSharedGarden(r, t);
  if (r.garden === "break") return drawBreakGarden(r, t);
  const { x, y, w, d } = r, hov = hover === r.id, sel = openRoom === r.id;
  // gravel paths over the whole lot, a low hedge round it with the gate on the lane side, then the plots
  poly([toScreen(x, y), toScreen(x + w, y), toScreen(x + w, y + d), toScreen(x, y + d)], dn("#ddd2bb", "#5f5a50"), hov || sel ? "#f3d9a4" : null);
  const hedge = ["#6aa858", "#5a9448", "#4c823c"], HH = 0.16, gate = 0.7;
  box(x - 0.12, y - 0.12, w + 0.24, 0.12, HH, ...hedge); box(x - 0.12, y - 0.12, 0.12, d + 0.24, HH, ...hedge);
  for (const f of r.free) { poly([toScreen(f.x, f.y), toScreen(f.x + f.w, f.y), toScreen(f.x + f.w, f.y + f.d), toScreen(f.x, f.y + f.d)], dn("rgba(122,90,60,0.55)", "rgba(80,62,44,0.6)")); if (cam.z > 1.1) { const [fx, fy] = toScreen(f.x + f.w / 2, f.y + f.d / 2); ctx.font = "600 9px system-ui"; ctx.textAlign = "center"; haloText("free plot", fx, fy, dn("#5a4a30", "#e9e0cc")); } }
  for (const p of r.plots) {
    poly([toScreen(p.x, p.y), toScreen(p.x + p.w, p.y), toScreen(p.x + p.w, p.y + p.d), toScreen(p.x, p.y + p.d)], dn("rgba(111,176,96,0.85)", "rgba(70,120,66,0.8)"));
    drawPlotThings(p, t);
    // the name tag at the plot's front (words, never colour alone)
    if (cam.z > 0.6) { const [nx, ny] = toScreen(p.x + p.w / 2, p.y + p.d - 0.05, 0); ctx.font = `600 ${Math.max(8, Math.min(11, 8 * cam.z))}px system-ui`; ctx.textAlign = "center"; haloText(p.name, nx, ny + 9, dn("rgba(50,44,32,0.95)", "rgba(240,232,214,0.92)")); }
  }
  // the near hedges last (they stand in front of the plots), the gate gap facing the lane
  box(x - 0.12, y + d, w + 0.24, 0.12, HH, ...hedge);
  box(x + w, y - 0.12, 0.12, (d - gate) / 2 + 0.12, HH, ...hedge); box(x + w, r.gateY + gate / 2, 0.12, (d - gate) / 2 + 0.12, HH, ...hedge);
  // the word sign at the gate: a low board on two posts
  const gx = x + w + 0.3, gy = r.gateY + gate / 2 + 0.15;
  box(gx, gy, 0.05, 0.05, 0.35, "#8b6a4a", "#6d523a", "#5e4632"); box(gx, gy + 0.5, 0.05, 0.05, 0.35, "#8b6a4a", "#6d523a", "#5e4632");
  box(gx - 0.02, gy - 0.02, 0.06, 0.6, 0.16, "#e9dcc0", "#d6c7a6", "#c4b591", 0.3);
}
// Tap the garden: every plot, its owner and their things in words; people whose outdoor things are all on their balcony.
function openGarden() {
  if (view) setView(null);
  const g = gardenRoomById("garden");
  if (g && !window.campus3dActive) { const [a, b] = iso(g.x + g.w / 2, g.y + g.d / 2); cam.z = Math.max(cam.z, 1.2); cam.x = a; cam.y = b + (H * 0.22) / cam.z; }
  else if (g && window.campus3d?.focus) window.campus3d.focus("garden", { calm: true });
  gardenPanel();
}
function gardenPanel() {
  const g = gardenRoomById("garden");
  if (!g) return showPanel("garden", "🌻 Community garden", '<div class="sub mt-1">The garden is on the campus view, beside the Residences (it opens with the Campus Mart).</div>');
  const lvWord = (p) => (p.level == null ? "no flat (works in the CEO tower)" : `${resLevel(p.level).name} flat, ${p.level >= 1 ? "with a balcony" : "no balcony"}`);
  const p = showPanel("garden", "🌻 Community garden", `
    <div class="sub mt-1">Outdoor things live on their owner's balcony first (Comfy flats and up). What can't fit on a balcony (koi ponds, treehouses, hot tubs, picket fences, mailboxes), and everything outdoors of someone with no balcony (Basic flats, the HR desks), is here on their own plot.</div>
    ${sharedWordsHtml()}
    <div class="sub mt-1">${g.plots.length} plot${g.plots.length === 1 ? "" : "s"}${g.free.length ? ` · ${g.free.length} free` : ""}</div>
    ${g.plots.map((x) => `<div class="row"><button class="pill" data-gw="${esc(x.id)}">${esc(x.name)}</button> <span class="sub">${esc(lvWord(x))}</span><div class="sub">On their plot: ${esc(itemWords(x.garden, x.id))}</div>${storageNote(x.gardenStored)}${x.balcony.length ? `<div class="sub">On their balcony: ${esc(itemWords(x.balcony, x.id))}</div>` : ""}${storageNote(x.balconyStored)}</div>`).join("") || '<div class="sub">No plots yet. Anyone who buys an outdoor thing that needs one gets a plot here.</div>'}
    ${g.balconyOnly.length ? `<h3 class="mt-4 font-semibold text-sm">On their balconies instead (${g.balconyOnly.length})</h3>${g.balconyOnly.map((x) => `<div class="row"><button class="pill" data-gw="${esc(x.id)}">${esc(x.name)}</button> <span class="sub">${esc(itemWords(x.balcony, x.id))}</span>${storageNote(x.balconyStored)}</div>`).join("")}` : ""}`);
  p.querySelectorAll("[data-gw]").forEach((b) => (b.onclick = () => { const id = b.dataset.gw, d = deskById(id); if (homeOf(id)) openHome(id); else if (d) workerPanel(d); }));
}
// Balcony things on a flat's balcony (2D, outside and in the floor view), and now and then the owner out there when
// they're home (a cheap turn by the clock: about one minute in three, a different minute for each flat).
function drawBalconyThings(id, cx, by, bz, bw, t, s = 1, who = true) {
  const keys = ownAt(id, "balcony"), dk = deskById(id);
  keys.forEach((k, i) => {
    const kx = cx - bw / 2 + (bw * (i + 1)) / (keys.length + 2), q = 0.6 * s;
    // the gnome and the barbecue have no picture of their own: the same little blocks as in a yard
    if (k === "gnome") { box(kx, by, 0.08 * q, 0.08 * q, 0.1 * q, "#4a7bd0", "#3e68b0", "#345a98", bz); box(kx + 0.01 * q, by + 0.01 * q, 0.06 * q, 0.06 * q, 0.09 * q, "#e05d5d", "#c94f4f", "#b04444", bz + 0.1 * q); return; }
    if (k === "bbq") { box(kx - 0.09 * q, by - 0.09 * q, 0.18 * q, 0.18 * q, 0.2 * q, "#2c3440", "#1d232c", "#161b22", bz); return; }
    const [ix, iy] = toScreen(kx, by, bz + 0.02); emoji(ix, iy - 4 * cam.z * s, Math.max(7, 8 * cam.z * s), data.perks[k]?.icon || "🎁");
  });
  if (who && dk && whereIs(dk) === "home" && onBalconyNow(id)) { const [px, py] = toScreen(cx + bw * 0.36, by, bz + 0.02), q = cam.z * 0.6 * s; ctx.fillStyle = PROVIDER[dk.provider] || PROVIDER.other; roundRect(px - 5 * q, py - 16 * q, 10 * q, 11 * q, 3 * q); ctx.fill(); ctx.fillStyle = "#f4ecdc"; roundRect(px - 6 * q, py - 26 * q, 12 * q, 10 * q, 4 * q); ctx.fill(); }
}
const onBalconyNow = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return (Math.floor(Date.now() / 60000) + h) % 3 === 0; };

// ---------- the shared garden and the break garden (the gardens lane, 2026-11-16) ----------
// the owner: "do we need more garden spots?" ... "both". Two rooms like the community garden (isGarden: never an office, no
// battery, no confetti), told apart by `garden`: "shared" (id "garden-shared": the community garden's part that belongs
// to everyone, alongside the private plots) and "break" (id "break-garden": a small garden by the work wings where
// workers on a break sit). Where they go is the layout rules' answer (model/quad.js: p.shared and p.breakGarden in the
// quad; streetsSharedLot and streetsBreakLot in the streets); what is in them and where each seat is comes from
// gardenLayout(r), the one list the 2D drawing, the 3D model, the sitters and the walkers all read.
const gardenRoomById = (id) => rooms.find((r) => r.id === id);
const GARDEN_BLANK = () => ({ h: 0.25, hue: 110, desks: [], floors: [], feed: [], lastByDesk: {}, spend: 0, sub: 0, cap: null });
function sharedGardenRoom(B, gateSide) {
  return { ...GARDEN_BLANK(), id: "garden-shared", isGarden: true, garden: "shared", name: "Shared garden", x: B.x, y: B.y, w: B.w, d: B.d, face: gateSide, gateSide, gateY: B.gateY, district: "Home" };
}
function breakGardenRoom(B) {
  const r = { ...GARDEN_BLANK(), id: "break-garden", isGarden: true, garden: "break", name: "Break garden", x: B.x, y: B.y, w: B.w, d: B.d, face: "s", gateX: B.gateX, walkIn: true, district: "Square" };
  if (B.gx != null) { r.gx = B.gx; r.gy = B.gy; } // the streets' civic-row lot it takes: the park filler leaves it alone
  return r;
}
// What is in a garden and where (campus tiles): paths, benches with their seats, trees, flower beds, a lamp, the sign,
// and for the shared garden the pergola, the vegetable patch and the tap; for the break garden the picnic table and the
// pond. A seat is [x, y, heading, kind]: heading as the 3D crowd takes it (0 faces south, PI north).
function gardenLayout(r) {
  const key = `${r.x},${r.y},${r.w},${r.d},${r.gateX},${r.gateY}`;
  if (r._lay?.key === key) return r._lay;
  const L = { key, paths: [], benches: [], seats: [], trees: [], beds: [], lamp: null, sign: null };
  const S = Math.PI, N = 0;
  if (r.garden === "shared") {
    const west = r.gateSide !== "e", X = (u) => (west ? r.x + u * r.w : r.x + r.w - u * r.w), Y = (v) => r.y + v * r.d, gy = r.gateY ?? r.y + r.d / 2;
    const span = (u0, u1) => ({ x: Math.min(X(u0), X(u1)), w: Math.abs(X(u1) - X(u0)) }), toPatch = west ? S / 2 : -S / 2;
    L.gate = { side: west ? "w" : "e", at: gy };
    L.paths.push({ ...span(0, 0.6), y: gy - 0.3, d: 0.6 });
    L.patch = { ...span(0.63, 0.95), y: Y(0.12), d: r.d * 0.76 };
    L.pergola = { ...span(0.12, 0.47), y: Y(0.04), d: r.d * 0.36 };
    L.tap = [X(0.56), Y(0.13)]; L.can = [X(0.555), Y(0.25)];
    for (const [v, hd] of [[0.22, N], [0.8, S]]) {
      const b = { x: X(0.3), y: Y(v), along: "x", hd, seats: [] };
      for (const du of [-0.06, 0.06]) { const s = [X(0.3 + du), Y(v), hd, "bench"]; b.seats.push(s); }
      L.benches.push(b);
    }
    L.seats = [L.benches[0].seats[0], L.benches[1].seats[1], L.benches[0].seats[1], L.benches[1].seats[0], [X(0.585), Y(0.42), toPatch, "patch"], [X(0.585), Y(0.7), toPatch, "patch"]];
    L.trees.push([X(0.07), Y(0.9)]);
    L.beds.push([X(0.52), Y(0.86), 0.32]);
    L.lamp = [X(0.04), gy - 0.75];
    L.sign = [west ? r.x - 0.35 : r.x + r.w + 0.35, gy + 0.75];
  } else if (r.garden === "break") {
    const X = (u) => r.x + u * r.w, Y = (v) => r.y + v * r.d, gx = r.gateX ?? r.x + r.w / 2, ym = Y(0.5);
    L.gate = { side: "s", at: gx };
    L.paths.push({ x: gx - 0.3, y: ym - 0.3, w: 0.6, d: r.y + r.d - (ym - 0.3) }, { x: X(0.07), y: ym - 0.3, w: r.w * 0.86, d: 0.6 });
    // the picnic table with a bench either side (four seats), north-west; the pond with lily pads north-east
    const tx = X(0.28), ty = Y(0.25);
    L.table = { x: tx, y: ty, w: Math.min(1.1, r.w * 0.24), d: 0.55 };
    for (const [dy, hd] of [[-0.48, N], [0.48, S]]) {
      const b = { x: tx, y: ty + dy, along: "x", hd, table: true, len: L.table.w, seats: [] };
      for (const dx of [-0.26, 0.26]) b.seats.push([tx + dx * (L.table.w / 1.1), ty + dy, hd, "table"]);
      L.benches.push(b);
    }
    L.pond = { x: X(0.72), y: Y(0.27), r: Math.max(0.35, Math.min(0.85, r.w * 0.11, r.d * 0.17)) };
    // the south half: benches facing the path, flower beds between, never in the gate's path
    const free = [0.18, 0.5, 0.82].filter((u) => Math.abs(X(u) - gx) > 0.95);
    free.forEach((u, i) => {
      if (i % 2 === 0) { const b = { x: X(u), y: Y(0.78), along: "x", hd: S, seats: [[X(u) - 0.2, Y(0.78), S, "bench"], [X(u) + 0.2, Y(0.78), S, "bench"]] }; L.benches.push(b); }
      else L.beds.push([X(u), Y(0.8), 0.42]);
    });
    if (r.w >= 5.5) L.benches.push({ x: X(0.5), y: Y(0.14), along: "x", hd: N, seats: [[X(0.5) - 0.2, Y(0.14), N, "bench"], [X(0.5) + 0.2, Y(0.14), N, "bench"]] }); // by the north hedge, facing the path
    else L.beds.push([X(0.5), Y(0.2), 0.3]);
    L.trees.push([X(0.07), Y(0.1)], [X(0.93), Y(0.1)], gx < r.x + r.w / 2 ? [X(0.93), Y(0.9)] : [X(0.07), Y(0.9)]);
    L.seats = L.benches.flatMap((b) => b.seats);
    L.lamp = [gx + 0.6, r.y + r.d - 0.3]; L.lamp2 = [r.x + r.w - 0.3, ym + 0.45]; // by the gate, and at the far end of the cross path
    L.sign = [gx - 0.75, r.y + r.d - 0.25];
  }
  r._lay = L;
  return L;
}
// The shared vegetable patch shows a little of the campus's week: one crop for each job finished in the last 7 days, up
// to 8 (just for looks; the panel says so). Everything else in the gardens is fixed.
function sharedCrops() {
  const since = Date.now() - 7 * 864e5;
  return Math.min(8, (data?.jobs || []).filter((j) => j.status === "done" && Date.parse(j.doneAt || j.updatedAt || j.at || 0) >= since).length);
}
// Who is in the shared garden now: residents who are home in the evening (18:00-23:00), not out walking, and not on
// their balcony this minute. A cheap turn by the clock and their id like the balcony (onBalconyNow takes minute % 3 === 0;
// this takes % 3 === 1), so nobody is ever in both, and up to one person a seat. No timers, no AI calls.
function sharedSittersNow(r) {
  if (!r || typeof evening !== "function" || !evening() || !data?.desks) return [];
  const L = gardenLayout(r), out = [], m = Math.floor(Date.now() / 60000);
  for (const d of data.desks) {
    if (out.length >= L.seats.length) break;
    if (!homeOf(d.id) || whereIs(d) !== "home" || (typeof walkers !== "undefined" && walkers.has(d.id)) || onBalconyNow(d.id)) continue;
    let h = 0; for (const c of String(d.id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    if ((m + h) % 3 === 1) out.push({ d, seat: L.seats[out.length] });
  }
  return out;
}
// Who is sitting in the break garden now: walkers on a break (people.js stepWalkers) who have reached a seat there.
const breakSittersNow = () => (typeof walkers === "undefined" ? [] : [...walkers.values()].filter((w) => w.sit && w.seatRoom === "break-garden").map((w) => w.d));
// 2D draw order inside a garden: a seated person right after their own bench (so before a table they sit behind)
const seatKey = (L, s) => { const b = L.benches.find((x) => x.seats.includes(s)); return b ? b.x + b.y + 0.005 : s[0] + s[1]; };
// 2D: a bench (a seat slab and, behind the sitter, a back), a small seated or kneeling person
function gardenBench2d(b) {
  const wood = ["#b98a5c", "#9a6f48", "#86603e"], len = b.len || 0.72;
  box(b.x - len / 2, b.y - 0.1, len, 0.2, 0.05, ...wood, 0.14);
  if (!b.table) box(b.x - len / 2, b.hd === 0 ? b.y - 0.13 : b.y + 0.09, len, 0.04, 0.2, ...wood, 0.17);
}
function gardenFolk2d(d, x, y, kind) {
  const [px, py] = toScreen(x, y, kind === "patch" ? 0.02 : 0.18), q = cam.z * 0.62;
  const tall = kind === "patch" ? 9 : 10;
  ctx.fillStyle = PROVIDER[d.provider] || PROVIDER.other; roundRect(px - 5 * q, py - (tall + 4) * q, 10 * q, tall * q, 3 * q); ctx.fill();
  ctx.fillStyle = "#f4ecdc"; roundRect(px - 6 * q, py - (tall + 14) * q, 12 * q, 10 * q, 4 * q); ctx.fill();
  ctx.fillStyle = "#1b1f27"; ctx.fillRect(px - 3 * q, py - (tall + 11) * q, 1.8 * q, 2.2 * q); ctx.fillRect(px + 1.3 * q, py - (tall + 11) * q, 1.8 * q, 2.2 * q);
}
// 2D: a low hedge round the lot with a gate gap (side "n" "s" "e" "w", at = the gap's middle along that side)
function gardenHedge2d(r, gate, front) {
  const hedge = ["#6aa858", "#5a9448", "#4c823c"], HH = 0.16, G = 0.8, { x, y, w, d } = r;
  const run = (side) => {
    const horiz = side === "n" || side === "s", y0 = side === "s" ? y + d : y - 0.12, x0 = side === "e" ? x + w : x - 0.12;
    const segs = gate.side === side ? (horiz ? [[x - 0.12, gate.at - G / 2], [gate.at + G / 2, x + w + 0.12]] : [[y - 0.12, gate.at - G / 2], [gate.at + G / 2, y + d + 0.12]]) : [[horiz ? x - 0.12 : y - 0.12, horiz ? x + w + 0.12 : y + d + 0.12]];
    for (const [a, b] of segs) if (b - a > 0.05) horiz ? box(a, y0, b - a, 0.12, HH, ...hedge) : box(x0, a, 0.12, b - a, HH, ...hedge);
  };
  (front ? ["s", "e"] : ["n", "w"]).forEach(run);
}
function gardenSignBoard2d(sx, sy) {
  box(sx, sy, 0.05, 0.05, 0.35, "#8b6a4a", "#6d523a", "#5e4632"); box(sx, sy + 0.5, 0.05, 0.05, 0.35, "#8b6a4a", "#6d523a", "#5e4632");
  box(sx - 0.02, sy - 0.02, 0.06, 0.6, 0.16, "#e9dcc0", "#d6c7a6", "#c4b591", 0.3);
}
// 2D: a little string of warm bulbs from a to b at height z (lit after dark)
function stringLights2d(a, b, z, n = 7) {
  const on = Math.min(1, Math.max(0, (night - 0.25) / 0.5));
  const [ax, ay] = toScreen(a[0], a[1], z), [bx, by] = toScreen(b[0], b[1], z);
  ctx.strokeStyle = dn("rgba(70,60,50,0.55)", "rgba(40,34,28,0.7)"); ctx.lineWidth = Math.max(0.6, 0.8 * cam.z);
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + 3 * cam.z, bx, by); ctx.stroke();
  for (let i = 1; i < n; i++) {
    const k = i / n, px = ax + (bx - ax) * k, py = ay + (by - ay) * k + Math.sin(k * Math.PI) * 2.2 * cam.z;
    if (on > 0.05) { const g = ctx.createRadialGradient(px, py, 0, px, py, 6 * cam.z); g.addColorStop(0, `rgba(255,214,140,${0.6 * on})`); g.addColorStop(1, "rgba(255,214,140,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, 6 * cam.z, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = on > 0.05 ? "#ffe6a8" : "#d9d2c0"; ctx.beginPath(); ctx.arc(px, py, Math.max(0.8, 1.3 * cam.z), 0, Math.PI * 2); ctx.fill();
  }
}
function drawSharedGarden(r, t) {
  const { x, y, w, d } = r, L = gardenLayout(r), sel = openRoom === r.id || hover === r.id || openRoom === "garden";
  poly([toScreen(x, y), toScreen(x + w, y), toScreen(x + w, y + d), toScreen(x, y + d)], dn("#93c47a", "#2f4a32"), sel ? "#f3d9a4" : null); // the lawn
  gardenHedge2d(r, L.gate, false);
  for (const p of L.paths) rect(p.x, p.y, p.w, p.d, dn("#ddd2bb", "#5f5a50"));
  // the vegetable patch: soil in rows, a crop per job finished this week (up to 8), sprouts on the rest
  const P = L.patch; rect(P.x, P.y, P.w, P.d, dn("#8a6644", "#4a3826"));
  const crops = sharedCrops(), rowsN = 3, per = 4;
  for (let i = 0; i < rowsN; i++) rect(P.x + 0.12, P.y + (P.d * (i + 0.5)) / rowsN - 0.06, P.w - 0.24, 0.12, dn("#6e4f33", "#3a2c1e"));
  for (let k = 0; k < rowsN * per; k++) {
    const i = Math.floor(k / per), j = k % per, cx = P.x + (P.w * (j + 0.5)) / per, cy = P.y + (P.d * (i + 0.5)) / rowsN, [sx, sy] = toScreen(cx, cy, 0.02);
    ctx.fillStyle = k < crops ? dn("#4f9a48", "#2f6b3a") : dn("#9ccc72", "#4a7a44");
    ctx.beginPath(); ctx.ellipse(sx, sy - (k < crops ? 3 : 1.5) * cam.z, (k < crops ? 4.5 : 2) * cam.z, (k < crops ? 3.2 : 1.5) * cam.z, 0, 0, Math.PI * 2); ctx.fill();
  }
  // the tap and the watering can, a flower bed, a tree and the lamp by the gate
  box(L.tap[0] - 0.04, L.tap[1] - 0.04, 0.08, 0.08, 0.42, "#9aa3ad", "#7d8794", "#6c7580");
  box(L.can[0] - 0.09, L.can[1] - 0.07, 0.18, 0.14, 0.14, "#5f8fb0", "#4c7894", "#40667e");
  const items = [];
  for (const b of L.beds) items.push([b[0] + b[1], () => { const [bx, by] = toScreen(b[0], b[1], 0.02); ctx.fillStyle = dn("#7a5a3c", "#4a3826"); ctx.beginPath(); ctx.ellipse(bx, by, 11 * cam.z * b[2] / 0.32, 5.5 * cam.z * b[2] / 0.32, 0, 0, Math.PI * 2); ctx.fill(); ["#e05d8a", "#f0b45a", "#f4ecdc", "#b48cff"].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(bx + (i - 1.5) * 4 * cam.z, by - (i % 2) * 2 * cam.z, 1.8 * cam.z, 0, Math.PI * 2); ctx.fill(); }); }]);
  for (const b of L.benches) items.push([b.x + b.y, () => gardenBench2d(b)]);
  for (const s of sharedSittersNow(r)) items.push([seatKey(L, s.seat), () => gardenFolk2d(s.d, s.seat[0], s.seat[1], s.seat[3])]);
  for (const tr of L.trees) items.push([tr[0] + tr[1], () => tree(tr[0], tr[1])]);
  items.push([L.lamp[0] + L.lamp[1], () => lamp(L.lamp[0], L.lamp[1])]);
  // the pergola over the north bench: four posts, two beams, slats, and string lights
  const G = L.pergola, posts = [[G.x, G.y], [G.x + G.w, G.y], [G.x, G.y + G.d], [G.x + G.w, G.y + G.d]];
  items.push([G.x + G.y + G.w + G.d, () => {
    ctx.strokeStyle = dn("#8b6a4a", "#5e4632"); ctx.lineWidth = Math.max(1, 2 * cam.z);
    for (const [px, py] of posts) { const [a, b2] = toScreen(px, py, 0), [c, e] = toScreen(px, py, 1.05); ctx.beginPath(); ctx.moveTo(a, b2); ctx.lineTo(c, e); ctx.stroke(); }
    for (const [p0, p1] of [[posts[0], posts[1]], [posts[2], posts[3]]]) { const [a, b2] = toScreen(p0[0] - 0.1, p0[1], 1.05), [c, e] = toScreen(p1[0] + 0.1, p1[1], 1.05); ctx.beginPath(); ctx.moveTo(a, b2); ctx.lineTo(c, e); ctx.stroke(); }
    ctx.lineWidth = Math.max(1, 1.2 * cam.z);
    for (let k = 0; k <= 4; k++) { const sx = G.x + (G.w * k) / 4, [a, b2] = toScreen(sx, G.y - 0.1, 1.1), [c, e] = toScreen(sx, G.y + G.d + 0.1, 1.1); ctx.beginPath(); ctx.moveTo(a, b2); ctx.lineTo(c, e); ctx.stroke(); }
    stringLights2d(posts[0], posts[1], 1.0); stringLights2d(posts[2], posts[3], 1.0); stringLights2d(posts[0], posts[3], 1.02, 9);
  }]);
  items.sort((a, b) => a[0] - b[0]).forEach(([, f]) => f());
  gardenHedge2d(r, L.gate, true);
  gardenSignBoard2d(L.sign[0], L.sign[1]);
}
function drawBreakGarden(r, t) {
  const { x, y, w, d } = r, L = gardenLayout(r), sel = openRoom === r.id || hover === r.id;
  poly([toScreen(x, y), toScreen(x + w, y), toScreen(x + w, y + d), toScreen(x, y + d)], dn("#93c47a", "#2f4a32"), sel ? "#f3d9a4" : null);
  gardenHedge2d(r, L.gate, false);
  for (const p of L.paths) rect(p.x, p.y, p.w, p.d, dn("#ddd2bb", "#5f5a50"));
  // the pond: still water with lily pads and a ring of stones (not a fountain: no jets, no basin)
  const P = L.pond, ring = (rad, z) => Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return toScreen(P.x + Math.cos(a) * rad, P.y + Math.sin(a) * rad * 0.85, z); });
  poly(ring(P.r + 0.12, 0.01), dn("#b9b1a0", "#55504a")); poly(ring(P.r, 0.02), dn(`rgba(96,168,206,${0.88 + 0.06 * Math.sin(t / 900)})`, "rgba(40,92,120,0.95)"));
  for (const [du, dv] of [[-0.35, -0.2], [0.25, 0.15], [0.05, -0.4]]) { const [lx, ly] = toScreen(P.x + du * P.r, P.y + dv * P.r, 0.03); ctx.fillStyle = dn("#4f9a48", "#2f6b3a"); ctx.beginPath(); ctx.ellipse(lx, ly, 3.4 * cam.z, 2 * cam.z, 0, 0.3, Math.PI * 2); ctx.lineTo(lx, ly); ctx.fill(); }
  const items = [];
  for (const b of L.beds) items.push([b[0] + b[1], () => { const [bx, by] = toScreen(b[0], b[1], 0.02); ctx.fillStyle = dn("#7a5a3c", "#4a3826"); ctx.beginPath(); ctx.ellipse(bx, by, 11 * cam.z * b[2] / 0.32, 5.5 * cam.z * b[2] / 0.32, 0, 0, Math.PI * 2); ctx.fill(); ["#e05d8a", "#f0b45a", "#f4ecdc", "#b48cff", "#e05d5d"].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(bx + (i - 2) * 4 * cam.z, by - (i % 2) * 2.4 * cam.z, 2 * cam.z, 0, Math.PI * 2); ctx.fill(); }); }]);
  const T = L.table; items.push([T.x + T.y, () => { box(T.x - T.w / 2, T.y - T.d / 2, T.w, T.d, 0.05, "#c99a68", "#a77b50", "#916a44", 0.3); box(T.x - 0.04, T.y - 0.04, 0.08, 0.08, 0.3, "#86603e", "#86603e", "#86603e"); }]);
  // string lights over the table on two posts behind its north bench (lit after dark; the 3D view has the same)
  const sa = [T.x - T.w / 2 - 0.15, T.y - 0.65], sb = [T.x + T.w / 2 + 0.15, T.y - 0.65];
  items.push([sa[0] + sa[1] - 0.05, () => { for (const [px, py] of [sa, sb]) box(px - 0.03, py - 0.03, 0.06, 0.06, 1.1, "#8b6a4a", "#6d523a", "#5e4632"); stringLights2d(sa, sb, 1.05, 7); }]);
  for (const b of L.benches) items.push([b.x + b.y, () => gardenBench2d(b)]);
  // walkers on a break sitting here: drawn with the garden, so its lawn and benches never cover them (people.js
  // drawWalker leaves seated ones to this)
  if (typeof walkers !== "undefined") for (const w of walkers.values()) if (w.sit && w.seatRoom === r.id && Math.hypot(w.tx - w.x, w.ty - w.y) <= 0.05) items.push([seatKey(L, w.sit), () => drawWalker(w, t, true)]);
  for (const tr of L.trees) items.push([tr[0] + tr[1], () => tree(tr[0], tr[1])]);
  for (const lp of [L.lamp, L.lamp2].filter(Boolean)) items.push([lp[0] + lp[1], () => lamp(lp[0], lp[1])]);
  items.sort((a, b) => a[0] - b[0]).forEach(([, f]) => f());
  gardenHedge2d(r, L.gate, true);
  gardenSignBoard2d(L.sign[0], L.sign[1]);
}
// Tap the break garden: what it is and who is sitting there now, in words.
function breakGardenPanel() {
  const r = gardenRoomById("break-garden"), here = breakSittersNow();
  const p = showPanel("break-garden", "🌳 Break garden", `
    <div class="sub mt-1">A small garden by the work wings: benches, a picnic table, flower beds, trees and a little pond with lily pads. Workers taking a break from the wings come out here to sit for a while, then go back in.</div>
    <div class="sub mt-1">${here.length ? `Sitting here now (${here.length}): ${here.map((d) => `<button class="pill" data-bw="${esc(d.id)}">${esc(nameOf(d))}</button>`).join(" ")}` : "Nobody sitting here right now. Workers on a break come and sit here now and then."}</div>
    <div class="sub mt-1">Sitting here is just a break. The two lines that mean something are elsewhere: workers waiting on you stand in line at your CEO tower door, and workers who are blocked or over their budget cap wait at their building's coffee cart. The pond is only a pond; the budget fountain is the one on the ${campus?.plan === "quad" ? "quad" : "plaza"}.</div>
    ${r ? "" : '<div class="sub mt-1">It is on the campus view, by the work wings.</div>'}`);
  p.querySelectorAll("[data-bw]").forEach((b) => (b.onclick = () => { const d = deskById(b.dataset.bw); if (d) workerPanel(d); }));
}
// The shared part, in words, at the top of the community garden's panel.
function sharedWordsHtml() {
  const r = gardenRoomById("garden-shared");
  if (!r) return "";
  const here = sharedSittersNow(r), crops = sharedCrops();
  return `<h3 class="mt-3 font-semibold text-sm">Shared by everyone</h3>
    <div class="sub">${campus?.plan === "quad" ? "Across the covered walk from the plots" : "Beside the plots"}: a lawn, two benches (one under a pergola with string lights that come on after dark), a shared vegetable patch, a water tap with a watering can, a flower bed, a tree and a lamp. It belongs to every resident (it is part of what everyone in the Residences gets) and holds nobody's own things.</div>
    <div class="sub mt-1">${here.length ? `Out here now (${here.length}): ${here.map((s) => `<button class="pill" data-gw="${esc(s.d.id)}">${esc(nameOf(s.d))}</button> ${s.seat[3] === "patch" ? "tending the patch" : "on a bench"}`).join(", ")}` : "Nobody out here right now. Residents who are home come out in the evening (6 to 11 pm) to sit or tend the patch."}</div>
    <div class="sub mt-1">The vegetable patch shows ${crops} crop${crops === 1 ? "" : "s"} grown: one for each job finished on the campus in the last 7 days, up to 8. It is just for looks.</div>
    <h3 class="mt-3 font-semibold text-sm">The plots</h3>`;
}

// ---------- the campus store ----------
// A little shop with a striped awning and a window display; shoppers (workers who just bought something) queue at
// the door. Tap it for the price list, what's been bought lately and who spends the most.
const recentBuys = () => Object.entries(data?.wallets || {}).flatMap(([id, w]) => (w.recent || []).map((r) => ({ id, ...r }))).sort((a, b) => b.at.localeCompare(a.at));
function drawStore(r, t) {
  const { x, y, w, d, h } = r, hov = hover === r.id, sel = openRoom === r.id;
  poly([toScreen(x - 0.4, y - 0.4), toScreen(x + w + 0.4, y - 0.4), toScreen(x + w + 0.4, y + d + 0.6), toScreen(x - 0.4, y + d + 0.6)], dn("rgba(70,100,55,0.22)", "rgba(0,0,0,0.2)"), sel ? "#f3d9a4" : null);
  box(x, y, w, d, h, hov ? dn("#fff6e8", "#f6e7d0") : dn("#fbeedb", "#efdcc0"), dn("#ecd0aa", "#d9b98f"), dn("#dcbc94", "#c7a67c"));
  // window display: what's for sale, lit warm
  const lit = 0.75 + 0.25 * Math.sin(t / 900);
  poly([toScreen(x + 0.3, y + d, 0.25), toScreen(x + w - 0.3, y + d, 0.25), toScreen(x + w - 0.3, y + d, h - 0.35), toScreen(x + 0.3, y + d, h - 0.35)], `rgba(255,214,140,${lit})`, "#8a6a48");
  const items = ["#5fbf6a", "#ffd166", "#ffe28a", "#f4ecdc"];
  items.forEach((c, i) => { const ix = x + 0.55 + i * ((w - 1.1) / 3); box(ix - 0.1, y + d - 0.12, 0.2, 0.1, 0.22, c, c, c, 0.3); });
  // striped awning over the door side
  for (let i = 0; i < 8; i++) { const ax = x + (i * w) / 8; poly([toScreen(ax, y + d, h), toScreen(ax + w / 8, y + d, h), toScreen(ax + w / 8, y + d + 0.45, h - 0.3), toScreen(ax, y + d + 0.45, h - 0.3)], i % 2 ? "#f2ead8" : "#e05d8a"); }
  // door
  poly([toScreen(x + w - 0.75, y + d, 0), toScreen(x + w - 0.4, y + d, 0), toScreen(x + w - 0.4, y + d, 0.75), toScreen(x + w - 0.75, y + d, 0.75)], "#6d523a");
}
let martCat = "all", martQ = "", martSources = null, martAddOpen = false;
const MART_CATS = [["all", "All"], ["desk", "🖥️ Desk"], ["home", "🏠 Home"], ["yard", "🌳 Yard"], ["wear", "🎩 Wear"], ["pets", "🐾 Pets"], ["treats", "☕ Treats"], ["fun", "🕹️ Fun"], ["outings", "🎟️ Outings"]];
function storePanel() {
  if (!martSources) { martSources = []; fetch("/api/agents/store/sources").then((r) => (r.ok ? r.json() : [])).then((s) => { martSources = Array.isArray(s) ? s : []; if (martSources.length && document.getElementById("martQ")) storePanel(); }).catch(() => {}); }
  const nm = (id) => nameOf(data.desks.find((x) => x.id === id) || { id });
  const ws = Object.entries(data.wallets || {}), buys = recentBuys().slice(0, 8);
  const coming = ws.flatMap(([id, w]) => (w.coming || []).map((c) => ({ id, ...c })));
  const items = Object.entries(data.perks || {}).filter(([k, x]) => (martCat === "all" || x.cat === martCat) && (!martQ || `${x.label} ${x.cat} ${(x.likes || []).join(" ")}`.toLowerCase().includes(martQ.toLowerCase()))).sort((a, b) => a[1].cost - b[1].cost);
  const owners = (k) => ws.filter(([, w]) => w.owned.includes(k)).map(([id]) => nm(id)), wishers = (k) => ws.filter(([, w]) => (w.wish || []).includes(k)).map(([id]) => nm(id));
  const people = data.desks.filter((d) => d.status === "active").sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const p = showPanel("store", "Campus Mart", `
    <div class="sub mt-1">Everything a worker could want, bought with the credits they earn from real work (play money only). Each one keeps a wish list that fits their personality, saves up, and orders; the van brings it in ${15} minutes. You can send a gift too.</div>
    ${data.store ? `<div class="row" style="margin-top:8px"><b>Store budget</b>: ${usd(data.store.spent)} of ${usd(data.store.budget)} used this month${data.store.open ? "" : ' · <span style="color:#f0b45a">⚠ used up: Shorts, web time and outings are off the shelf until next month</span>'}
      <div class="sub">Only Shorts, web time, outings and growing personalities cost real money, and it comes from here, never from a worker's or project's budget.</div>
      ${Object.entries(data.store.items).map(([k, it]) => `<div class="sub">${esc(it.label.replace(/^an? /, ""))}: ${it.buys} ${k === "life" ? "updates" : "bought"}, ${usd(it.usd)}${it.buys ? ` (${usd(it.each)} each)` : ""}</div>`).join("")}<div class="sub">Everything else: play money, $0.</div></div>` : ""}
    <input id="martQ" class="mt-3" placeholder="Search the Mart (koi, hat, cozy…)" value="${esc(martQ)}" style="width:100%;padding:7px 10px;border-radius:10px;border:1px solid rgba(127,127,127,0.35);background:transparent;color:inherit" />
    <div class="flex flex-wrap gap-1 mt-2">${MART_CATS.map(([k, l]) => `<button class="pill" data-cat="${k}" style="${martCat === k ? "background:#f3d9a4;color:#1b1f27" : ""}">${l}</button>`).join("")}</div>
    <div class="mt-3" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">
    ${items.map(([k, x]) => { const o = owners(k), wi = wishers(k); return `<div class="row" style="margin:0;border:1px solid rgba(127,127,127,0.25);border-radius:12px;padding:8px">
      <div style="font-size:26px;line-height:1.1">${esc(x.icon || { espresso: "☕", taco: "🌮", slide: "🛝", nap: "😴", plant: "🌿", lamp: "💡", chair: "🪑", trophy: "🏆", rug: "🟥", gnome: "🧙", bookshelf: "📚", couch: "🛋️", fence: "🚧", bbq: "🍖", tv: "📺", bed: "🛏️", arcade: "🕹️", hottub: "♨️" }[k] || "🎁")}</div>
      <b style="font-size:13px">${esc(x.label.replace(/^an? /, ""))}</b>${x.custom && x.by !== OWNER_ID() ? `<div class="sub" style="color:#f3d9a4">💡 ${esc(nm(x.by))}'s idea</div>` : ""}${typeof window.campusItemLook === "function" && window.campusItemLook(k) === "stand" ? `<div class="sub" title="Shown on the campus as a stand-in with its emoji until it gets its own 3D model (tools/campus-assets/item-model.mjs)">📦 stand-in look for now</div>` : ""}<div class="sub">${x.cost} credits${x.hours ? ` · ${x.hours} h` : ""}${x.friday ? " · Fridays" : ""}</div>${x.experience ? `<div class="sub">From ${esc((martSources || []).find((s) => s.id === x.experience.source)?.host || x.experience.source)} · one a day each</div>` : ""}${x.custom && x.by === OWNER_ID() ? '<div class="sub">⭐ your pick</div>' : ""}
      ${o.length ? `<div class="sub">Has it: ${esc(o.slice(0, 3).join(", "))}${o.length > 3 ? "…" : ""}</div>` : ""}${wi.length ? `<div class="sub">💭 Wanted by ${esc(wi.slice(0, 3).join(", "))}${wi.length > 3 ? "…" : ""}</div>` : ""}
      ${k === "surf" ? `<select class="pill mt-1" data-gift="surf" style="max-width:100%"><option value="">🌐 Treat someone…</option>${people.map((d) => `<option value="${esc(d.id)}">${esc(nameOf(d))}</option>`).join("")}</select>` : ""}
      ${k === "short" ? `<select class="pill mt-1" data-short="1" style="max-width:100%"><option value="">📺 Treat someone…</option>${people.map((d) => `<option value="${esc(d.id)}">${esc(nameOf(d))}</option>`).join("")}</select>` : ""}
      ${k !== "short" && k !== "surf" && (!x.friday || new Date().getDay() === 5) ? `<select class="pill mt-1" data-gift="${k}" style="max-width:100%"><option value="">🎁 Gift to…</option>${people.filter((d) => !(data.wallets?.[d.id]?.owned || []).includes(k)).map((d) => `<option value="${esc(d.id)}">${esc(nameOf(d))}${(data.wallets?.[d.id]?.wish || []).includes(k) ? " 💭" : ""}</option>`).join("")}</select>` : ""}</div>`; }).join("") || '<div class="sub">Nothing matches. Try another word.</div>'}</div>
    ${(() => { const ideas = (data.requests || []).filter((q) => q.kind === "store" && !q.decision); return `<h3 class="mt-4 font-semibold text-sm">💡 Workers' ideas for the Mart</h3>
      <div class="sub">Now and then a worker suggests something new; HR checks it and sets a fair price, then you say yes or no (it's in Waiting for you). A new item shows on the campus straight away as a stand-in with its emoji (a gift box on the desk, a plinth at home, a sign post in the yard); it gets its own 3D model when someone runs tools/campus-assets/item-model.mjs for it (about 30 generation credits).</div>
      ${ideas.map((q) => `<div class="row"><b>${esc(q.hr?.item ? `${q.hr.item.icon} ${q.hr.item.label}` : `${q.item?.icon || ""} ${q.item?.label || q.role}`)}</b> <span class="sub">from ${esc(nm(q.from))} · ${q.hr ? `HR: ${esc(q.hr.verdict)}${q.hr.item ? `, ${q.hr.item.cost} credits` : ""}` : "HR hasn't checked it yet"}</span>${q.why ? `<div class="sub">"${esc(q.why)}"</div>` : ""}${q.hr?.note ? `<div class="sub">HR: ${esc(q.hr.note)}</div>` : ""}
        ${q.hr ? `<div class="flex gap-1 mt-1"><button class="pill" data-store-ok="${esc(q.id)}">✓ Stock it</button><button class="pill" data-store-no="${esc(q.id)}">✕ No</button></div>` : ""}</div>`).join("")}
      <select class="pill mt-1" id="pStoreAsk" style="max-width:100%"><option value="">💡 Ask someone for an idea…</option>${people.map((d) => `<option value="${esc(d.id)}">${esc(nameOf(d))}</option>`).join("")}</select>`; })()}
    ${coming.length ? `<h3 class="mt-4 font-semibold text-sm">🚚 On the van</h3>${coming.map((c) => `<div class="row sub"><b style="color:inherit">${esc(nm(c.id))}</b>: ${esc(c.label)}${c.gift ? " (your gift)" : ""} · arrives ${esc(new Date(c.deliverAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</div>`).join("")}` : ""}
    ${(data.watched || []).length ? `<h3 class="mt-4 font-semibold text-sm">📺 Watched lately</h3>${(data.watched || []).slice(0, 4).map(watchLine).join("")}<button class="pill mt-1" id="pWatchLog">Snoop on the whole watch log</button>` : ""}
    ${(data.surfed || []).length ? `<h3 class="mt-4 font-semibold text-sm">🌐 On the web lately</h3>${(data.surfed || []).slice(0, 4).map(surfLine).join("")}<button class="pill mt-1" id="pSurfLog">Snoop on the whole web log</button>` : ""}
    ${(data.store?.lately || []).some((e) => e.ok) ? `<h3 class="mt-4 font-semibold text-sm">🎟️ Outings lately</h3>${data.store.lately.filter((e) => e.ok).slice(0, 5).map((e) => `<div class="row">${outingLine(e, nm(e.desk))}</div>`).join("")}` : ""}
    <h3 class="mt-4 font-semibold text-sm">➕ Add something to the Mart</h3>
    ${martAddOpen ? `<div class="row" style="display:grid;gap:6px">
      <div class="sub">Furniture, pets and other lasting things are play money: no password. An outing (an experience from the public sources below) costs a little real money from the store's budget, so it asks for your password.</div>
      <input id="pAddLabel" placeholder="Name, e.g. a paper lantern" maxlength="60" style="padding:7px 10px;border-radius:10px;border:1px solid rgba(127,127,127,0.35);background:transparent;color:inherit" />
      <div style="display:grid;grid-template-columns:70px 1fr 80px;gap:6px">
        <input id="pAddIcon" placeholder="🎁" maxlength="8" aria-label="Icon (one emoji)" style="padding:7px;border-radius:10px;border:1px solid rgba(127,127,127,0.35);background:transparent;color:inherit;text-align:center" />
        <select id="pAddCat" class="pill" aria-label="Category">${MART_CATS.filter(([k]) => !["all", "treats", "fun"].includes(k)).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
        <input id="pAddCost" type="number" min="1" max="80" value="10" aria-label="Cost in credits" style="padding:7px;border-radius:10px;border:1px solid rgba(127,127,127,0.35);background:transparent;color:inherit" />
      </div>
      <div id="pAddOuting" style="display:none;gap:6px">
        <select id="pAddSource" class="pill" aria-label="Source">${(martSources || []).map((s) => `<option value="${esc(s.id)}">${esc(s.name)} (${esc(s.host)})</option>`).join("") || '<option value="">Loading sources…</option>'}</select>
        <input id="pAddPrompt" placeholder="The scene, e.g. You spent the evening at the observatory." maxlength="200" style="padding:7px 10px;border-radius:10px;border:1px solid rgba(127,127,127,0.35);background:transparent;color:inherit" />
      </div>
      <div class="flex gap-1"><button class="pill" id="pAddGo">Add to the Mart</button><button class="pill" id="pAddCancel">Cancel</button></div></div>` : '<button class="pill" id="pAddOpen">➕ Add an item…</button>'}
    <h3 class="mt-4 font-semibold text-sm">Bought lately</h3>
    ${buys.length ? buys.map((b) => `<div class="row sub">${ago(b.at)} · <b style="color:inherit">${esc(nm(b.id))}</b> ${b.item === "refund" ? "got" : b.gift ? "got" : "bought"} ${esc(b.label)}${b.gift ? " 🎁" : ""}</div>`).join("") : '<div class="sub">Nothing yet. Payday comes with real work.</div>'}`);
  // the owner's own item: an outing takes the password (it can spend the store's budget), anything else doesn't
  const addOpen = document.getElementById("pAddOpen"); if (addOpen) addOpen.onclick = () => { martAddOpen = true; storePanel(); };
  const addCancel = document.getElementById("pAddCancel"); if (addCancel) addCancel.onclick = () => { martAddOpen = false; storePanel(); };
  const addCat = document.getElementById("pAddCat");
  if (addCat) addCat.onchange = () => { document.getElementById("pAddOuting").style.display = addCat.value === "outings" ? "grid" : "none"; };
  const addGo = document.getElementById("pAddGo");
  if (addGo) addGo.onclick = async () => {
    const body = { label: document.getElementById("pAddLabel").value.trim(), icon: document.getElementById("pAddIcon").value.trim(), cat: addCat.value, cost: Number(document.getElementById("pAddCost").value) || 10 };
    if (!body.label) return toast("Give it a name first.");
    if (body.cat === "outings") { body.source = document.getElementById("pAddSource").value; body.prompt = document.getElementById("pAddPrompt").value.trim(); if (!body.source) return toast("Pick a source."); }
    addGo.disabled = true;
    try { const r = await (body.cat === "outings" ? postPw("/agents/store/item", body) : api("/agents/store/item", body)); toast(`${r.icon} ${r.label} is on the shelves for ${r.cost} credits`, 6000); martAddOpen = false; await load(); storePanel(); }
    catch (err) { toast(err.message, 6000); addGo.disabled = false; }
  };
  // workers' Mart ideas: stock it or not (play money, so no password), and ask someone for one now
  p.querySelectorAll("[data-store-ok],[data-store-no]").forEach((b) => (b.onclick = async () => {
    const ok = !!b.dataset.storeOk, id = b.dataset.storeOk || b.dataset.storeNo; b.disabled = true;
    try { const r = await postPw(`/agents/request/${id}/decide`, { decision: ok ? "approved" : "declined" }); toast(ok ? (r.stocked?.label ? `${r.stocked.icon} ${r.stocked.label} is on the shelves for ${r.stocked.cost} credits` : "Stocked.") : "Not this time.", 6000); await load(); }
    catch (err) { toast(err.message, 6000); b.disabled = false; }
  }));
  const ask = document.getElementById("pStoreAsk");
  if (ask) ask.onchange = async () => { if (!ask.value) return; const who = nameOf(data.desks.find((d) => d.id === ask.value) || { id: ask.value }); toast(`${who} is thinking…`); try { const r = await postPw("/agents/store/suggest", { desk: ask.value }); toast(`${who} suggests: ${r.item?.icon || ""} ${r.item?.label || r.role}. HR checks it next.`, 7000); await load(); } catch (err) { toast(err.message, 6000); } };
  const wl = document.getElementById("pWatchLog"); if (wl) wl.onclick = () => watchPanel();
  const sl = document.getElementById("pSurfLog"); if (sl) sl.onclick = () => surfPanel();
  p.querySelectorAll("[data-short]").forEach((sel) => (sel.onchange = async () => { if (!sel.value) return; const who = nameOf(data.desks.find((d) => d.id === sel.value) || { id: sel.value }); toast(`${who} is picking a Short…`); try { const r = await postPw("/agents/short", { desk: sel.value }); toast(r.found ? `${who} watched "${r.title}"` : `${who} couldn't find a Short about ${r.topic}`, 6000); await load(); } catch (err) { toast(err.message, 6000); } }));
  const q = document.getElementById("martQ");
  q.oninput = () => { martQ = q.value; const at = q.selectionStart; storePanel(); const n = document.getElementById("martQ"); n.focus(); n.setSelectionRange(at, at); };
  p.querySelectorAll("[data-cat]").forEach((b) => (b.onclick = () => { martCat = b.dataset.cat; storePanel(); }));
  p.querySelectorAll("[data-gift]").forEach((sel) => (sel.onchange = async () => {
    if (!sel.value) return;
    try { await postPw("/agents/gift", { desk: sel.value, item: sel.dataset.gift }); toast(`🎁 ${data.perks[sel.dataset.gift].hours == null ? "On the van" : "Enjoying it now"}: ${data.perks[sel.dataset.gift].label} for ${nameOf(deskById(sel.value) || { id: sel.value })}`); await load(); storePanel(); }
    catch (err) { toast(err.message, 6000); sel.value = ""; }
  }));
}

// This week: each project's budget and plan, and whether its work starts by itself after the board meeting.
function weekHtml() {
  const w = data.week;
  if (!w?.rooms?.length) return "";
  const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}` : `${min} min`);
  return `<h3 class="mt-4 font-semibold text-sm">This week (from ${esc(w.weekOf)})</h3>
    <div class="sub">After each board meeting, every project with budget starts work by itself: at least an hour for a Claude Code lead, a job for a hub-run lead.</div>
    ${w.rooms.map((x) => `<div class="row"><b>${esc(x.name)}</b> <span class="sub">${esc(nameOf(data.desks.find((d) => d.id === x.lead) || { id: x.lead }))}${x.standsInFor ? " (standing in for the lead)" : ""}</span>
      <div class="sub">${x.kind === "session" ? `${hm(x.leftMin)} of ${x.hours} h left` : ""}${x.kind === "session" && x.usd ? " · " : ""}${x.usd ? `team has ${usd(x.usd)} this week` : ""}</div>
      ${x.plan ? `<div class="sub">Plan: ${esc(x.plan.text)}</div>` : x.skip ? "" : '<div class="sub">No plan yet: it writes one in its first session of the week.</div>'}
      ${x.skip ? `<div class="sub" style="color:#f0b45a">Not starting: ${esc(x.skip)}</div>` : ""}${x.error ? `<div class="sub" style="color:#f0b45a">Last start failed: ${esc(x.error)}</div>` : ""}
      <button class="pill" data-weekroom="${esc(x.room)}" data-on="${x.on ? "0" : "1"}" style="font-size:12px;margin-top:4px">${x.on ? "Stop it starting by itself" : "Let it start by itself"}</button></div>`).join("")}
    <button class="pill" id="pWeekGo" style="margin-top:6px">Start today's work now</button>`;
}
function standupPanel() {
  const m = data.standup?.last, live = meetingLive();
  const p = showPanel("pavilion", "🗳 Board meeting", `
    <div class="sub mt-1">In the CEO tower's board room, ${esc((data.standup?.days || []).join(", "))} at ${esc((data.standup?.times || []).join(" and "))}. ${hasPet() ? `${esc(PET())} chairs` : "You chair"}; every project lead reports from real data, and the board covers what it decided, its hiring budget and what's waiting on you. ${live ? "<b>In session now.</b>" : `Next: ${esc(new Date(data.standup?.next || Date.now()).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }))}.`}</div>
    <button class="pill" id="pHold" style="margin-top:8px">Hold one now</button>
    ${m && m.projects.some((x) => x.lead) ? `<h3 class="mt-4 font-semibold text-sm">Give every lead a job</h3>
    <div class="sub">One job to the leads at the last board meeting. Untick anyone it doesn't fit.</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${["Review and update your project's documentation (status, open items, how to run it).", "Check your open PRs, jobs and hand-offs; close or pass on anything stale.", `Write a short status note for ${OWN()}: done this week, next, blocked.`].map((t, i) => `<button class="pill" data-sug="${i}" style="font-size:12px">${esc(t.split(" (")[0].split(";")[0].split(":")[0])}</button>`).join("")}</div>
    <textarea id="pAllJob" rows="3" placeholder="What should every lead do?" style="width:100%;margin-top:6px;background:rgba(255,255,255,0.06);color:inherit;border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:6px"></textarea>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px">${m.projects.filter((x) => x.lead).map((x) => `<label class="sub" style="display:flex;gap:4px;align-items:center"><input type="checkbox" data-lead-room="${esc(x.room)}" checked> ${esc(x.name)}</label>`).join("")}</div>
    <button class="pill" id="pAllGo" style="margin-top:6px">Give it to them</button>` : ""}
    ${weekHtml()}
    ${m?.shortOfWeek ? `<div class="row">🏆 <b>Short of the week</b>, crowned at this board meeting: <a href="${esc(safeUrl(m.shortOfWeek.url))}" target="_blank" rel="noopener" style="text-decoration:underline">${esc(m.shortOfWeek.title)}</a> <span class="sub">found by ${esc(nameOf(data.desks.find((x) => x.id === m.shortOfWeek.desk) || { id: m.shortOfWeek.desk }))}, ${"★".repeat(m.shortOfWeek.stars || 3)}, shared ${m.shortOfWeek.shares}×</span></div>` : sowCard()}
    ${m?.board ? `<div class="row">🗳 <b>Board</b>: ${m.board.decided.length ? `decided ${m.board.decided.length} (${esc(m.board.decided.slice(0, 4).join("; "))}${m.board.decided.length > 4 ? "…" : ""})` : "nothing decided on its own"} · hiring budget $${m.board.budget.spent} of $${m.board.budget.limit} · ${m.board.waitingOnOwner ?? m.board[`waitingOn${OWN()}`] ?? 0} waiting on you</div>` : ""}
    <h3 class="mt-4 font-semibold text-sm">${m ? `Last meeting: ${esc(m.day)} ${esc(m.slot)} (${esc(new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))})` : "No board meeting yet"}</h3>
    ${m ? m.projects.map((x) => `<div class="row"><b>${esc(x.name)}</b> <span class="sub">${x.lead ? `lead ${esc(x.lead)}` : "no lead"}</span>
      <div class="sub">${x.reports} reports · ${x.sessions} sessions · ${x.jobsDone} jobs done · ${x.jobsOpen} open · ${x.waiting} waiting on you · ${usd(x.api)} API · ${usd(x.sub)} sub</div>
      ${x.latest ? `<div class="sub">Latest: ${esc(x.latest)}</div>` : ""}${x.blocked?.length ? `<div class="sub" style="color:#f0b45a">Blocked: ${esc(x.blocked.join(", "))}</div>` : ""}</div>`).join("") : '<div class="sub">The first one is at the next slot, or press Hold one now.</div>'}`);
  const SUG = ["Review and update your project's documentation (status, open items, how to run it).", "Check your open PRs, jobs and hand-offs; close or pass on anything stale.", `Write a short status note for ${OWN()}: done this week, next, blocked.`];
  p.querySelectorAll("[data-sug]").forEach((b) => (b.onclick = () => { document.getElementById("pAllJob").value = SUG[Number(b.dataset.sug)]; }));
  const go = document.getElementById("pAllGo");
  if (go) go.onclick = async () => {
    const text = document.getElementById("pAllJob").value.trim();
    if (!text) return toast("Say what every lead should do first.");
    const rooms = [...p.querySelectorAll("[data-lead-room]")].filter((c) => c.checked).map((c) => c.dataset.leadRoom);
    if (!rooms.length) return toast("Tick at least one lead.");
    go.disabled = true;
    try {
      const r = await postPw("/agents/standup/assign", { text, rooms });
      toast(`Given to ${r.given.length} lead${r.given.length === 1 ? "" : "s"}${r.failed.length ? `; ${r.failed.length} failed: ${r.failed.map((f) => f.desk).join(", ")}` : ""}`, 7000);
      await load();
    } catch (err) { if (!err.cancelled) toast(err.message, 7000); go.disabled = false; }
  };
  p.querySelectorAll("[data-weekroom]").forEach((b) => (b.onclick = async () => { try { await postPw("/agents/week/room", { id: b.dataset.weekroom, on: b.dataset.on === "1" }); await load(); standupPanel(); } catch (err) { toast(err.message, 6000); } }));
  const wg = document.getElementById("pWeekGo");
  if (wg) wg.onclick = async () => { wg.disabled = true; try { const r = await postPw("/agents/week/start", {}); toast(r.started.length ? `Starting: ${r.started.join(", ")}${r.skipped.length ? `. Not starting: ${r.skipped.map((k) => `${k.room} (${k.why})`).join(", ")}` : ""}` : `Nothing to start${r.skipped.length ? `: ${r.skipped.map((k) => `${k.room} (${k.why})`).join(", ")}` : "."}`, 9000); await load(); standupPanel(); } catch (err) { wg.disabled = false; toast(err.message, 6000); } };
  document.getElementById("pHold").onclick = async () => { try { await api("/agents/standup", {}); toast("Board meeting held: the leads are heading to the CEO tower"); await load(); } catch (err) { toast(err.message, 6000); } };
}

// Signs never sit on top of each other: each one (with its battery) takes the first free slot just below its
// door, nudged down or up a row when another sign is already there, with a thin line back to its door.
let signRects = [];
function signSlot(cx, y, w) {
  for (const dy of [0, 24, -24, 48, -48, 72]) {
    const rect = [cx - w / 2 - 4, y + dy - 22, cx + w / 2 + 4, y + dy + 2];
    if (!signRects.some((o) => rect[0] < o[2] && rect[2] > o[0] && rect[1] < o[3] && rect[3] > o[1])) { signRects.push(rect); return dy; }
  }
  return 0;
}
function signWidth(text, busy, mark) {
  ctx.font = `600 ${Math.max(11, 13 * cam.z)}px system-ui`;
  return ctx.measureText(text).width + 16 + (busy ? 12 : 0) + (mark ? 14 : 0);
}
function drawSign(r) {
  if (r.isHouse || r.isUnderground) return; // the Underground draws its own label
  if (r.isHomes && homeOf(openRoom)?.tower === r.id) return; // a flat is open in this tower's place: it has its own name
  if (r.tower && !view && r.tower.k !== 0) return; // a district tower gets one sign
  const [nx, ny] = r.tower && !view ? toScreen(r.tower.x + r.tower.w / 2, r.tower.y + r.tower.d + 0.15, 0) : toScreen(r.x + r.w / 2, r.y + r.d + 0.15, 0);
  // Standing rule: is this project linked to the hub? A green tick or amber "!" inside the sign, so it adds no clutter.
  const mark = !r.isHr && !r.isControl && r.link ? (r.link.linked ? { char: "\u2713", color: "#7ddc8a" } : { char: "!", color: "#f0b45a" }) : null;
  const text = r.tower && !view ? `${r.tower.name} · ${r.tower.members.length} projects` : r.isControl ? "CEO tower (yours)" : r.isStore ? "Campus Mart" : r.name + (typeof ctlWaitRooms !== "undefined" && ctlWaitRooms.has(r.id) ? " 🚨" : ""), busy = r.isControl ? inbox.length > 0 : r.busy;
  const hasBattery = !r.isControl && !r.isLeisure && !r.isStore && !r.isHomes && !r.isGarden && !r.resFloor;
  const w = signWidth(text, busy, mark), total = w + (hasBattery ? 96 : 0);
  const dy = signSlot(nx + (hasBattery ? 48 : 0), ny + 26, total);
  if (dy) { ctx.strokeStyle = "rgba(233,228,216,0.35)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(nx, ny + 4); ctx.lineTo(nx, ny + 26 + dy - 20); ctx.stroke(); }
  const signW = label(nx, ny + 26 + dy, text, busy, r.isControl ? false : r.fresh, true, mark);
  if (hasBattery) battery(nx + signW / 2 + 48, ny + 25 + dy, r);
}

function drawDesk(b, t) {
  const { x, y } = b.desk;
  box(x - 0.4, y - 0.35, 0.9, 0.55, 0.42, "#8b6a4a", "#6d523a", "#5e4632");
  // monitor: glows when this desk is active
  const glow = b.active ? `rgba(140,220,255,${0.75 + 0.25 * Math.sin(t / 180)})` : "#2c3440";
  box(x - 0.15, y - 0.32, 0.4, 0.08, 0.32, glow, "#1d232c", "#161b22", 0.42);
  // a sticky note for every open job the owner gave this desk (up to 3)
  const n = Math.min(3, (jobsByDesk[b.d.id] || []).length);
  for (let i = 0; i < n; i++) box(x + 0.2 + i * 0.07, y - 0.1 + i * 0.05, 0.22, 0.2, 0.02, i % 2 ? "#ffe680" : "#ffd84d", "#d9b830", "#c9a826", 0.42 + i * 0.02);
  // what they've bought with their campus credits
  const own = shownOwned(b.d.id);
  if (own.includes("chair")) box(x - 0.05, y + 0.32, 0.32, 0.3, 0.38, "#ffd166", "#e0b040", "#c99a30");
  own.filter((o) => o === "plant").forEach((_, i) => { box(x - 0.38 + i * 0.13, y - 0.3, 0.1, 0.1, 0.1, "#c06a3c", "#a5582f", "#8f4b28", 0.42); box(x - 0.39 + i * 0.13, y - 0.31, 0.12, 0.12, 0.12, "#5fbf6a", "#4aa055", "#3f8a49", 0.52); });
  if (own.includes("lamp")) { box(x + 0.32, y - 0.3, 0.05, 0.05, 0.28, "#cfc6b4", "#a9a090", "#948b7c", 0.42); box(x + 0.27, y - 0.33, 0.14, 0.1, 0.05, "#ffe28a", "#e8c860", "#d4b450", 0.7); }
  if (own.includes("trophy")) { box(x + 0.05, y - 0.05, 0.1, 0.1, 0.05, "#a07a30", "#8a6826", "#755820", 0.42); box(x + 0.06, y - 0.04, 0.08, 0.08, 0.14, "#ffd166", "#e8b84a", "#d4a43c", 0.47); }
  if (own.includes("espresso")) box(x + 0.32, y + 0.02, 0.07, 0.07, 0.07, "#f4ecdc", "#d8cfbe", "#c4bba9", 0.42);
  // Campus Mart things kept at work (belongings.js "desk": desk things, plus home things and pets of anyone with no flat), in a row along the back of the desk
  ownAt(b.d.id, "desk").filter((k) => data.perks?.[k]?.icon).forEach((k, i) => { const [ix, iy] = toScreen(x - 0.2 + (i % 5) * 0.16, y - 0.2 - Math.floor(i / 5) * 0.14, 0.55); emoji(ix, iy, 9 * cam.z, data.perks[k].icon); });
}

function drawBot(b, t) {
  if (b.riding) return;
  // not here right now: home for the evening or at the stand-up (their desk stays empty)
  if (view && ["home", "meeting", "queue", "coffee"].includes(whereIs(b.d))) return;
  const color = PROVIDER[b.d.provider] || PROVIDER.other;
  const typing = b.active && Math.hypot(b.x - b.desk.x, b.y - b.desk.y) < 0.2;
  const bob = typing ? Math.abs(Math.sin(t / 120)) * 2.5 : b.d.status === "paused" ? 0 : Math.abs(Math.sin(t / 260 + b.desk.x)) * 1.2;
  ctx.save(); if (b.d.status === "planned") ctx.globalAlpha = 0.4;
  const [px, py] = toScreen(b.x, b.y + 0.55, 0);
  const s = cam.z * 1.45;
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.ellipse(px, py, 9 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill();
  // body
  ctx.fillStyle = b.d.status === "paused" ? "#666" : color;
  roundRect(px - 7 * s, py - (22 + bob) * s, 14 * s, 16 * s, 4 * s); ctx.fill();
  if (s >= 1.05 && b.d.status !== "paused") shirt(px, py - (22 + bob) * s, s, b.d);
  // head
  ctx.fillStyle = "#f4ecdc"; roundRect(px - 8 * s, py - (36 + bob) * s, 16 * s, 13 * s, 5 * s); ctx.fill();
  // eyes (blink now and then)
  const blink = (t / 1000 + b.desk.x * 3) % 4 < 0.12;
  ctx.fillStyle = "#1b1f27";
  if (blink) { ctx.fillRect(px - 5 * s, py - (30 + bob) * s, 3.5 * s, 1 * s); ctx.fillRect(px + 1.5 * s, py - (30 + bob) * s, 3.5 * s, 1 * s); }
  else { ctx.fillRect(px - 4.5 * s, py - (31.5 + bob) * s, 2.5 * s, 3 * s); ctx.fillRect(px + 2 * s, py - (31.5 + bob) * s, 2.5 * s, 3 * s); }
  // antenna light: lead = gold, otherwise provider colour
  ctx.strokeStyle = "#cfc6b4"; ctx.lineWidth = 1.2 * s; ctx.beginPath(); ctx.moveTo(px, py - (36 + bob) * s); ctx.lineTo(px, py - (41 + bob) * s); ctx.stroke();
  ctx.fillStyle = b.d.lead ? "#ffd166" : color; ctx.beginPath(); ctx.arc(px, py - (42 + bob) * s, 2.2 * s, 0, Math.PI * 2); ctx.fill();
  const hat = wearIcon(b.d.id); if (hat) emoji(px, py - (34 + bob) * s, 12 * s, hat);
  if (b.d.stray) { ctx.fillStyle = "#ffd166"; ctx.font = `bold ${10 * s}px system-ui`; ctx.textAlign = "center"; ctx.fillText("?", px + 11 * s, py - (34 + bob) * s); }
  // speech bubble with the last thing it did, while active (and for the hovered/open room)
  const flow = b.active && cam.z > 0.55 ? flowOf(b.room, b.d.id) : [];
  if (flow.length > 1) flowStrip(px, py - (48 + bob) * s, flow, t);
  else if (b.last && (typing || openRoom === b.room.id) && cam.z > 0.55) bubble(px, py - (48 + bob) * s, b.last);
  else if (b.thought && performance.now() >= (b.thought.from || 0) && cam.z > 0.35) thoughtBubble(px, py - (48 + bob) * s, b.thought.text, b.thought.say);
  else { const r0 = data.wallets?.[b.d.id]?.recent?.[0]; if (r0 && Date.now() - Date.parse(r0.at) < 10 * 60000 && cam.z > 0.45) thoughtBubble(px, py - (48 + bob) * s, `💰 treated myself to ${r0.label}`, true); }
  ctx.restore();
  if (b.d.status === "paused") { ctx.fillStyle = "rgba(200,210,255,0.8)"; ctx.font = `bold ${9 * s}px system-ui`; ctx.textAlign = "left"; const zz = (t / 700) % 3; for (let i = 0; i < 3; i++) if (i <= zz) ctx.fillText("z", px + (8 + i * 4) * s, py - (38 + i * 6 + bob) * s); }
  if (cam.z > 0.6) namePlate(px, py + 2 * s, b.d, b.active);
  b.screen = [px, py - 20 * s, Math.max(16, 22 * s)]; b.drawnAt = performance.now(); // tap target (motion.js)
}

function bubble(x, y, f) {
  const text = [f.tool || f.action, f.summary].filter(Boolean).join(": ").slice(0, 34);
  if (!text) return;
  ctx.font = `${11}px system-ui`;
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = "rgba(250,246,236,0.95)"; roundRect(x - w / 2, y - 18, w, 18, 6); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 5); ctx.fill();
  ctx.fillStyle = "#26221c"; ctx.textAlign = "center"; ctx.fillText(text, x, y - 5.5);
}
// mark: optional { char, color } drawn inside the sign at its right end (the hub link tick or "!").
function label(x, y, text, busy, fresh, centred, mark) {
  ctx.font = `600 ${Math.max(11, 13 * cam.z)}px system-ui`;
  const w = ctx.measureText(text).width + 16 + (busy ? 12 : 0) + (mark ? 14 : 0);
  if (centred) x -= w / 2;
  ctx.fillStyle = "rgba(15,18,24,0.85)"; roundRect(x, y - 20, w, 20, 6); ctx.fill();
  if (fresh) { ctx.strokeStyle = "#ffd166"; ctx.lineWidth = 1.5; roundRect(x, y - 20, w, 20, 6); ctx.stroke(); }
  ctx.fillStyle = "#efe9dc"; ctx.textAlign = "left"; ctx.fillText(text, x + 8 + (busy ? 12 : 0), y - 6);
  if (busy) { ctx.fillStyle = "#7ddc8a"; ctx.beginPath(); ctx.arc(x + 11, y - 10, 3.5, 0, Math.PI * 2); ctx.fill(); }
  if (mark) { ctx.fillStyle = mark.color; ctx.font = "bold 12px system-ui"; ctx.textAlign = "center"; ctx.fillText(mark.char, x + w - 11, y - 6); }
  return w;
}
// Battery: API spend against the room's caps (green → amber → red). No caps: shows subscription use as a grey bar.
function battery(x, y, r) {
  const w = 34, h = 12;
  x -= w + 4;
  ctx.fillStyle = "rgba(15,18,24,0.85)"; roundRect(x - 2, y - h - 2, w + 8, h + 4, 3); ctx.fill();
  ctx.strokeStyle = "#cfc6b4"; ctx.lineWidth = 1; roundRect(x, y - h, w, h, 2); ctx.stroke();
  ctx.fillStyle = "#cfc6b4"; ctx.fillRect(x + w, y - h + 3, 3, h - 6);
  // With caps: charge left (full = nothing spent; amber, then red as the caps run out).
  // No caps: how much subscription use this month, as a blue level ($5 fills it).
  if (r.cap) {
    const used = Math.min(1, r.spend / r.cap);
    ctx.fillStyle = used > 0.9 ? "#e05d5d" : used > 0.6 ? "#f0b45a" : "#7ddc8a";
    ctx.fillRect(x + 2, y - h + 2, Math.max(1, (w - 4) * (1 - used)), h - 4);
  } else if (r.sub > 0) {
    ctx.fillStyle = "#6ea8ff";
    ctx.fillRect(x + 2, y - h + 2, Math.max(2, (w - 4) * Math.min(1, r.sub / 5)), h - 4);
  }
}
function badge(x, y, text, color) {
  ctx.font = "bold 12px system-ui"; const w = Math.max(18, ctx.measureText(text).width + 10);
  ctx.fillStyle = color; roundRect(x - w / 2, y - 9, w, 18, 9); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.fillText(text, x, y + 4);
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }

// ---------- the watch log (the owner 2026-11-09: "log what they watch and their reaction so I can snoop") ----------
const watchLine = (w) => { const d = data.desks.find((x) => x.id === w.desk); return `<div class="row"><b>${esc(d ? nameOf(d) : w.desk)}</b> <span class="sub">${esc(ago(w.at))} · picked "${esc(w.topic || "")}"</span>
  ${w.found ? `<div><a href="${esc(safeUrl(w.url))}" target="_blank" rel="noopener" style="text-decoration:underline">📺 ${esc(w.title)}</a> <span class="sub">${esc(w.channel || "")}</span></div>` : '<div class="sub">couldn\'t find one</div>'}
  <div class="sub">💬 "${esc(w.reaction || "")}"${w.stars ? ` · ${"★".repeat(w.stars)}${"☆".repeat(5 - w.stars)}` : ""}${w.sharedWith ? ` · 📱 sent it to ${esc(nameOf(data.desks.find((x) => x.id === w.sharedWith) || { id: w.sharedWith }))}` : ""}${w.found ? ` · ${({ watched: "👀 really watched it", "read the captions": "📖 read the captions", "looked at stills": "🖼️ looked at stills", "looked at stills and captions": "🖼️ stills and captions", title: "🏷️ title only" }[w.how || "title"] || w.how)}${w.model ? ` (${esc(w.model)})` : ""}` : ""}</div></div>`; };
// Short of the week (the owner 2026-11-09): the best-loved Short of the last 7 days, crowned at the stand-up.
function sowCard() {
  const s = data.shortOfWeek;
  if (!s) return "";
  const d = data.desks.find((x) => x.id === s.desk);
  return `<div class="row" style="border:1px solid rgba(243,217,164,0.4);border-radius:10px;padding:8px;margin-top:8px;background:rgba(243,217,164,0.06)"><div><b>🏆 Short of the week</b> <span class="sub">${s.of} in the running</span></div>
    <div><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener" style="text-decoration:underline">📺 ${esc(s.title)}</a></div>
    <div class="sub">Found by ${esc(d ? nameOf(d) : s.desk)} · ${"★".repeat(s.stars || 3)} · texted to ${s.shares} coworker${s.shares === 1 ? "" : "s"}${s.watchers.length > 1 ? ` · watched by ${s.watchers.length}` : ""}</div>
    <div class="sub">💬 "${esc(s.reaction || "")}"</div></div>`;
}
// Web time (the owner 2026-11-11, "do we have snooping on web searches like the Shorts?"): the same as the watch log.
// Links in what they found open in a new tab.
function surfLine(w) {
  const link = (f) => esc(f).replace(/\((https?:\/\/[^\s)]+)\)$/, (m, u) => `(<a href="${u}" target="_blank" rel="noopener" style="text-decoration:underline">link</a>)`);
  const d = data.desks.find((x) => x.id === w.desk);
  return `<div class="row sub">${ago(w.at)} · <b style="color:inherit">${esc(d ? nameOf(d) : w.desk)}</b> ${w.ok ? `looked up <b style="color:inherit">${esc(w.topic || "something")}</b>` : "tried to surf, but it didn't work"} · ${usd(w.costUsd || 0)}${w.thought ? `<div>💬 "${esc(w.thought)}"</div>` : ""}${(w.found || []).map((f) => `<div>• ${link(f)}</div>`).join("")}</div>`;
}
function surfPanel() {
  const list = data.surfed || [];
  showPanel("surflog", "🌐 Web log", `
    <div class="sub mt-1">Every 5 minutes on the web a worker bought (or you treated them to): what they looked up, what they found, with links, and what they made of it. Read only: they can search and read pages, nothing else. The cost comes from the store's budget.</div>
    ${list.length ? list.map(surfLine).join("") : '<div class="row sub">Nobody has been on the web yet. It costs 6 credits at the Mart; you can treat anyone there too.</div>'}`);
}
function watchPanel() {
  const list = data.watched || [];
  showPanel("watchlog", "📺 Watch log", `
    <div class="sub mt-1">Every YouTube Short a worker bought with their credits (or you treated them to): the topic they picked, the real Short the hub found, and their reaction. How they take it in depends on their model: Gemini workers really watch it, Claude workers look at three stills from it (and read its captions if it has any), and anyone else goes by the title and channel. Each line says which.</div>
    ${sowCard()}
    ${list.length ? list.map(watchLine).join("") : '<div class="row sub">Nobody has watched one yet. A Short costs 3 credits at the Mart; you can treat anyone there too.</div>'}`);
}
