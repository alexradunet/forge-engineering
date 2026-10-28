---
name: ticket
description: Ticket workspace for work items from any tracker (Jira, GitLab, GitHub, or none). Sizes each ticket into a track (S, M, L) with matching review gates, keeps all working artifacts (work item snapshot, context, code map, investigation, evidence, plan, troubleshooting, decisions, log) in <wiki>/raw/tickets/<key> (the wiki of the repository, ../<repo>.wiki), shared by all sessions in the VS Code Agents window, and distills them into canonical wiki pages when the ticket is done. Use when asked to "start ticket APP-123", "work on APP-123", "resume APP-123", "where are we on the ticket", "record this finding", "save the plan to the ticket", "upgrade the ticket track", "show the code map", "close the ticket", or "archive the ticket".
---

# 🎫 Ticket workspace

One folder per ticket holds all working artifacts. Every session reads
and writes it. When the ticket is done, you distill the folder into canonical
wiki pages, then you move the folder to the archive.

`<wiki>` is the wiki of the current repository. Get it with `forge.mjs where` once per session (see the `forge` rule).

## ⚙️ Config, words, and policy

Read the team config once per session: `node "<plugin>/scripts/forge.mjs" config --json`.
`<plugin>` is the folder two levels above this skill. `config` holds the frontmatter of the
Markdown files in `<config>` (`tracker.md`, `repo.md`, `ci.md`, `policy.md`). The `forge` rule
explains the `<file>.<key>` notation and how to run a capability.

| Word in this skill | Meaning |
|---|---|
| work item | the item in the tracker that `<config>/tracker.md` describes (for example a Jira, GitLab, or GitHub issue, or a local Markdown item) |
| `<KEY>` | the work item key as `PREFIX-number`, for example `APP-123`. GitLab and GitHub numbers get `tracker.prefix`. |
| `<key>` | the lower-case key, for example `app-123`. It names the ticket folder. |
| change request | a pull request or merge request. Use the word in `repo.changeName` (`PR` or `MR`) when you talk to the user. |
| checkout | a local clone from `repo.checkouts`. The main checkout is the first row. |
| `tracker.*`, `repo.*`, `ci.*` | a capability. Its command is in the matching config file (see the `forge` rule). |
| policy section | a `## <name>` section of `<config>/policy.md`, for example `## Start` |

- When a capability is `manual`, tell the user the exact manual step, and wait.
- At each hook point (`Toolkit`, `Data rules`, `Start`, `Investigate`, `Resume`, `Implement`, `Evidence Testing`, `QA handover`, `Close`), read that policy section, and follow it. Ignore a section that holds only a hint.
- A policy section can add steps and make rules stricter. It can never weaken a core rule (see Data rules). If a policy rule conflicts with a core rule, follow the core rule and tell the user.
```mermaid
flowchart LR
  S[🚀 Start + track] --> I[🔎 Investigate] --> P[📝 Plan] --> M[🛠️ Implement] --> C[✅ Close]
  S -. creates .-> R[(raw/tickets/key)]
  I -. writes .-> R
  P -. writes .-> R
  M -. writes .-> R
  R -. grows .-> MAP[map.md code map]
  C -- distill --> W[(canonical wiki pages)]
  C -- move --> A[(archive/tickets/key)]
```

Two goals for every ticket:

1. Deliver the change with the right amount of process for its size (see Tracks).
2. At Close, the user knows the affected areas, how the feature lives in the code, and what it is used for. `map.md` and the Close debrief carry this.

This skill does not repeat other tools. Use them:

| Need | Use |
|---|---|
| Wiki page format, index, log | the `wiki` skill |
| Worktree sessions, implementers, reviewers, hand-off | the `agents` skill |
| Tracker, repository host, and CI actions | the capabilities in `<config>` (see the `forge` rule) |
| Build, run, deploy, and company tools | the repository's own instructions and skills, and the `## Toolkit` policy section |
| Company guidance | the sources that the policy sections name |
| Session plan inside Copilot | plan mode (`plan.md` in session state) |
| Human review of ticket documents | VS Code comment threads (see Review gates) |
| Ticket board, ticket pages, visual briefing | `node "<plugin>/scripts/board.mjs" [--ticket <key>]` (see Board) |
| Frontmatter check | `node "<plugin>/scripts/board.mjs" --check [--ticket <key>]` (see Frontmatter) |

## 🗂️ Folder layout

The folder name is `<key>`, for example `app-123`.

```text
<wiki>/raw/tickets/<key>/
  README.md          frontmatter: phase, state, track, next, waiting_on, branch, change requests, gates; body: toolkit, files
  ticket.md          work item snapshot
  context.md         pre-investigation brief: problem, history, related work, open questions, people to ask
  map.md             living code map: purpose, flow, files, data, tests, changes (grows in every phase)
  briefing.json      data for the visual briefing (written by the agent, shown by the board)
  interview.md       scope questions and user answers
  investigation.md   hypotheses table and findings
  evidence/          sanitized tool outputs, one file per item
  plan.md            approved implementation plan
  plan.draft.md      proposed plan awaiting explicit approval
  outbox/            drafts of external writes (tracker comments, change request text), awaiting approval
  review.md          code review summary before push or change request (diff, tests, risks)
  test-plan.md       manual, deploy, and regression test plan and results
  evidence-testing.md  Evidence Testing step: one check per changed behavior, with concrete evidence (required before merge)
  outbox/qa-handover.draft.md  tracker comment for QA after the merge: self-testing, self-QA, and how to test (see QA handover)
  close.draft.md     proposed wiki changes before close
  troubleshooting.md problems and fixes (environment, build, tests)
  decisions.md       decisions and reasons
  log.md             append-only dated work log
```

## 🔒 Data rules

- `raw/` and `archive/` can hold names of customer environments (for example tenant or instance names).
- `raw/` and `archive/` can hold aggregated metrics: counts, durations, row totals, plan shapes.
- Never store customer row data, document content, personal data, secrets, tokens, or connection strings.
- Canonical pages (outside `raw/` and `archive/`) stay free of customer environment names.
- Ask before every tracker write: create, edit, transition, comment, or log work.
- Ask before every CI trigger, rebuild, or stop (`ci.trigger`). Show the job and its parameters first.
- Never merge a change request. No provider has `repo.merge`. The user merges in the web UI of the repository host. Reviewer approvals and green checks do not change this.
- Close a change request only after explicit user approval in the current conversation.
- Never offer a merge on a weekday in `policy.noMergeWeekdays` (local time). Propose the next allowed day.
- When the user must edit a file by hand (for example a connection string or a secret), open every such file in VS Code yourself with `code <path> [<path>...]`, and list the exact edits in chat. Never write the secret yourself.
- Read the `## Data rules` policy section. It adds rules to this list.

These core rules always win over a policy section: no merge, ask before every external write, explicit gate approval, no secrets, and the adversarial review before every change request.

`ask_user` below means the question form of the harness. When it is not available, ask in chat and wait for the answer.

## 📏 Tracks

At Start, choose a track. Propose it with a reason, then confirm it with `ask_user`. Record it in the README `track` key.

| Track | Use when | Phase order | Required gates |
|---|---|---|---|
| **S** small | One area, clear fix, no customer data, about 1 day or less | brief → plan → implement → evidence testing → QA handover → close | Designed?, Sendable?, Shippable?, Learned? |
| **M** medium (default) | Some unknowns, 1 to 3 areas | brief → interview → plan → implement → evidence testing → QA handover → close | Briefed? (one gate), Designed?, Sendable?, Shippable?, Learned? |
| **L** large | Production incident, many areas, unclear history or owner | context → briefing → interview → investigation → plan → implement → evidence testing → QA handover → close | Understood?, Agreed?, Diagnosed? (recommended), Designed?, Sendable?, Shippable?, Learned? |

```mermaid
flowchart LR
  S0[Start + track] --> T{Track}
  T -->|S| S1[brief] --> P[plan · Designed?]
  T -->|M| M1[brief + interview · Briefed?] --> P
  T -->|L| L1[context · Understood?] --> L2[briefing] --> L3[interview · Agreed?] --> L4[investigation · Diagnosed?] --> P
  P --> I[implement] --> R[review · Shippable?] --> E[Evidence Testing] --> M[merge by user] --> Q[QA handover comment · Sendable?] --> C[close · Learned?]
```

- The user can change the track at any time ("upgrade to L"). Log the change in `decisions.md` and update the README `gates` list.
- Upgrade on your own proposal when a fact breaks the track rule (for example, customer data or a second area appears in track S). Ask first.
- In the README `gates` list, set a gate that the track skips to `status: skipped` with `note: track S`.
- In track M, Understood? and Agreed? are one gate, `Briefed?`. Its documents are `context.md` and `interview.md`. One approval ("approve Briefed?") approves both.
- Sendable? and Shippable? are required on every track.
- Evidence Testing is a step, not a gate. It is required on every track and has no approval form. It blocks the merge proposal (see Evidence Testing).
- The QA handover (a tracker comment for QA after the merge) runs on every track when `policy.qaHandover` is `true`. It uses Sendable?, not a new gate. When it is `false`, remove the step from the phase order.
- Tickets without a `track` key use the full flow (track L) until the user picks a track on Resume.

## 🚦 Review gates

The user reviews ticket artifacts with VS Code comment threads at these gates:

| Gate | Step | Document | Need | Opens before |
|---|---|---|---|---|
| Understood? | Context | `context.md` + linked `evidence/` | required (L), part of Briefed? (M), skipped (S) | the scope interview |
| Agreed? | Scope | `interview.md` | required (L), part of Briefed? (M), skipped (S) | investigation work on the agreed scope |
| Diagnosed? | Investigation | `investigation.md` + linked `evidence/` | recommended (L), skipped (S, M) | the plan draft |
| Designed? | Plan | `plan.draft.md` + `decisions.md` | required | implementation |
| Sendable? | External write | `outbox/` drafts | required | each tracker, document, or change request text write |
| Shippable? | Code | `review.md` | required | push or change request creation |
| Learned? | Close | `close.draft.md` | required | canonical wiki writes and the archive move |

Open colleague questions do not block a gate. See Pre-investigation.

Each gate name is the question that the user answers by approval. The user approves with `approve <name>`, with or without the `?` and in any case (`approve designed`).

### 🧾 Gate document shape

Every gate document uses the plain ticket style. Read [templates/_style.md](templates/_style.md) and copy the template for the document (see Templates).

- The short version comes first: key fact, TL;DR quote, glance table, diagram.
- Long details go under a bold `**📂 <label>**` line. Do not drop information to make a document shorter.
- Do not use HTML (`<details>`) or GitHub alerts (`[!NOTE]`). The Agents window preview does not render them.
- Link each fact to its evidence file or to code (`[File.cs](<checkout>/path/File.cs:42)` with the absolute checkout path, which opens in VS Code).
- End with **❓ Decisions needed** (max 5 items). Write "None — GO only" when it is empty.
- Explain each term that the user may not know, in plain words, or link to its row in `map.md`.

Procedure for each gate:

1. Write or update the gate document.
2. Set the gate to `status: in-review` in the README `gates` list, and `state: needs-me`. Set the state emoji of the session title to 🟡.
3. Open the document next to the session: run `code -r "<absolute path>"` with the shell tool in `async` mode (the command can block for 30 seconds or more). Also give the user a Markdown link to it. Tell the user: add comments in the editor, or send them with VS Code's comment submit button.
4. Show the approval form (below) with `ask_user`. Do not start the blocked step.
5. Act on the answer:
   - **GO**: record the approval (step 7), then start the next step of the track.
   - **Comments**: handle the comments (step 6), then show the form again.
   - **Changes**: apply the free-text request to the document, then show the form again.
   - **Hold**: stop. Tell the user how to resume (`approve <gate>` in chat, or "review my comments").
6. Handle the comments (`listComments`). Comments sent with VS Code's submit button (`/act-on-feedback`) arrive the same way:
   - Answer a question with `replyToComment`. If the answer changes the artifact, update the artifact.
   - Apply a change request to the artifact. Record design changes in `decisions.md`.
   - When a comment is not clear, ask the user. Do not guess.
   - Resolve each comment that you handled with `resolveComments`.
   - Summarize what changed in 5 lines or less before you show the form again.
7. Record the approval:
   1. Get the hash: `(Get-FileHash <document> -Algorithm SHA256).Hash`.
   2. Append to `decisions.md`: the date, the gate, the document, the hash, the method (`form` or `chat`), and the user's exact answer.
   3. In the README `gates` list, set `status: approved`, `date: <yyyy-mm-dd>`, and `hash: <first 12 hash characters>`. Update `state`, `next`, and `updated`, then the session title.
   4. Run `node "<plugin>/scripts/board.mjs" --check --ticket <key>`. Fix each reported problem. Open boards update by themselves.
   5. For Designed?, copy `plan.draft.md` to `plan.md`.

### ✅ Approval form

Show it with `ask_user` at each gate. Use one field, `decision`, with these options. Put the gate question in the message, for example "Designed? — is the plan for APP-123 correct?".

| Value | Title |
|---|---|
| `approve` | 🟢 GO — approve and start the next step |
| `comments` | 💬 Comments — I added comments in the editor |
| `changes` | ✏️ Changes — I typed them in the free-text answer |
| `later` | ⏸️ Hold — not now |

- Set no default. The user must pick an option.
- Add the document link and the hash prefix (12 characters) to the message, so the user knows which version they approve.
- If unhandled comments exist on the document, say so in the message.
- If the user declines or cancels the form, treat it as `later` (Hold).

Rules:

- Approval comes only from the user: an `approve` answer in the approval form, or `approve <gate>` in chat in the current conversation.
- Comments, resolved threads, and "looks good" notes do not approve a ticket gate.
- Never answer the approval form for the user, and never approve in auto mode.
- A required gate blocks its step. A recommended gate (Diagnosed?): offer the review; continue if the user declines, and log that.
- A skipped gate (because of the track) blocks nothing. Do not open it.
- A change to an approved document reopens its gate.
- On Resume, read the README `track` and `gates` and report open gates. Show the approval form for each gate that is `in review`.
- Native plan approval in VS Code does not replace a ticket gate or update the approved ticket plan.

## 🚀 Start

1. Fetch the work item with `tracker.fetch`, with its comments. Normalize the key to `<KEY>`.
2. Read the `## Start` policy section.
3. Create the folder from the templates (see Templates). If it exists, run Resume instead.
4. Write `ticket.md`: summary, type, status, priority, reporter, assignee, description, comments, the item URL, and the snapshot date.
5. Write `README.md` from [templates/README.md](templates/README.md) (🎫 Ticket):
   - In the frontmatter, put `phase: start`, `state: needs-me`, the proposed `track`, `next`, `item` (the work item URL), and the gates of the track.
   - Put the `branch` and the `worktree` when they exist.
   - In the body, put the toolkit table for this ticket.
   - Run `node "<plugin>/scripts/board.mjs" --check --ticket <key>`.
6. Seed `investigation.md` from [templates/investigation.md](templates/investigation.md) with one hypothesis row for each suspected cause in the work item.
7. Seed `map.md` from the template: the purpose, the terms, and a first guess of the areas. Mark guesses `(unverified)`.
8. Add the ticket to the "🎫 Tickets → Active" list in `<wiki>/index.md`.
9. Append a `create` entry to `<wiki>/log.md`.
10. Do not create a worktree at Start. The `agents` skill creates a worktree session at Implement.
11. Run the pre-investigation (next section). Scale it to the likely track: about 10 minutes for a small ticket, a full survey for a large one.
12. Choose the track (see Tracks). Show the evidence for your proposal in 3 lines or less. Confirm it with `ask_user`. Record it in `README.md` and `decisions.md`.
13. Follow the phase order of the track. Do not skip a phase of the track, and do not run a later phase in auto mode:

    ```text
    S: brief → Designed? plan
    M: brief + interview → Briefed? → plan → Designed?
    L: context → Understood? → visual briefing → interview → Agreed? → investigation → Diagnosed? → plan → Designed?
    ```

14. Do not ask a scope question before the context is approved (Understood? in track L) or presented in chat (tracks S and M). In track M, ask the interview questions right after you present the context. Then open Briefed?.

In tracks S and M, `context.md` is the "brief". Keep it short: TL;DR, the problem, the affected areas, open questions. Track S puts its few scope questions into the **❓ Decisions needed** list of `plan.draft.md` instead of `interview.md`.

### 🧭 Pre-investigation

The user may not know the problem, its history, or the people around it. Give the user that context first.
Do this automatically. It is read-only, so it needs no approval.

1. Read the wiki: `<wiki>/index.md`, matching canonical pages, and related archived tickets.
2. Read the sources that the work item links: documents, postmortems, linked items, sibling and follow-up items (`tracker.search` on the same reporter, labels, and dates).
3. Trace the history in the code (read-only): `git log --all --grep <keys>` in each checkout, and related change requests (`repo.history`). Review threads show who reviewed and what they said. The `## Investigate` policy section can name older sources.
4. Survey the code in the checkouts of `repo.checkouts`: affected areas, existing patterns, related docs, skills, and instructions.
5. If the work item names a customer environment or a production symptom, take a small read-only sample with the tools that the `## Investigate` policy section allows. Ask first before any tool that needs approval.
6. If a source is not available (VPN off, tool not authenticated, capability `manual`), write the gap and continue.
7. Write `context.md` from [templates/context.md](templates/context.md) (🧭 Context). Put tool outputs in `evidence/`. Add what you learned about the code to `map.md`.
8. List the colleagues who know the area: reporter, authors and reviewers of related change requests, owners of sibling items and related documents. For each, write why and what to ask.
9. Write draft messages to them in `outbox/colleague-questions.md`. The user sends them. Never contact people yourself.
10. Present the context. Track L: open Understood?. Tracks S and M: explain it in chat, then continue with the track. Explain the context in plain words, and answer the user's questions until the user understands it.

#### 💬 Colleague questions do not block

- Keep each colleague question as a row in the **❓ Open questions** table of `context.md`: question, person, status (`draft`, `asked`, `answered`, `no reply`), and impact if the answer differs.
- The user can approve Understood? or Briefed? with open colleague questions.
- When an open question blocks the plan, the plan states an assumption and a fallback for it.
- When an answer arrives, record it in "💬 Colleague answers" and update the row status. Name the artifacts that the answer changes. Update only those artifacts, and reopen only their gates.

`investigation.md` is for the investigation phase: how to achieve the agreed scope.

### 🧪 Spikes

A spike is a short read-only check that answers one fact before a scope question or a plan decision.

- Run a spike when a question depends on a fact that a tool can check. Do not ask the user a question that a tool can answer.
- Time box: 15 minutes. If the spike needs more, stop, write what you found, and add the rest to the investigation.
- Allowed: code search, `git log`, change request threads, tracker reads, CI reads, and the read-only tools that the `## Investigate` policy section allows (check their credentials first).
- Not allowed: code edits, builds that change the main checkout, CI triggers, external writes.
- Save the result as `evidence/<yyyy-mm-dd>-spike-<topic>.md`. Link it from the question. Add new code facts to `map.md`.
- Log each spike in one line in `investigation.md` under "Spikes".

### 🖼️ Visual briefing

Track L: run it after Understood? is approved and before the interview. Tracks S and M: offer it in one line after the context. Run it only when the user says yes.
It is read-only and needs no gate. The user gets a broad view of the ticket, its history, and the concepts around it.

1. Write `briefing.json` in the ticket folder from `context.md`, `ticket.md`, and `evidence/`. Use only facts already in those files. Apply the data rules.
2. Open the Briefing tab of the board: run `node "<plugin>/scripts/board.mjs" --ticket <key>`, then open the printed URL with `/briefing` added (for example `http://127.0.0.1:<port>/#/APP-123/briefing`) with `openBrowserPage`.
3. Tell the user the sections: Overview, History (filterable timeline), Concepts (clickable graph), Related work, People, Open questions.
4. Wait until the user says they are ready. Answer concept questions in chat. Fix `briefing.json` if the user finds a mistake. The open page updates by itself.
5. Start the interview only after the user says they are ready. Log the briefing in `log.md`.

`briefing.json` shape (all fields optional except `key` and `title`; every string is plain text):

```json
{
  "key": "APP-123", "title": "…", "summary": "one sentence",
  "meta": { "Status": "…", "Reporter": "…", "Area": "…" },
  "problem": ["paragraph", "paragraph"], "impact": "why it matters",
  "features": [{ "name": "Invoice inbox", "note": "how it is affected" }],
  "facts": [{ "text": "fact", "link": "https://… (optional)" }],
  "timeline": [{ "date": "2026-01-02", "kind": "problem|fix|decision|info", "title": "…", "detail": "…", "ref": "change 123", "link": "https://…" }],
  "concepts": [{ "id": "c1", "name": "Outbox", "core": true, "what": "what it is", "role": "role in this ticket", "refs": [{ "title": "wiki page", "link": "https://…" }] }],
  "links": [{ "from": "c1", "to": "c2", "label": "triggers" }],
  "related": [{ "title": "APP-1", "type": "ticket|change|doc", "status": "Done", "relation": "how related", "link": "https://…" }],
  "people": [{ "name": "…", "role": "…", "why": "…", "ask": ["question"] }],
  "questions": [{ "text": "open question", "why": "why it matters" }]
}
```

- Mark 1 to 3 concepts `core: true`: the center of the graph. Keep 6 to 15 concepts in total.
- Add concepts for features, components, and terms the user may not know. Explain each in plain words. Copy each concept to the **📖 Terms** table of `map.md`.
- Only `http(s)` links render as links.

### 🎤 Interview

Track L: start after Understood? is approved and the briefing is done. Track M: start right after you present the context. Track S has no interview (see Start). Ground each question in `context.md`.

1. Before you ask, run a spike for each question that depends on a checkable fact.
2. Write `interview.md` from [templates/interview.md](templates/interview.md) (🎯 Scope interview). For each question, write:
   - why the question matters, with a link to the context or evidence
   - the options, and the recommended answer with its reason
   - the answer column, empty until the user answers
3. Ask up to 5 questions in one `ask_user` form, grouped by topic. Put the recommended answer as the field default, and its reason in the field description. Never answer for the user or accept recommendations in auto mode.
4. Run a second round only for answers that raise new questions. Use the same form rules.
5. Record each answer in `interview.md` and `decisions.md`. Then open Agreed? (track L) or Briefed? (track M).

### 🌳 Worktrees

- At Implement, start an implementer session with the `agents` skill: **New Worktree** in the checkout of the change, base branch `baseBranch` of that checkout (else `repo.baseBranch`), and the branch name from `repo.branchPattern`. Replace `{KEY}` with `<KEY>`, `{key}` with `<key>`, and `{slug}` with 2 to 5 lower-case words of the goal, joined by `-`.
- Record the session name and the worktree path in `README.md`.
- Read the `## Implement` policy section. It names limits of worktrees, for example a shared local database.
- Code changes, unit tests, builds, and reviews normally work in a worktree. Tell the user when a step needs a resource that the worktree does not have, and stop that step.

### 🏷️ Session title (info bar)

The session title in the Agents window shows the ticket, the state, and the goal of the session. Format:

```text
<KEY> - <state emoji> - <session goal>
```

Keys of one project have the same width, and the emoji has a fixed width, so the goal column lines up in the sessions list.

| State emoji | When |
|---|---|
| 🟡 | a gate waits for the user |
| 🟢 | the last gate is approved, and no gate is open |
| ▶️ | no gate is open and nothing blocks; the work continues |
| ⏳ | the work waits for an outside event, for example a change request review or a build |
| 🔴 | a failure stops the work, for example CI or an expired credential |
| ✅ | the ticket is closed |

`<session goal>` tells what this session tries to achieve:

- Write a short verb phrase in sentence case, for example `Fix outbox retry on timeout`.
- Use the work item summary as the source. Make it specific to this session's goal, for example the investigation or the implementer goal.
- Do not repeat the key, the phase, or the gate name. The README and the board show them.
- Keep the goal stable. Change it only when the session goal changes.

Examples:

- `APP-4211 - 🟡 - Review invoice export fix`
- `APP-4380 - 🟢 - Find cause of duplicate approvals`
- `APP-4102 - ⏳ - Ship supplier sync timeout fix`
- `APP-123 - 🔴 - Implement outbox retry on timeout`

Use only these emoji in the title. Do not end the title with `?`, because `rename_chat` removes a final `?`. The user scans the color of the state emoji first: 🟡 and 🔴 need action, ▶️ and ⏳ do not.

- Call `rename_chat` (without `automatic`) when the session starts or resumes a ticket.
- Call it again at each change of the state emoji or the session goal.
- Make the `rename_chat` call the last tool call of the turn.
- Keep the title under 60 characters. Shorten `<session goal>` when needed.

### 🛩️ Board (local web app)

`node "<plugin>/scripts/board.mjs"` starts a small local Node server (`127.0.0.1`, read only). Each wiki gets its own port. The command prints the URL. It reads the ticket folders live and shows:

- `#/`: the focus view. Open tickets are grouped into lanes by who must act, and "Recently done" shows the 10 newest closed tickets.
- `#/<KEY>`: one ticket. The phase stepper, next step, waiting on, gates, change requests, problems, the recent log, and the README.
- `#/<KEY>/briefing`: the visual briefing from `briefing.json`.
- `#/<KEY>/<file>`: any document of the ticket, rendered, with its frontmatter and an "Open in VS Code" button.

The page has no own data. The frontmatter is the source (see Frontmatter). Open pages update by themselves within one second after a file changes, so there is no refresh step.

- When the user asks for the board or a ticket page, run `node "<plugin>/scripts/board.mjs" [--ticket <key>]`. Open the printed URL with `openBrowserPage`. Reuse an open page when one exists.
- The script reuses a running server. `--restart` restarts it, and `--stop` stops it.
- Show "Waiting on" with the README `waiting_on` key. Start it with `you:`, `colleague:`, or `outside:`. A `you:` value, `state: needs-me`, or a gate `in-review` puts the card in the "🟡 Your move" lane.

### 🏷️ Frontmatter

Each Markdown file in the ticket folder starts with YAML frontmatter. The board reads it, and `node "<plugin>/scripts/board.mjs" --check [--ticket <key>]` validates it. Run the check after each README change.

README (`type: ticket`), see [templates/README.md](templates/README.md):

| Key | Values |
|---|---|
| `key`, `title` | `APP-123`, the work item summary (required) |
| `phase` | `start`, `investigate`, `plan`, `implement`, `review`, `closed` (required) |
| `state` | `needs-me` 🟡, `go` 🟢, `active` ▶️, `waiting` ⏳, `blocked` 🔴, `done` ✅ (required; same as the session title emoji) |
| `track` | `S`, `M`, `L` |
| `next`, `waiting_on` | one line each |
| `item`, `branch`, `worktree`, `updated` | work item URL, branch name, path, `yyyy-mm-dd`. |
| `changes` | change requests: list of `{url, label, state}`; `state`: `draft`, `open`, `merged`, `closed`, `abandoned`. |
| `gates` | list of `{name, doc, need, status, date, hash, note}`; `status`: `todo`, `in-review`, `approved`, `skipped`, `blocked`. An approved gate needs a `date`. |

Other documents:

- Every document has `type`, `ticket`, and `updated`. `ticket.md` has `type: item-snapshot`.
- Gate documents also have `gate` (for example `Designed?`). The gate status lives only in the README `gates` list.
- `outbox/` drafts have `status` (`draft`, `approved`, `sent`, `dropped`) and optional `target` (`tracker-comment`, `tracker-item`, `change`, `email`, `chat`, `other`).
- `evidence/` files have `date`.
- Quote a value that contains `: `, or the YAML does not parse.

## 🔁 Resume

1. Read `README.md` of the ticket folder. If it has no frontmatter, add it from the template. If it has no `track` key, propose a track from the current state and confirm it with `ask_user`.
2. Read the last entries of `log.md`.
3. Read the `## Resume` policy section, for example credential checks.
4. Open other files only when the next step needs them.
5. Tell the user the track, the phase, the last result, the policy checks, open review gates, open colleague questions, and the next step.
6. Set the session title (see Session title).

## 🔎 Investigate

- Keep the hypotheses table in `investigation.md` current. Status values: `open`, `supported`, `rejected`.
- Save each tool result that supports a finding as `evidence/<yyyy-mm-dd>-<topic>.md`. Include:
  - the tool and the parameters
  - the time window
  - a sanitized excerpt
- Link each finding to its evidence file.
- Add each verified code fact to `map.md`: the flow, the files, the data, the toggles, the jobs, and the tests. Remove `(unverified)` when you verify a guess.
- Read-only tools that the `## Investigate` policy section allows do not need approval. CI reads (`ci.status`, `ci.logs`) do not need approval.
- Write environment, build, and test problems with their fixes to `troubleshooting.md`.
- Append one `log.md` entry per work session.
- Update `phase`, `state`, `next`, and `updated` in the `README.md` frontmatter.

## 📝 Plan

1. Make the plan with the user. In Copilot, use plan mode.
2. Track L: offer the Diagnosed? review of `investigation.md` if it is not approved or declined.
3. Save the proposed plan to `plan.draft.md` in the ticket folder before review. Use [templates/plan.draft.md](templates/plan.draft.md) (📝 Plan). It includes:
   1. **🗺️ Change map**: a Mermaid diagram of the components from `map.md`. Highlight the changed ones (`classDef changed`).
   2. Steps, each with the files it touches.
   3. Tests: unit, integration, end-to-end regression scope, and the deployed-environment check with its baseline and control (or the reason why none is possible). Write the details in `test-plan.md`.
   4. Risks and rollback.
   5. Assumptions for open colleague questions, and **❓ Decisions needed**.
4. Fill "✏️ What this ticket changes" in `map.md` with the planned changes, marked `(planned)`.
5. Set `phase: plan` in the `README.md` frontmatter. Set `next` to the Designed? review.
6. Run the Designed? gate (see Review gates). Implementation needs Designed? approved against the current `plan.md` hash.
7. Keep `plan.md` unchanged until approval of a revised draft.
8. Record design choices, reasons, and rejected options in `decisions.md`.

Implementer sessions and later sessions read the approved plan from the ticket folder.

### Review other files

Any Markdown file in the ticket folder can get a review the same way: open it with `code -r`, link it, the user adds comments, and you handle them with `listComments`. Only gate documents need an approval record.

Open every document that the user must read with `code -r "<absolute path>"` (async). Examples: gate documents, `outbox/` drafts, `briefing.html` sources, and files that the user must edit by hand. Open at most 3 files at the same time.

## 🛠️ Implement

- Read the `## Implement` policy section first.
- Start an implementer session with the `agents` skill (see Worktrees). Do not edit code in the main checkout.
- Check that Designed? is approved in `decisions.md` against the current `plan.md` hash before implementation.
- Follow the repository's own instructions and skills for the code change.
- For a quick code review before Shippable?, use a reviewer subagent (the `agents` skill).
- Before Shippable?, and so before any push or change request (draft too), run the adversarial review subagent (the `agents` skill, "Adversarial review"). Handle its findings. Record them in `review.md`.
- Record test results, change request links, and CI results (`ci.status`) in `log.md`.
- Record build and test problems in `troubleshooting.md`.
- Review changes in `plan.draft.md` and run Designed? again before replacing `plan.md`.
- Before push or change request creation, write `review.md` and run Shippable?. Use [templates/review.md](templates/review.md) (🧪 Code review). It includes:
  - **🧭 Affected areas** table: area, files (links), user impact, tests, risk.
  - A before/after Mermaid diagram when the behavior changes.
  - Why each change was made, tests run, open questions.
- Update "✏️ What this ticket changes" and "🧪 Tests that cover it" in `map.md`. Remove `(planned)` from the done rows.
- Find the end-to-end and regression tests that cover the changed code (search the test projects for the changed classes, jobs, and features). Record the scope in `evidence/` and in `test-plan.md`.
- When such tests exist, run the relevant ones (and the whole suite when the risk is wide) on a deployed branch before you mark the change request ready. The `## Implement` policy section can make this stricter.
- Ask the user before each deploy or CI trigger (`ci.trigger`). Show the job and its parameters first.
- Record regression results (job, run number, pass or fail, link) in `log.md` and `review.md`. If no regression test covers the change, write that in `review.md`.
- Draft every external text (tracker comment, change request description, shared document) in `outbox/<target>.draft.md` from [templates/outbox.draft.md](templates/outbox.draft.md). Send only the text between the `send` markers. Run Sendable? before the write.
- Open the change request with `repo.open-change` after Shippable? and Sendable?. Add it to the README `changes` list.
- Set the phase to `implement` and then to `review` in `README.md`.
- After Shippable? and the change request, run the **Evidence Testing** step (next section). Do not report a change request as ready to merge before that step is done.

## 🔬 Evidence Testing

Evidence Testing is a separate step between review and merge. It proves that the changed behavior works, with concrete evidence. Regression runs alone are not enough, because they only show that old behavior still works.

Read the `## Evidence Testing` policy section before you define the checks. It names the deploy procedure, the observation tools, and the known traps of the company environments.

Rules:

1. Run it on every ticket that changes behavior, before any merge proposal. Never propose or accept a merge without it.
2. Start it after Shippable? and the change request. When a deployed branch is needed, the code must be pushed first.
3. Set the README `next` key to "Evidence Testing" while it is open. Keep the phase `review`.
4. Write `evidence-testing.md` from [templates/evidence-testing.md](templates/evidence-testing.md) (🔬 Evidence Testing). Update it as you go.
5. Test the changed functionality itself. When `policy.evidenceOnDeployedEnv` is `true`, do it in a deployed environment whenever a deployment is possible. Use a local run only when no deployment is possible, and write the reason in `evidence-testing.md`. Unit tests, mutation checks, and regression runs alone are not evidence. For each changed behavior, define one check:
   - the input or action
   - the expected result
   - the observed result
   - the evidence: query output, log or telemetry line, screenshot, API response, or job link
   - Check the baseline first. Ask: would this check also pass without the fix? If yes, the environment cannot show the change. Example: a test environment that never samples telemetry passes "events are not sampled" with or without the fix. Change the environment, or pick another observation.
   - Check that the observed items are not exempt by other means. Example: some event types can set their own sampling rate, so they look correct with or without the fix. Search the code for the emitter before you trust an observation.
   - A deployed run can finish with no proof (no traffic, wrong event type, telemetry not flowing). Then write the check as `⚪ not proven` with the reason. Never write a pass from rows that the baseline would also produce. A control environment without the fix helps to see this.
   - Test environments can expire. Plan the traffic for right after the deploy, or extend the lifetime.
   - Add a control in the same environment: an observation that must differ when the environment is set up right. A check without a working control is `⚪ not proven`, never `🟢`.
   - A deploy may use a throwaway branch with test-only config. Never open a change request from it. Delete it after the run.
   - Draft the deployed check plan in `test-plan.md` during the Plan step, so that Designed? covers it. If no deployed check is possible, say why in the plan.
6. Put each check output in `evidence/<yyyy-mm-dd>-<topic>.md`. Link it from `evidence-testing.md`. Store only aggregated or masked data (see Data rules).
7. Cover the unhappy path where the ticket has one (error, threshold, empty input, feature toggle off).
8. Ask the user if an automated test would bring evidence. Do this when you define the checks, with `ask_user`:
   - Search the test projects for a fitting project and for helpers that you can reuse.
   - Propose the test: what it does, what it asserts, which CI job runs it, and the cost.
   - Say what it cannot prove (for example telemetry that the test cannot read). Then name the other check that closes the gap.
   - A manual check that needs database or admin access that the agent lacks is a strong reason to propose a test. CI environments often have that access.
   - Options: "Add an automated test", "Manual evidence only", "Not now". Record the answer in `decisions.md`.
   - A new test is a code change. It needs a new commit, a new review, and Shippable? again before the push.
9. Add the regression evidence to the same document: unit tests, regression and suite runs (job, run number, result, link), and pre-existing failures with their first failing run.
10. Mark a check `🟢 verified`, `🔴 failed`, or `⚪ not possible: <why>`. Do not write "not run" as a final state. A check that is not possible needs the user's explicit acceptance in `decisions.md`.
11. Ask the user before each deploy, CI trigger, or database write. Show the job or the exact steps first. Never write to a database without approval. Do not escalate access (for example secret store or firewall changes) on your own.
12. A failed check goes to `troubleshooting.md` and back to Implement.
13. The step is done when every check is `🟢 verified` (or accepted `⚪`). Then add a short "Evidence" section to the change request description draft in `outbox/`, run Sendable?, update the description with `repo.update-change`, and tell the user that the change request can be merged. Never suggest a merge on a day in `policy.noMergeWeekdays`.
14. Record the result in `log.md`. Add the link to `evidence-testing.md` in `review.md`.
15. When the change request has all approvals (`repo.change-status`) and Evidence Testing is done, report it and stop. The user merges in the web UI of the repository host. Record the merge in `log.md` when the user reports it.
16. After the merge, run the QA handover (next section) when `policy.qaHandover` is `true`. Else go to Close when the user says that the ticket is done.

## 🧑‍🔬 QA handover

Run it only when `policy.qaHandover` is `true`. Run it after the user reports the merge, or when the user says that the ticket goes to QA. Do it before Close. It tells QA what we tested, and how QA can test the change.

Read the `## QA handover` policy section first. It can set the comment format, the QA status, and the QA tools.

1. Write `outbox/qa-handover.draft.md` from [templates/qa-handover.md](templates/qa-handover.md) (🧑‍🔬 QA handover). The tracker comment is the text between the `send` markers. Draft it from `evidence-testing.md`, `test-plan.md`, `review.md`, and `map.md`. Do not invent results. Link the evidence files only in the draft's "Why this wording" part, because QA cannot open the wiki.
2. The comment has these parts, in this order, in plain words for a tester:
   - **What changed**: the behavior in 2 to 4 lines, and the toggle (name, default, where it is set).
   - **How we self-tested**: unit tests (fixtures, count), automated tests (project, test name, CI job and run), regression runs (job, run, result), and the known old failures with their first failing run.
   - **Self-QA on a deployed environment**: for each Evidence Testing check, the action, the expected result, the observed result, and where we saw it (environment type, tool). Name the accepted gaps and why.
   - **How to test it (for QA)**: preconditions (environment, toggle, observability tools, test data), numbered steps with exact inputs, the expected result for each step, one negative or control case, clean-up, and shortcuts that save time (for example a test that ages test data). Add the query or the screen where QA sees the result.
   - **Regression areas to watch** and **known limits**.
3. Write for QA: no code paths unless QA needs them, no customer environment or customer names, no secrets, no credentials, and no links that only developers can open. Use the same words as the work item.
4. Run Sendable? for the draft. After GO, send the comment with `tracker.comment`. Ask before the write, as for every tracker write.
5. Do not transition the work item yourself. Ask the user whether to move it to QA, and show the target status first. After a yes, use `tracker.transition`. Send the comment before the transition, so that QA finds it.
6. Record the comment id or link and the time in `log.md`. Set the draft `status` to `sent`.
7. If QA finds a problem later, add the cause and the fix to `troubleshooting.md` and, when it changes the test guidance, send a short follow-up comment (same Sendable? rule).

## ✅ Close

Run only when the user says that the ticket is done.

1. Read all files in the ticket folder.
2. List the durable knowledge:
   - how the code works (from `map.md`)
   - root causes
   - gotchas
   - tool tips
   - decisions
3. Write `close.draft.md` from [templates/close.draft.md](templates/close.draft.md) (✅ Close):
   1. **🎓 What you now know** (the debrief):
      - the affected areas, in one table from `map.md`
      - how the feature lives in the code: one diagram from `map.md`
      - what the feature is for, and who uses it
      - the gotchas and decisions to remember (max 5)
      2. **📚 Wiki changes**: each canonical page to create or update, with its key lines.
   3. The ticket summary.
   Run Learned?. Continue only after Learned? is approved.
4. Write or update canonical pages with the `wiki` skill Record procedure:
   - the area folder of the code (see the folder layout in the `wiki` skill) for code and architecture knowledge. Use `map.md` as the main source: purpose, flow, files, data, tests.
   - `tooling/` for tool and environment knowledge
   - `decisions/` for decisions that apply after the ticket
   Remove customer environment names from these pages.
   Read the `## Close` policy section. It can name more folders and knowledge owners.
5. Create `<wiki>/tickets/<key>.md` from the summary template. Link the canonical pages and the archive folder.
6. Move the ticket from "Active" to "Done" in `<wiki>/index.md`. Add lines for the new canonical pages.
7. Set the phase to `closed` in `README.md`.
8. Move the folder:
   ```sh
   node -e "const fs=require('fs'),[,a,b]=process.argv;fs.mkdirSync(require('path').dirname(b),{recursive:true});fs.renameSync(a,b)" "<wiki>/raw/tickets/<key>" "<wiki>/archive/tickets/<key>"
   ```
9. Append a `close` entry to `<wiki>/log.md` that lists each changed page. Commit the canonical pages in the wiki repository.
10. Tell the user what you recorded, in one line per page.

## 🧩 Templates

The gate documents and the README use the plain ticket style. Copy them from the `templates/` folder next to this skill. Read [templates/_style.md](templates/_style.md) first.

| File in the ticket folder | Template |
|---|---|
| `README.md` | [templates/README.md](templates/README.md) |
| `context.md` | [templates/context.md](templates/context.md) |
| `interview.md` | [templates/interview.md](templates/interview.md) |
| `investigation.md` | [templates/investigation.md](templates/investigation.md) |
| `plan.draft.md` | [templates/plan.draft.md](templates/plan.draft.md) |
| `outbox/<target>.draft.md` | [templates/outbox.draft.md](templates/outbox.draft.md) |
| `review.md` | [templates/review.md](templates/review.md) |
| `evidence-testing.md` | [templates/evidence-testing.md](templates/evidence-testing.md) |
| `outbox/qa-handover.draft.md` | [templates/qa-handover.md](templates/qa-handover.md) |
| `close.draft.md` | [templates/close.draft.md](templates/close.draft.md) |

- Keep every section of a template. Write "None" in a section that has no content. Do not delete it.
- Remove an optional labeled quote (`💡 Tip`, `⚠️ Warning`, `🛑 Caution`) when it has no content.
- Older ticket files keep their style. Use the template only for new documents, or when the user asks for a restyle.

`map.md`:

```markdown
# 🗺️ Code map — <KEY>

> **TL;DR** — what the feature is and where it lives, in 2 lines.
> Rows marked `(unverified)` are guesses. Rows marked `(planned)` are not done yet.

## 🎯 What the feature is for
Who uses it, in which screen, job, or integration, and why. 3 to 5 lines.

## 🧭 How it flows
Mermaid flowchart or sequence: entry point → services → data → output.

## 📂 Where it lives

| Area | Key files (links) | Role |
|---|---|---|

## 🗄️ Data, toggles, jobs

| Kind | Name | Notes |
|---|---|---|

## 🧪 Tests that cover it

| Kind (unit / integration / end-to-end) | Test | What it checks |
|---|---|---|

## ✏️ What this ticket changes

| Area | Change | User impact | Risk |
|---|---|---|---|

## 📖 Terms

| Term | Plain meaning |
|---|---|
```

`log.md`, `troubleshooting.md`, `decisions.md`: a `# <Title> — <KEY>` heading, then dated `## yyyy-mm-dd <title>` entries.

`<wiki>/tickets/<key>.md`:

```markdown
---
title: <KEY> — <summary>
updated: <YYYY-MM-DD>
status: verified
sources:
  - <work item URL>
  - <change request URL>
  - archive/tickets/<key>/
---
# <KEY> — <summary>

<Problem in one paragraph.>

- Root cause: <text>
- Fix: <text>
- Knowledge: <links to canonical pages>
```
