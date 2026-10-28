// Ticket page: header, tabs, and the overview (action panel, journey of phases and gates, log, facts).
import { $, esc, inline, api, when, docHref, vscode, safeUrl, StaleRoute, PHASES, GATE_LABEL, STATE, statePill, prPills, laneOf, parseWaiting, WHO_LABEL } from './util.js';
import { documents, wireDocument } from './docs.js';
import { briefing, wireBriefing } from './briefing.js';

// Where each gate sits on the journey. Unknown gates go to the phase they are named after, or the current phase.
const GATE_PHASE = [
  [/understood|briefed|agreed/i, 'start'],
  [/diagnosed/i, 'investigate'],
  [/designed/i, 'plan'],
  [/sendable/i, 'implement'],
  [/shippable|evidence/i, 'review'],
  [/learned/i, 'closed'],
];
const gatePhase = (g, current) => GATE_PHASE.find(([re]) => re.test(g.name))?.[1] ?? current;

function journey(t) {
  const i = PHASES.findIndex(([k]) => k === t.phase);
  return `<div class="journey">${PHASES.map(([k, e, l], j) => {
    const gates = t.gates.filter((g) => gatePhase(g, t.phase) === k).map((g) => {
      const tip = [GATE_LABEL[g.status] ?? g.status, g.date, g.hash ? `hash ${g.hash}` : '', g.need === 'recommended' ? 'recommended' : '', g.note].filter(Boolean).join(' · ');
      const sub = g.status === 'approved' ? (g.date ?? 'approved') : g.status === 'todo' ? (g.need === 'recommended' ? 'optional' : '') : (GATE_LABEL[g.status] ?? g.status);
      const inner = `<b>${esc(g.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}`;
      const href = g.doc ? docHref(t.key, g.doc) : '';
      return href ? `<a class="g ${esc(g.status)}" href="${esc(href)}" title="${esc(tip)}">${inner}</a>` : `<span class="g ${esc(g.status)}" title="${esc(tip)}">${inner}</span>`;
    }).join('');
    const cls = j < i ? 'past' : j === i ? 'now' : '';
    return `<div class="ph ${cls}"><div class="node">${j < i ? '✓' : e}</div><div class="nm">${l}</div><div class="gt">${gates}</div></div>`;
  }).join('')}</div>`;
}

function actionPanel(t) {
  const lane = laneOf(t);
  const review = t.gates.filter((g) => g.status === 'in-review');
  const w = parseWaiting(t.waitingOn);
  const label = lane === 'me' ? '🟡 Your move' : lane === 'blocked' ? '🔴 Blocked' : lane === 'waiting' ? '⏳ Waiting' : lane === 'done' ? '✅ Done' : '▶️ Next step';
  const cta = review.filter((g) => g.doc).map((g) => `<a class="btn cta-need" href="${esc(docHref(t.key, g.doc))}">📄 Review ${esc(g.name)}</a>`).join('');
  return `<section class="action lane-${lane}">
<div><div class="lbl">${label}</div><div class="nx">${inline(t.next || 'No next step in the README.')}</div>
${w.who ? `<div class="wait">Waiting on <b>${esc(WHO_LABEL[w.who])}</b>: ${inline(w.what)}</div>` : ''}</div>
<div class="cta">${cta}</div></section>`;
}

function logList(entries) {
  if (!entries.length) return '<p class="empty">No log entries yet.</p>';
  return `<ul class="log">${entries.map((e) => {
    const m = /^(\d{4}-\d{2}-\d{2})\s*[—–-]?\s*(.*)$/.exec(e.title);
    const lines = e.body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^[-*]\s+/, ''));
    const li = (ls) => `<ul>${ls.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`;
    const more = lines.length > 3 ? `<details><summary>Show ${lines.length - 3} more</summary>${li(lines.slice(3))}</details>` : '';
    return `<li><div class="d">${esc(m ? m[1] : '')}</div><div class="t">${inline(m ? m[2] || 'Update' : e.title)}</div>${lines.length ? `<div class="b">${li(lines.slice(0, 3))}${more}</div>` : ''}</li>`;
  }).join('')}</ul>`;
}

const copyBtn = (text) => `<button class="copy" data-copy="${esc(text)}" title="Copy">⧉</button>`;

function facts(t) {
  const wt = t.worktree ? (/^[a-z]:[\\/]/i.test(t.worktree.split(' — ').pop() ?? '') ? `<a href="${esc(vscode(t.worktree.split(' — ').pop()))}">${esc(t.worktree)}</a>` : inline(t.worktree)) : '<span class="faint">—</span>';
  return `<dl class="facts">
<dt>State</dt><dd>${statePill(t) || '<span class="faint">—</span>'}</dd>
<dt>Track</dt><dd>${t.track ? esc(t.track) : '<span class="faint">not set</span>'}</dd>
<dt>Branch</dt><dd>${t.branch ? `<code title="${esc(t.branch)}">${esc(t.branch)}</code>${copyBtn(t.branch)}` : '<span class="faint">—</span>'}</dd>
<dt>Worktree</dt><dd>${wt}</dd>
<dt>${esc(`${t.labels?.change ?? 'PR'}s`)}</dt><dd>${prPills(t.changes) || '<span class="faint">—</span>'}</dd>
<dt>${esc(t.labels?.item ?? 'Work item')}</dt><dd>${safeUrl(t.item) ? `<a href="${esc(t.item)}" target="_blank" rel="noopener">${esc(t.key)} ↗</a>` : '—'}</dd>
<dt>Updated</dt><dd>${when(t.updatedMs)}</dd>
</dl>`;
}

function overview(t) {
  const probs = t.problems.length
    ? `<details class="warnbar"><summary>⚠️ ${t.problems.length} frontmatter problem${t.problems.length > 1 ? 's' : ''}. Run <code>board.mjs --check --ticket ${esc(t.key)}</code>.</summary><ul>${t.problems.map((p) => `<li><a href="${esc(vscode(`${t.dir}/${p.file}`))}">${esc(p.file)}</a>: ${esc(p.problem)}</li>`).join('')}</ul></details>`
    : '';
  return `${probs}${actionPanel(t)}
<section class="card"><h2 class="label">🚦 Journey</h2>${t.gates.length ? journey(t) : `${journey(t)}<p class="faint" style="margin:8px 0 0">No gates in the README frontmatter.</p>`}</section>
<div class="two">
<section class="card"><h2 class="label">🕰️ Recent work</h2>${logList(t.log)}<p style="margin:4px 0 0"><a href="${esc(docHref(t.key, 'log.md'))}">Open the full log →</a></p></section>
<section class="card"><h2 class="label">📌 Facts</h2>${facts(t)}</section>
</div>`;
}

export async function renderTicket(key, sub) {
  let t;
  try { t = await api(`/api/ticket/${encodeURIComponent(key)}`); } catch (e) {
    if (e instanceof StaleRoute) throw e;
    $('#app').innerHTML = `<p class="empty">Unknown ticket ${esc(key)}. <a href="#/">Back to the board</a>.</p>`;
    return;
  }
  const tab = !sub ? 'overview' : sub === 'briefing' ? 'briefing' : 'docs';
  document.title = `${STATE[t.state]?.emoji ?? ''} ${t.key} · ${t.title}`;
  $('#crumb').innerHTML = `/ <span class="key">${esc(t.key)}</span>`;
  const firstDoc = t.docs.some((d) => d.file === 'context.md') ? 'context.md' : (t.docs[0]?.file ?? 'README.md');
  const tabs = [['overview', '🎯 Overview', `#/${t.key}`], ...(t.hasBriefing ? [['briefing', '🖼️ Briefing', `#/${t.key}/briefing`]] : []), ['docs', `📁 Documents · ${t.docs.length}`, docHref(t.key, firstDoc)]];

  const body = tab === 'overview' ? overview(t) : tab === 'briefing' ? briefing(t.briefing) : await documents(t, sub);
  $('#app').innerHTML = `<a class="back" href="#/">← All tickets</a>
<header class="t-head"><div class="main"><div class="meta">${statePill(t)}<span class="key">${esc(t.key)}</span>${t.track ? `<span class="pill">Track ${esc(t.track)}</span>` : ''}</div><h1>${esc(t.title || t.key)}</h1></div>
<div class="acts">${prPills(t.changes)}${safeUrl(t.item) ? `<a class="btn" href="${esc(t.item)}" target="_blank" rel="noopener">${esc(t.labels?.item ?? 'Work item')} ↗</a>` : ''}<a class="btn" href="${esc(vscode(`${t.dir}/README.md`))}" title="Open README.md in VS Code">✏️ README</a></div></header>
<nav class="tabs">${tabs.map(([id, l, h]) => `<a href="${esc(h)}" class="${id === tab ? 'on' : ''}">${esc(l)}</a>`).join('')}</nav>
<div id="tab">${body}</div>`;

  $('#app').onclick = (e) => {
    const c = e.target.closest('[data-copy]');
    if (!c) return;
    navigator.clipboard?.writeText(c.dataset.copy).then(() => { c.textContent = '✓'; setTimeout(() => { c.textContent = '⧉'; }, 1200); });
  };
  if (tab === 'briefing') wireBriefing(t.briefing, t.key);
  if (tab === 'docs') wireDocument();
}
