# Ticket state: README, people, session title, and overview

This file is a part of the `ticket` skill: [SKILL.md](../SKILL.md) has the words (`<F>`, `<KEY>`, `<key>`), the data rules, the gate rules, and the list of the other parts.
It has the README frontmatter, the Now card, the people list, the session title, the artifacts panel, and the ticket overview.
After a compaction of the session, read this file again before you use its steps.

### 🏷️ Frontmatter

The ticket README starts with YAML frontmatter (`type: ticket`), see [templates/README.md](../templates/README.md). Check it against this table after each README change.

| Key | Values |
|---|---|
| `key`, `title` | `APP-123`, the work item summary (required) |
| `short` | 3 to 6 words for the session title and the board, for example `Doc import error telemetry` |
| `workflow` | `full-v3` |
| `phase` | `start`, `investigate`, `plan`, `implement`, `review`, `closed` (required) |
| `state` | `needs-me` 🟡, `go` 🟢, `active` ▶️, `waiting` ⏳, `blocked` 🔴, `done` ✅ (required; same as the session title emoji) |
| `next`, `waiting_on` | one line each |
| `item`, `branch`, `worktree`, `updated` | work item URL, branch name, the absolute worktree folder path only, `yyyy-mm-dd`. The sessionStart hook compares `worktree` with the session folder. |
| `changes` | change requests: list of `{url, label, state}`; `state`: `draft`, `open`, `merged`, `closed`, `abandoned`. |
| `people` | list of `{name, status, role, since, ask, via, draft, note}`; `name` and `status` required; `since` is `yyyy-mm-dd`; `draft` is `outbox/<name>.md`. See People. |
| `gates` | list of `{name, doc, need, status, date, hash, manifest, note}`; `status`: `todo`, `in-review`, `approved`, `skipped`, `blocked`. An approved gate needs the approval `date`, the `manifest` path, and the `hash` of the raw manifest bytes. |

- The README body starts with the **Now** card: State, Phase, Open gate, Next, Waiting on, Done so far, and Updated. Update it with each frontmatter change. `<F> lint` warns when State, Phase, or Next does not match the frontmatter. The hook shows the card when a session opens.
- Every other document has `type`, `ticket`, and `updated`. A gate document also has `gate`. The gate status lives only in the README `gates` list.
- `outbox/` drafts have authoring `status` and optional `target` (`tracker-comment`, `tracker-item`, `change`, `email`, `chat`, `other`). `evidence/` files have `date`.
- Quote a value that contains `: `, or the YAML does not parse.

### 👥 People

The README `people` list holds every person you work with on the ticket, in every phase.
It is the source for the people on the canvas, the board, and the daily recap.

- Add people when they appear: reporter and experts at Start, the PO or domain owner at the interview, reviewers at the change request, QA at the QA handover.
- Write a name or tracker handle only. Never store email addresses, phone numbers, or other personal data.
- Keep one entry per person. Put all open asks for that person in one `ask` line.
- Set `since` to today on each status change. The board and the recap show waits from this date.
- The README is outside approval manifests. A people change never reopens a gate.

| Status | Meaning | Who acts |
|---|---|---|
| `to-contact` | The user must send a message; no draft yet | user |
| `drafted` | An `outbox/` draft is ready; the user must review and send it | user |
| `waiting` | The message is sent; waiting for the answer | them |
| `follow-up` | No answer in time; the user must send a reminder | user |
| `reply-in` | The answer arrived; the user or agent must record and act on it | user |
| `done` | Nothing open with this person | nobody |

Map the status of an **Open questions** line to the person status:

| Question status | Person status |
|---|---|
| `draft` | `to-contact`, or `drafted` when an outbox draft exists |
| `asked` | `waiting` |
| `no reply` | `follow-up` |
| `answered` | `reply-in` until the answer is recorded, then `done` when no other ask is open |

- When the user confirms a sent message (or a Sendable? write to a person is `sent`), set `waiting`.
- Suggest `follow-up` when a person is `waiting` for more than 3 working days. Change the status only after the user agrees.
- When a person blocks the next step, set `waiting_on: "colleague: <name> (<what>)"`.
- Ask the user before you add a person that no ticket source names.

### 🏷️ Session title (info bar)

The user asked for these titles. The ticket skill owns the title of a ticket session. This rule overrides the general tool advice not to rename a fresh chat.

```text
<KEY> - <state emoji> - <short>
```

| State emoji | When |
|---|---|
| 🟡 | a gate or a question waits for the user |
| 🟢 | the last gate is approved, and no gate is open |
| ▶️ | no gate is open and nothing blocks; the work continues |
| ⏳ | the work waits for an outside event, for example a change request review or a build |
| 🔴 | a failure stops the work, for example CI or an expired credential |
| ✅ | the ticket is closed |

- `<short>` is the README `short`: a phrase in sentence case that says what the ticket tries to achieve, for example `Fix outbox retry on timeout`. Do not repeat the key, the phase, or the gate name. Keep it stable.
- Use only these emoji in the title. Do not end the title with `?`: some hosts remove a final `?`. Keep the title under 60 characters.
- Set the title (`host.title`) first, before any other tool call or question, when the session starts or resumes a ticket. Follow the extra steps of the host row.
- Set it again at each change of the state emoji or the goal. Before a `host.ask` question that waits for the user, set 🟡 first.
- The `board` skill and the maintenance automation can fix a stale title of a ticket session.

### 📌 Artifacts panel

The artifacts panel of the host (`host.artifact`) shows what this session works on.

- At Start and Resume, record the ticket `README.md` as an artifact with the label `<KEY> · Now`.
- When a gate opens, record its primary document with the label `<KEY> · <gate> · <file>`, for example `APP-123 · Planned? · plan.md`. Remove the document of a gate that is approved.
- Record a change request that the session creates or changes as an artifact. Record the work item URL as a reference.
- Do not record evidence files, snapshots, or the journal.
- The panel can be off, or the host has no panel. Then the host row gives a Markdown link instead.

### 📋 Ticket overview

When the user asks for "the board", "my tickets", or a ticket status, use the `board` skill. `<F> board --json` reads the README frontmatter of each ticket folder and groups the tickets by `state`. `<F> board` writes the same view to `<wiki>/raw/board.md`. The README frontmatter stays the source.

- Start `waiting_on` with `you:`, `colleague:`, or `outside:`.
- When a gate is `in-review` or `waiting_on` starts with `you:`, set `state: needs-me`.
