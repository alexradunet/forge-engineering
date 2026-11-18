#!/usr/bin/env node
// The live reporter: a session hook that sends one small event to the live server (forge.mjs live) on 127.0.0.1.
//   node live-hook.mjs [--host <host>] [<hook event name>]
// It reads the hook payload on stdin. A host whose payload has no event name gives the name as an argument.
// It prints nothing, it always exits with 0, and it stops by its own timer, so it cannot change or hold a session.
// When no live server runs (no state file in the forge data folder), it stops before it reads the payload.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { dataDir } from './lib/data-dir.mjs';
import { LIVE_FILE, LIVE_HOSTS, MAX_EVENT, normalize } from './lib/live-event.mjs';

const LIMIT_MS = 400;
const MAX_PAYLOAD = 4 * 1024 * 1024;
const done = () => process.exit(0);

function target() {
  try {
    const state = JSON.parse(readFileSync(path.join(dataDir(), LIVE_FILE), 'utf8'));
    const ok = state && Number.isInteger(state.port) && state.port > 0 && state.port < 65536 && /^[0-9a-f]{32}$/.test(state.token ?? '');
    return ok ? state : null;
  } catch { return null; }
}

function main() {
  const server = target();
  if (!server) return done();
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
