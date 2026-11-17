// Neural view (the owner 2026-11-14: "a 3rd view option, neural, which would be like the brain view but we can trace the
// branching"). Builds the tree of work for one job: the chain it belongs to (hand-offs and retries, any desk), and
// under each job the work its desk reported while the job was open: sessions, replies (turns), tool calls grouped by
// station, and sub-agents with their own tool calls. Pure: it takes the jobs and events, so tests can feed fixtures.
// See docs/handoffs/neural-view.md. Same metadata as the brain view: tool and file names only, never prompts or commands.
//
// What links what:
//   job -> next job       the next job's `prev` (a hand-off, automatic or a "then" step)
//   job -> retry          the job's `retriedAs`
//   job -> sessions       events on the job's desk between when it was taken (or given) and when it finished
//   session               events with the same `session` id (hook, from 2026-11-14); older events have none, so they
//                         are split at each "session start" and marked `mixed` (two sessions on one desk can blur)
//   turn                  steps up to and including a "turn done"
//   sub-agent             tool steps with the same `agent` id (hook, from 2026-11-14); an older "subagent done" is a leaf
const STEP_CAP = 25; // steps shown per station group; the rest are counted in a "more" node
const EVENT_CAP = 800; // newest events kept per job window
const DESK_HOURS = 12; // a desk with no job: its sessions from the last 12 hours
const WORK = new Set(["tool", "turn done", "subagent done", "session start", "session end"]);
const firstLine = (s, n = 90) => String(s || "").split("\n").map((x) => x.trim()).find(Boolean)?.slice(0, n) || "";
const ms = (t) => Date.parse(t);
const iso = (t) => new Date(t).toISOString();
const push = (map, k, v) => (map.get(k) || map.set(k, []).get(k)).push(v);

export function buildTrace({ jobs = [], events = [], job: jobId = null, desk = null, now = Date.now(), stationOf = () => "other" } = {}) {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  let focus = jobId ? byId.get(jobId) : null;
  if (jobId && !focus) throw new Error("No such job.");
  const deskJobs = (d) => jobs.filter((j) => j.desk === d).sort((a, b) => String(b.updatedAt || b.at).localeCompare(String(a.updatedAt || a.at)));
  if (!focus && desk) {
    const mine = deskJobs(desk);
    focus = mine.find((j) => j.status === "taken") || mine.find((j) => j.status === "queued") || mine.find((j) => now - ms(j.updatedAt || j.at) < 3 * 864e5) || null;
  }
  const work = events.filter((e) => e.kind === "agent event" && e.desk && WORK.has(e.action) && !Number.isNaN(ms(e.startedAt)));
  const recent = (d) => (d ? deskJobs(d).slice(0, 12).map((j) => ({ id: j.id, status: j.status, at: j.at, text: firstLine(j.task || j.text, 80) })) : []);

  if (!focus) {
    // No job to follow: the desk's own sessions lately, so the view still shows something.
    const from = now - DESK_HOURS * 3600e3;
    const evs = work.filter((e) => e.desk === desk && ms(e.startedAt) >= from).slice(-EVENT_CAP);
    const root = { id: `desk:${desk}`, kind: "desk", desk, label: desk, at: evs[0]?.startedAt || iso(from), end: iso(now), children: sessions(evs, `desk:${desk}`, stationOf, true) };
    total(root);
    return { root, focus: null, desk, now: iso(now), jobs: recent(desk) };
  }

  // Walk back to where the chain started (hand-offs via prev, retries via retriedAs), then build it forwards.
  const retryOf = new Map(jobs.filter((j) => j.retriedAs).map((j) => [j.retriedAs, j.id]));
  let start = focus;
  for (let i = 0, seen = new Set([start.id]); i < 30; i++) {
    const up = (start.prev && byId.get(start.prev)) || (retryOf.has(start.id) && byId.get(retryOf.get(start.id)));
    if (!up || seen.has(up.id)) break;
    seen.add(up.id);
    start = up;
  }
  const kids = new Map();
  for (const j of jobs) {
    if (j.prev && byId.has(j.prev)) push(kids, j.prev, { j, edge: "handoff" });
    if (j.retriedAs && byId.has(j.retriedAs)) push(kids, j.id, { j: byId.get(j.retriedAs), edge: "retry" });
  }
  const built = new Set();
  const jobNode = (j, edge) => {
    built.add(j.id);
    const hist = j.history || [];
    const taken = hist.find((x) => x.status === "taken")?.at;
    const ended = [...hist].reverse().find((x) => ["done", "failed", "cancelled"].includes(x.status))?.at;
    const open = j.status === "queued" || j.status === "taken";
    const from = ms(taken || j.at), to = ended ? ms(ended) : open ? now : ms(j.updatedAt || j.at);
    const evs = work.filter((e) => e.desk === j.desk && ms(e.startedAt) >= from && ms(e.startedAt) <= to).slice(-EVENT_CAP);
    const next = (kids.get(j.id) || []).filter((k) => !built.has(k.j.id)).sort((a, b) => String(a.j.at).localeCompare(String(b.j.at)));
    next.forEach((k) => built.add(k.j.id)); // claimed here, so a job reachable twice is drawn once
    return {
      id: `job:${j.id}`, kind: "job", job: j.id, desk: j.desk, edge: edge || null, from: j.prevDesk || null,
      label: firstLine(j.task || j.text), status: j.status, summary: firstLine(j.summary, 200) || null,
      step: j.step || null, of: j.of || null, at: iso(from), end: iso(to), focus: j.id === focus.id,
      children: [...sessions(evs, j.id, stationOf, open), ...next.map((k) => jobNode(k.j, k.edge))],
    };
  };
  const root = jobNode(start, null);
  total(root);
  return { root, focus: focus.id, desk: focus.desk, now: iso(now), jobs: recent(desk || focus.desk) };
}

// Events (one desk, time order) -> session nodes -> turn nodes -> station / sub-agent nodes -> steps.
function sessions(evs, key, stationOf, open) {
  const groups = [], byId = new Map();
  let legacy = null;
  for (const e of evs) {
    if (e.session) {
      let g = byId.get(e.session);
      if (!g) { g = { sid: e.session, mixed: false, evs: [] }; byId.set(e.session, g); groups.push(g); }
      g.evs.push(e);
      continue;
    }
    if (e.action === "session start" || !legacy) { legacy = { sid: `old${groups.length}`, mixed: true, evs: [] }; groups.push(legacy); }
    legacy.evs.push(e);
  }
  // a session that only started (no steps yet, or none inside this job's window) adds nothing to the tree
  return groups.filter((g) => g.evs.some((e) => e.action !== "session start" && e.action !== "session end")).map((g, gi) => {
    const id = `s:${key}:${g.sid}`;
    const turns = [];
    let cur = null;
    for (const e of g.evs) {
      if (e.action === "session start" || e.action === "session end") continue;
      if (!cur) { cur = { evs: [] }; turns.push(cur); }
      cur.evs.push(e);
      if (e.action === "turn done") cur = null;
    }
    const ended = g.evs.some((e) => e.action === "session end");
    const lastTurn = turns[turns.length - 1];
    return {
      id, kind: "session", label: `Session ${gi + 1}`, mixed: g.mixed, at: g.evs[0].startedAt, end: g.evs[g.evs.length - 1].startedAt,
      children: turns.map((t, ti) => turnNode(t.evs, `${id}:${ti}`, ti, stationOf, open && !ended && t === lastTurn && t.evs[t.evs.length - 1].action !== "turn done")),
    };
  });
}
function turnNode(evs, id, ti, stationOf, working) {
  const done = evs.find((e) => e.action === "turn done");
  const main = [], agents = new Map(), leaves = [];
  for (const e of evs) {
    if (e.action === "turn done") continue;
    if (e.action === "subagent done") {
      if (e.agent) agentGroup(agents, e).done = e.startedAt;
      else leaves.push({ id: `${id}:sa${leaves.length}`, kind: "subagent", label: "Sub-agent", at: e.startedAt, end: e.startedAt, legacy: true, children: [] });
      continue;
    }
    (e.agent ? agentGroup(agents, e).evs : main).push(e);
  }
  const subs = [...agents.values()].map((a) => {
    const aid = `${id}:a:${a.agent}`;
    return { id: aid, kind: "subagent", label: a.type || "Sub-agent", agent: a.agent, at: a.evs[0]?.startedAt || a.done, end: a.done || a.evs[a.evs.length - 1]?.startedAt, running: !a.done, children: stations(a.evs, aid, stationOf) };
  });
  return {
    id, kind: "turn", label: `Reply ${ti + 1}`, at: evs[0].startedAt, end: (done || evs[evs.length - 1]).startedAt, working: Boolean(working),
    ...(done?.contextTokens ? { contextTokens: done.contextTokens } : {}),
    children: [...stations(main, id, stationOf), ...subs, ...leaves].sort((a, b) => String(a.at).localeCompare(String(b.at))),
  };
}
function agentGroup(map, e) {
  let a = map.get(e.agent);
  if (!a) { a = { agent: e.agent, type: e.agentType || null, evs: [], done: null }; map.set(e.agent, a); }
  if (!a.type && e.agentType) a.type = e.agentType;
  return a;
}
function stations(evs, id, stationOf) {
  const by = new Map();
  for (const e of evs) push(by, stationOf(e.tool), e);
  return [...by.entries()].map(([st, list]) => {
    const sid = `${id}:st:${st}`, cut = Math.max(0, list.length - STEP_CAP);
    const children = list.slice(cut).map((e, i) => ({ id: `${sid}:${cut + i}`, kind: "step", station: st, tool: e.tool || null, label: e.summary || e.tool || "step", failed: e.failed === true, at: e.startedAt, end: e.startedAt, children: [] }));
    if (cut) children.unshift({ id: `${sid}:more`, kind: "more", label: `${cut} earlier`, hidden: cut, failedHidden: list.slice(0, cut).filter((e) => e.failed).length, at: list[0].startedAt, end: list[cut - 1].startedAt, children: [] });
    return { id: sid, kind: "station", station: st, label: st, at: list[0].startedAt, end: list[list.length - 1].startedAt, children };
  });
}
// n = steps under a node and failed = failed steps under it (hidden ones included), not counting later jobs.
function total(node) {
  if (node.kind === "step") { node.n = 1; node.failed = node.failed ? 1 : 0; return node; }
  if (node.kind === "more") { node.n = node.hidden; node.failed = node.failedHidden; return node; }
  node.n = 0; node.failed = 0;
  for (const c of node.children) { total(c); if (c.kind !== "job") { node.n += c.n; node.failed += c.failed; } }
  return node;
}

// ---------- the web: who connects to whom ----------
// the owner 2026-11-14: "make sure it makes webs to trace between and show inter agent connections". Every desk that
// handed work to, sent a result back to, or left a note for another desk in the window, joined by one edge per pair:
//   work      a job handed on (the next job's prevDesk -> desk), counted each way, with the job ids
//   results   a "done" text (a finished hand-off reported back to who handed it)
//   notes     a "note" text
//   social    campus chat, gifts, Shorts (only with social: true; counts only, never the words)
// Hand-off texts are skipped: the jobs already count them. Same rule as everywhere: ids, counts, first lines of tasks.
export function buildWeb({ jobs = [], texts = [], desks = [], now = Date.now(), days = 7, social = false } = {}) {
  const from = now - days * 864e5, edges = new Map();
  const edge = (p, q) => {
    const [a, b] = p < q ? [p, q] : [q, p], k = `${a}|${b}`;
    let e = edges.get(k);
    if (!e) { e = { a, b, work: 0, results: 0, notes: 0, social: 0, gave: { [a]: 0, [b]: 0 }, items: [], last: null }; edges.set(k, e); }
    return e;
  };
  const seen = (e, at) => { if (!e.last || at > e.last) e.last = at; };
  for (const j of jobs) {
    if (!j.prevDesk || !j.desk || j.prevDesk === j.desk || !(ms(j.at) >= from)) continue;
    const e = edge(j.prevDesk, j.desk);
    e.work++; e.gave[j.prevDesk]++; seen(e, j.at);
    e.items.push({ kind: "handoff", from: j.prevDesk, to: j.desk, at: j.at, job: j.id, status: j.status, text: firstLine(j.task || j.text, 90) });
  }
  for (const t of texts) {
    if (!t.from || !t.to || t.from === t.to || t.kind === "handoff" || !(ms(t.at) >= from)) continue;
    const k = t.kind === "done" ? "results" : t.kind === "note" ? "notes" : "social";
    if (k === "social" && !social) continue;
    const e = edge(t.from, t.to);
    e[k]++; seen(e, t.at);
    if (k !== "social") e.items.push({ kind: k === "results" ? "result" : "note", from: t.from, to: t.to, at: t.at, job: t.job || null, text: firstLine(t.text, 90) });
  }
  const known = new Map(desks.map((d) => [d.id, d])), nodes = new Map();
  const node = (id) => nodes.get(id) || nodes.set(id, { id, room: known.get(id)?.room || null, provider: known.get(id)?.provider || null, lead: Boolean(known.get(id)?.lead), gave: 0, got: 0, links: 0 }).get(id);
  const list = [...edges.values()].map((e) => {
    const A = node(e.a), B = node(e.b);
    A.links++; B.links++;
    A.gave += e.gave[e.a]; B.got += e.gave[e.a]; B.gave += e.gave[e.b]; A.got += e.gave[e.b];
    e.items.sort((x, y) => String(y.at).localeCompare(String(x.at)));
    e.total = e.work + e.results + e.notes + e.social;
    e.more = Math.max(0, e.items.length - 12);
    e.items = e.items.slice(0, 12);
    return e;
  });
  const order = [...nodes.values()].sort((x, y) => String(x.room || "~").localeCompare(String(y.room || "~")) || Number(y.lead) - Number(x.lead) || x.id.localeCompare(y.id));
  return { nodes: order, edges: list, days, social, now: iso(now) };
}

// ---------- the feed by job (the owner 2026-11-14: "feed by job with a break out") ----------
// Which job a desk was on at a moment: the job open on that desk then (taken, or given, until it finished). The
// latest-started one wins when two overlap. Used to group the campus feed and the brain view by job.
export function jobWindows(jobs = [], now = Date.now()) {
  const by = new Map();
  for (const j of jobs) {
    if (!j.desk) continue;
    const hist = j.history || [];
    const taken = hist.find((x) => x.status === "taken")?.at;
    const ended = [...hist].reverse().find((x) => ["done", "failed", "cancelled"].includes(x.status))?.at;
    const open = j.status === "queued" || j.status === "taken";
    const from = ms(taken || j.at), to = ended ? ms(ended) : open ? now : ms(j.updatedAt || j.at);
    if (Number.isNaN(from)) continue;
    push(by, j.desk, { id: j.id, text: firstLine(j.task || j.text, 80), status: j.status, from, to });
  }
  return by;
}
export function jobOf(windows, desk, t) {
  let best = null;
  for (const w of windows.get(desk) || []) if (t >= w.from && t <= w.to && (!best || w.from > best.from)) best = w;
  return best ? { id: best.id, text: best.text, status: best.status } : null;
}
// The feed as blocks: one per desk per job (or per stretch of other work, split after a 30-minute quiet gap), with what
// happened in counts (steps by station, files edited, failures) and the steps themselves, newest first.
export function feedGroups(events = [], jobs = [], { now = Date.now(), stationOf = () => "other", limit = 25, gapMs = 30 * 60e3, stepCap = 40 } = {}) {
  const W = jobWindows(jobs, now);
  const evs = events.filter((e) => e.kind === "agent event" && e.desk && !Number.isNaN(ms(e.startedAt))).sort((a, b) => ms(a.startedAt) - ms(b.startedAt));
  const open = new Map(), groups = [];
  for (const e of evs) {
    // a helper (sub-agent) inside a session gets blocks of its own, so its work isn't mixed into the main thread's
    const t = ms(e.startedAt), job = jobOf(W, e.desk, t), key = `${e.desk}|${job?.id || "-"}|${e.agent || "-"}`;
    let g = open.get(key);
    if (!g || t - ms(g.at) > gapMs) {
      g = { desk: e.desk, room: e.room || null, job, ...(e.agent ? { agent: e.agent, agentType: e.agentType || null } : {}), from: e.startedAt, at: e.startedAt, n: 0, failed: 0, counts: {}, files: new Set(), steps: [] };
      open.set(key, g);
      groups.push(g);
    }
    g.at = e.startedAt; g.n++;
    if (e.failed) g.failed++;
    if (e.action === "tool") { const st = stationOf(e.tool); g.counts[st] = (g.counts[st] || 0) + 1; }
    if (e.action === "tool" && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(e.tool || "") && e.summary) g.files.add(e.summary);
    g.steps.push({ at: e.startedAt, action: e.action, tool: e.tool || null, summary: e.summary || null, failed: e.failed === true, ...(e.note ? { note: e.note } : {}), ...(e.costUsd ? { costUsd: e.costUsd } : {}) });
  }
  return groups.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit).map(({ files, steps, ...g }) => ({ ...g, edited: files.size, steps: steps.slice(-stepCap).reverse(), more: Math.max(0, steps.length - stepCap) }));
}
