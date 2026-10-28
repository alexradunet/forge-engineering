---
provider: jenkins
host: https://jenkins.example.com
---

# 🤵 Jenkins (REST with `curl.exe`)

> forge reads this file as `config/ci.md`. `forge-setup` copies it from `templates/config/`. Edit the frontmatter values first.
> Then change a command when your team uses another tool. `ci.<key>` below means the frontmatter key `<key>` of this file.

Tools: curl. Fallback: the Jenkins MCP server.

Jenkins has no simple official CLI, so forge uses its REST API with `curl.exe` (see the `forge` rule, "Tool choice: CLI first").
Use the Jenkins MCP server (the `mcp-server` Jenkins plugin, endpoint `<ci.host>/mcp-server/mcp`) only for the cases in the **MCP fallback** column.
The core does not ship it, because it needs a company URL and token. A fork that needs it registers it in its `mcp.json`.

`<job path>` is the job name. A job in a folder is `job/<folder>/job/<name>`.
`<auth var>` is the user environment variable with `base64(user:apiToken)` that your fork names (see `config/policy.md`, **Toolkit**).

## 🔐 Auth check

`curl.exe -s -o NUL -w "%{http_code}" -H "Authorization: Basic $env:<auth var>" <ci.host>/api/json` must print `200`.

## 🧰 Capabilities

| Capability | REST command | MCP fallback | Notes |
|---|---|---|---|
| `ci.status` | `curl.exe -s -H "Authorization: Basic $env:<auth var>" "<ci.host>/<job path>/lastBuild/api/json?tree=number,result,building,url"` | `getJob`, `getBuild` | Test results: `.../<build>/testReport/api/json?tree=failCount,passCount,skipCount`. |
| `ci.logs` | `curl.exe -s -H "Authorization: Basic $env:<auth var>" "<ci.host>/<job path>/<build>/consoleText" \| Select-String -Pattern "<text>" -Context 5` | `searchBuildLog`, then `getBuildLog` with a line range | Search the log before you read all of it. For the end of a log, use `\| Select-Object -Last 200`. |
| `ci.trigger` | `curl.exe -s -X POST -H "Authorization: Basic $env:<auth var>" "<ci.host>/<job path>/buildWithParameters?<name>=<value>"` | `triggerBuild` | Show the job and every parameter first. One build for each approval. Never rebuild or replay without approval. |

## 🩺 Failures

| Error | Cause | Fix |
|---|---|---|
| HTTP 401 | The API token is wrong or expired | The user renews the token with the credential script of your fork, then restarts VS Code. |
| HTTP 403 | No permission, or a network block (VPN) | Check the VPN. Then ask the user to check the job permission. |
| HTTP 403 on a POST | The server wants a CSRF crumb | Get one from `<ci.host>/crumbIssuer/api/json`, and send it as the header that the reply names. |
| HTTP 404 | Wrong job path or build number | Open `<ci.host>/<job path>/api/json` to check the path. |
