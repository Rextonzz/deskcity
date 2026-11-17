// Shared set-up for the hub tests (npm test). Each test file runs in its own process (node --test), so each gets its
// own throwaway data folder: nothing here reads or writes the real data/ or .env, calls an AI, or reaches the network.
//   const { A, root, fake } = await hub();          A = src/pipeline/agents.js, loaded against the throwaway folder
//   fake("desk_job", {...})                          what the next AI answer of that step should be
// Keys from the real .env are removed from this process, so a test never depends on which keys this PC has.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// a file:// URL for a module in the app: import() of a bare drive path (C:...) fails on Windows (ERR_UNSUPPORTED_ESM_URL_SCHEME)
export const app = (...p) => pathToFileURL(path.join(APP, ...p)).href;
// root: reuse a data folder (a second "hub start" on the same data); seed: files written into data/agents first.
export async function hub({ rooms, desks, root: given, seed } = {}) {
  const root = given || fs.mkdtempSync(path.join(os.tmpdir(), "hubtest-"));
  fs.mkdirSync(path.join(root, "data", "agents"), { recursive: true });
  fs.mkdirSync(path.join(root, "fake"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs", "projects"), { recursive: true });
  process.env.HUB_TEST_ROOT = root;
  process.env.PIPELINE_FAKE_CLAUDE = path.join(root, "fake");
  process.env.HUB_AUTORUN_PER_DAY ??= "none"; // existing hand-off tests keep running; the auto-run limit has its own test
  process.env.HUB_HELPERS ??= "on"; // the AI helpers are off on a new hub; the tests that need them say so here (src/hub/helpers.js), so no test depends on this PC's settings files
  process.env.HUB_HELPERS_PER_DAY ??= "none";
  await import(app("src/config.js")); // loads .env (if any) first, so the keys can be taken out after
  for (const k of Object.keys(process.env)) if (/(_KEY|_TOKEN|_SECRET|PASSWORD|TOTP|NTFY)/.test(k)) delete process.env[k];
  for (const [f, v] of Object.entries(seed || {})) fs.writeFileSync(path.join(root, "data", "agents", f), typeof v === "string" ? v : JSON.stringify(v));
  if (rooms || desks) fs.writeFileSync(path.join(root, "data", "agents", "roster.json"), JSON.stringify({ rooms: rooms || [{ id: "hub", name: "Hub" }, { id: "hr", name: "HR" }], desks: desks || [] }));
  // no network: anything that isn't answered by a test's own stand-in fails loudly
  globalThis.fetch = async (u) => { throw new Error(`test tried to reach the network: ${String(u).slice(0, 80)}`); };
  const A = await import(app("src/pipeline/agents.js"));
  const fake = (name, obj) => fs.writeFileSync(path.join(root, "fake", `${name}.json`), JSON.stringify(obj));
  return { A, root, fake, data: (f) => path.join(root, "data", "agents", f) };
}
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Standard staff for tests that need projects and leads.
export const ROOMS = [{ id: "hub", name: "Hub" }, { id: "hr", name: "HR" }, { id: "game", name: "Game", status: "active" }];
export const DESKS = [
  { id: "hr", room: "hr", role: "HR", lead: true, provider: "claude", model: "claude-haiku-5-5", effort: "low", capUsdMonth: 2, status: "active", runner: "hub" },
  { id: "game-lead", room: "game", role: "Project lead", lead: true, provider: "claude", model: "claude-code", status: "active" },
  { id: "game-artist", room: "game", role: "Pixel artist", lead: false, provider: "claude", model: "claude-haiku-5-5", capUsdMonth: 3, status: "active", runner: "hub" },
];
