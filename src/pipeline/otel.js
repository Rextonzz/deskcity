// OpenTelemetry in: turns OTLP/HTTP JSON traces into hub agent events (docs/agent-onboarding.md, "OpenTelemetry and MCP").
// Any tool that can export OpenTelemetry (the GenAI semantic conventions: gen_ai.*) can report without the hub's hook.
// Pure: no files, no network. The route (src/routes/agents.js) checks the key and passes each event to recordEvent.
//
// Metadata only. Only the attributes named below are read; everything else on a span (prompts, completions, tool
// arguments and results, span names, events, links) is dropped, so content can't reach the hub even if an exporter
// sends it (gen_ai.input.messages, gen_ai.output.messages, gen_ai.system_instructions, gen_ai.tool.call.arguments...).
//
// Attribute -> event field (names per the OpenTelemetry GenAI conventions; older names are accepted too):
//   resource hub.desk / span hub.desk            desk (else service.name matching a desk id or alias, else "temp-worker")
//   resource hub.room / span hub.room            room (else the desk's room, else "unassigned")
//   gen_ai.operation.name = execute_tool, or gen_ai.tool.name present        action "tool", tool = gen_ai.tool.name
//   gen_ai.usage.* present, or operation chat / text_completion / generate_content / invoke_agent ...   action "turn done"
//   gen_ai.response.model, else gen_ai.request.model                         model
//   gen_ai.usage.input_tokens (old: prompt_tokens) / output_tokens (old: completion_tokens)   inputTokens / outputTokens
//   gen_ai.usage.cache_read.input_tokens / cache_creation.input_tokens       cacheReadTokens / cacheWriteTokens
//   gen_ai.provider.name (old: gen_ai.system)                                provider (anthropic -> claude, google -> gemini)
//   gen_ai.agent.id / gen_ai.agent.name                                      agent (ids only)
//   status.code ERROR (2), or an error.type attribute                        failed: true
//   traceId                                                                  session (ids only)
// A span with none of the GenAI attributes is skipped (counted, not stored).

export const MAX_SPANS = 200; // per request; the rest are rejected and reported in partialSuccess
export const MAX_BODY_BYTES = 1024 * 1024; // per request (the hub's JSON parser allows 2 MB; this is tighter)

// OTLP/JSON AnyValue -> a plain scalar (arrays and maps are ignored: nothing we read is one).
function scalar(v) {
  if (!v || typeof v !== "object") return undefined;
  if ("stringValue" in v) return String(v.stringValue);
  if ("intValue" in v) return Number(v.intValue); // 64-bit ints arrive as strings
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("boolValue" in v) return Boolean(v.boolValue);
  return undefined;
}
function attrMap(list) {
  const m = new Map();
  if (!Array.isArray(list)) return m;
  for (const a of list.slice(0, 200)) {
    if (!a || typeof a.key !== "string") continue;
    const v = scalar(a.value);
    if (v !== undefined) m.set(a.key, v);
  }
  return m;
}
const first = (m, ...keys) => {
  for (const k of keys) if (m.has(k) && m.get(k) !== "") return m.get(k);
  return undefined;
};
const count = (v) => (v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : undefined);
const slug = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const short = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

const PROVIDER = { anthropic: "claude", claude: "claude", "aws.bedrock": "claude", google: "gemini", gemini: "gemini", "gcp.gemini": "gemini", "gcp.vertex_ai": "gemini", "gcp.gen_ai": "gemini", vertex_ai: "gemini" };
const TURN_OPS = new Set(["chat", "text_completion", "generate_content", "invoke_agent", "create_agent", "embeddings", "invoke_workflow"]);

// body: the parsed OTLP/JSON ExportTraceServiceRequest. desks: the roster's desks (id, room, aliases).
// Returns { events, spans, skipped, rejected }: events are ready for recordEvent; spans is how many were sent.
export function spansToEvents(body, desks = []) {
  const events = [];
  let spans = 0, skipped = 0, rejected = 0;
  const byName = new Map();
  for (const d of desks) byName.set(slug(d.id), d);
  for (const d of desks) for (const a of d.aliases || []) if (!byName.has(slug(a))) byName.set(slug(a), d);
  for (const rs of Array.isArray(body?.resourceSpans) ? body.resourceSpans : []) {
    const res = attrMap(rs?.resource?.attributes);
    const service = slug(res.get("service.name"));
    for (const ss of Array.isArray(rs?.scopeSpans) ? rs.scopeSpans : []) {
      for (const sp of Array.isArray(ss?.spans) ? ss.spans : []) {
        spans++;
        if (spans > MAX_SPANS) { rejected++; continue; }
        const a = attrMap(sp?.attributes);
        const op = String(first(a, "gen_ai.operation.name") || "").toLowerCase();
        const toolName = first(a, "gen_ai.tool.name");
        const inTok = count(first(a, "gen_ai.usage.input_tokens", "gen_ai.usage.prompt_tokens"));
        const outTok = count(first(a, "gen_ai.usage.output_tokens", "gen_ai.usage.completion_tokens"));
        const cacheR = count(first(a, "gen_ai.usage.cache_read.input_tokens"));
        const cacheW = count(first(a, "gen_ai.usage.cache_creation.input_tokens"));
        const hasUsage = [inTok, outTok, cacheR, cacheW].some((x) => x !== undefined);
        const isTool = op === "execute_tool" || toolName !== undefined;
        if (!isTool && !hasUsage && !TURN_OPS.has(op)) { skipped++; continue; }

        // where it belongs: explicit hub.desk / hub.room, else the service name as a desk, else a temp worker
        const wantDesk = slug(first(a, "hub.desk") ?? res.get("hub.desk"));
        const wantRoom = slug(first(a, "hub.room") ?? res.get("hub.room"));
        const known = (wantDesk && byName.get(wantDesk)) || (service && byName.get(service)) || null;
        const desk = known?.id || wantDesk || "temp-worker";
        const room = wantRoom || known?.room || "unassigned";

        const ev = { desk, room, source: "otel" };
        const prov = String(first(a, "gen_ai.provider.name", "gen_ai.system") || "").toLowerCase();
        if (prov) ev.provider = PROVIDER[prov] || slug(prov);
        const model = first(a, "gen_ai.response.model", "gen_ai.request.model");
        if (model) ev.model = short(model, 60);
        const agent = first(a, "gen_ai.agent.id", "gen_ai.agent.name");
        if (agent) ev.agent = short(agent, 64);
        if (sp?.traceId) ev.session = short(sp.traceId, 64);
        const code = sp?.status?.code;
        if (code === 2 || /^STATUS_CODE_ERROR$/i.test(String(code || "")) || first(a, "error.type") !== undefined) ev.failed = true;

        if (isTool) {
          ev.action = "tool";
          if (toolName) ev.tool = short(toolName, 60);
          ev.summary = ev.tool ? `tool ${ev.tool}` : "tool call";
        } else {
          ev.action = "turn done";
          if (inTok !== undefined) ev.inputTokens = inTok;
          if (outTok !== undefined) ev.outputTokens = outTok;
          if (cacheR !== undefined) ev.cacheReadTokens = cacheR;
          if (cacheW !== undefined) ev.cacheWriteTokens = cacheW;
          ev.summary = `${op || "model call"}${ev.model ? ` ${ev.model}` : ""}`;
        }
        events.push(ev);
      }
    }
  }
  return { events, spans, skipped, rejected };
}
