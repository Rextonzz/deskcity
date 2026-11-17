// Neural view (2026-11-14): the third view, next to the city and the brain. the owner: "like the brain view but we can
// trace the branching". One job's tree of work, drawn radially from a core: the job, the hand-offs and retries that
// came from it (any desk), and under each job its sessions, replies, tool calls by station and sub-agents. Tap a node
// to open or close it; tap another desk's job to follow the branch there. A time-ordered list under the map shows
// every step under the node you picked. Failed steps are marked with ✕ and a count as well as colour.
// Ideas from span-tree viewers (collapse each sub-agent and hand-off into one node that opens in place, a time list
// beside the tree; docs/handoffs/neural-view.md). No outside code: the radial layout is a leaf-weighted tree below.
// Data: /api/pipeline/agents/trace?job=<id> or ?desk=<id>, asked every 5 seconds while the view is open.
// Classic script, same global scope as the other campus parts (uses esc, data, nameOf, titleOf, PROVIDER, BRAIN_ST, brainOpen).
const NEURAL_ICON = { job: "📌", desk: "🏢", session: "🖥️", turn: "💬", subagent: "🤝", more: "⋯", step: "" };
const NEURAL_STATUS = { done: "✓ done", failed: "✕ failed", cancelled: "– cancelled", taken: "◔ working", queued: "○ waiting" };
let neural = null; // { mode: "web"|"tree", desk, job, timer, raf, tree, open:Set, sel, pos:[], seen:Set, fresh:Map, fail, first, web, a, b, path }

// mode: "web" (every desk and how they connect; the default) or "tree" (one job's work; the default when a job is named)
function neuralOpen(deskId, { job = null, from = null, mode = null } = {}) {
  if (document.body.classList.contains("mod-off-neural")) return; // the Neural view is switched off on this hub
  if (typeof brainClose === "function") brainClose(true);
  neuralClose(true);
  let el = document.getElementById("neural");
  if (!el) {
    el = document.createElement("div");
    el.id = "neural";
    el.innerHTML = `<div class="brain-top"><button class="pill" id="neuralBack">← Back</button><div class="brain-who"><b id="neuralName"></b> <span class="sub" id="neuralSub"></span></div><button class="pill" id="neuralBrain" title="The live map of this worker">🧠 Brain</button></div>
      <div class="neural-bar"><div class="neural-modes" role="tablist"><button class="pill" id="neuralModeWeb" role="tab" title="Every worker and how they connect: work handed on, results back, notes">🕸 Web</button><button class="pill" id="neuralModeTree" role="tab" title="One job's work: hand-offs, sessions, replies, tool calls, sub-agents">🌳 Job tree</button></div>
        <select id="neuralJob" aria-label="Which job to trace"></select>
        <span class="neural-webopts"><select id="neuralDays" aria-label="How far back"><option value="1">Last day</option><option value="7" selected>Last 7 days</option><option value="30">Last 30 days</option></select> <label class="sub"><input type="checkbox" id="neuralSocial"> chat too</label></span></div>
      <nav class="neural-crumbs" id="neuralCrumbs" aria-label="Where you are: tap a step to come back out to it"></nav>
      <canvas id="neuralC" aria-label="Neural view: the web of workers, or one job's tree of work. Tap to pick."></canvas>
      <div class="brain-state sub" id="neuralState"></div>
      <div class="brain-feed" id="neuralFeed" aria-live="polite"></div>`;
    document.getElementById("stage").appendChild(el);
    document.getElementById("neuralBack").onclick = () => neuralClose();
    document.getElementById("neuralBrain").onclick = () => { const d = neural?.desk; neuralClose(); if (d) brainOpen(d); };
    document.getElementById("neuralModeWeb").onclick = () => neuralMode("web");
    document.getElementById("neuralModeTree").onclick = () => neuralMode("tree");
    document.getElementById("neuralDays").onchange = () => { if (neural) { neural.web = null; neuralPoll(); } };
    document.getElementById("neuralSocial").onchange = () => { if (neural) { neural.web = null; neuralPoll(); } };
    document.getElementById("neuralJob").onchange = (e) => { if (!neural) return; neural.job = e.target.value || null; neural.sub = null; neural.tree = null; neural.open.clear(); neural.sel = null; neural.first = true; neuralPoll(); };
    const c = document.getElementById("neuralC");
    neuralDiveAttach(c); // taps, double-taps, pinch and wheel (neuraldive.js)
  }
  const st = document.getElementById("stage").getBoundingClientRect();
  el.style.transformOrigin = from ? `${from.x - st.left}px ${from.y - st.top}px` : "50% 50%";
  el.classList.remove("open"); void el.offsetWidth; el.classList.add("open");
  neural = { mode: mode || (job ? "tree" : "web"), desk: deskId, job, tree: null, open: new Set(), sel: null, pos: [], seen: new Set(), fresh: new Map(), fail: 0, first: true, web: null, a: deskId, b: null, path: null, wpos: [], webAt: 0, sub: null, anim: null };
  neuralWho(deskId);
  { const hm = document.getElementById("hMode"); if (hm?.tagName === "SELECT") hm.value = "neural"; } // the View picker shows what's on screen
  neuralMode(neural.mode, true);
  neural.timer = setInterval(neuralPoll, 5000);
  const loop = (t) => { if (!neural) return; (neural.mode === "web" ? webDraw : neuralDraw)(t); neuralDiveFrame(); neural.raf = requestAnimationFrame(loop); };
  neural.raf = requestAnimationFrame(loop);
}
// Switch between the web and the job tree (the tree for the picked worker's job, or `job`).
function neuralMode(mode, fresh) {
  const n = neural; if (!n) return;
  if (typeof neuralReplayStop === "function") neuralReplayStop(mode); // a replay ends when the mode, worker or job changes (neuralreplay.js)
  // the job tree needs a worker: with none picked yet, stay on the web and say so
  if (mode === "tree" && !n.desk && !n.a) { mode = "web"; setTimeout(() => { if (neural === n) document.getElementById("neuralState").textContent = "Pick a worker on the web first (tap them), then 🌳 Job tree, or double-tap them to dive in."; }, 0); }
  n.mode = mode;
  document.getElementById("neuralModeWeb").classList.toggle("on", mode === "web");
  document.getElementById("neuralModeTree").classList.toggle("on", mode === "tree");
  document.getElementById("neuralModeWeb").setAttribute("aria-selected", String(mode === "web"));
  document.getElementById("neuralModeTree").setAttribute("aria-selected", String(mode === "tree"));
  document.getElementById("neuralJob").style.display = mode === "tree" ? "" : "none";
  document.querySelector("#neural .neural-webopts").style.display = mode === "web" ? "" : "none";
  document.getElementById("neuralFeed").innerHTML = "";
  document.getElementById("neuralState").textContent = mode === "web" ? "Loading the web…" : "Loading the tree…";
  n.sub = null;
  if (mode === "tree" && !fresh && n.a && n.a !== n.desk && n.a !== OWNER_ID()) { n.desk = n.a; n.job = null; n.tree = null; n.open.clear(); n.sel = null; n.first = true; n.seen.clear(); neuralWho(n.desk); }
  if (mode === "tree" && n.tree) { neuralState(); neuralFeed(); }
  if (mode === "web" && !n.a) n.a = n.desk;
  if (mode === "web" && n.web) { webState(); webFeed(); }
  neuralPoll();
  try { history.replaceState(null, "", `#neural=${encodeURIComponent(n.desk || "all")}${mode === "tree" && n.job ? `&job=${encodeURIComponent(n.job)}` : ""}${mode === "web" ? "&mode=web" : ""}`); } catch {}
}
function neuralWho(deskId) {
  // no worker yet (Neural as the campus's base view): the whole web
  document.getElementById("neuralBrain").style.display = deskId ? "" : "none";
  if (!deskId) { document.getElementById("neuralName").textContent = "Neural"; document.getElementById("neuralSub").textContent = "every worker and how they connect"; return; }
  const d = (data?.desks || []).find((x) => x.id === deskId);
  document.getElementById("neuralName").textContent = d && typeof nameOf === "function" ? nameOf(d) : deskId;
  document.getElementById("neuralSub").textContent = `${d && typeof titleOf === "function" ? titleOf(d) : d?.role || ""} · ${deskId}`;
}
function neuralClose(quiet) {
  // the View picker shows the city again (Neural stays this device's base; picking it reopens the web)
  const hm = document.getElementById("hMode"); if (!quiet && hm?.tagName === "SELECT" && hm.value === "neural") hm.value = window.campusCity || "2d";
  if (neural) { clearInterval(neural.timer); cancelAnimationFrame(neural.raf); neural = null; }
  document.getElementById("neural")?.classList.remove("open");
  if (!quiet) try { if (location.hash.startsWith("#neural=")) history.replaceState(null, "", location.pathname + location.search); } catch {}
}
async function neuralPoll() {
  const n = neural; if (!n) return;
  if (document.visibilityState === "hidden") return; // no polling while the tab is hidden (speed, 2026-11-16)
  if (n.mode === "web") return webPoll();
  if (typeof neuralReplayHold === "function" && neuralReplayHold()) return; // a replay plays the tree it started with
  try {
    const q = n.job ? `job=${encodeURIComponent(n.job)}` : `desk=${encodeURIComponent(n.desk)}`;
    const r = await fetch(`/api/pipeline/agents/trace?${q}`).then((x) => (x.ok ? x.json() : x.json().catch(() => ({})).then((b) => Promise.reject(new Error(x.status === 401 ? "Sign in again." : b.error || "The hub didn't answer.")))));
    if (neural !== n || n.mode !== "tree") return;
    n.fail = 0;
    if (!n.job && r.focus) n.job = r.focus;
    // new steps glow for a moment (not on the first load)
    const now = performance.now();
    neuralWalk(r.root, (x) => { if (!n.seen.has(x.id)) { if (!n.first) n.fresh.set(x.id, now); n.seen.add(x.id); } });
    if (n.first) neuralDefaults(r);
    n.tree = r; n.first = false;
    if (n.sub && !neuralFind(r.root, n.sub)) n.sub = null;
    if (!n.sel || !neuralFind(r.root, n.sel)) n.sel = (r.focus && `job:${r.focus}`) || r.root.id;
    neuralJobs(r);
    neuralState();
    neuralFeed();
  } catch (err) {
    if (neural !== n) return;
    if (++n.fail >= 2 || !n.tree) document.getElementById("neuralState").textContent = `Not updating: ${err.message}`;
  }
}
// What starts open: every job in the chain, the focus job's sessions, and its newest reply.
function neuralDefaults(r) {
  const o = neural.open;
  neuralWalk(r.root, (x) => { if (x.kind === "job" || x.kind === "desk") o.add(x.id); });
  const f = (r.focus && neuralFind(r.root, `job:${r.focus}`)) || r.root;
  const ss = f.children.filter((c) => c.kind === "session");
  ss.forEach((s) => o.add(s.id));
  const last = ss[ss.length - 1]?.children.slice(-1)[0];
  if (last) o.add(last.id);
}
function neuralJobs(r) {
  const sel = document.getElementById("neuralJob");
  const list = r.jobs || [];
  const key = list.map((j) => j.id + j.status).join() + (neural.job || "");
  if (sel.dataset.key === key) return;
  sel.dataset.key = key;
  const opts = list.map((j) => `<option value="${esc(j.id)}"${j.id === neural.job ? " selected" : ""}>${esc((NEURAL_STATUS[j.status] || j.status).split(" ")[0])} ${esc(j.text || j.id)}</option>`);
  if (neural.job && !list.some((j) => j.id === neural.job)) opts.unshift(`<option value="${esc(neural.job)}" selected>Job ${esc(neural.job)}</option>`);
  if (!list.length && !neural.job) opts.push(`<option value="">No jobs: this desk's sessions, last 12 hours</option>`);
  sel.innerHTML = opts.join("");
  sel.disabled = !list.length;
}
const neuralWalk = (x, fn) => { fn(x); x.children.forEach((c) => neuralWalk(c, fn)); };
const neuralFind = (x, id) => (x.id === id ? x : x.children.reduce((a, c) => a || neuralFind(c, id), null));

function neuralState() {
  const n = neural, r = n?.tree; if (!r) return;
  const root = r.root, desks = new Set(); let jobs = 0;
  neuralWalk(root, (x) => { if (x.kind === "job") { jobs++; desks.add(x.desk); } });
  const mixed = (() => { let m = false; neuralWalk(root, (x) => { if (x.mixed) m = true; }); return m; })();
  const parts = root.kind === "desk" ? [`No job to follow: ${root.n} steps from this desk's sessions in the last 12 hours`]
    : [`${jobs} job${jobs === 1 ? "" : "s"} across ${desks.size} desk${desks.size === 1 ? "" : "s"}`, `${root.n} steps under the first job`];
  if (root.failed) parts.push(`✕ ${root.failed} failed`);
  if (mixed) parts.push("older steps have no session id, so two sessions on one desk may be shown as one");
  document.getElementById("neuralState").textContent = parts.join(" · ") + ". Tap a node to open or close it.";
}

// ---------- layout: radial, each node's angle share = its visible leaves ----------
function neuralLayout(root, w, h) {
  const open = neural.open, pos = [];
  const kids = (x) => (open.has(x.id) ? x.children : []);
  const leaves = (x) => (x._l = kids(x).length ? kids(x).reduce((s, c) => s + leaves(c), 0) : 1);
  const depth = (x) => 1 + Math.max(0, ...kids(x).map(depth));
  leaves(root);
  const D = Math.max(1, depth(root) - 1), cx = w / 2, cy = h / 2;
  const R = Math.max(70, Math.min(w, h) / 2 - 34), ring = R / D, sx = w > h ? Math.min(1.5, w / h) : 1;
  const place = (x, a0, a1, d, parent) => {
    const a = (a0 + a1) / 2, r = d * ring;
    const p = { node: x, x: cx + Math.cos(a) * r * sx, y: cy + Math.sin(a) * r, a, d, parent };
    pos.push(p);
    let s = a0;
    for (const c of kids(x)) { const span = ((a1 - a0) * c._l) / x._l; place(c, s, s + span, d + 1, p); s += span; }
  };
  place(root, -Math.PI / 2, Math.PI * 1.5, 0, null);
  return pos;
}
const neuralSize = (k) => ({ desk: 30, job: 15, session: 11, turn: 10, subagent: 11, station: 11, more: 6, step: 4.5 })[k] || 8;

function neuralDraw(t) {
  const n = neural, c = document.getElementById("neuralC"); if (!n || !c) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  // a replay moves its clock (and opens the step it's on) before the layout; later nodes are drawn faint (neuralreplay.js)
  const ghost = typeof neuralReplayTick === "function" && neuralReplayTick(performance.now()) ? neuralReplayAlpha : null;
  if (!n.tree) return;
  const pos = (n.pos = neuralLayout(neuralSubroot(), w, h)), now = performance.now(), calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const hue = PROVIDER?.[(data?.desks || []).find((d) => d.id === n.desk)?.provider] || "#8fd18b";
  const selPath = new Set(); { let p = pos.find((q) => q.node.id === n.sel); while (p) { selPath.add(p.node.id); p = p.parent; } }
  // links: curved toward the core; hand-offs dashed with an arrow, retries dotted
  for (const p of pos) {
    if (!p.parent) continue;
    const q = p.parent, x = p.node, on = selPath.has(x.id);
    g.globalAlpha = ghost ? ghost(x) : 1;
    const mx = (p.x + q.x) / 2 + (w / 2 - (p.x + q.x) / 2) * 0.18, my = (p.y + q.y) / 2 + (h / 2 - (p.y + q.y) / 2) * 0.18;
    g.setLineDash(x.edge === "handoff" ? [7, 5] : x.edge === "retry" ? [2, 4] : []);
    g.strokeStyle = x.failed && x.kind === "step" ? "rgba(255,120,120,0.5)" : on ? "rgba(190,225,255,0.85)" : x.kind === "job" ? "rgba(240,200,120,0.6)" : "rgba(160,200,255,0.22)";
    g.lineWidth = on ? 2 : x.kind === "job" ? 1.8 : 1.1;
    g.beginPath(); g.moveTo(q.x, q.y); g.quadraticCurveTo(mx, my, p.x, p.y); g.stroke();
    g.setLineDash([]);
    if (x.edge === "handoff") { const a = Math.atan2(p.y - my, p.x - mx), r = neuralSize("job") + 3; g.fillStyle = "rgba(240,200,120,0.9)"; g.beginPath(); g.moveTo(p.x - Math.cos(a) * r, p.y - Math.sin(a) * r); g.lineTo(p.x - Math.cos(a - 0.4) * (r + 9), p.y - Math.sin(a - 0.4) * (r + 9)); g.lineTo(p.x - Math.cos(a + 0.4) * (r + 9), p.y - Math.sin(a + 0.4) * (r + 9)); g.fill(); }
  }
  // nodes
  g.textAlign = "center"; g.textBaseline = "middle";
  const small = w < 520;
  for (const p of pos) {
    const x = p.node, s = neuralSize(x.kind), sel = x.id === n.sel, glow = n.fresh.get(x.id);
    const shut = x.children.length && !n.open.has(x.id);
    const ga = ghost ? ghost(x) : 1; g.globalAlpha = ga;
    if (glow != null) { const f = (now - glow) / 2500; if (f > 1) n.fresh.delete(x.id); else { g.strokeStyle = `rgba(125,220,138,${0.8 * (1 - f)})`; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, s + 4 + (calm ? 0 : f * 10), 0, Math.PI * 2); g.stroke(); } }
    if (!p.parent) {
      // the core: the chain's first job (or the desk), glowing like the brain view's model
      const grad = g.createRadialGradient(p.x, p.y, 4, p.x, p.y, 52); grad.addColorStop(0, hue); grad.addColorStop(0.5, `${hue}44`); grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad; g.beginPath(); g.arc(p.x, p.y, 52, 0, Math.PI * 2); g.fill();
    }
    if (x.kind === "step") {
      if (x.failed) { g.strokeStyle = "#ff7b7b"; g.lineWidth = 2.2; g.beginPath(); g.moveTo(p.x - 4, p.y - 4); g.lineTo(p.x + 4, p.y + 4); g.moveTo(p.x + 4, p.y - 4); g.lineTo(p.x - 4, p.y + 4); g.stroke(); }
      else { g.fillStyle = sel ? "#ffffff" : "#9cc7ff"; g.beginPath(); g.arc(p.x, p.y, s, 0, Math.PI * 2); g.fill(); }
      if (sel) { g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.beginPath(); g.arc(p.x, p.y, s + 4, 0, Math.PI * 2); g.stroke(); }
      continue;
    }
    const stIcon = x.kind === "station" ? (BRAIN_ST.find((b) => b[0] === x.station)?.[1] || "🔧") : NEURAL_ICON[x.kind] || "•";
    const ring = x.kind === "job" ? (x.status === "failed" ? "#ff7b7b" : x.status === "done" ? "#7ddc8a" : "#f0c060") : x.working || x.running ? "#7ddc8a" : "rgba(160,200,255,0.6)";
    g.fillStyle = p.parent ? "rgba(24,34,52,0.96)" : "#141a26"; g.strokeStyle = sel ? "#ffffff" : ring; g.lineWidth = sel ? 2.6 : x.kind === "job" ? 2 : 1.3;
    g.beginPath(); g.arc(p.x, p.y, s, 0, Math.PI * 2); g.fill(); g.stroke();
    if (shut) { g.setLineDash([3, 3]); g.strokeStyle = "rgba(200,220,255,0.55)"; g.lineWidth = 1; g.beginPath(); g.arc(p.x, p.y, s + 4, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
    g.font = `${Math.round(s * 1.05)}px system-ui, 'Segoe UI Emoji', 'Apple Color Emoji'`; g.fillStyle = "#fff"; g.fillText(stIcon, p.x, p.y + 1);
    // job status as a shape too: ✓ done, ✕ failed, ◔ working, ○ waiting
    if (x.kind === "job") { const m = (NEURAL_STATUS[x.status] || "").split(" ")[0]; if (m) { g.font = "700 11px system-ui"; g.fillStyle = "#11141b"; g.beginPath(); g.arc(p.x + s * 0.8, p.y - s * 0.8, 7, 0, Math.PI * 2); g.fillStyle = ring; g.fill(); g.fillStyle = "#11141b"; g.fillText(m, p.x + s * 0.8, p.y - s * 0.8 + 0.5); } }
    // counts: steps under it, and ✕ failed
    if (x.n && x.kind !== "job" && x.kind !== "desk") { const txt = x.failed ? `${x.n} ✕${x.failed}` : String(x.n); g.font = "700 9px system-ui"; const tw = g.measureText(txt).width + 7; g.fillStyle = x.failed ? "#ffb0b0" : "#9cc7ff"; g.beginPath(); g.roundRect(p.x + s * 0.55, p.y - s - 9, tw, 12, 6); g.fill(); g.fillStyle = "#11141b"; g.fillText(txt, p.x + s * 0.55 + tw / 2, p.y - s - 2.8); }
    // labels: jobs always (their desk), others when picked or roomy
    const lab = !p.parent ? "" : x.kind === "job" ? (x.desk === n.desk ? "" : x.desk) : x.kind === "desk" ? "" : sel || (!small && ["subagent", "session"].includes(x.kind)) ? (x.kind === "station" ? BRAIN_ST.find((b) => b[0] === x.station)?.[2] || x.station : x.label) : "";
    if (lab && ga === 1) { g.font = "600 10.5px system-ui"; g.fillStyle = "#dfe6f2"; const txt = String(lab).slice(0, small ? 16 : 26), half = g.measureText(txt).width / 2 + 3; g.fillText(txt, Math.max(half, Math.min(w - half, p.x)), p.y + s + 11); }
  }
  g.globalAlpha = 1;
  // core label
  const root = pos[0];
  if (root) { g.font = "700 10px system-ui"; g.fillStyle = "#f0f3f8"; g.fillText(n.sub ? neuralCrumbLabel(root.node).slice(0, 26) : root.node.kind === "desk" ? "this desk" : `start · ${root.node.desk}`.slice(0, 22), root.x, root.y - neuralSize(root.node.kind) - 14); }
  if (ghost) neuralReplayDraw(g, pos, w, h, now);
}
// What the tree is drawn from: the node you dived into, or the whole chain.
function neuralSubroot() { const n = neural; return (n.sub && neuralFind(n.tree.root, n.sub)) || n.tree.root; }
// nearest node within reach (a fingertip: at least 16 px, or the node's size plus 6)
function neuralHit(px, py) {
  let best = null, bd = Infinity;
  for (const p of neural?.pos || []) { const d = Math.hypot(p.x - px, p.y - py); if (d <= Math.max(16, neuralSize(p.node.kind) + 6) && d < bd) { best = p; bd = d; } }
  return best;
}
function neuralTap(px, py) {
  const n = neural; if (!n?.pos) return;
  const best = neuralHit(px, py);
  if (!best) return;
  const x = best.node;
  // another desk's job: follow the branch there (its work opens, the list shows it)
  if (x.kind === "job" && x.id !== n.sel && n.tree.focus !== x.job) {
    n.sel = x.id;
    x.children.filter((c) => c.kind === "session").forEach((s) => n.open.add(s.id));
    const last = x.children.filter((c) => c.kind === "session").slice(-1)[0]?.children.slice(-1)[0]; if (last) n.open.add(last.id);
    n.open.add(x.id);
  } else {
    if (x.children.length && n.sel === x.id) { if (n.open.has(x.id)) n.open.delete(x.id); else n.open.add(x.id); }
    else if (x.children.length && !n.open.has(x.id)) n.open.add(x.id);
    n.sel = x.id;
  }
  neuralFeed();
}

// ---------- the list under the map: the picked node, then every step under it, newest first ----------
function neuralFeed() {
  const n = neural, el = document.getElementById("neuralFeed"); if (!n?.tree || !el) return;
  const x = neuralFind(n.tree.root, n.sel) || n.tree.root;
  neuralCrumbs();
  if (typeof neuralReplayFeed === "function" && neuralReplayFeed()) return; // while replaying, the list follows the replay
  const dive = neuralCanDive(x) ? `<button class="pill neural-mini" data-dive="${esc(x.id)}" title="Zoom in so this is the centre (or double-tap it, or pinch out)">⤵ Dive in</button>` : "";
  const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  const day = (iso) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  const stName = Object.fromEntries(BRAIN_ST.map(([k, ic, nm]) => [k, `${ic} ${nm}`]));
  const head = (() => {
    if (x.kind === "job") {
      const other = x.desk !== n.desk;
      return `<div class="neural-head"><b>📌 ${esc(x.label || "Job")}</b> ${dive}<div class="sub">${esc(NEURAL_STATUS[x.status] || x.status)} · ${esc(x.desk)}${x.from ? ` · handed on by ${esc(x.from)}` : ""}${x.edge === "retry" ? " · a retry" : ""}${x.step ? ` · step ${x.step}${x.of ? ` of ${x.of}` : ""}` : ""} · ${day(x.at)}</div>${x.summary ? `<div>${esc(x.summary)}</div>` : ""}${window.campusBlocks?.buttonsFor(window.campusBlocks.roomOfDesk(x.desk)) || ""}${window.campusProps?.htmlFor(window.campusBlocks?.roomOfDesk(x.desk)) || ""}${other ? `<button class="pill" data-neural="${esc(x.desk)}" data-neural-job="${esc(x.job)}" style="margin-top:6px">Open ${esc(x.desk)}'s view</button>` : ""}</div>`;
    }
    const what = x.kind === "station" ? stName[x.station] || x.station : x.kind === "step" ? `${stName[x.station] || "🔧"} · ${x.tool || "step"}` : `${NEURAL_ICON[x.kind] || ""} ${x.label}`;
    const extra = x.kind === "session" && x.mixed ? " · no session id (older steps)" : x.kind === "turn" && x.working ? " · still working" : x.kind === "subagent" && x.running ? " · still running" : x.contextTokens ? ` · context about ${Math.round(x.contextTokens / 1000)}k tokens` : "";
    return `<div class="neural-head"><b>${esc(what)}</b> ${dive}<div class="sub">${x.n != null ? `${x.n} step${x.n === 1 ? "" : "s"}` : ""}${x.failed ? ` · ✕ ${x.failed} failed` : ""}${extra} · ${time(x.at)}${x.end && x.end !== x.at ? ` to ${time(x.end)}` : ""}</div></div>`;
  })();
  const rows = [];
  const add = (y) => {
    if (y.kind === "step") rows.push({ at: y.at, html: `${esc(stName[y.station] || "🔧 Other")} · <b>${esc(y.tool || "tool")}</b>${y.label && y.label !== y.tool ? ` · ${esc(y.label)}` : ""}`, bad: y.failed });
    else if (y.kind === "more") rows.push({ at: y.end, html: `<i>${y.hidden} earlier steps not shown${y.failed ? `, ✕ ${y.failed} failed` : ""}</i>` });
    else if (y.kind === "subagent" && y.legacy) rows.push({ at: y.at, html: "<b>A sub-agent finished</b>", mark: true });
    else if (y.kind === "turn") rows.push({ at: y.end, html: `<b>${esc(y.label)} ${y.working ? "(working)" : "finished"}</b>`, mark: true });
    else if (y.kind === "job" && y !== x) { rows.push({ at: y.at, html: `<b>${y.edge === "retry" ? "↻ Retried" : "➜ Handed to"} ${esc(y.desk)}</b> · ${esc(y.label)} · ${esc(NEURAL_STATUS[y.status] || y.status)}`, mark: true }); return; }
    y.children.forEach(add);
  };
  add(x);
  rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  el.innerHTML = head + (rows.slice(0, 200).map((r) => `<div class="brain-row${r.bad ? " bad" : ""}${r.mark ? " mark" : ""}"><span class="brain-time">${time(r.at)}</span><span>${r.html}${r.bad ? " · <b>✕ failed</b>" : ""}</span></div>`).join("") || `<div class="sub" style="padding:10px 0">${x.kind === "job" ? "No steps were reported on this desk while the job was open. Hub-run workers report the job, not each step." : "Nothing under this yet."}</div>`);
}
// Any "Neural" button, wherever it's drawn; the brain view gets one too.
document.addEventListener("click", (e) => {
  const btn = e.target.closest?.("[data-neural]"); if (!btn) return;
  e.preventDefault();
  const desk = btn.dataset.neural, job = btn.dataset.neuralJob || null, mode = btn.dataset.neuralMode || null;
  // already open (a button in the web's or the tree's list): switch in place
  if (neural) {
    neural.desk = desk; neural.job = job; neural.sub = null; neural.tree = null; neural.open.clear(); neural.sel = null; neural.first = true; neural.seen.clear();
    if (mode !== "web") neural.a = desk;
    neuralWho(desk); neuralMode(mode || (job ? "tree" : neural.mode), true);
    return;
  }
  neuralOpen(desk, { job, mode, from: { x: e.clientX, y: e.clientY } });
});
// Esc steps out one level (out of the top, back to the campus); Enter dives into what's picked.
document.addEventListener("keydown", (e) => {
  if (!neural || e.target.closest?.("input, select, textarea")) return;
  if (e.key === "Escape" || e.key === "Backspace") { e.preventDefault(); neuralOut(); }
  else if (e.key === "Enter" && !e.target.closest?.("button, [role=button]")) { e.preventDefault(); neuralIn(neural.mode === "web" ? neural.b || neural.a : neural.sel); }
});
(function neuralInBrain() {
  if (typeof brainOpen !== "function") return;
  const orig = brainOpen;
  brainOpen = function (deskId, from) {
    neuralClose(true);
    { const hm = document.getElementById("hMode"); if (hm?.tagName === "SELECT" && hm.value === "neural") hm.value = window.campusCity || "2d"; }
    orig(deskId, from);
    const top = document.querySelector("#brain .brain-top"); if (!top) return;
    let b = document.getElementById("brainNeural");
    if (!b) { b = document.createElement("button"); b.className = "pill"; b.id = "brainNeural"; b.title = "Trace this worker's job: hand-offs, sessions, sub-agents"; b.textContent = "🧬 Neural"; top.appendChild(b); }
    b.dataset.neural = deskId;
  };
})();
// A link straight in: /campus.html#neural=<desk>[&job=<id>][&mode=web|tree]
(function neuralFromHash() {
  const m = /^#neural=([^&]+)(.*)$/.exec(location.hash); if (!m) return;
  const q = new URLSearchParams(m[2].replace(/^&/, "")), id = m[1] === "all" ? null : decodeURIComponent(m[1]);
  const go = () => (data?.desks ? neuralOpen(id, { job: q.get("job"), mode: q.get("mode") }) : setTimeout(go, 400)); go();
})();
