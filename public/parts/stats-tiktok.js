// TikTok stats: the page's working part as a block (see public/parts/kit.js). Mounted by public/stats-tiktok.html and, over the
// campus in 2D, 3D and Neural, by public/campus/blocks.js. Where it lives on the campus: public/parts/registry.js.
import { esc, int, compact, pct, sum, median, groupBy, hbars, scatter, table, tile, onResize, api, bindRoot } from "/stats-lib.js";
import { watchJob } from "/lib.js";
import { scope, lifecycle } from "/parts/kit.js";
import { channels as CHANNELS, chOfLayout } from "/hubinfo.js";
const CLIPS = chOfLayout("clips");

export const html = `<style>
[data-block="stats-tiktok"] .chip { font-size: 13px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line-strong); color: var(--text-secondary); }
</style>
<div class="flex items-center gap-2 flex-wrap" role="group" aria-label="Which channel">
  <span class="text-sm text-slate-500 mr-1">Channel</span>
  <span id="chips" class="flex gap-2 flex-wrap"></span>
  <span id="asOf" class="text-xs text-slate-500 ml-auto"></span>
  <button id="ttPull" class="text-sm px-3 py-1.5 rounded-lg bg-red-600 text-white disabled:opacity-50">Pull TikTok stats</button>
</div>
<p id="ttPullMsg" class="text-sm text-slate-500 hidden"></p>

<div id="err" class="hidden bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-sm"></div>

<section class="grid grid-cols-2 md:grid-cols-4 gap-3" id="tiles"></section>

<section class="card">
  <h3 class="font-medium">TikTok views against YouTube views, per clip</h3>
  <p id="vsNote" class="text-sm text-slate-500 mb-2"></p>
  <div id="vsChart"></div>
</section>

<div class="grid md:grid-cols-2 gap-5">
  <section class="card">
    <h3 class="font-medium">Top posts by TikTok views</h3>
    <p class="text-sm text-slate-500 mb-2">The 12 most viewed posts.</p>
    <div id="topChart"></div>
  </section>
  <section class="card">
    <h3 class="font-medium">Average TikTok views by creator</h3>
    <p id="creatorNote" class="text-sm text-slate-500 mb-2"></p>
    <div id="creatorChart"></div>
  </section>
</div>

<section class="card">
  <h3 class="font-medium mb-2">Every post</h3>
  <div id="postTable" class="overflow-x-auto"></div>
</section>
`;

export async function mount(root, opts = {}) {
  root.innerHTML = html;
  root.dataset.block = "stats-tiktok";
  const $ = scope(root), life = lifecycle();
  bindRoot(root, life);
  const showErr = (msg) => { const el = $("err"); el.textContent = msg; el.classList.toggle("hidden", !msg); };
  const NAMES = Object.fromEntries(CHANNELS.map((c) => [c.id, c.name]));
  let data = {}, channel = null;
  const clean = (t) => String(t || "").replace(/#\w+/g, "").replace(/\s+/g, " ").trim();
  const day = (iso) => (iso ? String(iso).slice(0, 10) : "");

  function render() {
    const d = data[channel];
    const posts = (d?.posts || []).filter((p) => p.views != null);
    $("asOf").textContent = d?.asOf ? `Numbers as of ${new Date(d.asOf).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "";
    if (!posts.length) {
      $("tiles").innerHTML = "";
      for (const id of ["vsChart", "topChart", "creatorChart", "postTable"]) $(id).innerHTML = '<div class="text-sm text-slate-500 py-6">No TikTok numbers yet. Press Pull TikTok stats above (about a minute).</div>';
      return;
    }
    const views = sum(posts, (p) => p.views);
    const eng = posts.filter((p) => p.likes != null);
    const engRate = eng.length ? sum(eng, (p) => (p.likes || 0) + (p.comments || 0) + (p.shares || 0)) / Math.max(1, sum(eng, (p) => p.views)) : null;
    const matched = posts.filter((p) => p.youtube?.views != null);
    const ttBeat = matched.filter((p) => p.views > p.youtube.views).length;
    $("tiles").innerHTML = tile("Posts", int(posts.length)) + tile("TikTok views", compact(views), `median ${int(median(posts.map((p) => p.views)))} a post`)
      + tile("Likes, comments and shares", engRate == null ? "" : pct(engRate, 1), "of views")
      + tile("Beat YouTube", matched.length ? `${ttBeat} of ${matched.length}` : "", matched.length ? "clips with more TikTok views" : "no posts matched to YouTube yet");

    scatter($("vsChart"), matched.map((p) => ({ x: p.youtube.views, y: p.views, title: clean(p.youtube.title || p.caption), tip: [{ label: "YouTube", value: int(p.youtube.views) }, { label: "TikTok", value: int(p.views) }] })), { xfmt: compact, yfmt: compact, xLabel: "YouTube views", yLabel: "TikTok views", emptyText: "Needs 3 posts matched to their YouTube clip." });
    $("vsNote").textContent = matched.length ? `${matched.length} posts matched to their YouTube clip (by the link the app saved, or by caption). The TikTok ÷ YouTube column below shows which did better where.` : "";

    hbars($("topChart"), [...posts].sort((a, b) => b.views - a.views).slice(0, 12).map((p) => ({ label: clean(p.youtube?.title || p.caption) || p.postId, value: p.views })), { fmt: compact });

    const by = [...groupBy(matched.filter((p) => p.youtube.creator), (p) => p.youtube.creator)].map(([k, l]) => ({ label: `${k} (${l.length})`, value: sum(l, (p) => p.views) / l.length, n: l.length })).filter((g) => g.n >= 2).sort((a, b) => b.value - a.value);
    hbars($("creatorChart"), by, { fmt: compact, emptyText: "Needs 2 matched posts for a creator." });
    $("creatorNote").textContent = by.length ? "Creators with 2 or more matched posts; the number in brackets is how many." : "";

    table($("postTable"), [
      { key: "day", label: "Posted" },
      { key: "caption", label: "Post", html: (r) => `${esc(clean(r.youtube?.title || r.caption).slice(0, 70))} <a class="text-red-700 hover:underline" target="_blank" rel="noopener" href="${esc(r.url)}">TikTok</a>${r.youtubeId ? ` <a class="text-red-700 hover:underline" target="_blank" rel="noopener" href="https://youtube.com/shorts/${esc(r.youtubeId)}">YouTube</a>` : ""}` },
      { key: "views", label: "Views", right: true, fmt: int },
      { key: "likes", label: "Likes", right: true, fmt: int },
      { key: "comments", label: "Comments", right: true, fmt: int },
      { key: "shares", label: "Shares", right: true, fmt: int },
      { key: "ytViews", label: "YouTube views", right: true, fmt: int },
      { key: "ratio", label: "TikTok ÷ YouTube", right: true, fmt: (v) => (v == null ? "" : `${v.toFixed(2)}×`) },
    ], posts.map((p) => ({ ...p, day: day(p.date) || day(p.youtube?.date), ytViews: p.youtube?.views ?? null, ratio: p.youtube?.views ? p.views / p.youtube.views : null })), { sortKey: "views" });
  }

  // TikTok only: TikTok Studio's post list, then the TikTok views columns in the upload log. About a minute.
  const watch = watchJob({ life, poll: () => api("/stats/tiktok/pull").catch(() => ({ running: false })), render: (s) => watchPull(s), everyMs: 4000 });
  async function watchPull(s) {
    const msg = $("ttPullMsg"), btn = $("ttPull");
    btn.disabled = s.running;
    msg.classList.toggle("hidden", !s.running && !s.error && !s.result);
    if (s.running) {
      msg.textContent = "Reading TikTok Studio's post list… about a minute.";
      watch();
    } else if (s.error) msg.textContent = `TikTok stats didn't finish: ${s.error}`;
    else if (s.result) {
      const n = Object.values(s.result.posts || {}).reduce((a, b) => a + b, 0);
      msg.textContent = `Read ${n} TikTok posts${s.result.logRows ? ` and filled TikTok views for ${s.result.logRows} clips in the upload log` : ""}.`;
      data = await api("/stats/tiktok").catch(() => data);
      channel ??= Object.keys(data).includes(CLIPS.id) ? CLIPS.id : Object.keys(data)[0] || null;
      render();
    }
  }
  $("ttPull").onclick = async () => watchPull(await api("/stats/tiktok/pull", {}).catch((err) => ({ running: false, error: err.message })));
  api("/stats/tiktok/pull").then((s) => s.running && watchPull(s)).catch(() => {});

  try {
    data = await api("/stats/tiktok");
    const keys = Object.keys(data);
    channel = keys.includes(CLIPS.id) ? CLIPS.id : keys[0] || null;
    $("chips").innerHTML = (keys.length ? keys : [CLIPS.id].filter(Boolean)).map((k) => `<button class="chip" data-ch="${esc(k)}" aria-pressed="${k === (channel || CLIPS.id)}">${esc(NAMES[k] || k)}</button>`).join("");
    $.all("[data-ch]").forEach((b) => (b.onclick = () => {
      channel = b.dataset.ch;
      $.all("[data-ch]").forEach((x) => x.setAttribute("aria-pressed", x === b));
      render();
    }));
    render();
    onResize(render);
  } catch (err) {
    showErr(err.message);
  }
  return { unmount() { life.stop(); root.innerHTML = ""; } };
}
