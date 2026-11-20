# Forge host: Claude Code

This session runs in Claude Code. The VS Code session tools are not available here. Write every answer for a Claude Code user.

## Host verbs

A Forge skill names a host verb, for example `host.title`. Do the step of the verb in this table.

| Verb | Step in Claude Code |
|---|---|
| `host.title` | The Forge hook sets the title at session start. To change it later, tell the user to run `/rename <title>`. A new session gets its title from `claude -n "<title>"`. |
| `host.ask` | Call `AskUserQuestion`. Put the recommended answer first and give its reason. The user can write a free answer in the `Other` row. |
| `host.move` | Call `EnterWorktree` with `path` set to the worktree folder. The user approves the move. When the tool is not available or it refuses, tell the user to run `cd "<folder>"; claude` and then say "continue". |
| `host.spawn` | Give the user the command for a new terminal: `cd "<folder>"; claude -n "<title>" "<prompt>"`. The `Agent` tool starts only a subagent, not a ticket session. |
| `host.message` | When cross-session messages are on, find the session with `ListAgents` and call `SendMessage`. Otherwise give the user the text to paste into the other session. |
| `host.sessions` | Call `ListAgents` when it is available. Otherwise run `node <plugin>/scripts/forge.mjs board`. |
| `host.groups` | Not supported: there are no session groups. Skip the step. |
| `host.artifact` | Give a Markdown link with the absolute path of the file. Never use the `Artifact` tool: it sends the file to claude.ai. |
| `host.open` | Give a Markdown link with the absolute path of each file. Do not run an editor command: VS Code can be missing. |
| `host.comments` | There are no document comments. Ask the user to paste the comments into the chat. |
| `host.write` | Run the write command. The Forge gate guard makes Claude Code ask the user in the permission prompt, and the answer is the "yes". In `bypassPermissions` mode and in a `claude -p` run, the command is denied: give the user the exact command. For a write through an MCP tool or a script, ask with `host.ask` first. |
| `host.automation` | Forge does not support Claude Code automations. `CronCreate` lives only in the session, and `RemoteTrigger` runs on an external cloud service. Give the manual steps: a headless `claude -p "<prompt>"` run that the operating system scheduler starts. |

## Ticket canvas

The ticket canvas is a local HTML page (`canvas.html` in the ticket folder, from `forge.mjs canvas <KEY>`).

- Give the user the `file://` link that the command prints. The user opens it in a browser, and loads the page again after each `canvas` run.
- The board page (`board.html` in `<forge>/raw`, from `forge.mjs board`) shows all tickets. The board page and each canvas have links to each other. The wiki page (`wiki.html`, in the same folder) shows the pages of the wiki and the summary pages of the closed tickets. Give its `file://` link in the same way.
- Never use the `Artifact` tool for the canvas, the board page, or the wiki page: it sends the page to claude.ai.
- For comments, run `forge.mjs canvas <KEY> --serve` with `Bash` and `run_in_background: true`. Read the `http://127.0.0.1` link from its output, give it to the user, and end the turn. The session continues when the user selects **Send to agent** and the command stops. Then read the output: it holds the comment message.
- The link works only in a browser on the machine of the session. For a browser on another machine, run it with `--port <n>`, and tell the user to forward that port. Never use another address than `127.0.0.1`.
- A code link on the page opens the file in VS Code (`vscode://file/...`). When the user has no VS Code, run `forge.mjs canvas <KEY> --links file`.

## Live view

The live view shows the board page and each ticket canvas with what each Claude Code session does now (`forge.mjs open`).

- Start it only when the user asks for it, for example "live view" or "show the sessions live". Run `forge.mjs open --no-browser` with `Bash`. It starts the server of this repository as a process of its own and prints the links of the board and the wiki. Give them to the user.
- A second run starts no second server: it prints the same links. One server runs for each repository, and `forge.mjs open --list` gives each one.
- When the command says that the server did not start, run `forge.mjs live` with `Bash` and `run_in_background: true`, and read the link from its output.
- No page can send text or an answer to a session. The comments of a canvas go with **Copy all**, or with `forge.mjs canvas <KEY> --serve`.
- A session that is not live shows as "closed" or "no end seen", with the buttons **Resume** and **Copy command**. **Resume** opens a terminal of the user with `claude --resume <id>` in the folder of the session.
- **Resume** is a button for the user. Never send a request to the `/resume` route, and never start or continue a session for the user without a "yes".
- The Forge hooks write the session list `<forge>/raw/sessions.jsonl` at the start and at the end of a session. Do not change that file.
- A session shows on its ticket when it runs in the worktree of the ticket, or when its title starts with the ticket key. Each other session is in the list **Other sessions**.
- A session shows after its next prompt or tool call. The hooks load at session start, so a session that started before an update of forge reports after a restart.
- A "needs you" line is a report. Never answer that prompt for the user.
- The rules of the canvas server apply: the link works only in a browser on the machine of the session, `--port <n>` gives a fixed port to forward, and the `Artifact` tool is never used.
- The server stops after 8 hours with no event and no request of a page. To stop it before that, run `forge.mjs open --stop`.

## Claude Code features

- Before you advise on a Claude Code feature, read its current documentation page. Claude Code changes often.
- When the documentation and a forge file do not agree, follow the documentation. Tell the user the forge file and the difference.

| Topic | Documentation |
|---|---|
| Claude Code overview | https://code.claude.com/docs/en/overview |
| Plugins | https://code.claude.com/docs/en/plugins |
| Hooks | https://code.claude.com/docs/en/hooks |
| Tools | https://code.claude.com/docs/en/tools-reference |
| Changelog | https://code.claude.com/docs/en/changelog |
