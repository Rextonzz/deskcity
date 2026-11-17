// Posts to TikTok through TikTok Studio's web upload page, in the same signed-in Chrome profile as YouTube Studio.
// (TikTok's API only lets unaudited apps post private videos, so the web page is the way in.) the owner signs in to
// TikTok once with `npm run signin`. UNTESTED against the real page: if TikTok changes it, this is the file to fix.
// Safety: when asked for a private post ("Only you"), it refuses to press Post unless the page shows Only you.
import fs from "node:fs";
import path from "node:path";
import { withPage, uploadPageCheck, exclusive } from "./browser.js";
import { sleep, assertLiveCopy, DEFAULT_TZ } from "../util.js";

const UPLOAD = "https://www.tiktok.com/tiktokstudio/upload?from=webapp";

async function openUpload(page, handle) {
  await page.goto(UPLOAD, { waitUntil: "domcontentloaded" });
  await sleep(5000);
  if (/\/login|\/signup/.test(page.url())) throw new Error("Chrome isn't signed in to TikTok. Run npm run signin (with the app stopped), sign in to TikTok, then retry.");
  if (handle) {
    // The Studio header shows the signed-in account. A blank handle in the settings skips this check.
    const h = handle.replace(/^@/, "");
    const text = await page.locator("body").innerText().catch(() => "");
    if (!new RegExp(`@?${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) {
      const prof = await page.locator('a[href*="/@"]').first().getAttribute("href").catch(() => null);
      if (prof && !prof.toLowerCase().includes(`/@${h.toLowerCase()}`)) throw new Error(`Chrome is signed in to a different TikTok account (${prof.split("/@")[1]?.split(/[/?]/)[0]}), not @${h}. Switch accounts in the pipeline's Chrome window.`);
    }
  }
}

// TikTok Studio pops up one-off dialogs over the upload form (e.g. "Turn on automatic content checks?",
// feature tours). They block every click, so close them: the dismissive button, never one that changes a
// setting ("Turn on"). Seen 2026-10-19: the content checks dialog made the caption click time out.
async function dismissPopups(page) {
  for (let i = 0; i < 4; i++) {
    // Only real dialogs, and only small ones, so a button on the upload form itself (its Cancel/Discard) is never hit.
    const dlg = page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible').filter({ has: page.locator("button") }).last();
    if (!(await dlg.count().catch(() => 0))) return;
    if (((await dlg.innerText().catch(() => "")) || "").length > 800) return;
    const btn = dlg.getByRole("button", { name: /^(cancel|not now|got it|skip|close|maybe later|dismiss|ok)$/i }).first();
    if (await btn.count().catch(() => 0)) await btn.click({ timeout: 5000 }).catch(() => {});
    else await dlg.locator('button[aria-label*="close" i], [class*="close" i]').first().click({ timeout: 5000 }).catch(() => page.keyboard.press("Escape"));
    await sleep(800);
  }
}

// Health check: the upload page opens signed in and the file box is there. Uploads nothing.
export const tiktokCheck = (opts) => exclusive(() => tiktokCheckNow(opts));

async function tiktokCheckNow({ handle, shot }) {
  return withPage(async (page) => {
    await openUpload(page, handle);
    await uploadPageCheck(page, "TikTok Studio");
  }, { shotFile: shot });
}

// privacy: "private" (Only you) | "public" (Everyone)
export const postTikTok = (opts) => (assertLiveCopy("post to TikTok"), exclusive(() => postTikTokNow(opts)));

// scheduleAt (ISO) + tz: schedule the post in TikTok Studio instead of posting now (public posts only, 15 min to
// 10 days ahead). If the schedule can't be set and read back, it throws a "schedule" error and nothing is posted.
async function postTikTokNow({ handle, file, caption, privacy, shotsDir, scheduleAt = null, tz = DEFAULT_TZ }) {
  let pressed = false;
  return withPage(async (page, shot) => {
    await openUpload(page, handle);
    await page.locator('input[type="file"]').first().setInputFiles(file);

    // The caption box (a rich-text editor) appears once the file is accepted.
    const editor = page.locator('.public-DraftEditor-content, div[contenteditable="true"]').first();
    await editor.waitFor({ timeout: 180000 });
    await sleep(2000);
    // The whole caption goes in at once: typing it word by word let the editor jump the cursor and scramble it
    // (2026-10-19: "With Receipts 📊 LudwigBACKS Reeves"). Escape closes any hashtag suggestion list.
    // The editor sometimes isn't ready yet and drops the text (2026-10-19 17:44: box stayed empty), so it's
    // read back and tried again, the last time with Playwright's fill.
    const firstWords = caption.trim().split(/\s+/).slice(0, 3).join(" ");
    let typed = "";
    for (let i = 0; i < 4; i++) {
      await dismissPopups(page);
      await editor.click();
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Delete");
      if (i < 3) await page.keyboard.insertText(caption.trim());
      else await editor.fill(caption.trim()).catch(() => {});
      await sleep(800);
      await page.keyboard.press("Escape");
      typed = ((await editor.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
      if (typed.startsWith(firstWords)) break;
      await sleep(2500);
    }
    if (!typed.startsWith(firstWords)) throw new Error(`TikTok's caption box shows "${typed.slice(0, 80)}" instead of the caption, so nothing was posted.`);
    await page.mouse.click(5, 5);
    await sleep(800);

    await dismissPopups(page);
    await setPrivacy(page, privacy);
    if (scheduleAt && privacy !== "private") await setSchedule(page, new Date(scheduleAt), tz, shot, shotsDir);
    await shot("details");

    // Wait for the upload to finish: Post is disabled until then.
    const post = page.locator('button[data-e2e="post_video_button"], button:has-text("Post"):not(:has-text("Posts")), button:text-is("Schedule")').last();
    const until = Date.now() + 600000;
    while ((await post.isDisabled().catch(() => true)) && Date.now() < until) await sleep(2000);
    if (await post.isDisabled().catch(() => true)) throw new Error("TikTok didn't finish taking the video within 10 minutes. Nothing was posted.");

    // Check once more right before posting: a private post must never go out public.
    await dismissPopups(page);
    if (privacy === "private" && !(await showsOnlyYou(page))) throw new Error("Couldn't confirm the post was set to Only you, so it wasn't posted. Check the screenshots.");
    pressed = true;
    await post.click();
    await sleep(3000);
    // TikTok sometimes asks to confirm while its content check is still running.
    await page.getByRole("button", { name: /^post now$/i }).first().click({ timeout: 5000 }).catch(() => {});
    await Promise.race([
      page.getByText(/your video (has been|is being) (uploaded|posted)|video published|manage your posts/i).first().waitFor({ timeout: 120000 }),
      page.waitForURL(/tiktokstudio\/content/, { timeout: 120000 }),
    ]).catch(() => {});
    await sleep(3000);
    await shot("done");

    // The newest post's link, from the content list.
    let url = null;
    try {
      if (!/tiktokstudio\/content/.test(page.url())) await page.goto("https://www.tiktok.com/tiktokstudio/content", { waitUntil: "domcontentloaded" });
      await sleep(5000);
      const href = await page.locator('a[href*="/video/"]').first().getAttribute("href", { timeout: 20000 });
      url = href ? new URL(href, "https://www.tiktok.com").href : null;
    } catch {}
    return { url };
    // Past the Post button, it may be on TikTok: the caller must not post it again by itself (stress test 2026-10-23).
  }, { shotsDir, shotPrefix: "tiktok", fullPage: true, onError: (err) => { if (pressed) err.afterPost = true; } });
}

// TikTok Studio's "When to post": Now / Schedule, then a date and a time box. Fills both, reads them back, and throws
// (before anything is posted) if they don't show the wanted day and time. UNTESTED against the real page.
async function setSchedule(page, when, tz, shot, shotsDir) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(when).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`, time = `${parts.hour}:${parts.minute}`;
  // The "When to post" radios are inputs valued post_now / schedule (seen 2026-10-19). The first try clicked the
  // label and then dismissPopups pressed Cancel on whatever opened, which left "Now" on. So: click the radio itself,
  // and if a dialog opens, accept it (never "Turn on": that one is the automatic content checks offer), then check the radio really is on.
  const input = page.locator('input[type="radio"][value="schedule"]').first();
  const label = page.getByText(/^\s*schedule\s*$/i).filter({ visible: true }).first();
  if (!(await input.count().catch(() => 0)) && !(await label.isVisible().catch(() => false))) throw new Error("Couldn't find TikTok's schedule option, so nothing was posted (schedule).");
  const isOn = () => input.isChecked().catch(() => false);
  let dialogText = "";
  for (let i = 0; i < 3 && !(await isOn()); i++) {
    if (i === 0 && (await label.isVisible().catch(() => false))) await label.click({ timeout: 5000 }).catch(() => {});
    else await input.check({ force: true, timeout: 5000 }).catch(() => input.dispatchEvent("click"));
    await sleep(1500);
    const dlg = page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible').filter({ has: page.locator("button") }).last();
    if (await dlg.count().catch(() => 0)) {
      dialogText = ((await dlg.innerText().catch(() => "")) || "").replace(/\s+/g, " ").slice(0, 200);
      await shot("schedule-dialog");
      const yes = dlg.getByRole("button", { name: /^(allow|continue|confirm|ok|got it|yes)$/i }).first();
      if (await yes.count().catch(() => 0)) await yes.click({ timeout: 5000 }).catch(() => {});
      await sleep(1200);
    }
  }
  if (!(await isOn())) {
    await shot("schedule");
    throw new Error(`TikTok's Schedule option wouldn't stay on${dialogText ? ` (it showed: "${dialogText}")` : ""}, so nothing was posted (schedule).`);
  }
  await sleep(1000);
  // The two boxes sit just under the radio; TikTok has used plain inputs holding "2026-10-20" and "16:00".
  const boxes = page.locator('input:not([type="radio"]):not([type="checkbox"]):not([type="file"])').filter({ visible: true });
  const values = async () => (await boxes.evaluateAll((els) => els.map((e) => e.value))).join(" | ");
  const findBox = async (re) => {
    const n = await boxes.count();
    for (let i = 0; i < n; i++) if (re.test(await boxes.nth(i).inputValue().catch(() => ""))) return boxes.nth(i);
    return null;
  };
  // Each box opens a picker when clicked. The boxes are readonly inputs (readonly="", which getAttribute reads as an
  // empty string, so the first version wrongly tried to type into them and the time never changed, 2026-10-19).
  // Picker cells are found by their exact text among elements that appeared after the click; for the time, the hour
  // is the leftmost match (hour column) and the minute the rightmost (minute column).
  const cellsFor = (text) =>
    page.evaluate((t) => {
      const out = [];
      for (const m of document.querySelectorAll("[data-ttcell]")) m.removeAttribute("data-ttcell");
      for (const el of document.querySelectorAll("body *")) {
        if (el.children.length || el.textContent.trim() !== t || el.closest("[data-ttpre]")) continue;
        const target = el.closest("li, td, button, [role=option], [class*=option], [class*=item], [class*=cell], [class*=day]") || el;
        const cls = (target.className?.baseVal ?? target.className ?? "") + " " + (el.className?.baseVal ?? el.className ?? "");
        const r = target.getBoundingClientRect();
        const st = getComputedStyle(target);
        if (!r.width || !r.height || st.visibility === "hidden" || st.display === "none") continue;
        if (/disabled|prev-month|next-month|other-month|outside/i.test(cls) || target.getAttribute("aria-disabled") === "true") continue;
        const id = `ttc${out.length}`;
        target.setAttribute("data-ttcell", id);
        out.push({ id, left: r.x, top: r.y, valid: /\bvalid\b/.test(cls) && !/\binvalid\b/.test(cls) });
      }
      return out;
    }, text);
  const clickCell = async (text, which = "first") => {
    let c = await cellsFor(text);
    if (!c.length && /^0\d$/.test(text)) c = await cellsFor(String(Number(text)));
    if (!c.length) return false;
    // Calendar days: the month view also shows greyed days from the months either side ("day" vs "day valid",
    // 2026-10-19: Oct 27 clicked September's 27). Prefer valid days; else a high day number is the lower one on the
    // grid and a low one the upper one.
    if (which === "day") {
      if (c.some((x) => x.valid)) c = c.filter((x) => x.valid);
      c.sort((a, b) => (Number(text) >= 15 ? b.top - a.top : a.top - b.top));
    }
    const one = which === "right" ? c.sort((a, b) => b.left - a.left)[0] : which === "left" ? c.sort((a, b) => a.left - b.left)[0] : c[0];
    // Cells further down a scrolling column are clipped: bring the chosen one into view, then click it.
    const cell = page.locator(`[data-ttcell="${one.id}"]`).last();
    await cell.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await cell.click({ timeout: 3000 }).catch(() => cell.dispatchEvent("click"));
    await sleep(500);
    return true;
  };
  const dump = async (name) => {
    await shot(name);
    const html = await page.evaluate(() => [...document.querySelectorAll("body > div, [class*=picker], [class*=calendar], [class*=dropdown], [role=listbox], [role=dialog]")].map((e) => e.outerHTML).join("\n").slice(-60000)).catch(() => "");
    try {
      fs.writeFileSync(path.join(shotsDir, `tiktok-${name}.html`), html);
    } catch {}
  };
  // Anything already on screen before a picker opens (the form, the side menu) is never a picker cell.
  const markPage = () =>
    page.evaluate(() => {
      for (const el of document.querySelectorAll("body *")) {
        if (el.children.length) continue;
        const r = el.getBoundingClientRect();
        if (r.width && r.height) el.setAttribute("data-ttpre", "");
      }
    }).catch(() => {});
  const open = async (box) => {
    await markPage();
    await box.click({ timeout: 5000 }).catch(() => box.dispatchEvent("click"));
    await sleep(900);
  };
  const close = async () => {
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(300);
    await page.mouse.click(5, 5);
    await sleep(600);
  };
  const dateBox = await findBox(/^\d{4}-\d{2}-\d{2}$/);
  if (dateBox && (await dateBox.inputValue().catch(() => "")) !== date) {
    await open(dateBox);
    // Move the calendar on by as many months as the wanted date is past the box's current one (the read-back below
    // catches a wrong guess before anything is posted).
    const cur = (await dateBox.inputValue().catch(() => "")).split("-").map(Number);
    const ahead = cur.length === 3 ? Number(parts.year) * 12 + Number(parts.month) - (cur[0] * 12 + cur[1]) : 0;
    for (let i = 0; i < ahead && i < 2; i++) {
      const next = page.locator('[class*="arrow"]:visible, [class*="next"]:visible, [aria-label*="next" i]:visible').last();
      await next.click({ timeout: 3000 }).catch(() => {});
      await sleep(500);
    }
    await dump("schedule-date-open");
    await clickCell(String(Number(parts.day)), "day");
    await close();
  }
  const timeBox = await findBox(/^\d{1,2}:\d{2}$/);
  if (timeBox && (await timeBox.inputValue().catch(() => "")) !== time) {
    await open(timeBox);
    await dump("schedule-time-open");
    await clickCell(parts.hour, "left");
    if ((await cellsFor(parts.minute)).length === 0) await open(timeBox);
    await clickCell(parts.minute, "right");
    await close();
  }
  const shown = await values();
  await shot("schedule");
  if (!shown.includes(date) || !shown.includes(time)) throw new Error(`TikTok's schedule shows "${shown.slice(0, 80)}" instead of ${date} ${time}, so nothing was posted (schedule).`);
}

async function showsOnlyYou(page) {
  const text = await page.locator(':text-matches("who can (watch|view|see)", "i")').first().locator("xpath=ancestor::*[self::div][2]").innerText().catch(() => "");
  return /only you|only me|private/i.test(text) && !/\bEveryone\b/.test(text);
}

async function setPrivacy(page, privacy) {
  const want = privacy === "private" ? /^\s*(Only you|Only me|Private)\s*$/i : /^\s*Everyone\s*$/i;
  const label = page.locator(':text-matches("who can (watch|view|see)", "i")').first();
  // It sits low on the form and can be folded under "Show more" / settings, and the page renders it lazily.
  // TikTok Studio labels it "Who can see this post" (seen 2026-10-19); older layouts said "Who can watch".
  for (let i = 0; i < 12 && !(await label.isVisible().catch(() => false)); i++) {
    const more = page.getByText(/^(show more|more options|advanced settings)$/i);
    for (const m of await more.all().catch(() => [])) if (await m.isVisible().catch(() => false)) await m.click({ timeout: 3000 }).catch(() => {});
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, 700);
    await sleep(600);
  }
  await label.waitFor({ timeout: 10000 }).catch(() => {
    throw new Error("Couldn't find TikTok's \"Who can watch\" setting. Nothing was posted.");
  });
  label.scrollIntoViewIfNeeded().catch(() => {});
  // The setting is a dropdown just after its label: open it, then pick the option.
  const area = label.locator("xpath=ancestor::*[self::div][2]");
  const current = await area.innerText().catch(() => "");
  const already = privacy === "private" ? /only you|only me|private/i.test(current) && !/\bEveryone\b/.test(current) : /\bEveryone\b/.test(current);
  if (already) return;
  await area.locator('[role="combobox"], select, button, .Select__trigger, [class*="select"]').first().click();
  await sleep(800);
  const native = area.locator("select").first();
  if (await native.count()) {
    const opts = await native.locator("option").allInnerTexts();
    const pick = opts.find((o) => want.test(o));
    if (pick) await native.selectOption({ label: pick });
  } else {
    await page.locator('[role="option"], [role="menuitem"], li, [class*="option"]').filter({ hasText: want }).first().click();
  }
  await sleep(800);
}

// Every post on the account with its numbers, from TikTok Studio's Posts list, for the TikTok stats page. Runs inside
// a stats pull (already in the Studio queue), so it isn't wrapped in exclusive(). Two ways in, best first: the JSON the
// page loads its list from (any object with a post id and a play count), else the list's text. Both are saved to
// debugDir for tuning. UNTESTED against the real page.
// Returns [{ postId, url, caption, date, views, likes, comments, shares, saves }].
export async function listTikTokPosts({ handle, debugDir }) {
  const fromJson = new Map();
  const dumps = [];
  const num = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const walk = (o, depth = 0) => {
    if (!o || typeof o !== "object" || depth > 8) return;
    if (Array.isArray(o)) return o.forEach((x) => walk(x, depth + 1));
    const id = o.item_id || o.itemId || o.aweme_id || o.awemeId || o.id || o.video_id;
    const stats = o.statistics || o.stats || o.metrics || o;
    const plays = stats.play_count ?? stats.playCount ?? stats.view_count ?? stats.viewCount ?? stats.vv;
    if (id && /^\d{15,}$/.test(String(id)) && plays != null) {
      fromJson.set(String(id), {
        postId: String(id),
        caption: o.desc || o.description || o.title || o.caption || "",
        date: o.create_time || o.createTime ? new Date(Number(o.create_time || o.createTime) * 1000).toISOString() : null,
        views: num(plays),
        likes: num(stats.digg_count ?? stats.diggCount ?? stats.like_count ?? stats.likeCount),
        comments: num(stats.comment_count ?? stats.commentCount),
        shares: num(stats.share_count ?? stats.shareCount),
        saves: num(stats.collect_count ?? stats.collectCount ?? stats.favorite_count ?? stats.favoriteCount),
      });
    }
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v, depth + 1);
  };
  return withPage(async (page) => {
    page.on("response", async (res) => {
      if (!/tiktok\.com/.test(res.url()) || !/json/.test(res.headers()["content-type"] || "")) return;
      try {
        const body = await res.json();
        const before = fromJson.size;
        walk(body);
        if (fromJson.size > before) dumps.push(res.url().split("?")[0]);
      } catch {}
    });
    await openUpload(page, handle); // same sign-in and account checks as posting
    await page.goto("https://www.tiktok.com/tiktokstudio/content", { waitUntil: "domcontentloaded" });
    await sleep(6000);
    // The list loads more as it scrolls.
    let last = -1;
    for (let i = 0; i < 40; i++) {
      const count = await page.locator('a[href*="/video/"]').count();
      if (count === last && i > 3) break;
      last = count;
      await page.mouse.wheel(0, 4000);
      await sleep(1500);
    }
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('a[href*="/video/"]')].map((a) => {
        const row = a.closest('[role="row"], tr, [class*="row"], [class*="Row"], [class*="item"]') || a.parentElement;
        return { href: a.href, text: (row?.innerText || "").replace(/\s+/g, " ").trim() };
      }),
    );
    if (debugDir) {
      const fs = await import("node:fs");
      fs.writeFileSync(path.join(debugDir, "tiktok-posts.txt"), `JSON from: ${dumps.join(", ") || "none"}\n\n` + rows.map((r) => `${r.href}\t${r.text}`).join("\n"));
    }
    const parseN = (s) => {
      const m = String(s).match(/^([\d.,]+)\s*([KMB])?$/i);
      return m ? Math.round(Number(m[1].replace(/,/g, "")) * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase()] || 1)) : null;
    };
    const out = new Map();
    for (const r of rows) {
      const postId = r.href.match(/\/video\/(\d+)/)?.[1];
      if (!postId || out.has(postId)) continue;
      const j = fromJson.get(postId);
      if (j) {
        out.set(postId, { ...j, url: r.href });
        continue;
      }
      // Text fallback: the list ends each row with views, likes, comments.
      const nums = r.text.split(" ").map(parseN).filter((n) => n != null);
      const [views, likes, comments] = nums.slice(-3);
      out.set(postId, { postId, url: r.href, caption: r.text.slice(0, 150), date: r.text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w* \d{1,2}(, \d{4})?/)?.[0] || null, views: views ?? null, likes: likes ?? null, comments: comments ?? null, shares: null, saves: null, fromText: true });
    }
    // Posts the JSON had that the visible list didn't link (it can virtualise long lists).
    for (const [id, j] of fromJson) if (!out.has(id)) out.set(id, { ...j, url: `https://www.tiktok.com/video/${id}` });
    return [...out.values()];
  });
}
