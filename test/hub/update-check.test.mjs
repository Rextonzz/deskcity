// The update check and what goes with it: version comparing, the releases answer, "no address means no request", the Admin
// route (kept for an hour, never called by anything else), the version in appInfo, and the "What's new" list.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { hub, app } from "./helper.mjs";

const { root } = await hub();
fs.writeFileSync(path.join(root, "pipeline.config.json"), JSON.stringify({ jobsDir: "data/jobs", channels: {} }));
const { compareVersions, newestTag, checkForUpdate, readKit } = await import(app("src/hub/updatecheck.js"));
const settingsFile = path.join(os.tmpdir(), `upd-settings-${process.pid}.json`);
fs.writeFileSync(settingsFile, "{}");
process.env.HUB_TEST_SETTINGS = settingsFile;
const { resetHubSettings } = await import(app("src/hub/settings.js"));
resetHubSettings();
const { pipelineRouter } = await import(app("src/routes/pipeline.js"));
const { appInfo, kitInfo } = await import(app("src/pipeline/restart.js"));
const { recordStart, whatsNew, versionHistory } = await import(app("src/pipeline/versions.js"));

const web = express();
web.use("/p", pipelineRouter);
const srv = web.listen(0, "127.0.0.1");
await new Promise((r) => srv.once("listening", r));
test.after(() => srv.close());
const get = (p) => new Promise((resolve, reject) => http.get({ host: "127.0.0.1", port: srv.address().port, path: p, headers: { Host: "localhost" } }, (res) => { let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(t || "{}") })); }).on("error", reject));
const asked = [];
const answer = (tag) => { globalThis.fetch = async (u) => { asked.push(String(u)); return { ok: true, status: 200, text: async () => JSON.stringify([{ tag_name: tag, draft: false }, { tag_name: "v0.0.1" }]) }; }; };
const setUrl = (url) => { fs.writeFileSync(settingsFile, JSON.stringify({ kit: { updatesUrl: url } })); resetHubSettings(); };

test("versions compare the way people expect, and a release candidate is older than the release", () => {
  assert.equal(compareVersions("0.1.0", "0.2.0"), -1);
  assert.equal(compareVersions("1.0.0", "v1.0.0"), 0);
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0"), -1);
  assert.equal(compareVersions("junk", "1.0.0"), null);
});

test("the newest version is found in GitHub's list, a single release, a plain version, or an Atom feed; drafts and pre-releases are skipped", () => {
  assert.equal(newestTag(JSON.stringify([{ tag_name: "v0.2.0" }, { tag_name: "v0.10.0" }, { tag_name: "v9.0.0", draft: true }, { tag_name: "v8.0.0", prerelease: true }])), "0.10.0");
  assert.equal(newestTag(JSON.stringify({ tag_name: "v1.2.3" })), "1.2.3");
  assert.equal(newestTag(JSON.stringify({ version: "2.0.0" })), "2.0.0");
  assert.equal(newestTag('<feed><entry><link href="https://example.test/o/r/releases/tag/v0.4.0"/></entry><entry><link href="https://example.test/o/r/releases/tag/v0.3.0"/></entry></feed>'), "0.4.0");
  assert.equal(newestTag("<html>nothing</html>"), null);
});

test("no address: no request, said plainly; an address that is not https is refused without a request", async () => {
  let n = 0;
  const f = async () => { n++; throw new Error("no"); };
  const a = await checkForUpdate({ url: "", current: "0.1.0", fetchFn: f });
  assert.equal(n, 0); assert.equal(a.asked, false); assert.match(a.message, /No update address is set/);
  const b = await checkForUpdate({ url: "http://example.test/x", current: "0.1.0", fetchFn: f });
  assert.equal(n, 0); assert.equal(b.ok, false); assert.match(b.message, /https/);
});

test("with an address: one plain request, and the answer says you have X, newest is Y", async () => {
  const seen = [];
  const f = async (u, o) => { seen.push([u, o]); return { ok: true, status: 200, text: async () => JSON.stringify({ tag_name: "v0.2.0" }) }; };
  const a = await checkForUpdate({ url: "https://example.test/r/latest", current: "0.1.0", fetchFn: f });
  assert.equal(seen.length, 1);
  assert.deepEqual(Object.keys(seen[0][1].headers).sort(), ["accept", "user-agent"], "no cookies, no version, nothing about this PC");
  assert.deepEqual([a.ok, a.newer, a.newest], [true, true, "0.2.0"]);
  assert.equal(a.message, "You have 0.1.0, newest is 0.2.0.");
  const same = await checkForUpdate({ url: "https://example.test/r/latest", current: "0.2.0", fetchFn: f });
  assert.equal(same.newer, false); assert.match(same.message, /Nothing to update/);
  const bad = await checkForUpdate({ url: "https://example.test/r/latest", current: "0.1.0", fetchFn: async () => ({ ok: false, status: 404 }) });
  assert.equal(bad.ok, false); assert.match(bad.message, /404/);
  const down = await checkForUpdate({ url: "https://example.test/r/latest", current: "0.1.0", fetchFn: async () => { throw new Error("offline"); } });
  assert.equal(down.ok, false); assert.match(down.message, /offline/);
});

test("the Admin route: no address means no request; nothing else on the page asks; the answer is kept for an hour", async () => {
  answer("v0.5.0");
  setUrl("");
  const none = await get("/p/admin/update-check");
  assert.equal(none.status, 200);
  assert.equal(none.body.asked, false);
  assert.match(none.body.message, /No update address is set/);
  // the other things the Updates card loads on opening make no request either
  assert.equal((await get("/p/app")).status, 200);
  assert.equal((await get("/p/admin/history")).status, 200);
  assert.deepEqual(asked, []);
  setUrl("https://example.test/o/r/releases/latest");
  assert.deepEqual(asked, [], "setting the address asks nothing by itself");
  const first = await get("/p/admin/update-check");
  assert.deepEqual([first.body.ok, first.body.newest, first.body.newer, first.body.cached], [true, "0.5.0", true, false]);
  const second = await get("/p/admin/update-check");
  assert.equal(second.body.cached, true);
  assert.equal(asked.length, 1, "asked once, then answered from the kept answer");
  setUrl("");
});

test("appInfo carries the kit name, version and data format; a copy without hub.owner.json is a plain kit", () => {
  const k = appInfo().kit;
  assert.deepEqual([k.name, k.version, k.format, k.ownersCopy], ["Deskcity", "0.1.0", 1, false]);
  fs.writeFileSync(settingsFile, "{}"); resetHubSettings(); // the shipped default, not an earlier test's setting
  assert.match(kitInfo().updatesUrl, /^https:\/\/api\.github\.com\/repos\/[\w.-]+\/deskcity\/releases\/latest$/, "the kit asks the public repo's latest release");
  fs.writeFileSync(path.join(root, "hub.owner.json"), "{}");
  assert.equal(kitInfo().ownersCopy, true);
  fs.rmSync(path.join(root, "hub.owner.json"));
});

test("What's new lists the notes this hub has not run before, and nothing on the first start", () => {
  const log = (...titles) => fs.writeFileSync(path.join(root, "CHANGELOG.json"), JSON.stringify(titles.map((t) => ({ at: `2026-11-1${["one", "two", "three", "four"].indexOf(t)}T00:00:00Z`, title: t, changes: [`${t} did a thing`] }))));
  log("one");
  recordStart();
  assert.deepEqual(whatsNew().notes, [], "first start: nothing to compare with");
  recordStart();
  assert.deepEqual(whatsNew().notes, [], "same version again: still nothing");
  log("three", "two", "one");
  recordStart();
  const w = whatsNew();
  assert.deepEqual(w.notes.map((n) => n.title), ["three", "two"]);
  assert.ok(w.since);
  recordStart();
  assert.deepEqual(whatsNew().notes.map((n) => n.title), ["three", "two"], "a restart on the same version keeps the list");
  log("four", "three", "two", "one");
  recordStart();
  assert.deepEqual(whatsNew().notes.map((n) => n.title), ["four"], "a newer version replaces it: only what is new since the last different one");
  const h = versionHistory();
  assert.deepEqual(h.whatsNew.notes.map((n) => n.title), ["four"]);
  assert.equal(h.lastUpdate, null);
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "update-last.json"), JSON.stringify({ mode: "git", at: "2026-11-16T10:00:00Z", fromVersion: "0.1.0", toVersion: "0.2.0" }));
  assert.equal(versionHistory().lastUpdate.toVersion, "0.2.0");
});

test("readKit reads the address from the owner's settings file when the defaults have none", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "kit-"));
  fs.writeFileSync(path.join(d, "hub.defaults.json"), JSON.stringify({ kit: { name: "Deskcity", version: "0.1.0", updatesUrl: "" } }));
  assert.equal(readKit(d).updatesUrl, "");
  fs.mkdirSync(path.join(d, "data"));
  fs.writeFileSync(path.join(d, "data", "hub-settings.json"), JSON.stringify({ kit: { updatesUrl: " https://example.test/x " } }));
  assert.deepEqual(readKit(d), { name: "Deskcity", version: "0.1.0", updatesUrl: "https://example.test/x" });
});
