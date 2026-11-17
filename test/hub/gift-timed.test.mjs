// Gifts of timed treats (espresso, slide ride, nap pod, taco on Fridays): free, start at once, one at a time.
import test from "node:test";
import assert from "node:assert/strict";
import { hub, ROOMS, DESKS } from "./helper.mjs";

const { A } = await hub({ rooms: ROOMS, desks: DESKS });

test("a gifted espresso starts at once (no van) and counts as had", () => {
  const line = A.giftPerk({ desk: "game-lead", item: "espresso" });
  assert.equal(line.cost, 0); assert.equal(line.gift, true); assert.equal(line.deliverAt, undefined);
  assert.ok(A.wallets()["game-lead"].owned.includes("espresso"));
  const t = A.texts?.().find?.((x) => x.kind === "gift" && x.to === "game-lead");
  if (t) assert.match(t.text, /Enjoy it now/);
});
test("a second espresso while the first lasts is refused", () => {
  assert.throws(() => A.giftPerk({ desk: "game-lead", item: "espresso" }), /already has/);
});
test("a taco is a Friday treat, gifts included", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-17T15:00:00") }); // a Tuesday
  assert.throws(() => A.giftPerk({ desk: "game-artist", item: "taco" }), /only on Fridays/);
  t.mock.timers.setTime(new Date("2026-11-20T15:00:00").getTime()); // a Friday
  assert.equal(A.giftPerk({ desk: "game-artist", item: "taco" }).item, "taco");
});
test("things to keep still go on the van", () => {
  assert.ok(A.giftPerk({ desk: "game-lead", item: "gnome" }).deliverAt);
});
