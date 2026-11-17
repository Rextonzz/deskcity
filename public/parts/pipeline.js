// Pipeline: the page's working part as a block (see public/parts/kit.js). Mounted by public/pipeline.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, api as call, askPassword as ask, confirmBox } from "/lib.js";
import { scope, lifecycle, needScripts } from "/parts/kit.js";
import { channels as CHANNELS, chName, chOfLayout } from "/hubinfo.js";
// The channels that use the pack-by-pack layout (cards in each video) and the clip layout; their ids come from the settings.
const PACKS = chOfLayout("packs"), CLIPS = chOfLayout("clips");
const isPacks = (j) => !!PACKS.id && j.channel === PACKS.id;

// ONE action layer (the contract in parts/kit.js): this block's own buttons, the queue board in the YouTube building
// (campus/props.js) and Neural all call these, never copies. Anything that can post is checked by the hub's own
// password rule (requirePasswordConfirmed); call() asks for the password when the hub says so.
const PW_WHY_ACTIONS = "This can post to a live channel or spend on AI, so it needs your dashboard password.";
const send = (path, body = {}) => call(path, body, { password: true, why: PW_WHY_ACTIONS });
export const ACTIONS = {
  retry: { label: "Retry the step", words: ["retry", "again", "rerun", "stuck"], run: (id) => send(`/jobs/${id}/retry`) },
  restart: { label: "Start it over", words: ["restart", "start over", "redo", "from scratch"], ask: { title: "Start this video over?", text: "Every step runs again from the beginning, and your answers on this job are cleared. The original file is kept.", yes: "Start over", no: "Cancel" }, run: (id) => send(`/jobs/${id}/restart`) },
  skip: { label: "Skip this video", words: ["skip", "drop", "remove"], ask: { title: "Skip this video?", text: "It leaves the queue. Pipeline can bring it back (Unskip).", yes: "Skip", no: "Cancel" }, run: (id) => send(`/jobs/${id}/skip`) },
  publishNow: { label: "Make public now", words: ["publish", "post", "public", "live", "now"], needsPassword: true, run: (id) => send(`/jobs/${id}/publish`, { when: "now" }) },
  publishSlot: { label: "Schedule for the next slot", words: ["schedule", "slot", "book", "later", "publish"], needsPassword: true, run: (id) => send(`/jobs/${id}/publish`, { when: "slot" }) },
};
// What a video on the board offers, by its state (src/pipeline/glance.js). Every one also offers "Open its card".
// A held video's answers are typed on its card, so the card is how you approve it.
export const ITEM_ACTIONS = { you: [], private: ["publishNow", "publishSlot"], stuck: ["retry", "restart", "skip"], up: [], making: [], wait: ["skip"], set: [] };

export const html = `<section class="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
  <h2 class="font-semibold">Add a video</h2>
  <div class="flex gap-2 flex-wrap items-center">
    <select id="upChannel" class="rounded-lg border border-slate-300 px-3 py-2.5 text-base">
      ${CHANNELS.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("\n      ")}
    </select>
    <label class="flex-1 min-w-[10rem] text-center cursor-pointer bg-red-600 hover:bg-red-700 text-white font-medium px-4 py-2.5 rounded-lg">
      Choose video…
      <input id="upFile" type="file" accept="video/*" class="hidden" />
    </label>
  </div>
  <label class="flex items-center gap-2 text-sm text-slate-600"><input id="upTest" type="checkbox" /> Test run: do every step but don't post or touch the trackers</label>
  <div id="upStatus" class="hidden text-sm space-y-1">
    <div class="flex justify-between gap-2"><span id="upName" class="truncate"></span><span id="upPct"></span></div>
    <div class="h-2 rounded bg-slate-100 overflow-hidden"><div id="upBar" class="h-full bg-red-600 w-0"></div></div>
  </div>
</section>


<section id="channels" class="grid gap-4 sm:grid-cols-2"></section>

<details id="ttCatch" class="hidden bg-white rounded-xl border border-slate-200 p-4">
  <summary class="font-semibold cursor-pointer">TikTok catch-up <span id="ttCount" class="text-sm font-normal text-slate-500"></span></summary>
  <div id="ttList" class="mt-3 space-y-4 text-sm"></div>
</details>


<section>
  <div class="flex items-center gap-2 mb-3 flex-wrap">
    <h2 class="font-semibold">Jobs</h2>
    <span id="counts" class="text-sm text-slate-500 flex-1"></span>
    <button id="clearSkipped" class="hidden text-sm px-3 py-1.5 rounded-lg border border-slate-300"></button>
  </div>
  <div id="pauseBar" class="hidden mb-3 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm flex items-center gap-3 flex-wrap"><span class="flex-1 min-w-0">The pipeline is paused: no new job starts. Scheduled videos still go public on time.</span><button id="resume" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Resume</button></div>
  <div id="batchBar" class="hidden mb-3 rounded-xl bg-sky-50 border border-sky-200 p-3 text-sm flex items-center gap-3 flex-wrap"><span id="batchText" class="flex-1 min-w-0"></span><button id="batchPush" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Push batch now</button></div>
  <div id="jobs" class="space-y-3"></div>
  <p id="empty" class="hidden text-sm text-slate-500 bg-white border border-dashed border-slate-300 rounded-xl p-6 text-center">No jobs yet. Drop a video into an inbox folder.</p>
</section>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "pipeline";
  const $ = scope(root), life = lifecycle();
  await needScripts(["/timing.js"]);
  const STATUS = {
    queued: ["Queued", "bg-slate-100 text-slate-700"],
    running: ["Working", "bg-blue-100 text-blue-800"],
    held: ["Needs you", "bg-amber-100 text-amber-900"],
    failed: ["Failed", "bg-red-100 text-red-800"],
    private: ["Uploaded private", "bg-violet-100 text-violet-800"],
    scheduled: ["Scheduled", "bg-emerald-100 text-emerald-800"],
    published: ["Published", "bg-emerald-600 text-white"],
    skipped: ["Skipped", "bg-slate-200 text-slate-500"],
    split: ["Cut into one per pack", "bg-slate-200 text-slate-600"],
    done: ["Done", "bg-slate-100 text-slate-700"],
    tested: ["Test run done", "bg-sky-100 text-sky-800"],
    publishing: ["Making public…", "bg-blue-100 text-blue-800"],
  };
  const open = new Set();
  let focus = opts.focus || null; // a job to open and scroll to (from the queue board)
  if (focus) open.add(focus);
  const drafts = new Map(); // "jobId:key" -> what the owner typed in a hold box, kept across redraws
  let editing = null; // job id whose review box is being edited; skip re-render while typing

  // Password check for actions that can post publicly: the hub says when it wants one.
  const PW_WHY = "This can post to a live channel, so it needs your dashboard password.";
  const api = (path, body) => call(path, body, { password: true, why: PW_WHY });

  // Live on YouTube, not on TikTok yet: app videos get a Post button.
  async function loadTikTok() {
    const d = await api("/tiktok/catchup").catch(() => null);
    const n = d ? d.jobs.length : 0;
    $("ttCatch").classList.toggle("hidden", !n);
    if (!n) return;
    $("ttCount").textContent = `${n} live on YouTube, not on TikTok`;
    const name = (c) => channelInfo[c]?.name || c;
    const yt = (v) => `<a class="text-red-700 hover:underline" target="_blank" href="https://youtube.com/shorts/${esc(v)}">YouTube</a>`;
    const jobRow = (j) => `<li class="flex items-center gap-2 flex-wrap"><span class="flex-1 min-w-0">${esc(j.title || j.videoId)} <span class="text-slate-500">· ${esc(name(j.channel))} · ${yt(j.videoId)}</span>${j.error ? `<span class="block text-xs text-red-700">Last try: ${esc(j.error)}</span>` : ""}</span>${j.status === "waiting" ? `<span class="text-slate-500">Posting…</span>` : j.hasFile ? `<button data-ttpost="${esc(j.id)}" class="px-3 py-1.5 rounded-lg bg-red-600 text-white">Post to TikTok</button>` : `<span class="text-slate-500">File gone from the PC</span>`}</li>`;
    $("ttList").innerHTML = `<div><div class="font-medium mb-1">Made by the app</div><ul class="space-y-2">${d.jobs.map(jobRow).join("")}</ul></div>`;
    $.all("[data-ttpost]").forEach((b) => (b.onclick = async () => {
      try { b.disabled = true; b.textContent = "Starting…"; await api(`/jobs/${b.dataset.ttpost}/tiktok`, {}); loadTikTok(); }
      catch (err) { b.disabled = false; b.textContent = "Post to TikTok"; if (!err.cancelled) await confirmBox({ title: "", text: err.message, no: null }); }
    }));
  }

  let channelInfo = {};
  async function loadChannels() {
    const chs = await api("/channels");
    channelInfo = chs;
    $("channels").innerHTML = Object.entries(chs).map(([id, c]) => `
      <div class="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
        <div class="flex-1 min-w-0">
          <div class="font-semibold">${esc(c.name)}</div>
          <div class="text-sm text-slate-500">${c.live ? `Live: ${c.postingMode === "schedule" ? "schedules into the next slot" : "publishes immediately"}` : "Test mode: uploads stay private"}</div>
        </div>
        <button data-live="${id}" data-on="${c.live}" class="text-sm px-3 py-1.5 rounded-lg border ${c.live ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white hover:bg-slate-50"}">${c.live ? "Live" : "Go live…"}</button>
      </div>`).join("");
    // Two taps instead of confirm(): some phone browsers silently block confirm popups.
    $.all("[data-live]").forEach((b) => (b.onclick = async () => {
      const on = b.dataset.on !== "true";
      if (!b.dataset.armed) {
        b.dataset.armed = "1";
        b.textContent = on ? "Tap again: post publicly" : "Tap again: back to test mode";
        b.classList.add("border-amber-500", "bg-amber-50");
        life.later(() => loadChannels(), 6000);
        return;
      }
      try {
        await api(`/channels/${b.dataset.live}/live`, { live: on });
      } catch (err) {
        b.textContent = err.cancelled ? "Cancelled" : "Failed: " + err.message;
        life.later(() => loadChannels(), 3000);
        return;
      }
      loadChannels();
    }));
  }

  function jobCard(j) {
    const [label, cls] = STATUS[j.status] || [j.status, "bg-slate-100"];
    const isOpen = open.has(j.id) || j.status === "held";
    const when = j.publishAt ? new Date(j.publishAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    return `
    <article class="bg-white rounded-xl border ${j.status === "held" ? "border-amber-300" : "border-slate-200"}">
      <button data-toggle="${esc(j.id)}" class="w-full text-left p-4 flex items-start gap-3">
        <span class="shrink-0 text-xs font-medium px-2 py-1 rounded ${cls}">${label}</span>
        <span class="flex-1 min-w-0">
          <span class="block font-medium truncate">${esc(j.title || j.sourceName)}</span>
          <span class="block text-sm text-slate-500 truncate">${esc(chName(j.channel))} · ${esc(j.sourceName)}${j.episode ? ` · Ep ${j.episode}` : ""}${when ? ` · ${when}` : ""}</span>${j.status === "running" ? `<span class="block text-sm text-slate-600 truncate">${esc(runLine(j))}</span>` : ""}${j.queue ? `<span class="block text-sm text-slate-600">${esc(queueLine(j.queue))}</span>` : ""}
        </span>
      </button>
      ${isOpen ? jobBody(j) : ""}
    </article>`;
  }

  const STEP = { intake: "Reading the file", locate: "Finding the pack", readCards: "Reading the cards", price: "Pricing cards", render: "Making the video", checkRender: "Checking the video", package: "Writing title and description", trackRender: "Updating the tracker", audit: "Final check", upload: "Uploading to YouTube", trackUpload: "Updating the tracker", review: "Reviewing the clip", plan: "Planning the edit", edit: "Editing", checkEdit: "Checking the edit", logUpload: "Updating the upload log" };
  function queueLine(q) {
    let ahead = q.ahead ? `${q.ahead} ahead of it` : "next in line";
    if (!q.busy) return `In line: ${ahead}, starting in a moment`;
    if (q.batch) ahead += ", half-price batch";
    return `In line: ${ahead}. The PC is on ${q.busy.label}${q.busy.batch ? ", waiting for its half-price batch answer (open that card to run it now at full price)" : ""}.`;
  }
  function runLine(j) {
    const p = j.progress;
    const step = STEP[j.stage] || j.stage || "Starting";
    if (!p) return step;
    if (j.batchWaiting) return `Step ${p.step} of ${p.steps}: ${step} · waiting for the half-price batch answer (${timing.dur(p.stageMs)} so far; usually minutes, at most a day)`;
    return `Step ${p.step} of ${p.steps}: ${step} · ${timing.dur(p.stageMs)} on this step${p.leftMs != null ? ` · ${timing.left(p.leftMs)} for the whole job` : ""}`;
  }

  function jobBody(j) {
    const parts = [];
    if (j.hold) {
      parts.push(`<div class="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm space-y-2">
        <p class="font-medium text-amber-900">${esc(j.hold.reason)}</p>
        ${j.hold.points?.length ? `<ul class="space-y-1">${j.hold.points.map((p) => `<li><details><summary class="cursor-pointer text-amber-900">${esc(p.what)}</summary><p class="mt-1 ml-4 text-xs text-slate-500">${esc(p.detail)}</p></details></li>`).join("")}</ul><p class="text-xs text-slate-500">Tap a line for where it is and how to fix it.</p>` : ""}
        ${j.hold.images?.length ? `<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${j.hold.images.map((f) => `<a href="/api/pipeline/jobs/${esc(j.id)}/files/${esc(f)}" target="_blank" rel="noopener"><img src="/api/pipeline/jobs/${esc(j.id)}/files/${esc(f)}" alt="Frame from the video" loading="lazy" class="w-full rounded border border-amber-200" /></a>`).join("")}</div><p class="text-xs text-slate-500">Tap a frame to see it full size.</p>` : ""}
        ${j.hold.fields?.length ? holdFields(j) : ""}
        ${j.hold.review && !j.hold.review.continueAnyway ? (j.hold.fields?.length && j.hold.stage !== "audit" ? `<details class="text-xs"><summary class="cursor-pointer text-slate-500">Everything it found (advanced)</summary><pre class="mt-1 whitespace-pre-wrap font-mono text-xs rounded border border-amber-300 p-2 max-h-64 overflow-auto">${esc(JSON.stringify(j.hold.review, null, 2))}</pre></details>` : `<textarea data-review="${esc(j.id)}" rows="10" class="w-full font-mono text-xs rounded border border-amber-300 p-2">${esc(JSON.stringify(j.hold.review, null, 2))}</textarea>`) : ""}
        <div class="flex gap-2 flex-wrap">
          ${j.hold.review || j.hold.fields?.length ? `<button data-act="continue" data-id="${esc(j.id)}" class="px-3 py-1.5 rounded-lg bg-amber-600 text-white">Continue</button>` : ""}
          <button data-act="retry" data-id="${esc(j.id)}" data-ms="${j.progress?.leftMs ?? ""}" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Retry step${j.progress?.leftMs ? ` · ${timing.est(j.progress.leftMs)}` : ""}</button>
          <button data-act="restart" data-id="${esc(j.id)}" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Start over</button>
          <button data-act="skip" data-id="${esc(j.id)}" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Skip video</button>
        </div></div>`);
    }
    if (j.error) {
      parts.push(`<div class="rounded-lg bg-red-50 border border-red-200 p-3 text-sm space-y-2">
        <p class="text-red-800"><b>${esc(j.error.stage)}:</b> ${esc(j.error.message)}</p>
        ${(j.shots || []).map((f) => `<a href="/api/pipeline/jobs/${esc(j.id)}/files/${esc(encodeURIComponent(f))}" target="_blank" rel="noopener" class="block"><img src="/api/pipeline/jobs/${esc(j.id)}/files/${esc(encodeURIComponent(f))}" alt="What Studio showed" class="w-full max-w-md rounded border border-red-200" loading="lazy" /><span class="text-xs text-slate-500">What Studio showed when it failed (tap to enlarge)</span></a>`).join("")}
        ${j.status === "failed" ? `<div class="flex gap-2"><button data-act="retry" data-id="${esc(j.id)}" data-ms="${j.progress?.leftMs ?? ""}" class="px-3 py-1.5 rounded-lg bg-red-600 text-white">Retry${j.progress?.leftMs ? ` · ${timing.est(j.progress.leftMs)}` : ""}</button>
        ${j.stage === "upload" ? `<button data-act="in-studio" data-id="${esc(j.id)}" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white">It's in Studio</button>` : ""}
        <button data-act="skip" data-id="${esc(j.id)}" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Skip video</button></div>` : ""}</div>`);
    }
    if (j.batchWaiting) parts.push(`<div class="rounded-lg bg-sky-50 border border-sky-200 p-3 text-sm space-y-2"><div>Waiting for the half-price batch answer. It usually comes in minutes, at most a day, and other jobs wait behind it.</div><button data-act="full-price" data-id="${esc(j.id)}" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Run it now at full price</button></div>`);
    if (j.flags?.length) parts.push(`<ul class="text-sm text-amber-800 list-disc pl-5">${j.flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`);
    const meta = [];
    if (j.title) meta.push(row("Title", j.title));
    if (j.description) meta.push(row("Description", j.description));
    if (j.tags) meta.push(row("Tags", j.tags.join(", ")));
    if (j.pinned && j.pinnedComment) meta.push(row("Pinned comment", j.pinnedComment));
    if (j.tiktok) meta.push(row("TikTok caption", j.tiktok));
    if (j.cards && !isPacks(j)) meta.push(row("Cards", j.cards.map((c) => `${c.name}${c.foil === "foil" ? " (foil)" : ""} $${c.price?.toFixed(2)}`).join(", ")));
    if (j.videoId) meta.push(row("Video", `<a class="text-red-700 hover:underline" target="_blank" href="https://studio.youtube.com/video/${esc(j.videoId)}/edit">${esc(j.videoId)}</a>`, true));
    if (j.tiktokPost) {
      const t = j.tiktokPost, who = t.privacy === "private" ? "Only you" : "Everyone";
      const text = t.status === "posted" ? `Posted (${who})${t.url ? ` <a class="text-red-700 hover:underline" target="_blank" href="${esc(t.url)}">open</a>` : ""}`
        : t.status === "failed" ? `Didn't post: ${esc(t.error || "")}${(j.shots || []).includes("tiktok-error.png") ? ` <a class="text-red-700 hover:underline" target="_blank" href="/api/pipeline/jobs/${esc(j.id)}/files/tiktok-error.png">what TikTok showed</a>` : ""} <button data-act="tiktok" data-id="${esc(j.id)}" class="ml-1 px-2 py-0.5 rounded border border-slate-300 bg-white">Try again</button>`
        : t.status === "held" ? `Held: not posted to TikTok (${esc(t.why || "gambling topic")}). YouTube is not affected. <button data-act="tiktok" data-id="${esc(j.id)}" class="ml-1 px-2 py-0.5 rounded border border-slate-300 bg-white">Post to TikTok anyway</button>`
        : t.privacy === "private" ? "Posting as Only you next" : `Posts (${who}) once it's live on YouTube${t.error ? `. Last try failed: ${esc(t.error)}` : ""}`;
      meta.push(row("TikTok", text, true));
    }
    if (meta.length) parts.push(`<dl class="grid gap-2 text-sm">${meta.join("")}</dl>`);
    if (j.cards && isPacks(j)) parts.push(cardGrid(j));
    if (isPacks(j) && ["scheduled", "private"].includes(j.status)) parts.push(`<div class="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm space-y-2"><div>Wrong episode number, total or pack cost? Set this video to Private in YouTube Studio first, then re-make it: it re-renders with the right number, series total and the pack cost from your price list (same cards and card prices) and uploads a new video.</div><button data-act="remake" data-id="${esc(j.id)}" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Re-make with the right number</button></div>`);
    const pinFail = (j.flags || []).find((f) => f.startsWith("Pinning the comment failed"));
    if (pinFail && ["published", "scheduled"].includes(j.status)) parts.push(`<div class="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm space-y-2"><div>${j.pinPending ? "Pinning the comment again: it runs within a minute or two." : "The pinned comment didn't go through. Pin again uses the comment already on the video when it's from this channel, so it won't post a second copy. If the comment there is from the wrong channel, delete it on YouTube first."}</div>${j.pinPending ? "" : `<button data-act="pin" data-id="${esc(j.id)}" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Pin again</button>`}</div>`);
    if (j.status === "private" && j.videoId) parts.push(`<div class="rounded-lg bg-violet-50 border border-violet-200 p-3 text-sm space-y-2"><div>This one is private on YouTube. Post it:</div><div class="flex gap-2 flex-wrap"><button data-act="publish" data-when="now" data-id="${esc(j.id)}" class="px-3 py-1.5 rounded-lg bg-red-600 text-white">Make public now</button><button data-act="publish" data-when="slot" data-id="${esc(j.id)}" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Schedule next slot</button></div></div>`);
    if (j.hasOutput) parts.push(`<video controls preload="none" class="w-full max-w-xs rounded-lg bg-black" src="/api/pipeline/jobs/${esc(j.id)}/video"></video>`);
    parts.push(feedbackBox(j));
    parts.push(`<details class="text-xs text-slate-500"><summary class="cursor-pointer">Log</summary><ul class="mt-1 space-y-0.5">${j.log.map((l) => `<li><span class="text-slate-400">${new Date(l.at).toLocaleTimeString()}</span> ${esc(l.message)}</li>`).join("")}</ul></details>`);
    return `<div class="px-4 pb-4 space-y-3">${parts.join("")}</div>`;
  }

  // Boxes to answer a hold right here (MSRP, episode, set, prices, which way to turn the video).
  function holdFields(j) {
    const box = "rounded border border-amber-300 px-2 py-1.5 text-sm w-full";
    return `<div class="grid gap-2 sm:grid-cols-2" data-fields="${esc(j.id)}">${j.hold.fields.map((field) => {
      const d = drafts.get(`${esc(j.id)}:${field.key}`);
      const f = d === undefined ? field : { ...field, value: d };
      const id = `f-${esc(j.id)}-${f.key}`;
      const photo = f.photo ? `<img src="/api/pipeline/jobs/${esc(j.id)}/cards/c${f.photo}a.jpg" alt="" class="w-12 h-16 object-cover rounded shrink-0" loading="lazy" onerror="this.remove()" />` : "";
      if (f.type === "checkbox") return `<label class="sm:col-span-2 flex items-start gap-2"><input type="checkbox" data-key="${esc(f.key)}" ${f.value ? "checked" : ""} class="mt-1" /> <span>${esc(f.label)}</span></label>`;
      if (f.type === "textarea") return `<label class="block sm:col-span-2" for="${id}"><span class="block text-xs text-amber-900 mb-0.5">${esc(f.label)}</span><textarea id="${id}" data-key="${esc(f.key)}" rows="3" class="${box}">${esc(f.value ?? "")}</textarea></label>`;
      const input = f.type === "select"
        ? `<select id="${id}" data-key="${esc(f.key)}" class="${box}">${f.options.map((o) => { const v = o.value ?? o; return `<option value="${esc(v)}" ${v === f.value ? "selected" : ""}>${esc(o.label ?? o)}</option>`; }).join("")}</select>`
        : `<input id="${id}" data-key="${esc(f.key)}" type="${f.type === "number" ? "number" : "text"}" ${f.type === "number" ? `inputmode="decimal" step="${f.step ?? "any"}"${f.min != null ? ` min="${f.min}"` : ""}` : ""} value="${esc(f.value ?? "")}" class="${box}" />`;
      return `<div class="flex gap-2 items-end">${photo}<label class="block flex-1 min-w-0" for="${id}"><span class="block text-xs text-amber-900 mb-0.5">${esc(f.label)}${f.required || f.quiet ? "" : ' <span class="text-slate-500">(optional)</span>'}</span>${input}</label></div>`;
    }).join("")}</div>`;
  }

  // Card photos with what the reader decided, numbered like the review box. Tap a photo for the second frame.
  function cardGrid(j) {
    const src = (c, f) => `/api/pipeline/jobs/${esc(j.id)}/cards/c${c.index}${f}.jpg`;
    return `<div><div class="text-sm text-slate-500 mb-1">Cards</div><div class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">${j.cards.map((c) => `
      <a href="${src(c, "b")}" target="_blank" class="block rounded-lg border ${c.unsure ? "border-amber-400 bg-amber-50" : "border-slate-200"} overflow-hidden text-xs">
        <img loading="lazy" src="${src(c, "a")}" alt="" class="w-full aspect-[3/4] object-cover bg-slate-100" onerror="this.style.display='none'" />
        <div class="p-1.5"><b>#${c.index}</b> ${esc(c.name)}${c.foil === "foil" ? " <span class=\"text-violet-700\">foil</span>" : ""}<div class="text-slate-500">${c.number ? "#" + esc(c.number) + " · " : ""}${c.price != null ? "$" + c.price.toFixed(2) : ""}</div></div>
      </a>`).join("")}</div></div>`;
  }

  const row = (k, v, html) => `<div class="sm:grid sm:grid-cols-[9rem_1fr] gap-2"><dt class="text-slate-500">${k}</dt><dd class="whitespace-pre-wrap break-words">${html ? v : esc(v)}</dd></div>`;

  $("resume").onclick = async () => (await api("/admin/pause", { paused: false }), loadJobs());
  $("clearSkipped").onclick = async () => {
    if (!(await timing.confirmBox({ title: "Clear skipped jobs?", text: "They leave this list. Nothing is deleted: each one moves to data\\jobs-archive on the PC.", yes: "Clear them", no: "Cancel" }))) return;
    try { await api("/jobs/clear-skipped", {}); } catch (err) { await confirmBox({ title: "", text: err.message, no: null }); }
    loadJobs();
  };
  $("batchPush").onclick = async () => {
    $("batchPush").textContent = "Pushing…";
    try { await send("/batch/push", {}); } catch (err) { await confirmBox({ title: "", text: err.message, no: null }); }
    $("batchPush").textContent = "Push batch now";
    loadJobs();
  };
  // Feedback on any job, whatever its state: which part, then plain words. It feeds that step's AI and the rules review.
  const FB_PARTS = {
    [CLIPS.id]: [["review", "Who's in it and who's talking"], ["plan", "Where it starts and ends"], ["edit", "Layout and captions"], ["checkEdit", "The edit check"], ["package", "Title, description, tags"], ["upload", "Upload and schedule"]],
    [PACKS.id]: [["locate", "Set, pack and footage"], ["readCards", "Card names"], ["price", "Card prices"], ["render", "The video (text, layout, numbers)"], ["checkRender", "The render check"], ["package", "Title, description, tags"], ["upload", "Upload and schedule"]],
  };
  const fbOpen = new Set();
  function feedbackBox(j) {
    const parts = [...(FB_PARTS[j.channel] || []), ["other", "Something else"]];
    const pick = drafts.get(`fb:${esc(j.id)}:stage`) ?? (parts.some(([k]) => k === j.stage) ? j.stage : parts[0][0]);
    return `<details class="text-xs" data-fb="${esc(j.id)}" ${fbOpen.has(j.id) ? "open" : ""}><summary class="cursor-pointer text-slate-500">Give feedback</summary>
      <div class="mt-2 space-y-2">
        <label class="block"><span class="block text-slate-500 mb-0.5">Which part?</span><select data-fb-stage class="w-full rounded border border-slate-300 p-1.5">${parts.map(([k, l]) => `<option value="${k}" ${k === pick ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
        <textarea data-fb-text rows="3" class="w-full rounded border border-slate-300 p-2" placeholder="What was wrong, or what would be better? Plain words are fine.">${esc(drafts.get(`fb:${esc(j.id)}:text`) ?? "")}</textarea>
        <button data-fb-send="${esc(j.id)}" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white">Send feedback</button>
      </div></details>`;
  }

  async function loadJobs() {
    if (editing) return;
    // Redrawing the list would restart a video you're watching, so hold off until it's finished.
    if ([...$.all("#jobs video")].some((v) => !v.paused || (v.currentTime > 0 && !v.ended))) return;
    const jobs = await api("/jobs");
    const held = jobs.filter((j) => j.status === "held").length;
    $("counts").textContent = held ? `${held} waiting on you` : "";
    const skipped = jobs.filter((j) => j.status === "skipped").length;
    $("clearSkipped").classList.toggle("hidden", !skipped);
    $("clearSkipped").textContent = `Clear skipped (${skipped})`;
    $("empty").classList.toggle("hidden", jobs.length > 0);
    $("jobs").innerHTML = jobs.map(jobCard).join("");
    if (focus) { $.one(`[data-toggle="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: "start" }); focus = null; }
    api("/admin/pause").then((p) => $("pauseBar").classList.toggle("hidden", !p.paused)).catch(() => {});
    const batched = jobs.filter((j) => j.batchWaiting || j.queue?.batch).length;
    $("batchBar").classList.toggle("hidden", !batched);
    $("batchText").textContent = `${batched} job${batched === 1 ? " is" : "s are"} on the half-price batch. Push to run ${batched === 1 ? "it" : "them"} now at full price.`;
    $.all("[data-toggle]").forEach((b) => (b.onclick = () => {
      open.has(b.dataset.toggle) ? open.delete(b.dataset.toggle) : open.add(b.dataset.toggle);
      loadJobs();
    }));
    $.all("[data-review], [data-fields] [data-key]").forEach((t) => {
      t.onfocus = () => (editing = t.dataset.review || t.closest("[data-fields]").dataset.fields);
      t.onblur = () => life.later(() => (editing = null), 300);
      if (t.dataset.key) t.oninput = t.onchange = () => drafts.set(`${t.closest("[data-fields]").dataset.fields}:${t.dataset.key}`, t.type === "checkbox" ? t.checked : t.value);
    });
    $.all("[data-fb]").forEach((d) => {
      const id = d.dataset.fb;
      d.ontoggle = () => (d.open ? fbOpen.add(id) : fbOpen.delete(id));
      d.querySelectorAll("textarea, select").forEach((t) => {
        t.onfocus = () => (editing = id);
        t.onblur = () => life.later(() => (editing = null), 300);
        t.oninput = t.onchange = () => drafts.set(`fb:${id}:${t.matches("select") ? "stage" : "text"}`, t.value);
      });
      d.querySelector("[data-fb-send]").onclick = async () => {
        try {
          await api(`/jobs/${id}/feedback`, { stage: d.querySelector("[data-fb-stage]").value, text: d.querySelector("[data-fb-text]").value });
          drafts.delete(`fb:${id}:text`);
          fbOpen.delete(id);
          editing = null;
          await confirmBox({ title: "", text: "Thanks, saved. That step will learn from it on the next videos.", no: null });
          loadJobs();
        } catch (err) {
          await confirmBox({ title: "", text: err.message, no: null });
        }
      };
    });
    $.all("[data-act]").forEach((b) => (b.onclick = async () => {
      const id = b.dataset.id;
      try {
        if (b.dataset.act === "retry" && !(await timing.confirmLong({ ms: b.dataset.ms ? Number(b.dataset.ms) : null, what: "This retry" }))) return;
        if (b.dataset.act === "remake" && !(await timing.confirmBox({ title: "Re-make this video?", text: "Did you set the old one to Private in YouTube Studio? The pipeline won't touch it. A new video is made and scheduled into the next free slot, and the tracker drops the old one.", yes: "Re-make", no: "Cancel" }))) return;
        if (b.dataset.act === "restart" && !(await timing.confirmBox({ title: "Start this video over?", text: "Every step runs again from the beginning, and your answers on this job are cleared. The original file is kept.", yes: "Start over", no: "Cancel" }))) return;
        if (b.dataset.act === "continue") {
          const fields = $.one(`[data-fields="${id}"]`);
          if (fields) {
            const answers = {};
            fields.querySelectorAll("[data-key]").forEach((el) => (answers[el.dataset.key] = el.type === "checkbox" ? el.checked : el.value));
            // The final review has both: the boxes and the editable title and description.
            const box = $.one(`[data-review="${id}"]`);
            await send(`/jobs/${id}/continue`, { answers, review: box ? JSON.parse(box.value) : undefined });
          } else {
            const box = $.one(`[data-review="${id}"]`);
            await send(`/jobs/${id}/continue`, { review: box ? JSON.parse(box.value) : undefined });
          }
        } else if (b.dataset.act === "in-studio") {
          if (!(await timing.confirmBox({ title: "Is it saved in Studio?", text: "Use this when the upload failed here but the video shows in YouTube Studio as Scheduled (not Draft). The app finds it on Studio's Shorts list by its title, records it, and carries on with the upload log and tracking. It doesn't upload again.", yes: "Find it", no: "Cancel" }))) return;
          b.textContent = "Looking in Studio…";
          b.disabled = true;
          await api(`/jobs/${id}/in-studio`, {});
        } else if (b.dataset.act === "publish") {
          b.textContent = "Starting…";
          await ACTIONS[b.dataset.when === "slot" ? "publishSlot" : "publishNow"].run(id);
        } else if (ACTIONS[b.dataset.act]) await ACTIONS[b.dataset.act].run(id);
        else await send(`/jobs/${id}/${b.dataset.act}`, {}); // unskip, full price, remake: they spend, so they take the password
        editing = null;
        loadJobs();
      } catch (err) {
        if (!err.cancelled) await confirmBox({ title: "", text: err.message, no: null });
      }
    }));
  }

  // Upload from the phone (or any browser): streams the file to the chosen inbox with a progress bar.
  $("upFile").onchange = async () => {
    const file = $("upFile").files[0];
    if (!file) return;
    // Every upload starts paid AI steps (and a live channel can post it publicly): confirm the password before sending gigabytes.
    const test = $("upTest").checked;
    if (!(await ask(test || !channelInfo[$("upChannel").value]?.live ? "A new video runs the AI steps, which spend money, so it needs your dashboard password." : PW_WHY))) {
      $("upFile").value = "";
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/pipeline/upload/${$("upChannel").value}?name=${encodeURIComponent(file.name)}${test ? "&test=1" : ""}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    $("upStatus").classList.remove("hidden");
    $("upName").textContent = file.name;
    $("upBar").style.width = "0";
    const sentAt = Date.now();
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      const ms = Date.now() - sentAt;
      $("upBar").style.width = pct + "%";
      $("upPct").textContent = `${pct}% · ${(e.loaded / 1048576 / Math.max(ms / 1000, 0.1)).toFixed(1)} MB/s · ${timing.progressText({ elapsedMs: ms, done: e.loaded, total: e.total })}`;
    };
    xhr.onload = () => {
      if (xhr.status === 401) return (location.href = "/login?next=/pipeline.html");
      const ok = xhr.status === 200;
      let msg = `error ${xhr.status}`;
      try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
      if (xhr.status === 404 && !/Unknown channel/.test(msg)) msg = "the app needs a restart to load the upload feature";
      $("upPct").textContent = ok ? "Sent. It will appear below shortly." : "Failed: " + msg;
      $("upFile").value = "";
      if (ok) life.later(loadJobs, 8000);
    };
    xhr.onerror = () => ($("upPct").textContent = "Failed: connection lost. Try again.");
    xhr.send(file);
  };

  loadChannels();


  loadJobs();
  life.every(() => document.visibilityState === "visible" && loadJobs(), 4000);
  life.on(document, "visibilitychange", () => document.visibilityState === "visible" && loadJobs());
  life.later(loadTikTok, 800);
  life.every(() => document.visibilityState === "visible" && loadTikTok(), 30000);
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
