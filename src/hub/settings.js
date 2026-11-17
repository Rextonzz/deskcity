// Hub settings (Hub kit step 1, 2026-11-10): who owns this hub, where they are, and whether the campus has a pet.
// Three layers, later ones win:
//   1. hub.defaults.json   - in the kit: a generic owner, no town, no pet
//   2. hub.owner.json      - this owner's committed settings (the owner's copy has one; the kit leaves it out)
//   3. data/hub-settings.json - written by the setup guide on a new install (never committed)
// Read once at start (restart the hub after changing them). Nothing secret lives here: keys stay in .env.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const readAt = (dir, f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return {}; } };
const read = (f) => readAt(ROOT, f);
// Tests only: HUB_TEST_SETTINGS is a JSON file merged last (and only read when HUB_TEST_ROOT is set too, as the tests do), so a test can run the hub as another owner (test/hub/owner-id-*.test.mjs).
const readEnvFile = () => { try { return process.env.HUB_TEST_SETTINGS && process.env.HUB_TEST_ROOT ? JSON.parse(fs.readFileSync(process.env.HUB_TEST_SETTINGS, "utf8")) : {}; } catch { return {}; } };
const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === "object" && !Array.isArray(v) && a?.[k] && typeof a[k] === "object" ? merge(a[k], v) : v; return o; };

// The display base (the owner 2026-11-14: "once its a installer you can chose a base for display of the program 2d 3d or
// this one"): what the campus opens on. Chosen in setup (docs/kit/SETUP.md); each device can still pick its own on the
// campus (the View picker), which wins on that device.
// "pages" (the owner 2026-11-14: "I'd like that to be another view option than forced in"): the hub opens on its plain
// web pages (Home, or the Agents page) instead of the campus.
export const DISPLAYS = ["2d", "3d", "neural", "pages"];
export const displayOf = (v) => (DISPLAYS.includes(String(v || "").toLowerCase()) ? String(v).toLowerCase() : "3d");
// The campus layout (the owner 2026-11-16 picked "Quad and wings", docs/design/campus-layout/review.md): "quad" (one
// connected campus round a central quad, the default for everyone, the kit too) or "streets" (the street city by the
// river, kept as a choice). Set as "layout" in the settings files; each device can pick its own on the campus (the
// Layout picker beside the View picker), and ?layout= in the address applies for that visit only.
export const LAYOUTS = ["quad", "streets"];
export const layoutOf = (v) => (LAYOUTS.includes(String(v || "").toLowerCase()) ? String(v).toLowerCase() : "quad");
// Demo mode (HUB_DEMO=1, started by tools/demo.mjs): a sample hub with made-up data. Nothing runs in it: no AI calls, no
// timers, nothing sent out. Only the defaults and the demo's own settings file count, so nothing of this PC's real owner
// shows up in it.
export const isDemo = () => process.env.HUB_DEMO === "1";
export const DEMO_MESSAGE = "Demo data: nothing runs here. This is a sample hub with made-up workers. Set the hub up with your own keys to run jobs.";
let cache = null;
// Where data/hub-settings.json lives: the repo folder, or the throwaway folder when a test or check server sets HUB_TEST_ROOT.
export const settingsRoot = () => (process.env.HUB_TEST_ROOT ? path.resolve(process.env.HUB_TEST_ROOT) : ROOT);
// Forget the cached settings, so the next read sees a file that was just saved (Admin > AI helpers).
export const resetHubSettings = () => { cache = null; };
export function hubSettings() {
  if (cache) return cache;
  const s = (isDemo() ? [read("hub.defaults.json"), readEnvFile()] : [read("hub.defaults.json"), read("hub.owner.json"), readAt(settingsRoot(), "data/hub-settings.json"), readEnvFile()]).reduce(merge, {});
  s.owner = { id: "owner", name: "You", ...(s.owner || {}) };
  s.place = { name: "", lat: null, lon: null, ...(s.place || {}) };
  s.place.timezone = s.place.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  s.pet = s.pet && s.pet.name ? s.pet : null;
  s.hubFolder = s.hubFolder || ROOT.replace(/\\/g, "/");
  s.display = displayOf(s.display);
  s.layout = layoutOf(s.layout);
  return (cache = s);
}
export const ownerName = () => hubSettings().owner.name;
// "the owner's Hub" style title; before setup the owner is still "You", which reads as "Your Hub".
export const ownersHub = () => (ownerName() === "You" ? "Your Hub" : `${ownerName()}'s Hub`);
// The id this owner goes by in saved data and in the pages ("by" on a rating, "from" on a request): "owner" on a new
// install; an older hub sets its own in hub.owner.json so what it already saved still matches.
export const ownerId = () => hubSettings().owner.id;
// The campus pet's name (null when the hub has none), and a line about it for an AI prompt: the template's {name},
// {kind}, {role} and {them} are filled in, and it's "" when there's no pet.
export const petName = () => hubSettings().pet?.name || null;
export function petLine(template) {
  const p = hubSettings().pet;
  if (!p) return "";
  const v = { name: p.name, kind: p.kind || "pet", role: p.role || "CEO", them: p.them || "them" };
  return template.replace(/\{(name|kind|role|them)\}/g, (_, k) => v[k]);
}
export const hubFolder = () => hubSettings().hubFolder;
// Where the owner lives, for a prompt that needs it ("a player in Canada"): settings' place.country, "" when not set.
export const country = () => String(hubSettings().place?.country || "").trim();
// The money the owner thinks in (settings' "currency": { code }): USD until set. The owner's hub says CAD in hub.owner.json.
export const currencyCode = () => String(hubSettings().currency?.code || "USD").toUpperCase();
// Programs and folders on this PC that a session may be given, by settings' "tools" (all empty in the kit):
//   godotPaths: where the Godot program may be; programFilesDirs: folders to look for Blender under; downloadDir: where
//   downloaded tools go ("" = in the project).
export const toolPaths = () => { const t = hubSettings().tools || {}; return { godotPaths: Array.isArray(t.godotPaths) ? t.godotPaths : [], programFilesDirs: Array.isArray(t.programFilesDirs) ? t.programFilesDirs : [], downloadDir: String(t.downloadDir || "") }; };
// The hub folder's own name ("hub-kit"), e.g. for the backups folder beside it and the MCP server's name.
export const hubName = () => hubSettings().hubFolder.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "hub";
// How the hub names itself to outside APIs (a User-Agent): "<owner>sHub", letters and digits only; "Hub" before setup
// has a name.
export const agentName = () => { const n = ownerName().replace(/[^A-Za-z0-9]/g, ""); return n && n !== "You" ? `${n}sHub` : "Hub"; };
export const hubTz = () => hubSettings().place.timezone;
// The channels the pages list (pipeline.config.json): id, display name, short code (two letters on a queue row), the
// page layout it uses (its settings' "layout": which stats and card sections it has) and its inbox folder. Read from
// the pipeline config on each call so a channel added in Admin shows without a restart; none when there's no config.
export function publicChannels() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(process.env.HUB_TEST_ROOT ? path.resolve(process.env.HUB_TEST_ROOT) : ROOT, "pipeline.config.json"), "utf8")); } catch {}
  return Object.entries(cfg.channels || {}).map(([id, c]) => {
    const name = c.name || c.studioName || id;
    return { id, name, short: c.short || name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase(), layout: c.layout || null, inbox: c.inbox || null };
  });
}
// The channel that uses a page layout ("layout" in pipeline.config.json): "packs" has the card-by-card sections, "clips"
// the clip log. {} when no channel has it, so .id is undefined and no job, tracker or saved row matches it.
export const chOfLayout = (layout) => publicChannels().find((c) => c.layout === layout) || {};
// The card stores the card pages talk about (settings' "cards.stores"): the local shop (and its towns, for the deal
// watch's filter) and the shop whose buy list prices a trade. Neutral words until the owner names them.
//   shopUrl / buylistUrl: each store's web address (the lookups and the deal watch open it); empty until set, and an empty one
//     means that lookup is "not set up" (nothing is opened).
//   shopShort / buylistShort: the short name for a narrow column or a label; "Shop" / "Buy list" until set.
//   buylistKey: the buy list's short name as an id: it prefixes the price-source ids a trade saves ("<key>_retail").
export function cardStores() {
  const c = hubSettings().cards?.stores || {};
  const buylistShort = c.buylistShort || "Buy list";
  return {
    shop: c.shop || "the local store", towns: Array.isArray(c.towns) ? c.towns : [], buylist: c.buylist || "the buylist store", deck: c.deck || "",
    shopUrl: c.shopUrl || "", buylistUrl: c.buylistUrl || "", shopShort: c.shopShort || "Shop", buylistShort,
    buylistKey: buylistShort.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "buylist",
  };
}
// The deal watch's own lists (settings' "cards.dealWatch"): the deck's card names, still-to-buy names, upgrade wishlist
// lines ("name | set | number | foil or non-foil | target price"), the deck spreadsheet's path and the CSV's path. "{home}"
// and "{shop}" in a path are filled in (this PC's user folder, the shop's name). Empty until the owner sets them, so a
// new hub's page says "No deck set up yet".
export function dealWatchSettings() {
  const d = hubSettings().cards?.dealWatch || {};
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  return { petDeckPath: typeof d.petDeckPath === "string" ? d.petDeckPath : "", csvPath: typeof d.csvPath === "string" ? d.csvPath : "", petDeck: list(d.petDeck), needed: list(d.needed), wishlist: list(d.wishlist) };
}
// A page of a store: its base address plus a path, with exactly one slash between ("https://shop.example/" + "advanced_search").
export const storeUrl = (base, rel = "") => (base ? `${String(base).replace(/\/+$/, "")}/${rel}` : "");
// The local shop's town names as a regex source ("Town A|Town B"), for reading its stock rows ("Town A: NM, English, 2 In
// stock ..."). Matches nothing when no towns are set.
export const townsPattern = () => cardStores().towns.map((t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") || "(?!)";
// The card stores for the pages: the names and short names, not the web addresses (the server opens those).
const pageStores = () => { const { shopUrl, buylistUrl, ...stores } = cardStores(); return stores; };
// What the pages need (no paths beyond the hub folder, nothing private)
export function publicSettings() {
  const s = hubSettings();
  return { demo: isDemo(), owner: s.owner, ownerId: s.owner.id, place: s.place, pet: s.pet, hubFolder: s.hubFolder, addons: s.addons || [], kit: s.kit || null, display: s.display, layout: s.layout, channels: publicChannels(), stores: pageStores() };
}
