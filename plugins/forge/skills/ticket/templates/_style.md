# ✍️ Ticket document style

Every ticket document is easy to scan, and no information is lost. Use plain names. Do not use a theme.

## 📄 Documents

| Document | Title | Gate |
|---|---|---|
| `README.md` | 🎫 Ticket | None (holds the 📍 Now card) |
| `context.md` | 🧭 Context | Scoped? (evidence) |
| `interview.md` | 🎯 Scope interview | Scoped? (evidence) |
| `scope.md` | 🎯 Scope | Scoped? (primary, layered) |
| `investigation.md` | 🔎 Investigation | Planned? (evidence) |
| `plan.draft.md` | 📝 Plan | Planned? (primary, layered) |
| `outbox\*.draft.md` | 📤 Outbox draft | Sendable? |
| `review.md` | 🧪 Code review | Shippable? (primary, layered) |
| `evidence-testing.md` | 🔬 Evidence Testing | None (step, required before merge) |
| `outbox\qa-handover.draft.md` | 🧑‍🔬 QA handover | Sendable? |
| `close.draft.md` | ✅ Close | Learned? (primary, layered) |

Every new ticket uses `workflow: full-v2`. Briefed? belongs only to legacy M tickets,
and Understood?, Agreed?, Diagnosed?, and Designed? only to `full-v1` and legacy tickets.
Preserve existing tickets' original gates and skips; do not copy new workflow metadata over them.

## ⏱️ Reading levels (primary gate docs)

The user reads a primary gate doc from the top and stops at any level. Each level adds detail to the levels above it.

| Level | Heading | Words from the top | What it holds |
|---|---|---|---|
| 1 min | `## ⚡ 1 min` | at most 150 | key fact, TL;DR, what I need from you, decisions needed (max 3) |
| 5 min | `## ☕ 5 min` | at most 1,150 | glance table, one diagram, the main table (scope, steps, checklist, or result) |
| 10 min | `## 📖 10 min` | at most 2,300 | reasons, tests, risks, answers, before and after |
| 15 min | `## 🔬 15 min` | at most 3,450 | step details, findings, history, full facts |
| Appendix | `## 📂 Appendix` | no limit | links, logs, long lists, the approval set note |

- The ⚡ card is required. The approval form shows it, so it must make sense alone.
- Keep the levels in this order. Put all content under a level: use `###` headings inside a level, never another `##`.
- A short doc can stop after any level. Do not add empty levels.
- Code fences, Mermaid diagrams, and link targets do not count as words.
- `forge.mjs lint` warns when the ⚡ card is missing, a level is over its budget, or the order is wrong. Move detail down a level, or to the Appendix. Do not drop facts.

## 🧱 Every primary gate document has these parts, in this order

0. **Frontmatter**: copy it from the template. Keep `type`, `ticket`, `gate`, and `updated` correct. The ticket overview reads it.
1. **Title**: `# <emoji> <Title> (<KEY>): <short title>`.
2. **`## ⚡ 1 min`**: the key fact (`> 🔥 <the most surprising fact or the stakes>`, with a real number when one exists), then the summary quote (`> **TL;DR:**` and `> **What I need from you:**`, with a line with only `>` between them), then **❓ Decisions needed** (max 3 one-line items with the recommended answer, or "None (GO only)").
3. **`## ☕ 5 min`**: the glance table, one Mermaid diagram (flow, timeline, or structure), and the main table.
4. **`## 📖 10 min`**, **`## 🔬 15 min`**, **`## 📂 Appendix`**: as the template shows.

Evidence documents (`context.md`, `interview.md`, `investigation.md`) and `evidence-testing.md` keep the older shape: key fact, summary quote with `> **Reading time:**`, at a glance, diagram, sections, then **❓ Decisions needed**.

The gate status lives only in the `gates` list of the README frontmatter. Do not write a status footer in the document.

## 📦 No information is lost

- Start each section with the short version: what, why, what next.
- In a layered doc, put the full detail in a deeper level or the Appendix. In an evidence doc, put it below the short version, under a bold label: `**📂 <label>**`.
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

- Follow the forge document mode of the [`writing` skill](../../writing/SKILL.md): STE, and no strong AI tells (§1 to §5, §8, §22 to §25).
- Write direct and plain. Address the user as "you". Write "we" for the user and the agent together.
- Use only the fixed bold labels of this file and the templates. Add no other bold labels.
- Text between the `send` markers of an outbox draft is outbound text. It gets a full pass, with no emoji and no bold labels.

## 🔀 Before and after

When a document describes a change in behavior, add a before/after table (`🔴 Before` / `🟢 After`) or two Mermaid diagrams.

## 🟢 Gate form labels

| Value | Title |
|---|---|
| `approve` | 🟢 GO: approve and start the next step |
| `comments` | 💬 Comments: I added comments in the editor |
| `changes` | ✏️ Changes: I type them in the free-text answer |
| `later` | ⏸️ Hold: not now |
