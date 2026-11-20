// The frame: the box of the pages. A square face, a border of one pixel unit, and a hard shadow.
// .edge adds a 4 px left edge in the color of the state (--st, from a .st-* class). .sunk is a quiet panel: a lane, with no shadow.
import { esc } from './kit.mjs';

const CSS = String.raw`
.frame { --hole: var(--card); min-width: 0; padding: var(--s-3); background: var(--card); border: var(--px) solid var(--line-2); box-shadow: var(--sh-1); }
.frame.edge { border-left: 4px solid var(--st, var(--line-2)); }
.frame.sunk { --hole: var(--panel); background: var(--panel); box-shadow: none; }
`.trim();

/**
 * A frame around `inner` (HTML). `state` ('needs-me' and so on) gives it the left edge, and `sunk` makes it a quiet panel.
 * `cls` is more class names of the page, and `attrs` is the HTML of more attributes (trusted text: escape each value).
 */
export function frameHtml(inner, { state = '', sunk = false, tag = 'div', cls = '', attrs = '' } = {}) {
  return `<${tag} class="frame${state ? ` edge st-${esc(state)}` : ''}${sunk ? ' sunk' : ''}${cls ? ` ${esc(cls)}` : ''}"${attrs ? ` ${attrs}` : ''}>${inner}</${tag}>`;
}

export const frame = {
  name: 'frame',
  css: CSS,
  html: { frameHtml },
  script: '',
  demo: () => [{
    title: 'A frame, a frame with the edge of a state, and a sunk frame',
    html: `${frameHtml('<b>APP-101</b> Fix outbox retry', { state: 'needs-me' })}<div style="height: 8px"></div>${frameHtml('A plain frame with the hard shadow of the kit.')}<div style="height: 8px"></div>${frameHtml('A lane: a quiet panel with no shadow.', { sunk: true })}`,
  }],
};
