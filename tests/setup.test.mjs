import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from '../plugins/forge/scripts/lib/repo.mjs';
import { detect, hostKind, initWiki, bind, seed } from '../plugins/forge/scripts/lib/setup.mjs';
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
  assert.equal(hostKind('https://gitlab.example.com/a/b'), 'gitlab');
  assert.equal(hostKind('https://dev.azure.com/a/b'), 'other');
  assert.equal(hostKind(null), 'none');
});

test('detect suggests GitHub tools and a native wiki for a private repo', () => {
  const probe = (cmd, args) => {
    if (cmd === 'gh' && args[0] === 'repo') return { ok: true, stdout: '{"visibility":"PRIVATE","hasWikiEnabled":true}' };
    return { ok: cmd === 'gh', stdout: '' };
  };
  const d = detect(resolve({ cwd: app, env }), { platform: 'darwin', probe });
  assert.equal(d.repo.host, 'github');
  assert.equal(d.repo.visibility, 'private');
  assert.equal(d.tools.gh.auth, true);
  assert.equal(d.tools.glab.installed, false);
  assert.equal(d.tools.glab.install, 'brew install glab');
  assert.deepEqual(d.suggestion.wikiRemote, { type: 'native', url: 'https://github.com/owner/app.wiki.git' });
  assert.equal(d.suggestion.ci, 'github-actions');
});

test('detect asks for a public repo', () => {
  const probe = (cmd, args) => (cmd === 'gh' && args[0] === 'repo' ? { ok: true, stdout: '{"visibility":"PUBLIC"}' } : { ok: cmd === 'gh', stdout: '' });
  const d = detect(resolve({ cwd: app, env }), { platform: 'linux', probe });
  assert.equal(d.suggestion.wikiRemote.type, 'ask');
  assert.deepEqual(d.suggestion.wikiRemote.options, ['native', 'separate-private-repo', 'local-only']);
  assert.equal(d.suggestion.wikiRemote.native, 'https://github.com/owner/app.wiki.git');
  assert.equal(d.suggestion.wikiRemote.separate, 'https://github.com/owner/app-wiki');
});

test('detect does not offer a disabled public wiki', () => {
  const probe = (cmd, args) => (cmd === 'gh' && args[0] === 'repo'
    ? { ok: true, stdout: '{"visibility":"PUBLIC","hasWikiEnabled":false}' }
    : { ok: cmd === 'gh', stdout: '' });
  const d = detect(resolve({ cwd: app, env }), { probe });
  assert.deepEqual(d.suggestion.wikiRemote.options, ['separate-private-repo', 'local-only']);
});

test('initWiki creates, ignores raw, binds, and is idempotent', () => {
  const where = resolve({ cwd: app, env });
  const r = initWiki(where);
  const wiki = path.join(root, 'app.wiki');
  assert.equal(r.wiki, wiki);
  assert.ok(existsSync(path.join(wiki, '.git')));
  assert.match(readFileSync(path.join(wiki, '.gitignore'), 'utf8'), /^raw\/$/m);
  const index = readFileSync(path.join(wiki, 'index.md'), 'utf8');
  assert.deepEqual(parseFile(index).data, { title: 'Wiki index', type: 'index' });
  assert.deepEqual(JSON.parse(readFileSync(path.join(wiki, 'forge', 'repo.json'), 'utf8')).repo, { path: app, remote: 'https://github.com/owner/app' });
  assert.deepEqual(initWiki(resolve({ cwd: app, env })).created, []);
  assert.equal(resolve({ cwd: wiki, env }).wiki.source, 'binding');
});

test('detect respects wiki availability across visibility and host combinations', () => {
  for (const kind of ['github', 'gitlab']) {
    for (const visibility of ['private', 'internal', 'public', null]) {
      for (const enabled of [true, false, null]) {
        const where = {
          repo: { remote: `https://${kind}.com/owner/app` },
          wiki: { path: path.join(root, 'absent.wiki'), exists: false },
        };
        const cli = kind === 'github' ? 'gh' : 'glab';
        const probe = (cmd, args) => ({
          ok: cmd === cli,
          stdout: args[0] === 'repo' ? JSON.stringify(kind === 'github'
            ? { visibility: visibility?.toUpperCase(), hasWikiEnabled: enabled }
            : { visibility, wiki_enabled: enabled }) : '',
        });
        const d = detect(where, { probe });
        const label = `${kind}/${visibility}/${enabled}`;
        assert.equal(d.repo.visibility, visibility, label);
        assert.equal(d.repo.wikiEnabled, enabled, label);
        if (enabled !== false && ['private', 'internal'].includes(visibility)) {
          assert.deepEqual(d.suggestion.wikiRemote, { type: 'native', url: `${where.repo.remote}.wiki.git` }, label);
        } else {
          assert.equal(d.suggestion.wikiRemote.type, 'ask', label);
          assert.deepEqual(d.suggestion.wikiRemote.options, [
            ...(enabled === false ? [] : ['native']), 'separate-private-repo', 'local-only',
          ], label);
        }
      }
    }
  }
});

test('detect keeps an existing wiki remote even when the native wiki is disabled', () => {
  const wiki = path.join(root, 'existing-wiki');
  mkdirSync(wiki);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: wiki });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/owner/private-knowledge.git'], { cwd: wiki });
  for (const visibility of ['PRIVATE', 'INTERNAL', 'PUBLIC', null]) {
    const probe = (cmd, args) => ({
      ok: cmd === 'gh',
      stdout: args[0] === 'repo' ? JSON.stringify({ visibility, hasWikiEnabled: false }) : '',
    });
    const d = detect({ repo: { remote: 'https://github.com/owner/app' }, wiki: { path: wiki } }, { probe });
    assert.deepEqual(d.suggestion.wikiRemote, { type: 'existing', url: 'https://github.com/owner/private-knowledge' });
  }
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

test('seed copies templates, keeps existing files, and the result loads', () => {
  const where = resolve({ cwd: app, env });
  const first = seed(where, { tracker: 'github', repo: 'github', ci: 'github-actions' }, templates);
  assert.deepEqual(first.written.sort(), ['ci.md', 'policy.md', 'repo.md', 'tracker.md']);
  assert.equal(loadConfig(first.configDir).config.policy.learningMode, false);
  writeFileSync(path.join(first.configDir, 'tracker.md'), '---\nprovider: local\n---\n');
  const second = seed(where, { tracker: 'gitlab' }, templates);
  assert.deepEqual(second.kept.sort(), ['policy.md', 'tracker.md']);
  assert.equal(loadConfig(first.configDir).config.tracker.provider, 'local');
  const forced = seed(where, { tracker: 'jira' }, templates, { force: true });
  assert.deepEqual(forced.written, ['tracker.md']);
  assert.equal(loadConfig(first.configDir).config.tracker.provider, 'jira');
  assert.throws(() => seed(where, { ci: 'travis' }, templates), (e) => e.code === 'bad-choice');
});

test('seed preserves an enabled learning policy, even with force', () => {
  const wiki = path.join(root, 'learning.wiki');
  const where = { wiki: { path: wiki } };
  const first = seed(where, { tracker: 'local', repo: 'other', ci: 'other' }, templates);
  const policyFile = path.join(first.configDir, 'policy.md');
  const policy = readFileSync(policyFile, 'utf8').replace('learningMode: false', 'learningMode: true');
  writeFileSync(policyFile, policy);
  for (const force of [false, true]) {
    const result = seed(where, { tracker: 'local' }, templates, { force });
    assert.ok(result.kept.includes('policy.md'));
    assert.equal(readFileSync(policyFile, 'utf8'), policy);
    assert.equal(loadConfig(first.configDir).config.policy.learningMode, true);
  }
});
