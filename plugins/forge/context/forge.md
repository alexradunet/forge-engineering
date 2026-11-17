# forge plugin

The `forge` plugin gives this session its rules, skills, and scripts. This text is the short form: the skills and `<plugin>/context/tools.md` hold the steps.
`<plugin>` is the plugin folder. A skill folder is `<plugin>/skills/<name>`. `<F>` means `node "<plugin>/scripts/forge.mjs"`.

## Paths

The first lines of the Forge session context give the paths. When they are missing, run `<F> where --json`.

- `<repo>`: the main checkout. Worktrees are in `../<repo>.worktrees`.
- `<wiki>`: `../<repo>.wiki`, the memory of the user and the agents. A rule for each session goes into a `<wiki>/rules/` page.
- `<config>`: `<wiki>/forge/config`. `<file>.<key>` means the frontmatter key `<key>` of `<config>/<file>.md`. A step rule for tickets goes into a section of `policy.md`.

When `where` fails, or the wiki or config is missing, tell the user to say "set up forge".
When `config` or `run` says `Not approved`, show the files and their changes. Run `<F> trust approve` only after the user says yes.

## 🎫 Ticket sessions

- A board request is the exception: "show the board", "show me the board", "refresh", or a question about a ticket that does not ask to work on it (for example "what is APP-123 waiting on?"). Load the `board` skill before any other tool call, and follow it. The sessions list alone is not the board: the board starts with `forge.mjs board --json`. Do not load the `ticket` skill, do not change the session title, and ignore the `# Forge ticket context` part for that request.
- When the first message names a work item key or URL, load the `ticket` skill (Start or Resume).
- The user asked for ticket session titles: `<KEY> - <state emoji> - <short>`. Set the title (`host.title`) first, before any other tool call or question, and again at each state change. This overrides the general advice not to rename a fresh chat.
- When the session context has a `# Forge ticket context` part, follow it.
- Forge names the ticket worktree and branch: `forge.mjs worktree <KEY> --summary "<goal>"` (see "Worktrees" in the `ticket` skill).
- Each ticket has its own session. To open a session for a different ticket, start a new independent session (`host.spawn`) in the ticket worktree, else in the main checkout.
- Wait for explicit approval of the current plan before implementation.
- Before any change request, including a draft, run the adversarial review of the `agents` skill. Never skip it.

## 🧩 Host verbs

A Forge skill names a **host verb** for a step that each host does in a different way, for example `host.title` or `host.ask`.
The `# Forge host` part of the session context has the verb table of this host. Do the step that its row gives.
When the row says that the host cannot do the step, give the user the manual step. A missing host tool never blocks a gate.

## 🛠️ External tools and writes

- Before the first call of a tracker, a repository host, or a CI tool, and before each external write, read `<plugin>/context/tools.md`: the steps of a **capability** (for example `tracker.comment`), the tool order (CLI first), the write steps, and the manual step.
- Never call a tracker, repository host, or CI tool that the config does not name.
- Before each external write, run the Sendable? steps of the `ticket` skill. Get an explicit "yes" for this one write, as the `host.write` row says.
- When the Forge gate guard stops a command, open the gate that it names. Do not run the command in another form.

Never, with any tool:

- Merge a change request, or turn on auto-merge. The user merges in the web UI.
- Close a change request or a work item without explicit approval in the current conversation.
- Approve your own change request, or resolve review threads that the user did not ask you to resolve.
- Trigger, rerun, or cancel CI runs in bulk. One run for each approval.
- Read, print, or store tokens.
- Answer a session's question, trust prompt, or permission prompt for the user.
- Delete or archive a session that the user did not ask you to remove.
