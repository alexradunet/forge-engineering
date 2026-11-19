// The Forge folder of a repository (Forge 9): the two layouts, the resolver, the move of an older folder, the launcher, and the pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContext } from '../plugins/forge/scripts/lib/hook.mjs';
import { LAUNCHER_SH, compareVersions, readPointer, writeLauncher, writePointer } from '../plugins/forge/scripts/lib/launcher.mjs';
import { archiveDir, homeOf, isForgeLayout, rawDir } from '../plugins/forge/scripts/lib/layout.mjs';
import { resolve } from '../plugins/forge/scripts/lib/repo.mjs';
import { initWiki, move, seed } from '../plugins/forge/scripts/lib/setup.mjs';
import { listTickets } from '../plugins/forge/scripts/lib/tickets.mjs';
import { approve, status } from '../plugins/forge/scripts/lib/trust.mjs';
import { lint as lintWiki } from '../plugins/forge/scripts/lib/validation.mjs';
import { writeViews } from '../plugins/forge/scripts/lib/views.mjs';

const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const plugin = path.dirname(path.dirname(cli));
const templates = path.join(plugin, 'templates', 'config');
const TODAY = '2026-11-19';

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

const README = (key, extra = []) => ['---', 'type: ticket', `key: ${key}`, `title: Title of ${key}`, 'workflow: full-v3', 'phase: plan', 'state: active',
  `next: Next step for ${key}`, 'changes: []', 'people: []', 'gates:', '  - { name: Scoped?, doc: story.md, need: required, status: todo }', ...extra, 'updated: 2026-11-18', '---', `# ${key}`, ''].join('\n');
const PAGE = (title) => `---\ntitle: ${title}\nupdated: 2026-11-10\nstatus: verified\nsources:\n  - investigation on 2026-11-10\n---\n# ${title}\n\nText.\n`;

test('only the wiki folder of a <name>.forge folder has raw and archive next to it', () => {
  const at = (...parts) => path.resolve(path.sep, 'w', ...parts);
  assert.equal(isForgeLayout(at('app.forge', 'wiki')), true);
  assert.equal(isForgeLayout(at('APP.Forge', 'wiki')), true, 'the name has no difference between capital and small letters');
  for (const other of [at('app.wiki'), at('app.forge'), at('app.forge', 'pages'), at('team', 'wiki'), at('app.forge', 'wiki', 'deep')]) assert.equal(isForgeLayout(other), false, other);
  assert.deepEqual([homeOf(at('app.forge', 'wiki')), rawDir(at('app.forge', 'wiki')), archiveDir(at('app.forge', 'wiki'))], [at('app.forge'), at('app.forge', 'raw'), at('app.forge', 'archive')]);
  // An older folder, and a folder that the user gives with --wiki: the Forge folder and the wiki are one folder.
  assert.deepEqual([homeOf(at('app.wiki')), rawDir(at('app.wiki')), archiveDir(at('app.wiki'))], [at('app.wiki'), at('app.wiki', 'raw'), at('app.wiki', 'archive')]);
  assert.equal(rawDir(at('team', 'wiki')), at('team', 'wiki', 'raw'));
});

test('the resolver finds the Forge folder from the repository, a worktree, the wiki, raw, and the launcher variable', (t) => {
  const s = space(t);
  const app = s.repo('app');
  const home = `${app}.forge`;
  const wiki = path.join(home, 'wiki');
  // A new repository gets the Forge folder. An older folder alone is still the wiki.
  assert.deepEqual([resolve({ cwd: app, env: s.env }).wiki.path, resolve({ cwd: app, env: s.env }).wiki.exists], [wiki, false]);
  mkdirSync(`${app}.wiki`);
  const older = resolve({ cwd: app, env: s.env });
  assert.deepEqual([older.wiki.path, older.forge.layout, older.raw], [`${app}.wiki`, 'wiki', path.join(`${app}.wiki`, 'raw')]);

  // A wiki without a binding inside a Forge folder goes back to its repository by the name of the folder.
  mkdirSync(wiki, { recursive: true });
  s.git(wiki, 'init', '-q', '-b', 'main');
  const unbound = resolve({ cwd: wiki, env: s.env });
  assert.deepEqual([unbound.repo.path, unbound.wiki.source], [app, 'legacy-sibling']);
  assert.throws(() => resolve({ cwd: os.tmpdir(), env: { ...s.env, FORGE_HOME: home } }), (error) => error.code === 'not-bound');

  // With both folders, the Forge folder wins, and the user gets a warning.
  const both = resolve({ cwd: app, env: s.env });
  assert.deepEqual([both.wiki.path, both.forge.path, both.forge.layout, both.raw, both.archive], [wiki, home, 'forge', path.join(home, 'raw'), path.join(home, 'archive')]);
  assert.match(both.warnings.join('\n'), /Both .*app\.forge and .*app\.wiki exist\. forge uses .*app\.forge\./);
  rmSync(`${app}.wiki`, { recursive: true });
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

test('move takes an older folder to the Forge folder, changes no file, and keeps the git repository and the trust approvals', (t) => {
  const s = space(t);
  const app = s.repo('app');
  const old = `${app}.wiki`;
  mkdirSync(old);
  initWiki(resolve({ cwd: app, env: s.env }));
  seed(resolve({ cwd: app, env: s.env }), templates);
  s.put(path.join(old, 'tooling', 'build.md'), PAGE('Build'));
  s.put(path.join(old, 'tickets', 'app-1.md'), PAGE('APP-1: First fix'));
  s.put(path.join(old, 'raw', 'tickets', 'app-9', 'README.md'), README('APP-9'));
  // A link with the depth of the old folder, a link with the path from the top of the wiki, and an absolute path to the old folder.
  const story = `---\ntype: story\n---\n# Story APP-9\n\nProblem: see [the build page](../../../tooling/build.md) and tooling/build.md.\n\nFile: ${path.join(old, 'tooling', 'build.md')}\n`;
  s.put(path.join(old, 'raw', 'tickets', 'app-9', 'story.md'), story);
  s.put(path.join(old, 'archive', 'tickets', 'app-1', 'README.md'), README('APP-1'));
  s.git(old, 'add', '-A');
  s.git(old, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'Wiki pages');
  const head = s.git(old, 'rev-parse', 'HEAD');
  const before = resolve({ cwd: app, env: s.env });
  approve(before, status(before, { env: s.env }).files.map((file) => `${file.rel}=${file.sha.slice(0, 12)}`), { env: s.env });
  const states = () => status(resolve({ cwd: app, env: s.env }), { env: s.env }).files.map((file) => [file.rel, file.state]);
  const approved = states();
  assert.ok(approved.length > 3 && approved.every(([, state]) => state === 'ok'), JSON.stringify(approved));

  const home = `${app}.forge`;
  const wiki = path.join(home, 'wiki');
  const plan = move(before, { dryRun: true, pluginDir: plugin });
  assert.deepEqual([plan.moved, plan.from, plan.forge, plan.wiki], [false, old, home, wiki]);
  assert.deepEqual(plan.steps, [`${old} -> ${wiki}`, `${path.join(wiki, 'raw')} -> ${path.join(home, 'raw')}`, `${path.join(wiki, 'archive')} -> ${path.join(home, 'archive')}`]);
  assert.deepEqual(plan.links, ['raw/tickets/app-9/story.md'], 'the files with an absolute path to the old folder');
  assert.ok(existsSync(old) && !existsSync(home), 'a dry run moves nothing');
  assert.throws(() => move(before, { serverRuns: true }), (error) => error.code === 'server-runs');
  assert.ok(existsSync(old));

  const done = move(before, { pluginDir: plugin });
  assert.deepEqual([done.moved, done.created], [true, ['../forge', '../forge.cmd', '../.plugin']]);
  assert.ok(!existsSync(old) && !existsSync(path.join(wiki, 'raw')) && !existsSync(path.join(wiki, 'archive')));
  for (const file of [path.join(wiki, 'tooling', 'build.md'), path.join(home, 'raw', 'tickets', 'app-9', 'README.md'), path.join(home, 'archive', 'tickets', 'app-1', 'README.md'), path.join(home, 'forge')]) assert.ok(existsSync(file), file);
  assert.equal(readFileSync(path.join(home, 'raw', 'tickets', 'app-9', 'story.md'), 'utf8'), story, 'the move changes no ticket document');
  // The wiki is the same git repository, and each approval of a config file is still valid.
  assert.deepEqual([s.git(wiki, 'rev-parse', 'HEAD'), s.git(wiki, 'status', '--porcelain')], [head, '']);
  const after = resolve({ cwd: app, env: s.env });
  assert.deepEqual([after.wiki.path, after.wiki.bound, after.forge.layout, after.warnings], [wiki, true, 'forge', []]);
  assert.deepEqual(states(), approved);

  // The tickets, the lint, and the pages read the new places. The link with the old depth still opens the wiki page.
  assert.deepEqual(listTickets(wiki).map((entry) => [entry.folder, entry.ticket?.key]), [['app-9', 'APP-9']]);
  const lint = lintWiki({ wikiPath: wiki, repoPath: app });
  assert.ok(lint.findings.some((finding) => finding.file.startsWith(path.join(home, 'raw', 'tickets', 'app-9'))), 'lint reads the tickets of the Forge folder');
  assert.ok(!lint.findings.some((finding) => finding.file.includes(`${path.sep}wiki${path.sep}raw`)));
  const views = writeViews(wiki, { today: TODAY });
  assert.deepEqual([views.page.file, views.wiki.file, views.wiki.pages, views.wiki.closed], [path.join(home, 'raw', 'board.html'), path.join(home, 'raw', 'wiki.html'), 5, 1], 'the index, 2 rule pages of the profile, the build page, and the closed ticket');
  const canvas = readFileSync(path.join(home, 'raw', 'tickets', 'app-9', 'canvas.html'), 'utf8');
  assert.match(canvas, /see <a href="\.\.\/\.\.\/wiki\.html#tooling\/build\.md" data-nav>the build page<\/a> and <a href="\.\.\/\.\.\/wiki\.html#tooling\/build\.md" data-nav>tooling\/build\.md<\/a>\./);
  // A new ticket document names the page with its real path.
  s.put(path.join(home, 'raw', 'tickets', 'app-9', 'plan.md'), '---\ntype: plan\n---\n# Plan APP-9\n\nCause: see [build](../../../wiki/tooling/build.md).\n');
  writeViews(wiki, { today: TODAY });
  assert.match(readFileSync(path.join(home, 'raw', 'tickets', 'app-9', 'canvas.html'), 'utf8'), /see <a href="\.\.\/\.\.\/wiki\.html#tooling\/build\.md" data-nav>build<\/a>\./);
  const board = readFileSync(path.join(home, 'raw', 'board.html'), 'utf8');
  assert.match(board, /vscode:\/\/file\/[^"]*app\.forge\/raw\/tickets\/app-9\/README\.md/);
  assert.match(board, /href="wiki\.html#tickets\/app-1\.md"/);

  // A second move has nothing to do, and a move never writes over a folder.
  assert.throws(() => move(after), (error) => error.code === 'no-wiki' && /is the Forge folder already/.test(error.message));
  mkdirSync(old);
  assert.throws(() => move(after), (error) => error.code === 'exists');
  assert.throws(() => move(resolve({ cwd: s.repo('none'), env: s.env })), (error) => error.code === 'no-wiki' && /nothing moves/.test(error.message));
});

test('the move command prints the steps, the files with an old path, and the next steps', (t) => {
  const s = space(t);
  const app = s.repo('app');
  mkdirSync(`${app}.wiki`);
  initWiki(resolve({ cwd: app, env: s.env }));
  s.put(path.join(`${app}.wiki`, 'raw', 'tickets', 'app-9', 'README.md'), README('APP-9'));
  const run = (...args) => spawnSync(process.execPath, [cli, 'move', ...args, '--cwd', app], { encoding: 'utf8', env: s.env });
  const dry = run('--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /^would move:\n {2}.*app\.wiki -> .*app\.forge[\\/]wiki\n {2}.*app\.forge[\\/]wiki[\\/]raw -> .*app\.forge[\\/]raw\n$/);
  assert.ok(existsSync(`${app}.wiki`));
  const real = run();
  assert.equal(real.status, 0, real.stderr);
  assert.match(real.stdout, /^moved:\n/);
  assert.match(real.stdout, /Start each agent session of this repository again/);
  assert.match(real.stdout, /\n {2}open {2}.*app\.forge[\\/]forge(\.cmd)? open\n$/);
  assert.equal(JSON.parse(spawnSync(process.execPath, [cli, 'where', '--cwd', app], { encoding: 'utf8', env: s.env }).stdout).forge.layout, 'forge');
  const again = run();
  assert.equal(again.status, 1);
  assert.match(again.stderr, /is the Forge folder already/);
  assert.match(spawnSync(process.execPath, [cli, 'move', 'extra', '--cwd', app], { encoding: 'utf8', env: s.env }).stderr, /Usage: forge\.mjs move/);
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
  assert.match(launch(s.root, 'canvas', 'A B', '--port', 'x').stderr, /Usage: forge\.mjs canvas/);
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
  // An older folder has no launcher: its Forge folder is the wiki itself.
  const old = s.repo('old');
  mkdirSync(`${old}.wiki`);
  initWiki(resolve({ cwd: old, env: s.env }));
  const older = buildContext({ cwd: old, source: 'startup', prompt: '' }, { cli, env: s.env, host: 'claude' }).body;
  assert.ok(older.includes(`\`<forge>\` is \`${old}.wiki\`. \`<wiki>\` is \`${old}.wiki\`.`));
  assert.ok(!existsSync(path.join(`${old}.wiki`, '.plugin')) && !existsSync(path.join(`${old}.wiki`, 'forge.cmd')));
});
