// An empty state: an optional sprite, one quiet sentence, and optional numbered steps. Left aligned, with no decoration.
import { esc } from './kit.mjs';
import { iconHtml } from './pixel.mjs';

const CSS = String.raw`
.empty { display: flex; flex-direction: column; align-items: flex-start; gap: var(--s-2); margin: 0; color: var(--muted); }
.empty p { margin: 0; }
.empty ol { margin: 0; padding-left: var(--s-5); }
`.trim();

/** An empty state: `text` is plain text, `icon` is the name of a sprite, and `steps` is a list of plain texts. */
export function emptyHtml(text, { icon = '', steps = [] } = {}) {
  return `<div class="empty">${icon ? iconHtml(icon, { size: 48 }) : ''}<p>${esc(text)}</p>${steps.length ? `<ol>${steps.map((step) => `<li>${esc(step)}</li>`).join('')}</ol>` : ''}</div>`;
}

export const empty = {
  name: 'empty',
  css: CSS,
  html: { emptyHtml },
  script: '',
  demo: () => [{
    title: 'A lane with no ticket',
    html: emptyHtml('No ticket needs you.', { icon: 'anvil-cold' }),
  }, {
    title: 'A first run: 3 numbered steps',
    html: emptyHtml('No tickets yet.', { icon: 'anvil-cold', steps: ['Give a work item key to a session.', 'The session makes the ticket folder.', 'Its card shows here.'] }),
  }],
};
