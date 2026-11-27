# Shared configuration in the wiki

The repository wiki is the source for configuration and knowledge pages.
It is a separate Git repository at `../<repo>.forge/wiki`, in the Forge folder of the repository.
The plugin holds the config templates. `forge-setup` copies them to the wiki. There is no pack to install or update.

```mermaid
flowchart LR
  templates["forge templates"] -- seed missing files --> wiki["repository wiki"]
  wiki <-->|push / pull| remote["wiki Git remote"]
  wiki --> forge["config commands"]
```

## Layout

```text
<repo>.forge/             the Forge folder (<forge>)
  forge, forge.cmd        the launcher: "../<repo>.forge/forge open" shows the board and the wiki
  raw/                    local working material: tickets, pages
  archive/                local archives of closed tickets
  wiki/                   the wiki (<wiki>): a git repository
    index.md              knowledge index
    forge/
      repo.json           repository binding
      config/
        repo.md
        policy.md
    rules/                rules for each session (data.md, ...)
```

Forge 10 does not read an older folder `../<repo>.wiki`. To keep such a wiki, make the folder `../<repo>.forge`, move the wiki into `wiki/`, and move `raw/` and `archive/` next to it.

Say "set up forge" to create the wiki and seed missing config files.
Setup keeps existing configuration. See [config.md](config.md) for the file format.

## Company rules

The `<wiki>/rules/` pages hold the rules for AI agents: data rules.
Each page is a normal wiki page with frontmatter. When the folder is missing, setup writes
`data.md` from the template.
The Forge `sessionStart` hook gives the pages to each session of the bound repository, after the
`# forge plugin` and `# forge style` rules, in file name order. It removes the frontmatter and
HTML comments, leaves out a page with only headings, and cuts the text after 8000 characters.
The hook gives each page, with no approval step. The wiki is a Git repository, so its history is the review record.
The hook reads the pages in `rules/` and in its folders. The session end hook writes the wiki HEAD to `<forge>/raw/rules-seen` (one line). The session start hook only reads it.
For each page that changed since that commit, it adds one line to the context: the page, the commit and its author, "has an uncommitted change", or "was removed".
When that commit is not in the history any more, one line says that the wiki history changed.
The agent tells you about the change, and shows it when you ask. The line informs and blocks nothing. A wiki that is not a Git repository gives no line.
Put step rules for tickets in the hook sections of `policy.md`, not in a rule page.

## Share through Git

The wiki can stay personal. To share it with a team, do these steps:

1. Edit configuration directly in the wiki.
2. Review and commit only files that belong in the shared wiki.
3. Push the wiki after explicit approval of the command and target.
4. Teammates clone it to `../<repo>.forge/wiki`, or pull changes in their existing clone.
5. Run setup to bind the clone. Read the `git log` of `rules/` and `forge/config/` for changes of your teammates.

Each code repository has its own wiki binding.
Do not bind one wiki to several unrelated repositories.
To reuse a setting elsewhere, copy the reviewed file into that repository's wiki.

### Public or private

A native public wiki is suitable when all tracked files and Git history contain public data.
Otherwise, use a private wiki repository or keep the wiki local.
Never change repository visibility as part of setup.

Before a public push, check configuration, knowledge pages, and Git history.
Exclude secrets, personal paths, internal hosts, company guidance, and private project details.
Check `forge/repo.json` and the **Checkouts** table for local paths.
Do not assume that a secret scan detects all private content.

`raw/` and `archive/` are outside of the wiki repository.
Check the tracked files before any push.
Never publish credentials.

Ticket links under `raw/` and `archive/` are local-only references. Label them as such
in a shared index or summary; they may be unavailable on another machine without
being broken. Shared summaries must explain the problem, fix, and durable knowledge
with shared sources and canonical links, without depending on ignored working files.
Do not unignore or publish working material to make a reference resolve.

## Local validation and source limits

Run from the repository or pass an explicit wiki path:

```sh
node "<plugin>/scripts/forge.mjs" lint [--wiki "<path>"] [--json] [--fix]
```

Default lint is read-only. It checks ticket shape, workflow/gate agreement, approval
revisions, and canonical wiki metadata. Forge supports only `workflow: full-v4`. A ticket
with another marker, no marker, or a `track` value is a read error.
Missing or conflicting metadata is a finding, never permission to infer a state or
change the ticket. Lint also warns when a gate document has no
summary under its title, when the summary has more than 150 words, when the document has
more than 1,500 words, when a section has no content, or when the Now card does not agree
with the README frontmatter.

Canonical checks cover `title`, `status`, `updated`, and `sources`; existing
`index.md` and `log.md` instead require `title` and `type`. An absent `log.md`
is allowed until it is created. Age and `needs-check` findings are review warnings.
Index membership drift, semantic contradictions, HTTP retrieval, and the truth
of page text remain manual checks, not automated CLI results.

JSON output has this stable shape:

```json
{
  "version": 1,
  "wikiPath": "<absolute wiki path>",
  "findings": [
    {
      "file": "<file>",
      "line": null,
      "code": "<finding code>",
      "severity": "error",
      "message": "<what failed>",
      "remedy": "<specific user action>"
    }
  ],
  "repairs": [],
  "summary": { "errors": 1, "warnings": 0, "repaired": 0 }
}
```

`line` is a line number when known, otherwise `null`. Repair entries have
`file`, `code`, and `log` (the repair-log path). Errors exit with status 1; warnings
alone exit 0. Invalid input retains findings for valid files. A clean lint does not prove
workflow compliance or claim accuracy.

`--fix` is explicit and has one safe repair: append a missing final newline to an
unapproved `*.draft.md` with explicit `status: draft` metadata; the filename alone
is insufficient. Check each manifest that lists the draft before editing. Preserve existing content and
line endings; never modify approved content. Report each repair and append the
file and change to that ticket's `repair-log.jsonl`, using `started` and `applied`
rows with before/after hashes. A repeat fix pass makes no changes.
No repair may infer workflow/state, create approval, fix stale approvals, delete
pages, or publish anything. Headerless existing index/log files need a reported,
user-reviewed metadata correction, not an automatic migration.
The shared validator's `checkAction` is a validation API, not an action executor.
The CLI exposes `lint` only; it never implements, sends, merges, or closes a ticket.

Approval manifests live outside their hashed document sets. README gates retain
`doc`, user approval `date`, and `hash`, adding a ticket-relative `manifest` JSON path.
`hash` is the full SHA-256 of raw manifest bytes. The manifest contains
`version: 1`, `gate`, and `documents` entries with ticket-relative `path` and full
lowercase raw-byte `sha256`. A gate lists its one document (`story.md`, `plan.md`,
`review.md`, or `close.md`), the evidence files that the user must see, and no plan copy.
One user GO approves the whole displayed revision set. Approval README/records and the manifest never hash themselves.

Forge makes no external write. A text for another system is a paste text in `outbox/`, and the user sends it.

An approved gate without a manifest is a finding. Report missing evidence on Resume
without blocking unrelated read-only work. See the [complete approval contract](../plugins/forge/skills/ticket/SKILL.md#approval-revisions).

Classify wiki sources before checking them:

| Source class | Check and limitation |
|---|---|
| URL | Retain as a remote reference; local existence checks do not verify its content or availability. |
| Repository source | Resolve a repository-relative path only when its base repository is known from binding or configured checkout identity. Never guess from the wiki location. |
| Local-only raw/archive | Report unavailable on this machine separately from a broken shared link; do not publish it to repair the reference. |
| Moved path | Report the old path and verified replacement when known; do not delete the page or silently retarget its claims. |
| Unknown format, command, or historical investigation | Report that it cannot be resolved automatically; retain it for manual evidence review. |

Existence never verifies the text of a page. An old `updated` date is a review signal,
not proof that knowledge is false. Verify claims against current code or tools;
record unavailable sources and uncertainty instead of inventing evidence.

## Existing installations

A wiki from a forge 4 company pack keeps working. Its config already lives in the wiki.
The old `.base/` and `pack.lock.json` metadata has no runtime role.
You can remove that metadata after review; no automatic deletion occurs.

Forge 14.1.0 has no trust approval and no `forge.mjs run`: a wiki folder `forge/scripts/` is not used. Forge 14.0.0 does not use `tracker.md`, `ci.md`, `rules/toolkit.md`, or the `profile` key of `forge/repo.json`. `forge.mjs doctor` names them. Remove them.
To get the new config templates, say "refresh the forge config".
