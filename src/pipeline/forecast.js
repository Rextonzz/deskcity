// Spend forecast (the owner's competitor survey, 2026-11-14): project each desk's and the hub's month-end spend from the
// spend ledger (spend.js rows: { at, desk, costUsd, billing }). Pure maths, no files: agents.js hands in the rows.
// Two projections, both shown:
//   simple: spent so far / days elapsed x days in the month
//   trend:  spent so far + the last 7 days' daily rate x the days left (the last-days rate, so a quiet start or a
//           sudden burst counts; before 7 days have passed it uses the days there are)
// API is real money (checked against caps); subscription is what the plans' use would have cost at API prices.
const DAY = 86400e3;
const r2 = (n) => Math.round((n || 0) * 100) / 100;
export const NEAR_SHARE = 0.8; // "near" once the projection reaches 80% of the cap

// "over" when the larger projection (or what's already spent) passes the cap, "near" from 80% of it, else "ok".
export function labelOf(cap, spent, projected) {
  if (cap == null) return "no cap";
  if (!(cap > 0)) return spent > 0 || projected > 0 ? "over" : "ok";
  const worst = Math.max(spent, projected);
  return worst > cap ? "over" : worst >= cap * NEAR_SHARE ? "near" : "ok";
}

// rows: this month's ledger lines. monthStart / monthEnd / now: ms. caps: { desk: capUsd }. budget: the hub's month
// budget in dollars (null for none). Returns { day, days, desks: [...], hub: {...} }.
export function forecast({ rows = [], now = Date.now(), monthStart, monthEnd, caps = {}, budget = null, trendDays = 7 } = {}) {
  const days = Math.round((monthEnd - monthStart) / DAY);
  const elapsed = Math.max(1, (now - monthStart) / DAY);
  const left = Math.max(0, days - elapsed);
  const win = Math.min(trendDays, elapsed), winStart = now - win * DAY;
  const by = {};
  const of = (id) => (by[id] ??= { api: 0, sub: 0, apiWeek: 0, subWeek: 0 });
  for (const x of rows) {
    const t = Date.parse(x.at);
    if (!Number.isFinite(x.costUsd) || !(t >= monthStart) || t > now) continue;
    const s = of(x.desk || "unassigned"), sub = x.billing === "subscription";
    s[sub ? "sub" : "api"] += x.costUsd;
    if (t >= winStart) s[sub ? "subWeek" : "apiWeek"] += x.costUsd;
  }
  for (const id of Object.keys(caps)) of(id); // a desk with a cap shows even before it spends
  const line = (id, s, cap) => {
    const simple = (s.api / elapsed) * days, trend = s.api + (s.apiWeek / win) * left;
    const simpleSub = (s.sub / elapsed) * days, trendSub = s.sub + (s.subWeek / win) * left;
    return { id, spent: r2(s.api), projected: r2(simple), projectedTrend: r2(trend), cap: cap ?? null,
      label: labelOf(cap, s.api, Math.max(simple, trend)), subSpent: r2(s.sub), subProjected: r2(simpleSub), subProjectedTrend: r2(trendSub) };
  };
  const desks = Object.entries(by).map(([id, s]) => line(id, s, caps[id] ?? null))
    .sort((a, b) => Math.max(b.projected, b.projectedTrend) - Math.max(a.projected, a.projectedTrend) || a.id.localeCompare(b.id));
  const all = Object.values(by).reduce((a, s) => ({ api: a.api + s.api, sub: a.sub + s.sub, apiWeek: a.apiWeek + s.apiWeek, subWeek: a.subWeek + s.subWeek }), { api: 0, sub: 0, apiWeek: 0, subWeek: 0 });
  return { day: Math.floor(elapsed) + 1, days, desks, hub: line("hub", all, budget) };
}
