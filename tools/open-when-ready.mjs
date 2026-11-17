// Used by start.cmd and start.sh: opens the hub in the browser once it answers, then stops. It never reads or prints
// .env (the port comes from hub-env.mjs, which only looks for the PORT line).
//
//   node tools/open-when-ready.mjs            wait for the hub (up to 90 seconds), then open its page
//   node tools/open-when-ready.mjs --port     only print the port the hub uses (PORT in the environment, else .env, else 3000)
//
// DESKCITY_NO_BROWSER=1: do not open a browser; print the address instead (for tests, and for people who do not want it).
import http from "node:http";
import { spawn } from "node:child_process";

let port = Number(process.env.PORT) || 0;
if (!port) {
  try { port = (await import("./hub-env.mjs")).portFromEnvFile() || 0; } catch {}
}
port = port || 3000;
if (process.argv.includes("--port")) { console.log(port); process.exit(0); }

const url = `http://localhost:${port}`;
const answers = () => new Promise((resolve) => {
  const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 1500 }, (res) => { res.resume(); resolve(true); });
  req.on("error", () => resolve(false));
  req.on("timeout", () => { req.destroy(); resolve(false); });
});
const end = Date.now() + 90000;
while (Date.now() < end && !(await answers())) await new Promise((r) => setTimeout(r, 600));
if (Date.now() >= end) process.exit(1); // never came up: say nothing, the hub's own window shows why

if (process.env.DESKCITY_NO_BROWSER === "1") { console.log(`Browser open skipped (DESKCITY_NO_BROWSER=1): ${url}`); process.exit(0); }
const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
const child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true });
child.on("error", () => console.log(`Open ${url} in your browser.`));
child.unref();
console.log(`Opened ${url}`);
