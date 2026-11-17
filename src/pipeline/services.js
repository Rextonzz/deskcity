// Services register (the owner, 2026-11-09): every paid service any project uses, what it's for, the plan, and where its
// key lives (the name of the .env line, never the key). Live balances where the service lets a key read them:
// Claude and Gemini from the hub's own credit tracker, ElevenLabs (characters left this cycle) and PixelLab (balance).
// The list is data/services.json (the owner can edit it on the Agents page later); the defaults below seed it.
import fs from "node:fs";
import { resolvePath, writeJsonAtomic } from "./util.js";
import { isRealKey } from "../config.js";
import { creditStatus } from "./credits.js";
import { hubSettings } from "../hub/settings.js";

const FILE = () => resolvePath("data/services.json");
// The seed list: the hub settings' "services" (this owner's own list is in hub.owner.json), else the two AI APIs.
const GENERIC = [
  { id: "claude", name: "Claude API", rooms: ["hub", "hr"], purpose: "HR, hub-run Claude desks", plan: "", keyEnv: "ANTHROPIC_API_KEY", live: "credits" },
  { id: "gemini", name: "Gemini API", rooms: [], purpose: "Hub-run Gemini desks", plan: "", keyEnv: "GEMINI_API_KEY", live: "credits" },
];
const DEFAULTS = () => (Array.isArray(hubSettings().services) ? hubSettings().services : GENERIC);
export function serviceList() {
  try {
    const list = JSON.parse(fs.readFileSync(FILE(), "utf8"));
    if (Array.isArray(list)) {
      // New defaults join an existing list; the owner's own edits to existing entries win.
      const ids = new Set(list.map((s) => s.id));
      return [...list, ...DEFAULTS().filter((d) => !ids.has(d.id))];
    }
  } catch {}
  return DEFAULTS();
}
const hasKey = (name) => isRealKey(name && process.env[name]);

async function getJson(url, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}
// ElevenLabs: characters used and left this cycle.
async function elevenlabs() {
  const s = await getJson("https://api.elevenlabs.io/v1/user/subscription", { "xi-api-key": process.env.ELEVENLABS_API_KEY });
  const left = (s.character_limit ?? 0) - (s.character_count ?? 0);
  return {
    line: `${left.toLocaleString("en-CA")} of ${Number(s.character_limit || 0).toLocaleString("en-CA")} characters left${s.tier ? ` (${s.tier})` : ""}`,
    usedPct: s.character_limit ? (s.character_count / s.character_limit) * 100 : null,
    resets: s.next_character_count_reset_unix ? new Date(s.next_character_count_reset_unix * 1000).toISOString().slice(0, 10) : null,
  };
}
// PixelLab: its API reports the account balance. The exact shape isn't documented where the hub can check it, so
// this reads whatever number fields come back (generations, credits or USD) and shows them as they are.
async function pixellab() {
  const auth = { Authorization: `Bearer ${process.env.PIXELLAB_API_KEY}` };
  let b = null, err = null;
  for (const url of ["https://api.pixellab.ai/v2/balance", "https://api.pixellab.ai/v1/balance"]) {
    try {
      b = await getJson(url, auth);
      break;
    } catch (e) {
      err = e;
    }
  }
  if (!b) throw err || new Error("no answer");
  const flat = {};
  const walk = (o, pre = "") => { for (const [k, v] of Object.entries(o || {})) { if (v && typeof v === "object") walk(v, `${pre}${k}.`); else if (typeof v === "number") flat[`${pre}${k}`] = v; } };
  walk(b);
  const gen = Object.entries(flat).find(([k]) => /generation|remaining|left|credits?$/i.test(k));
  const usd = Object.entries(flat).find(([k]) => /usd|dollar/i.test(k));
  const parts = [gen ? `${gen[1].toLocaleString("en-CA")} ${/generation/i.test(gen[0]) ? "generations" : gen[0].split(".").pop()} left` : "", usd ? `$${usd[1].toFixed(2)} balance` : ""].filter(Boolean);
  return { line: parts.join(" · ") || `balance: ${JSON.stringify(b).slice(0, 80)}`, usedPct: gen && /generation/i.test(gen[0]) ? ((2000 - gen[1]) / 2000) * 100 : null };
}

let cache = { at: 0, rows: null };
export async function servicesStatus({ fresh = false } = {}) {
  if (!fresh && cache.rows && Date.now() - cache.at < 30 * 60000) return cache.rows;
  const credits = creditStatus().providers;
  const rows = [];
  for (const s of serviceList()) {
    const row = { ...s, keySet: s.keyEnv ? hasKey(s.keyEnv) : null, line: null, usedPct: null, error: null };
    try {
      if (s.live === "credits" && credits[s.id]) {
        const c = credits[s.id];
        if (c.set) {
          row.line = `$${Number(c.left).toFixed(2)} of $${c.set.balance} left${c.daysLeft != null ? ` · about ${c.daysLeft} days at this week's pace` : ""}`;
          row.usedPct = c.set.balance ? ((c.set.balance - c.left) / c.set.balance) * 100 : null;
        }
      } else if (s.live === "elevenlabs" && row.keySet) Object.assign(row, await elevenlabs());
      else if (s.live === "pixellab" && row.keySet) Object.assign(row, await pixellab());
    } catch (err) {
      row.error = String(err.message).slice(0, 160);
    }
    if (!row.line) row.line = s.keyEnv ? (row.keySet ? "key set" : "no key in .env yet") : s.plan || "";
    row.warn = row.usedPct != null && row.usedPct >= 80;
    rows.push(row);
  }
  cache = { at: Date.now(), rows };
  return rows;
}
export function saveServices(list) {
  if (!Array.isArray(list)) throw new Error("Send the whole list.");
  const clean = list
    .slice(0, 50)
    .map((s) => ({
      id: String(s.id || "").slice(0, 40),
      name: String(s.name || "").slice(0, 60),
      rooms: (Array.isArray(s.rooms) ? s.rooms : []).map(String).slice(0, 12),
      purpose: String(s.purpose || "").slice(0, 200),
      plan: String(s.plan || "").slice(0, 120),
      resets: s.resets ? String(s.resets).slice(0, 20) : undefined,
      keyEnv: s.keyEnv
        ? String(s.keyEnv)
            .replace(/[^A-Z0-9_]/g, "")
            .slice(0, 60)
        : null,
      live: s.live || undefined,
    }))
    .filter((s) => s.id && s.name);
  writeJsonAtomic(FILE(), clean);
  cache = { at: 0, rows: null };
  return clean;
}
