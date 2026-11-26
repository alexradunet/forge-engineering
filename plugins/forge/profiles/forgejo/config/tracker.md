---
provider: forgejo-issues
host: forgejo.example
prefix: FJ
---

# 🦎 Forgejo issues (`tea`)

> forge reads this file as `config/tracker.md`. `forge-setup` copies it from `profiles/forgejo/config/`. It holds the values of the Forgejo profile.
> `forge-setup` writes the host and the prefix of your server. `tracker.<key>` below means the frontmatter key `<key>` of this file.

Tools: tea 0.14 or later.

Run each command in a checkout or a worktree of the repository: `tea` reads the repository and the login from the Git remote.
Outside of one, add `--repo <owner>/<name> --login <login name>`. `<n>` is the issue number: the number part of `<KEY>`.

## 🔎 Queries

Named searches for `tracker.search`. The value is the options of `tea issues list`.

| Name | Query |
|---|---|
| `mine` | `--state open --assignee <your user>` |
| `team` | `--state open` |

## 🔐 Auth check

`tea whoami` in a checkout of the repository. It prints the user name.

When it fails, ask the user to run `tea login add` for `https://<tracker.host>`.

## 🔑 Keys

Forgejo gives an issue the number `#<n>`. forge needs a key with a prefix, so the key of issue `#<n>` is `FJ-<n>`.
When the user gives `#43` or an issue URL, use the key `FJ-43`. The URL of a key is `https://<tracker.host>/<owner>/<name>/issues/<n>`.

## 🧰 Capabilities

| Capability | Command | Notes |
|---|---|---|
| `tracker.fetch` | `tea issues <n> --comments --output json` | |
| `tracker.search` | `tea issues list <query> --limit 50 --output json` | `<query>`: a named query, or `--state all --keyword "<text>"`. Show each result as `FJ-<number>`. |
| `tracker.comment` | `tea comment <n> "$(cat <body file>)"` | The body is Markdown. |
| `tracker.transition` | `tea issues close <n>`, or `tea issues reopen <n>` | An issue is only open or closed. A label change is also a transition: `tea issues edit <n> --add-labels <label> --remove-labels <label>`. |
| `tracker.link` | `tea comment <n> "$(cat <body file>)"` with the line `Related: #<other n>` | Forgejo links an issue reference (`#<n>`) in a comment. |

## 🩺 Failures

| Error | Cause | Fix |
|---|---|---|
| `No gitea login configured`, or HTTP 401 | No login, or a token that is not valid | The user runs `tea login add`. |
| `Remote repository required` | The folder is not a checkout of the repository | Run the command in the checkout, or add `--repo <owner>/<name> --login <login name>`. |
| HTTP 404 | Wrong issue number | Check the number with `tracker.search`. |
