// Page blocks (the owner 2026-11-14: "use pipeline, admin etc. as part of the 2D landscape in their set view so people
// don't need the pages if they don't want them; same goes for 3D and Neural").
// A block is one hub page's working part (its sections and its script) as a module that can be mounted anywhere: in
// its own page (public/<page>.html is now a thin wrapper), or over the campus in 2D, 3D or Neural
// (public/campus/blocks.js). Each block file exports `html` and `mount(root, opts)`, which returns `{ unmount }`.
// This file is the small kit they share. Which blocks exist, and where each lives, is public/parts/registry.js.
//
// The block contract (the owner's plan, 2026-11-14). Phase 1 ships the full level only; the other levels are added block by
// block and must keep to this shape so every view and the command bar can share them:
//   mount(root, opts) -> { unmount }      FULL: the whole page, in its own page or in the campus sheet.
//   actions: [{ id, label, words, needsPassword, run(args) }]
//                                         ONE action layer. Every button in the block, every prop, every Neural node
//                                         and the command bar call these, never their own copies. run() calls the same
//                                         api(...) the page uses; the server still checks the dashboard password
//                                         (requirePasswordConfirmed) for anything that spends money or writes to GitHub.
//                                         An action runs only from the owner's own tap, click or typed command (a
//                                         trusted event), never from text inside a page, a reply or a tool's output.
//   glance() -> { line, items, actions }  GLANCE: one line of live status; items are the interactive things a prop
//                                         shows (a video on the queue board, a desk's meter), each { id, label, state,
//                                         actions: [action ids] }; actions are the 2-3 quick ones. Each view draws the
//                                         items its own way (2D hit-testing, 3D raycast, Neural child nodes). Dragging
//                                         always has a tap twin ("Move to…") for phones.

// Element lookup inside the block. Ids are the page's own, looked up inside `root` only, so the block never reaches
// into the campus around it. After unmount a late answer from the hub writes into a throwaway element instead of
// throwing.
export function scope(root) {
  const $ = (id) => root.querySelector(`#${CSS.escape(id)}`) || document.createElement("div");
  $.all = (sel) => root.querySelectorAll(sel);
  $.one = (sel) => root.querySelector(sel);
  return $;
}

// Timers and listeners that stop when the block is closed. `life.alive` is false after stop().
export function lifecycle() {
  const stops = [];
  const life = {
    alive: true,
    every(fn, ms) { const id = setInterval(() => life.alive && fn(), ms); stops.push(() => clearInterval(id)); return id; },
    later(fn, ms) { const id = setTimeout(() => life.alive && fn(), ms); stops.push(() => clearTimeout(id)); return id; },
    on(target, type, fn, opts) { target.addEventListener(type, fn, opts); stops.push(() => target.removeEventListener(type, fn, opts)); },
    add(stop) { stops.push(stop); },
    stop() { life.alive = false; while (stops.length) { try { stops.pop()(); } catch {} } },
  };
  return life;
}

// The plain helper scripts some pages use (timing.js -> window.timing, runlog.js -> window.runLog), loaded once.
const loading = new Map();
export function needScripts(srcs) {
  return Promise.all(srcs.map((src) => {
    if (loading.has(src)) return loading.get(src);
    const have = [...document.scripts].find((s) => s.getAttribute("src") === src);
    const p = new Promise((resolve, reject) => {
      if (have && (src !== "/timing.js" || window.timing) && (src !== "/runlog.js" || window.runLog)) return resolve();
      const s = have || document.createElement("script");
      s.addEventListener("load", resolve);
      s.addEventListener("error", () => reject(new Error(`${src} didn't load`)));
      if (!have) { s.src = src; document.head.append(s); }
    });
    loading.set(src, p);
    return p;
  }));
}
