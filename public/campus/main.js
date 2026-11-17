// Campus: HUD, toasts and start-up. Part of public/campus.html, loaded in order by campus/boot.js;
// the files share one global scope (classic scripts), so a name defined in one is visible in the others.
"use strict";
// ---------- HUD ----------
function hud() {
  const { api: api$, sub: sub$ } = monthTotals();
  document.getElementById("hApi").textContent = `API ${usd(api$)}`;
  document.getElementById("hSub").textContent = `Sub ${usd(sub$)}`;
  document.getElementById("hHr").textContent = `HR inbox ${inbox.length}`;
  const wx = document.getElementById("hWx");
  wx.style.display = "";
  wx.textContent = `${{ snow: "❄", rain: "🌧", fog: "🌫", cloudy: "☁", clear: night > 0.5 ? "☾" : "☀" }[weather.kind] || "☀"} ${weather.temp != null ? `${Math.round(weather.temp)}°C` : weather.kind}${lightMode === "auto" ? "" : lightMode === "day" ? " · day" : " · night"}`;
  const fresh = data.feed.filter((f) => Date.parse(f.startedAt) > lastSeen).length;
  const nw = document.getElementById("hNew");
  if (lastSeen && fresh) { nw.style.display = ""; nw.textContent = `✨ ${fresh} new since your last visit`; } else nw.style.display = "none";
}
document.getElementById("hOrg").onclick = () => orgPanel();
document.getElementById("hAdd").onclick = () => projectPanel();
// Collapse the menu: remembered in this browser.
{
  const btn = document.getElementById("hMin");
  const set = (on) => { document.body.classList.toggle("hud-min", on); btn.textContent = on ? "▾" : "▴"; btn.title = on ? "Show the buttons and cards" : "Hide the buttons and cards (more room)"; try { localStorage.setItem("campus.hudMin", on ? "1" : ""); } catch {} };
  let start = false; try { start = localStorage.getItem("campus.hudMin") === "1"; } catch {}
  set(start); btn.onclick = () => set(!document.body.classList.contains("hud-min"));
}
document.getElementById("hNew").onclick = () => sincePanel();
document.getElementById("hWx").onclick = () => cycleLight();
document.getElementById("hHr").onclick = () => (view ? panel(view === "hr" ? "hr::0" : "hr") : panel("hr"));
document.getElementById("hBack").onclick = () => setView(null);
document.getElementById("hBack").style.display = view ? "" : "none";
// "New since last visit" is measured from when you open the page; it's saved when you leave.
const markSeen = () => { try { localStorage.setItem("campus.lastSeen", String(Date.now())); } catch {} };
window.addEventListener("pagehide", markSeen);
document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && markSeen());

let toastTimer;
function toast(text, ms = 4000) { const el = document.getElementById("toast"); el.textContent = text; el.style.display = ""; el.onclick = () => (el.style.display = "none"); /* tap to dismiss */ clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.style.display = "none"), ms); }

window.addEventListener("resize", resize);
resize();
load().then(() => { resize(); requestAnimationFrame(frame); });
// Polling pauses while the tab is hidden (speed, 2026-11-16) and catches up the moment it shows again. The answer is
// sent with an ETag and "no-cache" (src/httpcache.js), so an unchanged poll is a 304 with no body.
setInterval(() => document.visibilityState === "visible" && load(), 20000);
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && load());

// Resize the side panel by dragging its grip (the owner 2026-11-09). Wide screens: width 280px to 85% of the screen;
// phones: height 30% to 92%. Remembered in this browser (campus.panelSize).
(() => {
  const grip = document.getElementById("pgrip"), stage = document.getElementById("stage");
  if (!grip || !stage) return;
  const phone = () => matchMedia("(max-width: 640px)").matches;
  const apply = (v) => { if (!v) return; stage.style.setProperty(phone() ? "--ph" : "--pw", phone() ? `${v.h}%` : `${v.w}px`); };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("campus.panelSize") || "{}"); } catch {}
  if (saved.h) stage.style.setProperty("--ph", `${saved.h}%`);
  if (saved.w) stage.style.setProperty("--pw", `${saved.w}px`);
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault(); grip.setPointerCapture(e.pointerId);
    const r = stage.getBoundingClientRect();
    const move = (ev) => {
      if (phone()) saved.h = Math.round(Math.max(30, Math.min(92, ((r.bottom - ev.clientY) / r.height) * 100)));
      else saved.w = Math.round(Math.max(280, Math.min(r.width * 0.85, r.right - ev.clientX)));
      apply(saved);
      if (!move.queued) { move.queued = true; requestAnimationFrame(() => { move.queued = false; dispatchEvent(new Event("resize")); }); } // one a frame, not one per mouse move
    };
    const up = () => { grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up); try { localStorage.setItem("campus.panelSize", JSON.stringify(saved)); } catch {} };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up);
  });
})();
