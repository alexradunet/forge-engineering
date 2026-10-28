#!/usr/bin/env node
// Read-only local ticket board for forge ticket folders.
// --config <dir> selects the forge config folder (default: see resolveConfigDir in lib/config.mjs).
//   node server.mjs [--wiki <path>] [--port 4517]   serve http://127.0.0.1:<port>/
//   node server.mjs --check [<key>] [--wiki <path>] validate frontmatter; exit 1 on problems
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, watch } from 'node:fs';
import { join, resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardSummary, loadAll, loadTicket, isTicketDir } from './lib/tickets.mjs';
import { splitFrontmatter } from './lib/frontmatter.mjs';
import { renderMarkdown } from './lib/render.mjs';
import { loadBoardConfig, resolveConfigDir } from './lib/config.mjs';

export const APP = 'forge-ticket-board';
const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function parseArgs(argv) {
  const a = { port: 4517, wiki: process.env.FORGE_WIKI_ROOT, config: null, check: false, key: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--port') a.port = Number(argv[++i]);
    else if (v === '--wiki') a.wiki = argv[++i];
    else if (v === '--config') a.config = argv[++i];
    else if (v === '--check') { a.check = true; if (argv[i + 1] && !argv[i + 1].startsWith('--')) a.key = argv[++i]; }
  }
  return a;
}

function ticketDir(wiki, key) {
  const folder = String(key).toLowerCase();
  if (!isTicketDir(folder)) return null;
  const dir = join(wiki, 'raw', 'tickets', folder);
  return existsSync(join(dir, 'README.md')) ? { dir, folder } : null;
}

/** Resolves a document path inside a ticket folder; null when it escapes the folder or is not Markdown. */
export function safeDocPath(dir, rel) {
  if (!rel || /\0/.test(rel) || !/\.md$/i.test(rel)) return null;
  const full = resolve(dir, rel);
  return full.startsWith(resolve(dir) + sep) && existsSync(full) && statSync(full).isFile() ? full : null;
}

function renderDoc(t, rel, full) {
  const { data, body, error } = splitFrontmatter(readFileSync(full, 'utf8'));
  const relDir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  return {
    key: t.key,
    file: rel,
    path: full,
    frontmatter: data,
    error,
    html: renderMarkdown(body, { dir: t.dir, relDir, key: t.key }),
  };
}

export function createApp(wiki, configDir = null) {
  const clients = new Set();
  const send = (res, code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  };

  const server = createServer((req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'read-only' });
      // Reject requests from other web origins (DNS rebinding, cross-site fetch).
      const host = (req.headers.host ?? '').replace(/:\d+$/, '');
      if (!['127.0.0.1', 'localhost'].includes(host)) return send(res, 403, { error: 'bad host' });
      const url = new URL(req.url, 'http://127.0.0.1');
      const p = decodeURIComponent(url.pathname);

      if (p === '/api/health') return send(res, 200, { app: APP, wiki });
      if (p === '/api/board') return send(res, 200, boardSummary(wiki, loadBoardConfig(configDir)));
      if (p === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write('retry: 3000\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      let m = /^\/api\/ticket\/([^/]+)$/.exec(p);
      if (m) {
        const loc = ticketDir(wiki, m[1]);
        if (!loc) return send(res, 404, { error: 'unknown ticket' });
        const t = loadTicket(loc.dir, loc.folder, loadBoardConfig(configDir));
        const readme = renderDoc(t, 'README.md', join(loc.dir, 'README.md'));
        return send(res, 200, { ...t, readmeHtml: readme.html });
      }
      m = /^\/api\/doc\/([^/]+)\/(.+)$/.exec(p);
      if (m) {
        const loc = ticketDir(wiki, m[1]);
        const full = loc && safeDocPath(loc.dir, m[2]);
        if (!full) return send(res, 404, { error: 'unknown document' });
        const t = { key: m[1].toUpperCase(), dir: loc.dir };
        return send(res, 200, renderDoc(t, m[2], full));
      }
      if (p.startsWith('/api/')) return send(res, 404, { error: 'not found' });

      let file = p === '/' ? join(PUBLIC, 'index.html') : resolve(PUBLIC, '.' + p);
      // Source checkout: the built plugin ships vendor/mermaid.min.js; here it comes from node_modules.
      if (p === '/vendor/mermaid.min.js' && !existsSync(file)) file = join(HERE, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
      else if (!file.startsWith(PUBLIC + sep)) return send(res, 404, 'not found', 'text/plain');
      if (!existsSync(file) || !statSync(file).isFile()) return send(res, 404, 'not found', 'text/plain');
      return send(res, 200, readFileSync(file), MIME[extname(file)] ?? 'application/octet-stream');
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  });

  // Push "change" events to open pages; debounce bursts of file writes.
  let timer = null;
  const changed = new Set();
  const notify = (folder) => {
    changed.add(folder);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const data = JSON.stringify({ folders: [...changed] });
      changed.clear();
      for (const c of clients) c.write(`event: change\ndata: ${data}\n\n`);
    }, 300);
  };
  const watchers = [];
  const rawRoot = join(wiki, 'raw', 'tickets');
  if (existsSync(rawRoot)) {
    watchers.push(watch(rawRoot, { recursive: true }, (_e, f) => {
      if (!f || /\.html$/i.test(f)) return;
      notify(String(f).split(/[\\/]/)[0]);
    }));
  }
  const closedRoot = join(wiki, 'tickets');
  if (existsSync(closedRoot)) watchers.push(watch(closedRoot, () => notify('*closed*')));
  for (const w of watchers) w.on('error', (e) => console.error(`watch: ${e.message}`));
  const ping = setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000);
  server.on('close', () => { watchers.forEach((w) => w.close()); clearInterval(ping); clearTimeout(timer); });
  return server;
}

function runCheck(wiki, key, configDir = null) {
  const config = loadBoardConfig(configDir);
  if (config.error) console.error(`WARN config ignored: ${config.error}`);
  let tickets;
  if (key) {
    const loc = ticketDir(wiki, key);
    if (!loc) { console.error(`Unknown ticket ${key} (no README.md in raw\\tickets\\${String(key).toLowerCase()}).`); return 2; }
    tickets = [loadTicket(loc.dir, loc.folder, config)];
  } else tickets = loadAll(wiki, config);
  let n = 0;
  for (const t of tickets) {
    if (!t.problems.length) { console.log(`OK   ${t.key}`); continue; }
    console.log(`FAIL ${t.key}`);
    for (const p of t.problems) { console.log(`     ${p.file}: ${p.problem}`); n++; }
  }
  console.log(n ? `${n} problem(s).` : 'All frontmatter is valid.');
  return n ? 1 : 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.wiki || !existsSync(args.wiki)) {
    console.error('Wiki root not found. Pass --wiki <path> or set FORGE_WIKI_ROOT.');
    process.exit(2);
  }
  const configDir = resolveConfigDir(args.config);
  if (args.check) process.exit(runCheck(args.wiki, args.key, configDir));
  const server = createApp(args.wiki, configDir);
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${args.port} is in use.` : e.message);
    process.exit(3);
  });
  server.listen(args.port, '127.0.0.1', () => console.log(`Ticket board: http://127.0.0.1:${args.port}/ (wiki ${args.wiki})`));
}
