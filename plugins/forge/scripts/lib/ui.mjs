// The design system of the forge pages: the board page (board-page.mjs), the ticket canvas (canvas-page.mjs), and the wiki page (wiki-page.mjs).
// It holds one set of tokens (color, type, space, radius, shadow), the shared components, the links between
// the pages, and the shared browser functions. Each page puts the style and the script inline,
// so a page needs no network and no other file (the wiki page with a Mermaid block also needs the Mermaid file of forge). docs/design-system.md gives the rules.
// The script text uses no template literals: it sits in one.

export const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The words for a gate status, on each page. */
export const GATE_TEXT = { approved: 'approved', 'in-review': 'waits for you', todo: 'not open', blocked: 'blocked', skipped: 'skipped' };

/** The gate line of a board ticket: the open gate and its status, or '' when no required gate is open. */
export function gateLine(item) {
  if (!item.openGate) return '';
  return `${item.openGate.name} ${GATE_TEXT[item.openGate.status] ?? item.openGate.status}`;
}

/**
 * The links between the pages of one wiki, for a page at `from` ('board', 'wiki', or the folder of a ticket).
 * A file page uses relative links: raw/board.html, raw/wiki.html, and raw/tickets/<folder>/canvas.html.
 * A served page (token) uses the routes of the canvas server. `home` is the ticket of that server.
 * `broken` names the folders without a canvas: their link goes to the README.
 * `closed` (buildWiki in wiki.mjs) gives the closed tickets: each one has a summary page in the wiki.
 */
export function buildNav(board, { from = 'board', token = '', home = '', broken = [], closed = [] } = {}) {
  const seg = encodeURIComponent;
  const hash = (relative) => relative.split('/').map(seg).join('/');
  const top = from === 'board' || from === 'wiki';
  const up = top ? 'tickets/' : '../';
  const wiki = from === 'wiki' ? '' : token ? `/wiki?t=${token}` : top ? 'wiki.html' : '../../wiki.html';
  const file = (folder, name) => (token
    ? `/ticket/${seg(folder)}/${name.split('/').map(seg).join('/')}?t=${token}`
    : `${up}${seg(folder)}/${name.split('/').map(seg).join('/')}`);
  const page = (folder) => {
    if (token) return folder === home ? `/?t=${token}` : `/ticket/${seg(folder)}/?t=${token}`;
    return file(folder, broken.includes(folder) ? 'README.md' : 'canvas.html');
  };
  const tickets = board.groups.flatMap((group) => group.tickets.map((item) => ({
    key: item.key, folder: item.folder, title: item.short || item.title, state: item.state, emoji: item.emoji, label: group.label,
    phase: item.phase, gate: gateLine(item), href: page(item.folder),
  })));
  const at = tickets.findIndex((item) => item.folder === from);
  return {
    board: from === 'board' ? '' : token ? `/board?t=${token}` : top ? 'board.html' : '../../board.html',
    wiki,
    // One page of the wiki page, by the path of its Markdown file.
    page: (relative) => `${wiki}#${hash(relative)}`,
    closed: closed.map((item) => ({ key: item.key, title: item.title, updated: item.updated, path: item.path, href: `${wiki}#${hash(item.path)}` })),
    current: top ? '' : from,
    home, tickets, file,
    prev: at > 0 ? tickets[at - 1] : null,
    next: at >= 0 && at < tickets.length - 1 ? tickets[at + 1] : null,
  };
}

/** The part of the links that the page script needs. */
export function navData(nav) {
  if (!nav) return null;
  return { board: nav.board, wiki: nav.wiki, prev: nav.prev?.href ?? '', next: nav.next?.href ?? '' };
}

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
    rows.push(`<li><a href="${esc(item.href)}" data-nav data-text="${esc(text)}"${item.folder === nav.current ? ' aria-current="page"' : ''}>`
      + `<span class="key">${esc(item.key)}</span><span class="what">${esc(item.title)}</span><small>${esc(item.gate || item.phase)}</small></a></li>`);
  }
  // A closed ticket has no canvas: its link goes to its summary page in the wiki. A link inside the wiki page changes only the page that shows.
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

/** The buttons that each page has at the end of its bar. */
export const TOOLS_HTML = '<button type="button" class="quiet icon" id="help-open" title="Keys and mouse (?)" aria-label="Keys and mouse">?</button>'
  + '<button type="button" class="quiet" id="theme" title="Theme">Theme</button>';

const DARK = '--bg: #151619; --panel: #1c1e22; --card: #24272c; --rail: #1c1e22; --ink: #e9e7e1; --muted: #a3a097; --faint: #7d7a72; --line: #3a3d43; --line-2: #565a63; '
  + '--accent: #8fbbe3; --amber: #e2aa4c; --green: #6fc391; --red: #ea8d7c; --violet: #b9a1dc; --sh-1: 0 1px 2px rgba(0, 0, 0, 0.4); --sh-2: 0 12px 34px rgba(0, 0, 0, 0.55);';

export const UI_STYLE = String.raw`
:root {
  color-scheme: light dark;
  --bg: #f4f3ef; --panel: #faf9f6; --card: #ffffff; --rail: #ffffff;
  --ink: #1c1c1a; --muted: #5f5d56; --faint: #8b887f; --line: #dcd9cf; --line-2: #bfbbaf;
  --accent: #2a5d8c; --amber: #96600d; --green: #23703f; --red: #ad3526; --violet: #6b4d94;
  --t-xs: 12px; --t-sm: 13px; --t-md: 15px; --t-lg: 17px; --t-xl: 20px; --t-2xl: 26px;
  --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 24px; --s-6: 32px; --s-7: 48px;
  --r-1: 6px; --r-2: 10px; --r-3: 14px; --r-pill: 999px;
  --sh-1: 0 1px 2px rgba(0, 0, 0, 0.07); --sh-2: 0 12px 34px rgba(0, 0, 0, 0.2);
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${DARK} } }
:root[data-theme="dark"] { color-scheme: dark; ${DARK} }
:root[data-theme="light"] { color-scheme: light; }

* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin: 0; }
body { font: var(--t-md)/1.5 var(--font); color: var(--ink); background: var(--bg); }
a { color: var(--accent); text-underline-offset: 2px; }
button { font: inherit; color: inherit; background: var(--card); border: 1px solid var(--line); border-radius: var(--r-1); padding: 2px 10px; cursor: pointer; }
button:hover { border-color: var(--accent); }
button:disabled { opacity: 0.5; cursor: default; }
button.primary { color: var(--card); background: var(--accent); border-color: var(--accent); font-weight: 600; }
button.quiet, a.quiet, span.quiet { color: var(--muted); background: transparent; border: 1px solid transparent; border-radius: var(--r-1); padding: 2px 8px; text-decoration: none; }
button.quiet:hover, a.quiet:hover { color: var(--ink); background: color-mix(in srgb, var(--muted) 14%, transparent); border-color: transparent; }
button.icon, a.icon, span.icon { min-width: 30px; padding: 2px 6px; text-align: center; }
.icon.off { opacity: 0.3; }
button[aria-pressed="true"] { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 16%, var(--card)); }
button:focus-visible, a:focus-visible, textarea:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
kbd { font: var(--t-xs)/1.4 var(--mono); padding: 1px 5px; color: var(--muted); background: var(--card); border: 1px solid var(--line-2); border-bottom-width: 2px; border-radius: 4px; white-space: nowrap; }
code { font: var(--t-sm)/1.4 var(--mono); background: color-mix(in srgb, var(--muted) 16%, transparent); padding: 1px 4px; border-radius: 4px; overflow-wrap: anywhere; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.key { font: 600 var(--t-sm)/1.4 var(--mono); white-space: nowrap; }
.tools { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-1) var(--s-2); margin-left: auto; }

.st-needs-me { --st: var(--amber); }
.st-blocked { --st: var(--red); }
.st-go { --st: var(--green); }
.st-active { --st: var(--accent); }
.st-waiting { --st: var(--violet); }
.st-done { --st: var(--faint); }
.pill { display: inline-flex; align-items: center; gap: 5px; padding: 1px 10px; font-size: var(--t-sm); white-space: nowrap; color: var(--ink); background: color-mix(in srgb, var(--st, var(--muted)) 14%, var(--card)); border: 1px solid color-mix(in srgb, var(--st, var(--muted)) 60%, var(--line)); border-radius: var(--r-pill); }

.lv-working { --st: var(--accent); }
.lv-needs-you { --st: var(--amber); }
.lv-idle, .lv-ended { --st: var(--faint); }
.live { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 var(--s-2); margin: 0; padding: 3px var(--s-2); font-size: var(--t-sm); background: color-mix(in srgb, var(--st, var(--muted)) 9%, var(--card)); border: 1px solid color-mix(in srgb, var(--st, var(--muted)) 45%, var(--line)); border-radius: var(--r-1); }
.lv-state { font-weight: 600; white-space: nowrap; }
.lv-state::before { content: ""; display: inline-block; width: 8px; height: 8px; margin-right: 6px; background: var(--st, var(--muted)); border-radius: 50%; }
.lv-working .lv-state::before { animation: lv-pulse 1.6s ease-in-out infinite; }
@keyframes lv-pulse { 50% { opacity: 0.3; } }
@media (prefers-reduced-motion: reduce) { .lv-working .lv-state::before { animation: none; } }
.lv-age { font-size: var(--t-xs); color: var(--muted); white-space: nowrap; }
.lv-now, .lv-agents, .lv-note { flex: 1 1 100%; min-width: 0; overflow-wrap: anywhere; }
.lv-now b { font: 600 var(--t-sm)/1.4 var(--mono); }
.lv-now code { background: transparent; padding: 0; }
.lv-agents, .lv-note { color: var(--muted); }
.lv-needs-you .lv-note { color: var(--ink); }

.refs { position: relative; }
.refs > summary { display: inline-block; list-style: none; padding: 2px 10px; background: var(--card); border: 1px solid var(--line); border-radius: var(--r-1); cursor: pointer; white-space: nowrap; }
.refs > summary::-webkit-details-marker { display: none; }
.refs > summary:hover, .refs[open] > summary { border-color: var(--accent); }
.refs > summary span { font-weight: 600; }
.refs > ul { position: absolute; right: 0; top: calc(100% + 6px); z-index: 6; width: 380px; max-width: calc(100vw - 24px); max-height: 60vh; overflow: auto; list-style: none; margin: 0; padding: 6px; background: var(--rail); border: 1px solid var(--line); border-radius: var(--r-2); box-shadow: var(--sh-2); }
.refs a { display: block; padding: 5px 10px; color: inherit; text-decoration: none; border-radius: var(--r-1); }
.refs a:hover { background: color-mix(in srgb, var(--muted) 12%, transparent); }
.refs .what { display: block; overflow-wrap: anywhere; }
.refs small { display: block; font: var(--t-xs)/1.4 var(--mono); color: var(--muted); overflow-wrap: anywhere; }
.refs .none { padding: 5px 10px; color: var(--muted); }
.refs .all { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--line); }
.refs .all a { color: var(--accent); }

#rail { background: var(--rail); border-bottom: 1px solid var(--line); z-index: 3; }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-1) var(--s-2); padding: var(--s-2) var(--s-4); }
.bar h1 { flex: 0 1 auto; min-width: 0; margin: 0 var(--s-2) 0 0; font-size: var(--t-lg); font-weight: 600; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar .sep { color: var(--faint); }
.crumb::after { content: "\25BE"; margin-left: 6px; color: var(--muted); }
.phase { font-size: var(--t-sm); color: var(--muted); white-space: nowrap; }
body.offline a[data-nav] { opacity: 0.45; }

dialog { color: var(--ink); background: var(--rail); border: 1px solid var(--line); border-radius: var(--r-3); box-shadow: var(--sh-2); padding: 0; max-width: calc(100vw - 24px); }
dialog::backdrop { background: rgba(0, 0, 0, 0.34); }
#switcher { width: 580px; max-height: min(76vh, 640px); margin-top: 9vh; overflow: hidden; }
#switcher[open] { display: flex; flex-direction: column; }
#switch-q { flex: none; width: 100%; padding: 13px 16px; font: inherit; color: inherit; background: transparent; border: 0; border-bottom: 1px solid var(--line); outline: none; }
#switch-list { flex: 1 1 auto; list-style: none; margin: 0; padding: 6px; overflow: auto; }
#switch-list .group { padding: 10px 10px 2px; font-size: var(--t-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
#switch-list a { display: flex; gap: 12px; align-items: baseline; padding: 6px 10px; color: inherit; text-decoration: none; border-radius: var(--r-1); }
#switch-list a:hover { background: color-mix(in srgb, var(--muted) 12%, transparent); }
#switch-list a.on { background: color-mix(in srgb, var(--accent) 18%, transparent); }
#switch-list a[aria-current] .what { font-weight: 600; }
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

#toast { position: fixed; left: 50%; bottom: 44px; z-index: 7; transform: translateX(-50%); max-width: calc(100% - 24px); padding: 6px 16px; color: var(--bg); background: var(--ink); border-radius: var(--r-pill); box-shadow: var(--sh-2); }
#foot { display: flex; gap: var(--s-4); padding: 4px var(--s-4); font-size: var(--t-xs); color: var(--muted); background: var(--rail); border-top: 1px solid var(--line); }
#foot p { margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#foot .note { flex: none; color: var(--ink); }
`;

// The page script defines `data` before this text: the JSON of the data block, with `token` on a served page and `nav`.
export const UI_SCRIPT = String.raw`
  function make(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }
  function byId(id) { return document.getElementById(id); }
  function typing(event) { return !!(event.target.closest && event.target.closest('textarea, input, select')); }
  function modalOpen() { return !!document.querySelector('dialog[open]'); }

  function toast(text) {
    var el = byId('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { el.hidden = true; }, 4000);
  }

  // The theme is the system setting, or the choice of the user for each forge page in this browser.
  var THEMES = ['auto', 'light', 'dark'];
  function readTheme() {
    try { var name = localStorage.getItem('forge-ui:theme'); return THEMES.indexOf(name) >= 0 ? name : 'auto'; } catch (error) { return 'auto'; }
  }
  function showTheme(name) {
    if (name === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', name);
    var button = byId('theme');
    if (button) button.title = 'Theme: ' + name + '. Select to change it.';
  }
  showTheme(readTheme());
  if (byId('theme')) byId('theme').addEventListener('click', function () {
    var name = THEMES[(THEMES.indexOf(readTheme()) + 1) % THEMES.length];
    try { localStorage.setItem('forge-ui:theme', name); } catch (error) { /* The storage is off: the theme stays for this page. */ }
    showTheme(name);
    toast('Theme: ' + name);
  });

  // The links between the pages. A served page asks its server before it leaves,
  // so a stopped server does not replace the page and its comments with a browser error.
  var nav = data.nav || {};
  var offline = false;
  var GONE = 'This page is old, or its server stopped. Ask the ticket session for a new link.';
  function setOffline() { offline = true; document.body.classList.add('offline'); }
  function go(href) {
    if (!href) return;
    if (!data.token) { location.href = href; return; }
    if (offline) { toast(GONE); return; }
    fetch(href, { cache: 'no-store' })
      .then(function (response) { if (!response.ok) throw new Error('refused'); location.href = href; })
      .catch(function () { setOffline(); toast(GONE); });
  }
  document.addEventListener('click', function (event) {
    var link = event.target.closest ? event.target.closest('a[data-nav]') : null;
    if (!link || event.defaultPrevented || !data.token || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    go(link.getAttribute('href'));
  });

  // The live view. A page of the live server (forge.mjs live) has data.live: the address of the session states on that server.
  // The server holds its answer until a state changes, and then the page asks again. Only a page in view asks.
  var LIVE_TEXT = { working: 'working', 'needs-you': 'needs you', idle: 'idle', ended: 'ended' };
  var live = { v: -1, wait: 1000, busy: false, timer: 0, stop: null, state: null, skew: 0, fails: 0, show: null };
  function liveState(name) { return Object.prototype.hasOwnProperty.call(LIVE_TEXT, name) ? name : 'idle'; }
  function liveSpan(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? s + ' s' : s < 3600 ? Math.floor(s / 60) + ' min' : Math.floor(s / 3600) + ' h ' + Math.floor(s % 3600 / 60) + ' min';
  }
  // The time since a moment of the server clock. The element counts on each second (liveTick).
  function liveTime(from) {
    var el = make('span', 'lv-age', liveSpan(Date.now() - live.skew - from));
    el.setAttribute('data-from', String(from));
    return el;
  }
  function liveTick() {
    each(document.querySelectorAll('[data-from]'), function (el) { el.textContent = liveSpan(Date.now() - live.skew - Number(el.getAttribute('data-from'))); });
  }
  // One session: its state and the time in that state, the tool that runs now, the count of subagents, and the note of a wait.
  function liveLine(session) {
    var state = liveState(session.state);
    var line = make('p', 'live lv-' + state);
    line.appendChild(make('span', 'lv-state', LIVE_TEXT[state] + (session.quiet ? ', quiet' : '')));
    line.appendChild(liveTime(session.quiet ? session.seen : session.since));
    if (session.now) {
      var now = make('span', 'lv-now', 'now: ');
      now.appendChild(make('b', '', session.now.name));
      if (session.now.label) { now.appendChild(document.createTextNode(' ')); now.appendChild(make('code', '', session.now.label)); }
      now.appendChild(document.createTextNode(' '));
      now.appendChild(liveTime(session.now.start));
      line.appendChild(now);
    }
    if (session.agents) line.appendChild(make('span', 'lv-agents', session.agents === 1 ? '1 subagent runs' : session.agents + ' subagents run'));
    if (session.note && state === 'needs-you') line.appendChild(make('span', 'lv-note', session.note));
    return line;
  }
  function liveAsk() {
    if (!data.live || !live.show || live.busy || offline || document.hidden) return;
    live.busy = true;
    live.stop = typeof AbortController === 'function' ? new AbortController() : null;
    fetch(data.live + '&v=' + live.v, { cache: 'no-store', signal: live.stop ? live.stop.signal : undefined })
      .then(function (response) {
        if (response.status === 403) setOffline();
        if (!response.ok) throw new Error('refused');
        return response.json();
      })
      .then(function (state) {
        live.busy = false;
        live.wait = 1000;
        live.fails = 0;
        live.v = state.v;
        live.state = state;
        live.skew = Date.now() - state.now;
        live.show(state, true);
        liveAsk();
      })
      .catch(function () {
        live.busy = false;
        if (document.hidden && !offline) return;
        // The server does not answer: the page keeps the last state, says so, and asks again later.
        live.fails += 1;
        if (offline || live.fails > 1) live.show(live.state, false);
        if (offline) return;
        clearTimeout(live.timer);
        live.timer = setTimeout(liveAsk, live.wait);
        live.wait = Math.min(live.wait * 2, 30000);
      });
  }
  // show(state, ok) draws the sessions. state is null before the first answer, and ok is false when the server does not answer.
  function liveStart(show) {
    if (!data.live) return;
    live.show = show;
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { if (live.stop) live.stop.abort(); } else liveAsk();
    });
    setInterval(function () { if (!document.hidden) liveTick(); }, 1000);
    liveAsk();
  }

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
    var here = links.filter(function (link) { return link.hasAttribute('aria-current'); })[0];
    markLink(words.length ? links[0] : here || links[0]);
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
        if (links[at]) { switcher.close(); if (!links[at].hasAttribute('aria-current')) go(links[at].getAttribute('href')); }
      } else if (event.key === 'Escape') switcher.close();
      else return;
      event.preventDefault();
    });
    switcher.addEventListener('click', function (event) {
      var link = event.target.closest('a');
      if (link && link.hasAttribute('aria-current')) event.preventDefault();
      if (link || event.target === switcher) switcher.close();
    });
    if (byId('switch-open')) byId('switch-open').addEventListener('click', openSwitcher);
  }

  // A menu of the bar (the wiki pages of a ticket) closes at a click outside of it, and at Esc.
  document.addEventListener('click', function (event) {
    each(document.querySelectorAll('details.refs[open]'), function (menu) { if (!menu.contains(event.target)) menu.open = false; });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    each(document.querySelectorAll('details.refs[open]'), function (menu) { menu.open = false; });
  });

  var help = byId('help');
  function openHelp() { if (help && !help.open) help.showModal(); }
  if (help) {
    byId('help-open').addEventListener('click', openHelp);
    help.addEventListener('click', function (event) { if (event.target === help || event.target.hasAttribute('data-close')) help.close(); });
    help.addEventListener('keydown', function (event) { if (event.key === 'Escape') { help.close(); event.preventDefault(); } });
  }

  document.addEventListener('keydown', function (event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || typing(event) || modalOpen()) return;
    if (event.key === 't') openSwitcher();
    else if (event.key === 'b' && nav.board) go(nav.board);
    else if (event.key === 'w' && nav.wiki) go(nav.wiki);
    else if (event.key === '[' && nav.prev) go(nav.prev);
    else if (event.key === ']' && nav.next) go(nav.next);
    else if (event.key === '?') openHelp();
    else return;
    event.preventDefault();
  });
`;
