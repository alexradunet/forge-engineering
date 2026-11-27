// The Forge folder of a repository (Forge 9): the layout, the layout and the resolver.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContext } from '../plugins/forge/scripts/lib/hook.mjs';
import { archiveDir, homeOf, isForgeLayout, rawDir, repoNameOf, siblingWikis } from '../plugins/forge/scripts/lib/layout.mjs';
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
  initWiki(resolve({ cwd: app, env: s.env }));

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

test('the session context names the Forge folder', (t) => {
  const s = space(t);
  const app = s.repo('app');
  initWiki(resolve({ cwd: app, env: s.env }));
  const home = `${app}.forge`;
  const { body } = buildContext({ cwd: app, source: 'startup', prompt: '' }, { cli, env: s.env, host: 'claude' });
  const line = body.split('\n').find((text) => text.startsWith('`<plugin>`'));
  assert.equal(line, `\`<plugin>\` is \`${plugin}\`. \`<repo>\` is \`${app}\`. \`<forge>\` is \`${home}\`. \`<wiki>\` is \`${path.join(home, 'wiki')}\`. \`<config>\` is \`${path.join(home, 'wiki', 'forge', 'config')}\`.`);
  assert.ok(!existsSync(path.join(home, 'forge')) && !existsSync(path.join(home, '.plugin')), 'the session start writes no launcher');
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

test('siblingWikis: the bound Forge folders next to this one, this one first, and a folder from --wiki alone', (t) => {
  const s = space(t);
  const bind = (name) => { s.put(path.join(s.root, `${name}.forge`, 'wiki', 'forge', 'repo.json'), '{"repo":{"path":"x"}}'); return path.join(s.root, `${name}.forge`, 'wiki'); };
  const [b, a, mine] = [bind('b'), bind('a'), bind('mine')];
  mkdirSync(path.join(s.root, 'tool.forge', 'wiki'), { recursive: true }); // a code repository with a wiki/ and no binding
  mkdirSync(path.join(s.root, 'plain'), { recursive: true });
  assert.deepEqual(siblingWikis(mine), [mine, a, b]);
  assert.deepEqual(siblingWikis(b), [b, a, mine]);
  assert.deepEqual(siblingWikis(path.join(s.root, 'plain')), [path.join(s.root, 'plain')]);
  assert.deepEqual([repoNameOf(mine), repoNameOf(path.join(s.root, 'plain'))], ['mine', 'plain']);
});
