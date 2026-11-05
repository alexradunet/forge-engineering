# 🤖 forge-engineering: rules for agents

This repository holds the `forge` agent plugin for the VS Code Agents window.
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
- Change the version in `plugins/forge/plugin.json` and `.github/plugin/marketplace.json` together.
- Never commit a wiki `raw/` file, a credential, or a personal path.
