// The canvas server: the comment message, the request checks, and one run from the first link to the Send.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CANVAS_SCRIPT, canvasLine, canvasMessage } from '../plugins/forge/scripts/lib/canvas-page.mjs';
import { checkRequest, defaultPort, readSend } from '../plugins/forge/scripts/lib/canvas-serve.mjs';
import { buildCanvas, renderCanvas } from '../plugins/forge/scripts/lib/canvas.mjs';

const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));
const TOKEN = 'a'.repeat(32);
const char = (code) => String.fromCharCode(code);

function wiki(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'forge-serve-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'raw', 'tickets', 'app-9');
  const put = (name, text) => {
    const file = path.join(dir, ...name.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  put('README.md', [
    '---', 'type: ticket', 'key: APP-9', 'title: Outbox retry stops too early', 'short: Fix outbox retry on timeout', 'workflow: full-v3',
    'phase: plan', 'state: needs-me', 'next: Approve the plan', 'changes: []', 'people: []',
    'gates:', '  - { name: Planned?, doc: plan.md, need: required, status: in-review }', 'updated: 2026-11-12', '---',
    '# APP-9: Outbox retry', '',
  ].join('\n'));
  put('story.md', '---\ntype: story\n---\n# Story APP-9\n\nProblem: retries stop after 3 s.\n\n## Scope\n\n- The retry job\n');
  put('plan.md', '---\ntype: plan\n---\n# Plan APP-9\n\nCause: the wrong key. See [the note](evidence/note.md).\n\n## Steps\n\n1. Read the new key\n2. Add the timeout case\n');
  put('evidence/note.md', '# Note\n\nThe key is `Retry.Timeout`.\n');
  put('evidence/page.html', '<p>not a ticket file</p>\n');
  return { root, dir, put };
}

test('the comment message has one line shape for each comment tool', () => {
  const step = { id: 'plan-step-2', file: 'plan.md', section: 'Steps', title: '2. Add the timeout case' };
  const message = canvasMessage('APP-9', [
    { ...step, text: 'Why 30 s?' },
    { ...step, text: '', label: 'unclear' },
    { id: 'plan-risks', file: 'plan.md', section: 'Risks', title: 'Risks', text: 'The limit is 10 s.', label: 'wrong', quote: 'tenants with the "old" key' },
    { id: 'story-scope', file: 'story.md', section: 'Scope', title: 'Scope', text: '', kind: 'remove', quote: 'The sender' },
    { id: 'plan-step-3', file: 'plan.md', section: 'Steps', title: '3. Remove the old key', text: '', kind: 'remove' },
    { ...step, text: '   ' },
    { ...step, text: '', label: 'approved' },
  ], 'Too\nlong.');
  assert.equal(message, [
    'Canvas comments for APP-9:',
    '1. plan.md, Steps, "2. Add the timeout case": Why 30 s?',
    '2. plan.md, Steps, "2. Add the timeout case": [unclear]',
    '3. plan.md, Risks, on "tenants with the \'old\' key": [wrong] The limit is 10 s.',
    '4. story.md, Scope, on "The sender": remove this',
    '5. plan.md, Steps, "3. Remove the old key": remove this',
    '6. Whole ticket: Too long.',
  ].join('\n'));
  // A comment of forge 7.0 has no quote, label, or kind: its line does not change.
  assert.equal(canvasMessage('APP-9', [{ ...step, text: 'First line\n  second line' }], ''),
    'Canvas comments for APP-9:\n1. plan.md, Steps, "2. Add the timeout case": First line second line');
  assert.equal(canvasMessage('APP-9', [], ''), 'Canvas comments for APP-9:', 'no comment gives only the first line');
  assert.equal(canvasLine({ ...step, text: '' }), null);
});

test('the comment message cuts a long quote and removes control characters', () => {
  const long = `${'start '.repeat(40)}MIDDLE ${'end '.repeat(40)}`;
  const { quote } = canvasLine({ file: 'a.md', section: 'S', title: 'S', text: 'x', quote: long });
  assert.ok(quote.length < 240, String(quote.length));
  assert.match(quote, /^start .* \[\.\.\.\] .*end$/);
  assert.doesNotMatch(quote, /MIDDLE/);
  // An escape sequence, a line end, or a Unicode line separator cannot start a new line or a terminal command.
  const dirty = `a${char(27)}[31mb\r\nc${char(0x2028)}d${char(0x9b)}e${char(0)}f`;
  const message = canvasMessage(`K${char(10)}EY`, [{ file: dirty, section: dirty, title: dirty, text: dirty, quote: dirty }], dirty);
  assert.equal(message.split('\n').length, 3);
  assert.doesNotMatch(message.replace(/\n/g, ''), /[\u0000-\u001f\u007f-\u009f]/);
  assert.ok(!message.includes(char(0x2028)));
  assert.match(message, /^Canvas comments for K EY:\n1\. a \[31mb c d e f, /);
});

test('the page script has the message functions, LF line ends, and one request to its own server', () => {
  assert.doesNotThrow(() => new Function(CANVAS_SCRIPT));
  assert.ok(!CANVAS_SCRIPT.includes('\r'), 'a CR changes the hash of the script in the browser');
  assert.ok(!CANVAS_SCRIPT.includes('`'));
  for (const name of ['function canvasClean(', 'function canvasLine(', 'function canvasMessage(']) assert.ok(CANVAS_SCRIPT.includes(name), name);
  assert.equal(CANVAS_SCRIPT.match(/\bfetch\(/g).length, 1);
  assert.match(CANVAS_SCRIPT, /fetch\('send', \{ method: 'POST'/);
  assert.doesNotMatch(CANVAS_SCRIPT, /XMLHttpRequest|WebSocket|sendBeacon|EventSource|https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
});

test('only a served page has the token, and its relative links carry it', (t) => {
  const f = wiki(t);
  const model = buildCanvas(f.dir);
  const file = renderCanvas(model);
  assert.doesNotMatch(file, /"token"/);
  assert.match(file, /<button type="button" id="send-all" hidden>Send to agent<\/button>/);
  assert.match(file, /href="story\.md"/);
  assert.match(file, /href="evidence\/note\.md"/);
  const served = renderCanvas(model, { serve: { token: TOKEN } });
  assert.match(served, new RegExp(`"token":"${TOKEN}"`));
  assert.match(served, new RegExp(`href="story\\.md\\?t=${TOKEN}"`));
  assert.match(served, new RegExp(`href="evidence/note\\.md\\?t=${TOKEN}"`));
  assert.equal(served.match(/<script\b/g).length, 2);
  for (const id of ['pop', 'general', 'send-all', 'copy-all', 'tray-hint']) assert.ok(served.includes(`id="${id}"`), id);
  assert.throws(() => renderCanvas(model, { serve: { token: '"><script>' } }), /canvas token/);
});

test('the first port of a ticket is stable, and a request needs a loopback name, the token, and a JSON body', () => {
  assert.equal(defaultPort('APP-9'), defaultPort('APP-9'));
  for (const key of ['APP-9', 'APP-10', 'X', '']) assert.ok(defaultPort(key) >= 41000 && defaultPort(key) < 43000, key);
  const get = (headers = {}, url = `/?t=${TOKEN}`) => checkRequest({ method: 'GET', url, headers: { host: '127.0.0.1:41000', ...headers } }, TOKEN);
  const post = (headers = {}) => checkRequest({
    method: 'POST', url: '/send', headers: { host: '127.0.0.1:41000', 'x-forge-token': TOKEN, 'content-type': 'application/json', ...headers },
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

  assert.deepEqual(readSend({ comments: [{ id: 'a', file: 'plan.md', text: 'x', title: null, extra: 1 }], general: 'g' }),
    { comments: [{ id: 'a', file: 'plan.md', text: 'x' }], general: 'g' });
  assert.deepEqual(readSend({}), { comments: [], general: '' });
  for (const bad of [null, [], 'x', { comments: 'x' }, { comments: [1] }, { comments: [{ text: 5 }] }, { general: 5 }, { comments: Array.from({ length: 201 }, () => ({})) }]) {
    assert.equal(readSend(bad), null, JSON.stringify(bad)?.slice(0, 40));
  }
});

// One HTTP request without a global agent, so that the test can set each header (fetch cannot set Host).
function request(port, { method = 'GET', url = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function start(t, f, ...extra) {
  const child = spawn(process.execPath, [cli, 'canvas', 'APP-9', '--serve', ...extra, '--cwd', cwd, '--wiki', f.root], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const state = { child, stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8').on('data', (chunk) => { state.stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { state.stderr += chunk; });
  state.exit = new Promise((resolve) => { child.on('close', (code, signal) => resolve({ code, signal })); });
  state.ready = new Promise((resolve, reject) => {
    const look = () => {
      const match = /^APP-9: serving http:\/\/127\.0\.0\.1:(\d+)\/\?t=([0-9a-f]{32})\n {2}file {2}file:\/\/\S+canvas\.html\n/.exec(state.stdout);
      if (match) resolve({ port: Number(match[1]), token: match[2] });
    };
    child.stdout.on('data', look);
    child.on('close', () => reject(new Error(`The server stopped before its first line: ${state.stdout}${state.stderr}`)));
  });
  return state;
}

test('a run gives the page, refuses each bad request, prints the sent comments, and stops', async (t) => {
  const f = wiki(t);
  const run = start(t, f, '--port', '0');
  const { port, token } = await run.ready;
  const host = `127.0.0.1:${port}`;

  const page = await request(port, { url: `/?t=${token}` });
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /^text\/html/);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  assert.equal(page.headers['access-control-allow-origin'], undefined);
  assert.match(page.headers['content-security-policy'], /^default-src 'none'; script-src 'sha256-[A-Za-z0-9+/]+=*'; .*connect-src 'self'/);
  assert.match(page.text, new RegExp(`"token":"${token}"`));
  assert.match(page.text, /retries stop after 3 s/);
  // The policy names the script by its hash: the hash must be the hash of the script in the page.
  const script = /<script>([\s\S]*)<\/script>/.exec(page.text)[1];
  assert.equal(script, CANVAS_SCRIPT);

  // The page shows the current ticket files on each load.
  f.put('story.md', '---\ntype: story\n---\n# Story APP-9\n\nProblem: retries stop after 30 s.\n');
  assert.match((await request(port, { url: `/?t=${token}` })).text, /retries stop after 30 s/);

  assert.equal((await request(port, { url: '/' })).status, 403);
  const old = await request(port, { url: `/?t=${'0'.repeat(32)}` });
  assert.equal(old.status, 403);
  assert.match(old.text, /This link is old/);
  assert.equal((await request(port, { url: `/?t=${token}`, headers: { Host: 'evil.test' } })).status, 403);
  assert.equal((await request(port, { method: 'DELETE', url: `/?t=${token}` })).status, 405);

  const note = await request(port, { url: `/evidence/note.md?t=${token}` });
  assert.equal(note.status, 200);
  assert.match(note.headers['content-type'], /^text\/plain/);
  assert.match(note.text, /Retry\.Timeout/);
  assert.equal((await request(port, { url: '/evidence/note.md' })).status, 403);
  for (const url of ['/evidence/page.html', '/canvas.html', '/nope.md', '/..%2f..%2fREADME.md', '/%2e%2e/%2e%2e/outside.md', '/evidence%5cnote.md', '/send']) {
    assert.equal((await request(port, { url: `${url}?t=${token}` })).status, 404, url);
  }
  writeFileSync(path.join(f.root, 'outside.md'), '# Outside\n');
  let linked = true;
  try { symlinkSync(path.join(f.root, 'outside.md'), path.join(f.dir, 'link.md')); } catch { linked = false; }
  if (linked) assert.equal((await request(port, { url: `/link.md?t=${token}` })).status, 404, 'the server never follows a link');

  const json = { 'Content-Type': 'application/json', 'X-Forge-Token': token };
  const post = (headers, body, url = '/send') => request(port, { method: 'POST', url, headers, body });
  const good = JSON.stringify({
    comments: [
      { id: 'plan-step-2', file: 'plan.md', section: 'Steps', title: '2. Add the timeout case', text: 'Why 30 s?' },
      { id: 'story-scope', file: 'story.md', section: 'Scope', title: 'Scope', text: '', kind: 'remove', quote: 'The retry job' },
    ],
    general: `Too long.${char(27)}[2J`,
  });
  assert.equal((await post({ ...json, 'X-Forge-Token': 'x' }, good)).status, 403);
  assert.equal((await post({ 'Content-Type': 'application/json' }, good)).status, 403);
  assert.equal((await post({ ...json, Origin: 'https://evil.test' }, good)).status, 403);
  assert.equal((await post({ ...json, 'Sec-Fetch-Site': 'cross-site' }, good)).status, 403);
  assert.equal((await post({ ...json, 'Content-Type': 'text/plain' }, good)).status, 415);
  assert.equal((await post(json, good, '/other')).status, 404);
  assert.equal((await post(json, '{not json')).status, 400);
  assert.equal((await post(json, '{"comments":"x"}')).status, 400);
  assert.equal((await post(json, '{"comments":[],"general":"  "}')).status, 400, 'a message without a comment is refused');
  assert.equal((await post(json, JSON.stringify({ general: 'x'.repeat(300 * 1024) }))).status, 413);
  assert.equal(run.child.exitCode, null, 'a refused request does not stop the server');
  assert.doesNotMatch(run.stdout, /Canvas comments/);

  const sent = await post({ ...json, Origin: `http://${host}`, 'Sec-Fetch-Site': 'same-origin' }, good);
  assert.equal(sent.status, 200);
  assert.deepEqual(JSON.parse(sent.text), { ok: true });
  assert.deepEqual(await run.exit, { code: 0, signal: null });
  assert.match(run.stdout, /\n  not written yet: review\.md, proof\.md, map\.md, journal\.md\nCanvas/);
  assert.equal(run.stdout.slice(run.stdout.indexOf('Canvas comments')), [
    'Canvas comments for APP-9:',
    '1. plan.md, Steps, "2. Add the timeout case": Why 30 s?',
    '2. story.md, Scope, on "The retry job": remove this',
    '3. Whole ticket: Too long. [2J',
    '',
  ].join('\n'));
  assert.equal(run.stderr, '');
  assert.match(readFileSync(path.join(f.dir, 'canvas.html'), 'utf8'), /^<!doctype html>/, 'the file page is the fallback');
});

test('a stop signal ends the server without a message', { skip: process.platform === 'win32' }, async (t) => {
  const f = wiki(t);
  const run = start(t, f, '--port', '0');
  await run.ready;
  run.child.kill('SIGTERM');
  assert.deepEqual(await run.exit, { code: 143, signal: null });
  assert.doesNotMatch(run.stdout, /Canvas comments/);
  assert.match(run.stderr, /the canvas server stopped\. No comments were sent\./);
});

test('the server uses the stable port of the ticket, and a busy fixed port is an error', async (t) => {
  const f = wiki(t);
  const first = start(t, f);
  const { port } = await first.ready;
  assert.ok(port >= defaultPort('APP-9') && port < defaultPort('APP-9') + 10, String(port));

  const busy = net.createServer();
  await new Promise((resolve) => { busy.listen(0, '127.0.0.1', resolve); });
  t.after(() => busy.close());
  const run = (...args) => spawnSync(process.execPath, [cli, 'canvas', 'APP-9', ...args, '--cwd', cwd, '--wiki', f.root], { encoding: 'utf8', timeout: 20000 });
  const taken = run('--serve', '--port', String(busy.address().port));
  assert.equal(taken.status, 1);
  assert.match(taken.stderr, /Port \d+ is in use/);
  for (const args of [['--serve', '--json'], ['--port', '5000'], ['--serve', '--port', '80'], ['--serve', '--port', '70000'], ['--serve', '--port', 'x']]) {
    const result = run(...args);
    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, /Usage: forge\.mjs canvas <key> \[--json\] \[--links vscode\|file\] \[--serve \[--port <n>\]\]/);
  }
  first.child.kill('SIGTERM');
  await first.exit;
});
