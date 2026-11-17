// Where the hub listens (security plan 01, 2026-11-16). "local" (default): this PC only (127.0.0.1).
// "all": every network card, so phones on Tailscale (and the LAN, if allowed) can reach it; the network list in
// security.js still decides who gets an answer. HUB_LISTEN in .env wins over the settings file.
import { hubSettings } from "./settings.js";
export const LISTEN_MODES = ["local", "all"];
export function listenMode(env = process.env, s = hubSettings()) {
  const v = String(env.HUB_LISTEN || s.network?.listen || "local").trim().toLowerCase();
  return LISTEN_MODES.includes(v) ? v : "local";
}
// A wide listen needs a dashboard password: without one only this PC could sign in anyway, so opening the port
// would only expose the sign-in page and the agent posts.
export function listenHost(env = process.env, s = hubSettings()) {
  if (listenMode(env, s) === "all" && env.DASHBOARD_PASSWORD_HASH) return undefined; // Node's default: all interfaces
  return "127.0.0.1";
}
// Who may connect when listening on all: DASHBOARD_NETWORKS, else the settings file, else this PC and Tailscale.
export function networksSetting(env = process.env, s = hubSettings()) {
  return String(env.DASHBOARD_NETWORKS || s.network?.networks || "local,tailscale");
}
