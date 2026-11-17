// What the pages know about this hub, from /api/hub/settings (src/hub/settings.js publicSettings): the owner's data id,
// the channels (id, name, short code, page layout, inbox), the card stores and the town. Pages import what they need
// instead of writing a name in their own text, so a hub with other channels or stores reads right with no page edits.
// Read once per page (top-level await, so a page's markup built at import time already has it). If the hub doesn't
// answer, the last answer this browser saw is used, and after that neutral words.
let info = {};
const KEY = "hub.info";
try {
  const r = await fetch("/api/hub/settings");
  if (r.ok) {
    info = await r.json();
    try { localStorage.setItem(KEY, JSON.stringify({ ownerId: info.ownerId, channels: info.channels, stores: info.stores, place: info.place })); } catch {}
  }
} catch {}
if (!info.channels) { try { info = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { info = {}; } }

export const ownerId = info.ownerId || "owner";
export const channels = Array.isArray(info.channels) ? info.channels : [];
export const stores = { shop: "the local store", towns: [], buylist: "the buylist store", deck: "", shopShort: "Shop", buylistShort: "Buy list", buylistKey: "buy_list", ...(info.stores || {}) };
export const place = info.place || {};
const byId = (id) => channels.find((c) => c.id === id);
// A channel's display name and short code; its id when the hub doesn't list it (a job from a channel taken out).
export const chName = (id) => byId(id)?.name || String(id ?? "");
export const chShort = (id) => byId(id)?.short || String(id ?? "").slice(0, 2).toUpperCase();
// The channel (or {}) that uses a page layout: "packs" has the card-by-card sections, "clips" the clip log.
export const chOfLayout = (layout) => channels.find((c) => c.layout === layout) || {};
// "A and B": the channels names in a sentence.
export const chNames = (join = "and") => channels.map((c) => c.name).join(` ${join} `);
// Where a channel's inbox folder is, as Windows shows it (inbox\name).
export const inboxOf = (c) => String(c?.inbox || "").replace(/^\.[\\/]/, "").replace(/\//g, "\\");
