---
name: forge-setup
description: Set up, check, or repair forge for the current repository. Detects the host, the CLIs, and their login, creates or binds the repository wiki (../<repo>.wiki), seeds the team config (tracker, repository host, CI, policy) for GitHub, GitLab, Jira, local Markdown, or another tool, stores credentials in the OS credential store, and checks each capability with a live read. Use when the user says "set up forge", "check forge", "repair forge", "configure forge", or "switch the tracker to GitLab".
disable-model-invocation: true
---

# 🔧 forge setup

One chat sets up forge for the current repository. The plugin holds no machine
paths and no team config. Both live in the repository wiki.

## 📁 Commands

`<plugin>` is the folder two levels above this `SKILL.md`. Use the absolute,
resolved path in each command. All commands run on Windows, macOS, and Linux.

| Command | Use | Writes |
|---|---|---|
| `node "<plugin>/scripts/forge.mjs" where --json` | Repository, worktree, wiki, and config folder | nothing |
| `node "<plugin>/scripts/forge.mjs" detect` | Host, visibility, CLIs and login, wiki state, suggestions | nothing |
| `node "<plugin>/scripts/forge.mjs" init-wiki` | Create the local wiki (`git init`, `.gitignore`, `index.md`) and bind it | the wiki folder |
| `node "<plugin>/scripts/forge.mjs" bind` | Write `<wiki>/forge/repo.json` | the wiki folder |
| `node "<plugin>/scripts/forge.mjs" seed --tracker <t> --repo <r> --ci <c> [--force]` | Copy templates to `<wiki>/forge/config` | the wiki folder |
| `node "<plugin>/scripts/forge.mjs" trust [approve <path>=<hash> ...]` | Show or approve the files under `<wiki>/forge` | the user data folder |
| `node "<plugin>/scripts/forge.mjs" doctor` | Read-only check of the whole setup | nothing |
| `node "<plugin>/scripts/cred.mjs" set\|has\|delete <name>` | OS credential store (the user types the secret) | the credential store |

Add `--wiki <dir>` to a command to use another wiki for one call.

## ✅ Check or repair

1. Run `doctor`. Report each `fail` and `warn` line with its fix.
2. Read the latest VS Code release notes (see "VS Code Agents window" in the `forge` rule). Report each change that affects plugins, sessions, worktrees, automations, or MCP servers.
3. Check the plugin version. When `<plugin>/../..` is a Git clone, run `git -C <plugin>/../.. fetch -q`, then
   `git -C <plugin>/../.. log --oneline "HEAD..@{u}"` (keep the quotes; PowerShell needs them). When it lists commits, tell the user to update (README, "Update forge").
   An uninstall and a new install from source can reuse the old clone, so a reinstall is not an update.
4. When the wiki or its config is missing, run the full setup below.
5. Never print, read, or ask for a credential value.

## 🚀 Full setup

State the progress at each step ("step 3 of 10 done").

1. **Detect.** Run `detect`. Do not ask for anything that `detect` already shows.
2. **Confirm.** Ask in one form. Use the `suggestion` values as defaults.
   Keep values from existing wiki config:
   - tracker: `github`, `gitlab`, `jira`, `local` (Markdown files in the wiki), or `other`
   - repository host: `github`, `gitlab`, or `other`
   - CI: `github-actions`, `gitlab-ci`, `jenkins`, `azure-pipelines`, or `other`
   - wiki remote (see **📚 Wiki remote**)
3. **Tools.** For each CLI that the choice needs and that is not installed or not logged in,
   show the `install` command and the login command from `detect`. The user runs them.
   Then run `detect` again.
4. **Wiki.** When `wiki.exists` is false, show the path and the remote, and ask for approval.
   Clone an existing wiki to that path when the team already shares one. Otherwise, run `init-wiki`.
   Run `bind` after a clone, or when an existing wiki is not bound.
   Add the remote with `git -C <wiki> remote add origin <url>` only after approval.
5. **Config.** Show the files that change and run `seed` after approval.
   `seed` keeps existing files. Use `--force` only after the user agrees to replace a file.
6. **Values.** Ask for missing frontmatter values in a second form: `prefix`, `project`, `host`,
   `itemUrl`, `changeName`, `branchPattern`, `baseBranch`, and the policy values.
   Show the template value as the default. Keep values from existing wiki config.
   Write them into `<wiki>/forge/config/*.md`.
7. **Tables.** Fill in the **Queries** table of `tracker.md` and the **Checkouts** table of `repo.md` with the user.
   For `other`, ask how the team does each capability. Write a CLI command in the row, or keep `manual`.
8. **Trust.** Run `trust`. Show each `new` or `changed` file with the first 12 characters of its hash.
   After the user says yes, run `trust approve <path>=<hash> ...` for exactly those files.
9. **Live read.** For each read capability (for example `tracker.fetch`, `tracker.search`, `repo.history`, `ci.status`),
   run the row once against a real item. Report `ok` or the error with its fix.
   Never run a write capability during setup.
10. **Finish.** Run `doctor`. Review the tracked files and Git history before a public push.
    Tell the user to commit the wiki: `git -C <wiki> add forge index.md .gitignore`,
    then `git -C <wiki> commit`. Push only when the user asks and approves the exact command.

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
- Never change the visibility of a repository.
- A GitHub wiki exists only after its first page. Tell the user to open
  `<remote>/wiki`, create a page, and save it. Then the clone and the push work.
- Create a separate repository only after explicit approval, for example
  `gh repo create <owner>/<repo>-wiki --private`.

## 🔑 Credentials

- Prefer the login of the CLI (`gh auth login`, `glab auth login`, `acli jira auth login`, `az login`).
- When a wiki script needs a secret, the user runs `node "<plugin>/scripts/cred.mjs" set <name>`.
  The prompt hides the input. Never ask for a secret in chat.
- Use `cred.mjs has <name>` to check. There is no command that prints a secret.

## 📏 Rules

- Never put a secret in a config file or in the wiki.
- Write CLI commands in the capability rows. Use MCP only when no CLI or REST call can do the
  capability (see the `forge` rule, "Tool choice: CLI first").
- Company rules go into the hook sections of `policy.md`. Helper scripts go into `<wiki>/forge/scripts`.
  Keep both out of the core skills. See `docs/wiki.md` for sharing and trust.
