import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { request } from 'node:http';
import { runInNewContext } from 'node:vm';
import { parseDocument, parseTicket, readTicketDoc, readTickets, validateInput } from '../plugins/forge/com.github.copilot/extensions/ticket-dashboard/tickets.mjs';
import { dashboardOptions } from '../plugins/forge/com.github.copilot/extensions/ticket-dashboard/dashboard.mjs';

function ticket(fields = '') {
  return `---\ntype: ticket\nkey: APP-42\ntitle: Build dashboard\nphase: implement\nstate: active\ntrack: M\nnext: Run tests\n${fields}---\n# Ticket\n`;
}

async function fixture(t) {
  const wiki = await mkdtemp(path.join(os.tmpdir(), 'forge-dashboard-'));
  t.after(() => rm(wiki, { recursive: true, force: true }));
  return wiki;
}

async function put(wiki, folder, content) {
  const dir = path.join(wiki, 'raw', 'tickets', folder);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'README.md');
  await writeFile(file, content);
  return file;
}

class TestCanvasError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function canvas(t) {
  const errors = [];
  const options = dashboardOptions(TestCanvasError, (error) => errors.push(error));
  t.after(() => options.onClose({ instanceId: 'test' }));
  return { options, errors };
}

test('ticket parser reads template fields, comments, Unicode, quoted punctuation, and gate objects', () => {
  const parsed = parseTicket(ticket(`waiting_on: "you: Designed?"
branch: feature/app-42
updated: 2026-10-28
gates:
  - { name: Designed?, doc: plan.draft.md, need: required, status: in-review } # pending
  - name: "Shippable?, later"
    need: recommended
    status: approved
    date: 2026-10-28
    note: 'It''s done: yes # keep'
changes:
  - { url: https://example.test/pull/42, label: "#42", state: draft }
`));
  assert.equal(parsed.waitingOn, 'you: Designed?');
  assert.equal(parsed.gates[0].status, 'in-review');
  assert.equal(parsed.gates[1].name, 'Shippable?, later');
  assert.equal(parsed.gates[1].note, "It's done: yes # keep");
  assert.equal(parsed.changes[0].label, '#42');
  assert.equal(parseTicket(ticket().replace('Build dashboard', 'Build 🧭 dashboard')).title, 'Build 🧭 dashboard');
});

test('the repository ticket template parses after its placeholders are filled', async () => {
  const template = await readFile(new URL('../plugins/forge/skills/ticket/templates/README.md', import.meta.url), 'utf8');
  const filled = template.replaceAll('<KEY>', 'APP-42')
    .replaceAll('<work item summary>', 'Dashboard').replaceAll('<work item URL>', 'https://example.test/42')
    .replaceAll('<one sentence>', 'Implement dashboard').replaceAll('<from repo.branchPattern>', 'APP-42-dashboard')
    .replaceAll('<yyyy-mm-dd>', '2026-10-28');
  const parsed = parseTicket(filled.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
  assert.equal(parsed.state, 'active');
  assert.equal(parsed.workflow, 'full-v1');
  assert.equal(parsed.track, null);
  assert.equal(parsed.gates.every((gate) => gate.need === 'required' && gate.status === 'todo'), true);
  assert.deepEqual(parsed.gates.map((gate) => gate.name).sort(), ['Understood?', 'Agreed?', 'Diagnosed?', 'Designed?', 'Shippable?', 'Sendable?', 'Learned?'].sort());
  assert.doesNotMatch(filled, /^track:/m);
  assert.equal(parsed.gates.length, 7);
  assert.deepEqual(parsed.changes, []);
});

test('folded ticket fields preserve paragraphs, indentation, and chomping', () => {
  for (const [indicator, expected] of [
    ['>-', 'First line second line\nThird paragraph\n  indented\nlast'],
    ['>', 'First line second line\nThird paragraph\n  indented\nlast\n'],
    ['>+', 'First line second line\nThird paragraph\n  indented\nlast\n\n'],
    ['|-', 'First line\nsecond line\n\nThird paragraph\n  indented\nlast'],
    ['|', 'First line\nsecond line\n\nThird paragraph\n  indented\nlast\n'],
  ]) {
    const source = ticket(`worktree: ${indicator} # block comment
  First line
  second line

  Third paragraph
    indented
  last

branch: feature/test
`).replace('next: Run tests', 'next: >-\n  Run tests\n  and inspect results');
    const parsed = parseTicket(source);
    assert.equal(parsed.next, 'Run tests and inspect results');
    assert.equal(parsed.worktree, expected);
    assert.equal(parsed.branch, 'feature/test');
  }
});

test('inline object lists support changes and gates without losing quoted punctuation', () => {
  const parsed = parseTicket(ticket(`changes: [{ url: https://example.test/42, label: "#42, fix", state: draft }]
gates: [{ name: "Designed?", need: required, status: todo }]
`));
  assert.equal(parsed.changes[0].label, '#42, fix');
  assert.equal(parsed.gates[0].name, 'Designed?');
  assert.throws(() => parseTicket(ticket('changes: [null]\n')), /Invalid change/);
  assert.throws(() => parseTicket(ticket('gates: [null]\n')), /Invalid gate/);
});

test('legacy tickets without a track show Unspecified instead of an inferred size', () => {
  assert.equal(parseTicket(ticket().replace('track: M\n', '')).track, 'Unspecified');
  assert.equal(parseTicket(ticket().replace('track: M', 'track:')).track, 'Unspecified');
  assert.throws(() => parseTicket(ticket().replace('track: M', 'track: XL')), /Unknown ticket track/);
});

test('new tickets show full workflow without an invented track and surface approval findings', async (t) => {
  const wiki = await fixture(t);
  const file = await put(wiki, 'full', ticket(`gates:
  - { name: Diagnosed?, need: required, status: skipped }
`).replace('track: M', 'workflow: full-v1'));
  const result = await readTickets(wiki);
  assert.equal(result.errors.length, 0);
  assert.equal(result.tickets[0].workflow, 'full-v1');
  assert.equal(result.tickets[0].track, null);
  assert.ok(result.tickets[0].findings.some((finding) => finding.code === 'workflow-gate'));
  assert.equal(result.tickets[0].file, await realpath(file));
  const ui = await readFile(new URL('../plugins/forge/com.github.copilot/extensions/ticket-dashboard/ui.js', import.meta.url), 'utf8');
  const node = () => ({ textContent: '', children: [], append(...children) { this.children.push(...children); }, addEventListener() {} });
  const controls = new Map();
  const renderCard = (ticket) => runInNewContext(`${ui}\ncard(ticket);`, {
    ticket, URL, setInterval() {}, fetch: () => new Promise(() => {}),
    document: {
      createElement: node,
      getElementById(id) { if (!controls.has(id)) controls.set(id, node()); return controls.get(id); },
    },
  });
  const text = (element) => [element.textContent, ...element.children.map(text)].join('\n');
  const full = text(renderCard(result.tickets[0]));
  assert.match(full, /Full workflow/);
  assert.match(full, /workflow-gate/);
  assert.doesNotMatch(full, /[Tt]rack|Unspecified/);
  assert.match(text(renderCard(parseTicket(ticket()))), /Legacy track M/);
});
test('invalid frontmatter reports errors rather than guessing', () => {
  for (const [source, pattern] of [
    ['# no frontmatter', /needs frontmatter/],
    [ticket().replace('state: active', 'state: unknown'), /Unknown ticket state/],
    [ticket().replace('phase: implement', 'phase: unknown'), /Unknown ticket phase/],
    [ticket().replace('track: M', 'track: XL'), /Unknown ticket track/],
    [ticket().replace('title: Build dashboard', 'title:'), /invalid title/],
    [ticket('title: Duplicate\n'), /Duplicate field/],
    [ticket('waiting_on: []\n'), /Invalid waiting_on/],
    [ticket().replace('next: Run tests', 'next: "unfinished'), /Unclosed/],
    [ticket('gates:\n  - { name: Go?, need: required, status: approved }\n'), /needs a date/],
    [ticket('gates:\n  - { name: Go?, need: required, status: typo }\n'), /gate name or status/],
    [ticket('gates:\n  - { name: Go?, need: optional, status: todo }\n'), /gate need/],
    [ticket('gates: nope\n'), /must be a list/],
    [ticket('changes:\n  - { url: https://example.test, state: typo }\n'), /Invalid change/],
    [ticket().replace('title: Build dashboard', 'title: &anchor text'), /Unsupported/],
  ]) assert.throws(() => parseTicket(source), pattern);
});

test('canvas inputs require one absolute wiki path', () => {
  for (const input of [null, [], {}, { wikiPath: '.' }, { wikiPath: 12 }, { wikiPath: os.tmpdir(), extra: true }]) {
    assert.throws(() => validateInput(input), /absolute wikiPath/);
  }
  assert.equal(validateInput({ wikiPath: os.tmpdir() }), path.normalize(os.tmpdir()));
});

test('empty wiki and absent ticket folders are valid; absent wiki is an error', async (t) => {
  const wiki = await fixture(t);
  assert.deepEqual((await readTickets(wiki)).tickets, []);
  await mkdir(path.join(wiki, 'raw'));
  assert.deepEqual((await readTickets(wiki)).tickets, []);
  await assert.rejects(readTickets(path.join(wiki, 'absent')), /ENOENT/);
});

test('reader isolates malformed tickets, notices edits, and performs no writes', async (t) => {
  const wiki = await fixture(t);
  const file = await put(wiki, 'app-42', ticket());
  await put(wiki, 'broken', '# missing frontmatter');
  let result = await readTickets(wiki);
  assert.equal(result.tickets.length, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].file, /broken/);
  assert.equal(await readFile(file, 'utf8'), ticket());
  assert.deepEqual(await readdir(wiki), ['raw']);
  await writeFile(file, ticket().replace('state: active', 'state: blocked'));
  result = await readTickets(wiki);
  assert.equal(result.tickets[0].state, 'blocked');
  await put(wiki, 'duplicate', ticket());
  assert.ok((await readTickets(wiki)).errors.some((error) => /Duplicate ticket key/.test(error.message)));
});

test('reader rejects symlinked ticket directories and oversized README files', async (t) => {
  const wiki = await fixture(t);
  const outside = await fixture(t);
  await mkdir(path.join(wiki, 'raw', 'tickets'), { recursive: true });
  await symlink(outside, path.join(wiki, 'raw', 'tickets', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await put(wiki, 'huge', 'x'.repeat(1024 * 1024 + 1));
  const result = await readTickets(wiki);
  assert.equal(result.tickets.length, 0);
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors.some((error) => /not a link/.test(error.message)));
  assert.ok(result.errors.some((error) => error.file.endsWith(path.join('huge', 'README.md')) && /1 MiB/.test(error.message)));
});

test('canvas opens, reads live state, reuses its server, and closes it', async (t) => {
  const wiki = await fixture(t);
  const file = await put(wiki, 'app-42', ticket());
  const { options, errors } = canvas(t);
  const ctx = { instanceId: 'test', input: { wikiPath: wiki } };
  const first = await options.open(ctx);
  assert.equal(first.title, 'Forge tickets');
  assert.match(first.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const page = await fetch(first.url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Ticket dashboard/);
  for (const asset of ['ui.js', 'ui.css', 'vendor/mermaid.min.js']) assert.equal((await fetch(new URL(asset, first.url))).status, 200);
  const action = options.actions.find((entry) => entry.name === 'refresh');
  assert.equal((await action.handler({ instanceId: ctx.instanceId })).tickets[0].state, 'active');
  await writeFile(file, ticket().replace('state: active', 'state: waiting'));
  assert.equal((await options.open(ctx)).url, first.url);
  assert.equal((await (await fetch(new URL('state', first.url))).json()).tickets[0].state, 'waiting');
  assert.equal((await action.handler({ instanceId: ctx.instanceId })).tickets[0].state, 'waiting');
  assert.equal(await readFile(file, 'utf8'), ticket().replace('state: active', 'state: waiting'));
  await options.onClose(ctx);
  await assert.rejects(fetch(first.url));
  assert.deepEqual(errors, []);
});

test('concurrent opens reuse one server and separate instances keep separate wikis', async (t) => {
  const wiki = await fixture(t);
  const other = await fixture(t);
  const { options } = canvas(t);
  const ctx = { instanceId: 'test', input: { wikiPath: wiki } };
  const [a, b] = await Promise.all([options.open(ctx), options.open(ctx)]);
  assert.equal(a.url, b.url);
  const second = await options.open({ instanceId: 'second', input: { wikiPath: other } });
  t.after(() => options.onClose({ instanceId: 'second' }));
  assert.notEqual(a.url, second.url);
  assert.equal((await options.actions[0].handler({ instanceId: 'second' })).wikiPath, await realpath(other));
  const switched = await options.open({ ...ctx, input: { wikiPath: other } });
  assert.notEqual(switched.url, a.url);
  await assert.rejects(fetch(a.url));
});

test('canvas failures use CanvasError and leave an existing dashboard usable', async (t) => {
  const wiki = await fixture(t);
  const { options } = canvas(t);
  const ctx = { instanceId: 'test', input: { wikiPath: wiki } };
  const result = await options.open(ctx);
  await assert.rejects(options.open({ ...ctx, input: { wikiPath: 'relative' } }), { code: 'forge_dashboard_error' });
  assert.equal((await fetch(result.url)).status, 200);
  await assert.rejects(options.actions[0].handler({ instanceId: 'missing' }), { code: 'forge_dashboard_error' });
  await assert.rejects(options.actions[0].handler({ instanceId: 'test', input: { wikiPath: wiki } }), /takes no input/);
});

function httpStatus(url, headers) {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
}

test('HTTP server rejects foreign origins, rebinding, unknown routes, queries, and writes', async (t) => {
  const wiki = await fixture(t);
  const { options, errors } = canvas(t);
  const { url } = await options.open({ instanceId: 'test', input: { wikiPath: wiki } });
  assert.equal(await httpStatus(url, { Host: 'attacker.test' }), 403);
  assert.equal(await httpStatus(url, { Origin: 'https://attacker.test' }), 403);
  assert.equal(await httpStatus(url, { 'Sec-Fetch-Site': 'cross-site' }), 403);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  assert.equal((await fetch(new URL('missing', url))).status, 404);
  assert.equal((await fetch(`${url}?wikiPath=elsewhere`)).status, 400);
  const response = await fetch(new URL('state', url));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  await rm(wiki, { recursive: true, force: true });
  const failure = await fetch(new URL('state', url));
  assert.equal(failure.status, 500);
  assert.match((await failure.json()).error, /ENOENT/);
  assert.equal(errors.length, 1);
});

test('reader discovers categorized ticket documents, detects Mermaid blocks, and serves them safely over HTTP', async (t) => {
  const wiki = await fixture(t);
  await put(wiki, 'app-42', `${ticket().trimEnd()}\n\n> 🔥 Cut N+1 queries from 312 to 2\n`);
  const dir = path.join(wiki, 'raw', 'tickets', 'app-42');
  await mkdir(path.join(dir, 'evidence'), { recursive: true });
  await mkdir(path.join(dir, 'outbox'), { recursive: true });
  await writeFile(path.join(dir, 'map.md'), '---\ntype: map\nticket: APP-42\nupdated: 2026-10-28\n---\n# 🗺️ Code map — APP-42\n```mermaid\nflowchart LR\n  A --> B\n```\n');
  await writeFile(path.join(dir, 'context.md'), '---\ntype: context\ngate: Understood?\nupdated: 2026-10-28\n---\n# 🧭 Context\n> 🔥 Stakes line\n');
  await writeFile(path.join(dir, 'evidence', '2026-10-28-spike.md'), '---\ndate: 2026-10-28\n---\n# Spike result\n');
  await writeFile(path.join(dir, 'outbox', 'pr.draft.md'), '---\ntype: outbox\nstatus: draft\ntarget: change\n---\n# PR draft\n');

  const state = await readTickets(wiki);
  assert.equal(state.tickets.length, 1);
  const found = state.tickets[0];
  assert.equal(found.folder, 'app-42');
  assert.equal(found.summary, 'Cut N+1 queries from 312 to 2');
  assert.deepEqual(
    found.docs.map((d) => [d.path, d.category, d.hasMermaid]),
    [
      ['README.md', 'core', false],
      ['map.md', 'core', true],
      ['context.md', 'gate', false],
      ['evidence/2026-10-28-spike.md', 'evidence', false],
      ['outbox/pr.draft.md', 'outbox', false],
    ],
  );

  const parsedDoc = parseDocument(await readFile(path.join(dir, 'context.md'), 'utf8'), 'context.md');
  assert.equal(parsedDoc.gate, 'Understood?');
  assert.equal(parsedDoc.hero, 'Stakes line');

  const { options } = canvas(t);
  const { url } = await options.open({ instanceId: 'test', input: { wikiPath: wiki } });
  const mapRes = await fetch(new URL('tickets/app-42/docs/map.md', url));
  assert.equal(mapRes.status, 200);
  const mapJson = await mapRes.json();
  assert.equal(mapJson.category, 'core');
  assert.match(mapJson.body, /flowchart LR/);

  const evRes = await fetch(new URL('tickets/app-42/docs/evidence/2026-10-28-spike.md', url));
  assert.equal(evRes.status, 200);
  assert.equal((await evRes.json()).category, 'evidence');

  // Path traversal, non-md files, and unknown subdirectories are rejected
  await assert.rejects(readTicketDoc(wiki, '../outside', 'README.md'), /Invalid ticket folder/);
  await assert.rejects(readTicketDoc(wiki, 'app-42', '../README.md'), /Invalid document/);
  await assert.rejects(readTicketDoc(wiki, 'app-42', 'secrets/token.md'), /Invalid document subdirectory/);
  await assert.rejects(readTicketDoc(wiki, 'app-42', 'notes.txt'), /Invalid document path/);
  assert.equal((await fetch(new URL('tickets/app-42/docs/missing.md', url))).status, 404);
  assert.equal((await fetch(new URL('tickets/app-42/docs/other/file.md', url))).status, 400);
});

test('Agent Plugins manifest declares a namespaced canvas extension', async () => {
  const plugin = new URL('../plugins/forge/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('plugin.json', plugin), 'utf8'));
  assert.equal(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(typeof manifest.extensions, 'object');
  assert.ok(!Array.isArray(manifest.extensions));
  const namespace = 'com.github.copilot';
  assert.equal(manifest.extensions[namespace].extensions, 'extensions/');
  const source = await readFile(new URL(`${namespace}/${manifest.extensions[namespace].extensions}ticket-dashboard/extension.mjs`, plugin), 'utf8');
  assert.match(source, /@github\/copilot-sdk\/extension/);
});
