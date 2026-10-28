import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolve } from '../plugins/forge/scripts/lib/repo.mjs';
import { initWiki } from '../plugins/forge/scripts/lib/setup.mjs';
import { approve, assertTrusted, status } from '../plugins/forge/scripts/lib/trust.mjs';
import { add, update, readLock } from '../plugins/forge/scripts/lib/pack.mjs';
import { runScript } from '../plugins/forge/scripts/forge.mjs';

let root, app, wiki, src, env;
const where = () => resolve({ cwd: app, env });
const write = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
const read = (file) => readFileSync(file, 'utf8');
const approveAll = () => approve(where(), status(where(), { env }).files.map((f) => `${f.rel}=${f.sha.slice(0, 12)}`), { env });

before(() => {
  root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'forge-pack-')));
  env = { ...process.env, FORGE_DATA_DIR: path.join(root, 'data') };
  app = path.join(root, 'app');
  mkdirSync(app);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: app });
  execFileSync('git', ['remote', 'add', 'origin', 'https://gitlab.com/team/app.git'], { cwd: app });
  initWiki(where());
  wiki = path.join(root, 'app.wiki');
  src = path.join(root, 'pack');
  write(path.join(src, 'pack.json'), JSON.stringify({ name: 'acme', version: '1.0.0' }));
  write(path.join(src, 'config', 'tracker.md'), '---\nprovider: jira\n---\nline a\nline b\nline c\n');
  write(path.join(src, 'config', 'policy.md'), '---\nmaxImplementers: 2\n---\n');
  write(path.join(src, 'scripts', 'hello.mjs'), 'import path from "node:path";\nconsole.log(JSON.stringify({ core: process.env.FORGE_CORE, wiki: process.env.FORGE_WIKI, args: process.argv.slice(2) }));\n');
  write(path.join(src, 'scripts', 'gone.mjs'), '// removed in 2.0\n');
  write(path.join(src, 'tests', 'x.test.mjs'), '// not installed\n');
});
after(() => rmSync(root, { recursive: true, force: true }));

test('pack add installs config and scripts, with a lock and base copies', () => {
  const r = add(where(), src, { env });
  assert.deepEqual(r.written, ['config/policy.md', 'config/tracker.md', 'scripts/gone.mjs', 'scripts/hello.mjs']);
  assert.equal(read(path.join(wiki, 'forge', '.base', 'config', 'tracker.md')), read(path.join(src, 'config', 'tracker.md')));
  assert.equal(readLock(where()).version, '1.0.0');
  assert.ok(!existsSync(path.join(wiki, 'forge', 'tests')));
  assert.throws(() => add(where(), src, { env }), (e) => e.code === 'pack-exists');
});

test('trust fails closed until each file is approved by hash', () => {
  const st = status(where(), { env });
  assert.equal(st.ok, false);
  assert.ok(st.files.every((f) => f.state === 'new'));
  assert.ok(!st.files.some((f) => f.rel.startsWith('.base') || f.rel === 'repo.json' || f.rel === 'pack.lock.json'));
  assert.throws(() => assertTrusted(where(), ['config/'], { env }), (e) => e.code === 'untrusted');
  assert.throws(() => approve(where(), ['config/tracker.md=0000000000'], { env }), (e) => e.code === 'hash-mismatch');
  assert.throws(() => approve(where(), ['config/tracker.md=ab'], { env }), (e) => e.code === 'hash-mismatch');
  approveAll();
  assert.equal(status(where(), { env }).ok, true);
  assert.ok(existsSync(path.join(root, 'data', 'trust')));
  assert.ok(!existsSync(path.join(wiki, 'forge', 'trust')));
});

test('run executes a trusted pack script with FORGE_CORE and refuses a changed one', () => {
  assert.throws(() => runScript('../x', [], { cwd: app, env }), (e) => e.code === 'bad-args');
  write(path.join(wiki, 'forge', 'scripts', 'hello.mjs'), read(path.join(wiki, 'forge', 'scripts', 'hello.mjs')) + '// changed\n');
  assert.throws(() => runScript('hello', [], { cwd: app, env }), (e) => e.code === 'untrusted');
  approveAll();
  assert.equal(runScript('hello', [], { cwd: app, env }), 0);
});

test('pack update: fast-forward, clean merge, conflict, keep, and removal', () => {
  // Local edit at the top of tracker.md; the pack edits the bottom: clean merge.
  const tracker = path.join(wiki, 'forge', 'config', 'tracker.md');
  writeFileSync(tracker, read(tracker).replace('line a', 'line A (local)'));
  // Local edit and pack edit on the same line of policy.md: conflict.
  const policy = path.join(wiki, 'forge', 'config', 'policy.md');
  writeFileSync(policy, '---\nmaxImplementers: 3\n---\n');
  write(path.join(src, 'pack.json'), JSON.stringify({ name: 'acme', version: '2.0.0' }));
  write(path.join(src, 'config', 'tracker.md'), '---\nprovider: jira\n---\nline a\nline b\nline C (pack)\n');
  write(path.join(src, 'config', 'policy.md'), '---\nmaxImplementers: 4\n---\n');
  write(path.join(src, 'scripts', 'hello.mjs'), 'console.log("v2");\n');
  write(path.join(src, 'scripts', 'new.mjs'), 'console.log("new");\n');
  rmSync(path.join(src, 'scripts', 'gone.mjs'));

  const r = update(where(), undefined, { env });
  assert.equal(r.to, '2.0.0');
  assert.deepEqual(r.merged, ['config/tracker.md']);
  assert.deepEqual(r.conflicts.sort(), ['config/policy.md', 'scripts/hello.mjs']);
  assert.deepEqual(r.updated.sort(), ['scripts/new.mjs']);
  assert.deepEqual(r.removed, ['scripts/gone.mjs']);
  assert.match(read(tracker), /line A \(local\)[\s\S]*line C \(pack\)/);
  assert.match(read(policy), /<<<<<<< local/);
  assert.ok(!existsSync(path.join(wiki, 'forge', 'scripts', 'gone.mjs')));
  assert.equal(read(path.join(wiki, 'forge', '.base', 'config', 'policy.md')), '---\nmaxImplementers: 4\n---\n');
  assert.equal(status(where(), { env }).ok, false);
  assert.throws(() => update(where(), path.join(root, 'nope'), { env }), (e) => e.code === 'bad-source');
});

test('pack add refuses to overwrite unmanaged files without --force', () => {
  const other = path.join(root, 'other');
  mkdirSync(other);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: other });
  const w = resolve({ cwd: other, env });
  initWiki(w);
  write(path.join(root, 'other.wiki', 'forge', 'config', 'tracker.md'), '---\nprovider: local\n---\n');
  assert.throws(() => add(resolve({ cwd: other, env }), src, { env }), (e) => e.code === 'pack-conflict');
  add(resolve({ cwd: other, env }), src, { env, force: true });
  assert.match(read(path.join(root, 'other.wiki', 'forge', 'config', 'tracker.md')), /provider: jira/);
});
