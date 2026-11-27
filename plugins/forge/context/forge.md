# forge plugin

The `forge` plugin gives this session its rules, skills, and scripts. This text is the short form: the skills hold the steps.
`<plugin>` is the plugin folder. A skill folder is `<plugin>/skills/<name>`. `<F>` means `node "<plugin>/scripts/forge.mjs"`.

## Paths

The first lines of the Forge session context give the paths. When they are missing, run `<F> where --json`.

- `<repo>`: the main checkout. Worktrees are in `../<repo>.worktrees`.
- `<forge>`: `../<repo>.forge`, the Forge folder. It has `wiki/`, and the local folders `raw/` (tickets, pages) and `archive/`.
- `<wiki>`: `<forge>/wiki`, the memory of the user and the agents. A rule for each session goes into a `<wiki>/rules/` page.
- `<config>`: `<wiki>/forge/config`. `<file>.<key>` means the frontmatter key `<key>` of `<config>/<file>.md`. A step rule for tickets goes into a section of `policy.md`.

When `where` fails, or the wiki or config is missing, tell the user to say "set up forge".

## 🎫 Ticket sessions

- A board request is the exception: "show the board", "show me the board", "refresh", or a question about a ticket that does not ask to work on it (for example "what is APP-123 waiting on?"). Load the `board` skill before any other tool call, and follow it. The sessions list alone is not the board: the board starts with `forge.mjs board --json`. Do not load the `ticket` skill, do not change the session title, and ignore the `# Forge ticket context` part for that request.
- When the first message names a work item key or URL, load the `ticket` skill (Start or Resume).
- When the user asks for a ticket with no key (for example "new local ticket"), load the `ticket` skill. Start gives it a key `L-<n>`.
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

## 🛠️ No external tools

Forge calls no tracker, no change request host, and no CI tool. The agent gives the user the text to paste (a comment, a change request title and body, an email), and the user sends it. The user gives the agent the result (a URL, a status, a log).

- The Forge gate guard checks `git push` in a ticket worktree: Planned? and Shippable? must be approved. When it stops a command, open the gate that it names. Do not run the command in another form, from another folder, or in a script.
- A step that needs a tool that you do not have is a manual step: tell the user what to do in a numbered list, ask for the result, and continue. A missing tool never blocks a gate.

Never:

- Call a tracker, a change request host, or a CI tool. Give the user the text.
- Merge a change request, or turn on auto-merge. The user merges in the web UI.
- Read, print, or store tokens.
- Answer a session's question, trust prompt, or permission prompt for the user.
- Delete or archive a session that the user did not ask you to remove.

## 🧠 Memory

Use a hybrid memory layer. The `wiki` skill describes the rules.

- Store one short, tool-specific fact in built-in memory.
- Record topics, gotchas with causes, decisions, and connections in `<wiki>`.
- Before non-trivial work, read `<wiki>/index.md` and open pages that match the task.
- Verify a wiki claim before you rely on it.
- After you record something in the wiki, tell the user which pages changed.
- Never put secrets, personal data, or copies of company documentation in the wiki.
