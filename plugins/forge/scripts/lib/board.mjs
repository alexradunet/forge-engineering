// The ticket board: <forge>/raw/board.md, grouped by state. The output is the same for the same wiki and day. board-page.mjs shows the same model as a page.
import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { homeOf, rawDir, repoNameOf, siblingWikis } from './layout.mjs';
import { readBinding } from './repo.mjs';
import { STATE_EMOJI, sessionTitle, validDate } from './ticket.mjs';
import { listTickets } from './tickets.mjs';

export const BOARD_ORDER = ['needs-me', 'blocked', 'go', 'active', 'waiting', 'done'];
export const STATE_LABEL = { 'needs-me': 'Needs me', blocked: 'Blocked', go: 'Go', active: 'Active', waiting: 'Waiting', done: 'Done' };
const OPEN_GATE = ['in-review', 'blocked', 'todo'];
const byKey = (a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);
const oneLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export function boardFile(wikiPath) {
  return path.join(rawDir(wikiPath), 'board.md');
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

const isFolder = (folder) => { try { return statSync(folder).isDirectory(); } catch { return false; } };

/** The folder where a session of the ticket starts: the README worktree when it exists, else the repository of the binding, else (Forge folder only) <parent>/<name>, else null. */
export function resumeFolderOf(wikiPath, ticket) {
  if (ticket.worktree && isFolder(ticket.worktree)) return path.resolve(ticket.worktree);
  try {
    const repo = readBinding(wikiPath)?.repo?.path;
    if (repo) return path.resolve(repo);
  } catch { /* An unreadable binding: use the name. */ }
  if (homeOf(wikiPath) === wikiPath) return null; // The plain --wiki layout: <parent>/<name> is the wiki itself.
  return path.join(path.dirname(homeOf(wikiPath)), repoNameOf(wikiPath));
}

export function buildBoard(wikiPath, { today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!validDate(today)) throw new Error(`Invalid date: ${today}. Use YYYY-MM-DD.`);
  const tickets = [];
  const errors = [];
  for (const entry of listTickets(wikiPath)) {
    if (entry.error) { errors.push({ folder: entry.folder, message: entry.error }); continue; }
    const ticket = entry.ticket;
    tickets.push({
      key: ticket.key, item: oneLine(ticket.item), folder: entry.folder, sessionTitle: sessionTitle(ticket), title: oneLine(ticket.title), short: oneLine(ticket.short),
      state: ticket.state, emoji: STATE_EMOJI[ticket.state], phase: ticket.phase, workflow: ticket.workflow,
      openGate: openGate(ticket), gates: ticket.gates.filter((gate) => gate.need === 'required').map((gate) => ({ name: gate.name, status: gate.status, doc: gate.doc ?? '' })), next: oneLine(ticket.next), waitingOn: oneLine(ticket.waitingOn),
      updated: ticket.updated, days: daysSince(ticket.updated, today), branch: ticket.branch, worktree: ticket.worktree, resumeFolder: resumeFolderOf(wikiPath, ticket),
      changes: ticket.changes.map((change) => ({ url: change.url, state: change.state, label: change.label ?? '' })),
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

const needsMeOf = (row) => row.board?.groups.find((group) => group.state === 'needs-me')?.tickets ?? [];

/**
 * The boards of this repository and of the sibling Forge folders (siblingWikis). It writes no file.
 * { version, generated, repos: [{ repo, forge, wiki, current, board, error }], needsMe: [{ repo, ...ticket }], errors }.
 * A repository that cannot be read has an error and no board.
 */
export function buildAllBoards(wikiPath, { today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!validDate(today)) throw new Error(`Invalid date: ${today}. Use YYYY-MM-DD.`);
  const repos = siblingWikis(wikiPath).map((wiki, index) => {
    const row = { repo: repoNameOf(wiki), forge: homeOf(wiki), wiki, current: index === 0, board: null, error: '' };
    try { row.board = buildBoard(wiki, { today }); } catch (error) { row.error = oneLine(error.message); }
    return row;
  });
  const needsMe = repos.flatMap((row) => needsMeOf(row).map((ticket) => ({ repo: row.repo, ...ticket })));
  const errors = repos.filter((row) => row.error).map((row) => ({ repo: row.repo, message: row.error }));
  return { version: 1, generated: today, repos, needsMe, errors };
}

/** The lines of `board --all`: the 🟡 count of each repository, then one block for each repository. */
export function renderAllBoards(all) {
  const lines = [`🟡 ${all.repos.map((row) => `${row.repo} ${needsMeOf(row).length}`).join(' · ')}`];
  for (const row of all.repos) {
    lines.push('', `${row.repo}${row.current ? ' (this repository)' : ''}`);
    if (row.error) { lines.push(`  read error: ${row.error}`); continue; }
    lines.push(`  ${row.board.groups.map((group) => `${group.emoji} ${group.label} ${group.tickets.length}`).join(' · ')}`);
    for (const ticket of needsMeOf(row)) lines.push(`  ${ticket.key} ${ticket.openGate ? `${ticket.openGate.name} ${ticket.openGate.status}` : ticket.phase}: ${ticket.next}`.trimEnd());
    for (const error of row.board.errors) lines.push(`  read error ${error.folder}: ${error.message}`);
  }
  return lines;
}

const cell = (value) => oneLine(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|') || ' ';
const age = (days) => days === null ? '?' : days <= 0 ? 'today' : days === 1 ? '1 day' : `${days} days`;

function changeText(item) {
  return item.changes.map((change) => `${change.label || 'PR'} ${change.state}`).join(', ');
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
      '| Ticket | Phase | Open gate | Next | Waiting on | Updated | Changes |',
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
