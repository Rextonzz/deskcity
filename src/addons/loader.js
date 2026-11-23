// Add-on loader (Deskcity 0.2.0): drop-in folders under addons/<id>/, all OFF until switched on.
//   addons/<id>/addon.json  { "id", "name", "hubApi": 1, "entry": "index.js", "clientPanel"?, "pages"?: [{label, href}], "timers"?: [names] }
// Discovery reads manifests only; nothing is imported until an add-on is switched on in the hub settings
// (data/hub-settings.json: addonFolders: { on: [ids], killSwitch: false, dataDirs?: { id: path } }). The set that is on is
// read once at start (loadAddons): a change made in Admin takes effect after a restart. Core never imports add-on code
// statically, so with nothing on, nothing under addons/ is ever loaded and no add-on timer starts.
// An entry module's default export may offer:
//   routes(router, helpers)   mounted only under /api/addons/<id>/
//   start({ every, timerOn }) its timers; called from server.js beside the other timers, and not when jobs are disabled
// helpers = { id, name, dataDir }  dataDir is data/addons/<id>/ (made on first use) unless addonFolders.dataDirs[id] names a path
//                                  (how an add-on keeps a data layout that already exists).
// Add-ons run with full access to the hub's Node process: only enable ones you trust (docs/kit/SECURITY.md).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { hubSettings, isDemo, resetHubSettings, settingsRoot } from "../hub/settings.js";
import { requirePasswordConfirmed } from "../security.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ID = /^[a-z0-9-]{1,40}$/;
const RESERVED = new Set(["client", "kill"]); // addresses of the loader's own routes under /api/addons
// The addons/ folder: the repo's, or the throwaway root's when a test sets HUB_TEST_ROOT.
export const addonsRoot = () => path.join(process.env.HUB_TEST_ROOT ? path.resolve(process.env.HUB_TEST_ROOT) : REPO, "addons");

const warned = new Set();
const warnOnce = (msg) => { if (!warned.has(msg)) { warned.add(msg); console.warn(`Add-ons: ${msg}`); } };
// A file named by a manifest must sit inside the add-on's own folder (no "..", no absolute path).
function insideDir(dir, rel) {
  if (typeof rel !== "string" || !rel || path.isAbsolute(rel) || /^[a-z]:/i.test(rel)) return null;
  const abs = path.resolve(dir, rel);
  return abs.startsWith(dir + path.sep) ? abs : null;
}

// Read one folder's manifest. Returns { addon } or { skip: reason } (null when the folder has no addon.json).
function readManifest(root, folder) {
  const dir = path.join(root, folder);
  let m;
  try { m = JSON.parse(fs.readFileSync(path.join(dir, "addon.json"), "utf8")); } catch (err) {
    return err.code === "ENOENT" ? null : { skip: `${folder}: addon.json can't be read (${err.message})` };
  }
  if (!m || typeof m !== "object") return { skip: `${folder}: addon.json is not an object` };
  if (typeof m.id !== "string" || !ID.test(m.id) || RESERVED.has(m.id)) return { skip: `${folder}: id must match [a-z0-9-]{1,40} and not be "client" or "kill"` };
  if (m.id !== folder) return { skip: `${folder}: id "${m.id}" must equal the folder name` };
  if (m.hubApi !== 1) return { skip: `${folder}: needs hubApi 1 (this hub offers 1, the add-on asks for ${JSON.stringify(m.hubApi)})` };
  const entry = insideDir(dir, m.entry ?? "index.js");
  if (!entry) return { skip: `${folder}: entry must be a file inside the add-on's folder` };
  let panel = null;
  if (m.clientPanel != null) { panel = insideDir(dir, m.clientPanel); if (!panel) return { skip: `${folder}: clientPanel must be a file inside the add-on's folder` }; }
  const pages = (Array.isArray(m.pages) ? m.pages : []).filter((p) => p && typeof p.label === "string" && p.label && p.label.length <= 80 && typeof p.href === "string" && /^\/(?!\/)[^\s]*$/.test(p.href) && p.href.length <= 200).map((p) => ({ label: p.label, href: p.href }));
  const timers = (Array.isArray(m.timers) ? m.timers : []).filter((t) => typeof t === "string");
  return { addon: { id: m.id, name: typeof m.name === "string" && m.name ? m.name.slice(0, 80) : m.id, hubApi: 1, pages, timers, hasPanel: !!panel, dir, entry, panel } };
}

// Every add-on folder with a valid manifest (no code is imported) and the folders that were skipped, with why.
export function discover() {
  const root = addonsRoot(), addons = [], skipped = [];
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules").map((d) => d.name).sort(); } catch {}
  for (const folder of names) {
    const r = readManifest(root, folder);
    if (!r) continue;
    if (r.skip) { skipped.push({ folder, reason: r.skip }); warnOnce(`skipped ${r.skip}`); } else addons.push(r.addon);
  }
  return { addons, skipped };
}

// What the settings say: which add-ons are on, the kill switch, and any data folder overrides.
export function addonSettings() {
  const s = hubSettings().addonFolders || {};
  const on = Array.isArray(s.on) ? [...new Set(s.on.filter((x) => typeof x === "string" && ID.test(x)))] : [];
  const dataDirs = {};
  for (const [k, v] of Object.entries(s.dataDirs && typeof s.dataDirs === "object" ? s.dataDirs : {})) if (ID.test(k) && typeof v === "string" && v.trim()) dataDirs[k] = v.trim();
  return { on, killSwitch: s.killSwitch === true, dataDirs };
}

// The add-ons loaded at start: id -> { addon, api, router }. The only place add-on code ever lives in this process.
const loaded = new Map();

function dataDirFor(id, override) {
  const dir = override ? path.resolve(settingsRoot(), override) : path.join(settingsRoot(), "data", "addons", id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Import every add-on that is switched on (and only those), once, at start. One bad add-on is logged and skipped.
export async function loadAddons() {
  loaded.clear();
  if (isDemo()) return [];
  const st = addonSettings();
  if (st.killSwitch) { if (st.on.length) console.log("Add-ons: the kill switch is on, none loaded."); return []; }
  if (!st.on.length) return [];
  const { addons } = discover();
  for (const id of st.on) {
    const addon = addons.find((a) => a.id === id);
    if (!addon) { warnOnce(`"${id}" is switched on but there is no valid addons/${id}/addon.json`); continue; }
    try {
      const mod = await import(pathToFileURL(addon.entry).href);
      const api = mod.default ?? mod;
      const router = express.Router();
      let dir = null;
      const helpers = { id, name: addon.name, get dataDir() { return (dir ??= dataDirFor(id, st.dataDirs[id])); } };
      if (typeof api?.routes === "function") await api.routes(router, helpers);
      loaded.set(id, { addon, api, router });
      console.log(`Add-on loaded: ${addon.name} (${id})`);
    } catch (err) {
      console.warn(`Add-on "${id}" failed to load and was skipped: ${err.message}`);
    }
  }
  return [...loaded.keys()];
}

// Start the loaded add-ons' timers. server.js calls this beside its own timers, and only when jobs aren't disabled.
export function startAddons({ every, timerOn }) {
  for (const [id, { api }] of loaded) {
    try { api?.start?.({ every, timerOn }); } catch (err) { console.warn(`Add-on "${id}" timers failed to start: ${err.message}`); }
  }
}

// Switch an add-on or the kill switch in data/hub-settings.json (same read, merge, write, reset as the other Admin switches).
function saveAddonFolders(mutate) {
  if (isDemo()) return { status: 403, body: { error: "This is a demo: nothing runs here." } };
  const file = path.join(settingsRoot(), "data", "hub-settings.json");
  let s = {};
  try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  const cur = { on: [], killSwitch: false, ...(s.addonFolders && typeof s.addonFolders === "object" ? s.addonFolders : {}) };
  mutate(cur);
  s.addonFolders = cur;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
  resetHubSettings();
  return { status: 200 };
}
const RESTART = "Takes effect after the hub restarts.";

// /api/addons (mount after requireLogin). Add-on routes live under /api/addons/<id>/; a switched-off add-on answers 404.
export function addonsRouter() {
  const r = express.Router();
  r.get("/client", (req, res) => res.json([...loaded.values()].map(({ addon }) => ({ id: addon.id, name: addon.name, pages: addon.pages, ...(addon.hasPanel ? { panel: `/addons/${addon.id}/panel.js` } : {}) }))));
  r.get("/", (req, res) => {
    const st = addonSettings(), { addons, skipped } = discover();
    res.json({ killSwitch: st.killSwitch, addons: addons.map((a) => ({ id: a.id, name: a.name, pages: a.pages, timers: a.timers, on: st.on.includes(a.id), loaded: loaded.has(a.id) })), skipped, note: RESTART });
  });
  r.post("/kill", requirePasswordConfirmed, (req, res) => {
    if (typeof req.body?.killSwitch !== "boolean") return res.status(400).json({ error: "Say killSwitch true or false." });
    const out = saveAddonFolders((c) => { c.killSwitch = req.body.killSwitch; });
    res.status(out.status).json(out.body || { killSwitch: req.body.killSwitch, note: RESTART });
  });
  r.post("/:id", requirePasswordConfirmed, (req, res) => {
    const id = req.params.id;
    if (typeof req.body?.on !== "boolean") return res.status(400).json({ error: "Say on true or false." });
    const known = discover().addons.some((a) => a.id === id), was = addonSettings().on.includes(id);
    if (!known && !(was && !req.body.on)) return res.status(404).json({ error: `No add-on called ${id}.` });
    const out = saveAddonFolders((c) => { const set = new Set(Array.isArray(c.on) ? c.on : []); req.body.on ? set.add(id) : set.delete(id); c.on = [...set]; });
    res.status(out.status).json(out.body || { id, on: req.body.on, note: RESTART });
  });
  r.use("/:id", (req, res, next) => {
    const hit = loaded.get(req.params.id);
    if (!hit) return res.status(404).json({ error: `${req.params.id} add-on is off` });
    hit.router(req, res, next);
  });
  return r;
}

// GET /addons/<id>/panel.js: the manifest's clientPanel file, for add-ons that are on. Nothing else is served from addons/.
export function addonPanelRouter() {
  const r = express.Router();
  r.get("/:id/panel.js", (req, res) => {
    const hit = loaded.get(req.params.id);
    if (!hit?.addon.panel) return res.status(404).type("text").send("Not found");
    res.sendFile(hit.addon.panel, { headers: { "Content-Type": "text/javascript; charset=utf-8" } }, (err) => { if (err && !res.headersSent) res.status(404).type("text").send("Not found"); });
  });
  return r;
}
