// Team templates (the owner 2026-11-14: "add a game development team one"). A project type that comes with a standard
// crew: when a project is created with a team (the campus's Add a project form, or "team" in the setup answers), HR
// gets one staff request per crew role on top of the lead. HR picks the models; each hire is the owner's to approve,
// so nothing is hired or spent before that. Each template is a part of the hub (src/hub/modules.js) and is offered
// only while that part is on.
// The game development crew is the generic shape of the owner's own game teams (another project's builder, designer, auditor,
// QA and merge queue), with nothing of another project's in it.
export const TEAMS = {
  gamedev: {
    name: "Game development team",
    module: "gamedev",
    about: "A crew for making a game: someone to build it, design it, review it, test it and ship it.",
    district: "Games",
    roles: {
      builder: { role: "Builder", why: "Writes the game's code and tests and makes playable builds.", needs: "Works in the project's folder; small steps, each one tested and built." },
      designer: { role: "Game designer", why: "Mechanics, levels, story and dialogue: turns ideas into small, testable steps.", needs: "Writes design notes the builder can work from; keeps the scope small." },
      reviewer: { role: "Code reviewer (read-only)", why: "Reads each change for bugs before it's merged.", needs: "Read-only: comments and reports, never edits." },
      qa: { role: "QA and balance (read-only)", why: "Plays builds through tests and runs; reports bugs and balance problems.", needs: "Read-only: a short report per build, worst problems first." },
      release: { role: "Release keeper", why: "Merges finished work in order once its checks pass, and writes release notes.", needs: "Merges only what passed review and checks; never force-pushes." },
    },
    sizes: {
      small: { name: "Small crew", roles: ["builder", "qa"] },
      full: { name: "Full studio", roles: ["builder", "designer", "reviewer", "qa", "release"] },
    },
  },
};

// The staff requests for a team: one per crew role, ready for addRequest. size defaults to the smallest.
export function crewRequests({ team, size, room, name }) {
  const t = TEAMS[team];
  if (!t) throw new Error(`There's no team called "${team}".`);
  const s = t.sizes[size] || Object.values(t.sizes)[0];
  return s.roles.map((key) => {
    const r = t.roles[key];
    return { kind: "staff", room, deskId: `${room}-${key}`.slice(0, 48), lead: false, role: r.role, why: `${r.why} (${t.name}, ${s.name.toLowerCase()}, for ${name}.)`, needs: r.needs, urgency: "normal" };
  });
}

// What the pages need: each team, its sizes and their roles, for the teams whose part is on.
export function teamsOffered(on = null) {
  return Object.entries(TEAMS).filter(([, t]) => !on || on.has(t.module)).map(([id, t]) => ({
    id, name: t.name, about: t.about, district: t.district,
    sizes: Object.entries(t.sizes).map(([sid, s]) => ({ id: sid, name: s.name, roles: s.roles.map((k) => t.roles[k].role) })),
  }));
}
