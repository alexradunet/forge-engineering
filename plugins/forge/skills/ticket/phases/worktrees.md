# Ticket worktree and branch

This file is a part of the `ticket` skill: [SKILL.md](../SKILL.md) has the words (`<F>`, `<KEY>`, `<key>`), the data rules, the gate rules, and the list of the other parts.
Use it at Start, before the first commit, at Implement, and at Resume before implementation or a proof run.
After a compaction of the session, read this file again before you use its steps.

### 🌳 Worktrees

Each ticket has one worktree folder and one branch. Forge names both:

- Branch: `repo.branchPattern`, with `{KEY}`, `{key}`, `{number}`, and `{slug}` (2 to 5 lower-case words of the goal, joined by `-`).
- Folder: `<repo>.worktrees/<key>-<slug>`, next to the main checkout.

Run `<F> worktree <KEY> --summary "<short>"` at Start and before the first commit. It is read-only and prints JSON: `branch`, `folder`, `base` (ref and full SHA), `current` (this session folder), `existing` (a worktree that already has the branch or the folder), `related` (other worktrees of the key), `action`, and `commands`. Follow the `action`:

| `action` | When | Do |
|---|---|---|
| `reuse` | This session folder is a linked worktree on the ticket branch | Continue here. |
| `rename-current` | A **New Worktree** session: a linked worktree on an `agents/...` branch, and the ticket branch does not exist | Run the printed `git branch -m <branch>` before the first commit. The folder name stays; the host owns it. |
| `resume` | Another worktree already has the ticket branch or folder | Tell the user the path. In a Folder session, confirm the folder, then move the session to it (`host.move`). |
| `create` | No ticket worktree exists | In a Folder session on the main checkout: run the command again with `--create`. Ask one `host.ask` question that confirms `folder`. Then move the session to `folder` (`host.move`). |

- Preserve an existing session worktree. When `current` is a linked worktree in `related` (a ticket worktree with an older name), continue there; do not create another one. Do not rename an existing suitable branch merely to match the pattern.
- `host.move` uses the Forge worktree as it is. Never let the host make a second worktree for the ticket.
- At Implement, use the `agents` skill to verify the current repository, worktree, branch, HEAD, and local changes. Reuse a suitable current worktree. Do not create another session only because the phase changed.
- Select an explicit required commit first, then the recorded ticket branch for existing work. Use the checkout `baseBranch` (else `repo.baseBranch`) only for a new task without a ticket branch. Resolve the baseline to a full SHA before execution. Never silently replace a pinned baseline with the default branch.
- An exact-commit proof requires HEAD equality, not just ancestry. For resumed implementation, inspect and preserve known task changes above the recorded baseline. Follow the selection checks and manual step in the `agents` skill when the current worktree is unsuitable.
- Record `branch` and `worktree` (the absolute folder path only) in `README.md`. Record the session name, the resolved baseline SHA, and the selection reason as a `log` entry in `journal.md`. Do not alter hashed approval documents.
- Read the `## Implement` policy section. It names limits of worktrees, for example a shared local database.
- Close removes a worktree that Forge created only after the user says yes (see Close).
