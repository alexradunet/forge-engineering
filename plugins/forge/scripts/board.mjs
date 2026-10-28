#!/usr/bin/env node
// Starts (or reuses) the local ticket board of the current repository wiki and
// prints its URL. Each wiki gets its own port, stored in the user data folder.
//   node board.mjs [--ticket <key>]   board URL (or the ticket URL)
//   node board.mjs --check [--ticket <key>]   validate ticket frontmatter; exit 1 on problems
//   node board.mjs --restart | --stop
//   Options: --cwd <dir>, --wiki <dir>, --port <n>
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir } from './lib/cred.mjs';
import { ForgeError, resolve, samePath } from './lib/repo.mjs';

const APP = 'forge-ticket-board';
const FIRST_PORT = 4517;
const server = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'board', 'server.mjs');

export function parseArgs(argv) {
  const a = { check: false, restart: false, stop: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--check') a.check = true;
    else if (v === '--restart') a.restart = true;
    else if (v === '--stop') a.stop = true;
    else if (['--ticket', '--cwd', '--wiki', '--port'].includes(v)) a[v.slice(2)] = argv[++i];
    else throw new ForgeError(`Unknown option: ${v}`, 'bad-args');
  }
  if (a.port !== undefined && !(Number(a.port) > 0 && Number(a.port) < 65536)) throw new ForgeError(`Bad port: ${a.port}`, 'bad-args');
  return a;
}

const stateFile = (env) => path.join(dataDir(env), 'board.json');

export function readState(env = process.env) {
  try { return JSON.parse(readFileSync(stateFile(env), 'utf8')); } catch { return { boards: {} }; }
}

export function writeState(state, env = process.env) {
  const f = stateFile(env);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(`${f}.tmp`, JSON.stringify(state, null, 2));
  renameSync(`${f}.tmp`, f);
}

// null: nothing listens. { app: null }: another server listens.
export function health(port) {
  return new Promise((res) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', agent: false, timeout: 1500 }, (r) => {
      let body = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { body += c; });
      r.on('end', () => { try { res(JSON.parse(body)); } catch { res({ app: null }); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => res(e.code === 'ECONNREFUSED' ? null : { app: null }));
  });
}

const portFree = (port) => new Promise((res) => {
  const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true)));
  s.listen(port, '127.0.0.1');
});

// The recorded port when it is ours or free; else the first free port from 4517
// that no other wiki has.
export async function pickPort(wiki, state, explicit) {
  if (explicit) return Number(explicit);
  const mine = state.boards[wiki]?.port;
  if (mine) {
    const h = await health(mine);
    if ((h && h.app === APP && samePath(h.wiki, wiki)) || (!h && (await portFree(mine)))) return mine;
  }
  const taken = new Set(Object.entries(state.boards).filter(([w]) => w !== wiki).map(([, b]) => b.port));
  for (let p = FIRST_PORT; p < FIRST_PORT + 200; p++) {
    if (!taken.has(p) && (await portFree(p))) return p;
  }
  throw new ForgeError('No free port from 4517 to 4716. Pass --port <n>.', 'no-port');
}

function stop(port, pid) {
  if (!pid) return false;
  try { process.kill(pid); return true; } catch { return false; }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const a = parseArgs(argv);
  const where = resolve({ cwd: a.cwd ?? process.cwd(), wiki: a.wiki, env });
  const wiki = where.wiki.path;
  if (!where.wiki.exists) throw new ForgeError(`No wiki at ${wiki}. Say "set up forge".`, 'no-wiki');
  if (!existsSync(server)) throw new ForgeError(`Missing ${server}. Reinstall the plugin.`, 'no-server');
  const configDir = where.configDir;

  if (a.check) {
    const r = spawnSync(process.execPath, [server, '--check', ...(a.ticket ? [a.ticket] : []), '--wiki', wiki, '--config', configDir], { stdio: 'inherit' });
    return r.status ?? 1;
  }

  const state = readState(env);
  const rec = state.boards[wiki];
  if (a.stop || a.restart) {
    const h = rec ? await health(rec.port) : null;
    const ours = h && h.app === APP && samePath(h.wiki, wiki);
    const stopped = ours && stop(rec.port, rec.pid);
    if (a.stop) {
      console.log(stopped ? `Ticket board on port ${rec.port} stopped.` : 'No ticket board of this wiki runs.');
      return 0;
    }
    if (stopped) await new Promise((r) => setTimeout(r, 300));
  }

  const port = await pickPort(wiki, state, a.port);
  let h = await health(port);
  if (h && !(h.app === APP && samePath(h.wiki, wiki))) throw new ForgeError(`Port ${port} is in use by another server. Pass --port <n>.`, 'port-busy');
  if (!h) {
    const child = spawn(process.execPath, [server, '--wiki', wiki, '--config', configDir, '--port', String(port)], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    state.boards[wiki] = { port, pid: child.pid };
    writeState(state, env);
    for (let i = 0; i < 25 && !h; i++) { await new Promise((r) => setTimeout(r, 200)); h = await health(port); }
    if (!h) throw new ForgeError(`The ticket board did not start on port ${port}. Run: node "${server}" --wiki "${wiki}" --port ${port}`, 'start-failed');
  } else if (!rec || rec.port !== port) {
    state.boards[wiki] = { port, pid: rec?.pid ?? null };
    writeState(state, env);
  }
  console.log(`Ticket board: http://127.0.0.1:${port}/${a.ticket ? `#/${a.ticket.toUpperCase()}` : ''}`);
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    if (err instanceof ForgeError) { console.error(`forge: ${err.message}`); process.exitCode = 1; return; }
    throw err;
  });
}
