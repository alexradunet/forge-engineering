---
provider: azure-pipelines
host: https://dev.azure.com/example
project: Example
---

# 🔷 Azure Pipelines (`az pipelines`)

> forge reads this file as `config/ci.md`. `forge-setup` copies it from `templates/config/`. Edit the frontmatter values first.
> Then change a command when your team uses another tool. `ci.<key>` below means the frontmatter key `<key>` of this file.

Tools: az (azure-devops extension).

`<org>` is `ci.host`, for example `https://dev.azure.com/example`. `<project>` is `ci.project`.
Add `--org <org> -p <project> -o json` to every command below.

## 🔐 Auth check

`az pipelines runs list --top 1 --org <org> -p <project> -o json`

When it fails, ask the user to run `az login` (or `az devops login --org <org>` with a PAT). Install the extension with `az extension add --name azure-devops`.

## 🧰 Capabilities

| Capability | Command | Notes |
|---|---|---|
| `ci.status` | `az pipelines runs list --branch <branch> --top 10` | Fields: `id`, `definition.name`, `status`, `result`, `sourceVersion`. One run: `az pipelines runs show --id <run id>`. |
| `ci.logs` | 1. `az devops invoke --area build --resource logs --route-parameters project=<project> buildId=<run id>` 2. the same command with `logId=<log id>` | Step 1 lists the logs. Step 2 returns the lines of one log. Keep the last 200 lines. |
| `ci.trigger` | `az pipelines run --name <pipeline> --branch <branch> [--parameters <name>=<value>] [--variables <name>=<value>]` | Show the pipeline and every value first. One run for each approval. |

## 🩺 Failures

| Error | Cause | Fix |
|---|---|---|
| `Before you can run Azure DevOps commands, you need to run the login command` | No login | The user runs `az login`. |
| `'pipelines' is misspelled or not recognized` | The extension is missing | `az extension add --name azure-devops`. |
| `TF400813` or HTTP 401 | No access to the project | Ask the user to check the project permission. |
| `Pipeline ... not found` | Wrong name | `az pipelines list --org <org> -p <project> -o table`. |
