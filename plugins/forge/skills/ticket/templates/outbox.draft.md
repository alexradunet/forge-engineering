---
type: outbox
ticket: <KEY>
target: tracker-comment   # tracker-comment | tracker-item | change | email | chat | other
status: draft          # authoring metadata; freeze all bytes at review
updated: <yyyy-mm-dd>
---
# 📤 Outbox draft — <KEY>: <target, for example "tracker comment on APP-123">

> 🔥 <why this message goes out now>

> **Target:** <work item \| change request #<n> description \| wiki or docs page \| colleague>
>
> **What I need from you:** GO on Sendable?. After GO, I send exactly the text between the markers below.
>
> **Reading time:** about <n> minutes.

This write needs its own Sendable? manifest covering this exact draft. Include
the exact `command` and `target` in that hashed manifest too; sidecar values must
match them exactly. The README gate's `doc` names this draft, never the sidecar.
Store `approval_manifest`, `approval_hash` (full raw-manifest SHA-256), `approval_date`
(user approval date), the draft path, and delivery status in a separate per-write
`outbox/<name>.approval.json` sidecar outside the hashed set, together with `version: 1`,
`doc`, exact `target`, and exact `command`. Create it only after explicit GO; after
sending set its `status: sent` and `result` to the returned id/URL.
Do not insert those fields or stamp `sent` into
this draft after approval: that would change the approved bytes. Retain this
write's record when the README gate moves to the next write.
Validate sidecars when present; a missing sidecar does not prove a send occurred.

## 📊 At a glance

| | |
|---|---|
| 📍 Where | <link to the target> |
| 👥 Who reads it | <audience> |
| 🔁 Action | create \| edit \| comment \| transition |

## 📝 Message

<!-- send: start -->
<the exact text to send, in the target format>
<!-- send: end -->

> ⚠️ **Warning:** Check before GO: no customer environment names, no customer data, no secrets, no internal-only links for an external audience.

**📂 Why this wording**

<sources, facts, and choices behind the text>

## ❓ Decisions needed

1. <max 5 items, or "None — GO only">
