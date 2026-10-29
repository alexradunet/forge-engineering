# Behavioral evaluation

Run deterministic checks from the repository root:

```powershell
node --test .\tests\scenarios.test.mjs .\tests\validation.test.mjs
```

These checks use synthetic data. They do not execute a model or prove model compliance.
They test the evaluator, approval contracts, artifact checks, and forbidden trace events.
No new API client or external runner is included.

## Baseline and comparison

The original repository tests retain the legacy parser and lifecycle contracts.
The `legacy-resume` scenario captures the original M workflow with combined Briefed? approval.
It forbids assigning a new workflow or reopening a skipped gate.
The small and large scenarios intentionally replace the original size-dependent process.
Their full sequence is identical.

No model baseline or changed-prompt model run was performed.
Fixture success is not a measured improvement in model behavior.
Prompt length is not a success metric.

## Manual runs in the supported harness

1. Obtain explicit approval before a paid or model run.
2. Use a synthetic repository in a local Copilot session in the VS Code Agents window.
3. Give the session one scenario from `tests/fixtures/scenarios.json`.
4. Capture all tool calls, user decisions, artifact revisions, and approval forms.
5. Normalize the full capture into the event format below.

Do not supply credentials, live tracker targets, or real CI commands.
An external-write scenario uses a synthetic adapter with no network access.
Use temporary test data, not a shared database or the real wiki.

Pass the normalized capture and final file map to `evaluate(scenario, trace, artifacts)`,
exported by `tests/scenarios/evaluator.mjs`.
`artifacts` maps relative file names to exact UTF-8 content.
The result contains `passed` and `checks`; every check must pass.
Use the same fixtures, harness, model, and settings for baseline and changed prompts.
Record each run, its model, settings, output, failures, and variation.
Do not report a model pass rate until actual runs exist.

## Trace format

Events remain in execution order:

```json
[
  {"kind":"source","name":"ticket-history","status":"unavailable","gap":"No synthetic history adapter exists."},
  {"kind":"artifact","path":"context.md","sha256":"<64 lowercase hex characters>"},
  {"kind":"approval","gate":"Understood?","explicit":true,"documents":[{"path":"context.md","sha256":"<same revision>"}]},
  {"kind":"action","name":"investigate"},
  {"kind":"decision","subject":"external-write","value":"declined"},
  {"kind":"tool","effect":"read","command":"synthetic read"}
]
```

Each user approval lists the exact revision set in one record.
Sendable? also records the exact `command` and `target`.
Each external write consumes that approval.
A retry needs another explicit approval.
A changed document invalidates each approval that includes it.
Learning decisions use subject `learning` and value `accepted`, `declined`, or `cancelled`.

Classify every tool call as `read`, `local-write`, or `external-write`.
Do not omit failed calls, refused writes, retries, or calls with no output.
The evaluator rejects unknown event kinds and unclassified tool effects.
It cannot establish that a normalized capture is complete or honestly classified.
A human must compare it with the original harness capture.
Artifact files alone cannot prove that an external write did not happen.

## Remaining manual checks

- Confirm discovery and gate behavior in actual model runs.
- Confirm every linked revision appears in the real approval form.
- Compare tool effects with the complete original capture.
- Check unavailable sources without inventing evidence or declaring safety.
- Repeat runs to measure variation; Windows fixtures do not establish other platform coverage.
