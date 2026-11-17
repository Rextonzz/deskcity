// Slot maths in the channel's time zone (America/the owner's town). Studio's own time zone must match.
import { partsIn } from "./fmt.js";
import { fromModule } from "./channels/known.js";

// Converts a wall-clock time in `tz` to a Date.
// The offset is worked out twice: once from a first guess, then again at the result, so times on the day the clocks
// change come out right (stress test 2026-10-23: 3:30 AM on the March change day came out 4:30 AM).
export function zonedDate(tz, y, m, d, hh, mm) {
  const want = Date.UTC(y, m - 1, d, hh, mm);
  let t = want;
  for (let i = 0; i < 2; i++) {
    const p = partsIn(tz, new Date(t));
    t += want - Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  }
  return new Date(t);
}

// Next free slot at least `leadMinutes` from now. `taken` holds ISO strings already booked.
// `perDay` caps how many videos go out on one day (a channel module's perDayDefault when its settings don't say).
export function nextSlot({ tz, slots, taken = [], perDay = null, leadMinutes = 45, now = new Date() }) {
  const busy = new Set(taken.map((t) => new Date(t).toISOString()));
  const onDay = {};
  for (const t of taken) {
    const p = partsIn(tz, new Date(t));
    onDay[`${p.y}-${p.m}-${p.d}`] = (onDay[`${p.y}-${p.m}-${p.d}`] || 0) + 1;
  }
  // Days are stepped by calendar date (noon of each), not by 24 h: the March clock change day is 23 h long and was
  // skipped (stress test 2026-10-23).
  const today = partsIn(tz, now);
  for (let day = 0; day < 60; day++) {
    const cal = new Date(Date.UTC(today.y, today.m - 1, today.d + day));
    const base = partsIn(tz, zonedDate(tz, cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate(), 12, 0));
    const weekend = base.weekday === "Sat" || base.weekday === "Sun";
    if (perDay && (onDay[`${base.y}-${base.m}-${base.d}`] || 0) >= perDay) continue;
    for (const hhmm of weekend ? slots.weekend : slots.weekday) {
      const [hh, mm] = hhmm.split(":").map(Number);
      const at = zonedDate(tz, base.y, base.m, base.d, hh, mm);
      if (at.getTime() - now.getTime() < leadMinutes * 60000) continue;
      if (busy.has(at.toISOString())) continue;
      return at;
    }
  }
  throw new Error("No free posting slot in the next 60 days.");
}

// Studio's schedule picker wants the date and a dropdown time label in the channel's zone.
export function studioLabels(tz, date) {
  const p = partsIn(tz, date);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const h12 = ((p.hh + 11) % 12) + 1;
  return {
    date: `${months[p.m - 1]} ${p.d}, ${p.y}`,
    time: `${h12}:${String(p.mm).padStart(2, "0")} ${p.hh < 12 ? "AM" : "PM"}`,
    pretty: `${p.weekday} ${months[p.m - 1]} ${p.d}, ${h12}:${String(p.mm).padStart(2, "0")} ${p.hh < 12 ? "AM" : "PM"}`,
  };
}

export function dateInTz(tz, date = new Date()) {
  const p = partsIn(tz, date);
  return { iso: `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`, short: `${p.m}/${p.d}/${String(p.y).slice(2)}` };
}

// How many videos a channel may post per day: its setting, or 1 for a channel (the owner, 2026-10-18).
export const perDayOf = (id, s) => (Number(s?.perDay) > 0 ? Number(s.perDay) : fromModule(s?.module || id, "perDayDefault") ?? null);
