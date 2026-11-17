// The part restore-test.mjs and self-check.mjs share: start the real server from an app folder against a throwaway data
// root, with nothing that could spend money or reach out, ask it questions, and stop it by its process id.
// Neither tool ever uses port 3000 (the live hub) and neither reads a .env or a token file.
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";

export const SECRET_ENV = /(_KEY|_TOKEN|_SECRET|PASSWORD|TOTP|NTFY|DASHBOARD_|^ANTHROPIC|^GEMINI|^OPENAI|^XAI)/i;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const portFree = (port) => new Promise((res) => {
  const s = net.createServer();
  s.once("error", () => res(false));
  s.once("listening", () => s.close(() => res(true)));
  s.listen(port, "127.0.0.1");
});

// A port nobody is using, asked from the system (for tools that have no fixed port).
export const sparePort = () => new Promise((res) => {
  const s = net.createServer();
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
});

export function stopPid(pid) {
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(pid, "SIGTERM");
  } catch {}
}

// The environment a throwaway hub gets: this one, minus every key, token, secret and password, plus the switches that
// turn off the pipeline, the local runner, the chatter, the selves and the helpers.
export function safeEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!SECRET_ENV.test(k) && !/^HUB_(TEST|DEMO|BACKUP)/.test(k)) env[k] = v;
  return Object.assign(env, { PIPELINE_DISABLED: "1", AGENTS_LOCAL_RUNNER: "off", AGENTS_CHATTER: "off", AGENTS_SELVES: "off", HUB_HELPERS: "off", HUB_LISTEN: "local" }, extra);
}

// Starts `node server.js` from appDir with its data at `root` (HUB_TEST_ROOT). `noEnv` is a path that does not exist, so the
// app's own .env is never read. Returns { child, base, get, waitUp, stop, output, exited }.
export function bootHub({ appDir, root, port, settingsFile, noEnv }) {
  const env = safeEnv({ HUB_TEST_ROOT: root, HUB_TEST_SETTINGS: settingsFile, DOTENV_CONFIG_PATH: noEnv, PORT: String(port) });
  const child = spawn(process.execPath, ["server.js"], { cwd: appDir, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let serverLog = "", exited = null;
  child.stdout.on("data", (d) => (serverLog = (serverLog + d).slice(-4000)));
  child.stderr.on("data", (d) => (serverLog = (serverLog + d).slice(-4000)));
  child.on("exit", (code) => (exited = code));
  const base = `http://127.0.0.1:${port}`;
  const get = async (p) => { const r = await fetch(base + p, { signal: AbortSignal.timeout(15000) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, json: j, text: t }; };
  const waitUp = async () => {
    for (let i = 0; i < 120 && exited === null; i++) {
      try { await get("/api/hub/settings"); return true; } catch { await sleep(500); }
    }
    return false;
  };
  const stop = async () => {
    if (child.pid) stopPid(child.pid);
    let free = false;
    for (let i = 0; i < 20 && !free; i++) { free = await portFree(port); if (!free) await sleep(500); }
    return free;
  };
  return { child, base, get, waitUp, stop, output: () => serverLog, exited: () => exited };
}
