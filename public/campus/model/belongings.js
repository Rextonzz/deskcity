// Belongings: where each thing a worker owns is shown (the owner 2026-11-16: "make sure no one lost anything and their
// personal stuff is set in the apartments"; "use the balconies"; "a community garden for those with no outside area").
// Pure logic, no DOM. Works as a classic <script> (sets globalThis.campusBelongings, loaded by campus/boot.js after
// model/homes.js) and when imported by Node (test/campus/belongings.test.mjs). The 2D and 3D drawing code both ask
// this file, so the rule and the picture can't drift apart.
//
// One answer per owned thing, never nothing for a lasting one:
//   flat     inside their flat (home things, pets, the arcade cabinet)
//   balcony  on their flat's balcony (Comfy and up): outdoor things that fit there
//   garden   on their plot in the community garden: outdoor things too big for a balcony, or anyone with no balcony
//   desk     at work (desk things; and home things and pets of someone with no flat, like the HR desks)
//   worn     on them (hats, headphones, sunglasses)
// Things used up when bought (treats, outings, a Short, a slide ride) have no place: null.
(function () {
  const PLACES = ["flat", "balcony", "garden", "desk", "worn"];
  // outdoor things that fit on a balcony: the barbecue, the small ornaments, a flower garden as planters
  const BALCONY_OK = new Set(["bbq", "gnome", "flamingo", "garden"]);
  // a level has a balcony from Comfy (1) up; level null/undefined = no flat at all
  const hasBalcony = (level) => level != null && level >= 1;
  const hasFlat = (level) => level != null && level >= 0;
  // what kind of lasting thing it is (desk, home, yard, pets, wear), or null when it's used up
  function kindOf(perk) {
    if (!perk || perk.hours != null) return null;
    if (["desk", "home", "yard", "pets", "wear"].includes(perk.cat)) return perk.cat;
    return perk.home ? "home" : "other"; // the arcade cabinet (cat "fun", kept at home); "other": a lasting thing of no known kind
  }
  // Where one thing is shown. key: the item key; perk: its PERKS entry; level: their home's level index, or null.
  function placeOf(key, perk, level) {
    const kind = kindOf(perk);
    if (!kind) return null;
    if (kind === "desk") return "desk";
    if (kind === "wear") return "worn";
    if (kind === "yard") return BALCONY_OK.has(key) && hasBalcony(level) ? "balcony" : "garden";
    return hasFlat(level) ? "flat" : "desk"; // home, pets, other
  }
  // ---- display limits (the owner 2026-11-16: "workers can amass items too quickly and flood the screen eventually") ----
  // How many things one place shows at once. The rest are "in storage": still owned, listed in words in the panels,
  // just not drawn. A worker's flat goes by its level; the balcony, a garden plot and the desk have one number each.
  const LIMITS = { flat: [4, 6, 8, 12], balcony: 3, garden: 4, desk: 5 }; // flat: Basic, Comfy, Nice, Penthouse
  // What a flat comes furnished with for its level (never counted against its limit; city.js and main3d.js draw these)
  const FURNISHED = [[], ["rug", "couch"], ["rug", "couch", "tv", "bookshelf"], ["rug", "couch", "tv", "bookshelf", "bed"]];
  const limitOf = (place, level) => (place === "flat" ? LIMITS.flat[Math.max(0, Math.min(LIMITS.flat.length - 1, level ?? 0))] : LIMITS[place] ?? Infinity);
  // What one place shows of an owned list. ownedList: keys in purchase order (the wallet's `owned`; later = newer);
  // lifeStates: the wallet's `living` ([{ item }]) or a list of keys: pets and plants need care, so they are shown first
  // and never go to storage. Each copy of an item counts as its own thing (3 gnomes = 3). Worn things are not limited.
  // Returns { shown: [keys], stored: [keys] } (copies repeat); shown + stored is everything that belongs in that place.
  // Order: furnished things (free), then life-state things, then the newest bought. Fully determined by the list, so
  // the picture doesn't change between loads. If a worker has more life-state things than the limit, they are all
  // shown and every other thing goes to storage (a pet is never hidden to make room).
  function shownAt(place, level, ownedList, perks, lifeStates) {
    const life = new Set((lifeStates || []).map((x) => (typeof x === "string" ? x : x?.item)).filter(Boolean));
    const free = place === "flat" ? FURNISHED[Math.max(0, Math.min(FURNISHED.length - 1, level ?? 0))] || [] : [];
    const mine = [];
    (ownedList || []).forEach((key, idx) => { if (placeOf(key, perks?.[key], level) === place) mine.push({ key, idx }); });
    if (place === "worn") return { shown: mine.map((x) => x.key), stored: [] };
    const furnished = mine.filter((x) => free.includes(x.key));
    const pets = mine.filter((x) => !free.includes(x.key) && life.has(x.key));
    const rest = mine.filter((x) => !free.includes(x.key) && !life.has(x.key)).sort((a, b) => b.idx - a.idx); // newest first
    // In a flat, pets and plants are shown on top of the limit, so a home with pets is not left bare; elsewhere (desk, balcony, plot) they use it up.
    const room = place === "flat" ? limitOf(place, level) : Math.max(0, limitOf(place, level) - pets.length);
    return { shown: [...furnished, ...pets, ...rest.slice(0, room)].map((x) => x.key), stored: rest.slice(room).map((x) => x.key) };
  }
  // Everything one worker owns, each key once with how many: [{ key, n, place }] (used-up things left out).
  function belongings(owned, perks, level) {
    const n = new Map();
    for (const k of owned || []) n.set(k, (n.get(k) || 0) + 1);
    const out = [];
    for (const [key, count] of n) { const place = placeOf(key, perks?.[key], level); if (place) out.push({ key, n: count, place }); }
    return out;
  }
  const at = (owned, perks, level, place) => belongings(owned, perks, level).filter((b) => b.place === place).map((b) => b.key);
  // The community garden's plots: one for everyone with something in the garden, in name order.
  //   people: [{ id, name?, level, owned }]  ->  [{ id, name, level, garden: [keys], balcony: [keys] }]
  // Anyone whose outdoor things all sit on their balcony has no plot; balconyOnly lists them (the garden panel says so).
  function gardenPlots(people, perks) {
    const plots = [], balconyOnly = [];
    for (const p of people || []) {
      // p.living (the wallet's life states, optional): pets and plants are never put in storage
      const g = shownAt("garden", p.level, p.owned, perks, p.living), bc = shownAt("balcony", p.level, p.owned, perks, p.living);
      const garden = [...new Set(g.shown)], balcony = [...new Set(bc.shown)], gardenStored = g.stored, balconyStored = bc.stored;
      if (garden.length) plots.push({ id: p.id, name: p.name || p.id, level: p.level ?? null, garden, balcony, gardenStored, balconyStored });
      else if (balcony.length) balconyOnly.push({ id: p.id, name: p.name || p.id, level: p.level ?? null, balcony, balconyStored });
    }
    const byName = (a, b) => String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id));
    return { plots: plots.sort(byName), balconyOnly: balconyOnly.sort(byName) };
  }
  // The garden's grid for n plots: up to 4 rows (so it is never deeper than the Residences square), at least 2 x 2.
  function gardenGrid(n) {
    const rows = n <= 4 ? 2 : n <= 9 ? 3 : 4, cols = Math.max(2, Math.ceil(Math.max(1, n) / rows));
    return { rows, cols };
  }
  const api = { PLACES, BALCONY_OK, LIMITS, FURNISHED, kindOf, placeOf, belongings, at, shownAt, gardenPlots, gardenGrid };
  if (typeof globalThis !== "undefined") globalThis.campusBelongings = api;
})();
