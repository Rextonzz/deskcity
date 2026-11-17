// The three settings pages (Admin, AI and spend, YouTube settings): each page's script only asks for elements that are
// on that page, and Admin's second "Send test alert" (button, handler, route) is gone for good.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hub, APP, app } from "./helper.mjs";

const PAGES = ["admin", "ai", "youtube-settings"];
// A page that's now a thin wrapper round a block (public/parts/<page>.js, see page-blocks.test.mjs) is read as one
// page again: the block's markup goes back into <main id="block"> and its code into the page's one inline script.
function read(page) {
  const html = fs.readFileSync(path.join(APP, "public", `${page}.html`), "utf8");
  const blockFile = path.join(APP, "public", "parts", `${page}.js`);
  if (!fs.existsSync(blockFile)) return html;
  const js = fs.readFileSync(blockFile, "utf8").replace(/\r\n/g, "\n");
  const [before, rest] = js.split("export const html = `");
  const end = rest.indexOf("\n`;");
  const [markup, code] = [rest.slice(0, end), before + rest.slice(end + 3)];
  return html.replace(/(<main id="block"[^>]*>)(<\/main>)/, (m, open, close) => open + markup + close)
    .replace(/(<script type="module">)[\s\S]*?(<\/script>)/, (m, open, close) => open + code + close);
}
const scriptsOf = (html) => [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
const markupIds = (html) => new Set([...html.replace(/<script[\s\S]*?<\/script>/g, "").matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
// $("x") and getElementById("x") in the page scripts, plus every id handed to onPage("x", "y").
function idsAsked(code) {
  const ids = new Set([...code.matchAll(/(?:\$|getElementById)\(\s*["']([A-Za-z0-9_-]+)["']/g)].map((m) => m[1]));
  for (const call of code.matchAll(/onPage\(([^)]*)\)/g)) for (const x of call[1].matchAll(/["']([^"']+)["']/g)) ids.add(x[1]);
  return ids;
}

for (const page of PAGES) {
  test(`${page}.html: every element its scripts ask for is on the page`, () => {
    const html = read(page);
    const here = markupIds(html);
    const asked = idsAsked(scriptsOf(html));
    assert.ok(asked.size > 10, "found the ids the scripts use");
    const missing = [...asked].filter((id) => !here.has(id));
    assert.deepEqual(missing, [], `${page}.html asks for elements that another page owns (a stand-in would hide it)`);
  });
}

test("the Admin Controls card has the pause button only; Phone alerts keeps its Send test", () => {
  const admin = read("admin");
  assert.match(admin, /id="pauseBtn"/);
  assert.match(admin, /id="alertTest"[^>]*>Send test</);
  for (const page of PAGES) assert.equal(/test-alert|testAlert/.test(read(page)), false, page);
});

test("the server has no test-alert helper or route left; the Phone alerts test route stays", async () => {
  await hub();
  const admin = await import(app("src/pipeline/admin.js"));
  assert.equal(admin.testAlert, undefined);
  const { pipelineRouter } = await import(app("src/routes/pipeline.js"));
  const routes = pipelineRouter.stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${l.route.path}`));
  assert.equal(routes.includes("POST /admin/test-alert"), false);
  assert.ok(routes.includes("POST /notify/test"));
  assert.ok(routes.includes("POST /admin/disk/cleanup"), "the router stack was read");
});

test("the three settings pages run as one module on lib.js: no stand-in $, onPage, api or password dialog of their own", () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.equal((html.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || []).length, 1, `${page}.html has one inline script`);
    assert.match(html, /<script type="module">/, page);
    assert.equal(/document\.createElement\("div"\)|const onPage|async function api\(|async function askPassword/.test(html), false, page);
  }
  assert.match(read("admin"), /import \{[^}]*askPassword[^}]*\} from "\/lib\.js"/);
  assert.equal(/id="pwDialog"/.test(read("admin")), false, "the dialog is built by lib.js on first use");
});
