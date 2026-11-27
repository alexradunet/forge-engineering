# Review gates: procedure, approvals, and the approval form

This file is a part of the `ticket` skill: [SKILL.md](../SKILL.md) has the words (`<F>`, `<KEY>`, `<key>`), the data rules, the gate rules, and the list of the other parts.
It has the cold read, the steps of each gate, the approval manifests, the paste texts, and the approval form.
After a compaction of the session, read this file again before you use its steps.

### 🐟 Cold read

The user reads a gate document without your session history. So test it with a reader that has none.

Before you open Planned?, Shippable?, or Learned?, run one cold read of the gate documents (the `agents` skill, "Cold read"):

1. The reader gets only the path of the document. For Planned?, it gets the paths of `story.md` and `plan.md`. It gives a paraphrase, each term or reference that it cannot resolve, and each claim without an evidence link.
2. For Planned?, it also reads `map.md`. It says if it can implement the plan from `story.md`, `plan.md`, and `map.md` alone, and it lists each missing fact.
3. Compare the paraphrase with what you mean. A wrong paraphrase shows an unclear summary. Correct the document, not the reader.
4. Add one `check` entry to `journal.md`: the findings, and what you changed.

Run it one time for each review revision. Run a second cold read only after you rewrote the summary or a full section. Do not show the findings to the user. A finding that only the user can decide becomes a `Decision` line in the summary.

### Procedure for each gate

1. Write or update the gate document from its template. Run the cold read. Run `<F> lint` and remove its warnings for this document.
2. Run `<F> gate-open <key> <gate> [extra files]`. It builds the document set and writes the manifest in `approvals/` with the SHA-256 of each file. It saves the snapshot, sets the gate to `in-review`, and sets `state: needs-me`. For Planned?, it runs the plan checks first. It prints the form text. You still set `next` and the other lines of the Now card in the same edit. When it refuses, correct what the message names, then run it again. Never write a manifest by hand.
3. Set the 🟡 title (`host.title`, see Session title) before the form.
4. Give the link to the document with `host.open`. Tell the user: add comments in the chat (`host.comments`).
5. Show the approval form (below) with `host.ask`. Do not start the blocked step.
6. Act on the answer:
   - GO: record the approval (step 8), then start the next workflow step.
   - Comments: handle the comments (step 7). Run `gate-open` again (step 2), then show the form again. For Planned? with a plan review, the form then says that the reviewers did not read the change.
   - Changes: apply the free-text request to the document. Run `gate-open` again (step 2), then show the form again. For Planned? with a plan review, the form then says that the reviewers did not read the change.
   - Hold: stop. Tell the user how to resume (`approve <gate>` in chat, or "review my comments").
7. Handle the comments. They come from `host.comments` or from the chat.
   - Answer a question in its thread, or in chat. If the answer changes the document, update the document.
   - Apply a change request to the document. Record a design change as a `decision` entry in `journal.md`, and in the gate document when the approval depends on it.
   - When a comment is not clear, ask the user. Do not guess.
   - Resolve each handled correction thread.
   - Summarize what changed in 5 lines or less before you show the form again.
8. Record the approval. For each gate, run `<F> gate-approve <key> <gate> --answer "<the exact answer of the user>" --method form|chat`. The option `--hash <the manifest SHA-256 that you showed>` is optional: the README record has the digest. It checks the answer, the manifest, and each document hash, then writes the README and `approvals/history.md`. It writes nothing when a check fails. Run it only after an explicit answer of the user, never in auto mode. Then update `state`, `next`, `updated`, and the Now card, and set the title with the new state emoji (`host.title`).

### Approval revisions

- An approval covers exact file revisions.
- `gate-open` writes a new manifest for each review revision, for example `approvals/planned-002.json`. It never overwrites an old one.
- It lists the gate documents and the evidence that the checks found. For Shippable?, it also lists `proof.md` when `policy.evidenceOnDeployedEnv` is `false`. Name each other evidence file that the user must see as an extra argument.
- It refuses `README.md`, a manifest, `approvals/history.md`, and `journal.md`.
- One explicit user approval covers the whole displayed set. Do not ask for per-file approvals.
- A change to a covered file makes the gate stale. `story.md` and `plan.md` have no second copy: after approval, do not edit them. To change one, edit it, set Planned? to `in-review`, and stop the implementation until the new GO. `approvals/snapshots/` keeps the revision of each review.
- Before any blocked action and on Resume, validate the approvals with `<F> lint`. A missing file, malformed metadata, a conflicting state, or a stale hash is a finding: show its file and its remedy. Block only the affected action. Read-only work stays possible.

### Paste texts and the change request draft

Forge sends no text. A text for a person or a tool is a paste text: the user copies it and sends it.

1. Write the draft `outbox/<target>.draft.md` from [templates/outbox.draft.md](../templates/outbox.draft.md). Run a full pass of the `writing` skill (outbound mode) on the text between the `send` markers.
2. Open the draft with `host.open`. In chat, give the send text and the draft link. Tell the user where to paste it (the `target`).
3. A paste text has no gate, no manifest, and no approval record. `<F> gate-approve` refuses it.
4. When the user says that the text is sent, set `status: sent` in the frontmatter of the draft, and change nothing else in it. Add a `log` entry to `journal.md` when the answer matters.

The draft of a new change request (`target: change` in its frontmatter) is part of the approved Shippable? set.

- Write that draft before you open Shippable?. `gate-open` adds it when it is the only change draft.
- Never edit the approved draft. An edit makes Shippable? stale and stops each later push.
- After the push, give the user the title and the body from the draft to paste in the web UI. Ask for the URL of the change request and record it in the README `changes` list.
- A later update of the description uses a new draft `outbox/change-update.draft.md`. The user pastes it.

### ✅ Approval form

Show it with `host.ask` at each gate. Use one field, `decision`, with these options. Put the gate question first in the message, for example "Planned? Are the scope and the plan for APP-123 correct?".

| Value | Title |
|---|---|
| `approve` | 🟢 GO: approve and start the next step |
| `comments` | 💬 Comments: I added comments in the chat |
| `changes` | ✏️ Changes: I typed them in the free-text answer |
| `later` | ⏸️ Hold: not now |

The message body is short. Put in it, in this order:

1. The gate question, and the link to the primary document. For Planned?, the links to `story.md` and `plan.md`.
2. The output of `<F> gate-open` (Procedure step 2):
   - The diff. First review: the summary of the document (for Planned?, of both documents), and nothing more from the document. Later review: only the changed sections and lines. Do not repeat the summary. When nothing changed, say so in one line.
   - The manifest line, with its link and SHA-256 (a 12-character display prefix is fine; the stored hash is full length), and one line for each file.
   - For Planned?: the open blockers and the concerns of the plan review, and the carry sentence when it shows.
3. State that GO approves this exact set.

- Set no default. The user must pick an option.
- If unhandled comments exist on the document, say so in the message.
- If the user declines or cancels the form, treat it as `later` (Hold).

### Review other files

Any Markdown file in the ticket folder can get a review the same way: open it with `host.open`, link it, the user adds comments, and you handle them with `host.comments`. Only gate documents need an approval record.

Open every document that the user must read with `host.open`. Examples: gate documents, `outbox/` drafts, and files that the user must edit by hand.
