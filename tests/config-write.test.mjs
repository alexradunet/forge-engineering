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
import { completeness, credNames, doctor } from '../plugins/forge/scripts/forge.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const plugin = path.join(here, '..', 'plugins', 'forge');
const templates = path.join(plugin, 'templates', 'config');
const cli = path.join(plugin, 'scripts', 'forge.mjs');
let root, app, dir, env;
const read = (f) => readFileSync(path.join(dir, f), 'utf8');
const lf = (s) => s.replace(/\r\n/g, '\n');
const memoryStore = (names) => ({ has: (n) => names.includes(n) });

before(() => {
  root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'forge-config-write-')));
  env = { ...process.env, FORGE_DATA_DIR: path.join(root, 'data') };
  app = path.join(root, 'app');
  mkdirSync(app);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: app });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/owner/app.git'], { cwd: app });
  const where = resolve({ cwd: app, env });
  initWiki(where);
  dir = seed(where, { tracker: 'jira', repo: 'github', ci: 'jenkins' }, templates).configDir;
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
  const r = setValues(dir, ['tracker.host=acme.atlassian.net', 'tracker.prefix=MFD', 'tracker.project=MFD',
    'tracker.itemUrl=https://acme.atlassian.net/browse/{KEY}', 'tracker.board=42', 'repo.branchPattern=feature/{KEY}-{slug}']);
  assert.deepEqual(r.changed.sort(), ['config/repo.md', 'config/tracker.md']);
  const after = read('tracker.md');
  assert.match(after, /^host: acme\.atlassian\.net$/m);
  assert.match(lf(after), /^board: 42\n---\n/m);
  assert.equal(lf(after).split('\n---\n')[1], lf(before).split('\n---\n')[1]);
  const { config } = loadConfig(dir);
  assert.equal(config.tracker.prefix, 'MFD');
  assert.equal(config.repo.branchPattern, 'feature/{KEY}-{slug}');
  assert.deepEqual(setValues(dir, ['tracker.prefix=MFD']).changed, []);
});

test('config set writes nothing when the result is invalid', () => {
  const snapshot = ['tracker.md', 'policy.md'].map(read);
  assert.throws(() => setValues(dir, ['tracker.prefix=APP', 'policy.maxImplementers=0']), (e) => e.code === 'bad-config');
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
  setValues(dir, ['policy.learningMode=true', 'policy.noMergeWeekdays=[Thursday]']);
  const text = readFileSync(file, 'utf8');
  assert.ok(text.startsWith('\uFEFF---\r\n'));
  assert.ok(!/[^\r]\n/.test(text));
  assert.match(text, /^learningMode: true\r$/m);
  const { config } = loadConfig(dir);
  assert.equal(config.policy.learningMode, true);
  assert.deepEqual(config.policy.noMergeWeekdays, ['Thursday']);
  writeFileSync(file, original);
});

test('config row adds, replaces, and deletes table rows', () => {
  let r = upsertRow(dir, 'checkouts', ['midgard', app, 'owner/app']);
  assert.deepEqual(r.changed, ['config/repo.md']);
  r = upsertRow(dir, 'checkouts', ['midgard', app, 'owner/app', 'master']);
  let rows = loadConfig(dir).config.repo.checkouts;
  assert.deepEqual(rows.map((x) => x.name), ['app', 'midgard']);
  assert.equal(rows[1].baseBranch, 'master');
  assert.match(lf(read('repo.md')), /^\| `midgard` \| `.+` \| `owner\/app` \| master \|$/m);
  upsertRow(dir, 'checkouts', ['app'], { remove: true });
  rows = loadConfig(dir).config.repo.checkouts;
  assert.deepEqual(rows.map((x) => x.name), ['midgard']);
  assert.deepEqual(upsertRow(dir, 'checkouts', ['gone'], { remove: true }).changed, []);

  upsertRow(dir, 'queries', ['team', 'project = MFD AND labels = smurfs']);
  upsertRow(dir, 'queries', ['review', 'status = "In Review"']);
  const q = loadConfig(dir).config.tracker.queries;
  assert.equal(q.team, 'project = MFD AND labels = smurfs');
  assert.equal(q.review, 'status = "In Review"');
  assert.match(read('tracker.md'), /## 🔎 Queries[\s\S]*`review`[\s\S]*## 🔐 Auth check/);

  const snapshot = read('tracker.md');
  assert.throws(() => upsertRow(dir, 'queries', ['bad', 'a | b']), (e) => e.code === 'bad-value');
  assert.throws(() => upsertRow(dir, 'queries', ['x', 'y', 'z']), (e) => e.code === 'bad-args');
  assert.throws(() => upsertRow(dir, 'nope', ['x']), (e) => e.code === 'bad-args');
  assert.equal(read('tracker.md'), snapshot);
});

test('completeness reports placeholders, a missing checkout, and credentials', () => {
  const fresh = path.join(root, 'fresh.wiki');
  const cfg = seed({ wiki: { path: fresh } }, { tracker: 'jira', repo: 'github', ci: 'jenkins' }, templates).configDir;
  const found = completeness(cfg, loadConfig(cfg).config, { credStore: memoryStore([]) });
  const text = found.map((f) => `${f.status} ${f.check} ${f.detail}`).join('\n');
  for (const s of ['tracker.host', 'tracker.itemUrl', 'tracker.project is the template value "ABC"', 'ci.host', '"team" query', 'checkout "app" is the template row', 'warn cred:jenkins']) {
    assert.ok(text.includes(s), `missing: ${s}\n${text}`);
  }
  setValues(cfg, ['tracker.host=acme.atlassian.net', 'tracker.project=MFD', 'tracker.prefix=MFD', 'tracker.itemUrl=https://acme.atlassian.net/browse/{KEY}', 'ci.host=https://ci.acme.dev']);
  upsertRow(cfg, 'queries', ['team', 'project = MFD']);
  upsertRow(cfg, 'checkouts', ['app'], { remove: true });
  upsertRow(cfg, 'checkouts', ['gone', path.join(root, 'missing'), 'acme/app']);
  const after = completeness(cfg, loadConfig(cfg).config, { credStore: memoryStore(['jenkins']) });
  assert.deepEqual(after.map((f) => `${f.status} ${f.check}`), ['warn config:checkouts', 'ok cred:jenkins']);
  upsertRow(cfg, 'checkouts', ['gone'], { remove: true });
  assert.ok(completeness(cfg, loadConfig(cfg).config, { credStore: memoryStore(['jenkins']) }).some((f) => /no Checkouts row/.test(f.detail)));
});

test('credNames reads cred.mjs set and --cred names, not placeholders', () => {
  assert.deepEqual(credNames(['run `node "<plugin>/scripts/cred.mjs" set jenkins`', 'add `--host <url> --cred <name>`', '<J> status x --cred jenkins-cloud']).sort(), ['jenkins', 'jenkins-cloud']);
});

test('doctor includes completeness checks', () => {
  const results = doctor({ cwd: app, env, credStore: memoryStore([]) });
  assert.ok(results.some((r) => r.check === 'cred:jenkins' && r.status === 'warn'));
  assert.ok(results.some((r) => r.check === 'config:placeholder'));
});

test('CLI config set and row print the changed files and fail without writing', () => {
  const ok = spawnSync(process.execPath, [cli, 'config', 'set', 'repo.baseBranch=develop'], { cwd: app, env, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout).changed, ['config/repo.md']);
  const row = spawnSync(process.execPath, [cli, 'config', 'row', 'queries', 'mine', '--assignee=@me', '--wiki', path.join(root, 'app.wiki')], { cwd: app, env, encoding: 'utf8' });
  assert.equal(row.status, 0, row.stderr);
  assert.equal(loadConfig(dir).config.tracker.queries.mine, '--assignee=@me');
  const bad = spawnSync(process.execPath, [cli, 'config', 'set', 'repo.changeName=XR'], { cwd: app, env, encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /changeName must be PR or MR/);
  assert.equal(loadConfig(dir).config.repo.baseBranch, 'develop');
  assert.ok(existsSync(path.join(dir, 'repo.md')));
});
