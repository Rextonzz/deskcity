// The channel modules (Hub kit clean-up, 2026-11-14): every file in this folder that exports `stages` is a channel
// module, found by its file name. A channel in pipeline.config.json uses the module named by its "module" field, or the
// one with its own id ("channels": { "mychannel": { "module": "example", ... } }). Nothing here names a channel, so a
// hub with other channels (or none) loads whatever is in the folder; a missing module just means that channel's jobs
// have nothing to run.
//
// What the worker asks a module for (only `stages` and `handlers` are needed; the rest are optional):
//   stages            the steps in order; handlers[step](job) does each one
//   afterLive(job)    once the video is public; afterTikTok(job) once it's on TikTok
//   splitUnit         what a split video is cut into ("clip" when not set), for the job log
//   renumber, pendingEarlier, restartKeep   numbered series (episode numbers that must stay in order)
//   footagePlan, continuityAudit            extra checks the YouTube settings page can run
//   perDayDefault     videos a day when the channel's settings don't say (schedule.js)
//   usesCaptions      it makes its own captions, so the morning check looks for the free caption tool (health.js)
//   trackerName, renderFeedback             how Admin's downloads name its tracker; it keeps render feedback
// See example.js for a small documented starting point.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadPipelineConfig } from "../util.js";
import { loaded as mods } from "./known.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const NOT_CHANNELS = new Set(["index.js", "known.js", "upload.js"]);
for (const f of fs.readdirSync(DIR).sort()) {
  if (!f.endsWith(".js") || NOT_CHANNELS.has(f)) continue;
  try {
    const m = await import(pathToFileURL(path.join(DIR, f)).href);
    if (Array.isArray(m.stages)) mods[f.slice(0, -3)] = m;
  } catch (err) {
    console.warn(`Channel module ${f} didn't load: ${err.message}`);
  }
}

const config = () => { try { return loadPipelineConfig(); } catch { return {}; } };
// The module name a channel's config names: its "module" setting, else its own id.
export const moduleName = (id, cfg = config()) => cfg.channels?.[id]?.module || id;
// A channel's module (undefined when there is none): the file with its id, else the one its "module" setting names.
export const channelModule = (id, cfg) => (id == null ? undefined : mods[String(id)] || mods[moduleName(String(id), cfg)]);
// The channels that have a module: the configured ones, plus any module named after itself (its own channel id), so a
// job of a channel that was taken out of the config still finds its steps. Template modules (example.js) only count
// when a channel uses them.
export function channelIds(cfg = config()) {
  const ids = Object.keys(cfg.channels || {}).filter((id) => channelModule(id, cfg));
  for (const [name, m] of Object.entries(mods)) if (!m.template && !ids.includes(name)) ids.push(name);
  return ids;
}
// { channel id: its stages } for every channel with a module.
export const stagesByChannel = (cfg = config()) => Object.fromEntries(channelIds(cfg).map((id) => [id, channelModule(id, cfg).stages]));
// The channels whose module can do something (a function name): e.g. withAbility("renumber").
export const withAbility = (fn, cfg = config()) => channelIds(cfg).filter((id) => typeof channelModule(id, cfg)?.[fn] === "function");
