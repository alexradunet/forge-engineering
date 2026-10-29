---
type: outbox
ticket: <KEY>
target: tracker-comment
status: draft          # authoring metadata; freeze all bytes at review
updated: <yyyy-mm-dd>
---
# 🧑‍🔬 QA handover — <KEY>: <short title>

> 🔥 <one line: what QA can now test and the one thing to watch>

> **Target:** tracker comment on <KEY>, before the ticket moves to QA.
>
> **What I need from you:** GO on Sendable?. After GO, I send exactly the text between the markers. Moving the ticket to QA is a separate question.
>
> **Reading time:** about <n> minutes.

Use a unique Sendable? manifest for this comment. Retain the exact draft path,
`approval_manifest`, `approval_hash`, and `approval_date` in a separate per-write
`outbox/qa-handover.approval.json` sidecar outside the hashed set, with `version: 1`,
`doc`, exact `target`, and exact `command`. After the write set sidecar `status: sent`
and `result` to the returned URL/id. Never stamp those fields or change status in this approved draft.
The hashed manifest includes exact `command` and `target`; sidecar values must
match both exactly. README Sendable? `doc` names this draft, not the sidecar.
The QA transition is a separate write needing its own approval and record.

## 📊 At a glance

| | |
|---|---|
| 📍 Where | <work item URL> |
| 👥 Who reads it | QA testers |
| 🔁 Action | comment |
| 🔀 Change request | <link>, merged <yyyy-mm-dd> |

## 📝 Message

<!-- send: start -->
**Self-testing and QA guidance — <KEY>**

**What changed**
<2 to 4 lines in plain words. Toggle: <name>, default <value>, set in <place>.>

**How we self-tested**

| Level | What | Result |
|---|---|---|
| Unit tests | <fixtures, count> | 🟢 <n> passed |
| Automated QA test | <project, test name> in <CI job #build> | 🟢 \| 🟡 \| ➖ none |
| Regression | <jobs and builds> | 🟢 \| 🟡 <old failures only, first failing build> |

**Self-QA on a deployed environment**

| Check | Action | Expected | Observed |
|---|---|---|---|
| <behavior> | <exact action> | <result> | <result, tool, environment type> |

Not covered, and why: <gaps accepted by the owner, or "none">.

**How to test it (for QA)**

Preconditions: <environment, toggle value, observability tools, test data>.

1. <step with exact input>
2. <step>
3. <step>

Expected: <result of each step, and where to see it: screen, query, or log line>.
Control case: <what should NOT happen>.
Clean-up: <what to reset>.
Shortcut: <for example an automated test that creates the hard-to-reach condition>.

**Regression areas to watch**: <list>.
**Known limits**: <list>.
<!-- send: end -->

> ⚠️ **Warning:** Check before GO: no customer or customer environment names, no secrets or credentials, no links that only developers can open.

**📂 Why this wording**

<sources: evidence-testing.md checks, test-plan.md, review.md, CI build links, evidence files>

## ❓ Decisions needed

1. Move <KEY> to <target status> after the comment is sent? (separate tracker write, ask first)
2. <max 4 more items, or "None — GO only">
