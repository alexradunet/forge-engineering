// Demo data for the pages: a Forge folder with invented tickets, one complete full-v4 ticket, and a small wiki.
// seedDemo(root) writes <root>/demo.forge/{wiki,raw} and an empty <root>/demo (the repository). The names are invented.
// tests/ui-kit.test.mjs checks it, and tests/shots/run.mjs takes the screenshots of the pages from it.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** The ticket folder of the complete ticket. */
export const FULL_TICKET = 'app-101';

function ticketReadme(key, { state, phase = 'plan', title, short = '', next = '', waitingOn = '', updated = '2026-11-16', gates = [], people = [], extra = [], changes = [] }) {
  return [
    '---', 'type: ticket', `key: ${key}`, `title: ${JSON.stringify(title)}`, ...(short ? [`short: ${short}`] : []),
    'workflow: full-v4', `phase: ${phase}`, `state: ${state}`, `next: ${next || `Next step of ${key}`}`, `waiting_on: ${JSON.stringify(waitingOn)}`,
    ...(changes.length ? ['changes:', ...changes] : ['changes: []']), ...(people.length ? ['people:', ...people] : ['people: []']), 'gates:', ...gates, ...extra, `updated: ${updated}`, '---',
    `# ${key}: ${title}`, '', '## Now', '', `- State: ${state}`, `- Phase: ${phase}`, `- Next: ${next || `Next step of ${key}`}`, '',
  ].join('\n');
}

const gate = (name, doc, status, date = '') => `  - { name: ${name}, doc: ${doc}, need: required, status: ${status}${date ? `, date: ${date}` : ''} }`;

const STORY = [
  '---', 'type: story', 'ticket: APP-101', 'gate: Planned?', 'updated: 2026-11-10', '---', '# Story APP-101: Fix the retry of the email outbox', '',
  'Problem: the retry job stops after 3 seconds, so 1 of 20 mails of a busy account is lost.', '',
  'Scope: the retry job reads its time limit from the new setting. The sender does not change.', '',
  'Need from you: GO on Planned?. Then I investigate.', '',
  '## Problem', '', 'A busy account sends 400 mails in one minute. The job gives up on a slow mail after 3 s, and the mail stays in the outbox until the next night.', '', 'The setting today:', '', '```json', '{ "Retry": { "Timeout": 3, "Attempts": 5 } }', '```', '',
  '## Scope', '', 'In:', '', '- The retry job and its setting', '- A test for a slow mail', '', 'Out:', '', '- The sender: it has its own limit', '',
  '## Done when', '', '1. A slow mail is sent again after 30 s. Proof: a test with a fake clock', '',
  '## Open questions', '', '- Does a tenant use the old key? Ask: Mara. Status: answered. If the answer differs: keep a fallback', '',
].join('\n');

const MAP = [
  '---', 'type: map', 'ticket: APP-101', 'updated: 2026-11-11', '---', '# Map APP-101: outbox retry', '',
  'The retry job takes the failed rows of the outbox and sends them again.', '',
  '## Components', '', '| Component | Layer | File | Role | Change |', '|---|---|---|---|---|',
  '| Settings page | Page | [Settings.razor](/repo/src/Settings.razor) | Shows the time limit to an admin | |',
  '| Scheduler | Service | | Starts the retry job each minute | |',
  '| RetryJob | Service | [RetryJob.cs](/repo/src/RetryJob.cs) | Sends failed rows again | planned |',
  '| OutboxConfig | Service | [OutboxConfig.cs](/repo/src/OutboxConfig.cs) | Holds the time limit in seconds | done |',
  '| Sender | Service | | Sends one mail | |',
  '| Outbox table | SQL | | The failed rows | |', '',
  '## Flow', '', '- Scheduler -> RetryJob: starts it', '- RetryJob -> OutboxConfig: reads the time limit', '- RetryJob -> Outbox table: selects failed rows', '- RetryJob -> Sender: sends one row', '- Settings page -> OutboxConfig: saves the limit', '',
  '## Terms', '', '- Outbox: rows that wait for a send', '',
].join('\n');

const PLAN = [
  '---', 'type: plan', 'ticket: APP-101', 'gate: Planned?', 'updated: 2026-11-12', '---', '# Plan APP-101: Fix the retry of the email outbox', '',
  'Cause: the job reads the old key, and the old key holds 3 s.', '',
  'Change: read the new key, and add a test for a slow mail.', '',
  'Need from you: GO on Planned?. Then I implement.', '',
  '## Diagnosis', '', '- H1 supported: the job reads `Retry.Timeout` ([evidence](evidence/2026-11-11-config.md))', '- H2 rejected: the clock of the server is wrong', '- H3 open: a proxy closes the connection at 5 s', '',
  '## Steps', '', '1. Read the new key', '   - Files: [RetryJob.cs](/repo/src/RetryJob.cs:42)', '   - Why: the old key holds 3 s', '   - Test: a unit test with a fake clock',
  '2. Add the test for a slow mail', '   - Files: [RetryJobTests.cs](/repo/tests/RetryJobTests.cs)', '3. Remove the old key', '   - Files: [OutboxConfig.cs](/repo/src/OutboxConfig.cs)', '4. Update the sample config', '   - Files: [appsettings.sample.json](/repo/appsettings.sample.json)', '   - Why: a new user copies it', '',
  '## Tests', '', '- Unit: a slow mail is sent again. Checks: the wait is 30 s', '',
  '## Checks', '', '1. A retry waits 30 s', '   - Action: send a mail with a slow server', '   - Expected: the retry starts after 30 s', '   - Baseline: the retry starts after 3 s', '',
  '## Risks', '', '- 🟡 medium: a tenant with the old key gets 30 s. Mitigation: keep the old key for one release. Rollback: set the old key.', '',
  '## Details', '', 'The job runs in this order:', '', '```mermaid', 'flowchart LR', '  S[Scheduler] --> R[RetryJob]', '  R --> C[OutboxConfig]', '  R --> T[(Outbox table)]', '  R --> M[Sender]', '```', '',
].join('\n');

const REVIEW = [
  '---', 'type: review', 'ticket: APP-101', 'gate: Shippable?', 'updated: 2026-11-16', '---', '# Review APP-101: Fix the retry of the email outbox', '',
  'Result: a slow mail is sent again after 30 s. 14 of 14 tests pass.', '', 'Risk: 🟡 medium: a tenant with the old key gets 30 s.', '',
  'Need from you: GO on Shippable?, and 1 decision. Then I push and open the change request.', '',
  'Decision 1: keep the old key for one release? Recommended: yes.', '',
  '## Changes', '', '- RetryJob: reads the new key. Files: [RetryJob.cs](/repo/src/RetryJob.cs). User impact: slow mails arrive', '',
  '## Before and after', '', '- Before: the retry waits 3 s', '- After: the retry waits 30 s', '', '| Key | Before | After |', '|---|---|---|', '| `Retry.Timeout` | 3 | 30 |', '| `Retry.Attempts` | 5 | 5 |', '',
  '## Tests run', '', '- dotnet test: 14 passed ([evidence](evidence/2026-11-11-config.md))', '',
  '## Findings', '', '- medium: the old key is still in the sample config. Fixed: the sample uses the new key', '',
  '## Not checked', '', '- A real mail server: the test uses a fake one', '',
].join('\n');

const PROOF = [
  '---', 'type: proof', 'ticket: APP-101', 'updated: 2026-11-16', '---', '# Proof APP-101: Fix the retry of the email outbox', '', 'Result: 3 of 4 checks verified.', '',
  '## Checks', '', '1. 🟢 verified: a retry waits 30 s', '   - Observed: 30 s', '2. 🟢 verified: a fast mail is sent at once', '3. 🟢 verified: the old key is ignored', '   - Observed: the old key no longer sets the delay',
  '4. ⚪ not proven: the telemetry shows the retry', '',
].join('\n');

const JOURNAL = [
  '---', 'type: journal', 'ticket: APP-101', 'updated: 2026-11-16', '---', '# Journal APP-101', '',
  '## 2026-11-10 log: research', '', 'Read the wiki page about the outbox.', '',
  '## 2026-11-13 step 1 done: read the new key', '', 'Commit 4f3a9c1.', '',
  '## 2026-11-14 step 2 done: test for a slow mail', '', '## 2026-11-15 step 1 verified: run with a slow server', '',
  '## 2026-11-15 decision: keep the old key for one release', '', 'Reason: one tenant still uses it.', '',
  '## 2026-11-16 problem: the old key is still read', '', 'The sample config sets it.', '',
].join('\n');

const page = (title, body, { updated = '2026-11-10', status = 'verified' } = {}) => ['---', `title: ${JSON.stringify(title)}`, `updated: ${updated}`, `status: ${status}`, '---', `# ${title}`, '', body, ''].join('\n');

/**
 * Writes the demo and returns { forge, wiki, repo }.
 * - 6 tickets, one in each board state (APP-101 needs me, APP-102 blocked, APP-103 go, APP-104 active, APP-105 waiting, APP-106 done),
 *   a people wait, an item link, and a change on APP-104, and one ticket folder (app-107) that gives a read error.
 * - APP-101 has the 6 documents of the full-v4 layout: a Mermaid block, a gate in review, steps, checks, hypotheses, and a code map with edges.
 * - The wiki has 5 pages that link to each other, and one closed ticket (tickets/app-90.md).
 */
export function seedDemo(root) {
  const forge = path.join(root, 'demo.forge');
  const wiki = path.join(forge, 'wiki');
  const repo = path.join(root, 'demo');
  const put = (base, name, text) => {
    const file = path.join(base, ...name.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  const raw = (name, text) => put(path.join(forge, 'raw'), name, text);
  mkdirSync(repo, { recursive: true });

  raw('tickets/app-101/README.md', ticketReadme('APP-101', {
    state: 'needs-me', phase: 'review', title: 'Fix the retry of the email outbox', short: 'Fix outbox retry', next: 'Approve the review (Shippable?)', waitingOn: 'you: Shippable?',
    gates: [gate('Planned?', 'plan.md', 'approved', '2026-11-12'), gate('Shippable?', 'review.md', 'in-review')],
    extra: ['branch: "alex/APP-101-outbox-retry"', 'worktree: "/code/demo.worktrees/APP-101"'],
  }));
  for (const [name, text] of Object.entries({ 'story.md': STORY, 'map.md': MAP, 'plan.md': PLAN, 'review.md': REVIEW, 'proof.md': PROOF, 'journal.md': JOURNAL })) raw(`tickets/app-101/${name}`, text);
  raw('tickets/app-101/evidence/2026-11-11-config.md', '---\ntype: evidence\n---\n# Evidence: the retry key\n\nThe job reads `Retry.Timeout`. The value is 3.\n');

  raw('tickets/app-102/README.md', ticketReadme('APP-102', {
    state: 'blocked', phase: 'investigate', title: 'Export of an order list times out for large accounts', short: 'Order export timeout', updated: '2026-11-03', waitingOn: 'infra: a log of the export node',
    next: 'Get the log of the export node',
  }));
  raw('tickets/app-103/README.md', ticketReadme('APP-103', {
    state: 'go', phase: 'plan', title: 'Show the time zone in the invoice header', short: 'Invoice time zone', next: 'Start the plan', updated: '2026-11-17',
    gates: [gate('Planned?', 'plan.md', 'todo')],
  }));
  raw('tickets/app-104/README.md', ticketReadme('APP-104', {
    state: 'active', phase: 'implement', title: 'Port the settings grid to the new table', short: 'Port the settings grid', next: 'Step 2 of 4: the sort order',
    gates: [gate('Planned?', 'plan.md', 'approved', '2026-11-11'), gate('Shippable?', 'review.md', 'todo')],
    people: ['  - { name: Mara, role: reviewer, status: waiting, since: 2026-11-02, ask: "Is the old grid still used by the admin pages?" }'],
    extra: ['item: https://tracker.example.test/APP-104', 'worktree: "/code/demo.worktrees/APP-104"'], changes: ['  - { url: "https://host.example.test/pulls/58", state: open, label: PR }'],
  }));
  raw('tickets/app-105/README.md', ticketReadme('APP-105', {
    state: 'waiting', phase: 'review', title: 'Rename the audit log columns', short: 'Rename audit columns', next: 'Wait for the review of the change request', waitingOn: 'Noor: review of the change request',
    gates: [gate('Shippable?', 'review.md', 'approved', '2026-11-16')], updated: '2026-11-16',
  }));
  raw('tickets/app-106/README.md', ticketReadme('APP-106', { state: 'done', phase: 'closed', title: 'Remove the unused theme flag', short: 'Remove theme flag', next: 'Closed', updated: '2026-11-12' }));
  // A ticket folder that gives a read error: the README has no valid ticket fields.
  raw('tickets/app-107/README.md', '---\nkey: APP-107\n---\n');

  put(wiki, 'index.md', '---\ntitle: Wiki index\ntype: index\n---\n# Wiki index\n\n- [Build and test](tooling/build.md): how the build runs\n- [The email outbox](app/outbox.md): how a mail is sent and sent again\n- [Retry limits](app/retry.md)\n- [Release steps](tooling/release.md)\n');
  put(wiki, 'log.md', '---\ntitle: Wiki log\ntype: log\n---\n# Wiki log\n\n## 2026-11-10 create: outbox\n\n- app/outbox.md\n');
  put(wiki, 'tooling/build.md', page('Build and test', 'The build uses `dotnet build`, and the tests use `dotnet test`. See [the outbox](../app/outbox.md) and [the release steps](release.md).\n\n## Steps\n\n1. Restore the packages.\n2. Run the tests.'));
  put(wiki, 'tooling/release.md', page('Release steps', 'A release goes out on Tuesday. The build page has the commands: [build](build.md).', { updated: '2026-11-08' }));
  put(wiki, 'app/outbox.md', page('The email outbox', 'A mail waits in the outbox until the sender takes it. The retry job sends a failed row again, see [retry limits](retry.md#limits).\n\n```mermaid\nflowchart LR\n  A[Mail] --> B[(Outbox)]\n  B --> C[Sender]\n  C -- fails --> D[RetryJob]\n  D --> B\n```'));
  put(wiki, 'app/retry.md', page('Retry limits', 'The retry job waits for the time limit of the new key.\n\n## Limits\n\n- Default: 30 s\n- The old key is read for one release.', { status: 'needs-check', updated: '2026-11-16' }));
  put(wiki, 'tickets/app-90.md', page('APP-90: Send the mail again after a crash', '- Knowledge: [the outbox](../app/outbox.md).\n- The fix reads the failed rows at the start of the job.', { updated: '2026-11-05' }));

  return { forge, wiki, repo };
}
