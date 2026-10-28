---
description: Paths, capabilities, and external-write rules of the forge plugin (always on).
applyTo: '**'
alwaysApply: true
---
# forge plugin

The `forge` plugin gives this session its rules, skills, and scripts.
`<plugin>` is the plugin folder. A skill folder is `<plugin>/skills/<name>`.

## Paths

Each repository has its own wiki. Get the paths with
`node "<plugin>/scripts/forge.mjs" where --json` once per session, from the repository or a worktree:

- `<repo>`: the main checkout. Worktrees are in `../<repo>.worktrees`.
- `<wiki>`: `../<repo>.wiki`. It holds the knowledge pages, the ticket folders (`raw/tickets`), and the daily recaps.
- `<config>`: `<wiki>/forge/config`, with `tracker.md`, `repo.md`, `ci.md`, and `policy.md`.

When `where` fails, or the wiki or config is missing, tell the user to say "set up forge".
When `config` or `run` says `Not approved`, show the files and their changes. Run `forge.mjs trust approve` only after the user says yes.
A ticket lives in the wiki of the repository where it starts. Other wikis get only a link to it.

## 🪟 VS Code Agents window

forge runs in the VS Code Agents window, with the Copilot harness and the Agent Host. Write every answer for that window.

- Give UI steps for the Agents window: the sessions list, the Changes panel, **Chat: Open Customizations**, and Command Palette commands.
- VS Code changes each month. Your memory of a VS Code feature can be old.
- Before you advise on, configure, or change a VS Code feature, read its current documentation page. This applies to sessions, worktrees, automations, agent plugins, MCP servers, settings, and harnesses.
- Once per session, before the first such step, read the latest release notes. Check for changes to the feature.
- When the documentation and a forge file do not agree, follow the documentation. Tell the user the forge file and the difference.

| Topic | Documentation |
|---|---|
| Release notes (latest version) | https://code.visualstudio.com/updates |
| Agents window | https://code.visualstudio.com/docs/agents/run/agents-window |
| Agent Host | https://code.visualstudio.com/docs/agents/concepts/agent-host |
| Automations | https://code.visualstudio.com/docs/agents/run/automations |
| Agent harnesses | https://code.visualstudio.com/docs/agents/run/agent-harnesses |
| Agent plugins | https://code.visualstudio.com/docs/agent-customization/agent-plugins |

## Config and capabilities

- `<file>.<key>` means the frontmatter key `<key>` of `<config>/<file>.md`, for example `repo.changeName`.
  `node "<plugin>/scripts/forge.mjs" config --json` gives all values with defaults.
- `tracker.queries` is the **Queries** table of `tracker.md`. `repo.checkouts` is the **Checkouts** table of `repo.md`.
- A skill names a **capability**, for example `tracker.comment`. To run it:
  1. Open `<config>/<kind>.md`, where `<kind>` is the first part of the name.
  2. Run its **Auth check** once per session, before the first call.
  3. Use the row of the capability in **Capabilities**. Replace each `<placeholder>` with a config value or a ticket value.
  4. When the row says `manual` or `not supported`, use the manual step.
- Never call a tracker, repository host, or CI tool that the config does not name.
## 🛠️ Tool choice: CLI first

forge strongly prefers command-line tools to MCP servers. Use this order for every external call:

1. **The official CLI** of the tool, for example `gh`, `glab`, `az`, or `acli`. Use its JSON output.
2. **The REST API** through the CLI (`gh api`, `glab api`) or a pack script that reads its token from the OS credential store.
3. **An MCP server**, only when no CLI or REST call can do the capability, or when the row says why the MCP tool is better.

Reasons:

- A CLI command is visible. The user can read it, run it again, and put it in a script.
- Sessions that `create_session` starts load no MCP servers. A CLI works in every session.
- MCP tool lists use context in each request. A CLI uses context only when it runs.
- A CLI keeps its login in its own store. The plugin holds no token and no auth proxy.

Do not add an MCP server for a capability that a CLI already covers. Do not switch to an MCP tool because it is loaded.

## External writes

A write capability changes something outside the workspace. Before each one:

1. Draft the text in the ticket `outbox/` folder, and run the Sendable? gate (the `ticket` skill).
2. Show the exact command, the target, and the text. Wait for an explicit "yes" for this one write.
3. Pass long text through a file in the system temp folder: `forge-<key>-body.md`. Delete the file after the write.
4. Record the URL or id in the outbox file (`status: sent`) and in `log.md`.

Never, with any tool:

- Merge a change request, or turn on auto-merge. The user merges in the web UI.
- Close a change request or a work item without explicit approval in the current conversation.
- Approve your own change request, or resolve review threads that the user did not ask you to resolve.
- Trigger, rerun, or cancel CI runs in bulk. One run for each approval.
- Read, print, or store tokens.

## Manual step

When a row says `manual`, or a tool is missing:

1. Tell the user what to do in one numbered list: where, what to click or paste, and the text.
2. For a read, ask for the result or a link. Mark it as user-supplied in the ticket notes.
3. For a write, ask the user to confirm when it is done. Record the confirmation in `log.md`.
4. Continue. A missing tool never blocks a gate by itself.

When a call fails, stop and do not retry a write. Report the location, the cause, and the fix from **Failures** of the config file.
