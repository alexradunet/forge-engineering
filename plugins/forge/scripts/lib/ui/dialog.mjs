// The dialogs: the ticket switcher (a filter, the arrow keys, and Enter) and the help dialog (keys and mouse).
import { client, esc } from './kit.mjs';

const CSS = String.raw`
dialog { color: var(--ink); background: var(--rail); border: var(--px) solid var(--shade); box-shadow: var(--sh-2); padding: 0; max-width: calc(100vw - 24px); }
dialog::backdrop { background: rgba(0, 0, 0, 0.34); }
#switcher { width: 580px; max-height: min(76vh, 640px); margin-top: 9vh; overflow: hidden; }
#switcher[open] { display: flex; flex-direction: column; }
#switch-q { flex: none; width: 100%; padding: 13px 16px; font: inherit; color: inherit; background: transparent; border: 0; border-bottom: 1px solid var(--line); outline: none; }
#switch-q:focus-visible { outline: 2px solid var(--accent); outline-offset: -4px; }
#switch-list { flex: 1 1 auto; list-style: none; margin: 0; padding: 6px; overflow: auto; }
#switch-list .group { padding: 10px 10px 2px; font-size: var(--t-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
#switch-list a { display: flex; gap: 12px; align-items: baseline; padding: 6px 10px; color: inherit; text-decoration: none; }
#switch-list a:hover { background: color-mix(in srgb, var(--muted) 12%, transparent); }
#switch-list a.on { background: color-mix(in srgb, var(--accent) 18%, transparent); }
#switch-list .key { flex: none; min-width: 64px; }
#switch-list .what { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#switch-list small, #switcher .none { color: var(--muted); white-space: nowrap; }
#switcher .none { margin: 0; padding: 14px 16px; }
#switcher footer { flex: none; display: flex; gap: 16px; padding: 7px 16px; font-size: var(--t-xs); color: var(--muted); border-top: 1px solid var(--line); }
#help { width: 560px; padding: 18px 22px; }
#help h2 { margin: 0 0 10px; font-size: var(--t-lg); }
#help dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0 0 14px; }
#help dt.group { grid-column: 1 / -1; margin-top: 8px; font-size: var(--t-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
#help dd { margin: 0; }
#help p { margin: 0; text-align: right; }
`.trim();

/** The ticket switcher: one dialog with a filter, each ticket of the board in board order, and then the closed tickets of the wiki. */
export function switcherHtml(nav) {
  if (!nav) return '';
  const rows = [];
  if (nav.board) rows.push(`<li><a href="${esc(nav.board)}" data-nav data-text="board all tickets"><span class="key">Board</span><span class="what">All tickets</span><small><kbd>b</kbd></small></a></li>`);
  if (nav.wiki) rows.push(`<li><a href="${esc(nav.wiki)}" data-nav data-text="wiki all pages"><span class="key">Wiki</span><span class="what">All pages</span><small><kbd>w</kbd></small></a></li>`);
  let state = '';
  for (const item of nav.tickets) {
    if (item.state !== state) { state = item.state; rows.push(`<li class="group">${item.emoji ?? ''} ${esc(item.label)}</li>`); }
    const text = [item.key, item.title, item.label, item.phase, item.gate].join(' ').toLowerCase();
    rows.push(`<li><a href="${esc(item.href)}" data-nav data-text="${esc(text)}">`
      + `<span class="key">${esc(item.key)}</span><span class="what">${esc(item.title)}</span><small>${esc(item.gate || item.phase)}</small></a></li>`);
  }
  // A closed ticket has no folder on the board: its link goes to its summary page in the wiki. A link inside the wiki page changes only the page that shows.
  if (nav.closed?.length) rows.push('<li class="group">Closed</li>');
  for (const item of nav.closed ?? []) {
    rows.push(`<li><a href="${esc(item.href)}"${item.href.startsWith('#') ? '' : ' data-nav'} data-text="${esc([item.key, item.title, 'closed'].join(' ').toLowerCase())}">`
      + `<span class="key">${esc(item.key)}</span><span class="what">${esc(item.title)}</span><small>${esc(item.updated ? `closed ${item.updated}` : 'closed')}</small></a></li>`);
  }
  return '<dialog id="switcher" aria-label="Go to a ticket">'
    + '<input type="search" id="switch-q" placeholder="Go to a ticket: type a key or some words" autocomplete="off" spellcheck="false" aria-label="Filter the tickets">'
    + `<ul id="switch-list">${rows.join('')}</ul>`
    + `<p class="none" id="switch-none" hidden>${nav.tickets.length || nav.closed?.length ? 'No ticket has these words.' : 'No tickets yet.'}</p>`
    + '<footer><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></footer></dialog>';
}

/** The help dialog. Each row is [keys, text], and a row with one string is a group title. */
export function helpHtml(rows) {
  const body = rows.map((row) => (typeof row === 'string'
    ? `<dt class="group">${esc(row)}</dt>`
    : `<dt>${row[0].map((key) => `<kbd>${esc(key)}</kbd>`).join(' ')}</dt><dd>${esc(row[1])}</dd>`)).join('');
  return `<dialog id="help" aria-labelledby="help-title"><h2 id="help-title">Keys and mouse</h2><dl>${body}</dl>`
    + '<p><button type="button" data-close>Close</button></p></dialog>';
}

const switcher = client(function () {
  // The ticket switcher: a filter, the arrow keys, and Enter.
  var switcher = byId('switcher');
  function switchLinks(onlyShown) {
    var links = Array.prototype.slice.call(switcher.querySelectorAll('a'));
    return onlyShown ? links.filter(function (link) { return !link.parentNode.hidden; }) : links;
  }
  function markLink(link) {
    each(switcher.querySelectorAll('a.on'), function (old) { old.classList.remove('on'); });
    if (link) { link.classList.add('on'); link.scrollIntoView({ block: 'nearest' }); }
  }
  function filterSwitcher() {
    var words = byId('switch-q').value.toLowerCase().split(/\s+/).filter(Boolean);
    switchLinks(false).forEach(function (link) {
      var text = link.getAttribute('data-text') || '';
      link.parentNode.hidden = !words.every(function (word) { return text.indexOf(word) >= 0; });
    });
    var group = null, any = false;
    each(switcher.querySelectorAll('li'), function (item) {
      if (item.className === 'group') { if (group) group.hidden = !any; group = item; any = false; }
      else if (!item.hidden) any = true;
    });
    if (group) group.hidden = !any;
    var links = switchLinks(true);
    byId('switch-none').hidden = links.length > 0;
    markLink(links[0]);
  }
  function openSwitcher() {
    if (!switcher || switcher.open) return;
    byId('switch-q').value = '';
    switcher.showModal();
    filterSwitcher();
    byId('switch-q').focus();
  }
  if (switcher) {
    byId('switch-q').addEventListener('input', filterSwitcher);
    switcher.addEventListener('keydown', function (event) {
      var links = switchLinks(true);
      var at = links.indexOf(switcher.querySelector('a.on'));
      if (event.key === 'ArrowDown') markLink(links[Math.min(links.length - 1, at + 1)]);
      else if (event.key === 'ArrowUp') markLink(links[Math.max(0, at - 1)]);
      else if (event.key === 'Enter' && document.activeElement.tagName !== 'A') {
        if (links[at]) { switcher.close(); go(links[at].getAttribute('href')); }
      } else if (event.key === 'Escape') switcher.close();
      else return;
      event.preventDefault();
    });
    switcher.addEventListener('click', function (event) {
      var link = event.target.closest('a');
      if (link || event.target === switcher) switcher.close();
    });
    if (byId('switch-open')) byId('switch-open').addEventListener('click', openSwitcher);
  }
});

const help = client(function () {
  var help = byId('help');
  function openHelp() { if (help && !help.open) help.showModal(); }
  if (help) {
    byId('help-open').addEventListener('click', openHelp);
    help.addEventListener('click', function (event) { if (event.target === help || event.target.hasAttribute('data-close')) help.close(); });
    help.addEventListener('keydown', function (event) { if (event.key === 'Escape') { help.close(); event.preventDefault(); } });
  }
});

export const dialog = {
  name: 'dialog',
  css: CSS,
  html: { switcherHtml, helpHtml },
  script: switcher,
  scriptParts: { help },
  // A dialog sample is static: the dialog is open, but it is not a modal, and the styleguide puts it in the flow.
  demo: () => [{
    title: 'The ticket switcher',
    html: '<dialog open id="switcher" aria-label="Go to a ticket"><input type="search" id="switch-q" placeholder="Go to a ticket: type a key or some words" aria-label="Filter the tickets">'
      + '<ul id="switch-list"><li class="group">Needs you</li>'
      + '<li><a href="#" class="on"><span class="key">APP-101</span><span class="what">Fix outbox retry</span><small>Planned? needs you</small></a></li>'
      + '<li class="group">Active</li>'
      + '<li><a href="#"><span class="key">APP-104</span><span class="what">Port the settings grid</span><small>implement</small></a></li></ul>'
      + '<footer><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></footer></dialog>',
  }, {
    title: 'The help dialog',
    html: helpHtml(['Go to', [['t'], 'Go to a ticket'], [['b'], 'Board'], [['?'], 'Keys and mouse']]).replace('<dialog id="help"', '<dialog open id="help"'),
  }],
};
