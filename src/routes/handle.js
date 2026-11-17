// Shared route helpers: JSON answers with an error message, files that may not exist yet, CSV downloads.
import fs from "node:fs";
import path from "node:path";

// First line of an error's message (the rest is often a stack or a long tool dump).
export const firstLine = (err) => String(err.message).split("\n")[0];

// Wraps fn(req) so its result is sent as JSON and any throw answers { error } with the route's own status and wording.
// Never answer with err.status: an upstream 403 would look like a password refusal.
export const safe = (fn, { status = 400, message = (err) => err.message } = {}) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    res.status(status).json({ error: message(err) });
  }
};

// Sends the file, or an empty 404 if it isn't there. The path is made absolute because sendFile refuses relative ones.
export function sendIfThere(res, file) {
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(path.resolve(file));
}

export function sendCsv(res, name, body) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.send(body);
}

// Refuses an oversized card photo (base64 in req.body.image) with 413 before the hourly limit or any run starts. The JSON limit is 2 MB (server.js:81).
export const photoCap = (max) => (req, res, next) => (String(req.body?.image || "").length > max ? res.status(413).json({ error: "Photo too large" }) : next());
