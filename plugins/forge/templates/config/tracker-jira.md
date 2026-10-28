---
provider: jira
host: example.atlassian.net
project: ABC
prefix: ABC
itemUrl: https://example.atlassian.net/browse/{KEY}
---

# 🟦 Jira Cloud (`acli`)

> forge reads this file as `config/tracker.md`. `forge-setup` copies it from `templates/config/`. Edit the frontmatter values first.
> Then change a command when your team uses another tool. `tracker.<key>` below means the frontmatter key `<key>` of this file.

Tools: acli (Atlassian CLI). Fallback: the Atlassian remote MCP server.

Use the Atlassian CLI `acli` for every capability (see the `forge` rule, "Tool choice: CLI first").
Use the Atlassian remote MCP server (`https://mcp.atlassian.com/v2/mcp`) only for the cases in the **MCP fallback** column.
A fork that needs it registers it as `jira` in its `mcp.json`.

- `<site>` is `tracker.host`, for example `example.atlassian.net`.
- `<KEY>` is already a Jira key (`ABC-123`).
- MCP fallback only: pass `https://<site>` as `cloudId`. When a tool rejects it, call `getAccessibleAtlassianResources` once, and use the `id` of the matching site. Read the tool schema for the parameter names. Do not guess them.

## 🔎 Queries

Named searches for `tracker.search`, in the syntax of the tool. The `meeting` and `ticket` skills use them by name.

| Name | Query |
|---|---|
| `mine` | `assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC` |
| `team` | `project = ABC AND component = "Team A" AND statusCategory != Done ORDER BY updated DESC` |

## 🔐 Auth check

`acli jira auth status`. When it fails, ask the user to run `acli jira auth login --web`
(or `--site <site> --email <email> --token` with the token on standard input).

## 🔑 Keys

The key is the native id. Its URL is `https://<site>/browse/<KEY>` (or `tracker.itemUrl`).

## 🧰 Capabilities

| Capability | `acli` command | MCP fallback | Notes |
|---|---|---|---|
| `tracker.fetch` | `acli jira workitem view <KEY> --fields "*all" --json`, then `acli jira workitem comment list --key <KEY> --json` | — | Ask only for the fields that you need when the item is large. |
| `tracker.search` | `acli jira workitem search --jql "<query>" --fields "key,summary,status,updated" --json --limit 50` | — | `<query>`: a named JQL query from `tracker.queries`. Ask for few fields. |
| `tracker.comment` | `acli jira workitem comment create --key <KEY> --body-file <body file>` | `addOrEditJiraIssueComment` (Markdown body) | `acli` takes plain text or ADF, not Markdown. Use the MCP tool only when the comment needs formatting (headings, lists, links). |
| `tracker.transition` | `acli jira workitem transition --key <KEY> --status "<status>"` | `listJiraIssueTransitions`, then `transitionJiraIssue` | `acli` cannot list transitions. When the status name is not known, ask the user, or use the MCP tool to list them. |
| `tracker.link` | `acli jira workitem link create --out <KEY> --in <other> --type "<link type>"` | `createJiraIssueRemoteIssueLink` for a URL | Link types: `acli jira workitem link type`. `acli` cannot add URL links. |

## 🩺 Failures

| Error | Cause | Fix |
|---|---|---|
| `acli` reports no login, or HTTP 401 | No login, or an expired token | The user runs `acli jira auth login --web`. |
| Issue not found | Wrong key, or no permission for the project | Check the key. Ask the user to check access. |
| Transition fails | The status is not reachable from the current status | Ask the user which status to use. |
| HTTP 401 from the MCP fallback | The API token is wrong or expired | The user renews the token (with the credential script of your fork), then restarts VS Code fully. |
