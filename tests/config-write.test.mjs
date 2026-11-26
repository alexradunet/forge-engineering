import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from '../plugins/forge/scripts/lib/repo.mjs';
import { initWiki, seed } from '../plugins/forge/scripts/lib/setup.mjs';
import { loadConfig } from '../plugins/forge/scripts/lib/config.mjs';
import { formatValue, setValues, upsertRow } from '../plugins/forge/scripts/lib/config-write.mjs';
import { completeness, credNames, doctor, mcpGateway } from '../plugins/forge/scripts/forge.mjs';
import { KINDS } from '../plugins/forge/scripts/lib/config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const plugin = path.join(here, '..', 'plugins', 'forge');
const templates = path.join(plugin, 'templates', 'config');
const cli = path.join(plugin, 'scripts', 'forge.mjs');
let root, app, dir, env;
const read = (f) => readFileSync(path.join(dir, f), 'utf8');
const lf = (s) => s.replace(/\r\n/g, '\n');
const memoryStore = (names) => ({ has: (n) => names.includes(n) });
// The tests read the expected values from the profile templates, so they pass with each profile.
const template = () => loadConfig(templates).config;
const templateCreds = () => credNames(KINDS.map((k) => path.join(templates, `${k}.md`)).filter(existsSync).map((f) => readFileSync(f, 'utf8'))).sort();

before(() => {
  root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'forge-config-write-')));
  env = { ...process.env, FORGE_DATA_DIR: path.join(root, 'data') };
  app = path.join(root, 'app');
  mkdirSync(app);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: app });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/owner/app.git'], { cwd: app });
  const where = resolve({ cwd: app, env });
  initWiki(where);
  dir = seed(where, templates).configDir;
});
after(() => rmSync(root, { recursive: true, force: true }));

test('formatValue quotes a leading brace and rejects line breaks', () => {
  assert.equal(formatValue('{KEY}-{slug}'), '"{KEY}-{slug}"');
  assert.equal(formatValue(' [Thursday] '), '[Thursday]');
  assert.equal(formatValue(''), '');
  assert.throws(() => formatValue('a\nb'), (e) => e.code === 'bad-value');
});

test('config set replaces and adds keys, keeps the body, and validates', () => {
  const before = read('tracker.md');
  const r = setValues(dir, ['tracker.host=jira.example.com', 'tracker.prefix=APP', 'tracker.project=APP',
    'tracker.itemUrl=https://jira.example.com/browse/{KEY}', 'tracker.board=42', 'repo.branchPattern=feature/{KEY}-{slug}']);
  assert.deepEqual(r.changed.sort(), ['config/repo.md', 'config/tracker.md']);
  const after = read('tracker.md');
  assert.match(after, /^host: jira\.example\.com$/m);
  assert.match(lf(after), /^board: 42\n---\n/m);
  assert.equal(lf(after).split('\n---\n')[1], lf(before).split('\n---\n')[1]);
  const { config } = loadConfig(dir);
  assert.equal(config.tracker.prefix, 'APP');
  assert.equal(config.repo.branchPattern, 'feature/{KEY}-{slug}');
  assert.deepEqual(setValues(dir, ['tracker.prefix=APP']).changed, []);
});

test('config set writes nothing when the result is invalid', () => {
  const snapshot = ['tracker.md', 'policy.md'].map(read);
  assert.throws(() => setValues(dir, ['tracker.prefix=OPS', 'policy.maxImplementers=0']), (e) => e.code === 'bad-config');
  assert.throws(() => setValues(dir, ['tracker.prefix=lower']), /upper case/);
  assert.throws(() => setValues(dir, ['nope.key=1']), (e) => e.code === 'bad-args');
  assert.throws(() => setValues(dir, ['tracker.bad key=1']), (e) => e.code === 'bad-args');
  assert.throws(() => setValues(dir, ['prefix=APP']), (e) => e.code === 'bad-args');
  assert.deepEqual(['tracker.md', 'policy.md'].map(read), snapshot);
});

test('config set keeps CRLF line endings and a BOM', () => {
  const file = path.join(dir, 'policy.md');
  const original = readFileSync(file, 'utf8');
  writeFileSync(file, `\uFEFF${original.replace(/\r?\n/g, '\r\n')}`);
  setValues(dir, ['policy.qaHandover=true', 'policy.noMergeWeekdays=[Thursday]']);
  const text = readFileSync(file, 'utf8');
  assert.ok(text.startsWith('\uFEFF---\r\n'));
  assert.ok(!/[^\r]\n/.test(text));
  assert.match(text, /^qaHandover: true\r$/m);
  const { config } = loadConfig(dir);
  assert.equal(config.policy.qaHandover, true);
  assert.deepEqual(config.policy.noMergeWeekdays, ['Thursday']);
  writeFileSync(file, original);
});

test('config row adds, replaces, and deletes table rows', () => {
  let r = upsertRow(dir, 'checkouts', ['lib', app, 'owner/app']);
  assert.deepEqual(r.changed, ['config/repo.md']);
  r = upsertRow(dir, 'checkouts', ['lib', app, 'owner/app', 'master']);
  let rows = loadConfig(dir).config.repo.checkouts;
  const names = template().repo.checkouts.map((x) => x.name);
  assert.deepEqual(rows.map((x) => x.name), [...names, 'lib']);
  assert.equal(rows.at(-1).baseBranch, 'master');
  assert.match(lf(read('repo.md')), /^\| `lib` \| `.+` \| `owner\/app` \| master \|$/m);
  for (const name of names) upsertRow(dir, 'checkouts', [name], { remove: true });
  rows = loadConfig(dir).config.repo.checkouts;
  assert.deepEqual(rows.map((x) => x.name), ['lib']);
  assert.deepEqual(upsertRow(dir, 'checkouts', ['gone'], { remove: true }).changed, []);

  upsertRow(dir, 'queries', ['team', 'project = APP AND labels = core']);
  upsertRow(dir, 'queries', ['review', 'status = "In Review"']);
  const q = loadConfig(dir).config.tracker.queries;
  assert.equal(q.team, 'project = APP AND labels = core');
  assert.equal(q.review, 'status = "In Review"');
  assert.match(read('tracker.md'), /## 🔎 Queries[\s\S]*`review`[\s\S]*## 🔐 Auth check/);

  const snapshot = read('tracker.md');
  assert.throws(() => upsertRow(dir, 'queries', ['bad', 'a | b']), (e) => e.code === 'bad-value');
  assert.throws(() => upsertRow(dir, 'queries', ['x', 'y', 'z']), (e) => e.code === 'bad-args');
  assert.throws(() => upsertRow(dir, 'nope', ['x']), (e) => e.code === 'bad-args');
  assert.equal(read('tracker.md'), snapshot);
});

test('completeness reports the user placeholder, a missing checkout, and credentials', () => {
  const fresh = path.join(root, 'fresh.wiki');
  const cfg = seed({ wiki: { path: fresh } }, templates).configDir;
  setValues(cfg, ['repo.branchPattern=users/<user>/{KEY}-{slug}']);
  const creds = templateCreds();
  const found = completeness(cfg, loadConfig(cfg).config, { credStore: memoryStore([]) });
  const text = found.map((f) => `${f.status} ${f.check} ${f.detail}`).join('\n');
  for (const s of ['repo.branchPattern is the template value "users/<user>/{KEY}-{slug}"', 'repo.branchPattern=users/<your name>/{KEY}-{slug}', ...creds.map((n) => `warn cred:${n} `)]) {
    assert.ok(text.includes(s), `missing: ${s}\n${text}`);
  }
  setValues(cfg, ['repo.branchPattern=users/alex/{KEY}-{slug}']);
  for (const row of template().repo.checkouts) upsertRow(cfg, 'checkouts', [row.name], { remove: true });
  upsertRow(cfg, 'checkouts', ['shop', path.join(root, 'missing'), 'acme/shop']);
  const after = completeness(cfg, loadConfig(cfg).config, { credStore: memoryStore(creds) });
  assert.deepEqual(after.map((f) => `${f.status} ${f.check}`).sort(), [...creds.map((n) => `ok cred:${n}`), 'warn config:checkouts']);
  upsertRow(cfg, 'checkouts', ['shop'], { remove: true });
  assert.ok(completeness(cfg, loadConfig(cfg).config, { credStore: memoryStore(creds) }).some((f) => /no Checkouts row/.test(f.detail)));
});

test('credNames reads cred.mjs set and --cred names, not placeholders', () => {
  assert.deepEqual(credNames(['run `node "<plugin>/scripts/cred.mjs" set jenkins`', 'add `--host <url> --cred <name>`', '<J> status x --cred jenkins-cloud']).sort(), ['jenkins', 'jenkins-cloud']);
});

test('doctor includes completeness checks', () => {
  setValues(dir, ['repo.branchPattern=users/<user>/{KEY}-{slug}']);
  const results = doctor({ cwd: app, env, credStore: memoryStore([]) });
  for (const n of templateCreds()) assert.ok(results.some((r) => r.check === `cred:${n}` && r.status === 'warn'), n);
  assert.ok(results.some((r) => r.check === 'config:placeholder'));
});

test('mcpGateway finds each profile server once by URL in forge, repo, and user files, and flags a retired URL', () => {
  const repo = path.join(root, 'mcp-repo');
  const home = path.join(root, 'mcp-home');
  const plugin = path.join(root, 'mcp-plugin');
  for (const d of [repo, home, plugin]) mkdirSync(d, { recursive: true });
  const env2 = { COPILOT_HOME: home };
  const url = (n) => `https://mcp.example.com/${n}`;
  const profile = {
    mcpServers: ['docs', 'search', 'chat'].map((name) => ({ name, url: url(name) })),
    mcpRetired: [{ url: url('docs/mcp'), use: url('docs') }],
  };
  const gateway = () => mcpGateway({ repoPath: repo, env: env2, plugin, profile });
  const status = (r) => Object.fromEntries(r.map((f) => [f.check, f.status]));
  assert.ok(gateway().every((f) => f.status === 'warn'));

  writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: {
    search: { type: 'http', url: `${url('search')}/` },
    old: { type: 'http', url: url('docs/mcp') },
  } }));
  writeFileSync(path.join(plugin, 'mcp.json'), JSON.stringify({ mcpServers: { docs: { type: 'streamable-http', url: url('docs') }, chat: { type: 'streamable-http', url: url('chat') } } }));
  const one = gateway();
  assert.deepEqual(status(one), { 'mcp:docs': 'ok', 'mcp:search': 'ok', 'mcp:chat': 'ok', 'mcp:retired': 'warn' });
  assert.match(one.find((f) => f.check === 'mcp:retired').detail, /"old".+Disable "old"/);

  writeFileSync(path.join(home, 'mcp-config.json'), JSON.stringify({ mcpServers: { c: { type: 'http', url: url('chat') } } }));
  const dup = gateway();
  assert.deepEqual(status(dup), { 'mcp:docs': 'ok', 'mcp:search': 'ok', 'mcp:chat': 'warn', 'mcp:retired': 'warn' });
  assert.match(dup.find((f) => f.check === 'mcp:chat').detail, /Two entries: forge and "c"/);

  writeFileSync(path.join(home, 'mcp-config.json'), '{ not json');
  assert.ok(gateway().some((f) => f.check === 'mcp:config' && f.status === 'warn'));

  const main = { ...profile, mcpServers: [{ name: 'repo-only', url: url('repo-only') }], mainCheckout: { name: 'app', remote: 'Acme/App' } };
  const repoOnly = (repoRemote) => mcpGateway({ repoPath: repo, repoRemote, env: env2, plugin, profile: main }).find((f) => f.check === 'mcp:repo-only');
  assert.equal(repoOnly('git@github.com:acme/app.git').status, 'warn');
  assert.equal(repoOnly('https://github.com/acme/other').status, 'ok');
  assert.match(repoOnly('https://github.com/acme/other').detail, /Not in this repository\. The Acme\/App \.mcp\.json gives it/);
});

test('CLI config set and row print the changed files and fail without writing', () => {
  const ok = spawnSync(process.execPath, [cli, 'config', 'set', 'repo.baseBranch=develop'], { cwd: app, env, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout).changed, ['config/repo.md']);
  const row = spawnSync(process.execPath, [cli, 'config', 'row', 'queries', 'mine', '--assignee=@me', '--wiki', path.join(root, 'app.forge', 'wiki')], { cwd: app, env, encoding: 'utf8' });
  assert.equal(row.status, 0, row.stderr);
  assert.equal(loadConfig(dir).config.tracker.queries.mine, '--assignee=@me');
  const bad = spawnSync(process.execPath, [cli, 'config', 'set', 'repo.changeName=XR'], { cwd: app, env, encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /changeName must be PR or MR/);
  assert.equal(loadConfig(dir).config.repo.baseBranch, 'develop');
  assert.ok(existsSync(path.join(dir, 'repo.md')));
});

test('each team size command of the setup skill passes setValues on a copy of the template policy, and the config loads with those values', () => {
  const skill = readFileSync(path.join(plugin, 'skills', 'forge-setup', 'SKILL.md'), 'utf8');
  for (const size of ['small', 'large']) {
    const line = skill.split(/\r?\n/).find((text) => text.startsWith(`- ${size}: `));
    const template = /config set ((?:"policy\.[A-Za-z]+=[^"]*" ?)+)`/.exec(line)[1];
    for (const style of ['true', 'false']) {
      const args = [...template.matchAll(/"([^"]+)"/g)].map((m) => m[1].replace('<true|false>', style));
      assert.equal(args.length, 5, size);
      const copy = mkdtempSync(path.join(root, 'preset-'));
      for (const kind of KINDS) writeFileSync(path.join(copy, `${kind}.md`), readFileSync(path.join(templates, `${kind}.md`)));
      setValues(copy, args);
      const policy = loadConfig(copy).config.policy;
      const wanted = Object.fromEntries(args.map((arg) => { const [key, value] = arg.replace(/^policy\./, '').split('='); return [key, value === 'true' ? true : value === 'false' ? false : value]; }));
      assert.equal(wanted.styleRules, style === 'true');
      for (const [key, value] of Object.entries(wanted)) assert.equal(policy[key], value, `${size} ${style} ${key}`);
    }
  }
});
