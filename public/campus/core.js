// Campus: data, password helpers, world layout and camera. Part of public/campus.html, loaded in order by campus/boot.js;
// the files share one global scope (classic scripts), so a name defined in one is visible in the others.
"use strict";
// Hub kit settings (/api/hub/settings): the owner's name, their town (sun and weather) and the campus pet, if any.
// A fresh install: "You", no town, no pet.
let HUB = { owner: { name: "You" }, ownerId: "owner", place: {}, pet: null, loaded: false };
const OWN = () => HUB.owner?.name || "You";
// The id saved data and requests use for the owner ("by" on a rating, "from" on a request): the settings' owner.id.
const OWNER_ID = () => HUB.ownerId || "owner";
// The campus pet's two brass plaques in its 3D penthouse: the settings' pet.plaques ([[line, line], [line, line]]), else
// made from its name, role and kind.
const petPlaques = () => { const p = HUB.pet || {}; return Array.isArray(p.plaques) && p.plaques.length >= 2 ? p.plaques : [[`Dr. Sir ${PET()}`, `The ${p.role || "CEO"}`], [PET(), `${p.role || "CEO"} \u00b7 goodest ${p.kind || "pet"}`]]; };
// The channel (id, name, short, layout) that uses a page layout, and a channel's short code (the hub settings' channels).
const chOf = (layout) => (HUB.channels || []).find((c) => c.layout === layout);
const chShort = (id) => (HUB.channels || []).find((c) => c.id === id)?.short || "";
// Words for the password prompts and a few texts that name this owner's own private part; this owner's wording is set in
// the marked block below, which the kit leaves out.
let PW_WHY = "This sends to GitHub or spends API money, so it needs your dashboard password.";
let PW_WHY_JOB = "This sends to GitHub, so it needs your dashboard password.";
let VIA_NOTE = "", JOB_GH_NOTE = "";
// A page block's one-line "about" (parts/registry.js): {shop} and {buylist} are the card stores' names from the settings.
const aboutOf = (b) => String(b.about || "").replace(/\{(shop|buylist)\}/g, (_, k) => ({ shop: "the local store", buylist: "the buylist store", ...(HUB.stores || {}) })[k]);
const PET = () => HUB.pet?.name || "";
const hasPet = () => !!HUB.pet?.name && modOn("pet");
// Which parts of the hub are on (src/hub/modules.js); before the settings arrive everything counts as on.
const modOn = (id) => !Array.isArray(HUB.modules) || HUB.modules.includes(id);
async function loadHubSettings() {
  if (HUB.loaded) return;
  try { HUB = { ...HUB, ...(await fetch("/api/hub/settings").then((r) => (r.ok ? r.json() : {}))), loaded: true }; } catch { HUB.loaded = true; }
  const wx = document.getElementById("hWx");
  if (wx) wx.title = `Live weather${HUB.place?.name ? ` in ${HUB.place.name}` : ""}. Tap to switch the light: Auto (the real sun), always day, always night`;
  // the help line's pet note ("the grey cat is the pet, our CEO"): the settings' pet.legend, else made from its name; none without a pet
  const lg = document.getElementById("helpPet");
  if (lg) lg.textContent = hasPet() ? `${HUB.pet.legend || `${HUB.pet.kind ? `the ${HUB.pet.kind}` : "the pet"} is ${PET()}, our ${HUB.pet.role || "CEO"}`} \u00b7 ` : "";
  if (typeof sunDay !== "undefined") sunDay = null; // recompute sunrise and sunset for the owner's town
  if (typeof loadWeather === "function") loadWeather();
}
// A POST that asks for the dashboard password once if the hub wants it, then tries again.
const postPw = (path, body) => api(path, body, { password: true, why: PW_WHY });

// ---------- steps in plain words (the owner 2026-11-14: "making steps a bit more human understandable") ----------
// One line per step for the feeds: "Edited DESIGN.md", "Ran a command", "Searched the web", "Asked a helper",
// instead of "Files · Edit · DESIGN.md". Used by the Full feed, the ticker and the brain view.
const HUMAN_TOOL = {
  Read: "Read", Edit: "Edited", MultiEdit: "Edited", Write: "Wrote", NotebookEdit: "Edited", Glob: "Looked for files", Grep: "Searched the files", LS: "Looked in a folder",
  Bash: "Ran a command", PowerShell: "Ran a command", BashOutput: "Checked on a command", KillShell: "Stopped a command", WebFetch: "Read a web page", WebSearch: "Searched the web",
  Task: "Asked a helper", Agent: "Asked a helper", TodoWrite: "Updated its plan", ExitPlanMode: "Finished planning", Skill: "Used a skill", ToolSearch: "Looked up a tool",
  apply_patch: "Edited", shell: "Ran a command", web_search: "Searched the web", update_plan: "Updated its plan",
};
const STEP_WORDS = {
  "session start": "Started a session", "session end": "Ended its session", "turn done": "Finished a reply", "subagent done": "A helper finished", "job given": "Got a job",
  "job taken": "Started on a job", "job done": "Finished a job", "job failed": "A job failed", "job handed over": "Got work handed over", "hand-off refused": "Couldn't pass work back",
  "hand-off asked": "Asked to hand work on", "job retried": "A job was retried", "watched a Short": "Watched a Short", "surfed the web": "Spent a few minutes on the web", chore: "Did a chore",
  "rated a job": "Rated a job", "idea filed": "Filed an idea", "store item added": "Added to the Mart", report: "Reported in", "cloud report": "Reported in", "autonomy report": "Reported in",
  shipped: "Shipped", review: "Reviewed", "files changed": "Changed files", hired: "Was hired", "back to work": "Back at work", note: "Left a note",
};
function humanStep(e) {
  if (e.action === "tool") {
    const t = String(e.tool || ""), f = e.summary, v = HUMAN_TOOL[t];
    let s;
    if (v && /^(Read|Edited|Wrote)$/.test(v)) s = f ? `${v} ${f}` : `${v} a file`;
    else if (v) s = f ? `${v} (${f})` : v;
    else if (/^mcp__/.test(t)) { const [, srv, ...rest] = t.split("__"); s = `Used ${srv.replace(/[_-]+/g, " ")}${rest.length ? ` (${rest.join(" ").replace(/[_-]+/g, " ")})` : ""}`; }
    else s = `Used ${t || "a tool"}${f ? ` on ${f}` : ""}`;
    return s + (e.note ? ` (${e.note})` : "") + (e.failed ? " (it failed)" : "");
  }
  const w = STEP_WORDS[e.action] || (e.action ? e.action[0].toUpperCase() + e.action.slice(1) : "Did something");
  return e.summary ? `${w}: ${e.summary}` : w;
}
// A job block's one-line story: "edited 5 files, ran 9 commands, read 12, searched the web twice".
function jobBlockSummary(g) {
  const c = g.counts || {}, n = (k) => c[k] || 0, bits = [];
  if (g.edited) bits.push(`edited ${g.edited} file${g.edited === 1 ? "" : "s"}`);
  else if (n("files")) bits.push(`worked through ${n("files")} file step${n("files") === 1 ? "" : "s"}`);
  if (n("shell")) bits.push(`ran ${n("shell")} command${n("shell") === 1 ? "" : "s"}`);
  if (n("web")) bits.push(`went to the web ${n("web") === 1 ? "once" : `${n("web")} times`}`);
  if (n("agents")) bits.push(`asked ${n("agents")} helper${n("agents") === 1 ? "" : "s"}`);
  if (n("tools")) bits.push(`used connected tools ${n("tools")} time${n("tools") === 1 ? "" : "s"}`);
  if (g.failed) bits.push(`✕ ${g.failed} failed`);
  return bits.join(", ") || `${g.n} step${g.n === 1 ? "" : "s"}`;
}

// ---------- data ----------
let data = null;
let lastSeen = 0;
try { lastSeen = Number(localStorage.getItem("campus.lastSeen")) || 0; } catch {}
const ACTIVE_MS = 15 * 60000;
const PROVIDER = { claude: "#e08a5a", gemini: "#6ea8ff", grok: "#c9ccd4", mixed: "#b48cff", other: "#8fd18b" };
const usd = spend;

async function load() {
  await loadHubSettings();
  try {
    data = await api("/agents");
    data.__loadedAt = Date.now();
  } catch (err) {
    toast(err.noRoute ? "The app needs a restart to show the campus." : err.message, 8000);
    return;
  }
  build();
  hud();
  // Refresh an open panel, unless you're typing in it. What you'd opened inside it stays open (the owner 2026-11-09:
  // "having a sub window open closes after a short time"): the scroll position, open sections, results you were reading.
  const pe = document.getElementById("panel");
  if (openRoom && !pe.contains(document.activeElement)) {
    const keep = { room: openRoom, top: pe.scrollTop, open: [...pe.querySelectorAll("details[open] > summary")].map((s) => s.textContent) };
    panel(openRoom);
    if (openRoom !== keep.room) return;
    pe.querySelectorAll("details > summary").forEach((s) => { if (keep.open.includes(s.textContent)) s.parentElement.open = true; });
    if (typeof reopenOutputs === "function") reopenOutputs(pe);
    pe.scrollTop = keep.top;
  }
}

// ---------- world layout (tile units) ----------
const TW = 64, TH = 32; // one floor tile on screen
// Layout (tiles). Each office is sized to its staff: desks in tidy rows of 3 (4 in big offices), 1.9 tiles apart
// side to side and 2.1 front to back, with the lead's desk up front by the door on a gold rug. Offices sit in a
// grid of avenues: every column is as wide as its widest office and every row as deep as its deepest, and each
// office is centred in its plot, so the streets line up. Running offices come first (biggest first), HR sits
// beside the biggest, and paused offices go down the Underground.
const DESK_DX = 1.9, DESK_DY = 2.1, STREET = 3;
let rooms = []; // { id, name, gx, gy, x, y, hue, desks:[], bots:[], spend, sub, cap, busy, isHr }
// Who works inside the CEO tower rather than in a building of their own: the owner's Home-district projects, and (the owner
// 2026-11-14: "yes to move HR and finance") HR and Finance, the owner's own staff. Order up the tower: HR, Finance,
// then the Home projects.
const inCeoTower = (p) => p.district === "Home" || p.isHr || p.id === "finance";
const ceoOrder = (p) => (p.isHr ? 0 : p.id === "finance" ? 1 : 2);
const bots = new Map(); // desk id -> bot state, kept between refreshes so they don't jump

function hueOf(id) { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }

// Two views. Campus: every project is a building (one floor per work stream, set by each desk's "floor" on the
// Agents page), with lit windows on floors where someone is working. Inside a building (tap it): the floors are
// drawn as a cutaway stack, each a full office with its lead's glass corner office and a meeting table.
const FLOOR_H = 1.5;
// Each floor is laid out as an office (the owner, 2026-11-09: "still just 1 room vs an office set up"), in tiles
// from the left: the service strip (elevator, restrooms, kitchenette, reception) | the corridor | the open plan.
// Across the front of the open plan: a glass meeting room (door on the corridor), a phone booth if there's room,
// and the floor lead's private office.
const SERV = 1.9, CORR = 0.9, FRONT = 2.8;
// A lounge wing at the back right of every office floor (visual rehaul 2026-11-13: more rooms): desks centre in the rest.
const LOUNGE_W = 2.8;
const CORE_W = SERV + CORR;
let projects = [];
let view = null; // null = campus, otherwise the project id whose building is open
try { view = decodeURIComponent(location.hash.slice(1)) || null; } catch {}

function build() {
  const list = data.rooms;
  const now = Date.now();
  const deskSpend = Object.fromEntries(data.desks.map((d) => [d.id, d]));
  assignNames(data.desks.filter((d) => d.status !== "retired"));
  projects = list.map((r) => {
    // A worker on loan sits in the borrowing project's building (ground floor, a visitor desk) until the loan ends.
    const loanOf = Object.fromEntries((data.loans || []).map((l) => [l.desk, l]));
    const desks = [...data.desks.filter((d) => d.room === r.id && d.status !== "retired" && !loanOf[d.id]),
      ...data.desks.filter((d) => loanOf[d.id]?.toRoom === r.id).map((d) => ({ ...d, room: r.id, homeRoom: d.room, floor: null, side: null, lead: false, onLoan: loanOf[d.id] }))];
    // Agents that posted without a desk still get a stool in their room, so their work shows.
    const feedHere = data.feed.filter((f) => f.room === r.id);
    const strays = [...new Set(feedHere.filter((f) => f.kind === "agent event" && f.desk && !deskSpend[f.desk]).map((f) => f.desk))].map((id) => ({ id, room: r.id, role: "Not on the roster yet", provider: feedHere.find((f) => f.desk === id)?.provider || "other", status: "active", stray: true, monthUsd: 0, monthSubUsd: 0 }));
    const all = [...desks, ...strays];
    // Its own workers out on loan: not drawn here, but listed in its panel so the room doesn't look empty.
    const away = data.desks.filter((d) => d.room === r.id && d.status !== "retired" && loanOf[d.id]).map((d) => ({ ...d, onLoan: loanOf[d.id] }));
    const lastByDesk = {};
    for (const f of feedHere) if (f.kind === "agent event" && !lastByDesk[f.desk]) lastByDesk[f.desk] = f;
    const isBusy = (x) => lastByDesk[x.id] && now - Date.parse(lastByDesk[x.id].startedAt) < ACTIVE_MS;
    // Paused projects wait in the Underground (layoutBC) until they're started again.
    const paused = r.status === "paused" && r.id !== "hr";
    const p = { id: r.id, name: r.name, district: r.district || "Tools", paused, hue: hueOf(r.id), desks: all, away, isHr: r.id === "hr", link: r.link || null, feed: feedHere, lastByDesk, ...roomMoney([...all.filter((x) => !x.onLoan), ...away]) }; // a lent worker still costs its own project
    p.fresh = feedHere.some((f) => Date.parse(f.startedAt) > lastSeen);
    p.busy = all.some(isBusy);
    // Floors: the lead's floor is the ground floor, then the rest biggest first. Desks with no floor (and strays)
    // go on the ground floor.
    const named = [...new Set(all.map((x) => x.side).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    p.sides = named.length ? [...named, ...(all.some((x) => !x.side && !x.lead) ? ["Shared"] : [])] : null;
    const names = [...new Set(all.map((x) => x.floor).filter(Boolean))];
    const leadDesk = all.find((x) => x.lead);
    const ground = leadDesk?.floor || names.sort((a, b) => all.filter((x) => x.floor === b).length - all.filter((x) => x.floor === a).length)[0] || "Main floor";
    const order = [ground, ...names.filter((n) => n !== ground).sort((a, b) => all.filter((x) => x.floor === b).length - all.filter((x) => x.floor === a).length || a.localeCompare(b))];
    p.floors = order.map((name, k) => {
      const fd = all.filter((x) => (x.floor && order.includes(x.floor) ? x.floor : ground) === name);
      // The floor's lead sits in the glass corner office: the project lead, or else the floor's first desk.
      const lead = fd.find((x) => x.lead) || fd[0] || null;
      let staff = fd.filter((x) => x !== lead);
      // Sides (e.g. one per YouTube channel): each floor's open plan is split into a block per side, the same
      // order on every floor, with the shared desks (no side) in their own block at the end.
      let groups = null;
      if (p.sides) {
        groups = p.sides.map((name) => ({ name, staff: staff.filter((x) => (x.side || "Shared") === name) }));
        staff = groups.flatMap((g) => g.staff);
        let k0 = 0; for (const g of groups) { g.start = k0; k0 += g.staff.length; }
      }
      const feed = feedHere.filter((f) => fd.some((x) => x.id === f.desk));
      const awayHere = away.filter((x) => (x.floor && order.includes(x.floor) ? x.floor : ground) === name);
      return { id: `${r.id}::${k}`, k, groups, floorName: name, name: order.length > 1 ? name : r.name, project: p, desks: fd, away: awayHere, lead, staff, hue: (p.hue + k * 23) % 360, isHr: p.isHr, link: null, feed, lastByDesk, busy: fd.some(isBusy), working: fd.filter((x) => x.status === "active").length, fresh: feed.some((f) => Date.parse(f.startedAt) > lastSeen), ...roomMoney([...fd.filter((x) => !x.onLoan), ...awayHere]) };
    });
    // The building's footprint grows a little with the team; its height is one storey per floor.
    p.w = p.d = all.length >= 8 ? 6.5 : all.length >= 3 ? 5.5 : 4.6;
    p.h = p.floors.length * FLOOR_H;
    return p;
  });
  if (view && String(view).startsWith("tower-") && !cityTowers.some((t) => t.id === view)) setView(null, true);
  if (view && isResView(view) && !resLayout().towers.some((t) => t.id === view)) setView(null, true); // a Residences tower that has gone
  if (view && view !== "control" && !isResView(view) && !String(view).startsWith("house:") && !String(view).startsWith("tower-") && !projects.some((p) => p.id === view && !p.paused)) setView(null, true);
  if (view && String(view).startsWith("house:") && !data.desks.some((d) => `house:${d.id}` === view)) setView(null, true);
  if (view) {
    rooms = view === "control" ? ceoFloors() : isResView(view) ? resFloors(view) : String(view).startsWith("tower-") ? towerFloors(view) : String(view).startsWith("house:") ? houseFloor() : projects.find((p) => p.id === view).floors;
    if (isResView(view)) layoutResFloors(); else layoutFloors(); // a Residences tower: its floors of flats (city.js)
    // a house is one cosy room, not an office floor; a Residences home is bigger the higher its level
    // (the sizes lane, 2026-11-16: a Residences home's room, past its 1-tile corridor, has the floor area of the one size
    // table, homes.js: a Basic 5.4 x 3.6 as before, Comfy x1.67, Nice and each penthouse storey x2.5; was 5.4/6/7/8 wide)
    if (rooms[0]?.house) { const lv = rooms[0].level, L = lv == null ? null : campusHomes.LEVELS[lv], D = L ? [4.6, 5, 5.6, 5.6][lv] : 5; Object.assign(rooms[0], L ? { w: Math.round(((5.4 * 3.6 * L.slots) / campusHomes.LEVELS[0].slots / (D - 1)) * 10) / 10, d: D } : { w: 6, d: 5 }); }
  } else {
    // The owner's own projects (district "Home"), HR and Finance live in the CEO tower (inCeoTower), not on the avenues.
    const homeProjects = projects.filter((p) => inCeoTower(p) && !p.paused).sort((a, b) => ceoOrder(a) - ceoOrder(b));
    rooms = projects.filter((p) => !inCeoTower(p) || (p.paused && !p.isHr));
    const linked = projects.filter((p) => !p.isHr && p.link?.linked).length, total = projects.filter((p) => !p.isHr).length;
    // The civic buildings (CEO tower, Mart and Leisure) are placed by layout() with the districts.
    const blank = { x: 0, y: 0, desks: [], floors: [], feed: [], lastByDesk: {}, spend: 0, sub: 0, cap: null, district: "Square" };
    // The CEO tower: the Control Center on the ground floor, then the owner's own projects (Home district: Cards,
    // Gaming) one floor each, and the pet's office on top. Its staff count as the tower's people.
    const towerFloors = [{ name: "Control Center", busy: inbox.length > 0 }, ...homeProjects.map((p) => ({ name: p.name, project: p, busy: p.busy })), { name: "Board room", busy: meetingLive() }, { name: `${PET() || "Pet"}'s office`, pet: true }];
    rooms = [...rooms,
      { ...blank, id: "control", name: "CEO tower", isControl: true, w: 6, d: 6, h: 3.2, hue: 210, desks: homeProjects.flatMap((p) => p.desks), floors: towerFloors, homeProjects, lastByDesk: Object.assign({}, ...homeProjects.map((p) => p.lastByDesk)), linked, total },
      // The campus store (the owner, 2026-11-09): where workers spend their campus credits.
      // (only with campus life on)
      ...(modOn("campuslife") ? [{ ...blank, id: "store", name: "Campus Mart", isStore: true, w: 3.6, d: 3, h: 1.4, hue: 330 }] : []),
      // The Leisure building: shows and manga (reading). No staff. Only when that part is on.
      ...(modOn("reading") ? [{ ...blank, id: "leisure", name: "Leisure", isLeisure: true, w: 5, d: 4.5, h: 1.5, hue: 28, floors: [{ busy: false, working: 1 }] }] : []),
    ];
    // The little city (the owner, 2026-11-09): a house for every worker (now flats in the Residences), beside the campus.
    const homesEtc = layoutCity(); // (lays out the city first: it replaces rooms)
    rooms = [...rooms, ...homesEtc];
  }
  // Bots only inside a building; on the campus you see the lit windows instead.
  const seated = new Set();
  if (view) for (const room of rooms) {
    room.desks.forEach((x) => seated.add(x.id));
    const seats = [...(room.lead ? [[room.lead, leadPos(room)]] : []), ...room.staff.map((x, k) => [x, deskPos(room, k)])];
    for (const [dk, desk] of seats) {
      const last = room.lastByDesk[dk.id];
      let b = bots.get(dk.id);
      if (!b) { b = { x: desk.x, y: desk.y, tx: desk.x, ty: desk.y, wait: Math.random() * 4 }; bots.set(dk.id, b); }
      // An office that moved (new layout) takes its bots with it.
      if (b.desk && (Math.abs(b.desk.x - desk.x) > 0.01 || Math.abs(b.desk.y - desk.y) > 0.01)) Object.assign(b, { x: desk.x, y: desk.y, tx: desk.x, ty: desk.y });
      Object.assign(b, { desk, d: dk, room, active: !!last && now - Date.parse(last.startedAt) < ACTIVE_MS, last });
    }
  }
  for (const id of [...bots.keys()]) if (!seated.has(id)) bots.delete(id);
  // The HR inbox: requests waiting for HR or for the owner (worked out before the walkers, who queue on it).
  inbox = data.requests.filter((q) => !q.decision && (q.kind !== "borrow" || !q.ownerLead || Date.now() - Date.parse(q.at) > 3 * 3600e3));
  syncWalkers();
  // Jobs the owner gave each desk that are still open.
  jobsByDesk = {};
  for (const j of data.jobs || []) if (j.status === "queued" || j.status === "taken") (jobsByDesk[j.desk] ??= []).push(j);
  // Tell the 3D view (when it's on) that the model changed.
  window.dispatchEvent(new CustomEvent("campus:built"));
}
let inbox = [], jobsByDesk = {};
// Inside a worker's house: one room with what they've bought (3D; 2D lifts the roof instead).
function houseFloor() {
  const d = data.desks.find((x) => `house:${x.id}` === view), hue = hueOf(d.room), nm = (typeof homeOf === "function" && homeOf(d.id)?.name) || `${nameOf(d)}'s house`; // a flat in the Residences now
  const hm = typeof homeOf === "function" && (homeOf(d.id) || (typeof cityHomeRecord === "function" && (resLayout(), cityHomeRecord(d.id)))); // its level (Basic ... Penthouse)
  return [{ id: view, k: 0, groups: null, floorName: hm ? `${nm} · ${hm.levelName}` : nm, name: hm ? `${nm} · ${hm.levelName}` : nm, level: hm ? hm.level : null, project: { id: "house", name: "House", district: "Home", floors: [], hue }, desks: [], lead: null, staff: [], hue, house: true, desk: d, isHr: false, link: null, feed: [], lastByDesk: {}, busy: false, working: 0, fresh: false, spend: 0, sub: 0, cap: null }];
}
// Inside the CEO tower (the owner 2026-11-09, interiors.md section 4): the Control Center on the ground floor, then each of
// the owner's own projects (district Home: Cards, Gaming) with its real desks, and the pet's penthouse on top. The project
// floors are the projects' own floor objects (so their panels work); the Control Center and the penthouse have none.
function ceoFloors() {
  const home = projects.filter((p) => inCeoTower(p) && !p.paused).sort((a, b) => ceoOrder(a) - ceoOrder(b));
  const blank = (id, name, hue, extra) => ({ id, k: 0, groups: null, floorName: name, name, project: { id: id === "control::cc" ? "control" : id.replace("control::", ""), name, district: "Home", floors: [], hue }, desks: [], lead: null, staff: [], hue, isHr: false, link: null, feed: [], lastByDesk: {}, busy: false, working: 0, fresh: false, spend: 0, sub: 0, cap: null, ...extra });
  const floors = [blank("control::cc", "Control Center", 210, { busy: inbox.length > 0 })];
  for (const p of home) for (const f of p.floors) floors.push(Object.assign(Object.create(Object.getPrototypeOf(f)), f, { floorName: p.floors.length > 1 ? `${p.name} · ${f.floorName}` : p.name }));
  // The board room (the owner 2026-11-09): the board meeting, Mon/Wed/Fri 9:00, the pet at the head of the table.
  floors.push(blank("control::board", "Board room", 280, { board: true, busy: meetingLive() }));
  if (hasPet()) floors.push(blank("control::pet", `${PET()}'s penthouse`, 40, { pet: true }));
  floors.forEach((f, k) => (f.k = k));
  return floors;
}
// Inside a district tower (the owner 2026-11-09: "some of the towers aren't floors together, they act like solo
// buildings"): every member project's floors stacked in one building, ground floor first, like the CEO tower. Each
// floor is the project's own floor object, so its panel, desks and jobs work as usual.
function towerFloors(id) {
  const t = cityTowers.find((x) => x.id === id), out = [];
  for (const pid of t?.members || []) { const p = projects.find((x) => x.id === pid); if (!p) continue; for (const f of p.floors) out.push(Object.assign(Object.create(Object.getPrototypeOf(f)), f, { floorName: p.floors.length > 1 ? `${p.name} · ${f.floorName}` : p.name, name: p.name })); }
  out.forEach((f, k) => (f.k = k));
  return out;
}
function roomMoney(list) {
  const caps = list.filter((d) => d.capUsdMonth != null);
  return { spend: list.reduce((a, d) => a + (d.monthUsd || 0), 0), sub: list.reduce((a, d) => a + (d.monthSubUsd || 0), 0), cap: caps.length ? caps.reduce((a, d) => a + d.capUsdMonth, 0) : null };
}
// This month's API money and subscription use over every desk plus spend from desks not on the roster yet (same sums as the HUD and the Agents page).
function monthTotals() { const un = Object.values(data?.unassignedMonth || {}); const sum = (xs, k) => xs.reduce((a, x) => a + (x[k] || 0), 0); return { api: sum(data?.desks || [], "monthUsd") + sum(un, "usd"), sub: sum(data?.desks || [], "monthSubUsd") + sum(un, "subUsd") }; }

// Floors inside a building: all the same size (so they stack like a building), each raised above the last
// far enough that the floor below shows in full.
function layoutFloors() {
  const most = Math.max(1, ...rooms.map((f) => f.staff.length));
  const sides = rooms[0]?.groups?.length || 0;
  const cols = most > 9 ? 4 : 3;
  // With sides, each side's block is 2 desks wide and the rows are as deep as the fullest block.
  const rowsN = sides ? Math.max(1, ...rooms.flatMap((f) => (f.groups || []).map((g) => Math.ceil(g.staff.length / SIDE_COLS)))) : Math.ceil(most / cols);
  const w = CORE_W + (sides ? Math.max(6.2, 1.4 + sides * SIDE_COLS * DESK_DX + (sides - 1) * SIDE_GAP) : Math.max(6.2, 1.4 + Math.min(cols, most) * DESK_DX));
  const d = Math.max(8.4, 1.5 + (rowsN - 1) * DESK_DY + 1.3 + FRONT);
  const zStep = (w + d) / 2 + 3.0;
  const lounge = rooms[0]?.house ? 0 : LOUNGE_W;
  rooms.forEach((f) => Object.assign(f, { x: 0, y: 0, w: w + lounge, d, cols, coreW: CORE_W, lounge, z: f.k * zStep }));
  campus = { w, d, colX: [0], rowY: [0], colW: [w], rowD: [d], top: (rooms.length - 1) * zStep };
}

// Staff desks: rows from the back wall forward, each row centred across the office.
const SIDE_COLS = 2, SIDE_GAP = 0.9;
// The block a side takes up across the open plan: [left x, right x].
function sideSpan(room, g) {
  const n = room.groups.length, cw = room.coreW || 0, bw = SIDE_COLS * DESK_DX;
  const left = room.x + cw + (room.w - (room.lounge || 0) - cw - (n * bw + (n - 1) * SIDE_GAP)) / 2 + g * (bw + SIDE_GAP);
  return [left, left + bw];
}
function deskPos(room, k) {
  if (view && room.groups) {
    const g = room.groups.findIndex((x) => k >= x.start && k < x.start + x.staff.length), i = k - room.groups[g].start;
    const row = Math.floor(i / SIDE_COLS), col = i % SIDE_COLS, inRow = Math.min(SIDE_COLS, room.groups[g].staff.length - row * SIDE_COLS);
    const [l, r] = sideSpan(room, g), left = (l + r) / 2 - ((inRow - 1) * DESK_DX) / 2;
    return { x: left + col * DESK_DX, y: room.y + 1.5 + row * DESK_DY };
  }
  const row = Math.floor(k / room.cols), col = k % room.cols;
  const inRow = Math.min(room.cols, room.staff.length - row * room.cols);
  const cw = room.coreW || 0;
  const left = room.x + cw + (room.w - (room.lounge || 0) - cw - (inRow - 1) * DESK_DX) / 2;
  return { x: left + col * DESK_DX, y: room.y + 1.5 + row * DESK_DY };
}
// The first and last desk of each row of staff desks (one block per side on floors with sides), for the cubicle screens.
function deskRows(r) {
  const out = [];
  const blocks = view && r.groups ? r.groups.map((g) => ({ start: g.start, n: g.staff.length, cols: SIDE_COLS })) : [{ start: 0, n: r.staff.length, cols: r.cols }];
  for (const bl of blocks) for (let row = 0; row < Math.ceil(bl.n / bl.cols); row++) {
    const k = bl.start + row * bl.cols, inRow = Math.min(bl.cols, bl.n - row * bl.cols);
    out.push({ first: deskPos(r, k), last: deskPos(r, k + inRow - 1) });
  }
  return out;
}
// The floor lead's desk: in the glass corner office at the front right.
function leadPos(room) {
  return view ? { x: room.x + room.w - 1.3, y: room.y + room.d - 1.25 } : { x: room.x + room.w - 1.5, y: room.y + room.d - 1.5 };
}
// Rooms on a floor, in world tiles.
function plan(r) {
  const M = r.x + CORE_W, front = r.y + r.d - FRONT, mw = Math.min(3.2, r.x + r.w - 2.7 - M - 0.2);
  return {
    corrX: r.x + SERV + CORR / 2, M, front,
    meeting: { x: M, y: front, w: mw, d: FRONT, door: [r.x + SERV + CORR / 2, front + 0.8] },
    office: { x: r.x + r.w - 2.6, y: front, w: 2.6, d: FRONT },
    kitchen: { x: r.x, y: r.y + 3.6, w: SERV, d: front - (r.y + 3.6), door: [r.x + SERV + CORR / 2, r.y + 4.3], coffee: [r.x + 0.9, r.y + 4.4] },
    wc: { x: r.x, y: r.y + 2.1, w: SERV, d: 1.5 },
    booth: M + mw + 0.25 < r.x + r.w - 2.6 - 0.75 ? { x: M + mw + 0.25, y: front + 0.4 } : null,
    lounge: r.lounge ? { x: r.x + r.w - r.lounge, y: r.y + 0.15, w: r.lounge, d: front - r.y - 0.35 } : null,
  };
}
// The meeting table: front left, when the floor has a few people.
function tablePos(room) {
  if (!view) return null;
  const m = plan(room).meeting;
  return { x: m.x + m.w / 2, y: m.y + m.d / 2 + 0.1 };
}
const SQUARE = STREET + 5; // the central avenues are wide enough for the square and its fountain
// the district towers of the last city layout (campus is replaced by the floor layout while you're inside a building)
let cityTowers = [];
// Which city (the owner 2026-11-16 picked "Quad and wings"; docs/design/campus-layout/review.md): "quad" (the default for
// everyone, the kit too) or "streets" (the street city by the river, kept as a choice). ?layout= in the address is for
// this visit only (never saved, like ?view=neural); then this device's pick (the Layout picker, boot.js), then the hub's
// setting (layout in the settings files, src/hub/settings.js), then quad.
const LAYOUTS = ["quad", "streets"];
function layoutChoice() {
  let q = null, dev = null;
  try { q = new URLSearchParams(location.search).get("layout"); } catch {}
  try { dev = localStorage.getItem("campus.layout"); } catch {}
  return [q, dev, HUB.layout].map((v) => String(v || "").toLowerCase()).find((v) => LAYOUTS.includes(v)) || "quad";
}
let layoutWarned = false;
// what the last city layout built ("quad" or "bc"); null before the first (then layoutChoice() says)
let cityPlan = null;
function layout() {
  if (layoutChoice() === "quad") {
    const keep = rooms.slice();
    cityPlan = "quad";
    try { layoutQuad(); }
    catch (err) {
      // never a blank campus: the street city instead, one warning
      if (!layoutWarned) { console.warn("The quad layout didn't build, showing the street city instead:", err); layoutWarned = true; }
      rooms = keep; cityPlan = "bc"; layoutBC();
    }
  } else { cityPlan = "bc"; layoutBC(); }
  cityTowers = campus.towers || [];
}
// The layout, then the homes (cityHouses, city.js). If the quad's homes fail, the whole city falls back to streets.
function layoutCity() {
  const keep = rooms.slice();
  layout();
  try { return cityHouses(); }
  catch (err) {
    if (campus.plan !== "quad") throw err;
    if (!layoutWarned) { console.warn("The quad layout's homes didn't build, showing the street city instead:", err); layoutWarned = true; }
    rooms = keep; cityPlan = "bc"; layoutBC(); cityTowers = campus.towers || [];
    return cityHouses();
  }
}
// District towers (plan step 1, 2026-11-16): small projects share a tower, a floor each, by the capped rules in
// model/towers.js (6 floors at most, then a second tower; a project stays in its tower until 4 desks or 2 floors).
// Both layouts use it. byD: district name -> its rooms; replaced in place by the rooms not stacked plus the tower slots.
let towerMemo = new Set();
function districtTowers(byD, big) {
  const towers = [], was = towerMemo, now = new Set();
  for (const dn of Object.keys(byD)) {
    const cand = byD[dn].filter((r) => r.id !== "hub"); // the hub keeps its own building
    const { towers: ts } = campusTowers.stackTowers(cand.map((r) => ({ id: r.id, desks: r.desks, floors: r.floors, paused: false, district: dn, _r: r })), { prev: [...was] });
    ts.forEach((t, n) => {
      const small = t.members.map((m) => m._r).sort(big);
      const slot = { towerSlot: true, members: small, w: 5.5, d: 5.5, desks: small.flatMap((r) => r.desks), name: n ? `${dn} tower ${n + 1}` : `${dn} tower`, district: dn, dname: dn, tid: n ? `tower-${dn.toLowerCase()}-${n + 1}` : `tower-${dn.toLowerCase()}` };
      byD[dn] = [...byD[dn].filter((r) => !small.includes(r)), slot]; towers.push(slot);
      small.forEach((r) => now.add(r.id));
    });
  }
  towerMemo = now;
  return towers;
}
// A tower slot's members: each its own part of the tower's footprint (their tap targets), as before.
function placeTowerMembers(t, withFace = false) {
  const n = t.members.length, cols = n > 4 ? 3 : 2, rowsN = Math.ceil(n / cols), cw = (t.w - 0.3 * (cols - 1)) / cols, ch = (t.d - 0.3 * (rowsN - 1)) / rowsN;
  t.id = t.tid;
  t.members.forEach((r, k) => {
    Object.assign(r, { gx: t.gx, gy: t.gy, x: t.x + (k % cols) * (cw + 0.3), y: t.y + Math.floor(k / cols) * (ch + 0.3), w: cw, d: ch, ...(withFace ? { face: t.face } : {}) });
    r.tower = { id: t.id, name: t.name, x: t.x, y: t.y, w: t.w, d: t.d, k, members: t.members };
  });
}

// Plan B, "Quad and wings" (the owner 2026-11-16): one connected campus round a central quad. The rules are
// model/quad.js (campusQuad.plan); this feeds it the rooms and turns its answer into the same `campus` shape the 2D and
// 3D views draw (roads, square, clock, districts, towers, nextLots, river), plus the quad's own parts: the concourse
// (roofed walks), the wings and their signs, skybridges, the garden and the long Residences block's places.
let quadSidesMemo = null;
function layoutQuad() {
  const civic = { HR: rooms.find((r) => r.isHr && !r.paused), store: rooms.find((r) => r.isStore), tower: rooms.find((r) => r.isControl), leisure: rooms.find((r) => r.isLeisure) };
  const paused = rooms.filter((r) => r.paused && !r.isHr);
  const work = rooms.filter((r) => !r.paused && !r.isHomes && !r.isGarden && !Object.values(civic).includes(r));
  const big = (a, b) => b.desks.length - a.desks.length || a.name.localeCompare(b.name);
  const byD = { Creative: [], Games: [], Tools: [] };
  for (const r of work) { r.dname = ["Creative", "Games"].includes(r.district) ? r.district : "Tools"; r.gx = null; r.gy = null; byD[r.dname].push(r); }
  const towers = districtTowers(byD, big);
  for (const dn in byD) byD[dn].sort(big);
  const lotOf = (r) => ({ id: r.towerSlot ? r.tid : r.id, w: r.w, d: r.d, floors: r.towerSlot ? r.members.length : (r.floors?.length || 1), desks: r.desks.filter((x) => !x.stray && !x.onLoan).length }); // (roster desks only: a stray or a visitor never moves a wing)
  const garden = typeof gardenNeed === "function" ? gardenNeed() : null;
  const homes = typeof resBlockSize === "function" ? resBlockSize() : null;
  const p = campusQuad.plan({
    wings: Object.entries(byD).map(([name, list]) => ({ name, lots: list.map(lotOf) })),
    ceo: civic.tower ? { id: civic.tower.id, w: civic.tower.w, d: civic.tower.d } : null,
    west: [civic.leisure, civic.HR].filter(Boolean).map((r) => ({ id: r.id, w: r.w, d: r.d })),
    east: civic.store ? [{ id: civic.store.id, w: civic.store.w, d: civic.store.d }] : [],
    garden, homes, ug: { w: 2.2, d: 1.6 }, prevSides: quadSidesMemo,
  });
  quadSidesMemo = p.sides; // (a district keeps its side next time)
  const at = (r, id) => { const q = p.place[id]; if (!q) throw new Error(`quad layout: ${id} has no place`); r.x = q.x; r.y = q.y; r.face = q.face; };
  for (const r of [civic.tower, civic.leisure, civic.HR, civic.store].filter(Boolean)) { at(r, r.id); r.gx = null; }
  for (const dn in byD) for (const r of byD[dn]) { at(r, r.towerSlot ? r.tid : r.id); r.gx = null; }
  towers.forEach((t) => placeTowerMembers(t, true));
  const ugB = p.underground;
  const ug = { id: "underground", name: "Underground", isUnderground: true, x: ugB.x, y: ugB.y, w: ugB.w, d: ugB.d, h: 0.5, hue: 45, desks: [], floors: [], feed: [], lastByDesk: {}, spend: 0, sub: 0, cap: null, district: "Square", paused: false, sleepers: paused };
  rooms = [...rooms.filter((r) => !paused.includes(r)), ug];
  // the quad's paving and the concourse are walkable ground, drawn under everything (both views read campus.roads)
  const Q = p.quad;
  const roads = [...p.roads, { x: Q.x0, y: Q.y0, w: Q.x1 - Q.x0, d: Q.y1 - Q.y0, kind: "quad" }, ...p.concourse.map((c) => ({ x: c.x, y: c.y, w: c.w, d: c.d, kind: "concourse", part: c.part }))];
  const river = { ...p.river };
  campus = { plan: "quad", w: p.w, d: p.d, colX: [], rowY: [], colW: [], rowD: [], gapX: [], gapY: [], wing: null, square: p.square, clock: p.clock, roads, river, bridges: [],
    home: { y: river.y + river.d + 0.6, x0: p.ring.x0, x1: p.ring.x1, cx: (Q.x0 + Q.x1) / 2 }, underground: paused,
    quad: Q, lawn: p.lawn, concourse: p.concourse, skybridges: p.skybridges, wings: p.wings, ring: p.ring, gardenBox: p.garden, gardenZone: p.gardenZone, homesBox: p.homes, walk: p.walk,
    sharedBox: p.shared, breakBox: p.breakGarden, // the gardens lane: the community garden's shared half, the break garden by the wings (city.js makes their rooms)
    towers: towers.map((t) => ({ id: t.id, name: t.name, x: t.x, y: t.y, w: t.w, d: t.d, members: t.members.map((r) => r.id) })),
    // a district is its wing (one sign per row it stands in, so a district on two rows is named on both)
    districts: p.wings.map((wg) => ({ name: wg.name, label: `${wg.name} wing`, x0: wg.x0 - 0.3, y0: wg.y0 - 0.3, x1: wg.x1 + 0.3, y1: wg.y1 + 0.3, pad: null, side: wg.side, row: wg.row })),
    nextLots: p.nextLots.map((n) => ({ district: n.district, x: n.x, y: n.y, w: n.w, d: n.d })) };
}
// Plan B+C. Main street (the wide avenue) runs north to south down the work side: the CEO tower stands at its head
// by HR and the Mart, the plaza with the fountain opens just below, then the Creative district (west) and the Games
// district (east) line the street, then Tools, then the growth lots. South of
// the last street the river crosses the map; three bridges lead to the home side, where the village loops round its
// green (cityHouses in city.js), with Leisure by the river to the east.
// Paused projects go down the Underground stairs on the plaza instead of taking a lot. Nothing is placed by hand.
const RIVER = 3.6;
function layoutBC() {
  const civic = { HR: rooms.find((r) => r.isHr && !r.paused), store: rooms.find((r) => r.isStore), tower: rooms.find((r) => r.isControl), leisure: rooms.find((r) => r.isLeisure), homes: rooms.find((r) => r.isHomes) };
  const paused = rooms.filter((r) => r.paused && !r.isHr);
  const work = rooms.filter((r) => !r.paused && !r.isHomes && !Object.values(civic).includes(r)); // every Residences tower is civic
  const big = (a, b) => b.desks.length - a.desks.length || a.name.localeCompare(b.name);
  const byD = { Creative: [], Games: [], Tools: [] };
  for (const r of work) { r.dname = ["Creative", "Games"].includes(r.district) ? r.district : "Tools"; byD[r.dname].push(r); }
  // District towers: small projects share a tower, a floor each (districtTowers: the capped rules, 6 floors a tower).
  const towers = districtTowers(byD, big);
  for (const dn in byD) byD[dn].sort(big);
  // Rows: 0 = civic (HR, Mart, [tower in the street]), then Creative|Games two a side, then Tools four across.
  const cells = [];
  // City planner pass (2026-11-13): a balanced civic front, HR west and the Mart east of the CEO tower, both facing the plaza.
  if (civic.HR) cells.push([civic.HR, 1, 0]);
  if (civic.store) cells.push([civic.store, 2, 0]);
  const nCG = Math.max(Math.ceil(byD.Creative.length / 2), Math.ceil(byD.Games.length / 2));
  byD.Creative.forEach((r, i) => cells.push([r, i % 2 ? 0 : 1, 1 + Math.floor(i / 2)]));
  byD.Games.forEach((r, i) => cells.push([r, i % 2 ? 3 : 2, 1 + Math.floor(i / 2)]));
  const t0 = 1 + nCG, TOOL_COLS = [1, 2, 0, 3];
  byD.Tools.forEach((r, i) => cells.push([r, TOOL_COLS[i % 4], t0 + Math.floor(i / 4)]));
  // A growth row only once every lot in the last row is taken (city planner pass): empty lots in a part-full row are the
  // growth lots, so a small campus has no field of empty parks.
  const used = t0 + Math.ceil(byD.Tools.length / 4);
  const full = byD.Tools.length ? byD.Tools.length % 4 === 0 : byD.Creative.length >= 2 * nCG && byD.Games.length >= 2 * nCG;
  const nRows = Math.max(used + (full ? 1 : 0), 2);
  const colW = [4, 4, 4, 4], rowD = Array(nRows).fill(4);
  rowD[0] = Math.max(rowD[0], (civic.tower?.d || 6));
  for (const [r, c, j] of cells) { r.gx = c; r.gy = j; colW[c] = Math.max(colW[c], r.w); rowD[j] = Math.max(rowD[j], r.d); }
  const gapX = colW.map((_, i) => (i === 2 ? SQUARE : STREET)), gapY = rowD.map((_, j) => (j === 1 ? SQUARE + 4 : STREET)); // a deep plaza, so the first row doesn't hide it
  const colX = [0], rowY = [0];
  for (let i = 1; i < 4; i++) colX[i] = colX[i - 1] + colW[i - 1] + gapX[i];
  for (let j = 1; j < nRows; j++) rowY[j] = rowY[j - 1] + rowD[j - 1] + gapY[j];
  for (const [r, c, j] of cells) {
    const tx = j === 0 ? 0.5 : c === 1 ? 1 : c === 2 ? 0 : 0.5, ty = j === 0 ? 1 : 0.5; // hug main street and the plaza (civic lots centred)
    r.x = colX[c] + (colW[c] - r.w) * tx; r.y = rowY[j] + (rowD[j] - r.d) * ty;
    r.face = j === 0 ? "s" : c <= 1 ? "e" : "w"; // entrances face the plaza (civic row) or Main street / the side street
  }
  const W = colX[3] + colW[3], D = rowY.at(-1) + rowD.at(-1);
  const square = { x: colX[2] - SQUARE / 2, y: rowY[1] - gapY[1] / 2, r: SQUARE / 2 + 1 };
  // the CEO tower closes the head of main street, facing down it over the plaza
  if (civic.tower) { civic.tower.gx = null; civic.tower.x = square.x - civic.tower.w / 2; civic.tower.y = rowY[0] + rowD[0] - civic.tower.d; }
  towers.forEach((t) => placeTowerMembers(t));
  // Streets as plain rectangles (both views draw these): the outer ring of the work side, the cross streets, the
  // side streets, and main street from the plaza down to the river (the tower closes its head).
  const roads = [], lane = (i) => colX[i] - gapX[i] / 2, row = (j) => rowY[j] - gapY[j] / 2;
  const top = -STREET, bottom = D + STREET;
  for (const x of [-STREET / 2, lane(1), lane(3), W + STREET / 2]) roads.push({ x: x - STREET / 2, y: top, w: STREET, d: bottom - top, kind: "street" });
  roads.push({ x: lane(2) - SQUARE / 2, y: square.y, w: SQUARE, d: bottom - square.y, kind: "main" });
  for (const y of [-STREET / 2, ...rowY.slice(2).map((_, k) => row(k + 2)), D + STREET / 2]) roads.push({ x: -STREET, y: y - STREET / 2, w: W + STREET * 2, d: STREET, kind: "street" });
  roads.push({ x: -STREET, y: row(1) - gapY[1] / 2, w: W + STREET * 2, d: gapY[1], kind: "plaza-row" });
  // The river and its three bridges (the two side streets and main street carry on across).
  const river = { x0: -STREET - 7, x1: W + STREET + 7, y: bottom + 0.8, d: RIVER };
  const bridges = [{ x: lane(1), w: STREET + 0.4 }, { x: lane(2), w: 5 }, { x: lane(3), w: STREET + 0.4 }].map((b) => ({ ...b, y: river.y - 0.5, d: river.d + 1 }));
  // The home side starts with a riverside path; the village (cityHouses) is laid out below it.
  const home = { y: river.y + river.d + 0.6, x0: -STREET, x1: W + STREET, cx: lane(2) };
  // Underground stairs: a lit entrance on the plaza's south-east edge.
  const ugW = 2.2, ugD = 1.6;
  const ug = { id: "underground", name: "Underground", isUnderground: true, x: square.x - square.r - ugW - 0.6, y: square.y - square.r * 0.55, w: ugW, d: ugD, h: 0.5, hue: 45, desks: [], floors: [], feed: [], lastByDesk: {}, spend: 0, sub: 0, cap: null, district: "Square", paused: false, sleepers: paused };
  rooms = [...rooms.filter((r) => !paused.includes(r)), ug];
  const clock = { x: square.x + square.r + 1.6, y: square.y }; // off the CEO door -> fountain -> Main street axis (city planner pass)
  campus = { plan: "bc", w: W, d: D, colX, rowY, colW, rowD, gapX, gapY, wing: null, square, clock, roads, river, bridges, home, underground: paused,
    towers: towers.map((t) => ({ id: t.id, name: t.name, x: t.x, y: t.y, w: t.w, d: t.d, members: t.members.map((r) => r.id) })),
    // A district is the block of lots its zoning gives it (city planner pass): Creative columns 0-1 and Games 2-3 on the
    // Creative|Games rows, Tools all four columns on its rows. `pad` is the old tight box round its buildings.
    districts: ["Creative", "Games", "Tools"].filter((n) => byD[n].length).map((name) => {
      const L = byD[name], [c0, c1, r0, r1] = name === "Creative" ? [0, 1, 1, nCG] : name === "Games" ? [2, 3, 1, nCG] : [0, 3, t0, t0 + Math.ceil(L.length / 4) - 1];
      const pad = { x0: Math.min(...L.map((r) => r.x)) - 0.9, y0: Math.min(...L.map((r) => r.y)) - 0.9, x1: Math.max(...L.map((r) => r.x + r.w)) + 0.9, y1: Math.max(...L.map((r) => r.y + r.d)) + 0.9 };
      return { name, x0: colX[c0] - 0.3, y0: rowY[r0] - 0.3, x1: colX[c1] + colW[c1] + 0.3, y1: rowY[r1] + rowD[r1] + 0.3, pad, side: name === "Games" ? "E" : "W" };
    }),
    // The next free lot per district, in the zoning order (city planner pass): 3D marks it "Next ... project".
    nextLots: (() => { const taken = new Set(cells.map(([, c, j]) => `${c},${j}`)), out = [];
      const tryLot = (name, order) => { for (const [c, j] of order) if (j < nRows && !taken.has(`${c},${j}`)) { out.push({ district: name, x: colX[c], y: rowY[j], w: colW[c], d: rowD[j] }); return; } };
      tryLot("Creative", Array.from({ length: nCG }, (_, k) => [[1, 1 + k], [0, 1 + k]]).flat());
      tryLot("Games", Array.from({ length: nCG }, (_, k) => [[2, 1 + k], [3, 1 + k]]).flat());
      tryLot("Tools", Array.from({ length: nRows - t0 }, (_, k) => TOOL_COLS.map((c) => [c, t0 + k])).flat());
      return out; })() };
  if (civic.leisure) { civic.leisure.gx = null; } // placed on the home side by cityHouses
}
// The middle of the street before column i / row j (walkers, lamps and the 3D streets use these).
const laneX = (i) => campus.colX[i] - (campus.gapX?.[i] ?? STREET) / 2;
const laneY = (j) => campus.rowY[j] - (campus.gapY?.[j] ?? STREET) / 2;
let campus = { w: 0, d: 0, colX: [], rowY: [], colW: [], rowD: [] };

// ---------- camera ----------
const cv = document.getElementById("c");
const ctx = cv.getContext("2d");
let W = 0, H = 0, DPR = 1;
const cam = { x: 0, y: 0, z: 1 };
let fitted = false;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = cv.clientWidth; H = cv.clientHeight;
  // Setting a canvas's size wipes it, even to the same size: only do it when the size really changed (no flicker
  // while the side panel is dragged wider).
  if (cv.width !== W * DPR || cv.height !== H * DPR) { cv.width = W * DPR; cv.height = H * DPR; }
  if (!fitted && rooms.length) fit();
}
function iso(x, y, z = 0) { return [((x - y) * TW) / 2, ((x + y) * TH) / 2 - z * TH]; }
// ZOFF lifts everything drawn while a floor is being drawn, so the same office code draws every storey.
let ZOFF = 0;
function toScreen(x, y, z = 0) { const [a, b] = iso(x, y, z + ZOFF); return [(a - cam.x) * cam.z + W / 2, (b - cam.y) * cam.z + H / 2]; }
function toWorld(sx, sy, z = 0) {
  const a = (sx - W / 2) / cam.z + cam.x, b = (sy - H / 2) / cam.z + cam.y + z * TH;
  return [b / TH + a / TW, b / TH - a / TW];
}
function fit() {
  if (isResView(view) && innerWidth < 700 && typeof resFocus2D === "function" && resBayView()) return resFocus2D(resK2D); // inside the long block on a phone: one bay (city.js)
  let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
  for (const r of rooms) for (const [x, y] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.d], [r.x + r.w, r.y + r.d]]) {
    const z = r.z || 0, top = z + (view ? 1.6 : (r.h || 0) + 1.2);
    const [a, b] = iso(x, y, z), [, bt] = iso(x, y, top);
    minA = Math.min(minA, a); maxA = Math.max(maxA, a); minB = Math.min(minB, bt - TH); maxB = Math.max(maxB, b + 1.4 * TH);
  }
  cam.x = (minA + maxA) / 2; cam.y = (minB + maxB) / 2;
  cam.z = Math.max(0.45, Math.min(1.4, Math.min(W / (maxA - minA + 60), H / (maxB - minB + 60))));
  // Start on the busiest room when the whole campus doesn't fit at a readable size.
  const busy = rooms.find((r) => r.busy);
  if (!view && busy && cam.z <= 0.5) { const [a, b] = iso(busy.x + busy.w / 2, busy.y + busy.d / 2, (busy.h || 0) / 2); cam.x = a; cam.y = b; cam.z = 0.7; }
  fitted = true;
}
