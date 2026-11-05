// Finds and reads the ticket folders of a wiki: <wiki>/raw/tickets/<key>/README.md.
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseTicket } from './ticket.mjs';

export function ticketRoot(wikiPath) {
  return path.join(wikiPath, 'raw', 'tickets');
}

/** Every ticket folder, sorted by name. Each entry has a parsed ticket or a read error. */
export function listTickets(wikiPath) {
  const root = ticketRoot(wikiPath);
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const out = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = path.join(root, entry.name);
    const file = path.join(dir, 'README.md');
    try {
      if (lstatSync(file).isSymbolicLink()) throw new Error('README.md must not be a link.');
      out.push({ dir, file, folder: entry.name, ticket: parseTicket(readFileSync(file, 'utf8')) });
    } catch (error) {
      out.push({ dir, file, folder: entry.name, error: error.code === 'ENOENT' ? 'README.md is missing.' : error.message });
    }
  }
  return out;
}

/** The folder of one ticket, by folder name or README key (case-insensitive). */
export function findTicket(wikiPath, key) {
  const wanted = String(key).trim().toLowerCase();
  const all = listTickets(wikiPath);
  const match = all.find((item) => item.folder.toLowerCase() === wanted)
    ?? all.find((item) => item.ticket?.key.toLowerCase() === wanted);
  if (!match) throw new Error(`No ticket folder for ${key} in ${ticketRoot(wikiPath)}.`);
  if (match.error) throw new Error(`${match.file}: ${match.error}`);
  return match;
}
