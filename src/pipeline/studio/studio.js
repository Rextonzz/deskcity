// Drives YouTube Studio in the owner's signed-in Chrome profile, following the procedure in session_context_1.md §1.11.
// Selectors are Studio's own element ids; if YouTube changes the page, this is the file to fix.
import { withPage, uploadPageCheck, YT_SIGNED_OUT, exclusive } from "./browser.js";
import { sleep, assertLiveCopy } from "../util.js";
import { switchTo } from "./analytics.js";

async function openStudio(page, channel) {
  const url = `https://studio.youtube.com/channel/${channel.channelId}/videos/upload?d=ud`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await sleep(4000);
  if (page.url().includes("accounts.google.com")) {
    throw new Error(YT_SIGNED_OUT);
  }
  const denied = await page.getByText(/don.t have permission/i).count();
  if (denied) {
    // Brand account switch (session notes: happens most sessions).
    await switchTo(page, channel);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await sleep(4000);
  }
}

async function typeInto(page, box, text) {
  await box.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await page.keyboard.insertText(lines[i]);
    if (i < lines.length - 1) await page.keyboard.press("Enter");
  }
  // Clicking the heading dismisses the hashtag suggestion pop-up (otherwise the next text lands in the wrong box).
  await page.locator("#details-container h1, h1:has-text('Details')").first().click({ force: true }).catch(() => {});
  await sleep(500);
}

// Same calendar day? Studio writes "Oct 20, 2026"; spacing and commas vary.
const dayKey = (t) => {
  const m = String(t || "").match(/([A-Z][a-z]{2})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  return m ? `${m[1]} ${Number(m[2])} ${m[3]}` : null;
};
const timeKey = (t) => String(t || "").replace(/[\s\u202f\u00a0.]/g, "").toUpperCase();

// Sets the schedule date and time, then reads both back. A plain fill() of the date box didn't stick
// (2026-10-19: three a channel and four a channel uploads all kept today's date), so the date is typed
// like a person would, retried, and the upload stops rather than saving the wrong day.
async function pickSchedule(page, labels) {
  const trigger = page.locator("#datepicker-trigger").first();
  if (!(await trigger.isVisible().catch(() => false))) {
    await page.locator("#second-container-expand-button").first().click();
    await sleep(800);
  }
  const want = dayKey(labels.date);
  const shownDate = async () => dayKey(await trigger.innerText().catch(() => ""));
  // "Open" = calendar days showing (the picker element itself can report hidden while its dropdown is open).
  const picker = page.locator("ytcp-date-picker .calendar-day:visible, ytcp-scrollable-calendar:visible").first();
  // Studio's calendar takes a typed date but stays open (2026-10-19), covering the page: then the day itself is
  // clicked inside the right month, which sets the date and closes it.
  const clickDay = async () => {
    const [mon, day, year] = [labels.date.slice(0, 3).toUpperCase(), labels.date.match(/\d{1,2}/)[0], labels.date.slice(-4)];
    // Month headers ("OCT 2026") and day cells; the right cell sits between its month's header and the next one.
    const head = page.locator("ytcp-date-picker").getByText(new RegExp(`^\\s*${mon}[A-Za-z]*\\s+${year}\\s*$`, "i")).first();
    await head.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await sleep(500);
    const heads = [];
    for (const h of await page.locator("ytcp-date-picker").getByText(/^\s*[A-Za-z]{3,9}\s+\d{4}\s*$/).all()) {
      const box = await h.boundingBox().catch(() => null);
      if (box) heads.push({ t: (await h.innerText()).trim().toUpperCase(), y: box.y });
    }
    heads.sort((x, y) => x.y - y.y);
    const i = heads.findIndex((h) => h.t.startsWith(mon) && h.t.endsWith(year));
    if (i < 0) return false;
    const top = heads[i].y - 6, bottom = heads[i + 1] ? heads[i + 1].y - 6 : Infinity;
    for (const d of await page.locator("ytcp-date-picker .calendar-day").filter({ hasText: new RegExp(`^\\s*${day}\\s*$`) }).all()) {
      const box = await d.boundingBox().catch(() => null);
      if (box && box.y >= top && box.y < bottom) {
        await d.click({ timeout: 3000 }).catch(() => d.dispatchEvent("click").catch(() => {}));
        return true;
      }
    }
    return false;
  };
  // First choice: open the calendar and click the day. Fallback: type it into the calendar's box (its click can be
  // covered by the calendar while it scrolls, so that click is forced) and click the day again.
  for (let attempt = 0; attempt < 3 && (await shownDate()) !== want; attempt++) {
    if (!(await picker.isVisible().catch(() => false))) {
      await trigger.click({ timeout: 10000 }).catch(() => trigger.dispatchEvent("click"));
      await sleep(1000);
    }
    if (attempt > 0) {
      const input = page.locator("ytcp-date-picker input:visible, tp-yt-paper-dialog:visible tp-yt-paper-input input:visible").first();
      await input.click({ clickCount: 3, force: true, timeout: 5000 }).catch(() => {});
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Backspace");
      await page.keyboard.type(labels.date, { delay: 40 });
      await sleep(400);
      await page.keyboard.press("Enter");
      await sleep(1200);
    }
    if (await picker.isVisible().catch(() => false)) {
      await clickDay();
      await sleep(1200);
    }
    // Still open: close it without picking anything else.
    if (await picker.isVisible().catch(() => false)) {
      await page.keyboard.press("Tab");
      await sleep(800);
    }
  }
  const got = await shownDate();
  if (got !== want) throw new Error(`Studio's schedule date shows ${got || "nothing"}, not ${labels.date}, so it wasn't saved. Nothing goes out on the wrong day.`);

  // The time field only accepts a choice from its dropdown.
  const timeBox = page.locator("#time-of-day-container input, #time-of-day-container #textbox").first();
  await timeBox.click();
  await page.locator("tp-yt-paper-item").filter({ hasText: new RegExp(`^\\s*${labels.time.replace(/ /g, "\\s*")}\\s*$`) }).first().click();
  await sleep(600);
  const t = (await timeBox.inputValue().catch(() => null)) ?? (await timeBox.innerText().catch(() => ""));
  if (t && timeKey(t) !== timeKey(labels.time)) throw new Error(`Studio's schedule time shows ${t}, not ${labels.time}, so it wasn't saved.`);
  if ((await shownDate()) !== want) throw new Error(`Studio's schedule date changed to ${await shownDate()} after the time was picked, so it wasn't saved.`);
}

// Health check: opens the channel's upload page the way an upload would, and confirms the sign-in and the upload
// box are still there. Picks no file, so nothing is uploaded.
export const studioCheck = (opts) => exclusive(() => studioCheckNow(opts));

async function studioCheckNow({ channel, shot }) {
  return withPage(async (page) => {
    await openStudio(page, channel);
    if (await page.getByText(/don.t have permission/i).count()) throw new Error(`Chrome is signed in, but not to ${channel.studioName}. Switch accounts in the pipeline's Chrome window.`);
    await uploadPageCheck(page, "Studio");
  }, { shotFile: shot });
}

// visibility: "private" | "public" | "schedule"
export const uploadVideo = (opts) => (assertLiveCopy("upload the video"), exclusive(() => uploadVideoNow(opts)));

async function uploadVideoNow({ channel, file, title, description, tags, thumbnail, visibility, scheduleLabels, alteredContent = false, shotsDir }) {
  return withPage(async (page, shot) => {
    await openStudio(page, channel);
    await page.locator('input[type="file"]').first().setInputFiles(file);
    await page.locator("#title-textarea #textbox").waitFor({ timeout: 120000 });
    await sleep(2000);

    await typeInto(page, page.locator("#title-textarea #textbox"), title);
    await typeInto(page, page.locator("#description-textarea #textbox"), description);

    if (thumbnail) {
      const thumbInput = page.locator("#file-loader, ytcp-thumbnails-compact-editor-uploader input[type=file]").first();
      if (await thumbInput.count()) await thumbInput.setInputFiles(thumbnail);
      else console.warn("No thumbnail upload control for this video; left Studio's pick.");
    }

    await page.locator('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]').click();
    await page.locator("#toggle-button").filter({ hasText: /show more/i }).click().catch(() => {});
    await sleep(800);
    await page.locator(`tp-yt-paper-radio-button[name="${alteredContent ? "VIDEO_HAS_ALTERED_CONTENT_YES" : "VIDEO_HAS_ALTERED_CONTENT_NO"}"]`).click().catch(() => {});
    if (tags?.length) {
      const tagInput = page.locator("#tags-container #text-input, ytcp-free-text-chip-bar input").first();
      await tagInput.click();
      await tagInput.fill(tags.join(", "));
      await tagInput.press("Enter");
    }
    await shot("details");

    // Grab the video link before leaving the details page.
    const link = await page.locator("ytcp-video-info a, .video-url-fadeable a").first().getAttribute("href", { timeout: 120000 });
    const videoId = link?.match(/(?:youtu\.be\/|shorts\/|v=)([\w-]{11})/)?.[1];

    for (let i = 0; i < 3; i++) {
      await page.locator("#next-button").click();
      await sleep(1200);
    }

    // the owner chose (2026-10-18) not to wait for YouTube's checks; Studio keeps checking
    // after save. Still stop if an issue is already showing.
    const text = await page.locator("ytcp-uploads-dialog").innerText().catch(() => "");
    if (/copyright-protected content|restrictions? (found|applied)/i.test(text)) {
      await shot("checks");
      throw new Error("YouTube's checks found an issue (copyright or restrictions). Left as a draft in Studio.");
    }

    if (visibility === "schedule") await pickSchedule(page, scheduleLabels);
    else await page.locator(`tp-yt-paper-radio-button[name="${visibility === "public" ? "PUBLIC" : "PRIVATE"}"]`).click();
    await shot("visibility");

    await page.locator("#done-button").click();
    // Studio can answer with "We're still checking your content" and a Got it button. Until it's pressed nothing is
    // saved: on 2026-10-19 five a channel uploads were left as drafts (title = file name) because the page closed
    // on that notice. the owner chose not to wait for the checks, so press Got it, then wait for Studio to confirm.
    await sleep(2500);
    let confirmed = false;
    let scheduleClicks = 0;
    const until = Date.now() + 180000;
    while (!confirmed && Date.now() < until) {
      const got = page.getByRole("button", { name: /^got it$/i });
      if (await got.first().isVisible().catch(() => false)) {
        await shot("checking-notice");
        await got.first().click({ timeout: 10000 }).catch(() => got.first().dispatchEvent("click").catch(() => {}));
        await sleep(2000);
        // Got it only closes the notice; the Schedule button then has to be pressed again.
        const again = page.locator("ytcp-uploads-dialog #done-button");
        if (scheduleClicks < 3 && (await again.isVisible().catch(() => false))) {
          scheduleClicks++;
          await again.click({ timeout: 10000 }).catch(() => again.dispatchEvent("click").catch(() => {}));
          await sleep(2500);
        }
        continue;
      }
      // Studio's confirmations: "Video published/scheduled/saved", or "Video processing ... will be set to public on ...".
      // filter({ visible: true }): the same words also sit in hidden parts of the page, and .first() alone picked a
      // hidden copy, so the shown "Video processing" box was missed (Restaurant Story, 2026-10-19).
      const done = await page.getByText(/video (published|scheduled|saved)|has been (published|scheduled|saved)|will be set to (public|private|unlisted)|video processing|checks complete/i).filter({ visible: true }).first().isVisible().catch(() => false);
      const closed = !(await page.locator("ytcp-uploads-dialog #done-button").filter({ visible: true }).count().catch(() => 1)) && !(await page.getByText(/^saving\.\.\.$/i).filter({ visible: true }).count().catch(() => 1));
      if (done || closed) confirmed = true;
      else await sleep(2000);
    }
    await sleep(2000);
    await shot("done");
    if (!confirmed) throw new Error("Studio never confirmed the video was saved, so it may be left as a draft. Check the screenshots in the job folder.");
    if (!videoId) throw new Error("Uploaded, but couldn't read the video ID from Studio. Check the screenshots.");
    return { videoId };
  }, { shotsDir, shotPrefix: "studio" });
}

// Makes an already-uploaded (private) video public now, or schedules it, from the video's edit page.
// UNTESTED against real Studio: the visibility picker selectors below are the first thing to check if it fails.
export const changeVisibility = (opts) => (assertLiveCopy("change visibility"), exclusive(() => changeVisibilityNow(opts)));

async function changeVisibilityNow({ channel, videoId, visibility, scheduleLabels, shotsDir }) {
  return withPage(async (page, shot) => {
    await openStudio(page, channel); // signs in to the right channel first
    await page.goto(`https://studio.youtube.com/video/${videoId}/edit`, { waitUntil: "domcontentloaded" });
    await sleep(4000);
    await page.locator("ytcp-video-metadata-visibility #select-button, ytcp-video-metadata-visibility").first().click();
    await sleep(1500);
    if (visibility === "schedule") await pickSchedule(page, scheduleLabels);
    else await page.locator('tp-yt-paper-radio-button[name="PUBLIC"]').first().click();
    await shot("picked");
    // The visibility pop-up closes with "Done" in the current Studio (it was "Save" before). Done stays greyed out
    // when nothing changed (the date was already right), so there's nothing to save.
    const doneBtn = page.locator("ytcp-video-visibility-select #save-button:visible, tp-yt-paper-dialog #save-button:visible").or(page.getByRole("button", { name: /^done$/i })).last();
    const greyed = await doneBtn.evaluate((el) => el.disabled || el.getAttribute("aria-disabled") === "true" || el.hasAttribute("disabled") || Boolean(el.closest("[disabled], [aria-disabled='true']"))).catch(() => false);
    if (greyed) {
      await shot("unchanged");
      return { unchanged: true };
    }
    await doneBtn.click();
    await sleep(1500);
    await page.locator("ytcp-button#save, #save").first().click();
    await Promise.race([
      page.getByText(/changes saved/i).first().waitFor({ timeout: 60000 }),
      page.locator("ytcp-button#save[disabled], #save[disabled]").first().waitFor({ state: "attached", timeout: 60000 }),
    ]).catch(() => {});
    await sleep(2000);
    await shot("done");
    const shown = await page.locator("ytcp-video-metadata-visibility").first().innerText().catch(() => "");
    if (visibility === "schedule" && dayKey(shown) && dayKey(shown) !== dayKey(scheduleLabels.date)) throw new Error(`Studio shows it scheduled for ${dayKey(shown)}, not ${scheduleLabels.date}. Check the screenshots.`);
    if (!new RegExp(visibility === "schedule" ? "schedul" : "public", "i").test(shown)) throw new Error(`Studio still shows "${shown.trim().split("\n")[0] || "unknown"}" after saving. Check the screenshots.`);
  }, { shotsDir, shotPrefix: "visibility" });
}

// Posts a comment on a live video and pins it (§1.11 step 11). Scheduled videos can't take comments until live.
export const pinComment = (opts) => (assertLiveCopy("pin the comment"), exclusive(() => pinCommentNow(opts)));

// Every pin up to 2026-10-20 failed: YouTube's watch page comments as whichever channel the browser last used (a
// a channel comment went out as a channel and the reverse), and the comment menu button's id had changed. So the
// channel is switched first and checked before posting, the posted comment is found by its author, and the comment
// is checked to be from the right channel before pinning.
const squash = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
async function pinCommentNow({ videoId, text, channel, shotsDir }) {
  return withPage(async (page, shot) => {
    const me = squash(channel.handle || channel.studioName);
    await switchTo(page, channel);
    await page.goto(`https://www.youtube.com/watch?v=${videoId}`, { waitUntil: "domcontentloaded" });
    await sleep(4000);
    // The video's own channel sees "Edit video" (or Analytics) instead of Subscribe.
    const owner = await page.getByText(/^\s*(Edit video|Analytics)\s*$/).filter({ visible: true }).count();
    if (!owner) {
      await shot("not-owner");
      throw new Error(`YouTube isn't on ${channel.studioName} for this video, so the comment wasn't posted. Pin it yourself, or retry after checking the pipeline Chrome's channel.`);
    }
    await page.mouse.wheel(0, 900);
    await sleep(3000);
    // The comment is matched by its first plain words (emoji show as pictures) among the top comments.
    const words = text.replace(/[^\p{L}\p{N}$ ]+/gu, " ").split(/\s+/).filter(Boolean).slice(0, 3);
    const authorOf = async (t) => squash(await t.locator("#author-text, #header-author a, a[href^='/@']").first().innerText().catch(() => ""));
    const findMine = async () => {
      const threads = page.locator("ytd-comment-thread-renderer");
      for (let i = 0; i < Math.min(await threads.count(), 8); i++) {
        const t = threads.nth(i);
        const body = await t.innerText().catch(() => "");
        if (words.every((w) => body.includes(w))) return t;
      }
      return null;
    };
    // "Pin again": when this channel's comment is already there (an earlier pin that failed), pin that one
    // instead of posting a second copy.
    let mine = await findMine();
    if (mine && (await authorOf(mine)) !== me) mine = null;
    if (!mine) {
      await page.locator("#simplebox-placeholder").click({ timeout: 60000 });
      await page.locator("#contenteditable-root").fill(text);
      await page.locator("#submit-button").click();
      await sleep(4000);
      mine = await findMine();
    }
    if (!mine) throw new Error("Comment posted but couldn't be found on the page to pin. Pin it yourself.");
    const author = await authorOf(mine);
    if (author && author !== me) {
      await shot("wrong-channel");
      throw new Error(`The comment went out as @${author} instead of ${channel.studioName}. Delete it on the video and pin one yourself.`);
    }
    await mine.hover();
    await mine.locator("#action-menu-button, ytd-menu-renderer button, button[aria-label='Action menu']").filter({ visible: true }).first().click({ timeout: 15000 });
    await page.locator("ytd-menu-service-item-renderer, tp-yt-paper-item, yt-list-item-view-model").filter({ hasText: /^\s*Pin\s*$/ }).filter({ visible: true }).first().click({ timeout: 15000 });
    // YouTube asks some channels to verify a phone number before they can pin (a channel, seen 2026-10-24 to 28).
    await sleep(1500);
    if (await page.getByText(/verify your phone number/i).filter({ visible: true }).count()) {
      await shot("needs-phone");
      await page.getByRole("button", { name: /^\s*Cancel\s*$/ }).filter({ visible: true }).first().click({ timeout: 5000 }).catch(() => {});
      throw new Error(`The comment is posted, but YouTube wants ${channel.studioName} to verify a phone number before it can pin comments. Verify it once in YouTube (Settings > Channel > Feature eligibility), then press Pin again.`);
    }
    await page.locator("#confirm-button, yt-button-renderer#confirm-button button").filter({ visible: true }).first().click({ timeout: 15000 });
    await sleep(2500);
    await page.reload({ waitUntil: "domcontentloaded" });
    await sleep(4000);
    await page.mouse.wheel(0, 900);
    await sleep(2000);
    const pinned = await page.getByText(new RegExp(`Pinned by @?${channel.studioName.replace(/\s/g, "")}`, "i")).count();
    await shot("done");
    if (!pinned) throw new Error("Comment posted but the pin couldn't be confirmed. Check the video.");
  }, { shotsDir, shotPrefix: "pin" });
}
