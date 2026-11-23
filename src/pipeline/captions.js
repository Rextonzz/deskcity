// Our own captions for a channel, instead of cropping the stream's YouTube CC band: the clip's audio is transcribed
// (faster-whisper on the PC when installed, else Gemini), each word gets its speaker from the review's per-line
// speakers, swears are starred out, and the words are written as big Shorts-style captions (an .ass file burned in).
import fs from "node:fs";
import path from "node:path";
import { askGeminiJSON, obj, arr, str, num } from "./claude.js";
import { hasGemini } from "./ai.js";
import { run, resolvePath, loadPipelineConfig as cfg, pythonCmd, ffmpegCmd } from "./util.js";
import { logJob, jobDir } from "./jobs.js";
import { audioBlock } from "./media.js";

// Speaker colours (white first for the main speaker), as ASS &HBBGGRR&.
const COLOURS = ["&HFFFFFF&", "&H00E5FF&", "&HFFC94D&", "&H7CFF7C&", "&HFF8CF0&", "&H6FA8FF&"];
// Starred words: the shipped list (swears.txt, from the open LDNOOBW list) plus spelling variants below.
const LIST = new Set(fs.readFileSync(new URL("./swears.txt", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#")));
const VARIANTS = /^(f+u+c+k\w*|motherf\w*|sh[i1]t\w*|c+u+n+t\w*|n[i1]gg\w*|f[a4]gg?\w*|retard\w*|kurwa\w*|b[i1]tch\w*)$/i;
const isSwear = (w) => LIST.has(w.toLowerCase()) || VARIANTS.test(w);
const star = (w) => w.replace(/^(\W*)(\w)([\w']*?)(\w)('s)?(\W*)$/i, (m, pre, first, mid, lastCh, poss, post) => `${pre}${first}${mid.replace(/./g, "*")}${lastCh}${poss || ""}${post}`);

async function whisperWords(wav, hintFile, channel) {
  const model = cfg().channels?.[channel]?.whisperModel || "small.en";
  try {
    const { stdout } = await run(pythonCmd(), [resolvePath("python/cz_transcribe.py"), wav, model, hintFile]);
    return JSON.parse(stdout.toString()).words;
  } catch (err) {
    if (/code 3\b|exit(ed)? (with )?(code )?3\b/i.test(err.message)) return null; // not installed
    throw err;
  }
}

async function geminiWords(mp3, length, hint) {
  const res = await askGeminiJSON({
    name: "cz_captions",
    system:
      "Transcribe this short clip's speech for on-screen captions. Give every spoken word in order with its start and end time in seconds from the start of the audio, as accurately as you can hear them. Keep swears as said. Leave out music and sound effects. You're given the stream's own auto-captions as a hint: use them for names and unusual words (they're often right about rare words like foreign terms, and often wrong about timing), but write what is actually said.",
    content: [
      { type: "text", text: `Hint, the stream's captions and the people in the clip:\n${hint}\n\nAudio, ${length.toFixed(1)} s:` },
      audioBlock(mp3),
    ],
    schema: obj({ words: arr(obj({ start: num, end: num, word: str })) }),
  });
  return res.words;
}

// Words of the cut, times from the start of the cut. Returns null when no transcriber is available.
export async function transcribeCut(job) {
  const dir = jobDir(job.id);
  const { start, length } = job.data.cut;
  const wav = path.join(dir, "cut-audio.wav");
  await run(ffmpegCmd(), ["-v", "error", "-y", "-ss", String(start), "-t", String(length), "-i", job.data.source, "-vn", "-ac", "1", "-ar", "16000", wav]);
  // Hint: the stream's own captions for this stretch (from the review) and the names of the people in the clip.
  const r = job.data.review || {};
  const hint = [
    `People: ${[r.speaker?.name, ...(r.on_screen || []).map((p) => p.name)].filter(Boolean).join(", ")}.`,
    ...(r.transcript || []).filter((t) => t.end > start && t.start < start + length).map((t) => t.text.replace(/>>\s*/g, "")),
  ].join(" ");
  const hintFile = path.join(dir, "caption-hint.txt");
  fs.writeFileSync(hintFile, hint, "utf8");
  let words = await whisperWords(wav, hintFile, job.channel).catch((err) => (logJob(job, `Whisper didn't run: ${err.message.trim().split("\n").filter(Boolean).pop()}`), null));
  let by = "Whisper";
  if (!words && hasGemini()) {
    const mp3 = path.join(dir, "cut-audio.mp3");
    await run(ffmpegCmd(), ["-v", "error", "-y", "-i", wav, "-b:a", "64k", mp3]);
    words = await geminiWords(mp3, length, hint);
    by = "Gemini";
  }
  if (!words?.length) return null;
  logJob(job, `Captions: ${words.length} words transcribed by ${by}`);
  return words.filter((w) => w.word && w.end > 0 && w.start < length);
}

// Writes captions.ass in the job folder; the caption block's top sits at `top` px of the 1080x1920 frame, or, with
// `centerY`, each caption line is centred on that height (the cam/stream seam in layout (d)).
export function writeCaptions(job, words, { top = 0, centerY = null } = {}) {
  const r = job.data.review;
  const cutStart = job.data.cut.start;
  const lines = (r.transcript || []).filter((t) => t.speaker && t.speaker !== "?");
  const speakerAt = (t) => lines.find((l) => t + cutStart >= l.start - 0.2 && t + cutStart <= l.end + 0.2)?.speaker || null;
  const main = r.speaker?.name;
  const order = [main, ...new Set(lines.map((l) => l.speaker))].filter((v, i, a) => v && a.indexOf(v) === i);
  const colour = (who) => COLOURS[Math.max(0, order.indexOf(who)) % COLOURS.length];
  const multi = new Set(words.map((w) => speakerAt(w.start)).filter(Boolean)).size > 1;

  // Chunks of up to 3 words / 16 characters, broken at a speaker change or a pause.
  const chunks = [];
  let cur = null;
  for (const w of words) {
    const text = isSwear(w.word.replace(/[^\w']/g, "").replace(/'s$/i, "")) ? star(w.word) : w.word;
    const who = speakerAt(w.start);
    const brk = !cur || cur.words.length >= 3 || (cur.text + " " + text).length > 16 || who !== cur.who || w.start - cur.end > 0.6;
    if (brk) chunks.push((cur = { start: w.start, end: w.end, text, who, words: [w] }));
    else Object.assign(cur, { end: w.end, text: `${cur.text} ${text}`, words: [...cur.words, w] });
  }
  // Each chunk stays up until the next one starts (short gaps), so captions don't flicker.
  chunks.forEach((c, i) => {
    const next = chunks[i + 1];
    c.end = next && next.start - c.end < 0.5 ? next.start : c.end + 0.25;
  });
  const ts = (t) => {
    const cs = Math.max(0, Math.round(t * 100));
    return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
  };
  const esc = (s) => s.replace(/[{}\\]/g, "").toUpperCase();
  const at = Number.isFinite(centerY) ? `{\\an5\\pos(540,${Math.round(centerY)})}` : "";
  const ass = [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "WrapStyle: 2", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cap,Arial Black,92,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,7,3,8,60,60,${Math.round(top)},1`,
    `Style: Who,Arial Black,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,4,2,8,60,60,${Math.max(0, Math.round(top) - 52)},1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    // Plain white for everyone (the owner 2026-10-18: speaker colours and name tags off until the per-line speaker data
    // is reliable). Chunks still break at speaker changes, and colour()/multi are kept for turning this back on.
    ...chunks.map((c) => `Dialogue: 0,${ts(c.start)},${ts(c.end)},Cap,,0,0,0,,${at}${esc(c.text)}`),
  ].join("\n");
  const file = path.join(jobDir(job.id), "captions.ass");
  fs.writeFileSync(file, ass, "utf8");
  return { file, chunks: chunks.length, speakers: order.length };
}
