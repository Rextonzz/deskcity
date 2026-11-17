// Run log panel: every pull, scan, check, backup and job with start/end, counts, step times, warnings and errors.
// Plain script. runLog.mount(box, { kinds: ["deal scan"], filters: true }) draws it into box.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const when = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const median = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
  };
  // How long a run took. An AI call is written after it ends, so its row's own ms is 0 and the call's time is aiMs
  // (trailer v7 review: every real call read "0s"). Under 10 s it shows one decimal ("2.5s"), so short runs aren't "0s".
  const took = (r) => (r.ms > 0 ? r.ms : r.aiMs > 0 ? r.aiMs : r.ms);
  const dur = (ms) => (ms != null && !isNaN(ms) && ms < 9950 ? `${(Math.max(0, ms) / 1000).toFixed(1)}s` : timing.dur(ms));
  const SKIP = new Set(["kind", "trigger", "startedAt", "endedAt", "ms", "ok", "error", "steps", "warnings", "warningCount", "missingVideos", "problems"]);
  const fmtVal = (v) => (v && typeof v === "object" ? Object.entries(v).map(([k, x]) => `${k} ${x && typeof x === "object" ? JSON.stringify(x) : x}`).join(", ") : String(v));
  const summary = (r) => Object.entries(r).filter(([k, v]) => !SKIP.has(k) && v != null && v !== "" && !(typeof v === "object" && !Object.keys(v).length)).map(([k, v]) => `${k}: ${fmtVal(v)}`).join(" · ");

  function row(r) {
    const status = !r.ok ? '<span class="text-red-600">failed</span>' : r.outcome === "held" ? '<span style="color:#fbbf24">held</span>' : r.problems?.length ? `<span style="color:#fbbf24">${r.problems.length} problem${r.problems.length > 1 ? "s" : ""}</span>` : r.stopped ? '<span style="color:#fbbf24">stopped early</span>' : '<span class="text-emerald-600">ok</span>';
    const steps = (r.steps || []).map((s) => `<li>${esc(s.name)} <span class="text-slate-500">${esc(dur(s.ms))}</span></li>`).join("");
    const warns = (r.warnings || []).map((w) => `<li>${esc(w)}</li>`).join("");
    const list = (label, items) => (items?.length ? `<div class="mt-1"><div class="text-slate-500">${label}</div><ul class="list-disc pl-5">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "");
    return `<li class="py-2"><details><summary class="cursor-pointer flex gap-x-3 gap-y-0.5 flex-wrap items-baseline">
        <span class="text-slate-500 w-28 shrink-0">${esc(when(r.startedAt))}</span>
        <span class="font-medium">${esc(r.kind)}${r.channel ? ` <span class="text-slate-500 font-normal">${esc(r.channel)}</span>` : ""}</span>
        <span>${status}</span>
        <span class="text-slate-500">${esc(dur(took(r)))}${r.trigger !== "button" ? ` · ${esc(r.trigger)}` : ""}${r.warningCount ? ` · ${r.warningCount} warning${r.warningCount > 1 ? "s" : ""}` : ""}</span>
      </summary>
      <div class="mt-1 pl-1 text-xs space-y-1" style="overflow-wrap:anywhere">
        <div class="text-slate-500">${esc(when(r.startedAt))} to ${esc(when(r.endedAt))}</div>
        ${r.error ? `<div class="text-red-600">${esc(r.error)}</div>` : ""}
        ${summary(r) ? `<div>${esc(summary(r))}</div>` : ""}
        ${steps ? `<div><div class="text-slate-500">Steps</div><ul class="list-disc pl-5">${steps}</ul></div>` : ""}
        ${list("Problems", r.problems)}
        ${warns ? `<div><div class="text-slate-500">Warnings${r.warningCount > (r.warnings || []).length ? ` (first ${r.warnings.length} of ${r.warningCount})` : ""}</div><ul class="list-disc pl-5">${warns}</ul></div>` : ""}
        ${list(`Videos with no numbers${r.missing > (r.missingVideos || []).length ? ` (first ${r.missingVideos.length} of ${r.missing})` : ""}`, r.missingVideos)}
      </div></details></li>`;
  }

  // Per kind: how many runs, how many failed, typical time. The data-point view.
  function totals(runs) {
    const by = {};
    for (const r of runs) (by[r.kind] ??= []).push(r);
    return `<table class="w-full text-sm mb-2" style="font-variant-numeric:tabular-nums"><thead class="text-left text-slate-500"><tr><th class="py-1 font-medium">Kind</th><th class="py-1 font-medium text-right">Runs</th><th class="py-1 font-medium text-right">Failed</th><th class="py-1 font-medium text-right">Typical</th><th class="py-1 font-medium text-right">Longest</th></tr></thead><tbody>${Object.entries(by)
      .map(([k, rs]) => {
        const ok = rs.filter((r) => r.ok).map(took);
        const failed = rs.length - ok.length;
        return `<tr class="border-t border-slate-100"><td class="py-1">${esc(k)}</td><td class="py-1 text-right">${rs.length}</td><td class="py-1 text-right ${failed ? "text-red-600" : ""}">${failed}</td><td class="py-1 text-right">${esc(dur(median(ok)))}</td><td class="py-1 text-right">${esc(dur(ok.length ? Math.max(...ok) : null))}</td></tr>`;
      })
      .join("")}</tbody></table>`;
  }

  function mount(box, { kinds = [], filters = false, limit = 100 } = {}) {
    let all = [], pick = "all";
    const draw = () => {
      const shown = pick === "all" ? all : pick === "failed" ? all.filter((r) => !r.ok) : all.filter((r) => r.kind === pick);
      const kindsSeen = [...new Set(all.map((r) => r.kind))];
      box.innerHTML = !all.length
        ? '<p class="text-sm text-slate-500">Nothing logged yet. Runs show here from the next restart on.</p>'
        : `${totals(all)}
          ${filters ? `<div class="flex gap-1.5 flex-wrap my-2">${["all", "failed", ...kindsSeen].map((k) => `<button data-rk="${esc(k)}" class="text-xs px-2.5 py-1 rounded-full border ${k === pick ? "bg-slate-800 text-white border-slate-800" : "border-slate-300"}">${esc(k === "all" ? "All" : k === "failed" ? "Failed" : k)}</button>`).join("")}</div>` : ""}
          <ul class="text-sm divide-y divide-slate-100">${shown.map(row).join("") || '<li class="py-2 text-slate-500">None.</li>'}</ul>
          <p class="text-xs text-slate-500 mt-2">Kept in data/logs/runs.jsonl on the PC, one line per run.</p>`;
      box.querySelectorAll("[data-rk]").forEach((b) => (b.onclick = () => ((pick = b.dataset.rk), draw())));
    };
    const load = async () => {
      try {
        const res = await fetch(`/api/pipeline/runs?limit=${limit}${kinds.length ? `&kind=${encodeURIComponent(kinds.join(","))}` : ""}`);
        if (!res.ok) throw new Error(res.status === 404 ? "the app needs a restart to load the run log" : res.statusText);
        all = (await res.json()).runs;
        draw();
      } catch (err) {
        box.innerHTML = `<p class="text-sm text-red-600">Couldn't load the run log: ${esc(err.message)}</p>`;
      }
    };
    load();
    return { reload: load };
  }
  window.runLog = { mount, took, dur };
})();
