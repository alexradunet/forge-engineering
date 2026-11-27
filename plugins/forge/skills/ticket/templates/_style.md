# ✍️ Ticket document style

A ticket document is plain. The reader sees the content, not the format.

## 📄 Documents

Each fact has one home. Another document gives a link to it, not a copy.

| Document | Holds | Gate |
|---|---|---|
| `README.md` | The state of the ticket: frontmatter and the Now card | None |
| `story.md` | The problem, the scope, your answers, the history, and the open questions | Planned? |
| `plan.md` | The diagnosis, the steps, the tests, the checks, and the risks | Planned? |
| `review.md` | What changed, the tests that ran, and the review findings | Shippable? |
| `proof.md` | The result of each Evidence Testing check | None (in the Shippable? set when `policy.evidenceOnDeployedEnv` is `false`) |
| `journal.md` | The dated log: work, decisions, and problems | None |
| `map.md` | The code map: components, flow, data, tests, and terms | None |
| `close.md` | What you now know, and the wiki changes | Learned? |
| `outbox/*.draft.md` | The exact text of one paste text | None |

A file starts to exist when its phase starts. Do not create an empty file.

## 🔇 Signal only

- Write no emoji in a title or a heading.
- Use an emoji only for a state, where the color is the message: the ticket states (🟡 🔴 🟢 ▶️ ⏳ ✅), a risk level (🟢 🟡 🔴), and a check result (🟢 verified, 🔴 failed, ⚪ not proven).
- Write no bold labels and no bold text. Start a line with a plain label and a colon, for example `Cause:`.
- Write no quote blocks for emphasis, no tip or warning boxes, and no horizontal rules.
- Use a table only for rows that the reader compares, with 3 columns or more. Use a list for all other content.

## 🧱 Shape of a gate document

A gate document (`story.md`, `plan.md`, `review.md`, `close.md`) has these parts, in this order:

1. Frontmatter: copy it from the template. Keep `type`, `ticket`, `gate`, and `updated` correct.
2. Title: `# <Document> <KEY>: <short title>`.
3. Summary: at most 150 words, directly under the title, before the first `##` heading. The approval form shows only this text, so it must make sense alone. It has one short paragraph for each label of the template, then `Need from you:`, then at most 3 `Decision <n>:` lines with the recommended answer. `story.md` has no `Need from you:` line, because `plan.md` asks for the GO on Planned? for both documents.
4. Sections: only the sections that have content, in the order of the template.

- Leave out a section that has no content. Do not write "None". The exceptions are the summary and `Need from you:` (not in `story.md`).
- Keep the section names of the template. `forge.mjs lint` and the plan checks find the content by these names.
- Keep the line shapes of the template inside a section (for example `Files:` under a step, or `A -> B: text` in the flow). The plan checks read them.
- The whole document has at most 1,500 words. Code and link targets do not count. Put longer material in an `evidence/` file, and give the link. Do not drop a fact to make a document shorter.
- `forge.mjs lint` warns when the summary is missing or over its budget, when the document is over its budget, and when a section is empty.

## 🔗 Evidence and links

- Link each fact to its evidence file or to code: `[File.cs](<checkout>/path/File.cs:42)` with the absolute checkout path.
- Write (new) after the link of a file that a step creates: `[New.cs](<checkout>/path/New.cs) (new)`.
- A `Baseline:` or `Control:` line links its evidence file, or says `not run: <why>`.
- The Baseline is the result of the same action without the fix. The Control is a second observation with a known result.
- Explain each term that the user possibly does not know in plain words, or put it in **Terms** of `map.md`.
- Tool outputs, the work item snapshot, and spike results go to `evidence/<yyyy-mm-dd>-<topic>.md`, with `date` in the frontmatter.
- The gate status is only in the `gates` list of the README frontmatter. Do not write a status, a hash, or an approval note in a document.

## 📓 Journal

`journal.md` is append-only. Add each entry at the end:

```markdown
## <yyyy-mm-dd> <kind>: <title>
```

| Kind | Use for |
|---|---|
| `log` | What a work session did, and its results |
| `decision` | A choice, its reason, and the rejected options |
| `problem` | An environment, build, or test problem, with its cause and its fix |
| `check` | The result of a cold read or an adversarial review |
| `step <n> done` | A plan step that is implemented. Write `step <n> verified` after its Evidence Testing check. |

A decision that an approval depends on also goes into the gate document (`Answers` in `story.md`, `Decisions` in `plan.md`).

## ✍️ Voice

- Follow the forge document mode of the [`writing` skill](../../writing/SKILL.md): STE, and no strong AI tells (§1 to §5, §8, §22 to §25).
- Write direct and plain. Address the user as "you". Write "we" for the user and the agent together.
- Text between the `send` markers of an outbox draft is outbound text. It gets a full pass, in the format of its target.

## 🟢 Gate form labels

| Value | Title |
|---|---|
| `approve` | 🟢 GO: approve and start the next step |
| `comments` | 💬 Comments: I added comments in the chat |
| `changes` | ✏️ Changes: I type them in the free-text answer |
| `later` | ⏸️ Hold: not now |
