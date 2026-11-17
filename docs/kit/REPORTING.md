# Reporting to the hub from any AI tool

Every AI that works on one of your projects reports into the hub, so the Agents page and the campus show who did what, what it cost, and what's waiting on you. Pick the row for the tool. `<hub>` is your hub folder (Settings: `hubFolder`), `<desk>` and `<room>` are the worker's desk id and project room (see `node <hub>/tools/agent-log.mjs desks`).

| Tool | How it reports | Set up once |
|---|---|---|
| **Claude Code** | Automatically, through the hook: session start, tools used (file names only), tokens per turn. | `node <hub>/tools/agent-hook-check.mjs --fix --folder <project folder>`, then start a new session there. |
| **OpenAI Codex CLI, GitHub Copilot CLI, Antigravity, Gemini CLI, Cursor, other agents that can run commands** | The agent logs each finished task itself. | Put the "Hub rule for agents" block below in the tool's rules or instructions file for that project (for example `AGENTS.md` or `GEMINI.md` in the project folder). |
| **Workers the hub runs** (Claude, Gemini, OpenAI, Grok, DeepSeek, Muse, local) | Automatically: every job and its cost. | Nothing: give the desk "The hub runs this desk" and a cap. |
| **Scripts and scheduled jobs** | One line when a job finishes. | `node <hub>/tools/agent-log.mjs event --desk <desk> --room <room> --summary "<one line>" [--provider ...] [--model ...]` |
| **Chat apps that can't run commands** (claude.ai, ChatGPT, Gemini, Grok on the web or phone) | A last line in their reply that you paste into the Agents page ("Paste a Hub log"). | Ask them to end every report with `Hub log: <desk> (<model>) <what they did>`. |

Any of them can also hand on work, ask for staff or ask you a question:
- Hand on: `agent-log.mjs handoff --desk <desk> --to <other desk> --text "..."` (at most 4 automatic hand-offs in a chain, never straight back).
- New standing helper: `agent-log.mjs request --from <lead> --room <room> --role "..." --why "..."`. HR checks it, then you or the board approve it.
- A yes-or-no question for you: `agent-log.mjs ask --from <desk> --room <room> --question "..."`. It lands in Waiting for you.

## Hub rule for agents (copy into AGENTS.md, GEMINI.md, CLAUDE.md or a chat's instructions)
```
HUB RULE: this project reports to <owner>'s hub (<hub>, room <room>, your desk <desk>).
- When you finish a task, log it: node <hub>/tools/agent-log.mjs event --desk <desk> --room <room> --summary "<one line>" --provider <provider> --model <model>
  (No terminal? End your reply with: Hub log: <desk> (<model>) <what you did>.)
- Need a standing helper? Ask HR: node <hub>/tools/agent-log.mjs request --from <desk> --room <room> --role "<role>" --why "<what's piling up>"
- A question only <owner> can answer: node <hub>/tools/agent-log.mjs ask --from <desk> --room <room> --question "..."
- Every job, prompt or thread you hand to another AI, session or tool ends with this rule.
```
