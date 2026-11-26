---
provider: forgejo
host: forgejo.example
changeName: PR
branchPattern: "users/<user>/{KEY}-{slug}"
baseBranch: main
---

# 🦎 Forgejo pull requests (`tea`)

> forge reads this file as `config/repo.md`. `forge-setup` copies it from `profiles/forgejo/config/`. It holds the values of the Forgejo profile.
> `changeName` is `PR`, `MR`, or `none`. `none`: no change requests, and the agent pushes to the base branch after Shippable?.
> `repo.<key>` below means the frontmatter key `<key>` of this file.

Tools: tea 0.14 or later.

A repository with no pull requests sets `changeName: none`. The steps are in "Implement" of the `ticket` skill.

Run each command in a checkout or a worktree of the repository. Outside of one, add `--repo <owner>/<name> --login <login name>`.
`<owner>` and `<name>` are the two parts of the repository path. `<n>` is the PR number.

## 📁 Checkouts

This table is `repo.checkouts`: the local clones that forge works in. The first row is the main checkout. An empty `baseBranch` uses `repo.baseBranch`.
Setup adds the row of your main clone.

| Name | Path | Remote | baseBranch |
|---|---|---|---|

## 🔐 Auth check

`tea whoami` in a checkout of the repository.

When it fails, ask the user to run `tea login add` for `https://<repo.host>`.

## 🔑 Keys

A PR is `#<n>`. Its URL is `https://<repo.host>/<owner>/<name>/pulls/<n>`.

## 🧰 Capabilities

| Capability | Command | Notes |
|---|---|---|
| `repo.open-change` | 1. `git push -u origin <branch>` 2. `tea pulls create --base <base> --head <branch> --title "<title>" --description "$(cat <body file>)"` | `<base>`: the checkout `baseBranch`, else `repo.baseBranch`. A draft has the title prefix `WIP: `. |
| `repo.update-change` | `tea pulls edit <n> [--title "<title>"] [--description "$(cat <body file>)"]` | Push new commits with `git push`. A general PR comment: `tea comment <n> "$(cat <body file>)"`. |
| `repo.change-status` | `tea api "/repos/<owner>/<name>/pulls/<n>"` | It gives the state, `mergeable`, and the head sha. The reviews: `tea api "/repos/<owner>/<name>/pulls/<n>/reviews"`. The checks of the head commit: `tea api "/repos/<owner>/<name>/commits/<sha>/status"`. |
| `repo.review-comments` | `tea pulls review-comments <n> --output json` | Each comment has `id`, `path`, `line`, `body`, `reviewer`, and `resolver`. Report the comments with no `resolver` only. |
| `repo.reply` | `manual` | `tea` has no command to reply in a review thread. Answer with a general comment that names the file and the line. |
| `repo.history` | `tea pulls list --state all --limit 20 --output json` | For a text: `git log --all --oneline --grep "<text>"`. Then read the comments of each hit with `repo.review-comments`. |

Never run `tea pulls merge`, `tea pulls approve`, or `tea pulls reject`: the user merges and reviews in the web page.

## 🩺 Failures

| Error | Cause | Fix |
|---|---|---|
| `No gitea login configured`, or HTTP 401 | No login, or a token that is not valid | The user runs `tea login add`. |
| `Remote repository required` | The folder is not a checkout of the repository | Run the command in the checkout, or add `--repo <owner>/<name> --login <login name>`. |
| `! [rejected] <branch> -> <branch> (fetch first)` | Another agent or the owner pushed | Run `git fetch`, rebase on `origin/<base>`, run the checks again, and push again. Never force-push. |
| HTTP 404 on a pull request | Wrong number, or no access | Check the number with `repo.history`. |
