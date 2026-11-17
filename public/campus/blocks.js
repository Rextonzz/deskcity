// Campus: hub pages used inside the view (the owner 2026-11-14: "use pipeline, admin etc. as part of the 2D landscape in
// their set view so people don't need the pages if they don't want them; same goes for 3D and Neural").
// A page that has a block (public/parts/registry.js) opens in a sheet over whatever view you're in: a building's door,
// the menu, a "Rooms" button, or a worker in Neural. The sheet is full screen on a phone and a wide side sheet on a
// computer; ← Back, Esc or the phone's Back closes it and you're exactly where you were (camera, inside a building,
// the Neural level, what's picked, open panels): nothing underneath is touched while it's open.
// Loaded first by boot.js so its Esc comes before the campus's own (Esc closes the sheet before it steps out of
// anything else). Part of public/campus.html; shares one global scope with the other parts, so everything here is
// inside this function except window.campusBlocks.
(function () {
  const offPages = () => (typeof HUB !== "undefined" && Array.isArray(HUB.offPages) ? HUB.offPages : []);
  const list = () => (window.hubBlocks || []).filter((b) => !offPages().includes(b.page));
  const byPage = (page) => list().find((b) => b.page === page) || null;
  const ROOM_NAME = { control: "the Control Center (CEO tower)", hub: "the hub building", youtube: "the YouTube building", cards: "the Cards building", gaming: "the Gaming building", leisure: "Leisure" };
  const e$ = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // Short building names for the sign over the title ("YouTube building ›").
  const PLACE = { control: "Control Center", hub: "Hub building", youtube: "YouTube building", cards: "Cards building", gaming: "Gaming building", leisure: "Leisure" };
  let sheet = null, cur = null, pushed = false, lastFocus = null, shown = false, shutTimer = null, origin = null;
  const part = (id) => sheet.querySelector(`[data-bs="${id}"]`);

  function build() {
    sheet = document.createElement("section");
    sheet.className = "bsheet";
    sheet.hidden = true;
    sheet.setAttribute("aria-label", "Hub page");
    sheet.innerHTML = `<div class="bs-top"><button type="button" class="pill" data-bs="back" title="Close and go back to where you were (Esc)">← Back</button><span class="bs-head"><span class="bs-sign" data-bs="sign"></span><span class="bs-title" data-bs="title"></span><span class="bs-team" data-bs="team"></span></span><button type="button" class="pill" data-bs="rooms" title="Every hub page you can use here" aria-label="Rooms">▦<span class="bs-lbl"> Rooms</span></button><a class="pill" data-bs="page" data-leave href="/" title="Open it as its own page (leaves the campus)" aria-label="Open as a page">↗<span class="bs-lbl"> Page</span></a></div><main class="bs-body" data-bs="body"></main>`;
    part("back").onclick = () => close();
    part("rooms").onclick = () => open(null);
    document.body.append(sheet);
  }

  // The team that owns a block (registry "team"), by its roster name; a team that's gone falls back to the hub.
  function teamOf(b) {
    const rooms = typeof data !== "undefined" ? data?.rooms || [] : [];
    const id = b.team?.room && (!rooms.length || rooms.some((r) => r.id === b.team.room)) ? b.team.room : "hub";
    return { id, name: rooms.find((r) => r.id === id)?.name || (id === "hub" ? "Hub" : id) };
  }
  const teamName = (b) => `${teamOf(b).name} team`;
  // The drawer: every block that's on, with where it lives.
  function drawer(body) {
    const bs = list();
    body.innerHTML = `<p class="text-sm text-slate-500" style="margin-bottom:10px">Hub pages you can use right here, without leaving this view. Each one also has a door in the building it lives in.</p>`
      + (bs.length ? bs.map((b) => `<button type="button" class="bs-item" data-open-block="${e$(b.page)}"><span class="bs-icon" aria-hidden="true">${b.icon}</span><span><b>${e$(b.title)}</b><span class="bs-sub">${e$(aboutOf(b))}</span><span class="bs-sub">Lives in ${b.rooms.map((r) => e$(ROOM_NAME[r] || r)).join(" and ")} · kept by the ${e$(teamName(b))}</span></span></button>`).join("")
        : '<p class="text-sm text-slate-500">None: the parts these pages belong to are switched off on this hub.</p>')
      + otherPages() + viewsAndAccount();
  }
  // What the side menu and the View picker gave the campus before it went solo, so nothing is lost: switching views
  // (also from inside Neural or this sheet, where the picker is covered) and signing out.
  function viewsAndAccount() {
    const off = (id) => document.body.classList.contains(`mod-off-${id}`);
    const now = (typeof neural !== "undefined" && neural) ? "neural" : window.campusCity || "2d";
    const views = [["2d", "▦", "2D campus"], ["3d", "◆", "3D campus", "campus3d"], ["neural", "🧬", "Neural", "neural"], ["pages", "📄", "Pages (the plain pages, with their side menu)"]].filter((v) => !v[3] || !off(v[3]));
    return `<h3 class="bs-h3">Views</h3><p class="text-xs text-slate-500">Remembered on this device, like the View picker.</p>`
      + views.map(([id, icon, label]) => `<button type="button" class="bs-link" data-view-go="${id}"${id === now ? ' aria-current="true"' : ""}><span class="bs-icon" aria-hidden="true">${icon}</span><span>${e$(label)}${id === now ? " · you're here" : ""}</span></button>`).join("")
      + `<h3 class="bs-h3">Account</h3><form method="post" action="/logout"><button class="bs-link" type="submit"><span class="bs-icon" aria-hidden="true">⎋</span><span>Sign out</span></button></form><form method="post" action="/logout-all"><button class="bs-link" type="submit"><span class="bs-icon" aria-hidden="true">⎋</span><span>Sign out everywhere</span></button></form>`;
  }
  // A view from the Views list: the same as picking it in the View picker (boot.js).
  function goView(v) {
    const pick = document.getElementById("hMode");
    if (pick?.tagName === "SELECT" && [...pick.options].some((o) => o.value === v)) {
      close(true); // no history step back: the picker may load the other city straight away
      if (history.state?.campusBlock) try { history.replaceState(null, "", location.href); } catch {}
      pick.value = v; pick.dispatchEvent(new Event("change")); return;
    }
    try { localStorage.setItem("campus.display", v); } catch {}
    location.href = v === "pages" ? "/" : `/campus.html?view=${v}`;
  }
  // Every other page of the hub (the same list as the Pages view's menu, minus parts switched off), as plain pages:
  // the campus has no side menu of its own (it's solo), so this is how it reaches them. They move in one by one.
  function otherPages() {
    const blockHref = new Set(list().map((b) => `/${b.page}.html`));
    const shown = (window.hubNav?.shown(offPages()) || []).filter((l) => l[1] !== "/campus.html");
    let html = "", group = null;
    for (const [label, href, icon] of shown) {
      if (href == null) { group = label; continue; }
      if (blockHref.has(href)) continue;
      if (group) { html += `<div class="bs-group">${e$(group)}</div>`; group = null; }
      html += `<a class="bs-link" data-leave href="${e$(href)}"><span class="bs-icon" aria-hidden="true">${icon}</span><span>${e$(label)}</span><span class="bs-out" aria-hidden="true">↗</span></a>`;
    }
    return html ? `<h3 class="bs-h3">Other pages</h3><p class="text-xs text-slate-500">These open as plain pages for now (they leave the campus; your browser's Back comes back). They move in here one by one.</p>${html}` : "";
  }

  // Where you are, for the sign over the title: the building you're in (when the page lives there), else the page's
  // own building; in Neural, "Neural ›" first. Words, not colour.
  function signFor(b) {
    const inNeural = typeof neural !== "undefined" && !!neural;
    const inside = typeof view !== "undefined" && view ? String(view).split("::")[0] : null;
    const room = b ? (inside && b.rooms.includes(inside) ? inside : b.rooms[0]) : null;
    return [inNeural ? "Neural" : null, room ? PLACE[room] || room : "Campus"].filter(Boolean).join(" › ") + " ›";
  }
  // The look of the view underneath: the campus's glass panels, or Neural's navy.
  const skinNow = () => (typeof neural !== "undefined" && neural ? "neural" : "campus");

  // from: the element that was tapped (a door, a button); the sheet grows out of it and shrinks back into it.
  // opts go to the block's mount (e.g. { focus: <job id> } opens Pipeline at that video's card).
  async function open(page, from, opts = {}) {
    if (!sheet) build();
    clearTimeout(shutTimer);
    if (shown === false && anim) { try { anim.cancel(); } catch {} anim = null; }
    const arriving = !shown;
    if (arriving) {
      lastFocus = document.activeElement;
      try { history.pushState({ campusBlock: 1 }, "", location.href); pushed = true; } catch {}
      const r = from?.getBoundingClientRect?.();
      origin = r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    }
    shown = true;
    unmount();
    sheet.classList.remove("bs-campus", "bs-neural");
    sheet.classList.add(`bs-${skinNow()}`);
    sheet.hidden = false;
    if (arriving) {
      const box = sheet.getBoundingClientRect();
      sheet.style.transformOrigin = origin ? `${Math.round(origin.x - box.left)}px ${Math.round(origin.y - box.top)}px` : "50% 30%";
      zoom(true);
    }
    document.body.classList.add("bs-open");
    const b = page ? byPage(page) : null, body = part("body");
    body.innerHTML = "";
    body.scrollTop = 0;
    part("title").textContent = b ? b.title : "Rooms";
    part("sign").textContent = signFor(b);
    part("team").textContent = b ? teamName(b) : "";
    part("rooms").hidden = !b;
    part("page").hidden = !b;
    sheet.classList.toggle("bs-list", !b);
    part("back").focus();
    if (!b) return drawer(body);
    part("page").href = `/${b.page}.html`;
    const root = document.createElement("div");
    root.className = "space-y-5";
    body.append(root);
    const mine = (cur = { page: b.page, inst: null });
    try {
      const m = await import(`/parts/${b.page}.js`);
      const inst = await m.mount(root, { embedded: true, ...opts });
      if (cur !== mine) return inst?.unmount?.(); // closed or switched while it was loading
      mine.inst = inst;
    } catch (err) {
      if (cur === mine) root.innerHTML = `<p class="text-sm">Couldn't open ${e$(b.title)} here: ${e$(err.message)}. <a class="underline" data-leave href="/${e$(b.page)}.html">Open it as a page</a> instead.</p>`;
    }
  }
  function unmount() {
    if (cur?.inst) try { cur.inst.unmount(); } catch {}
    cur = null;
  }
  function close(fromHistory) {
    if (!sheet || !shown) return;
    shown = false;
    // shrink back into what was tapped, then empty it (the page's timers stop then; reopening sooner cancels this)
    zoom(false);
    clearTimeout(shutTimer);
    shutTimer = setTimeout(() => { unmount(); part("body").innerHTML = ""; sheet.hidden = true; }, ZOOM_MS);
    document.body.classList.remove("bs-open");
    if (!fromHistory && pushed && history.state?.campusBlock) history.back();
    pushed = false;
    try { lastFocus?.focus?.({ preventScroll: true }); } catch {}
  }
  const isOpen = () => shown;
  // Grow out of the tapped door or button (in), or shrink back into it (out), like the brain and Neural views open.
  // Reduced motion: a plain fade.
  const ZOOM_MS = 360;
  let anim = null;
  function zoom(grow) {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const shut = still ? { opacity: 0 } : { opacity: 0, transform: "scale(0.12)" }, open = still ? { opacity: 1 } : { opacity: 1, transform: "none" };
    try { anim?.cancel(); } catch {}
    anim = sheet.animate?.(grow ? [shut, open] : [open, shut], { duration: grow ? ZOOM_MS : ZOOM_MS - 60, easing: grow ? "cubic-bezier(.2,.8,.2,1)" : "ease-in", fill: grow ? "none" : "forwards" }) || null;
  }

  // The phone's Back (or the browser's) closes the sheet first.
  window.addEventListener("popstate", () => { if (isOpen()) close(true); });
  // Esc closes the sheet before anything else hears it (capture on window, added before the campus's own listeners).
  // A yes/no box or password prompt from inside a block keeps its own Esc. Other keys typed in the sheet stay there,
  // so the campus's shortcuts (/, 1-9, 0, Enter, Backspace) don't fire while you're using a page.
  window.addEventListener("keydown", (e) => {
    if (!isOpen()) return;
    if (e.key === "Escape") {
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
      e.preventDefault(); e.stopImmediatePropagation(); close(); return;
    }
    if (sheet.contains(e.target)) e.stopImmediatePropagation();
  }, true);
  // Doors, menu links and any link to a page with a block open it here instead of leaving the campus. A link with
  // data-leave, a new-tab click (ctrl, cmd, shift, middle button) or target=_blank still goes to the page.
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const vg = e.target.closest?.("[data-view-go]");
    if (vg) { e.preventDefault(); goView(vg.dataset.viewGo); return; }
    const ob = e.target.closest?.("[data-open-block]");
    if (ob) { e.preventDefault(); e.stopPropagation(); open(ob.dataset.openBlock || null, ob); return; }
    const a = e.target.closest?.("a[href]");
    if (!a || a.hasAttribute("data-leave") || a.hasAttribute("download") || (a.target && a.target !== "_self")) return;
    let u; try { u = new URL(a.href, location.href); } catch { return; }
    const page = u.origin === location.origin ? /^\/([a-z0-9-]+)\.html$/i.exec(u.pathname)?.[1] : null;
    if (!page || !byPage(page)) return;
    e.preventDefault();
    document.body.classList.remove("nv-open"); // the menu, on a phone
    open(page, a);
  });

  // Buttons for the blocks that live in a room (a building's floor panel, a worker in Neural). "" when none.
  function buttonsFor(room) {
    const bs = list().filter((b) => b.rooms.includes(room));
    return bs.length ? `<span class="bs-here">${bs.map((b) => `<button type="button" class="pill neural-mini" data-open-block="${e$(b.page)}" title="Open ${e$(b.title)} here">${b.icon} ${e$(b.title)}</button>`).join("")}</span>` : "";
  }
  // The room a worker belongs to (the owner, you, counts as the Control Center).
  function roomOfDesk(id) {
    if (id === OWNER_ID()) return "control";
    const d = typeof data !== "undefined" ? (data?.desks || []).find((x) => x.id === id) : null;
    return d?.room || null;
  }
  // "▦ Rooms" in the top bar of the Neural view and the brain view (both are built when first opened).
  function topButtons() {
    for (const top of document.querySelectorAll("#neural > .brain-top, #brain > .brain-top")) {
      if (top.querySelector("[data-open-block]")) continue;
      top.insertAdjacentHTML("beforeend", '<button type="button" class="pill" data-open-block="" title="Hub pages you can use here (Pipeline, Admin, AI and spend…)">▦ Rooms</button>');
    }
  }
  const stage = document.getElementById("stage");
  if (stage) new MutationObserver(topButtons).observe(stage, { childList: true });

  window.campusBlocks = { open, close, isOpen, buttonsFor, roomOfDesk, list, teamOf };
})();
