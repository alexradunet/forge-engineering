# Forge host: GitHub Copilot CLI

This session runs in the GitHub Copilot CLI (`copilot`) in a terminal. Write every answer for a terminal user.

## Host verbs

A Forge skill names a host verb, for example `host.title`. Do the step of the verb in this table.

| Verb | Step in the Copilot CLI |
|---|---|
| `host.title` | Tell the user to run `/rename <title>`. A new session gets its title from `--name "<title>"`. |
| `host.ask` | In an interactive session, call `ask_user`. In a prompt mode run (`copilot -p`), or when `ask_user` is not available, write the question with the recommended answer and stop the turn. |
| `host.move` | Tell the user to run `/cwd "<folder>"` and then say "continue". The session keeps its history. Do not continue the work in the old folder. |
| `host.spawn` | Give the user the command for a new terminal: `copilot -C "<folder>" --name "<title>" -i "<prompt>"`. |
| `host.message` | There is no tool to send a message to another session. Give the user the text to paste into the other session. |
| `host.sessions` | Run `node <plugin>/scripts/forge.mjs board` for the tickets. The native `/resume` picker lists the sessions. |
| `host.artifact` | Give a Markdown link with the absolute path of the file. |
| `host.open` | Give a Markdown link with the absolute path of each file. |
| `host.comments` | There are no document comments. Ask the user to paste the comments into the chat. |

## Copilot CLI features

- Before you advise on a Copilot CLI feature, read its current documentation page. The CLI changes often.
- When the documentation and a forge file do not agree, follow the documentation. Tell the user the forge file and the difference.

| Topic | Documentation |
|---|---|
| Copilot CLI | https://docs.github.com/copilot/concepts/agents/copilot-cli/about-copilot-cli |
| CLI plugins | https://docs.github.com/copilot/concepts/agents/copilot-cli/about-cli-plugins |
| Changelog | https://github.com/github/copilot-cli/blob/main/changelog.md |
