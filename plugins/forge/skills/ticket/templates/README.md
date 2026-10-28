---
type: ticket
key: <KEY>
title: <work item summary>
item: <work item URL>
track: M            # S | M | L
phase: start        # start | investigate | plan | implement | review | closed
state: active       # needs-me 🟡 | go 🟢 | active ▶️ | waiting ⏳ | blocked 🔴 | done ✅
next: <one sentence>
waiting_on: ""      # "you: <gate>" | "colleague: <name> — <what>" | "outside: <change/CI/release>" | ""
branch: <from repo.branchPattern>
worktree: ""        # <VS Code session name> — <worktree path>
changes: []         # - { url: <change request URL>, label: "#<n>", state: draft }
gates:              # status: todo | in-review | approved | skipped ; approved needs date
  - { name: Understood?, doc: context.md, need: required, status: todo }
  - { name: Agreed?, doc: interview.md, need: required, status: todo }
  - { name: Diagnosed?, doc: investigation.md, need: recommended, status: todo }
  - { name: Designed?, doc: plan.draft.md, need: required, status: todo }
  - { name: Sendable?, doc: outbox/, need: required, status: todo }
  - { name: Shippable?, doc: review.md, need: required, status: todo }
  - { name: Learned?, doc: close.draft.md, need: required, status: todo }
updated: <yyyy-mm-dd>
---
# 🎫 Ticket — <KEY>: <summary>

> 🔥 <one line: why this ticket matters>

Status, next step, gates, and change requests live in the frontmatter above. The ticket overview in chat reads them.

## 🧰 Toolkit

| Need | Tool |
|---|---|

**📁 All files**

- [map.md](map.md) — 🗺️ code map: start here to understand the area
- [ticket.md](ticket.md), [context.md](context.md), [interview.md](interview.md), [investigation.md](investigation.md), [plan.md](plan.md), [plan.draft.md](plan.draft.md)
- [troubleshooting.md](troubleshooting.md), [decisions.md](decisions.md), [log.md](log.md), [evidence/](evidence/)
- [outbox/](outbox/), [review.md](review.md), [test-plan.md](test-plan.md), [evidence-testing.md](evidence-testing.md)
