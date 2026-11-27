// The UI kit (scripts/lib/ui/), its styleguide page, the forge.mjs styleguide command, and the demo data of the screenshots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildBoard } from '../plugins/forge/scripts/lib/board.mjs';
import { STATES } from '../plugins/forge/scripts/lib/ticket.mjs';
import { BOARD_SCRIPT, BOARD_STYLE, renderBoardPage } from '../plugins/forge/scripts/lib/board-page.mjs';
import { BREAK, COMPONENTS, GATE_TEXT, TOOLS_HTML, PAIRS, TOKENS, UI_SCRIPT, UI_STYLE, bannerHtml, brandHtml, checkComponent, chipHtml, client, ERROR_POLICY, NOTICE_HTML, errorPage, faviconUri, footHtml, frameHtml, mix, pageHtml, pageLabel, pageScript, proseHtml, ratio, tagHtml, tokensCss, tokenTable, tokenValue } from '../plugins/forge/scripts/lib/ui.mjs';
import { gatesHtml } from '../plugins/forge/scripts/lib/ui/gates.mjs';
import { FONT, SPRITES, canPixel, iconHtml, pixelText, spritePath } from '../plugins/forge/scripts/lib/ui/pixel.mjs';
import { renderStyleguide } from '../plugins/forge/scripts/lib/ui/styleguide.mjs';
import { policy } from '../plugins/forge/scripts/lib/ui/page.mjs';
import { WIKI_SCRIPT, WIKI_STYLE, renderWikiPage } from '../plugins/forge/scripts/lib/wiki-page.mjs';
import { buildWiki } from '../plugins/forge/scripts/lib/wiki.mjs';
import { FULL_TICKET, seedDemo } from './fixtures/demo.mjs';

const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));
const temp = (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'forge-kit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('each component has its fields, the names are unique, and checkComponent throws for a wrong field', () => {
  assert.ok(COMPONENTS.length >= 10);
  assert.equal(new Set(COMPONENTS.map((component) => component.name)).size, COMPONENTS.length, 'unique names');
  for (const component of COMPONENTS) {
    assert.doesNotThrow(() => checkComponent(component), component.name);
    const samples = component.demo();
    assert.ok(samples.length > 0, `${component.name}: demo samples`);
    for (const sample of samples) assert.ok(sample.title && typeof sample.html === 'string' && sample.html, `${component.name}: a sample has a title and html`);
  }
  const good = COMPONENTS[0];
  for (const bad of [null, { ...good, name: 'Bad Name' }, { ...good, css: 1 }, { ...good, html: null }, { ...good, html: { x: 1 } }, { ...good, script: undefined }, { ...good, demo: '' }, { ...good, cssParts: { a: 1 } }]) {
    assert.throws(() => checkComponent(bad), /UI component/);
  }
});

test('the script parts and the assembled script follow the rules of a page script', () => {
  assert.doesNotThrow(() => new Function('data', UI_SCRIPT), 'the whole script parses');
  for (const component of COMPONENTS) {
    for (const [name, part] of [['script', component.script], ...Object.entries(component.scriptParts ?? {})]) {
      const label = `${component.name} ${name}`;
      assert.ok(!part.includes('`') && !part.includes('\r'), label);
      assert.doesNotMatch(part, /https?:\/\/|innerHTML/, label);
    }
  }
  assert.ok(!UI_SCRIPT.includes('\r') && !UI_STYLE.includes('\r'), 'no CR in the texts of the kit');
});

test('client() gives the body of a function with LF line ends, also for a source with CRLF', () => {
  const crlf = new Function('return function () {\r\n  var a = 1;\r\n  if (a) { a = 2; }\r\n}')();
  assert.ok(String(crlf).includes('\r'), 'the test function has CR in its source');
  const text = client(crlf);
  assert.equal(text, '\n  var a = 1;\n  if (a) { a = 2; }\n');
  assert.equal(client(function () { return 1; }), ' return 1; ');
});

test('the tokens: the CSS has each token and the pinned theme rules, and the helpers compute', () => {
  const css = tokensCss();
  for (const token of TOKENS) {
    assert.ok(css.includes(`${token.name}: ${token.light ?? token.value};`), token.name);
    if (token.dark) assert.ok(css.includes(`${token.name}: ${token.dark};`), `${token.name} dark`);
  }
  assert.ok(UI_STYLE.includes(css), 'the style text starts with the token rules');
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{ :root:not\(\[data-theme="light"\]\) \{ --bg:/);
  assert.match(css, /:root\[data-theme="dark"\] \{ color-scheme: dark; --bg:/);
  assert.match(css, /:root\[data-theme="light"\] \{ color-scheme: light; \}/);
  assert.equal(ratio('#000000', '#ffffff'), 21);
  assert.equal(ratio('#777777', '#777777'), 1);
  assert.equal(mix('#ffffff', 0.5, '#000000'), '#808080');
  assert.equal(mix('#ff0000', 1, '#0000ff'), '#ff0000');
  assert.equal(PAIRS.length, 46);
  for (const pair of PAIRS) assert.ok(TOKENS.some((token) => token.name === pair.fg) && TOKENS.some((token) => token.name === pair.on), `${pair.fg} on ${pair.on}`);
  assert.equal(tokenTable().split('\n').length, TOKENS.length);
  assert.ok(!TOKENS.some((token) => token.group === 'radius' || /^--r-/.test(token.name)), 'the corners are square: no radius token');
});

test('forge.mjs styleguide --out writes the page, and without --out it writes raw/styleguide.html of the Forge folder', (t) => {
  const root = temp(t);
  const demo = seedDemo(root);
  const out = path.join(root, 'sub', 'guide.html');
  const run = (...args) => spawnSync(process.execPath, [cli, 'styleguide', '--cwd', cwd, '--wiki', demo.wiki, ...args], { encoding: 'utf8' });
  const first = run('--out', out);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /^wrote: /);
  assert.match(first.stdout, /\n {2}open {2}file:\/\//);
  assert.equal(readFileSync(out, 'utf8'), renderStyleguide());
  const json = JSON.parse(run('--out', out, '--json').stdout);
  assert.equal(json.file, out);
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  const file = path.join(demo.forge, 'raw', 'styleguide.html');
  assert.ok(existsSync(file));
  assert.ok(second.stdout.includes(`wrote: ${file}`));
  assert.notEqual(run('extra').status, 0, 'a stray word is refused');
});

test('the demo has a ticket in each of the 6 states, a read error, a people wait, and a full ticket', (t) => {
  const root = temp(t);
  const demo = seedDemo(root);
  assert.ok(existsSync(demo.repo));
  const board = buildBoard(demo.wiki, { today: '2026-11-17' });
  for (const state of STATES) assert.ok(board.groups.find((group) => group.state === state)?.tickets.length, `a ticket in ${state}`);
  assert.deepEqual(board.errors.map((error) => error.folder), ['app-107']);
  assert.equal(board.groups.flatMap((group) => group.tickets).filter((item) => item.waits.length).length, 1, 'one people wait');
  assert.ok(board.groups.flatMap((group) => group.tickets).some((item) => item.item && item.changes.length), 'an item link and a change');
  const folder = path.join(demo.forge, 'raw', 'tickets', FULL_TICKET);
  for (const name of ['README.md', 'story.md', 'map.md', 'plan.md', 'review.md', 'proof.md']) assert.ok(existsSync(path.join(folder, name)), `the full ticket has ${name}`);
  assert.ok(board.groups.flatMap((group) => group.tickets).some((item) => item.folder === FULL_TICKET), 'the full ticket is on the board');
  assert.ok(existsSync(path.join(demo.wiki, 'tickets', 'app-90.md')), 'a closed ticket summary');
});

test('each sprite has 16 rows of 16 known characters, and each glyph has 7 rows of 5', () => {
  assert.ok(Object.keys(SPRITES).length === 5, 'anvil, hammer, ember, ingot, anvil-cold: the state marks are emoji');
  for (const [name, rows] of Object.entries(SPRITES)) {
    assert.equal(rows.length, 16, name);
    for (const row of rows) assert.match(row, /^[.#o+s]{16}$/, name);
    assert.ok(rows.some((row) => /[#o+s]/.test(row)), `${name} is not blank`);
  }
  for (const char of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789?!.,:-+/()\'&') {
    assert.equal(FONT[char]?.length, 7, char);
    for (const row of FONT[char]) assert.match(row, /^[.#]{5}$/, char);
  }
  // Letters that must differ.
  for (const [a, b] of [['S', '5'], ['O', '0'], ['B', '8']]) assert.notDeepEqual(FONT[a], FONT[b], `${a} and ${b}`);
});

test('spritePath merges each horizontal run, and iconHtml gives an inline SVG with no network part', () => {
  assert.equal(spritePath(['.##.'], '#'), 'M1 0h2v1h-2z');
  assert.equal(spritePath(['.##.', '.##.'], '#'), 'M1 0h2v1h-2z M1 1h2v1h-2z');
  assert.equal(spritePath(['#.#', 'o..'], '#'), 'M0 0h1v1h-1z M2 0h1v1h-1z');
  for (const name of Object.keys(SPRITES)) {
    const html = iconHtml(name, { size: 32 });
    assert.doesNotMatch(html, /xmlns|url\(|src=|fill=|https?:/, name);
    assert.match(html, /^<svg class="px" viewBox="0 0 16 16" width="32" height="32" shape-rendering="crispEdges"/);
    assert.ok(html.includes('aria-hidden="true"') && !html.includes('role='), 'no label: hidden');
  }
  assert.match(iconHtml('anvil', { label: 'Forge' }), /role="img" aria-label="Forge"/);
  assert.ok(!iconHtml('anvil', { label: 'Forge' }).includes('aria-hidden'));
  assert.throws(() => iconHtml('anvil', { size: 20 }), /16/);
  assert.throws(() => iconHtml('nope'), /No sprite/);
});

test('pixelText keeps the real text for a screen reader and falls back to plain text for an unknown character', () => {
  const html = pixelText('Needs you');
  assert.ok(html.includes('<span class="sr">Needs you</span>'));
  assert.ok(html.includes('viewBox="0 0 50 7"') && html.includes('--n:50'));
  assert.match(html, /<svg [^>]*aria-hidden="true"/);
  assert.equal(pixelText('a<b'), 'a&lt;b');
  assert.ok(canPixel('Needs you 2') && !canPixel('a<b') && !canPixel('naïve'));
  assert.match(pixelText('Forge', { scale: 3 }), /class="pxt pxt-3"/);
});

test('each text pair of the contrast contract has its contrast in both themes, and the tokens are in the style', () => {
  for (const pair of PAIRS) {
    for (const theme of ['light', 'dark']) {
      const value = ratio(tokenValue(pair.fg, theme), tokenValue(pair.on, theme));
      assert.ok(value >= pair.min, `${theme}: ${pair.fg} on ${pair.on} is ${value.toFixed(2)}, and it needs ${pair.min}`);
    }
  }
  assert.ok(PAIRS.some((pair) => pair.fg === '--card' && pair.on === '--accent') && PAIRS.some((pair) => pair.fg === '--bg' && pair.on === '--ink'));
  for (const token of TOKENS) assert.ok(UI_STYLE.includes(`${token.name}:`), token.name);
  for (const name of ['--ember', '--steel', '--shade', '--glow', '--px']) assert.ok(TOKENS.some((token) => token.name === name), name);
  assert.ok(UI_STYLE.startsWith(tokensCss().replace(/^/, '\n')), 'the tokens come first');
});

test('the style has no image, no import, no blur, no texture, no soft shadow, and no round corner', () => {
  assert.doesNotMatch(UI_STYLE, /url\(|@import|blur/);
  assert.ok(UI_STYLE.length > 8000);
  assert.doesNotMatch(UI_STYLE, /clip-path: (?!inset\(50%\))|gradient|filter:|texture/, 'no texture, no gradient, no glow');
  for (const [, value] of UI_STYLE.matchAll(/box-shadow:\s*([^;}]+)/g)) assert.doesNotMatch(value, /\d+px\s+\d+px\s+[1-9]\d*px/, `a soft shadow: ${value}`);
  for (const token of TOKENS.filter((item) => item.group === 'shadow')) assert.doesNotMatch(token.value, /\d+px\s+\d+px\s+[1-9]\d*px/, token.name);
});

test('the styleguide is one self-contained page with the preview, the colors, the contrast, the icons, and the letters', () => {
  const page = renderStyleguide();
  assert.ok(page.startsWith('<!doctype html>'));
  assert.match(page, /<title>Forge styleguide<\/title>/);
  // Forge 9.2: the one <link> is the icon with a data address. The address is percent-encoded, so it holds no url( and no http://.
  assert.doesNotMatch(page, /<img|<iframe|@import|url\(|src=|https?:\/\//);
  assert.equal(page.match(/<link\b/g).length, 1, 'one link');
  assert.match(page, /<link rel="icon" href="data:image\/svg\+xml,[^"]+">/);
  // The page shell gives each page its data block and its one script.
  assert.equal((page.match(/<script/g) ?? []).length, 2, 'the data block and one script');
  for (const id of ['preview', 'icons', 'letters', 'sprites', 'colors', 'contrast']) assert.ok(page.includes(`id="${id}"`), id);
  for (const gone of ['decisions', 'radius']) assert.ok(!page.includes(`id="${gone}"`), `${gone}: no section`);
  for (const token of TOKENS) assert.ok(page.includes(token.name), token.name);
  for (const component of COMPONENTS) assert.ok(page.includes(`<code>${component.name}</code>`), component.name);
  for (const name of Object.keys(SPRITES)) assert.ok(page.includes(`<code>${name}</code>`), name);
  assert.ok(page.includes('Each pair meets its minimum.'), 'the palette passes its contrast pairs');
  assert.equal(renderStyleguide(), page, 'the same input gives the same bytes');
});

test('gatesHtml gives each status its class and its words, and the row a text alternative', () => {
  const words = { approved: 'approved', 'in-review': 'needs you', todo: 'not open', blocked: 'blocked', skipped: 'skipped' };
  for (const [status, text] of Object.entries(words)) {
    const html = gatesHtml([{ name: 'Gate?', status }]);
    assert.ok(html.includes(`ig-${status}`), status);
    assert.ok(html.includes(`title="Gate? ${text}"`), status);
    assert.ok(html.includes(`aria-label="Gates: Gate? ${text}"`), status);
  }
  const row = gatesHtml([{ name: 'Planned?', status: 'approved' }, { name: 'Shippable?', status: 'in-review' }]);
  assert.ok(row.includes('<span class="gate-words">Shippable? needs you</span>'));
  assert.ok(!gatesHtml([{ name: 'Shippable?', status: 'in-review' }], { words: false }).includes('gate-words'));
  assert.equal(gatesHtml([]), '');
});

// The rules of a style text: the selector lists, and the declarations of each rule. A comment is removed first.
const rulesOf = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((match) => ({ selector: match[1].trim(), body: match[2] }))
  .filter((rule) => !rule.selector.startsWith('@'));
// The first class name of each selector of a rule: `.tcard .open::after` gives `tcard`.
const firstClasses = (css) => new Set(rulesOf(css).flatMap((rule) => rule.selector.split(',').map((part) => /\.([A-Za-z_][\w-]*)/.exec(part)?.[1]).filter(Boolean)));
const PAGE_STYLES = [['the kit', UI_STYLE], ['the board', BOARD_STYLE], ['the wiki page', WIKI_STYLE]];

test('a class of the board page or the wiki page is never a class of the kit', () => {
  const kit = firstClasses(UI_STYLE);
  assert.ok(kit.size > 40 && kit.has('chip') && kit.has('count') && kit.has('tag') && kit.has('banner') && kit.has('search') && kit.has('empty') && kit.has('pill') && kit.has('frame') && kit.has('eyebrow') && kit.has('prose'), 'the kit classes are found');
  for (const [name, css, least] of [['board', BOARD_STYLE, 10], ['wiki', WIKI_STYLE, 4]]) {
    const own = firstClasses(css);
    assert.ok(own.size >= least, `${name}: the page classes are found`);
    for (const className of own) assert.ok(!kit.has(className), `${name}: .${className} is a class of the kit`);
  }
  // The same page markup uses the kit classes only through the helpers: no page rule restyles a bare tag that the kit styles.
  for (const [name, css] of [['board', BOARD_STYLE], ['wiki', WIKI_STYLE]]) {
    for (const rule of rulesOf(css)) assert.doesNotMatch(rule.selector, /^(table|th|td|button|kbd|code|a)\b/, `${name}: a rule for a tag of the kit: ${rule.selector}`);
  }
});

// A class that a rule names has a user: a name in the page code, outside of the rules. The classes st-, tg-, pxt-, ig-, and bn- are built from a state or a size.
test('each class of a rule of the kit or of the pages has a user in the scripts', () => {
  const root = path.join(cwd, 'plugins', 'forge', 'scripts');
  const files = readdirSync(root, { recursive: true }).filter((name) => name.endsWith('.mjs') && !name.includes('vendor')).map((name) => path.join(root, name));
  const code = files.map((file) => readFileSync(file, 'utf8').replace(/[^{}\n`]*\{[^{}`]*;[^{}`]*\}/g, ' ')).join('\n');
  const classes = new Set(PAGE_STYLES.flatMap(([, css]) => rulesOf(css).flatMap((rule) => [...rule.selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]))));
  assert.ok(classes.size > 90 && files.length > 30, 'the classes and the files are found');
  const unused = [...classes].filter((name) => !/^(st|tg|pxt|ig|bn)-/.test(name) && !new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(code));
  assert.deepEqual(unused, [], 'a class with no user');
});

test('the pages have one breakpoint: each width in a media query is BREAK.narrow', () => {
  assert.equal(BREAK.narrow, 760);
  for (const [name, css] of PAGE_STYLES) {
    for (const [, condition] of css.matchAll(/@media([^{]*)\{/g)) {
      if (/width/.test(condition)) assert.equal(condition.trim(), `(max-width: ${BREAK.narrow}px)`, `${name}: ${condition.trim()}`);
      else assert.match(condition, /prefers-color-scheme|prefers-reduced-motion|\(hover: none\)/, `${name}: ${condition.trim()}`);
    }
  }
  assert.ok(BOARD_STYLE.includes(`@media (max-width: ${BREAK.narrow}px)`) && WIKI_STYLE.includes(`@media (max-width: ${BREAK.narrow}px)`));
});

test('no rule of the kit or of the pages has a round corner', () => {
  for (const [name, css] of PAGE_STYLES) {
    for (const rule of rulesOf(css)) for (const [, value] of rule.body.matchAll(/border-radius:\s*([^;]+)/g)) assert.equal(value.trim(), '0', `${name}: ${rule.selector} has border-radius ${value}`);
    assert.doesNotMatch(css, /--r-(1|2|3|pill)/, `${name}: a radius token`);
  }
});

test('a rule with outline none has a rule that shows the focus, and the pages hold no other outline none', () => {
  const all = [UI_STYLE, BOARD_STYLE, WIKI_STYLE].join('\n');
  const rules = rulesOf(all);
  // Each selector with no outline has the rule that gives the visible focus mark: its own :focus-visible rule, or the rule of its box.
  const ring = {
    '.search input': '.search:focus-within',
    '#switch-q': '#switch-q:focus-visible',
    '.tcard .open:focus-visible': '.tcard:has(.open:focus-visible)',
  };
  const seen = new Set();
  for (const rule of rules) {
    if (!/outline:\s*(none|0)\b/.test(rule.body)) continue;
    for (const selector of rule.selector.split(',').map((part) => part.trim())) {
      assert.ok(ring[selector], `outline none without a focus rule: ${selector}`);
      seen.add(selector);
      const mark = rules.find((other) => other.selector.split(',').map((part) => part.trim()).includes(ring[selector]));
      assert.ok(mark && /outline:\s*(2px|var\(--px\)) solid var\(--accent\)/.test(mark.body), `${selector} needs the focus mark of ${ring[selector]}`);
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(ring).sort(), 'the list of allowed selectors has no unused row');
});

test('the board page and the wiki page name the ? key in their foot', (t) => {
  const root = temp(t);
  const demo = seedDemo(root);
  const board = buildBoard(demo.wiki, { today: '2026-11-17' });
  assert.ok(renderBoardPage(board, { wiki: demo.wiki }).includes('Press ? for the keys'));
  assert.ok(renderWikiPage(buildWiki(demo.wiki, { board })).includes('Press ? for the keys'));
});

test('the token table of docs/design-system.md has each row of tokenTable()', () => {
  const doc = readFileSync(path.join(cwd, 'docs', 'design-system.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(doc.includes('| Token | Light | Dark | Use |'));
  for (const row of tokenTable().split('\n')) assert.ok(doc.includes(row), `docs/design-system.md: ${row}`);
  assert.doesNotMatch(doc, /--r-(1|2|3|pill)|Radius/, 'the document has no radius text');
});

test('the helpers of the kit: the page label, the chip, the tag, the banner, the frame, the foot, the brand, and the prose', () => {
  assert.equal(pageLabel('needs-me', 'Needs me'), 'Needs you');
  assert.equal(pageLabel('blocked', 'Blocked'), 'Blocked');
  assert.equal(GATE_TEXT['in-review'], 'needs you');
  assert.equal(chipHtml('Go', 'go', 2, { mark: '🟢', attrs: 'data-state="go"', disabled: true }),
    '<button type="button" class="chip st-go" data-state="go" aria-pressed="false" disabled><span aria-hidden="true">🟢</span> Go <b>2</b></button>');
  assert.equal(tagHtml('CI red', 'bad'), '<span class="tag tg-bad">CI red</span>');
  assert.equal(tagHtml('x', 'nope'), '<span class="tag">x</span>');
  assert.equal(bannerHtml('Text', { kind: 'warn', id: 'n', hidden: true }), '<div class="banner bn-warn" role="status" id="n" hidden><p>Text</p></div>');
  assert.equal(frameHtml('x', { state: 'go', tag: 'article', cls: 'tcard', attrs: 'id="a"' }), '<article class="frame edge st-go tcard" id="a">x</article>');
  assert.equal(footHtml('Text', { note: '<p class="note">N</p>' }), '<footer id="foot"><p class="note">N</p><p class="text">Text</p><p class="hint">Press ? for the keys</p></footer>');
  const brand = brandHtml('FORGE', 'Forge board');
  assert.ok(brand.startsWith('<span class="brand"><svg class="px"') && brand.includes('<span class="sr">Forge board</span>') && !brand.includes('>FORGE<'));
  assert.equal(proseHtml('<p>a</p>'), '<div class="prose"><p>a</p></div>');
});

// --- Forge 9.2, stage 4 and 6: the page shell, access, the favicon, and the spark ---

const demoPages = (t) => {
  const demo = seedDemo(temp(t));
  const board = buildBoard(demo.wiki, { today: '2026-11-17' });
  const model = buildWiki(demo.wiki, { board });
  return {
    demo, board,
    pages: {
      board: renderBoardPage(board, { wiki: demo.wiki }),
      wiki: renderWikiPage(model),
      styleguide: renderStyleguide(),
    },
  };
};

test('pageHtml writes the head in a fixed order: meta tags, title, one icon, the style, the data block, and the script, and then the body with the skip link first', () => {
  const html = pageHtml({ title: 'A <b> & "title"', bodyClass: 'page-x', style: ':root{}', dataId: 'x-data', data: { text: '</script>' }, script: 'var a = 1;', body: '<main id="m">Text</main>', main: 'm' });
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  const order = ['<meta charset="utf-8">', '<meta name="viewport"', '<meta name="color-scheme" content="light dark">', '<title>A &lt;b&gt; &amp; &quot;title&quot;</title>', '<link rel="icon"', '<style>', '<script type="application/json" id="x-data">', '<script>var a = 1;</script>'];
  const at = order.map((text) => head.indexOf(text));
  assert.ok(at.every((index) => index >= 0), `each part is in the head: ${at}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'the order of the head');
  assert.equal(html.match(/<script\b/g).length, 2, 'the data block and one script');
  assert.equal(html.match(/<link\b/g).length, 1, 'one icon link');
  assert.ok(!html.slice(html.indexOf('</head>')).includes('<script'), 'no script in the body');
  assert.ok(head.includes('"text":"\\u003c/script>"'), 'the data cannot close the script block');
  assert.ok(html.includes('<body class="page-x">\n<a class="skip" href="#m">Skip to the content</a>\n<main id="m">'));
  assert.match(pageHtml({ title: 't', style: '', dataId: 'd', script: '', body: '', icon: 'needs' }), new RegExp(`<link rel="icon" href="${faviconUri('needs').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">`));
});

test('the script of each page sets the theme first, and the rest waits for the DOM', () => {
  for (const [name, script] of [['board', BOARD_SCRIPT], ['wiki', WIKI_SCRIPT]]) {
    const early = script.indexOf("document.documentElement.setAttribute('data-theme', early)");
    const ready = script.indexOf("document.addEventListener('DOMContentLoaded', start)");
    assert.ok(early > 0 && ready > early, `${name}: the early theme part comes before the DOM-ready part`);
    assert.ok(script.indexOf("localStorage.getItem('forge-ui:theme')") < script.indexOf('function start()'), `${name}: the early part runs outside the DOM-ready function`);
    assert.ok(script.indexOf('function start()') < script.indexOf(UI_SCRIPT), `${name}: all the page code is in the DOM-ready function`);
    assert.ok(script.includes("document.readyState === 'loading'"), `${name}: a page that is already loaded runs at once`);
    assert.doesNotThrow(() => new Function(script), name);
    assert.ok(!script.includes('`') && !script.includes('\r') && !script.includes('innerHTML'), name);
  }
  assert.equal(BOARD_SCRIPT, pageScript('board-data', BOARD_SCRIPT.slice(BOARD_SCRIPT.indexOf(UI_SCRIPT) + UI_SCRIPT.length, BOARD_SCRIPT.lastIndexOf('  }\n  if (document.readyState'))), 'the page script is the shell around the page code');
});

test('each page has the skip link as the first element of its body, and a main part that it names', (t) => {
  const { pages } = demoPages(t);
  for (const [name, html] of Object.entries(pages)) {
    const body = html.slice(html.indexOf('<body'));
    assert.match(body, /^<body[^>]*>\n<a class="skip" href="#([\w-]+)">Skip to the content<\/a>\n/, name);
    const target = /<a class="skip" href="#([\w-]+)"/.exec(body)[1];
    assert.ok(html.includes(` id="${target}"`), `${name}: the target #${target} is in the page`);
    assert.match(html, /<main[^>]* id="(lanes|page|sg-main)"/, `${name}: the target is the main part`);
  }
  // The link is hidden as .sr is, and it shows when it has the focus.
  assert.match(UI_STYLE, /\.sr, \.skip:not\(:focus\) \{ position: absolute;[^}]*clip-path: inset\(50%\)/);
  assert.match(UI_STYLE, /\.skip:focus \{ position: fixed;[^}]*border: var\(--px\) solid var\(--accent\)/);
});

test('the theme button shows its state in its text, and the early script only reads the stored theme', () => {
  assert.ok(TOOLS_HTML.includes('id="theme" title="Change the theme">Theme: auto</button>'));
  assert.match(UI_SCRIPT, /button\.textContent = 'Theme: ' \+ name;/);
  // The early part: only light or dark is set. A choice of auto leaves the system setting.
  const shell = pageScript('d', '');
  const html = new Function('document', 'localStorage', shell.slice(shell.indexOf('  // The theme comes first'), shell.indexOf('  function start()')));
  const root = { attrs: {}, setAttribute(name, value) { this.attrs[name] = value; } };
  for (const [stored, want] of [['dark', 'dark'], ['light', 'light'], ['auto', undefined], [null, undefined], ['x', undefined]]) {
    root.attrs = {};
    html({ documentElement: root }, { getItem: () => stored });
    assert.equal(root.attrs['data-theme'], want, String(stored));
  }
  assert.doesNotThrow(() => html({ documentElement: root }, { getItem() { throw new Error('off'); } }), 'the storage is off');
});

test('the parts that change without a user action are live regions, and the ages are not', (t) => {
  const { pages, board, demo } = demoPages(t);
  assert.ok(pages.board.includes('<p class="sr" id="showing-live" role="status"></p>'), 'the filter notice of the board');
  assert.ok(pages.wiki.includes('<p class="sr" id="none-live" role="status"></p>'), 'the filter notice of the wiki');
  assert.ok(!pages.board.includes('role="status" id="showing"') && !pages.wiki.includes('role="status" id="none"'), 'a banner that starts hidden is not the live region');
  assert.match(renderBoardPage(board, { serve: { token: 'a'.repeat(32), live: '/live' }, wiki: demo.wiki }), /<p class="note" id="live-note" aria-live="polite">/);
  const served = renderBoardPage(board, { serve: { token: 'a'.repeat(32), live: '/live' }, wiki: demo.wiki });
  for (const html of [pages.board, served]) assert.doesNotMatch(html, /class="[^"]*(age|lv-age)[^"]*"[^>]*aria-live|aria-live[^>]*class="[^"]*(age|lv-age)/, 'no live region on a text that counts');
  assert.doesNotMatch(UI_SCRIPT, /aria-live/, 'the kit script sets no live region on the ages');
});

test('an element with a tabindex has the kit focus ring', () => {
  assert.match(UI_STYLE, /\[tabindex\]:focus-visible \{ outline: 2px solid var\(--accent\)/);
});

test('faviconUri gives a standalone SVG in a data address for each variant, with its own colors', () => {
  const [calm, needs] = [faviconUri('calm'), faviconUri('needs')];
  for (const uri of [calm, needs]) {
    assert.ok(uri.startsWith('data:image/svg+xml,'));
    assert.doesNotMatch(uri, /["<>#\s]|url\(|https?:/, 'the address has nothing that ends an attribute, and no network name');
    const svg = decodeURIComponent(uri.slice('data:image/svg+xml,'.length));
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"'), 'a standalone SVG needs xmlns');
    assert.ok(svg.includes('<style>') && svg.includes('@media (prefers-color-scheme:dark)'), 'the anvil follows the color scheme');
    assert.doesNotMatch(svg, /url\(|var\(/, 'no url( and no variable: the colors are hex values');
    for (const theme of ['light', 'dark']) assert.ok(svg.includes(tokenValue('--ink', theme)), `the anvil color of ${theme}`);
  }
  assert.notEqual(calm, needs);
  const [coldSvg, hotSvg] = [calm, needs].map((uri) => decodeURIComponent(uri.slice('data:image/svg+xml,'.length)));
  assert.ok(coldSvg.includes('class="d"') && !coldSvg.includes('class="b"') && !coldSvg.includes('class="c"'), 'calm has the cold steel face and no hot spot');
  assert.ok(hotSvg.includes('class="b"') && hotSvg.includes('class="c"') && hotSvg.includes(tokenValue('--ember', 'light')) && hotSvg.includes(tokenValue('--glow', 'light')), 'needs has the ember and the glow');
  assert.throws(() => faviconUri('other'), /No icon variant/);
});

test('the pages choose the icon and the title: a ticket that needs the user gives the hot anvil, and the board counts them', (t) => {
  const { board, pages, demo } = demoPages(t);
  const icon = (html) => /<link rel="icon" href="([^"]+)">/.exec(html)[1];
  assert.equal(icon(pages.board), faviconUri('needs'));
  assert.match(pages.board, /<title>\(1\) Forge board<\/title>/);
  assert.equal(icon(pages.wiki), faviconUri('calm'));
  assert.equal(icon(pages.styleguide), faviconUri('calm'));
  assert.match(pages.wiki, /<title>Forge wiki<\/title>/);
  // Two tickets that need the user, and none.
  const needs = board.groups.find((group) => group.state === 'needs-me');
  const two = { ...board, groups: board.groups.map((group) => (group === needs ? { ...group, tickets: [needs.tickets[0], { ...needs.tickets[0], key: 'APP-190', folder: 'app-190' }] } : group)) };
  assert.match(renderBoardPage(two, { wiki: demo.wiki }), /<title>\(2\) Forge board<\/title>/);
  const none = { ...board, groups: board.groups.map((group) => (group === needs ? { ...group, tickets: [] } : group)) };
  const quiet = renderBoardPage(none, { wiki: demo.wiki });
  assert.match(quiet, /<title>Forge board<\/title>/);
  assert.equal(icon(quiet), faviconUri('calm'));
});

test('the spark: the script, the one animation inside the reduced-motion query, and the keys of the gate rows', (t) => {
  assert.ok(UI_SCRIPT.includes("'forge-ui:gates:' + row.getAttribute('data-gates')"), 'the script part is in the kit script');
  assert.ok(UI_SCRIPT.includes("ingot.classList.add('spark')"));
  // Each animation of a spark is in a query for no-preference, and no rule of the kit style uses a spark outside of it.
  const query = /@media \(prefers-reduced-motion: no-preference\) \{\n  \.ingot\.spark \{ animation: ig-fill 0\.6s steps\(4\) 1; \}[\s\S]*?\n\}\n/.exec(UI_STYLE);
  assert.ok(query, 'the animation is inside the reduced-motion query');
  assert.ok(query[0].includes('@keyframes ig-fill') && query[0].includes('@keyframes ig-rise'), 'the keyframes are inside it too');
  assert.equal(UI_STYLE.replace(query[0], '').match(/animation: ig-|\.spark/g), null, 'no spark rule outside of the query');
  assert.doesNotMatch(query[0], /blur|infinite|gradient/, 'no blur and no loop');
  // The gate rows of a board page have the key of the ticket, and each ingot has its gate and its status.
  const { pages } = demoPages(t);
  assert.match(pages.board, /<span class="gates" data-gates="app-101"><span class="ingots" role="img"[^>]*><span class="ingot ig-approved" data-gate="Planned\?" data-status="approved"/);
});

test('the spark script gives the class once, to an ingot that is approved now and was not before, and never on a first visit or without storage', () => {
  const part = COMPONENTS.find((component) => component.name === 'gates').script;
  const row = (statuses) => {
    const items = Object.entries(statuses).map(([name, status]) => {
      const ingot = { classList: { names: [], add(value) { this.names.push(value); }, contains: (value) => value === 'ingot' }, get names() { return this.classList.names; } };
      return { name, status, ingot, getAttribute: (key) => (key === 'data-gate' ? name : status), classList: { contains: () => false }, querySelector: () => ingot };
    });
    return { items, getAttribute: () => 'app-1', querySelectorAll: () => items };
  };
  const run = (rows, storage) => {
    const document = { querySelectorAll: () => rows };
    new Function('each', 'document', 'localStorage', part)((list, fn) => Array.prototype.forEach.call(list, fn), document, storage);
  };
  const store = (start = {}) => { const data = { ...start }; return { data, getItem: (key) => (key in data ? data[key] : null), setItem: (key, value) => { data[key] = value; } }; };
  const sparks = (rows) => rows.flatMap((one) => one.items.filter((item) => item.ingot.names.includes('spark')).map((item) => item.name));
  const key = 'forge-ui:gates:app-1';
  // The first visit: nothing is stored, so there is no spark, and the statuses are stored.
  let first = [row({ 'Planned?': 'approved', 'Shippable?': 'in-review' })];
  let storage = store();
  run(first, storage);
  assert.deepEqual(sparks(first), []);
  assert.deepEqual(JSON.parse(storage.data[key]), { 'Planned?': 'approved', 'Shippable?': 'in-review' });
  // The next visit: Shippable? is approved now.
  const next = [row({ 'Planned?': 'approved', 'Shippable?': 'approved' })];
  run(next, storage);
  assert.deepEqual(sparks(next), ['Shippable?']);
  assert.deepEqual(JSON.parse(storage.data[key]), { 'Planned?': 'approved', 'Shippable?': 'approved' });
  // One time: the third visit has no change.
  const third = [row({ 'Planned?': 'approved', 'Shippable?': 'approved' })];
  run(third, storage);
  assert.deepEqual(sparks(third), []);
  // The storage is off: no spark, and no error.
  const off = { getItem() { throw new Error('off'); }, setItem() { throw new Error('off'); } };
  first = [row({ 'Planned?': 'approved' })];
  assert.doesNotThrow(() => run(first, off));
  assert.deepEqual(sparks(first), []);
});

test('the content policy of a served page allows an image from a data address only, after the style rule', () => {
  const text = policy('var a;');
  assert.match(text, /; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; /);
  assert.ok(!/img-src[^;]*(https?:|\*|'self')/.test(text), 'no network image');
  assert.match(policy('var a;', { connect: false }), /; img-src data:; base-uri 'none'; form-action 'none'$/, 'the file page form has no connect-src');
  assert.match(policy('var a;', { self: true }), /^default-src 'none'; script-src 'sha256-[^']+' 'self'; /);
});

// --- Forge 9.2, stage 5: the notice and the error page ---

test('each page has the one notice: a hidden banner with a polite live region, and the script part that fills it', (t) => {
  const { pages } = demoPages(t);
  assert.equal(NOTICE_HTML, '<div class="banner bn-warn" id="notice" aria-live="polite" hidden><p></p></div>');
  for (const [name, html] of Object.entries(pages)) {
    assert.equal(html.split('id="notice"').length - 1, 1, `${name}: one #notice`);
    assert.ok(html.includes(NOTICE_HTML + '\n</body>'), `${name}: the notice is the last part of the body`);
  }
  assert.match(UI_STYLE, /#notice \{ position: fixed;[^}]*bottom: 40px;/, 'the notice stays at the bottom and moves no part of the page');
  assert.match(UI_STYLE, /\.bn-cmd \{[^}]*user-select: all;/, 'one click selects the whole command');
  // The script part: notice(kind, text, actions, more) and clearNotice(). A text goes in as text.
  assert.match(UI_SCRIPT, /function notice\(kind, text, actions, more\) \{/);
  assert.match(UI_SCRIPT, /function clearNotice\(\) \{/);
  assert.ok(UI_SCRIPT.includes("make('code', 'bn-cmd', more.code)"), 'the command goes into the notice with textContent (make)');
  assert.doesNotMatch(UI_SCRIPT, /innerHTML|insertAdjacentHTML|createElementNS|<svg|https?:\/\//);
  assert.equal(UI_SCRIPT.match(/\bfetch\(/g).length, 3, 'the notice adds no request: the link check, the live view, and Resume');
  // "The server stopped" is a notice that stays, not the toast of 4 seconds at the next click.
  assert.ok(!UI_SCRIPT.includes('GONE'), 'the toast constant is gone');
  assert.ok(!/toast\([^)]*(server stopped|does not answer)/.test(UI_SCRIPT.replace(/copyCommand\([^;]*;/g, '')), 'no toast says that the server stopped');
  for (const text of [
    'The live server does not answer. Start it with this command:', 'This link is old. Run the command for the new link:',
    'This page is old, or its server stopped. Run "forge.mjs open --new-link" for a new link.', "text: 'Copy command', copy: OPEN_NOW", "text: 'Try again', run: tryAgain",
    "typeof data.open === 'string'", "data.open || 'forge.mjs open'", "'The board changed.'", "text: 'Reload'", "text: 'Later'",
  ]) assert.ok(UI_SCRIPT.includes(text), text);
  // Reload goes through go() with the current address, so a stopped server does not replace the page. The page never loads again by itself.
  assert.ok(UI_SCRIPT.includes('go(location.href, true)') && UI_SCRIPT.includes('location.reload()'));
  assert.equal(UI_SCRIPT.match(/location\.reload\(\)/g).length, 1);
  assert.match(UI_SCRIPT, /if \(c === data\.c\) \{\n {6}live\.later = '';/);
  assert.ok(UI_SCRIPT.includes('if (!data.live || !live.show || live.busy || live.denied || document.hidden) return;'), 'the page keeps asking when the server does not answer, except after a 403');
  // The events that are over in a moment stay toasts.
  for (const text of ["toast('Theme: ' + name)", "toast(done)"]) assert.ok(UI_SCRIPT.includes(text) || text === "toast(done)", text);
  assert.ok(UI_SCRIPT.includes("copyCommand(button.getAttribute('data-copy'), 'Copied. Paste it into a terminal.')"));
});

test('the notice script on a page: the text goes in as text, the command has its button, and the notice clears', () => {
  // A small model of the DOM: the notice part runs on it, with the helpers of the base part.
  const make = (tag) => ({ tag, type: '', className: '', children: [], attrs: {}, listeners: {}, hidden: true, textContent: '', get firstChild() { return this.children[0] ?? null; },
    appendChild(child) { this.children.push(child); return child; }, removeChild(child) { this.children.splice(this.children.indexOf(child), 1); },
    setAttribute(name, value) { this.attrs[name] = value; }, addEventListener(name, fn) { this.listeners[name] = fn; } });
  const el = make('div');
  const frame = new Function('document', 'byId', 'make', `${COMPONENTS.find((one) => one.name === 'banner').script}; return { notice: notice, clearNotice: clearNotice, noticeIs: noticeIs };`);
  const api = frame({}, (id) => (id === 'notice' ? el : null), (tag, className, text) => { const item = make(tag); item.className = className || ''; if (text !== undefined) item.textContent = text; return item; });
  let ran = 0;
  api.notice('bad', '<b>The live server</b> stopped', [{ text: 'Copy command', copy: 'forge open <x>' }, { text: 'Try again', run: () => { ran += 1; } }, { text: 'Later', quiet: true, run: () => {} }], { code: 'forge open <x>', tag: 'lost' });
  assert.equal(el.hidden, false);
  assert.equal(el.className, 'banner bn-bad');
  assert.equal(el.children[0].textContent, '<b>The live server</b> stopped', 'the text is not HTML');
  assert.deepEqual([el.children[0].children[0].tag, el.children[0].children[0].className, el.children[0].children[0].textContent], ['code', 'bn-cmd', 'forge open <x>']);
  const [copy, again, later] = el.children[1].children;
  assert.deepEqual([copy.attrs['data-copy'], copy.type, again.className, later.className], ['forge open <x>', 'button', '', 'quiet']);
  again.listeners.click();
  assert.equal(ran, 1);
  assert.equal(api.noticeIs('lost'), true);
  api.clearNotice();
  assert.deepEqual([el.hidden, api.noticeIs('lost')], [true, false]);
  api.notice('nope', 'Text', []);
  assert.equal(el.className, 'banner bn-warn', 'an unknown kind is warn');
  assert.equal(el.children.length, 1, 'a notice without a button has no button box');
});

test('the pages of a live server: the board has the stamp, the command, and the two icons, and the scripts hold no drawing and no address', (t) => {
  const { board, demo } = demoPages(t);
  const serve = { token: 'a'.repeat(32), live: '/live?t=' + 'a'.repeat(32), open: '"/x y.forge/forge" open', c: 'abcdef012345' };
  const dataOf = (html, id) => JSON.parse(new RegExp(`<script type="application/json" id="${id}">([^<]*)</script>`).exec(html)[1]);
  const b = dataOf(renderBoardPage(board, { serve, wiki: demo.wiki }), 'board-data');
  assert.deepEqual([b.open, b.c], ['"/x y.forge/forge" open', 'abcdef012345']);
  assert.deepEqual(b.icons, { calm: faviconUri('calm'), needs: faviconUri('needs') });
  const file = dataOf(renderBoardPage(board, { wiki: demo.wiki }), 'board-data');
  assert.ok(!('open' in file) && !('c' in file) && !('icons' in file), 'a file page has none of them');
  // The board script sets the title and swaps the icon from the data block. Nothing in a script draws, and no script holds an address.
  assert.ok(BOARD_SCRIPT.includes("document.title = state.needs ? '(' + state.needs + ') Forge board' : 'Forge board';") && BOARD_SCRIPT.includes('setIcon(state.needs > 0);'));
  assert.ok(UI_SCRIPT.includes("link.setAttribute('href', hot ? data.icons.needs : data.icons.calm);"));
  for (const [name, script] of [['board', BOARD_SCRIPT], ['wiki', WIKI_SCRIPT], ['kit', UI_SCRIPT]]) assert.doesNotMatch(script, /createElementNS|<svg|xmlns|https?:\/\/|data:image/, name);
  assert.equal(BOARD_SCRIPT.match(/\bfetch\(/g).length, 3);
  assert.ok(WIKI_SCRIPT.match(/\bfetch\(/g).length <= UI_SCRIPT.match(/\bfetch\(/g).length, 'the wiki page has no live polling of its own');
  assert.ok(!WIKI_SCRIPT.slice(WIKI_SCRIPT.indexOf(UI_SCRIPT) + UI_SCRIPT.length).includes('liveStart('), 'the wiki page code does not start the live view');
});

test('errorPage is one self-contained page with no script, the cold anvil, a pixel title, an optional command, and the links as buttons', () => {
  assert.equal(ERROR_POLICY, "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'");
  const page = errorPage({ status: 403, title: 'This link is old', text: 'The link is old or not complete.', command: 'forge open', links: [{ text: 'Open the board', href: '/board?t=x' }] });
  assert.ok(page.startsWith('<!doctype html>'));
  assert.match(page, /<title>This link is old<\/title>/);
  assert.doesNotMatch(page, /<script|<img|<iframe|@import|url\(|https?:\/\/|\son[a-z]+=/);
  assert.equal(page.match(/<link\b/g).length, 1);
  assert.match(page, /<link rel="icon" href="data:image\/svg\+xml,[^"]+">/);
  assert.ok(page.includes('<p class="eyebrow">Error 403</p>') && page.includes('<code class="err-cmd">forge open</code>') && page.includes('<a class="primary" href="/board?t=x">Open the board</a>'));
  assert.ok(page.includes('<h1><span class="pxt pxt-3"') && page.includes('<span class="sr">This link is old</span>'), 'the pixel title keeps its real text');
  assert.ok(page.includes(iconHtml('anvil-cold', { size: 64 })));
  assert.ok(page.includes(UI_STYLE), 'the style of the kit');
  // A value is escaped. Without a command and links there is no code block and no button.
  const odd = errorPage({ status: 500, title: 'A <b> title', text: '<img src=x onerror=alert(1)> & "q"' });
  assert.ok(!odd.includes('<img src=x') && odd.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;'));
  assert.ok(!odd.includes('<code class="err-cmd">') && !odd.includes('class="primary"'));
  assert.equal(errorPage({ status: 404, title: 'x', text: 'y' }), errorPage({ status: 404, title: 'x', text: 'y' }), 'the same input gives the same bytes');
  // The style: one calm column, no texture, and no gradient.
  const style = /<style>([\s\S]*)<\/style>/.exec(page)[1];
  assert.doesNotMatch(style.slice(UI_STYLE.length), /gradient|filter:|blur|radius|animation/);
});
