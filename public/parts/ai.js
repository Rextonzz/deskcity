// AI and spend: the page's working part as a block (see public/parts/kit.js). Mounted by public/ai.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, api } from "/stats-lib.js";
import { scope, lifecycle, needScripts } from "/parts/kit.js";

// ONE action layer (the contract in parts/kit.js): the meter wall in the Control Center (campus/props.js) and Neural
// call these. Alert rules spend nothing, so no password (the hub's rule for /agents/alerts).
export const ACTIONS = {
  dayRule: { words: ["alert", "tell me", "day", "daily", "spend", "rule"], label: (usd) => `Tell me if it spends more than $${usd} in a day`, run: (desk, usd) => api("/agents/alerts", { type: "day_spend", desk, usd }) },
  deskOver: { words: ["alert", "tell me", "cap", "month", "over", "rule"], label: () => "Tell me if its month heads over its cap", run: (desk) => api("/agents/alerts", { type: "desk_projected", desk }) },
  monthOver: { words: ["alert", "tell me", "budget", "month", "over", "rule", "hub"], label: () => "Tell me if the month heads over the budget", run: () => api("/agents/alerts", { type: "month_projected" }) },
  // Finance's ideas (2026-11-14): a heads-up at a share of the cap (once a month), and pausing a worker.
  capPct: { words: ["alert", "tell me", "cap", "percent", "share", "heads-up"], label: (pct) => `Tell me at ${pct}% of its cap`, run: (desk, pct) => api("/agents/alerts", { type: "desk_cap_pct", desk, pct }) },
  // Pausing spends nothing. Starting a hub-run worker again lets it spend, so the hub asks for the password then.
  pause: { words: ["pause", "stop", "hold"], label: () => "Pause this worker", ask: "Pause this worker? The hub stops running its jobs until you start it again.", run: (desk) => api("/agents/desk/status", { id: desk, status: "paused" }) },
  resume: { words: ["start", "resume", "unpause", "again"], needsPassword: true, label: () => "Start this worker again", run: (desk) => api("/agents/desk/status", { id: desk, status: "active" }, { password: true, why: "Starting a hub-run worker again lets it spend real money, so it needs your dashboard password." }) },
  // Only the cap (POST /agents/desk/cap). Raising or removing it lets the worker spend more, so the hub asks for the
  // dashboard password then (deskChangeSpends); lowering it doesn't.
  // needsPassword: it may ask (only when raising or removing the cap; the hub decides).
  setCap: { words: ["cap", "limit", "monthly", "budget", "set", "change"], needsPassword: true, label: () => "Change its monthly cap…", run: (desk, cap) => api("/agents/desk/cap", { id: desk, capUsdMonth: cap }, { password: true, why: "A higher cap lets this worker spend more real money, so it needs your dashboard password." }) },
};

// (was a <style> in ai.html; scoped to the block so it never touches the campus around it)
export const html = `<style>[data-block="ai"] pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 260px; overflow: auto; background: var(--surface-3); border-radius: 6px; padding: 8px; font-size: 11px; }</style>
<section class="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
  <h2 class="font-semibold">AI credit left</h2>
  <p class="text-sm text-slate-500">The accounts don't let the app read your balance, so type in what your console shows (Anthropic: Settings, Billing; Google AI Studio: Billing) and the app takes off what each AI call costs from then on. It's an estimate, and your phone gets one alert when it drops below the warning level.</p>
  <div id="credits" class="grid md:grid-cols-2 gap-3"></div>
  <div class="flex gap-2 items-center flex-wrap text-sm"><label>Warn me below $<input id="creditWarn" type="number" min="0" step="0.5" class="w-20 rounded border border-slate-300 px-2 py-1" /></label><button id="creditWarnSave" class="px-3 py-1.5 rounded-lg border border-slate-300">Save</button><span id="creditMsg" class="text-slate-600"></span></div>
</section>

<section class="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
  <div class="flex items-center gap-2 flex-wrap">
    <h2 class="font-semibold flex-1">AI spend</h2>
    
  </div>
  <p class="text-sm text-slate-500">What the AI calls cost, worked out from each call's tokens and the price list (Anthropic and Google, Oct 18 2026). It counts from when logging started, so earlier calls aren't in it. Your real bill is on the Anthropic and Google consoles.</p>
  <div id="spendTiles" class="grid grid-cols-2 md:grid-cols-4 gap-3"></div>
  <div id="spendDays"></div>
  <div id="spendSteps" class="overflow-x-auto"></div>
  <div id="spendVideos" class="overflow-x-auto"></div>
</section>

<section class="bg-white rounded-xl border border-slate-200 p-4 space-y-3" id="alertsBox">
  <h2 class="font-semibold">Alerts and forecast</h2>
  <p class="text-sm text-slate-500">Where this month's spending is heading, and rules that text your phone when something looks wrong. Only real API money counts toward caps; plan use is shown separately as what it would have cost.</p>
  <div id="fcHead" class="text-sm"></div>
  <div id="fcTable" class="overflow-x-auto"></div>
  <p class="text-xs text-slate-500">"Projected" is spent so far divided by days gone, times the days in the month. "Trend" uses only the last 7 days' pace for the rest of the month. The word in the last column uses the higher of the two: over (past the cap), near (80% of it or more), ok.</p>
  <h3 class="font-medium pt-2">Your alert rules</h3>
  <div id="ruleList" class="space-y-2"></div>
  <div class="rounded-lg border border-slate-200 p-3 space-y-2">
    <div class="text-sm font-medium">Add a rule</div>
    <label class="block text-sm">Tell me when<select id="ruleType" class="block w-full rounded border border-slate-300 px-2 py-2 mt-1 text-base"></select></label>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <label id="fDesk" class="block text-sm">Worker <span class="text-slate-500" id="fDeskHint"></span><select id="ruleDesk" class="block w-full rounded border border-slate-300 px-2 py-2 mt-1 text-base"></select></label>
      <label id="fUsd" class="block text-sm"><span id="fUsdLabel">Dollars</span><input id="ruleUsd" type="number" min="0.01" step="0.01" inputmode="decimal" class="block w-full rounded border border-slate-300 px-2 py-2 mt-1 text-base" /></label>
      <label id="fPct" class="block text-sm">Percent of its monthly cap<select id="rulePct" class="block w-full rounded border border-slate-300 px-2 py-2 mt-1 text-base"><option>25</option><option selected>50</option><option>75</option><option>90</option></select></label>
      <label id="fHours" class="block text-sm">Hours with no steps<input id="ruleHours" type="number" min="0.5" step="0.5" inputmode="decimal" class="block w-full rounded border border-slate-300 px-2 py-2 mt-1 text-base" /></label>
      <label id="fCool" class="block text-sm">Don't repeat for (hours)<input id="ruleCool" type="number" min="0.1" step="0.5" value="6" inputmode="decimal" class="block w-full rounded border border-slate-300 px-2 py-2 mt-1 text-base" /></label>
    </div>
    <label id="fSub" class="flex items-center gap-2 text-sm"><input id="ruleSub" type="checkbox" /> Count plan (subscription) use too</label>
    <div class="flex gap-2 items-center flex-wrap"><button id="ruleSave" class="px-4 py-2 rounded-lg border border-slate-300 text-base">Save rule</button><span id="ruleMsg" class="text-sm text-slate-600"></span></div>
  </div>
  <details id="firedBox"><summary class="cursor-pointer text-sm font-medium">Recent alerts that went out</summary><div id="fired" class="mt-2 space-y-2 text-sm"></div></details>
</section>

<section class="card space-y-2">
  <div class="font-semibold">Side-by-side test</div>
  <p class="text-sm text-slate-500">After each real answer, the same question goes to the cheaper candidates and their answers are saved here. The pipeline only ever uses the real answer. "Matches" is the share of the answer's details that came out the same.</p>
  <div id="testState" class="text-sm"></div>
  <label class="flex items-center gap-2 text-sm"><input id="shadowOn" type="checkbox" /> Run the test</label>
</section>

<section class="card space-y-2">
  <div class="font-semibold">Half-price batch mode</div>
  <p class="text-sm text-slate-500">When a live channel is covered (a video posted in the last 24 hours and another ready to follow it, from the pipeline's jobs or the morning health check), new videos' AI steps go through the batch mode at half price. They take longer, usually minutes and at most a day, and the job card says when it's waiting. Test runs and test-mode channels always run at normal speed. Side-by-side test answers always use it.</p>
  <label class="flex items-center gap-2 text-sm"><input id="batchOn" type="checkbox" /> Use batch mode when the channel is covered</label>
</section>

<div id="err" class="hidden bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-sm"></div>
<section id="steps" class="space-y-3"></section>

<details class="card" id="aiLogBox">
  <summary class="font-semibold cursor-pointer">AI call log</summary>
  <p class="mt-2 text-sm text-slate-500">Every AI call: step, model, tokens in and out, and time.</p>
  <div id="aiLog" class="mt-2"></div>
</details>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "ai";
  const $ = scope(root), life = lifecycle();
  const showErr = (msg) => { const el = $("err"); el.textContent = msg; el.classList.toggle("hidden", !msg); };
  await needScripts(["/timing.js", "/runlog.js"]);
  const STEP = {
    card_lookup_read: ["Cards", "Read a card from a phone photo"],
    card_photo_multi: ["Cards", "Read many cards from one photo (trades)"],
    insights: ["Stats", "Ask Claude suggestions"],
    rules_review: ["Stats", "Rules review"],
  };
  const LABEL = { "": "Today's default", haiku: "Claude Haiku", sonnet: "Claude Sonnet", opus: "Claude Opus", "gemini-flash": "Gemini Flash", "gemini-pro": "Gemini Pro" };
  // "gemini-flash@low" = the same model told to think less (cheaper, faster).
  const lab = (c) => { const [n, e] = String(c).split("@"); return (LABEL[n] || n) + (e ? ` (${e} effort)` : ""); };
  const WRITING = new Set(["fp_package", "cz_package", "insights", "rules_review"]);
  const pct = (x) => (x == null ? "" : `${Math.round(x * 100)}%`);
  const tok = (n) => (n == null ? "" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  let data;

  function render() {
    const s = data.settings.shadow;
    $("shadowOn").checked = s.on;
    $("batchOn").checked = data.settings.batch?.on !== false;
    const left = s.startedAt ? s.days - (Date.now() - Date.parse(s.startedAt)) / 864e5 : null;
    $("testState").innerHTML = !s.on ? "Off." : !s.startedAt ? `On. It starts with the next video or card photo and runs for ${s.days} days.` : left > 0 ? `On since ${esc(new Date(s.startedAt).toLocaleDateString())}, ${Math.ceil(left)} day${Math.ceil(left) === 1 ? "" : "s"} left.` : `Finished: the ${s.days} days are up. Tick the box again to run another round.`;
    if (!data.gemini) $("testState").innerHTML += ' <span class="text-amber-700">No Gemini key found, so only the Claude candidates are tested.</span>';
    const keys = [...new Set([...Object.keys(STEP), ...Object.keys(data.results)])];
    $("steps").innerHTML = keys.map((k) => {
      const r = data.results[k];
      const cur = data.settings.steps[k]?.model || "";
      const cands = s.steps[k] || [];
      // Short choices on the phone (the owner 2026-10-21): just the model's name; the exact version goes on the line below.
      const opts = data.models.map((m) => `<option value="${m}" ${m === cur ? "selected" : ""}>${esc(LABEL[m] || m)}${m && /^unavailable/.test(data.resolved[m] || "") ? " (unavailable)" : ""}</option>`).join("");
      const exact = cur ? (data.resolved[cur] && !/^unavailable/.test(data.resolved[cur]) ? data.resolved[cur] : "") : data.defaultModel;
      const rows = (r?.candidates || []).map((c) => `<tr class="border-t border-slate-100">
          <td class="py-1 pr-2">${esc(lab(c.model))}</td>
          <td class="py-1 pr-2 text-right">${c.runs}${c.failed ? ` <span class="text-red-600">(${c.failed} failed)</span>` : ""}</td>
          <td class="py-1 pr-2 text-right">${pct(c.agreement)}</td>
          <td class="py-1 pr-2 text-right">${c.fullMatch}</td>
          <td class="py-1 pr-2 text-right">${esc(timing.dur(c.ms))}</td>
          <td class="py-1 text-right">${tok(c.inTok)} / ${tok(c.outTok)}</td></tr>`).join("");
      const latest = (r?.latest || [])[0];
      return `<div class="card">
        <div class="flex items-start gap-3 flex-wrap">
          <div class="flex-1 min-w-0"><div class="font-medium">${esc(STEP[k]?.[1] || k)}</div><div class="text-xs text-slate-500">${esc(STEP[k]?.[0] || "")}${cands.length ? ` · tested against ${cands.length} other${cands.length === 1 ? "" : "s"}` : " · not tested"}</div></div>
          <label class="text-sm w-full sm:w-auto"><span class="text-slate-500">Uses</span> <select data-step="${k}" class="rounded border px-2 py-1 text-sm max-w-[60%] sm:max-w-none">${opts}</select>${exact ? `<span class="block text-xs text-slate-500 mt-0.5">${esc(exact)}</span>` : ""}</label>
        </div>
        ${r ? `<div class="overflow-x-auto mt-2"><table class="w-full text-sm whitespace-nowrap" style="font-variant-numeric:tabular-nums"><thead class="text-left text-slate-500"><tr><th class="py-1 pr-2 font-medium">Model</th><th class="py-1 font-medium text-right">Runs</th><th class="py-1 font-medium text-right">Matches</th><th class="py-1 font-medium text-right">Exact</th><th class="py-1 font-medium text-right">Time</th><th class="py-1 font-medium text-right">Tokens in/out</th></tr></thead>
          <tbody><tr><td class="py-1 pr-2 text-slate-500">${esc(r.main.model || "")} (used)</td><td class="py-1 pr-2 text-right">${r.runs}</td><td></td><td></td><td class="py-1 pr-2 text-right">${esc(timing.dur(r.main.ms))}</td><td class="py-1 text-right">${tok(r.main.inTok)} / ${tok(r.main.outTok)}</td></tr>${rows}</tbody></table></div>${WRITING.has(k) ? '<p class="text-xs text-slate-500 mt-1">This step writes text, so a low match is normal. Read the answers side by side instead.</p>' : ""}
          ${latest ? `<details class="mt-2 text-sm"><summary class="cursor-pointer text-slate-500">Latest answers side by side (${esc(new Date(latest.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))})</summary>
            <div class="grid md:grid-cols-${1 + latest.shadow.length} gap-2 mt-2">
              <div><div class="text-xs text-slate-500 mb-1">${esc(latest.main.model)} (used)</div><pre>${esc(JSON.stringify(latest.main.answer, null, 1))}</pre></div>
              ${latest.shadow.map((c) => `<div><div class="text-xs text-slate-500 mb-1">${esc(lab(String(c.name || "").includes("@") && !c.error ? `${c.model}@${c.name.split("@")[1]}` : c.model))}${c.agreement != null ? ` · ${pct(c.agreement)} match` : ""}</div><pre>${esc(c.error || JSON.stringify(c.answer, null, 1))}</pre></div>`).join("")}
            </div></details>` : ""}`
          : '<p class="text-sm text-slate-500 mt-2">No test answers yet.</p>'}
      </div>`;
    }).join("");
    $.all("[data-step]").forEach((sel) => (sel.onchange = async () => {
      await api("/ai/settings", { step: sel.dataset.step, model: sel.value }, { password: true, why: "Changing a step's AI model can raise what it costs, so it needs your dashboard password." });
      load();
    }));
  }

  async function load() {
    try {
      data = await api("/ai");
      $("err").classList.add("hidden");
      render();
    } catch (err) {
      showErr("Couldn't load: " + err.message);
    }
  }
  $("batchOn").onchange = async () => {
    await api("/ai/settings", { batchOn: $("batchOn").checked }, { password: true, why: "Turning batch off can raise what AI calls cost, so it needs your dashboard password." });
    load();
  };
  $("shadowOn").onchange = async () => {
    await api("/ai/settings", { shadowOn: $("shadowOn").checked, restart: true }, { password: true, why: "Shadow mode sends the same question to more models, which costs more, so it needs your dashboard password." });
    load();
  };
  let log = null;
  $("aiLogBox").addEventListener("toggle", () => $("aiLogBox").open && (log ? log.reload() : (log = runLog.mount($("aiLog"), { kinds: ["ai call"], limit: 300 }))));
  load();

  // The AI-cost format (4 decimals under a cent).
  const usd = (n) => (n == null ? "" : n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
  const tileH = (label, value, sub = "") => `<div class="bg-white rounded-xl border border-slate-200 p-3"><div class="text-xs text-slate-500">${esc(label)}</div><div class="text-xl font-semibold mt-0.5">${value}</div>${sub ? `<div class="text-xs text-slate-500 mt-0.5">${sub}</div>` : ""}</div>`;
  const STEP_NAMES = {
    card_photo_multi: "Cards: many cards in one photo", card_lookup_read: "Cards: read a photo", insights: "Stats: Ask Claude", rules_review: "Stats: rules review", script_pack: "Script tool: video pack",
  };
  async function loadSpend() {
    const d = await api("/ai").catch(() => null);
    if (!d?.spend) return ($("spendTiles").innerHTML = '<p class="text-sm text-slate-500">Restart the app to start tracking AI spend.</p>');
    const s = d.spend;
    $("spendTiles").innerHTML = [tileH("Today", usd(s.today.usd), `${s.today.calls} calls`), tileH("Last 7 days", usd(s.week.usd), `${s.week.calls} calls`), tileH("This month", usd(s.month.usd), `${s.month.calls} calls`), tileH("Model test", usd(s.test.usd), `${s.test.calls} test calls, included above`)].join("");
    const days = Object.entries(s.byDay).sort().slice(-14);
    const max = Math.max(0.0001, ...days.map(([, v]) => v.usd));
    $("spendDays").innerHTML = days.length ? `<div class="text-xs text-slate-500 mb-1">Per day, last 14 days</div><div class="flex items-end gap-1 h-24">${days.map(([k, v]) => `<div class="flex-1 min-w-0 flex flex-col items-center justify-end h-full" style="max-width:40px" title="${esc(k)}: ${usd(v.usd)}, ${v.calls} calls"><div style="height:${Math.max(2, (v.usd / max) * 80)}px;background:var(--series-1);border-radius:4px 4px 0 0;width:100%"></div><div class="text-[10px] text-slate-500 mt-0.5">${esc(k.slice(8))}</div></div>`).join("")}</div>` : "";
    const steps = Object.entries(s.byStep).sort((a, b) => b[1].usd - a[1].usd);
    const vids = Object.values(s.byVideo || {}).sort((a, b) => b.usd - a.usd).slice(0, 15);
    $("spendVideos").innerHTML = vids.length ? `<div class="text-xs text-slate-500 mb-1 mt-2">By video (all steps for one video, edits and checks included)</div><table class="w-full text-sm whitespace-nowrap" style="font-variant-numeric:tabular-nums"><thead class="text-left text-slate-500"><tr><th class="py-1 font-medium">Video</th><th class="py-1 font-medium text-right">Calls</th><th class="py-1 font-medium text-right">Total</th></tr></thead><tbody>${vids.map((v) => `<tr class="border-t border-slate-100"><td class="py-1 pr-2">${esc(v.label)}</td><td class="py-1 pr-2 text-right">${v.calls}</td><td class="py-1 text-right">${usd(v.usd)}</td></tr>`).join("")}</tbody></table>` : "";
    $("spendSteps").innerHTML = steps.length ? `<table class="w-full text-sm whitespace-nowrap" style="font-variant-numeric:tabular-nums"><thead class="text-left text-slate-500"><tr><th class="py-1 font-medium">Step</th><th class="py-1 font-medium text-right">Calls</th><th class="py-1 font-medium text-right">Total</th><th class="py-1 font-medium text-right">Per call</th></tr></thead><tbody>${steps.map(([k, v]) => `<tr class="border-t border-slate-100"><td class="py-1 pr-2">${esc(STEP_NAMES[k] || k)}</td><td class="py-1 pr-2 text-right">${v.calls}</td><td class="py-1 pr-2 text-right">${usd(v.usd)}</td><td class="py-1 text-right">${usd(v.usd / v.calls)}</td></tr>`).join("")}</tbody></table>${s.unpriced ? `<p class="text-xs text-amber-700 mt-1">${s.unpriced} calls used a model with no price on file.</p>` : ""}` : '<p class="text-sm text-slate-500">No AI calls logged yet.</p>';
  }

  loadSpend();

  // AI credit left.
  async function loadCredits(st) {
    st = st || (await api("/admin/credits").catch(() => null));
    if (!st) return;
    $("creditWarn").value = st.warnBelow;
    $("credits").innerHTML = Object.entries(st.providers).map(([id, p]) => `<div class="rounded-xl border border-slate-200 p-3">
      <div class="flex items-baseline gap-2"><div class="font-medium flex-1">${esc(p.label)}</div>${p.low ? '<span class="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">⚠ low</span>' : ""}</div>
      <div class="text-2xl font-semibold mt-1">${p.left == null ? '<span class="text-base text-slate-500 font-normal">Not set yet</span>' : `$${p.left.toFixed(2)}`}</div>
      <div class="text-xs text-slate-500">${p.set ? `Set to $${p.set.balance.toFixed(2)} on ${new Date(p.set.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}, $${p.spent.toFixed(2)} used since` : "Type your balance below to start"}${p.perDay ? ` · about $${p.perDay.toFixed(2)} a day${p.daysLeft != null ? `, ~${p.daysLeft} days left` : ""}` : ""}</div>
      ${p.models.length ? `<table class="w-full text-xs mt-2"><tbody>${p.models.map((m) => `<tr class="border-t border-slate-100"><td class="py-0.5 pr-2">${esc(m.model)}</td><td class="py-0.5 pr-2 text-right text-slate-500">${m.calls} calls</td><td class="py-0.5 text-right">${usd(m.usd)}</td></tr>`).join("")}</tbody></table>` : ""}
      <div class="mt-2 flex gap-2 items-center text-sm"><span>$</span><input data-credit="${id}" type="number" min="0" step="0.01" placeholder="balance now" class="w-28 rounded border border-slate-300 px-2 py-1" /><button data-credit-save="${id}" class="px-3 py-1 rounded-lg border border-slate-300">Set</button></div>
    </div>`).join("");
    $.all("[data-credit-save]").forEach((b) => (b.onclick = async () => {
      const v = $.one(`[data-credit="${b.dataset.creditSave}"]`).value;
      try { await loadCredits(await api("/admin/credits", { provider: b.dataset.creditSave, balance: v })); $("creditMsg").textContent = "Saved."; } catch (err) { $("creditMsg").textContent = err.message; }
    }));
  }
  $("creditWarnSave").onclick = async () => {
    try { await loadCredits(await api("/admin/credits", { warnBelow: $("creditWarn").value })); $("creditMsg").textContent = "Saved."; } catch (err) { $("creditMsg").textContent = err.message; }
  };
  loadCredits();

  // Alerts and forecast (src/pipeline/alerts.js, forecast.js). Words as well as symbols, never colour alone.
  const LBL = { over: "▲ over", near: "● near", ok: "✓ ok", "no cap": "– no cap" };
  const m2 = (n) => `$${(n || 0).toFixed(2)}`;
  const when = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  async function loadForecast() {
    try {
      const f = await api("/agents/forecast");
      const row = (d, bold) => `<tr class="border-t border-slate-100${bold ? " font-semibold" : ""}"><td class="py-1 pr-3">${esc(d.id === "hub" ? "Whole hub" : d.id)}</td><td class="py-1 pr-3 text-right">${m2(d.spent)}</td><td class="py-1 pr-3 text-right">${m2(d.projected)}</td><td class="py-1 pr-3 text-right">${m2(d.projectedTrend)}</td><td class="py-1 pr-3 text-right">${d.cap == null ? "none" : m2(d.cap)}</td><td class="py-1 pr-3 text-right text-slate-500">${m2(d.subProjected)}</td><td class="py-1 font-medium">${esc(LBL[d.label] || d.label)}</td></tr>`;
      $("fcHead").textContent = `Day ${f.day} of ${f.days}. ${f.budget == null ? "No hub budget set (no caps on any desk)." : `The hub's budget is ${m2(f.budget)}, the total of the desks' monthly caps.`}`;
      // the hub, then the desks with something to show (spend, plan use, or near/over a cap), busiest first; the quiet
      // ones (nothing spent, no plan use, ok) behind a link, so the rules below aren't a long scroll away on a phone
      const busy = f.desks.filter((d) => d.spent > 0 || d.subProjected > 0 || ["over", "near"].includes(d.label)).sort((a, b) => (b.projected + b.subProjected) - (a.projected + a.subProjected));
      const quiet = f.desks.filter((d) => !busy.includes(d)), showAll = $("fcTable").dataset.all === "1";
      $("fcTable").innerHTML = `<table class="w-full text-sm whitespace-nowrap" style="font-variant-numeric:tabular-nums"><thead class="text-left text-slate-500"><tr><th class="py-1 pr-3 font-medium">Worker</th><th class="py-1 pr-3 font-medium text-right">Spent</th><th class="py-1 pr-3 font-medium text-right">Projected</th><th class="py-1 pr-3 font-medium text-right">Trend</th><th class="py-1 pr-3 font-medium text-right">Cap</th><th class="py-1 pr-3 font-medium text-right">Plan use, projected</th><th class="py-1 font-medium">Status</th></tr></thead><tbody>${row(f.hub, true)}${busy.map((d) => row(d)).join("")}${showAll ? quiet.map((d) => row(d)).join("") : ""}</tbody></table>${quiet.length ? `<button class="text-sm underline text-slate-500 mt-2" data-fc-all>${showAll ? "Hide the quiet ones" : `${quiet.length} more with nothing spent this month: show them`}</button>` : ""}`;
      const all = $("fcTable").querySelector("[data-fc-all]");
      if (all) all.onclick = () => { $("fcTable").dataset.all = showAll ? "" : "1"; loadForecast(); };
    } catch (err) {
      $("fcHead").textContent = "Couldn't load the forecast: " + err.message;
    }
  }
  let alertData = null;
  function ruleForm() {
    const t = $("ruleType").value, spec = (alertData?.types || {})[t] || { need: [], may: [] }, has = (k) => spec.need.includes(k) || spec.may.includes(k);
    $("fDesk").classList.toggle("hidden", !has("desk"));
    $("fDeskHint").textContent = spec.need.includes("desk") ? "" : "(optional: leave on any)";
    $("fUsd").classList.toggle("hidden", !has("usd"));
    $("fUsdLabel").textContent = t === "month_projected" ? "Month total in dollars (empty = the hub's budget)" : "Dollars";
    $("fHours").classList.toggle("hidden", !has("hours"));
    $("fPct").classList.toggle("hidden", !has("pct"));
    $("fSub").classList.toggle("hidden", !has("includeSubscription"));
  }
  async function loadAlerts() {
    try {
      const a = await api("/agents/alerts");
      alertData = a;
      if (!$("ruleType").options.length) $("ruleType").innerHTML = Object.entries(a.types).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("");
      const keep = $("ruleDesk").value;
      $("ruleDesk").innerHTML = '<option value="">Any worker</option>' + a.desks.map((d) => `<option>${esc(d)}</option>`).join("");
      $("ruleDesk").value = keep;
      $("ruleList").innerHTML = a.rules.length ? a.rules.map((r) => `<div class="rounded-lg border border-slate-200 p-2 flex items-start gap-2"><div class="flex-1 min-w-0 text-sm"><div>${esc(r.name || r.text)}${r.enabled === false ? " (paused)" : ""}</div><div class="text-xs text-slate-500">${r.name ? esc(r.text) + " · " : ""}at most once every ${r.cooldownHours} h · ${r.lastFiredAt ? "last sent " + esc(when(r.lastFiredAt)) : "never sent"}</div></div><button data-rule-del="${esc(r.id)}" class="px-3 py-2 rounded-lg border border-slate-300 text-sm">Remove</button></div>`).join("") : '<p class="text-sm text-slate-500">No rules yet. Add one below.</p>';
      $.all("[data-rule-del]").forEach((b) => (b.onclick = async () => {
        try { await api(`/agents/alerts/${b.dataset.ruleDel}/remove`, {}); } catch (err) { $("ruleMsg").textContent = err.message; }
        loadAlerts();
      }));
      $("fired").innerHTML = a.firings.length ? a.firings.slice(0, 20).map((f) => `<div class="rounded border border-slate-200 p-2"><div class="text-xs text-slate-500">${esc(when(f.at))}</div><div class="font-medium">${esc(f.title)}</div><div class="whitespace-pre-line">${esc(f.text)}</div></div>`).join("") : '<p class="text-slate-500">None yet.</p>';
      ruleForm();
    } catch (err) {
      $("ruleList").innerHTML = `<p class="text-sm text-slate-500">Couldn't load the rules: ${esc(err.message)}</p>`;
    }
  }
  $("ruleType").onchange = ruleForm;
  $("ruleSave").onclick = async () => {
    if (!alertData) return;
    const t = $("ruleType").value, spec = alertData.types[t], has = (k) => spec.need.includes(k) || spec.may.includes(k), body = { type: t, cooldownHours: $("ruleCool").value };
    if (has("desk") && $("ruleDesk").value) body.desk = $("ruleDesk").value;
    if (has("usd") && $("ruleUsd").value !== "") body.usd = $("ruleUsd").value;
    if (has("hours")) body.hours = $("ruleHours").value;
    if (has("pct")) body.pct = $("rulePct").value;
    if (has("includeSubscription") && $("ruleSub").checked) body.includeSubscription = true;
    try { await api("/agents/alerts", body); $("ruleMsg").textContent = "Saved."; loadAlerts(); } catch (err) { $("ruleMsg").textContent = err.message; }
  };
  loadForecast();
  loadAlerts();
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
