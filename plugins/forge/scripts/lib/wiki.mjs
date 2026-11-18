// The canonical pages of a wiki, as a model for the wiki page (wiki-page.mjs), the board page, and the ticket canvas.
// A canonical page is a Markdown file outside .git, raw/, archive/, and forge/: the same set that `forge.mjs lint` checks.
// The model also gives the links between the pages, the open tickets that name a page, and the summary pages of the closed tickets.
// It reads files only. A page that it cannot read is in `errors`, and the other pages still show.
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './ticket.mjs';
import { ticketRoot } from './tickets.mjs';

export const WIKI_SKIP = ['.git', 'raw', 'archive', 'forge'];
/** The folder of the summary pages of the closed tickets. */
export const CLOSED_FOLDER = 'tickets';
export const MAX_PAGES = 3000;
const MAX_BYTES = 512 * 1024;
const MAX_DOC = 1024 * 1024;
const FRONT = /^---\n[\s\S]*?\n---(?:\n|$)/;
const LINK = /\[[^\]]*\]\((<[^>]*>|[^)\s]+)\)/g;
// The path of a page in plain text. It needs a folder, so that a file name such as log.md is not a page.
const MENTION = /(?:^|[\s(`"'])((?:[\w.-]+\/)+[\w.-]+\.md)(?![\w/-])/g;
const posix = (value) => value.split(path.sep).join('/');
/** The part of a link after the "#" for the path of a page. */
export const pageHash = (relative) => relative.split('/').map(encodeURIComponent).join('/');
const oneLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const byName = (a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);

/** The link targets of a Markdown text. The text of a code block is not read. */
export function linkTargets(markdown) {
  const out = [];
  let fence = '';
  for (const line of String(markdown ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) { if (mark && line.trim().startsWith(fence)) fence = ''; continue; }
    if (mark) { fence = mark[1]; continue; }
    for (const match of line.matchAll(LINK)) out.push(match[1]);
  }
  return out;
}

/** The path of the canonical page that a link target names, or ''. `base` is the folder of the file that has the link. */
export function pageOf(model, base, target) {
  let text = String(target ?? '').trim().replace(/^<|>$/g, '').replace(/#.*$/, '');
  if (!text || (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[a-z]:[\\/]/i.test(text))) return '';
  try { text = decodeURIComponent(text); } catch { return ''; }
  text = text.replaceAll('\\', '/');
  if (!/\.md$/i.test(text) || text.includes('\0')) return '';
  const relative = posix(path.relative(model.root, path.resolve(base, text)));
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative) && model.byPath.has(relative)) return relative;
  // A ticket document can name a page from the top of the wiki, for example tooling/build.md. A name without a folder is a file next to the document.
  return /^[^./][^/]*\//.test(text) && model.byPath.has(text) ? text : '';
}

function readPage(root, relative) {
  const file = path.join(root, relative);
  const info = lstatSync(file);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('The page must be a regular file, not a link.');
  if (info.size > MAX_BYTES) throw new Error(`The page has more than ${MAX_BYTES / 1024} KB.`);
  const source = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  let data = {};
  try { data = parseFrontmatter(source, ['sources']); } catch { data = {}; }
  let body = source.replace(FRONT, '');
  // The first heading is the title of the page. The page shows it one time.
  const first = /^\s*#\s+(.+)\n?/.exec(body);
  if (first) body = body.slice(first[0].length);
  const name = path.posix.basename(relative);
  const text = (value) => (typeof value === 'string' ? oneLine(value) : '');
  return {
    path: relative, folder: path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative), name,
    title: text(data.title) || (first ? oneLine(first[1]) : '') || name.replace(/\.md$/i, ''),
    status: text(data.status), updated: text(data.updated), type: text(data.type),
    sources: Array.isArray(data.sources) ? data.sources.filter((item) => typeof item === 'string').map(oneLine).filter(Boolean) : [],
    body, links: [], usedBy: [], tickets: [],
  };
}

function walk(root, folder, found, errors) {
  let entries;
  try {
    const dir = path.join(root, folder);
    if (lstatSync(dir).isSymbolicLink()) throw new Error('A linked folder is not read.');
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') errors.push({ path: folder || '.', message: error.message });
    return;
  }
  for (const entry of entries.sort((a, b) => byName(a.name, b.name))) {
    if (entry.name.startsWith('.') || (!folder && WIKI_SKIP.includes(entry.name))) continue;
    const relative = folder ? `${folder}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(root, relative, found, errors);
    else if (entry.isFile() && /\.md$/i.test(entry.name)) found.push(relative);
  }
}

/** The documents of one ticket folder: the Markdown files at its top. */
function ticketDocs(dir) {
  const out = [];
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries.filter((item) => item.isFile() && /\.md$/i.test(item.name)).sort((a, b) => byName(a.name, b.name))) {
    try {
      const file = path.join(dir, entry.name);
      const info = lstatSync(file);
      if (!info.isSymbolicLink() && info.size <= MAX_DOC) out.push(readFileSync(file, 'utf8'));
    } catch { /* The canvas reports a document that it cannot read. */ }
  }
  return out;
}

/** The paths of the canonical pages that the documents of a ticket folder name: with a Markdown link, or with the path of the page in the text. */
export function ticketRefs(model, dir) {
  const found = new Set();
  for (const text of ticketDocs(dir)) {
    for (const target of linkTargets(text)) { const page = pageOf(model, dir, target); if (page) found.add(page); }
    for (const [, mention] of text.matchAll(MENTION)) if (model.byPath.has(mention)) found.add(mention);
  }
  return model.pages.filter((page) => found.has(page.path)).map((page) => page.path);
}

/**
 * The model of a wiki. `board` (buildBoard in board.mjs) gives the open tickets: then each page knows the tickets that name it.
 * - `pages`: each canonical page, the pages at the top of the wiki first (index.md at the start), then each folder by name.
 * - `groups`: the same pages, one group for each folder.
 * - `closed`: the summary pages of the closed tickets (tickets/<key>.md), the newest first.
 * - `refs`: for each ticket folder of the board, the paths of the pages that the ticket names.
 */
export function buildWiki(wikiPath, { board = null } = {}) {
  const root = path.resolve(wikiPath);
  const errors = [];
  const found = [];
  walk(root, '', found, errors);
  const order = (relative) => (relative === 'index.md' ? 0 : relative.includes('/') ? 2 : 1);
  found.sort((a, b) => order(a) - order(b) || byName(path.posix.dirname(a), path.posix.dirname(b)) || byName(a, b));
  if (found.length > MAX_PAGES) errors.push({ path: '.', message: `The wiki has ${found.length} pages. The page shows the first ${MAX_PAGES}.` });
  const pages = [];
  for (const relative of found.slice(0, MAX_PAGES)) {
    try { pages.push(readPage(root, relative)); } catch (error) { errors.push({ path: relative, message: error.message }); }
  }
  const model = { version: 1, root, pages, byPath: new Map(pages.map((page) => [page.path, page])), groups: [], closed: [], refs: {}, errors };
  for (const page of pages) {
    const base = path.join(root, page.folder);
    const seen = new Set();
    for (const target of linkTargets(page.body)) {
      const other = pageOf(model, base, target);
      if (other && other !== page.path) seen.add(other);
    }
    page.links = pages.filter((item) => seen.has(item.path)).map((item) => item.path);
  }
  // The index and the log name each page, so they are not in the "used by" list of a page.
  for (const page of pages.filter((item) => item.folder || !['index.md', 'log.md'].includes(item.name))) {
    for (const other of page.links) model.byPath.get(other).usedBy.push(page.path);
  }
  for (const item of board?.groups.flatMap((group) => group.tickets) ?? []) {
    const refs = ticketRefs(model, path.join(ticketRoot(root), item.folder));
    model.refs[item.folder] = refs;
    for (const ref of refs) model.byPath.get(ref).tickets.push({ key: item.key, folder: item.folder, title: item.short || item.title, state: item.state });
  }
  for (const page of pages) {
    const group = model.groups.at(-1)?.folder === page.folder ? model.groups.at(-1) : model.groups[model.groups.push({ folder: page.folder, pages: [] }) - 1];
    group.pages.push(page.path);
  }
  model.closed = pages.filter((page) => page.folder === CLOSED_FOLDER).map((page) => {
    const key = page.name.replace(/\.md$/i, '').toUpperCase();
    const title = page.title.toUpperCase().startsWith(key) ? page.title.slice(key.length).replace(/^[\s:.-]+/, '') : page.title;
    return { key, title: title || page.title, updated: page.updated, path: page.path };
  }).sort((a, b) => byName(b.updated, a.updated) || byName(a.key, b.key));
  return model;
}

/**
 * The links from a page to the wiki page. `from` is 'board', 'wiki', or the folder of a ticket, as in buildNav (ui.mjs).
 * - `home`: the wiki page. `page(path)`: one page of it, or '' when the wiki has no such page.
 * - `link(target)`: the same for the target of a Markdown link in a file of the folder `dir`.
 * - `refs`: the pages that the ticket of `dir` names.
 */
export function wikiLinks(model, { from = 'board', token = '', dir = '' } = {}) {
  const home = from === 'wiki' ? '' : token ? `/wiki?t=${token}` : from === 'board' ? 'wiki.html' : '../../wiki.html';
  const page = (relative) => (model.byPath.has(relative) ? `${home}#${pageHash(relative)}` : '');
  const base = dir || model.root;
  return {
    home, page, inPage: from === 'wiki',
    link: (target) => page(pageOf(model, base, target)),
    refs: dir ? ticketRefs(model, dir).map((relative) => ({ path: relative, title: model.byPath.get(relative).title, href: page(relative) })) : [],
  };
}
