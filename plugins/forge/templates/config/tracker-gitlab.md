---
provider: gitlab
host: gitlab.com
project: group/app
prefix: APP
itemUrl: https://gitlab.com/group/app/-/issues/{number}
---

# 🦊 GitLab issues (`glab`)

> forge reads this file as `config/tracker.md`. `forge-setup` copies it from `templates/config/`. Edit the frontmatter values first.
> Then change a command when your team uses another tool. `tracker.<key>` below means the frontmatter key `<key>` of this file.

Tools: glab.

`<project>` is `tracker.project` (`group/app`). `<enc>` is the same path URL-encoded (`group%2Fapp`).
`<n>` is the issue number: the part after the dash in the key (`APP-42` → `42`).
On a self-managed host, set `$env:GITLAB_HOST = '<tracker.host>'` in the same command, and pass `--hostname <tracker.host>` to `glab api`.

## 🔎 Queries

Named searches for `tracker.search`, in the syntax of the tool. The `daily-recap` and `ticket` skills use them by name.

| Name | Query |
|---|---|
| `mine` | `--assignee=@me` |
| `team` | `--label "team::core"` |

## 🔐 Auth check

`glab auth status --hostname <tracker.host or gitlab.com>`

When it fails, ask the user to run `glab auth login --hostname <host>`.

## 🔑 Keys

- Key → issue: `APP-42` → `#42` in `<project>`.
- Issue → key: `#42`, `42`, or `https://<host>/<project>/-/issues/42` → `<tracker.prefix>-42`.

## 🧰 Capabilities

| Capability | Command | Notes |
|---|---|---|
| `tracker.fetch` | `glab issue view <n> -R <project> --comments -F json` | Type, priority, and status are usually scoped labels, for example `type::bug` or `workflow::in-review`. |
| `tracker.search` | `glab issue list -R <project> <query> -O json` | `<query>`: a named query from `tracker.queries`, as `glab issue list` flags, for example `--assignee=@me --label "team::core"`. Opened issues are the default; `-A` lists all. |
| `tracker.comment` | `glab api --hostname <host> -X POST projects/<enc>/issues/<n>/notes -F body=@<body file>` | Short text: `glab issue note <n> -R <project> -m "<text>"`. |
| `tracker.transition` | Close: `glab issue close <n> -R <project>`. Reopen: `glab issue reopen <n> -R <project>`. Status label: `glab issue update <n> -R <project> --label "workflow::<new>" --unlabel "workflow::<old>"` | A scoped label (`key::value`) replaces the old value of the same scope. |
| `tracker.link` | `glab api --hostname <host> -X POST projects/<enc>/issues/<n>/links -f target_project_id=<enc> -f target_issue_iid=<other> -f link_type=relates_to` | `link_type`: `relates_to`, `blocks`, `is_blocked_by`. A link to a URL: post a comment with `tracker.comment`. |

## 🩺 Failures

| Error | Cause | Fix |
|---|---|---|
| `401 Unauthorized` | No login or an expired token | The user runs `glab auth login --hostname <host>`. |
| `404 Not Found` | Wrong `tracker.project`, wrong host, or no access | Check `tracker.project` and `GITLAB_HOST`. |
| An error on `link_type=blocks` or `is_blocked_by` | Blocking links need a paid GitLab tier | Use `relates_to`. |
| Label has no effect | The label does not exist in the project or group | Ask the user to create it. Do not create labels yourself. |
