// Campus: the control layer (the owner 2026-11-09, ideas from the grok-bot-3d-campus demo (MIT, github.com/sarbarshem/
// grok-bot-3d-campus), towers.app and the HackerNoon 3D office). Over both the 2D and the 3D campus:
// - Waiting for you: everything that needs the owner, oldest first, with how long it has waited and Approve / Reject / Ask;
//   tick several and send them together.
// - In progress: each worker's current job or latest work, one line each.
// - A live ticker of what just happened, with the full feed one tap away.
// - Filter chips by district and project (counts of who's working, 🚨 where something waits on the owner); the other
//   buildings fade.
// - Search (press /) for a project, worker, title or skill.
// Part of public/campus.html, loaded in order by campus/boot.js; shares one global scope with the other parts.
"use strict";
let campusFilter = null; // null = everyone, { district } or { room }
let ctlWaitRooms = new Set(); // rooms with something waiting on the owner (🚨 on their signs)
let ctlOpen = { wait: null, prog: null }; // null = default for the screen size
const ctlPicked = new Set();
// The open "Ask" box survives the campus's refresh (the owner 2026-11-14: "Ask box auto closes"): which one is open, what's
// typed, and whether it had the cursor, kept here and put back each time the panel is redrawn.
const ctlAsk = { id: null, draft: "", focused: false };
const isNarrow = () => innerWidth < 700;

// Jobs only the owner can start (the owner 2026-11-09: "1 job was waiting on me to hit Run now; that should be in my queue"):
// queued on a desk the hub runs, not already being run by a hand-off or a lead's brief (those start by themselves
// within a minute or two). Over-cap desks show under Problems instead.
function runNowItems() {
  return (data.jobs || []).filter((j) => j.status === "queued" && Date.now() - Date.parse(j.at) > 3 * 60000).map((j) => ({ j, d: data.desks.find((x) => x.id === j.desk) }))
    .filter(({ d }) => d && d.runner === "hub" && d.status === "active" && !(d.capUsdMonth != null && (d.monthUsd || 0) >= d.capUsdMonth))
    .map(({ j, d }) => ({ id: j.id, kind: "run", room: j.room, at: j.at, from: d.id, role: String(j.text || "").split("\n")[0].slice(0, 120), why: `${nameOf(d)} is ready; the hub runs it when you tap Run now${d.capUsdMonth != null ? ` (cap $${d.capUsdMonth}/month, $${(d.monthUsd || 0).toFixed(2)} used)` : ""}.`, desk: d.id }));
}
function waitingItems() {
  return [...(inbox || []).filter((q) => q.status !== "new" || q.kind === "ask"), ...runNowItems()].map((q) => ({ ...q, age: Date.now() - Date.parse(q.at) })).sort((a, b) => b.age - a.age);
}
const roomName = (id) => roomLabel(id, data.rooms.find((r) => r.id === id)?.name);
const roomHue = (id) => `hsl(${hueOf(id)},60%,62%)`;
function waitingRooms() { const s = new Set(); for (const q of waitingItems()) s.add(q.room); return s; }
// Does this room show under the current filter?
function shownByFilter(r) {
  if (!campusFilter) return true;
  if (r.isControl || r.isStore || r.isLeisure || r.isHouse || r.isHomes || r.isGarden || r.isUnderground) return false;
  if (campusFilter.room) return r.id === campusFilter.room || r.project?.id === campusFilter.room;
  return (r.district || r.project?.district) === campusFilter.district;
}

// One plain line for each job (the owner 2026-11-09: "more updated wording on the current step or pass-off; it's confusing
// whether they're just stuck or not"): where it came from, what it's doing or waiting on, what unblocks it, and a
// warning when it looks stuck (queued over a day, or taken with no sign of life for an hour).
function jobWhy(j, d) {
  const age = (t) => ageText(Date.now() - Date.parse(t)), who = (id) => nameOf(data.desks.find((x) => x.id === id) || { id });
  const from = j.prevDesk ? `from ${who(j.prevDesk)}${j.of ? ` (step ${j.step} of ${j.of})` : ""}` : j.by === "chain" ? "hand-off" : "";
  const next = j.then?.length ? `then ${j.then.map(who).join(" → ")}` : "";
  const room = projects.find((p) => p.id === d.room), lastEv = room?.lastByDesk?.[d.id];
  let line, tone = "ok";
  if (j.status === "taken") {
    const quiet = !lastEv || Date.now() - Date.parse(lastEv.startedAt) > 3600e3;
    line = quiet ? `⚠ taken ${age(j.updatedAt || j.at)} ago, no sign of life for over an hour` : `working · last: ${lastEv.action || "update"} ${ago(lastEv.startedAt)}`;
    if (quiet) tone = "warn";
  } else {
    const waited = Date.now() - Date.parse(j.at), stuck = waited > 864e5;
    let wait;
    if (d.status === "paused" || room?.paused) wait = "on hold: its project is paused";
    else if (d.runner === "hub" && d.capUsdMonth != null && (d.monthUsd || 0) >= d.capUsdMonth) { wait = `stuck: used its $${d.capUsdMonth} cap this month`; tone = "warn"; }
    else if (d.runner === "hub") wait = j.prevDesk ? "the hub runs it next (or tap Run now)" : "waiting for Run now (the hub runs this desk)";
    else if (d.runner === "local") wait = `waiting for ${d.app || "its app"} on your PC to pick it up`;
    else if (d.lead && room?.link?.folder) wait = "waiting to start: Work on its own, or open its session";
    else wait = "picks it up next time you open its chat";
    line = `${stuck ? "⚠ " : ""}queued ${age(j.at)} · ${wait}`;
    if (stuck) tone = "warn";
  }
  return { line: [from, line, next].filter(Boolean).join(" · "), tone };
}
function inProgress() {
  const out = [], seen = new Set();
  for (const j of data.jobs || []) {
    if (j.status !== "taken" && j.status !== "queued") continue;
    const d = data.desks.find((x) => x.id === j.desk); if (!d) continue;
    seen.add(d.id);
    out.push({ d, j, text: String(j.task || j.text || "").split("\n")[0].slice(0, 90), status: j.status === "taken" ? "In progress" : "Queued", why: jobWhy(j, d) });
  }
  for (const p of projects) for (const [id, ev] of Object.entries(p.lastByDesk || {})) {
    if (seen.has(id) || Date.now() - Date.parse(ev.startedAt) > ACTIVE_MS) continue;
    const d = data.desks.find((x) => x.id === id); if (!d) continue;
    seen.add(id);
    out.push({ d, text: String(ev.summary || ev.action || "working").slice(0, 90), status: "Working now", why: { line: `${ev.action || "busy"} · ${ago(ev.startedAt)}`, tone: "ok" } });
  }
  return out.filter((x) => !campusFilter || shownByFilter(projects.find((p) => p.id === x.d.room) || {}));
}

function ctlEls() {
  if (document.getElementById("ctlWait")) return;
  const st = document.getElementById("stage");
  const mk = (id, cls) => { const el = document.createElement("div"); el.id = id; el.className = cls; st.appendChild(el); return el; };
  mk("ctlChips", "ctl-chips"); mk("ctlWait", "ctl-card ctl-right"); mk("ctlProg", "ctl-card ctl-left"); mk("ctlTicker", "ctl-ticker"); mk("ctlFind", "ctl-find");
  const hudEl = document.querySelector(".hud");
  const s = document.createElement("input");
  s.id = "ctlSearch"; s.className = "pill"; s.placeholder = "Search ( / )"; s.setAttribute("aria-label", "Search the campus");
  hudEl.appendChild(s);
  s.oninput = () => renderFind();
  s.onkeydown = (e) => { if (e.key === "Escape") { s.value = ""; renderFind(); s.blur(); } if (e.key === "Enter") document.querySelector("#ctlFind [data-go]")?.click(); };
  addEventListener("keydown", (e) => {
    if (e.target.closest?.("input,textarea,select")) return;
    if (e.key === "/") { e.preventDefault(); s.focus(); }
    const n = Number(e.key);
    if (n >= 1 && n <= 9) { const dist = (data.districts || []).filter((x) => x !== "Home")[n - 1]; if (dist) { campusFilter = campusFilter?.district === dist ? null : { district: dist }; renderControl(); } }
    if (e.key === "0") { campusFilter = null; renderControl(); }
  });
}

// Words the search matches for each garden (beyond its name)
const GARDEN_WORDS = { plots: "community garden plots yard allotment", shared: "community garden shared lawn benches pergola vegetable patch veg allotment", break: "break garden park benches picnic table pond lunch rest work garden" };
function renderFind() {
  const q = document.getElementById("ctlSearch").value.trim().toLowerCase(), box = document.getElementById("ctlFind");
  if (!q) { box.style.display = "none"; return; }
  // Each hit says what to open (go) and what to snap the view to: a project id (the building), plus a floor id or a
  // worker id when the target sits inside it (the owner 2026-11-15: picking a result should snap the view to it).
  const hits = [
    ...projects.filter((p) => `${p.name} ${p.id} ${p.district}`.toLowerCase().includes(q)).map((p) => ({ label: p.name, sub: `Building · ${p.district} · ${p.desks.length} desk${p.desks.length === 1 ? "" : "s"}`, go: () => panel(p.id), snap: { pid: p.id } })),
    // the home side: the community garden and the Residences towers, found like buildings (2026-11-16)
    // (and the gardens lane's two: the community garden's shared part, and the break garden by the work wings)
    ...(view ? [] : rooms).filter((r) => (r.isGarden || r.isHomes) && `${r.name} ${GARDEN_WORDS[r.garden] || (r.isGarden ? GARDEN_WORDS.plots : "residences homes flats apartments")}`.toLowerCase().includes(q)).map((r) => ({ label: r.garden === "shared" ? "Shared garden (community garden)" : r.name, sub: r.garden === "shared" ? "Garden · shared by every resident" : r.garden === "break" ? "Garden · benches for a break, by the work wings" : r.isGarden ? `Garden · ${r.plots.length} plot${r.plots.length === 1 ? "" : "s"}` : `Homes · ${r.storeys} floor${r.storeys === 1 ? "" : "s"}`, go: () => panel(r.id), snap: { pid: r.id } })),
    ...projects.flatMap((p) => (p.floors?.length > 1 ? p.floors : []).filter((f) => `${f.floorName || ""} ${f.name || ""}`.toLowerCase().includes(q)).map((f) => ({ label: `${p.name}: ${f.floorName || f.name}`, sub: `Floor ${f.k + 1} of ${p.floors.length}`, go: () => panel(f.id), snap: { pid: p.id, floor: f.id } }))),
    ...data.desks.filter((d) => d.status !== "retired" && `${nameOf(d)} ${titleOf(d)} ${d.id} ${d.role || ""} ${d.provider || ""}`.toLowerCase().includes(q)).map((d) => ({ label: nameOf(d), sub: `Worker · ${titleOf(d)} · ${roomName(d.room)}`, go: () => workerPanel(d), snap: { pid: d.room, desk: d.id } })),
    ...(data.jobs || []).filter((j) => (j.status === "taken" || j.status === "queued") && String(j.task || j.text || "").toLowerCase().includes(q) && data.desks.some((x) => x.id === j.desk)).map((j) => { const d = data.desks.find((x) => x.id === j.desk); return { label: String(j.task || j.text || "").split("\n")[0].slice(0, 60), sub: `Job · ${nameOf(d)} · ${roomName(d.room)}`, go: () => workerPanel(d), snap: { pid: d.room, desk: d.id, job: j.id } }; }),
  ].slice(0, 10);
  box.innerHTML = hits.length ? hits.map((h, i) => `<button class="ctl-hit" data-go="${i}"><b>${esc(h.label)}</b><span>${esc(h.sub)}</span></button>`).join("") : '<div class="ctl-sub">Nothing found.</div>';
  box.style.display = "block";
  box.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => { const h = hits[Number(b.dataset.go)], s = document.getElementById("ctlSearch"); s.value = ""; box.style.display = "none"; s.blur(); ctlSnapPick(h); }));
}

// ---------- search snap: picking a result moves the view to it ----------
// 2D: the camera pans and zooms so the building (or floor) sits in the middle of what the open panel leaves free.
// 3D: the existing glide (campus3d.focus). Neural: the matching worker is picked and its list scrolled into view.
// Then a dashed ring around the spot for about 2 s and a "Found: <name>" toast (a shape and words, not just a colour).
// prefers-reduced-motion: the camera jumps and the ring stays still.
let ctlSnapAnim = 0, ctlRing = null;
const ctlCalm = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
function ctlSnapPick(h) {
  const t = h.snap || {}, three = !!window.campus3dActive && !!window.campus3d, inNeural = typeof neural !== "undefined" && !!neural;
  // Inside some other building: step back out to the campus first (it closes the panel, so open the result after).
  const tw = view && typeof cityTowers !== "undefined" ? cityTowers.find((x) => x.id === view) : null;
  const inside = view && (view === t.pid || tw?.members?.includes(t.pid));
  if (view && !inside && !inNeural && typeof setView === "function") setView(null);
  h.go();
  if (inNeural) { ctlSnapNeural(t); toast(`Found: ${h.label}`, 3000); return; }
  // wait a frame so the panel is open (and 3D has applied its view offset) before measuring what is left of the screen
  requestAnimationFrame(() => {
    const calm = ctlCalm(), where = three ? ctlSnap3d(t, calm) : ctlSnap2d(t, calm);
    toast(`Found: ${h.label}`, 3000);
    if (where) ctlPulse(where, calm);
  });
}
function ctlSnapNeural(t) {
  const n = neural, id = t.desk || (n.web?.nodes || []).find((x) => x.room === t.pid)?.id;
  if (n.mode === "web" && id && n.web?.nodes?.some((x) => x.id === id)) { n.a = id; n.b = null; n.path = null; webState(); webFeed(); }
  else if (n.mode === "tree" && t.job && n.tree && neuralFind(n.tree.root, `job:${t.job}`)) n.sel = `job:${t.job}`;
  document.getElementById("neuralFeed")?.scrollIntoView({ block: "nearest", behavior: ctlCalm() ? "auto" : "smooth" });
}
// Each returns a function that says where the target is on the canvas right now ({ x, y, r } in px), for the ring.
function ctlSnap3d(t, calm) {
  const c = campus3d, id = t.pid;
  if (!c.focus(id, { calm, floor: t.floor, floorOf: t.desk })) return null;
  return () => { const p = c.screenOf(id); return p && !p.behind ? { x: p.x, y: p.y, r: 60 } : null; };
}
function ctlSnap2d(t, calm) {
  const stage = document.getElementById("stage").getBoundingClientRect(), pan = document.getElementById("panel"), open = pan?.classList.contains("open");
  // the part of the canvas the open panel leaves free: a side panel (right) on desktop, a bottom sheet on a phone
  // (sizes, not positions: the panel slides in, so where it is right now is not where it ends up)
  const sheet = open && innerWidth <= 640;
  const freeW = open && !sheet ? Math.max(200, W - pan.offsetWidth) : W, freeH = sheet ? Math.max(200, H - pan.offsetHeight) : H;
  const tw = typeof cityTowers !== "undefined" ? cityTowers.find((x) => x.members?.includes(t.pid)) : null;
  let r;
  if (view) r = rooms.find((x) => x.id === t.floor) || (t.desk && rooms.find((x) => x.desks?.some((d) => d.id === t.desk))) || null;
  else r = rooms.find((x) => x.id === t.pid) || (tw && rooms.find((x) => x.id === tw.id)) || null;
  if (!r) return null;
  const z0 = r.z || 0, hh = view ? 1.2 : r.h || 0;
  const pts = [[r.x, r.y, z0], [r.x + r.w, r.y, z0], [r.x, r.y + r.d, z0], [r.x + r.w, r.y + r.d, z0], [r.x, r.y, z0 + hh], [r.x + r.w, r.y + r.d, z0 + hh]].map(([x, y, z]) => iso(x, y, z));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), bw = Math.max(...xs) - Math.min(...xs) + 40, bh = Math.max(...ys) - Math.min(...ys) + 60;
  const gx = (Math.min(...xs) + Math.max(...xs)) / 2, gy = (Math.min(...ys) + Math.max(...ys)) / 2, gz = clampZ(Math.min(1.3, Math.max(0.55, Math.min(freeW / bw, freeH / bh))));
  const sx = freeW / 2, sy = freeH / 2, aim = (z) => ({ x: gx - (sx - W / 2) / z, y: gy - (sy - H / 2) / z });
  const from = { x: cam.x, y: cam.y, z: cam.z }, end = { ...aim(gz), z: gz };
  cancelAnimationFrame(ctlSnapAnim);
  const t0 = performance.now(), ms = 450;
  const put = (k) => { const e = 1 - Math.pow(1 - k, 3); cam.z = from.z + (end.z - from.z) * e; const a = aim(cam.z); cam.x = from.x + (a.x - from.x) * e; cam.y = from.y + (a.y - from.y) * e; };
  if (calm) put(1); else { const step = (now) => { const k = Math.min(1, (now - t0) / ms); put(k); if (k < 1) ctlSnapAnim = requestAnimationFrame(step); }; ctlSnapAnim = requestAnimationFrame(step); }
  window.__ctlSnapGoal = { gx, gy, sx, sy }; // for the render check: the target and where on the canvas it should land
  return () => ({ x: (gx - cam.x) * cam.z + W / 2, y: (gy - cam.y) * cam.z + H / 2, r: Math.max(50, Math.min(120, Math.min(bw, bh) * cam.z * 0.4)) });
}
// The ring: a dashed outline (never colour alone) that follows the target for about 2 s.
function ctlPulse(where, calm) {
  const stage = document.getElementById("stage");
  ctlRing?.remove();
  const el = (ctlRing = document.createElement("div"));
  el.className = "ctl-ring" + (calm ? " calm" : ""); el.setAttribute("aria-hidden", "true");
  stage.appendChild(el);
  const t0 = performance.now(), off = () => { const cr = (document.getElementById("c") || stage).getBoundingClientRect(), st = stage.getBoundingClientRect(); return [cr.left - st.left, cr.top - st.top]; };
  const tick = (now) => {
    if (ctlRing !== el) return;
    const p = where(), [ox, oy] = off();
    if (p) { el.style.display = ""; el.style.left = `${p.x + ox}px`; el.style.top = `${p.y + oy}px`; el.style.width = el.style.height = `${p.r * 2}px`; el.style.margin = `${-p.r}px 0 0 ${-p.r}px`; } else el.style.display = "none";
    if (now - t0 < 2000) requestAnimationFrame(tick); else { el.remove(); if (ctlRing === el) ctlRing = null; }
  };
  requestAnimationFrame(tick);
}

async function decideMany(ids, decision) {
  let ok = 0;
  for (const id of ids) { try { await postPw(`/agents/request/${id}/decide`, { decision }); ok++; } catch (err) { toast(err.message, 6000); break; } }
  ctlPicked.clear();
  if (ok) toast(`${decision === "approved" ? "Approved" : "Declined"} ${ok}`);
  await load();
}

function renderControl() {
  if (!data) return;
  ctlEls();
  const narrow = isNarrow(), wait = waitingItems(), prog = inProgress(), wr = waitingRooms();
  ctlWaitRooms = wr;
  const waitOpen = ctlOpen.wait ?? !narrow, progOpen = ctlOpen.prog ?? !narrow;
  // ---- chips: All, districts, then projects with someone in them ----
  const working = (room) => projects.find((p) => p.id === room)?.desks.filter((d) => atWork(d)).length || 0;
  const dists = (data.districts || []).filter((x) => x !== "Home");
  const chip = (label, sel, attrs, count, alert) => `<button class="pill ctl-chip${sel ? " on" : ""}" ${attrs}>${label}${count ? ` <b>${count}</b>` : ""}${alert ? " 🚨" : ""}</button>`;
  document.getElementById("ctlChips").innerHTML = [
    chip("All", !campusFilter, 'data-f=""', 0, false),
    ...dists.map((d) => chip(`${d}`, campusFilter?.district === d, `data-fd="${esc(d)}"`, projects.filter((p) => p.district === d).reduce((a, p) => a + working(p.id), 0), projects.some((p) => p.district === d && wr.has(p.id)))),
    ...projects.filter((p) => !p.paused && p.desks.length && !inCeoTower(p)).map((p) => chip(`<span style="color:${roomHue(p.id)}">●</span> ${esc(p.name)}`, campusFilter?.room === p.id, `data-fr="${esc(p.id)}"`, working(p.id), wr.has(p.id))),
  ].join("");
  document.querySelectorAll("#ctlChips [data-f]").forEach((b) => (b.onclick = () => { campusFilter = null; renderControl(); }));
  document.querySelectorAll("#ctlChips [data-fd]").forEach((b) => (b.onclick = () => { campusFilter = campusFilter?.district === b.dataset.fd ? null : { district: b.dataset.fd }; renderControl(); }));
  document.querySelectorAll("#ctlChips [data-fr]").forEach((b) => (b.onclick = () => { campusFilter = campusFilter?.room === b.dataset.fr ? null : { room: b.dataset.fr }; renderControl(); }));
  // ---- waiting for you ----
  const w = document.getElementById("ctlWait");
  w.classList.toggle("alert", wait.length > 0);
  // while you're typing in an Ask box, leave this card alone (a redraw closes the phone keyboard)
  const typing = ctlAsk.id && document.activeElement?.closest?.(".ctl-askbox") && w.contains(document.activeElement);
  if (!typing) w.innerHTML = `<div class="ctl-head"><span>${wait.length ? "⏳" : "✓"} Waiting for you · <b>${wait.length}</b></span><button class="ctl-min" data-t="wait">${waitOpen ? "–" : "+"}</button></div>
    ${waitOpen ? `<div class="ctl-body">${wait.length ? wait.map((q) => `<div class="ctl-item">
      <div class="ctl-meta">${q.kind === "run" ? '<span title="a job waiting for Run now">▶</span>' : `<input type="checkbox" data-pick="${esc(q.id)}"${ctlPicked.has(q.id) ? " checked" : ""} aria-label="Select">`}<b style="color:${roomHue(q.room)}">${esc(roomName(q.room))}</b> <span class="${q.age > 864e5 ? "late" : ""}">⏳ ${ageText(q.age)}</span>${q.pr ? ` · <span>PR #${Number(q.pr) || ""}</span>` : ""}</div>
      <div class="ctl-text">${esc(q.role)}</div>${q.why ? `<div class="ctl-sub">${esc(String(q.why).slice(0, 140))}</div>` : ""}${[["🔎", "Code review", q.review], ["🛡️", "Security review", q.securityReview]].filter((x) => x[2]).map(([ic, nm, v]) => `<div class="ctl-sub" style="color:${v.verdict === "concerns" ? "#f0b45a" : "#9fd8a8"}">${ic} ${nm} (${esc(v.model || v.by)}): ${v.verdict === "looks-safe" ? "nothing found" : v.verdict === "concerns" ? `has concerns: ${esc((v.concerns || [])[0] || v.summary || "")}` : "can't tell from the diff"}${v.shown < v.files ? " (partial)" : ""}</div>`).join("")}${q.board ? `<div class="ctl-sub" style="color:${q.board.ok ? "#9fd8a8" : "#f0b45a"}">🗳 ${q.board.ok ? `The board approves this at ${esc(new Date(q.board.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))} unless someone objects (${esc(q.board.members.join(", "))}). You can decide first.` : `Needs you: ${esc(q.board.why)}.`}</div>` : ""}
      ${q.kind === "run" ? `<div class="ctl-btns"><button class="ctl-btn yes" data-runnow="${esc(q.id)}">▶ Run now</button><button class="ctl-btn" data-runcancel="${esc(q.id)}">Cancel job</button></div>` : `<div class="ctl-btns"><button class="ctl-btn yes" data-dec="${esc(q.id)}" data-v="approved">${q.pr ? "OK to merge" : "Approve"}</button><button class="ctl-btn" data-dec="${esc(q.id)}" data-v="declined">Reject</button><button class="ctl-btn" data-ask="${esc(q.id)}">Ask</button></div>`}
      <div class="ctl-askbox" id="ask-${esc(q.id)}" style="display:${ctlAsk.id === q.id ? "" : "none"}"><input placeholder="Your question for ${esc(q.from || "the lead")}" value="${ctlAsk.id === q.id ? esc(ctlAsk.draft) : ""}"><button class="ctl-btn yes">Send</button></div></div>`).join("") : '<div class="ctl-sub">Nothing needs you right now.</div>'}
      ${ctlPicked.size ? `<div class="ctl-batch">${ctlPicked.size} ticked: <button class="ctl-btn yes" data-batch="approved">Approve all</button><button class="ctl-btn" data-batch="declined">Reject all</button></div>` : ""}</div>` : ""}`;
  // ---- in progress ----
  const g = document.getElementById("ctlProg");
  // Working now first, then the queue (the owner 2026-11-09: queued jobs read as stale under "In progress").
  const nWork = prog.filter((x) => x.status !== "Queued").length, nQ = prog.length - nWork;
  prog.sort((a, b) => (a.status === "Queued") - (b.status === "Queued"));
  const item = (x, i) => `${i === nWork && nQ ? `<div class="ctl-sub" style="margin-top:6px">Queued</div>` : ""}<button class="ctl-item ctl-row" data-who="${esc(x.d.id)}"><div class="ctl-meta"><span style="color:${roomHue(x.d.room)}">●</span> <b>${esc(roomName(x.d.room))}</b> · ${esc(nameOf(x.d))} · <span>${x.status}</span></div><div class="ctl-text">${esc(x.text)}</div>${x.why ? `<div class="ctl-sub" style="color:${x.why.tone === "warn" ? "#f0b45a" : "#9fd8a8"}">${esc(x.why.line)}</div>` : ""}</button>${x.j?.status === "queued" ? `<div style="margin:-2px 0 6px 6px"><button class="ctl-btn yes" data-push="${esc(x.j.id)}" title="Start it now: Run now, a session on your PC, or copy it for its chat">⏩ Push</button> <button class="ctl-btn" data-jobremove="${esc(x.j.id)}" title="Take it out of the queue: it will not run">✕ Remove</button></div>` : ""}`;
  // the error flow: failed jobs from the last 3 days that nobody has retried or dismissed
  const fails = (data.jobs || []).filter((j) => j.status === "failed" && !j.ack && Date.now() - Date.parse(j.updatedAt || j.at) < 3 * 864e5).filter((j) => !campusFilter || shownByFilter(projects.find((p) => p.id === j.room) || {}));
  const stuckN = prog.filter((x) => x.why?.tone === "warn").length;
  const others = data.desks.filter((d) => d.status === "active").sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const fail = (j) => { const d = data.desks.find((x) => x.id === j.desk) || { id: j.desk, room: j.room }; return `<div class="ctl-item" style="border-left:3px solid #e8743b;padding-left:8px"><div class="ctl-meta"><span style="color:${roomHue(j.room)}">●</span> <b>${esc(roomName(j.room))}</b> · ${esc(nameOf(d))} · <span style="color:#f0a06a">failed ${esc(ageText(Date.now() - Date.parse(j.updatedAt || j.at)))} ago</span></div><div class="ctl-text">${esc(String(j.text || "").split("\n")[0].slice(0, 90))}</div><div class="ctl-sub" style="color:#f0a06a">Why: ${esc(String(j.summary || "no reason given").slice(0, 160))}</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px"><button class="pill" data-retry="${esc(j.id)}">↻ Retry</button><select class="pill" data-reassign="${esc(j.id)}" aria-label="Give it to someone else" style="max-width:150px"><option value="">➜ Give to…</option>${others.filter((x) => x.id !== j.desk).map((x) => `<option value="${esc(x.id)}">${esc(nameOf(x))} (${esc(roomName(x.room))})</option>`).join("")}</select><button class="pill" data-dismiss="${esc(j.id)}">✕ Dismiss</button></div></div>`; };
  g.innerHTML = `<div class="ctl-head"><span>▶ Working <b>${nWork}</b>${nQ ? ` · queued <b>${nQ}</b>` : ""}${fails.length + stuckN ? ` · <b style="color:#f0a06a">⚠ ${fails.length + stuckN}</b>` : ""}</span><button class="ctl-min" data-t="prog">${progOpen ? "–" : "+"}</button></div>
    ${progOpen ? `<div class="ctl-body">${fails.length ? `<div class="ctl-sub" style="color:#f0a06a;font-weight:600">⚠ Problems: failed jobs</div>${fails.map(fail).join("")}<div class="ctl-sub" style="margin-top:6px">In flight</div>` : ""}${prog.length ? prog.map(item).join("") : '<div class="ctl-sub">Nobody is mid-job right now.</div>'}</div>` : ""}`;
  for (const b of g.querySelectorAll("[data-push]")) b.onclick = () => pushJob(b.dataset.push, b);
  // Remove a queued job (the owner 2026-11-16: "right now we can only push jobs, not remove them"): it is cancelled so it never runs.
  // Only a job that has not started shows the button; a running one can't be pulled back from here.
  for (const b of g.querySelectorAll("[data-jobremove]")) b.onclick = async () => {
    if (!await confirmBox({ title: "Remove this job from the queue?", yes: "Remove job", no: "Keep it" })) return;
    b.disabled = true;
    try { await api(`/agents/job/${b.dataset.jobremove}/cancel`, { note: "Removed from the queue on the campus" }); toast("Removed from the queue."); await load(); }
    catch (err) { toast(err.message, 6000); b.disabled = false; }
  };
  for (const b of g.querySelectorAll("[data-retry]")) b.onclick = async () => { b.disabled = true; try { await postPw(`/agents/job/${b.dataset.retry}/retry`, {}); toast("Queued again on the same desk."); await load(); } catch (err) { toast(err.message, 6000); b.disabled = false; } };
  for (const sel of g.querySelectorAll("[data-reassign]")) sel.onchange = async () => { if (!sel.value) return; try { await postPw(`/agents/job/${sel.dataset.reassign}/retry`, { desk: sel.value }); toast(`Given to ${nameOf(data.desks.find((x) => x.id === sel.value) || { id: sel.value })}.`); await load(); } catch (err) { toast(err.message, 6000); } };
  for (const b of g.querySelectorAll("[data-dismiss]")) b.onclick = async () => { b.disabled = true; try { await api(`/agents/job/${b.dataset.dismiss}/dismiss`, {}); toast("Dismissed."); await load(); } catch (err) { toast(err.message, 6000); b.disabled = false; } };
  // ---- wiring ----
  // the whole header toggles the card, not just the small +/− button (easier to hit on a phone)
  for (const b of document.querySelectorAll(".ctl-min")) { const flip = (e) => { e.stopPropagation(); const k = b.dataset.t; ctlOpen[k] = !((ctlOpen[k] ?? !isNarrow())); renderControl(); }; b.onclick = flip; b.parentElement.onclick = flip; }
  for (const b of w.querySelectorAll("[data-pick]")) b.onchange = () => { b.checked ? ctlPicked.add(b.dataset.pick) : ctlPicked.delete(b.dataset.pick); renderControl(); };
  for (const b of w.querySelectorAll("[data-dec]")) b.onclick = () => decideMany([b.dataset.dec], b.dataset.v);
  for (const b of w.querySelectorAll("[data-runnow]")) b.onclick = async () => { b.disabled = true; b.textContent = "Running…"; try { const r = await postPw(`/agents/job/${b.dataset.runnow}/run`, {}); toast(`Done: ${r.summary || "finished"}`, 6000); await load(); } catch (err) { toast(err.message, 8000); b.disabled = false; b.textContent = "▶ Run now"; } };
  for (const b of w.querySelectorAll("[data-runcancel]")) b.onclick = async () => { if (!await confirmBox({ title: "Cancel this job?", yes: "Cancel job", no: "Keep it" })) return; try { await api(`/agents/job/${b.dataset.runcancel}/cancel`, {}); toast("Cancelled."); await load(); } catch (err) { toast(err.message, 6000); } };
  for (const b of w.querySelectorAll("[data-batch]")) b.onclick = () => decideMany([...ctlPicked], b.dataset.batch);
  for (const b of w.querySelectorAll("[data-ask]")) b.onclick = () => {
    const id = b.dataset.ask, open = ctlAsk.id !== id;
    Object.assign(ctlAsk, { id: open ? id : null, draft: open ? "" : ctlAsk.draft, focused: open });
    for (const x of w.querySelectorAll(".ctl-askbox")) x.style.display = open && x.id === `ask-${id}` ? "" : "none";
    if (open) document.getElementById(`ask-${id}`)?.querySelector("input").focus();
  };
  for (const box of w.querySelectorAll(".ctl-askbox")) {
    const id = box.id.slice(4), input = box.querySelector("input");
    const send = async () => { const note = input.value.trim(); if (!note) return; try { await api(`/agents/request/${id}/ask`, { note }); toast("Asked. Their answer comes back as a text."); Object.assign(ctlAsk, { id: null, draft: "", focused: false }); box.style.display = "none"; } catch (err) { toast(err.message, 6000); } };
    box.querySelector("button").onclick = send; input.onkeydown = (e) => e.key === "Enter" && send();
    input.oninput = () => { if (ctlAsk.id === id) ctlAsk.draft = input.value; };
    input.onfocus = () => { if (ctlAsk.id === id) ctlAsk.focused = true; };
    input.onblur = () => setTimeout(() => { if (input.isConnected && ctlAsk.id === id && document.activeElement !== input) ctlAsk.focused = false; }, 0);
    // put the cursor back after a redraw (end of the text, so typing carries on)
    if (ctlAsk.id === id && ctlAsk.focused && document.activeElement !== input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }
  for (const b of g.querySelectorAll("[data-who]")) b.onclick = () => { const d = data.desks.find((x) => x.id === b.dataset.who); if (d) workerPanel(d); };
  renderTicker();
  window.dispatchEvent(new CustomEvent("campus:filter"));
}

// ---- the live ticker: the newest events, one at a time ----
let tickIdx = 0, tickTimer = null;
function tickerItems() { return (data?.feed || []).filter((f) => f.kind === "agent event" && f.summary).slice(0, 20); }
function renderTicker() {
  const el = document.getElementById("ctlTicker"), list = tickerItems();
  if (!list.length) { el.style.display = "none"; return; }
  el.style.display = "";
  const f = list[tickIdx % list.length], fresh = Date.now() - Date.parse(f.startedAt) < 15 * 60000;
  el.innerHTML = `<span class="${fresh ? "live" : "dim"}">● ${fresh ? "LIVE" : "LATEST"}</span> <b>${esc(roomName(f.room))}</b> <span class="ctl-sub">${esc(new Date(f.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</span> · ${esc(nameOf(data.desks.find((d) => d.id === f.desk) || { id: f.desk }))}: ${esc(humanStep(f).slice(0, 90))} <button class="ctl-btn" id="ctlFeed">Full feed</button>`;
  document.getElementById("ctlFeed").onclick = feedPanel;
  if (!tickTimer) tickTimer = setInterval(() => { tickIdx++; renderTicker(); }, 6000);
}
// The Full feed by job (the owner 2026-11-14: "feed by job with a break out"): one block per worker per job, the newest
// first, saying in a line what happened; tap a block to see its steps in plain words. Requests and roster changes,
// which belong to no job, are listed under it as before.
function feedPanel() {
  const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const who = (id) => { const d = data.desks.find((x) => x.id === id); return d ? nameOf(d) : id; };
  const blocks = (data.jobFeed || []).map((g, i) => `<details class="feed-job"${i === 0 ? " open" : ""}><summary><b>${esc(who(g.desk))}</b> <span class="sub">${esc(roomName(g.room || ""))} · ${esc(ago(g.at))}</span>
      <div>${g.job ? `📌 ${esc(g.job.text)}` : "<span class=\"sub\">Work outside a job</span>"}${g.agent ? ` <span class="sub">· 🤝 a helper${g.agentType ? `: ${esc(g.agentType)}` : ""}</span>` : ""}</div><div class="sub">${esc(jobBlockSummary(g))}</div></summary>
      ${g.steps.map((s) => `<div class="feed-step${s.failed ? " bad" : ""}"><span class="sub">${time(s.at)}</span> ${esc(humanStep(s))}</div>`).join("")}${g.more ? `<div class="sub">… and ${g.more} earlier steps</div>` : ""}</details>`).join("");
  const other = (data.feed || []).filter((f) => f.kind !== "agent event").slice(0, 15);
  showPanel("feed", "Full feed", `
    <div class="sub mt-1">What everyone's been doing, by job. Tap one to see each step.</div>
    ${blocks || '<div class="sub mt-2">Nothing reported yet.</div>'}
    ${other.length ? `<h3 class="mt-4 font-semibold text-sm">Requests and staff changes</h3>${other.map((f) => `<div class="row"><span class="sub">${esc(ago(f.startedAt))} · ${esc(roomName(f.room || ""))}</span><div>${feedText(f)}</div></div>`).join("")}` : ""}`);
}

// ---------- getting around (part 2): camera buttons and, inside a building, the floor list (the "elevator") ----------
// Ideas from towers.app ("scroll to ride", a slim stack of floors with what each does) and the grok-bot-3d-campus demo
// (zoom, rotate, home buttons). The floor list shows each floor's live state; tap one to ride to it (3D) or open it.
function renderNav() {
  ctlEls();
  let nav = document.getElementById("ctlCam");
  if (!nav) { nav = document.createElement("div"); nav.id = "ctlCam"; nav.className = "ctl-cam"; document.getElementById("stage").appendChild(nav); }
  const three = !!window.campus3dActive && !!window.campus3d;
  nav.innerHTML = `<button class="pill" data-cam="in" title="Zoom in">+</button><button class="pill" data-cam="out" title="Zoom out">−</button>${three ? '<button class="pill" data-cam="l" title="Turn left">⟲</button><button class="pill" data-cam="r" title="Turn right">⟳</button>' : ""}<button class="pill" data-cam="home" title="Back to the whole view">⌂</button>${three && campus3d.fancy ? `<button class="pill${campus3d.fancy() ? " on ctl-chip" : ""}" data-cam="fancy" title="Heavier-PC look: miniature blur, glow and colour (for a strong graphics card)">✨</button>` : ""}<button class="pill" data-cam="help" title="What the little signs mean">?</button>`;
  nav.querySelectorAll("[data-cam]").forEach((b) => (b.onclick = () => {
    const a = b.dataset.cam;
    // the key to the little signs (it used to sit under the buttons and run behind them); tap again to hide
    if (a === "help") { document.getElementById("help")?.classList.toggle("show"); b.classList.toggle("ctl-chip"); b.classList.toggle("on"); return; }
    if (a === "fancy" && three) { const v = !campus3d.fancy(); campus3d.fancy(v); toast(v ? "✨ Heavier-PC look on: miniature blur, glow and colour. Tap ✨ again to turn it off." : "Lighter look on.", 4000); renderNav(); return; }
    if (three) { if (a === "in") campus3d.zoom(1.25); if (a === "out") campus3d.zoom(0.8); if (a === "l") campus3d.turn(-1); if (a === "r") campus3d.turn(1); if (a === "home") campus3d.home(); return; }
    if (a === "in") cam.z = clampZ(cam.z * 1.25); if (a === "out") cam.z = clampZ(cam.z * 0.8); if (a === "home") fit();
  }));
  // the floor list, inside a building only
  let fl = document.getElementById("ctlFloors");
  if (!view) { if (fl) fl.style.display = "none"; return; }
  if (!fl) { fl = document.createElement("div"); fl.id = "ctlFloors"; fl.className = "ctl-card ctl-floors"; document.getElementById("stage").appendChild(fl); }
  fl.style.display = "";
  const wr = waitingRooms(), cur = three ? campus3d.floor() : -1, proj = projects.find((p) => p.id === view);
  const floors = [...rooms].sort((a, b) => b.k - a.k);
  // a Residences tower (city.js): its floors are homes, with the level's word on every row (never colour alone)
  if (rooms[0]?.resFloor) {
    const tname = rooms[0].towerName, lab = (f) => (f.lobby ? "G" : `${f.span > 1 ? `${f.storey}-${f.storey + 1}F` : `${f.storey}F`}`);
    fl.classList.toggle("strip", isNarrow());
    // (a phone: the floor opens its panel too, so the sheet never shows empty; the 2D view frames that floor, one bay of
    // the long block at a time, and "◀ Bay 2 of 3 ▶" steps along it: city.js resBayView / resFocus2D, 3D main3d.js ride)
    const go = () => {
      fl.querySelectorAll("[data-ride]").forEach((b) => (b.onclick = () => { const k = Number(b.dataset.ride); if (three) campus3d.ride(k); else if (isNarrow()) resFocus2D(k < 0 ? null : k); renderNav(); if (k >= 0) panel(b.dataset.fid); }));
      fl.querySelectorAll("[data-bay]").forEach((b) => (b.onclick = () => { const B = resBayView(); if (!B) return; resBay = Math.max(0, Math.min(B.n - 1, B.i + Number(b.dataset.bay))); if (three) campus3d.ride(campus3d.floor()); else resFocus2D(resK2D); renderNav(); }));
    };
    if (isNarrow()) {
      const cur2 = three ? cur : resK2D == null ? -1 : resK2D, curF = rooms.find((f) => f.k === cur2), B = resBayView();
      fl.innerHTML = `${B ? `<button class="pill ctl-chip" data-bay="-1" aria-label="Previous bay"${B.i ? "" : " disabled"}>◀</button><span class="ctl-sub" style="align-self:center;white-space:nowrap">Bay ${B.i + 1} of ${B.n}</span><button class="pill ctl-chip" data-bay="1" aria-label="Next bay"${B.i < B.n - 1 ? "" : " disabled"}>▶</button>` : ""}${floors.length > 1 ? `<button class="pill ctl-chip${cur2 < 0 ? " on" : ""}" data-ride="-1">All</button>` : ""}${[...floors].reverse().map((f) => `<button class="pill ctl-chip${cur2 === f.k ? " on" : ""}" data-ride="${f.k}" data-fid="${esc(f.id)}" title="${esc(f.floorName)}">${lab(f)} ${esc(f.levelName)}${f.home ? " 💡" : ""}</button>`).join("")}<span class="ctl-sub" style="align-self:center;white-space:nowrap">${esc(curF ? curF.floorName : tname)}</span>`;
      return go();
    }
    fl.innerHTML = `<div class="ctl-head"><span>🛗 ${esc(tname)}</span><span class="ctl-sub">${three ? "scroll to ride" : "tap a floor"}</span></div><div class="ctl-body">
      ${three && floors.length > 1 ? `<button class="ctl-item ctl-row${cur < 0 ? " on" : ""}" data-ride="-1"><div class="ctl-text">All floors</div></button>` : ""}
      ${floors.map((f) => { const n = f.flats.filter(Boolean).length; return `<button class="ctl-item ctl-row ctl-floor${cur === f.k ? " on" : ""}" data-ride="${f.k}" data-fid="${esc(f.id)}"><span class="band" style="background:hsl(${f.hue},45%,60%)"></span>
        <div class="ctl-meta"><b>${lab(f)}</b> ${esc(f.levelName)}</div>
        <div class="ctl-sub">${f.lobby ? "laundry · bikes · common room · mailboxes" : f.levelKey === "penthouse" ? esc(f.desks.length ? f.desks.map(nameOf).join(" · ") + (f.perFloor > n ? ` · ${f.perFloor - n} to let` : "") : "to let") : `${n} home${n === 1 ? "" : "s"}${f.perFloor > n ? ` · ${f.perFloor - n} to let` : ""}`}${f.home ? ` · ${f.home} home now` : ""}</div></button>`; }).join("")}</div>`;
    return go();
  }
  // Phones (the owner 2026-11-09: "the menu inside takes most of the space"): a one-row strip of floor buttons instead
  // of the card, and picking a floor just rides there (tap the floor itself for its panel).
  fl.classList.toggle("strip", isNarrow());
  if (isNarrow()) {
    const curF = rooms.find((f) => f.k === cur);
    fl.innerHTML = `${three && floors.length > 1 ? `<button class="pill ctl-chip${cur < 0 ? " on" : ""}" data-ride="-1">All</button>` : ""}${[...floors].reverse().map((f) => `<button class="pill ctl-chip${cur === f.k ? " on" : ""}" data-ride="${f.k}" data-fid="${esc(f.id)}" title="${esc(f.floorName || f.name)}">${f.k + 1}F${f.desks.some((d) => atWork(d)) ? " ●" : ""}</button>`).join("")}<span class="ctl-sub" style="align-self:center;white-space:nowrap">${esc(curF ? curF.floorName || curF.name : proj?.name || "")}</span>`;
    fl.querySelectorAll("[data-ride]").forEach((b) => (b.onclick = () => { const k = Number(b.dataset.ride); if (three) { campus3d.ride(k); renderNav(); } else if (k >= 0) panel(b.dataset.fid); }));
    return;
  }
  fl.innerHTML = `<div class="ctl-head"><span>🛗 ${esc(proj?.name || "")}</span><span class="ctl-sub">${three ? "scroll to ride" : "tap a floor"}</span></div><div class="ctl-body">
    ${three && floors.length > 1 ? `<button class="ctl-item ctl-row${cur < 0 ? " on" : ""}" data-ride="-1"><div class="ctl-text">All floors</div></button>` : ""}
    ${floors.map((f) => { const workingNow = f.desks.filter((d) => atWork(d)).length; return `<button class="ctl-item ctl-row ctl-floor${cur === f.k ? " on" : ""}" data-ride="${f.k}" data-fid="${esc(f.id)}"><span class="band" style="background:hsl(${f.hue},45%,60%)"></span>
      <div class="ctl-meta"><b>${f.k + 1}F</b> ${esc(f.floorName || f.name)}${wr.has(view) && f.k === 0 ? " 🚨" : ""}</div>
      <div class="ctl-sub">${f.desks.length} desk${f.desks.length === 1 ? "" : "s"}${workingNow ? ` · <span style="color:#7ddc8a">${workingNow} working</span>` : ""}${f.lead ? ` · lead ${esc(nameOf(f.lead))}` : ""}</div></button>`; }).join("")}</div>`;
  fl.querySelectorAll("[data-ride]").forEach((b) => (b.onclick = () => {
    const k = Number(b.dataset.ride);
    if (three) { campus3d.ride(k); renderNav(); }
    if (k >= 0) panel(b.dataset.fid);
  }));
}
addEventListener("campus:ride", () => renderNav());
addEventListener("campus:built", () => renderNav());

addEventListener("campus:built", () => { if (!view) renderControl(); else { ctlEls(); for (const id of ["ctlChips", "ctlWait", "ctlProg"]) document.getElementById(id).style.display = "none"; renderTicker(); } });
addEventListener("campus:built", () => { if (!view) for (const id of ["ctlChips", "ctlWait", "ctlProg"]) document.getElementById(id).style.display = ""; });
// the cards are rebuilt once the resizing settles, not on every step of it (they flickered while a panel was dragged)
let ctlResizeT = 0;
addEventListener("resize", () => { clearTimeout(ctlResizeT); ctlResizeT = setTimeout(() => data && !view && renderControl(), 200); });

// Push a queued job (the owner 2026-11-09): the hub runs it, starts a Claude Code session for it on the PC, or, for a
// chat-based worker, copies the job and opens its chat so it can be pasted in.
async function pushJob(id, b) {
  if (b) { b.disabled = true; b.textContent = "Pushing…"; }
  try {
    const r = await postPw(`/agents/job/${id}/push`, {});
    const who = nameOf(data.desks.find((x) => x.id === (r.desk || r.desk)) || { id: r.desk || "" });
    if (r.how === "chat") {
      try { await navigator.clipboard.writeText(r.text); } catch {}
      if (r.chatUrl) window.open(r.chatUrl, "_blank", "noopener");
      toast(r.chatUrl ? `${who} works in a chat: the job is copied, paste it there.` : `The hub can't start ${who}: it has no project folder on this PC and no chat link. The job text is copied; paste it into its chat. To let Push start it, map a folder to it on the Agents page.`, 12000);
    } else toast(r.how === "session" ? `Started a session for ${who} on your PC (up to an hour).` : `Done: ${r.summary || "finished"}`, 7000);
    await load();
  } catch (err) { toast(err.message, 8000); if (b) { b.disabled = false; b.textContent = "⏩ Push"; } }
}
