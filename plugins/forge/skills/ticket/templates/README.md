---
type: ticket
key: <KEY>
title: <work item summary>
short: <3 to 6 words for the session title>
item: <work item URL, or empty>
workflow: full-v4
phase: start        # start | investigate | plan | implement | review | closed
state: active       # needs-me 🟡 | go 🟢 | active ▶️ | waiting ⏳ | blocked 🔴 | done ✅
next: <one sentence>
waiting_on: ""      # "you: <gate>" | "colleague: <name> (<what>)" | "outside: <change/CI/release>" | ""
branch: ""          # set from `forge.mjs worktree` (repo.branchPattern)
worktree: ""        # the absolute worktree path, only the path
changes: []         # - { url: <change request URL>, label: "#<n>", state: draft }
people: []          # - { name: <name or handle>, role: reviewer, status: to-contact, since: <yyyy-mm-dd>, ask: "<what>", via: chat, draft: outbox/<name>.md }
                    #   status: to-contact | drafted | waiting | follow-up | reply-in | done
gates:              # approved needs date, manifest, and the full SHA-256 of the raw manifest bytes
  - { name: Planned?, doc: plan.md, need: required, status: todo }
  - { name: Shippable?, doc: review.md, need: required, status: todo }
  - { name: Learned?, doc: close.md, need: required, status: todo }
updated: <yyyy-mm-dd>
---
# <KEY>: <work item summary>

## Now

- State: ▶️ active
- Phase: start
- Open gate: none
- Next: <the same text as the frontmatter next>
- Waiting on: nobody
- Done so far: <one line: the last finished step>
- Updated: <yyyy-mm-dd>

## Files

- [story.md](story.md): the problem, the scope, and your answers
- [plan.md](plan.md): the diagnosis and the steps
- [review.md](review.md) and [proof.md](proof.md): what changed, and the proof that it works
- [map.md](map.md): the code map of the area
- [journal.md](journal.md): the dated log, the decisions, and the problems
- [evidence/](evidence/), [outbox/](outbox/), [approvals/](approvals/)
