// Sunday summary (the owner 2026-10-21): one phone alert on Sunday evening with the week across the hub. YouTube videos
// posted and their views, views gained (once stats history is a week old), collection value change, anime and manga
// with something new, and AI spend. Read-only; built from data the app already has.
// Sent once a week (data/digest.json remembers when); "Send it now" on the Pipeline page's alert list isn't needed:
// sendDigest() can be called any time from the route for a test.
import { dueAt, resolvePath, readJson, writeJsonAtomic, readJsonl } from "./util.js";
import { readRuns, logEvent } from "./runlog.js";
import { chOfLayout } from "../hub/settings.js";

const FILE = () => resolvePath("data/digest.json");
const k = (n) => (n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${Math.round(n)}`);

async function lines() {
  const out = [];
  const cut = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  try {
    const { exportStats, viewsGained } = await import("./stats.js");
    const d = await exportStats();
    const g = viewsGained(7);
    for (const [name, list] of [
      [chOfLayout("clips").name || "Clips", (d.clips || []).map((c) => ({ id: c.videoId, date: c.date, views: c.views }))],
      [chOfLayout("packs").name || "Packs", (d.packs || []).flatMap((p) => p.videos || []).filter((v) => v.uploadDate).map((v) => ({ id: v.videoId, date: v.uploadDate, views: v.views }))],
    ]) {
      const week = list.filter((x) => x.date && x.date > cut);
      const gained = g?.byId ? list.reduce((t, x) => t + Math.max(0, g.byId[x.id] || 0), 0) : null;
      if (week.length || gained) out.push(`${name}: ${week.length} posted, ${k(week.reduce((t, x) => t + (x.views || 0), 0))} views on them${gained ? `; +${k(gained)} views across all videos` : ""}`);
    }
  } catch (err) {
    out.push(`YouTube numbers unavailable (${err.message.split("\n")[0].slice(0, 80)})`);
  }
  try {
    const rows = readJsonl(resolvePath("data/cards/value-history.jsonl")).filter((r) => r.cad != null);
    const last = rows.at(-1), base = [...rows].reverse().find((r) => r.at.slice(0, 10) <= cut);
    if (last && base) {
      const diff = last.cad - base.cad;
      out.push(`Collection: CA$${Math.round(last.cad).toLocaleString()} (${diff >= 0 ? "▲ +" : "▼ -"}CA$${Math.abs(diff).toFixed(0)} this week)`);
    } else if (last) out.push(`Collection: CA$${Math.round(last.cad).toLocaleString()}`);
  } catch {}
  try {
    const { readingList } = await import("./reading.js");
    const r = readingList();
    if (r.newCount) out.push(`Anime and manga: ${r.newCount} with something new`);
  } catch {}
  const spend = readRuns({ kinds: ["ai call"], limit: 50000 }).filter((c) => String(c.startedAt || c.at || "").slice(0, 10) > cut).reduce((t, c) => t + (Number.isFinite(c.costUsd) ? c.costUsd : 0), 0);
  if (spend) out.push(`AI spend: US$${spend.toFixed(2)} this week`);
  // The Agents page's week: events, busiest offices, what's waiting on the owner (agents.js, 2026-11-09).
  try {
    const { weekSummary } = await import("./agents.js");
    out.push(...weekSummary());
  } catch {}
  return out;
}

export async function sendDigest({ trigger = "auto" } = {}) {
  const body = await lines();
  const { sendAlert } = await import("./notify.js");
  await sendAlert({ kind: "weekly", title: "Your week", message: body.join("\n") || "A quiet week: nothing new to report.", tags: ["calendar"] });
  writeJsonAtomic(FILE(), { sentAt: new Date().toISOString(), lines: body }, 1);
  logEvent("app action", { trigger, action: "weekly summary", lines: body.length });
  return { lines: body };
}

// Checked every hour from the start-up timer: Sunday from 6 pm (the app's time zone), once per week.
export async function digestDue() {
  // Sunday and the hour in the app's own time zone, not the server's (the home server may run on UTC).
  if (!dueAt({ weekday: "Sun", hour: 18 })) return null;
  const last = readJson(FILE(), {})?.sentAt ?? null;
  if (last && Date.now() - Date.parse(last) < 3 * 864e5) return null;
  return sendDigest({ trigger: "auto" });
}
