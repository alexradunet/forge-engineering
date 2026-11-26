// The links between the pages: the model of the links (buildNav), the part of it that the page script needs (navData), the gate words,
// and the script parts for the links (go, noticeLost, tryAgain, the click on a link with data-nav) and for the keys that all pages share.
import { client } from './kit.mjs';

/** The words for a gate status, on each page (the one list of the kit). */
export const GATE_TEXT = { approved: 'approved', 'in-review': 'needs you', todo: 'not open', blocked: 'blocked', skipped: 'skipped' };

/**
 * The words of a ticket state on a page. The pages say "Needs you" for the state needs-me. The board file (raw/board.md) keeps
 * the label "Needs me" of board.mjs, so this map is for the pages only. `label` is the label of the board model for any other state.
 */
const PAGE_LABEL = { 'needs-me': 'Needs you' };
export const pageLabel = (state, label) => PAGE_LABEL[state] ?? label;

/** The gate line of a board ticket: the open gate and its status, or '' when no required gate is open. */
function gateLine(item) {
  if (!item.openGate) return '';
  return `${item.openGate.name} ${GATE_TEXT[item.openGate.status] ?? item.openGate.status}`;
}

/**
 * The links between the pages of one wiki, for a page at `from` ('board' or 'wiki').
 * A file page uses relative links: raw/board.html, raw/wiki.html, and raw/tickets/<folder>/<file>.
 * A served page (token) uses the routes of the live server.
 * `closed` (buildWiki in wiki.mjs) gives the closed tickets: each one has a summary page in the wiki.
 * `file(folder, name)` is the link to a file of a ticket folder. A ticket of the list opens at its README.
 */
export function buildNav(board, { from = 'board', token = '', closed = [] } = {}) {
  const seg = encodeURIComponent;
  const hash = (relative) => relative.split('/').map(seg).join('/');
  const wiki = from === 'wiki' ? '' : token ? `/wiki?t=${token}` : 'wiki.html';
  const file = (folder, name) => (token
    ? `/ticket/${seg(folder)}/${name.split('/').map(seg).join('/')}?t=${token}`
    : `tickets/${seg(folder)}/${name.split('/').map(seg).join('/')}`);
  const tickets = board.groups.flatMap((group) => group.tickets.map((item) => ({
    key: item.key, folder: item.folder, title: item.short || item.title, state: item.state, emoji: item.emoji, label: pageLabel(item.state, group.label),
    phase: item.phase, gate: gateLine(item), href: file(item.folder, 'README.md'),
  })));
  return {
    board: from === 'board' ? '' : token ? `/board?t=${token}` : 'board.html',
    wiki,
    closed: closed.map((item) => ({ key: item.key, title: item.title, updated: item.updated, path: item.path, href: `${wiki}#${hash(item.path)}` })),
    tickets, file,
  };
}

/** The part of the links that the page script needs. */
export function navData(nav) {
  if (!nav) return null;
  return { board: nav.board, wiki: nav.wiki };
}

const links = client(function () {
  // The links between the pages. A served page asks its server before it leaves,
  // so a stopped server does not replace the page and its comments with a browser error.
  var nav = data.nav || {};
  var offline = false;
  // A page of the live server has data.open: the command that starts the server again. A page of the file has none.
  var LIVE_PAGE = typeof data.open === 'string';
  var OPEN_NOW = data.open || 'forge.mjs open';
  function setOffline() { offline = true; document.body.classList.add('offline'); }
  function setOnline() {
    offline = false;
    document.body.classList.remove('offline');
    if (noticeIs('lost')) clearNotice();
  }
  // The server does not answer (status 0), or it does not know the link (403). The notice stays until the server answers again.
  function noticeLost(status) {
    setOffline();
    if (!data.token) return;
    var copy = { text: 'Copy command', copy: OPEN_NOW };
    if (!LIVE_PAGE) notice('warn', 'This page is old, or its server stopped. Run "forge.mjs open --new-link" for a new link.', [], { tag: 'old' });
    else if (status === 403) notice('warn', 'This link is old. Run the command for the new link:', [copy], { code: OPEN_NOW, tag: 'old' });
    else notice('bad', 'The live server does not answer. Start it with this command:', [copy, { text: 'Try again', run: tryAgain }], { code: OPEN_NOW, tag: 'lost' });
  }
  // Asks the server for a page, and gives the status (0 when the server does not answer).
  function probe(href, done) {
    fetch(href, { cache: 'no-store' }).then(function (response) { done(response.status); }, function () { done(0); });
  }
  // again loads the page again at the same address (the fragment of the address stays), instead of going to another address.
  function go(href, again) {
    if (!href) return;
    if (!data.token) { location.href = href; return; }
    probe(href, function (status) {
      if (status >= 200 && status < 300) { if (again) location.reload(); else location.href = href; }
      else if (status === 0 || status === 403) noticeLost(status);
      else toast('The server cannot show that page (' + status + ').');
    });
  }
  // Try again asks at once: the server answers its own page, and a page with a live view asks for the state again.
  function tryAgain() {
    probe(location.href, function (status) {
      if (status >= 200 && status < 300) {
        setOnline();
        live.fails = 0;
        live.wait = 1000;
        clearTimeout(live.timer);
        if (live.show) liveAsk();
      } else noticeLost(status);
    });
  }
  document.addEventListener('click', function (event) {
    var link = event.target.closest ? event.target.closest('a[data-nav]') : null;
    if (!link || event.defaultPrevented || !data.token || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    go(link.getAttribute('href'));
  });
});

// The last keydown handler of the page script: t, b, w, and ?.
const keys = client(function () {
  document.addEventListener('keydown', function (event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || typing(event) || modalOpen()) return;
    if (event.key === 't') openSwitcher();
    else if (event.key === 'b' && nav.board) go(nav.board);
    else if (event.key === 'w' && nav.wiki) go(nav.wiki);
    else if (event.key === '?') openHelp();
    else return;
    event.preventDefault();
  });
});

export const nav = {
  name: 'nav',
  css: '',
  html: { buildNav, navData, pageLabel },
  script: links,
  scriptParts: { keys },
  demo: () => [{
    title: 'Links of a page: the board and the wiki',
    html: '<div class="tools" style="margin-left: 0"><a class="quiet" href="#">Board</a><a class="quiet" href="#">Wiki</a></div>',
  }, {
    title: 'The gate words of a ticket',
    html: Object.values(GATE_TEXT).map((text) => `<span class="pill st-needs-me">${text}</span>`).join(' '),
  }],
};
