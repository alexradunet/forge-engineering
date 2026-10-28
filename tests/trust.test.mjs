import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from '../plugins/forge/scripts/lib/repo.mjs';
import { initWiki, bind, seed } from '../plugins/forge/scripts/lib/setup.mjs';
import { approve, assertTrusted, status } from '../plugins/forge/scripts/lib/trust.mjs';
import { doctor, runScript } from '../plugins/forge/scripts/forge.mjs';

const scripts = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'forge', 'scripts');
const cli = path.join(scripts, 'forge.mjs');
let root, app, wiki, env;
const where = () => resolve({ cwd: app, env });
const write = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
const read = (file) => readFileSync(file, 'utf8');
const approveAll = () => approve(where(), status(where(), { env }).files.map((f) => `${f.rel}=${f.sha.slice(0, 12)}`), { env });

before(() => {
  root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'forge-trust-')));
  env = { ...process.env, FORGE_DATA_DIR: path.join(root, 'data') };
  app = path.join(root, 'app');
  mkdirSync(app);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: app });
  execFileSync('git', ['remote', 'add', 'origin', 'https://gitlab.com/team/app.git'], { cwd: app });
  initWiki(where());
  wiki = path.join(root, 'app.wiki');
  seed(where(), { tracker: 'local', repo: 'other', ci: 'other' }, path.join(scripts, '..', 'templates', 'config'));
  write(path.join(wiki, 'forge', 'scripts', 'hello.mjs'),
    'import assert from "node:assert/strict";\n' +
    'assert.equal(process.env.FORGE_CORE, process.env.TEST_CORE);\n' +
    'assert.equal(process.env.FORGE_WIKI, process.env.TEST_WIKI);\n' +
    'assert.equal(process.env.FORGE_REPO, process.env.TEST_REPO);\n' +
    'assert.deepEqual(process.argv.slice(2), ["--flag", "two words"]);\n');
  Object.assign(env, { TEST_CORE: scripts, TEST_WIKI: wiki, TEST_REPO: app });
});
after(() => rmSync(root, { recursive: true, force: true }));

test('wiki trust fails closed until each file is approved by hash', () => {
  const st = status(where(), { env });
  assert.equal(st.ok, false);
  assert.ok(st.files.every((f) => f.state === 'new'));
  assert.deepEqual(st.files.map((f) => f.rel), ['config/ci.md', 'config/policy.md', 'config/repo.md', 'config/tracker.md', 'scripts/hello.mjs']);
  assert.throws(() => assertTrusted(where(), ['config/'], { env }), (e) => e.code === 'untrusted');
  assert.throws(() => approve(where(), ['config/tracker.md=0000000000'], { env }), (e) => e.code === 'hash-mismatch');
  assert.throws(() => approve(where(), ['config/tracker.md=ab'], { env }), (e) => e.code === 'hash-mismatch');
  const config = spawnSync(process.execPath, [cli, 'config'], { cwd: app, env, encoding: 'utf8' });
  assert.equal(config.status, 1);
  assert.match(config.stderr, /Not approved/);
  approveAll();
  assert.equal(status(where(), { env }).ok, true);
  assert.ok(existsSync(path.join(root, 'data', 'trust')));
  assert.ok(!existsSync(path.join(wiki, 'forge', 'trust')));
  const loaded = JSON.parse(execFileSync(process.execPath, [cli, 'config'], { cwd: app, env, encoding: 'utf8' }));
  assert.equal(loaded.config.tracker.provider, 'local');
});

test('run executes a trusted wiki script with its environment and arguments', () => {
  assert.throws(() => runScript('../x', [], { cwd: app, env }), (e) => e.code === 'bad-args');
  assert.throws(() => runScript('missing', [], { cwd: app, env }), (e) => e.code === 'no-script' && /No wiki script/.test(e.message));
  const file = path.join(wiki, 'forge', 'scripts', 'hello.mjs');
  write(file, read(file) + '// changed\n');
  assert.throws(() => runScript('hello', [], { cwd: app, env }), (e) => e.code === 'untrusted');
  approveAll();
  assert.equal(runScript('hello', ['--flag', 'two words'], { cwd: app, env }), 0);
  execFileSync(process.execPath, [cli, 'run', 'hello', '--flag', 'two words'], { cwd: app, env });
  write(file, read(file) + '\nprocess.exitCode = 7;\n');
  approveAll();
  assert.equal(runScript('hello', ['--flag', 'two words'], { cwd: app, env }), 7);
});

test('trust refuses symlinks and matches prefixes without case', () => {
  const file = path.join(wiki, 'forge', 'scripts', 'hello.mjs');
  write(file, read(file) + '// again\n');
  assert.throws(() => assertTrusted(where(), ['SCRIPTS/'], { env }), (e) => e.code === 'untrusted');
  approveAll();
  const outside = path.join(root, 'outside');
  write(path.join(outside, 'evil.mjs'), 'console.log("evil")\n');
  const link = path.join(wiki, 'forge', 'scripts', 'lib');
  symlinkSync(outside, link, 'junction');
  try {
    const f = status(where(), { env }).files.find((x) => x.rel === 'scripts/lib');
    assert.equal(f.state, 'not-a-file');
    assert.throws(() => assertTrusted(where(), ['config/'], { env }), (e) => e.code === 'untrusted');
    assert.throws(() => approve(where(), ['scripts/lib=00000000'], { env }), (e) => e.code === 'bad-args');
  } finally {
    rmSync(link, { recursive: false, force: true });
  }
  assert.equal(status(where(), { env }).ok, true);
});

test('a teammate can clone the wiki and approve its config and scripts locally', () => {
  write(path.join(wiki, 'raw', 'local.md'), 'local only');
  write(path.join(wiki, 'archive', 'local.md'), 'local only');
  execFileSync('git', ['add', 'forge', 'index.md', '.gitignore'], { cwd: wiki });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'Share wiki'], { cwd: wiki });

  const teammate = path.join(root, 'teammate', 'app');
  const clonedWiki = `${teammate}.wiki`;
  mkdirSync(teammate, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: teammate });
  execFileSync('git', ['remote', 'add', 'origin', 'https://gitlab.com/team/app.git'], { cwd: teammate });
  execFileSync('git', ['clone', '-q', wiki, clonedWiki]);
  const teammateEnv = {
    ...env,
    FORGE_DATA_DIR: path.join(root, 'teammate', 'data'),
    TEST_WIKI: clonedWiki,
    TEST_REPO: teammate,
  };
  const cloned = resolve({ cwd: teammate, env: teammateEnv });
  bind(cloned);
  assert.equal(resolve({ cwd: clonedWiki, env: teammateEnv }).repo.path, teammate);
  assert.ok(!existsSync(path.join(clonedWiki, 'raw')));
  assert.ok(!existsSync(path.join(clonedWiki, 'archive')));
  assert.deepEqual(read(path.join(cloned.configDir, 'tracker.md')), read(path.join(wiki, 'forge', 'config', 'tracker.md')));
  assert.ok(status(cloned, { env: teammateEnv }).files.every((f) => f.state === 'new'));
  assert.throws(() => runScript('hello', [], { cwd: teammate, env: teammateEnv }), (e) => e.code === 'untrusted');
  const files = status(cloned, { env: teammateEnv }).files;
  approve(cloned, files.map((f) => `${f.rel}=${f.sha.slice(0, 12)}`), { env: teammateEnv });
  const loaded = JSON.parse(execFileSync(process.execPath, [cli, 'config'], { cwd: teammate, env: teammateEnv, encoding: 'utf8' }));
  assert.equal(loaded.config.tracker.provider, 'local');
  assert.equal(runScript('hello', ['--flag', 'two words'], { cwd: teammate, env: teammateEnv }), 7);
});

test('legacy metadata is inert and existing wiki approvals remain valid', () => {
  write(path.join(wiki, 'forge', 'pack.lock.json'), 'not JSON');
  write(path.join(wiki, 'forge', '.base', 'config', 'tracker.md'), 'old content');
  assert.equal(status(where(), { env }).ok, true);
  const checks = doctor({ cwd: app, env });
  assert.ok(!checks.some((c) => c.status === 'fail'));
  assert.ok(!checks.some((c) => c.check === 'pack'));
});

test('removed pack commands fail with usage instead of changing the wiki', () => {
  for (const args of [['init', 'unused'], ['add', 'unused'], ['update'], ['status']]) {
    const r = spawnSync(process.execPath, [cli, 'pack', ...args], { cwd: app, env, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Usage:/);
    assert.doesNotMatch(r.stderr, /\|pack\|/);
  }
  assert.equal(read(path.join(wiki, 'forge', 'pack.lock.json')), 'not JSON');
  assert.ok(!existsSync(path.join(app, 'unused')));
});
