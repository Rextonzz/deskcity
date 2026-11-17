// Search everything: the page's working part as a block (see public/parts/kit.js). Mounted by public/search.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, api, bindRoot } from "/stats-lib.js";
import { safeUrl } from "/lib.js";
import { scope, lifecycle } from "/parts/kit.js";

export const html = `<style>
[data-block="search"] input { background: var(--surface-2); border: 1px solid var(--line-strong); color: var(--text-primary); border-radius: 8px; padding: 8px 10px; font-size: 16px; }
  [data-block="search"] .sub { font-size: 13px; color: var(--text-muted); }
  [data-block="search"] .hit { display: block; padding: 8px 0; border-top: 1px solid var(--line); text-decoration: none; }
  [data-block="search"] .hit:first-of-type { border-top: 0; }
  [data-block="search"] .hit:hover .t { text-decoration: underline; }
  [data-block="search"] .t { font-size: 15px; color: var(--text-primary); }
  [data-block="search"] mark { background: var(--surface-3); color: var(--text-primary); border-radius: 3px; padding: 0 2px; }
</style>
<input id="q" type="search" class="w-full" placeholder="Type at least 2 letters" autocomplete="off" autofocus />
<p id="msg" class="sub"></p>
<div id="out" class="space-y-4"></div>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "search";
  const $ = scope(root), life = lifecycle();
  bindRoot(root, life);
  let timer = null, seq = 0;
  // Highlight on the raw text, then escape each piece, so a search for "amp" can't land inside an &amp;.
  const mark = (text, q) => {
    const words = q.split(/\s+/).filter((x) => x.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!words.length) return esc(text);
    return String(text).split(new RegExp(`(${words.join("|")})`, "ig")).map((p, i) => (i % 2 ? `<mark>${esc(p)}</mark>` : esc(p))).join("");
  };
  async function run() {
    const q = $("q").value.trim();
    // the plain page keeps the search in its address; inside the campus the address belongs to the campus
    if (!opts.embedded) history.replaceState(null, "", q ? `?q=${encodeURIComponent(q)}` : location.pathname);
    if (q.length < 2) { $("out").innerHTML = ""; $("msg").textContent = ""; return; }
    const me = ++seq;
    $("msg").textContent = "Searching…";
    let r;
    try { r = await api(`/search?q=${encodeURIComponent(q)}`); } catch (err) { $("msg").textContent = err.noRoute ? "The app needs a restart for search." : err.message; return; }
    if (me !== seq) return;
    $("msg").textContent = r.total ? `${r.total} found` : `Nothing found for "${q}".`;
    $("out").innerHTML = r.groups.map((g) => `<section class="card">
      <h2 class="font-semibold mb-1">${esc(g.name)} <span class="sub">${g.items.length + (g.more || 0)}</span></h2>
      ${g.note ? `<p class="sub">${esc(g.note)}</p>` : ""}
      ${g.items.map((x) => `<a class="hit" href="${esc(safeUrl(x.href))}"${/^https?:/.test(x.href) ? ' target="_blank" rel="noopener"' : ""}><div class="t">${mark(x.title, q)}${/^https?:/.test(x.href) ? " ↗" : ""}</div>${x.sub ? `<div class="sub">${mark(x.sub, q)}</div>` : ""}</a>`).join("")}
      ${g.more ? `<p class="sub mt-1">and ${g.more} more. Type more words to narrow it down.</p>` : ""}
    </section>`).join("");
  }
  $("q").oninput = () => { clearTimeout(timer); timer = life.later(run, 250); };
  const q0 = opts.embedded ? opts.q : new URLSearchParams(location.search).get("q");
  if (q0) { $("q").value = q0; run(); }
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
