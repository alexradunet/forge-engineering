---
provider: github
host: github.com
project: owner/app
prefix: APP
itemUrl: https://github.com/owner/app/issues/{number}
---

# 🐙 GitHub issues (`gh`)

> forge reads this file as `config/tracker.md`. `forge-setup` copies it from `templates/config/`. Edit the frontmatter values first.
> Then change a command when your team uses another tool. `tracker.<key>` below means the frontmatter key `<key>` of this file.

Tools: gh.

`<project>` is `tracker.project` (`owner/repo`). On GitHub Enterprise Server, use `<tracker.host>/owner/repo`.
`<n>` is the issue number: the part after the dash in the key (`APP-42` → `42`).

## 🔎 Queries

Named searches for `tracker.search`, in the syntax of the tool. The `daily-recap` and `ticket` skills use them by name.

| Name | Query |
|---|---|
| `mine` | `assignee:@me is:open` |
| `team` | `is:open label:"team-a"` |

## 🔐 Auth check

`gh auth status --hostname <tracker.host or github.com>`

## 🔑 Keys

- Key → issue: `APP-42` → `#42` in `<project>`.
- Issue → key: `#42`, `42`, or `https://github.com/<project>/issues/42` → `<tracker.prefix>-42`.

## 🧰 Capabilities

| Capability | Command | Notes |
|---|---|---|
| `tracker.fetch` | `gh issue view <n> -R <project> --comments --json number,title,state,stateReason,labels,author,assignees,milestone,body,comments,url` | GitHub has no priority or type field. Read them from labels when the team uses labels for them. |
| `tracker.search` | `gh issue list -R <project> -S "<query>" -L 50 --json number,title,state,labels,updatedAt,url` | `<query>`: a named query from `tracker.queries`, in GitHub search syntax, for example `assignee:@me is:open`. |
| `tracker.comment` | `gh issue comment <n> -R <project> -F <body file>` | Prints the comment URL. |
| `tracker.transition` | Close: `gh issue close <n> -R <project> [-r completed]`. Reopen: `gh issue reopen <n> -R <project>`. Label status: `gh issue edit <n> -R <project> --add-label "<new>" --remove-label "<old>"` | A status in a GitHub Projects board is `not supported` here. Use the manual step, or add a command to this row. |
| `tracker.link` | Parent: `gh issue edit <n> -R <project> --parent <other>`. Sub-issue: `--add-sub-issue <other>`. Dependency: `--add-blocked-by <other>` or `--add-blocking <other>` | `<other>` is an issue number or URL. A relation to a plain URL (for example a PR): post a comment with `tracker.comment`. |

## 🩺 Failures

| Error | Cause | Fix |
|---|---|---|
| `gh auth login` required, or HTTP 401 | No login or an expired token | The user runs `gh auth login --hostname <host>`. |
| `Could not resolve to an issue or pull request` | Wrong number or wrong `tracker.project` | Check the key and `tracker.project`. |
| `issues are disabled for this repository` | The repository has no issues | Change `tracker.project`, or use the `local` tracker template. |
| `'<label>' not found` | The label does not exist | Ask the user to create it. Do not create labels yourself. |
