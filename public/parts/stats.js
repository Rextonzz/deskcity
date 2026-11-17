// Channel Stats: the page's working part as a block (see public/parts/kit.js). Mounted by public/stats.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, api, watchJob } from "/lib.js";
import { usd, signed, bindRoot } from "/stats-lib.js";
import { scope, lifecycle, needScripts } from "/parts/kit.js";
import { channels as CHANNELS, chOfLayout } from "/hubinfo.js";
const PACKS = chOfLayout("packs"), CLIPS = chOfLayout("clips");

export const html = `<section class="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3 flex-wrap">
  <div class="basis-full sm:basis-0 flex-1 min-w-0">
    <div class="font-semibold">Studio stats</div>
    <div id="pullText" class="text-sm text-slate-500">Loading…</div>
    <div id="pullBarWrap" class="hidden h-2 rounded bg-slate-100 overflow-hidden mt-2"><div id="pullBar" class="h-full bg-red-600 w-0"></div></div>
  </div>
  <div class="flex gap-2">
    <button id="quickBtn" class="border border-slate-300 hover:border-slate-400 text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50" title="Views, comments and length for every Short, from Studio's Content list. Takes about a minute.">Quick pull</button>
    <button id="advBtn" class="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50" title="Pick which channels, videos and numbers to pull, with a time estimate.">Advanced pull</button>
    <button id="stopBtn" class="hidden border border-slate-300 hover:border-slate-400 text-sm font-medium px-4 py-2 rounded-lg" title="Stops after the video it's on and saves everything read so far to the trackers.">Stop and save</button>
  </div>
  <div id="adv" class="hidden basis-full border-t border-slate-200 pt-3 mt-1 text-sm space-y-3">
    <div class="flex gap-2 flex-wrap items-center"><span class="text-slate-500">Start from:</span>
      <button data-preset="quick" class="text-xs px-2.5 py-1 rounded-full border border-slate-300">Quick (views only)</button>
      <button data-preset="full" class="text-xs px-2.5 py-1 rounded-full border border-slate-300">Everything</button>
      <button data-preset="best" class="text-xs px-2.5 py-1 rounded-full border border-slate-300">Recommended</button>
    </div>
    <fieldset><legend class="font-medium mb-1">Channels</legend>
      ${CHANNELS.map((c, i) => `<label${i < CHANNELS.length - 1 ? ' class="mr-4"' : ""}><input type="checkbox" name="ch" value="${esc(c.id)}" checked /> ${esc(c.name)} <span class="text-slate-500" data-count="${esc(c.id)}"></span></label>`).join("\n      ")}
    </fieldset>
    <fieldset><legend class="font-medium mb-1">Videos</legend>
      <label class="block"><input type="radio" name="vids" value="all" checked /> All posted videos</label>
      <label class="block"><input type="radio" name="vids" value="recent" /> Posted in the last <input id="days" type="number" min="1" max="3650" value="30" class="w-16 rounded border px-1 py-0.5" /> days</label>
      <label class="block"><input type="radio" name="vids" value="missing" /> Only ones still missing numbers</label>
    </fieldset>
    <fieldset><legend class="font-medium mb-1">Numbers</legend>
      <label class="block"><input type="checkbox" id="optList" checked /> Views, comments and length for every Short <span class="text-slate-500" id="costList"></span></label>
      <label class="block"><input type="checkbox" name="tab" value="tab-overview" checked /> Subscribers gained and stayed to watch <span class="text-slate-500" data-cost="tab-overview"></span></label>
      <label class="block"><input type="checkbox" name="tab" value="tab-engagement" /> Engagement page: engaged views, watch time, average % viewed <span class="text-slate-500" data-cost="tab-engagement"></span></label>
      <label class="block"><input type="checkbox" name="tab" value="tab-content" /> Reach page: impressions, click rate, viewed vs swiped away <span class="text-slate-500" data-cost="tab-content"></span></label>
      <label class="block"><input type="checkbox" id="optComments" /> Comment text, only for videos with new comments <span class="text-slate-500" id="costComments"></span></label>
    </fieldset>
    <div class="flex items-center gap-3 flex-wrap">
      <div id="advEst" class="flex-1 min-w-0 font-medium"></div>
      <button id="advGo" class="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">Start pull</button>
    </div>
  </div>
</section>

<div id="err" class="hidden bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-sm"></div>

<section class="space-y-3">
  <div class="flex items-center gap-3"><h2 class="font-semibold flex-1">${esc(PACKS.name)}</h2>
</div>
  <div id="fpTiles" class="grid grid-cols-2 md:grid-cols-4 gap-3"></div>
  <div class="bg-white rounded-xl border border-slate-200 p-4">
    <div class="text-sm font-medium mb-1">Net per episode, and the running series total</div>
    <div class="text-xs text-slate-500 mb-2 flex gap-4"><span><span class="inline-block w-3 h-3 rounded-sm align-middle" style="background:var(--pos)"></span> Profit</span><span><span class="inline-block w-3 h-3 rounded-sm align-middle" style="background:var(--neg)"></span> Loss</span><span><span class="inline-block w-3 h-0.5 align-middle" style="background:var(--text-primary)"></span> Series total</span></div>
    <div id="fpChart" class="w-full overflow-x-auto"></div>
  </div>
  <div class="bg-white rounded-xl border border-slate-200 overflow-x-auto">
    <table class="w-full text-sm whitespace-nowrap">
      <thead class="text-left text-slate-500 border-b border-slate-200">
        <tr><th class="p-2">Ep</th><th class="p-2">Pack</th><th class="p-2 text-right">Cost</th><th class="p-2 text-right">Value</th><th class="p-2 text-right">Net</th><th class="p-2 text-right">Series</th><th class="p-2">Best card</th><th class="p-2 text-right">Views</th><th class="p-2 text-right">Likes</th><th class="p-2 text-right">Stayed</th><th class="p-2 text-right">Avg viewed</th><th class="p-2">Checked</th></tr>
      </thead>
      <tbody id="fpRows"></tbody>
    </table>
  </div>
</section>

<section class="space-y-3">
  <div class="flex items-center gap-3"><h2 class="font-semibold flex-1">${esc(CLIPS.name)}</h2>
<a href="/stats-tiktok.html" class="text-sm bg-slate-100 hover:bg-slate-200 rounded-lg px-3 py-1.5">TikTok →</a></div>
  <div id="czTiles" class="grid grid-cols-2 md:grid-cols-4 gap-3"></div>
  <div class="bg-white rounded-xl border border-slate-200 overflow-x-auto">
    <table class="w-full text-sm">
      <thead class="text-left text-slate-500 border-b border-slate-200">
        <tr><th class="p-2">Date</th><th class="p-2">Title</th><th class="p-2">Creator</th><th class="p-2 text-right">Views</th><th class="p-2 whitespace-nowrap">As of</th></tr>
      </thead>
      <tbody id="czRows"></tbody>
    </table>
  </div>
</section>
<details id="runlogBox" class="bg-white rounded-xl border border-slate-200 p-4">
  <summary class="font-semibold cursor-pointer">Pull log</summary>
  <p class="mt-2 text-sm text-slate-500">Every quick and full pull: start and end, videos read, what was missing, step times and errors.</p>
  <div id="runlog" class="mt-2"></div>
</details>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "stats";
  const $ = scope(root), life = lifecycle();
  bindRoot(root, life);
  const showErr = (msg) => { const el = $("err"); el.textContent = msg; el.classList.toggle("hidden", !msg); };
  await needScripts(["/timing.js","/runlog.js"]);
  const int = (n) => (n == null ? "" : Math.round(n).toLocaleString());
  const pct = (n) => (n == null ? "" : `${(n * 100).toFixed(1)}%`);
  const tone = (n) => (n == null ? "" : n < 0 ? "text-rose-600" : "text-emerald-600");
  const tile = (label, value, cls = "") => `<div class="bg-white rounded-xl border border-slate-200 p-3"><div class="text-xs text-slate-500">${esc(label)}</div><div class="text-xl font-semibold ${cls}">${value}</div></div>`;

  function chart(eps) {
    if (!eps.length) return '<div class="text-sm text-slate-500">No episodes yet.</div>';
    const W = Math.max(900, eps.length * 34), H = 220, pad = { l: 44, r: 8, t: 10, b: 24 };
    const vals = eps.flatMap((e) => [e.net ?? 0, e.seriesNet ?? 0, 0]);
    // Round gridlines ($25, $50...) instead of the exact low, middle and high (design review 2026-10-21).
    const raw = (Math.max(...vals) - Math.min(...vals) || 1) / 4, mag = 10 ** Math.floor(Math.log10(raw));
    const tStep = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw);
    const min = Math.floor(Math.min(...vals) / tStep) * tStep, max = Math.ceil(Math.max(...vals) / tStep) * tStep, span = max - min || 1;
    const tickVals = [];
    for (let v = min; v <= max + tStep / 2; v += tStep) tickVals.push(+v.toFixed(6));
    const y = (v) => pad.t + ((max - v) / span) * (H - pad.t - pad.b);
    const step = (W - pad.l - pad.r) / eps.length, bw = Math.min(22, step * 0.6);
    const x = (i) => pad.l + step * i + step / 2;
    const ticks = tickVals.map((v) => `<text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end" fill="var(--text-muted)" font-size="10">${usd(Math.round(v))}</text><line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/>`).join("");
    const bars = eps.map((e, i) => {
      const v = e.net ?? 0, top = y(Math.max(v, 0)), h = Math.max(1, Math.abs(y(v) - y(0)));
      return `<rect x="${x(i) - bw / 2}" y="${top}" width="${bw}" height="${h}" rx="2" fill="${v < 0 ? "var(--neg)" : "var(--pos)"}"><title>Ep ${e.episode}: ${signed(e.net)} (${esc(e.set)})</title></rect><text x="${x(i)}" y="${H - 8}" text-anchor="middle" fill="var(--text-muted)" font-size="10">${e.episode}</text>`;
    }).join("");
    const line = eps.map((e, i) => `${i ? "L" : "M"}${x(i)},${y(e.seriesNet ?? 0)}`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:${Math.min(W, 640)}px" class="max-w-none">${ticks}<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--axis)"/>${bars}<path d="${line}" fill="none" stroke="var(--text-primary)" stroke-width="2"/>${eps.map((e, i) => `<circle cx="${x(i)}" cy="${y(e.seriesNet ?? 0)}" r="2.5" fill="var(--text-primary)"><title>After Ep ${e.episode}: ${signed(e.seriesNet)}</title></circle>`).join("")}</svg>`;
  }

  function renderPacks(packs) {
    if (!packs) {
      $("fpTiles").innerHTML = "";
      $("fpChart").innerHTML = '<div class="text-sm text-slate-500">Pack Tracker not found at the path in pipeline.config.json.</div>';
      return;
    }
    const eps = packs.filter((p) => p.episode != null).sort((a, b) => a.episode - b.episode);
    const latest = eps[eps.length - 1];
    const video = (p) => p.videos.find((v) => v.videoId) || p.videos[0] || {};
    const views = packs.reduce((s, p) => s + p.videos.reduce((t, v) => t + (v.views || 0), 0), 0);
    const best = packs.filter((p) => p.bestPrice != null).sort((a, b) => b.bestPrice - a.bestPrice)[0];
    $("fpTiles").innerHTML = [
      tile("Series total", signed(latest?.seriesNet), tone(latest?.seriesNet)),
      tile("Episodes", eps.length),
      tile("Total views", int(views)),
      tile("Best pull", best ? `${usd(best.bestPrice)} <span class="text-sm font-normal text-slate-500">${esc(best.bestCard)}</span>` : ""),
    ].join("");
    $("fpChart").innerHTML = chart(eps);
    $("fpRows").innerHTML = [...eps].reverse().map((p) => {
      const v = video(p);
      return `<tr class="border-b border-slate-100 last:border-0">
        <td class="p-2 font-medium">${p.episode}</td>
        <td class="p-2">${esc(p.set)} <span class="text-slate-500">${esc(p.product)}</span>${v.videoId ? ` <a class="text-red-700 hover:underline" target="_blank" rel="noopener" href="https://youtube.com/shorts/${esc(v.videoId)}">▶</a>` : ""}</td>
        <td class="p-2 text-right">${usd(p.cost)}</td><td class="p-2 text-right">${usd(p.value)}</td>
        <td class="p-2 text-right font-medium ${tone(p.net)}">${signed(p.net)}</td><td class="p-2 text-right ${tone(p.seriesNet)}">${signed(p.seriesNet)}</td>
        <td class="p-2">${esc(p.bestCard)} <span class="text-slate-500">${usd(p.bestPrice)}</span></td>
        <td class="p-2 text-right">${int(v.views)}</td><td class="p-2 text-right">${int(v.likes)}</td>
        <td class="p-2 text-right">${pct(v.stayed)}</td><td class="p-2 text-right">${pct(v.avgPct)}</td>
        <td class="p-2 text-slate-500">${esc(v.checkedOn || "")}</td></tr>`;
    }).join("");
  }

  function renderClips(clips) {
    if (!clips) {
      $("czTiles").innerHTML = "";
      $("czRows").innerHTML = `<tr><td class="p-2 text-slate-500" colspan="5">No upload log yet. It is created with the first ${CLIPS.name} job.</td></tr>`;
      return;
    }
    const withViews = clips.filter((c) => c.views != null);
    const total = withViews.reduce((s, c) => s + c.views, 0);
    const top = [...withViews].sort((a, b) => b.views - a.views)[0];
    $("czTiles").innerHTML = [
      tile("Clips posted", clips.length),
      tile("Total views", int(total)),
      tile("Average views", withViews.length ? int(total / withViews.length) : ""),
      tile("Top clip", top ? `${int(top.views)} <span class="text-sm font-normal text-slate-500">${esc(top.title)}</span>` : ""),
    ].join("");
    $("czRows").innerHTML = [...clips].reverse().map((c) => `<tr class="border-b border-slate-100 last:border-0">
      <td class="p-2 whitespace-nowrap text-slate-500">${esc(c.date)}</td>
      <td class="p-2">${esc(c.title)}${c.notInLog ? ` <span class="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500" title="On the channel but not in your upload log">not in log</span>` : ""}${c.videoId ? ` <a class="text-red-700 hover:underline" target="_blank" rel="noopener" href="https://youtube.com/shorts/${esc(c.videoId)}">▶</a>` : ""}</td>
      <td class="p-2">${esc(c.creator)}</td><td class="p-2 text-right">${int(c.views)}</td><td class="p-2 whitespace-nowrap text-slate-500">${esc(c.viewsAsOf || "")}</td></tr>`).join("");
  }

  let pullTimes = {};
  let pullRunning = false;
  function renderPull(p) {
    pullRunning = p.running;
    pullTimes = p.typical || pullTimes;
    $("quickBtn").textContent = `Quick pull${pullTimes.quick ? ` · ${timing.est(pullTimes.quick)}` : ""}`;
    $("advBtn").disabled = $("quickBtn").disabled = $("advGo").disabled = p.running;
    $("stopBtn").classList.toggle("hidden", !p.running || (p.plan && !p.plan.tabs?.length));
    $("stopBtn").disabled = Boolean(p.stopRequested);
    $("stopBtn").textContent = p.stopRequested ? "Stopping after this video…" : "Stop and save";
    $("pullBarWrap").classList.toggle("hidden", !p.running);
    if (p.running) {
      const elapsedMs = p.startedAt ? Date.now() - Date.parse(p.startedAt) : null;
      $("pullText").textContent = `${p.kind === "advanced" ? "Advanced pull: " : p.quick ? "Quick pull: " : ""}${p.stopRequested ? "stopping after this video. " : ""}${p.total ? `${p.done} of ${p.total} done` : "Getting started"}${p.current ? ` (${p.current})` : ""}. ${elapsedMs != null ? timing.progressText({ elapsedMs, done: p.done, total: p.total, typicalMs: p.done ? null : p.typicalMs }) + ". " : ""}Leave the pipeline's Chrome window alone.`;
      $("pullBar").style.width = p.total ? `${(p.done / p.total) * 100}%` : "5%";
      return;
    }
    const last = p.last;
    if (!last) return ($("pullText").textContent = "Not pulled yet. Close the trackers in Excel first.");
    const when = new Date(last.finishedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    if (last.error) return ($("pullText").textContent = `Last pull (${when}) failed: ${last.error}`);
    const r = last.result || {};
    const miss = last.missing?.length ? ` No numbers found for ${last.missing.length}: ${last.missing.slice(0, 4).join(", ")}${last.missing.length > 4 ? "…" : ""}.` : "";
    $("pullText").textContent = `Last ${last.kind === "advanced" ? "advanced pull" : last.quick ? "quick pull (views only)" : "full pull"}${last.stopped ? " (stopped early, saved what it read)" : ""} ${when}: updated ${r.packs ?? 0} ${PACKS.name} and ${r.clips ?? 0} ${CLIPS.name} rows${r.added ? `, added ${r.added} Shorts that were missing from your log` : ""}${r.matched ? `, filled in ${r.matched} missing video IDs` : ""}.${miss}`;
  }

  async function load() {
    try {
      const d = await api("/stats");
      $("err").classList.add("hidden");
      renderPacks(d.packs);
      renderClips(d.clips);
      renderPull(d.pull);
      if (d.pull.running) watchPull();
    } catch (err) {
      showErr("Couldn't load stats: " + err.message);
    }
  }

  const watchPull = watchJob({ life, poll: () => api("/stats/pull"), render: renderPull, lost: (err) => showErr(err ? err.message : ""), done: () => (load(), pullLog.reload()) });

  // Advanced pull: pick channels, videos and numbers; the estimate uses how long each part took on past pulls.
  let planInfo = null;
  const readPlan = () => ({
    channels: [...$.all('[name="ch"]:checked')].map((x) => x.value),
    videos: $.one('[name="vids"]:checked').value,
    days: Number($("days").value) || 30,
    list: $("optList").checked,
    tabs: [...$.all('[name="tab"]:checked')].map((x) => x.value),
    comments: $("optComments").checked,
  });
  function estimate(plan) {
    if (!planInfo) return null;
    const r = planInfo.rates;
    const since = new Date(Date.now() - plan.days * 864e5).toISOString().slice(0, 10);
    const vids = planInfo.videos.filter((v) => plan.channels.includes(v.ch) && (plan.videos === "all" || (plan.videos === "recent" ? !v.date || v.date >= since : v.missing)));
    const listCount = plan.list ? plan.channels.length : plan.channels.includes(CLIPS.id) && plan.tabs.length ? 1 : 0;
    const perVideo = plan.tabs.length ? vids.length : 0;
    const chs = new Set(vids.map((v) => v.ch)).size;
    const cm = plan.comments ? vids.filter((v) => v.comments).length : 0;
    const ms = 15000 + listCount * r.list + perVideo * plan.tabs.reduce((t, tab) => t + (r.tabs[tab] || 0), 0) + (perVideo || cm ? chs * r.switch : 0) + cm * (r.comments || 8000);
    return { ms, videos: vids.length, perVideo, cm };
  }
  function drawPlan() {
    if (!planInfo) return;
    const r = planInfo.rates;
    const plan = readPlan();
    for (const ch of CHANNELS.map((c) => c.id)) $.one(`[data-count="${ch}"]`).textContent = `(${planInfo.videos.filter((v) => v.ch === ch).length} videos)`;
    $("costList").textContent = `· one page per channel, ${timing.est(r.list)} each`;
    for (const el of $.all("[data-cost]")) {
      const tab = el.dataset.cost, empty = r.emptyShare?.[tab];
      el.innerHTML = `· ${esc(timing.est(r.tabs[tab]).replace("~1 min", r.tabs[tab] < 60000 ? `~${Math.round(r.tabs[tab] / 1000)} s` : "~1 min"))} a video${empty >= 0.5 ? ` <span class="text-amber-700">· came back empty for ${Math.round(empty * 100)}% of videos last time</span>` : ""}`;
    }
    const cmDue = planInfo.videos.filter((v) => v.comments && plan.channels.includes(v.ch)).length;
    $("costComments").textContent = `· ${cmDue} with new comments, ~${Math.round((r.comments || 8000) / 1000)} s each`;
    const e = estimate(plan);
    const nothing = !plan.channels.length || (!plan.list && !plan.tabs.length && !plan.comments) || !e.videos;
    $("advGo").disabled = nothing || pullRunning;
    $("advEst").textContent = nothing ? "Nothing to pull with these choices." : `${e.videos} video${e.videos === 1 ? "" : "s"}${e.perVideo ? `, ${e.perVideo} opened one by one` : ""}${e.cm ? `, comments on ${e.cm}` : ""} · about ${timing.est(e.ms).replace("~", "")}`;
  }
  const PRESET_UI = { quick: { list: true, tabs: [], comments: false }, full: { list: true, tabs: ["tab-overview", "tab-engagement", "tab-content"], comments: true }, best: { list: true, tabs: ["tab-overview"], comments: true } };
  $.all("[data-preset]").forEach((b) => (b.onclick = () => {
    const p = PRESET_UI[b.dataset.preset];
    $("optList").checked = p.list;
    $("optComments").checked = p.comments;
    $.all('[name="tab"]').forEach((x) => (x.checked = p.tabs.includes(x.value)));
    $.all('[name="ch"]').forEach((x) => (x.checked = true));
    $.one('[name="vids"][value="all"]').checked = true;
    drawPlan();
  }));
  $("adv").addEventListener("input", drawPlan);
  $("adv").addEventListener("change", drawPlan);
  $("advBtn").onclick = async () => {
    $("adv").classList.toggle("hidden");
    if (!planInfo && !$("adv").classList.contains("hidden")) {
      $("advEst").textContent = "Counting videos…";
      planInfo = await api("/stats/pull/plan").catch((err) => (($("advEst").textContent = "Couldn't load: " + err.message), null));
      drawPlan();
    }
  };
  $("advGo").onclick = async () => {
    const plan = readPlan(), e = estimate(plan);
    try {
      if (!(await timing.confirmLong({ ms: e?.ms, what: "This pull", note: "Stop and save ends it early and keeps what it read." }))) return;
      renderPull(await api("/stats/pull", { plan }));
      watchPull();
    } catch (err) {
      $("pullText").textContent = "Couldn't start: " + err.message;
    }
  };
  $("stopBtn").onclick = async () => renderPull(await api("/stats/pull/stop", {}).catch(() => ({ running: true, stopRequested: true })));

  const startPull = (quick) => async () => {
    try {
      if (!(await timing.confirmLong({ ms: pullTimes[quick ? "quick" : "full"], what: quick ? "The quick pull" : "The full pull", untimedLong: !quick, note: quick ? "" : "The quick pull is much faster if you only need views." }))) return;
      renderPull(await api("/stats/pull", { quick }));
      watchPull();
    } catch (err) {
      $("pullText").textContent = "Couldn't start: " + err.message;
    }
  };
  const pullLog = runLog.mount($("runlog"), { kinds: ["quick pull", "full pull"] });
  $("quickBtn").onclick = startPull(true);

  load();
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
