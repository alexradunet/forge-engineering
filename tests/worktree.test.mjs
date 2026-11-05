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
  git(app, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(app, 'a.txt'), 'a\n');
  git(app, 'add', 'a.txt');
  git(app, 'commit', '-q', '-m', 'init');
  const config = defaults();
  config.repo.branchPattern = 'smurfs/alex_radu/{KEY}-{slug}';
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
  const key = parseKey('mfd-241223');
  assert.deepEqual(key, { KEY: 'MFD-241223', key: 'mfd-241223', number: '241223' });
  assert.equal(branchName('smurfs/alex_radu/{KEY}-{slug}', key, 'doc-import'), 'smurfs/alex_radu/MFD-241223-doc-import');
  assert.equal(branchName('{key}/{number}-{slug}', key, 'x'), 'mfd-241223/241223-x');
  assert.throws(() => parseKey('MFD 1'), /Invalid key/);
});

test('from the main checkout the plan creates <repo>.worktrees/<key>-<slug> on the base SHA', (t) => {
  const r = repo(t);
  const plan = planWorktree({ repoPath: r.app, config: r.config, key: 'MFD-7', summary: 'Doc import error telemetry' });
  assert.equal(plan.action, 'create');
  assert.equal(plan.branch, 'smurfs/alex_radu/MFD-7-doc-import-error-telemetry');
  assert.equal(plan.folder, path.join(`${r.app}.worktrees`, 'mfd-7-doc-import-error-telemetry'));
  assert.deepEqual(plan.base, { ref: 'main', sha: r.sha });
  assert.equal(plan.current.linked, false);
  assert.deepEqual(plan.commands, [`git worktree add -b ${plan.branch} "${plan.folder}" ${r.sha}`]);
  const made = createWorktree(plan, r.app);
  assert.equal(made.status, 'created');
  assert.equal(made.head, r.sha);
  assert.equal(git(plan.folder, 'branch', '--show-current'), plan.branch);
  const again = planWorktree({ repoPath: r.app, config: r.config, key: 'MFD-7', summary: 'Doc import error telemetry' });
  assert.equal(again.action, 'resume');
  assert.equal(createWorktree(again, r.app).status, 'skipped');
  const inside = planWorktree({ repoPath: r.app, cwd: plan.folder, config: r.config, key: 'MFD-7', summary: 'Doc import error telemetry' });
  assert.equal(inside.action, 'reuse');
  assert.deepEqual(inside.commands, []);
});

test('a New Worktree session on an agents/ branch gets a branch rename, and other ticket worktrees are listed', (t) => {
  const r = repo(t);
  const agents = path.join(`${r.app}.worktrees`, 'start-ticket-mfd-8');
  git(r.app, 'worktree', 'add', '-q', '-b', 'agents/start-ticket-mfd-8', agents);
  const plan = planWorktree({ repoPath: r.app, cwd: agents, config: r.config, key: 'MFD-8', summary: 'Retry outbox' });
  assert.equal(plan.action, 'rename-current');
  assert.deepEqual(plan.commands, ['git branch -m smurfs/alex_radu/MFD-8-retry-outbox']);
  assert.deepEqual(plan.related.map((item) => item.branch), ['agents/start-ticket-mfd-8']);
  const other = planWorktree({ repoPath: r.app, config: r.config, key: 'MFD-80', summary: 'Other ticket' });
  assert.deepEqual(other.related, [], 'MFD-8 is not MFD-80.');
});

test('createWorktree refuses a foreign folder and a missing base', (t) => {
  const r = repo(t);
  const plan = planWorktree({ repoPath: r.app, config: r.config, key: 'MFD-9', summary: 'Busy folder' });
  mkdirSync(plan.folder, { recursive: true });
  assert.throws(() => createWorktree(planWorktree({ repoPath: r.app, config: r.config, key: 'MFD-9', summary: 'Busy folder' }), r.app), /is not a worktree/);
  const missing = planWorktree({ repoPath: r.app, config: r.config, key: 'MFD-10', summary: 'No base', base: 'nope' });
  assert.equal(missing.base.sha, null);
  assert.throws(() => createWorktree(missing, r.app), /does not resolve/);
  assert.equal(existsSync(missing.folder), false);
});

test('forge.mjs worktree prints the plan and needs --summary', (t) => {
  const r = repo(t);
  const wiki = path.join(r.root, 'app.wiki');
  mkdirSync(wiki);
  const run = (...args) => spawnSync(process.execPath, [cli, 'worktree', ...args, '--cwd', r.app, '--wiki', wiki], { encoding: 'utf8' });
  const plan = run('MFD-11', '--summary', 'Board view', '--json');
  assert.equal(plan.status, 0, plan.stderr);
  const report = JSON.parse(plan.stdout);
  assert.equal(report.branch, 'MFD-11-board-view');
  assert.equal(report.action, 'create');
  assert.equal(existsSync(report.folder), false, 'Without --create the command is read-only.');
  const made = run('MFD-11', '--summary', 'Board view', '--create');
  assert.equal(made.status, 0, made.stderr);
  assert.match(made.stdout, /MFD-11: created/);
  assert.equal(run('MFD-11').status, 1);
});
