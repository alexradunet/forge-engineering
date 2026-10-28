---
provider: github
host: github.com
changeName: PR
branchPattern: "{KEY}-{slug}"
baseBranch: main
---

# 🐙 GitHub pull requests (`gh`)

> forge reads this file as `config/repo.md`. `forge-setup` copies it from `templates/config/`. Edit the frontmatter values first.
> Then change a command when your team uses another tool. `repo.<key>` below means the frontmatter key `<key>` of this file.

Tools: gh.

`<remote>` is `owner/repo` from the checkout in `repo.checkouts`. On GitHub Enterprise Server, use `<repo.host>/owner/repo`.
`<owner>` and `<name>` are the two parts of `owner/repo`. `<n>` is the PR number.

## 📁 Checkouts

This table is `repo.checkouts`: the local clones that forge works in. The first row is the main checkout. An empty `baseBranch` uses `repo.baseBranch`.

| Name | Path | Remote | baseBranch |
|---|---|---|---|
| `app` | `C:\dev\app` | `owner/app` | |

## 🔐 Auth check

`gh auth status --hostname <repo.host or github.com>`

When it fails, ask the user to run `gh auth login --hostname <host>`. An organization with SAML SSO also needs the token authorized for that organization.

## 🔑 Keys

A PR is `#<n>`. Its URL is `https://<host>/<owner>/<name>/pull/<n>`.

## 🧰 Capabilities

| Capability | Command | Notes |
|---|---|---|
| `repo.open-change` | 1. `git push -u origin <branch>` 2. `gh pr create -R <remote> -B <base> -H <branch> -t "<title>" -F <body file> [--draft]` | `<base>`: the checkout `baseBranch`, else `repo.baseBranch`. The command prints the PR URL. |
| `repo.update-change` | `gh pr edit <n> -R <remote> [-t "<title>"] [-F <body file>]` | Push new commits with `git push`. A general PR comment: `gh pr comment <n> -R <remote> -F <body file>`. |
| `repo.change-status` | `gh pr view <n> -R <remote> --json state,isDraft,reviewDecision,mergeStateStatus,mergeable,statusCheckRollup,url` | `reviewDecision`: `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`. |
| `repo.review-comments` | the GraphQL query below | Returns each thread with `id`, `isResolved`, `path`, `line`, and its comments. Report open threads only. |
| `repo.reply` | `gh api -X POST repos/<owner>/<name>/pulls/<n>/comments/<comment id>/replies -F body=@<body file>` | `<comment id>`: the `databaseId` of the first comment of the thread. |
| `repo.history` | `gh pr list -R <remote> -S "<text>" -s all -L 20 --json number,title,state,url,author,mergedAt` | Then read the threads of each hit with `repo.review-comments`, and `gh pr view <n> -R <remote> --json reviews,comments`. |

Review threads query: write this text to a file in the system temp folder (`<query file>`):

```graphql
query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved isOutdated path line comments(first:50){nodes{databaseId author{login} body createdAt}}}}}}}
```

Then run `gh api graphql -F owner=<owner> -F name=<name> -F n=<n> -F query=@<query file>`. It works in every shell.

## 🩺 Failures

| Error | Cause | Fix |
|---|---|---|
| `gh auth login` required, or HTTP 401 | No login or an expired token | The user runs `gh auth login --hostname <host>`. |
| HTTP 404 on the repository | Wrong `remote`, or no access | Check the `Remote` column of `repo.checkouts`. Ask the user to check access. |
| `Resource protected by organization SAML enforcement` | Token not authorized for SSO | The user runs `gh auth refresh --hostname <host>` and authorizes the organization. |
| `No commits between <base> and <branch>` | The branch is not pushed, or has no new commits | Push the branch. Check the base branch. |
| `a pull request for branch ... already exists` | The PR exists | Use `repo.update-change` on that PR. |
