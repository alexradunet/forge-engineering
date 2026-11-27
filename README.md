# 🧭 forge-engineering

`forge` is an agent plugin for Claude Code and GitHub Copilot CLI (see Hosts).
One plugin folder runs in both.
It gives every agent session a ticket workflow with review gates, a small set of plain ticket documents,
a repository wiki, coordinated agent sessions, and a ticket board that any session can show as a text table.

forge calls no external tool: no tracker, no change request host, and no CI.
A ticket lives only in `<forge>/raw/tickets/<key>`. Its README has an `item:` line with the link to the work item in any tracker (GitHub, Azure DevOps, Jira, and others).
You paste the text of the work item into the chat. The agent writes paste texts for you in `outbox/` of the ticket, and you send them yourself.

```mermaid
flowchart LR
  plugin["forge plugin<br/>rules, skills, scripts,<br/>config templates"] --> host["Claude Code<br/>or Copilot CLI"]
  repo["code checkout"] --> host
  wiki["../repo.forge<br/>wiki: config, rules, knowledge<br/>raw: tickets"] --> host
  shared["wiki Git remote<br/>private"] <-->|push / pull| wiki
```

## 🚀 Start

1. Clone `https://github.com/alexradunet/forge-engineering`.
2. Install the plugin from the clone:
   - Claude Code: `claude plugin marketplace add <clone>`, then `claude plugin install forge@forge`. Or start a session with `claude --plugin-dir <clone>/plugins/forge`.
   - Copilot CLI: `copilot plugin install <clone>/plugins/forge`, or start a session with `copilot --plugin-dir <clone>/plugins/forge`.
3. Open a session in your code checkout.
4. In the chat, say "set up forge".
5. Answer the setup form: your branch pattern (`users/<your name>/{KEY}-{slug}`) and the path of your clone.

Needs: Node.js 20 or later and Git.
forge runs on Windows, macOS, and Linux.

Setup reads the repository first, so most answers are prefilled:

- the default branch and the branch pattern of your local branches, for example `users/alex/{KEY}-{slug}`,
- the path and the remote of your clone.

Then it creates the Forge folder `../<repo>.forge` with its wiki, seeds the config and rule pages, writes your values with a validated command,
and asks you to approve the files by hash.
It asks for the team size (small or large) and the response style, and writes the policy values for them. At the end, it offers the optional extras: the other policy values.

| Say | Result |
|---|---|
| "set up forge" | First-time setup, or resume at the first open step |
| "check forge" | `doctor`, plugin version, and the changelog of the current host |
| "refresh the forge config" | Copy the new config templates after an update, and keep your personal values |
| "finish forge setup" | Resume after a stop |

`forge.mjs doctor` warns while `<user>` remains in `repo.branchPattern` or while the main checkout path is missing. It also checks whether a session start hook ran (`hook`) and whether the plugin clone is behind its remote (`plugin:version`). It names each file that Forge 14.0.0 does not use. Each `warn` line gives one exact fix command. `forge.mjs doctor --fetch` runs `git fetch` in the plugin clone first.

### 🔌 Hosts

The rules and the skills name host verbs, for example `host.title` (set the session title) or `host.spawn`
(start a session). The `sessionStart` hook finds the host and adds its table from `plugins/forge/hosts/`,
which gives the tool or the manual step for each verb. Each host gets the same features. When a host has no tool
for a verb, the agent tells you the manual step.

| Host | Start | Host found by | Notes |
|---|---|---|---|
| GitHub Copilot CLI | `copilot plugin install <clone>/plugins/forge` or `copilot --plugin-dir <clone>/plugins/forge` | no `CLAUDECODE` | You run `/rename` and `/cwd`. The board is the session overview. |
| Claude Code | `claude plugin marketplace add <clone>`, then `claude plugin install forge@forge`. Or `claude --plugin-dir <clone>/plugins/forge` | `CLAUDECODE=1` | The hooks set the title. The context comes in numbered parts. |

`forge.mjs context --host <copilot-cli|claude>` prints the context of a host, for a check or for a host without the hook.

Forge 13.0.0 removed the VS Code Agents window host. Forge 12.4.0 is the last version with it.

### 🔄 Update forge

To update `forge`:

1. Claude Code: pull the latest `main` in your clone. A marketplace that you added from a folder reads the plugin from that folder, so the pull is the update. In an open session, run `/reload-plugins`.
   For a plugin that you installed from a marketplace with its own copy, run `claude plugin update forge@forge`.
2. Copilot CLI: if you installed from a Git clone (`~/.copilot/installed-plugins/_direct/forge`), pull the latest `main` in that folder, or uninstall and reinstall the plugin.
3. When the update changed `plugins/forge/templates/config/`, say "refresh the forge config".

Before you uninstall `forge` from Claude Code, delete the `statusLine` key in `~/.claude/settings.json` (or in `$CLAUDE_CONFIG_DIR/settings.json`) when the Forge setup added it. Claude Code deletes the plugin data folder at an uninstall, and the status line command then fails after each message. `forge.mjs doctor` has a `statusline` line that names the key.

A status line that you installed from a `--plugin-dir` session names another data folder, and the installed plugin does not refresh it. Install the status line from a normal session.

"check forge" reports when the installed plugin is behind its remote.

### ⬆️ Upgrade to 0.1.0

Forge 0.1.0 removes every web part: the board page and the wiki page, the live server, the session list and **Resume**, the UI kit and the pixel look, the styleguide, and the Mermaid build. "Show the board" gives a text table in the chat. The wiki folder, the tickets, the gates, and the guard do not change. You can delete these files: `<forge>/raw/board.html`, `<forge>/raw/wiki.html`, `<forge>/raw/styleguide.html`, `<forge>/raw/sessions.jsonl`, `<forge>/raw/mermaid.tiny.js`, the launcher files `<forge>/forge`, `<forge>/forge.cmd`, and `<forge>/.plugin`, and the live state file in the forge data folder. Forge does not read them. The commands `forge.mjs open` and `forge.mjs live` are gone: stop a server that still runs.

### ⬆️ Upgrade to 14.1.0

Forge 14.1.0 removes the hash trust and `forge.mjs run`. There is nothing to approve: delete the old `trust` folder in the user data folder if you want, it is not read. Two changes can need your action:

- A `policy.gateGuard` of `ask` or `off` in a wiki acts as `deny` now, and `doctor` warns, because the agent can edit the wiki. To loosen the guard, set `FORGE_GATE_GUARD=ask` or `FORGE_GATE_GUARD=off` in your environment.
- A rule page of the wiki (`rules/*.md`) goes into each session with no approval. When a page changes between two sessions, the agent tells you (the commit and its author, or "not committed"). Review a rule change in the `git log` of the wiki.

### ⬆️ Upgrade to 14.0.0

Forge 14.0.0 removes the profiles, the tracker and CI config, the credentials, and every call to an external tool. To upgrade a wiki:

1. Run `forge.mjs doctor`. It names each file that Forge does not use any more: `tracker.md`, `ci.md`, `rules/toolkit.md`, and a `profile` key in `forge/repo.json`.
2. Remove the files that it names, and the `profile` key.
3. Strip `repo.md` to its 3 keys (`changeName`, `branchPattern`, `baseBranch`) and the **Checkouts** table.
4. If `doctor` says that `policy.md` names a removed part, edit its sections, or run `forge.mjs seed --force` for `policy.md` (it replaces your edits).
5. Optional: add the native Claude Code deny rule `Bash(gh pr merge:*)` to your user settings.

The wiki holds only the config copy and your personal values. To share the wiki, commit and push it. See [wiki.md](docs/wiki.md).

## 📦 Where things live

| Path | Content |
|---|---|
| `<repo>/../<repo>.forge/` | The Forge folder (`<forge>`) of a code repository: the wiki and the tickets |
| `<forge>/wiki/` | The wiki (`<wiki>`): one Git repository for each code repository |
| `<forge>/raw/`, `<forge>/archive/` | Local folders: the open tickets, and the closed ticket folders. They are not in the wiki repository |
| `<wiki>/rules/` | Rules for each session: data rules. A change shows as a notice at the next session start |
| `<wiki>/forge/config/` | Config: `repo.md`, `policy.md` |
| `<forge>/raw/tickets/<key>/` | Ticket folders |

Use a private wiki: a wiki can hold internal names and company rules.
Setup offers the native wiki of the private repository, a separate private `<repo>-wiki` repository, or a local-only wiki.

## 🧩 Plugin layout

| Path | Content |
|---|---|
| `plugins/forge/plugin.json` | Plugin manifest ([Agent Plugins 1.0](https://agent-plugins.org)) for both hosts. Claude Code takes the name from the folder and the version from its marketplace. |
| `.github/plugin/marketplace.json`, `.claude-plugin/marketplace.json` | The marketplaces for Copilot CLI and for Claude Code. `tests/packaging.test.mjs` keeps the name, the version, and the source the same in each manifest, and runs each hook command. |
| `plugins/forge/context/` | The session rules, in a short form: `forge` (paths, ticket sessions, host verbs, the Never rules, memory) and `style` (response style, "No AI tells", response shape). The `sessionStart` hook gives them to each session. `tests/context-budget.test.mjs` keeps the sizes. |
| `plugins/forge/hosts/` | One verb table for each host: `copilot-cli.md` and `claude.md`. The hook adds the verb table of the current host to the context. The other part of the file (the feature documentation) stays in the file, and the agent reads them at the step. |
| `plugins/forge/com.github.copilot/hooks/` | `hooks.json`: the `sessionStart` hook. It gives each session the paths, the ticket context, the `forge` and `style` rules, and the approved company rules of `<wiki>/rules/`. The `preToolUse` hook is the guard (`forge.mjs hook pre-tool`, see Review gates). The `sessionEnd` hook writes the rule pages that the session saw. |
| `plugins/forge/hooks/` | `hooks.json`: the same context for Claude Code (spike). `SessionStart` gives it in parts of at most 9,000 characters (2 parts for a session without company rules), `UserPromptSubmit` sets the ticket title, and `PreToolUse` is the gate guard. See `Claude Code host` in [baseline.md](docs/baseline.md). `forge.mjs hook session-end` at `SessionEnd` writes the rule pages that the session saw. |
| `plugins/forge/skills/` | `ticket`, `agents`, `board`, `wiki`, `forge-setup`, `writing` |
| `plugins/forge/templates/` | The config templates (`config/`) and the rule pages (`rules/`) |
| `plugins/forge/scripts/` | `forge.mjs` (init, config, lint, board, local-key, worktree, gate-open, gate-approve, hook, context, doctor, detect, bind, seed, statusline) |
| `docs/` | [config.md](docs/config.md) (config format), [wiki.md](docs/wiki.md) (sharing and scripts), [evaluation.md](docs/evaluation.md) (behavioral runs: `npm run eval` gives the cases of `tests/evals/` to a real agent session), and [baseline.md](docs/baseline.md) (the host features that forge uses) |
| `AGENTS.md` | [Rules for agents that develop forge](AGENTS.md): docs-first checks, tests, and file format |

## 🧩 Skills

| Skill | Use |
|---|---|
| `ticket` | One folder per work item in `<forge>/raw/tickets/<key>`, full research and investigation, review gates, code map, evidence, paste texts. `SKILL.md` is short, and the steps of each phase are in `phases/`. |
| `agents` | Implementer sessions in worktrees, reviewer subagents, the cold read of gate documents, hand-off, session status |
| `board` | "Show the board" in any session: ticket status and session titles |
| `wiki` | Query, record, and lint the repository wiki |
| `forge-setup` | "set up forge", "check forge", "repair forge", "finish forge setup", "refresh the forge config" |
| `writing` | One source for the writing rules: modes, precedence, and the AI writing pattern catalog. Say "humanize this" or "check the writing". |

## ✍️ Writing rules

forge combines three rule sets:

- ASD-STE100 Simplified Technical English for all text.
- An ADHD response shape for chat ([i-have-adhd](https://github.com/ayghri/i-have-adhd), MIT).
- 26 AI writing patterns ([humanizer](https://github.com/blader/humanizer) 3.1.0, MIT), for example "not X but Y", one-line closers, and em dashes.

The [`writing` skill](plugins/forge/skills/writing/SKILL.md) decides which rules apply to each kind of text:

| Text | AI pattern check | Formatting |
|---|---|---|
| Chat replies | Short list in the `style` rule | Emoji headings |
| Ticket documents, config | Strong tells | Plain ticket style: emoji only for a state, no bold labels |
| Wiki pages and lessons | Full pass | Plain: no emoji, no bold labels |
| Paste texts, change request text, tracker comments | Full pass | Target format, plain |

No mode allows em dashes or en dashes in prose. License texts are in [NOTICE.md](plugins/forge/skills/writing/NOTICE.md).

## 🎫 Ticket work

1. Open a new session. Give a key and the link of the work item, with the pasted text, for example "start APP-42 https://example.com/APP-42" and the text of the item. Or say "resume APP-42".
   The session gets its title first (see Session titles below).
   The key is what you type. When you give none, say "new local ticket": `forge.mjs local-key` gives the key `L-<n>`.
   The link goes to `item:` in the ticket README. Forge never opens it.
2. Forge names the worktree and the branch. `forge.mjs worktree APP-42 --summary "<goal>"` gives the branch
   from `repo.branchPattern` and the folder `<repo>.worktrees/<key>-<slug>`:
   - Session on the main checkout: after one "yes", the agent creates the worktree and moves the session there (`EnterWorktree` in Claude Code, `/cwd` in Copilot CLI).
   - When a worktree of the ticket exists, the agent continues there.
3. Every new ticket uses `workflow: full-v4`, with no sizing question:
   research → scope interview → scope check in chat →
   investigation (🛑 diagnosis stop) → plan → **Planned?** → implement → Evidence Testing → **Shippable?**.
   When `policy.evidenceOnDeployedEnv` is `true`, Evidence Testing runs after the push.
   A small fix has the same phases and gates. Its documents are shorter.
4. Read the gate document, and add your comments in the chat. One explicit user approval covers the
   displayed file and revision set, recorded in a SHA-256 manifest. `forge.mjs gate-open <key> <gate>` builds that set, writes the manifest and the snapshot, sets the gate to `in-review`, and prints the form text. `forge.mjs gate-approve <key> <gate> --answer "<your exact answer>" --method form|chat`
   accepts only `approve` in the form or the whole text `approve <gate>` in chat, and refuses a changed document or manifest. It checks the manifest and the documents, then records the approval in the README and in `approvals/history.md`. When a write fails, it restores both files.
   Unavailable sources and test gaps are recorded, not treated as safety evidence.
5. At Implement, the `agents` skill reuses a suitable current worktree. It starts another session only when needed.
6. After the **Shippable?** GO, the agent pushes the branch. You open the pull request in your host and paste its URL into the chat. The agent records it in `changes` of the README. QA handover runs only when configured.
   Say "close APP-42"; **Learned?** approves distillation into wiki pages and archive.

```mermaid
flowchart LR
  R[Research, interview] --> S[Scope check in chat] --> I[Investigation] --> P{{Planned?}}
  P --> C[Implement] --> E[Evidence Testing] --> SH{{Shippable?}} --> L{{Learned?}}
  I -. the scope is wrong .-> S
```

| Gate | You approve | It holds |
|---|---|---|
| **Planned?** | `story.md` and `plan.md` | The problem, the scope, the acceptance checks, your interview answers, the history, and the open questions; the diagnosis, the steps with their files, the tests, the deployed checks, the risks, and the decisions |
| **Shippable?** | `review.md` | What changed, the tests that ran, and the findings of the adversarial review |
| **Learned?** | `close.md` | What you now know, and the wiki changes |

A manifest can also list `evidence/` files that you must see in an exact revision.
Before a gate opens, a subagent without the session history reads the gate document (the cold read).
It gives a paraphrase and the terms that it cannot resolve, and the session corrects the document before you see it.

The gate guard is a `preToolUse` hook. Before a `git push` in a ticket worktree, it checks the approvals of Planned? and Shippable?. For a ticket with a branch, it also checks that the code of the push is the code of the Shippable? approval (the patch-id in the manifest). It always asks you before `forge.mjs gate-approve`, also with the guard off.
When one is missing or stale, it stops the command and names each finding. The mode is `deny`, and only the environment variable `FORGE_GATE_GUARD` (`deny`, `ask`, or `off`) changes it. A wiki value of `policy.gateGuard` does not loosen it.
The guard reads the words of a shell command, so it is a net and not a wall: the written rules stay in force.
When the README of the ticket cannot be read, the guard stops a push.

Plan checks: `forge.mjs lint` checks the paths of a plan (`plan-path`), its Baseline and Control lines (`plan-baseline`), and the plan review (`plan-review`). `gate-open` runs them before Planned?.
`policy.planReview` (`off`, `attacker`, or `panel`) sets the review of the plan by subagents before Planned?. `policy.styleRules` adds the response style rules to each session. A missing key means `true`.

### 🕰️ Older tickets

Forge 12 reads only `workflow: full-v4`. It has no convert code. `forge.mjs lint` reports a ticket with another layout as a read error.
The session-start hook shows the error, and the gate guard denies a push for that ticket.
Finish a `full-v3` ticket with Forge 10.1 before you update. Finish or archive an older ticket with Forge 7.6.
Resume reports missing or stale approval evidence and blocks only the affected action, not unrelated read-only work.
See the [ticket workflow contract](plugins/forge/skills/ticket/SKILL.md#-workflow).

Before edits, builds, or fixtures, Forge checks the actual worktree and resolves its baseline.
An explicit required commit takes priority over the ticket branch and the configured base branch.
Exact-commit proofs require HEAD equality. Resumed implementation can retain verified task changes above its baseline.
Forge never resets a branch or changes approved documents to repair a mismatch.
See the [worktree selection checks](plugins/forge/skills/agents/SKILL.md#select-the-execution-worktree).

The agent never merges. It calls no tracker, no change request host, and no CI. It gives you paste texts, and you send them. A native Claude Code deny rule `Bash(gh pr merge:*)` in your user settings adds a hard stop for a merge.

### 📄 Ticket documents

A ticket has about 7 Markdown files, and each fact has one home. A file starts to exist when its phase starts.

| File | Content |
|---|---|
| `README.md` | The state: frontmatter and the Now card |
| `story.md` | Planned?: problem, scope, acceptance checks, answers, history, open questions |
| `plan.md` | Planned? (with `story.md`): diagnosis, steps, tests, checks, risks, decisions |
| `review.md` | Shippable?: changes, tests run, review findings |
| `proof.md` | Evidence Testing: one check for each changed behavior, with its result (in the Shippable? set by default) |
| `journal.md` | The dated log: work, decisions, problems, and finished steps |
| `map.md` | The code map: components with their layer, flow, data, tests, terms |
| `close.md` | Learned?: what you now know, and the wiki changes |

- A ticket document is plain: no emoji in a heading, no bold labels, and no section without content.
  An emoji shows only a state: 🟡 🔴 🟢 for the ticket and a risk, and 🟢 🔴 ⚪ for a check result.
- A gate document starts with a summary of at most 150 words: the key fact, the change, what the agent needs from you,
  and at most 3 decisions with a recommended answer. The whole document has at most 1,500 words. Longer material goes to `evidence/`.
- The approval form shows only the summary. At a later review, it shows only the changes since your last review
  (`forge.mjs gate-open` prints them and saves the version that you saw; `--dry-run` writes nothing).
- `forge.mjs lint` warns when a summary is missing or too long, a document is over its budget, or a section is empty.
- `proof.md` is not in `review.md`. By default, Evidence Testing finishes before Shippable? opens, `gate-open` needs `proof.md` with no `open` and no `failed` check, and a changed `proof.md` makes Shippable? stale. With `policy.evidenceOnDeployedEnv: true`, Evidence Testing runs after the push, and `proof.md` stays outside the manifests.

### 📍 Where a ticket is

- The Now card at the top of each ticket README shows the state, the phase, the open gate, the next step,
  who the ticket waits on, what is done, and the date. `forge.mjs lint` warns when the card
  does not agree with the frontmatter.

### 🏷️ Session titles

Each ticket session has the title `<KEY> - <state> - <goal>`, for example `APP-4211 - 🟡 - Review invoice export fix`.
The title has less than 60 characters. Keys of one project have the same width, so the goals line up in the sessions list.

| State | Meaning |
|---|---|
| 🟡 | A gate or a question waits for you |
| 🔴 | A failure stops the work |
| 🟢 | The last gate is approved, and no gate is open |
| ▶️ | The agent works |
| ⏳ | The work waits for an outside event, for example a review or a build |
| ✅ | The ticket is closed |

The plugin has a `sessionStart` [hook](plugins/forge/com.github.copilot/hooks/hooks.json).
When a session starts, `forge.mjs hook session-start` finds the ticket from the session folder, the branch,
or the key in the first prompt. It gives the agent the title, the Now card, and the worktree step.
The context ends with the line `End of Forge context.`. When that line is missing, each skill runs
`forge.mjs context`, which prints the same context. In Claude Code, the hooks set the title with `sessionTitle`.
In Copilot CLI, the agent gives you the `/rename` command.

### 👥 People on a ticket

The ticket README keeps a `people:` list of everyone you work with on the ticket.
Each entry has a name or handle, a role, the ask, and one status:
`to-contact` → `drafted` → `waiting` → `reply-in` → `done`, plus `follow-up`.
The agent updates the list when you add a colleague question, draft a message, send it, or get a reply.
After more than 3 working days in `waiting`, it suggests a follow-up but changes the status only when you agree.
The board (`raw/board.md` and `board --json`) lists these long waits.
The list is outside approval manifests, so a status change never reopens a gate.
See [People](plugins/forge/skills/ticket/SKILL.md#-people).

## 📋 Ticket overview

Say "show the board" or "my tickets". The agent reads the README frontmatter of each ticket
and groups the tickets by state: 🟡 Needs me, 🔴 Blocked, 🟢 Go, ▶️ Active, ⏳ Waiting, ✅ Done.
`forge.mjs board` writes the same view to `<forge>/raw/board.md`.
`forge.mjs board --all` shows the boards of this repository and of the other Forge folders next to it (`../*.forge` with a bound wiki), with the 🟡 tickets of all repositories first. It writes no file. Each ticket has a `resumeFolder` in the JSON: the folder where its session starts.
Each row shows the session title, the open gate, the next step, who the ticket waits on, and the days since the update.

`forge.mjs board --json` gives the same data to agents. The board is a text table in the chat: Forge has no board page. Ticket README files remain the source of truth.

The reader supports the [ticket template](plugins/forge/skills/ticket/templates/README.md):
scalar fields, comments, quoted strings, folded text (`>`), literal text (`|`), and flat object lists
for `gates`, `changes`, and `people`. Text blocks support strip (`-`) and keep (`+`) chomping.
Lists can use inline arrays, inline objects, or indented fields.
YAML anchors, tags, and explicit block indentation indicators are not supported;
lint reports them as read errors. Existing tickets need no rewrite for supported YAML forms.
A ticket without `workflow: full-v4`, or with a `track` value, produces a read error.
CLI validation and the board use the shared parser in
[`scripts/lib/ticket.mjs`](plugins/forge/scripts/lib/ticket.mjs).

## 🧭 Board

Say "show the board" in any session: a session in the main checkout, a ticket session, in Claude Code or in Copilot CLI.
The `board` skill answers questions about your tickets and the other sessions, so you do not have to open each session.
A question that names a key does not start or resume that ticket.

| Say | Result |
|---|---|
| "Show the board" | A text table in the chat: the count for each state, then one row for each ticket, with the tickets that need you first |
| "Show all boards" or "What needs me" | The 🟡 tickets of all repositories, then one table for each repository, with the command to resume each ticket |
| "What did we do on APP-42?" | The Now card, the latest journal entries, and the session link |
| "What must I approve on APP-42?" | The summary of the open gate document |
| "Fix the session titles" | Renames stale ticket session titles |

The board does not edit code, ticket documents, or wiki pages. It writes only `raw/board.md`.
It never approves a gate and never answers a question of a session for you,
because an approval covers the exact revision that the ticket session shows.
It never merges, pushes, or calls an external tool.
To start a ticket, send its key and link in a new session. To tell a ticket session something, type it in that session.
See the [board skill](plugins/forge/skills/board/SKILL.md).

The board is a skill, not a custom agent: a skill is portable and runs in any session.

## 🔎 Local validation

```sh
node "<plugin>/scripts/forge.mjs" lint [--wiki "<path>"] [--json] [--fix]
```

Default lint is read-only. It checks ticket metadata, workflow/gate agreement,
approval revisions, and canonical wiki metadata without inferring workflow, state,
or approval. Findings name the file, line when available, code, severity, and remedy.
Invalid input fails without hiding valid files.
Errors exit 1; warnings alone exit 0.
Index membership, semantic contradictions, HTTP retrieval, and claim truth remain
manual checks; lint does not prove them.

Explicit `--fix` only adds a missing final newline in an **unapproved** `*.draft.md`
whose metadata explicitly says `status: draft`,
preserving all other bytes and line-ending style. Direct and combined approval
references protect drafts from repair. Each repair is reported and appended to the
ticket's `repair-log.jsonl` with `started`/`applied` rows and before/after hashes;
a second pass changes nothing. It never repairs stale
approvals, changes a workflow, deletes pages, or publishes content.
See [validation and source limits](docs/wiki.md#local-validation-and-source-limits).

## 📚 Shared wiki

Edit config directly in `<wiki>/forge`. Git handles versioning and shared updates.
The `git log` of the wiki is the review record. A change of a rule page shows as a notice at the next session start. The notice is advice, not a control. See [wiki.md](docs/wiki.md).

## 🛠️ Develop

- Read [AGENTS.md](AGENTS.md) first. Before you change how forge uses a host feature, read the changelogs
  of Claude Code and Copilot CLI since the [baseline](docs/baseline.md), and the feature page. Use a native feature when one exists.
- `npm test` runs the tests.
- [Behavioral evaluation](docs/evaluation.md) describes manual runs through the
  supported harness, trace evidence, and execution approval. Deterministic fixtures
  and document checks do not establish model compliance; do not claim a behavioral
  pass without the required harness run evidence.
- To test a local checkout, run `claude --plugin-dir plugins/forge` or `copilot --plugin-dir plugins/forge`.
  First disable an installed forge plugin, so that the session loads only the local copy.

## 📄 License

[MIT](LICENSE)
