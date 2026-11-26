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
    '---', 'type: ticket', 'key: APP-5', 'title: Doc import error telemetry', 'workflow: full-v3', `phase: ${phase}`, `state: ${state}`,
    `next: ${next}`, 'waiting_on: ""', 'changes: []', 'people: []', 'gates:',
    '  - { name: Scoped?, doc: story.md, need: required, status: in-review }', 'updated: 2026-10-01', '---',
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
  assert.equal(countWords('| Gate | Status |\n|---|---|\n| Scoped? | approved |'), 4);
});

test('gate names accept a short form and refuse unknown gates', () => {
  assert.equal(gateName('scoped'), 'Scoped?');
  assert.equal(gateName('Planned?'), 'Planned?');
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
  assert.throws(() => saveSnapshot(w.dir, w.ticket(), 'Scoped?'), /story\.md does not exist yet/);
  w.put('story.md', ['---', 'title: Story', '---', '# Story APP-5', 'Add telemetry to the import.', '## Scope', 'Details.', ''].join('\n'));
  const first = diffGate(w.dir, w.ticket(), 'Scoped?');
  assert.equal(first.snapshot, null);
  assert.equal(renderDiff(first), 'Summary of story.md (first review):\nAdd telemetry to the import.');
  assert.deepEqual(saveSnapshot(w.dir, w.ticket(), 'Scoped?'), { gate: 'Scoped?', doc: 'story.md', snapshot: 'approvals/snapshots/scoped-1.md', n: 1, written: true });
  assert.equal(saveSnapshot(w.dir, w.ticket(), 'Scoped?').written, false, 'An unchanged doc keeps the latest snapshot.');
  assert.match(renderDiff(diffGate(w.dir, w.ticket(), 'Scoped?')), /has not changed since your last review \(approvals\/snapshots\/scoped-1\.md\)/);
  w.put('story.md', ['---', 'title: Story', '---', '# Story APP-5', 'Add telemetry and an alert to the import.', '## Scope', 'Details.', ''].join('\n'));
  const text = renderDiff(diffGate(w.dir, w.ticket(), 'Scoped?'));
  assert.match(text, /^Changed since your last review \(story\.md vs approvals\/snapshots\/scoped-1\.md\):/);
  assert.match(text, /- \(top\): changed \(\+1 \/ -1 lines\)/);
  assert.match(text, /\+ Add telemetry and an alert to the import\./);
  assert.ok(!text.includes('Scope'), 'Unchanged sections are not shown.');
  assert.equal(saveSnapshot(w.dir, w.ticket(), 'Scoped?').snapshot, 'approvals/snapshots/scoped-2.md');
});

test('the snapshot and diff commands print text or JSON and refuse bad arguments', (t) => {
  const w = wiki(t);
  w.readme();
  w.put('story.md', ['# Story APP-5', '', 'Card text.', ''].join('\n'));
  const base = ['--cwd', cwd, '--wiki', w.root];
  const diff = run('diff', 'app-5', 'scoped', ...base);
  assert.equal(diff.status, 0, diff.stderr);
  assert.equal(diff.stdout.trim(), 'Summary of story.md (first review):\nCard text.');
  const saved = run('snapshot', 'APP-5', 'Scoped?', '--json', ...base);
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(JSON.parse(saved.stdout).snapshot, 'approvals/snapshots/scoped-1.md');
  assert.ok(existsSync(path.join(w.dir, 'approvals', 'snapshots', 'scoped-1.md')));
  const again = run('snapshot', 'APP-5', 'Scoped?', ...base);
  assert.equal(again.stdout.trim(), 'Scoped? unchanged: approvals/snapshots/scoped-1.md');
  const json = JSON.parse(run('diff', 'APP-5', 'Scoped?', '--json', ...base).stdout);
  assert.equal(json.changed, false);
  assert.equal(json.card, 'Card text.');
  const bad = run('diff', 'APP-5', ...base);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Usage: forge\.mjs diff <key> <gate>/);
  const unknown = run('snapshot', 'APP-5', 'Shipped', ...base);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown gate: Shipped/);
});

test('full-v3 lint checks the summary, the document budget, empty sections, and the plain Now card', (t) => {
  const w = wiki(t);
  const readme = (card) => w.put('README.md', [
    '---', 'type: ticket', 'key: APP-5', 'title: Doc import error telemetry', 'workflow: full-v3', 'phase: start', 'state: needs-me',
    'next: Approve the scope', 'waiting_on: ""', 'changes: []', 'people: []', 'gates:',
    '  - { name: Scoped?, doc: story.md, need: required, status: in-review }', 'updated: 2026-10-01', '---',
    '# APP-5: Doc import error telemetry', '', ...card, '## Files', '',
  ].join('\n'));
  const warnings = () => lint({ wikiPath: w.root }).findings.filter((item) => item.severity === 'warning').map((item) => item.code);
  readme(['## Now', '', '- State: 🟡 needs-me', '- Phase: start', '- Next: Approve the scope', '- Waiting on: you', '']);
  w.put('story.md', ['---', 'type: story', '---', '# Story APP-5: Telemetry', '', `Problem: ${words(40)}`, '', 'Need from you: GO on Scoped?.', '', '## Scope', '', words(300), ''].join('\n'));
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

test('the full-v3 approval form text is the summary on a first review, then only the changes', (t) => {
  const w = wiki(t);
  w.readme();
  w.put('story.md', ['---', 'type: story', '---', '# Story APP-5: Telemetry', '', 'Problem: no telemetry.', '', 'Need from you: GO on Scoped?.', '', '## Scope', '', 'Old line', ''].join('\n'));
  const first = diffGate(w.dir, w.ticket(), 'Scoped?');
  assert.equal(first.layout, 'summary');
  assert.equal(renderDiff(first), 'Summary of story.md (first review):\nProblem: no telemetry.\n\nNeed from you: GO on Scoped?.');
  assert.equal(saveSnapshot(w.dir, w.ticket(), 'Scoped?').snapshot, 'approvals/snapshots/scoped-1.md');
  assert.equal(renderDiff(diffGate(w.dir, w.ticket(), 'Scoped?')), 'story.md has not changed since your last review (approvals/snapshots/scoped-1.md).');
  w.put('story.md', readFileSync(path.join(w.dir, 'story.md'), 'utf8').replace('Old line', 'New line'));
  const text = renderDiff(diffGate(w.dir, w.ticket(), 'Scoped?'));
  assert.match(text, /^Changed since your last review \(story\.md vs approvals\/snapshots\/scoped-1\.md\):\n- Scope: changed \(\+1 \/ -1 lines\)\n {2}- Old line\n {2}\+ New line$/);
  w.put('story.md', '# Story APP-5: Telemetry\n\n## Scope\n\nText\n');
  rmSync(path.join(w.dir, 'approvals'), { recursive: true });
  assert.match(renderDiff(diffGate(w.dir, w.ticket(), 'Scoped?')), /no summary: write at most 150 words under the title/);
});
