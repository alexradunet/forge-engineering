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
import { pickServer } from '../plugins/forge/scripts/lib/live-event.mjs';
import { rawDir } from '../plugins/forge/scripts/lib/layout.mjs';
import { RESUME_GAP_MS, liveFile, liveList, liveRoots, liveStatus, serveLive } from '../plugins/forge/scripts/lib/live-serve.mjs';
import { readSessions, recordEnd, recordStart, sessionsFile } from '../plugins/forge/scripts/lib/sessions.mjs';
import { browserCommand, openBrowser } from '../plugins/forge/scripts/lib/open.mjs';
import { MERMAID_INTEGRITY, MERMAID_ROUTE, mermaidPath } from '../plugins/forge/scripts/lib/mermaid.mjs';
import { WIKI_SCRIPT } from '../plugins/forge/scripts/lib/wiki-page.mjs';

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
  put('tooling/build.md', '---\ntitle: Build\nupdated: 2026-11-10\nstatus: verified\n---\n# Build\n\nThe build uses npm.\n');
  put('tickets/app-1.md', '---\ntitle: "APP-1: First fix"\nupdated: 2026-11-01\nstatus: verified\n---\n# APP-1: First fix\n\nSee [build](../tooling/build.md).\n');
  put('raw/tickets/app-9/plan.md', '---\ntype: plan\n---\n# Plan APP-9\n\nCause: see [the build page](../../../tooling/build.md).\n');
  return { root, wiki: path.join(root, 'wiki'), env: { ...process.env, FORGE_DATA_DIR: path.join(root, 'data') } };
}

// One live server in this process. It stops at the end of the test.
async function start(t, options = {}) {
  const f = wiki(t);
  const signals = new EventEmitter();
  let text = '';
  let note = '';
  const done = serveLive(f.wiki, { port: 0, repo: '/code/app', env: f.env, signals, holdMs: 400, out: { write: (chunk) => { text += chunk; } }, err: { write: (chunk) => { note += chunk; } }, ...options });
  let stopped = false;
  const stop = async (signal = 'SIGTERM') => { if (!stopped) { stopped = true; signals.emit(signal); } return done; };
  t.after(() => stop());
  for (let tries = 0; tries < 200 && !text.includes('\n'); tries++) await new Promise((resolve) => { setTimeout(resolve, 10); });
  const [, port, page] = /^live: serving http:\/\/127\.0\.0\.1:(\d+)\/board\?t=([0-9a-f]{32})\n/.exec(text);
  const state = JSON.parse(readFileSync(liveFile(f.env, f.wiki), 'utf8'));
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
  assert.match(s.text(), /^live: serving http:\/\/127\.0\.0\.1:\d+\/board\?t=[0-9a-f]{32}\n {2}wiki {2}http:\/\/127\.0\.0\.1:\d+\/wiki\?t=[0-9a-f]{32}\n {2}state .+live[\\/][0-9a-f]{16}\.json\n$/);
  // Forge 8.4: one state file for each repository, with the folders that the reporter compares with the folder of a session.
  assert.deepEqual(Object.keys(s.state).sort(), ['home', 'page', 'pid', 'port', 'repo', 'roots', 'token', 'v', 'wiki']);
  assert.deepEqual([s.state.v, s.state.home, s.state.repo, s.state.roots], [2, s.wiki, '/code/app', ['/code/app', '/code/app.worktrees', s.wiki]]);
  assert.equal(s.state.page, s.page);
  assert.notEqual(s.event, s.page, 'the token of a page cannot send an event');
  assert.equal(s.state.port, s.port);
  if (process.platform !== 'win32') assert.equal(statSync(liveFile(s.env, s.wiki)).mode & 0o777, 0o600);
  assert.deepEqual(liveStatus(s.env, s.wiki), {
    pid: process.pid, port: s.port, link: `http://127.0.0.1:${s.port}/board?t=${s.page}`, wikiLink: `http://127.0.0.1:${s.port}/wiki?t=${s.page}`,
    file: liveFile(s.env, s.wiki), home: s.wiki, repo: '/code/app',
  });
  assert.equal(liveStatus(s.env, path.join(s.root, 'other')), null, 'another repository has no server');
  const status = spawnSync(process.execPath, [cli, 'live', '--status', '--cwd', cwd, '--wiki', s.wiki], { encoding: 'utf8', env: s.env });
  assert.equal(status.status, 0, status.stderr);
  assert.ok(status.stdout.startsWith(`live: serving http://127.0.0.1:${s.port}/board?t=${s.page}\n`));

  assert.equal(await s.stop(), 143);
  assert.ok(!existsSync(liveFile(s.env, s.wiki)), 'the state file goes away with the server');
  assert.equal(liveStatus(s.env, s.wiki), null);
  assert.match(s.note(), /the live server stopped/);
  const none = spawnSync(process.execPath, [cli, 'live', '--status', '--cwd', cwd, '--wiki', s.wiki], { encoding: 'utf8', env: s.env });
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

  // The server gives no text to a session: the only route that takes an event is /event. POST /resume has its own test.
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
  assert.ok(board.text.includes(`"live":"/live?t=${s.page}","resume":"/resume"`));
  assert.match(board.text, /<section class="lane plain" id="live-other" hidden>/);
  assert.match(board.text, /<ul class="rows" id="live-list"><\/ul><ul class="rows" id="past-list"><\/ul>/);
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
  for (const id of ['live', 'live-toggle', 'live-close', 'live-hint', 'live-body', 'live-past']) assert.ok(canvas.text.includes(`id="${id}"`), id);
  assert.ok(canvas.text.includes('"resume":"/resume"'));
  assert.match(canvas.text, /<button type="button" id="send-all" hidden>/, 'Send to agent stays hidden: the script shows it only without data.live');
  assert.ok(canvas.text.includes(`href="/board?t=${s.page}"`));
  assert.equal(canvas.text.match(/<script\b/g).length, 2);

  const file = await request(s.port, { url: `/ticket/app-9/story.md?t=${s.page}` });
  assert.deepEqual([file.status, file.headers['content-type'], file.headers['content-security-policy']], [200, 'text/plain; charset=utf-8', "default-src 'none'; sandbox"]);
  // The wiki page: each canonical page, and the closed tickets. The board and the canvas have the links to it.
  const wikiPage = await request(s.port, { url: `/wiki?t=${s.page}` });
  assert.equal(wikiPage.status, 200);
  assert.equal(wikiPage.headers['content-security-policy'], `default-src 'none'; script-src 'sha256-${hash(WIKI_SCRIPT)}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'`);
  assert.equal(/<script>([\s\S]*)<\/script>/.exec(wikiPage.text)[1], WIKI_SCRIPT);
  assert.match(wikiPage.text, /The build uses npm\./);
  assert.ok(wikiPage.text.includes(`<a href="/ticket/app-9/?t=${s.page}" data-nav><span class="key">APP-9</span>`), 'a page names the open ticket that uses it');
  assert.ok(wikiPage.text.includes(`href="/board?t=${s.page}"`) && !wikiPage.text.includes('"live"'));
  assert.ok(board.text.includes(`<a class="quiet" href="/wiki?t=${s.page}" data-nav`));
  assert.ok(board.text.includes(`<a class="open" href="/wiki?t=${s.page}#tickets/app-1.md" data-nav title="First fix">`), 'a closed ticket opens its summary page');
  assert.ok(canvas.text.includes(`<a href="/wiki?t=${s.page}#tooling/build.md" data-nav>the build page</a>`), 'a link of a ticket document opens the wiki page');
  assert.ok(canvas.text.includes('id="wiki-refs"'));
  assert.equal((await request(s.port, { url: '/wiki' })).status, 403);
  for (const url of ['/ticket/app-9/page.html', '/ticket/app-9/..%2Fapp-2%2FREADME.md', '/ticket/nope/', '/ticket/..%2F..%2Fx/', '/board.html', '/README.md', '/wiki/', '/wiki/tooling/build.md', '/tooling/build.md']) {
    assert.equal((await request(s.port, { url: `${url}?t=${s.page}` })).status, 404, url);
  }
});

test('the wiki page of a wiki with a Mermaid block can load the Mermaid file of this server, and no other script', async (t) => {
  const s = await start(t);
  // Without a diagram block, the policy names only the page script (the test of the pages checks the whole header).
  mkdirSync(path.join(s.wiki, 'app'), { recursive: true });
  writeFileSync(path.join(s.wiki, 'app', 'flow.md'), '---\ntitle: Flow\nupdated: 2026-11-10\nstatus: verified\n---\n# Flow\n\n```mermaid\nflowchart LR\n  A --> B\n```\n');
  const page = await request(s.port, { url: `/wiki?t=${s.page}` });
  assert.equal(page.headers['content-security-policy'], `default-src 'none'; script-src 'sha256-${hash(WIKI_SCRIPT)}' 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'`);
  assert.ok(page.text.includes(`"mermaid":{"src":"${MERMAID_ROUTE}?t=${s.page}","integrity":"${MERMAID_INTEGRITY}"}`));
  const file = await request(s.port, { url: `${MERMAID_ROUTE}?t=${s.page}` });
  assert.deepEqual([file.status, file.headers['content-type'], file.headers['x-content-type-options'], file.headers['cache-control']], [200, 'text/javascript; charset=utf-8', 'nosniff', 'private, max-age=86400']);
  assert.equal(Number(file.headers['content-length']), readFileSync(mermaidPath()).length);
  assert.equal(file.text, readFileSync(mermaidPath(), 'utf8'));
  assert.equal((await request(s.port, { url: MERMAID_ROUTE })).status, 403, 'the file needs the page token');
  // A canvas with a Mermaid block in a card gets the same file and the same policy. A canvas without one keeps the policy of the page script alone.
  writeFileSync(path.join(s.wiki, 'raw', 'tickets', 'app-9', 'story.md'), '---\ntype: story\n---\n# Story APP-9\n\nProblem: retries stop.\n\n## Flow\n\n```mermaid\nflowchart LR\n  A --> B\n```\n');
  const canvas = await request(s.port, { url: `/ticket/app-9/?t=${s.page}` });
  assert.equal(canvas.headers['content-security-policy'], `default-src 'none'; script-src 'sha256-${hash(CANVAS_SCRIPT)}' 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'`);
  assert.ok(canvas.text.includes(`"mermaid":{"src":"${MERMAID_ROUTE}?t=${s.page}","integrity":"${MERMAID_INTEGRITY}"}`));
  const other = await request(s.port, { url: `/ticket/app-2/?t=${s.page}` });
  assert.ok(!other.headers['content-security-policy'].includes("' 'self'; style-src") && !other.text.includes('"mermaid":{'));
  assert.equal((await request(s.port, { url: `${MERMAID_ROUTE}?t=${s.event}` })).status, 403);
  for (const url of ['/vendor/', '/vendor/LICENSE', '/vendor/NOTICE.md', '/vendor/../forge.mjs', '/vendor/mermaid.tiny.js/x']) {
    assert.equal((await request(s.port, { url: `${url}?t=${s.page}` })).status, 404, url);
  }
});

test('only one live server runs for a repository, and it stops when no event comes for a long time', async (t) => {
  const s = await start(t, { idleMs: 500 });
  await assert.rejects(serveLive(s.wiki, { port: 0, env: { ...s.env }, signals: new EventEmitter(), out: { write() {} }, err: { write() {} } }), /A live server runs already for this repository: http:\/\/127\.0\.0\.1:\d+\/board/);
  await new Promise((resolve) => { setTimeout(resolve, 300); });
  assert.equal((await post(s, ev('prompt', { text: 'an event starts the time again' }))).status, 204);
  await new Promise((resolve) => { setTimeout(resolve, 300); });
  assert.ok(existsSync(liveFile(s.env, s.wiki)), 'the server still runs');
  assert.equal(await s.done, 3);
  assert.match(s.note(), /no session sent an event/);
  assert.ok(!existsSync(liveFile(s.env, s.wiki)));
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
  assert.deepEqual(await report(s.env, JSON.stringify({ sessionId: 'C1', cwd: '/code/app/src', toolName: 'bash', toolArgs: '{"command":"ls"}' }), ['--host', 'copilot-cli', 'postToolUse']).then((r) => [r.code, r.out]), [0, '']);
  assert.deepEqual((await live(s)).sessions.map((item) => item.host), ['claude', 'copilot-cli']);

  // A payload that gives no event, and a server that is gone: no output, exit 0, and no long wait.
  for (const input of ['', '{not json', '[]', payload('MessageDisplay', { delta: 'x' }), JSON.stringify({ hook_event_name: 'Stop' })]) {
    assert.deepEqual(await report(s.env, input).then((r) => [r.code, r.out]), [0, ''], input);
  }
  assert.equal((await live(s)).sessions.length, 2);
  // A session outside of the repository of each server sends nothing.
  assert.deepEqual(await report(s.env, JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'S8', cwd: '/code/other', prompt: 'x' })).then((r) => [r.code, r.out]), [0, '']);
  assert.deepEqual(await report(s.env, JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'S9', cwd: '/code/app.wiki', prompt: 'x' })).then((r) => [r.code, r.out]), [0, '']);
  assert.equal((await live(s)).sessions.length, 2, 'a folder with the same first letters is not inside the repository');
  await s.stop();
  const none = await report(s.env, payload('Stop', {}));
  assert.deepEqual([none.code, none.out], [0, ''], 'no state file: the reporter stops at once');
  mkdirSync(path.dirname(liveFile(s.env, s.wiki)), { recursive: true });
  writeFileSync(liveFile(s.env, s.wiki), JSON.stringify({ v: 2, pid: 1, port: s.port, token: 'b'.repeat(32), page: 'c'.repeat(32), roots: ['/code/app.worktrees'] }));
  const gone = await report(s.env, payload('Stop', {}));
  assert.deepEqual([gone.code, gone.out], [0, ''], 'an old state file and no server');
  writeFileSync(liveFile(s.env, s.wiki), '{"port":"x"}');
  assert.deepEqual(await report(s.env, payload('Stop', {})).then((r) => [r.code, r.out]), [0, '']);
});

test('two repositories have their servers at the same time, and each session reports to the server of its repository', async (t) => {
  const a = await start(t);
  // The second server: another wiki and another repository, with the same data folder of the user.
  const wikiB = path.join(a.root, 'other.wiki');
  mkdirSync(wikiB, { recursive: true });
  const signals = new EventEmitter();
  let text = '';
  const done = serveLive(wikiB, { port: 0, repo: '/code/other', env: a.env, signals, holdMs: 400, out: { write: (chunk) => { text += chunk; } }, err: { write() {} } });
  t.after(async () => { signals.emit('SIGTERM'); await done; });
  for (let tries = 0; tries < 200 && !text.includes('\n'); tries++) await new Promise((resolve) => { setTimeout(resolve, 10); });
  const [, portB, pageB] = /^live: serving http:\/\/127\.0\.0\.1:(\d+)\/board\?t=([0-9a-f]{32})\n/.exec(text);
  assert.notEqual(Number(portB), a.port);
  assert.notEqual(liveFile(a.env, wikiB), liveFile(a.env, a.wiki));
  assert.deepEqual(liveList(a.env).map((server) => [server.home, server.port]).sort(), [[a.wiki, a.port], [wikiB, Number(portB)]].sort());
  const list = spawnSync(process.execPath, [cli, 'open', '--list'], { encoding: 'utf8', env: a.env, cwd: os.tmpdir() });
  assert.equal(list.status, 0, list.stderr);
  assert.ok(list.stdout.includes(`${a.wiki}\n  board http://127.0.0.1:${a.port}/board?t=${a.page}\n`) && list.stdout.includes(`${wikiB}\n  board http://127.0.0.1:${portB}/board?t=${pageB}\n`));

  const prompt = (session, folder) => JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: session, cwd: folder, prompt: 'go' });
  for (const [session, folder] of [['A1', '/code/app'], ['B1', '/code/other/src'], ['B2', '/code/other.worktrees/X-1'], ['N1', '/code']]) {
    assert.deepEqual(await report(a.env, prompt(session, folder)).then((r) => [r.code, r.out]), [0, ''], folder);
  }
  const sessionsB = JSON.parse((await request(Number(portB), { url: `/live?t=${pageB}` })).text).sessions.map((item) => item.dir).sort();
  assert.deepEqual((await live(a)).sessions.map((item) => item.dir), ['app']);
  assert.deepEqual(sessionsB, ['X-1', 'src'], 'a session in a worktree of the repository reports to the server of that repository');
});

test('the reporter selects the server with the longest folder that holds the folder of the session', () => {
  const app = { port: 1, roots: ['/code/app', '/code/app.worktrees', '/code/app.forge'] };
  const tool = { port: 2, roots: ['/code/app/tools/inner', '/odd/place/T-1'] };
  assert.equal(pickServer([app, tool], '/code/app'), app);
  assert.equal(pickServer([app, tool], '/code/app/src/x'), app);
  assert.equal(pickServer([app, tool], '/code/app/tools/inner/src'), tool, 'the longest root wins');
  assert.equal(pickServer([tool, app], '/code/app.worktrees/APP-9/'), app);
  assert.equal(pickServer([app, tool], '/odd/place/T-1'), tool, 'a ticket worktree outside of the usual folders');
  for (const folder of ['/code/application', '/code', '/', '', undefined, '/odd/place']) assert.equal(pickServer([app, tool], folder), null, String(folder));
  assert.equal(pickServer([{ port: 3 }, { roots: 'x' }, null], '/code/app'), null, 'a state without folders gets no event');
  // Windows: the other separator, and no difference between capital and small letters.
  const win = { port: 4, roots: ['C:\\Code\\App', 'C:\\Code\\App.worktrees'] };
  assert.equal(pickServer([win], 'c:\\code\\app\\src', true), win);
  assert.equal(pickServer([win], 'c:\\code\\app\\src', false), null);
  assert.deepEqual(liveRoots('/w/app.forge', '/w/app', [{ worktree: '/w/app.worktrees/A-1' }, { worktree: '/far/A-2' }, { worktree: '' }]), ['/w/app', '/w/app.worktrees', '/w/app.forge', '/far/A-2']);
  assert.deepEqual(liveRoots('/w/app.wiki', ''), ['/w/app.wiki'], 'without the repository, only a session in the Forge folder reports');
});

test('forge.mjs open starts the server of a repository in the background, gives its links, and stops it', { skip: process.platform === 'win32' }, async (t) => {
  const f = wiki(t);
  const run = (...args) => spawnSync(process.execPath, [cli, 'open', ...args, '--cwd', cwd, '--wiki', f.wiki], { encoding: 'utf8', env: f.env, timeout: 20000 });
  t.after(() => { run('--stop'); });
  assert.deepEqual([run('--status').status, run('--status').stdout], [1, 'forge: no server runs for this repository. Start it with: forge.mjs open\n']);
  const first = run('--no-browser', '--port', '0');
  assert.equal(first.status, 0, first.stderr);
  const [, port, page] = /^forge: serving http:\/\/127\.0\.0\.1:(\d+)\/board\?t=([0-9a-f]{32})\n {2}wiki {3}http:\/\/127\.0\.0\.1:\d+\/wiki\?t=[0-9a-f]{32}\n {2}folder .+\n {2}The server runs in the background\. To stop it: forge\.mjs open --stop\n$/.exec(first.stdout);
  const board = await request(Number(port), { url: `/board?t=${page}` });
  assert.equal(board.status, 200, 'the server runs on after the command ended');
  // A second call starts no second server: it gives the same links.
  const again = run('--no-browser');
  assert.equal(again.status, 0, again.stderr);
  assert.ok(again.stdout.startsWith(`forge: serving http://127.0.0.1:${port}/board?t=${page}\n`) && !again.stdout.includes('in the background'));
  assert.ok(run('--status').stdout.startsWith(`forge: serving http://127.0.0.1:${port}/board?t=${page}\n`));
  const stopped = run('--stop');
  assert.deepEqual([stopped.status, /^forge: stopped the live server of this repository \(process \d+\)\.\n$/.test(stopped.stdout)], [0, true]);
  assert.equal(liveStatus(f.env, f.wiki), null);
  assert.equal(run('--stop').stdout, 'forge: no server runs for this repository.\n');
  for (const args of [['extra'], ['--port', '80'], ['--json'], ['--links', 'web'], ['--status', '--stop'], ['--list', '--port', '0']]) {
    const result = run(...args);
    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, /Usage: forge\.mjs open/);
  }
});

test('the browser command of each platform gets only the link, and a missing command is not an error', async () => {
  const link = 'http://127.0.0.1:41000/board?t=' + 'a'.repeat(32);
  assert.deepEqual(browserCommand(link, 'linux'), { command: 'xdg-open', args: [link] });
  assert.deepEqual(browserCommand(link, 'darwin'), { command: 'open', args: [link] });
  assert.deepEqual(browserCommand(link, 'win32'), { command: 'cmd', args: ['/c', 'start', '', link] });
  const calls = [];
  const fake = (state) => (command, args, options) => {
    calls.push([command, args, options.detached, options.stdio]);
    const child = new EventEmitter();
    child.unref = () => {};
    setImmediate(() => child.emit(state, new Error('ENOENT')));
    return child;
  };
  assert.equal(await openBrowser(link, { platform: 'linux', spawnFn: fake('spawn') }), true);
  assert.equal(await openBrowser(link, { platform: 'linux', spawnFn: fake('error') }), false);
  assert.equal(await openBrowser(link, { platform: 'linux', spawnFn: () => { throw new Error('no'); } }), false);
  assert.deepEqual(calls[0], ['xdg-open', [link], true, 'ignore']);
});

test('the live command refuses wrong arguments', () => {
  for (const args of [['live', 'extra'], ['live', '--port', '80'], ['live', '--port', 'x'], ['live', '--json'], ['live', '--links', 'web'], ['live', '--status', '--port', '0']]) {
    const result = spawnSync(process.execPath, [cli, ...args, '--cwd', cwd], { encoding: 'utf8', env: { ...process.env, FORGE_DATA_DIR: path.join(os.tmpdir(), 'forge-live-none') } });
    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, /Usage: forge\.mjs live/);
  }
});

const UUID_A = '11111111-2222-4333-8444-555555555555';
const UUID_B = '99999999-2222-4333-8444-555555555555';

test('the server gives the pages the sessions of the session list that are not live, and it keeps that list complete', async (t) => {
  const s = await start(t);
  const raw = rawDir(s.wiki);
  assert.deepEqual((await live(s)).past, []);
  const now = Date.now();
  recordStart(raw, { host: 'copilot-cli', id: 'cp-1', cwd: '/code/app.worktrees/APP-9', prompt: 'Fix the retry' }, now - 60000);
  recordEnd(raw, { host: 'copilot-cli', id: 'cp-1', cwd: '/code/app.worktrees/APP-9', reason: 'user_exit' }, now - 30000);
  recordStart(raw, { host: 'copilot-cli', id: 'cp-2', cwd: '/code/app' }, now - 20000);
  const state = await live(s);
  assert.deepEqual(state.past, [
    { id: 'cp-2', host: 'copilot-cli', name: 'Copilot CLI', label: 'app', dir: 'app', ticket: '', state: 'open', at: now - 20000, command: 'cd "/code/app"; copilot --resume=cp-2' },
    { id: 'cp-1', host: 'copilot-cli', name: 'Copilot CLI', label: 'Fix the retry', dir: 'APP-9', ticket: 'app-9', state: 'closed', at: now - 30000, command: 'cd "/code/app.worktrees/APP-9"; copilot --resume=cp-1' },
  ]);
  assert.deepEqual((await live(s, '&ticket=app-9')).past.map((item) => item.id), ['cp-1'], 'a canvas gets the sessions of its ticket');

  // A live session with the id of a harness gets a line when the list has none: its hooks can be older than this version.
  const at = Date.now();
  const event = (name, extra = {}) => ({ v: 1, host: 'claude', event: name, ts: at + (clock += 10), session: UUID_A, cwd: '/code/app.worktrees/APP-9', ...extra });
  assert.equal((await post(s, event('prompt', { text: 'Add a test for token=abc123XYZ' }))).status, 204);
  let record = readSessions(raw).get(UUID_A);
  assert.deepEqual([record.host, record.cwd, record.label, record.end], ['claude', '/code/app.worktrees/APP-9', 'Add a test for token=***', 0]);
  let now2 = await live(s);
  assert.deepEqual(now2.sessions.map((item) => [item.state, item.ticket]), [['working', 'app-9']]);
  assert.ok(!now2.past.some((item) => item.id === UUID_A), 'a live session is not a row of the list');
  // A new title of the session goes to the list. A second prompt changes nothing.
  await post(s, event('prompt', { text: 'Second prompt', title: 'APP-9 - ▶️ - Short APP-9' }));
  record = readSessions(raw).get(UUID_A);
  assert.deepEqual([record.title, record.label], ['APP-9 - ▶️ - Short APP-9', 'Add a test for token=***']);
  const size = readFileSync(sessionsFile(raw), 'utf8').split('\n').length;
  await post(s, event('tool-start', { tool: { id: 't1', name: 'Bash', label: 'npm test' }, title: 'APP-9 - ▶️ - Short APP-9' }));
  await post(s, event('tool-start', { tool: { id: 't2', name: 'Read', label: 'a.js' }, agent: { id: 'a1', type: 'Explore' } }));
  assert.equal(readFileSync(sessionsFile(raw), 'utf8').split('\n').length, size, 'a tool call writes no line');
  // The end event closes the record when the end hook wrote no line. Then the session shows one time, as a closed row.
  await post(s, event('session-end', { kind: 'prompt_input_exit' }));
  assert.equal(readSessions(raw).get(UUID_A).reason, 'prompt_input_exit');
  now2 = await live(s);
  assert.deepEqual(now2.sessions, []);
  assert.deepEqual(now2.past.map((item) => [item.id, item.state, item.label]).slice(0, 1), [[UUID_A, 'closed', 'APP-9 - ▶️ - Short APP-9']]);
  // A late event of the closed session does not open it again. An event that is clearly later is a session that continues.
  const closedAt = readSessions(raw).get(UUID_A).end;
  await post(s, { v: 1, host: 'claude', event: 'stop', ts: closedAt + 500, session: UUID_A, cwd: '/code/app.worktrees/APP-9' });
  assert.equal(readSessions(raw).get(UUID_A).end, closedAt);
  await post(s, { v: 1, host: 'claude', event: 'prompt', ts: closedAt + 60000, session: UUID_A, cwd: '/code/app.worktrees/APP-9', text: 'Go on' });
  assert.equal(readSessions(raw).get(UUID_A).end, 0, 'the session continues, also when its start hook wrote no line');
  assert.ok(!(await live(s)).past.some((item) => item.id === UUID_A));
  // A session with another id shape (a test id, another host version) writes nothing.
  await post(s, ev('prompt', { text: 'hello' }));
  await post(s, { ...ev('prompt', { text: 'hello' }), host: 'vscode', session: UUID_B });
  assert.ok(!readSessions(raw).has('S1') && !readSessions(raw).has(UUID_B));
});

test('POST /resume opens a terminal for one session of the list, and only for a request of a page of this server', async (t) => {
  const calls = [];
  let answer = { ok: true, how: 'test' };
  const s = await start(t, { openTerminalFn: async (spec, options) => { calls.push({ spec, env: options.env }); return answer; } });
  const raw = rawDir(s.wiki);
  const now = Date.now();
  // The folder of the first session is a folder of this repository that exists: the wiki folder is one of the roots.
  recordStart(raw, { host: 'claude', id: UUID_A, cwd: s.wiki, title: 'APP-9 - ▶️ - Short APP-9' }, now - 60000);
  recordEnd(raw, { host: 'claude', id: UUID_A, cwd: s.wiki, reason: 'prompt_input_exit' }, now - 30000);
  recordStart(raw, { host: 'copilot-cli', id: 'cp-gone', cwd: '/code/app.worktrees/removed' }, now - 20000);
  recordStart(raw, { host: 'copilot-cli', id: 'cp-out', cwd: os.tmpdir() }, now - 10000);
  const origin = `http://127.0.0.1:${s.port}`;
  const resume = (body, headers = {}, drop = []) => {
    const all = { 'Content-Type': 'application/json', 'X-Forge-Token': s.page, Origin: origin, ...headers };
    for (const name of drop) delete all[name];
    return request(s.port, { method: 'POST', url: '/resume', body: typeof body === 'string' ? body : JSON.stringify(body), headers: all });
  };

  // Each refused request starts nothing.
  assert.equal((await resume({ id: UUID_A }, { 'X-Forge-Token': s.event })).status, 403, 'the event token starts no terminal');
  assert.equal((await resume({ id: UUID_A }, { 'X-Forge-Token': '' })).status, 403);
  assert.equal((await resume({ id: UUID_A }, {}, ['Origin'])).status, 403, 'a request without the Origin of a page (a script, curl) starts no terminal');
  assert.equal((await resume({ id: UUID_A }, { Origin: 'http://evil.test' })).status, 403);
  assert.equal((await resume({ id: UUID_A }, { Origin: `http://localhost:${s.port}` })).status, 403, 'the Origin is the address of this page');
  assert.equal((await resume({ id: UUID_A }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await resume({ id: UUID_A }, { Host: 'evil.test' })).status, 403);
  assert.equal((await resume({ id: UUID_A }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await resume(JSON.stringify({ id: UUID_A, pad: 'x'.repeat(2000) }))).status, 413);
  assert.equal((await request(s.port, { url: `/resume?t=${s.page}` })).status, 404, 'a link (GET) starts nothing');
  for (const body of ['{not json', '{}', { id: 7 }, { id: '' }, { id: UUID_B }, { id: '--dangerously-skip-permissions' }, { id: 'S1' }, { id: [UUID_A] }]) {
    const res = await resume(body);
    assert.deepEqual([res.status, JSON.parse(res.text).ok], [404, false], JSON.stringify(body));
  }
  assert.deepEqual(calls, []);

  // The page gives only the id. The folder, the command, and the tab title come from the record and the harness table.
  const ok = await resume({ id: UUID_A, cwd: '/tmp', command: 'calc.exe', host: 'copilot-cli' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers['content-type'], /^application\/json/);
  assert.deepEqual(JSON.parse(ok.text), { ok: true, how: 'test', folder: s.wiki });
  assert.deepEqual(calls.map((call) => call.spec), [{ cwd: s.wiki, argv: ['claude', '--resume', UUID_A], title: 'APP-9 Claude Code' }]);
  assert.equal(calls[0].env, s.env);
  // A second click in a short time opens no second terminal on the same session.
  const again = await resume({ id: UUID_A });
  assert.deepEqual([again.status, JSON.parse(again.text).ok], [409, false]);
  assert.match(JSON.parse(again.text).error, /a moment ago/);
  assert.ok(RESUME_GAP_MS >= 10000);
  assert.equal(calls.length, 1);

  // The folder of a session is gone (a removed worktree) or is not a folder of this repository: the terminal opens in a folder of the repository.
  for (const id of ['cp-gone', 'cp-out']) {
    const moved = await resume({ id });
    assert.deepEqual(JSON.parse(moved.text), { ok: true, how: 'test', folder: s.wiki, moved: true }, id);
    assert.deepEqual(calls.at(-1).spec, { cwd: s.wiki, argv: ['copilot', `--resume=${id}`], title: 'Copilot CLI' });
  }

  // No terminal starts on this machine: the page gets the command for the user, and a next click can try again.
  answer = { ok: false };
  recordStart(raw, { host: 'claude', id: UUID_B, cwd: s.wiki }, now - 5000);
  const none = JSON.parse((await resume({ id: UUID_B })).text);
  assert.deepEqual(none, { ok: false, command: `cd "${s.wiki}"; claude --resume ${UUID_B}`, error: 'No terminal started on this machine.' });
  assert.equal(JSON.parse((await resume({ id: UUID_B })).text).command, none.command, 'no wait after a start that failed');

  // A session that is live is open in a terminal: no second terminal.
  answer = { ok: true, how: 'test' };
  const count = calls.length;
  await post(s, { v: 1, host: 'claude', event: 'prompt', ts: Date.now(), session: UUID_B, cwd: s.wiki, text: 'hello' });
  const open = await resume({ id: UUID_B });
  assert.deepEqual([open.status, JSON.parse(open.text).ok], [409, false]);
  assert.match(JSON.parse(open.text).error, /is open/);
  await post(s, { v: 1, host: 'claude', event: 'session-end', ts: Date.now() + 1, session: UUID_B, cwd: s.wiki, kind: 'other' });
  assert.equal(JSON.parse((await resume({ id: UUID_B })).text).ok, true, 'after its end, the session can continue');
  assert.equal(calls.length, count + 1);
  assert.equal(ok.headers['access-control-allow-origin'], undefined);
});
