---
provider: other
prefix: APP
itemUrl:
---

# 🧩 Tracker: other (fill in your tool)

> forge reads this file as `config/tracker.md`. `forge-setup` copies it from `templates/config/`. Edit the frontmatter values first.
> Then change a command when your team uses another tool. `tracker.<key>` below means the frontmatter key `<key>` of this file.

Use this template for a tracker without a forge template, for example Linear, YouTrack, or Azure Boards.
Until a row has a command, forge uses the manual step (see the `forge` rule, "Manual step").

1. Set `provider` to the name of your tool, in lower case.
2. Set `prefix` to the upper-case key prefix, and `itemUrl` to a URL with `{KEY}` or `{number}`.
3. Install the CLI of the tool. When it has no CLI, use its REST API (a pack script, see `docs/packs.md`). Use an MCP server only as the last choice, from your VS Code user settings.
4. Replace `manual` in each row with the CLI command (see the `forge` rule, "Tool choice: CLI first").

## 🔎 Queries

Named searches for `tracker.search`, in the syntax of the tool.

| Name | Query |
|---|---|
| `mine` | the open items assigned to me |
| `team` | the open items of my team |

## 🔐 Auth check

`manual`: ask the user to confirm that they are signed in to the tool.

## 🔑 Keys

- forge uses `PREFIX-number` keys. Write here how a native id becomes a key, and back.

## 🧰 Capabilities

| Capability | Command | Notes |
|---|---|---|
| `tracker.fetch` | `manual` | Title, description, status, labels, and comments of one item. |
| `tracker.search` | `manual` | Items that match a named query. |
| `tracker.comment` | `manual` | Add a comment. Returns the comment URL. |
| `tracker.transition` | `manual` | Change the status. |
| `tracker.link` | `manual` | Relate two items, or an item and a URL. |

## 🩺 Failures

| Error | Cause | Fix |
|---|---|---|
| 401 or "not signed in" | No login or an expired token | The user signs in again. |
