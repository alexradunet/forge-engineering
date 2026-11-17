# 🤖 forge-engineering: rules for agents

This repository holds the `forge` agent plugin for the VS Code Agents window, GitHub Copilot CLI, and Claude Code.
It has a generic core and one profile, the GitHub profile: GitHub Issues, pull requests, and Actions with `gh`.

- The profile is `plugins/forge/templates/` and each file that `templates/profile.json` lists in `files`.
  Put each company value there: `profile.json` for the machine values, `profile.md` for the setup text, `config/` and `rules/` for the wiki copies.
- All other plugin files are the core. The core holds no company term (`terms` in `profile.json`). `tests/profile.test.mjs` checks this.
- One build has one profile. Do not add a provider choice.
Forge adapts to the code repository as it is: put each fix for a gap into forge.
Forge must stay as native to the Agents window as possible. VS Code changes each month,
so your memory of a VS Code feature can be old.

## 🔎 Docs first: do these 5 checks before each Forge change

1. **Release notes.** Read the latest notes at https://code.visualstudio.com/updates, and each
   release after the "Docs read" version in [docs/vscode-baseline.md](docs/vscode-baseline.md)
   (`https://code.visualstudio.com/updates/v1_<minor>`).
2. **Feature pages.** Read the current page of each feature that the change touches. Add `.md` to a
   docs URL to get Markdown, for example https://code.visualstudio.com/docs/agents/run/automations.md.
   The index of all pages is https://code.visualstudio.com/llms.txt.
3. **Live tools.** Compare the tool names, parameters, and limits with the tool descriptions in your
   session (for example `rename_chat`, `set_workspace`, `create_session`, `add_artifact_or_reference`).
   When the docs, the live tools, and a Forge file do not agree, tell the user the difference.
4. **Baseline.** Update [docs/vscode-baseline.md](docs/vscode-baseline.md): the versions, the date,
   the native features that Forge uses, the known gaps, and the results of the click-checks.
5. **Native first.** Before you add a Forge part (a script, hook, template, rule, or skill step),
   look for a native feature. Each Forge part has one line "Why not native" in the baseline.

## 🧪 Test

- Run `npm test` (Node 20 or later). It runs the test files in the `test` script of `package.json`.
  Add each new test file to that script.
- The CLI tests use `--cwd <repo root> --wiki <temporary folder>`.
- Keep the strings that `tests/agents.test.mjs` and `tests/fixtures/scenarios.json` require,
  or change the test and give the reason.

## ✍️ Files

- Use CRLF line endings, UTF-8 without a BOM, and a final newline.
- Write plugin text in ASD-STE100 Simplified Technical English (the `writing` skill).
  Do not use em dashes, en dashes, or a double hyphen in Markdown (`tests/writing.test.mjs`).
- The plugin uses the Agent Plugins 1.0 layout:
  - `plugins/forge/skills/`: portable skills.
  - `plugins/forge/com.github.copilot/`: rules, hooks, and custom agents for VS Code.
  - `plugins/forge/automations/`: automation templates (`*.automation.md`).
- `plugins/forge/skills/ticket/SKILL.md` and `templates/` are the `full-v3` layout of new tickets. `skills/ticket/legacy/` holds the rules and templates of older tickets:
  change it only to correct a defect, because open tickets depend on it.
- The ticket canvas (`scripts/lib/canvas.mjs`) reads the section names and the line shapes of the `full-v3` templates.
  Change a template and the canvas together (`tests/canvas.test.mjs`). The page loads nothing from a network.
  In serve mode (`scripts/lib/canvas-serve.mjs`), the page sends the comments only to the forge server on `127.0.0.1` (`tests/canvas-serve.test.mjs`).
- The board page (`scripts/lib/board-page.mjs`) and the ticket canvas share one design system: `scripts/lib/ui.mjs` and [docs/design-system.md](docs/design-system.md).
  Change a token or a shared component and the document together (`tests/board-page.test.mjs`). Look at each page change in a browser, in the light and the dark theme.
- Change the version in `plugins/forge/plugin.json`, `.github/plugin/marketplace.json`, and `.claude-plugin/marketplace.json` together (`tests/packaging.test.mjs`).
- Never commit a wiki `raw/` file, a credential, or a personal path.
