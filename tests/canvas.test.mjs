// The ticket canvas: the model that forge reads from the ticket files, and the self-contained page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TIERS, buildCanvas, focusGate, linkTarget, markdown, numberedItems, renderCanvas, tableRow, writeCanvas } from '../plugins/forge/scripts/lib/canvas.mjs';

const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));
const templates = fileURLToPath(new URL('../plugins/forge/skills/ticket/templates/', import.meta.url));

function wiki(t, { workflow = 'full-v3' } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'forge-canvas-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'raw', 'tickets', 'app-9');
  const put = (name, text) => {
    const file = path.join(dir, ...name.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  put('README.md', [
    '---', 'type: ticket', 'key: APP-9', 'title: Outbox retry stops too early', 'short: Fix outbox retry on timeout', `workflow: ${workflow}`,
    'phase: plan', 'state: needs-me', 'next: Approve the plan', 'waiting_on: "you: Planned?"', 'changes: []',
    'people:', '  - { name: Ana, role: reviewer, status: waiting, since: 2026-11-10, ask: "Is the old key in use?" }',
    'gates:', '  - { name: Scoped?, doc: story.md, need: required, status: in-review }',
    '  - { name: Planned?, doc: plan.md, need: required, status: in-review }', 'updated: 2026-11-12', '---',
    '# APP-9: Outbox retry', '', '## Now', '', '- State: 🟡 needs-me', '- Phase: plan', '- Next: Approve the plan', '',
  ].join('\n'));
  return { root, dir, put };
}

function fill({ put }) {
  put('story.md', [
    '---', 'type: story', 'ticket: APP-9', 'gate: Scoped?', '---', '# Story APP-9: Outbox retry', '',
    'Problem: retries stop after 3 s.', '', 'Need from you: GO on Scoped?.', '',
    '## Scope', '', 'In:', '', '- The retry job', '', 'Out:', '', '- The sender', '',
    '## Open questions', '', '- Is the old key in use? Ask: Ana. Status: asked. If the answer differs: keep a fallback', '',
  ].join('\n'));
  put('plan.md', [
    '---', 'type: plan', 'ticket: APP-9', 'gate: Planned?', '---', '# Plan APP-9: Outbox retry', '',
    'Cause: the job reads the wrong key.', '',
    '## Diagnosis', '', '- H1 supported: the job reads `Retry.Timeout` ([evidence](evidence/2026-11-11-config.md))', '- H2 rejected: the clock is wrong', '',
    '## Steps', '', '1. Read the new key', '   - Files: [RetryJob.cs](/repo/src/RetryJob.cs:42)', '   - Why: the old key is 3 s',
    '2. Add the timeout case', '   - Files: [RetryJobTests.cs](C:\\repo\\tests\\RetryJobTests.cs)', '3. Remove the old key', '',
    '## Risks', '', '- 🟡 medium: tenants with the old key get 30 s.', '',
  ].join('\n'));
  put('map.md', [
    '---', 'type: map', 'ticket: APP-9', '---', '# Map APP-9: outbox retry', '', 'The retry job sends failed outbox rows again.', '',
    '## Components', '', '| Component | Layer | File | Role | Change |', '|---|---|---|---|---|',
    '| RetryJob | Service | [RetryJob.cs](/repo/src/RetryJob.cs) | Sends rows again | planned |',
    '| OutboxConfig | Service | | Holds the timeout \\| in seconds | done |',
    '| Outbox table | SQL | | The failed rows | |', '',
    '## Flow', '', '- RetryJob -> OutboxConfig: reads the timeout', '- RetryJob -> Outbox table: selects failed rows', '- Scheduler → RetryJob', '',
    '## Terms', '', '- Outbox: rows that wait for a send', '',
  ].join('\n'));
  put('journal.md', [
    '---', 'type: journal', 'ticket: APP-9', '---', '# Journal APP-9', '',
    '## 2026-11-11 log: research', '', 'Read the wiki.', '',
    '## 2026-11-12 step 1 done: read the new key', '', 'Commit abc.', '',
    '## 2026-11-12 step 2 done: timeout case', '', '## 2026-11-13 step 1 verified: deployed check', '',
    '## 2026-11-13 decision: keep no fallback', '', 'Reason: no tenant uses it.', '',
  ].join('\n'));
  put('proof.md', [
    '---', 'type: proof', 'ticket: APP-9', '---', '# Proof APP-9: Outbox retry', '', 'Result: 1 of 3 checks verified.', '',
    '## Checks', '', '1. 🟢 verified: a retry waits 30 s', '   - Observed: 30 s', '2. 🔴 failed: the old key is ignored', '3. ⚪ not proven: telemetry shows the retry', '4. open: the unhappy path', '',
  ].join('\n'));
}

test('table rows and numbered items keep escaped pipes and the indented body of each item', () => {
  assert.deepEqual(tableRow('| a | b \\| c |  |'), ['a', 'b | c', '']);
  assert.deepEqual(numberedItems('1. First\n   - Files: x\n   - Why: y\n2. Second\n\n3) Third\n'), [
    { n: 1, title: 'First', body: '- Files: x\n- Why: y' }, { n: 2, title: 'Second', body: '' }, { n: 3, title: 'Third', body: '' },
  ]);
});

test('the model of a full-v3 ticket has the story, the code graph, the plan path, the proof, and the journal', (t) => {
  const f = wiki(t);
  fill(f);
  const model = buildCanvas(f.dir, { now: new Date('2026-11-17T08:00:00Z') });
  assert.equal(model.layout, 'board');
  assert.equal(model.generated, '2026-11-17 08:00');
  assert.deepEqual(model.zones.map((zone) => zone.id), ['story', 'code', 'plan', 'review', 'journal']);
  assert.deepEqual(model.missing, ['review.md']);
  assert.deepEqual(model.gates.map((gate) => [gate.name, gate.status]), [['Scoped?', 'in-review'], ['Planned?', 'in-review']]);

  const [story, code, plan, review, journal] = model.zones;
  assert.deepEqual(story.cards.map((card) => card.title), ['Story APP-9: Outbox retry', 'Scope']);
  assert.equal(story.cards[0].kind, 'summary');
  assert.deepEqual(story.questions.map((card) => card.title), ['Is the old key in use?']);
  assert.deepEqual(story.people.map((person) => [person.name, person.status]), [['Ana', 'waiting']]);

  assert.deepEqual(code.graph.lanes, ['Service', 'SQL', 'Other']);
  assert.deepEqual(code.graph.nodes.map((node) => [node.name, node.layer, node.change]),
    [['RetryJob', 'Service', 'planned'], ['OutboxConfig', 'Service', 'done'], ['Outbox table', 'SQL', ''], ['Scheduler', 'Other', '']]);
  assert.equal(code.graph.nodes[1].role, 'Holds the timeout | in seconds');
  assert.deepEqual(code.graph.edges, [
    { from: 'node-retryjob', to: 'node-outboxconfig', label: 'reads the timeout' },
    { from: 'node-retryjob', to: 'node-outbox-table', label: 'selects failed rows' },
    { from: 'node-scheduler', to: 'node-retryjob', label: '' },
  ]);
  assert.deepEqual(code.more.map((card) => card.title), ['Terms']);

  assert.deepEqual(plan.hypotheses.map((card) => [card.title, card.state]), [['H1 supported', 'supported'], ['H2 rejected', 'rejected']]);
  assert.deepEqual(plan.steps.map((card) => [card.title, card.state]),
    [['1. Read the new key', 'verified'], ['2. Add the timeout case', 'done'], ['3. Remove the old key', 'planned']]);
  assert.match(plan.steps[0].markdown, /^- Files: \[RetryJob\.cs\]/);
  assert.deepEqual(plan.more.map((card) => card.title), ['Risks']);

  assert.deepEqual(review.checks.map((card) => card.state), ['verified', 'failed', 'gap', 'open']);
  assert.equal(journal.total, 5);
  assert.equal(journal.cards[0].title, '2026-11-13 decision: keep no fallback');
  assert.equal(journal.cards[1].title, '2026-11-13 Step 1 verified: deployed check');
});

test('link targets open code in the editor, keep ticket links relative, and refuse other schemes', () => {
  assert.equal(linkTarget('/repo/src/RetryJob.cs:42'), 'vscode://file/repo/src/RetryJob.cs:42');
  assert.equal(linkTarget('C:\\repo\\My File.cs:7:3'), 'vscode://file/C:/repo/My%20File.cs:7');
  assert.equal(linkTarget('<C:/repo/a b.cs>', 'file'), 'file:///C:/repo/a%20b.cs');
  assert.equal(linkTarget('evidence/2026-11-11-config.md'), 'evidence/2026-11-11-config.md');
  assert.equal(linkTarget('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  for (const target of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '#top', '//example.com/x']) assert.equal(linkTarget(target), '', target);
});

test('markdown becomes escaped HTML: no source text can add a tag, a handler, or a script link', () => {
  const html = markdown([
    'A <script>alert(1)</script> & "quoted" `<b>code</b>`.', '',
    '- [bad](javascript:alert) and [good](story.md#scope) and **bold**',
    '  - nested <img src=x onerror=alert(1)>', '',
    '| A | B |', '|---|---|', '| 1 | <i>2</i> |', '', '```html', '<p onclick="x()">', '```',
  ].join('\n'));
  assert.doesNotMatch(html, /<script|<img|<i>|<b>|<p onclick/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quoted&quot; <code>&lt;b&gt;code&lt;\/b&gt;<\/code>/);
  assert.match(html, /<li>bad and <a href="story\.md#scope">good<\/a> and <strong>bold<\/strong><ul><li>nested &lt;img/);
  assert.match(html, /<table><thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>&lt;i&gt;2&lt;\/i&gt;<\/td><\/tr><\/tbody><\/table>/);
  assert.match(html, /<pre data-lang="html"><code>&lt;p onclick=&quot;x\(\)&quot;&gt;<\/code><\/pre>/);
});

test('the page is one self-contained file with the rail, the board, and the copy message', (t) => {
  const f = wiki(t);
  fill(f);
  f.put('story.md', readFileSync(path.join(f.dir, 'story.md'), 'utf8') + '\n## Facts\n\n- </script><script>alert(1)</script>\n');
  const result = writeCanvas(f.dir, { now: new Date('2026-11-17T08:00:00Z') });
  assert.equal(result.file, path.join(f.dir, 'canvas.html'));
  const html = readFileSync(result.file, 'utf8');
  assert.match(html, /^<!doctype html>/);
  // Nothing loads from a network or from another file.
  assert.doesNotMatch(html, /<script[^>]+src=|<link\b|<img\b|<iframe\b|@import|url\(\s*["']?https?:/i);
  assert.equal(html.match(/<script\b/g).length, 2, 'one data block and one script');
  assert.equal(html.match(/<\/script>/g).length, 2, 'ticket text cannot close a script block');
  assert.match(html, /<title>APP-9 · Fix outbox retry on timeout<\/title>/);
  assert.match(html, /<li class="g-in-review"><span class="mark">🟡<\/span> Planned <small>waits for you<\/small><\/li>/);
  for (const id of ['zone-story', 'zone-code', 'zone-plan', 'zone-review', 'zone-journal', 'plan-step-2', 'node-retryjob', 'proof-check-1', 'person-ana']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.match(html, /class="card k-step s-verified" id="plan-step-1" data-file="plan\.md" data-section="Steps"/);
  assert.match(html, /class="node c-planned" id="node-retryjob"/);
  assert.match(html, /href="vscode:\/\/file\/repo\/src\/RetryJob\.cs:42"/);
  assert.match(html, /Canvas comments for /, 'the script builds the message that the ticket skill names');
  assert.match(html, /Not written yet: review\.md\./);
  assert.match(renderCanvas(result.model, { links: 'file' }), /href="file:\/\/\/repo\/src\/RetryJob\.cs"/);
  assert.throws(() => renderCanvas(result.model, { links: 'web' }), /Unknown link mode/);
});

test('an older ticket gets its files as columns, and a ticket with only a README still gives a page', (t) => {
  const old = wiki(t, { workflow: 'full-v2' });
  old.put('scope.md', '---\ntype: scope\n---\n# 🎯 Scope (APP-9): Retry\n\n## ⚡ 1 min\n\n> 🔥 Retries stop.\n\n## ☕ 5 min\n\nMore.\n');
  old.put('context.md', '# 🧭 Context (APP-9): Retry\n\n## 📊 At a glance\n\nFacts.\n');
  const model = buildCanvas(old.dir);
  assert.equal(model.layout, 'columns');
  assert.deepEqual(model.zones.map((zone) => [zone.id, zone.title]), [['scope', '🎯 Scope'], ['context', '🧭 Context']]);
  assert.deepEqual(model.zones[0].cards.map((card) => card.title), ['⚡ 1 min', '☕ 5 min']);
  assert.match(renderCanvas(model), /This ticket uses the full-v2 layout/);

  const fresh = wiki(t);
  const empty = buildCanvas(fresh.dir);
  assert.deepEqual(empty.missing, ['story.md', 'plan.md', 'review.md', 'proof.md', 'map.md', 'journal.md']);
  assert.match(renderCanvas(empty), /No story\.md yet\./);
});

test('the canvas never follows a link, and the CLI writes the page or prints the model', (t) => {
  const f = wiki(t);
  fill(f);
  const outside = path.join(f.root, 'outside.md');
  writeFileSync(outside, '# Outside\n');
  rmSync(path.join(f.dir, 'map.md'));
  try { symlinkSync(outside, path.join(f.dir, 'map.md')); } catch { t.skip('This platform cannot create a file link.'); return; }
  assert.throws(() => buildCanvas(f.dir), /map\.md must be a regular file, not a link/);
  rmSync(path.join(f.dir, 'map.md'));

  const run = (...args) => spawnSync(process.execPath, [cli, ...args, '--cwd', cwd, '--wiki', f.root], { encoding: 'utf8' });
  const written = run('canvas', 'APP-9');
  assert.equal(written.status, 0, written.stderr);
  assert.match(written.stdout, /APP-9: wrote .*canvas\.html\n {2}open {2}file:\/\//);
  assert.ok(existsSync(path.join(f.dir, 'canvas.html')));
  const json = run('canvas', 'app-9', '--json');
  assert.equal(JSON.parse(json.stdout).ticket.key, 'APP-9');
  assert.equal(run('canvas', 'APP-9', '--links', 'web').status, 1);
  assert.equal(run('canvas', 'NOPE-1').status, 1);
});

test('the templates of the ticket skill give a canvas with every part', (t) => {
  const f = wiki(t);
  for (const name of ['story.md', 'plan.md', 'review.md', 'proof.md', 'map.md', 'journal.md', 'close.md']) f.put(name, readFileSync(path.join(templates, name), 'utf8'));
  const model = buildCanvas(f.dir);
  assert.deepEqual(model.missing, []);
  const zone = (id) => model.zones.find((item) => item.id === id);
  assert.equal(zone('plan').steps.length, 1);
  assert.equal(zone('plan').hypotheses.length, 3);
  assert.equal(zone('code').graph.nodes.length >= 1, true);
  assert.equal(zone('code').graph.edges.length, 1);
  assert.equal(zone('review').checks.length, 1);
  assert.equal(zone('story').questions.length, 1);
  assert.equal(zone('journal').cards.length, 5);
  assert.ok(zone('close').cards.length >= 3);
});

test('each card has a tier and a gate, an exception moves a card up, and the focus is the gate that waits', (t) => {
  const f = wiki(t);
  fill(f);
  const model = buildCanvas(f.dir);
  assert.equal(model.focus, 'Scoped?');
  assert.equal(model.focusZone, 'story');
  const [story, code, plan, review, journal] = model.zones;
  assert.deepEqual(story.cards.map((card) => [card.section, card.tier, card.gate]), [['Summary', 'must', 'Scoped?'], ['Scope', 'must', 'Scoped?']]);
  assert.deepEqual(story.questions.map((card) => card.tier), ['must']);
  assert.deepEqual(story.people.map((person) => person.tier), ['good']);
  assert.deepEqual([code.graph.tier, code.graph.gate, code.cards[0].tier, code.more[0].tier], ['must', 'Planned?', 'must', 'ai']);
  assert.deepEqual(plan.hypotheses.map((card) => [card.tier, card.alert]), [['good', false], ['good', false]]);
  assert.deepEqual(plan.steps.map((card) => card.tier), ['good', 'good', 'good']);
  assert.deepEqual(plan.more.map((card) => [card.section, card.tier]), [['Risks', 'must']]);
  // Only the failed check is an exception. A check that is open or not proven is not.
  assert.deepEqual(review.checks.map((card) => [card.tier, card.alert, card.gate]), [['good', false, 'Learned?'], ['must', true, 'Learned?'], ['good', false, 'Learned?'], ['good', false, 'Learned?']]);
  assert.deepEqual(journal.cards.map((card) => card.tier), ['ai', 'ai', 'ai', 'ai', 'ai']);
  assert.equal(story.cards[0].words, 12);

  f.put('plan.md', readFileSync(path.join(f.dir, 'plan.md'), 'utf8').replace('- H2 rejected', '- H3 open: the queue is full\n- H2 rejected'));
  f.put('journal.md', readFileSync(path.join(f.dir, 'journal.md'), 'utf8') + '\n## 2026-11-14 problem: the job stops\n\nCause: a lock.\n');
  const next = buildCanvas(f.dir);
  assert.deepEqual(next.zones[2].hypotheses.map((card) => [card.state, card.tier, card.alert]), [['supported', 'good', false], ['open', 'must', true], ['rejected', 'good', false]]);
  assert.deepEqual([next.zones[4].cards[0].state, next.zones[4].cards[0].tier, next.zones[4].cards[0].alert], ['problem', 'must', true]);

  const gate = (name, status) => ({ name, status });
  assert.equal(focusGate([]), '');
  assert.equal(focusGate([gate('Scoped?', 'approved'), gate('Planned?', 'todo'), gate('Sendable?', 'in-review'), gate('Shippable?', 'in-review')]), 'Shippable?');
  assert.equal(focusGate([gate('Scoped?', 'approved'), gate('Planned?', 'skipped'), gate('Sendable?', 'todo'), gate('Shippable?', 'todo'), gate('Learned?', 'todo')]), 'Shippable?');
  assert.equal(focusGate([gate('Scoped?', 'approved'), gate('Sendable?', 'todo'), gate('Learned?', 'approved')]), '');
});

test('the page has the views and the fold data of each card, and an older ticket has none', (t) => {
  const f = wiki(t);
  fill(f);
  const html = renderCanvas(buildCanvas(f.dir));
  assert.deepEqual([...html.matchAll(/<button type="button" data-view="([a-z]+)" aria-pressed="false" title="[^"]+">([^<]+)<\/button>/g)].map((match) => [match[1], match[2]]),
    [['focus', 'Now: Scoped'], ['must', 'Must read'], ['good', '+ Good to know'], ['all', 'All']]);
  assert.match(html, /"focus":"Scoped\?","focusZone":"story"/);
  assert.match(html, /<section class="zone z-story z-now" id="zone-story"/);
  assert.match(html, /<section class="zone z-plan" id="zone-plan"/);
  assert.match(html, /<h2>Story <span class="zgate g-in-review" title="Scoped\? waits for you"><span aria-hidden="true">🟡<\/span> waits for you<\/span> /);
  assert.match(html, /id="story-scope" data-file="story\.md" data-section="Scope" data-title="Scope" data-tier="must" data-gate="Scoped\?" data-words="\d+"><h3><span class="meta" title="Must read">must · \d+ w<\/span>Scope<\/h3>/);
  assert.match(html, /id="code-graph" data-title="Components and flow" data-tier="must" data-gate="Planned\?" data-words="\d+"><h3><span class="meta" title="Must read">must · 4 components<\/span>/);
  assert.match(html, /id="proof-check-1" [^>]*data-tier="good" data-gate="Learned\?" data-words="4" data-bundle="verified checks">/);
  assert.match(html, /id="journal-1" [^>]*data-tier="ai" data-gate="" data-words="\d+" data-bundle="journal entries">/);
  assert.match(html, /id="person-ana" [^>]*data-tier="good" data-gate="" data-words="\d+">/);
  // A card without text is only its title, so it has no tier and it never folds.
  assert.match(html, /id="proof-check-2" data-file="proof\.md" data-section="Checks" data-title="[^"]+"><h3>/);
  assert.match(html, /id="plan-step-3" data-file="plan\.md" data-section="Steps" data-title="3\. Remove the old key"><h3>/);

  // After the last gate, the page has no view of one gate.
  f.put('README.md', readFileSync(path.join(f.dir, 'README.md'), 'utf8').replaceAll('status: in-review', 'status: approved, date: 2026-11-12'));
  const done = renderCanvas(buildCanvas(f.dir));
  assert.doesNotMatch(done, /<button[^>]*data-view="focus"|"focus":|class="zone [^"]*z-now/);
  assert.match(done, /data-view="must"/);

  const old = wiki(t, { workflow: 'full-v2' });
  old.put('scope.md', '# Scope (APP-9): Retry\n\n## 1 min\n\nRetries stop.\n');
  assert.doesNotMatch(renderCanvas(buildCanvas(old.dir)), /data-view=|data-tier=|class="views"|class="zgate/);
});

test('each section of a template has one tier, and each tier entry is a section of its template', () => {
  for (const [name, tiers] of Object.entries(TIERS)) {
    const listed = [...tiers.must, ...tiers.good, ...tiers.ai];
    assert.equal(new Set(listed).size, listed.length, `${name}: a section has two tiers`);
    if (name === 'journal.md') { assert.deepEqual(tiers, { must: [], good: [], ai: ['*'] }); continue; }
    const headings = [...readFileSync(path.join(templates, name), 'utf8').matchAll(/^## (.+?)\r?$/gm)].map((match) => match[1].toLowerCase());
    assert.deepEqual([...listed].sort(), ['summary', ...headings].sort(), name);
  }
});
