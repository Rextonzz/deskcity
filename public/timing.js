// Time so far / time left for anything that takes a while. Plain script (not a module) so every page can use it.
(function () {
  const dur = (ms) => {
    if (ms == null || isNaN(ms)) return "";
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}:${String(s % 60).padStart(2, "0")}`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  };
  const left = (ms) => {
    if (ms == null || isNaN(ms)) return "";
    if (ms <= 0) return "almost done";
    if (ms < 60000) return "under a minute left";
    const m = Math.round(ms / 60000);
    return m < 60 ? `about ${m} min left` : `about ${(ms / 3600000).toFixed(1)} h left`;
  };
  // "1:20 so far, about 3 min left". typicalMs: how long it usually takes; done/total: share finished so far.
  const progressText = ({ elapsedMs, typicalMs, done, total, leftMs }) => {
    const parts = [`${dur(elapsedMs)} so far`];
    if (leftMs == null && done > 0 && total > done) leftMs = (elapsedMs / done) * (total - done);
    if (leftMs == null && typicalMs) leftMs = typicalMs - elapsedMs;
    if (leftMs != null) parts.push(leftMs < -15000 ? "taking longer than usual" : left(leftMs));
    return parts.join(", ");
  };
  // Updates el's text every second until stop() is called. text(elapsedMs) builds the line.
  const ticker = (el, text, startedAt = Date.now()) => {
    const tick = () => (el.textContent = text(Date.now() - startedAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  };
  // Remembers how long a browser-side wait (a lookup, a Claude answer) took, for next time's estimate.
  const typical = (key) => {
    try {
      return Number(localStorage.getItem(`ytw-time-${key}`)) || null;
    } catch {
      return null;
    }
  };
  const remember = (key, ms) => {
    try {
      const old = typical(key);
      localStorage.setItem(`ytw-time-${key}`, String(Math.round(old ? old * 0.6 + ms * 0.4 : ms)));
    } catch {}
  };
  // Short estimate for a button label: "~25 min".
  const est = (ms) => (ms == null || isNaN(ms) ? "" : ms < 60000 ? "~1 min" : ms < 3600000 ? `~${Math.round(ms / 60000)} min` : `~${(ms / 3600000).toFixed(1)} h`);
  // Asks before starting anything that usually takes over 15 minutes. ms: how long it usually takes (null if never timed);
  // untimedLong: warn even without a timing because it's known to be slow. Resolves true to go ahead.
  const LONG_MS = 15 * 60000;
  const confirmLong = ({ ms, what, untimedLong = false, note = "" }) => {
    if (ms != null ? ms < LONG_MS : !untimedLong) return Promise.resolve(true);
    const how = ms != null ? `This usually takes ${est(ms).replace("~", "about ")}.` : "This hasn't been timed yet, and it can take over 15 minutes.";
    return confirmBox({ title: `⏱ ${what} is a long one`, text: `${how}${note ? " " + note : ""} You can leave the page; it keeps going on the PC.`, yes: "Start it" });
  };
  // The yes/no box lives in lib.js (shared with every page); this keeps the old timing.confirmBox name.
  const confirmBox = (o) => import("./lib.js").then((m) => m.confirmBox(o));
  window.timing = { dur, left, progressText, ticker, typical, remember, confirmLong, confirmBox, est, LONG_MS };
})();
