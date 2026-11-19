#!/usr/bin/env node
// The live reporter: a session hook that sends one small event to a live server (forge.mjs live) on 127.0.0.1.
//   node live-hook.mjs [--host <host>] [<hook event name>]
// It reads the hook payload on stdin. A host whose payload has no event name gives the name as an argument.
// It prints nothing, it always exits with 0, and it stops by its own timer, so it cannot change or hold a session.
// One live server runs for each repository. The reporter sends the event to the server whose folders hold the folder
// of the session (pickServer in live-event.mjs). A session outside of each served repository sends nothing.
// When no live server runs (no state file in the forge data folder), it stops before it reads the payload.
import { readFileSync, readdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { dataDir } from './lib/data-dir.mjs';
import { LIVE_DIR, LIVE_HOSTS, MAX_EVENT, normalize, pickServer } from './lib/live-event.mjs';

const LIMIT_MS = 400;
const MAX_PAYLOAD = 4 * 1024 * 1024;
const MAX_SERVERS = 32;
const done = () => process.exit(0);

// The state of each live server: the port, the event token, and the root folders of its repository.
function servers() {
  const dir = path.join(dataDir(), LIVE_DIR);
  let names = [];
  try { names = readdirSync(dir).filter((name) => name.endsWith('.json')).slice(0, MAX_SERVERS); } catch { return []; }
  const out = [];
  for (const name of names) {
    try {
      const state = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
      if (state && Number.isInteger(state.port) && state.port > 0 && state.port < 65536 && /^[0-9a-f]{32}$/.test(state.token ?? '')) out.push(state);
    } catch { /* A file that another process writes now, or a damaged file: this server gets no event. */ }
  }
  return out;
}

function main() {
  const states = servers();
  if (!states.length) return done();
  setTimeout(done, LIMIT_MS);
  const args = process.argv.slice(2);
  let host = 'claude';
  let name = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--host') host = args[++i] ?? '';
    else if (!args[i].startsWith('--')) name ||= args[i];
  }
  if (!LIVE_HOSTS.includes(host)) host = 'claude';
  const chunks = [];
  let size = 0;
  process.stdin.on('data', (chunk) => { size += chunk.length; if (size <= MAX_PAYLOAD) chunks.push(chunk); });
  process.stdin.on('error', done);
  process.stdin.on('end', () => {
    let event = null;
    try { event = size <= MAX_PAYLOAD ? normalize(name, JSON.parse(Buffer.concat(chunks).toString('utf8')), host) : null; } catch { event = null; }
    if (!event) return done();
    const server = pickServer(states, event.cwd, process.platform === 'win32');
    if (!server) return done();
    const body = JSON.stringify(event);
    if (Buffer.byteLength(body) > MAX_EVENT) return done();
    const request = http.request({
      host: '127.0.0.1', port: server.port, path: '/event', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Forge-Token': server.token },
    }, (response) => { response.resume(); response.on('end', done); });
    request.on('error', done);
    request.end(body);
  });
}

process.on('uncaughtException', done);
try { main(); } catch { done(); }
