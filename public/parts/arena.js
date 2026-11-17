// MTG Arena: the page's working part as a block (see public/parts/kit.js). Mounted by public/arena.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, api, bindRoot } from "/stats-lib.js";
import { scope, lifecycle } from "/parts/kit.js";

export const html = `<style>
[data-block="arena"] .tile .n { font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; }
  [data-block="arena"] table { width: 100%; font-size: 14px; font-variant-numeric: tabular-nums; }
  [data-block="arena"] td,
  [data-block="arena"] th { padding: 6px 8px 6px 0; text-align: left; vertical-align: top; }
  [data-block="arena"] th { font-weight: 500; color: var(--text-muted); }
  [data-block="arena"] tr + tr td { border-top: 1px solid var(--line-soft); }
  [data-block="arena"] .win { color: var(--good-text); }
  [data-block="arena"] .loss { color: var(--bad-text); }
</style>
<div class="flex items-center gap-2 flex-wrap" data-head>
  <button id="read" class="text-sm px-3 py-1.5 rounded-lg border border-slate-300">Read log now</button>
</div>
<p id="note" class="text-sm text-slate-500"></p>
<section id="tiles" class="grid grid-cols-2 md:grid-cols-4 gap-3"></section>
<section class="card space-y-2"><h2 class="font-semibold">By deck</h2><div id="decks" class="overflow-x-auto"><p class="text-sm text-slate-500">Loading…</p></div></section>
<section class="card space-y-2"><h2 class="font-semibold">By event</h2><div id="events" class="overflow-x-auto"></div></section>
<section class="card space-y-2"><h2 class="font-semibold">Recent matches</h2><div id="recent" class="overflow-x-auto"></div></section>
<section class="card space-y-2"><h2 class="font-semibold">Arena's own event records</h2><p class="sub">Wins and losses Arena keeps for each event you've joined (all time, on every device). "Elsewhere" counts games added to a record since tracking started that this PC's log never saw, so phone games show up there, without match details.</p><div id="totals" class="overflow-x-auto"></div></section>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "arena";
  const $ = scope(root), life = lifecycle();
  bindRoot(root, life);
  const pct = (r) => (r == null ? "–" : `${r}%`);
  const tile = (num, label) => `<div class="card tile"><div class="n">${num}</div><div class="l">${esc(label)}</div></div>`;
  const groupTable = (rows) => rows.length ? `<table><tr><th>Name</th><th>Played</th><th>Won</th><th>Win rate</th><th>Last</th></tr>${rows.map((g) => `<tr><td>${esc(g.name)}</td><td>${g.played}</td><td>${g.won}</td><td>${pct(g.rate)}</td><td class="sub">${g.last ? esc(new Date(g.last).toLocaleDateString()) : ""}</td></tr>`).join("")}</table>` : '<p class="sub">No matches yet.</p>';

  function draw(a) {
    $("note").innerHTML = `${a.lastRead ? `Log last read ${esc(new Date(a.lastRead).toLocaleString())}. ` : ""}It's read once a day; Arena only keeps your last two sessions, so after a day with three or more Arena launches on the PC, press Read log now so none are missed. Match details start from when tracking began; the totals at the top come from Arena's own records, so they include older and phone games.${a.detailedOff ? ' <span class="text-amber-700">Detailed Logs looks off: turn it on in Arena (Settings, Account, Detailed Logs) or matches will not show.</span>' : ""}${a.error ? ` <span class="text-red-700">${esc(a.error)}</span>` : ""}`;
    const r = a.records || {};
    $("tiles").innerHTML = [tile(r.played ?? "–", "games in Arena's records"), tile(pct(r.rate), "win rate (Arena's records)"), tile(a.played, `matches tracked in detail (${pct(a.rate)} won)`), tile(a.elsewhere || 0, "played elsewhere since tracking (phone)")].join("");
    $("decks").innerHTML = groupTable(a.byDeck);
    $("events").innerHTML = groupTable(a.byEvent);
    $("recent").innerHTML = a.recent.length ? `<table><tr><th>When</th><th>Result</th><th>Deck</th><th>Event</th><th>Opponent</th></tr>${a.recent.map((m) => `<tr><td class="sub">${m.at ? esc(new Date(m.at).toLocaleString()) : ""}</td><td class="${m.won ? "win" : "loss"}">${m.won ? "Won" : "Lost"}${m.games > 1 ? ` ${m.gamesWon}-${m.games - m.gamesWon}` : ""}${m.reason && m.reason !== "Unknown" ? ` <span class="sub">(${esc(m.reason)})</span>` : ""}</td><td>${esc(m.deck || "")}</td><td>${esc(m.eventLabel)}</td><td>${esc(m.opponent || "")}</td></tr>`).join("")}</table>` : '<p class="sub">No matches yet. Play a game in Arena and they show up here.</p>';
    $("totals").innerHTML = a.events.length ? `<table><tr><th>Event</th><th>Deck</th><th>W</th><th>L</th><th>Win rate</th><th>Elsewhere</th></tr>${a.events.map((e) => `<tr><td>${esc(e.event)}</td><td>${esc(e.deck)}</td><td>${e.wins}</td><td>${e.losses}</td><td>${pct(e.rate)}</td><td>${e.elsewhere || ""}</td></tr>`).join("")}</table>` : '<p class="sub">None yet.</p>';
  }
  async function load() {
    try { draw(await api("/arena")); } catch (err) { $("note").textContent = err.noRoute ? "The app needs a restart to show this page." : err.message; }
  }
  $("read").onclick = async () => {
    $("read").disabled = true;
    try { draw(await api("/arena/read", {})); } catch (err) { $("note").textContent = err.message; }
    $("read").disabled = false;
  };
  load();
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
