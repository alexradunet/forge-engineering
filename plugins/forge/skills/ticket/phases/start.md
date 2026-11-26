# Ticket start: research, interview, and scope

This file is a part of the `ticket` skill: [SKILL.md](../SKILL.md) has the words (`<F>`, `<KEY>`, `<key>`), the data rules, the gate rules, and the list of the other parts.
It has the steps from a new work item to the scope check.
After a compaction of the session, read this file again before you use its steps.

## 🚀 Start

1. Set the title (`host.title`) first, before any other tool call or question: `<KEY> - ▶️ - <summary>`. When the prompt has only the key, use `<KEY> - ▶️ - Start ticket`, and rename again after step 2 (see Session title).
2. Fetch the work item with `tracker.fetch`, with its comments. Normalize the key to `<KEY>`. Choose `short`: 3 to 6 words from the work item summary.
3. Read the `## Start` policy section.
4. Create the folder. If it exists, run Resume instead.
5. Save the work item snapshot as `evidence/<yyyy-mm-dd>-work-item.md`: summary, type, status, priority, reporter, assignee, description, comments, the item URL, and the snapshot date.
6. Write `README.md` from [templates/README.md](../templates/README.md): `workflow: full-v4`, `phase: start`, `state: active`, `short`, `next`, `item`, and all gates. Fill the Now card from the frontmatter.
7. Place the session (see Worktrees). Preserve an existing session worktree. Run `<F> worktree <KEY> --summary "<short>"` and follow its `action`. Record `branch` and `worktree` (the absolute path) in the README.
8. Seed `map.md` from [templates/map.md](../templates/map.md): the purpose, the terms, and a first guess of the components. Mark each guess `(unverified)`.
9. Start `journal.md` from [templates/journal.md](../templates/journal.md) with one `log` entry.
10. Add the ticket to the "Tickets → Active" list in `<wiki>/index.md`. Mark its raw folder as local-only. Append a `create` entry to `<wiki>/log.md`.
11. Do the research (next section). Then do the interview, write the scope, and do the scope check.
12. After the scope check, investigate, then write the plan steps, and open Planned? before implementation. Do not skip a phase for a small fix, and do not run a blocked phase in auto mode.

### 🧭 Research

The user possibly does not know the problem, its history, or the people around it. Give the user that context first.
Do this automatically. It is read-only, so it needs no approval. Research depth follows the evidence, not a word count or a duration.

1. Read the wiki: `<wiki>/index.md`, matching canonical pages, and related archived tickets.
2. Read the sources that the work item links: documents, postmortems, linked items, sibling and follow-up items (`tracker.search` on the same reporter, labels, and dates).
3. Trace the history in the code (read-only): `git log --all --grep <keys>` in each checkout, and related change requests (`repo.history`). Review threads show who reviewed and what they said. The `## Investigate` policy section can name older sources.
4. Survey the code in the checkouts of `repo.checkouts`: affected areas, existing patterns, related docs, skills, and instructions. Identify existing tests, missing coverage, behavior to preserve, and regression risks.
5. If the work item names a customer environment or a production symptom, take a small read-only sample with the tools that the `## Investigate` policy section allows. Ask first before any tool that needs approval.
6. If a source is not available (VPN off, tool not authenticated, capability `manual`), write it in **Sources not available** of the story, and continue. Absence of evidence is not proof of safety.
7. Write `story.md` from [templates/story.md](../templates/story.md), without the summary and the Scope section for now: Problem, History, Related work, Facts, Preserve, and Open questions. Put tool outputs in `evidence/`. Add what you learned about the code to `map.md`.
8. List the colleagues who know the area: reporter, authors and reviewers of related change requests, owners of sibling items and related documents. Add each one to the README `people` list with `status: to-contact`, with why and what to ask (see People).
9. Write draft messages to them in `outbox/colleague-questions.md`. The user sends them. Never contact people yourself. Set each drafted person to `status: drafted` with `draft: outbox/colleague-questions.md`.
10. Present the context in plain words, in at most 10 lines. Answer questions.

#### 💬 Colleague questions do not block

- Keep each colleague question as a line in **Open questions** of `story.md`: question, person, status (`draft`, `asked`, `answered`, `no reply`), and the impact if the answer differs.
- The scope check can pass with open colleague questions.
- When an open question blocks the plan, the plan states an assumption and a fallback for it (**Assumptions**).
- When an answer arrives before Planned? is approved, record it as a `log` entry in `journal.md`, and update the line status. Name the documents that the answer changes. Update only those documents.
- When an answer arrives after Planned? is approved, record it as a `log` entry in `journal.md` and in the README `people` list. Edit `story.md` only for a scope change: it is in the Planned? manifest, and an edit makes the gate stale.
- Keep the README `people` entry of the same person in step with the line status (see People).

### 🧪 Spikes

A spike is a short read-only check that answers one fact before a scope question or a plan decision.

- Run a spike when a question depends on a fact that a tool can check. Do not ask the user a question that a tool can answer.
- Time box: 15 minutes. If the spike needs more, stop, write what you found, and add the rest to the investigation.
- Allowed: code search, `git log`, change request threads, tracker reads, CI reads, and the read-only tools that the `## Investigate` policy section allows (check their credentials first).
- Not allowed: code edits, builds that change the main checkout, CI triggers, external writes.
- Save the result as `evidence/<yyyy-mm-dd>-spike-<topic>.md`. Link it from the question. Add new code facts to `map.md`. Add one `log` entry to `journal.md`.

### 🎤 Interview

Start after the research. Ground each question in the story or its evidence.

1. Before you ask, run a spike for each question that depends on a checkable fact.
2. State your reading of the work item in 1 or 2 lines. Give 2 other possible readings, for example a smaller scope, another cause, or another user group. Do this also when the item looks clear: a wrong reading passes each review that only repeats it. Ask which reading is right as the first question of the form (step 3).
3. Ask up to 5 questions in one `host.ask` form, grouped by topic. For each question, give why it matters, the options, and the recommended answer as the field default with its reason in the field description. Never answer for the user or accept recommendations in auto mode.
4. Run a second round only for answers that raise new questions.
5. Record each answer in **Answers** of `story.md`, with the question, the answer, and why it matters. Add one `decision` entry to `journal.md` for an answer that changes the scope.

### 🎯 Scope check

The scope check is a question in chat. It is not a gate.

1. Complete `story.md`: the summary, **Scope** (In and Out), and **Done when**, each acceptance check with its proof. Put the scope choice that changes the plan most first in the summary.
2. Show the scope in chat in at most 8 lines: the problem in one line, In, Out, Done when, and each open question that can change the scope.
3. Ask with one `host.ask`. Never answer for the user. Options:

| Value | Title |
|---|---|
| `correct` | 🟢 The scope is correct: investigate |
| `change` | ✏️ Change: I typed it in the free-text answer |
| `reporter` | 📨 Ask the reporter first |
| `later` | ⏸️ Hold: not now |

4. `correct`: add a `decision` entry with the title `scope` to `journal.md` (the 8 lines and the answer). Set `phase: investigate`. Start Investigate.
5. `change`: update `story.md`, then show the scope again.
6. `reporter`: write the scope and the open questions as a message for the reporter.
   - When `policy.scopeComment` is `true`, write it as `outbox/scope-question.draft.md` (`target: tracker-comment`), and run the Sendable? steps.
   - Else add it to `outbox/colleague-questions.md`. The user sends it.
   - Then ask the user to select: wait for the answer, or continue with an assumption in **Open questions**.
7. `later`: stop. Tell the user how to resume.
8. When `policy.scopeComment` is `true`, also draft the scope comment for the reporter after `correct`, and run Sendable?. It does not block the investigation.
9. The scope check has no manifest, no cold read, and no `gate-open`. The user approves `story.md` together with `plan.md` at Planned?.
