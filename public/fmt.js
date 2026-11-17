// Time text shared by the pages and the campus: "Oct 18, 4:57 PM", "4:57 PM", "Oct 18" and "5 min ago".
// A missing or unreadable time shows nothing (an empty string), never "Invalid Date".
// when/time/day pass their own options, so nav.js's hub-zone patch of toLocale*String leaves them alone (device zone);
// the "older than a day" date in ago() passes none, so it follows the hub zone.

const dateOf = (t) => {
  if (t == null || t === "") return null;
  const d = new Date(t);
  return isNaN(d) ? null : d;
};

export const when = (t) => dateOf(t)?.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) ?? "";
export const time = (t, timeZone) => dateOf(t)?.toLocaleTimeString([], { timeZone, hour: "numeric", minute: "2-digit" }) ?? "";
export const day = (t) => dateOf(t)?.toLocaleDateString([], { month: "short", day: "numeric" }) ?? "";

// How long, from milliseconds, with no "ago": "5 min", "3 h", "2 days". exact keeps the minutes past an hour ("2 h 30 min", no day step).
export function ageText(ms, exact = false) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(1, m)} min`;
  if (exact) return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
  if (m < 1440) return `${Math.round(m / 60)} h`;
  const days = Math.round(m / 1440);
  return `${days} day${days === 1 ? "" : "s"}`;
}

// "just now", "5 min ago", "3 h ago", then the date. style "days" counts days instead of showing the date;
// style "exact" gives the bare "2 h 30 min" with no "ago" (a running job's age).
export function ago(t, style) {
  const d = dateOf(t);
  if (!d) return "";
  const ms = Date.now() - d.getTime();
  if (Math.round(ms / 60000) < 1) return "just now";
  if (style === "exact") return ageText(ms, true);
  return Math.round(ms / 60000) < 1440 || style === "days" ? `${ageText(ms)} ago` : d.toLocaleDateString();
}

// The hub's time zone as nav.js remembered it from the hub settings (localStorage hub.tz); undefined (the device's zone) until then.
export const hubTz = () => { try { return localStorage.getItem("hub.tz") || undefined; } catch { return undefined; } };
// "2026-11-13" in the hub's zone.
export const today = (tz = hubTz()) => new Date().toLocaleDateString("en-CA", { timeZone: tz });

// Money text. money(12.5, "CA$") is "CA$12.50"; a missing value (null) shows `none` ("" unless given).
export const money = (n, cur = "$", none = "") => (n == null ? none : `${cur}${Number(n).toFixed(2)}`);
// What a worker spent: "$1.50", "$0.012" under a dollar, "$0" for nothing. Under a tenth of a cent it keeps the digits
// (up to six places, as the AI call log stores them): "$0.000298", not "$0.000" (trailer v7 review: a real $0.000298 read as nothing).
export const spend = (n) => (n >= 1 ? `$${n.toFixed(2)}` : n >= 0.001 ? `$${n.toFixed(3)}` : n > 0 ? (Number(n.toFixed(6)) > 0 ? `$${Number(n.toFixed(6))}` : "<$0.000001") : "$0");
