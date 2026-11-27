import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BOARD_ORDER, buildAllBoards, buildBoard, openGate, renderAllBoards, renderBoard, workdaysSince, writeBoard } from '../plugins/forge/scripts/lib/board.mjs';
import { siblingWikis } from '../plugins/forge/scripts/lib/layout.mjs';

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
  const ticket = (key, { state = 'active', phase = 'plan', updated = '2026-10-01', short = '', gates = [], extra = [], people = [], item = '', changes = [] } = {}) => put(`raw/tickets/${key}/README.md`, [
    '---', 'type: ticket', `key: ${key}`, `title: Title of ${key} | with a pipe`, ...(short ? [`short: ${short}`] : []),
    'workflow: full-v4', `phase: ${phase}`, `state: ${state}`, `next: Next step for ${key}`, 'waiting_on: ""',
    ...(item ? [`item: ${item}`] : []), ...(changes.length ? ['changes:', ...changes] : ['changes: []']), ...(people.length ? ['people:', ...people] : ['people: []']), 'gates:', ...gates, ...extra, `updated: ${updated}`, '---', `# ${key}`, '',
  ].join('\n'));
  return { root, put, ticket };
}

test('the board groups tickets by state in a fixed order and sorts keys by number', (t) => {
  const w = wiki(t);
  w.ticket('APP-10', { state: 'needs-me', short: 'Ten', gates: ['  - { name: Planned?, doc: plan.md, need: required, status: in-review }'] });
  w.ticket('APP-9', { state: 'needs-me', short: 'Nine' });
  w.ticket('APP-1', { state: 'done', phase: 'closed' });
  w.ticket('APP-2', { state: 'blocked', updated: '2026-10-04' });
  const board = buildBoard(w.root, { today: '2026-10-05' });
  assert.deepEqual(board.groups.map((group) => group.state), ['needs-me', 'blocked', 'go', 'active', 'waiting', 'done']);
  assert.deepEqual(board.groups[0].tickets.map((item) => item.key), ['APP-9', 'APP-10']);
  assert.equal(board.groups[0].tickets[1].sessionTitle, 'APP-10 - 🟡 - Ten');
  assert.deepEqual(board.groups[0].tickets[1].openGate, { name: 'Planned?', status: 'in-review' });
  assert.equal(board.groups[1].tickets[0].days, 1);
  assert.equal(board.total, 4);
  const text = renderBoard(board);
  assert.ok(text.indexOf('## 🟡 Needs me (2)') < text.indexOf('## 🔴 Blocked (1)'));
  assert.ok(text.indexOf('## 🔴 Blocked (1)') < text.indexOf('## ✅ Done (1)'));
  assert.ok(!text.includes('## 🟢 Go'), 'Empty groups have no section.');
  assert.match(text, /\[APP-1 - ✅ - Title of APP-1 \\\| with a pipe\]\(<tickets\/APP-1\/README\.md>\)/);
  assert.match(text, /🟡 Needs me 2 · 🔴 Blocked 1 · 🟢 Go 0/);
  assert.equal(renderBoard(buildBoard(w.root, { today: '2026-10-05' })), text, 'The same input gives the same bytes.');
});

test('people waits list open tickets with a waiting person after more than 3 working days', (t) => {
  assert.equal(workdaysSince('2026-10-02', '2026-10-05'), 1, 'Friday to Monday is one working day.');
  assert.equal(workdaysSince('2026-09-30', '2026-10-05'), 3);
  assert.equal(workdaysSince('', '2026-10-05'), null);
  const w = wiki(t);
  w.ticket('APP-1', { people: [
    '  - { name: Ana, role: reviewer, status: waiting, since: 2026-09-29, ask: "Review the plan" }',
    '  - { name: Bo, role: QA, status: waiting, since: 2026-09-30, ask: "Test data" }',
    '  - { name: Cy, role: PO, status: follow-up, since: 2026-09-01, ask: "Scope" }',
  ] });
  w.ticket('APP-2', { state: 'done', phase: 'closed', people: ['  - { name: Di, role: dev, status: waiting, since: 2026-09-01, ask: "Old" }'] });
  const board = buildBoard(w.root, { today: '2026-10-05' });
  const active = board.groups.find((group) => group.state === 'active').tickets[0];
  assert.deepEqual(active.waits, [{ name: 'Ana', role: 'reviewer', ask: 'Review the plan', since: '2026-09-29', workdays: 4 }]);
  assert.deepEqual(board.groups.find((group) => group.state === 'done').tickets[0].waits, []);
  const text = renderBoard(board);
  assert.match(text, /## ⏳ People waits \(more than 3 working days\)/);
  assert.match(text, /\| APP-1 \| Ana \| reviewer \| Review the plan \| 2026-09-29 \| 4 \|/);
  assert.ok(!text.includes('| Bo |') && !text.includes('| Di |'));
});

test('the open gate prefers in-review, then blocked, then todo, and ignores recommended gates', () => {
  const gates = (...list) => ({ gates: list.map(([name, status, need = 'required']) => ({ name, status, need })) });
  assert.deepEqual(openGate(gates(['Planned?', 'approved'], ['Learned?', 'todo'], ['Shippable?', 'in-review'])), { name: 'Shippable?', status: 'in-review' });
  assert.deepEqual(openGate(gates(['Planned?', 'todo'], ['Shippable?', 'blocked'])), { name: 'Shippable?', status: 'blocked' });
  assert.equal(openGate(gates(['Extra?', 'in-review', 'recommended'], ['Planned?', 'skipped'])), null);
});

test('a card has the item link and the changes of the README; a bad README is a read error', (t) => {
  const w = wiki(t);
  w.ticket('APP-3', { state: 'waiting', item: 'https://tracker.example.test/APP-3', changes: ['  - { url: "https://host.example.test/pr/12", state: open, label: PR }'] });
  w.ticket('APP-4', { state: 'go' });
  w.put('raw/tickets/APP-5/README.md', '---\nkey: APP-5\n---\n');
  mkdirSync(path.join(w.root, 'raw', 'tickets', 'empty'), { recursive: true });
  const board = buildBoard(w.root, { today: '2026-10-05' });
  const waiting = board.groups.find((group) => group.state === 'waiting').tickets[0];
  assert.equal(waiting.item, 'https://tracker.example.test/APP-3');
  assert.deepEqual(waiting.changes, [{ url: 'https://host.example.test/pr/12', state: 'open', label: 'PR' }]);
  assert.equal(waiting.sync, undefined, 'The board reads no sync note.');
  assert.match(renderBoard(board), /\| PR open \|/);
  assert.doesNotMatch(renderBoard(board), /Tracker|CI /);
  assert.deepEqual(board.errors.map((error) => error.folder), ['APP-5', 'empty']);
  assert.match(renderBoard(board), /## ⚠️ Read errors/);
});

test('writeBoard writes raw/board.md only when the text changes and never in a dry run', (t) => {
  const w = wiki(t);
  w.ticket('APP-6');
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
  w.ticket('APP-7', { state: 'needs-me' });
  const result = spawnSync(process.execPath, [cli, 'board', '--json', '--today', '2026-10-05', '--cwd', cwd, '--wiki', w.root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.groups[0].tickets[0].key, 'APP-7');
  assert.equal(report.written, true);
  assert.ok(existsSync(path.join(w.root, 'raw', 'board.md')));
  const human = spawnSync(process.execPath, [cli, 'board', '--dry-run', '--today', '2026-10-05', '--cwd', cwd, '--wiki', w.root], { encoding: 'utf8' });
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /unchanged: .*board\.md/);
  const bad = spawnSync(process.execPath, [cli, 'board', '--today', '--cwd', cwd, '--wiki', w.root], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--today needs a value/);
});

test('a local ticket shows on the board like each other ticket', (t) => {
  const w = wiki(t);
  w.ticket('L-3', { state: 'needs-me', short: 'Local fix' });
  const board = buildBoard(w.root, { today: '2026-10-05' });
  assert.deepEqual(board.groups.filter((group) => group.tickets.length).map((group) => [group.state, group.tickets.map((item) => item.key)]), [['needs-me', ['L-3']]]);
  assert.equal(board.groups[0].tickets[0].sessionTitle, 'L-3 - 🟡 - Local fix');
  assert.match(renderBoard(board), /\[L-3 - 🟡 - Local fix\]\(<tickets\/L-3\/README\.md>\)/);
});

// Forge folders next to each other: <root>/<name>.forge/wiki with a binding, and the tickets in <name>.forge/raw/tickets.
function forges(t) {
  const root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'forge-board-all-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
  const forge = (name, { bound = true, repoPath = path.join(root, name) } = {}) => {
    const home = path.join(root, `${name}.forge`);
    mkdirSync(path.join(home, 'wiki'), { recursive: true });
    if (bound) put(path.join(home, 'wiki', 'forge', 'repo.json'), JSON.stringify({ repo: { path: repoPath } }));
    const ticket = (key, { state = 'needs-me', worktree = '' } = {}) => put(path.join(home, 'raw', 'tickets', key.toLowerCase(), 'README.md'), [
      '---', 'type: ticket', `key: ${key}`, `title: Title of ${key}`, 'workflow: full-v4', 'phase: plan', `state: ${state}`, `next: Next of ${key}`, 'waiting_on: ""',
      `worktree: "${worktree.replaceAll('\\', '/')}"`, 'changes: []', 'people: []', 'gates:',
      '  - { name: Planned?, doc: plan.md, need: required, status: in-review }', 'updated: 2026-10-01', '---', `# ${key}`, '',
    ].join('\n'));
    return { home, wiki: path.join(home, 'wiki'), ticket };
  };
  return { root, put, forge };
}

test('buildAllBoards lists this repository first, then the siblings by name, and writes no file', (t) => {
  const s = forges(t);
  const zeta = s.forge('zeta');
  const alpha = s.forge('alpha');
  const mine = s.forge('mine');
  zeta.ticket('Z-1');
  alpha.ticket('A-2');
  alpha.ticket('A-1');
  mine.ticket('M-1');
  s.forge('tool', { bound: false }).ticket('T-1'); // a code repository named tool.forge with its own wiki/ and no binding
  const all = buildAllBoards(mine.wiki, { today: '2026-10-05' });
  assert.deepEqual(all.repos.map((row) => [row.repo, row.current]), [['mine', true], ['alpha', false], ['zeta', false]]);
  assert.deepEqual(all.needsMe.map((item) => `${item.repo}:${item.key}`), ['mine:M-1', 'alpha:A-1', 'alpha:A-2', 'zeta:Z-1']);
  assert.deepEqual(all.errors, []);
  assert.equal(all.version, 1);
  for (const forge of [zeta, alpha, mine]) assert.equal(existsSync(path.join(forge.home, 'raw', 'board.md')), false, `no board.md in ${forge.home}`);
  assert.deepEqual(siblingWikis(alpha.wiki).map((wiki) => path.basename(path.dirname(wiki))), ['alpha.forge', 'mine.forge', 'zeta.forge']);
  assert.match(renderAllBoards(all)[0], /^🟡 mine 1 · alpha 2 · zeta 1$/);
});

test('buildAllBoards: a sibling that cannot be read is an error row; --wiki gives only this wiki', (t) => {
  const s = forges(t);
  const mine = s.forge('mine');
  const broken = s.forge('broken');
  mine.ticket('M-1');
  s.put(path.join(broken.home, 'raw', 'tickets'), 'a file, not a folder');
  const all = buildAllBoards(mine.wiki, { today: '2026-10-05' });
  const row = all.repos.find((item) => item.repo === 'broken');
  assert.equal(row.board, null);
  assert.ok(row.error);
  assert.deepEqual(all.errors.map((item) => item.repo), ['broken']);
  assert.equal(all.needsMe.length, 1);
  assert.match(renderAllBoards(all).join('\n'), /read error: /);
  const plain = wiki(t);
  assert.deepEqual(siblingWikis(plain.root), [path.resolve(plain.root)]);
  assert.deepEqual(buildAllBoards(plain.root, { today: '2026-10-05' }).repos.map((item) => item.current), [true]);
});

test('forge.mjs board --all prints the text and the JSON and writes no file', (t) => {
  const s = forges(t);
  const mine = s.forge('mine');
  s.forge('other').ticket('O-1');
  mine.ticket('M-1');
  const run = (...extra) => spawnSync(process.execPath, [cli, 'board', '--all', '--today', '2026-10-05', '--cwd', cwd, '--wiki', mine.wiki, ...extra], { encoding: 'utf8' });
  const text = run();
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^🟡 mine 1 · other 1\n/);
  const json = JSON.parse(run('--json').stdout);
  assert.deepEqual(json.needsMe.map((item) => item.key), ['M-1', 'O-1']);
  assert.equal(existsSync(path.join(mine.home, 'raw', 'board.md')), false);
});

test('each ticket has a resume folder: the worktree, else the bound repository, else <parent>/<name>', (t) => {
  const s = forges(t);
  const repoPath = path.join(s.root, 'elsewhere', 'mine');
  const mine = s.forge('mine', { repoPath });
  const tree = path.join(s.root, 'mine.worktrees', 'M-1-fix');
  mkdirSync(tree, { recursive: true });
  mine.ticket('M-1', { worktree: tree });
  mine.ticket('M-2');
  mine.ticket('M-3', { worktree: path.join(s.root, 'mine.worktrees', 'removed') });
  const folders = Object.fromEntries(buildBoard(mine.wiki, { today: '2026-10-05' }).groups.flatMap((group) => group.tickets).map((item) => [item.key, item.resumeFolder]));
  assert.deepEqual(folders, { 'M-1': tree, 'M-2': path.resolve(repoPath), 'M-3': path.resolve(repoPath) });
  rmSync(path.join(mine.wiki, 'forge', 'repo.json'));
  assert.equal(buildBoard(mine.wiki, { today: '2026-10-05' }).groups.flatMap((group) => group.tickets).find((item) => item.key === 'M-2').resumeFolder, path.join(s.root, 'mine'));
  // The board file does not change: it has no resume folder.
  const written = writeBoard(mine.wiki, { today: '2026-10-05' });
  assert.equal(readFileSync(written.file, 'utf8'), renderBoard(buildBoard(mine.wiki, { today: '2026-10-05' })));
  assert.doesNotMatch(readFileSync(written.file, 'utf8'), /resume|elsewhere/i);
});
