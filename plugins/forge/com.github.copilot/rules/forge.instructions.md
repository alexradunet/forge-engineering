---
description: Paths and entry points of the forge plugin (always on).
applyTo: '**'
alwaysApply: true
---
# forge plugin

The `forge` plugin gives this session its rules, skills, and helper scripts.
Machine paths live in user environment variables, not in the plugin:

- `<wiki>` means the value of `FORGE_WIKI_ROOT`: the wiki folder. It also holds the ticket folders.
- `<forge-home>` means the value of `FORGE_HOME`: the local checkout of your forge fork.
- Read them with `$env:FORGE_WIKI_ROOT` and `$env:FORGE_HOME`.
- When a variable is empty, tell the user to run `Install-Forge.ps1` and restart VS Code fully.
- Helper scripts live in the plugin's `scripts` folder. The `forge-setup` skill lists them with their full paths.
- `<config>` means `<forge-home>\plugins\forge\config`. `Get-ForgeConfig.ps1` gives the folder (`.ConfigDir`) and the values (`.Config`).

## Config and capabilities

The team config is four Markdown files in `<config>`: `tracker.md`, `repo.md`, `ci.md`, and `policy.md`.

- `<file>.<key>` means the frontmatter key `<key>` of `<config>\<file>.md`, for example `repo.changeName`.
- `tracker.queries` is the **Queries** table of `tracker.md`. `repo.checkouts` is the **Checkouts** table of `repo.md`.
- A skill names a **capability**, for example `tracker.comment`. To run it:
  1. Open `<config>\<kind>.md`, where `<kind>` is the first part of the name.
  2. Run its **Auth check** once per session, before the first call.
  3. Use the row of the capability in **Capabilities**. Replace each `<placeholder>` with a config value or a ticket value.
     When a row gives a CLI command and an MCP tool, use the CLI command.
  4. When the row says `manual` or `not supported`, use the manual step.
- Never call a tracker, repository host, or CI tool that the config does not name.

## 🛠️ Tool choice: CLI first

forge strongly prefers command-line tools to MCP servers. Use this order for every external call:

1. **The official CLI** of the tool, for example `gh`, `glab`, `az`, or `acli`. Use its JSON output.
2. **The REST API** with `curl.exe` or `Invoke-RestMethod`, with the CLI login or a token in a user variable.
3. **An MCP server**, only when no CLI or REST call can do the capability, or when the row says why the MCP tool is better.

Reasons:

- A CLI command is visible. The user can read it, run it again, and put it in a script.
- Sessions that `create_session` starts load no MCP servers. A CLI works in every session.
- MCP tool lists use context in each request. A CLI uses context only when it runs.
- A CLI keeps its login in its own store. The plugin holds no URL with a token and no auth proxy.

Do not add an MCP server for a capability that a CLI already covers. Do not switch to an MCP tool because it is loaded.

## External writes

A write capability changes something outside the workspace. Before each one:

1. Draft the text in the ticket `outbox\` folder, and run the Sendable? gate (the `ticket` skill).
2. Show the exact command, the target, and the text. Wait for an explicit "yes" for this one write.
3. Pass long text through a file: `$env:TEMP\forge-<key>-body.md`. Delete the file after the write.
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
