// The record of the old TikTok backlog (data/tiktok/backlog.json): older a channel uploads the app once re-posted to
// TikTok by itself. That engine is gone; the file stays as history. Stats match its links to videos, the calendar lists
// its posts and the TikTok planner keeps its gaps from them. Read-only.
import fs from "node:fs";
import { resolvePath } from "./util.js";

export function backlogState() {
  try {
    return JSON.parse(fs.readFileSync(resolvePath("data/tiktok/backlog.json"), "utf8"));
  } catch (err) {
    // Only a missing file is an empty record; an unreadable one is an error rather than silently forgetting the posts.
    if (err.code === "ENOENT") return { items: {}, posts: [] };
    throw new Error(`The TikTok backlog's record (backlog.json) couldn't be read: ${err.message.split("\n")[0]}`);
  }
}
