// Which hub pages can be used inside the campus views (2D, 3D, Neural) and where each one lives.
// Plain script (not a module) so the campus parts (public/campus/blocks.js) and the tests read the same list.
//   page    public/<page>.html and its block public/parts/<page>.js. The block shows only while the page's part is on
//           (src/hub/modules.js: the part that lists this page; offPages from /api/hub/settings).
//   rooms   the buildings whose doors open it (campus room ids, as in DOORS in public/campus/panels.js). In Neural it
//           shows on a worker from one of these rooms; "control" also covers you (the owner).
//   door    its DOOR key in panels.js (the door that opens it).
//   team    who owns it (the owner 2026-11-14: "ensure workers who match the page type own that converting"): a roster room
//           and its lead desk, checked against the live roster when the block was added. The sheet says "Pipeline ·
//           YouTube and TikTok team". A team that's no longer in the roster falls back to the hub (campus/blocks.js).
// Phase 2 (pages not converted yet, their proposed homes and estimates): docs/projects/hub/campus.md, "Page blocks".
(() => {
const YT = { room: "youtube", lead: "youtube-lead" };
const CARDS = { room: "cards", lead: "cards-lead" };
const HUB = { room: "hub", lead: "hub-builder" };
window.hubBlocks = [
  { page: "pipeline", title: "Pipeline", icon: "▶", rooms: ["youtube"], door: "pipeline", team: YT, about: "Add a video, the jobs and their holds, TikTok catch-up." },
  { page: "admin", title: "Admin", icon: "⚙︎", rooms: ["control", "hub"], door: "admin", team: { room: "hub", lead: "hub-builder" }, about: "Health, controls, backups, phone alerts, devices, logs." },
  { page: "ai", title: "AI and spend", icon: "✦", rooms: ["control", "hub"], door: "ai", team: { room: "finance", lead: "finance-lead" }, about: "Credit left, AI spend, alerts and forecast, which model does each step." },
  { page: "queue", title: "Queue", icon: "≡", rooms: ["youtube"], door: "queue", team: YT, about: "What's running now, what's waiting, what's coming up when." },
  { page: "calendar", title: "Posting calendar", icon: "▦", rooms: ["youtube"], door: "calendar", team: YT, about: "Every YouTube and TikTok post, what went out and what's booked." },
  { page: "stats", title: "Stats", icon: "▤", rooms: ["youtube"], door: "stats", team: YT, about: "Channel stats from each channel's tracker, quick and full pulls." },
  { page: "stats-tiktok", title: "TikTok stats", icon: "♪", rooms: ["youtube"], door: "statsTt", team: YT, about: "Every TikTok post with its numbers, next to how the clip did on YouTube." },
  { page: "youtube-settings", title: "YouTube settings", icon: "⚑", rooms: ["youtube"], door: "ytSettings", team: YT, about: "Posting times and each channel's own checks." },
  { page: "todo", title: "To-do and ideas", icon: "✎", rooms: ["control"], door: "todo", team: HUB, about: "Throw ideas in, sort them later; items from Ask Claude and the rules review land here." },
  { page: "project", title: "Project", icon: "◔", rooms: ["control"], door: "project", team: HUB, about: "How much of the hub is built, how far in we are, how the to-do has grown." },
  { page: "search", title: "Search everything", icon: "⌕", rooms: ["control"], door: "search", team: HUB, about: "Cards, anime and manga, videos, to-dos, matches, decks and pages in one box." },
  { page: "home", title: "Home", icon: "⌂", rooms: ["control"], door: "home", team: HUB, about: "The classic home page: health, what needs you, YouTube at a glance." },
  { page: "agents", title: "Agents", icon: "◎", rooms: ["control", "hub"], door: "agents", team: HUB, about: "Who is working on what, what it costs, who is asking for more staff." },
  { page: "collection", title: "Collection", icon: "▦", rooms: ["cards"], door: "collection", team: CARDS, about: "Every card you own, matched on Scryfall and valued in CAD." },
  { page: "cards", title: "Price a card", icon: "$", rooms: ["cards"], door: "price", team: CARDS, about: "Snap a card for TCGplayer, {shop} and {buylist} prices." },
  { page: "deals", title: "Deal watch", icon: "◎", rooms: ["cards"], door: "deals", team: CARDS, about: "Damaged cards at {shop} against their Near Mint price, your deck and upgrade picks." },
  { page: "matches", title: "Paper matches", icon: "⚀", rooms: ["cards"], door: "matches", team: CARDS, about: "Log each paper match; win rates and the local meta build from there." },
  { page: "deckideas", title: "Deck ideas", icon: "✦", rooms: ["cards"], door: "deckideas", team: CARDS, about: "Decks you can build from cards you own, missing cards priced on Scryfall." },
  // Gaming and Leisure have no lead in the roster yet (no desk with lead: true in room gaming, no leisure room), so the hub team owns these.
  { page: "games", title: "Games", icon: "🎮", rooms: ["gaming"], door: "games", team: HUB, about: "Every game you play: where you are with it, hours, notes and a log." },
  { page: "arena", title: "MTG Arena", icon: "⚔", rooms: ["gaming"], door: "arena", team: HUB, about: "Your Arena matches, decks and win rates, read from Arena's own log." },
  { page: "wow", title: "WoW raids", icon: "⚑", rooms: ["gaming"], door: "wow", team: HUB, about: "Warcraft Logs parses and recent raids, per character." },
  { page: "reading", title: "Watching and reading", icon: "❖", rooms: ["leisure"], door: "reading", team: HUB, about: "Anime and manga in one list, with what has come out since you last caught up." },
];
// Drop-in add-ons that are switched on (src/addons/loader.js): asked once. window.hubAddons resolves to [{ id, name, pages, panel? }]
// (an empty list when none are on, so nothing changes on screen). An add-on's panel script is loaded here; its pages are
// added to the campus Control building by DOOR/DOORS in campus/panels.js. Skipped where there is no fetch or page (tests).
window.hubAddons = typeof fetch === "function" && typeof document !== "undefined"
  ? fetch("/api/addons/client").then((r) => (r.ok ? r.json() : [])).catch(() => []).then((list) => {
      list = Array.isArray(list) ? list : [];
      for (const a of list) {
        if (typeof a.panel !== "string" || !/^\/addons\/[a-z0-9-]+\/panel\.js$/.test(a.panel)) continue;
        const el = document.createElement("script");
        el.src = a.panel;
        (document.head || document.documentElement).appendChild(el);
      }
      return list;
    })
  : Promise.resolve([]);
})();
