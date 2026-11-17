import fs from "node:fs";
import path from "node:path";
import { run, ffmpegCmd, ffprobeCmd, fontFile } from "./util.js";

// drawtext needs the colon in a Windows drive path escaped.
const fontArg = () => fontFile().replace(/\\/g, "/").replace(/:/g, "\\:");

export async function probe(file) {
  const { stdout } = await run(ffprobeCmd(), ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]);
  const info = JSON.parse(stdout.toString());
  const video = info.streams.find((s) => s.codec_type === "video");
  const audio = info.streams.find((s) => s.codec_type === "audio");
  let width = video?.width ?? 0;
  let height = video?.height ?? 0;
  // Phones store portrait video as landscape plus a rotation flag.
  const rotation = Math.abs(Number(video?.tags?.rotate ?? video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0));
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];
  return { width, height, duration: Number(info.format.duration), hasAudio: Boolean(audio), sizeBytes: Number(info.format.size) };
}

// Contact sheets with the source timestamp burned into each tile. Returns [{path, from, to}].
export async function contactSheets(file, outDir, { fps = 2, tileWidth = 240, cols = 8, rows = 4, crop = null, start = 0, end = null, prefix = "sheet" } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const { duration } = await probe(file);
  const stop = end ?? duration;
  const perSheet = cols * rows;
  const filters = [
    `fps=${fps}`,
    crop,
    `scale=${tileWidth}:-2`,
    `drawtext=fontfile='${fontArg()}':text='%{pts\\:flt}':x=6:y=6:fontsize=${Math.round(tileWidth / 9)}:fontcolor=yellow:borderw=2:bordercolor=black`,
    `tile=${cols}x${rows}`,
  ].filter(Boolean);
  // -copyts keeps pts equal to the source time even with -ss.
  await run(ffmpegCmd(), ["-v", "error", "-y", "-ss", String(start), "-to", String(stop), "-copyts", "-i", file, "-vf", filters.join(","), "-q:v", "4", path.join(outDir, `${prefix}_%02d.jpg`)]);
  const files = fs.readdirSync(outDir).filter((f) => f.startsWith(prefix + "_")).sort();
  return files.map((f, i) => ({ path: path.join(outDir, f), from: start + (i * perSheet) / fps, to: Math.min(stop, start + ((i + 1) * perSheet) / fps) }));
}

export async function frameAt(file, t, out, { crop = null, width = 720, grid = false } = {}) {
  const vf = [crop, `scale=${width}:-2`, grid ? "drawgrid=w=iw/10:h=ih/10:t=2:c=red@0.6" : null].filter(Boolean).join(",");
  await run(ffmpegCmd(), ["-v", "error", "-y", "-ss", String(Math.max(0, t)), "-i", file, "-frames:v", "1", "-vf", vf, "-q:v", "3", out]);
  return out;
}

// The sharpest moments in [from, to] (the owner 2026-10-19: card frames came out blurry while a card was being flipped
// or moved). ffmpeg's blurdetect scores every frame (lower = sharper); returns up to `count` times, best first, at
// least `apart` seconds from each other. Falls back to evenly spaced times if the filter isn't there.
export async function sharpestTimes(file, from, to, { crop = null, count = 2, apart = 0.25 } = {}) {
  const dur = Math.max(0.1, to - from);
  const scores = [];
  try {
    const vf = [crop, "scale=480:-2", "format=gray", "blurdetect=block_width=32:block_height=32", "metadata=print:file=-"].filter(Boolean).join(",");
    const { stdout } = await run(ffmpegCmd(), ["-v", "error", "-ss", String(Math.max(0, from)), "-t", String(dur), "-i", file, "-an", "-vf", vf, "-f", "null", "-"]);
    let t = null;
    for (const line of String(stdout).split(/\r?\n/)) {
      const m = line.match(/pts_time:([\d.]+)/);
      if (m) t = Number(m[1]);
      const b = line.match(/lavfi\.blur=([\d.]+)/);
      if (b && t != null) scores.push({ t: Math.max(0, from) + t, blur: Number(b[1]) });
    }
  } catch {}
  if (!scores.length) return Array.from({ length: count }, (_, i) => from + (dur * (i + 1)) / (count + 1));
  const out = [];
  for (const s of [...scores].sort((a, b) => a.blur - b.blur)) {
    if (out.every((x) => Math.abs(x.t - s.t) >= apart)) out.push(s);
    if (out.length >= count) break;
  }
  return out.map((x) => x.t);
}

export async function silences(file, { noise = "-35dB", minDur = 0.18 } = {}) {
  const { stderr } = await run(ffmpegCmd(), ["-hide_banner", "-i", file, "-af", `silencedetect=noise=${noise}:d=${minDur}`, "-f", "null", "-"]);
  const gaps = [];
  let start = null;
  for (const line of stderr.split(/\r?\n/)) {
    const s = line.match(/silence_start: ([\d.]+)/);
    const e = line.match(/silence_end: ([\d.]+)/);
    if (s) start = Number(s[1]);
    if (e && start !== null) {
      gaps.push({ start, end: Number(e[1]) });
      start = null;
    }
  }
  return gaps;
}

// Multi-voice check from the session notes: median pitch per 2 s bucket; a 100 Hz+ swing means more than one speaker.
export async function pitchBuckets(file, bucketSec = 2) {
  const rate = 16000;
  const { stdout } = await run(ffmpegCmd(), ["-v", "error", "-i", file, "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"]);
  const samples = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2));
  const frame = 1024;
  const minLag = Math.floor(rate / 400);
  const maxLag = Math.floor(rate / 70);
  const buckets = [];
  const perBucket = bucketSec * rate;
  for (let b = 0; b + perBucket <= samples.length; b += perBucket) {
    const pitches = [];
    for (let i = b; i + frame + maxLag < b + perBucket; i += frame) {
      let energy = 0;
      for (let k = 0; k < frame; k++) energy += samples[i + k] ** 2;
      if (energy / frame < 500 ** 2) continue; // too quiet to be speech
      const corr = new Float64Array(maxLag + 1);
      let best = 0;
      for (let lag = minLag; lag <= maxLag; lag++) {
        let sum = 0;
        for (let k = 0; k < frame; k++) sum += samples[i + k] * samples[i + k + lag];
        corr[lag] = sum;
        if (sum > best) best = sum;
      }
      // Shortest lag near the peak, so a multiple of the period isn't read as an octave lower.
      let bestLag = 0;
      for (let lag = minLag; lag <= maxLag; lag++) {
        if (corr[lag] >= 0.9 * best && corr[lag] >= corr[lag - 1] && corr[lag] >= (corr[lag + 1] ?? 0)) {
          bestLag = lag;
          break;
        }
      }
      if (bestLag && best / energy > 0.5) pitches.push(rate / bestLag);
    }
    if (pitches.length >= 5) {
      pitches.sort((x, y) => x - y);
      buckets.push({ t: b / rate, hz: Math.round(pitches[Math.floor(pitches.length / 2)]) });
    }
  }
  const hz = buckets.map((x) => x.hz);
  const swing = hz.length ? Math.max(...hz) - Math.min(...hz) : 0;
  return { buckets, swing, multiVoice: swing >= 100 };
}

export function imageBlock(file) {
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: fs.readFileSync(file).toString("base64") } };
}

export const audioBlock = (file) => ({ type: "audio", source: { media_type: "audio/mpeg", data: fs.readFileSync(file).toString("base64") } });

// Turns: how far to turn the picture clockwise to make it upright.
export const TURNS = { none: null, clockwise_90: "transpose=1", "180": "hflip,vflip", counterclockwise_90: "transpose=2" };

// An upright copy of a video (sound copied as is). ffmpeg already applies a phone's rotation flag, so this is only
// for footage that was filmed the wrong way up.
export async function turnVideo(file, turn, out) {
  await run(ffmpegCmd(), ["-v", "error", "-y", "-i", file, "-vf", TURNS[turn], "-c:v", "libx264", "-crf", "17", "-preset", "fast", "-c:a", "copy", "-metadata:s:v:0", "rotate=0", "-movflags", "+faststart", out]);
  return out;
}

// One part of a video, cut at the exact times (re-encoded, so it doesn't snap to keyframes).
export async function cutPiece(file, start, end, out) {
  await run(ffmpegCmd(), ["-v", "error", "-y", "-ss", String(Math.max(0, start)), "-to", String(end), "-i", file, "-c:v", "libx264", "-crf", "17", "-preset", "fast", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);
  return out;
}

// Landscape footage -> a 9:16 vertical copy at 1080x1920, cropped around `centerX` (0 = left edge, 1 = right edge).
export async function verticalCrop(file, centerX, out) {
  const cx = Math.min(1, Math.max(0, Number.isFinite(centerX) ? centerX : 0.5));
  const vf = `crop=trunc(ih*9/16/2)*2:ih:max(0\\,min(iw-ow\\,iw*${cx.toFixed(3)}-ow/2)):0,scale=1080:1920`;
  await run(ffmpegCmd(), ["-v", "error", "-y", "-i", file, "-vf", vf, "-c:v", "libx264", "-crf", "17", "-preset", "fast", "-c:a", "copy", "-movflags", "+faststart", out]);
  return out;
}
