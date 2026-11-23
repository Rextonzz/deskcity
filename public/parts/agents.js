// Agents: the page's working part as a block (see public/parts/kit.js). Mounted by public/agents.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, api, bindRoot } from "/stats-lib.js";
import { safeUrl } from "/lib.js";
import { ago, spend, confirmBox, approvalNote } from "/lib.js";
import { scope, lifecycle } from "/parts/kit.js";

export const html = `<style>
[data-block="agents"] .chip { font-size: 12px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line-strong); color: var(--text-secondary); white-space: nowrap; }
  [data-block="agents"] input,
  [data-block="agents"] select,
  [data-block="agents"] textarea { background: var(--surface-1); border: 1px solid var(--line-strong); border-radius: 8px; padding: 6px 10px; color: var(--text-primary); min-width: 0; }
  [data-block="agents"] .rooms { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  [data-block="agents"] .stat { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
  [data-block="agents"] .num { font-variant-numeric: tabular-nums; }
  [data-block="agents"] label.f { display: flex; flex-direction: column; gap: 2px; font-size: 13px; color: var(--text-secondary); }
</style>
<div class="flex items-center gap-2 flex-wrap" data-head>
  <button id="reload" class="px-3 py-1.5 rounded-lg border border-slate-300 text-sm">↻ Refresh</button>
</div>
<div id="err" class="text-sm"></div>

<section class="card grid grid-cols-2 sm:grid-cols-4 gap-4">
  <div><div class="sub">API spend this month</div><div class="stat" id="sApi">–</div><div class="sub" id="sCredit">real money, counts toward caps</div></div>
  <div><div class="sub">Subscription use</div><div class="stat" id="sSub">–</div><div class="sub">priced as if on the API</div></div>
  <div><div class="sub">Requests waiting</div><div class="stat" id="sReq">–</div><div class="sub" id="sReqSub"></div></div>
  <div><div class="sub">Claude Code hook</div><div class="stat" id="sHook">–</div><div class="sub" id="sHookSub"></div></div>
</section>

<section class="space-y-2">
  <h2 class="font-semibold">Rooms</h2>
  <div id="rooms" class="rooms"><p class="text-sm text-slate-500">Loading…</p></div>
  <div id="strays"></div>
  <div id="unmapped"></div>
</section>

<section class="card space-y-3">
  <h2 class="font-semibold">Blocker watches</h2>
  <p class="text-sm text-slate-500">What's blocking a project and what would clear it. The hub checks each one on its schedule (once a day unless set otherwise), alerts you and tells the lead when it clears, then closes it. Leads add them with <code>agent-log.mjs watch</code>.</p>
  <div id="blockers" class="divide-y divide-slate-100"></div>
</section>

<section class="card space-y-3">
  <h2 class="font-semibold">Requests and asks</h2>
  <div class="flex gap-2 items-start"><p class="text-sm text-slate-500 flex-1">Leads file these. HR checks each one against the room's work, the roster and the budget, and picks the model and effort (every 3 hours, or now). Approving a staff request adds the desk to the roster; use edit on its desk card to change it afterwards.</p><button id="hrRun" class="text-xs px-2.5 py-1 rounded-lg border border-slate-300 shrink-0">Run HR now</button></div>
  <div id="requests" class="divide-y divide-slate-100"></div>
  <details id="prReviewsBox" style="display:none">
    <summary class="text-sm cursor-pointer text-slate-500">PR reviews <span id="prReviewsCount"></span></summary>
    <p class="text-sm text-slate-500">Every open pull request in a watched repo is read twice once it stops changing: a code review and a security review. Advice only; merging stays with you.</p>
    <div id="prReviews" class="divide-y divide-slate-100"></div>
  </details>
  <details>
    <summary class="text-sm cursor-pointer text-slate-500">File a request yourself</summary>
    <div class="grid sm:grid-cols-2 gap-2 mt-2">
      <label class="f">Room<select id="rqRoom"></select></label>
      <label class="f">Role needed<input id="rqRole" maxlength="200" placeholder="e.g. PR reviewer" /></label>
      <label class="f sm:col-span-2">Why<input id="rqWhy" maxlength="1000" /></label>
      <label class="f">Urgency<select id="rqUrg"><option>normal</option><option>low</option><option>high</option></select></label>
      <label class="f">Budget ask (USD / month)<input id="rqBudget" type="number" min="0" step="0.5" /></label>
    </div>
    <button id="rqAdd" class="mt-2 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm">File request</button>
  </details>
</section>

<section class="card space-y-2">
  <h2 class="font-semibold">Live feed</h2>
  <div id="feed" class="divide-y divide-slate-100 text-sm"></div>
</section>

<section class="card space-y-2">
  <h2 class="font-semibold">Log something by hand</h2>
  <p class="text-sm text-slate-500">For Grok, phone chats and claude.ai sessions, which can't report by themselves.</p>
  <div class="grid sm:grid-cols-3 gap-2">
    <label class="f">Desk<input id="lgDesk" list="deskList" placeholder="e.g. grok-scout" /></label>
    <label class="f">Room<select id="lgRoom"></select></label>
    <label class="f">Provider<select id="lgProv"><option>claude</option><option>gemini</option><option>openai</option><option>grok</option><option>deepseek</option><option>muse</option><option>local</option><option>other</option></select></label>
    <label class="f sm:col-span-2">What happened<input id="lgSum" maxlength="200" placeholder="e.g. found 3 trending stream moments" /></label>
    <label class="f">Billing<select id="lgBill"><option value="subscription">subscription</option><option value="api">API (real money)</option></select></label>
  </div>
  <datalist id="deskList"></datalist>
  <button id="lgAdd" class="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm">Log it</button>
  <details class="mt-3">
    <summary class="text-sm cursor-pointer text-slate-500">Paste "Hub log:" lines from chats</summary>
    <p class="text-sm text-slate-500 mt-1">Paste a whole reply or several; only lines starting "Hub log:" are used, like <code>Hub log: hub-builder (Opus 5.5) built the campus</code>. Desks on the roster go to their own room; others go to the room picked above.</p>
    <textarea id="hlText" rows="4" class="w-full mt-2 text-sm" placeholder="Hub log: desk (model) what happened"></textarea>
    <button id="hlAdd" class="mt-2 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm">Log these</button>
  </details>
</section>

<section class="card space-y-2" id="refusalBox" style="display:none">
  <h2 class="font-semibold">Provider refusals (30 days)</h2>
  <div id="refusalList" class="text-sm"></div>
</section>

<section class="card space-y-2" id="qualityBox" style="display:none">
  <h2 class="font-semibold">Quality checks</h2>
  <p class="text-sm text-slate-500">HR scores every finished job with a saved result from 0 to 100, and that score sets the worker's pay: <b id="qScale">4 to 16 credits a job</b> (10 until it's scored). Your 👍 on the campus makes a job at least 80, 👎 at most 20. Each desk's best jobs (60 and up) are its taste test: re-run them on another model or a new brief and HR compares old and new. Tap a desk.</p>
  <div id="qRunning" class="text-sm"></div>
  <div id="qList" class="space-y-1"></div>
  <details id="qMoreBox"><summary class="cursor-pointer text-sm text-slate-500" id="qMoreSum"></summary><div id="qMore" class="space-y-1 mt-1"></div></details>
</section>

<section class="card space-y-2" id="deskForm">
  <h2 class="font-semibold">Add or change a desk</h2>
  <p class="text-sm text-slate-500">Only you change the roster. Same name = edit that desk.</p>
  <div class="grid sm:grid-cols-3 gap-2">
    <label class="f">Desk name<input id="dkId" maxlength="40" /></label>
    <label class="f">Room<select id="dkRoom"></select></label>
    <label class="f">Role<input id="dkRole" maxlength="200" /></label>
    <label class="f">Floor (work stream)<input id="dkFloor" maxlength="40" list="floorList" placeholder="blank = main floor" /></label><datalist id="floorList"></datalist>
    <label class="f">Side (e.g. channel)<input id="dkSide" maxlength="40" list="sideList" placeholder="blank = shared middle" /></label><datalist id="sideList"></datalist>
    <label class="f" style="grid-column: 1 / -1; flex-direction: row; align-items: center; gap: 8px"><input id="dkRunner" type="checkbox" /> The hub can run this desk's jobs itself (spends API money on its model, within its cap; a cap is required)</label>
    <label class="f" style="grid-column: 1 / -1; flex-direction: row; align-items: center; gap: 8px"><input id="dkPassOff" type="checkbox" checked /> Pass refused jobs to another service</label>
    <label class="f" style="grid-column: 1 / -1; flex-direction: row; align-items: center; gap: 8px"><input id="dkLocal" type="checkbox" /> Runs in an app on this PC and picks up its own jobs and hand-offs <input id="dkApp" placeholder="Antigravity" style="max-width:10rem" /></label>
    <label class="f">Provider<select id="dkProv"><option>claude</option><option>gemini</option><option>openai</option><option>grok</option><option>deepseek</option><option>muse</option><option>local</option><option>mixed</option><option>other</option></select></label>
    <label class="f">Model<input id="dkModel" maxlength="60" placeholder="e.g. claude-haiku-5-5" /></label>
    <p class="sub" style="grid-column: 1 / -1">The hub only runs a model it has a price for: Claude and Gemini are built in; for OpenAI, Grok or DeepSeek add providers.&lt;id&gt;.prices.&lt;model&gt; = { in, out } (US dollars per million tokens) to the hub settings first. Local models are free.</p>
    <label class="f">Effort<select id="dkEffort"><option value="">–</option><option>low</option><option>medium</option><option>high</option></select></label>
    <label class="f">Cap (USD / month, API only)<input id="dkCap" type="number" min="0" step="0.5" /></label>
    <label class="f">Status<select id="dkStatus"><option>active</option><option>planned</option><option>paused</option><option>retired</option></select></label>
    <label class="f flex-row items-center gap-2 mt-5"><input id="dkLead" type="checkbox" /> Project lead</label>
    <label class="f" style="grid-column: 1 / -1">Brief<input id="dkBrief" maxlength="1000" /></label>
  </div>
  <button id="dkSave" class="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm">Save desk</button>
</section>
<datalist id="qModels"><option value="claude-haiku-5-5"></option><option value="claude-sonnet-5-5"></option><option value="claude-opus-5-5"></option><option value="gemini-flash"></option><option value="gemini-pro"></option></datalist>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "agents";
  const $ = scope(root), life = lifecycle();
  bindRoot(root, life);
      // Merge asks, jobs and runs need the dashboard password: the hub says when.
      let MERGE_WHY = "This sends an OK to merge or a hold to GitHub, so it needs your dashboard password.";
let PR_REPO = null; // the repository a queued PR number belongs to ("owner/name"), when the hub has one
const apiPw = (path, body) => api(path, body, { password: true, why: MERGE_WHY });
      let data = null;
      // One reviewer's read of a PR (2026-11-11): the code review or the security review.
      const reviewLine = (ic, nm, v) => `<div class="text-sm mt-1 ${v.verdict === "concerns" ? "text-amber-700" : "text-slate-600"}">${ic} ${nm} by ${esc(v.by)} (${esc(v.model || "")}): <b>${v.verdict === "looks-safe" ? "nothing found that should stop a merge" : v.verdict === "concerns" ? "has concerns" : "can't tell from the diff"}</b>. ${esc(v.summary || "")}${(v.concerns || []).map((c) => `<br>• ${esc(c)}`).join("")}${v.shown < v.files ? `<br><span class="sub">Only ${v.shown} of ${v.files} files fit in the review.</span>` : ""}</div>`;
      const usd = spend;
      const when = (iso) => { const d = new Date(iso); const today = d.toDateString() === new Date().toDateString(); return today ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString(); };
      const say = (html) => ($("err").innerHTML = html);
      const STATUS = { asked: ["?", "Waiting for you"], new: ["○", "Waiting for HR"], recommended: ["◐", "HR has checked it"], approved: ["✓", "Approved"], declined: ["✗", "Declined"] };

      async function load() {
        try { data = await api("/agents"); } catch (err) { say(`<span class="text-red-700">${esc(err.noRoute ? "The app needs a restart to show this page." : err.message)}</span>`); return; }
        say("");
        draw();
      }

      function draw() {
        const { rooms, desks, requests, feed, unassignedMonth } = data;
        const roomName = Object.fromEntries(rooms.map((r) => [r.id, r.name]));
        const strayList = Object.entries(unassignedMonth || {});
        const apiTotal = desks.reduce((a, d) => a + d.monthUsd, 0) + strayList.reduce((a, [, s]) => a + s.usd, 0);
        const subTotal = desks.reduce((a, d) => a + d.monthSubUsd, 0) + strayList.reduce((a, [, s]) => a + (s.subUsd || 0), 0);
        $("sApi").textContent = usd(apiTotal);
        const cr = data.credit?.claude;
        $("sCredit").innerHTML = cr ? `<span class="${cr.left < cr.balance * 0.2 ? "text-red-700" : ""}">${usd(Math.max(0, cr.left))} of ${usd(cr.balance)} Claude credit left${cr.perDay ? ` · ~${usd(cr.perDay)}/day` : ""}</span>` : 'real money · <a href="/ai.html" class="underline">set your credit</a> to track it';
        $("sSub").textContent = usd(subTotal);
        const open = requests.filter((r) => !r.decision && (r.kind !== "borrow" || !r.ownerLead || Date.now() - Date.parse(r.at) > 3 * 3600e3));
        const rf = data.refusals || { total: 0, byProvider: [], byDesk: [] };
        $("refusalBox").style.display = rf.total ? "" : "none";
        $("refusalList").innerHTML = rf.total ? `<table class="w-full"><thead><tr><th class="text-left">Provider</th><th class="text-right">Refusals</th></tr></thead><tbody>${rf.byProvider.map((x) => `<tr><td>${esc(x.provider)}</td><td class="text-right">${x.count}</td></tr>`).join("")}</tbody></table><table class="w-full mt-2"><thead><tr><th class="text-left">Desk</th><th class="text-right">Refusals</th></tr></thead><tbody>${rf.byDesk.map((x) => `<tr><td>${esc(x.desk)}</td><td class="text-right">${x.count}</td></tr>`).join("")}</tbody></table>` : "";
        $("sReq").textContent = open.length;
        $("sReqSub").textContent = open.length ? `${open.filter((r) => r.status === "recommended").length} checked by HR` : "none";
        const h = data.hook || {};
        $("sHook").textContent = h.failing ? "Failing" : h.lastOkAt ? "Working" : "Not seen yet";
        $("sHook").style.color = h.failing ? "#e5534b" : h.lastOkAt ? "" : "#c69026";
        $("sHookSub").textContent = h.failing
          ? `${ago(h.lastErrAt, "days")}: ${h.lastError || "see data/agents/hook-errors.log"}`
          : h.lastOkAt
            ? `last report ${ago(h.lastOkAt, "days")} (${h.lastOkEvent})${h.errorsToday ? `, ${h.errorsToday} errors today` : ""}`
            : "start a Claude Code session to test it";
        const rl = data.relay;
        if (rl?.lastPullAt) $("sHookSub").textContent += ` · cloud relay: ${rl.error ? `failing (${rl.error})` : `checked ${ago(rl.lastPullAt, "days")}${rl.imported ? `, ${rl.imported} reports in` : rl.fileFound === false ? ", no reports yet" : ""}`}`;

        const opts = rooms.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("");
        for (const id of ["rqRoom", "lgRoom", "dkRoom"]) { const keep = $(id).value; $(id).innerHTML = opts; if (keep) $(id).value = keep; }
        $("deskList").innerHTML = desks.map((d) => `<option value="${esc(d.id)}"></option>`).join("");
        $("floorList").innerHTML = [...new Set(desks.map((d) => d.floor).filter(Boolean))].sort().map((f) => `<option value="${esc(f)}"></option>`).join("");
        $("sideList").innerHTML = [...new Set(desks.map((d) => d.side).filter(Boolean))].sort().map((f) => `<option value="${esc(f)}"></option>`).join("");

        $("rooms").innerHTML = rooms.map((r) => {
          const here = desks.filter((d) => d.room === r.id);
          const busy = feed.some((f) => f.room === r.id && Date.now() - Date.parse(f.startedAt) < 15 * 60000);
          return `<div class="card space-y-2">
            <div class="flex items-center gap-2"><div class="font-semibold flex-1">${esc(r.name)}</div>${busy ? '<span class="chip">● active now</span>' : ""}${r.status === "paused" ? '<span class="chip">paused</span>' : ""}
              ${r.id === "hr" ? "" : `<button class="text-xs px-2.5 py-1 rounded-lg border border-slate-300" data-room="${esc(r.id)}" data-st="${r.status === "paused" ? "active" : "paused"}">${r.status === "paused" ? "▶ Start" : "❚❚ Pause"}</button>`}</div>
            ${r.id === "hr" || !r.link ? "" : `<div class="sub" title="Standing rule: every project links into the hub (a lead desk, and reports in the last 14 days).">${r.link.linked ? "✓ linked to the hub" : "✗ not linked yet"}: ${r.link.lead ? "lead ✓" : "no lead"} · ${r.link.lastReportAt ? `last report ${when(r.link.lastReportAt)}` : "no reports yet"} · ${r.link.folder ? "folder mapped" : "no folder mapped"}</div>`}
            ${here.length ? here.map((d) => `<div class="text-sm border-t border-slate-100 pt-2">
              <div class="flex gap-2 items-start"><div class="flex-1 min-w-0"><span class="font-medium">${esc(d.id)}</span>${d.lead ? ' <span class="chip">lead</span>' : ""} <span class="chip">${esc(d.status)}</span></div>
                <button class="text-xs underline text-slate-500" data-give="${esc(d.id)}">give a job</button> <button class="text-xs underline text-slate-500" data-edit="${esc(d.id)}">edit</button></div>
              ${(data.jobs || []).filter((j) => j.desk === d.id && (j.status === "queued" || j.status === "taken")).map((j) => `<div class="sub">📌 ${esc(j.text)} (${esc(j.status)}) ${d.runner === "hub" && j.status === "queued" ? `<button class="underline" data-run="${j.id}">run now</button>` : ""} <button class="underline" data-cancel="${j.id}">cancel</button></div>`).join("")}
              <div class="sub">${d.floor ? `${esc(d.floor)} floor · ` : ""}${d.side ? `${esc(d.side)} side · ` : ""}${esc(d.role || "")}</div>
              <div class="sub">${esc([d.provider, d.model, d.effort].filter(Boolean).join(" · "))}</div>
              <div class="num">${d.monthEvents} event${d.monthEvents === 1 ? "" : "s"} · ${usd(d.monthUsd)} API${d.monthSubUsd ? ` · ${usd(d.monthSubUsd)} sub` : ""}${d.capUsdMonth != null ? ` · cap ${usd(d.capUsdMonth)}` : ""}${d.overCap ? ' <span class="text-red-700">⚠ over cap</span>' : ""}</div>
            </div>`).join("") : '<div class="sub">No desks yet.</div>'}
          </div>`;
        }).join("");

        // Folders the hook doesn't know yet: pick the project, and future sessions there land in its building.
        const um = data.unmapped || [];
        $("unmapped").innerHTML = um.length ? `<div class="card mt-3 space-y-2"><div class="font-semibold text-sm">New folders: which project is this?</div><div class="sub">Claude Code sessions ran in these folders, which aren't mapped yet, so they landed in "unassigned". Pick the project and future sessions there go to its building.</div>
          ${um.map((f, i) => `<div class="text-sm flex flex-wrap gap-2 items-center"><code class="flex-1 min-w-0" style="word-break:break-all">${esc(f.folder)}</code><span class="sub">${f.sessions} session${f.sessions === 1 ? "" : "s"}</span>
            <select data-um-room="${i}" class="text-sm">${rooms.filter((r) => r.id !== "hr").map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("")}</select>
            <button class="text-xs px-2.5 py-1 rounded-lg border border-slate-300" data-um="${i}">Map it</button></div>`).join("")}</div>` : "";
        $.all("[data-um]").forEach((b) => (b.onclick = async () => {
          const f = um[Number(b.dataset.um)], room = $.one(`[data-um-room="${b.dataset.um}"]`).value;
          const lead = desks.find((d) => d.room === room && d.lead);
          try { await api("/agents/hookmap", { folder: f.folder, room, desk: lead?.id || "" }, { password: true, why: "Mapping a folder to a project picks where password-gated sessions start, so it needs your dashboard password." }); await load(); say(`<span class="text-emerald-600">${esc(f.folder)} now goes to ${esc(rooms.find((r) => r.id === room)?.name || room)}${lead ? ` (desk ${esc(lead.id)})` : ""}.</span>`); }
          catch (err) { say(`<span class="text-red-700">${esc(err.message)}</span>`); }
        }));
        $("strays").innerHTML = strayList.length ? `<div class="card mt-3 space-y-1"><div class="font-semibold text-sm">Not on the roster yet</div><div class="sub">These posted this month but have no desk. Add one so their room and cap are tracked.</div>
          ${strayList.map(([id, s]) => `<div class="text-sm flex gap-2 items-center"><span class="flex-1">${esc(id)} · ${s.events} event${s.events === 1 ? "" : "s"} · ${usd(s.usd)} API${s.subUsd ? ` · ${usd(s.subUsd)} sub` : ""}</span><button class="text-xs px-2.5 py-1 rounded-lg border border-slate-300" data-new="${esc(id)}">Add desk</button></div>`).join("")}</div>` : "";

        const bw = data.blockers || [], checkText = (c) => c.type === "github-release" ? `a ${c.repo} release mentioning "${c.match}"` : c.type === "url-contains" ? `"${c.text}" on ${c.url}` : `the file ${c.path}`;
        $("blockers").innerHTML = bw.length ? bw.map((w) => `<div class="py-2 text-sm${w.status === "open" ? "" : " opacity-60"}"><div class="flex gap-2 items-start"><div class="flex-1 min-w-0"><b>${esc(w.what)}</b> <span class="sub">· ${esc(w.room)} · set by ${esc(w.desk)}</span></div>
          ${w.status === "open" ? `<button class="text-xs px-2.5 py-1 rounded-lg border border-slate-300" data-bcheck="${esc(w.id)}">Check now</button><button class="text-xs px-2.5 py-1 rounded-lg border border-slate-300" data-bclose="${esc(w.id)}">Close</button>` : ""}</div>
          <div class="sub">${w.status === "open" ? `Waiting for ${esc(checkText(w.check))} · every ${w.everyHours} h${w.lastCheck ? ` · last check ${when(w.lastCheck.at)}: ${esc(w.lastCheck.note || "")}` : " · not checked yet"}` : w.status === "cleared" ? `Cleared: ${esc(w.lastCheck?.note || "")}` : "Closed"}</div><div class="sub">When it clears: ${esc(w.alert)}</div></div>`).join("") : '<p class="text-sm text-slate-500 py-2">No watches.</p>';
        $.all("[data-bcheck]").forEach((b) => (b.onclick = async () => { try { const r = await api("/agents/blocker/check", { id: b.dataset.bcheck }); await confirmBox({ title: "", text: r[0] ? (r[0].cleared ? "Cleared! Alert sent." : `Still blocked: ${r[0].note}`) : "Checked", no: null }); load(); } catch (err) { await confirmBox({ title: "", text: err.message, no: null }); } }));
        $.all("[data-bclose]").forEach((b) => (b.onclick = async () => { try { await api("/agents/blocker/close", { id: b.dataset.bclose }); load(); } catch (err) { await confirmBox({ title: "", text: err.message, no: null }); } }));

        { // PR reviews (both reviewers), newest first
          const pr = data.prReviews || [];
          $("prReviewsBox").style.display = pr.length ? "" : "none";
          $("prReviewsCount").textContent = pr.length ? `(${pr.length}${pr.some((x) => [x.code, x.security].some((v) => v?.verdict === "concerns")) ? ", some with concerns" : ""})` : "";
          $("prReviews").innerHTML = pr.map((x) => `<div class="py-2"><a class="font-medium underline" href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener">${esc(x.repo)} #${Number(x.number)}</a> <span class="sub">${esc(x.title || "")} · ${when(x.at)}</span>${x.code ? reviewLine("🔎", "Code review", x.code) : '<div class="sub">🔎 No code review (the assistant is off or at its cap).</div>'}${x.security ? reviewLine("🛡️", "Security review", x.security) : `<div class="sub">🛡️ ${x.docsOnly ? "Docs only: no security review needed." : "No security review yet (no security reviewer on staff, or it's at its cap)."}</div>`}</div>`).join("");
        }
        $("requests").innerHTML = requests.length ? requests.map((q) => {
          const [mark, word] = STATUS[q.status] || ["?", q.status];
          const hr = q.hr ? `<div class="text-sm">HR: <b>${esc(q.hr.verdict)}</b>${q.hr.model ? ` · ${esc([q.hr.provider, q.hr.model, q.hr.effort].filter(Boolean).join(" · "))}` : ""}${q.hr.capUsdMonth != null ? ` · cap ${usd(q.hr.capUsdMonth)}` : ""}${q.hr.note ? ` — ${esc(q.hr.note)}` : ""}</div>` : "";
          return `<div class="py-2.5 space-y-1${q.decision ? " opacity-60" : ""}">
            <div class="flex gap-2 items-start"><div class="flex-1 min-w-0">${q.kind === "ask" ? '<span class="chip">ask</span> ' : ""}${q.pr && PR_REPO ? `<a class="chip underline" href="https://github.com/${PR_REPO}/pull/${Number(q.pr)}" target="_blank" rel="noopener">PR #${Number(q.pr)}</a> ` : ""}<span class="font-medium">${esc(q.role)}</span> <span class="sub">for ${esc(roomName[q.room] || q.room)} · from ${esc(q.from)} · ${esc(q.urgency)} · ${when(q.at)}</span></div>
              ${q.decision ? "" : `<button class="text-xs px-2.5 py-1 rounded-lg border border-slate-300" data-dec="${q.id}" data-v="approved">${q.pr ? "OK to merge" : "Approve"}</button><button class="text-xs px-2.5 py-1 rounded-lg border border-slate-300" data-dec="${q.id}" data-v="declined">${q.pr ? "Hold" : "Decline"}</button>`}</div>
            ${q.why ? `<div class="text-sm text-slate-600">${esc(q.why)}</div>` : ""}
  ${[["🔎", "Code review", q.review], ["🛡️", "Security review", q.securityReview]].filter((x) => x[2]).map(([ic, nm, v]) => reviewLine(ic, nm, v)).join("")}
            ${q.suggested?.model ? `<div class="sub">Lead suggests ${esc([q.suggested.provider, q.suggested.model, q.suggested.effort].filter(Boolean).join(" · "))}${q.budgetAsk != null ? ` · asks ${usd(q.budgetAsk)}/month` : ""}</div>` : ""}
            ${hr}
            <div class="text-sm">${mark} ${word}${q.decision?.note ? `: ${esc(q.decision.note)}` : ""}</div>
          </div>`;
        }).join("") : '<p class="text-sm text-slate-500 py-2">No requests yet.</p>';

        $("feed").innerHTML = feed.length ? feed.map((f) => {
          let text;
          if (f.kind === "agent event") text = `<b>${esc(f.desk)}</b> ${esc(f.action || "")}${f.tool ? ` · ${esc(f.tool)}` : ""}${f.summary ? ` · ${esc(f.summary)}` : ""}${f.costUsd ? ` · ${usd(f.costUsd)}${f.billing === "subscription" ? " sub" : ""}` : ""}`;
          else if (f.kind === "agent request") text = `Request ${esc(f.request)} ${f.decision ? esc(f.decision) : f.verdict ? `HR: ${esc(f.verdict)}` : `filed by ${esc(f.from || "")} (${esc(f.role || "")})`}`;
          else text = `Roster: ${esc(f.desk || f.room || "")} ${esc(f.change || "")}`;
          return `<div class="py-1.5 flex gap-3"><span class="sub w-16 shrink-0 num">${when(f.startedAt)}</span><span class="flex-1 min-w-0">${text}</span></div>`;
        }).join("") : '<p class="text-slate-500 py-2">Nothing yet. Claude Code sessions, Gemini file changes and hand logs show up here.</p>';

        $.all("[data-dec]").forEach((b) => (b.onclick = async () => {
          const pr = data.requests.find((x) => x.id === b.dataset.dec)?.pr;
          const note = await confirmBox({ title: pr ? (b.dataset.v === "approved" ? `OK to merge #${pr}. Any note for the lead? (optional)` : `Hold #${pr}. Why? (optional)`) : b.dataset.v === "approved" ? "Approve. Any note? (optional)" : "Decline. Why? (optional)", input: "", yes: "OK", no: "Cancel" });
          if (note === null) return;
          try {
            const q = data.requests.find((x) => x.id === b.dataset.dec);
            let r;
            try { r = await apiPw(`/agents/request/${b.dataset.dec}/decide`, { decision: b.dataset.v, note }); }
            catch (err) { if (err.cancelled) return say("Cancelled."); throw err; }
            await load();
            say(`<span class="text-emerald-600">${q?.pr ? (b.dataset.v === "approved" ? `OK to merge #${q.pr} sent; the merge thread merges it on its next sweep` : `Hold on #${q.pr} sent`) : b.dataset.v === "approved" ? (r.hired?.desk ? `Approved; ${esc(r.hired.desk)} is on the roster` : "Approved") : "Declined"}. Sent to ${esc(q?.from || "the lead")} via ${esc((r.delivered?.via || ["hub inbox"]).join(" and "))}.</span>${r.delivered?.githubError ? ` <span class="text-amber-700">GitHub inbox failed: ${esc(r.delivered.githubError)}</span>` : ""}${r.hired?.error ? ` <span class="text-amber-700">The desk was not added: ${esc(r.hired.error)}</span>` : ""}`);
          } catch (err) { say(`<span class="text-red-700">${esc(err.message)}</span>`); }
        }));
        $.all("[data-room]").forEach((b) => (b.onclick = async () => {
          const starting = b.dataset.st === "active";
          const name = rooms.find((x) => x.id === b.dataset.room)?.name;
          if (!await confirmBox({ title: starting ? `Start ${name}? If it has no lead, a "Project lead" request goes to HR.` : `Pause ${name}? Its active desks are paused too, and HR will decline new staff for it.`, yes: starting ? "Start" : "Pause", no: "Cancel" })) return;
          try { const r = await api("/agents/room", { id: b.dataset.room, status: b.dataset.st }); await load(); say(`<span class="text-emerald-600">${esc(name)} ${starting ? "started" : "paused"}${r.desksChanged ? ` (${r.desksChanged} desk${r.desksChanged === 1 ? "" : "s"})` : ""}${r.request ? ". Asked HR for a project lead." : "."}</span>`); }
          catch (err) { say(`<span class="text-red-700">${esc(err.message)}</span>`); }
        }));
        $.all("[data-edit]").forEach((b) => (b.onclick = () => fillDesk(desks.find((d) => d.id === b.dataset.edit))));
        // Jobs: give one to a desk, cancel it, or have the hub run it (password for another project desks and for runs).
        $.all("[data-give]").forEach((b) => (b.onclick = async () => {
          const text = await confirmBox({ title: `What should ${b.dataset.give} do?`, input: "", yes: "OK", no: "Cancel" });
          if (!text || !text.trim()) return;
          try { const r = await apiPw("/agents/job", { desk: b.dataset.give, text }); await load(); say(`<span class="text-emerald-600">Job given to ${esc(r.desk)} (${esc(r.via.join(" and "))}). Claude Code sessions on that desk see it when they start.</span>${r.githubError ? ` <span class="text-amber-700">GitHub failed: ${esc(r.githubError)}</span>` : ""}`); }
          catch (err) { if (!err.cancelled) say(`<span class="text-red-700">${esc(err.message)}</span>`); }
        }));
        $.all("[data-cancel]").forEach((b) => (b.onclick = async () => {
          if (!await confirmBox({ title: "Cancel this job?", yes: "Cancel job", no: "Keep it" })) return;
          try { await api(`/agents/job/${b.dataset.cancel}/cancel`, {}); await load(); say('<span class="text-emerald-600">Job cancelled.</span>'); } catch (err) { say(`<span class="text-red-700">${esc(err.message)}</span>`); }
        }));
        $.all("[data-run]").forEach((b) => (b.onclick = async () => {
          if (!await confirmBox({ title: `Run this job now on the desk's model? It spends API money (within the desk's cap). ${await approvalNote(`/agents/job/${b.dataset.run}/estimate`)}`.trim(), yes: "Run it", no: "Cancel" })) return;
          b.disabled = true; b.textContent = "running…";
          try { const r = await apiPw(`/agents/job/${b.dataset.run}/run`, {}); await load(); say(`<span class="text-emerald-600">Done: ${esc(r.summary || "finished")}. The result is on the desk's floor in the campus.</span>`); }
          catch (err) { if (!err.cancelled) say(`<span class="text-red-700">${esc(err.message)}</span>`); b.disabled = false; b.textContent = "run now"; }
        }));
        $.all("[data-new]").forEach((b) => (b.onclick = () => fillDesk({ id: b.dataset.new, status: "active" })));
      }

      function fillDesk(d = {}) {
        $("dkId").value = d.id || ""; $("dkRole").value = d.role || ""; $("dkProv").value = d.provider || "claude"; $("dkModel").value = d.model || "";
        $("dkEffort").value = d.effort || ""; $("dkCap").value = d.capUsdMonth ?? ""; $("dkStatus").value = d.status || "planned"; $("dkLead").checked = !!d.lead; $("dkBrief").value = d.brief || ""; $("dkFloor").value = d.floor || ""; $("dkSide").value = d.side || ""; $("dkRunner").checked = d.runner === "hub"; $("dkPassOff").checked = d.passOff !== false; $("dkLocal").checked = d.runner === "local"; $("dkApp").value = d.app || "";
        if (d.room) $("dkRoom").value = d.room;
        $("deskForm").scrollIntoView({ behavior: "smooth" });
      }

      $("dkSave").onclick = async () => {
        try {
          await api("/agents/desk", { id: $("dkId").value, room: $("dkRoom").value, role: $("dkRole").value, provider: $("dkProv").value, model: $("dkModel").value, effort: $("dkEffort").value || null, capUsdMonth: $("dkCap").value, status: $("dkStatus").value, lead: $("dkLead").checked, brief: $("dkBrief").value, floor: $("dkFloor").value, side: $("dkSide").value, passOff: $("dkPassOff").checked, runner: $("dkRunner").checked ? "hub" : $("dkLocal").checked ? "local" : "", app: $("dkApp").value }, { password: true }); // a higher cap or a hub-run desk asks for the password
          await load();
          say('<span class="text-emerald-600">Desk saved.</span>');
        } catch (err) { say(`<span class="text-red-700">${esc(err.message)}</span>`); }
      };
      $("rqAdd").onclick = async () => {
        try {
          await api("/agents/request", { room: $("rqRoom").value, role: $("rqRole").value, why: $("rqWhy").value, urgency: $("rqUrg").value, budgetAsk: $("rqBudget").value });
          $("rqRole").value = $("rqWhy").value = $("rqBudget").value = "";
          await load();
        } catch (err) { say(`<span class="text-red-700">${esc(err.message)}</span>`); }
      };
      $("hlAdd").onclick = async () => {
        try {
          const r = await api("/agents/hublog", { text: $("hlText").value, room: $("lgRoom").value });
          $("hlText").value = "";
          await load();
          say(`<span class="text-emerald-600">Logged ${r.logged} line${r.logged === 1 ? "" : "s"}.</span>${r.skipped.length ? ` <span class="text-amber-700">Skipped ${r.skipped.length} without a desk or summary.</span>` : ""}${!r.logged && !r.skipped.length ? ' <span class="text-amber-700">No "Hub log:" lines found.</span>' : ""}`);
        } catch (err) { say(`<span class="text-red-700">${esc(err.message)}</span>`); }
      };
      $("lgAdd").onclick = async () => {
        try {
          await api("/agents/event", { desk: $("lgDesk").value, room: $("lgRoom").value, provider: $("lgProv").value, summary: $("lgSum").value, billing: $("lgBill").value, action: "note" });
          $("lgSum").value = "";
          await load();
        } catch (err) { say(`<span class="text-red-700">${esc(err.message)}</span>`); }
      };
      $("hrRun").onclick = async () => {
        $("hrRun").disabled = true;
        try { const r = await api("/agents/hr/run", {}, { password: true, why: "This calls a paid AI model, so it needs your dashboard password." }); say(`<span class="text-emerald-600">HR checked ${r.reviewed || 0} request${r.reviewed === 1 ? "" : "s"}${r.overCap ? `, ${r.overCap} desk(s) over cap` : ""}.</span>`); await load(); }
        catch (err) { say(`<span class="text-red-700">${esc(err.message)}</span>`); }
        $("hrRun").disabled = false;
      };
      // ---------- Quality checks (agents/quality.js) ----------
      // Loads on its own (not with the 30-second refresh) so a half-typed brief isn't wiped; asks again every 5 seconds
      // only while a check is running.
      let q = null, qOpen = null, qEst = null, qPoll = null;
      const apiRun = (path, body) => api(path, body, { password: true, why: "A quality check re-runs past jobs on a real AI model, so it spends API money and needs your dashboard password." });
      const qWhen = (v) => (v.by === "before versions" ? "before versions were kept" : `${new Date(v.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · by ${v.by}`);
      const scoreTxt = (s) => (s == null ? "not scored yet" : `quality ${s}`);
      const RUN_ST = { running: "… running", done: "✓ done", failed: "✗ failed", stopped: "✗ stopped" };
      const qPay = (s) => Math.round(q.scale.min + ((q.scale.max - q.scale.min) * s) / 100);
      async function loadQuality() {
        try { q = await api("/agents/quality"); } catch (err) { $("qualityBox").style.display = "none"; return; }
        $("qualityBox").style.display = "";
        $("qScale").textContent = `${q.scale.min} to ${q.scale.max} credits a job`;
        const row = (d) => `<div><button class="w-full text-left text-sm border border-slate-200 rounded-lg px-3 py-2" data-qdesk="${esc(d.id)}" aria-expanded="${qOpen === d.id}">
            <span class="font-medium">${qOpen === d.id ? "▾" : "▸"} ${esc(d.id)}</span> <span class="sub">${esc(d.model || "no model")}</span><br>
            <span class="num">${scoreTxt(d.score)}${d.n ? ` (${d.n} job${d.n === 1 ? "" : "s"})` : ""} · pay ${d.pay}/job · ${d.samples} in taste test${d.versions ? ` · ${d.versions} brief version${d.versions === 1 ? "" : "s"}` : ""}</span></button>
            <div id="qd-${esc(d.id)}" class="mt-2 space-y-3"></div></div>`;
        const scored = q.desks.filter((d) => d.n), rest = q.desks.filter((d) => !d.n);
        $("qList").innerHTML = scored.map(row).join("") || '<div class="sub">No desk has a scored job yet. HR scores finished jobs with a saved result on its next check.</div>';
        $("qMoreSum").textContent = `Desks with no scored jobs yet (${rest.length})`;
        $("qMore").innerHTML = rest.map(row).join("");
        const run = q.runs.find((r) => r.status === "running");
        $("qRunning").innerHTML = run ? `… A quality check is running on <b>${esc(run.desk)}</b> (${run.done || 0} of ${run.n} re-run).` : "";
        clearTimeout(qPoll);
        if (run) qPoll = life.later(loadQuality, 5000);
        if (qOpen && q.desks.some((d) => d.id === qOpen)) await openDesk(qOpen, true);
      }
      async function openDesk(id, keep = false) {
        const box = $(`qd-${id}`);
        if (!box) return;
        const d = q.desks.find((x) => x.id === id);
        // keep what was typed when the list refreshes
        const was = keep && box.dataset.typed ? JSON.parse(box.dataset.typed) : null;
        let info;
        try { info = await api(`/agents/quality/desk/${encodeURIComponent(id)}`); } catch (err) { box.innerHTML = `<div class="text-red-700 text-sm">${esc(err.message)}</div>`; return; }
        const runLine = (r) => `<div class="border-t border-slate-100 pt-2">
            <div><b>${RUN_ST[r.status] || esc(r.status)}</b> · ${when(r.at)} · ${esc(r.candidate.model)}${r.candidate.brief !== r.current.brief ? " with a new brief" : ""}${r.candidate.effort && r.candidate.effort !== r.current.effort ? ` @${esc(r.candidate.effort)}` : ""} vs ${esc(r.current.model)} · ${r.n} sample${r.n === 1 ? "" : "s"}</div>
            ${r.status === "done" ? `<div class="font-medium">${esc(r.verdict.line)}</div><div class="sub">${esc(r.verdict.advice)}</div>
              <div class="num">Old answers ${r.oldAvg}/100 → new ${r.newAvg}/100 · new cost ${r.costPerJobUsd > 0 ? `${usd(r.costPerJobUsd)}/job` : "not logged"}${r.oldCostPerJobUsd != null ? ` (was ${usd(r.oldCostPerJobUsd)}/job)` : " (old cost not logged)"} · this check cost ${usd(r.spentUsd || 0)}</div>
              <details><summary class="cursor-pointer sub">Each job</summary>${r.results.map((x) => `<div class="mt-1">${esc(x.task)}: old ${x.old ?? "?"} → new ${x.new ?? "?"}${x.why ? ` · ${esc(x.why)}` : ""} <button class="pill text-xs underline" data-qside="${esc(r.id)}" data-qjob="${esc(x.job)}">Side by side</button><div id="qs-${esc(r.id)}-${esc(x.job)}"></div></div>`).join("")}</details>
              <button class="mt-1 px-3 py-1.5 rounded-lg border border-slate-300 text-sm" data-qapply="${esc(r.id)}">Use this setup on ${esc(r.desk)}</button>`
              : r.status === "running" ? `<div class="sub">${r.done || 0} of ${r.n} re-run so far.</div>` : `<div class="text-red-700">${esc(r.error || "")}</div>`}
          </div>`;
        const vers = info.versions;
        box.innerHTML = `
          <div class="space-y-2 text-sm">
            <div class="font-medium">Try a change</div>
            <div class="grid sm:grid-cols-3 gap-2">
              <label class="f">Model<input id="qm-${esc(id)}" value="${esc(was?.m ?? d.model ?? "")}" list="qModels" placeholder="e.g. claude-haiku-5-5" /></label>
              <label class="f">Effort<select id="qe-${esc(id)}"><option value="">same (${esc(d.effort || "medium")})</option><option>low</option><option>medium</option><option>high</option></select></label>
              <label class="f">Samples (1 to ${q.limits.maxSamples})<input id="qn-${esc(id)}" type="number" min="1" max="${q.limits.maxSamples}" value="${esc(was?.n || Math.min(q.limits.defaultSamples, Math.max(1, d.samples || 1)))}" /></label>
              <label class="f" style="grid-column: 1 / -1">Brief<textarea id="qb-${esc(id)}" rows="3" maxlength="1000">${esc(was?.b ?? d.brief ?? "")}</textarea></label>
            </div>
            <div class="flex gap-2 flex-wrap items-center"><button class="px-3 py-1.5 rounded-lg border border-slate-300" data-qest="${esc(id)}" ${d.samples ? "" : "disabled"}>Check the cost</button>${d.samples ? "" : '<span class="sub">No taste test yet: it needs a job scored 60 or more with a saved result.</span>'}</div>
            <div id="qest-${esc(id)}"></div>
          </div>
          ${info.runs.length ? `<div class="text-sm"><div class="font-medium">Quality checks</div>${info.runs.slice(0, 8).map(runLine).join("")}</div>` : ""}
          <details class="text-sm"><summary class="cursor-pointer font-medium">Taste test (${info.samples.length})</summary>${info.samples.map((s) => `<div class="mt-1"><span class="num">${s.score}</span>${s.from === "owner" ? " (your 👍)" : s.from === "lead" ? " (lead's 👍)" : ""} · ${esc(s.task)}</div>`).join("") || '<div class="sub">None yet.</div>'}</details>
          <details class="text-sm"><summary class="cursor-pointer font-medium">Brief versions (${vers.length})</summary>${vers.map((v, i) => `<div class="border-t border-slate-100 pt-2 mt-2">
              <div>${v.current ? "<b>● In use now</b> · since " : ""}${esc(qWhen(v))} · ${esc(v.model || "?")}${v.effort ? ` @${esc(v.effort)}` : ""}</div>
              <div class="num">${v.scoreAfter == null ? "no scored jobs on it" : `quality ${v.scoreAfter} over ${v.jobs} job${v.jobs === 1 ? "" : "s"} · pay ${qPay(v.scoreAfter)}/job`}${v.why ? ` · ${esc(v.why)}` : ""}</div>
              <div class="sub" style="white-space:pre-wrap">${esc(v.brief || "(no brief)")}</div>
              ${v.current ? "" : `<div class="flex gap-2 mt-1 flex-wrap"><button class="pill text-xs underline" data-qcmp="${i}">Compare with now</button><button class="px-2.5 py-1 rounded-lg border border-slate-300 text-xs" data-qback="${esc(v.at)}">↶ Roll back to this</button></div><div id="qc-${esc(id)}-${i}"></div>`}
            </div>`).join("") || "<div class=\"sub\">No changes kept yet. The next change to this desk's brief or model starts the list.</div>"}</details>`;
        if (was?.e) $(`qe-${id}`).value = was.e;
        box.dataset.versions = JSON.stringify(vers);
        const remember = () => (box.dataset.typed = JSON.stringify({ m: $(`qm-${id}`).value, e: $(`qe-${id}`).value, b: $(`qb-${id}`).value, n: $(`qn-${id}`).value }));
        for (const k of ["qm", "qe", "qb", "qn"]) $(`${k}-${id}`).addEventListener("input", remember);
      }
      const qBody = (id) => ({ desk: id, model: $(`qm-${id}`).value.trim(), effort: $(`qe-${id}`).value || undefined, brief: $(`qb-${id}`).value, n: Number($(`qn-${id}`).value) || undefined });
      $("qualityBox").addEventListener("click", async (ev) => {
        const b = ev.target.closest("button");
        if (!b) return;
        try {
          if (b.dataset.qdesk) {
            const id = b.dataset.qdesk;
            for (const el of $.all('[id^="qd-"]')) { el.innerHTML = ""; delete el.dataset.typed; }
            qOpen = qOpen === id ? null : id;
            qEst = null;
            for (const x of $.all("[data-qdesk]")) { const on = x.dataset.qdesk === qOpen; x.setAttribute("aria-expanded", on); x.querySelector("span").textContent = `${on ? "▾" : "▸"} ${x.dataset.qdesk}`; }
            if (qOpen) await openDesk(qOpen);
          } else if (b.dataset.qest) {
            const id = b.dataset.qest, body = qBody(id);
            b.disabled = true;
            const e = await api("/agents/quality/estimate", body).finally(() => (b.disabled = false));
            qEst = { id, e };
            $(`qest-${id}`).innerHTML = `<div class="text-sm border border-slate-200 rounded-lg p-2 space-y-1">
              <div>About <b class="num">${usd(e.estimateUsd)}</b> to re-run ${e.n} job${e.n === 1 ? "" : "s"}${e.n < e.asked ? ` (only ${e.n} in the taste test)` : ""} on ${esc(e.candidate.model)}${e.candidate.briefChanged ? " with the new brief" : ""}, plus one HR call to compare them (${esc(e.judge)}).${e.priceKnown ? "" : " No price on file for that model, so it's counted at the dearest Claude price."}</div>
              <div class="sub">Cap: ${usd(e.capUsd)} per check. Real API money; it needs your dashboard password.</div>
              ${e.overCap ? `<div class="text-red-700">✗ Over the cap: use fewer samples.</div>` : `<button class="px-3 py-1.5 rounded-lg bg-slate-800 text-white" data-qrun="${esc(id)}">Run it (about ${usd(e.estimateUsd)})</button>`}</div>`;
          } else if (b.dataset.qrun) {
            const id = b.dataset.qrun;
            if (!qEst || qEst.id !== id) return;
            b.disabled = true;
            await apiRun("/agents/quality/run", { ...qBody(id), okUsd: qEst.e.estimateUsd }).catch((err) => { b.disabled = false; throw err; });
            qEst = null;
            $(`qest-${id}`).innerHTML = '<div class="text-sm">… Started. The result shows here when it ends (usually a minute or two).</div>';
            await loadQuality();
          } else if (b.dataset.qapply) {
            const run = q.runs.find((r) => r.id === b.dataset.qapply);
            if (!(await confirmBox({ title: `Use this setup on ${run?.desk}?`, text: `${run?.candidate.model}${run?.candidate.brief !== run?.current.brief ? " and the new brief" : ""}. The old setup is kept as a brief version you can roll back to.`, yes: "Use it" }))) return;
            await api("/agents/quality/apply", { run: b.dataset.qapply }, { password: true, why: "Applying this result switches a worker to a different model, which can cost more, so it needs your dashboard password." });
            await loadQuality(); await load();
          } else if (b.dataset.qback) {
            if (!(await confirmBox({ title: `Roll ${qOpen} back?`, text: "Its brief, model and effort go back to that version. The one in use now is kept too.", yes: "Roll back" }))) return;
            await api("/agents/quality/rollback", { desk: qOpen, at: b.dataset.qback }, { password: true, why: "Rolling back switches a worker to a different model, which can cost more, so it needs your dashboard password." });
            await loadQuality(); await load();
          } else if (b.dataset.qcmp != null) {
            const vers = JSON.parse($(`qd-${qOpen}`).dataset.versions || "[]"), v = vers[Number(b.dataset.qcmp)], now = vers[0];
            const out = $(`qc-${qOpen}-${b.dataset.qcmp}`);
            if (out.innerHTML) { out.innerHTML = ""; return; }
            const diff = (k, label) => ((v[k] ?? "") === (now[k] ?? "") ? "" : `<div>${label}: ${esc(v[k] || "–")} → now ${esc(now[k] || "–")}</div>`);
            out.innerHTML = `<div class="grid sm:grid-cols-2 gap-2 mt-1 text-sm"><div class="border border-slate-200 rounded-lg p-2"><div class="font-medium">This version${v.scoreAfter != null ? ` · quality ${v.scoreAfter}` : ""}</div><div style="white-space:pre-wrap">${esc(v.brief || "(no brief)")}</div></div><div class="border border-slate-200 rounded-lg p-2"><div class="font-medium">Now${now.scoreAfter != null ? ` · quality ${now.scoreAfter}` : ""}</div><div style="white-space:pre-wrap">${esc(now.brief || "(no brief)")}</div></div></div>${diff("model", "Model")}${diff("effort", "Effort")}${diff("provider", "Provider")}`;
          } else if (b.dataset.qside) {
            const out = $(`qs-${b.dataset.qside}-${b.dataset.qjob}`);
            if (out.innerHTML) { out.innerHTML = ""; return; }
            const t = await api(`/agents/quality/run/${b.dataset.qside}/${b.dataset.qjob}`);
            const pre = (s) => `<pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;font-size:11px">${esc(String(s || "(missing)").slice(0, 6000))}</pre>`;
            out.innerHTML = `<div class="grid sm:grid-cols-2 gap-2 mt-1"><div><div class="sub">Old answer</div>${pre(t.old)}</div><div><div class="sub">New answer</div>${pre(t.new)}</div></div>`;
          }
        } catch (err) { if (!err.cancelled) say(`<span class="text-red-700">${esc(err.message)}</span>`); }
      });
      $("reload").onclick = () => { load(); loadQuality(); };
      load();
      loadQuality();
      life.every(() => document.visibilityState === "visible" && load(), 30000);
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
