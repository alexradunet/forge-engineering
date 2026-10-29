---
name: forge-setup
description: Set up, check, repair, resume, or change forge for the current repository. Detects the host, the CLIs and their login, the CI files, the default branch, and the work item keys; creates or binds the repository wiki (../<repo>.wiki); seeds and fills the team config (tracker, repository host, CI, policy) for GitHub, GitLab, Jira, local Markdown, or another tool; stores credentials in the OS credential store; checks each capability with a live read; and offers the optional extras (policy hooks, learning mode, daily recap, ticket dashboard). Use when the user says "set up forge", "configure forge", "check forge", "repair forge", "finish forge setup", "resume forge setup", "switch the tracker to GitLab", or "change the CI to Jenkins".
disable-model-invocation: true
---

# 🔧 forge setup

One chat sets up forge for the current repository. The plugin holds no machine
paths and no team config. Both live in the repository wiki (`../<repo>.wiki`).

At the end of setup, each item below is true:

- The wiki exists, is bound to the repository, and holds the four config files.
- No config value is a template placeholder. `doctor` shows no `config:placeholder` line.
- Each CLI that the config names is installed and logged in. Each needed credential is stored.
- The user approved each config file by hash (`trust`).
- One live read of each read capability works.

## 📁 Commands

`<plugin>` is the folder two levels above this `SKILL.md`. Use the absolute,
resolved path in each command. All commands run on Windows, macOS, and Linux.
`<F>` below means `node "<plugin>/scripts/forge.mjs"`.

| Command | Use | Writes |
|---|---|---|
| `<F> where --json` | Repository, worktree, wiki, and config folder | nothing |
| `<F> detect [--tracker <t>] [--repo <r>] [--ci <c>]` | Host, visibility, CLIs and login, CI files, default branch, key hints, wiki state, and suggested values for a choice | nothing |
| `<F> doctor` | Read-only check of the whole setup, with placeholders and credentials | nothing |
| `<F> init-wiki` | Create the local wiki (`git init`, `.gitignore`, `index.md`) and bind it | the wiki folder |
| `<F> bind` | Write `<wiki>/forge/repo.json` | the wiki folder |
| `<F> seed --tracker <t> --repo <r> --ci <c> [--force]` | Copy templates to `<wiki>/forge/config` | the wiki folder |
| `<F> config set <file>.<key>=<value> ...` | Set frontmatter values. Validates first; writes nothing on a problem | the wiki folder |
| `<F> config row <checkouts\|queries> <name> [cells...] [--delete]` | Add, replace, or delete a row of the **Checkouts** or **Queries** table | the wiki folder |
| `<F> config --json` | Read the approved config | nothing |
| `<F> trust [approve <path>=<hash> ...]` | Show or approve the files under `<wiki>/forge` | the user data folder |
| `node "<plugin>/scripts/cred.mjs" set\|has\|delete <name>` | OS credential store (the user types the secret) | the credential store |

- Add `--wiki <dir>` to a command to use another wiki for one call.
- Put each `config set` assignment and each table cell in double quotes. This keeps `{KEY}`, spaces, and `@` safe in every shell.
- `config set` adds quotes to a value that starts with `{`. A cell cannot hold `|`.
- Every `config set` and `config row` changes a file hash. Run **Trust** after the last edit.

## 🧭 Pick the flow

Run `detect` and `doctor` first. Then pick one flow and tell the user which one.

| Signal | Flow |
|---|---|
| The user says "check forge" or "repair forge" | ✅ Check or repair |
| The user names one tool to change ("switch the tracker to GitLab") | 🔁 Switch one tool |
| `wiki.exists` is false and `wiki.config` is empty | 🚀 First-time setup |
| The wiki exists, but `doctor` shows a `fail` or `warn` | ⏯️ Resume |
| `doctor` is clean | ✅ Check, then offer the 🧩 Optional extras |

State the progress at each step, for example "step 4 of 11 done".

## ✅ Check or repair

1. Run `doctor`. Report each `fail` and `warn` line with its fix.
2. Read the latest VS Code release notes (see "VS Code Agents window" in the `forge` rule). Report each change that affects plugins, sessions, worktrees, automations, canvases, or MCP servers.
3. Check the plugin version. When `<plugin>/../..` is a Git clone, run `git -C <plugin>/../.. fetch -q`, then
   `git -C <plugin>/../.. log --oneline "HEAD..@{u}"` (keep the quotes; PowerShell needs them). When it lists commits, tell the user to update (README, "Update forge").
   An uninstall and a new install from source can reuse the old clone, so a reinstall is not an update.
4. When a line needs a fix, continue with ⏯️ Resume.
5. Never print, read, or ask for a credential value.

## 🚀 First-time setup

### Step 1. Detect

Run `detect`. Do not ask for anything that `detect` already shows. Tell the user, in one short list:

- the host (`repo.host`) and the visibility,
- the CI files that it found (`repo.ciFiles`) and the default branch (`repo.defaultBranch`),
- the key prefix hints (`repo.keyHints`), for example "MFD in 37 branches and commits",
- each CLI that is missing or not logged in.

When `repo.keyHints` shows a strong prefix and the host is GitHub or GitLab, the team possibly uses Jira.
Ask about it in step 2. Do not change the suggestion yourself.

### Step 2. Choose the tools

Ask in one form. Use `suggestion.tracker`, `suggestion.repo`, `suggestion.ci`, and `suggestion.wikiRemote` as defaults.

- tracker: `github`, `gitlab`, `jira`, `local` (Markdown files in the wiki), or `other`
- repository host: `github`, `gitlab`, or `other`
- CI: `github-actions`, `gitlab-ci`, `jenkins`, `azure-pipelines`, or `other`
- wiki remote (see **📚 Wiki remote**)

When the choice is not the suggestion, run `detect --tracker <t> --repo <r> --ci <c>` again.
`suggestion.values` then holds the values for that choice.

### Step 3. Tools

For each CLI that the choice needs and that is not installed or not logged in,
show the `install` command and the login command. The user runs them in a terminal.
Then run `detect` again.

| Choice | CLI | Login |
|---|---|---|
| `github`, `github-actions` | `gh` | `gh auth login --hostname <host>` |
| `gitlab`, `gitlab-ci` | `glab` | `glab auth login --hostname <host>` |
| `jira` | `acli` | `acli jira auth login --web` |
| `azure-pipelines` | `az` | `az login`, then `az extension add --name azure-devops` |
| `jenkins` | none (`jenkins.mjs`) | step 9 stores the API token |
| `local`, `other` | none | — |

A missing CLI never blocks setup. Continue, and tell the user that those capabilities stay `manual` until the CLI works.

### Step 4. Wiki

When `wiki.exists` is false, show the path and the remote, and ask for approval.
Clone an existing wiki to that path when the team already shares one. Otherwise, run `init-wiki`.
Run `bind` after a clone, or when an existing wiki is not bound.
Add the remote with `git -C <wiki> remote add origin <url>` only after approval.
A cloned wiki usually has its config already. Then skip to step 8 and review its files.

### Step 5. Seed the config

Show the four files that `seed` writes, and run it after approval.
`seed` keeps existing files. Use `--force` only after the user agrees to replace a file.
`seed` never replaces `policy.md`.

### Step 6. Values

Ask for the values in a second form. Prefill each field from `suggestion.values`.
A `null` value has no good guess: ask for it, and show the example.
Keep values from an existing wiki config unless the user asks to change them.

| Key | Prefill | Example | Why forge needs it |
|---|---|---|---|
| `tracker.prefix` | `values.tracker.prefix` | `APP`, `MFD` | Ticket keys (`APP-42`) and ticket folders (`app-42`). Upper case. |
| `tracker.host` | `values.tracker.host` | `acme.atlassian.net`, `github.com` | The tracker site. |
| `tracker.project` | `values.tracker.project` | `MFD`, `owner/app`, `group/app` | The project for each tracker command. |
| `tracker.itemUrl` | `values.tracker.itemUrl` | `https://acme.atlassian.net/browse/{KEY}` | Links in tickets. Holds `{KEY}` or `{number}`. |
| `repo.host` | `values.repo.host` | `github.com`, `gitlab.acme.dev` | The `--hostname` of the CLI. |
| `repo.changeName` | `values.repo.changeName` | `PR`, `MR` | The word for a change request. |
| `repo.baseBranch` | `values.repo.baseBranch` | `main`, `master`, `develop` | The default target of a change request. |
| `repo.branchPattern` | `values.repo.branchPattern` | `{KEY}-{slug}`, `feature/{KEY}-{slug}` | The branch names of implementer sessions. Holds `{KEY}` or `{key}`. |
| `ci.host` | `values.ci.host` | `https://jenkins.acme.dev`, `https://dev.azure.com/acme` | Jenkins or Azure DevOps server. |
| `ci.project` | `values.ci.project` | `Web Shop` | Azure DevOps project. |

- For Jira, compose `itemUrl` as `https://<tracker.host>/browse/{KEY}`.
- For `local`, only `prefix` matters. The default is `ITEM`.
- For `other`, ask for `prefix` and `itemUrl`. Leave a value empty when the team has none.

Write the answers with one call, for example:
`<F> config set "tracker.prefix=MFD" "tracker.host=acme.atlassian.net" "tracker.project=MFD" "tracker.itemUrl=https://acme.atlassian.net/browse/{KEY}" "repo.baseBranch=master"`.
When the command reports a problem, show it, ask for a corrected value, and run it again.

### Step 7. Tables

**Checkouts** (`repo.checkouts`): the local clones that forge works in. The first row is the main checkout.

1. Add the row from `suggestion.values.checkouts`: `<F> config row checkouts "<name>" "<path>" "<remote>"`.
2. Delete the template row: `<F> config row checkouts app --delete`. Skip this when the new row is also named `app`; step 1 replaced it.
3. Ask whether the work also uses other clones, for example a shared library. Add one row for each.
4. Leave `baseBranch` empty when it is the same as `repo.baseBranch`.

**Queries** (`tracker.queries`): named searches. The `ticket` and `daily-recap` skills use `mine` and `team`.
Ask how the user finds "my open items" and "my team's open items". Write them in the syntax of the tracker:

| Tracker | `mine` | `team` |
|---|---|---|
| `jira` | `assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC` | `project = MFD AND component = "Payments" AND statusCategory != Done ORDER BY updated DESC` |
| `github` | `assignee:@me is:open` | `is:open label:"team-payments"` |
| `gitlab` | `--assignee=@me` | `--label "team::payments"` |
| `local` | `^status: (?!closed)` | `^status: open$` |

Run `<F> config row queries "team" "<query>"` for each query. A query cannot hold `|`.

For `other`, ask how the team does each capability. Write a CLI command in the row, or keep `manual`.
Edit those rows directly in the file, and show the change.

### Step 8. Check the values

Run `doctor`. Fix each `config:placeholder` and `config:checkouts` line with steps 6 and 7.
Do not continue to **Trust** while a placeholder remains, unless the user says to keep it.

### Step 9. Credentials

Prefer the login of the CLI. For each `warn cred:<name>` line of `doctor`, the user runs
`node "<plugin>/scripts/cred.mjs" set <name>` in a terminal. The prompt hides the input.
Jenkins needs `user:apiToken` in the credential `jenkins`. Then run `doctor` again.

### Step 10. Trust

Run `git -C <wiki> status --short` and `git -C <wiki> diff -- forge`. Show what changed.
Run `trust`. Show each `new` or `changed` file with the first 12 characters of its hash.
After the user says yes, run `trust approve <path>=<hash> ...` for exactly those files.

### Step 11. Live read

Read `<config>/<kind>.md` and run its **Auth check**. Then run each read capability once against a real item:
`tracker.fetch` (ask for one real key), `tracker.search` with `mine`, `repo.history`, and `ci.status`.
Report `ok` or the error with its fix from **Failures**. Never run a write capability during setup.

### Step 12. Finish

1. Run `doctor`. It must show no `fail` line.
2. Offer the 🧩 Optional extras.
3. Review the tracked files and Git history before a public push.
4. Tell the user to commit the wiki: `git -C <wiki> add forge index.md .gitignore`, then `git -C <wiki> commit`.
5. Push only when the user asks and approves the exact command.
6. Tell the user the next action: "Say `start <KEY>` to begin a ticket."

## 🔁 Switch one tool

Use this flow when the user changes the tracker, the repository host, or the CI. Keep the other files.

1. Run `config --json` and save the current values of the file that changes. When trust fails, read the file directly.
2. Show what carries over and what does not:
   - The **Queries** table uses the syntax of the old tracker. Write new queries.
   - The **Checkouts** table carries over. Re-add the rows after the switch.
   - A changed `tracker.prefix` changes new ticket keys. Existing ticket folders keep their old keys.
   - A team row that you edited by hand in the old file is lost. Copy it first when it still applies.
3. Recommend a wiki commit first, so that `git diff` shows the switch.
4. Run `seed --<kind> <new> --force` for that kind only, after approval.
5. Run `detect --<kind> <new>`. Re-apply the carried values with `config set` and `config row`. Ask for the new values (steps 6 and 7).
6. Run steps 3 (tools), 8 (check), 9 (credentials), 10 (trust), and 11 (live read) for the new tool.

## ⏯️ Resume

A setup can stop at any step. Find the first open step from `detect` and `doctor`, and continue there.
Do not repeat a step that is already done. Do not ask again for values that the config already holds.

| `doctor` or `detect` shows | Continue at |
|---|---|
| `fail wiki` | Step 4 (wiki) |
| `warn wiki:binding` | Step 4: run `bind` |
| `warn config:<kind>.md Missing` | Step 5 (seed) for that kind |
| `warn config:<kind>.md <cli> is not on PATH` | Step 3 (tools) |
| `warn config:placeholder` or `warn config:checkouts` | Steps 6 and 7 (values and tables) |
| `warn cred:<name>` | Step 9 (credentials) |
| `fail trust` | Step 10 (trust) |
| `fail config` | Show the error. Fix the value with `config set`. |
| no `fail`, no `warn` | Step 11 (live read), then step 12 |

## 🧩 Optional extras

Offer the extras in one form after setup, or when the user asks. Each one is optional. Skip each one that is already done.

### Policy values and hooks

1. Ask for the policy values. Show the current value as the default.
   - `noMergeWeekdays`: days with no merge, for example `[Thursday]`.
   - `evidenceOnDeployedEnv`: `true` when Evidence Testing must use a deployed environment.
   - `qaHandover`: `true` when a QA team tests after the merge.
   - `maxImplementers`: the maximum number of implementer sessions. The default is 6.
   - `adversarialReviewModel`: the reviewer model. Empty means a model family different from the author.
2. Write them with `config set`, for example `"policy.noMergeWeekdays=[Thursday]"`.
3. For each hook section of `policy.md` that still holds only its `Hint:` text, ask one short question:

| Section | Question |
|---|---|
| `Toolkit` | Which tools do you use to build, run, deploy, and read logs? |
| `Data rules` | Which data must not leave a ticket folder? Which tools need approval? |
| `Start` | What must the agent read when a ticket starts? |
| `Investigate` | Which read-only tools can the agent use without approval? |
| `Resume` | What can expire between sessions, for example a token or a test tenant? |
| `Implement` | Which limits apply to worktrees and implementer sessions? |
| `Evidence Testing` | How do you deploy a test environment, and how do you observe it? |
| `QA handover` | Where does the QA comment go? Which status does QA use? |
| `Close` | Which wiki folders and knowledge owners get the distilled pages? |

4. Write each answer under its heading, and delete the `Hint:` line. Keep the hint of a skipped section.
   A hook can add steps and make rules stricter. It can never weaken a core rule.
5. Never put a secret, a personal path, or private data into a hook of a public wiki.

### Learning mode

Ask whether forge offers optional lessons from artifact questions. The default is `false`.
Write the answer with `<F> config set "policy.learningMode=true"` (or `false`). The `learning-mode` skill describes the use.

### Daily recap

Ask whether the user wants a daily recap. When yes, use the `daily-recap` skill to write
`<wiki>/raw/daily-recap/settings.json` (time zone, work days, daily meeting, and the `mine` query).
Then offer a scheduled VS Code Automation "Prepare my daily":

1. Read the [Automations](https://code.visualstudio.com/docs/agents/run/automations) page first. Its UI and settings change.
2. Tell the user to select **Automations** in the Agents window sidebar, then create a **Local** automation.
3. Give the prompt "Prepare my daily", the repository as the workspace, and the schedule from `settings.json`.
4. Tell the user to review the permissions, and to enable the automation only after the review.
5. When **Automations** is not visible, the user turns on `chat.automations.enabled`.

### Ticket dashboard

1. Read the [Canvases](https://code.visualstudio.com/docs/agents/run/canvases) page first.
2. The dashboard needs `chat.canvases.enabled`, the VS Code desktop app, a local session, and the Copilot harness.
3. Tell the user to turn on the setting in **Preferences: Open Settings (UI)**, then start a new session.
4. Offer to open the `forge-ticket-dashboard` canvas with `{ "wikiPath": "<wiki>" }`.

### VS Code check

1. Read the latest release notes and the [Agent plugins](https://code.visualstudio.com/docs/agent-customization/agent-plugins) page.
2. Confirm that `chat.plugins.enabled` is on, and that **Chat: Open Customizations** > **Plugins** shows one `forge` plugin.
3. Two `forge` plugins load the rules two times. Tell the user to disable one of them.
4. Never change a user setting without approval. Give the UI steps, and let the user change it.

## 📚 Wiki remote

The wiki is `../<repo>.wiki`, next to `../<repo>.worktrees`. It holds the team config,
helper scripts, and knowledge pages. `raw/` and `archive/` stay local (`.gitignore`).

| `suggestion.wikiRemote.type` | Meaning | Action |
|---|---|---|
| `existing` | The wiki already has a remote | Keep it |
| `native` | The repository is private or internal | Use the native wiki `<remote>.wiki.git` |
| `ask` | The repository is public, or visibility is unknown | Ask: public native wiki, separate private repository (`<remote>-wiki`), or local only |

- Offer the public wiki only when its files and Git history contain public data.
- Do not offer the native wiki when `wikiEnabled` is false. Use the options from `detect`.
- Keep internal hosts, personal paths, company rules, and private knowledge out of a public wiki.
  The **Checkouts** table and `forge/repo.json` hold local paths.
- Never change the visibility of a repository.
- A GitHub wiki exists only after its first page. Tell the user to open
  `<remote>/wiki`, create a page, and save it. Then the clone and the push work.
- Create a separate repository only after explicit approval, for example
  `gh repo create <owner>/<repo>-wiki --private`.

## 🔑 Credentials

- Prefer the login of the CLI (`gh auth login`, `glab auth login`, `acli jira auth login`, `az login`).
- When a wiki script needs a secret, the user runs `node "<plugin>/scripts/cred.mjs" set <name>`.
  The prompt hides the input. Never ask for a secret in chat.
- Use `cred.mjs has <name>` or `doctor` to check. There is no command that prints a secret.

## 📏 Rules

- Never put a secret in a config file or in the wiki.
- Ask before each write to the wiki: show the command and the files that change.
- Write CLI commands in the capability rows. Use MCP only when no CLI or REST call can do the
  capability (see the `forge` rule, "Tool choice: CLI first").
- Company rules go into the hook sections of `policy.md`. Helper scripts go into `<wiki>/forge/scripts`.
  Keep both out of the core skills. See `docs/wiki.md` for sharing and trust.
- Never approve trust for the user. Never run a write capability during setup.
