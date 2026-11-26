// The live server: `forge.mjs live`. It shows the board page and the wiki page on this machine only (127.0.0.1),
// with the live state of the agent sessions: the session hooks (live-hook.mjs) send their events to POST /event,
// and a page reads the state from GET /live (the server holds the answer until the state changes).
// Its one action for a page is POST /resume: it opens a terminal of the user with the command
// that continues a closed session of the session list (sessions.mjs, terminal.mjs). Each other request is a GET, or an event of the reporter.
// The events stay in memory. It writes its state file in the forge data folder (the port, the tokens, and the folders of its repository,
// for the reporter of the same user), and lines of the session list. It has no CORS header. A page needs the page token, and an event needs the event token.
// The page token is stable for each Forge folder: it is in a key file next to the state file, so a bookmark of the board works after a restart.
// The event token is new at each start. A page answer has a change stamp (c) and the count of what needs the user (needs): see live-stamp.mjs.
// One server runs for each repository: the state file has the name of the Forge folder (a hash), and the reporter sends an event
// to the server whose folders hold the folder of the session.
import http from 'node:http';
import net from 'node:net';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard } from './board.mjs';
import { BOARD_SCRIPT, renderBoardPage } from './board-page.mjs';
import { dataDir } from './data-dir.mjs';
import { harness, resumeArgv, resumeText } from './harness.mjs';
import { homeOf, rawDir } from './layout.mjs';
import { launcherCommand } from './launcher.mjs';
import { LIVE_DIR, LIVE_FILE, MAX_EVENT, checkEvent } from './live-event.mjs';
import { boardStamp, needsCount } from './live-stamp.mjs';
import { createLive, prune, reduce, summary } from './live.mjs';
import { MERMAID_ROUTE, needsMermaid, readMermaid } from './mermaid.mjs';
import { pastSessions, readSessions, recordEnd, recordLabel, recordStart, sessionsFile } from './sessions.mjs';
import { openTerminal } from './terminal.mjs';
import { ticketRoot } from './tickets.mjs';
import { ERROR_POLICY, buildNav, errorPage } from './ui.mjs';
import { WIKI_SCRIPT, renderWikiPage } from './wiki-page.mjs';
import { buildWiki } from './wiki.mjs';

/** The server stops after this time without an event and without a request of a page. */
export const IDLE_MS = 8 * 60 * 60 * 1000;
/** A page request for the state gets its answer after this time at the latest. */
export const HOLD_MS = 25 * 1000;
const MAX_WAITERS = 16;
const BOARD_CACHE_MS = 5000;
const SWEEP_MS = 30 * 1000;
const FLUSH_MS = 40;
/** One session gets one start in this time: a second click opens no second terminal on the same session. */
export const RESUME_GAP_MS = 15 * 1000;
const MAX_RESUME = 1024;
// The reporter of a late event of a session can start after the end hook wrote its line.
const REOPEN_MS = 2000;
const KEY_TITLE = /^([A-Za-z][A-Za-z0-9]*-\d+) - /;
export const SERVE_HOST = '127.0.0.1';
/** The version of this plugin. The state file holds it, so `open` can replace a server of an older version. */
export const PLUGIN_VERSION = (() => {
  try { return String(JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugin.json'), 'utf8')).version ?? ''); } catch { return ''; }
})();
const PORT_BASE = 41000;
const PORT_SPAN = 2000;
const PORT_TRIES = 10;
const MAX_FILE = 8 * 1024 * 1024;
// A link on the page can name a file of the ticket folder. The server gives only these types, and never a page.
const TYPES = {
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8', '.json': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
};
const BASE_HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
// A page can run only its own script, and it can connect only to this server. It can show an image from a data address only: the icon of its tab.
// With `self`, the page can also load a script file of this server: the Mermaid file of the wiki page.
export const policy = (script, self = false) => `default-src 'none'; script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'${self ? " 'self'" : ''}; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'`;
/** The answer for the Mermaid file of forge: the bytes and the headers. The browser can keep the file for one run of the server. */
function mermaidAnswer() {
  return { body: readMermaid(), headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'private, max-age=86400' } };
}
const BOARD_POLICY = policy(BOARD_SCRIPT);
const WIKI_POLICY = policy(WIKI_SCRIPT);
const WIKI_POLICY_MERMAID = policy(WIKI_SCRIPT, true);

/** True for a GET that a browser makes for a page: its Accept header names text/html. A script, a hook reporter, or curl does not send that. */
const wantsHtml = (req) => req.method === 'GET' && /text\/html/i.test(String(req.headers.accept ?? ''));

/**
 * Answers a 403, a 404, or a 500. A request that wants a page gets the error page of the kit with ERROR_POLICY (no script, no connection).
 * Each other caller gets `text` as plain text, as before. `page` is { title, text, command, links } for errorPage. The headers of a plain answer stay.
 */
function errorAnswer(req, res, status, text, page) {
  const html = wantsHtml(req);
  const body = html ? errorPage({ status, ...page }) : text;
  res.writeHead(status, {
    ...BASE_HEADERS, 'Content-Type': html ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body),
    ...(html ? { 'Content-Security-Policy': ERROR_POLICY } : {}),
  });
  res.end(body);
}

/** The first port that the server tries for a key. The same key gets the same port, so the browser keeps the address. */
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

/** A regular file inside the ticket folder with a listed type, or null. */
function ticketFile(dir, pathname) {
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
function readBody(req, max) {
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
async function bind(server, key, port, name = 'live') {
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

const OLD_LINK = 'This link is old or not complete. Run "forge.mjs open --status" for the link of the live server.\n';
// The page for a 403 echoes nothing of the request and names no folder: the command is the one that the launcher of the Forge folder has.
const OLD_PAGE = { title: 'This link is old', text: 'The link is old or not complete. Run this command in the Forge folder of the repository for the new link:', command: 'forge open' };

/** The folder of the state files: one file for the live server of each repository. */
export function liveDir(env = process.env) {
  return path.join(dataDir(env), LIVE_DIR);
}

// The name of the files of one Forge folder in the folder of the state files: a hash of the folder.
function liveId(home) {
  const folder = path.resolve(home);
  return createHash('sha256').update(process.platform === 'win32' ? folder.toLowerCase() : folder).digest('hex').slice(0, 16);
}

/** The state file of the live server of one Forge folder. */
export function liveFile(env = process.env, home = '') {
  return path.join(liveDir(env), `${liveId(home)}.json`);
}

/** The key file of one Forge folder: the page token of its live server, next to the state file. It stays when the server stops. */
export function keyFile(env = process.env, home = '') {
  return path.join(liveDir(env), `${liveId(home)}.key`);
}

// The page token is stable: the same key file gives the same links after a restart, so a bookmark of the board still works.
// Known limit: the stable link is in the browser history, and in the argument of the command that starts the browser (open.mjs), so another program
// of this user can read it. The Host check, the Origin check of POST /resume, and the missing CORS header still stop a page of another site.
// "forge.mjs open --new-link" writes a new key: that is the answer to a link that leaked.
const KEY_TEXT = /^[0-9a-f]{32}(?:\r?\n)?$/;

// The key of a key file, or null when the file is not there, is not a regular file (a link is not one), has more than a key, is not owned by this user,
// or can be read or written by group or other (not checked on Windows, which has no such mode). The file is opened without following a link.
function readKey(file) {
  let fd = -1;
  try {
    if (lstatSync(file).isSymbolicLink()) return null;
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > 64) return null;
    if (process.platform !== 'win32') {
      if ((info.mode & 0o077) !== 0) return null;
      if (typeof process.getuid === 'function' && info.uid !== process.getuid()) return null;
    }
    const buffer = Buffer.alloc(info.size);
    if (readSync(fd, buffer, 0, info.size, 0) !== info.size) return null;
    const text = buffer.toString('latin1');
    return KEY_TEXT.test(text) ? text.slice(0, 32) : null;
  } catch { return null; } finally {
    if (fd >= 0) { try { closeSync(fd); } catch { /* The file is closed. */ } }
  }
}

// Writes a key with a temporary file and a rename, with the mode that only the user can read. A rename replaces a link and does not follow it.
function writeKey(file, key) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  rmSync(temp, { force: true });
  writeFileSync(temp, `${key}\n`, { mode: 0o600, flag: 'wx' });
  try { renameSync(temp, file); } catch (error) { rmSync(temp, { force: true }); throw error; }
}

/** Writes a new page token for the live server of a Forge folder, and gives it. The server that starts next uses it. */
export function newKey(env = process.env, home = '') {
  const key = randomBytes(16).toString('hex');
  writeKey(keyFile(env, home), key);
  return key;
}

// The key of the key file, or a new key when the file has none that can be used. A key that cannot be saved still works until the server stops.
function pageKey(env, home) {
  const file = keyFile(env, home);
  const kept = readKey(file);
  if (kept) return kept;
  const key = randomBytes(16).toString('hex');
  try { writeKey(file, key); } catch { /* The folder of the state files cannot be written: the link works for this run only. */ }
  return key;
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
    version: typeof state.version === 'string' ? state.version : '',
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
 * Serves the board and the wiki page of one wiki with the live state of the sessions, until a signal or the idle limit.
 * `repo` is the main checkout of the repository: with it, the sessions in the checkout and in its worktrees report to this server.
 * `openTerminalFn` opens the terminal for a Resume (terminal.mjs). A test gives its own function.
 * Gives the exit code: 130 or 143 after a signal, and 3 at the idle limit (no event and no request of a page for `idleMs`).
 * `sweepMs` is the time between two sweeps: a test gives a short one.
 */
export async function serveLive(wiki, { port, repo = '', idleMs = IDLE_MS, holdMs = HOLD_MS, sweepMs = SWEEP_MS, out = process.stdout, err = process.stderr, signals = process, env = process.env, openTerminalFn = openTerminal } = {}) {
  const home = homeOf(wiki);
  const running = liveStatus(env, home);
  if (running && await answers(running.port)) throw new Error(`A live server runs already for this repository: ${running.link}. Stop it first (forge.mjs open --stop, or process ${running.pid}).`);
  const pageToken = pageKey(env, home);
  const eventToken = randomBytes(16).toString('hex');
  const live = createLive();
  const waiters = new Set();
  let version = 1;
  let flush = null;
  let finish;
  const ended = new Promise((resolve) => { finish = resolve; });

  // The tickets of the board, for the ticket of each session. A read error gives no ticket, and the sessions still show.
  // The cache also holds the board stamp. A page request gives its fresh model to the cache, so the stamp of the page and the stamp of the next answer agree.
  let cache = { at: 0, tickets: [], stamp: '' };
  const keep = (model) => {
    const found = model ? model.groups.flatMap((group) => group.tickets.map((item) => ({ key: item.key, folder: item.folder, worktree: item.worktree, state: item.state }))) : [];
    cache = { at: Date.now(), tickets: found, stamp: model ? boardStamp(model) : '' };
    // A new ticket worktree outside of the usual folders is a new root for the reporter.
    if (bound && JSON.stringify(liveRoots(home, repo, found)) !== JSON.stringify(roots)) writeState(found);
    return found;
  };
  const tickets = () => {
    if (Date.now() - cache.at < BOARD_CACHE_MS) return cache.tickets;
    try { return keep(buildBoard(wiki)); } catch { return keep(null); }
  };

  // The change stamp of the board. `seen` holds the last stamp. A stamp that changed raises the version, so a held request of a page gets its answer
  // (and the page shows that its data changed).
  let seen = null;
  const scan = () => {
    const moved = seen !== null && seen !== cache.stamp;
    seen = cache.stamp;
    return moved;
  };

  // The session list of the repository: the sessions that are not live any more, with the command that continues each one.
  const raw = rawDir(wiki);
  let records = new Map();
  let stamp = '';
  // Reads the file again when its size or its time changed. True when it was read.
  const loadRecords = () => {
    let next = '';
    try { const info = statSync(sessionsFile(raw)); next = `${info.size}:${info.mtimeMs}`; } catch { next = ''; }
    if (next === stamp) return false;
    stamp = next;
    records = readSessions(raw);
    return true;
  };

  const snapshot = () => {
    loadRecords();
    const board = tickets();
    const now = Date.now();
    const past = pastSessions(records, live, board, now);
    // A session that ended shows one time: as a row of the session list, with its buttons.
    const hidden = new Set(past.map((item) => live.sessions.get(item.id)?.sid).filter(Boolean));
    const sessions = summary(live, board, now).filter((item) => !hidden.has(item.id));
    // c: the stamp of the data of the page (the board). needs: the tickets and the sessions that wait for the user (the tab of the page shows it).
    return JSON.stringify({ v: version, now, c: cache.stamp, needs: needsCount(board, sessions), sessions, past });
  };

  // The live events keep the session list complete: a session that started before this plugin version, the title that
  // changed, the first prompt as a label, and an end that the end hook had no time to write. An error here stops no event.
  const note = (event) => {
    try {
      if (!harness(event.host) || event.agent) return;
      loadRecords();
      const record = records.get(event.session);
      const base = { host: event.host, id: event.session, cwd: event.cwd || record?.cwd || '' };
      // An event that is clearly later than the end of the record is a session that continues, also when its start hook wrote no line.
      const again = Boolean(record?.end) && event.event !== 'session-end' && event.ts > record.end + REOPEN_MS;
      const renamed = Boolean(record && event.title) && event.title !== record.title && event.ts >= record.end;
      if (!record || again || renamed) recordStart(raw, { ...base, title: event.title, source: !record ? 'seen' : again ? 'again' : 'title' }, event.ts);
      if (event.event === 'prompt' && !event.title && !record?.title && !record?.label) recordLabel(raw, { ...base, text: event.text }, event.ts);
      if (event.event === 'session-end' && !record?.end) recordEnd(raw, { ...base, reason: event.kind }, event.ts);
      loadRecords();
    } catch { /* The session list is a view. */ }
  };

  const send = (res, status, type, body, extra = {}) => {
    res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...extra });
    res.end(body);
  };
  const plain = (res, status, text) => send(res, status, 'text/plain; charset=utf-8', text);
  const answer = (waiter) => {
    if (!waiters.delete(waiter)) return;
    clearTimeout(waiter.timer);
    if (!waiter.res.writableEnded && !waiter.res.destroyed) send(waiter.res, 200, 'application/json; charset=utf-8', snapshot());
  };
  // Many events can come at one time. The pages get one answer for them.
  const changed = () => {
    version += 1;
    flush ??= setTimeout(() => { flush = null; tickets(); scan(); for (const waiter of [...waiters]) answer(waiter); }, FLUSH_MS);
  };

  const file = liveFile(env, home);
  let bound = 0;
  let roots = [];
  function writeState(found) {
    roots = liveRoots(home, repo, found);
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ v: 2, version: PLUGIN_VERSION, pid: process.pid, port: bound, token: eventToken, page: pageToken, wiki, home, repo, roots })}\n`, { mode: 0o600 });
    renameSync(temp, file);
  }

  let idle = null;
  let lastClear = 0;
  // The command that starts this server again: the launcher of the Forge folder, or the plain name of the command. The pages show it when the server stops.
  const openText = launcherCommand(home) || 'forge.mjs open';
  // After the token check, an error page has a link to the board with the token: the user holds the token already.
  const back = [{ text: 'Open the board', href: `/board?t=${pageToken}` }];
  const missing = (req, res) => errorAnswer(req, res, 404, 'Not found.\n', { title: 'Not found', text: 'This server has no page at this address.', links: back });
  const restIdle = () => { clearTimeout(idle); idle = setTimeout(() => finish({ code: 3 }), idleMs); };

  // The folder for a session that continues: its own folder when it is still a folder of this repository, else the main checkout.
  const resumeFolder = (cwd) => {
    const isFolder = (folder) => { try { return statSync(folder).isDirectory(); } catch { return false; } };
    const folder = cwd ? path.resolve(cwd) : '';
    if (folder && roots.some((root) => folder === root || folder.startsWith(root + path.sep)) && isFolder(folder)) return { folder, moved: false };
    const other = [repo, home].filter(Boolean).map((item) => path.resolve(item)).find(isFolder);
    return { folder: other ?? '', moved: true };
  };

  // Opens a terminal with the command that continues one session of the session list: { status, body }.
  // The page gives only the id. The host, the folder, and the command come from the record and from the harness table.
  const starts = new Map();
  const resume = async (id) => {
    loadRecords();
    const record = records.get(id);
    const argv = record ? resumeArgv(record.host, record.id) : null;
    if (!argv) return { status: 404, body: { ok: false, error: 'The session list has no session with this id.' } };
    const running = live.sessions.get(record.id);
    if (running && running.state !== 'ended') return { status: 409, body: { ok: false, error: 'This session is open: it sent an event a short time ago.' } };
    const now = Date.now();
    for (const [key, at] of starts) if (now - at >= RESUME_GAP_MS) starts.delete(key);
    if (starts.has(record.id)) return { status: 409, body: { ok: false, error: 'This session got a start a moment ago.' } };
    const { folder, moved } = resumeFolder(record.cwd);
    const command = resumeText(record.host, record.id, folder);
    if (!folder) return { status: 200, body: { ok: false, command, error: 'The folder of the session does not exist.' } };
    starts.set(record.id, now);
    const key = KEY_TITLE.exec(record.title)?.[1];
    let opened = { ok: false };
    try { opened = await openTerminalFn({ cwd: folder, argv, title: [key, harness(record.host).name].filter(Boolean).join(' ') }, { env }); } catch { opened = { ok: false }; }
    if (!opened.ok) {
      starts.delete(record.id);
      return { status: 200, body: { ok: false, command, error: 'No terminal started on this machine.' } };
    }
    // The hooks of the new process write the start line. The pages get it without a wait for the next sweep.
    for (const wait of [3000, 10000]) setTimeout(() => { if (loadRecords()) changed(); }, wait).unref();
    return { status: 200, body: { ok: true, how: opened.how, folder, ...(moved ? { moved: true } : {}) } };
  };

  const server = http.createServer(async (req, res) => {
    // The links of an error page hold the token, so only a request that passed the token check gets them.
    let checked = false;
    try {
      const post = req.method === 'POST';
      // POST /resume comes from a page, so it needs the page token. Each other POST needs the event token.
      const toResume = post && /^\/resume(?:\?|$)/.test(req.url ?? '');
      const status = checkRequest(req, post && !toResume ? eventToken : pageToken);
      if (status) {
        req.resume();
        if (status === 403) errorAnswer(req, res, 403, OLD_LINK, OLD_PAGE);
        else plain(res, status, `Refused (${status}).\n`);
        return;
      }
      checked = true;
      // A page request or a state request with the page token shows that someone looks at the board: it starts the idle time again.
      // A page in a hidden tab sends no request, so a forgotten tab does not keep the server.
      if (!post) restIdle();
      const url = new URL(req.url, `http://${SERVE_HOST}`);
      if (toResume) {
        // This route starts a process on this machine. A browser gives the Origin of the page: without the Origin of this server, no start.
        if (String(req.headers.origin ?? '').toLowerCase() !== `http://${String(req.headers.host).toLowerCase()}`) { req.resume(); plain(res, 403, 'Refused (403).\n'); return; }
        const text = await readBody(req, MAX_RESUME);
        if (text === null) { plain(res, 413, 'The request is too large.\n'); return; }
        let id = '';
        try { const body = JSON.parse(text); id = typeof body?.id === 'string' ? body.id : ''; } catch { id = ''; }
        const result = await resume(id);
        restIdle();
        send(res, result.status, 'application/json; charset=utf-8', JSON.stringify(result.body));
        return;
      }
      if (post) {
        // Only the reporter sends events. A browser adds one of these headers to a request of a page, so a page cannot send an event.
        if (url.pathname !== '/event') { req.resume(); missing(req, res); return; }
        if (req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined) { req.resume(); plain(res, 403, 'Refused (403).\n'); return; }
        const text = await readBody(req, MAX_EVENT);
        if (text === null) { plain(res, 413, 'The event is too large.\n'); return; }
        let event = null;
        try { event = checkEvent(JSON.parse(text)); } catch { event = null; }
        if (!event) { plain(res, 400, 'The request has no event that the server can read.\n'); return; }
        reduce(live, event);
        note(event);
        // A tool that ended can have changed a file of a ticket: the next answer reads the board again (one time in a second at most).
        if (event.event === 'tool-end' && Date.now() - lastClear >= 1000) { lastClear = Date.now(); cache.at = 0; }
        restIdle();
        changed();
        res.writeHead(204, BASE_HEADERS);
        res.end();
        return;
      }
      if (url.pathname === '/live') {
        tickets();
        // A change that no event told (a file that the user edited) raises the version here, so this request gets its answer at once.
        if (scan()) version += 1;
        if (url.searchParams.get('v') !== String(version)) { send(res, 200, 'application/json; charset=utf-8', snapshot()); return; }
        const waiter = { res, timer: null };
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
      keep(board);
      // The wiki model, for a page only: a request for a file of a ticket does not read the wiki.
      let pages = null;
      const model = () => (pages ??= buildWiki(wiki, { board }));
      if (url.pathname === '/board') {
        if (scan()) changed();
        const page = renderBoardPage(board, { serve: { token: pageToken, live: `/live?t=${pageToken}`, resume: '/resume', open: openText, c: cache.stamp }, nav: buildNav(board, { token: pageToken, closed: model().closed }) });
        send(res, 200, 'text/html; charset=utf-8', page, { 'Content-Security-Policy': BOARD_POLICY });
        return;
      }
      if (url.pathname === '/wiki') {
        const page = renderWikiPage(model(), { serve: { token: pageToken, open: openText }, nav: buildNav(board, { from: 'wiki', token: pageToken, closed: model().closed }) });
        send(res, 200, 'text/html; charset=utf-8', page, { 'Content-Security-Policy': needsMermaid(page) ? WIKI_POLICY_MERMAID : WIKI_POLICY });
        return;
      }
      // A file of a ticket folder: /ticket/<folder>/<file>. A page link of a ticket card opens it. A ticket has no page of its own.
      const match = /^\/ticket\/([^/]+)(\/.+)$/.exec(url.pathname);
      if (!match) { missing(req, res); return; }
      // Only the folder of a ticket on the board is a route. Another name, also a path that goes up, is not found.
      let name = '';
      try { name = decodeURIComponent(match[1]); } catch { name = ''; }
      if (!board.groups.some((group) => group.tickets.some((item) => item.folder === name))) { missing(req, res); return; }
      const dir = path.join(ticketRoot(wiki), name);
      const file = ticketFile(dir, match[2]);
      if (!file) { missing(req, res); return; }
      send(res, 200, file.type, readFileSync(file.file), { 'Content-Security-Policy': "default-src 'none'; sandbox" });
    } catch (error) {
      if (!res.headersSent) {
        errorAnswer(req, res, 500, `The live server cannot show the page: ${error.message}\n`, { title: 'Something went wrong', text: `The live server cannot show the page: ${error.message}`, links: checked ? back : [] });
      }
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
  // It reads the session list again: a Copilot CLI session has no live event, only the lines of its start and its end.
  // It reads the board and the files of the tickets again too: a change of a file raises the version, so a held request of a page gets its answer.
  const sweep = setInterval(() => { cache.at = 0; tickets(); const moved = scan(); const pruned = prune(live); if (loadRecords() || pruned || moved) changed(); }, sweepMs);
  out.write(`live: serving http://${SERVE_HOST}:${bound}/board?t=${pageToken}\n  wiki  http://${SERVE_HOST}:${bound}/wiki?t=${pageToken}\n  state ${file}\n`);

  const result = await ended;
  clearTimeout(idle);
  clearTimeout(flush);
  clearInterval(sweep);
  signals.off('SIGINT', onInt);
  signals.off('SIGTERM', onTerm);
  // Another server can own the file now: remove only the file of this server.
  try { if (sameToken(JSON.parse(readFileSync(file, 'utf8')).token, eventToken)) rmSync(file, { force: true }); } catch { /* The file is gone. */ }
  for (const waiter of [...waiters]) { clearTimeout(waiter.timer); waiters.delete(waiter); }
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  err.write(result.code === 3 ? 'forge: the live server stopped: no session sent an event and no page asked for the state for a long time.\n' : 'forge: the live server stopped.\n');
  return result.code;
}
