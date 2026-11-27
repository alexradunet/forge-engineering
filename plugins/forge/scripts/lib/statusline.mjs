// The Claude Code status line of Forge: one line with the ticket of the folder and the 🟡 tickets of all repositories.
// `forge.mjs statusline` reads the status line JSON on stdin and writes nothing. `statusline --install` writes the shim
// <data>/statusline.mjs (a stable path in the plugin data folder) and the `statusLine` key of the user settings.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildBoard } from './board.mjs';
import { FORGE_SUFFIX, WIKI_NAME, repoNameOf, siblingWikis } from './layout.mjs';
import { samePath } from './repo.mjs';
import { STATE_EMOJI } from './ticket.mjs';

const ROOT_MARK = '// forge-root: ';
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The ticket of a folder: the README worktree, else a key in the folder name. */
function ticketOfPath(tickets, top) {
  const byWorktree = tickets.find((ticket) => ticket.worktree && samePath(ticket.worktree, top));
  if (byWorktree) return byWorktree;
  const name = path.basename(top);
  const hits = tickets.filter((ticket) => ticket.key && new RegExp(`(^|[^a-z0-9])${escapeRegExp(ticket.key)}($|[^a-z0-9])`, 'i').test(name));
  return hits.sort((a, b) => b.key.length - a.key.length)[0] ?? null;
}

/**
 * The status line text for the JSON that Claude Code sends on stdin, or ''. It makes one git call and writes nothing.
 * `<KEY> <emoji> <open gate or phase>` for the ticket of the folder (not in the main checkout), then ` · 🟡 <n> (<repo> <n>, ...)`
 * for the needs-me tickets of all repositories, except the ticket of the folder.
 */
export function statusLine(raw, { cwd = process.cwd() } = {}) {
  let input = {};
  try { input = JSON.parse(raw) ?? {}; } catch { return ''; }
  const dir = String(input.workspace?.current_dir || input.cwd || cwd);
  const git = spawnSync('git', ['rev-parse', '--show-toplevel', '--path-format=absolute', '--git-common-dir'], { cwd: dir, encoding: 'utf8', timeout: 2000, windowsHide: true });
  if (git.status !== 0) return '';
  const [top, common] = git.stdout.split(/\r?\n/).map((line) => line.trim());
  if (!top || !common) return '';
  const main = path.basename(common) === '.git' ? path.dirname(common) : top;
  const wiki = path.join(path.dirname(main), `${path.basename(main)}${FORGE_SUFFIX}`, WIKI_NAME);
  if (!existsSync(path.join(wiki, 'forge', 'repo.json'))) return '';
  const boards = siblingWikis(wiki).map((file) => {
    try { return { repo: repoNameOf(file), tickets: buildBoard(file).groups.flatMap((group) => group.tickets) }; } catch { return { repo: repoNameOf(file), tickets: [] }; }
  });
  const own = samePath(main, top) ? null : ticketOfPath(boards[0].tickets, top);
  const counts = boards
    .map((row) => ({ repo: row.repo, count: row.tickets.filter((ticket) => ticket.state === 'needs-me' && ticket !== own).length }))
    .filter((row) => row.count > 0);
  const total = counts.reduce((sum, row) => sum + row.count, 0);
  const head = own ? `${own.key} ${STATE_EMOJI[own.state] ?? '❔'} ${own.state === 'needs-me' && own.openGate ? own.openGate.name : own.phase}` : '';
  const tail = total ? `🟡 ${total} (${counts.map((row) => `${row.repo} ${row.count}`).join(', ')})` : '';
  return [head, tail].filter(Boolean).join(' · ');
}

/** The text of the shim: it runs the statusline command of the forge.mjs of `root`. */
export function shimText(root) {
  const cli = pathToFileURL(path.join(root, 'scripts', 'forge.mjs')).href;
  return `// The Forge status line. forge.mjs statusline --install and the Claude Code session start hook write this file.\n${ROOT_MARK}${root}\nimport { main } from ${JSON.stringify(cli)};\nPromise.resolve(main(['statusline'])).then((code) => { process.exitCode = code; });\n`;
}

function writeAtomic(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  // A link keeps its link: the temp file is written next to the target, and the target keeps its mode.
  let target = file;
  try { target = realpathSync(file); } catch { /* A new file. */ }
  const temp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, text);
    try { chmodSync(temp, statSync(target).mode & 0o7777); } catch { /* A new file: the default mode. */ }
    renameSync(temp, target);
  } catch (error) { rmSync(temp, { force: true }); throw error; }
}

/** Rewrites an existing shim that names another plugin root. It never creates the shim. Returns true when it wrote. */
export function refreshShim(data, root) {
  if (!data) return false;
  const file = path.join(data, 'statusline.mjs');
  let old = '';
  try { old = readFileSync(file, 'utf8'); } catch { return false; }
  const text = shimText(root);
  if (old === text) return false;
  writeAtomic(file, text);
  return true;
}

/** The settings file of Claude Code: $CLAUDE_CONFIG_DIR/settings.json, else ~/.claude/settings.json. */
export const settingsFile = (env = process.env) => path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');

const readSettings = (file) => {
  if (!existsSync(file)) return { exists: false, data: {}, indent: 2 };
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not a JSON object');
  const lead = /^([ \t]+)\S/m.exec(text)?.[1];
  return { exists: true, data, indent: lead ? (lead.includes('\t') ? '\t' : lead.length) : 2 };
};

/**
 * Writes the shim and adds the statusLine key to the settings, only when the settings have none.
 * Returns { status: 'installed' | 'already-set', settings, shim, root }. It throws when the settings do not parse, and then it writes nothing.
 */
export function installStatusline({ data, settings, env = process.env, root }) {
  if (!data) throw new Error('--data <folder> is required: the plugin data folder (${CLAUDE_PLUGIN_DATA} in the skill text).');
  const file = settings || settingsFile(env);
  let current;
  try { current = readSettings(file); } catch (error) { throw new Error(`${file} cannot be read as JSON (${error.message}). Nothing was changed.`); }
  if (Object.hasOwn(current.data, 'statusLine')) return { status: 'already-set', settings: file, shim: path.join(path.resolve(data), 'statusline.mjs'), root };
  const shim = path.join(path.resolve(data), 'statusline.mjs');
  writeAtomic(shim, shimText(root));
  const command = `node "${shim.replace(/\\/g, '/')}"`;
  writeAtomic(file, `${JSON.stringify({ ...current.data, statusLine: { type: 'command', command } }, null, current.indent)}\n`);
  return { status: 'installed', settings: file, shim, root };
}

/** The doctor line `statusline`: { status, detail }. It follows the settings, the shim, and the plugin root of the shim. */
export function statuslineCheck(env = process.env, { gitVersion = () => spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 2000, windowsHide: true }).stdout } = {}) {
  const file = settingsFile(env);
  let current;
  try { current = readSettings(file); } catch (error) { return { status: 'warn', detail: `${file} cannot be read as JSON (${error.message}).` }; }
  const value = current.data.statusLine;
  if (!value) return { status: 'ok', detail: `statusLine is not set in ${file}. Say "set up forge" to add the Forge status line (Claude Code).` };
  const key = `Delete the "statusLine" key in ${file}, then run: forge.mjs statusline --install --data "<plugin data folder>".`;
  const hit = /statusline\.mjs/.test(String(value.command ?? '')) ? /"([^"]*statusline\.mjs)"/.exec(String(value.command)) : null;
  if (!hit) return { status: 'ok', detail: `statusLine in ${file} is not the Forge shim, not checked.` };
  const shim = hit[1];
  if (!existsSync(shim)) return { status: 'warn', detail: `The shim ${shim} is missing (an uninstall deletes the plugin data folder). ${key}` };
  const root = readFileSync(shim, 'utf8').split(/\r?\n/).find((line) => line.startsWith(ROOT_MARK))?.slice(ROOT_MARK.length);
  if (!root || !existsSync(path.join(root, 'scripts', 'forge.mjs'))) return { status: 'warn', detail: `The shim ${shim} names a plugin folder that is gone (${root ?? 'unknown'}). Start a Claude Code session of the installed plugin, or run the install again.` };
  const warns = [];
  if (path.basename(path.dirname(shim)).endsWith('-inline')) warns.push(`The shim ${shim} is in the data folder of a --plugin-dir session. The installed plugin hook does not refresh it. Install the status line from a normal session.`);
  let version = null;
  try { version = /(\d+)\.(\d+)/.exec(String(gitVersion() ?? '')); } catch { /* Git is checked by tool:git. */ }
  if (version && (Number(version[1]) < 2 || (Number(version[1]) === 2 && Number(version[2]) < 31))) warns.push(`Git ${version[1]}.${version[2]} is older than 2.31: the status line uses git rev-parse --path-format=absolute and stays empty. Update Git.`);
  if (warns.length) return { status: 'warn', detail: warns.join(' ') };
  return { status: 'ok', detail: `${shim} runs ${root}` };
}
