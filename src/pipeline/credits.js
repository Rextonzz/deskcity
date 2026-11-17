// AI credit left per provider. Neither Anthropic nor Google lets an ordinary API key read the account balance, so
// the owner types in the balance his console shows (Anthropic: Billing, Google AI Studio: Billing) and the app takes off
// what each logged AI call cost since then. It's an estimate: his console is the real number.
import { readRuns } from "./runlog.js";
import { sendAlert } from "./notify.js";
import { resolvePath, readJson, writeJsonAtomic } from "./util.js";

const FILE = () => resolvePath("data/credits.json");
export const PROVIDERS = { claude: "Claude (Anthropic)", gemini: "Gemini (Google)" };

const load = () => readJson(FILE(), { providers: {}, warnBelow: 2 });
function save(d) {
  writeJsonAtomic(FILE(), d);
}

export function creditStatus() {
  const d = load();
  const calls = readRuns({ kinds: ["ai call"], limit: 50000 });
  const out = {};
  for (const [id, label] of Object.entries(PROVIDERS)) {
    const set = d.providers[id];
    const mine = calls.filter((c) => (c.provider || "claude") === id && Number.isFinite(c.costUsd));
    const since = set ? mine.filter((c) => c.startedAt > set.at) : [];
    const byModel = {};
    for (const c of since) (byModel[c.model] ??= { model: c.model, calls: 0, usd: 0 }), byModel[c.model].calls++, (byModel[c.model].usd += c.costUsd);
    const spent = since.reduce((t, c) => t + c.costUsd, 0);
    const week = mine.filter((c) => Date.parse(c.startedAt) > Date.now() - 7 * 864e5).reduce((t, c) => t + c.costUsd, 0);
    const left = set ? set.balance - spent : null;
    out[id] = {
      label,
      set: set || null,
      spent: Number(spent.toFixed(4)),
      left: left == null ? null : Number(left.toFixed(2)),
      perDay: Number((week / 7).toFixed(3)),
      daysLeft: left != null && week > 0 ? Math.floor(left / (week / 7)) : null,
      models: Object.values(byModel).map((m) => ({ ...m, usd: Number(m.usd.toFixed(4)) })).sort((a, b) => b.usd - a.usd),
      low: left != null && left < d.warnBelow,
    };
  }
  return { providers: out, warnBelow: d.warnBelow };
}

export function setCredit({ provider, balance, warnBelow }) {
  const d = load();
  if (provider) {
    if (!PROVIDERS[provider]) throw new Error("Unknown provider.");
    const b = Number(balance);
    if (!Number.isFinite(b) || b < 0 || b > 100000) throw new Error("Type the balance in US dollars, like 5 or 12.50.");
    d.providers[provider] = { balance: b, at: new Date().toISOString() };
    delete d.alerted?.[provider];
  }
  if (warnBelow != null) {
    const w = Number(warnBelow);
    if (!Number.isFinite(w) || w < 0 || w > 1000) throw new Error("The warning level needs to be a dollar amount.");
    d.warnBelow = w;
  }
  save(d);
  return creditStatus();
}

// After each AI call: one phone alert when a provider's estimated credit drops under the warning level.
export function checkCredit(provider) {
  try {
    const st = creditStatus().providers[provider];
    if (!st?.low) return;
    const d = load();
    if (d.alerted?.[provider] === d.providers[provider]?.at) return;
    (d.alerted ??= {})[provider] = d.providers[provider].at;
    save(d);
    sendAlert({ kind: "credit", title: `${st.label} credit low`, message: `About $${st.left.toFixed(2)} left (estimate). Top up, then type the new balance on Admin.`, tags: ["money_with_wings"], priority: 4 }).catch(() => {});
  } catch {}
}
