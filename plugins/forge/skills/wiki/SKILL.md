---
name: wiki
description: Engineering wiki of the current repository (../<repo>.wiki), shared by all sessions in the VS Code Agents window. Use it to look up past findings, gotchas, decisions, and how parts of your code connect, and to record new durable knowledge. Use when asked to "check the wiki", "remember this in the wiki", "add to wiki", "what do we know about X", "lint the wiki", or when you start non-trivial work in an area the wiki index covers.
---

# 📚 Repository wiki

The wiki is a folder of Markdown pages next to the repository: `../<repo>.wiki`. Get its path with
`forge.mjs where` (see the `forge` rule). This skill calls that folder `<wiki>`. All
sessions read and update it. It is the shared memory layer between sessions.

The wiki is its own Git repository. Keep it private when it holds company knowledge.
Use a public wiki only when all tracked files and Git history contain public data.
The wiki shares configuration and helper scripts through Git. It needs no separate distribution layer.
Git ignores `raw/` and `archive/`, so they stay on this machine only.

```text
<wiki>/
  index.md        catalog: one line per page, grouped by area
  log.md          append-only change log
  forge/          repo.json (binding), config/ (team config), scripts/ (helper scripts)
  tooling/        VS Code, MCP, build, and environment gotchas
  learning/       optional concept lessons, linked to artifacts and verified sources
  <area>/         architecture, flows, and code knowledge (one folder for each product or codebase)
  decisions/      decisions and their reasons
  tickets/        one summary page per closed ticket
  raw/tickets/    working folders of active tickets (the `ticket` skill)
  raw/daily-recap/ daily recaps and outcomes (the `daily-recap` skill)
  archive/tickets/ raw folders of closed tickets, kept as they were
```

`raw/` and `archive/` are working material, not canonical pages. The `ticket`
and `daily-recap` skills own them. They can hold customer environment names and aggregated metrics. The
canonical pages cannot.

## 🧭 What belongs where

| Knowledge | Put it in |
|---|---|
| One short fact that only one tool needs | Built-in memory (`store_memory`) |
| A topic, a gotcha with a cause, a decision, or how parts connect | This wiki |
| An accepted concept lesson with artifact and code links | `learning/`, through the `learning-mode` skill |
| Company engineering guidance | Nowhere. Use the company source (the `## Toolkit` section of `<config>/policy.md` can name it). |
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

## Learning pages

The `learning-mode` skill creates optional, source-linked lessons after the user accepts.
These pages explain a concept through repository examples; they do not copy existing documentation.
Use the same frontmatter, index, log, and data rules as other canonical pages.
Verify sources before reusing a page. Keep durable code links when a source artifact can move.
Mark evidence gaps as `needs-check`; do not store personal progress or private comment text.
Learning pages add no approval gate and do not replace the ticket's `Learned?` gate.

## ✍️ Record

Record knowledge when all of these are true:

- You verified it in this task (code, command output, or tool result).
- It will help a future task.
- It is not obvious from the code, and no other source holds it.

Steps:

1. Search `index.md` for a page on the same topic.
2. Update that page, or create one page per topic in the correct folder.
3. Use a short kebab-case file name, for example `tooling/npm-feed-auth.md`.
4. Add or update the page line in `index.md`.
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
Ticket documents in `raw/tickets/` use their own frontmatter schema (the `ticket` skill, "Frontmatter").
Writing rules:

- Use ASD-STE100 Simplified Technical English.
- Keep a page short. Split it when it covers two topics.
- Link to related pages with relative links.
- Give facts, not a narrative of the investigation.
- Replace outdated text. Do not keep old and new versions side by side.

Log entry format (append at the bottom):

```markdown
## YYYY-MM-DD <create|update|delete|lint|close> — <summary>

- <folder/page.md>
```

## 🧹 Lint

Run only when the user asks. Skip `raw/` and `archive/`.

1. Find pages that are missing from `index.md`, and index lines without a page.
2. Find `sources` paths that no longer exist.
3. Find pages with `status: needs-check` or an `updated` date older than 90 days.
4. Find contradictions between pages.
5. Report the findings as a list. Ask before you delete or merge pages.
6. After you fix pages, append a `lint` entry to `log.md`.
