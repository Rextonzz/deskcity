// Date and hour in a time zone, by wall clock. No imports, so schedule.js and util.js can both use it.
export function partsIn(tz, date) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, weekday: p.weekday };
}

// "2026-11-13" in `tz`. `d` is a Date or milliseconds.
export const dayIn = (tz, d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);

// 0-23 in `tz` (h23, so midnight is 0, not 24).
export const hourIn = (tz, d = new Date()) => Number(new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(d));
