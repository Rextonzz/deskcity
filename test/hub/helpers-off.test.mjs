// AI helpers are off by default in a new kit (src/hub/helpers.js): with the switch off, nothing the hub does on its
// own reaches an AI provider, even with keys present; one Admin switch and a daily $ limit control them.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub, wait, ROOMS, DESKS, APP, app } from "./helper.mjs";

// fake keys, present before the hub's config loads (the helper then removes them from the environment, the config keeps them)
process.env.GEMINI_API_KEY = "test-not-real";
process.env.ANTHROPIC_API_KEY = "test-not-real";
process.env.HUB_HELPERS = "off";
process.env.HUB_HELPERS_PER_DAY = "none";

const desks = DESKS.map((d) => (d.id === "game-lead" ? { ...d, runner: "hub", capUsdMonth: 5 } : d));
const { A, root, fake, data } = await hub({ rooms: ROOMS, desks });
const H = await import(app("src/hub/helpers.js"));
const S = await import(app("src/hub/settings.js"));
const HR = await import(app("src/pipeline/hr.js"));
const SELVES = await import(app("src/pipeline/agents/selves.js"));
const BOARD = await import(app("src/pipeline/agents/board.js"));
const ASSIST = await import(app("src/pipeline/agents/assistant.js"));
const SPEND = await import(app("src/pipeline/spend.js"));
const CAMPUS = await import(app("src/pipeline/agents/campus.js"));
const MEET = await import(app("src/pipeline/agents/meetings.js"));
const AUTON = await import(app("src/pipeline/agents/autonomy.js"));
const EXP = await import(app("src/pipeline/agents/experiences.js"));

let fetches = 0;
const fetchedUrls = [];
globalThis.fetch = async (u) => { fetches++; fetchedUrls.push(String(u)); throw new Error("test tried to reach the network"); };
const asked = () => fs.readdirSync(path.join(root, "fake")).filter((f) => f.endsWith(".asked.txt"));
const clearAsked = () => asked().forEach((f) => fs.rmSync(path.join(root, "fake", f)));
const pausedEvents = () => A.readEvents().filter((e) => e.action === "helpers paused");
const hubDesk = desks.find((d) => d.id === "game-artist");

test("helpers off with keys present: nothing reaches the stand-in provider or the network", async () => {
  fake("hr_review", { verdict: "approve", alignment: "Fits.", provider: "claude", model: "claude-haiku-5-5", effort: "low", capUsdMonth: 3, reuseDesk: "", trial: false, note: "Fine." });
  fake("desk_job", { text: "hi", reply: "hello" });
  const q = A.addRequest({ room: "game", role: "Sound designer", why: "music", budgetAsk: 3 }, "game-lead");
  const hr = await HR.runHr();
  assert.equal(hr.reviewed, 0);
  assert.ok(!A.requests().find((x) => x.id === q.id).hr, "HR did not review it");
  assert.equal(await A.chatter({ force: true }), null);
  assert.deepEqual(await SELVES.growSelves(), []);
  assert.ok(Array.isArray(await BOARD.boardCheck()));
  assert.deepEqual(await ASSIST.prReviewTick(), []);
  assert.equal(await ASSIST.ensureAssistant(), null);
  assert.equal(A.assistantDesk(), undefined, "no assistant seat was made");
  assert.equal(A.mayAutoRun(hubDesk), false);
  assert.equal(A.mayAutoRun({ ...hubDesk, provider: "local" }), false, "a local desk waits too");
  await assert.rejects(() => ASSIST.askDeskModel(hubDesk, { system: "x", content: "y", schema: {} }), /AI helpers are off \(Admin > AI helpers\)/);
  // the timers' own functions: the campus shop, the stand-up check, the board-meeting week start, the local runner
  CAMPUS.shop();
  MEET.checkStandup(new Date(Date.UTC(2026, 10, 16, 14, 0))); // a Monday 9:00 in the owner's town or thereabouts: a meeting may be due
  MEET.afterMeeting({ trigger: "board meeting" });
  AUTON.runLocalJobs();
  assert.equal(await CAMPUS.watchShort(hubDesk, { auto: true }), null, "an automatic Short is skipped");
  let expAsks = 0;
  const lichess = { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ puzzle: { id: "a", rating: 1500, themes: ["fork"] }, game: { players: [{ name: "x" }, { name: "y" }], perf: { name: "blitz" } } }) };
  const exp = await EXP.runExperience(hubDesk, EXP.EXPERIENCES.chess, { auto: true, fetchImpl: async () => lichess, ask: async () => { expAsks++; return { reaction: "nice" }; } });
  assert.equal(expAsks, 0, "an automatic experience asks no model");
  assert.ok(exp.ok, "the experience itself still happens");
  await wait(100);
  assert.equal(A.jobs().filter((j) => /after the board meeting/.test(j.text || "")).length, 0, "no job started itself after the meeting");
  assert.deepEqual(asked(), [], "the stand-in was asked nothing");
  assert.equal(fetches, 0, "no network call");
  assert.deepEqual(H.helperMay("chatter"), { ok: false, why: "off" });
  // the same experience call with the helpers on does ask (so the gate is what stopped it)
  process.env.HUB_HELPERS = "on";
  await EXP.runExperience(hubDesk, EXP.EXPERIENCES.chess, { auto: true, fetchImpl: async () => lichess, ask: async () => { expAsks++; return { reaction: "nice" }; } });
  assert.equal(expAsks, 1);
  process.env.HUB_HELPERS = "off";
});

test("helpers off: HR on the timer still flags a desk over its cap, and calls no model", async () => {
  process.env.HUB_HELPERS = "off";
  SPEND.appendSpend({ kind: "ai call", step: "desk_game-artist", provider: "claude", model: "claude-haiku-5-5", costUsd: 5 }); // the desk's cap is $3
  assert.ok(A.agentsOverview().desks.find((d) => d.id === "game-artist").overCap, "set-up: the desk is over its cap");
  assert.ok(!HR.flaggedThisMonth().overCap.includes("game-artist"));
  const r = await HR.runHr();
  assert.equal(r.overCap, 1);
  assert.ok(HR.flaggedThisMonth().overCap.includes("game-artist"), "flagged in the state file");
  // the note also reaches Waiting for you as an ask (the to-do page is off in some presets), once per worker
  const capAsks = () => A.requests({ open: true }).filter((q) => q.kind === "ask" && q.from === "hr" && /game-artist is over its monthly cap/.test(q.role));
  assert.equal(capAsks().length, 1, "one ask in Waiting for you");
  assert.match(capAsks()[0].why, /cap/);
  assert.ok(!capAsks()[0].hr, "HR does not review its own note");
  assert.deepEqual(asked(), [], "no model was asked");
  // the over-cap phone alert may try the network (it isn't an AI call); no AI provider is reached
  assert.deepEqual(fetchedUrls.filter((u) => /anthropic|googleapis|openai|x\.ai|deepseek/i.test(u)), []);
});

test("helpers on and no limit: chatter reaches the stand-in (so the switch is what stopped it)", async () => {
  process.env.HUB_HELPERS = "on";
  fake("desk_job", { text: "morning!", reply: "morning" });
  const r = await A.chatter({ force: true });
  assert.ok(r, "chatter ran");
  assert.ok(asked().includes("campus_chatter.asked.txt"), "the stand-in was asked");
  assert.equal(A.mayAutoRun(hubDesk), true);
  assert.deepEqual(H.helperMay("chatter"), { ok: true });
  clearAsked();
});

test("the daily limit: at or over it, helpers pause and say so once", async () => {
  process.env.HUB_HELPERS = "on";
  process.env.HUB_HELPERS_PER_DAY = "1";
  assert.equal(H.helperSpendToday(), 0);
  SPEND.appendSpend({ kind: "ai call", step: "campus_chatter", provider: "gemini", model: "gemini-flash", costUsd: 2 });
  SPEND.appendSpend({ kind: "ai call", step: "pipeline_plan", provider: "claude", model: "claude-haiku-5-5", costUsd: 7 }); // not a helper step: doesn't count
  assert.equal(H.helperSpendToday(), 2);
  assert.deepEqual(H.helperMay("chatter"), { ok: false, why: "limit" });
  assert.equal(await A.chatter({ force: true }), null);
  assert.equal(await A.chatter({ force: true }), null);
  assert.equal(A.mayAutoRun(hubDesk), false);
  assert.deepEqual(asked(), []);
  assert.equal(pausedEvents().length, 1, "exactly one 'helpers paused' event");
  assert.match(pausedEvents()[0].summary, /today's limit of \$1/);
  assert.equal(H.helperStatus().spentToday, 2);
  process.env.HUB_HELPERS_PER_DAY = "none";
  assert.deepEqual(H.helperMay("chatter"), { ok: true });
});

test("defaults: helpers are off with a $1 limit; the owner's own settings keep them on with no limit", () => {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(APP, f), "utf8"));
  assert.deepEqual(read("hub.defaults.json").agents.helpers, { on: false, perDayUsd: 1 });
  if (fs.existsSync(path.join(APP, "hub.owner.json"))) assert.deepEqual(read("hub.owner.json").agents.helpers, { on: true, perDayUsd: null }); // a kit has no owner file
  assert.equal(read("hub.defaults.json").agents.autoRun.perDay, 5);
});

test("with no environment override and a missing setting, helpers are off; demo mode is always off", () => {
  delete process.env.HUB_HELPERS; delete process.env.HUB_HELPERS_PER_DAY;
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "hub-settings.json"), JSON.stringify({ agents: { helpers: { on: true, perDayUsd: 3 } } }));
  S.resetHubSettings();
  assert.deepEqual(H.helperSettings(), { on: true, perDayUsd: 3 }, "a saved choice wins");
  fs.writeFileSync(path.join(root, "data", "hub-settings.json"), JSON.stringify({ agents: { autoRun: { perDay: 5 } } }));
  S.resetHubSettings();
  assert.equal(typeof H.helperSettings().on, "boolean");
  process.env.HUB_DEMO = "1";
  assert.equal(H.helperSettings().on, false);
  delete process.env.HUB_DEMO;
});

test("the settings route: OFF without the password works; ON and a higher limit need it", () => {
  delete process.env.HUB_HELPERS; delete process.env.HUB_HELPERS_PER_DAY;
  const file = path.join(root, "data", "hub-settings.json");
  fs.writeFileSync(file, JSON.stringify({ agents: { helpers: { on: true, perDayUsd: 5 } } }));
  S.resetHubSettings();
  let r = H.saveHelperSettings({ perDayUsd: 2 }, false);
  assert.equal(r.status, 200, "a lower limit needs no password");
  r = H.saveHelperSettings({ on: false }, false);
  assert.equal(r.status, 200, "OFF needs no password");
  assert.equal(r.body.on, false);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).agents.helpers.on, false, "saved to the settings file");
  r = H.saveHelperSettings({ on: true }, false);
  assert.equal(r.status, 403);
  assert.equal(r.body.needPassword, true);
  assert.equal(H.helperSettings().on, false, "still off");
  r = H.saveHelperSettings({ on: false, perDayUsd: 10 }, false);
  assert.equal(r.status, 403, "a higher limit needs the password");
  r = H.saveHelperSettings({ perDayUsd: null }, false);
  assert.equal(r.status, 403, "no limit needs the password");
  assert.equal(H.saveHelperSettings({ perDayUsd: "lots" }, true).status, 400);
  r = H.saveHelperSettings({ on: true, perDayUsd: 4 }, true);
  assert.equal(r.status, 200);
  assert.deepEqual(H.helperSettings(), { on: true, perDayUsd: 4 }, "the saved choice is live at once, no restart");
  assert.deepEqual(H.helperMay("chatter"), { ok: true });
});

test("HELPER_STEPS names the steps the helpers book to", () => {
  for (const s of ["hr_review", "campus_chatter", "campus_store_idea", "campus_self"]) assert.ok(H.HELPER_STEPS.includes(s), s);
  assert.equal(H.isHelperStep("pipeline_plan"), false);
});
