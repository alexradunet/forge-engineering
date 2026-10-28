// Router and live updates. Routes: #/ (focus) · #/KEY · #/KEY/briefing · #/KEY/<doc path>
import { $, $$, esc, skeleton, newRoute, StaleRoute } from './util.js';
import { renderFocus } from './board.js';
import { renderTicket } from './ticket.js';

// The kanban (#/board) was removed; old links land on the focus view.
if (/^#\/?board\/?$/.test(location.hash)) history.replaceState(null, '', '#/');

function parse() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length || (parts[0] === 'board' && parts.length === 1)) return { view: 'focus' };
  return { view: 'ticket', key: parts[0].toUpperCase(), sub: parts.slice(1).join('/') || null };
}

let seq = 0;
async function route({ quiet = false } = {}) {
  const r = parse();
  const mine = ++seq;
  newRoute();
  if (r.view === 'focus') $('#crumb').innerHTML = '';
  if (!quiet) $('#app').innerHTML = skeleton(3);
  try {
    if (r.view === 'focus') await renderFocus();
    else await renderTicket(r.key, r.sub);
  } catch (e) {
    if (e instanceof StaleRoute) return r;
    if (mine === seq) $('#app').innerHTML = `<p class="error">⚠️ ${esc(e.message)}</p>`;
  }
  return r;
}

window.addEventListener('hashchange', () => { window.scrollTo(0, 0); route(); });
route();

const live = $('#live');
const es = new EventSource('/api/events');
es.onopen = () => live.classList.add('on');
es.onerror = () => live.classList.remove('on');
es.addEventListener('change', async (e) => {
  const { folders = [] } = JSON.parse(e.data);
  const r = parse();
  if (r.view === 'ticket' && !folders.includes(r.key.toLowerCase())) return;
  if (document.activeElement?.id === 'q') return; // keep the search box while typing
  const y = window.scrollY;
  const open = $$('details[open]').map((d) => d.id).filter(Boolean);
  await route({ quiet: true });
  open.forEach((id) => { const d = document.getElementById(id); if (d) d.open = true; });
  window.scrollTo(0, y);
  for (const f of folders) $$(`.tc[data-folder="${CSS.escape(f)}"]`).forEach((c) => c.classList.add('flash'));
});
