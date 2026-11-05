import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTicket } from '../plugins/forge/scripts/lib/ticket.mjs';
import { checkGate, lint, sha256 } from '../plugins/forge/scripts/lib/validation.mjs';
import { migrateTicket, rewriteFrontmatter } from '../plugins/forge/scripts/lib/migrate.mjs';

const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));

function fixture(t, { phase = 'implement', state = 'active', statuses = {}, workflow = 'full-v1' } = {}) {
  const wiki = mkdtempSync(path.join(os.tmpdir(), 'forge-migrate-'));
  t.after(() => rmSync(wiki, { recursive: true, force: true }));
  const dir = path.join(wiki, 'raw', 'tickets', 'syn-2');
  const put = (name, bytes) => {
    const file = path.join(dir, ...name.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  };
  const docs = {
    'context.md': 'Context\n', 'evidence/history.md': 'History\n', 'interview.md': 'Interview\n', 'briefing.md': 'Briefing\n',
    'investigation.md': 'Investigation\n', 'plan.draft.md': 'Plan\n', 'plan.md': 'Plan\n', 'decisions.md': 'Decisions\n', 'test-plan.md': 'Tests\n',
  };
  for (const [name, bytes] of Object.entries(docs)) put(name, bytes);
  const sources = {
    'Understood?': { doc: 'context.md', documents: ['context.md', 'evidence/history.md'] },
    'Agreed?': { doc: 'interview.md', documents: ['interview.md', 'briefing.md'] },
    'Diagnosed?': { doc: 'investigation.md', documents: ['investigation.md'] },
    'Designed?': { doc: 'plan.draft.md', documents: ['plan.draft.md', 'plan.md', 'decisions.md', 'test-plan.md'], extra: { approvedCopies: [{ from: 'plan.draft.md', to: 'plan.md' }] } },
  };
  const lines = [];
  for (const [name, item] of Object.entries(sources)) {
    const status = statuses[name] ?? 'approved';
    if (status !== 'approved') { lines.push(`  - { name: ${name}, doc: ${item.doc}, need: required, status: ${status} }`); continue; }
    const manifest = `approvals/${name.replace('?', '').toLowerCase()}-001.json`;
    const bytes = JSON.stringify({ version: 1, gate: name, documents: item.documents.map((doc) => ({ path: doc, sha256: sha256(docs[doc]) })), ...item.extra });
    put(manifest, bytes);
    lines.push(`  - { name: ${name}, doc: ${item.doc}, need: required, status: approved, date: 2026-10-0${lines.length + 1}, manifest: ${manifest}, hash: ${sha256(bytes)} }`);
  }
  const readme = [
    '---', 'type: ticket', 'key: SYN-2', 'title: Synthetic migration ticket', 'short: Synthetic migration', 'item: https://example.test/SYN-2',
    `workflow: ${workflow}    # new tickets only; never infer or migrate legacy metadata`,
    `phase: ${phase}        # start | investigate | plan | implement | review | closed`,
    `state: ${state}       # needs-me | go | active | waiting | blocked | done`,
    'next: Implement the plan', 'waiting_on: ""', 'branch: feature/SYN-2-synthetic', 'worktree: ""', 'changes: []', 'people: []',
    'gates:              # approved needs date, manifest, and full raw-manifest SHA-256 hash',
    ...lines,
    '  - { name: Sendable?, doc: outbox/, need: required, status: todo }',
    '  - { name: Shippable?, doc: review.md, need: required, status: todo }',
    '  - { name: Learned?, doc: close.draft.md, need: required, status: todo }',
    'updated: 2026-10-05', '---', '# 🎫 Ticket (SYN-2): Synthetic', '', '> 🔥 Keep the body bytes.', '',
  ].join('\r\n');
  put('README.md', readme);
  return { wiki, dir, put, file: path.join(dir, 'README.md') };
}

function snapshot(dir) {
  const out = {};
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(file); else out[path.relative(dir, file)] = sha256(readFileSync(file));
    }
  };
  walk(dir);
  return out;
}

const errors = (wiki) => lint({ wikiPath: wiki }).findings.filter((item) => item.severity === 'error');
const today = '2026-11-02';

test('migration carries both merged approvals only when all four source approvals are fresh', (t) => {
  const f = fixture(t);
  assert.deepEqual(errors(f.wiki), []);
  const result = migrateTicket(f.dir, { today });
  assert.equal(result.status, 'migrated');
  assert.deepEqual(result.decisions.map((item) => [item.gate, item.result]), [['Scoped?', 'carried'], ['Planned?', 'carried']]);
  assert.deepEqual(result.phase, { from: 'implement', to: 'implement' });

  const text = readFileSync(f.file, 'utf8');
  const ticket = parseTicket(text);
  assert.equal(ticket.workflow, 'full-v2');
  assert.deepEqual(ticket.gates.map((gate) => [gate.name, gate.status]), [
    ['Scoped?', 'approved'], ['Planned?', 'approved'], ['Sendable?', 'todo'], ['Shippable?', 'todo'], ['Learned?', 'todo']]);
  assert.equal(ticket.gates[0].date, '2026-10-02');
  assert.match(text, /\r\nworkflow: full-v2\r\n/);
  assert.match(text, /\r\nphase: implement +# start \| investigate/);
  assert.match(text, /\r\nupdated: 2026-11-02\r\n/);
  assert.ok(text.endsWith('# 🎫 Ticket (SYN-2): Synthetic\r\n\r\n> 🔥 Keep the body bytes.\r\n'));
  assert.deepEqual(errors(f.wiki), []);

  const scoped = JSON.parse(readFileSync(path.join(f.dir, 'approvals', 'scoped-migrated-001.json'), 'utf8'));
  assert.deepEqual(scoped.migratedFrom.map((item) => item.gate), ['Understood?', 'Agreed?']);
  assert.deepEqual(scoped.documents.map((item) => item.path), ['context.md', 'evidence/history.md', 'interview.md', 'briefing.md']);
  const record = JSON.parse(readFileSync(path.join(f.dir, 'approvals', 'migration-full-v1.json'), 'utf8'));
  assert.equal(record.previousGates.length, 7);
  assert.match(readFileSync(path.join(f.dir, 'log.md'), 'utf8'), /^# Log \(SYN-2\)\n\n## 2026-11-02 Workflow migration/);
  assert.match(readFileSync(path.join(f.dir, 'approvals', 'history.md'), 'utf8'), /Scoped\?: carried\. Sources: Understood\?/);
  assert.equal(migrateTicket(f.dir, { today }).status, 'already');
});

test('migration reopens a merged gate when one source is stale or unapproved and moves the phase back', (t) => {
  const f = fixture(t);
  f.put('interview.md', 'Interview changed after approval\n');
  const result = migrateTicket(f.dir, { today });
  assert.deepEqual(result.decisions.map((item) => [item.gate, item.result]), [['Scoped?', 'reopened'], ['Planned?', 'carried']]);
  assert.match(result.decisions[0].reasons[0], /Agreed\? is not fresh \(stale-approval\)/);
  assert.deepEqual(result.phase, { from: 'implement', to: 'start' });
  assert.deepEqual(result.state, { from: 'active', to: 'needs-me' });
  const ticket = parseTicket(readFileSync(f.file, 'utf8'));
  assert.deepEqual({ ...ticket.gates[0] }, { name: 'Scoped?', doc: 'scope.md', need: 'required', status: 'todo' });
  assert.equal(existsSync(path.join(f.dir, 'approvals', 'scoped-migrated-001.json')), false);
  assert.deepEqual(errors(f.wiki), []);

  const g = fixture(t, { statuses: { 'Diagnosed?': 'in-review' } });
  const second = migrateTicket(g.dir, { today });
  assert.deepEqual(second.decisions.map((item) => [item.gate, item.result]), [['Scoped?', 'carried'], ['Planned?', 'reopened']]);
  assert.deepEqual(second.decisions[1].reasons, ['Diagnosed? is in-review']);
  assert.deepEqual(second.phase, { from: 'implement', to: 'plan' });
  assert.deepEqual(errors(g.wiki), []);
});

test('dry-run migration plans the change and writes no byte', (t) => {
  const f = fixture(t);
  const before = snapshot(f.dir);
  const result = migrateTicket(f.dir, { dryRun: true, today });
  assert.equal(result.status, 'planned');
  assert.deepEqual(result.writes, ['approvals/scoped-migrated-001.json', 'approvals/planned-migrated-001.json', 'README.md',
    'approvals/migration-full-v1.json', 'log.md', 'approvals/history.md']);
  assert.deepEqual(snapshot(f.dir), before);
});

test('a migrated approval fails when its source manifest changes or it adds a document', (t) => {
  const f = fixture(t);
  migrateTicket(f.dir, { today });
  const ticket = parseTicket(readFileSync(f.file, 'utf8'));
  f.put('ticket.md', 'Snapshot\n');
  const manifest = JSON.parse(readFileSync(path.join(f.dir, 'approvals', 'scoped-migrated-001.json'), 'utf8'));
  manifest.documents.push({ path: 'ticket.md', sha256: sha256('Snapshot\n') });
  const bytes = JSON.stringify(manifest);
  f.put('approvals/scoped-extra.json', bytes);
  const extra = { ...ticket, gates: [{ ...ticket.gates[0], manifest: 'approvals/scoped-extra.json', hash: sha256(bytes) }] };
  assert.match(checkGate(extra, f.file, 'Scoped?').findings[0].message, /ticket\.md is not in a source approval/);

  f.put('approvals/understood-001.json', '{"version":1,"gate":"Understood?","documents":[]}');
  const findings = errors(f.wiki);
  assert.ok(findings.some((item) => item.code === 'approval-manifest' && /understood-001\.json changed after its approval/.test(item.message)));
});

test('migration refuses legacy and closed tickets and needs reconciled duplicates', (t) => {
  const legacy = fixture(t);
  legacy.put('README.md', readFileSync(legacy.file, 'utf8').replace(/workflow: full-v1.*\r\n/, ''));
  assert.throws(() => migrateTicket(legacy.dir, { today }), /legacy ticket/);
  const closed = fixture(t, { phase: 'closed', state: 'done' });
  const before = snapshot(closed.dir);
  assert.throws(() => migrateTicket(closed.dir, { today }), /closed ticket keeps full-v1/);
  assert.deepEqual(snapshot(closed.dir), before);
  const duplicate = fixture(t);
  duplicate.put('README.md', readFileSync(duplicate.file, 'utf8').replace('  - { name: Learned?', '  - { name: Shippable?, doc: review.md, need: required, status: todo }\r\n  - { name: Learned?'));
  assert.throws(() => migrateTicket(duplicate.dir, { today }), /Shippable\? has two records/);
});

test('rewriteFrontmatter keeps comments, other lines, and line endings', () => {
  const text = '---\nkey: A-1\nphase: start   # comment\ngates:   # gates\n  - { name: X, need: required, status: todo }\n  - name: Y\n    need: required\n    status: todo\nupdated: 2026-01-01\n---\nBody\n';
  const out = rewriteFrontmatter(text, { scalars: { phase: 'plan' }, gates: [{ name: 'Z?', need: 'required', status: 'todo', note: 'a, b: c' }] });
  assert.equal(out, '---\nkey: A-1\nphase: plan    # comment\ngates:   # gates\n  - { name: Z?, need: required, status: todo, note: "a, b: c" }\nupdated: 2026-01-01\n---\nBody\n');
});

test('CLI migrate --dry-run --json reports the plan', (t) => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [cli, 'migrate', 'SYN-2', '--dry-run', '--json', '--cwd', cwd, '--wiki', f.wiki], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'planned');
  assert.equal(report.key, 'SYN-2');
  const missing = spawnSync(process.execPath, [cli, 'migrate', 'NOPE-1', '--cwd', cwd, '--wiki', f.wiki], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No ticket folder for NOPE-1/);
});
