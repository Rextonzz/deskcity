// A hub with only the kit's defaults says nothing of any one owner: the worker rules are the neutral default (no pronoun for
// the owner, no document that isn't shipped), no Windows tool path, no country or currency, a sign-in line built from the
// parts that are on. The owner's own words come from the settings (see neutral-text-owner.test.mjs, which the kit leaves out).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { APP, app } from "./helper.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "neutral-"));
const CODE = `
  const W = await import(${JSON.stringify(app("src/pipeline/workrules.js"))});
  const S = await import(${JSON.stringify(app("src/hub/settings.js"))});
  const M = await import(${JSON.stringify(app("src/hub/modules.js"))});
  const G = await import(${JSON.stringify(app("src/pipeline/grants.js"))});
  const cat = G.grantCatalogue();
  const dl = Object.values(cat).map((g) => g.note || "").join("\\n");
  console.log(JSON.stringify({ session: W.sessionRules({ tool: "T", desk: "d", room: "r" }), hubrun: W.hubRunRules(), country: S.country(), currency: S.currencyCode(), tools: S.toolPaths(), sub: M.loginSubtitle(), sub2: M.loginSubtitle({ modules: ["games"] }), dl }));
`;
const kit = (env = {}) => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", CODE], { env: { ...process.env, HUB_TEST_ROOT: root, HUB_DEMO: "1", ...env }, encoding: "utf8", cwd: APP }));

test("kit defaults: the worker rules name the owner by the settings' name, use no pronoun for them and cite no document", () => {
  const r = kit();
  for (const t of [r.session, r.hubrun]) {
    assert.match(t, /^You's working rules/);
    assert.doesNotMatch(t, /\b(his|he|him|himself)\b/i);
    assert.doesNotMatch(t, /docs\/|\.md\b/);
  }
  assert.match(r.session, /node T ask --from d --room r/);
});

test("kit defaults: no country, USD, no tool paths, and no Windows drive path in the access notes", () => {
  const r = kit();
  assert.equal(r.country, "");
  assert.equal(r.currency, "USD");
  assert.deepEqual(r.tools, { godotPaths: [], programFilesDirs: [], downloadDir: "" });
  assert.doesNotMatch(r.dl, /\bD:[\\/]|Tools/); // a program found on this PC (Blender under Program Files) may show; no fixed path does
  assert.doesNotMatch(r.dl, /\bhe\b/);
});

test("kit defaults: the sign-in line is neutral, or lists the add-on parts that are on", () => {
  const r = kit();
  assert.equal(r.sub, "Your AI team: workers, jobs and costs");
  assert.equal(r.sub2, "Games");
  assert.doesNotMatch(r.sub + r.sub2, /Cards|YouTube|Home server/);
});

test("a settings file can name its own rules file; a missing file falls back to the default", () => {
  const f = path.join(root, "s.json");
  fs.writeFileSync(path.join(root, "brief.md"), "## session\n{owner} here: tool {tool}, desk {desk}, room {room}\n\n## hub-run\nrun for {owner}\n");
  fs.writeFileSync(f, JSON.stringify({ workRules: { file: path.relative(APP, path.join(root, "brief.md")) }, owner: { name: "Sam" } }));
  const r = kit({ HUB_DEMO: "", HUB_TEST_SETTINGS: f });
  assert.equal(r.session, "Sam here: tool T, desk d, room r");
  assert.equal(r.hubrun, "run for Sam");
  fs.writeFileSync(f, JSON.stringify({ workRules: { file: "no/such/file.md" }, owner: { name: "Sam" } }));
  assert.match(kit({ HUB_DEMO: "", HUB_TEST_SETTINGS: f }).session, /^Sam's working rules:/);
});

test("kit defaults: the prompts that used 'he' about the owner use 'they'", () => {
  for (const f of ["src/pipeline/deckideas.js", "src/pipeline/tradeup.js", "src/pipeline/ratings.js", "src/pipeline/rules.js", "src/pipeline/agents/meetings.js"]) {
    const t = fs.readFileSync(path.join(APP, f), "utf8");
    assert.doesNotMatch(t.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n"), /\b(his list|his note|his reasons|he trades|He trades|for him|he can build|he already owns|he owns|he has plenty|he doesn't own|he asked for|he liked|he disliked|he changed|he passed|he almost|he often|stopping him|to him for|only he can)\b/, f);
  }
});
