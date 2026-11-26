// The terminal of the user for a Resume: the command of each terminal program, the order of the tries, and the start.
// No test starts a real terminal: the start function gets its own spawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resumeArgv } from '../plugins/forge/scripts/lib/harness.mjs';
import { TERMINALS, cleanEnv, openTerminal, preferredTerminal, tabTitle, terminalCommands } from '../plugins/forge/scripts/lib/terminal.mjs';

const ID = '11111111-2222-4333-8444-555555555555';
const argv = resumeArgv('claude', ID);
const KEEP = ['sh', '-c', '"$@"; exec "${SHELL:-sh}"', 'forge', 'claude', '--resume', ID];
const ids = (spec, options) => terminalCommands(spec, { prefer: '', ...options }).map((row) => row.id);

test('Windows: a tab of Windows Terminal first, then a console window, and each keeps its window after the harness ends', () => {
  const rows = terminalCommands({ cwd: 'C:\\code\\my app', argv, title: 'APP-9 Claude Code' }, { platform: 'win32', env: {}, prefer: '' });
  assert.deepEqual(rows, [
    { id: 'wt', command: 'wt.exe', args: ['-w', '0', 'new-tab', '-d', 'C:\\code\\my app', '--title', 'APP-9 Claude Code', 'cmd.exe', '/k', 'claude', '--resume', ID] },
    // The npm command of a harness is a .cmd file, so cmd.exe runs it. The empty value is the window title that `start` needs.
    { id: 'cmd', command: 'cmd.exe', args: ['/c', 'start', '', 'cmd.exe', '/k', 'claude', '--resume', ID] },
  ]);
  // Windows Terminal reads `;` as the end of a command: such a folder gets only the console window.
  assert.deepEqual(ids({ cwd: 'C:\\code\\a;calc', argv }, { platform: 'win32', env: {} }), ['cmd']);
  assert.deepEqual(ids({ cwd: 'C:\\code\\app', argv }, { platform: 'win32', env: { TERM_PROGRAM: 'Orca' } }), ['wt', 'cmd', 'orca']);
});

test('Linux: the terminal that the user set, then the system default, then the known terminals, with the command as arguments', () => {
  const spec = { cwd: '/code/my app', argv, title: 'APP-9 Claude Code' };
  const rows = terminalCommands(spec, { platform: 'linux', env: {}, prefer: '' });
  assert.deepEqual(rows.map((row) => row.id), ['xdg-terminal-exec', 'x-terminal-emulator', 'ghostty', 'gnome-terminal', 'konsole', 'kitty', 'alacritty', 'wezterm', 'foot']);
  const row = (id) => rows.find((item) => item.id === id);
  assert.deepEqual(row('xdg-terminal-exec'), { id: 'xdg-terminal-exec', command: 'xdg-terminal-exec', args: ['--dir=/code/my app', '--title=APP-9 Claude Code', '--', ...KEEP] });
  assert.deepEqual(row('ghostty').args, ['--working-directory=/code/my app', '-e', ...KEEP]);
  assert.deepEqual(row('gnome-terminal').args, ['--working-directory=/code/my app', '--', ...KEEP]);
  assert.deepEqual(row('konsole').args, ['--workdir', '/code/my app', '-e', ...KEEP]);
  assert.deepEqual(row('kitty').args, ['--directory', '/code/my app', ...KEEP]);
  assert.deepEqual(row('wezterm').args, ['start', '--cwd', '/code/my app', '--', ...KEEP]);
  // No value of the session is in the text that the shell reads: the shell gets the command as its arguments.
  for (const item of rows) assert.ok(item.args.includes('"$@"; exec "${SHELL:-sh}"') && !item.args.some((arg) => /^sh -c|claude --resume/.test(arg)), item.id);

  // Orca and $TERMINAL count only when the server runs in them.
  assert.deepEqual(ids(spec, { platform: 'linux', env: { TERM_PROGRAM: 'Orca', TERMINAL: 'footclient' } }).slice(0, 3), ['orca', 'env', 'xdg-terminal-exec']);
  const orca = terminalCommands(spec, { platform: 'linux', env: { TERM_PROGRAM: 'Orca' }, prefer: '' })[0];
  assert.deepEqual(orca, { id: 'orca', command: 'orca', args: ['terminal', 'create', '--worktree', 'path:/code/my app', '--title', 'APP-9 Claude Code', '--command', `claude --resume ${ID}`, '--focus'] });
  assert.deepEqual(terminalCommands(spec, { platform: 'linux', env: { TERMINAL: 'footclient' }, prefer: '' })[0], { id: 'env', command: 'footclient', args: ['-e', ...KEEP] });
  // Orca types its command text into a shell: a word that a shell reads gives no Orca row.
  assert.ok(!ids({ cwd: '/code/app', argv: ['claude', '--resume', 'a;b'] }, { platform: 'linux', env: { TERM_PROGRAM: 'Orca' } }).includes('orca'));
  assert.deepEqual(ids(spec, { platform: 'darwin', env: {} }), [], 'macOS has no row yet: the user gets the command to copy');
});

test('the user can name the terminal to try first, and only the id of a row counts', (t) => {
  const data = mkdtempSync(path.join(os.tmpdir(), 'forge-terminal-'));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const env = { FORGE_DATA_DIR: data };
  assert.equal(preferredTerminal(env), '');
  mkdirSync(data, { recursive: true });
  writeFileSync(path.join(data, 'settings.json'), '{"terminal":"kitty"}');
  assert.equal(preferredTerminal(env), 'kitty');
  assert.equal(preferredTerminal({ ...env, FORGE_TERMINAL: 'ghostty' }), 'ghostty', 'the variable wins');
  assert.equal(preferredTerminal({ ...env, FORGE_TERMINAL: 'xterm -e sh' }), 'kitty', 'a command text is not an id');
  writeFileSync(path.join(data, 'settings.json'), '{"terminal":"rm -rf /"}');
  assert.equal(preferredTerminal(env), '');
  writeFileSync(path.join(data, 'settings.json'), '{not json');
  assert.equal(preferredTerminal(env), '');
  const spec = { cwd: '/code/app', argv };
  assert.deepEqual(ids(spec, { platform: 'linux', env: {}, prefer: 'kitty' }).slice(0, 2), ['kitty', 'xdg-terminal-exec']);
  assert.equal(ids(spec, { platform: 'linux', env: {}, prefer: 'orca' })[0], 'orca', 'a named row is tried also outside of its program');
  assert.equal(ids(spec, { platform: 'linux', env: {}, prefer: 'wt' })[0], 'xdg-terminal-exec', 'a row of another platform stays out');
  assert.equal(terminalCommands(spec, { platform: 'linux', env: { ...env, FORGE_TERMINAL: 'foot' } })[0].id, 'foot', 'without prefer, the setting of the user counts');
  assert.equal(new Set(TERMINALS.map((row) => row.id)).size, TERMINALS.length);
});

test('a tab title has plain characters only, and the new terminal does not get the variables of a harness', () => {
  assert.equal(tabTitle('APP-9 Claude Code'), 'APP-9 Claude Code');
  assert.equal(tabTitle('--title; calc.exe & "x" ▶️'), 'title calc.exe x');
  assert.equal(tabTitle(''), 'forge');
  assert.equal(tabTitle('x'.repeat(100)).length, 40);
  const env = {
    PATH: '/bin', HOME: '/home/u', TERM_PROGRAM: 'Orca', CLAUDE_CONFIG_DIR: '/home/u/.claude2', ANTHROPIC_MODEL: 'x',
    FORGE_HOME: '/code/app.forge', FORGE_TERMINAL: 'kitty', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PLUGIN_ROOT: '/p', CLAUDE_PROJECT_DIR: '/code/app',
    AI_AGENT: 'other_agent_tool', COPILOT_CLI: '1', PLUGIN_ROOT: '/p', COPILOT_PLUGIN_ROOT: '/p',
  };
  assert.deepEqual(cleanEnv(env), { PATH: '/bin', HOME: '/home/u', TERM_PROGRAM: 'Orca', CLAUDE_CONFIG_DIR: '/home/u/.claude2', ANTHROPIC_MODEL: 'x', FORGE_TERMINAL: 'kitty' });
});

// A spawn that starts no process. `plan` gives the result of each command: 'missing', a number (the exit code), or 'runs'.
function fakeSpawn(plan, calls) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.unref = () => { child.unrefs = (child.unrefs ?? 0) + 1; };
    const result = plan[command] ?? 'missing';
    setImmediate(() => {
      if (result === 'missing') { child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })); return; }
      child.emit('spawn');
      if (typeof result === 'number') setImmediate(() => child.emit('exit', result));
    });
    return child;
  };
}

test('openTerminal tries each command until one starts, and says when none does', async () => {
  const spec = { cwd: '/code/app', argv, title: 'APP-9' };
  const env = { PATH: '/bin', CLAUDECODE: '1', FORGE_HOME: '/code/app.forge' };
  let calls = [];
  // xdg-terminal-exec is not on the machine, x-terminal-emulator ends with an error, and ghostty runs.
  const opened = await openTerminal(spec, { platform: 'linux', env, prefer: '', waitMs: 20, spawnFn: fakeSpawn({ 'x-terminal-emulator': 1, ghostty: 'runs' }, calls) });
  assert.deepEqual(opened, { ok: true, how: 'ghostty' });
  assert.deepEqual(calls.map((call) => call.command), ['xdg-terminal-exec', 'x-terminal-emulator', 'ghostty']);
  for (const call of calls) {
    assert.deepEqual([call.options.cwd, call.options.detached, call.options.stdio, call.options.shell], ['/code/app', true, 'ignore', undefined], 'the folder is the working folder, and no shell reads the command');
    assert.deepEqual(call.options.env, { PATH: '/bin' });
  }
  // A launcher that ends at once without an error did its work (Windows Terminal, Orca).
  calls = [];
  assert.deepEqual(await openTerminal(spec, { platform: 'win32', env, prefer: '', waitMs: 20, spawnFn: fakeSpawn({ 'wt.exe': 0 }, calls) }), { ok: true, how: 'wt' });
  assert.equal(calls.length, 1);
  calls = [];
  assert.deepEqual(await openTerminal(spec, { platform: 'win32', env, prefer: '', waitMs: 20, spawnFn: fakeSpawn({ 'cmd.exe': 'runs' }, calls) }), { ok: true, how: 'cmd' });
  assert.deepEqual(calls.map((call) => call.command), ['wt.exe', 'cmd.exe']);
  calls = [];
  assert.deepEqual(await openTerminal(spec, { platform: 'linux', env, prefer: '', waitMs: 20, spawnFn: fakeSpawn({}, calls) }), { ok: false });
  assert.equal(calls.length, 9);
  assert.deepEqual(await openTerminal(spec, { platform: 'darwin', env, prefer: '', waitMs: 20, spawnFn: fakeSpawn({}, []) }), { ok: false });
  const throws = () => { throw new Error('no spawn'); };
  assert.deepEqual(await openTerminal(spec, { platform: 'win32', env, prefer: '', waitMs: 20, spawnFn: throws }), { ok: false });
});
