// Campus: personalities, names, the pet, celebrations, couriers and walkers. Part of public/campus.html, loaded in order by campus/boot.js;
// the files share one global scope (classic scripts), so a name defined in one is visible in the others.
"use strict";
// ---------- personalities ----------
// Every desk gets a lasting trait from its name. Idle bots think out loud: a mix of their trait and what's
// really going on with them (budget, status, the last thing they did, the inbox). Two idle bots at the meeting
// table have a quick chat. Paused bots dream.
const TRAITS = {
  caffeinated: ["third espresso, still sleepy", "is the cart open?", "I can hear the steam wand"],
  meticulous: ["triple-checking that", "found a typo. fixed it.", "this needs a test"],
  chatty: ["has anyone tried the kombucha?", "who rang the gong?", "sync at the table?"],
  "night owl": ["best ideas come after dark", "lights low, focus high", "is it night yet?"],
  zen: ["one task at a time", "breathe in, ship out", "the fountain is calming"],
  dramatic: ["this changes everything", "the slide is my exit", "I was born for this ticket"],
  scrappy: ["duct tape will hold", "good enough to ship", "shortcut found"],
  perfectionist: ["one more pass", "the margins are off", "almost perfect"],
};
const TRAIT_NAMES = Object.keys(TRAITS);
const traitOf = (id) => TRAIT_NAMES[[...String(id)].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 7) % TRAIT_NAMES.length];
// ---------- names and job titles ----------
// Every worker gets a first name (lasting: picked from its desk id, never two alike) and a job title from its
// role. A desk can set its own with "name" / "title" in roster.json. Original names only; no real people.
const NAMES = ["Pixel", "Juniper", "Bolt", "Mochi", "Ziggy", "Clover", "Orbit", "Nova", "Biscuit", "Echo", "Tofu", "Marlo", "Sprocket", "Wren", "Quill", "Basil", "Cosmo", "Indigo", "Pip", "Sage", "Toast", "Atlas", "Fig", "Kiwi", "Dot", "Nimbus", "Hazel", "Jinx", "Ollie", "Pesto", "Ruby", "Scout", "Tango", "Umber", "Vesper", "Waffle", "Yuzu", "Zephyr", "Gizmo", "Lumen", "Maple", "Nugget", "Opal", "Pebble", "Quinoa", "Rook", "Sprout", "Tinker", "Velvet"];
let nameById = {};
function assignNames(desks) {
  const taken = new Set(desks.map((d) => d.name).filter(Boolean)), out = {};
  for (const d of [...desks].sort((a, b) => a.id.localeCompare(b.id))) {
    if (d.name) { out[d.id] = d.name; continue; }
    let i = [...String(d.id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 11) % NAMES.length, n = 0;
    while (taken.has(NAMES[i]) && n++ < NAMES.length) i = (i + 1) % NAMES.length;
    out[d.id] = NAMES[i]; taken.add(NAMES[i]);
  }
  nameById = out;
}
// Sessions in a folder no project claims (hook-map.json) report as a temp worker (the owner 2026-11-13: "just get a temp
// worker tag"); "claude-code" is what older events used.
const TEMP_DESK = /^(temp-worker|claude-code)$/;
const tempName = (id) => (TEMP_DESK.test(String(id || "")) ? "Temp worker" : null);
const roomLabel = (id, named) => named || (id === "unassigned" ? "Temp workers" : id || "");
// Work a desk did for another project without a loan (its last event says forRoom), in the last 2 hours: the hub's
// security reviewer on another project's PRs, for example. Shown on its panel and name tag; a loan has its own 🤝 mark.
function helpingFor(d, hours = 2) {
  const e = (data?.feed || []).find((f) => f.desk === d?.id && f.kind === "agent event");
  if (!e?.forRoom || Date.now() - Date.parse(e.startedAt) > hours * 3600e3) return null;
  return { room: e.forRoom, name: roomLabel(e.forRoom, (data.rooms || []).find((r) => r.id === e.forRoom)?.name), at: e.startedAt, summary: e.summary };
}
const nameOf = (d) => d?.name || nameById[d?.id] || tempName(d?.id) || "New hire";
const TITLE_RULES = [
  [/watchdog|on call/i, "Ops on call"], [/watch\b|-check\b/i, "Watcher"], [/scout|trend/i, "Trend Scout"], [/strateg/i, "Strategist"], [/narrat/i, "Narrator"], [/co-?pilot|advis/i, "Advisor"],
  [/^hr$|\bhr\b/i, "Head of People"], [/merge/i, "Release Manager"], [/sweep|scheduled/i, "Ops on call"],
  [/design|fable|architect/i, "Principal Designer"], [/review/i, "Code Reviewer"], [/secur/i, "Security Lead"],
  [/pc-builder|builder|build/i, "Build Engineer"], [/cloud/i, "Cloud Engineer"], [/gemini|research|argon/i, "Research Analyst"],
  [/art|pixel|sprite/i, "Artist"], [/test|qa|playtest|soak/i, "QA Tester"], [/balance/i, "Balance Analyst"], [/docs?\b|writer/i, "Technical Writer"],
  [/clip|edit/i, "Clip Editor"], [/upload|pipeline/i, "Pipeline Operator"], [/post|social|schedul/i, "Social Producer"],
  [/price|deal|card/i, "Market Analyst"], [/mod|lua|script/i, "Modder"], [/hub-builder|hub/i, "Hub Engineer"],
];
function titleOf(d) {
  if (!d) return "";
  if (d.title) return d.title;
  if (d.stray) return "Visitor";
  if (d.lead) return d.room === "hr" ? "Head of People" : "Project Lead";
  // Gemini workers: titled by their specialty (another project-gemini-qa → QA Tester).
  if (/gemini/i.test(d.id)) { const sp = d.id.split("gemini")[1] || ""; return /design/.test(sp) ? "Design Assistant" : /build/.test(sp) ? "Build Assistant" : /audit/.test(sp) ? "Auditor" : /qa|test/.test(sp) ? "QA Tester" : "Research Analyst"; }
  const hay = `${d.id} ${d.role || ""}`;
  for (const [re, t] of TITLE_RULES) if (re.test(d.id)) return t;
  for (const [re, t] of TITLE_RULES) if (re.test(hay)) return t;
  return "Specialist";
}
// The work flow of an active desk: its last few steps (oldest first) within the active window.
const STEP = { "hand-off refused": "✋ kept it", "job handed over": "🔗 got hand-off", "job given": "📌 new job", "session start": "start", "turn done": "reply", "files changed": "edit", "job done": "✓ job", "job taken": "took job", "cloud report": "report", "tool used": "tool" };
function flowOf(room, deskId) {
  const steps = (room?.feed || []).filter((f) => f.kind === "agent event" && f.desk === deskId && Date.now() - Date.parse(f.startedAt) < ACTIVE_MS).slice(0, 4).reverse();
  return steps.map((f) => {
    const verb = STEP[f.action] || f.action || "step";
    const what = f.action === "files changed" ? String(f.summary || "").replace(/^\d+ files?:\s*/, "") : f.tool || "";
    return what ? `${verb} ${what}`.slice(0, 22) : verb;
  });
}
// A small strip above a working bot: step › step › step, the newest one lit.
function flowStrip(x, y, steps, t) {
  if (!steps.length) return;
  ctx.font = "600 10px system-ui"; ctx.textBaseline = "alphabetic";
  const ws = steps.map((st) => ctx.measureText(st).width + 10), gap = 12, total = ws.reduce((a, w) => a + w, 0) + gap * (steps.length - 1);
  let cx = x - total / 2;
  steps.forEach((st, i) => {
    const last = i === steps.length - 1;
    ctx.fillStyle = last ? `rgba(125,220,138,${0.85 + 0.15 * Math.sin(t / 200)})` : "rgba(15,18,24,0.82)";
    roundRect(cx, y - 15, ws[i], 15, 5); ctx.fill();
    ctx.fillStyle = last ? "#10261a" : "#d9d2c3"; ctx.textAlign = "left"; ctx.fillText(st, cx + 5, y - 4);
    cx += ws[i];
    if (!last) { ctx.fillStyle = "rgba(233,228,216,0.75)"; ctx.textAlign = "center"; ctx.fillText("›", cx + gap / 2, y - 4); cx += gap; }
  });
}
// The shirt (the owner, 2026-11-09): the shirt colour is the provider; the chest says the model and version; the
// dots on the belt are the effort (1 low … 5 max); the pocket coin says how it's paid: gold "$" = API (pay per use), blue "S" = subscription.
// Only drawn when zoomed in enough to read.
function modelCode(d) {
  const m = String(d.model || "").toLowerCase(), v = (m.match(/(\d+(?:[.-]\d+)?)/) || [])[1]?.replace("-", ".") || "";
  if (/per job|mixed/.test(m)) return "MIX";
  if (/claude-code/.test(m)) return "CC";
  if (/scheduled/.test(m)) return "⏰";
  // Gemini by model (the owner 2026-11-09): GA = Argon, GP = Pro, GF = Flash, GL = Flash-Lite, plus the version if any.
  if (/argon|gemini/.test(m)) { const g = /argon/.test(m) ? "GA" : /lite/.test(m) ? "GL" : /flash/.test(m) ? "GF" : /pro/.test(m) ? "GP" : "G"; return v ? `${g}${v}` : g; }
  const code = /opus/.test(m) ? "O" : /sonnet/.test(m) ? "S" : /haiku/.test(m) ? "H" : /fable/.test(m) ? "F" : /mythos/.test(m) ? "M" : /argon|gemini/.test(m) ? "G" : /grok/.test(m) ? "X" : /gpt|openai/.test(m) || d.provider === "openai" ? "GPT" : /deepseek/.test(m) || d.provider === "deepseek" ? "DS" : /muse/.test(m) || d.provider === "muse" ? "MU" : d.provider === "local" ? "LOC" : /project thread|thread/.test(m) ? "T" : (d.provider || "?")[0].toUpperCase();
  return v && code.length === 1 ? `${code}${v}` : code;
}
const EFFORT = { low: 1, medium: 2, high: 3, xhigh: 4, max: 5 };
// How a worker is paid (the owner 2026-11-09): "api" (pay per use, counts against caps) or "sub" (a subscription: Claude Code,
// project threads, scheduled tasks, local Gemini/Antigravity, chats). A desk's own "billing" field wins; otherwise inferred.
function billingOf(d) {
  if (d.billing === "api" || d.billing === "sub" || d.billing === "free") return d.billing;
  if (d.provider === "local") return "free"; // local models (Ollama, LM Studio) cost nothing
  const m = String(d.model || "").toLowerCase();
  if (d.runner === "hub" || d.provider === "mixed" || d.id === "hr") return "api";
  if (/claude-code|thread|scheduled|argon/.test(m) || d.runner === "local") return "sub";
  if (/free/.test(m)) return "free";
  if ((d.capUsdMonth || 0) > 0 || (d.monthUsd || 0) > 0) return "api";
  return "sub";
}
const BILLING = { api: { coin: "#ffd166", ink: "#5a4200", mark: "$", icon: "💲", label: "API", tip: "API: pays per use, counts against its cap" }, sub: { coin: "#7fb6ff", ink: "#12305e", mark: "S", icon: "🔁", label: "Sub", tip: "Subscription: covered by a flat plan, no per-use cost" }, free: { coin: "#cfd6de", ink: "#3a4048", mark: "F", icon: "🆓", label: "Free", tip: "Free tier" } };
function shirt(x, top, s, d) {
  ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.textAlign = "center";
  ctx.font = `800 ${Math.max(6, 5.2 * s)}px system-ui`; ctx.fillText(modelCode(d), x, top + 7 * s);
  const n = EFFORT[String(d.effort || "").toLowerCase()] || 0;
  for (let i = 0; i < 5; i++) { ctx.fillStyle = i < n ? "#ffd166" : "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.arc(x + (i - 2) * 2.4 * s, top + 11.5 * s, 0.85 * s, 0, Math.PI * 2); ctx.fill(); }
  const b = BILLING[billingOf(d)]; ctx.fillStyle = b.coin; ctx.beginPath(); ctx.arc(x + 4.6 * s, top + 3 * s, 2 * s, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = b.ink; ctx.font = `800 ${2.8 * s}px system-ui`; ctx.fillText(b.mark, x + 4.6 * s, top + 4 * s);
}
// Name plate at a bot's feet; the title too when zoomed in.
function namePlate(x, y, d, active) {
  const own = autoOf(d.id), big = cam.z > 0.9, loan = d.onLoan && (projects.find((p) => p.id === d.homeRoom)?.name || d.homeRoom);
  const help = loan ? null : helpingFor(d);
  const text = `${own ? "🟢 " : ""}${loan ? "🤝 " : ""}${help ? "🔍 " : ""}${big ? `${nameOf(d)} · ${titleOf(d)}` : nameOf(d)}${own && big ? ` · on its own till ${untilTxt(own.until)}` : ""}${loan ? ` · on loan from ${loan}` : ""}${help && big ? ` · helping ${help.name}` : ""}`;
  ctx.font = `600 ${big ? 10 : 9}px system-ui`;
  const w = ctx.measureText(text).width + 8;
  ctx.fillStyle = active ? "rgba(20,60,34,0.88)" : "rgba(15,18,24,0.7)"; roundRect(x - w / 2, y + 2, w, 13, 4); ctx.fill();
  ctx.fillStyle = active ? "#bff0c8" : "#e9e4d8"; ctx.textAlign = "center"; ctx.fillText(text, x, y + 12);
}
const DREAMS = ["dreaming of merged PRs", "dreaming of a bigger cap", "zzz… espresso…", "dreaming of the slide"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function thoughtFor(b) {
  const d = b.d;
  if (d.status === "paused") return pick(DREAMS);
  const mine = jobsByDesk[d.id] || [];
  if (mine.length && Math.random() < 0.6) return mine[0].status === "taken" ? pick(["on it, boss", `working on ${OWN()}'s job`, "almost there"]) : pick([`new job from ${OWN()}!`, `${mine.length} job${mine.length === 1 ? "" : "s"} on my desk`, "ooh, a sticky note"]);
  const real = [];
  if (d.stray) real.push("do I have a desk yet?");
  if (d.status === "planned") real.push("first day soon?", "waiting on HR…");
  if (d.overCap) real.push("am I over budget?!");
  else if (d.capUsdMonth && d.monthUsd > d.capUsdMonth * 0.6) real.push("watching my budget");
  if (d.lead) real.push("need to check the board", "who needs a hand?");
  if (inbox.length) real.push(`did ${OWN()} see the request?`);
  if (recentDecision()) real.push("someone rang the gong!");
  if (b.last?.summary) real.push(`still thinking about ${String(b.last.summary).slice(0, 18)}`);
  // their grown self (agents/selves.js): what they're into, who they're close to
  const me = data?.selves?.[d.id];
  if (me) {
    for (const t of (me.into || []).slice(0, 3)) real.push(pick([`can't stop thinking about ${t}`, `${t}, though…`, `more ${t} later`]));
    const f = (me.friends || [])[0], fd = f && data.desks.find((x) => x.id === f.desk);
    if (fd) real.push(`wonder what ${nameOf(fd)} is up to`);
  }
  if (d.provider === "gemini") real.push("I have twelve ideas", "drafting something big");
  if (d.provider === "grok") real.push("what's trending?");
  if (hasPet() && Math.random() < 0.12) real.push(pick([`hope ${PET()} visits our floor`, `${PET()} is the best CEO`, `wonder where ${PET()} is napping`]));
  return Math.random() < 0.55 && real.length ? pick(real) : pick(TRAITS[traitOf(d.id)]);
}
// ---------- texting (the owner 2026-11-09) ----------
// The hub writes a text when one desk hands work to another and when it comes back done (data.texts). Each sender
// words it in their own voice, from their trait. Workers who pass each other outside, or share a meeting table,
// bring up their latest texts.
const VOICE = {
  caffeinated: { hi: "quick one, coffee in hand ☕", done: "done!! next?" },
  meticulous: { hi: "Passing this on, details below:", done: "Done and double-checked." },
  chatty: { hi: "hey hey! got one for you 😄", done: "all done! tell me how it goes!" },
  "night owl": { hi: "late-night handoff 🌙", done: "wrapped up while it was quiet." },
  zen: { hi: "One task, for you:", done: "Finished. 🍃" },
  dramatic: { hi: "URGENT (not really) 🎭", done: "It is DONE. Behold." },
  scrappy: { hi: "rough but it'll do:", done: "shipped it, held with tape 🔧" },
  perfectionist: { hi: "Please read carefully:", done: "Done. One more pass would help, but it's ready." },
};
const shortText = (x, n = 60) => { const v = String(x || "").replace(/\s+/g, " ").trim(); return v.length > n ? v.slice(0, n - 1) + "…" : v; };
function textWords(m) {
  const v = VOICE[traitOf(m.from)] || VOICE.zen;
  return m.kind === "handoff" ? `${v.hi} ${m.text}`.trim() : m.kind === "done" ? `${v.done}${m.text ? ` ${m.text}` : ""}` : m.text;
}
const textsWith = (id) => (data?.texts || []).filter((m) => m.from === id || m.to === id);
const textsBetween = (a, b) => (data?.texts || []).filter((m) => (m.from === a && m.to === b) || (m.from === b && m.to === a));
const deskById = (id) => data?.desks?.find((d) => d.id === id);
// The two lines two workers say when they meet: their latest texts if they have any, else small talk.
function meetLines(a, b) {
  const both = textsBetween(a.id, b.id).slice(-2);
  if (both.length) {
    const last = both[both.length - 1];
    // a chat pair (one text and its reply): they act it out
    if (last.kind === "chat" && both.length === 2 && both[0].kind === "chat" && both[0].from !== last.from) {
      const first = both[0].from === a.id ? a : b;
      return [`📱 ${shortText(both[0].text, 44)}`, shortText(last.text, 44), first, first === a ? b : a];
    }
    const first = last.from === a.id ? a : b, second = first === a ? b : a;
    return [`📱 ${shortText(textWords(last), 44)}`, last.kind === "handoff" ? "on it 👍" : last.kind === "done" ? "thanks! 🙌" : last.kind === "short" ? pick(["😂 watching it now", "ok that's amazing", "sending it to everyone"]) : "👍", first, second];
  }
  const c = pick(CHATS);
  return [c[0], c[1], a, b];
}
const CHATS = [["sync?", "sync."], ["kombucha later?", "always"], ["did you see the fountain?", "budget's fine"], ["slide or stairs?", "slide."], ["nice commit", "thanks!"]];
function think(dt, t) {
  const list = [...bots.values()].filter((b) => b.room);
  for (const b of list) {
    if (b.thought && t > b.thought.until) b.thought = null;
    if (b.thought || b.active) continue;
    if (Math.random() < dt * (b.d.status === "paused" ? 0.03 : 0.06)) b.thought = { text: thoughtFor(b), until: t + 3500 };
  }
  // two idle bots at the same meeting table have a chat
  for (const room of rooms) {
    const tp = view && room.staff && tablePos(room);
    if (!tp) continue;
    const near = list.filter((b) => b.room === room && !b.active && !b.thought && Math.hypot(b.x - tp.x, b.y - tp.y) < 1.4);
    if (near.length >= 2 && Math.random() < dt * 0.5) {
      const [l1, l2, d1] = meetLines(near[0].d, near[1].d), [p1, p2] = d1 === near[0].d ? [near[0], near[1]] : [near[1], near[0]];
      p1.thought = { text: l1, until: t + 3400, say: true };
      p2.thought = { text: l2, until: t + 4200, say: true, from: t + 1100 };
    }
  }
}
function thoughtBubble(x, y, text, say) {
  ctx.font = `${11}px system-ui`;
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = say ? "rgba(250,246,236,0.95)" : "rgba(235,240,255,0.92)";
  roundRect(x - w / 2, y - 19, w, 19, 9); ctx.fill();
  if (say) { ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 5); ctx.fill(); }
  else { ctx.beginPath(); ctx.arc(x - 3, y + 3, 2.6, 0, Math.PI * 2); ctx.arc(x - 6, y + 8, 1.6, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = "#26221c"; ctx.textAlign = "center"; ctx.fillText(text, x, y - 6);
}

// ---------- the pet, CEO ----------
// the owner, 2026-11-09: "the pet should join campus" and "He's the CEO". He follows the pet rules from another project
// (docs/design/the pet-rules.md there): drawn in code here, never AI art; never locked, paused, staffed, costed or
// hurt; only kind words about him; and his look stays his: grey coat, white bib and mittens, the white stripe up
// his nose, green-gold eyes, pink nose, and his little Marilyn, the small dark beauty mark just right of his nose
// as you look at him. His office is the bed beside the owner's chair in the Control Center; he does walkabouts.
const rex = { x: null, y: null, tx: null, ty: null, mode: "nap", until: 0, spot: "office" };
const t0 = () => Math.floor(Date.now() / 600000); // changes every 10 minutes, so his patrol spot moves along
function rexSpots() {
  const cc = rooms.find((r) => r.isControl), le = rooms.find((r) => r.isLeisure), hr = rooms.find((r) => r.isHr && !r.paused);
  const out = {};
  if (cc) out.office = [cc.x + cc.w / 2 + 1.05, cc.y + cc.d / 2 + 0.6];
  if (squareAt()) out.fountain = [squareAt()[0] + 1.0, squareAt()[1] - 0.7];
  if (le && campus?.plan !== "bc") out.leisure = [le.x + le.w / 2 + 0.9, le.y + le.d + 0.7]; // across the river in plan B+C, and he walks straight
  // plan B+C (backlog: "the pet patrols Main street on sunny afternoons"): a sunny afternoon stroll on Main street's median
  const ms = campus?.roads?.find((r) => r.kind === "main"), hh = new Date().getHours();
  if (ms && hh >= 12 && hh < 17 && (typeof weather === "undefined" || !weather || ["clear", "sun", "sunny"].includes(weather.kind || "clear"))) out.mainstreet = [ms.x + ms.w / 2, ms.y + ms.d * (0.3 + ((t0()) % 5) / 10)];
  if (hr) out.sunny = [hr.x + hr.w + 0.8, hr.y + hr.d / 2];
  const pv = rooms.find((r) => r.isControl); // the board meets in the CEO tower (was the pavilion)
  if (pv) out.meeting = [pv.x + pv.w / 2, pv.y + pv.d + 0.9];
  return out;
}
const REX_PLACES = { meeting: "chairing the board meeting in the CEO tower", office: "napping in his office, next to your chair", fountain: "watching the fountain", leisure: "in the Leisure lobby", sunny: "in the sunny spot by HR", mainstreet: "patrolling Main street in the sun" };
function stepRex(dt, t) {
  const sp = rexSpots();
  if (!sp.office) return;
  if (!hasPet()) { rex.x = null; return; } // no campus pet in this hub (the kit's default)
  if (rex.x == null) { [rex.x, rex.y] = sp.office; [rex.tx, rex.ty] = sp.office; rex.until = t + 20000; }
  if (rex.pause && performance.now() < rex.pause) return; // being petted: he stops to enjoy it
  // The CEO chairs every stand-up: off to the head of the table when it starts, home to his office after.
  if (sp.meeting && meetingLive() && rex.spot !== "meeting") { rex.spot = "meeting"; [rex.tx, rex.ty] = sp.meeting; }
  else if (rex.spot === "meeting" && !meetingLive()) { rex.spot = "office"; [rex.tx, rex.ty] = sp.office; }
  // Weather routines (citylife2.js): in rain or snow he naps indoors, in his office; only his spot changes
  const indoors = typeof cityLife2 !== "undefined" && cityLife2.petIndoors();
  if (indoors && rex.spot !== "office" && rex.spot !== "meeting") { rex.spot = "office"; [rex.tx, rex.ty] = sp.office; }
  const dist = Math.hypot(rex.tx - rex.x, rex.ty - rex.y);
  if (dist > 0.04) { const k = Math.min(1, (0.45 * dt) / dist); rex.x += (rex.tx - rex.x) * k; rex.y += (rex.ty - rex.y) * k; rex.mode = "walk"; return; }
  if (rex.mode === "walk") { rex.mode = rex.spot === "office" ? "nap" : Math.random() < 0.5 ? "nap" : "sit"; rex.until = t + (rex.spot === "office" ? 60000 : 25000) * (0.6 + Math.random() * 0.8); }
  if (t < rex.until || rex.spot === "meeting") return;
  // Mostly back to his office; sometimes a walkabout.
  const keys = indoors ? [] : Object.keys(sp).filter((k) => k !== rex.spot && k !== "meeting");
  rex.spot = rex.spot !== "office" || !keys.length ? "office" : pick(keys);
  [rex.tx, rex.ty] = sp[rex.spot];
}
function drawPet(t) {
  if (rex.x == null) return;
  const [px, py] = toScreen(rex.x, rex.y, 0), s = Math.max(0.55, cam.z) * 1.15;
  const walking = rex.mode === "walk", asleep = rex.mode === "nap", bob = walking ? Math.abs(Math.sin(t / 140)) * 1.5 : 0;
  const breathe = asleep ? Math.sin(t / 900) * 0.4 : 0;
  const GREY = "#8e9299", DARK = "#6f737a", WHITE = "#f6f3ec";
  // his CEO bed and nameplate, when he's in his office
  if (rex.spot === "office" && !walking) {
    ctx.fillStyle = "#b89b6a"; ctx.beginPath(); ctx.ellipse(px, py, 17 * s, 8 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e8d9b8"; ctx.beginPath(); ctx.ellipse(px, py - 1 * s, 14 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#d9a441"; roundRect(px + 10 * s, py + 2 * s, 16 * s, 7 * s, 2 * s); ctx.fill();
    ctx.fillStyle = "#3b2a10"; ctx.font = `bold ${5.5 * s}px system-ui`; ctx.textAlign = "center"; ctx.fillText("CEO", px + 18 * s, py + 7.6 * s);
  }
  ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.beginPath(); ctx.ellipse(px, py, 11 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill();
  const y0 = py - bob * s;
  // tail, curled round
  ctx.strokeStyle = GREY; ctx.lineWidth = 3 * s; ctx.lineCap = "round";
  ctx.beginPath(); ctx.arc(px + 7 * s, y0 - 3 * s, 5 * s, -0.4 + Math.sin(t / 700) * 0.2, 2.2); ctx.stroke();
  // body (a loaf when resting), with a darker back
  ctx.fillStyle = GREY; ctx.beginPath(); ctx.ellipse(px, y0 - (6 + breathe) * s, 10 * s, (6.5 + breathe) * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = DARK; ctx.beginPath(); ctx.ellipse(px + 1 * s, y0 - (9.5 + breathe) * s, 7 * s, 2.6 * s, 0, 0, Math.PI * 2); ctx.fill();
  // white bib and mittens
  ctx.fillStyle = WHITE; ctx.beginPath(); ctx.ellipse(px - 0.5 * s, y0 - 5 * s, 4.2 * s, 3.4 * s, 0, 0, Math.PI * 2); ctx.fill();
  const paw = walking ? Math.sin(t / 140) * 1.2 : 0;
  ctx.beginPath(); ctx.ellipse(px - 3.6 * s + paw * s, y0 - 0.8 * s, 2.2 * s, 1.4 * s, 0, 0, Math.PI * 2); ctx.ellipse(px + 2.4 * s - paw * s, y0 - 0.8 * s, 2.2 * s, 1.4 * s, 0, 0, Math.PI * 2); ctx.fill();
  // head and ears
  const hx = px - 1 * s, hy = y0 - (15 + breathe) * s;
  ctx.fillStyle = GREY;
  ctx.beginPath(); ctx.moveTo(hx - 6 * s, hy - 2 * s); ctx.lineTo(hx - 4.6 * s, hy - 9 * s); ctx.lineTo(hx - 1.4 * s, hy - 4.4 * s); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(hx + 6 * s, hy - 2 * s); ctx.lineTo(hx + 4.6 * s, hy - 9 * s); ctx.lineTo(hx + 1.4 * s, hy - 4.4 * s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#e7a3a8";
  ctx.beginPath(); ctx.moveTo(hx - 4.8 * s, hy - 3 * s); ctx.lineTo(hx - 4.3 * s, hy - 7 * s); ctx.lineTo(hx - 2.4 * s, hy - 4.4 * s); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(hx + 4.8 * s, hy - 3 * s); ctx.lineTo(hx + 4.3 * s, hy - 7 * s); ctx.lineTo(hx + 2.4 * s, hy - 4.4 * s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = GREY; ctx.beginPath(); ctx.ellipse(hx, hy, 6.4 * s, 5.6 * s, 0, 0, Math.PI * 2); ctx.fill();
  // the white stripe up his nose, and his white muzzle
  ctx.fillStyle = WHITE;
  ctx.beginPath(); ctx.moveTo(hx - 0.9 * s, hy + 2 * s); ctx.lineTo(hx - 0.5 * s, hy - 5 * s); ctx.lineTo(hx + 0.5 * s, hy - 5 * s); ctx.lineTo(hx + 0.9 * s, hy + 2 * s); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.ellipse(hx, hy + 2.8 * s, 2.8 * s, 1.9 * s, 0, 0, Math.PI * 2); ctx.fill();
  // eyes: green-gold when awake, soft closed lines while he naps
  if (asleep) {
    ctx.strokeStyle = "#3a3d42"; ctx.lineWidth = 0.9 * s;
    for (const ex of [-2.6, 2.6]) { ctx.beginPath(); ctx.arc(hx + ex * s, hy - 0.6 * s, 1.3 * s, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
  } else {
    for (const ex of [-2.6, 2.6]) { ctx.fillStyle = "#c2b850"; ctx.beginPath(); ctx.ellipse(hx + ex * s, hy - 0.4 * s, 1.4 * s, 1.2 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#1b1f27"; ctx.fillRect(hx + ex * s - 0.3 * s, hy - 1.3 * s, 0.6 * s, 1.8 * s); }
  }
  // pink nose, and his little Marilyn just right of it (as you look at him)
  ctx.fillStyle = "#e58a95"; ctx.beginPath(); ctx.moveTo(hx - 1 * s, hy + 1.6 * s); ctx.lineTo(hx + 1 * s, hy + 1.6 * s); ctx.lineTo(hx, hy + 2.6 * s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#2a2522"; ctx.beginPath(); ctx.arc(hx + 2 * s, hy + 2.5 * s, 0.55 * s, 0, Math.PI * 2); ctx.fill();
  if (asleep && cam.z > 0.45) { ctx.fillStyle = "rgba(200,210,255,0.75)"; ctx.font = `bold ${7 * s}px system-ui`; ctx.textAlign = "left"; const zz = (t / 900) % 3; for (let i = 0; i < 3; i++) if (i <= zz) ctx.fillText("z", hx + (7 + i * 3) * s, hy - (6 + i * 4) * s); }
  rex.screen = [hx, hy];
}
function rexPanel() {
  openRoom = "pet";
  const p = document.getElementById("panel");
  p.innerHTML = `<div class="flex items-start gap-2"><h2 class="flex-1">${esc(PET())} <span class="sub">· CEO</span></h2><button id="pClose" class="pill" aria-label="Close">✕</button></div>
    <div class="row">Right now: ${esc(rex.mode === "walk" ? "on a walkabout" : REX_PLACES[rex.spot] || "around campus")}.</div>
    <div class="row">He runs the place. His office is the bed beside your chair in the Control Center, and he does walkabouts to the fountain, the Leisure lobby, the sunny spot by HR and Rivet's building. Every bot says hi when he passes.</div>
    <div class="row sub">Grey coat, white bib and mittens, the white stripe up his nose, green-gold eyes, pink nose, and his little Marilyn. Never on the payroll, never locked, never paused. The whole campus is his.</div>
    <div class="row"><button id="pPet" class="pill">♥ Pet him</button> <span class="sub" id="pPets"></span></div>`;
  p.classList.add("open");
  document.getElementById("pClose").onclick = closePanel;
  const pets = () => { let n = 0; try { n = Number(localStorage.getItem("campus.pets") || 0); } catch {} document.getElementById("pPets").textContent = n ? `${n} pet${n === 1 ? "" : "s"} so far. He's purring.` : "He likes chin scratches."; };
  pets();
  document.getElementById("pPet").onclick = () => {
    if (window.campus3dActive && window.strokePet) window.strokePet();
    else { try { localStorage.setItem("campus.pets", String(Number(localStorage.getItem("campus.pets") || 0) + 1)); } catch {} toast("prrrr ♥"); }
    pets();
  };
}
const REX_HELLO = ["hi {pet}!", "morning, boss", "the CEO is here!", "{pet} approves", "best CEO ever", "hello, Mr. {pet}"];
const REX_SHH = ["shh, the CEO is napping", "don't wake the boss", "{pet}'s asleep. aww"];

// ---------- celebrations and treats ----------
// Confetti over a building for 10 minutes after real work ships there: a job done, or a report that says it
// merged, released, shipped or tagged something. Real data only, so it means something when you see it.
const SHIPPED = /\b(merged|released|shipped|tagged|launched|published|uploaded)\b/i;
function celebrating(r) {
  return (r.feed || []).some((f) => f.kind === "agent event" && Date.now() - Date.parse(f.startedAt) < 10 * 60000 && (f.action === "job done" || SHIPPED.test(f.summary || "")));
}
const CONFETTI = ["#e05d5d", "#f0b45a", "#7ddc8a", "#6ea8ff", "#b48cff", "#f2ead8"];
function drawConfetti(r, t) {
  const [cx, cy] = toScreen(r.x + r.w / 2, r.y + r.d / 2, (r.h || 1.5) + 0.6), s = cam.z;
  for (let i = 0; i < 26; i++) {
    const ph = ((t / 2600) + i * 0.137) % 1, ang = i * 2.39996;
    const x = cx + Math.cos(ang) * (8 + ph * 46) * s + Math.sin(t / 400 + i) * 3 * s;
    const y = cy - (1 - ph) * 40 * s + ph * ph * 60 * s;
    ctx.save(); ctx.translate(x, y); ctx.rotate(t / 300 + i); ctx.globalAlpha = 1 - ph * 0.8;
    ctx.fillStyle = CONFETTI[i % CONFETTI.length]; ctx.fillRect(-2.2 * s, -1.2 * s, 4.4 * s, 2.4 * s);
    ctx.restore();
  }
  if (cam.z > 0.45) { const [bx, by] = toScreen(r.x + r.w / 2, r.y + r.d / 2, (r.h || 1.5) + 1.7); thoughtBubble(bx, by, "🎉 shipped!", true); }
}
// Friday is food truck day: a taco truck parks by the fountain and the walkers line up.
const isFriday = () => new Date().getDay() === 5;
// The square's centre: the 2D draw sets fountainAt, but the 3D view never runs it, so fall back to the layout.
const squareAt = () => fountainAt || (campus?.square ? [campus.square.x, campus.square.y] : null);
function truckSpot() { const V = campus?.village, Lw = campus?.lawn; if (Lw && Lw.d > 3) return [Lw.x + Lw.w / 2 + 3.2, Lw.y + Lw.d / 2]; return V ? [(V.x0 + V.x1) / 2 + 3.2, (V.y0 + V.y1) / 2 + 1.2] : null; } // taco night on the village green (the quad's lawn in the quad layout)
// Evenings in the village (the owner 2026-11-09): 18:00 to 23:00, folks visit each other's houses, chat on porches, and
// Friday evening is taco night on the square. After 23:00 everyone's home asleep.
const evening = () => { const h = new Date().getHours(); return h >= 18 && h < 23; };
const PORCH = ["nice night for it", "want a tea?", "did you see the sunset?", "long day, huh", "come in, come in", "brought snacks 🍪", "board game later?", "the stars are out ✨"];
// Someone to visit tonight: a coworker in the same project who has a house, else anyone with one.
function friendHouse(d) {
  const houses = homesList().filter((r) => r.desk && r.desk.id !== d.id);
  if (!houses.length) return null;
  const close = houses.filter((h) => h.desk.room === d.room);
  return pick(close.length && Math.random() < 0.75 ? close : houses);
}
function drawFoodTruck(t) {
  const sp = truckSpot();
  if (!sp || !isFriday()) return;
  const [x, y] = sp;
  box(x - 1.0, y - 0.45, 2.0, 0.9, 0.95, "#f2ead8", "#e0a43c", "#c98f2e");
  box(x - 1.05, y + 0.42, 2.1, 0.08, 0.2, "#c94f4f", "#a33f3f", "#8c3636", 0.95);
  poly([toScreen(x - 0.6, y + 0.46, 0.35), toScreen(x + 0.5, y + 0.46, 0.35), toScreen(x + 0.5, y + 0.46, 0.8), toScreen(x - 0.6, y + 0.46, 0.8)], "#2b3a4a");
  for (const wx of [-0.6, 0.6]) { const [px, py] = toScreen(x + wx, y + 0.45, 0); ctx.fillStyle = "#1b1f27"; ctx.beginPath(); ctx.ellipse(px, py, 5 * cam.z, 3 * cam.z, 0, 0, Math.PI * 2); ctx.fill(); }
  if (cam.z > 0.45) { const [sx, sy] = toScreen(x, y, 1.6); ctx.fillStyle = "#c94f4f"; ctx.font = `800 ${Math.max(8, 10 * cam.z)}px system-ui`; ctx.textAlign = "center"; ctx.fillText("TACO FRIDAY", sx, sy); }
}

// ---------- hand-off couriers ----------
let courierBubbles = [];
function couriers() {
  if (view) return [];
  const out = [];
  for (const j of data.jobs || []) {
    if (!j.prevDesk || Date.now() - Date.parse(j.at) > 90000) continue;
    const from = data.desks.find((x) => x.id === j.prevDesk), to = data.desks.find((x) => x.id === j.desk);
    const a = rooms.find((r) => r.id === from?.room), b = rooms.find((r) => r.id === to?.room);
    if (!a || !b) continue;
    const door = (r) => (r.isHouse ? doorOf(r, 0.5) : [r.x + r.w / 2, r.y + r.d + 0.5]);
    const [ax, ay] = door(a), [bx, by] = door(b), u = Math.min(1, (Date.now() - Date.parse(j.at)) / 30000);
    // same building: a little hop out the door and back in
    const x = a === b ? ax + Math.sin(u * Math.PI) * 1.2 : ax + (bx - ax) * u, y = a === b ? ay + Math.sin(u * Math.PI) * 0.6 : ay + (by - ay) * u;
    out.push({ x, y, j, done: u >= 1, toName: nameOf(to) });
  }
  return out;
}
function drawCourier(c, t) {
  const [px, py] = toScreen(c.x, c.y, 0), s = cam.z * 1.2, hop = c.done ? 0 : Math.abs(Math.sin(t / 110)) * 2;
  ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(px, py, 6 * s, 2.6 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#9cc7ff"; roundRect(px - 5 * s, py - (15 + hop) * s, 10 * s, 10 * s, 3 * s); ctx.fill();
  ctx.fillStyle = "#f4ecdc"; roundRect(px - 5.5 * s, py - (24 + hop) * s, 11 * s, 9 * s, 3.5 * s); ctx.fill();
  ctx.fillStyle = "#1b1f27"; ctx.fillRect(px - 3 * s, py - (21 + hop) * s, 1.8 * s, 2 * s); ctx.fillRect(px + 1.2 * s, py - (21 + hop) * s, 1.8 * s, 2 * s);
  // the folder
  ctx.fillStyle = "#f0b45a"; roundRect(px + 3 * s, py - (14 + hop) * s, 7 * s, 5.5 * s, 1 * s); ctx.fill();
  // its bubble goes on top of the building signs (drawn after them)
  if (cam.z > 0.4) courierBubbles.push([px, py - (28 + hop) * s, c.done ? `📁 handed to ${c.toName}` : `📁 ${c.j.auto ? `step ${c.j.step}` : `step ${c.j.step}/${c.j.of}`} → ${c.toName}`]);
}

// ---------- campus walkers ----------
// On the campus, up to two idle staff per running project are out and about: to another building's espresso
// cart, to HR, to the fountain or to the control center's front door, then back to their own lobby.
const walkers = new Map();
function spots() {
  const out = [];
  for (const r of rooms) {
    if (r.isHouse || r.isHomes || r.isGarden) continue;
    const ca = typeof cartAt === "function" ? cartAt(r) : [r.x + r.w / 2 + 1.25, r.y + r.d + 0.55], fc = campus.plan === "quad" && (r.face === "e" || r.face === "w") ? r.face : null; // in front of the cart
    out.push({ id: r.id, door: doorOf(r, 0.9), cart: r.isControl || r.isStore ? null : fc ? [ca[0] + (fc === "e" ? 0.75 : -0.75), ca[1]] : [ca[0], ca[1] + 0.75] });
  }
  return out;
}
function syncWalkers() {
  if (view) { walkers.clear(); return; }
  const keep = new Set();
  for (const r of rooms) {
    if (r.isControl || !r.desks) continue;
    // only workers who are out and about walk (not at a desk, at home, or at the stand-up)
    // Evenings (18:00-23:00) about half the folks who are home come out for the village: visits, porches, tacos on a
    // Friday. Who's out is fixed for the hour (a hash of their id), so a refresh doesn't shuffle them.
    const outTonight = (d) => { if (!evening() || whereIs(d) !== "home") return false; let h = new Date().getHours(); for (const c of d.id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 100 < (isFriday() ? 70 : 45); };
    const idle = r.desks.filter((d) => whereIs(d) === "out" || outTonight(d));
    // everyone in a queue is outside, in the line (on top of the two who wander)
    for (const d of r.desks.filter((x) => ["queue", "coffee"].includes(whereIs(x)))) {
      keep.add(d.id);
      if (!walkers.has(d.id)) { const home = doorOf(r, 0.9); walkers.set(d.id, { d, home, x: home[0], y: home[1], tx: home[0], ty: home[1], wait: 0, thought: null }); }
      else walkers.get(d.id).d = d;
    }
    for (const d of idle.slice(0, typeof cityLife2 !== "undefined" ? cityLife2.walkerCap() : 2)) { // (weather routines, citylife2.js: fewer out in snow, none in heavy rain or snow)
      keep.add(d.id);
      if (!walkers.has(d.id)) { const home = doorOf(r, 0.9); walkers.set(d.id, { d, home, x: home[0] + (Math.random() - 0.5), y: home[1], tx: home[0], ty: home[1], wait: Math.random() * 5, thought: null }); }
      else walkers.get(d.id).d = d;
    }
  }
  // Morning commute (citylife.js): in the half hour before 8:00 the day's workers walk in from the bus stop and their homes
  if (typeof cityLife !== "undefined") for (const c of cityLife.commuters()) {
    const home = doorOf(c.room, 0.9), w = { d: c.d, home, x: c.from[0], y: c.from[1], tx: c.from[0], ty: c.from[1], wait: 0, thought: { text: pick(["morning!", "coffee first ☕", "here we go"]), until: performance.now() + 3200 }, commute: true };
    w.path = route(c.from, home); [w.tx, w.ty] = w.path.shift() || home;
    walkers.set(c.d.id, w);
  }
  for (const id of [...walkers.keys()]) if (!keep.has(id) && !walkers.get(id).commute) walkers.delete(id);
}
// Pathing (the owner, 2026-11-09): walkers keep to the streets instead of cutting through buildings. A trip goes along
// the street they're on to the nearest north-south street, down it, then along the destination's street.
// For render tests: where each walker is on screen right now.
window.__campusWalkers = () => [...walkers.values()].map((w) => ({ id: w.d.id, screen: w.screen }));
function streetLanes() {
  const xs = [-STREET / 2, ...campus.colX.slice(1).map((_, i) => laneX(i + 1)), campus.w + STREET / 2];
  return xs;
}
function streetRows() { return [-STREET / 2, ...campus.rowY.slice(1).map((_, j) => laneY(j + 1)), campus.d + STREET / 2]; }
// Street routing (the owner 2026-11-09: "they walk through buildings"): step onto the nearest street (across or along),
// follow the streets only, turning at crossings, then step off to the destination. Never a diagonal across a block.
// A house's front door (plan B+C houses face the loop road, so the door can be on any side).
function doorOf(r, off = 0.5) {
  const f = r.face || "s", cx = r.x + r.w / 2, cy = r.y + r.d / 2;
  return f === "n" ? [cx, r.y - off] : f === "e" ? [r.x + r.w + off, cy] : f === "w" ? [r.x - off, cy] : [cx, r.y + r.d + off];
}
// Plan B+C: the river is only crossed on a bridge, and the village is walked round its loop road.
const homeSide = (p) => !!campus?.river && p[1] > campus.river.y;
function loopRoute(from, to) {
  const V = campus.village; if (!V) return [to];
  return ringPath(V.x0 - V.road / 2, V.y0 - V.road / 2, V.x1 + V.road / 2, V.y1 + V.road / 2, from, to);
}
// The quad layout (2026-11-16): walkers keep to the covered concourse round the quad (the middle of its walk), the
// short way round; the garden and the Residences are reached down the covered walk that crosses the garden.
function quadRoute(from, to) {
  const Q = campus.quad; if (!Q) return [to];
  const c = (campus.concourse?.[0]?.d || 1.6) / 2, x0 = Q.x0 - c, y0 = Q.y0 - c, x1 = Q.x1 + c, y1 = Q.y1 + c, W = campus.walk;
  if (Math.hypot(to[0] - from[0], to[1] - from[1]) < 1.2) return [to];
  const south = (p) => W && p[1] > y1 + 0.3, wx = W ? W.x + W.w / 2 : 0;
  const head = south(from) ? [[wx, from[1]], [wx, y1]] : [], tail = south(to) ? [[wx, y1], [wx, to[1]]] : [];
  const A = head.length ? head[head.length - 1] : from, B = tail.length ? tail[0] : to;
  const mid = ringPath(x0, y0, x1, y1, A, B).slice(0, -1); // (its last point is B itself)
  return [...head, ...mid, ...tail, to].filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.05);
}
// A walk round a rectangle (x0,y0)-(x1,y1): step onto its nearest side, round the corners the short way, step off.
function ringPath(x0, y0, x1, y1, from, to) {
  const P = 2 * (x1 - x0 + y1 - y0);
  const onto = (p) => { const c = [Math.min(x1, Math.max(x0, p[0])), Math.min(y1, Math.max(y0, p[1]))], d = [Math.abs(c[1] - y0), Math.abs(c[0] - x1), Math.abs(c[1] - y1), Math.abs(c[0] - x0)], k = d.indexOf(Math.min(...d)); return k === 0 ? [c[0], y0] : k === 1 ? [x1, c[1]] : k === 2 ? [c[0], y1] : [x0, c[1]]; };
  const along = (q) => (q[1] === y0 ? q[0] - x0 : q[0] === x1 ? x1 - x0 + (q[1] - y0) : q[1] === y1 ? x1 - x0 + y1 - y0 + (x1 - q[0]) : 2 * (x1 - x0) + y1 - y0 + (y1 - q[1]));
  const corners = [[x1, y0, x1 - x0], [x1, y1, x1 - x0 + y1 - y0], [x0, y1, 2 * (x1 - x0) + y1 - y0], [x0, y0, P]];
  const A = onto(from), B = onto(to), a = along(A), b = along(B), fwd = (b - a + P) % P <= P / 2, path = [A];
  const pass = corners.map(([cx, cy, t]) => [cx, cy, t % P]).filter(([, , t]) => fwd ? (t - a + P) % P < (b - a + P) % P && (t - a + P) % P > 0 : (a - t + P) % P < (a - b + P) % P && (a - t + P) % P > 0);
  pass.sort((p, q) => fwd ? (p[2] - a + P) % P - (q[2] - a + P) % P : (a - p[2] + P) % P - (a - q[2] + P) % P);
  for (const [cx, cy] of pass) path.push([cx, cy]);
  path.push(B, to);
  return path;
}
function route(from, to) {
  // Pathing pass (2026-11-13): the 3D city's walkable grid (3d/nav.js) routes round every building and placed thing,
  // keeps to pavements and paths, and crosses the river only on a bridge. The street-grid routes below are the 2D fallback.
  if (!view && window.campusNav) { const p = window.campusNav.path(from, to); if (p?.length) return p; }
  if (!view && campus?.plan === "quad") return quadRoute(from, to);
  if (campus?.river) {
    const fh = homeSide(from), th = homeSide(to);
    if (fh || th) {
      const R = campus.river, br = (p) => campus.bridges.reduce((b, x) => (Math.abs(x.x - p[0]) < Math.abs(b.x - p[0]) ? x : b), campus.bridges[0]);
      const V = campus.village, loopTop = V ? V.y0 - V.road / 2 : R.y + R.d + 2;
      if (fh && th) return loopRoute(from, to);
      const b = br(fh ? from : to), north = [b.x, R.y - 1.2], south = [b.x, R.y + R.d + 1.0], landing = [b.x, loopTop];
      if (th) return [...routeGrid(from, north), south, landing, ...loopRoute(landing, to)];
      return [...loopRoute(from, landing), south, north, ...routeGrid(north, to)];
    }
  }
  return routeGrid(from, to);
}
function routeGrid(from, to) {
  if (Math.hypot(to[0] - from[0], to[1] - from[1]) < 1.2) return [to];
  const xs = streetLanes(), ys = streetRows();
  const near = (arr, v) => arr.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), arr[0]);
  const onto = (p) => { const lx = near(xs, p[0]), ly = near(ys, p[1]); return Math.abs(lx - p[0]) <= Math.abs(ly - p[1]) ? { pt: [lx, p[1]], v: true, k: lx } : { pt: [p[0], ly], v: false, k: ly }; };
  const A = onto(from), B = onto(to), path = [A.pt];
  if (A.v && B.v) { if (Math.abs(A.k - B.k) > 0.01) { const ly = near(ys, (A.pt[1] + B.pt[1]) / 2); path.push([A.k, ly], [B.k, ly]); } }
  else if (!A.v && !B.v) { if (Math.abs(A.k - B.k) > 0.01) { const lx = near(xs, (A.pt[0] + B.pt[0]) / 2); path.push([lx, A.k], [lx, B.k]); } }
  else if (A.v) path.push([A.k, B.k]);
  else path.push([B.k, A.k]);
  path.push(B.pt, to);
  // drop zero-length legs
  return path.filter((p, i) => i === 0 ? Math.hypot(p[0] - from[0], p[1] - from[1]) > 0.05 : Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) > 0.05);
}
// Unstick (the owner 2026-11-13, "most guys are stuck"): with 3D pathing a walker can be held a fraction of a tile short of
// its target (someone else standing on the same spot, or the target right by an obstacle), and one that never arrives
// never starts its next errand. If it stops getting closer for about a second, it counts as there.
function stalled(o, dist, dt) {
  if (o._tgtKey !== `${o.tx},${o.ty}`) { o._tgtKey = `${o.tx},${o.ty}`; o._best = dist; o._stall = 0; return false; }
  if (dist < o._best - 0.02) { o._best = dist; o._stall = 0; return false; }
  if ((o._stall += dt) < (dist < 0.6 ? 0.8 : 2.5)) return false;
  o._stall = 0; o._best = Infinity; o.tx = o.x; o.ty = o.y; return true; // there (or as near as it gets): on to the next leg
}
// A free seat in the break garden for a walker (the gardens lane): one person a seat (city.js gardenLayout lists them).
function breakSeatFor(w) {
  const r = typeof gardenRoomById === "function" && gardenRoomById("break-garden"); if (!r) return null;
  const seats = gardenLayout(r).seats, taken = new Set([...walkers.values()].filter((x) => x !== w && x.seatRoom === "break-garden").map((x) => x.seatI));
  const free = seats.map((_, i) => i).filter((i) => !taken.has(i));
  if (!free.length) return null;
  const i = free[Math.floor(Math.random() * free.length)];
  return { i, seat: seats[i] };
}
function stepWalkers(dt, t) {
  const sp = spots();
  for (const w of walkers.values()) {
    if (w.commute) { if (cityLife.stepCommuter(w, dt)) walkers.delete(w.d.id); continue; } // walking in to work (citylife.js)
    if (!w.thought && (w.metAt || 0) < t - 30000) {
      const o = [...walkers.values()].find((x) => x !== w && !x.thought && (x.metAt || 0) < t - 30000 && Math.hypot(x.x - w.x, x.y - w.y) < 0.9);
      if (o) {
        w.metAt = o.metAt = t;
        const porch = evening() && homesList().some((r) => Math.hypot(w.x - doorOf(r, 0)[0], w.y - doorOf(r, 0)[1]) < 1.4) && !textsBetween(w.d.id, o.d.id).length;
        const [l1, l2, d1] = porch ? [pick(PORCH), pick(PORCH), w.d] : meetLines(w.d, o.d), [p1, p2] = d1 === w.d ? [w, o] : [o, w];
        p1.thought = { text: l1, until: t + 3400 };
        p2.thought = { text: l2, until: t + 4200 };
      }
    }
    // in a queue: walk to your place in line and wait there
    const qd = (whereIs(w.d) === "queue" || whereIs(w.d) === "coffee") && queueOf(w.d);
    if (qd) {
      if (w.seatRoom) w.sit = w.seat = w.seatRoom = w.seatI = null; // (a queue comes first: up off the bench)
      const spot = queuePos(qd);
      if (spot) {
        if (Math.hypot(w.qx - spot[0], w.qy - spot[1]) > 0.05 || w.qx == null) { w.path = route([w.x, w.y], spot); [w.tx, w.ty] = w.path.shift() || spot; w.qx = spot[0]; w.qy = spot[1]; }
        const dq = Math.hypot(w.tx - w.x, w.ty - w.y);
        if (dq > 0.05 && !stalled(w, dq, dt)) { const k = Math.min(1, (0.75 * dt) / dq); w.x += (w.tx - w.x) * k; w.y += (w.ty - w.y) * k; }
        else if (w.path?.length) [w.tx, w.ty] = w.path.shift();
        else if (!w.thought && Math.random() < dt * 0.08) w.thought = { text: qd.kind === "queue" ? `⏳ waiting for ${OWN()} · ${ageText(Date.now() - Date.parse(qd.since))}` : `☕ ${qd.why}`, until: t + 3500 };
        continue;
      }
    } else if (w.qx != null) { w.qx = w.qy = null; w.path = null; w.wait = 0; }
    if (rex.x != null && !w.thought && Math.hypot(w.x - rex.x, w.y - rex.y) < 1.3 && (w.greetedAt || 0) < t - 20000) { w.greetedAt = t; w.thought = { text: pick(rex.mode === "nap" ? REX_SHH : REX_HELLO).replace(/\{pet\}/g, PET()), until: t + 3000 }; }
    const dist = Math.hypot(w.tx - w.x, w.ty - w.y);
    if (dist > 0.05 && !stalled(w, dist, dt)) { const k = Math.min(1, (0.75 * dt) / dist); w.x += (w.tx - w.x) * k; w.y += (w.ty - w.y) * k; continue; }
    if (w.path?.length) { [w.tx, w.ty] = w.path.shift(); continue; }
    // the break garden (the gardens lane): there, they sit down on their seat for the rest of the wait
    if (w.seatRoom && !w.sit && w.seat && Math.hypot(w.x - w.seat[0], w.y - w.seat[1]) < 0.7) w.sit = w.seat;
    if ((w.wait -= dt) > 0) continue;
    if (w.seatRoom) w.sit = w.seat = w.seatRoom = w.seatI = null; // up again: the seat is free
    // arrived: pick the next stop (home every other time)
    const atHome = Math.hypot(w.x - w.home[0], w.y - w.home[1]) < 0.6;
    let dest = w.home, why = null, bg = null;
    if (atHome && sp.length) {
      const s = pick(sp), roll = Math.random(), truck = isFriday() && truckSpot();
      const store = sp.find((x) => x.id === "store"), wal = data?.wallets?.[w.d.id], fresh = wal?.recent?.[0] && Date.now() - Date.parse(wal.recent[0].at) < 20 * 60000 && w.shoppedFor !== wal.recent[0].at;
      const myHouse = homeOf(w.d.id);
      // a chore the hub just gave them (agents.js choreTick): off to do it, with a little thought bubble
      const ch = (data.feed || []).find((f) => f.desk === w.d.id && f.action === "chore" && Date.now() - Date.parse(f.startedAt) < 15 * 60000 && w.choreAt !== f.startedAt);
      if (ch) { w.choreAt = ch.startedAt; const sq = squareAt(), cart = s.cart; dest = /square|koi|fountain|leaves|park/.test(ch.summary) && sq ? [sq[0] + 1.2, sq[1] + 1.4] : /espresso|cart/.test(ch.summary) && cart ? cart : s.door; w.path = route([w.x, w.y], dest); [w.tx, w.ty] = w.path.shift(); w.wait = 6; w.thought = { text: `🧹 ${ch.summary} (+2)`, until: t + 4000 }; continue; }
      const pal = evening() && roll < 0.75 && Math.random() < 0.45 && friendHouse(w.d);
      if (truck && evening() && roll < 0.55) { dest = [truck[0] + (Math.random() - 0.5) * 1.8, truck[1] + 1.0 + Math.random() * 0.9]; why = pick(["🌮 taco night!", "save me a seat", "extra salsa", "best night of the week", "who's on churros?"]); }
      else if (pal) { dest = doorOf(pal, 0.45); why = `${pick(["dropping by", "visiting", "board games at", "tea at"])} ${nameOf(pal.desk)}'s 🏡`; w.visiting = pal.desk.id; }
      else if (myHouse && afterHours() && roll < 0.5) { dest = doorOf(myHouse, 0.5); why = pick(["heading home 🏠", "time to put my feet up", "home for dinner"]); }
      else if (store && fresh) { w.shoppedFor = wal.recent[0].at; dest = [store.door[0] + (Math.random() - 0.5) * 0.8, store.door[1] + 0.3]; why = `💰 off to buy ${wal.recent[0].label}`; }
      else if (store && (wal?.balance || 0) >= 2 && roll > 0.9) { dest = [store.door[0] + (Math.random() - 0.5) * 0.8, store.door[1] + 0.3]; why = pick(["window shopping", "saving up for the gold chair", "is the trophy back in stock?"]); }
      else if (truck && roll < 0.35) { dest = [truck[0] + (Math.random() - 0.5) * 1.2, truck[1] + 1.1 + Math.random() * 0.6]; why = pick(["taco friday!!", "two al pastor, please", "is there a veggie one?", "the line's worth it"]); }
      // a break in the break garden by the wings (the gardens lane): a free seat on a bench or at the picnic table,
      // instead of some of the espresso runs. (The coffee cart line for blocked or over-cap workers is queueOf above.)
      else if (roll >= 0.2 && roll < 0.45 && (bg = breakSeatFor(w))) { w.seatRoom = "break-garden"; w.seatI = bg.i; w.seat = bg.seat; dest = bg.seat; why = pick(["five minutes on a bench 🌳", "lunch at the picnic table", "fresh air break", "watching the pond for a bit", "sitting in the Break garden"]); }
      else if (roll < 0.45 && s.cart) { dest = s.cart; why = pick(["espresso run", "flat white, please", "is the barista in?"]); }
      else if (roll < 0.6 && squareAt()) { dest = [squareAt()[0] + 0.9, squareAt()[1] + 0.6]; why = pick(["fountain break", "the jets look strong", "checking the budget fountain"]); }
      else if (roll < 0.8) { const hr = sp.find((x) => x.id === "hr"); dest = hr ? hr.door : s.door; why = hr ? pick(["dropping off a request", "kombucha at HR", "who rang the gong?"]) : null; }
      else { const cc = sp.find((x) => x.id === "control"); dest = cc ? cc.door : s.door; why = cc ? pick(["peeking at the control center", `is ${OWN()} in?`, "the screens are glowing"]) : null; }
    }
    const jit = w.seatRoom ? 0 : 1; // (a seat is a seat: no wandering off it)
    w.path = route([w.x, w.y], [dest[0] + (Math.random() - 0.5) * 0.6 * jit, dest[1] + (Math.random() - 0.5) * 0.4 * jit]);
    [w.tx, w.ty] = w.path.shift();
    w.wait = w.seatRoom ? 30 + Math.random() * 30 : 2 + Math.random() * 5;
    if (why && Math.random() < 0.7) w.thought = { text: why, until: t + 3200 };
    else if (Math.random() < 0.25) w.thought = { text: pick(TRAITS[traitOf(w.d.id)]), until: t + 3200 };
  }
}
// ---------- Campus Mart extras: hats, pets, and the delivery van ----------
const martOf = (id, cat) => (data?.wallets?.[id]?.owned || []).filter((k) => data.perks?.[k]?.cat === cat && data.perks[k].icon);
function emoji(px, py, size, ch) { ctx.font = `${Math.max(7, size)}px system-ui, "Segoe UI Emoji", "Apple Color Emoji"`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.fillText(ch, px, py); }
const wearIcon = (id) => { const k = martOf(id, "wear").sort((a, b) => data.perks[b].cost - data.perks[a].cost)[0]; return k ? data.perks[k].icon : null; };
// Orders on their way: a van drives the street from the store to the house (or the office) over the delivery time.
const vanRoutes = new Map();
function vans() {
  const store = rooms.find((r) => r.isStore);
  if (view || !store || !data?.wallets) return [];
  const out = [], now = Date.now();
  for (const [id, w] of Object.entries(data.wallets)) for (const c of w.coming || []) {
    const house = homeOf(id), desk = data.desks.find((d) => d.id === id), office = rooms.find((r) => r.id === desk?.room);
    const dest = house ? doorOf(house, 0.6) : office ? [office.x + office.w / 2, office.y + office.d + 0.9] : null;
    if (!dest) continue;
    const key = `${id}|${c.item}|${c.at}`;
    if (!vanRoutes.has(key)) vanRoutes.set(key, [doorOf(store, 0.9), ...route(doorOf(store, 0.9), dest)]);
    const pts = vanRoutes.get(key), p = Math.max(0, Math.min(1, (now - Date.parse(c.at)) / (Date.parse(c.deliverAt) - Date.parse(c.at))));
    const segs = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1])), total = segs.reduce((a, b) => a + b, 0) || 1;
    let left = p * total, i = 0;
    while (i < segs.length - 1 && left > segs[i]) left -= segs[i++];
    const a = pts[i], b = pts[i + 1] || a, f = segs[i] ? left / segs[i] : 0;
    out.push({ x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, label: c.label, gift: c.gift, id });
  }
  return out;
}
function drawVan(v, t) {
  const [px, py] = toScreen(v.x, v.y, 0), s = cam.z, bump = Math.abs(Math.sin(t / 90)) * 1.2;
  ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(px, py, 16 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = v.gift ? "#e05d8a" : "#e8913c"; roundRect(px - 14 * s, py - (20 + bump) * s, 28 * s, 16 * s, 4 * s); ctx.fill();
  ctx.fillStyle = "#cfe6ff"; roundRect(px + 6 * s, py - (18 + bump) * s, 7 * s, 6 * s, 2 * s); ctx.fill();
  ctx.fillStyle = "#1b1f27"; for (const dx of [-8, 8]) { ctx.beginPath(); ctx.arc(px + dx * s, py - 3 * s, 3 * s, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = "#fff"; ctx.font = `700 ${Math.max(6, 6 * s)}px system-ui`; ctx.textAlign = "center"; ctx.fillText("MART", px - 3 * s, py - (9 + bump) * s);
  if (cam.z > 0.55) thoughtBubble(px, py - (26 + bump) * s, `📦 ${v.label} for ${nameOf(deskById(v.id) || { id: v.id })}`, true);
}
function drawWalker(w, t, inGarden = false) {
  const sitting = !!w.sit && Math.hypot(w.tx - w.x, w.ty - w.y) <= 0.05; // on a seat in the break garden (the gardens lane)
  if (sitting && !inGarden && typeof gardenRoomById === "function" && gardenRoomById(w.seatRoom)) return; // (the garden draws them, city.js drawBreakGarden)
  const [px, py] = sitting ? toScreen(w.sit[0], w.sit[1], 0.16) : toScreen(w.x, w.y, 0), s = cam.z * 1.1;
  w.screen = [px, py - 15 * s, 14 * s];
  const moving = !sitting && Math.hypot(w.tx - w.x, w.ty - w.y) > 0.05, bob = moving ? Math.abs(Math.sin(t / 110)) * 2 : sitting ? -3 : 0;
  if (!sitting) { ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(px, py, 7 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = PROVIDER[w.d.provider] || PROVIDER.other; roundRect(px - 5.5 * s, py - (18 + bob) * s, 11 * s, (sitting ? 10 : 13) * s, 3.5 * s); ctx.fill();
  ctx.fillStyle = "#f4ecdc"; roundRect(px - 6.5 * s, py - (29 + bob) * s, 13 * s, 10.5 * s, 4 * s); ctx.fill();
  ctx.fillStyle = "#1b1f27"; ctx.fillRect(px - 3.5 * s, py - (25.5 + bob) * s, 2 * s, 2.5 * s); ctx.fillRect(px + 1.5 * s, py - (25.5 + bob) * s, 2 * s, 2.5 * s);
  const hat = wearIcon(w.d.id);
  if (hat) emoji(px, py - (28 + bob) * s, 11 * s, hat);
  else if (w.d.lead) { ctx.fillStyle = "#ffd166"; ctx.beginPath(); ctx.arc(px, py - (33 + bob) * s, 2 * s, 0, Math.PI * 2); ctx.fill(); }
  // a pet comes along for the walk
  const pet = martOf(w.d.id, "pets")[0];
  if (pet && pet !== "goldfish") emoji(px + 10 * s, py - (1 + (moving ? Math.abs(Math.sin(t / 90)) * 2 : 0)) * s, 9 * s, data.perks[pet].icon);
  const brolly = typeof cityLife2 !== "undefined" && cityLife2.umbrellaFor(w); // rain: an umbrella (citylife2.js)
  if (brolly) cityLife2.draw2dBrella(px + 3 * s, py - (37 + bob) * s, s, w);
  if (w.thought && t < w.thought.until && cam.z > 0.4) thoughtBubble(px, py - ((brolly ? 46 : 38) + bob) * s, w.thought.text, false);
  else w.thought = null;
  // who's this? a name tag (and title and building when zoomed in) so you can tell them apart outside
  if (cam.z > 0.45) {
    const home = projects.find((p) => p.id === w.d.room)?.name || w.d.room, big = cam.z > 0.85;
    const text = big ? `${nameOf(w.d)} · ${titleOf(w.d)} · ${home}` : nameOf(w.d);
    ctx.font = `600 ${big ? 10 : 9}px system-ui`;
    const tw = ctx.measureText(text).width + 8;
    ctx.fillStyle = "rgba(15,18,24,0.72)"; roundRect(px - tw / 2, py + 2, tw, 13, 4); ctx.fill();
    ctx.fillStyle = "#e9e4d8"; ctx.textAlign = "center"; ctx.fillText(text, px, py + 12);
  }
}
