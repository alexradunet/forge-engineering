import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plannedChecks, shippableChecks } from '../plugins/forge/scripts/lib/gate-checks.mjs';

function setup(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'forge-gate-checks-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'ticket');
  const put = (name, text, base = dir) => {
    const file = path.join(base, ...name.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    return file;
  };
  return { root, dir, put, main: path.join(root, 'main'), tree: path.join(root, 'tree') };
}
const plan = (steps = '', checks = '') => `---\ntype: plan\n---\n# Plan\n\n## Steps\n\n${steps}\n## Checks\n\n${checks}\n## Risks\n\n- none\n`;
const sha = (text) => createHash('sha256').update(text).digest('hex');
const codes = (result) => result.findings.map((item) => item.code);

test('plan-path: a path that exists passes, one that does not exist is a finding with its line', (t) => {
  const f = setup(t);
  const real = f.put('src/A.cs', 'x', f.main);
  f.put('plan.md', plan(`1. Edit\n   - Files: [A.cs](${real}), [B.cs](${f.main}/src/B.cs)\n`));
  const result = plannedChecks(f.dir, {}, { repoPath: f.main });
  assert.equal(result.findings.length, 1);
  assert.deepEqual({ ...result.findings[0], file: path.basename(result.findings[0].file) }, {
    file: 'plan.md', line: 9, code: 'plan-path', message: `Step 1 names a file that does not exist: ${f.main}/src/B.cs.`,
    remedy: 'Correct the path, or write (new) after the link when a step creates the file.',
  });
});

test('plan-path: (new), a :line suffix, and a URL are handled', (t) => {
  const f = setup(t);
  const real = f.put('src/A.cs', 'x', f.main);
  f.put('plan.md', plan(`1. Edit\n   - Files: [A.cs](${real}:42), [B.cs](${real}:4:2), [N.cs](${f.main}/N.cs) (new), [P](${f.main}/src/A.cs#L3)\n   - Why: [site](https://example.com/x.cs), [open](vscode://file/x/y.cs), [mail](mailto:a@b.c)\n`));
  assert.deepEqual(plannedChecks(f.dir, {}, { repoPath: f.main }).findings, []);
  f.put('plan.md', plan(`1. Edit\n   - Files: [N.cs](${f.main}/N.cs) (new), [M.cs](${f.main}/M.cs)\n`));
  assert.equal(plannedChecks(f.dir, {}, { repoPath: f.main }).findings.length, 1);
  f.put('plan.md', plan(`1. Edit\n   - Files: [A](file://${real}), [U](${f.main}/src/%41.cs), [O](<${real}>)\n`));
  assert.deepEqual(plannedChecks(f.dir, {}, { repoPath: f.main }).findings, []);
});

test('plan-path: a relative path is found in the worktree or a checkout, and an absolute main path maps into the worktree', (t) => {
  const f = setup(t);
  f.put('src/InTree.cs', 'x', f.tree);
  const other = path.join(f.root, 'other');
  f.put('lib/InOther.cs', 'x', other);
  f.put('plan.md', plan(`1. Edit\n   - Files: [A](src/InTree.cs), [B](lib/InOther.cs:3), [C](src/Nope.cs)\n2. Move\n   - Files: [D](${f.main}/src/InTree.cs), [E](${f.main}/src/Nope.cs)\n`));
  const result = plannedChecks(f.dir, { worktree: f.tree }, { repoPath: f.main, checkouts: [{ path: other }, { path: '' }] });
  assert.deepEqual(result.findings.map((item) => item.message), [
    'Step 1 names a file that does not exist: src/Nope.cs.', `Step 2 names a file that does not exist: ${f.main}/src/Nope.cs.`,
  ]);
});

test('plan-path: the File column of map.md is checked', (t) => {
  const f = setup(t);
  const real = f.put('A.cs', 'x', f.main);
  f.put('plan.md', plan());
  f.put('map.md', `# Map\n\n## Components\n\n| Component | Layer | file | Role |\n|---|---|---|---|\n| Good | S | [A](${real}) | r |\n| Bad | S | [B](${f.main}/B.cs:7) | r |\n| New | S | [C](${f.main}/C.cs) (new) | r |\n| None | S | | r |\n`);
  const result = plannedChecks(f.dir, {}, { repoPath: f.main });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].message, `Component Bad names a file that does not exist: ${f.main}/B.cs.`);
  assert.equal(result.findings[0].line, 8);
  assert.equal(path.basename(result.findings[0].file), 'map.md');
});

test('plan-baseline: an evidence link or "not run: reason" passes, the rest is a finding', (t) => {
  const f = setup(t);
  f.put('evidence/a.md', 'out');
  f.put('plan.md', plan('', [
    '1. Good', '   - Baseline: failed 3 s ([evidence](evidence/a.md))', '   - Control: not run: no test environment',
    '2. Missing file', '   - Baseline: failed ([evidence](evidence/gone.md))', '   - Control: Not Run: x',
    '3. Empty reason', '   - Baseline: not run:', '   - Control: ([e](evidence/a.md#top))',
    '4. No lines', '   - Action: x', '',
  ].join('\n')));
  const result = plannedChecks(f.dir, {}, {});
  assert.deepEqual(result.findings.map((item) => item.message), [
    'Check 2 has no baseline run: the Baseline line has no evidence link.',
    'Check 3 has no baseline run: the Baseline line has no evidence link.',
    'Check 4 has no Baseline line.', 'Check 4 has no Control line.',
  ]);
  assert.ok(result.findings.every((item) => item.code === 'plan-baseline' && item.remedy.startsWith('Run the ')));
  assert.deepEqual(result.evidence, ['evidence/a.md']);
});

test('plan-baseline: a link outside evidence/ or a link file does not count, and an empty Checks section is quiet', (t) => {
  const f = setup(t);
  f.put('notes.md', 'x');
  f.put('evidence/real.md', 'x');
  f.put('plan.md', plan('', '1. Out\n   - Baseline: ([n](notes.md))\n   - Control: ([e](evidence/real.md))\n'));
  assert.equal(plannedChecks(f.dir, {}, {}).findings.length, 1);
  try { symlinkSync(path.join(f.dir, 'notes.md'), path.join(f.dir, 'evidence', 'link.md')); } catch { return; }
  f.put('plan.md', plan('', '1. Link\n   - Baseline: ([l](evidence/link.md))\n   - Control: ([e](evidence/real.md))\n'));
  assert.equal(plannedChecks(f.dir, {}, {}).findings.length, 1);
  f.put('plan.md', plan('', 'Nothing yet.\n'));
  assert.deepEqual(plannedChecks(f.dir, {}, {}).findings, []);
});

test('plan-review runs only for attacker or panel, and the review file must match the plan hash', (t) => {
  const f = setup(t);
  const text = plan();
  f.put('plan.md', text);
  const run = (policy, ticket = {}) => plannedChecks(f.dir, ticket, { policy });
  assert.deepEqual(run(null).findings, []);
  assert.deepEqual(run({ planReview: 'off' }).findings, []);
  const missing = run({ planReview: 'attacker' });
  assert.deepEqual(codes(missing), ['plan-review']);
  assert.equal(missing.findings[0].message, `No plan review covers this revision of plan.md (sha256 ${sha(text).slice(0, 12)}).`);
  assert.equal(missing.review, null);
  f.put('evidence/plan-review-001.md', `---\nplan-sha256: ${sha(text)}\n---\nOK\n`);
  f.put('evidence/plan-review-002.md', `---\nplan-sha256: ${'0'.repeat(64)}\n---\nStale\n`);
  assert.deepEqual(codes(run({ planReview: 'panel' })), ['plan-review'], 'the highest number counts');
  f.put('evidence/plan-review-003.md', `---\nplan-sha256: ${sha(text)}\n---\nOK\n`);
  const ok = run({ planReview: 'panel' });
  assert.deepEqual(ok.findings, []);
  assert.equal(ok.review, 'evidence/plan-review-003.md');
  assert.equal(run(null).review, 'evidence/plan-review-003.md');
  f.put('evidence/plan-review-004.md', 'no frontmatter');
  assert.deepEqual(codes(run({ planReview: 'attacker' })), ['plan-review']);
});

test('plan-review: an open Planned? manifest must list the review file', (t) => {
  const f = setup(t);
  const text = plan();
  f.put('plan.md', text);
  f.put('evidence/plan-review-001.md', `---\nplan-sha256: ${sha(text)}\n---\nOK\n`);
  const ticket = { gates: [{ name: 'Planned?', status: 'in-review', manifest: 'approvals\\planned.json' }] };
  const run = () => plannedChecks(f.dir, ticket, { policy: { planReview: 'attacker' } });
  assert.deepEqual(run().findings, [], 'a manifest that cannot be read gives no finding here');
  const doc = (p) => ({ path: p, sha256: 'a'.repeat(64) });
  f.put('approvals/planned.json', JSON.stringify({ version: 1, documents: [doc('plan.md')] }));
  const bad = run();
  assert.equal(bad.findings[0].message, 'The Planned? manifest does not list evidence/plan-review-001.md.');
  f.put('approvals/planned.json', JSON.stringify({ version: 1, documents: [doc('plan.md'), doc('evidence\\plan-review-001.md')] }));
  assert.deepEqual(run().findings, []);
});

test('a missing plan.md gives nothing, and a plan.md link is not read', (t) => {
  const f = setup(t);
  mkdirSync(f.dir, { recursive: true });
  assert.deepEqual(plannedChecks(f.dir, {}, { policy: { planReview: 'panel' } }), { findings: [], evidence: [], review: null });
  const real = f.put('real.md', plan('1. A\n   - Files: [x](/no/such/file.cs)\n'), f.root);
  try { symlinkSync(real, path.join(f.dir, 'plan.md')); } catch { return; }
  assert.deepEqual(plannedChecks(f.dir, {}, {}).findings, []);
});

const proof = (checks) => `---\ntype: proof\n---\n# Proof\n\nResult: x.\n\n## Checks\n\n${checks}\n## Regression\n\n- none\n`;
const OFF = { evidenceOnDeployedEnv: false };

test('shippableChecks: the key true checks nothing, even with no proof.md', (t) => {
  const f = setup(t);
  assert.deepEqual(shippableChecks(f.dir, {}, { policy: { evidenceOnDeployedEnv: true } }), { findings: [], proof: null });
});

test('shippableChecks: a missing proof.md is one finding, with the key false or with no policy', (t) => {
  const f = setup(t);
  for (const options of [{ policy: OFF }, { policy: null }, {}]) {
    const result = shippableChecks(f.dir, {}, options);
    assert.equal(result.proof, null);
    assert.deepEqual(result.findings.map((item) => ({ ...item, file: path.basename(item.file) })), [{
      file: 'proof.md', line: null, code: 'proof-missing',
      message: 'Shippable? needs proof.md: the proof of the changed behavior comes before this gate.',
      remedy: 'Do the Evidence Testing step now, and write proof.md. Set policy.evidenceOnDeployedEnv to true only when the proof needs a deployed environment.',
    }]);
  }
});

test('shippableChecks: a link in place of proof.md counts as missing', (t) => {
  const f = setup(t);
  const real = f.put('real.md', proof('1. 🟢 verified: a\n'), f.root);
  mkdirSync(f.dir, { recursive: true });
  try { symlinkSync(real, path.join(f.dir, 'proof.md')); } catch { t.skip('Links cannot be made here.'); return; }
  assert.deepEqual(codes(shippableChecks(f.dir, {}, { policy: OFF })), ['proof-missing']);
});

test('shippableChecks: verified and not proven pass, with or without the emoji and in any case', (t) => {
  const f = setup(t);
  f.put('proof.md', proof('1. 🟢 verified: a\n2. verified: b\n3. ⚪ not proven: c\n4. Not Proven: d\n5. VERIFIED - e\n'));
  assert.deepEqual(shippableChecks(f.dir, {}, { policy: OFF }), { findings: [], proof: 'proof.md' });
});

test('shippableChecks: an open check, a check with no state word, and a failed check are findings with a line', (t) => {
  const f = setup(t);
  f.put('proof.md', proof('1. 🟢 verified: a\n2. open: b\n3. the behavior c\n4. 🔴 failed: d\n5. ⚪ Not proven: e\n'));
  const result = shippableChecks(f.dir, {}, { policy: OFF });
  assert.equal(result.proof, null);
  assert.deepEqual(result.findings.map((item) => [item.code, item.message, item.line]), [
    ['proof-open', 'Check 2 of proof.md is still open.', 11],
    ['proof-open', 'Check 3 of proof.md is still open.', 12],
    ['proof-failed', 'Check 4 of proof.md failed.', 13],
  ]);
  assert.equal(result.findings[0].remedy, 'Run the check, then mark it verified, failed, or not proven with the reason.');
  assert.equal(result.findings[2].remedy, 'Go back to Implement. Shippable? opens when no check failed.');
});

test('shippableChecks: a proof.md with no numbered check passes', (t) => {
  const f = setup(t);
  f.put('proof.md', '# Proof\n\nResult: no behavior changed.\n');
  assert.deepEqual(shippableChecks(f.dir, {}, { policy: OFF }), { findings: [], proof: 'proof.md' });
  f.put('proof.md', proof(''));
  assert.deepEqual(shippableChecks(f.dir, {}, { policy: OFF }), { findings: [], proof: 'proof.md' });
});
