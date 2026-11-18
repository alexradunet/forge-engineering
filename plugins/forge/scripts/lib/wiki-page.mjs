// The wiki page: <wiki>/raw/wiki.html. One page for all canonical pages of the wiki (wiki.mjs): a list of the pages by folder,
// and one page in view. The address of a page is the path of its Markdown file after the "#" of the link.
// Each page shows its sources, the pages that name it, and the open tickets that name it. The summary pages of the
// closed tickets are in the folder tickets/. It loads nothing from a network, and it is never a source.
// The style and the components come from ui.mjs. The script uses no template literals: it sits in one.
import path from 'node:path';
import { LINK_MODES, linkTarget, markdown } from './canvas.mjs';
import { TOOLS_HTML, UI_SCRIPT, UI_STYLE, buildNav, esc, helpHtml, navData, switcherHtml } from './ui.mjs';
import { CLOSED_FOLDER, pageHash, pageOf } from './wiki.mjs';

export const WIKI_PAGE = 'wiki.html';
// The color of a page status is the color of a ticket state: no new token.
const STATUS_CLASS = { verified: 'st-go', decided: 'st-active', 'needs-check': 'st-needs-me' };
const STATUS_TEXT = { verified: 'verified', decided: 'decided', 'needs-check': 'needs a check' };
const TICKET_TEXT = { 'needs-me': 'needs you', blocked: 'blocked', go: 'go', active: 'active', waiting: 'waiting', done: 'done' };

const groupTitle = (folder) => (folder === '' ? 'Wiki' : folder === CLOSED_FOLDER ? 'Closed tickets' : folder);

function treeHtml(model) {
  return model.groups.map((group) => {
    const rows = group.pages.map((relative) => {
      const page = model.byPath.get(relative);
      return `<li><a href="#${esc(pageHash(relative))}" title="${esc(relative)}">${esc(page.title)}</a></li>`;
    }).join('');
    return `<section><h2>${esc(groupTitle(group.folder))} <span class="count">${group.pages.length}</span></h2><ul>${rows}</ul></section>`;
  }).join('');
}

function sourceHtml(source, wiki) {
  const href = linkTarget(source);
  if (/^https?:/i.test(href)) return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(source)}</a>`;
  const page = wiki.page(source);
  return page ? `<a href="${esc(page)}"><code>${esc(source)}</code></a>` : `<code>${esc(source)}</code>`;
}

function pageHtml(page, index, model, ctx) {
  const root = model.root;
  // A link of this page is relative to the folder of its file. A link to a page of the wiki changes only the page that shows.
  const wiki = {
    inPage: true,
    page: (relative) => (model.byPath.has(relative) ? `#${pageHash(relative)}` : ''),
    link: (target) => { const found = pageOf(model, path.join(root, page.folder), target); return found ? `#${pageHash(found)}` : ''; },
  };
  // A relative link to another file has no target on this page: its words stay as text.
  const body = markdown(page.body, { links: ctx.links, wiki, headings: 1, plain: true });
  const status = page.status ? `<span class="pill ${STATUS_CLASS[page.status] ?? ''}">${esc(STATUS_TEXT[page.status] ?? page.status)}</span>` : '';
  const file = linkTarget(path.join(root, ...page.path.split('/')), ctx.links);
  const meta = [
    status,
    page.updated ? `<span>updated ${esc(page.updated)}</span>` : '',
    `<code>${esc(page.path)}</code>`,
    file ? `<a href="${esc(file)}" title="Open the Markdown file of this page">Open the file</a>` : '',
  ].filter(Boolean).join('');
  const sources = page.sources.length ? `<section class="more"><h3>Sources</h3><ul>${page.sources.map((source) => `<li>${sourceHtml(source, wiki)}</li>`).join('')}</ul></section>` : '';
  const used = [
    ...page.tickets.map((ticket) => {
      const href = ctx.nav.tickets.find((item) => item.folder === ticket.folder)?.href ?? '';
      const label = `<span class="key">${esc(ticket.key)}</span> ${esc(ticket.title)}`;
      return `<li>${href ? `<a href="${esc(href)}" data-nav>${label}</a>` : label} <small>ticket, ${esc(TICKET_TEXT[ticket.state] ?? ticket.state)}</small></li>`;
    }),
    ...page.usedBy.map((relative) => {
      const other = model.byPath.get(relative);
      return `<li><a href="#${esc(pageHash(relative))}">${esc(other.title)}</a> <small>${esc(other.folder === CLOSED_FOLDER ? 'closed ticket' : relative)}</small></li>`;
    }),
  ];
  const usedBy = used.length ? `<section class="more"><h3>Used by</h3><ul>${used.join('')}</ul></section>` : '';
  return `<article class="wpage" id="p-${index}" data-title="${esc(page.title)}" hidden>`
    + `<p class="where">${esc(page.folder ? `${groupTitle(page.folder)} / ` : '')}${esc(page.name)}</p>`
    + `<h2>${esc(page.title)}</h2><p class="meta">${meta}</p>`
    + `<div class="md">${body || '<p class="empty">This page has no text.</p>'}</div>${sources}${usedBy}</article>`;
}

const HELP = [
  'Wiki',
  [['/'], 'Filter the pages by their words'],
  [['j', 'k'], 'Go to the next or the previous page of the list'],
  [['Enter'], 'In the filter: open the first page of the list'],
  'Go',
  [['b'], 'Go to the board of all tickets'],
  [['t'], 'Go to a ticket by its key or its words'],
  [['?'], 'Show this list'],
  [['Esc'], 'Close a dialog, or remove the filter text'],
];

/**
 * The self-contained HTML page of a wiki model (buildWiki in wiki.mjs). With serve.token, the links use the routes of the server of the page.
 * nav (buildNav in ui.mjs, from 'wiki') gives the links to the board page and to the tickets.
 */
export function renderWikiPage(model, { links = 'vscode', nav = null, serve = null } = {}) {
  if (!LINK_MODES.includes(links)) throw new Error(`Unknown link mode: ${links}. Use ${LINK_MODES.join(' or ')}.`);
  const token = serve?.token ?? '';
  if (token && !/^[0-9a-f]{32}$/.test(token)) throw new Error('The canvas token must have 32 hexadecimal characters.');
  const ctx = { links, nav: nav ?? buildNav({ groups: [] }, { from: 'wiki', token, closed: model.closed }) };
  const pages = model.pages.map((page, index) => pageHtml(page, index, model, ctx)).join('\n');
  const errors = model.errors.length
    ? `<section class="more" id="errors"><h3>Read errors</h3><ul>${model.errors.map((error) => `<li><code>${esc(error.path)}</code> ${esc(error.message)}</li>`).join('')}</ul></section>` : '';
  const data = JSON.stringify({ pages: model.pages.map((page) => page.path), ...(token ? { token } : {}), nav: navData(ctx.nav) }).replace(/</g, '\\u003c');
  return [
    '<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Forge wiki</title>',
    `<style>${UI_STYLE}${WIKI_STYLE}</style>`, '</head>', '<body class="page-wiki">',
    `<header id="rail" class="bar"><a class="quiet" href="${esc(ctx.nav.board)}" data-nav title="The board of all tickets (b)">Board</a><span class="sep" aria-hidden="true">/</span><h1>Wiki</h1>`
      + '<label class="search"><span class="sr">Filter the pages</span><input type="search" id="filter" placeholder="Filter the pages" autocomplete="off" spellcheck="false"><kbd>/</kbd></label>'
      + `<div class="tools"><button type="button" id="switch-open" title="Go to a ticket (t)">Go to a ticket</button>${TOOLS_HTML}</div></header>`,
    `<div id="wiki"><nav id="tree" aria-label="Pages of the wiki">${treeHtml(model)}<p class="empty" id="none" hidden>No page has these words.</p></nav>`,
    '<main id="page"><p class="banner" id="missing" hidden>The wiki has no page <code id="missing-path"></code>. This is the first page.</p>',
    model.pages.length ? pages : '<p class="empty">No wiki pages yet. The <code>wiki</code> skill records a page, and it shows here.</p>',
    errors, '</main></div>',
    '<footer id="foot"><p>Written by <code>forge.mjs board</code> from the Markdown files of the wiki. This page is a view: change the Markdown files, not this page.</p></footer>',
    switcherHtml(ctx.nav), helpHtml(HELP),
    '<div id="toast" role="status" hidden></div>',
    `<script type="application/json" id="wiki-data">${data}</script>`,
    `<script>${WIKI_SCRIPT}</script>`, '</body>', '</html>', '',
  ].join('\n');
}

export const WIKI_STYLE = String.raw`
body { height: 100vh; display: flex; flex-direction: column; }
#rail { flex: none; }
.search { display: flex; align-items: center; gap: 6px; padding: 2px 8px; background: var(--card); border: 1px solid var(--line); border-radius: var(--r-1); }
.search:focus-within { border-color: var(--accent); }
.search input { width: 190px; font: inherit; color: inherit; background: transparent; border: 0; outline: none; }
#wiki { flex: 1 1 auto; display: flex; min-height: 0; }
#tree { flex: none; width: 300px; max-width: 40%; overflow: auto; padding: var(--s-3) var(--s-2) var(--s-5); background: var(--panel); border-right: 1px solid var(--line); }
#tree section + section { margin-top: var(--s-3); }
#tree h2 { display: flex; align-items: center; gap: var(--s-2); margin: 0; padding: 4px 10px; font-size: var(--t-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
#tree ul { list-style: none; margin: 0; padding: 0; }
#tree a { display: block; padding: 4px 10px; color: inherit; text-decoration: none; overflow-wrap: anywhere; border-radius: var(--r-1); }
#tree a:hover { background: color-mix(in srgb, var(--muted) 12%, transparent); }
#tree a[aria-current] { font-weight: 600; background: color-mix(in srgb, var(--accent) 18%, transparent); }
.count { padding: 0 7px; font-size: var(--t-xs); font-weight: 600; letter-spacing: 0; color: var(--muted); background: var(--card); border: 1px solid var(--line); border-radius: var(--r-pill); }
.empty { margin: 0; padding: 4px 10px; color: var(--muted); }
#page { flex: 1 1 0; min-width: 0; overflow: auto; padding: var(--s-5) var(--s-5) var(--s-7); }
.banner { max-width: 820px; margin: 0 auto var(--s-4); padding: 6px var(--s-3); font-size: var(--t-sm); background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-2); }
.wpage, #errors { max-width: 820px; margin: 0 auto; }
.where { margin: 0; font-size: var(--t-sm); color: var(--muted); }
.wpage > h2 { margin: 2px 0 var(--s-2); font-size: var(--t-2xl); line-height: 1.25; overflow-wrap: anywhere; }
.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px var(--s-3); margin: 0 0 var(--s-5); padding-bottom: var(--s-3); font-size: var(--t-sm); color: var(--muted); border-bottom: 1px solid var(--line); }
.md { overflow-wrap: anywhere; }
.md h3 { margin: var(--s-5) 0 var(--s-2); font-size: var(--t-xl); line-height: 1.3; }
.md h4 { margin: var(--s-4) 0 var(--s-2); font-size: var(--t-lg); }
.md h5, .md h6 { margin: var(--s-4) 0 var(--s-1); font-size: var(--t-md); }
.md p { margin: 0 0 var(--s-3); }
.md ul, .md ol { margin: 0 0 var(--s-3); padding-left: 22px; }
.md li { margin: 3px 0; }
.md li > ul, .md li > ol { margin: 3px 0 0; }
.md pre { margin: 0 0 var(--s-3); padding: var(--s-3); overflow: auto; background: var(--card); border: 1px solid var(--line); border-radius: var(--r-2); }
.md pre code { padding: 0; background: transparent; overflow-wrap: normal; }
.md blockquote { margin: 0 0 var(--s-3); padding: 2px var(--s-3); color: var(--muted); border-left: 3px solid var(--line-2); }
.md table { display: block; max-width: 100%; overflow: auto; margin: 0 0 var(--s-3); border-collapse: collapse; font-size: var(--t-sm); }
.md th, .md td { padding: 4px 10px; text-align: left; vertical-align: top; border: 1px solid var(--line); }
.md th { font-weight: 600; color: var(--muted); background: var(--panel); }
.more { margin-top: var(--s-5); padding-top: var(--s-3); border-top: 1px solid var(--line); }
.more h3 { margin: 0 0 var(--s-2); font-size: var(--t-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
.more ul { list-style: none; margin: 0; padding: 0; font-size: var(--t-sm); }
.more li { margin: 4px 0; overflow-wrap: anywhere; }
.more small { color: var(--muted); }
@media (max-width: 760px) {
  body { height: auto; min-height: 100vh; }
  #wiki { flex-direction: column; }
  #tree { width: auto; max-width: none; max-height: 38vh; border-right: 0; border-bottom: 1px solid var(--line); }
  #page { overflow: visible; padding: var(--s-4) var(--s-3) var(--s-6); }
  .search input { width: 120px; }
}
`;

export const WIKI_SCRIPT = String.raw`
(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('wiki-data').textContent);
${UI_SCRIPT}
  var pages = Array.prototype.slice.call(document.querySelectorAll('.wpage'));
  var links = Array.prototype.slice.call(document.querySelectorAll('#tree a'));
  var filter = byId('filter');
  var main = byId('page');
  var texts = null;
  var at = -1;

  // The address of a page is the path of its Markdown file after the "#".
  function wanted() {
    var raw = location.hash.replace(/^#/, '');
    try { return decodeURIComponent(raw); } catch (error) { return raw; }
  }

  function show() {
    var want = wanted();
    var found = data.pages.indexOf(want);
    var missing = want !== '' && found < 0;
    at = found < 0 ? 0 : found;
    pages.forEach(function (page, index) { page.hidden = index !== at; });
    links.forEach(function (link, index) {
      if (index === at) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    byId('missing').hidden = !missing;
    if (missing) byId('missing-path').textContent = want;
    if (pages[at]) document.title = pages[at].getAttribute('data-title') + ' · Forge wiki';
    main.scrollTop = 0;
    if (links[at] && !links[at].parentNode.hidden) links[at].scrollIntoView({ block: 'nearest' });
  }

  // The filter reads the words of each page: its title, its path, and its text. It hides pages of the list. It never changes the order.
  function applyFilter() {
    var words = filter.value.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length && !texts) texts = pages.map(function (page) { return page.textContent.toLowerCase(); });
    var shown = 0;
    links.forEach(function (link, index) {
      var ok = words.every(function (word) { return texts[index].indexOf(word) >= 0; });
      link.parentNode.hidden = !ok;
      if (ok) shown += 1;
    });
    each(document.querySelectorAll('#tree section'), function (group) { group.hidden = !group.querySelector('li:not([hidden])'); });
    byId('none').hidden = shown > 0 || !links.length;
  }

  function shownLinks() { return links.filter(function (link) { return !link.parentNode.hidden; }); }
  function open(link) { if (link) location.hash = link.getAttribute('href'); }
  function step(by) {
    var list = shownLinks();
    if (!list.length) return;
    var here = list.indexOf(links[at]);
    open(list[here < 0 ? 0 : Math.min(list.length - 1, Math.max(0, here + by))]);
  }

  filter.addEventListener('input', applyFilter);
  filter.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') { open(shownLinks()[0]); event.preventDefault(); return; }
    if (event.key !== 'Escape') return;
    if (filter.value) { filter.value = ''; applyFilter(); } else filter.blur();
    event.preventDefault();
  });
  window.addEventListener('hashchange', show);
  document.addEventListener('keydown', function (event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || typing(event) || modalOpen()) return;
    if (event.key === '/') filter.focus();
    else if (event.key === 'j') step(1);
    else if (event.key === 'k') step(-1);
    else return;
    event.preventDefault();
  });

  show();
})();
`;
