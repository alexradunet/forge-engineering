---
changeName: PR
branchPattern: "users/<user>/{KEY}-{slug}"
baseBranch: main
---

# Repository (`config/repo.md`)

> forge reads this file as `config/repo.md`. `forge-setup` copies it from `templates/config/`. `repo.<key>` means the frontmatter key `<key>` of this file.

Forge pushes the ticket branch after the Shippable? GO. Forge does not open the change request. You open it in the web UI of your code host.
`changeName` is `PR`, `MR`, or `none`. It is the name of the change request in the texts of Forge. `none`: the push goes to the base branch.
`branchPattern` is the name of the ticket branch. `baseBranch` is the branch that the change request targets.

## 📁 Checkouts

This table is `repo.checkouts`: the local clones that forge works in. The first row is the main checkout. An empty `baseBranch` uses `repo.baseBranch`.
Setup adds the row of your main clone.

| Name | Path | Remote | baseBranch |
|---|---|---|---|
