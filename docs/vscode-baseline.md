# 🧾 VS Code baseline

Forge was last checked against these VS Code versions and docs.
Update this page with each Forge change (see [AGENTS.md](../AGENTS.md)).

| Item | Value |
|---|---|
| Docs and release notes read | 1.145 (released 2026-11-04) |
| Installed and used for the click-checks | 1.144.0, and 1.145.0 for click-check 5 |
| Checked on | 2026-11-05 |
| Forge version | 5.0.0 |

## 🗓️ Release notes read

| Version | Forge impact |
|---|---|
| 1.145 | Local automations accept cron schedules (the Forge templates use them) and custom agents from the workspace. The agent list also shows the plugin agent **Forge Master**, but a run with it fails (click-check 5). The chat **View Mode** has a **Conversation** mode (`chat.persistentProgressVerbosity`, Experimental) that keeps long chats short to read. Forge does not use canvases, nested sessions with mixed harnesses, or the Local harness tools that 1.145 removes (`#installExtension`, `#runCommand`, `#newWorkspace`). |
| 1.144 | The plan for Forge 5.0 used these docs: agent plugin reference, session tools, move a chat, artifacts, hooks, custom agents, and automations. |

## 🧩 Native features that Forge uses

| Feature | Forge use | Doc |
|---|---|---|
| Agent plugin (Agent Plugins 1.0) | `plugin.json`, `skills/`, `com.github.copilot/` (hooks, agents), `automations/` | [Agent plugin reference](https://code.visualstudio.com/docs/agents/reference/agent-plugin-reference) |
| Session title (`rename_chat`) | `<KEY> - <emoji> - <short>` for each ticket session | [Manage sessions](https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions) |
| Move a chat (`set_workspace`) | A Folder session moves into the new ticket worktree (`workspaceFolder` and `isolation: false`) | [Manage sessions](https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions) |
| Session tools | `create_session`, `list_sessions`, `get_session_context`, `send_message` for implementers and the Forge Master | [Tools](https://code.visualstudio.com/docs/agents/run/tools) |
| Sessions list | Pins and custom state groups (`organizeSessionsList`) | [Manage sessions](https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions) |
| Artifacts panel | The ticket README (📍 Now) and the open gate doc | [Artifacts](https://code.visualstudio.com/docs/agents/run/artifacts) |
| `sessionStart` hook | Each session gets the paths, the `forge` and `style` rules (`plugins/forge/context/`), and the approved company rules of `<wiki>/rules/`. A ticket session also gets the Now card and the title rule. | [Hooks reference](https://code.visualstudio.com/docs/agents/reference/hooks-reference) |
| Custom agent | **Forge Master** (`com.github.copilot/agents/forge-master.agent.md`) | [Custom agent file reference](https://code.visualstudio.com/docs/agents/reference/custom-agent-file-reference) |
| Automation templates | **Forge maintenance** and **Prepare my daily** | [Automations](https://code.visualstudio.com/docs/agents/run/automations) |
| `ask_user` forms | Gate approvals with the ⚡ 1 min card | [Tools](https://code.visualstudio.com/docs/agents/run/tools) |
| `AGENTS.md` | This repository's developer rules (the Copilot harness reads it at the repository root) | [Custom instructions reference](https://code.visualstudio.com/docs/agents/reference/custom-instructions-reference) |

## 🛠️ Forge parts and why not native

| Forge part | Why not native |
|---|---|
| `forge.mjs worktree` names | A VS Code worktree branch starts with `agents/`, and `create_session` has no branch name or base (microsoft/vscode#321685). Forge needs `repo.branchPattern`. |
| `git branch -m` in a New Worktree session | The same reason. After the rename, **Mark as Done** leaves the worktree (click-check 3), so close checks `git worktree list`. |
| `isolate_session` is not the default | It makes a native worktree, but Forge cannot set its folder or branch name. Click-check 2. |
| Gate approvals with SHA-256 manifests | A native plan approval does not cover a set of exact revisions. |
| Reading levels and `forge.mjs diff` | No native "changed since your last review" exists for wiki files. |
| `forge.mjs board` and `raw/board.md` | The sessions list shows sessions, not ticket state from the wiki. Forge removed its canvas in 5.0. |
| Sync notes in `raw/sync/` | No native cache of tracker, change request, and CI status exists. |
| Title rule: rename first, then again at the end of the first turn | An automatic title can replace a title that was set (microsoft/vscode#338122). |
| Rules in the `sessionStart` hook context, not in `com.github.copilot/rules/` | Plugin rule files loaded in some sessions only (click-check 11). The docs give no always-on format for plugin rules. `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` is global for all repositories, and the CLI does not read `chat.instructionsFilesLocations`. The hook runs in each session, also in `create_session` and custom agent sessions. |
| Company rules in `<wiki>/rules/` with hash trust | The native `AGENTS.md` and `.github/instructions` must be in the workspace. The wiki is a sibling folder, and a Midgard checkout must not change for Forge. A Git pull cannot approve its own rules. |
| Forge Master without a `tools` list | The Copilot `tools` aliases cannot name the session tools. The "no code edits" limit is a written rule. Click-check 9. |

## ⚠️ Known gaps

| Issue | Gap | Forge workaround |
|---|---|---|
| [microsoft/vscode#321685](https://github.com/microsoft/vscode/issues/321685) | No setting for the worktree branch prefix. | `forge.mjs worktree` and `git branch -m`. |
| [microsoft/vscode#338122](https://github.com/microsoft/vscode/issues/338122) | An automatic `rename_chat` can replace a title that was set. | Rename again at the end of the first turn. The Forge Master and the maintenance automation fix stale titles. |
| No issue found | A local automation with a plugin agent (**Forge Master**) runs in `~/.copilot/chats/<id>`, not in the workspace, and without the agent instructions (click-check 5, 1.145.0). | Create Forge automations with the default **Agent**. The template prompt has all the steps. |
| No issue found | Plugin rule files (`*.instructions.md`) do not load in each session (click-check 11). | The `sessionStart` hook gives the rules. Each skill tells the agent to read `context/forge.md` and `context/style.md` when the rules are missing. |

## 🧪 Click-checks

Some behavior is not in the docs. Check it in the Agents window, then write the result here.
When a check fails, use the fallback.

| # | Check | Result | Fallback |
|---|---|---|---|
| 1 | `set_workspace` moves a Folder session into a `git worktree add` folder. Check the label, the group, the history, and the isolation. | ✅ Pass. Both parameters are necessary: `workspaceFolder` and `isolation` (`false` for a Forge worktree). The chat keeps its history, title, and group. The host sends "Continue in the requested workspace." and the chat continues in the new folder. `ask_user` can say "user not available"; the skill then moves only on a request from the user. | Tell the user to open a new session in the worktree folder. |
| 2 | `isolate_session` ("Continue in a new Git worktree"): which folder and branch names does it make? Can Forge rename the branch? | ❌ Fail. The tool has no parameters, so Forge cannot set the folder or the branch. | Keep `forge.mjs worktree --create`. |
| 3 | `git branch -m` in a VS Code worktree, then **Mark as Done**: does VS Code still remove the worktree? | ❌ Fail. The session is archived, but the clean worktree and its branch stay. The docs say that Mark as Done does not guarantee removal. No control test without the rename was done. | Close removes the worktree with `git worktree remove` after a "yes". |
| 4 | Does a session from `create_session` load the plugin rules and skills? | ⚠️ Partial. It lists the 6 forge skills. It cannot answer facts that only the `forge` rule, the `style` rule, or `AGENTS.md` give, also after a file read. Its prompt must carry the rules (the `agents` skill). | The prompt is self-contained (the `agents` skill). |
| 5 | Does an automation run have the session tools? Can a local automation select the plugin agent **Forge Master** (1.145 "custom agents from the workspace")? | ⚠️ Partial (2026-11-05, 1.145.0). **Templates from Plugins** shows both Forge templates. For Midgard, the agent list shows **Agent** and **Forge Master**. With **Forge Master**, the maintenance run worked in `~/.copilot/chats/<id>` and stopped at step 1 (no Git repository), and a probe run said that it was the default agent. That probe run had `list_sessions`, `get_session_context`, `rename_chat`, and `create_session`, but not `organizeSessionsList`. With **Agent**, the run worked in the Midgard folder and did all 8 steps, but `organizeSessionsList` was also not available. The run read only part of the lint output and searched the READMEs for `waiting`. | Select **Agent**. Without `organizeSessionsList`, the run lists the stale titles and groups in its report. `board --json` now gives the people `waits`, and the template tells the run to report the lint `summary` counts. An agent can create the automation with `configureAutomation` (workspace target, `isolation: folder`). With the default permission level, the run stopped at its first terminal command, and `runAutomation` returns `already_running` until that run ends. Select **Allow all** (`autoApprove`) for runs without the user. `list_sessions` hides archived sessions unless `includeArchived: true`, and `rename_chat` fails on an archived session ("Cannot persist list-visible state for unknown session"), also outside an automation. The run reports these sessions. |
| 6 | Does the plugin `sessionStart` hook run in the Agents window? Which input does it get (cwd, session id)? | ✅ Pass. The context arrives at session start. Two installed copies of the plugin run the hook two times: keep one enabled. A ticket with `branch: main` matched every Folder session on `main`. The hook now ignores base branches and the main checkout for the match. In a session the hook took 2 to 21 s, and one run stopped at the old 10 s limit. The limit is now `timeoutSec: 30` (the documented default). | The `forge` rule and the `ticket` skill give the same steps. |
| 7 | Does `rename_chat` on a new chat update the session row and keep the title after the first turn? | ✅ Pass. During the first turn the row can show the prompt text. After the turn it shows the title, also after a `set_workspace` move. | Rename again at the end of the first turn. |
| 8 | Does the artifacts panel open a `file:///` wiki file outside the workspace? | open | Give the file link in the chat. |
| 9 | Does the **Forge Master** show in the agent picker with the session tools? Can `organizeSessionsList` pin a session? | ✅ Pass. It finds the session tools with tool search and calls `rename_chat`. `organizeSessionsList` moves a session `to: "pinned"` and makes, renames, nests, and deletes groups. | The user pins the session. |
| 10 | Does **Chat: Open Customizations** list this repository's `AGENTS.md`? | ✅ Pass. The `AGENTS.md` text is in the instructions of a Copilot harness chat. A `create_session` session does not have it (check 4). | Copy the 5 checks into `.github/copilot-instructions.md`. |
| 11 | Does a session that the user starts in the Agents window know the facts in the `forge` and `style` rules (then in `com.github.copilot/rules/`)? The docs do not say when plugin rules load. | ⚠️ Not reliable. Some sessions had the rule text. Many did not, including the check 11 session, which answered "unknown" to all 3 questions. Some sessions also had no `AGENTS.md` text. The cause is not known. After a VS Code restart with one `forge` copy, a `create_session` session had the skills and `AGENTS.md`, but no rule text. Its hook ended without a time-out. | Done in 5.0: the rules moved to `plugins/forge/context/`, and the hook gives them (check 12). |
| 12 | After a plugin reload, does a new session in forge-engineering and in Midgard get the full hook context: the paths, `# forge plugin`, `# forge style`, and the company rules after trust? Ask the 3 questions of check 11, then read `hook.end` in `events.jsonl`. | ✅ Pass (2026-11-05). In both repositories the hook ended with success and gave about 14,000 characters. Both sessions gave the plugin path and `<wiki>/AGENTS.md`. forge-engineering also said "5 checks". The Midgard session quoted the "not approved" note, which is the last line of the context, so the text was not cut. `events.jsonl` keeps the hook text only in `hook.end`, not in `system.message`. | Each skill tells the agent to read `context/forge.md` and `context/style.md`. |
| 13 | After the company rules moved to `<wiki>/rules/` and trust approval, does a new Midgard session (`create_session`, no worktree) get the rule pages? Ask which credential rndjenkins uses, if it can read the build log of "Get - Temporary access to database", and where the company rules are. | ✅ Pass (2026-11-05). The session said `jenkins` (from `rules/toolkit.md`), "No" with the reason from `rules/data.md`, and the `rules` folder of the Midgard wiki. It did not read files or run tools. | `forge.mjs trust` lists each rule page, and the hook names each page that is not approved. |

## 📚 Doc pages

Add `.md` to each URL to get Markdown. The index is https://code.visualstudio.com/llms.txt.

- https://code.visualstudio.com/updates
- https://code.visualstudio.com/docs/agents/run/agents-window
- https://code.visualstudio.com/docs/agents/reference/agent-plugin-reference
- https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions
- https://code.visualstudio.com/docs/agents/run/tools
- https://code.visualstudio.com/docs/agents/run/artifacts
- https://code.visualstudio.com/docs/agents/run/automations
- https://code.visualstudio.com/docs/agents/reference/hooks-reference
- https://code.visualstudio.com/docs/agents/reference/custom-agent-file-reference
- https://code.visualstudio.com/docs/agents/reference/custom-instructions-reference
