# forge plugin

The `forge` plugin gives this session its rules, skills, and scripts. The Forge sessionStart hook
gives this text and the `# forge style` text at the start of each session, because plugin rule files do not load in each session.
`<plugin>` is the plugin folder. A skill folder is `<plugin>/skills/<name>`.

## Paths

Each repository has its own wiki. The first lines of the Forge session context give the paths of the session folder.
In another folder, or when those lines are missing, get the paths with
`node "<plugin>/scripts/forge.mjs" where --json`, from the repository or a worktree:

- `<repo>`: the main checkout. Worktrees are in `../<repo>.worktrees`.
- `<wiki>`: `../<repo>.wiki`. It is the memory of the user and the agents, and it can be personal or shared. It holds the knowledge pages, the company rules in `<wiki>/rules/`, the ticket folders (`raw/tickets`), and the daily recaps.
- `<config>`: `<wiki>/forge/config`, with `tracker.md`, `repo.md`, `ci.md`, and `policy.md`.

When `where` fails, or the wiki or config is missing, tell the user to say "set up forge".
When `config` or `run` says `Not approved`, show the files and their changes. Run `forge.mjs trust approve` only after the user says yes.
A ticket lives in the wiki of the repository where it starts. Other wikis get only a link to it.

New tickets use `workflow: full-v3`: full research and an interview, then four review
gates (Scoped?, Planned?, Shippable?, Learned?) plus Sendable? for each external write. Each
gate has one plain document (`story.md`, `plan.md`, `review.md`, `close.md`) with a summary of
at most 150 words under its title. `forge.mjs canvas <KEY>` shows the whole ticket on one HTML page, with links to the board page and to the other tickets.
An older ticket (`full-v2`, `full-v1`, S/M/L, or no marker) keeps its own layout, phases, gates, and
skips: its rules are in `legacy/rules.md` of the `ticket` skill, and it never moves to `full-v3`.
Never infer workflow, state, or approval from missing metadata. The `ticket` skill defines revision
evidence and affected-action blocking; read-only resume remains available.

## 🧩 Host verbs

Forge runs in more than one host: the VS Code Agents window, the Copilot CLI, and Claude Code.
A Forge skill names a **host verb** for a step that each host does in a different way, for example `host.title` (set the session title) or `host.move` (move the session to a folder).
The `# Forge host` part of the session context has the verb table of this host. Do the step that its row gives.
When the row says that the host cannot do the step, give the user the manual step. A missing host tool never blocks a gate.

| Verb | Meaning |
|---|---|
| `host.title` | Set the session title. |
| `host.ask` | Ask the user a question with a recommended answer. |
| `host.move` | Move this session to a folder (a ticket worktree). |
| `host.spawn` | Start a new independent session in a folder. |
| `host.message` | Send a message to another session. |
| `host.sessions` | List the sessions and read their state. |
| `host.groups` | Show or set the session groups. |
| `host.artifact` | Show a file to the user. |
| `host.open` | Open documents for review, so that the user can read them and add comments. |
| `host.comments` | Read and answer the comments of the user on a document. |
| `host.automation` | Create, list, or run a scheduled automation. |

## 🎫 Ticket sessions

- A board request is the exception: "show the board", "show me the board", "refresh", or a question about a ticket that does not ask to work on it (for example "what is APP-123 waiting on?"). Load the `board` skill before any other tool call, and follow it. The sessions list alone is not the board: the board starts with `forge.mjs board --json`. Do not load the `ticket` skill, do not change the session title, and ignore the `# Forge ticket context` part for that request.
- When the first message names a work item key or URL, load the `ticket` skill (Start or Resume).
- The user asked for ticket session titles: `<KEY> - <state emoji> - <short>`. Set the title (`host.title`) first, before any other tool call or question, and again at each state change. This overrides the general advice not to rename a fresh chat.
- When the session context has a `# Forge ticket context` part, follow it.
- Forge names the ticket worktree and branch: `forge.mjs worktree <KEY> --summary "<goal>"` (see "Worktrees" in the `ticket` skill).
- Each ticket has its own session. To open a session for a different ticket, start a new independent session (`host.spawn`) in the ticket worktree, else in the main checkout.

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

## Learning from artifacts

When the user submits artifact feedback or asks to review comments, read the approved config.
If `policy.learningMode` is `true`, use the `learning-mode` skill for user questions that mark unfamiliar concepts.
Accept plain questions and optional `learn:` markers, including outside ticket gates.
Offer a bite first; create it only after acceptance. Keep normal corrections in the host feedback workflow.
Do not resolve learning threads automatically or make a lesson a condition for approval.
When the switch is `false`, handle ordinary questions normally, without lesson offers.
Use the skill for explicit lesson requests and for enabling or disabling learning mode.

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

A write capability changes something outside the workspace. Before each one:

1. Draft the text in the ticket `outbox/` folder. Run a full pass of the `writing` skill (outbound mode) on it. Then run the Sendable? gate (the `ticket` skill). Its hashed manifest binds this exact draft plus exact `command` and `target`; sidecar values must match. README gate `doc` names the draft, never its sidecar. Any command or target change requires fresh explicit approval.
2. Show the exact command, the target, and the text. Wait for an explicit "yes" for this one write.
3. Pass long text through a file in the system temp folder: `forge-<key>-body.md`. Delete the file after the write.
4. After GO, create `outbox/<name>.approval.json` outside the hashed set with `version: 1`, exact `doc`, `status: approved`, `approval_manifest`, `approval_hash`, `approval_date`, exact `target`, and exact `command`. After sending, set sidecar `status: sent` and `result` to the returned URL/id, and record it in the ticket journal. Never stamp metadata into the approved draft or reuse one approval for another write.

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
3. For a write, ask the user to confirm when it is done. Record the confirmation in the ticket journal (`journal.md`, or `log.md` in an older ticket).
4. Continue. A missing tool never blocks a gate by itself.

When a call fails, stop and do not retry a write. Report the location, the cause, and the fix from **Failures** of the config file.
