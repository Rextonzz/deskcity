# Deskcity: rules for AI coding sessions

Deskcity — A local-first hub and visual campus for every AI worker: jobs, caps, approvals, and cross-model hand-offs.

A local Node app (Express, port 3000): a dashboard and campus that track every AI worker across the owner's projects, with HR, a finance buddy and a board, and workers on cloud or local AI models.

## First time here?
If `data/hub-settings.json` doesn't exist, the hub isn't set up yet: follow `docs/kit/SETUP.md` with the owner.

## Rules
- Hub rule: every project links into the hub (its own room, sessions and scripts reporting through the Claude Code hook or `tools/agent-log.mjs`, staff through HR), and every handoff to another AI, session or tool carries that rule. See `docs/kit/REPORTING.md`.
- Never commit `.env` or `data/` (keys, settings, roster, events, the agent key file).
- Never ask for or handle API keys or passwords in chat: the owner puts keys in `.env` and runs `npm run set-password` themselves.
- Staff: don't hire workers yourself; file a request (`tools/agent-log.mjs request`) and let HR and the owner (or the board) decide.
- Money-spending actions need the dashboard password.
- Server changes (`server.js`, `src/`) need a restart; page changes (`public/`) only a reload.

## Where things are
- Settings: `hub.defaults.json` < `data/hub-settings.json` (`src/hub/settings.js`). The pages read them from `/api/hub/settings`.
- Workers and HR: `src/pipeline/agents.js`, `src/pipeline/hr.js`; other providers: `src/pipeline/openai-compat.js`.
- Campus: `public/campus.html` and `public/campus/` (2D canvas and 3D three.js).
- Tools: `tools/setup.mjs`, `tools/agent-log.mjs`, `tools/agent-hook.mjs`, `tools/agent-hook-check.mjs`.
