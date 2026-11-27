import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from '../plugins/forge/scripts/lib/repo.mjs';
import { initWiki, seed } from '../plugins/forge/scripts/lib/setup.mjs';
import { doctor } from '../plugins/forge/scripts/forge.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const realPlugin = path.join(here, '..', 'plugins', 'forge');
let root, app, env, where;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
const line = (results, check) => results.find((r) => r.check === check);
before(() => {
  root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'forge-doctor-')));
  env = { ...process.env, FORGE_DATA_DIR: path.join(root, 'data') };
  app = path.join(root, 'app');
  mkdirSync(app);
  git(app, 'init', '-q', '-b', 'main');
  git(app, 'remote', 'add', 'origin', 'https://github.com/owner/app.git');
  where = resolve({ cwd: app, env });
  initWiki(where);
  seed(where, path.join(realPlugin, 'templates', 'config'));
});
after(() => rmSync(root, { recursive: true, force: true }));

test('doctor runs no login check, no profile check, and no credential or MCP check', () => {
  const results = doctor({ cwd: app, env });
  assert.ok(!results.some((r) => /login|^profile$|^cred:|^mcp:/.test(r.check)), results.map((r) => r.check).join(', '));
  assert.ok(!results.some((r) => /is not on PATH/.test(r.detail)));
});

test('hook check: warn without .plugin, warn for a gone folder, ok for a plugin folder', () => {
  const missing = line(doctor({ cwd: app, env }), 'hook');
  assert.equal(missing.status, 'warn');
  assert.match(missing.detail, /^No session start seen\./);
  const pointer = path.join(where.forge.path, '.plugin');
  writeFileSync(pointer, path.join(root, 'gone') + '\n');
  const gone = line(doctor({ cwd: app, env }), 'hook');
  assert.equal(gone.status, 'warn');
  assert.match(gone.detail, /The plugin folder in \.plugin is gone: /);
  writeFileSync(pointer, realPlugin + '\n');
  const ok = line(doctor({ cwd: app, env }), 'hook');
  assert.deepEqual([ok.status, ok.detail], ['ok', realPlugin]);
});

test('plugin version: behind warns, up to date is ok, a non-clone is ok', () => {
  const bare = path.join(root, 'upstream.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', bare);
  const clone = path.join(root, 'clone');
  git(root, 'clone', '-q', bare, clone);
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 't']]) git(clone, 'config', k, v);
  const plugin = path.join(clone, 'plugins', 'forge');
  mkdirSync(plugin, { recursive: true });
  writeFileSync(path.join(plugin, 'plugin.json'), JSON.stringify({ name: 'forge', version: '1.2.3' }));
  git(clone, 'add', '-A');
  git(clone, 'commit', '-q', '-m', 'one');
  git(clone, 'push', '-q', '-u', 'origin', 'main');
  const version = (opts = {}) => line(doctor({ cwd: app, env, plugin, ...opts }), 'plugin:version');
  assert.deepEqual([version().status, version().detail], ['ok', '1.2.3 (Git clone, up to date)']);

  const other = path.join(root, 'other');
  git(root, 'clone', '-q', bare, other);
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 't']]) git(other, 'config', k, v);
  writeFileSync(path.join(other, 'x.txt'), 'x');
  git(other, 'add', '-A');
  git(other, 'commit', '-q', '-m', 'two');
  git(other, 'push', '-q');
  assert.equal(version().status, 'ok', 'no fetch yet, so the clone does not know');
  const behind = version({ fetch: true });
  assert.equal(behind.status, 'warn');
  assert.match(behind.detail, /^1 commits behind origin\/main\. Run: git -C ".+" pull\. Then start a new session\.$/);

  const plain = path.join(root, 'plain', 'plugins', 'forge');
  mkdirSync(plain, { recursive: true });
  cpSync(path.join(plugin, 'plugin.json'), path.join(plain, 'plugin.json'));
  const nc = line(doctor({ cwd: app, env, plugin: plain }), 'plugin:version');
  assert.deepEqual([nc.status, nc.detail], ['ok', '1.2.3 (not a Git clone: the host updates it)']);
});

test('fix commands: the wiki, the binding, and the config files name an exact command', () => {
  const lone = path.join(root, 'lone');
  mkdirSync(lone);
  git(lone, 'init', '-q', '-b', 'main');
  assert.match(line(doctor({ cwd: lone, env }), 'wiki').detail, /Run "forge\.mjs init", or say "set up forge"\./);
  mkdirSync(`${lone}.wiki`);
  assert.match(line(doctor({ cwd: lone, env }), 'wiki').detail, /^Forge 10 does not read \.\.\/<repo>\.wiki\. Make \.\.\/<repo>\.forge, move the wiki into wiki\/, and move raw\/ and archive\/ next to it\.$/);
  rmSync(`${lone}.wiki`, { recursive: true });
  rmSync(path.join(where.configDir, 'policy.md'));
  assert.match(line(doctor({ cwd: app, env }), 'config:policy.md').detail, /Run "forge\.mjs seed"\./);
});

test('doctor names the files that Forge 14 does not use, and deletes none', () => {
  const clean = doctor({ cwd: app, env });
  assert.ok(!clean.some((r) => r.check.startsWith('unused:')));
  const old = [path.join(where.configDir, 'tracker.md'), path.join(where.configDir, 'ci.md'), path.join(where.wiki.path, 'rules', 'toolkit.md')];
  for (const file of old) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, '---\nprovider: github\n---\n'); }
  const binding = path.join(where.wiki.path, 'forge', 'repo.json');
  const bound = readFileSync(binding, 'utf8');
  writeFileSync(binding, JSON.stringify({ ...JSON.parse(bound), profile: 'forgejo' }));
  try {
    const results = doctor({ cwd: app, env });
    const unused = results.filter((r) => r.check.startsWith('unused:'));
    assert.deepEqual(unused.map((r) => r.check), ['unused:config/tracker.md', 'unused:config/ci.md', 'unused:rules/toolkit.md', 'unused:forge/repo.json profile']);
    assert.ok(unused.every((r) => r.status === 'warn' && /not used since 14\.0\.0, remove/.test(r.detail)));
    assert.ok(!results.some((r) => r.status === 'fail' && r.check === 'config'), 'an old tracker.md does not break the config');
    for (const file of old) assert.ok(existsSync(file), `${file} stays`);
  } finally {
    writeFileSync(binding, bound);
    for (const file of old) rmSync(file, { force: true });
  }
});
