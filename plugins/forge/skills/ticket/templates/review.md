---
type: review
ticket: <KEY>
gate: Shippable?
updated: <yyyy-mm-dd>
---
# Review <KEY>: <short title>

Result: <what the code does now, in one or two lines, with a number when one exists>

Risk: 🟢 low | 🟡 medium | 🔴 high: <one line>

Need from you: GO on Shippable?, and <n> decisions. Then I push and open the change request.

Decision 1: <question>? Recommended: <answer>.

## Changes

- <area>: <what changed, and why>. Files: [File.cs](<checkout>/path/File.cs). User impact: <text>

## Before and after

- Before: <behavior or cost>
- After: <behavior or cost>

## Tests run

- <command or suite>: <result> ([evidence](evidence/<file>.md))

## Findings

Code review: [evidence/code-review-NNN.md](evidence/code-review-NNN.md)

- <high | medium | low>: <finding of the adversarial review>. Fixed | Rejected: <what you did, or the evidence against it>

## Not checked

- <what the review could not check, and why>
