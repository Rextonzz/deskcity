// Part of the agents module (src/pipeline/agents.js): the API quota store item (campus part 4, 2026-11-19).
//
// A Campus Mart item that buys one worker a fixed API allowance (agents.apiQuota.perBuyUsd) for credits
// (agents.apiQuota.cost, plus the store tax, cityfund.js), at most agents.apiQuota.perMonth a month. Allowances come
// from a monthly pool with a hard stop: a buy needs a whole allowance left in the pool, so the pool never goes below
// zero. The pool is min(agents.apiQuota.poolUsd, what's left of the store's monthly budget after its real spend this month),
// and no worker's allowances plus its real API spend this month pass its own monthly cap (capUsdMonth on the roster).
// Months are the hub's calendar months (review M4 and L6, 2026-11-20).
// Buying it costs credits only (play money): nothing here spends real money. Spending an allowance would be a real API
// call; that is a later piece and must go through the existing password-gated paths.
// The quota ledger: data/agents/apiquota.jsonl, one line per buy (item, buyer, amount in credits, usd, reason).
import path from "node:path";
import { hubSettings } from "../../hub/settings.js";
import { DIR, appendJsonl, monthSpend, readJsonl, recordEvent, roster, slug } from "../agents.js";
import { monthKey } from "../spend.js";
import { taxOn, taxPurchase, fundSettings } from "./cityfund.js";
import { storeSpend, wallets } from "./campus.js";

export const QUOTA_DEFAULTS = { poolUsd: 2, perBuyUsd: 0.1, cost: 20, perMonth: 1 };
const QUOTA_LOG = () => path.join(DIR(), "apiquota.jsonl");
const WALLET = () => path.join(DIR(), "wallet.jsonl");
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v, d, min = 0, max = Infinity) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : d; };

// Settings with defaults (hub.defaults.json agents.apiQuota and store.budgetUsd; data/hub-settings.json overrides).
export function quotaSettings(s = hubSettings()) {
  const q = s.agents?.apiQuota || {}, D = QUOTA_DEFAULTS;
  return {
    poolUsd: num(q.poolUsd, D.poolUsd),
    perBuyUsd: num(q.perBuyUsd, D.perBuyUsd, 0.01),
    cost: num(q.cost, D.cost, 1),
    perMonth: Math.floor(num(q.perMonth, D.perMonth, 1)),
    storeBudgetUsd: num(s.store?.budgetUsd, 20),
  };
}
export const quotaLog = () => readJsonl(QUOTA_LOG());
const monthOf = (at) => monthKey(new Date(at));

// This month's pool, what's been granted from it, what's left; with `desk`, that worker's buys and cap.
export function quotaState(desk = null, now = new Date(), lines = quotaLog(), r = null, { store = storeSpend(), spend = null } = {}) {
  const set = quotaSettings(), month = monthKey(now);
  const grants = lines.filter((l) => l.kind === "quota" && monthOf(l.at) === month);
  const storeLeft = Math.max(0, r2((store?.budget ?? set.storeBudgetUsd) - (store?.spent || 0)));
  const pool = r2(Math.min(set.poolUsd, storeLeft));
  const granted = r2(grants.reduce((a, l) => a + (l.usd || 0), 0)), left = r2(Math.max(0, pool - granted));
  const out = { month, pool, granted, left, perBuyUsd: set.perBuyUsd, cost: set.cost, tax: taxOn(set.cost, fundSettings().taxRate), perMonth: set.perMonth };
  if (desk) {
    const id = slug(desk), mine = grants.filter((l) => l.buyer === id), d = (r || roster()).desks.find((x) => x.id === id);
    out.desk = { id, buys: mine.length, usd: r2(mine.reduce((a, l) => a + (l.usd || 0), 0)), cap: d?.capUsdMonth ?? null, spentUsd: r2((spend || monthSpend(now))[id]?.usd || 0) };
  }
  return out;
}
// Why a worker can't buy the quota now, or null. Hard stop: the pool must hold a whole allowance.
export function quotaBlock(q, balance = null) {
  const d = q.desk;
  if (q.left < q.perBuyUsd) return "the API quota is used up this month";
  if (d.buys >= q.perMonth) return `${d.id} already bought its API quota this month`;
  if (d.cap != null && r2(d.usd + (d.spentUsd || 0) + q.perBuyUsd) > d.cap) return `it would pass ${d.id}'s $${d.cap} monthly cap (real API spend this month counts too)`;
  if (balance != null && balance < r2(q.cost + q.tax)) return `${d.id} can't afford it (${r2(q.cost + q.tax)} credits with tax)`;
  return null;
}
// Buy one allowance for a worker: credits (price + tax) from its wallet, the allowance from the pool.
export function buyQuota({ desk } = {}) {
  const r = roster(), d = r.desks.find((x) => x.id === slug(desk));
  if (!d) throw new Error("No such desk.");
  // only working desks (Gemini 4 Neon's review, 2026-11-20: a paused or retired desk could be given quota)
  if (d.status !== "active" || d.paused) throw new Error(`${d.id} isn't working right now (paused or not active), so it can't buy the API quota.`);
  const q = quotaState(d.id, new Date(), quotaLog(), r), why = quotaBlock(q, wallets()[d.id]?.balance || 0);
  if (why) throw new Error(`Can't buy the API quota: ${why}.`);
  const at = new Date().toISOString();
  appendJsonl(WALLET(), { at, desk: d.id, item: "apiquota", cost: q.cost });
  const tax = taxPurchase({ buyer: d.id, item: "apiquota", price: q.cost, at });
  if (tax) appendJsonl(WALLET(), tax);
  const line = { kind: "quota", at, item: "apiquota", buyer: d.id, amount: q.cost, usd: q.perBuyUsd, reason: "API quota bought in the Campus Mart" };
  appendJsonl(QUOTA_LOG(), line);
  recordEvent({ desk: d.id, room: d.room, action: "bought API quota", summary: `bought $${q.perBuyUsd} of API quota (${r2(q.left - q.perBuyUsd)} left in this month's pool)` }, d.id);
  return { ...line, tax: tax?.cost || 0, left: r2(q.left - q.perBuyUsd) };
}
// The allowance a worker bought this month, in USD (for the later piece that spends it through password-gated paths).
export const quotaOf = (desk, now = new Date()) => quotaState(desk, now).desk.usd;
