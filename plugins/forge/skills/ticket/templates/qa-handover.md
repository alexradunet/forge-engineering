---
type: outbox
ticket: <KEY>
target: comment
status: draft          # draft | sent. Set sent when the user says it is sent, change nothing else
updated: <yyyy-mm-dd>
---
# QA handover <KEY>: <short title>

Why now: <what QA can now test, and the one thing to watch>

Target: comment on <KEY>, <work item URL>, before the ticket moves to QA. Readers: QA testers.

Need from you: paste exactly the text between the markers into the work item, then tell me. To move the ticket to QA is your step.

## Message

<!-- send: start -->
### Self-testing and QA guidance (<KEY>)

#### What changed

<2 to 4 lines in plain words. Toggle: <name>, default <value>, set in <place>.>

#### How we self-tested

| Level | What | Result |
|---|---|---|
| Unit tests | <fixtures, count> | <n> passed |
| Automated QA test | <project, test name> in <CI job #build> | passed \| failed \| none |
| Regression | <jobs and builds> | passed \| old failures only, first failing build <link> |

#### Self-QA on a deployed environment

| Check | Action | Expected | Observed |
|---|---|---|---|
| <behavior> | <exact action> | <result> | <result, tool, environment type> |

Not covered, and why: <gaps accepted by the owner, or "none">.

#### How to test it (for QA)

Preconditions: <environment, toggle value, observability tools, test data>.

1. <step with exact input>
2. <step>
3. <step>

Expected: <result of each step, and where to see it: screen, query, or log line>.
Control case: <what must not happen>.
Clean-up: <what to reset>.
Shortcut: <for example an automated test that creates the hard-to-reach condition>.

#### Regression areas and known limits

Regression areas to watch: <list>.
Known limits: <list>.
<!-- send: end -->

## Checked before GO

- No customer or customer environment names, no secrets, and no credentials.
- No links that only developers can open.
- Writing check: full pass, <remaining patterns, or "none">.

## Why this wording

<The sources: the checks of proof.md, the tests of plan.md, review.md, CI build links, and evidence files.>
