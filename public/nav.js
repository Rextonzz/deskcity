// Side menu and collapsible sections for every dashboard page. Plain script, loaded in each page's <head>.
// Wide screens get a menu down the left; phones get a ☰ button that slides it in.
// Every big section that opens with a heading gets a ▾ on it to fold it away; the page remembers what you folded.
(function () {
  // The home-screen tags every page shares (phone colour, install manifest, icons, name), added once from here.
  const HEAD_TAGS = [
    ["meta", { name: "theme-color", content: "#0f0f0e" }],
    ["link", { rel: "manifest", href: "/manifest.json", crossOrigin: "use-credentials" }],
    ["link", { rel: "icon", type: "image/png", href: "/favicon.png" }],
    ["link", { rel: "apple-touch-icon", href: "/apple-touch-icon.png" }],
    ["meta", { name: "apple-mobile-web-app-title", content: "Hub" }],
  ];
  for (const [tag, attrs] of HEAD_TAGS) document.head.appendChild(Object.assign(document.createElement(tag), attrs));
  // One way of writing dates and times on every page, always in the owner's town time (design review finding 15). Pages call
  // the browser's own date formatting; with no options it printed "9/22/2026, 4:57:05 PM" in the device's time zone.
  // Now: "Oct 18, 4:57 PM", "Oct 18" for a date alone, the year only when it isn't this year, no seconds.
  // Calls that pass their own options are left alone: those pages build calendar days on purpose (the owner's town on
  // the owner's phone and PC anyway), and forcing a zone on them shifted a month heading by a day in testing.
  // The owner's time zone comes from the hub settings (Hub kit): remembered in this browser after the first visit,
  // the device's own zone until then. the owner's settings say America/the owner's town.
  let TZ = (() => { try { return localStorage.getItem("hub.tz"); } catch { return null; } })() || Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Demo mode (tools/demo.mjs): a small "Demo data" label on every page, in words, so a sample hub is never taken for a
  // real one. It sits at the bottom, lets clicks through, and ?clean=1 hides it (for screenshots and the trailer).
  const demoRibbon = () => {
    if (document.getElementById("demoRibbon") || new URLSearchParams(location.search).get("clean") === "1") return;
    const el = Object.assign(document.createElement("div"), { id: "demoRibbon", textContent: "Demo data", title: "A sample hub with made-up data. Nothing here is real and nothing runs." });
    el.setAttribute("role", "note");
    el.style.cssText = "position:fixed;left:50%;bottom:2px;transform:translateX(-50%);z-index:2147483000;padding:2px 10px;border:1px solid rgba(255,255,255,.55);border-radius:999px;background:rgba(15,15,14,.82);color:#fff;font:600 11px/1.5 system-ui,sans-serif;letter-spacing:.04em;pointer-events:none;white-space:nowrap";
    (document.body || document.documentElement).appendChild(el);
  };
  fetch("/api/hub/settings").then((r) => (r.ok ? r.json() : null)).then((s) => { if (s?.demo) demoRibbon(); if (Array.isArray(s?.offPages) && JSON.stringify(s.offPages) !== JSON.stringify(OFF)) { OFF = s.offPages; try { localStorage.setItem("hub.offPages", JSON.stringify(OFF)); } catch {} window.dispatchEvent(new Event("hub:addons")); } const tz = s?.place?.timezone; if (tz && tz !== TZ) { try { localStorage.setItem("hub.tz", tz); } catch {} TZ = tz; } }).catch(() => {});
  const D = Date.prototype, orig = { s: D.toLocaleString, d: D.toLocaleDateString, t: D.toLocaleTimeString };
  const yearOf = (d) => Number(orig.d.call(d, "en-CA", { timeZone: TZ, year: "numeric" }));
  const thisYear = yearOf(new Date());
  D.toLocaleString = function (loc, o) {
    if (o) return orig.s.call(this, loc, o);
    return orig.s.call(this, loc, { timeZone: TZ, month: "short", day: "numeric", ...(yearOf(this) !== thisYear ? { year: "numeric" } : {}), hour: "numeric", minute: "2-digit" });
  };
  D.toLocaleDateString = function (loc, o) {
    if (o) return orig.d.call(this, loc, o);
    return orig.d.call(this, loc, { timeZone: TZ, month: "short", day: "numeric", ...(yearOf(this) !== thisYear ? { year: "numeric" } : {}) });
  };
  D.toLocaleTimeString = function (loc, o) {
    return orig.t.call(this, loc, o || { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  };

  // Step 3 of bringing the hub into the campus (the owner, 2026-11-09): the campus is the front door; every page it
  // opens is still here as the classic version.
  // Pages of parts switched off on this hub (src/hub/modules.js), remembered so the menu is right before the hub answers.
  let OFF = (() => { try { return JSON.parse(localStorage.getItem("hub.offPages") || "[]"); } catch { return []; } })();
  const LINKS = [
    ["Campus", "/campus.html", "◈"],
    ["Classic pages", null],
    ["Home", "/home.html", "⌂"],
    ["Search everything", "/search.html", "⌕"],
    ["Queue", "/queue.html", "≡"],
    ["Posting calendar", "/calendar.html", "▦"],
    ["To-do and ideas", "/todo.html", "✎"],
    ["Project", "/project.html", "◔"],
    ["Agents", "/agents.html", "◎"],
    ["YouTube", null],
    ["Pipeline", "/pipeline.html", "▶"],
    ["Stats", "/stats.html", "▤"],
    ["TikTok stats", "/stats-tiktok.html", "♪"],
    ["YouTube settings", "/youtube-settings.html", "⚑"],
    ["Cards", null],
    ["Collection", "/collection.html", "▦"],
    ["Price a card", "/cards.html", "$"],
    ["Deal watch", "/deals.html", "◎"],
    ["Paper matches", "/matches.html", "⚀"],
    ["Deck ideas", "/deckideas.html", "✦"],
    ["Gaming", null],
    ["Games", "/games.html", "🎮"],
    ["MTG Arena", "/arena.html", "⚔"],
    ["WoW raids", "/wow.html", "⚑"],
    ["Anime and manga", null],
    ["Watching and reading", "/reading.html", "❖"],
    ["System", null],
    ["Admin", "/admin.html", "⚙\uFE0E"],
    ["AI and spend", "/ai.html", "✦"],
  ];
  // The links to show when the pages in `off` are switched off: a heading only when something under it is left.
  // Shared (window.hubNav.shown) so the campus's ▦ Rooms offers exactly the pages this menu does: the Pages view and
  // the campus views reach the same set (test/hub/page-blocks.test.mjs).
  function shownLinks(off) {
    const on = (l) => !l[1] || !(off || []).includes(l[1].replace(/^\/|\.html$/g, ""));
    const shown = [];
    for (let k = 0; k < LINKS.length; k++) {
      if (LINKS[k][1] != null) { if (on(LINKS[k])) shown.push(LINKS[k]); continue; }
      let e = k + 1; while (e < LINKS.length && LINKS[e][1] != null) e++;
      const kids = LINKS.slice(k + 1, e).filter(on);
      if (kids.length) shown.push(LINKS[k], ...kids);
      k = e - 1;
    }
    return shown;
  }
  window.hubNav = { shown: shownLinks, links: () => LINKS.slice() };
  // Parts of a page that quietly failed to load (optimization audit 18): many pages swallow a failed data call and just
  // show less. Every GET to /api/ that fails is noted here and a small bar at the bottom says which part and why, with
  // Retry. A later success for the same address clears it. 404s are left to the page ("needs a restart" text).
  const failed = new Map();
  const partName = (url) => url.replace(/^.*?\/api\/(pipeline\/)?/, "").replace(/[?#].*$/, "").replace(/[/-]/g, " ").trim() || "data";
  let barTimer = null;
  const showBar = () => { clearTimeout(barTimer); barTimer = setTimeout(drawBar, 400); };
  function drawBar() {
    if (!document.body) return showBar();
    let bar = document.getElementById("nvFail");
    if (!failed.size) return bar && bar.remove();
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "nvFail";
      bar.setAttribute("role", "status");
      document.body.append(bar);
    }
    const list = [...failed.values()];
    const signedOut = list.some((f) => f.status === 401);
    const down = list.every((f) => f.status === 0);
    const why = signedOut ? 'You\'re signed out. <a href="/login?next=' + encodeURIComponent(location.pathname) + '">Sign in again</a>.'
      : down ? "The app isn't answering. It may be restarting, so give it a minute."
      : `Part of this page didn't load: ${list.map((f) => `<b>${f.name.replace(/[<>&"]/g, "")}</b>${f.msg ? ` (${f.msg.replace(/[<>&]/g, "")})` : ""}`).slice(0, 4).join(", ")}${list.length > 4 ? ` and ${list.length - 4} more` : ""}.`;
    bar.innerHTML = `<span>⚠ ${why}</span><button type="button" data-nv="retry">Retry</button><button type="button" data-nv="x" aria-label="Hide">✕</button>`;
    bar.querySelector('[data-nv="retry"]').onclick = () => location.reload();
    bar.querySelector('[data-nv="x"]').onclick = () => bar.remove();
  }
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const method = String(init?.method || input?.method || "GET").toUpperCase();
    const watch = method === "GET" && /^(\/|https?:\/\/[^/]*\/)api\//.test(url) && (url.startsWith("/") || url.startsWith(location.origin));
    if (!watch) return realFetch(input, init);
    const key = url.replace(/[?#].*$/, "");
    try {
      const res = await realFetch(input, init);
      if (res.ok || res.status === 404) { if (failed.delete(key)) showBar(); }
      else {
        let msg = "";
        try { msg = (await res.clone().json())?.error || ""; } catch {}
        failed.set(key, { name: partName(url), status: res.status, msg: String(msg).slice(0, 80) });
        showBar();
      }
      return res;
    } catch (err) {
      if (err?.name !== "AbortError") { failed.set(key, { name: partName(url), status: 0, msg: "" }); showBar(); }
      throw err;
    }
  };

  const css = `
    #nvFail { position: fixed; left: 12px; right: 12px; bottom: 12px; z-index: 60; display: flex; gap: 10px; align-items: center; background: var(--surface-3); border: 1px solid var(--line-strong); border-radius: 10px; padding: 10px 12px; font-size: 14px; color: var(--text-primary); box-shadow: 0 6px 24px rgba(0,0,0,.4); }
    @media (min-width: 1024px) { html:not([data-nav-solo]) #nvFail { left: 222px; max-width: 760px; } }
    #nvFail span { flex: 1; min-width: 0; }
    #nvFail a { text-decoration: underline; }
    #nvFail button { background: none; border: 1px solid var(--line-strong); color: var(--text-secondary); border-radius: 8px; padding: 6px 10px; min-height: 36px; flex-shrink: 0; }
    .nv-side { position: fixed; top: 0; left: 0; bottom: 0; width: 210px; background: var(--surface-1); border-right: 1px solid var(--line); padding: 14px 10px; overflow-y: auto; z-index: 40; transition: transform .2s; }
    .nv-side a { display: flex; gap: 10px; align-items: center; padding: 7px 10px; border-radius: 8px; color: var(--text-secondary); font-size: 14px; text-decoration: none; }
    .nv-side a:hover { background: var(--surface-2); color: var(--text-primary); }
    .nv-side a.nv-on { background: var(--surface-3); color: var(--text-primary); font-weight: 600; }
    .nv-side a span { width: 18px; text-align: center; color: var(--text-muted); }
    .nv-group { margin: 14px 10px 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); }
    .nv-btn { background: none; border: 1px solid var(--line-strong); color: var(--text-secondary); border-radius: 8px; width: 34px; height: 34px; font-size: 18px; line-height: 1; flex-shrink: 0; }
    .nv-shade { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 39; display: none; }
    @media (min-width: 1024px) { html:not([data-nav-solo]) body { padding-left: 210px; } .nv-btn.nv-menu { display: none; } }
    @media (max-width: 1023px) { .nv-side { transform: translateX(-100%); } body.nv-open .nv-side { transform: none; } body.nv-open .nv-shade { display: block; } }
    header a[href$=".html"], header a[href="/"] { display: none; } /* the menu has them, on every screen size */
    .nv-head { cursor: pointer; }
    .nv-fold { background: none; border: none; color: var(--text-muted); font-size: 14px; padding: 0 4px; margin-left: 6px; transition: transform .15s; vertical-align: middle; }
    .nv-col .nv-fold { transform: rotate(-90deg); }
    .nv-col > :not(.nv-head) { display: none !important; }
    .nv-col { padding-bottom: 12px !important; }
    /* Design review 2026-10-21: bigger fold target, long unbroken text wraps instead of pushing the page sideways. */
    .nv-fold { min-width: 32px; min-height: 32px; font-size: 16px; }
    html body { overflow-wrap: break-word; }
    .nv-side a { padding: 10px; }
    .nv-out { margin: 18px 10px 24px; border-top: 1px solid var(--line); padding-top: 10px; display: grid; gap: 2px; }
    .nv-out button { background: none; border: 0; color: var(--text-muted); font-size: 14px; text-align: left; padding: 10px; width: 100%; border-radius: 8px; }
    .nv-out button:hover { background: var(--surface-2); color: var(--text-primary); }
    header form[action^="/logout"] { display: none; }
    /* One header shape on the phone (design review finding 4): the page's own badge goes (the menu button sits there),
       the title and subtitle get the full width next to the menu button, and the page's buttons drop to their own row. */
    @media (max-width: 639px) {
      header > div > div.w-9.h-9 { display: none; }
      header > div > div.flex-1, header > div > h1.flex-1 { flex: 1 1 calc(100% - 50px); }
      header:not([data-icon]) > div { row-gap: 10px; padding-top: 12px; padding-bottom: 12px; }
      header[data-icon] { grid-template-columns: auto minmax(0, 1fr); }
      header[data-icon]::before { display: none; }
      header[data-icon] > h1, header[data-icon] > p { grid-column: 2; }
      header[data-icon] > :not(h1):not(p):not(.nv-menu) { grid-column: 1 / -1; grid-row: 3; justify-self: start; margin: 12px 0 0; }
    }
    .nv-raw { display: inline; }
    .nv-raw summary { display: inline; cursor: pointer; color: var(--text-muted); font-size: 12px; text-decoration: underline; margin-left: 4px; }
    .nv-raw summary::-webkit-details-marker { display: none; }
    .nv-raw code { display: block; margin-top: 4px; font-size: 11px; color: var(--text-muted); overflow-wrap: anywhere; white-space: pre-wrap; }
    /* Loading (design review finding 5): an empty chart or tile box says so instead of looking broken. */
    main div[id$="Chart"]:empty::before, main div[id$="Tiles"]:empty::before, main #tiles:empty::before { content: "Loading…"; display: block; color: var(--text-muted); font-size: 13px; padding: 20px 0; text-align: center; animation: nv-pulse 1.4s ease-in-out infinite; }
    body.nv-slow main div[id$="Chart"]:empty::before, body.nv-slow main div[id$="Tiles"]:empty::before, body.nv-slow main #tiles:empty::before { content: "Nothing here yet, or it's still loading. Pull down to refresh."; animation: none; }
    @keyframes nv-pulse { 50% { opacity: .4; } }
    /* Tap targets (design review finding 13): on a phone, buttons, menus and boxes are at least 40 px tall. */
    @media (max-width: 640px) {
      main button:not(.nv-fold):not(.nv-more), main select, main input:not([type=checkbox]):not([type=radio]):not([type=range]), main a.rounded-lg { min-height: 40px; }
      main a.rounded-lg { display: inline-flex; align-items: center; }
    }
    /* Long help text (design review finding 10): on a phone, two lines and a "more" link. */
    .nv-more { display: none; }
    @media (max-width: 640px) {
      p.nv-clamp:not(.nv-open) { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .nv-more { display: inline-block; background: none; border: 0; padding: 2px 0 6px; color: var(--text-muted); font-size: 12px; text-decoration: underline; }
    }
    /* Phone: wide tables become one small card per row, each value labelled with its column. */
    @media (max-width: 640px) {
      table.nv-cards, table.nv-cards tbody, table.nv-cards thead { display: block; width: 100%; }
      table.nv-cards tr.nv-headrow, table.nv-cards thead { display: none; }
      table.nv-cards tr { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 10px; background: var(--surface-2); border: 1px solid var(--line) !important; border-radius: 10px; padding: 10px; margin-bottom: 8px; }
      table.nv-cards td { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 0 !important; border: 0 !important; text-align: left !important; white-space: normal !important; min-width: 0; }
      table.nv-cards td::before { content: attr(data-label); color: var(--text-muted); font-size: 11px; font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
      table.nv-cards td[data-label=""]::before, table.nv-cards td.nv-title::before { content: none; }
      table.nv-cards td.nv-title { order: -1; grid-column: 1 / -1; display: block; font-weight: 600; font-size: 15px; }
      table.nv-cards td:empty { display: none; }
      table.nv-cards td[colspan] { grid-column: 1 / -1; display: block; }
      table.nv-cards td input, table.nv-cards td select { max-width: 100%; }
    }
  `;
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };

  function menu() {
    const here = location.pathname;
    const side = document.createElement("nav");
    side.className = "nv-side";
    // Hub kit add-ons (step 5): a link tagged with an add-on shows only when the hub settings turn it on. Until the
    // settings arrive (first visit), everything shows; after that the list is remembered in this browser.
    const draw = () => {
      const shown = shownLinks(OFF);
      side.querySelectorAll(".nv-group, a.nv-link").forEach((x) => x.remove());
      side.insertAdjacentHTML("afterbegin", shown.map(([label, href, icon]) => (href == null ? `<div class="nv-group">${label}</div>` : `<a href="${href}" class="nv-link ${href === here ? "nv-on" : ""}"><span>${icon}</span>${label}</a>`)).join(""));
    };
    draw();
    window.addEventListener("hub:addons", draw);
    const shade = document.createElement("div");
    shade.className = "nv-shade";
    shade.onclick = () => document.body.classList.remove("nv-open");
    // Sign out lives at the bottom of the menu (design review: it crowded the phone header).
    const out = document.createElement("div");
    out.className = "nv-out";
    out.innerHTML = `<form method="post" action="/logout"><button>Sign out</button></form><form method="post" action="/logout-all"><button>Sign out everywhere</button></form>`;
    side.append(out);
    document.body.prepend(shade);
    document.body.prepend(side);
    const bar = document.querySelector("header[data-icon]") || document.querySelector("header > div");
    if (bar) {
      const b = document.createElement("button");
      b.className = "nv-btn nv-menu";
      b.type = "button";
      b.setAttribute("aria-label", "Menu");
      b.textContent = "☰";
      b.onclick = () => document.body.classList.toggle("nv-open");
      bar.prepend(b);
    }
  }

  // A section's heading row: its first child, when that is a title or holds one (h1-h3 or a bold line).
  const TITLE = "h1, h2, h3, .font-semibold, .font-medium";
  function headOf(sec) {
    const first = sec.firstElementChild;
    if (!first || first.tagName === "SUMMARY" || first.tagName === "BUTTON") return null;
    return first.matches(TITLE) || first.querySelector(TITLE) ? first : null;
  }
  function folds() {
    // Only big sections get one (taller than about half a phone screen), plus any you folded before.
    const all = [...document.querySelectorAll("main section")];
    all.forEach((sec, i) => {
      const key = `nv:${location.pathname}:${sec.id || i}`;
      if (sec.dataset.nv || sec.children.length < 2 || !headOf(sec)) return;
      // A section marked data-fold-phone starts folded on a phone until you open it once (design review finding 16).
      const phoneFold = "foldPhone" in sec.dataset && innerWidth < 640;
      if (sec.offsetHeight < 420 && store.get(key) !== "1" && !phoneFold) return;
      sec.dataset.nv = "1";
      const head = headOf(sec);
      head.classList.add("nv-head");
      const title = head.matches(TITLE) ? head : head.querySelector(TITLE);
      if (!title || title.closest("button, a")) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nv-fold";
      btn.setAttribute("aria-label", "Fold or unfold");
      btn.textContent = "▾";
      title.append(btn);
      if (store.get(key) === "1" || (phoneFold && store.get(key) == null)) sec.classList.add("nv-col");
      head.addEventListener("click", (e) => {
        if (e.target !== btn && e.target.closest("a, button, input, select, textarea, label")) return;
        const col = sec.classList.toggle("nv-col");
        store.set(key, col ? "1" : phoneFold ? "0" : null);
        if (!col) window.dispatchEvent(new Event("resize")); // charts drawn while folded get their size again
      });
    });
  }

  // Phone tables (design review finding 1): tag every table of 4+ columns so the CSS above can show its rows as
  // cards. Each cell gets its column's name; the name-like column becomes the card's heading.
  const TITLE_COL = /^(title|name|pack|card|video|post|event|deck|what|item|step|job)$/i;
  function cardTables() {
    for (const t of document.querySelectorAll("main table:not([data-keep])")) {
      const headRow = t.querySelector("thead tr") || [...t.rows].find((r) => r.querySelector("th") && !r.querySelector("td"));
      if (!headRow) continue;
      const heads = [...headRow.cells].map((c) => c.textContent.replace(/[↑↓▲▼]/g, "").trim());
      if (heads.length < 4) continue;
      t.classList.add("nv-cards");
      if (headRow.parentElement.tagName !== "THEAD") headRow.classList.add("nv-headrow");
      const titleAt = heads.findIndex((h) => TITLE_COL.test(h));
      for (const r of t.rows) {
        if (r === headRow || r.dataset.nvc === String(r.cells.length)) continue;
        r.dataset.nvc = String(r.cells.length);
        let col = 0;
        for (const c of r.cells) {
          if (c.tagName === "TD" && !c.hasAttribute("data-label")) c.dataset.label = c.colSpan > 1 ? "" : heads[col] || "";
          if (col === (titleAt < 0 ? 0 : titleAt) && c.colSpan === 1) c.classList.add("nv-title");
          col += c.colSpan || 1;
        }
      }
    }
  }

  // Raw technical errors (design review finding 2): keep the plain part, add a plain sentence for known causes,
  // and tuck the raw text behind "details". Text in boxes you can edit, and code blocks, is left alone.
  const TECH = /(\b(?:page|locator|frame|browserContext|browser)\.\w+:|net::ERR_|\bE(?:ADDRINUSE|NOENT|CONNREFUSED|CONNRESET|TIMEDOUT|NOTFOUND|PERM|ACCES)\b|\b\w*Error: |Timeout \d+ms exceeded|\u001b\[|\[\d{1,2}m|is not defined\b|Cannot read properties)/;
  const PLAIN = [
    [/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed/i, "Couldn't reach the site. Check the PC's internet, then press Retry."],
    [/EADDRINUSE/, "The app was started twice. Close the extra window."],
    [/Timeout \d+ms exceeded/, "The page took too long to answer. Press Retry."],
    [/has been closed/, "Chrome was closed while it was working. Press Retry."],
    [/ENOENT|No such file/i, "A file it needed is missing."],
    [/EPERM|EACCES|Permission denied/i, "A file is locked, usually open in Excel. Close it, then retry."],
    [/is not defined|Cannot read properties|TypeError/, "Something in the app broke. Tell Claude."],
  ];
  const ANSI = /\u001b?\[[0-9;]{1,6}m/g;
  function friendlyErrors() {
    const walk = document.createTreeWalker(document.querySelector("main") || document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.length > 20 && TECH.test(n.nodeValue) && !n.parentElement.closest("textarea, pre, code, script, style, .nv-raw, [contenteditable]") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const found = [];
    while (walk.nextNode()) found.push(walk.currentNode);
    for (const n of found) {
      const raw = n.nodeValue.replace(ANSI, "");
      const at = raw.search(TECH);
      const keep = raw.slice(0, Math.max(0, at)).replace(/[\s:,(-]+$/, "");
      const plain = PLAIN.find(([re]) => re.test(raw))?.[1];
      const span = document.createElement("span");
      span.append(keep ? `${keep}${plain ? ". " : ""}` : "", plain || (keep ? "" : "Something went wrong."));
      const d = document.createElement("details");
      d.className = "nv-raw";
      d.innerHTML = "<summary>details</summary><code></code>";
      d.querySelector("code").textContent = raw.trim();
      span.append(d);
      n.replaceWith(span);
    }
  }

  // Help paragraphs: grey text written into the page (not chart notes the page fills in), long, and with no boxes
  // to type in, so nothing you need to reach gets hidden.
  function clampHelp() {
    for (const el of document.querySelectorAll("main p.text-slate-500:not([id]):not([data-nvh])")) {
      el.dataset.nvh = "1";
      if (el.textContent.trim().length < 170 || el.querySelector("input, select, textarea, button") || el.closest("table, details, dialog")) continue;
      el.classList.add("nv-clamp");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "nv-more";
      b.textContent = "more";
      b.onclick = () => (b.textContent = el.classList.toggle("nv-open") ? "less" : "more");
      el.after(b);
    }
  }

  // A picture that fails to load (a cover or card image from another site) turns into a plain grey box of the same size
  // instead of the browser's broken-image icon (design review finding 18). Pictures with their own onerror keep theirs.
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || img.hasAttribute("onerror") || !img.parentNode || !img.className) return;
    const box = document.createElement("div");
    box.className = img.className;
    box.title = "Picture didn't load";
    img.replaceWith(box);
  }, true);

  let queued = false;
  function tidy() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      try { cardTables(); friendlyErrors(); clampHelp(); } catch (err) { console.warn("nav tidy:", err); }
    });
  }

  // A view that stands on its own (the owner 2026-11-14: "decouple the current side menu page from other views to allow
  // each to be solo"): a page whose <html> has data-nav-solo (the campus: 2D, 3D and Neural) gets no side menu and no
  // ☰ button; it has its own way round (the campus's ▦ Rooms). Everything else this file does (dates, the failed-part
  // bar, phone tables, folds) still applies, so a page block inside it looks the same as on its own page.
  const SOLO = document.documentElement.hasAttribute("data-nav-solo");
  function start() {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    if (!SOLO) menu();
    // Sizes are only right once the styles are in, and pages fill in after their data loads, so look a few times.
    const later = () => [300, 1500, 4000, 10000].forEach((ms) => setTimeout(folds, ms));
    document.readyState === "complete" ? later() : window.addEventListener("load", later);
    tidy();
    setTimeout(() => document.body.classList.add("nv-slow"), 15000);
    new MutationObserver(tidy).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
