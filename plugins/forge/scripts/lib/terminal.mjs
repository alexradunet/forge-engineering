// Opens a new tab or window of the terminal of the user, in a folder, with one command: the Resume button of the board uses it.
// Forge has no terminal of its own. Each row of TERMINALS is one terminal program and the arguments that it needs.
// A command is a list of arguments, never one text for a shell: the folder and the session id are data.
// The only row with a command text is Orca, and that text holds only the harness command and a checked session id.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from './data-dir.mjs';

/** A terminal that starts but ends with an error in this time did not open: the next row gets its turn. */
export const START_MS = 700;
export const SETTINGS_FILE = 'settings.json';

// After the harness ends, the tab stays open with a shell in the same folder, so a start that fails shows its message.
const POSIX_KEEP = ['sh', '-c', '"$@"; exec "${SHELL:-sh}"', 'forge'];
const keep = (argv) => [...POSIX_KEEP, ...argv];
// Windows Terminal reads `;` as the end of a command, also inside an argument.
const noSemicolon = (values) => values.every((value) => !String(value).includes(';'));
// A word that no shell reads in a special way.
const PLAIN_WORD = /^[A-Za-z0-9._=:\/-]+$/;

/**
 * `on` are the platforms of a row. `build` gives { command, args }, or null when the row cannot run this command.
 * The folder is also the working folder of the new process, for a terminal that has no folder option.
 */
export const TERMINALS = [
  {
    id: 'wt', on: ['win32'],
    build: ({ cwd, argv, title }) => (noSemicolon([cwd, ...argv]) ? { command: 'wt.exe', args: ['-w', '0', 'new-tab', '-d', cwd, '--title', title, 'cmd.exe', '/k', ...argv] } : null),
  },
  // `start` needs a title as its first quoted value: the empty value is that title. The folder comes from the working folder.
  { id: 'cmd', on: ['win32'], build: ({ argv }) => ({ command: 'cmd.exe', args: ['/c', 'start', '', 'cmd.exe', '/k', ...argv] }) },
  {
    id: 'orca', on: ['linux', 'darwin', 'win32'], when: (env) => env.TERM_PROGRAM === 'Orca',
    // Orca types the command text into a shell, so each word must be plain. Orca opens the tab in a folder that it knows as a worktree.
    build: ({ cwd, argv, title }) => (argv.every((word) => PLAIN_WORD.test(word))
      ? { command: 'orca', args: ['terminal', 'create', '--worktree', `path:${cwd}`, '--title', title, '--command', argv.join(' '), '--focus'] } : null),
  },
  { id: 'env', on: ['linux'], when: (env) => Boolean(env.TERMINAL), build: ({ argv }, env) => ({ command: env.TERMINAL, args: ['-e', ...keep(argv)] }) },
  { id: 'xdg-terminal-exec', on: ['linux'], build: ({ cwd, argv, title }) => ({ command: 'xdg-terminal-exec', args: [`--dir=${cwd}`, `--title=${title}`, '--', ...keep(argv)] }) },
  { id: 'x-terminal-emulator', on: ['linux'], build: ({ argv }) => ({ command: 'x-terminal-emulator', args: ['-e', ...keep(argv)] }) },
  { id: 'ghostty', on: ['linux'], build: ({ cwd, argv }) => ({ command: 'ghostty', args: [`--working-directory=${cwd}`, '-e', ...keep(argv)] }) },
  { id: 'gnome-terminal', on: ['linux'], build: ({ cwd, argv }) => ({ command: 'gnome-terminal', args: [`--working-directory=${cwd}`, '--', ...keep(argv)] }) },
  { id: 'konsole', on: ['linux'], build: ({ cwd, argv }) => ({ command: 'konsole', args: ['--workdir', cwd, '-e', ...keep(argv)] }) },
  { id: 'kitty', on: ['linux'], build: ({ cwd, argv }) => ({ command: 'kitty', args: ['--directory', cwd, ...keep(argv)] }) },
  { id: 'alacritty', on: ['linux'], build: ({ cwd, argv }) => ({ command: 'alacritty', args: ['--working-directory', cwd, '-e', ...keep(argv)] }) },
  { id: 'wezterm', on: ['linux'], build: ({ cwd, argv }) => ({ command: 'wezterm', args: ['start', '--cwd', cwd, '--', ...keep(argv)] }) },
  { id: 'foot', on: ['linux'], build: ({ cwd, argv }) => ({ command: 'foot', args: ['-D', cwd, ...keep(argv)] }) },
];

/** A tab title from a fixed set of characters, so it is never an option or a command for a terminal. */
export function tabTitle(text) {
  const title = String(text ?? '').replace(/[^A-Za-z0-9 ._-]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^-+/, '').slice(0, 40).trim();
  return title || 'forge';
}

/**
 * The id of the terminal that the user wants first, or '': FORGE_TERMINAL, then "terminal" in settings.json of the forge data folder.
 * Only the id of a row counts. A command text is never read from a setting.
 */
export function preferredTerminal(env = process.env) {
  const known = (value) => (TERMINALS.some((row) => row.id === value) ? value : '');
  if (known(env.FORGE_TERMINAL)) return env.FORGE_TERMINAL;
  try { return known(JSON.parse(readFileSync(path.join(dataDir(env), SETTINGS_FILE), 'utf8')).terminal); } catch { return ''; }
}

/**
 * The commands that can open a terminal for `argv` in `cwd`, in the order of the tries: [{ id, command, args }].
 * The row that the user prefers comes first. A row for another platform, or for a program that is not in use here, is left out.
 */
export function terminalCommands({ cwd, argv, title = '' }, { platform = process.platform, env = process.env, prefer = preferredTerminal(env) } = {}) {
  const spec = { cwd, argv, title: tabTitle(title) };
  const rows = TERMINALS.filter((row) => row.on.includes(platform) && (row.id === prefer || !row.when || row.when(env)));
  rows.sort((a, b) => Number(b.id === prefer) - Number(a.id === prefer));
  return rows.map((row) => { const built = row.build(spec, env); return built && { id: row.id, ...built }; }).filter(Boolean);
}

const HARNESS_VARS = /^(FORGE_HOME|CLAUDECODE|CLAUDE_PROJECT_DIR|AI_AGENT|COPILOT_CLI|PLUGIN_ROOT|COPILOT_PLUGIN_ROOT)$|^CLAUDE_CODE_|^CLAUDE_PLUGIN_/;

/**
 * The environment for the new terminal: without the variables that a harness or the Forge launcher sets for its own process.
 * The server can be the child of an agent session, and the new session must not look like a part of that one.
 */
export function cleanEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !HARNESS_VARS.test(name)));
}

function tryStart(row, cwd, { env, spawnFn, waitMs }) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    let child = null;
    // The terminal is a process of its own: after the answer, this process does not wait for it.
    const end = (ok) => { if (!done) { done = true; clearTimeout(timer); child?.unref?.(); resolve(ok); } };
    try {
      child = spawnFn(row.command, row.args, { cwd, env, detached: true, stdio: 'ignore', windowsHide: false });
      child.once('error', () => end(false));
      // A launcher that ends at once without an error did its work.
      child.once('exit', (code) => end(code === 0));
      child.once('spawn', () => { timer = setTimeout(() => end(true), waitMs); });
    } catch { end(false); }
  });
}

/**
 * Opens a terminal with `argv` in `cwd`. Gives { ok: true, how: <row id> }, or { ok: false } when no row of this machine starts.
 * Then the caller gives the user the command to copy.
 */
export async function openTerminal(spec, { platform = process.platform, env = process.env, spawnFn = spawn, waitMs = START_MS, prefer } = {}) {
  const rows = terminalCommands(spec, { platform, env, ...(prefer === undefined ? {} : { prefer }) });
  const childEnv = cleanEnv(env);
  for (const row of rows) {
    if (await tryStart(row, spec.cwd, { env: childEnv, spawnFn, waitMs })) return { ok: true, how: row.id };
  }
  return { ok: false };
}
