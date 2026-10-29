#!/usr/bin/env node
// forge command line. Run with an absolute path, for example:
//   node "<plugin>/scripts/forge.mjs" where
// Commands:
//   where   [--wiki <dir>]   the repository, its wiki, and the config folder (JSON)
//   config  [--wiki <dir>]   the team config (JSON)
//   config set <file>.<key>=<value> ...   set frontmatter values (validated; writes nothing on a problem)
//   config row <checkouts|queries> <name> [cells...] [--delete]   add, replace, or delete a table row
//   doctor  [--wiki <dir>] [--json]   read-only setup check; exit 1 on a failure
//   lint    [--wiki <dir>] [--json] [--fix]   validate tickets, approvals and wiki metadata
//   detect  [--wiki <dir>] [--tracker <t>] [--repo <r>] [--ci <c>]   host, CLIs, login, inferred values (JSON, read-only)
//   init-wiki [--wiki <dir>] create the local wiki (git init, .gitignore, index.md) and bind it
//   bind    [--wiki <dir>]   write <wiki>/forge/repo.json
//   seed --tracker <t> --repo <r> --ci <c> [--force]   copy templates to <wiki>/forge/config
//   trust [approve <path>=<sha>...]   show or approve the files under <wiki>/forge
//   run <script> [args...]   run <wiki>/forge/scripts/<script>.mjs after the trust check
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve, ForgeError } from './lib/repo.mjs';
import { loadConfig, KINDS } from './lib/config.mjs';
import { setValues, upsertRow } from './lib/config-write.mjs';
import { createStore } from './lib/cred.mjs';
import { detect, initWiki, bind, seed, TEMPLATE_KINDS } from './lib/setup.mjs';
import { approve, assertTrusted, status as trustStatus } from './lib/trust.mjs';
import { lint } from './lib/validation.mjs';

const pluginRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI_FOR = { github: 'gh', 'github-actions': 'gh', gitlab: 'glab', 'gitlab-ci': 'glab', jira: 'acli', 'azure-pipelines': 'az' };

// Template values that a team must replace. [file, key, pattern].
const PLACEHOLDERS = [
  ['tracker', 'host', /(^|\.)example\.atlassian\.net$/],
  ['tracker', 'project', /^(owner|group)\/app$/],
  ['tracker', 'itemUrl', /example\.atlassian\.net|\/(owner|group)\/app\//],
  ['ci', 'host', /jenkins\.example\.com|dev\.azure\.com\/example\/?$/],
  ['ci', 'project', /^Example$/],
];
const PLACEHOLDER_QUERIES = /label:"team-a"|team::core|"Team A"|project = ABC\b/;
const PLACEHOLDER_CHECKOUT = { path: 'C:\\dev\\app', remote: /^(owner|group)\/app$/ };

/** Credential names that the config names: "cred.mjs set <name>" and "--cred <name>". */
export function credNames(texts) {
  const names = new Set();
  for (const t of texts) {
    for (const m of t.matchAll(/cred\.mjs"?\s+set\s+([A-Za-z0-9][\w.-]*)|--cred\s+([A-Za-z0-9][\w.-]*)/g)) names.add(m[1] ?? m[2]);
  }
  return [...names];
}

/** Setup completeness: template placeholders, checkout paths, and credentials. */
export function completeness(configDir, config, { credStore } = {}) {
  const found = [];
  const add = (check, detail) => found.push({ status: 'warn', check, detail });
  for (const [kind, key, re] of PLACEHOLDERS) {
    const v = config[kind][key];
    if (typeof v === 'string' && re.test(v)) add(`config:placeholder`, `${kind}.${key} is the template value "${v}". Set it: forge.mjs config set ${kind}.${key}=<value>.`);
  }
  if (config.tracker.provider === 'jira' && config.tracker.project === 'ABC') add('config:placeholder', 'tracker.project is the template value "ABC". Set your Jira project key.');
  for (const [name, q] of Object.entries(config.tracker.queries)) {
    if (q && PLACEHOLDER_QUERIES.test(q)) add('config:placeholder', `The "${name}" query is a template example: ${q}. Set it: forge.mjs config row queries ${name} "<query>".`);
  }
  for (const row of config.repo.checkouts) {
    if (row.path === PLACEHOLDER_CHECKOUT.path || PLACEHOLDER_CHECKOUT.remote.test(row.remote ?? '')) {
      add('config:placeholder', `The checkout "${row.name}" is the template row. Replace it: forge.mjs config row checkouts <name> <path> <remote>, then config row checkouts ${row.name} --delete.`);
    }
  }
  const main = config.repo.checkouts[0];
  if (!main) add('config:checkouts', 'repo.md has no Checkouts row. Add the main checkout: forge.mjs config row checkouts <name> <path> <remote>.');
  else if (main.path !== PLACEHOLDER_CHECKOUT.path && !existsSync(main.path)) add('config:checkouts', `The main checkout ${main.path} does not exist on this machine. Clone it there, or change the row for this machine.`);

  const texts = KINDS.map((k) => path.join(configDir, `${k}.md`)).filter(existsSync).map((f) => readFileSync(f, 'utf8'));
  const names = credNames(texts);
  if (config.ci.provider === 'jenkins' && !names.includes('jenkins')) names.unshift('jenkins');
  for (const name of names) {
    let has = null;
    try { has = (credStore ?? createStore()).has(name); } catch (err) { add(`cred:${name}`, `Cannot check the credential store: ${err.message}`); continue; }
    found.push(has
      ? { status: 'ok', check: `cred:${name}`, detail: 'stored' }
      : { status: 'warn', check: `cred:${name}`, detail: `Not stored. The user runs: node "<plugin>/scripts/cred.mjs" set ${name}` });
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
    else if (a === '--fix') out.fix = true;
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

export function doctor({ cwd, wiki, env = process.env, credStore } = {}) {
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
    results.push(...completeness(where.configDir, config, { credStore }));
  } catch (err) {
    add('config', 'fail', err.message);
  }
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

export function main(argv = process.argv.slice(2)) {
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
    } else if (cmd === 'lint') {
      if (args._.length !== 1 || args.force || args.tracker || args.repo || args.ci
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
      const choice = {};
      for (const kind of Object.keys(TEMPLATE_KINDS)) {
        if (args[kind] === undefined) continue;
        if (!TEMPLATE_KINDS[kind].includes(args[kind])) throw new ForgeError(`Unknown ${kind} "${args[kind]}". Use one of: ${TEMPLATE_KINDS[kind].join(', ')}.`, 'bad-choice');
        choice[kind] = args[kind];
      }
      console.log(JSON.stringify(detect(resolve(opts), { choice }), null, 2));
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
    } else {
      console.error('Usage: node forge.mjs <where|config|doctor|lint|detect|init-wiki|bind|seed|trust|run> [--wiki <dir>] [--cwd <dir>] [--json]');
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
