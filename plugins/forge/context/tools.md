# forge tools

Read this file before the first call of a tracker, a repository host, or a CI tool in a session, and before each external write.
The session context has only a short form of these rules (`# forge plugin`, "External tools and writes").
After a compaction of the session, this text can be gone: read it again.

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

1. **The official CLI** of the tool, for example `gh` or `az`. Use its JSON output.
2. **The REST API** through the CLI (`gh api`) or a wiki script that reads its token from the OS credential store.
3. **An MCP server**, only when no CLI or REST call can do the capability, or when the row says why the MCP tool is better.

Reasons:

- A CLI command is visible. The user can read it, run it again, and put it in a script.
- A session can start without MCP servers, for example a new session that `host.spawn` starts. A CLI works in every session.
- MCP tool lists use context in each request. A CLI uses context only when it runs.
- A CLI keeps its login in its own store. The plugin holds no token and no auth proxy.

Do not add an MCP server for a capability that a CLI already covers. Do not switch to an MCP tool because it is loaded.
A config file can name an MCP server for a capability that has no good CLI. Then that row is the exception, as the file says.

## External writes

A write capability changes something outside the workspace: `tracker.comment`, `tracker.create`, `tracker.transition`, `tracker.link`, `repo.open-change`, `repo.update-change`, `repo.reply`, and `ci.trigger`. Before each one:

1. Draft the text as `outbox/<target>.draft.md` in the ticket folder, from the template `<plugin>/skills/ticket/templates/outbox.draft.md`. Send only the text between its `send` markers. Run a full pass of the `writing` skill (outbound mode) on it. A write with no text (for example a close) needs no draft.
2. Run the Sendable? steps of the `ticket` skill: show the text, the draft link, the target, and the exact command in chat.
3. Get an explicit "yes" for this one write, as the `host.write` row of the host says. With the gate guard, the prompt of the host is the "yes". Without it, ask with `host.ask` first. A new change request needs none when its draft is in the approved Shippable? set.
4. Pass long text through a file in the system temp folder: `forge-<key>-body.md`. Delete the file after the write.
5. After the write, add a `log` entry to the ticket journal with the command, the target, and the returned id or link.

The "Never, with any tool" list of the session context applies to each write: no merge, no close without approval, no approval of your own change request, no CI runs in bulk, and no tokens.

## 🛡️ Gate guard

The Forge preToolUse hook reads each shell command before it runs. For a `git push` or the change request command of `repo.open-change`
in a ticket worktree, it checks the gates of the ticket: Planned? and Shippable? (an older ticket: the gates of its own workflow).

For a command of a write capability in a ticket worktree, it answers `ask`: the host asks the user, and that answer is the "yes" for this one write.

- When an approval is missing or stale, the hook stops the command and names each finding. Open the gate (the `ticket` skill, Review gates), and wait for the answer of the user.
- When the session runs in a mode with no prompt (Claude Code `bypassPermissions`), the hook denies a write instead of asking. Give the user the exact command to run.
- Do not run the command in another form, from another folder, or in a script. Only the user can run it without the gate.
- `policy.gateGuard` selects the mode for a push and a new change request: `deny` (default), `ask` (the host asks the user), or `off`. `off` also stops the ask for a write.
- The hook reads only the words of the command. It does not see a write through an MCP tool, a script, or an API call with fields and no method option. The written rules stay in force for each write that it cannot see.

## Manual step

When a row says `manual`, or a tool is missing:

1. Tell the user what to do in one numbered list: where, what to click or paste, and the text.
2. For a read, ask for the result or a link. Mark it as user-supplied in the ticket notes.
3. For a write, ask the user to confirm when it is done. Record the confirmation in the ticket journal (`journal.md`, or `log.md` in an older ticket).
4. Continue. A missing tool never blocks a gate by itself.

When a call fails, stop and do not retry a write. Report the location, the cause, and the fix from **Failures** of the config file.
