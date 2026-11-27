---
name: agents
description: Coordinate work across agent sessions (Copilot CLI, Claude Code). Reuse a suitable Git worktree or start an implementer session, run a reviewer subagent, hand work from one session to another, and report the status of sessions. Use when asked to "start an implementer", "hand this off", "run a reviewer", "review this diff", "work on these in parallel", "what are my sessions doing", or when the ticket skill reaches Implement.
---

# 🤖 Agent sessions

> When your context has no `End of Forge context.` line, or a `Forge context part <i> of <n>` part is
> missing or has a different id, run `node "<plugin>/scripts/forge.mjs" context` first and follow its output. `<plugin>`
> is two folders above the folder of this file. When the command fails, read
> [forge.md](../../context/forge.md) (the `forge` rule), and [style.md](../../context/style.md) (the `style` rule) unless `policy.styleRules` is `false`.

The host is the orchestrator. A task can continue in its current isolated session.
This skill decides when to use which host verb (the `# Forge host` table). It does not repeat the host documentation.

```mermaid
flowchart LR
  lead["Current session<br/>(ticket, plan)"] --> check{"Suitable worktree?"}
  check -->|yes| reuse["Implement here"]
  check -->|no| impl["Implementer session<br/>verified worktree"]
  lead -->|subagent| rev["Reviewer subagent<br/>(read-only)"]
  lead -->|host.message| impl
  impl -->|user reviews the diff| pr["Change request<br/>(user merges in the host web UI)"]
```

## 🧭 Choose the tool

| Need | Use | Visible as |
|---|---|---|
| Implement an approved plan in a suitable current worktree | continue here after the checks below | the current session |
| Implement without a suitable current worktree, or delegate an independent task | a new session (`host.spawn`) after the checks below | a new session |
| Quick review, research, or a check | a subagent (Claude Code: `Agent`, Copilot CLI: `task`) | nothing; the result comes back here |
| Test a gate document on a reader without the session history | a cold read subagent (see "Cold read") | nothing; the result comes back here |
| Test if the plan of `plan.md` is right | a plan review subagent (see "Plan review") | nothing; the result comes back here |
| Give more work or a correction to a running session | `host.message` | a message in that session |
| Status of my sessions | `host.sessions` | nothing; the result comes back here |

## 🛠️ Implementer session

1. Check the gate first. For a ticket, validate fresh plan-gate revision evidence before starting implementation. For `workflow: full-v4`, that is Planned?: verify the manifest, its raw-byte SHA-256, and every covered document (`story.md`, `plan.md`, and the listed evidence). Unverifiable approval blocks implementation, not read-only resume.
2. Select the execution worktree with the checks below. Continue here when it is suitable. Do not start another implementer merely because the ticket reached Implement. `<F>` means `node "<plugin>/scripts/forge.mjs"`, where `<plugin>` is the folder two levels above this skill. `<F> worktree <KEY> --summary "<short>"` gives the ticket branch, the folder, and the suggested action (see "Worktrees" in the `ticket` skill).
3. Only when another session is needed, start it with `host.spawn`:
   - title: `<KEY> - ▶️ - <short>` (for example `APP-123 - ▶️ - Implement outbox retry on timeout`). The session keeps it current. See "Session title" in the `ticket` skill.
   - folder: the verified worktree path when one already exists; otherwise the checkout from `repo.checkouts` or the task repository.
   - a new worktree: only when no suitable worktree exists (see "Select the execution worktree"). Never assume that a new worktree selects the ticket branch or a required commit. For a pinned baseline, use the pinned baseline step below.
4. Write a self-contained `prompt`:
   - the goal, and the paths to the approved `story.md` and `plan.md`, and to `map.md` (the code map of the area)
   - the ticket's workflow marker (`full-v4`), README, and approval manifest/record paths; revalidate the exact approved revisions before editing, and stop if stale or unverifiable
   - the branch name from `repo.branchPattern`, as `<F> worktree` prints it (see "Worktrees" in the `ticket` skill).
   - the selected worktree, repository identity, branch, resolved baseline SHA, and whether the task requires an exact HEAD or resumes existing implementation. Verify these before edits, builds, or fixtures. Continue in that worktree; do not delegate again merely to obtain isolation.
   - the scope, and what is out of scope
   - the stop condition: "Stop after the tests pass and report. Do not push or create a change request."
   - the report: changed files and the tests run, in a form that the lead session can copy into `map.md` and `review.md`
   - the rules: never call a tracker, a change request host, or a CI tool; never merge; plus the rules of the `## Implement` section of `<config>/policy.md`
   - the main session rules, in short form. A session that `host.spawn` starts runs the Forge `sessionStart` hook, which gives the `forge`, `style`, and company rules. When a capability row names an MCP server and its tools are not in the session, it asks the ticket session to do that step. When the hook fails, the prompt is its only source of the rules. Include the response style with the "No AI tells" list of the `style` rule, the paths `<wiki>` and the ticket folder as resolved absolute paths, and the safety rules above.
5. Give the user the command of `host.spawn` only when a new session was needed.
6. Record the session title, worktree path, branch, baseline SHA, and selection reason in the ticket `README.md` and as a `log` entry in `journal.md` (`log.md` in an older ticket). Keep approval records outside hashed documents.

### Select the execution worktree

Read the ticket `README.md`, approved plan, and current request. Inspect Git in the actual session folder, not only the main checkout:

- Run `git rev-parse --show-toplevel`, `git rev-parse --git-common-dir`, `git worktree list --porcelain`, `git branch --show-current`, `git rev-parse HEAD`, and `git status --short`.
- Verify the repository against the configured checkout. Identify a linked worktree from Git, not its folder name or branch prefix.
- Select the baseline in this order: an explicit required commit; the recorded ticket branch for existing work; the checkout `baseBranch` (else `repo.baseBranch`) only for a new task without a ticket branch. Resolve the selected ref to a full commit SHA. If it is missing, ambiguous, or conflicts with ticket evidence, stop and ask. Do not silently use the default branch.

| Situation | Action |
|---|---|
| Current linked worktree belongs to this task and meets its baseline rule | Reuse the current session. A different generated branch name alone does not require another worktree. |
| Another recorded worktree belongs to this task and meets its baseline rule | Resume its existing session, or start a session there (`host.spawn` with that path as the folder). |
| No suitable worktree exists | Create one from the selected baseline: `<F> worktree <KEY> --summary "<short>" --base <full SHA> --create`, after one `host.ask` confirmation. Then move this session to the new folder (`host.move`), or start a session there (`host.spawn`). Verify its actual HEAD before any edits, builds, or fixtures. |
| Repository, task ownership, or local changes are uncertain | Report the evidence and ask before switching, moving, or replacing work. |

Baseline rules:

- For an exact-commit proof, require `HEAD == required commit`. Being ahead by 15 commits is still a mismatch. Do not weaken this check to ancestry.
- For resumed implementation, preserve known task commits and local edits. Verify the recorded baseline is an ancestor with `git merge-base --is-ancestor <baseline> HEAD`, and inspect the intervening commits and diff. Ancestry alone does not prove that the changes belong to this task.
- Never reset, force-switch, stash, delete, or change the approved baseline to make these checks pass. A mismatch blocks execution, not read-only diagnosis. Do not edit approved documents or their manifests to repair it.

Pinned baseline step:

1. Create the worktree from the required SHA: `<F> worktree <KEY> --summary "<short>" --base <full SHA> --create`, after one `host.ask` confirmation. Never move an existing branch to that SHA.
2. Give the new session a self-contained prompt with the absolute ticket path and the required SHA. Require the Git checks above before execution.
3. After verification, continue in that session. Do not create another worktree at Implement.

Limits:

- A Git worktree shares local resources (for example a database) with the main checkout. The `## Implement` section of `<config>/policy.md` names the limits.
- Run at most `policy.maxImplementers` implementer sessions at the same time (default 6).
- Worktree end of life: Git does not remove repository resources, for example a database per worktree. See the `ticket` skill Close step.

## 🔎 Reviewer subagent

Use a subagent for a quick review. It stays inside the current session.

1. Give it the diff source: a worktree path, a branch, or a change request number.
2. Give it the plan or acceptance criteria to check against.
3. Ask for findings only: bugs, risks, missing tests. No style comments. No edits.
4. Verify each finding before you report it to the user.

## 🐟 Cold read

Required before each review gate of a `full-v4` ticket (Planned?, Shippable?, Learned?). The session that wrote a gate document knows more than the document says. The user reads the document later, without that knowledge. A subagent without the session history reads it the same way and shows what is missing.

1. Start a subagent with the subagent tool (Claude Code: `Agent`, Copilot CLI: `task`; a `general-purpose` or read-only research agent). When the host lets you select a model, a model family different from your own finds more.
2. Give it only this, and nothing from the session:
   - the absolute path of the gate document (for Planned?, the paths of `story.md` and `plan.md`), and for Planned? also the path of `map.md`
   - "Read this document and the files that it links. Do not read other ticket files. Read-only: no edits, no commits."
   - "Answer in 4 parts. (1) Say in at most 5 lines what the document asks the user to approve. (2) List each term, name, or reference that you cannot resolve from the document and its links. (3) List each claim that has no link to evidence or code. (4) List each place where two statements do not agree."
   - for Planned?: "(5) Can you implement this plan from `story.md`, `plan.md`, and `map.md` alone? List each fact that you must guess."
3. Do not give it the goal, the history, or your own summary. A reader that has your context cannot find what the document lacks.
4. Compare part 1 with what you mean. When they differ, the summary is not clear: correct the document. Add each missing term to the document or to **Terms** of `map.md`. Add each missing link. Add each fact that an implementer must guess to the plan.
5. Record one `check` entry in `journal.md`: the findings in short form, and what you changed.
6. Run one cold read for each review revision. Run it again only after you rewrote the summary or a full section. This check has no loop and no second reviewer: a small fix gets one short read.

The cold read tests the document. It does not approve a gate, and it does not replace the adversarial review of the code.

## 🧐 Plan review

Run it before Planned?, after the cold read, only when `policy.planReview` is `attacker` or `panel`. The cold read tests if the document is clear. The plan review tests if the plan is right. It does not approve a gate.

1. The reviewer is a subagent with no session history. It is read-only, and it has access to the code.
2. Use the model in `policy.adversarialReviewModel`. When it is empty and the host lets you select a model, use a model family different from your own.
3. Give it only this: the paths of `story.md`, `plan.md`, and `map.md`, the path of the ticket worktree (or the checkout), and the baseline commit SHA. Do not give your conclusions or the session history.
4. `attacker`: start one subagent with this prompt text:

   > Read `story.md`, `plan.md`, and `map.md` at the given paths. The code is in the given worktree, at the given commit. Try to break the plan. Look for:
   > - a place that the plan does not list: a caller, a consumer, a job, a toggle, or a config
   > - a fact about the code that is wrong
   > - a step that fails on a retry, on a partial failure, or under load
   > - a missing rollback or data migration
   > - a behavior of **Preserve** that the plan breaks
   > - a simpler option that **Decisions** does not reject
   > - an assumption that only a run can prove, with the cheapest run for it
   >
   > Give each finding a severity (`blocker`, `concern`, or `nit`), the file and the line as evidence, and the correction. Read-only: no edits, no commits, no style comments.

5. `panel`: start 3 subagents at the same time. They get the same inputs and the same report shape as `attacker`. Each has one role:
   - **Design Critic**: does the plan solve the Problem of `story.md`? Which options did it not examine? What fails under load, on a retry, or on a partial failure?
   - **Codebase Auditor**: does each path, symbol, and signature of the plan exist at the baseline SHA? Which callers does the plan not list?
   - **Operability Reviewer**: idempotency, rollback, data migration, observability, and the **Preserve** list.
6. Verify each finding before you act on it. Reject it with evidence, or correct the plan.
   - A `blocker` must be resolved, or it becomes a `Decision` line for the user.
   - A `concern` is listed.
   - A `nit` is dropped.
7. Run 2 rounds at most. In round 2, only a reviewer that gave a blocker reads the corrected plan. There is no round 3. A blocker that is still open goes to **Open blockers** of the review file and to a `Decision` line.
8. Write the review file `evidence/plan-review-NNN.md`. NNN has 3 digits and is the next free number. Use this shape:

   ```markdown
   ---
   type: evidence
   ticket: <KEY>
   date: <yyyy-mm-dd>
   plan-sha256: <SHA-256 of the raw bytes of plan.md after your last edit>
   mode: attacker | panel
   rounds: 1 | 2
   ---
   # Plan review <KEY> NNN

   ## Open blockers
   - <reviewer>: <finding>. Evidence: <file:line>. Done: <what you did>.

   ## Concerns

   ## Resolved

   ## Rejected
   ```

   - Write each finding in one bullet, with its reviewer, its evidence, and what you did.
   - Write `plan-sha256` only after your last edit of `plan.md` in this round, and never change it later.
   - To get the hash, run `<F> gate-open <key> planned --dry-run`. It prints the hash when no review covers the plan. You can also use the hash tool of the shell.
   - `gate-open` shows **Open blockers** and **Concerns** in the form text. Write them for the user: plain words, one line each.
9. Add one `check` entry to `journal.md`: the mode, the rounds, the counts by severity, and what changed in the plan.

## 🥊 Adversarial review

Required before every change request, including a draft, and before a push to the base branch when the repository has no change requests. It is a second, hostile read of the change. It tries to break it.

1. Run it after the tests pass and before you write the final `review.md`. Do not run it on a half-done change.
2. Before the run, get the code values from Forge: `<F> gate-open <key> shippable --dry-run` prints the `head` and the `patch-id`. Write them down. The reviewer does not give them.
3. Start a read-only reviewer subagent with the subagent tool (Claude Code: `Agent`, Copilot CLI: `task`). Use the `rubber-duck` agent type (Copilot CLI) or a `code-review` or `general-purpose` agent with a review-only prompt. Use the model in `policy.adversarialReviewModel` unless the user names another model. When it is not set, pick a model family different from your own. A model different from the author finds different bugs.
4. Give it a complete prompt (the subagent has no memory of this session). The reviewer is blind: it gets only this, and nothing about what was changed, why, or which decisions the user made:
   - the worktree path
   - the base commit and the head commit
   - the absolute paths of `story.md` and `plan.md`
   - specific attack questions: missed places, wrong assumptions, SDK or API behavior, tests that pass without the fix, flaky or order-dependent tests, side effects beyond the goal (EOL, BOM, accidental edits), CI and build risks
5. Tell it: read-only, no edits, no commits, no style comments, rank findings by severity with file, line, and evidence. It returns its report.
6. Run it in the background. Do not poll. Continue with independent work, or wait for the notification.
7. Save the report word for word in `evidence/code-review-NNN.md` (the next number). Start the file with this frontmatter: `type: evidence`, `ticket`, `date`, `head` and `patch-id` (the values of step 2), and `reviewer` (the model). Do not edit the saved report.
8. Verify each finding yourself. Reject a finding with evidence, or fix it and add a test where it applies.
9. Write what you did with each finding (fixed or rejected, and why) in **Findings** of `review.md`, with a link to the code review file, and add a `check` entry in `journal.md`.
10. If the review changes the code, commit the fixes and run the affected tests again. You do not need a second review for the fixes: `gate-open <key> shippable` lists each commit after the reviewed `head` as "not read by a reviewer", so the user sees them. If it changes the approved story or the approved plan, open Planned? again.

Never create a change request until step 9 is done.

## 🔁 Hand-off

- Plan → implement: obtain one approval over the exact displayed revision set (Planned?). Then reuse a suitable current worktree or start the implementer as described above. Native plan-mode approval alone does not approve the ticket gate.
- More work for a running session: `host.message`. Queue it. Interrupt the active turn only to correct it.
- Each message states the goal, the scope, and the stop condition.
- `host.message` does not wait for a reply. Do not poll. Tell the user that the message is sent, then stop.

## 📊 Status

Only when the user asks:

1. `host.sessions`: find the blocked sessions first, then read a summary of the sessions that matter.
2. Report one line per session: title, status, last result, and what it needs from the user.

## 🚫 Rules

- Never answer a session's question, trust prompt, or permission prompt for the user. Report it.
- Never merge a change request. The user merges in the web UI of the repository host.
- A policy section can allow a host-side agent to fix blockers. It never allows a merge.
- Delete or archive only sessions that the user asks you to remove.
- Verify a session's claims (tests, builds) before you build on them.
