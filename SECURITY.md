# Security

Deskcity is a personal tool for one owner on their own PC. This page says how to report a problem and, honestly, what it protects and what it does not.

## Report a hole privately

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting: open this project's GitHub page, choose the **Security** tab, then **Report a vulnerability**. Only the project's maintainers can see what you send there. Say what you found, how to reproduce it, and what it lets an attacker do. Do not include real keys or other people's data. Please give a reasonable time to fix it before you share it.

This is a small project run by one person, so there is no bounty and no promised response time.

## What it protects

- **People on the internet.** By default the hub answers this PC only (it listens on 127.0.0.1). It listens on the network only if you set `network.listen` to `"all"` and a dashboard password exists. Even then it answers only the networks you allow: this PC and Tailscale by default. Home Wi-Fi (`lan`) is opt-in. The check uses the connection's real address. Internet visitors are always refused.
- **Other websites in your browser.** Cross-site posts are refused, DNS rebinding is refused, and pages cannot be framed. Every response carries a Content-Security-Policy (own scripts only, no plugins).
- **Password guessing.** The password is stored as a scrypt hash. Sign-in has a captcha, a limit per address (5 tries in 15 minutes; 50 at the PC itself, so a few stray local tries cannot lock you out there) and a global limit (20 an hour). If you turn phone alerts on (they are off until you do), you get alerts on new devices and lockouts.
- **A stolen sign-in cookie.** Once a password is set, actions that spend money, run commands or write outside the hub (running or hiring paid workers, every button that calls an AI, raising caps, the local runner, applying a model change, changing folders, the alert link) need your dashboard password again, and that stays valid for 10 minutes. With no password set, this PC is trusted and is not asked; caps and hourly limits still apply. Cookies are httpOnly and SameSite.
- **Runaway spend.** Every hub-run paid worker has a monthly cap, and the hub refuses to start a job for a worker that has used it. It runs one job per worker at a time and checks the cap again before each, so a cap can be passed by at most one job. It refuses to run a model it has no price for. Buttons that call an AI have hourly limits.
- **Workers' text.** The text a worker returns, and the text it reads, is treated as data. Page output is escaped, links are checked so `javascript:` and `data:` addresses are not used, and job output is escaped before it is shown.
- **Auto-run limit.** A worker's own answer can start new paid jobs only while today's count is under `agents.autoRun.perDay` (5 by default; `0` turns it off). Past that, the job waits for you.
- **Outbound checks from workers.** A worker's "blocker" check can read public web pages only (no private or loopback addresses, no redirects, 2 MB cap) and look at files only inside a project's mapped folders.
- **Agent posts.** The routes tools use to report in have per-route rate caps and small body limits, a posted cost counts for at most $5 a post, cost-carrying posts are limited to 30 a minute per worker, and a worker's reported cost over 3 times its monthly cap in a day is ignored. The helper tool will not send the agent key over plain http to another machine (this PC and Tailscale are fine). Costs that sessions report are their own estimates: the hub cannot check or stop that spending.

## What it does not protect

- **Anything already running as you on the PC.** A program running as your user can read `.env` and the agent key file (`data/agents/token.txt`). With no dashboard password set, the hub treats this PC as trusted.
- **One shared agent key.** Tools report in with one key for every worker. Whoever holds it can post as most workers (not as you, and not as the hub-only voters). Separate keys per worker are not built yet.
- **Prompt injection is not solved.** A worker can be talked into things by text it reads: a web page, a pull request, a comment, a file. The hub limits the damage with caps, the password on risky actions and the auto-run limit. It does not stop the worker from being steered. Treat every worker's output as untrusted and keep caps low.
- **Forwarding tools.** If you point Tailscale Serve or Funnel, ngrok, a tunnel, or a router port forward at the hub, outside visitors can look like this PC. Do not do this. Always set a password if you do anything of the kind.
- **A network you share with strangers**, if you open the hub to your local network. That network carries the password and the 30-day session cookie in clear over plain http. Prefer Tailscale.
- **Keys in `.env`** are stored in plain text, as in most local tools.
- **Third-party services.** Prompts go to the AI providers you choose. Phone alerts go to the ntfy server (ntfy.sh by default) only if you turn them on. Their security is theirs.
- **Add-on parts** (YouTube pipeline, card tools and so on) run extra programs and sign-ins. They are off by default. Turn on only what you use.

## What the hub never does

It has no telemetry and sends no usage data to its authors. The campus fonts are served by the hub itself. If you set a town, your browser asks Open-Meteo for the weather there. It never asks you for a key or password in chat, and the setup guide tells Claude Code not to either.

## Keeping safe

- Set a dashboard password.
- Keep phone access on Tailscale, not shared Wi-Fi.
- Keep monthly caps low.
- Do not commit `.env` or `data/`.
- Update when a new version comes out.
