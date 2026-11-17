import path from "node:path";
import { chromeProfileDir } from "../util.js";

let contextPromise = null;

// One persistent Chrome profile for YouTube Studio and TCGplayer. the owner signs in to Google in it once, himself.
export async function browserContext() {
  if (!contextPromise) {
    contextPromise = (async () => {
      const { chromium } = await import("playwright");
      const ctx = await chromium.launchPersistentContext(chromeProfileDir(), {
        channel: process.env.PIPELINE_CHROMIUM ? undefined : "chrome",
        executablePath: process.env.PIPELINE_CHROMIUM || undefined,
        headless: process.env.PIPELINE_HEADLESS === "1",
        viewport: { width: 1400, height: 900 },
        args: ["--disable-blink-features=AutomationControlled"],
        // Without this flag Google treats the window as automated and refuses sign-in.
        ignoreDefaultArgs: ["--enable-automation"],
      });
      ctx.on("close", () => (contextPromise = null));
      return ctx;
    })().catch((err) => {
      contextPromise = null;
      // Usually the sign-in window (npm run signin) is still open on the same profile.
      if (/existing browser session|already in use|ProcessSingleton|profile.*in use/i.test(err.message)) throw new Error("The pipeline's Chrome is already open in another window (often the sign-in window from npm run signin). Close that window, then try again.");
      throw err;
    });
  }
  return contextPromise;
}

export async function newPage() {
  const ctx = await browserContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  return page;
}

// Opens a page, runs fn(page, shot), and always closes the page. shot(name) saves `${shotPrefix}-${name}.png` into
// shotsDir (full page when fullPage). When fn throws, a screenshot is taken first (shotFile, else shotsDir's
// `${shotPrefix}-error.png`), then onError(err) runs, then the error is thrown again.
export async function withPage(fn, { shotFile, shotPrefix, shotsDir, fullPage = false, onError } = {}) {
  const page = await newPage();
  const shot = async (name) => (shotsDir ? page.screenshot({ path: path.join(shotsDir, `${shotPrefix}-${name}.png`), fullPage }).catch(() => {}) : undefined);
  try {
    return await fn(page, shot);
  } catch (err) {
    if (shotFile) await page.screenshot({ path: shotFile }).catch(() => {});
    else await shot("error");
    onError?.(err);
    throw err;
  } finally {
    await page.close();
  }
}

// The upload box is how every upload starts: if it isn't there, the page has changed and nothing is picked.
export async function uploadPageCheck(page, what) {
  await page.locator('input[type="file"]').first().waitFor({ state: "attached", timeout: 30000 }).catch(() => {
    throw new Error(`${what}'s upload page has changed: the upload box wasn't where uploads look for it.`);
  });
}

// What every Studio and analytics page says when Chrome's Google sign-in is missing (stats.js stops a pull on "signed in").
export const YT_SIGNED_OUT = "Chrome isn't signed in to YouTube. Open the pipeline's Chrome window, sign in, then retry.";

// Studio work runs one at a time: a stats pull switching channels mid-upload would break the upload.
let studioQueue = Promise.resolve();
export function exclusive(fn) {
  const run = studioQueue.then(fn, fn);
  studioQueue = run.catch(() => {});
  return run;
}
