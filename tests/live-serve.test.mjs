// The live server and its reporter: the request checks, the events, the held page request, the pages, and the state file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BOARD_SCRIPT } from '../plugins/forge/scripts/lib/board-page.mjs';
import { CANVAS_SCRIPT } from '../plugins/forge/scripts/lib/canvas-page.mjs';
import { liveFile, liveStatus, serveLive } from '../plugins/forge/scripts/lib/live-serve.mjs';

const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const reporter = fileURLToPath(new URL('../plugins/forge/scripts/live-hook.mjs', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));
const hash = (script) => createHash('sha256').update(script).digest('base64');

function wiki(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'forge-live-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, text) => {
    const file = path.join(root, 'wiki', ...name.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  const ticket = (key, state, extra = []) => put(`raw/tickets/${key.toLowerCase()}/README.md`, [
    '---', 'type: ticket', `key: ${key}`, `title: Title of ${key}`, `short: Short ${key}`, 'workflow: full-v3', 'phase: plan', `state: ${state}`,
    `next: Next step for ${key}`, 'changes: []', 'people: []', 'gates:', '  - { name: Planned?, doc: plan.md, need: required, status: in-review }', ...extra, 'updated: 2026-11-16', '---', `# ${key}`, '',
  ].join('\n'));
  ticket('APP-9', 'active', ['worktree: /code/app.worktrees/APP-9']);
  ticket('APP-2', 'done');
  put('raw/tickets/app-9/story.md', '---\ntype: story\n---\n# Story APP-9\n\nProblem: retries stop after 3 s.\n');
  put('raw/tickets/app-9/page.html', '<p>not a ticket file</p>\n');
  return { root, wiki: path.join(root, 'wiki'), env: { ...process.env, FORGE_DATA_DIR: path.join(root, 'data') } };
}

// One live server in this process. It stops at the end of the test.
async function start(t, options = {}) {
  const f = wiki(t);
  const signals = new EventEmitter();
  let text = '';
  let note = '';
  const done = serveLive(f.wiki, { port: 0, env: f.env, signals, holdMs: 400, out: { write: (chunk) => { text += chunk; } }, err: { write: (chunk) => { note += chunk; } }, ...options });
  let stopped = false;
  const stop = async (signal = 'SIGTERM') => { if (!stopped) { stopped = true; signals.emit(signal); } return done; };
  t.after(() => stop());
  for (let tries = 0; tries < 200 && !text.includes('\n'); tries++) await new Promise((resolve) => { setTimeout(resolve, 10); });
  const [, port, page] = /^live: serving http:\/\/127\.0\.0\.1:(\d+)\/board\?t=([0-9a-f]{32})\n/.exec(text);
  const state = JSON.parse(readFileSync(liveFile(f.env), 'utf8'));
  return { ...f, port: Number(port), page, event: state.token, state, stop, done, text: () => text, note: () => note };
}

function request(port, { method = 'GET', url = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { ...(body === undefined ? {} : { 'Content-Length': Buffer.byteLength(body) }), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const post = (s, event, headers = {}) => request(s.port, {
  method: 'POST', url: '/event', body: typeof event === 'string' ? event : JSON.stringify(event),
  headers: { 'Content-Type': 'application/json', 'X-Forge-Token': s.event, ...headers },
});
let clock = 1000;
const ev = (event, extra = {}) => ({ v: 1, host: 'claude', event, ts: (clock += 10), session: 'S1', cwd: '/code/app', ...extra });
const live = async (s, query = '') => JSON.parse((await request(s.port, { url: `/live?t=${s.page}${query}` })).text);

test('the server starts on 127.0.0.1 with two tokens and a state file that only the user can read', async (t) => {
  const s = await start(t);
  assert.match(s.text(), /^live: serving http:\/\/127\.0\.0\.1:\d+\/board\?t=[0-9a-f]{32}\n {2}state .+live\.json\n$/);
  assert.deepEqual(Object.keys(s.state).sort(), ['page', 'pid', 'port', 'token', 'v', 'wiki']);
  assert.equal(s.state.page, s.page);
  assert.notEqual(s.event, s.page, 'the token of a page cannot send an event');
  assert.equal(s.state.port, s.port);
  if (process.platform !== 'win32') assert.equal(statSync(liveFile(s.env)).mode & 0o777, 0o600);
  assert.deepEqual(liveStatus(s.env), { pid: process.pid, port: s.port, link: `http://127.0.0.1:${s.port}/board?t=${s.page}`, file: liveFile(s.env) });
  const status = spawnSync(process.execPath, [cli, 'live', '--status'], { encoding: 'utf8', env: s.env, cwd });
  assert.equal(status.status, 0, status.stderr);
  assert.ok(status.stdout.startsWith(`live: serving http://127.0.0.1:${s.port}/board?t=${s.page}\n`));

  assert.equal(await s.stop(), 143);
  assert.ok(!existsSync(liveFile(s.env)), 'the state file goes away with the server');
  assert.equal(liveStatus(s.env), null);
  assert.match(s.note(), /the live server stopped/);
  const none = spawnSync(process.execPath, [cli, 'live', '--status'], { encoding: 'utf8', env: s.env, cwd });
  assert.equal(none.status, 1);
  assert.match(none.stdout, /no server runs/);
});

test('the server refuses each request without the right token, and a page cannot send an event', async (t) => {
  const s = await start(t);
  const event = ev('prompt', { text: 'hello' });
  assert.equal((await request(s.port, { url: '/board' })).status, 403);
  assert.equal((await request(s.port, { url: `/board?t=${s.event}` })).status, 403, 'the event token opens no page');
  assert.equal((await request(s.port, { url: `/board?t=${s.page}`, headers: { Host: 'evil.test' } })).status, 403);
  assert.equal((await request(s.port, { method: 'PUT', url: `/board?t=${s.page}` })).status, 405);
  assert.equal((await post(s, event, { 'X-Forge-Token': s.page })).status, 403, 'the page token sends no event');
  assert.equal((await post(s, event, { 'X-Forge-Token': '' })).status, 403);
  // A browser adds Origin or Sec-Fetch-Site to the request of a page. The reporter sends none of them.
  assert.equal((await post(s, event, { Origin: `http://127.0.0.1:${s.port}` })).status, 403);
  assert.equal((await post(s, event, { 'Sec-Fetch-Site': 'same-origin' })).status, 403);
  assert.equal((await post(s, event, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post(s, '{not json')).status, 400);
  assert.equal((await post(s, { ...event, event: 'send' })).status, 400);
  assert.equal((await post(s, JSON.stringify({ ...event, text: 'x'.repeat(20000) }))).status, 413);
  assert.deepEqual((await live(s)).sessions, [], 'a refused request changes nothing');

  // The server is read-only for a session: the only route that takes data is /event.
  for (const url of ['/send', '/live', '/board', '/', '/message', '/ticket/app-9/send']) {
    const res = await request(s.port, { method: 'POST', url, body: '{}', headers: { 'Content-Type': 'application/json', 'X-Forge-Token': s.event } });
    assert.equal(res.status, 404, url);
  }
  const ok = await post(s, event);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers['access-control-allow-origin'], undefined);
  assert.equal(ok.headers['cache-control'], 'no-store');
});

test('a page request for the state waits until an event comes, or until the time limit', async (t) => {
  const s = await start(t);
  const first = await live(s);
  assert.deepEqual([first.sessions, first.detail], [[], undefined]);
  assert.ok(Math.abs(first.now - Date.now()) < 5000);

  const before = Date.now();
  const held = live(s, `&v=${first.v}`);
  await new Promise((resolve) => { setTimeout(resolve, 60); });
  assert.equal((await post(s, ev('prompt', { text: 'run the tests', title: 'APP-9 - ▶️ - Short APP-9' }))).status, 204);
  assert.equal((await post(s, ev('tool-start', { tool: { id: 'T1', name: 'Bash', label: 'npm test' } }))).status, 204);
  const next = await held;
  assert.ok(Date.now() - before < 350, 'the answer comes with the event, before the time limit');
  assert.ok(next.v > first.v);
  assert.deepEqual(next.sessions.map((item) => [item.id, item.host, item.title, item.ticket, item.state, item.dir]), [['s1', 'claude', 'APP-9 - ▶️ - Short APP-9', 'app-9', 'working', 'app']]);
  assert.doesNotMatch(JSON.stringify(next), /"S1"|\/code\/app/, 'the session id and the full folder stay in the server');

  // Without a new event, the answer comes at the time limit with the same version.
  const now = await live(s);
  const wait = Date.now();
  const same = await live(s, `&v=${now.v}`);
  assert.ok(Date.now() - wait >= 350, 'the server held the request');
  assert.equal(same.v, now.v);
  assert.deepEqual(same.sessions[0].now.label, 'npm test');

  // The detail comes only for the ticket that the page names, and only for a ticket of the board.
  const detail = await live(s, '&ticket=app-9');
  assert.deepEqual(detail.detail.map((item) => [item.id, item.prompt, item.items.map((row) => row.name)]), [['s1', 'run the tests', ['Bash']]]);
  assert.deepEqual((await live(s, '&ticket=app-2')).detail, []);
  assert.equal((await live(s, '&ticket=nope')).detail, undefined);
  const res = await request(s.port, { url: `/live?t=${s.page}` });
  assert.match(res.headers['content-type'], /^application\/json/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('the pages of the live server: the board and each canvas with the live part, and no page that can send', async (t) => {
  const s = await start(t);
  const root = await request(s.port, { url: `/?t=${s.page}` });
  assert.deepEqual([root.status, root.headers.location], [302, `/board?t=${s.page}`]);

  const board = await request(s.port, { url: `/board?t=${s.page}` });
  assert.equal(board.status, 200);
  assert.equal(board.headers['content-security-policy'], `default-src 'none'; script-src 'sha256-${hash(BOARD_SCRIPT)}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'`);
  assert.equal(/<script>([\s\S]*)<\/script>/.exec(board.text)[1], BOARD_SCRIPT);
  assert.ok(board.text.includes(`"live":"/live?t=${s.page}"`));
  assert.match(board.text, /<section class="lane plain" id="live-other" hidden>/);
  assert.match(board.text, /<p class="note" id="live-note">/);
  assert.ok(board.text.includes(`href="/ticket/app-9/?t=${s.page}"`), 'each ticket has its canvas on this server');
  assert.equal(board.text.match(/<script\b/g).length, 2);

  const bare = await request(s.port, { url: `/ticket/app-9?t=${s.page}` });
  assert.deepEqual([bare.status, bare.headers.location], [302, `/ticket/app-9/?t=${s.page}`]);
  const canvas = await request(s.port, { url: `/ticket/app-9/?t=${s.page}` });
  assert.equal(canvas.status, 200);
  assert.equal(canvas.headers['content-security-policy'], `default-src 'none'; script-src 'sha256-${hash(CANVAS_SCRIPT)}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'`);
  assert.equal(/<script>([\s\S]*)<\/script>/.exec(canvas.text)[1], CANVAS_SCRIPT);
  assert.ok(canvas.text.includes(`"live":"/live?t=${s.page}\\u0026ticket=app-9"`) || canvas.text.includes(`"live":"/live?t=${s.page}&ticket=app-9"`));
  for (const id of ['live', 'live-toggle', 'live-close', 'live-hint', 'live-body']) assert.ok(canvas.text.includes(`id="${id}"`), id);
  assert.match(canvas.text, /<button type="button" id="send-all" hidden>/, 'Send to agent stays hidden: the script shows it only without data.live');
  assert.ok(canvas.text.includes(`href="/board?t=${s.page}"`));
  assert.equal(canvas.text.match(/<script\b/g).length, 2);

  const file = await request(s.port, { url: `/ticket/app-9/story.md?t=${s.page}` });
  assert.deepEqual([file.status, file.headers['content-type'], file.headers['content-security-policy']], [200, 'text/plain; charset=utf-8', "default-src 'none'; sandbox"]);
  for (const url of ['/ticket/app-9/page.html', '/ticket/app-9/..%2Fapp-2%2FREADME.md', '/ticket/nope/', '/ticket/..%2F..%2Fx/', '/board.html', '/README.md']) {
    assert.equal((await request(s.port, { url: `${url}?t=${s.page}` })).status, 404, url);
  }
});

test('only one live server runs for a user, and it stops when no event comes for a long time', async (t) => {
  const s = await start(t, { idleMs: 500 });
  await assert.rejects(serveLive(s.wiki, { port: 0, env: { ...s.env }, signals: new EventEmitter(), out: { write() {} }, err: { write() {} } }), /A live server runs already: http:\/\/127\.0\.0\.1:\d+\/board/);
  await new Promise((resolve) => { setTimeout(resolve, 300); });
  assert.equal((await post(s, ev('prompt', { text: 'an event starts the time again' }))).status, 204);
  await new Promise((resolve) => { setTimeout(resolve, 300); });
  assert.ok(existsSync(liveFile(s.env)), 'the server still runs');
  assert.equal(await s.done, 3);
  assert.match(s.note(), /no session sent an event/);
  assert.ok(!existsSync(liveFile(s.env)));
});

function report(env, input, args = ['--host', 'claude']) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [reporter, ...args], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    const began = Date.now();
    child.on('close', (code) => resolve({ code, out, ms: Date.now() - began }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

test('the reporter sends the event of a hook payload to the server, prints nothing, and always exits with 0', async (t) => {
  const s = await start(t);
  const payload = (name, extra) => JSON.stringify({ hook_event_name: name, session_id: 'S7', cwd: '/code/app.worktrees/APP-9/src', transcript_path: '/home/u/x.jsonl', ...extra });
  const sent = await report(s.env, payload('PreToolUse', { tool_name: 'Bash', tool_use_id: 'T1', tool_input: { command: 'npm test' }, tool_response: 'NEVER' }));
  assert.deepEqual([sent.code, sent.out], [0, '']);
  const state = await live(s, '&ticket=app-9');
  assert.deepEqual(state.sessions.map((item) => [item.ticket, item.state, item.now?.label]), [['app-9', 'working', 'npm test']], 'the session folder is inside the worktree of the ticket');
  assert.doesNotMatch(JSON.stringify(state), /NEVER|transcript/);
  // The Copilot hosts give the event name as an argument.
  assert.deepEqual(await report(s.env, JSON.stringify({ sessionId: 'C1', cwd: '/x', toolName: 'bash', toolArgs: '{"command":"ls"}' }), ['--host', 'copilot-cli', 'postToolUse']).then((r) => [r.code, r.out]), [0, '']);
  assert.deepEqual((await live(s)).sessions.map((item) => item.host), ['claude', 'copilot-cli']);

  // A payload that gives no event, and a server that is gone: no output, exit 0, and no long wait.
  for (const input of ['', '{not json', '[]', payload('MessageDisplay', { delta: 'x' }), JSON.stringify({ hook_event_name: 'Stop' })]) {
    assert.deepEqual(await report(s.env, input).then((r) => [r.code, r.out]), [0, ''], input);
  }
  assert.equal((await live(s)).sessions.length, 2);
  await s.stop();
  const none = await report(s.env, payload('Stop', {}));
  assert.deepEqual([none.code, none.out], [0, ''], 'no state file: the reporter stops at once');
  mkdirSync(path.dirname(liveFile(s.env)), { recursive: true });
  writeFileSync(liveFile(s.env), JSON.stringify({ v: 1, pid: 1, port: s.port, token: 'b'.repeat(32), page: 'c'.repeat(32) }));
  const gone = await report(s.env, payload('Stop', {}));
  assert.deepEqual([gone.code, gone.out], [0, ''], 'an old state file and no server');
  writeFileSync(liveFile(s.env), '{"port":"x"}');
  assert.deepEqual(await report(s.env, payload('Stop', {})).then((r) => [r.code, r.out]), [0, '']);
});

test('the live command refuses wrong arguments', () => {
  for (const args of [['live', 'extra'], ['live', '--port', '80'], ['live', '--port', 'x'], ['live', '--json'], ['live', '--links', 'web'], ['live', '--status', '--port', '0']]) {
    const result = spawnSync(process.execPath, [cli, ...args, '--cwd', cwd], { encoding: 'utf8', env: { ...process.env, FORGE_DATA_DIR: path.join(os.tmpdir(), 'forge-live-none') } });
    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, /Usage: forge\.mjs live/);
  }
});
