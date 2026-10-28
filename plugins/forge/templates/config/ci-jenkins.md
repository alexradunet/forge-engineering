---
provider: jenkins
host: https://jenkins.example.com
---

# 🤵 Jenkins (REST with `jenkins.mjs`)

> forge reads this file as `config/ci.md`. `forge-setup` copies it from `templates/config/`. Edit the frontmatter values first.
> Then change a command when your team uses another tool. `ci.<key>` below means the frontmatter key `<key>` of this file.

Tools: Node.js. No Jenkins CLI and no MCP server.

Jenkins has no simple official CLI. forge calls its REST API with `<plugin>/scripts/jenkins.mjs` (see the `forge` rule, "Tool choice: CLI first").
The script reads `ci.host` from this file, and the token from the OS credential store.

- `<J>` below means `node "<plugin>/scripts/jenkins.mjs"`.
- `<job path>` is the job name. A job in a folder is `<folder>/<name>`, or `job/<folder>/job/<name>`.
- The credential `jenkins` holds `user:apiToken`. The user stores it once: `node "<plugin>/scripts/cred.mjs" set jenkins`.
- A second Jenkins server: add `--host <url> --cred <name>` to each command.

## 🔐 Auth check

`<J> check` must print `ok`.

## 🧰 Capabilities

| Capability | Command | Notes |
|---|---|---|
| `ci.status` | `<J> status <job path> [--build <n>]` | Test results: `<J> tests <job path> <build>`. |
| `ci.logs` | `<J> logs <job path> <build> --grep "<text>" [--context 5]` | Search the log before you read all of it. The end of a log: `<J> logs <job path> <build> --tail 200`. |
| `ci.trigger` | `<J> trigger <job path> [<name>=<value> ...]` | Show the job and every parameter first. One build for each approval. Never rebuild or replay without approval. |

## 🩺 Failures

| Error | Cause | Fix |
|---|---|---|
| `cred-absent` | No token in the credential store | The user runs `node "<plugin>/scripts/cred.mjs" set jenkins`. |
| HTTP 401 | The API token is wrong or expired | The user creates a new API token in Jenkins and runs `cred.mjs set jenkins` again. No restart is needed. |
| HTTP 403 | No permission, or a network block (VPN) | Check the VPN. Then ask the user to check the job permission. |
| HTTP 404 | Wrong job path or build number | Check the path with `<J> status <job path>`. |
