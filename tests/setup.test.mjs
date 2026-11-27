import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAUNCHER_CMD, LAUNCHER_SH, readPointer } from '../plugins/forge/scripts/lib/launcher.mjs';
import { readBinding, resolve } from '../plugins/forge/scripts/lib/repo.mjs';
import { detect, hostKind, initWiki, bind, seed, keyHints, branchPatternHint, suggestValues } from '../plugins/forge/scripts/lib/setup.mjs';
import { loadConfig, parseFile } from '../plugins/forge/scripts/lib/config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const templates = path.join(here, '..', 'plugins', 'forge', 'templates', 'config');
let root, app;
const env = {};

before(() => {
  root = realpathSync.native(mkdtempSync(path.join(here, '.forge-setup-')));
  app = path.join(root, 'app');
  mkdirSync(app);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: app });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/owner/app.git'], { cwd: app });
});
after(() => rmSync(root, { recursive: true, force: true }));

test('hostKind', () => {
  assert.equal(hostKind('https://github.com/a/b'), 'github');
  assert.equal(hostKind('https://gitlab.example.com/a/b'), 'other');
  assert.equal(hostKind('https://dev.azure.com/a/b'), 'other');
  assert.equal(hostKind(null), 'none');
});

test('detect runs no tool, and asks where the wiki lives for a GitHub remote', () => {
  const d = detect(resolve({ cwd: app, env }));
  assert.equal(d.repo.host, 'github');
  assert.ok(!('tools' in d) && !('profile' in d), 'detect has no tools and no profile block');
  assert.ok(!('visibility' in d.repo) && !('wikiEnabled' in d.repo));
  assert.deepEqual(d.suggestion.wikiRemote, {
    type: 'ask',
    options: ['native', 'separate-private-repo', 'local-only'],
    native: 'https://github.com/owner/app.wiki.git',
    separate: 'https://github.com/owner/app-wiki',
  });
  assert.deepEqual(d.suggestion.values.checkouts, [{ name: 'app', path: app, remote: 'owner/app', baseBranch: '' }]);
  assert.ok(!('host' in d.suggestion.values));
});

test('initWiki for a --wiki folder outside of a Forge folder ignores raw and archive inside the wiki, and adds no launcher', () => {
  const other = path.join(root, 'old');
  const given = path.join(root, 'given-wiki');
  mkdirSync(other);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: other });
  const where = resolve({ cwd: other, wiki: given, env });
  assert.deepEqual([where.wiki.path, where.forge.path, where.forge.layout, where.raw], [given, given, 'wiki', path.join(given, 'raw')]);
  const r = initWiki(where, { pluginDir: path.join(root, 'plugin') });
  assert.match(readFileSync(path.join(given, '.gitignore'), 'utf8'), /^raw\/\narchive\/$/m);
  assert.ok(!r.created.some((name) => name.startsWith('../')) && !existsSync(path.join(given, '.plugin')));
  assert.deepEqual(initWiki(resolve({ cwd: other, wiki: given, env })).created, []);
});

test('initWiki creates the Forge folder with its wiki, raw, archive, and launcher, binds it, and is idempotent', () => {
  const where = resolve({ cwd: app, env });
  const home = path.join(root, 'app.forge');
  const wiki = path.join(home, 'wiki');
  assert.deepEqual([where.wiki.path, where.wiki.exists, where.forge.path, where.forge.layout, where.raw, where.archive], [wiki, false, home, 'forge', path.join(home, 'raw'), path.join(home, 'archive')]);
  const plugin = path.join(root, 'plugin');
  mkdirSync(path.join(plugin, 'scripts'), { recursive: true });
  writeFileSync(path.join(plugin, 'plugin.json'), '{"version":"9.0.0"}');
  writeFileSync(path.join(plugin, 'scripts', 'forge.mjs'), '');
  const r = initWiki(where, { pluginDir: plugin });
  assert.equal(r.wiki, wiki);
  assert.ok(existsSync(path.join(wiki, '.git')));
  // raw/ and archive/ are next to the wiki, so the wiki repository needs no .gitignore line for them.
  assert.ok(!existsSync(path.join(wiki, '.gitignore')) && existsSync(path.join(home, 'raw')) && existsSync(path.join(home, 'archive')));
  assert.deepEqual(r.created.filter((name) => name.startsWith('../')), ['../raw/', '../archive/', '../forge', '../forge.cmd', '../.plugin']);
  assert.equal(readFileSync(path.join(home, 'forge'), 'utf8'), LAUNCHER_SH);
  assert.equal(readFileSync(path.join(home, 'forge.cmd'), 'utf8'), LAUNCHER_CMD);
  if (process.platform !== 'win32') assert.equal(statSync(path.join(home, 'forge')).mode & 0o111, 0o111, 'a person can run the launcher');
  assert.equal(readPointer(home), plugin);
  const index = readFileSync(path.join(wiki, 'index.md'), 'utf8');
  assert.deepEqual(parseFile(index).data, { title: 'Wiki index', type: 'index' });
  assert.deepEqual(JSON.parse(readFileSync(path.join(wiki, 'forge', 'repo.json'), 'utf8')).repo, { path: app, remote: 'https://github.com/owner/app' });
  assert.deepEqual(initWiki(resolve({ cwd: app, env })).created, []);
  assert.equal(resolve({ cwd: wiki, env }).wiki.source, 'binding');
});

test('detect keeps an existing wiki remote', () => {
  const wiki = path.join(root, 'existing-wiki');
  mkdirSync(wiki);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: wiki });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/owner/private-knowledge.git'], { cwd: wiki });
  const d = detect({ repo: { remote: 'https://github.com/owner/app' }, wiki: { path: wiki } });
  assert.deepEqual(d.suggestion.wikiRemote, { type: 'existing', url: 'https://github.com/owner/private-knowledge' });
});

test('initWiki leaves an existing headerless index unchanged', () => {
  const wiki = path.join(root, 'headerless-wiki');
  mkdirSync(wiki);
  const index = path.join(wiki, 'index.md');
  const text = '# Existing index\r\n\r\nKeep this page.\r\n';
  writeFileSync(index, text);
  const where = { repo: { path: app, remote: 'https://github.com/owner/app' }, wiki: { path: wiki } };
  assert.ok(!initWiki(where).created.includes('index.md'));
  assert.equal(readFileSync(index, 'utf8'), text);
  assert.deepEqual(initWiki(where).created, []);
});

test('bind refuses another remote', () => {
  const where = resolve({ cwd: app, env });
  assert.throws(() => bind({ ...where, repo: { ...where.repo, remote: 'https://github.com/x/y' } }), (e) => e.code === 'wiki-mismatch');
});

test('seed copies the templates, keeps existing files, and the result loads', () => {
  const where = resolve({ cwd: app, env });
  const first = seed(where, templates);
  assert.deepEqual(first.written.sort(), ['policy.md', 'repo.md']);
  assert.ok(!('profile' in first));
  const { config } = loadConfig(first.configDir);
  const expected = loadConfig(templates).config;
  assert.deepEqual(config, expected);
  assert.match(config.repo.branchPattern, /<user>/);
  writeFileSync(path.join(first.configDir, 'repo.md'), '---\nbaseBranch: trunk\n---\n');
  const second = seed(where, templates);
  assert.deepEqual(second.kept.sort(), ['policy.md', 'repo.md']);
  assert.equal(loadConfig(first.configDir).config.repo.baseBranch, 'trunk');
  const forced = seed(where, templates, { force: true });
  assert.deepEqual(forced.written, ['repo.md']);
  assert.equal(loadConfig(first.configDir).config.repo.baseBranch, expected.repo.baseBranch);
});

test('seed writes the rule pages only when <wiki>/rules is missing', () => {
  const wiki = path.join(root, 'rules.wiki');
  const where = { wiki: { path: wiki } };
  const dir = path.join(wiki, 'rules');
  const pages = readdirSync(path.join(templates, '..', 'rules')).filter((f) => f.endsWith('.md')).sort();
  assert.deepEqual(pages, ['data.md']);
  const first = seed(where, templates);
  assert.deepEqual(first.rules, { dir, written: pages });
  for (const page of pages) {
    assert.match(readFileSync(path.join(dir, page), 'utf8'), new RegExp(`^updated: ${new Date().toISOString().slice(0, 10)}$`, 'm'));
  }
  writeFileSync(path.join(dir, pages[0]), '# Our rules\n');
  for (const force of [false, true]) {
    assert.deepEqual(seed(where, templates, { force }).rules.written, []);
    assert.equal(readFileSync(path.join(dir, pages[0]), 'utf8'), '# Our rules\n');
  }
  assert.doesNotMatch(readFileSync(path.join(first.configDir, 'policy.md'), 'utf8'), /^## (Toolkit|Data rules)$/m, 'The rules left policy.md.');
});

test('seed preserves an edited policy, even with force', () => {
  const wiki = path.join(root, 'edited.wiki');
  const where = { wiki: { path: wiki } };
  const first = seed(where, templates);
  const policyFile = path.join(first.configDir, 'policy.md');
  const policy = readFileSync(policyFile, 'utf8').replace('qaHandover: false', 'qaHandover: true');
  writeFileSync(policyFile, policy);
  for (const force of [false, true]) {
    const result = seed(where, templates, { force });
    assert.ok(result.kept.includes('policy.md'));
    assert.equal(readFileSync(policyFile, 'utf8'), policy);
    assert.equal(loadConfig(first.configDir).config.policy.qaHandover, true);
  }
});

test('keyHints and branchPatternHint read keys and branch shapes', () => {
  const hints = keyHints(['feature/APP-12-fix-login', 'APP-13 Add export', 'Use UTF-8 and SHA-256', 'APP-14: tidy', 'OPS-2 bump']);
  assert.deepEqual(hints.map((h) => [h.prefix, h.count]), [['APP', 3], ['OPS', 1]]);
  assert.equal(hints[0].example, 'APP-12');
  assert.equal(branchPatternHint(['feature/APP-12-fix-login', 'origin/feature/APP-15-new-api', 'main'], 'APP'), 'feature/{KEY}-{slug}');
  assert.equal(branchPatternHint(['app-1-a', 'app-2-b'], 'APP'), '{key}-{slug}');
  assert.equal(branchPatternHint(['APP-1-a'], 'APP'), null);
  assert.equal(branchPatternHint(['x'], null), null);
});

test('suggestValues gives the base branch, branch pattern, and main checkout', () => {
  const info = { remote: 'https://github.com/Acme-Engineering/Shop', path: path.join(root, 'Shop'), defaultBranch: 'master', branchPattern: null };
  assert.deepEqual(suggestValues(info), {
    repo: { baseBranch: 'master', branchPattern: null },
    checkouts: [{ name: 'shop', path: info.path, remote: 'Acme-Engineering/Shop', baseBranch: '' }],
  });
  assert.equal(suggestValues({ ...info, defaultBranch: null, branchPattern: 'users/alex/{KEY}-{slug}' }).repo.baseBranch, 'master');
  assert.equal(suggestValues({ ...info, branchPattern: 'users/alex/{KEY}-{slug}' }).repo.branchPattern, 'users/alex/{KEY}-{slug}');
  assert.equal(suggestValues({ ...info, remote: 'https://dev.azure.com/acme/_git/app' }).checkouts[0].remote, 'https://dev.azure.com/acme/_git/app');
  assert.deepEqual(suggestValues({ ...info, path: null }).checkouts, []);
});

test('detect infers the default branch, keys, and the personal branch pattern from local branches', () => {
  const repoDir = path.join(root, 'infer');
  mkdirSync(repoDir);
  const git = (...a) => execFileSync('git', a, { cwd: repoDir, stdio: 'pipe' });
  git('init', '-q', '-b', 'master');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(path.join(repoDir, 'readme.txt'), 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  for (const n of [1, 2, 3]) {
    git('checkout', '-q', '-b', `users/alex/APP-${n}-step-${n}`);
    git('commit', '-q', '--allow-empty', '-m', `APP-${n} step ${n}`);
  }
  git('checkout', '-q', 'master');
  git('remote', 'add', 'origin', 'https://github.com/acme/shop.git');
  const where = resolve({ cwd: repoDir, env });
  const d = detect(where);
  assert.equal(d.repo.defaultBranch, 'master');
  assert.equal(d.repo.keyHints[0].prefix, 'APP');
  assert.equal(d.repo.branchPattern, 'users/alex/{KEY}-{slug}');
  assert.equal(d.suggestion.values.repo.baseBranch, 'master');
  assert.equal(d.suggestion.values.repo.branchPattern, 'users/alex/{KEY}-{slug}');
  assert.equal(d.suggestion.values.checkouts[0].remote, 'acme/shop');
});

test('bind drops a profile key of an older repo.json, and keeps the rest', () => {
  const wiki = path.join(root, 'old-profile.wiki');
  mkdirSync(path.join(wiki, 'forge'), { recursive: true });
  const where = { wiki: { path: wiki }, repo: { path: app, remote: 'https://github.com/owner/app' } };
  writeFileSync(path.join(wiki, 'forge', 'repo.json'), JSON.stringify({ schemaVersion: 1, repo: where.repo, profile: 'forgejo' }));
  assert.equal(resolve({ cwd: app, wiki, env }).profile, undefined, 'resolve has no profile');
  assert.deepEqual(bind(where).written, ['forge/repo.json']);
  assert.equal('profile' in readBinding(wiki), false);
  assert.deepEqual(bind(where).written, []);
  assert.ok(!existsSync(path.join(wiki, 'rules')), 'bind writes no rules');
});
