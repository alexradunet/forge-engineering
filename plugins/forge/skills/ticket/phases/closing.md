# Close a ticket

This file is a part of the `ticket` skill: [SKILL.md](../SKILL.md) has the words (`<F>`, `<KEY>`, `<key>`), the data rules, the gate rules, and the list of the other parts.
It has the Learned? gate, the wiki pages, the archive move, and the worktree cleanup.
After a compaction of the session, read this file again before you use its steps.

## ✅ Close

Run only when the user says that the ticket is done.

1. Read all files in the ticket folder.
2. List the durable knowledge: how the code works (from `map.md`), root causes, gotchas, tool tips, and decisions.
3. Write `close.md` from [templates/close.md](../templates/close.md): the summary, **What you now know** (max 5 items), **Wiki changes** (each canonical page to create or update, with its key lines), and **Ticket summary** for `tickets/<key>.md`. Open Learned?. Continue only after Learned? is approved.
4. Write or update canonical pages with the `wiki` skill Record procedure:
   - the area folder of the code (see the folder layout in the `wiki` skill) for code and architecture knowledge. Use `map.md` as the main source: purpose, components, flow, data, tests.
   - `tooling/` for tool and environment knowledge
   - `decisions/` for decisions that apply after the ticket
   Remove customer environment names from these pages.
   Read the `## Close` policy section. It can name more folders and knowledge owners.
5. Create `<wiki>/tickets/<key>.md` from the ticket summary (below). Link canonical pages and shared work item and change request sources. Label the archive link local-only; the summary must remain useful without ignored raw material.
6. Move the ticket from "Active" to "Done" in `<wiki>/index.md`. Add lines for the new canonical pages.
7. Set `phase: closed` and `state: done` in `README.md`, and update the Now card. Rename the session title to ✅.
8. Move the folder:
   ```sh
   node -e "const fs=require('fs'),[,a,b]=process.argv;fs.mkdirSync(require('path').dirname(b),{recursive:true});fs.renameSync(a,b)" "<forge>/raw/tickets/<key>" "<forge>/archive/tickets/<key>"
   ```
9. Append a `close` entry to `<wiki>/log.md` that lists each changed page. Commit the canonical pages in the wiki repository.
10. Clean up the ticket worktree. Ask the user first, with one `host.ask` confirmation. Without a "yes", leave it.
    - Run `git status --short` and check for outgoing commits in the worktree. Uncommitted or unpushed work blocks the cleanup. Report it.
    - Run the repository cleanup that the `## Close` policy section names (for example a database per worktree).
    - A worktree that `<F> worktree --create` made (its folder is in `<repo>.worktrees/`): after the "yes", run `git worktree remove "<folder>"` from the main checkout. Keep the branch. Never use `--force`.
    - A worktree that VS Code made (a **New Worktree** session): tell the user to use **Mark as Done** on the session in the Agents window, not **Delete**. Delete leaves the worktree on disk ([vscode#332442](https://github.com/microsoft/vscode/issues/332442)). Mark as Done keeps the branch, but it does not always remove the worktree (for example after `git branch -m`). After Mark as Done, run `git worktree list`. When the folder is still there, run `git worktree remove "<folder>"` from the main checkout, or tell the user to run **Chat: Open Worktree Cleanup**. A worktree that another tool created needs that tool's remove command.
    - A session that runs in the worktree locks the folder. Report the path that is left.
11. Tell the user what you recorded, in one line per page.

## Ticket summary page

`<wiki>/tickets/<key>.md`:

```markdown
---
title: <KEY>: <summary>
updated: <YYYY-MM-DD>
status: verified
sources:
  - <work item URL>
  - <change request URL>
---
# <KEY>: <summary>

<Problem in one paragraph.>

- Root cause: <text>
- Fix: <text>
- Knowledge: <links to canonical pages>
- Local-only working archive: <archive/tickets/<key>/; may be unavailable on another machine>
```

A local ticket (key `L-<n>`) has no work item URL. Its `sources` hold the change request URL. With no change request, use the repository path of the main changed file. With no change request, the `sources` hold the URL or the hash of the pushed commit.

Before you write `<wiki>/tickets/<key>.md` for a local key, check the wiki. When a page with that name exists and its title names another ticket, stop and tell the user. Two users of one shared wiki can get the same local key. Ask for a new key with `<F> local-key`.
