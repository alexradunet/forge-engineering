# Forge host: Claude Code

This session runs in Claude Code. Write every answer for a Claude Code user.

## Host verbs

A Forge skill names a host verb, for example `host.title`. Do the step of the verb in this table.

| Verb | Step in Claude Code |
|---|---|
| `host.title` | The Forge hook sets the title at session start. In a ticket worktree, the hook corrects the title at the next prompt of the user, but not for a closed ticket. At a state change that must show before the next prompt (a 🟡 gate) and at Close (✅), tell the user to run `/rename <title>`. In the main checkout, always tell the user to run `/rename <title>`. A new session gets its title from `claude -n "<title>"`. |
| `host.ask` | Call `AskUserQuestion`. Put the recommended answer first and give its reason. The user can write a free answer in the `Other` row. |
| `host.move` | Call `EnterWorktree` with `path` set to the worktree folder. The user approves the move. When the tool is not available or it refuses, tell the user to run `cd "<folder>"; claude` and then say "continue". |
| `host.spawn` | Give the user the command for a new terminal: `cd "<folder>"; claude -n "<title>" "<prompt>"`. The `Agent` tool starts only a subagent, not a ticket session. |
| `host.message` | When cross-session messages are on, find the session with `ListAgents` and call `SendMessage`. Otherwise give the user the text to paste into the other session. |
| `host.sessions` | Call `ListAgents` when it is available. Otherwise run `node <plugin>/scripts/forge.mjs board` for the tickets. The native `/resume` picker lists the sessions. |
| `host.artifact` | Give a Markdown link with the absolute path of the file. Never use the `Artifact` tool: it sends the file to claude.ai. |
| `host.open` | Give a Markdown link with the absolute path of each file. |
| `host.notify` | Call `PushNotification` with the text. It sends nothing when the user is at the terminal. When the tool is not loaded, load it with the tool search. When it is not there, skip the step. |
| `host.resume` | Give the user `cd "<folder>" && claude --resume "<KEY>"`. When the folder is the main checkout of a ticket that had a worktree, add: press Ctrl+W in the picker to see the sessions of all worktrees. |
| `host.comments` | There are no document comments. Ask the user to paste the comments into the chat. |

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
