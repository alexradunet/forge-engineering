# ✍️ Ticket document style

Every ticket document is easy to scan, and no information is lost. Use plain names. Do not use a theme.

## 📄 Documents

| Document | Title | Gate |
|---|---|---|
| `README.md` | 🎫 Ticket | — |
| `context.md` | 🧭 Context | Understood? |
| `interview.md` | 🎯 Scope interview | Agreed? |
| `investigation.md` | 🔎 Investigation | Diagnosed? |
| `plan.draft.md` | 📝 Plan | Designed? |
| `outbox\*.draft.md` | 📤 Outbox draft | Sendable? |
| `review.md` | 🧪 Code review | Shippable? |
| `evidence-testing.md` | 🔬 Evidence Testing | — (step, required before merge) |
| `outbox\qa-handover.draft.md` | 🧑‍🔬 QA handover | Sendable? |
| `close.draft.md` | ✅ Close | Learned? |

Every new ticket uses the full workflow with mandatory Diagnosed?. Briefed? belongs
only to legacy M tickets, where context and interview share one approval. Preserve
existing tickets' original gates and skips; do not copy new workflow metadata over them.

## 🧱 Every gate document has these parts, in this order

0. **Frontmatter**: copy it from the template. Keep `type`, `ticket`, `gate`, and `updated` correct. The ticket overview reads it.
1. **Title**: `# <emoji> <Title> — <KEY>: <short title>`.
2. **Key fact**: one line, `> 🔥 <the most surprising fact or the stakes>`. Use a real number when one exists.
3. **Summary quote**: `> **TL;DR:**`, `> **What I need from you:**`, `> **Reading time:**`. Put a line with only `>` between them, so each starts on a new line.
4. **At a glance**: a table of 3 to 5 key numbers or facts.
5. **Diagram**: one Mermaid diagram (flow, timeline, or structure).
6. **Sections**: short prose and tables first.
7. **❓ Decisions needed**: max 5 items, or "None — GO only".

The gate status lives only in the `gates` list of the README frontmatter. Do not write a status footer in the document.

## 📦 No information is lost

- Start each section with the short version: what, why, what next.
- Put the full detail below it, under a bold label: `**📂 <label>**`.
- Every fact still links to its evidence file or to code.

## 🚫 Rendering rules

The VS Code preview in the Agents window does not render HTML or GitHub alerts.

- Do not use `<details>`, `<summary>`, or other HTML.
- Do not use `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`, `> [!IMPORTANT]`, or `> [!CAUTION]`.
- Use a plain quote with an emoji label instead:

| Label | Use for |
|---|---|
| `> 💡 **Tip:**` | A shortcut, a pattern to copy, or a useful tool |
| `> ℹ️ **Note:**` | Background that helps but is not required |
| `> ⚠️ **Warning:**` | A risk, a data rule, or a trap |
| `> 🛑 **Caution:**` | Something that can break production or lose data |

Use max 3 labeled quotes in one document.

## ✍️ Voice

- Write warm and direct. Keep STE rules: short sentences, active voice, one topic per paragraph.
- Address the user as "you". Write "we" for the user and the agent together.

## 🔀 Before and after

When a document describes a change in behavior, add a before/after table (`🔴 Before` / `🟢 After`) or two Mermaid diagrams.

## 🟢 Gate form labels

| Value | Title |
|---|---|
| `approve` | 🟢 GO — approve and start the next step |
| `comments` | 💬 Comments — I added comments in the editor |
| `changes` | ✏️ Changes — I type them in the free-text answer |
| `later` | ⏸️ Hold — not now |
