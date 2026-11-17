// Queue: the page's working part as a block (see public/parts/kit.js). Mounted by public/queue.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, api, bindRoot } from "/stats-lib.js";
import { ago, time as clockTime } from "/lib.js";
import { scope, lifecycle } from "/parts/kit.js";

export const html = `<style>
[data-block="queue"] .row { display: flex; gap: 12px; align-items: baseline; padding: 9px 0; border-top: 1px solid var(--line-soft); }
  [data-block="queue"] .row:first-child { border-top: 0; }
  [data-block="queue"] .when { width: 118px; flex-shrink: 0; font-variant-numeric: tabular-nums; color: var(--text-secondary); font-size: 13px; }
  [data-block="queue"] .what { font-weight: 500; }
  [data-block="queue"] .dot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; margin-right: 6px; flex-shrink: 0; transform: translateY(-1px); }
  [data-block="queue"] .live { background: var(--good); animation: queue-pulse 1.6s infinite; }
  @keyframes queue-pulse { 50% { opacity: .35; } }
  [data-block="queue"] .you { color: #fbbf24; }
  [data-block="queue"] .bad { color: var(--bad-text); }
  [data-block="queue"] .ok { color: var(--good-text); }
  [data-block="queue"] .day { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); padding: 12px 0 2px; }
  [data-block="queue"] .chip { font-size: 12px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line-strong); color: var(--text-secondary); }
</style>
<div class="flex items-center gap-2 flex-wrap" data-head>
  <span id="asOf" class="text-xs text-slate-500"></span>
</div>
<div id="err" class="hidden bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-sm"></div>
<div id="paused" class="hidden bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-sm"></div>
<div id="standby" class="hidden bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-sm">This copy is on standby: it only runs TEST_ videos and never uploads or posts. Nothing below that posts will happen here.</div>

<section class="card">
  <h3 class="font-medium mb-1">Running now</h3>
  <div id="running"><p class="text-sm text-slate-500">Loading…</p></div>
</section>

<section class="card">
  <h3 class="font-medium mb-1">Waiting</h3>
  <div id="waiting"><p class="text-sm text-slate-500">Loading…</p></div>
</section>

<section class="card">
  <h3 class="font-medium mb-1">Coming up</h3>
  <p class="sub mb-1">Times are in your time zone. Daily jobs show their next run.</p>
  <div id="upcoming"><p class="text-sm text-slate-500">Loading…</p></div>
</section>

<section class="card">
  <h3 class="font-medium mb-1">Just finished</h3>
  <div id="recent" class="overflow-x-auto"></div>
</section>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "queue";
  const $ = scope(root), life = lifecycle();
  bindRoot(root, life);
  const showErr = (msg) => { const el = $("err"); el.textContent = msg; el.classList.toggle("hidden", !msg); };
  let tz = undefined;
  const time = (iso) => clockTime(iso, tz);
  const dayKey = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });
  const dayName = (iso) => {
    const k = dayKey(iso), today = dayKey(new Date().toISOString()), tomorrow = dayKey(new Date(Date.now() + 864e5).toISOString());
    return k === today ? "Today" : k === tomorrow ? "Tomorrow" : new Date(iso).toLocaleDateString([], { timeZone: tz, weekday: "long", month: "short", day: "numeric" });
  };
  const dur = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60000)} min`);
  const empty = (t) => `<div class="sub py-2">${t}</div>`;
  const sub = (x) => [x.channel, x.detail].filter(Boolean).map(esc).join(" · ");

  function render(d) {
    tz = d.tz;
    $("asOf").textContent = `Updated ${new Date(d.now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
    $("paused").classList.toggle("hidden", !d.paused);
    $("standby").classList.toggle("hidden", !d.standby);
    if (d.paused) $("paused").textContent = `The pipeline is paused${d.paused.reason ? `: ${d.paused.reason}` : ""}. Nothing new gets made or posted until it's resumed on the Pipeline page.`;

    $("running").innerHTML = d.running.length
      ? d.running.map((r) => `<div class="row"><div class="when"><span class="dot live"></span>${esc(ago(r.since, "exact"))}</div><div class="min-w-0"><div class="what">${esc(r.what)}</div><div class="sub">${sub(r)}</div></div></div>`).join("")
      : empty("Nothing right now. The app is idle.");

    $("waiting").innerHTML = d.waiting.length
      ? d.waiting.map((w) => `<div class="row"><div class="when ${w.you ? "you" : ""}">${w.you ? "You" : "In line"}</div><div class="min-w-0"><a class="what hover:underline" href="/pipeline.html#${esc(w.id)}">${esc(w.what)}</a><div class="sub">${sub(w)}</div></div></div>`).join("")
      : empty("Nothing waiting.");

    let lastDay = "";
    $("upcoming").innerHTML = d.upcoming.length
      ? d.upcoming.map((u) => {
          const day = dayName(u.at);
          const head = day !== lastDay ? `<div class="day">${esc(day)}</div>` : "";
          lastDay = day;
          return `${head}<div class="row"><div class="when">${esc(time(u.at))}</div><div class="min-w-0"><div class="what">${esc(u.what)}${u.daily ? ` <span class="chip">daily</span>` : ""}</div>${sub(u) ? `<div class="sub">${sub(u)}</div>` : ""}</div></div>`;
        }).join("")
      : empty("Nothing scheduled.");

    $("recent").innerHTML = d.recent.length
      ? d.recent.map((r) => `<div class="row"><div class="when">${esc(time(r.at))}</div><div class="min-w-0"><div class="what"><span class="${r.ok ? "ok" : "bad"}">${r.ok ? "✓" : "✗"}</span> ${esc(r.what)} <span class="sub">${esc(dur(r.ms))}</span></div>${sub(r) ? `<div class="sub">${sub(r)}</div>` : ""}${r.error ? `<div class="sub bad">${esc(r.error)}</div>` : ""}</div></div>`).join("")
      : empty("Nothing yet.");
  }

  async function load() {
    try {
      render(await api("/queue"));
      $("err").classList.add("hidden");
    } catch (err) {
      showErr(`Couldn't load the queue: ${err.message}`);
    }
  }
  load();
  life.every(() => document.visibilityState === "visible" && load(), 15000);
  life.on(document, "visibilitychange", () => document.visibilityState === "visible" && load());
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
