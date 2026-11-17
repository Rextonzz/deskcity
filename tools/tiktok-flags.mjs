#!/usr/bin/env node
// TikTok flag reader. READ-ONLY.
// Run once for real on 2026-11-16: pages load while signed in; no violation notice was found on the Studio web pages (they may be app-only).
//
//   node tools/tiktok-flags.mjs             dry run (the default): prints the addresses it would open, opens nothing
//   node tools/tiktok-flags.mjs --dry-run   same
//   node tools/tiktok-flags.mjs --read      opens the pipeline's signed-in Chrome profile, visits each address below,
//                                           reads the page text, writes data/tiktok/flags-<date>.json (summary, matching
//                                           lines, final address, per-post rows) and flags-<date>-<n>.txt (each page's full
//                                           visible text, scrubbed), prints a summary, closes Chrome and exits. Hard limit
//                                           3 minutes: then it closes Chrome and exits with code 3.
//
// What I do NOT know (so this file guesses, and says so):
//   - The exact TikTok Studio addresses where violation / restriction / "not eligible for For You" notices live.
//     The CANDIDATES list below is a best guess; a wrong address just yields "page not found" text, which is recorded.
//     /tiktokstudio/inbox showed the same content as home on the real run (probably a redirect): finalUrl records it.
//   - What a notice looks like. Matching is by words in the visible text (classifyNotice), never by CSS selectors,
//     so a redesign should not break it, but the word list is a guess too. Unmatched text is kept raw for a human.
//   - Account-level standing ("Account check" / "Account status") may exist only in the phone app. If so this tool
//     cannot see it and the owner has to paste or screenshot it.
//
// Safety: it only navigates (page.goto), scrolls the page, and reads text. No clicks, no typing, no uploads, no
// deletes, no appeals, no settings. It takes the same in-process `exclusive` Studio lock the uploader uses, and it
// refuses to start while any hub job is running, publishing or posting to TikTok. The in-process lock cannot see
// another process, so also stop the hub's posting first: the pipeline's Chrome profile can only be open once, and
// if the hub holds it the browser start fails with a clear message instead of two things fighting over one profile.
// It prints no cookies, tokens or account identifiers, and the saved text is passed through scrub() first.
import path from "node:path";
import { pathToFileURL } from "node:url";

// Best guesses, in the order they are visited. `why` says what each is for.
export const CANDIDATES = [
  { url: "https://www.tiktok.com/tiktokstudio/content", why: "post list: each post's status text (guess: the posts page used by the stats pull)" },
  { url: "https://www.tiktok.com/tiktokstudio/home", why: "Studio home: banners and account notices (guess)" },
  { url: "https://www.tiktok.com/tiktokstudio/inbox", why: "Studio inbox: system notices (guess)" },
  { url: "https://www.tiktok.com/tiktokstudio/analytics", why: "analytics: sometimes shows a distribution warning (guess)" },
];

// Hard overall limit for a --read run.
export const LIMIT_MS = 180000;

// Pure: argv (without node and script) -> options. Dry run unless --read is given. --read wins over --dry-run only
// if --dry-run is absent: asking for both is treated as a dry run (the safer reading).
export function parseArgs(argv = []) {
  const has = (f) => argv.includes(f);
  const unknown = argv.filter((a) => !["--read", "--dry-run", "--help"].includes(a));
  const read = has("--read") && !has("--dry-run");
  return { read, dryRun: !read, help: has("--help"), unknown };
}

// Pure: page furniture that is never a notice: the copyright footer and navigation labels.
const BOILERPLATE = /^(?:(?:copyright\s*)?(?:©|\(c\))\s*\d{4}(?:\s*[-–]\s*\d{4})?\s*(?:tiktok(?:\s+(?:ltd|inc)\.?)?)?\.?|copyright\s+\d{4}\s+tiktok\.?|royalty-?free sounds|creator academy|monetization|creator (?:tools|resources)|terms of service|privacy policy|help center|all rights reserved\.?)$/i;
export const isBoilerplate = (line) => BOILERPLATE.test(String(line ?? "").replace(/\s+/g, " ").trim());

// Pure: a notice's text -> { kind, reason }. Most serious kind that matches wins.
//   removed | violation | fyf-ineligible | restricted | music | under-review | none
const RULES = [
  ["removed", /\b(video|post|content)\b.{0,40}\b(was|has been|were)\s+removed\b|\bremoved (for|because)\b|\bwe('| ha)ve removed\b/i],
  ["violation", /\bviolat(ed|ion|es|ing)\b|\bcommunity guidelines\b.{0,80}\b(not|isn'?t|doesn'?t|against|break|broke)\b|\bagainst our (community )?guidelines\b/i],
  ["fyf-ineligible", /\b(not|isn'?t|ineligible|no longer)\b.{0,40}\b(eligible|recommended)\b.{0,40}\bfor you\b|\bfor you (feed )?ineligib|\bunoriginal content\b/i],
  ["restricted", /\brestrict(ed|ion)\b|\bsuspend(ed)?\b|\bbanned?\b|\bage-?restricted\b|\bposting (is )?(limited|paused)\b|\bvisibility (is )?limited\b/i],
  // A music/copyright notice needs a notice word (muted, removed, copyright) together with what it is about
  // (video, sound, audio, claim, violation); "Copyright © 2026 TikTok" alone is a footer.
  ["music", /\b(muted|removed|copyright)\b(?=.*\b(videos?|sounds?|audio|claims?|violations?)\b)|\b(videos?|sounds?|audio|claims?|violations?)\b.*\b(muted|removed|copyright)\b|\bsound (was )?(removed|unavailable)\b|\bmusic\b.{0,40}\b(unauthori[sz]ed|not (available|allowed))\b/i],
  ["under-review", /\b(under review|in review|being reviewed|reviewing|processing|pending)\b/i],
];
export function classifyNotice(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t || isBoilerplate(t)) return { kind: "none", reason: "" };
  for (const [kind, re] of RULES) {
    if (!re.test(t)) continue;
    // The reason is the sentence that matched; for a long block, that sentence plus the one after it.
    const sentences = t.split(/(?<=[.!?])\s+/);
    const i = sentences.findIndex((s) => re.test(s));
    const reason = (i >= 0 ? sentences.slice(i, i + 2).join(" ") : t).slice(0, 300);
    return { kind, reason };
  }
  return { kind: "none", reason: "" };
}

// Pure: page text -> blocks worth classifying (lines of 12+ characters, footer and navigation lines skipped), each
// with its classification. Only blocks that matched something are kept, plus the page's first 400 characters raw so a
// human can see what loaded, the whole visible text (scrubbed) to save beside the JSON, and the post rows it can read.
export function readPageText(text) {
  const lines = String(text ?? "").split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length >= 12 && !isBoilerplate(l));
  const hits = [];
  for (const l of lines) {
    const c = classifyNotice(l);
    if (c.kind !== "none") hits.push({ ...c, line: scrub(l).slice(0, 400) });
  }
  return { hits, head: scrub(lines.join(" | ")).slice(0, 400), fullText: scrub(String(text ?? "")), posts: parsePosts(text) };
}

// Pure: the content page's text lines -> [{ title, date, status }]. A post is a short line holding a date ("Nov 5, 2026"
// or "Nov 5"); its title is the nearest earlier real line, its status words are any status word on that line or the
// next two. Rows are guesses from line order, so the full text file is the thing to trust.
const DATE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}(, \d{4})?\b/;
const STATUS = /\b(private|only you|public|everyone|friends|scheduled|draft|under review|processing|pending|removed|muted|restricted|not eligible|violat\w*|copyright)\b/gi;
export function parsePosts(text) {
  const lines = String(text ?? "").split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const rows = [];
  for (let i = 0; i < lines.length && rows.length < 200; i++) {
    const m = lines[i].match(DATE);
    if (!m || lines[i].length > 80) continue;
    let title = "";
    for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
      if (lines[k].length >= 3 && !DATE.test(lines[k]) && !/^[\d.,:%KMB\s]+$/.test(lines[k]) && !isBoilerplate(lines[k])) { title = lines[k]; break; }
    }
    const near = [lines[i], lines[i + 1], lines[i + 2]].filter((l) => l && !isBoilerplate(l)).join(" | ");
    const status = [...new Set((near.match(STATUS) || []).map((x) => x.toLowerCase()))];
    rows.push({ title: scrub(title).slice(0, 150), date: m[0], status });
  }
  return rows;
}

// Pure: an address without its query string or fragment (those can carry tokens), for recording where a page ended up.
export function cleanUrl(u) {
  try {
    const x = new URL(u);
    return x.origin + x.pathname;
  } catch {
    return scrub(String(u ?? "")).slice(0, 200);
  }
}

// Pure: drops anything that looks like a token or an address before text is saved or printed.
export function scrub(s) {
  return String(s ?? "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[long-token]")
    .replace(/\bsessionid[=:]\S+/gi, "[cookie]");
}

export function summarise(pages) {
  const worst = ["removed", "violation", "fyf-ineligible", "restricted", "music", "under-review"];
  const counts = {};
  for (const p of pages) for (const h of p.hits || []) counts[h.kind] = (counts[h.kind] || 0) + 1;
  const top = worst.find((k) => counts[k]);
  return { counts, worst: top || "none found", note: top ? "Matches are word guesses: read the lines in the file before believing them." : "Nothing matched. That does not prove nothing is flagged: the Studio web pages may not show notices at all (they may be app-only)." };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || opts.unknown.length) {
    console.log("Usage: node tools/tiktok-flags.mjs [--dry-run | --read]   (dry run is the default)");
    if (opts.unknown.length) console.log("Unknown: " + opts.unknown.join(" "));
    return;
  }
  console.log(opts.read ? "READ mode: will open the pipeline's Chrome and read pages." : "DRY RUN: nothing will be opened. Pass --read to read for real.");
  for (const c of CANDIDATES) console.log(`  ${c.url}\n    ${c.why}`);
  if (opts.dryRun) return;

  // Everything below starts a browser, so it is imported only now.
  const { listJobs } = await import("../src/pipeline/jobs.js");
  const busy = listJobs().filter((j) => ["running", "publishing"].includes(j.status) || j.data?.tiktok?.status === "posting");
  if (busy.length) {
    console.error(`Refusing to run: ${busy.length} hub job(s) in progress (${busy.slice(0, 3).map((j) => j.id).join(", ")}). Try again when the queue is idle.`);
    process.exitCode = 2;
    return;
  }
  const { withPage, exclusive, browserContext } = await import("../src/pipeline/studio/browser.js");
  const { writeJsonAtomic } = await import("../src/pipeline/files.js");
  const { resolvePath, sleep } = await import("../src/pipeline/util.js");
  const fs = await import("node:fs");

  // Chrome's context stays open until it is closed (the first real run hung for 7 minutes on it), so it is always
  // closed at the end, and a hard time limit closes it and exits non-zero.
  let ctx = null; // only a context this run opened is closed (never start one just to close it)
  const closeBrowser = async () => {
    try {
      if (ctx) await Promise.race([ctx.close(), sleep(10000)]);
    } catch {}
  };
  const timer = setTimeout(async () => {
    console.error(`Time limit (${LIMIT_MS / 1000} s) reached: closing Chrome and stopping.`);
    await closeBrowser();
    process.exit(3);
  }, LIMIT_MS);

  let code = 0;
  try {
    const date = new Date().toISOString().slice(0, 10);
    fs.mkdirSync(resolvePath(path.join("data", "tiktok")), { recursive: true });
    const pages = await exclusive(async () => {
      const out = [];
      ctx = await browserContext();
      for (const [n, c] of CANDIDATES.entries()) {
        try {
          out.push(
            await withPage(async (page) => {
              await page.goto(c.url, { waitUntil: "domcontentloaded" });
              await sleep(6000);
              const finalUrl = cleanUrl(page.url());
              const base = { url: c.url, finalUrl, redirected: finalUrl !== c.url };
              if (/\/login|\/signup/.test(page.url())) return { ...base, status: "signed-out", hits: [], head: "", posts: [] };
              for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 3000); await sleep(1200); } // scrolling only loads more rows
              const text = await page.locator("body").innerText().catch(() => "");
              const { fullText, posts, ...rest } = readPageText(text);
              const textFile = `flags-${date}-${n + 1}.txt`;
              fs.writeFileSync(resolvePath(path.join("data", "tiktok", textFile)), fullText);
              return { ...base, status: "read", ...rest, textFile, ...(/\/content\b/.test(c.url) ? { posts } : {}) };
            }),
          );
        } catch (err) {
          out.push({ url: c.url, status: "error", error: scrub(String(err.message).split("\n")[0]).slice(0, 200), hits: [], head: "" });
        }
      }
      return out;
    });
    const file = resolvePath(path.join("data", "tiktok", `flags-${date}.json`));
    const result = { date, note: "Run once for real on 2026-11-16: pages load while signed in; no violation notice was found on the Studio web pages (they may be app-only).", summary: summarise(pages), pages };
    writeJsonAtomic(file, result, 2);
    console.log(`Wrote ${file}`);
    console.log(JSON.stringify(result.summary, null, 2));
    for (const p of pages) console.log(`  ${p.status.padEnd(10)} ${p.url}${p.redirected ? ` -> ${p.finalUrl}` : ""}  (${p.hits.length} matching line(s)${p.textFile ? `, text in ${p.textFile}` : ""})`);
  } catch (err) {
    console.error(scrub(err.message));
    code = 1;
  } finally {
    clearTimeout(timer);
    await closeBrowser();
  }
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((err) => { console.error(scrub(err.message)); process.exit(1); });
