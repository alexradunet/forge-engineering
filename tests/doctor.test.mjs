import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
// A fake gh on PATH, so that the login check runs in each environment.
const fakeBin = () => {
  const bin = path.join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'gh'), '');
  writeFileSync(path.join(bin, 'gh.cmd'), '');
  return { ...env, PATH: bin + path.delimiter + env.PATH };
};

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

test('login check: ok and warn from the exit status, one run for each tool', () => {
  const env2 = fakeBin();
  const calls = [];
  const ok = doctor({ cwd: app, env: env2, run: (cmd, args) => { calls.push([cmd, ...args]); return true; } });
  assert.equal(line(ok, 'tool:gh login')?.status, 'ok');
  assert.deepEqual(calls, [['gh', 'auth', 'status']]);
  const bad = line(doctor({ cwd: app, env: env2, run: () => false }), 'tool:gh login');
  assert.equal(bad.status, 'warn');
  assert.match(bad.detail, /Run "gh auth login"\./);
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
  rmSync(path.join(where.configDir, 'ci.md'));
  assert.match(line(doctor({ cwd: app, env }), 'config:ci.md').detail, /Run "forge\.mjs seed"\./);
});

test('a wiki bound to a profile: the tools of the profile, the profile line, and the login hint', () => {
  const dir = path.join(root, 'fj');
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'remote', 'add', 'origin', 'https://git.example.org/me/fj.git');
  const w = resolve({ cwd: dir, env });
  initWiki(w);
  seed(w, path.join(realPlugin, 'templates', 'config'), { profile: 'forgejo' });
  const bin = path.join(root, 'bin-tea');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'tea'), '');
  writeFileSync(path.join(bin, 'tea.cmd'), '');
  const env2 = { ...env, PATH: bin + path.delimiter + env.PATH };
  const none = doctor({ cwd: dir, env: { ...env, PATH: path.join(root, 'empty') }, read: () => ({ ok: false, stdout: '' }) });
  assert.match(line(none, 'profile').detail, /^forgejo$/);
  assert.ok(none.some((r) => r.check.startsWith('config:') && /^tea is not on PATH/.test(r.detail)), 'a missing tea is a warning');
  assert.equal(none.some((r) => r.check.startsWith('tool:gh')), false);
  const empty = doctor({ cwd: dir, env: env2, read: () => ({ ok: true, stdout: '[]' }) });
  assert.equal(line(empty, 'tool:tea login').status, 'warn');
  assert.match(line(empty, 'tool:tea login').detail, /Run "tea login add"\./);
  const ok = doctor({ cwd: dir, env: env2, read: () => ({ ok: true, stdout: '[{"name":"x"}]' }) });
  assert.equal(line(ok, 'tool:tea login').status, 'ok');
  assert.equal(ok.some((r) => r.check.startsWith('tool:gh')), false);
  assert.match(line(doctor({ cwd: app, env }), 'profile').detail, /^default \(github\)$/);
});
