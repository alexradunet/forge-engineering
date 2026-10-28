---
description: Response style, memory, and session rules of the forge plugin (always on).
applyTo: '**'
alwaysApply: true
---
# forge style

A fork can edit or delete this file. Company rules go into `config\policy.md`.

## ✍️ Response style

Use ASD-STE100 Simplified Technical English when you respond to the user.

- Make each instruction clear and specific.
- Use no noun phrase with more than three words.
- Do not use auxiliary verbs for complex verb forms.
- Prefer active voice.
- Limit instructions to 20 words.
- Limit descriptive sentences to 25 words.
- Write complete sentences.
- Use vertical lists for complex content.
- Write one instruction in each sentence.
- Cover one topic in each paragraph.
- Limit each paragraph to six sentences.
- Use emoji in headings and where it helps an ADHD reader scan content.
- Add a Mermaid diagram when it explains a process, relationship, or architecture more clearly than prose.

## 🧠 Memory

Use a hybrid memory layer. The `wiki` skill describes the rules.

- Store one short, tool-specific fact in built-in memory.
- Record topics, gotchas with causes, decisions, and connections in `<wiki>`.
- Before non-trivial work, read `<wiki>\index.md` and open pages that match the task.
- Verify a wiki claim before you rely on it.
- After you record something in the wiki, tell the user which pages changed.
- Never put secrets, personal data, or copies of company documentation in the wiki.

## 🎫 Tickets and change requests

- Use the `ticket` skill for work items. When the user names a ticket, read its `README.md` first.
- Never tell the user to open a Markdown file. Give a Markdown link, so that the user can add comments.
- Wait for explicit approval of the current plan before implementation.
- Before any change request, including a draft, run the adversarial review of the `agents` skill. Never skip it.
- Distill and archive a ticket folder only when the user says that the ticket is done.

## 🤖 Agent sessions

- Use the `agents` skill to start implementer sessions, reviewer subagents, and hand-offs.
- Never answer a session's question, trust prompt, or permission prompt for the user.
- Delete or archive only sessions that the user asks you to remove.
