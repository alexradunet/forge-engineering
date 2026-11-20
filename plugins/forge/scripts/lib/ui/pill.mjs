// The pill: a small label with the color of a state, with a stepped corner. The chip is a pill that filters, the tag is a quiet label, and the count is a number.
import { esc } from './kit.mjs';
import { step } from './pixel.mjs';

const CSS = String.raw`
.pill, .chip, .tag, .count { margin: var(--px); }
.pill { display: inline-flex; align-items: center; gap: 5px; padding: 1px 10px; font-size: var(--t-sm); white-space: nowrap; color: var(--ink); background: color-mix(in srgb, var(--st, var(--muted)) 14%, var(--card)); box-shadow: ${step('var(--st, var(--muted))')}; }
button.chip, .chip { display: inline-flex; align-items: center; gap: 5px; padding: 1px 10px; font-size: var(--t-sm); white-space: nowrap; color: var(--ink); background: color-mix(in srgb, var(--st, var(--muted)) 14%, var(--card)); box-shadow: ${step('var(--st, var(--muted))')}; }
button.chip:hover { background: color-mix(in srgb, var(--st, var(--muted)) 24%, var(--card)); }
button.chip[aria-pressed="true"] { background: color-mix(in srgb, var(--st, var(--muted)) 32%, var(--card)); box-shadow: ${step('var(--ink)')}; }
.tag { display: inline-block; max-width: 100%; padding: 0 8px; font-size: var(--t-xs); color: var(--muted); background: var(--card); box-shadow: ${step('var(--line-2)')}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
.tg-ok { color: var(--green); box-shadow: ${step('var(--green)')}; }
.tg-bad { color: var(--red); box-shadow: ${step('var(--red)')}; }
.tg-wait { color: var(--amber); box-shadow: ${step('var(--amber)')}; }
.count { display: inline-block; min-width: 22px; padding: 0 5px; font: 600 var(--t-xs)/1.5 var(--mono); text-align: center; color: var(--ink); background: var(--panel); box-shadow: ${step('var(--line-2)')}; }
`.trim();

const attr = (state) => (state ? ` st-${esc(state)}` : '');

/** A pill: a label with the color of a board state ('needs-me', 'blocked', 'go', 'active', 'waiting', 'done'), or no state. */
export const pillHtml = (label, state = '') => `<span class="pill${attr(state)}">${esc(label)}</span>`;
/**
 * A chip: a pill that filters. It is a button with aria-pressed, and it can show a count. `mark` is an emoji before the label (hidden for a screen reader),
 * `attrs` is the HTML of more attributes (trusted text: escape each value), and `disabled` turns the chip off.
 */
export const chipHtml = (label, state = '', count = null, { pressed = false, mark = '', disabled = false, attrs = '' } = {}) => `<button type="button" class="chip${attr(state)}"${attrs ? ` ${attrs}` : ''} aria-pressed="${pressed}"${disabled ? ' disabled' : ''}>${mark ? `<span aria-hidden="true">${esc(mark)}</span> ` : ''}${esc(label)}${count === null ? '' : ` <b>${esc(count)}</b>`}</button>`;
/** A tag: a quiet label, for example the phase of a ticket. `kind` is 'ok', 'bad', or 'wait' for a tag with a color. */
export const tagHtml = (text, kind = '') => `<span class="tag${['ok', 'bad', 'wait'].includes(kind) ? ` tg-${kind}` : ''}">${esc(text)}</span>`;
/** A count: a small box with a number. `inner` is the number as HTML (the pixel digits, for example), or a plain number. */
export const countHtml = (value, { html = false } = {}) => `<span class="count">${html ? value : esc(value)}</span>`;

export const pill = {
  name: 'pill',
  css: CSS,
  html: { pillHtml, chipHtml, tagHtml, countHtml },
  script: '',
  demo: () => [{
    title: 'One pill for each state',
    html: [['needs-me', 'Needs you'], ['blocked', 'Blocked'], ['go', 'Go'], ['active', 'Active'], ['waiting', 'Waiting'], ['done', 'Done']]
      .map(([state, label]) => pillHtml(label, state)).join(' '),
  }, {
    title: 'A pill with no state, a tag, and a count',
    html: `${pillHtml('plan')} ${tagHtml('implement')} ${tagHtml('CI green', 'ok')} ${tagHtml('CI red', 'bad')} ${tagHtml('waits 4 days', 'wait')} ${countHtml(3)}`,
  }, {
    title: 'Chips: a filter button for each state, one of them pressed',
    html: `${chipHtml('Needs you', 'needs-me', 1, { pressed: true, mark: '🟡' })} ${chipHtml('Blocked', 'blocked', 1)} ${chipHtml('Go', 'go', 2)} ${chipHtml('Waiting', 'waiting', 0)}`,
  }],
};
