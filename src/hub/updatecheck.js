// "Is there a newer version?" The only place in the app that asks the project's releases feed. It runs only when the owner
// presses "Check for an update" in Admin or runs `npm run update -- --check`, never on a timer and never at start-up.
// The address is kit.updatesUrl (hub.defaults.json, or data/hub-settings.json). When it is empty there is no address, and
// NO request is made. Nothing about this PC is sent: a plain GET with no cookies and no version number in it.
import fs from "node:fs";
import path from "node:path";

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
export const parseVersion = (v) => { const m = SEMVER.exec(String(v || "").trim()); return m ? { n: [+m[1], +m[2], +m[3]], pre: m[4] || "" } : null; };
// -1, 0 or 1; a release candidate is older than the plain release. null when either is not a version.
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] < y.n[i] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

// The newest version tag in what the feed sent: GitHub's releases API (an object or a list with tag_name), a plain
// { version }, or a releases Atom feed (…/releases/tag/v1.2.3).
export function newestTag(body) {
  const text = String(body || "");
  let tags = [];
  try {
    const j = JSON.parse(text);
    for (const r of Array.isArray(j) ? j : [j]) if (r && !r.draft && !r.prerelease) tags.push(r.tag_name || r.version || r.name);
  } catch {
    tags = [...text.matchAll(/\/releases\/tag\/(v?\d+\.\d+\.\d+[0-9A-Za-z.-]*)/g)].map((m) => m[1]);
  }
  const valid = tags.filter((t) => parseVersion(t));
  valid.sort((a, b) => compareVersions(b, a));
  return valid[0] ? String(valid[0]).replace(/^v/, "") : null;
}

// The kit's name, version and update address as an app folder says them (defaults, then owner file, then the owner's settings).
export function readKit(appDir) {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(appDir, f), "utf8")); } catch { return {}; } };
  const kit = {};
  for (const f of ["hub.defaults.json", "hub.owner.json", "data/hub-settings.json"]) Object.assign(kit, read(f).kit || {});
  return { name: kit.name || "Deskcity", version: kit.version || null, updatesUrl: String(kit.updatesUrl || "").trim() };
}

// { ok, asked, current, newest, newer, message }. `fetchFn` is injectable so tests make no request.
export async function checkForUpdate({ url, current, fetchFn = globalThis.fetch } = {}) {
  const base = { current: current || null, newest: null, newer: false };
  if (!String(url || "").trim()) return { ...base, ok: true, asked: false, message: "No update address is set, so nothing was asked. (The project has not published one yet.)" };
  if (!/^https:\/\//i.test(url)) return { ...base, ok: false, asked: false, message: "The update address must start with https://, so nothing was asked." };
  try {
    const r = await fetchFn(url, { headers: { accept: "application/json, application/atom+xml, */*", "user-agent": "deskcity-update-check" }, redirect: "follow", signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { ...base, ok: false, asked: true, message: `The releases address answered ${r.status}. Try again later.` };
    const newest = newestTag((await r.text()).slice(0, 2_000_000));
    if (!newest) return { ...base, ok: false, asked: true, message: "The releases address answered, but I could not find a version number in it." };
    const cmp = compareVersions(current, newest);
    const newer = cmp === -1;
    return { ...base, ok: true, asked: true, newest, newer, message: newer ? `You have ${current}, newest is ${newest}.` : cmp === 0 ? `You have ${current}, the newest. Nothing to update.` : `You have ${current}, newest is ${newest}. You are not behind.` };
  } catch (err) {
    return { ...base, ok: false, asked: true, message: `Could not reach the releases address (${err.name === "TimeoutError" ? "no answer in 10 seconds" : err.message}).` };
  }
}
