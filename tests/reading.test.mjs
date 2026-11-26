import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { countWords, diffGate, gateName, numberedItems, renderDiff, saveSnapshot, sectionDiff, sections, summaryBlock, summaryCheck, tableRow } from '../plugins/forge/scripts/lib/reading.mjs';
import { lint } from '../plugins/forge/scripts/lib/validation.mjs';
import { parseTicket } from '../plugins/forge/scripts/lib/ticket.mjs';

const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));
const words = (n, word = 'word') => Array.from({ length: n }, () => word).join(' ');

function wiki(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'forge-reading-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'raw', 'tickets', 'APP-5');
  const put = (name, text) => {
    const file = path.join(dir, ...name.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  const readme = ({ state = 'needs-me', phase = 'start', next = 'Approve the scope', card = true } = {}) => put('README.md', [
    '---', 'type: ticket', 'key: APP-5', 'title: Doc import error telemetry', 'workflow: full-v4', `phase: ${phase}`, `state: ${state}`,
    `next: ${next}`, 'waiting_on: ""', 'changes: []', 'people: []', 'gates:',
    '  - { name: Shippable?, doc: review.md, need: required, status: in-review }', 'updated: 2026-10-01', '---',
    '# APP-5: Doc import error telemetry', '',
    ...(card ? ['## Now', '', '- State: 🟡 needs-me', '- Phase: start', '- Next: Approve the scope', '- Waiting on: you', ''] : []),
    '## Notes', '',
  ].join('\n'));
  const ticket = () => parseTicket(readFileSync(path.join(dir, 'README.md'), 'utf8'));
  return { root, dir, put, readme, ticket };
}

const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('table rows and numbered items keep escaped pipes and the indented body of each item', () => {
  assert.deepEqual(tableRow('| a | b \\| c |  |'), ['a', 'b | c', '']);
  assert.deepEqual(numberedItems('1. First\n   - Files: x\n   - Why: y\n2. Second\n\n3) Third\n'), [
    { n: 1, title: 'First', body: '- Files: x\n- Why: y' }, { n: 2, title: 'Second', body: '' }, { n: 3, title: 'Third', body: '' },
  ]);
});

test('sections split on "## " headings after the frontmatter and ignore headings in code fences', () => {
  const text = ['---', 'title: x', '---', 'Intro line', '## ⚡ 1 min', 'Card', '```md', '## not a heading', '```', '## ☕ 5 min', 'More'].join('\r\n');
  const list = sections(text);
  assert.deepEqual(list.map((item) => item.heading), ['', '⚡ 1 min', '☕ 5 min']);
  assert.equal(list[0].text, 'Intro line');
  assert.match(list[1].text, /## not a heading/);
  assert.equal(list[1].line, 5);
});

test('word counts skip code fences and link targets, and keep words with hyphens or apostrophes whole', () => {
  assert.equal(countWords("The user's re-run [works](https://example.com/a/b/c) well."), 5);
  assert.equal(countWords(['Two words', '```mermaid', 'flowchart LR', '  A --> B', '```'].join('\n')), 2);
  assert.equal(countWords('| Gate | Status |\n|---|---|\n| Planned? | approved |'), 4);
});

test('gate names accept a short form and refuse unknown gates', () => {
  assert.equal(gateName('planned'), 'Planned?');
  assert.equal(gateName('Shippable?'), 'Shippable?');
  assert.equal(gateName(' LEARNED '), 'Learned?');
  assert.throws(() => gateName('scoped'), /Unknown gate: scoped\. Use one of: Planned\?, Shippable\?, Learned\?\./);
  assert.throws(() => gateName('Shipped'), /Unknown gate: Shipped/);
});

test('the section diff lists changed, added, and removed sections with line changes', () => {
  const before = ['## ⚡ 1 min', 'Fix the parser.', '## Risks', 'None.', '## Old', 'Gone soon.'].join('\n');
  const after = ['## ⚡ 1 min', 'Fix the parser and the logger.', '## Risks', 'None.', '## Tests', 'Add a unit test.'].join('\n');
  const list = sectionDiff(before, after);
  assert.deepEqual(list.map((item) => [item.section, item.status]), [['⚡ 1 min', 'changed'], ['Risks', 'same'], ['Tests', 'added'], ['Old', 'removed']]);
  assert.deepEqual(list[0].lines, ['- Fix the parser.', '+ Fix the parser and the logger.']);
  assert.deepEqual(list[3].lines, ['- Gone soon.']);
  const nested = sectionDiff(['## ☕ 5 min', 'Intro.', '### Steps', 'One.', '### Risks', 'Low.'].join('\n'), ['## ☕ 5 min', 'Intro.', '### Steps', 'One.', 'Two.', '### Risks', 'Low.'].join('\n'));
  assert.deepEqual(nested.filter((item) => item.status !== 'same').map((item) => [item.section, item.lines]), [['☕ 5 min › Steps', ['+ Two.']]]);
  assert.deepEqual(sections('## ☕ 5 min\n### Steps\nOne.').map((item) => item.heading), ['☕ 5 min'], 'Reading levels keep subsections inside the level.');
});

test('snapshots number each review, skip an unchanged doc, and the diff compares with the latest', (t) => {
  const w = wiki(t);
  w.readme();
  assert.throws(() => saveSnapshot(w.dir, w.ticket(), 'Shippable?'), /review\.md does not exist yet/);
  w.put('review.md', ['---', 'title: Review', '---', '# Review APP-5', 'Add telemetry to the import.', '## Scope', 'Details.', ''].join('\n'));
  const first = diffGate(w.dir, w.ticket(), 'Shippable?');
  assert.equal(first.documents[0].snapshot, null);
  assert.equal(renderDiff(first), 'Summary of review.md (first review):\nAdd telemetry to the import.');
  assert.deepEqual(saveSnapshot(w.dir, w.ticket(), 'Shippable?'), { gate: 'Shippable?', snapshots: [{ doc: 'review.md', snapshot: 'approvals/snapshots/shippable-1.md', n: 1, written: true }] });
  assert.equal(saveSnapshot(w.dir, w.ticket(), 'Shippable?').snapshots[0].written, false, 'An unchanged doc keeps the latest snapshot.');
  assert.match(renderDiff(diffGate(w.dir, w.ticket(), 'Shippable?')), /^review\.md has not changed since your last review \(approvals\/snapshots\/shippable-1\.md\)\.$/);
  w.put('review.md', ['---', 'title: Review', '---', '# Review APP-5', 'Add telemetry and an alert to the import.', '## Scope', 'Details.', ''].join('\n'));
  const text = renderDiff(diffGate(w.dir, w.ticket(), 'Shippable?'));
  assert.match(text, /^Changed since your last review \(review\.md vs approvals\/snapshots\/shippable-1\.md\):/);
  assert.match(text, /- \(top\): changed \(\+1 \/ -1 lines\)/);
  assert.match(text, /\+ Add telemetry and an alert to the import\./);
  assert.ok(!text.includes('Scope'), 'Unchanged sections are not shown.');
  assert.equal(saveSnapshot(w.dir, w.ticket(), 'Shippable?').snapshots[0].snapshot, 'approvals/snapshots/shippable-2.md');
});

test('Planned? has 2 documents: a snapshot and a diff for each, the primary document keeps the plain snapshot name', (t) => {
  const w = wiki(t);
  w.readme();
  w.put('README.md', readFileSync(path.join(w.dir, 'README.md'), 'utf8').replace('name: Shippable?, doc: review.md', 'name: Planned?, doc: plan.md'));
  w.put('story.md', ['# Story APP-5', '', 'Story summary.', '', '## Scope', '', 'Old scope', ''].join('\n'));
  assert.throws(() => saveSnapshot(w.dir, w.ticket(), 'Planned?'), /plan\.md does not exist yet/);
  w.put('plan.md', ['# Plan APP-5', '', 'Plan summary.', '', '## Steps', '', 'Old step', ''].join('\n'));
  assert.equal(renderDiff(diffGate(w.dir, w.ticket(), 'Planned?')), 'Summary of story.md (first review):\nStory summary.\n\nSummary of plan.md (first review):\nPlan summary.');
  const saved = saveSnapshot(w.dir, w.ticket(), 'Planned?');
  assert.deepEqual(saved.snapshots.map((item) => [item.doc, item.snapshot, item.written]), [
    ['story.md', 'approvals/snapshots/planned-story-1.md', true], ['plan.md', 'approvals/snapshots/planned-1.md', true],
  ]);
  assert.equal(renderDiff(diffGate(w.dir, w.ticket(), 'Planned?')), 'story.md and plan.md have not changed since your last review (approvals/snapshots/planned-story-1.md, approvals/snapshots/planned-1.md).');
  w.put('story.md', readFileSync(path.join(w.dir, 'story.md'), 'utf8').replace('Old scope', 'New scope'));
  const story = renderDiff(diffGate(w.dir, w.ticket(), 'Planned?'));
  assert.equal(story, 'Changed since your last review (story.md vs approvals/snapshots/planned-story-1.md):\n- Scope: changed (+1 / -1 lines)\n  - Old scope\n  + New scope');
  assert.deepEqual(saveSnapshot(w.dir, w.ticket(), 'Planned?').snapshots.map((item) => [item.snapshot, item.written]), [['approvals/snapshots/planned-story-2.md', true], ['approvals/snapshots/planned-1.md', false]], 'Only the changed document gets a new snapshot.');
  w.put('plan.md', readFileSync(path.join(w.dir, 'plan.md'), 'utf8').replace('Old step', 'New step'));
  const planOnly = renderDiff(diffGate(w.dir, w.ticket(), 'Planned?'));
  assert.equal(planOnly, 'Changed since your last review (plan.md vs approvals/snapshots/planned-1.md):\n- Steps: changed (+1 / -1 lines)\n  - Old step\n  + New step');
  w.put('story.md', readFileSync(path.join(w.dir, 'story.md'), 'utf8').replace('New scope', 'Newer scope'));
  assert.match(renderDiff(diffGate(w.dir, w.ticket(), 'Planned?')), /^Changed since your last review \(story\.md vs approvals\/snapshots\/planned-story-2\.md\):[\s\S]*\n\nChanged since your last review \(plan\.md vs approvals\/snapshots\/planned-1\.md\):/);
});

test('the commands snapshot and diff are gone: gate-open shows the diff, and gate-open --dry-run shows it with no write', (t) => {
  const w = wiki(t);
  w.readme();
  w.put('review.md', ['# Review APP-5', '', 'Card text.', ''].join('\n'));
  const base = ['--cwd', cwd, '--wiki', w.root];
  for (const command of ['snapshot', 'diff']) {
    const result = run(command, 'APP-5', 'planned', ...base);
    assert.equal(result.status, 2, command);
    assert.match(result.stderr, /^Usage: node forge\.mjs <where\|/);
    assert.doesNotMatch(result.stderr.split('\n')[0], /\b(snapshot|diff)\b/);
  }
  assert.ok(!existsSync(path.join(w.dir, 'approvals')), 'Nothing was written.');
});

test('lint checks the summary, the document budget, empty sections, and the plain Now card', (t) => {
  const w = wiki(t);
  const readme = (card) => w.put('README.md', [
    '---', 'type: ticket', 'key: APP-5', 'title: Doc import error telemetry', 'workflow: full-v4', 'phase: start', 'state: needs-me',
    'next: Approve the scope', 'waiting_on: ""', 'changes: []', 'people: []', 'gates:',
    '  - { name: Planned?, doc: plan.md, need: required, status: in-review }', 'updated: 2026-10-01', '---',
    '# APP-5: Doc import error telemetry', '', ...card, '## Files', '',
  ].join('\n'));
  const warnings = () => lint({ wikiPath: w.root }).findings.filter((item) => item.severity === 'warning').map((item) => item.code);
  readme(['## Now', '', '- State: 🟡 needs-me', '- Phase: start', '- Next: Approve the scope', '- Waiting on: you', '']);
  w.put('story.md', ['---', 'type: story', '---', '# Story APP-5: Telemetry', '', `Problem: ${words(40)}`, '', 'Need from you: GO on Planned?.', '', '## Scope', '', words(300), ''].join('\n'));
  assert.deepEqual(warnings(), []);
  assert.equal(summaryBlock(readFileSync(path.join(w.dir, 'story.md'), 'utf8')).split('\n')[0], `Problem: ${words(40)}`);

  w.put('story.md', ['# Story APP-5: Telemetry', '', '## Scope', '', 'In scope.', '', '## Facts', '', 'None', '', '## Preserve', ''].join('\n'));
  assert.deepEqual(warnings(), ['summary-missing', 'empty-section', 'empty-section']);
  w.put('story.md', ['# Story APP-5: Telemetry', '', words(151), '', '## Scope', '', words(1400), ''].join('\n'));
  assert.deepEqual(warnings(), ['summary-over-budget', 'document-over-budget']);
  const check = summaryCheck(readFileSync(path.join(w.dir, 'story.md'), 'utf8'));
  assert.deepEqual([check.words, check.over, check.total, check.totalOver], [151, true, 1551, true]);

  w.put('story.md', ['# Story APP-5: Telemetry', '', 'Short summary.', '', '## Scope', '', 'In scope.', ''].join('\n'));
  readme(['## Now', '', '- State: ▶️ active', '- Phase: start', '- Next: Something else', '']);
  assert.deepEqual(warnings(), ['now-card-stale']);
  readme([]);
  const missing = lint({ wikiPath: w.root }).findings.find((item) => item.code === 'now-card-missing');
  assert.equal(missing.message, 'README has no "## Now" card.');
});

test('the approval form text of a gate with one document is the summary on a first review, then only the changes', (t) => {
  const w = wiki(t);
  w.readme();
  w.put('review.md', ['---', 'type: review', '---', '# Review APP-5: Telemetry', '', 'Result: telemetry works.', '', 'Need from you: GO on Shippable?.', '', '## Scope', '', 'Old line', ''].join('\n'));
  const first = diffGate(w.dir, w.ticket(), 'Shippable?');
  assert.equal(renderDiff(first), 'Summary of review.md (first review):\nResult: telemetry works.\n\nNeed from you: GO on Shippable?.');
  assert.equal(saveSnapshot(w.dir, w.ticket(), 'Shippable?').snapshots[0].snapshot, 'approvals/snapshots/shippable-1.md');
  assert.equal(renderDiff(diffGate(w.dir, w.ticket(), 'Shippable?')), 'review.md has not changed since your last review (approvals/snapshots/shippable-1.md).');
  w.put('review.md', readFileSync(path.join(w.dir, 'review.md'), 'utf8').replace('Old line', 'New line'));
  const text = renderDiff(diffGate(w.dir, w.ticket(), 'Shippable?'));
  assert.match(text, /^Changed since your last review \(review\.md vs approvals\/snapshots\/shippable-1\.md\):\n- Scope: changed \(\+1 \/ -1 lines\)\n {2}- Old line\n {2}\+ New line$/);
  w.put('review.md', '# Review APP-5: Telemetry\n\n## Scope\n\nText\n');
  rmSync(path.join(w.dir, 'approvals'), { recursive: true });
  assert.match(renderDiff(diffGate(w.dir, w.ticket(), 'Shippable?')), /no summary: write at most 150 words under the title/);
});
