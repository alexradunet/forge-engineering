#!/usr/bin/env node
// forge command line. Run with an absolute path, for example:
//   node "<plugin>/scripts/forge.mjs" where
// Commands:
//   where   [--wiki <dir>]   the repository, its wiki, and the config folder (JSON)
//   config  [--wiki <dir>]   the team config (JSON)
//   doctor  [--wiki <dir>] [--json]   read-only setup check; exit 1 on a failure
//   detect  [--wiki <dir>]   host, CLIs and login, repo visibility, wiki state (JSON, read-only)
//   init-wiki [--wiki <dir>] create the local wiki (git init, .gitignore, index.md) and bind it
//   bind    [--wiki <dir>]   write <wiki>/forge/repo.json
//   seed --tracker <t> --repo <r> --ci <c> [--force]   copy templates to <wiki>/forge/config
//   trust [approve <path>=<sha>...]   show or approve the files under <wiki>/forge
//   pack add <source> [--force] | pack update [<source>] | pack status
//   run <script> [args...]   run <wiki>/forge/scripts/<script>.mjs after the trust check
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve, ForgeError } from './lib/repo.mjs';
import { loadConfig, KINDS } from './lib/config.mjs';
import { detect, initWiki, bind, seed } from './lib/setup.mjs';
import { approve, assertTrusted, status as trustStatus } from './lib/trust.mjs';
import { add as packAdd, update as packUpdate, readLock } from './lib/pack.mjs';

const pluginRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI_FOR = { github: 'gh', 'github-actions': 'gh', gitlab: 'glab', 'gitlab-ci': 'glab', jira: 'acli', 'azure-pipelines': 'az' };

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--wiki') out.wiki = argv[++i];
    else if (a === '--cwd') out.cwd = argv[++i];
    else if (a === '--force') out.force = true;
    else if (['--tracker', '--repo', '--ci'].includes(a)) out[a.slice(2)] = argv[++i];
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
  const st = trustStatus(where, { env });
  const bad = st.files.filter((f) => f.state !== 'ok');
  add('trust', bad.length ? 'fail' : 'ok', bad.length ? `Not approved: ${bad.map((f) => `${f.rel} (${f.state})`).join(', ')}. Run "forge.mjs trust".` : `${st.files.length} files approved`);
  const lock = readLock(where);
  if (lock) add('pack', 'ok', `${lock.name} ${lock.version}`);
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
  if (!existsSync(file)) throw new ForgeError(`No pack script: ${file}`, 'no-script');
  assertTrusted(where, ['scripts/', 'config/'], { env });
  const r = spawnSync(process.execPath, [file, ...rest], {
    cwd,
    stdio: 'inherit',
    env: { ...env, FORGE_CORE: path.join(pluginRoot, 'scripts'), FORGE_WIKI: where.wiki.path, FORGE_REPO: where.repo.path },
  });
  return r.status ?? 1;
}

export function main(argv = process.argv.slice(2)) {
  if (argv[0] === 'run') {
    try {
      return runScript(argv[1], argv.slice(2));
    } catch (err) {
      if (err instanceof ForgeError) { console.error(`forge: ${err.message}`); return 1; }
      throw err;
    }
  }
  const args = parseArgs(argv);
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
      const results = doctor(opts);
      if (args.json) console.log(JSON.stringify(results, null, 2)); else print(results);
      return results.some((r) => r.status === 'fail') ? 1 : 0;
    } else if (cmd === 'detect') {
      console.log(JSON.stringify(detect(resolve(opts)), null, 2));
    } else if (cmd === 'init-wiki') {
      console.log(JSON.stringify(initWiki(resolve(opts)), null, 2));
    } else if (cmd === 'bind') {
      console.log(JSON.stringify(bind(resolve(opts)), null, 2));
    } else if (cmd === 'seed') {
      const templates = path.join(pluginRoot, 'templates', 'config');
      console.log(JSON.stringify(seed(resolve(opts), { tracker: args.tracker, repo: args.repo, ci: args.ci }, templates, { force: args.force }), null, 2));
    } else if (cmd === 'trust') {
      const where = resolve(opts);
      if (args._[1] === 'approve') console.log(JSON.stringify(approve(where, args._.slice(2)), null, 2));
      else console.log(JSON.stringify(trustStatus(where), null, 2));
    } else if (cmd === 'pack') {
      const where = resolve(opts);
      const sub = args._[1];
      if (sub === 'add' && args._[2]) console.log(JSON.stringify(packAdd(where, args._[2], { force: args.force }), null, 2));
      else if (sub === 'update') console.log(JSON.stringify(packUpdate(where, args._[2]), null, 2));
      else if (sub === 'status') console.log(JSON.stringify(readLock(where), null, 2));
      else throw new ForgeError('Usage: forge.mjs pack add <source> [--force] | pack update [<source>] | pack status', 'bad-args');
    } else {
      console.error('Usage: node forge.mjs <where|config|doctor|detect|init-wiki|bind|seed|trust|pack|run> [--wiki <dir>] [--cwd <dir>] [--json]');
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
