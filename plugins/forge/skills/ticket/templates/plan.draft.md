---
type: plan-draft
ticket: <KEY>
gate: Planned?
updated: <yyyy-mm-dd>
---
# 📝 Plan (<KEY>): <short title>

## ⚡ 1 min

> 🔥 <the payoff in one line, for example "312 queries → 2 queries per call">

> **TL;DR:** <max 3 lines: the cause we found, what we change, and why>
>
> **What I need from you:** GO on Planned?. After GO, implementation uses a verified worktree. Reuse the current one when suitable.

**❓ Decisions needed**

1. <max 3 one-line items with the recommended answer, or "None (GO only)">

## ☕ 5 min

### 📊 At a glance

| | |
|---|---|
| 🔎 Cause | <one line, from investigation.md> |
| 🧩 Steps | <n> |
| 📄 Files | <n> |
| 🧪 Tests | <unit n> · <integration n> · <end-to-end scope> |
| ⚠️ Risk | 🟢 low \| 🟡 medium \| 🔴 high: <one line> |

### 🗺️ Change map

```mermaid
flowchart LR
  A[<component>] --> B[<component>]
  B --> C[<component>]
  classDef changed fill:#ffd54f,stroke:#f57f17,color:#000
  class B changed
```

### 🛠️ Steps

| # | Step | Files | Why |
|---|---|---|---|
| 1 | <step> | [File.cs](<checkout>/path/File.cs) | <reason> |

## 📖 10 min

### 🔎 Diagnosis

| # | Hypothesis | Status | Evidence |
|---|---|---|---|
| H1 | <text> | 🟢 supported \| 🔴 rejected | [evidence](evidence/<file>.md) |

<The diagnosis agrees with the approved scope. When it does not, stop and ask before you write this plan.>

### 🔀 Before and after

| | 🔴 Before | 🟢 After |
|---|---|---|
| Behavior | | |
| Cost (queries, time, calls) | | |

### 🧪 Test plan

| Kind | Test | What it checks |
|---|---|---|
| Unit | | |
| Integration | | |
| End-to-end | | |
| Deployed check | | <baseline and control, or why none is possible> |

### ⚠️ Risks and rollback

| Risk | Chance | Impact | Mitigation | Rollback |
|---|---|---|---|---|

## 🔬 15 min

### 🛠️ Step details

<Code sketches, signatures, and edge cases for each step.>

### 🤝 Assumptions for open colleague questions

| Question | Assumption | Fallback if wrong |
|---|---|---|

## 📂 Appendix

Before review, stage `plan.md` as a byte-identical copy of this draft. The Planned?
manifest lists both plan files, `investigation.md`, `decisions.md`, and `test-plan.md`, with their raw-byte
SHA-256 hashes, and `approvedCopies: [{ "from": "plan.draft.md", "to": "plan.md" }]`.
GO approves the whole displayed revision set. The staged plan is not permission to
implement before approval. Keep the approval record outside these hashed documents.

- Investigation: [investigation.md](investigation.md)
- Decisions: [decisions.md](decisions.md)
- Test plan: [test-plan.md](test-plan.md)
- Code map: [map.md](map.md)
