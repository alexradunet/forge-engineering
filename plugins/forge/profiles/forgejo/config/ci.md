---
provider: forgejo-actions
host: forgejo.example
---

# ⚙️ Forgejo Actions (`tea`)

> forge reads this file as `config/ci.md`. `forge-setup` copies it from `profiles/forgejo/config/`. It holds the values of the Forgejo profile.
> `ci.<key>` below means the frontmatter key `<key>` of this file.

Tools: tea 0.14 or later.

Run each command in a checkout or a worktree of the repository. Outside of one, add `--repo <owner>/<name> --login <login name>`.
`<workflow>` is the file name of a workflow, for example `ci.yml`.

## 🔐 Auth check

`tea whoami` in a checkout of the repository.

When it fails, ask the user to run `tea login add` for `https://<ci.host>`.

## 🧰 Capabilities

| Capability | Command | Notes |
|---|---|---|
| `ci.status` | `tea actions runs list --branch <branch> --limit 10 --output json` | One run: `tea actions runs view <run id> --output json`. |
| `ci.logs` | `tea actions runs logs <run id>` | Read the failed job first. One job: add `--job <job id>`. |
| `ci.trigger` | `tea actions workflows dispatch <workflow>` | Show the workflow and each input first. One run for each approval. Never dispatch without approval. |

## 🩺 Failures

| Error | Cause | Fix |
|---|---|---|
| `No gitea login configured`, or HTTP 401 | No login, or a token that is not valid | The user runs `tea login add`. |
| No run for the commit | The runner on the server is down, or the repository has no workflow | Ask the user to check the runner and the workflows. |
| The workflow cannot start by hand | The workflow has no `workflow_dispatch` trigger | Push a commit, or ask the user to add the trigger. |
