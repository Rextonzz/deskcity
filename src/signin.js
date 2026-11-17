// Opens plain Chrome (not automated) on the pipeline's own profile so the owner can sign in to Google, YouTube, TikTok and TCGplayer normally.
// The pipeline reuses those sign-ins. Run it while the app is stopped, and close the window when done.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromeProfileDir } from "./pipeline/util.js";

const chrome = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
  .filter(Boolean)
  .map((d) => path.join(d, "Google", "Chrome", "Application", "chrome.exe"))
  .concat(["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome"])
  .find((p) => fs.existsSync(p));
if (!chrome) {
  console.error("Couldn't find Chrome. Install Google Chrome, then run this again.");
  process.exit(1);
}

const profile = chromeProfileDir();
fs.mkdirSync(profile, { recursive: true });
console.log("Opening the pipeline's Chrome. Sign in to YouTube and TikTok (and TCGplayer if you like), then close that window.");
const child = spawn(chrome, [`--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--new-window", "https://studio.youtube.com", "https://www.tiktok.com/tiktokstudio/upload", "https://www.tcgplayer.com"], { stdio: "ignore" });
child.on("exit", () => console.log("Done. Start the app again with: npm start"));
