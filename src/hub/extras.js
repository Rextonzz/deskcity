// Private parts (Hub kit clean-up, 2026-11-14): this owner's own integrations live in src/private/*.js. The kit leaves
// that folder out (tools/export-kit.mjs), so a kit hub loads none and every hook below simply finds nothing. Each file's
// default export is one part; every field is optional:
//   module        its entry for src/hub/modules.js ({ id, name, group: "Private", private: true, pages, routes, timers })
//   legacy        { old add-on name: [module ids] }, and legacyOn(settings, on) for parts an older settings file had on
//   room          the room it links to: send(payload) delivers to that room's lead inbox, ready() says whether it can,
//                 label is how that inbox shows in a message's "via" list, prDecision(req, decision, note) answers a
//                 merge ask, and that room's jobs need the dashboard password (they write outside the hub)
//   reviewRepo()  a repo for pull-request reviews, { room, repo, tokenEnv }, or null
//   relay         { ready(), offText, read(file), room, desk }: a cloud relay of "Hub log" lines (agents/intake.js)
//   localRunner   { prefix, dir(), script, missing(script) }: desks run by a script on this PC (agents/autonomy.js)
//   alertKinds    { kind: { label, level } } added to the phone alerts (notify.js)
//   busy()        what it's running that a restart should wait for (restart.js), or null
//   routes(router, helpers)   adds its /api/pipeline routes (routes/pipeline.js); agentRoutes(router, helpers) /api/agents
//   start({ every, timerOn }) starts its timers (server.js)
//   districts     { room id: campus district } for its rooms
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "private");
export const PARTS = [];
if (fs.existsSync(DIR) && process.env.HUB_DEMO !== "1") // demo mode (tools/demo.mjs) loads none of this owner's private parts
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".js")).sort()) {
    try {
      const m = await import(pathToFileURL(path.join(DIR, f)).href);
      if (m.default && typeof m.default === "object") PARTS.push({ file: f, ...m.default });
    } catch (err) {
      console.warn(`Private part ${f} didn't load: ${err.message}`);
    }
  }

// The part linked to a room (its lead inbox), or undefined.
export const roomLink = (room) => (room ? PARTS.find((p) => p.room === room && typeof p.send === "function") : undefined);
// Every part that has a given field.
export const partsWith = (field) => PARTS.filter((p) => p[field] != null);
// Relay one message to a linked room's lead inbox: "off" when it can't (no link, or not set up), null once sent, else
// the error text (200 characters).
export async function toRoomInbox(room, payload) {
  const link = roomLink(room);
  if (!link || (link.ready && !(await link.ready()))) return "off";
  try {
    await link.send(payload);
    return null;
  } catch (err) {
    return String(err.message).slice(0, 200);
  }
}
