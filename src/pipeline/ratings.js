// Thumbs up / down on Ask Claude suggestions and rules-review items (optional for the owner). Saved in
// data/feedback/ratings.jsonl; the next Ask Claude and rules review see them, so the advice drifts toward what he
// finds useful. The latest vote on an item wins.
import { resolvePath, readJsonl, appendJsonl, OWNER } from "./util.js";

const FILE = () => resolvePath("data/feedback/ratings.jsonl");

export function rate({ channel, area, item, vote, note }) {
  if (!["insights", "rules"].includes(area)) throw new Error("Unknown area.");
  if (!["up", "down", "clear"].includes(vote)) throw new Error("Vote is up, down or clear.");
  const text = String(item ?? "").trim().slice(0, 400);
  if (!text) throw new Error("Nothing to rate.");
  const entry = { at: new Date().toISOString(), channel, area, item: text, vote, ...(note ? { note: String(note).slice(0, 500) } : {}) };
  appendJsonl(FILE(), entry);
  return entry;
}

// Current vote per item for one channel: { "<area>|<item>": entry }.
export function ratings(channel, { days = 365 } = {}) {
  const since = Date.now() - days * 864e5;
  const out = {};
  try {
    for (const r of readJsonl(FILE())) {
      if (r.channel !== channel || Date.parse(r.at) < since) continue;
      if (r.vote === "clear") delete out[`${r.area}|${r.item}`];
      else out[`${r.area}|${r.item}`] = r;
    }
  } catch {}
  return out;
}

// Prompt section: what the owner liked and didn't, for the AI that writes the next suggestions or review.
export function ratingNotes(channel) {
  const rows = Object.values(ratings(channel, { days: 180 })).slice(-40);
  if (!rows.length) return "";
  const fmt = (r) => `- (${r.area === "rules" ? "rules review" : "Ask Claude"}, ${r.at.slice(0, 10)}) ${r.item}${r.note ? ` [their note: ${r.note}]` : ""}`;
  const up = rows.filter((r) => r.vote === "up"), down = rows.filter((r) => r.vote === "down");
  return `\n\n${OWNER().toUpperCase()}'S THUMBS ON EARLIER SUGGESTIONS (optional for them, so most items have none). Lean toward the kind they liked; don't repeat the kind they disliked unless the numbers now clearly back it, and then say why it's worth another look:\n${up.length ? `Liked:\n${up.map(fmt).join("\n")}\n` : ""}${down.length ? `Disliked:\n${down.map(fmt).join("\n")}` : ""}`;
}
