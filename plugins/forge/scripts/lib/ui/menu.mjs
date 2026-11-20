// A menu of the bar (details.refs): the wiki pages of a ticket. It closes at a click outside of it, and at Esc.
import { client } from './kit.mjs';

const CSS = String.raw`
.refs { position: relative; }
.refs > summary { display: inline-block; list-style: none; padding: 2px 10px; background: var(--card); border: var(--px) solid var(--line-2); cursor: pointer; white-space: nowrap; }
.refs > summary::-webkit-details-marker { display: none; }
.refs > summary:hover, .refs[open] > summary { border-color: var(--accent); }
.refs > summary span { font-weight: 600; }
.refs > ul { position: absolute; right: 0; top: calc(100% + 6px); z-index: 6; width: 380px; max-width: calc(100vw - 24px); max-height: 60vh; overflow: auto; list-style: none; margin: 0; padding: 6px; background: var(--rail); border: var(--px) solid var(--shade); box-shadow: var(--sh-2); }
.refs a { display: block; padding: 5px 10px; color: inherit; text-decoration: none; }
.refs a:hover { background: color-mix(in srgb, var(--muted) 12%, transparent); }
.refs .what { display: block; overflow-wrap: anywhere; }
.refs small { display: block; font: var(--t-xs)/1.4 var(--mono); color: var(--muted); overflow-wrap: anywhere; }
.refs .none { padding: 5px 10px; color: var(--muted); }
.refs .all { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--line); }
.refs .all a { color: var(--accent); }
`.trim();

const script = client(function () {
  // A menu of the bar (the wiki pages of a ticket) closes at a click outside of it, and at Esc.
  document.addEventListener('click', function (event) {
    each(document.querySelectorAll('details.refs[open]'), function (menu) { if (!menu.contains(event.target)) menu.open = false; });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    each(document.querySelectorAll('details.refs[open]'), function (menu) { menu.open = false; });
  });
});

export const menu = {
  name: 'menu',
  css: CSS,
  html: {},
  script,
  demo: () => [{
    title: 'The menu, open',
    html: '<div style="min-height: 170px; display: flex; justify-content: flex-end"><details class="refs" open><summary><span>Wiki</span> 2 pages</summary><ul>'
      + '<li><a href="#"><span class="what">Outbox retry</span><small>app/retry.md</small></a></li>'
      + '<li><a href="#"><span class="what">Build and test</span><small>tooling/build.md</small></a></li>'
      + '<li class="all"><a href="#">All pages of the wiki</a></li></ul></details></div>',
  }],
};
