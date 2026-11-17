// Helpers shared by the pages: element lookup, HTML escaping, the pipeline API call and the photo shrinker.
// stats-lib.js re-exports $, esc and api, so pages can import them from either file.

export { when, time, day, ago, ageText, money, spend, hubTz, today } from "./fmt.js";

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// A link from data: only http(s) or a path on this hub; anything else (javascript:, data:) becomes "#".
export const safeUrl = (u) => { const s = String(u ?? "").trim(); return /^https?:\/\//i.test(s) || /^\/(?!\/)/.test(s) ? s : "#"; };

// api(path) reads, api(path, body) posts JSON. opts.next is where /login sends you back to.
// opts.password: if the hub answers 403 needPassword, ask for the dashboard password once (askPassword) and try again;
// cancelling throws an error with .cancelled = true.
// Errors carry .status, .offline (the connection dropped) and .noRoute (the route is missing: the hub needs a restart).
export async function api(path, body, opts = {}) {
  try {
    return await call(path, body, opts);
  } catch (err) {
    if (!opts.password || err.status !== 403 || !err.needPassword) throw err;
    if (!(await askPassword(opts.why))) throw Object.assign(new Error("Cancelled."), { cancelled: true });
    return call(path, body, opts);
  }
}

async function call(path, body, opts) {
  let res;
  try {
    res = await fetch("/api/pipeline" + path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    // The browser's own "Failed to fetch": the phone lost its link to the PC (screen off, Tailscale reconnecting).
    const err = new Error("Couldn't reach the PC just now (the connection dropped). Trying again…");
    err.offline = true;
    throw err;
  }
  if (res.status === 401) location.href = `/login?next=${encodeURIComponent(opts.next || location.pathname)}`;
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const noRoute = res.status === 404 && !data.error;
    const err = new Error(data.error || (noRoute ? "the app needs a restart to load this feature" : res.statusText || `error ${res.status}`));
    err.status = res.status;
    err.noRoute = noRoute;
    err.needPassword = !!data.needPassword;
    throw err;
  }
  return data;
}

// The red banner at the top of a page (element id "err"): shows msg, or hides the banner when msg is empty.
export function showErr(msg) {
  const el = $("err");
  el.textContent = msg;
  el.classList.toggle("hidden", !msg);
}

// Watches a background job. watchJob({ poll, render, done, everyMs }) returns watch(): call it when a job starts (or is seen running)
// and poll() is called every everyMs until it answers with running false. render(status) shows each answer, done(status) runs once at the end.
// A failed poll (null or an error) is skipped and tried again next round; calling watch() while already watching does nothing.
// Optional lost(err) is called with the error when a poll throws while the PC can't be reached (once per round), and lost(null) when it answers again.
export function watchJob({ poll, render, done, lost, everyMs = 3000, life }) {
  let timer = null;
  const later = life ? (fn, ms) => life.later(fn, ms) : setTimeout; // a block passes its lifecycle so closing it stops the polling
  let down = false;
  const tick = async () => {
    const s = await poll().catch((err) => { down = true; lost?.(err); return null; });
    if (s && down) { down = false; lost?.(null); }
    if (s) render?.(s);
    if (s && !s.running) {
      timer = null;
      await done?.(s);
    } else timer = later(tick, everyMs);
  };
  return () => { timer ??= later(tick, everyMs); };
}

// Asks for the dashboard password in a dialog built on first use (ids pwDialog, pwForm, pwInput, pwErr, pwCancel).
// `why` is the page's own sentence about what needs the password. Resolves true once confirmed (or already confirmed), false if cancelled.
export async function askPassword(why = "This needs your dashboard password.") {
  const st = await fetch("/api/confirm-password").then((r) => r.json()).catch(() => ({}));
  if (st.confirmed) return true;
  let d = $("pwDialog");
  if (!d) {
    d = document.createElement("dialog");
    d.id = "pwDialog";
    d.style.cssText = "border-radius:12px;padding:0;width:min(340px,calc(100vw - 32px))";
    d.innerHTML = `<style>#pwDialog::backdrop{background:rgb(15 23 42/.4)}</style>
      <form id="pwForm" style="padding:20px;display:grid;gap:10px">
        <div style="font-weight:600">Enter your password</div>
        <p id="pwWhy" style="font-size:14px;color:#64748b"></p>
        <input id="pwInput" type="password" autocomplete="current-password" style="border:1px solid #cbd5e1;border-radius:8px;padding:8px 12px;font-size:16px" required />
        <p id="pwErr" style="font-size:14px;color:#b91c1c"></p>
        <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" id="pwCancel" style="padding:8px 16px;border:1px solid #cbd5e1;border-radius:8px">Cancel</button><button style="padding:8px 16px;border-radius:8px;background:#dc2626;color:#fff">Confirm</button></div>
      </form>`;
    document.body.appendChild(d);
  }
  $("pwWhy").textContent = `${why} You won't be asked again for 10 minutes.`;
  $("pwInput").value = "";
  $("pwErr").textContent = "";
  d.showModal();
  return new Promise((resolve) => {
    $("pwCancel").onclick = () => { d.close(); resolve(false); };
    d.oncancel = () => resolve(false);
    $("pwForm").onsubmit = async (e) => {
      e.preventDefault();
      const res = await fetch("/api/confirm-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: $("pwInput").value }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { d.close(); resolve(true); } else { $("pwErr").textContent = data.error || "Wrong password."; $("pwInput").value = ""; }
    };
  });
}

// Shrinks a photo in the browser before upload (this also turns iPhone HEIC photos into JPEG).
export function shrinkPhoto(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("Couldn't open that photo"));
    img.src = URL.createObjectURL(file);
  });
}

// A yes/no box in the page's own style, used instead of the browser's confirm(), alert() and prompt().
// Resolves true for yes. no: null hides the cancel button (an alert). input: a string shows a text field
// prefilled with it and resolves to the trimmed text, or null on cancel or a tap outside (a prompt).
export function confirmBox({ title, text, yes = "OK", no = "Not now", input }) {
  return new Promise((done) => {
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px";
    box.innerHTML = `<div role="dialog" aria-modal="true" style="background:var(--surface-1,#1a1a19);color:var(--text-primary,#eee);border:1px solid var(--line-strong,#3a3a37);border-radius:12px;padding:20px;max-width:380px;width:100%">
      <div style="font-weight:600;margin-bottom:6px"></div>
      <div style="font-size:14px;color:var(--text-secondary,#aaa);margin-bottom:16px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button data-a="no" style="padding:8px 16px;border-radius:8px;border:1px solid var(--line-strong,#3a3a37);font-size:14px"></button>
        <button data-a="yes" style="padding:8px 16px;border-radius:8px;background:#dc2626;color:#fff;font-size:14px;font-weight:500"></button>
      </div></div>`;
    const [t, x] = box.querySelectorAll("[role=dialog] > div");
    const yesBtn = box.querySelector('[data-a="yes"]'), noBtn = box.querySelector('[data-a="no"]');
    t.textContent = title;
    x.textContent = text ?? "";
    if (!title) t.remove();
    if (!text) x.style.display = "none";
    noBtn.textContent = no;
    if (no === null) noBtn.remove();
    yesBtn.textContent = yes;
    let field;
    if (input !== undefined) {
      field = document.createElement("input");
      field.value = input;
      field.style.cssText = "width:100%;box-sizing:border-box;margin-bottom:16px;padding:8px;border-radius:8px;border:1px solid var(--line-strong,#3a3a37);background:transparent;color:inherit;font-size:16px";
      x.after(field);
      field.onkeydown = (e) => e.key === "Enter" && close(true);
    }
    const close = (v) => (box.remove(), done(field ? (v ? field.value.trim() : null) : v));
    box.onclick = (e) => (e.target === box ? close(false) : e.target.dataset.a && close(e.target.dataset.a === "yes"));
    document.body.appendChild(box);
    (field || yesBtn).focus();
  });
}
