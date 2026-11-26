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
2. **Design options.** Before the Steps, show 2 or 3 solution options in chat. For each option, give one line for the change, its main risk, and its cost. Give your recommendation and its reason. Ask with one `host.ask`. Never choose for the user. Record the choice and each rejected option in **Decisions**. When only one option is possible, write the reason in **Decisions** and do not ask.
3. Make the plan with the user. Complete `plan.md`: the summary, then **Steps** (each with `Files:`, `Why:`, and `Test:`), **Tests**, **Checks** (one deployed check for each changed behavior, with its baseline and control, or the reason why none is possible), **Risks**, **Decisions** (choice, reason, rejected options), and **Assumptions** for open colleague questions. Leave out a section that has no content. Write `(new)` directly after the link of a file that a step creates.
4. In **Components** of `map.md`, set **Change** to `planned` for each component that a step changes.
5. **Baseline run.** Run the Baseline and the Control of each Check now, before the user sees the plan.
   - Use the limits of a spike (see Spikes in [start.md](start.md)): read-only tools and local runs. Ask before a tool that needs approval. Do not deploy and do not trigger CI without a "yes".
   - Save each output as `evidence/<yyyy-mm-dd>-baseline-<n>.md`. Link it on the `Baseline:` or `Control:` line.
   - When a run is not possible now, write `not run: <why>` on that line.
   - Compare the baseline with Expected. A baseline that gives the Expected result means that the check cannot show the change. Change the check.
   - A baseline that does not show the problem of the story means that the cause is wrong. Go back to the Diagnosis.
   - A control that does not give its known result means that the environment cannot observe. Correct the environment, or use another observation.
6. Set `phase: plan` in the README. Set `next` to the Planned? review.
7. **Plan review.** Read `policy.planReview`.
   - `off`: go to the next step.
   - `attacker` or `panel`: run the cold read first. Then run the plan review (the `agents` skill, "Plan review").
   - Resolve each blocker: correct the plan, or write it as a `Decision` line in the summary for the user. List the concerns. Drop the nits.
   - Do not edit `plan.md` after the last round, because the review file names its hash.
8. Open Planned? with `<F> gate-open <key> planned` (see the gate Procedure). It adds `plan.md`, the linked evidence files, and the review file to the manifest. Name each other evidence file that the user must see as an extra argument.
9. After GO, do not edit `plan.md`. A change to the plan reopens Planned? and stops the implementation until the new GO. When `policy.planReview` is not `off`, the changed plan needs a new plan review.

Implementer sessions and later sessions read the approved `plan.md` and `map.md` from the ticket folder.
