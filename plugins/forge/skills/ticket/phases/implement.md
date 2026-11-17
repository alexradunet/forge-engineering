# Implement and review

This file is a part of the `ticket` skill: [SKILL.md](../SKILL.md) has the words (`<F>`, `<KEY>`, `<key>`), the data rules, the gate rules, and the list of the other parts.
It has the steps from the Planned? approval to the Shippable? gate and the change request.
After a compaction of the session, read this file again before you use its steps.

## 🛠️ Implement

- Read the `## Implement` policy section first.
- Use the `agents` skill to select the execution worktree (see Worktrees). Continue in a suitable current worktree; start another session only when needed. Do not edit code in the main checkout.
- Validate Planned? and its manifest before implementation. Unverifiable evidence blocks implementation, not read-only research.
- Follow the repository's own instructions and skills for the code change.
- After each plan step, add a `step <n> done` entry to `journal.md` with the commit or the files and the test result. Set **Change** to `done` in `map.md` for the components of that step.
- For a quick code review before Shippable?, use a reviewer subagent (the `agents` skill).
- Before Shippable?, and so before any push or change request (draft too), run the adversarial review subagent (the `agents` skill, "Adversarial review"). Handle its findings. Record them in **Findings** of `review.md`.
- Find the end-to-end and regression tests that cover the changed code (search the test projects for the changed classes, jobs, and features). Add them to **Tests** of `map.md`.
- Write `review.md` from [templates/review.md](../templates/review.md): the summary, **Changes** (area, files, why, user impact), **Before and after** when the behavior changes, **Tests run**, **Findings**, and **Not checked**. If no regression test covers the change, write that in **Not checked**. Then open Shippable?.
- Draft every external text (tracker comment, change request title and description, shared document) in `outbox/<target>.draft.md` from [templates/outbox.draft.md](../templates/outbox.draft.md). Run a full pass of the `writing` skill (outbound mode) on the text between the `send` markers. Send only that text. Run Sendable? before the write.
- Open the change request with `repo.open-change` after Shippable? and Sendable?. Add it to the README `changes` list.
- When end-to-end or regression tests exist, run the relevant ones (and the whole suite when the risk is wide) on a deployed branch before you mark the change request ready. The `## Implement` policy section can make this stricter. Ask the user before each deploy or CI trigger (`ci.trigger`). Show the job and its parameters first.
- Record test results, change request links, and CI results (`ci.status`) as `log` entries in `journal.md`. Record build and test problems as `problem` entries.
- Set the phase to `implement` and then to `review` in `README.md`.
- After Shippable? and the change request, run the Evidence Testing step ([evidence.md](evidence.md)). Do not report a change request as ready to merge before that step is done.
