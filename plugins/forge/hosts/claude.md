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
| `host.automation` | Forge does not support Claude Code automations. `CronCreate` lives only in the session, and `RemoteTrigger` runs on an external cloud service. Give the manual steps: a headless `claude -p "<prompt>"` run that the operating system scheduler starts. |

## Ticket canvas

The ticket canvas is a local HTML page (`canvas.html` in the ticket folder, from `forge.mjs canvas <KEY>`).

- Give the user the `file://` link that the command prints. The user opens it in a browser, and loads the page again after each `canvas` run.
- The board page (`board.html` in `<wiki>/raw`, from `forge.mjs board`) shows all tickets. The board page and each canvas have links to each other. Give its `file://` link in the same way.
- Never use the `Artifact` tool for the canvas or the board page: it sends the page to claude.ai.
- For comments, run `forge.mjs canvas <KEY> --serve` with `Bash` and `run_in_background: true`. Read the `http://127.0.0.1` link from its output, give it to the user, and end the turn. The session continues when the user selects **Send to agent** and the command stops. Then read the output: it holds the comment message.
- The link works only in a browser on the machine of the session. For a browser on another machine, run it with `--port <n>`, and tell the user to forward that port. Never use another address than `127.0.0.1`.
- A code link on the page opens the file in VS Code (`vscode://file/...`). When the user has no VS Code, run `forge.mjs canvas <KEY> --links file`.

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
