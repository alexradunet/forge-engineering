// The wiki page: the model of the canonical pages, the links from a page to the wiki, from the board to the wiki, and the closed tickets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildBoard } from '../plugins/forge/scripts/lib/board.mjs';
import { renderBoardPage } from '../plugins/forge/scripts/lib/board-page.mjs';
import { markdown } from '../plugins/forge/scripts/lib/markdown.mjs';
import { MERMAID_FILE, MERMAID_INTEGRITY, MERMAID_ROUTE, MERMAID_SHA256, MERMAID_VERSION, copyMermaid, mermaidPath, needsMermaid, readMermaid } from '../plugins/forge/scripts/lib/mermaid.mjs';
import { UI_SCRIPT, UI_STYLE, buildNav } from '../plugins/forge/scripts/lib/ui.mjs';
import { writeViews } from '../plugins/forge/scripts/lib/views.mjs';
import { WIKI_SCRIPT, WIKI_STYLE, renderWikiPage } from '../plugins/forge/scripts/lib/wiki-page.mjs';
import { buildWiki, linkTargets, pageHash, pageOf } from '../plugins/forge/scripts/lib/wiki.mjs';

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
  assert.deepEqual(model.pages.filter((item) => item.tickets.length).map((item) => item.path), ['app/retry.md', 'tickets/app-2.md', 'tooling/build.md']);
  assert.deepEqual(model.byPath.get('app/retry.md').tickets, [{ key: 'APP-9', folder: 'app-9', title: 'Fix outbox retry', state: 'active' }]);
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
  assert.doesNotMatch(html, /<img\b|<iframe\b|src=|@import|url\(/, 'the page loads no other file');
  // Forge 9.2: the one <link> is the icon of the tab. Its address is data (no file and no network), so the old ban on a link holds for any other link.
  assert.equal(html.match(/<link\b/g).length, 1, 'one link');
  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,[^"]+">/);
  assert.ok(html.includes(UI_STYLE) && html.includes(WIKI_STYLE));
  assert.ok(!html.includes('<script>alert(1)</script>'), 'the text of a page is escaped');
  assert.match(html, /Retries stop after 3 s\. &lt;\/script&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<h2>Build &lt;fast&gt; &amp; &quot;safe&quot;<\/h2>/);
  // The list: one group for each folder, and the closed tickets by their name.
  // Forge 9.2: a section name of the list has the kit eyebrow style, and its count is the kit count.
  assert.match(html, /<section><h2 class="eyebrow">Wiki <span class="count">2<\/span><\/h2><ul><li><a href="#index\.md" title="index\.md">Wiki index<\/a><\/li>/);
  assert.match(html, /<h2 class="eyebrow">Closed tickets <span class="count">2<\/span><\/h2>/);
  assert.match(html, /<h2 class="eyebrow">app\/deep <span class="count">1<\/span><\/h2>/);
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
  assert.match(build, /<h3 class="eyebrow">Sources<\/h3><ul><li><a href="https:\/\/example\.com\/build" target="_blank" rel="noopener noreferrer">https:\/\/example\.com\/build<\/a><\/li><li><a href="#app\/retry\.md"><code>app\/retry\.md<\/code><\/a><\/li><li><code>scripts\/build\.mjs:12<\/code><\/li>/);
  assert.match(build, /<h3 class="eyebrow">Used by<\/h3><ul><li><a href="tickets\/app-9\/README\.md" data-nav><span class="key">APP-9<\/span> Fix outbox retry<\/a> <small>ticket, active<\/small><\/li><li><a href="#tickets\/app-2\.md">APP-2: Old fix<\/a> <small>closed ticket<\/small><\/li>/);
  assert.match(html, /<span class="pill st-needs-me">needs a check<\/span>/);
  // The links to the other pages.
  assert.match(html, /<a class="quiet" href="board\.html" data-nav title="The board of all tickets \(b\)">Board<\/a>/);
  assert.match(html, /"nav":\{"board":"board\.html","wiki":""\}/);
  assert.match(html, /<li class="group">Closed<\/li><li><a href="#tickets\/app-2\.md" data-text="app-2 old fix closed">/, 'the switcher has the closed tickets, and their links stay in the page');
  assert.match(renderWikiPage(model, { links: 'file' }), /<a href="file:\/\/[^"]*tooling\/build\.md"/);
  assert.throws(() => renderWikiPage(model, { links: 'web' }), /Unknown link mode/);
  // A served page: the token is in the data, and the links use the routes of the server.
  const served = renderWikiPage(model, { serve: { token: TOKEN }, nav: buildNav(board, { from: 'wiki', token: TOKEN, closed: model.closed }) });
  assert.match(served, new RegExp(`"token":"${TOKEN}","nav":\\{"board":"/board\\?t=${TOKEN}","wiki":""`));
  assert.match(served, new RegExp(`<a href="/ticket/app-9/README\\.md\\?t=${TOKEN}" data-nav><span class="key">APP-9</span>`));
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

test('markdown turns a link or a path of a wiki page into a link of that page, and each other link stays as it was', (t) => {
  const w = wiki(t);
  const model = buildWiki(w.root);
  const dir = path.join(w.root, 'raw', 'tickets', 'app-9');
  const wikiLinks = {
    page: (relative) => (model.byPath.has(relative) ? `#${pageHash(relative)}` : ''),
    link: (target) => { const found = pageOf(model, dir, target); return found ? `#${pageHash(found)}` : ''; },
  };
  const story = readFileSync(path.join(dir, 'story.md'), 'utf8');
  const html = markdown(story, { links: 'vscode', wiki: wikiLinks });
  assert.match(html, /The limits are in <a href="#app\/retry\.md">the retry page<\/a>\./);
  assert.match(html, /The build steps are in <a href="#tooling\/build\.md">tooling\/build\.md<\/a>, and the old fix is <a href="#tickets\/app-2\.md"><code>tickets\/app-2\.md<\/code><\/a>\./);
  assert.match(html, /Not a page: evidence\/run\.md and <a href="plan\.md">the plan<\/a>\./, 'each other link stays as it was');
  // Without the wiki, the links are the same as before.
  assert.match(markdown(story), /<a href="\.\.\/\.\.\/\.\.\/app\/retry\.md">the retry page<\/a>/);
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
  assert.equal(nav.wiki, 'wiki.html');
  assert.deepEqual(nav.closed.map((item) => [item.key, item.href]), [['APP-2', 'wiki.html#tickets/app-2.md'], ['APP-1', 'wiki.html#tickets/app-1.md']]);
  assert.equal(buildNav(board, { from: 'wiki' }).tickets[0].href, 'tickets/app-9/README.md', 'a ticket of the list opens at its README');
  assert.equal(buildNav(board, { token: TOKEN }).wiki, `/wiki?t=${TOKEN}`);
  const html = renderBoardPage(board, { wiki: w.root, nav });
  assert.match(html, /<a class="quiet" href="wiki\.html" data-nav title="The wiki of the repository \(w\)">Wiki<\/a>/);
  // Forge 9.2: the closed list is a sunk kit frame with a pixel name (the real text is in a .sr span) and a kit count.
  assert.match(html, /<details class="frame sunk lane bsec st-done" id="lane-closed" data-state="closed"><summary><h2 class="bhead"><span class="pxt pxt-3" style="--n:\d+"><svg [^>]*><path d="[^"]+"\/><\/svg><span class="sr">Closed tickets<\/span><\/span><span class="count">2<\/span><small>their summary pages in the wiki<\/small><\/h2><\/summary>/);
  assert.match(html, /<li class="trow" data-state="closed" data-text="app-2 old fix closed"><span class="key">APP-2<\/span><a class="open" href="wiki\.html#tickets\/app-2\.md" data-nav title="Old fix">Old fix<\/a><span class="age">2026-11-12<\/span><\/li>/);
  assert.match(html, /"nav":\{"board":"","wiki":"wiki\.html"\}/);
  assert.doesNotMatch(renderBoardPage(board, { wiki: w.root }), /lane-closed/, 'a board without closed tickets has no such list');
  // A wiki with closed tickets only: the board says that no ticket is open.
  rmSync(path.join(w.root, 'raw', 'tickets'), { recursive: true });
  const none = buildBoard(w.root, { today: TODAY });
  assert.match(renderBoardPage(none, { wiki: w.root, nav: buildNav(none, { closed: model.closed }) }), /<p>No open ticket\.<\/p><ol><li>Start an agent session in the repository\.<\/li>/);
});

test('writeViews writes the wiki page with the other pages, and it keeps a page that did not change', (t) => {
  const w = wiki(t);
  const first = writeViews(w.root, { today: TODAY });
  const file = path.join(w.root, 'raw', 'wiki.html');
  assert.deepEqual([first.wiki.file, first.wiki.written, first.wiki.pages, first.wiki.closed], [file, true, 7, 2]);
  assert.ok(existsSync(file));
  assert.match(readFileSync(path.join(w.root, 'raw', 'board.html'), 'utf8'), /id="lane-closed"/);
  const again = writeViews(w.root, { today: TODAY });
  assert.equal(again.wiki.written, false, 'the same wiki gives the same page');
  w.put('tooling/new.md', page('New page', 'Text.'));
  assert.equal(writeViews(w.root, { today: TODAY }).wiki.written, true);
  assert.equal(writeViews(w.root, { today: TODAY, dryRun: true }).wiki.written, false);
});

test('the Mermaid file of the plugin has the hash of the code, its license, and no request of its own', () => {
  const bytes = readFileSync(mermaidPath());
  assert.equal(createHash('sha256').update(bytes).digest('hex'), MERMAID_SHA256, 'a change of the file is a change of MERMAID_SHA256 and of the notice');
  assert.equal(MERMAID_INTEGRITY, `sha256-${createHash('sha256').update(bytes).digest('base64')}`);
  assert.deepEqual(readMermaid(), bytes);
  const source = bytes.toString('utf8');
  assert.ok(!source.includes('\r'), 'the file keeps the line ends of its package');
  assert.doesNotMatch(source, /\bfetch\(|XMLHttpRequest|\bimport\(|new WebSocket|EventSource|sendBeacon|\beval\(|new Function\(/, 'the file asks no server, and it makes no code from text');
  const folder = path.dirname(mermaidPath());
  assert.match(readFileSync(path.join(folder, 'LICENSE'), 'utf8'), /The MIT License \(MIT\)/);
  const notice = readFileSync(path.join(folder, 'NOTICE.md'), 'utf8');
  for (const fact of [MERMAID_FILE, `@mermaid-js/tiny\` ${MERMAID_VERSION}`, MERMAID_SHA256, 'sha512-']) assert.ok(notice.includes(fact), `NOTICE.md: ${fact}`);
});

test('only a wiki with a Mermaid block loads the Mermaid file: from the folder of a file page, and from the server of a served page', (t) => {
  const w = wiki(t);
  const plain = renderWikiPage(buildWiki(w.root));
  assert.ok(!needsMermaid(plain) && !plain.includes('"mermaid":{'), 'a wiki without a diagram has no link to the file');
  const first = writeViews(w.root, { today: TODAY });
  assert.equal(first.wiki.mermaid, null);
  assert.ok(!existsSync(path.join(w.root, 'raw', MERMAID_FILE)));

  w.put('app/flow.md', page('Flow', ['```mermaid', 'flowchart LR', '  A[One <b>] --> B', '```', '', '```js', 'const mermaid = 1;', '```'].join('\n')));
  const model = buildWiki(w.root);
  const html = renderWikiPage(model);
  assert.match(html, /<pre data-lang="mermaid"><code>flowchart LR\n {2}A\[One &lt;b&gt;\] --&gt; B<\/code><\/pre>/, 'the block keeps its text, and the text is escaped');
  assert.match(html, /"mermaid":\{"src":"mermaid\.tiny\.js"\}/);
  assert.equal(html.match(/<script\b/g).length, 2, 'the page has no script tag for the file: the page script adds it when a page with a diagram shows');
  const served = renderWikiPage(model, { serve: { token: TOKEN } });
  assert.ok(served.includes(`"mermaid":{"src":"${MERMAID_ROUTE}?t=${TOKEN}","integrity":"${MERMAID_INTEGRITY}"}`), 'a served page also checks the hash of the file');
  // The page script: one script element for data.mermaid, the strict level of Mermaid, and the block stays when Mermaid cannot draw it.
  assert.match(WIKI_SCRIPT, /tag\.src = data\.mermaid\.src;\n\s+if \(data\.mermaid\.integrity\) tag\.integrity = data\.mermaid\.integrity;/);
  assert.equal(WIKI_SCRIPT.match(/createElement\('script'\)/g).length, 1);
  assert.match(WIKI_SCRIPT, /securityLevel: 'strict'/);
  assert.match(WIKI_SCRIPT, /pre\.setAttribute\('data-drawn', ok \? theme : 'no'\);/);

  // The file page gets the file next to it. The same file is not written again, and a changed file is replaced.
  const copy = path.join(w.root, 'raw', MERMAID_FILE);
  const second = writeViews(w.root, { today: TODAY });
  assert.deepEqual(second.wiki.mermaid, { file: copy, written: true });
  assert.deepEqual(readFileSync(copy), readFileSync(mermaidPath()));
  assert.equal(writeViews(w.root, { today: TODAY }).wiki.mermaid.written, false);
  writeFileSync(copy, 'changed');
  assert.equal(copyMermaid(path.join(w.root, 'raw'), { dryRun: true }).written, false);
  assert.equal(readFileSync(copy, 'utf8'), 'changed', 'a dry run writes nothing');
  assert.equal(writeViews(w.root, { today: TODAY }).wiki.mermaid.written, true);
  assert.deepEqual(readFileSync(copy), readFileSync(mermaidPath()));
});

test('the page script draws a Mermaid block with the shared drawing code, and the board page has no diagram', (t) => {
  const w = wiki(t);
  assert.ok(WIKI_SCRIPT.includes(UI_SCRIPT) && UI_SCRIPT.includes("stage.id = 'mermaid-stage';"), 'one stage outside of the page parts');
  assert.match(WIKI_SCRIPT, /drawMermaid\(function \(\) \{ return pages\[at\]; \}\);/);
  assert.doesNotMatch(renderBoardPage(buildBoard(w.root, { today: TODAY }), { wiki: w.root }), /"mermaid":\{/, 'the board page has no diagram');
});

test('the wiki page is built from the kit: the bar shape, a pixel title, the prose, the status pill, and the notices', (t) => {
  const w = wiki(t);
  w.put('big.md', `# Big\n\n${'word '.repeat(120000)}\n`);
  const board = buildBoard(w.root, { today: TODAY });
  const model = buildWiki(w.root, { board });
  const html = renderWikiPage(model, { nav: buildNav(board, { from: 'wiki', closed: model.closed }) });
  // The bar: the anvil (a decoration), the Board link, the separator, the title in pixel letters with its real text, the search field, and the tools.
  assert.match(html, /<header id="rail"><div class="bar"><svg class="px"[^>]*aria-hidden="true">.*<\/svg><a class="quiet" href="board\.html" data-nav title="The board of all tickets \(b\)">Board<\/a><span class="sep" aria-hidden="true">\/<\/span><h1><span class="pxt pxt-3" style="--n:\d+"><svg [^>]*><path d="[^"]+"\/><\/svg><span class="sr">Wiki<\/span><\/span><\/h1><label class="search"><span class="sr">Filter the pages<\/span><input type="search" id="filter"/);
  // A page: the text is one kit prose box, and the facts line is .wmeta.
  assert.match(html, /<p class="wmeta"><span class="pill st-go">verified<\/span>/);
  assert.match(html, /<div class="prose">/);
  assert.doesNotMatch(html, /class="md"|class="meta"/);
  // The filter notice has the Show all button, and the unknown-page notice is a warn banner.
  // Forge 9.2: this banner starts hidden, so it is not a live region. The sr paragraph before it is the live region with the same words.
  assert.ok(html.includes('<p class="sr" id="none-live" role="status"></p><div class="banner bn-info" id="none" hidden><p>No page has these words.</p><span class="bn-acts"><button type="button" id="show-all">Show all</button></span></div>'));
  assert.ok(html.includes('<div class="banner bn-warn" role="status" id="missing" hidden><p>The wiki has no page <code id="missing-path"></code>. This is the first page.</p></div>'));
  // A page that cannot be read is a bad banner under the name Read errors.
  assert.match(html, /<section id="errors"><h3 class="eyebrow">Read errors<\/h3><div class="banner bn-bad" role="status"><p><code>big\.md<\/code> /);
  assert.ok(html.includes('<p class="hint">Press ? for the keys</p>'));
  // The current page is marked by its shape (a bar and a bold name), set in the style and not only by color.
  assert.match(WIKI_STYLE, /#tree a\[aria-current\] \{ font-weight: 600;[^}]*box-shadow: inset/);
  // An empty wiki: the cold anvil and the sentence.
  const empty = mkdtempSync(path.join(os.tmpdir(), 'forge-wiki-'));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  assert.match(renderWikiPage(buildWiki(empty)), /<div class="empty"><svg class="px"[^>]*>.*<\/svg><p>No wiki pages yet\. The wiki skill records a page, and it shows here\.<\/p><\/div>/);
  // The script has the Show all button.
  assert.match(WIKI_SCRIPT, /byId\('show-all'\)\.addEventListener\('click', showAll\)/);
});
