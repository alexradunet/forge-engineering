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
  4. When the row says `manual` or `not supported`, use the manual step.
- Never call a tracker, repository host, or CI tool that the config does not name.

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
