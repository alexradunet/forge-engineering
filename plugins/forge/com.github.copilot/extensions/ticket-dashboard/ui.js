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

const wikiCategories = [
  {
    id: 'learning',
    label: '🎓 Concepts & Learning',
    desc: 'Source-linked 15-minute concept lessons and knowledge bites.',
  },
  {
    id: 'area',
    label: '🏗️ Architecture & Areas',
    desc: 'Codebase flows, domain knowledge, runbooks, and system architecture.',
  },
  {
    id: 'tooling',
    label: '🛠️ Tooling & Gotchas',
    desc: 'VS Code Agents window, MCP servers, builds, CI, and environment gotchas.',
  },
  {
    id: 'decisions',
    label: '🧭 Decisions',
    desc: 'Engineering decisions, trade-offs, and rationale.',
  },
  {
    id: 'tickets',
    label: '🎫 Closed Ticket Summaries',
    desc: 'Distilled canonical summaries of completed tickets.',
  },
  {
    id: 'index',
    label: '📚 Index & Log',
    desc: 'The root wiki catalog (index.md) and change history (log.md).',
  },
];

const peopleStatuses = {
  'reply-in': { icon: '📥', label: 'Reply to read', tone: 'needs-me', dot: 'in-review', action: true },
  'follow-up': { icon: '🔔', label: 'Follow up', tone: 'warn', dot: 'in-review', action: true },
  'to-contact': { icon: '✉️', label: 'Send message', tone: 'warn', dot: 'in-review', action: true },
  drafted: { icon: '📝', label: 'Draft to send', tone: 'warn', dot: 'in-review', action: true },
  waiting: { icon: '⏳', label: 'Waiting for answer', tone: 'waiting', dot: 'todo', action: false },
  done: { icon: '✅', label: 'Done', tone: 'done', dot: 'approved', action: false },
};
const peopleOrder = Object.keys(peopleStatuses);
const peopleFilters = [
  { id: 'open', label: '👥 Open', match: (p) => p.status !== 'done' },
  { id: 'action', label: '🟡 Your move', match: (p) => isPersonAction(p) },
  { id: 'waiting', label: '⏳ Waiting', match: (p) => p.status === 'waiting' },
  { id: 'done', label: '✅ Done', match: (p) => p.status === 'done' },
  { id: 'all', label: 'All', match: () => true },
];
const FOLLOW_UP_WORKING_DAYS = 3;

const byId = (id) => document.getElementById(id);
let snapshot = null;
let loading = false;
let viewMode = 'tickets'; // 'tickets' | 'wiki' | 'people'
let selectedKey = null; // null = Overview Grid, string = Focused Ticket Cockpit
let cockpitSection = 'summary'; // 'summary' | 'gates' | 'people' | 'map' | 'docs' | 'reader'
let peopleFilter = 'open'; // id from peopleFilters
let activeDocCategory = 'core'; // 'core' | 'gate' | 'evidence' | 'outbox' | 'log' | 'all'
let activeDocPath = null;
let previousSection = 'docs';
let wikiSection = 'overview'; // 'overview' | 'index' | 'explorer' | 'reader'
let activeWikiCategory = 'all'; // 'all' | 'learning' | 'area' | 'tooling' | 'decisions' | 'tickets' | 'index'
let activeWikiArea = '';
let wikiSearchQuery = '';
let activeWikiPath = null;
let navHistory = [];
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

function isOpenTicket(ticket) {
  return ticket.state !== 'done' && ticket.phase !== 'closed';
}

function isPersonAction(person) {
  return peopleStatuses[person.status]?.action === true;
}

function workingDaysSince(since) {
  if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) return null;
  const start = new Date(`${since}T00:00:00`);
  if (!Number.isFinite(start.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let days = 0;
  for (const day = new Date(start); day < today && days < 400; day.setDate(day.getDate() + 1)) {
    const weekday = day.getDay();
    if (weekday !== 0 && weekday !== 6) days++;
  }
  return days;
}

function personAgeText(person) {
  const days = workingDaysSince(person.since);
  if (days === null) return '';
  if (days === 0) return `since ${person.since} (today)`;
  return `since ${person.since} (${days} working ${days === 1 ? 'day' : 'days'})`;
}

function needsFollowUp(person) {
  return person.status === 'waiting' && (workingDaysSince(person.since) ?? 0) > FOLLOW_UP_WORKING_DAYS;
}

function comparePeople(a, b) {
  return peopleOrder.indexOf(a.status) - peopleOrder.indexOf(b.status)
    || (a.since || '9999').localeCompare(b.since || '9999')
    || a.name.localeCompare(b.name);
}

function peopleCounts(people) {
  const list = people || [];
  return {
    action: list.filter(isPersonAction).length,
    waiting: list.filter((p) => p.status === 'waiting').length,
  };
}

function personStatusChip(person) {
  const meta = peopleStatuses[person.status] || { icon: '', label: person.status, tone: '' };
  const chip = element('span', `${meta.icon} ${meta.label}`.trim(), 'chip');
  chip.dataset.tone = meta.tone;
  return chip;
}

function openPeopleHub(filter = null, recordHistory = false) {
  if (recordHistory) pushNavState();
  viewMode = 'people';
  if (filter) peopleFilter = filter;
  render();
  if (globalThis.scrollTo) globalThis.scrollTo({ top: 0, behavior: 'smooth' });
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
  const wikiCount = (snapshot.wikiPages || []).length;
  const errors = snapshot.errors.length;
  byId('status').textContent = `${count}/${snapshot.tickets.length} tickets · ${wikiCount} wiki pages · ${errors} read ${errors === 1 ? 'error' : 'errors'} · ${new Date(snapshot.scannedAt).toLocaleTimeString()}`;
}

function updateKpis() {
  if (!snapshot) return;
  const openTickets = snapshot.tickets.filter((t) => t.state !== 'done' && t.phase !== 'closed');
  const needsMeCount = openTickets.filter(isNeedsMe).length;
  let inReviewGates = 0;
  let approvedGates = 0;
  let peopleAction = 0;
  let peopleWaiting = 0;
  for (const ticket of openTickets) {
    const counts = peopleCounts(ticket.people);
    peopleAction += counts.action;
    peopleWaiting += counts.waiting;
  }
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
  const actionKpi = byId('kpi-people-action');
  if (actionKpi) actionKpi.textContent = String(peopleAction);
  const waitingKpi = byId('kpi-people-waiting');
  if (waitingKpi) waitingKpi.textContent = String(peopleWaiting);
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

function pushNavState() {
  navHistory.push({
    viewMode,
    selectedKey,
    cockpitSection,
    activeDocCategory,
    activeDocPath,
    previousSection,
    wikiSection,
    activeWikiCategory,
    activeWikiArea,
    activeWikiPath,
  });
  if (navHistory.length > 40) navHistory.shift();
}

function popNavState() {
  const prev = navHistory.pop();
  if (!prev) return false;
  viewMode = prev.viewMode;
  selectedKey = prev.selectedKey;
  cockpitSection = prev.cockpitSection;
  activeDocCategory = prev.activeDocCategory;
  activeDocPath = prev.activeDocPath;
  previousSection = prev.previousSection;
  wikiSection = prev.wikiSection;
  activeWikiCategory = prev.activeWikiCategory;
  activeWikiArea = prev.activeWikiArea;
  activeWikiPath = prev.activeWikiPath;
  render();
  return true;
}

function openTicketCockpit(ticketKey, section = 'summary', docPath = null, recordHistory = false) {
  if (recordHistory) pushNavState();
  viewMode = 'tickets';
  selectedKey = ticketKey;
  cockpitSection = section;
  activeDocPath = docPath;
  render();
  if (globalThis.scrollTo) globalThis.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeTicketCockpit() {
  viewMode = 'tickets';
  selectedKey = null;
  cockpitSection = 'summary';
  activeDocPath = null;
  render();
}

function openWikiHub(section = 'overview', docPath = null, category = null, recordHistory = false) {
  if (recordHistory) pushNavState();
  viewMode = 'wiki';
  if (category) activeWikiCategory = category;
  wikiSection = section;
  if (docPath) activeWikiPath = docPath;
  render();
  if (globalThis.scrollTo) globalThis.scrollTo({ top: 0, behavior: 'smooth' });
}

function openWikiReader(docPath, recordHistory = true) {
  openWikiHub('reader', docPath, null, recordHistory);
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
  const people = peopleCounts(ticket.people);
  if (people.action) {
    const actionChip = element('span', `✉️ ${people.action}`, 'chip');
    actionChip.dataset.tone = 'warn';
    actionChip.title = `${people.action} ${people.action === 1 ? 'person needs' : 'people need'} a message or a reply from you`;
    badges.append(actionChip);
  }
  if (people.waiting) {
    const waitingChip = element('span', `⏳ ${people.waiting}`, 'chip');
    waitingChip.dataset.tone = 'waiting';
    waitingChip.title = `Waiting for an answer from ${people.waiting} ${people.waiting === 1 ? 'person' : 'people'}`;
    badges.append(waitingChip);
  }
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
  const leftBtns = element('div', undefined, 'ticket-badges');
  leftBtns.append(backBtn);
  if (navHistory.length && navHistory.at(-1).viewMode === 'people') {
    const peopleBtn = element('button', '↩ Back to people', 'btn-secondary');
    peopleBtn.type = 'button';
    peopleBtn.addEventListener('click', () => popNavState());
    leftBtns.append(peopleBtn);
  }
  topRow.append(leftBtns, switcher);

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
    { id: 'people', label: '👥 People', count: String((ticket.people || []).length) },
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
  const people = peopleCounts(ticket.people);
  if (people.action || people.waiting) {
    const parts = [];
    if (people.action) parts.push(`✉️ ${people.action} to message or read`);
    if (people.waiting) parts.push(`⏳ ${people.waiting} waiting for an answer`);
    const peopleBtn = element('button', `👥 ${parts.join(' · ')} →`, 'btn-secondary');
    peopleBtn.type = 'button';
    peopleBtn.addEventListener('click', () => {
      cockpitSection = 'people';
      renderCockpit(ticket);
    });
    hero.append(peopleBtn);
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

function personRow(person, { ticket = null, showTicket = false } = {}) {
  const meta = peopleStatuses[person.status] || {};
  const row = element('div', undefined, 'gate-row person-row');
  row.dataset.status = person.status;
  const dot = element('span', undefined, 'gate-dot');
  dot.dataset.status = meta.dot || 'todo';

  const info = element('div', undefined, 'gate-info');
  const titleLine = element('div', undefined, 'gate-title-line');
  if (showTicket && ticket) {
    const keyBtn = element('button', ticket.key, 'key person-ticket-btn');
    keyBtn.type = 'button';
    keyBtn.title = `Open ${ticket.key}: ${ticket.title}`;
    keyBtn.addEventListener('click', () => openTicketCockpit(ticket.key, 'people', null, true));
    titleLine.append(keyBtn);
  } else {
    titleLine.append(element('span', person.name, 'person-name'));
  }
  if (person.role) titleLine.append(element('span', person.role, 'chip'));
  if (person.via) titleLine.append(element('span', `via ${person.via}`, 'chip'));
  info.append(titleLine);
  if (showTicket && ticket) info.append(element('div', ticket.title, 'gate-meta-line'));
  if (person.ask) info.append(element('div', `❓ ${person.ask}`, 'person-ask'));

  const metaParts = [];
  const age = personAgeText(person);
  if (age) metaParts.push(age);
  if (person.note) metaParts.push(person.note);
  if (metaParts.length) info.append(element('div', metaParts.join(' · '), 'gate-meta-line'));

  const actions = element('div', undefined, 'ticket-badges');
  if (needsFollowUp(person)) {
    const nudge = element('span', '🔔 Follow up?', 'chip');
    nudge.dataset.tone = 'warn';
    nudge.title = `No answer for more than ${FOLLOW_UP_WORKING_DAYS} working days`;
    actions.append(nudge);
  }
  if (person.draft && ticket && (ticket.docs || []).some((d) => d.path === person.draft)) {
    const draftBtn = element('button', '📝 Draft', 'btn-secondary');
    draftBtn.type = 'button';
    draftBtn.title = `Read ${person.draft}`;
    draftBtn.addEventListener('click', () => {
      if (showTicket) {
        openTicketCockpit(ticket.key, 'people', null, true);
      }
      openDocumentReader(ticket, person.draft, 'people');
    });
    actions.append(draftBtn);
  } else if (person.draft) {
    actions.append(element('code', person.draft, 'badge-mono'));
  }
  actions.append(personStatusChip(person));

  row.append(dot, info, actions);
  return row;
}

function peopleStatusSummary(people) {
  const summary = element('div', undefined, 'ticket-badges');
  for (const status of peopleOrder) {
    const count = people.filter((p) => p.status === status).length;
    if (!count) continue;
    const meta = peopleStatuses[status];
    const chip = element('span', `${meta.icon} ${meta.label}: ${count}`, 'chip');
    chip.dataset.tone = meta.tone;
    summary.append(chip);
  }
  return summary;
}

function renderPeopleSection(ticket) {
  const body = byId('cockpit-body');
  body.replaceChildren();

  const people = [...(ticket.people || [])].sort(comparePeople);
  if (!people.length) {
    body.append(element(
      'p',
      'No people recorded yet. The ticket skill adds each person you work with to the README people list, with a contact status.',
      'empty-banner',
    ));
    return;
  }

  const stack = element('div', undefined, 'summary-stack');
  stack.append(peopleStatusSummary(people));
  const list = element('div', undefined, 'gate-list');
  for (const person of people) list.append(personRow(person, { ticket }));
  stack.append(list);

  const allBtn = element('button', '👥 All people across tickets →', 'btn-secondary');
  allBtn.type = 'button';
  allBtn.addEventListener('click', () => openPeopleHub('open', true));
  stack.append(allBtn);
  body.append(stack);
}

function collectPeople() {
  const groups = new Map();
  for (const ticket of (snapshot?.tickets || []).filter(isOpenTicket)) {
    for (const person of ticket.people || []) {
      const id = person.name.trim().toLowerCase();
      if (!groups.has(id)) groups.set(id, { name: person.name, entries: [] });
      groups.get(id).entries.push({ person, ticket });
    }
  }
  for (const group of groups.values()) {
    group.entries.sort((a, b) => comparePeople(a.person, b.person) || a.ticket.key.localeCompare(b.ticket.key));
  }
  return [...groups.values()];
}

function renderPeopleHub() {
  const header = byId('people-header');
  const body = byId('people-body');
  if (!header || !body) return;
  header.replaceChildren();
  body.replaceChildren();

  const groups = collectPeople();
  const allEntries = groups.flatMap((g) => g.entries.map((e) => e.person));

  const topRow = element('div', undefined, 'cockpit-topbar');
  const leftBtns = element('div', undefined, 'ticket-badges');
  const ticketsBtn = element('button', '← Tickets board', 'btn-secondary');
  ticketsBtn.type = 'button';
  ticketsBtn.addEventListener('click', () => {
    viewMode = 'tickets';
    selectedKey = null;
    render();
  });
  leftBtns.append(ticketsBtn);
  if (navHistory.length) {
    const prevBtn = element('button', '↩ Previous view', 'btn-secondary');
    prevBtn.type = 'button';
    prevBtn.addEventListener('click', () => popNavState());
    leftBtns.append(prevBtn);
  }
  topRow.append(leftBtns);

  const titleRow = element('div', undefined, 'cockpit-title-row');
  const main = element('div', undefined, 'cockpit-title-main');
  const badges = element('div', undefined, 'ticket-badges');
  badges.append(element('span', '👥 PEOPLE', 'key'));
  const counts = peopleCounts(allEntries);
  const totalChip = element('span', `${groups.length} ${groups.length === 1 ? 'person' : 'people'} on open tickets`, 'chip');
  totalChip.dataset.tone = 'info';
  badges.append(totalChip);
  if (counts.action) {
    const chip = element('span', `✉️ ${counts.action} to message or read`, 'chip');
    chip.dataset.tone = 'warn';
    badges.append(chip);
  }
  if (counts.waiting) {
    const chip = element('span', `⏳ ${counts.waiting} waiting for an answer`, 'chip');
    chip.dataset.tone = 'waiting';
    badges.append(chip);
  }
  main.append(badges, element('h2', 'People you work with'));
  titleRow.append(main);
  header.append(topRow, titleRow);

  if (!groups.length) {
    body.append(element(
      'p',
      'No people on open tickets yet. The ticket skill adds each person you work with to the README people list of the ticket.',
      'empty-banner',
    ));
    return;
  }

  const activeFilter = peopleFilters.find((f) => f.id === peopleFilter) || peopleFilters[0];
  const bar = element('div', undefined, 'category-bar');
  const pills = element('div', undefined, 'category-pills');
  for (const filter of peopleFilters) {
    const count = allEntries.filter(filter.match).length;
    const btn = element('button', `${filter.label} (${count})`, `pill-btn${filter.id === activeFilter.id ? ' active' : ''}`);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      peopleFilter = filter.id;
      renderPeopleHub();
    });
    pills.append(btn);
  }
  bar.append(pills);
  body.append(bar);

  const visible = groups
    .map((group) => ({ ...group, entries: group.entries.filter((e) => activeFilter.match(e.person)) }))
    .filter((group) => group.entries.length)
    .sort((a, b) => comparePeople(a.entries[0].person, b.entries[0].person) || a.name.localeCompare(b.name));

  if (!visible.length) {
    body.append(element('p', 'No people match this filter.', 'empty-banner'));
    return;
  }

  const grid = element('div', undefined, 'people-grid');
  for (const group of visible) {
    const cardEl = element('article', undefined, 'person-card');
    cardEl.dataset.status = group.entries[0].person.status;
    const top = element('div', undefined, 'shelf-top');
    top.append(element('span', `👤 ${group.name}`, 'person-name'));
    const roles = [...new Set(group.entries.map((e) => e.person.role).filter(Boolean))];
    const tags = element('div', undefined, 'ticket-badges');
    for (const role of roles) tags.append(element('span', role, 'chip'));
    tags.append(element('span', `${group.entries.length} ${group.entries.length === 1 ? 'ticket' : 'tickets'}`, 'badge-mono'));
    top.append(tags);
    cardEl.append(top);
    const list = element('div', undefined, 'gate-list');
    for (const entry of group.entries) list.append(personRow(entry.person, { ticket: entry.ticket, showTicket: true }));
    cardEl.append(list);
    grid.append(cardEl);
  }
  body.append(grid);
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

function normalizePosixSegments(segments) {
  const out = [];
  for (const seg of segments) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!out.length) return null;
      out.pop();
    } else {
      out.push(seg);
    }
  }
  return out.join('/');
}

function resolveCanvasLinkTarget(rawHref, ticket, currentDocPath) {
  const clean = (rawHref || '').split('#')[0].split('?')[0].trim().replace(/^<|>$/g, '').replace(/\\/g, '/');
  if (!clean) return null;

  const tickets = snapshot?.tickets || [];
  const wikiPages = snapshot?.wikiPages || [];
  const wikiRoot = (snapshot?.wikiPath || '').replace(/\\/g, '/').replace(/\/+$/, '');

  // 0. Explicit wiki: prefix (used in frontmatter sources)
  let candidate = clean.startsWith('wiki:') ? clean.slice(5).replace(/^\/+/, '') : clean;

  // 1. Absolute path inside <wiki>/...
  if (wikiRoot && candidate.toLowerCase().startsWith(`${wikiRoot.toLowerCase()}/`)) {
    candidate = candidate.slice(wikiRoot.length + 1);
  }

  // 2. Relative resolution from current context
  let wikiRel = null;
  if (ticket) {
    // Check if it resolves inside the current ticket folder first
    if (candidate.endsWith('/')) {
      const folderSub = candidate.replace(/^\.\//, '');
      const firstSubDoc = (ticket.docs || []).find((d) => d.path.startsWith(folderSub));
      if (firstSubDoc) {
        return { kind: 'ticket-doc', ticket, docPath: firstSubDoc.path };
      }
    }
    const relTicketDoc = resolveRelativeDocPath(currentDocPath || 'README.md', candidate);
    if (relTicketDoc && (ticket.docs || []).some((d) => d.path.toLowerCase() === relTicketDoc.toLowerCase())) {
      const exactDoc = ticket.docs.find((d) => d.path.toLowerCase() === relTicketDoc.toLowerCase());
      return { kind: 'ticket-doc', ticket, docPath: exactDoc.path };
    }
    // Otherwise resolve relative to raw/tickets/<ticket.folder>/<currentDocDir> in the wiki
    const docDir = currentDocPath && currentDocPath.includes('/')
      ? currentDocPath.slice(0, currentDocPath.lastIndexOf('/'))
      : '';
    const baseParts = ['raw', 'tickets', ticket.folder, ...(docDir ? docDir.split('/') : [])];
    wikiRel = normalizePosixSegments([...baseParts, ...candidate.split('/')]);
  } else {
    const docDir = currentDocPath && currentDocPath.includes('/')
      ? currentDocPath.slice(0, currentDocPath.lastIndexOf('/'))
      : '';
    const baseParts = docDir ? docDir.split('/') : [];
    wikiRel = normalizePosixSegments([...baseParts, ...candidate.split('/')]);
  }

  // Also test direct wiki-root candidate (e.g. `tooling/vscode-agents-window.md` or `raw/tickets/mfd-77355/README.md`)
  const directWikiRel = normalizePosixSegments(candidate.split('/'));

  for (const testPath of [wikiRel, directWikiRel]) {
    if (!testPath) continue;
    const lower = testPath.toLowerCase();

    // Match raw/tickets/<folder>/<doc>
    const rawTicketMatch = /^raw\/tickets\/([^/]+)(?:\/(.*))?$/i.exec(testPath);
    if (rawTicketMatch) {
      const folderName = rawTicketMatch[1].toLowerCase();
      const subPath = (rawTicketMatch[2] || 'README.md').replace(/\/+$/, '') || 'README.md';
      const targetTicket = tickets.find(
        (t) => (t.folder || '').toLowerCase() === folderName || (t.key || '').toLowerCase() === folderName,
      );
      if (targetTicket) {
        const matchedDoc = (targetTicket.docs || []).find((d) => d.path.toLowerCase() === subPath.toLowerCase());
        if (matchedDoc) {
          return { kind: 'ticket-doc', ticket: targetTicket, docPath: matchedDoc.path };
        }
        if (!rawTicketMatch[2] || subPath.toLowerCase() === 'readme.md') {
          return { kind: 'ticket-cockpit', ticket: targetTicket };
        }
      }
    }

    // Match canonical wiki page
    const matchedWiki = wikiPages.find((p) => p.path.toLowerCase() === lower);
    if (matchedWiki) {
      return { kind: 'wiki-doc', docPath: matchedWiki.path, page: matchedWiki };
    }
  }

  return null;
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
        const resolvedTarget = resolveCanvasLinkTarget(target, ticket, currentDocPath);
        if (resolvedTarget && resolvedTarget.kind === 'ticket-doc') {
          const sameTicket = ticket && resolvedTarget.ticket.key === ticket.key;
          const docLink = element('a', labelText, 'internal-doc-link');
          docLink.href = `#ticket:${resolvedTarget.ticket.key}:${resolvedTarget.docPath}`;
          docLink.title = sameTicket
            ? `Open ${resolvedTarget.docPath}`
            : `Open ${resolvedTarget.ticket.key} / ${resolvedTarget.docPath}`;
          docLink.addEventListener('click', (e) => {
            e.preventDefault();
            if (sameTicket) {
              openDocumentReader(resolvedTarget.ticket, resolvedTarget.docPath);
            } else {
              openTicketCockpit(resolvedTarget.ticket.key, 'reader', resolvedTarget.docPath, true);
            }
          });
          parent.append(docLink);
        } else if (resolvedTarget && resolvedTarget.kind === 'ticket-cockpit') {
          const docLink = element('a', labelText, 'internal-doc-link');
          docLink.href = `#ticket:${resolvedTarget.ticket.key}`;
          docLink.title = `Open ticket ${resolvedTarget.ticket.key}`;
          docLink.addEventListener('click', (e) => {
            e.preventDefault();
            openTicketCockpit(resolvedTarget.ticket.key, 'summary', null, true);
          });
          parent.append(docLink);
        } else if (resolvedTarget && resolvedTarget.kind === 'wiki-doc') {
          const wikiLink = element('a', `📚 ${labelText}`, 'wiki-doc-link');
          wikiLink.href = `#wiki:${resolvedTarget.docPath}`;
          wikiLink.title = `Open wiki page ${resolvedTarget.docPath}`;
          wikiLink.addEventListener('click', (e) => {
            e.preventDefault();
            openWikiReader(resolvedTarget.docPath, true);
          });
          parent.append(wikiLink);
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
    const actionsGroup = element('div', undefined, 'ticket-badges');
    if (navHistory.length) {
      const historyBtn = element('button', '↩ Previous view', 'btn-secondary');
      historyBtn.type = 'button';
      historyBtn.addEventListener('click', () => popNavState());
      actionsGroup.append(historyBtn);
    }
    const backBtn = element('button', previousSection === 'people' ? '← Back to people' : '← Back to files', 'btn-secondary');
    backBtn.type = 'button';
    backBtn.addEventListener('click', () => {
      cockpitSection = previousSection || 'docs';
      renderCockpit(ticket);
    });
    actionsGroup.append(backBtn);
    toolbar.append(actionsGroup);
  }
  reader.append(toolbar);

  const renderedBody = renderMarkdownBody(doc.body || '', ticket, doc.path);
  reader.append(renderedBody);
  body.replaceChildren(reader);

  await renderMermaidDiagrams(renderedBody);
}

function renderWikiHeader() {
  const header = byId('wiki-header');
  if (!header) return;
  header.replaceChildren();

  const wikiPages = snapshot?.wikiPages || [];
  const topRow = element('div', undefined, 'cockpit-topbar');

  const leftBtns = element('div', undefined, 'ticket-badges');
  const ticketsBtn = element('button', '← Tickets board', 'btn-secondary');
  ticketsBtn.type = 'button';
  ticketsBtn.addEventListener('click', () => {
    viewMode = 'tickets';
    render();
  });
  leftBtns.append(ticketsBtn);

  if (navHistory.length) {
    const prevBtn = element('button', '↩ Previous view', 'btn-secondary');
    prevBtn.type = 'button';
    prevBtn.addEventListener('click', () => popNavState());
    leftBtns.append(prevBtn);
  }

  const switcher = element('div', undefined, 'cockpit-switcher');
  switcher.append(element('span', 'Jump to page:', 'field-label'));
  const pageSelect = element('select');
  const defaultOpt = element('option', 'Select a wiki or concept page...');
  defaultOpt.value = '';
  pageSelect.append(defaultOpt);
  for (const p of wikiPages) {
    const opt = element('option', `${p.path} — ${p.title}`);
    opt.value = p.path;
    opt.selected = wikiSection === 'reader' && activeWikiPath === p.path;
    pageSelect.append(opt);
  }
  pageSelect.addEventListener('change', () => {
    if (pageSelect.value) {
      openWikiReader(pageSelect.value, true);
    }
  });
  switcher.append(pageSelect);
  topRow.append(leftBtns, switcher);

  const titleRow = element('div', undefined, 'cockpit-title-row');
  const main = element('div', undefined, 'cockpit-title-main');

  const badges = element('div', undefined, 'ticket-badges');
  badges.append(element('span', '📚 WIKI & CONCEPTS', 'key'));

  const verifiedCount = wikiPages.filter((p) => p.status === 'verified' || p.status === 'decided').length;
  const learningCount = wikiPages.filter((p) => p.category === 'learning').length;
  const areaCount = wikiPages.filter((p) => p.category === 'area').length;

  const totalChip = element('span', `${wikiPages.length} canonical pages`, 'chip');
  totalChip.dataset.tone = 'info';
  badges.append(totalChip);

  if (learningCount) {
    const learnChip = element('span', `🎓 ${learningCount} concept ${learningCount === 1 ? 'lesson' : 'lessons'}`, 'chip');
    learnChip.dataset.tone = 'ok';
    badges.append(learnChip);
  }
  if (areaCount) {
    badges.append(element('span', `🏗️ ${areaCount} architecture & area pages`, 'chip'));
  }
  if (verifiedCount) {
    const verChip = element('span', `✓ ${verifiedCount} verified/decided`, 'chip');
    verChip.dataset.tone = 'approved';
    badges.append(verChip);
  }

  main.append(badges, element('h2', 'Engineering Wiki & Concept Knowledge Hub'));
  titleRow.append(main);
  header.append(topRow, titleRow);
}

function renderWikiNav() {
  const nav = byId('wiki-nav');
  if (!nav) return;
  nav.replaceChildren();

  const wikiPages = snapshot?.wikiPages || [];
  const hasIndex = wikiPages.some((p) => p.path === 'index.md');

  const sections = [
    { id: 'overview', label: '🧭 Knowledge Shelves' },
    ...(hasIndex ? [{ id: 'index', label: '📚 Index (index.md)' }] : []),
    { id: 'explorer', label: '🗂️ Browse & Search Pages', count: String(wikiPages.length) },
  ];

  if (wikiSection === 'reader' && activeWikiPath) {
    const pageMeta = wikiPages.find((p) => p.path === activeWikiPath);
    sections.push({
      id: 'reader',
      label: `📖 ${pageMeta ? pageMeta.label : activeWikiPath}`,
    });
  }

  for (const sec of sections) {
    const btn = element('button', undefined, `nav-section-btn${wikiSection === sec.id ? ' active' : ''}`);
    btn.type = 'button';
    btn.append(element('span', sec.label));
    if (sec.count !== undefined) {
      btn.append(element('span', sec.count, 'nav-count'));
    }
    btn.addEventListener('click', () => {
      wikiSection = sec.id;
      renderWikiHub();
    });
    nav.append(btn);
  }
}

function renderWikiOverviewSection() {
  const body = byId('wiki-body');
  if (!body) return;
  body.replaceChildren();

  const wikiPages = snapshot?.wikiPages || [];
  const stack = element('div', undefined, 'summary-stack');

  const hero = element('div', undefined, 'hero-card');
  hero.append(element('p', '🔥 Shared Engineering Memory & Concept Library', 'hero-stakes'));
  hero.append(
    element(
      'p',
      'Explore architecture pages, concept lessons, tooling gotchas, engineering decisions, and distilled ticket summaries. Every Markdown link between tickets and wiki pages opens directly in this workbench.',
      'hero-next',
    ),
  );
  stack.append(hero);

  if (!wikiPages.length) {
    stack.append(element('p', 'No canonical wiki pages found in this repository wiki yet.', 'empty-banner'));
    body.append(stack);
    return;
  }

  const shelves = element('div', undefined, 'category-shelves');
  for (const cat of wikiCategories) {
    const group = wikiPages.filter((p) => p.category === cat.id);
    if (!group.length) continue;

    const cardEl = element('button', undefined, 'shelf-card');
    cardEl.type = 'button';

    const top = element('div', undefined, 'shelf-top');
    top.append(element('span', cat.label), element('span', `${group.length}`, 'badge-mono'));

    const desc = element('p', cat.desc, 'shelf-desc');

    const pills = element('div', undefined, 'shelf-pills');
    for (const page of group.slice(0, 3)) {
      pills.append(element('span', page.title || page.path, 'chip'));
    }
    if (group.length > 3) {
      pills.append(element('span', `+${group.length - 3} more`, 'chip'));
    }

    cardEl.append(top, desc, pills);
    cardEl.addEventListener('click', () => {
      activeWikiCategory = cat.id;
      activeWikiArea = '';
      wikiSection = 'explorer';
      renderWikiHub();
    });
    shelves.append(cardEl);
  }
  stack.append(shelves);
  body.append(stack);
}

function renderWikiExplorerSection() {
  const body = byId('wiki-body');
  if (!body) return;
  body.replaceChildren();

  const wikiPages = snapshot?.wikiPages || [];
  if (!wikiPages.length) {
    body.append(element('p', 'No canonical wiki pages found in this repository wiki.', 'empty-banner'));
    return;
  }

  const availableCats = wikiCategories.filter((cat) => wikiPages.some((p) => p.category === cat.id));
  if (activeWikiCategory !== 'all' && !availableCats.some((c) => c.id === activeWikiCategory)) {
    activeWikiCategory = 'all';
  }

  const filterBar = element('div', undefined, 'filters');
  const searchLabel = element('label', undefined, 'search-field');
  searchLabel.append(element('span', 'Find topic or concept', 'field-label'));
  const searchInput = element('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Filter by title, path, area, or summary...';
  searchInput.value = wikiSearchQuery;
  searchLabel.append(searchInput);
  filterBar.append(searchLabel);

  const areas = [...new Set(wikiPages.map((p) => p.area).filter((a) => a && a !== 'root'))].sort();
  if (areas.length > 1) {
    const areaLabel = element('label', undefined, 'state-select-label');
    areaLabel.append(element('span', 'Folder', 'field-label'));
    const areaSelect = element('select');
    const allOpt = element('option', 'All folders');
    allOpt.value = '';
    areaSelect.append(allOpt);
    for (const areaName of areas) {
      const opt = element('option', areaName);
      opt.value = areaName;
      opt.selected = activeWikiArea === areaName;
      areaSelect.append(opt);
    }
    areaSelect.addEventListener('change', () => {
      activeWikiArea = areaSelect.value;
      renderWikiExplorerSection();
    });
    areaLabel.append(areaSelect);
    filterBar.append(areaLabel);
  }
  body.append(filterBar);

  const catBar = element('div', undefined, 'category-bar');
  const pills = element('div', undefined, 'category-pills');

  const allBtn = element('button', `All (${wikiPages.length})`, `pill-btn${activeWikiCategory === 'all' ? ' active' : ''}`);
  allBtn.type = 'button';
  allBtn.addEventListener('click', () => {
    activeWikiCategory = 'all';
    renderWikiExplorerSection();
  });
  pills.append(allBtn);

  for (const cat of availableCats) {
    const count = wikiPages.filter((p) => p.category === cat.id).length;
    const btn = element('button', `${cat.label} (${count})`, `pill-btn${activeWikiCategory === cat.id ? ' active' : ''}`);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      activeWikiCategory = cat.id;
      renderWikiExplorerSection();
    });
    pills.append(btn);
  }
  catBar.append(pills);
  body.append(catBar);

  const gridContainer = element('div');
  body.append(gridContainer);

  const updateCatalogGrid = () => {
    const q = wikiSearchQuery.trim().toLowerCase();
    const filtered = wikiPages.filter((p) =>
      (activeWikiCategory === 'all' || p.category === activeWikiCategory)
      && (!activeWikiArea || p.area === activeWikiArea)
      && (!q || [p.title, p.path, p.summary || '', p.area || '', p.status || ''].some((v) => v.toLowerCase().includes(q))),
    );

    if (!filtered.length) {
      gridContainer.replaceChildren(element('p', 'No wiki pages match these filters.', 'empty-banner'));
      return;
    }

    const grid = element('div', undefined, 'doc-catalog-grid');
    for (const page of filtered) {
      const cardBtn = element('button', undefined, 'doc-catalog-card');
      cardBtn.type = 'button';

      const top = element('div', undefined, 'doc-catalog-top');
      top.append(element('span', page.label));
      if (page.hasMermaid) {
        top.append(element('span', '📊 Mermaid', 'tab-mermaid-tag'));
      } else if (page.status) {
        const st = element('span', page.status, 'chip');
        st.dataset.tone = page.status === 'verified' || page.status === 'decided' ? 'approved' : 'warn';
        top.append(st);
      }

      cardBtn.append(top);
      cardBtn.append(element('span', page.path, 'doc-catalog-path'));
      if (page.summary) {
        cardBtn.append(element('p', stripInlineMarkdown(page.summary), 'doc-catalog-summary'));
      }
      if (page.updated) {
        cardBtn.append(element('span', `Updated ${page.updated}`, 'gate-meta-line'));
      }

      cardBtn.addEventListener('click', () => openWikiReader(page.path, true));
      grid.append(cardBtn);
    }
    gridContainer.replaceChildren(grid);
  };

  searchInput.addEventListener('input', () => {
    wikiSearchQuery = searchInput.value;
    updateCatalogGrid();
  });

  updateCatalogGrid();
}

async function renderWikiDocumentView(docPath, showBackToExplorer = true) {
  const body = byId('wiki-body');
  if (!body) return;
  const cacheKey = `wiki:${docPath}`;
  const reqId = ++docRequestSeq;

  if (!docCache.has(cacheKey)) {
    body.replaceChildren(element('p', `Loading ${docPath}...`, 'gate-meta-line'));
  }

  try {
    const encodedPath = docPath.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`/wiki/docs/${encodedPath}`, { cache: 'no-store' });
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
  metaGroup.append(element('span', doc.label || doc.title, 'key'));
  metaGroup.append(element('code', doc.path, 'badge-mono'));
  if (doc.area && doc.area !== 'root') {
    metaGroup.append(element('span', `📂 ${doc.area}`, 'chip'));
  }
  if (doc.status) {
    const stChip = element('span', `status: ${doc.status}`, 'chip');
    stChip.dataset.tone = doc.status === 'verified' || doc.status === 'decided' ? 'approved' : 'warn';
    metaGroup.append(stChip);
  }
  if (doc.updated) metaGroup.append(element('span', `Updated ${doc.updated}`, 'chip'));
  toolbar.append(metaGroup);

  const actionsGroup = element('div', undefined, 'ticket-badges');
  if (navHistory.length) {
    const historyBtn = element('button', '↩ Previous view', 'btn-secondary');
    historyBtn.type = 'button';
    historyBtn.addEventListener('click', () => popNavState());
    actionsGroup.append(historyBtn);
  }
  if (showBackToExplorer) {
    const backBtn = element('button', '← All wiki pages', 'btn-secondary');
    backBtn.type = 'button';
    backBtn.addEventListener('click', () => {
      wikiSection = 'explorer';
      renderWikiHub();
    });
    actionsGroup.append(backBtn);
  }
  toolbar.append(actionsGroup);
  reader.append(toolbar);

  const renderedBody = renderMarkdownBody(doc.body || '', null, doc.path);
  reader.append(renderedBody);

  if (Array.isArray(doc.sources) && doc.sources.length) {
    const sourcesBox = element('div', undefined, 'wiki-sources-box');
    sourcesBox.append(element('h4', '🔗 Verified Sources & Linked Artifacts'));
    const ul = element('ul', undefined, 'wiki-sources-list');
    for (const src of doc.sources) {
      const li = element('li');
      const resolved = resolveCanvasLinkTarget(src, null, doc.path);
      if (resolved) {
        appendInlineMarkdown(li, `[${src}](${src})`, null, doc.path);
      } else if (isSafeHttpUrl(src)) {
        link(li, src, src);
      } else {
        li.append(element('code', src));
      }
      ul.append(li);
    }
    sourcesBox.append(ul);
    reader.append(sourcesBox);
  }

  body.replaceChildren(reader);
  await renderMermaidDiagrams(renderedBody);
}

function renderWikiHub() {
  renderWikiHeader();
  renderWikiNav();

  if (wikiSection === 'overview') {
    renderWikiOverviewSection();
  } else if (wikiSection === 'index') {
    renderWikiDocumentView('index.md', false);
  } else if (wikiSection === 'explorer') {
    renderWikiExplorerSection();
  } else if (wikiSection === 'reader' && activeWikiPath) {
    renderWikiDocumentView(activeWikiPath, true);
  } else {
    renderWikiOverviewSection();
  }
}

function renderCockpit(ticket) {
  renderCockpitHeader(ticket);
  renderCockpitNav(ticket);

  if (cockpitSection === 'summary') {
    renderSummarySection(ticket);
  } else if (cockpitSection === 'gates') {
    renderGatesSection(ticket);
  } else if (cockpitSection === 'people') {
    renderPeopleSection(ticket);
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
  const wikiScreen = byId('wiki-screen');
  const peopleScreen = byId('people-screen');
  const pageTitle = byId('page-title');

  const modeTicketsBtn = byId('mode-tickets');
  const modeWikiBtn = byId('mode-wiki');
  const modePeopleBtn = byId('mode-people');
  const modeTicketsCount = byId('mode-tickets-count');
  const modeWikiCount = byId('mode-wiki-count');
  const modePeopleCount = byId('mode-people-count');
  if (modeTicketsCount) modeTicketsCount.textContent = String(snapshot.tickets.length);
  if (modeWikiCount) modeWikiCount.textContent = String((snapshot.wikiPages || []).length);
  if (modePeopleCount) {
    modePeopleCount.textContent = String(collectPeople().filter((g) => g.entries.some((e) => e.person.status !== 'done')).length);
  }
  if (modeTicketsBtn) modeTicketsBtn.className = `mode-btn${viewMode === 'tickets' ? ' active' : ''}`;
  if (modeWikiBtn) modeWikiBtn.className = `mode-btn${viewMode === 'wiki' ? ' active' : ''}`;
  if (modePeopleBtn) modePeopleBtn.className = `mode-btn${viewMode === 'people' ? ' active' : ''}`;
  if (peopleScreen) peopleScreen.hidden = viewMode !== 'people';

  if (viewMode === 'people') {
    overviewScreen.hidden = true;
    cockpitScreen.hidden = true;
    if (wikiScreen) wikiScreen.hidden = true;
    pageTitle.textContent = 'People';
    renderPeopleHub();
  } else if (viewMode === 'wiki') {
    overviewScreen.hidden = true;
    cockpitScreen.hidden = true;
    if (wikiScreen) wikiScreen.hidden = false;
    pageTitle.textContent = 'Wiki & Concepts Hub';
    renderWikiHub();
  } else if (activeTicket) {
    overviewScreen.hidden = true;
    cockpitScreen.hidden = false;
    if (wikiScreen) wikiScreen.hidden = true;
    pageTitle.textContent = `${activeTicket.key} Cockpit`;
    renderCockpit(activeTicket);
  } else {
    overviewScreen.hidden = false;
    cockpitScreen.hidden = true;
    if (wikiScreen) wikiScreen.hidden = true;
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
    const changed = !snapshot
      || JSON.stringify([data.tickets, data.wikiPages || [], data.errors])
      !== JSON.stringify([snapshot.tickets, snapshot.wikiPages || [], snapshot.errors]);
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
byId('mode-tickets')?.addEventListener('click', () => {
  viewMode = 'tickets';
  render();
});
byId('mode-wiki')?.addEventListener('click', () => {
  openWikiHub(wikiSection || 'overview', activeWikiPath, null, false);
});
byId('mode-people')?.addEventListener('click', () => openPeopleHub(null, false));
byId('kpi-people-action-card')?.addEventListener('click', () => openPeopleHub('action', true));
byId('kpi-people-waiting-card')?.addEventListener('click', () => openPeopleHub('waiting', true));
refresh();
setInterval(refresh, 5000);
