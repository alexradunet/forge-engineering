---
noMergeWeekdays: []
evidenceOnDeployedEnv: false
qaHandover: false
learningMode: false
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
| `learningMode` | Offer optional, source-linked lessons for unfamiliar concepts in artifact comments | `false` |
| `adversarialReviewModel` | Model of the adversarial reviewer. Empty means a model different from the author's | empty |
| `maxImplementers` | Maximum implementer sessions at the same time | `6` |

## 🪝 Hook sections

The `ticket` and `agents` skills read one section below at each step, and follow it.
Write the step rules and traps there. Delete the hint text of a section that you fill in.
Rules for each session (tools, credentials, data rules) go in the `<wiki>/rules/` pages, not here.
A section can add steps and make rules stricter. It can never weaken a core rule
(no merge, ask before every external write, explicit gate approval, no secrets,
and the adversarial review before every change request). When a rule here conflicts
with a core rule, the agent follows the core rule and tells the user.

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

Hint: more wiki folders and knowledge owners. The cleanup command for a worktree and its local resources (for example a database per worktree).
