# Troubleshooting

Each entry is: symptom, cause, fix.

## The hub will not start

**"Port 3000 is already in use: the app is probably already running in another window."**
Cause: another copy of the hub (or another program) is using port 3000.
Fix: close the other terminal window that runs `npm start`, or pick another port. In `.env` set:

```
PORT=3001
```

Then start again and open `http://localhost:3001`. The Claude Code hook and the `agent-log` tool read `PORT` from the same `.env`, so they find the hub on its new port.

**"Another hub is already using this data folder."**
Cause: a second hub was started on the same `data/` folder (the message names the other one's process and port). Two hubs on one folder would write the same files and run the same timers, so the second refuses to start.
Fix: close the other hub. If you are sure none is running, delete `data/hub.lock` and start again.

**"Update refused: you have changed N file(s) that came with the app."**
Cause: `npm run update` found edits in files that belong to the app (it lists them). An update would have to overwrite or merge them, so it stops before it changes anything.
Fix: copy your edits somewhere safe, then put the originals back with `git stash` (or `git checkout -- <file>`), and run `npm run update` again. Your data and `.env` are not affected either way. There is no force option on purpose. If you used a zip, the same update works (`-- --from-zip`) and keeps a copy of every file it replaces.

**"This data folder is in format N, but this version of the app only understands format M."**
Cause: the hub was started on data that a newer version has already used (usually after going back to an older version). An older version could misread or damage it, so it refuses to start. Nothing was changed.
Fix: update to the newer version again (`npm run update`), or restore the backup taken before that update (Admin, "Restore from a backup", or copy it back by hand into `data`). Going back by `npm run update -- --rollback` tells you the same when the data format is newer than the old code.

**Nothing happens, or "Cannot find module".**
Cause: packages are not installed, or Node is too old.
Fix: check Node is 20 or newer, then install:

```
node --version
npm install
```

Run `node tools/setup.mjs --check` to see what is missing.

## Restarting the hub

The hub is started by `npm start` and does not restart itself. To restart: go to the terminal that runs it, press Ctrl+C, and run `npm start` again. Do this after changing settings, `.env`, `hub-settings.json` or any server code. A change to a page only needs a browser reload.

## Signing in

**"No password set" or the sign-in page says to set one.**
Cause: no dashboard password exists yet. Without one, only this PC can use the hub and spending actions are open to anything on this PC.
Fix:

```
npm run set-password
```

Restart the hub.

**Sign-in loop (you sign in and land on the sign-in page again).**
Cause: the sign-in cookie is not being kept. Common reasons: you are using a different address than the one you signed in on (`localhost` vs the PC's name), cookies are blocked, or `DASHBOARD_SESSION_KEY` in `.env` was deleted or changed, which signs every device out.
Fix: use one address consistently, allow cookies for it, and sign in again.

**Locked out ("too many tries").**
Cause: the hub allows 5 wrong tries per address in 15 minutes and 20 an hour in total. The PC itself is exempt from the hourly total.
Fix: wait, then try again, or sign in from the PC.

**401 "Sign in first".**
Cause: you are not signed in, or the session has ended (cookies last 30 days).
Fix: sign in again.

**403 "Not available from this network" or "Not available at this address".**
Cause: the connection comes from a network the hub does not answer, or you used an address it does not allow (for example an IP address instead of the PC's name or Tailscale address).
Fix: use `localhost` on the PC. On a phone use the PC's Tailscale name. See the next entry for allowed networks.

**403 "Cross-site request blocked".**
Cause: a request came from another website, or from a different host name than the page.
Fix: open the hub directly at one address and do not embed it in another page.

**403 "Enter your password to do this."**
Cause: the action spends money, runs a command or writes outside the hub, and needs your password again (it then stays valid for 10 minutes).
Fix: enter the dashboard password when it asks. If no password is set, set one first.

## Phone

**Cannot reach the hub from my phone.**
Causes, in order:
1. Phone access is off. It is off by default.
2. No dashboard password is set. Without one the hub stays on this PC even if you asked for more.
3. The hub was not restarted after the change.
4. The phone is on a network the hub does not answer. By default only this PC and Tailscale are answered.
5. The PC's firewall blocks the port. On Windows, the first time phone access is switched on, Windows may ask whether to allow Node.js through the firewall. Choose Allow (private networks is enough). If you closed that box, open Windows Security > Firewall & network protection > Allow an app through firewall > Change settings, and tick Node.js for Private. On Mac or Linux, allow incoming connections for `node` in the firewall you use.

Fix: set a password, set `"network": { "listen": "all" }` in `data/hub-settings.json`, restart, and use Tailscale on both devices. The start-up message in the terminal says whether it listens on the network.

## Reporting

**Hook not reporting (Claude Code sessions do not show up).**
Cause: the hook is not installed, the project folder is not mapped to a project, or the session was started before the hook was installed.
Fix: run the check, and fix what it lists:

```
node tools/agent-hook-check.mjs --fix --folder <your project folder>
```

Then start a new Claude Code session in that folder. The check also sends a test event.

**A tool other than Claude Code does not show up.**
Cause: it has no hook. Those tools log their own work.
Fix: add the rule block from `docs/kit/REPORTING.md` to the project's rules file, or log by hand:

```
node tools/agent-log.mjs event --desk <desk> --room <room> --summary "test"
```

## Keys and workers

**No keys ("needs a key", or HR and the finance buddy do not work).**
Cause: `.env` is missing or the key is still the placeholder text.
Fix: copy `.env.example` to `.env`, paste your key, and restart. `node tools/setup.mjs --check` shows which keys it sees.

**A job will not run: "needs a monthly cap before the hub runs it".**
Cause: a hub-run worker (not a local model) has no cap.
Fix: set a monthly cap on its desk card.

**Cap reached: "has used its cap this month".**
Cause: the worker has spent its monthly cap. The hub will not start a new job for it.
Fix: wait for the next month, or raise the cap on its card (this asks for your password). Look at why it spent that much first.

**"The hub doesn't run <worker>" or "<worker> is paused".**
Cause: "The hub runs this desk" is off, or the worker is paused.
Fix: turn the switch on, or start it again from its card or the meter wall.

**A job is stuck (still "taken" or never starts).**
Cause: the hub was stopped while it ran, the worker is not one the hub runs (it waits for the tool to report), or the job waits in Waiting for you because today's auto-run limit is used up.
Fix: check Waiting for you and press Run now if it is there. If the hub was restarted mid-job, retry the job from its card. The hub does not pick a job back up by itself after a restart: a hub-run job that was running then stays "taken" until you retry it.

## What you see

**A page is blank or a part is missing.**
Causes: the part is switched off, the page failed to load, or your device cannot run 3D.
Fix: check the parts list (`node tools/setup.mjs --parts` and `modules` in `data/hub-settings.json`). If a page is blank, reload, then open your browser's developer console and read the error. If 3D does not start, the hub stays on 2D; pick 2D in the View picker.

**A page says a part is "switched off".**
Cause: that part is off.
Fix: add its id to `modules` in `data/hub-settings.json` and restart.

## Known issues

What is still open from the review before release. The rest of that review's findings are fixed (worker caps, spending passwords, the sign-in lock-out, the data-folder lock).

- **With no dashboard password set, nothing asks for one.** This PC is trusted for everything, including the buttons that spend. Set a password (`npm run set-password`) and spending, turning the AI helpers on and raising a limit all ask for it.
- **A worker's cap can be blocked by made-up costs.** Anything holding the agent key can post a cost for a worker. One post counts for at most $5, a worker can post only 30 a minute, and a day's reported cost over three times the worker's cap is ignored, so it is limited but not impossible.
- **The Agents overview can fail on a huge events file** (hundreds of thousands of lines). Normal use stays far below that.
- **The add-on parts** (YouTube and TikTok, card prices, the MTG Arena reader, World of Warcraft) are the author's own tools: some use sites' unofficial interfaces, and they are not supported. Admin and the setup list say so. The YouTube and cards parts need Python scripts this kit does not include, so they show as "not included in this kit".
- **`/api/hub/settings` returns the hub's full folder path** to signed-in pages.
- **A copied or restored `data/hub.lock` can make the hub think another hub is running.** The hub writes it to stop two hubs sharing one data folder. If the hub refuses to start and says another hub is using the folder, and you know none is running, delete `data/hub.lock`.
- **Mac has not been tested.**

## Disk and logs

**High disk use.**
Cause: jobs, renders, working files and backups pile up (mostly with the YouTube pipeline add-on).
Fix: Admin page, "Free up space". It lists first, and removes only what you tick after you enter your password. Old nightly backups are trimmed to the last 14 automatically.

**Where are the logs?**
- The terminal that runs `npm start` shows server messages and errors.
- `data/logs/runs.jsonl` holds recent app events (the last 5000 entries).
- The Admin page shows the sign-in and security log.
- Job results are kept under `data/agents/outputs`.

When you report a problem, include the last lines of the terminal and your Node version (`node --version`). Do not include `.env` or anything from `data/agents/token.txt`.
