// What the PC tools (the Claude Code hook, agent-log, the checks) share: where the hub lives, its key and the
// folder-to-room rule. Imports only node: modules, so none of them has to load .env or src/config.js.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Where the hub is: HUB_URL if set, else this folder's .env PORT (the same setting the hub listens on), else 3000.
export function portFromEnvFile(root = ROOT) {
  try {
    // The last PORT line wins, as it does for the hub itself (dotenv), so a second line added at the end is the one used.
    const m = [...fs.readFileSync(path.join(root, ".env"), "utf8").matchAll(/^\s*PORT\s*=\s*"?(\d{1,5})"?\s*(?:#.*)?$/gm)].pop();
    return m && Number(m[1]) > 0 && Number(m[1]) < 65536 ? Number(m[1]) : null;
  } catch { return null; }
}
export const HUB_URL = process.env.HUB_URL || `http://localhost:${portFromEnvFile() || 3000}`;

// The agent key goes in every post, so it never travels over plain http to another machine (security plan 07): http is
// fine to this PC and over Tailscale (encrypted); anything else needs https.
export function plainHttpToElsewhere(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (["localhost", "127.0.0.1", "::1"].includes(host) || host.endsWith(".ts.net")) return null;
  const p = host.split(".").map(Number);
  if (p.length === 4 && p.every((n) => Number.isInteger(n)) && p[0] === 100 && p[1] >= 64 && p[1] <= 127) return null; // Tailscale 100.64.0.0/10
  if (/^fd7a:115c:a1e0:/.test(host)) return null; // Tailscale IPv6
  return host;
}
{
  const bad = plainHttpToElsewhere(HUB_URL);
  if (bad) { console.error(`Refusing to send the hub key over plain http to ${bad}; use https or Tailscale.`); process.exit(1); }
}

// The agent key (data/agents/token.txt). Throws if the file is missing or unreadable, as the callers expect.
export function hubToken() {
  return fs.readFileSync(path.join(ROOT, "data", "agents", "token.txt"), "utf8").trim();
}

// Which key of a folder map (hook-map.json) a folder falls under: the longest mapped folder wins, so a subfolder can
// have its own room. Case is ignored. A key can be a whole drive ("D:\\"), which already ends in a separator, and
// "D:\\Null" does not match "D:\\another project". Paths with a drive letter are read the Windows way on any platform.
export function matchFolder(map, cwd) {
  const win = (p) => /^[a-z]:/i.test(String(p));
  const here0 = String(cwd || "");
  const hits = Object.keys(map).filter((k) => {
    const p = win(k) || win(here0) ? path.win32 : path;
    const base = p.resolve(k).toLowerCase();
    const here = p.resolve(here0).toLowerCase();
    return here === base || here.startsWith(base.endsWith(p.sep) ? base : base + p.sep);
  });
  return hits.sort((a, b) => b.length - a.length)[0];
}
