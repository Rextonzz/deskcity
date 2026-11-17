// Phone alerts through ntfy (free app for Android and iPhone, no account). The app makes its own random topic name
// on first use; anyone who knows that name gets the alerts, so it is only shown on the signed-in dashboard.
import { logEvent } from "./runlog.js";
import crypto from "node:crypto";
import fs from "node:fs";
import { resolvePath, pipelineTz, writeJsonAtomic, jobLabel } from "./util.js";
import { partsWith } from "../hub/extras.js";
import { hubSettings } from "../hub/settings.js";

const FILE = () => resolvePath("data/notify.json");
// Phone alerts are OFF until the owner turns them on in Admin (settings' "notify.enabled" is false in the kit): nothing is
// sent to the ntfy server before that, sign-in alerts included. A hub that had them on (its own settings say so, or its saved
// data/notify.json has "enabled") keeps them on; "notify.securityWhenOff" keeps the sign-in alerts coming through even with
// the switch off, as an older hub always had.
const DEFAULTS_FN = () => ({ server: "https://ntfy.sh", enabled: hubSettings().notify?.enabled === true, events: { held: true, failed: true, done: true }, dashboardUrl: "" });
export const securityWhenOff = () => hubSettings().notify?.securityWhenOff === true;

let cachedNotify = null;
export function notifySettings() {
  let s = null;
  try {
    s = JSON.parse(fs.readFileSync(FILE(), "utf8"));
    cachedNotify = s;
  } catch (err) {
    // Only a missing file means "first run, make a topic" (code review 2026-10-22). A busy or cut-off file used to
    // make a new random topic, so the phone (still on the old one) silently stopped getting every alert.
    if (err.code !== "ENOENT") {
      if (cachedNotify) s = cachedNotify;
      else throw new Error(`data/notify.json couldn't be read (${String(err.message).slice(0, 80)}). Phone alerts are off until it's fixed.`);
    }
  }
  if (!s?.topic) {
    s = { ...DEFAULTS_FN(), ...s, topic: "ytw-" + crypto.randomBytes(12).toString("base64url").replace(/[-_]/g, "x") };
    saveNotifySettings(s);
  }
  return { ...DEFAULTS_FN(), ...s, events: { ...DEFAULTS_FN().events, ...s.events } };
}

export function saveNotifySettings(s) {
  writeJsonAtomic(FILE(), s);
  cachedNotify = s;
}

// Each kind of alert has a level the owner sets on the Pipeline page. ntfy priorities: quiet = 2 (no sound), normal = 3,
// high = 4 (long buzz), urgent = 5 (pops up and can break through Do Not Disturb). A sign-in alert can't be set to "off" (it
// is quiet at the least), but it follows the main switch unless "notify.securityWhenOff" is set.
export const LEVELS = { off: 0, quiet: 2, normal: 3, high: 4, urgent: 5 };
export const ALERT_KINDS = {
  held: { label: "A video needs you", level: "high" },
  failed: { label: "A job failed", level: "high" },
  done: { label: "Uploaded or scheduled", level: "normal" },
  health_ok: { label: "Morning check: all good", level: "quiet" },
  health_problem: { label: "Morning check: problems", level: "high" },
  rules: { label: "Rules review ready", level: "normal" },
  deals: { label: "Deal watch: deals found", level: "normal" },
  deals_none: { label: "Deal watch: nothing today", level: "quiet" },
  deals_failed: { label: "Deal watch failed", level: "normal" },
  card_moves: { label: "Collection: big card price moves", level: "normal" },
  want_price: { label: "A card you want hit your price", level: "high" },
  weekly: { label: "Sunday summary of your week", level: "normal" },
  started: { label: "App started", level: "quiet" },
  credit: { label: "AI credit running low", level: "high" },
  hr: { label: "HR checked a staff request", level: "normal" },
  alert_rule: { label: "One of your alert rules fired", level: "high" },
  ...Object.assign({}, ...partsWith("alertKinds").map((p) => p.alertKinds)), // a private part's own alerts (src/hub/extras.js)
  security: { label: "New device sign-ins and lockouts", level: "urgent", noOff: true },
  signin_known: { label: "Sign-in from a device you've used before", level: "quiet", noOff: true },
};
export function alertLevel(kind, s = notifySettings()) {
  const k = ALERT_KINDS[kind];
  if (!k) return null;
  // Older settings had on/off ticks for the three job alerts.
  const old = s.events?.[kind] === false ? "off" : null;
  const lvl = s.levels?.[kind] ?? old ?? k.level;
  return k.noOff && lvl === "off" ? "quiet" : lvl;
}

// Link to one of the dashboard's pages, or undefined when no dashboard address is saved. `s` is the notify settings
// (health.js passes its own read of the file, because notifySettings() would create data/notify.json).
export function dashboardLink(page, s = notifySettings()) {
  return s.dashboardUrl ? s.dashboardUrl.replace(/\/$/, "") + page : undefined;
}

export async function sendAlert({ title, message, tags = [], priority = 3, url, kind }) {
  const s = notifySettings();
  if (kind) {
    const lvl = alertLevel(kind, s);
    if (lvl === "off" || (!s.enabled && !(securityWhenOff() && ["security", "signin_known"].includes(kind)))) return logEvent("alert", { trigger: "app", title, alertKind: kind, skipped: lvl === "off" ? "level off" : "alerts off" });
    if (lvl) priority = LEVELS[lvl];
  }
  const headers = { Title: title.replace(/[^\x20-\x7e]/g, ""), Tags: tags.join(","), Priority: String(priority) };
  const click = url || dashboardLink("/pipeline.html", s);
  if (click) headers.Click = click;
  try {
    const res = await fetch(`${s.server.replace(/\/$/, "")}/${s.topic}`, { method: "POST", body: message, headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`ntfy answered ${res.status}`);
    logEvent("alert", { trigger: "app", title, alertKind: kind, priority });
  } catch (err) {
    logEvent("alert", { trigger: "app", title, priority, error: err.message });
    throw err;
  }
}

const label = (job) => job.data.meta_out?.title || jobLabel(job);

// kind: "held" | "failed" | "done". Never throws: an alert failing must not break a job.
export function alertJob(job, kind) {
  try {
    alertJobNow(job, kind);
  } catch (err) {
    console.warn(`Phone alert failed: ${err.message}`);
  }
}

function alertJobNow(job, kind) {
  const msg = {
    held: { title: "Needs you", message: `${label(job)}\n${job.hold?.reason || ""}`, tags: ["eyes"], priority: 4 },
    failed: {
      title: "Job failed",
      message: `${label(job)}\nAt ${job.error?.stage}: ${String(job.error?.message || "").slice(0, 300)}`,
      tags: ["warning"],
      priority: 4,
    },
    done: {
      title:
        { scheduled: "Scheduled", published: "Published", private: "Uploaded (private)", tested: "Test run done" }[job.status] ||
        "Finished",
      message:
        label(job) +
        (job.data.publishAt
          ? `\nGoes live ${new Date(job.data.publishAt).toLocaleString("en-CA", { timeZone: pipelineTz(), dateStyle: "medium", timeStyle: "short" })}`
          : ""),
      tags: ["white_check_mark"],
    },
    tiktok: {
      title: job.data.tiktok?.privacy === "private" ? "On TikTok (Only you)" : "Posted to TikTok",
      message: label(job) + (job.data.tiktok?.url ? `\n${job.data.tiktok.url}` : ""),
      tags: ["white_check_mark"],
    },
    "tiktok failed": {
      title: "TikTok post failed",
      message: `${label(job)}\n${String(job.data.tiktok?.error || "").slice(0, 300)}`,
      tags: ["warning"],
      priority: 4,
    },
  }[kind];
  // TikTok alerts follow the same on/off levels as finished and failed jobs.
  kind = { tiktok: "done", "tiktok failed": "failed" }[kind] || kind;
  sendAlert({ ...msg, kind }).catch((err) => console.warn(`Phone alert failed: ${err.message}`));
}
