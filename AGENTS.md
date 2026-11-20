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
- `npm run eval` runs the behavioral cases of `tests/evals/` with a real agent session ([docs/evaluation.md](docs/evaluation.md)). Each run is a paid model run: ask the user first. Run the cases that a change of a rule, a skill, or a hook can affect, and write the result in `docs/evaluation.md`.
  Add each new test file to that script.
- `npm run shots` takes screenshots of each page in 2 themes at 2 widths, in headless Chromium, with invented demo data. It is not part of `npm test`. It needs Chromium (`FORGE_CHROMIUM`) and Node 22 or later.
- The CLI tests use `--cwd <repo root> --wiki <temporary folder>`.
- Keep the strings that `tests/agents.test.mjs` and `tests/fixtures/scenarios.json` require,
  or change the test and give the reason.

## ✍️ Files

- Use CRLF line endings, UTF-8 without a BOM, and a final newline.
- `plugins/forge/vendor/` holds third-party files. Do not change a byte of them: they keep their own line endings, and `tests/wiki-page.test.mjs` checks the hash. The update steps are in `plugins/forge/vendor/mermaid/NOTICE.md`.
- Write plugin text in ASD-STE100 Simplified Technical English (the `writing` skill).
  Do not use em dashes, en dashes, or a double hyphen in Markdown (`tests/writing.test.mjs`).
- The plugin uses the Agent Plugins 1.0 layout:
  - `plugins/forge/skills/`: portable skills.
  - `plugins/forge/com.github.copilot/`: rules, hooks, and custom agents for VS Code.
  - `plugins/forge/automations/`: automation templates (`*.automation.md`).
- `plugins/forge/skills/ticket/SKILL.md` and `templates/` are the `full-v3` layout. It is the only ticket layout (Forge 8 removed the older layouts).
- The ticket canvas (`scripts/lib/canvas.mjs`) reads the section names and the line shapes of the `full-v3` templates.
  Change a template and the canvas together (`tests/canvas.test.mjs`). The page loads nothing from a network.
  In serve mode (`scripts/lib/canvas-serve.mjs`), the page sends the comments only to the forge server on `127.0.0.1` (`tests/canvas-serve.test.mjs`).
- The design system is the UI kit `scripts/lib/ui/`: one file for each component, the tokens as data in `tokens.mjs`, and the order lists in `index.mjs`. `scripts/lib/ui.mjs` only re-exports it. [docs/design-system.md](docs/design-system.md) is its document.
  Change a token or a component and the document together (`tests/ui-kit.test.mjs`, `tests/board-page.test.mjs`).
  A new page class has a page prefix, and no page class has the name of a kit class.
  Look at each page change with `npm run shots` (or in a browser), in the light and the dark theme, at 620 px and at 1500 px.
- Change the version in `plugins/forge/plugin.json`, `.github/plugin/marketplace.json`, and `.claude-plugin/marketplace.json` together (`tests/packaging.test.mjs`).
- Never commit a `raw/` file of a Forge folder, a credential, or a personal path.
- `scripts/lib/harness.mjs` is the only place that knows the resume command of a harness, and `scripts/lib/terminal.mjs` is the only place that knows a terminal program.
  A session id goes into a command only through `resumeArgv`, and a command for a terminal is a list of arguments, never a text for a shell (`tests/sessions.test.mjs`, `tests/terminal.test.mjs`).
- `scripts/lib/layout.mjs` is the only place that knows where `raw/` and `archive/` are for a wiki folder: next to the wiki in a Forge folder `../<repo>.forge`, and inside the wiki in an older folder `../<repo>.wiki`. Use `rawDir` and `archiveDir`, and write `<forge>/raw` in plugin text.
