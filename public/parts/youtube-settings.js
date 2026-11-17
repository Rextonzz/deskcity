// YouTube settings: the page's working part as a block (see public/parts/kit.js). Mounted by public/youtube-settings.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, api } from "/lib.js";
import { scope, lifecycle } from "/parts/kit.js";
import { channels as CHANNELS, chOfLayout, place as PLACE } from "/hubinfo.js";
const PACKS = chOfLayout("packs");
const TZ_CITY = String(PLACE.timezone || "").split("/").pop().replace(/_/g, " ") || "local";

export const html = `<details id="footBox" open class="bg-white rounded-xl border border-slate-200 p-4">
  <summary class="font-semibold cursor-pointer">${esc(PACKS.name)}: footage left <span id="footCount" class="text-sm font-normal text-slate-500"></span></summary>
  <p class="mt-2 text-sm text-slate-500">Every pack in the tracker, checked against the pipeline: what's out, what's booked and until when, and anything still waiting. Use it to know when to pick up more packs.</p>
  <div id="foot" class="mt-2 text-sm">Loading…</div>
</details>

<details id="schedBox" open class="bg-white rounded-xl border border-slate-200 p-4">
  <summary class="font-semibold cursor-pointer">Posting schedule</summary>
  <p class="mt-2 text-sm text-slate-500">When each channel's videos go out (${esc(TZ_CITY)} time) and the most per day. Times are 24-hour, separated by commas. Say why you're changing it: the reason is kept and the rules review checks it against the numbers.</p>
  <div id="sched" class="mt-2 overflow-x-auto"></div>
  <div id="postStats" class="mt-3 text-sm"></div>
  <textarea id="schedWhy" rows="2" maxlength="1000" placeholder="Why (for example: stats show 4pm clips get more views)" class="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm"></textarea>
  <div class="mt-2 flex gap-2 items-center"><button id="schedSave" class="text-sm px-3 py-1.5 rounded-lg bg-red-600 text-white">Save</button><span id="schedMsg" class="text-sm text-slate-600"></span></div>
</details>

<details id="msrpBox" open class="bg-white rounded-xl border border-slate-200 p-4">
  <summary class="font-semibold cursor-pointer">Pack prices (MSRP)</summary>
  <p class="mt-2 text-sm text-slate-500">What each pack costs in the ${esc(PACKS.name)} videos: MSRP, never what was paid. "Assumed" marks prices that aren't official. Saving changes pipeline.config.json, which is in the nightly backup.</p>
  <div id="msrp" class="mt-2 overflow-x-auto"></div>
  <div class="mt-2 flex gap-2 flex-wrap items-center"><button id="msrpAdd" class="text-sm px-3 py-1.5 rounded-lg border border-slate-300">Add a row</button><button id="msrpSave" class="text-sm px-3 py-1.5 rounded-lg bg-red-600 text-white">Save</button><span id="msrpMsg" class="text-sm text-slate-600"></span></div>
</details>

<details id="epBox" class="bg-white rounded-xl border border-slate-200 p-4">
  <summary class="font-semibold cursor-pointer">${esc(PACKS.name)} episode check</summary>
  <p class="mt-2 text-sm text-slate-500">Goes through every episode in the Pack Tracker and the pipeline, in order: numbers used twice or skipped, a series total on the video that doesn't add up from the episodes before it, tracker rows that disagree, and episodes going out of order. Read-only, no AI cost.</p>
  <button id="epRun" class="mt-2 text-sm px-3 py-1.5 rounded-lg border border-slate-300">Check now</button>
  <div id="ep" class="mt-2 text-sm"></div>
</details>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "youtube-settings";
  const $ = scope(root), life = lifecycle();
  // Pack prices (MSRP), the episode check, the posting schedule and footage left.
  let msrpRows = [];
  const msrpRow = (r, i) => `<tr class="border-t border-slate-100"><td class="py-1 pr-2"><input data-m="${i}" data-f="set" value="${esc(r.set)}" class="w-full min-w-[10rem] rounded border border-slate-300 px-2 py-1" /></td><td class="py-1 pr-2"><select data-m="${i}" data-f="product" class="rounded border border-slate-300 px-2 py-1">${["Play Booster", "Set Booster", "Collector Booster", "Draft Booster", "Other"].concat(r.product && !["Play Booster", "Set Booster", "Collector Booster", "Draft Booster", "Other"].includes(r.product) ? [r.product] : []).map((p) => `<option ${p === r.product ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></td><td class="py-1 pr-2"><input data-m="${i}" data-f="price" type="number" step="0.01" min="0" value="${r.price ?? ""}" class="w-24 rounded border border-slate-300 px-2 py-1 text-right" /></td><td class="py-1 pr-2 text-center"><input data-m="${i}" data-f="assumed" type="checkbox" ${r.assumed ? "checked" : ""} /></td><td class="py-1"><button data-mdel="${i}" class="text-xs text-red-600">Remove</button></td></tr>`;
  function drawMsrp() {
    $("msrp").innerHTML = `<table class="w-full text-sm whitespace-nowrap"><thead class="text-left text-slate-500"><tr><th class="py-1 font-medium">Set</th><th class="py-1 font-medium">Booster</th><th class="py-1 font-medium">MSRP (USD)</th><th class="py-1 font-medium">Assumed</th><th></th></tr></thead><tbody>${msrpRows.map(msrpRow).join("")}</tbody></table>`;
    $.all("[data-m]").forEach((el) => (el.oninput = el.onchange = () => (msrpRows[el.dataset.m][el.dataset.f] = el.type === "checkbox" ? el.checked : el.value)));
    $.all("[data-mdel]").forEach((b) => (b.onclick = () => (msrpRows.splice(Number(b.dataset.mdel), 1), drawMsrp())));
  }
  async function loadMsrp() {
    msrpRows = await api("/admin/msrp").catch(() => []);
    drawMsrp();
  }
  $("msrpAdd").onclick = () => (msrpRows.push({ set: "", product: "Play Booster", price: "", assumed: false }), drawMsrp());
  $("msrpSave").onclick = async () => {
    try { msrpRows = await api("/admin/msrp", { rows: msrpRows }); drawMsrp(); $("msrpMsg").textContent = `Saved ${msrpRows.length} prices.`; } catch (err) { $("msrpMsg").textContent = err.message; }
  };
  $("epRun").onclick = async () => {
    $("ep").textContent = "Checking…";
    try {
      const r = await api("/admin/episode-check");
      const bad = new Set(r.issues.map((i) => i.episode));
      $("ep").innerHTML = `<p class="${r.issues.length ? "text-amber-700" : "text-emerald-700"} font-medium">${r.issues.length ? `${r.issues.length} problem${r.issues.length > 1 ? "s" : ""} found` : "All episodes line up."}</p>` +
        (r.issues.length ? `<ul class="mt-1 list-disc pl-5 space-y-1">${r.issues.map((i) => `<li>${esc(i.text)}</li>`).join("")}</ul>` : "") +
        `<div class="mt-2 overflow-x-auto"><table class="w-full whitespace-nowrap"><thead class="text-left text-slate-500"><tr><th class="py-1 pr-3 font-medium">Ep</th><th class="py-1 pr-3 font-medium">Set</th><th class="py-1 pr-3 font-medium text-right">Net</th><th class="py-1 pr-3 font-medium text-right">Series in</th><th class="py-1 font-medium">State</th></tr></thead><tbody>${r.episodes.map((e) => `<tr class="border-t border-slate-100 ${bad.has(e.episode) ? "text-amber-700" : ""}"><td class="py-1 pr-3">${e.episode}</td><td class="py-1 pr-3">${esc(e.set || e.packId || "")}</td><td class="py-1 pr-3 text-right">${e.net == null ? "" : `$${e.net.toFixed(2)}`}</td><td class="py-1 pr-3 text-right">${e.seriesBefore == null ? "" : `$${e.seriesBefore.toFixed(2)}`}</td><td class="py-1">${esc(e.from === "tracker" ? "tracker" : e.status + (e.publishAt ? ` · ${new Date(e.publishAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""))}</td></tr>`).join("")}</tbody></table></div>`;
    } catch (err) { $("ep").textContent = err.message; }
  };
  let schedRows = [];
  function drawSched() {
    $("sched").innerHTML = `<table class="w-full text-sm whitespace-nowrap"><thead class="text-left text-slate-500"><tr><th class="py-1 pr-2 font-medium">Channel</th><th class="py-1 pr-2 font-medium">Weekdays</th><th class="py-1 pr-2 font-medium">Weekends</th><th class="py-1 font-medium">Most a day</th></tr></thead><tbody>${schedRows.map((r, i) => `<tr class="border-t border-slate-100"><td class="py-1 pr-2">${esc(r.name)}</td><td class="py-1 pr-2"><input data-s="${i}" data-f="weekday" value="${esc(r.weekday.join(", "))}" class="w-32 rounded border border-slate-300 px-2 py-1" /></td><td class="py-1 pr-2"><input data-s="${i}" data-f="weekend" value="${esc(r.weekend.join(", "))}" class="w-32 rounded border border-slate-300 px-2 py-1" /></td><td class="py-1"><input data-s="${i}" data-f="perDay" type="number" min="1" max="10" placeholder="no limit" value="${r.perDay ?? ""}" class="w-20 rounded border border-slate-300 px-2 py-1" /></td></tr>`).join("")}</tbody></table>`;
    $.all("[data-s]").forEach((el) => (el.oninput = () => (schedRows[el.dataset.s][el.dataset.f] = el.value)));
  }
  $("schedBox").addEventListener("toggle", async () => {
    if (!$("schedBox").open) return;
    schedRows = await api("/admin/schedule").catch(() => []);
    drawSched();
    const st = await api("/admin/posting-stats").catch(() => null);
    if (!st) return;
    // Views by weekday as 7 bars (design review finding 20): the best day is blue and marked "best"; days with fewer
    // than 3 videos are faded, since their average is only a hint. Value on top, day and video count underneath.
    const dayBars = (days) => {
      const top = Math.max(1, ...days.map((d) => d.avgViews));
      const best = days.filter((d) => d.videos >= 3).sort((a, b) => b.avgViews - a.avgViews)[0];
      return `<div style="display:flex;gap:6px;align-items:flex-end;height:150px;margin-top:8px;max-width:460px">${days.map((d) => {
        const isBest = d === best, thin = d.videos < 3;
        return `<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%" title="${d.day}: ${d.avgViews.toLocaleString()} average views from ${d.videos} video${d.videos === 1 ? "" : "s"}">
          <span style="font-size:11px;color:var(--text-secondary);white-space:nowrap">${isBest ? "best · " : ""}${compactN(d.avgViews)}</span>
          <div style="width:100%;height:${Math.max(3, Math.round((d.avgViews / top) * 105))}px;border-radius:4px 4px 0 0;background:${isBest ? "var(--good)" : "var(--text-muted)"};opacity:${thin ? 0.4 : 1}"></div>
          <span style="font-size:12px;margin-top:3px;${isBest ? "font-weight:600" : ""}">${d.day}</span>
          <span style="font-size:11px;color:var(--text-muted)">${d.videos}</span>
        </div>`; }).join("")}</div>`;
    };
    const compactN = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
    const part = (name, p) => !p || !p.videos ? "" : `<div class="mt-2"><div class="font-medium">${name}: average views by when it went out <span class="text-slate-500 font-normal">(${p.videos} videos, 3+ days old)</span></div>` +
      dayBars(p.byDay) +
      (p.byTime.length ? `<div class="mt-1 flex flex-wrap gap-x-4 gap-y-1">${p.byTime.map((t) => `<span>${t.time} <b>${t.avgViews.toLocaleString()}</b> <span class="text-slate-500">(${t.videos})</span></span>`).join("")}</div>` : "") + `</div>`;
    $("postStats").innerHTML = CHANNELS.map((c) => part(c.name, st[c.id])).join("") + `<p class="mt-1 text-slate-500">The small number under each day, and the numbers in brackets, are how many videos each average is from. Faded bars have fewer than 3, so they're only a hint.</p>`;
  });
  $("schedSave").onclick = async () => {
    try { const r = await api("/admin/schedule", { rows: schedRows, why: $("schedWhy").value }); schedRows = r.rows; drawSched(); $("schedMsg").textContent = r.changed ? "Saved. New uploads use it." : "Nothing changed."; if (r.changed) $("schedWhy").value = ""; } catch (err) { $("schedMsg").textContent = err.message; }
  };
  async function loadFootage() {
    let r;
    try { r = await api(`/channels/${PACKS.id}/footage`); } catch (err) { $("foot").textContent = err.noRoute ? "The app needs a restart to show this." : err.message; return; }
    const day = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const name = (p) => `${p.episode ? `#${p.episode} ` : ""}${esc(p.set || "?")} ${esc(p.product || "")} <span class="text-slate-500">(${esc(p.id)})</span>`;
    const usable = r.waiting.filter((w) => !/^Skipped/.test(w.why));
    const again = (id) => `<button data-again="${esc(id)}" class="mt-1 text-xs px-2 py-1 rounded border border-slate-300">Try again</button>`;
    const verdict = r.booked.length
      ? `Booked through <b>${esc(day(r.lastBooked))}</b> (${r.booked.length} to go).`
      : `<b>Nothing booked.</b>`;
    const buy = !usable.length ? ` <span class="text-amber-700">No other footage is ready, so after that the channel runs dry: time to pick up packs.</span>` : ` ${usable.length} more waiting below.`;
    $("footCount").textContent = `(${r.out} out, ${r.booked.length} booked, ${r.waiting.length} waiting)`;
    $("foot").innerHTML = `<p>${verdict}${buy}</p>` +
      (r.gaps.length ? `<p class="mt-1 text-red-700">Episode gap: #${r.gaps.join(", #")} ${r.gaps.length === 1 ? "isn't" : "aren't"} public while later episodes are.</p>` : "") +
      (r.booked.length ? `<h3 class="mt-3 font-medium">Booked</h3><ul class="divide-y divide-slate-100">${r.booked.map((b) => `<li class="py-1 flex gap-2"><span class="w-28 shrink-0 text-slate-500">${esc(day(b.publishAt))}</span><span class="flex-1">${name(b)}</span></li>`).join("")}</ul>` : "") +
      (r.waiting.length ? `<h3 class="mt-3 font-medium">Not out yet</h3><ul class="divide-y divide-slate-100">${r.waiting.map((w) => `<li class="py-1"><div>${name(w)}</div><div class="text-xs text-slate-500">${esc(w.why)}${w.raw ? ` · ${esc(w.raw)}` : ""}</div>${w.archived ? again(w.archived) : ""}</li>`).join("")}</ul>` : "") +
      (r.loose.length ? `<h3 class="mt-3 font-medium">Video files not in the tracker</h3><ul class="divide-y divide-slate-100">${r.loose.map((l) => `<li class="py-1"><div>${esc(l.file)}</div><div class="text-xs text-slate-500">${esc(l.why)}</div>${l.archived ? again(l.archived) : ""}</li>`).join("")}</ul>` : "");
    $("foot").querySelectorAll("[data-again]").forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try { await api(`/jobs/${encodeURIComponent(b.dataset.again)}/unskip`, {}); b.textContent = "Back in line"; life.later(loadFootage, 1500); } catch (err) { b.textContent = err.message; b.disabled = false; }
    }));
  }
  loadFootage();
  $("msrpBox").addEventListener("toggle", () => $("msrpBox").open && loadMsrp());
  loadMsrp();
  $("schedBox").dispatchEvent(new Event("toggle"));
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
