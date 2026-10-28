// Documents tab: grouped file list, rendered document, table of contents, and local Mermaid rendering.
import { $, $$, esc, api, docHref, vscode } from './util.js';

const GROUPS = [
  ['Gate documents', (d) => ['context', 'interview', 'investigation', 'plan-draft', 'plan', 'review', 'close-draft', 'evidence-testing', 'test-plan'].includes(d.type)],
  ['Working files', (d) => ['ticket', 'item-snapshot', 'map', 'decisions', 'troubleshooting', 'log'].includes(d.type) || d.file === 'README.md'],
  ['Outbox', (d) => d.file.startsWith('outbox/')],
  ['Evidence', (d) => d.file.startsWith('evidence/')],
];
const OUTBOX_CLASS = { draft: 'warn', approved: 'info', sent: 'ok', dropped: 'ghost' };

/** "📤 Outbox draft — APP-1: PR text" -> "📤 Outbox draft — PR text". */
const shortTitle = (d, key) => {
  const t = String(d.title || d.file).replace(new RegExp(`\\s*\\b${key}\\b:?\\s*`, 'g'), ' ').replace(/\s+[—–-]\s*$/, '').replace(/\s{2,}/g, ' ').trim();
  return t || d.file;
};

export async function documents(t, file) {
  const used = new Set();
  const groups = GROUPS.map(([label, fn]) => {
    const ds = t.docs.filter((d) => !used.has(d.file) && fn(d));
    ds.forEach((d) => used.add(d.file));
    return [label, ds];
  });
  const other = t.docs.filter((d) => !used.has(d.file));
  if (other.length) groups.push(['Other', other]);

  let sel = file && t.docs.some((d) => d.file === file) ? file : null;
  if (!sel && file) sel = t.docs.find((d) => d.file.startsWith(file.replace(/\/?$/, '/')))?.file ?? null;
  sel ??= (t.docs.find((d) => d.file === 'context.md') ?? t.docs[0])?.file;

  const nav = groups.filter(([, ds]) => ds.length).map(([label, ds]) => `<h3 class="label">${esc(label)} <span class="count">${ds.length}</span></h3>${ds.map((d) => {
    const pill = d.file.startsWith('outbox/') && d.status ? `<span class="pill ${OUTBOX_CLASS[d.status] ?? ''}">${esc(d.status)}</span>`
      : !d.hasFrontmatter ? '<span class="nofm" title="No frontmatter">●</span>' : '';
    return `<a href="${esc(docHref(t.key, d.file))}" class="${d.file === sel ? 'on' : ''}" title="${esc(d.title)}"><span class="dt">${esc(shortTitle(d, t.key))}</span><span class="df">${esc(d.file)}</span>${pill}</a>`;
  }).join('')}`).join('');

  let pane = '<p class="empty">No documents.</p>';
  if (sel) {
    const doc = await api(`/api/doc/${encodeURIComponent(t.key)}/${sel.split('/').map(encodeURIComponent).join('/')}`);
    const fm = Object.entries(doc.frontmatter ?? {})
      .filter(([k, v]) => !['ticket', 'gates', 'changes', 'title', 'key'].includes(k) && (typeof v !== 'object' || (Array.isArray(v) && v.every((x) => typeof x !== 'object'))))
      .map(([k, v]) => `<span class="pill" title="${esc(k)}"><span class="faint">${esc(k)}</span> ${esc(Array.isArray(v) ? v.join(', ') : v)}</span>`).join('');
    const state = fm || (doc.error ? `<span class="pill bad">${esc(doc.error)}</span>` : '<span class="pill warn">no frontmatter</span>');
    pane = `<div class="doc-h"><div style="flex:1;min-width:0"><div class="path">${esc(sel)}</div><div class="fm">${state}</div></div><a class="btn" href="${esc(vscode(doc.path))}">✏️ Open in VS Code</a></div><article class="md" id="md">${doc.html}</article>`;
  }
  return `<div class="docs" id="docs"><nav class="card dnav" aria-label="Documents">${nav}</nav><div class="card doc">${pane}</div><aside class="toc" id="toc" hidden></aside></div>`;
}

const slug = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';

/** Adds heading anchors, the table of contents, table wrappers, callouts, and Mermaid diagrams. */
export function wireDocument() {
  const md = $('#md');
  if (!md) return;

  for (const table of $$('table', md)) {
    const w = document.createElement('div');
    w.className = 'tw';
    table.replaceWith(w);
    w.append(table);
  }
  for (const bq of $$('blockquote', md)) {
    const p = bq.querySelector('p');
    const m = p && /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(p.textContent);
    if (!m) continue;
    bq.classList.add(`c-${m[1].toLowerCase()}`);
    const first = p.firstChild;
    if (first?.nodeType === Node.TEXT_NODE) first.textContent = first.textContent.replace(/^\s*\[![A-Z]+\]\s*/i, '');
  }

  const seen = new Map();
  const heads = $$('h2, h3', md);
  for (const h of heads) {
    let id = slug(h.textContent);
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    if (n) id += `-${n}`;
    h.id = `h-${id}`;
    const a = document.createElement('a');
    a.className = 'anchor';
    a.href = '#';
    a.dataset.to = h.id;
    a.textContent = '#';
    a.setAttribute('aria-label', 'Scroll to this section');
    h.append(a);
  }

  const toc = $('#toc');
  if (heads.length >= 3) {
    toc.innerHTML = `<h3 class="label">On this page</h3>${heads.map((h) => `<a href="#" data-to="${h.id}" class="${h.tagName.toLowerCase()}">${esc(h.firstChild?.textContent ?? h.textContent)}</a>`).join('')}`;
    toc.hidden = false;
    $('#docs').classList.add('has-toc');
  }
  $('#docs').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-to]');
    if (!a) return;
    e.preventDefault();
    document.getElementById(a.dataset.to)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  spy();
  renderMermaid(md);
}

function spy() {
  const links = $$('#toc a[data-to]');
  if (!links.length) return;
  let current = null;
  const update = () => {
    if (!document.body.contains(links[0])) return window.removeEventListener('scroll', update);
    let on = links[0];
    const line = Math.max(120, window.innerHeight / 3);
    for (const a of links) {
      const h = document.getElementById(a.dataset.to);
      if (h && h.getBoundingClientRect().top < line) on = a;
    }
    if (on !== current) { current?.classList.remove('on'); on.classList.add('on'); current = on; }
  };
  window.addEventListener('scroll', update, { passive: true });
  update();
}

let mermaidReady = null;
function loadMermaid() {
  mermaidReady ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/mermaid.min.js';
    s.onload = () => {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', fontFamily: 'Segoe UI, system-ui, sans-serif' });
      resolve(window.mermaid);
    };
    s.onerror = () => { mermaidReady = null; reject(new Error('Mermaid did not load')); };
    document.head.append(s);
  });
  return mermaidReady;
}

let mermaidSeq = 0;
async function renderMermaid(root) {
  const blocks = $$('pre.mermaid-src', root);
  if (!blocks.length) return;
  let mermaid;
  try { mermaid = await loadMermaid(); } catch { return; }
  for (const pre of blocks) {
    try {
      const { svg } = await mermaid.render(`mmd-${++mermaidSeq}`, pre.textContent);
      const div = document.createElement('div');
      div.className = 'mermaid';
      div.innerHTML = svg;
      pre.replaceWith(div);
    } catch {
      pre.title = 'Mermaid could not render this diagram; showing the source.';
      $$(`#dmmd-${mermaidSeq}`).forEach((n) => n.remove());
    }
  }
}
