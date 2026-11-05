// The ticket board: <wiki>/raw/board.md, grouped by state. The output is the same for the same wiki and day.
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { STATE_EMOJI, parseFrontmatter, sessionTitle, validDate } from './ticket.mjs';
import { listTickets } from './tickets.mjs';

export const BOARD_ORDER = ['needs-me', 'blocked', 'go', 'active', 'waiting', 'done'];
export const STATE_LABEL = { 'needs-me': 'Needs me', blocked: 'Blocked', go: 'Go', active: 'Active', waiting: 'Waiting', done: 'Done' };
export const SYNC_FIELDS = ['checked', 'jira', 'pr', 'ci'];
const OPEN_GATE = ['in-review', 'blocked', 'todo'];
const byKey = (a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);
const oneLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export function boardFile(wikiPath) {
  return path.join(wikiPath, 'raw', 'board.md');
}

/** The first required gate that is not done, with in-review before blocked before todo. */
export function openGate(ticket) {
  for (const status of OPEN_GATE) {
    const gate = ticket.gates.find((item) => item.need === 'required' && item.status === status);
    if (gate) return { name: gate.name, status: gate.status };
  }
  return null;
}

/** Monday to Friday days after `since`, up to and including `today`. */
export function workdaysSince(since, today) {
  if (!validDate(since) || !validDate(today)) return null;
  const start = Date.parse(since);
  const end = Date.parse(today);
  let count = 0;
  for (let time = start + 86_400_000; time <= end; time += 86_400_000) {
    const day = new Date(time).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

/** The `waiting` people of an open ticket after more than WAIT_WORKDAYS working days. */
export const WAIT_WORKDAYS = 3;
export function longWaits(ticket, today) {
  if (ticket.state === 'done') return [];
  return ticket.people
    .filter((person) => person.status === 'waiting')
    .map((person) => ({ name: person.name, role: oneLine(person.role), ask: oneLine(person.ask), since: person.since, workdays: workdaysSince(person.since, today) }))
    .filter((wait) => wait.workdays !== null && wait.workdays > WAIT_WORKDAYS);
}

export function daysSince(updated, today) {
  if (!validDate(updated) || !validDate(today)) return null;
  return Math.round((Date.parse(today) - Date.parse(updated)) / 86_400_000);
}

/** The sync note that the Forge Master or the maintenance automation writes: raw/sync/<key>.md frontmatter. */
export function readSync(wikiPath, key) {
  const file = path.join(wikiPath, 'raw', 'sync', `${key}.md`);
  if (!existsSync(file)) return null;
  try {
    if (lstatSync(file).isSymbolicLink()) throw new Error('The sync note must not be a link.');
    const data = parseFrontmatter(readFileSync(file, 'utf8'), []);
    return Object.fromEntries(SYNC_FIELDS.map((field) => [field, typeof data[field] === 'string' ? oneLine(data[field]) : '']));
  } catch (error) {
    return { error: `raw/sync/${key}.md: ${error.message}` };
  }
}

export function buildBoard(wikiPath, { today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!validDate(today)) throw new Error(`Invalid date: ${today}. Use YYYY-MM-DD.`);
  const tickets = [];
  const errors = [];
  for (const entry of listTickets(wikiPath)) {
    if (entry.error) { errors.push({ folder: entry.folder, message: entry.error }); continue; }
    const ticket = entry.ticket;
    const sync = readSync(wikiPath, ticket.key);
    if (sync?.error) errors.push({ folder: entry.folder, message: sync.error });
    tickets.push({
      key: ticket.key, folder: entry.folder, sessionTitle: sessionTitle(ticket), title: oneLine(ticket.title),
      state: ticket.state, emoji: STATE_EMOJI[ticket.state], phase: ticket.phase, workflow: ticket.workflow ?? 'legacy',
      openGate: openGate(ticket), next: oneLine(ticket.next), waitingOn: oneLine(ticket.waitingOn),
      updated: ticket.updated, days: daysSince(ticket.updated, today), branch: ticket.branch, worktree: ticket.worktree,
      changes: ticket.changes.map((change) => ({ url: change.url, state: change.state, label: change.label ?? '' })),
      sync: sync && !sync.error ? sync : null,
      waits: longWaits(ticket, today),
    });
  }
  const groups = BOARD_ORDER.map((state) => ({
    state, emoji: STATE_EMOJI[state], label: STATE_LABEL[state],
    tickets: tickets.filter((item) => item.state === state).sort((a, b) => byKey(a.key, b.key)),
  }));
  errors.sort((a, b) => byKey(a.folder, b.folder) || byKey(a.message, b.message));
  return { version: 1, generated: today, total: tickets.length, groups, errors };
}

const cell = (value) => oneLine(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|') || ' ';
const age = (days) => days === null ? '?' : days <= 0 ? 'today' : days === 1 ? '1 day' : `${days} days`;

function changeText(item) {
  const parts = [];
  if (item.sync?.pr) parts.push(`PR ${item.sync.pr}`);
  else if (item.changes.length) parts.push(item.changes.map((change) => `${change.label || 'PR'} ${change.state}`).join(', '));
  if (item.sync?.ci) parts.push(`CI ${item.sync.ci}`);
  if (item.sync?.jira) parts.push(`Jira ${item.sync.jira}`);
  return parts.join(' · ');
}

export function renderBoard(board) {
  const lines = [
    '# 🗂️ Forge board', '',
    `Generated ${board.generated} by \`forge.mjs board\`. Do not edit this file. The next run replaces it.`, '',
    board.groups.map((group) => `${group.emoji} ${group.label} ${group.tickets.length}`).join(' · '), '',
  ];
  if (!board.total) lines.push('No tickets yet.', '');
  for (const group of board.groups.filter((item) => item.tickets.length)) {
    lines.push(`## ${group.emoji} ${group.label} (${group.tickets.length})`, '',
      '| Ticket | Phase | Open gate | Next | Waiting on | Updated | PR / CI / Jira |',
      '| --- | --- | --- | --- | --- | --- | --- |');
    for (const item of group.tickets) {
      const gate = item.openGate ? `${item.openGate.name} ${item.openGate.status}` : '';
      lines.push(`| [${cell(item.sessionTitle)}](<tickets/${item.folder}/README.md>) | ${cell(item.phase)} | ${cell(gate)} | ${cell(item.next)} | ${cell(item.waitingOn)} | ${age(item.days)} | ${cell(changeText(item))} |`);
    }
    lines.push('');
  }
  const waits = board.groups.flatMap((group) => group.tickets.flatMap((item) => item.waits.map((wait) => ({ key: item.key, ...wait }))));
  if (waits.length) {
    lines.push(`## ⏳ People waits (more than ${WAIT_WORKDAYS} working days)`, '',
      '| Ticket | Person | Role | Ask | Since | Working days |',
      '| --- | --- | --- | --- | --- | --- |');
    for (const wait of waits) lines.push(`| ${cell(wait.key)} | ${cell(wait.name)} | ${cell(wait.role)} | ${cell(wait.ask)} | ${cell(wait.since)} | ${wait.workdays} |`);
    lines.push('');
  }
  if (board.errors.length) {
    lines.push('## ⚠️ Read errors', '');
    for (const error of board.errors) lines.push(`- \`${error.folder}\`: ${oneLine(error.message)}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Builds the board and writes raw/board.md unless dryRun is set. */
export function writeBoard(wikiPath, { today, dryRun = false } = {}) {
  const board = buildBoard(wikiPath, { today });
  const file = boardFile(wikiPath);
  const text = renderBoard(board);
  let changed = true;
  try { changed = readFileSync(file, 'utf8') !== text; } catch { /* first board */ }
  if (!dryRun && changed) {
    mkdirSync(path.dirname(file), { recursive: true });
    if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error(`${file} must not be a link.`);
    writeFileSync(file, text);
  }
  return { ...board, file, changed, written: !dryRun && changed };
}
