// The change stamps of the live server (live-serve.mjs): a short hash that tells a page that the data of the page changed.
// The board stamp covers the board model that the board page shows. The ticket stamp covers the Markdown files of one ticket folder and the board row of the ticket.
// The needs count is the number that the tab title and the icon of a page show. This file imports only Node built-ins.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';

const STAMP_LENGTH = 12;
const MAX_DEPTH = 3;
const MAX_FILES = 300;

const stampOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, STAMP_LENGTH);

/** The stamp of a board model (buildBoard). The time of its generation is not a part of it. */
export function boardStamp(board) {
  return stampOf(JSON.stringify(board ?? null, (key, value) => (key === 'generated' ? undefined : value)));
}

// The name, the size, and the change time of each Markdown file of a folder, with the folders below it. A link is not followed.
function markdownFiles(dir, base = '', depth = 0, found = []) {
  let names = [];
  try { names = readdirSync(dir, { withFileTypes: true }).map((item) => item.name).sort(); } catch { return found; }
  for (const name of names) {
    if (found.length >= MAX_FILES) break;
    const file = path.join(dir, name);
    let info;
    try { info = lstatSync(file); } catch { continue; }
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) { if (depth < MAX_DEPTH) markdownFiles(file, `${base}${name}/`, depth + 1, found); continue; }
    if (info.isFile() && name.toLowerCase().endsWith('.md')) found.push(`${base}${name}:${info.size}:${Math.round(info.mtimeMs)}`);
  }
  return found;
}

/** The stamp of one ticket: its Markdown files in `dir`, and its row of the board model (or null). */
export function ticketStamp(dir, row = null) {
  return stampOf(`${markdownFiles(dir).join('\n')}\n${JSON.stringify(row ?? null, (key, value) => (key === 'generated' ? undefined : value))}`);
}

/**
 * The count for the tab: each board ticket in the state needs-me, and each live session in the state needs-you whose ticket is not counted yet.
 * Two sessions of one ticket count one time. A session without a ticket counts for itself.
 */
export function needsCount(tickets, sessions) {
  const counted = new Set(tickets.filter((item) => item.state === 'needs-me').map((item) => item.folder));
  let count = counted.size;
  for (const session of sessions) {
    if (session.state !== 'needs-you') continue;
    if (!session.ticket) { count += 1; continue; }
    if (counted.has(session.ticket)) continue;
    counted.add(session.ticket);
    count += 1;
  }
  return count;
}
