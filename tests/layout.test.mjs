// The Forge folder of a repository (Forge 9): the layout, the resolver, the launcher, and the pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContext } from '../plugins/forge/scripts/lib/hook.mjs';
import { LAUNCHER_SH, compareVersions, readPointer, writeLauncher, writePointer } from '../plugins/forge/scripts/lib/launcher.mjs';
import { archiveDir, homeOf, isForgeLayout, rawDir } from '../plugins/forge/scripts/lib/layout.mjs';
import { resolve } from '../plugins/forge/scripts/lib/repo.mjs';
import { initWiki } from '../plugins/forge/scripts/lib/setup.mjs';
import { nextLocalKey } from '../plugins/forge/scripts/lib/tickets.mjs';

const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const plugin = path.dirname(path.dirname(cli));
const templates = path.join(plugin, 'templates', 'config');

function space(t) {
  const root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'forge-layout-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, FORGE_DATA_DIR: path.join(root, 'data'), FORGE_HOME: '' };
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const repo = (name) => {
    const dir = path.join(root, name);
    mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'remote', 'add', 'origin', `https://github.com/owner/${name}.git`);
    return dir;
  };
  const put = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
  return { root, env, git, repo, put };
}

test('only the wiki folder of a <name>.forge folder has raw and archive next to it', () => {
  const at = (...parts) => path.resolve(path.sep, 'w', ...parts);
  assert.equal(isForgeLayout(at('app.forge', 'wiki')), true);
  assert.equal(isForgeLayout(at('APP.Forge', 'wiki')), true, 'the name has no difference between capital and small letters');
  for (const other of [at('app.wiki'), at('app.forge'), at('app.forge', 'pages'), at('team', 'wiki'), at('app.forge', 'wiki', 'deep')]) assert.equal(isForgeLayout(other), false, other);
  assert.deepEqual([homeOf(at('app.forge', 'wiki')), rawDir(at('app.forge', 'wiki')), archiveDir(at('app.forge', 'wiki'))], [at('app.forge'), at('app.forge', 'raw'), at('app.forge', 'archive')]);
  // A folder that the user gives with --wiki: the Forge folder and the wiki are one folder.
  assert.equal(rawDir(at('team', 'wiki')), at('team', 'wiki', 'raw'));
});

test('the resolver finds the Forge folder from the repository, a worktree, the wiki, raw, and the launcher variable', (t) => {
  const s = space(t);
  const app = s.repo('app');
  const home = `${app}.forge`;
  const wiki = path.join(home, 'wiki');
  // A new repository gets the Forge folder.
  assert.deepEqual([resolve({ cwd: app, env: s.env }).wiki.path, resolve({ cwd: app, env: s.env }).wiki.exists], [wiki, false]);

  // A wiki without a binding inside a Forge folder goes back to its repository by the name of the folder.
  mkdirSync(wiki, { recursive: true });
  s.git(wiki, 'init', '-q', '-b', 'main');
  const unbound = resolve({ cwd: wiki, env: s.env });
  assert.deepEqual([unbound.repo.path, unbound.wiki.source], [app, 'sibling']);
  assert.throws(() => resolve({ cwd: os.tmpdir(), env: { ...s.env, FORGE_HOME: home } }), (error) => error.code === 'not-bound');

  const both = resolve({ cwd: app, env: s.env });
  assert.deepEqual([both.wiki.path, both.forge.path, both.forge.layout, both.raw, both.archive], [wiki, home, 'forge', path.join(home, 'raw'), path.join(home, 'archive')]);
  initWiki(resolve({ cwd: app, env: s.env }), { pluginDir: plugin });

  s.git(app, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'first');
  const tree = path.join(`${app}.worktrees`, 'APP-9-fix');
  s.git(app, 'worktree', 'add', '-q', '-b', 'users/t/APP-9-fix', tree);
  const linked = resolve({ cwd: tree, env: s.env });
  assert.deepEqual([linked.repo.path, linked.repo.worktree, linked.wiki.path, linked.top], [app, tree, wiki, tree]);
  assert.deepEqual([resolve({ cwd: wiki, env: s.env }).repo.path, resolve({ cwd: wiki, env: s.env }).wiki.source], [app, 'binding']);

  // raw/ and archive/ are in no git repository: the Forge folder above them gives the repository.
  const ticket = path.join(home, 'raw', 'tickets', 'app-9');
  mkdirSync(ticket, { recursive: true });
  for (const folder of [ticket, path.join(home, 'archive'), home]) {
    const found = resolve({ cwd: folder, env: s.env });
    assert.deepEqual([found.repo.path, found.wiki.path, found.wiki.source, found.top, found.repo.worktree], [app, wiki, 'binding', wiki, null], folder);
  }
  assert.throws(() => resolve({ cwd: s.root, env: s.env }), (error) => error.code === 'not-git');
  // A code repository with the name <name>.forge and a wiki/ folder of its own is a repository, not a Forge folder.
  const odd = s.repo('tool.forge');
  mkdirSync(path.join(odd, 'wiki'));
  assert.deepEqual([resolve({ cwd: path.join(odd, 'wiki'), env: s.env }).repo.path, resolve({ cwd: odd, env: s.env }).wiki.path], [odd, path.join(`${odd}.forge`, 'wiki')]);

  // The launcher gives its Forge folder: it wins over the folder of another repository, and it keeps the worktree of its own repository.
  const other = s.repo('other');
  const launched = resolve({ cwd: other, env: { ...s.env, FORGE_HOME: home } });
  assert.deepEqual([launched.repo.path, launched.wiki.path, launched.wiki.source, launched.top, launched.repo.worktree], [app, wiki, 'launcher', app, null]);
  assert.equal(resolve({ cwd: s.root, env: { ...s.env, FORGE_HOME: home } }).repo.path, app, 'also from a folder outside of git');
  assert.deepEqual([resolve({ cwd: tree, env: { ...s.env, FORGE_HOME: home } }).repo.worktree, resolve({ cwd: tree, env: { ...s.env, FORGE_HOME: home } }).top], [tree, tree]);
  // --wiki is the choice of the user for one call, so it comes before the launcher variable.
  mkdirSync(path.join(s.root, 'team', 'wiki'), { recursive: true });
  const given = resolve({ cwd: app, wiki: path.join(s.root, 'team', 'wiki'), env: { ...s.env, FORGE_HOME: home } });
  assert.deepEqual([given.wiki.source, given.forge.path, given.forge.layout], ['override', path.join(s.root, 'team', 'wiki'), 'wiki']);
});

test('the launcher runs forge.mjs of the plugin for its own Forge folder, from each folder', { skip: process.platform === 'win32' }, (t) => {
  const s = space(t);
  const app = s.repo('app');
  const init = spawnSync(process.execPath, [cli, 'init', '--cwd', app], { encoding: 'utf8', env: s.env });
  assert.equal(init.status, 0, init.stderr);
  const home = `${app}.forge`;
  assert.deepEqual(JSON.parse(init.stdout).created.filter((name) => name.startsWith('../')), ['../raw/', '../archive/', '../forge', '../forge.cmd', '../.plugin']);
  assert.equal(readPointer(home), plugin, 'init gives the launcher the path of this plugin');
  const launch = (cwd, ...args) => spawnSync(path.join(home, 'forge'), args, { cwd, encoding: 'utf8', env: s.env });
  for (const cwd of [app, s.root, os.tmpdir()]) {
    const where = launch(cwd, 'where');
    assert.equal(where.status, 0, where.stderr);
    assert.deepEqual([JSON.parse(where.stdout).repo.path, JSON.parse(where.stdout).wiki.source], [app, 'launcher'], cwd);
  }
  const board = launch(s.root, 'board');
  assert.equal(board.status, 0, board.stderr);
  assert.ok(existsSync(path.join(home, 'raw', 'board.html')) && existsSync(path.join(home, 'raw', 'wiki.html')));
  // The exit code and the arguments go through.
  assert.equal(launch(s.root, 'open', '--status').status, 1);
  const gone = launch(s.root, 'canvas', 'X');
  assert.equal(gone.status, 2, 'the canvas command is removed: the usage error');
  assert.match(gone.stderr, /^Usage: node forge\.mjs <where\|/);
  assert.doesNotMatch(gone.stderr, /canvas/);
  // Without the path of the plugin, the launcher says what to do.
  writeFileSync(path.join(home, '.plugin'), `${path.join(s.root, 'gone')}\n`);
  const lost = launch(s.root, 'where');
  assert.deepEqual([lost.status, lost.stdout], [1, '']);
  assert.match(lost.stderr, /^forge: the path of the forge plugin is not known, or the plugin moved\.\nStart one agent session in the repository/);
  rmSync(path.join(home, '.plugin'));
  assert.equal(launch(s.root, 'where').status, 1);
});

test('the path of the plugin goes to a newer plugin, and not back to an older one that is still there', (t) => {
  const s = space(t);
  const home = path.join(s.root, 'app.forge');
  mkdirSync(home);
  const make = (name, version) => {
    const dir = path.join(s.root, name);
    s.put(path.join(dir, 'plugin.json'), JSON.stringify({ version }));
    s.put(path.join(dir, 'scripts', 'forge.mjs'), '');
    return dir;
  };
  const [v90, v91, v92] = [make('p90', '9.0.0'), make('p91', '9.1.0'), make('p92', '9.10.0')];
  assert.equal(readPointer(home), '');
  assert.deepEqual([writePointer(home, v91), readPointer(home)], [true, v91]);
  assert.deepEqual([writePointer(home, v91), writePointer(home, v90), readPointer(home)], [false, false, v91], 'an older plugin of another host does not take the launcher back');
  assert.deepEqual([writePointer(home, v92), readPointer(home)], [true, v92], '9.10 is newer than 9.1');
  rmSync(v92, { recursive: true });
  assert.deepEqual([writePointer(home, v90), readPointer(home)], [true, v90], 'a plugin folder that is gone is replaced');
  assert.deepEqual([compareVersions('9.10.0', '9.2.0'), compareVersions('9.0.0', '9.0'), compareVersions('8.4.0', '9.0.0'), compareVersions('', '')], [1, 0, -1, 0]);
  assert.deepEqual([writeLauncher(home), writeLauncher(home)], [['forge', 'forge.cmd'], []]);
  assert.equal(readFileSync(path.join(home, 'forge'), 'utf8'), LAUNCHER_SH);
  assert.ok(!LAUNCHER_SH.includes('\r'), 'the sh launcher has LF line ends on each machine');
});

test('the session context names the Forge folder, and the session start keeps the launcher current', (t) => {
  const s = space(t);
  const app = s.repo('app');
  initWiki(resolve({ cwd: app, env: s.env }));
  const home = `${app}.forge`;
  rmSync(path.join(home, 'forge'));
  assert.equal(readPointer(home), '', 'init without a plugin folder writes no path');
  const { body } = buildContext({ cwd: app, source: 'startup', prompt: '' }, { cli, env: s.env, host: 'claude' });
  const line = body.split('\n').find((text) => text.startsWith('`<plugin>`'));
  assert.equal(line, `\`<plugin>\` is \`${plugin}\`. \`<repo>\` is \`${app}\`. \`<forge>\` is \`${home}\`. \`<wiki>\` is \`${path.join(home, 'wiki')}\`. \`<config>\` is \`${path.join(home, 'wiki', 'forge', 'config')}\`.`);
  assert.equal(readPointer(home), plugin);
  assert.ok(existsSync(path.join(home, 'forge')), 'a launcher that is gone comes back');
});

test('nextLocalKey counts up from the counter, the raw and archive folders, and the wiki pages', (t) => {
  const s = space(t);
  const wiki = path.join(s.root, 'app.forge', 'wiki');
  const raw = rawDir(wiki);
  mkdirSync(wiki, { recursive: true });
  assert.deepEqual([nextLocalKey(wiki), nextLocalKey(wiki)], ['L-1', 'L-2']);
  assert.equal(readFileSync(path.join(raw, 'local-key'), 'utf8').trim(), '2');
  mkdirSync(path.join(raw, 'tickets', 'l-7'), { recursive: true });
  assert.equal(nextLocalKey(wiki), 'L-8', 'a raw folder');
  mkdirSync(path.join(archiveDir(wiki), 'tickets', 'L-9'), { recursive: true });
  assert.equal(nextLocalKey(wiki), 'L-10', 'an archive folder');
  s.put(path.join(wiki, 'tickets', 'L-12.md'), '# L-12 Done\n');
  s.put(path.join(wiki, 'tickets', 'app-99.md'), '# APP-99 Other\n');
  assert.equal(nextLocalKey(wiki), 'L-13', 'a wiki page in any letter case, and no other prefix');
  writeFileSync(path.join(raw, 'local-key'), '40\n');
  assert.equal(nextLocalKey(wiki), 'L-41', 'a higher counter wins');
  writeFileSync(path.join(raw, 'local-key'), 'text');
  assert.equal(nextLocalKey(wiki), 'L-13', 'a counter with text gives the scan result');
});

test('nextLocalKey refuses a link in place of the counter file', (t) => {
  const s = space(t);
  const wiki = path.join(s.root, 'app.forge', 'wiki');
  mkdirSync(path.join(wiki, '..', 'raw'), { recursive: true });
  s.put(path.join(s.root, 'other'), '5\n');
  try { symlinkSync(path.join(s.root, 'other'), path.join(wiki, '..', 'raw', 'local-key')); } catch { t.skip('Links cannot be made here.'); return; }
  assert.throws(() => nextLocalKey(wiki), /must not be a link/);
  assert.equal(readFileSync(path.join(s.root, 'other'), 'utf8'), '5\n');
});

test('forge.mjs local-key prints the next key, as text or as JSON', (t) => {
  const s = space(t);
  const wiki = path.join(s.root, 'team-wiki');
  mkdirSync(wiki);
  const repoRoot = path.resolve(plugin, '..', '..');
  const call = (...args) => spawnSync(process.execPath, [cli, 'local-key', ...args, '--cwd', repoRoot, '--wiki', wiki], { encoding: 'utf8', env: s.env });
  assert.equal(call('--json').stdout.trim(), JSON.stringify({ key: 'L-1' }));
  assert.equal(call().stdout.trim(), 'L-2');
});
