// The wiki page: the model of the canonical pages, the links from a ticket and from the board to the wiki, and the closed tickets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildBoard } from '../plugins/forge/scripts/lib/board.mjs';
import { renderBoardPage } from '../plugins/forge/scripts/lib/board-page.mjs';
import { buildCanvas, markdown, renderCanvas } from '../plugins/forge/scripts/lib/canvas.mjs';
import { UI_SCRIPT, UI_STYLE, buildNav } from '../plugins/forge/scripts/lib/ui.mjs';
import { writeViews } from '../plugins/forge/scripts/lib/views.mjs';
import { WIKI_SCRIPT, WIKI_STYLE, renderWikiPage } from '../plugins/forge/scripts/lib/wiki-page.mjs';
import { buildWiki, linkTargets, pageOf, ticketRefs, wikiLinks } from '../plugins/forge/scripts/lib/wiki.mjs';

const TOKEN = 'a'.repeat(32);
const TODAY = '2026-11-17';
const page = (title, body, { updated = '2026-11-10', status = 'verified', extra = [] } = {}) => ['---', `title: ${JSON.stringify(title)}`, `updated: ${updated}`, `status: ${status}`, ...extra, '---', `# ${title}`, '', body, ''].join('\n');

// A wiki with pages in 3 folders, one closed ticket, one open ticket that names pages, and files that are not pages.
function wiki(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'forge-wiki-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, text) => {
    const file = path.join(root, ...name.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  put('index.md', '---\ntitle: Wiki index\ntype: index\n---\n# Wiki index\n\n- [Build](tooling/build.md): how the build runs\n- [Retry](app/retry.md)\n');
  put('log.md', '---\ntitle: Wiki log\ntype: log\n---\n# Wiki log\n\n## 2026-11-10 create: build\n\n- tooling/build.md\n');
  put('tooling/build.md', page('Build <fast> & "safe"', [
    'The build uses `npm test`. See [the retry page](../app/retry.md#limits) and [a script](<../forge/scripts/x.md>).',
    '', '## Steps', '', '### Details', '', '1. Read [the log](../raw/tickets/app-9/journal.md).', '2. Open https://example.com/docs now.',
    '', '```sh', 'cat [not a link](app/retry.md)', '```',
  ].join('\n'), { extra: ['sources:', '  - https://example.com/build', '  - app/retry.md', '  - scripts/build.mjs:12'] }));
  put('app/retry.md', page('Retry', 'Retries stop after 3 s. </script><script>alert(1)</script>', { status: 'needs-check' }));
  put('app/deep/queue.md', '# Queue of the app\n\nNo frontmatter here. See [retry](../retry.md).\n');
  put('tickets/app-2.md', page('APP-2: Old fix', '- Knowledge: [build](../tooling/build.md).', { updated: '2026-11-12' }));
  put('tickets/app-1.md', page('First ticket', 'No link.', { updated: '2026-10-01' }));
  put('forge/config/tracker.md', '---\ntype: tracker\n---\n# Tracker\n');
  put('archive/tickets/app-2/README.md', '# Old\n');
  put('raw/board.md', '# Board\n');
  put('.git/notes.md', '# Git\n');
  put('tooling/notes.txt', 'not a page\n');
  put('raw/tickets/app-9/README.md', [
    '---', 'type: ticket', 'key: APP-9', 'title: Fix the outbox retry', 'short: Fix outbox retry', 'workflow: full-v3', 'phase: plan', 'state: active',
    'next: Write the plan', 'changes: []', 'people: []', 'gates:', '  - { name: Scoped?, doc: story.md, need: required, status: approved, date: 2026-11-10 }',
    '  - { name: Planned?, doc: plan.md, need: required, status: todo }', 'updated: 2026-11-16', '---', '# APP-9', '',
  ].join('\n'));
  put('raw/tickets/app-9/story.md', [
    '---', 'type: story', '---', '# Story APP-9', '', 'Problem: retries stop. The limits are in [the retry page](../../../app/retry.md).',
    '', '## Scope', '', '- The build steps are in tooling/build.md, and the old fix is `tickets/app-2.md`.', '- Not a page: evidence/run.md and [the plan](plan.md).', '',
  ].join('\n'));
  return { root, put };
}

test('the wiki model has each canonical page, in the order of the folders, with its title, its links, and the pages that use it', (t) => {
  const w = wiki(t);
  const model = buildWiki(w.root, { board: buildBoard(w.root, { today: TODAY }) });
  assert.deepEqual(model.pages.map((item) => item.path), ['index.md', 'log.md', 'app/retry.md', 'app/deep/queue.md', 'tickets/app-1.md', 'tickets/app-2.md', 'tooling/build.md'],
    'raw/, archive/, forge/, and .git are not pages, and the index comes first');
  assert.deepEqual(model.groups.map((group) => [group.folder, group.pages.length]), [['', 2], ['app', 1], ['app/deep', 1], ['tickets', 2], ['tooling', 1]]);
  const build = model.byPath.get('tooling/build.md');
  assert.equal(build.title, 'Build <fast> & "safe"');
  assert.deepEqual([build.status, build.updated, build.folder, build.name], ['verified', '2026-11-10', 'tooling', 'build.md']);
  assert.deepEqual(build.sources, ['https://example.com/build', 'app/retry.md', 'scripts/build.mjs:12']);
  assert.doesNotMatch(build.body, /^---|# Build/, 'the page text has no frontmatter and no title line');
  assert.deepEqual(build.links, ['app/retry.md'], 'a link in a code block and a link to a file outside of the pages are not page links');
  assert.deepEqual(build.usedBy, ['tickets/app-2.md'], 'the index and the log are not in the list');
  assert.equal(model.byPath.get('app/deep/queue.md').title, 'Queue of the app', 'a page without frontmatter gets its first heading as the title');
  assert.deepEqual(model.byPath.get('app/retry.md').usedBy, ['app/deep/queue.md', 'tooling/build.md']);
  // The closed tickets: the summary pages, the newest first, with the key from the file name.
  assert.deepEqual(model.closed, [
    { key: 'APP-2', title: 'Old fix', updated: '2026-11-12', path: 'tickets/app-2.md' },
    { key: 'APP-1', title: 'First ticket', updated: '2026-10-01', path: 'tickets/app-1.md' },
  ]);
  // The open ticket names 3 pages: with a link, with a path in the text, and with a path in code.
  assert.deepEqual(model.refs, { 'app-9': ['app/retry.md', 'tickets/app-2.md', 'tooling/build.md'] });
  assert.deepEqual(model.byPath.get('app/retry.md').tickets, [{ key: 'APP-9', folder: 'app-9', title: 'Fix outbox retry', state: 'active' }]);
  assert.deepEqual(ticketRefs(model, path.join(w.root, 'raw', 'tickets', 'nope')), []);
  assert.deepEqual(model.errors, []);
});

test('a link target is a page only inside the wiki, and a page that the model cannot read is an error', { skip: process.platform === 'win32' }, (t) => {
  const w = wiki(t);
  w.put('big.md', `# Big\n\n${'word '.repeat(120000)}\n`);
  symlinkSync(path.join(w.root, 'app', 'retry.md'), path.join(w.root, 'tooling', 'linked.md'));
  symlinkSync(path.join(w.root, 'app'), path.join(w.root, 'other'));
  const model = buildWiki(w.root);
  assert.deepEqual(model.errors.map((error) => error.path), ['big.md'], 'a link is not a page, and a page with too much text is an error');
  assert.ok(!model.byPath.has('tooling/linked.md') && !model.byPath.has('other/retry.md'));
  const base = path.join(w.root, 'tooling');
  assert.equal(pageOf(model, base, '../app/retry.md'), 'app/retry.md');
  assert.equal(pageOf(model, base, '<../app/retry.md#limits>'), 'app/retry.md');
  assert.equal(pageOf(model, base, path.join(w.root, 'app', 'retry.md')), 'app/retry.md', 'an absolute path inside the wiki');
  assert.equal(pageOf(model, base, 'app/retry.md'), 'app/retry.md', 'a path from the top of the wiki');
  assert.equal(pageOf(model, base, '../log.md'), 'log.md');
  assert.equal(pageOf(model, base, 'log.md'), '', 'a name without a folder is a file next to the document, not a page at the top of the wiki');
  for (const target of ['../raw/board.md', '../forge/config/tracker.md', '../../outside.md', 'https://example.com/a.md', 'file:///etc/a.md', '../app/retry', '%E0%A4%A.md', '', '#top']) {
    assert.equal(pageOf(model, base, target), '', target);
  }
  assert.deepEqual(linkTargets('[a](x.md) and [b](<y z.md>)\n~~~\n[c](no.md)\n~~~\n[d](w.md)'), ['x.md', '<y z.md>', 'w.md']);
});

test('the wiki page is one self-contained file: the list of the pages, each page with escaped text, its sources, and its uses', (t) => {
  const w = wiki(t);
  const board = buildBoard(w.root, { today: TODAY });
  const model = buildWiki(w.root, { board });
  const html = renderWikiPage(model, { nav: buildNav(board, { from: 'wiki', closed: model.closed }) });
  assert.equal(html.match(/<script\b/g).length, 2, 'the data block and one script');
  assert.equal(html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>')), WIKI_SCRIPT);
  assert.doesNotMatch(html, /<link\b|<img\b|<iframe\b|src=|@import|url\(/, 'the page loads no other file');
  assert.ok(html.includes(UI_STYLE) && html.includes(WIKI_STYLE));
  assert.ok(!html.includes('<script>alert(1)</script>'), 'the text of a page is escaped');
  assert.match(html, /Retries stop after 3 s\. &lt;\/script&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<h2>Build &lt;fast&gt; &amp; &quot;safe&quot;<\/h2>/);
  // The list: one group for each folder, and the closed tickets by their name.
  assert.match(html, /<section><h2>Wiki <span class="count">2<\/span><\/h2><ul><li><a href="#index\.md" title="index\.md">Wiki index<\/a><\/li>/);
  assert.match(html, /<h2>Closed tickets <span class="count">2<\/span><\/h2>/);
  assert.match(html, /<h2>app\/deep <span class="count">1<\/span><\/h2>/);
  assert.match(html, /"pages":\["index\.md","log\.md","app\/retry\.md","app\/deep\/queue\.md","tickets\/app-1\.md","tickets\/app-2\.md","tooling\/build\.md"\]/);
  assert.equal(html.match(/<article class="wpage"/g).length, 7);
  // The links of a page: a page of the wiki changes only the page in view, a web address opens a new tab, and each other relative link is text.
  const build = html.slice(html.indexOf('id="p-6"'), html.indexOf('</article>', html.indexOf('id="p-6"')));
  assert.match(build, /See <a href="#app\/retry\.md">the retry page<\/a> and a script\./);
  assert.match(build, /<li>Read the log\.<\/li>/, 'a link to a raw file has no target on this page');
  assert.match(build, /<a href="https:\/\/example\.com\/docs" target="_blank" rel="noopener noreferrer">/);
  assert.match(build, /<h3>Steps<\/h3>\n<h4>Details<\/h4>/, 'the headings keep their levels below the title of the page');
  assert.match(build, /<pre data-lang="sh"><code>cat \[not a link\]\(app\/retry\.md\)<\/code><\/pre>/);
  assert.match(build, /<span class="pill st-go">verified<\/span><span>updated 2026-11-10<\/span><code>tooling\/build\.md<\/code><a href="vscode:\/\/file\/[^"]*tooling\/build\.md"/);
  assert.match(build, /<h3>Sources<\/h3><ul><li><a href="https:\/\/example\.com\/build" target="_blank" rel="noopener noreferrer">https:\/\/example\.com\/build<\/a><\/li><li><a href="#app\/retry\.md"><code>app\/retry\.md<\/code><\/a><\/li><li><code>scripts\/build\.mjs:12<\/code><\/li>/);
  assert.match(build, /<h3>Used by<\/h3><ul><li><a href="tickets\/app-9\/canvas\.html" data-nav><span class="key">APP-9<\/span> Fix outbox retry<\/a> <small>ticket, active<\/small><\/li><li><a href="#tickets\/app-2\.md">APP-2: Old fix<\/a> <small>closed ticket<\/small><\/li>/);
  assert.match(html, /<span class="pill st-needs-me">needs a check<\/span>/);
  // The links to the other pages.
  assert.match(html, /<a class="quiet" href="board\.html" data-nav title="The board of all tickets \(b\)">Board<\/a>/);
  assert.match(html, /"nav":\{"board":"board\.html","wiki":"","prev":"","next":""\}/);
  assert.match(html, /<li class="group">Closed<\/li><li><a href="#tickets\/app-2\.md" data-text="app-2 old fix closed">/, 'the switcher has the closed tickets, and their links stay in the page');
  assert.match(renderWikiPage(model, { links: 'file' }), /<a href="file:\/\/[^"]*tooling\/build\.md"/);
  assert.throws(() => renderWikiPage(model, { links: 'web' }), /Unknown link mode/);
  // A served page: the token is in the data, and the links use the routes of the server.
  const served = renderWikiPage(model, { serve: { token: TOKEN }, nav: buildNav(board, { from: 'wiki', token: TOKEN, closed: model.closed }) });
  assert.match(served, new RegExp(`"token":"${TOKEN}","nav":\\{"board":"/board\\?t=${TOKEN}","wiki":""`));
  assert.match(served, new RegExp(`<a href="/ticket/app-9/\\?t=${TOKEN}" data-nav><span class="key">APP-9</span>`));
  assert.throws(() => renderWikiPage(model, { serve: { token: 'short' } }), /32 hexadecimal/);
  // An empty wiki still gives a page.
  const empty = mkdtempSync(path.join(os.tmpdir(), 'forge-wiki-'));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  assert.match(renderWikiPage(buildWiki(empty)), /No wiki pages yet\./);
});

test('the wiki script sits in the page and asks only its own server', () => {
  assert.ok(WIKI_SCRIPT.includes(UI_SCRIPT), 'the shared functions');
  assert.doesNotThrow(() => new Function(WIKI_SCRIPT));
  assert.ok(!WIKI_SCRIPT.includes('\r') && !WIKI_SCRIPT.includes('`'));
  assert.doesNotMatch(WIKI_SCRIPT, /XMLHttpRequest|WebSocket|sendBeacon|EventSource|https?:\/\/|innerHTML|insertAdjacentHTML|document\.write/);
  assert.equal(WIKI_SCRIPT.match(/\bfetch\(/g).length, UI_SCRIPT.match(/\bfetch\(/g).length, 'the wiki page adds no request');
  assert.match(UI_SCRIPT, /event\.key === 'w' && nav\.wiki\) go\(nav\.wiki\)/);
});

test('a link from a ticket to a wiki page opens the wiki page, and the canvas has the Wiki menu', (t) => {
  const w = wiki(t);
  const board = buildBoard(w.root, { today: TODAY });
  const model = buildWiki(w.root, { board });
  const dir = path.join(w.root, 'raw', 'tickets', 'app-9');
  const links = wikiLinks(model, { from: 'app-9', dir });
  assert.equal(links.home, '../../wiki.html');
  assert.deepEqual(links.refs.map((ref) => [ref.path, ref.title, ref.href]), [
    ['app/retry.md', 'Retry', '../../wiki.html#app/retry.md'], ['tickets/app-2.md', 'APP-2: Old fix', '../../wiki.html#tickets/app-2.md'],
    ['tooling/build.md', 'Build <fast> & "safe"', '../../wiki.html#tooling/build.md'],
  ]);
  const html = renderCanvas(buildCanvas(dir), { nav: buildNav(board, { from: 'app-9', closed: model.closed }), wiki: links });
  assert.match(html, /The limits are in <a href="\.\.\/\.\.\/wiki\.html#app\/retry\.md" data-nav>the retry page<\/a>\./);
  assert.match(html, /The build steps are in <a href="\.\.\/\.\.\/wiki\.html#tooling\/build\.md" data-nav>tooling\/build\.md<\/a>, and the old fix is <a href="\.\.\/\.\.\/wiki\.html#tickets\/app-2\.md" data-nav><code>tickets\/app-2\.md<\/code><\/a>\./);
  assert.match(html, /Not a page: evidence\/run\.md and <a href="plan\.md">the plan<\/a>\./, 'each other link stays as it was');
  assert.match(html, /<details class="refs" id="wiki-refs"><summary [^>]*>Wiki <span>3<\/span><\/summary><ul><li><a href="\.\.\/\.\.\/wiki\.html#app\/retry\.md" data-nav><span class="what">Retry<\/span><small>app\/retry\.md<\/small><\/a><\/li>/);
  assert.match(html, /<li class="all"><a href="\.\.\/\.\.\/wiki\.html" data-nav>All wiki pages<\/a><\/li><\/ul><\/details>/);
  assert.match(html, /<dt><kbd>w<\/kbd><\/dt><dd>Go to the wiki of the repository<\/dd>/);
  assert.match(html, /<li class="group">Closed<\/li><li><a href="\.\.\/\.\.\/wiki\.html#tickets\/app-2\.md" data-nav data-text="app-2 old fix closed">/);
  // A served page: the wiki route with the token, and the token is not added a second time.
  const served = wikiLinks(model, { from: 'app-9', token: TOKEN, dir });
  assert.equal(served.page('app/retry.md'), `/wiki?t=${TOKEN}#app/retry.md`);
  assert.equal(served.page('app/nope.md'), '');
  assert.match(renderCanvas(buildCanvas(dir), { serve: { token: TOKEN }, wiki: served }), new RegExp(`<a href="/wiki\\?t=${TOKEN}#app/retry\\.md" data-nav>the retry page</a>`));
  // Without the wiki, the canvas has no menu and the links are the same as before.
  const alone = renderCanvas(buildCanvas(dir));
  assert.doesNotMatch(alone, /wiki-refs|wiki\.html/);
  assert.match(alone, /<a href="\.\.\/\.\.\/\.\.\/app\/retry\.md">the retry page<\/a>/);
  assert.match(renderCanvas(buildCanvas(dir), { wiki: wikiLinks(buildWiki(w.root), { from: 'x', dir: path.join(w.root, 'raw', 'tickets', 'none') }) }), /This ticket names no wiki page\./);
  // The marks that keep a finished link do not change the other rules of a line.
  assert.equal(markdown('[' + String.fromCharCode(0xE000) + '0' + String.fromCharCode(0xE001) + '](https://e.com/a)'), '<p><a href="https://e.com/a" target="_blank" rel="noopener noreferrer">0</a></p>', 'a mark in the source is removed');
  assert.equal(markdown('A **bold** `x.md` and [**b** `c`](https://e.com/a) at https://e.com/b.'),
    '<p>A <strong>bold</strong> <code>x.md</code> and <a href="https://e.com/a" target="_blank" rel="noopener noreferrer"><strong>b</strong> <code>c</code></a> at <a href="https://e.com/b." target="_blank" rel="noopener noreferrer">https://e.com/b.</a></p>');
});

test('the board page has the link to the wiki and the closed tickets, and writeViews writes the wiki page', (t) => {
  const w = wiki(t);
  const board = buildBoard(w.root, { today: TODAY });
  const model = buildWiki(w.root, { board });
  const nav = buildNav(board, { closed: model.closed });
  assert.deepEqual([nav.wiki, nav.page('app/a b.md')], ['wiki.html', 'wiki.html#app/a%20b.md']);
  assert.deepEqual(nav.closed.map((item) => [item.key, item.href]), [['APP-2', 'wiki.html#tickets/app-2.md'], ['APP-1', 'wiki.html#tickets/app-1.md']]);
  assert.equal(buildNav(board, { from: 'wiki' }).tickets[0].href, 'tickets/app-9/canvas.html');
  assert.equal(buildNav(board, { from: 'app-9', token: TOKEN }).wiki, `/wiki?t=${TOKEN}`);
  const html = renderBoardPage(board, { wiki: w.root, nav });
  assert.match(html, /<a class="quiet" href="wiki\.html" data-nav title="The wiki of the repository \(w\)">Wiki<\/a>/);
  assert.match(html, /<details class="lane plain st-done" id="lane-closed" data-state="closed"><summary><h2>Closed tickets <span class="count">2<\/span>/);
  assert.match(html, /<li class="trow" data-state="closed" data-text="app-2 old fix closed"><span class="key">APP-2<\/span><a class="open" href="wiki\.html#tickets\/app-2\.md" data-nav title="Old fix">Old fix<\/a><span class="age">2026-11-12<\/span><\/li>/);
  assert.match(html, /"nav":\{"board":"","wiki":"wiki\.html","prev":"","next":""\}/);
  assert.doesNotMatch(renderBoardPage(board, { wiki: w.root }), /lane-closed/, 'a board without closed tickets has no such list');
  // A wiki with closed tickets only: the board says that no ticket is open.
  rmSync(path.join(w.root, 'raw', 'tickets'), { recursive: true });
  const none = buildBoard(w.root, { today: TODAY });
  assert.match(renderBoardPage(none, { wiki: w.root, nav: buildNav(none, { closed: model.closed }) }), /<p class="empty">No open ticket\. Give a work item key/);
});

test('writeViews writes the wiki page with the other pages, and it keeps a page that did not change', (t) => {
  const w = wiki(t);
  const first = writeViews(w.root, { today: TODAY, now: new Date('2026-11-17T10:00:00Z') });
  const file = path.join(w.root, 'raw', 'wiki.html');
  assert.deepEqual([first.wiki.file, first.wiki.written, first.wiki.pages, first.wiki.closed], [file, true, 7, 2]);
  assert.ok(existsSync(file));
  assert.match(readFileSync(path.join(w.root, 'raw', 'tickets', 'app-9', 'canvas.html'), 'utf8'), /id="wiki-refs"/);
  assert.match(readFileSync(path.join(w.root, 'raw', 'board.html'), 'utf8'), /id="lane-closed"/);
  const again = writeViews(w.root, { today: TODAY, now: new Date('2026-11-17T11:00:00Z') });
  assert.equal(again.wiki.written, false, 'the same wiki gives the same page');
  assert.deepEqual(again.canvases.written, []);
  w.put('tooling/new.md', page('New page', 'Text.'));
  assert.equal(writeViews(w.root, { today: TODAY }).wiki.written, true);
  assert.equal(writeViews(w.root, { today: TODAY, dryRun: true }).wiki.written, false);
});
