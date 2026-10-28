---
name: forge-setup
description: Set up, check, configure, or repair the forge plugin on this machine. Lists the full paths of the forge helper scripts (Install-Forge, Test-ForgeSetup, Get-ForgeConfig, Start-TicketBoard). Seeds the team config (config/tracker.md, repo.md, ci.md, policy.md) from templates for GitHub, GitLab, Jira, local Markdown, or another tool. Use when asked to "set up forge", "check forge", "configure forge", "switch the tracker to GitLab", "edit the forge config", when an MCP call returns 401, or when FORGE_WIKI_ROOT or FORGE_HOME is missing.
---

# 🔧 forge setup

The forge plugin carries rules, skills, scripts, and the team config.
Machine paths and credentials stay on the machine, outside the plugin.

## 📁 Where the scripts are

`<plugin>` is the folder two levels above this `SKILL.md`.
The scripts are in `<plugin>\scripts`. Always give the user the full,
resolved path in a copyable PowerShell command.

| Script | Use | Who runs it |
|---|---|---|
| `Install-Forge.ps1` | Set `FORGE_WIKI_ROOT` and `FORGE_HOME`, and register the plugin in VS Code | the user (`-WhatIf` first) |
| `Test-ForgeSetup.ps1` | Read-only check of the whole setup | the agent may run it |
| `Get-ForgeConfig.ps1` | Read the config files in `<config>` with defaults and checks; the skills use `.Config` | the agent |
| `Start-TicketBoard.ps1 [-Ticket <key>] [-Check] [-Restart] [-Stop]` | Local ticket board, ticket pages, and briefing; `-Check` validates ticket frontmatter (the `ticket` skill) | the agent |

The always-on rules are in `<plugin>\com.github.copilot\rules`. VS Code loads them natively.

## ✅ Check

1. Run `& '<plugin>\scripts\Test-ForgeSetup.ps1'`.
2. Report each `fail` and `warn` line with its fix.
3. Do not print or read credential values. The script shows only whether they are set.

## 🔑 Credential rules

- Never ask the user to paste a token or password into chat.
- The credential scripts prompt for the secret in a hidden prompt.
- After a credential script sets a user variable, VS Code must restart fully.
- A 401 from an MCP server means the token needs renewal. The `## Toolkit` section of `config\policy.md` names the credential script of each server.

## 🧭 New machine

1. Install the plugin: in VS Code, run `/plugin marketplace add alexradunet/forge-engineering`, then `/plugin install forge@forge`.
   Alternatively, search `@agentPlugins` in the Extensions view.
2. Clone your forge fork (it holds the team config) and the wiki repository. Daily recaps live in `<wiki>\raw\daily-recap`, which git does not track, so copy them from the old machine.
3. Run `& '<plugin>\scripts\Install-Forge.ps1' -Mode Marketplace -ForgeHome <clone> -WikiRoot <wiki>`.
4. If the fork has no team config yet, run **⚙️ Configure the team** below.
5. Run the credential scripts that the `## Toolkit` section of `config\policy.md` names.
6. Restart VS Code fully, then run `Test-ForgeSetup.ps1`.

## ⚙️ Configure the team

The team config is four Markdown files in `<config>` (`<forge-home>\plugins\forge\config`).
Templates are in `<plugin>\templates\config`. The `forge` rule explains how the skills read them.

1. Ask the user in one form which tools the team uses:
   - tracker: `github`, `gitlab`, `jira`, `local` (Markdown files in the wiki), or `other`
   - repository host: `github`, `gitlab`, or `other`
   - CI: `github-actions`, `gitlab-ci`, `jenkins`, `azure-pipelines`, or `other`
2. Show the files that change. Copy each template to `<config>\<kind>.md` after the user agrees. Copy `policy.md` only when it is missing.
3. Ask for the frontmatter values in a second form: `prefix`, `project`, `host`, `itemUrl`, `changeName`, `branchPattern`, `baseBranch`, and the policy values. Show the template value as the default.
4. Fill in the **Queries** table of `tracker.md` and the **Checkouts** table of `repo.md` with the user.
5. For `other`, ask how the team does each capability. Write the CLI command in the row (CLI first, then REST, then MCP), or keep `manual`.
6. Run `Test-ForgeSetup.ps1`. Fix each `config:` problem.
7. Tell the user to commit `<config>` in the fork. The config travels with the fork, not with the wiki.

Rules:

- Never put secrets in a config file. Credentials stay in user variables or in a CLI login (`gh auth login`, `glab auth login`).
- Write CLI commands in the capability rows. Add an MCP server to `<plugin>\mcp.json` only when no CLI or REST call can do the capability (see the `forge` rule, "Tool choice: CLI first"). Agent Plugins forbid `${ENV}` in a URL or a header, so such a server needs OAuth or a stdio wrapper.
- Company rules and tools go into the sections of `policy.md`, not into the core skills. Then upstream updates merge cleanly.
