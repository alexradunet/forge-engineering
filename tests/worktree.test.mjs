import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaults } from '../plugins/forge/scripts/lib/config.mjs';
import { branchName, createWorktree, parseKey, planWorktree, slugify } from '../plugins/forge/scripts/lib/worktree.mjs';

const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));

function git(cwd, ...args) {
  const result = spawnSync('git', ['-C', cwd, '-c', 'user.name=Forge Test', '-c', 'user.email=forge@example.test', ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function repo(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'forge-worktree-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'app');
  mkdirSync(app);
  git(app, 'init', '-q', '-b', 'master');
  writeFileSync(path.join(app, 'a.txt'), 'a\n');
  git(app, 'add', 'a.txt');
  git(app, 'commit', '-q', '-m', 'init');
  const config = defaults();
  config.repo.branchPattern = 'users/alex_radu/{KEY}-{slug}';
  return { root, app, config, sha: git(app, 'rev-parse', 'HEAD') };
}

test('slugify keeps 2 to 5 plain words of the goal', () => {
  assert.equal(slugify('Fix the outbox retry on timeout for invoices'), 'fix-outbox-retry-timeout-invoices');
  assert.equal(slugify('Doc import: error telemetry (v2)!'), 'doc-import-error-telemetry-v2');
  assert.equal(slugify('Café   naïve résumé'), 'cafe-naive-resume');
  assert.equal(slugify('to the'), 'to-the');
  assert.equal(slugify('?!'), '');
  assert.ok(slugify('supercalifragilistic expialidocious internationalization localization').length <= 40);
});

test('branch names follow repo.branchPattern with every placeholder', () => {
  const key = parseKey('app-241223');
  assert.deepEqual(key, { KEY: 'APP-241223', key: 'app-241223', number: '241223' });
  assert.equal(branchName('users/alex_radu/{KEY}-{slug}', key, 'doc-import'), 'users/alex_radu/APP-241223-doc-import');
  assert.equal(branchName('{key}/{number}-{slug}', key, 'x'), 'app-241223/241223-x');
  assert.throws(() => parseKey('APP 1'), /Invalid key/);
});

test('from the main checkout the plan creates <repo>.worktrees/<key>-<slug> on the base SHA', (t) => {
  const r = repo(t);
  const plan = planWorktree({ repoPath: r.app, config: r.config, key: 'APP-7', summary: 'Doc import error telemetry' });
  assert.equal(plan.action, 'create');
  assert.equal(plan.branch, 'users/alex_radu/APP-7-doc-import-error-telemetry');
  assert.equal(plan.folder, path.join(`${r.app}.worktrees`, 'app-7-doc-import-error-telemetry'));
  assert.deepEqual(plan.base, { ref: 'master', sha: r.sha });
  assert.equal(plan.current.linked, false);
  assert.deepEqual(plan.commands, [`git worktree add -b ${plan.branch} "${plan.folder}" ${r.sha}`]);
  const made = createWorktree(plan, r.app);
  assert.equal(made.status, 'created');
  assert.equal(made.head, r.sha);
  assert.equal(git(plan.folder, 'branch', '--show-current'), plan.branch);
  const again = planWorktree({ repoPath: r.app, config: r.config, key: 'APP-7', summary: 'Doc import error telemetry' });
  assert.equal(again.action, 'resume');
  assert.equal(createWorktree(again, r.app).status, 'skipped');
  const inside = planWorktree({ repoPath: r.app, cwd: plan.folder, config: r.config, key: 'APP-7', summary: 'Doc import error telemetry' });
  assert.equal(inside.action, 'reuse');
  assert.deepEqual(inside.commands, []);
});

test('other worktrees of the ticket are listed', (t) => {
  const r = repo(t);
  const older = path.join(`${r.app}.worktrees`, 'app-8-older-name');
  git(r.app, 'worktree', 'add', '-q', '-b', 'APP-8-older-name', older);
  const plan = planWorktree({ repoPath: r.app, config: r.config, key: 'APP-8', summary: 'Retry outbox' });
  assert.equal(plan.action, 'create');
  assert.deepEqual(plan.related.map((item) => item.branch), ['APP-8-older-name']);
  const other = planWorktree({ repoPath: r.app, config: r.config, key: 'APP-80', summary: 'Other ticket' });
  assert.deepEqual(other.related, [], 'APP-8 is not APP-80.');
});

test('createWorktree refuses a foreign folder and a missing base', (t) => {
  const r = repo(t);
  const plan = planWorktree({ repoPath: r.app, config: r.config, key: 'APP-9', summary: 'Busy folder' });
  mkdirSync(plan.folder, { recursive: true });
  assert.throws(() => createWorktree(planWorktree({ repoPath: r.app, config: r.config, key: 'APP-9', summary: 'Busy folder' }), r.app), /is not a worktree/);
  const missing = planWorktree({ repoPath: r.app, config: r.config, key: 'APP-10', summary: 'No base', base: 'nope' });
  assert.equal(missing.base.sha, null);
  assert.throws(() => createWorktree(missing, r.app), /does not resolve/);
  assert.equal(existsSync(missing.folder), false);
});

test('planWorktree refuses the template branch pattern with <user>', (t) => {
  const r = repo(t);
  const config = { ...r.config, repo: { ...r.config.repo, branchPattern: 'users/<user>/{KEY}-{slug}' } };
  assert.throws(() => planWorktree({ repoPath: r.app, config, key: 'APP-12', summary: 'No user' }), /still holds <user>/);
  const named = planWorktree({ repoPath: r.app, config: { ...config, repo: { ...config.repo, branchPattern: 'users/alex/{KEY}-{slug}' } }, key: 'APP-12', summary: 'No user' });
  assert.equal(named.branch, 'users/alex/APP-12-no-user');
});

test('forge.mjs worktree prints the plan and needs --summary', (t) => {
  const r = repo(t);
  const wiki = path.join(r.root, 'app.wiki');
  mkdirSync(wiki);
  const run = (...args) => spawnSync(process.execPath, [cli, 'worktree', ...args, '--cwd', r.app, '--wiki', wiki], { encoding: 'utf8' });
  const plan = run('APP-11', '--summary', 'Board view', '--json');
  assert.equal(plan.status, 0, plan.stderr);
  const report = JSON.parse(plan.stdout);
  assert.equal(report.branch, 'APP-11-board-view');
  assert.equal(report.action, 'create');
  assert.equal(existsSync(report.folder), false, 'Without --create the command is read-only.');
  const made = run('APP-11', '--summary', 'Board view', '--create');
  assert.equal(made.status, 0, made.stderr);
  assert.match(made.stdout, /APP-11: created/);
  assert.equal(run('APP-11').status, 1);
});

test('the worktree plan for a local key L-3 names the folder and the branch like each other key', (t) => {
  const r = repo(t);
  assert.deepEqual(parseKey('l-3'), { KEY: 'L-3', key: 'l-3', number: '3' });
  const plan = planWorktree({ repoPath: r.app, config: r.config, key: 'L-3', summary: 'Local retry fix' });
  assert.equal(plan.action, 'create');
  assert.equal(plan.branch, 'users/alex_radu/L-3-local-retry-fix');
  assert.equal(plan.folder, path.join(`${r.app}.worktrees`, 'l-3-local-retry-fix'));
});
