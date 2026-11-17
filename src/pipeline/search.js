// Search everything (the owner 2026-10-21, "keep going"): one box that looks across the hub's own data. Cards in the
// collection, anime and manga, videos on both channels, to-dos, paper matches and the menu's pages.
// Read-only and local: nothing is fetched from the web. Each hit links to the page that holds it; pages with their own
// filter box open with the search typed in (collection ?q=), and watching and reading opens that title's editor (?open=).
import { resolvePath, readJson } from "./util.js";
import { publicChannels, chOfLayout } from "../hub/settings.js";

// The menu's pages; each channel with a stats page (its page layout is set) gets its own "<name> stats" entry after Stats.
const pages = () => [
  ["Home", "/home.html"], ["Queue", "/queue.html"], ["Posting calendar", "/calendar.html"], ["To-do and ideas", "/todo.html"],
  ["Project", "/project.html"], ["Pipeline", "/pipeline.html"], ["Stats", "/stats.html"],
  ...publicChannels().filter((c) => c.layout).map((c) => [`${c.name} stats`, `/stats-${c.id}.html`]), ["TikTok stats", "/stats-tiktok.html"], ["YouTube settings", "/youtube-settings.html"],
  ["Collection", "/collection.html"], ["Price a card", "/cards.html"], ["Deal watch", "/deals.html"], ["Paper matches", "/matches.html"],
  ["Deck ideas", "/deckideas.html"], ["MTG Arena", "/arena.html"],
  ["Games", "/games.html"], ["Watching and reading", "/reading.html"], ["Admin", "/admin.html"], ["AI and spend", "/ai.html"],
];
const statsPage = (c) => (c.id ? `/stats-${c.id}.html` : "/stats.html");
const read = (p, fallback) => readJson(resolvePath(p), fallback);
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export async function searchAll(q) {
  q = String(q || "").trim().slice(0, 80);
  if (q.length < 2) return { q, groups: [] };
  const words = fold(q).split(/\s+/).filter(Boolean);
  const hit = (...fields) => {
    const s = fold(fields.join(" "));
    return words.every((w) => s.includes(w));
  };
  const groups = [];
  const add = (name, items, more = 0) => items.length && groups.push({ name, items: items.slice(0, 15), more: Math.max(0, items.length - 15) + more });

  add("Pages", pages().filter(([l]) => hit(l)).map(([l, href]) => ({ title: l, href })));

  // Cards: one row per name, copies and lists added up.
  const byName = new Map();
  for (const c of read("data/cards/collection.json", { cards: [] }).cards || []) {
    if (!hit(c.name, c.setName, c.set, c.typeLine, (c.lists || []).join(" "))) continue;
    const r = byName.get(c.name) || { title: c.name, qty: 0, sets: new Set(), lists: new Set() };
    r.qty += c.qty || 0;
    r.sets.add(String(c.set || "").toUpperCase());
    for (const l of c.lists || []) r.lists.add(l);
    byName.set(c.name, r);
  }
  add(
    "Your cards",
    [...byName.values()].map((r) => ({
      title: r.title,
      sub: `${r.qty} cop${r.qty === 1 ? "y" : "ies"} · ${[...r.sets].join(", ")}${r.lists.size ? ` · ${[...r.lists].join(", ")}` : ""}`,
      href: `/collection.html?q=${encodeURIComponent(r.title)}`,
    })),
  );

  add("Watching and reading", (read("data/reading.json", { items: [] }).items || []).filter((i) => hit(i.title, i.where, i.status)).map((i) => ({
    title: i.title,
    sub: `${i.kind === "anime" ? "Anime" : "Manga"} · ${i.status} · ${i.kind === "anime" ? "episode" : "chapter"} ${i.progress ?? 0}${i.latest ? ` of ${i.latest}` : ""}${i.where ? ` · ${i.where}` : ""}`,
    href: `/reading.html?open=${encodeURIComponent(i.id)}`,
  })));

  // Videos from the stats export (the same data the stats pages use).
  try {
    const { exportStats } = await import("./stats.js");
    const d = await exportStats();
    const vids = [
      ...(d.clips || [])
        .filter((c) => hit(c.title, c.creator, c.tags))
        .map((c) => ({
          title: c.title,
          sub: `${chOfLayout("clips").name || "Clips"} · ${c.creator || "unknown creator"} · ${c.date || ""}${c.views != null ? ` · ${c.views.toLocaleString()} views` : ""}`,
          href: c.videoId ? `https://www.youtube.com/shorts/${c.videoId}` : statsPage(chOfLayout("clips")),
        })),
      ...(d.packs || [])
        .filter((p) => hit(p.pid, p.set, p.product, p.bestCard, (p.cardList || []).map((x) => x.name).join(" ")))
        .map((p) => {
          const v = (p.videos || [])[0];
          return {
            title: `${p.pid} ${p.set} ${p.product}`,
            sub: `${chOfLayout("packs").name || "Packs"} · best card ${p.bestCard || "?"}${v?.views != null ? ` · ${v.views.toLocaleString()} views` : " · not posted"}`,
            href: v?.videoId ? `https://www.youtube.com/shorts/${v.videoId}` : statsPage(chOfLayout("packs")),
          };
        }),
    ];
    add("Videos", vids);
  } catch (err) {
    groups.push({ name: "Videos", items: [], note: `Couldn't read the video list (${err.message.split("\n")[0].slice(0, 80)})` });
  }

  add(
    "To-dos and ideas",
    (read("data/todo.json", { items: [] }).items || [])
      .filter((t) => hit(t.title, t.detail, t.category))
      .sort((a, b) => (a.status === "done") - (b.status === "done"))
      .map((t) => ({ title: t.title, sub: `${t.status} · ${t.category || "Unsorted"}`, href: "/todo.html" })),
  );

  add(
    "Paper matches",
    (read("data/cards/paper-matches.json", { matches: [] }).matches || [])
      .filter((m) => hit(m.myDeck, m.oppDeck, m.opponent, m.format, m.place, m.event, m.notes))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map((m) => ({
        title: `${m.myDeck || "?"} vs ${m.oppDeck || "?"}`,
        sub: `${m.date} · ${m.format} · ${m.result === "W" ? "won" : m.result === "L" ? "lost" : m.result || ""}${m.opponent ? ` · ${m.opponent}` : ""}`,
        href: "/matches.html",
      })),
  );

  return { q, groups, total: groups.reduce((t, g) => t + g.items.length + (g.more || 0), 0) };
}
