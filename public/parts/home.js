// Home: the page's working part as a block (see public/parts/kit.js). Mounted by public/home.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, api, when } from "/lib.js";
import { scope, lifecycle, needScripts } from "/parts/kit.js";
import { channels as CHANNELS, chOfLayout, stores as STORES } from "/hubinfo.js";

export const html = `<form action="/search.html" role="search"><input name="q" type="search" placeholder="⌕ Search cards, shows, videos, to-dos…" autocomplete="off" style="width:100%;background:var(--surface-2);border:1px solid var(--line-strong);color:var(--text-primary);border-radius:10px;padding:9px 12px;font-size:16px" /></form>
<section class="bg-white rounded-xl border border-slate-200 p-4">
  <h2 class="font-semibold">Today</h2>
  <ul id="today" class="mt-2 text-sm space-y-2"><li class="text-slate-500">Loading…</li></ul>
</section>

<section class="grid gap-4 sm:grid-cols-2">
  <div class="bg-white rounded-xl border border-slate-200 p-4">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-lg bg-red-600 flex items-center justify-center text-white font-bold">▶</div>
      <div class="flex-1 min-w-0"><div class="font-semibold">YouTube</div><div class="text-sm text-slate-500">Upload pipeline, stats and settings</div></div>
    </div>
    <ul id="ytStatus" class="mt-3 text-sm space-y-1"></ul>
    <div id="ytWeek" class="mt-3 text-sm"></div>
    <div class="mt-3 flex gap-2 text-sm flex-wrap"><a href="/pipeline.html" class="px-3 py-1.5 rounded-lg bg-red-600 text-white">Pipeline</a><a href="/stats.html" class="px-3 py-1.5 rounded-lg border border-slate-300">Stats</a>
</div>
  </div>

  <div class="bg-white rounded-xl border border-slate-200 p-4">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center text-white font-bold">♠</div>
      <div class="flex-1 min-w-0"><div class="font-semibold">Cards</div><div class="text-sm text-slate-500">Your collection, price check from a photo, and the ${esc(STORES.shop)} deal watch.</div></div>
    </div>
    <div class="mt-3 flex gap-2 text-sm flex-wrap"><a href="/cards.html" class="px-3 py-1.5 rounded-lg bg-red-600 text-white">Price a card</a><a href="/collection.html" class="px-3 py-1.5 rounded-lg border border-slate-300">Collection</a><a href="/deals.html" class="px-3 py-1.5 rounded-lg border border-slate-300">Deal watch</a><a href="/matches.html" class="px-3 py-1.5 rounded-lg border border-slate-300">Paper matches</a><a href="/deckideas.html" class="px-3 py-1.5 rounded-lg border border-slate-300">Deck ideas</a></div>
  </div>

  <div class="bg-white rounded-xl border border-slate-200 p-4">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center text-white font-bold">⚔</div>
      <div class="flex-1 min-w-0"><div class="font-semibold">Gaming</div><div class="text-sm text-slate-500">Every game you play, with add-ons: MTG Arena matches and win rates, WoW raids.</div></div>
    </div>
    <div class="mt-3 flex gap-2 text-sm flex-wrap"><a href="/games.html" class="px-3 py-1.5 rounded-lg border border-slate-300">Games</a><a href="/arena.html" class="px-3 py-1.5 rounded-lg border border-slate-300">MTG Arena</a><a href="/wow.html" class="px-3 py-1.5 rounded-lg border border-slate-300">WoW raids</a></div>
  </div>

  <div class="bg-white rounded-xl border border-slate-200 p-4">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center text-white font-bold">❖</div>
      <div class="flex-1 min-w-0"><div class="font-semibold">Anime and manga</div><div id="readingLine" class="text-sm text-slate-500">What you're watching and reading, and what's new.</div></div>
    </div>
    <div class="mt-3 flex gap-2 text-sm flex-wrap"><a href="/reading.html" class="px-3 py-1.5 rounded-lg bg-red-600 text-white">Watching and reading</a></div>
  </div>

  <div class="bg-white rounded-xl border border-slate-200 p-4">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center text-white font-bold">≡</div>
      <div class="flex-1 min-w-0"><div class="font-semibold">Planning and system</div><div class="text-sm text-slate-500">What's coming up, your to-do list and how the app is doing.</div></div>
    </div>
    <div class="mt-3 flex gap-2 text-sm flex-wrap"><a href="/queue.html" class="px-3 py-1.5 rounded-lg border border-slate-300">Queue</a><a href="/calendar.html" class="px-3 py-1.5 rounded-lg border border-slate-300">Calendar</a><a href="/todo.html" class="px-3 py-1.5 rounded-lg border border-slate-300">To-do</a><a href="/project.html" class="px-3 py-1.5 rounded-lg border border-slate-300">Project</a><a href="/agents.html" class="px-3 py-1.5 rounded-lg border border-slate-300">Agents</a>
<a href="/ai.html" class="px-3 py-1.5 rounded-lg border border-slate-300">AI and spend</a><a href="/admin.html" class="px-3 py-1.5 rounded-lg border border-slate-300">Admin</a></div>
  </div>
</section>

<section class="bg-white rounded-xl border border-slate-200 p-4">
  <div class="flex items-center gap-2 flex-wrap">
    <h2 class="font-semibold flex-1">Health</h2>
    <button id="runHealth" class="text-sm px-3 py-1.5 rounded-lg border border-slate-300">Check now</button>
    <a href="/admin.html" class="text-sm px-3 py-1.5 rounded-lg bg-slate-800 text-white">Admin</a>
  </div>
  <div id="healthLine" class="text-sm text-slate-500 mt-1">Loading…</div>
  <details id="healthMore" class="mt-2 hidden"><summary class="text-sm cursor-pointer text-slate-500">Show what needs a look</summary><ul id="healthProblems" class="text-sm mt-2 space-y-1"></ul></details>
</section>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "home";
  const $ = scope(root), life = lifecycle();
  await needScripts(["/timing.js"]);
  // The "Today" strip (design review finding 3): what needs you, and what goes out next, before anything else.
  const today = {};
  const tLine = (cls, text, href, label) => `<li class="flex gap-2 items-center"><span class="flex-1 min-w-0 ${cls}">${text}</span>${href ? `<a href="${href}" class="shrink-0 px-3 py-1.5 rounded-lg border border-slate-300">${label}</a>` : ""}</li>`;
  function drawToday() {
    const out = [];
    if (today.held) out.push(tLine("text-amber-700 font-medium", `${today.held} video${today.held === 1 ? "" : "s"} waiting on you`, "/pipeline.html", "Open"));
    if (today.failed) out.push(tLine("text-red-700", `${today.failed} job${today.failed === 1 ? "" : "s"} failed`, "/pipeline.html", "See why"));
    for (const n of today.next || []) out.push(tLine("", n.text, n.href, n.label));
    if (today.health) out.push(tLine("text-red-700", `${today.health} health check${today.health === 1 ? "" : "s"} need${today.health === 1 ? "s" : ""} a look`, "/admin.html", "Admin"));
    if (today.reading) out.push(tLine("text-emerald-700", today.readingText || `${today.reading} anime or manga with something new`, "/reading.html", "Open"));
    const known = ["held", "failed", "next", "health", "reading"].filter((k) => k in today).length;
    $("today").innerHTML = out.join("") || (known >= 3 ? '<li class="text-emerald-700 font-medium">All good. Nothing needs you right now.</li>' : '<li class="text-slate-500">Loading…</li>');
  }
  async function loadNext() {
    try {
      const res = await fetch("/api/pipeline/calendar");
      if (!res.ok) throw new Error();
      const c = await res.json();
      const nowIso = new Date().toISOString();
      const fmt = (p) => {
        const d = p.day === c.today ? "today" : new Date(`${p.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
        return `${d}${p.time ? ` at ${p.time}` : ""}`;
      };
      const next = [];
      for (const [ch, name] of CHANNELS.map((c) => [c.id, c.name])) {
        const p = c.posts.filter((x) => x.channel === ch && x.platform === "youtube" && x.at && x.at > nowIso).sort((a, b) => a.at.localeCompare(b.at))[0];
        const gapSoon = c.gaps.some((g) => g.channel === ch && g.day === c.today);
        if (p) next.push({ text: `${name} next posts ${esc(fmt(p))}` });
        else next.push({ text: `<span class="${gapSoon ? "text-red-700" : "text-slate-500"}">${name}: nothing booked yet</span>`, href: "/calendar.html", label: "Calendar" });
      }
      today.next = next;
    } catch {
      today.next = [];
    }
    drawToday();
  }
  loadNext();
  async function loadYt() {
    try {
      const [chs, jobs] = await Promise.all([api("/channels"), api("/jobs")]);
      const held = jobs.filter((j) => j.status === "held").length;
      const failed = jobs.filter((j) => j.status === "failed").length;
      const running = jobs.find((j) => j.status === "running");
      const lines = Object.values(chs).map((c) => `<li class="flex gap-2"><span class="w-2 h-2 mt-1.5 rounded-full ${c.live ? "bg-emerald-500" : "bg-slate-300"}"></span>${esc(c.name)}: ${c.live ? "live" : "test mode"}</li>`);
      if (running) lines.push(`<li class="text-slate-600">Working on ${esc(running.title || running.sourceName)}</li>`);
      // Waiting and failed counts show in the Today strip at the top.
      $("ytStatus").innerHTML = lines.join("");
      today.held = held;
      today.failed = failed;
      drawToday();
    } catch (err) {
      $("ytStatus").innerHTML = `<li class="text-red-700">${esc(err.message)}</li>`;
    }
  }
  async function loadHealth() {
    try {
      const h = await api("/health");
      const jobsLine = (n) => (!n ? "" : `<p class="text-sm mt-1">${n.paused ? '<span class="text-red-600">Pipeline paused.</span> ' : ""}${n.running.length ? n.running.map((r) => `Working on <b class="font-medium">${esc(r.label)}</b>: ${esc(r.stage || "")}${r.since ? ` for ${esc(timing.dur(Date.now() - Date.parse(r.since)))}` : ""}${r.batch ? " (waiting for the half-price batch)" : ""}`).join("; ") : "Nothing running."}${n.queued ? ` ${n.queued} in line.` : ""}${n.held ? ` <a href="/pipeline.html" class="text-amber-700 hover:underline">${n.held} waiting on you</a>.` : ""}</p>`);
      const bad = (h.checks || []).filter((c) => !c.ok);
      $("healthLine").innerHTML = h.running ? `Checking… ${esc(timing.progressText({ elapsedMs: h.runningSince ? Date.now() - Date.parse(h.runningSince) : 0, typicalMs: h.durationMs || 90000 }))}` : h.at ? `Last check ${esc(when(h.at))}: ${h.ok ? '<span class="text-emerald-700 font-medium">all good</span>' : `<span class="text-red-700 font-medium">${bad.length} need${bad.length === 1 ? "s" : ""} a look</span>`}` : "No check yet.";
      $("healthLine").innerHTML += jobsLine(h.jobs);
      $("healthMore").classList.toggle("hidden", !bad.length);
      today.health = h.running ? null : bad.length;
      drawToday();
      $("healthProblems").innerHTML = bad.map((c) => `<li class="flex gap-2"><span class="text-red-600">✗</span><span class="min-w-0"><b class="font-medium">${esc(c.name)}</b> <span class="text-slate-600">${esc(c.detail)}</span></span></li>`).join("");
      $("runHealth").disabled = h.running;
      $("runHealth").textContent = `Check now${h.durationMs ? ` · ${timing.est(h.durationMs)}` : ""}`;
      if (h.running) life.later(loadHealth, 4000);
    } catch (err) {
      $("healthLine").innerHTML = `<span class="text-red-700">${esc(err.noRoute ? "the app needs a restart to load the health check" : err.message)}</span>`;
    }
  }
  $("runHealth").onclick = async () => {
    await api("/health/run", {}).catch(() => {});
    loadHealth();
  };
  async function loadReading() {
    try {
      const r = await api("/reading");
      // Split what's new into episodes to watch and chapters to read, and name the next episode airing.
      const live = r.items.filter((i) => ["watching", "reading"].includes(i.status));
      const sum = (kind) => live.filter((i) => i.kind === kind && i.behind > 0).reduce((t, i) => t + Math.ceil(i.behind), 0);
      const eps = sum("anime"), chs = sum("manga");
      const soon = live.filter((i) => i.kind === "anime" && i.next?.at && Date.parse(i.next.at) > Date.now()).sort((a, b) => Date.parse(a.next.at) - Date.parse(b.next.at))[0];
      const when = (iso) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
      const parts = [eps && `${eps} new episode${eps === 1 ? "" : "s"} to watch`, chs && `${chs} new chapter${chs === 1 ? "" : "s"} to read`].filter(Boolean);
      today.reading = r.newCount;
      today.readingText = parts.join(" and ");
      drawToday();
      if (r.items.length) $("readingLine").innerHTML = `${parts.length ? `<span class="text-emerald-600 font-medium">${esc(parts.join(", "))}</span>` : `Caught up on all ${r.items.length} on your list.`}${soon ? ` Next: ${esc(soon.title)} ep ${soon.next.n}, ${esc(when(soon.next.at))}.` : ""}`;
    } catch {}
  }
  // This week vs last week: videos posted in the last 7 days and their views so far, beside the 7 days before.
  // Newer videos have had less time, so the views are labelled "so far".
  async function loadWeek() {
    try {
      const d = await api("/stats");
      const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
      const [d7, d14] = [day(7), day(14)];
      const rows = [
        [chOfLayout("clips").name, (d.clips || []).map((c) => ({ id: c.videoId, date: c.date, views: c.views }))],
        [chOfLayout("packs").name, (d.packs || []).flatMap((p) => p.videos || []).filter((v) => v.uploadDate).map((v) => ({ id: v.videoId, date: v.uploadDate, views: v.views }))],
      ].filter(([name]) => name).map(([name, l, ids = l.map((x) => x.id).filter(Boolean)]) => {
        const pick = (a, b) => l.filter((x) => x.date && x.date > a && x.date <= b);
        const now = pick(d7, "9999"), before = pick(d14, d7);
        const v = (a) => a.reduce((t, x) => t + (x.views || 0), 0);
        // Views every video gained since the pull about a week ago (all videos, not just this week's).
        const g = d.gained7?.byId ? ids.reduce((t, id) => t + Math.max(0, d.gained7.byId[id] || 0), 0) : null;
        return { name, n: now.length, v: v(now), pn: before.length, pv: v(before), g };
      }).filter((r) => r.n || r.pn || r.g);
      if (!rows.length) return;
      const k = (n) => (n >= 1e4 ? `${(n / 1e3).toFixed(0)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`);
      $("ytWeek").innerHTML = `<div class="text-xs text-slate-500 mb-1">Posted this week (views so far) vs last week</div><ul class="space-y-1">${rows.map((r) => `<li class="flex gap-2"><span class="flex-1 min-w-0">${esc(r.name)}</span><span class="whitespace-nowrap">${r.n} video${r.n === 1 ? "" : "s"}, ${k(r.v)} views</span><span class="whitespace-nowrap text-slate-500">vs ${r.pn}, ${k(r.pv)}</span></li>`).join("")}</ul>${rows.some((r) => r.g != null) ? `<div class="text-xs text-slate-500 mt-2">Views gained by all videos since ${new Date(d.gained7.since).toLocaleDateString([], { month: "short", day: "numeric" })}: ${rows.filter((r) => r.g != null).map((r) => `${esc(r.name)} +${k(r.g)}`).join(", ")}</div>` : d.gained7?.firstAt ? `<div class="text-xs text-slate-500 mt-2">Views gained per week shows once there's a stats pull from a week ago.</div>` : ""}`;
    } catch {}
  }
  loadHealth();
  loadYt();
  loadReading();
  loadWeek();
  life.every(() => document.visibilityState === "visible" && loadYt(), 15000);
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
