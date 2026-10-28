---
provider: jenkins
host: https://jenkins.example.com
---

# 🤵 Jenkins

> forge reads this file as `config/ci.md`. `forge-setup` copies it from `templates/config/`. Edit the frontmatter values first.
> Then change a command when your team uses another tool. `ci.<key>` below means the frontmatter key `<key>` of this file.

Tools: Jenkins MCP server (add it to `mcp.json` in your fork), curl.

Prefer the Jenkins MCP server (the official `mcp-server` Jenkins plugin, endpoint `<ci.host>/mcp-server/mcp`).
The core does not ship it, because it needs a company URL and token. A fork registers it in its `mcp.json`.
Without it, use the REST API with `curl.exe`.

`<job path>` is the job name. A job in a folder is `job/<folder>/job/<name>`.
`<auth var>` is the user environment variable with `base64(user:apiToken)` that your fork names (see `config/policy.md`, **Toolkit**).

## 🔐 Auth check

- MCP: call `whoAmI` (or `getStatus`) of the server.
- REST: `curl.exe -s -o NUL -w "%{http_code}" -H "Authorization: Basic $env:<auth var>" <ci.host>/api/json` must print `200`.

## 🧰 Capabilities

| Capability | MCP tool | REST fallback | Notes |
|---|---|---|---|
| `ci.status` | `getJob`, `getBuild` | `curl.exe -s -H "Authorization: Basic $env:<auth var>" "<ci.host>/<job path>/lastBuild/api/json?tree=number,result,building,url"` | Test results: `getTestResults`, or `.../<build>/testReport/api/json`. |
| `ci.logs` | `searchBuildLog` first, then `getBuildLog` with a line range | `curl.exe -s -H "Authorization: Basic $env:<auth var>" "<ci.host>/<job path>/<build>/consoleText" \| Select-Object -Last 200` | Search before you read a full log. |
| `ci.trigger` | `triggerBuild` | `curl.exe -s -X POST -H "Authorization: Basic $env:<auth var>" "<ci.host>/<job path>/buildWithParameters?<name>=<value>"` | Show the job and every parameter first. One build for each approval. Never `rebuildBuild` or `replayBuild` without approval. |

Read the MCP tool schema for the parameter names. Do not guess them.

## 🩺 Failures

| Error | Cause | Fix |
|---|---|---|
| HTTP 401 | The API token is wrong or expired | The user renews the token with the credential script of your fork, then restarts VS Code. |
| HTTP 403 | No permission, or a network block (VPN) | Check the VPN. Then ask the user to check the job permission. |
| HTTP 404 | Wrong job path or build number | List jobs with `getJobs`, or open `<ci.host>/<job path>/api/json`. |
| MCP tools missing | The server is not in `mcp.json`, or VS Code did not reload | Reload MCP servers, or restart the session. |
