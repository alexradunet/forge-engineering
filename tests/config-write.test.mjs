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
import { completeness, doctor } from '../plugins/forge/scripts/forge.mjs';
import { KINDS } from '../plugins/forge/scripts/lib/config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const plugin = path.join(here, '..', 'plugins', 'forge');
const templates = path.join(plugin, 'templates', 'config');
const cli = path.join(plugin, 'scripts', 'forge.mjs');
let root, app, dir, env;
const read = (f) => readFileSync(path.join(dir, f), 'utf8');
const lf = (s) => s.replace(/\r\n/g, '\n');
// The tests read the expected values from the templates.
const template = () => loadConfig(templates).config;

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
  const before = read('repo.md');
  const r = setValues(dir, ['repo.baseBranch=develop', 'repo.note=hello', 'repo.branchPattern=feature/{KEY}-{slug}']);
  assert.deepEqual(r.changed, ['config/repo.md']);
  const after = read('repo.md');
  assert.match(after, /^baseBranch: develop$/m);
  assert.match(lf(after), /^note: hello\n---\n/m);
  assert.equal(lf(after).split('\n---\n')[1], lf(before).split('\n---\n')[1]);
  const { config } = loadConfig(dir);
  assert.equal(config.repo.baseBranch, 'develop');
  assert.equal(config.repo.branchPattern, 'feature/{KEY}-{slug}');
  assert.deepEqual(setValues(dir, ['repo.baseBranch=develop']).changed, []);
});

test('config set writes nothing when the result is invalid', () => {
  const snapshot = ['repo.md', 'policy.md'].map(read);
  assert.throws(() => setValues(dir, ['repo.baseBranch=other', 'policy.maxImplementers=0']), (e) => e.code === 'bad-config');
  assert.throws(() => setValues(dir, ['repo.branchPattern=nokey']), /branchPattern must contain/);
  assert.throws(() => setValues(dir, ['nope.key=1']), (e) => e.code === 'bad-args');
  assert.throws(() => setValues(dir, ['tracker.prefix=APP']), (e) => e.code === 'bad-args' && /Unknown config file "tracker"/.test(e.message));
  assert.throws(() => setValues(dir, ['repo.bad key=1']), (e) => e.code === 'bad-args');
  assert.throws(() => setValues(dir, ['prefix=APP']), (e) => e.code === 'bad-args');
  assert.deepEqual(['repo.md', 'policy.md'].map(read), snapshot);
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

  const snapshot = read('repo.md');
  assert.throws(() => upsertRow(dir, 'checkouts', ['bad', 'a | b']), (e) => e.code === 'bad-value');
  assert.throws(() => upsertRow(dir, 'checkouts', ['x', 'y', 'z', 'w', 'v']), (e) => e.code === 'bad-args');
  assert.throws(() => upsertRow(dir, 'queries', ['x']), (e) => e.code === 'bad-args');
  assert.throws(() => upsertRow(dir, 'nope', ['x']), (e) => e.code === 'bad-args');
  assert.equal(read('repo.md'), snapshot);
});

test('completeness reports the user placeholder and a missing checkout', () => {
  const fresh = path.join(root, 'fresh.wiki');
  const cfg = seed({ wiki: { path: fresh } }, templates).configDir;
  setValues(cfg, ['repo.branchPattern=users/<user>/{KEY}-{slug}']);
  const found = completeness(cfg, loadConfig(cfg).config);
  const text = found.map((f) => `${f.status} ${f.check} ${f.detail}`).join('\n');
  for (const part of ['repo.branchPattern is the template value "users/<user>/{KEY}-{slug}"', 'repo.branchPattern=users/<your name>/{KEY}-{slug}']) {
    assert.ok(text.includes(part), `missing: ${part}\n${text}`);
  }
  setValues(cfg, ['repo.branchPattern=users/alex/{KEY}-{slug}']);
  for (const row of template().repo.checkouts) upsertRow(cfg, 'checkouts', [row.name], { remove: true });
  upsertRow(cfg, 'checkouts', ['shop', path.join(root, 'missing'), 'acme/shop']);
  const after = completeness(cfg, loadConfig(cfg).config);
  assert.deepEqual(after.map((f) => `${f.status} ${f.check}`), ['warn config:checkouts']);
  upsertRow(cfg, 'checkouts', ['shop'], { remove: true });
  assert.ok(completeness(cfg, loadConfig(cfg).config).some((f) => /no Checkouts row/.test(f.detail)));
});

test('doctor includes completeness checks', () => {
  setValues(dir, ['repo.branchPattern=users/<user>/{KEY}-{slug}']);
  const results = doctor({ cwd: app, env });
  assert.ok(results.some((r) => r.check === 'config:placeholder'));
  assert.ok(!results.some((r) => /^cred:|^mcp:|^profile$|login/.test(r.check)));
});

test('CLI config set and row print the changed files and fail without writing', () => {
  const ok = spawnSync(process.execPath, [cli, 'config', 'set', 'repo.baseBranch=release'], { cwd: app, env, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout).changed, ['config/repo.md']);
  const row = spawnSync(process.execPath, [cli, 'config', 'row', 'checkouts', 'mine', app, 'owner/app', '--wiki', path.join(root, 'app.forge', 'wiki')], { cwd: app, env, encoding: 'utf8' });
  assert.equal(row.status, 0, row.stderr);
  assert.equal(loadConfig(dir).config.repo.checkouts.find((c) => c.name === 'mine').remote, 'owner/app');
  const bad = spawnSync(process.execPath, [cli, 'config', 'set', 'repo.changeName=XR'], { cwd: app, env, encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /changeName must be PR, MR, or none/);
  assert.equal(loadConfig(dir).config.repo.baseBranch, 'release');
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
