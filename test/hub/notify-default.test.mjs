// Phone alerts are off until the owner turns them on: with the kit's defaults nothing is sent to the ntfy server, the
// sign-in kinds included. A hub whose settings say alerts are on ("notify.enabled"), or whose saved data/notify.json
// says so, keeps them on, and "notify.securityWhenOff" keeps the sign-in alerts coming through with the switch off.
// Each case runs in a child process (the settings are read once at start) with a recording stand-in for fetch.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { APP, app } from "./helper.mjs";

const CODE = `
  const calls = [];
  globalThis.fetch = async (u, o) => { calls.push(String(u)); return { ok: true }; };
  const N = await import(${JSON.stringify(app("src/pipeline/notify.js"))});
  const out = { enabled: N.notifySettings().enabled, sent: {} };
  for (const kind of ["held", "security", "signin_known"]) { const n = calls.length; await N.sendAlert({ title: "t", message: "m", kind }); out.sent[kind] = calls.length - n; }
  out.hosts = [...new Set(calls.map((c) => new URL(c).host))];
  console.log(JSON.stringify(out));
`;
// kit: only hub.defaults.json counts (demo mode); settings: a settings file merged on top of this hub's own; saved: data/notify.json
function run({ kit = false, settings, saved } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "notify-"));
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  const env = { ...process.env, HUB_TEST_ROOT: root };
  for (const k of Object.keys(env)) if (/(_KEY|_TOKEN|_SECRET|PASSWORD|NTFY)/.test(k)) delete env[k];
  if (kit) env.HUB_DEMO = "1";
  if (settings) { env.HUB_TEST_SETTINGS = path.join(root, "s.json"); fs.writeFileSync(env.HUB_TEST_SETTINGS, JSON.stringify(settings)); }
  if (saved) fs.writeFileSync(path.join(root, "data", "notify.json"), JSON.stringify({ topic: "ytw-test", ...saved }));
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", CODE], { env, encoding: "utf8" }));
}

test("kit defaults: alerts are off and nothing is sent, not even a sign-in alert", () => {
  const r = run({ kit: true });
  assert.equal(r.enabled, false);
  assert.deepEqual(r.sent, { held: 0, security: 0, signin_known: 0 });
  assert.deepEqual(r.hosts, []);
});

test("kit defaults: turning alerts on in Admin (data/notify.json) sends all kinds, to the ntfy server", () => {
  const r = run({ kit: true, saved: { enabled: true } });
  assert.deepEqual(r.sent, { held: 1, security: 1, signin_known: 1 });
  assert.deepEqual(r.hosts, ["ntfy.sh"]);
});

test("the settings can turn alerts on for a hub that had them on; its sign-in alerts still follow the switch unless securityWhenOff is set", () => {
  const on = run({ kit: true, settings: { notify: { enabled: true } } });
  assert.equal(on.enabled, true);
  assert.deepEqual(on.sent, { held: 1, security: 1, signin_known: 1 });
  const off = run({ kit: true, settings: { notify: { enabled: true } }, saved: { enabled: false } });
  assert.deepEqual(off.sent, { held: 0, security: 0, signin_known: 0 });
  const keep = run({ kit: true, settings: { notify: { enabled: true, securityWhenOff: true } }, saved: { enabled: false } });
  assert.deepEqual(keep.sent, { held: 0, security: 1, signin_known: 1 });
});

test("an existing saved data/notify.json keeps working unchanged: its enabled value beats the default either way", () => {
  assert.equal(run({ kit: true, saved: { enabled: true } }).enabled, true);
  assert.equal(run({ kit: true, settings: { notify: { enabled: true } }, saved: { enabled: false } }).enabled, false);
});

test("this hub's own settings (hub.owner.json), where it has them, keep alerts on with the sign-in alerts always coming through", { skip: !fs.existsSync(path.join(APP, "hub.owner.json")) }, () => {
  const owner = JSON.parse(fs.readFileSync(path.join(APP, "hub.owner.json"), "utf8"));
  if (!owner.notify) return;
  const r = run({});
  assert.equal(r.enabled, true);
  assert.deepEqual(r.sent, { held: 1, security: 1, signin_known: 1 });
  assert.deepEqual(run({ saved: { enabled: false } }).sent, { held: 0, security: 1, signin_known: 1 });
});
