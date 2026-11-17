// Saving a desk needs the dashboard password when it lets the desk spend more real money (deskChangeSpends): a higher
// or removed cap, or a switch to being run by the hub. Lowering a cap, or any other edit, needs none.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { hub, app, ROOMS, DESKS } from "./helper.mjs";

const { A } = await hub({ rooms: ROOMS, desks: DESKS });
const base = { id: "game-artist", room: "game", role: "Pixel artist", provider: "claude", model: "claude-haiku-5-5", status: "active", runner: "hub" };

test("what spends more: a higher or removed cap, a switch to hub-run, a new hub-run or capped desk", () => {
  // game-artist: hub-run, cap $3
  assert.equal(A.deskChangeSpends({ ...base, capUsdMonth: 3 }), false, "same cap");
  assert.equal(A.deskChangeSpends({ ...base, capUsdMonth: 2 }), false, "lower cap");
  assert.equal(A.deskChangeSpends({ ...base, capUsdMonth: 5 }), true, "higher cap");
  assert.equal(A.deskChangeSpends({ ...base, capUsdMonth: "" }), true, "cap removed");
  assert.equal(A.deskChangeSpends({ ...base, capUsdMonth: 3, role: "Lead artist", brief: "draw more" }), false, "other edits");
  // game-lead: Claude Code, no cap, not hub-run
  const lead = { id: "game-lead", room: "game", provider: "claude", model: "claude-code", status: "active", capUsdMonth: "" };
  assert.equal(A.deskChangeSpends(lead), false, "no cap before or after");
  assert.equal(A.deskChangeSpends({ ...lead, runner: "hub" }), true, "switched to hub-run");
  assert.equal(A.deskChangeSpends({ id: "new-one", room: "game", runner: "hub" }), true, "new hub-run desk");
  assert.equal(A.deskChangeSpends({ id: "new-two", room: "game", capUsdMonth: 4 }), true, "new desk with a cap");
  assert.equal(A.deskChangeSpends({ id: "new-three", room: "game" }), false, "new plain desk");
});
test("the route asks for the password only when the change spends more", async () => {
  const express = (await import("express")).default;
  const { agentsRouter } = await import(app("src/routes/agents.js"));
  const web = express(); web.use(express.json()); web.use("/a", agentsRouter);
  const srv = web.listen(0); const port = srv.address().port;
  // (the helper blocks fetch so tests never reach the network; this is a local request with node:http)
  const post = (body) => new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const rq = http.request({ host: "127.0.0.1", port, path: "/a/desk", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, (res) => {
      let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(t || "{}") }));
    });
    rq.on("error", reject); rq.end(data);
  });
  // a hub with a dashboard password (one without trusts this PC itself, so there'd be nothing to ask)
  process.env.DASHBOARD_PASSWORD_HASH = "test-hash";
  try {
    const up = await post({ ...base, capUsdMonth: 9 });
    assert.equal(up.status, 403); assert.equal(up.body.needPassword, true);
    assert.equal(A.roster().desks.find((d) => d.id === "game-artist").capUsdMonth, 3, "nothing saved");
    const down = await post({ ...base, capUsdMonth: 1 });
    assert.equal(down.status, 200);
    assert.equal(A.roster().desks.find((d) => d.id === "game-artist").capUsdMonth, 1);
  } finally { srv.close(); delete process.env.DASHBOARD_PASSWORD_HASH; }
});
