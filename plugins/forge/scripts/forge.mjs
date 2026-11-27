#!/usr/bin/env node
// forge command line. Run with an absolute path, for example:
//   node "<plugin>/scripts/forge.mjs" where
// Commands:
//   where   [--wiki <dir>]   the repository, its wiki, and the config folder (JSON)
//   config  [--wiki <dir>]   the forge config (JSON)
//   config set <file>.<key>=<value> ...   set frontmatter values (validated; writes nothing on a problem)
//   config row checkouts <name> [cells...] [--delete]   add, replace, or delete a table row
//   doctor  [--wiki <dir>] [--json] [--fetch]   read-only setup check, with the hook and plugin version checks; exit 1 on a failure
//            (--fetch runs git fetch in the plugin clone, to count the commits behind)
//   lint    [--wiki <dir>] [--json] [--fix]   validate tickets, approvals and wiki metadata
//   detect  [--wiki <dir>]   host, branch hints, inferred values (JSON, read-only)
//   init    [--wiki <dir>] create the Forge folder ../<repo>.forge of the repository and bind its wiki: wiki/ (git init, index.md), raw/, archive/.
//   bind    [--wiki <dir>]   write <wiki>/forge/repo.json
//   seed [--force]   copy the config templates to <wiki>/forge/config
//   board   [--json] [--dry-run] [--today <date>]   write <forge>/raw/board.md, the tickets grouped by state; print the groups (--json: the whole board)
//   local-key [--json]   the next key L-<n> of a ticket with no work item (it moves the counter <forge>/raw/local-key)
//   worktree <KEY> --summary "<goal>" [--base <ref>] [--create] [--json]   plan or create the ticket worktree and branch
//   gate-open <key> <gate> [extra files...] [--dry-run] [--json] [--today <yyyy-mm-dd>]
//            open the review of a gate in one call: checks the earlier gates and the plan, writes approvals/<gate>-<n>.json,
//            saves the snapshot, and sets the gate to in-review; prints the set, the diff, and the open points of the plan review
//   gate-approve <key> <gate> --answer "<exact user answer>" [--method form|chat] [--manifest <path>] [--hash <sha>] [--dry-run] [--json]
//            record an explicit approval of an in-review gate; checks the manifest, then writes the README and approvals/history.md
//   hook session-start [--host <host>]   read the hook event on stdin; print {"additionalContext"} with the Forge context, else {}
//   hook session-start --host claude --part <n>   the same for Claude Code: part n of the context in {"hookSpecificOutput"}
//   hook prompt-submit --host claude   Claude Code: the ticket part and the session title when the prompt names a ticket
//   hook session-end [--host <host>]   write the rule pages that the session saw (<forge>/raw/rules-seen); print {}
//   hook pre-tool [--host <host>]   the gate guard: read the preToolUse event on stdin; for a push or a new change request
//            in a ticket worktree without a valid Shippable? approval, print the deny (or ask) decision, else {}
//   context [--cwd <dir>] [--host <host>]   print the Forge context (for a host without the hook)
//     <host> is copilot-cli or claude (copilot is an old name). Without --host, forge.mjs finds the host from the environment.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve, ForgeError, readBinding } from './lib/repo.mjs';
import { loadConfig, KINDS } from './lib/config.mjs';
import { setValues, upsertRow } from './lib/config-write.mjs';
import { detect, initWiki, bind, seed } from './lib/setup.mjs';
import { lint } from './lib/validation.mjs';
import { findTicket, nextLocalKey } from './lib/tickets.mjs';
import { approveGate } from './lib/approve.mjs';
import { openReview } from './lib/gate-open.mjs';
import { baseBranchOf } from './lib/code-bind.mjs';
import { writeBoard } from './lib/board.mjs';
import { createWorktree, planWorktree } from './lib/worktree.mjs';
import { CLAUDE_PARTS, HOST_NAMES, contextText, promptSubmit, readEvent, resolveHost, sessionEnd, sessionStart, safeConfig } from './lib/hook.mjs';
import { preTool, preToolOutput, readToolEvent } from './lib/guard.mjs';
import { gateName } from './lib/reading.mjs';
import { pluginRoot } from './lib/plugin-root.mjs';
import { OPTIONAL_VALUE_OPTIONS, REQUIRED_VALUE_OPTIONS } from './lib/cli-options.mjs';

// Values that each user must set. The templates hold the shared values.
const PLACEHOLDER_USER = /<user>/;

/** Setup completeness: the per-user branch pattern and the checkout paths. */
export function completeness(configDir, config) {
  const found = [];
  const add = (check, detail) => found.push({ status: 'warn', check, detail });
  if (PLACEHOLDER_USER.test(String(config.repo.branchPattern))) {
    add('config:placeholder', `repo.branchPattern is the template value "${config.repo.branchPattern}". Put your name in place of <user>: forge.mjs config set "repo.branchPattern=${String(config.repo.branchPattern).replace('<user>', '<your name>')}".`);
  }
  const main = config.repo.checkouts[0];
  if (!main) add('config:checkouts', 'repo.md has no Checkouts row. Add the main checkout: forge.mjs config row checkouts <name> <path> <remote>.');
  else if (!existsSync(main.path)) add('config:checkouts', `The main checkout ${main.path} does not exist on this machine. Clone it there, or change the row: forge.mjs config row checkouts ${main.name} <path> ${main.remote ?? '<remote>'}.`);
  return found;
}

/**
 * A warning when repo.baseBranch, or the baseBranch of a Checkouts row, is not the default branch of the remote (the local ref origin/HEAD).
 * The code binding of Shippable? is bound from that branch. No warning when origin/HEAD is unknown or the config has no repo.md.
 */
export function baseBranchCheck(where, config, files = []) {
  if (!files.some((file) => path.basename(file) === 'repo.md')) return [];
  const head = spawnSync('git', ['-C', where.repo.path, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
  const fallback = head.status === 0 ? head.stdout.trim().replace(/^[^/]+\//, '') : '';
  if (!fallback) return [];
  const names = [...new Set([config.repo.baseBranch, ...(config.repo.checkouts ?? []).map((row) => row.baseBranch)].filter(Boolean))];
  return names.filter((name) => name !== fallback).map((name) => ({ status: 'warn', check: 'config:baseBranch', detail: `The base branch ${name} is not the default branch of the remote (${fallback}). The code binding of Shippable? is bound from ${name}. Check repo.baseBranch and the baseBranch of the Checkouts rows.` }));
}

/** The files that Forge 14 does not read any more: { check, detail } for each one that exists. It deletes nothing. */
export function unusedFiles(where) {
  const found = [];
  const unused = (file, label) => { if (existsSync(file)) found.push({ status: 'warn', check: `unused:${label}`, detail: `${file} is not used since 14.0.0, remove it.` }); };
  unused(path.join(where.configDir, 'tracker.md'), 'config/tracker.md');
  unused(path.join(where.configDir, 'ci.md'), 'config/ci.md');
  unused(path.join(where.wiki.path, 'rules', 'toolkit.md'), 'rules/toolkit.md');
  // Web parts that Forge 0.1.0 removed. A Forge folder of an older version can still hold their files. Doctor deletes nothing.
  if (where.forge.layout === 'forge') {
    for (const name of ['raw/board.html', 'raw/wiki.html', 'raw/styleguide.html', 'raw/mermaid.tiny.js', 'raw/sessions.jsonl', 'forge', 'forge.cmd', '.plugin']) {
      const file = path.join(where.forge.path, ...name.split('/'));
      if (existsSync(file)) found.push({ status: 'warn', check: `unused:${name}`, detail: `${file} is not used since 0.1.0, remove it.` });
    }
  }
  let binding = null;
  try { binding = readBinding(where.wiki.path); } catch { /* wiki:binding reports it */ }
  if (binding && Object.hasOwn(binding, 'profile')) {
    found.push({ status: 'warn', check: 'unused:forge/repo.json profile', detail: `The "profile" key in ${path.join(where.wiki.path, 'forge', 'repo.json')} is not used since 14.0.0, remove it.` });
  }
  // policy.md of a wiki that Forge 13 made can name a part that 14.0.0 removed.
  const policy = path.join(where.configDir, 'policy.md');
  if (existsSync(policy)) {
    const text = readFileSync(policy, 'utf8');
    const words = ['tracker.', 'ci.status', 'ci.trigger', 'ci.logs', 'Sendable'].filter((word) => text.includes(word)); // legacy-14
    if (words.length) found.push({ status: 'warn', check: 'unused:config/policy.md', detail: `policy.md names a part removed in 14.0.0: ${words.join(', ')}; edit its sections or run seed --force for policy.md.` });
  }
  try {
    const value = loadConfig(where.configDir).config.policy.gateGuard;
    if (value === 'off' || value === 'ask') {
      found.push({ status: 'warn', check: 'unused:policy.gateGuard', detail: `policy.gateGuard ${value} is not used since 14.1.0: set FORGE_GATE_GUARD=${value} in your environment` });
    }
  } catch { /* config reports it */ }
  return found;
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (OPTIONAL_VALUE_OPTIONS.includes(a)) {
      out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '';
    }
    else if (a === '--force') out.force = true;
    else if (a === '--fetch') out.fetch = true;
    else if (a === '--fix') out.fix = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--create') out.create = true;
    else if (REQUIRED_VALUE_OPTIONS.includes(a)) {
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

export function doctor({ cwd, wiki, env = process.env, plugin = pluginRoot, fetch = false } = {}) {
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
  // Forge 10 does not read the older folder ../<repo>.wiki.
  const older = !where.wiki.exists && !existsSync(where.forge.path) && existsSync(`${where.repo.path}.wiki`);
  add('wiki', where.wiki.exists ? 'ok' : 'fail', where.wiki.exists ? `${where.wiki.path} (${where.wiki.source})` : older
    ? 'Forge 10 does not read ../<repo>.wiki. Make ../<repo>.forge, move the wiki into wiki/, and move raw/ and archive/ next to it.'
    : `Not found: ${where.wiki.path}. Run "forge.mjs init", or say "set up forge".`);
  if (where.wiki.exists) add('wiki:binding', where.wiki.bound ? 'ok' : 'warn', where.wiki.bound ? 'forge/repo.json' : 'No forge/repo.json. Run "forge.mjs bind".');
  for (const w of where.warnings.filter((x) => !x.includes('has no forge/repo.json'))) add('warning', 'warn', w);
  results.push(...pluginVersion(plugin, fetch));
  if (!where.wiki.exists) return results;

  try {
    const { config, files } = loadConfig(where.configDir);
    for (const kind of KINDS) {
      const file = path.join(where.configDir, `${kind}.md`);
      add(`config:${kind}.md`, existsSync(file) ? 'ok' : 'warn', existsSync(file) ? '' : 'Missing. forge uses the defaults. Run "forge.mjs seed".');
    }
    results.push(...completeness(where.configDir, config));
    results.push(...baseBranchCheck(where, config, files));
  } catch (err) {
    add('config', 'fail', err.message);
  }
  results.push(...unusedFiles(where));
  return results;
}

function print(results) {
  const w = Math.max(...results.map((r) => r.check.length));
  for (const r of results) console.log(`${r.status.padEnd(4)}  ${r.check.padEnd(w)}  ${r.detail}`);
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
  return { configDir: r.configDir, changed: r.changed, next: r.changed.length ? 'Review the change.' : 'No change.' };
}

/**
 * The options of `hook <name> [--host <host>] [--part <n>]`, or null when they are not valid.
 * A hook without --host is a Copilot hook (the Copilot CLI, also when CLAUDECODE is set). Claude Code hooks give --host claude.
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
      if (!hook) console.error(`forge: Usage: forge.mjs hook session-start [--host copilot-cli | --host claude --part <1-${CLAUDE_PARTS}>] | hook prompt-submit --host claude | hook pre-tool [--host <host>] | hook session-end [--host <host>] (reads the hook event JSON on stdin).`);
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
      // A config that cannot be read gives no policy and no checkouts. Then the plan review rule does not run.
      const config = safeConfig(where, process.env);
      const report = lint({ wikiPath: where.wiki.path, repoPath: where.repo.path, fix: args.fix, policy: config?.policy ?? null, checkouts: config?.repo.checkouts ?? [], baseBranch: baseBranchOf(config, where.repo.path) });
      if (args.json) console.log(JSON.stringify(report, null, 2));
      else {
        for (const item of report.findings) console.log(`${item.severity} ${item.code} ${item.file}${item.line ? `:${item.line}` : ''}: ${item.message} ${item.remedy}`);
        for (const repair of report.repairs) console.log(`repaired ${repair.code} ${repair.file}; log: ${repair.log}`);
        console.log(`${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.repaired} repairs.`);
      }
      return report.summary.errors ? 1 : 0;
    } else if (cmd === 'detect') {
      console.log(JSON.stringify(detect(resolve(opts)), null, 2));
    } else if (cmd === 'init') {
      console.log(JSON.stringify(initWiki(resolve(opts)), null, 2));
    } else if (cmd === 'bind') {
      console.log(JSON.stringify(bind(resolve(opts)), null, 2));
    } else if (cmd === 'seed') {
      const templates = path.join(pluginRoot, 'templates', 'config');
      console.log(JSON.stringify(seed(resolve(opts), templates, { force: args.force }), null, 2));
    } else if (cmd === 'board') {
      if (args._.length !== 1) throw new ForgeError(`Usage: forge.mjs board [--json] [--dry-run] [--today <YYYY-MM-DD>].`, 'bad-args');
      const where = resolve(opts);
      if (!where.wiki.exists) throw new ForgeError(`No wiki at ${where.wiki.path}. Run the forge-setup skill.`, 'no-wiki');
      let board;
      try { board = writeBoard(where.wiki.path, { today: args.today, dryRun: args.dryRun }); }
      catch (err) { throw new ForgeError(err.message, 'board'); }
      if (args.json) console.log(JSON.stringify(board, null, 2));
      else {
        console.log(board.groups.map((group) => `${group.emoji} ${group.label} ${group.tickets.length}`).join(' · '));
        for (const error of board.errors) console.log(`  read error ${error.folder}: ${error.message}`);
        console.log(`${board.written ? 'wrote' : !board.changed ? 'unchanged' : 'would write'}: ${board.file}`);
      }
    } else if (cmd === 'local-key') {
      if (args._.length !== 1) throw new ForgeError('Usage: forge.mjs local-key [--json].', 'bad-args');
      const where = resolve(opts);
      if (!where.wiki.exists) throw new ForgeError(`No wiki at ${where.wiki.path}. Run the forge-setup skill.`, 'no-wiki');
      let key;
      try { key = nextLocalKey(where.wiki.path); } catch (err) { throw new ForgeError(err.message, 'local-key'); }
      console.log(args.json ? JSON.stringify({ key }) : key);
    } else if (cmd === 'worktree') {
      if (args._.length !== 2 || !args.summary) throw new ForgeError('Usage: forge.mjs worktree <KEY> --summary "<goal>" [--base <ref>] [--create] [--json].', 'bad-args');
      const where = resolve(opts);
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
    } else if (cmd === 'gate-open') {
      if (args._.length < 3) throw new ForgeError('Usage: forge.mjs gate-open <key> <gate> [extra files...] [--dry-run] [--json] [--today <yyyy-mm-dd>].', 'bad-args');
      const where = resolve(opts);
      const loaded = loadConfig(where.configDir);
      const config = loaded.files.length ? loaded.config : null;
      let result;
      try {
        const { dir } = findTicket(where.wiki.path, args._[1]);
        result = openReview(dir, { gate: args._[2], extra: args._.slice(3), policy: config?.policy ?? null, repoPath: where.repo.path, checkouts: config?.repo.checkouts ?? [], baseBranch: baseBranchOf(config, where.repo.path), today: args.today, dryRun: args.dryRun });
      } catch (err) { throw new ForgeError(err.message, 'gate-open'); }
      if (args.json) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(`${result.key} ${result.gate}: in review${args.dryRun ? ' (dry run, nothing written)' : ''}`);
        console.log(`Manifest: ${result.manifest} sha256 ${result.hash}`);
        for (const doc of result.documents) console.log(`- ${doc.path} ${doc.sha256.slice(0, 12)}`);
        if (result.code) console.log(`Code: branch ${result.code.branch} head ${result.code.head} base ${result.code.base} patch-id ${result.code.patchId}`);
        console.log(result.diff);
        if (result.review) console.log(`Open blockers: ${result.review.openBlockers || 'none'}\nConcerns: ${result.review.concerns || 'none'}`);
        for (const note of result.notes) console.log(note);
        console.log(`GO approves this exact set. Approve with: forge.mjs gate-approve ${args._[1]} ${args._[2]} --answer "<the exact answer of the user>" --method form|chat`);
      }
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
    } else {
      console.error('Usage: node forge.mjs <where|config|doctor|lint|detect|init|bind|seed|board|local-key|worktree|gate-open|gate-approve|hook|context> [--wiki <dir>] [--cwd <dir>] [--json]');
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
