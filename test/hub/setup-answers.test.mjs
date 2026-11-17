// The setup answers file: a placeholder in brackets never becomes a real model, and the example uses a neutral project name.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { APP, app } from "./helper.mjs";

const { leadModelOf, isPlaceholder } = await import(app("src/hub/setup-answers.js"));

test("a lead's placeholder model gives no model; a real one is kept; a Claude lead defaults to claude-code", () => {
  assert.equal(leadModelOf({ provider: "local", model: "(an Ollama model)" }), null);
  assert.equal(leadModelOf({ provider: "local", model: "llama3.1" }), "llama3.1");
  assert.equal(leadModelOf({ provider: "local" }), null);
  assert.equal(leadModelOf({}), "claude-code");
  assert.equal(leadModelOf({ provider: "claude" }), "claude-code");
  assert.equal(isPlaceholder("  (the Ollama models Sam has pulled)"), true);
  assert.equal(isPlaceholder("gpt-6"), false);
});

test("the example answers file has no brand name, and its only placeholder models are in brackets", () => {
  const ex = JSON.parse(fs.readFileSync(path.join(APP, "docs/kit/setup-answers.example.json"), "utf8"));
  assert.ok(ex.projects.every((p) => !/etsy/i.test(p.name)));
  for (const p of ex.projects) if (p.lead?.model && p.lead.provider === "local") assert.equal(isPlaceholder(p.lead.model), true);
});
