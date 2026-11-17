# Investigate and plan

This file is a part of the `ticket` skill: [SKILL.md](../SKILL.md) has the words (`<F>`, `<KEY>`, `<key>`), the data rules, the gate rules, and the list of the other parts.
It has the steps from the Scoped? approval to the Planned? gate.
After a compaction of the session, read this file again before you use its steps.

## 🔎 Investigate

- Start only after Scoped? is fresh. Investigate every ticket, also a small fix.
- Start `plan.md` from [templates/plan.md](../templates/plan.md) with only the **Diagnosis** section: one line for each suspected cause, with the status `open`, `supported`, or `rejected`.
- Save each tool result that supports a finding as `evidence/<yyyy-mm-dd>-<topic>.md`, with the tool and its parameters, the time window, and a sanitized excerpt. Link each hypothesis to its evidence file.
- Add each verified code fact to `map.md`: the components with their layer, the flow, the data, the toggles, the jobs, and the tests. Remove `(unverified)` when you verify a guess.
- Read-only tools that the `## Investigate` policy section allows do not need approval. CI reads (`ci.status`, `ci.logs`) do not need approval.
- Write each environment, build, and test problem with its fix as a `problem` entry in `journal.md`. Append one `log` entry per work session.
- Update `phase`, `state`, `next`, `updated`, and the Now card in `README.md`.

### 🛑 Diagnosis stop

When the cause or the facts do not fit the approved scope, stop before the plan steps. Set 🟡 in the title, then ask with one `host.ask` question. The message has at most 150 words: what you found (max 3 lines), why it changes the scope, and the evidence link. Options:

| Value | Title |
|---|---|
| `rescope` | 🎯 Change the scope: reopen Scoped? |
| `keep` | ➡️ Keep the scope: plan within it and note the gap |
| `later` | ⏸️ Hold: not now |

- `rescope`: add a `decision` entry to `journal.md`, update `story.md`, and run Scoped? again. The Scoped? approval is no longer fresh.
- `keep`: write the gap and its risk in **Risks** of the plan, and continue.
- Never choose for the user.

## 📝 Plan

1. Verify that Scoped? is fresh.
2. Make the plan with the user. Complete `plan.md`: the summary, then **Steps** (each with `Files:`, `Why:`, and `Test:`), **Tests**, **Checks** (one deployed check for each changed behavior, with its baseline and control, or the reason why none is possible), **Risks**, **Decisions** (choice, reason, rejected options), and **Assumptions** for open colleague questions. Leave out a section that has no content.
3. In **Components** of `map.md`, set **Change** to `planned` for each component that a step changes.
4. Set `phase: plan` in the README. Set `next` to the Planned? review.
5. Open Planned? (see the gate Procedure). The manifest lists `plan.md`, and each evidence file that the user must see.
6. After GO, do not edit `plan.md`. A change to the plan reopens Planned? and stops the implementation until the new GO.

Implementer sessions and later sessions read the approved `plan.md` and `map.md` from the ticket folder.
