---
provider: github-issues
host: github.com
prefix: GH
---

# 🐙 GitHub Issues (`gh`)

> forge reads this file as `config/tracker.md`. `forge-setup` copies it from `templates/config/`. It holds the values of the GitHub profile.
> Change a shared value in the forge repository, so that each user gets it. `tracker.<key>` below means the frontmatter key `<key>` of this file.

Tools: gh.

`<remote>` is `owner/repo` of the main checkout (the first row of `repo.checkouts`). On GitHub Enterprise Server, use `<tracker.host>/owner/repo`.
`<n>` is the issue number: the number part of `<KEY>`.

## 🔎 Queries

Named searches for `tracker.search`, in the GitHub issue search syntax. The `ticket` skill uses them by name.

| Name | Query |
|---|---|
| `mine` | `assignee:@me state:open sort:updated-desc` |
| `team` | `state:open sort:updated-desc` |

## 🔐 Auth check

`gh auth status --hostname <tracker.host>`

When it fails, ask the user to run `gh auth login --hostname <host>`.

## 🔑 Keys

GitHub gives an issue the number `#<n>`. forge needs a key with a prefix, so the key of issue `#<n>` is `GH-<n>`.
When the user gives `#123` or an issue URL, use the key `GH-123`. The URL of a key is `https://<tracker.host>/<remote>/issues/<n>`.

## 🧰 Capabilities

| Capability | Command | Notes |
|---|---|---|
| `tracker.fetch` | `gh issue view <n> -R <remote> --json number,title,state,stateReason,labels,assignees,author,body,comments,url` | |
| `tracker.search` | `gh issue list -R <remote> -S "<query>" -L 50 --json number,title,state,updatedAt,url` | `<query>`: a named query from `tracker.queries`. Show each result as `GH-<number>`. |
| `tracker.comment` | `gh issue comment <n> -R <remote> -F <body file>` | The body is Markdown. |
| `tracker.transition` | `gh issue close <n> -R <remote> --reason completed`, or `gh issue reopen <n> -R <remote>` | An issue is only open or closed. A team that uses labels for other states: `gh issue edit <n> -R <remote> --add-label "<label>" --remove-label "<label>"`. Ask the user which label to use. |
| `tracker.link` | `gh issue comment <n> -R <remote> -F <body file>` with the line `Related: <other key or URL>` | GitHub links an issue reference (`#<n>` or `owner/repo#<n>`) in a comment. A pull request closes the issue when its description has `Closes #<n>`. |

## 🩺 Failures

| Error | Cause | Fix |
|---|---|---|
| `gh auth login` required, or HTTP 401 | No login or an expired token | The user runs `gh auth login --hostname <host>`. |
| `Could not resolve to an issue` | Wrong number, or the number is a pull request | Check the number. Use `gh pr view` for a pull request. |
| HTTP 404 on the repository | Wrong `remote`, or no access | Check the `Remote` column of `repo.checkouts`. Ask the user to check access. |
| `the repository has disabled issues` | Issues are off for the repository | Ask the user to turn on Issues, or to use a profile with another tracker. |
| `Resource protected by organization SAML enforcement` | Token not authorized for SSO | The user runs `gh auth refresh --hostname <host>` and authorizes the organization. |
