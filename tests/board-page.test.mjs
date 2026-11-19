// The board page, the links between the pages, and the design system that the pages share.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildBoard } from '../plugins/forge/scripts/lib/board.mjs';
import { BOARD_SCRIPT, renderBoardPage } from '../plugins/forge/scripts/lib/board-page.mjs';
import { buildCanvas, renderCanvas } from '../plugins/forge/scripts/lib/canvas.mjs';
import { CANVAS_SCRIPT, CANVAS_STYLE } from '../plugins/forge/scripts/lib/canvas-page.mjs';
import { STATES } from '../plugins/forge/scripts/lib/ticket.mjs';
import { UI_SCRIPT, UI_STYLE, buildNav } from '../plugins/forge/scripts/lib/ui.mjs';
import { writeViews } from '../plugins/forge/scripts/lib/views.mjs';

const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));
const TOKEN = 'a'.repeat(32);
const TODAY = '2026-11-17';

function wiki(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'forge-page-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, text) => {
    const file = path.join(root, ...name.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  const ticket = (key, { state = 'active', phase = 'plan', updated = '2026-11-16', title = `Title of ${key}`, short = '', workflow = 'full-v3', gates = [], people = [], extra = [] } = {}) => put(`raw/tickets/${key.toLowerCase()}/README.md`, [
    '---', 'type: ticket', `key: ${key}`, `title: ${JSON.stringify(title)}`, ...(short ? [`short: ${short}`] : []),
    `workflow: ${workflow}`, `phase: ${phase}`, `state: ${state}`, `next: Next step for ${key}`, 'waiting_on: ""',
    'changes: []', ...(people.length ? ['people:', ...people] : ['people: []']), 'gates:', ...gates, ...extra, `updated: ${updated}`, '---', `# ${key}`, '',
  ].join('\n'));
  return { root, put, ticket };
}

// Four tickets: one waits for the user at Planned?, one is blocked and old, one is active, and one is done.
function fill(w) {
  w.ticket('APP-9', { state: 'needs-me', short: 'Fix outbox retry', gates: [
    '  - { name: Scoped?, doc: story.md, need: required, status: approved, date: 2026-11-10 }',
    '  - { name: Planned?, doc: plan.md, need: required, status: in-review }',
  ], extra: ['worktree: /code/app.worktrees/APP-9'] });
  w.put('raw/tickets/app-9/plan.md', '---\ntype: plan\n---\n# Plan APP-9\n\nCause: the wrong key.\n\n## Steps\n\n1. Read the new key\n');
  w.ticket('APP-10', { state: 'blocked', updated: '2026-11-03', title: 'A </script><script>alert(1)</script> "title" & more', people: [
    '  - { name: Ana, role: reviewer, status: waiting, since: 2026-11-05, ask: "Log access" }',
  ] });
  w.ticket('APP-11', { state: 'active', short: 'Port the grid' });
  w.ticket('APP-2', { state: 'done', phase: 'closed', short: 'Old fix' });
  w.put('raw/sync/APP-11.md', '---\nchecked: 2026-11-17T09:00\npr: "#12 open"\nci: red\ntracker: In Progress\n---\n');
}

test('the design system gives each page the same tokens, both themes, and a script that sits in the page', () => {
  for (const token of ['--bg', '--panel', '--card', '--rail', '--ink', '--muted', '--faint', '--line', '--accent', '--amber', '--green', '--red', '--violet',
    '--t-xs', '--t-md', '--t-2xl', '--s-1', '--s-7', '--r-1', '--r-pill', '--sh-1', '--sh-2', '--font', '--mono']) {
    assert.ok(UI_STYLE.includes(`${token}:`), token);
  }
  assert.match(UI_STYLE, /@media \(prefers-color-scheme: dark\) \{ :root:not\(\[data-theme="light"\]\) \{ --bg:/, 'the system setting gives the dark theme');
  assert.match(UI_STYLE, /:root\[data-theme="dark"\] \{ color-scheme: dark; --bg:/, 'the user can select the dark theme');
  for (const state of STATES) assert.ok(UI_STYLE.includes(`.st-${state} { --st:`), `state color: ${state}`);
  assert.ok(CANVAS_STYLE.startsWith(UI_STYLE), 'the canvas uses the tokens and the components of the design system');
  // The design document names each token, so a token change is also a change of the document.
  const doc = readFileSync(path.join(cwd, 'docs', 'design-system.md'), 'utf8');
  const root = /:root \{([\s\S]*?)\n\}/.exec(UI_STYLE)[1];
  for (const [, token] of root.matchAll(/(--[a-z0-9-]+):/g)) assert.ok(doc.includes(`\`${token}\``), `docs/design-system.md: ${token}`);

  for (const [name, script] of [['board', BOARD_SCRIPT], ['canvas', CANVAS_SCRIPT]]) {
    assert.ok(script.includes(UI_SCRIPT), `${name}: the shared functions`);
    assert.doesNotThrow(() => new Function(script), name);
    assert.ok(!script.includes('\r') && !script.includes('`'), name);
    assert.doesNotMatch(script, /XMLHttpRequest|WebSocket|sendBeacon|EventSource|https?:\/\/(?!www\.w3\.org\/2000\/svg)/, name);
  }
  // Forge 7.6 adds one request: a page of the live server asks that server for the state of the sessions.
  // Forge 9.1 adds one more: the Resume button asks that server to open a terminal for one session of the session list.
  assert.equal(BOARD_SCRIPT.match(/\bfetch\(/g).length, 3, 'the board page asks only its own server: for the next page, for the live state, and for a Resume');
  for (const script of [BOARD_SCRIPT, CANVAS_SCRIPT]) {
    assert.match(script, /fetch\(data\.resume, \{ method: 'POST', cache: 'no-store', headers: \{ 'Content-Type': 'application\/json', 'X-Forge-Token': data\.token \}, body: JSON\.stringify\(\{ id: button\.getAttribute\('data-resume'\) \}\) \}\)/, 'the request holds only the id of the session');
    assert.match(script, /if \(button\.getAttribute\('data-check'\) === '1'\) \{/, 'a session with no end seen needs a second click');
  }
  for (const script of [BOARD_SCRIPT, CANVAS_SCRIPT]) assert.match(script, /fetch\(data\.live \+ '&v=' \+ live\.v, \{ cache: 'no-store'/);
  assert.doesNotMatch(UI_SCRIPT, /innerHTML|insertAdjacentHTML|document\.write/, 'the text of a session goes into the page as text');
});

test('the links between the pages are relative in a file page and use the server routes in a served page', (t) => {
  const w = wiki(t);
  fill(w);
  const board = buildBoard(w.root, { today: TODAY });
  const fromBoard = buildNav(board);
  assert.equal(fromBoard.board, '');
  assert.deepEqual(fromBoard.tickets.map((item) => [item.key, item.href]), [
    ['APP-9', 'tickets/app-9/canvas.html'], ['APP-10', 'tickets/app-10/canvas.html'], ['APP-11', 'tickets/app-11/canvas.html'], ['APP-2', 'tickets/app-2/canvas.html'],
  ]);
  assert.equal(fromBoard.tickets[0].gate, 'Planned? waits for you');
  assert.equal(fromBoard.file('app-9', 'evidence/a b.md'), 'tickets/app-9/evidence/a%20b.md');

  const fromTicket = buildNav(board, { from: 'app-10', broken: ['app-11'] });
  assert.equal(fromTicket.board, '../../board.html');
  assert.equal(fromTicket.current, 'app-10');
  assert.deepEqual([fromTicket.prev.key, fromTicket.next.key], ['APP-9', 'APP-11'], 'the previous and the next ticket follow the board order');
  assert.equal(fromTicket.prev.href, '../app-9/canvas.html');
  assert.equal(fromTicket.next.href, '../app-11/README.md', 'a ticket without a canvas gets a link to its README');
  assert.equal(buildNav(board, { from: 'app-9' }).prev, null);
  assert.equal(buildNav(board, { from: 'app-2' }).next, null);

  const served = buildNav(board, { from: 'app-10', token: TOKEN, home: 'app-9' });
  assert.equal(served.board, `/board?t=${TOKEN}`);
  assert.equal(served.prev.href, `/?t=${TOKEN}`, 'the ticket of the server stays at the root, where it can send');
  assert.equal(served.next.href, `/ticket/app-11/?t=${TOKEN}`);
  assert.equal(served.file('app-11', 'README.md'), `/ticket/app-11/README.md?t=${TOKEN}`);
});

test('the board page is one self-contained file: the tickets that wait first, one lane for each state, and escaped ticket text', (t) => {
  const w = wiki(t);
  fill(w);
  mkdirSync(path.join(w.root, 'raw', 'tickets', 'empty'));
  const board = buildBoard(w.root, { today: TODAY });
  const html = renderBoardPage(board, { wiki: w.root });
  assert.match(html, /^<!doctype html>/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link\b|<img\b|<iframe\b|@import|url\(\s*["']?https?:/i, 'nothing loads from a network or from another file');
  assert.equal(html.match(/<script\b/g).length, 2, 'one data block and one script');
  assert.equal(html.match(/<\/script>/g).length, 2, 'ticket text cannot close a script block');
  assert.ok(html.includes('A &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt; &quot;title&quot; &amp; more'));
  assert.equal(/<script>([\s\S]*)<\/script>/.exec(html)[1], BOARD_SCRIPT, 'the canvas server names this script by its hash');

  const at = (text) => { const index = html.indexOf(text); assert.ok(index >= 0, text); return index; };
  assert.ok(at('id="lane-needs-me"') < at('id="lane-blocked"') && at('id="lane-blocked"') < at('id="lane-active"') && at('id="lane-active"') < at('<details class="lane st-done" id="lane-done"'));
  assert.ok(!html.includes('id="lane-go"'), 'a state without a ticket has no lane');
  assert.match(html, /<button type="button" class="chip st-go" data-state="go" aria-pressed="false" title="Show only Go \(3\)" disabled>/);
  // A ticket with a gate in review opens at the document of that gate.
  assert.match(html, /<a class="open" href="tickets\/app-9\/canvas\.html#zone-plan" data-nav title="Title of APP-9">Fix outbox retry<\/a>/);
  assert.match(html, /<p class="gate g-in-review"><span class="dots"><i class="d-approved" title="Scoped\? approved"><\/i><i class="d-in-review" title="Planned\? waits for you"><\/i><\/span><span>Planned\? waits for you<\/span><\/p>/);
  assert.match(html, /class="tcard st-blocked stale" id="ticket-app-10"/, 'an open ticket without an update for 7 days has a mark');
  assert.match(html, /<span class="age" title="No update for 14 days">14 days<\/span>/);
  assert.match(html, /<span class="tag">PR #12 open<\/span><span class="tag bad">CI red<\/span><span class="tag">Tracker In Progress<\/span>/);
  assert.match(html, /<span class="tag wait">⏳ Ana, 8 working days<\/span>/);
  assert.match(html, /<li class="trow" id="ticket-app-2" data-state="done"[^>]*><span class="key">APP-2<\/span><a class="open" href="tickets\/app-2\/canvas\.html"/);
  assert.match(html, /<section class="lane plain" id="waits"><h2>People waits <small>more than 3 working days<\/small><\/h2>/);
  assert.match(html, /<section class="lane plain" id="errors"><h2>Read errors <span class="count">1<\/span><\/h2><ul class="errors"><li><code>empty<\/code> README\.md is missing\.<\/li>/);
  // The editor links are for VS Code. The file mode keeps each link relative.
  assert.ok(html.includes(`href="vscode://file${path.join(w.root, 'raw', 'tickets', 'app-9', 'README.md').replaceAll('\\', '/').replace(/^(?!\/)/, '/')}"`));
  assert.match(html, /<a href="vscode:\/\/file\/code\/app\.worktrees\/APP-9" title="\/code\/app\.worktrees\/APP-9">Worktree<\/a>/);
  const plain = renderBoardPage(board, { links: 'file', wiki: w.root });
  assert.match(plain, /<a href="tickets\/app-9\/README\.md">README<\/a>/);
  assert.doesNotMatch(plain, /vscode:|Worktree/);
  assert.throws(() => renderBoardPage(board, { links: 'web' }), /Unknown link mode/);
  // The switcher has each ticket in board order, and the page has the keys.
  assert.ok(at('<dialog id="switcher"') < at('<dialog id="help"'));
  assert.match(html, /<li class="group">🟡 Needs me<\/li><li><a href="tickets\/app-9\/canvas\.html" data-nav data-text="app-9 fix outbox retry needs me plan planned\? waits for you">/);
  assert.equal(renderBoardPage(buildBoard(w.root, { today: TODAY }), { wiki: w.root }), html, 'the same input gives the same bytes');

  const served = renderBoardPage(board, { wiki: w.root, serve: { token: TOKEN } });
  assert.match(served, new RegExp(`"token":"${TOKEN}"`));
  assert.match(served, new RegExp(`href="/ticket/app-9/\\?t=${TOKEN}#zone-plan"`));
  assert.doesNotMatch(html, /"token"/);
  assert.throws(() => renderBoardPage(board, { serve: { token: 'x' } }), /canvas token/);
});

test('a board without a waiting ticket says so, and an empty wiki gives an empty board page', (t) => {
  const w = wiki(t);
  const empty = renderBoardPage(buildBoard(w.root, { today: TODAY }));
  assert.match(empty, /No tickets yet\./);
  assert.doesNotMatch(empty, /id="lane-needs-me"/);
  w.ticket('APP-1', { state: 'go' });
  const calm = renderBoardPage(buildBoard(w.root, { today: TODAY }));
  assert.match(calm, /<section class="lane st-needs-me" id="lane-needs-me" data-state="needs-me">.*<p class="empty">No ticket waits for you\.<\/p><\/section>/);
});

test('the canvas with the links has the board link, the switcher, and the previous and the next ticket', (t) => {
  const w = wiki(t);
  fill(w);
  const board = buildBoard(w.root, { today: TODAY });
  const model = buildCanvas(path.join(w.root, 'raw', 'tickets', 'app-10'));
  const alone = renderCanvas(model);
  assert.doesNotMatch(alone, /<dialog id="switcher"|id="switch-open"|<a [^>]*data-nav|"nav":/, 'a page without the links stands alone');
  assert.match(alone, /<strong class="key">APP-10<\/strong>/);
  const html = renderCanvas(model, { nav: buildNav(board, { from: 'app-10' }) });
  assert.match(html, /<a class="quiet" href="\.\.\/\.\.\/board\.html" data-nav title="The board of all tickets \(b\)">Board<\/a>/);
  assert.match(html, /<button type="button" class="crumb" id="switch-open" aria-haspopup="dialog" title="Go to a ticket \(t\)"><span class="key">APP-10<\/span><\/button>/);
  assert.match(html, /<a class="quiet icon" href="\.\.\/app-9\/canvas\.html" data-nav rel="prev" title="Previous ticket: APP-9 \(\[\)"/);
  assert.match(html, /<a class="quiet icon" href="\.\.\/app-11\/canvas\.html" data-nav rel="next" title="Next ticket: APP-11 \(\]\)"/);
  assert.match(html, /<a href="\.\.\/app-10\/canvas\.html" data-nav data-text="[^"]*" aria-current="page">/);
  // Forge 8.1 adds the link to the wiki page (tests/wiki-page.test.mjs).
  assert.match(html, /"nav":\{"board":"\.\.\/\.\.\/board\.html","wiki":"\.\.\/\.\.\/wiki\.html","prev":"\.\.\/app-9\/canvas\.html","next":"\.\.\/app-11\/canvas\.html"\}/);
  assert.match(html, /<span class="pill st-blocked"><span aria-hidden="true">🔴<\/span> Blocked<\/span>/);
  assert.equal(html.match(/<script\b/g).length, 2);
  // A served page of another ticket names the ticket of the server, and then it cannot send.
  const other = renderCanvas(model, { serve: { token: TOKEN, home: 'APP-9' } });
  assert.match(other, /"home":"APP-9"/);
  assert.doesNotMatch(renderCanvas(model, { serve: { token: TOKEN, home: 'APP-10' } }), /"home"/);
});

test('writeViews writes the board page and the canvas of each ticket, and it keeps a page that did not change', (t) => {
  const w = wiki(t);
  fill(w);
  const canvas = (key) => path.join(w.root, 'raw', 'tickets', key, 'canvas.html');
  const dry = writeViews(w.root, { today: TODAY, dryRun: true });
  assert.equal(dry.page.written, false);
  assert.ok(!existsSync(dry.page.file) && !existsSync(canvas('app-9')), 'a dry run writes no page');

  const first = writeViews(w.root, { today: TODAY, now: new Date('2026-11-17T08:00:00Z') });
  assert.equal(first.page.file, path.join(w.root, 'raw', 'board.html'));
  assert.equal(first.page.written, true);
  assert.deepEqual(first.canvases.written.sort(), ['app-10', 'app-11', 'app-2', 'app-9']);
  assert.match(readFileSync(canvas('app-9'), 'utf8'), /href="\.\.\/\.\.\/board\.html"/);
  // Only the time is new: no page is written again, so an open browser tab does not load again.
  const again = writeViews(w.root, { today: TODAY, now: new Date('2026-11-17T09:30:00Z') });
  assert.equal(again.page.written, false);
  assert.deepEqual(again.canvases.written, []);
  assert.match(readFileSync(canvas('app-9'), 'utf8'), /Generated 2026-11-17 08:00 UTC/);
  // A changed ticket changes its canvas, and its new state changes the links on each other page.
  w.put('raw/tickets/app-9/plan.md', '---\ntype: plan\n---\n# Plan APP-9\n\nCause: the old key.\n');
  assert.deepEqual(writeViews(w.root, { today: TODAY, now: new Date('2026-11-17T10:00:00Z') }).canvases.written, ['app-9']);

  // The canvas command: its own ticket always, and another ticket only when it has no canvas.
  rmSync(canvas('app-11'));
  const focused = writeViews(w.root, { today: TODAY, focus: 'app-9', all: false, now: new Date('2026-11-17T11:00:00Z') });
  assert.deepEqual(focused.canvases.written.sort(), ['app-11', 'app-9']);
  assert.equal(focused.focus.key, 'APP-9');
  assert.match(readFileSync(canvas('app-9'), 'utf8'), /Generated 2026-11-17 11:00 UTC/);

  // A ticket that cannot give a canvas does not stop the other pages. Its links go to its README.
  const outside = path.join(w.root, 'outside.md');
  writeFileSync(outside, '# Outside\n');
  try { symlinkSync(outside, path.join(w.root, 'raw', 'tickets', 'app-11', 'map.md')); } catch { t.skip('This platform cannot create a file link.'); return; }
  const broken = writeViews(w.root, { today: TODAY });
  assert.deepEqual(broken.canvases.failed.map((item) => item.folder), ['app-11']);
  assert.match(broken.canvases.failed[0].message, /map\.md must be a regular file/);
  assert.match(readFileSync(broken.page.file, 'utf8'), /<a class="open" href="tickets\/app-11\/README\.md" data-nav/);
  assert.throws(() => writeViews(w.root, { today: TODAY, focus: 'app-11', all: false }), /map\.md must be a regular file/, 'the canvas command reports the error of its own ticket');
});

test('forge.mjs board writes the pages, and forge.mjs canvas writes the board page and each missing canvas', (t) => {
  const w = wiki(t);
  fill(w);
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, '--cwd', cwd, '--wiki', w.root], { encoding: 'utf8' });
  const one = run('canvas', 'APP-10');
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, /APP-10: wrote .*canvas\.html\n {2}open {2}file:\/\/\S+canvas\.html\n {2}board file:\/\/\S+board\.html\n {2}wiki {2}file:\/\/\S+wiki\.html\n/);
  for (const key of ['app-9', 'app-10', 'app-11', 'app-2']) assert.ok(existsSync(path.join(w.root, 'raw', 'tickets', key, 'canvas.html')), key);
  assert.ok(existsSync(path.join(w.root, 'raw', 'board.html')));

  rmSync(path.join(w.root, 'raw', 'board.html'));
  const json = run('board', '--json', '--today', TODAY);
  assert.equal(json.status, 0, json.stderr);
  const report = JSON.parse(json.stdout);
  assert.equal(report.page.file, path.join(w.root, 'raw', 'board.html'));
  assert.match(report.page.url, /^file:\/\/.*board\.html$/);
  assert.equal(report.page.written, true);
  assert.deepEqual(report.page.failed, []);
  assert.deepEqual(report.groups[0].tickets[0].gates, [{ name: 'Scoped?', status: 'approved', doc: 'story.md' }, { name: 'Planned?', status: 'in-review', doc: 'plan.md' }]);
  const human = run('board', '--today', TODAY, '--links', 'file');
  assert.match(human.stdout, /board\.md\n {2}open {2}file:\/\/\S+board\.html\n {2}wiki {2}file:\/\/\S+wiki\.html\n$/);
  assert.doesNotMatch(readFileSync(path.join(w.root, 'raw', 'board.html'), 'utf8'), /vscode:/);
  const bad = run('board', '--links', 'web');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Usage: forge\.mjs board/);
});
