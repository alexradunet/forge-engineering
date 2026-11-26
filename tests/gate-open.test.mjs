import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTicket } from '../plugins/forge/scripts/lib/ticket.mjs';
import { lint, sha256 } from '../plugins/forge/scripts/lib/validation.mjs';
import { approveGate } from '../plugins/forge/scripts/lib/approve.mjs';
import { openReview } from '../plugins/forge/scripts/lib/gate-open.mjs';

const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));
const TODAY = '2026-11-01';

function fixture(t, { gates = {}, plan = '# Plan SYN-4\n\nThe plan.\n' } = {}) {
  const wiki = mkdtempSync(path.join(os.tmpdir(), 'forge-gate-open-'));
  t.after(() => rmSync(wiki, { recursive: true, force: true }));
  const dir = path.join(wiki, 'raw', 'tickets', 'syn-4');
  mkdirSync(dir, { recursive: true });
  const put = (name, text) => {
    const file = path.join(dir, ...name.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  put('story.md', '# Story SYN-4\n\nThe story.\n');
  put('plan.md', plan);
  put('review.md', '# Review SYN-4\n\nThe review.\n');
  const record = (name, doc) => `  - { name: ${name}, doc: ${doc}, need: required, status: ${gates[name] ?? 'todo'} }`;
  const readme = [
    '---', 'type: ticket', 'key: SYN-4', 'title: Synthetic gate-open ticket', 'short: Synthetic open',
    'workflow: full-v3', 'phase: start', 'state: active', 'next: Review the scope', 'waiting_on: ""', 'changes: []', 'people: []',
    'gates:', record('Scoped?', 'story.md'), record('Planned?', 'plan.md'), record('Sendable?', 'outbox/'), record('Shippable?', 'review.md'), record('Learned?', 'close.md'),
    'updated: 2026-10-01', '---', '# SYN-4: Synthetic', '', '## Now', '', '- State: ▶️ active', '- Phase: start', '- Open gate: none', '- Next: Review the scope', '- Waiting on: nobody', '- Updated: 2026-10-01', '', '## Files', '', '- [story.md](story.md)', '',
  ].join('\r\n');
  put('README.md', readme);
  return { wiki, dir, put, readme, file: path.join(dir, 'README.md') };
}

const listing = (dir) => readdirSync(dir, { recursive: true }).sort();
const open = (f, gate, extra = {}) => openReview(f.dir, { gate, today: TODAY, ...extra });
const approve = (f, gate) => approveGate(f.dir, { gate, answer: 'approve', today: TODAY });
const hashOf = (f, name) => sha256(readFileSync(path.join(f.dir, name)));
const errorsOf = (f) => lint({ wikiPath: f.wiki, repoPath: cwd }).findings.filter((item) => item.severity === 'error');
const gateOf = (f, name) => parseTicket(readFileSync(f.file, 'utf8')).gates.find((item) => item.name === name);

test('Scoped? on a new ticket: manifest, README record, Now card, one snapshot, lint, then approval without --hash', (t) => {
  const f = fixture(t);
  const result = open(f, 'scoped');
  const expected = `${JSON.stringify({ version: 1, gate: 'Scoped?', documents: [{ path: 'story.md', sha256: hashOf(f, 'story.md') }] }, null, 2)}\n`;
  const manifest = readFileSync(path.join(f.dir, 'approvals', 'scoped-001.json'), 'utf8');
  assert.equal(manifest, expected);
  assert.equal(result.manifest, 'approvals/scoped-001.json');
  assert.equal(result.hash, sha256(expected));
  assert.equal(result.carried, null);
  assert.equal(result.review, null);
  assert.match(result.diff, /first review/);
  const text = readFileSync(f.file, 'utf8');
  const record = gateOf(f, 'Scoped?');
  assert.deepEqual([record.status, record.manifest, record.hash, record.date], ['in-review', 'approvals/scoped-001.json', sha256(expected), undefined]);
  assert.match(text, /\r\nstate: needs-me\r\n/);
  assert.match(text, /\r\nupdated: 2026-11-01\r\n/);
  assert.match(text, /\r\n- State: 🟡 needs-me\r\n- Phase: start\r\n- Open gate: none\r\n/);
  assert.deepEqual(readdirSync(path.join(f.dir, 'approvals', 'snapshots')), ['scoped-1.md']);
  assert.deepEqual(errorsOf(f), []);
  assert.equal(lint({ wikiPath: f.wiki, repoPath: cwd }).findings.some((item) => item.code === 'now-card-stale' && item.file === f.file), false);
  assert.equal(approve(f, 'Scoped?').status, 'approved');
  assert.equal(gateOf(f, 'Scoped?').status, 'approved');
});

test('a second run with no change writes -002 and the diff says that nothing changed', (t) => {
  const f = fixture(t);
  open(f, 'Scoped?');
  const again = open(f, 'Scoped?');
  assert.equal(again.manifest, 'approvals/scoped-002.json');
  assert.match(again.diff, /has not changed since your last review/);
  assert.equal(readdirSync(path.join(f.dir, 'approvals', 'snapshots')).length, 1);
  assert.equal(gateOf(f, 'Scoped?').manifest, 'approvals/scoped-002.json');
});

test('an approved gate opens again after a change, and its date is dropped', (t) => {
  const f = fixture(t);
  open(f, 'Scoped?');
  approve(f, 'Scoped?');
  assert.equal(gateOf(f, 'Scoped?').date, TODAY);
  f.put('story.md', '# Story SYN-4\n\nThe story, changed.\n');
  const again = open(f, 'Scoped?');
  assert.match(again.diff, /Changed since your last review/);
  const record = gateOf(f, 'Scoped?');
  assert.deepEqual([record.status, record.date], ['in-review', undefined]);
});

test('Planned? is refused when Scoped? is not approved', (t) => {
  const f = fixture(t);
  assert.throws(() => open(f, 'Planned?'), /Scoped\? must be approved before you open Planned\?.*Scoped\? is not approved/);
});

test('Planned? with a bad path in plan.md is refused and nothing is written', (t) => {
  const f = fixture(t, { plan: '# Plan SYN-4\n\n## Steps\n\n1. Edit\n   - Files: [x](/nonexistent-forge-dir/x.ts)\n' });
  open(f, 'Scoped?');
  approve(f, 'Scoped?');
  const before = [listing(f.dir), readFileSync(f.file)];
  assert.throws(() => open(f, 'Planned?'), /not ready for review:\n- Step 1 names a file that does not exist/);
  assert.deepEqual(listing(f.dir), before[0]);
  assert.deepEqual(readFileSync(f.file), before[1]);
});

const review = (hash, extra = '') => `---\ntype: evidence\nticket: SYN-4\ndate: 2026-10-30\nplan-sha256: ${hash}\n---\n# Plan review SYN-4 001\n\n## Open blockers\n\nnone\n\n## Concerns\n\n- The rollback is slow.\n${extra}`;
const checked = '# Plan SYN-4\n\n## Checks\n\n1. Unit\n   - Baseline: [out](evidence/base-001.md)\n   - Control: not run: no change in behavior\n';

test('Planned? with planReview attacker needs a review file, and the manifest lists it and the linked evidence', (t) => {
  const f = fixture(t, { plan: checked });
  f.put('evidence/base-001.md', 'baseline output\n');
  open(f, 'Scoped?');
  approve(f, 'Scoped?');
  const policy = { planReview: 'attacker' };
  const planHash = hashOf(f, 'plan.md');
  assert.throws(() => open(f, 'Planned?', { policy }), (error) => error.message.includes(planHash) && /No plan review covers/.test(error.message));
  f.put('evidence/plan-review-001.md', review(planHash));
  const result = open(f, 'Planned?', { policy });
  assert.deepEqual(result.documents.map((doc) => doc.path), ['plan.md', 'evidence/base-001.md', 'evidence/plan-review-001.md']);
  assert.deepEqual(result.review, { file: 'evidence/plan-review-001.md', openBlockers: 'none', concerns: '- The rollback is slow.' });
  assert.equal(approve(f, 'Planned?').status, 'approved');
});

test('carry: an in-review Planned? with a reviewed revision gets a carry record after a change; an approved one does not', (t) => {
  const f = fixture(t, { plan: checked });
  f.put('evidence/base-001.md', 'baseline output\n');
  open(f, 'Scoped?');
  approve(f, 'Scoped?');
  const policy = { planReview: 'attacker' };
  const first = hashOf(f, 'plan.md');
  f.put('evidence/plan-review-001.md', review(first));
  open(f, 'Planned?', { policy });
  f.put('plan.md', `${checked}\n## Risks\n\n- Changed at the gate.\n`);
  const second = hashOf(f, 'plan.md');
  const dry = open(f, 'Planned?', { policy, dryRun: true });
  assert.equal(dry.carried, 'evidence/plan-review-002.md');
  assert.equal(existsSync(path.join(f.dir, 'evidence', 'plan-review-002.md')), false);
  const result = open(f, 'Planned?', { policy });
  assert.equal(result.carried, 'evidence/plan-review-002.md');
  assert.equal(readFileSync(path.join(f.dir, 'evidence', 'plan-review-002.md'), 'utf8'), [
    '---', 'type: evidence', 'ticket: SYN-4', `date: ${TODAY}`, `plan-sha256: ${second}`, 'carried-from: evidence/plan-review-001.md', `reviewed-sha256: ${first}`, '---',
    '# Plan review SYN-4 002: carried', '',
    `The reviewers read the plan revision ${first.slice(0, 12)}. They did not read this revision (${second.slice(0, 12)}): the user asked for the change at the gate.`, '',
  ].join('\n'));
  assert.ok(result.documents.some((doc) => doc.path === 'evidence/plan-review-002.md'));
  assert.equal(result.notes[0].startsWith('The reviewers read the plan revision'), true);
  assert.equal(approve(f, 'Planned?').status, 'approved');
  f.put('plan.md', `${checked}\n## Risks\n\n- Changed again after the approval.\n`);
  assert.throws(() => open(f, 'Planned?', { policy }), /No plan review covers/);
});

test('Shippable? lists the one change draft, and none when two exist', (t) => {
  // The earlier gates must verify, so approve them through the command.
  const g = fixture(t);
  open(g, 'Scoped?'); approve(g, 'Scoped?'); open(g, 'Planned?'); approve(g, 'Planned?');
  const draft = (target) => `---\ntype: outbox\nticket: SYN-4\ntarget: ${target}   # tracker-comment | change\nstatus: draft\nupdated: 2026-11-01\n---\n# Outbox SYN-4\n`;
  g.put('outbox/pr.draft.md', draft('change'));
  g.put('outbox/comment.draft.md', draft('tracker-comment'));
  const one = open(g, 'Shippable?');
  assert.deepEqual(one.documents.map((doc) => doc.path), ['review.md', 'outbox/pr.draft.md']);
  assert.deepEqual(one.notes, []);
  g.put('outbox/pr2.draft.md', draft('change'));
  const two = open(g, 'Shippable?', { dryRun: true });
  assert.deepEqual(two.documents.map((doc) => doc.path), ['review.md']);
  assert.deepEqual(two.notes, ['2 change drafts exist: none is in the set.']);
});

test('refusals: Sendable?, a skipped gate, outside paths, journal.md, a missing file, a link', (t) => {
  const f = fixture(t, { gates: { 'Planned?': 'skipped' } });
  const outside = path.join(f.wiki, 'outside.md');
  writeFileSync(outside, 'x\n');
  const before = [listing(f.dir), readFileSync(f.file)];
  assert.throws(() => open(f, 'Sendable?'), /Sendable\? has its own steps/);
  assert.throws(() => open(f, 'Planned?'), /Planned\? is skipped/);
  assert.throws(() => open(f, 'Scoped?', { extra: ['../../../outside.md'] }), /outside the ticket folder/);
  assert.throws(() => open(f, 'Scoped?', { extra: [outside] }), /outside the ticket folder/);
  assert.throws(() => open(f, 'Scoped?', { extra: ['journal.md'] }), /journal\.md cannot be in a review set/);
  assert.throws(() => open(f, 'Scoped?', { extra: ['approvals/history.md'] }), /cannot be in a review set/);
  assert.throws(() => open(f, 'Scoped?', { extra: ['README.md'] }), /cannot be in a review set/);
  assert.throws(() => open(f, 'Scoped?', { extra: ['canvas.html'] }), /cannot be in a review set/);
  assert.throws(() => open(f, 'Scoped?', { extra: ['evidence/missing.md'] }), /evidence\/missing\.md does not exist/);
  let linked = true;
  try { symlinkSync(outside, path.join(f.dir, 'link.md')); } catch { linked = false; }
  if (linked) assert.throws(() => open(f, 'Scoped?', { extra: ['link.md'] }), /link\.md: Expected a regular file|Linked paths/);
  else t.diagnostic('This platform cannot make links: the link case did not run.');
  if (linked) rmSync(path.join(f.dir, 'link.md'));
  assert.deepEqual(listing(f.dir), before[0]);
  assert.deepEqual(readFileSync(f.file), before[1]);
});

test('--dry-run writes nothing', (t) => {
  const f = fixture(t);
  const before = [listing(f.dir), readFileSync(f.file)];
  const result = open(f, 'Scoped?', { dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.manifest, 'approvals/scoped-001.json');
  assert.deepEqual(listing(f.dir), before[0]);
  assert.deepEqual(readFileSync(f.file), before[1]);
});

test('a failed write leaves the README and the folder as they were', (t) => {
  const f = fixture(t);
  mkdirSync(path.join(f.dir, 'approvals'));
  // A folder with the name of the snapshot file makes the snapshot step fail after the manifest is written.
  mkdirSync(path.join(f.dir, 'approvals', 'snapshots', 'scoped-1.md'), { recursive: true });
  const before = [listing(f.dir), readFileSync(f.file)];
  assert.throws(() => open(f, 'Scoped?'));
  assert.deepEqual(listing(f.dir), before[0]);
  assert.deepEqual(readFileSync(f.file), before[1]);
});

test('the command prints the set and opens the gate (--json too)', (t) => {
  const f = fixture(t);
  const run = (...args) => spawnSync(process.execPath, [cli, 'gate-open', ...args, '--cwd', cwd, '--wiki', f.wiki], { encoding: 'utf8' });
  const dry = run('SYN-4', 'scoped', '--dry-run', '--today', TODAY);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(existsSync(path.join(f.dir, 'approvals')), false);
  const text = run('SYN-4', 'scoped', '--today', TODAY);
  assert.equal(text.status, 0, text.stderr);
  const lines = text.stdout.split('\n');
  assert.equal(lines[0], 'SYN-4 Scoped?: in review');
  assert.match(lines[1], /^Manifest: approvals\/scoped-001\.json sha256 [a-f0-9]{64}$/);
  assert.match(lines[2], /^- story\.md [a-f0-9]{12}$/);
  assert.match(text.stdout, /GO approves this exact set\. Approve with: forge\.mjs gate-approve SYN-4 scoped --answer "<the exact answer of the user>" --method form\|chat\n$/);
  const json = run('SYN-4', 'scoped', '--json', '--today', TODAY);
  assert.equal(json.status, 0, json.stderr);
  const result = JSON.parse(json.stdout);
  assert.deepEqual([result.gate, result.key, result.manifest, result.carried, result.dryRun], ['Scoped?', 'SYN-4', 'approvals/scoped-002.json', null, false]);
  const bad = run('SYN-4', 'sendable');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /forge: Sendable\? has its own steps/);
  assert.equal(run('SYN-4').status, 1);
});
