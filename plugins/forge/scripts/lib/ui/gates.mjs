// The gates of a ticket as a row of ingots. Each status differs by shape and by color:
// approved is a steel ingot, in review is an amber ingot with an ember frame, not open is an empty frame, blocked is a red ingot with a notch, skipped is a dotted outline.
import { client, esc } from './kit.mjs';
import { GATE_TEXT } from './nav.mjs';
import { step } from './pixel.mjs';

const CSS = String.raw`
.gates { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0 var(--s-2); }
.ingots { display: inline-flex; align-items: center; }
.ingot { position: relative; display: inline-block; flex: none; width: 16px; height: 10px; margin: var(--px); }
.ig-line { display: inline-block; width: 6px; height: var(--px); background: var(--line-2); }
.ig-approved { background: var(--steel); box-shadow: ${step('var(--steel)')}; }
.ig-in-review { background: var(--glow); box-shadow: ${step('var(--ember)')}; }
.ig-todo { background: transparent; box-shadow: ${step('var(--line-2)')}; }
.ig-blocked { background: var(--red); box-shadow: ${step('var(--red)')}; }
.ig-blocked::before { content: ""; position: absolute; left: 7px; top: calc(-1 * var(--px)); width: 2px; height: 6px; background: var(--hole, var(--card)); }
.ig-skipped { box-sizing: border-box; width: 20px; height: 14px; margin: 0; background: transparent; border: var(--px) dotted var(--line-2); }
.gate-words { font-size: var(--t-sm); font-weight: 600; white-space: nowrap; }
/* The spark: one short strike on an ingot that is approved now and was not before. 4 steps, no soft shadow, no loop, and no motion for a user who asked for none. */
@media (prefers-reduced-motion: no-preference) {
  .ingot.spark { animation: ig-fill 0.6s steps(4) 1; }
  .ingot.spark::after { content: ""; position: absolute; left: 2px; top: -4px; width: var(--px); height: var(--px); background: var(--glow); box-shadow: 5px 2px 0 var(--ember), 10px 0 0 var(--glow); animation: ig-rise 0.6s steps(4) 1 forwards; }
  @keyframes ig-fill { 0% { background: var(--glow); } 50% { background: var(--ember); } 100% { background: var(--steel); } }
  @keyframes ig-rise { 0% { transform: translateY(8px); opacity: 1; } 100% { transform: translateY(-4px); opacity: 0; } }
}
`.trim();

const status = (value) => (Object.prototype.hasOwnProperty.call(GATE_TEXT, value) ? value : 'todo');
// The key of a gate for the spark script: the gate name and its status.
const keyed = (gate) => ` data-gate="${esc(gate.name)}" data-status="${gate.status}"`;

/**
 * The row of ingots for `gates` ([{ name, status }]). With `words`, the row has the open gate and its words next to it ("Planned? needs you").
 * The row is one image for a screen reader: its label lists each gate and its status.
 * `folder` is the stable key of the row (the folder of the ticket): the row gets data-gates, and each gate its name and its status, for the spark script.
 */
export function gatesHtml(gates, { words = true, folder = '' } = {}) {
  if (!gates.length) return '';
  const list = gates.map((gate) => ({ name: gate.name, status: status(gate.status) }));
  const ingots = list.map((gate) => `<span class="ingot ig-${gate.status}"${folder ? keyed(gate) : ''} title="${esc(`${gate.name} ${GATE_TEXT[gate.status]}`)}"></span>`).join('<span class="ig-line"></span>');
  const label = `Gates: ${list.map((gate) => `${gate.name} ${GATE_TEXT[gate.status]}`).join(', ')}`;
  const open = list.find((gate) => gate.status === 'in-review') ?? list.find((gate) => gate.status === 'blocked');
  const text = words && open ? `<span class="gate-words">${esc(open.name)} ${GATE_TEXT[open.status]}</span>` : '';
  return `<span class="gates"${folder ? ` data-gates="${esc(folder)}"` : ''}><span class="ingots" role="img" aria-label="${esc(label)}">${ingots}</span>${text}</span>`;
}

// The spark. Each gate row has a key (data-gates, the folder of the ticket). At page load the script reads the statuses that it stored for the row
// (forge-ui:gates:<folder>), stores the new ones, and gives the class spark to an ingot that is approved now and was not approved before.
// The first visit of a ticket has no stored value, so it gets no spark. With the storage off, there is no spark.
const sparkScript = client(function () {
  each(document.querySelectorAll('[data-gates]'), function (row) {
    var name = 'forge-ui:gates:' + row.getAttribute('data-gates');
    var now = {};
    var found = [];
    each(row.querySelectorAll('[data-gate]'), function (item) {
      now[item.getAttribute('data-gate')] = item.getAttribute('data-status');
      found.push(item);
    });
    var before = null;
    try { before = JSON.parse(localStorage.getItem(name)); } catch (error) { before = null; }
    try { localStorage.setItem(name, JSON.stringify(now)); } catch (error) { /* The storage is off: no spark. */ }
    if (!before || typeof before !== 'object') return;
    found.forEach(function (item) {
      var ingot = item.classList.contains('ingot') ? item : item.querySelector('.ingot');
      if (ingot && item.getAttribute('data-status') === 'approved' && before[item.getAttribute('data-gate')] !== 'approved') ingot.classList.add('spark');
    });
  });
});

export const gates = {
  name: 'gates',
  css: CSS,
  html: { gatesHtml },
  script: sparkScript,
  demo: () => [{
    title: 'The 5 statuses, one ingot each',
    html: Object.keys(GATE_TEXT).map((value) => `<p style="margin: 6px 0">${gatesHtml([{ name: 'Gate?', status: value }], { words: false })} <span style="color: var(--muted)">${GATE_TEXT[value]}</span></p>`).join(''),
  }, {
    title: 'The gates of a ticket: 1 approved, 1 in review, 1 not open',
    html: gatesHtml([{ name: 'Planned?', status: 'approved' }, { name: 'Shippable?', status: 'in-review' }, { name: 'Sendable?', status: 'todo' }]),
  }],
};
