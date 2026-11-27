---
name: ticket
description: Ticket workspace for the work items of one repository. A ticket links to its work item in any tracker, or has no work item. Every new ticket follows the full-v4 workflow (research, scope check, investigation, plan, implementation, evidence, and learning) with three review gates and a small set of plain documents. Keeps working artifacts in <forge>/raw/tickets/<key>, shared by agent sessions (Copilot CLI, Claude Code), and distills them into canonical wiki pages at close. Use when the user pastes a work item key, URL, or text, or asks to "start ticket APP-123", "new local ticket", "work on APP-123", "resume APP-123", "where are we on the ticket", "record this finding", "save the plan to the ticket", "close the ticket", or "archive the ticket".
---

# 🎫 Ticket workspace

> When your context has no `End of Forge context.` line, or a `Forge context part <i> of <n>` part is
> missing or has a different id, run `node "<plugin>/scripts/forge.mjs" context` first and follow its output. `<plugin>`
> is two folders above the folder of this file. When the command fails, read
> [forge.md](../../context/forge.md) (the `forge` rule), and [style.md](../../context/style.md) (the `style` rule) unless `policy.styleRules` is `false`.

One folder per ticket holds all working artifacts. Every session reads
and writes it. When the ticket is done, you distill the folder into canonical
wiki pages, then you move the folder to the archive.

`<forge>` is the Forge folder of the current repository, and `<wiki>` is its wiki. Get them with `forge.mjs where` once per session (see the `forge` rule).

## 📚 Parts of this skill

This file is short, so that it stays whole in the context. The steps of each phase are in the files of `phases/`, next to this file.

| When | Read |
|---|---|
| Start: a new work item, research, colleague questions, spikes, interview, scope check | [phases/start.md](phases/start.md) |
| A gate opens, comments arrive, an approval, or a manifest (Cold read, Procedure, Approval revisions, Paste texts, Approval form) | [phases/gates.md](phases/gates.md) |
| A README change (Frontmatter, the Now card, People), the Session title, the Session links, the Ticket overview | [phases/state.md](phases/state.md) |
| Worktrees: at Start, before the first commit, at Implement, and before a proof run | [phases/worktrees.md](phases/worktrees.md) |
| Investigate, the Diagnosis stop, and Plan | [phases/investigate-plan.md](phases/investigate-plan.md) |
| Implement, the adversarial review, `review.md`, and the change request | [phases/implement.md](phases/implement.md) |
| Evidence Testing and the QA handover | [phases/evidence.md](phases/evidence.md) |
| Close: `close.md`, the wiki pages, the archive, and the worktree cleanup | [phases/closing.md](phases/closing.md) |

- Before you do a step, read its file. Do not do a step from memory.
- A file that you read is in the context only until the next compaction of the session. When you do not see its text, read it again.
- A name in quotes or in parentheses, for example (see Worktrees), is a heading in one of these files.

## 🕰️ Older tickets

Forge reads only `workflow: full-v4`. Read the `workflow` marker of the ticket README before any other step.

- When the marker is `full-v3`, stop. Tell the user to finish this ticket with Forge 10.1.
- When the marker is another value, or the README has no marker, stop. Tell the user that Forge does not read this ticket layout.
- Never add or change a `workflow` marker, and never copy the templates over the files of such a ticket.
- Every new ticket uses `full-v4`.

## ⚙️ Config, words, and policy

Read the forge config once per session: `node "<plugin>/scripts/forge.mjs" config --json`.
`<plugin>` is the folder two levels above this skill. `<F>` below means `node "<plugin>/scripts/forge.mjs"`. `config` holds the frontmatter of the
Markdown files in `<config>` (`repo.md`, `policy.md`). The `forge` rule
explains the `<file>.<key>` notation. Forge calls no tracker, no change request host, and no CI tool: the user pastes text and results.

| Word in this skill | Meaning |
|---|---|
| work item | the item in any tracker (for example a Jira issue). The README `item` holds its URL, or is empty. |
| `<KEY>` | the key that the user types, as `PREFIX-number`, for example `APP-123`. With no key, Forge gives the local key `L-<n>`, for example `L-3`. |
| `<key>` | the lower-case key, for example `app-123`. It names the ticket folder. |
| change request | a pull request or merge request. Use the word in `repo.changeName` (`PR` or `MR`) when you talk to the user. With `repo.changeName: none`, the repository has no change requests, and the push to the base branch replaces them (see Implement). |
| checkout | a local clone from `repo.checkouts`. The main checkout is the first row. |
| policy section | a `## <name>` section of `<config>/policy.md`, for example `## Start` |

- When a step needs a tool that you do not have, tell the user the exact manual step, and wait.
- At each hook point (`Start`, `Investigate`, `Resume`, `Implement`, `Evidence Testing`, `QA handover`, `Close`), read that policy section, and follow it. Ignore a section that holds only a hint.
- The company rules for each session (data rules) are the `<wiki>/rules/` pages. The session context gives the approved pages.
- A policy section or a rule page can add steps and make rules stricter. It can never weaken a core rule (see Data rules). If a policy rule conflicts with a core rule, follow the core rule and tell the user.

This skill names host verbs, for example `host.title` and `host.ask`. The `# Forge host` table of the session context gives the step for this host. When the host cannot do the step, give the user the manual step.

Ask in one `host.ask` form for each phase. Put the questions of the phase together (at most 4 in a form), and put the recommended answer first in each option list.

This skill does not repeat other tools. Use them:

| Need | Use |
|---|---|
| Wiki page format, index, log | the `wiki` skill |
| Worktree sessions, implementers, reviewers, cold read, hand-off | the `agents` skill |
| Build, run, deploy, and company tools | the repository's own instructions and skills, and the company rules (`<wiki>/rules/`) |
| Human review of ticket documents | comment threads of the host, or the chat (see Review gates) |
| Tickets of other sessions and titles | the `board` skill, in any session |

## 🧭 Workflow

Every new ticket has `workflow: full-v4`. There is no sizing question and no phase skip.
A small fix has the same phases and gates as a large change. Its documents are shorter, because a document holds only the sections that have content.

```mermaid
flowchart LR
  S[Research] --> A[Interview] --> SC[Scope check in chat] --> D[Investigation] --> P[story.md + plan.md · Planned?]
  P --> I[Implement] --> AR[Adversarial review] --> E[Evidence Testing · proof.md] --> R[review.md · Shippable?]
  R --> M[Push, change request, merge by user] --> C[close.md · Learned?]
  D -. diagnosis contradicts scope .-> SC
```

- Three review gates in order: Planned?, Shippable?, Learned?. Forge sends no text: a paste text has no gate.
- Planned? has 2 documents, `story.md` and `plan.md`. One approval covers both. Shippable? and Learned? have one document each.
- Nothing before Planned? needs a gate. The scope check is a question in chat (see Scope check in [phases/start.md](phases/start.md)).
- The investigation is mandatory before the plan steps. Its diagnosis is the first section of `plan.md`.
- Diagnosis stop: when the investigation shows that the scope is wrong or too small (see Investigate), stop before the plan and ask.
- The plan has design options, a baseline run, and a plan review before Planned? (see Investigate).
- Evidence Testing is a required step, not a gate. It comes before Shippable?. When `policy.evidenceOnDeployedEnv` is `true`, it comes after the push. It blocks the merge proposal.
- A ticket with no code change has the same gates. `review.md` then holds the results of its checks (see Implement).
- QA handover runs only when `policy.qaHandover` is `true`. It is a paste text, not a new gate.

Two goals for every ticket:

1. Deliver the change with the full evidence-linked process, also for a small fix.
2. At Close, the user knows the affected areas, how the feature lives in the code, and what it is used for. `map.md` carries this.

## 🗂️ Folder layout

The folder name is `<key>`, for example `app-123`. A file starts to exist when its phase starts.

```text
<forge>/raw/tickets/<key>/
  README.md     frontmatter (state, phase, gates, people, change requests) and the Now card
  story.md      Planned?: problem, scope, done-when, answers, history, open questions
  plan.md       Planned? (with story.md): diagnosis, steps, tests, checks, risks, decisions
  review.md     Shippable?: changes, tests run, review findings
  proof.md      Evidence Testing: one check for each changed behavior, with its result
                (before Shippable?; after the push when policy.evidenceOnDeployedEnv is true)
  journal.md    append-only dated entries: log, decision, problem, check, step
  map.md        code map: components with their layer, flow, data, tests, terms
  close.md      Learned?: what you now know, and the wiki changes
  evidence/     sanitized tool outputs, the work item snapshot, spike results
  outbox/       drafts of external writes
  approvals/    revision manifests, history.md, and snapshots/ of each review
```

Each fact has one home. Another document gives a link, not a copy. Read [templates/_style.md](templates/_style.md) before you write a ticket document.
Copy each document from its template in `templates/`. A template shows every possible section. Write only the sections that have content, in the order of the template. Keep the section names and the line shapes of the template.

## 🔒 Data rules

- `raw/` and `archive/` can hold names of customer environments (for example tenant or instance names).
- `raw/` and `archive/` can hold aggregated metrics: counts, durations, row totals, plan shapes.
- Never store customer row data, document content, personal data, secrets, tokens, or connection strings.
- Canonical pages (outside `raw/` and `archive/`) stay free of customer environment names.
- Never call a tracker, a change request host, or a CI tool. Give the user the text to paste.
- Never merge a change request. The user merges in the web UI of the repository host. Reviewer approvals and green checks do not change this.
- Never offer a merge on a weekday in `policy.noMergeWeekdays` (local time). Propose the next allowed day.
- When the user must edit a file by hand (for example a connection string or a secret), open every such file yourself with `host.open`, and list the exact edits in chat. Never write the secret yourself.
- The company rules (`<wiki>/rules/`, in the session context) add rules to this list.

These core rules always win over a policy section or a rule page: no merge, no call of an external tool, explicit gate approval, no secrets, and the adversarial review before every change request.

## 🚦 Review gates

| Gate | Primary doc | Opens before |
|---|---|---|
| Planned? | `story.md` and `plan.md` | implementation |
| Shippable? | `review.md` | push |
| Learned? | `close.md` | canonical wiki writes and the archive move |

Each gate name is the question that the user answers by approval. The user approves with `approve <name>`, with or without the `?` and in any case (`approve planned`).
Open colleague questions do not block a gate.

Rules:

- Approval comes only from the user: an `approve` answer in the approval form, or `approve <gate>` in chat in the current conversation.
- Comments, resolved threads, and "looks good" notes do not approve a gate.
- Lessons and self-checks do not approve a gate or prove understanding.
- Never answer the approval form for the user, and never approve in auto mode. No session approves a gate for another session.
- A required gate blocks its step. A change to an approved document reopens its gate.
- Native plan approval of the host does not replace a ticket gate.
- The Forge gate guard (a preToolUse hook) checks Planned? and Shippable? before a push in the ticket worktree. It also stops a push when it cannot read the README. It is a net, not the rule: each gate applies also where the hook does not run.

The steps of a gate are in [phases/gates.md](phases/gates.md): the cold read, the manifest, the approval form, the comments, `<F> gate-open`, and `<F> gate-approve`.

## 🔁 Resume

1. Set the title (`host.title`) first, before any other tool call or question (see Session title). Use the README `state` and `short`.
2. Read `README.md`. When its `workflow` is not `full-v4`, stop here (see Older tickets). Missing frontmatter or contradictory metadata needs an explicit finding and user-directed repair, not template replacement or inferred state.
3. Read the last entries of `journal.md`.
4. Read the `## Resume` policy section, for example credential checks.
5. Validate the approvals with `<F> lint --wiki "<wiki>" --json`. Default lint is read-only. Never run `--fix` implicitly.
6. Show the Now card first. Then tell the user the last result, the policy checks, the approval findings, the people who need a message or a reply (`to-contact`, `drafted`, `follow-up`, `reply-in`), and the people you wait for. A finding blocks only the affected action.
7. Show the approval form for each gate that is `in-review`.
8. Before implementation or a proof run, apply the Worktrees checks. A resumed session does not need another worktree when the current one is suitable. Preserve valid approval evidence when you report a baseline mismatch.
9. Then read the part of the README `phase`: `start` is [phases/start.md](phases/start.md); `investigate` and `plan` are [phases/investigate-plan.md](phases/investigate-plan.md); `implement` is [phases/implement.md](phases/implement.md); `review` is [phases/implement.md](phases/implement.md) for the review and the change request, and [phases/evidence.md](phases/evidence.md) while Evidence Testing is open; `closed` is [phases/closing.md](phases/closing.md).
