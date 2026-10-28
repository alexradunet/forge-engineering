import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, checkName, dataDir, windowsBackend } from '../plugins/forge/scripts/lib/cred.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'plugins', 'forge', 'scripts', 'cred.mjs');
const SECRET = 'S3cr3t-"quote"-\\back-ä';

function memoryBackend() {
  const m = new Map();
  return { id: 'memory', set: (n, s) => m.set(n, s), get: (n) => (m.has(n) ? m.get(n) : null), delete: (n) => m.delete(n) };
}

test('names are validated', () => {
  assert.equal(checkName('jenkins-rnd'), 'jenkins-rnd');
  for (const bad of ['', '../x', 'a b', 'x'.repeat(65), '-x']) assert.throws(() => checkName(bad), /Invalid secret name/);
});

test('store set, has, getSecret, delete', () => {
  const s = createStore(memoryBackend());
  assert.equal(s.has('a'), false);
  assert.throws(() => s.getSecret('a'), (e) => e.code === 'cred-absent' && !e.message.includes(SECRET));
  assert.throws(() => s.set('a', ''), (e) => e.code === 'cred-empty');
  s.set('a', SECRET);
  assert.equal(s.has('a'), true);
  assert.equal(s.getSecret('a'), SECRET);
  assert.equal(s.delete('a'), true);
  assert.equal(s.has('a'), false);
});

test('dataDir follows the platform and FORGE_DATA_DIR', () => {
  assert.equal(dataDir({ FORGE_DATA_DIR: '/x' }), '/x');
  assert.equal(dataDir({ LOCALAPPDATA: 'C:\\L' }, 'win32'), path.join('C:\\L', 'forge'));
  assert.equal(dataDir({ XDG_DATA_HOME: '/d' }, 'linux'), path.join('/d', 'forge'));
});

test('the CLI never prints the secret and has no get command', async () => {
  const { main } = await import('../plugins/forge/scripts/cred.mjs');
  const store = createStore(memoryBackend());
  store.set('k', SECRET);
  const out = [];
  const orig = [console.log, console.error];
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  try {
    assert.equal(await main(['has', 'k'], store), 0);
    assert.equal(await main(['get', 'k'], store), 2);
    assert.equal(await main(['delete', 'k'], store), 0);
    assert.equal(await main(['has', 'k'], store), 1);
  } finally {
    [console.log, console.error] = orig;
  }
  assert.ok(!out.join('\n').includes(SECRET));
});

test('Windows DPAPI round trip through the CLI', { skip: process.platform !== 'win32' }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'forge-cred-'));
  const env = { ...process.env, FORGE_DATA_DIR: dir };
  try {
    const set = spawnSync(process.execPath, [cli, 'set', 'test-token'], { input: `${SECRET}\n`, env, encoding: 'utf8' });
    assert.equal(set.status, 0, set.stderr);
    assert.ok(!set.stdout.includes(SECRET) && !set.stderr.includes(SECRET));
    const files = readdirSync(path.join(dir, 'secrets'));
    assert.deepEqual(files, ['test-token.dpapi']);
    assert.ok(!readFileSync(path.join(dir, 'secrets', files[0]), 'utf8').includes('S3cr3t'));
    assert.equal(windowsBackend(env).get('test-token'), SECRET);
    assert.equal(execFileSync(process.execPath, [cli, 'has', 'test-token'], { env, encoding: 'utf8' }).trim(), 'set');
    assert.equal(spawnSync(process.execPath, [cli, 'delete', 'test-token'], { env }).status, 0);
    assert.equal(spawnSync(process.execPath, [cli, 'has', 'test-token'], { env }).status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
