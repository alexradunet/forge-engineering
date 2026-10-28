// Shared helpers, state metadata, and the ticket card of the focus view.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** Link only for http(s) targets; anything else renders as plain text. */
export const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '');
export const ext = (t, u) => (safeUrl(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>` : esc(t));
export const vscode = (p) => `vscode://file/${String(p).replace(/\\/g, '/')}`;
export const docHref = (key, file) => `#/${encodeURIComponent(key)}/${String(file).split('/').map(encodeURIComponent).join('/')}`;

export const PHASES = [['start', '🚀', 'Start'], ['investigate', '🔎', 'Investigate'], ['plan', '📝', 'Plan'], ['implement', '🛠️', 'Implement'], ['review', '👀', 'Review'], ['closed', '✅', 'Closed']];
export const PHASE_LABEL = Object.fromEntries(PHASES.map(([k, , l]) => [k, l]));
export const STATE = {
  'needs-me': { emoji: '🟡', label: 'Needs you' },
  go: { emoji: '🟢', label: 'Go' },
  active: { emoji: '▶️', label: 'In progress' },
  waiting: { emoji: '⏳', label: 'Waiting' },
  blocked: { emoji: '🔴', label: 'Blocked' },
  done: { emoji: '✅', label: 'Done' },
};
export const GATE_LABEL = { todo: 'Not started', 'in-review': 'In review', approved: 'Approved', skipped: 'Skipped', blocked: 'Blocked' };
const PR_CLASS = { merged: 'ok', open: 'info', draft: '', closed: 'bad', abandoned: 'bad' };

/** Small inline Markdown: `code`, **bold**, [text](http-link), bare URLs. Everything else is escaped. */
export function inline(s) {
  const keep = [];
  const hold = (h) => `\u0000${keep.push(h) - 1}\u0000`;
  let t = String(s ?? '');
  t = t.replace(/`([^`]+)`/g, (_, c) => hold(`<code>${esc(c)}</code>`));
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, a, u) => hold(ext(a, u)));
  t = t.replace(/https?:\/\/[^\s<>)]+/g, (u) => hold(ext(u, u)));
  t = esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i]);
}

export function ago(ms) {
  if (!ms) return '—';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)} h ago`;
  const d = Math.floor(m / 1440);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
/** Relative time with the exact time as a tooltip. */
export const when = (ms) => `<time title="${esc(ms ? new Date(ms).toLocaleString() : '')}">${esc(ago(ms))}</time>`;

// Each route() starts a new generation; responses from an older route are dropped so they cannot overwrite the page.
let generation = 0;
export const newRoute = () => ++generation;
export class StaleRoute extends Error {}

export async function api(path) {
  const g = generation;
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${r.statusText}`);
  const body = await r.json();
  if (g !== generation) throw new StaleRoute(path);
  return body;
}

export const skeleton = (rows = 3) => `<div class="skel"><i style="width:40%"></i>${'<i class="big"></i>'.repeat(rows)}</div>`;

/** Splits "colleague: Anna — review" into who and what. */
export function parseWaiting(s) {
  const m = /^\s*(you|colleague|outside)\s*:\s*(.*)$/i.exec(s ?? '');
  return m ? { who: m[1].toLowerCase(), what: m[2] } : { who: s ? 'other' : '', what: s ?? '' };
}
export const WHO_LABEL = { you: 'You', colleague: 'Colleague', outside: 'Outside', other: 'Waiting' };

/** Focus lane of an open ticket. */
export function laneOf(t) {
  if (t.phase === 'closed' || t.state === 'done') return 'done';
  if (t.state === 'blocked') return 'blocked';
  if (t.waitsOnMe) return 'me';
  if (t.state === 'waiting' || /^\s*(colleague|outside)\s*:/i.test(t.waitingOn ?? '')) return 'waiting';
  return 'active';
}

export const stateClass = (t) => `s-${STATE[t.state] ? t.state : 'active'}`;
export const statePill = (t) => (STATE[t.state] ? `<span class="pill state ${stateClass(t)}">${STATE[t.state].emoji} ${esc(STATE[t.state].label)}</span>` : '');
export const prPills = (prs) => (prs ?? []).map((p) => {
  const inner = `⑂ ${esc(p.label)} · ${esc(p.state)}`;
  const cls = `pill ${PR_CLASS[p.state] ?? ''}`;
  return safeUrl(p.url) ? `<a class="${cls}" href="${esc(p.url)}" target="_blank" rel="noopener" title="Pull request · ${esc(p.state)}">${inner}</a>` : `<span class="${cls}">${inner}</span>`;
}).join('');
export const gateBar = (gates) => (gates.length
  ? `<span class="gbar" title="${esc(gates.map((g) => `${g.name} ${GATE_LABEL[g.status] ?? g.status}`).join(' · '))}">${gates.map((g) => `<i class="${esc(g.status)}"></i>`).join('')}</span>`
  : '');

/** The one line that tells what happens next on this ticket. */
export function actionLine(t, lane) {
  const review = t.gates.filter((g) => g.status === 'in-review');
  if (lane === 'me' && review.length) {
    const links = review.map((g) => (g.doc ? `<a class="gate-link" href="${esc(docHref(t.key, g.doc))}">Review ${esc(g.name)}</a>` : `<b>Review ${esc(g.name)}</b>`)).join(', ');
    return `<div class="tc-act"><span class="who">You</span><span>${links}</span></div>`;
  }
  const w = parseWaiting(t.waitingOn);
  if (w.who && w.who !== 'other' && (lane === 'waiting' || lane === 'me')) return `<div class="tc-act"><span class="who">${esc(WHO_LABEL[w.who])}</span><span>${inline(w.what)}</span></div>`;
  if (t.next) return `<div class="tc-act"><span class="who">Next</span><span>${inline(t.next)}</span></div>`;
  return '';
}

/** Cards show only open change requests; merged and closed ones collapse into one count. */
function cardPrs(prs = []) {
  const done = prs.filter((p) => /^(merged|abandoned|closed)$/i.test(p.state));
  const open = prs.filter((p) => !done.includes(p));
  return prPills(open) + (done.length ? `<span class="pill ghost" title="${esc(done.map((p) => `${p.label} · ${p.state}`).join('\n'))}">⑂ ${done.length} closed</span>` : '');
}

export function card(t) {
  const lane = laneOf(t);
  return `<article class="card tc lane-${lane}" data-key="${esc(t.key)}" data-folder="${esc(t.folder)}" tabindex="0">
<div class="tc-meta"><span class="key">${esc(t.key)}</span><span>${esc(PHASE_LABEL[t.phase] ?? t.phase)}</span>${t.track ? `<span>· Track ${esc(t.track)}</span>` : ''}<span class="prs">${cardPrs(t.changes)}</span></div>
<div class="tc-title">${esc(t.title || t.key)}</div>
${actionLine(t, lane)}
<div class="tc-foot">${gateBar(t.gates)}<span class="spacer"></span>${t.problemCount ? `<span class="warn" title="Run board.mjs --check">⚠️ ${t.problemCount}</span>` : ''}${when(t.updatedMs)}</div>
</article>`;
}

/** Opens the ticket when a card is clicked or Enter is pressed (links inside the card still work). */
export function wireCards(root) {
  const open = (e) => {
    const c = e.target.closest('.tc');
    if (c && !e.target.closest('a')) location.hash = `#/${c.dataset.key}`;
  };
  root.onclick = open;
  root.onkeydown = (e) => { if (e.key === 'Enter') open(e); };
}
