// Campus start-up: brings in the shared helpers, then loads the campus scripts in order.
// Split out of campus.html (2026-11-09) so each part stays small enough to work on safely.
import { esc, api } from "/stats-lib.js";
import { ago, ageText, money, spend } from "/fmt.js";
import { confirmBox, safeUrl, approvalNote } from "/lib.js";
window.esc = esc;
window.safeUrl = safeUrl;
window.ago = ago;
window.ageText = ageText;
window.money = money;
window.spend = spend;
window.api = api;
window.confirmBox = confirmBox;
window.approvalNote = approvalNote;
// blocks first: hub pages used inside the view (campus/blocks.js); its Esc must come before the others'
const PARTS = ["/parts/registry.js", "blocks", "props", "core", "ambience", "draw", "/campus/model/homes.js", "/campus/model/belongings.js", "/campus/model/towers.js", "/campus/model/quad.js", "city", "people", "citylife", "citylife2", "motion", "panels", "fundpanel", "casinopanel", "control", "cmdmatch", "command", "brain", "neural", "neuralweb", "neuraldive", "neuralreplay", "main"];
// Speed (2026-11-16): every file is asked for at once (a preload hint each, so they download in parallel and wait in the
// browser's cache), but each one still RUNS only after the one before it has run, exactly as before: the ordering
// guarantees above hold, and a part that doesn't load still stops the rest (the old onerror message).
const srcOf = (name) => (name.startsWith("/") ? name : `/campus/${name}.js`);
for (const name of PARTS) {
  const l = document.createElement("link");
  l.rel = "preload"; l.as = "script"; l.href = srcOf(name);
  document.head.appendChild(l);
}
for (const name of PARTS) {
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = srcOf(name);
    s.onload = resolve;
    s.onerror = () => reject(new Error(`campus part ${name} didn"t load`));
    document.body.appendChild(s);
  });
}

// What the campus opens on: the display base (the owner 2026-11-14: "once its a installer you can chose a base for display
// of the program 2d 3d or this one"). 2D city, 3D city (the default since the 2026-11-13 rehaul), or the Neural web.
// Order: ?view= (or the older ?r=) > this device's pick (the View picker; older saved 2D/3D picks count) > the hub's
// setting (display, chosen in setup: docs/kit/SETUP.md) > 3D. Under Neural the city still loads behind it, in 3D only if
// that is this device's saved pick, else in 2D (the 3D engine isn't downloaded for it), one "Out" away; "View: 3D" loads
// the 3D city on demand. 3D needs WebGL; without it the city is 2D.
const DKEY = "campus.display", RKEY = "campus.renderer", VIEWS = ["2d", "3d", "neural", "pages"];
const sp = new URLSearchParams(location.search), qv = sp.get("view") || sp.get("r");
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
let hubDisplay = null, hubModules = null, hubLayout = null;
try { const hs = await fetch("/api/hub/settings").then((r) => (r.ok ? r.json() : {})); hubDisplay = hs.display || null; hubLayout = hs.layout || null; hubModules = Array.isArray(hs.modules) ? hs.modules : null; window.campusAssetV = hs.assetV || {}; /* ?v= for kit.json (src/httpcache.js) */ } catch {}
// parts switched off on this hub (src/hub/modules.js): their views aren't offered, and CSS hides their buttons
const partOn = (id) => !hubModules || hubModules.includes(id);
for (const id of ["campus3d", "neural"]) if (!partOn(id)) document.body.classList.add(`mod-off-${id}`);
// A ?view= link: 2d and 3d are what the View picker reloads with, so they are saved for this device. A neural or pages
// link applies to this visit only (the owner 2026-11-16: it opened Neural on every start after one such link); the picker still saves them.
const qView = VIEWS.includes(qv) ? qv : null;
if (qView === "2d" || qView === "3d") { ls.set(DKEY, qView); ls.set(RKEY, qView); }
// Neural only stays as this device's opening view when it was picked in the View picker (which sets PKEY). A "neural"
// that an old link saved before 2026-11-16 has no such mark: forget it once, so the campus opens on the city again
// (the owner: "Neural still forcing over top on first open").
const PKEY = "campus.display.picked";
if (ls.get(DKEY) === "neural" && ls.get(PKEY) !== "1") { try { localStorage.removeItem(DKEY); } catch {} }
const usable = (v) => VIEWS.includes(v) && (v !== "3d" || partOn("campus3d")) && (v !== "neural" || partOn("neural"));
let display = [qView, ls.get(DKEY), ls.get(RKEY), hubDisplay].find(usable) || (partOn("campus3d") ? "3d" : "2d");
// "pages" only decides the front door ("/"): someone who opens the campus from the menu gets the city as usual
if (display === "pages") display = [ls.get(RKEY), partOn("campus3d") ? "3d" : "2d"].find((v) => v === "2d" || v === "3d");
const webgl = partOn("campus3d") && (() => { try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; } })();
// the city's renderer; behind Neural it is 3D only when 3D is this device's saved pick, else 2D (no three.js, no kit.json: speed, 2026-11-16)
let mode = display === "neural" ? (ls.get(RKEY) === "3d" ? "3d" : "2d") : display;
if (!webgl) mode = "2d";
window.campusDisplay = display;
// The View picker in the HUD: 2D and 3D reload the page; Neural opens over the city straight away.
const pick = document.createElement("select");
pick.className = "pill"; pick.id = "hMode"; pick.setAttribute("aria-label", "View");
pick.title = "How the campus looks: the 2D city, the 3D city, or the Neural web of workers. Remembered on this device.";
pick.innerHTML = `<option value="2d">View: 2D</option>${webgl ? '<option value="3d">View: 3D</option>' : ""}${partOn("neural") ? '<option value="neural">View: 🧬 Neural</option>' : ""}<option value="pages">View: 📄 Pages (open on the plain pages)</option>`;
pick.value = display === "neural" ? "neural" : mode;
pick.onchange = () => {
  const v = pick.value;
  ls.set(DKEY, v); ls.set(PKEY, v === "neural" ? "1" : "0"); window.campusDisplay = v;
  if (v === "neural") { if (typeof neuralOpen === "function") neuralOpen(null, { mode: "web" }); return; }
  // Pages: from now on this device opens on the plain pages; go there now (the menu's Campus link still comes back here)
  if (v === "pages") { location.href = "/"; return; }
  ls.set(RKEY, v);
  // a fresh load in the other city, without Neural's #neural=… (it would reopen Neural over it)
  if (v !== mode) location.href = `${location.pathname}?view=${v}`;
  else if (typeof neuralClose === "function") neuralClose(); // the city that's already behind Neural
};
if (pick.options.length > 1) document.querySelector(".hud")?.appendChild(pick);
// The Layout picker beside it (the owner 2026-11-16): the quad (one connected campus round a central quad, the default) or
// the street city by the river. Remembered on this device; ?layout= in the address is for this visit only (core.js
// layoutChoice reads the same order). A change reloads the city.
{
  const LKEY = "campus.layout", LAYS = ["quad", "streets"], ql = String(sp.get("layout") || "").toLowerCase();
  const now = [ql, ls.get(LKEY), hubLayout].find((v) => LAYS.includes(String(v || "").toLowerCase())) || "quad";
  const lp = document.createElement("select");
  lp.className = "pill"; lp.id = "hLayout"; lp.setAttribute("aria-label", "Layout");
  lp.title = "How the campus is laid out: the quad (every building joined round one central quad by a covered walk) or the streets (the street city by the river). Remembered on this device.";
  lp.innerHTML = '<option value="quad">Layout: Quad</option><option value="streets">Layout: Streets</option>';
  lp.value = String(now).toLowerCase();
  lp.onchange = () => {
    ls.set(LKEY, lp.value);
    const q = new URLSearchParams(location.search); q.delete("layout"); q.set("view", window.campusCity || mode);
    location.href = `${location.pathname}?${q}`;
  };
  document.querySelector(".hud")?.appendChild(lp);
}
if (mode === "3d" && webgl) {
  try { await import("/campus/3d/main3d.js"); }
  catch (err) { console.warn("3D campus didn't start, staying 2D:", err); window.campus3dActive = false; }
}
// which city actually started (the View picker goes back to it when Neural closes)
window.campusCity = mode === "3d" && window.campus3dActive !== false ? "3d" : "2d";

// Neural as the base: open the web over the city once the campus has its data.
if (display === "neural" && !/^#(brain|neural)=/.test(location.hash)) {
  const go = () => (typeof data !== "undefined" && data?.desks && typeof neuralOpen === "function" ? neuralOpen(null, { mode: "web" }) : setTimeout(go, 300));
  go();
}
