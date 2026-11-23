// Campus: the casino panel (2026-11-23). Shows how the workers' slot sessions are going: measured return against the
// game table's own base-game return, hit rate, biggest win, longest losing streak, why sessions stopped, each play style
// and the last sessions. Display only: the rules live in src/pipeline/agents/casino.js, and on/off is a setting
// (agents.casino.on). Data: GET /agents/casino. Play credits only, never real money; base game only for now.
// Opened by the "Casino" button in the HUD or window.campusCasinoPanel(). Shares one global scope with the other campus
// parts (api, esc, showPanel, toast, openRoom come from them), so everything here is inside this function.
(function () {
  const credits = (n) => `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} credits`;
  const pct = (x) => (x == null ? "–" : `${(x * 100).toFixed(1)}%`);
  const when = (t) => { const d = new Date(t); return isNaN(d) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };
  const signed = (n) => `${n > 0 ? "▲ +" : n < 0 ? "▼ −" : ""}${credits(Math.abs(n))}`; // a symbol as well as the sign, not colour
  const stat = (label, value, sub = "") => `<div style="min-width:120px"><div class="sub">${esc(label)}</div><b style="font-size:18px">${value}</b>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;

  function render(v) {
    const t = v.table, styles = Object.entries(v.styles || {}), stops = Object.entries(v.stops || {}).sort((a, b) => b[1] - a[1]);
    const state = !v.open ? `Closed: ${esc(v.why || "the game's tables are missing")}.` : v.on ? "Open: idle workers with spare credits drop in now and then." : "Switched off (setting agents.casino.on). The stats below are from earlier sessions.";
    const big = v.biggestWin;
    const body = `
      <div class="row" data-casino-state="${!v.open ? "closed" : v.on ? "on" : "off"}"><div>${state}</div><div class="sub">${esc(v.note || "")}</div></div>
      <div class="row"><div style="display:flex;gap:16px;flex-wrap:wrap">
        ${stat("Measured return", pct(v.rtp), `${credits(v.won)} back from ${credits(v.staked)}`)}
        ${stat("Table's base-game return", t ? pct(t.rtp) : "–", t ? `${t.baseRounds} of ${t.rows} rounds (no free spins)` : "")}
        ${stat("Hit rate", pct(v.hitRate), t ? `table: ${pct(t.hitRate)}` : "")}
      </div></div>
      <div class="row"><div style="display:flex;gap:16px;flex-wrap:wrap">
        ${stat("Spins", String(v.spins || 0))}
        ${stat("Sessions", String(v.sessions || 0), v.avgSpins != null ? `${v.avgSpins} spins on average` : "")}
        ${stat("Biggest win", big ? credits(big.win) : "–", big ? `${esc(big.mult)}x on ${credits(big.bet)} · ${esc(big.desk)} · round ${esc(big.outcome)}` : "")}
        ${stat("Longest losing run", `${v.longestLosingStreak || 0} spins`)}
      </div></div>
      <h3 class="mt-4 font-semibold text-sm">Why sessions stopped</h3>
      <div class="row">${stops.length ? stops.map(([k, n]) => `<div>${esc(k)}: <b>${n}</b></div>`).join("") : `<div class="sub">No sessions yet.</div>`}</div>
      <h3 class="mt-4 font-semibold text-sm">By play style</h3>
      ${styles.map(([k, s]) => `<div class="row" data-casino-style="${esc(k)}"><div><b>${esc(k)}</b> · ${s.sessions} sessions, ${s.spins} spins · return ${pct(s.rtp)} · ${signed(s.net)}</div><div class="sub">${esc(s.about || "")}</div></div>`).join("")}
      <h3 class="mt-4 font-semibold text-sm">Last sessions</h3>
      ${(v.last || []).map((s) => `<div class="row" data-casino-session="${esc(s.session)}"><div><b>${esc(s.desk)}</b> (${esc(s.style)}) · ${s.spins} spins · ${signed(s.net)}</div><div class="sub">Brought ${credits(s.bankroll)}, bets from ${credits(s.baseBet)} · stopped: ${esc(s.stop)} · ${esc(when(s.at))}</div></div>`).join("") || `<div class="row sub">Nobody has played yet.</div>`}
      ${v.settings ? `<div class="row sub">Limits: at most ${credits(v.settings.maxStakePerSession)} or ${Math.round(v.settings.stakeShare * 100)}% of a worker's credits a session, ${v.settings.maxSessionsPerDay} sessions a day each, only workers with ${credits(v.settings.minBalance)} or more. Bets: ${(v.settings.betLevels || []).map(esc).join(", ")}. A worker never goes below zero; the pet never plays.</div>` : ""}`;
    showPanel(null, esc(v.name || "Casino"), body);
    openRoom = null; // not a room: the campus refresh must not redraw another panel over this one
  }

  async function open() {
    try { render(await api("/agents/casino")); } catch (err) { toast(err.message, 6000); }
  }

  const btn = document.getElementById("hCasino");
  if (btn) btn.onclick = () => open();
  window.campusCasinoPanel = () => open();
})();
