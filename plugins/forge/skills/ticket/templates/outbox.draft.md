---
type: outbox
ticket: <KEY>
target: tracker-comment   # tracker-comment | tracker-item | change | email | chat | other
status: draft          # draft | sent. Set sent after the write, change nothing else; a change draft never changes
updated: <yyyy-mm-dd>
---
# Outbox <KEY>: <target, for example "tracker comment on APP-123">

Why now: <why this message goes out>

Target: <work item | change request #<n> description | wiki or docs page | colleague>, <link>. Readers: <audience>.

Need from you: your "yes" for this one write, in the prompt of the host or in chat. Then I send exactly the text between the markers. For a change request draft in the approved Shippable? set, GO on Shippable? is the "yes".

## Message

<!-- send: start -->
<the exact text to send, in the target format, after a full pass of the `writing` skill (outbound mode)>
<!-- send: end -->

## Checked before GO

- No customer environment names, no customer data, and no secrets.
- No internal-only links for an external audience.
- Writing check: full pass, <remaining patterns, or "none">.

## Why this wording

<The sources, the facts, and the choices behind the text.>
