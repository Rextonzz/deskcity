// public/lib.js: the shared page helpers. api() must tell a missing route (needs a restart) from a real 404 answer.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { hub, APP, app } from "./helper.mjs";

await hub();
const { api, esc, showErr } = await import(app("public/lib.js"));

const reply = (status, body, statusText = "") => async () => ({
  ok: status >= 200 && status < 300,
  status,
  statusText,
  json: async () => {
    if (body === undefined) throw new Error("no json");
    return body;
  },
});
const run = async (f) => {
  globalThis.fetch = f;
  return api("/x").then(() => null, (e) => e);
};

test("an HTML 404 (route missing) sets noRoute", async () => {
  const e = await run(reply(404, undefined, "Not Found"));
  assert.equal(e.noRoute, true);
  assert.equal(e.status, 404);
  assert.match(e.message, /needs a restart/);
});

test("a JSON 404 with an error keeps its own text and does not set noRoute", async () => {
  for (const text of ["Unknown job", "Unknown channel", "No scan yet."]) {
    const e = await run(reply(404, { error: text }));
    assert.equal(e.noRoute, false);
    assert.equal(e.message, text);
  }
});

test("a dropped connection sets offline", async () => {
  const e = await run(async () => {
    throw new TypeError("Failed to fetch");
  });
  assert.equal(e.offline, true);
  assert.match(e.message, /Couldn't reach the PC/);
});

test("a 500 with no body throws 'error 500'", async () => {
  const e = await run(reply(500, undefined));
  assert.equal(e.message, "error 500");
  assert.equal(e.status, 500);
  assert.equal(e.noRoute, false);
});

test("esc escapes the four characters", () => {
  assert.equal(esc(`<a href="x">&`), "&lt;a href=&quot;x&quot;&gt;&amp;");
  assert.equal(esc(null), "");
});

// The password option: retry once, only after a 403 that says needPassword. The dialog is stubbed.
const pwSetup = (answer) => {
  const calls = [];
  const form = {}, cancel = {};
  const dialog = { close() {}, showModal() { calls.push("dialog"); setTimeout(() => (answer ? form.onsubmit({ preventDefault() {} }) : cancel.onclick()), 0); } };
  const field = { value: "", textContent: "" };
  const els = { pwDialog: dialog, pwForm: form, pwCancel: cancel };
  globalThis.document = { getElementById: (id) => els[id] || field };
  return calls;
};
const guarded = (log, confirmed = false) => async (url, init) => {
  log.push(url);
  if (url === "/api/confirm-password") return init ? reply(200, { ok: true })() : reply(200, { confirmed })();
  return log.filter((u) => u !== "/api/confirm-password").length === 1 ? reply(403, { needPassword: true, error: "password" })() : reply(200, { ok: true })();
};

test("password option: a 403 needPassword asks once, then retries and returns", async () => {
  const dialog = pwSetup(true);
  const log = [];
  globalThis.fetch = guarded(log);
  const r = await api("/x", {}, { password: true, why: "because" });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(dialog, ["dialog"]);
  assert.equal(log.filter((u) => u === "/api/pipeline/x").length, 2);
});

test("password option: cancelling throws an error with cancelled set", async () => {
  pwSetup(false);
  globalThis.fetch = guarded([]);
  const e = await api("/x", {}, { password: true }).then(() => null, (e) => e);
  assert.equal(e.cancelled, true);
  assert.equal(e.message, "Cancelled.");
});

test("password option: a 403 without needPassword throws and never prompts", async () => {
  const dialog = pwSetup(true);
  globalThis.fetch = reply(403, { error: "no password in sight" });
  const e = await api("/x", {}, { password: true }).then(() => null, (e) => e);
  assert.equal(e.status, 403);
  assert.equal(e.cancelled, undefined);
  assert.deepEqual(dialog, []);
});

test("without the password option a needPassword 403 is just an error", async () => {
  const dialog = pwSetup(true);
  globalThis.fetch = reply(403, { needPassword: true, error: "password" });
  const e = await api("/x", {}).then(() => null, (e) => e);
  assert.equal(e.status, 403);
  assert.deepEqual(dialog, []);
});

test("showErr writes the red banner and hides it again on an empty message", () => {
  const el = { textContent: "", hidden: true, classList: { toggle(c, on) { assert.equal(c, "hidden"); el.hidden = on; } } };
  globalThis.document = { getElementById: (id) => (id === "err" ? el : null) };
  showErr("Couldn't load: boom");
  assert.equal(el.textContent, "Couldn't load: boom");
  assert.equal(el.hidden, false);
  showErr("");
  assert.equal(el.textContent, "");
  assert.equal(el.hidden, true);
});
