// The live server: `forge.mjs live`. It shows the board page, the wiki page, and the ticket canvases on this machine only (127.0.0.1),
// with the live state of the agent sessions: the session hooks (live-hook.mjs) send their events to POST /event,
// and a page reads the state from GET /live (the server holds the answer until the state changes).
// It is read-only for a session: it has no route that sends text or an answer to a session, and no Send to agent.
// The events stay in memory. The only file that it writes is its state file in the forge data folder (the port, the tokens, and the
// folders of its repository, for the reporter of the same user). It has no CORS header. A page needs the page token, and an event needs the event token.
// One server runs for each repository: the state file has the name of the Forge folder (a hash), and the reporter sends an event
// to the server whose folders hold the folder of the session.
import http from 'node:http';
import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildBoard } from './board.mjs';
import { BOARD_SCRIPT, renderBoardPage } from './board-page.mjs';
import { buildCanvas, renderCanvas } from './canvas.mjs';
import { BASE_HEADERS, SERVE_HOST, bind, canvasPolicy, checkRequest, mermaidAnswer, policy, readBody, ticketFile } from './canvas-serve.mjs';
import { dataDir } from './data-dir.mjs';
import { homeOf } from './layout.mjs';
import { LIVE_DIR, LIVE_FILE, MAX_EVENT, checkEvent } from './live-event.mjs';
import { createLive, detail, prune, reduce, summary } from './live.mjs';
import { MERMAID_ROUTE, needsMermaid } from './mermaid.mjs';
import { ticketRoot } from './tickets.mjs';
import { buildNav } from './ui.mjs';
import { WIKI_SCRIPT, renderWikiPage } from './wiki-page.mjs';
import { buildWiki, wikiLinks } from './wiki.mjs';

/** The server stops after this time without an event. */
export const IDLE_MS = 8 * 60 * 60 * 1000;
/** A page request for the state gets its answer after this time at the latest. */
export const HOLD_MS = 25 * 1000;
const MAX_WAITERS = 16;
const BOARD_CACHE_MS = 5000;
const SWEEP_MS = 30 * 1000;
const FLUSH_MS = 40;
const BOARD_POLICY = policy(BOARD_SCRIPT);
const WIKI_POLICY = policy(WIKI_SCRIPT);
const WIKI_POLICY_MERMAID = policy(WIKI_SCRIPT, true);
const OLD_LINK = 'This link is old or not complete. Run "forge.mjs open --status" for the link of the live server.\n';

/** The folder of the state files: one file for the live server of each repository. */
export function liveDir(env = process.env) {
  return path.join(dataDir(env), LIVE_DIR);
}

/** The state file of the live server of one Forge folder. */
export function liveFile(env = process.env, home = '') {
  const folder = path.resolve(home);
  const id = createHash('sha256').update(process.platform === 'win32' ? folder.toLowerCase() : folder).digest('hex').slice(0, 16);
  return path.join(liveDir(env), `${id}.json`);
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

// The server of one state file, or null when the file is not there, is damaged, or names a process that is gone.
function readState(file) {
  let state;
  try { state = JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
  if (!state || !Number.isInteger(state.pid) || !Number.isInteger(state.port) || !/^[0-9a-f]{32}$/.test(state.page ?? '') || !alive(state.pid)) return null;
  const base = `http://${SERVE_HOST}:${state.port}`;
  return {
    pid: state.pid, port: state.port, link: `${base}/board?t=${state.page}`, wikiLink: `${base}/wiki?t=${state.page}`, file,
    home: typeof state.home === 'string' ? state.home : '', repo: typeof state.repo === 'string' ? state.repo : '',
  };
}

/** The live server of one Forge folder: { pid, port, link, wikiLink, file, home, repo }, or null when none runs. */
export function liveStatus(env = process.env, home = '') {
  return readState(liveFile(env, home));
}

/** Each live server of this user that runs, in the order of the Forge folders. */
export function liveList(env = process.env) {
  let names = [];
  try { names = readdirSync(liveDir(env)).filter((name) => name.endsWith('.json')); } catch { return []; }
  return names.map((name) => readState(path.join(liveDir(env), name))).filter(Boolean).sort((a, b) => (a.home < b.home ? -1 : a.home > b.home ? 1 : 0));
}

/**
 * The folders of a repository, for the reporter: the main checkout, its worktrees folder, the Forge folder,
 * and each ticket worktree that is outside of them. A session in one of these folders reports to the server of this repository.
 */
export function liveRoots(home, repo, tickets = []) {
  const roots = [repo, repo ? `${repo}.worktrees` : '', home].filter(Boolean).map((folder) => path.resolve(folder));
  const inside = (folder) => roots.some((root) => folder === root || folder.startsWith(root + path.sep));
  for (const item of tickets) {
    const folder = item.worktree ? path.resolve(item.worktree) : '';
    if (folder && !inside(folder)) roots.push(folder);
  }
  return roots;
}

// True when a server accepts a connection on the port. A state file can stay after a crash, and a new process can get the old process id.
function answers(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: SERVE_HOST, port });
    const end = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(500, () => end(false));
    socket.once('connect', () => end(true));
    socket.once('error', () => end(false));
  });
}

/**
 * Serves the board and the canvases of one wiki with the live state of the sessions, until a signal or the idle limit.
 * `repo` is the main checkout of the repository: with it, the sessions in the checkout and in its worktrees report to this server.
 * Gives the exit code: 130 or 143 after a signal, and 3 at the idle limit.
 */
export async function serveLive(wiki, { links = 'vscode', port, repo = '', idleMs = IDLE_MS, holdMs = HOLD_MS, out = process.stdout, err = process.stderr, signals = process, env = process.env } = {}) {
  const home = homeOf(wiki);
  const running = liveStatus(env, home);
  if (running && await answers(running.port)) throw new Error(`A live server runs already for this repository: ${running.link}. Stop it first (forge.mjs open --stop, or process ${running.pid}).`);
  const pageToken = randomBytes(16).toString('hex');
  const eventToken = randomBytes(16).toString('hex');
  const live = createLive();
  const waiters = new Set();
  let version = 1;
  let flush = null;
  let finish;
  const ended = new Promise((resolve) => { finish = resolve; });

  // The tickets of the board, for the ticket of each session. A read error gives no ticket, and the sessions still show.
  let cache = { at: 0, tickets: [] };
  const tickets = () => {
    if (Date.now() - cache.at < BOARD_CACHE_MS) return cache.tickets;
    let found = [];
    try { found = buildBoard(wiki).groups.flatMap((group) => group.tickets.map((item) => ({ key: item.key, folder: item.folder, worktree: item.worktree }))); } catch { found = []; }
    cache = { at: Date.now(), tickets: found };
    // A new ticket worktree outside of the usual folders is a new root for the reporter.
    if (bound && JSON.stringify(liveRoots(home, repo, found)) !== JSON.stringify(roots)) writeState(found);
    return found;
  };

  const snapshot = (ticket) => {
    const sessions = summary(live, tickets(), Date.now());
    const body = { v: version, now: Date.now(), sessions };
    if (ticket) body.detail = detail(live, sessions.filter((item) => item.ticket === ticket).map((item) => item.id));
    return JSON.stringify(body);
  };

  const send = (res, status, type, body, extra = {}) => {
    res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...extra });
    res.end(body);
  };
  const plain = (res, status, text) => send(res, status, 'text/plain; charset=utf-8', text);
  const answer = (waiter) => {
    if (!waiters.delete(waiter)) return;
    clearTimeout(waiter.timer);
    if (!waiter.res.writableEnded && !waiter.res.destroyed) send(waiter.res, 200, 'application/json; charset=utf-8', snapshot(waiter.ticket));
  };
  // Many events can come at one time. The pages get one answer for them.
  const changed = () => {
    version += 1;
    flush ??= setTimeout(() => { flush = null; for (const waiter of [...waiters]) answer(waiter); }, FLUSH_MS);
  };

  const file = liveFile(env, home);
  let bound = 0;
  let roots = [];
  function writeState(found) {
    roots = liveRoots(home, repo, found);
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ v: 2, pid: process.pid, port: bound, token: eventToken, page: pageToken, wiki, home, repo, roots })}\n`, { mode: 0o600 });
    renameSync(temp, file);
  }

  let idle = null;
  const restIdle = () => { clearTimeout(idle); idle = setTimeout(() => finish({ code: 3 }), idleMs); };

  const server = http.createServer(async (req, res) => {
    try {
      const post = req.method === 'POST';
      const status = checkRequest(req, post ? eventToken : pageToken);
      if (status) {
        req.resume();
        plain(res, status, status === 403 ? OLD_LINK : `Refused (${status}).\n`);
        return;
      }
      const url = new URL(req.url, `http://${SERVE_HOST}`);
      if (post) {
        // Only the reporter sends events. A browser adds one of these headers to a request of a page, so a page cannot send an event.
        if (url.pathname !== '/event') { req.resume(); plain(res, 404, 'Not found.\n'); return; }
        if (req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined) { req.resume(); plain(res, 403, 'Refused (403).\n'); return; }
        const text = await readBody(req, MAX_EVENT);
        if (text === null) { plain(res, 413, 'The event is too large.\n'); return; }
        let event = null;
        try { event = checkEvent(JSON.parse(text)); } catch { event = null; }
        if (!event) { plain(res, 400, 'The request has no event that the server can read.\n'); return; }
        reduce(live, event);
        restIdle();
        changed();
        res.writeHead(204, BASE_HEADERS);
        res.end();
        return;
      }
      if (url.pathname === '/live') {
        const board = tickets();
        const wanted = url.searchParams.get('ticket') ?? '';
        const ticket = board.some((item) => item.folder === wanted) ? wanted : '';
        if (url.searchParams.get('v') !== String(version)) { send(res, 200, 'application/json; charset=utf-8', snapshot(ticket)); return; }
        const waiter = { res, ticket, timer: null };
        waiter.timer = setTimeout(() => answer(waiter), holdMs);
        waiters.add(waiter);
        res.on('close', () => { clearTimeout(waiter.timer); waiters.delete(waiter); });
        // A browser keeps few connections to one server. The oldest request gets its answer, so that it does not stop a new page.
        if (waiters.size > MAX_WAITERS) answer(waiters.values().next().value);
        return;
      }
      if (url.pathname === '/') {
        send(res, 302, 'text/plain; charset=utf-8', 'See the new address.\n', { Location: `/board?t=${pageToken}` });
        return;
      }
      if (url.pathname === MERMAID_ROUTE) {
        const file = mermaidAnswer();
        res.writeHead(200, { ...BASE_HEADERS, ...file.headers, 'Content-Length': file.body.length });
        res.end(file.body);
        return;
      }
      // Each load reads the ticket files again, so a page shows the current tickets.
      const board = buildBoard(wiki);
      // The wiki model, for a page only: a request for a file of a ticket does not read the wiki.
      let pages = null;
      const model = () => (pages ??= buildWiki(wiki, { board }));
      if (url.pathname === '/board') {
        const page = renderBoardPage(board, { links, wiki, serve: { token: pageToken, live: `/live?t=${pageToken}` }, nav: buildNav(board, { token: pageToken, closed: model().closed }) });
        send(res, 200, 'text/html; charset=utf-8', page, { 'Content-Security-Policy': BOARD_POLICY });
        return;
      }
      if (url.pathname === '/wiki') {
        const page = renderWikiPage(model(), { links, serve: { token: pageToken }, nav: buildNav(board, { from: 'wiki', token: pageToken, closed: model().closed }) });
        send(res, 200, 'text/html; charset=utf-8', page, { 'Content-Security-Policy': needsMermaid(page) ? WIKI_POLICY_MERMAID : WIKI_POLICY });
        return;
      }
      const match = /^\/ticket\/([^/]+)(\/.*)?$/.exec(url.pathname);
      if (!match) { plain(res, 404, 'Not found.\n'); return; }
      // Only the folder of a ticket on the board is a route. Another name, also a path that goes up, is not found.
      let name = '';
      try { name = decodeURIComponent(match[1]); } catch { name = ''; }
      if (!board.groups.some((group) => group.tickets.some((item) => item.folder === name))) { plain(res, 404, 'Not found.\n'); return; }
      const dir = path.join(ticketRoot(wiki), name);
      if (match[2] === undefined) {
        send(res, 302, 'text/plain; charset=utf-8', 'See the new address.\n', { Location: `/ticket/${encodeURIComponent(name)}/?t=${pageToken}` });
        return;
      }
      if (match[2] === '/') {
        const page = renderCanvas(buildCanvas(dir), {
          links, nav: buildNav(board, { from: name, token: pageToken, closed: model().closed }),
          serve: { token: pageToken, live: `/live?t=${pageToken}&ticket=${encodeURIComponent(name)}` },
          wiki: wikiLinks(model(), { from: name, token: pageToken, dir }), mermaid: true,
        });
        send(res, 200, 'text/html; charset=utf-8', page, { 'Content-Security-Policy': canvasPolicy(page) });
        return;
      }
      const file = ticketFile(dir, match[2]);
      if (!file) { plain(res, 404, 'Not found.\n'); return; }
      send(res, 200, file.type, readFileSync(file.file), { 'Content-Security-Policy': "default-src 'none'; sandbox" });
    } catch (error) {
      if (!res.headersSent) plain(res, 500, `The live server cannot show the page: ${error.message}\n`);
      else res.destroy();
    }
  });

  // Each repository gets its own stable port, so a browser keeps the address of a repository.
  bound = await bind(server, `forge-live:${home}`, port, 'live');
  // The state file gives the reporter the port, the event token, and the folders of this repository. Only the user can read it.
  mkdirSync(path.dirname(file), { recursive: true });
  writeState(tickets());
  // Until Forge 8.3 one server ran for a user. Its state file has no folders, so no reporter can use it.
  rmSync(path.join(dataDir(env), LIVE_FILE), { force: true });

  // The signal handlers come before the first line: a reader of that line can stop the server at once.
  const onInt = () => finish({ code: 130 });
  const onTerm = () => finish({ code: 143 });
  signals.once('SIGINT', onInt);
  signals.once('SIGTERM', onTerm);
  restIdle();
  // The sweep also reads the board again, so the roots of the reporter stay current when no page is open.
  const sweep = setInterval(() => { tickets(); if (prune(live)) changed(); }, SWEEP_MS);
  out.write(`live: serving http://${SERVE_HOST}:${bound}/board?t=${pageToken}\n  wiki  http://${SERVE_HOST}:${bound}/wiki?t=${pageToken}\n  state ${file}\n`);

  const result = await ended;
  clearTimeout(idle);
  clearTimeout(flush);
  clearInterval(sweep);
  signals.off('SIGINT', onInt);
  signals.off('SIGTERM', onTerm);
  // Another server can own the file now: remove only the file of this server.
  try { if (JSON.parse(readFileSync(file, 'utf8')).token === eventToken) rmSync(file, { force: true }); } catch { /* The file is gone. */ }
  for (const waiter of [...waiters]) { clearTimeout(waiter.timer); waiters.delete(waiter); }
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  err.write(result.code === 3 ? 'forge: the live server stopped: no session sent an event for a long time.\n' : 'forge: the live server stopped.\n');
  return result.code;
}
