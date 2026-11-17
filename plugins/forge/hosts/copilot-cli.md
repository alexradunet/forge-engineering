# Forge host: GitHub Copilot CLI

This session runs in the GitHub Copilot CLI (`copilot`) in a terminal. The VS Code session tools are not available here. Write every answer for a terminal user.

## Host verbs

A Forge skill names a host verb, for example `host.title`. Do the step of the verb in this table.

| Verb | Step in the Copilot CLI |
|---|---|
| `host.title` | Tell the user to run `/rename <title>`. A new session gets its title from `--name "<title>"`. |
| `host.ask` | In an interactive session, call `ask_user`. In a prompt mode run (`copilot -p`), or when `ask_user` is not available, write the question with the recommended answer and stop the turn. |
| `host.move` | Tell the user to run `/cwd "<folder>"` and then say "continue". The session keeps its history. Do not continue the work in the old folder. |
| `host.spawn` | Give the user the command for a new terminal: `copilot -C "<folder>" --name "<title>" -i "<prompt>"`. |
| `host.message` | There is no tool to send a message to another session. Give the user the text to paste into the other session. |
| `host.sessions` | Run `node <plugin>/scripts/forge.mjs board`. The user sees the sessions with `/resume`. |
| `host.groups` | Not supported: there are no session groups. Skip the step. |
| `host.artifact` | Give a Markdown link with the absolute path of the file. |
| `host.open` | Give a Markdown link with the absolute path of each file. Do not run an editor command: VS Code can be missing. |
| `host.comments` | There are no document comments. Ask the user to paste the comments into the chat. |
| `host.automation` | There are no automations. Give the manual steps: a headless `copilot -p "<prompt>"` run that the operating system scheduler starts. |

## Ticket canvas

The ticket canvas is a local HTML page (`canvas.html` in the ticket folder, from `forge.mjs canvas <KEY>`).

- Give the user the `file://` link that the command prints. The user opens it in a browser, and loads the page again after each `canvas` run.
- For comments, run `forge.mjs canvas <KEY> --serve` as a background shell command, and give the `http://127.0.0.1` link from its output. When the user selects **Send to agent**, the command prints the comment message and stops, and the CLI tells the session. Then read the output of the command. Tell the user to write `sent` if the session does not continue.
- The link works only in a browser on the machine of the session. For a browser on another machine, run it with `--port <n>`, and tell the user to forward that port. Never use another address than `127.0.0.1`.
- A code link on the page opens the file in VS Code (`vscode://file/...`). When the user has no VS Code, run `forge.mjs canvas <KEY> --links file`.

## Copilot CLI features

- Before you advise on a Copilot CLI feature, read its current documentation page. The CLI changes often.
- When the documentation and a forge file do not agree, follow the documentation. Tell the user the forge file and the difference.

| Topic | Documentation |
|---|---|
| Copilot CLI | https://docs.github.com/copilot/concepts/agents/copilot-cli/about-copilot-cli |
| CLI plugins | https://docs.github.com/copilot/concepts/agents/copilot-cli/about-cli-plugins |
| Changelog | https://github.com/github/copilot-cli/blob/main/changelog.md |
