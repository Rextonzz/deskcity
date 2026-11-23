// Campus: the city fund panel (campus part 3, 2026-11-19). Shows the fund and the reserve, the board's open spend
// proposals with their votes, the API allowance pool and the recent tax log; the owner can vote yes or no on an open
// proposal here. Display and buttons only: the spending rules live in src/pipeline/agents/cityfund.js.
// Data: GET /agents/cityfund. Vote: POST /agents/cityfund/vote {id, vote, why?} (the owner's vote decides alone).
// Play money, so no password (the server route has none). Opened by the "City fund" button in the HUD or
// window.campusFundPanel(). Shares one global scope with the other campus parts (api, esc, showPanel, toast, openRoom
// come from them), so everything here is inside this function.
(function () {
  const credits = (n) => `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} credits`;
  const when = (t) => { const d = new Date(t); return isNaN(d) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };
  let last = null; // what the most recent vote did, shown at the top until the panel is opened afresh
  let busy = false, shown = 12;

  function logLine(l) {
    const who = l.buyer || l.by || "", amt = l.amount != null ? credits(Math.abs(l.amount)) : "";
    const kinds = {
      "tax": `Tax: ${esc(who)} paid ${amt}${l.item ? ` on ${esc(l.item)}` : ""}`,
      "tax refund": `Tax refund: ${esc(who)} got back ${amt}${l.item ? ` on ${esc(l.item)}` : ""}`,
      "proposal": `Proposal: ${esc(who)} asks for ${amt}`,
      "vote": `Vote: ${esc(who)} said ${l.vote === "yes" ? "✓ yes" : "✗ no"}${l.owner ? " (you)" : ""}`,
      "spend": `Spent ${amt}${l.item ? ` on ${esc(l.item)}` : ""}${l.payee ? ` for ${esc(l.payee)}` : ""}`,
      "rejected": `Turned down: ${amt}`,
    };
    const head = kinds[l.kind] || esc(l.kind || "entry");
    const why = l.reason || l.why || "";
    return `<div class="row" data-fund-log="${esc(l.kind || "")}"><div>${head}</div>${why ? `<div class="sub">${esc(String(why).slice(0, 160))}</div>` : ""}<div class="sub">${esc(when(l.at))}</div></div>`;
  }

  function proposalCard(p) {
    const yes = (p.votes || []).filter((v) => v.vote === "yes").length, no = (p.votes || []).filter((v) => v.vote === "no").length;
    const members = p.members || [], need = Math.floor(members.length / 2) + 1;
    const votes = (p.votes || []).map((v) => `<div class="sub">${v.vote === "yes" ? "✓ Yes" : "✗ No"} from ${esc(v.by)}${v.why ? `: ${esc(String(v.why).slice(0, 120))}` : ""}</div>`).join("");
    return `<div class="row" data-fund-prop="${esc(p.id)}" data-amount="${esc(p.amount)}">
      <div><b>${credits(p.amount)}</b>${p.item ? ` for ${esc(p.item)}` : ""}${p.payee ? ` to ${esc(p.payee)}` : ""}</div>
      <div class="sub">Asked by ${esc(p.by)} · ${esc(when(p.at))}</div>
      <div>${esc(p.reason || "")}</div>
      <div class="sub">Board: ${members.map(esc).join(", ") || "none"} · yes ${yes}, no ${no}, ${need} yes needed</div>
      ${votes}
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <button class="pill" data-fund-vote="yes" data-id="${esc(p.id)}" aria-label="Vote yes: spend ${esc(p.amount)} credits">✓ Vote yes</button>
        <button class="pill" data-fund-vote="no" data-id="${esc(p.id)}" aria-label="Vote no: turn it down">✗ Vote no</button>
      </div>
      <div class="sub">Your vote decides on its own.</div>
    </div>`;
  }

  function resultLine(r) {
    if (!r) return "";
    const word = r.status === "spent" ? `✓ Spent. ${credits(r.amount)} left the fund.` : r.status === "rejected" ? `✗ Turned down.${r.why ? ` (${esc(r.why)})` : ""}` : `… Still open: yes ${r.yes ?? 0}, no ${r.no ?? 0}, ${r.need ?? "?"} yes needed.`;
    return `<div class="row" data-fund-result="${esc(r.status)}" role="status"><b>Your vote: ${esc(r.vote)}.</b> ${word}</div>`;
  }

  function render(v) {
    const q = v.quota || {};
    const props = v.proposals || [];
    const log = v.log || [];
    const body = `
      ${resultLine(last)}
      <div class="row"><div style="display:flex;gap:16px;flex-wrap:wrap"><div><div class="sub">City fund</div><b style="font-size:20px">${credits(v.fund)}</b> <span class="sub">of ${credits(v.cap)} cap</span></div><div><div class="sub">Reserve</div><b style="font-size:20px">${credits(v.reserve)}</b></div></div>
        <div class="sub">Tax rate ${Math.round((v.taxRate || 0) * 100)}% on paid Mart buys. Collected ${credits(v.taxed)} · spent ${credits(v.spent)}. The reserve (tax over the cap) can't be spent yet.</div></div>
      <div class="row"><div class="sub">Open proposals · ${props.length}</div>${props.length ? "" : `<div class="sub">Nothing waiting for a vote.</div>`}</div>
      ${props.map(proposalCard).join("")}
      ${q.pool != null ? `<div class="row"><div class="sub">API allowance pool this month</div><div>$${esc(Number(q.left ?? 0).toFixed(2))} left of $${esc(Number(q.pool).toFixed(2))} <span class="sub">($${esc(Number(q.granted ?? 0).toFixed(2))} given out · $${esc(Number(q.perBuyUsd ?? 0).toFixed(2))} each for ${credits(q.cost)} plus tax)</span></div></div>` : ""}
      <h3 class="mt-4 font-semibold text-sm">Recent tax and fund log</h3>
      ${log.slice(0, shown).map(logLine).join("") || `<div class="row sub">Nothing logged yet.</div>`}
      ${log.length > shown ? `<div class="row"><button class="pill" data-fund-more>Show more</button></div>` : ""}`;
    const p = showPanel(null, "City fund", body);
    openRoom = null; // not a room: the campus refresh must not redraw another panel over this one
    p.querySelectorAll("[data-fund-vote]").forEach((b) => (b.onclick = () => vote(b.dataset.id, b.dataset.fundVote)));
    const more = p.querySelector("[data-fund-more]"); if (more) more.onclick = () => { shown += 20; open(true); };
  }

  async function vote(id, choice) {
    if (busy) return;
    busy = true;
    document.querySelectorAll("[data-fund-vote]").forEach((b) => (b.disabled = true));
    try {
      const amt = Number(document.querySelector(`[data-fund-prop="${CSS.escape(id)}"]`)?.dataset.amount) || 0;
      const r = await api("/agents/cityfund/vote", { id, vote: choice });
      last = { status: r.status, yes: r.yes, no: r.no, need: r.need, why: r.why, vote: choice, amount: r.spend?.amount ?? amt };
    } catch (err) { last = null; toast(err.message, 6000); }
    busy = false;
    await open(true);
  }

  async function open(keep) {
    if (!keep) last = null;
    try { render(await api("/agents/cityfund")); } catch (err) { toast(err.message, 6000); }
  }

  const btn = document.getElementById("hFund");
  if (btn) btn.onclick = () => { shown = 12; open(); };
  window.campusFundPanel = () => { shown = 12; return open(); };
})();
