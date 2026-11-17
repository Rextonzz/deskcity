// Public-address checks for blocker watches (security plan 02, 2026-11-16): a watch may read public web pages only,
// never this PC, the router, a printer, a cloud metadata address or anything else on a private network.
import net from "node:net";
import os from "node:os";
import dns from "node:dns";

const ipv4ToInt = (ip) => {
  const p = ip.split(".").map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3] : null;
};
const inRange = (ip, base, bits) => {
  const a = ipv4ToInt(ip), b = ipv4ToInt(base);
  return a !== null && b !== null && (bits === 0 || a >>> (32 - bits) === b >>> (32 - bits));
};
const V4_PRIVATE = [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]];

// Expand an IPv6 address to 8 groups of 16 bits (numbers), or null.
function v6Groups(ip) {
  let s = ip.toLowerCase().split("%")[0];
  let tail = [];
  const m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const n = ipv4ToInt(m[2]);
    if (n === null) return null;
    tail = [(n >>> 16) & 0xffff, n & 0xffff];
    s = m[1] + "0:0";
  }
  const parts = s.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const rest = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const fill = 8 - head.length - rest.length;
  if (parts.length === 2 ? fill < 1 : fill !== 0) return null;
  const all = [...head, ...(parts.length === 2 ? Array(fill).fill("0") : []), ...rest].map((h) => parseInt(h, 16));
  if (all.length !== 8 || all.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;
  if (tail.length) { all[6] = tail[0]; all[7] = tail[1]; }
  return all;
}

// True only for a globally routable address.
export function isPublicIp(ip) {
  ip = String(ip || "").trim();
  const kind = net.isIP(ip);
  if (kind === 4) return !V4_PRIVATE.some(([b, bits]) => inRange(ip, b, bits));
  if (kind !== 6) return false;
  const g = v6Groups(ip);
  if (!g) return false;
  const v4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return isPublicIp(v4); // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((n) => n === 0)) return isPublicIp(v4); // NAT64
  if (g.every((n) => n === 0) || (g.slice(0, 7).every((n) => n === 0) && g[7] === 1)) return false; // :: and ::1
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return false; // ff00::/8
  return true;
}

// Names that mean "this PC or a private network" (no DNS needed to say no).
export function blockedHostName(host) {
  const h = String(host || "").toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || ["localhost", "local", "lan", "home", "internal", "home.arpa"].some((s) => h.endsWith(`.${s}`))) return true;
  const me = os.hostname().toLowerCase();
  if (me && (h === me || h.startsWith(`${me}.`))) return true;
  return !h.includes(".") && !net.isIP(h.replace(/^\[|\]$/g, ""));
}

const PRIVATE_MSG = "That address is on this PC or a private network; blocker checks only read public pages.";
export async function checkPublicUrl(url, { lookup = dns.promises.lookup } = {}) {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) pages can be checked.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (!isPublicIp(host)) throw new Error(PRIVATE_MSG);
    return u;
  }
  if (blockedHostName(host)) throw new Error(PRIVATE_MSG);
  const found = await lookup(host, { all: true });
  const list = Array.isArray(found) ? found : [found];
  if (!list.length || !list.every((a) => isPublicIp(a.address))) throw new Error(PRIVATE_MSG);
  return u;
}
export const PRIVATE_NETWORK_MESSAGE = PRIVATE_MSG;
