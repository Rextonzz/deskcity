// Residences: who lives where (the owner 2026-11-16, the Residences lane). Pure logic, no DOM. Works as a classic <script>
// (sets globalThis.campusHomes, loaded by campus/boot.js before city.js) and when imported by Node (the server keeps the
// homes in data/agents/homes.json with it; test/campus/homes.test.mjs tests it).
//
// Levels go by the credits a worker has earned in all (play money). Each level has a word (the owner is partly colourblind:
// a level is never shown by colour alone). The penthouse is a two-floor home and stays rare: 400+ earned AND in the top
// tenth of residents (at least one).
//
// Homes stay put: you keep your flat while your level is the same. When your level changes you move to a free flat of
// your new level, in your own tower first, then the next tower with room; when every tower is full a new tower opens.
// No tower passes MAX_FLOORS (nothing may stand taller than the CEO tower). Floors nobody lives on go.
(function () {
  const MAX_FLOORS = 7;
  // ---- sizes (the owner 2026-11-16: "It's bugging me, it's a bit small, I agree", about Comfy; the sizes lane, plan
  // docs/handoffs/residences-sizes-plan.md). The ONE table every size reads from. A bay (one unit of the building's
  // front: a whole tower in the streets layout, one of the long block's bays in the quad) is BAY_SLOTS slots wide on
  // every floor; a level's flat takes `slots` of them, so a floor of one bay holds BAY_SLOTS / slots flats of that
  // level (perFloor) and every flat sits inside one bay. Floors are all the same depth, so a flat's floor area is
  // slots x span (a penthouse has two storeys): Basic : Comfy : Nice : Penthouse = 6 : 10 : 15 : 30, i.e.
  // 1 : 1.67 : 2.5 : 5, against the real 1 : 1.6 : 2.3 : 5 (`ratio`: studio 40-45 m², one-bedroom 65-75, large condo
  // 95-105, penthouse ~230). Was 4 / 3 / 2 / 1 a floor (1 : 1.33 : 2 : 8): Comfy too small, the penthouse too big.
  // Basic keeps its floor area (never smaller): five Basics a bay instead of four, so the bay grew instead: a streets
  // tower is 5.5 tiles wide (was 4.4, depth 4.0 as before); the quad's long block keeps its 5.5-tile bays and is
  // deeper (5.5, was 4.4), so it gets no longer for the same bays (the quad's compact map holds).
  const BAY_SLOTS = 30;
  // tiles of front per bay outside (2D and 3D; a streets tower is one bay, the quad's block `wide` bays) and the depth
  const BAY_W = 5.5, DEPTH = { tower: 4.0, quad: 5.5 };
  // inside (the floors view, 2D and 3D): tiles across a Basic flat; any other flat is that times slots / 6. 3.2 (was
  // 2.6, which cut a Basic's kitchenette to 0.8 of its length and pushed the 3D one through the wall): the packing
  // test (test/campus/homes.test.mjs) checks every level's FIXTURES fit their room at this width.
  const ROOM_W = 3.2;
  // the fixed things' footprints in the 2D drawing (city.js resRoom2D), in tiles at the floors view's scale: the
  // bathroom (w x d, a corner by the front door), the wardrobe's depth along the side wall, the bed (w x d), the
  // kitchen's length along the corridor wall, the table's width and its seats
  const FIXTURES = [
    { bath: [0.95, 0.95], wardrobe: 0.55, bed: [0.55, 0.95], kitchen: 1.1, table: 0.45, seats: 2 },
    { bath: [0.95, 0.95], wardrobe: 0.7, bed: [0.8, 1.05], kitchen: 1.4, table: 0.5, seats: 2 },
    { bath: [1.25, 1.2], wardrobe: 0.9, bed: [0.85, 1.1], kitchen: 1.8, table: 0.8, seats: 4 },
    { bath: [1.25, 1.2], wardrobe: 0.9, bed: [0.95, 1.15], kitchen: 2.6, table: 1.2, seats: 6 },
  ];
  // the rules the stored homes were laid out by; a stored state from older rules is re-laid once (assign(), `replan`)
  const PLAN = "sizes-2026-11-16";
  const REPLAN_LINE = "The Residences were re-planned: homes are bigger; everyone keeps their level";
  const LEVELS = [
    { key: "basic", name: "Basic", min: 0, slots: 6, span: 1, ratio: 1, home: "a basic flat", plural: "basic flats" },
    { key: "comfy", name: "Comfy", min: 30, slots: 10, span: 1, ratio: 1.6, home: "a comfy flat", plural: "comfy flats" },
    { key: "nice", name: "Nice", min: 100, slots: 15, span: 1, ratio: 2.3, home: "a nice flat", plural: "nice flats" },
    { key: "penthouse", name: "Penthouse", min: 400, slots: 15, span: 2, ratio: 5, share: 0.1, home: "a two-floor penthouse", plural: "penthouses" },
  ];
  // perFloor (flats a floor of one bay): 5 / 3 / 2 / 2; area (against a Basic): 1 / 1.67 / 2.5 / 5
  for (const L of LEVELS) { L.perFloor = BAY_SLOTS / L.slots; L.area = (L.slots * L.span) / LEVELS[0].slots; }
  // a flat's width as a share of its bay, and inside (tiles across) at the floors view's scale
  const roomW = (level, base = ROOM_W) => (base * LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level | 0))].slots) / LEVELS[0].slots;
  const TOP = LEVELS.length - 1;
  const towerName = (i, n) => (n > 1 || i > 0 ? `Residences ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) + 1 : ""}` : "Residences");

  // id -> level index. residents: [{ id, earned }]
  function levelsFor(residents) {
    const out = {};
    for (const r of residents) { const e = Number(r.earned) || 0; let l = 0; for (let i = 0; i < TOP; i++) if (e >= LEVELS[i].min) l = i; out[r.id] = l; }
    const cap = Math.max(1, Math.floor(residents.length * LEVELS[TOP].share));
    residents.filter((r) => (Number(r.earned) || 0) >= LEVELS[TOP].min)
      .sort((a, b) => (Number(b.earned) || 0) - (Number(a.earned) || 0) || String(a.id).localeCompare(String(b.id)))
      .slice(0, cap).forEach((r) => (out[r.id] = TOP));
    return out;
  }
  const levelOf = (earned) => { let l = 0; for (let i = 0; i < TOP; i++) if ((Number(earned) || 0) >= LEVELS[i].min) l = i; return l; };

  const storeysOf = (t) => t.floors.reduce((a, f) => a + (LEVELS[f.level]?.span || 1), 0);
  // a tower's floors bottom to top: by level, then the order they were built
  const sortFloors = (t) => t.floors.sort((a, b) => a.level - b.level || a.seq - b.seq);

  // Where everyone lives: { towers, homes, moves, state }.
  //   residents: [{ id, earned, name? }]; prev: the last state (or null for a fresh start); opts.now: ISO time for moves.
  //   state (what to keep): { towers: [{ id, name, seq, floors: [{ seq, level, flats: [id|null] }] }], moved: { id: move } }
  //   moves: [{ id, from, to, why, level, was }] this time (from null = moved in for the first time)
  function assign(residents, prev, { now = new Date().toISOString(), max = MAX_FLOORS } = {}) {
    const lv = levelsFor(residents), byId = new Map(residents.map((r) => [r.id, r]));
    const state = { towers: [], moved: {}, ...(prev ? JSON.parse(JSON.stringify(prev)) : {}) };
    state.towers = (state.towers || []).filter((t) => t && Array.isArray(t.floors));
    state.moved = state.moved || {};
    // (the sizes lane, 2026-11-16) a state laid out by older size rules is re-laid once by these: everyone keeps their
    // level and their order along the building (tower by tower, floor by floor, flat by flat), packed into the new
    // floors; that is one "re-planned" note (`replan`), not a move each
    const replan = !!prev && state.plan !== PLAN && state.towers.some((t) => (t.floors || []).some((f) => (f.flats || []).some(Boolean)));
    const oldOrder = new Map();
    if (replan) [...state.towers].sort((a, b) => (a.seq || 0) - (b.seq || 0)).forEach((t) => [...t.floors].sort((a, b) => a.level - b.level || (a.seq || 0) - (b.seq || 0)).forEach((f) => (f.flats || []).forEach((id) => id && !oldOrder.has(id) && oldOrder.set(id, oldOrder.size))));
    state.plan = PLAN;
    for (const t of state.towers) { t.seq = t.seq || 0; for (const f of t.floors) { f.flats = (f.flats || []).slice(0, LEVELS[f.level]?.perFloor || 1); f.seq = f.seq || 0; } }
    // where everyone was, by the old numbering
    const addr = (st) => { const m = new Map(); st.towers.forEach((t) => { let s = 0; sortFloors(t).forEach((f) => { f.flats.forEach((id, k) => id && m.set(id, { tower: t.id, towerName: st.towers.length === 1 ? "Residences" : t.name, floorSeq: f.seq, storey: s + 1, span: LEVELS[f.level]?.span || 1, level: f.level, flat: k + 1 })); s += LEVELS[f.level]?.span || 1; }); }); return m; };
    const was = addr(state);
    if (replan) for (const t of state.towers) for (const f of t.floors) f.flats = []; // everyone is placed again below
    // out: anyone gone; anyone whose level changed (they move); anyone seen twice keeps the first flat
    const queue = [], seen = new Set();
    for (const t of state.towers) for (const f of t.floors) f.flats = f.flats.map((id) => {
      if (!id || !byId.has(id) || seen.has(id)) return null;
      seen.add(id);
      if (lv[id] !== f.level) { queue.push(id); return null; }
      return id;
    });
    for (const r of residents) if (!seen.has(r.id)) queue.push(r.id);
    // floors and towers nobody lives on go (a vacancy on a lived-in floor stays: "to let")
    for (const t of state.towers) t.floors = t.floors.filter((f) => f.flats.some(Boolean));
    state.towers = state.towers.filter((t) => t.floors.length);
    // enough towers for everyone, so a fresh start spreads the floors evenly instead of filling one tower first
    const need = LEVELS.map(() => 0); for (const id of byId.keys()) need[lv[id]]++;
    const free = LEVELS.map(() => 0); for (const t of state.towers) for (const f of t.floors) free[f.level] += f.flats.filter((x) => !x).length + (LEVELS[f.level].perFloor - f.flats.length);
    const placed = LEVELS.map(() => 0); for (const t of state.towers) for (const f of t.floors) placed[f.level] += f.flats.filter(Boolean).length;
    let storeys = 0; LEVELS.forEach((L, i) => { const left = Math.max(0, need[i] - placed[i] - free[i]); storeys += Math.ceil(left / L.perFloor) * L.span; });
    storeys += state.towers.reduce((a, t) => a + storeysOf(t), 0);
    const nextTowerId = () => { const ids = new Set(state.towers.map((t) => t.id)); if (!ids.has("homes")) return "homes"; let n = 2; while (ids.has(`homes-${n}`)) n++; return `homes-${n}`; };
    const nextName = () => { const names = new Set(state.towers.map((t) => t.name)); let i = 0; while (names.has(towerName(i, 2))) i++; return towerName(i, 2); };
    const newTower = () => { const t = { id: nextTowerId(), name: nextName(), seq: Math.max(0, ...state.towers.map((x) => x.seq)) + 1, floors: [] }; state.towers.push(t); return t; };
    while (state.towers.length < Math.ceil(storeys / max)) newTower();
    // place everyone moving: by level, lowest earners first (so a fresh start is the same every time)
    // (a re-plan: in the order they lived in, newcomers after)
    const oldAt = (id) => (oldOrder.has(id) ? oldOrder.get(id) : 1e9);
    queue.sort((a, b) => lv[a] - lv[b] || (replan ? oldAt(a) - oldAt(b) : 0) || (Number(byId.get(a).earned) || 0) - (Number(byId.get(b).earned) || 0) || String(a).localeCompare(String(b)));
    const moves = [];
    for (const id of queue) {
      const L = lv[id], from = was.get(id) || null, own = from && state.towers.find((t) => t.id === from.tower);
      const order = [...(own ? [own] : []), ...state.towers.filter((t) => t !== own)];
      let why = from ? (L === from.level ? "replan" : L > from.level ? "up" : "down") : "new";
      // a free flat of this level, own tower first
      let spot = null;
      for (const t of order) { for (const f of sortFloors(t)) if (f.level === L) { const hole = f.flats.indexOf(null), k = hole >= 0 ? hole : f.flats.length < LEVELS[L].perFloor ? f.flats.length : -1; if (k >= 0) { spot = { t, f, k }; break; } } if (spot) break; }
      if (!spot) {
        // a new floor: own tower if it has room, else the lowest tower with room, else a new tower
        const span = LEVELS[L].span, room = (t) => storeysOf(t) + span <= max;
        let t = own && room(own) ? own : state.towers.filter(room).sort((a, b) => storeysOf(a) - storeysOf(b) || a.seq - b.seq)[0];
        if (own && t !== own && why !== "replan") why = "full";
        if (!t) { t = newTower(); if (own && why !== "replan") why = "full"; }
        const f = { seq: Math.max(0, ...state.towers.flatMap((x) => x.floors.map((y) => y.seq))) + 1, level: L, flats: [] };
        t.floors.push(f); spot = { t, f, k: 0 };
      }
      spot.f.flats[spot.k] = id;
      moves.push({ id, fromAddr: from, toTower: spot.t.id, toFloorSeq: spot.f.seq, why, level: L, was: from ? from.level : null });
    }
    // name the towers in order, then everyone's address
    state.towers.sort((a, b) => a.seq - b.seq);
    state.towers.forEach((t) => sortFloors(t));
    const towers = [], homes = {}, one = state.towers.length === 1;
    state.towers.forEach((t, ti) => {
      let s = 0;
      const tname = one ? "Residences" : t.name; // one tower is just "Residences"
      const floors = t.floors.map((f) => {
        const span = LEVELS[f.level].span, first = s + 1, name = span > 1 ? `Floors ${first}-${first + span - 1}` : `Floor ${first}`;
        s += span;
        const fl = { seq: f.seq, level: f.level, levelKey: LEVELS[f.level].key, levelName: LEVELS[f.level].name, storey: first, span, name, flats: f.flats.slice(), perFloor: LEVELS[f.level].perFloor };
        f.flats.forEach((id, k) => { if (id) homes[id] = { tower: t.id, towerName: tname, towerIndex: ti, floorSeq: f.seq, storey: first, span, floorName: name, level: f.level, levelKey: LEVELS[f.level].key, levelName: LEVELS[f.level].name, flat: k + 1, flats: f.flats.length }; });
        return fl;
      });
      towers.push({ id: t.id, name: tname, storeys: s, floors });
    });
    const where = (h) => (h ? `${h.towerName}, ${h.span > 1 ? `Floors ${h.storey}-${h.storey + h.span - 1}` : `Floor ${h.storey}`}` : "");
    const out = moves.filter((m) => m.why !== "replan").map((m) => {
      const to = homes[m.id];
      const reason = m.why === "new" ? "moved in" : m.why === "full" ? `${LEVELS[m.level].name} now, and ${m.fromAddr.towerName} was full` : m.why === "up" ? `${LEVELS[m.level].name} now (was ${LEVELS[m.was].name})` : `${LEVELS[m.level].name} now (was ${LEVELS[m.was].name})`;
      return { id: m.id, from: m.fromAddr ? where(m.fromAddr) : null, to: where(to), level: LEVELS[m.level].name, was: m.was == null ? null : LEVELS[m.was].name, why: m.why, reason };
    });
    for (const m of out) if (m.from) state.moved[m.id] = { at: now, from: m.from, to: m.to, level: m.level, was: m.was, why: m.why, reason: m.reason };
    for (const id of Object.keys(state.moved)) if (!byId.has(id)) delete state.moved[id];
    // a re-plan: how many were re-laid, and how many of them now live at another address (tower, floor or flat)
    const re = moves.filter((m) => m.why === "replan");
    const rehoused = re.filter((m) => { const h = homes[m.id], f = m.fromAddr; return !h || h.tower !== f.tower || h.storey !== f.storey || h.flat !== f.flat; }).length;
    return { towers, homes, moves: out, state, replan: replan ? { n: re.length, rehoused, plan: PLAN, line: REPLAN_LINE } : null };
  }

  // One long block (the quad layout, the owner 2026-11-16: "apartments could be a longer building"): the same homes as
  // assign() gave, in ONE building whose floors hold `wide` times as many flats as a tower floor (one bay per `wide`
  // step: Basic 5 x wide, Comfy 3 x wide, Nice 2 x wide, Penthouse 2 x wide), one lobby, the same levels and the same order (by level, low to high).
  // Nobody moves: each level's flats are read tower by tower, floor by floor, and laid along the block's floors in that
  // order, so a home stays put while assign()'s homes do. `wide` grows (one step at a time) only when the block would
  // pass `max` storeys: the block gets longer, never taller than the CEO tower allows.
  //   res: assign()'s answer. Returns the same shape: { towers: [the block], homes, moves, state, wide }.
  function block(res, { wide = 3, max = MAX_FLOORS } = {}) {
    const slots = LEVELS.map(() => []);
    for (const t of res.towers || []) for (const f of t.floors) { const row = f.flats.slice(); while (row.length < (f.perFloor || LEVELS[f.level].perFloor)) row.push(null); slots[f.level].push(...row); }
    for (const s of slots) while (s.length && s[s.length - 1] == null) s.pop(); // spare flats at the very end are not built
    let k = Math.max(1, wide | 0), floors = [];
    for (;;) {
      floors = [];
      LEVELS.forEach((L, i) => { const per = L.perFloor * k; for (let j = 0; j < slots[i].length; j += per) floors.push({ level: i, flats: slots[i].slice(j, j + per), perFloor: per }); });
      if (floors.reduce((a, f) => a + LEVELS[f.level].span, 0) <= max || k > 64) break;
      k++;
    }
    const homes = {}; let s = 0;
    const out = floors.map((f, i) => {
      const L = LEVELS[f.level], span = L.span, first = s + 1, name = span > 1 ? `Floors ${first}-${first + span - 1}` : `Floor ${first}`;
      s += span;
      f.flats.forEach((id, j) => { if (id) homes[id] = { tower: "homes", towerName: "Residences", towerIndex: 0, floorSeq: i + 1, storey: first, span, floorName: name, level: f.level, levelKey: L.key, levelName: L.name, flat: j + 1, flats: f.flats.length }; });
      return { seq: i + 1, level: f.level, levelKey: L.key, levelName: L.name, storey: first, span, name, flats: f.flats, perFloor: f.perFloor };
    });
    const towers = out.length ? [{ id: "homes", name: "Residences", storeys: s, floors: out, block: true, wide: k }] : [];
    return { towers, homes, moves: res.moves || [], state: res.state, wide: k };
  }

  // The Residences' outside look (the owner 2026-11-16, "less prison-like"): the bays the 2D (city.js drawHomes) and 3D
  // (3d/buildings.js makeResidence) drawings share, so both agree. A floor holds LEVELS[i].perFloor x `units` flats
  // (units = the long block's `wide`, 1 for a tower), so one bay per unit holds whole flats on every floor. Each bay has
  // a warm wall tone (named; colour never carries a meaning here: the level words do that), an accent for shutters,
  // balcony fronts and awnings, a roof (a low gable, a roof garden or a water tank; all inside the old roof allowance)
  // and an inset (bays step in from the front a little, symmetric about the door, which stays mid-front).
  const TONES = [
    { tone: "terracotta", wall: "#d9a07f", accent: "#3f6f6a" },
    { tone: "honey", wall: "#e6c88e", accent: "#3d6585" },
    { tone: "cream", wall: "#efe3c8", accent: "#8a4b3a" },
    { tone: "rose", wall: "#e0b1a5", accent: "#566f4a" },
    { tone: "sage", wall: "#c3cca8", accent: "#9a5a3c" },
  ];
  const CURTAINS = ["#f3e7c9", "#e8b49b", "#c6d8bd", "#efd17f", "#b8cce0", "#e6c3d3"];
  const ROOFS = ["gable", "garden", "tank"];
  const hash = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  function facade({ w = 4.4, floors = [], id = "homes" } = {}) {
    const units = Math.max(1, ...floors.map((f) => Math.round((f.perFloor || (f.flats || []).length || 1) / LEVELS[Math.max(0, Math.min(3, f.level | 0))].perFloor) || 1));
    const seed = hash(id), bw = w / units, mid = (units - 1) / 2;
    const bays = Array.from({ length: units }, (_, i) => {
      const t = TONES[units > 1 ? (i * 2 + seed) % TONES.length : seed % TONES.length];
      const away = Math.round(Math.abs(i - mid) * 2) % 4; // 0/1: steps in; 2/3: stands forward (symmetric about the door)
      return { i, x0: i * bw, x1: i === units - 1 ? w : (i + 1) * bw, tone: t.tone, wall: t.wall, accent: t.accent, roof: ROOFS[(i + seed) % ROOFS.length], inset: units > 1 && away <= 1 ? 0.2 : 0 };
    });
    const curtain = (storey, j) => CURTAINS[hash(`${id}:${storey}:${j}`) % CURTAINS.length];
    // (inside, 2026-11-16) the bay flat j of a floor with k flats sits in: the same bay you see it in from outside
    const bayOfFlat = (j, k) => bays[Math.max(0, Math.min(units - 1, Math.floor(((j + 0.5) * units) / Math.max(1, k))))];
    return { units, bays, door: w / 2, roofMax: 0.5, curtain, bayAt: (x) => bays[Math.max(0, Math.min(units - 1, Math.floor(x / bw)))], bayOfFlat };
  }

  // ---- inside a home (the owner 2026-11-16: "each person should at least get basic needs covered in their place"; "use
  // real apartments and condos versus price as reference, and assume a standard of living based on the fact it's a
  // campus"). What each level is modelled on and what every flat of it comes with, as fixtures of the home: the same
  // for everyone at that level, never bought, never counted against the display limits, never in storage. The 2D
  // (city.js) and 3D (3d/main3d.js) interiors and the home and building panels all read this, so they can't drift.
  // Higher levels get better versions of the same needs, plus private space, a view and outdoor space; the floor
  // (employer housing on a well-funded campus) is a clean, warm, finished studio with every need met.
  const NEEDS = ["sleep", "eat", "cook", "wash", "store", "light", "warmth"];
  const BASICS = [
    { sleep: "a single bed", eat: "a table for two", cook: "a kitchenette along one wall (sink, hob, small fridge)", wash: "a shower room", store: "a wardrobe", light: "a ceiling light and a reading lamp", warmth: "a radiator under the window" },
    { sleep: "a double bed in a bedroom behind a half wall", eat: "a table for two", cook: "a kitchen (sink, hob and oven, fridge)", wash: "a bathroom", store: "a wardrobe and shelves", light: "ceiling lights and a floor lamp", warmth: "a radiator under the window" },
    { sleep: "a double bed in its own bedroom", eat: "a dining table for four", cook: "a kitchen with counter seating", wash: "a bathroom with a bath", store: "a big wardrobe and shelves", light: "ceiling lights and lamps", warmth: "radiators and a warm floor" },
    { sleep: "a big bed on the gallery floor", eat: "a dining table for six", cook: "a full kitchen with an island", wash: "a real bathroom with a bath and a shower", store: "a dressing room", light: "lights on both floors", warmth: "a warm floor and a fireplace" },
  ];
  // the real housing type each level is modelled on (sizes: rough real averages for that kind of home; see
  // docs/handoffs/residences-inside-plan.md), and what makes it more than the level below
  const HOMETYPES = [
    { type: "studio", modelledOn: "a studio apartment", area: "about 40-45 m²", rooms: "one room for sleeping, eating and cooking, with its own shower room", outside: "a window with shutters and a flower box" },
    { type: "one-bedroom", modelledOn: "a one-bedroom apartment", area: "about 65-75 m²", rooms: "a bedroom behind a half wall, a living room with the kitchen, and a bathroom", outside: "a balcony" },
    { type: "large one-bedroom condo", modelledOn: "a large one- or two-bedroom condo", area: "about 95-105 m²", rooms: "a separate bedroom, a kitchen with counter seating, better finishes", outside: "a glass balcony with planters under an awning" },
    { type: "two-storey penthouse", modelledOn: "a two-storey penthouse", area: "about 230 m² and up", rooms: "a living floor and a gallery bedroom floor up a stair, a glass wall", outside: "a terrace with a pergola" },
  ];
  // what everyone in the building gets, whatever their level
  const SHARED = ["a lobby with mailboxes and seating", "a lift and stairs", "a shared laundry room", "bike storage", "a common room", "the community garden"];
  // the one bought thing that takes a basic's place in the picture (a bought comfy bed replaces the plain bed)
  const REPLACES = { sleep: "bed" };
  const homeInfo = (level) => { const l = Math.max(0, Math.min(TOP, level | 0)); return { level: l, name: LEVELS[l].name, ...HOMETYPES[l], basics: { ...BASICS[l] }, shared: SHARED.slice() }; };
  const comesWith = (level) => NEEDS.map((n) => BASICS[Math.max(0, Math.min(TOP, level | 0))][n]);

  const api = { MAX_FLOORS, BAY_SLOTS, BAY_W, DEPTH, ROOM_W, FIXTURES, PLAN, REPLAN_LINE, roomW, LEVELS, levelsFor, levelOf, assign, block, facade, NEEDS, BASICS, HOMETYPES, SHARED, REPLACES, homeInfo, comesWith };
  if (typeof globalThis !== "undefined") globalThis.campusHomes = api;
})();
