---
provider: local
prefix: ITEM
---

# 📝 Local work items (Markdown files)

> forge reads this file as `config/tracker.md`. `forge-setup` copies it from `templates/config/`. Edit the frontmatter values first.
> Then change a command when your team uses another tool. `tracker.<key>` below means the frontmatter key `<key>` of this file.

Tools: PowerShell and the file system. No account, no server.

Each work item is one Markdown file: `<wiki>\items\<KEY>.md`, for example `ITEM-7.md`.
The items travel with the wiki repository. Use this tracker when the team has no tracker yet,
or for personal work.

```markdown
---
key: ITEM-7
title: Export fails for empty invoices
status: open
labels: [bug]
links: []
created: 2026-01-31
---

What happens, what should happen, and how to reproduce it.

## 💬 Comments

### 2026-02-01
Text of the comment.
```

- `status` is `open`, `in-progress`, or `closed`. A team can add more values here.
- `links` holds keys or URLs of related items and change requests.

## 🔎 Queries

Named searches for `tracker.search`: regular expressions for the frontmatter lines of the item files.

| Name | Query |
|---|---|
| `mine` | `^status: (?!closed)` |
| `team` | `^status: open$` |

## 🔐 Auth check

`Test-Path "$env:FORGE_WIKI_ROOT\items"`. If it is false, create the folder after the user agrees.

## 🔑 Keys

- Key → file: `ITEM-7` → `<wiki>\items\ITEM-7.md`.
- A new item gets the next free number: the highest number in `<wiki>\items` plus 1.

## 🧰 Capabilities

These writes change only files in the wiki on this machine. Show the change, and record it in the ticket `log.md`.

| Capability | Command | Notes |
|---|---|---|
| `tracker.fetch` | Read `<wiki>\items\<KEY>.md` | The body is the description. **💬 Comments** holds the comments. |
| `tracker.search` | `Select-String -Path "$env:FORGE_WIKI_ROOT\items\*.md" -Pattern '<query>' -List` | `<query>`: a named query. Read the title of each match. |
| `tracker.comment` | Append `### <date>` and the text at the end of **💬 Comments** | Keep older comments unchanged. |
| `tracker.transition` | Set `status:` in the frontmatter | Add a comment that names the reason. |
| `tracker.link` | Add the key or URL to `links:` in the frontmatter | Add the reverse link in the other item file too. |

## 🩺 Failures

| Error | Cause | Fix |
|---|---|---|
| File not found | Wrong key, or the item does not exist | List `<wiki>\items` and check the key. |
| Invalid frontmatter | A YAML mistake in the item file | Fix the YAML. Keep the keys above. |
