---
provider: gitlab-ci
---

# 🦊 GitLab CI (`glab ci`)

> forge reads this file as `config/ci.md`. `forge-setup` copies it from `templates/config/`. Edit the frontmatter values first.
> Then change a command when your team uses another tool. `ci.<key>` below means the frontmatter key `<key>` of this file.

Tools: glab.

`<remote>` is `group/app` from the checkout in `repo.checkouts` (the **Checkouts** table in `config/repo.md`).
On a self-managed host, set `$env:GITLAB_HOST = '<repo.host>'` in the same command.

## 🔐 Auth check

`glab auth status --hostname <repo.host or gitlab.com>`

## 🧰 Capabilities

| Capability | Command | Notes |
|---|---|---|
| `ci.status` | `glab ci get -R <remote> -b <branch> --with-job-details -F json` | For an MR: `--merge-request <n>` instead of `-b`. Do not combine `-F json` with `glab ci status --live`, `--wait`, or `--compact`. |
| `ci.logs` | `glab ci trace <job id> -R <remote> \| Select-Object -Last 200` | Get the job id from `ci.status`. The command streams a running job; read finished jobs. |
| `ci.trigger` | `glab ci run -R <remote> -b <branch> [--variables <name>:<value>]` | Show the branch and every variable first. One pipeline for each approval. A manual job: `glab ci trigger <job id> -R <remote>`. |

## 🩺 Failures

| Error | Cause | Fix |
|---|---|---|
| `401 Unauthorized` | No login or an expired token | The user runs `glab auth login --hostname <host>`. |
| No pipeline in the result | No pipeline ran for this branch | Push the branch, or check the CI rules in `.gitlab-ci.yml`. |
| `403 Forbidden` on `ci run` | No permission to run pipelines on this branch | Ask the user to check the role or the protected branch. |
