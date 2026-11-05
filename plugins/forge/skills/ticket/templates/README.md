---
type: ticket
key: <KEY>
title: <work item summary>
short: <3 to 6 words for the session title>
item: <work item URL>
workflow: full-v2    # new tickets; full-v1 tickets move with `forge.mjs migrate`; never infer legacy metadata
phase: start        # start | investigate | plan | implement | review | closed
state: active       # needs-me 🟡 | go 🟢 | active ▶️ | waiting ⏳ | blocked 🔴 | done ✅
next: <one sentence>
waiting_on: ""      # "you: <gate>" | "colleague: <name> (<what>)" | "outside: <change/CI/release>" | ""
branch: ""          # set from `forge.mjs worktree` (repo.branchPattern)
worktree: ""        # the absolute worktree path, only the path
changes: []         # - { url: <change request URL>, label: "#<n>", state: draft }
people: []          # - { name: <name or handle>, role: reviewer, status: to-contact, since: <yyyy-mm-dd>, ask: "<what>", via: tracker, draft: outbox/<name>.md }
                    #   status: to-contact ✉️ | drafted 📝 | waiting ⏳ | follow-up 🔔 | reply-in 📥 | done ✅
gates:              # approved needs date, manifest, and full raw-manifest SHA-256 hash
  - { name: Scoped?, doc: scope.md, need: required, status: todo }
  - { name: Planned?, doc: plan.draft.md, need: required, status: todo }
  - { name: Sendable?, doc: outbox/, need: required, status: todo }
  - { name: Shippable?, doc: review.md, need: required, status: todo }
  - { name: Learned?, doc: close.draft.md, need: required, status: todo }
updated: <yyyy-mm-dd>
---
# 🎫 Ticket (<KEY>): <summary>

> 🔥 <one line: why this ticket matters>

## 📍 Now

- **State:** ▶️ active
- **Phase:** start
- **Open gate:** None
- **Next:** <the same text as the frontmatter next>
- **Waiting on:** nobody
- **Done so far:** <one line: the last finished step>
- **Open questions:** None
- **Updated:** <yyyy-mm-dd>

Update this card in the same edit as the frontmatter. `forge.mjs lint` warns when State, Phase, or Next do not agree with it.

## 🧭 How this ticket works

Every new ticket follows research → visual briefing → interview → Scoped? →
investigation → plan → Planned? → implementation → Shippable? →
Evidence Testing → conditional QA handover → Learned? → distillation and archive.
Sendable? applies to each external write, including earlier phases.
Do not use this template to replace existing legacy metadata or recorded skips.

At review, add `manifest: approvals/<gate>-001.json` to the gate. After explicit user GO,
record `date` as the approval date and `hash` as the full SHA-256 of raw manifest bytes.
The manifest lists the exact displayed file/revision set, excluding this README and
approval records. Planned? includes both byte-identical plan files and
`approvedCopies: [{ "from": "plan.draft.md", "to": "plan.md" }]`.
For each Sendable? review, replace `doc: outbox/` with the exact draft path, not
its approval sidecar. Its manifest also binds the exact `command` and `target`.

## 🧰 Toolkit

| Need | Tool |
|---|---|

**📁 All files**

- [map.md](map.md): 🗺️ code map. Start here to understand the area.
- [scope.md](scope.md), [plan.draft.md](plan.draft.md), [review.md](review.md), [close.draft.md](close.draft.md): the gate docs. Read them from the top and stop at any level.
- [ticket.md](ticket.md), [context.md](context.md), [briefing.md](briefing.md), [interview.md](interview.md), [investigation.md](investigation.md), [plan.md](plan.md)
- [troubleshooting.md](troubleshooting.md), [decisions.md](decisions.md), [log.md](log.md), [evidence/](evidence/)
- [outbox/](outbox/), [test-plan.md](test-plan.md), [evidence-testing.md](evidence-testing.md), [approvals/](approvals/)
