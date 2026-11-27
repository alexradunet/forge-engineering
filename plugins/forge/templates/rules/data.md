---
title: Data rules
status: decided
updated: 2026-01-01
sources:
  - "command: forge.mjs seed"
---

# 🔒 Data rules

- `raw/` and `archive/` can hold internal names. Canonical pages stay free of customer data.
- Never print a secret from a workflow log or from an environment variable.
- Never ask the user to paste a password or a token into chat.
