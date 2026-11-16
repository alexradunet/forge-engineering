import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeness, loadProfile, mcpGateway } from '../plugins/forge/scripts/forge.mjs';
import { termPattern } from '../plugins/forge/scripts/lib/profile.mjs';

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
  const deny = termPattern(profile.terms);
  if (!deny) return t.skip('the profile has no terms');
  const owned = new Set([...profile.files.map((f) => `plugins/forge/${f}`), ...profile.tests]);
  const sharedDocs = ['docs/config.md', 'docs/wiki.md', 'docs/evaluation.md'].map((f) => path.join(repo, f));
  const core = [...walk(pluginDir), ...walk(path.join(repo, 'tests')), ...sharedDocs]
    .map((f) => path.relative(repo, f).split(path.sep).join('/'))
    .filter((f) => !f.startsWith('plugins/forge/templates/') && !owned.has(f));
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
