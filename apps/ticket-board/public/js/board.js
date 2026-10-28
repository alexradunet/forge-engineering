// Home: the focus view (#/) groups open tickets by who must act, and lists the 10 newest done tickets.
import { $, esc, api, card, wireCards, laneOf, vscode } from './util.js';

const LANES = [
  ['me', '🟡', 'Your move', 'A gate or a decision waits for you.'],
  ['blocked', '🔴', 'Blocked', 'Something failed and stops the work.'],
  ['active', '▶️', 'In progress', 'The agent can continue.'],
  ['waiting', '⏳', 'Waiting on others', 'A colleague, a review, or a build.'],
];
const EMPTY = { me: 'Nothing waits on you. 🎉', blocked: 'Nothing is blocked.', active: 'No ticket is in progress.', waiting: 'Nothing waits on others.' };

const DONE_MAX = 10;

/** The 10 newest done items: closed tickets still in raw\tickets first, then the wiki pages. */
function recentDone(doneTickets, closed, closedTotal) {
  const cards = doneTickets.slice(0, DONE_MAX);
  const pages = closed.slice(0, DONE_MAX - cards.length);
  const total = doneTickets.length + (closedTotal ?? closed.length);
  return { cards, pages, total, shown: cards.length + pages.length };
}
const moreNote = (d) => (d.total > d.shown ? `<p class="faint" style="margin:8px 4px 0;font-size:12px">Showing the ${d.shown} newest of ${d.total}. Older ones are in the wiki <code>tickets</code> folder.</p>` : '');

const closedList = (closed) => (closed.length
  ? `<div class="closed-list">${closed.map((c) => `<a class="closed-item" href="${esc(vscode(c.file))}" title="Open the wiki page in VS Code"><span class="key">${esc(c.key)}</span><span class="t">${esc(c.title)}</span><span class="faint">${esc(c.updated)}</span></a>`).join('')}</div>`
  : '');

export async function renderFocus() {
  const { tickets, closed, closedTotal } = await api('/api/board');
  document.title = '🎫 Focus · Ticket board';
  const by = Object.fromEntries([...LANES.map(([k]) => [k, []]), ['done', []]]);
  for (const t of tickets) by[laneOf(t)].push(t);
  for (const list of Object.values(by)) list.sort((a, b) => b.updatedMs - a.updatedMs);

  const stats = LANES.map(([k, e, l]) => `<button class="stat lane-${k}${by[k].length ? '' : ' zero'}" data-jump="${k}"><b>${by[k].length}</b><span>${e} ${l}</span></button>`).join('');
  const lanes = LANES.map(([k, e, l, hint]) => `<section class="lane lane-${k}" id="lane-${k}">
<div class="lane-h"><h2>${e} ${l}</h2><span class="count">${by[k].length}</span><span class="hint">${hint}</span></div>
${by[k].length ? `<div class="cards">${by[k].map(card).join('')}</div>` : `<p class="empty">${EMPTY[k]}</p>`}
</section>`).join('');
  const d = recentDone(by.done, closed, closedTotal);
  const done = `<details class="lane lane-done" id="lane-done"><summary><div class="lane-h"><h2>✅ Recently done</h2><span class="count">${d.total}</span></div></summary>
${d.cards.length ? `<div class="cards" style="margin-bottom:12px">${d.cards.map(card).join('')}</div>` : ''}${closedList(d.pages)}${d.shown ? moreNote(d) : '<p class="empty">No closed tickets yet.</p>'}</details>`;

  const app = $('#app');
  app.innerHTML = `<div class="summary">${stats}</div><div id="lanes">${lanes}${done}</div>`;
  wireCards($('#lanes'));
  $('.summary').onclick = (e) => {
    const b = e.target.closest('[data-jump]');
    if (b) document.getElementById(`lane-${b.dataset.jump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}

