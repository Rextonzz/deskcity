// Hub kit step 2 (2026-11-10): one worker type for every provider that speaks the OpenAI-style chat API.
// OpenAI, Grok (xAI), DeepSeek and local models (Ollama, LM Studio) all take the same request; each gets its own
// address, key and price. Claude and Gemini keep their own code (claude.js, ai.js).
//
// Addresses and keys: the defaults below, overridden per provider in the hub settings ("providers": { "local":
// { "baseUrl": "http://localhost:1234/v1" } }). Keys come from .env only (never the settings file).
// Model names are whatever the desk says (desk.model); the setup guide asks each person which ones they use, because
// model names change too often to bake in.
// Prices: data/ai.json "prices" (USD per million tokens, same shape as ai.js PRICES) or the provider's "prices" in
// settings. A provider with no price logs the call as unpriced; local models always cost 0.
import { hubSettings } from "../hub/settings.js";
import { costOf, aiSettings } from "./ai.js";
import { isRealKey } from "../config.js";
import { compatRefusal } from "./refusal.js";
import { fetchRetry } from "./fetch-retry.js";

export const COMPAT = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY", schema: "json_schema" },
  grok: { label: "Grok (xAI)", baseUrl: "https://api.x.ai/v1", keyEnv: "XAI_API_KEY", schema: "json_schema" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", keyEnv: "DEEPSEEK_API_KEY", schema: "json_object" },
  // Muse (Meta's Model API), 2026-11-11. Address and model names as published at launch; if Meta changes them, set
  // "providers": { "muse": { "baseUrl": "...", "models": ["..."] } } in the hub settings. Falls back to JSON mode if
  // the server refuses a JSON schema.
  muse: { label: "Muse (Meta)", baseUrl: "https://api.meta.ai/v1", keyEnv: "META_API_KEY", schema: "json_schema", prices: { "muse-spark": { in: 1.25, out: 4.25 } } },
  local: { label: "Local model (Ollama or LM Studio)", baseUrl: "http://localhost:11434/v1", keyEnv: null, schema: "json_schema", free: true },
};
export const isCompat = (provider) => Object.hasOwn(COMPAT, provider);

// Where each built-in key may be sent (money safety S2, 2026-11-16): a provider's own key goes only to that provider's
// own address. A custom baseUrl needs its own keyEnv (not one of these names) or an inline key.
export const KEY_HOSTS = {
  ANTHROPIC_API_KEY: "api.anthropic.com",
  GEMINI_API_KEY: "generativelanguage.googleapis.com",
  OPENAI_API_KEY: "api.openai.com",
  XAI_API_KEY: "api.x.ai",
  DEEPSEEK_API_KEY: "api.deepseek.com",
  META_API_KEY: "api.meta.ai",
};
const protoOf = (u) => { try { return new URL(String(u)).protocol; } catch { return null; } };
const hostOf = (u) => { try { return new URL(String(u)).hostname.toLowerCase(); } catch { return null; } };
// What's wrong with a provider's settings (`own`: its entry under "providers" in the hub settings), or null. Used by
// the hub before any request and by the setup tool before it saves the answers.
export function providerProblem(provider, own = {}) {
  const base = COMPAT[provider];
  if (!base) return null; // not an OpenAI-style provider: nothing here sends a key for it
  if (!own || typeof own !== "object") return `providers.${provider} must be an object.`;
  if (base.free && !own.key) return null; // local: no key is sent (its keyEnv is ignored)
  const keyEnv = own.keyEnv || base.keyEnv;
  const url = own.baseUrl || base.baseUrl, host = hostOf(url);
  if (!host) return `providers.${provider}.baseUrl "${String(url).slice(0, 80)}" isn't a web address.`;
  if (own.key) return null; // an inline key is the owner's own choice for this address
  // A built-in key never goes over plain http, even to the right host.
  if (Object.hasOwn(KEY_HOSTS, keyEnv) && protoOf(url) !== "https:")
    return `${base.label} would send ${keyEnv} over plain http. Use an https address.`;
  if (Object.hasOwn(KEY_HOSTS, keyEnv) && KEY_HOSTS[keyEnv] !== host)
    return `${base.label} would send ${keyEnv} to ${host}, but that key may only go to ${KEY_HOSTS[keyEnv]}. For another address, set providers.${provider}.keyEnv to a key name of its own (not ${Object.keys(KEY_HOSTS).join(", ")}) and put that key in .env.`;
  return null;
}
export function providerConfig(provider) {
  const base = COMPAT[provider];
  if (!base) throw new Error(`Unknown provider "${provider}".`);
  const own = hubSettings().providers?.[provider] || {};
  const refused = providerProblem(provider, own);
  if (refused) return { ...base, ...own, key: null, refused };
  return { ...base, ...own, key: own.key || (base.keyEnv ? process.env[own.keyEnv || base.keyEnv] : "local") };
}
// Is this provider usable from here (a key for cloud ones; local is always "usable", it just fails if not running)
export function compatReady(provider) {
  const c = providerConfig(provider);
  return !c.refused && Boolean(c.free || isRealKey(c.key));
}
// The price a desk needs before the hub runs it (money safety B1): null when priced (or free), else what to add.
export function compatPriceGap(provider, model) {
  const c = providerConfig(provider);
  if (c.free) return null;
  const { prices = {} } = aiSettings();
  if (costOf(model, {}, { ...(c.prices || {}), ...prices }) !== null) return null;
  return `No price is set for ${c.label} model "${model}", so the hub can't count what it spends and its cap would never trip. Add providers.${provider}.prices["${model}"] = { "in": <US$ per million input tokens>, "out": <US$ per million output tokens> } to the hub settings (data/hub-settings.json), then run it again.`;
}

export const priceOf = (provider, model, u, table) => {
  const c = providerConfig(provider);
  return c.free ? 0 : costOf(model, u, { ...(c.prices || {}), ...(table || {}) });
};

// One structured call. The answer must match `schema` (a JSON schema): providers that take json_schema get it
// directly; the rest (DeepSeek, or a local server that refuses it) get JSON mode with the schema in the instructions.
export async function askOpenAI({ provider, model, system, content, schema, effort, prices, timeoutMs = 300000 }) {
  const c = providerConfig(provider);
  if (c.refused) throw new Error(c.refused); // never sends a built-in key to another address (S2)
  if (!c.free && !compatReady(provider)) throw new Error(`No ${c.label} key: add ${c.keyEnv} to the hub's .env and restart it.`);
  if (!model) throw new Error(`Say which ${c.label} model this desk uses (its model field).`);
  const text = typeof content === "string" ? content : (content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n\n");
  const started = Date.now();
  const call = async (mode) => {
    const sys = mode === "json_schema" ? system : `${system}\n\nAnswer with one JSON object only, matching this JSON schema exactly:\n${JSON.stringify(schema)}`;
    const body = {
      model, messages: [{ role: "system", content: sys }, { role: "user", content: text }],
      response_format: mode === "json_schema" ? { type: "json_schema", json_schema: { name: "answer", strict: true, schema } } : { type: "json_object" },
      ...(effort && provider === "openai" && effort !== "medium" ? { reasoning_effort: effort === "max" || effort === "xhigh" ? "high" : effort } : {}),
    };
    // A network drop is tried again (fetch-retry.js); a local server that isn't running is reported straight away.
    const r = await fetchRetry(`${c.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json", ...(c.key && !c.free ? { authorization: `Bearer ${c.key}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    }, { tries: provider === "local" ? 1 : 4 }).catch((err) => { throw new Error(provider === "local" ? `The local model server at ${c.baseUrl} isn't answering (is Ollama or LM Studio running?): ${err.message}` : `${c.label}: ${err.message}`); });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(`${c.label} ${r.status}: ${j.error?.message || JSON.stringify(j).slice(0, 200)}`); e.status = r.status; throw e; }
    return j;
  };
  let j;
  try { j = await call(c.schema); }
  catch (err) { if (c.schema === "json_schema" && err.status === 400) j = await call("json_object"); else throw err; }
  const refused = compatRefusal(j, provider, c.label, model);
  if (refused) throw refused;
  const msg = j.choices?.[0]?.message?.content;
  if (!msg) throw new Error(`${c.label} returned no answer.`);
  let answer;
  try { answer = JSON.parse(String(msg).replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { throw new Error(`${c.label} didn't answer in JSON.`); }
  const u = j.usage || {};
  const usage = {
    inputTokens: Math.max(0, (u.prompt_tokens || 0) - (u.prompt_tokens_details?.cached_tokens || u.prompt_cache_hit_tokens || 0)),
    outputTokens: u.completion_tokens || 0,
    cacheReadTokens: u.prompt_tokens_details?.cached_tokens || u.prompt_cache_hit_tokens || 0,
  };
  return { answer, usage, ms: Date.now() - started, model: j.model || model, costUsd: priceOf(provider, j.model || model, usage, prices) ?? priceOf(provider, model, usage, prices) };
}
