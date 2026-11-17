import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTicket } from '../plugins/forge/scripts/lib/ticket.mjs';
import { checkGate, sha256 } from '../plugins/forge/scripts/lib/validation.mjs';
import { approveGate, isApproval } from '../plugins/forge/scripts/lib/approve.mjs';

const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));

function fixture(t, { pending } = {}) {
  const wiki = mkdtempSync(path.join(os.tmpdir(), 'forge-approve-'));
  t.after(() => rmSync(wiki, { recursive: true, force: true }));
  const dir = path.join(wiki, 'raw', 'tickets', 'syn-3');
  mkdirSync(path.join(dir, 'approvals'), { recursive: true });
  const docs = { 'scope.md': 'Scope\n', 'context.md': 'Context\n', 'interview.md': 'Interview\n' };
  for (const [name, bytes] of Object.entries(docs)) writeFileSync(path.join(dir, name), bytes);
  const manifest = JSON.stringify({ version: 1, gate: 'Scoped?', documents: Object.entries(docs).map(([name, bytes]) => ({ path: name, sha256: sha256(bytes) })) });
  writeFileSync(path.join(dir, 'approvals', 'scoped-001.json'), manifest);
  const readme = [
    '---', 'type: ticket', 'key: SYN-3', 'title: Synthetic approval ticket', 'short: Synthetic approval',
    'workflow: full-v2', 'phase: start', 'state: needs-me', 'next: Approve the scope', 'waiting_on: ""', 'changes: []', 'people: []',
    'gates:',
    `  - { name: Scoped?, doc: scope.md, need: required, status: in-review, manifest: approvals/scoped-001.json${pending ? `, hash: ${pending}` : ''} }`,
    '  - { name: Planned?, doc: plan.draft.md, need: required, status: todo }',
    '  - { name: Sendable?, doc: outbox/, need: required, status: todo }',
    '  - { name: Shippable?, doc: review.md, need: required, status: todo }',
    '  - { name: Learned?, doc: close.draft.md, need: required, status: todo }',
    'updated: 2026-10-01', '---', '# 🎫 Ticket (SYN-3): Synthetic', '', '> 🔥 Keep the body bytes.', '',
  ].join('\r\n');
  writeFileSync(path.join(dir, 'README.md'), readme);
  return { wiki, dir, readme, digest: sha256(manifest) };
}

const run = (wiki, ...args) => spawnSync(process.execPath, [cli, 'gate-approve', ...args, '--cwd', cwd, '--wiki', wiki], { encoding: 'utf8' });

test('gate-approve records the exact answer and a gate that lint accepts', (t) => {
  const { wiki, dir, digest } = fixture(t);
  const result = run(wiki, 'SYN-3', 'scoped', '--answer', 'Approve Scoped? Ship it', '--method', 'chat', '--hash', digest, '--today', '2026-10-02', '--json');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).hash, digest);
  const text = readFileSync(path.join(dir, 'README.md'), 'utf8');
  assert.match(text, new RegExp(`\\{ name: Scoped\\?, doc: scope\\.md, need: required, status: approved, date: 2026-10-02, manifest: approvals/scoped-001\\.json, hash: ${digest} \\}\\r\\n`));
  assert.match(text, /\r\nupdated: 2026-10-02\r\n[\s\S]*> 🔥 Keep the body bytes\.\r\n$/);
  const ticket = parseTicket(text);
  assert.equal(checkGate(ticket, path.join(dir, 'README.md'), 'Scoped?').allowed, true);
  const history = readFileSync(path.join(dir, 'approvals', 'history.md'), 'utf8');
  assert.match(history, /^# Approval history \(SYN-3\)\n\n## 2026-10-02 Scoped\? approved\n/);
  assert.match(history, new RegExp(`- Manifest: approvals/scoped-001\\.json sha256 ${digest}\\n`));
  assert.match(history, /- Document: scope\.md sha256 [a-f0-9]{64}\n[\s\S]*- Method: chat\n- Answer of the user:\n\n> Approve Scoped\? Ship it\n$/);
});

test('gate-approve writes nothing when the review set changed, in a dry run, or for a wrong gate', (t) => {
  const { wiki, dir, readme, digest } = fixture(t, { pending: 'a'.repeat(64) });
  const readmeFile = path.join(dir, 'README.md');
  const history = path.join(dir, 'approvals', 'history.md');
  assert.throws(() => approveGate(dir, { gate: 'Scoped?', answer: 'approve' }), /changed after the review: the recorded review digest/);

  const clean = fixture(t);
  assert.throws(() => approveGate(clean.dir, { gate: 'Scoped?', answer: 'approve', hash: 'b'.repeat(64) }), /changed after the review: --hash/);
  writeFileSync(path.join(clean.dir, 'context.md'), 'Context, edited after the review\n');
  assert.throws(() => approveGate(clean.dir, { gate: 'Scoped?', answer: 'approve', hash: clean.digest }), /does not verify: Scoped\?: context\.md changed after review/);
  assert.equal(readFileSync(path.join(clean.dir, 'README.md'), 'utf8'), clean.readme);

  const dry = fixture(t);
  assert.equal(approveGate(dry.dir, { gate: 'Scoped?', answer: 'approve', hash: dry.digest, dryRun: true }).status, 'planned');
  assert.equal(readFileSync(path.join(dry.dir, 'README.md'), 'utf8'), dry.readme);
  assert.equal(existsSync(path.join(dry.dir, 'approvals', 'history.md')), false);

  assert.throws(() => approveGate(dir, { gate: 'Sendable?', answer: 'approve' }), /the host prompt that the gate guard asks for/);
  assert.throws(() => approveGate(dir, { gate: 'Planned?', answer: 'approve' }), /Planned\? is todo, not in-review/);
  assert.throws(() => approveGate(dir, { gate: 'Scoped?', answer: ' ' }), /exact answer/);
  const cliResult = run(wiki, 'SYN-3', 'scoped', '--answer', 'approve', '--hash', digest);
  assert.equal(cliResult.status, 1);
  assert.match(cliResult.stderr, /forge: approvals\/scoped-001\.json changed after the review/);
  assert.equal(readFileSync(readmeFile, 'utf8'), readme);
  assert.equal(existsSync(history), false);
});

test('gate-approve accepts only the approval contract of the ticket skill and a review digest', (t) => {
  assert.equal(isApproval('Scoped?', ' approve ', 'form'), true);
  assert.equal(isApproval('Scoped?', '🟢 GO: approve and start the next step', 'form'), true);
  assert.equal(isApproval('Scoped?', 'GO, ship it', 'form'), false);
  assert.equal(isApproval('Scoped?', 'approve scoped', 'form'), false);
  assert.equal(isApproval('Scoped?', 'APPROVE scoped?', 'chat'), true);
  assert.equal(isApproval('Scoped?', 'approve Scoped, thanks', 'chat'), true);
  assert.equal(isApproval('Scoped?', 'approve', 'chat'), false);
  assert.equal(isApproval('Scoped?', 'approve planned', 'chat'), false);
  assert.equal(isApproval('Scoped?', 'approve scopedx', 'chat'), false);
  assert.equal(isApproval('Scoped?', 'approve scoped?later', 'chat'), false);
  assert.equal(isApproval('Scoped?', 'approve scoped?123', 'chat'), false);
  assert.equal(isApproval('Scoped?', 'I do not approve scoped', 'chat'), false);

  const { dir, readme, digest } = fixture(t);
  assert.throws(() => approveGate(dir, { gate: 'Scoped?', answer: 'looks fine', hash: digest }), /form answer is not `approve`/);
  assert.throws(() => approveGate(dir, { gate: 'Scoped?', answer: 'approve planned', method: 'chat', hash: digest }), /does not start with `approve scoped`/);
  assert.throws(() => approveGate(dir, { gate: 'Scoped?', answer: 'approve' }), /--hash/);
  assert.equal(readFileSync(path.join(dir, 'README.md'), 'utf8'), readme);
});

test('gate-approve refuses a bad history target and restores the README when the history write fails', (t) => {
  const folder = fixture(t);
  mkdirSync(path.join(folder.dir, 'approvals', 'history.md'));
  assert.throws(() => approveGate(folder.dir, { gate: 'Scoped?', answer: 'approve', hash: folder.digest }), /history\.md must be a regular file/);
  assert.equal(readFileSync(path.join(folder.dir, 'README.md'), 'utf8'), folder.readme);

  const linked = fixture(t);
  const outside = path.join(linked.wiki, 'outside.md');
  writeFileSync(outside, 'outside\n');
  let canLink = true;
  try { symlinkSync(outside, path.join(linked.dir, 'approvals', 'history.md'), 'file'); } catch { canLink = false; }
  if (canLink) {
    assert.throws(() => approveGate(linked.dir, { gate: 'Scoped?', answer: 'approve', hash: linked.digest }), /history\.md must not be a link/);
    assert.equal(readFileSync(outside, 'utf8'), 'outside\n');
    assert.equal(readFileSync(path.join(linked.dir, 'README.md'), 'utf8'), linked.readme);
  } else {
    t.diagnostic('No permission to create a symbolic link: the link case is not checked.');
  }

  const locked = fixture(t);
  const history = path.join(locked.dir, 'approvals', 'history.md');
  writeFileSync(history, '# Approval history (SYN-3)\n');
  chmodSync(history, 0o444);
  let error;
  try { approveGate(locked.dir, { gate: 'Scoped?', answer: 'approve', hash: locked.digest }); } catch (caught) { error = caught; } finally { chmodSync(history, 0o644); }
  if (!error) return t.diagnostic('A read-only file is writable here (for example as root): the restore case is not checked.');
  assert.equal(readFileSync(path.join(locked.dir, 'README.md'), 'utf8'), locked.readme);
  assert.equal(readFileSync(history, 'utf8'), '# Approval history (SYN-3)\n');
});
