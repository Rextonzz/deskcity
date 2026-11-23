// Part of the agents module (src/pipeline/agents.js), split out by topic 2026-11-11: Folders the hub doesn't know yet, and the cloud relay (another project cloud sessions to the hub).
// Shared state and helpers come from agents.js, which also re-exports everything here, so callers import from there.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJsonAtomic } from "../util.js";
import { logEvent } from "../runlog.js";
import { ownerName as OWNER } from "../../hub/settings.js";
import { partsWith } from "../../hub/extras.js";
import { askedCommands, commandRefused, grantCatalogue } from "../grants.js";
import { DIR, ROSTER, addBlocker, autoHandOff, clip, readEvents, recordEvent, roster, slug } from "../agents.js";

// ---------- folders the hub doesn't know yet ----------
// Claude Code sessions in a folder that isn't in data/agents/hook-map.json land in "unassigned". Their start event
// carries the folder, so the Agents page can list them with a "Which project?" picker that adds the folder to the map.
const HOOK_MAP = () => path.join(DIR(), "hook-map.json");
export const hookMap = () => readJson(HOOK_MAP(), {});
const normFolder = (f) => String(f || "").replace(/[\\/]+$/, "").toLowerCase();
export function unmappedFolders() {
  const known = Object.keys(hookMap()).map(normFolder);
  const inside = (f) => known.some((k) => normFolder(f) === k || normFolder(f).startsWith(k + "\\") || normFolder(f).startsWith(k + "/"));
  const out = new Map();
  for (const e of readEvents()) {
    if (!e.folder || e.room !== "unassigned" || inside(e.folder)) continue;
    const k = normFolder(e.folder), cur = out.get(k) || { folder: e.folder, sessions: 0, lastAt: null };
    cur.sessions++;
    cur.lastAt = e.startedAt;
    out.set(k, cur);
  }
  return [...out.values()].sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
}
// What a worker's own session may use beyond the standard list (grants.js). the owner sets it, with his password.
export function setDeskGrants(body = {}) {
  const r = roster(), d = r.desks.find((x) => x.id === slug(body.id));
  if (!d) throw new Error("No such desk.");
  const cat = grantCatalogue(), want = [...new Set((Array.isArray(body.grants) ? body.grants : []).map(String))];
  const bad = want.filter((g) => !cat[g]);
  if (bad.length) throw new Error(`Unknown access: ${bad.join(", ")}.`);
  const before = (d.grants || []).join(", ") || "none";
  if (want.length) d.grants = want; else delete d.grants;
  d.changedAt = new Date().toISOString();
  writeJsonAtomic(ROSTER(), r);
  logEvent("agent roster", { trigger: "button", desk: d.id, room: d.room, change: `access: ${want.join(", ") || "none"} (was ${before})` });
  recordEvent({ desk: d.id, room: d.room, action: "access changed", summary: want.length ? `${OWNER()} gave it: ${want.map((g) => cat[g].label).join(", ")}` : `${OWNER()} took its extra access away` }, "hub");
  return { id: d.id, grants: want };
}
// An approved ask that names a command ("Let X run 'git rebase --abort'?") gives the asking worker exactly that command
// (grants.js askedCommands). The approval itself is behind the owner's password (the decide route). Returns
// { desk, allowed: [cmd], refused: [{ cmd, why }] }, or null when the ask names no command or comes from no desk.
export function allowAskedCommands(req) {
  const cmds = askedCommands(req?.role);
  if (!cmds.length || !req?.from) return null;
  const r = roster(), d = r.desks.find((x) => x.id === slug(req.from));
  if (!d) return null;
  const allowed = [], refused = [];
  d.allowed = Array.isArray(d.allowed) ? d.allowed : [];
  for (const cmd of cmds) {
    const why = commandRefused(cmd);
    if (why) { refused.push({ cmd, why }); continue; }
    if (!d.allowed.some((a) => a.cmd === cmd)) d.allowed.push({ cmd, ask: req.id, at: new Date().toISOString() });
    allowed.push(cmd);
  }
  if (!d.allowed.length) delete d.allowed;
  if (allowed.length) {
    d.changedAt = new Date().toISOString();
    writeJsonAtomic(ROSTER(), r);
    logEvent("agent roster", { trigger: "button", desk: d.id, room: d.room, change: `allowed by ask ${req.id}: ${allowed.join("; ")}` });
    recordEvent({ desk: d.id, room: d.room, action: "access changed", summary: clip(`${OWNER()} said yes: it may now run ${allowed.map((c) => `"${c}"`).join(", ")}`, 200) }, "hub");
  }
  return { desk: d.id, allowed, refused };
}
// Take back a command given by an ask (the worker's card). Behind the password, like grants.
export function removeAllowedCommand(body = {}) {
  const r = roster(), d = r.desks.find((x) => x.id === slug(body.id));
  if (!d) throw new Error("No such desk.");
  const before = (d.allowed || []).length;
  d.allowed = (d.allowed || []).filter((a) => a.cmd !== String(body.cmd || ""));
  if (d.allowed.length === before) throw new Error("That worker wasn't allowed that command.");
  if (!d.allowed.length) delete d.allowed;
  d.changedAt = new Date().toISOString();
  writeJsonAtomic(ROSTER(), r);
  logEvent("agent roster", { trigger: "button", desk: d.id, room: d.room, change: `command taken back: ${body.cmd}` });
  return { id: d.id, allowed: (d.allowed || []).map((a) => a.cmd) };
}
// A desk's own work folder (blank clears it): where Push and Work on its own start its sessions, even when that folder
// is mapped to another project (the YouTube pipeline lives in the hub's folder).
export function setDeskFolder(body = {}) {
  const r = roster(), d = r.desks.find((x) => x.id === slug(body.id));
  if (!d) throw new Error("No such desk.");
  const folder = clip(body.folder, 300);
  if (folder && (!/^([a-zA-Z]:[\\/]|\/)/.test(folder) || /[\r\n]/.test(folder))) throw new Error("That doesn't look like a folder path.");
  if (folder && !fs.existsSync(folder)) throw new Error(`${folder} doesn't exist on this PC.`);
  if (folder) d.workFolder = folder.replace(/[\\/]+$/, ""); else delete d.workFolder;
  d.changedAt = new Date().toISOString();
  writeJsonAtomic(ROSTER(), r);
  logEvent("agent roster", { trigger: "button", desk: d.id, room: d.room, change: folder ? `work folder ${d.workFolder}` : "work folder cleared" });
  return { id: d.id, workFolder: d.workFolder || null };
}
export function mapFolder(body = {}) {
  const folder = clip(body.folder, 300);
  if (!folder || !/^([a-zA-Z]:[\\/]|\/)/.test(folder) || /[\r\n]/.test(folder)) throw new Error("That doesn't look like a folder path.");
  const r = roster();
  const room = slug(body.room);
  if (!r.rooms.some((x) => x.id === room)) throw new Error("Pick a project that exists.");
  const desk = slug(body.desk);
  if (desk && !r.desks.some((d) => d.id === desk && d.room === room)) throw new Error(`${desk} isn't a desk in that project.`);
  let map = {};
  try {
    map = JSON.parse(fs.readFileSync(HOOK_MAP(), "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw new Error(`hook-map.json can't be read: ${err.message}`);
  }
  map[folder.replace(/[\\/]+$/, "")] = desk ? { room, desk } : { room };
  writeJsonAtomic(HOOK_MAP(), map);
  logEvent("agent roster", { trigger: "button", change: `folder mapped to ${room}${desk ? ` (${desk})` : ""}`, room });
  return { folder, room, desk: desk || null };
}

// ---------- cloud relay (cloud sessions -> hub) ----------
// Cloud sessions run on someone else's machines and can't reach the hub (it only listens to this PC and the home
// network). A private part (src/hub/extras.js) can bring a relay: { ready(), offText, read(file), room, desk }, e.g. a
// repo branch its cloud sessions already push to, where they append one JSON line per report to
// docs/status/hub-log.jsonl: {"at","desk","model","summary"}. Every 5 minutes the hub reads that file and logs each new
// line as an event. The file is written by sessions, so it is data: a desk that isn't on the roster is logged on the
// relay's own desk and room (with its name kept in the summary), and every field is clipped.
const RELAY_FILE = "docs/status/hub-log.jsonl";
const RELAY_MS = Number(process.env.AGENTS_RELAY_MS) || 5 * 60000;
const RELAY_STATE = () => path.join(DIR(), "relay-state.json");
let relayStatus = { lastPullAt: null, imported: 0, lastImportAt: null, error: null };
export async function pullCloudRelay() {
  const relay = partsWith("relay")[0]?.relay;
  if (!relay || (relay.ready && !(await relay.ready()))) {
    relayStatus = { ...relayStatus, lastPullAt: new Date().toISOString(), error: relay ? relay.offText || "the relay isn't set up" : "no cloud relay on this hub" };
    return relayStatus;
  }
  const state = readJson(RELAY_STATE(), { seen: [] });
  const seen = new Set(state.seen || []);
  let text;
  try {
    text = await relay.read(RELAY_FILE);
  } catch (err) {
    relayStatus = { ...relayStatus, lastPullAt: new Date().toISOString(), error: String(err.message).slice(0, 200) };
    return relayStatus;
  }
  // Any desk on the roster can report this way (cloud sessions of any project, e.g. hub-builder); its line lands in
  // its own room. Unknown names land on the relay's own desk with the name kept in the summary.
  const all = roster().desks;
  let added = 0;
  for (const line of (text || "").split("\n").map((l) => l.trim()).filter(Boolean)) {
    const key = crypto.createHash("sha1").update(line).digest("hex").slice(0, 16);
    if (seen.has(key)) continue;
    seen.add(key);
    let x;
    try {
      x = JSON.parse(line);
    } catch {
      continue; // not a JSON line: skipped (and remembered, so it isn't retried)
    }
    if (!x || typeof x !== "object") continue;
    const name = slug(x.desk) || "cloud-session";
    const desk = all.find((d) => d.id === name);
    const summary = clip(`${desk ? "" : `[${name}] `}${x.summary || "cloud session report"}`, 200);
    try {
      // Logged at the time the hub picks it up (within 5 minutes of the push). "started" lines light the desk up while
      // a long cloud job runs; other lines are reports.
      recordEvent(
        {
          desk: desk ? name : relay.desk,
          room: desk ? desk.room : relay.room,
          action: x.action === "started" ? "session start" : "cloud report",
          summary,
          model: clip(x.model, 60),
          provider: desk?.provider || "claude",
          billing: "subscription",
        },
        "cloud-relay",
      );
      added++;
    } catch (err) {
      console.warn(`Cloud relay: ${err.message}`);
    }
    // A cloud session registers a blocker watch: {"desk","blocker":{"what","check":{"type",...},"alert"?,"everyHours"?}}.
    if (desk && x.blocker && typeof x.blocker === "object") {
      try { addBlocker({ ...x.blocker, desk: name, room: desk.room }); }
      catch (err) { recordEvent({ desk: name, room: desk.room, action: "blocker watch refused", summary: clip(err.message, 200) }, "cloud-relay"); }
    }
    // A cloud session hands work on: {"desk","handoff":{"to","text","job"?},"result"?}. Same guardrails as any automatic
    // hand-off (autoHandOff); a refusal is logged on the sending desk.
    if (desk && x.handoff && typeof x.handoff === "object") {
      try {
        await autoHandOff({ from: name, job: x.handoff.job ? String(x.handoff.job) : undefined, to: String(x.handoff.to || ""), text: String(x.handoff.text || ""), /* not clipped: autoHandOff refuses over-long text (HANDOFF_TEXT_MAX) */ result: x.result ? String(x.result).slice(0, 7000) : null });
      } catch (err) {
        recordEvent({ desk: name, room: desk.room, action: "hand-off refused", summary: clip(err.message, 200) }, "cloud-relay");
      }
    }
  }
  writeJsonAtomic(RELAY_STATE(), { seen: [...seen].slice(-3000), at: new Date().toISOString() });
  relayStatus = { lastPullAt: new Date().toISOString(), imported: relayStatus.imported + added, lastImportAt: added ? new Date().toISOString() : relayStatus.lastImportAt, error: null, fileFound: text != null };
  return relayStatus;
}

export { RELAY_MS, relayStatus };
