import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTicket } from '../plugins/forge/scripts/lib/ticket.mjs';
import { checkAction, lint, sha256 } from '../plugins/forge/scripts/lib/validation.mjs';
import { approveGate } from '../plugins/forge/scripts/lib/approve.mjs';
import { openReview } from '../plugins/forge/scripts/lib/gate-open.mjs';

const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));
const TODAY = '2026-11-01';

const GOOD_PROOF = '---\ntype: proof\n---\n# Proof SYN-4\n\n## Checks\n\n1. 🟢 verified: the synthetic behavior\n';

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
  put('proof.md', GOOD_PROOF);
  const record = (name, doc) => `  - { name: ${name}, doc: ${doc}, need: required, status: ${gates[name] ?? 'todo'} }`;
  const readme = [
    '---', 'type: ticket', 'key: SYN-4', 'title: Synthetic gate-open ticket', 'short: Synthetic open',
    'workflow: full-v4', 'phase: start', 'state: active', 'next: Review the scope', 'waiting_on: ""', 'changes: []', 'people: []',
    'gates:', record('Planned?', 'plan.md'), record('Sendable?', 'outbox/'), record('Shippable?', 'review.md'), record('Learned?', 'close.md'),
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

test('Planned? on a new ticket: manifest with story.md and plan.md, README record, Now card, one snapshot for each, lint, then approval without --hash', (t) => {
  const f = fixture(t);
  const result = open(f, 'planned');
  const expected = `${JSON.stringify({ version: 1, gate: 'Planned?', documents: [{ path: 'story.md', sha256: hashOf(f, 'story.md') }, { path: 'plan.md', sha256: hashOf(f, 'plan.md') }] }, null, 2)}\n`;
  const manifest = readFileSync(path.join(f.dir, 'approvals', 'planned-001.json'), 'utf8');
  assert.equal(manifest, expected);
  assert.equal(result.manifest, 'approvals/planned-001.json');
  assert.equal(result.hash, sha256(expected));
  assert.deepEqual(result.documents.map((doc) => doc.path), ['story.md', 'plan.md']);
  assert.equal(result.carried, null);
  assert.equal(result.review, null);
  assert.match(result.diff, /^Summary of story\.md \(first review\):\n[\s\S]*\n\nSummary of plan\.md \(first review\):/);
  const text = readFileSync(f.file, 'utf8');
  const record = gateOf(f, 'Planned?');
  assert.deepEqual([record.status, record.manifest, record.hash, record.date], ['in-review', 'approvals/planned-001.json', sha256(expected), undefined]);
  assert.match(text, /\r\nstate: needs-me\r\n/);
  assert.match(text, /\r\nupdated: 2026-11-01\r\n/);
  assert.match(text, /\r\n- State: 🟡 needs-me\r\n- Phase: start\r\n- Open gate: none\r\n/);
  assert.deepEqual(readdirSync(path.join(f.dir, 'approvals', 'snapshots')).sort(), ['planned-1.md', 'planned-story-1.md']);
  assert.deepEqual(errorsOf(f), []);
  assert.equal(lint({ wikiPath: f.wiki, repoPath: cwd }).findings.some((item) => item.code === 'now-card-stale' && item.file === f.file), false);
  assert.equal(approve(f, 'Planned?').status, 'approved');
  assert.equal(gateOf(f, 'Planned?').status, 'approved');
});

test('a second run with no change writes -002 and the diff says that nothing changed', (t) => {
  const f = fixture(t);
  open(f, 'Planned?');
  const again = open(f, 'Planned?');
  assert.equal(again.manifest, 'approvals/planned-002.json');
  assert.match(again.diff, /^story\.md and plan\.md have not changed since your last review/);
  assert.equal(readdirSync(path.join(f.dir, 'approvals', 'snapshots')).length, 2);
  assert.equal(gateOf(f, 'Planned?').manifest, 'approvals/planned-002.json');
});

test('an approved gate opens again after a change of story.md, and its date is dropped; the form shows only the changed section', (t) => {
  const f = fixture(t);
  open(f, 'Planned?');
  approve(f, 'Planned?');
  assert.equal(gateOf(f, 'Planned?').date, TODAY);
  f.put('story.md', '# Story SYN-4\n\nThe story.\n\n## Scope\n\nOne more section.\n');
  const checkAfter = checkAction(parseTicket(readFileSync(f.file, 'utf8')), f.file, 'implement');
  assert.equal(checkAfter.allowed, false, 'A change of story.md after the approval makes Planned? stale.');
  assert.deepEqual(checkAfter.findings.map((item) => item.code), ['stale-approval']);
  const again = open(f, 'Planned?');
  assert.match(again.diff, /^Changed since your last review \(story\.md vs approvals\/snapshots\/planned-story-1\.md\):\n- Scope: added/);
  assert.ok(!again.diff.includes('plan.md'), 'The unchanged plan.md has no block.');
  const record = gateOf(f, 'Planned?');
  assert.deepEqual([record.status, record.date], ['in-review', undefined]);
  assert.equal(approve(f, 'Planned?').status, 'approved');
  assert.equal(checkAction(parseTicket(readFileSync(f.file, 'utf8')), f.file, 'implement').allowed, true);
});

test('Shippable? is refused when Planned? is not approved', (t) => {
  const f = fixture(t);
  assert.throws(() => open(f, 'Shippable?'), /Planned\? must be approved before you open Shippable\?.*Planned\? is not approved/);
});

test('Planned? with a bad path in plan.md is refused and nothing is written', (t) => {
  const f = fixture(t, { plan: '# Plan SYN-4\n\n## Steps\n\n1. Edit\n   - Files: [x](/nonexistent-forge-dir/x.ts)\n' });
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
  const policy = { planReview: 'attacker' };
  const planHash = hashOf(f, 'plan.md');
  assert.throws(() => open(f, 'Planned?', { policy }), (error) => error.message.includes(planHash) && /No plan review covers/.test(error.message));
  f.put('evidence/plan-review-001.md', review(planHash));
  const result = open(f, 'Planned?', { policy });
  assert.deepEqual(result.documents.map((doc) => doc.path), ['story.md', 'plan.md', 'evidence/base-001.md', 'evidence/plan-review-001.md']);
  assert.deepEqual(result.review, { file: 'evidence/plan-review-001.md', openBlockers: 'none', concerns: '- The rollback is slow.' });
  assert.equal(approve(f, 'Planned?').status, 'approved');
});

test('carry: an in-review Planned? with a reviewed revision gets a carry record after a change; an approved one does not', (t) => {
  const f = fixture(t, { plan: checked });
  f.put('evidence/base-001.md', 'baseline output\n');
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

test('a change of only story.md at an open Planned? form with planReview attacker writes no carry record', (t) => {
  const f = fixture(t, { plan: checked });
  f.put('evidence/base-001.md', 'baseline output\n');
  const policy = { planReview: 'attacker' };
  f.put('evidence/plan-review-001.md', review(hashOf(f, 'plan.md')));
  open(f, 'Planned?', { policy });
  f.put('story.md', '# Story SYN-4\n\nThe story, changed at the gate.\n');
  const again = open(f, 'Planned?', { policy });
  assert.equal(again.carried, null);
  assert.deepEqual(again.notes, []);
  assert.equal(again.manifest, 'approvals/planned-002.json');
  assert.deepEqual(again.documents.map((doc) => doc.path), ['story.md', 'plan.md', 'evidence/base-001.md', 'evidence/plan-review-001.md']);
  assert.equal(existsSync(path.join(f.dir, 'evidence', 'plan-review-002.md')), false);
  assert.equal(approve(f, 'Planned?').status, 'approved');
});

test('Shippable? lists the one change draft, and none when two exist', (t) => {
  // The earlier gate must verify, so approve it through the command.
  const g = fixture(t);
  open(g, 'Planned?'); approve(g, 'Planned?');
  const draft = (target) => `---\ntype: outbox\nticket: SYN-4\ntarget: ${target}   # tracker-comment | change\nstatus: draft\nupdated: 2026-11-01\n---\n# Outbox SYN-4\n`;
  g.put('outbox/pr.draft.md', draft('change'));
  g.put('outbox/comment.draft.md', draft('tracker-comment'));
  const one = open(g, 'Shippable?');
  assert.deepEqual(one.documents.map((doc) => doc.path), ['review.md', 'proof.md', 'outbox/pr.draft.md']);
  assert.deepEqual(one.notes, []);
  g.put('outbox/pr2.draft.md', draft('change'));
  const two = open(g, 'Shippable?', { dryRun: true });
  assert.deepEqual(two.documents.map((doc) => doc.path), ['review.md', 'proof.md']);
  assert.deepEqual(two.notes, ['2 change drafts exist: none is in the set.']);
});

test('Shippable? needs proof.md when evidenceOnDeployedEnv is false, and the manifest lists it', (t) => {
  const f = fixture(t);
  open(f, 'Planned?'); approve(f, 'Planned?');
  rmSync(path.join(f.dir, 'proof.md'));
  const before = listing(f.dir);
  assert.throws(() => open(f, 'Shippable?', { policy: { evidenceOnDeployedEnv: false } }), /Shippable\? is not ready for review:\n- Shippable\? needs proof\.md.*Do the Evidence Testing step now/);
  assert.throws(() => open(f, 'Shippable?'), /needs proof\.md/, 'No policy: the default rule applies.');
  assert.deepEqual(listing(f.dir), before, 'A refusal writes nothing.');
  f.put('proof.md', '# Proof\n\n## Checks\n\n1. open: the behavior\n2. 🔴 failed: the other\n');
  assert.throws(() => open(f, 'Shippable?'), /Check 1 of proof\.md is still open\..*\n- Check 2 of proof\.md failed\./);
  f.put('proof.md', GOOD_PROOF);
  const result = open(f, 'Shippable?');
  assert.deepEqual(result.documents.map((doc) => doc.path), ['review.md', 'proof.md']);
  const manifest = JSON.parse(readFileSync(path.join(f.dir, result.manifest), 'utf8'));
  assert.ok(manifest.documents.some((doc) => doc.path === 'proof.md'));
  approve(f, 'Shippable?');
  const ship = () => checkAction(parseTicket(readFileSync(f.file, 'utf8')), f.file, 'ship');
  assert.equal(ship().allowed, true);
  f.put('proof.md', GOOD_PROOF + '2. 🟢 verified: one more\n');
  assert.equal(ship().allowed, false, 'A change of proof.md after the approval makes the gate stale.');
});

test('Shippable? with evidenceOnDeployedEnv true needs no proof.md and does not list one', (t) => {
  const f = fixture(t);
  open(f, 'Planned?'); approve(f, 'Planned?');
  rmSync(path.join(f.dir, 'proof.md'));
  const result = open(f, 'Shippable?', { policy: { evidenceOnDeployedEnv: true } });
  assert.deepEqual(result.documents.map((doc) => doc.path), ['review.md']);
  f.put('proof.md', GOOD_PROOF);
  assert.deepEqual(open(f, 'Shippable?', { policy: { evidenceOnDeployedEnv: true }, dryRun: true }).documents.map((doc) => doc.path), ['review.md'], 'proof.md stays outside the manifest.');
});

test('refusals: Sendable?, a skipped gate, outside paths, journal.md, a missing file, a link', (t) => {
  const f = fixture(t, { gates: { 'Shippable?': 'skipped' } });
  const outside = path.join(f.wiki, 'outside.md');
  writeFileSync(outside, 'x\n');
  const before = [listing(f.dir), readFileSync(f.file)];
  assert.throws(() => open(f, 'Sendable?'), /Sendable\? has its own steps/);
  assert.throws(() => open(f, 'Shippable?'), /Shippable\? is skipped/);
  assert.throws(() => open(f, 'Planned?', { extra: ['../../../outside.md'] }), /outside the ticket folder/);
  assert.throws(() => open(f, 'Planned?', { extra: [outside] }), /outside the ticket folder/);
  assert.throws(() => open(f, 'Planned?', { extra: ['journal.md'] }), /journal\.md cannot be in a review set/);
  assert.throws(() => open(f, 'Planned?', { extra: ['approvals/history.md'] }), /cannot be in a review set/);
  assert.throws(() => open(f, 'Planned?', { extra: ['README.md'] }), /cannot be in a review set/);
  assert.throws(() => open(f, 'Planned?', { extra: ['canvas.html'] }), /cannot be in a review set/);
  assert.throws(() => open(f, 'Planned?', { extra: ['evidence/missing.md'] }), /evidence\/missing\.md does not exist/);
  let linked = true;
  try { symlinkSync(outside, path.join(f.dir, 'link.md')); } catch { linked = false; }
  if (linked) assert.throws(() => open(f, 'Planned?', { extra: ['link.md'] }), /link\.md: Expected a regular file|Linked paths/);
  else t.diagnostic('This platform cannot make links: the link case did not run.');
  if (linked) rmSync(path.join(f.dir, 'link.md'));
  assert.deepEqual(listing(f.dir), before[0]);
  assert.deepEqual(readFileSync(f.file), before[1]);
});

test('--dry-run writes nothing', (t) => {
  const f = fixture(t);
  const before = [listing(f.dir), readFileSync(f.file)];
  const result = open(f, 'Planned?', { dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.manifest, 'approvals/planned-001.json');
  assert.match(result.diff, /^Summary of story\.md \(first review\):/);
  assert.deepEqual(listing(f.dir), before[0]);
  assert.deepEqual(readFileSync(f.file), before[1]);
});

test('a failed write leaves the README and the folder as they were', (t) => {
  const f = fixture(t);
  mkdirSync(path.join(f.dir, 'approvals'));
  // A folder with the name of the plan snapshot makes the snapshot step fail after the manifest and the snapshot of story.md are written.
  mkdirSync(path.join(f.dir, 'approvals', 'snapshots', 'planned-1.md'), { recursive: true });
  const before = [listing(f.dir), readFileSync(f.file)];
  assert.throws(() => open(f, 'Planned?'));
  assert.deepEqual(listing(f.dir), before[0]);
  assert.deepEqual(readFileSync(f.file), before[1]);
});

test('the command prints the set and opens the gate (--json too)', (t) => {
  const f = fixture(t);
  const run = (...args) => spawnSync(process.execPath, [cli, 'gate-open', ...args, '--cwd', cwd, '--wiki', f.wiki], { encoding: 'utf8' });
  const dry = run('SYN-4', 'planned', '--dry-run', '--today', TODAY);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(existsSync(path.join(f.dir, 'approvals')), false);
  assert.match(dry.stdout, /Summary of story\.md \(first review\):[\s\S]*Summary of plan\.md \(first review\):/);
  const text = run('SYN-4', 'planned', '--today', TODAY);
  assert.equal(text.status, 0, text.stderr);
  const lines = text.stdout.split('\n');
  assert.equal(lines[0], 'SYN-4 Planned?: in review');
  assert.match(lines[1], /^Manifest: approvals\/planned-001\.json sha256 [a-f0-9]{64}$/);
  assert.match(lines[2], /^- story\.md [a-f0-9]{12}$/);
  assert.match(lines[3], /^- plan\.md [a-f0-9]{12}$/);
  assert.match(text.stdout, /GO approves this exact set\. Approve with: forge\.mjs gate-approve SYN-4 planned --answer "<the exact answer of the user>" --method form\|chat\n$/);
  const json = run('SYN-4', 'planned', '--json', '--today', TODAY);
  assert.equal(json.status, 0, json.stderr);
  const result = JSON.parse(json.stdout);
  assert.deepEqual([result.gate, result.key, result.manifest, result.carried, result.dryRun], ['Planned?', 'SYN-4', 'approvals/planned-002.json', null, false]);
  const bad = run('SYN-4', 'sendable');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /forge: Sendable\? has its own steps/);
  assert.equal(run('SYN-4').status, 1);
});
