// Campus: the command bar's matcher (page blocks, step 3). Pure: no page, no network, so the tests run it as it is
// (test/hub/command-bar.test.mjs). The bar itself (what it shows, what runs) is public/campus/command.js.
// Part of public/campus.html; shares one global scope with the other parts, so everything here is inside this
// function except window.campusCmdMatch.
(function () {
  // small words a command never needs; everything else typed has to match, so a sentence ("fix the login bug") never
  // runs an action by accident: it goes to a worker as a job instead
  const STOP = new Set(["a", "an", "the", "to", "my", "it", "its", "this", "that", "of", "for", "on", "in", "please", "me"]);
  const norm = (s) => String(s ?? "").toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}$.]+/gu, " ").trim();
  const toks = (s) => norm(s).split(" ").filter(Boolean);
  const isNum = (t) => /^\$?\d+(\.\d+)?$/.test(t);

  // How well typed text fits one entry { label, words, target?, takes?, boost? }. 0 = no match.
  // takes: "number" (needs one, e.g. a cap in dollars) or "number?" (uses one if typed, e.g. a daily alert's dollars).
  // Every typed word (minus the small ones) must start one of the entry's words (label, words, target); an entry that
  // takes a number ("cap 40") also takes a number typed anywhere. Whole words count more than starts.
  function score(entry, text) {
    const q = toks(text).filter((t) => !STOP.has(t));
    if (!q.length) return 0;
    const hay = [...toks(entry.label), ...(entry.words || []).flatMap(toks), ...toks(entry.target)];
    const first = toks(entry.label)[0] || "";
    let s = 0, used = 0;
    for (const t of q) {
      if (String(entry.takes || "").startsWith("number") && isNum(t)) { s += 1; continue; }
      if (hay.includes(t)) { s += 3; used++; continue; }
      if (t.length >= 2 && hay.some((h) => h.startsWith(t))) { s += 2; used++; continue; }
      return 0;
    }
    if (!used) return 0;
    if (first.startsWith(q[0])) s += 1;
    return s + (entry.boost || 0);
  }

  // The best entries for what's typed, best first (ties keep the catalogue's order). [{ entry, score, arg }]
  function match(text, entries, limit = 8) {
    const out = [];
    entries.forEach((entry, i) => {
      const sc = score(entry, text);
      if (sc > 0) out.push({ entry, score: sc, i, arg: entry.takes ? numberIn(text) ?? undefined : undefined });
    });
    return out.filter((x) => x.entry.takes !== "number" || x.arg != null).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit);
  }
  const numberIn = (text) => { const t = toks(text).find(isNum); return t == null ? null : Number(t.replace("$", "")); };

  // The built-in commands, typed exactly: help, rooms, open <page>, view 2d|3d|neural|pages. null when it isn't one.
  // open's page is matched against the blocks ({ page, title }) by its name or the start of its title.
  function builtin(text, blocks = []) {
    const t = norm(text);
    if (t === "help" || t === "?" || String(text).trim() === "?") return { cmd: "help" };
    if (t === "rooms" || t === "room") return { cmd: "rooms" };
    let m = /^view (2d|3d|neural|pages)$/.exec(t);
    if (m) return { cmd: "view", arg: m[1] };
    m = /^open (.+)$/.exec(t);
    if (m) {
      const want = m[1].trim();
      const b = blocks.find((x) => x.page === want || norm(x.title) === want) || blocks.find((x) => norm(x.title).startsWith(want) || x.page.startsWith(want));
      return b ? { cmd: "open", arg: b.page } : { cmd: "open", arg: null, want };
    }
    return null;
  }

  // Who a job goes to by default: the lead of the team that owns where you are (the building you're in, or the worker
  // picked in Neural), else hub-builder. desks: the roster's desks ({ id, room, lead, status }).
  function defaultWorker({ room = null, picked = null, desks = [] } = {}) {
    const live = (d) => d && d.status !== "retired" && d.status !== "paused";
    const pd = picked && desks.find((d) => d.id === picked);
    const r = pd?.room || room;
    const lead = r && desks.find((d) => d.room === r && d.lead && live(d));
    if (lead) return lead.id;
    if (pd && live(pd)) return pd.id;
    return desks.some((d) => d.id === "hub-builder") || !desks.length ? "hub-builder" : desks.find(live)?.id || "hub-builder";
  }

  window.campusCmdMatch = { norm, score, match, builtin, defaultWorker, STOP };
})();
