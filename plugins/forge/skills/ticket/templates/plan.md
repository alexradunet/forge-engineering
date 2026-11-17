---
type: plan
ticket: <KEY>
gate: Planned?
updated: <yyyy-mm-dd>
---
# Plan <KEY>: <short title>

Cause: <the cause that we found, in one or two lines>

Change: <what we change, and why this way>

Need from you: GO on Planned?, and <n> decisions. Then I implement.

Decision 1: <question>? Recommended: <answer>.

## Diagnosis

- H1 supported: <hypothesis> ([evidence](evidence/<file>.md))
- H2 rejected: <hypothesis> ([evidence](evidence/<file>.md))
- H3 open: <hypothesis>

## Steps

1. <step title>
   - Files: [File.cs](<checkout>/path/File.cs)
   - Why: <reason>
   - Test: <the test that covers this step>

## Tests

- Unit: <test>. Checks: <what it checks>
- Integration: <test>. Checks: <what it checks>
- End-to-end: <regression scope>

## Checks

1. <changed behavior>
   - Action: <input or action>
   - Expected: <result>
   - Baseline: <the result without the fix>
   - Control: <an observation that must differ when the environment is correct>

## Risks

- 🟡 medium: <risk>. Mitigation: <text>. Rollback: <text>.

## Decisions

- <choice>: <reason>. Rejected: <option, and why>.

## Assumptions

- <open question>: we assume <text>. If wrong: <fallback>.

## Details

<Code sketches, signatures, and edge cases, only where a step needs them.>
