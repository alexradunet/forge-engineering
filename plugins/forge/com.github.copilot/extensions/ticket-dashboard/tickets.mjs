import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseTicket } from '../../../scripts/lib/ticket.mjs';
import { validateTicket } from '../../../scripts/lib/validation.mjs';

export { STATES, parseTicket } from '../../../scripts/lib/ticket.mjs';

const MAX_DOC_BYTES = 1024 * 1024;
const DOC_SUBDIRS = ['evidence', 'outbox'];
const MAX_WIKI_DEPTH = 3;
const WIKI_EXCLUDED_ROOT_DIRS = new Set(['raw', 'archive', 'forge', 'items']);
const DOC_ORDER = [
  'README.md',
  'map.md',
  'ticket.md',
  'context.md',
  'briefing.md',
  'interview.md',
  'investigation.md',
  'plan.draft.md',
  'plan.md',
  'review.md',
  'test-plan.md',
  'evidence-testing.md',
  'close.draft.md',
  'decisions.md',
  'log.md',
  'troubleshooting.md',
];
const DOC_META = new Map([
  ['README.md', ['🎫 Ticket', 'core']],
  ['map.md', ['🗺️ Code map', 'core']],
  ['ticket.md', ['📋 Work item', 'core']],
  ['context.md', ['🧭 Context', 'gate']],
  ['briefing.md', ['🖼️ Visual briefing', 'core']],
  ['interview.md', ['🎯 Scope interview', 'gate']],
  ['investigation.md', ['🔎 Investigation', 'gate']],
  ['plan.draft.md', ['📝 Plan (draft)', 'gate']],
  ['plan.md', ['📝 Plan (approved)', 'core']],
  ['review.md', ['🧪 Code review', 'gate']],
  ['test-plan.md', ['🧪 Test plan', 'core']],
  ['evidence-testing.md', ['🔬 Evidence testing', 'core']],
  ['close.draft.md', ['✅ Close (draft)', 'gate']],
  ['decisions.md', ['⚖️ Decisions', 'log']],
  ['log.md', ['🧾 Work log', 'log']],
  ['troubleshooting.md', ['🛠️ Troubleshooting', 'log']],
]);

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
  if (!value || value === 'null' || value === '~') return null;
  return value;
}

function blockScalar(lines, index, indicator) {
  const parentIndent = lines[index].match(/^ */)[0].length;
  const content = [];
  let indent;
  let end = index + 1;
  for (; end < lines.length; end++) {
    const line = lines[end];
    if (!line.trim()) { content.push(''); continue; }
    const spaces = line.match(/^ */)[0].length;
    if (spaces <= parentIndent) break;
    indent ??= spaces;
    if (spaces < indent) throw new Error('Invalid indentation in a block scalar.');
    content.push(line.slice(indent));
  }
  const lastContent = content.findLastIndex((line) => line.length > 0);
  const trailingLines = content.length - lastContent - 1;
  const body = content.slice(0, lastContent + 1);
  let text = '';
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    const next = body[i + 1];
    text += line;
    if (indicator[0] === '|' || next === undefined || /^\s/.test(line) || /^\s/.test(next)) text += '\n';
    else if (line && next) text += ' ';
    else if (!line) text += '\n';
  }
  if (indicator.endsWith('+')) text += '\n'.repeat(trailingLines);
  if (indicator.endsWith('-')) text = text.replace(/\n+$/, '');
  else if (!indicator.endsWith('+')) text = text.replace(/\n+$/, '') + (content.some((line) => line.length) ? '\n' : '');
  return { text, end };
}

export function parseDocument(text, fallbackPath = '') {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(source);
  const frontmatter = Object.create(null);
  const sources = [];
  let inSources = false;
  let body = source;
  if (match) {
    body = source.slice(match[0].length);
    const lines = match[1].split('\n');
    for (let index = 0; index < lines.length; index++) {
      let line = lines[index];
      if (/^\s*(#|$)/.test(line)) continue;
      if (inSources && /^\s+-\s+(.+)$/.test(line)) {
        const entry = /^\s+-\s+(.+)$/.exec(line)[1];
        try {
          const parsedItem = scalar(entry);
          if (typeof parsedItem === 'string' && parsedItem.trim()) sources.push(parsedItem.trim());
        } catch {
          if (entry.trim()) sources.push(entry.trim());
        }
        continue;
      }
      if (/^\s*-/.test(line)) continue;
      inSources = false;
      const block = /^([a-zA-Z][\w-]*:\s*)([>|][+-]?)(?:\s+#.*)?\s*$/.exec(line);
      if (block) {
        try {
          const { text: blockText, end } = blockScalar(lines, index, block[2]);
          line = block[1] + JSON.stringify(blockText);
          index = end - 1;
        } catch {
          continue;
        }
      }
      const field = /^([a-zA-Z][\w-]*):(?:\s+(.*)|$)/.exec(line);
      if (!field) continue;
      if (field[1] === 'sources' && !(field[2] ?? '').trim()) {
        inSources = true;
        continue;
      }
      try {
        const val = scalar(field[2] ?? '');
        if (val == null || typeof val === 'string') frontmatter[field[1]] = val ?? '';
      } catch {
        frontmatter[field[1]] = (field[2] ?? '').trim();
      }
    }
  }
  const headingMatch = /^#\s+(.+)$/m.exec(body);
  const heroMatch = /^>\s*(?:🔥\s*)?(.+)$/m.exec(body);
  const known = DOC_META.get(fallbackPath);
  const title = headingMatch
    ? headingMatch[1].trim()
    : (frontmatter.title || (known ? known[0] : path.posix.basename(fallbackPath, '.md')));
  return {
    title,
    type: frontmatter.type || '',
    gate: frontmatter.gate || '',
    updated: frontmatter.updated || frontmatter.date || '',
    status: frontmatter.status || '',
    target: frontmatter.target || '',
    hero: heroMatch ? heroMatch[1].trim() : '',
    sources,
    frontmatter,
    body,
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

function docCategory(relPath) {
  if (DOC_META.has(relPath)) return DOC_META.get(relPath)[1];
  if (relPath.startsWith('evidence/')) return 'evidence';
  if (relPath.startsWith('outbox/')) return 'outbox';
  if (relPath.endsWith('.draft.md') || relPath.startsWith('review') || relPath.startsWith('plan')) return 'gate';
  return 'core';
}

function docLabel(relPath) {
  if (DOC_META.has(relPath)) return DOC_META.get(relPath)[0];
  const base = path.posix.basename(relPath, '.md');
  if (relPath.startsWith('evidence/')) return `🔬 ${base}`;
  if (relPath.startsWith('outbox/')) return `📤 ${base.replace(/\.draft$/, '')}`;
  return `📄 ${base}`;
}

function sortDocs(a, b) {
  const ia = DOC_ORDER.indexOf(a.path);
  const ib = DOC_ORDER.indexOf(b.path);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  const subA = a.path.includes('/');
  const subB = b.path.includes('/');
  if (subA !== subB) return subA ? 1 : -1;
  return a.path.localeCompare(b.path);
}

async function inspectMarkdownFile(filePath, relPath) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) return null;
  if (info.size > MAX_DOC_BYTES) return null;
  const content = await readFile(filePath, 'utf8');
  const parsed = parseDocument(content, relPath);
  return {
    path: relPath,
    label: docLabel(relPath),
    title: parsed.title,
    category: docCategory(relPath),
    type: parsed.type,
    gate: parsed.gate,
    updated: parsed.updated,
    status: parsed.status,
    target: parsed.target,
    hasMermaid: /```mermaid\b/.test(parsed.body),
  };
}

async function discoverTicketDocs(ticketDir) {
  const docs = [];
  const entries = await readdir(ticketDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.md')) {
      try {
        const meta = await inspectMarkdownFile(path.join(ticketDir, entry.name), entry.name);
        if (meta) docs.push(meta);
      } catch {
        // Ignore unreadable secondary markdown files during discovery.
      }
    }
  }
  for (const sub of DOC_SUBDIRS) {
    let subDir;
    try {
      subDir = await containedDirectory(ticketDir, sub);
    } catch {
      continue;
    }
    const subEntries = await readdir(subDir, { withFileTypes: true });
    for (const subEntry of subEntries) {
      if (subEntry.name.startsWith('.')) continue;
      if (subEntry.isFile() && !subEntry.isSymbolicLink() && subEntry.name.endsWith('.md')) {
        try {
          const relPath = `${sub}/${subEntry.name}`;
          const meta = await inspectMarkdownFile(path.join(subDir, subEntry.name), relPath);
          if (meta) docs.push(meta);
        } catch {
          // Ignore unreadable secondary markdown files.
        }
      }
    }
  }
  return docs.sort(sortDocs);
}

function validSegment(segment) {
  return typeof segment === 'string'
    && segment.length > 0
    && segment !== '.'
    && segment !== '..'
    && !segment.startsWith('.')
    && !/[/\\:\0]/.test(segment);
}

function wikiPageCategory(relPath) {
  if (relPath === 'index.md' || relPath === 'log.md') return 'index';
  const top = relPath.split('/')[0];
  if (top === 'learning') return 'learning';
  if (top === 'tooling') return 'tooling';
  if (top === 'decisions') return 'decisions';
  if (top === 'tickets') return 'tickets';
  return 'area';
}

function wikiPageArea(relPath) {
  if (!relPath.includes('/')) return 'root';
  return relPath.split('/')[0];
}

function wikiPageLabel(relPath, parsedTitle) {
  if (relPath === 'index.md') return '📚 Wiki Index';
  if (relPath === 'log.md') return '🧾 Wiki Log';
  if (parsedTitle) return parsedTitle;
  return path.posix.basename(relPath, '.md');
}

function parseIndexSummaries(indexText) {
  const summaries = new Map();
  const lines = indexText.replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    const match = /^\s*-\s+\[[^\]]+\]\(([^)]+\.md)\)\s*(?:[—–-]\s*(.+))?$/.exec(line.trim());
    if (!match) continue;
    const relPath = match[1].trim().replace(/^\.\//, '').replace(/\\/g, '/');
    const summary = (match[2] ?? '').trim();
    if (relPath && summary) summaries.set(relPath, summary);
  }
  return summaries;
}

function extractFirstParagraph(body) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const para = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (para.length) break;
      continue;
    }
    if (line.startsWith('#') || line.startsWith('```') || line.startsWith('|') || line.startsWith('---')) {
      if (para.length) break;
      continue;
    }
    if (line.startsWith('>')) {
      const cleaned = line.replace(/^>\s*/, '').trim();
      if (cleaned) return cleaned;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (para.length) break;
      return line.replace(/^[-*]\s+/, '').trim();
    }
    para.push(line);
  }
  return para.join(' ');
}

function sortWikiPages(a, b) {
  const catOrder = { index: 0, learning: 1, area: 2, tooling: 3, decisions: 4, tickets: 5 };
  const ca = catOrder[a.category] ?? 3;
  const cb = catOrder[b.category] ?? 3;
  if (ca !== cb) return ca - cb;
  if (a.path === 'index.md') return -1;
  if (b.path === 'index.md') return 1;
  return a.path.localeCompare(b.path);
}

async function discoverWikiPages(wikiDir) {
  let indexSummaries = new Map();
  try {
    const indexPath = path.join(wikiDir, 'index.md');
    const info = await lstat(indexPath);
    if (info.isFile() && !info.isSymbolicLink() && info.size <= MAX_DOC_BYTES) {
      indexSummaries = parseIndexSummaries(await readFile(indexPath, 'utf8'));
    }
  } catch {
    // Ignore missing or unreadable index.md
  }

  const pages = [];
  const walk = async (currentDir, relPrefix, depth) => {
    if (depth > MAX_WIKI_DEPTH) return;
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!validSegment(entry.name)) continue;
      if (depth === 0 && WIKI_EXCLUDED_ROOT_DIRS.has(entry.name)) continue;
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        try {
          const childDir = await containedDirectory(currentDir, entry.name);
          await walk(childDir, relPath, depth + 1);
        } catch {
          // Skip invalid or symlinked directories
        }
      } else if (entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.md')) {
        try {
          const fullPath = path.join(currentDir, entry.name);
          const info = await lstat(fullPath);
          if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_DOC_BYTES) continue;
          const content = await readFile(fullPath, 'utf8');
          const parsed = parseDocument(content, relPath);
          const category = wikiPageCategory(relPath);
          const summary = indexSummaries.get(relPath) || parsed.hero || extractFirstParagraph(parsed.body);
          pages.push({
            path: relPath,
            label: wikiPageLabel(relPath, parsed.title),
            title: parsed.title,
            category,
            area: wikiPageArea(relPath),
            type: parsed.type,
            status: parsed.status,
            updated: parsed.updated,
            summary,
            sourceCount: parsed.sources.length,
            hasMermaid: /```mermaid\b/.test(parsed.body),
          });
        } catch {
          // Ignore unreadable secondary wiki markdown files
        }
      }
    }
  };

  await walk(wikiDir, '', 0);
  return pages.sort(sortWikiPages);
}

export async function readWikiDoc(wikiPath, docRelPath) {
  if (typeof docRelPath !== 'string' || !docRelPath.endsWith('.md') || docRelPath.includes('\0') || docRelPath.includes('\\')) {
    throw new Error('Invalid wiki document path.');
  }
  const parts = docRelPath.split('/');
  if (parts.length < 1 || parts.some((part) => !validSegment(part))) {
    throw new Error('Invalid wiki document path.');
  }
  if (WIKI_EXCLUDED_ROOT_DIRS.has(parts[0])) {
    throw new Error('Wiki document path is outside canonical wiki sections.');
  }
  if (parts.length > MAX_WIKI_DEPTH) {
    throw new Error('Invalid wiki document path.');
  }
  const wiki = await realpath(wikiPath);
  if (!(await lstat(wiki)).isDirectory()) throw new Error(`${wikiPath} is not a wiki directory.`);
  let parentDir = wiki;
  for (let i = 0; i < parts.length - 1; i++) {
    parentDir = await containedDirectory(parentDir, parts[i]);
  }
  const targetFile = path.join(parentDir, parts[parts.length - 1]);
  const info = await lstat(targetFile);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Wiki document must be a regular file, not a link.');
  if (info.size > MAX_DOC_BYTES) throw new Error('Wiki document exceeds 1 MiB.');
  const rawText = await readFile(targetFile, 'utf8');
  const parsed = parseDocument(rawText, docRelPath);
  return {
    path: docRelPath,
    file: targetFile,
    label: wikiPageLabel(docRelPath, parsed.title),
    category: wikiPageCategory(docRelPath),
    area: wikiPageArea(docRelPath),
    title: parsed.title,
    type: parsed.type,
    status: parsed.status,
    updated: parsed.updated,
    hero: parsed.hero,
    sources: parsed.sources,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
  };
}

export async function readTicketDoc(wikiPath, folder, docRelPath) {
  if (!validSegment(folder)) throw new Error('Invalid ticket folder.');
  if (typeof docRelPath !== 'string' || !docRelPath.endsWith('.md') || docRelPath.includes('\0') || docRelPath.includes('\\')) {
    throw new Error('Invalid document path.');
  }
  const parts = docRelPath.split('/');
  if (parts.length === 1) {
    if (!validSegment(parts[0])) throw new Error('Invalid document name.');
  } else if (parts.length === 2) {
    if (!DOC_SUBDIRS.includes(parts[0]) || !validSegment(parts[1])) {
      throw new Error('Invalid document subdirectory or name.');
    }
  } else {
    throw new Error('Document path exceeds allowed depth.');
  }
  const wiki = await realpath(wikiPath);
  if (!(await lstat(wiki)).isDirectory()) throw new Error(`${wikiPath} is not a wiki directory.`);
  const raw = await containedDirectory(wiki, 'raw');
  const root = await containedDirectory(raw, 'tickets');
  const ticketDir = await containedDirectory(root, folder);
  const readmeInfo = await lstat(path.join(ticketDir, 'README.md'));
  if (!readmeInfo.isFile() || readmeInfo.isSymbolicLink()) throw new Error('Ticket README must be a regular file, not a link.');
  let parentDir = ticketDir;
  if (parts.length === 2) {
    parentDir = await containedDirectory(ticketDir, parts[0]);
  }
  const targetFile = path.join(parentDir, parts[parts.length - 1]);
  const info = await lstat(targetFile);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Ticket document must be a regular file, not a link.');
  if (info.size > MAX_DOC_BYTES) throw new Error('Ticket document exceeds 1 MiB.');
  const rawText = await readFile(targetFile, 'utf8');
  const parsed = parseDocument(rawText, docRelPath);
  return {
    folder,
    path: docRelPath,
    file: targetFile,
    label: docLabel(docRelPath),
    category: docCategory(docRelPath),
    title: parsed.title,
    type: parsed.type,
    gate: parsed.gate,
    updated: parsed.updated,
    status: parsed.status,
    target: parsed.target,
    hero: parsed.hero,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
  };
}

export async function readTickets(wikiPath) {
  const wiki = await realpath(wikiPath);
  if (!(await lstat(wiki)).isDirectory()) throw new Error(`${wikiPath} is not a wiki directory.`);
  const wikiPages = await discoverWikiPages(wiki);
  const result = { wikiPath: wiki, tickets: [], wikiPages, errors: [], scannedAt: new Date().toISOString() };
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
      const ticketDir = await containedDirectory(root, entry.name);
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Ticket README must be a regular file, not a link.');
      if (info.size > MAX_DOC_BYTES) throw new Error('Ticket README exceeds 1 MiB.');
      const ticket = parseTicket(await readFile(file, 'utf8'));
      if (result.tickets.some((existing) => existing.key === ticket.key)) throw new Error(`Duplicate ticket key: ${ticket.key}`);
      const docs = await discoverTicketDocs(ticketDir);
      result.tickets.push({ ...ticket, folder: entry.name, file, docs, findings: await validateTicket(ticket, file) });
    } catch (error) {
      result.errors.push({ file, message: error.message });
    }
  }
  return result;
}
