// The Bank of Canada's daily USD -> CAD rate (free, no key), cached for the day in data/fx.json, so US prices
// (TCGplayer) convert the same way everywhere. Falls back to the last saved rate when the Bank can't be reached.
import { resolvePath, readJson, writeJsonAtomic } from "./util.js";

const FILE = () => resolvePath("data/fx.json");

export async function usdCad() {
  const saved = readJson(FILE(), null);
  if (saved && Date.now() - saved.fetchedAt < 12 * 3600e3) return saved;
  try {
    const res = await fetch("https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1", { signal: AbortSignal.timeout(10000) });
    const obs = (await res.json()).observations?.[0];
    const rate = Number(obs?.FXUSDCAD?.v);
    if (!(rate > 0)) throw new Error("no rate in the answer");
    const out = { rate, date: obs.d, fetchedAt: Date.now(), source: "Bank of Canada" };
    writeJsonAtomic(FILE(), out, 0);
    return out;
  } catch (err) {
    return saved ? { ...saved, stale: true } : null;
  }
}
