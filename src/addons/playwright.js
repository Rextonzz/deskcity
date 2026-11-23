// Where the hub gets playwright (Deskcity 0.2.0): from the "browser" add-on (addons/browser/node_modules), else from the
// core node_modules that older installs still have. Nothing imports "playwright" directly any more; call loadPlaywright().
// Tests only: HUB_TEST_NO_PLAYWRIGHT=1 (with HUB_TEST_ROOT set) makes it behave as if playwright were not installed.
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addonsRoot } from "./loader.js";

const MISSING = "Browser automation isn't installed. Run: npm run addons:install";
const hidden = () => process.env.HUB_TEST_NO_PLAYWRIGHT === "1" && !!process.env.HUB_TEST_ROOT;
const addonRequire = () => createRequire(path.join(addonsRoot(), "browser", "package.json"));

let cached = null;
const norm = (ns) => (ns && ns.chromium ? ns : (ns?.default ?? ns));

export async function loadPlaywright() {
  if (hidden()) throw new Error(MISSING);
  if (cached) return cached;
  let resolved = null;
  try { resolved = addonRequire().resolve("playwright"); } catch {}
  if (resolved) {
    try { return (cached = norm(await import(pathToFileURL(resolved).href))); } catch {}
  }
  try { return (cached = norm(await import("playwright"))); } catch {}
  throw new Error(MISSING);
}

// The installed playwright version (add-on first, then core), or null. For the Admin page.
export function playwrightVersion() {
  if (hidden()) return null;
  const ids = [() => addonRequire().resolve("playwright/package.json"), () => createRequire(import.meta.url).resolve("playwright/package.json")];
  for (const find of ids) {
    try { const v = createRequire(import.meta.url)(find()).version; if (typeof v === "string") return v; } catch {}
  }
  return null;
}
