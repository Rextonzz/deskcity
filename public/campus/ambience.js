// Campus: weather, day and night, the cozy extras. Part of public/campus.html, loaded in order by campus/boot.js;
// the files share one global scope (classic scripts), so a name defined in one is visible in the others.
"use strict";
// ---------- ambience (the cozy, over-funded campus) ----------
// Night 0..1 from the real sun in the owner's town (the owner 2026-11-09: night wasn't showing at 5:37 pm in November, because
// the old fixed 18:00-20:00 dusk ignored the season). Dusk fades from 20 min before sunset to 70 min after; dawn the
// same in reverse. The light mode (the weather pill: Auto, Day, Night) can pin it, saved in this browser.
let lightMode = (() => { try { return localStorage.getItem("campus.light") || "auto"; } catch { return "auto"; } })();
let sunDay = null;
// Sunrise and sunset (ms) for a date, NOAA's approximation; good to a few minutes. The town comes from the hub
// settings (the owner's: the owner's town); with no town set, 7:00 to 19:00 local.
function sunTimes(date = new Date(), lat = HUB.place?.lat, lon = HUB.place?.lon) {
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate(), key = `${y}-${m}-${d}`;
  if (sunDay?.key === key) return sunDay;
  if (typeof lat !== "number" || typeof lon !== "number") return (sunDay = { key, rise: new Date(y, m, d, 7).getTime(), set: new Date(y, m, d, 19).getTime() });
  const r = Math.PI / 180, n = Math.floor((Date.UTC(y, m, d) - Date.UTC(y, 0, 0)) / 864e5), g = (2 * Math.PI / 365) * (n - 1);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = Math.acos(Math.cos(90.833 * r) / (Math.cos(lat * r) * Math.cos(decl)) - Math.tan(lat * r) * Math.tan(decl)) / r;
  const base = Date.UTC(y, m, d);
  sunDay = { key, rise: base + (720 - 4 * (lon + ha) - eqt) * 60000, set: base + (720 - 4 * (lon - ha) - eqt) * 60000 };
  return sunDay;
}
function nightNow() {
  if (lightMode === "day") return 0;
  if (lightMode === "night") return 1;
  const { rise, set } = sunTimes(), t = Date.now(), M = 60000, clamp = (v) => Math.min(1, Math.max(0, v));
  if (t >= rise + 20 * M && t < set - 20 * M) return 0;
  if (t < rise + 20 * M && t >= rise - 70 * M) return clamp((rise + 20 * M - t) / (90 * M));
  if (t >= set - 20 * M && t < set + 70 * M) return clamp((t - (set - 20 * M)) / (90 * M));
  return 1;
}
// The weather pill cycles the light: Auto (the real sun) → always Day → always Night.
function cycleLight() {
  lightMode = { auto: "day", day: "night", night: "auto" }[lightMode] || "auto";
  try { localStorage.setItem("campus.light", lightMode); } catch {}
  paintSky(); if (typeof hud === "function" && typeof data !== "undefined" && data) hud();
  if (typeof toast === "function") toast({ auto: `Light: Auto, following the real sun${HUB.place?.name ? ` in ${HUB.place.name}` : ""}`, day: "Light: always day", night: "Light: always night" }[lightMode]);
}
let night = nightNow();
const stage = document.getElementById("stage");
function paintSky() {
  night = nightNow();
  const mix = (a, b) => a.map((v, i) => Math.round(v + (b[i] - v) * night));
  const c1 = mix([207, 227, 242], [29, 42, 58]), c2 = mix([190, 216, 236], [18, 26, 36]), c3 = mix([168, 200, 226], [11, 16, 23]); // day: pale sky #cfe3f2, like the 3D view
  stage.style.background = `radial-gradient(ellipse at 50% 40%, rgb(${c1}) 0%, rgb(${c2}) 55%, rgb(${c3}) 100%)`;
}
paintSky();
setInterval(paintSky, 60000);
const STARS = Array.from({ length: 70 }, () => [Math.random(), Math.random() * 0.55, Math.random() * 1.4 + 0.4, Math.random() * 6]);
function drawStars(t) {
  if (night < 0.25) return;
  for (const [fx, fy, r, ph] of STARS) { ctx.fillStyle = `rgba(255,248,230,${(0.35 + 0.35 * Math.sin(t / 900 + ph)) * night})`; ctx.beginPath(); ctx.arc(fx * W, fy * H, r, 0, Math.PI * 2); ctx.fill(); }
}
// Snow from November to March: a light flurry drifting down the screen.
const SNOW = Array.from({ length: 55 }, () => ({ x: Math.random(), y: Math.random(), v: 0.02 + Math.random() * 0.04, r: 0.8 + Math.random() * 1.6, ph: Math.random() * 6 }));
// Real weather in the owner's town (Open-Meteo, free, no key; asked every 30 minutes from this browser). Until it answers,
// or if it can't be reached, it snows from November to March like before.
let weather = { kind: [11, 12, 1, 2, 3].includes(new Date().getMonth() + 1) ? "snow" : "clear", live: false };
// Paid services each project uses (Agents page register), with live balances where a key allows. Every 30 min.
let services = [];
async function loadServices(fresh) {
  try { services = await api(`/agents/services${fresh ? "?fresh=1" : ""}`); } catch { services = []; }
}
loadServices(); setInterval(loadServices, 30 * 60000);
const svcLine = (x) => `<div class="row"><b>${esc(x.name)}</b> <span class="sub">${esc(x.purpose || "")}</span><div class="sub" style="${x.error || x.warn || x.keySet === false ? "color:#f0b45a" : ""}">${esc(x.error ? `couldn't check: ${x.error}` : x.line || "")}${x.plan && !x.live ? ` · ${esc(x.plan)}` : ""}${x.resets ? ` · resets ${esc(x.resets)}` : ""}</div></div>`;
function servicesHtml(roomId) {
  const mine = roomId ? services.filter((x) => (x.rooms || []).includes(roomId)) : services;
  if (!mine.length) return "";
  return `<h3 class="mt-4 font-semibold text-sm">${roomId ? "Services this project uses" : "Services (all projects)"}</h3>${mine.map(svcLine).join("")}${roomId ? "" : '<div class="sub">Keys stay in the hub\'s .env; this only shows whether each one is set. <a href="#" id="pSvcFresh" style="text-decoration:underline">Check now</a></div>'}`;
}

async function loadWeather() {
  try {
    if (typeof HUB.place?.lat !== "number") return; // no town set: no live weather
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${HUB.place.lat}&longitude=${HUB.place.lon}&current=weather_code,temperature_2m&timezone=auto`, { signal: AbortSignal.timeout(8000) });
    const c = (await r.json()).current || {};
    const w = Number(c.weather_code);
    const kind = [45, 48].includes(w) ? "fog" : (w >= 71 && w <= 77) || w === 85 || w === 86 ? "snow" : (w >= 51 && w <= 67) || (w >= 80 && w <= 82) || w >= 95 ? "rain" : w >= 2 ? "cloudy" : "clear";
    weather = { kind, live: true, temp: c.temperature_2m };
  } catch {}
}
loadWeather();
setInterval(loadWeather, 30 * 60000);
const RAIN = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), v: 0.6 + Math.random() * 0.4, l: 8 + Math.random() * 8 }));
function drawRain(dt) {
  ctx.strokeStyle = "rgba(170,200,235,0.45)"; ctx.lineWidth = 1;
  ctx.beginPath();
  for (const d of RAIN) { d.y += d.v * dt; if (d.y > 1.05) { d.y = -0.05; d.x = Math.random(); } const x = d.x * W, y = d.y * H; ctx.moveTo(x, y); ctx.lineTo(x - 2, y + d.l); }
  ctx.stroke();
}
function drawWeather(dt, t) {
  if (weather.kind === "snow") drawSnow(dt, t);
  else if (weather.kind === "rain") drawRain(dt);
  else if (weather.kind === "fog") { ctx.fillStyle = `rgba(200,210,220,${0.16 + 0.04 * Math.sin(t / 3000)})`; ctx.fillRect(0, 0, W, H); }
  else if (weather.kind === "cloudy") { ctx.fillStyle = "rgba(120,130,145,0.08)"; ctx.fillRect(0, 0, W, H); }
}
function drawSnow(dt, t) {
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  for (const f of SNOW) {
    f.y += f.v * dt; if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); }
    const x = (f.x + Math.sin(t / 1500 + f.ph) * 0.01) * W;
    ctx.beginPath(); ctx.arc(x, f.y * H, f.r, 0, Math.PI * 2); ctx.fill();
  }
}
// Budget health for the fountain: 0 = plenty left, 1 = a cap or the credit is used up.
function budgetUse() {
  let use = 0;
  for (const d of data?.desks || []) if (d.capUsdMonth) use = Math.max(use, (d.monthUsd || 0) / d.capUsdMonth);
  const cr = data?.credit?.claude;
  if (cr?.balance > 0) use = Math.max(use, 1 - Math.max(0, cr.left) / cr.balance);
  return use;
}
const statsOf = (id) => data?.roomStats?.[id] || { todayEvents: 0, todayTokens: 0, weekDone: 0 };
