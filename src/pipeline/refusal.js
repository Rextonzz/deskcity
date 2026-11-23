// Refusal pass-off (the owner 2026-11-15): when an AI provider REFUSES a job the hub runs for a desk (its own filter or
// refusal, not an outage or an error), runJob (agents.js) tags the refusal, passes the job once to the next service
// that hasn't tried it, and stops and asks the owner when the provider's own words name a serious category or every
// allowed service has declined. This file holds the pure parts: the error the three providers throw, the word list,
// the switch, the fixed order and the counts. No model ever judges whether the content is harmless: the only test is
// the provider's own words against SERIOUS.
// It is for false positives, not for getting round a provider's real policy. It covers desk jobs only (runJob), not the
// video pipeline's steps, HR, the assistant, chatter or any other helper call.
//   Settings: agents.passOff = { on, maxHops } (hub.defaults.json: off, one hop; hub.owner.json can open it up, 0 = no
//   limit; data/hub-settings.json from Admin wins). A desk can turn it off with passOff: false. Tests: HUB_PASSOFF=on|off wins over the settings files.
import fs from "node:fs";
import path from "node:path";
import { hubSettings, isDemo, resetHubSettings, settingsRoot } from "../hub/settings.js";
import { hasRealAnthropicKey } from "../config.js";
import { hasGemini } from "./ai.js";
import { COMPAT, isCompat, compatReady } from "./openai-compat.js";

const REASON_MAX = 200;
export const NO_REASON = "no reason given";
const trimReason = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, REASON_MAX) || NO_REASON;

// What a provider throws when it declines. Extends Error, so every caller that catches an Error keeps working.
export class ProviderRefusal extends Error {
  constructor(message, { provider, model, reason } = {}) {
    super(message);
    this.name = "ProviderRefusal";
    this.provider = provider || "unknown";
    this.model = model || null;
    this.reason = trimReason(reason);
  }
}

// The provider's own words, matched case-insensitively against the reason only.
export const SERIOUS = [
  /self[- ]?harm/i, /suicid/i, /weapon/i, /firearm/i, /explosive/i, /illegal/i, /minor/i, /child/i, /csam/i, /sexual/i,
  /extremis/i, /terror/i, /dox/i, /privacy/i, /personal (data|information)/i, /hate/i,
  /PROHIBITED_CONTENT/i, /SEXUALLY_EXPLICIT/i, /DANGEROUS_CONTENT/i, /HATE_SPEECH/i,
];
// A bare "SAFETY", "OTHER", "content_filter" or "no reason given" is not serious: the job passes on.
export const isSerious = (reason) => SERIOUS.some((re) => re.test(String(reason || "")));

// Reading each provider's refusal out of its response (pure, so tests feed them canned responses).
// Claude: the response's text blocks, else "no reason given".
export function claudeRefusal(message, name) {
  const text = (message.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ");
  return new ProviderRefusal(`Claude declined the ${name} step.`, { provider: "claude", model: message.model, reason: text });
}
// Gemini: blockReason or finishReason, plus the names of safety categories that were blocked or rated HIGH or MEDIUM.
// Returns a ProviderRefusal for the blocked cases, or null (an empty answer with no block reason stays a plain Error).
const GEMINI_BLOCKS = ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY"];
export function geminiRefusal(j, model) {
  const cand = j.candidates?.[0];
  const block = j.promptFeedback?.blockReason;
  const fin = cand?.finishReason;
  if (!block && !GEMINI_BLOCKS.includes(fin)) return null;
  const word = block || fin;
  const ratings = [...(cand?.safetyRatings || []), ...(j.promptFeedback?.safetyRatings || [])];
  const cats = [...new Set(ratings.filter((r) => r.blocked || r.probability === "HIGH" || r.probability === "MEDIUM").map((r) => r.category).filter(Boolean))];
  return new ProviderRefusal(`Gemini returned no answer (${word})`, { provider: "gemini", model: j.modelVersion || model, reason: [word, ...cats].join(", ") });
}
// OpenAI-style: message.refusal text, or finish_reason "content_filter". Returns null when the answer is not a refusal.
export function compatRefusal(j, provider, label, model) {
  const ch = j.choices?.[0];
  const refusal = ch?.message?.refusal;
  if (!refusal && ch?.finish_reason !== "content_filter") return null;
  return new ProviderRefusal(`${label} declined the job (${refusal ? "refusal" : "content_filter"}).`, { provider, model: j.model || model, reason: refusal || "content_filter" });
}

// The switch. Missing = off (opt-in). Demo mode = off. maxHops: how many times a refused job may be passed on (0 = no
// limit, walk every ready service); missing or invalid = 1.
export function passOffSettings() {
  if (isDemo()) return { on: false, maxHops: 1 };
  const po = hubSettings().agents?.passOff;
  let on = po?.on === true;
  const e = process.env.HUB_PASSOFF;
  if (e === "on" || e === "off") on = e === "on";
  const h = Number(po?.maxHops);
  const maxHops = Number.isInteger(h) && h >= 0 ? h : 1;
  return { on, maxHops };
}

// Admin card: the switch. Save from Admin; `confirmed` = the dashboard password was confirmed for this request. Turning ON
// needs it, turning OFF does not (same rule as the AI helpers). Returns { status, body }.
export const passOffStatus = () => ({ on: passOffSettings().on, demo: isDemo() });
export function savePassOff(body = {}, confirmed = false) {
  if (isDemo()) return { status: 403, body: { error: "This is a demo: nothing runs here." } };
  if (typeof body.on !== "boolean") return { status: 400, body: { error: "Say on or off." } };
  if (body.on && !passOffSettings().on && !confirmed) return { status: 403, body: { error: "Enter your password to do this.", needPassword: true } };
  const file = path.join(settingsRoot(), "data", "hub-settings.json");
  let s = {};
  try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  s.agents = { ...(s.agents || {}), passOff: { ...(s.agents?.passOff || {}), on: body.on } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
  resetHubSettings();
  return { status: 200, body: passOffStatus() };
}

// The fixed order the job is passed along.
export const ORDER = ["claude", "gemini", "openai", "grok", "deepseek", "muse", "local"];

// The model a compat provider is known by: the hub settings' list, else any active roster desk on that provider.
function knownModel(p, desks = []) {
  const s = hubSettings().providers?.[p]?.models?.[0];
  if (s) return s;
  return desks.find((d) => d.provider === p && d.status !== "retired" && d.status !== "planned" && d.model)?.model || null;
}
const realReady = (p) => (p === "claude" ? hasRealAnthropicKey() : p === "gemini" ? hasGemini() : isCompat(p) ? compatReady(p) : false);

// The next service to try: walks ORDER from just after the desk's own provider, wrapping round, skipping `tried`, and
// returns the first usable { provider, model } or null. A desk's optional `passOffTo` (provider ids) narrows the list.
// `ready(provider)` is injectable so tests need no keys.
export function nextRoute(desk, tried, { desks = [], ready = realReady } = {}) {
  const own = desk.provider === "claude" || desk.provider === "gemini" || isCompat(desk.provider) ? desk.provider : "claude";
  const at = ORDER.indexOf(own);
  const walk = ORDER.map((_, i) => ORDER[(at + 1 + i) % ORDER.length]);
  const allowed = Array.isArray(desk.passOffTo) && desk.passOffTo.length ? desk.passOffTo : null;
  const skip = new Set(tried || []);
  for (const p of walk) {
    if (skip.has(p) || (allowed && !allowed.includes(p)) || !ready(p)) continue;
    if (p === "claude") return { provider: "claude", model: undefined };
    if (p === "gemini") return { provider: "gemini", model: desk.effort === "low" ? "gemini-flash" : "gemini-pro" };
    if (!COMPAT[p]) continue;
    const model = knownModel(p, desks);
    if (model) return { provider: p, model };
  }
  return null;
}

// Counts for the last 30 days from data/agents/refusals.jsonl rows: { total, byProvider: [{ provider, count }], byDesk: [{ desk, count }] }.
export function refusalStats(rows, now = new Date()) {
  const since = now.getTime() - 30 * 86400e3;
  const mine = (rows || []).filter((r) => Date.parse(r.at) >= since);
  const count = (key) => Object.entries(mine.reduce((m, r) => ((m[r[key] || "unknown"] = (m[r[key] || "unknown"] || 0) + 1), m), {})).map(([k, n]) => ({ [key]: k, count: n })).sort((a, b) => b.count - a.count || String(a[key]).localeCompare(String(b[key])));
  return { total: mine.length, byProvider: count("provider"), byDesk: count("desk") };
}
