// Brain view (2026-11-11): zoom into one worker and watch what it's doing. the owner: "a zoom in mode like we're going in
// their brain which shows a view similar to those other 2 projects ... if it gave a text feed as well to track".
// The idea of a core with stations and pulses comes from the lot-map plugin (github.com/alexeyw/lot-map) and its fork
// command-mesh; none of their code is used.
//
// A map on top: the model as a glowing core, stations around it (Files, Shell, Web, Sub-agents, Plan, Connected tools,
// Jobs). Every step the worker reports sends a pulse from the core to its station; a failed step is red; a finished
// reply pulses the core itself. A ring around the core shows how full the session's context is.
// A text feed underneath: every step with its time, newest first.
// Data: /api/agents/desk/<id>/live, asked every 2 seconds while the view is open (only what's new).
// Classic script, same global scope as the other campus parts (uses esc, api, nameOf, titleOf, data, PROVIDER).
const BRAIN_ST = [
  ["files", "📄", "Files"], ["shell", "⌨️", "Shell"], ["web", "🌐", "Web"], ["agents", "🤝", "Sub-agents"],
  ["plan", "📝", "Plan"], ["tools", "🧩", "Tools"], ["jobs", "📌", "Jobs"],
];
const BRAIN_VERB = { "session start": "Session started", "turn done": "Finished a reply", "subagent done": "A sub-agent finished", "job given": "Got a job", "job taken": "Took a job", "job done": "Finished a job", "job handed over": "Got a hand-off", "hand-off refused": "Couldn't pass it back", "review": "Reviewed", "cloud report": "Reported", "files changed": "Changed files", "autonomy report": "Reported in" };
let brain = null; // { desk, timer, raf, since, steps, pulses, counts, lastAt, ctx, info, t0 }

function brainOpen(deskId, from) {
  const d = (data?.desks || []).find((x) => x.id === deskId);
  if (!d) return;
  brainClose(true);
  let el = document.getElementById("brain");
  if (!el) {
    el = document.createElement("div");
    el.id = "brain";
    el.innerHTML = `<div class="brain-top"><button class="pill" id="brainBack">← Back</button><div class="brain-who"><b id="brainName"></b> <span class="sub" id="brainSub"></span></div></div>
      <canvas id="brainC" aria-label="Live map of what this worker is doing"></canvas>
      <div class="brain-state sub" id="brainState"></div>
      <div class="brain-feed" id="brainFeed" aria-live="polite"></div>`;
    document.getElementById("stage").appendChild(el);
    document.getElementById("brainBack").onclick = () => brainClose();
  }
  // zoom in from where the worker was tapped
  const st = document.getElementById("stage").getBoundingClientRect();
  el.style.transformOrigin = from ? `${from.x - st.left}px ${from.y - st.top}px` : "50% 50%";
  el.classList.remove("open"); void el.offsetWidth; el.classList.add("open");
  document.getElementById("brainName").textContent = typeof nameOf === "function" ? nameOf(d) : d.id;
  document.getElementById("brainSub").textContent = `${typeof titleOf === "function" ? titleOf(d) : d.role || ""} · ${d.id}`;
  document.getElementById("brainFeed").innerHTML = "";
  brain = { desk: deskId, since: null, steps: [], pulses: [], counts: {}, lastAt: {}, ctx: d.live?.contextTokens || 0, info: null, t0: performance.now(), hue: PROVIDER?.[d.provider] || "#8fd18b", fail: 0 };
  brainPoll(true);
  brain.timer = setInterval(() => brainPoll(false), 2000);
  const loop = (t) => { if (!brain) return; brainDraw(t); brain.raf = requestAnimationFrame(loop); };
  brain.raf = requestAnimationFrame(loop);
  try { history.replaceState(null, "", `#brain=${encodeURIComponent(deskId)}`); } catch {}
}
function brainClose(quiet) {
  if (brain) { clearInterval(brain.timer); cancelAnimationFrame(brain.raf); brain = null; }
  const el = document.getElementById("brain");
  if (el) el.classList.remove("open");
  if (!quiet) try { if (location.hash.startsWith("#brain=")) history.replaceState(null, "", location.pathname + location.search); } catch {}
}
async function brainPoll(first) {
  const b = brain; if (!b) return;
  if (!first && document.visibilityState === "hidden") return; // no polling while the tab is hidden (speed, 2026-11-16)
  try {
    const r = await fetch(`/api/agents/desk/${encodeURIComponent(b.desk)}/live${b.since ? `?since=${encodeURIComponent(b.since)}` : ""}`).then((x) => (x.ok ? x.json() : Promise.reject(new Error(x.status === 401 ? "Sign in again." : "The hub didn't answer."))));
    if (brain !== b) return;
    b.info = r; b.fail = 0;
    if (r.contextTokens) b.ctx = r.contextTokens;
    const now = performance.now();
    r.steps.forEach((s, i) => {
      b.steps.push(s);
      b.since = s.at;
      if (s.contextTokens) b.ctx = s.contextTokens;
      b.counts[s.station] = (b.counts[s.station] || 0) + 1;
      b.lastAt[s.station] = Date.parse(s.at);
      // history fills the counts quietly; new steps pulse, a little apart so a burst reads as a burst
      const fresh = Date.now() - Date.parse(s.at) < 15000;
      if (!first || fresh) b.pulses.push({ st: s.station, at: now + (first ? i : i * 180), failed: s.failed, label: s.summary || s.tool || BRAIN_VERB[s.action] || s.action });
    });
    if (b.steps.length > 300) b.steps.splice(0, b.steps.length - 300);
    if (!b.since) b.since = r.now; // nothing yet: from now on, only what's new
    if (r.steps.length || first) brainFeed();
    brainState();
  } catch (err) {
    if (brain !== b) return;
    if (++b.fail >= 2) document.getElementById("brainState").textContent = `Not updating: ${err.message}`;
  }
}
function brainState() {
  const b = brain, r = b?.info; if (!r) return;
  const last = b.steps[b.steps.length - 1], age = last ? Date.now() - Date.parse(last.at) : null;
  const ago = age == null ? "" : age < 60000 ? "just now" : age < 5400e3 ? `${Math.round(age / 60000)} min ago` : `${Math.round(age / 3600e3)} h ago`;
  const how = r.reports === "steps" ? "" : r.reports === "jobs" ? " The hub runs this worker: it reports each job, not each step." : " This worker reports through pasted Hub log lines, so there are no live steps.";
  const ctx = b.ctx ? ` · context about ${Math.round(b.ctx / 1000)}k tokens` : "";
  // The latest session, in words: running, finished, or cut off (and when), so an old or dead session isn't a mystery.
  const t = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const s = r.session, sess = !s ? "" : s.status === "running" ? (s.live ? ` · session running until ${t(s.until)}` : " · session: the hub is checking on it")
    : ` · last session ${t(s.startedAt)} to ${s.endedAt ? t(s.endedAt) : "?"}: ${s.status === "cut off" ? "cut off when the hub restarted" : s.status}${s.last && s.status !== "cut off" ? ` ("${s.last}")` : ""}`;
  document.getElementById("brainState").textContent = (last ? (age < 90000 ? `Working: last step ${ago}` : `Quiet: last step ${ago}`) : "Nothing reported yet.") + sess + ctx + (r.job ? ` · job: ${r.job.text}` : "") + how;
}
function brainFeed() {
  const b = brain; if (!b) return;
  const el = document.getElementById("brainFeed");
  const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  const icon = Object.fromEntries(BRAIN_ST.map(([k, ic]) => [k, ic]));
  // By job (the owner 2026-11-14: "feed by job with a break out"): the steps in blocks, one per stretch of work on a job,
  // newest first; tap a block to open or close it. Each step in plain words (humanStep in core.js).
  // (helpers work at the same time as the main thread, so steps are grouped by job and helper whatever their order,
  // and split only after a 30-minute quiet gap)
  const blocks = [], latest = new Map();
  for (const s of [...b.steps].reverse().slice(0, 150)) {
    const key = `${s.job?.id || "none"}|${s.agent || "main"}`, open = latest.get(key);
    if (open && Date.parse(open.steps[open.steps.length - 1].at) - Date.parse(s.at) < 30 * 60000) { open.steps.push(s); continue; }
    const blk = { key: `${key}|${s.at}`, job: s.job || null, agent: s.agent || null, agentType: s.agentType || null, steps: [s] };
    blocks.push(blk); latest.set(key, blk);
  }
  // which blocks are open survives the 2-second refresh (keyed by job and helper, not by time)
  const base = (k) => k.split("|").slice(0, 2).join("|");
  b.openJobs ||= new Set([blocks[0] && base(blocks[0].key)]);
  el.innerHTML = blocks.map((k, i) => {
    const failed = k.steps.filter((s) => s.failed).length, files = new Set(k.steps.filter((s) => /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(s.tool || "") && s.summary).map((s) => s.summary)).size;
    const line = [`${k.steps.length} step${k.steps.length === 1 ? "" : "s"}`, files ? `edited ${files} file${files === 1 ? "" : "s"}` : "", failed ? `✕ ${failed} failed` : ""].filter(Boolean).join(" · ");
    return `<details class="feed-job" data-key="${esc(k.key)}"${b.openJobs.has(base(k.key)) && blocks.findIndex((x) => base(x.key) === base(k.key)) === i ? " open" : ""}><summary>${k.job ? `📌 <b>${esc(k.job.text)}</b>` : "<b>Work outside a job</b>"}${k.agent ? ` <span class="sub">🤝 a helper${k.agentType ? `: ${esc(k.agentType)}` : ""}</span>` : ""} <span class="sub">· ${esc(line)} · ${time(k.steps[k.steps.length - 1].at)} to ${time(k.steps[0].at)}</span></summary>
      ${k.steps.map((s) => `<div class="feed-step${s.failed ? " bad" : ""}${s.action === "turn done" || s.action === "session start" ? " mark" : ""}"><span class="brain-time">${time(s.at)}</span> ${s.action === "tool" ? `${icon[s.station] || "🔧"} ` : ""}${esc(humanStep(s))}</div>`).join("")}</details>`;
  }).join("") || `<div class="sub" style="padding:10px 0">No steps yet. They show here as the worker reports them.</div>`;
  for (const d of el.querySelectorAll("details[data-key]")) d.ontoggle = () => { const k = base(d.dataset.key); if (d.open) b.openJobs.add(k); else b.openJobs.delete(k); };
}
function brainDraw(t) {
  const b = brain, c = document.getElementById("brainC"); if (!b || !c) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, R = Math.max(60, Math.min(w * 0.36, h * 0.36)), core = Math.max(26, Math.min(44, R * 0.3));
  const now = Date.now(), calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const pos = BRAIN_ST.map(([k], i) => { const a = -Math.PI / 2 + (i / BRAIN_ST.length) * Math.PI * 2; return [k, cx + Math.cos(a) * R * (w > h ? 1.25 : 1), cy + Math.sin(a) * R]; });
  // links
  for (const [k, x, y] of pos) { const used = b.counts[k]; g.strokeStyle = used ? "rgba(160,200,255,0.28)" : "rgba(160,200,255,0.1)"; g.lineWidth = 1.2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke(); }
  // pulses: core -> station over 900 ms (a "core" pulse is a ring out from the core)
  b.pulses = b.pulses.filter((p) => t - p.at < 1600);
  let coreGlow = 0;
  for (const p of b.pulses) {
    const f = (t - p.at) / 900; if (f < 0) continue;
    const col = p.failed ? "255,110,110" : "125,220,138";
    if (p.st === "core" || !pos.find((q) => q[0] === p.st)) { const ff = Math.min(1, f); g.strokeStyle = `rgba(${col},${0.7 * (1 - ff)})`; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, core + ff * R * 0.7, 0, Math.PI * 2); g.stroke(); coreGlow = Math.max(coreGlow, 1 - ff); continue; }
    const [, x, y] = pos.find((q) => q[0] === p.st);
    if (f <= 1) {
      const e = calm ? 1 : 1 - Math.pow(1 - f, 3), px = cx + (x - cx) * e, py = cy + (y - cy) * e;
      g.fillStyle = `rgba(${col},0.95)`; g.beginPath(); g.arc(px, py, 4.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = `rgba(${col},0.25)`; g.beginPath(); g.arc(px, py, 10, 0, Math.PI * 2); g.fill();
      coreGlow = Math.max(coreGlow, 1 - f);
    } else { const ff = Math.min(1, (f - 1) / 0.75); g.strokeStyle = `rgba(${col},${0.8 * (1 - ff)})`; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 20 + ff * 14, 0, Math.PI * 2); g.stroke(); }
  }
  // stations
  g.textAlign = "center"; g.textBaseline = "middle";
  for (const [k, x, y] of pos) {
    const [, ic, nm] = BRAIN_ST.find((s) => s[0] === k), n = b.counts[k] || 0, fresh = b.lastAt[k] && now - b.lastAt[k] < 60000;
    g.fillStyle = n ? "rgba(28,40,58,0.95)" : "rgba(22,28,38,0.85)"; g.strokeStyle = fresh ? "#7ddc8a" : n ? "rgba(160,200,255,0.55)" : "rgba(160,200,255,0.18)"; g.lineWidth = fresh ? 2 : 1.2;
    g.beginPath(); g.arc(x, y, 20, 0, Math.PI * 2); g.fill(); g.stroke();
    g.globalAlpha = n ? 1 : 0.45; g.font = "17px system-ui, 'Segoe UI Emoji', 'Apple Color Emoji'"; g.fillText(ic, x, y + 1);
    g.font = "600 11px system-ui"; g.fillStyle = "#dfe6f2"; { const half = g.measureText(nm).width / 2 + 4; g.fillText(nm, Math.max(half, Math.min(w - half, x)), y + 33); }
    if (n) { g.font = "700 10px system-ui"; g.fillStyle = "#11141b"; const tw = Math.max(16, g.measureText(String(n)).width + 8); g.fillStyle = fresh ? "#7ddc8a" : "#9cc7ff"; g.beginPath(); g.roundRect(x + 10, y - 26, tw, 14, 7); g.fill(); g.fillStyle = "#11141b"; g.fillText(String(n), x + 10 + tw / 2, y - 18.5); }
    g.globalAlpha = 1;
  }
  // core: the model, breathing while it works; context ring around it
  const busy = b.steps.length && now - Date.parse(b.steps[b.steps.length - 1].at) < 90000, breathe = calm ? 0 : Math.sin(t / (busy ? 420 : 1400)) * (busy ? 3 : 1.5);
  const grad = g.createRadialGradient(cx, cy, 4, cx, cy, core + 22 + coreGlow * 14);
  grad.addColorStop(0, b.hue); grad.addColorStop(0.55, `${b.hue}55`); grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad; g.beginPath(); g.arc(cx, cy, core + 22 + coreGlow * 14, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#141a26"; g.strokeStyle = b.hue; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, core + breathe, 0, Math.PI * 2); g.fill(); g.stroke();
  if (b.ctx) { const pct = Math.min(1, b.ctx / 200000); g.strokeStyle = "rgba(255,255,255,0.12)"; g.lineWidth = 4; g.beginPath(); g.arc(cx, cy, core + 9, 0, Math.PI * 2); g.stroke(); g.strokeStyle = pct > 0.85 ? "#f0b45a" : "#7ddc8a"; g.beginPath(); g.arc(cx, cy, core + 9, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2); g.stroke(); }
  g.fillStyle = "#f0f3f8"; g.font = "700 12px system-ui";
  const raw = String(b.info?.model || ""), model = /claude-code/i.test(raw) ? "Claude Code" : raw.replace(/^claude-/, "").slice(0, 14) || "model";
  g.fillText(model, cx, cy - (b.ctx ? 6 : 0));
  if (b.ctx) { g.font = "10px system-ui"; g.fillStyle = "#aab4c4"; g.fillText(`${Math.round(b.ctx / 1000)}k ctx`, cx, cy + 9); }
  // the newest step's name floats under the core for a moment
  const lp = b.pulses[b.pulses.length - 1];
  if (lp && t - lp.at > 0 && lp.label) { g.font = "12px system-ui"; g.fillStyle = `rgba(${lp.failed ? "255,160,160" : "200,240,206"},${Math.max(0, 1 - (t - lp.at) / 1600)})`; g.fillText(String(lp.label).slice(0, 34), cx, cy + core + 30); }
}
// Any "Look inside" button, wherever it's drawn.
document.addEventListener("click", (e) => { const btn = e.target.closest?.("[data-brain]"); if (!btn) return; e.preventDefault(); brainOpen(btn.dataset.brain, { x: e.clientX, y: e.clientY }); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && brain) brainClose(); });
// A link straight into someone's head: /campus.html#brain=<desk>
(function brainFromHash() { const m = /^#brain=(.+)$/.exec(location.hash); if (!m) return; const id = decodeURIComponent(m[1]); const go = () => (data?.desks ? brainOpen(id) : setTimeout(go, 400)); go(); })();
