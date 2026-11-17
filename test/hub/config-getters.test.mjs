// Config getters in util.js (ffmpeg, ffprobe, backup and health hours, backup folder).
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { hub } from "./helper.mjs";

hub();
const { ffmpegCmd, ffprobeCmd, backupHour, healthHour, backupDir } = await import("../../src/pipeline/util.js");

test("defaults when the config names nothing", () => {
  assert.equal(ffmpegCmd({}), "ffmpeg");
  assert.equal(ffprobeCmd({}), "ffprobe");
  assert.equal(backupHour({}), 3);
  assert.equal(healthHour({}), 9);
  assert.match(path.basename(backupDir({})), /-backups$/); // "<hub folder's name>-backups", beside the hub folder
});

test("the config wins, and hour 0 is kept", () => {
  assert.equal(ffmpegCmd({ ffmpeg: "C:/ff/ffmpeg.exe" }), "C:/ff/ffmpeg.exe");
  assert.equal(ffprobeCmd({ ffprobe: "probe" }), "probe");
  assert.equal(backupHour({ backup: { hour: 0 } }), 0);
  assert.equal(healthHour({ health: { hour: 7 } }), 7);
  assert.equal(backupDir({ backup: { dir: "/x/b" } }), path.resolve("/x/b"));
});
