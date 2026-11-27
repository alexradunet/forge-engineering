---
name: forge-setup
description: Set up, check, repair, resume, or refresh forge for the repository of its wiki. Detects the default branch, your branch pattern, and your main clone; creates or binds the Forge folder of the repository (../<repo>.forge, with its wiki); seeds the config (repository, policy) and the rule page; sets your personal values; and offers the optional extras (policy values). Use when the user says "set up forge", "configure forge", "check forge", "repair forge", "finish forge setup", "resume forge setup", or "refresh the forge config".
disable-model-invocation: true
---

# 🔧 forge setup

> When your context has no `End of Forge context.` line, or a `Forge context part <i> of <n>` part is
> missing or has a different id, run `node "<plugin>/scripts/forge.mjs" context` first and follow its output. `<plugin>`
> is two folders above the folder of this file. When the command fails, read
> [forge.md](../../context/forge.md) (the `forge` rule), and [style.md](../../context/style.md) (the `style` rule) unless `policy.styleRules` is `false`.

One chat sets up forge for the repository of its wiki. The plugin holds the config templates,
but no machine paths. The config lives in the repository wiki (`../<repo>.forge/wiki`).
Forge calls no tracker, no change request host, and no CI tool, so setup needs no login and no credential.

At the end of setup, each item below is true:

- The wiki exists, is bound to the repository, and holds the two config files (`repo.md`, `policy.md`) and the rule page.
- `repo.branchPattern` holds your name, not `<user>`. `doctor` shows no `config:placeholder` line.
- The first **Checkouts** row is your main clone. `doctor` shows no `config:checkouts` line.

## 📁 Commands

`<plugin>` is the folder two levels above this `SKILL.md`. Use the absolute,
resolved path in each command. All commands run on Windows, macOS, and Linux.
`<F>` below means `node "<plugin>/scripts/forge.mjs"`.

| Command | Use | Writes |
|---|---|---|
| `<F> where --json` | Repository, worktree, wiki, and config folder | nothing |
| `<F> detect` | Host, default branch, key hints, your branch pattern, wiki state, and suggested values | nothing |
| `<F> doctor [--fetch]` | Read-only check of the whole setup: placeholders, the session start hook, and the plugin version (`--fetch` runs `git fetch` in the plugin clone) | nothing |
| `<F> init` | Create the Forge folder `../<repo>.forge`: the wiki (`git init`, `index.md`, the binding), `raw/`, `archive/`, and the launcher | the Forge folder |
| `<F> bind` | Write `<wiki>/forge/repo.json` | the wiki folder |
| `<F> seed [--force]` | Copy the config templates to `<wiki>/forge/config`, and the rule page to `<wiki>/rules` | the wiki folder |
| `<F> config set <file>.<key>=<value> ...` | Set frontmatter values. Validates first; writes nothing on a problem | the wiki folder |
| `<F> config row checkouts <name> [cells...] [--delete]` | Add, replace, or delete a row of the **Checkouts** table | the wiki folder |
| `<F> config --json` | Read the config | nothing |

- Add `--wiki <dir>` to a command to use another wiki for one call.
- Put each `config set` assignment and each table cell in double quotes. This keeps `{KEY}`, spaces, and `@` safe in every shell.
- `config set` adds quotes to a value that starts with `{`. A cell cannot hold `|`.
- Show the user each change of `config set` and `config row`. The wiki is a Git repository, so `git diff` shows it.

## 🧭 Pick the flow

Run `detect` and `doctor` first. Then pick one flow and tell the user which one.

| Signal | Flow |
|---|---|
| The user says "check forge" or "repair forge" | ✅ Check or repair |
| The user says "refresh the forge config", or a forge update changed `templates/config/` | 🔄 Refresh the config |
| `wiki.exists` is false and `wiki.config` is empty | 🚀 First-time setup |
| The wiki exists, but `doctor` shows a `fail` or `warn` | ⏯️ Resume |
| `doctor` is clean | ✅ Check, then offer the 🧩 Optional extras |

State the progress at each step, for example "step 4 of 8 done".

## ✅ Check or repair

1. Run `doctor`. Report each `fail` and `warn` line with its fix.
2. Read the changelog of the current host (the feature section of `<plugin>/hosts/claude.md` or `<plugin>/hosts/copilot-cli.md` has the links). Report each change that affects plugins, sessions, worktrees, hooks, or custom agents.
3. Check the plugin version: run `<F> doctor --fetch` and read the `plugin:version` line. When it says that the clone is behind, tell the user to update (README, "Update forge").
   An uninstall and a new install from source can reuse the old clone, so a reinstall is not an update.
4. When a line needs a fix, continue with ⏯️ Resume.

## 🚀 First-time setup

### Step 1. Detect

Run `detect` in the main checkout. Do not ask for anything that `detect` already shows. Tell the user, in one short list:

- the host (`repo.host`) and the remote,
- the default branch (`repo.defaultBranch`),
- the branch pattern of your local branches (`repo.branchPattern`), for example `users/alex/{KEY}-{slug}`.

### Step 2. Wiki

When `wiki.exists` is false, show the path and the remote, and ask for approval (see **📚 Wiki remote**).
Clone the team wiki to that path (`../<repo>.forge/wiki`) when the team already shares one. Then run `init`: it adds `raw/`, `archive/`, and the launcher, and it changes no file of the clone. Without a team wiki, `init` also creates the wiki.
Run `bind` after a clone, or when an existing wiki is not bound.
Add the remote with `git -C <wiki> remote add origin <url>` only after approval.
A cloned wiki usually has its config already. Then skip to step 4, and set only your personal values.

### Step 3. Seed the config

Show the files that `seed` writes, and run `seed` after approval.

- `<wiki>/forge/config/repo.md` and `policy.md`,
- `<wiki>/rules/data.md`, only when `<wiki>/rules` is missing.

`seed` keeps existing files. Use `--force` only after the user agrees to replace `repo.md`.
`seed` never replaces `policy.md` or a rule page.

### Step 4. Your values

These values differ for each user. Ask for them in one form. Prefill each field from `suggestion.values`.

| Key | Prefill | Why forge needs it |
|---|---|---|
| `repo.branchPattern` | `values.repo.branchPattern`, else `users/<your name>/{KEY}-{slug}` | The branch names of implementer sessions. Replace `<user>` with your name. |
| main checkout | `values.checkouts[0]` | The name, the path, and the remote of your main clone. |

1. Write the branch pattern: `<F> config set "repo.branchPattern=<pattern with your name>"`.
2. Write the main checkout: `<F> config row checkouts "<name>" "<path>" "<remote>"`. With the name of the template row, this replaces that row.
3. Ask whether the work also uses other clones. Add one row for each. Leave `baseBranch` empty when it is the default branch.
4. Ask for the name of the change request: `PR`, `MR`, or `none` (a repository with no change requests: the push goes to the base branch). Write it with `<F> config set "repo.changeName=<value>"`. Check `repo.baseBranch` against the default branch.

When a command reports a problem, show it, ask for a corrected value, and run it again.
Keep the values of an existing wiki config unless the user asks to change them.

### Step 5. Team size

Ask for the team size and the response style. Use one `host.ask` form with 2 questions. Never answer for the user.

1. Team size: `small` (solo, or a team of 5 or less), or `large` (a large team with QA and deployed test environments).
2. Response style: the response style rules of the plugin (Simplified Technical English, no AI tells, the ADHD response shape) in each session. The answer is `on` or `off`.

Show the values, then write them with one command. `styleRules` is `true` for `on`, and `false` for `off`.

- small: `<F> config set "policy.planReview=attacker" "policy.scopeComment=false" "policy.evidenceOnDeployedEnv=false" "policy.qaHandover=false" "policy.styleRules=<true|false>"`
- large: `<F> config set "policy.planReview=attacker" "policy.scopeComment=true" "policy.evidenceOnDeployedEnv=true" "policy.qaHandover=true" "policy.styleRules=<true|false>"`

Tell the user what the 3 large-team values do:

- `scopeComment`: after the scope check, forge drafts a comment with the scope for the reporter.
- `evidenceOnDeployedEnv`: the proof of the change runs after the push, on a deployed environment.
- `qaHandover`: after the merge, forge drafts a QA handover comment.

The user can change each value. `planReview: panel` (3 reviewer subagents) also exists, and no team size sets it.
The values are in `policy.md`, and the wiki commit is their record. Keep the values of a policy that a team already shares, unless the user asks to change them.

### Step 6. Check the values

Run `doctor`. Fix each `config:placeholder` and `config:checkouts` line with step 4.
Do not continue to step 7 while `<user>` remains in `repo.branchPattern`. `worktree` refuses that pattern.

### Step 7. Finish

1. Run `doctor`. It must show no `fail` line.
2. Offer the 🧩 Optional extras.
3. Tell the user to commit the wiki: `git -C <wiki> add forge rules index.md .gitignore`, then `git -C <wiki> commit`.
4. Push only when the user asks and approves the exact command.
5. Tell the user: "Say `start <KEY>` to begin a ticket, or `new local ticket`."

## 🔄 Refresh the config

Use this flow when a forge update changed `templates/config/`. Keep `policy.md` and the rule page.

1. Run `config --json` and save your personal values: `repo.branchPattern`, `repo.changeName`, and the **Checkouts** rows. 
2. Recommend a wiki commit first, so that `git diff` shows the refresh.
3. Run `seed --force` after approval. It replaces `repo.md`.
4. Re-apply the saved values with `config set` and `config row` (step 4).
5. To refresh `policy.md` or the rule page, show the diff against `<plugin>/templates/`, and copy the file only after approval.
6. Run step 6 (check).

## ⏯️ Resume

A setup can stop at any step. Find the first open step from `detect` and `doctor`, and continue there.
Do not repeat a step that is already done. Do not ask again for values that the config already holds.

| `doctor` or `detect` shows | Continue at |
|---|---|
| `fail wiki` | Step 2 (wiki) |
| `warn wiki:binding` | Step 2: run `bind` |
| `warn config:<kind>.md Missing` | Step 3 (seed) |
| `warn config:placeholder` or `warn config:checkouts` | Step 4 (your values) |
| `fail config` | Show the error. Fix the value with `config set`. |
| no `fail`, no `warn` | Step 7 |

## 🧩 Optional extras

Offer the extras in one form after setup, or when the user asks. Each one is optional. Skip each one that is already done.

### Policy values

The `policy.md` already holds the hook sections and the values. Step 5 sets `planReview`, `scopeComment`, `evidenceOnDeployedEnv`, `qaHandover`, and `styleRules`.
Show the current values, and change one only when the user asks. Step 5 does not set these keys:

- `noMergeWeekdays`: days with no merge, for example a release day.
- `maxImplementers`: the maximum number of implementer sessions. The default is 6.
- `adversarialReviewModel`: the reviewer model. Empty means a model family different from the author.
- `gateGuard`: what the gate guard does with a push of a ticket that has no valid Shippable? approval: `deny`. Only the user can loosen the guard, with `FORGE_GATE_GUARD=ask` or `FORGE_GATE_GUARD=off` in the environment: a wiki value `ask` or `off` acts as `deny`. Never set that variable for the user.

Write a change with `config set`, for example `"policy.maxImplementers=4"`.
A hook can add steps and make rules stricter. It can never weaken a core rule.

### Board

Tell the user: say "show the board" in any session. The `board` skill shows the state of each ticket and keeps the ticket session titles current. There is nothing to set up.

## 📚 Wiki remote

The wiki is `../<repo>.forge/wiki`, and the Forge folder is next to `../<repo>.worktrees`. The wiki holds the forge config
and knowledge pages. `raw/` and `archive/` are next to the wiki, so they stay local.

The Forge folder has a launcher: the user runs `../<repo>.forge/forge open` in a terminal (`forge.cmd` on Windows).
It starts the live server of the repository in the background and opens the board and the wiki in the browser.
Tell the user this command at the end of the setup.

| `suggestion.wikiRemote.type` | Meaning | Action |
|---|---|---|
| `existing` | The wiki already has a remote | Keep it |
| `ask` | The wiki has no remote | Ask the user to pick the wiki remote: the native wiki `<remote>.wiki.git`, a separate private repository (`<remote>-wiki`), or local only |

- Offer the public wiki only when its files and Git history contain public data.
- Keep internal hosts, personal paths, company rules, and private knowledge out of a public wiki.
  The **Checkouts** table and `forge/repo.json` hold local paths.
- A GitHub wiki exists only after its first page. Tell the user to open
  `<remote>/wiki`, create a page, and save it. Then the clone and the push work.
- Create a separate repository only after explicit approval, for example
  `gh repo create <owner>/<repo>-wiki --private`.

## 📏 Rules

- Never put a secret in a config file or in the wiki.
- Ask before each write to the wiki: show the command and the files that change.
- A config value that all users share changes in the forge repository (`templates/`), not only in one wiki.
  Then each user runs 🔄 Refresh the config. See `docs/wiki.md` for sharing.
- Never call a tracker, a change request host, or a CI tool.
