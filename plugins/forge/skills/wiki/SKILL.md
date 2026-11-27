---
name: wiki
description: Engineering wiki of the current repository (../<repo>.forge/wiki), shared by all agent sessions of the repository. Use it to look up past findings, gotchas, decisions, and how parts of your code connect, and to record new durable knowledge. Use when asked to "check the wiki", "remember this in the wiki", "add to wiki", "what do we know about X", "lint the wiki", or when you start non-trivial work in an area the wiki index covers.
---

# 📚 Repository wiki

> When your context has no `End of Forge context.` line, or a `Forge context part <i> of <n>` part is
> missing or has a different id, run `node "<plugin>/scripts/forge.mjs" context` first and follow its output. `<plugin>`
> is two folders above the folder of this file. When the command fails, read
> [forge.md](../../context/forge.md) (the `forge` rule), and [style.md](../../context/style.md) (the `style` rule) unless `policy.styleRules` is `false`.

The wiki is a folder of Markdown pages in the Forge folder of the repository: `../<repo>.forge/wiki`. Get its path with
`forge.mjs where` (see the `forge` rule). This skill calls that folder `<wiki>`, and the Forge folder `<forge>`. All
sessions read and update it. It is the shared memory layer between sessions.

The wiki is its own Git repository. Keep it private when it holds company knowledge.
Use a public wiki only when all tracked files and Git history contain public data.
The wiki shares configuration through Git. It needs no separate distribution layer.
`raw/` and `archive/` are next to the wiki in `<forge>`. They are not in the wiki repository, so they stay on this machine only.

```text
<wiki>/
  index.md        catalog: one line per page, grouped by area
  log.md          append-only change log
  forge/          repo.json (binding), config/ (forge config)
  tooling/        MCP, build, and environment gotchas
  <area>/         architecture, flows, and code knowledge (one folder for each product or codebase)
  decisions/      decisions and their reasons
  tickets/        one summary page per closed ticket
<forge>/raw/tickets/      working folders of active tickets (the `ticket` skill)
<forge>/archive/tickets/  raw folders of closed tickets, kept as they were
```

`raw/` and `archive/` are working material, not canonical pages. The `ticket`
skill owns them. They can hold customer environment names and aggregated metrics. The
canonical pages cannot.

## 🧭 What belongs where

| Knowledge | Put it in |
|---|---|
| One short fact that only one tool needs | Built-in memory (Claude Code: the file memory, Copilot CLI: `store_memory`) |
| A topic, a gotcha with a cause, a decision, or how parts connect | This wiki |
| Company engineering guidance | Nowhere. Use the company source (the company rules in `<wiki>/rules/` can name it). |
| Repository conventions | Nowhere. Use the repository instructions and skills. |

Never write these into the wiki:

- Secrets, tokens, passwords, or connection strings.
- Personal data about people, or customer data. Exception: `raw/` and `archive/` can hold customer environment names and aggregated metrics.
- Content that you copied from company guidance or from repository docs. Link to it instead.

## 🔎 Query

1. Read `index.md`.
2. Open only the pages that match the task.
3. Check the `sources` and `updated` fields of each page.
4. Verify a claim against the code or tool before you rely on it.
5. Tell the user which page you used.

If a page is wrong, correct it in the same task (see Record).
Classify each source before resolving it (see Lint). A path that exists does not
verify the page text. Shared knowledge must remain useful when ignored raw or
archive material is unavailable on this machine; never publish it as a repair.

## ✍️ Record

Record knowledge when all of these are true:

- You verified it in this task (code, command output, or tool result).
- It will help a future task.
- It is not obvious from the code, and no other source holds it.

Steps:

1. Search `index.md` for a page on the same topic.
2. Update that page, or create one page per topic in the correct folder.
3. Use a short kebab-case file name, for example `tooling/npm-feed-auth.md`.
4. Add or update the page line in `index.md`: `- [<Title>](<folder>/<page>.md): <one-line summary>`.
5. Append an entry to `log.md`.
6. Commit the canonical pages in the wiki repository: `git -C <wiki> add -A; git -C <wiki> commit -m "<summary>"`. Push only when the user asks.
7. Tell the user what you recorded, in one line per page.

Page template:

```markdown
---
title: <Title>
updated: <YYYY-MM-DD>
status: verified | needs-check | decided
sources:
  - <repo path:line, URL, command, or "investigation on YYYY-MM-DD">
---
# <Title>

<One short paragraph that states the fact or answer.>

- <Details, causes, and fixes as a list.>
```

Every canonical page starts with this frontmatter. `index.md` and `log.md` have only `title` and `type`.
An absent `log.md` is allowed until it is created; do not invent entries just to satisfy lint.
Ticket documents in `<forge>/raw/tickets/` use their own frontmatter schema (the `ticket` skill, "Frontmatter").
Writing rules:

- Follow the wiki page mode of the [`writing` skill](../writing/SKILL.md): STE, a full pass for AI patterns, no emoji, and no bold labels.
- Keep a page short. Split it when it covers two topics.
- Link to related pages with relative links.
- Give facts, not a narrative of the investigation.
- Replace outdated text. Do not keep old and new versions side by side.

Log entry format (append at the bottom):

```markdown
## YYYY-MM-DD <create|update|delete|lint|close>: <summary>

- <folder/page.md>
```

## 🧹 Lint

When asked, run `node "<plugin>/scripts/forge.mjs" lint [--wiki "<path>"] [--json]`.
The command is read-only by default and checks tickets as well as canonical metadata.
Ticket Resume also uses its read-only approval findings. Do not treat raw/archive
working documents as canonical pages or require their publication.
Canonical checks cover `title`, `status`, `updated`, and `sources`, with special
`title`/`type` checks for existing index/log files and age/`needs-check` warnings.
CLI lint does not automate index membership, semantic contradictions, HTTP
retrieval, or text truth; those remain manual editorial checks.

Findings include `file`, `line` (number or `null`), `code`, `severity`, `message`,
and a specific `remedy`. JSON has `version: 1`, `wikiPath`, `findings`, `repairs`,
and `summary: { errors, warnings, repaired }`. Repair entries have `file`, `code`,
and `log`. Errors exit 1; warnings alone exit 0. Invalid input does not hide valid files.

Source classification:

| Class | Handling |
|---|---|
| URL | Remote reference, not a local path. Local lint does not verify its text or reachability. |
| Repository source | Resolve only when the base repository is known from binding/configured checkout identity; never guess. |
| Local-only raw/archive | Mark unavailable on this machine, not automatically broken. Keep shared summaries usable without it. |
| Moved path | Report the old path and a verified replacement when known; do not silently rewrite claims. |
| Unknown format, command, historical investigation | Report unresolvable automatically and request manual verification. |

File existence is not claim verification. After deterministic lint, review these
editorial checks separately; do not claim that the CLI proves them:

1. Find pages missing from `index.md`, and index lines without a page.
2. Verify source claims against code/tools, and identify moved paths where evidence allows.
3. Review `status: needs-check` and dates older than 90 days as signals, not proof of falsehood.
4. Find contradictions between pages.
5. Report findings. Ask before deleting or merging pages. After approved editorial fixes, append a `lint` entry to `log.md`.

Only explicit `--fix` enables repair. Its sole allowlisted edit is a missing final
newline in an unapproved `*.draft.md` with explicit `status: draft` metadata,
preserving all other bytes and line-ending
style. Protect the documents of each approval manifest.
Report repairs and append `started` and `applied` rows with before/after hashes to
the ticket's `repair-log.jsonl`; a second pass is
unchanged. Never infer workflow/state, grant approval, edit approved content,
auto-migrate headerless index/log metadata, delete pages, or publish.

Forge supports only `workflow: full-v4`. A ticket with another marker or no marker
is an `invalid-input` finding. Validate revision evidence. Missing/stale evidence blocks the
affected action, not read-only resume. See the ticket skill's Approval revisions
and [CLI contract](../../../../docs/wiki.md#local-validation-and-source-limits).
The shared `checkAction` API validates prerequisites; the CLI has lint only and
never executes workflow actions.
