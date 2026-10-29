import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseTicket } from '../../../scripts/lib/ticket.mjs';
import { validateTicket } from '../../../scripts/lib/validation.mjs';

export { STATES, parseTicket } from '../../../scripts/lib/ticket.mjs';

export function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => key !== 'wikiPath')
    || typeof input.wikiPath !== 'string' || !path.isAbsolute(input.wikiPath)
    || input.wikiPath.includes('\0')) {
    throw new Error('Supply an absolute wikiPath for this repository.');
  }
  return path.normalize(input.wikiPath);
}

async function containedDirectory(parent, child) {
  const target = path.join(parent, child);
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${target} must be a directory, not a link.`);
  return target;
}

export async function readTickets(wikiPath) {
  const wiki = await realpath(wikiPath);
  if (!(await lstat(wiki)).isDirectory()) throw new Error(`${wikiPath} is not a wiki directory.`);
  const result = { wikiPath: wiki, tickets: [], errors: [], scannedAt: new Date().toISOString() };
  let root;
  try {
    const raw = await containedDirectory(wiki, 'raw');
    root = await containedDirectory(raw, 'tickets');
  } catch (error) {
    if (error.code === 'ENOENT') return result;
    throw error;
  }
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const file = path.join(root, entry.name, 'README.md');
    try {
      await containedDirectory(root, entry.name);
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Ticket README must be a regular file, not a link.');
      if (info.size > 1024 * 1024) throw new Error('Ticket README exceeds 1 MiB.');
      const ticket = parseTicket(await readFile(file, 'utf8'));
      if (result.tickets.some((existing) => existing.key === ticket.key)) throw new Error(`Duplicate ticket key: ${ticket.key}`);
      result.tickets.push({ ...ticket, file, findings: await validateTicket(ticket, file) });
    } catch (error) {
      result.errors.push({ file, message: error.message });
    }
  }
  return result;
}
