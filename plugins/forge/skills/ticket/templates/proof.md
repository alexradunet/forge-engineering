---
type: proof
ticket: <KEY>
updated: <yyyy-mm-dd>
---
# Proof <KEY>: <short title>

Result: <n> of <m> checks verified.

Environment: <the deployed environment type, or the reason for a local run>

## Checks

1. 🟢 verified | 🔴 failed | ⚪ not proven | open: <changed behavior>
   - Action: <input or action>
   - Expected: <result>
   - Observed: <result> ([evidence](evidence/<file>.md))
   - Baseline: <the result of the same check without the fix>
   - Control: <the observation that differs, so the environment is correct>

## Regression

- <job or suite>, run <n>: pass | fail ([link](<link>))
- Old failure: <test>, first failing run <link>

## Accepted gaps

- ⚪ Check <n>: <why it is not possible>. Accepted by the user on <yyyy-mm-dd>.

## Automated test

- <the user answer to "add an automated test?", and the test when one was added>
