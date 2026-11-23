// Part of the agents module (src/pipeline/agents.js): the campus store's tax and the city fund the board spends
// (campus part 1, 2026-11-19). The API quota item is apiquota.js (part 4).
//
// Tax: every paid Campus Mart purchase adds a tax (agents.cityFund.taxRate, default 10%) on top of the price. The buyer
// pays it (a "tax" line in data/agents/wallet.jsonl, so balances need no other change) and it goes to the city fund,
// up to agents.cityFund.cap; anything over the cap goes to the reserve. Gifts are free, so untaxed; a refund gives the
// tax back.
// Board fund: credits leave the fund only through spendFund(): a proposal, then votes from the board (HR, the finance
// desk and the project's lead, as for requests, board.js). A majority of yes passes it and the spend is logged; a
// majority of no rejects it. The finance desk votes in code when a proposal is made (yes when the fund covers it).
// The owner (the owner) can decide any proposal at once, as with the board's requests: his yes spends, his no rejects.
// Everything (tax, refund, proposal, vote, spend, rejection) is one line in data/agents/cityfund.jsonl, with item,
// buyer, amount and reason. Play money: credits never touch real money.
import path from "node:path";
import { hubSettings, ownerId } from "../../hub/settings.js";
import { newId } from "../util.js";
import { DIR, appendJsonl, clip, readJsonl, recordEvent, roster, slug } from "../agents.js";
import { boardMembers } from "./board.js";
import { quotaState } from "./apiquota.js";

// Spend limits (the owner 2026-11-20, design part 5, answer 6A): so no one player can take over the fund. They apply to every
// spend proposed by a board member; the owner's own proposals and district founding (kind "district", which already
// passed a player vote with a quorum and a project cap, districts.js) are outside them.
// voteDays (review M1, 2026-11-20): HR never votes on fund spends and the finance desk always backs one the fund covers,
// so without a deadline a proposal the lead doesn't back would stay open for ever (holding a district's lot and deposit).
// After voteDays an open proposal is turned down (fundTick).
export const FUND_DEFAULTS = { taxRate: 0.1, cap: 500, voteDays: 3, limits: { perSpend: 0.25, perPlayer30d: 0.1, perWeek: 0.4, selfCooldownDays: 7 } };
const LEDGER = () => path.join(DIR(), "cityfund.jsonl");
const WALLET = () => path.join(DIR(), "wallet.jsonl");
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v, d, min = 0, max = Infinity) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : d; };

// Settings with defaults (hub.defaults.json agents.cityFund; data/hub-settings.json overrides).
export function fundSettings(s = hubSettings()) {
  const c = s.agents?.cityFund || {}, D = FUND_DEFAULTS, L = c.limits || {};
  return {
    taxRate: num(c.taxRate, D.taxRate, 0, 1),
    cap: num(c.cap, D.cap),
    voteDays: num(c.voteDays, D.voteDays, 0.01),
    limits: { perSpend: num(L.perSpend, D.limits.perSpend, 0, 1), perPlayer30d: num(L.perPlayer30d, D.limits.perPlayer30d, 0, 1), perWeek: num(L.perWeek, D.limits.perWeek, 0, 1), selfCooldownDays: num(L.selfCooldownDays, D.limits.selfCooldownDays) },
  };
}
// Why a spend can't be proposed under the limits, or null. by: the proposer; benefit: the player who gains (the payee).
export function spendBlock({ by, amount, benefit = null, kind = null }, lines = ledger(), now = Date.now(), set = fundSettings()) {
  if (by === OWNER_ID() || kind === "district") return null;
  const L = set.limits, st = fundState(lines), amt = r2(amount), day = 864e5;
  const spends = lines.filter((l) => l.kind === "spend"), within = (l, days) => now - Date.parse(l.at) < days * day;
  if (amt > r2(st.fund * L.perSpend)) return `one spend can be at most ${Math.round(L.perSpend * 100)}% of the fund (${r2(st.fund * L.perSpend)} credits now)`;
  if (st.proposals.some((p) => p.status === "open" && p.by === by)) return `${by} already has an open proposal`;
  const week = r2(spends.filter((l) => within(l, 7)).reduce((a, l) => a + l.amount, 0));
  if (week + amt > r2((st.fund + week) * L.perWeek)) return `at most ${Math.round(L.perWeek * 100)}% of the fund can leave in 7 days (${week} already has)`;
  if (benefit) {
    const month = spends.filter((l) => within(l, 30)), got = r2(month.filter((l) => l.buyer === benefit || l.benefit === benefit).reduce((a, l) => a + l.amount, 0));
    const base = r2(st.fund + month.reduce((a, l) => a + l.amount, 0));
    if (got + amt > r2(base * L.perPlayer30d)) return `${benefit} can get at most ${Math.round(L.perPlayer30d * 100)}% of the fund in 30 days (has had ${got})`;
    if (benefit === by && lines.some((l) => l.kind === "proposal" && l.by === by && l.benefit === by && within(l, L.selfCooldownDays))) return `${by} proposed something for itself less than ${L.selfCooldownDays} days ago`;
  }
  return null;
}

// ---------- tax ----------
export const taxOn = (price, rate = fundSettings().taxRate) => r2(Math.max(0, Number(price) || 0) * rate);
export const withTax = (price, rate = fundSettings().taxRate) => r2((Number(price) || 0) + taxOn(price, rate));
// How a tax splits between the fund (up to the cap) and the reserve.
export function splitTax(tax, fundBalance, cap) {
  const room = Math.max(0, r2(cap - fundBalance)), fund = r2(Math.min(tax, room));
  return { fund, reserve: r2(tax - fund) };
}

export const ledger = () => readJsonl(LEDGER());
// The fund and reserve from the log; open proposals with their votes.
export function fundState(lines = ledger()) {
  let fund = 0, reserve = 0, taxed = 0, spent = 0;
  const props = new Map();
  for (const l of lines) {
    if (l.kind === "tax" || l.kind === "tax refund") { fund += l.fund || 0; reserve += l.reserve || 0; taxed += l.amount || 0; }
    else if (l.kind === "spend") { fund -= l.amount || 0; spent += l.amount || 0; }
    if (l.kind === "proposal") props.set(l.id, { ...l, votes: [], status: "open" });
    else if (l.kind === "vote" && props.has(l.id)) props.get(l.id).votes.push({ by: l.by, vote: l.vote, why: l.why || null });
    else if ((l.kind === "spend" || l.kind === "rejected") && props.has(l.id)) props.get(l.id).status = l.kind === "spend" ? "spent" : "rejected";
  }
  return { fund: r2(fund), reserve: r2(reserve), taxed: r2(taxed), spent: r2(spent), proposals: [...props.values()] };
}

// A paid purchase: works out the tax, logs it to the fund (and reserve) and returns the wallet line for the buyer.
// The caller (campus.js) writes the wallet line next to the purchase. No tax on a free (gift) purchase.
export function taxPurchase({ buyer, item, price, reason = "store purchase", at = new Date().toISOString() } = {}) {
  const set = fundSettings(), tax = taxOn(price, set.taxRate);
  if (!(tax > 0)) return null;
  const { fund, reserve } = splitTax(tax, fundState().fund, set.cap);
  appendJsonl(LEDGER(), { kind: "tax", at, item, buyer, price: r2(price), rate: set.taxRate, amount: tax, fund, reserve, reason });
  return { at, desk: buyer, item: "tax", for: item, cost: tax };
}
// A refund gives the buyer back the tax it paid (`paid`, the tax wallet line's cost; else worked out at today's rate).
// It comes out of where it went in, reserve first, then the fund, and never takes either below zero: a shortfall is
// logged as `uncovered` (review L2, 2026-11-20).
export function refundTax({ buyer, item, price, paid = null, reason = "refund", at = new Date().toISOString() } = {}) {
  const set = fundSettings(), tax = paid != null ? r2(paid) : taxOn(price, set.taxRate);
  if (!(tax > 0)) return null;
  const st = fundState(), reserve = r2(Math.min(tax, Math.max(0, st.reserve))), fund = r2(Math.min(tax - reserve, Math.max(0, st.fund))), uncovered = r2(tax - reserve - fund);
  appendJsonl(LEDGER(), { kind: "tax refund", at, item, buyer, price: r2(price), rate: set.taxRate, amount: -tax, fund: -fund, reserve: -reserve, ...(uncovered > 0 ? { uncovered } : {}), reason });
  return { at, desk: buyer, item: "tax", for: item, cost: -tax, refund: true };
}

// ---------- board spends ----------
const OWNER_ID = () => ownerId();
const financeDeskOf = (r) => r.desks.find((d) => (d.room === "hr" || d.room === "finance") && d.status === "active" && /financ/i.test(`${d.id} ${d.role}`));
export const fundBoard = (room = "hub", r = roster()) => boardMembers({ kind: "fund", room }, r);

// A board member (or the owner) proposes spending from the fund. payee: a desk that gets the credits, or none (the
// city spends it on `item`). The finance desk votes straight away. The spend limits are checked here (spendBlock).
// Code only (never a route): `system: true` lets the city itself propose (districts.js, kind "district", benefit: the
// founder, who then can't vote on it).
export function proposeSpend({ by, amount, reason, item = null, payee = null, room = "hub", kind = null, benefit = null, ref = null } = {}, { system = false } = {}) {
  const who = system ? "city" : slug(by), r = roster(), members = fundBoard(room, r);
  if (!system && who !== OWNER_ID() && !members.includes(who)) throw new Error(`${who} isn't on the board (${members.join(", ")}).`);
  const amt = r2(amount);
  if (!(amt > 0)) throw new Error("Give an amount above 0.");
  if (!String(reason || "").trim()) throw new Error("Give a reason for the spend.");
  if (payee && !r.desks.some((d) => d.id === slug(payee))) throw new Error("No such desk to pay.");
  const lines = ledger(), st = fundState(lines);
  if (amt > st.fund) throw new Error(`The fund has ${st.fund} credits; ${amt} is more than that.`);
  const gains = payee ? slug(payee) : benefit ? slug(benefit) : null;
  const block = spendBlock({ by: who, amount: amt, benefit: gains, kind: system ? kind : null }, lines);
  if (block) throw new Error(`That spend is over the fund's limits: ${block}.`);
  const line = { kind: "proposal", id: newId(), at: new Date().toISOString(), by: who, room, amount: amt, reason: clip(reason, 300), item: item ? clip(item, 80) : null, payee: payee ? slug(payee) : null, members,
    ...(gains ? { benefit: gains } : {}), ...(system && kind ? { spendKind: kind } : {}), ...(ref ? { ref } : {}) };
  appendJsonl(LEDGER(), line);
  recordEvent({ desk: who === OWNER_ID() || who === "city" ? "hr" : who, room, action: "fund proposal", summary: clip(`🏛️ proposes ${amt} credits from the city fund${line.payee ? ` for ${line.payee}` : ""}: ${line.reason}`, 200) }, who);
  const fd = financeDeskOf(r);
  if (fd && members.includes(fd.id) && fd.id !== gains) { // it can't vote on a spend it gains from (review L4)
    const ok = amt <= st.fund;
    return voteSpend({ id: line.id, desk: fd.id, vote: ok ? "yes" : "no", why: ok ? `the fund covers it (${st.fund} credits)` : `the fund has only ${st.fund}` });
  }
  return { proposal: line, ...decide(line.id) };
}

// One vote per member per proposal. A majority of the members decides; a yes majority spends at once. The owner's vote
// decides on its own (owner: true in the log line). It is taken only with `{ owner: true }`, which only the owner's
// signed-in route (POST /agents/cityfund/vote) and the hub's own code pass: naming the owner as `desk` is refused
// (review H1, 2026-11-20: the agents' post route took any desk name, the owner's included).
export function voteSpend({ id, desk, vote, why } = {}, { owner: asOwner = false } = {}) {
  const owner = asOwner === true, who = owner ? OWNER_ID() : slug(desk), p = fundState().proposals.find((x) => x.id === id);
  if (!owner && who === OWNER_ID()) throw new Error("The owner votes from the dashboard, not by naming the owner.");
  if (!p) throw new Error("No such fund proposal.");
  if (p.status !== "open") throw new Error(`That proposal is already ${p.status}.`);
  if (!["yes", "no"].includes(vote)) throw new Error("Vote yes or no.");
  if (!owner && !p.members.includes(who)) throw new Error(`${who} isn't on the board for this one (${p.members.join(", ")}).`);
  if (p.votes.some((v) => v.by === who)) throw new Error(`${who} already voted on this one.`);
  if (!owner && p.benefit === who) throw new Error(`${who} gains from this one, so it can't vote on it.`);
  appendJsonl(LEDGER(), { kind: "vote", id, at: new Date().toISOString(), by: who, vote, ...(owner ? { owner: true } : {}), ...(why ? { why: clip(why, 300) } : {}) });
  recordEvent({ desk: owner ? "hr" : who, room: p.room, action: "fund vote", summary: clip(`${owner ? "the owner " : ""}${vote === "yes" ? "👍 backs" : "✋ objects to"} ${p.amount} credits from the city fund: ${p.reason}`, 200) }, who);
  return { proposal: p, ...decide(id) };
}

// Spend or reject once a majority (or the owner) has decided. The only place credits leave the fund.
function decide(id) {
  const st = fundState(), p = st.proposals.find((x) => x.id === id);
  if (!p || p.status !== "open") return { status: p?.status || "missing" };
  const need = Math.floor(p.members.length / 2) + 1, member = p.votes.filter((v) => p.members.includes(v.by));
  const yes = member.filter((v) => v.vote === "yes").length, no = member.filter((v) => v.vote === "no").length;
  const ownerVote = p.votes.find((v) => v.by === OWNER_ID())?.vote;
  const at = new Date().toISOString();
  if (ownerVote === "no" || (!ownerVote && no >= need)) {
    appendJsonl(LEDGER(), { kind: "rejected", id, at, amount: p.amount, reason: p.reason, votes: p.votes });
    return { status: "rejected", yes, no, need, amount: p.amount };
  }
  if (ownerVote !== "yes" && yes < need) return { status: "open", yes, no, need, amount: p.amount };
  if (p.amount > st.fund) {
    appendJsonl(LEDGER(), { kind: "rejected", id, at, amount: p.amount, reason: `${p.reason} (passed, but the fund has only ${st.fund})`, votes: p.votes });
    return { status: "rejected", yes, no, need, amount: p.amount, why: "the fund no longer covers it" };
  }
  const spend = { kind: "spend", id, at, item: p.item || (p.payee ? "grant" : "city"), buyer: p.payee || "city", amount: p.amount, reason: p.reason, votes: p.votes, ...(p.benefit ? { benefit: p.benefit } : {}), ...(p.spendKind ? { spendKind: p.spendKind } : {}), ...(p.ref ? { ref: p.ref } : {}) };
  appendJsonl(LEDGER(), spend);
  // a grant to a worker: credits into its wallet (a negative cost, like a refund)
  if (p.payee) appendJsonl(WALLET(), { at, desk: p.payee, item: "fund grant", for: id, cost: -p.amount });
  recordEvent({ desk: "hr", room: p.room, action: "fund spend", summary: clip(`🏛️ the board spent ${p.amount} credits from the city fund${p.payee ? ` on ${p.payee}` : ""}: ${p.reason}`, 200) }, "board");
  return { status: "spent", yes, no, need, amount: p.amount, spend };
}

// Every 10 minutes with the Board timer: open proposals older than voteDays are turned down (review M1).
export function fundTick(now = Date.now()) {
  const days = fundSettings().voteDays, out = [];
  for (const p of fundState().proposals.filter((x) => x.status === "open" && now - Date.parse(x.at) >= days * 864e5)) {
    appendJsonl(LEDGER(), { kind: "rejected", id: p.id, at: new Date(now).toISOString(), amount: p.amount, reason: `${p.reason} (no majority in ${days} days)`, votes: p.votes, expired: true });
    recordEvent({ desk: "hr", room: p.room, action: "fund spend expired", summary: clip(`🏛️ ${p.amount} credits from the city fund weren't decided in ${days} days, so they're turned down: ${p.reason}`, 200) }, "board");
    out.push(p.id);
  }
  return out;
}

// For the pages and the API: the fund, the reserve, the last log lines, open proposals, the limits, the quota pool
// (its amounts are US dollars: unit "usd").
export function fundView(limit = 50) {
  const lines = ledger(), st = fundState(lines), set = fundSettings();
  return { ...st, proposals: st.proposals.filter((p) => p.status === "open"), taxRate: set.taxRate, cap: set.cap, voteDays: set.voteDays, limits: set.limits, board: fundBoard(), quota: { ...quotaState(), unit: "usd" }, log: lines.slice(-limit).reverse() };
}
