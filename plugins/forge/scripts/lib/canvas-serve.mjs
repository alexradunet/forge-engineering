// The canvas server: `forge.mjs canvas <key> --serve`. It shows the ticket canvas on this machine only (127.0.0.1),
// and it stops when the user sends the comments from the page. Then it prints the comment message for the session.
// With the wiki, it also shows the board page (/board), the wiki page (/wiki), and the canvas of each other ticket (/ticket/<folder>/),
// so the user can go from ticket to ticket and to the wiki. Only the page of its own ticket can send comments.
// It writes no file except the pages (canvas.html, board.html), it has no CORS header, and each request needs the token of this run.
import http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildBoard } from './board.mjs';
import { BOARD_SCRIPT, renderBoardPage } from './board-page.mjs';
import { buildCanvas, renderCanvas, writeCanvas } from './canvas.mjs';
import { CANVAS_SCRIPT, canvasMessage } from './canvas-page.mjs';
import { MERMAID_ROUTE, needsMermaid, readMermaid } from './mermaid.mjs';
import { ticketRoot } from './tickets.mjs';
import { ERROR_POLICY, buildNav, errorPage } from './ui.mjs';
import { writeViews } from './views.mjs';
import { WIKI_SCRIPT, renderWikiPage } from './wiki-page.mjs';
import { buildWiki, wikiLinks } from './wiki.mjs';

export const SERVE_HOST = '127.0.0.1';
const PORT_BASE = 41000;
const PORT_SPAN = 2000;
const PORT_TRIES = 10;
const MAX_BODY = 256 * 1024;
const MAX_COMMENTS = 200;
const MAX_FILE = 8 * 1024 * 1024;
const LIMIT_MS = 8 * 60 * 60 * 1000;
const FIELDS = ['id', 'file', 'section', 'title', 'text', 'quote', 'label', 'kind'];
// A link on the page can name a file of the ticket folder. The server gives only these types, and never a page.
const TYPES = {
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8', '.json': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
};
export const BASE_HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
// A page can run only its own script, and it can connect only to this server. It can show an image from a data address only: the icon of its tab.
// With `self`, the page can also load a script file of this server: the Mermaid file of the wiki page.
export const policy = (script, self = false) => `default-src 'none'; script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'${self ? " 'self'" : ''}; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'`;
/** The answer for the Mermaid file of forge: the bytes and the headers. The browser can keep the file for one run of the server. */
export function mermaidAnswer() {
  return { body: readMermaid(), headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'private, max-age=86400' } };
}
const PAGE_POLICY = policy(CANVAS_SCRIPT);
const PAGE_POLICY_MERMAID = policy(CANVAS_SCRIPT, true);
/** The policy of a canvas page: a page with a Mermaid block can also load the Mermaid file of its server. */
export const canvasPolicy = (page) => (needsMermaid(page) ? PAGE_POLICY_MERMAID : PAGE_POLICY);
const BOARD_POLICY = policy(BOARD_SCRIPT);
const WIKI_POLICY = policy(WIKI_SCRIPT);
const WIKI_POLICY_MERMAID = policy(WIKI_SCRIPT, true);
const OLD_LINK = 'This link is old or not complete. Ask the ticket session for the new canvas link.\n';
const OLD_PAGE = { title: 'This link is old', text: 'The link is old or not complete. Ask the ticket session for the new canvas link.' };

/** True for a GET that a browser makes for a page: its Accept header names text/html. A script, a hook reporter, or curl does not send that. */
export const wantsHtml = (req) => req.method === 'GET' && /text\/html/i.test(String(req.headers.accept ?? ''));

/**
 * Answers a 403, a 404, or a 500. A request that wants a page gets the error page of the kit with ERROR_POLICY (no script, no connection).
 * Each other caller gets `text` as plain text, as before. `page` is { title, text, command, links } for errorPage. The headers of a plain answer stay.
 */
export function errorAnswer(req, res, status, text, page) {
  const html = wantsHtml(req);
  const body = html ? errorPage({ status, ...page }) : text;
  res.writeHead(status, {
    ...BASE_HEADERS, 'Content-Type': html ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body),
    ...(html ? { 'Content-Security-Policy': ERROR_POLICY } : {}),
  });
  res.end(body);
}

/** The first port that the server tries for a ticket. The same ticket gets the same port, so the browser keeps the view and the comments. */
export function defaultPort(key) {
  return PORT_BASE + createHash('sha256').update(String(key)).digest().readUInt32BE(0) % PORT_SPAN;
}

/** True when the two tokens are the same. The comparison takes the same time for each wrong token of the same length. */
export function sameToken(given, token) {
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(token));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 0 when the server can answer the request, or the HTTP status of the refusal. */
export function checkRequest(req, token) {
  const host = String(req.headers.host ?? '').toLowerCase();
  // A page of another site can make the browser call this server by a name of its own. Only a loopback name is accepted.
  if (!/^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/.test(host)) return 403;
  if (req.method !== 'GET' && req.method !== 'POST') return 405;
  let url;
  try { url = new URL(req.url, `http://${host}`); } catch { return 400; }
  const given = req.method === 'GET' ? url.searchParams.get('t') ?? '' : req.headers['x-forge-token'] ?? '';
  if (!sameToken(given, token)) return 403;
  if (req.method === 'POST') {
    const { origin } = req.headers;
    if (origin !== undefined && String(origin).toLowerCase() !== `http://${host}`) return 403;
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin') return 403;
    if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] ?? ''))) return 415;
  }
  return 0;
}

/** The comments and the general comment of a Send request, or null when the shape is wrong. */
export function readSend(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { comments = [], general = '' } = body;
  if (!Array.isArray(comments) || comments.length > MAX_COMMENTS || typeof general !== 'string') return null;
  const items = [];
  for (const comment of comments) {
    if (!comment || typeof comment !== 'object' || Array.isArray(comment)) return null;
    const item = {};
    for (const name of FIELDS) {
      const value = comment[name];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'string') return null;
      item[name] = value;
    }
    items.push(item);
  }
  return { comments: items, general };
}

/** A regular file inside the ticket folder with a listed type, or null. */
export function ticketFile(dir, pathname) {
  let relative;
  try { relative = decodeURIComponent(pathname.slice(1)); } catch { return null; }
  const type = TYPES[path.extname(relative).toLowerCase()];
  if (!relative || !type || relative.includes('\0') || relative.includes('\\')) return null;
  try {
    const root = realpathSync(dir);
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) return null;
    const info = lstatSync(file);
    if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_FILE) return null;
    if (!realpathSync(file).startsWith(root + path.sep)) return null;
    return { file, type };
  } catch { return null; }
}

/** The text of a request body, or null when it has more than `max` bytes. */
export function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => { size += chunk.length; if (size <= max) chunks.push(chunk); });
    req.on('end', () => resolve(size > max ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => { server.off('listening', onListening); reject(err); };
    const onListening = () => { server.off('error', onError); resolve(server.address().port); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, SERVE_HOST);
  });
}

/** Listens on `port`, or on the stable port of `key` and the ports after it. `name` is the server name in the error text. */
export async function bind(server, key, port, name = 'canvas') {
  if (port !== undefined) {
    try { return await listen(server, port); } catch (err) {
      if (err.code === 'EADDRINUSE') throw new Error(`Port ${port} is in use. Give another --port, or stop the other ${name} server.`);
      throw err;
    }
  }
  const first = defaultPort(key);
  for (let step = 0; step < PORT_TRIES; step++) {
    try { return await listen(server, first + step); } catch (err) {
      if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') throw err;
    }
  }
  return listen(server, 0);
}

/**
 * Serves the canvas of one ticket folder until the user sends the comments. Gives the exit code:
 * 0 after a Send (the message is on `out`), 130 or 143 after a signal, and 3 at the time limit.
 * With `wiki` and `folder` (the folder name of the ticket), the pages have the links to the board and to the other tickets.
 */
export async function serveCanvas(dir, { links = 'vscode', port, limitMs = LIMIT_MS, out = process.stdout, err = process.stderr, signals = process, wiki = '', folder = '' } = {}) {
  const linked = Boolean(wiki && folder);
  const written = linked ? writeViews(wiki, { links, focus: folder, all: false }).focus : writeCanvas(dir, { links });
  const { key } = written;
  const token = randomBytes(16).toString('hex');
  let finish;
  const ended = new Promise((resolve) => { finish = resolve; });
  let done = false;

  const send = (res, status, type, body, extra = {}) => {
    res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...extra });
    res.end(body);
  };
  const plain = (res, status, text) => send(res, status, 'text/plain; charset=utf-8', text);
  // After the token check, a page has a link to the board (or to this ticket) with the token: the user holds the token already.
  const back = [{ text: linked ? 'Open the board' : 'Open the ticket', href: linked ? `/board?t=${token}` : `/?t=${token}` }];
  const missing = (req, res) => errorAnswer(req, res, 404, 'Not found.\n', { title: 'Not found', text: 'This server has no page at this address.', links: back });

  const server = http.createServer(async (req, res) => {
    // The links of an error page hold the token, so only a request that passed the token check gets them.
    let checked = false;
    try {
      const status = checkRequest(req, token);
      if (status) {
        req.resume();
        if (status === 403) errorAnswer(req, res, 403, OLD_LINK, OLD_PAGE);
        else plain(res, status, `Refused (${status}).\n`);
        return;
      }
      checked = true;
      const url = new URL(req.url, `http://${SERVE_HOST}`);
      if (req.method === 'POST') {
        if (url.pathname !== '/send') { req.resume(); missing(req, res); return; }
        const text = await readBody(req);
        if (text === null) { plain(res, 413, 'The comments are too large.\n'); return; }
        let body = null;
        try { body = readSend(JSON.parse(text)); } catch { body = null; }
        const message = body ? canvasMessage(key, body.comments, body.general) : '';
        if (!body || !message.includes('\n')) { plain(res, 400, 'The request has no comment that the server can read.\n'); return; }
        if (done) { plain(res, 409, 'The comments are already sent.\n'); return; }
        done = true;
        res.on('finish', () => finish({ code: 0, message }));
        send(res, 200, 'application/json', '{"ok":true}');
        return;
      }
      // Each load reads the ticket files again, so a page shows the current tickets.
      const board = linked ? buildBoard(wiki) : null;
      // The wiki model, for a page only: a request for a file of a ticket does not read the wiki.
      let pages = null;
      const model = () => (pages ??= buildWiki(wiki, { board }));
      if (url.pathname === '/') {
        const page = renderCanvas(buildCanvas(dir), {
          links, serve: { token }, nav: board && buildNav(board, { from: folder, token, home: folder, closed: model().closed }),
          wiki: board && wikiLinks(model(), { from: folder, token, dir }), mermaid: true,
        });
        send(res, 200, 'text/html; charset=utf-8', page, { 'Content-Security-Policy': canvasPolicy(page) });
        return;
      }
      if (board && url.pathname === '/board') {
        const page = renderBoardPage(board, { links, wiki, serve: { token }, nav: buildNav(board, { token, home: folder, closed: model().closed }) });
        send(res, 200, 'text/html; charset=utf-8', page, { 'Content-Security-Policy': BOARD_POLICY });
        return;
      }
      if (board && url.pathname === '/wiki') {
        const page = renderWikiPage(model(), { links, serve: { token }, nav: buildNav(board, { from: 'wiki', token, home: folder, closed: model().closed }) });
        send(res, 200, 'text/html; charset=utf-8', page, { 'Content-Security-Policy': needsMermaid(page) ? WIKI_POLICY_MERMAID : WIKI_POLICY });
        return;
      }
      if (url.pathname === MERMAID_ROUTE) {
        const file = mermaidAnswer();
        res.writeHead(200, { ...BASE_HEADERS, ...file.headers, 'Content-Length': file.body.length });
        res.end(file.body);
        return;
      }
      const other = board ? /^\/ticket\/([^/]+)(\/.*)?$/.exec(url.pathname) : null;
      if (other) {
        // Only the folder of a ticket on the board is a route. Another name, also a path that goes up, is not found.
        let name = '';
        try { name = decodeURIComponent(other[1]); } catch { name = ''; }
        const known = board.groups.some((group) => group.tickets.some((item) => item.folder === name));
        if (!known) { missing(req, res); return; }
        const there = path.join(ticketRoot(wiki), name);
        if (other[2] === undefined || (other[2] === '/' && name === folder)) {
          const target = name === folder ? `/?t=${token}` : `/ticket/${encodeURIComponent(name)}/?t=${token}`;
          send(res, 302, 'text/plain; charset=utf-8', 'See the new address.\n', { Location: target });
          return;
        }
        if (other[2] === '/') {
          const page = renderCanvas(buildCanvas(there), {
            links, serve: { token, home: key }, nav: buildNav(board, { from: name, token, home: folder, closed: model().closed }),
            wiki: wikiLinks(model(), { from: name, token, dir: there }), mermaid: true,
          });
          send(res, 200, 'text/html; charset=utf-8', page, { 'Content-Security-Policy': canvasPolicy(page) });
          return;
        }
        const file = ticketFile(there, other[2]);
        if (!file) { missing(req, res); return; }
        send(res, 200, file.type, readFileSync(file.file), { 'Content-Security-Policy': "default-src 'none'; sandbox" });
        return;
      }
      const found = ticketFile(dir, url.pathname);
      if (!found) { missing(req, res); return; }
      send(res, 200, found.type, readFileSync(found.file), { 'Content-Security-Policy': "default-src 'none'; sandbox" });
    } catch (error) {
      if (!res.headersSent) {
        errorAnswer(req, res, 500, `The canvas server cannot show the ticket: ${error.message}\n`, { title: 'Something went wrong', text: `The canvas server cannot show the ticket: ${error.message}`, links: checked ? back : [] });
      }
      else res.destroy();
    }
  });

  const bound = await bind(server, key, port);
  // The signal handlers come before the first line: a reader of that line can stop the server at once.
  const onInt = () => finish({ code: 130 });
  const onTerm = () => finish({ code: 143 });
  signals.once('SIGINT', onInt);
  signals.once('SIGTERM', onTerm);
  const timer = setTimeout(() => finish({ code: 3 }), limitMs);
  out.write(`${key}: serving http://${SERVE_HOST}:${bound}/?t=${token}\n  file  ${pathToFileURL(written.file).href}\n`
    + (linked ? `  board http://${SERVE_HOST}:${bound}/board?t=${token}\n  wiki  http://${SERVE_HOST}:${bound}/wiki?t=${token}\n` : '')
    + (written.missing.length ? `  not written yet: ${written.missing.join(', ')}\n` : ''));

  const result = await ended;
  clearTimeout(timer);
  signals.off('SIGINT', onInt);
  signals.off('SIGTERM', onTerm);
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  if (result.code === 0) out.write(`${result.message}\n`);
  else err.write('forge: the canvas server stopped. No comments were sent.\n');
  return result.code;
}
