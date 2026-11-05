import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { countWords, diffGate, gateName, quickCard, readingLevels, renderDiff, saveSnapshot, sectionDiff, sections } from '../plugins/forge/scripts/lib/reading.mjs';
import { lint } from '../plugins/forge/scripts/lib/validation.mjs';
import { parseTicket } from '../plugins/forge/scripts/lib/ticket.mjs';

const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));
const words = (n, word = 'word') => Array.from({ length: n }, () => word).join(' ');

function wiki(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'forge-reading-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'raw', 'tickets', 'MFD-5');
  const put = (name, text) => {
    const file = path.join(dir, ...name.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  const readme = ({ state = 'needs-me', phase = 'start', next = 'Approve the scope', card = true, workflow = 'full-v2' } = {}) => put('README.md', [
    '---', 'type: ticket', 'key: MFD-5', 'title: Doc import error telemetry', `workflow: ${workflow}`, `phase: ${phase}`, `state: ${state}`,
    `next: ${next}`, 'waiting_on: ""', 'changes: []', 'people: []', 'gates:',
    '  - { name: Scoped?, doc: scope.md, need: required, status: in-review }', 'updated: 2026-10-01', '---',
    '# MFD-5', '', '> Doc import error telemetry', '',
    ...(card ? ['## 📍 Now', '', '- **State:** 🟡 needs-me', '- **Phase:** start', '- **Next:** Approve the scope', '- **Waiting on:** you', ''] : []),
    '## Notes', '',
  ].join('\n'));
  const ticket = () => parseTicket(readFileSync(path.join(dir, 'README.md'), 'utf8'));
  return { root, dir, put, readme, ticket };
}

const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

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

test('reading levels are cumulative and report each level over its budget', () => {
  const doc = ['## ⚡ 1 min', words(140), '## ☕ 5 min', words(1000), '## 📖 10 min', words(1200), '## 📂 Appendix', words(5000)].join('\n');
  const reading = readingLevels(doc);
  assert.deepEqual(reading.levels.map((level) => [level.key, level.words, level.cumulative, level.over]),
    [['1', 140, 140, false], ['5', 1000, 1140, false], ['10', 1200, 2340, true]]);
  assert.equal(reading.ordered, true);
  assert.equal(quickCard(doc), words(140));
  assert.equal(readingLevels(['## ☕ 5 min', 'x', '## ⚡ 1 min', 'y'].join('\n')).ordered, false);
  assert.equal(readingLevels(['## 📂 Appendix', 'x', '## ⚡ 1 min', 'y'].join('\n')).ordered, false);
  assert.equal(readingLevels('## Context\nNo levels').quick, null);
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
  assert.throws(() => saveSnapshot(w.dir, w.ticket(), 'Scoped?'), /scope\.md does not exist yet/);
  w.put('scope.md', ['---', 'title: Scope', '---', '## ⚡ 1 min', 'Add telemetry to the import.', '## ☕ 5 min', 'Details.', ''].join('\n'));
  const first = diffGate(w.dir, w.ticket(), 'Scoped?');
  assert.equal(first.snapshot, null);
  assert.equal(renderDiff(first), '⚡ scope.md (first review):\nAdd telemetry to the import.');
  assert.deepEqual(saveSnapshot(w.dir, w.ticket(), 'Scoped?'), { gate: 'Scoped?', doc: 'scope.md', snapshot: 'approvals/snapshots/scoped-1.md', n: 1, written: true });
  assert.equal(saveSnapshot(w.dir, w.ticket(), 'Scoped?').written, false, 'An unchanged doc keeps the latest snapshot.');
  assert.match(renderDiff(diffGate(w.dir, w.ticket(), 'Scoped?')), /has not changed since your last review \(approvals\/snapshots\/scoped-1\.md\)/);
  w.put('scope.md', ['---', 'title: Scope', '---', '## ⚡ 1 min', 'Add telemetry and an alert to the import.', '## ☕ 5 min', 'Details.', ''].join('\n'));
  const text = renderDiff(diffGate(w.dir, w.ticket(), 'Scoped?'));
  assert.match(text, /^🔀 Changed since your last review \(scope\.md vs approvals\/snapshots\/scoped-1\.md\):/);
  assert.match(text, /- ⚡ 1 min: changed \(\+1 \/ -1 lines\)/);
  assert.match(text, /\+ Add telemetry and an alert to the import\./);
  assert.ok(!text.includes('☕ 5 min'), 'Unchanged sections are not shown.');
  assert.equal(saveSnapshot(w.dir, w.ticket(), 'Scoped?').snapshot, 'approvals/snapshots/scoped-2.md');
});

test('lint warns about a stale or missing Now card and about reading levels, for full-v2 tickets only', (t) => {
  const w = wiki(t);
  w.readme({ state: 'active', next: 'Investigate the parser' });
  w.put('scope.md', ['## ☕ 5 min', words(10), '## ⚡ 1 min', words(10), ''].join('\n'));
  w.put('plan.draft.md', ['## ⚡ 1 min', words(151), ''].join('\n'));
  w.put('review.md', ['## Summary', 'No levels.', ''].join('\n'));
  const codes = (report) => report.findings.filter((item) => item.severity === 'warning').map((item) => `${path.basename(item.file)}:${item.code}`).sort();
  const report = lint({ wikiPath: w.root, repoPath: cwd });
  assert.deepEqual(codes(report), ['README.md:now-card-stale', 'plan.draft.md:reading-over-budget', 'review.md:reading-quick-missing', 'scope.md:reading-order']);
  const stale = report.findings.find((item) => item.code === 'now-card-stale');
  assert.match(stale.message, /State should name active; Next should match the frontmatter next/);
  assert.ok(!/Phase should/.test(stale.message));
  assert.equal(stale.line, 20);
  assert.ok(report.findings.every((item) => !['now-card-stale', 'reading-order', 'reading-over-budget', 'reading-quick-missing'].includes(item.code) || item.severity === 'warning'));

  w.readme({ card: false });
  assert.ok(codes(lint({ wikiPath: w.root, repoPath: cwd })).includes('README.md:now-card-missing'));
  w.readme();
  assert.ok(!codes(lint({ wikiPath: w.root, repoPath: cwd })).some((item) => item.startsWith('README.md:now-card')), 'A matching card gives no warning.');
});

test('the snapshot and diff commands print text or JSON and refuse bad arguments', (t) => {
  const w = wiki(t);
  w.readme();
  w.put('scope.md', ['## ⚡ 1 min', 'Card text.', ''].join('\n'));
  const base = ['--cwd', cwd, '--wiki', w.root];
  const diff = run('diff', 'mfd-5', 'scoped', ...base);
  assert.equal(diff.status, 0, diff.stderr);
  assert.equal(diff.stdout.trim(), '⚡ scope.md (first review):\nCard text.');
  const saved = run('snapshot', 'MFD-5', 'Scoped?', '--json', ...base);
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(JSON.parse(saved.stdout).snapshot, 'approvals/snapshots/scoped-1.md');
  assert.ok(existsSync(path.join(w.dir, 'approvals', 'snapshots', 'scoped-1.md')));
  const again = run('snapshot', 'MFD-5', 'Scoped?', ...base);
  assert.equal(again.stdout.trim(), 'Scoped? unchanged: approvals/snapshots/scoped-1.md');
  const json = JSON.parse(run('diff', 'MFD-5', 'Scoped?', '--json', ...base).stdout);
  assert.equal(json.changed, false);
  assert.equal(json.card, 'Card text.');
  const bad = run('diff', 'MFD-5', ...base);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Usage: forge\.mjs diff <key> <gate>/);
  const unknown = run('snapshot', 'MFD-5', 'Shipped', ...base);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown gate: Shipped/);
});
