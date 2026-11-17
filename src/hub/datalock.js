// One hub per data folder. A second hub started on the same data/ would run its own timers and write the same files
// as the first (review S3). The hub writes data/hub.lock (pid, start time, port) when it starts; a second hub that finds
// a lock whose process is still running refuses to start and says so. A lock left by a process that is gone (a crash, a
// closed window) is taken over. The lock is removed on a normal exit.
import fs from "node:fs";
import path from "node:path";

export const STALE_MS = 120000, BEAT_MS = 30000;
export const pidAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === "EPERM"; } // EPERM: it exists, we just can't signal it
};

// Takes the lock for `dataDir`, or throws an Error whose message says who holds it. Returns { file, release }.
export function acquireDataLock(dataDir, { pid = process.pid, port = null, alive = pidAlive, now = () => new Date().toISOString() } = {}) {
  const file = path.join(dataDir, "hub.lock");
  fs.mkdirSync(dataDir, { recursive: true });
  const mine = JSON.stringify({ pid, startedAt: now(), port }) + "\n";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(file, mine, { flag: "wx" });
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let held = null;
      try { held = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
      // "Still running" needs both: the process exists AND the lock was touched in the last two minutes (the hub touches
      // it every 30 seconds). A process id alone is not enough: after a reboot or a killed hub, Windows hands the same id
      // to some other program, and the hub would then refuse to start for no reason.
      let fresh = false;
      try { fresh = Date.now() - fs.statSync(file).mtimeMs < STALE_MS; } catch {}
      if (held && held.pid !== pid && alive(held.pid) && fresh) {
        throw new Error(`Another hub is already using this data folder (process ${held.pid}${held.port ? `, port ${held.port}` : ""}, started ${held.startedAt || "at an unknown time"}). Two hubs on one folder would both write the same files and run the same timers. Close that one first (or, if it is not running, delete ${file}).`);
      }
      try { fs.rmSync(file, { force: true }); } catch {} // the holder is gone (or the file is unreadable): take it over
      if (attempt === 2) throw new Error(`Couldn't take the data folder lock (${file}).`);
    }
  }
  // the heartbeat: keeps the lock fresh while this hub runs (never keeps the process alive by itself)
  const beat = setInterval(() => { try { const t = new Date(); fs.utimesSync(file, t, t); } catch {} }, BEAT_MS);
  beat.unref?.();
  const release = () => {
    try {
      const held = JSON.parse(fs.readFileSync(file, "utf8"));
      clearInterval(beat);
      if (held.pid === pid) fs.rmSync(file, { force: true });
    } catch {}
  };
  return { file, release };
}
