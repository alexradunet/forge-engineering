// The live server: `forge.mjs live`. It shows the board page, the wiki page, and the ticket canvases on this machine only (127.0.0.1),
// with the live state of the agent sessions: the session hooks (live-hook.mjs) send their events to POST /event,
// and a page reads the state from GET /live (the server holds the answer until the state changes).
// It is read-only for a session: it has no route that sends text or an answer to a session, and no Send to agent.
// The events stay in memory. The only file that it writes is its state file in the forge data folder (the port and the tokens,
// for the reporter of the same user). It has no CORS header. A page needs the page token, and an event needs the event token.
import http from 'node:http';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildBoard } from './board.mjs';
import { BOARD_SCRIPT, renderBoardPage } from './board-page.mjs';
import { buildCanvas, renderCanvas } from './canvas.mjs';
import { CANVAS_SCRIPT } from './canvas-page.mjs';
import { BASE_HEADERS, SERVE_HOST, bind, checkRequest, policy, readBody, ticketFile } from './canvas-serve.mjs';
import { dataDir } from './data-dir.mjs';
import { LIVE_FILE, MAX_EVENT, checkEvent } from './live-event.mjs';
import { createLive, detail, prune, reduce, summary } from './live.mjs';
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
const PAGE_POLICY = policy(CANVAS_SCRIPT);
const BOARD_POLICY = policy(BOARD_SCRIPT);
const WIKI_POLICY = policy(WIKI_SCRIPT);
const OLD_LINK = 'This link is old or not complete. Run "forge.mjs live --status" for the link of the live server.\n';

export function liveFile(env = process.env) {
  return path.join(dataDir(env), LIVE_FILE);
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

/** The live server of this user: { pid, port, link, file }, or null when none runs. */
export function liveStatus(env = process.env) {
  const file = liveFile(env);
  let state;
  try { state = JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
  if (!state || !Number.isInteger(state.pid) || !Number.isInteger(state.port) || !/^[0-9a-f]{32}$/.test(state.page ?? '') || !alive(state.pid)) return null;
  return { pid: state.pid, port: state.port, link: `http://${SERVE_HOST}:${state.port}/board?t=${state.page}`, file };
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
 * Gives the exit code: 130 or 143 after a signal, and 3 at the idle limit.
 */
export async function serveLive(wiki, { links = 'vscode', port, idleMs = IDLE_MS, holdMs = HOLD_MS, out = process.stdout, err = process.stderr, signals = process, env = process.env } = {}) {
  const running = liveStatus(env);
  if (running && await answers(running.port)) throw new Error(`A live server runs already: ${running.link}. Stop it first (process ${running.pid}).`);
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
        send(res, 200, 'text/html; charset=utf-8', page, { 'Content-Security-Policy': WIKI_POLICY });
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
          wiki: wikiLinks(model(), { from: name, token: pageToken, dir }),
        });
        send(res, 200, 'text/html; charset=utf-8', page, { 'Content-Security-Policy': PAGE_POLICY });
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

  const bound = await bind(server, 'forge-live', port, 'live');
  // The state file gives the reporter the port and the event token. Only the user can read it.
  const file = liveFile(env);
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ v: 1, pid: process.pid, port: bound, token: eventToken, page: pageToken, wiki })}\n`, { mode: 0o600 });
  renameSync(temp, file);

  // The signal handlers come before the first line: a reader of that line can stop the server at once.
  const onInt = () => finish({ code: 130 });
  const onTerm = () => finish({ code: 143 });
  signals.once('SIGINT', onInt);
  signals.once('SIGTERM', onTerm);
  restIdle();
  const sweep = setInterval(() => { if (prune(live)) changed(); }, SWEEP_MS);
  out.write(`live: serving http://${SERVE_HOST}:${bound}/board?t=${pageToken}\n  state ${file}\n`);

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
