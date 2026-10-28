---
provider: gitlab
host: gitlab.com
changeName: MR
branchPattern: "{KEY}-{slug}"
baseBranch: main
---

# 🦊 GitLab merge requests (`glab`)

> forge reads this file as `config/repo.md`. `forge-setup` copies it from `templates/config/`. Edit the frontmatter values first.
> Then change a command when your team uses another tool. `repo.<key>` below means the frontmatter key `<key>` of this file.

Tools: glab.

`<remote>` is `group/app` from the checkout in `repo.checkouts`. `<enc>` is the same path URL-encoded (`group%2Fapp`).
`<n>` is the MR number (`!<n>`). On a self-managed host, write `-R` as `<repo.host>/<remote path>` (glab accepts `HOST/GROUP/PROJECT`), and pass `--hostname <repo.host>` to `glab api`.

## 📁 Checkouts

This table is `repo.checkouts`: the local clones that forge works in. The first row is the main checkout. An empty `baseBranch` uses `repo.baseBranch`.

| Name | Path | Remote | baseBranch |
|---|---|---|---|
| `app` | `C:\dev\app` | `group/app` | |

## 🔐 Auth check

`glab auth status --hostname <repo.host or gitlab.com>`

## 🔑 Keys

An MR is `!<n>`. Its URL is `https://<host>/<remote>/-/merge_requests/<n>`.

## 🧰 Capabilities

| Capability | Command | Notes |
|---|---|---|
| `repo.open-change` | 1. `git push -u origin <branch>` 2. `glab mr create -R <remote> --source-branch <branch> --target-branch <base> --title "<title>" --description (Get-Content -Raw <body file>) [--draft] --push=false --yes` | `<base>`: the checkout `baseBranch`, else `repo.baseBranch`. The command prints the MR URL. |
| `repo.update-change` | `glab mr update <n> -R <remote> [--title "<title>"] [--description (Get-Content -Raw <body file>)]` | Push new commits with `git push`. |
| `repo.change-status` | `glab mr view <n> -R <remote> -F json` | Read `state`, `draft`, `detailed_merge_status`, `head_pipeline.status`. Approvals: `glab api --hostname <host> projects/<enc>/merge_requests/<n>/approvals`. |
| `repo.review-comments` | `glab mr note list <n> -R <remote> --state unresolved -F json` | Experimental command. Fallback: `glab api --hostname <host> projects/<enc>/merge_requests/<n>/discussions`. |
| `repo.reply` | `glab api --hostname <host> -X POST projects/<enc>/merge_requests/<n>/discussions/<discussion id>/notes -F body=@<body file>` | Short text: `glab mr note create <n> -R <remote> --reply <discussion id> -m "<text>"`. |
| `repo.history` | `glab mr list -R <remote> --search "<text>" --all -F json` | Then read the threads of each hit with `repo.review-comments` (use `--state all`). |

## 🩺 Failures

| Error | Cause | Fix |
|---|---|---|
| `401 Unauthorized` | No login or an expired token | The user runs `glab auth login --hostname <host>`. |
| `404 Not Found` | Wrong `remote`, wrong host, or no access | Check the `Remote` column of `repo.checkouts` and the host in `-R`. |
| `Another open merge request already exists for this source branch` | The MR exists | Use `repo.update-change` on that MR. |
| `unknown command "list" for "glab mr note"` | An older `glab` | Use the `glab api` fallback, or ask the user to update `glab`. |
