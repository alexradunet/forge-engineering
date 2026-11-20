# Shared configuration in the wiki

The repository wiki is the source for configuration, helper scripts, and knowledge pages.
It is a separate Git repository at `../<repo>.forge/wiki`, in the Forge folder of the repository.
The plugin holds the templates of its profile. `forge-setup` copies them to the wiki. There is no pack to install or update.

```mermaid
flowchart LR
  templates["forge templates"] -- seed missing files --> wiki["repository wiki"]
  wiki <-->|push / pull| remote["wiki Git remote"]
  wiki --> trust["local SHA-256 approval"]
  trust --> forge["config and script commands"]
```

## Layout

```text
<repo>.forge/             the Forge folder (<forge>)
  forge, forge.cmd        the launcher: "../<repo>.forge/forge open" shows the board and the wiki
  raw/                    local working material: tickets, pages, sync notes
  archive/                local archives of closed tickets
  wiki/                   the wiki (<wiki>): a git repository
    index.md              knowledge index
    forge/
      repo.json           repository binding
      config/
        tracker.md
        repo.md
        ci.md
        policy.md
      scripts/            optional helper scripts
    rules/                company rules for each session (toolkit.md, data.md, ...)
```

Forge 10 does not read an older folder `../<repo>.wiki`. To keep such a wiki, make the folder `../<repo>.forge`, move the wiki into `wiki/`, and move `raw/` and `archive/` next to it.

Say "set up forge" to create the wiki and seed missing config files.
Setup keeps existing configuration. See [config.md](config.md) for the file format.

## Company rules

The `<wiki>/rules/` pages hold the rules for AI agents: tools, credentials, and data rules.
Each page is a normal wiki page with frontmatter. When the folder is missing, setup writes
`toolkit.md` and `data.md` from templates.
The Forge `sessionStart` hook gives the pages to each session of the bound repository, after the
`# forge plugin` and `# forge style` rules, in file name order. It removes the frontmatter and
HTML comments, leaves out a page with only headings, and cuts the text after 8000 characters.
The hook gives a page only when the user approved its exact revision (see [Trust](#trust)):
`trust approve ../rules/data.md=<hash>`. The path is relative to `<wiki>/forge`.
For a new or changed page, the hook tells the agent not to follow it.
Put step rules for tickets in the hook sections of `policy.md`, not in a rule page.

## Share through Git

The wiki can stay personal. To share it with a team, do these steps:

1. Edit configuration and scripts directly in the wiki.
2. Review and commit only files that belong in the shared wiki.
3. Push the wiki after explicit approval of the command and target.
4. Teammates clone it to `../<repo>.forge/wiki`, or pull changes in their existing clone.
5. Run setup to bind the clone and review its files before local trust approval.

Each code repository has its own wiki binding.
Do not bind one wiki to several unrelated repositories.
To reuse a script or setting elsewhere, copy the reviewed file into that repository's wiki.

### Public or private

A native public wiki is suitable when all tracked files and Git history contain public data.
Otherwise, use a private wiki repository or keep the wiki local.
Never change repository visibility as part of setup.

Before a public push, check configuration, scripts, knowledge pages, and Git history.
Exclude secrets, personal paths, internal hosts, company guidance, and private project details.
Check `forge/repo.json` and the **Checkouts** table for local paths.
Do not assume that a secret scan detects all private content.

`raw/` and `archive/` are outside of the wiki repository.
Check the tracked files before any push.
Never publish credentials or trust approvals.

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
revisions, and canonical wiki metadata. Forge supports only `workflow: full-v3`. A ticket
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

A write has no manifest and no sidecar. Its "yes" is the answer of the user to the
host prompt that the gate guard asks for, and a `log` entry in `journal.md` records the sent write.

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

## Trust

Forge does not use new or changed configuration, scripts, or rule pages (`rules/`) until the user approves their hashes.
A Git pull cannot approve its own changes.

1. Run `node "<plugin>/scripts/forge.mjs" trust`.
2. Review each new or changed file.
3. Approve only after the user says yes: `node "<plugin>/scripts/forge.mjs" trust approve <path>=<first 12 hash characters> ...`.

Approvals live in the user data folder, not in the wiki.
Each teammate approves files on their own machine.
Forge refuses symlinks and special files.
`config` checks configuration; `run` checks both configuration and scripts.

Use `.gitattributes` with `* text=auto eol=lf` in the wiki for consistent line endings.
Hashes cover exact bytes, including line endings.

## Helper scripts

Prefer a CLI with its own login, such as `gh` or `az`.
Use a script only for a credential or a guard that the CLI does not provide.
Store it in `<wiki>/forge/scripts/<name>.mjs`.

Run it from the code repository or its bound wiki:

```sh
node "<plugin>/scripts/forge.mjs" run <name> [args...]
```

Forge sets these environment variables:

| Variable | Value |
|---|---|
| `FORGE_CORE` | The core scripts folder |
| `FORGE_WIKI` | The repository wiki folder |
| `FORGE_REPO` | The main code checkout |

Use Node.js built-ins. Forge does not install dependencies for wiki scripts.
A profile can ship its own tool scripts in `<plugin>/scripts/`, for example a REST client for the CI. Run them directly from there. They need no wiki trust.

Read credentials through `${FORGE_CORE}/lib/cred.mjs`.
The user stores them with `node "<plugin>/scripts/cred.mjs" set <name>`.
A script that accepts a secret uses `readSecret(prompt)` from `${FORGE_CORE}/cred.mjs`.
Store that value with `createStore().set(name, value)` from `${FORGE_CORE}/lib/cred.mjs`.
Never print secrets or pass them in child process arguments.

## Existing installations

A wiki from a forge 4 company pack keeps working. Its config already lives in the wiki.
The old `.base/` and `pack.lock.json` metadata stays ignored by trust and has no runtime role.
You can remove that metadata after review; no automatic deletion occurs.

When a pack script `<wiki>/forge/scripts/<name>.mjs` is now a profile script in the plugin,
use `node "<plugin>/scripts/<name>.mjs"` instead of `forge.mjs run <name>`. You can delete the wiki copy after review.
The stored credentials stay valid.
To get the new profile templates, say "refresh the forge config".
