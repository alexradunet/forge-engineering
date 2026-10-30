---
type: ticket
key: <KEY>
title: <work item summary>
item: <work item URL>
workflow: full-v1    # new tickets only; never infer or migrate legacy metadata
phase: start        # start | investigate | plan | implement | review | closed
state: active       # needs-me 🟡 | go 🟢 | active ▶️ | waiting ⏳ | blocked 🔴 | done ✅
next: <one sentence>
waiting_on: ""      # "you: <gate>" | "colleague: <name> — <what>" | "outside: <change/CI/release>" | ""
branch: <from repo.branchPattern>
worktree: ""        # <VS Code session name> — <worktree path>
changes: []         # - { url: <change request URL>, label: "#<n>", state: draft }
people: []          # - { name: <name or handle>, role: reviewer, status: to-contact, since: <yyyy-mm-dd>, ask: "<what>", via: tracker, draft: outbox/<name>.md }
                    #   status: to-contact ✉️ | drafted 📝 | waiting ⏳ | follow-up 🔔 | reply-in 📥 | done ✅
gates:              # approved needs date, manifest, and full raw-manifest SHA-256 hash
  - { name: Understood?, doc: context.md, need: required, status: todo }
  - { name: Agreed?, doc: interview.md, need: required, status: todo }
  - { name: Diagnosed?, doc: investigation.md, need: required, status: todo }
  - { name: Designed?, doc: plan.draft.md, need: required, status: todo }
  - { name: Sendable?, doc: outbox/, need: required, status: todo }
  - { name: Shippable?, doc: review.md, need: required, status: todo }
  - { name: Learned?, doc: close.draft.md, need: required, status: todo }
updated: <yyyy-mm-dd>
---
# 🎫 Ticket — <KEY>: <summary>

> 🔥 <one line: why this ticket matters>

Status, next step, gates, and change requests live in the frontmatter above. The ticket overview in chat reads them.
Every new ticket follows research → Understood? → visual briefing → interview → Agreed? →
investigation → Diagnosed? → plan → Designed? → implementation → Shippable? →
Evidence Testing → conditional QA handover → Learned? → distillation and archive.
Sendable? applies to each external write, including earlier phases.
Do not use this template to replace existing legacy metadata or recorded skips.

At review, add `manifest: approvals/<gate>-001.json` to the gate. After explicit user GO,
record `date` as the approval date and `hash` as the full SHA-256 of raw manifest bytes.
The manifest lists the exact displayed file/revision set, excluding this README and
approval records. Designed? includes both byte-identical plan files and
`approvedCopies: [{ "from": "plan.draft.md", "to": "plan.md" }]`.
For each Sendable? review, replace `doc: outbox/` with the exact draft path, not
its approval sidecar. Its manifest also binds the exact `command` and `target`.

## 🧰 Toolkit

| Need | Tool |
|---|---|

**📁 All files**

- [map.md](map.md) — 🗺️ code map: start here to understand the area
- [ticket.md](ticket.md), [context.md](context.md), [interview.md](interview.md), [investigation.md](investigation.md), [plan.md](plan.md), [plan.draft.md](plan.draft.md)
- [troubleshooting.md](troubleshooting.md), [decisions.md](decisions.md), [log.md](log.md), [evidence/](evidence/)
- [outbox/](outbox/), [review.md](review.md), [test-plan.md](test-plan.md), [evidence-testing.md](evidence-testing.md)
- [briefing.md](briefing.md), [approvals/](approvals/)
