// An example channel module: a small, working starting point for your own channel. Copy this file to
// channels/<your channel id>.js (or point a channel at it with "module": "example") and change the steps.
//
// In pipeline.config.json:
//   "channels": {
//     "mychannel": {
//       "module": "example",               which file in this folder runs it (leave out when the file has the channel's id)
//       "enabled": true, "live": false,     live false: uploads go up private while you test
//       "name": "My Channel", "studioName": "My Channel",
//       "inbox": "./inbox/mychannel",       drop finished vertical videos here
//       "contextFile": "./docs/mychannel-rules.md",   the channel's rules: what titles and descriptions should sound like
//       "postingMode": "schedule", "slots": { "weekday": ["12:00"], "weekend": ["12:00"] }
//     }
//   }
//
// What it does: checks the video, writes the title, description and tags with AI from the channel's rules, waits for
// you to look (the "audit" step), then uploads through YouTube Studio. Every step is one function in `handlers`; a step
// that needs you throws a Hold (the job waits on the Pipeline page with your answer boxes).
import { askJSON, stepSystem, obj, arr, str } from "../claude.js";
import { probe } from "../media.js";
import { logJob } from "../jobs.js";
import { audit } from "../audit.js";
import { uploadToStudio } from "./upload.js";
import { Hold, channelCfg, channelRules } from "../util.js";

// Only used by a channel that names it ("module": "example"); the hub doesn't list it as a channel of its own.
export const template = true;

export const stages = ["intake", "package", "audit", "upload"];

export const handlers = {
  // Look at the file: size, length, sound.
  async intake(job) {
    const meta = await probe(job.data.source);
    job.data.meta = meta;
    logJob(job, `${meta.width}x${meta.height}, ${meta.duration.toFixed(1)} s, audio ${meta.hasAudio ? "yes" : "no"}`);
    if (meta.height <= meta.width) throw new Hold("This video isn't vertical. Shorts need a vertical (9:16) video: export it vertical and drop it in again.", null);
    if (meta.duration > 180) throw new Hold("This video is over 3 minutes, too long for a Short.", null);
    job.data.output = job.data.source; // posted as it is: nothing is edited
  },

  // Title, description and tags from the channel's rules file.
  async package(job) {
    const ov = job.data.overrides?.package;
    if (ov) return void (job.data.meta_out = ov);
    const ch = channelCfg(job.channel) || {};
    const res = await askJSON({
      name: "example_package",
      system: stepSystem(channelRules(job.channel, "empty"), `Write the YouTube Shorts metadata for one video on the channel "${ch.name || job.channel}". Follow the channel's rules above.`),
      content: [{ type: "text", text: `File name: ${job.sourceName}. Length ${job.data.meta.duration.toFixed(1)} s. Give one title (under 100 characters, ending in #shorts), a short description, 4-8 tags and a pinned comment.` }],
      schema: obj({ title: str, description: str, tags: arr(str), pinned_comment: str }),
    });
    job.data.meta_out = { ...res, backups: [] };
  },

  // Waits for you only when the video was edited by the pipeline; this example posts the file as it is, so it goes
  // straight on. Keep it: a channel that edits videos gets its "watch before upload" check here.
  audit,

  // Private, public or the next free slot, from the channel's settings.
  upload: (job) => uploadToStudio(job),
};
