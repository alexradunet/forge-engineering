import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildBoard, openGate, renderBoard, workdaysSince, writeBoard } from '../plugins/forge/scripts/lib/board.mjs';

const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));

function wiki(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'forge-board-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, text) => {
    const file = path.join(root, ...name.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  const ticket = (key, { state = 'active', phase = 'plan', updated = '2026-10-01', short = '', gates = [], extra = [], people = [] } = {}) => put(`raw/tickets/${key}/README.md`, [
    '---', 'type: ticket', `key: ${key}`, `title: Title of ${key} | with a pipe`, ...(short ? [`short: ${short}`] : []),
    'workflow: full-v2', `phase: ${phase}`, `state: ${state}`, `next: Next step for ${key}`, 'waiting_on: ""',
    'changes: []', ...(people.length ? ['people:', ...people] : ['people: []']), 'gates:', ...gates, ...extra, `updated: ${updated}`, '---', `# ${key}`, '',
  ].join('\n'));
  return { root, put, ticket };
}

test('the board groups tickets by state in a fixed order and sorts keys by number', (t) => {
  const w = wiki(t);
  w.ticket('MFD-10', { state: 'needs-me', short: 'Ten', gates: ['  - { name: Scoped?, doc: scope.md, need: required, status: in-review }'] });
  w.ticket('MFD-9', { state: 'needs-me', short: 'Nine' });
  w.ticket('MFD-1', { state: 'done', phase: 'closed' });
  w.ticket('MFD-2', { state: 'blocked', updated: '2026-10-04' });
  const board = buildBoard(w.root, { today: '2026-10-05' });
  assert.deepEqual(board.groups.map((group) => group.state), ['needs-me', 'blocked', 'go', 'active', 'waiting', 'done']);
  assert.deepEqual(board.groups[0].tickets.map((item) => item.key), ['MFD-9', 'MFD-10']);
  assert.equal(board.groups[0].tickets[1].sessionTitle, 'MFD-10 - 🟡 - Ten');
  assert.deepEqual(board.groups[0].tickets[1].openGate, { name: 'Scoped?', status: 'in-review' });
  assert.equal(board.groups[1].tickets[0].days, 1);
  assert.equal(board.total, 4);
  const text = renderBoard(board);
  assert.ok(text.indexOf('## 🟡 Needs me (2)') < text.indexOf('## 🔴 Blocked (1)'));
  assert.ok(text.indexOf('## 🔴 Blocked (1)') < text.indexOf('## ✅ Done (1)'));
  assert.ok(!text.includes('## 🟢 Go'), 'Empty groups have no section.');
  assert.match(text, /\[MFD-1 - ✅ - Title of MFD-1 \\\| with a pipe\]\(<tickets\/MFD-1\/README\.md>\)/);
  assert.match(text, /🟡 Needs me 2 · 🔴 Blocked 1 · 🟢 Go 0/);
  assert.equal(renderBoard(buildBoard(w.root, { today: '2026-10-05' })), text, 'The same input gives the same bytes.');
});

test('people waits list open tickets with a waiting person after more than 3 working days', (t) => {
  assert.equal(workdaysSince('2026-10-02', '2026-10-05'), 1, 'Friday to Monday is one working day.');
  assert.equal(workdaysSince('2026-09-30', '2026-10-05'), 3);
  assert.equal(workdaysSince('', '2026-10-05'), null);
  const w = wiki(t);
  w.ticket('MFD-1', { people: [
    '  - { name: Ana, role: reviewer, status: waiting, since: 2026-09-29, ask: "Review the plan" }',
    '  - { name: Bo, role: QA, status: waiting, since: 2026-09-30, ask: "Test data" }',
    '  - { name: Cy, role: PO, status: follow-up, since: 2026-09-01, ask: "Scope" }',
  ] });
  w.ticket('MFD-2', { state: 'done', phase: 'closed', people: ['  - { name: Di, role: dev, status: waiting, since: 2026-09-01, ask: "Old" }'] });
  const board = buildBoard(w.root, { today: '2026-10-05' });
  const active = board.groups.find((group) => group.state === 'active').tickets[0];
  assert.deepEqual(active.waits, [{ name: 'Ana', role: 'reviewer', ask: 'Review the plan', since: '2026-09-29', workdays: 4 }]);
  assert.deepEqual(board.groups.find((group) => group.state === 'done').tickets[0].waits, []);
  const text = renderBoard(board);
  assert.match(text, /## ⏳ People waits \(more than 3 working days\)/);
  assert.match(text, /\| MFD-1 \| Ana \| reviewer \| Review the plan \| 2026-09-29 \| 4 \|/);
  assert.ok(!text.includes('| Bo |') && !text.includes('| Di |'));
});

test('the open gate prefers in-review, then blocked, then todo, and ignores recommended gates', () => {
  const gates = (...list) => ({ gates: list.map(([name, status, need = 'required']) => ({ name, status, need })) });
  assert.deepEqual(openGate(gates(['Scoped?', 'approved'], ['Planned?', 'todo'], ['Shippable?', 'in-review'])), { name: 'Shippable?', status: 'in-review' });
  assert.deepEqual(openGate(gates(['Planned?', 'todo'], ['Sendable?', 'blocked'])), { name: 'Sendable?', status: 'blocked' });
  assert.equal(openGate(gates(['Extra?', 'in-review', 'recommended'], ['Scoped?', 'skipped'])), null);
});

test('sync notes add PR, CI, and Jira status; bad notes and bad READMEs are read errors', (t) => {
  const w = wiki(t);
  w.ticket('MFD-3', { state: 'waiting' });
  w.ticket('MFD-4', { state: 'go' });
  w.put('raw/sync/MFD-3.md', '---\nchecked: 2026-10-05T09:00\npr: "#12 open, 1 approval"\nci: green\njira: In Review\n---\nNotes.\n');
  w.put('raw/sync/MFD-4.md', 'no frontmatter\n');
  w.put('raw/tickets/MFD-5/README.md', '---\nkey: MFD-5\n---\n');
  mkdirSync(path.join(w.root, 'raw', 'tickets', 'empty'), { recursive: true });
  const board = buildBoard(w.root, { today: '2026-10-05' });
  const waiting = board.groups.find((group) => group.state === 'waiting').tickets[0];
  assert.deepEqual(waiting.sync, { checked: '2026-10-05T09:00', jira: 'In Review', pr: '#12 open, 1 approval', ci: 'green' });
  assert.match(renderBoard(board), /PR #12 open, 1 approval · CI green · Jira In Review/);
  assert.deepEqual(board.errors.map((error) => error.folder), ['empty', 'MFD-4', 'MFD-5']);
  assert.match(renderBoard(board), /## ⚠️ Read errors/);
});

test('writeBoard writes raw/board.md only when the text changes and never in a dry run', (t) => {
  const w = wiki(t);
  w.ticket('MFD-6');
  const dry = writeBoard(w.root, { today: '2026-10-05', dryRun: true });
  assert.equal(dry.written, false);
  assert.equal(existsSync(dry.file), false);
  assert.equal(writeBoard(w.root, { today: '2026-10-05' }).written, true);
  assert.equal(writeBoard(w.root, { today: '2026-10-05' }).written, false);
  assert.match(readFileSync(dry.file, 'utf8'), /^# 🗂️ Forge board\n/);
  assert.throws(() => buildBoard(w.root, { today: '2026-13-01' }), /Invalid date/);
});

test('an empty wiki gives an empty board', (t) => {
  const w = wiki(t);
  const board = buildBoard(w.root, { today: '2026-10-05' });
  assert.equal(board.total, 0);
  assert.match(renderBoard(board), /No tickets yet\./);
});

test('forge.mjs board prints JSON and writes the board file', (t) => {
  const w = wiki(t);
  w.ticket('MFD-7', { state: 'needs-me' });
  const result = spawnSync(process.execPath, [cli, 'board', '--json', '--today', '2026-10-05', '--cwd', cwd, '--wiki', w.root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.groups[0].tickets[0].key, 'MFD-7');
  assert.equal(report.written, true);
  assert.ok(existsSync(path.join(w.root, 'raw', 'board.md')));
  const human = spawnSync(process.execPath, [cli, 'board', '--dry-run', '--today', '2026-10-05', '--cwd', cwd, '--wiki', w.root], { encoding: 'utf8' });
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /unchanged: .*board\.md/);
  const bad = spawnSync(process.execPath, [cli, 'board', '--today', '--cwd', cwd, '--wiki', w.root], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--today needs a value/);
});
