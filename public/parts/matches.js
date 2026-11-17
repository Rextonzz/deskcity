// Paper Magic matches: the page's working part as a block (see public/parts/kit.js). Mounted by public/matches.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, api, bindRoot } from "/stats-lib.js";
import { today, confirmBox } from "/lib.js";
import { scope, lifecycle } from "/parts/kit.js";
import { stores } from "/hubinfo.js";

export const html = `<style>
[data-block="matches"] .btn:hover { color: var(--text-primary); background: var(--surface-2); }
  [data-block="matches"] .btn.main { background: #dc2626; border-color: #dc2626; color: #fff; font-size: 14px; padding: 7px 16px; }
  [data-block="matches"] input,
  [data-block="matches"] select,
  [data-block="matches"] textarea { background: var(--surface-2); border: 1px solid var(--line-strong); color: var(--text-primary); border-radius: 8px; padding: 6px 8px; font-size: 14px; width: 100%; }
  [data-block="matches"] .form { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  [data-block="matches"] .form label { font-size: 12px; color: var(--text-muted); display: flex; flex-direction: column; gap: 3px; }
  [data-block="matches"] .form .wide { grid-column: 1 / -1; }
  [data-block="matches"] .pips { display: flex; gap: 6px; }
  [data-block="matches"] .pips button { width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--line-strong); background: none; color: var(--text-secondary); font-weight: 600; }
  [data-block="matches"] .pips button[aria-pressed="true"] { background: var(--text-primary); color: var(--surface-1); }
  [data-block="matches"] .score { display: flex; gap: 6px; align-items: center; }
  [data-block="matches"] .score input { width: 56px; text-align: center; }
  [data-block="matches"] .seg { display: flex; }
  [data-block="matches"] .seg button { flex: 1; font-size: 14px; padding: 6px 8px; border: 1px solid var(--line-strong); background: none; color: var(--text-secondary); }
  [data-block="matches"] .seg button:first-child { border-radius: 8px 0 0 8px; }
  [data-block="matches"] .seg button:last-child { border-radius: 0 8px 8px 0; }
  [data-block="matches"] .seg button + button { border-left: none; }
  [data-block="matches"] .seg button[aria-pressed="true"] { background: var(--surface-3); color: var(--text-primary); font-weight: 600; }
  [data-block="matches"] .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
  [data-block="matches"] .tile .v { font-size: 22px; font-weight: 600; }
  [data-block="matches"] table { width: 100%; font-size: 14px; font-variant-numeric: tabular-nums; }
  [data-block="matches"] th { font-weight: 500; color: var(--text-muted); text-align: left; padding: 4px 8px 4px 0; }
  [data-block="matches"] td { padding: 5px 8px 5px 0; }
  [data-block="matches"] tr + tr td { border-top: 1px solid var(--line-soft); }
  [data-block="matches"] .r { text-align: right; }
  [data-block="matches"] .res { font-weight: 700; width: 22px; display: inline-block; }
  [data-block="matches"] .sub { font-size: 13px; color: var(--text-muted); }
</style>
<div class="flex items-center gap-2 flex-wrap" data-head>
  <a href="/api/pipeline/export/matches" class="px-3 py-1.5 rounded-lg border border-slate-300 text-sm" download>⬇ Download (CSV)</a>
</div>
<section class="card space-y-3" id="formBox">
  <h2 class="font-semibold" id="formTitle">Add a match</h2>
  <div class="form">
    <label>Date<input type="date" id="date" /></label>
    <label>Format<select id="format"></select></label>
    <label>Where<select id="place"></select></label>
    <label>Event<input id="event" list="evList" placeholder="FNM, league, casual" /></label>
    <label class="wide">Your deck<input id="myDeck" list="myList" placeholder="e.g. ${esc(stores.deck || "My deck")}" /></label>
    <label>Opponent<input id="opponent" list="oppNames" placeholder="Name (optional)" /></label>
    <label>Their deck<input id="oppDeck" list="oppList" placeholder="e.g. Mono-Red Aggro" /></label>
    <label>Their colours<div class="pips" id="pips"></div></label>
    <label id="scoreBox">Games (you – them – draws)<div class="score"><input type="number" min="0" max="9" id="won" value="0" /> – <input type="number" min="0" max="9" id="lost" value="0" /> – <input type="number" min="0" max="9" id="drawn" value="0" /></div></label>
    <label id="podBox" hidden>Result<div class="seg" id="podRes"><button type="button" data-r="W">Won</button><button type="button" data-r="L">Lost</button><button type="button" data-r="D">Draw</button></div></label>
    <label id="podSizeBox" hidden>Players<input type="number" min="2" max="8" id="podSize" value="4" /></label>
    <label>Game 1<div class="seg" id="play"><button type="button" data-p="1">On the play</button><button type="button" data-p="0">On the draw</button></div></label>
    <label class="wide">Notes<textarea id="notes" rows="2" placeholder="What decided it, cards that stood out, sideboard plans"></textarea></label>
  </div>
  <div class="flex gap-2 items-center flex-wrap"><button id="save" class="btn main">Save match</button><button id="cancel" class="btn" hidden>Cancel edit</button><span id="msg" class="sub"></span></div>
  <datalist id="myList"></datalist><datalist id="oppList"></datalist><datalist id="oppNames"></datalist><datalist id="evList"></datalist>
</section>

<section class="tiles" id="tiles"></section>

<div class="grid md:grid-cols-2 gap-5">
  <section class="card space-y-2"><h2 class="font-semibold">Your decks</h2><div id="byDeck" class="overflow-x-auto"></div></section>
  <section class="card space-y-2"><h2 class="font-semibold">Local meta (decks you've faced)</h2><div id="byOpp" class="overflow-x-auto"></div></section>
  <section class="card space-y-2"><h2 class="font-semibold">By format</h2><div id="byFormat" class="overflow-x-auto"></div></section>
  <section class="card space-y-2"><h2 class="font-semibold">By store, and play or draw</h2><div id="byPlace" class="overflow-x-auto"></div><div id="playDraw" class="overflow-x-auto"></div></section>
</div>

<section class="card space-y-2"><h2 class="font-semibold">Matches</h2><div id="list" class="overflow-x-auto"><p class="sub">Loading…</p></div></section>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "matches";
  const $ = scope(root), life = lifecycle();
  bindRoot(root, life);
  let data = null, editing = null, colors = new Set(), onPlay = null, podResult = null;
  const pct = (v) => (v == null ? "" : `${Math.round(v * 100)}%`);
  const rec = (r) => `${r.w}-${r.l}${r.d ? `-${r.d}` : ""}`;
  const WORD = { W: "Won", L: "Lost", D: "Draw" };

  $("pips").innerHTML = [..."WUBRG"].map((c) => `<button type="button" data-c="${c}" aria-pressed="false" title="${{ W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" }[c]}">${c}</button>`).join("");
  $("pips").onclick = (e) => { const b = e.target.closest("[data-c]"); if (!b) return; colors.has(b.dataset.c) ? colors.delete(b.dataset.c) : colors.add(b.dataset.c); drawPicks(); };
  $("play").onclick = (e) => { const b = e.target.closest("[data-p]"); if (!b) return; onPlay = onPlay === (b.dataset.p === "1") ? null : b.dataset.p === "1"; drawPicks(); };
  $("podRes").onclick = (e) => { const b = e.target.closest("[data-r]"); if (!b) return; podResult = b.dataset.r; drawPicks(); };
  $("format").onchange = drawPicks;
  function drawPicks() {
    $("pips").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(colors.has(b.dataset.c))));
    $("play").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(onPlay === (b.dataset.p === "1"))));
    $("podRes").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(podResult === b.dataset.r)));
    const pod = $("format").value === "Commander";
    $("scoreBox").hidden = pod;
    $("podBox").hidden = $("podSizeBox").hidden = !pod;
  }

  function reset() {
    editing = null; colors = new Set(); onPlay = null; podResult = null;
    $("date").value = today();
    ["event", "opponent", "oppDeck", "notes"].forEach((id) => ($(id).value = ""));
    ["won", "lost", "drawn"].forEach((id) => ($(id).value = 0));
    $("podSize").value = 4;
    $("formTitle").textContent = "Add a match";
    $("save").textContent = "Save match";
    $("cancel").hidden = true;
    drawPicks();
  }

  async function load() {
    try { data = await api("/paper-matches"); } catch (err) { $("list").innerHTML = `<p class="sub">${esc(err.noRoute ? "The app needs a restart to show this page." : err.message)}</p>`; return; }
    if (!$("format").options.length) {
      $("format").innerHTML = data.formats.map((f) => `<option>${esc(f)}</option>`).join("");
      $("place").innerHTML = `<option value="">Pick one</option>` + data.places.map((f) => `<option>${esc(f)}</option>`).join("");
      let last = null;
      try { last = JSON.parse(localStorage.getItem("pm:last") || "null"); } catch {}
      if (last) { $("format").value = last.format || "Commander"; $("place").value = last.place || ""; $("myDeck").value = last.myDeck || ""; }
      reset();
    }
    const opt = (l) => l.map((x) => `<option value="${esc(x)}"></option>`).join("");
    $("myList").innerHTML = opt(data.suggest.myDecks);
    $("oppList").innerHTML = opt(data.suggest.oppDecks);
    $("oppNames").innerHTML = opt(data.suggest.opponents);
    $("evList").innerHTML = opt(data.suggest.events);
    draw();
  }

  function table(rows, label) {
    if (!rows.length) return `<p class="sub">Nothing yet.</p>`;
    return `<table><tr><th>${label}</th><th class="r">Played</th><th class="r">Record</th><th class="r">Win rate</th></tr>${rows.map((r) => `<tr><td>${esc(r.k)}</td><td class="r">${r.n}</td><td class="r">${rec(r)}</td><td class="r">${pct(r.rate)}${r.n < 5 ? ' <span class="sub">(few)</span>' : ""}</td></tr>`).join("")}</table>`;
  }
  function draw() {
    const t = data.total;
    $("tiles").innerHTML = [
      ["Matches", t.n, data.matches[0] ? `last on ${new Date(`${data.matches[0].date}T12:00`).toLocaleDateString()}` : "none yet"],
      ["Record", t.n ? rec(t) : "–", "wins, losses, draws"],
      ["Win rate", t.n ? pct(t.rate) : "–", "a draw counts as half"],
      ["Last 10", data.last10 ? pct(data.last10.rate) : "–", data.last10 ? rec(data.last10) : ""],
    ].map(([l, v, s]) => `<div class="card tile"><div class="l">${l}</div><div class="v">${esc(String(v))}</div><div class="l">${esc(s)}</div></div>`).join("");
    $("byDeck").innerHTML = table(data.byDeck, "Deck");
    $("byOpp").innerHTML = table(data.byOpp, "Their deck");
    $("byFormat").innerHTML = table(data.byFormat, "Format");
    $("byPlace").innerHTML = table(data.byPlace, "Where");
    $("playDraw").innerHTML = data.playDraw.length ? `<div class="mt-3">${table(data.playDraw, "Game 1")}</div>` : "";
    $("list").innerHTML = data.matches.length
      ? `<table><tr><th>Date</th><th>Result</th><th>Your deck</th><th>Them</th><th></th></tr>${data.matches.map((m) => `<tr>
          <td style="white-space:nowrap">${new Date(`${m.date}T12:00`).toLocaleDateString()}</td>
          <td style="white-space:nowrap"><span class="res">${m.result === "W" ? "✓" : m.result === "L" ? "✗" : "="}</span>${WORD[m.result]}${m.format === "Commander" ? ` <span class="sub">${m.podSize || ""}-player</span>` : ` ${m.won}-${m.lost}${m.drawn ? `-${m.drawn}` : ""}`}</td>
          <td>${esc(m.myDeck)}<div class="sub">${esc([m.format, m.place, m.event].filter(Boolean).join(" · "))}</div></td>
          <td>${esc(m.oppDeck || "Unknown deck")}${m.oppColors ? ` <span class="sub">${esc(m.oppColors)}</span>` : ""}${m.opponent ? `<div class="sub">${esc(m.opponent)}</div>` : ""}${m.notes ? `<div class="sub">${esc(m.notes)}</div>` : ""}</td>
          <td style="white-space:nowrap"><button class="btn" data-edit="${m.id}">Edit</button> <button class="btn" data-del="${m.id}">Delete</button></td></tr>`).join("")}</table>`
      : `<p class="sub">No matches yet. Add your first one above after your next game.</p>`;
    $("list").querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => startEdit(b.dataset.edit)));
    $("list").querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
      if (!await confirmBox({ title: "Delete this match?", yes: "Delete", no: "Cancel" })) return;
      await api(`/paper-matches/${b.dataset.del}/delete`, {});
      load();
    }));
  }

  function startEdit(id) {
    const m = data.matches.find((x) => x.id === id);
    if (!m) return;
    editing = id;
    for (const k of ["date", "format", "place", "event", "myDeck", "opponent", "oppDeck", "won", "lost", "drawn", "notes"]) $(k).value = m[k] ?? "";
    $("podSize").value = m.podSize || 4;
    colors = new Set(m.oppColors.split(""));
    onPlay = m.onPlay;
    podResult = m.result;
    $("formTitle").textContent = "Edit match";
    $("save").textContent = "Save changes";
    $("cancel").hidden = false;
    drawPicks();
    $("formBox").scrollIntoView({ behavior: "smooth" });
  }
  $("cancel").onclick = reset;

  $("save").onclick = async () => {
    const body = { date: $("date").value, format: $("format").value, place: $("place").value, event: $("event").value, myDeck: $("myDeck").value, opponent: $("opponent").value, oppDeck: $("oppDeck").value, oppColors: [...colors].join(""), notes: $("notes").value, onPlay };
    if (body.format === "Commander") {
      if (!podResult) return ($("msg").textContent = "Pick Won, Lost or Draw.");
      Object.assign(body, { won: 0, lost: 0, drawn: 0, result: podResult, podSize: +$("podSize").value });
    } else {
      Object.assign(body, { won: +$("won").value, lost: +$("lost").value, drawn: +$("drawn").value });
      if (!body.won && !body.lost && !body.drawn) return ($("msg").textContent = "Type the games score, like 2 – 1.");
    }
    try {
      await api(editing ? `/paper-matches/${editing}` : "/paper-matches", body);
      try { localStorage.setItem("pm:last", JSON.stringify({ format: body.format, place: body.place, myDeck: body.myDeck })); } catch {}
      $("msg").textContent = editing ? "Saved." : "Match added.";
      const keep = { format: body.format, place: body.place, myDeck: body.myDeck };
      reset();
      Object.entries(keep).forEach(([k, v]) => ($(k).value = v));
      drawPicks();
      load();
    } catch (err) { $("msg").textContent = err.message; }
  };
  load();
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
