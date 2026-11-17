// Neural view: replay a run (2026-11-14). The idea is session replay from agent-ops tools (AgentOps and others); none
// of their code is used. "▶ Replay" on the job tree plays the picked node's work (or the whole tree) back in time order:
// nodes appear as their time comes (later ones are ghosted), the current step pulses and is labelled on the map, the
// list under the map follows it, and a clock shows the replay time and "step N of M".
// Controls: play / pause, back and on one step, speed (1×, 4×, 16×, or Steps: one step every 0.7 s), a scrubber, and
// "Whole tree". Long idle gaps are cut short (at most 2 s of replay time, at 1×) and the clock says "… 40 min later".
// The replay works on the tree as it was when it started: the 5-second refresh holds off until you leave it (Done, Esc,
// switching job, worker or mode). Diving in and out still works while it plays. Reduced motion: no pulse or travel dot.
// Classic script, same global scope as the other campus parts (uses neural, neuralFind, neuralFeed, neuralState,
// neuralPoll, neuralCrumbs, neuralCrumbLabel, neuralSize, esc, BRAIN_ST). Hooks in neural.js: neuralMode (stop),
// neuralPoll (hold), neuralFeed (the replay list), neuralDraw (tick, ghosting, the pulse and label).
const NRP_GAP = 2000; // longest pause between two steps, in replay time at 1× (ms); a longer gap is skipped and said
const NRP_STEP_MS = 700; // "Steps" speed: one step every 0.7 s
const NRP_SAY = 30000; // a cut gap this long or longer is said ("… 40 min later"); shorter cuts pass quietly
const NRP_GHOST = 0.13; // how faint a node is before its time
const nrpCalm = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const nrpMs = (t) => { const v = Date.parse(t); return Number.isNaN(v) ? 0 : v; };
const nrpClock = (ms, days) => new Date(ms).toLocaleString([], days ? { weekday: "short", hour: "numeric", minute: "2-digit", second: "2-digit" } : { hour: "numeric", minute: "2-digit", second: "2-digit" });
function nrpGapText(ms) {
  const s = ms / 1000;
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 129600) { const h = Math.round(s / 360) / 10; return `${h} hour${h === 1 ? "" : "s"}`; }
  const d = Math.round(s / 8640) / 10; return `${d} day${d === 1 ? "" : "s"}`;
}

// ---------- what is replayed: every step, hand-off, session, sub-agent and finished reply under a node ----------
function nrpItems(x) {
  const out = [], st = Object.fromEntries(BRAIN_ST.map(([k, ic, nm]) => [k, [ic, nm]]));
  const put = (node, at, text, o = {}) => out.push({ node, at: nrpMs(at), text, ...o });
  const add = (y, top) => {
    if (y.kind === "step") { const s = st[y.station]; put(y, y.at, `${s ? s[0] : "🔧"} ${y.tool || "step"}${y.label && y.label !== y.tool ? ` · ${y.label}` : ""}`, { bad: y.failed }); return; }
    if (y.kind === "more") { put(y, y.at, `⋯ ${y.hidden} earlier steps (not kept, only the newest 25 are)`, { mark: true }); return; }
    if (y.kind === "job") put(y, y.at, top ? `📌 Job started on ${y.desk}: ${y.label || "job"}` : `${y.edge === "retry" ? "↻ Retried on" : "➜ Handed to"} ${y.desk}: ${y.label || "job"}`, { mark: true });
    else if (y.kind === "session") put(y, y.at, `🖥️ ${y.label} started`, { mark: true });
    else if (y.kind === "subagent") put(y, y.at, `🤝 ${y.label} ${y.legacy ? "finished" : "started"}`, { mark: true });
    y.children.forEach((c) => add(c, false));
    if (y.kind === "turn" && !y.working) put(y, y.end, `💬 ${y.label} finished`, { mark: true });
  };
  add(x, true);
  return out.map((it, i) => ({ ...it, i })).sort((a, b) => a.at - b.at || a.i - b.i);
}

// ---------- the controls (made the first time the job tree shows) ----------
function nrpEnsure() {
  const root = document.getElementById("neural"); if (!root) return;
  if (!document.getElementById("nrpBtn")) {
    const b = document.createElement("button");
    b.className = "pill"; b.id = "nrpBtn"; b.type = "button"; b.textContent = "▶ Replay";
    b.title = "Play this run back in time order: the picked node's work, or the whole tree";
    b.onclick = () => (neural?.rp ? nrpEnd(neural, true) : neuralReplayStart());
    root.querySelector(".neural-bar")?.appendChild(b);
  }
  if (document.getElementById("nrpBar")) return;
  const bar = document.createElement("div");
  bar.id = "nrpBar"; bar.className = "nrp-bar"; bar.hidden = true;
  bar.setAttribute("role", "group"); bar.setAttribute("aria-label", "Replay controls");
  bar.innerHTML = `<div class="nrp-row"><button class="pill" id="nrpPlay" type="button">⏸ Pause</button><button class="pill" id="nrpPrev" type="button" title="Back one step" aria-label="Back one step">⏮</button><button class="pill" id="nrpNext" type="button" title="On one step" aria-label="On one step">⏭</button><select id="nrpSpeed" aria-label="Replay speed" title="Speed: idle gaps are cut to 2 s at 1×; Steps jumps one step at a time"><option value="1">1×</option><option value="4" selected>4×</option><option value="16">16×</option><option value="steps">Steps</option></select><button class="pill" id="nrpWhole" type="button" title="Replay the whole tree instead of the picked node">Whole tree</button><button class="pill" id="nrpStop" type="button" title="Leave the replay and go back to the live tree (Esc)">✕ Done</button></div>
    <input type="range" id="nrpRange" min="0" max="1" step="1" value="0" aria-label="Replay time: drag to scrub">
    <div class="nrp-clock" id="nrpClock"></div>`;
  (document.getElementById("neuralCrumbs") || root.querySelector(".neural-bar")).after(bar);
  const rp = () => neural?.rp;
  document.getElementById("nrpPlay").onclick = () => nrpToggle();
  document.getElementById("nrpPrev").onclick = () => { const r = rp(); if (r) { r.playing = false; nrpSeekIdx(Math.max(0, r.idx - 1)); nrpPlayBtn(); } };
  document.getElementById("nrpNext").onclick = () => { const r = rp(); if (r) { r.playing = false; nrpSeekIdx(Math.min(r.items.length - 1, r.idx + 1)); nrpPlayBtn(); } };
  document.getElementById("nrpSpeed").onchange = (e) => { const r = rp(); if (r) { r.speed = e.target.value; r.acc = 0; } };
  document.getElementById("nrpWhole").onclick = () => { const n = neural; if (n?.rp) neuralReplayStart(n.tree.root.id); };
  document.getElementById("nrpStop").onclick = () => { if (neural?.rp) nrpEnd(neural, true); };
  const range = document.getElementById("nrpRange");
  range.addEventListener("input", () => { const r = rp(); if (!r) return; r.playing = false; nrpSeek(Number(range.value)); nrpPlayBtn(); });
}
function nrpToggle() {
  const r = neural?.rp; if (!r) return;
  if (!r.playing && r.idx >= r.items.length - 1 && r.rho >= r.R) nrpSeekIdx(0); // at the end: start again
  r.playing = !r.playing; r.last = performance.now(); r.acc = 0;
  nrpPlayBtn();
}
function nrpPlayBtn() {
  const r = neural?.rp, b = document.getElementById("nrpPlay"); if (!r || !b) return;
  const end = r.idx >= r.items.length - 1 && r.rho >= r.R;
  b.textContent = r.playing ? "⏸ Pause" : end ? "↺ Again" : "▶ Play";
  b.setAttribute("aria-label", r.playing ? "Pause the replay" : end ? "Play the replay again from the start" : "Play the replay");
}

// ---------- start, stop, hold ----------
// `scopeId`: the node to replay (default: the picked node; a step, or a node with too little under it, replays the
// nearest node above it that has more).
function neuralReplayStart(scopeId) {
  const n = neural; if (!n?.tree || n.mode !== "tree") return;
  if (n.rp) nrpEnd(n, false);
  nrpEnsure();
  const root = n.tree.root, parent = new Map();
  neuralWalk(root, (y) => y.children.forEach((c) => parent.set(c.id, y)));
  let x = neuralFind(root, scopeId || n.sel) || root;
  while (x !== root && nrpItems(x).length < 2) x = parent.get(x.id) || root;
  const items = nrpItems(x);
  if (!items.length) { document.getElementById("neuralState").textContent = "Nothing to replay here yet: no steps were reported."; return; }
  // replay time: real gaps, each cut to NRP_GAP at most (a cut gap is said on the clock and in the list)
  const r = [0], skip = [0];
  for (let i = 1; i < items.length; i++) { const gap = Math.max(0, items[i].at - items[i - 1].at); r.push(r[i - 1] + Math.min(gap, NRP_GAP)); skip.push(gap >= NRP_SAY ? gap : 0); }
  const speed = document.getElementById("nrpSpeed")?.value || "4";
  n.rp = { tree: n.tree, scope: x, items, r, skip, R: r[r.length - 1], rho: 0, idx: -1, T: items[0].at, playing: true, speed, acc: 0,
    last: performance.now(), changedAt: 0, prevNode: null, skipNote: null, baseOpen: n.open, baseSel: n.sel, lastSel: n.sel,
    auto: new Set(), chain: new Set(), parent, msOf: new Map(), rows: [], days: new Date(items[0].at).toDateString() !== new Date(items[items.length - 1].at).toDateString(), clock: "" };
  n.open = new Set(n.open); // the replay opens and closes nodes on its own copy; leaving puts the old one back
  const range = document.getElementById("nrpRange"); range.max = String(Math.max(1, Math.round(n.rp.R))); range.value = "0";
  document.getElementById("nrpBar").hidden = false;
  document.getElementById("nrpWhole").style.display = x === root ? "none" : "";
  const btn = document.getElementById("nrpBtn"); btn.textContent = "⏹ Replay"; btn.classList.add("on"); btn.setAttribute("aria-pressed", "true");
  btn.title = "Leave the replay and go back to the live tree";
  document.getElementById("neuralState").textContent = "Tap a row to jump there. Live updates wait until you leave (✕ Done or Esc).";
  document.getElementById("neural").classList.add("nrp-on");
  nrpSeekIdx(0);
  neuralFeed();
  nrpPlayBtn();
}
// Leave the replay. Puts back what was open and picked (when it's still the same tree), and catches up with the hub.
function nrpEnd(n, catchUp) {
  const rp = n?.rp; if (!rp) return;
  n.rp = null;
  if (n.tree === rp.tree) { n.open = rp.baseOpen; if (rp.baseSel && neuralFind(n.tree.root, rp.baseSel)) n.sel = rp.baseSel; }
  nrpHide();
  if (catchUp && n.tree && n.mode === "tree") { neuralState(); neuralFeed(); neuralPoll(); }
}
function nrpHide() {
  document.getElementById("neural")?.classList.remove("nrp-on");
  const bar = document.getElementById("nrpBar"); if (bar) bar.hidden = true;
  const btn = document.getElementById("nrpBtn");
  if (btn) { btn.textContent = "▶ Replay"; btn.classList.remove("on"); btn.setAttribute("aria-pressed", "false"); btn.title = "Play this run back in time order: the picked node's work, or the whole tree"; }
}
// neuralMode hook: switching mode (or worker, or job, which all go through it) ends a replay; the button is tree-only.
function neuralReplayStop(mode) {
  nrpEnsure();
  if (neural?.rp) nrpEnd(neural, false);
  nrpHide();
  const btn = document.getElementById("nrpBtn"); if (btn) btn.style.display = mode === "tree" ? "" : "none";
}
// neuralPoll hook: true = skip this refresh (a replay is playing the tree it started with). A tree swapped out from
// under it (another job picked) ends the replay instead.
function neuralReplayHold() {
  const n = neural, rp = n?.rp; if (!rp) return false;
  if (n.tree === rp.tree && n.mode === "tree") return true;
  nrpEnd(n, false);
  return false;
}

// ---------- moving through time ----------
function nrpIdxAt(rp, rho) { let lo = 0, hi = rp.r.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (rp.r[m] <= rho) lo = m; else hi = m - 1; } return lo; }
// replay time -> the real time it stands for (inside a cut gap the real time runs faster)
function nrpTimeAt(rp, rho, i) {
  const a = rp.items[i], b = rp.items[i + 1]; if (!b) return a.at;
  const span = rp.r[i + 1] - rp.r[i];
  return span > 0 ? a.at + ((Math.min(rho, rp.r[i + 1]) - rp.r[i]) * (b.at - a.at)) / span : a.at;
}
function nrpSeek(rho) {
  const rp = neural?.rp; if (!rp) return;
  rp.rho = Math.max(0, Math.min(rp.R, rho));
  const i = nrpIdxAt(rp, rp.rho);
  rp.T = nrpTimeAt(rp, rp.rho, i);
  if (i !== rp.idx) nrpSetIdx(i);
  nrpBar();
}
// to one item exactly (several items can share a moment: "Steps" and ⏮ ⏭ still visit each one)
function nrpSeekIdx(i) {
  const rp = neural?.rp; if (!rp) return;
  rp.rho = rp.r[i]; rp.T = rp.items[i].at;
  if (i !== rp.idx) nrpSetIdx(i);
  nrpBar();
}
function nrpSetIdx(i) {
  const n = neural, rp = n.rp, prev = rp.idx, it = rp.items[i];
  rp.prevNode = prev >= 0 ? rp.items[prev].node.id : null;
  rp.idx = i; rp.changedAt = performance.now();
  // a skipped gap on the way forward is said on the map and the clock
  if (i > prev && prev >= 0) { let gap = 0; for (let k = prev + 1; k <= i; k++) gap = Math.max(gap, rp.skip[k]); rp.skipNote = gap ? { text: `… ${nrpGapText(gap)} later`, at: rp.changedAt } : rp.skipNote; }
  else if (i < prev) rp.skipNote = null;
  // the current step and everything above it is open, so it's on the map
  const chain = new Set([it.node.id]);
  for (let p = rp.parent.get(it.node.id); p; p = rp.parent.get(p.id)) chain.add(p.id);
  rp.chain = chain;
  for (const id of rp.auto) {
    const node = neuralFind(rp.tree.root, id);
    // going back: what the replay opened after this moment closes again; a station or sub-agent stays open only
    // while the replay is in it, so finished ones fold back to one node with its count
    if (!chain.has(id) && (!node || nrpNodeMs(rp, node) > it.at || node.kind === "station" || node.kind === "subagent")) { n.open.delete(id); rp.auto.delete(id); }
  }
  for (const id of chain) if (id !== it.node.id && !n.open.has(id)) { n.open.add(id); rp.auto.add(id); }
  nrpRows(prev, i);
}
function nrpNodeMs(rp, x) { let v = rp.msOf.get(x.id); if (v == null) { v = nrpMs(x.at); rp.msOf.set(x.id, v); } return v; }
// the clock and the scrubber
function nrpBar() {
  const rp = neural?.rp; if (!rp) return;
  const range = document.getElementById("nrpRange"), clock = document.getElementById("nrpClock");
  if (document.activeElement !== range || rp.playing) range.value = String(Math.round(rp.rho));
  const skip = rp.skipNote && performance.now() - rp.skipNote.at < 2500 ? ` · ${rp.skipNote.text}` : "";
  const end = rp.idx >= rp.items.length - 1 && rp.rho >= rp.R ? " · the end" : "";
  const txt = `${nrpClock(rp.T, rp.days)} · step ${rp.idx + 1} of ${rp.items.length}${skip}${end}`;
  if (txt !== rp.clock) { rp.clock = txt; clock.textContent = txt; range.setAttribute("aria-valuetext", `${nrpClock(rp.T, rp.days)}, step ${rp.idx + 1} of ${rp.items.length}`); }
}

// ---------- every frame (from neuralDraw) ----------
function neuralReplayTick(now) {
  const n = neural, rp = n?.rp;
  const btn = document.getElementById("nrpBtn"); if (btn && n) { const off = !n.tree; if (btn.disabled !== off) btn.disabled = off; }
  if (!rp) return false;
  const dt = Math.min(250, Math.max(0, now - rp.last)); rp.last = now;
  if (rp.playing) {
    if (rp.speed === "steps") {
      rp.acc += dt;
      if (rp.acc >= NRP_STEP_MS) { rp.acc = 0; if (rp.idx >= rp.items.length - 1) { rp.playing = false; rp.rho = rp.R; } else nrpSeekIdx(rp.idx + 1); }
    } else nrpSeek(rp.rho + dt * (Number(rp.speed) || 1));
    if (rp.rho >= rp.R && rp.speed !== "steps") rp.playing = false;
    if (!rp.playing) { nrpBar(); nrpPlayBtn(); }
  } else if (rp.skipNote && now - rp.skipNote.at < 2600) nrpBar(); // let the "later" note on the clock run out
  return true;
}
// how strongly to draw a node: faint before its time; the current step and what's above it always full
function neuralReplayAlpha(x) {
  const rp = neural?.rp; if (!rp) return 1;
  if (rp.chain.has(x.id)) return 1;
  return nrpNodeMs(rp, x) <= rp.T ? 1 : NRP_GHOST;
}
// on top of the map: the current step pulses and is labelled; a dot runs to it from its parent; skipped gaps are said
function neuralReplayDraw(g, pos, w, h, now) {
  const rp = neural?.rp; if (!rp) return;
  const it = rp.items[rp.idx]; if (!it) return;
  const calm = nrpCalm();
  let id = it.node.id, p = null;
  while (id && !(p = pos.find((q) => q.node.id === id))) id = rp.parent.get(id)?.id; // dived elsewhere: its nearest node on the map
  g.save();
  g.textAlign = "center"; g.textBaseline = "middle";
  if (p) {
    const s = neuralSize(p.node.kind), age = now - rp.changedAt, col = it.bad ? "255,123,123" : "255,255,255";
    if (!calm && p.parent && age < 380) { const f = age / 380, q = p.parent; g.fillStyle = `rgba(${col},0.95)`; g.beginPath(); g.arc(q.x + (p.x - q.x) * f, q.y + (p.y - q.y) * f, 3.5, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = `rgb(${col})`; g.lineWidth = 2.2; g.beginPath(); g.arc(p.x, p.y, s + 4, 0, Math.PI * 2); g.stroke();
    if (calm) { g.lineWidth = 1; g.beginPath(); g.arc(p.x, p.y, s + 8, 0, Math.PI * 2); g.stroke(); }
    else { const k = (now % 1100) / 1100; g.strokeStyle = `rgba(${col},${0.85 * (1 - k)})`; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, s + 5 + k * 16, 0, Math.PI * 2); g.stroke(); }
    // the label: what this step was, in a box that stays on screen
    g.font = "600 11.5px system-ui, 'Segoe UI Emoji', 'Apple Color Emoji'";
    let txt = it.text + (it.bad ? " ✕ failed" : "");
    const max = Math.min(w - 16, 320);
    while (txt.length > 4 && g.measureText(txt).width + 14 > max) txt = txt.slice(0, -2);
    if (txt !== it.text + (it.bad ? " ✕ failed" : "")) txt = txt.slice(0, -1) + "…";
    const bw = g.measureText(txt).width + 14, bh = 20, below = !p.parent || p.y - s - 34 < 4; // under the centre node: its own label sits above
    const bx = Math.max(4, Math.min(w - bw - 4, p.x - bw / 2)), by = below ? Math.min(h - bh - 4, p.y + s + 12) : p.y - s - 34;
    g.fillStyle = "rgba(8,11,18,0.94)"; g.strokeStyle = `rgba(${col},0.9)`; g.lineWidth = 1.2;
    g.beginPath(); g.roundRect(bx, by, bw, bh, 6); g.fill(); g.stroke();
    g.fillStyle = "#fff"; g.fillText(txt, bx + bw / 2, by + bh / 2 + 0.5);
  }
  // top left: it's a replay, and when
  g.font = "700 10.5px system-ui"; g.textAlign = "left";
  const tag = `⏵ REPLAY · ${nrpClock(rp.T, rp.days)}`, tw = g.measureText(tag).width + 12;
  g.fillStyle = "rgba(8,11,18,0.85)"; g.beginPath(); g.roundRect(6, 6, tw, 18, 9); g.fill();
  g.fillStyle = "#dfe6f2"; g.fillText(tag, 12, 15.5);
  // a cut gap: "… 40 min later", fading (still for reduced motion)
  if (rp.skipNote) {
    const f = (now - rp.skipNote.at) / 1800;
    if (f < 1) {
      g.globalAlpha = calm ? 1 : Math.min(1, 2 * (1 - f));
      g.font = "700 13px system-ui"; g.textAlign = "center";
      const sw = g.measureText(rp.skipNote.text).width + 18;
      g.fillStyle = "rgba(8,11,18,0.92)"; g.beginPath(); g.roundRect(w / 2 - sw / 2, 30, sw, 24, 12); g.fill();
      g.strokeStyle = "rgba(255,255,255,0.5)"; g.lineWidth = 1; g.stroke();
      g.fillStyle = "#fff"; g.fillText(rp.skipNote.text, w / 2, 42.5);
    }
  }
  g.restore();
}

// ---------- the list under the map: every replayed step in time order, the current one marked ----------
// neuralFeed hook: true = the replay drew the list.
function neuralReplayFeed() {
  const n = neural, rp = n?.rp, el = document.getElementById("neuralFeed"); if (!rp || !el) return false;
  // a step tapped on the map: jump the replay there (diving in also picks, but leaves the replay where it is)
  if (n.sel !== rp.lastSel) {
    rp.lastSel = n.sel;
    if (n.sel !== n.sub) {
    const k = rp.items.findIndex((it) => it.node.id === n.sel && it.node.kind !== "turn");
    if (k >= 0 && k !== rp.idx) { rp.playing = false; nrpSeekIdx(k); nrpPlayBtn(); }
    }
  }
  const first = rp.items[0].at, last = rp.items[rp.items.length - 1].at;
  const head = `<div class="neural-head"><b>▶ Replaying ${esc(rp.scope === rp.tree.root ? "the whole tree" : neuralCrumbLabel(rp.scope))}</b><div class="sub">${rp.items.length} step${rp.items.length === 1 ? "" : "s"} · ${esc(nrpClock(first, rp.days))} to ${esc(nrpClock(last, rp.days))} · long waits are cut short · live updates wait until you leave the replay</div></div>`;
  el.innerHTML = head + rp.items.map((it, i) => `${rp.skip[i] ? `<div class="nrp-gap">… ${esc(nrpGapText(rp.skip[i]))} later</div>` : ""}<div class="brain-row${it.bad ? " bad" : ""}${it.mark ? " mark" : ""}" data-nrp="${i}" role="button" tabindex="0" aria-label="Jump the replay to step ${i + 1}"><span class="brain-time">${esc(nrpClock(it.at, rp.days))}</span><span>${esc(it.text)}${it.bad ? " · <b>✕ failed</b>" : ""}</span></div>`).join("");
  rp.rows = [...el.querySelectorAll("[data-nrp]")];
  nrpRows(-1, rp.idx, true);
  return true;
}
// mark the current row (bold, ▶ and a bar: not colour alone), dim what's still to come, keep the current one in view
function nrpRows(prev, i, all) {
  const rp = neural?.rp; if (!rp?.rows.length) return;
  const lo = all ? 0 : Math.max(0, Math.min(prev, i)), hi = all ? rp.rows.length - 1 : Math.max(prev, i);
  for (let k = lo; k <= hi; k++) { const r = rp.rows[k]; if (!r) continue; r.classList.toggle("nrp-now", k === i); r.classList.toggle("nrp-later", k > i); if (k === i) r.setAttribute("aria-current", "step"); else r.removeAttribute("aria-current"); }
  const row = rp.rows[i], feed = document.getElementById("neuralFeed");
  if (row && feed) {
    const fr = feed.getBoundingClientRect(), rr = row.getBoundingClientRect();
    if (rr.top < fr.top + 30 || rr.bottom > fr.bottom - 10) feed.scrollTo({ top: feed.scrollTop + rr.top - fr.top - feed.clientHeight / 2 + rr.height / 2, behavior: nrpCalm() || !rp.playing ? "auto" : "smooth" });
  }
}
// rows: tap or Enter to jump there
document.addEventListener("click", (e) => {
  const row = e.target.closest?.("[data-nrp]"); if (!row || !neural?.rp) return;
  e.preventDefault(); neural.rp.playing = false; nrpSeekIdx(Number(row.dataset.nrp)); nrpPlayBtn();
});
// keys while replaying (before the view's own: Esc leaves the replay, not the level): Space plays or pauses
window.addEventListener("keydown", (e) => {
  const rp = neural?.rp; if (!rp) return;
  const row = e.target.closest?.("[data-nrp]");
  if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); rp.playing = false; nrpSeekIdx(Number(row.dataset.nrp)); nrpPlayBtn(); return; }
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); nrpEnd(neural, true); return; }
  if (e.key === " " && !e.target.closest?.("input, select, textarea, button, [role=button]")) { e.preventDefault(); e.stopPropagation(); nrpToggle(); }
}, true);
