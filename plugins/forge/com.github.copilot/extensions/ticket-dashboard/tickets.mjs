import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export const STATES = ['needs-me', 'go', 'active', 'waiting', 'blocked', 'done'];
const PHASES = ['start', 'investigate', 'plan', 'implement', 'review', 'closed'];
const GATE_STATUSES = ['todo', 'in-review', 'approved', 'skipped', 'blocked'];

// Ticket frontmatter uses scalars and flat object lists, not the flat config format.
function splitOutside(text, separator) {
  const parts = [];
  let start = 0;
  let quote = '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (quote === '"' && c === '\\') { i++; continue; }
      if (c === quote) {
        if (quote === "'" && text[i + 1] === "'") { i++; continue; }
        quote = '';
      }
      continue;
    }
    if ((c === '"' || c === "'") && (i === 0 || /[\s:[{,]/.test(text[i - 1]))) quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      text = text.slice(0, i);
      break;
    } else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === separator && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (quote || depth !== 0) throw new Error('Unclosed quote or collection in frontmatter.');
  parts.push(text.slice(start).trim());
  return parts;
}

function scalar(text) {
  const value = splitOutside(text, '\0')[0];
  if (value.startsWith('"')) return JSON.parse(value);
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) throw new Error('Unclosed quoted value.');
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value === '[]') return [];
  if (!value || value === 'null' || value === '~') return null;
  if (/^[>|&*!{\[]/.test(value)) throw new Error('Unsupported ticket value. Use a scalar or a flat object list.');
  return value;
}

function assign(object, text) {
  const match = /^([a-zA-Z][\w-]*):(?:\s+(.*)|$)/.exec(text);
  if (!match) throw new Error(`Invalid frontmatter field: ${text}`);
  if (Object.hasOwn(object, match[1])) throw new Error(`Duplicate field: ${match[1]}`);
  object[match[1]] = scalar(match[2] ?? '');
  return match[1];
}

export function parseTicket(text) {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(source);
  if (!match) throw new Error('Ticket README needs frontmatter.');
  const data = Object.create(null);
  let list = null;
  let current = null;
  for (const line of match[1].split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue;
    if (!/^\s/.test(line)) {
      const key = assign(data, line);
      list = ['gates', 'changes'].includes(key) ? key : null;
      current = null;
      if (list && data[key] === null) data[key] = [];
      if (list && !Array.isArray(data[key])) throw new Error(`${key} must be a list.`);
    } else if (list) {
      const entry = /^\s+-\s+(.+)$/.exec(line);
      if (entry) {
        current = Object.create(null);
        const content = splitOutside(entry[1], '\0')[0];
        if (content.startsWith('{') && content.endsWith('}')) {
          for (const field of splitOutside(content.slice(1, -1), ',')) assign(current, field);
        } else {
          assign(current, content);
        }
        data[list].push(current);
      } else if (current) {
        assign(current, line.trim());
      } else {
        throw new Error(`Invalid ${list} entry.`);
      }
    } else {
      throw new Error('Ticket fields must be scalars; only gates and changes accept object lists.');
    }
  }
  for (const key of ['key', 'title', 'phase', 'state', 'track', 'next']) {
    if (typeof data[key] !== 'string' || !data[key].trim()) throw new Error(`Missing or invalid ${key}.`);
  }
  for (const key of ['item', 'waiting_on', 'branch', 'worktree', 'updated']) {
    if (data[key] != null && typeof data[key] !== 'string') throw new Error(`Invalid ${key}: expected one line of text.`);
  }
  if (!STATES.includes(data.state)) throw new Error(`Unknown ticket state: ${data.state}`);
  if (!PHASES.includes(data.phase)) throw new Error(`Unknown ticket phase: ${data.phase}`);
  if (!['S', 'M', 'L'].includes(data.track)) throw new Error(`Unknown ticket track: ${data.track}`);
  for (const gate of data.gates ?? []) {
    if (typeof gate.name !== 'string' || !GATE_STATUSES.includes(gate.status)) throw new Error('Invalid gate name or status.');
    if (!['required', 'recommended'].includes(gate.need)) throw new Error(`Invalid gate need: ${gate.name}`);
    for (const key of ['doc', 'date', 'hash', 'note']) {
      if (gate[key] != null && typeof gate[key] !== 'string') throw new Error(`Invalid gate ${key}: ${gate.name}`);
    }
    if (gate.status === 'approved' && !/^\d{4}-\d{2}-\d{2}$/.test(gate.date ?? '')) {
      throw new Error(`Approved gate needs a date: ${gate.name}`);
    }
  }
  for (const change of data.changes ?? []) {
    if (typeof change.url !== 'string' || !['draft', 'open', 'merged', 'closed', 'abandoned'].includes(change.state)) {
      throw new Error('Invalid change request URL or state.');
    }
    if (change.label != null && typeof change.label !== 'string') throw new Error('Invalid change request label.');
  }
  return {
    key: data.key, title: data.title, phase: data.phase, state: data.state,
    track: data.track, next: data.next, waitingOn: data.waiting_on ?? '',
    branch: data.branch ?? '', worktree: data.worktree ?? '', updated: data.updated ?? '',
    item: data.item ?? '', gates: data.gates ?? [], changes: data.changes ?? [],
  };
}

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
      result.tickets.push({ ...ticket, file });
    } catch (error) {
      result.errors.push({ file, message: error.message });
    }
  }
  return result;
}
