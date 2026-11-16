---
name: forge-setup
description: Set up, check, repair, resume, or refresh forge for the repository of the plugin profile. Detects the CLIs and their login, the MCP servers of the profile, the default branch, your branch pattern, and your main clone; creates or binds the repository wiki (../<repo>.wiki); seeds the profile config (tracker, repository, CI, policy) and the rule pages; sets your personal values; stores the credentials of the profile in the OS credential store; checks each capability with a live read; and offers the optional extras (learning mode, daily recap, automations). Use when the user says "set up forge", "configure forge", "check forge", "repair forge", "finish forge setup", "resume forge setup", or "refresh the forge config".
disable-model-invocation: true
---

# 🔧 forge setup

> When your context has no `End of Forge context.` line, or a `Forge context part <i> of <n>` part is
> missing or has a different id, run `node "<plugin>/scripts/forge.mjs" context` first and follow its output. `<plugin>`
> is two folders above the folder of this file. When the command fails, read
> [forge.md](../../context/forge.md) and [style.md](../../context/style.md): they are the `forge` and `style` rules.

One chat sets up forge for the repository of the plugin profile. The plugin holds the profile config templates,
but no machine paths. The config lives in the repository wiki (`../<repo>.wiki`).

## 🏷️ Profile

Read `<plugin>/templates/profile.md` first. It holds the shared values of the profile, and the values
that each step below names: the expected remote, the default branch, the prefills, the tools, the credentials, the live-read items, the policy notes, and the first ticket text.
Each user sets only two personal values: the branch pattern and the path of the main clone.
When `profile.md` is missing, there is no profile. Then ask the user for each value that a step needs, and use the generic examples.

At the end of setup, each item below is true:

- The wiki exists, is bound to the repository, and holds the four config files and the two rule pages.
- `repo.branchPattern` holds your name, not `<user>`. `doctor` shows no `config:placeholder` line.
- The first **Checkouts** row is your main clone. `doctor` shows no `config:checkouts` line.
- Each item of **End state** in `profile.md` is true: the CLIs, the MCP sign-ins, and the credentials.
- The user approved each config file and rule page by hash (`trust`).
- One live read of each read capability works.

## 📁 Commands

`<plugin>` is the folder two levels above this `SKILL.md`. Use the absolute,
resolved path in each command. All commands run on Windows, macOS, and Linux.
`<F>` below means `node "<plugin>/scripts/forge.mjs"`. `profile.md` names the commands of the profile scripts.

| Command | Use | Writes |
|---|---|---|
| `<F> where --json` | Repository, worktree, wiki, and config folder | nothing |
| `<F> detect` | Host, visibility, CLIs and login, default branch, key hints, your branch pattern, wiki state, and suggested values | nothing |
| `<F> doctor` | Read-only check of the whole setup, with placeholders and credentials | nothing |
| `<F> init-wiki` | Create the local wiki (`git init`, `.gitignore`, `index.md`) and bind it | the wiki folder |
| `<F> bind` | Write `<wiki>/forge/repo.json` | the wiki folder |
| `<F> seed [--force]` | Copy the profile templates to `<wiki>/forge/config`, and the rule pages to `<wiki>/rules` | the wiki folder |
| `<F> config set <file>.<key>=<value> ...` | Set frontmatter values. Validates first; writes nothing on a problem | the wiki folder |
| `<F> config row <checkouts\|queries> <name> [cells...] [--delete]` | Add, replace, or delete a row of the **Checkouts** or **Queries** table | the wiki folder |
| `<F> config --json` | Read the approved config | nothing |
| `<F> trust [approve <path>=<hash> ...]` | Show or approve the files under `<wiki>/forge` and `<wiki>/rules` | the user data folder |
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
| The user says "refresh the forge config", or a forge update changed `templates/config/` | 🔄 Refresh the profile config |
| `wiki.exists` is false and `wiki.config` is empty | 🚀 First-time setup |
| The wiki exists, but `doctor` shows a `fail` or `warn` | ⏯️ Resume |
| `doctor` is clean | ✅ Check, then offer the 🧩 Optional extras |

State the progress at each step, for example "step 4 of 10 done".

## ✅ Check or repair

1. Run `doctor`. Report each `fail` and `warn` line with its fix.
2. Read the latest VS Code release notes (see "VS Code Agents window" in the `forge` rule). Report each change that affects plugins, sessions, worktrees, automations, hooks, custom agents, or MCP servers.
3. Check the plugin version. When `<plugin>/../..` is a Git clone, run `git -C <plugin>/../.. fetch -q`, then
   `git -C <plugin>/../.. log --oneline "HEAD..@{u}"` (keep the quotes; PowerShell needs them). When it lists commits, tell the user to update (README, "Update forge").
   An uninstall and a new install from source can reuse the old clone, so a reinstall is not an update.
4. When a line needs a fix, continue with ⏯️ Resume.
5. Never print, read, or ask for a credential value.

## 🚀 First-time setup

### Step 1. Detect

Run `detect` in the main checkout. Do not ask for anything that `detect` already shows. Tell the user, in one short list:

- the host (`repo.host`), the remote, and the visibility,
- the default branch (`repo.defaultBranch`), and the default branch that `profile.md` expects,
- the branch pattern of your local branches (`repo.branchPattern`), for example `users/alex/{KEY}-{slug}`,
- each CLI that is missing or not logged in.

When the remote is not the remote that `profile.md` expects, tell the user. The profile config is for that repository.

### Step 2. Tools

For each CLI that is not installed or not logged in, show the `install` command and the login command.
The user runs them in a terminal. Then run `detect` again.
The **Tools** table of `profile.md` gives each CLI or MCP server, its use, and its login. Without a profile, use the `cli` and `auth` rows of each config file.

A missing CLI never blocks setup. Continue, and tell the user that those capabilities stay `manual` until the CLI works.

### Step 3. Wiki

When `wiki.exists` is false, show the path and the remote, and ask for approval (see **📚 Wiki remote**).
Clone the team wiki to that path when the team already shares one. Otherwise, run `init-wiki`.
Run `bind` after a clone, or when an existing wiki is not bound.
Add the remote with `git -C <wiki> remote add origin <url>` only after approval.
A cloned wiki usually has its config already. Then skip to step 5, and set only your personal values.

### Step 4. Seed the config

Show the files that `seed` writes, and run `seed` after approval:

- `<wiki>/forge/config/tracker.md`, `repo.md`, `ci.md`, and `policy.md`,
- `<wiki>/rules/toolkit.md` and `<wiki>/rules/data.md`, only when `<wiki>/rules` is missing.

`seed` keeps existing files. Use `--force` only after the user agrees to replace `tracker.md`, `repo.md`, and `ci.md`.
`seed` never replaces `policy.md` or a rule page.

### Step 5. Your values

Two values differ for each user. Ask for them in one form. Prefill each field from `suggestion.values`.

| Key | Prefill | Why forge needs it |
|---|---|---|
| `repo.branchPattern` | `values.repo.branchPattern`, else the prefill of `profile.md` | The branch names of implementer sessions. Replace `<user>` with your name. |
| main checkout | `values.checkouts[0]`, else the prefill of `profile.md` | The name, the path, and the remote of your main clone. |

1. Write the branch pattern: `<F> config set "repo.branchPattern=<pattern with your name>"`.
2. Write the main checkout: `<F> config row checkouts "<name>" "<path>" "<remote>"`. With the name of the template row, this replaces that row.
3. Ask whether the work also uses other clones. Add one row for each. Leave `baseBranch` empty when it is the default branch.
4. Show the template queries `mine` and `team`. Change a query only when the user asks. `profile.md` gives the usual change.

When a command reports a problem, show it, ask for a corrected value, and run it again.
Keep the values of an existing wiki config unless the user asks to change them.

### Step 6. Check the values

Run `doctor`. Fix each `config:placeholder` and `config:checkouts` line with step 5.
Do not continue to **Trust** while `<user>` remains in `repo.branchPattern`. `worktree` refuses that pattern.

### Step 7. Credentials

The user runs each command in a terminal. The prompt hides the input. Never ask for a secret in chat.

The **Credentials** table of `profile.md` gives each credential, its command, and what it holds.
Without a profile, use the `cred:<name>` lines of `doctor`, and `node "<plugin>/scripts/cred.mjs" set <name>`.

Then run `doctor` again. Each `warn cred:<name>` line must be gone. A tenant credential expires. The **Resume** hook of `policy.md` tells how to renew it.

### Step 8. Trust

Run `git -C <wiki> status --short` and `git -C <wiki> diff -- forge rules`. Show what changed.
Run `trust`. Show each `new` or `changed` file with the first 12 characters of its hash.
After the user says yes, run `trust approve <path>=<hash> ...` for exactly those files.
A rule page shows as `../rules/<name>.md`. The hook gives a rule page to each session only after approval.

### Step 9. Live read

Read `<config>/<kind>.md` and run its **Auth check**. Then run each read capability once against a real item:
`tracker.fetch` (ask for one real key), `tracker.search` with `mine`, `repo.history`, and `ci.status`.
Report `ok` or the error with its fix from **Failures**. Also use the **Live read** notes of `profile.md`.
Never run a write capability during setup.

### Step 10. Finish

1. Run `doctor`. It must show no `fail` line.
2. Offer the 🧩 Optional extras.
3. Tell the user to commit the wiki: `git -C <wiki> add forge rules index.md .gitignore`, then `git -C <wiki> commit`.
4. Push only when the user asks and approves the exact command.
5. Tell the user the next action from **First ticket** in `profile.md`, else: "Say `start <KEY>` to begin a ticket."

## 🔄 Refresh the profile config

Use this flow when a forge update changed a shared profile value in `templates/config/`. Keep `policy.md` and the rule pages.

1. Run `config --json` and save your personal values: `repo.branchPattern`, the **Checkouts** rows, and the **Queries** rows that you changed. When trust fails, read the files directly.
2. Recommend a wiki commit first, so that `git diff` shows the refresh.
3. Run `seed --force` after approval. It replaces `tracker.md`, `repo.md`, and `ci.md`.
4. Re-apply the saved values with `config set` and `config row` (step 5).
5. To refresh `policy.md` or a rule page, show the diff against `<plugin>/templates/`, and copy the file only after approval.
6. Run steps 6 (check), 8 (trust), and 9 (live read).

## ⏯️ Resume

A setup can stop at any step. Find the first open step from `detect` and `doctor`, and continue there.
Do not repeat a step that is already done. Do not ask again for values that the config already holds.

| `doctor` or `detect` shows | Continue at |
|---|---|
| `fail wiki` | Step 3 (wiki) |
| `warn wiki:binding` | Step 3: run `bind` |
| `warn config:<kind>.md Missing` | Step 4 (seed) |
| `warn config:<kind>.md <cli> is not on PATH` | Step 2 (tools) |
| `warn config:placeholder` or `warn config:checkouts` | Step 5 (your values) |
| `warn cred:<name>` | Step 7 (credentials) |
| `fail trust` | Step 8 (trust) |
| `fail config` | Show the error. Fix the value with `config set`. |
| no `fail`, no `warn` | Step 9 (live read), then step 10 |

## 🧩 Optional extras

Offer the extras in one form after setup, or when the user asks. Each one is optional. Skip each one that is already done.

### Policy values

The profile `policy.md` already holds the hook sections and the values. Show the current values with the **Policy notes** of `profile.md`, and change one only when the user asks:

- `noMergeWeekdays`: days with no merge, for example a release day.
- `evidenceOnDeployedEnv`: whether Evidence Testing uses a deployed feature branch.
- `qaHandover`: whether QA tests after the merge.
- `maxImplementers`: the maximum number of implementer sessions. The default is 6.
- `adversarialReviewModel`: the reviewer model. Empty means a model family different from the author.

Write a change with `config set`, for example `"policy.maxImplementers=4"`.
A hook can add steps and make rules stricter. It can never weaken a core rule.

### Learning mode

Ask whether forge offers optional lessons from artifact questions. The default is `false`.
Write the answer with `<F> config set "policy.learningMode=true"` (or `false`). The `learning-mode` skill describes the use.

### Daily recap

Ask whether the user wants a daily recap. When yes, use the `daily-recap` skill to write
`<wiki>/raw/daily-recap/settings.json` (time zone, work days, daily meeting, and the `mine` query).
Then offer a scheduled VS Code Automation "Prepare my daily":

1. Read the [Automations](https://code.visualstudio.com/docs/agents/run/automations) page first. Its UI and settings change.
2. Tell the user to select **Automations** in the Agents window sidebar, then the forge template **Prepare my daily** under **Templates from Plugins** (see Automations below). Without the template, create a **Local** automation.
3. Check the prompt "Prepare my daily" and the repository as the workspace. Set the schedule time to `preparationTime` from `settings.json`.
4. Tell the user to review the permissions, and to enable the automation only after the review.
5. When **Automations** is not visible, the user turns on `chat.automations.enabled`.

### Board

Tell the user: say "show the board" in any session. The `board` skill shows the state of each ticket and keeps the ticket session titles and state groups current. There is nothing to set up.

### Automations

The forge plugin has two automation templates. VS Code shows them under **Templates from Plugins**. A template does not create or enable an automation.

| Template | Schedule | What it does |
|---|---|---|
| **Forge maintenance** | 09:00, 11:00, 13:00, 15:00, 17:00, Monday to Friday | Board, sync notes, lint report, people waits, titles, and state groups |
| **Prepare my daily** | 10:20, Monday to Friday | The draft daily recap of the `daily-recap` skill |

1. Read the [Automations](https://code.visualstudio.com/docs/agents/run/automations) page first.
2. Tell the user to select **Automations** in the Agents window sidebar, expand **Templates from Plugins**, and select a forge template.
3. In the **New Automation** dialog: **Run in the Cloud** off, the main checkout as the workspace, not **New Worktree**, and the default **Agent**. In VS Code 1.145, a run with a plugin agent has no workspace and does not get the agent instructions.
   Select a model that defers MCP tools, for example Claude Sonnet. Also read **Automations** in `profile.md`. A model that loads all MCP tools in full can exceed its context budget before the run starts. In **Advanced** > **Customizations**, keep **forge** selected. Review the prompt, the schedule, and the permissions. With **Interactive**, each run stops at its first command until you approve it. For runs without you, select **Allow all**.
4. Select **Run now** one time, and review the run in **History**. Then select **Enabled**, and save.
5. A run writes only in `<wiki>/raw/` and changes only session titles and groups. It reads the tracker, the repository host, and CI.
6. Never create, change, or enable an automation without explicit approval. When the user asks you to create one, use `host.automation` with:
   the template prompt, the template schedule as a cron expression, the main checkout as a folder workspace (not a worktree),
   and a Claude Sonnet model from the list of automation models, not Haiku.
   Save it disabled, and ask the user for the permission level. Get the ID from the automation list, then start one test run.

### VS Code check

1. Read the latest release notes and the [Agent plugins](https://code.visualstudio.com/docs/agent-customization/agent-plugins) page.
2. Confirm that `chat.plugins.enabled` is on, and that **Chat: Open Customizations** > **Plugins** shows one `forge` plugin.
3. Two `forge` plugins load the rules two times. Tell the user to disable one of them.
4. Never change a user setting without approval. Give the UI steps, and let the user change it.

## 📚 Wiki remote

The wiki is `../<repo>.wiki`, next to `../<repo>.worktrees`. It holds the forge config,
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

- Prefer the login of the CLI (`gh auth login`, `az login`). An MCP server that a config file names uses its own sign-in.
- When a wiki script needs a secret, the user runs `node "<plugin>/scripts/cred.mjs" set <name>`.
  The prompt hides the input. Never ask for a secret in chat.
- Use `cred.mjs has <name>` or `doctor` to check. There is no command that prints a secret.

## 📏 Rules

- Never put a secret in a config file or in the wiki.
- Ask before each write to the wiki: show the command and the files that change.
- Write CLI commands in the capability rows. Use MCP only when no CLI or REST call can do the
  capability (see the `forge` rule, "Tool choice: CLI first"). `profile.md` names each exception.
- A profile value that all users share changes in the forge repository (`templates/`), not only in one wiki.
  Then each user runs 🔄 Refresh the profile config. Helper scripts go into `<wiki>/forge/scripts`. See `docs/wiki.md` for sharing and trust.
- Never approve trust for the user. Never run a write capability during setup.
