// Cache headers for the hub's static files and its two busiest polls (speed work, 2026-11-16).
//  - A file whose URL carries a version (?v=...) never changes under that URL, so it gets a year and "immutable":
//    /vendor/ (three.js, pinned to r160 in the page's import map) and /campus/3d/kit.json (its ?v= is worked out from the
//    file's size and modified time when the hub starts and handed to the page in /api/hub/settings as assetV).
//  - Everything else (pages, the campus scripts, CSS) is asked again on every load with its ETag: a 304 costs no body.
//  - /api/pipeline/glance and /api/agents (alias: /api/pipeline/agents) are polled every few seconds: "no-cache" plus Express's weak ETag
//    from the JSON body, so an unchanged answer is a 304 with no body.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const IMMUTABLE = "public, max-age=31536000, immutable";
export const REVALIDATE = "no-cache";

// ?v= is honoured only on files that are meant to be versioned
const versioned = (file) => /[\\/]vendor[\\/]/.test(file) || /[\\/]campus[\\/]3d[\\/]kit\.json$/.test(file);
const hasV = (res) => {
  try { return !!new URL(res.req?.originalUrl || res.req?.url || "", "http://x").searchParams.get("v"); } catch { return false; }
};
export function staticHeaders(res, file) {
  if (versioned(file) && hasV(res)) res.setHeader("Cache-Control", IMMUTABLE);
  else res.setHeader("Cache-Control", REVALIDATE);
}

let versions = null;
// Short ids for the big, rarely changing files, from size and modified time; worked out once, when first asked.
export function assetVersions(publicDir) {
  if (versions) return versions;
  const id = (rel) => {
    try {
      const s = fs.statSync(path.join(publicDir, rel));
      return crypto.createHash("sha1").update(`${s.size}:${Math.round(s.mtimeMs)}`).digest("hex").slice(0, 8);
    } catch { return ""; }
  };
  versions = { kit: id("campus/3d/kit.json") };
  return versions;
}

// Marks the polled JSON routes "revalidate" (Express adds the ETag and answers If-None-Match with 304 itself).
// Each maps to the top-level keys that change on every call without meaning anything new: the glance answer carries an
// "at" time of its own (nothing in the campus reads it), which would give every poll a new ETag, so its ETag is worked out
// from the body without that key. Other moving parts (a live worker's clock inside the agents payload) are in the payload
// itself: slimming that is the agents lane's job, not this file's.
const POLLED = new Map([["/api/pipeline/glance", ["at"]], ["/api/pipeline/agents", []], ["/api/agents", []], ["/api/agents/city", ["at"]], ["/api/pipeline/agents/city", ["at"]]]);
export function revalidatePolls(req, res, next) {
  const ignore = req.method === "GET" ? POLLED.get(req.path.replace(/\/+$/, "")) : undefined;
  if (!ignore) return next();
  res.setHeader("Cache-Control", REVALIDATE);
  if (ignore.length) {
    const json = res.json.bind(res);
    res.json = (body) => {
      try {
        if (body && typeof body === "object" && !res.getHeader("ETag")) {
          const rest = { ...body };
          for (const k of ignore) delete rest[k];
          res.setHeader("ETag", `W/"${crypto.createHash("sha1").update(JSON.stringify(rest)).digest("base64url")}"`);
        }
      } catch {}
      return json(body);
    };
  }
  next();
}
