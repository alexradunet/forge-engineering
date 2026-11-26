---
noMergeWeekdays: []
evidenceOnDeployedEnv: false
qaHandover: false
adversarialReviewModel:
planReview: attacker
styleRules: false
scopeComment: false
maxImplementers: 6
gateGuard: deny
---

# 🛡️ Policy

> forge reads this file as `config/policy.md`. `forge-setup` copies it from `templates/config/` only when it is missing.
> It holds the step rules of the team. `policy.<key>` in the skills means the frontmatter key `<key>` of this file.

## ⚙️ Values

| Key | Meaning | Default |
|---|---|---|
| `noMergeWeekdays` | Days on which the agent never proposes a merge, for example a release day | `[]` |
| `evidenceOnDeployedEnv` | The proof of the changed behavior needs a deployed environment. `true`: Evidence Testing runs after the push. `false`: it runs before Shippable?, and `proof.md` is in the Shippable? manifest. | `false` |
| `qaHandover` | Run the QA handover step after the merge | `false` |
| `adversarialReviewModel` | Model of the adversarial reviewer. Empty means a model different from the author's | empty |
| `maxImplementers` | Maximum implementer sessions at the same time | `6` |
| `planReview` | Review of the plan before Planned?: `off`, `attacker` (one reviewer subagent), or `panel` (3 reviewer subagents). A missing key means `off`. This template sets `attacker`. | `off` |
| `styleRules` | Add the response style rules of the plugin (Simplified Technical English, no AI tells, the ADHD response shape) to each session. A missing key means `true`. This template sets `false`. | `true` |
| `scopeComment` | After the scope check, draft a tracker comment for the reporter with the scope and the open questions (it needs your yes as each write) | `false` |
| `gateGuard` | The gate guard (a preToolUse hook) for a push or a new change request of a ticket without the valid approvals of Planned? and Shippable?: `deny`, `ask` (the host asks you), or `off` | `deny` |

Small team: `planReview=attacker`, `scopeComment=false`, `evidenceOnDeployedEnv=false`, `qaHandover=false`.
Large team: `planReview=attacker`, `scopeComment=true`, `evidenceOnDeployedEnv=true`, `qaHandover=true`.
`set up forge` asks for the team size and the response style. It writes one set and `styleRules`.

## 🪝 Hook sections

The `ticket` and `agents` skills read one section below at each step, and follow it.
Rules for each session (tools, credentials, data rules) go in the `<wiki>/rules/` pages, not here.
A section can add steps and make rules stricter. It can never weaken a core rule
(no merge, ask before every external write, explicit gate approval, no secrets,
and the adversarial review before every change request). When a rule here conflicts
with a core rule, the agent follows the core rule and tells the user.

## Start

1. Read the work item (`tracker.fetch`) and its comments.
2. Read the linked issues and pull requests.

## Investigate

- Read the old pull requests that changed the same files (`repo.history`).
- The main checkout is the first row of `repo.checkouts`.

## Resume

- Hint: add the steps that a resumed ticket needs, for example a check of a credential that expires.

## Implement

- Before the first edit, read the root `AGENTS.md` and the `AGENTS.md` of each folder that you change. For code rules, they win over forge.
- Each commit subject and the pull request title start with the key, for example `GH-123 Add retry backoff to the queue`.
- The pull request description has `Closes #<n>`, so that GitHub closes the issue at the merge.
- Keep review fixes as separate commits.

## Evidence Testing

- Unit tests alone are not evidence. Check the baseline and add a control.
- Name the workflow run that ran the tests (`ci.status`).

## QA handover

- The comment goes to the work item (`tracker.comment`). Send it only after Sendable?.

## Close

- Put each durable finding in the wiki page that the `wiki` skill gives for it.
