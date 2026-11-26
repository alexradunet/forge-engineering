# GitHub profile for forge setup

The `forge-setup` skill reads this page first. It holds the values that all users of this profile share.
The machine values (the tools and the profile files) are in `profile.json`.

## Shared values

The templates already hold these values:

- Tracker: GitHub Issues of the main checkout, with `gh`. The key of issue `#123` is `GH-123`.
- Repository: GitHub pull requests, with `gh`. The base branch is `main`.
- CI: GitHub Actions, with `gh`.
- Policy: a short generic policy and the rule pages `toolkit.md` and `data.md`.

## Repository

- The main repository is the GitHub repository of the current workspace. Each GitHub remote is correct.
- When the default branch is not `main`, set `repo.baseBranch` to the default branch.

## Personal values

| Key | Prefill | Example |
|---|---|---|
| `repo.branchPattern` | `users/<user>/{KEY}-{slug}` | `users/alex/{KEY}-{slug}` |
| main checkout | the clone that `detect` finds | `app`, `C:\dev\app`, `acme/app` |

- Write the main checkout with `<F> config row checkouts "<name>" "<path>" "<owner/repo>"`.
- The template queries `mine` and `team` use the GitHub issue search syntax. For a team label, change `team`:
  `<F> config row queries "team" "state:open label:\"<your label>\" sort:updated-desc"`.

## Tools

| CLI | Use | Login |
|---|---|---|
| `gh` | Issues, pull requests, and Actions runs | `gh auth login --hostname github.com` |

## Credentials

This profile needs no credential in the OS credential store. The `gh` login is sufficient.

## Live read

- `tracker.fetch`: ask for one real issue number.
- `ci.status`: a repository without workflow runs gives an empty list. That is `ok`.

## End state

- `gh` is installed and logged in.

## Policy notes

- `forge-setup` asks for the team size at step 6, and writes `planReview`, `scopeComment`, `evidenceOnDeployedEnv`, `qaHandover`, and `styleRules` with one `config set`.
- `noMergeWeekdays`: empty. Add a day when your team has a release day.
- `evidenceOnDeployedEnv`: `false`. Set it to `true` when you can deploy a branch.
- `qaHandover`: `false`. Set it to `true` when a QA person tests after the merge.

## First ticket

Tell the user: "Say `start GH-<issue number>` to begin a ticket."
