// Campus 3D interiors, style C: every area dressed for the team using it (the owner 2026-11-09: "Each area should match
// the team using it"; plan docs/design/campus-3d/interiors.md sections 3 and 5). The shared floor plan stays the same;
// a theme sets the floor finish, walls, accent and furniture colours, and adds the team's signature pieces on the
// back wall (where nothing else stands) plus a rug under each side's block of desks.
//
// themeFor(floor) picks, most specific first: the floor's work stream by name (e.g. YouTube's Clipping vs Strategy),
// then the project, then its district. sideTheme(name) colours a side (a channel vs a channel).
// Each theme: { floor, wall, wall2, accent, desk, screen, props(put) } where put(kind, w, h, d, x, y, z, color) adds a
// piece relative to the back wall's left end ("solid" lit, "glow" unlit and bright, "glass" see-through).

const DISTRICT = {
  Creative: { floor: 0xc9a77f, wall: 0xf1e6d4, wall2: 0xe8dac4, accent: 0xe08a5a, desk: 0x9b6b43, screen: 0xe8b796 },
  Games: { floor: 0x3a3f52, wall: 0x2f3447, wall2: 0x283044, accent: 0x6ea8ff, desk: 0x4a5068, screen: 0x50608a },
  Tools: { floor: 0xb9bdc3, wall: 0xe4e7eb, wall2: 0xd7dbe0, accent: 0x4caf87, desk: 0x8e9399, screen: 0x9fc9b4 },
};

// Signature pieces. put() places relative to the back wall: x along the wall from the open plan's left edge,
// y up from the floor, z out from the wall (keep z + d under 0.5 so desks never clash). W = usable wall length.
const PROPS = {
  // YouTube studio: green screen, a ring light on a stand, framed thumbnails
  studio: (put, W) => {
    put("solid", 2.2, 1.9, 0.06, W - 2.5, 0.05, 0.02, 0x3fbf5a);
    put("glow", 0.5, 0.5, 0.05, W - 3.3, 1.3, 0.25, 0xfff4dc); put("solid", 0.05, 1.3, 0.05, W - 3.07, 0, 0.27, 0x333333);
    for (let i = 0; i < 4; i++) put("glow", 0.5, 0.32, 0.03, 0.4 + i * 0.75, 1.35, 0.02, [0xff5c5c, 0xffd166, 0x6ea8ff, 0x7ddc8a][i]);
  },
  // YouTube strategy: a mood board and a trend chart
  strategy: (put, W) => {
    put("solid", 2.4, 1.1, 0.04, 0.4, 0.95, 0.02, 0xf4f1ea);
    for (let i = 0; i < 9; i++) put("solid", 0.38, 0.26, 0.02, 0.55 + (i % 3) * 0.75, 1.15 + Math.floor(i / 3) * 0.3, 0.06, [0xffd166, 0xff8fa3, 0x8fd18b, 0x6ea8ff][i % 4]);
    put("glow", 1.4, 0.8, 0.04, W - 1.9, 1.1, 0.02, 0x1b2a3a);
    for (let i = 0; i < 5; i++) put("glow", 0.16, 0.12 + i * 0.12, 0.02, W - 1.75 + i * 0.25, 1.2, 0.06, 0x7ddc8a);
  },
  // another project: a big demo screen, neon strips, an arcade cabinet
  neon: (put, W) => {
    put("glow", 2.6, 1.3, 0.05, W / 2 - 1.3, 0.85, 0.02, 0x162a52); put("glow", 2.3, 1.05, 0.02, W / 2 - 1.15, 0.97, 0.07, 0x35e0ff);
    put("glow", 1.0, 0.5, 0.02, W / 2 - 0.5, 1.2, 0.1, 0xff4fd8);
    put("glow", W, 0.05, 0.04, 0, 2.2, 0.02, 0xff4fd8); put("glow", W, 0.05, 0.04, 0, 0.08, 0.02, 0x35e0ff);
    put("solid", 0.6, 1.6, 0.45, W - 0.8, 0, 0.02, 0x232842); put("glow", 0.44, 0.34, 0.02, W - 0.72, 1.0, 0.48, 0x35e0ff);
  },
  // Many Peoples (DF): a stone hearth and forge, banners, a mug rack, torches
  stonehall: (put, W) => {
    put("solid", 1.4, 1.2, 0.45, W - 1.7, 0, 0.02, 0x6a625a); put("glow", 0.8, 0.35, 0.05, W - 1.4, 0.15, 0.44, 0xff7a2a);
    put("solid", 0.4, 0.9, 0.3, W - 1.2, 1.2, 0.05, 0x5c544c);
    for (let i = 0; i < 3; i++) { put("solid", 0.45, 1.0, 0.03, 0.5 + i * 1.1, 1.0, 0.02, i % 2 ? 0xc9a24a : 0x9c2f2f); put("glow", 0.1, 0.18, 0.08, 1.05 + i * 1.1, 1.55, 0.04, 0xffb347); }
    put("solid", 1.2, 0.06, 0.18, W / 2 - 0.6, 1.25, 0.02, 0x6b4a32);
    for (let i = 0; i < 5; i++) put("solid", 0.12, 0.16, 0.12, W / 2 - 0.5 + i * 0.24, 1.31, 0.05, 0xd8c7a0);
  },
  // Hub: the ops wall of screens, a server rack, the build board
  ops: (put, W) => {
    for (let i = 0; i < 6; i++) put("glow", 0.7, 0.42, 0.03, 0.4 + (i % 3) * 0.78, 1.0 + Math.floor(i / 3) * 0.5, 0.02, [0x1d3b2e, 0x18324a, 0x1d3b2e][i % 3]);
    for (let i = 0; i < 6; i++) put("glow", 0.5, 0.05, 0.02, 0.5 + (i % 3) * 0.78, 1.15 + Math.floor(i / 3) * 0.5, 0.06, 0x7ddc8a);
    put("solid", 0.65, 2.0, 0.45, W - 0.85, 0, 0.02, 0x2a2f38);
    for (let i = 0; i < 6; i++) put("glow", 0.05, 0.05, 0.02, W - 0.7 + (i % 2) * 0.3, 0.3 + i * 0.28, 0.48, i % 3 ? 0x7ddc8a : 0xffb347);
    put("solid", 1.6, 1.0, 0.04, W - 2.8, 0.9, 0.02, 0xf4f1ea);
  },
  // HR: the gong and a ball-pit corner
  hr: (put, W) => {
    put("solid", 0.08, 1.4, 0.08, W - 1.6, 0, 0.1, 0x6b4a32); put("solid", 0.08, 1.4, 0.08, W - 0.6, 0, 0.1, 0x6b4a32); put("solid", 1.08, 0.08, 0.08, W - 1.6, 1.4, 0.1, 0x6b4a32);
    put("glow", 0.7, 0.7, 0.04, W - 1.45, 0.55, 0.12, 0xd9a440);
    for (let i = 0; i < 12; i++) put("glow", 0.16, 0.16, 0.16, 0.3 + (i % 6) * 0.2, 0.02 + Math.floor(i / 6) * 0.14, 0.05 + (i % 2) * 0.18, [0xff5c5c, 0xffd166, 0x6ea8ff, 0x7ddc8a][i % 4]);
  },
  // generic: framed posters in the accent colour
  posters: (put, W, accent) => { for (let i = 0; i < Math.max(2, Math.floor(W / 1.6)); i++) put("solid", 0.6, 0.8, 0.03, 0.5 + i * 1.6, 1.1, 0.02, i % 2 ? accent : 0xf4f1ea); },
  // The CEO tower (interiors.md section 4). Control Center: the owner's command desk facing a screen wall, the HR inbox
  // tray, the org chart on the wall.
  command: (put, W) => {
    for (let i = 0; i < 6; i++) put("glow", 0.9, 0.5, 0.03, W / 2 - 1.45 + (i % 3) * 0.98, 0.95 + Math.floor(i / 3) * 0.58, 0.02, [0x18324a, 0x1d3b2e, 0x3a2340][i % 3]);
    for (let i = 0; i < 6; i++) put("glow", 0.6, 0.05, 0.02, W / 2 - 1.3 + (i % 3) * 0.98, 1.1 + Math.floor(i / 3) * 0.58, 0.06, [0x6ea8ff, 0x7ddc8a, 0xff8fa3][i % 3]);
    put("solid", 1.8, 0.75, 0.42, W / 2 - 0.9, 0, 0.05, 0x3a3f4a); put("glow", 1.6, 0.04, 0.02, W / 2 - 0.8, 0.76, 0.3, 0x9cc7ff);
    put("solid", 1.1, 0.8, 0.03, 0.3, 1.1, 0.02, 0xf4f1ea); for (let i = 0; i < 4; i++) put("solid", 0.2, 0.12, 0.02, 0.45 + i * 0.22, 1.2 + (i % 2) * 0.3, 0.05, 0x6ea8ff);
    put("solid", 0.5, 0.18, 0.35, W - 0.9, 0.8, 0.05, 0xc9a24a); put("solid", 0.4, 0.8, 0.4, W - 0.85, 0, 0.02, 0x4a4f5a);
  },
  // Cards: the shop counter, three glass display cases with cards glowing inside, the round vault door, binders
  cardshop: (put, W) => {
    for (let i = 0; i < 3; i++) { put("solid", 0.8, 0.6, 0.42, 0.3 + i * 0.95, 0, 0.02, 0x6b4a32); put("glass", 0.8, 0.35, 0.42, 0.3 + i * 0.95, 0.6, 0.02, 0xcfe8f5); for (let k = 0; k < 3; k++) put("glow", 0.14, 0.2, 0.02, 0.4 + i * 0.95 + k * 0.22, 0.65, 0.2, [0xffd166, 0x6ea8ff, 0xff8fa3][(i + k) % 3]); }
    put("solid", 1.2, 1.2, 0.08, W - 1.5, 0.3, 0.02, 0x8a8f99); put("solid", 0.9, 0.9, 0.06, W - 1.35, 0.45, 0.09, 0xb0b5bd); put("glow", 0.12, 0.12, 0.04, W - 0.96, 0.84, 0.15, 0xc9a24a);
    for (let i = 0; i < 6; i++) put("solid", 0.12, 0.38, 0.3, 3.3 + i * 0.15, 1.3, 0.05, [0x9c2f2f, 0x2f5c9c, 0x2f8c4f][i % 3]);
    put("solid", 1.0, 0.04, 0.32, 3.25, 1.27, 0.03, 0x6b4a32);
  },
  // Gaming den: couch and a big screen, two arcade cabinets, a Dokkan poster
  den: (put, W) => {
    put("glow", 2.0, 1.1, 0.04, 0.6, 0.9, 0.02, 0x241a40); put("glow", 1.8, 0.95, 0.02, 0.7, 0.97, 0.07, 0xb48cff);
    put("solid", 2.0, 0.42, 0.42, 0.6, 0, 0.05, 0x5b3f7a); put("solid", 2.0, 0.4, 0.12, 0.6, 0.42, 0.05, 0x4c3466);
    for (let i = 0; i < 2; i++) { put("solid", 0.55, 1.55, 0.42, W - 1.5 + i * 0.7, 0, 0.02, i ? 0x9c2f2f : 0x2f5c9c); put("glow", 0.4, 0.3, 0.02, W - 1.43 + i * 0.7, 1.0, 0.45, 0x7ddc8a); }
    put("glow", 0.55, 0.75, 0.03, W - 2.4, 1.1, 0.02, 0xff8a2a);
  },
  // the pet's penthouse: a cat tree, a sunny window seat, his tiny CEO desk, a food bowl, a scratching post, plants.
  // Code-drawn only (docs/design/the pet-rules.md in another project); the pet himself is the shared code-drawn model.
  penthouse: (put, W) => {
    put("glow", 2.2, 1.2, 0.03, 0.4, 0.8, 0.02, 0xfff1c9); put("solid", 2.2, 0.4, 0.45, 0.4, 0, 0.02, 0xd9a86c); put("solid", 2.0, 0.08, 0.4, 0.5, 0.4, 0.04, 0xf2e2c8);
    put("solid", 0.12, 1.8, 0.12, W - 1.2, 0, 0.15, 0xc9b38d); put("solid", 0.7, 0.08, 0.45, W - 1.5, 0.7, 0.02, 0x8a6a4a); put("solid", 0.6, 0.08, 0.4, W - 1.45, 1.35, 0.03, 0x8a6a4a); put("solid", 0.5, 0.3, 0.4, W - 1.4, 1.43, 0.03, 0x8a6a4a);
    put("solid", 0.7, 0.35, 0.4, W - 2.5, 0, 0.05, 0x6b4a32); put("solid", 0.18, 0.12, 0.04, W - 2.35, 0.37, 0.3, 0x1b1f27);
    put("solid", 0.22, 0.06, 0.22, 3.0, 0, 0.2, 0x6ea8ff); put("solid", 0.1, 0.9, 0.1, 3.5, 0, 0.25, 0xd8c7a0);
  },
  // Cell-to-civ: a terrarium of tiny creatures; Night Register: a dim shop counter; raid lead: a war table banner
  terrarium: (put, W) => { put("glass", 1.6, 0.8, 0.42, W - 1.9, 0.7, 0.03, 0xcfe8f5); put("solid", 1.6, 0.7, 0.42, W - 1.9, 0, 0.03, 0x6b4a32); for (let i = 0; i < 5; i++) put("glow", 0.08, 0.08, 0.08, W - 1.7 + i * 0.28, 0.78, 0.15 + (i % 2) * 0.12, [0x7ddc8a, 0xffd166, 0xff8fa3][i % 3]); },
  shop: (put, W) => { put("solid", 2.0, 0.95, 0.45, W - 2.3, 0, 0.02, 0x3a3d46); put("glow", 1.9, 0.06, 0.02, W - 2.25, 1.9, 0.02, 0xfff0a8); put("glow", 0.5, 0.3, 0.04, W - 1.0, 1.4, 0.03, 0xff4f4f); },
  wartable: (put, W) => { put("solid", 0.6, 1.2, 0.03, W - 1.0, 0.9, 0.02, 0x9c2f2f); put("solid", 0.6, 1.2, 0.03, W - 2.0, 0.9, 0.02, 0x2f5c9c); put("glow", 0.3, 0.3, 0.03, W - 0.85, 1.4, 0.05, 0xffd166); },
};

const PROJECT = {
  youtube: { floor: 0x40434d, wall: 0x2d313b, wall2: 0x262a33, accent: 0xff5c5c, desk: 0x5a4a3c, screen: 0x8a5050, props: "studio" },
  df: { floor: 0x8a8178, wall: 0x6f665c, wall2: 0x655d54, accent: 0xc0703a, desk: 0x6b4a32, screen: 0x7a5232, props: "stonehall" },
  hub: { floor: 0xb8bcc2, wall: 0xe3e6ea, wall2: 0xd6dade, accent: 0x4caf87, desk: 0x8e9399, screen: 0x9fc9b4, props: "ops" },
  hr: { floor: 0xd8c7a8, wall: 0xf3eadb, wall2: 0xeadfcd, accent: 0xd9a440, desk: 0x9b6b43, screen: 0xe8cf9a, props: "hr" },
  civsim: { props: "terrarium", accent: 0x7ddc8a },
  control: { floor: 0x2a3038, wall: 0x343b46, wall2: 0x2e343e, accent: 0x9cc7ff, desk: 0x4a4f5a, screen: 0x50608a, props: "command" },
  cards: { floor: 0xb98a5a, wall: 0xf3e9d6, wall2: 0xeadfca, accent: 0xc9a24a, desk: 0x6b4a32, screen: 0xd9c08a, props: "cardshop" },
  gaming: { floor: 0x3b2f4a, wall: 0x2c2338, wall2: 0x261e31, accent: 0xb48cff, desk: 0x4c3466, screen: 0x5b3f7a, props: "den" },
  pet: { floor: 0xe8dcc6, wall: 0xfaf3e6, wall2: 0xf2e9d8, accent: 0xf0b45a, desk: 0x8a6a4a, screen: 0xe8cf9a, props: "penthouse" },
  nightregister: { floor: 0x2b2a30, wall: 0x34323a, wall2: 0x2d2b33, accent: 0xfff0a8, props: "shop" },
  raidlead: { props: "wartable", accent: 0xc9a24a },
  homeserver: { props: "ops" },
  mascot: { props: "posters", accent: 0xffb347 },
};
// Work streams that get their own look (matched on the floor's name).
const STREAMS = [
  [/strateg|trend|research/i, { floor: 0xd9cdb8, wall: 0xf4efe6, wall2: 0xebe4d8, accent: 0x6ea8ff, desk: 0x9b6b43, screen: 0xb9cbe0, props: "strategy" }],
];
// A side is coloured by the kind of channel it carries: the channel whose name or id is in the side's name, by the page layout that channel uses (HUB.channels, from the hub settings); else by plain words in the name.
const SIDE_COLOR = { clips: 0xd9534f, packs: 0x3f8fa8, shared: 0x9aa3ad };
const sideKind = (name) => {
  const n = String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const chans = typeof HUB !== "undefined" && Array.isArray(HUB?.channels) ? HUB.channels : [];
  const ch = n && chans.find((c) => [c.name, c.id].some((x) => { const k = String(x || "").toLowerCase().replace(/[^a-z0-9]/g, ""); return k && n.includes(k); }));
  if (ch?.layout === "clips" || ch?.layout === "packs") return ch.layout;
  return /clips?/i.test(name || "") ? "clips" : /packs?|cards?/i.test(name || "") ? "packs" : /shared/i.test(name || "") ? "shared" : null;
};

export function themeFor(f) {
  const p = f.project || {}, base = DISTRICT[p.district] || DISTRICT.Tools;
  const proj = PROJECT[p.id] || {};
  const stream = (STREAMS.find(([re]) => re.test(f.floorName || "")) || [])[1] || {};
  return { ...base, ...proj, ...stream, props: stream.props || proj.props || "posters" };
}
export function sideColor(name, i) { return SIDE_COLOR[sideKind(name)] ?? [0xe0a35a, 0x6ea8ff, 0x8fd18b, 0xb48cff][i % 4]; }
export function addProps(theme, put, W) { (PROPS[theme.props] || PROPS.posters)(put, W, theme.accent); }
