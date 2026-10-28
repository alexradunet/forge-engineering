// Briefing tab, from briefing.json (ported from Open-TicketBriefing.ps1).
import { $, $$, esc, ext } from './util.js';

const BTABS = [['overview', '🎯 Overview'], ['history', '🕰️ History'], ['concepts', '🧩 Concepts'], ['related', '🔗 Related work'], ['people', '👥 People'], ['questions', '❓ Open questions']];
let bTab = 'overview';

export function briefing(D) {
  const meta = Object.entries(D.meta ?? {}).map(([k, v]) => `<span class="pill"><span class="faint">${esc(k)}</span> ${esc(v)}</span>`).join('');
  return `${D.summary ? `<p class="b-intro">${esc(D.summary)}</p>` : ''}<div class="b-meta">${meta}</div>
<div class="seg b-nav" role="tablist">${BTABS.map(([id, l]) => `<button role="tab" class="${id === bTab ? 'on' : ''}" data-b="${id}">${l}</button>`).join('')}</div><div id="bsec"></div>`;
}

export function wireBriefing(D, key) {
  const sec = $('#bsec');
  const show = (id) => {
    bTab = id;
    $$('[data-b]').forEach((b) => b.classList.toggle('on', b.dataset.b === id));
    sec.innerHTML = '';
    sec.onchange = null;
    BSECTIONS[id](sec, D, key);
  };
  $('.b-nav').onclick = (e) => { const b = e.target.closest('[data-b]'); if (b) show(b.dataset.b); };
  show(bTab);
}

const BSECTIONS = {
  overview(sec, D) {
    sec.innerHTML = `<div class="split"><div class="stack">
<section class="card"><h3>❗ The problem</h3>${(D.problem ?? []).map((p) => `<p>${esc(p)}</p>`).join('')}</section>
<section class="card"><h3>💥 Why it matters</h3><p>${esc(D.impact ?? '')}</p></section>
<section class="card"><h3>🧭 Affected features</h3>${(D.features ?? []).map((f) => `<p><b>${esc(f.name)}</b> <span class="faint">— ${esc(f.note ?? '')}</span></p>`).join('')}</section>
</div><section class="card"><h3>📌 Key facts</h3><ul>${(D.facts ?? []).map((f) => `<li>${esc(f.text)} ${f.link ? ext('source ↗', f.link) : ''}</li>`).join('')}</ul></section></div>`;
  },
  history(sec, D) {
    sec.innerHTML = '<div class="toolbar"><input type="search" placeholder="Filter history…" id="hq" aria-label="Filter history"></div><p class="faint">Click an event to show its details.</p><div class="tlb" id="tl"></div>';
    const render = (q) => {
      $('#tl').innerHTML = (D.timeline ?? []).filter((e) => JSON.stringify(e).toLowerCase().includes(q)).map((e) => `<div class="ev ${esc(e.kind ?? '')}"><div class="d">${esc(e.date)}${e.ref ? ` · ${ext(e.ref, e.link)}` : ''}</div><b>${esc(e.title)}</b><div class="body">${esc(e.detail ?? '')}</div></div>`).join('') || '<p class="empty">No events match.</p>';
    };
    render('');
    $('#hq').oninput = (e) => render(e.target.value.toLowerCase());
    $('#tl').onclick = (e) => { const v = e.target.closest('.ev'); if (v && !e.target.closest('a')) v.classList.toggle('open'); };
  },
  concepts(sec, D) {
    const C = D.concepts ?? [], L = D.links ?? [];
    sec.innerHTML = '<div class="split"><svg class="graph" id="g" viewBox="0 0 800 480" role="img" aria-label="Concept graph"></svg><section class="card" id="cd"><h3>Click a concept</h3><p class="faint">Select a node to see what it is and how it relates to this ticket.</p></section></div>';
    const cores = C.filter((c) => c.core), pos = {};
    C.forEach((c, i) => {
      const a = (2 * Math.PI * i) / Math.max(C.length, 1);
      const r = c === cores[0] ? 0 : c.core ? 90 : 200;
      pos[c.id] = [400 + r * Math.cos(a) * 1.5, 240 + r * Math.sin(a)];
    });
    const g = $('#g');
    g.innerHTML = L.filter((l) => pos[l.from] && pos[l.to]).map((l) => `<line data-a="${esc(l.from)}" data-b="${esc(l.to)}" x1="${pos[l.from][0]}" y1="${pos[l.from][1]}" x2="${pos[l.to][0]}" y2="${pos[l.to][1]}"><title>${esc(l.label ?? '')}</title></line>`).join('')
      + C.map((c) => `<g class="n" data-id="${esc(c.id)}" transform="translate(${pos[c.id][0]},${pos[c.id][1]})"><circle r="${c.core ? 30 : 22}"/><text y="${c.core ? 46 : 38}">${esc(c.name)}</text></g>`).join('');
    const select = (id) => {
      const c = C.find((x) => x.id === id); if (!c) return;
      const rel = L.filter((l) => l.from === id || l.to === id), nb = new Set(rel.flatMap((l) => [l.from, l.to]));
      g.querySelectorAll('.n').forEach((n) => { n.classList.toggle('sel', n.dataset.id === id); n.classList.toggle('dim', !nb.has(n.dataset.id) && n.dataset.id !== id); });
      g.querySelectorAll('line').forEach((l) => l.classList.toggle('hl', l.dataset.a === id || l.dataset.b === id));
      $('#cd').innerHTML = `<h3>${esc(c.name)}</h3><p>${esc(c.what ?? '')}</p><p><b>In this ticket:</b> ${esc(c.role ?? '')}</p>
<div>${rel.map((l) => { const o = l.from === id ? l.to : l.from; const oc = C.find((x) => x.id === o); return `<span class="tag" data-go="${esc(o)}">${esc(oc ? oc.name : o)}${l.label ? ` · ${esc(l.label)}` : ''}</span>`; }).join('')}</div>
${(c.refs ?? []).map((r) => `<p>📖 ${ext(r.title, r.link)}</p>`).join('')}`;
    };
    g.onclick = (e) => { const n = e.target.closest('.n'); if (n) select(n.dataset.id); };
    $('#cd').onclick = (e) => { const t = e.target.closest('[data-go]'); if (t) select(t.dataset.go); };
    const first = cores[0] ?? C[0]; if (first) select(first.id);
  },
  related(sec, D) {
    sec.innerHTML = '<div class="toolbar"><input type="search" placeholder="Filter related work…" id="rq" aria-label="Filter related work"></div><div class="bgrid" id="rl"></div>';
    const render = (q) => {
      $('#rl').innerHTML = (D.related ?? []).filter((r) => JSON.stringify(r).toLowerCase().includes(q)).map((r) => `<section class="card"><h3>${ext(r.title, r.link)}</h3><span class="pill">${esc(r.type ?? '')}${r.status ? ` · ${esc(r.status)}` : ''}</span><p>${esc(r.relation ?? '')}</p></section>`).join('') || '<p class="empty">No related work matches.</p>';
    };
    render('');
    $('#rq').oninput = (e) => render(e.target.value.toLowerCase());
  },
  people(sec, D) {
    sec.innerHTML = `<div class="bgrid">${(D.people ?? []).map((p) => `<section class="card"><h3>${esc(p.name)}</h3><div class="faint">${esc(p.role ?? '')}</div><p>${esc(p.why ?? '')}</p>${(p.ask ?? []).length ? `<ul>${p.ask.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}</section>`).join('') || '<p class="empty">No people listed.</p>'}</div>`;
  },
  questions(sec, D, key) {
    const sk = `briefing-${key}`;
    const done = JSON.parse(localStorage.getItem(sk) ?? '{}');
    sec.innerHTML = `<p class="faint">Tick what you already know. These topics come up in the interview. Ticks stay in this browser only.</p>${(D.questions ?? []).map((q, i) => `<div class="card q"><label><input type="checkbox" data-i="${i}" ${done[i] ? 'checked' : ''}> ${esc(q.text)}</label><div class="faint">${esc(q.why ?? '')}</div></div>`).join('')}`;
    sec.onchange = (e) => { done[e.target.dataset.i] = e.target.checked; localStorage.setItem(sk, JSON.stringify(done)); };
  },
};
