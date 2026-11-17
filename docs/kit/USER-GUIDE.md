# User guide

This guide covers Deskcity from install to uninstall. It assumes you are not a programmer. Where something does not work everywhere it says so.

The design idea: pick how it looks and how heavy it is, and change your mind any time. Views, parts and presets are all switches.

## 1. Install

You need Node.js 20 or newer ([nodejs.org](https://nodejs.org)). Windows is the main tested system.

In the hub folder, install the packages:

```
npm install
```

Copy `.env.example` to `.env`. Open `.env` in a text editor and paste your Claude key after `ANTHROPIC_API_KEY=`. The hub's helper workers (HR and the finance buddy) use it. Keys for Gemini, OpenAI, Grok, DeepSeek or Muse are optional: add only the providers you use. `.env` stays on your computer and is never part of the repo.

Set a dashboard password. You type it in the terminal; only a hash of it is stored:

```
npm run set-password
```

Run the setup. With Claude Code, open the folder in it and say "set up my hub". It follows `docs/kit/SETUP.md`. Without Claude Code, make a starting answers file with `node tools/setup.mjs --example` (it creates the `data` folder if it is not there yet and writes `data/setup-answers.json`), edit that file, and run:

```
node tools/setup.mjs --answers data/setup-answers.json
```

The answers file says: your name, your projects and their folders, which view the hub opens on (`display`: `2d`, `3d`, `neural` or `pages`), and which parts are on (`preset`, and `modules` for extras). Keys never go in it. It is safe to run again after you change it; existing rooms and workers are kept.

## 2. First run

Start the hub:

```
npm start
```

Open <http://localhost:3000>. If a password is set, sign in with it. The hub does not restart itself: if you stop the terminal, the hub stops.

To check what is in place and what is missing:

```
node tools/setup.mjs --check
```

If you use Claude Code, install the hook so your Claude Code sessions report in:

```
node tools/agent-hook-check.mjs --fix
```

Start a new Claude Code session in a project folder. It should appear on the Agents page. Other tools report in other ways: see `docs/kit/REPORTING.md`.

## Try it without keys

Want to look around before you set anything up? One command starts a sample hub full of made-up workers, jobs and spend. It needs no keys and no password. It makes no AI calls and sends nothing out of your computer.

```
npm run demo
```

Open <http://localhost:3960>. You get a small team in a few projects, 30 days of work, jobs in every state, hand-offs between workers, scores, a few requests waiting for you (owner "Sam"), alert rules, and a lively campus. Switch between the 2D city, the 3D city, Neural and the plain pages as you like.

- A small label, "Demo data", stays at the bottom of every page so the sample is never mistaken for your own hub. Add `?clean=1` to a page's address to hide it (for screenshots).
- The Run and Push buttons answer "Demo data: nothing runs here". Nothing here can spend money.
- To see work cross models, open the Research project on the campus (its lead runs on Gemini, its scout on Claude, its fact checker on a local model), press Give a job on the lead, and pick two more workers under "Then hand it to". The demo plays the steps for you (in your own hub you press Run now on the first step; the later steps start by themselves): each step is handed on, the scout's step is declined by Claude once and passed on to Gemini, and each result says it is sample text. `--no-play` turns this off.
- It keeps its data in `demo-data`, never in `data`, and rebuilds that folder every time. It listens on this computer only. Press Ctrl+C to stop it; delete `demo-data` any time.
- Options: `npm run demo -- --port 3961` for another port, `--dir some-folder` for another folder (it refuses a folder that holds files it did not make, and your real `data` folder), `--seed-only` to write the folder without starting, `--no-live` to stop the small new steps it adds every few seconds.

When you are ready for your own hub, follow section 1 and section 2.

## 3. The four views

| View | What it shows |
|---|---|
| 2D city | Each project is a building. Workers have homes in the Residences and walk between buildings. Day and night pass. This is the lightest campus. |
| 3D city | The same city in 3D. Needs a device that can run 3D (WebGL2). If 3D cannot start, the hub stays on 2D. |
| Neural | The web of your workers and how they hand work on. Open a worker to see its jobs as a tree. |
| Pages | The plain web pages with a side menu: Home, Agents, Admin and the rest. No city in front. |

How to switch:

- On the campus, use the View picker at the top.
- Or open the menu and choose a view under Views.
- Or open the command bar and type `view 2d`, `view 3d`, `view neural` or `view pages`.

Your pick is remembered on that device only. Your phone can use 2D while your PC uses 3D. The view chosen at install is the default for a device that has not picked one.

Two layouts for the city, picked with the Layout picker next to the View picker (remembered on that device; adding `?layout=streets` or `?layout=quad` to the address tries one for that visit only). **Quad** (the default) is one connected campus round a central quad: each district's buildings stand wall to wall as a wing, a covered walk rings the quad and joins every building, your CEO tower closes the north end, and one long Residences block closes the south end behind the community garden, with a tram on the ring road and the river behind the homes. **Streets** is the street city by the river: Main street, the districts on their plots, three bridges and three Residences towers. Every project keeps its own building in both.

Where the workers live: the Residences (in Streets, across the river; in Quad, the long block at the south end). Tap a tower to go inside it floor by floor, like an office tower; tap a home to look in. Homes go by the credits a worker has earned (play money), and each level has a word: Basic, Comfy from 30, Nice from 100, and a two-floor Penthouse from 400 for the top tenth. When a worker's level changes they move to a home of the new level (another tower if theirs is full), and the feed and their card say so. A lit window means they're home. No tower stands taller than your CEO tower.

What they buy has a place. Home things and pets are in their flat (you see them in the floors view and when you look in). Outdoor things go on their balcony first (Comfy flats and up): a barbecue, a gnome, a lawn flamingo, a flower garden as planters. Anything too big for a balcony (a koi pond, a treehouse, a hot tub, a fence, a mailbox), and the outdoor things of anyone with no balcony, are on their own plot in the community garden beside the Residences, with their name on it. Tap the garden for who has what, or find it with search ( / ). Beside the plots is a shared garden that belongs to every resident (benches, a pergola, a vegetable patch), where people who are home sit in the evening, and by the work wings is a small Break garden where workers on a break sit on the benches; tap either for who is there now. So the screen never floods, each place shows only so much (a flat 4 to 12 things by level, a balcony 3, a garden plot 4, a desk 5), pets and plants first and then the newest; the rest are kept safe "in storage", named in the panels. Workers can also only buy two lasting things a week by themselves (treats and outings are not limited, and your gifts always go through); change it with `agents.mart.lastingPerWeek` in the settings, or set it to `null` for no limit.

The 2D city and the Pages view never load the 3D code. Neural uses a 2D city behind it unless that device has picked 3D. If the 3D part is switched off (Light preset), 3D is not in the picker.

## 4. Parts and presets

Everything beyond the core is a part, and each part is a switch. List them with what each needs:

```
node tools/setup.mjs --parts
```

Presets:

- **Light:** the core and the 2D campus. Runs on almost anything.
- **Standard:** adds the 3D campus, the Neural view, campus life (credits, the Campus Mart, chores, worker chatter) and the board and finance buddy.
- **Everything:** every part.

Parts, as listed by that command:

- Look: 3D campus, Neural view, campus pet.
- Team: board and finance buddy, pull-request reviews, campus life, quality checks, classic pages (Home, Search, Project).
- Team templates: game development team.
- Add-ons (off by default in the kit): YouTube and TikTok pipeline (the heaviest part; needs ffmpeg, Python, Chrome and extra keys), trading cards, watching and reading, games tracker, to-do and ideas, WoW raids.

To change parts later, edit the `modules` list in `data/hub-settings.json`, or run the setup again with a different `preset` and `modules`, then restart the hub (stop it and run `npm start`). A part that is switched off hides its pages and its server routes answer "switched off".

To add a part later, run setup with the preset plus `"modules": ["cards", "todo"]`, for example. To drop one, remove it from the list.

## 5. Workers, desks and HR

A **desk** is one worker's place on the roster. A **room** is a project. Each project has a lead, usually your own Claude Code session in the project's folder.

Two kinds of worker:

- **Reporting workers**: tools that run outside the hub (Claude Code, Codex, Antigravity, Cursor, chat apps, scripts). They report what they did. The hub cannot start or stop them.
- **Hub-run workers**: the hub calls the model itself (Claude, Gemini, OpenAI, Grok, DeepSeek, Muse, or a local model through Ollama or LM Studio). The desk card has a switch, "The hub runs this desk", and a monthly cap.

**HR** is how you get staff. Do not add workers around it. A project lead files a request:

```
node tools/agent-log.mjs request --from <project>-lead --room <project> --role "..." --why "..."
```

HR checks the request against your budget and the models you have. Then you approve it on the Agents page, or, if the board part is on, the board can approve small hires within 15% of your monthly budget. Approving a request that hires a hub-run worker asks for your dashboard password.

To add a worker with a local model, set the provider's address in `data/hub-settings.json` under `providers.local.baseUrl` (Ollama: `http://localhost:11434/v1`, LM Studio: `http://localhost:1234/v1`) and list the model names you have pulled.

## 6. Jobs and hand-offs

A **job** is a task for one worker. Give one from the worker's card on the Agents page, or from the command bar (any text that is not a command is offered as a job for a worker). A job only queues. Nothing runs or spends until you press Run, and running a paid worker asks for your password where the hub requires it.

A job can go on to other workers:

- You can chain a job to up to three more desks. When one step finishes, the next worker gets the original task and the previous result.
- A worker can hand its work on by itself (`tools/agent-log.mjs handoff`). At most 4 automatic hand-offs in a chain, and never straight back.
- A paid worker starts a new job from another worker's answer only while today's auto-run limit has room: `agents.autoRun.perDay` in `data/hub-settings.json`, 5 a day by default. `0` turns it off. Past the limit the job waits in Waiting for you with a Run now button. Chains you set yourself are not counted.

**Waiting for you** is your inbox: hires to approve, questions from workers, finished jobs and money warnings.

If a job fails, its card shows the error. Fix the cause (often a missing key, a paused worker or a cap) and retry from the card.

### When an AI service declines a job

Sometimes an AI service refuses a job because of its own filter, even though the job is fine (a false positive). When that happens to a job the hub runs for a worker, the hub:

- notes which service declined, which model, and the service's own reason, in the job's feed;
- passes the job once to the next service in a fixed order (Claude, Gemini, OpenAI, Grok, DeepSeek, Muse, a local model) that has a key, has not tried this job and is allowed for that worker, within the worker's monthly cap. The next service is shown the earlier reasons and may decline too;
- stops and puts the job in Waiting for you when the service's own words name a serious category (for example self-harm, weapons, sexual content, minors, hate, privacy) or when every allowed service has declined. Serious reasons always stop and come to you; nothing is passed on.

No AI decides whether the content is harmless: the only test is the service's own words against a fixed word list. This is for false positives. It is not a way round a provider's real policy.

Two switches, on by default: **Admin > Refusal pass-off** for the whole hub (turning it on asks for your password; turning it off does not), and **Pass refused jobs to another service** on a worker's card. The Agents page shows how many refusals each service and worker had in the last 30 days. This covers jobs run for workers only, not the video pipeline, HR or other helper calls.

## 7. Spend and caps

Every hub-run worker that is not a local model needs a monthly cap, and a model the hub has a price for, before the hub will run it. Claude and Gemini prices are built in; for OpenAI, Grok or DeepSeek add `providers.<id>.prices.<model> = { in, out }` (US dollars per million tokens) to the hub settings. Set it on the desk card or on the meter wall in the campus.

What a cap does:

- A hub-run API worker cannot start a new job once it has used its monthly cap. The job fails with a message such as "has used its cap this month". A worker runs one job at a time, and each job checks the cap when its turn comes, so one job at most can take it over.
- Local models cost nothing and need no cap.
- Warnings come before the cap is hit (the finance buddy, if the board part is on, projects the month end).

What a cap does not do: Claude Code sessions on a subscription cost you no API money and the hub cannot stop them. For those the hub sends alerts and plan-budget warnings. If you install the status-line meter, the hub can compare your plan's real use with its own estimate. It stops hub-started Claude Code sessions (autonomy and pushed jobs) once a project has used its share of the week, or the whole week passes the stop line (90% by default). The status-line meter tool itself is not part of this kit. Your own sessions are never stopped.

### AI helpers (off until you switch them on)

Some parts of the hub call an AI provider on their own, without you pressing anything: HR reviewing requests, the shared assistant, the board's helpers, worker chatter, growing personalities, and a worker starting a job because another worker's answer handed it one. These are the AI helpers. On a new install they are off, so a hub with keys in `.env` still makes no AI call you did not ask for.

- Admin has one card, "AI helpers": a switch (On or Off) and a daily limit in dollars, with what the helpers spent today.
- The limit starts at $1 a day. When the helpers reach it they pause until the next day and the hub notes it once in the activity feed. Empty means no limit.
- Turning the helpers on, or raising the limit, asks for your dashboard password. Turning them off, or lowering the limit, does not.
- Admin also has a card, "Pipeline AI budget": an optional monthly limit in dollars on the AI calls the hub makes for its own pipeline steps (the YouTube pipeline's steps, lookups and ideas, anything not run by a worker or HR). It starts empty (no limit). When the month's spend reaches it those steps stop and the job waits as "held" (nothing is lost); raise the limit or wait for next month. Raising it, or removing it, asks for your dashboard password; lowering it does not.
- Jobs you run yourself (Run now, Push), quality checks you start, the pipeline's own steps and lookups you click all keep working with the helpers off. A job that is waiting because the helpers are off shows "waiting to run" until you press Run now. While the helpers are off, new staff requests stay at "Waiting for HR" until you switch the helpers on or press Run HR yourself.

## 8. Quality scores

HR's judge scores finished jobs from 0 to 100, with a one-line reason. It does this in a batch from the job's task and saved result, so there is no extra AI call per job.

- Your thumbs up counts as at least 80. Your thumbs down counts as at most 20. Your thumb overrides the judge. A lead's thumb counts the same way unless you have rated it.
- A worker's average over the last 30 days (or its last 20 scored jobs if none are that recent) sets its pay in campus credits: 4 to 16 credits per finished job, 10 if not scored yet. Credits are part of campus life.
- A score is a guide you can overrule, not a verdict.
- The optional Quality checks part re-runs a worker's best past jobs on a cheaper model or a new brief and compares the scores. It spends real API money only when you run a check, shows the cost first, caps each run and asks for your password.

## 9. Alerts and the phone

**Alerts** go to your phone through ntfy, a free app for Android and iPhone that needs no account. Open the Admin page, find the phone alerts card and follow it: install the ntfy app, subscribe to your topic, and send a test. Each kind of alert has a level (off, quiet, normal, high, urgent). Sign-in alerts for a new device and lockouts cannot be turned off.

What leaves your PC: the alert text goes to the ntfy server (ntfy.sh by default). The topic name is random and secret; anyone who knows it can read your alerts. If you do not want that, turn alerts off or point them at your own ntfy server.

**Phone access to the hub itself** is off by default. The hub answers this PC only. To open it from your phone:

1. Set a dashboard password (`npm run set-password`).
2. In `data/hub-settings.json` set `"network": { "listen": "all" }`. Without a password the hub ignores this and stays on this PC.
3. Restart the hub.
4. Use [Tailscale](https://tailscale.com) on the PC and the phone and open the PC's Tailscale address on port 3000.

By default only this PC and Tailscale are answered. Home Wi-Fi (`"networks": "local,tailscale,lan"`) is an opt-in. Use it only on a network you trust: on shared Wi-Fi it lets strangers reach the sign-in page, and the password crosses the network without encryption. Internet visitors are always refused. Do not point a tunnel or forwarding tool (Tailscale Funnel, ngrok and the like) at the hub.

## 10. The command bar

Press `>` or `:` (when you are not typing in a box), or press the button in the campus top bar, to open the command bar. In Neural it looks like a terminal.

Type a few words. Every word you type must start one of the words in a command, so a sentence never runs an action by accident. Suggestions appear as you type; use the arrows and Enter, or tap one. Examples: `help`, `rooms`, `open admin`, `view neural`, `cap <worker> <dollars>`, and retry or skip actions for items that need them. A lock mark means the action may ask for your password. `/` stays search.

Anything that is not a command is offered as a job for a worker.

## 11. Pages inside the campus

The campus has no side menu of its own. The menu lists every other page of the hub (minus parts that are switched off). Each opens as a page block over the campus, so you do not leave the city. In the Pages view, the same pages have a side menu.

## 12. Clean-up and backups

**Free up space** is a card on the Admin page. It lists everything that could be freed, in groups, with exact paths and sizes. It is a list first: nothing is removed until you tick groups, press the button and enter your password. Groups that remove original footage or renders need an extra OK and are off by default. Original videos are the only copy and cannot be brought back. This mostly matters if you use the YouTube pipeline add-on.

**Backups** run every night (3 a.m. by default) as a core part. They copy what cannot be rebuilt (settings, trackers, every job's record, not videos) into a dated folder next to the hub folder (`<hub folder name>-backups`), keeping the last 14. Sign-in keys are left out on purpose. You can point `backup.dir` in `pipeline.config.json` at a cloud-synced folder, and `backup.copies` at extra folders. On the Admin page, "Back up now" (in Health) makes a backup at once and "Restore from a backup" brings files back.

**A second copy somewhere else** (off by default): in `data/hub-settings.json` add `"backup": { "copyTo": "D:/my-hub-backups", "keep": 14 }`, then restart the hub. After each backup the hub copies that night's folder to `copyTo` (a folder on another drive or in a synced cloud folder; it is created if the folder it sits in exists) and keeps the newest `keep` dated folders in both places (14 by default). Only folders named like a backup date are ever removed; anything else you keep there is left alone. If the copy fails (drive not connected, no space) the backup on this PC still counts, the Admin page says so under Health ("Second copy FAILED ..."), and you get at most one phone alert a day. The Admin page only shows this: there is no box to type the folder in, the settings file is the one place. To prove a backup can bring a hub back, run `node tools/restore-test.mjs <backup folder>`: it restores into a temporary folder, starts the hub there on port 3997, checks it and cleans up. Keys, the password and tokens are never in a backup, so you type them in again after a real restore.

**Back up your data yourself** any time by copying the `data` folder and `.env` while the hub is stopped. They hold your keys, settings, roster and history. Keep the copy private.

## 13. Updating

An update replaces the app's program files and leaves everything of yours alone.

**What an update does not touch.** Your `data` folder (settings, roster, history, jobs), your `.env` (keys and the password hash) and your backups. Zip updates also keep your own `pipeline.config.json`. **What it does touch.** The program files that came with the app: code, pages, docs, and the installed packages (it runs `npm ci` for them).

**What it does every time.** It takes a backup first (the same as "Back up now" in Admin) and stops if the backup fails. It never goes looking by itself: the hub does not check for updates, and an update only goes onto the network when you run it (a git update fetches from the project's server). After it installs the new version it starts it once on a copy of your data (the "self-check"; you can run it any time with `npm run self-check`). If anything fails, it puts the old version back, so the hub still starts the way it did.

Always close the hub first (the window that runs `npm start`); the update refuses to run while it is open. Then, in the hub folder:

**1. A git checkout** (you got the hub with `git clone`):

```
npm run update            shows what it would do and changes nothing
npm run update -- --yes   does it
```

It fetches from the project, moves your copy forward to the newest version (a fast-forward only: never a merge, never a reset), runs `npm ci --ignore-scripts`, runs the self-check and prints what changed. If you have edited a file that came with the app, it refuses and lists the file: copy your edit somewhere safe, put the original back (`git stash` or `git checkout -- <file>`) and run it again. There is no force option on purpose.

**2. A downloaded zip** (no git): download the kit zip of the new version from the project's releases page, then:

```
npm run update -- --from-zip C:\path\to\deskcity-1.2.3.zip           shows the plan
npm run update -- --from-zip C:\path\to\deskcity-1.2.3.zip --yes     does it
```

It checks that the zip really is a Deskcity kit and not older than yours, copies each file it will replace into a folder next to the hub folder named `<hub folder name>-before-update-<date>` (the way back), and then copies the new files over the old. It leaves `data`, `.env`, `node_modules`, your `pipeline.config.json` and anything the kit's `.gitignore` lists. It never deletes a file.

**3. Going back:**

```
npm run update -- --rollback --yes
```

puts the code back as it was before the last update (the old commit, or the files from the before-update folder), without touching `data`. `data/update-last.json` is the note it reads; the Admin page shows it under "Updates".

**Checking for a new version.** On the Admin page, "Updates" has a "Check for an update" button, and `npm run update -- --check` does the same from the command line. Each asks the project's releases address once for the newest version number and prints "you have X, newest is Y". Nothing else on the page or in the hub asks, and if no update address is set (the default until the project publishes one) it says so and sends nothing.

**"Data format" in one sentence.** `data/format.json` holds a whole number that says how your saved files are laid out; when a new version needs a different layout it converts your files the first time it starts (after a backup), and an older version refuses to start on data from a newer one instead of risking it.

**If an update fails.** Read the last lines it printed: it says what it did and whether the old version is back. The backup it took first is in your backups folder (the path is in `data/update-last.json` and on the Admin page). If the hub then says your data is from a newer version, update again, or restore that backup from Admin ("Restore from a backup"). See TROUBLESHOOTING.md.

## 14. Uninstalling

1. Stop the hub (close the terminal that is running `npm start`).
2. Remove the Claude Code hook lines that mention `agent-hook.mjs` from `~/.claude/settings.json`, if you installed it.
3. If you want to keep your data, copy the `data` folder somewhere first.
4. Delete the hub folder. Delete the backup folder (`<hub folder name>-backups`) if you do not want it.

The hub installs nothing outside its folder, except that hook and any alert subscription in the ntfy app. The kit adds no start-up (auto-start) entry; you start the hub yourself with `npm start`.

## 15. Privacy: what leaves your PC

**By default, nothing.** A new hub left idle makes no outside request: no telemetry, no automatic update check, no usage data to the authors. The hub only reaches out for the things below, and each is something you set up or open.

| What | Goes to | When |
|---|---|---|
| Prompts and job text | The AI provider of the worker that runs the job (Anthropic, Google, OpenAI, xAI, DeepSeek, or your own local server) | A worker you set up on an API runs a job, with the key from your `.env`. Local models on your own PC send nothing outside |
| Model lists and key checks | The same providers | Only for a provider whose key is in `.env`, and only when you open the AI page (the Gemini model list); never at start-up and never for a provider you have no key for. The health check (part of the YouTube pipeline) checks keys. They send no job text |
| Phone alerts | The ntfy server (ntfy.sh by default, or your own) | Only after you turn alerts on in Admin. Anyone who knows your random topic name can read them |
| Pull-request reviews | GitHub | Only if you add a GitHub token and the Pull-request reviews part is on |
| Weather | Open-Meteo, asked by your browser | Only if you set a town. Your town's coordinates go with the request |
| Support dates for Node and Python | endoflife.date | When you open the Admin page. No data of yours is sent beyond the address your computer has on any web request |
| Update check | The project's releases address (the setting `kit.updatesUrl`; empty until the project publishes one, and then nothing is asked) | Only when you press "Check for an update" in Admin or run `npm run update -- --check`. Nothing about you or this PC is sent; Admin keeps the answer for an hour. A git update (`npm run update -- --yes`) also fetches from the project's git server, only when you run it |
| Campus treats | A short fixed list of free public sites (art, space, Wikipedia) | Only if the Campus life part and the AI helpers are on |
| Add-on parts | The sites they are for: video and TikTok, card prices, anime and manga lists, game logs | Only when you switch that part on |

The campus fonts and all scripts are served by the hub itself. Nothing is loaded from a font or script service.

**What is stored, and where.** On your computer only:

- `.env`: your keys and the password hash. Never leave it in a repo or send it to anyone.
- `data/hub-settings.json`: your answers from setup.
- `data/agents/`: the roster, events, jobs and workers' answers, requests, scores, and the agent key (`token.txt`).
- `data/notify.json`: your alert settings and the random topic name.
- `data/security.json` and `data/security.log`: sign-in records, devices and lockouts.
- The part you switch on may add its own folder under `data/` (cards, jobs and so on).
- Backups: a folder next to the hub folder (`<hub folder name>-backups`), without keys.

To remove it all, delete the hub folder and that backup folder (section 14).
