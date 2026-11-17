import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ownerName, ownersHub } from "./hub/settings.js";
import { networksSetting } from "./hub/listen.js";
import { writeJsonAtomic, keepLastLines } from "./pipeline/files.js";
import { config } from "./config.js";
import { sendAlert } from "./pipeline/notify.js";
import { verifyPassword } from "./passwords.js";

// Dashboard login. One password, kept in .env only as a hash (DASHBOARD_PASSWORD_HASH, see passwords.js), remembered
// in a signed cookie for 30 days.
// Changing the password signs every device out. With no password set, only this PC (localhost) can open the app.
const COOKIE = "ytw_session";
const MAX_AGE_S = 30 * 24 * 3600;
const PER_IP = { tries: 5, localTries: 50, windowMs: 15 * 60 * 1000 };
const GLOBAL = { tries: 20, windowMs: 60 * 60 * 1000 }; // wrong sign-ins from all addresses together

// Sign-in state that must survive a restart: wrong tries, and the session version ("sign out all devices" bumps it).
const STATE_FILE = path.join(config.rootDir, "data", "security.json");
const LOG_FILE = path.join(config.rootDir, "data", "security.log");
let state = { sessionVersion: 1, fails: [], devices: {} }; // fails: [{ ip, at }]; devices: { id: { name, firstAt, lastAt, ip } }
let stateLost = null;
try {
  state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) };
} catch (err) {
  // A file that exists but can't be read (cut off by a crash) must not bring back sign-ins retired by "Sign out
  // everywhere": start from a session version no old cookie can have, so every device signs in again
  // (code review 2026-10-22, the owner OK'd).
  if (err.code !== "ENOENT") {
    state.sessionVersion = Date.now();
    stateLost = err.message;
  }
}
function saveState() {
  // Temp file then rename, so a crash mid-write leaves the old record whole.
  writeJsonAtomic(STATE_FILE, state, 0);
}
if (stateLost) {
  try {
    saveState();
  } catch {}
}
const clientIp = (req) => String(req.socket.remoteAddress || "").replace(/^::ffff:/, "");

// One line per security event in data/security.log, newest last.
// Tabs and line breaks are taken out of what goes in, so text from a request can't fake or shift a row, and the log
// is trimmed to its last 5,000 lines once it passes about 2 MB (code review 2026-10-22, the owner OK'd).
const oneLine = (s, n) => String(s || "").replace(/[\t\r\n\u0000-\u001f]+/g, " ").slice(0, n);
let logWrites = 0;
export function logSecurity(req, event) {
  const ua = oneLine(req?.headers["user-agent"], 120);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()}\t${req ? clientIp(req) : "-"}\t${oneLine(event, 300)}\t${ua}\n`);
    if (++logWrites % 100 === 1 && fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) {
      keepLastLines(LOG_FILE, 5000);
    }
  } catch {}
}

// Newest-first entries for the dashboard's security log.
export function recentSecurityLog(limit = 50) {
  let lines = [];
  try {
    // Only the end of the file: the newest entries are all that's shown.
    const size = fs.statSync(LOG_FILE).size, from = Math.max(0, size - 256 * 1024);
    const fd = fs.openSync(LOG_FILE, "r");
    const buf = Buffer.alloc(size - from);
    fs.readSync(fd, buf, 0, buf.length, from);
    fs.closeSync(fd);
    lines = buf.toString("utf8").trim().split("\n").slice(from ? 1 : 0).slice(-limit).reverse();
  } catch {}
  return lines.filter(Boolean).map((l) => {
    const [at, ip, event, ua] = l.split("\t");
    return { at, ip, event, device: deviceName(ua || "") };
  });
}

// Security alerts go out even when job alerts are switched off, so a break-in can't silence them.
function securityAlert(title, message, kind = "security") {
  sendAlert({ title, message, tags: [kind === "security" ? "rotating_light" : "key"], priority: 5, kind }).catch((err) => console.warn(`Security alert failed: ${err.message}`));
}

if (stateLost) setTimeout(() => securityAlert("Every device was signed out", `The sign-in record (data/security.json) couldn't be read (${stateLost.slice(0, 120)}), so every device has to sign in again to be safe.`), 15000).unref?.();

// Devices that signed in before: a signed id in their own cookie that's on the list, from the same kind of browser.
const DEVICE_COOKIE = "ytw_device";
function knownDevice(req, ua) {
  const raw = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(`${DEVICE_COOKIE}=`))?.slice(DEVICE_COOKIE.length + 1);
  if (!raw) return null;
  const [id, mac] = raw.split(".");
  if (!id || !mac || mac.length !== sign(`device.${id}`).length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(sign(`device.${id}`)))) return null;
  const d = state.devices?.[id];
  return d && d.name === deviceName(ua) ? id : null;
}

// Admin's device list. Forgetting one means its next sign-in counts as a new device (urgent alert) again.
export function deviceList(req) {
  const mine = knownDevice(req, String(req.headers["user-agent"] || ""));
  return Object.entries(state.devices || {}).map(([id, d]) => ({ id, ...d, thisOne: id === mine })).sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
}
export function forgetDevice(req, id) {
  if (!state.devices?.[id]) throw new Error("That device isn't on the list.");
  const name = state.devices[id].name;
  delete state.devices[id];
  saveState();
  logSecurity(req, `forgot device: ${name}`);
}

function deviceName(ua) {
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "unknown device";
  const br = /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "browser";
  return `${br} on ${os}`;
}

const passwordHash = () => process.env.DASHBOARD_PASSWORD_HASH || "";
// Optional authenticator-app code (DASHBOARD_TOTP_SECRET, made by `npm run 2fa`). Part of the cookie key, so turning
// it on or changing it signs every device out.
const totpSecret = () => (process.env.DASHBOARD_TOTP_SECRET || "").replace(/[\s=]/g, "").toUpperCase();
// The random session key signs cookies; the hash and 2FA key are mixed in so changing either signs every device out.
const key = () => crypto.createHash("sha256").update(`ytw-session:${process.env.DASHBOARD_SESSION_KEY || ""}:${passwordHash()}:${totpSecret()}`).digest();
const sign = (value) => crypto.createHmac("sha256", key()).update(value).digest("base64url");
const sameBytes = (a, b) => crypto.timingSafeEqual(crypto.createHash("sha256").update(a).digest(), crypto.createHash("sha256").update(b).digest());
// "This PC" (no password needed when none is set; the global sign-in pause doesn't apply): a loopback connection that
// names the hub by a loopback name and wasn't forwarded. A forwarder on this PC (Tailscale Serve or Funnel, a tunnel,
// a proxy) also connects from loopback for every outside visitor, but it names the hub differently or adds one of
// these headers (security plan 06).
const FORWARD_HEADERS = ["x-forwarded-for", "x-forwarded-host", "forwarded", "x-real-ip", "cf-connecting-ip", "true-client-ip", "tailscale-user-login", "tailscale-funnel-request", "fly-client-ip", "x-original-forwarded-for"];
export function isLocal(req) {
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket?.remoteAddress)) return false;
  const raw = String(req.headers?.host || "").toLowerCase().trim();
  const host = raw.startsWith("[") ? raw.slice(1, raw.indexOf("]")) : raw.replace(/:\d+$/, "");
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) return false;
  return !FORWARD_HEADERS.some((h) => req.headers?.[h] !== undefined);
}

// Who may reach the app at all, by the connection's own address (never a header, which anyone can fake).
// Default: this PC and Tailscale devices. The home network ("lan" = any private address, which on shared Wi-Fi is
// strangers) is opt-in: DASHBOARD_NETWORKS, or network.networks in the hub settings (src/hub/listen.js). A router port
// opened by mistake still gets nothing, because visitors from the internet arrive with public addresses.
function ipv4ToInt(ip) {
  const p = ip.split(".").map(Number);
  return p.length === 4 && p.every((n) => n >= 0 && n <= 255) ? ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3] : null;
}
const inRange = (ip, base, bits) => {
  const a = ipv4ToInt(ip), b = ipv4ToInt(base);
  return a !== null && (bits === 0 || a >>> (32 - bits) === b >>> (32 - bits));
};
export function networkOf(ip) {
  if (ip === "127.0.0.1" || ip === "::1") return "local";
  if (inRange(ip, "100.64.0.0", 10) || /^fd7a:115c:a1e0:/i.test(ip)) return "tailscale";
  if (inRange(ip, "10.0.0.0", 8) || inRange(ip, "172.16.0.0", 12) || inRange(ip, "192.168.0.0", 16) || /^fe80:/i.test(ip)) return "lan";
  return "internet";
}
const allowedNetworks = () => networksSetting().split(",").map((s) => s.trim().toLowerCase());
const blockedLogged = new Map();
const noteBlocked = (req, ip, what) => {
  if (blockedLogged.size > 1000) blockedLogged.clear();
  if (!blockedLogged.has(ip) || Date.now() - blockedLogged.get(ip) > 3600000) {
    blockedLogged.set(ip, Date.now());
    logSecurity(req, what);
  }
};

// The name the browser used to reach the app (code review 2026-10-22, the owner OK'd). Only this PC's own names and
// plain addresses are answered: a web page whose own name was pointed at this PC ("DNS rebinding") gets nothing,
// even when it runs in a browser on the PC itself. DASHBOARD_HOSTS in .env adds more names, comma separated.
const PC = os.hostname().toLowerCase();
function hostAllowed(req) {
  const raw = String(req.headers.host || "").toLowerCase().trim();
  if (!raw) return false;
  const host = raw.startsWith("[") ? raw.slice(1, raw.indexOf("]")) : raw.replace(/:\d+$/, "");
  if (["localhost", "127.0.0.1", "::1", PC, `${PC}.local`, `${PC}.lan`, `${PC}.home`].includes(host)) return true;
  // Tailscale's own names for this PC (desktop-name.tailnet-name.ts.net); ts.net names are Tailscale's alone.
  if (host.startsWith(`${PC}.`) && host.endsWith(".ts.net")) return true;
  // A plain address (100.x Tailscale, 192.168.x home) can't be re-pointed, so it's fine if its network is allowed.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return allowedNetworks().includes(networkOf(host));
  return (process.env.DASHBOARD_HOSTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).includes(host);
}

export function networkGuard(req, res, next) {
  const ip = clientIp(req);
  const net = networkOf(ip);
  if (!allowedNetworks().includes(net)) {
    noteBlocked(req, ip, `blocked: ${net} address`);
    return res.status(403).type("text").send("Not available from this network.");
  }
  if (!hostAllowed(req)) {
    noteBlocked(req, ip, `blocked: unknown site name ${oneLine(req.headers.host, 80)}`);
    return res.status(403).type("text").send("Not available at this address. Use the PC's name or its Tailscale address.");
  }
  next();
}

function readCookie(req, name = COOKIE) {
  const match = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function validSession(req) {
  const token = readCookie(req);
  if (!token || !passwordHash()) return false;
  const [expires, ver, mac] = token.split(".");
  if (!mac || Number(expires) < Date.now() / 1000 || Number(ver) !== state.sessionVersion) return false;
  return sameBytes(mac, sign(`${expires}.${ver}`));
}

export function checkPassword(value) {
  return verifyPassword(value, passwordHash());
}

// Anything that can make a video public (going live, uploading or approving on a live channel) asks for the password
// again, good for 10 minutes. So a stolen sign-in cookie, or a session someone got into past the 2FA, can look around
// but can't post to the channel without also knowing the password.
const STEP_COOKIE = "ytw_confirmed";
const STEP_S = 10 * 60;
export function passwordConfirmed(req) {
  if (!passwordHash()) return isLocal(req);
  const [expires, ver, mac] = (readCookie(req, STEP_COOKIE) || "").split(".");
  if (!mac || Number(expires) < Date.now() / 1000 || Number(ver) !== state.sessionVersion) return false;
  return sameBytes(mac, sign(`step.${expires}.${ver}`));
}
export function requirePasswordConfirmed(req, res, next) {
  if (passwordConfirmed(req)) return next();
  res.status(403).json({ error: "Enter your password to do this.", needPassword: true });
}

// Content-Security-Policy (security plan 05). Scripts may only be files from this hub, plus the page's own inline
// scripts, allowed by hash (the pages' small import map / start-up script; an injected script has no hash on the list).
// The hash is worked out from the file itself, so editing a page's inline script needs no restart. Styles allow inline
// style attributes (they can't run script). A few one-line event handlers in the markup (a font stylesheet's onload, an
// image's onerror) are allowed by hash too ('unsafe-hashes').
const INLINE_SCRIPT = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
// (the browser hashes the script after turning CRLF line ends into LF, so a Windows checkout must do the same)
const sha256 = (text) => `'sha256-${crypto.createHash("sha256").update(text.replace(/\r\n?/g, "\n")).digest("base64")}'`;
const HANDLER_HASHES = ["this.media='all'", "this.remove()", "this.style.display='none'", `this.outerHTML='<div class="thumb"></div>'`].map(sha256);
const pageHashCache = new Map(); // file -> { mtimeMs, hashes }
export function inlineScriptHashes(file) {
  try {
    const mtimeMs = fs.statSync(file).mtimeMs, hit = pageHashCache.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.hashes;
    const hashes = [...fs.readFileSync(file, "utf8").matchAll(INLINE_SCRIPT)].filter((m) => m[1].trim()).map((m) => sha256(m[1]));
    pageHashCache.set(file, { mtimeMs, hashes });
    return hashes;
  } catch { return []; }
}
const PAGE_PATH = /^\/(?:[\w.-]+\/)*[\w.-]+\.html$/i;
export function contentSecurityPolicy(reqPath = "") {
  const file = PAGE_PATH.test(reqPath) && !reqPath.includes("..") ? path.join(config.publicDir, reqPath) : null;
  const scriptSrc = ["'self'", ...(file ? inlineScriptHashes(file) : []), "'unsafe-hashes'", ...HANDLER_HASHES];
  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    "connect-src 'self' https://api.open-meteo.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}
export function securityHeaders(req, res, next) {
  res.set({
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
  });
  // (an untracked local doll.html under public/ has its own scripts; it gets no policy)
  if (!/\/doll\.html$/.test(req.path)) res.set("Content-Security-Policy", contentSecurityPolicy(req.path));
  res.removeHeader("X-Powered-By");
  next();
}

// Blocks form posts and fetches coming from other websites.
export function sameOrigin(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD") return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  // Browsers send "null" for some form posts; allow that only for the sign-in and sign-out forms. Not "Sign out
  // everywhere": on a hub with no password another website could post it (S9); the hub's own pages send their origin.
  if (origin === "null") return ["/login", "/logout"].includes(req.path) ? next() : res.status(403).json({ error: "Cross-site request blocked" });
  let host = null;
  try {
    host = new URL(origin).host;
  } catch {}
  if (host !== req.headers.host) return res.status(403).json({ error: "Cross-site request blocked" });
  next();
}

export function requireLogin(req, res, next) {
  if (validSession(req)) return next();
  if (!passwordHash() && isLocal(req)) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Sign in first" });
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

// Sign-in captcha: 5 digits drawn as scattered dots (no text in the image for a bot to read), checked before the password.
// Stateless: the answer travels as an HMAC in a hidden field, expires after 5 minutes and works once.
const GLYPHS = {
  2: [" ### ", "#   #", "    #", "   # ", "  #  ", " #   ", "#####"],
  3: ["#####", "   # ", "  #  ", "   # ", "    #", "#   #", " ### "],
  4: ["   # ", "  ## ", " # # ", "#  # ", "#####", "   # ", "   # "],
  5: ["#####", "#    ", "#### ", "    #", "    #", "#   #", " ### "],
  6: ["  ## ", " #   ", "#    ", "#### ", "#   #", "#   #", " ### "],
  7: ["#####", "    #", "   # ", "  #  ", " #   ", " #   ", " #   "],
  8: [" ### ", "#   #", "#   #", " ### ", "#   #", "#   #", " ### "],
  9: [" ### ", "#   #", "#   #", " ####", "    #", "   # ", " ##  "],
};
const usedCaptchas = new Map(); // mac -> expiry, so each challenge works once
const rand = (min, max) => min + crypto.randomInt(0, 10000) / 10000 * (max - min);
const captchaMac = (answer, expires) => sign(`captcha:${answer}:${expires}`);

function newCaptcha() {
  const digits = Array.from({ length: 5 }, () => String(crypto.randomInt(2, 10)));
  const expires = String(Math.floor(Date.now() / 1000) + 300);
  const W = 220, H = 70;
  const shapes = [];
  digits.forEach((d, i) => {
    const ox = 14 + i * 40 + rand(-3, 3), oy = 12 + rand(-5, 5), rot = rand(-12, 12), size = rand(5.6, 6.6);
    const dots = [];
    GLYPHS[d].forEach((row, y) => [...row].forEach((c, x) => {
      if (c === "#") dots.push(`<rect x="${(x * size + rand(-0.9, 0.9)).toFixed(1)}" y="${(y * size + rand(-0.9, 0.9)).toFixed(1)}" width="${(size - 0.8).toFixed(1)}" height="${(size - 0.8).toFixed(1)}" rx="1.5"/>`);
    }));
    shapes.push(`<g fill="#334155" transform="translate(${ox.toFixed(1)} ${oy.toFixed(1)}) rotate(${rot.toFixed(1)} 15 21)">${dots.join("")}</g>`);
  });
  for (let i = 0; i < 45; i++) shapes.push(`<rect fill="#94a3b8" x="${rand(0, W).toFixed(1)}" y="${rand(0, H).toFixed(1)}" width="${rand(2, 4).toFixed(1)}" height="${rand(2, 4).toFixed(1)}" rx="1"/>`);
  for (let i = 0; i < 3; i++) shapes.push(`<path stroke="#94a3b8" stroke-width="${rand(1, 1.8).toFixed(1)}" fill="none" d="M${rand(0, 40).toFixed(0)} ${rand(0, H).toFixed(0)} Q${rand(60, 160).toFixed(0)} ${rand(-20, H + 20).toFixed(0)} ${rand(180, W).toFixed(0)} ${rand(0, H).toFixed(0)}"/>`);
  const order = shapes.sort(() => crypto.randomInt(0, 3) - 1); // mix noise in with the digits
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#f1f5f9"/>${order.join("")}</svg>`;
  return { image: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, token: `${expires}.${captchaMac(digits.join(""), expires)}`, answer: digits.join("") };
}

function checkCaptcha(token, answer) {
  const [expires, mac] = String(token || "").split(".");
  const now = Date.now() / 1000;
  for (const [m, exp] of usedCaptchas) if (exp < now) usedCaptchas.delete(m);
  if (!mac || Number(expires) < now || usedCaptchas.has(mac)) return false;
  usedCaptchas.set(mac, Number(expires));
  return sameBytes(mac, captchaMac(String(answer || "").replace(/\s/g, ""), expires));
}

// RFC 6238 codes (30 s, 6 digits, SHA-1), as Google Authenticator, Microsoft Authenticator and 1Password make them.
function base32(str) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of str) {
    const v = A.indexOf(c);
    if (v < 0) throw new Error("DASHBOARD_TOTP_SECRET isn't valid. Run npm run 2fa for a new one.");
    bits += v.toString(2).padStart(5, "0");
  }
  return Buffer.from((bits.match(/.{8}/g) || []).map((b) => parseInt(b, 2)));
}

export function totpCode(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", base32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}

let lastTotpCounter = 0; // each code works once
function checkTotp(code) {
  const secret = totpSecret();
  if (!secret) return true;
  const typed = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(typed)) return false;
  const now = Math.floor(Date.now() / 30000);
  for (const c of [now - 1, now, now + 1]) {
    if (c > lastTotpCounter && sameBytes(typed, totpCode(secret, c))) {
      lastTotpCounter = c;
      return true;
    }
  }
  return false;
}

function lockedOut(req) {
  const now = Date.now();
  state.fails = state.fails.filter((f) => now - f.at < GLOBAL.windowMs);
  const ip = clientIp(req);
  // At the PC itself (a true "this PC" request) the ceiling is much higher, so a stray local process or a forwarder's
  // visitors can't lock the owner out at the keyboard with five bad posts (S8).
  if (state.fails.filter((f) => f.ip === ip && now - f.at < PER_IP.windowMs).length >= (isLocal(req) ? PER_IP.localTries : PER_IP.tries)) return "Too many wrong tries. Wait 15 minutes.";
  // The global limit doesn't apply at the PC itself, so you can always get back in there.
  if (!isLocal(req) && state.fails.length >= GLOBAL.tries) return "Sign-in is paused for an hour after too many wrong tries. You can still sign in at the PC.";
  return null;
}

export function loginRoutes(app) {
  app.get("/login", (req, res) => res.type("html").send(loginPage(!passwordHash())));

  app.post("/login", async (req, res) => {
    const ip = clientIp(req);
    const locked = lockedOut(req);
    if (locked) return res.status(429).type("html").send(loginPage(false, locked));
    const fail = (message, why) => {
      state.fails.push({ ip, at: Date.now() });
      saveState();
      logSecurity(req, `sign-in failed: ${why}`);
      const nowLocked = lockedOut(req);
      if (nowLocked) {
        logSecurity(req, "sign-in locked");
        securityAlert("Sign-in locked", `Too many wrong sign-in tries on your dashboard, last from ${ip} (${deviceName(String(req.headers["user-agent"] || ""))}). If that wasn't you, run npm run set-password on your PC.`);
      }
      res.status(401).type("html").send(loginPage(!passwordHash(), nowLocked || message));
    };
    if (!checkCaptcha(req.body?.captcha_token, req.body?.captcha)) return fail("The code didn't match. Try the new one.", "puzzle");
    if (!(await checkPassword(req.body?.password))) return fail("Wrong password.", "password");
    if (!checkTotp(req.body?.totp)) return fail("The authenticator code didn't match. Wait for a new one and try again.", "2fa code");
    state.fails = state.fails.filter((f) => f.ip !== ip);
    saveState();
    logSecurity(req, "signed in");
    const ua = String(req.headers["user-agent"] || "");
    // A device that signed in before (its own long-lived device cookie, same browser and system) gets a quiet alert;
    // a new device still gets the urgent one.
    const known = knownDevice(req, ua);
    const id = known || crypto.randomBytes(12).toString("base64url");
    state.devices = { ...state.devices, [id]: { name: deviceName(ua), firstAt: state.devices?.[id]?.firstAt || new Date().toISOString(), lastAt: new Date().toISOString(), ip } };
    // Lax, not strict (the owner OK 2026-10-18): a strict cookie isn't sent when a tab opens from a link in another app
    // (an ntfy alert, a chat), so new tabs looked signed out. Cross-site POSTs are still refused by the same-origin check.
    saveState();
    res.cookie(DEVICE_COOKIE, `${id}.${sign(`device.${id}`)}`, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 365 * 86400 * 1000, path: "/" });
    if (known) securityAlert("Sign-in", `${deviceName(ua)} (a device you've used before) signed in from ${ip} (${networkOf(ip)}).`, "signin_known");
    else securityAlert("New device signed in", `${deviceName(ua)} signed in to your dashboard for the first time, from ${ip} (${networkOf(ip)}). If that wasn't you, open the dashboard and press "Sign out everywhere", then run npm run set-password on your PC.`);
    const expires = String(Math.floor(Date.now() / 1000) + MAX_AGE_S);
    const value = `${expires}.${state.sessionVersion}`;
    res.cookie(COOKIE, `${value}.${sign(value)}`, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: MAX_AGE_S * 1000, path: "/" });
    const next = typeof req.query.next === "string" && /^\/(?!\/)/.test(req.query.next) ? req.query.next : "/campus.html";
    res.redirect(303, next);
  });

  app.post("/logout", (req, res) => {
    logSecurity(req, "signed out");
    res.clearCookie(COOKIE, { path: "/" });
    res.clearCookie(STEP_COOKIE, { path: "/" });
    res.redirect(303, "/login");
  });

  // Signs out every device, including this one, by retiring all existing sign-in cookies.
  app.post("/logout-all", (req, res) => {
    if (!validSession(req) && !(isLocal(req) && !passwordHash())) return res.status(401).type("text").send("Sign in first");
    // Only from the hub's own pages: a browser always names the page's origin on this post (sameOrigin checked it
    // matches); a post with none, or a cross-site one, is refused (S9).
    if (!req.headers.origin || ["cross-site", "same-site"].includes(String(req.headers["sec-fetch-site"] || ""))) return res.status(403).type("text").send("Cross-site request blocked");
    state.sessionVersion += 1;
    state.devices = {}; // after "Sign out everywhere", every device counts as new again
    saveState();
    logSecurity(req, "signed out everywhere");
    res.clearCookie(COOKIE, { path: "/" });
    res.redirect(303, "/login");
  });
}

// Mounted after requireLogin: confirms the password for the risky actions above.
export function confirmPasswordRoutes(app) {
  app.get("/api/confirm-password", (req, res) => res.json({ confirmed: passwordConfirmed(req) }));
  app.post("/api/confirm-password", async (req, res) => {
    const locked = lockedOut(req);
    if (locked) return res.status(429).json({ error: locked });
    if (!(await checkPassword(req.body?.password))) {
      state.fails.push({ ip: clientIp(req), at: Date.now() });
      saveState();
      logSecurity(req, "password confirm failed");
      // A signed-in session guessing the password is the "2FA got bypassed" case, so say so on the first miss.
      securityAlert("Wrong password on a signed-in device", `Someone signed in to your dashboard from ${clientIp(req)} (${deviceName(String(req.headers["user-agent"] || ""))}) typed the wrong password when trying to post. If that wasn't you, press "Sign out everywhere" and run npm run set-password on your PC.`);
      return res.status(401).json({ error: lockedOut(req) || "Wrong password." });
    }
    logSecurity(req, "password confirmed");
    const expires = String(Math.floor(Date.now() / 1000) + STEP_S);
    res.cookie(STEP_COOKIE, `${expires}.${state.sessionVersion}.${sign(`step.${expires}.${state.sessionVersion}`)}`, { httpOnly: true, sameSite: "strict", secure: req.secure, maxAge: STEP_S * 1000, path: "/" });
    res.json({ confirmed: true });
  });
}

export function warnIfNoPassword() {
  if (!passwordHash()) console.warn("Warning: no dashboard password is set, so only this PC can open the app. Run `npm run set-password` to use it from your phone.");
}

import { loginSubtitle } from "./hub/modules.js";
function loginPage(noPassword, error = "") {
  const cap = newCaptcha();
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in · ${ownersHub()}</title><meta name="theme-color" content="#0f0f0e">
<style>body{font-family:system-ui,sans-serif;background:#0f0f0e;color:#f0efec;color-scheme:dark;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;box-sizing:border-box}
form{background:#1a1a19;border:1px solid #2c2c2a;border-radius:12px;padding:24px;width:100%;max-width:340px;display:grid;gap:12px}
input,button{font:inherit;font-size:16px;padding:10px 12px;border-radius:8px;border:1px solid #3a3a37;background:#0f0f0e;color:#f0efec}button{background:#dc2626;color:#fff;border:0;font-weight:600}
.err{color:#fca5a5;font-size:14px;margin:0}.note{color:#9a9890;font-size:14px;margin:0}</style></head><body>
<form method="post"><div style="display:flex;gap:10px;align-items:center"><div style="width:36px;height:36px;border-radius:8px;background:#2c2c2a;display:grid;place-items:center;font-weight:700">⌂</div><div><h1 style="margin:0;font-size:20px">${ownersHub()}</h1><p class="note" style="font-size:13px">${esc(loginSubtitle())}</p></div></div>
${noPassword ? `<p class="note">No password is set yet. On your PC, run <code>npm run set-password</code>, restart the app, then sign in here.</p>` : ""}
${error ? `<p class="err">${esc(error)}</p>` : ""}
<input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
${totpSecret() ? `<input name="totp" placeholder="6-digit code from your authenticator app" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>` : ""}
<img src="${cap.image}" alt="Code to type" width="220" height="70" style="border-radius:8px;border:1px solid #3a3a37;width:100%;height:auto;background:#fff">
<input name="captcha" placeholder="Type the 5 digits above" inputmode="numeric" autocomplete="off" maxlength="5" required>
<input type="hidden" name="captcha_token" value="${cap.token}">
<button>Sign in</button></form></body></html>`;
}
