const labels = {
  'needs-me': 'Needs me',
  go: 'Ready',
  active: 'Active',
  waiting: 'Waiting',
  blocked: 'Blocked',
  done: 'Done',
};

const stateIcons = {
  'needs-me': '🟡',
  go: '🟢',
  active: '▶️',
  waiting: '⏳',
  blocked: '🔴',
  done: '✅',
};

const phases = [
  { id: 'start', label: 'start', icon: '🚀' },
  { id: 'investigate', label: 'investigate', icon: '🔎' },
  { id: 'plan', label: 'plan', icon: '📝' },
  { id: 'implement', label: 'implement', icon: '🛠️' },
  { id: 'review', label: 'review', icon: '👀' },
  { id: 'closed', label: 'closed', icon: '✅' },
];

const docCategories = [
  {
    id: 'core',
    label: '🗺️ Core & Map',
    desc: 'Ticket README, living code map, visual briefing, and approved plans.',
  },
  {
    id: 'gate',
    label: '🚦 Gate Docs',
    desc: 'Context, scope interview, investigation, plan drafts, and code reviews.',
  },
  {
    id: 'evidence',
    label: '🔬 Evidence & Spikes',
    desc: 'Sanitized tool outputs, queries, baselines, and deployed QA checks.',
  },
  {
    id: 'outbox',
    label: '📤 Outbox Drafts',
    desc: 'Draft tracker comments, PR descriptions, and colleague questions.',
  },
  {
    id: 'log',
    label: '🧾 Logs & Decisions',
    desc: 'Dated work log, design decisions, and build/test troubleshooting.',
  },
];

const byId = (id) => document.getElementById(id);
let snapshot = null;
let loading = false;
let selectedKey = null; // null = Overview Grid, string = Focused Ticket Cockpit
let cockpitSection = 'summary'; // 'summary' | 'gates' | 'map' | 'docs' | 'reader'
let activeDocCategory = 'core'; // 'core' | 'gate' | 'evidence' | 'outbox' | 'log' | 'all'
let activeDocPath = null;
let previousSection = 'docs';
let docCache = new Map();
let docRequestSeq = 0;
let mermaidCounter = 0;

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.dataset ??= Object.create(null);
  node.style ??= Object.create(null);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function isSafeHttpUrl(address) {
  try {
    const url = new URL(address);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function link(parent, text, address, className = '') {
  const url = isSafeHttpUrl(address);
  if (!url) {
    parent.append(element('span', `${text}: invalid or unsupported URL`, className));
    return;
  }
  const anchor = element('a', text, className);
  anchor.href = url.href;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  parent.append(anchor);
}

function isNeedsMe(ticket) {
  return ticket.state === 'needs-me'
    || /^(?:you|user):/i.test(ticket.waitingOn || '')
    || (ticket.gates || []).some((gate) => gate.status === 'in-review');
}

function ticketPriority(ticket) {
  if (isNeedsMe(ticket)) return 0;
  const order = { 'needs-me': 0, blocked: 1, go: 2, active: 3, waiting: 4, done: 5 };
  return order[ticket.state] ?? 4;
}

function stripInlineMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1');
}

function showStatus() {
  if (!snapshot) return;
  const count = byId('board').querySelectorAll('article.ticket-card').length;
  const errors = snapshot.errors.length;
  byId('status').textContent = `${count} shown / ${snapshot.tickets.length} tickets · ${errors} read ${errors === 1 ? 'error' : 'errors'} · ${new Date(snapshot.scannedAt).toLocaleTimeString()}`;
}

function updateKpis() {
  if (!snapshot) return;
  const openTickets = snapshot.tickets.filter((t) => t.state !== 'done' && t.phase !== 'closed');
  const needsMeCount = openTickets.filter(isNeedsMe).length;
  let inReviewGates = 0;
  let approvedGates = 0;
  for (const ticket of snapshot.tickets) {
    for (const gate of ticket.gates || []) {
      if (gate.status === 'skipped') continue;
      if (gate.status === 'in-review') inReviewGates++;
      if (gate.status === 'approved') approvedGates++;
    }
  }
  byId('kpi-total').textContent = String(openTickets.length);
  byId('kpi-needs-me').textContent = String(needsMeCount);
  byId('kpi-in-review').textContent = String(inReviewGates);
  byId('kpi-approved').textContent = String(approvedGates);
}

function renderStatePills(currentState) {
  const container = byId('state-pills');
  if (!container || !snapshot) return;
  container.replaceChildren();
  const counts = Object.create(null);
  const includeDone = byId('done').checked;
  for (const t of snapshot.tickets) {
    if (!includeDone && (t.state === 'done' || t.phase === 'closed')) continue;
    counts[t.state] = (counts[t.state] || 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const allBtn = element('button', `All (${total})`, `pill-btn${!currentState ? ' active' : ''}`);
  allBtn.type = 'button';
  allBtn.addEventListener('click', () => {
    byId('state').value = '';
    render();
  });
  container.append(allBtn);

  for (const [value, label] of Object.entries(labels)) {
    if (value === 'done' && !includeDone) continue;
    const count = counts[value] || 0;
    if (!count && currentState !== value) continue;
    const btn = element('button', `${stateIcons[value] || ''} ${label} (${count})`, `pill-btn${currentState === value ? ' active' : ''}`);
    btn.type = 'button';
    btn.dataset.state = value;
    btn.addEventListener('click', () => {
      byId('state').value = currentState === value ? '' : value;
      render();
    });
    container.append(btn);
  }
}

function gateProgressBar(gates) {
  const bar = element('div', undefined, 'gate-bar');
  if (!gates || !gates.length) return bar;
  for (const gate of gates) {
    const seg = element('span', undefined, 'gate-seg');
    seg.dataset.status = gate.status;
    seg.title = `${gate.name}: ${gate.status} (${gate.need})`;
    bar.append(seg);
  }
  return bar;
}

function openTicketCockpit(ticketKey, section = 'summary', docPath = null) {
  selectedKey = ticketKey;
  cockpitSection = section;
  activeDocPath = docPath;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeTicketCockpit() {
  selectedKey = null;
  cockpitSection = 'summary';
  activeDocPath = null;
  render();
}

function workflowLabel(ticket) {
  return ticket.workflow === 'full-v1' ? 'Full workflow' : `Legacy track ${ticket.track}`;
}

function card(ticket) {
  const node = element('article', undefined, 'ticket-card');
  node.dataset.state = ticket.state;
  node.dataset.key = ticket.key;

  const top = element('div', undefined, 'ticket-card-top');
  top.append(element('span', ticket.key, 'key'));

  const badges = element('div', undefined, 'ticket-badges');
  const stateChip = element('span', `${stateIcons[ticket.state] || ''} ${labels[ticket.state] || ticket.state}`, 'chip');
  stateChip.dataset.tone = ticket.state;
  badges.append(stateChip);
  badges.append(element('span', `${ticket.phase} / ${workflowLabel(ticket)}`, 'chip'));
  top.append(badges);
  node.append(top);

  node.append(element('h3', ticket.title));
  node.append(element('p', stripInlineMarkdown(ticket.next), 'next'));

  node.append(gateProgressBar(ticket.gates));

  const approved = (ticket.gates || []).filter((gate) => gate.status === 'approved').length;
  const activeTotal = (ticket.gates || []).filter((gate) => gate.status !== 'skipped').length;
  const docCount = (ticket.docs || []).length;

  const openBtn = element('button', 'Open cockpit →', 'open-cockpit-btn');
  openBtn.type = 'button';
  openBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    openTicketCockpit(ticket.key, 'summary');
  });

  const foot = element('div', undefined, 'ticket-card-foot');
  foot.append(
    element('span', `🚦 ${approved}/${activeTotal} gates · 📄 ${docCount} files`),
    openBtn,
  );
  node.append(foot);

  // Collapsed details for quick inspection & accessibility
  const details = element('details');
  details.append(element('summary', 'Quick metadata'));
  for (const [label, value] of [
    ['Waiting on', ticket.waitingOn],
    ['Branch', ticket.branch],
    ['Worktree', ticket.worktree],
    ['Updated', ticket.updated],
    ['Source', ticket.file],
  ]) {
    if (value) details.append(element('p', `${label}: ${value}`, 'path'));
  }
  if (ticket.item) link(details, 'Work item', ticket.item);
  const gates = element('ul');
  for (const gate of ticket.gates || []) {
    gates.append(element('li', `${gate.name} - ${gate.status} (${gate.need})${gate.doc ? ` / ${gate.doc}` : ''}`));
  }
  details.append(gates);
  for (const finding of ticket.findings ?? []) {
    details.append(element('p', `${finding.code}: ${finding.message} ${finding.remedy}`, 'error'));
  }
  for (const change of ticket.changes || []) {
    const row = element('p');
    link(row, `${change.label || 'Change request'} (${change.state})`, change.url);
    details.append(row);
  }
  node.append(details);

  node.addEventListener('click', (event) => {
    if (event.target.closest('details, a, button, summary')) return;
    openTicketCockpit(ticket.key, 'summary');
  });

  return node;
}

function resolveGateDoc(ticket, gateDoc) {
  if (!gateDoc || !ticket.docs) return null;
  const exact = ticket.docs.find((d) => d.path === gateDoc);
  if (exact) return exact.path;
  if (gateDoc.endsWith('/')) {
    const firstInDir = ticket.docs.find((d) => d.path.startsWith(gateDoc));
    if (firstInDir) return firstInDir.path;
  }
  if (gateDoc === 'plan.draft.md') {
    const planDoc = ticket.docs.find((d) => d.path === 'plan.draft.md' || d.path === 'plan.md');
    if (planDoc) return planDoc.path;
  }
  return null;
}

function renderPhaseStepper(currentPhase) {
  const stepper = element('div', undefined, 'phase-stepper');
  const currentIdx = phases.findIndex((p) => p.id === currentPhase);
  phases.forEach((phase, index) => {
    let cls = 'phase-step';
    if (currentIdx !== -1 && index < currentIdx) cls += ' done';
    else if (index === currentIdx) cls += ' current';
    const step = element('div', undefined, cls);
    const dot = element('span', index < currentIdx ? '✓' : phase.icon, 'phase-dot');
    step.append(dot, element('span', phase.label));
    stepper.append(step);
  });
  return stepper;
}

function openDocumentReader(ticket, docPath, fromSection = cockpitSection) {
  if (fromSection && fromSection !== 'reader') {
    previousSection = fromSection;
  }
  activeDocPath = docPath;
  cockpitSection = 'reader';
  renderCockpit(ticket);
}

function renderCockpitHeader(ticket) {
  const header = byId('cockpit-header');
  header.replaceChildren();

  const topRow = element('div', undefined, 'cockpit-topbar');
  const backBtn = element('button', '← All tickets', 'btn-secondary');
  backBtn.type = 'button';
  backBtn.addEventListener('click', closeTicketCockpit);

  const switcher = element('div', undefined, 'cockpit-switcher');
  const switcherLabel = element('span', 'Jump to:', 'field-label');
  const ticketSelect = element('select');
  for (const t of snapshot.tickets) {
    const opt = element('option', `${t.key} — ${t.title}`);
    opt.value = t.key;
    opt.selected = t.key === ticket.key;
    ticketSelect.append(opt);
  }
  ticketSelect.addEventListener('change', () => {
    openTicketCockpit(ticketSelect.value, 'summary');
  });
  switcher.append(switcherLabel, ticketSelect);
  topRow.append(backBtn, switcher);

  const titleRow = element('div', undefined, 'cockpit-title-row');
  const main = element('div', undefined, 'cockpit-title-main');

  const badges = element('div', undefined, 'ticket-badges');
  badges.append(element('span', ticket.key, 'key'));

  const stateChip = element('span', `${stateIcons[ticket.state] || ''} ${labels[ticket.state] || ticket.state}`, 'chip');
  stateChip.dataset.tone = ticket.state;
  badges.append(stateChip);

  const trackChip = element('span', `📏 ${workflowLabel(ticket)}`, 'chip');
  trackChip.dataset.tone = 'info';
  badges.append(trackChip);

  if (ticket.updated) {
    badges.append(element('span', `🗓️ ${ticket.updated}`, 'chip'));
  }

  main.append(badges, element('h2', ticket.title));
  titleRow.append(main);

  const actions = element('div', undefined, 'ticket-badges');
  if (ticket.item && isSafeHttpUrl(ticket.item)) {
    link(actions, 'Open in Tracker ↗', ticket.item, 'btn-ember');
  }
  titleRow.append(actions);

  header.append(topRow, titleRow, renderPhaseStepper(ticket.phase));
}

function renderCockpitNav(ticket) {
  const nav = byId('cockpit-nav');
  nav.replaceChildren();

  const docs = ticket.docs || [];
  const hasMap = docs.some((d) => d.path === 'map.md');
  const approvedGates = (ticket.gates || []).filter((g) => g.status === 'approved').length;
  const activeGates = (ticket.gates || []).filter((g) => g.status !== 'skipped').length;

  const sections = [
    { id: 'summary', label: '🎯 Summary' },
    { id: 'gates', label: '🚦 Gates & PRs', count: `${approvedGates}/${activeGates}` },
    ...(hasMap ? [{ id: 'map', label: '🗺️ Code Map' }] : []),
    { id: 'docs', label: '🗂️ Documents & Evidence', count: String(docs.length) },
  ];

  if (cockpitSection === 'reader' && activeDocPath) {
    const activeDoc = docs.find((d) => d.path === activeDocPath);
    sections.push({
      id: 'reader',
      label: `📖 ${activeDoc ? activeDoc.label : activeDocPath}`,
    });
  }

  for (const sec of sections) {
    const btn = element('button', undefined, `nav-section-btn${cockpitSection === sec.id ? ' active' : ''}`);
    btn.type = 'button';
    btn.append(element('span', sec.label));
    if (sec.count !== undefined) {
      btn.append(element('span', sec.count, 'nav-count'));
    }
    btn.addEventListener('click', () => {
      cockpitSection = sec.id;
      renderCockpit(ticket);
    });
    nav.append(btn);
  }
}

function renderSummarySection(ticket) {
  const body = byId('cockpit-body');
  body.replaceChildren();

  const stack = element('div', undefined, 'summary-stack');

  // 1. Clean Hero Card (Stakes + Next action + Waiting on)
  const hero = element('div', undefined, 'hero-card');
  hero.dataset.state = ticket.state;
  if (ticket.summary) {
    hero.append(element('p', `🔥 ${ticket.summary}`, 'hero-stakes'));
  }
  const nextP = element('p', undefined, 'hero-next');
  appendInlineMarkdown(nextP, ticket.next, ticket, 'README.md');
  hero.append(nextP);
  if (ticket.waitingOn) {
    hero.append(element('p', `⏳ Waiting on: ${ticket.waitingOn}`, 'hero-waiting'));
  }
  stack.append(hero);

  // 2. Discoverable Category Shelves (Click to explore a category)
  const shelves = element('div', undefined, 'category-shelves');
  const docs = ticket.docs || [];

  for (const cat of docCategories) {
    const group = docs.filter((d) => d.category === cat.id);
    if (!group.length) continue;

    const cardEl = element('button', undefined, 'shelf-card');
    cardEl.type = 'button';

    const top = element('div', undefined, 'shelf-top');
    top.append(element('span', cat.label), element('span', `${group.length}`, 'badge-mono'));

    const desc = element('p', cat.desc, 'shelf-desc');

    const pills = element('div', undefined, 'shelf-pills');
    for (const doc of group.slice(0, 3)) {
      pills.append(element('span', doc.label, 'chip'));
    }
    if (group.length > 3) {
      pills.append(element('span', `+${group.length - 3} more`, 'chip'));
    }

    cardEl.append(top, desc, pills);
    cardEl.addEventListener('click', () => {
      activeDocCategory = cat.id;
      cockpitSection = 'docs';
      renderCockpit(ticket);
    });
    shelves.append(cardEl);
  }
  stack.append(shelves);

  // 3. Collapsible Git, Worktree & Source paths drawer (Not dumped open by default)
  const drawer = element('details', undefined, 'meta-drawer');
  drawer.append(element('summary', '🔧 Branch, worktree & local file paths'));
  const dl = element('dl', undefined, 'meta-dl');
  for (const [label, value] of [
    ['Branch', ticket.branch || '—'],
    ['Worktree', ticket.worktree || '—'],
    ['Source README', ticket.file || '—'],
  ]) {
    dl.append(element('dt', label), element('dd', value));
  }
  drawer.append(dl);
  stack.append(drawer);

  body.append(stack);
}

function renderGatesSection(ticket) {
  const body = byId('cockpit-body');
  body.replaceChildren();

  const stack = element('div', undefined, 'summary-stack');

  const gateList = element('div', undefined, 'gate-list');
  for (const gate of ticket.gates || []) {
    const targetDoc = resolveGateDoc(ticket, gate.doc);
    const row = element('div', undefined, `gate-row${targetDoc ? ' clickable' : ''}`);
    const dot = element('span', undefined, 'gate-dot');
    dot.dataset.status = gate.status;

    const info = element('div', undefined, 'gate-info');
    const titleLine = element('div', undefined, 'gate-title-line');
    titleLine.append(element('span', gate.name));
    titleLine.append(element('span', gate.need, 'chip'));
    if (gate.doc) {
      titleLine.append(element('code', gate.doc, 'badge-mono'));
    }
    info.append(titleLine);

    const metaParts = [];
    if (gate.date) metaParts.push(`Approved ${gate.date}`);
    if (gate.hash) metaParts.push(`#${gate.hash}`);
    if (gate.note) metaParts.push(gate.note);
    if (metaParts.length) {
      info.append(element('div', metaParts.join(' · '), 'gate-meta-line'));
    }

    const statusChip = element('span', gate.status, 'chip');
    statusChip.dataset.tone = gate.status;

    row.append(dot, info, statusChip);
    if (targetDoc) {
      row.title = `Read ${targetDoc}`;
      row.addEventListener('click', () => openDocumentReader(ticket, targetDoc, 'gates'));
    }
    gateList.append(row);
  }
  stack.append(gateList);

  if (ticket.changes && ticket.changes.length) {
    const prHeading = element('h3', '🔀 Linked Change Requests');
    prHeading.style.margin = '12px 0 4px';
    stack.append(prHeading);

    const prList = element('div', undefined, 'gate-list');
    for (const change of ticket.changes) {
      const chRow = element('div', undefined, 'gate-row');
      const dot = element('span', undefined, 'gate-dot');
      dot.dataset.status = change.state === 'merged' ? 'approved' : (change.state === 'open' ? 'in-review' : 'todo');
      const info = element('div', undefined, 'gate-info');
      link(info, change.label || change.url, change.url);
      const stChip = element('span', change.state, 'chip');
      stChip.dataset.tone = change.state;
      chRow.append(dot, info, stChip);
      prList.append(chRow);
    }
    stack.append(prList);
  }

  body.append(stack);
}

function renderDocsExplorerSection(ticket) {
  const body = byId('cockpit-body');
  body.replaceChildren();

  const docs = ticket.docs || [];
  if (!docs.length) {
    body.append(element('p', 'No Markdown documents found in this ticket folder.', 'empty-banner'));
    return;
  }

  const availableCats = docCategories.filter((cat) => docs.some((d) => d.category === cat.id));
  if (activeDocCategory !== 'all' && !availableCats.some((c) => c.id === activeDocCategory)) {
    activeDocCategory = availableCats[0]?.id || 'all';
  }

  const bar = element('div', undefined, 'category-bar');
  const pills = element('div', undefined, 'category-pills');

  for (const cat of availableCats) {
    const count = docs.filter((d) => d.category === cat.id).length;
    const btn = element('button', `${cat.label} (${count})`, `pill-btn${activeDocCategory === cat.id ? ' active' : ''}`);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      activeDocCategory = cat.id;
      renderDocsExplorerSection(ticket);
    });
    pills.append(btn);
  }

  const allBtn = element('button', `All files (${docs.length})`, `pill-btn${activeDocCategory === 'all' ? ' active' : ''}`);
  allBtn.type = 'button';
  allBtn.addEventListener('click', () => {
    activeDocCategory = 'all';
    renderDocsExplorerSection(ticket);
  });
  pills.append(allBtn);
  bar.append(pills);
  body.append(bar);

  const visibleDocs = activeDocCategory === 'all'
    ? docs
    : docs.filter((d) => d.category === activeDocCategory);

  const grid = element('div', undefined, 'doc-catalog-grid');
  for (const doc of visibleDocs) {
    const cardBtn = element('button', undefined, 'doc-catalog-card');
    cardBtn.type = 'button';

    const top = element('div', undefined, 'doc-catalog-top');
    top.append(element('span', doc.label));
    if (doc.hasMermaid) {
      top.append(element('span', '📊 Mermaid', 'tab-mermaid-tag'));
    } else if (doc.gate) {
      top.append(element('span', doc.gate, 'chip'));
    } else if (doc.status) {
      const st = element('span', doc.status, 'chip');
      st.dataset.tone = doc.status;
      top.append(st);
    }

    cardBtn.append(top);
    cardBtn.append(element('span', doc.path, 'doc-catalog-path'));
    if (doc.updated) {
      cardBtn.append(element('span', `Updated ${doc.updated}`, 'gate-meta-line'));
    }

    cardBtn.addEventListener('click', () => openDocumentReader(ticket, doc.path, 'docs'));
    grid.append(cardBtn);
  }
  body.append(grid);
}

function resolveRelativeDocPath(currentDocPath, href) {
  const cleanHref = href.split('#')[0].split('?')[0].trim().replace(/\\/g, '/');
  if (!cleanHref || !cleanHref.endsWith('.md')) return null;
  const baseDir = currentDocPath.includes('/') ? currentDocPath.slice(0, currentDocPath.lastIndexOf('/') + 1) : '';
  const combined = (cleanHref.startsWith('./') ? baseDir + cleanHref.slice(2) : baseDir + cleanHref).split('/');
  const resolved = [];
  for (const part of combined) {
    if (!part || part === '.') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  return resolved.join('/');
}

function appendInlineMarkdown(parent, text, ticket, currentDocPath) {
  if (!text) return;
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parent.append(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      parent.append(element('code', token.slice(1, -1)));
    } else if (token.startsWith('**') && token.endsWith('**')) {
      parent.append(element('strong', token.slice(2, -2)));
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parent.append(element('em', token.slice(1, -1)));
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (linkMatch) {
        const [, labelText, rawTarget] = linkMatch;
        const target = rawTarget.trim().replace(/^<|>$/g, '');
        const resolvedDoc = resolveRelativeDocPath(currentDocPath, target);
        if (resolvedDoc && (ticket.docs || []).some((d) => d.path === resolvedDoc)) {
          const docLink = element('a', labelText, 'internal-doc-link');
          docLink.href = `#${resolvedDoc}`;
          docLink.title = `Open ${resolvedDoc}`;
          docLink.addEventListener('click', (e) => {
            e.preventDefault();
            openDocumentReader(ticket, resolvedDoc);
          });
          parent.append(docLink);
        } else if (isSafeHttpUrl(target)) {
          link(parent, labelText, target);
        } else {
          const shortTarget = target.split(/[/\\]/).slice(-2).join('/');
          const codeRef = element('span', `${labelText} (${shortTarget})`, 'local-code-ref');
          codeRef.title = target;
          parent.append(codeRef);
        }
      } else {
        parent.append(document.createTextNode(token));
      }
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    parent.append(document.createTextNode(text.slice(lastIndex)));
  }
}

function splitTableCells(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll('\\|', '|'));
}

function isTableSeparator(line) {
  if (!line || !line.includes('|')) return false;
  const cells = splitTableCells(line);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function buildMermaidBlock(code) {
  const cardNode = element('div', undefined, 'mermaid-card');
  const toolbar = element('div', undefined, 'mermaid-toolbar');
  toolbar.append(element('span', '📊 MERMAID DIAGRAM'));

  const actions = element('div', undefined, 'ticket-badges');
  const zoomBtn = element('button', '🔍 Fit / Expand', 'pill-btn');
  zoomBtn.type = 'button';
  const sourceBtn = element('button', '{ } Source', 'pill-btn');
  sourceBtn.type = 'button';
  actions.append(zoomBtn, sourceBtn);
  toolbar.append(actions);

  const stage = element('div', undefined, 'mermaid-stage');
  stage.dataset.mermaidCode = code;
  stage.append(element('span', 'Rendering diagram...', 'gate-meta-line'));

  const sourcePre = element('pre', undefined);
  sourcePre.hidden = true;
  sourcePre.append(element('code', code));

  zoomBtn.addEventListener('click', () => {
    stage.classList.toggle('expanded');
  });
  sourceBtn.addEventListener('click', () => {
    sourcePre.hidden = !sourcePre.hidden;
  });

  cardNode.append(toolbar, stage, sourcePre);
  return cardNode;
}

function renderMarkdownBody(markdown, ticket, currentDocPath) {
  const rootContainer = element('div', undefined, 'doc-body');
  let targetContainer = rootContainer;
  const cleaned = markdown.replace(/<!--[\s\S]*?-->/g, '');
  const lines = cleaned.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Heading resets any open **📂 ...** collapsible drawer back to root
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(line);
    if (headingMatch) {
      targetContainer = rootContainer;
      const level = headingMatch[1].length;
      const h = element(`h${level}`);
      appendInlineMarkdown(h, headingMatch[2].trim(), ticket, currentDocPath);
      targetContainer.append(h);
      i++;
      continue;
    }

    // Progressive disclosure: **📂 <label>** opens a collapsible <details> drawer
    const folderMatch = /^\*\*📂\s+(.+?)\*\*\s*$/.exec(line.trim());
    if (folderMatch) {
      const drawer = element('details', undefined, 'doc-folder-drawer');
      drawer.append(element('summary', `📂 ${folderMatch[1]} (click to expand)`));
      rootContainer.append(drawer);
      targetContainer = drawer;
      i++;
      continue;
    }

    // Fenced code block or Mermaid block
    const fenceMatch = /^```(\S*)\s*$/.exec(line.trim());
    if (fenceMatch) {
      const lang = fenceMatch[1].toLowerCase();
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      const codeText = codeLines.join('\n');
      if (lang === 'mermaid') {
        targetContainer.append(buildMermaidBlock(codeText));
      } else {
        const pre = element('pre');
        const codeEl = element('code', codeText);
        if (lang) codeEl.dataset.lang = lang;
        pre.append(codeEl);
        targetContainer.append(pre);
      }
      continue;
    }

    // Horizontal rule
    if (/^(?:---|\*\*\*|___)\s*$/.test(line.trim())) {
      targetContainer.append(element('hr'));
      i++;
      continue;
    }

    // Blockquote
    if (line.trim().startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      const fullQuote = quoteLines.join('\n').trim();
      let cls = '';
      if (fullQuote.startsWith('🔥')) cls = 'callout-stakes';
      else if (fullQuote.includes('⚠️') || fullQuote.includes('Warning:')) cls = 'callout-warn';
      else if (fullQuote.includes('🛑') || fullQuote.includes('Caution:')) cls = 'callout-bad';
      else if (fullQuote.includes('💡') || fullQuote.includes('Tip:')) cls = 'callout-tip';

      const bq = element('blockquote', undefined, cls);
      for (const paragraph of fullQuote.split(/\n{2,}/)) {
        const p = element('p');
        appendInlineMarkdown(p, paragraph.replace(/\n/g, ' '), ticket, currentDocPath);
        bq.append(p);
      }
      targetContainer.append(bq);
      continue;
    }

    // Table
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableCells(line);
      i += 2;
      const wrap = element('div', undefined, 'doc-table-wrap');
      const table = element('table');
      const thead = element('thead');
      const trHead = element('tr');
      for (const hCell of headers) {
        const th = element('th');
        appendInlineMarkdown(th, hCell, ticket, currentDocPath);
        trHead.append(th);
      }
      thead.append(trHead);
      table.append(thead);

      const tbody = element('tbody');
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim() !== '') {
        const rowCells = splitTableCells(lines[i]);
        const tr = element('tr');
        for (let c = 0; c < Math.max(headers.length, rowCells.length); c++) {
          const td = element('td');
          appendInlineMarkdown(td, rowCells[c] ?? '', ticket, currentDocPath);
          tr.append(td);
        }
        tbody.append(tr);
        i++;
      }
      table.append(tbody);
      wrap.append(table);
      targetContainer.append(wrap);
      continue;
    }

    // Unordered or Ordered List
    const ulMatch = /^\s*[-*]\s+(.+)$/.exec(line);
    const olMatch = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (ulMatch || olMatch) {
      const isOrdered = Boolean(olMatch);
      const listEl = element(isOrdered ? 'ol' : 'ul');
      while (i < lines.length) {
        const itemMatch = isOrdered
          ? /^\s*\d+\.\s+(.+)$/.exec(lines[i])
          : /^\s*[-*]\s+(.+)$/.exec(lines[i]);
        if (!itemMatch) break;
        const li = element('li');
        appendInlineMarkdown(li, itemMatch[1], ticket, currentDocPath);
        listEl.append(li);
        i++;
      }
      targetContainer.append(listEl);
      continue;
    }

    // Standard paragraph
    const paraLines = [];
    while (
      i < lines.length
      && lines[i].trim() !== ''
      && !lines[i].trim().startsWith('```')
      && !lines[i].trim().startsWith('#')
      && !lines[i].trim().startsWith('>')
      && !/^\*\*📂\s+/.test(lines[i].trim())
      && !/^\s*(?:[-*]|\d+\.)\s+/.test(lines[i])
      && !(lines[i].includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    if (paraLines.length) {
      const p = element('p');
      appendInlineMarkdown(p, paraLines.join(' '), ticket, currentDocPath);
      targetContainer.append(p);
    } else {
      i++;
    }
  }

  return rootContainer;
}

async function renderMermaidDiagrams(rootNode) {
  const stages = rootNode.querySelectorAll('.mermaid-stage[data-mermaid-code]');
  if (!stages.length) return;
  const mermaidApi = globalThis.mermaid;
  if (!mermaidApi || typeof mermaidApi.render !== 'function') {
    for (const stage of stages) {
      stage.replaceChildren(element('pre', stage.dataset.mermaidCode));
    }
    return;
  }

  const isDark = globalThis.matchMedia && globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
  try {
    mermaidApi.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: isDark ? 'dark' : 'default',
      fontFamily: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
    });
  } catch {
    // Ignore repeated initialize calls
  }

  for (const stage of stages) {
    const code = stage.dataset.mermaidCode;
    const id = `forge-mermaid-${++mermaidCounter}`;
    try {
      const rendered = await mermaidApi.render(id, code);
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(rendered.svg, 'image/svg+xml');
      const svgEl = svgDoc.querySelector('svg');
      if (svgEl) {
        stage.replaceChildren(document.importNode(svgEl, true));
      } else {
        stage.replaceChildren(element('pre', code));
      }
    } catch (error) {
      const fallback = element('div');
      fallback.append(
        element('p', `Diagram preview unavailable (${error.message || 'syntax error'}). Showing Mermaid source:`, 'gate-meta-line'),
        element('pre', code),
      );
      stage.replaceChildren(fallback);
    }
  }
}

async function renderDocumentView(ticket, docPath, showBackToDocs = true) {
  const body = byId('cockpit-body');
  const cacheKey = `${ticket.folder}:${docPath}`;
  const reqId = ++docRequestSeq;

  if (!docCache.has(cacheKey)) {
    body.replaceChildren(element('p', `Loading ${docPath}...`, 'gate-meta-line'));
  }

  try {
    const encodedFolder = encodeURIComponent(ticket.folder);
    const encodedPath = docPath.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`/tickets/${encodedFolder}/docs/${encodedPath}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    docCache.set(cacheKey, data);
  } catch (error) {
    if (reqId !== docRequestSeq) return;
    const cached = docCache.get(cacheKey);
    if (!cached) {
      body.replaceChildren(element('p', `Could not load ${docPath}: ${error.message}`, 'empty-banner'));
      return;
    }
  }

  if (reqId !== docRequestSeq) return;
  const doc = docCache.get(cacheKey);
  if (!doc) return;

  const reader = element('div', undefined, 'doc-reader');
  const toolbar = element('div', undefined, 'doc-toolbar');
  const metaGroup = element('div', undefined, 'doc-toolbar-meta');
  metaGroup.append(element('span', doc.label, 'key'));
  metaGroup.append(element('code', doc.path, 'badge-mono'));
  if (doc.type) metaGroup.append(element('span', `type: ${doc.type}`, 'chip'));
  if (doc.gate) {
    const gateChip = element('span', `🚦 Gate: ${doc.gate}`, 'chip');
    gateChip.dataset.tone = 'warn';
    metaGroup.append(gateChip);
  }
  if (doc.status) {
    const stChip = element('span', `status: ${doc.status}`, 'chip');
    stChip.dataset.tone = doc.status;
    metaGroup.append(stChip);
  }
  if (doc.target) metaGroup.append(element('span', `target: ${doc.target}`, 'chip'));
  if (doc.updated) metaGroup.append(element('span', `Updated ${doc.updated}`, 'chip'));
  toolbar.append(metaGroup);

  if (showBackToDocs) {
    const backBtn = element('button', '← Back to files', 'btn-secondary');
    backBtn.type = 'button';
    backBtn.addEventListener('click', () => {
      cockpitSection = previousSection || 'docs';
      renderCockpit(ticket);
    });
    toolbar.append(backBtn);
  }
  reader.append(toolbar);

  const renderedBody = renderMarkdownBody(doc.body || '', ticket, doc.path);
  reader.append(renderedBody);
  body.replaceChildren(reader);

  await renderMermaidDiagrams(renderedBody);
}

function renderCockpit(ticket) {
  renderCockpitHeader(ticket);
  renderCockpitNav(ticket);

  if (cockpitSection === 'summary') {
    renderSummarySection(ticket);
  } else if (cockpitSection === 'gates') {
    renderGatesSection(ticket);
  } else if (cockpitSection === 'map') {
    renderDocumentView(ticket, 'map.md', false);
  } else if (cockpitSection === 'docs') {
    renderDocsExplorerSection(ticket);
  } else if (cockpitSection === 'reader' && activeDocPath) {
    renderDocumentView(ticket, activeDocPath, true);
  } else {
    renderSummarySection(ticket);
  }
}

function render() {
  if (!snapshot) return;
  updateKpis();

  const query = byId('search').value.trim().toLowerCase();
  const state = byId('state').value;
  const includeDone = byId('done').checked;

  const tickets = snapshot.tickets
    .filter((ticket) =>
      (includeDone || (ticket.state !== 'done' && ticket.phase !== 'closed'))
      && (!state || ticket.state === state)
      && [ticket.key, ticket.title, ticket.next, ticket.waitingOn, ticket.branch, ticket.summary || '']
        .some((value) => (value || '').toLowerCase().includes(query)))
    .sort((a, b) => ticketPriority(a) - ticketPriority(b) || a.key.localeCompare(b.key));

  renderStatePills(state);

  const board = byId('board');
  const expanded = new Set(
    [...board.querySelectorAll('article.ticket-card')]
      .filter((node) => node.querySelector('details')?.open)
      .map((node) => node.querySelector('.key')?.textContent),
  );
  board.replaceChildren();

  for (const ticket of tickets) {
    const node = card(ticket);
    const det = node.querySelector('details');
    if (det) det.open = expanded.has(ticket.key);
    board.append(node);
  }

  byId('wiki').textContent = snapshot.wikiPath;
  byId('empty').hidden = tickets.length > 0;
  byId('empty').textContent = snapshot.tickets.length
    ? 'No tickets match these filters.'
    : 'No tickets yet. Start a ticket with Forge to populate this workbench.';

  const errors = byId('errors');
  errors.hidden = !snapshot.errors.length;
  errors.querySelector('ul').replaceChildren(
    ...snapshot.errors.map((error) => element('li', `${error.file}\n${error.message}`)),
  );

  const activeTicket = selectedKey ? snapshot.tickets.find((t) => t.key === selectedKey) : null;
  if (selectedKey && !activeTicket) {
    selectedKey = null;
  }

  const overviewScreen = byId('overview-screen');
  const cockpitScreen = byId('cockpit');
  const pageTitle = byId('page-title');

  if (activeTicket) {
    overviewScreen.hidden = true;
    cockpitScreen.hidden = false;
    pageTitle.textContent = `${activeTicket.key} Cockpit`;
    renderCockpit(activeTicket);
  } else {
    overviewScreen.hidden = false;
    cockpitScreen.hidden = true;
    pageTitle.textContent = 'Ticket dashboard';
  }

  showStatus();
}

async function refresh() {
  if (loading) return;
  loading = true;
  byId('refresh').disabled = true;
  try {
    const response = await fetch('/state', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (!Array.isArray(data.tickets) || !Array.isArray(data.errors)) throw new Error('Invalid dashboard response.');
    const changed = !snapshot || JSON.stringify([data.tickets, data.errors]) !== JSON.stringify([snapshot.tickets, snapshot.errors]);
    snapshot = data;
    if (changed) {
      docCache.clear();
      render();
    } else {
      showStatus();
    }
  } catch (error) {
    byId('status').textContent = `Refresh failed: ${error.message}. Displayed tickets may be stale. Use Refresh to retry.`;
  } finally {
    loading = false;
    byId('refresh').disabled = false;
  }
}

for (const [value, label] of Object.entries(labels)) {
  const option = element('option', label);
  option.value = value;
  byId('state').append(option);
}
for (const id of ['search', 'state', 'done']) byId(id).addEventListener('input', render);
byId('refresh').addEventListener('click', refresh);
byId('home-btn').addEventListener('click', closeTicketCockpit);
refresh();
setInterval(refresh, 5000);
