// Reads a video's numbers from its YouTube Studio analytics pages in the pipeline's Chrome.
// Studio has no stable ids for these cards, so values are found by their labels in the page text. Each page's text is
// saved to data/stats/debug so a label YouTube renames can be spotted and added below.
import fs from "node:fs";
import path from "node:path";
import { withPage, YT_SIGNED_OUT } from "./browser.js";
import { sleep } from "../util.js";

const TABS = ["tab-overview", "tab-engagement", "tab-content"];

// Label as Studio shows it -> our field. First match wins.
const LABELS = {
  views: [/^views$/i],
  likes: [/^likes$/i],
  comments: [/^comments( added)?$/i],
  shares: [/^shares$/i],
  subs: [/^subscribers( gained)?$/i, /^subscribers$/i],
  stayed: [/^stayed to watch$/i, /^viewed$/i],
  avgPct: [/^average percentage viewed$/i],
  // Studio's newer "Video analytics" Engagement tab (seen 2026-10-19) has no likes, shares or average % viewed;
  // it shows these instead. avgPct is then worked out from average view duration / the video's length.
  engagedViews: [/^engaged views$/i],
  uniqueViewers: [/^unique viewers$/i],
  watchHours: [/^watch time \(hours\)$/i],
  // The new layout's Reach tab (to-do #18, read since 2026-10-19; labels taken from Studio's usual wording, so check
  // data/stats/debug/*-tab-content.txt after the first pull and adjust if YouTube names them differently).
  impressions: [/^impressions$/i, /^shown in feed$/i],
  ctr: [/^impressions click-through rate$/i, /^click-through rate$/i],
  viewedVsSwiped: [/^viewed \(vs\. swiped away\)$/i, /^viewed vs\.? swiped away$/i],
  returningViewers: [/^returning viewers$/i],
  newViewers: [/^new viewers$/i],
};
const mmss = (s) => {
  const m = String(s).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  return m ? (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] : null;
};

// "1,133" -> 1133, "1.2K" -> 1200, "26.2%" -> 0.262, "+2" -> 2. Returns null for anything else.
function parseNumber(s) {
  const m = String(s).trim().replace(/−/g, "-").match(/^([+-]?[\d,]*\.?\d+)\s*([KMB])?\s*(%)?$/i);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  n *= { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase()] || 1;
  if (m[3]) n /= 100;
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}

export function parseStats(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const out = {};
  for (const [key, pats] of Object.entries(LABELS)) {
    const pct = ["stayed", "avgPct", "ctr", "viewedVsSwiped"].includes(key);
    for (let i = 0; i < lines.length && out[key] == null; i++) {
      if (!pats.some((p) => p.test(lines[i]))) continue;
      for (const next of lines.slice(i + 1, i + 4)) {
        const v = parseNumber(next);
        if (v != null && (!pct || next.includes("%"))) {
          out[key] = v;
          break;
        }
      }
    }
  }
  // Shorts sometimes print it the other way round: "26.2% stayed to watch".
  const stayed = text.match(/([\d.]+)%\s*(?:of viewers\s*)?stayed to watch/i);
  if (out.stayed == null && stayed) out.stayed = Number(stayed[1]) / 100;
  // Average view duration ("0:23") and the video's length (the "0:23" under "Channel content" at the top).
  const at = (re) => lines.findIndex((l) => re.test(l));
  const dur = at(/^average view duration$/i);
  if (dur >= 0) for (const l of lines.slice(dur + 1, dur + 3)) if (mmss(l) != null) { out.avgSeconds = mmss(l); break; }
  const head = at(/^channel content$/i);
  const len = head >= 0 ? mmss(lines[head + 1]) : null;
  if (len) out.lengthSeconds = len;
  if (out.avgPct == null && out.avgSeconds != null && len) out.avgPct = Math.round((out.avgSeconds / len) * 1000) / 1000;
  // Where views came from: "Top traffic sources", "Views", then name / "65.4%" pairs until "See more".
  const ts = at(/^top traffic sources$/i);
  if (ts >= 0) {
    const traffic = {};
    for (let i = ts + 1; i < lines.length - 1 && !/^see more$/i.test(lines[i]); i++) {
      if (/^\d+(\.\d+)?%$/.test(lines[i + 1]) && !/%$/.test(lines[i])) traffic[lines[i]] = Number(lines[i + 1].slice(0, -1)) / 100;
    }
    if (Object.keys(traffic).length) out.traffic = traffic;
  }
  return out;
}

// The switch click starts a page load; Playwright's click waits for it and timed out on a slow switch
// (quick pull 2026-10-20 10:23). So don't wait on the click itself, wait for the page, and try twice.
export async function switchTo(page, channel) {
  let last;
  for (let i = 0; i < 2; i++) {
    try {
      await page.goto("https://www.youtube.com/channel_switcher", { waitUntil: "domcontentloaded" });
      await page.getByText(channel.studioName, { exact: true }).first().click({ noWaitAfter: true, timeout: 20000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
      await sleep(3000);
      return;
    } catch (err) {
      last = err;
      await sleep(2000);
    }
  }
  throw new Error(`Couldn't switch Studio to ${channel.studioName}: ${String(last?.message || last).split("\n")[0]}`);
}

// Studio fills the analytics cards in after the page loads; wait until the numbers are there (up to 20 s).
async function pageText(page) {
  let text = "";
  for (let i = 0; i < 20; i++) {
    text = await page.locator("body").innerText().catch(() => "");
    if (/oops, something went wrong|don.t have permission|access denied/i.test(text)) return text;
    if (/since published/i.test(text) && text.split("\n").length > 40) {
      await sleep(1500); // let the last cards finish
      return await page.locator("body").innerText().catch(() => text);
    }
    await sleep(1000);
  }
  return text;
}
// Old tab link -> the tab's name in the new layout. The old Content tab has no counterpart, so its slot now reads
// the new Reach tab (impressions, click rate, viewed vs swiped away).
const NEW_TABS = { "tab-engagement": "Engagement", "tab-content": "Reach" };

// Clicks a tab in the new layout and waits for its cards to replace the previous tab's (up to 20 s).
async function clickTab(page, name, before) {
  const tab = page.getByRole("tab", { name: new RegExp(`^\\s*${name}\\s*$`, "i") }).first();
  if (await tab.count()) await tab.click().catch(() => {});
  else await page.getByText(name, { exact: true }).first().click({ timeout: 5000 }).catch(() => {});
  let text = "";
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    text = await page.locator("body").innerText().catch(() => "");
    if (text !== before && /since published/i.test(text) && text.split("\n").length > 40) {
      await sleep(1500);
      return await page.locator("body").innerText().catch(() => text);
    }
  }
  return text;
}
const wrongChannel = (text) => /oops, something went wrong|don.t have permission|access denied/i.test(text);

// Every Short on the channel, from Studio's Content > Shorts list (the upload log can be missing some).
// Returns [{ videoId, title, date }]. The list's text is saved to debugDir for tuning.
// A Content list row reads like "0:43 <title> <description> — Public Aug 30, 2026 Published 2,544 1":
// length, then visibility, date, status, views and comments at the end.
export function parseContentRow(text) {
  const out = { date: text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w* \d{1,2}, \d{4}/)?.[0] || "" };
  const len = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})\b/);
  if (len) out.length = (+(len[1] || 0)) * 3600 + +len[2] * 60 + +len[3];
  const end = text.match(/\b(Public|Private|Unlisted|Scheduled|Members only)\b[^—]*?\d{4}\s+\S+\s+([\d,]+)\s+([\d,]+)\s*$/);
  if (end) Object.assign(out, { visibility: end[1], views: +end[2].replace(/,/g, ""), comments: +end[3].replace(/,/g, "") });
  return out;
}

// Every Short on the channel's Content > Shorts list: { videoId, title, date, length, visibility, views, comments }.
/** @param {{ channel: any, debugDir?: string }} o */
export async function listShorts({ channel, debugDir }) {
  return withPage(async (page) => {
    await switchTo(page, channel);
    await page.goto(`https://studio.youtube.com/channel/${channel.channelId}/videos/short`, { waitUntil: "domcontentloaded" });
    if (page.url().includes("accounts.google.com")) throw new Error(YT_SIGNED_OUT);
    const seen = new Map();
    for (let p = 0; p < 30; p++) {
      await page.locator('a[href*="/video/"]').first().waitFor({ timeout: 20000 }).catch(() => {});
      await sleep(2000);
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll('a[href*="/video/"]')].map((a) => {
          const row = a.closest("ytcp-video-row, [role=row], tr") || a.parentElement;
          return { href: a.getAttribute("href"), title: (row?.querySelector("#video-title")?.textContent || a.textContent || "").trim(), text: (row?.innerText || "").replace(/\s+/g, " ").trim() };
        }),
      );
      if (debugDir) fs.appendFileSync(path.join(debugDir, `shorts-${channel.channelId}.txt`), rows.map((r) => `${r.href}\t${r.text}`).join("\n") + "\n");
      for (const r of rows) {
        const id = r.href?.match(/\/video\/([\w-]{11})/)?.[1];
        if (!id || seen.has(id)) continue;
        seen.set(id, { videoId: id, title: r.title || r.text.slice(0, 80), ...parseContentRow(r.text) });
      }
      const next = page.locator("#navigate-after").first();
      if (!(await next.count()) || (await next.getAttribute("aria-disabled")) === "true" || (await next.isDisabled().catch(() => true))) break;
      // Studio's video list can sit over the footer and swallow the click (quick pull failed on it 2026-10-19),
      // so fall back to firing the click on the button itself, then wait for the page's rows to change.
      const firstHref = rows[0]?.href;
      await next.click({ timeout: 8000 }).catch(() => next.dispatchEvent("click"));
      await page.waitForFunction((h) => document.querySelector('a[href*="/video/"]')?.getAttribute("href") !== h, firstHref, { timeout: 15000 }).catch(() => {});
    }
    return [...seen.values()];
  });
}

// Returns { views, likes, comments, shares, subs, stayed, avgPct, engagedViews, uniqueViewers, watchHours, avgSeconds,
// lengthSeconds, traffic } with whatever was found.
// tabs: which analytics pages to open (all by default). timings, if given, gets each page's load time in ms.
export const STAT_TABS = TABS;
export async function readVideoStats({ videoId, channel, debugDir, tabs = TABS, timings = null }) {
  return withPage(async (page) => {
    const found = {};
    // Studio's newer "Video analytics" layout (it shows "Advanced mode") leaves a tab blank when opened by its own
    // link, so there the overview page is opened once and the other tabs are clicked in place.
    let newLayout = false;
    let opened = false;
    let last = "";
    for (const tab of TABS.filter((t) => tabs.includes(t))) {
      const tabStart = Date.now();
      let text;
      if (newLayout && opened) {
        const name = NEW_TABS[tab];
        if (!name) continue;
        text = await clickTab(page, name, last);
      } else {
        const url = `https://studio.youtube.com/video/${videoId}/analytics/${newLayout ? "tab-overview" : tab}/period-default`;
        await page.goto(url, { waitUntil: "domcontentloaded" });
        if (page.url().includes("accounts.google.com")) throw new Error(YT_SIGNED_OUT);
        text = await pageText(page);
        // "Oops, something went wrong" means Chrome is on the other channel's account.
        if (wrongChannel(text)) {
          await switchTo(page, channel);
          await page.goto(url, { waitUntil: "domcontentloaded" });
          text = await pageText(page);
        }
        newLayout = /advanced mode/i.test(text);
        opened = tab === "tab-overview" || !newLayout;
        if (newLayout && tab !== "tab-overview") {
          // Landed on a blank tab of the new layout: start from the overview and click across.
          await page.goto(`https://studio.youtube.com/video/${videoId}/analytics/tab-overview/period-default`, { waitUntil: "domcontentloaded" });
          last = await pageText(page);
          opened = true;
          text = NEW_TABS[tab] ? await clickTab(page, NEW_TABS[tab], last) : last;
        }
      }
      last = text;
      if (debugDir) fs.writeFileSync(path.join(debugDir, `${videoId}-${tab}.txt`), text);
      const got = parseStats(text);
      for (const [k, v] of Object.entries(got)) if (found[k] == null) found[k] = v;
      if (timings) timings.push({ tab, ms: Date.now() - tabStart, fields: Object.keys(got) });
      if (Object.keys(LABELS).every((k) => found[k] != null)) break;
    }
    return found;
  });
}

// Comment text for one video (to-do #18 part 3), from its Studio comments page: [{ text, author, likes, reply }].
// Studio draws each comment as its own element with the text in #content-text; if none show (a changed layout),
// the page text and HTML are saved to debugDir so the selectors can be fixed from one pull.
export async function readComments({ videoId, channel, debugDir, max = 40 }) {
  return withPage(async (page) => {
    const url = `https://studio.youtube.com/video/${videoId}/comments`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    if (page.url().includes("accounts.google.com")) throw new Error(YT_SIGNED_OUT);
    let items = [];
    let unfiltered = false, switched = false;
    for (let i = 0; i < 15 && !items.length; i++) {
      await sleep(1000);
      // Wrong channel first: the filter chip can't be removed from an "Oops" page, and the filter must be cleared again
      // on the real page after the switch.
      if (i >= 2 && !switched && wrongChannel(await page.locator("body").innerText().catch(() => ""))) {
        switched = true;
        await switchTo(page, channel);
        await page.goto(url, { waitUntil: "domcontentloaded" });
        unfiltered = false;
        continue;
      }
      // Studio opens this page filtered to "Response status: Unresponded", which hides every comment the owner already
      // answered (2026-10-23 full pull: 50 videos showed "No comments found" under that filter). Remove the filter
      // chip once. Not yet tried on the real page; if the chip isn't found nothing changes.
      if (!unfiltered && i >= 2) {
        unfiltered = true;
        const removed = await page.evaluate(() => {
          const label = [...document.querySelectorAll("*")].find((el) => el.children.length <= 2 && /^\s*Response status/i.test(el.textContent || "") && (el.textContent || "").length < 60);
          const chip = label?.closest("ytcp-chip, ytcp-chip-bar ytcp-chip, [role='button'], [role='option'], tp-yt-paper-button") || label?.parentElement;
          const x = chip?.querySelector("#delete-icon, #remove-icon, [aria-label*='emove'], [aria-label*='elete'], [aria-label*='lear'], tp-yt-iron-icon:last-of-type, yt-icon:last-of-type, svg");
          if (!x) return false;
          (x.closest("button, [role='button']") || x).dispatchEvent(new MouseEvent("click", { bubbles: true }));
          return true;
        }).catch(() => false);
        if (removed) await sleep(2500);
      }
      items = await page.evaluate((max) => {
        const roots = [...document.querySelectorAll("ytcp-comment, ytcp-comment-thread ytcp-comment, ytd-comment-renderer, ytd-comment-view-model")];
        const seen = new Set();
        const out = [];
        for (const r of roots) {
          const t = r.querySelector("#content-text, yt-formatted-string#content-text, .comment-text")?.innerText?.trim();
          if (!t || seen.has(t)) continue;
          seen.add(t);
          const likes = Number((r.querySelector("#vote-count-middle, #like-count, .like-count")?.innerText || "").replace(/[^0-9]/g, "")) || 0;
          out.push({ text: t.slice(0, 400), author: (r.querySelector("#name, #author-text, .author-text")?.innerText || "").trim().slice(0, 60), likes, reply: Boolean(r.closest("#replies, .replies, ytcp-comment-replies")) });
          if (out.length >= max) break;
        }
        return out;
      }, max).catch(() => []);
    }
    if (!items.length && debugDir) {
      fs.writeFileSync(path.join(debugDir, `${videoId}-comments.txt`), await page.locator("body").innerText().catch(() => ""));
      fs.writeFileSync(path.join(debugDir, `${videoId}-comments.html`), (await page.content().catch(() => "")).slice(0, 2e6));
    }
    return items;
  });
}
