// The banner: a notice that stays in the page. A frame with a left edge in the color of its kind, a text, and buttons.
// The one #notice of each page is a banner that the notice script shows and hides: the server stopped, the link is old, the page changed.
import { esc, client } from './kit.mjs';

const CSS = String.raw`
.banner { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2) var(--s-3); padding: var(--s-2) var(--s-3); background: color-mix(in srgb, var(--st) 9%, var(--card)); border: var(--px) solid var(--line-2); border-left: 4px solid var(--st); }
.banner p { flex: 1 1 240px; min-width: 0; margin: 0; overflow-wrap: anywhere; }
.bn-acts { display: inline-flex; flex-wrap: wrap; gap: var(--s-1); margin-left: auto; }
.bn-info { --st: var(--accent); }
.bn-warn { --st: var(--amber); }
.bn-bad { --st: var(--red); }
/* The notice stays at the bottom of the window, above the foot, so it moves no part of the page. The width is the line of a command: no token has this size. */
#notice { position: fixed; left: var(--s-5); bottom: 40px; z-index: 6; width: 800px; max-width: calc(100% - 2 * var(--s-5)); margin: 0; box-shadow: var(--sh-2); }
#notice p { flex-basis: 440px; }
.bn-cmd { display: block; margin-top: var(--s-1); padding: var(--s-1) var(--s-2); font-size: var(--t-md); user-select: all; border: 1px solid var(--line-2); }
`.trim();

/**
 * A banner. `inner` is the text as HTML (escape each value), `kind` is 'info', 'warn', or 'bad', and `actions` is the HTML of the buttons.
 * `id` gives the banner an id, and `hidden` starts it hidden (a page script shows it). `attrs` is more attributes as HTML (aria-live="polite" for the notice).
 * A banner is a live region (role status). With `live: false` it is not: a page that shows and hides the banner has a separate live region, because a region that starts hidden is often not read.
 */
export function bannerHtml(inner, { kind = 'info', actions = '', id = '', hidden = false, live = true, attrs = '' } = {}) {
  const name = ['info', 'warn', 'bad'].includes(kind) ? kind : 'info';
  return `<div class="banner bn-${esc(name)}"${live ? ' role="status"' : ''}${id ? ` id="${esc(id)}"` : ''}${attrs ? ` ${attrs}` : ''}${hidden ? ' hidden' : ''}><p>${inner}</p>${actions ? `<span class="bn-acts">${actions}</span>` : ''}</div>`;
}

const script = client(function () {
  // The notice: one banner (#notice) that stays until the page clears it. notice(kind, text, actions, more) fills it and shows it.
  // kind is info, warn, or bad. actions is a list of { text, run } or { text, copy } (a button that copies the text: the Copy command part of the live script),
  // with quiet: true for a quiet button. more is { code: a command that shows in a block that one click selects, tag: a name for noticeIs }.
  // Each text goes into the page as text, never as HTML. An event that is over in a moment stays a toast.
  var noticeTag = '';
  function noticeIs(tag) { return noticeTag === tag; }
  function clearNotice() {
    var el = byId('notice');
    if (el) el.hidden = true;
    noticeTag = '';
  }
  function notice(kind, text, actions, more) {
    var el = byId('notice');
    if (!el) return;
    more = more || {};
    el.className = 'banner bn-' + (kind === 'info' || kind === 'bad' ? kind : 'warn');
    while (el.firstChild) el.removeChild(el.firstChild);
    var line = make('p', '', text);
    if (more.code) line.appendChild(make('code', 'bn-cmd', more.code));
    el.appendChild(line);
    var box = make('span', 'bn-acts');
    (actions || []).forEach(function (action) {
      var button = make('button', action.quiet ? 'quiet' : '', action.text);
      button.type = 'button';
      if (action.copy) button.setAttribute('data-copy', action.copy);
      else if (action.run) button.addEventListener('click', action.run);
      box.appendChild(button);
    });
    if (box.firstChild) el.appendChild(box);
    noticeTag = more.tag || '';
    el.hidden = false;
  }
});

export const banner = {
  name: 'banner',
  css: CSS,
  html: { bannerHtml },
  script,
  demo: () => [{
    title: 'A banner of each kind',
    html: `${bannerHtml('The page has the state of 2 minutes ago.', { kind: 'info' })}<div style="height: 8px"></div>`
      + `${bannerHtml('<span class="key">APP-101</span> Shippable? needs you. Read review.md.', { kind: 'warn', actions: '<a class="primary" href="#">Open</a>' })}<div style="height: 8px"></div>`
      + `${bannerHtml('The live server does not answer. Start it with this command: <code class="bn-cmd">forge open</code>', { kind: 'bad', actions: '<button type="button">Copy command</button><button type="button">Try again</button>' })}`,
  }],
};
