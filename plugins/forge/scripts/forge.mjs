#!/usr/bin/env node
// forge command line. Run with an absolute path, for example:
//   node "<plugin>/scripts/forge.mjs" where
// Commands:
//   where   [--wiki <dir>]   the repository, its wiki, and the config folder (JSON)
//   config  [--wiki <dir>]   the team config (JSON)
//   doctor  [--wiki <dir>] [--json]   read-only setup check; exit 1 on a failure
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve, ForgeError } from './lib/repo.mjs';
import { loadConfig, KINDS } from './lib/config.mjs';

const pluginRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI_FOR = { github: 'gh', 'github-actions': 'gh', gitlab: 'glab', 'gitlab-ci': 'glab', jira: 'acli', 'azure-pipelines': 'az' };

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--wiki') out.wiki = argv[++i];
    else if (a === '--cwd') out.cwd = argv[++i];
    else out._.push(a);
  }
  return out;
}

export function onPath(cmd, env = process.env) {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  return dirs.some((d) => exts.some((e) => existsSync(path.join(d, cmd + e.toLowerCase())) || existsSync(path.join(d, cmd + e))));
}

export function doctor({ cwd, wiki, env = process.env } = {}) {
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
  add('wiki', where.wiki.exists ? 'ok' : 'fail', where.wiki.exists ? `${where.wiki.path} (${where.wiki.source})` : `Not found: ${where.wiki.path}. Run the forge-setup skill.`);
  if (where.wiki.exists) add('wiki:binding', where.wiki.bound ? 'ok' : 'warn', where.wiki.bound ? 'forge/repo.json' : 'No forge/repo.json. Run the forge-setup skill.');
  for (const w of where.warnings.filter((x) => !x.includes('has no forge/repo.json'))) add('warning', 'warn', w);
  if (!where.wiki.exists) return results;

  try {
    const { config } = loadConfig(where.configDir);
    for (const kind of KINDS) {
      const file = path.join(where.configDir, `${kind}.md`);
      if (!existsSync(file)) { add(`config:${kind}.md`, 'warn', 'Missing. forge uses the defaults. Run the forge-setup skill.'); continue; }
      const provider = config[kind].provider;
      add(`config:${kind}.md`, 'ok', provider ? `provider: ${provider}` : '');
      const tool = CLI_FOR[provider];
      if (tool && !onPath(tool, env)) add(`config:${kind}.md`, 'warn', `${tool} is not on PATH. The ${provider} commands need it.`);
    }
  } catch (err) {
    add('config', 'fail', err.message);
  }
  return results;
}

function print(results) {
  const w = Math.max(...results.map((r) => r.check.length));
  for (const r of results) console.log(`${r.status.padEnd(4)}  ${r.check.padEnd(w)}  ${r.detail}`);
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const [cmd] = args._;
  const opts = { cwd: args.cwd ?? process.cwd(), wiki: args.wiki };
  try {
    if (cmd === 'where') {
      console.log(JSON.stringify(resolve(opts), null, 2));
    } else if (cmd === 'config') {
      const where = resolve(opts);
      console.log(JSON.stringify({ ...loadConfig(where.configDir), warnings: where.warnings }, null, 2));
    } else if (cmd === 'doctor') {
      const results = doctor(opts);
      if (args.json) console.log(JSON.stringify(results, null, 2)); else print(results);
      return results.some((r) => r.status === 'fail') ? 1 : 0;
    } else {
      console.error('Usage: node forge.mjs <where|config|doctor> [--wiki <dir>] [--cwd <dir>] [--json]');
      return 2;
    }
    return 0;
  } catch (err) {
    if (err instanceof ForgeError) { console.error(`forge: ${err.message}`); return 1; }
    throw err;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
