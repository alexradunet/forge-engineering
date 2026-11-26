// The board page: <forge>/raw/board.html. One page for all tickets of the wiki: one lane for each state,
// the tickets that wait for the user first, a link from each ticket to its document, and the closed tickets with a link to their summary page in the wiki.
// It shows the model of board.mjs (the same data as raw/board.md). It loads nothing from a network, and it is never a source.
// The style and the components come from ui.mjs (the kit): this file has only the layout of the board. The script uses no template literals: it sits in one.
import path from 'node:path';
import { WAIT_WORKDAYS, nextStrike } from './board.mjs';
import { LINK_MODES, linkTarget } from './markdown.mjs';
import { rawDir } from './layout.mjs';
import { GATE_DOCS } from './ticket.mjs';
import { BREAK, TOOLS_HTML, UI_STYLE, bannerHtml, brandHtml, buildNav, chipHtml, countHtml, emptyHtml, esc, faviconUri, footHtml, frameHtml, gatesHtml, helpHtml, navData, pageHtml, pageLabel, pageScript, pixelText, searchHtml, switcherHtml, tagHtml } from './ui.mjs';

export const BOARD_PAGE = 'board.html';
// An open ticket without an update for this number of days gets a mark.
export const STALE_DAYS = 7;

// The steps of the first run: the board has no ticket yet.
const FIRST_STEPS = ['Start an agent session in the repository.', 'Give it a work item key, for example APP-123.', 'The ticket shows here after its first step.'];

/** The link to a file of the ticket folder: the editor link of a local page, else the link of the nav (a relative link, or the route of the live server). */
function ticketHref(item, ctx, name) {
  return ctx.links === 'vscode' && ctx.wiki
    ? linkTarget(path.join(rawDir(ctx.wiki), 'tickets', item.folder, ...name.split('/')))
    : ctx.nav.file(item.folder, name);
}

/** The link to the document of a ticket: the document of the gate in review (its `doc`, else the document of the gate name), else the README. */
function docHref(item, ctx) {
  const gate = item.gates.find((one) => one.status === 'in-review');
  const doc = gate ? (gate.doc || GATE_DOCS[gate.name]?.[0] || '').replaceAll('\\', '/') : '';
  // The name comes from the README of the ticket: it must stay inside the ticket folder.
  const inside = doc && !doc.startsWith('/') && !/^[a-z]:/i.test(doc) && !doc.split('/').includes('..');
  return ticketHref(item, ctx, inside ? doc : 'README.md');
}

// A link to a page of the live server or a file of the page folder changes the page through the script (data-nav). An editor link does not.
const navAttr = (href) => (/^[a-z][a-z0-9+.-]*:/i.test(href) ? '' : ' data-nav');

const age = (days) => (days === null ? '' : days <= 0 ? 'today' : days === 1 ? '1 day' : `${days} days`);
const external = (url, label) => {
  const href = linkTarget(url);
  return /^https?:/i.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : '';
};

function tags(item) {
  const out = [tagHtml(item.phase)];
  if (item.sync?.pr) out.push(tagHtml(`PR ${item.sync.pr}`));
  else for (const change of item.changes) out.push(tagHtml(`${change.label || 'PR'} ${change.state}`));
  if (item.sync?.ci) out.push(tagHtml(`CI ${item.sync.ci}`, /\b(green|pass|passed|success)\b/i.test(item.sync.ci) ? 'ok' : /\b(red|fail|failed|failure|broken)\b/i.test(item.sync.ci) ? 'bad' : ''));
  if (item.sync?.tracker) out.push(tagHtml(`Tracker ${item.sync.tracker}`));
  for (const wait of item.waits) out.push(tagHtml(`⏳ ${wait.name}, ${wait.workdays} working days`, 'wait'));
  return out.join('');
}

function searchText(item, label) {
  return [item.key, item.title, item.short, item.next, item.waitingOn, item.phase, pageLabel(item.state, label), ...item.waits.map((wait) => wait.name)].join(' ').toLowerCase();
}

function cardHtml(item, label, ctx) {
  const href = docHref(item, ctx);
  const stale = item.state !== 'done' && item.days !== null && item.days >= STALE_DAYS;
  const allDone = !item.openGate && item.gates.length && item.gates.every((one) => ['approved', 'skipped'].includes(one.status));
  const links = [];
  links.push(`<a href="${esc(ticketHref(item, ctx, 'README.md'))}">README</a>`);
  const worktree = ctx.links === 'vscode' && item.worktree ? linkTarget(item.worktree) : '';
  if (worktree.startsWith('vscode://')) links.push(`<a href="${esc(worktree)}" title="${esc(item.worktree)}">Worktree</a>`);
  for (const change of item.changes) links.push(external(change.url, change.label || 'Change'));
  const inner = `<header><span class="key">${esc(item.key)}</span><span class="age"${stale ? ` title="No update for ${item.days} days"` : ''}>${age(item.days)}</span></header>`
    + `<h3><a class="open" href="${esc(href)}"${navAttr(href)} title="${esc(item.title)}">${esc(item.short || item.title)}</a></h3>`
    + (item.gates.length ? `<p class="tline">${gatesHtml(item.gates, { folder: item.folder })}${allDone ? ' <span class="tnote">All gates approved</span>' : ''}</p>` : '')
    + (item.next ? `<p class="tline tclamp"><span class="eyebrow">Next</span> ${esc(item.next)}</p>` : '')
    + (item.waitingOn ? `<p class="tline tclamp"><span class="eyebrow">Waiting on</span> ${esc(item.waitingOn)}</p>` : '')
    + `<p class="ttags">${tags(item)}</p>`
    + `<footer class="tlinks">${links.filter(Boolean).join('')}</footer>`;
  return frameHtml(inner, {
    state: item.state, tag: 'article', cls: `tcard${stale ? ' stale' : ''}`,
    attrs: `id="ticket-${esc(item.folder)}" data-state="${esc(item.state)}" data-text="${esc(searchText(item, label))}"`,
  });
}

function rowHtml(item, label, ctx) {
  const href = docHref(item, ctx);
  return `<li class="trow" id="ticket-${esc(item.folder)}" data-state="${esc(item.state)}" data-text="${esc(searchText(item, label))}"><span class="key">${esc(item.key)}</span>`
    + `<a class="open" href="${esc(href)}"${navAttr(href)} title="${esc(item.title)}">${esc(item.short || item.title)}</a><span class="age">${age(item.days)}</span></li>`;
}

// The name of a section in pixel letters, at one size for each section of the page. `inner` is more HTML after the name (a count or a note).
const headHtml = (name, inner = '', mark = '') => `<h2 class="bhead">${mark ? `<span aria-hidden="true">${mark}</span>` : ''}${pixelText(name, { scale: 3 })}${inner}</h2>`;

// The next strike: one strip above the lanes. It has the same kind of color as the state of its ticket: warm for a ticket that needs the user, red for a blocked ticket, blue for a ticket that can start.
const STRIKE_KIND = { review: 'warn', 'needs-me': 'warn', blocked: 'bad', go: 'info' };
function strikeHtml(board, ctx) {
  const strike = nextStrike(board);
  const item = strike ? board.groups.flatMap((group) => group.tickets).find((one) => one.folder === strike.folder) : null;
  if (!item) return '';
  const href = docHref(item, ctx);
  return bannerHtml(`<span class="key">${esc(strike.key)}</span> ${esc(strike.text)}`, {
    kind: STRIKE_KIND[strike.kind], id: 'strike', actions: `<a class="primary" href="${esc(href)}"${navAttr(href)} aria-label="Open ${esc(strike.key)}">Open</a>`,
  });
}

function laneHtml(group, board, ctx) {
  const head = headHtml(pageLabel(group.state, group.label), countHtml(group.tickets.length), group.emoji);
  const attrs = `id="lane-${esc(group.state)}" data-state="${esc(group.state)}"`;
  const lane = (tag, inner) => frameHtml(inner, { sunk: true, tag, cls: `lane st-${group.state}`, attrs });
  if (!group.tickets.length) {
    // The first lane stays on the page: an empty lane is the answer to "does a ticket wait for me?".
    return group.state === 'needs-me' && board.total ? lane('section', `${head}${emptyHtml('No ticket needs you.', { icon: 'anvil-cold' })}`) : '';
  }
  if (group.state === 'done') return lane('details', `<summary>${head}</summary><ul class="rows">${group.tickets.map((item) => rowHtml(item, group.label, ctx)).join('')}</ul>`);
  return lane('section', `${head}<div class="cards">${group.tickets.map((item) => cardHtml(item, group.label, ctx)).join('')}</div>`);
}

function waitsHtml(board) {
  const waits = board.groups.flatMap((group) => group.tickets.flatMap((item) => item.waits.map((wait) => ({ key: item.key, ...wait }))));
  if (!waits.length) return '';
  const row = (wait) => `<tr><td class="key">${esc(wait.key)}</td><td>${esc(wait.name)}</td><td>${esc(wait.role)}</td><td>${esc(wait.ask)}</td><td>${esc(wait.since)}</td><td>${wait.workdays}</td></tr>`;
  return frameHtml(`${headHtml('People waits', `<small>more than ${WAIT_WORKDAYS} working days</small>`)}`
    + `<table><thead><tr><th>Ticket</th><th>Person</th><th>Role</th><th>Ask</th><th>Since</th><th>Working days</th></tr></thead><tbody>${waits.map(row).join('')}</tbody></table>`,
  { sunk: true, tag: 'section', cls: 'bsec', attrs: 'id="waits"' });
}

// A closed ticket has no folder on the board: its summary page is in the wiki (tickets/<key>.md), and the wiki page shows it.
function closedHtml(nav) {
  if (!nav.closed?.length) return '';
  const row = (item) => `<li class="trow" data-state="closed" data-text="${esc([item.key, item.title, 'closed'].join(' ').toLowerCase())}"><span class="key">${esc(item.key)}</span>`
    + `<a class="open" href="${esc(item.href)}" data-nav title="${esc(item.title)}">${esc(item.title)}</a><span class="age">${esc(item.updated)}</span></li>`;
  return frameHtml(`<summary>${headHtml('Closed tickets', `${countHtml(nav.closed.length)}<small>their summary pages in the wiki</small>`)}</summary><ul class="rows">${nav.closed.map(row).join('')}</ul>`,
    { sunk: true, tag: 'details', cls: 'lane bsec st-done', attrs: 'id="lane-closed" data-state="closed"' });
}

function errorsHtml(board) {
  if (!board.errors.length) return '';
  return frameHtml(`${headHtml('Read errors', countHtml(board.errors.length))}<ul class="errors">${board.errors.map((error) => `<li><code>${esc(error.folder)}</code> ${esc(error.message)}</li>`).join('')}</ul>`,
    { sunk: true, tag: 'section', cls: 'bsec', attrs: 'id="errors"' });
}

const HELP = [
  'Board',
  [['/'], 'Filter the tickets by their words'],
  [['1', '…', '6'], 'Show only one state. The same key shows all states again'],
  [['0'], 'Show all tickets'],
  [['j', 'k'], 'Go to the next or the previous ticket'],
  [['Enter'], 'Open the document of the ticket'],
  'Go',
  [['t'], 'Go to a ticket by its key or its words'],
  [['w'], 'Go to the wiki of the repository'],
  [['?'], 'Show this list'],
  [['Esc'], 'Close a dialog, or remove the filter text'],
];

/**
 * The self-contained HTML page of a board model. With serve.token, the links use the routes of the server of the page.
 * serve.live is the address of the session states on the live server (live-serve.mjs): then the page shows what each session does now.
 * serve.resume is the address on that server that continues a closed session: then a closed session has the Resume button.
 * serve.open is the command that starts that server again (the notice of a stopped server shows it), and serve.c is the change stamp of this board (live-stamp.mjs).
 * nav.closed (buildNav in ui.mjs) gives the closed tickets of the wiki.
 */
export function renderBoardPage(board, { links = 'vscode', nav = null, serve = null, wiki = '' } = {}) {
  if (!LINK_MODES.includes(links)) throw new Error(`Unknown link mode: ${links}. Use ${LINK_MODES.join(' or ')}.`);
  const token = serve?.token ?? '';
  if (token && !/^[0-9a-f]{32}$/.test(token)) throw new Error('The page token must have 32 hexadecimal characters.');
  const live = token && serve.live ? String(serve.live) : '';
  const resume = live && serve.resume ? String(serve.resume) : '';
  const ctx = { links, wiki, nav: nav ?? buildNav(board, { token }) };
  const chips = board.groups.map((group, index) => {
    const label = pageLabel(group.state, group.label);
    return chipHtml(label, group.state, group.tickets.length, { mark: group.emoji, disabled: !group.tickets.length, attrs: `data-state="${esc(group.state)}" title="Show only ${esc(label)} (${index + 1})"` });
  }).join('');
  // The tickets that wait for the user get the full width. The other open states stand side by side, and Done is a closed list at the end.
  const lane = (state) => laneHtml(board.groups.find((group) => group.state === state), board, ctx);
  const side = board.groups.filter((group) => !['needs-me', 'done'].includes(group.state)).map((group) => laneHtml(group, board, ctx)).join('');
  const first = frameHtml(emptyHtml(ctx.nav.closed?.length ? 'No open ticket.' : 'No tickets yet.', { icon: 'anvil-cold', steps: FIRST_STEPS }), { sunk: true, tag: 'section', cls: 'lane' });
  const lanes = board.total
    ? `${lane('needs-me')}${side ? `<div class="side">${side}</div>` : ''}${lane('done')}`
    : first;
  const open = token && typeof serve.open === 'string' ? serve.open : null;
  // The icons are in the data block, so the script swaps the tab icon of a live page without drawing anything (the needs count of the live answer).
  const data = {
    generated: board.generated, total: board.total, ...(token ? { token } : {}), ...(live ? { live } : {}), ...(resume ? { resume } : {}),
    ...(open !== null ? { open } : {}), ...(live && serve.c ? { c: String(serve.c) } : {}), ...(live ? { icons: { calm: faviconUri('calm'), needs: faviconUri('needs') } } : {}), nav: navData(ctx.nav),
  };
  // The tab says how many tickets need the user, and the icon has the hot spot when one does.
  const needing = board.groups.find((group) => group.state === 'needs-me')?.tickets.length ?? 0;
  const body = [
    `<header id="rail"><div class="bar"><h1>${brandHtml('FORGE', 'Forge board')}</h1>`
      + searchHtml({ id: 'filter', label: 'Filter the tickets', placeholder: 'Filter the tickets' })
      + `<div class="chips" role="group" aria-label="States">${chips}</div>`
      + `<div class="tools">${ctx.nav.wiki ? `<a class="quiet" href="${esc(ctx.nav.wiki)}" data-nav title="The wiki of the repository (w)">Wiki</a>` : ''}<button type="button" id="switch-open" title="Go to a ticket (t)">Go to a ticket</button>${TOOLS_HTML}</div></div></header>`,
    `<main id="lanes">${strikeHtml(board, ctx)}${bannerHtml('<span id="showing-text"></span>', { id: 'showing', hidden: true, live: false, actions: '<button type="button" id="show-all">Show all</button>' })}`,
    '<p class="sr" id="showing-live" role="status"></p>',
    lanes, live ? LIVE_HTML : '', waitsHtml(board), closedHtml(ctx.nav), errorsHtml(board), '</main>',
    footHtml(`Generated ${esc(board.generated)} by <code>forge.mjs board</code> from the ticket README files. This page is a view: change the ticket files, not this page.`,
      { note: live ? '<p class="note" id="live-note" aria-live="polite">Live view: no answer yet</p>' : '' }),
    switcherHtml(ctx.nav), helpHtml(HELP),
    '<div id="toast" role="status" hidden></div>',
  ].join('\n');
  return pageHtml({
    title: needing ? `(${needing}) Forge board` : 'Forge board', bodyClass: 'page-board', style: UI_STYLE + BOARD_STYLE, dataId: 'board-data', data, script: BOARD_SCRIPT,
    body, icon: needing ? 'needs' : 'calm', main: 'lanes',
  });
}

// The sessions that have no ticket on the board: the live sessions, then the sessions of the session list that are not live.
// Only a page of the live server has this part, and its script fills it.
const LIVE_HTML = frameHtml(`${headHtml('Other sessions', '<span class="count" id="live-count">0</span><small>without a ticket on this board</small>')}`
  + '<ul class="rows" id="live-list"></ul><ul class="rows" id="past-list"></ul>', { sunk: true, tag: 'section', cls: 'bsec', attrs: 'id="live-other" hidden' });

// The layout of the board. The look of a part (frame, chip, tag, count, banner, search, empty state, table, foot) is in the kit.
export const BOARD_STYLE = String.raw`
body { min-height: 100vh; display: flex; flex-direction: column; }
#rail { position: sticky; top: 0; }
.chips { display: flex; flex-wrap: wrap; gap: var(--s-1); }

/* The widest board: no token has this size. */
main { flex: 1; width: 100%; max-width: 1560px; margin: 0 auto; padding: var(--s-5) var(--s-5) var(--s-7); }
#strike, #showing { margin: 0 0 var(--s-4); }
.lane, .bsec { margin: 0 0 var(--s-5); }
.bhead { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); margin: 0 0 var(--s-3); font-size: var(--t-lg); line-height: 1.2; font-weight: 600; }
.bhead small { font-size: var(--t-sm); font-weight: 400; color: var(--muted); }
/* The narrowest card: no token has this size. */
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(310px, 100%), 1fr)); gap: var(--s-4); }
.side { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(310px, 100%), 1fr)); gap: var(--s-5) var(--s-4); align-items: start; margin: 0 0 var(--s-5); }
.side .lane { margin: 0; min-width: 0; }
.side .cards { grid-template-columns: minmax(0, 1fr); }
.side:not(:has(.lane:not([hidden]))) { display: none; }

.tcard { position: relative; display: flex; flex-direction: column; gap: var(--s-2); }
.tcard:hover { background: color-mix(in srgb, var(--st) 6%, var(--card)); }
.tcard:has(.open:focus-visible) { outline: var(--px) solid var(--accent); outline-offset: var(--s-1); }
.tcard > header { display: flex; justify-content: space-between; align-items: baseline; gap: var(--s-2); }
.tcard .key { color: var(--muted); }
.age { font-size: var(--t-xs); color: var(--muted); white-space: nowrap; }
.stale .age { color: var(--amber); font-weight: 600; }
.tcard h3 { margin: 0; font-size: var(--t-lg); font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
.open { color: inherit; text-decoration: none; }
.tcard .open::after { content: ""; position: absolute; inset: 0; }
.tcard .open:focus-visible { outline: none; }
.tline { margin: 0; }
.tnote { font-size: var(--t-sm); color: var(--muted); }
.tclamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.ttags { display: flex; flex-wrap: wrap; gap: var(--s-1); margin: 0; }
.tlinks { display: flex; flex-wrap: wrap; gap: var(--s-1) var(--s-3); margin-top: auto; font-size: var(--t-xs); }
.tlinks a { position: relative; z-index: 1; color: var(--muted); }
.tlinks a:hover { color: var(--accent); }
.tcard .live { position: relative; z-index: 1; pointer-events: none; }
.tcard .live button { pointer-events: auto; }
#live-list:empty, #past-list:empty { display: none; }
.lrow { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s-1) var(--s-3); padding: var(--s-2) var(--s-3); }
.lrow + .lrow { border-top: 1px solid var(--line); }
/* The sizes that a row wraps at: no token has them. A hairline between two rows is 1px, as in a table of the kit. */
.lrow .what { flex: 1 1 220px; min-width: 0; overflow-wrap: anywhere; }
.lrow .key { color: var(--muted); }
.lrow .live { flex: 2 1 320px; }

details.lane > summary { display: flex; align-items: center; gap: var(--s-2); list-style: none; cursor: pointer; }
details.lane > summary::-webkit-details-marker { display: none; }
details.lane > summary::before { content: "\25B8"; width: var(--s-4); color: var(--muted); }
details.lane[open] > summary::before { content: "\25BE"; }
details.lane > summary h2 { margin: 0; }
.rows { list-style: none; margin: var(--s-3) 0 0; padding: 0; background: var(--card); border: 1px solid var(--line); }
.trow { display: flex; align-items: baseline; gap: var(--s-3); padding: var(--s-2) var(--s-3); }
.trow + .trow { border-top: 1px solid var(--line); }
.trow .key { flex: none; min-width: 9ch; color: var(--muted); }
.trow .open { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trow .open:hover { color: var(--accent); text-decoration: underline; }
.errors { margin: 0; padding-left: var(--s-5); font-size: var(--t-sm); }
.errors li { margin: var(--s-1) 0; }
@media (max-width: ${BREAK.narrow}px) { main { padding: var(--s-3); } }
`;

export const BOARD_SCRIPT = pageScript('board-data', String.raw`  var filter = byId('filter');
  var chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
  var items = Array.prototype.slice.call(document.querySelectorAll('.tcard, .trow'));
  // The lists that open and close: the Done lane and the closed tickets. The browser keeps the choice of the user for each one.
  var folds = Array.prototype.slice.call(document.querySelectorAll('details.lane')).map(function (lane) {
    var name = 'forge-board:' + lane.getAttribute('data-state');
    var open = false;
    try { open = localStorage.getItem(name) === 'open'; } catch (error) { open = false; }
    return { lane: lane, name: name, open: open };
  });
  var forced = false;

  function pressed() {
    return chips.filter(function (chip) { return chip.getAttribute('aria-pressed') === 'true'; }).map(function (chip) { return chip.getAttribute('data-state'); });
  }

  // The filter hides tickets. It never changes the order, and a lane without a shown ticket goes away.
  function applyFilter() {
    var words = filter.value.toLowerCase().split(/\s+/).filter(Boolean);
    var only = pressed();
    var active = words.length > 0 || only.length > 0;
    var shown = 0;
    items.forEach(function (item) {
      var text = item.getAttribute('data-text') || '';
      var ok = (!only.length || only.indexOf(item.getAttribute('data-state')) >= 0) && words.every(function (word) { return text.indexOf(word) >= 0; });
      item.hidden = !ok;
      if (ok) shown += 1;
    });
    each(document.querySelectorAll('.lane[data-state]'), function (lane) {
      lane.hidden = active && !lane.querySelector('.tcard:not([hidden]), .trow:not([hidden])');
    });
    forced = true;
    folds.forEach(function (fold) { fold.lane.open = active ? !fold.lane.hidden : fold.open; });
    forced = false;
    byId('showing').hidden = !active;
    var notice = shown ? 'The filter shows ' + shown + ' of ' + items.length + ' tickets.' : 'No ticket agrees with the filter.';
    byId('showing-text').textContent = notice;
    // The banner starts hidden, so a screen reader does not read it. The live region next to it has the same words.
    byId('showing-live').textContent = active ? notice : '';
  }

  function showAll() {
    filter.value = '';
    chips.forEach(function (chip) { chip.setAttribute('aria-pressed', 'false'); });
    applyFilter();
  }

  function toggleChip(chip) {
    if (!chip || chip.disabled) return;
    var on = chip.getAttribute('aria-pressed') === 'true';
    chips.forEach(function (other) { other.setAttribute('aria-pressed', 'false'); });
    chip.setAttribute('aria-pressed', on ? 'false' : 'true');
    applyFilter();
  }

  filter.addEventListener('input', applyFilter);
  filter.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (filter.value) { filter.value = ''; applyFilter(); } else filter.blur();
    event.preventDefault();
  });
  chips.forEach(function (chip) { chip.addEventListener('click', function () { toggleChip(chip); }); });
  byId('show-all').addEventListener('click', showAll);
  folds.forEach(function (fold) {
    fold.lane.addEventListener('toggle', function () {
      if (forced || !byId('showing').hidden) return;
      fold.open = fold.lane.open;
      try { localStorage.setItem(fold.name, fold.open ? 'open' : 'closed'); } catch (error) { /* The storage is off: the list still opens. */ }
    });
  });

  function step(by) {
    var links = Array.prototype.slice.call(document.querySelectorAll('.tcard:not([hidden]) .open, .trow:not([hidden]) .open')).filter(function (link) { return link.offsetParent !== null; });
    if (!links.length) return;
    var at = links.indexOf(document.activeElement);
    var next = links[at < 0 ? (by > 0 ? 0 : links.length - 1) : Math.min(links.length - 1, Math.max(0, at + by))];
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
  }

  document.addEventListener('keydown', function (event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || typing(event) || modalOpen()) return;
    if (event.key === '/') filter.focus();
    else if (event.key === '0') showAll();
    else if (/^[1-9]$/.test(event.key) && chips[Number(event.key) - 1]) toggleChip(chips[Number(event.key) - 1]);
    else if (event.key === 'j') step(1);
    else if (event.key === 'k') step(-1);
    else return;
    event.preventDefault();
  });

  // The live view: a session shows on the card of its ticket. A session without a card shows in the list of the other sessions.
  // A session of the session list that is not live shows with its buttons: the newest one on the card of its ticket, when no live
  // session is on that card, and each one without a card in the list of the other sessions.
  var pastShown = null;
  function showPast(items, busy) {
    var onCard = {};
    var rows = [];
    items.forEach(function (item) {
      var card = item.ticket ? byId('ticket-' + item.ticket) : null;
      if (!card || !card.classList.contains('tcard')) rows.push(item);
      else if (!busy[item.ticket] && !onCard[item.ticket]) onCard[item.ticket] = item;
    });
    var cards = Object.keys(onCard).map(function (ticket) { return onCard[ticket]; });
    var mark = pastMark(cards) + '\n\n' + pastMark(rows);
    if (mark === pastShown) return rows.length;
    pastShown = mark;
    each(document.querySelectorAll('.tcard > .past'), function (old) { old.parentNode.removeChild(old); });
    cards.forEach(function (item) {
      var card = byId('ticket-' + item.ticket);
      card.insertBefore(pastLine(item), card.querySelector('.ttags'));
    });
    var list = byId('past-list');
    while (list.firstChild) list.removeChild(list.firstChild);
    rows.forEach(function (item) {
      var card = item.ticket ? byId('ticket-' + item.ticket) : null;
      var row = make('li', 'lrow');
      row.appendChild(make('span', 'key', card ? card.querySelector('.key').textContent : item.name));
      row.appendChild(make('span', 'what', item.label || 'A session without a title'));
      row.appendChild(pastLine(item, true));
      list.appendChild(row);
    });
    return rows.length;
  }
  function showLive(state, ok) {
    each(document.querySelectorAll('.tcard > .live:not(.past)'), function (old) { old.parentNode.removeChild(old); });
    var list = byId('live-list');
    while (list.firstChild) list.removeChild(list.firstChild);
    var sessions = state ? state.sessions : [];
    var other = 0;
    var busy = {};
    sessions.forEach(function (session) {
      var card = session.ticket ? byId('ticket-' + session.ticket) : null;
      if (card && card.classList.contains('tcard')) { busy[session.ticket] = true; card.insertBefore(liveLine(session), card.querySelector('.ttags')); return; }
      var row = make('li', 'lrow');
      row.appendChild(make('span', 'key', card ? card.querySelector('.key').textContent : session.host));
      row.appendChild(make('span', 'what', session.title || session.dir || 'A session without a title'));
      row.appendChild(liveLine(session));
      list.appendChild(row);
      other += 1;
    });
    other += showPast(state && state.past ? state.past : [], busy);
    byId('live-other').hidden = !other;
    byId('live-count').textContent = String(other);
    // The tab says how many tickets and sessions need the user, and its icon has the hot spot when one does.
    if (ok && state && typeof state.needs === 'number') {
      document.title = state.needs ? '(' + state.needs + ') Forge board' : 'Forge board';
      setIcon(state.needs > 0);
    }
    byId('live-note').textContent = !ok ? 'Live view: the live server does not answer'
      : sessions.length === 1 ? 'Live view: 1 session' : 'Live view: ' + sessions.length + ' sessions';
  }
  liveStart(showLive);

  applyFilter();
`);
