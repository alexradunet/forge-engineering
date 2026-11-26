// The wiki page: <forge>/raw/wiki.html. One page for all canonical pages of the wiki (wiki.mjs): a list of the pages by folder,
// and one page in view. The address of a page is the path of its Markdown file after the "#" of the link.
// Each page shows its sources, the pages that name it, and the open tickets that name it. The summary pages of the
// closed tickets are in the folder tickets/. It loads nothing from a network, and it is never a source.
// A wiki with a Mermaid block is the one case of a second file: the page loads the Mermaid file of forge (mermaid.mjs)
// from its own folder or from its own server, and draws the block.
// The style and the components come from ui.mjs (the kit): this file has only the layout of the wiki. The script uses no template literals: it sits in one.
import path from 'node:path';
import { STATE_LABEL } from './board.mjs';
import { linkTarget, markdown } from './markdown.mjs';
import { MERMAID_FILE, MERMAID_INTEGRITY, MERMAID_ROUTE, needsMermaid } from './mermaid.mjs';
import { BREAK, TOOLS_HTML, UI_STYLE, bannerHtml, buildNav, countHtml, emptyHtml, esc, footHtml, helpHtml, iconHtml, navData, pageHtml as shellHtml, pageLabel, pageScript, pillHtml, pixelText, proseHtml, searchHtml, switcherHtml } from './ui.mjs';
import { CLOSED_FOLDER, pageHash, pageOf } from './wiki.mjs';

export const WIKI_PAGE = 'wiki.html';
// The color of a page status is the color of a ticket state: no new token.
const STATUS_STATE = { verified: 'go', decided: 'active', 'needs-check': 'needs-me' };
const STATUS_TEXT = { verified: 'verified', decided: 'decided', 'needs-check': 'needs a check' };
// The words of a ticket state on a page: "needs you" for the state needs-me (pageLabel in ui.mjs).
const ticketText = (state) => (STATE_LABEL[state] ? pageLabel(state, STATE_LABEL[state]).toLowerCase() : state);

const groupTitle = (folder) => (folder === '' ? 'Wiki' : folder === CLOSED_FOLDER ? 'Closed tickets' : folder);

function treeHtml(model) {
  return model.groups.map((group) => {
    const rows = group.pages.map((relative) => {
      const page = model.byPath.get(relative);
      return `<li><a href="#${esc(pageHash(relative))}" title="${esc(relative)}">${esc(page.title)}</a></li>`;
    }).join('');
    return `<section><h2 class="eyebrow">${esc(groupTitle(group.folder))} ${countHtml(group.pages.length)}</h2><ul>${rows}</ul></section>`;
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
    page: (relative) => (model.byPath.has(relative) ? `#${pageHash(relative)}` : ''),
    link: (target) => { const found = pageOf(model, path.join(root, page.folder), target); return found ? `#${pageHash(found)}` : ''; },
  };
  // A relative link to another file has no target on this page: its words stay as text.
  const body = markdown(page.body, { wiki, plain: true });
  const status = page.status ? pillHtml(STATUS_TEXT[page.status] ?? page.status, STATUS_STATE[page.status] ?? '') : '';
  const file = linkTarget(path.join(root, ...page.path.split('/')));
  const meta = [
    status,
    page.updated ? `<span>updated ${esc(page.updated)}</span>` : '',
    `<code>${esc(page.path)}</code>`,
    file ? `<a href="${esc(file)}" title="Open the Markdown file of this page">Open the file</a>` : '',
  ].filter(Boolean).join('');
  const sources = page.sources.length ? `<section class="wmore"><h3 class="eyebrow">Sources</h3><ul>${page.sources.map((source) => `<li>${sourceHtml(source, wiki)}</li>`).join('')}</ul></section>` : '';
  const used = [
    ...page.tickets.map((ticket) => {
      const href = ctx.nav.tickets.find((item) => item.folder === ticket.folder)?.href ?? '';
      const label = `<span class="key">${esc(ticket.key)}</span> ${esc(ticket.title)}`;
      return `<li>${href ? `<a href="${esc(href)}" data-nav>${label}</a>` : label} <small>ticket, ${esc(ticketText(ticket.state))}</small></li>`;
    }),
    ...page.usedBy.map((relative) => {
      const other = model.byPath.get(relative);
      return `<li><a href="#${esc(pageHash(relative))}">${esc(other.title)}</a> <small>${esc(other.folder === CLOSED_FOLDER ? 'closed ticket' : relative)}</small></li>`;
    }),
  ];
  const usedBy = used.length ? `<section class="wmore"><h3 class="eyebrow">Used by</h3><ul>${used.join('')}</ul></section>` : '';
  return `<article class="wpage" id="p-${index}" data-title="${esc(page.title)}" hidden>`
    + `<p class="wwhere">${esc(page.folder ? `${groupTitle(page.folder)} / ` : '')}${esc(page.name)}</p>`
    + `<h2>${esc(page.title)}</h2><p class="wmeta">${meta}</p>`
    + `${proseHtml(body || emptyHtml('This page has no text.'))}${sources}${usedBy}</article>`;
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
export function renderWikiPage(model, { nav = null, serve = null } = {}) {
  const token = serve?.token ?? '';
  if (token && !/^[0-9a-f]{32}$/.test(token)) throw new Error('The page token must have 32 hexadecimal characters.');
  const ctx = { nav: nav ?? buildNav({ groups: [] }, { from: 'wiki', token, closed: model.closed }) };
  const pages = model.pages.map((page, index) => pageHtml(page, index, model, ctx)).join('\n');
  const errors = model.errors.length
    ? `<section id="errors"><h3 class="eyebrow">Read errors</h3>${model.errors.map((error) => bannerHtml(`<code>${esc(error.path)}</code> ${esc(error.message)}`, { kind: 'bad' })).join('')}</section>` : '';
  // The page script loads the Mermaid file only when a page has a diagram block. A served page also checks the hash of the file.
  const mermaid = !needsMermaid(pages) ? null : token ? { src: `${MERMAID_ROUTE}?t=${token}`, integrity: MERMAID_INTEGRITY } : { src: MERMAID_FILE };
  // serve.open is the command that starts the live server again: only a page of the live server has it.
  const open = token && typeof serve.open === 'string' ? serve.open : null;
  const data = { pages: model.pages.map((page) => page.path), ...(token ? { token } : {}), ...(open !== null ? { open } : {}), ...(mermaid ? { mermaid } : {}), nav: navData(ctx.nav) };
  const body = [
    `<header id="rail"><div class="bar">${iconHtml('anvil', { size: 32 })}<a class="quiet" href="${esc(ctx.nav.board)}" data-nav title="The board of all tickets (b)">Board</a><span class="sep" aria-hidden="true">/</span><h1>${pixelText('Wiki', { scale: 3 })}</h1>`
      + searchHtml({ id: 'filter', label: 'Filter the pages', placeholder: 'Filter the pages' })
      + `<div class="tools"><button type="button" id="switch-open" title="Go to a ticket (t)">Go to a ticket</button>${TOOLS_HTML}</div></div></header>`,
    `<div id="wiki"><nav id="tree" aria-label="Pages of the wiki"><p class="sr" id="none-live" role="status"></p>${bannerHtml('No page has these words.', { kind: 'info', id: 'none', hidden: true, live: false, actions: '<button type="button" id="show-all">Show all</button>' })}${treeHtml(model)}</nav>`,
    `<main id="page">${bannerHtml('The wiki has no page <code id="missing-path"></code>. This is the first page.', { kind: 'warn', id: 'missing', hidden: true })}`,
    model.pages.length ? pages : emptyHtml('No wiki pages yet. The wiki skill records a page, and it shows here.', { icon: 'anvil-cold' }),
    errors, '</main></div>',
    footHtml('Written by <code>forge.mjs board</code> from the Markdown files of the wiki. This page is a view: change the Markdown files, not this page.'),
    switcherHtml(ctx.nav), helpHtml(HELP),
    '<div id="toast" role="status" hidden></div>',
  ].join('\n');
  return shellHtml({ title: 'Forge wiki', bodyClass: 'page-wiki', style: UI_STYLE + WIKI_STYLE, dataId: 'wiki-data', data, script: WIKI_SCRIPT, body, main: 'page' });
}

// The layout of the wiki. The look of a part (bar, search, banner, pill, count, prose, table, foot) is in the kit.
export const WIKI_STYLE = String.raw`
body { height: 100vh; display: flex; flex-direction: column; }
#rail { flex: none; }
#wiki { flex: 1 1 auto; display: flex; min-height: 0; }
/* The width of the list of pages: no token has this size. */
/* A hairline between two parts is 1px, as in a table of the kit. */
#tree { flex: none; width: 300px; max-width: 40%; overflow: auto; padding: var(--s-3) var(--s-2) var(--s-5); background: var(--panel); border-right: 1px solid var(--line); }
#tree section + section { margin-top: var(--s-3); }
#tree h2 { display: flex; align-items: center; gap: var(--s-2); margin: 0; padding: var(--s-1) var(--s-3); }
#tree ul { list-style: none; margin: 0; padding: 0; }
#tree a { display: block; padding: var(--s-1) var(--s-3); color: inherit; text-decoration: none; overflow-wrap: anywhere; }
#tree a:hover { background: color-mix(in srgb, var(--muted) 12%, transparent); }
#tree a[aria-current] { font-weight: 600; background: color-mix(in srgb, var(--accent) 18%, transparent); box-shadow: inset var(--s-1) 0 0 var(--accent); }
#none { margin: 0 var(--s-2) var(--s-3); }
#page { flex: 1 1 0; min-width: 0; overflow: auto; padding: var(--s-5) var(--s-5) var(--s-7); }
/* The width of a line of text to read: no token has this size. */
#missing { max-width: 820px; margin: 0 auto var(--s-4); }
.wpage, #errors { max-width: 820px; margin: 0 auto; }
#errors { display: grid; gap: var(--s-2); }
#errors h3 { margin: 0; }
.wwhere { margin: 0; font-size: var(--t-sm); color: var(--muted); }
.wpage > h2 { margin: var(--px) 0 var(--s-2); font-size: var(--t-2xl); line-height: 1.25; overflow-wrap: anywhere; }
.wmeta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-1) var(--s-3); margin: 0 0 var(--s-5); padding-bottom: var(--s-3); font-size: var(--t-sm); color: var(--muted); border-bottom: 1px solid var(--line); }
.wmore { margin-top: var(--s-5); padding-top: var(--s-3); border-top: 1px solid var(--line); }
.wmore h3 { margin: 0 0 var(--s-2); }
.wmore ul { list-style: none; margin: 0; padding: 0; font-size: var(--t-sm); }
.wmore li { margin: var(--s-1) 0; overflow-wrap: anywhere; }
.wmore small { color: var(--muted); }
@media (max-width: ${BREAK.narrow}px) {
  body { height: auto; min-height: 100vh; }
  #wiki { flex-direction: column; }
  #tree { width: auto; max-width: none; max-height: 38vh; border-right: 0; border-bottom: 1px solid var(--line); }
  #page { overflow: visible; padding: var(--s-4) var(--s-3) var(--s-6); }
}
`;

export const WIKI_SCRIPT = pageScript('wiki-data', String.raw`  var pages = Array.prototype.slice.call(document.querySelectorAll('.wpage'));
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
    // Each page gets its drawings when it shows (drawMermaid in ui.mjs).
    drawMermaid(function () { return pages[at]; });
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
    // The banner starts hidden, so a screen reader does not read it. The live region next to it has the words of the filter.
    byId('none-live').textContent = !words.length ? '' : shown ? shown + (shown === 1 ? ' page has' : ' pages have') + ' these words.' : 'No page has these words.';
  }

  function showAll() { filter.value = ''; applyFilter(); filter.focus(); }

  function shownLinks() { return links.filter(function (link) { return !link.parentNode.hidden; }); }
  function open(link) { if (link) location.hash = link.getAttribute('href'); }
  function step(by) {
    var list = shownLinks();
    if (!list.length) return;
    var here = list.indexOf(links[at]);
    open(list[here < 0 ? 0 : Math.min(list.length - 1, Math.max(0, here + by))]);
  }

  filter.addEventListener('input', applyFilter);
  byId('show-all').addEventListener('click', showAll);
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
`);
