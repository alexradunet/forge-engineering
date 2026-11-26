# 🤖 forge-engineering: rules for agents

This repository holds the `forge` agent plugin for GitHub Copilot CLI and Claude Code.
It has a generic core, a default profile (the GitHub profile: GitHub Issues, pull requests, and Actions with `gh`), and more profiles as folders.

- The default profile is `plugins/forge/templates/` and each file that `templates/profile.json` lists in `files`. An extra profile is a folder `plugins/forge/profiles/<name>/` with the same shape. It holds only the files that differ: a missing file comes from the default profile.
  Put each company value there: `profile.json` for the machine values, `profile.md` for the setup text, `config/` and `rules/` for the wiki copies.
- All other plugin files are the core. The core holds no company term (`terms` in `profile.json` of each profile). `tests/profile.test.mjs` checks this.
- A wiki has one profile: `forge/repo.json` names it, and no name means the default profile. The core never has a provider name or a branch on a profile name: a profile is data.
Forge adapts to the code repository as it is: put each fix for a gap into forge.
Forge must stay as native to its hosts (Claude Code and Copilot CLI) as possible. Both change often,
so your memory of a host feature can be old.

## 🔎 Docs first: do these 5 checks before each Forge change

1. **Changelogs.** Read the Claude Code changelog (https://code.claude.com/docs/en/changelog) and the
   Copilot CLI changelog (https://github.com/github/copilot-cli/blob/main/changelog.md). Read each entry
   after the version that [docs/baseline.md](docs/baseline.md) names as read.
2. **Feature pages.** Read the current page of each feature that the change touches: the Claude Code docs
   (the index of all pages is https://code.claude.com/docs/llms.txt, and a page URL with `.md` gives Markdown)
   and the Copilot docs (https://docs.github.com/copilot).
3. **Live tools.** Compare the tool names, parameters, and limits with the tool descriptions in your
   session (for example `AskUserQuestion`, `EnterWorktree`, `ListAgents`, `SendMessage`).
   When the docs, the live tools, and a Forge file do not agree, tell the user the difference.
4. **Baseline.** Update [docs/baseline.md](docs/baseline.md): the versions, the date,
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
  - `plugins/forge/com.github.copilot/`: the hooks for Copilot CLI (`hooks/hooks.json`).
- `plugins/forge/skills/ticket/SKILL.md` and `templates/` are the `full-v4` layout. It is the only ticket layout: Forge reads no other marker, and it has no convert code.
- The plan checks (`scripts/lib/gate-checks.mjs`) read the sections **Steps** and **Checks** of `plan.md`, **Components** of `map.md`, and the line labels `Files:`, `Baseline:`, and `Control:`. Change a template and the checks together (`tests/gate-checks.test.mjs`). The pages load nothing from a network.
- The design system is the UI kit `scripts/lib/ui/`: one file for each component, the tokens as data in `tokens.mjs`, and the order lists in `index.mjs`. `scripts/lib/ui.mjs` only re-exports it. [docs/design-system.md](docs/design-system.md) is its document.
  Change a token or a component and the document together (`tests/ui-kit.test.mjs`, `tests/board-page.test.mjs`).
  A new page class has a page prefix, and no page class has the name of a kit class.
  Look at each page change with `npm run shots` (or in a browser), in the light and the dark theme, at 620 px and at 1500 px.
- Change the version in `plugins/forge/plugin.json`, `.github/plugin/marketplace.json`, and `.claude-plugin/marketplace.json` together (`tests/packaging.test.mjs`).
- Never commit a `raw/` file of a Forge folder, a credential, or a personal path.
- `scripts/lib/harness.mjs` is the only place that knows the resume command of a harness, and `scripts/lib/terminal.mjs` is the only place that knows a terminal program.
  A session id goes into a command only through `resumeArgv`, and a command for a terminal is a list of arguments, never a text for a shell (`tests/sessions.test.mjs`, `tests/terminal.test.mjs`).
- `scripts/lib/layout.mjs` is the only place that knows where `raw/` and `archive/` are for a wiki folder: next to the wiki in a Forge folder `../<repo>.forge`. Use `rawDir` and `archiveDir`, and write `<forge>/raw` in plugin text.
