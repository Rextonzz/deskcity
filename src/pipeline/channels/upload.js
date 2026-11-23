// The "upload" stage both channels share: pick private, public or a scheduled slot, book it, upload through Studio,
// record the result.
import { jobDir, logJob, saveJob, nextFreeSlot, recordUpload } from "../jobs.js";
import { studioLabels } from "../schedule.js";
import { uploadVideo } from "../studio/studio.js";
import { channelCfg, pipelineTz } from "../util.js";
import { livePostTime, liveSettingsFor } from "../livewatch.js";

// When a "public now" upload meets YouTube's "still checking" box: the next quarter hour at least 20 minutes away, so
// the checks can finish first (Studio's schedule picker works in 15-minute steps).
export function checkingFallbackTime(now = Date.now()) {
  const q = 15 * 60000;
  return new Date(Math.ceil((now + 20 * 60000) / q) * q);
}

// `thumbnail` goes to Studio only when given. `upload` is Studio's uploader (a test passes its own).
/** @param {any} job @param {{ thumbnail?: string, upload?: Function }} [opts] */
export async function uploadToStudio(job, { thumbnail, upload = uploadVideo } = {}) {
  const s = channelCfg(job.channel);
  const tz = pipelineTz();
  let visibility = "private";
  let publishAt = null;
  if (s.live && job.data.postNow) {
    // A live-stream clip (livewatch.js): public now, unless the hourly cap is reached, then the next free spot.
    publishAt = livePostTime(job.channel, job.id, { perHour: liveSettingsFor(job.channel).perHour });
    visibility = publishAt ? "schedule" : "public";
  } else if (s.live) {
    if (s.postingMode === "schedule") {
      // Booked slots: every other job's time, plus the planned time of any upload still in flight or stopped.
      publishAt = nextFreeSlot(job.channel, job.id);
      visibility = "schedule";
    } else visibility = "public";
  }
  // Kept so "It's in Studio" can finish the job if Studio saved the video but the app missed the confirmation.
  job.data.uploadPlan = { visibility, publishAt: publishAt ? publishAt.toISOString() : null, at: new Date().toISOString() };
  // Saved before the upload, so a crash mid-upload still knows the slot (stress test 2026-10-23: it was lost, and the
  // next video took the same slot while "It's in Studio" recorded a scheduled video as private).
  saveJob(job);
  const m = job.data.meta_out;
  // Public now, but YouTube may still be checking the video: then it's scheduled a little later instead (studio.js).
  const fallbackAt = visibility === "public" ? checkingFallbackTime() : null;
  const res = await upload({
    channel: s,
    file: job.data.output,
    title: m.title,
    description: m.description,
    tags: m.tags,
    ...(thumbnail ? { thumbnail } : {}),
    visibility,
    scheduleLabels: publishAt ? studioLabels(tz, publishAt) : null,
    ...(fallbackAt ? { checkingFallback: { labels: studioLabels(tz, fallbackAt), publishAt: fallbackAt } } : {}),
    shotsDir: jobDir(job.id),
  });
  const { videoId } = res;
  if (res.visibility === "schedule" && res.publishAt) {
    logJob(job, `YouTube was still checking the video, so instead of public now it's scheduled for ${studioLabels(tz, res.publishAt).pretty}`);
    visibility = "schedule";
    publishAt = res.publishAt;
  }
  recordUpload(job, { videoId, visibility, publishAt });
  logJob(job, `Uploaded ${videoId} (${visibility}${publishAt ? `, ${studioLabels(tz, publishAt).pretty}` : ""})`);
}
