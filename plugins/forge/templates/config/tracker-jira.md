---
provider: jira
host: example.atlassian.net
project: ABC
prefix: ABC
itemUrl: https://example.atlassian.net/browse/{KEY}
---

# 🟦 Jira Cloud

> forge reads this file as `config/tracker.md`. `forge-setup` copies it from `templates/config/`. Edit the frontmatter values first.
> Then change a command when your team uses another tool. `tracker.<key>` below means the frontmatter key `<key>` of this file.

Tools: jira MCP server (Atlassian remote MCP), acli.

Use the Atlassian remote MCP server (`https://mcp.atlassian.com/v2/mcp`), registered as `jira` in the `mcp.json` of your fork.
Without it, use the Atlassian CLI `acli`.

- `<site>` is `tracker.host`, for example `example.atlassian.net`. Pass `https://<site>` as `cloudId` to the MCP tools. When a tool rejects it, call `getAccessibleAtlassianResources` once, and use the `id` of the matching site.
- `<KEY>` is already a Jira key (`ABC-123`).
- The MCP server can show only its primary tools. Find the others with `discover`, then call them with `executeRead` or `executeWrite`.
- Read the tool schema for the parameter names. Do not guess them.

## 🔎 Queries

Named searches for `tracker.search`, in the syntax of the tool. The `meeting` and `ticket` skills use them by name.

| Name | Query |
|---|---|
| `mine` | `assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC` |
| `team` | `project = ABC AND component = "Team A" AND statusCategory != Done ORDER BY updated DESC` |

## 🔐 Auth check

- MCP: call `atlassianUserInfo`.
- CLI: `acli jira auth status`. When it fails, ask the user to run `acli jira auth login --web` (or `--site <site> --email <email> --token` with the token on standard input).

## 🔑 Keys

The key is the native id. Its URL is `https://<site>/browse/<KEY>` (or `tracker.itemUrl`).

## 🧰 Capabilities

| Capability | MCP tool | `acli` command | Notes |
|---|---|---|---|
| `tracker.fetch` | `getJiraIssue` (ask for Markdown output and the comments) | `acli jira workitem view <KEY> --fields "*all" --json`, then `acli jira workitem comment list --key <KEY> --json` | Ask only for the fields that you need when the item is large. |
| `tracker.search` | `searchJiraIssuesUsingJql` | `acli jira workitem search --jql "<query>" --fields "key,summary,status,updated" --json --limit 50` | `<query>`: a named JQL query from `tracker.queries`. Ask for few fields. Prefer JQL over Rovo search, which uses credits. |
| `tracker.comment` | `addOrEditJiraIssueComment` (Markdown body) | `acli jira workitem comment create --key <KEY> --body-file <body file>` | `acli` takes plain text or ADF, not Markdown. Use the MCP tool for formatted text. |
| `tracker.transition` | `listJiraIssueTransitions`, then `transitionJiraIssue` with the transition id | `acli jira workitem transition --key <KEY> --status "<status>"` | `acli` cannot list transitions. A wrong status name fails. |
| `tracker.link` | `createJiraIssueLink`. A URL: `createJiraIssueRemoteIssueLink` | `acli jira workitem link create --out <KEY> --in <other> --type "<link type>"` | Link types: `acli jira workitem link type`. `acli` cannot add URL links. |

## 🩺 Failures

| Error | Cause | Fix |
|---|---|---|
| HTTP 401 from the MCP server | The API token is wrong or expired | The user renews the token (with the credential script of your fork), then restarts VS Code fully. |
| `jira` tools are missing | The server is not loaded | Reload MCP servers, or restart the session. |
| Issue not found | Wrong key, or no permission for the project | Check the key. Ask the user to check access. |
| Transition fails | The status is not reachable from the current status | List the transitions. Ask the user which one to use. |
