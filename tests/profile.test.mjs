import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeness, loadProfile, mcpGateway } from '../plugins/forge/scripts/forge.mjs';
import { listProfiles, loadProfile as loadProfileOf, profileFile, termPattern } from '../plugins/forge/scripts/lib/profile.mjs';
import { buildConfig, loadConfig } from '../plugins/forge/scripts/lib/config.mjs';
import { changeCommands, guardActions, writeCommands } from '../plugins/forge/scripts/lib/guard.mjs';

// Core and profile: the profile owns templates/, the plugin files in "files", and the test files in "tests" of
// templates/profile.json. All other plugin and test files, and the shared docs, are the core. The core must not hold
// a profile term ("terms"), so that a core export needs no edits.
const repo = fileURLToPath(new URL('..', import.meta.url));
const pluginDir = path.join(repo, 'plugins', 'forge');

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  return e.isDirectory() ? walk(full) : [full];
});

test('the profile loads, and each profile file exists', () => {
  const profile = loadProfile();
  assert.equal(typeof profile.name, 'string');
  assert.ok(profile.files.length > 0);
  for (const f of profile.files) assert.ok(existsSync(path.join(pluginDir, f)), `profile file ${f} is missing`);
  for (const f of profile.tests) assert.ok(existsSync(path.join(repo, f)), `profile test ${f} is missing`);
  assert.ok(existsSync(path.join(pluginDir, 'templates', 'profile.md')), 'templates/profile.md is missing');
});

test('the core holds no profile term', (t) => {
  const profile = loadProfile();
  const all = [profile, ...listProfiles().map((name) => loadProfileOf(pluginDir, name))];
  const deny = termPattern(all.flatMap((p) => p.terms));
  if (!deny) return t.skip('the profile has no terms');
  const owned = new Set(all.flatMap((p) => [...p.files.map((f) => `plugins/forge/${f}`), ...p.tests]));
  const sharedDocs = ['docs/config.md', 'docs/wiki.md', 'docs/evaluation.md'].map((f) => path.join(repo, f));
  const core = [...walk(pluginDir), ...walk(path.join(repo, 'tests')), ...sharedDocs]
    .map((f) => path.relative(repo, f).split(path.sep).join('/'))
    .filter((f) => !f.startsWith('plugins/forge/templates/') && !f.startsWith('plugins/forge/profiles/') && !owned.has(f));
  assert.ok(core.length > 40, 'the walk found too few core files');
  const hits = [];
  for (const f of core) {
    readFileSync(path.join(repo, f), 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (deny.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(hits, [], 'Move each value to the profile: templates/, or a file in "files" or "tests" of profile.json.');
});

test('without a profile, setup checks give generic hints and no MCP checks', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'forge-profile-'));
  try {
    const profile = loadProfile(dir);
    assert.deepEqual([profile.files, profile.mainCheckout, profile.mcpServers, profile.mcpRetired], [[], null, [], []]);
    writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({ mcpServers: { one: { url: 'https://example.test/mcp' } } }));
    assert.deepEqual(mcpGateway({ plugin: dir, env: { COPILOT_HOME: dir }, profile }), []);
    const config = { repo: { branchPattern: 'users/<user>/{KEY}-{slug}', checkouts: [] } };
    const found = completeness(dir, config, { profile, credStore: { has: () => true } });
    assert.match(found.find((f) => f.check === 'config:placeholder').detail, /repo\.branchPattern=users\/<your name>\/\{KEY\}-\{slug\}/);
    assert.match(found.find((f) => f.check === 'config:checkouts').detail, /checkouts <name> <path> <owner\/repo>/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the default profile loads as before, and listProfiles gives the extra profiles', () => {
  const profile = loadProfileOf(pluginDir);
  assert.equal(profile.dir, 'templates');
  assert.deepEqual(profile.tools, ['gh']);
  assert.deepEqual(listProfiles(pluginDir), ['forgejo']);
  assert.deepEqual(listProfiles(os.tmpdir() + path.sep + 'no-such-plugin'), []);
});

test('loadProfile with a name loads the profile folder, and a bad or unknown name throws', () => {
  const profile = loadProfileOf(pluginDir, 'forgejo');
  assert.deepEqual([profile.name, profile.dir, profile.tools], ['forgejo', 'profiles/forgejo', ['tea']]);
  assert.deepEqual(profile.mcpServers, []);
  assert.throws(() => loadProfileOf(pluginDir, 'nope'), (e) => e.code === 'bad-profile' && /forgejo/.test(e.message));
  assert.throws(() => loadProfileOf(pluginDir, '../x'), (e) => e.code === 'bad-profile');
  assert.throws(() => profileFile(pluginDir, '../x', 'profile.md'), (e) => e.code === 'bad-profile');
});

test('profileFile gives the file of the profile, else the file of the default profile', () => {
  assert.equal(profileFile(pluginDir, 'forgejo', 'config/tracker.md'), path.join(pluginDir, 'profiles', 'forgejo', 'config', 'tracker.md'));
  assert.equal(profileFile(pluginDir, 'forgejo', 'config/policy.md'), path.join(pluginDir, 'templates', 'config', 'policy.md'));
  assert.equal(profileFile(pluginDir, 'forgejo', 'rules/data.md'), path.join(pluginDir, 'templates', 'rules', 'data.md'));
  assert.equal(profileFile(pluginDir, null, 'profile.md'), path.join(pluginDir, 'templates', 'profile.md'));
});

test('each extra profile has profile.json and profile.md, and its config loads', () => {
  for (const name of listProfiles(pluginDir)) {
    assert.ok(existsSync(path.join(pluginDir, 'profiles', name, 'profile.json')));
    assert.ok(existsSync(path.join(pluginDir, 'profiles', name, 'profile.md')), `profiles/${name}/profile.md is missing`);
    const texts = Object.fromEntries(['tracker', 'repo', 'ci', 'policy'].map((kind) => [kind, readFileSync(profileFile(pluginDir, name, `config/${kind}.md`), 'utf8')]));
    const config = buildConfig(texts);
    assert.equal(config.repo.changeName, 'PR');
    assert.equal(config.tracker.prefix, 'FJ');
    assert.ok(config.tracker.queries.mine && config.tracker.queries.team);
  }
  // The same, through loadConfig of a folder.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'forge-profile-cfg-'));
  try {
    for (const kind of ['tracker', 'repo', 'ci', 'policy']) writeFileSync(path.join(dir, `${kind}.md`), readFileSync(profileFile(pluginDir, 'forgejo', `config/${kind}.md`), 'utf8'));
    assert.equal(loadConfig(dir).config.repo.provider, 'forgejo');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the guard reads the commands of the forgejo profile', () => {
  const texts = Object.fromEntries(['tracker', 'repo', 'ci'].map((kind) => [kind, readFileSync(profileFile(pluginDir, 'forgejo', `config/${kind}.md`), 'utf8')]));
  assert.deepEqual(changeCommands(texts.repo), [['tea', 'pulls', 'create']]);
  const writes = writeCommands(texts).map((w) => w.words.join(' '));
  for (const word of ['tea pulls edit', 'tea comment', 'tea issues close', 'tea issues reopen', 'tea issues edit', 'tea actions workflows dispatch']) {
    assert.ok(writes.includes(word), `${word} is a write`);
  }
  const options = { changes: changeCommands(texts.repo), writes: writeCommands(texts) };
  for (const line of ['tea issues 5 --comments', 'tea issues list --state open', 'tea pulls list --state all', 'tea actions runs list', 'tea api "/repos/o/n/pulls/1"']) {
    assert.deepEqual(guardActions(line, repo, options), [], `${line} is no write`);
  }
  assert.equal(guardActions('tea pulls edit 4 --title x', repo, options)[0].kind, 'write');
  assert.equal(guardActions('tea pulls create --base main --head x', repo, options)[0].kind, 'change');
});

test('forge.mjs seed --profile records the profile, and where --json shows it', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'forge-profile-cli-'));
  try {
    const cli = path.join(pluginDir, 'scripts', 'forge.mjs');
    const wiki = path.join(dir, 'wiki');
    const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args, '--cwd', repo, '--wiki', wiki], { encoding: 'utf8' }));
    assert.equal(run('where').profile, null);
    execFileSync('git', ['init', '-q', '-b', 'main', wiki]);
    const seeded = run('seed', '--profile', 'forgejo');
    assert.equal(seeded.profile, 'forgejo');
    assert.equal(run('where').profile, 'forgejo');
    assert.equal(run('bind').written.length, 0);
    assert.match(readFileSync(path.join(wiki, 'forge', 'config', 'repo.md'), 'utf8'), /provider: forgejo/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the body of an extra profile config names the key prefix and the host through their keys', () => {
  for (const name of listProfiles(pluginDir)) {
    for (const kind of ['tracker', 'repo', 'ci']) {
      const text = readFileSync(profileFile(pluginDir, name, `config/${kind}.md`), 'utf8').replace(/\r\n/g, '\n');
      const [, front, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
      const value = (key) => new RegExp(`^${key}: *(.+)$`, 'm').exec(front)?.[1].trim();
      if (value('prefix')) assert.ok(!body.includes(`${value('prefix')}-`), `${name} ${kind}.md: the body holds the fixed prefix`);
      if (value('host')) assert.ok(!body.includes(value('host')), `${name} ${kind}.md: the body holds the fixed host`);
    }
  }
});
