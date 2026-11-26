// The board page, the links between the pages, and the design system that the pages share.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildBoard } from '../plugins/forge/scripts/lib/board.mjs';
import { BOARD_SCRIPT, renderBoardPage } from '../plugins/forge/scripts/lib/board-page.mjs';
import { STATES } from '../plugins/forge/scripts/lib/ticket.mjs';
import { UI_SCRIPT, UI_STYLE, buildNav } from '../plugins/forge/scripts/lib/ui.mjs';
import { writeViews } from '../plugins/forge/scripts/lib/views.mjs';

const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));
const TOKEN = 'a'.repeat(32);
const TODAY = '2026-11-17';
// The editor link of a file of a ticket folder in a wiki (a page of the editor mode).
const editor = (root, folder, name) => `vscode://file${path.join(root, 'raw', 'tickets', folder, name).replaceAll('\\', '/').replace(/^(?!\/)/, '/')}`;

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
    '--t-xs', '--t-md', '--t-2xl', '--s-1', '--s-7', '--px', '--ember', '--steel', '--shade', '--glow', '--sh-1', '--sh-2', '--font', '--mono']) {
    // Forge 9.2: the corners are square, so the radius tokens are gone, and the pixel tokens are new.
    assert.ok(UI_STYLE.includes(`${token}:`), token);
  }
  assert.match(UI_STYLE, /@media \(prefers-color-scheme: dark\) \{ :root:not\(\[data-theme="light"\]\) \{ --bg:/, 'the system setting gives the dark theme');
  assert.match(UI_STYLE, /:root\[data-theme="dark"\] \{ color-scheme: dark; --bg:/, 'the user can select the dark theme');
  for (const state of STATES) assert.ok(UI_STYLE.includes(`.st-${state} { --st:`), `state color: ${state}`);
  // The design document names each token, so a token change is also a change of the document.
  const doc = readFileSync(path.join(cwd, 'docs', 'design-system.md'), 'utf8');
  const root = /:root \{([\s\S]*?)\n\}/.exec(UI_STYLE)[1];
  for (const [, token] of root.matchAll(/(--[a-z0-9-]+):/g)) assert.ok(doc.includes(`\`${token}\``), `docs/design-system.md: ${token}`);

  for (const [name, script] of [['board', BOARD_SCRIPT]]) {
    assert.ok(script.includes(UI_SCRIPT), `${name}: the shared functions`);
    assert.doesNotThrow(() => new Function(script), name);
    assert.ok(!script.includes('\r') && !script.includes('`'), name);
    assert.doesNotMatch(script, /XMLHttpRequest|WebSocket|sendBeacon|EventSource|https?:\/\/(?!www\.w3\.org\/2000\/svg)/, name);
  }
  // Forge 7.6 adds one request: a page of the live server asks that server for the state of the sessions.
  // Forge 9.1 adds one more: the Resume button asks that server to open a terminal for one session of the session list.
  assert.equal(BOARD_SCRIPT.match(/\bfetch\(/g).length, 3, 'the board page asks only its own server: for the next page, for the live state, and for a Resume');
  for (const script of [BOARD_SCRIPT]) {
    assert.match(script, /fetch\(data\.resume, \{ method: 'POST', cache: 'no-store', headers: \{ 'Content-Type': 'application\/json', 'X-Forge-Token': data\.token \}, body: JSON\.stringify\(\{ id: button\.getAttribute\('data-resume'\) \}\) \}\)/, 'the request holds only the id of the session');
    assert.match(script, /if \(button\.getAttribute\('data-check'\) === '1'\) \{/, 'a session with no end seen needs a second click');
  }
  for (const script of [BOARD_SCRIPT]) assert.match(script, /fetch\(data\.live \+ '&v=' \+ live\.v, \{ cache: 'no-store'/);
  assert.doesNotMatch(UI_SCRIPT, /innerHTML|insertAdjacentHTML|document\.write/, 'the text of a session goes into the page as text');
});

test('the links between the pages are relative in a file page and use the server routes in a served page', (t) => {
  const w = wiki(t);
  fill(w);
  const board = buildBoard(w.root, { today: TODAY });
  const fromBoard = buildNav(board);
  assert.deepEqual([fromBoard.board, fromBoard.wiki], ['', 'wiki.html']);
  assert.deepEqual(fromBoard.tickets.map((item) => [item.key, item.href]), [
    ['APP-9', 'tickets/app-9/README.md'], ['APP-10', 'tickets/app-10/README.md'], ['APP-11', 'tickets/app-11/README.md'], ['APP-2', 'tickets/app-2/README.md'],
  ]);
  assert.equal(fromBoard.tickets[0].gate, 'Planned? needs you'); // Forge 9.2: the one word for a gate in review is "needs you"
  assert.equal(fromBoard.file('app-9', 'evidence/a b.md'), 'tickets/app-9/evidence/a%20b.md');
  assert.deepEqual(Object.keys(fromBoard).sort(), ['board', 'closed', 'file', 'tickets', 'wiki'], 'the links have no previous and next ticket, and no page of a ticket');

  const fromWiki = buildNav(board, { from: 'wiki' });
  assert.deepEqual([fromWiki.board, fromWiki.wiki], ['board.html', '']);

  const served = buildNav(board, { token: TOKEN });
  assert.deepEqual([served.board, served.wiki], ['', `/wiki?t=${TOKEN}`]);
  assert.equal(served.tickets[0].href, `/ticket/app-9/README.md?t=${TOKEN}`);
  assert.equal(served.file('app-11', 'plan.md'), `/ticket/app-11/plan.md?t=${TOKEN}`);
  assert.equal(buildNav(board, { from: 'wiki', token: TOKEN }).board, `/board?t=${TOKEN}`);
});

test('the board page is one self-contained file: the tickets that wait first, one lane for each state, and escaped ticket text', (t) => {
  const w = wiki(t);
  fill(w);
  mkdirSync(path.join(w.root, 'raw', 'tickets', 'empty'));
  const board = buildBoard(w.root, { today: TODAY });
  const html = renderBoardPage(board, { wiki: w.root });
  assert.match(html, /^<!doctype html>/);
  assert.doesNotMatch(html, /<script[^>]+src=|<img\b|<iframe\b|@import|url\(\s*["']?https?:/i, 'nothing loads from a network or from another file');
  // Forge 9.2: the one <link> is the icon of the tab. Its address is data (no file and no network), so the old ban on a link holds for any other link.
  assert.equal(html.match(/<link\b/g).length, 1, 'one link');
  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,[^"]+">/);
  assert.equal(html.match(/<script\b/g).length, 2, 'one data block and one script');
  assert.equal(html.match(/<\/script>/g).length, 2, 'ticket text cannot close a script block');
  assert.ok(html.includes('A &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt; &quot;title&quot; &amp; more'));
  assert.equal(/<script>([\s\S]*)<\/script>/.exec(html)[1], BOARD_SCRIPT, 'the live server names this script by its hash');

  const at = (text) => { const index = html.indexOf(text); assert.ok(index >= 0, text); return index; };
  assert.ok(at('id="lane-needs-me"') < at('id="lane-blocked"') && at('id="lane-blocked"') < at('id="lane-active"') && at('id="lane-active"') < at('<details class="frame sunk lane st-done" id="lane-done"'));
  assert.ok(!html.includes('id="lane-go"'), 'a state without a ticket has no lane');
  // Forge 9.2: the chip is the kit chip (chipHtml): its emoji, its page label, its number, and its attributes.
  assert.match(html, /<button type="button" class="chip st-go" data-state="go" title="Show only Go \(3\)" aria-pressed="false" disabled><span aria-hidden="true">🟢<\/span> Go <b>0<\/b><\/button>/);
  assert.match(html, /<button type="button" class="chip st-needs-me" data-state="needs-me" title="Show only Needs you \(1\)" aria-pressed="false"><span aria-hidden="true">🟡<\/span> Needs you <b>1<\/b><\/button>/);
  // A ticket with a gate in review opens at the document of that gate: an editor link has no data-nav.
  assert.ok(html.includes(`<a class="open" href="${editor(w.root, 'app-9', 'plan.md')}" title="Title of APP-9">Fix outbox retry</a>`));
  // Forge 9.2: the gate row is the kit ingots (gatesHtml) with the words of the open gate. It has the key of the ticket and of each gate for the spark script.
  assert.match(html, /<p class="tline"><span class="gates" data-gates="app-9"><span class="ingots" role="img" aria-label="Gates: Scoped\? approved, Planned\? needs you"><span class="ingot ig-approved" data-gate="Scoped\?" data-status="approved" title="Scoped\? approved"><\/span><span class="ig-line"><\/span><span class="ingot ig-in-review" data-gate="Planned\?" data-status="in-review" title="Planned\? needs you"><\/span><\/span><span class="gate-words">Planned\? needs you<\/span><\/span><\/p>/);
  // The card is the kit frame with the edge of its state.
  assert.match(html, /<article class="frame edge st-needs-me tcard" id="ticket-app-9"/);
  assert.match(html, /<article class="frame edge st-blocked tcard stale" id="ticket-app-10"/, 'an open ticket without an update for 7 days has a mark');
  assert.match(html, /<span class="age" title="No update for 14 days">14 days<\/span>/);
  // Forge 9.2: the tags are the kit tags, and the color of a tag is a tg-* class.
  assert.match(html, /<span class="tag">PR #12 open<\/span><span class="tag tg-bad">CI red<\/span><span class="tag">Tracker In Progress<\/span>/);
  assert.match(html, /<span class="tag tg-wait">⏳ Ana, 8 working days<\/span>/);
  assert.match(html, /<p class="tline tclamp"><span class="eyebrow">Next<\/span> /);
  assert.ok(html.includes(`<a class="open" href="${editor(w.root, 'app-2', 'README.md')}" title="Title of APP-2">Old fix</a><span class="age">`));
  // Forge 9.2: a section name that is not a state is in pixel letters (the real text is in a .sr span), in a sunk frame.
  assert.match(html, /<section class="frame sunk bsec" id="waits"><h2 class="bhead"><span class="pxt pxt-3" style="--n:68"><svg [^>]*><path d="[^"]+"\/><\/svg><span class="sr">People waits<\/span><\/span><small>more than 3 working days<\/small><\/h2><table>/);
  assert.match(html, /<section class="frame sunk bsec" id="errors"><h2 class="bhead"><span class="pxt pxt-3" style="--n:62"><svg [^>]*><path d="[^"]+"\/><\/svg><span class="sr">Read errors<\/span><\/span><span class="count">1<\/span><\/h2><ul class="errors"><li><code>empty<\/code> README\.md is missing\.<\/li>/);
  // The foot is the kit foot, and it names the ? key. The filter notice is the kit banner.
  assert.ok(html.includes('<p class="hint">Press ? for the keys</p>'));
  // Forge 9.2: the banner starts hidden, so it is not a live region. The sr paragraph after it is the live region with the same words.
  assert.ok(html.includes('<div class="banner bn-info" id="showing" hidden><p><span id="showing-text"></span></p><span class="bn-acts"><button type="button" id="show-all">Show all</button></span></div>'));
  assert.match(html, /<header id="rail"><div class="bar"><h1><span class="brand">.*<span class="sr">Forge board<\/span><\/span><\/span><\/h1>/, 'the bar has one shape, and the title keeps its real text');
  // The editor links are for VS Code. The file mode keeps each link relative.
  assert.ok(html.includes(`href="vscode://file${path.join(w.root, 'raw', 'tickets', 'app-9', 'README.md').replaceAll('\\', '/').replace(/^(?!\/)/, '/')}"`));
  assert.match(html, /<a href="vscode:\/\/file\/code\/app\.worktrees\/APP-9" title="\/code\/app\.worktrees\/APP-9">Worktree<\/a>/);
  const plain = renderBoardPage(board, { links: 'file', wiki: w.root });
  assert.match(plain, /<a href="tickets\/app-9\/README\.md">README<\/a>/);
  assert.doesNotMatch(plain, /vscode:|Worktree/);
  assert.throws(() => renderBoardPage(board, { links: 'web' }), /Unknown link mode/);
  // The switcher has each ticket in board order, and the page has the keys.
  assert.ok(at('<dialog id="switcher"') < at('<dialog id="help"'));
  assert.match(html, /<li class="group">🟡 Needs you<\/li><li><a href="tickets\/app-9\/README\.md" data-nav data-text="app-9 fix outbox retry needs you plan planned\? needs you">/);
  // Forge 9.2: the pages say "needs you" for the state needs-me, and "Needs me" stays in raw/board.md.
  assert.equal(renderBoardPage(buildBoard(w.root, { today: TODAY }), { wiki: w.root }), html, 'the same input gives the same bytes');

  const served = renderBoardPage(board, { wiki: w.root, serve: { token: TOKEN } });
  assert.match(served, new RegExp(`"token":"${TOKEN}"`));
  assert.doesNotMatch(served, /\/ticket\/[^"]*\/\?t=|canvas\.html/, 'a ticket has no page of its own on the server');
  assert.match(renderBoardPage(board, { links: 'file', wiki: w.root, serve: { token: TOKEN } }), new RegExp(`<a class="open" href="/ticket/app-9/plan\\.md\\?t=${TOKEN}" data-nav title=`));
  assert.doesNotMatch(html, /"token"/);
  assert.throws(() => renderBoardPage(board, { serve: { token: 'x' } }), /page token/);
});

test('a board without a waiting ticket says so, and an empty wiki gives an empty board page', (t) => {
  const w = wiki(t);
  const empty = renderBoardPage(buildBoard(w.root, { today: TODAY }));
  // Forge 9.2: the first run has the cold anvil, a sentence, and 3 numbered steps (emptyHtml).
  assert.match(empty, /<div class="empty"><svg class="px"[^>]*>.*<\/svg><p>No tickets yet\.<\/p><ol><li>Start an agent session in the repository\.<\/li><li>Give it a work item key, for example APP-123\.<\/li><li>The ticket shows here after its first step\.<\/li><\/ol><\/div>/);
  assert.doesNotMatch(empty, /id="lane-needs-me"/);
  w.ticket('APP-1', { state: 'go' });
  const calm = renderBoardPage(buildBoard(w.root, { today: TODAY }));
  assert.match(calm, /<section class="frame sunk lane st-needs-me" id="lane-needs-me" data-state="needs-me">.*<div class="empty"><svg class="px"[^>]*>.*<\/svg><p>No ticket needs you\.<\/p><\/div><\/section>/);
});

test('a ticket card links to the document of its gate in review, else to its README, in both link modes', (t) => {
  const w = wiki(t);
  fill(w);
  // A gate in review without a doc name gets the document of its gate. A doc name that leaves the ticket folder gets the README.
  w.ticket('APP-12', { state: 'needs-me', gates: ['  - { name: Scoped?, doc: story.md, need: required, status: approved, date: 2026-11-10 }', '  - { name: Planned?, doc: plan.md, need: required, status: approved, date: 2026-11-11 }', '  - { name: Shippable?, need: required, status: in-review }'] });
  w.ticket('APP-13', { state: 'needs-me', gates: ['  - { name: Scoped?, doc: ../../../outside.md, need: required, status: in-review }'] });
  const board = buildBoard(w.root, { today: TODAY });
  const card = (html, folder) => new RegExp(`<article [^>]*id="ticket-${folder}"[\\s\\S]*?<h3><a class="open" href="([^"]+)"( data-nav)? title=`).exec(html);
  const editorMode = renderBoardPage(board, { wiki: w.root });
  for (const [folder, name] of [['app-9', 'plan.md'], ['app-10', 'README.md'], ['app-11', 'README.md'], ['app-12', 'review.md'], ['app-13', 'README.md']]) {
    assert.deepEqual([card(editorMode, folder)[1], card(editorMode, folder)[2] ?? ''], [editor(w.root, folder, name), ''], `${folder}: editor link, no data-nav`);
  }
  const fileMode = renderBoardPage(board, { links: 'file', wiki: w.root });
  for (const [folder, name] of [['app-9', 'plan.md'], ['app-10', 'README.md'], ['app-11', 'README.md'], ['app-12', 'review.md'], ['app-13', 'README.md']]) {
    assert.deepEqual([card(fileMode, folder)[1], card(fileMode, folder)[2]], [`tickets/${folder}/${name}`, ' data-nav'], `${folder}: relative link`);
  }
  // The done row and the strip use the same rule.
  assert.ok(fileMode.includes('<a class="open" href="tickets/app-2/README.md" data-nav title="Title of APP-2">'));
  assert.ok(fileMode.includes('<a class="primary" href="tickets/app-9/plan.md" data-nav aria-label="Open APP-9">Open</a>'));
  assert.doesNotMatch(fileMode + editorMode, /canvas\.html|#zone-/);
});

test('writeViews writes the board page and the wiki page, and it keeps a page that did not change', (t) => {
  const w = wiki(t);
  fill(w);
  const dry = writeViews(w.root, { today: TODAY, dryRun: true });
  assert.equal(dry.page.written, false);
  assert.ok(!existsSync(dry.page.file), 'a dry run writes no page');

  const first = writeViews(w.root, { today: TODAY });
  assert.deepEqual(Object.keys(first).sort(), ['board', 'page', 'wiki'], 'no result for a canvas');
  assert.equal(first.page.file, path.join(w.root, 'raw', 'board.html'));
  assert.equal(first.page.written, true);
  assert.ok(existsSync(path.join(w.root, 'raw', 'wiki.html')));
  for (const key of ['app-9', 'app-10', 'app-11', 'app-2']) assert.ok(!existsSync(path.join(w.root, 'raw', 'tickets', key, 'canvas.html')), `${key}: no canvas page`);
  // The same input writes no page again, so an open browser tab does not load again.
  assert.equal(writeViews(w.root, { today: TODAY }).page.written, false);
  // A new ticket changes the board page.
  w.ticket('APP-12', { state: 'go' });
  assert.equal(writeViews(w.root, { today: TODAY }).page.written, true);
  assert.match(readFileSync(first.page.file, 'utf8'), /id="ticket-app-12"/);
});

test('forge.mjs board writes the board page and the wiki page, and forge.mjs canvas is not a command', (t) => {
  const w = wiki(t);
  fill(w);
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, '--cwd', cwd, '--wiki', w.root], { encoding: 'utf8' });
  const gone = run('canvas', 'APP-10');
  assert.equal(gone.status, 2, 'the usage error');
  assert.match(gone.stderr, /^Usage: node forge\.mjs <where\|/);
  assert.doesNotMatch(gone.stderr, /canvas/);
  assert.ok(!existsSync(path.join(w.root, 'raw', 'tickets', 'app-10', 'canvas.html')));

  const json = run('board', '--json', '--today', TODAY);
  assert.equal(json.status, 0, json.stderr);
  const report = JSON.parse(json.stdout);
  assert.equal(report.page.file, path.join(w.root, 'raw', 'board.html'));
  assert.match(report.page.url, /^file:\/\/.*board\.html$/);
  assert.equal(report.page.written, true);
  assert.deepEqual(Object.keys(report.page).sort(), ['file', 'url', 'wiki', 'written'], 'the report has no canvas count');
  assert.ok(existsSync(path.join(w.root, 'raw', 'wiki.html')));
  assert.deepEqual(report.groups[0].tickets[0].gates, [{ name: 'Scoped?', status: 'approved', doc: 'story.md' }, { name: 'Planned?', status: 'in-review', doc: 'plan.md' }]);
  const human = run('board', '--today', TODAY, '--links', 'file');
  assert.match(human.stdout, /board\.md\n {2}open {2}file:\/\/\S+board\.html\n {2}wiki {2}file:\/\/\S+wiki\.html\n$/);
  const page = readFileSync(path.join(w.root, 'raw', 'board.html'), 'utf8');
  assert.doesNotMatch(page, /vscode:/);
  assert.doesNotMatch(page, /canvas\.html|\/ticket\//, 'the page has no link to a canvas');
  const bad = run('board', '--links', 'web');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Usage: forge\.mjs board/);
});

test('the next strike strip: one banner above the lanes, with the key, the text, and one Open link to the document of the ticket', (t) => {
  const w = wiki(t);
  fill(w);
  const html = renderBoardPage(buildBoard(w.root, { today: TODAY }), { wiki: w.root, links: 'file' });
  // A gate in review: a warn banner, and the link goes to the document of that gate (as the link of the card does).
  assert.ok(html.includes('<div class="banner bn-warn" role="status" id="strike"><p><span class="key">APP-9</span> Planned? needs you. Read plan.md.</p>'
    + '<span class="bn-acts"><a class="primary" href="tickets/app-9/plan.md" data-nav aria-label="Open APP-9">Open</a></span></div>'));
  assert.equal(html.match(/id="strike"/g).length, 1);
  assert.equal(html.match(/class="primary"/g).length, 1, 'one primary link');
  // The strip is above the lanes, and it is not a ticket: the filter and the chips (they read data-text and data-state) do not hide it.
  assert.ok(html.indexOf('id="strike"') > html.indexOf('<main id="lanes">') && html.indexOf('id="strike"') < html.indexOf('id="lane-needs-me"'));
  assert.doesNotMatch(/<div class="banner[^>]*id="strike"[^>]*>/.exec(html)[0], /data-text|data-state/);
  assert.match(BOARD_SCRIPT, /var items = Array\.prototype\.slice\.call\(document\.querySelectorAll\('\.tcard, \.trow'\)\);/, 'the filter reads cards and rows only');
  assert.doesNotMatch(BOARD_SCRIPT, /strike/);
  // The strip is a banner of the kit: blocked is bad, and a ticket that can start is info.
  const blocked = wiki(t);
  blocked.ticket('APP-2', { state: 'blocked', short: 'Order export', extra: [] });
  assert.match(renderBoardPage(buildBoard(blocked.root, { today: TODAY }), { wiki: blocked.root }), /<div class="banner bn-bad" role="status" id="strike"><p><span class="key">APP-2<\/span> Blocked: Next step for APP-2<\/p>/);
  const go = wiki(t);
  go.ticket('APP-3', { state: 'go' });
  assert.match(renderBoardPage(buildBoard(go.root, { today: TODAY }), { wiki: go.root }), /<div class="banner bn-info" role="status" id="strike"><p><span class="key">APP-3<\/span> Can start: Next step for APP-3<\/p>/);
  // No strip without a ticket for it. Text of a ticket is escaped.
  const quiet = wiki(t);
  quiet.ticket('APP-4', { state: 'active' });
  assert.ok(!renderBoardPage(buildBoard(quiet.root, { today: TODAY }), { wiki: quiet.root }).includes('id="strike"'));
  assert.ok(!renderBoardPage(buildBoard(wiki(t).root, { today: TODAY }), { wiki: quiet.root }).includes('id="strike"'), 'an empty board');
  const loud = wiki(t);
  loud.ticket('APP-5', { state: 'needs-me', extra: [] });
  loud.put('raw/tickets/app-5/README.md', readFileSync(path.join(loud.root, 'raw', 'tickets', 'app-5', 'README.md'), 'utf8').replace('Next step for APP-5', 'Reply to <b>Mara</b>'));
  const strip = /<div class="banner[^>]*id="strike".*?<\/div>/.exec(renderBoardPage(buildBoard(loud.root, { today: TODAY }), { wiki: loud.root }))[0];
  assert.ok(strip.includes('Reply to &lt;b&gt;Mara&lt;/b&gt;') && !strip.includes('<b>'));
});
