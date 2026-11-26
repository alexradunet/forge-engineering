// The bar at the top of each page (#rail, .bar) and the foot of the page (#foot).
import { iconHtml, pixelText } from './pixel.mjs';

const CSS = String.raw`
#rail { background: var(--rail); border-bottom: var(--px) solid var(--shade); z-index: 3; }
.brand { display: inline-flex; align-items: center; gap: var(--s-2); color: var(--ink); white-space: nowrap; }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-1) var(--s-2); padding: var(--s-2) var(--s-4); }
.bar h1 { flex: 0 1 auto; min-width: 0; margin: 0 var(--s-2) 0 0; font-size: var(--t-lg); font-weight: 600; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar .sep { color: var(--faint); }
body.offline a[data-nav] { opacity: 0.45; }
`.trim();

const FOOT = String.raw`
#foot { display: flex; gap: var(--s-4); padding: 4px var(--s-4); font-size: var(--t-xs); color: var(--muted); background: var(--rail); border-top: var(--px) solid var(--line-2); }
#foot p { margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#foot .note { flex: none; color: var(--ink); }
#foot .hint { flex: none; margin-left: auto; }
#foot .text { flex: 0 1 auto; min-width: 0; }
`.trim();

/** The logo (the anvil sprite) and the word in bitmap letters. `readAs` is the real text of the title ("Forge board"): a screen reader and the search of the page get it. */
export const brandHtml = (word, readAs = word) => `<span class="brand">${iconHtml('anvil', { size: 32 })}${pixelText(word, { scale: 3, label: readAs })}</span>`;

/**
 * The foot of a page. `text` is the HTML of the note about the page, and `note` is the HTML of a second note before it (the live line). The foot names the ? key.
 */
export const footHtml = (text, { note = '' } = {}) => `<footer id="foot">${note}<p class="text">${text}</p><p class="hint">Press ? for the keys</p></footer>`;

export const bar = {
  name: 'bar',
  css: CSS,
  cssParts: { foot: FOOT },
  html: { brandHtml, footHtml },
  script: '',
  demo: () => [{
    title: 'The bar of a page',
    html: '<header id="rail"><div class="bar"><h1>Forge board</h1><span class="sep">/</span><span>Go to a ticket</span>'
      + '<div class="tools"><button type="button" class="quiet icon">?</button><button type="button" class="quiet">Theme</button></div></div></header>',
  }, {
    title: 'The foot of a page',
    html: footHtml('Generated 2026-11-17 09:00 by <code>forge.mjs board</code>.'),
  }],
};
