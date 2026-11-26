# Forgejo profile for forge setup

The `forge-setup` skill reads this page first. It holds the values that all users of this profile share.
The machine values (the tools and the detect rule) are in `profile.json`.

## Shared values

The profile files already hold these values:

- Tracker: Forgejo or Gitea issues, with `tea`. The key of issue `#123` is `<prefix>-123`.
- Repository: Forgejo pull requests, with `tea`. The base branch is `main`.
- CI: Forgejo Actions, with `tea`.
- Policy: the short generic policy and the rule page `data.md` of the default profile, and the rule page `toolkit.md` of this profile.

## Server values

A Forgejo server is self-hosted. These values are different for each repository. Setup writes them:

| Key | Value |
|---|---|
| `tracker.host`, `repo.host`, `ci.host` | The host of the remote, for example `git.example.org`. `detect` gives it in `suggestion.values.host`. |
| `tracker.prefix` | Ask the user. The letter `L` is not allowed (it is the prefix of a local ticket). |
| `repo.changeName` | `PR`. A repository with no pull requests: `none`. |
| `repo.branchPattern` | `users/<user>/{KEY}-{slug}`. Put the user name in place of `<user>`. |
| main checkout | The clone that `detect` finds. |

- Write the values with `<F> config set tracker.host=<host> repo.host=<host> ci.host=<host> tracker.prefix=<prefix>`.
- Write the main checkout with `<F> config row checkouts "<name>" "<path>" "<remote URL>"`.
- The template queries `mine` and `team` are the options of `tea issues list`. For `mine`, put your user name in place of `<your user>`.

## Tools

| CLI | Use | Login |
|---|---|---|
| `tea` | Issues, pull requests, and Actions runs | `tea login add` |

Check the login with `tea logins list`. In a checkout, `tea whoami` shows the user.

## Credentials

This profile needs no credential in the OS credential store. The `tea` login is sufficient.

## Live read

Run these commands in the main checkout:

- `tea whoami`
- `tea issues list --state open --limit 3`
- `tea actions runs list --limit 3`: a repository without workflow runs gives an empty list. That is `ok`.

The read commands ran on a real Forgejo server: `tea whoami`, `tea issues <n> --comments`, `tea issues list`, `tea actions runs list`, and `tea pulls list`.
No write command ran with Forge. The write commands for issues and for pull requests come from the `tea` 0.14 help.

## End state

- `tea` is installed and logged in.
- The host values and `tracker.prefix` are written.

## Policy notes

- `forge-setup` asks for the team size at step 6, and writes `planReview`, `scopeComment`, `evidenceOnDeployedEnv`, `qaHandover`, and `styleRules` with one `config set`.
- `noMergeWeekdays`: empty. Add a day when your team has a release day.
- `evidenceOnDeployedEnv`: `false`. Set it to `true` when you can deploy a branch.
- `qaHandover`: `false`. Set it to `true` when a QA person tests after the merge.

## First ticket

Tell the user: "Say `start <prefix>-<issue number>` to begin a ticket."
