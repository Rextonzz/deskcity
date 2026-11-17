// Admin: the page's working part as a block (see public/parts/kit.js). Mounted by public/admin.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, api, askPassword, when } from "/lib.js";
import { scope, lifecycle, needScripts } from "/parts/kit.js";
import { chName } from "/hubinfo.js";
import { backupWhere } from "/parts/backupwords.js";

export const html = `<section class="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
  <div class="flex items-center gap-2 flex-wrap">
    <h2 class="font-semibold flex-1">Health</h2>
    <button id="runHealth" class="text-sm px-3 py-1.5 rounded-lg border border-slate-300">Check now</button>
    <button id="runBackup" class="text-sm px-3 py-1.5 rounded-lg border border-slate-300">Back up now</button>
            <button id="restartBtn" class="text-sm px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-50">Restart app</button>
  </div>
  <p id="appInfo" class="text-xs text-slate-500"></p>
  <p class="text-sm text-slate-500">Runs by itself every morning at 9 and sends your phone "all good" or what's wrong. No morning alert means the PC or the app is off. Backups run every night at 3.</p>
  <p id="bkWhere" class="text-sm text-slate-500"></p>
  <div id="health" class="text-sm"></div>
</section>

<section class="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
  <div class="flex items-center gap-2 flex-wrap">
    <h2 class="font-semibold flex-1">Controls</h2>
    <button id="pauseBtn" class="text-sm px-3 py-1.5 rounded-lg border border-slate-300"></button>
  </div>
  <p id="pauseMsg" class="text-sm text-slate-500"></p>
  <div class="flex items-center gap-2 flex-wrap pt-2 border-t border-slate-200">
    <p id="standbyMsg" class="text-sm text-slate-500 flex-1 min-w-0"></p>
    <button id="standbyBtn" class="text-sm px-3 py-1.5 rounded-lg border border-slate-300"></button>
  </div>
</section>

<section class="bg-white rounded-xl border border-slate-200 p-4 space-y-3" id="helpersCard">
  <div class="flex items-center gap-3 flex-wrap">
    <h2 class="font-semibold flex-1">AI helpers</h2>
    <label class="flex items-center gap-2 text-sm font-medium"><input type="checkbox" id="helpersOn" class="w-5 h-5" /> <span id="helpersState">Off</span></label>
  </div>
  <p id="helpersAbout" class="text-sm text-slate-500">HR, the assistant, the board, worker chatter, growing personalities and workers starting jobs by themselves. Off = the hub never calls an AI provider on its own. Jobs you run yourself still work.</p>
  <p class="text-sm text-slate-500">AI providers: the hub only runs a model it has a price for. Claude and Gemini are built in; for OpenAI, Grok or DeepSeek add providers.&lt;id&gt;.prices.&lt;model&gt; = { in, out } (US dollars per million tokens) to the hub settings. Local models are free.</p>
  <div class="flex items-end gap-3 flex-wrap">
    <label class="text-sm">Daily limit (US dollars)<input id="helpersLimit" type="number" min="0" step="0.5" placeholder="no limit" inputmode="decimal" class="block mt-1 w-32 border border-slate-300 rounded-lg px-3 py-1.5 text-base" /></label>
    <button id="helpersSave" class="text-sm px-3 py-1.5 rounded-lg border border-slate-300">Save limit</button>
  </div>
  <p id="helpersSpent" class="text-sm text-slate-600"></p>
  <p id="helpersMsg" class="text-sm text-slate-500" aria-live="polite"></p>
</section>

<section class="bg-white rounded-xl border border-slate-200 p-4 space-y-3" id="pipeCapCard">
  <h2 class="font-semibold">Pipeline AI budget</h2>
  <p class="text-sm text-slate-500">An optional monthly limit on the AI calls the hub makes for its own pipeline steps (lookups, scripts, ideas: anything not run by a desk or HR). When it is used up those steps stop and the job waits as held; nothing is lost. Empty = no limit.</p>
  <div class="flex items-end gap-3 flex-wrap">
    <label class="text-sm">Monthly limit (US dollars)<input id="pipeCapLimit" type="number" min="0" step="1" placeholder="no limit" inputmode="decimal" class="block mt-1 w-32 border border-slate-300 rounded-lg px-3 py-1.5 text-base" /></label>
    <button id="pipeCapSave" class="text-sm px-3 py-1.5 rounded-lg border border-slate-300">Save limit</button>
  </div>
  <p id="pipeCapSpent" class="text-sm text-slate-600"></p>
  <p id="pipeCapMsg" class="text-sm text-slate-500" aria-live="polite"></p>
</section>

<section class="bg-white rounded-xl border border-slate-200 p-4 space-y-3" id="passOffCard">
  <div class="flex items-center gap-3 flex-wrap">
    <h2 class="font-semibold flex-1">Refusal pass-off</h2>
    <label class="flex items-center gap-2 text-sm font-medium"><input type="checkbox" id="passOffOn" class="w-5 h-5" /> <span id="passOffState">On</span></label>
  </div>
  <p class="text-sm text-slate-500">When an AI service declines a job, the hub tags the reason and lets the next service try once. It stops and asks you when the reason is serious or every service has declined.</p>
  <p id="passOffMsg" class="text-sm text-slate-500" aria-live="polite"></p>
</section>

<section class="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
  <h2 class="font-semibold">Learning from your corrections</h2>
  <p class="text-sm text-slate-500">Every box you fill in on a hold, every edit to the AI's answer and every render note is saved. The step that got it wrong sees your latest corrections each time it runs, so it learns as it goes. The rules review gets them too, and runs early when the same step is corrected 3 times, to suggest a rule fix.</p>
  <div id="fixes" class="text-sm overflow-x-auto"></div>
</section>


<section class="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
  <div class="flex items-center gap-2 flex-wrap">
    <h2 class="font-semibold flex-1">Restore from a backup</h2>
    <select id="bkPick" class="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"></select>
  </div>
  <p class="text-sm text-slate-500">Bring back the trackers, reference files, settings or job records from a nightly backup. Your current copies are saved first in a "before restore" backup, so you can undo it from this same list. Close the tracker in Excel before restoring it. Needs your password.</p>
  <div id="bkFiles" class="text-sm"></div>
  <div class="flex gap-2 flex-wrap items-center">
    <button id="bkRestore" class="text-sm px-3 py-1.5 rounded-lg bg-red-600 text-white disabled:opacity-50">Restore ticked files</button>
    <button id="bkAll" class="text-sm px-3 py-1.5 rounded-lg border border-slate-300">Tick all</button>
    <span id="bkMsg" class="text-sm text-slate-600"></span>
  </div>
</section>

<details id="partsBox" class="bg-white rounded-xl border border-slate-200 p-4">
  <summary class="font-semibold cursor-pointer">Parts <span id="partsState" class="text-sm font-normal text-slate-500"></span></summary>
  <p class="mt-2 text-sm text-slate-500">Every optional part and whether it is on. A part that needs files this copy does not have is greyed out and cannot be switched on. To change what is on, see the user guide ("modules" in data/hub-settings.json).</p>
  <ul id="partsList" class="mt-2 text-sm divide-y divide-slate-100"></ul>
</details>

<details id="alerts" class="bg-white rounded-xl border border-slate-200 p-4">
  <summary class="font-semibold cursor-pointer">Phone alerts <span id="alertState" class="text-sm font-normal text-slate-500"></span></summary>
  <div class="mt-3 space-y-3 text-sm">
    <ol class="list-decimal pl-5 space-y-1 text-slate-700">
      <li>Install the free <b>ntfy</b> app on your phone (App Store or Google Play).</li>
      <li>In the app tap <b>+</b>, and subscribe to this topic (leave the server as ntfy.sh):
        <div class="flex gap-2 mt-1"><code id="topic" class="flex-1 min-w-0 truncate bg-slate-100 rounded px-2 py-1.5"></code><button id="copyTopic" class="px-3 rounded-lg border border-slate-300">Copy</button></div>
        <div class="text-xs text-slate-500 mt-1">Keep it private: anyone with this name gets your alerts.</div></li>
      <li>Press <b>Send test</b> and check your phone.</li>
    </ol>
    <label class="flex items-start gap-2"><input type="checkbox" data-alert="enabled" class="mt-1" /> <span>Alerts on <span id="alertSecNote" class="text-slate-500">(sign-in alerts follow this switch)</span></span></label>
    <div>
      <div class="font-medium mb-1">How loud each alert is</div>
      <p class="text-xs text-slate-500 mb-2">Quiet shows up with no sound. Normal makes a sound. High buzzes longer. Urgent pops up on screen and can get through Do Not Disturb (allow it in the ntfy app's settings).</p>
      <div id="levels" class="divide-y divide-slate-100"></div>
    </div>
    <label class="block">Dashboard address, so tapping an alert opens it (optional)
      <input id="dashUrl" placeholder="http://my-pc:3000" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
    <div class="flex flex-wrap gap-2 items-center"><button id="saveAlerts" class="px-4 py-2 rounded-lg border border-slate-300">Save</button><button id="alertTest" class="px-4 py-2 rounded-lg bg-red-600 text-white">Send test</button><button id="weekTest" class="px-4 py-2 rounded-lg border border-slate-300">Send this week's summary now</button><span id="alertMsg" class="text-slate-500"></span></div>
  </div>
</details>

<details id="devBox" class="bg-white rounded-xl border border-slate-200 p-4">
  <summary class="font-semibold cursor-pointer">Signed-in devices</summary>
  <p class="mt-2 text-sm text-slate-500">Devices that have signed in. Forget one and its next sign-in counts as a new device again, with the urgent alert. To sign every device out, use Sign out everywhere at the bottom of the menu.</p>
  <ul id="devList" class="mt-2 text-sm divide-y divide-slate-100"></ul>
</details>

<details id="freeBox" class="bg-white rounded-xl border border-slate-200 p-4">
  <summary class="font-semibold cursor-pointer">Free up space</summary>
  <p class="mt-2 text-sm text-slate-500">Everything that could be freed, in groups. This is only a list. Nothing is removed until you tick groups, press the button and give your password. Groups marked "needs your OK" remove original videos or final renders (the only copy) and are off until you tick them.</p>
  <div id="free" class="mt-2 text-sm"></div>
  <p id="freeTotal" class="mt-2 text-sm"></p>
  <button id="freeGo" class="mt-2 text-sm px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-50" disabled>Free up space</button>
</details>

<details id="diskBox" class="bg-white rounded-xl border border-slate-200 p-4">
  <summary class="font-semibold cursor-pointer">Disk space</summary>
  <p class="mt-2 text-sm text-slate-500">Working files (frame sheets, turned or cropped copies, renders inside the job) for videos already live and past the grace period. This list is only a list: nothing is removed until you press the button and give your password. Each job's record and its final thumbnail are always kept. Original videos are in their own group below and are removed only if you tick the box (and only while the keepOriginals setting is off).</p>
  <div id="disk" class="mt-2 text-sm"></div>
  <label id="diskOrigRow" class="mt-2 text-sm flex items-center gap-2 hidden"><input type="checkbox" id="diskOrig"> <span id="diskOrigText"></span></label>
  <button id="diskClean" class="mt-2 text-sm px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-50">Clean up</button>
</details>




<details id="dlBox" class="bg-white rounded-xl border border-slate-200 p-4">
  <summary class="font-semibold cursor-pointer">Downloads</summary>
  <p class="mt-2 text-sm text-slate-500">A copy of each file, to open on whatever device you're on. Nothing on the PC changes.</p>
  <ul id="dlList" class="mt-2 text-sm divide-y divide-slate-100"></ul>
</details>

<details id="updBox" class="bg-white rounded-xl border border-slate-200 p-4">
  <summary class="font-semibold cursor-pointer">Updates <span id="updNow" class="text-sm font-normal text-slate-500"></span></summary>
  <p id="updVer" class="mt-2 text-sm"></p>
  <p id="updLast" class="mt-1 text-sm text-slate-500"></p>
  <div class="mt-3 flex items-center gap-2 flex-wrap">
    <button id="updCheck" class="text-sm px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-50">Check for an update</button>
    <span id="updMsg" class="text-sm text-slate-600" aria-live="polite"></span>
  </div>
  <p class="mt-1 text-xs text-slate-500">Nothing is checked unless you press this button. It asks the project's releases address once and sends nothing about you or this PC.</p>
  <h3 class="mt-4 text-sm font-semibold">What's new</h3>
  <div id="updNew" class="mt-1 text-sm"></div>
  <h3 class="mt-4 text-sm font-semibold">To update or go back</h3>
  <ul class="mt-1 text-sm space-y-2">
    <li><code class="px-1 rounded bg-slate-100">npm run update</code> Close the hub first, then run it in the hub folder: it shows what it will do, and with <code class="px-1 rounded bg-slate-100">-- --yes</code> it backs up, updates, tests the new version on a copy of your data and tells you what changed.</li>
    <li><code class="px-1 rounded bg-slate-100">npm run update -- --rollback</code> Goes back to the version from before the last update.</li>
  </ul>
  <p class="mt-2 text-xs text-slate-500">An update never touches your data folder or .env. There is no update button here on purpose: updating replaces the code this page is running on.</p>
</details>

<details id="histBox" class="bg-white rounded-xl border border-slate-200 p-4">
  <summary class="font-semibold cursor-pointer">Version history <span id="histNow" class="text-sm font-normal text-slate-500"></span></summary>
  <p class="mt-2 text-sm text-slate-500">Every update with what it changed, and when it first ran on this PC. The app also checks its own files each time it starts, so code that changed without a note shows up here in red.</p>
  <div id="histList" class="mt-2 text-sm"></div>
</details>

<details id="verBox" class="bg-white rounded-xl border border-slate-200 p-4">
  <summary class="font-semibold cursor-pointer">Tool versions</summary>
  <p class="mt-2 text-sm text-slate-500">What the app runs on. Node and Python support dates come from endoflife.date.</p>
  <ul id="verList" class="mt-2 text-sm divide-y divide-slate-100"></ul>
</details>

<details id="runlogBox" open class="bg-white rounded-xl border border-slate-200 p-4">
  <summary class="font-semibold cursor-pointer">Run log</summary>
  <p class="mt-2 text-sm text-slate-500">Everything the app does: stats pulls, deal scans, health checks, backups, rules reviews, card lookups, pipeline jobs, AI calls, alerts and button presses: when it started and ended, what it did, how long each step took, and any warnings or errors. Tap a run for the details.</p>
  <div id="runlog" class="mt-2"></div>
</details>

<details id="seclog" class="bg-white rounded-xl border border-slate-200 p-4">
  <summary class="font-semibold cursor-pointer">Security log</summary>
  <p class="mt-2 text-sm text-slate-500">Sign-ins, wrong tries, password checks and go-live changes, newest first. If you see one that wasn't you, press <b>Sign out everywhere</b> at the bottom of the menu and run <code>npm run set-password</code> on your PC.</p>
  <ul id="seclogList" class="mt-2 text-sm divide-y divide-slate-100"></ul>
</details>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "admin";
  const $ = scope(root), life = lifecycle();
  await needScripts(["/timing.js", "/runlog.js"]);
  // What the dashboard password is asked for on this page.
  const PW_WHY = "This can post to a live channel or restart the app, so it needs your dashboard password.";

  let runs = runLog.mount($("runlog"), { filters: true, limit: 500 });
  $("runlogBox").addEventListener("toggle", () => $("runlogBox").open && runs.reload());

  async function loadSecLog() {
    const rows = await api("/security").catch(() => []);
    $("seclogList").innerHTML = rows.map((r) => `<li class="py-1.5 flex gap-3"><span class="shrink-0 text-slate-500 w-32">${esc(when(r.at))}</span><span class="flex-1 min-w-0">${esc(r.event)}<span class="block text-xs text-slate-500 truncate">${esc(r.ip)} · ${esc(r.device)}</span></span></li>`).join("") || `<li class="py-1.5 text-slate-500">Nothing yet.</li>`;
  }

  const openHealth = new Set();
  life.on(root, "toggle", (e) => { const t = e.target.dataset?.hsec; if (t) e.target.open ? openHealth.add(t) : openHealth.delete(t); }, true);
  // Is a part on? One read of the hub's settings, kept; an unreadable answer counts as on, so nothing is hidden by mistake.
  // A part that is off has no routes (they answer 404), so the page does not ask for them.
  let settingsP = null;
  const partOn = async (id) => { try { settingsP ??= fetch("/api/hub/settings").then((r) => (r.ok ? r.json() : null)); const s = await settingsP; return !Array.isArray(s?.modules) || s.modules.includes(id); } catch { return true; } };
  async function loadHealth() {
    try {
      if (!(await partOn("youtube"))) { $("health").innerHTML = '<p class="text-slate-500">The health check belongs to the YouTube and TikTok pipeline, which is not switched on here.</p>'; return; }
      const h = await api("/health");
      const item = (c) => `<li class="py-1.5 flex gap-2"><span class="shrink-0 ${c.ok ? "text-emerald-600" : "text-red-600"}">${c.ok ? "✓" : "✗"}</span><span class="flex-1 min-w-0"><b class="font-medium">${esc(c.name)}</b> <span class="text-slate-600">${esc(c.detail)}</span>${c.name === "Errors in the last 24 hours" && !c.ok ? ` <button data-clear-errors class="ml-1 text-xs rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50">Clear errors</button> <a href="#runlogBox" class="text-xs text-slate-500 hover:underline">see them</a>` : ""}${c.image ? `<a href="/api/pipeline/health/image/${esc(c.image)}" target="_blank" rel="noopener"><img src="/api/pipeline/health/image/${esc(c.image)}" class="mt-1 w-24 h-16 object-cover object-top rounded border border-slate-300" style="filter:brightness(.75)" alt="What Studio showed (tap for full size)" /></a>` : ""}</span></li>`;
      // Sections: anything failing is listed first, then each section folds to a one-line summary.
      const SECTIONS = [
        ["Posting", /today's video|YouTube Studio|TikTok|Jobs|rules review/],
        ["AI", /API key|credit|Whisper/],
        ["Trackers and data", /tracker|upload log|Excel|Stats pull|Backup/],
        ["System", /./],
      ];
      const all = h.checks || [];
      const groups = SECTIONS.map(([title, re]) => [title, []]);
      for (const c of all) groups[SECTIONS.findIndex(([, re]) => re.test(c.name))][1].push(c);
      const bad = all.filter((c) => !c.ok);
      const rows = (bad.length ? `<li class="pt-1 pb-2"><p class="text-xs font-medium text-red-700 uppercase tracking-wide">Needs a look (${bad.length})</p><ul>${bad.map(item).join("")}</ul></li>` : "") +
        groups.filter(([, cs]) => cs.length).map(([title, cs]) => {
          const n = cs.filter((c) => !c.ok).length;
          return `<li class="py-1"><details${openHealth.has(title) ? " open" : ""} data-hsec="${esc(title)}"><summary class="cursor-pointer py-1 flex gap-2 items-center"><span class="font-medium flex-1">${esc(title)}</span><span class="text-xs ${n ? "text-red-600" : "text-emerald-600"}">${n ? `${n} problem${n === 1 ? "" : "s"}` : `all ${cs.length} good`}</span></summary><ul class="pl-1">${cs.map(item).join("")}</ul></details></li>`;
        }).join("");
      const jobsLine = (n) => (!n ? "" : `<p class="text-sm mt-1">${n.paused ? '<span class="text-red-600">Pipeline paused.</span> ' : ""}${n.running.length ? n.running.map((r) => `Working on <b class="font-medium">${esc(r.label)}</b>: ${esc(r.stage || "")}${r.since ? ` for ${esc(timing.dur(Date.now() - Date.parse(r.since)))}` : ""}${r.batch ? " (waiting for the half-price batch)" : ""}`).join("; ") : "Nothing running."}${n.queued ? ` ${n.queued} in line.` : ""}${n.held ? ` <a href="/pipeline.html" class="text-amber-700 hover:underline">${n.held} waiting on you</a>.` : ""}</p>`);
      const elapsedMs = h.runningSince ? Date.now() - Date.parse(h.runningSince) : 0;
      $("health").innerHTML = (h.running ? `<p class="text-slate-500 mb-1">Checking… ${esc(timing.progressText({ elapsedMs, typicalMs: h.typicalMs || h.durationMs || 90000 }))}. It opens YouTube Studio for each channel.</p>` : "") +
        (h.at ? `<p class="text-slate-500">Last check ${esc(when(h.at))}: ${h.ok ? `<span class="text-emerald-700 font-medium">all good</span>` : `<span class="text-red-700 font-medium">needs a look</span>`}</p><ul class="divide-y divide-slate-100">${rows}</ul>` : h.running ? "" : `<p class="text-slate-500">No check yet. Press Check now.</p>`) + jobsLine(h.jobs);
      $("runHealth").disabled = h.running;
      $("runHealth").textContent = `Check now${h.typicalMs || h.durationMs ? ` · ${timing.est(h.typicalMs || h.durationMs)}` : ""}`;
      $.all("[data-clear-errors]").forEach((b) => (b.onclick = async () => {
        b.disabled = true;
        b.textContent = "Clearing…";
        await api("/health/clear-errors", {}).catch((err) => (b.textContent = err.message));
        loadHealth();
      }));
      if (h.running) life.later(loadHealth, 4000);
    } catch (err) {
      $("health").innerHTML = `<p class="text-red-700">${esc(err.noRoute ? "the app needs a restart to load the health check" : err.message)}</p>`;
    }
  }
  $("runHealth").onclick = async () => {
    await api("/health/run", {}, { password: true, why: "This calls a paid AI model, so it needs your dashboard password." }).catch(() => {});
    loadHealth();
  };
  $("runBackup").onclick = async () => {
    const stop = timing.ticker($("runBackup"), (ms) => `Backing up… ${timing.dur(ms)}`);
    try {
      const b = await api("/backup/run", {});
      stop();
      $("runBackup").textContent = b.ok ? `Backed up ${b.files} files and ${b.jobs} jobs` : `Backup failed: ${b.error}`;
    } catch (err) {
      stop();
      $("runBackup").textContent = "Failed: " + err.message;
    }
    life.later(() => (($("runBackup").textContent = "Back up now"), loadHealth()), 5000);
  };

  // Restore
  let backups = [];
  const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const bkLabel = (b) => (b.undo ? `Before restore, ${when(b.name.replace(/^before-restore-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/, "$1T$2:$3:$4Z"))}` : new Date(`${b.name}T12:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }));
  const GROUPS = { trackers: "Trackers", References: "Channel reference files", data: "Settings", jobs: "Job records", "pipeline.config.json": "Settings" };
  function drawBackup() {
    const b = backups.find((x) => x.name === $("bkPick").value);
    if (!b) return ($("bkFiles").innerHTML = '<p class="text-slate-500">No backups yet. Press Back up now.</p>');
    const by = {};
    for (const f of b.files.filter((f) => f.restorable)) (by[GROUPS[f.rel.split("/")[0]] || "Other"] ??= []).push(f);
    $("bkFiles").innerHTML = Object.entries(by).map(([g, fs]) => `<details ${g === "Job records" ? "" : "open"} class="py-1"><summary class="cursor-pointer font-medium">${esc(g)} <span class="text-slate-500 font-normal">(${fs.length})</span></summary><ul class="pl-1 mt-1 space-y-1">${fs.map((f) => `<li><label class="flex items-center gap-2"><input type="checkbox" data-bk="${esc(f.rel)}" /> <span class="flex-1 min-w-0 truncate">${esc(f.rel.split("/").pop())}</span><span class="text-xs text-slate-500 shrink-0">${kb(f.size)}</span></label></li>`).join("")}</ul></details>`).join("") || '<p class="text-slate-500">Nothing in this backup can be restored.</p>';
  }
  async function loadBackups() {
    const r = await api("/backup/list").catch(() => ({ backups: [] }));
    backups = r.backups;
    // Where the copies go, in words: this PC's folder, every extra place (backup.copies or backup.copyTo) and how many are kept.
    if (r.dir) $("bkWhere").textContent = backupWhere(r, when);
    $("bkPick").innerHTML = backups.map((b) => `<option value="${esc(b.name)}">${esc(bkLabel(b))}</option>`).join("");
    drawBackup();
  }
  $("bkPick").onchange = drawBackup;
  $("bkAll").onclick = () => $.all("[data-bk]").forEach((c) => (c.checked = true));
  $("bkRestore").onclick = async () => {
    const files = [...$.all("[data-bk]:checked")].map((c) => c.dataset.bk);
    if (!files.length) return ($("bkMsg").textContent = "Tick at least one file.");
    const b = backups.find((x) => x.name === $("bkPick").value);
    if (!(await timing.confirmBox({ title: `Restore ${files.length} file${files.length > 1 ? "s" : ""}?`, text: `They're replaced with the copies from ${bkLabel(b)}. Your current copies are saved first, so you can undo this.`, yes: "Restore", no: "Cancel" }))) return;
    if (!(await askPassword(PW_WHY))) return;
    $("bkRestore").disabled = true;
    try {
      const r = await api("/backup/restore", { name: b.name, files });
      $("bkMsg").textContent = `Restored ${r.restored.length}.${r.failed.length ? ` Couldn't restore: ${r.failed.join("; ")}.` : ""}${r.undo ? " To undo, pick the newest \"Before restore\" backup." : ""}`;
    } catch (err) {
      $("bkMsg").textContent = "Failed: " + err.message;
    }
    $("bkRestore").disabled = false;
    loadBackups();
  };
  loadBackups();

  // Restart: the app exits and start-pipeline.cmd starts it again; the page waits for it to answer.
  async function loadApp() {
    const a = await api("/app").catch(() => null);
    if (!a) return ($("appInfo").textContent = "");
    $("restartBtn").disabled = !a.supervised;
    const starter = a.starter || null; // the start script this app folder ships; a fresh kit has none, so it says npm start
    $("restartBtn").title = a.supervised ? `Stops the app; ${starter || "the start script"} starts it again in about 10 seconds.` : starter ? `Start the app with ${starter} (or the auto-start) once and this works from then on.` : "Stop the app and start it again with npm start.";
    $("appInfo").textContent = `${a.kit ? `${a.kit.name} ${a.kit.version || ""}${a.kit.commit ? ` (commit ${a.kit.commit})` : ""}. ` : ""}App running for ${timing.dur(a.uptimeMs)} (since ${when(a.startedAt)}).${a.supervised ? "" : starter ? ` Restart needs the app started with ${starter}.` : " To restart it, close it and run npm start again."}`;
    return a;
  }
  $("restartBtn").onclick = async () => {
    if (!(await timing.confirmBox({ title: "Restart the app?", text: "It stops and starts again on the PC. The page comes back by itself in about 20 seconds.", yes: "Restart" }))) return;
    if (!(await askPassword(PW_WHY))) return;
    const before = (await api("/app").catch(() => ({}))).startedAt;
    let res = await fetch("/api/pipeline/app/restart", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    let r = await res.json().catch(() => ({}));
    if (res.status === 409 && r.busy?.length) {
      if (!(await timing.confirmBox({ title: "Something is running", text: `${r.message} It won't carry on after the restart.`, yes: "Restart anyway", no: "Wait" }))) return;
      res = await fetch("/api/pipeline/app/restart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) });
      r = await res.json().catch(() => ({}));
    }
    if (!res.ok) return ($("appInfo").textContent = r.message || r.error || "Couldn't restart.");
    $("restartBtn").disabled = true;
    const stop = timing.ticker($("appInfo"), (ms) => `Restarting… ${timing.dur(ms)}`);
    const started = Date.now();
    const wait = life.every(async () => {
      const a = await fetch("/api/pipeline/app").then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (a && a.startedAt !== before) {
        clearInterval(wait);
        stop();
        location.reload();
      } else if (Date.now() - started > 120000) {
        clearInterval(wait);
        stop();
        $("appInfo").textContent = "It hasn't come back after 2 minutes. Check the YT Pipeline window on the PC.";
      }
    }, 3000);
  };

  loadApp();
  loadHealth();
  loadSecLog();
  // Admin tools: controls, corrections, devices, disk, downloads, versions.
  const mb = (n) => (n == null ? "?" : n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : `${Math.round(n / 1048576)} MB`);
  const STAGE = { locate: "Finding the pack, set and turn", readCards: "Reading cards", price: "Card prices", render: "Making the video (pack cost, episode)", checkRender: "Render check", package: "Titles and text", review: "Reviewing the clip", plan: "Planning the cut", checkEdit: "Checking the cut", audit: "Your check before upload", cardRead: "Reading a card photo", intake: "Finding the clips" };
  // Standby (home server move): this copy only runs TEST_ jobs and never posts.
  async function loadStandby() {
    const s = await api("/admin/standby").catch(() => ({ standby: false }));
    $("standbyBtn").textContent = s.standby ? "Make this the live copy" : "Put on standby";
    $("standbyBtn").className = `text-sm px-3 py-1.5 rounded-lg ${s.standby ? "bg-amber-600 text-white" : "border border-slate-300"}`;
    $("standbyMsg").innerHTML = s.standby
      ? `<b class="font-medium text-amber-700">Standby copy</b> since ${esc(when(s.at))}${s.reason ? ` (${esc(s.reason)})` : ""}. It runs TEST_ videos only and never uploads or posts.`
      : "This is the live copy. Standby is for the home server move: a standby copy never uploads or posts.";
    $("standbyBtn").onclick = async () => {
      const on = !s.standby;
      const text = on ? "This copy stops uploading and posting. Scheduled videos already in Studio still go public; pinned comments and TikTok posts wait." : "This copy starts uploading and posting. Only do this when the other copy is on standby, or videos go up twice.";
      if (!(await timing.confirmBox({ title: on ? "Put this copy on standby?" : "Make this the live copy?", text, yes: on ? "Standby" : "Make live" }))) return;
      if (!(await askPassword(PW_WHY))) return;
      try { await api("/admin/standby", { standby: on }); } catch (err) { $("standbyMsg").textContent = `Couldn't change it: ${err.message}`; return; }
      loadStandby();
    };
  }
  async function loadPause() {
    const p = await api("/admin/pause").catch(() => ({ paused: false }));
    $("pauseBtn").textContent = p.paused ? "Resume pipeline" : "Pause pipeline";
    $("pauseBtn").className = `text-sm px-3 py-1.5 rounded-lg ${p.paused ? "bg-red-600 text-white" : "border border-slate-300"}`;
    $("pauseMsg").textContent = p.paused ? `Paused since ${when(p.at)}. No new job starts. Scheduled videos still go public on time.` : "Pause stops new jobs from starting (a running one finishes). Scheduled videos still go public on time.";
    $("pauseBtn").onclick = async () => (await api("/admin/pause", { paused: !p.paused }), loadPause());
  }
  async function loadFixes() {
    if (!(await partOn("youtube"))) { $("fixes").innerHTML = '<p class="text-slate-500">Corrections are kept by the YouTube and TikTok pipeline, which is not switched on here.</p>'; return; }
    const f = await api("/corrections").catch(() => ({ total: 0, groups: [] }));
    $("fixes").innerHTML = !f.total ? '<p class="text-slate-500">No corrections in the last 90 days yet.</p>' : `<table class="w-full text-sm" style="font-variant-numeric:tabular-nums"><thead class="text-left text-slate-500"><tr><th class="py-1 font-medium">Step</th><th class="py-1 font-medium text-right">30 days</th><th class="py-1 font-medium text-right">90 days</th></tr></thead><tbody>${f.groups.map((g) => `<tr class="border-t border-slate-100 align-top"><td class="py-1 pr-2"><details><summary class="cursor-pointer">${esc({ cards: "Card price check" }[g.channel] || chName(g.channel))}: ${esc(STAGE[g.stage] || g.stage)}</summary><ul class="mt-1 space-y-1 text-xs text-slate-600">${g.latest.map((c) => `<li><b class="font-medium">${esc(c.video)}</b> ${esc(new Date(c.at).toLocaleDateString())}: ${esc(c.changes.join("; "))}</li>`).join("")}</ul></details></td><td class="py-1 text-right ${g.last30 >= 3 ? "text-red-600" : ""}">${g.last30}</td><td class="py-1 text-right">${g.count}</td></tr>`).join("")}</tbody></table>`;
    // How each hold was answered: passed as suggested vs changed. A step nearly always passed may be too strict.
    if (f.holds?.length) $("fixes").insertAdjacentHTML("beforeend", `<h3 class="mt-4 text-sm font-medium">How you answered holds (60 days)</h3><p class="text-xs text-slate-500">A step you almost always pass unchanged may be stopping you for nothing; the rules review sees this and can suggest a looser bar.</p><table class="w-full text-sm mt-1" style="font-variant-numeric:tabular-nums"><thead class="text-left text-slate-500"><tr><th class="py-1 font-medium">Step</th><th class="py-1 font-medium text-right">Holds</th><th class="py-1 font-medium text-right">You changed</th><th class="py-1 font-medium text-right">Passed as is</th></tr></thead><tbody>${f.holds.map((h) => `<tr class="border-t border-slate-100"><td class="py-1 pr-2">${esc(chName(h.channel))}: ${esc(STAGE[h.stage] || h.stage)}</td><td class="py-1 text-right">${h.holds}</td><td class="py-1 text-right">${h.changed}</td><td class="py-1 text-right">${h.passed}</td></tr>`).join("")}</tbody></table>`);
  }
  async function loadDevices() {
    const d = await api("/admin/devices").catch(() => []);
    $("devList").innerHTML = d.map((x) => `<li class="py-1.5 flex gap-3 items-center"><span class="flex-1 min-w-0">${esc(x.name)}${x.thisOne ? ' <span class="text-emerald-600">(this one)</span>' : ""}<span class="block text-xs text-slate-500">last ${esc(when(x.lastAt))} from ${esc(x.ip)} · first ${esc(when(x.firstAt))}</span></span>${x.thisOne ? "" : `<button data-forget="${esc(x.id)}" class="text-xs px-2.5 py-1 rounded-lg border border-slate-300">Forget</button>`}</li>`).join("") || '<li class="py-1.5 text-slate-500">None yet.</li>';
    $.all("[data-forget]").forEach((b) => (b.onclick = async () => (await api("/admin/devices/forget", { id: b.dataset.forget }), loadDevices())));
  }
  async function loadDisk() {
    const d = await api("/admin/disk").catch((err) => ({ error: err.message }));
    if (d.error) return ($("disk").textContent = d.error);
    $("disk").innerHTML = `<p>Jobs folder: ${mb(d.jobsBytes)}${d.free != null ? ` · ${mb(d.free)} free of ${mb(d.total)}` : ""}</p><p class="mt-1">${d.cleanable.length ? `Can free ${mb(d.cleanableBytes)} from ${d.cleanable.length} video${d.cleanable.length > 1 ? "s" : ""}: ${d.cleanable.slice(0, 8).map((j) => `${esc(j.label)} (${mb(j.bytes)})`).join(", ")}${d.cleanable.length > 8 ? "…" : ""}` : "Nothing to clean up right now."}</p>`;
    diskPlan = d.plan;
    const t = d.plan?.totals || {};
    const origs = (d.plan?.items || []).filter((i) => i.originalsBytes > 0);
    $("diskOrigRow").classList.toggle("hidden", !origs.length);
    $("diskOrigText").textContent = origs.length ? `Also remove ${origs.length} original video${origs.length > 1 ? "s" : ""} (${mb(t.originalsBytes)}): ${origs.slice(0, 6).map((i) => i.label).join(", ")}${origs.length > 6 ? "…" : ""}` : "";
    const ids = (d.plan?.items || []).map((i) => i.id);
    $("diskClean").disabled = !ids.length;
    $("diskClean").textContent = ids.length ? `Clean up ${mb(d.cleanableBytes)}` : "Clean up";
  }
  let diskPlan = null;
  $("diskClean").onclick = async () => {
    if (!(await timing.confirmBox({ title: "Clean up working files?", text: "The working files in the list are removed. Job records and thumbnails stay. Original videos are removed only if you ticked the box.", yes: "Clean up", no: "Cancel" }))) return;
    if (!(await askPassword(PW_WHY))) return;
    const wantOrig = $("diskOrig").checked;
    try { const r = await api("/admin/disk/cleanup", { ids: (diskPlan?.items || []).map((i) => i.id), originals: wantOrig }); $("diskClean").textContent = `Freed ${mb(r.bytes)}`; } catch (err) { $("diskClean").textContent = "Failed: " + err.message; }
    life.later(loadDisk, 3000);
  };
  let freePlan = null;
  const ticked = () => Array.from($.all("[data-fgroup]")).filter((c) => c.checked).map((c) => c.dataset.fgroup);
  function freeTotals() {
    const keys = ticked();
    const gs = (freePlan?.groups || []).filter((g) => keys.includes(g.key));
    const bytes = gs.reduce((s, g) => s + g.bytes, 0);
    $("freeTotal").textContent = freePlan ? `Safe: ${mb(freePlan.safeBytes)}. Needs your OK: ${mb(freePlan.totalBytes - freePlan.safeBytes)}. Ticked: ${mb(bytes)}.` : "";
    $("freeGo").disabled = !gs.length;
    $("freeGo").textContent = gs.length ? `Free up ${mb(bytes)}` : "Free up space";
  }
  async function loadFree() {
    const d = await api("/admin/free").catch((err) => ({ error: err.message }));
    if (d.error) return ($("free").textContent = d.error);
    freePlan = d;
    $("free").innerHTML = d.groups.map((g) => `<div class="py-2 border-t border-slate-100 first:border-0"><label class="flex items-start gap-2"><input type="checkbox" data-fgroup="${esc(g.key)}" ${g.items.length && g.selectable ? "" : "disabled"} ${g.items.length && g.selectable && !g.needsOk ? "checked" : ""}><span><b class="font-medium">${esc(g.title)}</b> · ${g.items.length} item${g.items.length === 1 ? "" : "s"} · ${mb(g.bytes)}${g.needsOk ? ' · <b class="font-medium">needs your OK</b>' : ""}${g.note ? `<span class="block text-xs text-slate-500">${esc(g.note)}</span>` : ""}${g.items.slice(0, 5).map((i) => `<span class="block text-xs text-slate-500">${esc(i.path)} (${mb(i.bytes)})</span>`).join("")}${g.items.length > 5 ? `<span class="block text-xs text-slate-500">and ${g.items.length - 5} more</span>` : ""}</span></label></div>`).join("");
    $.all("[data-fgroup]").forEach((c) => (c.onchange = freeTotals));
    freeTotals();
  }
  $("freeGo").onclick = async () => {
    const keys = ticked();
    const gs = (freePlan?.groups || []).filter((g) => keys.includes(g.key));
    const needsOk = gs.some((g) => g.needsOk);
    const text = `Removes: ${gs.map((g) => `${g.title} (${mb(g.bytes)})`).join("; ")}.${gs.some((g) => g.key === "jobs-originals") ? " Original videos are the only copy: they cannot be brought back." : ""}`;
    if (!(await timing.confirmBox({ title: "Free up space?", text, yes: "Free up", no: "Cancel" }))) return;
    if (!(await askPassword(PW_WHY))) return;
    try { const r = await api("/admin/free", { groups: keys, confirmOk: needsOk }); $("freeGo").textContent = `Freed ${mb(r.freedBytes)}`; } catch (err) { $("freeGo").textContent = "Failed: " + err.message; }
    life.later(loadFree, 3000);
  };
  async function loadDownloads() {
    const d = await api("/admin/downloads").catch(() => []);
    $("dlList").innerHTML = d.map((x) => `<li class="py-1.5 flex gap-3 items-center"><span class="flex-1 min-w-0">${esc(x.label)}<span class="block text-xs text-slate-500">${esc(x.name || "")}${x.bytes != null ? ` · ${x.bytes > 1048576 ? mb(x.bytes) : Math.max(1, Math.round(x.bytes / 1024)) + " KB"}` : ""}</span></span>${x.ready ? `<a href="/api/pipeline/admin/download/${esc(x.key)}" class="text-xs px-2.5 py-1 rounded-lg border border-slate-300">Download</a>` : '<span class="text-xs text-slate-500">not there yet</span>'}</li>`).join("");
  }
  async function loadVersions() {
    $("verList").innerHTML = '<li class="py-1.5 text-slate-500">Checking…</li>';
    const v = await api("/admin/versions").catch((err) => ({ error: err.message }));
    if (v.error) return ($("verList").innerHTML = `<li class="py-1.5 text-red-600">${esc(v.error)}</li>`);
    const sup = (x) => (x.supported === true ? `<span class="text-emerald-600">supported${x.eol ? ` until ${esc(x.eol)}` : ""}</span>${x.latest && x.latest !== x.version ? ` · newest ${esc(x.latest)} in this line` : " · up to date"}` : x.supported === false ? `<span class="text-red-600">out of support since ${esc(x.eol)}</span> · newest line is ${esc(x.newestCycle)}` : "");
    const row = (name, val, extra = "") => `<li class="py-1.5 flex gap-3"><span class="w-24 shrink-0 text-slate-500">${name}</span><span class="flex-1 min-w-0">${esc(val || "not found")}${extra ? ` <span class="block text-xs">${extra}</span>` : ""}</span></li>`;
    $("verList").innerHTML = row("App", `${v.app.version}${v.app.commit ? ` (${v.app.commit})` : ""}`) + row("Node", v.node.version, sup(v.node)) + row("Python", v.python.version, v.python.version ? sup(v.python) : "") + row("ffmpeg", v.ffmpeg.version) + row("Playwright", v.playwright.version);
  }
  async function loadHistory() {
    const h = await api("/admin/history").catch((err) => ({ error: err.message }));
    if (h.error) return ($("histList").innerHTML = `<p class="text-red-600">${esc(h.error)}</p>`);
    $("histNow").textContent = h.running ? `· running: ${h.running.title}` : "";
    const warn = h.unnoted.length ? `<div class="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-red-700">${h.unnoted.map((u) => `Started ${esc(when(u.at))} with code changes that have no note: ${esc([...(u.changed || []), ...(u.added || [])].slice(0, 8).join(", "))}`).join("<br>")}</div>` : "";
    const notes = h.notes.map((n) => `<li class="py-2"><div class="flex gap-2 items-baseline"><span class="font-medium flex-1">${esc(n.title)}</span><span class="text-xs text-slate-500">${esc(when(n.at))}</span></div><div class="text-xs ${n.ranAt ? "text-emerald-600" : "text-slate-500"}">${n.ranAt ? `First ran here ${esc(when(n.ranAt))}` : "No start logged with this one (before history began, or not restarted yet)"}</div><ul class="mt-1 list-disc pl-5 text-slate-600">${(n.changes || []).map((c) => `<li>${esc(c)}</li>`).join("")}</ul></li>`).join("");
    const ups = h.updates.length ? `<details class="mt-3"><summary class="cursor-pointer text-slate-500">App starts with code changes (${h.updates.length})</summary><ul class="mt-1 text-xs text-slate-600 space-y-1">${h.updates.map((u) => `<li>${esc(when(u.at))}: ${u.first ? "history started" : `${(u.changed || []).length} changed, ${(u.added || []).length} new, ${(u.removed || []).length} removed`}${u.note ? ` · ${esc(u.note)}` : ""}${u.changed?.length ? `<span class="block text-slate-500">${esc([...u.changed, ...(u.added || [])].join(", "))}</span>` : ""}</li>`).join("")}</ul></details>` : "";
    $("histList").innerHTML = warn + `<ul class="divide-y divide-slate-100">${notes}</ul>` + ups;
  }
  // Updates: the version, what is new and what the last update did load when the card opens; the one outside request is the button.
  async function loadUpdates() {
    const [a, h] = await Promise.all([api("/app").catch(() => null), api("/admin/history").catch(() => null)]);
    const k = a?.kit;
    $("updNow").textContent = k ? `· ${k.name} ${k.version || ""}` : "";
    $("updVer").innerHTML = k ? `<b>${esc(k.name)} ${esc(k.version || "(no version)")}</b>${k.commit ? ` · this folder is at commit ${esc(k.commit)}` : ""} · data format ${esc(k.format)}` : "Couldn't read the version.";
    const u = h?.lastUpdate;
    const short = (v) => esc(String(v || "?").slice(0, 12));
    $("updLast").textContent = "";
    if (!u) $("updLast").textContent = "No update has been run from this folder yet.";
    else $("updLast").innerHTML = `Last updated ${esc(when(u.at))}: ${u.fromVersion ? esc(u.fromVersion) : short(u.from)} to ${u.toVersion ? esc(u.toVersion) : short(u.to)} (${esc(u.mode)}).${u.failed ? " It failed and the old version was put back." : ""}${u.rolledBackAt ? ` Rolled back ${esc(when(u.rolledBackAt))}.` : ""}${u.backup ? ` Backup taken first: ${esc(u.backup)}` : ""}`;
    const n = h?.whatsNew?.notes || [];
    $("updNew").innerHTML = !h ? "Couldn't read the notes." : n.length ? `<ul class="space-y-2">${n.map((x) => `<li><span class="font-medium">${esc(x.title)}</span> <span class="text-xs text-slate-500">${esc(when(x.at))}</span><ul class="list-disc pl-5 text-slate-600">${(x.changes || []).slice(0, 4).map((c) => `<li>${esc(c)}</li>`).join("")}</ul></li>`).join("")}</ul>` : "<p class=\"text-slate-500\">Nothing new since this hub last started on a different version.</p>";
  }
  $("updBox").addEventListener("toggle", () => $("updBox").open && loadUpdates());
  $("updCheck").onclick = async () => {
    $("updCheck").disabled = true;
    $("updMsg").textContent = "Asking...";
    const r = await api("/admin/update-check").catch((err) => ({ ok: false, message: err.message }));
    $("updMsg").textContent = `${r.message || r.error || "No answer."}${r.cached ? ` (asked ${when(r.checkedAt)})` : ""}${r.newer ? " To update: close the hub and run npm run update." : ""}`;
    $("updCheck").disabled = false;
  };
  $("histBox").addEventListener("toggle", () => $("histBox").open && loadHistory());
  $("devBox").addEventListener("toggle", () => $("devBox").open && loadDevices());
  $("diskBox").addEventListener("toggle", () => $("diskBox").open && loadDisk());
  $("freeBox").addEventListener("toggle", () => $("freeBox").open && loadFree());
  $("dlBox").addEventListener("toggle", () => $("dlBox").open && loadDownloads());
  $("verBox").addEventListener("toggle", () => $("verBox").open && loadVersions());
  // AI helpers: the one switch and the daily limit (src/hub/helpers.js). Turning on or raising the limit asks for the password.
  async function loadHelpers() {
    const s = await api("/admin/helpers").catch(() => null);
    if (!s) { $("helpersMsg").textContent = "Couldn't read the AI helpers setting."; return; }
    $("helpersOn").checked = s.on;
    $("helpersOn").disabled = s.demo;
    $("helpersState").textContent = s.on ? "On" : "Off";
    $("helpersLimit").value = s.perDayUsd === null ? "" : s.perDayUsd;
    const spent = `$${(s.spentToday || 0).toFixed(2)}`;
    $("helpersSpent").textContent = `Helpers spent ${spent} today${s.perDayUsd === null ? " (no daily limit)" : ` of $${s.perDayUsd}${s.on && s.spentToday >= s.perDayUsd ? ": limit reached, helpers are paused until tomorrow" : ""}`}.${s.on ? "" : " The helpers are off, so they spend nothing."}`;
  }
  async function saveHelpers(body) {
    $("helpersMsg").textContent = "";
    try { await api("/admin/helpers", body, { password: true, why: "Turning AI helpers on, or raising their limit, lets the hub spend money by itself, so it needs your dashboard password." }); $("helpersMsg").textContent = "Saved."; }
    catch (err) { $("helpersMsg").textContent = err.cancelled ? "Not changed." : `Couldn't save it: ${err.message}`; }
    loadHelpers();
  }
  $("helpersOn").onchange = () => saveHelpers({ on: $("helpersOn").checked });
  $("helpersSave").onclick = () => { const v = $("helpersLimit").value.trim(); saveHelpers({ perDayUsd: v === "" ? null : Number(v) }); };
  // Pipeline AI budget: an optional monthly limit (src/hub/pipelinecap.js). A higher limit, or none, asks for the password.
  async function loadPipeCap() {
    const s = await api("/admin/pipeline-cap").catch(() => null);
    if (!s) { $("pipeCapMsg").textContent = "Couldn't read the pipeline AI budget."; return; }
    $("pipeCapLimit").value = s.capUsdMonth === null ? "" : s.capUsdMonth;
    $("pipeCapLimit").disabled = $("pipeCapSave").disabled = Boolean(s.demo);
    $("pipeCapSpent").textContent = `The pipeline spent $${(s.spentMonth || 0).toFixed(2)} this month${s.capUsdMonth === null ? " (no monthly limit)" : ` of $${s.capUsdMonth}${s.used ? ": the limit is used up, so pipeline steps wait as held until next month or a higher limit" : ""}`}.`;
  }
  $("pipeCapSave").onclick = async () => {
    $("pipeCapMsg").textContent = "";
    const v = $("pipeCapLimit").value.trim();
    try { await api("/admin/pipeline-cap", { capUsdMonth: v === "" ? null : Number(v) }, { password: true, why: "Raising the pipeline AI budget, or removing it, lets the hub spend more money by itself, so it needs your dashboard password." }); $("pipeCapMsg").textContent = "Saved."; }
    catch (err) { $("pipeCapMsg").textContent = err.cancelled ? "Not changed." : `Couldn't save it: ${err.message}`; }
    loadPipeCap();
  };
  // Refusal pass-off: the hub-wide switch (src/pipeline/refusal.js). Turning it on asks for the password; off does not.
  async function loadPassOff() {
    const s = await api("/admin/passoff").catch(() => null);
    if (!s) { $("passOffMsg").textContent = "Couldn't read the refusal pass-off setting."; return; }
    $("passOffOn").checked = s.on;
    $("passOffOn").disabled = s.demo;
    $("passOffState").textContent = s.on ? "On" : "Off";
  }
  $("passOffOn").onchange = async () => {
    $("passOffMsg").textContent = "";
    try { await api("/admin/passoff", { on: $("passOffOn").checked }, { password: true, why: "Turning refusal pass-off on lets the hub send a declined job to another AI service, which can spend money, so it needs your dashboard password." }); $("passOffMsg").textContent = "Saved."; }
    catch (err) { $("passOffMsg").textContent = err.cancelled ? "Not changed." : `Couldn't save it: ${err.message}`; }
    loadPassOff();
  };
  loadPause();
  loadStandby();
  loadHelpers();
  loadPipeCap();
  loadPassOff();
  loadFixes();
  loadParts();

  // Parts: on, off, or "not included in this kit" (a part whose required files are missing: src/hub/modules.js).
  async function loadParts() {
    try {
      const r = await fetch("/api/hub/settings");
      const parts = r.ok ? (await r.json()).parts || [] : [];
      const STATE = { on: "on", off: "off", "not-included": "not included in this kit" };
      $("partsList").innerHTML = parts.map((p) => `<li class="py-1.5 flex gap-2 ${p.state === "not-included" ? "text-slate-400" : ""}"><span class="flex-1 min-w-0">${esc(p.name)} <span class="text-xs text-slate-500">${esc(p.group)}</span></span><span>${STATE[p.state] || esc(p.state)}</span></li>`).join("");
      $("partsState").textContent = parts.length ? `· ${parts.filter((p) => p.state === "on").length} on, ${parts.filter((p) => p.state === "not-included").length} not included` : "";
    } catch {}
  }

  // Phone alerts (moved here from the Pipeline page).
  async function loadAlerts() {
    const s = await api("/notify");
    $("topic").textContent = s.topic;
    $("dashUrl").value = s.dashboardUrl || "";
    $.one('[data-alert="enabled"]').checked = s.enabled;
    const NAMES = { off: "Off", quiet: "Quiet", normal: "Normal", high: "High", urgent: "Urgent" };
    $("levels").innerHTML = (s.kinds || []).map((k) => `<label class="flex items-center gap-2 py-1.5"><span class="flex-1 min-w-0">${esc(k.label)}${k.level !== k.default ? "" : ' <span class="text-xs text-slate-500">(default)</span>'}</span>
      <select data-level="${k.kind}" class="rounded border border-slate-300 px-2 py-1 text-sm">${Object.keys(NAMES).filter((l) => !(k.noOff && l === "off")).map((l) => `<option value="${l}" ${l === k.level ? "selected" : ""}>${NAMES[l]}</option>`).join("")}</select></label>`).join("");
    $("alertState").textContent = s.enabled ? "· on" : "· off";
    $("alertSecNote").textContent = s.securityWhenOff ? "(sign-in alerts always come through)" : "(sign-in alerts follow this switch)";
  }
  $("copyTopic").onclick = () => navigator.clipboard?.writeText($("topic").textContent).then(() => ($("alertMsg").textContent = "Copied"), () => ($("alertMsg").textContent = "Select it and copy by hand"));
  $("saveAlerts").onclick = async () => {
    const box = (k) => $.one(`[data-alert="${k}"]`).checked;
    try {
      const levels = Object.fromEntries([...$.all("[data-level]")].map((x) => [x.dataset.level, x.value]));
      await api("/notify", { enabled: box("enabled"), levels, dashboardUrl: $("dashUrl").value }, { password: true, why: "The alert link is what every phone alert opens, so changing it needs your dashboard password." });
      $("alertMsg").textContent = "Saved";
      loadAlerts();
    } catch (err) {
      $("alertMsg").textContent = err.message;
    }
  };
  $("alertTest").onclick = async () => {
    $("alertMsg").textContent = "Sending…";
    try {
      await api("/notify/test", {});
      $("alertMsg").textContent = "Sent. Check your phone.";
    } catch (err) {
      $("alertMsg").textContent = "Failed: " + err.message;
    }
  };
  $("weekTest").onclick = async () => {
    $("alertMsg").textContent = "Sending…";
    try {
      const r = await api("/digest/send", {});
      $("alertMsg").textContent = `Sent (${r.lines.length} line${r.lines.length === 1 ? "" : "s"}). Check your phone.`;
    } catch (err) {
      $("alertMsg").textContent = "Failed: " + err.message;
    }
  };
  loadAlerts().catch(() => {});
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
