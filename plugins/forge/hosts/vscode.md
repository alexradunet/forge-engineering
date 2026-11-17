# Forge host: VS Code Agents window

This session runs in the VS Code Agents window, with the Copilot harness and the Agent Host. Write every answer for that window.

## Host verbs

A Forge skill names a host verb, for example `host.title`. Do the step of the verb in this table.

| Verb | Step in VS Code |
|---|---|
| `host.title` | Call `rename_chat` (without `automatic`) with the title. In a ticket session, call it again with the same title at the end of the first turn (before `set_workspace` when that is the last call): VS Code can generate a title after the first prompt and replace an early one. `rename_chat` removes a final `?` and cannot rename an archived session. To rename another chat, give the link of that chat. |
| `host.ask` | Call `ask_user` with a form. When `ask_user` says that the user is not available, treat it as no answer. |
| `host.move` | Call `set_workspace` with `workspaceFolder` set to the folder and `isolation: false`, as the last tool call of the turn. It moves the chat to the folder and keeps its history, title, and group. `isolation: true` makes a second worktree that VS Code manages: never use it for a Forge worktree. The host then sends "Continue in the requested workspace.", and the chat continues with the next step in the new folder. When `ask_user` says that the user is not available, call `set_workspace` only if a message from the user asks for the move. Otherwise give the folder path and tell the user to say "move this chat to <folder>". Just before each call, ask one question with `ask_user` that confirms the folder and `isolation: false`. Tool approval is not that confirmation. |
| `host.spawn` | Call `create_session` with `workspace` (the folder), `title`, and the prompt. For a new ticket session or an unrelated task, always give `relationship: independent`: without it, VS Code makes a nested chat in the current session. Omit it only for an implementer of the current ticket. Give `worktree: false` for an existing verified worktree. `worktree: true` makes a new VS Code worktree, without a base-branch option. The new session loads the plugin skills and runs the Forge `sessionStart` hook. It gets no `AGENTS.md` text of the repository, and it can start without MCP servers. |
| `host.message` | Call `send_message` with `delivery: queue`. Use `steer` only to correct the active turn. VS Code asks the user to confirm each message. It does not wait for a reply: do not poll. |
| `host.sessions` | Call `list_sessions` (filters: `status: ["inputNeeded"]` for blocked sessions, `includeArchived: true` for all), then `get_session_context` with `detail: summary` for the sessions that matter. `delete_session` cannot be undone. |
| `host.groups` | Read the groups with `readSessionsList`. Set the groups and the pins with `organizeSessionsList`. |
| `host.artifact` | Call `add_artifact_or_reference` with a `file:///` URI for a file. |
| `host.open` | Run `code -r "<absolute path>"` with the shell tool in `async` mode: the command can block for 30 seconds or more. Open at most 3 documents at once, and give a link for each other file. |
| `host.comments` | Read the comment threads of a document with `listComments`. Answer a question with `replyToComment`. Resolve a handled thread with `resolveComments`. Comments that the user sends with the comment submit button (`/act-on-feedback`) arrive the same way. |
| `host.write` | Ask with `ask_user` first, and run the write command only after an explicit "yes": no check has shown yet that the plugin hook runs in a Copilot harness session. When `ask_user` says that the user is not available, give the user the exact command. |
| `host.automation` | Use `configureAutomation` to create or change an automation, `listAutomations` for the IDs and the models, and `runAutomation` for a test run. |

## Ticket canvas

The ticket canvas is a local HTML page (`canvas.html` in the ticket folder, from `forge.mjs canvas <KEY>`).

- Give the user the `file://` link, and this step: in the Explorer, right-click `canvas.html` and select **Open in Integrated Browser**. The address bar of the integrated browser also accepts the `file://` link.
- Tell the user one time to turn on `workbench.browser.autoReloadOnFileChange`. Then the page loads again after each `canvas` run.
- The board page (`board.html` in `<wiki>/raw`, from `forge.mjs board`) shows all tickets. The board page and each canvas have links to each other. Open it the same way. The user can make it a favorite with the star in the address bar of the integrated browser.
- The first **Copy all** on the page can ask for the clipboard permission of the site. The page also shows the text for a manual copy.
- For comments, run `forge.mjs canvas <KEY> --serve` with the shell tool in `async` mode, and give the `http://127.0.0.1` link from its output. VS Code opens the link in the integrated browser. When the user selects **Send to agent**, the command prints the comment message and stops. Tell the user to write `sent` if the session does not continue. Then read the output of the command.
- The link works only in a browser on the machine of the session. For a browser on another machine, run it with `--port <n>`, and tell the user to forward that port. Never use another address than `127.0.0.1`.
- For a comment on one element of a page, the user can also use **Add Element to Chat** in the toolbar of the integrated browser. It is native, but it gives no ticket file and no section.
- A code link on the page opens the file in VS Code (`vscode://file/...`).
- Do not use the native canvas tools of VS Code for the ticket canvas. They run only in a Copilot harness session, and the page must be the same in each host.

## VS Code features

- Give UI steps for the Agents window: the sessions list, the Changes panel, **Chat: Open Customizations**, and Command Palette commands.
- VS Code changes each month. Your memory of a VS Code feature can be old.
- Before you advise on, configure, or change a VS Code feature, read its current documentation page. This applies to sessions, worktrees, automations, agent plugins, MCP servers, settings, and harnesses.
- Once per session, before the first such step, read the latest release notes. Check for changes to the feature.
- When the documentation and a forge file do not agree, follow the documentation. Tell the user the forge file and the difference.
- Prefer a native feature (session tools, artifacts, automations, hooks, custom agents) to a Forge workaround.

| Topic | Documentation |
|---|---|
| Release notes (latest version) | https://code.visualstudio.com/updates |
| Agents window | https://code.visualstudio.com/docs/agents/run/agents-window |
| Agent Host | https://code.visualstudio.com/docs/agents/concepts/agent-host |
| Automations | https://code.visualstudio.com/docs/agents/run/automations |
| Agent harnesses | https://code.visualstudio.com/docs/agents/run/agent-harnesses |
| Agent plugins | https://code.visualstudio.com/docs/agent-customization/agent-plugins |
| Agent plugin reference (agents, hooks, automation templates) | https://code.visualstudio.com/docs/agents/reference/agent-plugin-reference |
| Manage sessions (groups, pins, move a chat, cleanup) | https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions |
| Session tools (coordinate work across sessions) | https://code.visualstudio.com/docs/agents/run/tools |
| Artifacts panel | https://code.visualstudio.com/docs/agents/run/artifacts |
| Integrated browser (the ticket canvas) | https://code.visualstudio.com/docs/debugtest/integrated-browser |
| Hooks | https://code.visualstudio.com/docs/agent-customization/hooks |
| Custom agents | https://code.visualstudio.com/docs/agents/reference/custom-agent-file-reference |
| Custom instructions and AGENTS.md | https://code.visualstudio.com/docs/agent-customization/custom-instructions |
