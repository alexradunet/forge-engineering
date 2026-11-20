// The live line of a session (.live) and the live script: the state of the sessions from the live server, the list of closed sessions,
// and the buttons Resume and Copy command. Each text of a session goes into the page as text, never as HTML.
import { client } from './kit.mjs';

const CSS = String.raw`
.lv-working { --st: var(--accent); }
.lv-needs-you { --st: var(--amber); }
.lv-idle, .lv-ended { --st: var(--faint); }
.live { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 var(--s-2); margin: 0; padding: 3px var(--s-2); font-size: var(--t-sm); background: color-mix(in srgb, var(--st, var(--muted)) 9%, var(--card)); border: var(--px) solid color-mix(in srgb, var(--st, var(--muted)) 45%, var(--line)); }
.lv-state { font-weight: 600; white-space: nowrap; }
.lv-state::before { content: ""; display: inline-block; width: 6px; height: 6px; margin-right: 6px; background: var(--st, var(--muted)); }
.lv-working .lv-state::before { animation: lv-pulse 1.6s ease-in-out infinite; }
@keyframes lv-pulse { 50% { opacity: 0.3; } }
@media (prefers-reduced-motion: reduce) { .lv-working .lv-state::before { animation: none; } }
.lv-age { font-size: var(--t-xs); color: var(--muted); white-space: nowrap; }
.lv-now, .lv-agents, .lv-note { flex: 1 1 100%; min-width: 0; overflow-wrap: anywhere; }
.lv-now b { font: 600 var(--t-sm)/1.4 var(--mono); }
.lv-now code { background: transparent; padding: 0; }
.lv-agents, .lv-note { color: var(--muted); }
.lv-needs-you .lv-note { color: var(--ink); }
.live.past { align-items: center; }
.lv-host { color: var(--muted); white-space: nowrap; }
.lv-acts { display: inline-flex; flex-wrap: wrap; gap: var(--s-1); margin-left: auto; }
.lv-acts button { padding: 0 8px; font-size: var(--t-xs); }
`.trim();

const script = client(function () {
  // The live view. A page of the live server (forge.mjs live) has data.live: the address of the session states on that server.
  // The server holds its answer until a state changes, and then the page asks again. Only a page in view asks.
  var LIVE_TEXT = { working: 'working', 'needs-you': 'needs you', idle: 'idle', ended: 'ended' };
  var live = { v: -1, wait: 1000, busy: false, timer: 0, stop: null, state: null, skew: 0, fails: 0, show: null, denied: false, later: '', shown: '' };
  function liveState(name) { return Object.prototype.hasOwnProperty.call(LIVE_TEXT, name) ? name : 'idle'; }
  function liveSpan(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s >= 172800) return Math.floor(s / 86400) + ' days';
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
  // One session of the session list that is not live: closed, or with no end seen. It has the time since its end (or its start),
  // the name of its harness, and the buttons Resume and Copy command. The command text comes from the server.
  // Each text of a session goes into the page as text, never as HTML.
  var OPEN_NOTE = 'Forge saw the start of this session and no end. It can be open in a terminal.';
  function pastLine(item, named) {
    var closed = item.state === 'closed';
    var line = make('p', 'live past lv-ended');
    var state = make('span', 'lv-state', closed ? 'closed' : 'no end seen');
    if (!closed) state.title = OPEN_NOTE;
    line.appendChild(state);
    line.appendChild(liveTime(item.at));
    // A row that names the harness at its start does not name it again.
    if (!named) line.appendChild(make('span', 'lv-host', item.name));
    var acts = make('span', 'lv-acts');
    var resume = make('button', '', 'Resume');
    resume.type = 'button';
    resume.title = 'Open a terminal and continue this session';
    resume.setAttribute('data-resume', item.id);
    resume.setAttribute('data-command', item.command);
    if (!closed) resume.setAttribute('data-check', '1');
    var copy = make('button', 'quiet', 'Copy command');
    copy.type = 'button';
    copy.title = item.command;
    copy.setAttribute('data-copy', item.command);
    acts.appendChild(resume);
    acts.appendChild(copy);
    line.appendChild(acts);
    return line;
  }
  // The text that tells when a list of such sessions changed: a page draws the rows again only then, so a button keeps the focus.
  function pastMark(items) {
    return items.map(function (item) { return [item.id, item.state, item.at, item.label, item.command].join('|'); }).join('\n');
  }
  function copyCommand(text, done) {
    var shown = function () { window.prompt('Copy this command, and run it in a terminal:', text); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast(done); }, shown);
    else shown();
  }
  // Resume asks the live server to open a terminal with the command of the session. The request holds only the id of the session.
  // When no terminal opens, the user gets the command to paste.
  function resumeSession(button) {
    var command = button.getAttribute('data-command');
    // Two terminals on one session can lose messages, so a session with no end seen needs a second click.
    if (button.getAttribute('data-check') === '1') {
      button.setAttribute('data-check', '2');
      button.textContent = 'Resume anyway';
      toast(OPEN_NOTE + ' Close it there first, then select Resume anyway.');
      return;
    }
    if (!data.resume || offline) { copyCommand(command, 'The live server does not answer. The command is on the clipboard: paste it into a terminal.'); return; }
    button.disabled = true;
    fetch(data.resume, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Forge-Token': data.token }, body: JSON.stringify({ id: button.getAttribute('data-resume') }) })
      .then(function (response) { return response.json(); })
      .then(function (answer) {
        button.disabled = false;
        if (answer.ok) toast(answer.moved ? 'A terminal opened in ' + answer.folder + ': the folder of the session is gone.' : 'A terminal opened with the session.');
        else if (answer.command) copyCommand(answer.command, (answer.error || 'No terminal started.') + ' The command is on the clipboard: paste it into a terminal.');
        else toast(answer.error || 'The live server refused the request.');
      })
      .catch(function () {
        button.disabled = false;
        copyCommand(command, 'The live server does not answer. The command is on the clipboard: paste it into a terminal.');
      });
  }
  document.addEventListener('click', function (event) {
    var button = event.target.closest ? event.target.closest('button[data-resume], button[data-copy]') : null;
    if (!button) return;
    event.preventDefault();
    if (button.hasAttribute('data-copy')) copyCommand(button.getAttribute('data-copy'), 'Copied. Paste it into a terminal.');
    else resumeSession(button);
  });
  // The icon of the tab: the hot anvil when something needs the user. Both addresses are in the data block (data.icons), so the script holds no drawing.
  function setIcon(hot) {
    var link = document.querySelector('link[rel="icon"]');
    if (link && data.icons) link.setAttribute('href', hot ? data.icons.needs : data.icons.calm);
  }
  // The page got its data at render time (data.c). A later answer with another stamp means that the data of the page changed:
  // the page says so, and it never loads again by itself, because the user can have a comment in the editor.
  function checkStamp(c) {
    if (!data.c || !c) return;
    if (c === data.c) {
      live.later = '';
      if (noticeIs('changed')) clearNotice();
      return;
    }
    if (c === live.later || (noticeIs('changed') && live.shown === c)) return;
    live.shown = c;
    notice('info', data.live.indexOf('ticket=') >= 0 ? 'This ticket changed.' : 'The board changed.', [
      { text: 'Reload', run: function () { go(location.href, true); } },
      { text: 'Later', quiet: true, run: function () { live.later = c; clearNotice(); } },
    ], { tag: 'changed' });
  }
  function liveAsk() {
    if (!data.live || !live.show || live.busy || live.denied || document.hidden) return;
    live.busy = true;
    live.stop = typeof AbortController === 'function' ? new AbortController() : null;
    fetch(data.live + '&v=' + live.v, { cache: 'no-store', signal: live.stop ? live.stop.signal : undefined })
      .then(function (response) {
        // The server does not know the link any more: asking again cannot help.
        if (response.status === 403) { live.denied = true; noticeLost(403); }
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
        if (offline) setOnline();
        checkStamp(state.c);
        live.show(state, true);
        liveAsk();
      })
      .catch(function () {
        live.busy = false;
        if (document.hidden || live.denied) return;
        // The server does not answer: the page keeps the last state, says so, and asks again later. The notice stays until the server answers.
        live.fails += 1;
        if (live.fails > 1) { live.show(live.state, false); noticeLost(0); }
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
});

export const live = {
  name: 'live',
  css: CSS,
  html: {},
  script,
  demo: () => [{
    title: 'A session that works',
    html: '<p class="live lv-working"><span class="lv-state">working</span><span class="lv-age">2 min</span><span class="lv-now">now: <b>Edit</b> <code>src/outbox/retry.ts</code> <span class="lv-age">4 s</span></span><span class="lv-agents">1 subagent runs</span></p>',
  }, {
    title: 'A session that needs the user',
    html: '<p class="live lv-needs-you"><span class="lv-state">needs you</span><span class="lv-age">6 min</span><span class="lv-note">Approve the plan of APP-101 (Planned?).</span></p>',
  }, {
    title: 'An idle session, and one that ended',
    html: '<p class="live lv-idle"><span class="lv-state">idle</span><span class="lv-age">14 min</span></p><p class="live past lv-ended" style="margin-top: 6px"><span class="lv-state">closed</span><span class="lv-age">3 h 5 min</span><span class="lv-host">claude</span><span class="lv-acts"><button type="button">Resume</button><button type="button" class="quiet">Copy command</button></span></p>',
  }],
};
