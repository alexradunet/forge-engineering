// The board page: <forge>/raw/board.html. One page for all tickets of the wiki: one lane for each state,
// the tickets that wait for the user first, a link from each ticket to its canvas, and the closed tickets with a link to their summary page in the wiki.
// It shows the model of board.mjs (the same data as raw/board.md). It loads nothing from a network, and it is never a source.
// The style and the components come from ui.mjs. The script uses no template literals: it sits in one.
import path from 'node:path';
import { WAIT_WORKDAYS } from './board.mjs';
import { LINK_MODES, linkTarget } from './canvas.mjs';
import { rawDir } from './layout.mjs';
import { GATE_TEXT, TOOLS_HTML, UI_SCRIPT, UI_STYLE, buildNav, esc, gateLine, helpHtml, navData, switcherHtml } from './ui.mjs';

export const BOARD_PAGE = 'board.html';
// An open ticket without an update for this number of days gets a mark.
export const STALE_DAYS = 7;

// The part of the canvas that shows the document of a gate.
const GATE_ZONE = { 'story.md': 'story', 'plan.md': 'plan', 'review.md': 'review', 'close.md': 'close' };

/** The link to the canvas of a ticket. A full-v3 ticket with a gate in review opens at the document of that gate. */
function canvasHref(item, ctx) {
  const href = ctx.nav.tickets.find((ticket) => ticket.folder === item.folder)?.href ?? '';
  const doc = item.workflow === 'full-v3' && item.openGate?.status === 'in-review' ? item.gates.find((gate) => gate.name === item.openGate.name)?.doc : '';
  return href && GATE_ZONE[doc] && !/README\.md/.test(href) ? `${href}#zone-${GATE_ZONE[doc]}` : href;
}

const age = (days) => (days === null ? '' : days <= 0 ? 'today' : days === 1 ? '1 day' : `${days} days`);
const external = (url, label) => {
  const href = linkTarget(url);
  return /^https?:/i.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : '';
};

function dots(gates) {
  if (!gates.length) return '';
  return `<span class="dots">${gates.map((gate) => `<i class="d-${esc(gate.status)}" title="${esc(`${gate.name} ${GATE_TEXT[gate.status] ?? gate.status}`)}"></i>`).join('')}</span>`;
}

function tags(item) {
  const tag = (text, cls = '') => `<span class="tag${cls ? ` ${cls}` : ''}">${esc(text)}</span>`;
  const out = [tag(item.phase)];
  if (item.sync?.pr) out.push(tag(`PR ${item.sync.pr}`));
  else for (const change of item.changes) out.push(tag(`${change.label || 'PR'} ${change.state}`));
  if (item.sync?.ci) out.push(tag(`CI ${item.sync.ci}`, /\b(green|pass|passed|success)\b/i.test(item.sync.ci) ? 'ok' : /\b(red|fail|failed|failure|broken)\b/i.test(item.sync.ci) ? 'bad' : ''));
  if (item.sync?.tracker) out.push(tag(`Tracker ${item.sync.tracker}`));
  for (const wait of item.waits) out.push(tag(`⏳ ${wait.name}, ${wait.workdays} working days`, 'wait'));
  return out.join('');
}

function searchText(item, label) {
  return [item.key, item.title, item.short, item.next, item.waitingOn, item.phase, label, ...item.waits.map((wait) => wait.name)].join(' ').toLowerCase();
}

function cardHtml(item, label, ctx) {
  const href = canvasHref(item, ctx);
  const stale = item.state !== 'done' && item.days !== null && item.days >= STALE_DAYS;
  const gate = gateLine(item) || (item.gates.length && item.gates.every((one) => ['approved', 'skipped'].includes(one.status)) ? 'All gates approved' : '');
  const links = [];
  const readme = ctx.links === 'vscode' && ctx.wiki
    ? linkTarget(path.join(rawDir(ctx.wiki), 'tickets', item.folder, 'README.md'))
    : ctx.nav.file(item.folder, 'README.md');
  links.push(`<a href="${esc(readme)}">README</a>`);
  const worktree = ctx.links === 'vscode' && item.worktree ? linkTarget(item.worktree) : '';
  if (worktree.startsWith('vscode://')) links.push(`<a href="${esc(worktree)}" title="${esc(item.worktree)}">Worktree</a>`);
  for (const change of item.changes) links.push(external(change.url, change.label || 'Change'));
  return `<article class="tcard st-${esc(item.state)}${stale ? ' stale' : ''}" id="ticket-${esc(item.folder)}" data-state="${esc(item.state)}" data-text="${esc(searchText(item, label))}">`
    + `<header><span class="key">${esc(item.key)}</span><span class="age"${stale ? ` title="No update for ${item.days} days"` : ''}>${age(item.days)}</span></header>`
    + `<h3><a class="open" href="${esc(href)}" data-nav title="${esc(item.title)}">${esc(item.short || item.title)}</a></h3>`
    + (gate || item.gates.length ? `<p class="gate${item.openGate ? ` g-${esc(item.openGate.status)}` : ''}">${dots(item.gates)}<span>${esc(gate)}</span></p>` : '')
    + (item.next ? `<p class="line"><span>Next</span> ${esc(item.next)}</p>` : '')
    + (item.waitingOn ? `<p class="line"><span>Waiting on</span> ${esc(item.waitingOn)}</p>` : '')
    + `<p class="tags">${tags(item)}</p>`
    + `<footer>${links.filter(Boolean).join('')}</footer></article>`;
}

function rowHtml(item, label, ctx) {
  const href = canvasHref(item, ctx);
  return `<li class="trow" id="ticket-${esc(item.folder)}" data-state="${esc(item.state)}" data-text="${esc(searchText(item, label))}"><span class="key">${esc(item.key)}</span>`
    + `<a class="open" href="${esc(href)}" data-nav title="${esc(item.title)}">${esc(item.short || item.title)}</a><span class="age">${age(item.days)}</span></li>`;
}

function laneHtml(group, board, ctx) {
  const head = `<h2><span aria-hidden="true">${group.emoji}</span> ${esc(group.label)} <span class="count">${group.tickets.length}</span></h2>`;
  const open = `class="lane st-${esc(group.state)}" id="lane-${esc(group.state)}" data-state="${esc(group.state)}"`;
  if (!group.tickets.length) {
    // The first lane stays on the page: an empty lane is the answer to "does a ticket wait for me?".
    return group.state === 'needs-me' && board.total ? `<section ${open}>${head}<p class="empty">No ticket waits for you.</p></section>` : '';
  }
  if (group.state === 'done') return `<details ${open}><summary>${head}</summary><ul class="rows">${group.tickets.map((item) => rowHtml(item, group.label, ctx)).join('')}</ul></details>`;
  return `<section ${open}>${head}<div class="cards">${group.tickets.map((item) => cardHtml(item, group.label, ctx)).join('')}</div></section>`;
}

function waitsHtml(board) {
  const waits = board.groups.flatMap((group) => group.tickets.flatMap((item) => item.waits.map((wait) => ({ key: item.key, ...wait }))));
  if (!waits.length) return '';
  const row = (wait) => `<tr><td class="key">${esc(wait.key)}</td><td>${esc(wait.name)}</td><td>${esc(wait.role)}</td><td>${esc(wait.ask)}</td><td>${esc(wait.since)}</td><td>${wait.workdays}</td></tr>`;
  return `<section class="lane plain" id="waits"><h2>People waits <small>more than ${WAIT_WORKDAYS} working days</small></h2>`
    + `<table><thead><tr><th>Ticket</th><th>Person</th><th>Role</th><th>Ask</th><th>Since</th><th>Working days</th></tr></thead><tbody>${waits.map(row).join('')}</tbody></table></section>`;
}

// A closed ticket has no folder on the board: its summary page is in the wiki (tickets/<key>.md), and the wiki page shows it.
function closedHtml(nav) {
  if (!nav.closed?.length) return '';
  const row = (item) => `<li class="trow" data-state="closed" data-text="${esc([item.key, item.title, 'closed'].join(' ').toLowerCase())}"><span class="key">${esc(item.key)}</span>`
    + `<a class="open" href="${esc(item.href)}" data-nav title="${esc(item.title)}">${esc(item.title)}</a><span class="age">${esc(item.updated)}</span></li>`;
  return `<details class="lane plain st-done" id="lane-closed" data-state="closed"><summary><h2>Closed tickets <span class="count">${nav.closed.length}</span> <small>their summary pages in the wiki</small></h2></summary>`
    + `<ul class="rows">${nav.closed.map(row).join('')}</ul></details>`;
}

function errorsHtml(board) {
  if (!board.errors.length) return '';
  return `<section class="lane plain" id="errors"><h2>Read errors <span class="count">${board.errors.length}</span></h2>`
    + `<ul class="errors">${board.errors.map((error) => `<li><code>${esc(error.folder)}</code> ${esc(error.message)}</li>`).join('')}</ul></section>`;
}

const HELP = [
  'Board',
  [['/'], 'Filter the tickets by their words'],
  [['1', '…', '6'], 'Show only one state. The same key shows all states again'],
  [['0'], 'Show all tickets'],
  [['j', 'k'], 'Go to the next or the previous ticket'],
  [['Enter'], 'Open the canvas of the ticket'],
  'Go',
  [['t'], 'Go to a ticket by its key or its words'],
  [['w'], 'Go to the wiki of the repository'],
  [['?'], 'Show this list'],
  [['Esc'], 'Close a dialog, or remove the filter text'],
];

/**
 * The self-contained HTML page of a board model. With serve.token, the links use the routes of the server of the page.
 * serve.live is the address of the session states on the live server (live-serve.mjs): then the page shows what each session does now.
 * nav.closed (buildNav in ui.mjs) gives the closed tickets of the wiki.
 */
export function renderBoardPage(board, { links = 'vscode', nav = null, serve = null, wiki = '' } = {}) {
  if (!LINK_MODES.includes(links)) throw new Error(`Unknown link mode: ${links}. Use ${LINK_MODES.join(' or ')}.`);
  const token = serve?.token ?? '';
  if (token && !/^[0-9a-f]{32}$/.test(token)) throw new Error('The canvas token must have 32 hexadecimal characters.');
  const live = token && serve.live ? String(serve.live) : '';
  const ctx = { links, wiki, nav: nav ?? buildNav(board, { token }) };
  const chips = board.groups.map((group, index) => (
    `<button type="button" class="chip st-${esc(group.state)}" data-state="${esc(group.state)}" aria-pressed="false" title="Show only ${esc(group.label)} (${index + 1})"${group.tickets.length ? '' : ' disabled'}>`
    + `<span aria-hidden="true">${group.emoji}</span> ${esc(group.label)} <b>${group.tickets.length}</b></button>`
  )).join('');
  // The tickets that wait for the user get the full width. The other open states stand side by side, and Done is a closed list at the end.
  const lane = (state) => laneHtml(board.groups.find((group) => group.state === state), board, ctx);
  const side = board.groups.filter((group) => !['needs-me', 'done'].includes(group.state)).map((group) => laneHtml(group, board, ctx)).join('');
  const lanes = board.total
    ? `${lane('needs-me')}${side ? `<div class="side">${side}</div>` : ''}${lane('done')}`
    : `<section class="lane"><p class="empty">${ctx.nav.closed?.length ? 'No open ticket.' : 'No tickets yet.'} Give a work item key to a session, and its ticket shows here.</p></section>`;
  const data = JSON.stringify({ generated: board.generated, total: board.total, ...(token ? { token } : {}), ...(live ? { live } : {}), nav: navData(ctx.nav) }).replace(/</g, '\\u003c');
  return [
    '<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Forge board</title>',
    `<style>${UI_STYLE}${BOARD_STYLE}</style>`, '</head>', '<body class="page-board">',
    '<header id="rail" class="bar"><h1>Forge board</h1>'
      + '<label class="search"><span class="sr">Filter the tickets</span><input type="search" id="filter" placeholder="Filter the tickets" autocomplete="off" spellcheck="false"><kbd>/</kbd></label>'
      + `<div class="chips" role="group" aria-label="States">${chips}</div>`
      + `<div class="tools">${ctx.nav.wiki ? `<a class="quiet" href="${esc(ctx.nav.wiki)}" data-nav title="The wiki of the repository (w)">Wiki</a>` : ''}<button type="button" id="switch-open" title="Go to a ticket (t)">Go to a ticket</button>${TOOLS_HTML}</div></header>`,
    '<main id="lanes"><p class="banner" id="showing" hidden><span id="showing-text"></span> <button type="button" id="show-all">Show all</button></p>',
    lanes, live ? LIVE_HTML : '', waitsHtml(board), closedHtml(ctx.nav), errorsHtml(board), '</main>',
    `<footer id="foot">${live ? '<p class="note" id="live-note">Live view: no answer yet</p>' : ''}<p>Generated ${esc(board.generated)} by <code>forge.mjs board</code> from the ticket README files. This page is a view: change the ticket files, not this page.</p></footer>`,
    switcherHtml(ctx.nav), helpHtml(HELP),
    '<div id="toast" role="status" hidden></div>',
    `<script type="application/json" id="board-data">${data}</script>`,
    `<script>${BOARD_SCRIPT}</script>`, '</body>', '</html>', '',
  ].join('\n');
}

// The sessions that have no ticket on the board. Only a page of the live server has this part, and its script fills it.
const LIVE_HTML = '<section class="lane plain" id="live-other" hidden><h2>Other sessions <span class="count" id="live-count">0</span> <small>live, without a ticket on this board</small></h2>'
  + '<ul class="rows" id="live-list"></ul></section>';

export const BOARD_STYLE = String.raw`
body { min-height: 100vh; display: flex; flex-direction: column; }
#rail { position: sticky; top: 0; }
.search { display: flex; align-items: center; gap: 6px; padding: 2px 8px; background: var(--card); border: 1px solid var(--line); border-radius: var(--r-1); }
.search:focus-within { border-color: var(--accent); }
.search input { width: 190px; font: inherit; color: inherit; background: transparent; border: 0; outline: none; }
.chips { display: flex; flex-wrap: wrap; gap: var(--s-1); }
.chip { padding: 2px 10px; font-size: var(--t-sm); white-space: nowrap; border-radius: var(--r-pill); }
.chip b { margin-left: 3px; }
.chip[aria-pressed="true"] { border-color: var(--st); background: color-mix(in srgb, var(--st) 20%, var(--card)); }

main { flex: 1; width: 100%; max-width: 1560px; margin: 0 auto; padding: var(--s-5) var(--s-5) var(--s-7); }
.banner { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); margin: 0 0 var(--s-4); padding: 6px var(--s-3); font-size: var(--t-sm); background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-2); }
.lane { margin: 0 0 var(--s-6); }
.lane h2 { display: flex; align-items: center; gap: var(--s-2); margin: 0 0 var(--s-3); font-size: var(--t-xl); line-height: 1.2; }
.count { padding: 0 8px; font-size: var(--t-sm); font-weight: 600; color: var(--muted); background: var(--card); border: 1px solid var(--line); border-radius: var(--r-pill); }
.lane.st-needs-me { padding: var(--s-4); background: color-mix(in srgb, var(--amber) 8%, var(--panel)); border: 1px solid color-mix(in srgb, var(--amber) 45%, var(--line)); border-radius: var(--r-3); }
.empty { margin: 0; color: var(--muted); }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(310px, 100%), 1fr)); gap: var(--s-3); }
.side { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(310px, 100%), 1fr)); gap: var(--s-5) var(--s-4); align-items: start; margin: 0 0 var(--s-6); }
.side .lane { margin: 0; min-width: 0; }
.side .cards { grid-template-columns: minmax(0, 1fr); }
.side:not(:has(.lane:not([hidden]))) { display: none; }

.tcard { position: relative; display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: var(--s-3) 14px; background: var(--card); border: 1px solid var(--line); border-left: 4px solid var(--st); border-radius: var(--r-2); box-shadow: var(--sh-1); }
.tcard:hover { border-color: var(--line-2); border-left-color: var(--st); }
.tcard:has(.open:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.tcard header { display: flex; justify-content: space-between; align-items: baseline; gap: var(--s-2); }
.tcard .key { color: var(--muted); }
.age { font-size: var(--t-xs); color: var(--muted); white-space: nowrap; }
.stale .age { color: var(--amber); font-weight: 600; }
.tcard h3 { margin: 0; font-size: var(--t-lg); font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
.open { color: inherit; text-decoration: none; }
.tcard .open::after { content: ""; position: absolute; inset: 0; border-radius: inherit; }
.tcard .open:focus-visible { outline: none; }
.tcard p { margin: 0; }
.gate { display: flex; align-items: center; gap: var(--s-2); min-height: 22px; font-size: var(--t-sm); color: var(--muted); }
.gate.g-in-review { color: var(--ink); font-weight: 600; }
.gate.g-blocked { color: var(--red); font-weight: 600; }
.dots { position: relative; z-index: 1; display: inline-flex; align-items: center; flex: none; }
.dots i { position: relative; width: 11px; height: 11px; background: var(--card); border: 2px solid var(--line-2); border-radius: 50%; }
.dots i + i { margin-left: 10px; }
.dots i + i::before { content: ""; position: absolute; right: calc(100% + 2px); top: 50%; width: 10px; border-top: 2px solid var(--line-2); transform: translateY(-50%); }
.dots .d-approved { background: var(--green); border-color: var(--green); }
.dots .d-approved + i::before { border-color: var(--green); }
.dots .d-in-review { background: var(--amber); border-color: var(--amber); box-shadow: 0 0 0 3px color-mix(in srgb, var(--amber) 30%, transparent); }
.dots .d-blocked { background: var(--red); border-color: var(--red); }
.dots .d-skipped { border-style: dotted; }
.line { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.line span { margin-right: 2px; font-size: var(--t-sm); color: var(--muted); }
.tags { display: flex; flex-wrap: wrap; gap: var(--s-1); padding-top: 2px; }
.tag { max-width: 100%; padding: 0 7px; font-size: var(--t-xs); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border: 1px solid var(--line); border-radius: var(--r-pill); }
.tag.ok { color: var(--green); border-color: color-mix(in srgb, var(--green) 55%, var(--line)); }
.tag.bad { color: var(--red); border-color: color-mix(in srgb, var(--red) 55%, var(--line)); }
.tag.wait { color: var(--amber); border-color: color-mix(in srgb, var(--amber) 55%, var(--line)); }
.tcard footer { display: flex; flex-wrap: wrap; gap: 2px var(--s-3); margin-top: auto; padding-top: 4px; font-size: var(--t-xs); }
.tcard footer a { position: relative; z-index: 1; color: var(--muted); }
.tcard footer a:hover { color: var(--accent); }
.tcard .live { position: relative; z-index: 1; pointer-events: none; }
.lrow { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px var(--s-3); padding: 6px 14px; }
.lrow + .lrow { border-top: 1px solid var(--line); }
.lrow .what { flex: 1 1 220px; min-width: 0; overflow-wrap: anywhere; }
.lrow .key { color: var(--muted); }
.lrow .live { flex: 2 1 320px; }

details.lane > summary { display: flex; align-items: center; gap: var(--s-2); list-style: none; cursor: pointer; }
details.lane > summary::-webkit-details-marker { display: none; }
details.lane > summary::before { content: "\25B8"; width: 14px; color: var(--muted); }
details.lane[open] > summary::before { content: "\25BE"; }
details.lane > summary h2 { margin: 0; }
.rows { list-style: none; margin: var(--s-3) 0 0; padding: 0; background: var(--card); border: 1px solid var(--line); border-radius: var(--r-2); }
.trow { display: flex; align-items: baseline; gap: var(--s-3); padding: 6px 14px; }
.trow + .trow { border-top: 1px solid var(--line); }
.trow .key { flex: none; min-width: 72px; color: var(--muted); }
.trow .open { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trow .open:hover { color: var(--accent); text-decoration: underline; }
.lane.plain h2 { font-size: var(--t-lg); }
.lane.plain h2 small { font-size: var(--t-sm); font-weight: 400; color: var(--muted); }
table { border-collapse: collapse; font-size: var(--t-sm); background: var(--card); }
th, td { padding: 4px 10px; text-align: left; vertical-align: top; border: 1px solid var(--line); }
th { font-weight: 600; color: var(--muted); }
.errors { margin: 0; padding-left: 20px; font-size: var(--t-sm); }
.errors li { margin: 3px 0; }
@media (max-width: 640px) { main { padding: var(--s-3); } .search input { width: 120px; } }
`;

export const BOARD_SCRIPT = String.raw`
(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('board-data').textContent);
${UI_SCRIPT}
  var filter = byId('filter');
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
    byId('showing-text').textContent = shown ? 'The filter shows ' + shown + ' of ' + items.length + ' tickets.' : 'No ticket agrees with the filter.';
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
  function showLive(state, ok) {
    each(document.querySelectorAll('.tcard > .live'), function (old) { old.parentNode.removeChild(old); });
    var list = byId('live-list');
    while (list.firstChild) list.removeChild(list.firstChild);
    var sessions = state ? state.sessions : [];
    var other = 0;
    sessions.forEach(function (session) {
      var card = session.ticket ? byId('ticket-' + session.ticket) : null;
      if (card && card.classList.contains('tcard')) { card.insertBefore(liveLine(session), card.querySelector('.tags')); return; }
      var row = make('li', 'lrow');
      row.appendChild(make('span', 'key', card ? card.querySelector('.key').textContent : session.host));
      row.appendChild(make('span', 'what', session.title || session.dir || 'A session without a title'));
      row.appendChild(liveLine(session));
      list.appendChild(row);
      other += 1;
    });
    byId('live-other').hidden = !other;
    byId('live-count').textContent = String(other);
    byId('live-note').textContent = !ok ? 'Live view: the live server does not answer'
      : sessions.length === 1 ? 'Live view: 1 session' : 'Live view: ' + sessions.length + ' sessions';
  }
  liveStart(showLive);

  applyFilter();
})();
`;
