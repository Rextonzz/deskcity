// The TikTok flag reader (tools/tiktok-flags.mjs): only its pure parts are tested; nothing here opens a browser.
import test from "node:test";
import assert from "node:assert/strict";
import { app } from "./helper.mjs";

const F = await import(app("tools/tiktok-flags.mjs"));

test("no arguments means dry run; only an explicit --read reads", () => {
  assert.deepEqual(F.parseArgs([]), { read: false, dryRun: true, help: false, unknown: [] });
  assert.equal(F.parseArgs(["--read"]).read, true);
  assert.equal(F.parseArgs(["--read"]).dryRun, false);
  assert.equal(F.parseArgs(["--read", "--dry-run"]).read, false, "both flags: the safer one wins");
  assert.deepEqual(F.parseArgs(["--appeal"]).unknown, ["--appeal"]);
});

test("a notice becomes a kind and a reason", () => {
  assert.equal(F.classifyNotice("Your video was removed because it violated our Community Guidelines on Integrity.").kind, "removed");
  assert.equal(F.classifyNotice("This video violates our Community Guidelines. Gambling.").kind, "violation");
  assert.equal(F.classifyNotice("Not eligible for the For You feed").kind, "fyf-ineligible");
  assert.equal(F.classifyNotice("Your account is restricted from posting for 7 days.").kind, "restricted");
  assert.equal(F.classifyNotice("Sound was muted due to copyright.").kind, "music");
  assert.equal(F.classifyNotice("Under review").kind, "under-review");
  assert.deepEqual(F.classifyNotice("Posted Nov 5, 13:00. 0 views"), { kind: "none", reason: "" });
  assert.deepEqual(F.classifyNotice(""), { kind: "none", reason: "" });
  assert.match(F.classifyNotice("Hello there. Your video was removed for spam. You can appeal.").reason, /removed for spam/);
});

test("page text keeps only matching lines, and tokens and emails are scrubbed", () => {
  const r = F.readPageText("Upload\nPosted Nov 5 0 views here\nThis video is not eligible for the For You feed. mail me a@b.co\n" + "x".repeat(40));
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].kind, "fyf-ineligible");
  assert.ok(!r.hits[0].line.includes("a@b.co"));
  assert.ok(!r.head.includes("x".repeat(40)));
  assert.equal(F.summarise([r]).worst, "fyf-ineligible");
  assert.equal(F.summarise([]).worst, "none found");
});

test("the candidate list is only TikTok Studio addresses", () => {
  for (const c of F.CANDIDATES) assert.match(c.url, /^https:\/\/www\.tiktok\.com\/tiktokstudio\//);
});

test("page furniture is never a notice: the copyright footer and navigation labels", () => {
  for (const s of ["Copyright © 2026 TikTok", "© 2026 TikTok", "Royalty-free sounds", "Creator Academy", "Monetization"]) {
    assert.deepEqual(F.classifyNotice(s), { kind: "none", reason: "" }, s);
    assert.equal(F.isBoilerplate(s), true, s);
  }
  const r = F.readPageText("Copyright © 2026 TikTok\nRoyalty-free sounds\nCreator Academy\nMonetization\nPosted Nov 5, 13:00. 0 views");
  assert.deepEqual(r.hits, []);
  assert.ok(!r.head.includes("Copyright"));
});

test("a music or copyright notice needs notice words together with what they are about", () => {
  assert.equal(F.classifyNotice("The sound in your video was muted because of a copyright claim.").kind, "music");
  assert.equal(F.classifyNotice("Copyright claim on this audio.").kind, "music");
  assert.equal(F.classifyNotice("Copyright").kind, "none");
  assert.equal(F.classifyNotice("Copyright 2026 all the best").kind, "none");
});

test("the full text is kept (scrubbed) and per-post rows are read from plain lines", () => {
  const text = "Posts\nStreamer loses it #streamer\nNov 5, 2026\nEveryone\n1.2K\nSecond clip here\nNov 4\nPrivate | Under review\nCopyright © 2026 TikTok";
  const r = F.readPageText(text + "\nmail a@b.co");
  assert.ok(r.fullText.includes("Copyright © 2026 TikTok"), "the full text keeps everything");
  assert.ok(!r.fullText.includes("a@b.co"));
  assert.deepEqual(r.posts, [
    { title: "Streamer loses it #streamer", date: "Nov 5, 2026", status: ["everyone"] },
    { title: "Second clip here", date: "Nov 4", status: ["private", "under review"] },
  ]);
});

test("a final address drops its query string; the hard limit is 3 minutes", () => {
  assert.equal(F.cleanUrl("https://www.tiktok.com/tiktokstudio/home?token=abc#x"), "https://www.tiktok.com/tiktokstudio/home");
  assert.equal(F.LIMIT_MS, 180000);
});
