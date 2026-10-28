---
provider: github-actions
---

# ⚙️ GitHub Actions (`gh`)

> forge reads this file as `config/ci.md`. `forge-setup` copies it from `templates/config/`. Edit the frontmatter values first.
> Then change a command when your team uses another tool. `ci.<key>` below means the frontmatter key `<key>` of this file.

Tools: gh.

`<remote>` is `owner/repo` from the checkout in `repo.checkouts` (the **Checkouts** table in `config/repo.md`).

## 🔐 Auth check

`gh auth status --hostname <repo.host or github.com>`

## 🧰 Capabilities

| Capability | Command | Notes |
|---|---|---|
| `ci.status` | For a PR: `gh pr checks <n> -R <remote> --json name,state,bucket,workflow,link`. For a branch: `gh run list -R <remote> -b <branch> -L 10 --json databaseId,workflowName,status,conclusion,headSha,url` | `bucket`: `pass`, `fail`, `pending`, `skipping`, `cancel`. |
| `ci.logs` | `gh run view <run id> -R <remote> --log-failed` | One job: `gh run view <run id> -R <remote> --job <job id> --log`. Keep the last 200 lines: `\| Select-Object -Last 200`. |
| `ci.trigger` | `gh workflow run <workflow file or name> -R <remote> -r <branch> [-f <input>=<value>]` | Only for workflows with `workflow_dispatch`. Rerun failed jobs: `gh run rerun <run id> -R <remote> --failed`. |

## 🩺 Failures

| Error | Cause | Fix |
|---|---|---|
| `could not find any workflows named` | Wrong name, or the file is not on the default branch | Run `gh workflow list -R <remote>`. |
| `Workflow does not have 'workflow_dispatch' trigger` | The workflow cannot start by hand | Push a commit, or ask the user to add the trigger. |
| HTTP 403 or 404 on logs | No access to Actions in this repository, or the logs passed the retention period | Ask the user to check the repository access. Expired logs are gone; rerun only with approval. |
