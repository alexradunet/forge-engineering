// The base rules of each page: the reset, the body, links, key caps, code, the focus ring, the eyebrow label, the table, and the state classes (.st-*).
// The script helpers make, each, byId, typing, and modalOpen are the shared functions of the page script.
import { client } from './kit.mjs';

const RESET = String.raw`
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin: 0; }
body { font: var(--t-md)/1.5 var(--font); color: var(--ink); background: var(--bg); }
a { color: var(--accent); text-underline-offset: 2px; }
`.trim();

// The focus ring, the key cap, code, the eyebrow label, the table, and the small shared classes. They follow the button rules in the style text.
const REST = String.raw`
button:focus-visible, a:focus-visible, textarea:focus-visible, input:focus-visible, summary:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
kbd { font: var(--t-xs)/1.4 var(--mono); padding: 1px 5px; color: var(--muted); background: var(--card); border: 1px solid var(--line-2); border-bottom-width: 2px; white-space: nowrap; }
code { font: var(--t-sm)/1.4 var(--mono); background: color-mix(in srgb, var(--muted) 16%, transparent); padding: 1px 4px; overflow-wrap: anywhere; }
.sr, .skip:not(:focus) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
/* The first link of each page: hidden as .sr is, until it has the focus. */
.skip:focus { position: fixed; z-index: 10; left: var(--s-2); top: var(--s-2); padding: var(--s-1) var(--s-3); color: var(--ink); background: var(--card); border: var(--px) solid var(--accent); }
.key { font: 600 var(--t-sm)/1.4 var(--mono); white-space: nowrap; }
.tools { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-1) var(--s-2); margin-left: auto; }
.eyebrow { font-size: var(--t-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
table { border-collapse: collapse; font-size: var(--t-sm); background: var(--card); }
th, td { padding: 4px 10px; text-align: left; vertical-align: top; border: 1px solid var(--line); }
th { font-size: var(--t-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); background: var(--panel); }
`.trim();

const STATE = String.raw`
.st-needs-me { --st: var(--amber); }
.st-blocked { --st: var(--red); }
.st-go { --st: var(--green); }
.st-active { --st: var(--accent); }
.st-waiting { --st: var(--violet); }
.st-done { --st: var(--faint); }
`.trim();

const helpers = client(function () {
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
});

export const base = {
  name: 'base',
  css: RESET,
  cssParts: { rest: REST, state: STATE },
  html: {},
  script: helpers,
  demo: () => [{
    title: 'Text, a link, a key cap, code, and a key name',
    html: '<p>The ticket waits for <a href="#">the plan</a>. Press <kbd>t</kbd> to go to a ticket, or run <code>forge.mjs board</code>.</p><p><span class="key">APP-101</span> <span style="color: var(--muted)">A key uses the mono font.</span></p>',
  }, {
    title: 'The state classes set --st (here shown as a left bar)',
    html: ['needs-me', 'blocked', 'go', 'active', 'waiting', 'done'].map((state) => `<div class="st-${state}" style="padding: 2px 8px; margin: 2px 0; border-left: 4px solid var(--st)">st-${state}</div>`).join(''),
  }],
};
