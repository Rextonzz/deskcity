import { Hold } from "./util.js";

// the owner's rule: anything the pipeline edited waits for him to watch it before upload. His own edits go straight through.
// The edit check (a channel) and render check (a channel) no longer stop on their own (the owner, 2026-10-21): what
// they find is listed here, so an edited video stops once. extra.fields lets a channel add boxes
// (a fix box), extra.checkName names its check ("render"; "edit" when not given).
export function audit(job, extra = {}) {
  if (job.data.output === job.data.source) return;
  const ov = job.data.overrides?.audit;
  if (ov) {
    if (typeof ov === "object") job.data.meta_out = ov;
    return;
  }
  const points = job.data.checkPoints || [];
  const found = points.length ? ` The ${extra.checkName || "edit"} check found ${points.length} thing${points.length === 1 ? "" : "s"} to look at, listed below.` : "";
  throw new Hold(`Ready for your check.${found} Watch the edit below, adjust the title, description, tags or comment here if you want, then press Continue to upload.`, job.data.meta_out, {
    points: points.length ? points : null,
    fields: extra.fields || null,
  });
}
