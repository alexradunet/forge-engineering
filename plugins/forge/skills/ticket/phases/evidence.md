# Evidence Testing and QA handover

This file is a part of the `ticket` skill: [SKILL.md](../SKILL.md) has the words (`<F>`, `<KEY>`, `<key>`), the data rules, the gate rules, and the list of the other parts.
It has the proof of the changed behavior before a merge, and the handover to QA after it.
After a compaction of the session, read this file again before you use its steps.

## 🔬 Evidence Testing

Evidence Testing is a separate step between review and merge. It proves that the changed behavior works, with concrete evidence. Regression runs alone are not enough, because they only show that old behavior still works.

Read the `## Evidence Testing` policy section before you start. It names the deploy procedure, the observation tools, and the known traps of the company environments.

Rules:

1. Run it on every ticket that changes behavior, before any merge proposal. Never propose or accept a merge without it.
2. Start it after Shippable? and the change request. When a deployed branch is needed, the code must be pushed first.
3. Set the README `next` key to "Evidence Testing" while it is open. Keep the phase `review`.
4. Write `proof.md` from [templates/proof.md](../templates/proof.md). Copy each check from **Checks** of the approved `plan.md`, with the status `open`. Update the file as you go. `proof.md` is outside the approval manifests, so its updates reopen no gate.
5. Test the changed functionality itself. When `policy.evidenceOnDeployedEnv` is `true`, do it in a deployed environment whenever a deployment is possible. Use a local run only when no deployment is possible, and write the reason in `Environment:`. Unit tests, mutation checks, and regression runs alone are not evidence. Each check has the action, the expected result, the observed result, and the evidence: query output, log or telemetry line, screenshot, API response, or job link.
   - Check the baseline first. Ask: does this check also pass without the fix? If yes, the environment cannot show the change. Example: a test environment that never samples telemetry passes "events are not sampled" with or without the fix. Change the environment, or pick another observation.
   - Check that the observed items are not exempt by other means. Example: some event types can set their own sampling rate, so they look correct with or without the fix. Search the code for the emitter before you trust an observation.
   - A deployed run can finish with no proof (no traffic, wrong event type, telemetry not flowing). Then mark the check `⚪ not proven` with the reason. Never write a pass from rows that the baseline also produces.
   - Add a control: a second observation with the same tool in the same environment, with a result that you know before the run (for example, the log records an event that the code without the fix already emits). A check without a working control is `⚪ not proven`, never `🟢 verified`.
   - Test environments can expire. Plan the traffic for right after the deploy, or extend the lifetime.
   - A deploy can use a throwaway branch with test-only config. Never open a change request from it. Delete it after the run.
6. Put each check output in `evidence/<yyyy-mm-dd>-<topic>.md`. Link it from the check. Store only aggregated or masked data (see Data rules).
7. Cover the unhappy path where the ticket has one (error, threshold, empty input, feature toggle off).
8. Ask the user if an automated test would bring evidence. Do this when you start the checks, with `host.ask`:
   - Search the test projects for a fitting project and for helpers that you can reuse.
   - Propose the test: what it does, what it asserts, which CI job runs it, and the cost.
   - Say what it cannot prove (for example telemetry that the test cannot read). Then name the other check that closes the gap.
   - A manual check that needs database or admin access that the agent lacks is a strong reason to propose a test. CI environments often have that access.
   - Options: "Add an automated test", "Manual evidence only", "Not now". Record the answer in **Automated test** of `proof.md`.
   - A new test is a code change. It needs a new commit, a new review, and Shippable? again before the push.
9. Add the regression evidence to **Regression**: unit tests, regression and suite runs (job, run number, result, link), and old failures with their first failing run.
10. Mark a check `🟢 verified`, `🔴 failed`, or `⚪ not proven: <why>`. Do not leave `open` as a final state. A check that is not possible needs the explicit acceptance of the user in **Accepted gaps**.
11. Ask the user before each deploy, CI trigger, or database write. Show the job or the exact steps first. Never write to a database without approval. Do not escalate access (for example secret store or firewall changes) on your own.
12. A failed check goes to `journal.md` as a `problem` entry, and back to Implement.
13. The step is done when every check is `🟢 verified` (or an accepted `⚪`). Add a `step <n> verified` entry to `journal.md` for each step that a check proves. Then write the new description in `outbox/change-update.draft.md` (the approved change request draft stays as it is), run Sendable?, update the description with `repo.update-change`, and tell the user that the change request can be merged. Never suggest a merge on a day in `policy.noMergeWeekdays`.
14. When the change request has all approvals (`repo.change-status`) and Evidence Testing is done, report it and stop. The user merges in the web UI of the repository host. Record the merge as a `log` entry when the user reports it.
15. After the merge, run the QA handover (next section) when `policy.qaHandover` is `true`. Else go to Close when the user says that the ticket is done.

## 🧑‍🔬 QA handover

Run it only when `policy.qaHandover` is `true`. Run it after the user reports the merge, or when the user says that the ticket goes to QA. Do it before Close. It tells QA what we tested, and how QA can test the change.

Read the `## QA handover` policy section first. It can set the comment format, the QA status, and the QA tools.

1. Write `outbox/qa-handover.draft.md` from [templates/qa-handover.md](../templates/qa-handover.md). The tracker comment is the text between the `send` markers. Draft it from `proof.md`, `plan.md`, `review.md`, and `map.md`. Do not invent results. Link the evidence files only in "Why this wording", because QA cannot open the wiki.
2. The comment has these parts, in this order, in plain words for a tester: what changed (with the toggle), how we self-tested, the self-QA on a deployed environment (one row for each check of `proof.md`, and the accepted gaps), how to test it (preconditions, numbered steps with exact inputs, the expected result, one control case, clean-up, shortcuts), and the regression areas and known limits.
3. Write for QA: no code paths unless QA needs them, no customer environment or customer names, no secrets, no credentials, and no links that only developers can open. Use the same words as the work item.
4. Run the Sendable? steps for the draft. Send the comment with `tracker.comment` only after the "yes" for this write.
5. Do not transition the work item yourself. Ask the user whether to move it to QA, and show the target status first. After a yes, use `tracker.transition`. Send the comment before the transition, so that QA finds it.
6. Record the comment id or link and the time as a `log` entry in `journal.md` (Sendable? step 6). Do not change the draft.
7. If QA finds a problem later, add a `problem` entry to `journal.md` and, when it changes the test guidance, send a short follow-up comment (same Sendable? rule).
