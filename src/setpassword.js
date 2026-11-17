// npm run set-password: asks for a new dashboard password (typed hidden, twice) and stores only its hash in .env.
import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { hashPassword, setEnvLines, ENV_FILE } from "./passwords.js";

function ask(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    let value = "";
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\u0003") process.exit(1); // Ctrl+C
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

const pw = await ask("New dashboard password (12+ characters, nothing shows as you type): ");
if (pw.length < 12) {
  console.log("That's under 12 characters. Nothing was changed.");
  process.exit(1);
}
if ((await ask("Type it again: ")) !== pw) {
  console.log("The two didn't match. Nothing was changed.");
  process.exit(1);
}
setEnvLines({ DASHBOARD_PASSWORD_HASH: await hashPassword(pw), DASHBOARD_PASSWORD: null, DASHBOARD_SESSION_KEY: crypto.randomBytes(32).toString("base64url") });
console.log("\nSaved. .env now holds only a scrambled hash of the password, not the password.");

// On Windows, let only your own Windows account open .env (it also holds the Anthropic key and 2FA key).
if (process.platform === "win32") {
  try {
    execFileSync("icacls", [ENV_FILE, "/inheritance:r", "/grant:r", `${process.env.USERNAME}:F`], { stdio: "ignore" });
    console.log(`.env can now only be opened by your Windows account (${process.env.USERNAME}). To undo: icacls .env /reset`);
  } catch {
    console.log("Couldn't limit who can open .env; it still works as before.");
  }
} else {
  try {
    fs.chmodSync(ENV_FILE, 0o600);
    console.log(".env can now only be opened by your own account.");
  } catch {}
}
console.log("Restart the app. Every device is signed out and signs in with the new password.");
