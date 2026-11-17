// Campus: the command bar (page blocks, step 3; the owner 2026-11-14: "a command bar in every view (a terminal in Neural;
// typed text that matches an action runs it, anything else can go to a worker as a job)").
// Open it with > or : (anywhere outside a text box), the ›_ button in the HUD, or the one in Neural's top bar. Over the
// 2D and 3D city it's a dark glass bar at the top; over Neural it's a terminal at the bottom (monospace, a prompt line,
// a scrollback of what ran and what came back).
// What it can run: the built-ins (help, rooms, open <page>, view 2d|3d|neural|pages), every switched-on block's
// actions (ACTIONS in public/parts/<page>.js: the same functions the pages' buttons and the glance props call, never
// copies), one per video or worker they apply to, and the plain pages of the menu. Matching is
// public/campus/cmdmatch.js (pure, tested). Anything that matches nothing can go to a worker as a job (POST
// /agents/job, the same route and password rule as the campus's "Give a job"); it waits in their queue until pushed.
// Only your own key press or tap runs anything (event.isTrusted); text from a page, a reply or a tool's output never
// runs. Esc closes it before anything else hears it; keys typed in it don't reach the campus's shortcuts.
// Part of public/campus.html; shares one global scope with the other parts, so everything here is inside this
// function except window.campusCommand.
(function () {
  const M = window.campusCmdMatch;
  const e$ = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const offPages = () => (typeof HUB !== "undefined" && Array.isArray(HUB.offPages) ? HUB.offPages : []);
  const blocksOn = () => window.campusBlocks?.list() || (window.hubBlocks || []).filter((b) => !offPages().includes(b.page));
  const desks = () => (typeof data !== "undefined" && data?.desks) || [];
  // A cap in words: whole dollars from $10, cents below that, and a cap under a dime keeps its digits ($0.2 was shown as "$0").
  const capText = (c) => (c >= 10 ? String(Math.round(c)) : String(Number(Number(c).toFixed(c < 0.1 ? 3 : 2))));
  const deskName = (id) => { const d = desks().find((x) => x.id === id); return d && typeof nameOf === "function" ? nameOf(d) : id; };
  const inNeural = () => typeof neural !== "undefined" && !!neural;
  const ST = { you: "waiting on you", private: "private ready", stuck: "stuck", up: "going up", making: "being made", wait: "in line", set: "booked" };
  let bar = null, input = null, list = null, logEl = null, jobEl = null, sugg = [], sel = 0, busy = false, lastFocus = null;
  let glance = null, glanceAt = 0;
  const mods = {}; // block page -> its module (for ACTIONS), loaded when the bar first opens
  const part = (k) => bar.querySelector(`[data-cb="${k}"]`);

  // ---------- the bar ----------
  function build() {
    const st = document.createElement("style");
    st.textContent = CSS;
    document.head.append(st);
    bar = document.createElement("section");
    bar.className = "cbar";
    bar.hidden = true;
    bar.setAttribute("role", "dialog");
    bar.setAttribute("aria-label", "Command bar");
    bar.innerHTML = `<div class="cb-log" data-cb="log" aria-live="polite"></div>
      <div class="cb-line"><span class="cb-prompt" data-cb="prompt" aria-hidden="true">›</span><input data-cb="in" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="cmdBarList" aria-label="Type a command, or anything to give a worker"><button type="button" class="cb-x" data-cb="x" title="Close (Esc)" aria-label="Close">✕</button></div>
      <ul class="cb-list" id="cmdBarList" data-cb="list" role="listbox" aria-label="Suggestions"></ul>
      <div class="cb-job" data-cb="job" hidden></div>
      <div class="cb-hint">↑ ↓ pick · Enter runs it · Esc closes · type <b>help</b></div>`;
    document.body.append(bar);
    input = part("in"); list = part("list"); logEl = part("log"); jobEl = part("job");
    part("x").onclick = () => close();
    input.addEventListener("input", () => { jobEl.hidden = true; render(); });
    // a tap on a suggestion runs it (your own tap only)
    list.addEventListener("click", (e) => {
      const li = e.target.closest("[data-i]"); if (!li || !e.isTrusted) return;
      sel = Number(li.dataset.i); go(e);
    });
    bar.addEventListener("click", (e) => {
      if (e.target.closest("[data-cb-give]")) { if (e.isTrusted) giveJob(); return; }
      if (e.target.closest("[data-cb-cancel]")) { jobEl.hidden = true; input.focus(); return; }
      // following a job in Neural, or a page link: the bar steps out of the way
      if (e.target.closest("[data-neural], a[href]")) setTimeout(() => close(true), 0);
    });
  }

  function open(prefill = "") {
    if (!bar) build();
    const skin = inNeural() ? "neural" : "campus";
    bar.classList.toggle("cb-neural", skin === "neural");
    bar.classList.toggle("cb-campus", skin === "campus");
    part("prompt").textContent = skin === "neural" ? "hub ›" : "›";
    if (bar.hidden) lastFocus = document.activeElement;
    bar.hidden = false;
    bar.setAttribute("aria-modal", "true"); // the sheet's and the props' Esc leave it to this bar
    input.value = prefill;
    jobEl.hidden = true;
    input.focus();
    render();
    load().then(() => { if (!bar.hidden) render(); });
  }
  function close(keepFocus) {
    if (!bar || bar.hidden) return;
    bar.hidden = true;
    bar.removeAttribute("aria-modal");
    input.setAttribute("aria-expanded", "false");
    if (!keepFocus) try { lastFocus?.focus?.({ preventScroll: true }); } catch {}
  }
  const isOpen = () => !!bar && !bar.hidden;

  // The blocks' actions and the glance (which videos and workers they apply to), fresh within 15 s.
  async function load() {
    const on = blocksOn().map((b) => b.page);
    await Promise.all(on.filter((p) => !mods[p]).map((p) => import(`/parts/${p}.js`).then((m) => (mods[p] = m)).catch(() => {})));
    if ((on.includes("pipeline") || on.includes("ai")) && Date.now() - glanceAt > 15000) {
      const g = await fetch("/api/pipeline/glance").then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (g) { glance = g; glanceAt = Date.now(); }
    }
  }

  // ---------- what can be typed ----------
  // Every entry: { label, words, target?, takes?, show?(arg), needsPassword?, kind, run(arg) }.
  function catalogue() {
    const out = [];
    const on = blocksOn();
    out.push({ kind: "built", label: "help", words: ["commands", "what can i type"], run: () => help() });
    out.push({ kind: "built", label: "rooms", words: ["pages", "drawer", "list"], run: () => { close(true); window.campusBlocks?.open(null, document.getElementById("hCmd")); } });
    for (const b of on) out.push({ kind: "built", label: `open ${b.page}`, show: () => `Open ${b.title}`, words: ["open", "go", "page", ...M.norm(b.title).split(" ")], target: aboutOf(b), run: () => openPage(b.page) });
    const views = [["2d", "2D city", ["city", "map", "flat"]], ["3d", "3D city", ["city", "three"], "campus3d"], ["neural", "Neural web", ["web", "workers", "terminal"], "neural"], ["pages", "the plain pages", ["menu", "classic"]]];
    for (const [v, name, words, mod] of views) if (!mod || !document.body.classList.contains(`mod-off-${mod}`)) out.push({ kind: "built", label: `view ${v}`, show: () => `View: ${name}`, words: ["view", "switch", "show", ...words], run: () => goView(v) });
    // the blocks' own actions, one per video or worker they apply to
    const P = mods.pipeline, A = mods.ai;
    if (P?.ACTIONS && glance?.pipeline && on.some((b) => b.page === "pipeline")) {
      for (const x of glance.pipeline.items || []) {
        const where = `${x.title} ${x.channelName || ""}`;
        for (const k of P.ITEM_ACTIONS?.[x.state] || []) {
          const act = P.ACTIONS[k]; if (!act) continue;
          out.push({ kind: "action", label: act.label, show: () => `${act.label}: ${x.title}`, words: [...(act.words || []), "video", ST[x.state] || ""], target: where, needsPassword: !!act.needsPassword,
            run: async () => { if (act.ask && !(await window.confirmBox(act.ask))) throw Object.assign(new Error("Cancelled."), { cancelled: true }); await act.run(x.id); return `${act.label}: ${x.title}`; } });
        }
        out.push({ kind: "action", label: "Open its card", show: () => `Open its card: ${x.title}`, words: ["card", "video", "open", ST[x.state] || ""], target: where, run: () => { close(true); window.campusBlocks?.open("pipeline", document.getElementById("hCmd"), { focus: x.id }); } });
      }
    }
    if (A?.ACTIONS && glance?.ai && on.some((b) => b.page === "ai")) {
      const act = A.ACTIONS;
      if (glance.ai.hub && act.monthOver) out.push({ kind: "action", label: act.monthOver.label(), words: act.monthOver.words, target: "whole hub", run: async () => { await act.monthOver.run(); return "Alert rule added for the whole hub"; } });
      for (const d of glance.ai.desks || []) {
        const name = deskName(d.id), per = Math.max(1, Math.round((d.cap || Math.max(d.projected || 0, 10)) / 10));
        if (act.dayRule) out.push({ kind: "action", label: act.dayRule.label("N"), show: (n) => `${name}: ${act.dayRule.label(n ?? per)}`, words: act.dayRule.words, target: `${name} ${d.id}`, takes: "number?", run: async (n) => { await act.dayRule.run(d.id, n ?? per); return `Alert rule added for ${name}`; } });
        if (act.deskOver && d.cap != null) out.push({ kind: "action", label: act.deskOver.label(), show: () => `${name}: ${act.deskOver.label()}`, words: act.deskOver.words, target: `${name} ${d.id}`, run: async () => { await act.deskOver.run(d.id); return `Alert rule added for ${name}`; } });
        if (act.capPct && d.cap != null) out.push({ kind: "action", label: act.capPct.label("N"), show: (n) => `${name}: ${act.capPct.label(n ?? 50)}`, words: act.capPct.words, target: `${name} ${d.id}`, takes: "number?", run: async (n) => { const pct = Math.max(1, Math.min(100, Math.round(n ?? 50))); await act.capPct.run(d.id, pct); return `You'll hear when ${name} reaches ${pct}% of its cap`; } });
        const pz = d.paused ? act.resume : act.pause;
        if (pz) out.push({ kind: "action", label: `${pz.label()}: ${name}`, show: () => `${pz.label()}: ${name}`, words: pz.words, target: `${name} ${d.id}`, needsPassword: !!pz.needsPassword, run: async () => { if (pz.ask && !(await window.confirmBox?.(pz.ask))) return "Left as it was"; await pz.run(d.id); return d.paused ? `${name} is running again` : `${name} is paused`; } });
        if (act.setCap) out.push({ kind: "action", label: "Set monthly cap", show: (n) => `Set ${name}'s monthly cap to $${n}${d.cap != null ? ` (now $${capText(d.cap)})` : ""}`, words: act.setCap.words, target: `${name} ${d.id}`, takes: "number", needsPassword: !!act.setCap.needsPassword, run: async (n) => { await act.setCap.run(d.id, n); return `${name}'s cap is now $${n} a month`; } });
      }
    }
    // the rest of the menu's pages, as plain pages (they leave the campus)
    const blockHref = new Set(on.map((b) => `/${b.page}.html`));
    for (const [label, href, icon] of window.hubNav?.shown(offPages()) || []) {
      if (href == null || href === "/campus.html" || blockHref.has(href)) continue;
      out.push({ kind: "page", label: `open ${label}`, show: () => `${icon || ""} ${label} (plain page, leaves the campus)`, words: ["open", "page"], boost: -1, href });
    }
    return out;
  }

  // ---------- suggestions ----------
  function render() {
    const text = input.value.trim();
    const all = catalogue();
    let hits;
    if (!text) hits = all.filter((x) => x.kind === "built").slice(0, 6).map((entry) => ({ entry }));
    else {
      const b = M.builtin(text, blocksOn());
      hits = M.match(text, all, 7);
      // an exact built-in goes first
      if (b) { const key = b.cmd === "open" ? `open ${b.arg}` : b.cmd === "view" ? `view ${b.arg}` : b.cmd; const top = all.find((x) => x.kind === "built" && x.label === key); if (top) hits = [{ entry: top }, ...hits.filter((h) => h.entry !== top)]; }
      // anything typed can go to a worker as a job; it's the pick when nothing else matches
      if (!b || (b.cmd === "open" && !b.arg)) hits.push({ entry: { kind: "job", label: "Send to a worker as a job" } });
    }
    sugg = hits; sel = 0;
    list.innerHTML = hits.map((h, i) => {
      const x = h.entry, lbl = x.show ? x.show(h.arg) : x.label;
      const tag = x.kind === "job" ? "job" : x.kind === "page" ? "page" : x.kind === "built" ? "cmd" : "action";
      return `<li role="option" id="cmdBarOpt${i}" data-i="${i}" class="cb-opt${i === sel ? " on" : ""}" aria-selected="${i === sel}"><span class="cb-tag">${tag}</span><span class="cb-lbl">${e$(lbl)}${x.needsPassword ? ' <span class="cb-lock" title="may ask for your dashboard password">🔒</span>' : ""}</span>${x.kind === "job" ? `<span class="cb-sub">to ${e$(deskName(pickWorker()))} or someone else</span>` : ""}</li>`;
    }).join("");
    input.setAttribute("aria-expanded", hits.length ? "true" : "false");
    mark();
  }
  function mark() {
    list.querySelectorAll(".cb-opt").forEach((li, i) => { li.classList.toggle("on", i === sel); li.setAttribute("aria-selected", String(i === sel)); });
    if (sugg.length) { input.setAttribute("aria-activedescendant", `cmdBarOpt${sel}`); list.children[sel]?.scrollIntoView?.({ block: "nearest" }); }
    else input.removeAttribute("aria-activedescendant");
  }

  // ---------- running ----------
  // e: the trusted key press or tap that asked for it
  async function go(e) {
    if (!e?.isTrusted || busy) return;
    const h = sugg[sel], text = input.value.trim();
    if (!h) return;
    const x = h.entry;
    if (x.kind === "job") return jobForm(text);
    if (x.kind === "page") { close(true); location.href = x.href; return; }
    say(`<span class="cb-me">${e$(text || x.label)}</span>`, "in");
    busy = true; input.disabled = true;
    try {
      const r = await x.run(h.arg);
      if (x.kind === "action") { say(`✓ ${e$(r || (x.show ? x.show(h.arg) : x.label))}`, "ok"); glanceAt = 0; load().then(() => window.campusProps?.refresh?.()); }
      if (bar && !bar.hidden) { input.value = ""; render(); }
    } catch (err) {
      say(err?.cancelled ? "– cancelled" : `✕ ${e$(err?.message || "That didn't work.")}`, err?.cancelled ? "dim" : "bad");
    } finally {
      busy = false; if (input) { input.disabled = false; if (!bar.hidden) input.focus(); }
    }
  }
  function say(html, cls = "") {
    if (!logEl) return;
    const row = document.createElement("div");
    row.className = `cb-row ${cls}`;
    row.innerHTML = html;
    logEl.append(row);
    while (logEl.children.length > 200) logEl.firstChild.remove();
    logEl.scrollTop = logEl.scrollHeight;
  }
  function help() {
    const pages = blocksOn().map((b) => b.page).join(", ") || "none on";
    say(`<b>help</b> this list · <b>rooms</b> every hub page · <b>open &lt;page&gt;</b> (${e$(pages)}) · <b>view 2d|3d|neural|pages</b><br>
      Or what a page's button does: <b>retry</b>, <b>skip</b>, <b>publish</b>, <b>card</b> + a video's name; <b>alert</b>, <b>cap 40</b> + a worker's name. 🔒 may ask for your dashboard password.<br>
      Anything else: <b>Send to a worker as a job</b>. It waits in their queue until it's pushed.`, "dim");
    input.value = ""; render();
  }
  function openPage(page) { close(true); window.campusBlocks?.open(page, document.getElementById("hCmd")); }
  // A view: the same as the View picker (boot.js), as the Rooms drawer does it.
  function goView(v) {
    close(true);
    const pick = document.getElementById("hMode");
    if (pick?.tagName === "SELECT" && [...pick.options].some((o) => o.value === v)) { pick.value = v; pick.dispatchEvent(new Event("change")); return; }
    try { localStorage.setItem("campus.display", v); } catch {}
    location.href = v === "pages" ? "/" : `/campus.html?view=${v}`;
  }

  // ---------- a job for a worker ----------
  // Default: the lead of the team that owns where you are (the building you're in, or the worker picked in Neural).
  function pickWorker() {
    const room = typeof view !== "undefined" && view ? String(view).split("::")[0] : null;
    const picked = inNeural() ? (neural.mode === "web" ? neural.b || neural.a : neural.desk) : null;
    return M.defaultWorker({ room, picked, desks: desks() });
  }
  function jobForm(text) {
    if (!text) return;
    const who = pickWorker();
    const opts = desks().filter((d) => d.status === "active" || d.id === who).sort((a, b) => (b.id === who) - (a.id === who) || String(a.room).localeCompare(String(b.room)) || deskName(a.id).localeCompare(deskName(b.id)))
      .map((d) => `<option value="${e$(d.id)}"${d.id === who ? " selected" : ""}>${e$(deskName(d.id))} · ${e$(d.room)}${d.lead ? " · lead" : ""}${d.runner === "hub" ? " ⚡" : ""}</option>`).join("");
    jobEl.innerHTML = `<div class="cb-jt">Send to a worker as a job</div><div class="cb-jq">“${e$(text)}”</div>
      <label class="cb-sub" for="cmdBarWho">Who</label><select id="cmdBarWho" data-cb="who">${opts || `<option value="hub-builder">hub-builder</option>`}</select>
      <div class="cb-sub">It waits in their queue; nothing runs or spends until it's pushed (⚡ = the hub runs it when pushed, which asks for your password). ${JOB_GH_NOTE}</div>
      <div class="cb-btns"><button type="button" class="cb-btn main" data-cb-give>Give the job</button><button type="button" class="cb-btn" data-cb-cancel>Cancel</button></div>`;
    jobEl.hidden = false;
    jobEl.querySelector("select").focus();
  }
  async function giveJob() {
    const text = input.value.trim(), desk = part("who")?.value;
    if (!text || !desk || busy) return;
    busy = true;
    const btn = jobEl.querySelector("[data-cb-give]"); btn.disabled = true; btn.textContent = "Giving…";
    say(`<span class="cb-me">${e$(text)}</span> → ${e$(deskName(desk))}`, "in");
    try {
      // the campus's own job route and password rule (panels.js "Give a job": postPw)
      const r = await window.api("/agents/job", { desk, text }, { password: true, why: PW_WHY_JOB });
      say(`✓ Job <b>${e$(r.id)}</b> given to ${e$(deskName(desk))} (${e$((r.via || ["hub inbox"]).join(" and "))})${r.githubError ? `. GitHub failed: ${e$(r.githubError)}` : ""}. <button type="button" class="cb-link" data-neural="${e$(desk)}" data-neural-job="${e$(r.id)}" data-neural-mode="tree">Follow it in Neural ›</button>`, "ok");
      jobEl.hidden = true; input.value = ""; render();
    } catch (err) {
      say(err?.cancelled ? "– cancelled" : `✕ ${e$(err?.message || "That didn't work.")}`, err?.cancelled ? "dim" : "bad");
      btn.disabled = false; btn.textContent = "Give the job";
    } finally { busy = false; }
  }

  // ---------- keys ----------
  // > or : opens it (outside a text box). While it's open: Esc closes it before anything else hears it (a password
  // prompt or yes/no box over it keeps its own keys), and keys typed in it stay in it (no campus shortcuts).
  window.addEventListener("keydown", (e) => {
    const other = [...document.querySelectorAll('dialog[open], [aria-modal="true"]')].some((el) => el !== bar);
    if (!isOpen()) {
      if ((e.key === ">" || e.key === ":") && !e.ctrlKey && !e.metaKey && !e.altKey && !other && !e.target.closest?.("input, textarea, select, [contenteditable]")) { e.preventDefault(); e.stopImmediatePropagation(); open(); }
      return;
    }
    if (other) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); if (!jobEl.hidden) { jobEl.hidden = true; input.focus(); } else close(); return; }
    if (!bar.contains(e.target)) return;
    e.stopImmediatePropagation();
    if (e.target !== input) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (sugg.length) { sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + sugg.length) % sugg.length; mark(); } }
    else if (e.key === "Enter") { e.preventDefault(); if (!jobEl.hidden) { if (e.isTrusted) giveJob(); } else go(e); }
    else if (e.key === "Tab" && sugg[sel] && !e.shiftKey) { const x = sugg[sel].entry; if (x.kind === "built") { e.preventDefault(); input.value = x.label; render(); } }
  }, true);

  // ---------- the buttons that open it ----------
  function hudButton() {
    if (document.getElementById("hCmd")) return;
    const b = document.createElement("button");
    b.className = "pill"; b.id = "hCmd"; b.type = "button";
    b.title = "Command bar: type what to do, or give a worker a job ( > )"; b.setAttribute("aria-label", "Command bar");
    b.textContent = "›_";
    b.onclick = () => (isOpen() ? close() : open());
    const rooms = document.getElementById("hRooms");
    if (rooms) rooms.after(b); else document.querySelector(".hud")?.append(b);
  }
  hudButton();
  // ›_ in the Neural view's top bar (built when Neural first opens), next to its ▦ Rooms
  function topButtons() {
    for (const top of document.querySelectorAll("#neural > .brain-top")) {
      if (top.querySelector("[data-cmd-open]")) continue;
      top.insertAdjacentHTML("beforeend", '<button type="button" class="pill" data-cmd-open title="Terminal: type what to do, or give a worker a job ( > )" aria-label="Terminal">›_</button>');
    }
  }
  const stage = document.getElementById("stage");
  if (stage) new MutationObserver(topButtons).observe(stage, { childList: true });
  document.addEventListener("click", (e) => { if (e.target.closest?.("[data-cmd-open]")) { e.preventDefault(); isOpen() ? close() : open(); } });

  // ---------- looks ----------
  // Over the city: the side panel's dark glass (no backdrop blur: it smeared over the live 3D city). Over Neural: a
  // terminal in Neural's navy and blue lines. Words and symbols, never colour alone.
  const CSS = `
  .cbar { position: fixed; z-index: 48; display: flex; flex-direction: column; box-sizing: border-box; isolation: isolate; }
  .cbar[hidden] { display: none; }
  .cbar .cb-line { display: flex; align-items: center; gap: 8px; }
  .cbar input[data-cb="in"] { flex: 1; min-width: 0; background: transparent !important; border: 0 !important; outline: 0; color: inherit !important; box-shadow: none; font: inherit; font-size: 16px; padding: 10px 0; }
  .cbar .cb-x { background: transparent; border: 0; color: inherit; opacity: 0.7; font-size: 16px; width: 36px; height: 36px; border-radius: 10px; cursor: pointer; }
  .cbar .cb-x:hover, .cbar .cb-x:focus-visible { opacity: 1; background: rgba(255, 255, 255, 0.08); }
  .cbar .cb-list { list-style: none; margin: 0; padding: 4px 0; max-height: 46vh; overflow-y: auto; overscroll-behavior: contain; }
  .cbar .cb-list:empty { display: none; }
  .cbar .cb-opt { display: flex; align-items: baseline; gap: 10px; padding: 9px 10px; border-radius: 10px; cursor: pointer; border-left: 3px solid transparent; }
  .cbar .cb-opt.on { background: rgba(255, 255, 255, 0.08); border-left-color: currentColor; }
  .cbar .cb-opt.on .cb-lbl::before { content: "▸ "; }
  .cbar .cb-tag { flex: none; min-width: 46px; font: 500 10.5px "Geist Mono", ui-monospace, monospace; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.7; }
  .cbar .cb-lbl { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .cbar .cb-sub { font-size: 12px; opacity: 0.72; }
  .cbar .cb-opt .cb-sub { flex: none; max-width: 40%; text-align: right; }
  .cbar .cb-hint { font-size: 11.5px; opacity: 0.6; padding: 6px 2px 0; }
  .cbar .cb-log { overflow-y: auto; overscroll-behavior: contain; }
  .cbar .cb-log:empty { display: none; }
  .cbar .cb-row { padding: 3px 0; overflow-wrap: anywhere; }
  .cbar .cb-row.in { opacity: 0.85; }
  .cbar .cb-row.in::before { content: "› "; opacity: 0.6; }
  .cbar .cb-row.bad { color: #ffb4a0; }
  .cbar .cb-row.dim { opacity: 0.72; }
  .cbar .cb-me { font-weight: 600; }
  .cbar .cb-link { background: none; border: 0; padding: 0; color: inherit; text-decoration: underline; cursor: pointer; font: inherit; }
  .cbar .cb-job { display: grid; gap: 8px; padding: 10px; margin-top: 4px; border-radius: 12px; }
  .cbar .cb-jt { font-weight: 600; }
  .cbar .cb-jq { overflow-wrap: anywhere; }
  .cbar .cb-job select { font: inherit; font-size: 16px; padding: 6px 8px; border-radius: 8px; width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; }
  .cbar .cb-job > * { min-width: 0; }
  .cbar .cb-job[hidden] { display: none; }
  .cbar .cb-btns { display: flex; gap: 8px; flex-wrap: wrap; }
  .cbar .cb-btn { font: inherit; padding: 8px 14px; border-radius: 10px; cursor: pointer; }
  /* over the 2D and 3D city: the side panel's dark glass */
  .cbar.cb-campus { top: 62px; left: 50%; transform: translateX(-50%); width: min(640px, calc(100% - 24px)); max-height: calc(100% - 80px); padding: 6px 12px 10px; background: rgba(20, 22, 28, 0.96); color: #f4f1ea; border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 18px; box-shadow: 0 18px 50px rgba(8, 12, 20, 0.5); font-family: "Geist", system-ui, -apple-system, "Segoe UI", sans-serif; }
  .cbar.cb-campus .cb-line { order: 1; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
  .cbar.cb-campus .cb-prompt { font: 400 24px/1 "Instrument Serif", Georgia, serif; opacity: 0.8; }
  .cbar.cb-campus .cb-list { order: 2; }
  .cbar.cb-campus .cb-job { order: 3; background: rgba(255, 255, 255, 0.045); border: 1px solid rgba(255, 255, 255, 0.12); }
  .cbar.cb-campus .cb-jt { font: 400 21px/1.15 "Instrument Serif", Georgia, serif; }
  .cbar.cb-campus .cb-log { order: 4; max-height: 7.5em; font-size: 13px; padding-top: 6px; }
  .cbar.cb-campus .cb-hint { order: 5; }
  .cbar.cb-campus .cb-job select { background: #1b1f27; color: inherit; border: 1px solid rgba(255, 255, 255, 0.16); }
  .cbar.cb-campus .cb-btn { background: rgba(255, 255, 255, 0.06); color: inherit; border: 1px solid rgba(255, 255, 255, 0.16); }
  .cbar.cb-campus .cb-btn.main { background: #f3d9a4; color: #1b1f27; border-color: #f3d9a4; font-weight: 600; }
  /* over Neural: a terminal */
  .cbar.cb-neural { left: 0; right: 0; bottom: 0; height: min(52vh, 440px); padding: 10px 14px max(10px, env(safe-area-inset-bottom)); background: linear-gradient(180deg, rgba(11, 14, 26, 0.97), #0b0e1a); color: #dfe6f2; border-top: 1px solid rgba(160, 200, 255, 0.28); font-family: "Geist Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: 13px; box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.5); }
  .cbar.cb-neural .cb-log { flex: 1; min-height: 2em; padding-bottom: 4px; }
  .cbar.cb-neural .cb-log:empty { display: block; }
  .cbar.cb-neural .cb-log:empty::before { content: "Neural terminal. Type help, an action (retry, skip, alert, cap 40…), or anything to give a worker as a job."; opacity: 0.6; }
  .cbar.cb-neural .cb-row.ok { color: #9fd8a8; }
  .cbar.cb-neural .cb-row.in { color: #8fb8ff; }
  .cbar.cb-neural .cb-line { border-top: 1px solid rgba(160, 200, 255, 0.18); }
  .cbar.cb-neural .cb-prompt { color: #8fb8ff; white-space: nowrap; }
  .cbar.cb-neural input { font-size: 16px; caret-color: #8fb8ff; }
  .cbar.cb-neural .cb-list { max-height: 34%; flex: none; }
  .cbar.cb-neural .cb-opt.on { background: rgba(160, 200, 255, 0.1); }
  .cbar.cb-neural .cb-job { background: rgba(160, 200, 255, 0.05); border: 1px solid rgba(160, 200, 255, 0.18); }
  .cbar.cb-neural .cb-job select { background: #141a26; color: inherit; border: 1px solid rgba(160, 200, 255, 0.3); }
  .cbar.cb-neural .cb-btn { background: #141a26; color: inherit; border: 1px solid rgba(160, 200, 255, 0.3); }
  .cbar.cb-neural .cb-btn.main { background: #8fb8ff; color: #0b0e1a; border-color: #8fb8ff; font-weight: 600; }
  @media (min-width: 701px) { .cbar.cb-neural { left: 50%; right: auto; bottom: 12px; transform: translateX(-50%); width: min(900px, calc(100% - 24px)); border: 1px solid rgba(160, 200, 255, 0.28); border-radius: 12px; } }
  @media (max-width: 700px) { .cbar.cb-campus { top: 56px; width: calc(100% - 16px); border-radius: 14px; } .cbar .cb-opt .cb-sub { display: none; } .cbar .cb-hint { display: none; } }
  `;

  window.campusCommand = { open, close, isOpen };
})();
