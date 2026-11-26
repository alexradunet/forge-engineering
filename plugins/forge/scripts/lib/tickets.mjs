// Finds and reads the ticket folders of a repository: <forge>/raw/tickets/<key>/README.md (rawDir in layout.mjs gives the raw folder of a wiki).
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { rawDir } from './layout.mjs';
import { parseTicket } from './ticket.mjs';

export function ticketRoot(wikiPath) {
  return path.join(rawDir(wikiPath), 'tickets');
}

/**
 * The 4 values of a README that the guard needs, read with a plain line match when the parse fails: { key, branch, worktree, workflow }.
 * The key falls back to the folder name in capitals. It never throws.
 */
function readHead(file, folder) {
  let text = '';
  try {
    if (!lstatSync(file).isSymbolicLink()) text = readFileSync(file, 'utf8');
  } catch { /* The values fall back. */ }
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const block = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  const source = block ? block[1] : text;
  const value = (name) => {
    const hit = new RegExp(`^${name}:[ \\t]*(.*)$`, 'm').exec(source);
    return hit ? hit[1].trim().replace(/^(["'])(.*)\1$/, '$2').trim() : '';
  };
  return { key: value('key') || folder.toUpperCase(), branch: value('branch'), worktree: value('worktree'), workflow: value('workflow') };
}

/** Every ticket folder, sorted by name. Each entry has a parsed ticket, or a read error and a head (readHead). */
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
      out.push({ dir, file, folder: entry.name, error: error.code === 'ENOENT' ? 'README.md is missing.' : error.message, head: readHead(file, entry.name) });
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
