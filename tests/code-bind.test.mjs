import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { baseBranchOf, codeBinding, commitsAfter, dirty, isAncestor } from '../plugins/forge/scripts/lib/code-bind.mjs';

// A real repository: main has one commit, and the branch "feat" has one more.
function repo(t) {
  const tree = mkdtempSync(path.join(os.tmpdir(), 'forge-code-bind-'));
  t.after(() => rmSync(tree, { recursive: true, force: true }));
  const run = (...args) => execFileSync('git', ['-C', tree, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '-b', 'main', tree], { windowsHide: true });
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@example.com'], ['commit.gpgsign', 'false']]) run('config', k, v);
  const write = (name, text) => writeFileSync(path.join(tree, name), text);
  write('a.txt', 'one\n');
  run('add', '.');
  run('commit', '-q', '-m', 'base');
  run('checkout', '-q', '-b', 'feat');
  write('a.txt', 'one\ntwo\n');
  run('commit', '-q', '-am', 'change');
  const bind = (extra = {}) => codeBinding({ worktree: tree, branch: 'feat', baseBranch: 'main', ...extra });
  return { tree, run, write, bind };
}

test('codeBinding gives the head, the merge base, the patch-id, and the branch', (t) => {
  const r = repo(t);
  const code = r.bind();
  assert.equal(code.head, r.run('rev-parse', 'feat'));
  assert.equal(code.base, r.run('rev-parse', 'main'));
  assert.equal(code.branch, 'feat');
  assert.match(code.patchId, /^[0-9a-f]{40,64}$/);
  assert.deepEqual(r.bind(), code, 'The same code gives the same binding.');
});

test('a clean rebase keeps the patch-id, a new commit and a whitespace-only edit change it', (t) => {
  const r = repo(t);
  const first = r.bind();
  r.run('checkout', '-q', 'main');
  r.write('b.txt', 'other\n');
  r.run('add', '.');
  r.run('commit', '-q', '-m', 'other');
  r.run('checkout', '-q', 'feat');
  r.run('rebase', '-q', 'main');
  const rebased = r.bind();
  assert.notEqual(rebased.head, first.head);
  assert.notEqual(rebased.base, first.base);
  assert.equal(rebased.patchId, first.patchId);
  r.write('c.txt', 'new\n');
  r.run('add', '.');
  r.run('commit', '-q', '-m', 'new commit');
  const more = r.bind();
  assert.notEqual(more.patchId, first.patchId);
  // A whitespace-only edit (a trailing space) must not keep the patch-id.
  r.write('a.txt', 'one\ntwo \n');
  r.run('commit', '-q', '-am', 'space');
  assert.notEqual(r.bind().patchId, more.patchId);
});

test('an empty diff throws "no code change"', (t) => {
  const r = repo(t);
  r.run('checkout', '-q', 'main');
  r.run('checkout', '-q', '-b', 'empty');
  assert.throws(() => r.bind({ branch: 'empty' }), /no code change/);
});

test('a missing origin/<base> falls back to <base>, and origin/<base> wins when it exists', (t) => {
  const r = repo(t);
  const local = r.bind();
  // origin/main exists and is one commit behind main: the merge base is the same here.
  r.run('update-ref', 'refs/remotes/origin/main', r.run('rev-parse', 'main'));
  assert.deepEqual(r.bind(), local);
  // A moved origin/main that holds the change makes the diff empty: the remote ref is the one that counts.
  r.run('update-ref', 'refs/remotes/origin/main', r.run('rev-parse', 'feat'));
  assert.throws(() => r.bind(), /no code change/);
  assert.throws(() => r.bind({ baseBranch: 'nope' }), /base branch nope is not known/);
});

test('errors: no branch, no worktree, a bad name, and the deadline', (t) => {
  const r = repo(t);
  assert.throws(() => r.bind({ branch: 'missing' }), /branch missing does not exist/);
  assert.throws(() => r.bind({ worktree: path.join(r.tree, 'gone') }), /failed|could not run/);
  assert.throws(() => r.bind({ worktree: '' }), /no worktree/);
  assert.throws(() => r.bind({ branch: '--all' }), /not valid/);
  assert.throws(() => r.bind({ baseBranch: '' }), /No valid base branch/);
  assert.throws(() => r.bind({ deadlineMs: 0 }), /did not finish/);
});

test('isAncestor, commitsAfter, and dirty', (t) => {
  const r = repo(t);
  const first = r.bind().head;
  r.write('a.txt', 'one\ntwo\nthree\n');
  r.run('commit', '-q', '-am', 'second');
  const second = r.run('rev-parse', 'HEAD');
  assert.equal(isAncestor(r.tree, first, second), true);
  assert.equal(isAncestor(r.tree, second, first), false);
  assert.equal(isAncestor(r.tree, '0123456789abcdef0123456789abcdef01234567', second), false, 'An unknown commit is not an ancestor.');
  assert.equal(isAncestor(r.tree, '--all', second), false, 'A non-hex word is refused.');
  assert.deepEqual(commitsAfter(r.tree, first, second).map((item) => item.subject), ['second']);
  assert.deepEqual(commitsAfter(r.tree, second, second), []);
  assert.equal(dirty(r.tree), false);
  r.write('new.txt', 'x\n');
  assert.equal(dirty(r.tree), true, 'An untracked file counts.');
});

test('baseBranchOf takes the row of the main checkout, else repo.baseBranch, else an empty text', () => {
  const config = { repo: { baseBranch: 'master', checkouts: [{ path: '/work/app', baseBranch: 'main' }, { path: '/work/lib', baseBranch: '' }] } };
  assert.equal(baseBranchOf(config, '/work/app'), 'main');
  assert.equal(baseBranchOf(config, '/work/lib'), 'master');
  assert.equal(baseBranchOf(config, '/work/other'), 'master');
  assert.equal(baseBranchOf({ repo: {} }, '/work/app'), '');
  assert.equal(baseBranchOf(null, '/work/app'), '');
});
