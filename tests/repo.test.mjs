import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolve, normalizeRemote, ForgeError } from '../plugins/forge/scripts/lib/repo.mjs';

let root, app, worktree, wiki, outside;
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' });
const env = {};

function bind(dir, repo) {
  mkdirSync(path.join(dir, 'forge'), { recursive: true });
  writeFileSync(path.join(dir, 'forge', 'repo.json'), JSON.stringify({ schemaVersion: 1, repo }));
}

before(() => {
  root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'forge-repo-')));
  app = path.join(root, 'app');
  mkdirSync(app);
  git(app, 'init', '-q', '-b', 'main');
  git(app, 'remote', 'add', 'origin', 'git@github.com:Owner/App.git');
  writeFileSync(path.join(app, 'a.txt'), 'a');
  git(app, 'add', '.');
  git(app, 'commit', '-q', '-m', 'init');
  mkdirSync(path.join(root, 'app.worktrees'));
  worktree = path.join(root, 'app.worktrees', 'feat');
  git(app, 'worktree', 'add', '-q', '-b', 'feat', worktree);
  mkdirSync(path.join(worktree, 'sub'));
  wiki = path.join(root, 'app.wiki');
  mkdirSync(wiki);
  git(wiki, 'init', '-q');
  outside = path.join(root, 'plain');
  mkdirSync(outside);
});

after(() => rmSync(root, { recursive: true, force: true }));

test('normalizeRemote handles scp, ssh, and https forms', () => {
  assert.equal(normalizeRemote('git@github.com:Owner/App.git'), 'https://github.com/owner/app');
  assert.equal(normalizeRemote('ssh://git@gitlab.com:2222/group/sub/app.git'), 'https://gitlab.com/group/sub/app');
  assert.equal(normalizeRemote('https://user@github.com/Owner/App/'), 'https://github.com/owner/app');
  assert.equal(normalizeRemote(null), null);
});

test('main checkout uses the sibling wiki', () => {
  const r = resolve({ cwd: app, env });
  assert.equal(r.repo.path, app);
  assert.equal(r.repo.worktree, null);
  assert.equal(r.repo.remote, 'https://github.com/owner/app');
  assert.equal(r.wiki.path, wiki);
  assert.equal(r.wiki.source, 'convention');
  assert.equal(r.configDir, path.join(wiki, 'forge', 'config'));
});

test('a linked worktree resolves to the main checkout, not to the worktree', () => {
  const r = resolve({ cwd: path.join(worktree, 'sub'), env });
  assert.equal(r.repo.path, app);
  assert.equal(r.repo.worktree, worktree);
  assert.equal(r.wiki.path, wiki);
});

test('an unbound sibling wiki resolves back to its repo and warns', () => {
  const r = resolve({ cwd: wiki, env });
  assert.equal(r.repo.path, app);
  assert.equal(r.wiki.source, 'legacy-sibling');
  assert.equal(r.wiki.bound, false);
  assert.match(r.warnings.join('\n'), /no forge\/repo\.json/);
});

test('a bound wiki resolves to the repo in repo.json (automation in the wiki)', () => {
  bind(wiki, { path: app, remote: 'https://github.com/owner/app' });
  try {
    const r = resolve({ cwd: wiki, env });
    assert.equal(r.wiki.source, 'binding');
    assert.equal(r.repo.path, app);
    assert.equal(r.wiki.bound, true);
    assert.deepEqual(r.warnings, []);
  } finally {
    rmSync(path.join(wiki, 'forge'), { recursive: true, force: true });
  }
});

test('a wiki bound to another remote fails closed', () => {
  bind(wiki, { path: app, remote: 'https://github.com/other/repo' });
  try {
    assert.throws(() => resolve({ cwd: app, env }), (e) => e instanceof ForgeError && e.code === 'wiki-mismatch');
  } finally {
    rmSync(path.join(wiki, 'forge'), { recursive: true, force: true });
  }
});

test('--wiki inside another wiki fails', () => {
  assert.throws(() => resolve({ cwd: wiki, wiki: path.join(root, 'elsewhere'), env }), (e) => e.code === 'wiki-mismatch');
});

test('--wiki overrides the convention for one call', () => {
  const r = resolve({ cwd: app, wiki: path.join(root, 'custom.wiki'), env });
  assert.equal(r.wiki.path, path.join(root, 'custom.wiki'));
  assert.equal(r.wiki.source, 'override');
  assert.equal(r.wiki.exists, false);
});

test('a global FORGE_WIKI_ROOT is ignored with a warning', () => {
  const r = resolve({ cwd: app, env: { FORGE_WIKI_ROOT: path.join(root, 'company.wiki') } });
  assert.equal(r.wiki.path, wiki);
  assert.match(r.warnings.join('\n'), /FORGE_WIKI_ROOT/);
});

test('a folder outside Git fails with not-git', () => {
  assert.throws(() => resolve({ cwd: outside, env }), (e) => e.code === 'not-git');
});
