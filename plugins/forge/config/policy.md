---
noMergeWeekdays: []
evidenceOnDeployedEnv: false
qaHandover: false
adversarialReviewModel:
maxImplementers: 6
---

# 🛡️ Policy

> forge reads this file as `config/policy.md`. `forge-setup` copies it from `templates/config/`.
> `policy.<key>` in the skills means the frontmatter key `<key>` of this file.

## ⚙️ Values

| Key | Meaning | Default |
|---|---|---|
| `noMergeWeekdays` | Days on which the agent never proposes a merge, for example `[Thursday]` | `[]` |
| `evidenceOnDeployedEnv` | Evidence Testing must use a deployed environment when one is possible | `false` |
| `qaHandover` | Run the QA handover step after the merge | `false` |
| `adversarialReviewModel` | Model of the adversarial reviewer. Empty means a model different from the author's | empty |
| `maxImplementers` | Maximum implementer sessions at the same time | `6` |

## 🪝 Hook sections

The `ticket` and `agents` skills read one section below at each step, and follow it.
Write company rules, tools, and traps there. Delete the hint text of a section that you fill in.
A section can add steps and make rules stricter. It can never weaken a core rule
(no merge, ask before every external write, explicit gate approval, no secrets,
and the adversarial review before every change request). When a rule here conflicts
with a core rule, the agent follows the core rule and tells the user.

## Toolkit

Hint: a table of needs and tools. For example: build and run, deploy, logs, company guidance.

## Data rules

Hint: rules for data and approvals. For example: which tools need approval, which data must not leave a ticket folder.

## Start

Hint: extra steps when a ticket starts. For example: read linked design pages.

## Investigate

Hint: read-only tools that need no approval, and where the main checkout is.

## Resume

Hint: checks when a ticket resumes. For example: credentials that expire.

## Implement

Hint: limits of worktrees and of implementer sessions. Implementer prompts include this section.

## Evidence Testing

Hint: how to deploy a test environment, how to observe it, and the known traps.

## QA handover

Hint: where the comment goes, the QA status, and the QA tools.

## Close

Hint: more wiki folders and knowledge owners.
