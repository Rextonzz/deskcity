// Voice samples per a channel creator, and a voice match with Gemini (Claude can't hear audio).
// Samples build themselves: a clip with one voice and a sure, on-camera speaker gives a clean sample; a clip where
// the owner typed who's talking gives a "mixed" one (other voices may be in it). When the speaker check isn't sure, the
// clip's audio and the known samples go to Gemini; a sure match names the speaker and the clip doesn't wait on the owner.
import fs from "node:fs";
import path from "node:path";
import { askGeminiJSON, obj, arr, str, oneOf } from "./claude.js";
import { hasGemini } from "./ai.js";
import { canonical, roster } from "./creators.js";
import { logJob } from "./jobs.js";
import { run, resolvePath, ffmpegCmd } from "./util.js";
import { audioBlock } from "./media.js";

const DIR = () => resolvePath("data/voices");
const slug = (name) => name.replace(/[^A-Za-z0-9]+/g, "_");
const KEEP = 4;

async function cutAudio(src, start, len, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await run(ffmpegCmd(), ["-v", "error", "-y", "-ss", String(Math.max(0, start)), "-t", String(len), "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", out]);
  return out;
}

// Every creator with samples: { name: [{ file, clean }] }, clean ones first, newest first.
export function voiceSamples() {
  const out = {};
  if (!fs.existsSync(DIR())) return out;
  for (const d of fs.readdirSync(DIR())) {
    const dir = path.join(DIR(), d);
    let name;
    try {
      name = JSON.parse(fs.readFileSync(path.join(dir, "name.json"), "utf8")).name;
    } catch {
      continue;
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".mp3")).map((f) => ({ file: path.join(dir, f), clean: f.startsWith("clean-"), at: fs.statSync(path.join(dir, f)).mtimeMs }));
    files.sort((a, b) => b.clean - a.clean || b.at - a.at);
    if (files.length) out[name] = files;
  }
  return out;
}

// Saves 12 s of the clip's speech as a sample for `name` (a roster creator only), keeping the newest few.
export async function saveSample(job, name, { clean }) {
  const who = canonical(name);
  if (!who) return null;
  const r = job.data.review || {};
  const dir = path.join(DIR(), slug(who));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "name.json"), JSON.stringify({ name: who }));
  const start = Number.isFinite(r.hook_start) ? r.hook_start : 0;
  const out = await cutAudio(job.data.source, start, 12, path.join(dir, `${clean ? "clean" : "mixed"}-${job.id}.mp3`));
  const all = fs.readdirSync(dir).filter((f) => f.endsWith(".mp3")).map((f) => ({ f, at: fs.statSync(path.join(dir, f)).mtimeMs, clean: f.startsWith("clean-") }));
  all.sort((a, b) => b.clean - a.clean || b.at - a.at);
  for (const x of all.slice(KEEP)) fs.rmSync(path.join(dir, x.f), { force: true });
  logJob(job, `Saved a ${clean ? "clean" : "mixed"} voice sample for ${who}`);
  return out;
}


// The speaker by voice, or null when there's no Gemini key, no samples, or no sure match.
export async function matchVoice(job, res) {
  if (!hasGemini()) return null;
  const known = voiceSamples();
  const seen = new Set((res.on_screen || []).map((p) => canonical(p.name.replace(/\(.*?\)/g, ""))).filter(Boolean));
  const names = Object.keys(known).filter((n) => roster()[n] !== undefined).sort((a, b) => seen.has(b) - seen.has(a)).slice(0, 10);
  if (!names.length) return null;
  const { duration } = job.data.meta;
  const start = Number.isFinite(res.hook_start) ? res.hook_start : 0;
  const end = Number.isFinite(res.natural_end) && res.natural_end > start ? res.natural_end : duration;
  const clip = await cutAudio(job.data.source, start, Math.min(90, end - start + 1), path.join(path.dirname(job.data.source), "voice-clip.mp3"));
  const content = [{ type: "text", text: "THE CLIP (audio):" }, audioBlock(clip)];
  for (const n of names) for (const s of known[n].slice(0, 2)) content.push({ type: "text", text: `Known voice sample: ${n}${s.clean ? "" : " (other voices may be in this one too; the main voice is theirs)"}` }, audioBlock(s.file));
  content.push({
    type: "text",
    text: `People on camera (from the video frames): ${(res.on_screen || []).map((p) => `${p.name} [${p.markers}]`).join("; ") || "unknown"}.
Captions read from the clip: ${(res.transcript || [])
      .map((t) => `${t.start}s ${t.text}`)
      .join(" | ")
      .slice(0, 3000)}
Who delivers the main lines of the clip (the person the clip is about)? Match voices against the samples by sound: pitch, accent, laugh, pacing. Use "high" only if the main voice clearly matches one sample and no other sample fits as well. If the main voice matches nobody in the samples, say "unknown".`,
  });
  const ans = await askGeminiJSON({
    name: "cz_voice",
    system: "You identify speakers in a short streamer clip by their voice, comparing it with labelled voice samples. Be strict: a wrong name in a YouTube title is worse than asking the owner.",
    content,
    schema: obj({ speaker: str, confidence: oneOf("high", "medium", "low"), voices: arr(obj({ name: str, lines: str })), reasoning: str }),
  });
  fs.rmSync(clip, { force: true });
  const who = canonical(ans.speaker);
  logJob(job, `Voice match: ${ans.speaker} (${ans.confidence}). ${ans.reasoning}`);
  if (ans.confidence !== "high" || !who) return null;
  return { name: who, reasoning: ans.reasoning, voices: ans.voices };
}
