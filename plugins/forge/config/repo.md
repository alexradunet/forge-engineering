---
provider: other
changeName: PR
branchPattern: "{KEY}-{slug}"
baseBranch: main
---

# 🧩 Repository host: other (fill in your tool)

> forge reads this file as `config/repo.md`. `forge-setup` copies it from `templates/config/`. Edit the frontmatter values first.
> Then change a command when your team uses another tool. `repo.<key>` below means the frontmatter key `<key>` of this file.

Use this template for a host without a forge template, for example Bitbucket, Azure Repos, or Gitea.
Plain `git` works on every host. Until a row has a command, forge uses the manual step (see the `forge` rule, "Manual step").

1. Set `provider` to the name of your host, in lower case. Set `changeName` to `PR` or `MR`.
2. Fill in the **📁 Checkouts** table.
3. Replace `manual` in each row with the MCP tool or the CLI command.

## 📁 Checkouts

This table is `repo.checkouts`: the local clones that forge works in. The first row is the main checkout. An empty `baseBranch` uses `repo.baseBranch`.

| Name | Path | Remote | baseBranch |
|---|---|---|---|
| `app` | `C:\dev\app` | `owner/app` | |

## 🔐 Auth check

`git ls-remote origin HEAD` in the checkout must succeed.

## 🧰 Capabilities

| Capability | Command | Notes |
|---|---|---|
| `repo.open-change` | 1. `git push -u origin <branch>` 2. `manual` | Open the change request in the web UI. Record its URL. |
| `repo.update-change` | `git push` | Edit the title or the description by hand. |
| `repo.change-status` | `manual` | State, checks, reviews, and conflicts. |
| `repo.review-comments` | `manual` | Ask the user to paste the open threads. |
| `repo.reply` | `manual` | Reply in the web UI. |
| `repo.history` | `git log --oneline -20 -- <path>` | Search change requests by hand. |

## 🩺 Failures

| Error | Cause | Fix |
|---|---|---|
| `git push` is rejected | No access, or a protected branch | Check the branch name and the access rights. |
