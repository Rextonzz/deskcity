# Setting up a hub (instructions for Claude Code)

You're helping someone set up their own hub: a local dashboard and campus that tracks every AI worker across their projects, with HR, a finance buddy and a board that keep staff and spending in check, and workers on Claude, Gemini, OpenAI, Grok, DeepSeek or local models. Do it with them, in plain language, one step at a time. Never ask for an API key in the chat: keys go in `.env`, which they edit themselves.

## 1. Check the machine
Run `node tools/setup.mjs --check` and fix what it lists, in order. Node 20 or newer and `npm install` first. If `.env` is missing, copy `.env.example` to `.env` and ask them to open it and paste their keys (Claude is needed; the others only for the providers they'll use).

## 2. Interview (short, one question at a time)
1. Their name, as the hub should call them.
2. Their town (optional): for sunrise, sunset and weather on the campus. Look up its latitude, longitude and time zone yourself.
3. Their projects: for each, a name, what it is, which kind it is (Creative, Games or Tools), and the folder its work happens in, if any.
4. Which AI tools and subscriptions they have (Claude Code, Codex, Antigravity, Cursor, chat apps) and which API keys they'll use. For OpenAI, Grok, DeepSeek or local models, ask which model names they want workers to use (don't assume names: they change often). For local models, ask whether it's Ollama or LM Studio, and check it's running.
5. Who leads each project: usually their own Claude Code (or Codex) session in that folder; a hub-run worker if they want one.
6. A rough monthly budget for API workers. The board can approve small hires within 15% of it.
7. A campus pet? None unless they want one (name and kind).
8. How the hub should look when it opens (the display base): **3D** (the city in 3D; the default, needs a computer or phone that can run 3D), **2D** (the flat city; lightest, works everywhere), or **Neural** (the web of their workers and how they hand work to each other; dive into any worker's jobs), or **Pages** (no campus up front: the plain web pages, Home or the Agents page; the campus is still one link away in the menu). Any device can switch later with the View picker on the campus. Answer `display`: `"3d"`, `"2d"`, `"neural"` or `"pages"`.

9. How light the hub should be: run `node tools/setup.mjs --parts` and show them the parts (each with what it needs: programs, keys, AI cost) and the three presets. **Light** is the core and the 2D campus; **Standard** adds the 3D campus, the Neural view, campus life and the board; **Everything** is every part. They pick a preset, then add or drop single parts. Answer `preset` and, for extras, `modules` (a list of part ids). Parts can be switched later by editing `modules` in `data/hub-settings.json` and restarting.

Read the answers back in a short summary and get a yes before building.

## 3. Build
Write the answers to `data/setup-answers.json` (the `data` folder may not exist yet: `node tools/setup.mjs --example` makes it and a starting file) in the shape of `docs/kit/setup-answers.example.json`, then run `node tools/setup.mjs --answers data/setup-answers.json`. It's safe to run again after changes.

Then, with them:
- `npm run set-password` (they type it; you don't see it).
- Phone access (optional): the hub answers this PC only. To use it from a phone, set `"network": { "listen": "all" }` in `data/hub-settings.json` (Tailscale devices can then connect; add `"networks": "local,tailscale,lan"` only for a home network you trust, never on shared Wi-Fi), make sure a password is set, and restart.
- `node tools/agent-hook-check.mjs --fix` so Claude Code sessions report. Run it once per project folder with `--folder <folder>` to check the mapping.
- For other tools, set up reporting from `docs/kit/REPORTING.md` (Codex, Antigravity, Cursor and others: the hub rule block in their rules file).
- `npm start`, open `http://localhost:3000`, and show them the campus, the Agents page and Waiting for you.

## 4. Staff
Don't hire workers yourself. For each project that needs help, file a request the hub way: `node tools/agent-log.mjs request --from <project>-lead --room <project> --role "..." --why "..."`. HR checks it against their budget and the providers they have, and they (or the board) approve it on the Agents page.

- Workers can pass work to each other. A paid worker only starts by itself from another worker's answer while today's auto-run limit has room (`agents.autoRun.perDay` in `data/hub-settings.json`, 5 a day by default; 0 turns it off); otherwise the job waits in Waiting for you with Run now.

## 5. Check it works
- `node tools/setup.mjs --check` is all OK.
- A test event shows on the Agents page: `node tools/agent-log.mjs event --desk hub-lead --room hub --summary "setup done"`.
- If they have a hub-run worker, give it a small job from its card and watch it finish.

Finish with a short note of what's set up, where their settings live (`data/hub-settings.json`), and how to add a project later (run setup again with the new project added).
