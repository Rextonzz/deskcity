// Campus: the glance props (page blocks, step 2; the owner OK'd the mock-ups 2026-11-14). A live, tappable piece of a page
// that sits in its building, so the common things can be done without opening the page:
//   the queue board ("Departures") in the YouTube building: every video that needs you, is stuck, is on the go or is
//     booked; tap one for what you can do (retry, start over, skip, make public, open its card);
//   the meter wall in the Control Center (and the hub building): the month's spend against the caps for the whole
//     hub and each worker; tap a tube to add an alert rule or open AI and spend.
// Where they show: at the top of the building's panel (2D and 3D, outside or on a floor), and in Neural on a picked
// worker or job of that building's team. One call feeds both (GET /api/pipeline/glance), asked every 20 s while a prop
// is on screen. Their actions are the blocks' own (ACTIONS in public/parts/<page>.js), the same ones the pages use, and
// run only from your own tap (a trusted event). Part of public/campus.html; shares one global scope with the other
// parts, so everything here is inside this function except window.campusProps.
(function () {
  const e$ = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const PROPS = { pipeline: board, ai: meters }; // block page -> how its prop draws
  let g = null, gAt = 0, asking = null, sheetEl = null, lastFocus = null;

  // ---------- data ----------
  async function load(force) {
    if (asking) return asking;
    if (!force && g && Date.now() - gAt < 15000) return g;
    asking = fetch("/api/pipeline/glance").then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((x) => { asking = null; if (x) { g = x; gAt = Date.now(); } return g; });
    return asking;
  }
  // which props a room shows: the blocks that live there, are switched on, and have a prop
  const propsFor = (room) => (window.campusBlocks?.list() || []).filter((b) => PROPS[b.page] && b.rooms.includes(room));
  const nameOfDesk = (id) => { const d = typeof data !== "undefined" ? (data?.desks || []).find((x) => x.id === id) : null; return d && typeof nameOf === "function" ? nameOf(d) : id; };
  const money = (v) => `$${Math.round(v || 0)}`;

  // ---------- the queue board ----------
  const ST = { you: ["⚠", "YOURS", "Waiting on you"], private: ["▣", "PRIVATE", "Private, ready to post"], stuck: ["✕", "STUCK", "Stuck"], up: ["▶", "GOING UP", "Going up now"], making: ["◔", "MAKING", "Being made"], wait: ["○", "IN LINE", "In line"], set: ["✓", "BOOKED", "Booked"] };
  const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "");
  const dayTag = (iso) => { if (!iso) return ""; const d = new Date(iso), t = new Date(); const days = Math.round((new Date(d.toDateString()) - new Date(t.toDateString())) / 864e5); return days === 0 ? "" : days === 1 ? "Tm " : `${d.toLocaleDateString([], { weekday: "short" })} `; };
  function board(p) {
    if (!p) return "";
    const rows = (p.items || []).map((x) => {
      const [sym, word, long] = ST[x.state] || ["·", x.state, x.state];
      const t = x.at ? `${dayTag(x.at)}${hhmm(x.at)}` : x.state === "making" || x.state === "up" ? "NOW" : x.state === "wait" ? "NEXT" : "—";
      return `<button type="button" class="pq-row" data-prop-item="pipeline:${e$(x.id)}" aria-label="${e$(x.title)}: ${e$(long)}${x.at ? `, ${e$(t)}` : ""}">
        <span class="pq-t">${e$(t)}</span><span class="pq-ch">${e$(chShort(x.channel) || String(x.channelName || "").slice(0, 2).toUpperCase())}</span>
        <span class="pq-ti">${e$(x.title)}</span><span class="pq-st pq-${x.state}">${sym} ${word}</span></button>`;
    }).join("");
    return `<section class="prop pq" aria-label="Queue board"><div class="prop-head"><span>Departures</span><button type="button" class="prop-open" data-prop-open="pipeline" title="Open Pipeline">Pipeline ↗</button></div>
      <div class="prop-line">${e$(p.line)}</div>${rows || '<div class="prop-empty">Nothing booked or waiting.</div>'}${p.more ? `<button type="button" class="prop-more" data-prop-open="pipeline">${p.more} more in Pipeline</button>` : ""}</section>`;
  }

  // ---------- the meter wall ----------
  const WORD = { over: "▲ over", near: "● near", ok: "✓ ok" };
  function tube(d, name, big, key) {
    const ahead = Math.max(d.projected || 0, d.projectedTrend || 0), top = Math.max(d.cap || 0, ahead, d.spent || 0, 0.01) * 1.08, pct = (v) => Math.min(100, ((v || 0) / top) * 100);
    const word = d.paused ? "⏸ paused" : d.cap == null ? "no cap" : WORD[d.label] || d.label;
    return `<button type="button" class="pm-m${big ? " big" : ""}" data-prop-item="ai:${e$(key)}" aria-label="${e$(name)}: ${money(d.spent)} spent${d.cap != null ? ` of ${money(d.cap)}` : ""}, heading for ${money(ahead)}, ${e$(word)}">
      <span class="pm-tube"><span class="pm-fill${d.label === "over" ? " hatch" : ""}" style="height:${pct(d.spent)}%"></span>${d.cap != null ? `<span class="pm-cap" style="top:${100 - pct(d.cap)}%"></span>` : ""}<span class="pm-proj" style="bottom:${pct(ahead)}%"></span></span>
      <span class="pm-lab">${e$(name)}</span><span class="pm-val">${money(d.spent)}${d.cap != null ? `/${money(d.cap)}` : ""}</span><span class="pm-word">${e$(word)}</span></button>`;
  }
  function meters(a) {
    if (!a) return "";
    const tubes = (a.hub ? tube(a.hub, "Whole hub", true, "hub") : "") + (a.desks || []).map((d) => tube(d, nameOfDesk(d.id), false, d.id)).join("");
    return `<section class="prop pm" aria-label="Meter wall"><div class="prop-head"><span>Meter wall</span><button type="button" class="prop-open" data-prop-open="ai" title="Open AI and spend">AI and spend ↗</button></div>
      <div class="prop-line">${e$(a.line)}</div>${a.plan ? `<div class="pm-plan">Plan use (your subscriptions, priced as if on the API; not real spend): ${money(a.plan.spent)} so far, heading for ${money(a.plan.projected)}</div>` : ""}${tubes ? `<div class="pm-wall">${tubes}</div><div class="prop-key">Fill = spent · top line = cap · dashed ▸ = where the month is heading. Over is hatched too.</div>` : '<div class="prop-empty">No spend yet this month.</div>'}${noteHtml(a.note)}</section>`;
  }
  // The latest weekly money note from Finance (Mondays), folded so the wall stays short.
  function noteHtml(n) {
    if (!n) return '<div class="prop-key">No weekly money note yet: Finance writes one on Mondays.</div>';
    return `<details class="pm-note"><summary>This week's money note · ${e$(nameOfDesk(n.desk))} · ${e$(new Date(n.at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }))}</summary><div>${e$(n.text)}</div></details>`;
  }

  // the props for a room, as HTML ("" when it has none, or the glance hasn't arrived yet)
  function htmlFor(room) {
    if (!g || !room) return "";
    return propsFor(room).map((b) => PROPS[b.page](b.page === "pipeline" ? g.pipeline : g.ai)).join("");
  }

  // ---------- where they show ----------
  // 2D and 3D: the top of the building's panel (the building itself, a floor of it, or the CEO tower), not a worker's
  // card or any other panel. panel(id) and controlPanel() (panels.js, loaded after this file) are wrapped once they
  // exist: whichever panel they draw is a building's; every other showPanel() clears it.
  let roomPanel = null, drawing = null;
  (function hook() {
    if (typeof panel !== "function" || typeof controlPanel !== "function" || typeof showPanel !== "function") return setTimeout(hook, 200);
    const wrap = (fn, roomOf) => function (...args) { const was = drawing; drawing = roomOf(...args); try { return fn.apply(this, args); } finally { drawing = was; } };
    panel = wrap(panel, (id) => (/^(worker|house):|^homes/.test(String(id)) ? null : String(id).split("::")[0]));
    controlPanel = wrap(controlPanel, () => "control");
    const show = showPanel;
    showPanel = function (...args) { roomPanel = drawing; return show.apply(this, args); };
  })();
  const roomOfPanel = () => roomPanel;
  function fillPanel() {
    const p = document.getElementById("panel"), room = roomOfPanel();
    if (!p?.classList.contains("open") || !room || !propsFor(room).length) return;
    const html = htmlFor(room);
    let slot = p.querySelector(":scope > .prop-slot");
    if (!html) { if (!g) load().then(() => fillPanel()); return; }
    if (!slot) { slot = document.createElement("div"); slot.className = "prop-slot"; (p.firstElementChild ? p.firstElementChild.after(slot) : p.prepend(slot)); }
    if (slot.dataset.room !== room || slot.innerHTML !== html) { slot.dataset.room = room; slot.innerHTML = html; }
  }
  const panelEl = document.getElementById("panel");
  if (panelEl) new MutationObserver((list) => { if (list.some((m) => [...m.addedNodes].some((n) => !n.classList?.contains("prop-slot")))) fillPanel(); }).observe(panelEl, { childList: true });
  // Neural: a picked worker or job of the building's team (neuralweb.js / neural.js ask for it, as for the buttons).
  function neuralHtml(room) {
    if (!room || !propsFor(room).length) return "";
    if (!g) load().then(() => document.querySelectorAll("#neuralFeed [data-prop-room]").forEach((el) => (el.innerHTML = htmlFor(el.dataset.propRoom))));
    return `<div data-prop-room="${e$(room)}">${htmlFor(room)}</div>`;
  }
  // keep what's on screen fresh, and only ask while a prop is showing
  setInterval(async () => {
    if (document.visibilityState !== "visible" || !document.querySelector(".prop")) return;
    await load(true);
    fillPanel();
    document.querySelectorAll("#neuralFeed .prop").forEach((el) => { const room = el.closest("[data-prop-room]")?.dataset.propRoom; if (room) el.closest("[data-prop-room]").innerHTML = htmlFor(room); });
  }, 20000);

  // ---------- tapping an item: what you can do ----------
  function sheet(html) {
    if (!sheetEl) { sheetEl = document.createElement("aside"); sheetEl.className = "prop-sheet"; sheetEl.setAttribute("aria-live", "polite"); document.body.append(sheetEl); }
    if (!sheetEl.classList.contains("open")) lastFocus = document.activeElement;
    sheetEl.innerHTML = `<button type="button" class="prop-x" data-prop-close aria-label="Close">✕</button>${html}`;
    sheetEl.classList.add("open");
    sheetEl.querySelector("[data-prop-act], [data-prop-open], button")?.focus();
  }
  function shut() { if (!sheetEl?.classList.contains("open")) return; sheetEl.classList.remove("open"); try { lastFocus?.focus?.({ preventScroll: true }); } catch {} }
  const isOpen = () => !!sheetEl?.classList.contains("open");
  const actBtn = (id, label, opt = {}) => `<button type="button" class="prop-act${opt.main ? " main" : ""}" data-prop-act="${e$(id)}"${opt.arg != null ? ` data-arg="${e$(opt.arg)}"` : ""}${opt.desk ? ` data-desk="${e$(opt.desk)}"` : ""}><span>${e$(label)}${opt.pw ? ' <span title="needs your dashboard password">🔒</span>' : ""}</span>${opt.note ? `<small>${e$(opt.note)}</small>` : ""}</button>`;
  let current = null; // { kind, id, item }
  async function itemSheet(kind, id) {
    if (kind === "pipeline") {
      const x = (g?.pipeline?.items || []).find((i) => i.id === id); if (!x) return;
      const mod = await import("/parts/pipeline.js"), A = mod.ACTIONS;
      current = { kind, id, item: x };
      const acts = (mod.ITEM_ACTIONS[x.state] || []).map((k, i) => actBtn(k, A[k].label, { main: i === 0, pw: A[k].needsPassword }));
      const card = actBtn("card", x.state === "you" ? (x.needsCard ? "Answer it on its card" : "Open its card to carry on") : "Open its card in Pipeline", { main: !acts.length || x.state === "you" });
      const [, , long] = ST[x.state] || [];
      sheet(`<h4>${e$(x.title)}</h4><div class="prop-sub">${e$(x.channelName)} · ${e$(long)}${x.at ? ` · ${e$(new Date(x.at).toLocaleString())}` : ""}${x.step ? ` · at ${e$(x.step)}` : ""}</div>${x.why ? `<div class="prop-why">${e$(x.why)}</div>` : ""}
        ${x.state === "you" ? card + acts.join("") : acts.join("") + card}`);
    } else if (kind === "ai") {
      const a = g?.ai, d = id === "hub" ? a?.hub : (a?.desks || []).find((i) => i.id === id); if (!d) return;
      const mod = await import("/parts/ai.js"), A = mod.ACTIONS, name = id === "hub" ? "Whole hub" : nameOfDesk(id);
      current = { kind, id, item: d };
      const per = Math.max(1, Math.round((d.cap || Math.max(d.projected, 10)) / 10));
      const top = a.top;
      const acts = id === "hub" ? [actBtn("monthOver", A.monthOver.label(), { main: true, note: "an alert rule; texts your phone when it fires" }),
          ...(top ? [actBtn("pause", `Pause the biggest spender: ${nameOfDesk(top.id)}`, { desk: top.id, note: `${money(top.spent)} of API spend this month; asks first` })] : [])]
        : [actBtn("dayRule", A.dayRule.label(per), { main: true, arg: per, note: "an alert rule; texts your phone when it fires" }),
          ...(d.cap != null ? [actBtn("deskOver", A.deskOver.label(), { note: "an alert rule" }),
            `<div class="prop-sub" style="margin-top:8px">Heads-up at a share of its cap (once a month):</div><div class="prop-row">${[25, 50, 75].map((p) => actBtn("capPct", `${p}%`, { arg: p })).join("")}</div>`] : []),
          d.paused ? actBtn("resume", A.resume.label(), { pw: true, note: "it's paused: the hub isn't running its jobs" }) : actBtn("pause", A.pause.label(), { note: "the hub stops running its jobs; asks first" })];
      sheet(`<h4>${e$(name)}</h4><div class="prop-sub">${money(d.spent)} spent this month · heading for ${money(d.projected)} (last 7 days' pace ${money(d.projectedTrend)})${d.cap != null ? ` · cap ${money(d.cap)} · ${e$(WORD[d.label] || d.label)}` : " · no cap"}</div>
        ${acts.join("")}${id === "hub" ? "" : actBtn("capForm", A.setCap.label(), { note: d.cap != null ? `now ${money(d.cap)} a month` : "no cap now" })}${actBtn("card", "Open AI and spend")}`);
    }
  }
  // The cap form (meter wall): a new monthly cap for one worker. Lowering it is instant; raising or removing it lets the
  // worker spend more, so the hub asks for the dashboard password (POST /agents/desk/cap; deskChangeSpends).
  function capSheet() {
    const { id, item: d } = current || {}; if (!d) return;
    sheet(`<h4>${e$(nameOfDesk(id))}'s cap</h4><div class="prop-sub">${d.cap != null ? `Now ${money(d.cap)} a month.` : "No cap now."} Lowering it happens straight away; raising it lets the worker spend more, so the hub asks for your password.</div>
      <label class="prop-sub" for="propCap" style="display:block;margin-top:8px">New monthly cap in dollars</label>
      <input id="propCap" class="prop-num" type="number" inputmode="decimal" min="0" step="1" value="${d.cap != null ? e$(d.cap) : ""}">
      ${actBtn("setCap", "Save the cap", { main: true })}${actBtn("back", "Cancel")}`);
    sheetEl.querySelector("#propCap")?.focus();
  }
  async function runAct(btn) {
    const { kind, id, item } = current || {}; if (!kind) return;
    const act = btn.dataset.propAct;
    if (act === "card") { shut(); return window.campusBlocks?.open(kind, btn, kind === "pipeline" ? { focus: id } : {}); }
    if (act === "capForm") return capSheet();
    if (act === "back") return itemSheet(kind, id);
    let arg = btn.dataset.arg ? Number(btn.dataset.arg) : undefined;
    if (act === "setCap") {
      const v = sheetEl.querySelector("#propCap")?.value.trim();
      if (v === "" || !(Number(v) >= 0)) { sheetEl.insertAdjacentHTML("beforeend", '<div class="prop-why" role="alert">Type a number of dollars, 0 or more.</div>'); return; }
      arg = Number(v);
    }
    const A = (await import(`/parts/${kind}.js`)).ACTIONS[act]; if (!A) return;
    if (A.ask && !(await window.confirmBox(A.ask))) return;
    btn.disabled = true;
    const was = btn.innerHTML;
    btn.innerHTML = "<span>Working…</span>";
    try {
      const desk = btn.dataset.desk || (id === "hub" ? undefined : id);
      if (kind === "pipeline") await A.run(id); else await A.run(desk, arg);
      shut();
      const who = desk ? nameOfDesk(desk) : "the whole hub";
      const said = { setCap: `${who}'s cap is now $${arg} a month`, pause: `${who} is paused`, resume: `${who} is running again`, capPct: `You'll hear when ${who} reaches ${arg}% of its cap` }[act];
      if (typeof toast === "function") toast(said || (kind === "ai" ? `Alert rule added for ${who}` : `${A.label}: ${item.title}`));
      await load(true); fillPanel();
    } catch (err) {
      btn.disabled = false; btn.innerHTML = was;
      if (!err?.cancelled) sheetEl.insertAdjacentHTML("beforeend", `<div class="prop-why" role="alert">${e$(err?.message || "That didn't work.")}</div>`);
    }
  }
  // Only the owner's own tap runs anything (isTrusted): never a click made by a script or by text on a page.
  document.addEventListener("click", (e) => {
    const it = e.target.closest?.("[data-prop-item]");
    if (it) { e.preventDefault(); const [kind, ...rest] = it.dataset.propItem.split(":"); itemSheet(kind, rest.join(":")); return; }
    const op = e.target.closest?.("[data-prop-open]");
    if (op) { e.preventDefault(); shut(); window.campusBlocks?.open(op.dataset.propOpen, op); return; }
    if (e.target.closest?.("[data-prop-close]")) { shut(); return; }
    const ac = e.target.closest?.("[data-prop-act]");
    if (ac && e.isTrusted) { e.preventDefault(); runAct(ac); }
  });
  // Esc closes this sheet first (blocks.js's sheet, when open, takes Esc before it).
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !isOpen() || window.campusBlocks?.isOpen() || document.querySelector('dialog[open], [aria-modal="true"]')) return;
    e.preventDefault(); e.stopImmediatePropagation(); shut();
  }, true);

  window.campusProps = { htmlFor: neuralHtml, refresh: () => load(true).then(fillPanel), isOpen, close: shut };
})();
