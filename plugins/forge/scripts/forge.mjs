#!/usr/bin/env node
// forge command line. Run with an absolute path, for example:
//   node "<plugin>/scripts/forge.mjs" where
// Commands:
//   where   [--wiki <dir>]   the repository, its wiki, and the config folder (JSON)
//   config  [--wiki <dir>]   the forge config (JSON)
//   config set <file>.<key>=<value> ...   set frontmatter values (validated; writes nothing on a problem)
//   config row <checkouts|queries> <name> [cells...] [--delete]   add, replace, or delete a table row
//   doctor  [--wiki <dir>] [--json] [--fetch]   read-only setup check, with the login, hook, and plugin version checks; exit 1 on a failure
//            (--fetch runs git fetch in the plugin clone, to count the commits behind)
//   lint    [--wiki <dir>] [--json] [--fix]   validate tickets, approvals and wiki metadata
//   detect  [--wiki <dir>]   host, CLIs, login, inferred values (JSON, read-only)
//   init    [--wiki <dir>] create the Forge folder ../<repo>.forge of the repository and bind its wiki: wiki/ (git init, index.md), raw/, archive/,
//            and the launcher (forge, forge.cmd). The old name init-wiki does the same.
//   move    [--dry-run] [--json]   move an older folder ../<repo>.wiki to the Forge folder ../<repo>.forge: the wiki becomes <forge>/wiki,
//            and raw/ and archive/ go next to it. It changes no file.
//   bind    [--wiki <dir>]   write <wiki>/forge/repo.json
//   seed [--force]   copy the profile templates to <wiki>/forge/config
//   board   [--json] [--dry-run] [--today <date>] [--links vscode|file]   write <forge>/raw/board.md, the tickets grouped by state,
//           and the pages: raw/board.html and the canvas of each ticket
//   styleguide [--out <file>] [--json]   write the styleguide page of the UI kit (each token and component, in both themes): <forge>/raw/styleguide.html, or the file of --out
//   worktree <KEY> --summary "<goal>" [--base <ref>] [--create] [--json]   plan or create the ticket worktree and branch
//   snapshot <key> <gate> [--json]   save the gate doc as approvals/snapshots/<gate>-<n>.md at a review
//   diff    <key> <gate> [--json]   the summary (or the ⚡ card) on a first review, else the sections changed since the last snapshot
//   canvas  <key> [--json] [--links vscode|file]   write <ticket>/canvas.html, the whole ticket on one board (--json prints its model),
//           and raw/board.html, so the page has a link to the board and to each other ticket
//   canvas  <key> --serve [--port <n>] [--links vscode|file]   show the canvas on http://127.0.0.1 until the user sends the comments
//            from the page; then print the comment message and stop. Exit 0 after a Send, and not 0 when it stops without comments.
//   live    [--port <n>] [--links vscode|file]   show the board and the canvases on http://127.0.0.1 with the live state of the agent sessions
//            (the session hooks send their events to this server). It gives no text to a session: its one action is Resume, which opens a terminal for a closed session. It stops at a signal,
//            or after 8 hours with no event and no request of a page. The links stay the same after a restart: its page token is in a key file.
//            One server runs for each repository, and a session reports to the server of its repository.
//   live --status   print the link of the live server of this repository, or exit 1 when none runs
//   open    [--no-browser] [--port <n>] [--links vscode|file]   the command for a person: start the live server of this repository in the background
//            when none runs, print the links of the board and the wiki, and open the board in the browser
//   open --status | --list | --stop   the server of this repository, each server of this user, or stop the server of this repository
//   open --new-link [--no-browser] [--port <n>] [--links vscode|file]   write a new page token for this repository, so each older link stops (use it when a link leaked):
//            a server that runs is stopped and started again, and the new links print as for open
//   gate-approve <key> <gate> --answer "<exact user answer>" [--method form|chat] [--manifest <path>] [--hash <sha>] [--dry-run] [--json]
//            record an explicit approval of an in-review gate (not Sendable?); checks the manifest, then writes the README and approvals/history.md
//   hook session-start [--host <host>]   read the hook event on stdin; print {"additionalContext"} with the Forge context, else {}
//   hook session-start --host claude --part <n>   the same for Claude Code: part n of the context in {"hookSpecificOutput"}
//   hook prompt-submit --host claude   Claude Code: the ticket part and the session title when the prompt names a ticket
//   hook session-end [--host <host>]   write the end of the session to the session list (<forge>/raw/sessions.jsonl); print {}
//   hook pre-tool [--host <host>]   the gate guard: read the preToolUse event on stdin; for a push or a new change request
//            in a ticket worktree without a valid Shippable? approval, print the deny (or ask) decision, else {}
//   context [--cwd <dir>] [--host <host>]   print the Forge context (for a host without the hook)
//     <host> is vscode, copilot-cli, or claude (copilot is an old name). Without --host, forge.mjs finds the host from the environment.
//   trust [approve <path>=<sha>...]   show or approve the files under <wiki>/forge
//   run <script> [args...]   run <wiki>/forge/scripts/<script>.mjs after the trust check
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readPointer } from './lib/launcher.mjs';
import { resolve, ForgeError, normalizeRemote } from './lib/repo.mjs';
import { loadConfig, KINDS } from './lib/config.mjs';
import { setValues, upsertRow } from './lib/config-write.mjs';
import { createStore } from './lib/cred.mjs';
import { detect, initWiki, bind, move, seed } from './lib/setup.mjs';
import { approve, assertTrusted, status as trustStatus } from './lib/trust.mjs';
import { lint } from './lib/validation.mjs';
import { findTicket } from './lib/tickets.mjs';
import { approveGate } from './lib/approve.mjs';
import { writeBoard } from './lib/board.mjs';
import { createWorktree, planWorktree } from './lib/worktree.mjs';
import { CLAUDE_PARTS, HOST_NAMES, contextText, promptSubmit, readEvent, resolveHost, sessionEnd, sessionStart } from './lib/hook.mjs';
import { preTool, preToolOutput, readToolEvent } from './lib/guard.mjs';
import { diffGate, gateName, renderDiff, saveSnapshot } from './lib/reading.mjs';
import { LINK_MODES, buildCanvas } from './lib/canvas.mjs';
import { writeViews } from './lib/views.mjs';
import { renderStyleguide } from './lib/ui/styleguide.mjs';
import { serveCanvas } from './lib/canvas-serve.mjs';
import { homeOf, rawDir } from './lib/layout.mjs';
import { liveStatus, serveLive } from './lib/live-serve.mjs';
import { listForge, openForge, renewLink, stopForge } from './lib/open.mjs';
import { loadProfile, pluginRoot } from './lib/profile.mjs';

// A tracker that uses an MCP server (see mcpGateway) has no CLI.
const CLI_FOR = { github: 'gh' };
// A command that exits 0 only while the CLI is logged in. Doctor uses the exit status, and never reads the output.
const LOGIN_CHECK = { gh: ['auth', 'status'] };

export { loadProfile };

// Values that each user must set. The profile templates hold the shared values.
const PLACEHOLDER_USER = /<user>/;

/** Credential names that the config names: "cred.mjs set <name>" and "--cred <name>". */
export function credNames(texts) {
  const names = new Set();
  for (const t of texts) {
    for (const m of t.matchAll(/cred\.mjs"?\s+set\s+([A-Za-z0-9][\w.-]*)|--cred\s+([A-Za-z0-9][\w.-]*)/g)) names.add(m[1] ?? m[2]);
  }
  return [...names];
}

/** Setup completeness: the per-user branch pattern, checkout paths, and credentials. */
export function completeness(configDir, config, { credStore, profile = loadProfile() } = {}) {
  const found = [];
  const add = (check, detail) => found.push({ status: 'warn', check, detail });
  if (PLACEHOLDER_USER.test(String(config.repo.branchPattern))) {
    add('config:placeholder', `repo.branchPattern is the template value "${config.repo.branchPattern}". Put your name in place of <user>: forge.mjs config set "repo.branchPattern=${String(config.repo.branchPattern).replace('<user>', '<your name>')}".`);
  }
  const main = config.repo.checkouts[0];
  const hint = profile.mainCheckout;
  if (!main) add('config:checkouts', `repo.md has no Checkouts row. Add the main checkout: forge.mjs config row checkouts ${hint?.name ?? '<name>'} <path> ${hint?.remote ?? '<owner/repo>'}.`);
  else if (!existsSync(main.path)) add('config:checkouts', `The main checkout ${main.path} does not exist on this machine. Clone it there, or change the row: forge.mjs config row checkouts ${main.name} <path> ${main.remote ?? '<remote>'}.`);

  const texts = KINDS.map((k) => path.join(configDir, `${k}.md`)).filter(existsSync).map((f) => readFileSync(f, 'utf8'));
  const names = credNames(texts);
  for (const name of names) {
    let has = null;
    try { has = (credStore ?? createStore()).has(name); } catch (err) { add(`cred:${name}`, `Cannot check the credential store: ${err.message}`); continue; }
    found.push(has
      ? { status: 'ok', check: `cred:${name}`, detail: 'stored' }
      : { status: 'warn', check: `cred:${name}`, detail: `Not stored. The user runs: node "<plugin>/scripts/cred.mjs" set ${name}` });
  }
  return found;
}

// The MCP servers of the profile (profile.mcpServers). The repository .mcp.json can give some, and the forge mcp.json
// gives the others. When the repository adds a server that forge also gives, remove it from the forge mcp.json.
const normUrl = (u) => String(u ?? '').trim().toLowerCase().replace(/\/+$/, '');
const MCP_PANEL = 'Chat: Open Customizations > MCP Servers';

/** Check that the profile MCP servers are configured once, and that no retired URL is in use. */
export function mcpGateway({ repoPath, repoRemote, env = process.env, plugin = pluginRoot, profile = loadProfile() } = {}) {
  const found = [];
  const main = profile.mainCheckout?.remote;
  // Only the main checkout .mcp.json gives the servers that forge does not give.
  const otherRepo = !!(main && repoRemote && !normalizeRemote(repoRemote)?.endsWith(`/${main.toLowerCase()}`));
  const add = (status, check, detail) => found.push({ status, check, detail });
  const sources = [
    plugin && { file: path.join(plugin, 'mcp.json'), forge: true },
    repoPath && { file: path.join(repoPath, '.mcp.json') },
    { file: path.join(env.COPILOT_HOME || path.join(os.homedir(), '.copilot'), 'mcp-config.json') },
  ].filter(Boolean);
  const servers = [];
  for (const { file, forge } of sources.filter((s) => existsSync(s.file))) {
    try {
      const entries = Object.entries(JSON.parse(readFileSync(file, 'utf8')).mcpServers ?? {});
      for (const [name, s] of entries) servers.push({ name, url: normUrl(s?.url), file, forge: !!forge });
    } catch (err) {
      add('warn', 'mcp:config', `Cannot read ${file}: ${err.message}`);
    }
  }
  for (const g of profile.mcpServers) {
    const hits = servers.filter((s) => s.url === normUrl(g.url));
    if (!hits.length && otherRepo) {
      add('ok', `mcp:${g.name}`, `Not in this repository. The ${main} .mcp.json gives it.`);
    } else if (!hits.length) {
      add('warn', `mcp:${g.name}`, `Not configured (${g.url}). Update the forge plugin. Forge gives each server that the repository .mcp.json does not give.`);
    } else if (hits.some((s) => s.forge) && hits.some((s) => !s.forge)) {
      const other = hits.find((s) => !s.forge);
      add('warn', `mcp:${g.name}`, `Two entries: forge and "${other.name}" in ${other.file}. The tools load two times. Disable the forge entry in ${MCP_PANEL}, and remove it from the forge mcp.json in the next forge version.`);
    } else {
      add('ok', `mcp:${g.name}`, `${hits[0].name} in ${hits[0].forge ? 'the forge plugin' : hits[0].file}`);
    }
  }
  for (const r of profile.mcpRetired) {
    for (const s of servers.filter((x) => x.url === normUrl(r.url))) {
      add('warn', 'mcp:retired', `Server "${s.name}" in ${s.file} uses the retired URL ${r.url}. Forge gives the new URL ${r.use}. Disable "${s.name}" in ${MCP_PANEL}.`);
    }
  }
  return found;
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (['--wiki', '--cwd'].includes(a)) {
      out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '';
    }
    else if (a === '--force') out.force = true;
    else if (a === '--fetch') out.fetch = true;
    else if (a === '--fix') out.fix = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--create') out.create = true;
    else if (a === '--serve') out.serve = true;
    else if (a === '--status') out.status = true;
    else if (a === '--list') out.list = true;
    else if (a === '--stop') out.stop = true;
    else if (a === '--new-link') out.newLink = true;
    else if (a === '--no-browser') out.noBrowser = true;
    else if (['--summary', '--base', '--today', '--answer', '--method', '--manifest', '--hash', '--links', '--port', '--out'].includes(a)) {
      if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new ForgeError(`${a} needs a value.`, 'bad-args');
      out[a.slice(2)] = argv[++i];
    }
    else out._.push(a);
  }
  return out;
}

export function onPath(cmd, env = process.env) {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  return dirs.some((d) => exts.some((e) => existsSync(path.join(d, cmd + e.toLowerCase())) || existsSync(path.join(d, cmd + e))));
}

const runQuiet = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore', timeout: 5000, shell: false }).status === 0;
const gitOut = (clone, args, timeout = 5000) => {
  const r = spawnSync('git', ['-C', clone, ...args], { encoding: 'utf8', timeout, shell: false });
  return r.status === 0 ? r.stdout.trim() : null;
};
const samePath = (a, b) => (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));

/** The plugin version line: the Git clone of the plugin, and the commits that it is behind its upstream. */
function pluginVersion(plugin, fetch) {
  const found = [];
  let version = '';
  try { version = JSON.parse(readFileSync(path.join(plugin, 'plugin.json'), 'utf8')).version ?? ''; } catch { /* plugin:plugin.json reports it */ }
  const clone = path.resolve(plugin, '..', '..');
  const top = gitOut(clone, ['rev-parse', '--show-toplevel']);
  const upstream = top && samePath(top, clone) ? gitOut(clone, ['rev-parse', '--abbrev-ref', '@{u}']) : null;
  if (!upstream) {
    found.push({ status: 'ok', check: 'plugin:version', detail: `${version} (not a Git clone: the host updates it)` });
    return found;
  }
  if (fetch && gitOut(clone, ['fetch', '-q'], 15000) === null) found.push({ status: 'warn', check: 'plugin:fetch', detail: `git fetch failed in ${clone}. Check the network, then run: git -C "${clone}" fetch` });
  const behind = Number.parseInt(gitOut(clone, ['rev-list', '--count', 'HEAD..@{u}']) ?? '0', 10) || 0;
  found.push(behind
    ? { status: 'warn', check: 'plugin:version', detail: `${behind} commits behind ${upstream}. Run: git -C "${clone}" pull. Then start a new session.` }
    : { status: 'ok', check: 'plugin:version', detail: `${version} (Git clone, up to date)` });
  return found;
}

export function doctor({ cwd, wiki, env = process.env, credStore, run = runQuiet, plugin = pluginRoot, fetch = false } = {}) {
  const results = [];
  const add = (check, status, detail = '') => results.push({ status, check, detail });

  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  add('tool:node', major >= 20 ? 'ok' : 'fail', `v${process.versions.node}${major >= 20 ? '' : '. forge needs Node.js 20 or later.'}`);
  add('tool:git', onPath('git', env) ? 'ok' : 'fail', onPath('git', env) ? '' : 'Not on PATH. Install Git.');

  for (const rel of ['plugin.json', 'skills']) {
    add(`plugin:${rel}`, existsSync(path.join(pluginRoot, rel)) ? 'ok' : 'fail', path.join(pluginRoot, rel));
  }
  const skillsDir = path.join(pluginRoot, 'skills');
  if (existsSync(skillsDir)) {
    for (const d of readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
      const f = path.join(skillsDir, d.name, 'SKILL.md');
      const name = existsSync(f) ? /^name:\s*(\S+)/m.exec(readFileSync(f, 'utf8'))?.[1] : null;
      add(`skill:${d.name}`, name === d.name ? 'ok' : 'fail', name === d.name ? '' : 'SKILL.md is missing, or its name does not match the folder.');
    }
  }

  let where;
  try {
    where = resolve({ cwd, wiki, env });
  } catch (err) {
    add('repo', 'fail', err.message);
    return results;
  }
  add('repo', 'ok', where.repo.path + (where.repo.worktree ? ` (worktree ${where.repo.worktree})` : ''));
  add('repo:remote', where.repo.remote ? 'ok' : 'warn', where.repo.remote ?? 'No origin remote.');
  add('wiki', where.wiki.exists ? 'ok' : 'fail', where.wiki.exists ? `${where.wiki.path} (${where.wiki.source})` : `Not found: ${where.wiki.path}. Run "forge.mjs init", or say "set up forge".`);
  if (where.wiki.exists) add('wiki:binding', where.wiki.bound ? 'ok' : 'warn', where.wiki.bound ? 'forge/repo.json' : 'No forge/repo.json. Run "forge.mjs bind".');
  // An older folder still works. The Forge folder gives the launcher, and it keeps raw/ and archive/ out of the wiki repository.
  if (where.wiki.exists && where.wiki.source !== 'override') add('forge folder', where.forge.layout === 'forge' ? 'ok' : 'warn', where.forge.layout === 'forge' ? where.forge.path : `${where.wiki.path} is an older folder. Run "forge.mjs move --dry-run", then "forge.mjs move", to get the Forge folder ${where.repo.path}.forge.`);
  for (const w of where.warnings.filter((x) => !x.includes('has no forge/repo.json'))) add('warning', 'warn', w);
  if (where.forge.layout === 'forge') {
    const seen = readPointer(where.forge.path);
    if (!seen) add('hook', 'warn', 'No session start seen. Install the plugin in your host, then start a session in this repository.');
    else if (!existsSync(path.join(seen, 'scripts', 'forge.mjs'))) add('hook', 'warn', `The plugin folder in .plugin is gone: ${seen}. Start a session to update it.`);
    else add('hook', 'ok', seen);
  }
  results.push(...pluginVersion(plugin, fetch));
  if (!where.wiki.exists) return results;

  try {
    const { config } = loadConfig(where.configDir);
    const logins = new Set();
    for (const kind of KINDS) {
      const file = path.join(where.configDir, `${kind}.md`);
      if (!existsSync(file)) { add(`config:${kind}.md`, 'warn', 'Missing. forge uses the defaults. Run "forge.mjs seed".'); continue; }
      const provider = config[kind].provider;
      add(`config:${kind}.md`, 'ok', provider ? `provider: ${provider}` : '');
      const tool = CLI_FOR[provider];
      if (tool && !onPath(tool, env)) add(`config:${kind}.md`, 'warn', `${tool} is not on PATH. The ${provider} commands need it.`);
      else if (tool && LOGIN_CHECK[tool] && !logins.has(tool)) {
        logins.add(tool);
        const ok = run(tool, LOGIN_CHECK[tool]);
        add(`tool:${tool} login`, ok ? 'ok' : 'warn', ok ? '' : `Not logged in, or no network. Run "${tool} auth login".`);
      }
    }
    results.push(...completeness(where.configDir, config, { credStore }));
  } catch (err) {
    add('config', 'fail', err.message);
  }
  results.push(...mcpGateway({ repoPath: where.repo.path, repoRemote: where.repo.remote, env }));
  const st = trustStatus(where, { env });
  const bad = st.files.filter((f) => f.state !== 'ok');
  add('trust', bad.length ? 'fail' : 'ok', bad.length ? `Not approved: ${bad.map((f) => `${f.rel} (${f.state})`).join(', ')}. Run "forge.mjs trust".` : `${st.files.length} files approved`);
  return results;
}

function print(results) {
  const w = Math.max(...results.map((r) => r.check.length));
  for (const r of results) console.log(`${r.status.padEnd(4)}  ${r.check.padEnd(w)}  ${r.detail}`);
}

export function runScript(name, rest, { cwd = process.cwd(), env = process.env } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name ?? '')) throw new ForgeError('Usage: forge.mjs run <script> [args...]. The name has lowercase letters, digits, and hyphens.', 'bad-args');
  const where = resolve({ cwd, env });
  const file = path.join(where.wiki.path, 'forge', 'scripts', `${name}.mjs`);
  if (!existsSync(file)) throw new ForgeError(`No wiki script: ${file}`, 'no-script');
  assertTrusted(where, ['scripts/', 'config/'], { env });
  const r = spawnSync(process.execPath, [file, ...rest], {
    cwd,
    stdio: 'inherit',
    env: { ...env, FORGE_CORE: path.join(pluginRoot, 'scripts'), FORGE_WIKI: where.wiki.path, FORGE_REPO: where.repo.path },
  });
  return r.status ?? 1;
}

export function configEdit(argv, { cwd = process.cwd() } = {}) {
  const [sub, ...rest] = argv;
  const opts = { cwd };
  const pos = [];
  let remove = false;
  for (let i = 0; i < rest.length; i++) {
    if (['--wiki', '--cwd'].includes(rest[i])) {
      if (!rest[i + 1] || rest[i + 1].startsWith('--')) throw new ForgeError(`${rest[i]} needs a folder.`, 'bad-args');
      opts[rest[i].slice(2)] = rest[++i];
    } else if (rest[i] === '--delete' && sub === 'row') remove = true;
    else pos.push(rest[i]);
  }
  const where = resolve(opts);
  const r = sub === 'set' ? setValues(where.configDir, pos) : upsertRow(where.configDir, pos[0], pos.slice(1), { remove });
  return { configDir: r.configDir, changed: r.changed, next: r.changed.length ? 'Review the change, then approve it: forge.mjs trust' : 'No change.' };
}

/**
 * The options of `hook <name> [--host <host>] [--part <n>]`, or null when they are not valid.
 * A hook without --host is a Copilot hook (VS Code or Copilot CLI, from env). Claude Code hooks give --host claude.
 */
export function hookArgs(argv, env = process.env) {
  const [, name, ...rest] = argv;
  const out = { name, host: '', part: 1 };
  let partGiven = false;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--host' && HOST_NAMES.includes(rest[i + 1])) out.host = rest[++i];
    else if (rest[i] === '--part' && /^[1-9]$/.test(rest[i + 1] ?? '') && Number(rest[i + 1]) <= CLAUDE_PARTS) { out.part = Number(rest[++i]); partGiven = true; }
    else return null;
  }
  // Claude Code runs one hook for each part, so only an explicit --host claude gives parts.
  const explicitClaude = out.host === 'claude';
  out.host = explicitClaude ? 'claude' : resolveHost(out.host || 'copilot', env);
  if (name === 'session-start' && (explicitClaude || !partGiven)) return out;
  if (name === 'prompt-submit' && explicitClaude && !partGiven) return out;
  if ((name === 'pre-tool' || name === 'session-end') && !partGiven) return out;
  return null;
}

/** `context [--cwd <dir>] [--host <host>]`: the Forge context as plain text, for a host without the hook. */
function printContext(argv, env = process.env) {
  const opts = { cwd: process.cwd(), host: '' };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--cwd' && argv[i + 1]) opts.cwd = argv[++i];
    else if (argv[i] === '--host' && HOST_NAMES.includes(argv[i + 1])) opts.host = argv[++i];
    else { console.error(`forge: Usage: forge.mjs context [--cwd <dir>] [--host ${HOST_NAMES.join('|')}].`); return 2; }
  }
  const host = resolveHost(opts.host, env);
  const text = contextText({ cwd: path.resolve(opts.cwd), source: '', prompt: '' }, { cli: fileURLToPath(import.meta.url), env, host });
  if (!text) { console.error('forge: no Forge context: the rule files cannot be read.'); return 1; }
  console.log(text);
  return 0;
}

export function main(argv = process.argv.slice(2)) {
  if (argv[0] === 'hook') {
    // A hook never blocks the session: it prints JSON and exits 0, also on errors.
    let result = {};
    try {
      const hook = hookArgs(argv);
      if (!hook) console.error(`forge: Usage: forge.mjs hook session-start [--host vscode|copilot-cli | --host claude --part <1-${CLAUDE_PARTS}>] | hook prompt-submit --host claude | hook pre-tool [--host <host>] | hook session-end [--host <host>] (reads the hook event JSON on stdin).`);
      else {
        let raw = '';
        try { if (!process.stdin.isTTY) raw = readFileSync(0, 'utf8'); } catch { /* no input */ }
        const options = { cli: fileURLToPath(import.meta.url), host: hook.host, part: hook.part };
        if (hook.name === 'pre-tool') result = preToolOutput(preTool(readToolEvent(raw)), hook.host);
        else if (hook.name === 'session-end') result = sessionEnd(readEvent(raw), { host: hook.host });
        else result = hook.name === 'prompt-submit' ? promptSubmit(readEvent(raw), options) : sessionStart(readEvent(raw), options);
      }
    } catch (err) {
      console.error(`forge: hook ${argv[1]}: ${err.message}`);
      result = {};
    }
    console.log(JSON.stringify(result));
    return 0;
  }
  if (argv[0] === 'context') return printContext(argv);
  if (argv[0] === 'config' && ['set', 'row'].includes(argv[1])) {
    try {
      console.log(JSON.stringify(configEdit(argv.slice(1)), null, 2));
      return 0;
    } catch (err) {
      if (err instanceof ForgeError) { console.error(`forge: ${err.message}`); return 1; }
      throw err;
    }
  }
  if (argv[0] === 'run') {
    try {
      return runScript(argv[1], argv.slice(2));
    } catch (err) {
      if (err instanceof ForgeError) { console.error(`forge: ${err.message}`); return 1; }
      throw err;
    }
  }
  let args;
  try { args = parseArgs(argv); }
  catch (err) {
    if (err instanceof ForgeError) { console.error(`forge: ${err.message}`); return 2; }
    throw err;
  }
  const [cmd] = args._;
  const opts = { cwd: args.cwd ?? process.cwd(), wiki: args.wiki };
  try {
    if (cmd === 'where') {
      console.log(JSON.stringify(resolve(opts), null, 2));
    } else if (cmd === 'config') {
      const where = resolve(opts);
      assertTrusted(where, ['config/']);
      console.log(JSON.stringify({ ...loadConfig(where.configDir), warnings: where.warnings }, null, 2));
    } else if (cmd === 'doctor') {
      const results = doctor({ ...opts, fetch: args.fetch });
      if (args.json) console.log(JSON.stringify(results, null, 2)); else print(results);
      return results.some((r) => r.status === 'fail') ? 1 : 0;
    } else if (cmd === 'lint') {
      if (args._.length !== 1 || args.force
        || (args.wiki !== undefined && (!args.wiki || args.wiki.startsWith('--')))
        || (args.cwd !== undefined && (!args.cwd || args.cwd.startsWith('--')))
        || argv.some((arg, index) => ['--wiki', '--cwd'].includes(arg) && (!argv[index + 1] || argv[index + 1].startsWith('--')))) {
        throw new ForgeError('Usage: forge.mjs lint [--wiki <dir>] [--cwd <dir>] [--json] [--fix].', 'bad-args');
      }
      const where = resolve(opts);
      const report = lint({ wikiPath: where.wiki.path, repoPath: where.repo.path, fix: args.fix });
      if (args.json) console.log(JSON.stringify(report, null, 2));
      else {
        for (const item of report.findings) console.log(`${item.severity} ${item.code} ${item.file}${item.line ? `:${item.line}` : ''}: ${item.message} ${item.remedy}`);
        for (const repair of report.repairs) console.log(`repaired ${repair.code} ${repair.file}; log: ${repair.log}`);
        console.log(`${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.repaired} repairs.`);
      }
      return report.summary.errors ? 1 : 0;
    } else if (cmd === 'detect') {
      console.log(JSON.stringify(detect(resolve(opts)), null, 2));
    } else if (cmd === 'init' || cmd === 'init-wiki') {
      console.log(JSON.stringify(initWiki(resolve(opts), { pluginDir: path.dirname(path.dirname(fileURLToPath(import.meta.url))) }), null, 2));
    } else if (cmd === 'move') {
      if (args._.length !== 1) throw new ForgeError('Usage: forge.mjs move [--dry-run] [--json].', 'bad-args');
      // The move starts from the code repository: the convention gives the old and the new folder.
      const where = resolve({ cwd: opts.cwd });
      const result = move(where, {
        dryRun: args.dryRun, pluginDir: path.dirname(path.dirname(fileURLToPath(import.meta.url))),
        serverRuns: Boolean(liveStatus(process.env, `${where.repo.path}.wiki`)),
      });
      if (args.json) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(`${result.moved ? 'moved' : 'would move'}:`);
        for (const step of result.steps) console.log(`  ${step}`);
        if (result.links.length) {
          console.log(`  ${result.links.length} file${result.links.length === 1 ? ' has' : 's have'} a link with the old path ${result.from}. ${result.moved ? 'These links' : 'After the move, these links'} do not work:`);
          for (const file of result.links.slice(0, 20)) console.log(`    ${file}`);
          if (result.links.length > 20) console.log(`    and ${result.links.length - 20} more`);
        }
        if (result.moved) {
          console.log(`  Start each agent session of this repository again: an open session has the old paths.`);
          console.log(`  Give the folder ${result.wiki} to an automation that had the old wiki folder.`);
          console.log(`  open  ${path.join(result.forge, process.platform === 'win32' ? 'forge.cmd' : 'forge')} open`);
        }
      }
    } else if (cmd === 'bind') {
      console.log(JSON.stringify(bind(resolve(opts)), null, 2));
    } else if (cmd === 'seed') {
      const templates = path.join(pluginRoot, 'templates', 'config');
      console.log(JSON.stringify(seed(resolve(opts), templates, { force: args.force }), null, 2));
    } else if (cmd === 'board') {
      if (args._.length !== 1 || (args.links !== undefined && !LINK_MODES.includes(args.links))) throw new ForgeError(`Usage: forge.mjs board [--json] [--dry-run] [--today <YYYY-MM-DD>] [--links ${LINK_MODES.join('|')}].`, 'bad-args');
      const where = resolve(opts);
      if (!where.wiki.exists) throw new ForgeError(`No wiki at ${where.wiki.path}. Run the forge-setup skill.`, 'no-wiki');
      let board;
      let views;
      try {
        board = writeBoard(where.wiki.path, { today: args.today, dryRun: args.dryRun });
        // The pages of the same board: raw/board.html and the canvas of each ticket.
        views = writeViews(where.wiki.path, { links: args.links, today: args.today, dryRun: args.dryRun });
      } catch (err) { throw new ForgeError(err.message, 'board'); }
      const page = {
        file: views.page.file, url: pathToFileURL(views.page.file).href, written: views.page.written, canvases: views.canvases.written.length, failed: views.canvases.failed,
        // The wiki page: each canonical page of the wiki, and the summary pages of the closed tickets.
        wiki: { file: views.wiki.file, url: pathToFileURL(views.wiki.file).href, written: views.wiki.written, pages: views.wiki.pages, closed: views.wiki.closed },
      };
      if (args.json) console.log(JSON.stringify({ ...board, page }, null, 2));
      else {
        console.log(board.groups.map((group) => `${group.emoji} ${group.label} ${group.tickets.length}`).join(' · '));
        for (const error of board.errors) console.log(`  read error ${error.folder}: ${error.message}`);
        for (const error of page.failed) console.log(`  no canvas ${error.folder}: ${error.message}`);
        console.log(`${board.written ? 'wrote' : !board.changed ? 'unchanged' : 'would write'}: ${board.file}`);
        console.log(`  open  ${page.url}`);
        console.log(`  wiki  ${page.wiki.url}`);
      }
    } else if (cmd === 'styleguide') {
      if (args._.length !== 1) throw new ForgeError('Usage: forge.mjs styleguide [--out <file>] [--json].', 'bad-args');
      let file;
      if (args.out) file = path.resolve(args.out);
      else {
        const where = resolve(opts);
        if (!where.wiki.exists) throw new ForgeError(`No wiki at ${where.wiki.path}. Run the forge-setup skill.`, 'no-wiki');
        file = path.join(rawDir(where.wiki.path), 'styleguide.html');
      }
      try {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, renderStyleguide());
      } catch (err) { throw new ForgeError(err.message, 'styleguide'); }
      const url = pathToFileURL(file).href;
      if (args.json) console.log(JSON.stringify({ file, url }, null, 2));
      else {
        console.log(`wrote: ${file}`);
        console.log(`  open  ${url}`);
      }
    } else if (cmd === 'worktree') {
      if (args._.length !== 2 || !args.summary) throw new ForgeError('Usage: forge.mjs worktree <KEY> --summary "<goal>" [--base <ref>] [--create] [--json].', 'bad-args');
      const where = resolve(opts);
      assertTrusted(where, ['config/']);
      const { config } = loadConfig(where.configDir);
      let result;
      try {
        result = planWorktree({ repoPath: where.repo.path, cwd: opts.cwd, config, key: args._[1], summary: args.summary, base: args.base });
        if (args.create) result = createWorktree(result, where.repo.path);
      } catch (err) { throw new ForgeError(err.message, 'worktree'); }
      if (args.json) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(`${result.key}: ${result.status ?? result.action}`);
        console.log(`  branch ${result.branch}`);
        console.log(`  folder ${result.existing?.path ?? result.folder}`);
        console.log(`  base   ${result.base.ref} ${result.base.sha ?? '(not found)'}`);
        if (result.current) console.log(`  here   ${result.current.path} [${result.current.branch || 'detached'}]`);
        for (const item of result.related) console.log(`  other  ${item.path} [${item.branch || 'detached'}]`);
        for (const command of result.status ? [] : result.commands) console.log(`  run    ${command}`);
      }
    } else if (cmd === 'snapshot' || cmd === 'diff') {
      if (args._.length !== 3) throw new ForgeError(`Usage: forge.mjs ${cmd} <key> <gate> [--json].`, 'bad-args');
      const where = resolve(opts);
      let result;
      try {
        const { dir, ticket } = findTicket(where.wiki.path, args._[1]);
        const gate = gateName(args._[2]);
        result = cmd === 'snapshot' ? saveSnapshot(dir, ticket, gate) : diffGate(dir, ticket, gate);
      } catch (err) { throw new ForgeError(err.message, cmd); }
      if (args.json) console.log(JSON.stringify(result, null, 2));
      else if (cmd === 'diff') console.log(renderDiff(result));
      else console.log(`${result.gate} ${result.written ? 'saved' : 'unchanged'}: ${result.snapshot}`);
    } else if (cmd === 'canvas') {
      // --port 0 lets the system select a free port. A fixed port is for a browser on another machine (a forwarded port).
      const port = args.port === undefined ? undefined : Number(args.port);
      const badPort = args.port !== undefined && (!/^\d{1,5}$/.test(args.port) || (port !== 0 && (port < 1024 || port > 65535)));
      if (args._.length !== 2 || (args.links !== undefined && !LINK_MODES.includes(args.links))
        || (args.serve && args.json) || (args.port !== undefined && !args.serve) || badPort) {
        throw new ForgeError(`Usage: forge.mjs canvas <key> [--json] [--links ${LINK_MODES.join('|')}] [--serve [--port <n>]]. A port is 0, or 1024 to 65535.`, 'bad-args');
      }
      const where = resolve(opts);
      try {
        const { dir, folder } = findTicket(where.wiki.path, args._[1]);
        if (args.json) console.log(JSON.stringify(buildCanvas(dir), null, 2));
        else if (args.serve) {
          // The server runs after main() returns. The exit code comes when the user sends the comments or the server stops.
          serveCanvas(dir, { links: args.links, port, wiki: where.wiki.path, folder }).then(
            (code) => { process.exitCode = code; },
            (err) => { console.error(`forge: ${err.message}`); process.exitCode = 1; },
          );
        } else {
          // The page links to the board page and to the canvas of each other ticket, so this command writes those that are missing.
          const views = writeViews(where.wiki.path, { links: args.links, focus: folder, all: false });
          const result = views.focus;
          console.log(`${result.key}: wrote ${result.file}`);
          console.log(`  open  ${pathToFileURL(result.file).href}`);
          console.log(`  board ${pathToFileURL(views.page.file).href}`);
          console.log(`  wiki  ${pathToFileURL(views.wiki.file).href}`);
          if (result.missing.length) console.log(`  not written yet: ${result.missing.join(', ')}`);
        }
      } catch (err) { throw new ForgeError(err.message, 'canvas'); }
    } else if (cmd === 'live') {
      const port = args.port === undefined ? undefined : Number(args.port);
      const badPort = args.port !== undefined && (!/^\d{1,5}$/.test(args.port) || (port !== 0 && (port < 1024 || port > 65535)));
      if (args._.length !== 1 || args.json || (args.links !== undefined && !LINK_MODES.includes(args.links)) || badPort || args.newLink || (args.status && args.port !== undefined)) {
        throw new ForgeError(`Usage: forge.mjs live [--port <n>] [--links ${LINK_MODES.join('|')}], or forge.mjs live --status. A port is 0, or 1024 to 65535.`, 'bad-args');
      }
      const where = resolve(opts);
      if (args.status) {
        const running = liveStatus(process.env, homeOf(where.wiki.path));
        if (!running) { console.log('live: no server runs for this repository. Start it with: forge.mjs open'); return 1; }
        console.log(`live: serving ${running.link}\n  wiki  ${running.wikiLink}\n  state ${running.file}`);
      } else {
        if (!where.wiki.exists) throw new ForgeError(`No wiki at ${where.wiki.path}. Run the forge-setup skill.`, 'no-wiki');
        // The server runs after main() returns. The exit code comes when the server stops.
        serveLive(where.wiki.path, { links: args.links, port, repo: where.repo.path }).then(
          (code) => { process.exitCode = code; },
          (err) => { console.error(`forge: ${err.message}`); process.exitCode = 1; },
        );
      }
    } else if (cmd === 'open') {
      const port = args.port === undefined ? undefined : Number(args.port);
      const badPort = args.port !== undefined && (!/^\d{1,5}$/.test(args.port) || (port !== 0 && (port < 1024 || port > 65535)));
      const modes = [args.status, args.list, args.stop].filter(Boolean).length;
      if (args._.length !== 1 || args.json || (args.links !== undefined && !LINK_MODES.includes(args.links)) || badPort || modes > 1 || (modes && (args.port !== undefined || args.links !== undefined || args.newLink))) {
        throw new ForgeError(`Usage: forge.mjs open [--no-browser] [--new-link] [--port <n>] [--links ${LINK_MODES.join('|')}], or forge.mjs open --status | --list | --stop. A port is 0, or 1024 to 65535.`, 'bad-args');
      }
      if (args.list) {
        // Each live server of this user: the list needs no repository.
        const lines = listForge();
        console.log(lines.length ? lines.join('\n') : 'forge: no live server runs.');
        return 0;
      }
      const where = resolve(opts);
      if (!where.wiki.exists) throw new ForgeError(`No wiki at ${where.wiki.path}. Run the forge-setup skill.`, 'no-wiki');
      if (args.status) {
        const running = liveStatus(process.env, homeOf(where.wiki.path));
        if (!running) { console.log('forge: no server runs for this repository. Start it with: forge.mjs open'); return 1; }
        console.log(`forge: serving ${running.link}\n  wiki   ${running.wikiLink}\n  folder ${running.home}`);
        return 0;
      }
      // The answer comes after main() returns: the server needs a moment to start or to stop.
      const work = args.stop
        ? stopForge({ wiki: where.wiki.path }).then((result) => { console.log(result.stopped ? `forge: stopped the live server of this repository (process ${result.pid}).` : 'forge: no server runs for this repository.'); })
        : (args.newLink ? renewLink : openForge)({ cli: fileURLToPath(import.meta.url), repo: where.repo.path, wiki: where.wiki.path, links: args.links, port, browser: !args.noBrowser }).then(() => {});
      work.catch((err) => { console.error(`forge: ${err.message}`); process.exitCode = 1; });
    } else if (cmd === 'gate-approve') {
      if (args._.length !== 3 || !args.answer) throw new ForgeError('Usage: forge.mjs gate-approve <key> <gate> --answer "<exact user answer>" [--method form|chat] [--manifest <path>] [--hash <sha>] [--dry-run] [--json].', 'bad-args');
      const where = resolve(opts);
      let result;
      try {
        const { dir } = findTicket(where.wiki.path, args._[1]);
        result = approveGate(dir, { gate: gateName(args._[2]), answer: args.answer, method: args.method, manifest: args.manifest, hash: args.hash, today: args.today, dryRun: args.dryRun });
      } catch (err) { throw new ForgeError(err.message, 'gate-approve'); }
      if (args.json) console.log(JSON.stringify(result, null, 2));
      else console.log(` ${result.gate} ${result.status} (${result.date}, ${result.method}): ${result.manifest} sha256 ${result.hash}. ${args.dryRun ? 'Would write' : 'Wrote'}: ${result.writes.join(', ')}.`);
    } else if (cmd === 'trust') {      const where = resolve(opts);
      if (args._[1] === 'approve') console.log(JSON.stringify(approve(where, args._.slice(2)), null, 2));
      else console.log(JSON.stringify(trustStatus(where), null, 2));
    } else {
      console.error('Usage: node forge.mjs <where|config|doctor|lint|detect|init|move|bind|seed|board|styleguide|worktree|snapshot|diff|canvas|live|open|gate-approve|hook|context|trust|run> [--wiki <dir>] [--cwd <dir>] [--json]');
      return 2;
    }
    return 0;
  } catch (err) {
    if (err instanceof ForgeError) {
      if (cmd === 'lint' && args.json) console.log(JSON.stringify({
        version: 1, wikiPath: args.wiki ? path.resolve(args.wiki) : null,
        findings: [{ file: args.wiki ?? opts.cwd, line: null, code: err.code, severity: 'error', message: err.message, remedy: 'Correct the command or repository binding and run lint again.' }],
        repairs: [], summary: { errors: 1, warnings: 0, repaired: 0 },
      }, null, 2));
      else console.error(`forge: ${err.message}`);
      return 1;
    }
    throw err;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
