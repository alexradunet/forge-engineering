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
| `host.write` | Ask with `ask_user` first, and run the write command only after an explicit "yes": no check has shown yet that the Forge hook runs here. The hook can then ask again. In a prompt mode run or in autopilot, give the user the exact command. Exception: the creation of a change request whose draft is in the approved Shippable? set needs no second "yes" (see Sendable?). |

## Pages

The board page (`board.html` in `<forge>/raw`, from `forge.mjs board`) shows all tickets, and a card opens the document of its ticket. The wiki page (`wiki.html`, in the same folder) shows the pages of the wiki and the summary pages of the closed tickets. The two pages have links to each other.

- Give the user the `file://` link that the command prints. The user opens it in a browser, and loads the page again after each `board` run.
- To start the live server, run `forge.mjs open --no-browser` (see Live view). Give the user the links that it prints (`http://127.0.0.1`, this machine only).
- The link works only in a browser on the machine of the session. For a browser on another machine, run `forge.mjs open --no-browser --port <n>`, and tell the user to forward that port. Never use another address than `127.0.0.1`.
- A code link on the page opens the file in VS Code (`vscode://file/...`). When the user has no VS Code, run `forge.mjs board --links file`.

## Live view

The board page of the live server (`forge.mjs open`) lists the Copilot CLI sessions of the repository from the session list `<forge>/raw/sessions.jsonl`.

- Start the live server only when the user asks for it. Run `forge.mjs open --no-browser`, and give the links that it prints.
- A Copilot CLI session shows with no tool activity: "no end seen" while it runs, and "closed" after its end. The Forge hooks write the list at the start and at the end of a session. Do not change that file.
- A session row has the buttons **Resume** and **Copy command**. **Resume** opens a terminal of the user with `copilot --resume=<id>` in the folder of the session.
- **Resume** is a button for the user. Never send a request to the `/resume` route, and never start or continue a session for the user without a "yes".

## Copilot CLI features

- Before you advise on a Copilot CLI feature, read its current documentation page. The CLI changes often.
- When the documentation and a forge file do not agree, follow the documentation. Tell the user the forge file and the difference.

| Topic | Documentation |
|---|---|
| Copilot CLI | https://docs.github.com/copilot/concepts/agents/copilot-cli/about-copilot-cli |
| CLI plugins | https://docs.github.com/copilot/concepts/agents/copilot-cli/about-cli-plugins |
| Changelog | https://github.com/github/copilot-cli/blob/main/changelog.md |
