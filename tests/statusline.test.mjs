// The Forge status line: the text, the install of the shim and the settings key, and the doctor check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installStatusline, refreshShim, shimText, statusLine, statuslineCheck } from '../plugins/forge/scripts/lib/statusline.mjs';

const cli = fileURLToPath(new URL('../plugins/forge/scripts/forge.mjs', import.meta.url));
const pluginDir = path.dirname(path.dirname(cli));

function space(t) {
  const root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'forge-sline-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], { cwd, encoding: 'utf8' }).trim();
  const forge = (name) => {
    const home = path.join(root, `${name}.forge`);
    put(path.join(home, 'wiki', 'forge', 'repo.json'), JSON.stringify({ repo: { path: path.join(root, name) } }));
    const ticket = (key, { state = 'needs-me', phase = 'plan', worktree = '', gate = 'in-review' } = {}) => put(path.join(home, 'raw', 'tickets', key.toLowerCase(), 'README.md'), [
      '---', 'type: ticket', `key: ${key}`, `title: Title of ${key}`, 'workflow: full-v4', `phase: ${phase}`, `state: ${state}`, `next: Next of ${key}`, 'waiting_on: ""',
      `worktree: "${worktree.replaceAll('\\', '/')}"`, 'changes: []', 'people: []', 'gates:',
      `  - { name: Planned?, doc: plan.md, need: required, status: ${gate} }`, 'updated: 2026-10-01', '---', `# ${key}`, '',
    ].join('\n'));
    return { home, ticket };
  };
  const app = path.join(root, 'app');
  mkdirSync(app);
  git(app, 'init', '-q', '-b', 'main');
  git(app, 'commit', '-q', '--allow-empty', '-m', 'first');
  const tree = (name) => { const dir = path.join(root, 'app.worktrees', name); git(app, 'worktree', 'add', '-q', '-b', `users/t/${name}`, dir); return dir; };
  return { root, put, git, forge, app, tree };
}

const run = (dir) => statusLine(JSON.stringify({ workspace: { current_dir: dir } }));

test('a worktree folder shows the key, the state, and the open gate; other 🟡 tickets of all repositories are counted', (t) => {
  const s = space(t);
  const dir = s.tree('L-4-board');
  const app = s.forge('app');
  const other = s.forge('other');
  app.ticket('L-4', { worktree: dir });
  other.ticket('O-1');
  assert.equal(run(dir), 'L-4 🟡 Planned? · 🟡 1 (other 1)', 'the ticket of the folder is not counted');
  app.ticket('L-5');
  assert.equal(run(dir), 'L-4 🟡 Planned? · 🟡 2 (app 1, other 1)', 'a second 🟡 ticket of the same repository is counted');
  app.ticket('L-4', { worktree: dir, state: 'active', phase: 'implement', gate: 'skipped' });
  assert.equal(run(dir), 'L-4 ▶️ implement · 🟡 2 (app 1, other 1)');
});

test('the ticket is found by a key in the folder name when the README has no worktree; the main checkout shows no ticket', (t) => {
  const s = space(t);
  const dir = s.tree('L-4-board');
  const app = s.forge('app');
  app.ticket('L-4', { state: 'active', phase: 'implement', gate: 'skipped' });
  app.ticket('L-40', { state: 'active', phase: 'plan', gate: 'skipped' });
  assert.equal(run(dir), 'L-4 ▶️ implement');
  assert.equal(run(s.app), '', 'the main checkout: no ticket, and no 🟡 ticket');
  app.ticket('L-9');
  assert.equal(run(s.app), '🟡 1 (app 1)');
});

test('a folder with no Forge folder, no git repository, or bad input gives an empty line', (t) => {
  const s = space(t);
  const dir = s.tree('L-4-board');
  assert.equal(run(dir), '', 'no Forge folder');
  assert.equal(run(path.join(s.root, 'missing')), '');
  assert.equal(statusLine('not json'), '');
  assert.equal(statusLine('{}', { cwd: path.join(s.root, 'missing') }), '');
  assert.equal(statusLine(JSON.stringify({ cwd: dir }), { cwd: os.tmpdir() }), '', 'the cwd field of the JSON is used without a workspace');
  const result = spawnSync(process.execPath, [cli, 'statusline'], { input: 'not json', encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '\n');
  const real = spawnSync(process.execPath, [cli, 'statusline'], { input: JSON.stringify({ cwd: dir }), encoding: 'utf8' });
  assert.equal(real.status, 0);
  assert.equal(real.stdout, '\n');
});

test('the status line writes nothing', (t) => {
  const s = space(t);
  const dir = s.tree('L-4-board');
  s.forge('app').ticket('L-4', { worktree: dir });
  const before = s.git(s.app, 'status', '--porcelain');
  const result = spawnSync(process.execPath, [cli, 'statusline'], { input: JSON.stringify({ workspace: { current_dir: dir } }), encoding: 'utf8' });
  assert.equal(result.stdout, 'L-4 🟡 Planned?\n');
  assert.equal(existsSync(path.join(s.root, 'app.forge', 'raw', 'board.md')), false);
  assert.equal(s.git(s.app, 'status', '--porcelain'), before);
});

test('install keeps the other keys, writes the shim, and a second install changes nothing', (t) => {
  const s = space(t);
  const data = path.join(s.root, 'plugin data', 'forge');
  const settings = path.join(s.root, 'claude', 'settings.json');
  s.put(settings, JSON.stringify({ theme: 'dark', permissions: { allow: ['Bash(ls)'] } }, null, 2));
  const call = () => spawnSync(process.execPath, [cli, 'statusline', '--install', '--data', data, '--settings', settings], { encoding: 'utf8' });
  const first = call();
  assert.equal(first.status, 0, first.stderr);
  const saved = JSON.parse(readFileSync(settings, 'utf8'));
  assert.deepEqual(saved.permissions, { allow: ['Bash(ls)'] });
  assert.equal(saved.theme, 'dark');
  assert.deepEqual(saved.statusLine, { type: 'command', command: `node "${path.join(data, 'statusline.mjs').replace(/\\/g, '/')}"` });
  const shim = readFileSync(path.join(data, 'statusline.mjs'), 'utf8');
  assert.equal(shim, shimText(pluginDir));
  assert.match(shim, /forge\.mjs"/);
  const before = readFileSync(settings);
  const second = call();
  assert.equal(second.status, 0);
  assert.match(second.stdout, /already set/);
  assert.ok(readFileSync(settings).equals(before), 'the settings stay the same byte for byte');
  // The shim runs the status line of the plugin root.
  const dir = s.tree('L-4-board');
  s.forge('app').ticket('L-4', { worktree: dir });
  const shown = spawnSync(process.execPath, [path.join(data, 'statusline.mjs')], { input: JSON.stringify({ cwd: dir }), encoding: 'utf8' });
  assert.equal(shown.stdout, 'L-4 🟡 Planned?\n', shown.stderr);
});

test('install into a missing settings file creates it; a file with a statusLine stays the same; a bad file stays the same and is an error', (t) => {
  const s = space(t);
  const data = path.join(s.root, 'data');
  const fresh = path.join(s.root, 'new', 'settings.json');
  assert.equal(installStatusline({ data, settings: fresh, root: pluginDir }).status, 'installed');
  assert.ok(JSON.parse(readFileSync(fresh, 'utf8')).statusLine.command.includes('statusline.mjs'));
  const own = path.join(s.root, 'own.json');
  const ownText = '{ "statusLine": {"type":"command","command":"echo hi"},\n  "a": 1 }\n';
  s.put(own, ownText);
  const kept = path.join(s.root, 'data-kept');
  assert.equal(installStatusline({ data: kept, settings: own, root: pluginDir }).status, 'already-set');
  assert.equal(readFileSync(own, 'utf8'), ownText);
  assert.equal(existsSync(kept), false, 'already set: no shim is written');
  const bad = path.join(s.root, 'bad.json');
  s.put(bad, '{ "a": ');
  const call = spawnSync(process.execPath, [cli, 'statusline', '--install', '--data', path.join(s.root, 'data-bad'), '--settings', bad], { encoding: 'utf8' });
  assert.notEqual(call.status, 0);
  assert.match(call.stderr, /Nothing was changed/);
  assert.equal(readFileSync(bad, 'utf8'), '{ "a": ');
  assert.equal(existsSync(path.join(s.root, 'data-bad')), false);
  assert.notEqual(spawnSync(process.execPath, [cli, 'statusline', '--install'], { encoding: 'utf8' }).status, 0, '--data is required');
});

test('the install reads the default settings file from CLAUDE_CONFIG_DIR', (t) => {
  const s = space(t);
  const config = path.join(s.root, 'cfg');
  const result = installStatusline({ data: path.join(s.root, 'data'), env: { CLAUDE_CONFIG_DIR: config }, root: pluginDir });
  assert.equal(result.settings, path.join(config, 'settings.json'));
  assert.ok(existsSync(result.settings));
});

test('refreshShim rewrites a shim that names another root, and never creates one', (t) => {
  const s = space(t);
  const data = path.join(s.root, 'data');
  assert.equal(refreshShim(data, pluginDir), false);
  assert.equal(existsSync(data), false);
  assert.equal(refreshShim('', pluginDir), false);
  s.put(path.join(data, 'statusline.mjs'), shimText(path.join(s.root, 'old')));
  assert.equal(refreshShim(data, pluginDir), true);
  assert.equal(readFileSync(path.join(data, 'statusline.mjs'), 'utf8'), shimText(pluginDir));
  assert.equal(refreshShim(data, pluginDir), false);
});

test('the doctor check follows the settings, the shim, and the root of the shim', (t) => {
  const s = space(t);
  const config = path.join(s.root, 'cfg');
  const env = { CLAUDE_CONFIG_DIR: config };
  const data = path.join(s.root, 'data');
  const file = path.join(config, 'settings.json');
  assert.match(statuslineCheck(env).detail, /statusLine is not set/);
  assert.equal(statuslineCheck(env).status, 'ok');
  s.put(file, '{ "statusLine": { "type": "command", "command": "echo hi" } }');
  assert.match(statuslineCheck(env).detail, /not the Forge shim/);
  installStatusline({ data, settings: file, root: pluginDir });
  rmSync(file);
  installStatusline({ data, settings: file, root: pluginDir });
  assert.equal(statuslineCheck(env).status, 'ok');
  rmSync(path.join(data, 'statusline.mjs'));
  const missing = statuslineCheck(env);
  assert.equal(missing.status, 'warn');
  assert.match(missing.detail, /shim .* is missing/);
  assert.ok(missing.detail.includes(`"statusLine" key in ${file}`), 'it names the key to delete');
  s.put(path.join(data, 'statusline.mjs'), shimText(path.join(s.root, 'gone')));
  assert.match(statuslineCheck(env).detail, /names a plugin folder that is gone/);
  s.put(file, '{ "a": ');
  assert.equal(statuslineCheck(env).status, 'warn');
});
