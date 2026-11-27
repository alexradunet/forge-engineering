// Finds and reads the ticket folders of a repository: <forge>/raw/tickets/<key>/README.md (rawDir in layout.mjs gives the raw folder of a wiki).
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { archiveDir, rawDir } from './layout.mjs';
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

/** The prefix of the key of a ticket with no work item: L-<n>. A key from another system must not use the prefix L. */
export const LOCAL_PREFIX = 'L';
// Upper-case words that look like keys but are standards or encodings.
export const NOT_KEYS = new Set(['UTF', 'SHA', 'ISO', 'RFC', 'CVE', 'HTTP', 'TLS', 'SSL', 'PEP', 'ES', 'MD', 'AES', 'RSA', 'X', 'WIP', 'V']);

/**
 * The next local key, L-<n>. The number is 1 plus the highest of the counter file raw/local-key, the folders l-<n> in raw/tickets and archive/tickets,
 * and the pages tickets/l-<n>.md of the wiki. It writes the number to the counter file. A link in place of the counter file is an error.
 */
export function nextLocalKey(wikiPath) {
  const raw = rawDir(wikiPath);
  const counter = path.join(raw, 'local-key');
  let last = 0;
  try {
    if (lstatSync(counter).isSymbolicLink()) throw new Error(`${counter} must not be a link.`);
    const value = Number(readFileSync(counter, 'utf8').trim());
    if (Number.isSafeInteger(value) && value > 0) last = value;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const pattern = new RegExp(`^${LOCAL_PREFIX}-(\\d+)(\\.md)?$`, 'i');
  const scan = (dir, markdown) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { /* A missing folder has no keys. */ }
    for (const entry of entries) {
      const hit = pattern.exec(entry.name);
      if (hit && Boolean(hit[2]) === markdown && (markdown ? entry.isFile() : entry.isDirectory())) last = Math.max(last, Number(hit[1]));
    }
  };
  scan(path.join(raw, 'tickets'), false);
  scan(path.join(archiveDir(wikiPath), 'tickets'), false);
  scan(path.join(wikiPath, 'tickets'), true);
  mkdirSync(raw, { recursive: true });
  writeFileSync(counter, `${last + 1}\n`);
  return `${LOCAL_PREFIX}-${last + 1}`;
}
