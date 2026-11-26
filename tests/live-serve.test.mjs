// The live server and its reporter: the request checks, the events, the held page request, the pages, and the state file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BOARD_SCRIPT } from '../plugins/forge/scripts/lib/board-page.mjs';
import { pickServer } from '../plugins/forge/scripts/lib/live-event.mjs';
import { rawDir } from '../plugins/forge/scripts/lib/layout.mjs';
import { PLUGIN_VERSION, RESUME_GAP_MS, checkRequest, defaultPort, keyFile, liveFile, liveList, liveRoots, liveStatus, newKey, sameToken, serveLive } from '../plugins/forge/scripts/lib/live-serve.mjs';
import { boardStamp, needsCount } from '../plugins/forge/scripts/lib/live-stamp.mjs';
import { ERROR_POLICY } from '../plugins/forge/scripts/lib/ui.mjs';
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
    '---', 'type: ticket', `key: ${key}`, `title: Title of ${key}`, `short: Short ${key}`, 'workflow: full-v4', 'phase: plan', `state: ${state}`,
    `next: Next step for ${key}`, 'changes: []', 'people: []', 'gates:', '  - { name: Planned?, doc: plan.md, need: required, status: in-review }', ...extra, 'updated: 2026-11-16', '---', `# ${key}`, '',
  ].join('\n'));
  ticket('APP-9', 'active', ['worktree: /code/app.worktrees/APP-9']);
  ticket('APP-2', 'done');
  put('raw/tickets/app-9/story.md', '---\ntype: story\n---\n# Story APP-9\n\nProblem: retries stop after 3 s.\n');
  put('raw/tickets/app-9/page.html', '<p>not a ticket file</p>\n');
  put('tooling/build.md', '---\ntitle: Build\nupdated: 2026-11-10\nstatus: verified\n---\n# Build\n\nThe build uses npm.\n');
  put('tickets/app-1.md', '---\ntitle: "APP-1: First fix"\nupdated: 2026-11-01\nstatus: verified\n---\n# APP-1: First fix\n\nSee [build](../tooling/build.md).\n');
  put('raw/tickets/app-9/plan.md', '---\ntype: plan\n---\n# Plan APP-9\n\nCause: see [the build page](../../../tooling/build.md).\n');
  return { root, wiki: path.join(root, 'wiki'), env: { ...process.env, FORGE_DATA_DIR: path.join(root, 'data') }, put, ticket };
}

// One live server in this process. It stops at the end of the test.
// `from` is the fixture of an earlier server (the same wiki and the same data folder), and `before` changes the fixture before the server starts.
async function start(t, { from, before, ...options } = {}) {
  const f = from ?? wiki(t);
  if (before) before(f);
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
  assert.deepEqual(Object.keys(s.state).sort(), ['home', 'page', 'pid', 'port', 'repo', 'roots', 'token', 'v', 'version', 'wiki']);
  assert.deepEqual([s.state.v, s.state.home, s.state.repo, s.state.roots], [2, s.wiki, '/code/app', ['/code/app', '/code/app.worktrees', s.wiki]]);
  assert.equal(s.state.page, s.page);
  assert.notEqual(s.event, s.page, 'the token of a page cannot send an event');
  assert.equal(s.state.port, s.port);
  if (process.platform !== 'win32') assert.equal(statSync(liveFile(s.env, s.wiki)).mode & 0o777, 0o600);
  assert.deepEqual(liveStatus(s.env, s.wiki), {
    pid: process.pid, port: s.port, link: `http://127.0.0.1:${s.port}/board?t=${s.page}`, wikiLink: `http://127.0.0.1:${s.port}/wiki?t=${s.page}`,
    file: liveFile(s.env, s.wiki), home: s.wiki, repo: '/code/app', version: PLUGIN_VERSION,
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

  // The only route that takes an event is /event. POST /resume takes the page token, and has its own tests.
  for (const url of ['/send', '/live', '/board', '/', '/message']) {
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
  assert.deepEqual(first.sessions, []);
  assert.equal(first.detail, undefined, 'the answer has no detail of a turn');
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

  // A ticket in the address gives the same answer as the board: the page of a ticket is gone.
  const { now: ignored, ...asked } = await live(s, '&ticket=app-9');
  const { now: ignoredToo, ...plain } = await live(s);
  assert.deepEqual(asked, plain);
  const res = await request(s.port, { url: `/live?t=${s.page}` });
  assert.match(res.headers['content-type'], /^application\/json/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('the pages of the live server: the board and the wiki page, each with its own script policy', async (t) => {
  const s = await start(t);
  const root = await request(s.port, { url: `/?t=${s.page}` });
  assert.deepEqual([root.status, root.headers.location], [302, `/board?t=${s.page}`]);

  const board = await request(s.port, { url: `/board?t=${s.page}` });
  assert.equal(board.status, 200);
  assert.equal(board.headers['content-security-policy'], `default-src 'none'; script-src 'sha256-${hash(BOARD_SCRIPT)}'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'`);
  assert.equal(/<script>([\s\S]*)<\/script>/.exec(board.text)[1], BOARD_SCRIPT);
  assert.ok(board.text.includes(`"live":"/live?t=${s.page}","resume":"/resume"`));
  assert.match(board.text, /<section class="frame sunk bsec" id="live-other" hidden>/); // Forge 9.2: the list of other sessions is a sunk kit frame
  assert.match(board.text, /<ul class="rows" id="live-list"><\/ul><ul class="rows" id="past-list"><\/ul>/);
  assert.match(board.text, /<p class="note" id="live-note" aria-live="polite">/); // Forge 9.2: the live line is a live region
  // The default link mode is the editor: a ticket card opens the document of its gate in review in the editor, and no ticket has a page here.
  assert.ok(board.text.includes(`<a class="open" href="vscode://file${path.join(rawDir(s.wiki), 'tickets', 'app-9', 'plan.md').replaceAll('\\', '/').replace(/^(?!\/)/, '/')}" title=`), 'a ticket card opens its document');
  assert.doesNotMatch(board.text, /\/ticket\/[^"]*\/\?t=|canvas\.html/);
  assert.equal(board.text.match(/<script\b/g).length, 2);

  const file = await request(s.port, { url: `/ticket/app-9/story.md?t=${s.page}` });
  assert.deepEqual([file.status, file.headers['content-type'], file.headers['content-security-policy']], [200, 'text/plain; charset=utf-8', "default-src 'none'; sandbox"]);
  // The wiki page: each canonical page, and the closed tickets. The board has the link to it.
  const wikiPage = await request(s.port, { url: `/wiki?t=${s.page}` });
  assert.equal(wikiPage.status, 200);
  assert.equal(wikiPage.headers['content-security-policy'], `default-src 'none'; script-src 'sha256-${hash(WIKI_SCRIPT)}'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'`);
  assert.equal(/<script>([\s\S]*)<\/script>/.exec(wikiPage.text)[1], WIKI_SCRIPT);
  assert.match(wikiPage.text, /The build uses npm\./);
  assert.ok(wikiPage.text.includes(`<a href="/ticket/app-9/README.md?t=${s.page}" data-nav><span class="key">APP-9</span>`), 'a page names the open ticket that uses it');
  assert.ok(wikiPage.text.includes(`href="/board?t=${s.page}"`) && !wikiPage.text.includes('"live"'));
  assert.ok(board.text.includes(`<a class="quiet" href="/wiki?t=${s.page}" data-nav`));
  assert.ok(board.text.includes(`<a class="open" href="/wiki?t=${s.page}#tickets/app-1.md" data-nav title="First fix">`), 'a closed ticket opens its summary page');
  assert.equal((await request(s.port, { url: '/wiki' })).status, 403);
  // In the file link mode, the card opens the same document on this server, with the token.
  const files = await start(t, { links: 'file' });
  const fileBoard = await request(files.port, { url: `/board?t=${files.page}` });
  assert.ok(fileBoard.text.includes(`<a class="open" href="/ticket/app-9/plan.md?t=${files.page}" data-nav title=`), 'the document of the gate in review');
  assert.equal((await request(files.port, { url: `/ticket/app-9/plan.md?t=${files.page}` })).status, 200);
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
  assert.equal(page.headers['content-security-policy'], `default-src 'none'; script-src 'sha256-${hash(WIKI_SCRIPT)}' 'self'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'`);
  assert.ok(page.text.includes(`"mermaid":{"src":"${MERMAID_ROUTE}?t=${s.page}","integrity":"${MERMAID_INTEGRITY}"}`));
  const file = await request(s.port, { url: `${MERMAID_ROUTE}?t=${s.page}` });
  assert.deepEqual([file.status, file.headers['content-type'], file.headers['x-content-type-options'], file.headers['cache-control']], [200, 'text/javascript; charset=utf-8', 'nosniff', 'private, max-age=86400']);
  assert.equal(Number(file.headers['content-length']), readFileSync(mermaidPath()).length);
  assert.equal(file.text, readFileSync(mermaidPath(), 'utf8'));
  assert.equal((await request(s.port, { url: MERMAID_ROUTE })).status, 403, 'the file needs the page token');
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
  // Forge 9.2: a page request also starts the time again, so the message names both.
  assert.match(s.note(), /no session sent an event and no page asked for the state for a long time/);
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
  const state = await live(s);
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

// --- Forge 9.2, stage 5: the stable link, the error pages, the idle time, the change stamp, and the needs count ---

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const KEY = /^[0-9a-f]{32}$/;
const HTML = { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
// The tokens are random values of a temporary server. The checks below compare them without printing them.
const same = (a, b) => a === b;

test('the page token is stable for a Forge folder: the key file keeps it over a restart, and the event token is new at each start', async (t) => {
  const first = await start(t);
  const file = keyFile(first.env, first.wiki);
  assert.match(file, /live[\\/][0-9a-f]{16}\.key$/);
  assert.equal(path.dirname(file), path.dirname(liveFile(first.env, first.wiki)), 'the key file is next to the state file');
  assert.ok(same(readFileSync(file, 'utf8'), `${first.page}\n`));
  assert.ok(KEY.test(first.page));
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(first.state).sort(), ['home', 'page', 'pid', 'port', 'repo', 'roots', 'token', 'v', 'version', 'wiki'], 'the keys of the state file did not change');
  await first.stop();
  assert.ok(existsSync(file), 'the key file stays when the server stops');
  const second = await start(t, { from: first });
  assert.ok(same(second.page, first.page), 'the same link after a restart');
  assert.ok(!same(second.event, first.event), 'the event token is new at each start');
  assert.ok(!same(second.event, second.page));
  assert.equal(second.state.page, second.page);
  assert.equal((await request(second.port, { url: `/board?t=${first.page}` })).status, 200, 'the old bookmark opens the board of the new server');
  assert.equal((await request(second.port, { url: `/board?t=${first.event}` })).status, 403, 'the old event token opens nothing');
  // A key with a Windows line end is still a key. Another repository gets another key file.
  await second.stop();
  writeFileSync(file, `${first.page}\r\n`, { mode: 0o600 });
  const third = await start(t, { from: first });
  assert.ok(same(third.page, first.page));
  assert.notEqual(keyFile(first.env, path.join(first.root, 'other')), file);
});

test('a key file that is damaged, too wide, or a link gives a new key, and the new file is a regular file with the mode 0600', async (t) => {
  const base = await start(t);
  const file = keyFile(base.env, base.wiki);
  const good = base.page;
  await base.stop();
  const damaged = ['', 'abc', `${good}0`, good.toUpperCase(), `${good.slice(0, 31)}g`, `${good}\n\n`, ` ${good}`, `${good}x\n`, 'x'.repeat(200)];
  for (const text of damaged) {
    writeFileSync(file, text, { mode: 0o600 });
    const run = await start(t, { from: base });
    assert.ok(KEY.test(run.page) && !same(run.page, good), `a new key for ${JSON.stringify(text.length)} characters`);
    assert.ok(same(readFileSync(file, 'utf8'), `${run.page}\n`));
    await run.stop();
    writeFileSync(file, `${good}\n`, { mode: 0o600 });
  }
  // A directory in the place of the file: the server still starts, with a key for this run.
  rmSync(file, { force: true });
  mkdirSync(file);
  const dir = await start(t, { from: base });
  assert.ok(KEY.test(dir.page));
  assert.ok(statSync(file).isDirectory(), 'the server removes nothing that it does not own');
  await dir.stop();
  rmSync(file, { recursive: true });
  if (process.platform === 'win32') return;
  for (const mode of [0o644, 0o640, 0o604, 0o660, 0o666, 0o602, 0o620]) {
    writeFileSync(file, `${good}\n`, { mode: 0o600 });
    chmodSync(file, mode);
    const run = await start(t, { from: base });
    assert.ok(KEY.test(run.page) && !same(run.page, good), `a new key for the mode ${mode.toString(8)}`);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    await run.stop();
  }
  // A link to a good key file is not read, and the link is replaced (not followed): the target stays as it was.
  const target = path.join(base.root, 'elsewhere.key');
  writeFileSync(target, `${good}\n`, { mode: 0o600 });
  rmSync(file, { force: true });
  try { symlinkSync(target, file); } catch { return; }
  const linked = await start(t, { from: base });
  assert.ok(!same(linked.page, good));
  assert.equal(lstatSync(file).isSymbolicLink(), false, 'the key file is a regular file now');
  assert.ok(same(readFileSync(target, 'utf8'), `${good}\n`), 'the target of the link was not written');
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test('newKey writes a new page token, and the next server uses it', async (t) => {
  const first = await start(t);
  await first.stop();
  const key = newKey(first.env, first.wiki);
  assert.ok(KEY.test(key) && !same(key, first.page));
  assert.ok(same(readFileSync(keyFile(first.env, first.wiki), 'utf8'), `${key}\n`));
  if (process.platform !== 'win32') assert.equal(statSync(keyFile(first.env, first.wiki)).mode & 0o777, 0o600);
  const next = await start(t, { from: first });
  assert.ok(same(next.page, key));
});

test('forge.mjs open --new-link starts a new key: a running server is stopped and started again, and the old link stops', { skip: process.platform === 'win32' }, async (t) => {
  const f = wiki(t);
  const run = (...args) => spawnSync(process.execPath, [cli, 'open', ...args, '--cwd', cwd, '--wiki', f.wiki], { encoding: 'utf8', env: f.env, timeout: 20000 });
  t.after(() => { run('--stop'); });
  const links = (result) => /^forge: serving http:\/\/127\.0\.0\.1:(\d+)\/board\?t=([0-9a-f]{32})\n/.exec(result.stdout)?.slice(1);
  const first = run('--no-browser', '--port', '0');
  assert.equal(first.status, 0, first.stderr);
  const [port1, page1] = links(first);
  // The key stays over a stop and a start.
  assert.equal(run('--stop').status, 0);
  const again = run('--no-browser', '--port', '0');
  assert.equal(again.status, 0, again.stderr);
  const [port2, page2] = links(again);
  assert.ok(same(page2, page1), 'open --stop keeps the key');
  // A new link: the running server stops, and the new server has another key.
  const renewed = run('--new-link', '--no-browser', '--port', '0');
  assert.equal(renewed.status, 0, renewed.stderr);
  const [port3, page3] = links(renewed);
  assert.ok(KEY.test(page3) && !same(page3, page1), 'a new page token');
  assert.match(renewed.stdout, /\n {2}wiki {3}http:\/\/127\.0\.0\.1:\d+\/wiki\?t=[0-9a-f]{32}\n {2}folder .+\n {2}The server runs in the background/);
  assert.equal((await request(Number(port3), { url: `/board?t=${page3}` })).status, 200);
  assert.equal((await request(Number(port3), { url: `/board?t=${page1}` })).status, 403, 'the old link stops');
  assert.ok(Number(port2) > 0 && Number(port1) > 0);
  // The link of a later open is the new one. With no server, --new-link starts one with a new key too.
  assert.ok(same(links(run('--no-browser'))[1], page3));
  assert.equal(run('--stop').status, 0);
  const none = run('--new-link', '--no-browser', '--port', '0');
  assert.equal(none.status, 0, none.stderr);
  assert.ok(!same(links(none)[1], page3));
  for (const args of [['--new-link', '--stop'], ['--new-link', '--status'], ['--new-link', '--list']]) {
    const result = run(...args);
    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, /Usage: forge\.mjs open \[--no-browser\] \[--new-link\]/);
  }
  assert.equal(spawnSync(process.execPath, [cli, 'live', '--new-link', '--cwd', cwd], { encoding: 'utf8', env: f.env }).status, 1, 'live has no such flag');
});

test('open prints one line when no browser starts, and none when the browser opens', async (t) => {
  const f = wiki(t);
  const { openForge, stopForge } = await import('../plugins/forge/scripts/lib/open.mjs');
  let text = '';
  const out = { write: (chunk) => { text += chunk; } };
  const noBrowser = () => { const child = new EventEmitter(); child.unref = () => {}; setImmediate(() => child.emit('error', new Error('ENOENT'))); return child; };
  const opens = () => { const child = new EventEmitter(); child.unref = () => {}; setImmediate(() => child.emit('spawn')); return child; };
  // The fake start command answers for the browser only: the live server is started by the real spawn.
  const fake = (browser) => (command, args, options) => (command === process.execPath ? spawn(command, args, options) : browser(command, args, options));
  t.after(() => stopForge({ wiki: f.wiki, env: f.env }));
  const first = await openForge({ cli, repo: cwd, wiki: f.wiki, port: 0, env: f.env, out, spawnFn: fake(noBrowser) });
  assert.equal(first.opened, false);
  assert.match(text, /\n {2}No browser started\. Open the board link above by hand\.\n$/);
  text = '';
  const second = await openForge({ cli, repo: cwd, wiki: f.wiki, env: f.env, out, spawnFn: fake(opens) });
  assert.equal(second.opened, true);
  assert.doesNotMatch(text, /No browser started/);
  text = '';
  await openForge({ cli, repo: cwd, wiki: f.wiki, env: f.env, out, browser: false });
  assert.doesNotMatch(text, /No browser started/, 'no browser was asked for');
});

test('open stops a server of another plugin version, and a server on another port than --port, and starts a new one', async (t) => {
  const f = wiki(t);
  const { openForge, stopForge } = await import('../plugins/forge/scripts/lib/open.mjs');
  const out = { write: () => {} };
  const open = (extra = {}) => openForge({ cli, repo: cwd, wiki: f.wiki, env: f.env, out, browser: false, ...extra });
  t.after(() => stopForge({ wiki: f.wiki, env: f.env }));
  const first = await open({ port: 0 });
  assert.equal(first.version, PLUGIN_VERSION, 'the state file holds the plugin version');
  const same = await open();
  assert.deepEqual([same.started, same.pid], [false, first.pid], 'the same version and no port: the server stays');
  assert.equal((await open({ port: 0 })).started, false, 'port 0 means any port');
  // A server of an older version (here: a state file with another version) is replaced.
  const file = liveFile(f.env, f.wiki);
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), version: '9.0.0' }));
  const upgraded = await open({ port: 0 });
  assert.equal(upgraded.started, true);
  assert.notEqual(upgraded.pid, first.pid);
  assert.equal(upgraded.version, PLUGIN_VERSION);
  // A state file with no version (a 9.x server) is replaced too.
  const state = JSON.parse(readFileSync(file, 'utf8'));
  delete state.version;
  writeFileSync(file, JSON.stringify(state));
  const old = await open({ port: 0 });
  assert.equal(old.started, true);
  assert.notEqual(old.pid, upgraded.pid);
  // --port that differs from the running port restarts the server on that port, and the link keeps its key.
  const probe = await new Promise((resolve) => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
  const moved = await open({ port: probe });
  assert.equal(moved.started, true);
  assert.equal(moved.port, probe);
  assert.equal(moved.link.split('?t=')[1], old.link.split('?t=')[1]);
  assert.equal((await open({ port: probe })).started, false, 'the same port: the server stays');
});

test('a ticket has no page and no Send route on the server, and no request writes a file', async (t) => {
  const s = await start(t);
  const tree = () => ['app-9', 'app-2'].flatMap((folder) => readdirSync(path.join(s.wiki, 'raw', 'tickets', folder), { recursive: true }).map((name) => `${folder}/${name}`)).sort();
  const before = tree();
  for (const url of ['/ticket/app-9/', '/ticket/app-9', '/ticket/app-2/', '/ticket/app-9/index.html', '/ticket/app-9/canvas.html', '/ticket/nope/']) {
    const page = await request(s.port, { url: `${url}?t=${s.page}`, headers: HTML });
    assert.equal(page.status, 404, url);
    assert.match(page.text, /<title>Not found<\/title>/);
    const plain = await request(s.port, { url: `${url}?t=${s.page}` });
    assert.deepEqual([plain.status, plain.text], [404, 'Not found.\n'], url);
  }
  // Only the reporter sends a POST to a path of the server, and it sends /event. The page token has no POST route except /resume.
  const body = JSON.stringify({ comments: [{ id: 'plan-step-2', file: 'plan.md', section: 'Steps', title: 'Step', text: 'Why?' }], general: 'x' });
  for (const folder of ['app-9', 'app-2', 'nope']) {
    const withEvent = await request(s.port, { method: 'POST', url: `/ticket/${folder}/send`, headers: { 'Content-Type': 'application/json', 'X-Forge-Token': s.event }, body });
    assert.equal(withEvent.status, 404, folder);
    const withPage = await request(s.port, { method: 'POST', url: `/ticket/${folder}/send`, headers: { 'Content-Type': 'application/json', 'X-Forge-Token': s.page }, body });
    assert.equal(withPage.status, 403, folder);
  }
  assert.deepEqual(tree(), before, 'no file is written');
  assert.ok(!existsSync(path.join(s.wiki, 'raw', 'tickets', 'app-9', 'canvas-comments.md')));
  assert.equal(s.note(), '');
  assert.equal((await request(s.port, { url: `/board?t=${s.page}` })).status, 200, 'the server still answers');
});

test('a file of a ticket folder is given as text, and the server never follows a link', { skip: process.platform === 'win32' }, async (t) => {
  const s = await start(t);
  const dir = path.join(s.wiki, 'raw', 'tickets', 'app-9');
  writeFileSync(path.join(s.root, 'outside.md'), '# Outside\n');
  symlinkSync(path.join(s.root, 'outside.md'), path.join(dir, 'link.md'));
  assert.equal((await request(s.port, { url: `/ticket/app-9/link.md?t=${s.page}` })).status, 404);
  const story = await request(s.port, { url: `/ticket/app-9/story.md?t=${s.page}` });
  assert.deepEqual([story.status, story.headers['content-type']], [200, 'text/plain; charset=utf-8']);
});

test('an error answer is a page of the kit for a browser and the plain text for each other caller', async (t) => {
  const s = await start(t);
  assert.equal(ERROR_POLICY, "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'");
  const check = (res, status) => {
    assert.equal(res.status, status);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(res.headers['content-security-policy'], "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'");
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
    assert.equal(Number(res.headers['content-length']), Buffer.byteLength(res.text));
    assert.ok(res.text.startsWith('<!doctype html>') && !/<script/i.test(res.text) && !res.text.includes('on' + 'click'), 'a page without a script');
    assert.match(res.text, /<link rel="icon" href="data:image\/svg\+xml,/);
    assert.ok(res.text.includes('class="px"'), 'the cold anvil');
  };

  // 403: no token, a wrong token, the event token, and a wrong Host. The page echoes nothing of the request and names no folder.
  const wrong = '0'.repeat(32);
  for (const [url, headers] of [['/board', {}], [`/board?t=${wrong}&marker=ZZQ-MARK`, {}], [`/wiki?t=${s.event}`, {}], [`/board?t=${s.page}`, { Host: 'evil.test' }], ['/ticket/app-9/ZZQ-MARK', {}]]) {
    const res = await request(s.port, { url, headers: { ...HTML, ...headers } });
    check(res, 403);
    assert.match(res.text, /<title>This link is old<\/title>/);
    assert.ok(res.text.includes('The link is old or not complete.') && res.text.includes('<code class="err-cmd">forge open</code>'));
    for (const part of ['ZZQ-MARK', wrong, s.page, s.event, s.root, s.wiki, 'forge-live-', 'evil.test', os.tmpdir(), '/code/app']) assert.ok(!res.text.includes(part), `the 403 page holds ${part.slice(0, 6)}`);
    assert.doesNotMatch(res.text, /<a [^>]*href=/, 'no link on the page of a refused request');
    const plain = await request(s.port, { url, headers });
    assert.equal(plain.status, 403);
    assert.equal(plain.headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(plain.text, 'This link is old or not complete. Run "forge.mjs open --status" for the link of the live server.\n');
    assert.equal(plain.headers['content-security-policy'], undefined);
  }
  // A caller that does not ask for a page keeps the plain text: a script of a page (Accept: */*), curl, and a request of another kind.
  const star = await request(s.port, { url: '/live', headers: { Accept: '*/*' } });
  assert.deepEqual([star.status, star.headers['content-type']], [403, 'text/plain; charset=utf-8']);
  const json = await request(s.port, { url: '/live', headers: { Accept: 'application/json' } });
  assert.equal(json.headers['content-type'], 'text/plain; charset=utf-8');
  const refused = await request(s.port, { method: 'POST', url: '/event', body: '{}', headers: { ...HTML, 'Content-Type': 'application/json', 'X-Forge-Token': wrong } });
  assert.deepEqual([refused.status, refused.headers['content-type']], [403, 'text/plain; charset=utf-8'], 'only a GET gets a page');
  assert.equal((await request(s.port, { method: 'PUT', url: `/board?t=${s.page}`, headers: HTML })).headers['content-type'], 'text/plain; charset=utf-8', 'a 405 keeps its plain answer');

  // 404: after the token check, so it has a link to the board with the token. It echoes nothing of the address.
  for (const url of [`/nope-ZZQ-MARK?t=${s.page}`, `/ticket/nope/?t=${s.page}`, `/ticket/app-9/page.html?t=${s.page}`, `/ticket/app-9/%3Cscript%3E.md?t=${s.page}`]) {
    const res = await request(s.port, { url, headers: HTML });
    check(res, 404);
    assert.match(res.text, /<title>Not found<\/title>/);
    assert.ok(res.text.includes(`<a class="primary" href="/board?t=${s.page}">Open the board</a>`));
    assert.ok(!res.text.includes('ZZQ-MARK') && !res.text.includes('%3Cscript'));
    const plain = await request(s.port, { url });
    assert.deepEqual([plain.status, plain.headers['content-type'], plain.text], [404, 'text/plain; charset=utf-8', 'Not found.\n']);
  }
  const post = await request(s.port, { method: 'POST', url: '/send', body: '{}', headers: { ...HTML, 'Content-Type': 'application/json', 'X-Forge-Token': s.event } });
  assert.deepEqual([post.status, post.headers['content-type']], [404, 'text/plain; charset=utf-8']);

  // 500: a file that the server cannot read. The page has the escaped message of the error and the link to the board.
  if (process.platform === 'win32' || process.getuid?.() === 0) return;
  const story = path.join(s.wiki, 'raw', 'tickets', 'app-9', 'story.md');
  chmodSync(story, 0);
  t.after(() => { try { chmodSync(story, 0o644); } catch { /* The folder is gone already. */ } });
  const url = `/ticket/app-9/story.md?t=${s.page}`;
  const broken = await request(s.port, { url, headers: HTML });
  check(broken, 500);
  assert.match(broken.text, /<title>Something went wrong<\/title>/);
  assert.match(broken.text, /The live server cannot show the page: EACCES/);
  assert.ok(broken.text.includes(`<a class="primary" href="/board?t=${s.page}">Open the board</a>`));
  const plain500 = await request(s.port, { url });
  assert.deepEqual([plain500.status, plain500.headers['content-type']], [500, 'text/plain; charset=utf-8']);
  assert.match(plain500.text, /^The live server cannot show the page: EACCES/);
});

test('a page request and a state request with the token start the idle time again, and a refused request does not', async (t) => {
  const s = await start(t, { idleMs: 1000 });
  await wait(600);
  assert.equal((await request(s.port, { url: `/board?t=${s.page}` })).status, 200);
  await wait(600);
  assert.ok(existsSync(liveFile(s.env, s.wiki)), 'a page request started the time again: the server runs after 1200 ms');
  assert.equal((await request(s.port, { url: `/live?t=${s.page}` })).status, 200);
  const last = Date.now();
  await wait(600);
  assert.ok(existsSync(liveFile(s.env, s.wiki)), 'a state request started the time again: the server runs after 1800 ms');
  assert.equal((await request(s.port, { url: '/live' })).status, 403);
  assert.equal((await request(s.port, { url: `/board?t=${s.event}` })).status, 403);
  assert.equal(await s.done, 3);
  assert.ok(Date.now() - last < 1400, 'the refused requests did not start the time again');
  assert.match(s.note(), /no session sent an event and no page asked for the state/);
});

test('the answer has the change stamp c: it agrees with the page, a changed file changes it, and a held request gets the change', async (t) => {
  const s = await start(t, { sweepMs: 60, holdMs: 5000 });
  // The board page and the first answer have the same stamp.
  const board = await request(s.port, { url: `/board?t=${s.page}` });
  const boardC = /"c":"([0-9a-f]{12})"/.exec(board.text)[1];
  const first = await live(s);
  assert.equal(first.c, boardC);
  assert.match(first.c, /^[0-9a-f]{12}$/);
  assert.ok(!(await request(s.port, { url: `/wiki?t=${s.page}` })).text.includes('"c":'), 'the wiki page has no stamp and no live view');
  assert.equal((await live(s)).c, boardC, 'the stamp does not change by itself');

  // A change of a story file: the board shows no part of it, so the board stamp stays.
  const before = await live(s);
  writeFileSync(path.join(s.wiki, 'raw', 'tickets', 'app-9', 'story.md'), '---\ntype: story\n---\n# Story APP-9\n\nProblem: retries stop after 30 s, and the page changed.\n');
  await wait(200);
  const after = await live(s);
  assert.equal(after.c, boardC, 'the board stamp did not change for a story file');
  assert.equal(after.v, before.v, 'the version did not change either');

  // A change that the board shows (the README of a ticket) changes the board stamp: a held request of the board gets it.
  const now = await live(s);
  const heldBoard = live(s, `&v=${now.v}`);
  await wait(100);
  s.put('raw/tickets/app-9/README.md', readFileSync(path.join(s.wiki, 'raw', 'tickets', 'app-9', 'README.md'), 'utf8').replace('Next step for APP-9', 'A new next step for APP-9'));
  const answer = await heldBoard;
  assert.notEqual(answer.c, boardC);
  assert.ok(answer.v > now.v);
  assert.equal(/"c":"([0-9a-f]{12})"/.exec((await request(s.port, { url: `/board?t=${s.page}` })).text)[1], answer.c);
  await s.stop();
});

test('the end of a tool reads the board again, so a change of a ticket file by a session shows fast (one time in a second at most)', async (t) => {
  // The sweep is long, and the board cache lasts 5 seconds: only the event can give the answer in time.
  const s = await start(t, { holdMs: 6000 });
  const first = await live(s);
  const held = live(s, `&v=${first.v}`);
  await wait(100);
  s.put('raw/tickets/app-9/README.md', readFileSync(path.join(s.wiki, 'raw', 'tickets', 'app-9', 'README.md'), 'utf8').replace('Next step for APP-9', 'Another step'));
  const started = Date.now();
  assert.equal((await post(s, ev('tool-start', { tool: { id: 'T9', name: 'Edit', label: 'README.md' } }))).status, 204);
  assert.equal((await post(s, ev('tool-end', { tool: { id: 'T9', name: 'Edit', label: 'README.md' } }))).status, 204);
  const next = await held;
  assert.ok(Date.now() - started < 2500, 'the answer came with the event');
  assert.notEqual(next.c, first.c, 'the board has the new README');
});

test('the stamps: the board stamp ignores its time, and the count is of tickets and sessions', () => {
  const board = { version: 1, generated: '2026-11-17', total: 1, groups: [{ state: 'active', tickets: [{ key: 'A-1', folder: 'a-1', next: 'x' }] }], errors: [] };
  assert.match(boardStamp(board), /^[0-9a-f]{12}$/);
  assert.equal(boardStamp({ ...board, generated: '2026-11-18' }), boardStamp(board));
  assert.notEqual(boardStamp({ ...board, total: 2 }), boardStamp(board));
  // The count: a ticket that needs the user, and a session that needs the user. A ticket is counted one time.
  const list = [{ folder: 'a-1', state: 'needs-me' }, { folder: 'a-2', state: 'active' }, { folder: 'a-3', state: 'needs-me' }];
  const need = (ticket) => ({ state: 'needs-you', ticket });
  assert.equal(needsCount(list, []), 2);
  assert.equal(needsCount([], []), 0);
  assert.equal(needsCount(list, [need('a-1')]), 2, 'the session of a ticket that is counted adds nothing');
  assert.equal(needsCount(list, [need('a-2')]), 3);
  assert.equal(needsCount(list, [need('a-2'), need('a-2')]), 3, 'two sessions of one ticket count one time');
  assert.equal(needsCount(list, [need('')]), 3, 'a session without a ticket counts for itself');
  assert.equal(needsCount(list, [need(''), need('')]), 4);
  assert.equal(needsCount(list, [{ state: 'working', ticket: 'a-2' }, { state: 'idle', ticket: '' }]), 2, 'only a session that needs the user counts');
});

test('the answer has needs: the tickets that need the user and the sessions that need the user, without a double count', async (t) => {
  const notify = (session, cwd, extra = {}) => ev('notify', { session, cwd, kind: 'permission_prompt', text: 'Claude needs your permission to use Bash', ...extra });
  // No ticket needs the user: 0. A session that needs the user, on a ticket that is not needs-me: 1.
  const none = await start(t);
  assert.equal((await live(none)).needs, 0);
  assert.equal((await post(none, ev('prompt', { session: 'N1', cwd: '/code/app.worktrees/APP-9', text: 'go' }))).status, 204);
  assert.equal((await live(none)).needs, 0, 'a session that works adds nothing');
  assert.equal((await post(none, notify('N1', '/code/app.worktrees/APP-9'))).status, 204);
  const waiting = await live(none);
  assert.deepEqual(waiting.sessions.map((item) => [item.ticket, item.state]), [['app-9', 'needs-you']]);
  assert.equal(waiting.needs, 1, 'one needs-you session of a ticket that is not needs-me');
    await none.stop();

  // One ticket that is needs-me: 1. A session of that ticket that needs the user: still 1. A second ticket with a session: 2. A session without a ticket: 3.
  const one = await start(t, { before: (f) => f.ticket('APP-5', 'needs-me', ['worktree: /code/app.worktrees/APP-5']) });
  assert.equal((await live(one)).needs, 1, 'one ticket in needs-me');
  assert.equal((await post(one, notify('M1', '/code/app.worktrees/APP-5'))).status, 204);
  const both = await live(one);
  assert.deepEqual(both.sessions.map((item) => [item.ticket, item.state]), [['app-5', 'needs-you']]);
  assert.equal(both.needs, 1, 'the ticket and its session count one time');
  assert.equal((await post(one, notify('M2', '/code/app.worktrees/APP-9'))).status, 204);
  assert.equal((await live(one)).needs, 2);
  assert.equal((await post(one, notify('M3', '/code/app'))).status, 204);
  assert.equal((await live(one)).needs, 3, 'a session without a ticket counts for itself');
  await one.stop();
});

test('a page of the live server has the command for the notice, the stamp, and the icons, and the wiki page has no live view', async (t) => {
  const s = await start(t);
  const board = await request(s.port, { url: `/board?t=${s.page}` });
  const data = (html, id) => JSON.parse(new RegExp(`<script type="application/json" id="${id}">([^<]*)</script>`).exec(html)[1]);
  const b = data(board.text, 'board-data');
  assert.equal(b.open, 'forge.mjs open', 'a folder without a launcher gives the plain name of the command');
  assert.match(b.c, /^[0-9a-f]{12}$/);
  assert.deepEqual(Object.keys(b.icons), ['calm', 'needs']);
  assert.ok(b.icons.calm.startsWith('data:image/svg+xml,') && b.icons.needs.startsWith('data:image/svg+xml,') && b.icons.calm !== b.icons.needs);
  const w = data((await request(s.port, { url: `/wiki?t=${s.page}` })).text, 'wiki-data');
  assert.equal(w.open, 'forge.mjs open');
  assert.ok(!('c' in w) && !('live' in w) && !('icons' in w));
  // The launcher of a Forge folder gives its path.
  const { launcherCommand } = await import('../plugins/forge/scripts/lib/launcher.mjs');
  const home = path.join(s.root, 'my app.forge');
  mkdirSync(home);
  assert.equal(launcherCommand(home, 'linux'), '', 'no launcher file');
  writeFileSync(path.join(home, 'forge'), '#!/bin/sh\n');
  assert.equal(launcherCommand(home, 'linux'), `"${path.join(home, 'forge')}" open`, 'a path with a space gets quotes');
  const plain = path.join(s.root, 'app.forge');
  mkdirSync(plain);
  writeFileSync(path.join(plain, 'forge'), '#!/bin/sh\n');
  assert.equal(launcherCommand(plain, 'linux'), `${path.join(plain, 'forge')} open`);
  const odd = path.join(s.root, 'a$b.forge');
  mkdirSync(odd);
  writeFileSync(path.join(odd, 'forge'), '#!/bin/sh\n');
  assert.equal(launcherCommand(odd, 'linux'), '', 'a character that a shell reads inside quotes gives no command');
  assert.equal(launcherCommand(plain, 'win32'), '', 'Windows has the file forge.cmd');
});

const TOKEN = 'a'.repeat(32);
test('the first port of a ticket is stable, and a request needs a loopback name, the token, and a JSON body', () => {
  assert.equal(defaultPort('APP-9'), defaultPort('APP-9'));
  for (const key of ['APP-9', 'APP-10', 'X', '']) assert.ok(defaultPort(key) >= 41000 && defaultPort(key) < 43000, key);
  const get = (headers = {}, url = `/?t=${TOKEN}`) => checkRequest({ method: 'GET', url, headers: { host: '127.0.0.1:41000', ...headers } }, TOKEN);
  const post = (headers = {}) => checkRequest({
    method: 'POST', url: '/event', headers: { host: '127.0.0.1:41000', 'x-forge-token': TOKEN, 'content-type': 'application/json', ...headers },
  }, TOKEN);
  assert.equal(get(), 0);
  assert.equal(get({ host: 'localhost:9000' }), 0, 'a forwarded port has another number');
  assert.equal(get({ host: 'evil.test' }), 403);
  assert.equal(get({ host: '127.0.0.1.evil.test:41000' }), 403);
  assert.equal(get({ host: undefined }), 403);
  assert.equal(get({}, '/'), 403);
  assert.equal(get({}, `/?t=${'b'.repeat(32)}`), 403);
  assert.equal(get({}, `/?t=${TOKEN}0`), 403);
  assert.equal(checkRequest({ method: 'PUT', url: `/?t=${TOKEN}`, headers: { host: '127.0.0.1:41000' } }, TOKEN), 405);
  assert.equal(post(), 0);
  assert.equal(post({ origin: 'http://127.0.0.1:41000', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json; charset=utf-8' }), 0);
  assert.equal(post({ 'x-forge-token': 'no' }), 403);
  assert.equal(post({ 'x-forge-token': undefined }), 403);
  assert.equal(post({ origin: 'https://evil.test' }), 403);
  assert.equal(post({ origin: 'null' }), 403);
  assert.equal(post({ 'sec-fetch-site': 'cross-site' }), 403);
  assert.equal(post({ 'content-type': 'text/plain' }), 415, 'a plain form of another site cannot send JSON');
  assert.equal(post({ 'content-type': undefined }), 415);
});

test('a token is compared in constant time with the same length', () => {
  assert.equal(sameToken(TOKEN, TOKEN), true);
  assert.equal(sameToken('b'.repeat(32), TOKEN), false);
  assert.equal(sameToken(TOKEN.slice(1), TOKEN), false, 'another length is no match');
  assert.equal(sameToken('', TOKEN), false);
  assert.equal(sameToken(undefined, TOKEN), false);
});
