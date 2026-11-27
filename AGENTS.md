# 🤖 forge-engineering: rules for agents

This repository holds the `forge` agent plugin for GitHub Copilot CLI and Claude Code.
Forge calls no external tool: no tracker, no change request host, no CI. Forge has no web part: no page, no server, no browser view. The board is a text table in chat. A ticket links to its work item with `item:` in its README.
The core holds no provider name.
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
- For a change of Forge itself, run the paid evals before you open Shippable?: a later commit with the eval result changes the code, and the code binding of Shippable? then denies the push.
- The CLI tests use `--cwd <repo root> --wiki <temporary folder>`.
- Keep the strings that `tests/agents.test.mjs` and `tests/fixtures/scenarios.json` require,
  or change the test and give the reason.

## ✍️ Files

- Use CRLF line endings, UTF-8 without a BOM, and a final newline.
- Write plugin text in ASD-STE100 Simplified Technical English (the `writing` skill).
  Do not use em dashes, en dashes, or a double hyphen in Markdown (`tests/writing.test.mjs`).
- The plugin uses the Agent Plugins 1.0 layout:
  - `plugins/forge/skills/`: portable skills.
  - `plugins/forge/com.github.copilot/`: the hooks for Copilot CLI (`hooks/hooks.json`).
- `plugins/forge/skills/ticket/SKILL.md` and `templates/` are the `full-v4` layout. It is the only ticket layout: Forge reads no other marker, and it has no convert code.
- The plan checks (`scripts/lib/gate-checks.mjs`) read the sections **Steps** and **Checks** of `plan.md`, **Components** of `map.md`, and the line labels `Files:`, `Baseline:`, and `Control:`. Change a template and the checks together (`tests/gate-checks.test.mjs`).
- Change the version in `plugins/forge/plugin.json`, `.github/plugin/marketplace.json`, and `.claude-plugin/marketplace.json` together (`tests/packaging.test.mjs`).
- Never commit a `raw/` file of a Forge folder, a credential, or a personal path.
- `scripts/lib/layout.mjs` is the only place that knows where `raw/` and `archive/` are for a wiki folder: next to the wiki in a Forge folder `../<repo>.forge`. Use `rawDir` and `archiveDir`, and write `<forge>/raw` in plugin text.
