// Tower stacking (brief section 6, the owner's idea): small running projects share a tower, one floor each,
// so the city stays tidy. Pure logic, no DOM. Works as a classic <script> (sets globalThis.campusTowers)
// and when imported by Node for tests. Not wired into the campus yet.
(function () {
  const TOWER_MAX = 6;        // floors per tower
  const TOWER_W = 5.5, TOWER_D = 5.5, TOWER_FLOOR_H = 1.5;
  const JOIN_DESKS = 2;       // joins a tower at this many desks or fewer (and 1 floor)
  const LEAVE_DESKS = 4;      // leaves its tower at this many desks, or at 2 floors
  const SHARED = "shared";    // district key for rooms with no district

  const deskCount = (p) => (p.desks ? p.desks.length : 0);
  const floorCount = (p) => (p.floors ? p.floors.length : 0);
  const special = (p) => p.isHr || p.id === "hr" || p.isTower || p.isPavilion || p.isStore || p.isLeisure || p.isControl || p.isHomes;
  const districtOf = (p) => (typeof p.district === "string" && p.district.trim() ? p.district.trim() : SHARED);

  // prev may be the last stackTowers() result, its towers array, or a list/Set of project ids that were in towers.
  function prevIds(prev) {
    const ids = new Set();
    if (!prev) return ids;
    const towers = Array.isArray(prev) || prev instanceof Set ? [...prev] : prev.towers || [];
    for (const t of towers) {
      if (typeof t === "string") ids.add(t);
      else if (t && t.members) for (const m of t.members) ids.add(typeof m === "string" ? m : m.id);
    }
    return ids;
  }

  // Hysteresis: in a tower, a project stays until 4 desks or 2 floors; out of one, it joins at 2 desks or fewer and 1 floor.
  function small(p, wasIn) {
    if (!p || p.paused || special(p)) return false;
    const desks = deskCount(p), floors = floorCount(p);
    if (floors > 1) return false;
    return wasIn ? desks < LEAVE_DESKS : desks <= JOIN_DESKS;
  }

  function towerSign(tower) {
    const n = tower.members.length;
    const where = tower.district && tower.district !== SHARED ? tower.district : "Small projects";
    return `${where} · ${n}`;
  }

  function stackTowers(projects, { prev } = {}) {
    const list = projects || [];
    const was = prevIds(prev);
    const byDistrict = new Map();
    for (const p of list) {
      if (!small(p, was.has(p.id))) continue;
      const key = districtOf(p);
      if (!byDistrict.has(key)) byDistrict.set(key, []);
      byDistrict.get(key).push(p);
    }
    const towers = [];
    const memberOf = new Map();
    const keys = [...byDistrict.keys()].sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      const group = byDistrict.get(key).sort((a, b) => String(a.id).localeCompare(String(b.id)));
      // First-fit into towers of up to TOWER_MAX floors. Every member has one floor, so towers fill in order.
      const bins = [];
      for (const p of group) {
        const need = Math.max(1, floorCount(p));
        let bin = bins.find((b) => b.used + need <= TOWER_MAX);
        if (!bin) bins.push((bin = { used: 0, members: [] }));
        bin.members.push(p);
        bin.used += need;
      }
      let n = 0;
      for (const bin of bins) {
        // No 1-floor towers: a lone small project (a single-project district, or one left over) keeps its own building.
        if (bin.members.length < 2) continue;
        n++;
        const members = bin.members;
        const floors = members.flatMap((p) => (p.floors || []).map((f) => (f.project === p ? f : { ...f, project: p })));
        const tower = {
          id: `tower:${key}:${n}`,
          isTower: true,
          district: key === SHARED ? null : key,
          members,
          floors,
          desks: members.flatMap((p) => p.desks || []),
          busy: members.some((p) => p.busy),
          paused: false,
          w: TOWER_W,
          d: TOWER_D,
          h: floors.length * TOWER_FLOOR_H,
        };
        tower.name = towerSign(tower);
        towers.push(tower);
        for (const p of members) memberOf.set(p.id, tower);
      }
    }
    // Lots in input order; a tower takes the place of its first member.
    const lots = [];
    const placed = new Set();
    for (const p of list) {
      const t = memberOf.get(p.id);
      if (!t) lots.push(p);
      else if (!placed.has(t.id)) { placed.add(t.id); lots.push(t); }
    }
    return { lots, towers };
  }

  const api = { stackTowers, towerSign, TOWER_MAX, JOIN_DESKS, LEAVE_DESKS };
  globalThis.campusTowers = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
