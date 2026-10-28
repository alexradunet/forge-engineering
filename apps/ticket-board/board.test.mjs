import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { splitFrontmatter, validate, docTypeFor } from './lib/frontmatter.mjs';
import { loadTicket, parseLog, boardSummary, changeLabel, isTicketDir } from './lib/tickets.mjs';
import { loadBoardConfig, itemUrlFor } from './lib/config.mjs';
import { renderMarkdown, rewriteHref } from './lib/render.mjs';
import { createApp, safeDocPath } from './server.mjs';

const README = `---
type: ticket
key: APP-1
title: Fix the thing
track: M
phase: plan
state: needs-me
next: Approve the plan.
waiting_on: "you: Designed?"
changes:
  - { url: https://github.com/o/r/pull/7, state: draft }
gates:
  - { name: Briefed?, doc: context.md, status: approved, date: 2026-10-26 }
  - { name: Designed?, doc: plan.draft.md, status: in-review }
updated: 2026-10-27
---
# APP-1 — Fix the thing
`;

function fixture() {
  const wiki = mkdtempSync(join(tmpdir(), 'board-'));
  const dir = join(wiki, 'raw', 'tickets', 'app-1');
  mkdirSync(join(dir, 'evidence'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), README);
  writeFileSync(join(dir, 'context.md'), '---\ntype: context\nticket: APP-1\ngate: Briefed?\n---\n# Context\n[plan](plan.draft.md) [x](javascript:alert(1)) <script>x</script>');
  writeFileSync(join(dir, 'plan.draft.md'), '# Plan without frontmatter\n');
  writeFileSync(join(dir, 'log.md'), '---\ntype: log\nticket: APP-1\n---\n# Log\n\n## 2026-10-26 start\n\n- a\n\n## 2026-10-27 plan\n\n- b\n');
  writeFileSync(join(dir, 'evidence', '2026-10-27-x.md'), '---\ntype: evidence\nticket: APP-1\ndate: 2026-10-27\n---\n# X\n');
  mkdirSync(join(wiki, 'tickets'));
  writeFileSync(join(wiki, 'tickets', 'app-0.md'), '---\ntitle: APP-0 — Old thing\nupdated: 2026-10-01\nstatus: verified\n---\n# APP-0 — Old thing\n');
  return { wiki, dir };
}

test('splitFrontmatter parses YAML and keeps the body', () => {
  const { data, body, error } = splitFrontmatter(README);
  assert.equal(error, null);
  assert.equal(data.key, 'APP-1');
  assert.match(body, /^# APP-1/);
  assert.equal(splitFrontmatter('# none').data, null);
  assert.match(splitFrontmatter('---\n: [\n---\n').error, /invalid YAML/);
});

test('validate reports schema problems', () => {
  assert.deepEqual(validate('ticket', splitFrontmatter(README).data, 'APP-1'), []);
  const bad = validate('ticket', { type: 'ticket', key: 'x', phase: 'done', gates: [{ name: 'Nope?', status: 'approved' }] }, 'APP-1');
  assert.ok(bad.some((p) => p.includes('"key"')));
  assert.ok(bad.some((p) => p.includes('"phase"')));
  assert.ok(bad.some((p) => p.includes('without "date"')));
  assert.deepEqual(validate('context', null), ['missing frontmatter']);
  assert.ok(validate('outbox', { type: 'outbox', ticket: 'APP-1' }, 'APP-1').includes('missing "status"'));
  assert.equal(docTypeFor('evidence/a.md'), 'evidence');
  assert.equal(docTypeFor('plan.draft.md'), 'plan-draft');
});

test('validate accepts the vocabulary and rejects the old aliases', () => {
  const base = { type: 'ticket', key: 'APP2-123', title: 't', phase: 'plan', state: 'needs-me', gates: [] };
  assert.deepEqual(validate('ticket', { ...base, item: 'https://gitlab.com/g/p/-/issues/123', changes: [{ url: 'https://gitlab.com/g/p/-/merge_requests/9', state: 'open' }] }), []);
  assert.deepEqual(validate('ticket', { ...base, item: 'https://x.atlassian.net/browse/APP2-123', changes: [{ url: 'https://github.com/o/r/pull/7' }] }), []);
  assert.ok(validate('ticket', { ...base, changes: [{ url: 'nope' }] }).some((p) => p.includes('changes[0].url')));
  assert.ok(validate('ticket', { ...base, changes: 'x' }).includes('"changes" must be a list'));
  for (const target of ['tracker-comment', 'tracker-item', 'change']) {
    assert.deepEqual(validate('outbox', { type: 'outbox', ticket: 'APP-1', status: 'draft', target }, 'APP-1'), []);
  }
  assert.ok(validate('outbox', { type: 'outbox', ticket: 'APP-1', status: 'draft', target: 'slack' }, 'APP-1').some((p) => p.includes('"target"')));
  assert.ok(validate('outbox', { type: 'outbox', ticket: 'APP-1', status: 'draft', target: 'jira-comment' }, 'APP-1').some((p) => p.includes('"target"')));
  assert.equal(docTypeFor('ticket.md'), 'item-snapshot');
  assert.deepEqual(validate('item-snapshot', { type: 'item-snapshot', ticket: 'APP-1' }, 'APP-1'), []);
  assert.ok(validate('item-snapshot', { type: 'jira-snapshot', ticket: 'APP-1' }, 'APP-1').some((p) => p.includes('"type"')));
  assert.ok(validate('item-snapshot', { type: 'context', ticket: 'APP-1' }, 'APP-1').some((p) => p.includes('"type"')));
});

test('loadTicket builds the card and lists problems', () => {
  const { wiki, dir } = fixture();
  try {
    const t = loadTicket(dir, 'app-1');
    assert.equal(t.key, 'APP-1');
    assert.equal(t.stateEmoji, '🟡');
    assert.equal(t.waitsOnMe, true);
    assert.equal(t.gates[0].date, '2026-10-26');
    assert.equal(t.changes[0].label, '#7');
    assert.equal(t.log[0].title, '2026-10-27 plan');
    assert.deepEqual(t.problems, [{ file: 'plan.draft.md', problem: 'missing frontmatter' }]);
    const b = boardSummary(wiki);
    assert.equal(b.tickets.length, 1);
    assert.equal(b.closed[0].title, 'Old thing');
  } finally { rmSync(wiki, { recursive: true, force: true }); }
});

test('board config fills the item link and the UI words', () => {
  const { wiki, dir } = fixture();
  try {
    const cfgDir = join(wiki, 'config');
    mkdirSync(cfgDir);
    let cfg = loadBoardConfig(cfgDir);
    assert.deepEqual([cfg.files, cfg.itemUrl, cfg.changeName, cfg.itemLabel], [[], null, 'PR', 'Work item']);
    assert.equal(loadTicket(dir, 'app-1', cfg).item, null);

    writeFileSync(join(cfgDir, 'tracker.md'), '---\nprovider: gitlab\nitemUrl: https://gitlab.com/g/p/-/issues/{number}\n---\n# Tracker\n');
    writeFileSync(join(cfgDir, 'repo.md'), '---\nprovider: gitlab\n---\n# Repo\n');
    cfg = loadBoardConfig(cfgDir);
    assert.equal(cfg.changeName, 'MR');
    const t = loadTicket(dir, 'app-1', cfg);
    assert.equal(t.item, 'https://gitlab.com/g/p/-/issues/1');
    assert.deepEqual(t.labels, { item: 'Issue', change: 'MR' });
    assert.deepEqual(boardSummary(wiki, cfg).labels, { item: 'Issue', change: 'MR' });
    assert.equal(itemUrlFor('APP2-45', { itemUrl: 'https://x.atlassian.net/browse/{KEY}' }), 'https://x.atlassian.net/browse/APP2-45');
    assert.equal(changeLabel('https://gitlab.com/g/p/-/merge_requests/9'), '!9');
    assert.equal(isTicketDir('app2-45'), true);
    assert.equal(isTicketDir('2app-45'), false);

    writeFileSync(join(cfgDir, 'repo.md'), '---\nprovider: [gitlab\n---\n');
    cfg = loadBoardConfig(cfgDir);
    assert.match(cfg.error, /repo\.md/);
    assert.equal(cfg.changeName, 'PR');
  } finally { rmSync(wiki, { recursive: true, force: true }); }
});

test('parseLog returns newest entries first', () => {
  assert.deepEqual(parseLog('## 2026-01-01 a\n\nx\n## 2026-01-02 b\ny').map((e) => e.title), ['2026-01-02 b', '2026-01-01 a']);
});

test('renderMarkdown escapes HTML and rewrites links', () => {
  const html = renderMarkdown('[plan](plan.draft.md) [js](javascript:alert(1)) [code](C:/dev/x.cs:42) [web](https://a.b) <b>hi</b>', { dir: 'C:\\w\\t', key: 'APP-1' });
  assert.match(html, /href="#\/APP-1\/plan.draft.md"/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /href="vscode:\/\/file\/C:\/dev\/x.cs:42"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /&lt;b&gt;hi&lt;\/b&gt;/);
  assert.equal(rewriteHref('data:text/html,x', { dir: 'C:\\w' }), null);
  assert.doesNotMatch(renderMarkdown('a\n\n<!-- send: start -->\n\nb'), /send: start/);
});

test('safeDocPath blocks traversal and non-Markdown', () => {
  const { wiki, dir } = fixture();
  try {
    assert.ok(safeDocPath(dir, 'context.md'));
    assert.ok(safeDocPath(dir, 'evidence/2026-10-27-x.md'));
    assert.equal(safeDocPath(dir, '../../tickets/app-0.md'), null);
    assert.equal(safeDocPath(dir, 'briefing.json'), null);
  } finally { rmSync(wiki, { recursive: true, force: true }); }
});

test('server serves the API read-only on 127.0.0.1', async () => {
  const { wiki } = fixture();
  const server = createApp(wiki);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await (await fetch(`${base}/api/health`)).json()).app, 'forge-ticket-board');
    assert.equal((await (await fetch(`${base}/api/board`)).json()).tickets[0].key, 'APP-1');
    const t = await (await fetch(`${base}/api/ticket/app-1`)).json();
    assert.equal(t.title, 'Fix the thing');
    assert.match(t.readmeHtml, /<h1>/);
    const d = await (await fetch(`${base}/api/doc/APP-1/context.md`)).json();
    assert.equal(d.frontmatter.gate, 'Briefed?');
    assert.doesNotMatch(d.html, /<script>/);
    assert.equal((await fetch(`${base}/api/doc/APP-1/..%2F..%2F..%2Ftickets%2Fapp-0.md`)).status, 404);
    assert.equal((await fetch(`${base}/api/ticket/..%2Fx`)).status, 404);
    assert.equal((await fetch(`${base}/api/board`, { method: 'POST' })).status, 405);
    const status = await new Promise((r, j) => request(`${base}/api/board`, { headers: { host: 'evil.example' } }, (res) => { res.resume(); r(res.statusCode); }).on('error', j).end());
    assert.equal(status, 403);
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/..%2Fserver.mjs`)).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    rmSync(wiki, { recursive: true, force: true });
  }
});
