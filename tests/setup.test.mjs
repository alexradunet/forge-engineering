import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from '../plugins/forge/scripts/lib/repo.mjs';
import { detect, hostKind, initWiki, bind, seed } from '../plugins/forge/scripts/lib/setup.mjs';
import { loadConfig } from '../plugins/forge/scripts/lib/config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const templates = path.join(here, '..', 'plugins', 'forge', 'templates', 'config');
let root, app;
const env = {};

before(() => {
  root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'forge-setup-')));
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
  assert.equal(d.suggestion.wikiRemote.separate, 'https://github.com/owner/app-wiki');
});

test('initWiki creates, ignores raw, binds, and is idempotent', () => {
  const where = resolve({ cwd: app, env });
  const r = initWiki(where);
  const wiki = path.join(root, 'app.wiki');
  assert.equal(r.wiki, wiki);
  assert.ok(existsSync(path.join(wiki, '.git')));
  assert.match(readFileSync(path.join(wiki, '.gitignore'), 'utf8'), /^raw\/$/m);
  assert.deepEqual(JSON.parse(readFileSync(path.join(wiki, 'forge', 'repo.json'), 'utf8')).repo, { path: app, remote: 'https://github.com/owner/app' });
  assert.deepEqual(initWiki(resolve({ cwd: app, env })).created, []);
  assert.equal(resolve({ cwd: wiki, env }).wiki.source, 'binding');
});

test('bind refuses another remote', () => {
  const where = resolve({ cwd: app, env });
  assert.throws(() => bind({ ...where, repo: { ...where.repo, remote: 'https://github.com/x/y' } }), (e) => e.code === 'wiki-mismatch');
});

test('seed copies templates, keeps existing files, and the result loads', () => {
  const where = resolve({ cwd: app, env });
  const first = seed(where, { tracker: 'github', repo: 'github', ci: 'github-actions' }, templates);
  assert.deepEqual(first.written.sort(), ['ci.md', 'policy.md', 'repo.md', 'tracker.md']);
  writeFileSync(path.join(first.configDir, 'tracker.md'), '---\nprovider: local\n---\n');
  const second = seed(where, { tracker: 'gitlab' }, templates);
  assert.deepEqual(second.kept.sort(), ['policy.md', 'tracker.md']);
  assert.equal(loadConfig(first.configDir).config.tracker.provider, 'local');
  const forced = seed(where, { tracker: 'jira' }, templates, { force: true });
  assert.deepEqual(forced.written, ['tracker.md']);
  assert.equal(loadConfig(first.configDir).config.tracker.provider, 'jira');
  assert.throws(() => seed(where, { ci: 'travis' }, templates), (e) => e.code === 'bad-choice');
});
