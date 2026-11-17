// tellOwner files one to-do (link defaults to the Agents page) and, with an alert, sends one phone alert without waiting
// or throwing. dashboardLink builds the page link from the saved dashboard address.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { hub, wait, APP, app } from "./helper.mjs";

const { A } = await hub();
const T = await import(app("src/pipeline/todo.js"));
const N = await import(app("src/pipeline/notify.js"));

const sent = [];
let fail = false;
globalThis.fetch = async (u, opts) => {
  sent.push({ u: String(u), click: opts.headers.Click });
  if (fail) throw new Error("ntfy is down");
  return { ok: true };
};

test("dashboardLink joins the saved address and the page, or is undefined without one", () => {
  assert.equal(N.dashboardLink("/agents.html", {}), undefined);
  assert.equal(N.dashboardLink("/agents.html", { dashboardUrl: "http://pc:3000/" }), "http://pc:3000/agents.html");
});

test("tellOwner files one to-do with the default link and sends no alert unless asked", async () => {
  A.tellOwner({ title: "Plain note", detail: "d", source: "hr" });
  const item = T.todoList().items.find((i) => i.title === "Plain note");
  assert.equal(item.link, "/agents.html");
  assert.equal(item.category, "Agents");
  await wait(20);
  assert.equal(sent.length, 0);
});

test("tellOwner with an alert sends one phone alert and never throws when it fails", async () => {
  N.saveNotifySettings({ ...N.notifySettings(), enabled: true, dashboardUrl: "http://pc:3000" }); // alerts are off until turned on (the kit default)
  A.tellOwner({ title: "Needs you", detail: "d", source: "lead ask", alert: { title: "Needs you", message: "m", url: N.dashboardLink("/agents.html") } });
  await wait(20);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].click, "http://pc:3000/agents.html");
  fail = true;
  assert.doesNotThrow(() => A.tellOwner({ title: "Needs you too", detail: "d", source: "x", alert: { title: "t", message: "m" } }));
  await wait(20);
  assert.equal(sent.length, 2);
  assert.equal(T.todoList().items.filter((i) => i.title.startsWith("Needs you")).length, 2);
});

test("a failing to-do throws unless quiet, and quiet still sends the alert", async () => {
  fail = false;
  assert.throws(() => A.tellOwner({ title: "", source: "hr" }), /Type the idea first/);
  const before = sent.length;
  assert.doesNotThrow(() => A.tellOwner({ title: "", source: "hr", quiet: true, alert: { title: "t", message: "m" } }));
  await wait(20);
  assert.equal(sent.length, before + 1);
});
