---
type: outbox
ticket: <KEY>
target: comment   # comment | change | email | chat | other
status: draft          # draft | sent. Set sent when the user says it is sent, change nothing else; a change draft never changes
updated: <yyyy-mm-dd>
---
# Outbox <KEY>: <target, for example "comment on APP-123">

Why now: <why this message goes out>

Target: <work item | change request #<n> description | wiki or docs page | colleague>, <link>. Readers: <audience>.

Need from you: paste exactly the text between the markers at the target, then tell me. Forge sends nothing. For a change request draft, I give you the text after the push.

## Message

<!-- send: start -->
<the exact text to paste, in the target format, after a full pass of the `writing` skill (outbound mode)>
<!-- send: end -->

## Checked before GO

- No customer environment names, no customer data, and no secrets.
- No internal-only links for an external audience.
- Writing check: full pass, <remaining patterns, or "none">.

## Why this wording

<The sources, the facts, and the choices behind the text.>
