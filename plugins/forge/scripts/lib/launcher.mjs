// The launcher of a Forge folder: the files forge and forge.cmd in ../<repo>.forge, and the file .plugin with the path of the plugin.
// A person runs "../<repo>.forge/forge open" in a terminal. The path of the installed plugin changes at each plugin update,
// so the launcher reads it from .plugin: setup and the sessionStart hook keep that file current.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const POINTER_FILE = '.plugin';
export const LAUNCHER_FILES = ['forge', 'forge.cmd'];

const MISSING = ['forge: the path of the forge plugin is not known, or the plugin moved.',
  'Start one agent session in the repository (its start hook writes the path), or run the forge-setup skill.'];

/** The launcher for sh. It gives the Forge folder to forge.mjs in FORGE_HOME, so the command works from each folder. */
export const LAUNCHER_SH = [
  '#!/bin/sh',
  '# The Forge launcher of this repository. "forge.mjs init" writes this file: do not edit it.',
  '# It runs forge.mjs of the plugin that the file .plugin names, for the Forge folder of this file.',
  'here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P) || exit 1',
  'plugin=',
  '[ -r "$here/.plugin" ] && IFS= read -r plugin < "$here/.plugin"',
  'if [ -z "$plugin" ] || [ ! -f "$plugin/scripts/forge.mjs" ]; then',
  ...MISSING.map((line) => `  echo "${line}" >&2`),
  '  exit 1',
  'fi',
  'FORGE_HOME="$here" exec node "$plugin/scripts/forge.mjs" "$@"',
  '',
].join('\n');

/** The same launcher for the Windows command line. */
export const LAUNCHER_CMD = [
  '@echo off',
  'rem The Forge launcher of this repository. "forge.mjs init" writes this file: do not edit it.',
  'setlocal',
  'set "FORGE_HOME=%~dp0"',
  'if "%FORGE_HOME:~-1%"=="\\" set "FORGE_HOME=%FORGE_HOME:~0,-1%"',
  'set "PLUGIN="',
  'if exist "%FORGE_HOME%\\.plugin" set /p PLUGIN=<"%FORGE_HOME%\\.plugin"',
  'if not defined PLUGIN goto missing',
  'if not exist "%PLUGIN%\\scripts\\forge.mjs" goto missing',
  'node "%PLUGIN%\\scripts\\forge.mjs" %*',
  'exit /b %ERRORLEVEL%',
  ':missing',
  ...MISSING.map((line) => `echo ${line.replace(/[()]/g, '^$&')} 1>&2`),
  'exit /b 1',
  '',
].join('\r\n');

/** Writes the launcher files into a Forge folder when they are not there or not the same. Gives the names that it wrote. */
export function writeLauncher(home) {
  const written = [];
  for (const [name, body] of [['forge', LAUNCHER_SH], ['forge.cmd', LAUNCHER_CMD]]) {
    const file = path.join(home, name);
    let old = null;
    try { old = readFileSync(file, 'utf8'); } catch { old = null; }
    if (old === body) continue;
    writeFileSync(file, body);
    if (name === 'forge') { try { chmodSync(file, 0o755); } catch { /* Windows has no such mode. */ } }
    written.push(name);
  }
  return written;
}

function version(pluginDir) {
  try { return String(JSON.parse(readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8')).version ?? ''); } catch { return ''; }
}

/** 1 when version a is newer than b, -1 when it is older, and 0 when they are the same or have no numbers. */
export function compareVersions(a, b) {
  const parts = (value) => String(value).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) ? 1 : -1;
  }
  return 0;
}

/** The plugin folder that .plugin names, or '' when the file is not there. */
export function readPointer(home) {
  try { return readFileSync(path.join(home, POINTER_FILE), 'utf8').split(/\r?\n/)[0].trim(); } catch { return ''; }
}

/**
 * Writes the path of a plugin folder into .plugin. An older plugin version does not replace a newer one that is still there:
 * two hosts can have two versions of the plugin, and the launcher must not go back.
 * Gives true when it wrote the file.
 */
export function writePointer(home, pluginDir) {
  const next = path.resolve(pluginDir);
  const old = readPointer(home);
  if (old === next) return false;
  if (old && existsSync(path.join(old, 'scripts', 'forge.mjs')) && compareVersions(version(next), version(old)) < 0) return false;
  writeFileSync(path.join(home, POINTER_FILE), `${next}\n`);
  return true;
}

/**
 * The command that starts the live server from a terminal: the launcher file of a Forge folder, then `open`. It gives '' when the folder has no launcher
 * (an older folder ../<repo>.wiki), or when its path has a character that a shell reads inside quotes. A path with a space gets double quotes.
 * PowerShell needs a call operator before a quoted path: the page shows this text, and the user changes it there.
 */
export function launcherCommand(home, platform = process.platform) {
  const file = path.join(path.resolve(home), platform === 'win32' ? 'forge.cmd' : 'forge');
  if (!existsSync(file) || /["`$%\r\n]/.test(file)) return '';
  return `${/[^A-Za-z0-9_@%+=:,./\\-]/.test(file) ? `"${file}"` : file} open`;
}
