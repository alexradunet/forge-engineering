const labels = {
  'needs-me': 'Needs me', go: 'Ready', active: 'Active',
  waiting: 'Waiting', blocked: 'Blocked', done: 'Done',
};
const byId = (id) => document.getElementById(id);
let snapshot = null;
let loading = false;

function showStatus() {
  const count = byId('board').querySelectorAll('article').length;
  const errors = snapshot.errors.length;
  byId('status').textContent = `${count} shown / ${snapshot.tickets.length} tickets. ${errors} read ${errors === 1 ? 'error' : 'errors'}. Refreshed ${new Date(snapshot.scannedAt).toLocaleTimeString()}. Auto-refresh: 5 seconds.`;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function link(parent, text, address) {
  try {
    const url = new URL(address);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      parent.append(element('span', `${text}: unsupported URL`));
      return;
    }
    const anchor = element('a', text);
    anchor.href = url.href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    parent.append(anchor);
  } catch {
    parent.append(element('span', `${text}: invalid URL`));
  }
}

function card(ticket) {
  const node = element('article');
  node.append(element('span', ticket.key, 'key'), element('h3', ticket.title));
  node.append(element('p', `${ticket.phase} / Track ${ticket.track}`, 'meta'));
  node.append(element('p', ticket.next, 'next'));
  if (ticket.waitingOn) node.append(element('p', `Waiting on: ${ticket.waitingOn}`));
  const pending = ticket.gates.filter((gate) => !['approved', 'skipped'].includes(gate.status));
  node.append(element('p', `${pending.length} pending ${pending.length === 1 ? 'gate' : 'gates'}`, 'meta'));
  const details = element('details');
  details.append(element('summary', 'Ticket details'));
  for (const [label, value] of [
    ['Branch', ticket.branch], ['Worktree', ticket.worktree],
    ['Updated', ticket.updated], ['Source', ticket.file],
  ]) {
    if (value) details.append(element('p', `${label}: ${value}`, 'path'));
  }
  if (ticket.item) link(details, 'Work item', ticket.item);
  const gates = element('ul');
  for (const gate of ticket.gates) {
    gates.append(element('li', `${gate.name} - ${gate.status} (${gate.need})${gate.doc ? ` / ${gate.doc}` : ''}`));
  }
  details.append(gates);
  for (const change of ticket.changes) {
    const row = element('p');
    link(row, `${change.label || 'Change request'} (${change.state})`, change.url);
    details.append(row);
  }
  node.append(details);
  return node;
}

function render() {
  if (!snapshot) return;
  const query = byId('search').value.trim().toLowerCase();
  const state = byId('state').value;
  const tickets = snapshot.tickets.filter((ticket) =>
    (byId('done').checked || (ticket.state !== 'done' && ticket.phase !== 'closed'))
    && (!state || ticket.state === state)
    && [ticket.key, ticket.title, ticket.next, ticket.waitingOn].some((value) => value.toLowerCase().includes(query)));
  const board = byId('board');
  const expanded = new Set([...board.querySelectorAll('article')].filter((node) => node.querySelector('details').open)
    .map((node) => node.querySelector('.key').textContent));
  board.replaceChildren();
  for (const [value, label] of Object.entries(labels)) {
    if (state && state !== value) continue;
    if (value === 'done' && !byId('done').checked) continue;
    const group = tickets.filter((ticket) => ticket.state === value);
    const column = element('section', undefined, 'column');
    column.dataset.state = value;
    column.append(element('h2', `${label} (${group.length})`));
    for (const ticket of group) {
      const node = card(ticket);
      node.querySelector('details').open = expanded.has(ticket.key);
      column.append(node);
    }
    board.append(column);
  }
  byId('wiki').textContent = snapshot.wikiPath;
  byId('empty').hidden = tickets.length > 0;
  byId('empty').textContent = snapshot.tickets.length
    ? 'No tickets match these filters.' : 'No tickets yet. Start a ticket with Forge to populate this dashboard.';
  const errors = byId('errors');
  errors.hidden = !snapshot.errors.length;
  errors.querySelector('ul').replaceChildren(...snapshot.errors.map((error) =>
    element('li', `${error.file}\n${error.message}`)));
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
    // Keep focused controls intact while the user reads ticket details.
    const changed = !snapshot || JSON.stringify([data.tickets, data.errors]) !== JSON.stringify([snapshot.tickets, snapshot.errors]);
    snapshot = data;
    if (changed) render();
    else showStatus();
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
refresh();
setInterval(refresh, 5000);
