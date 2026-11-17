// Campus 3D: how a Campus Mart item looks in the world (visual rehaul 2026-11-13, "how we add future store ideas").
// Every item key K is drawn by the kit prop "it_K" when kit.json has one (tools/campus-assets/build_items.py, or a
// model generated with a 3D generation service (see tools/campus-assets/item-model.mjs); see THIRD-PARTY-NOTICES.md for which). An item without its own prop, like a worker's new store
// idea the day HR approves it, still shows at once: a stand-in prop for its category (a gift box on the desk, a
// plinth at home, a sign post in the yard, a cushion for a pet) with the item's emoji floating over it.
// Where items go: desk items on the worker's desk (inside their office), home and fun items in their house, yard
// items and pets outside their house (and pets inside too), wear on their head.
import { hasKit } from "./kit.js";

const STAND = { desk: "it_fallback_desk", home: "it_fallback_home", yard: "it_fallback_yard", pets: "it_fallback_pet" };
// The place an item belongs: desk, home, yard, pets or wear (treats and one-off fun like a Short have no place).
export function placeOf(perk) {
  if (!perk) return null;
  if (["desk", "home", "yard", "pets", "wear"].includes(perk.cat)) return perk.cat;
  if (perk.home && perk.hours == null) return "home"; // the arcade cabinet (cat "fun", kept at home)
  return null;
}
// { key, prop, stand, icon, label, place }: prop is the kit prop to draw (null when the kit has neither the item's own
// prop nor a stand-in); stand is true when it's a stand-in, so the caller floats the emoji over it.
export function itemLook(key) {
  const perk = (typeof data !== "undefined" && data?.perks?.[key]) || null, place = placeOf(perk), own = "it_" + key;
  const prop = hasKit(own) ? own : place && hasKit(STAND[place]) ? STAND[place] : null;
  return { key, prop, stand: prop !== own, icon: perk?.icon || "🎁", label: perk?.label || key, place };
}
// A worker's lasting items in one place (desk, home, yard, pets, wear), each key once, priciest first.
export function itemsAt(deskId, place) {
  const own = (typeof shownOwned === "function" ? shownOwned(deskId) : (typeof data !== "undefined" && data?.wallets?.[deskId]?.owned)) || [];
  return [...new Set(own)].filter((k) => placeOf(data.perks?.[k]) === place).sort((a, b) => (data.perks[b].cost || 0) - (data.perks[a].cost || 0));
}
// Every item key in the shop and whether it has its own look yet (for the Mart panel and item-model.mjs).
export function itemCoverage() {
  const perks = (typeof data !== "undefined" && data?.perks) || {};
  return Object.keys(perks).filter((k) => placeOf(perks[k])).map((k) => ({ key: k, own: hasKit("it_" + k), custom: !!perks[k].custom }));
}
