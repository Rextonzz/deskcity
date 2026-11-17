// Campus: the side panel, doors, actions and jobs. Part of public/campus.html, loaded in order by campus/boot.js;
// the files share one global scope (classic scripts), so a name defined in one is visible in the others.
"use strict";
// ---------- blocker watches (the owner 2026-11-09) ----------
// What's blocking this project and what would clear it; the hub checks on a schedule and alerts the owner when it clears.
const CHECK_TEXT = (c) => c.type === "github-release" ? `a ${c.repo} release mentioning "${c.match}"` : c.type === "url-contains" ? `"${c.text}" on ${c.url}` : `the file ${c.path}`;
function blockersHtml(room) {
  const ws = (data.blockers || []).filter((w) => w.room === room);
  if (!ws.length) return "";
  return `<h3 class="mt-4 font-semibold text-sm">🚧 Blocker watches</h3>${ws.map((w) => `<div class="row"><b>${esc(w.what)}</b>
    <div class="sub">${w.status === "open" ? `Waiting for ${esc(CHECK_TEXT(w.check))} · checked every ${w.everyHours} h${w.lastCheck ? ` · last ${esc(ago(w.lastCheck.at))}: ${esc(w.lastCheck.note || "")}` : " · not checked yet"}` : w.status === "cleared" ? `✅ Cleared ${esc(ago(w.closedAt))}: ${esc(w.lastCheck?.note || "")}` : `Closed ${esc(ago(w.closedAt))}`} · set by ${esc(w.desk)}</div>
    ${w.status === "open" ? `<div class="flex gap-2 mt-1"><button class="pill" data-bcheck="${esc(w.id)}">Check now</button><button class="pill" data-bclose="${esc(w.id)}">Close</button></div>` : ""}</div>`).join("")}`;
}
function wireBlockers(p) {
  p.querySelectorAll("[data-bcheck]").forEach((b) => (b.onclick = async () => { try { const r = await api("/agents/blocker/check", { id: b.dataset.bcheck }); toast(r[0] ? (r[0].cleared ? "Cleared! Alert sent." : `Still blocked: ${r[0].note}`) : "Checked", 6000); await load(); } catch (err) { toast(err.message, 6000); } }));
  p.querySelectorAll("[data-bclose]").forEach((b) => (b.onclick = async () => { try { await api("/agents/blocker/close", { id: b.dataset.bclose }); toast("Watch closed"); await load(); } catch (err) { toast(err.message, 6000); } }));
}

// ---------- org chart (the owner 2026-11-09: "see reporting structure", "so we can realign reports") ----------
// the owner → the pet (CEO, chairs) → each project's lead → the desks reporting to them (reportsTo, or the lead by default).
// Loans show as dotted "on loan" lines; projects with no lead are flagged. Tap a desk to realign it: move project,
// change who it reports to, or make it the project lead (the old lead then reports to it).
let orgOpen = null;
function orgTree() {
  const desks = data.desks.filter((d) => d.status !== "retired"), byId = Object.fromEntries(desks.map((d) => [d.id, d]));
  const leadOf = (room) => desks.find((d) => d.room === room && d.lead);
  const boss = (d) => (d.lead ? null : d.reportsTo && byId[d.reportsTo] ? d.reportsTo : leadOf(d.room)?.id || null);
  const kids = {};
  for (const d of desks) { const b = boss(d); if (b) (kids[b] ||= []).push(d); }
  return { desks, byId, leadOf, boss, kids };
}
function orgPanel() {
  const { desks, byId, leadOf, boss, kids } = orgTree(), loans = data.loans || [];
  // Status by shape and colour, never colour alone (the owner 2026-11-11: partly colourblind).
  const dot = (d) => (d.status === "active" ? "#7ddc8a" : d.status === "paused" ? "#9aa3ad" : "#f0b45a");
  const mark = (d) => (d.status === "active" ? "●" : d.status === "paused" ? "⏸" : "○");
  const person = (d, depth) => {
    const loan = loans.find((l) => l.desk === d.id), cross = !d.lead && d.reportsTo && byId[d.reportsTo] && byId[d.reportsTo].room !== d.room;
    const row = `<div class="row" data-org="${esc(d.id)}" style="margin:2px 0 2px ${depth * 16}px;padding:5px 8px;border-left:2px ${loan ? "dashed #e8913c" : `solid ${d.lead ? "#ffd166" : "rgba(127,127,127,0.35)"}`};cursor:pointer">
      <span style="color:${dot(d)}" title="${esc(d.status)}">${mark(d)}</span> <b>${esc(nameOf(d))}</b> <span class="sub">${esc(titleOf(d))} · ${esc(d.id)} · ${esc(d.provider || "")}${d.status !== "active" ? ` · ${esc(d.status)}` : ""}</span>
      ${loan ? `<div class="sub" style="color:#e8913c">🤝 on loan to ${esc(roomName(loan.toRoom))} until ${esc(new Date(loan.until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}${loan.lentBy ? `, lent by ${esc(nameOf(byId[loan.lentBy] || { id: loan.lentBy }))}` : ""} <button class="pill" data-recall="${esc(loan.id)}" style="font-size:11px;padding:1px 8px">↩ Recall</button></div>` : ""}
      ${cross ? `<div class="sub">↗ reports across to ${esc(nameOf(byId[d.reportsTo]))} (${esc(roomName(byId[d.reportsTo].room))})</div>` : ""}
      ${orgOpen === d.id ? orgEditor(d, desks) : ""}</div>`;
    return row + (kids[d.id] || []).sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map((k) => person(k, depth + 1)).join("");
  };
  const rooms = data.rooms.filter((r) => r.status !== "retired");
  const block = (r) => {
    const lead = leadOf(r.id), here = desks.filter((d) => d.room === r.id), orphans = here.filter((d) => !d.lead && !boss(d));
    const warn = !lead ? `<div class="sub" style="color:#f0b45a">⚠ No lead${here.length ? `: ${here.length} desk${here.length === 1 ? "" : "s"} report straight to you` : " and no staff"}</div>` : "";
    return `<div class="mt-3"><div style="font-weight:700">${esc(r.name)} <span class="sub">${here.length} desk${here.length === 1 ? "" : "s"}${r.status && r.status !== "active" ? ` · ${esc(r.status)}` : ""}</span></div>${warn}
      ${lead ? person(lead, 1) : ""}${orphans.map((d) => person(d, 1)).join("")}</div>`;
  };
  const p = showPanel("org", "Org chart", `
    <div class="sub mt-1">Who reports to whom. You own it all; ${hasPet() ? `${esc(PET())}, the CEO, chairs the board meeting;` : "you chair the board meeting;"} each project's lead reports up through them, and everyone else reports to their lead unless you set otherwise. Tap anyone to realign them. Gold line = lead, dashed orange = on loan.</div>
    <div class="row mt-3" style="border-left:2px solid #ffd166;padding:5px 8px"><b>${OWN()}</b> <span class="sub">owner</span></div>
    ${hasPet() ? `<div class="row" style="margin-left:16px;border-left:2px solid #c9ccd4;padding:5px 8px"><b>${esc(PET())}</b> <span class="sub">CEO · chairs the board meeting · never staffed</span></div>` : ""}
    <div style="margin-left:16px">${rooms.map(block).join("")}</div>
    <div class="sub mt-3">Live: this updates as the hub changes.</div>`);
  p.querySelectorAll("[data-recall]").forEach((b) => (b.onclick = async (e) => { e.stopPropagation(); b.disabled = true; try { await api("/agents/loan/return", { request: b.dataset.recall }); toast("Recalled. They're heading home."); await load(); orgPanel(); } catch (err) { toast(err.message, 6000); b.disabled = false; } }));
  p.querySelectorAll("[data-org]").forEach((el) => (el.onclick = (e) => { if (e.target.closest("select,button,label")) return; orgOpen = orgOpen === el.dataset.org ? null : el.dataset.org; orgPanel(); }));
  const save = async (body, msg) => { try { await api("/agents/desk/realign", body); toast(msg); await load(); orgPanel(); } catch (err) { toast(err.message, 6000); } };
  const f = document.getElementById("orgForm");
  if (f) {
    const id = orgOpen, d = byId[id];
    document.getElementById("orgRoom").onchange = (e) => save({ id, room: e.target.value }, `${nameOf(d)} moved to ${roomName(e.target.value)}`);
    const ot = document.getElementById("orgTo"); if (ot) ot.onchange = (e) => save({ id, reportsTo: e.target.value }, `${nameOf(d)} now reports to ${e.target.value ? nameOf(byId[e.target.value]) : "their lead"}`);
    const ml = document.getElementById("orgLead"); if (ml) ml.onclick = () => save({ id, lead: !d.lead }, d.lead ? `${nameOf(d)} is no longer lead` : `${nameOf(d)} now leads ${roomName(d.room)}`);
  }
}
function orgEditor(d, desks) {
  const opts = desks.filter((x) => x.id !== d.id).sort((a, b) => a.room.localeCompare(b.room) || nameOf(a).localeCompare(nameOf(b)));
  return `<div id="orgForm" class="mt-2" style="display:grid;gap:6px">
    <label class="sub">Project <select id="orgRoom" class="pill">${data.rooms.map((r) => `<option value="${esc(r.id)}"${r.id === d.room ? " selected" : ""}>${esc(r.name)}</option>`).join("")}</select></label>
    ${d.lead ? "" : `<label class="sub">Reports to <select id="orgTo" class="pill"><option value="">their project's lead</option>${opts.map((x) => `<option value="${esc(x.id)}"${x.id === d.reportsTo ? " selected" : ""}>${esc(nameOf(x))} · ${esc(x.room)}${x.lead ? " (lead)" : ""}</option>`).join("")}</select></label>`}
    <div><button class="pill" id="orgLead">${d.lead ? "Step down as lead" : `Make lead of ${esc(data.rooms.find((r) => r.id === d.room)?.name || d.room)}`}</button></div></div>`;
}

// ---------- workers out on loan ----------
// A room's own workers lent to another project (the owner 2026-11-14: Finance showed "No desks yet" while its lead was lent
// to the hub). They sit in the borrower's building; here they're listed as away, with a button to bring them home.
function awayHtml(list) {
  if (!list?.length) return "";
  const borrower = (id) => data.rooms.find((x) => x.id === id)?.name || id;
  const at = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return list.map((d) => `<div class="row" id="desk-${esc(d.id)}"><div><b>${esc(nameOf(d))}</b> <span class="sub">${esc(titleOf(d))} · ${esc(d.id)}</span></div><div>${d.lead ? '<span class="chip">lead</span> ' : ""}<span class="chip">away on loan</span></div>
      <div class="sub">Lent to ${esc(borrower(d.onLoan.toRoom))} until ${esc(at(d.onLoan.until))}, asked by ${esc(d.onLoan.by)}.</div>
      ${loanTrace(d.onLoan)}
      <div class="mt-1"><button class="pill" data-loan-back="${esc(d.onLoan.id)}" data-loan-name="${esc(nameOf(d))}">Bring back now</button> <button class="pill" data-loan-open="${esc(d.onLoan.toRoom)}" data-loan-desk="${esc(d.id)}">See them in ${esc(borrower(d.onLoan.toRoom))}</button></div></div>`).join("");
}
// What a loan is for, and the job it's for with its result when there is one: the trace (the owner 2026-11-14).
function loanTrace(l) {
  const j = l.job;
  return `<div class="sub">For: ${esc(String(l.why || "").replace(/\s+/g, " ").slice(0, 220))}</div>${j ? `<div class="sub">Job ${esc(j.id)}: ${esc(j.status || "queued")}${j.summary ? ` · ${esc(j.summary)}` : ""}</div>${j.output ? `<button class="pill" data-out="${esc(j.id)}" style="margin-top:4px">Read the result</button>` : ""}` : ""}`;
}
function wireAway(p) {
  p.querySelectorAll("[data-loan-back]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await api("/agents/loan/return", { request: b.dataset.loanBack }); toast(`${b.dataset.loanName} is back home`); await load(); }
    catch (err) { b.disabled = false; toast(err.message, 6000); }
  }));
  p.querySelectorAll("[data-loan-open]").forEach((b) => (b.onclick = () => { panel(b.dataset.loanOpen); document.getElementById(`desk-${b.dataset.loanDesk}`)?.scrollIntoView({ block: "start" }); }));
}

// The lead heads every team list; the rest keep their order (sort is stable).
const leadFirst = (list) => list.slice().sort((a, b) => (b.lead ? 1 : 0) - (a.lead ? 1 : 0));
// ---------- panel ----------
const STATUS = { asked: "Waiting for you", new: "Waiting for HR", recommended: "HR has checked it", approved: "Approved", declined: "Declined" };
function panel(id) {
  openRoom = id;
  if (id === "access") return; // the access form keeps its ticks through a refresh
  if (id === "addproject") return; // the add-a-project form: a refresh must not wipe what's typed in it
  if (id === "control" || id === "control::cc") return controlPanel();
  if (id === "leisure") return leisurePanel();
  if (id === "clocktower") return clockPanel();
  if (id === "since") return sincePanel();
  if (id === "watchlog") return watchPanel();
  if (id === "surflog") return surfPanel();
  if (id === "pet" || id === "control::pet") return rexPanel();
  if (id === "pavilion" || id === "control::board") return standupPanel();
  if (id === "underground") return undergroundPanel();
  if (id === "store") return storePanel();
  if (id === "org") return orgPanel();
  if (String(id).startsWith("worker:")) { const d = data.desks.find((x) => x.id === id.slice(7)); if (d) return workerPanel(d); }
  if (id === "garden" || id === "garden-shared") return gardenPanel(); // the community garden and its shared part (city.js)
  if (id === "break-garden") return breakGardenPanel(); // the break garden by the work wings (city.js)
  if (/^homes(-\d+)?$/.test(id)) return homesPanel(id);
  if (/^homes(-\d+)?::(\d+|lobby)$/.test(String(id))) return resFloorPanel(id); // a floor inside a Residences tower (or its lobby)
  if (/^hr::\d+$/.test(String(id))) id = "hr"; // HR's floor in the CEO tower opens HR's own panel: inbox, finance, board
  if (String(id).startsWith("house:")) { const hr = homeOf(id); if (hr) return housePanel(hr); }
  const r = rooms.find((x) => x.id === id) || projects.find((x) => x.id === id);
  if (!r) return closePanel();
  // A floor shows its own desks and activity; Start/Pause, the hub link and requests belong to its project.
  const proj = r.project || r;
  const isFloor = !!r.project;
  const reqs = isFloor ? [] : data.requests.filter((q) => q.room === proj.id || (proj.isHr && !q.decision));
  const p = showPanel(null, isFloor && proj.floors.length > 1 ? `${esc(proj.name)} <span class="sub">· ${esc(r.floorName)} (floor ${r.k + 1} of ${proj.floors.length})</span>` : esc(proj.name), `
    ${proj.paused ? '<div class="sub mt-1">Paused. Starting it asks HR for a project lead if it has none.</div>' : ""}
    ${!isFloor && proj.floors?.length > 1 ? `<div class="sub mt-1">Floors: ${proj.floors.map((f) => `${esc(f.floorName)} (${f.desks.length})${f.busy ? " ●" : ""}`).join(" · ")}. Tap a floor for its desks.</div>` : ""}
    <div class="sub mt-1">${r.busy ? "● someone's working now · " : ""}${usd(r.spend)} API${r.cap ? ` of ${usd(r.cap)} caps` : ""}${r.sub ? ` · ${usd(r.sub)} subscription` : ""} this month</div>
    ${!isFloor && !r.isHr && r.link ? `<div class="sub mt-1">${r.link.linked ? "✓ Linked to the hub" : `! Not linked yet: ${[r.link.lead ? "" : "no lead", r.link.lastReportAt ? (Date.now() - Date.parse(r.link.lastReportAt) > 14 * 864e5 ? "no report in 14 days" : "") : "no reports yet"].filter(Boolean).join(", ")}`}${r.link.folder ? "" : " · no folder mapped"}</div>` : ""}
    ${isFloor ? "" : directoryHtml(proj)}
    ${isFloor ? floorBlocksHtml(proj.id) : actionsHtml(proj.id) + doorsHtml(proj.id) + servicesHtml(proj.id) + blockersHtml(proj.id)}
    ${(() => { const notes = isFloor ? [] : data.rooms.find((x) => x.id === proj.id)?.notes || []; return notes.length ? `<h3 class="mt-4 font-semibold text-sm">📌 Standing notes from you</h3><div class="sub">Their hub-run desks read these with every job.</div>${notes.slice().reverse().map((n) => `<div class="row sub">${esc(n.text)} <span style="opacity:0.7">· ${esc(ago(n.at))}${n.from === "hr" ? " via HR" : ""}</span></div>`).join("")}` : ""; })()}
    <h3 class="mt-4 font-semibold text-sm">Desks</h3>
    ${r.desks.length ? leadFirst(r.desks).map((d) => `<div class="row" id="desk-${esc(d.id)}"><div><b>${esc(nameOf(d))}</b> <span class="sub">${esc(titleOf(d))} · ${esc(d.id)}</span></div><div>${d.lead ? '<span class="chip">lead</span> ' : ""}${!isFloor && d.floor && proj.floors?.length > 1 ? `<span class="chip">${esc(d.floor)}</span> ` : ""}<span class="chip">${esc(d.stray ? "no desk yet" : d.status)}</span> <span class="chip">${esc(traitOf(d.id))}</span> <span class="chip" title="what's on their shirt">👕 ${esc(modelCode(d))}${EFFORT[String(d.effort || "").toLowerCase()] ? ` · ${esc(d.effort)}` : ""}</span> <span class="chip" title="${esc(BILLING[billingOf(d)].tip)}">${BILLING[billingOf(d)].icon} ${BILLING[billingOf(d)].label}</span></div>
      ${(() => { const fl = flowOf(r.project ? r : proj, d.id); return fl.length ? `<div class="sub" style="color:#7ddc8a">Working now: ${fl.map(esc).join(" › ")}</div>` : ""; })()}
      ${liveHtml(d)}
      ${d.onLoan && d.homeRoom ? `<div class="sub">🤝 On loan from ${esc(data.rooms.find((x) => x.id === d.homeRoom)?.name || d.homeRoom)}.</div>${loanTrace(d.onLoan)}` : ""}
      <div class="sub">${esc(d.role || "")}</div><div class="sub">${esc([d.provider, d.model, d.effort].filter(Boolean).join(" · "))}</div>
      ${d.stray ? "" : `<div class="sub">${d.monthEvents || 0} events · ${usd(d.monthUsd || 0)} API${d.monthSubUsd ? ` · ${usd(d.monthSubUsd)} sub` : ""}${d.capUsdMonth != null ? ` · cap ${usd(d.capUsdMonth)}` : ""}${d.overCap ? " · ⚠ over cap" : ""}</div>`}
      ${(() => { const qd = data.quality?.desks?.[d.id]; return qd ? `<div class="sub" title="HR scores each finished job 0-100; pay per job slides from ${data.quality.scale.min} to ${data.quality.scale.max} credits with it. Taste tests and brief versions: Agents page, Quality checks.">⭐ quality ${qd.score} · pay ${qd.pay}/job <span class="sub">(${qd.n} scored job${qd.n === 1 ? "" : "s"})</span></div>` : ""; })()}
      ${(() => { const w = data.wallets?.[d.id]; if (!w) return ""; return `<div class="sub">💰 ${w.balance} credits · ${w.week} earned this week (${Object.entries(w.pay || {}).map(([k, v]) => `${esc(k)} ${v}`).join(", ")})${w.owned.length ? ` · has ${esc([...new Set(w.owned)].map((o) => data.perks?.[o]?.label || o).join(", "))}` : ""}</div>${storageLine(d.id, ["desk"])}`; })()}
      ${d.stray ? "" : jobRows(d)}${d.lead && !d.stray ? autonomyRow(d) : ""}${d.stray || !(d.lead || d.chatUrl) ? "" : chatRow(d)}</div>`).join("") : (r.away || []).length ? "" : '<div class="sub">No desks yet. A lead can ask HR for staff.</div>'}
    ${awayHtml(r.away)}
    ${doneJobs(r.desks)}
    ${proj.isHr && !isFloor && data.finance ? financeHtml(data.finance) : ""}
    ${proj.isHr && !isFloor && data.board ? (() => { const B = data.board, past = data.requests.filter((q) => q.decision?.by === "board").slice(0, 6); return `<h3 class="mt-4 font-semibold text-sm">🗳 Approval board</h3>
      <div class="sub">HR and the project's lead. With no objection within ${B.windowMin} minutes, it approves loans up to ${B.loanHours} h, Mart items up to ${B.storeCredits} credits, extra team briefs, and hires capped at $${B.hireCap}/month. Everything else comes to you, and you can always decide first.</div>
      <div class="sub mt-1">Hiring budget: $${B.spent} of $${B.limit} this month (${Math.round(B.budgetShare * 100)}% of $${B.total} in desk caps).</div>
      ${past.length ? past.map((q) => `<div class="row sub">✓ ${esc(q.role)} · ${esc(ago(q.decision.at))}</div>`).join("") : '<div class="sub mt-1">Nothing decided by the board yet.</div>'}`; })() : ""}
    ${reqs.length ? `<h3 class="mt-4 font-semibold text-sm">${r.isHr ? "Inbox" : "Requests and asks"}</h3>${reqs.slice(0, 8).map((q) => `<div class="row">${q.kind === "ask" ? '<span class="chip">ask</span> ' : ""}<b>${esc(q.role)}</b> <span class="sub">${esc(q.room)} · ${esc(STATUS[q.status] || q.status)}</span>${q.hr ? `<div class="sub">HR: ${esc(q.hr.verdict)}${q.hr.model ? ` · ${esc(q.hr.model)}` : ""}${q.hr.effort ? ` @${esc(q.hr.effort)}` : ""}</div>` : ""}</div>`).join("")}` : ""}
    <h3 class="mt-4 font-semibold text-sm">Recent</h3>
    ${r.feed.length ? r.feed.slice(0, 12).map((f) => `<div class="row"><span class="sub">${ago(f.startedAt)}</span> ${feedText(f)}</div>`).join("") : '<div class="sub">Nothing yet.</div>'}
    <a href="/agents.html" class="pill inline-block mt-4">Open the list view</a>`, { buttons: `${proj.isHr ? "" : `<button id="pRoom" class="pill">${proj.paused ? "▶ Start" : "❚❚ Pause"}</button>`}` });
  wireJobs(p, id);
  wireAway(p);
  wireBlockers(p); wirePlan(p);
  wireAutonomy(p); wireChatLinks(p);
  fillDoors(p);
  fillActions(p);
  p.querySelectorAll("[data-goto]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); const el = document.getElementById(`desk-${a.dataset.goto}`); if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); el.style.outline = "1px solid #f3d9a4"; setTimeout(() => (el.style.outline = ""), 1600); } }));
  const pr = document.getElementById("pRoom");
  if (pr) pr.onclick = async () => {
    const starting = proj.paused;
    if (!await confirmBox({ title: starting ? `Start ${proj.name}? If it has no lead, a "Project lead" request goes to HR.` : `Pause ${proj.name}? Its active desks are paused too.`, yes: starting ? "Start" : "Pause", no: "Cancel" })) return;
    try { const res = await api("/agents/room", { id: proj.id, status: starting ? "active" : "paused" }); toast(`${proj.name} ${starting ? "started" : "paused"}${res.request ? ". Asked HR for a project lead." : ""}`); if (!starting && view === proj.id) setView(null, true); await load(); }
    catch (err) { toast(err.message, 6000); }
  };
}
// ---------- doors: every hub page has a place on the campus ----------
// The campus is the map of the whole hub. Each building's panel lists the hub pages that belong to it as doors,
// each with one live line from that page's own data; the door opens the full page (the current pages stay as
// they are, the campus is just the way in). Lines load when a panel opens and are kept for a minute.
const n0 = (v) => Number(v || 0).toLocaleString();
const DOOR = {
  todo: ["To-do and ideas", "/todo.html", "/todo", (d) => `${n0(d.counts?.open)} open · ${n0(d.counts?.doing)} doing`],
  project: ["Project", "/project.html", "/project", (p) => (p.todo ? `${p.todo.pctDone}% of the to-do done · day ${n0(p.days)}` : "")],
  search: ["Search everything", "/search.html"],
  home: ["Home (classic)", "/home.html"],
  agents: ["Agents (list view)", "/agents.html"],
  ai: ["AI and spend", "/ai.html"],
  admin: ["Admin", "/admin.html"],
  pipeline: ["Pipeline", "/pipeline.html", "/jobs", (j) => (Array.isArray(j) ? `${j.filter((x) => x.status === "held").length} waiting on you · ${j.length} jobs` : "")],
  queue: ["Queue", "/queue.html", "/queue", (q) => (Array.isArray(q.running) ? `${q.running.length} running · ${(q.waiting || []).length} waiting${q.paused ? " · paused" : ""}` : "")],
  calendar: ["Posting calendar", "/calendar.html", "/calendar", (c) => { if (!Array.isArray(c.posts) || !c.today) return ""; const k = c.posts.filter((x) => x.day === c.today).length; return `${k} post${k === 1 ? "" : "s"} today`; }],
  stats: ["Stats", "/stats.html"],
  statsTt: ["TikTok stats", "/stats-tiktok.html", "/stats/tiktok", (d) => { const c = d[chOf("clips")?.id] || Object.values(d || {})[0]; const posts = (c?.posts || []).filter((p) => p.views != null); return posts.length ? `${n0(posts.length)} posts · ${n0(posts.reduce((a, p) => a + (p.views || 0), 0))} views` : "no numbers yet"; }],
  ytSettings: ["YouTube settings", "/youtube-settings.html"],
  collection: ["Collection", "/collection.html", "/collection", (d) => `${n0((d.cards || []).reduce((t, c) => t + (c.qty || 0), 0))} cards${d.valueCad != null ? ` · CA$${n0(Math.round(d.valueCad))}` : ""}`],
  price: ["Price a card", "/cards.html"],
  deals: ["Deal watch", "/deals.html", "/cards/watch", (d) => (d.last?.items ? `${d.status?.running ? "scanning now · " : ""}${n0(d.last.deals?.length)} deals flagged in the last scan` : d.status?.running ? "scanning now" : "no scan yet")],
  matches: ["Paper matches", "/matches.html", "/paper-matches", (d) => (d.total ? `${n0(d.total.n)} matches logged` : "")],
  deckideas: ["Deck ideas", "/deckideas.html", "/collection/deckideas", (d) => (Array.isArray(d.runs) ? `${n0(d.runs.length)} idea runs${d.task?.running ? " · working now" : ""}` : "")],
  arena: ["MTG Arena", "/arena.html", "/arena", (a) => `${n0(a.records?.played ?? a.played)} games in Arena's records`],
  wow: ["WoW raids", "/wow.html", "/wow", (d) => (d.ready === false ? "not set up yet" : d.settings?.characters ? `${n0(d.settings.characters.length)} characters` : "")],
  games: ["Games", "/games.html", "/games", (d) => (Array.isArray(d.games) ? `${n0(d.games.filter((g) => g.status === "playing").length)} playing · ${n0(d.games.length)} in all` : "")],
  reading: ["Watching and reading", "/reading.html", "/reading", (d) => (Array.isArray(d.items) ? `${n0(d.items.filter((i) => i.behind > 0).length)} with something new · ${n0(d.items.filter((i) => ["watching", "reading"].includes(i.status)).length)} following` : "")],
};
// Which doors are in which building (rooms that aren't listed have none yet).
const DOORS = {
  control: [
    "todo", "project", "search", "agents", "ai", "admin", "home"],
  youtube: ["pipeline", "queue", "calendar", "stats",
    "statsTt", "ytSettings"],
  cards: ["collection", "price", "deals", "matches", "deckideas"],
  gaming: ["games", "arena", "wow"],
  hub: ["agents", "ai", "admin"],
  leisure: ["reading"],
};
// a door to a switched-off part's page isn't drawn (HUB.offPages, from the hub settings)
const doorOn = (key) => { const href = DOOR[key]?.[1] || ""; const page = /^\/([a-z0-9-]+)\.html$/i.exec(href)?.[1]; return !page || !(HUB.offPages || []).includes(page); };
const doorCache = {};
async function doorLine(key) {
  const [, , ep, fn] = DOOR[key];
  if (!ep) return "";
  const c = doorCache[ep];
  if (c && Date.now() - c.at < 60000) return c.text;
  let text = "";
  try { text = fn(await api(ep)) || ""; } catch { text = ""; }
  doorCache[ep] = { at: Date.now(), text };
  return text;
}
// ---------- actions right in the panel (step 2) ----------
// The things used most, done without leaving the campus. Each block uses the same calls as its full page.
const ACTIONS = {
  // Control Center: a quick to-do box and the open to-dos, tick one off right here.
  async control(el) {
    const d = await api("/todo");
    const open = (d.items || []).filter((i) => i.status === "open" || i.status === "doing").slice(0, 6);
    el.innerHTML = `<h3 class="mt-4 font-semibold text-sm">To-do</h3>
      <div style="display:flex;gap:6px;margin-top:6px"><input id="aTodo" placeholder="Add a to-do or idea" style="flex:1;min-width:0;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:6px 10px;color:inherit;font-size:14px" /><button class="pill" id="aTodoAdd">Add</button></div>
      ${open.map((i) => `<div class="row" style="display:flex;gap:8px;align-items:flex-start"><button class="pill" data-tdone="${esc(i.id)}" title="Mark done">✓</button><div style="min-width:0"><div>${esc(i.title)}</div><div class="sub">${esc(i.category || "Unsorted")}${i.status === "doing" ? " · doing" : ""}${i.due ? ` · target ${esc(i.due)}` : ""}</div></div></div>`).join("") || '<div class="sub mt-1">Nothing open.</div>'}`;
    const add = async () => {
      const title = el.querySelector("#aTodo").value.trim();
      if (!title) return;
      try { const r = await api("/todo", { title }); toast(r.existed ? "That one is already on the list" : "Added to Unsorted"); delete doorCache["/todo"]; ACTIONS.control(el); } catch (err) { toast(err.message, 6000); }
    };
    el.querySelector("#aTodoAdd").onclick = add;
    el.querySelector("#aTodo").onkeydown = (e) => e.key === "Enter" && add();
    el.querySelectorAll("[data-tdone]").forEach((b) => (b.onclick = async () => {
      try { await api(`/todo/${b.dataset.tdone}`, { status: "done" }); toast("Done ✓"); delete doorCache["/todo"]; ACTIONS.control(el); } catch (err) { toast(err.message, 6000); }
    }));
  },
  // YouTube: what's running, what's waiting (yours link straight to their review), and what's next.
  async youtube(el) {
    const q = await api("/queue");
    const mine = (q.waiting || []).filter((w) => w.you), line = (x) => [x.channel, x.detail].filter(Boolean).map(esc).join(" · ");
    el.innerHTML = `<h3 class="mt-4 font-semibold text-sm">Queue${q.paused ? ' <span class="chip">paused</span>' : ""}</h3>
      ${mine.map((w) => `<a class="row" href="/pipeline.html#${esc(w.id)}" style="display:block;text-decoration:none;color:inherit"><b style="color:#fbbf24">Waiting on you:</b> ${esc(w.what)}<div class="sub">${line(w)} · tap to review</div></a>`).join("")}
      ${(q.running || []).map((r) => `<div class="row">● Running: ${esc(r.what)}<div class="sub">${line(r)}</div></div>`).join("") || '<div class="row sub">Nothing running.</div>'}
      ${(q.waiting || []).filter((w) => !w.you).length ? `<div class="row sub">${(q.waiting || []).filter((w) => !w.you).length} more in line</div>` : ""}
      ${(q.upcoming || []).slice(0, 3).map((u) => `<div class="row sub">Next: ${esc(new Date(u.at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }))} · ${esc(u.what)}</div>`).join("")}
      <button class="pill" id="aPause" style="margin-top:6px">${q.paused ? "▶ Resume the pipeline" : "❚❚ Pause the pipeline"}</button>`;
    el.querySelector("#aPause").onclick = async () => {
      if (!q.paused && !await confirmBox({ title: "Pause the pipeline? Nothing new gets made or posted until you resume it.", yes: "Pause", no: "Cancel" })) return;
      try { await api("/admin/pause", { paused: !q.paused }); toast(q.paused ? "Pipeline resumed" : "Pipeline paused"); ACTIONS.youtube(el); } catch (err) { toast(err.message, 6000); }
    };
  },
  // Cards: the deals the last scan flagged, and Scan now.
  async cards(el) {
    const d = await api("/cards/watch");
    const KIND = { A: "Big card", B: HUB.stores?.deck ? `${HUB.stores.deck} deck` : "Your deck", C: "Upgrade pick", E: "Damaged land" };
    const cad = (v) => money(v, "CA$");
    const deals = d.last?.deals || [];
    el.innerHTML = `<h3 class="mt-4 font-semibold text-sm">Deal watch</h3>
      <div class="sub">${d.status?.running ? "Scanning now…" : d.last ? `Last scan: ${deals.length} deals flagged` : "No scan yet."}</div>
      ${deals.slice(0, 6).map((x) => `<div class="row"><span class="chip">${esc(KIND[x.kind] || x.kind)}</span> <b>${esc(x.name)}</b> ${cad(x.price)}<div class="sub">${x.nm != null ? `NM ${cad(x.nm)}` : x.target != null ? `target ${cad(x.target)}` : ""}${x.store ? ` · ${esc(x.store)}` : ""}${x.isNew ? " · new" : ""}</div></div>`).join("")}
      ${deals.length > 6 ? `<a class="row sub" href="/deals.html" style="display:block">…and ${deals.length - 6} more on the Deal watch page</a>` : ""}
      <button class="pill" id="aScan" style="margin-top:6px" ${d.status?.running ? "disabled" : ""}>${d.status?.running ? "Scanning…" : "Scan now"}</button>`;
    const b = el.querySelector("#aScan");
    b.onclick = async () => {
      if (!await confirmBox({ title: "Start a deal scan? It takes several minutes in the pipeline's Chrome.", yes: "Start scan", no: "Cancel" })) return;
      try { await api("/cards/watch/scan", {}); toast("Scan started. The deals show here when it's done.", 6000); b.disabled = true; b.textContent = "Scanning…"; delete doorCache["/cards/watch"]; } catch (err) { toast(err.message, 6000); }
    };
  },
};
function actionsHtml(roomId) {
  return ACTIONS[roomId] ? `<div data-actions="${roomId}"><div class="sub mt-3">Loading…</div></div>` : "";
}
function fillActions(p) {
  p.querySelectorAll("[data-actions]").forEach((el) => ACTIONS[el.dataset.actions](el).catch((err) => { el.innerHTML = `<div class="sub mt-3">Couldn't load this: ${esc(err.message)}</div>`; }));
}

// The building's directory: everyone who works here, by floor, at a glance (tap a name for their card below).
function directoryHtml(proj) {
  if (!proj.desks?.length) return "";
  // Status by shape and colour, never colour alone (the owner 2026-11-11: partly colourblind).
  const state = (d) => { const last = proj.lastByDesk?.[d.id]; return last && Date.now() - Date.parse(last.startedAt) < ACTIVE_MS ? "working" : d.status === "active" ? "active" : d.status === "paused" ? "paused" : "planned"; };
  const SHOW = { working: ["#7ddc8a", "▶"], active: ["#6ea8ff", "●"], paused: ["#888", "⏸"], planned: ["#f0b45a", "○"] };
  const dot = (d) => SHOW[state(d)][0], mark = (d) => SHOW[state(d)][1];
  const floors = proj.floors?.length ? proj.floors : [{ floorName: "Main floor", desks: proj.desks }];
  return `<h3 class="mt-4 font-semibold text-sm">Who works here (${proj.desks.length})</h3>
    <div class="sub" style="margin-bottom:4px">▶ working now · ● active · ⏸ paused · ○ planned</div>
    ${floors.map((f) => `<div style="margin-top:6px">${floors.length > 1 ? `<div class="sub" style="text-transform:uppercase;letter-spacing:.05em;font-size:11px">${esc(f.floorName)}</div>` : ""}
      ${f.desks.map((d) => `<a href="#" data-goto="${esc(d.id)}" style="display:flex;gap:6px;align-items:baseline;padding:3px 0;color:inherit;text-decoration:none"><span style="color:${dot(d)};width:1em;text-align:center" title="${state(d)}">${mark(d)}</span><b style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1">${esc(nameOf(d))} <span class="sub" style="font-weight:400">${esc(titleOf(d))}</span></b><span class="sub" style="white-space:nowrap;flex-shrink:0;max-width:40%;overflow:hidden;text-overflow:ellipsis">${esc(d.stray ? "no desk yet" : d.id)}</span></a>`).join("")}</div>`).join("")}`;
}
// On a floor inside a building: the building's hub pages that open right here (campus/blocks.js), so a page is never
// more than a tap away whether you're outside the building or on one of its floors.
function floorBlocksHtml(roomId) {
  const btns = window.campusBlocks?.buttonsFor(roomId) || "";
  return btns ? `<h3 class="mt-4 font-semibold text-sm">Rooms in this building</h3>${btns}` : "";
}
function doorsHtml(roomId) {
  const keys = (DOORS[roomId] || []).filter(doorOn);
  if (!keys.length) return "";
  return `<h3 class="mt-4 font-semibold text-sm">Doors</h3>${keys.map((k) => `<a class="row" href="${DOOR[k][1]}" style="display:block;text-decoration:none;color:inherit"><b>🚪 ${esc(DOOR[k][0])}</b> <span class="sub" data-door="${k}">${DOOR[k][2] ? "…" : ""}</span></a>`).join("")}`;
}
function fillDoors(p) {
  p.querySelectorAll("[data-door]").forEach(async (el) => { const t = await doorLine(el.dataset.door); if (el.isConnected) el.textContent = t ? `· ${t}` : ""; });
}

// ---------- jobs in the panel ----------
function jobRows(d) {
  const open = jobsByDesk[d.id] || [];
  const deskName = (id) => nameOf(data.desks.find((x) => x.id === id) || { id });
  const chainLine = (j) => j.auto ? `<div class="sub" style="color:#9cc7ff">🔗 step ${j.step} · passed on by ${esc(deskName(j.prevDesk))} by itself</div>` : j.of ? `<div class="sub" style="color:#9cc7ff">🔗 step ${j.step} of ${j.of}${j.prevDesk ? ` · from ${esc(deskName(j.prevDesk))}` : ""}${j.then?.length ? ` · then ${j.then.map((x) => esc(deskName(x))).join(" → ")}` : " · last step: back to you"}</div>` : "";
  return `<div class="mt-1">${open.map((j) => `<div class="sub" style="margin-top:4px">📌 ${esc(j.task || j.text.split("\n")[0])} <span class="chip">${esc(j.status)}</span>${chainLine(j)}
      ${d.runner === "hub" && j.status === "queued" ? `<button class="pill" data-run="${j.id}" style="margin-left:4px">Run now</button>` : j.status === "queued" ? `<button class="pill" data-pushjob="${j.id}" style="margin-left:4px">⏩ Push</button>` : ""}<button class="pill" data-cancel="${j.id}" style="margin-left:4px">Cancel</button></div>`).join("")}
    <button class="pill" data-give="${esc(d.id)}" style="margin-top:6px">Give a job</button> <button class="pill" data-brain="${esc(d.id)}" style="margin-top:6px" title="Zoom in: a live map of what this worker is doing, with a feed of every step">🧠 Look inside</button> <button class="pill" data-neural="${esc(d.id)}" style="margin-top:6px" title="The web of workers and how they connect, and this worker's job as a tree of hand-offs, sessions, sub-agents and tool calls">🧬 Neural</button>${d.runner !== "hub" && d.provider === "claude" ? ` <button class="pill" data-access="${esc(d.id)}" style="margin-top:6px" title="What this worker's own session may use on this PC: running its code, Godot and so on">🔑 Access${(d.grants || []).length ? `: ${esc((d.grants || []).map((g) => (data.grants || []).find((x) => x.id === g)?.label || g).join(", "))}` : ""}</button>` : ""}${d.runner === "hub" ? ' <span class="sub">· the hub can run this desk</span>' : ""}</div>`;
}
// Autonomy: a PC lead works on its own for a while (the hub starts Claude Code in its folder).
const autoOf = (id) => (data.autonomy || []).find((a) => a.desk === id && a.live);
const untilTxt = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function autonomyRow(d) {
  // "Work on its own" starts Claude Code in a project folder on the PC; desks the hub runs itself (runner "hub") have
  // no folder, so they get their jobs run with Run now instead (the owner 2026-11-09: the R&D lead's button errored).
  if (d.id === "hr") return '<div class="sub" style="margin-top:6px">🤖 HR runs inside the hub: give it a job (build a team, or pass a message on to a team) and it handles it on its next check, straight away for new jobs.</div>';
  if (d.runner === "hub") return '<div class="sub" style="margin-top:6px">🤖 The hub runs this desk itself: give it a job, then tap Run now on the job.</div>';
  const a = autoOf(d.id);
  // No project folder mapped on the PC (the owner 2026-11-09: Scout, HR): "Work on its own" can't start anything, so say
  // where the lead lives instead. Mapping a folder on the Agents page brings the buttons back.
  if (!a && !d.workFolder && data.rooms.find((x) => x.id === d.room)?.link?.folder === false) return `<div class="sub" style="margin-top:6px">💬 ${esc(nameOf(d))} works outside the hub (a chat, Cowork or another app), so it can't work on its own from here. Give it a job, and it picks it up next time you open its chat${d.chatUrl ? "" : " (add its chat link below)"}. Or give it a work folder on this PC, and Push and Work on its own will start sessions there:</div><div style="display:flex;gap:6px;margin-top:4px"><input data-wf="${esc(d.id)}" placeholder="${d.room === "youtube" ? String(HUB.hubFolder || "C:/hub").replace(/\//g, "\\") : "C:\\path\\to\\project"}" style="flex:1;min-width:0;padding:5px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:inherit"><button class="pill" data-wfsave="${esc(d.id)}">Set folder</button></div>`;
  if (a) return `<div class="sub" style="color:#7ddc8a;margin-top:6px">🟢 Working on its own until ${esc(untilTxt(a.until))} <button class="pill" data-auto-stop="${esc(d.id)}" style="margin-left:4px">Stop</button></div>`;
  return `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:center"><span class="sub">Work on its own for</span>${[["1 h", 1], ["2 h", 2], ["4 h", 4], ["until 8 am", "am"]].map(([l, v]) => `<button class="pill" data-auto="${esc(d.id)}" data-auto-h="${v}" style="font-size:12px">${l}</button>`).join("")}</div>`;
}
function wireAutonomy(p) {
  p.querySelectorAll("[data-auto]").forEach((b) => (b.onclick = async () => {
    const h = b.dataset.autoH, who = nameOf(data.desks.find((x) => x.id === b.dataset.auto) || { id: b.dataset.auto });
    if (!await confirmBox({ title: `Let ${who} work on its own ${h === "am" ? "until 8 am" : `for ${h} h`}? The hub starts Claude Code in its project folder; it can edit files and run safe git and test commands, and opens draft PRs. Never force-push or merge.`, yes: "Let it work", no: "Cancel" })) return;
    try { const r = await postPw("/agents/autonomy", { desk: b.dataset.auto, ...(h === "am" ? { untilMorning: true } : { hours: Number(h) }) }); toast(`${who} is on its own until ${untilTxt(r.until)}`, 6000); await load(); }
    catch (err) { if (!err.cancelled) toast(err.message, 8000); }
  }));
  p.querySelectorAll("[data-auto-stop]").forEach((b) => (b.onclick = async () => {
    try { await api("/agents/autonomy/stop", { desk: b.dataset.autoStop }); toast("Stopped. Its report lands on the job."); await load(); } catch (err) { toast(err.message, 6000); }
  }));
}
function doneJobs(desks) {
  const ids = new Set(desks.map((d) => d.id));
  const done = (data.jobs || []).filter((j) => ids.has(j.desk) && (j.status === "done" || j.status === "failed")).slice(0, 6);
  if (!done.length) return "";
  return `<h3 class="mt-4 font-semibold text-sm">Finished jobs</h3>${done.map((j) => `<div class="row"><b>${esc(nameOf(data.desks.find((x) => x.id === j.desk) || { id: j.desk }))}</b> <span class="chip">${esc(j.status)}</span>${j.of ? ` <span class="chip">🔗 ${j.auto ? `step ${j.step}, auto` : `${j.step}/${j.of}`}</span>` : ""} ${esc((j.task || j.text.split("\n")[0]).slice(0, 80))}
    ${j.summary ? `<div class="sub">${esc(j.summary)}</div>` : ""}${j.output ? `<button class="pill" data-out="${j.id}" style="margin-top:4px">Read the result</button>` : ""}${j.status === "done" && j.output ? ` <span class="sub" style="white-space:nowrap">Good work? <button class="pill" data-rate="${j.id}" data-r="up" title="Good: makes its quality score at least 80 (pay follows the score)" style="padding:1px 8px;${data.ratings?.[j.id]?.r === "up" ? "background:#7ddc8a;color:#1b1f27" : ""}">👍</button> <button class="pill" data-rate="${j.id}" data-r="down" title="Poor: makes its quality score at most 20 (pay follows the score)" style="padding:1px 8px;${data.ratings?.[j.id]?.r === "down" ? "background:#f0b45a;color:#1b1f27" : ""}">👎</button></span>${(() => { const qj = data.quality?.jobs?.[j.id]; return qj && qj.from !== "owner" ? `<div class="sub">⭐ quality ${qj.score} (${qj.from === "judge" ? "HR" : qj.from === "lead" ? "lead" : "old 👍/👎"}) · pays ${qj.pay}${qj.why ? `: ${esc(qj.why)}` : ""}</div>` : qj ? `<div class="sub">⭐ quality ${qj.score} (your rating) · pays ${qj.pay}</div>` : ""; })()}${(() => { const rt = data.ratings?.[j.id]; return rt && rt.by !== OWNER_ID() ? `<div class="sub">${rt.r === "up" ? "👍" : "👎"} by ${rt.by === "hr" ? "HR" : esc(nameOf(data.desks.find((x) => x.id === rt.by) || { id: rt.by }))}${rt.why ? `: ${esc(rt.why)}` : ""} · tap yours to override</div>` : ""; })()}` : ""}</div>`).join("")}`;
}
function wireJobs(p, id) {
  // Give a job, optionally handed on to up to three more desks (any building, any provider): each step's result
  // becomes the next desk's job, and the last one comes back to the owner.
  p.querySelectorAll("[data-give]").forEach((b) => (b.onclick = () => {
    if (b.nextElementSibling?.classList?.contains("jobform")) return;
    const desk = data.desks.find((x) => x.id === b.dataset.give);
    const opts = `<option value="">(no one)</option>${data.desks.filter((x) => x.status === "active" && x.id !== desk?.id).sort((a, c) => (a.room === desk?.room ? -1 : 0) - (c.room === desk?.room ? -1 : 0) || a.room.localeCompare(c.room)).map((x) => `<option value="${esc(x.id)}">${esc(nameOf(x))} · ${esc(titleOf(x))} (${esc(x.room)}, ${esc(modelCode(x))})${x.runner === "hub" ? " ⚡" : x.runner === "local" ? ` 🖥 ${x.app || "local"}` : ""}</option>`).join("")}`;
    const f = document.createElement("div");
    f.className = "jobform"; f.style.cssText = "margin-top:6px;display:grid;gap:6px";
    f.innerHTML = `<textarea rows="3" placeholder="What should ${esc(nameOf(desk))} do?" style="width:100%;background:rgba(255,255,255,0.06);color:inherit;border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:6px"></textarea>
      <div class="sub">Then hand it to (optional; ⚡ = the hub runs it straight away, 🖥 = an app on your PC picks it up). Workers can also pass it on by themselves (up to 4 times).</div>
      ${[1, 2, 3].map((i) => `<select data-then="${i}" style="width:100%;background:#1b1f27;color:inherit;border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:4px"${i > 1 ? " hidden" : ""}>${opts}</select>`).join("")}
      <div><button class="pill" data-send>Give the job</button> <button class="pill" data-x>Cancel</button></div>`;
    b.after(f);
    const sels = [...f.querySelectorAll("[data-then]")];
    sels.forEach((sl, i) => (sl.onchange = () => { if (sels[i + 1]) sels[i + 1].hidden = !sl.value; }));
    f.querySelector("textarea").focus();
    f.querySelector("[data-x]").onclick = () => f.remove();
    f.querySelector("[data-send]").onclick = async () => {
      const text = f.querySelector("textarea").value.trim();
      if (!text) return toast("Say what the job is first.");
      const then = sels.filter((sl) => !sl.hidden).map((sl) => sl.value).filter(Boolean);
      try {
        const r = await postPw("/agents/job", { desk: b.dataset.give, text, then });
        toast(`Job given to ${nameOf(desk)}${then.length ? `, then ${then.map((x) => nameOf(data.desks.find((y) => y.id === x))).join(" → ")}` : ""}${r.via?.length > 1 ? VIA_NOTE : ""}${r.githubError ? `. GitHub failed: ${r.githubError}` : ""}`, 6000);
        await load();
      } catch (err) { if (!err.cancelled) toast(err.message, 6000); }
    };
  }));
  p.querySelectorAll("[data-wfsave]").forEach((b) => (b.onclick = async () => { const inp = p.querySelector(`[data-wf="${b.dataset.wfsave}"]`), v = (inp.value || inp.placeholder).trim(); try { await postPw("/agents/desk/folder", { id: b.dataset.wfsave, folder: v }); toast(`Work folder set: ${v}`); await load(); } catch (err) { toast(err.message, 6000); } }));
  p.querySelectorAll("[data-pushjob]").forEach((b) => (b.onclick = () => pushJob(b.dataset.pushjob, b)));
  p.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = async () => {
    if (!await confirmBox({ title: "Cancel this job?", yes: "Cancel job", no: "Keep it" })) return;
    try { await api(`/agents/job/${b.dataset.cancel}/cancel`, {}); toast("Job cancelled"); await load(); } catch (err) { toast(err.message, 6000); }
  }));
  p.querySelectorAll("[data-run]").forEach((b) => (b.onclick = async () => {
    if (!await confirmBox({ title: "Run this job now on the desk's model? It spends API money (within the desk's cap).", yes: "Run it", no: "Cancel" })) return;
    b.disabled = true; b.textContent = "Running…";
    try { const r = await postPw(`/agents/job/${b.dataset.run}/run`, {}); toast(`Done: ${r.summary || "finished"}`, 6000); await load(); }
    catch (err) { toast(err.message, 8000); b.disabled = false; b.textContent = "Run now"; }
  }));
  p.querySelectorAll("[data-rate]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.rate, cur = data.ratings?.[id], r = cur?.by === OWNER_ID() && cur.r === b.dataset.r ? "" : b.dataset.r;
    try { await api(`/agents/job/${id}/rate`, { rating: r }); (data.ratings ||= {})[id] = r ? { r, by: OWNER_ID() } : undefined; toast(r === "up" ? "Marked good: quality at least 80, and pay follows." : r === "down" ? "Marked poor: quality at most 20, and pay follows." : "Cleared: back to HR's score."); await load(); } catch (err) { toast(err.message, 6000); }
  }));
  p.querySelectorAll("[data-out]").forEach((b) => (b.onclick = async () => {
    try { const r = await api(`/agents/job/${b.dataset.out}/output`); openOutputs.set(b.dataset.out, r.text); showOutput(b, r.text); }
    catch (err) { toast(err.message, 6000); }
  }));
}
// Results you opened stay open through the 20-second refresh (core.js load); ✕ Hide closes one.
const openOutputs = new Map();
// The finance desk's numbers (the owner 2026-11-09): month-to-date and a straight-line projection to month end, per project.
function financeHtml(f) {
  const fd = data.desks.find((d) => d.room === "hr" && d.status === "active" && /financ/i.test(`${d.id} ${d.role}`));
  const bar = (v, cap) => cap ? `<div style="height:5px;background:rgba(255,255,255,.12);border-radius:3px;margin-top:3px"><div style="height:5px;width:${Math.min(100, (v / cap) * 100).toFixed(0)}%;background:${v > cap ? "#ff7a6b" : "#7fd18b"};border-radius:3px"></div></div>` : "";
  return `<h3 class="mt-4 font-semibold text-sm">💰 Finance${fd ? ` <span class="sub">· ${esc(nameOf(fd))}</span>` : ' <span class="sub">· numbers only until HR hires the finance buddy</span>'}</h3>
    <div class="row"><div><b>${usd(f.total.api)}</b> API so far <span class="sub">day ${f.day} of ${f.days}</span></div><div class="sub">heading for <b>${usd(f.total.projected)}</b>${f.total.cap ? ` of ${usd(f.total.cap)} caps` : ""} · subscriptions worth ${usd(f.total.sub)} at API prices (already paid)</div>${bar(f.total.projected, f.total.cap)}</div>
    <div class="row"><div class="sub">Board hire budget: ${usd(f.board.spent)} of ${usd(f.board.limit)} used</div></div>
    ${f.warnings.length ? `<div class="row"><div class="sub">On track to pass their caps</div>${f.warnings.map((w) => `<div>⚠️ ${esc(w.id)} <span class="sub">${usd(w.api)} of ${usd(w.cap)} · heading for ${usd(w.projected)}${w.hitDay ? ` · cap around day ${w.hitDay}` : ""}</span></div>`).join("")}</div>` : ""}
    ${f.rooms.slice(0, 8).map((x) => `<div class="row"><div>${esc(x.name)} <span class="sub">${usd(x.api)} API → ${usd(x.projected)}${x.cap ? ` of ${usd(x.cap)}` : ""}${x.sub ? ` · ${usd(x.sub)} sub` : ""}</span>${x.over ? ' <span class="chip">over</span>' : ""}</div>${bar(x.projected, x.cap)}</div>`).join("")}
    ${f.plan ? planHtml(f.plan, bar) : ""}`;
}
// The plan meter (planmeter.js, the owner 2026-11-14): Anthropic's weekly meter from the status line next to the hub's own
// estimate, and each project's share of the week against the share Finance gives it. Labels in words, not colour alone.
function planHtml(v, bar) {
  const when = (iso) => new Date(iso).toLocaleString("en-CA", { weekday: "short", hour: "numeric", minute: "2-digit" });
  const LABEL = { over: "used up", "heading over": "heading over", near: "near", ok: "", "no budget": "" };
  const head = v.hasMeter
    ? `<div class="row"><div><b>${v.week.pct}%</b> of the week used <span class="sub">Anthropic's meter · resets ${esc(when(v.week.resetsAt))}</span></div>
      <div class="sub">heading for <b>${v.week.projected ?? "?"}%</b>${v.five ? ` · 5-hour window ${v.five.pct}% (resets ${esc(when(v.five.resetsAt))})` : ""} · hub sessions stop at ${v.hubStopPct}% <button class="pill" data-planset="hub-stop" data-plannow="${v.hubStopPct}">change</button></div>${bar(v.week.projected ?? v.week.pct, 100)}
      <div class="sub">Hub's own estimate: ${v.estimate != null ? `${v.estimate}% (${usd(v.usd)} at API prices, ${usd(v.usdPerPct)} per 1%${v.calSource === "this week so far" ? ", provisional: this week's own ratio until a week finishes" : ""})${v.gap != null ? ` · gap ${v.gap > 0 ? "+" : ""}${v.gap} points${v.gap > 3 ? ": use the hub can't see (claude.ai chat, other PCs)" : ""}` : ""}` : `learning (${usd(v.usd)} logged; needs a meter reading of 2% or more)`}</div></div>`
    : `<div class="row"><div class="sub">No reading from Anthropic's meter yet. It comes from the Claude Code status line (tools/statusline-meter.mjs) after your next reply in any session. Until then: ${usd(v.usd)} of plan use logged this week${v.estimate != null ? `, about ${v.estimate}% by past weeks` : ""}.</div></div>`;
  const rows = v.rooms.filter((x) => x.id !== "unassigned" || x.usd).slice(0, 10).map((x) => `<div class="row"><div>${esc(x.name)} <span class="sub">${x.used != null ? `${x.used}% of the week` : usd(x.usd)}${x.projected != null ? ` → ${x.projected}%` : ""}${x.budget != null ? ` of a ${x.budget}% share` : " · no share set"}</span>${LABEL[x.label] ? ` <span class="chip" style="white-space:nowrap">${LABEL[x.label]}</span>` : ""} <button class="pill" data-planset="${esc(x.id)}" data-plannow="${x.budget ?? ""}">${x.budget != null ? "change" : "set share"}</button></div>${x.budget != null && x.used != null ? bar(x.projected ?? x.used, x.budget) : ""}</div>`).join("");
  return `<h3 class="mt-4 font-semibold text-sm">🎟️ Plan use (subscription)</h3>${head}${rows}
    <div class="sub mt-1">A project's share is a percent of the plan's week. Sessions the hub starts for it (on its own, pushed jobs) don't start once it's used up; your own sessions never stop, the lead gets a heads-up instead.</div>`;
}
function wirePlan(p) {
  p.querySelectorAll("[data-planset]").forEach((b) => (b.onclick = async () => {
    const room = b.dataset.planset, hubStop = room === "hub-stop";
    const ans = window.prompt(hubStop ? "Hub-started sessions stop when the week reaches what percent? (blank = 90)" : `Share of the plan's week for ${room}, in percent (blank = no share):`, b.dataset.plannow || "");
    if (ans == null) return;
    try { await api("/agents/plan/budget", { room, pct: ans.trim() === "" ? null : Number(ans) }); toast(hubStop ? "Stop line saved" : ans.trim() === "" ? "Share cleared" : `${room}: ${ans}% of the week`); await load(); }
    catch (err) { toast(err.message, 6000); }
  }));
}
function showOutput(b, text) {
  const box = document.createElement("div"), id = b.dataset.out;
  box.innerHTML = `<button class="pill" style="margin-top:4px">✕ Hide the result</button><div class="md" style="font-size:13.5px;line-height:1.5;margin-top:6px;background:rgba(255,255,255,0.05);padding:10px;border-radius:8px;overflow-x:auto">${mdHtml(text)}</div>`;
  box.querySelector("button").onclick = () => { openOutputs.delete(id); box.replaceWith(b); };
  b.replaceWith(box);
}
// A small Markdown reader for results (headings, bold, italics, code, lists, tables, rules). Everything is escaped
// first, so a result can't put its own HTML on the page.
function mdHtml(src) {
  const inl = (t) => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>");
  const lines = String(src || "").replace(/\r/g, "").split("\n"), out = [];
  let list = null, i = 0;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { close(); const code = []; i++; while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]); i++; out.push(`<pre style="white-space:pre-wrap;font-size:12px;background:rgba(0,0,0,0.25);padding:6px;border-radius:6px">${esc(code.join("\n"))}</pre>`); continue; }
    if (/^\|.*\|\s*$/.test(l) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {
      close(); const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => inl(c.trim()));
      const head = cells(l); i += 2; const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<table style="border-collapse:collapse;margin:6px 0;font-size:12.5px"><tr>${head.map((c) => `<th style="text-align:left;border-bottom:1px solid rgba(255,255,255,0.2);padding:3px 6px">${c}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td style="border-bottom:1px solid rgba(255,255,255,0.08);padding:3px 6px;vertical-align:top">${c}</td>`).join("")}</tr>`).join("")}</table>`);
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)/), li = l.match(/^\s*[-*]\s+(.*)/), ol = l.match(/^\s*\d+[.)]\s+(.*)/);
    if (h) { close(); out.push(`<div style="font-weight:600;font-size:${[0, 16, 15, 14, 13.5][h[1].length]}px;margin:10px 0 4px">${inl(h[2])}</div>`); }
    else if (li || ol) { const want = li ? "ul" : "ol"; if (list !== want) { close(); out.push(`<${want} style="margin:4px 0 4px 18px;list-style:${li ? "disc" : "decimal"}">`); list = want; } out.push(`<li>${inl((li || ol)[1])}</li>`); }
    else if (/^\s*(---|\*\*\*)\s*$/.test(l)) { close(); out.push('<hr style="border-color:rgba(255,255,255,0.12);margin:8px 0">'); }
    else if (!l.trim()) close();
    else { close(); out.push(`<p style="margin:4px 0">${inl(l)}</p>`); }
    i++;
  }
  close();
  return out.join("");
}
function reopenOutputs(p) { p.querySelectorAll("[data-out]").forEach((b) => openOutputs.has(b.dataset.out) && showOutput(b, openOutputs.get(b.dataset.out))); }

function leisurePanel() {
  const p = showPanel("leisure", "Leisure", `
    <div class="sub mt-1">The fun stuff: shows and manga.</div>${doorsHtml("leisure")}`);
  fillDoors(p);
}

// the owner's control center: what's waiting for him, the campus at a glance, and his shortcuts.
function controlPanel() {
  const ps = projects.filter((p) => !p.isHr);
  const api$ = monthTotals().api, cr = data.credit?.claude;
  const p = showPanel("control", "CEO tower", `
    <div class="sub mt-1">Your tower: the Control Center on the ground floor, your own projects above it${hasPet() ? `, and ${esc(PET())}'s office on top` : ""}.</div>
    ${(() => { const hp = rooms.find((r) => r.isControl)?.homeProjects || []; return hp.length ? `<h3 class="mt-4 font-semibold text-sm">Your floors</h3><div class="flex flex-wrap gap-2 mt-1">${hp.map((x) => `<button class="pill" data-homefloor="${esc(x.id)}">${x.busy ? "● " : ""}${esc(x.name)} · ${x.desks.length} desk${x.desks.length === 1 ? "" : "s"}</button>`).join("")}</div>` : ""; })()}
    ${hasPet() ? `<div class="row">🐾 <b>${esc(PET())}, CEO</b> <span class="sub">· ${esc(rex.mode === "walk" ? "on a walkabout" : REX_PLACES[rex.spot] || "around campus")}</span></div>` : ""}
    ${(() => { const dv = projects.find((x) => x.id === "hub")?.desks.find((x) => x.id === "hub-builder"); return dv ? `<h3 class="mt-4 font-semibold text-sm">Dev corner</h3><div class="row"><b>hub-builder</b> <span class="chip">dev</span> <span class="chip">${esc(dv.status)}</span><div class="sub">${esc(dv.role || "")}</div><div class="sub">${esc([dv.provider, dv.model].filter(Boolean).join(" · "))}</div>${jobRows(dv)}${autonomyRow(dv)}</div>` : ""; })()}
    <h3 class="mt-4 font-semibold text-sm">Waiting for you (${inbox.length})</h3>
    ${inbox.length ? inbox.slice(0, 10).map((q) => `<div class="row">${q.kind === "ask" ? '<span class="chip">ask</span> ' : ""}${q.pr ? `<span class="chip">PR #${Number(q.pr)}</span> ` : ""}<b>${esc(q.role)}</b><div class="sub">${esc(q.room)} · from ${esc(q.from || "")} · ${esc(STATUS[q.status] || q.status)}</div></div>`).join("") + '<a href="/agents.html" class="pill inline-block mt-2">Decide on the Agents page</a>' : '<div class="sub">Nothing. All clear.</div>'}
    <h3 class="mt-4 font-semibold text-sm">Jobs you've handed out (${Object.values(jobsByDesk).flat().length} open)</h3>
    ${Object.values(jobsByDesk).flat().length ? Object.values(jobsByDesk).flat().slice(0, 10).map((j) => `<div class="row"><b>${esc(j.desk)}</b> <span class="chip">${esc(j.status)}</span> ${esc(j.text.slice(0, 90))}</div>`).join("") : '<div class="sub">None open. Tap any desk in a building to give it a job.</div>'}
    ${data.standup?.last ? `<h3 class="mt-4 font-semibold text-sm">Last board meeting (${esc(data.standup.last.day)})</h3>${data.standup.last.projects.map((x) => `<div class="row sub"><b style="color:inherit">${esc(x.name)}</b>: ${x.reports} reports, ${x.jobsDone} jobs done, ${x.jobsOpen} open${x.blocked?.length ? ` · <span style="color:#f0b45a">${esc(x.blocked.join(", "))}</span>` : ""}</div>`).join("")}` : ""}
    <h3 class="mt-4 font-semibold text-sm">At a glance</h3>
    <div class="row">${usd(api$)} API this month${cr ? ` · ${usd(Math.max(0, cr.left))} of ${usd(cr.balance)} Claude credit left` : ""}</div>
    <div class="row">${ps.filter((x) => !x.paused).length} projects running, ${ps.filter((x) => x.paused).length} on hold · ${ps.filter((x) => x.link?.linked).length} of ${ps.length} linked to the hub</div>
    <div class="row">${ps.filter((x) => x.busy).map((x) => esc(x.name)).join(", ") || "Nobody"} working right now</div>
    ${data.hook ? `<div class="row">Claude Code hook: ${data.hook.failing ? "failing" : data.hook.lastOkAt ? `last report ${ago(data.hook.lastOkAt)}` : "not seen yet"}</div>` : ""}
    ${(() => { const ws = Object.entries(data.wallets || {}); if (!ws.length) return ""; const nm = (id) => nameOf(data.desks.find((x) => x.id === id) || { id }); const top = ws.sort((a, b) => b[1].week - a[1].week).slice(0, 5).filter(([, w]) => w.week > 0); const recent = ws.flatMap(([id, w]) => (w.recent || []).map((r) => ({ id, ...r }))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 4);
      return `<h3 class="mt-4 font-semibold text-sm">💰 Payroll (campus credits, play money)</h3>${top.map(([id, w], i) => `<div class="row">${["🥇", "🥈", "🥉", "4.", "5."][i]} <b>${esc(nm(id))}</b> <span class="sub">${w.week} this week · ${w.balance} in the bank</span></div>`).join("") || '<div class="sub">Nobody earned anything this week yet.</div>'}${recent.length ? `<div class="sub" style="margin-top:4px">Recently bought: ${recent.map((r) => `${esc(nm(r.id))} ${esc(r.label)}`).join(" · ")}</div>` : ""}<div class="sub">Pay: job done 4 to 16 by its quality score (10 until HR scores it), shipped 15, hand-off picked up 3, stand-up 2, report 1 (20 a day). Never real money, caps or models.</div>`; })()}
    ${servicesHtml(null)}
    ${(data.autonomy || []).length ? `<h3 class="mt-4 font-semibold text-sm">Leads working on their own</h3>${data.autonomy.slice(0, 6).map((a) => `<div class="row"><b>${esc(nameOf(data.desks.find((x) => x.id === a.desk) || { id: a.desk }))}</b> <span class="sub">${a.live ? `🟢 until ${esc(untilTxt(a.until))}` : esc(a.status)}${a.last ? ` · ${esc(a.last)}` : ""}</span>${a.live ? ` <button class="pill" data-auto-stop="${esc(a.desk)}">Stop</button>` : ""}</div>`).join("")}` : ""}
    <h3 class="mt-4 font-semibold text-sm">The hub itself</h3>
    <div class="row" id="pApp"><span class="sub">Checking…</span></div>
    ${data.localRunner ? `<div class="row">Gemini workers (Antigravity): ${data.localRunner.on ? "checked every 15 min" : "off (AGENTS_LOCAL_RUNNER=off)"}${data.localRunner.running ? " · <b>running now</b>" : ""}<div class="sub">${esc(data.localRunner.error || data.localRunner.result || "No run yet")}${data.localRunner.lastRunAt ? ` · last run ${ago(data.localRunner.lastRunAt)}` : ""}</div></div>` : ""}
    ${actionsHtml("control")}
    ${doorsHtml("control")}
    <div class="flex flex-wrap gap-2 mt-3"><button class="pill" id="pOrg">Org chart</button><button class="pill" id="pHr">Run HR now</button><button class="pill" id="pLocal">Run Gemini jobs now</button><button class="pill" id="pRestart">Restart the hub</button></div>`);
  fillDoors(p);
  fillActions(p);
  wireJobs(p, "control");
  wireAutonomy(p);
  // The hub itself: how long it's been up, and whether code saved since needs a restart.
  api("/app").then((a) => {
    const el = document.getElementById("pApp"); if (!el) return;
    const up = Math.round(a.uptimeMs / 60000);
    el.innerHTML = `Running for ${up < 60 ? `${up} min` : `${Math.round(up / 60)} h`}${a.codeChanged?.length ? ` · <b style="color:#f0b45a">new code saved since it started (${a.codeChanged.length} file${a.codeChanged.length === 1 ? "" : "s"}): restart to load it</b>` : " · up to date"}${a.supervised ? "" : '<div class="sub">Started without start-pipeline.cmd, so Restart can\'t bring it back by itself.</div>'}${a.busy?.length ? `<div class="sub">Busy: ${esc(a.busy.join(", "))}</div>` : ""}`;
    const rb = document.getElementById("pRestart"); if (rb) rb.disabled = !a.supervised;
  }).catch(() => { const el = document.getElementById("pApp"); if (el) el.innerHTML = '<span class="sub">Couldn\'t check the app.</span>'; });
  const sf = document.getElementById("pSvcFresh"); if (sf) sf.onclick = async (e) => { e.preventDefault(); toast("Checking the services…"); await loadServices(true); controlPanel(); };
  document.getElementById("pOrg").onclick = () => orgPanel();
  p.querySelectorAll("[data-homefloor]").forEach((b) => (b.onclick = () => panel(b.dataset.homefloor)));
  document.getElementById("pLocal").onclick = async () => { try { const r = await postPw("/agents/local-run", {}); toast(r.error || r.result || "Checked", 6000); await load(); } catch (err) { toast(err.message, 6000); } };
  document.getElementById("pRestart").onclick = async () => {
    if (!await confirmBox({ title: "Restart the hub? The page comes back in about 20 seconds.", yes: "Restart", no: "Cancel" })) return;
    try {
      let r = await postPw("/app/restart", {});
      if (r && r.ok === false && r.busy?.length) { if (!await confirmBox({ title: `${r.message} Restart anyway?`, yes: "Restart anyway", no: "Cancel" })) return; r = await postPw("/app/restart", { force: true }); }
      if (r && r.ok === false) return toast(r.message, 8000);
      toast("Restarting. The campus comes back in about 20 seconds.", 8000);
      setTimeout(() => location.reload(), 20000);
    } catch (err) {
      if (err.cancelled) return;
      // Busy (a video job, a stats pull...): the hub answers 409 with what would be cut off.
      if (/middle of/i.test(err.message) && await confirmBox({ title: `${err.message} Restart anyway?`, yes: "Restart anyway", no: "Cancel" })) {
        try { await postPw("/app/restart", { force: true }); toast("Restarting. The campus comes back in about 20 seconds.", 8000); setTimeout(() => location.reload(), 20000); } catch (e2) { toast(e2.message, 8000); }
      } else toast(err.message, 8000);
    }
  };
  document.getElementById("pHr").onclick = async () => { try { const r = await postPw("/agents/hr/run", {}); toast(r?.reviewed ? `HR checked ${r.reviewed}` : "HR ran: nothing waiting"); } catch (err) { toast(err.message, 6000); } };
}
function feedText(f) {
  if (f.kind === "agent request") return f.decision ? `You ${esc(f.decision)} a request` : f.verdict ? `HR: ${esc(f.verdict)}${f.model ? ` · ${esc(f.model)}` : ""}` : `Request filed by ${esc(f.from || "")}: ${esc(f.role || "")}`;
  if (f.kind === "agent roster") return `Roster: ${esc(f.desk)} ${esc(f.change || "")}`;
  if (f.kind === "agent home") { if (!f.desk) return `🏠 ${esc(f.change || "The Residences changed")}`; const d = deskById(f.desk); return `🏠 <b>${esc(d ? nameOf(d) : f.desk || "")}</b> ${esc(f.change || "moved")}`; } // a Residences move (agents/campus.js homesState); no desk: the one re-plan line
  return `<b>${esc(f.desk || "")}</b> ${esc(f.action || "")}${f.tool ? ` · ${esc(f.tool)}` : ""}${f.summary ? ` · ${esc(f.summary)}` : ""}${f.costUsd ? ` · ${usd(f.costUsd)}${f.billing === "subscription" ? " sub" : ""}` : ""}`;
}
function closePanel() { openRoom = null; document.getElementById("panel").classList.remove("open"); }
// The shell every panel shares: header (title, extra buttons, the close button), the body, then open it.
// id sets openRoom (pass null to leave it alone); onClose is what the close button does.
function showPanel(id, titleHtml, bodyHtml, { buttons = "", onClose = closePanel } = {}) {
  if (id) openRoom = id;
  const p = document.getElementById("panel");
  const html = `<div class="flex items-start gap-2"><h2 class="flex-1">${titleHtml}</h2>${buttons}<button id="pClose" class="pill" aria-label="Close">✕</button></div>${bodyHtml}`;
  // Same content as what is already showing: leave it alone, so a refresh doesn't flicker pictures and pull-down menus.
  // (the mark sits on the node itself, so anything else that rewrote the panel in between is noticed)
  if (!(p.classList.contains("open") && p.firstElementChild?.__shown === html)) { p.innerHTML = html; if (p.firstElementChild) p.firstElementChild.__shown = html; }
  p.classList.add("open");
  document.getElementById("pClose").onclick = onClose;
  return p;
}

// The budget fountain on the central square (the owner, 2026-11-09: "clickable for relevant info"): how the money is
// doing this month. Full jets = healthy, a trickle = something is near its cap, dry = a cap is blown.
function fountainPanel() {
  const use = budgetUse(), desks = data?.desks || [];
  const state = use >= 1 ? ["Dry", "a budget cap is used up", "#e07a7a"] : use > 0.9 ? ["A trickle", "something is close to its cap", "#f0b45a"] : use > 0.6 ? ["Steady", "spending is past halfway on a cap", "#e8d48a"] : ["Full jets", "every budget has room", "#7ddc8a"];
  const { api: apiUsd, sub } = monthTotals();
  const cr = data?.credit?.claude;
  const projects = rooms.filter((r) => !r.isHouse && r.desks?.length && (r.spend || r.sub || r.cap)).sort((a, b) => (b.spend + b.sub) - (a.spend + a.sub));
  const capped = desks.filter((d) => d.capUsdMonth).map((d) => ({ d, k: (d.monthUsd || 0) / d.capUsdMonth })).sort((a, b) => b.k - a.k).slice(0, 5);
  const asks = (data?.requests || []).filter((q) => !q.decision && /\$|spend|budget|cap/i.test(`${q.role || ""} ${q.why || ""} ${q.question || ""}`));
  const bar = (k) => `<span style="display:inline-block;width:70px;height:6px;border-radius:3px;background:rgba(255,255,255,.1);vertical-align:middle"><span style="display:block;height:6px;border-radius:3px;width:${Math.min(100, k * 100).toFixed(0)}%;background:${k >= 1 ? "#e07a7a" : k > 0.9 ? "#f0b45a" : "#7ddc8a"}"></span></span>`;
  const p = showPanel("fountain", `The budget fountain <span class="sub">· this month</span>`, `
    <div class="row"><b style="color:${state[2]}">${state[0]}</b>: ${state[1]}. Highest use of any cap: ${(use * 100).toFixed(0)}%.</div>
    <div class="row">API money <b>${usd(apiUsd)}</b> · subscription use <b>${usd(sub)}</b>${cr?.balance > 0 ? ` · Claude credit left <b>${usd(Math.max(0, cr.left))}</b> of ${usd(cr.balance)}` : ""}</div>
    ${capped.length ? `<div class="row"><div class="sub">Closest to their caps</div>${capped.map(({ d, k }) => `<div>${esc(nameOf(d))} <span class="sub">${esc(roomName(d.room))}</span> ${bar(k)} <span class="sub">${usd(d.monthUsd || 0)} of ${usd(d.capUsdMonth)}</span></div>`).join("")}</div>` : ""}
    ${projects.length ? `<div class="row"><div class="sub">By project</div>${projects.map((r) => `<div>${esc(r.name)} <span class="sub">API ${usd(r.spend || 0)} · sub ${usd(r.sub || 0)}${r.cap ? ` · cap ${usd(r.cap)}` : ""}</span></div>`).join("")}</div>` : ""}
    ${asks.length ? `<div class="row"><div class="sub">Money questions waiting for you</div>${asks.map((q) => `<div>${esc(q.question || q.role || "")}</div>`).join("")}</div>` : ""}
    <div class="row sub">Workers take fountain breaks here when they're idle. The jets drop as any cap gets close.</div>`);
}

// Where a desk actually works (the owner 2026-11-09): its chat or session link, or which app on the PC it lives in.
function chatRow(d) {
  if (d.chatUrl) return `<div style="margin-top:6px"><a class="pill" href="${esc(safeUrl(d.chatUrl))}" target="_blank" rel="noopener">💬 Open their chat ↗</a> <button class="pill" data-chatset="${esc(d.id)}" style="opacity:.7">Change</button></div>`;
  const where = d.runner === "hub" ? "the hub runs this desk itself (no chat)" : d.runner === "local" ? `${d.app || "an app"} on your PC` : d.lead ? "a Claude Code session on your PC (desktop app → Code)" : "";
  return `<div class="sub" style="margin-top:6px">💬 ${where ? `Lives in ${esc(where)}. ` : ""}<button class="pill" data-chatset="${esc(d.id)}">Add chat link</button></div>`;
}
function wireChatLinks(p) {
  p.querySelectorAll("[data-chatset]").forEach((b) => (b.onclick = async () => {
    const d = data.desks.find((x) => x.id === b.dataset.chatset);
    const url = await confirmBox({ title: `Paste the link to ${nameOf(d)}'s chat or session (blank to clear):`, input: d?.chatUrl || "", yes: "OK", no: "Cancel" });
    if (url === null) return;
    try { await api("/agents/desk/chat", { id: b.dataset.chatset, url }); toast(url ? "Chat link saved" : "Chat link cleared"); await load(); } catch (err) { toast(err.message, 6000); }
  }));
}

// ---------- what changed since your last visit (the owner 2026-11-09 backlog) ----------
// Everything that happened since you last had the campus open (lastSeen, saved when you leave the page): merged PRs
// and shipped work, finished jobs, hand-offs, requests that came in or were answered, new hires and roster changes.
function sincePanel() {
  const since = lastSeen || Date.now() - 24 * 3600e3, after = (t) => Date.parse(t) > since;
  const feed = (data.feed || []).filter((f) => after(f.startedAt));
  const nm = (id) => { const d = deskById(id); return d ? nameOf(d) : tempName(id) || id || "someone"; }, room = (id) => roomLabel(id, projects.find((p) => p.id === id)?.name);
  const shipped = feed.filter((f) => /merged|PR #|shipped|job done|report/i.test(`${f.action} ${f.summary}`) && f.kind === "agent event");
  const jobs = (data.jobs || []).filter((j) => (j.status === "done" || j.status === "failed") && after(j.doneAt || j.at || 0));
  const reqNew = (data.requests || []).filter((q) => after(q.at) && !q.decision), reqDone = (data.requests || []).filter((q) => q.decision && after(q.decidedAt || q.at));
  const roster = feed.filter((f) => f.kind === "agent roster");
  const hand = feed.filter((f) => /hand-?off/i.test(f.action || ""));
  const sec = (title, list, line) => list.length ? `<h3 class="mt-4 font-semibold text-sm">${title} · ${list.length}</h3>${list.slice(0, 8).map((x) => `<div class="row">${line(x)}</div>`).join("")}${list.length > 8 ? `<div class="sub">…and ${list.length - 8} more in the full feed</div>` : ""}` : "";
  const p = showPanel("since", `Since your last visit <span class="sub">· ${lastSeen ? `${ageText(Date.now() - lastSeen)} ago` : "the last day"}</span>`, `
    ${!feed.length && !jobs.length && !reqNew.length && !reqDone.length ? '<div class="row sub">All quiet: nothing new since you last looked.</div>' : ""}
    ${sec("✅ Shipped and reported", shipped, (f) => `<b>${esc(nm(f.desk))}</b> <span class="sub">${esc(room(f.room))} · ${esc(f.action || "")}</span><div class="sub">${esc(String(f.summary || "").slice(0, 160))}</div>`)}
    ${sec("📌 Jobs finished", jobs, (j) => `<b>${esc(nm(j.desk))}</b> <span class="sub">${esc(j.status)}</span><div class="sub">${esc(String(j.summary || j.task || j.text || "").split("\n")[0].slice(0, 140))}</div>`)}
    ${sec("⏳ New asks waiting for you", reqNew, (q) => `<b>${esc(nm(q.from))}</b> <span class="sub">${esc(room(q.room))}</span><div class="sub">${esc(q.role || q.question || "")}</div>`)}
    ${sec("✔ Answered", reqDone, (q) => `<span class="sub">${esc(q.decision)} · ${esc(room(q.room))}</span><div class="sub">${esc(q.role || "")}</div>`)}
    ${sec("🔗 Hand-offs", hand, (f) => `<b>${esc(nm(f.desk))}</b><div class="sub">${esc(String(f.summary || "").slice(0, 140))}</div>`)}
    ${sec("📋 Other activity", feed.filter((f) => !shipped.includes(f) && !roster.includes(f) && !hand.includes(f)), (f) => `<b>${esc(nm(f.desk))}</b> <span class="sub">${esc(room(f.room))} · ${esc(f.action || f.kind || "")}</span>${f.summary ? `<div class="sub">${esc(String(f.summary).slice(0, 140))}</div>` : ""}`)}
    ${sec("👥 Staff changes", roster, (f) => `<b>${esc(nm(f.desk))}</b> <span class="sub">${esc(f.change || f.summary || "")}</span>`)}
    <div class="flex gap-2 mt-3"><button class="pill" id="pSeen">Mark all as seen</button></div>`);
  document.getElementById("pSeen").onclick = () => { lastSeen = Date.now(); try { localStorage.setItem("campus.lastSeen", String(lastSeen)); } catch {} build(); hud(); closePanel(); toast("All caught up"); };
}

// ---------- the clock tower: what runs on a schedule (the owner 2026-11-09 backlog) ----------
// The hub's own timers (server.js and src/pipeline/agents.js), the next lead stand-up, leads working on their own
// and blocker watches. Most timers count from when the hub started, so they show how often, not the exact minute.
function clockPanel() {
  const t = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const next = data?.standup?.next ? Date.parse(data.standup.next) : null;
  const auto = (data.autonomy || []).filter((a) => a.live);
  const watches = (data.blockers || []).filter((w) => w.status === "open");
  const rows = [
    ["🗳 Board meeting", `${(data.standup?.days || ["Mon", "Wed", "Fri"]).join(", ")} 9:00, CEO tower`, next ? `next ${new Date(next).toLocaleDateString([], { weekday: "short" })} ${t(next)}` : ""],
    ["🧑‍💼 HR desk reviews requests and caps", "every 3 hours", ""],
    ["🤖 Hub-run and Antigravity jobs", "every 15 minutes", ""],
    ["💬 Worker chatter (Gemini Flash)", "every 20 min, 8:00-23:00", ""],
    ["🛒 Campus Mart shopping", "every 20 minutes", ""],
    ["🚧 Blocker watches", "checked hourly, each once a day", `${watches.length} open`],
    ["🃏 Card prices", "every 6 hours", ""],
    ["☁ Nightly Google Drive backup", "nightly (a cloud scheduled task)", ""],
  ];
  const p = showPanel("clocktower", `Clock tower <span class="sub">· ${t(Date.now())}</span>`, `
    <div class="sub mt-1">What runs on its own, and how often.</div>
    ${auto.length ? `<h3 class="mt-4 font-semibold text-sm">🟢 Working on their own now</h3>${auto.map((a) => `<div class="row"><b>${esc(nameOf(deskById(a.desk) || { id: a.desk }))}</b> <span class="sub">until ${esc(t(Date.parse(a.until)))}</span></div>`).join("")}` : ""}
    <h3 class="mt-4 font-semibold text-sm">⏰ Schedules</h3>
    ${rows.map(([a, b, c]) => `<div class="row">${a}<div class="sub">${esc(b)}${c ? ` · <b style="color:#f3d9a4">${esc(c)}</b>` : ""}</div></div>`).join("")}
    ${watches.length ? `<h3 class="mt-4 font-semibold text-sm">🚧 Watching for</h3>${watches.map((w) => `<div class="row"><b>${esc(nameOf(deskById(w.desk) || { id: w.desk }))}</b><div class="sub">${esc(w.what || "")}</div></div>`).join("")}` : ""}`);
}


// Live view of a working session (2026-11-11): one chip per station it has used in the last 10 minutes (files, shell,
// web, sub-agents, plan, other tools), with a count, pulsing while fresh, red when a step failed; and how full its
// context was at its last reply. Data: desk.live from the Agents overview (the Claude Code hook's tool steps).
const LIVE_ST = { files: ["📄", "Files"], shell: ["⌨️", "Shell"], web: ["🌐", "Web"], agents: ["🤝", "Sub-agents"], plan: ["📝", "Plan"], tools: ["🧩", "Connected tools"], other: ["🔧", "Other"] };
function liveHtml(d) {
  const l = d.live; if (!l) return "";
  const now = Date.now(), order = ["files", "shell", "web", "agents", "plan", "tools", "other"];
  const chips = order.filter((k) => l.stations?.[k]).map((k) => {
    const s = l.stations[k], age = now - Date.parse(s.at), fresh = age < 45000, bad = s.failed > 0;
    const when = age < 60000 ? "just now" : `${Math.round(age / 60000)} min ago`;
    return `<span class="chip live-chip${fresh ? " live-fresh" : ""}${bad ? " live-bad" : ""}" title="${esc(`${LIVE_ST[k][1]}: ${s.n} step${s.n === 1 ? "" : "s"} in the last 10 minutes, last ${when}${s.last ? ` (${s.last})` : ""}${bad ? `; ${s.failed} failed` : ""}`)}">${LIVE_ST[k][0]} ${LIVE_ST[k][1]} <b>${s.n}</b>${bad ? ` · ${s.failed} ✕` : ""}</span>`;
  }).join(" ");
  const last = l.at ? (() => { const a = now - Date.parse(l.at); return a < 60000 ? "just now" : `${Math.round(a / 60000)} min ago`; })() : "";
  // context: shown against 200k, the usual window; a session on a bigger window just shows as full sooner than it is
  const ctxK = l.contextTokens ? Math.round(l.contextTokens / 1000) : 0, pct = Math.min(100, Math.round((l.contextTokens || 0) / 2000));
  const ctx = ctxK ? `<div class="sub" title="How much the session was holding in mind at its last reply. Near full, Claude Code tidies up (compacts) and can lose detail.">Context: about ${ctxK}k tokens <span class="live-bar"><span style="width:${pct}%;background:${pct > 85 ? "#f0b45a" : "#7ddc8a"}"></span></span></div>` : "";
  return `${chips ? `<div class="live-row">${chips}${last ? ` <span class="sub">last step ${last}</span>` : ""}</div>` : ""}${ctx}`;
}

// Add a project from the campus (2026-11-11): one form for the building, its lead and, for work on this PC, its folder.
function projectPanel() {
  const p = showPanel("addproject", "Add a project", `
    <div class="sub mt-1">This puts a new building on the campus and links the project into the hub.</div>
    <form class="pform" id="apForm">
      <label>Name<input type="text" id="apName" maxlength="60" placeholder="for example: Recipe app" required></label>
      <label>What is it? <span class="sub">(a line or two; the lead reads this)</span><textarea id="apAbout" rows="3" maxlength="600" placeholder="What you want built or done, and for whom"></textarea></label>
      <label>District<select id="apDistrict"><option>Tools</option><option>Games</option><option>Creative</option></select></label>
      ${(HUB.teams || []).length ? `<label>Team <span class="sub">(a standard crew on top of the lead; HR staffs it and you approve each hire)</span><select id="apTeam"><option value="">Just the lead</option>${HUB.teams.flatMap((t) => t.sizes.map((z) => `<option value="${esc(t.id)}:${esc(z.id)}" data-district="${esc(t.district || "")}" data-roles="${esc(z.roles.join(", "))}">${esc(t.name)}: ${esc(z.name)} · ${z.roles.length} roles</option>`)).join("")}</select></label><div class="sub" id="apTeamRoles"></div>` : ""}
      <label style="margin-top:14px">Who leads it?</label>
      <label class="opt"><input type="radio" name="apLead" value="code" checked><span><b>Claude Code on this PC</b><br><span class="sub">Builds files in the project's own folder, on your subscription. Best for anything that's code.</span></span></label>
      <label class="opt"><input type="radio" name="apLead" value="hub"><span><b>A worker the hub runs</b><br><span class="sub">Plans, researches and writes; can't create files. HR picks the model and you approve it.</span></span></label>
      <label class="opt"><input type="radio" name="apLead" value="none"><span><b>Nobody yet</b><br><span class="sub">Just the building for now.</span></span></label>
      <div id="apFolderBox"><label>Folder on this PC<input type="text" id="apFolder" maxlength="300" placeholder="D:\\RecipeApp" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        <div class="sub">A full path. If it doesn't exist the hub makes it; if it does, nothing in it is replaced.</div></div>
      <div id="apJobBox"><label>First job <span class="sub">(optional)</span><textarea id="apJob" rows="2" maxlength="2000" placeholder="for example: write the design and propose the first three steps"></textarea></label></div>
      <div class="flex gap-2 mt-3"><button class="pill" style="background:#f3d9a4;color:#1b1f27" id="apGo" type="submit">Add project</button><button class="pill" type="button" id="apCancel">Cancel</button></div>
      <div class="sub mt-2" id="apMsg"></div>
    </form>`);
  document.getElementById("apCancel").onclick = closePanel;
  const kind = () => p.querySelector("input[name=apLead]:checked").value;
  const sync = () => { document.getElementById("apFolderBox").style.display = kind() === "code" ? "" : "none"; document.getElementById("apJobBox").style.display = kind() === "none" ? "none" : ""; };
  p.querySelectorAll("input[name=apLead]").forEach((el) => (el.onchange = sync));
  const teamSel = document.getElementById("apTeam");
  if (teamSel) teamSel.onchange = () => { const o = teamSel.selectedOptions[0], d = o?.dataset.district; if (d) document.getElementById("apDistrict").value = d; document.getElementById("apTeamRoles").textContent = o?.dataset.roles ? `Crew: ${o.dataset.roles}, plus the lead.` : ""; };
  sync();
  document.getElementById("apForm").onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById("apMsg"), go = document.getElementById("apGo");
    const body = { name: document.getElementById("apName").value, about: document.getElementById("apAbout").value, district: document.getElementById("apDistrict").value, lead: kind(), folder: document.getElementById("apFolder").value, firstJob: document.getElementById("apJob").value };
    if (teamSel?.value) { const [team, size] = teamSel.value.split(":"); body.team = team; body.size = size; }
    if (body.lead === "code" && !body.folder.trim()) { msg.style.color = "#f0b45a"; msg.textContent = "Give the folder for the project, like D:\\RecipeApp."; return; }
    go.disabled = true; msg.style.color = ""; msg.textContent = "Adding…";
    try {
      const r = await postPw("/agents/project", body);
      await load();
      showPanel(null, `${esc(r.name)} is added`, `
        ${(r.done || []).map((d) => `<div class="row">✓ ${esc(d)}</div>`).join("")}
        <div class="sub mt-2">${r.lead ? "Give its lead a job from its building, then press Push." : r.request ? "The lead request is in your queue once HR has checked it (Run HR now speeds that up)." : "Open its building to add staff when you're ready."}</div>
        <div class="flex gap-2 mt-3"><button class="pill" id="apOpen">Open its building</button></div>`);
      document.getElementById("apOpen").onclick = () => { try { openRoom = r.room; panel(r.room); } catch { closePanel(); } };
    } catch (err) { go.disabled = false; msg.style.color = "#f0b45a"; msg.textContent = err.message; }
  };
}

// What a worker's own session may use on this PC (2026-11-11): running its code, Godot, web search, and anything the
// hub settings add. the owner ticks them per worker; it asks for the password, because it widens what runs on the PC.
function accessPanel(deskId) {
  const d = data.desks.find((x) => x.id === deskId); if (!d) return;
  const back = openRoom;
  const have = new Set(d.grants || []), list = data.grants || [];
  const done = () => { if (back && back !== "access") { try { openRoom = back; panel(back); return; } catch {} } closePanel(); };
  const p = showPanel("access", `Access for ${esc(nameOf(d))}`, `
    <div class="sub mt-1">${esc(d.id)}. What this worker's own session may use when you Push a job or let it work on its own. Everything here is off until you turn it on.</div>
    <form class="pform" id="acForm">
      ${list.map((g) => `<label class="opt"><input type="checkbox" value="${esc(g.id)}"${have.has(g.id) ? " checked" : ""}><span><b>${esc(g.label)}</b><br><span class="sub">${esc(g.about)}${g.risk ? ` <span style="color:#f0b45a">${esc(g.risk)}</span>` : ""}<br>${(g.users || []).length ? `Used by ${esc(g.users.map((u) => nameOf(data.desks.find((x) => x.id === u) || { id: u })).join(", "))}` : '<span style="color:#f0b45a">Nobody uses this yet</span>'}</span></span></label>`).join("") || '<div class="sub">Nothing to grant on this hub.</div>'}
      <div class="sub mt-2">The hub's keys are never handed to a worker, and it still can't read the hub's settings or data with its own tools. Code it runs isn't held to that, so only give "run its own code" to workers building things you asked for.</div>
      <div class="flex gap-2 mt-3"><button class="pill" style="background:#f3d9a4;color:#1b1f27" id="acGo" type="submit">Save</button><button class="pill" type="button" id="acCancel">Cancel</button></div>
      <div class="sub mt-2" id="acMsg"></div>
    </form>`, { onClose: done });
  document.getElementById("acCancel").onclick = done;
  document.getElementById("acForm").onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById("acMsg"), go = document.getElementById("acGo");
    const grants = [...p.querySelectorAll("#acForm input[type=checkbox]:checked")].map((x) => x.value);
    go.disabled = true; msg.style.color = ""; msg.textContent = "Saving…";
    try { await postPw("/agents/desk/grants", { id: deskId, grants }); await load(); toast(grants.length ? `${nameOf(d)} can now use: ${grants.map((g) => list.find((x) => x.id === g)?.label || g).join(", ")}. It applies from its next session.` : `${nameOf(d)} is back to the standard list.`, 7000); done(); }
    catch (err) { go.disabled = false; msg.style.color = "#f0b45a"; msg.textContent = err.message; }
  };
}
document.addEventListener("click", (e) => { const b = e.target.closest?.("[data-access]"); if (!b) return; e.preventDefault(); accessPanel(b.dataset.access); });
