// Reading a setup answers file (tools/setup.mjs; example: docs/kit/setup-answers.example.json).
// A value in brackets, "(an Ollama model)", is the example file's placeholder for something the person fills in: not a real value.
export const isPlaceholder = (v) => typeof v === "string" && /^\s*\(/.test(v);

// The model a project's lead desk starts on. A real name is kept; a placeholder gives none (the owner picks one on the
// Agents page); no model at all means "claude-code" for a Claude lead and none for any other provider.
export function leadModelOf(lead = {}) {
  if (isPlaceholder(lead.model)) return null;
  if (lead.model) return lead.model;
  return !lead.provider || lead.provider === "claude" ? "claude-code" : null;
}
