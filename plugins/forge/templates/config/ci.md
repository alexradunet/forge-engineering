---
provider: github-actions
host: github.com
---

# ⚙️ GitHub Actions (`gh`)

> forge reads this file as `config/ci.md`. `forge-setup` copies it from `templates/config/`. It holds the values of the GitHub profile.
> Change a shared value in the forge repository, so that each user gets it. `ci.<key>` below means the frontmatter key `<key>` of this file.

Tools: gh.

`<remote>` is `owner/repo` from the checkout in `repo.checkouts`. `<run id>` is the `databaseId` of a run.
`<workflow>` is the file name of a workflow, for example `ci.yml`.

## 🔐 Auth check

`gh auth status --hostname <ci.host>`

When it fails, ask the user to run `gh auth login --hostname <host>`.

## 🧰 Capabilities

| Capability | Command | Notes |
|---|---|---|
| `ci.status` | `gh run list -R <remote> -b <branch> -L 10 --json databaseId,workflowName,status,conclusion,headSha,url` | For a pull request: `gh pr checks <n> -R <remote>`. One run: `gh run view <run id> -R <remote> --json jobs,conclusion,url`. |
| `ci.logs` | `gh run view <run id> -R <remote> --log-failed` | Read the failed steps first. All steps: `--log`. One job: `gh run view -R <remote> --job <job id> --log`. |
| `ci.trigger` | `gh workflow run <workflow> -R <remote> -r <branch> [-f <name>=<value> ...]` | Show the workflow and each input first. One run for each approval. A rerun is also a trigger: `gh run rerun <run id> -R <remote> --failed`. Never rerun without approval. |

## 🩺 Failures

| Error | Cause | Fix |
|---|---|---|
| `gh auth login` required, or HTTP 401 | No login or an expired token | The user runs `gh auth login --hostname <host>`. |
| `could not find any workflows`, or HTTP 404 on a workflow | Wrong file name, or Actions is off | List the workflows: `gh workflow list -R <remote>`. |
| `Workflow does not have 'workflow_dispatch' trigger` | The workflow cannot start by hand | Push a commit, or ask the user to add the trigger. |
| HTTP 403 | No permission to start a workflow | Ask the user to check the repository permission. |
