# FAQ

Answers come from this repo's code and docs.

## Basics

**1. What is Deskcity?**
One place on your own computer to see every AI worker you use, who is doing which job, what each costs against a monthly cap, and a quality score per job. See the README.

**2. Is it open source?**
Yes. It is licensed under MIT (see `LICENSE`). You can use, change and share it.

**3. Does it work on Windows, Mac and Linux?**
Windows is the system it is built and used on every day. The kit ships a GitHub workflow (`.github/workflows/test.yml`) that runs the tests on Linux (Node 22), so Linux is covered by tests but has had less hands-on use. Mac is untested: nobody has run it there. You need Node.js 20 or newer on any of them.

**4. Do I need Claude Code?**
No. Claude Code makes setup easier ("set up my hub") and reports in automatically through a hook. Without it, set up with `node tools/setup.mjs --answers <file>` (see the user guide). Other tools report in through the rule block in `docs/kit/REPORTING.md`.

**5. Which models work?**
Workers the hub runs can use Claude, Gemini, OpenAI-style models, Grok, DeepSeek, Muse (Meta), and local models through Ollama or LM Studio. You list the model names you have; the hub does not assume names because they change often. Tools that run outside the hub (coding agents, chat apps) report in by hook, command or a pasted line. A Claude key is needed for HR and the finance buddy.

**6. Why a city?**
It is one way to see the same data: projects as buildings, workers walking between them, spend on a meter wall. If you do not like it, use Neural (a web of workers) or Pages (plain web pages). Every device can switch any time.

**7. Can I turn 3D off?**
Yes. The Light preset leaves the 3D part off. 2D and Pages never load the 3D code. To turn it off on an existing hub, remove `campus3d` from `modules` in `data/hub-settings.json` and restart. Or just pick 2D on one device with the View picker.

## Cost and money

**8. How much does it cost to run?**
The hub is free. You pay your own AI providers. Subscription tools and local models add nothing. HR and the finance buddy use a small model and are capped at a couple of dollars a month at most (see the kit setup notes). Campus life uses a few cents a day if you turn it on. Quality checks cost up to $1 each, and only when you run one.

**9. What does a cap do?**
A hub-run API worker cannot start a new job once it has used its monthly cap. Its jobs run one at a time, so the cap is passed by one job at most. It cannot run at all without a cap, or on a model the hub has no price for (local models excepted; for OpenAI, Grok or DeepSeek add the price in the hub settings). A cap does not stop a Claude Code session on a subscription: the hub cannot stop those, so it alerts you and warns about plan budget.

**10. Where do I set a cap?**
On the worker's desk card, on the meter wall in the campus, or in the command bar (`cap <worker> <dollars>`). Raising a cap asks for your dashboard password, once one is set.

## Safety and privacy

**10a. Will it spend money by itself?**
Not on a new install. The hub's own helpers (HR, the shared assistant, worker chatter, growing personalities, and workers starting jobs by themselves) are off until you turn on the "AI helpers" switch in Admin, even if your keys are in `.env`. When you turn them on you also set a daily dollar limit (it starts at $1). Jobs you run yourself still work with the switch off, and they cost what the worker's cap allows. With no dashboard password set, anything on this PC can start them; set one to be asked.

**10b. Can I make it ask before a costly job?**
Yes, it does by default. A new job the hub runs on an API that it estimates at over $0.25, or a coding-agent session the hub starts that it estimates at over $5 (counted at API prices), waits in Waiting for you until you approve it. Change or turn off the lines in Admin, "Approval line". It cannot hold coding-agent sessions you open yourself. See section 7 of the user guide.

**11. What leaves my PC?**
Your prompts and job text go to the AI provider each worker uses (that is how an AI worker works). Phone alerts are off until you turn them on in Admin; once on, they go to the ntfy server (ntfy.sh by default). The campus fonts are served by the hub itself (no font service is contacted). Only if you set a town, the campus asks Open-Meteo for live weather (your town's coordinates go to that service). Some parts reach other sites you ask for (the YouTube pipeline, card prices, deal watch). The hub has no telemetry and sends nothing to its authors. Check `docs/kit/` and your own `.env` before turning on add-ons.

**12. Is my key safe, and where is it stored?**
Keys live in `.env` in the hub folder, in plain text, like most local tools. `.env` and `data/` are git-ignored so they are not committed. The dashboard password is stored only as a hash. Anything running as you on the PC can read `.env`. Never paste keys into a chat.

**13. Is it safe to put on my phone?**
It is off by default. Turn it on only with a password, and use Tailscale. Home Wi-Fi is an opt-in and is not encrypted. Do not use tunnels or forwarding tools. See the user guide, section 9, and SECURITY.md.

**14. What is prompt injection, and what does the hub do about it?**
Prompt injection is text a worker reads (a web page, a pull request, a comment, a file) that tries to steer it into doing something you did not ask. The hub does not solve it. It fences the damage instead: workers' text is treated as data, every paid worker has a monthly cap, risky actions need your password again (within 10 minutes), and a worker's own answer can start new paid jobs only up to a daily auto-run limit (5 by default). Keep caps low and treat every worker's output as untrusted.

**15. How do I report a security hole?**
Privately. See SECURITY.md.

## Using it

**16. How do I add a worker?**
Ask HR. A project lead files a request with `tools/agent-log.mjs request`, HR checks it against your budget and models, and you approve it on the Agents page. To report a tool you already use, follow `docs/kit/REPORTING.md`. A hub-run worker needs a monthly cap (local models excepted).

**17. How do I add a project?**
Tell Claude Code "add a project to my hub", or add it to your answers file and run `node tools/setup.mjs --answers <file>` again. Existing rooms and workers are kept.

**18. How do I remove a part?**
Take its id out of `modules` in `data/hub-settings.json` (`node tools/setup.mjs --parts` lists the ids) and restart the hub. Its pages are hidden and its routes answer "switched off". Your data for that part is not deleted.

**19. What if a job fails?**
Open the job's card to read the error. Common causes: no key for that provider, the worker is paused, the worker has no cap or has used it, or the model name is wrong. Fix it and retry. See TROUBLESHOOTING.md.

**20. Why was my job sent to a different AI service?**
When an AI service declines a job (its own filter or refusal, not an outage), the hub notes which service declined and its reason, and lets the next service try once. It stops and puts the job in Waiting for you when the reason names a serious category or every service has declined. It is for false positives, not for getting round a provider's policy. Turn it off for one worker on its desk card, or for the whole hub in Admin > Refusal pass-off. See the user guide, section 6.

**21. What is the quality score?**
HR's judge scores finished jobs from 0 to 100. Your thumbs up or down overrides it (80 or more, or 20 or less). A worker's 30-day average sets its pay in campus credits. It is a guide you can overrule, not a verdict.

**22. Can two people use one hub?**
It is built as a personal tool for one owner on one PC. There is one dashboard password and one set of workers. Multi-user use is not supported.

**23. Does it restart itself?**
Started with `npm start`, no: if you close the terminal, it stops. `start.cmd` (or `bash start.sh`) starts it again 10 seconds after a crash, and the installer can start it when you sign in. After a change to server code or settings, stop it and start it again. Page changes only need a browser reload.

**24. How do I update it?**
Close the hub, then run `npm run update` in the hub folder. It shows the plan; add `-- --yes` to do it. It works for a git checkout, and with `-- --from-zip <file>` for a downloaded zip. `npm run update -- --rollback --yes` goes back. User guide, section 13.

**24a. Will an update lose my data?**
No. An update only replaces the program files; your `data` folder and `.env` are never touched. It takes a backup first and stops if that fails, it tests the new version on a copy of your data before it says done, and if anything fails it puts the old version back. You can always go back with `npm run update -- --rollback`.

## Project

**25. How do I contribute?**
Read `CONTRIBUTING.md`. Run `npm test`, keep to the zero-build-step design, and open an issue first for big changes. Contributions are under MIT.

**26. Who built it, and how?**
One person, with AI help. Most of the code was written by AI and checked by tests and one human. Treat it as early software: back up `data/`, keep caps low and read SECURITY.md.
