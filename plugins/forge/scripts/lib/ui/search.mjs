// The search field: one shape for the filter of the board and the filter of the wiki. A square frame, the key cap of its shortcut, and a visible focus state.
import { esc } from './kit.mjs';

const CSS = String.raw`
.search { display: inline-flex; align-items: center; gap: var(--s-1); padding-right: var(--s-2); background: var(--card); border: var(--px) solid var(--line-2); }
.search input { width: 200px; min-width: 0; padding: 4px 8px; font: inherit; color: inherit; background: transparent; border: 0; outline: none; }
.search:focus-within { border-color: var(--accent); outline: 2px solid var(--accent); outline-offset: 2px; }
`.trim();

/** The search field: a visible label for a screen reader, the input, and the key cap of the shortcut. */
export function searchHtml({ id = '', label = 'Filter', placeholder = '', key = '/' } = {}) {
  return `<label class="search"><span class="sr">${esc(label)}</span><input type="search"${id ? ` id="${esc(id)}"` : ''} placeholder="${esc(placeholder || label)}" autocomplete="off" spellcheck="false">${key ? `<kbd>${esc(key)}</kbd>` : ''}</label>`;
}

export const search = {
  name: 'search',
  css: CSS,
  html: { searchHtml },
  script: '',
  demo: () => [{ title: 'The search field (select it to see the focus state)', html: searchHtml({ label: 'Filter the tickets', placeholder: 'Filter the tickets' }) }],
};
