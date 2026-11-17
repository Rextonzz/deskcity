#!/usr/bin/env node
// Hub kit step 4 (2026-11-10): the mechanical half of setting up a hub. Claude Code does the talking (docs/kit/SETUP.md):
// it interviews the owner, writes their answers to a JSON file, and runs this to build everything from it.
//
//   node tools/setup.mjs --check                     what's in place and what's missing (changes nothing)
//   node tools/setup.mjs --parts                     every part of the hub, what it needs, and the presets (changes nothing)
//   node tools/setup.mjs --example                   write a starting answers file to data/setup-answers.json (makes data/ if needed; never overwrites)
//   node tools/setup.mjs --answers setup-answers.json   build the hub from the answers (safe to run again)
//
// The answers file (example: docs/kit/setup-answers.example.json):
//   owner      { name }                              shown everywhere and used in every worker's instructions
//   place      { name, lat, lon, timezone }          sunrise, sunset, weather and page times (all optional)
//   pet        null, or { name, kind }               a campus CEO pet; none by default
//   preset     "light", "standard" or "everything"  which parts are on (src/hub/modules.js); see --parts
//   modules    [ids]                                 parts to add on top of the preset (or the whole list, with no preset)
//   display    "2d", "3d", "neural" or "pages"       what the hub opens on (default 3d): the 2D city, the 3D city, the
//                                                    Neural web of workers, or the plain web pages. Each device can switch.
//   providers  { openai: { models: [...] }, local: { baseUrl, models: [...] }, ... }   which ones this person uses
//   projects   [ { id, name, district, folder, lead: { provider, model, effort } } ]
//              district: Creative, Games or Tools. folder: where its sessions run (for the Claude Code hook).
//              lead: who leads it (default: their Claude Code session, model "claude-code").
//              team: a team template (e.g. "gamedev"; size "small" or "full"): HR gets a staff request per crew role.
// Keys never go in the answers: they go in .env (copy .env.example). Existing rooms and desks are kept.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DISPLAYS = ["2d", "3d", "neural", "pages"]; // same list as src/hub/settings.js
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);
const args = process.argv.slice(2), arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const ok = (m) => console.log(`  OK    ${m}`), todo = (m) => console.log(`  TODO  ${m}`), info = (m) => console.log(`        ${m}`);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const envKeys = () => Object.fromEntries((fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
const has = (env, k) => Boolean(env[k]) && !/^your-/.test(env[k]);

function check() {
  console.log("Hub check");
  const major = Number(process.versions.node.split(".")[0]);
  major >= 20 ? ok(`Node ${process.versions.node}`) : todo(`Node 20 or newer (this is ${process.versions.node}): nodejs.org`);
  fs.existsSync("node_modules") ? ok("packages installed") : todo("install packages: npm install");
  const env = envKeys();
  fs.existsSync(".env") ? ok(".env exists") : todo("copy .env.example to .env and add your keys");
  has(env, "ANTHROPIC_API_KEY") ? ok("Claude key") : todo("ANTHROPIC_API_KEY in .env (HR, the finance buddy and Claude workers use it)");
  for (const [k, label] of [["GEMINI_API_KEY", "Gemini"], ["OPENAI_API_KEY", "OpenAI"], ["XAI_API_KEY", "Grok"], ["DEEPSEEK_API_KEY", "DeepSeek"]]) if (has(env, k)) ok(`${label} key`);
  has(env, "DASHBOARD_PASSWORD_HASH") ? ok("dashboard password set") : todo("set a dashboard password: npm run set-password (needed for spending and phone access)");
  const s = readJson("data/hub-settings.json", null);
  if (s) info(`display: ${DISPLAYS.includes(s.display) ? s.display : "3d (default)"}; parts on: ${Array.isArray(s.modules) ? s.modules.join(", ") || "core only" : "(not chosen yet: the old add-on list decides)"}`);
  s ? ok(`settings for ${s.owner?.name || "?"}`) : todo("settings: run setup with an answers file (Claude Code does this: docs/kit/SETUP.md)");
  const r = readJson("data/agents/roster.json", null);
  r ? ok(`roster: ${r.rooms?.length || 0} rooms, ${r.desks?.length || 0} desks`) : info("roster: made on first start (Hub and HR)");
  const map = readJson("data/agents/hook-map.json", {});
  Object.keys(map).length ? ok(`hook map: ${Object.keys(map).length} folders`) : todo("hook map: no project folders yet (setup adds them)");
  fs.existsSync("data/agents/token.txt") ? ok("agent key file") : info("agent key file: made by setup or on first start");
  info("Claude Code hook: node tools/agent-hook-check.mjs (add --fix to install it)");
}

async function build(file) {
  const a = readJson(file, null);
  if (!a) throw new Error(`Can't read ${file}.`);
  fs.mkdirSync("data/agents", { recursive: true });
  // 1. settings (merged into any existing file, so a re-run only changes what the answers say)
  const sPath = "data/hub-settings.json", s = readJson(sPath, {});
  for (const k of ["owner", "place", "providers"]) if (a[k]) s[k] = { ...(s[k] || {}), ...a[k] };
  // The example answers file has model names in brackets, "(the Ollama models Sam has pulled)": a placeholder, not a model
  for (const p of Object.values(s.providers || {})) if (Array.isArray(p?.models)) p.models = p.models.filter((m) => !/^\s*\(/.test(String(m)));
  // A provider's own key may only go to its own address (the hub refuses the same settings before any request).
  if (a.providers) {
    const { providerProblem } = await import("../src/pipeline/openai-compat.js");
    const bad = Object.entries(s.providers || {}).map(([id, p]) => providerProblem(id, p)).filter(Boolean);
    if (bad.length) throw new Error(`The providers in ${file} can't be used as they are:\n  ${bad.join("\n  ")}`);
  }
  if ("pet" in a) s.pet = a.pet && a.pet.name ? a.pet : null;
  if ("preset" in a || "modules" in a) {
    const { MODULES, PRESETS, notIncluded } = await import("../src/hub/modules.js");
    const known = new Set(MODULES.filter((m) => !m.always).map((m) => m.id));
    const base = a.preset ? PRESETS[String(a.preset).toLowerCase()]?.modules : [];
    if (!base) console.log(`  NOTE  preset "${a.preset}" isn't light, standard or everything: using light`);
    const want = [...(base || []), ...(Array.isArray(a.modules) ? a.modules : [])];
    for (const id of want) if (!known.has(id)) console.log(`  NOTE  no part called "${id}" (node tools/setup.mjs --parts lists them)`);
    for (const id of want) if (known.has(id) && notIncluded(MODULES.find((m) => m.id === id))) console.log(`  NOTE  "${id}" is not included in this kit (files it needs are missing), so it is left off`);
    s.modules = [...new Set(want.filter((id) => known.has(id) && !notIncluded(MODULES.find((m) => m.id === id))))];
  }
  if ("display" in a) {
    if (DISPLAYS.includes(String(a.display).toLowerCase())) s.display = String(a.display).toLowerCase();
    else console.log(`  NOTE  display "${a.display}" isn't 2d, 3d, neural or pages: kept ${s.display || "3d"}`);
  }
  s.hubFolder = a.hubFolder || s.hubFolder || ROOT.replace(/\\/g, "/");
  fs.writeFileSync(sPath, JSON.stringify(s, null, 2) + "\n");
  ok(`settings written for ${s.owner?.name || "?"} (display: ${s.display || "3d"}${s.modules ? `; parts on: ${s.modules.join(", ") || "core only"}` : ""})`);
  // 2. roster: rooms and leads (the agents module makes the starter Hub and HR on first read)
  const A = await import("../src/pipeline/agents.js");
  const { leadModelOf } = await import("../src/hub/setup-answers.js");
  A.roster();
  const map = readJson("data/agents/hook-map.json", {});
  map[s.hubFolder.replace(/\//g, path.sep)] ||= { room: "hub", desk: "hub-lead" };
  for (const p of a.projects || []) {
    const room = A.addRoom({ id: p.id || p.name, name: p.name, district: p.district });
    const lead = p.lead || {}, deskId = `${room.id}-lead`;
    const leadModel = leadModelOf(lead); // a placeholder model in brackets gives none: the owner picks one on the Agents page
    const have = A.roster().desks.find((d) => d.room === room.id && d.lead);
    if (!have) A.saveDesk({ id: deskId, room: room.id, role: "Project lead", lead: true, provider: lead.provider || "claude", model: leadModel, effort: lead.effort || null, status: "active", capUsdMonth: lead.capUsdMonth ?? null, ...(["openai", "grok", "deepseek", "local"].includes(lead.provider) ? { runner: "hub" } : {}) });
    if (p.folder) map[p.folder] = { room: room.id, desk: have?.id || deskId };
    if (p.team && !room.existed) {
      const { crewRequests } = await import("../src/pipeline/teams.js");
      const asked = crewRequests({ team: p.team, size: p.size, room: room.id, name: room.name }).map((q) => A.addRequest(q));
      ok(`${room.name}: asked HR for ${asked.length} crew (${asked.map((q) => q.role).join(", ")}); approve each on the Agents page`);
    }
    ok(`${room.existed ? "kept" : "added"} ${room.name} (${room.id})${have ? `, lead ${have.id}` : `, lead ${deskId}`}${p.folder ? `, folder ${p.folder}` : ""}`);
  }
  fs.writeFileSync("data/agents/hook-map.json", JSON.stringify(map, null, 2) + "\n");
  A.ingestToken();
  ok("agent key file ready");
  console.log("\nNext:");
  info("1. npm run set-password        (a dashboard password)");
  info("2. node tools/agent-hook-check.mjs --fix   (Claude Code sessions report automatically)");
  info("3. npm start, then open http://localhost:3000");
  info("Other tools (Codex, Antigravity, scripts, chat apps): docs/kit/REPORTING.md");
}

// Every part, what it needs, and the presets: for the setup interview (docs/kit/SETUP.md).
async function parts() {
  const { MODULES, PRESETS, GROUPS, notIncluded } = await import("../src/hub/modules.js");
  console.log("Parts of the hub (core is always on):");
  let group = null;
  const order = (m) => (m.always ? -1 : GROUPS.indexOf(m.group));
  for (const m of MODULES.filter((x) => !x.private).sort((a, b) => order(a) - order(b))) {
    if (m.group !== group) { group = m.group; console.log(`\n${group || "Always on"}`); }
    const n = m.needs || {}, needs = [...(n.programs || []), ...(n.keys || []), n.ai ? `AI: ${n.ai}` : null, n.size || null].filter(Boolean);
    const base = m.extends ? MODULES.find((b) => b.id === m.extends)?.name : null;
    const pad = `\n${" ".repeat(14)}`;
    console.log(`  ${m.id.padEnd(11)} ${m.name}${notIncluded(m) ? " (not included in this kit)" : ""}: ${m.about}${base ? `${pad}builds on ${base}${m.spunOutOf ? `; spun out of ${m.spunOutOf}` : ""}` : ""}${needs.length ? `${pad}needs: ${needs.join(", ")}` : ""}`);
  }
  console.log("\nPresets:");
  for (const [id, p] of Object.entries(PRESETS)) console.log(`  ${id.padEnd(11)} ${p.name}: ${p.about}${p.modules.length ? ` (${p.modules.join(", ")})` : ""}`);
}

function example() {
  const to = path.join("data", "setup-answers.json");
  if (fs.existsSync(to)) throw new Error(`${to} already exists, so it was left as it is. Edit it, then run: node tools/setup.mjs --answers ${to.replace(/\\/g, "/")}`);
  fs.mkdirSync("data", { recursive: true });
  fs.copyFileSync(path.join("docs", "kit", "setup-answers.example.json"), to);
  console.log(`Wrote ${to.replace(/\\/g, "/")}. Edit it for your projects, then run: node tools/setup.mjs --answers data/setup-answers.json`);
}

try {
  if (args.includes("--example")) example();
  else if (args.includes("--parts")) await parts();
  else if (args.includes("--check") || !arg("--answers")) check();
  else await build(arg("--answers"));
} catch (err) { console.error(`Setup stopped: ${err.message}`); process.exit(1); }
