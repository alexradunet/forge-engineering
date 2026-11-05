---
version: 1
id: forge-daily-recap
name: Prepare my daily
description: On work days at 10:20, prepare the draft daily recap with the forge daily-recap skill. Set the time to preparationTime in raw/daily-recap/settings.json.
schedule:
  kind: cron
  expression: "20 10 * * MON-FRI"
  timeZone: local
---
Prepare my daily.

Use the forge `daily-recap` skill, and follow its "⏰ Automation" section. No user answers questions in this run.
Write only under `<wiki>/raw/daily-recap/`. Do not change code, ticket files, approvals, or wiki pages.
