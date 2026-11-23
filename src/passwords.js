// @ts-check
// Dashboard password storage. .env keeps only a scrypt hash (DASHBOARD_PASSWORD_HASH), never the password itself,
// plus a random key for signing sign-in cookies (DASHBOARD_SESSION_KEY). Someone who reads .env or a backup of it
// can't sign in with what they find, and can't forge a cookie without also knowing the session key.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "./config.js";

/** @type {(password: any, salt: any, keylen: number, options?: crypto.ScryptOptions) => Promise<Buffer>} */
const scrypt = promisify(crypto.scrypt);
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }; // about 0.1 s and 32 MB per check
export const ENV_FILE = path.join(config.rootDir, ".env");

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pw.normalize("NFC"), salt, 32, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

// Always does the full scrypt work, even with no hash set, so a wrong guess and a right one take the same time.
export async function verifyPassword(pw, stored) {
  const [kind, N, r, p, salt, hash] = String(stored || "").split("$");
  const ok = kind === "scrypt" && hash;
  const want = ok ? Buffer.from(hash, "base64") : crypto.randomBytes(32);
  const got = await scrypt(String(pw ?? "").normalize("NFC"), ok ? Buffer.from(salt, "base64") : crypto.randomBytes(16), want.length, ok ? { N: Number(N), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem } : PARAMS);
  return Boolean(ok) && typeof pw === "string" && crypto.timingSafeEqual(got, want);
}

// Sets (or, with value null, removes) lines in .env and process.env, keeping every other line as it is.
export function setEnvLines(values) {
  let text = "";
  try {
    text = fs.readFileSync(ENV_FILE, "utf8");
  } catch {}
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text ? text.split(/\r?\n/) : [];
  for (const [name, value] of Object.entries(values)) {
    const i = lines.findIndex((l) => new RegExp(`^\\s*${name}\\s*=`).test(l));
    if (value === null) {
      if (i >= 0) lines.splice(i, 1);
      delete process.env[name];
      continue;
    }
    if (i >= 0) lines[i] = `${name}=${value}`;
    else {
      while (lines.length && lines[lines.length - 1] === "") lines.pop();
      lines.push(`${name}=${value}`, "");
    }
    process.env[name] = value;
  }
  // Temp file then rename, so a crash mid-write can't leave a cut-off .env (it holds the session key and password hash).
  const tmp = `${ENV_FILE}.tmp`;
  fs.writeFileSync(tmp, lines.join(eol));
  fs.renameSync(tmp, ENV_FILE);
}

// At startup: swap a plain DASHBOARD_PASSWORD for its hash, and make the cookie-signing key if there isn't one.
export async function upgradePasswordStorage() {
  const plain = process.env.DASHBOARD_PASSWORD;
  const changes = {};
  if (plain && !process.env.DASHBOARD_PASSWORD_HASH) {
    changes.DASHBOARD_PASSWORD_HASH = await hashPassword(plain);
    if (plain.length < 12) console.warn("Warning: your dashboard password is short. Run `npm run set-password` and pick one with 12+ characters.");
  }
  if (plain !== undefined) changes.DASHBOARD_PASSWORD = null;
  if (!process.env.DASHBOARD_SESSION_KEY) changes.DASHBOARD_SESSION_KEY = crypto.randomBytes(32).toString("base64url");
  if (!Object.keys(changes).length) return;
  setEnvLines(changes);
  if (plain) console.log("Your dashboard password is now stored in .env as a scrambled hash; the plain copy was removed. Every device signs in once more.");
}
