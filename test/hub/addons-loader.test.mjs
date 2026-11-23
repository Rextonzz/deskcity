// Drop-in add-ons (src/addons/loader.js): off by default, only the ones switched on are imported, one kill switch,
// the password gate on switching, and the jobs-disabled switch. A throwaway HUB_TEST_ROOT holds a fake addons/demo/.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { hub, app, APP } from "./helper.mjs";

const { root } = await hub();
const express = (await import("express")).default;
const { resetHubSettings } = await import(app("src/hub/settings.js"));
const L = await import(app("src/addons/loader.js"));
const { requireLogin } = await import(app("src/security.js"));
const { jobsDisabled } = await import(app("src/pipeline/util.js"));

const addonsDir = path.join(root, "addons");
const settingsFile = path.join(root, "data", "hub-settings.json");
const setSettings = (addonFolders) => { fs.mkdirSync(path.dirname(settingsFile), { recursive: true }); fs.writeFileSync(settingsFile, JSON.stringify({ addonFolders })); resetHubSettings(); };
const readSettings = () => JSON.parse(fs.readFileSync(settingsFile, "utf8"));
const makeAddon = (folder, manifest, files = {}) => {
  const dir = path.join(addonsDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "addon.json"), JSON.stringify(manifest));
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); }
  return dir;
};
// An add-on that proves it was imported (marker file), answers a route, and registers a timer.
const entry = `import fs from "node:fs";
fs.writeFileSync(new URL("./marker.txt", import.meta.url), "imported");
export default {
  routes(router, helpers) {
    router.get("/x", (req, res) => res.json({ ok: true, id: helpers.id, dataDir: helpers.dataDir }));
  },
  start({ every }) { every("Demo add-on timer", () => {}, 1000); },
};
`;
const marker = (folder) => fs.existsSync(path.join(addonsDir, folder, "marker.txt"));
makeAddon("demo", { id: "demo", name: "Demo add-on", hubApi: 1, entry: "index.js", clientPanel: "panel.js", pages: [{ label: "Demo page", href: "/addons/demo/page.html" }], timers: ["Demo add-on timer"] }, { "index.js": entry, "panel.js": "window.demoPanel = 1;" });
makeAddon("other", { id: "other", name: "Other", hubApi: 1 }, { "index.js": entry });
// bad manifests: id that doesn't match, hubApi 2, an entry that climbs out of the folder
makeAddon("badid", { id: "Bad_ID", name: "x", hubApi: 1 }, { "index.js": entry });
makeAddon("v2", { id: "v2", name: "x", hubApi: 2 }, { "index.js": entry });
makeAddon("escape", { id: "escape", name: "x", hubApi: 1, entry: "../escape-out.js" }, {});
fs.writeFileSync(path.join(addonsDir, "escape-out.js"), `import fs from "node:fs"; fs.writeFileSync(new URL("./escape-marker.txt", import.meta.url), "x");`);

const serve = async (mount) => { const web = express(); web.use(express.json()); mount(web); const srv = web.listen(0, "127.0.0.1"); await new Promise((r) => srv.once("listening", r)); return { srv, port: srv.address().port }; };
// (the helper blocks fetch so tests never reach the network; local requests go through node:http)
const call = (port, method, url, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body === undefined ? null : JSON.stringify(body);
  const rq = http.request({ host: "127.0.0.1", port, path: url, method, headers: { ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
    let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch {} resolve({ status: res.statusCode, body: j, text: t }); });
  });
  rq.on("error", reject); rq.end(data);
});
// the loader's routes as server.js mounts them (after sign-in)
const hubApp = () => serve((web) => { web.use(requireLogin); web.use("/api/addons", L.addonsRouter()); web.use("/addons", L.addonPanelRouter()); });

test("(f) bad manifests are skipped: wrong id, hubApi 2, entry outside the folder", async () => {
  const { addons, skipped } = L.discover();
  assert.deepEqual(addons.map((a) => a.id).sort(), ["demo", "other"]);
  assert.deepEqual(skipped.map((s) => s.folder).sort(), ["badid", "escape", "v2"]);
  setSettings({ on: ["badid", "v2", "escape"], killSwitch: false });
  assert.deepEqual(await L.loadAddons(), []);
  assert.ok(!marker("badid") && !marker("v2") && !fs.existsSync(path.join(addonsDir, "escape-marker.txt")), "none of them was imported");
});

test("(a)(b) nothing on: nothing imported, the add-on's route is 404, client list is empty", async () => {
  setSettings({ on: [], killSwitch: false });
  assert.deepEqual(await L.loadAddons(), []);
  assert.ok(!marker("demo") && !marker("other"));
  const { srv, port } = await hubApp();
  try {
    const r = await call(port, "GET", "/api/addons/demo/x");
    assert.equal(r.status, 404); assert.equal(r.body.error, "demo add-on is off");
    assert.equal((await call(port, "GET", "/api/addons/nope/x")).status, 404);
    const c = await call(port, "GET", "/api/addons/client");
    assert.equal(c.status, 200); assert.deepEqual(c.body, []);
    assert.equal((await call(port, "GET", "/addons/demo/panel.js")).status, 404, "a panel of an add-on that is off isn't served");
    const all = await call(port, "GET", "/api/addons");
    assert.deepEqual(all.body.addons.map((a) => [a.id, a.on]), [["demo", false], ["other", false]]);
  } finally { srv.close(); }
});

test("(d) kill switch on: nothing imported even though an add-on is listed on, client list is empty", async () => {
  setSettings({ on: ["other"], killSwitch: true });
  assert.deepEqual(await L.loadAddons(), []);
  assert.ok(!marker("other"), "other was not imported");
  const { srv, port } = await hubApp();
  try { assert.deepEqual((await call(port, "GET", "/api/addons/client")).body, []); } finally { srv.close(); }
});

test("(c)(g) enabled: imported, route answers under /api/addons/demo/, client list and panel, timer starts, dataDir honoured", async () => {
  setSettings({ on: ["demo"], killSwitch: false });
  assert.deepEqual(await L.loadAddons(), ["demo"]);
  assert.ok(marker("demo") && !marker("other"), "only demo was imported");
  const { srv, port } = await hubApp();
  try {
    const x = await call(port, "GET", "/api/addons/demo/x");
    assert.equal(x.status, 200); assert.equal(x.body.id, "demo");
    assert.equal(x.body.dataDir, path.join(root, "data", "addons", "demo"));
    assert.ok(fs.existsSync(x.body.dataDir), "the data folder is made on first use");
    assert.equal((await call(port, "GET", "/api/addons/other/x")).status, 404);
    const c = await call(port, "GET", "/api/addons/client");
    assert.deepEqual(c.body, [{ id: "demo", name: "Demo add-on", pages: [{ label: "Demo page", href: "/addons/demo/page.html" }], panel: "/addons/demo/panel.js" }]);
    const p = await call(port, "GET", "/addons/demo/panel.js");
    assert.equal(p.status, 200); assert.equal(p.text, "window.demoPanel = 1;");
    assert.equal((await call(port, "GET", "/addons/demo/index.js")).status, 404, "only the panel is served");
  } finally { srv.close(); }
  const labels = [];
  L.startAddons({ every: (label) => labels.push(label), timerOn: () => true });
  assert.deepEqual(labels, ["Demo add-on timer"]);
  // (g) a data folder override is used as it is, so an existing layout isn't orphaned
  const old = path.join(root, "data", "old-layout");
  setSettings({ on: ["demo"], killSwitch: false, dataDirs: { demo: "data/old-layout" } });
  await L.loadAddons();
  const { srv: s2, port: p2 } = await hubApp();
  try { assert.equal((await call(p2, "GET", "/api/addons/demo/x")).body.dataDir, old); } finally { s2.close(); }
  assert.ok(fs.existsSync(old));
});

test("(e) switching needs the dashboard password and the agent ingest token doesn't work", async () => {
  setSettings({ on: [], killSwitch: false });
  await L.loadAddons();
  // with a dashboard password set and no confirmed password: refused, nothing saved
  process.env.DASHBOARD_PASSWORD_HASH = "test-hash";
  const bare = await serve((web) => web.use("/api/addons", L.addonsRouter()));
  try {
    const a = await call(bare.port, "POST", "/api/addons/demo", { on: true });
    assert.equal(a.status, 403); assert.equal(a.body.needPassword, true);
    const k = await call(bare.port, "POST", "/api/addons/kill", { killSwitch: true });
    assert.equal(k.status, 403); assert.equal(k.body.needPassword, true);
    assert.deepEqual(readSettings().addonFolders.on, [], "nothing saved");
  } finally { bare.srv.close(); }
  // behind the sign-in the hub puts in front of it: the agent key (a bearer token) is not a session
  const { srv, port } = await hubApp();
  try {
    const t = await call(port, "POST", "/api/addons/demo", { on: true }, { Authorization: "Bearer some-agent-ingest-token" });
    assert.equal(t.status, 401);
    const t2 = await call(port, "POST", "/api/addons/kill", { killSwitch: true }, { Authorization: "Bearer some-agent-ingest-token" });
    assert.equal(t2.status, 401);
    assert.deepEqual(readSettings().addonFolders.on, []);
  } finally { srv.close(); delete process.env.DASHBOARD_PASSWORD_HASH; }
  // no password on this hub and a request from this PC: allowed, saved, and the answer says it needs a restart
  const ok = await serve((web) => web.use("/api/addons", L.addonsRouter()));
  try {
    const a = await call(ok.port, "POST", "/api/addons/demo", { on: true });
    assert.equal(a.status, 200); assert.match(a.body.note, /restart/);
    assert.deepEqual(readSettings().addonFolders.on, ["demo"]);
    assert.equal((await call(ok.port, "POST", "/api/addons/ghost", { on: true })).status, 404, "an add-on with no manifest can't be switched on");
    assert.equal((await call(ok.port, "POST", "/api/addons/kill", { killSwitch: true })).status, 200);
    assert.equal(readSettings().addonFolders.killSwitch, true);
    assert.deepEqual(readSettings().addonFolders.on, ["demo"], "the kill switch keeps the list");
    assert.equal((await call(ok.port, "POST", "/api/addons/demo", { on: false })).status, 200);
    assert.deepEqual(readSettings().addonFolders.on, []);
    assert.equal((await call(ok.port, "POST", "/api/addons/demo", { on: "yes" })).status, 400);
  } finally { ok.srv.close(); }
});

test("(h) jobsDisabled: DESKCITY_JOBS_DISABLED wins, PIPELINE_DISABLED is the fallback", () => {
  const keep = [process.env.DESKCITY_JOBS_DISABLED, process.env.PIPELINE_DISABLED];
  try {
    delete process.env.DESKCITY_JOBS_DISABLED; delete process.env.PIPELINE_DISABLED;
    assert.equal(jobsDisabled(), false);
    process.env.PIPELINE_DISABLED = "1"; assert.equal(jobsDisabled(), true, "old name still works");
    process.env.DESKCITY_JOBS_DISABLED = "0"; assert.equal(jobsDisabled(), false, "the new name wins over the old");
    process.env.DESKCITY_JOBS_DISABLED = "1"; process.env.PIPELINE_DISABLED = "0"; assert.equal(jobsDisabled(), true);
  } finally {
    for (const [k, v] of [["DESKCITY_JOBS_DISABLED", keep[0]], ["PIPELINE_DISABLED", keep[1]]]) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
});

test("(h) server.js: the backup timer isn't behind the jobs switch; the other timers are; add-on timers start only with jobs on", () => {
  const src = fs.readFileSync(path.join(APP, "server.js"), "utf8");
  const lines = src.split("\n");
  const backup = lines.find((l) => l.includes("m.backupTick()"));
  // not behind the jobs switch; only a throwaway check/test server (HUB_TEST_ROOT) skips it, so it can't write to the real backup copies
  assert.ok(backup && /^  (if \(!process\.env\.HUB_TEST_ROOT\) )?every\(/.test(backup), "the backup line runs whatever the jobs switch says");
  assert.doesNotMatch(backup, /jobsDisabled|PIPELINE_DISABLED/);
  assert.ok(!/PIPELINE_DISABLED/.test(src), "server.js reads the switch through jobsDisabled()");
  for (const needle of ["startWorker()", "m.liveTick()", "m.dealWatchTick()", "startAddons("]) assert.match(lines.find((l) => l.includes(needle)), /!jobsDisabled\(\)/, needle);
  // the timers can't be run without booting the real server (it listens on a port and starts everything), so this reads the source
});
