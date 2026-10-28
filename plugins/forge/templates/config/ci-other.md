---
provider: other
---

# 🧩 CI: other (fill in your tool)

> forge reads this file as `config/ci.md`. `forge-setup` copies it from `templates/config/`. Edit the frontmatter values first.
> Then change a command when your team uses another tool. `ci.<key>` below means the frontmatter key `<key>` of this file.

Use this template when the team has no CI, or a CI without a forge template, for example CircleCI or TeamCity.
Until a row has a command, forge uses the manual step (see the `forge` rule, "Manual step").

1. Set `provider` to the name of your CI, in lower case. Add keys such as `host` when the commands need them.
2. Replace `manual` in each row with the CLI command. Use the REST API when no CLI exists, and an MCP server only as the last choice (see the `forge` rule, "Tool choice: CLI first").

## 🔐 Auth check

`manual`: ask the user to confirm that they can open the CI web UI.

## 🧰 Capabilities

| Capability | Command | Notes |
|---|---|---|
| `ci.status` | `manual` | The result of the last run for a branch or change request. |
| `ci.logs` | `manual` | Ask the user for the failing step and its log lines. |
| `ci.trigger` | `manual` | Show the job and its parameters. One run for each approval. |

## 🩺 Failures

| Error | Cause | Fix |
|---|---|---|
| No CI run for the branch | The CI does not build this branch | Ask the user how the team runs the checks. |
